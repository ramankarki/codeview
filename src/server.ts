import type { CodeviewConfig, ServerState, ContextResponse } from "./types";
import { loadConfig } from "./config";
import { createProject, extractSymbols, getImports, type ExtractedSymbol, type ImportEdge } from "./lib/ts-service";
import { buildGraph } from "./lib/graph";
import { rankFiles, shouldCompress } from "./lib/ranker";
import { generateRepoMap } from "./lib/repo-map";
import { chunkFile } from "./lib/chunker";
import { getDb, insertChunk, getChunkCount, setCachedRepoMap, getCachedRepoMap, resetDb, getAllChunks, searchSimilar, markStale } from "./db";
import { createEmbeddingProvider, type EmbeddingProvider as EmbedProvider } from "./lib/embedding";
import { keywordSearch, reciprocalRankFusion, type SearchResult } from "./lib/search";
import { graphWalk } from "./lib/graph-walk";
import { indexChunks } from "./lib/indexer";
import { join, resolve } from "path";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";

let server: ReturnType<typeof Bun.serve> | null = null;
let rootDir = "";
let state: ServerState | null = null;
let sfToSymbols = new Map<string, ExtractedSymbol[]>();
let sfToImports = new Map<string, ImportEdge[]>();
let embeddingProvider: EmbedProvider | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
import { watch } from "fs";
let fileWatcher: ReturnType<typeof watch> | null = null;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export { startServer, stopServer };

async function startServer(rDir: string, requestedPort: number = 0): Promise<{ port: number }> {
  rootDir = rDir;
  const config = loadConfig(rootDir);

  // Ensure .codeview directory
  const codeviewDir = join(rootDir, ".codeview");
  if (!existsSync(codeviewDir)) {
    mkdirSync(codeviewDir, { recursive: true });
  }

  // Initialize persistent DB
  const dbPath = join(codeviewDir, "codeview.db");
  resetDb(dbPath);

  // Initialize embedding provider
  if (config.embedding) {
    embeddingProvider = await createEmbeddingProvider(config.embedding);
  } else {
    embeddingProvider = await createEmbeddingProvider({ provider: "ollama" });
  }

  // Initialize ts-morph
  const projectConfigs = config.projects ?? [
    { name: "default", tsconfig: "tsconfig.json" },
  ];

  const { resolve } = await import("path");
  const resolvedConfigs = projectConfigs.map(pc => ({
    ...pc,
    tsconfig: resolve(rootDir, pc.tsconfig),
  }));

  const project = createProject(resolvedConfigs);
  sfToSymbols = new Map();
  sfToImports = new Map();

  for (const sf of project.getSourceFiles()) {
    const fp = sf.getFilePath();

    // Skip .d.ts declaration files
    if (fp.endsWith(".d.ts")) continue;

    // Skip files matching exclude globs
    if (config.exclude?.some(pattern => matchGlob(fp, rootDir, pattern))) continue;

    sfToSymbols.set(fp, extractSymbols(sf));
    sfToImports.set(fp, getImports(sf));
  }

  // Build graph
  const graph = buildGraph(resolvedConfigs, sfToSymbols, sfToImports);

  // Index chunks into DB
  const allChunks = [];
  for (const [filePath, syms] of sfToSymbols) {
    const sf = project.getSourceFile(filePath);
    if (!sf) continue;
    const chunks = chunkFile({ filePath, symbols: syms, sourceText: sf.getFullText() });
    allChunks.push(...chunks);
  }

  await indexChunks(allChunks, embeddingProvider!);

  state = {
    projects: resolvedConfigs,
    model: embeddingProvider?.reachable ? (embeddingProvider.provider === "degraded" ? null : embeddingProvider.provider) : null,
    lastBuild: Date.now(),
    config,
  };

  // Start HTTP server
  server = Bun.serve({
    port: requestedPort,
    hostname: "127.0.0.1",
    fetch(req) {
      resetIdleTimer();
      return handleRequest(req, graph, project, resolvedConfigs, config, sfToSymbols);
    },
  });

  // Write port + pid files
  writeFileSync(join(codeviewDir, "port"), String(server.port));
  writeFileSync(join(codeviewDir, "pid"), String(process.pid));

  // Start idle timer
  resetIdleTimer();

  // Set up file watching
  fileWatcher = watch(
    rootDir,
    { recursive: true },
    (event, filename) => {
      if (!filename) return;
      if (/node_modules|\.git|dist|\.codeview|\/\./.test(filename)) return;
      if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filename)) return;

      const absPath = resolve(rootDir, filename);
      const sf = project.getSourceFile(absPath);
      if (!sf) return;

      try { sf.refreshFromFileSystemSync(); } catch {}

      markStale(absPath);
      setCachedRepoMap("", 0);
    }
  );

  return { port: server.port! };
}

function stopServer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }
  if (server) {
    server.stop();
    server = null;
  }
  // Clean up port/pid files
  if (rootDir) {
    try { unlinkSync(join(rootDir, ".codeview", "port")); } catch {}
    try { unlinkSync(join(rootDir, ".codeview", "pid")); } catch {}
  }
  state = null;
  embeddingProvider = null;
}

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log(`[codeview] Idle timeout (${IDLE_TIMEOUT_MS / 60000}min) — shutting down.`);
    stopServer();
  }, IDLE_TIMEOUT_MS);
}

/**
 * Simple glob-to-regex for exclude patterns.
 * Supports **, *, and literal text.
 */
function matchGlob(filePath: string, rootDir: string, pattern: string): boolean {
  // Make pattern relative to rootDir
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex chars
    .replace(/\*\*/g, "<<<GLOBSTAR>>>")
    .replace(/\*/g, "[^/]*")
    .replace(/<<<GLOBSTAR>>>/g, ".*");

  const regex = new RegExp(regexStr);
  const relPath = filePath.startsWith(rootDir) ? filePath.slice(rootDir.length + 1) : filePath;
  return regex.test(relPath);
}

async function handleRequest(
  req: Request,
  graph: ReturnType<typeof buildGraph>,
  project: ReturnType<typeof createProject>,
  configs: Parameters<typeof createProject>[0],
  config: CodeviewConfig,
  syms: Map<string, ExtractedSymbol[]>
): Promise<Response> {
  const url = new URL(req.url);

  try {
    // GET /health
    if (req.method === "GET" && url.pathname === "/health") {
      return Response.json({
        status: "ok",
        chunks: getChunkCount(),
        ollama: state?.model === "ollama",
        uptime: state ? Date.now() - state.lastBuild : 0,
      });
    }

    // POST /repo-map
    if (req.method === "POST" && url.pathname === "/repo-map") {
      const body = await req.json().catch(() => ({}));
      const tokenBudget = body.tokenBudget ?? config.tokenBudget ?? 5000;

      const cached = getCachedRepoMap();
      if (cached) {
        return Response.json({ text: cached.text, tokenCount: cached.tokenCount });
      }

      const ranked = rankFiles(graph);
      const text = generateRepoMap(configs, graph, ranked, syms, { tokenBudget });
      const tokenCount = Math.ceil(text.length / 4);

      setCachedRepoMap(text, tokenCount);

      return Response.json({ text, tokenCount });
    }

    // POST /search
    if (req.method === "POST" && url.pathname === "/search") {
      const body = await req.json().catch(() => ({}));
      const query = body.query ?? "";
      const topK = body.topK ?? 10;

      const degraded = !embeddingProvider?.reachable;
      const allChunks = getAllChunks();
      const candidates: SearchResult[] = allChunks.map(c => ({
        hash: c.hash,
        file: c.file,
        startLine: c.startLine,
        endLine: c.endLine,
        signature: c.signature,
        kind: c.kind,
        rank: c.exported ? 0.5 : 0.1,
      }));

      let results: SearchResult[];

      if (!degraded && embeddingProvider) {
        // Semantic search
        try {
          const queryVec = await embeddingProvider.embed(query);
          const similarResults = searchSimilar(queryVec, embeddingProvider.dimension, topK * 2);
          const semantic: SearchResult[] = similarResults.map(r => ({
            hash: r.hash,
            file: r.file,
            startLine: r.startLine,
            endLine: r.endLine,
            signature: r.signature,
            kind: r.kind,
            distance: r.distance,
          }));

          const structural = keywordSearch(query, candidates);
          results = reciprocalRankFusion(semantic, structural, topK);
        } catch {
          // Fallback to keyword
          results = keywordSearch(query, candidates);
        }
      } else {
        // Degraded mode: keyword only
        results = keywordSearch(query, candidates);
      }

      return Response.json({ results });
    }

    // POST /context (hybrid: repo map + semantic + graph walk)
    if (req.method === "POST" && url.pathname === "/context") {
      const body = await req.json().catch(() => ({}));
      const task = body.task ?? "";

      // Get repo map
      const ranked = rankFiles(graph);
      const tokenBudget = config.tokenBudget ?? 5000;
      const repoMap = generateRepoMap(configs, graph, ranked, syms, { tokenBudget: Math.floor(tokenBudget * 0.6) });

      // Get semantic + structural results
      const degraded = !embeddingProvider?.reachable;
      const allChunks = getAllChunks();
      const candidates: SearchResult[] = allChunks.map(c => ({
        hash: c.hash,
        file: c.file,
        startLine: c.startLine,
        endLine: c.endLine,
        signature: c.signature,
        kind: c.kind,
        rank: c.exported ? 0.5 : 0.1,
      }));

      const topK = body.topK ?? 10;
      let semantic: Array<{ hash: string; file: string; startLine: number; endLine: number; signature: string; kind: string; distance?: number }> = [];

      if (!degraded && embeddingProvider && task) {
        try {
          const queryVec = await embeddingProvider.embed(task);
          const similarResults = searchSimilar(queryVec, embeddingProvider.dimension, topK * 2);
          semantic = similarResults.map(r => ({
            hash: r.hash,
            file: r.file,
            startLine: r.startLine,
            endLine: r.endLine,
            signature: r.signature,
            kind: r.kind,
            distance: r.distance,
          }));
        } catch {
          // Fallback
        }
      }

      const structural = task ? keywordSearch(task, candidates) : [];
      const fused = reciprocalRankFusion(semantic, structural, topK);

      // Graph walk augmentation
      const gwConfig = config.graphWalk ?? { maxDepth: 1, maxNeighborsPerNode: 5, maxAugmentationTokens: 2000 };
      const augmented = graphWalk(fused, graph, gwConfig);

      const contextResponse: ContextResponse = {
        repoMap,
        semantic: fused,
        augmented,
        degraded,
      };

      return Response.json(contextResponse);
    }

    // GET /references?name=X
    if (req.method === "GET" && url.pathname === "/references") {
      const name = url.searchParams.get("name") ?? "";
      const results: Array<{
        file: string; line: number; context: string;
      }> = [];

      // Find which files import a symbol with this name
      for (const [, node] of graph) {
        for (const [targetFile, importedNames] of node.imports) {
          if (importedNames.includes(name)) {
            results.push({
              file: node.file,
              line: 0,
              context: `imports ${name} from ${targetFile}`,
            });
          }
        }
      }

      return Response.json({ usages: results });
    }

    // GET /find?name=X
    if (req.method === "GET" && url.pathname === "/find") {
      const name = url.searchParams.get("name") ?? "";
      const results: Array<{
        name: string; kind: string; file: string; line: number; signature: string;
      }> = [];

      for (const [filePath, symbols] of syms) {
        for (const sym of symbols) {
          if (sym.name === name) {
            results.push({
              name: sym.name,
              kind: sym.kind,
              file: filePath,
              line: sym.startLine,
              signature: sym.signature,
            });
          }
        }
      }

      return Response.json({ symbols: results });
    }

    // POST /rebuild
    if (req.method === "POST" && url.pathname === "/rebuild") {
      resetDb(join(rootDir, ".codeview", "codeview.db"));
      // Re-index everything
      const allChunks = [];
      for (const [filePath, syms] of sfToSymbols) {
        const sf = project.getSourceFile(filePath);
        if (!sf) continue;
        const chunks = chunkFile({ filePath, symbols: syms, sourceText: sf.getFullText() });
        allChunks.push(...chunks);
      }
      await indexChunks(allChunks, embeddingProvider!);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
  } catch (err: any) {
    return Response.json(
      { error: err.message ?? "Internal error", code: "INTERNAL" },
      { status: 500 }
    );
  }
}
