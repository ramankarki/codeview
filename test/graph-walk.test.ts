import { describe, test, expect } from "bun:test";
import { graphWalk } from "../src/lib/graph-walk";
import type { GraphNode, GraphWalkConfig, ChunkResult } from "../src/types";

function makeNode(overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    file: "src/test.ts",
    project: "test",
    exports: ["fn"],
    imports: new Map(),
    inDegree: 0,
    outDegree: 0,
    crossProjectEdges: false,
    ...overrides,
  };
}

describe("graphWalk", () => {
  test("returns neighbors within depth=1 budget", () => {
    const graph = new Map<string, GraphNode>();
    const a = makeNode({ file: "a.ts", imports: new Map([["b.ts", ["fnB"]]]) });
    const b = makeNode({ file: "b.ts" });
    const c = makeNode({ file: "c.ts", imports: new Map([["a.ts", ["fnA"]]]) });

    graph.set("a.ts", a);
    graph.set("b.ts", b);
    graph.set("c.ts", c);

    // Build chunk results pointing to a.ts
    const seeds: ChunkResult[] = [
      { hash: "h1", file: "a.ts", startLine: 1, endLine: 5, signature: "fnA", kind: "function" },
    ];

    const config: GraphWalkConfig = {
      maxDepth: 1,
      maxNeighborsPerNode: 5,
      maxAugmentationTokens: 2000,
    };

    const result = graphWalk(seeds, graph, config);
    // Should find b.ts (imported by a) and c.ts (imports a)
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  test("enforces maxNeighborsPerNode", () => {
    const graph = new Map<string, GraphNode>();
    const imports = new Map<string, string[]>();
    for (let i = 0; i < 10; i++) {
      imports.set(`mod${i}.ts`, [`fn${i}`]);
    }
    const a = makeNode({ file: "a.ts", imports });
    graph.set("a.ts", a);
    for (let i = 0; i < 10; i++) {
      graph.set(`mod${i}.ts`, makeNode({ file: `mod${i}.ts` }));
    }

    const seeds: ChunkResult[] = [
      { hash: "h1", file: "a.ts", startLine: 1, endLine: 5, signature: "fnA", kind: "function" },
    ];

    const config: GraphWalkConfig = {
      maxDepth: 1,
      maxNeighborsPerNode: 2,
      maxAugmentationTokens: 2000,
    };

    const result = graphWalk(seeds, graph, config);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  test("returns empty when budget is 0", () => {
    const graph = new Map<string, GraphNode>();
    graph.set("a.ts", makeNode({ file: "a.ts" }));

    const seeds: ChunkResult[] = [
      { hash: "h1", file: "a.ts", startLine: 1, endLine: 5, signature: "fnA", kind: "function" },
    ];

    const config: GraphWalkConfig = {
      maxDepth: 1,
      maxNeighborsPerNode: 5,
      maxAugmentationTokens: 0,
    };

    const result = graphWalk(seeds, graph, config);
    expect(result.length).toBe(0);
  });
});
