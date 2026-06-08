import { describe, test, expect } from "bun:test";
import { chunkFile, computeHash, type FileChunkInput } from "../src/lib/chunker";
import { createProject, extractSymbols } from "../src/lib/ts-service";
import type { ProjectConfig } from "../src/types";
import { resolve } from "path";

const FIXTURE = resolve("test/fixtures/tiny-project");
const configs: ProjectConfig[] = [{ name: "tiny", tsconfig: resolve(FIXTURE, "tsconfig.json") }];

describe("computeHash", () => {
  test("produces stable hash for same inputs", () => {
    const h1 = computeHash("src/math.ts", 1, 10);
    const h2 = computeHash("src/math.ts", 1, 10);
    expect(h1).toBe(h2);
  });

  test("different lines produce different hash", () => {
    const h1 = computeHash("src/math.ts", 1, 10);
    const h2 = computeHash("src/math.ts", 2, 10);
    expect(h1).not.toBe(h2);
  });
});

describe("chunkFile", () => {
  test("function declaration becomes a chunk", () => {
    const project = createProject(configs);
    const mathSf = project.getSourceFiles().find(f => f.getFilePath().endsWith("math.ts"))!;
    const syms = extractSymbols(mathSf);

    const input: FileChunkInput = {
      filePath: mathSf.getFilePath(),
      symbols: syms,
      sourceText: mathSf.getFullText(),
    };

    const chunks = chunkFile(input);
    const funcChunks = chunks.filter(c => c.kind === "function");
    expect(funcChunks.length).toBeGreaterThanOrEqual(2); // add, multiply

    const addChunk = funcChunks.find(c => c.signature.includes("add"));
    expect(addChunk).toBeDefined();
    expect(addChunk!.exported).toBe(true);
    expect(addChunk!.hash.length).toBe(16);
  });

  test("interface becomes a chunk", () => {
    const project = createProject(configs);
    const typesSf = project.getSourceFiles().find(f => f.getFilePath().endsWith("types.ts"))!;
    const syms = extractSymbols(typesSf);

    const input: FileChunkInput = {
      filePath: typesSf.getFilePath(),
      symbols: syms,
      sourceText: typesSf.getFullText(),
    };

    const chunks = chunkFile(input);
    const ifaceChunks = chunks.filter(c => c.kind === "interface");
    expect(ifaceChunks.length).toBeGreaterThanOrEqual(1);
    expect(ifaceChunks[0].signature).toContain("Result");
  });

  test("chunk hash is stable across re-chunk of same file", () => {
    const project = createProject(configs);
    const mathSf = project.getSourceFiles().find(f => f.getFilePath().endsWith("math.ts"))!;
    const syms = extractSymbols(mathSf);
    const sourceText = mathSf.getFullText();

    const input: FileChunkInput = { filePath: mathSf.getFilePath(), symbols: syms, sourceText };
    const chunks1 = chunkFile(input);
    const chunks2 = chunkFile(input);

    expect(chunks1.length).toBe(chunks2.length);
    for (let i = 0; i < chunks1.length; i++) {
      expect(chunks1[i].hash).toBe(chunks2[i].hash);
    }
  });

  test("chunks include body text (trimmed to 512 chars)", () => {
    const project = createProject(configs);
    const mathSf = project.getSourceFiles().find(f => f.getFilePath().endsWith("math.ts"))!;
    const syms = extractSymbols(mathSf);

    const input: FileChunkInput = {
      filePath: mathSf.getFilePath(),
      symbols: syms,
      sourceText: mathSf.getFullText(),
    };

    const chunks = chunkFile(input);
    for (const c of chunks) {
      expect(c.body.length).toBeGreaterThan(0);
      expect(c.body.length).toBeLessThanOrEqual(512);
    }
  });

  test("chunk hash uses SHA256 of file:start:end", () => {
    const hash = computeHash("/abs/path/src/math.ts", 4, 12);
    // 16 hex chars from SHA256
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });
});
