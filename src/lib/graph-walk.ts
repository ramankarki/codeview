import type { ChunkResult, GraphNode, GraphWalkConfig } from "../types";
import type { GraphMap } from "./graph";

/**
 * Budgeted graph walk augmentation.
 * For each seed chunk, follow imports (outgoing) and dependents (incoming).
 * Stops when token budget is exhausted.
 */
export function graphWalk(
  seeds: ChunkResult[],
  graph: GraphMap,
  config: GraphWalkConfig
): ChunkResult[] {
  const { maxDepth, maxNeighborsPerNode, maxAugmentationTokens } = config;

  if (maxAugmentationTokens <= 0 || maxDepth <= 0) return [];

  const results: ChunkResult[] = [];
  const seen = new Set(seeds.map(s => s.file));
  let tokenBudget = maxAugmentationTokens;

  for (const seed of seeds) {
    if (tokenBudget <= 0) break;

    const node = graph.get(seed.file);
    if (!node) continue;

    // Follow imports (outgoing edges)
    const importEntries = [...node.imports.entries()];
    importEntries.sort((a, b) => {
      const nodeA = graph.get(a[0]);
      const nodeB = graph.get(b[0]);
      return (nodeB?.inDegree ?? 0) - (nodeA?.inDegree ?? 0);
    });

    for (const [targetFile, importedNames] of importEntries.slice(0, maxNeighborsPerNode)) {
      if (seen.has(targetFile)) continue;
      if (tokenBudget <= 0) break;
      seen.add(targetFile);

      results.push({
        hash: "",
        file: targetFile,
        startLine: 0,
        endLine: 0,
        signature: `imported by ${seed.file} (${importedNames.join(", ")})`,
        kind: "import",
      });
      tokenBudget -= estimateTokens(targetFile);
    }

    // Follow dependents (incoming — who imports this node)
    const dependents: string[] = [];
    for (const [filePath, otherNode] of graph) {
      if (otherNode.imports.has(node.file)) {
        dependents.push(filePath);
      }
    }
    dependents.sort((a, b) => {
      const nodeA = graph.get(a);
      const nodeB = graph.get(b);
      return (nodeB?.inDegree ?? 0) - (nodeA?.inDegree ?? 0);
    });

    for (const depFile of dependents.slice(0, maxNeighborsPerNode)) {
      if (seen.has(depFile)) continue;
      if (tokenBudget <= 0) break;
      seen.add(depFile);

      results.push({
        hash: "",
        file: depFile,
        startLine: 0,
        endLine: 0,
        signature: `imports ${seed.file}`,
        kind: "dependent",
      });
      tokenBudget -= estimateTokens(depFile);
    }
  }

  return results;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
