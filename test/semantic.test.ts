import { describe, test, expect, beforeAll } from "bun:test";
import { resolve } from "path";
import { createProject, extractSymbols, getImports } from "../src/lib/ts-service";
import { chunkFile } from "../src/lib/chunker";
import { indexChunks, reEmbedStale } from "../src/lib/indexer";
import { createEmbeddingProvider } from "../src/lib/embedding";
import { resetDb, getDb, insertChunk, getChunkCount, ensureEmbeddingTable, insertEmbedding, searchSimilar, isVecLoaded } from "../src/db";

const FIXTURE = resolve("test/fixtures/tiny-project");

// We can't rely on ollama for these tests, so test with degraded mode
describe("indexChunks (degraded mode)", () => {
  beforeAll(() => {
    resetDb(":memory:");
  });

  test("indexes chunks without embedding when degraded", async () => {
    const configs = [{ name: "tiny", tsconfig: resolve(FIXTURE, "tsconfig.json") }];
    const project = createProject(configs);

    const chunks = [];
    for (const sf of project.getSourceFiles()) {
      const syms = extractSymbols(sf);
      const fileChunks = chunkFile({
        filePath: sf.getFilePath(),
        symbols: syms,
        sourceText: sf.getFullText(),
      });
      chunks.push(...fileChunks);
    }

    const provider = await createEmbeddingProvider({ provider: "ollama" });
    await indexChunks(chunks, provider);

    expect(getChunkCount()).toBeGreaterThan(0);
  });
});

describe("searchSimilar with vec0", () => {
  beforeAll(() => {
    resetDb(":memory:");
  });

  test("stores and retrieves embeddings when vec is available", () => {
    if (!isVecLoaded()) {
      console.log("sqlite-vec not loaded — skipping vec test");
      return;
    }

    const dim = 8;
    ensureEmbeddingTable(dim);

    // Insert a chunk
    const chunkId = insertChunk({
      id: 0,
      hash: "abc1230000000000",
      file: "src/test.ts",
      startLine: 1,
      endLine: 5,
      kind: "function",
      signature: "export function test()",
      body: "function body",
      doc: "",
      imports: [],
      exported: true,
      stale: false,
    });

    // Insert embedding
    const vec = new Float32Array(dim).fill(0);
    vec[0] = 1.0; // make it distinguishable
    insertEmbedding(chunkId, vec, dim);

    // Search with slightly different vector
    const query = new Float32Array(dim).fill(0);
    query[0] = 0.9;
    const results = searchSimilar(query, dim, 5);

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].hash).toBe("abc1230000000000");
    expect(results[0].distance).toBeLessThan(1);
  });
});
