import type { GraphNode, ProjectConfig } from "../types";
import type { ExtractedSymbol, ImportEdge } from "./ts-service";
import { dirname } from "path";

export type GraphMap = Map<string, GraphNode>;

/**
 * Build an import graph from extracted symbols and import edges.
 * Keys are absolute file paths.
 */
export function buildGraph(
  configs: ProjectConfig[],
  sfToSymbols: Map<string, ExtractedSymbol[]>,
  sfToImports: Map<string, ImportEdge[]>
): GraphMap {
  const graph: GraphMap = new Map();

  // Map file → project name based on tsconfig directory
  const fileToProject = new Map<string, string>();

  for (const cfg of configs) {
    const projectRoot = dirname(cfg.tsconfig);
    for (const [filePath] of sfToSymbols) {
      if (filePath.startsWith(projectRoot)) {
        fileToProject.set(filePath, cfg.name);
      }
    }
  }

  // Create nodes
  for (const [filePath, syms] of sfToSymbols) {
    const imports = sfToImports.get(filePath) ?? [];
    const project = fileToProject.get(filePath) ?? "unknown";

    const importMap = new Map<string, string[]>();
    for (const edge of imports) {
      const targetProj = fileToProject.get(edge.targetFile);
      const existing = importMap.get(edge.targetFile);
      if (existing) {
        for (const name of edge.importedNames) {
          if (!existing.includes(name)) existing.push(name);
        }
      } else {
        importMap.set(edge.targetFile, [...edge.importedNames]);
      }
    }

    const node: GraphNode = {
      file: filePath,
      project,
      exports: syms.filter(s => s.exported).map(s => s.name),
      imports: importMap,
      inDegree: 0,  // computed below
      outDegree: importMap.size,
      crossProjectEdges: false, // computed below
    };

    graph.set(filePath, node);
  }

  // Compute inDegree and crossProjectEdges
  for (const [, node] of graph) {
    for (const [targetPath] of node.imports) {
      const target = graph.get(targetPath);
      if (target) {
        target.inDegree++;
        if (target.project !== node.project) {
          target.crossProjectEdges = true;
          node.crossProjectEdges = true;
        }
      }
    }
  }

  return graph;
}
