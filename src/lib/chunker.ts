import type { Chunk, ChunkKind } from "../types";
import type { ExtractedSymbol } from "./ts-service";

export interface FileChunkInput {
  filePath: string;
  symbols: ExtractedSymbol[];
  sourceText: string;
}

/**
 * Compute stable chunk hash: SHA256(file + ":" + startLine + ":" + endLine).slice(0, 16)
 */
export function computeHash(file: string, startLine: number, endLine: number): string {
  const input = `${file}:${startLine}:${endLine}`;
  const hash = Bun.SHA256.hash(input, "hex") as string;
  return hash.slice(0, 16);
}

/**
 * Chop source text into body (first 512 chars max).
 */
function extractBody(sourceText: string, startLine: number, endLine: number): string {
  const lines = sourceText.split("\n");
  const bodyLines = lines.slice(startLine - 1, endLine);
  let body = bodyLines.join("\n");
  if (body.length > 512) {
    body = body.slice(0, 509) + "...";
  }
  return body;
}

/**
 * Split a file's AST symbols into chunks.
 * Each exported symbol = one chunk. Un-exported symbols bundled into file chunk.
 */
export function chunkFile(input: FileChunkInput): Chunk[] {
  const { filePath, symbols, sourceText } = input;
  const chunks: Chunk[] = [];
  let nextId = 0; // temporary; real IDs assigned by DB

  const exports = symbols.filter(s => s.exported);
  const internals = symbols.filter(s => !s.exported);

  // One chunk per exported symbol
  for (const sym of exports) {
    const body = extractBody(sourceText, sym.startLine, sym.endLine);
    const hash = computeHash(filePath, sym.startLine, sym.endLine);

    chunks.push({
      id: 0, // placeholder
      hash,
      file: filePath,
      startLine: sym.startLine,
      endLine: sym.endLine,
      kind: sym.kind,
      signature: sym.signature,
      body,
      doc: sym.doc,
      imports: [], // populated later from edges
      exported: true,
      stale: false,
    });
  }

  // One chunk per non-exported symbol (still indexed for internal search)
  for (const sym of internals) {
    const body = extractBody(sourceText, sym.startLine, sym.endLine);
    const hash = computeHash(filePath, sym.startLine, sym.endLine);

    chunks.push({
      id: 0,
      hash,
      file: filePath,
      startLine: sym.startLine,
      endLine: sym.endLine,
      kind: sym.kind,
      signature: sym.signature,
      body,
      doc: sym.doc,
      imports: [],
      exported: false,
      stale: false,
    });
  }

  return chunks;
}
