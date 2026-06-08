import { describe, test, expect, beforeAll } from "bun:test";
import { createProject, extractSymbols, getImports, type ExtractedSymbol, type ImportEdge } from "../src/lib/ts-service";
import type { ProjectConfig } from "../src/types";
import { resolve } from "path";

const FIXTURE = resolve("test/fixtures/tiny-project");
const configs: ProjectConfig[] = [{ name: "tiny", tsconfig: resolve(FIXTURE, "tsconfig.json") }];

let symbols: Map<string, ExtractedSymbol[]>;
let imports: Map<string, ImportEdge[]>;

beforeAll(() => {
  const project = createProject(configs);
  const sourceFiles = project.getSourceFiles();

  symbols = new Map();
  imports = new Map();

  for (const sf of sourceFiles) {
    symbols.set(sf.getFilePath(), extractSymbols(sf));
    imports.set(sf.getFilePath(), getImports(sf));
  }
});

describe("createProject", () => {
  test("loads source files from tsconfig", () => {
    const project = createProject(configs);
    const files = project.getSourceFiles().map(sf => sf.getFilePath());
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.some(f => f.endsWith("math.ts"))).toBe(true);
    expect(files.some(f => f.endsWith("types.ts"))).toBe(true);
    expect(files.some(f => f.endsWith("index.ts"))).toBe(true);
  });
});

describe("extractSymbols", () => {
  test("extracts function with param types and return type", () => {
    const mathFile = [...symbols.keys()].find(k => k.endsWith("math.ts"))!;
    const syms = symbols.get(mathFile)!;

    const add = syms.find(s => s.name === "add");
    expect(add).toBeDefined();
    expect(add!.kind).toBe("function");
    expect(add!.signature).toContain("add");
    expect(add!.signature).toContain("number"); // param or return type
    expect(add!.exported).toBe(true);

    const multiply = syms.find(s => s.name === "multiply");
    expect(multiply).toBeDefined();
    expect(multiply!.kind).toBe("function");
  });

  test("extracts interface with fields", () => {
    const typesFile = [...symbols.keys()].find(k => k.endsWith("types.ts"))!;
    const syms = symbols.get(typesFile)!;

    const result = syms.find(s => s.name === "Result");
    expect(result).toBeDefined();
    expect(result!.kind).toBe("interface");
    expect(result!.signature).toContain("success");
    expect(result!.signature).toContain("value");
  });

  test("includes JSDoc in extracted symbol", () => {
    const mathFile = [...symbols.keys()].find(k => k.endsWith("math.ts"))!;
    const syms = symbols.get(mathFile)!;

    const add = syms.find(s => s.name === "add");
    expect(add).toBeDefined();
    expect(add!.doc).toContain("Adds two numbers");
  });

  test("includes line numbers", () => {
    const mathFile = [...symbols.keys()].find(k => k.endsWith("math.ts"))!;
    const syms = symbols.get(mathFile)!;

    for (const s of syms) {
      expect(s.startLine).toBeGreaterThan(0);
      expect(s.endLine).toBeGreaterThanOrEqual(s.startLine);
    }
  });
});

describe("getImports", () => {
  test("tracks imports from index.ts to math.ts and types.ts", () => {
    const indexFile = [...imports.keys()].find(k => k.endsWith("index.ts"))!;
    const edges = imports.get(indexFile)!;

    // index.ts imports from math.ts and types.ts
    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(edges.some(e => e.targetFile.endsWith("math.ts"))).toBe(true);
    expect(edges.some(e => e.targetFile.endsWith("types.ts"))).toBe(true);
  });
});
