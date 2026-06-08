import { describe, test, expect } from "bun:test";
import { rankFiles, shouldCompress, coldStartRank } from "../src/lib/ranker";
import type { GraphNode } from "../src/types";

function makeNode(
  file: string,
  imports: [string, string[]][] = [],
  exports: string[] = [],
  overrides: Partial<GraphNode> = {}
): GraphNode {
  const importMap = new Map(imports);
  return {
    file,
    project: "test",
    exports,
    imports: importMap,
    inDegree: 0,
    outDegree: importMap.size,
    crossProjectEdges: false,
    ...overrides,
  };
}

describe("coldStartRank", () => {
  test("index.ts gets bonus points", () => {
    expect(coldStartRank("src/index.ts", 5, 2)).toBeGreaterThan(
      coldStartRank("src/utils/helpers.ts", 5, 2)
    );
  });

  test("main.ts gets bonus points", () => {
    expect(coldStartRank("src/main.ts", 3, 1)).toBeGreaterThan(
      coldStartRank("src/lib/random.ts", 3, 1)
    );
  });

  test("higher inDegree increases rank", () => {
    expect(coldStartRank("src/a.ts", 10, 2)).toBeGreaterThan(
      coldStartRank("src/b.ts", 2, 2)
    );
  });
});

describe("shouldCompress", () => {
  test("returns false when total edges < 100", () => {
    const graph = new Map<string, GraphNode>();
    graph.set("a.ts", makeNode("a.ts", [["b.ts", ["foo"]]]));
    graph.set("b.ts", makeNode("b.ts"));
    // Set inDegree manually
    graph.get("b.ts")!.inDegree = 1;
    expect(shouldCompress(graph)).toBe(false);
  });
});

describe("rankFiles", () => {
  test("returns all files sorted by rank DESC", () => {
    const graph = new Map<string, GraphNode>();
    const a = makeNode("a.ts", [], ["exportA"]);
    const b = makeNode("b.ts", [["a.ts", ["exportA"]]], ["exportB"]);
    graph.set("a.ts", a);
    graph.set("b.ts", b);
    // Compute inDegree
    a.inDegree = 1; // imported by b
    b.inDegree = 0;

    const ranked = rankFiles(graph);
    expect(ranked.length).toBe(2);
    // a has higher inDegree (1 > 0), so a should rank higher
    expect(ranked[0].file).toBe("a.ts");
  });

  test("file with more imports ranks above file with fewer imports (equal inDegree)", () => {
    const graph = new Map<string, GraphNode>();
    const popular = makeNode("popular.ts");
    popular.inDegree = 5;
    const unpopular = makeNode("unpopular.ts");
    unpopular.inDegree = 1;

    graph.set("popular.ts", popular);
    graph.set("unpopular.ts", unpopular);

    const ranked = rankFiles(graph);
    expect(ranked[0].file).toBe("popular.ts");
  });
});
