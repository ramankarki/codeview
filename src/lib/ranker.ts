import type { GraphNode, GraphWalkConfig } from "../types";

/**
 * Cold start ranking: out-degree bootstrap formula.
 * weight(inDegree=0.7, outDegree=0.3) + file bonus
 */
export function coldStartRank(file: string, inDegree: number, outDegree: number): number {
  let rank = 0.7 * inDegree + 0.3 * outDegree;
  const basename = file.split("/").pop() ?? "";

  // Entry-point bonus
  const bonusFiles = ["index.ts", "main.ts", "app.ts"];
  if (bonusFiles.includes(basename)) {
    rank += 0.1;
  }

  return rank;
}

/**
 * True if graph is small enough to return full map uncompressed.
 */
export function shouldCompress(graph: Map<string, GraphNode>): boolean {
  let totalEdges = 0;
  for (const [, node] of graph) {
    totalEdges += node.imports.size;
  }
  return totalEdges >= 100;
}

export interface RankedFile {
  file: string;
  node: GraphNode;
  rank: number;
}

/**
 * Rank files by cold-start formula (no PageRank convergence needed for small graph).
 * Returns sorted array DESC by rank.
 */
export function rankFiles(graph: Map<string, GraphNode>): RankedFile[] {
  const ranked: RankedFile[] = [];

  for (const [file, node] of graph) {
    const rank = coldStartRank(file, node.inDegree, node.outDegree);
    ranked.push({ file, node, rank });
  }

  ranked.sort((a, b) => b.rank - a.rank);
  return ranked;
}
