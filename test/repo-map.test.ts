import { describe, test, expect, beforeAll } from "bun:test";
import { generateRepoMap } from "../src/lib/repo-map";
import { createProject, extractSymbols, getImports } from "../src/lib/ts-service";
import { buildGraph } from "../src/lib/graph";
import { rankFiles } from "../src/lib/ranker";
import type { ProjectConfig } from "../src/types";
import { resolve } from "path";

const FIXTURE = resolve("test/fixtures/tiny-project");
const configs: ProjectConfig[] = [{ name: "tiny", tsconfig: resolve(FIXTURE, "tsconfig.json") }];

let fullMap: string;

beforeAll(() => {
  const project = createProject(configs);
  const sfToSymbols = new Map();
  const sfToImports = new Map();
  for (const sf of project.getSourceFiles()) {
    sfToSymbols.set(sf.getFilePath(), extractSymbols(sf));
    sfToImports.set(sf.getFilePath(), getImports(sf));
  }
  const graph = buildGraph(configs, sfToSymbols, sfToImports);
  const ranked = rankFiles(graph);
  fullMap = generateRepoMap(configs, graph, ranked, sfToSymbols, { tokenBudget: 5000 });
});

describe("generateRepoMap", () => {
  test("produces well-formed output with types, imports, file paths, and project grouping", () => {
    expect(fullMap).toContain("Repo map");
    expect(fullMap).toContain("tiny");
    expect(fullMap).toContain("math.ts");
    expect(fullMap).toContain("types.ts");
    expect(fullMap).toContain("add");
    expect(fullMap).toContain(": number"); // return type
    expect(fullMap).toContain("imported by");
  });
});
