import { describe, test, expect, beforeAll } from "bun:test";
import { buildGraph, type GraphMap } from "../src/lib/graph";
import { createProject, extractSymbols, getImports } from "../src/lib/ts-service";
import type { ProjectConfig } from "../src/types";
import { resolve } from "path";

const FIXTURE = resolve("test/fixtures/tiny-project");
const configs: ProjectConfig[] = [{ name: "tiny", tsconfig: resolve(FIXTURE, "tsconfig.json") }];

let graph: GraphMap;

beforeAll(() => {
  const project = createProject(configs);
  const sfToSymbols = new Map();
  const sfToImports = new Map();
  for (const sf of project.getSourceFiles()) {
    sfToSymbols.set(sf.getFilePath(), extractSymbols(sf));
    sfToImports.set(sf.getFilePath(), getImports(sf));
  }
  graph = buildGraph(configs, sfToSymbols, sfToImports);
});

describe("buildGraph", () => {
  test("builds correct import/export graph with degrees and project names", () => {
    expect(graph.size).toBeGreaterThanOrEqual(3);

    const mathFile = [...graph.keys()].find(k => k.endsWith("math.ts"))!;
    const mathNode = graph.get(mathFile)!;
    expect(mathNode.exports).toContain("add");
    expect(mathNode.exports).toContain("multiply");
    expect(mathNode.inDegree).toBeGreaterThanOrEqual(1); // imported by index.ts

    const indexFile = [...graph.keys()].find(k => k.endsWith("index.ts"))!;
    const indexNode = graph.get(indexFile)!;
    expect(indexNode.imports.size).toBeGreaterThanOrEqual(1);
    expect(indexNode.outDegree).toBeGreaterThanOrEqual(2); // imports math.ts + types.ts

    // Check import symbols
    const mathImport = [...indexNode.imports.entries()].find(([, symbols]) => symbols.includes("add"));
    expect(mathImport).toBeDefined();
  });

  test("assigns project name to every node", () => {
    for (const [, node] of graph) {
      expect(node.project).toBe("tiny");
    }
  });
});
