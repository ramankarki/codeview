import { describe, test, expect } from "bun:test";
import { createProject, extractSymbols, getImports } from "../src/lib/ts-service";
import { buildGraph } from "../src/lib/graph";
import { rankFiles } from "../src/lib/ranker";
import { generateRepoMap } from "../src/lib/repo-map";
import type { ProjectConfig } from "../src/types";
import { resolve } from "path";

const FIXTURE = resolve("test/fixtures/monorepo-project");
const configs: ProjectConfig[] = [
  { name: "app", tsconfig: resolve(FIXTURE, "packages/app/tsconfig.json") },
  { name: "shared", tsconfig: resolve(FIXTURE, "packages/shared/tsconfig.json") },
];

describe("monorepo: cross-project edges", () => {
  test("loads source files from both packages", () => {
    const project = createProject(configs);
    const files = project.getSourceFiles().map(sf => sf.getFilePath());
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.some(f => f.includes("app/src/index.ts"))).toBe(true);
    expect(files.some(f => f.includes("shared/src/index.ts"))).toBe(true);
  });

  test("tracks cross-project imports in graph", () => {
    const project = createProject(configs);
    const sfToSymbols = new Map();
    const sfToImports = new Map();
    for (const sf of project.getSourceFiles()) {
      sfToSymbols.set(sf.getFilePath(), extractSymbols(sf));
      sfToImports.set(sf.getFilePath(), getImports(sf));
    }
    const graph = buildGraph(configs, sfToSymbols, sfToImports);

    // app imports from shared — cross-project edge
    const appFile = [...graph.keys()].find(k => k.includes("app/src/index.ts"))!;
    const appNode = graph.get(appFile)!;
    expect(appNode.imports.size).toBeGreaterThanOrEqual(1);

    // Check cross-project flag
    let hasCrossProject = false;
    for (const [targetPath] of appNode.imports) {
      const target = graph.get(targetPath);
      if (target && target.project !== appNode.project) {
        hasCrossProject = true;
        expect(target.crossProjectEdges).toBe(true);
      }
    }
    expect(hasCrossProject).toBe(true);
  });

  test("repo map groups output by project", () => {
    const project = createProject(configs);
    const sfToSymbols = new Map();
    const sfToImports = new Map();
    for (const sf of project.getSourceFiles()) {
      sfToSymbols.set(sf.getFilePath(), extractSymbols(sf));
      sfToImports.set(sf.getFilePath(), getImports(sf));
    }
    const graph = buildGraph(configs, sfToSymbols, sfToImports);
    const ranked = rankFiles(graph);
    const map = generateRepoMap(configs, graph, ranked, sfToSymbols, { tokenBudget: 5000 });

    expect(map).toContain("### app");
    expect(map).toContain("### shared");
    expect(map).toContain("ApiResponse");
    expect(map).toContain("createUser");
    expect(map).toContain("formatError");
  });

  test("cross-project imports appear in 'imported by'", () => {
    const project = createProject(configs);
    const sfToSymbols = new Map();
    const sfToImports = new Map();
    for (const sf of project.getSourceFiles()) {
      sfToSymbols.set(sf.getFilePath(), extractSymbols(sf));
      sfToImports.set(sf.getFilePath(), getImports(sf));
    }
    const graph = buildGraph(configs, sfToSymbols, sfToImports);

    // shared should be imported by app
    const sharedFile = [...graph.keys()].find(k => k.includes("shared/src/index.ts"))!;
    const sharedNode = graph.get(sharedFile)!;
    expect(sharedNode.inDegree).toBeGreaterThanOrEqual(1);
  });
});
