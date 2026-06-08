import { describe, test, expect } from "bun:test";
import { buildGraph, type GraphMap } from "../src/lib/graph";
import { createProject, extractSymbols, getImports } from "../src/lib/ts-service";
import type { ProjectConfig } from "../src/types";
import { resolve } from "path";

const FIXTURE = resolve("test/fixtures/tiny-project");
const configs: ProjectConfig[] = [{ name: "tiny", tsconfig: resolve(FIXTURE, "tsconfig.json") }];

function buildFixtureGraph(): GraphMap {
  const project = createProject(configs);
  const sfToSymbols = new Map();
  const sfToImports = new Map();
  for (const sf of project.getSourceFiles()) {
    sfToSymbols.set(sf.getFilePath(), extractSymbols(sf));
    sfToImports.set(sf.getFilePath(), getImports(sf));
  }
  return buildGraph(configs, sfToSymbols, sfToImports);
}

describe("buildGraph", () => {
  test("creates a node for each source file", () => {
    const graph = buildFixtureGraph();
    expect(graph.size).toBeGreaterThanOrEqual(3);
  });

  test("tracks exports per file", () => {
    const graph = buildFixtureGraph();
    const mathFile = [...graph.keys()].find(k => k.endsWith("math.ts"))!;
    const node = graph.get(mathFile)!;
    expect(node.exports).toContain("add");
    expect(node.exports).toContain("multiply");
    expect(node.exports.length).toBeGreaterThanOrEqual(2);
  });

  test("tracks imports per file with named symbols", () => {
    const graph = buildFixtureGraph();
    const indexFile = [...graph.keys()].find(k => k.endsWith("index.ts"))!;
    const node = graph.get(indexFile)!;
    expect(node.imports.size).toBeGreaterThanOrEqual(1);

    // find math.ts import
    const mathImport = [...node.imports.entries()].find(
      ([, symbols]) => symbols.includes("add")
    );
    expect(mathImport).toBeDefined();
  });

  test("sets correct inDegree from import graph", () => {
    const graph = buildFixtureGraph();
    const mathFile = [...graph.keys()].find(k => k.endsWith("math.ts"))!;
    const node = graph.get(mathFile)!;
    // index.ts imports from math.ts, so math.ts inDegree ≥ 1
    expect(node.inDegree).toBeGreaterThanOrEqual(1);
  });

  test("sets correct outDegree from import graph", () => {
    const graph = buildFixtureGraph();
    const indexFile = [...graph.keys()].find(k => k.endsWith("index.ts"))!;
    const node = graph.get(indexFile)!;
    // index.ts imports from math.ts + types.ts → outDegree ≥ 2
    expect(node.outDegree).toBeGreaterThanOrEqual(2);
  });

  test("assigns project name to nodes", () => {
    const graph = buildFixtureGraph();
    for (const [, node] of graph) {
      expect(node.project).toBe("tiny");
    }
  });
});
