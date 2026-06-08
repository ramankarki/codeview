import type { ProjectConfig, GraphNode } from "../types";
import type { GraphMap } from "./graph";
import type { RankedFile } from "./ranker";
import { shouldCompress } from "./ranker";
import type { ExtractedSymbol } from "./ts-service";

export interface RepoMapOptions {
  tokenBudget: number;
}

/**
 * Estimate token count (rough: 1 token ≈ 4 chars for code).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Generate the compressed repo map text block.
 */
export function generateRepoMap(
  configs: ProjectConfig[],
  graph: GraphMap,
  ranked: RankedFile[],
  sfToSymbols: Map<string, ExtractedSymbol[]>,
  opts: RepoMapOptions
): string {
  const lines: string[] = [];
  // Don't compress small graphs (< 100 edges)
  const budget = shouldCompress(graph) ? opts.tokenBudget : Infinity;

  // Header
  const header = shouldCompress(graph)
    ? "## Repo map (ranked by import centrality)"
    : "## Repo map (full)";
  lines.push(header);
  lines.push("");

  // Group by project
  const projectNames = configs.map(c => c.name);
  const projectFiles = new Map<string, RankedFile[]>();

  for (const rf of ranked) {
    const proj = rf.node.project;
    if (!projectFiles.has(proj)) projectFiles.set(proj, []);
    projectFiles.get(proj)!.push(rf);
  }

  // Build reverse dependency map: file → who imports it
  const importedBy = new Map<string, string[]>();
  for (const [, node] of graph) {
    for (const [targetPath] of node.imports) {
      if (!importedBy.has(targetPath)) importedBy.set(targetPath, []);
      importedBy.get(targetPath)!.push(relativePath(node.file));
    }
  }

  let tokenCount = estimateTokens(lines.join("\n"));

  for (const projName of projectNames) {
    const files = projectFiles.get(projName);
    if (!files || files.length === 0) continue;

    const header = `### ${projName}`;
    lines.push(header);
    tokenCount += estimateTokens(header);

    for (const rf of files) {
      const relPath = relativePath(rf.file);
      const syms = sfToSymbols.get(rf.file) ?? [];
      const importers = importedBy.get(rf.file) ?? [];

      // File header line
      const impByStr = importers.length > 0
        ? ` [imported by: ${importers.join(", ")}]`
        : "";
      const fileHeader = `${relPath}${impByStr}`;
      const exportSyms = syms.filter(s => s.exported);

      // Estimate cost of this file block
      const blockTokens = estimateTokens(fileHeader) + 1 +
        exportSyms.reduce((sum, s) => sum + estimateTokens(`  ${s.signature}`), 0);

      // Skip if adding this file would exceed budget
      if (tokenCount + blockTokens > budget && lines.length > 2) {
        lines.push(`### Other modules (${files.length - files.indexOf(rf)} files trimmed for token budget)`);
        return lines.join("\n");
      }

      lines.push(fileHeader);
      tokenCount += estimateTokens(fileHeader);

      // Symbol signatures
      for (const sym of exportSyms) {
        const sigLine = `  ${sym.signature}`;
        lines.push(sigLine);
        tokenCount += estimateTokens(sigLine);
      }

      lines.push("");
      tokenCount += 1;
    }
  }

  return lines.join("\n");
}

/**
 * Convert absolute path to relative (strip cwd and leading /).
 */
function relativePath(absPath: string): string {
  // Simple: strip up to and including project-like paths
  // Better approach: make relative to working dir
  const parts = absPath.split("/");
  // Find a sensible anchor: look for 'src/' or just use last 3 segments
  const srcIdx = parts.indexOf("src");
  if (srcIdx >= 0) {
    return parts.slice(srcIdx).join("/");
  }
  // Fallback: last 3 segments
  return parts.slice(-3).join("/");
}
