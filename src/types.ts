// Shared types for codeview
// See CODEVIEW_SPEC.md §6.1, §7.2, §8.2, §9.2

// === Config ===

export interface ProjectConfig {
  name: string;      // display name for grouped output
  tsconfig: string;  // path to tsconfig.json
}

export interface GraphWalkConfig {
  maxDepth: number;              // default 1: direct neighbors only
  maxNeighborsPerNode: number;   // default 5: top N by PageRank
  maxAugmentationTokens: number; // default 2000: hard cap
}

export interface EmbeddingConfig {
  provider: "ollama" | "openai" | "voyage";
  apiKey?: string;
  model?: string;
  ollamaUrl?: string;  // default http://localhost:11434
}

export interface CodeviewConfig {
  projects?: ProjectConfig[];
  exclude?: string[];
  embedding?: EmbeddingConfig;
  port?: number;
  tokenBudget?: number;     // repo map compression target, default 5000
  graphWalk?: GraphWalkConfig;
}

// === Chunk ===

export type ChunkKind = "function" | "class" | "interface" | "type" | "enum" | "file";

export interface Chunk {
  id: number;           // autoincrement = vec0 rowid
  hash: string;         // SHA256(file + ":" + startLine + ":" + endLine).slice(0,16)
  file: string;
  startLine: number;
  endLine: number;
  kind: ChunkKind;
  signature: string;    // compact one-liner
  body: string;         // full code (first 512 chars)
  doc: string;          // JSDoc comment
  imports: string[];    // what this chunk imports
  exported: boolean;
  embedding?: Float32Array;  // vector (stored in vec0)
  stale: boolean;       // needs re-embedding?
}

// === Graph ===

export interface GraphNode {
  file: string;
  project: string;        // project name for monorepo grouping
  exports: string[];      // exported symbol names
  imports: Map<string, string[]>;  // source file → imported symbols
  inDegree: number;
  outDegree: number;
  crossProjectEdges: boolean;
}

// === API Responses ===

export interface ChunkResult {
  hash: string;
  file: string;
  startLine: number;
  endLine: number;
  signature: string;
  kind: string;
  distance?: number;  // only for semantic results
}

export interface SymbolResult {
  name: string;
  kind: string;
  file: string;
  line: number;
  signature: string;
}

export interface ReferenceResult {
  file: string;
  line: number;
  context: string;  // surrounding code snippet
}

export interface ContextResponse {
  repoMap: string;
  semantic: ChunkResult[];
  augmented: ChunkResult[];  // graph walk neighbors
  degraded: boolean;         // true if no embeddings, keyword-only fallback
}

// === Server State ===

export type EmbeddingProvider = "ollama" | "openai" | "voyage" | null;

export interface ServerState {
  projects: ProjectConfig[];  // monorepo project definitions
  model: EmbeddingProvider;
  lastBuild: number;          // timestamp of last index
  config: CodeviewConfig;
}
