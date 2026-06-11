import { describe, test, expect, beforeAll } from "bun:test";
import { createProject, extractSymbols, getImports } from "../src/lib/ts-service";
import { buildGraph } from "../src/lib/graph";
import { rankFiles } from "../src/lib/ranker";
import { generateRepoMap } from "../src/lib/repo-map";
import type { ProjectConfig, GraphMap } from "../src/types";
import { resolve } from "path";

const FIXTURE = resolve("test/fixtures/monorepo-project");
const configs: ProjectConfig[] = [
  { name: "app", tsconfig: resolve(FIXTURE, "packages/app/tsconfig.json") },
  { name: "shared", tsconfig: resolve(FIXTURE, "packages/shared/tsconfig.json") },
];

let graph: GraphMap;
let repoMap: string;

beforeAll(() => {
  const project = createProject(configs);
  const sfToSymbols = new Map();
  const sfToImports = new Map();
  for (const sf of project.getSourceFiles()) {
    sfToSymbols.set(sf.getFilePath(), extractSymbols(sf));
    sfToImports.set(sf.getFilePath(), getImports(sf));
  }
  graph = buildGraph(configs, sfToSymbols, sfToImports);
  const ranked = rankFiles(graph);
  repoMap = generateRepoMap(configs, graph, ranked, sfToSymbols, { tokenBudget: 5000 });
});

describe("monorepo: cross-project edges", () => {
  test("tracks cross-project imports and inDegree in graph", () => {
    const appFile = [...graph.keys()].find(k => k.includes("app/src/index.ts"))!;
    const appNode = graph.get(appFile)!;
    expect(appNode.imports.size).toBeGreaterThanOrEqual(1);

    let hasCrossProject = false;
    for (const [targetPath] of appNode.imports) {
      const target = graph.get(targetPath);
      if (target && target.project !== appNode.project) {
        hasCrossProject = true;
        expect(target.crossProjectEdges).toBe(true);
      }
    }
    expect(hasCrossProject).toBe(true);

    // shared should be imported by app
    const sharedFile = [...graph.keys()].find(k => k.includes("shared/src/index.ts"))!;
    expect(graph.get(sharedFile)!.inDegree).toBeGreaterThanOrEqual(1);
  });

  test("repo map groups by project and shows cross-project symbols", () => {
    expect(repoMap).toContain("### app");
    expect(repoMap).toContain("### shared");
    expect(repoMap).toContain("ApiResponse");
    expect(repoMap).toContain("createUser");
    expect(repoMap).toContain("formatError");
  });
});
