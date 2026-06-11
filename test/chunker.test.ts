import { describe, test, expect, beforeAll } from "bun:test";
import { chunkFile, computeHash, type FileChunkInput, type Chunk } from "../src/lib/chunker";
import { createProject, extractSymbols } from "../src/lib/ts-service";
import type { ProjectConfig } from "../src/types";
import { resolve } from "path";

const FIXTURE = resolve("test/fixtures/tiny-project");
const configs: ProjectConfig[] = [{ name: "tiny", tsconfig: resolve(FIXTURE, "tsconfig.json") }];

let mathChunks: Chunk[];
let typesChunks: Chunk[];

beforeAll(() => {
  const project = createProject(configs);
  const mathSf = project.getSourceFiles().find(f => f.getFilePath().endsWith("math.ts"))!;
  const typesSf = project.getSourceFiles().find(f => f.getFilePath().endsWith("types.ts"))!;

  const mathInput: FileChunkInput = {
    filePath: mathSf.getFilePath(),
    symbols: extractSymbols(mathSf),
    sourceText: mathSf.getFullText(),
  };
  mathChunks = chunkFile(mathInput);

  const typesInput: FileChunkInput = {
    filePath: typesSf.getFilePath(),
    symbols: extractSymbols(typesSf),
    sourceText: typesSf.getFullText(),
  };
  typesChunks = chunkFile(typesInput);
});

describe("computeHash", () => {
  test("stable for same inputs, different for different lines", () => {
    expect(computeHash("src/math.ts", 1, 10)).toBe(computeHash("src/math.ts", 1, 10));
    expect(computeHash("src/math.ts", 1, 10)).not.toBe(computeHash("src/math.ts", 2, 10));
  });

  test("produces 16-char hex digest", () => {
    expect(computeHash("/abs/path/src/math.ts", 4, 12)).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("chunkFile", () => {
  test("produces well-formed chunks for functions and interfaces", () => {
    // functions from math.ts
    const funcs = mathChunks.filter(c => c.kind === "function");
    expect(funcs.length).toBeGreaterThanOrEqual(2);
    const addChunk = funcs.find(c => c.signature.includes("add"))!;
    expect(addChunk.exported).toBe(true);
    expect(addChunk.hash).toHaveLength(16);

    // interfaces from types.ts
    const ifaces = typesChunks.filter(c => c.kind === "interface");
    expect(ifaces.length).toBeGreaterThanOrEqual(1);
    expect(ifaces[0].signature).toContain("Result");

    // chunks include trimmed body
    for (const c of [...funcs, ...ifaces]) {
      expect(c.body.length).toBeGreaterThan(0);
      expect(c.body.length).toBeLessThanOrEqual(512);
    }
  });


});
