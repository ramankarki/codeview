import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import type { Chunk } from "./types";
import { existsSync } from "fs";

let db: Database | null = null;
let vecLoaded = false;
let currentDim: number | null = null;
let embeddingTableName: string | null = null;

// macOS: use Brew SQLite for extension loading support
const BREW_SQLITE_ARM = "/opt/homebrew/opt/sqlite3/lib/libsqlite3.dylib";
const BREW_SQLITE_X86 = "/usr/local/opt/sqlite3/lib/libsqlite3.dylib";

function detectBrewSqlite(): string | null {
  if (existsSync(BREW_SQLITE_ARM)) return BREW_SQLITE_ARM;
  if (existsSync(BREW_SQLITE_X86)) return BREW_SQLITE_X86;
  return null;
}

export function getDb(dbPath: string = ":memory:"): Database {
  if (!db) {
    const brewLib = detectBrewSqlite();
    if (brewLib) {
      try {
        Database.setCustomSQLite(brewLib);
      } catch {}
    }

    db = new Database(dbPath);
    db.exec("PRAGMA journal_mode=WAL");

    // Load sqlite-vec (try, but don't fail if unsupported)
    try {
      sqliteVec.load(db);
      vecLoaded = true;
    } catch {
      vecLoaded = false;
    }

    initSchema(db);
  }
  return db;
}

export function isVecLoaded(): boolean {
  return vecLoaded;
}

export function resetDb(dbPath: string = ":memory:"): Database {
  closeDb();
  return getDb(dbPath);
}

function initSchema(d: Database): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT UNIQUE NOT NULL,
      file TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      kind TEXT NOT NULL,
      signature TEXT,
      body TEXT,
      doc TEXT,
      imports TEXT DEFAULT '[]',
      exported INTEGER DEFAULT 0,
      centrality REAL DEFAULT 0.0,
      stale INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS chunk_edges (
      source_id INTEGER NOT NULL REFERENCES chunks(id),
      target_id INTEGER NOT NULL REFERENCES chunks(id),
      kind TEXT NOT NULL DEFAULT 'import',
      cross_project INTEGER DEFAULT 0,
      PRIMARY KEY (source_id, target_id)
    );

    CREATE TABLE IF NOT EXISTS repo_map_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      text TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    vecLoaded = false;
    currentDim = null;
    embeddingTableName = null;
  }
}

// === Chunk operations ===

export function insertChunk(chunk: Chunk): number {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO chunks (hash, file, start_line, end_line, kind, signature, body, doc, imports, exported, stale)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    ON CONFLICT(hash) DO UPDATE SET
      file=excluded.file, start_line=excluded.start_line, end_line=excluded.end_line,
      kind=excluded.kind, signature=excluded.signature, body=excluded.body,
      doc=excluded.doc, imports=excluded.imports, exported=excluded.exported, stale=0
  `);
  const result = stmt.run(
    chunk.hash, chunk.file, chunk.startLine, chunk.endLine,
    chunk.kind, chunk.signature, chunk.body, chunk.doc,
    JSON.stringify(chunk.imports), chunk.exported ? 1 : 0, chunk.stale ? 1 : 0
  );
  return Number(result.lastInsertRowid);
}

export function getAllChunks(): (Chunk & { id: number })[] {
  const d = getDb();
  const rows = d.prepare("SELECT * FROM chunks").all() as any[];
  return rows.map(r => ({
    id: r.id,
    hash: r.hash,
    file: r.file,
    startLine: r.start_line,
    endLine: r.end_line,
    kind: r.kind,
    signature: r.signature ?? "",
    body: r.body ?? "",
    doc: r.doc ?? "",
    imports: JSON.parse(r.imports || "[]"),
    exported: r.exported === 1,
    stale: r.stale === 1,
  }));
}

export function getChunkCount(): number {
  const d = getDb();
  const row = d.prepare("SELECT COUNT(*) as count FROM chunks").get() as { count: number };
  return row.count;
}

export function getChunksByFile(file: string): (Chunk & { id: number })[] {
  const d = getDb();
  const rows = d.prepare("SELECT * FROM chunks WHERE file = ?").all(file) as any[];
  return rows.map(r => ({
    id: r.id,
    hash: r.hash,
    file: r.file,
    startLine: r.start_line,
    endLine: r.end_line,
    kind: r.kind,
    signature: r.signature ?? "",
    body: r.body ?? "",
    doc: r.doc ?? "",
    imports: JSON.parse(r.imports || "[]"),
    exported: r.exported === 1,
    stale: r.stale === 1,
  }));
}

export function markStale(file: string): void {
  const d = getDb();
  d.prepare("UPDATE chunks SET stale = 1 WHERE file = ?").run(file);
}

export function getStaleChunks(): (Chunk & { id: number })[] {
  const d = getDb();
  const rows = d.prepare("SELECT * FROM chunks WHERE stale = 1").all() as any[];
  return rows.map(r => ({
    id: r.id,
    hash: r.hash,
    file: r.file,
    startLine: r.start_line,
    endLine: r.end_line,
    kind: r.kind,
    signature: r.signature ?? "",
    body: r.body ?? "",
    doc: r.doc ?? "",
    imports: JSON.parse(r.imports || "[]"),
    exported: r.exported === 1,
    stale: r.stale === 1,
  }));
}

export function deleteOrphanChunks(existingFiles: Set<string>): number {
  const d = getDb();
  const allFiles = d.prepare("SELECT DISTINCT file FROM chunks").all() as { file: string }[];
  let deleted = 0;

  for (const { file } of allFiles) {
    if (!existingFiles.has(file)) {
      d.prepare("DELETE FROM chunks WHERE file = ?").run(file);
      deleted++;
    }
  }

  return deleted;
}

// === Cache operations ===

export function getCachedRepoMap(): { text: string; tokenCount: number } | null {
  const d = getDb();
  const row = d.prepare("SELECT text, token_count FROM repo_map_cache WHERE id = 1").get() as
    | { text: string; token_count: number }
    | undefined;
  return row ? { text: row.text, tokenCount: row.token_count } : null;
}

export function setCachedRepoMap(text: string, tokenCount: number): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO repo_map_cache (id, text, token_count, updated_at) VALUES (1, ?1, ?2, ?3)
    ON CONFLICT(id) DO UPDATE SET text=excluded.text, token_count=excluded.token_count, updated_at=excluded.updated_at
  `).run(text, tokenCount, Date.now());
}

// === Embedding operations (sqlite-vec) ===

export function ensureEmbeddingTable(dim: number): string {
  const d = getDb();
  const tableName = `chunk_embeddings_${dim}d`;

  if (currentDim && currentDim !== dim) {
    // Dimension changed — old table stays, new one created
    console.warn(`Embedding dimension changed (${currentDim} → ${dim}). Run 'codeview rebuild' to re-embed.`);
  }

  d.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING vec0(embedding float[${dim}])`);
  currentDim = dim;
  embeddingTableName = tableName;

  return tableName;
}

export function insertEmbedding(chunkId: number, embedding: Float32Array, dim: number): void {
  const d = getDb();
  const tableName = embeddingTableName ?? ensureEmbeddingTable(dim);

  // Delete existing embedding for this chunk
  d.prepare(`DELETE FROM ${tableName} WHERE rowid = ?`).run(chunkId);

  // Insert
  d.prepare(`INSERT INTO ${tableName}(rowid, embedding) VALUES (?, vec_f32(?))`).run(
    chunkId,
    embedding
  );
}

export function searchSimilar(
  queryVector: Float32Array,
  dim: number,
  topK: number = 10
): Array<{
  hash: string;
  file: string;
  signature: string;
  kind: string;
  startLine: number;
  endLine: number;
  rowid: number;
  distance: number;
}> {
  const d = getDb();
  const tableName = embeddingTableName ?? ensureEmbeddingTable(dim);

  const results = d.prepare(`
    SELECT
      c.hash, c.file, c.signature, c.kind,
      c.start_line, c.end_line,
      v.rowid, v.distance
    FROM ${tableName} v
    JOIN chunks c ON c.id = v.rowid
    WHERE v.embedding MATCH ? AND k = ?
    ORDER BY v.distance
  `).all(queryVector, topK) as any[];

  return results.map(r => ({
    hash: r.hash,
    file: r.file,
    signature: r.signature ?? "",
    kind: r.kind,
    startLine: r.start_line,
    endLine: r.end_line,
    rowid: r.rowid,
    distance: r.distance,
  }));
}
