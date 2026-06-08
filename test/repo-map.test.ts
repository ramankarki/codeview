import { describe, test, expect } from "bun:test";
import { generateRepoMap } from "../src/lib/repo-map";
import { createProject, extractSymbols, getImports } from "../src/lib/ts-service";
import { buildGraph } from "../src/lib/graph";
import { rankFiles } from "../src/lib/ranker";
import type { ProjectConfig } from "../src/types";
import { resolve } from "path";

const FIXTURE = resolve("test/fixtures/tiny-project");
const configs: ProjectConfig[] = [{ name: "tiny", tsconfig: resolve(FIXTURE, "tsconfig.json") }];

function buildFixtureMap(tokenBudget = 5000): string {
  const project = createProject(configs);
  const sfToSymbols = new Map();
  const sfToImports = new Map();
  for (const sf of project.getSourceFiles()) {
    sfToSymbols.set(sf.getFilePath(), extractSymbols(sf));
    sfToImports.set(sf.getFilePath(), getImports(sf));
  }
  const graph = buildGraph(configs, sfToSymbols, sfToImports);
  const ranked = rankFiles(graph);
  return generateRepoMap(configs, graph, ranked, sfToSymbols, { tokenBudget });
}

describe("generateRepoMap", () => {
  test("includes type info in function signatures", () => {
    const map = buildFixtureMap();
    expect(map).toContain("add");
    expect(map).toContain("number"); // param types or return type
  });

  test("includes return type info", () => {
    const map = buildFixtureMap();
    // add and multiply both return number
    expect(map).toContain(": number");
  });

  test("shows 'imported by' information", () => {
    const map = buildFixtureMap();
    // math.ts is imported by index.ts
    expect(map).toContain("imported by");
  });

  test("groups output by project name", () => {
    const map = buildFixtureMap();
    expect(map).toContain("tiny");
  });

  test("includes file paths in output", () => {
    const map = buildFixtureMap();
    expect(map).toContain("math.ts");
    expect(map).toContain("types.ts");
  });

  test("header mentions repo map", () => {
    const map = buildFixtureMap();
    expect(map).toContain("Repo map");
  });
});
