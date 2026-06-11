# codeview — Hybrid Codebase Intelligence for Coding Agents

> **Status:** Production — v1.1.0 (revised 2026-06-11)

> **Philosophy:** Build what neither Aider nor Cursor has — type-aware repo maps + local semantic search, pluggable into any agent.

---

## Table of Contents

1. [What is codeview?](#1-what-is-codeview)
2. [Architecture Overview](#2-architecture-overview)
3. [Developer Experience](#3-developer-experience)
4. [Monorepo Support](#4-monorepo-support)
5. [Repo Map (Structural)](#5-repo-map-structural)
6. [Embeddings (Semantic)](#6-embeddings-semantic)
7. [Hybrid Retrieval](#7-hybrid-retrieval)
8. [Agent Integration](#8-agent-integration)
9. [Data Model](#9-data-model)
10. [Build Phases](#10-build-phases)
11. [Comparison Matrix](#11-comparison-matrix)
12. [File Structure](#12-file-structure)
13. [Package & Build Config](#13-package--build-config)
14. [Testing Strategy](#14-testing-strategy)
15. [Production Infrastructure](#15-production-infrastructure)

---

## 1. What is codeview?

A **local codebase intelligence server** that gives coding agents two superpowers:

### Structural (Repo Map)
```
src/payment/processor.ts:
  export function processPayment(
    amount: number,
    currency: string
  ): Promise<PaymentResult>          ← TYPE INFO (Aider can't do this)
  [imported by: routes.ts, webhook.ts]

  export class StripeClient {
    createSession(options: SessionConfig): Session
    refund(chargeId: string): Refund
  }
  [imported by: routes.ts, admin.ts]
```

### Semantic (Embeddings)
```
$ codeview search "refund logic"
→ src/payment/processor.ts::StripeClient.refund
→ src/billing/refunds.ts::processRefund
→ src/api/routes.ts::POST /api/refund
```

### Hybrid — Both at Once
At task start, codeview auto-injects:
1. Structural map of relevant files
2. Semantic results matching task description
3. Import edges (who depends on what)

Agent starts with a map, not a blank screen.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                    Agent                         │
│  (Pi / Claude Code / Cline / custom)            │
└──────────┬──────────────────────────┬────────────┘
           │ HTTP/CLI                 │ auto-inject
           ▼                          ▼
┌──────────────────────┐   ┌──────────────────────┐
│  codeview server     │   │  Agent instructions   │
│  (Bun.serve)         │   │  (AGENTS.md)          │
│                      │   │  "call repo-map at    │
│  ┌───────────────┐   │   │   task start"         │
│  │ ts-morph AST  │   │   └──────────────────────┘
│  │ (warm in mem) │   │
│  └───────┬───────┘   │
│          ▼            │
│  ┌───────────────┐   │
│  │ Chunk Store   │   │
│  │ (SQLite)      │   │
│  │ - chunks      │   │
│  │ - embeddings  │   │
│  │ - edges       │   │
│  │ - stale marks │   │
│  └───────────────┘   │
│          │            │
│          ▼            │
│  ┌───────────────┐   │
│  │ Embedding     │   │
│  │ Engine        │   │
│  │ (Ollama prim.,│   │
│  │  API config.) │   │
│  └───────────────┘   │
└──────────────────────┘
```

### Key Design Decisions

| Decision | Why |
|---|---|
| **Server always runs** | ts-morph project stays warm. ~5s cold start, ~50ms queries |
| **ts-morph > tree-sitter** | Type info. We need `(cwd: string): Config` not just `loadConfig` |
| **Ollama primary** | No bundling issues. Works today. Zero config for LLM users. |
| **Remote API optional** | OpenAI/Voyage for users without local GPU |
| **Degraded mode** | Structural-only when no embedding engine. Still 10x better than blank. |
| **Two retrieval modes** | Structural for exact, semantic for fuzzy. Fuse results. |
| **Server split from agent** | Works with ANY agent via HTTP. Not tied to Pi. |
| **Bun only** | Speed. Bun.sqlite. Bun.serve. Bun.watch. |
| **Server per repo** | One server per repo. Kill + restart on switch. ~5s cold start. Keeps RAM bounded and avoids cross-repo contamination. |

### Degraded Mode

If no embedding engine is configured or reachable:
- `repo-map` works at full capacity (structural only)
- `search` returns keyword match on signatures (no semantic)
- `context` falls back to structural-only with keyword matching
- Server prints hint: `Install ollama: brew install ollama && ollama pull nomic-embed-text`
- Agent still gets a repo map → productive from task start

### 2.3 Server Lifecycle & Config Validation

**Server per repo.** One codeview server per repository. Kill + restart when switching repos. ~5s cold start. Keeps RAM bounded and avoids cross-repo contamination in embeddings.

**Startup validation:**
```typescript
// On server start
validateConfig(config: CodeviewConfig): ValidationResult {
  checks:
    - tsconfig paths exist (for each project in monorepo)
    - Root directory exists and has source files
    - Port not already in use
    - If ollama: ping http://localhost:11434 → warn if unreachable → degraded mode
    - If openai/voyage: apiKey is set (or $ENV_VAR resolves) → warn if missing
    - sqlite-vec extension loads successfully → error if not
}
```

**Validation failures:**
| Check | Action |
|---|---|
| tsconfig missing | Error. Exit with message pointing to config. |
| Port in use | Error. Exit with `Port {port} in use. Pick another port in cvconfig.json`. |
| Ollama unreachable | Warn. Enter degraded mode. Print setup hint. |
| API key missing | Warn if provider=openai/voyage. Enter degraded mode. |
| sqlite-vec fails | Error. Exit with install instructions. |

---

## 3. Developer Experience

### 3.1 Data Storage

```
my-project/
├── .codeview/
│   ├── codeview.db        # SQLite (chunks + vec0 embeddings + edges)
│   ├── port                # "8474" — agent reads this to find server
│   └── pid                 # process ID for health checks
├── cvconfig.json           # optional user config, at root for easy editing
├── .gitignore              # should include ".codeview/"
└── src/
```

Like `.git/`. One per project. Gitignored. Rebuildable from source. Port file avoids "what port is my server on?" guessing.

### 3.2 Package Model: Dev Dependency

```
bun add -D codeview
```

Version pinned in `package.json`. Reproducible across team. No global install conflicts. Agent calls `./node_modules/.bin/codeview` or `npx codeview`.

### 3.3 Auto-Start, One Command

Developer never opens a second terminal. Agent runs:

```
codeview start
```

What it does:
1. If `.codeview/port` exists and process alive → `✓ Already running on :8474` (no-op)
2. If stale (port file but process dead) → clean up, restart
3. First run → detect Ollama, index repo, start server daemon, write `.codeview/port` + `.codeview/pid`
4. Agent reads port from `.codeview/port` → makes HTTP calls

**Daemon strategy:** `Bun.spawn` detached child process. Parent process validates startup, waits for server to bind, then exits. Child writes `.codeview/pid` on startup. `codeview stop` reads pid file, sends `SIGTERM`. No external process manager needed. Cross-platform (Bun handles OS differences).

```bash
# First run
$ codeview start
✓ ts-morph: loaded 2 tsconfigs (app, shared)
✓ sqlite-vec: loaded
✓ Ollama: connected (nomic-embed-text, 768d)
Indexing 1,247 chunks... ████████████ 100% (8s)
✓ Ready on http://127.0.0.1:8474

# Subsequent tasks (instant, server already warm)
$ codeview start
✓ Already running on http://127.0.0.1:8474
```

### 3.4 Degraded Mode From Minute One

```
$ codeview start
✗ Ollama not found.
  Install: brew install ollama && ollama pull nomic-embed-text
  Entering degraded mode (structural search only).

✓ Ready on http://127.0.0.1:8474
  Semantic search disabled — install Ollama for full functionality.
```

Never a broken experience. Repo map works 100% without embeddings.

### 3.5 Port: Auto-Assign

First available port, written to `.codeview/port`. No hardcoded `8474` conflict when working on two projects. Configurable in `cvconfig.json` if user insists on fixed port.

### 3.6 CLI Surface

**CLI is a thin HTTP client.** Commands like `context`, `search`, `find`, `references` talk to the running server. Commands like `start`, `stop`, `status`, `rebuild` manage the daemon lifecycle. If server isn't running when a query command is called, CLI auto-runs `codeview start` first.

```
codeview start         # start background server daemon (idempotent)
codeview stop          # stop background server daemon
codeview status        # "Running on :8474 · 1,247 chunks · Ollama ✓"
codeview rebuild       # drop DB, re-index everything from scratch
codeview init           # generate AGENTS.md at project root (merge if exists)

# Agent-facing (CLI → HTTP to server, auto-starts server if needed)
codeview repo-map                       # full structural map
codeview context "add Stripe webhook"   # hybrid: semantic + structural + graph walk
codeview search "refund logic"          # semantic code search
codeview find processPayment            # exact symbol location
codeview references processPayment      # all usages of a symbol
```

**`codeview rebuild`:** Drops all chunks, embeddings, and edges. Re-extracts AST, re-chunks, re-embeds from scratch. Use after: switching embedding providers (dimension change), corrupt DB, or pull new model version. Prints progress like first index.

### 3.7 Agent Integration Flow

```
Agent starts task "add Stripe webhook handler"
  │
  ├─ codeview start              → ensures server running (idempotent)
  ├─ reads .codeview/port        → http://127.0.0.1:8474
  ├─ POST /context {"task":"add Stripe webhook handler"}
  │   returns: { repoMap, semanticResults, augmentedEdges }
  ├─ injects into system prompt  → "## Relevant code context"
  └─ writes code with full context loaded
```

Developer sees none of this. It's infrastructure.

### 3.8 Stop

```
codeview stop
```

Agent calls on session end. Or server shuts down after N minutes idle (configurable, default 30min).

---

## 4. Monorepo Support

### 4.1 ts-morph Multi-tsconfig

ts-morph supports loading multiple tsconfigs into one project:

```typescript
const project = new Project();
project.addSourceFilesFromTsConfig("packages/app/tsconfig.json");
project.addSourceFilesFromTsConfig("packages/shared/tsconfig.json");
```

### 4.2 Config

```json5
// cvconfig.json
{
  "projects": [
    { "name": "app", "tsconfig": "packages/app/tsconfig.json" },
    { "name": "shared", "tsconfig": "packages/shared/tsconfig.json" }
  ]
}
```

For single-package repos, `projects` can be omitted and codeview infers root `tsconfig.json`.

### 4.3 Known Limitations

| Issue | Mitigation |
|---|---|
| **npm workspace protocol** (`"@shared": "workspace:*"`) | ts-morph can't resolve `workspace:*`. Require explicit `paths` in tsconfig pointing to source. |
| **Cross-package `.d.ts` vs source** | ts-morph resolves to `.d.ts` files from `dist/` unless tsconfig has `declarationMap: true` and `sourceRoot`. Works if packages export source directly. |
| **Monorepo link bugs** | Test against real monorepo (`pnpm` workspace with `paths` aliases). Surface resolution errors in CLI. |

### 4.4 Grouped Output

Repo map output groups by project:

```
## Repo map

### packages/shared
src/types.ts [imported by: app/routes.ts, app/processor.ts]
  interface PaymentResult { success: boolean; chargeId: string }

### packages/app
src/routes.ts [imported by: app/index.ts]
  POST /api/payment → calls processPayment

Cross-project edges:
  app/routes.ts → shared/types.ts (PaymentResult)
```

---

## 5. Repo Map (Structural)

### 5.1 What Gets Extracted

| Node Type | Info Extracted | Example |
|---|---|---|
| FunctionDeclaration | Name, params + types, return type, generics | `processPayment(amount: number): Promise<Result>` |
| ClassDeclaration | Name, methods, extends/implements | `class StripeClient implements PaymentProvider` |
| InterfaceDeclaration | Fields + types | `interface PaymentResult { success: boolean; chargeId: string }` |
| TypeAliasDeclaration | Name, type | `type PaymentStatus = "pending" \| "completed"` |
| EnumDeclaration | Members | `enum Currency { USD, EUR, GBP }` |
| VariableDeclaration (exported) | Name, type | `export const DEFAULT_CURRENCY: Currency` |
| Import/Export edges | Source → target, cross-project flag | `routes.ts → payment/processor.ts [app → shared]` |
| File summary | `exports[]`, `imports[]`, category, project | `processor.ts: [payment processing] (shared)` |

### 5.2 Compression Strategy

A full codebase of 10K functions doesn't fit in context. We compress:

1. **Rank by centrality** — PageRank on import graph. Files imported by many others rank higher.
2. **Cold start bootstrap** — On first index (no edges yet), use out-degree as proxy:
   - `rank(file) = 0.7 × in_degree + 0.3 × out_degree + file_bonus(file)`
   - `index.ts`, `main.ts`, `app.ts` get +0.1 bonus
   - As graph matures, out-degree weight phases out (PageRank dominates)
3. **Don't compress small graphs** — If total edges < 100, return full map. Everything fits.
4. **Trim low-signal lines** — Remove blank lines, single comments, trivial getters/setters.
5. **Context window fit** — If map > token limit (configurable, default 5K), drop lowest-ranked files.

### 5.3 Example Output

```
## Repo map for /Users/raman/project (ranks by import centrality)

### packages/shared (shared types)
src/types.ts [imported by: app/routes.ts, app/webhook.ts, app/admin.ts] [shared]
  interface PaymentResult { success: boolean; chargeId: string; amount: number }
  interface SessionConfig { amount: number; currency: Currency; returnUrl: string }
  enum Currency { USD, EUR, GBP }

### packages/app (web server)
src/payment/processor.ts [imported by: app/routes.ts, app/webhook.ts, app/admin.ts]
  export function processPayment(amount: number, currency: string): Promise<PaymentResult>
  export class StripeClient { createSession(opts: SessionConfig): Session; refund(id: string): Refund }
  export function validateWebhook(sig: string, payload: unknown): boolean

src/api/routes.ts [imported by: app/index.ts, app/middleware.ts]
  POST /api/payment → calls processPayment
  GET /api/billing/subscriptions → calls listSubscriptions

src/billing/subscriptions.ts [imported by: app/routes.ts, app/cron.ts]
  export function listSubscriptions(userId: string): Subscription[]

### Other modules (6 files - trimmed for token budget)
...
```

~5K tokens. Gives agent complete picture without reading every file.

---

## 6. Embeddings (Semantic)

### 6.1 What Gets Embedded

Not raw files. **Chunks** with context:

```
type Chunk {
  id: number               // autoincrement = vec0 rowid
  hash: string             // SHA256(file + ":" + startLine + ":" + endLine).slice(0, 16), stable lookup
  file: string
  startLine: number
  endLine: number
  kind: "function" | "class" | "interface" | "type" | "enum" | "file"
  signature: string        // compact one-liner
  body: string             // full code (first 512 chars)
  doc: string              // JSDoc comment
  imports: string[]        // what this chunk imports
  exported: boolean        // is it exported?
  embedding: Float32Array  // vector (stored in vec0, queried via rowid)
  stale: boolean           // needs re-embedding?
}
```

Chunk boundaries follow AST nodes:
- Each function = 1 chunk (even if 200 lines)
- Each class = 1 chunk (methods inside stay attached)
- Each interface/type = 1 chunk
- File = 1 chunk (summary of exports)

**File exclusion:** ts-morph loads what's in tsconfig `include`. Additionally, codeview skips:
- `node_modules/`, `.git/`, `dist/`, `build/`, `.next/` (always)
- `*.test.ts`, `*.spec.ts` (configurable, default: index tests)
- `*.d.ts` files (declaration files, skip — no implementation to embed)
- User-defined `exclude` globs in `cvconfig.json`

### 6.2 Embedding Engine

**Primary: Ollama (local, zero config for LLM users)**

```bash
# User can pre-install, or codeview auto-pulls on first start
brew install ollama
ollama pull nomic-embed-text
```

- `codeview start` checks if model exists (`GET /api/tags`). If Ollama is running but model missing → auto-pull with progress: `Pulling nomic-embed-text (274MB)...`
- If Ollama not installed → enter degraded mode, print install hint
- No bundling issues. Works on every OS.
- Same Ollama users already run for LLMs.

**Optional: Remote API (cloud fallback)**

```json5
// cvconfig.json
{
  "embedding": {
    "provider": "openai",  // or "voyage"
    "apiKey": "$OPENAI_API_KEY",
    "model": "text-embedding-3-small"
  }
}
```

- OpenAI, Voyage, or any OpenAI-compatible endpoint.
- Uses env var or config field for API key.

**Removed: @xenova/transformers (ONNX browser-first, Bun bundling broken)**

- Was Phase 1 plan. ONNX native addon doesn't play well with Bun's bundler.
- Not worth debugging now. Ollama works today.
- Revisit if demand for fully-offline-without-Ollama emerges.

### 6.3 Vector Storage (sqlite-vec)

[sqlite-vec](https://github.com/asg017/sqlite-vec) by Alex Garcia — SQLite extension with native vector indexing. Ships as platform-specific native binaries via npm optional dependencies.

```bash
npm install sqlite-vec  # auto-installs sqlite-vec-darwin-arm64, -linux-x64, etc.
```

```sql
-- Extension loaded at startup via sqliteVec.load(db)
-- Table name includes dimension to handle provider switching

CREATE VIRTUAL TABLE chunk_embeddings USING vec0(
  embedding float[{dim}]
);
-- e.g. float[768] for nomic-embed-text, float[1536] for text-embedding-3-small
```

**Embedding dimension:** Detected from model at startup. Table name encodes dimension (`chunk_embeddings_768d`). If user switches embedding provider → different dimension → new table created, old vectors left intact (re-index on command). Warn: `"Embedding dimension changed (768 → 1536). Run 'codeview rebuild' to re-embed all chunks."`

```sql
-- Metadata stored in table, linked by rowid
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,  -- rowid for vec0 link
  hash TEXT UNIQUE NOT NULL,             -- SHA256(file + ":" + start + ":" + end), first 16 hex chars
  file TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  kind TEXT NOT NULL,
  signature TEXT,
  body TEXT,
  doc TEXT,
  imports TEXT,               -- JSON array
  exported INTEGER DEFAULT 0,
  centrality REAL DEFAULT 0.0,
  stale INTEGER DEFAULT 0     -- 1 = needs re-embedding
);

CREATE TABLE chunk_edges (
  source_id INTEGER NOT NULL REFERENCES chunks(id),
  target_id INTEGER NOT NULL REFERENCES chunks(id),
  kind TEXT NOT NULL DEFAULT 'import',
  cross_project INTEGER DEFAULT 0,
  PRIMARY KEY (source_id, target_id)
);
```

```typescript
// Usage
import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

const db = new Database("codeview.db");
sqliteVec.load(db);

// Dimension detected from embedding model at startup
const dim = 768; // nomic-embed-text, or 1536 for openai
const tableName = `chunk_embeddings_${dim}d`;

// Create virtual table
db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING vec0(embedding float[${dim}])`);

// Insert embedding (chunk.id = rowid in vec0)
const insert = db.prepare(
  `INSERT INTO ${tableName}(rowid, embedding) VALUES (?, vec_f32(?))`
);
insert.run(chunk.id, new Float32Array(embedding));

// ANN search
const results = db.prepare(`
  SELECT 
    c.hash, c.file, c.signature, 
    v.rowid, v.distance
  FROM ${tableName} v
  JOIN chunks c ON c.id = v.rowid
  WHERE v.embedding MATCH ?
  ORDER BY v.distance
  LIMIT ?
`).all(new Float32Array(queryVector), topK);
```

**macOS caveat:** Apple's system SQLite disables extension loading. Workaround:

```typescript
// macOS only — use Brew SQLite instead of system
Database.setCustomSQLite("/usr/local/opt/sqlite3/lib/libsqlite3.dylib");
// or /opt/homebrew/opt/sqlite3/lib/libsqlite3.dylib (Apple Silicon)
```

Linux/Windows: Bun statically links its own SQLite with extension support — works without workaround.

**No separate bridge table needed.** `chunks.id` (autoincrement integer) doubles as `rowid` in the `vec0` virtual table. `chunks.hash` for stable content-based lookup.

### 6.4 Chunk Eviction (Lazy GC)

**Deleted files:** On index, delete chunks whose source file no longer exists on disk. Chunks cascade-delete from `chunks` table — embeddings in vec0 are dropped when the corresponding rowid is removed.

**No size cap or LRU.** Even 100K chunks × ~2KB each = ~200MB SQLite. Not a problem worth solving prematurely.

### 6.5 Incremental Update Strategy

**ts-morph IS the live structural index.** SQLite stores only expensive computed data (embeddings).

| Data | Source of Truth | Update Strategy |
|------|----------------|-----------------|
| AST signatures | ts-morph (memory) | Always fresh, ts-morph watches files |
| Edges (import graph) | ts-morph (memory) | Rebuilt on-demand from AST, ~50ms |
| PageRank | Computed from edges | Re-computed on each `repo-map` call |
| Chunks | Derived from AST | Invalidate on file change, lazy re-chunk |
| Embeddings | SQLite | Lazy re-embed on query or background job |

**First index vs incremental:** On first run, all chunks are embedded synchronously before server starts (blocks `codeview start`). Progress bar shown. Subsequent file changes use lazy re-embed — only stale chunks that appear in query results get re-embedded on demand.

**Batch embedding failure:** Retry 3× with exponential backoff (1s, 2s, 4s). After 3 failures → mark chunk `stale=1`, continue. Print summary: `✓ 1,245 embedded, 2 failed (will retry on next query)`.

**On file change (Bun.watch):**
1. Bun.watch detects file system changes (project root, recursive)
2. ts-morph refreshes changed files: `sourceFile.refreshFromFileSystemSync()`
3. AST is now up to date. Structural queries see new code immediately.
4. Mark chunks for changed file as `stale = 1` in SQLite (by `file` column match)
5. Invalidate `repo_map_cache`

**Cascading changes:** File A changes. File B imports A. B's import edges unchanged (still imports A). Only A's exports may have changed — captured by refreshed AST. No cascading edge updates needed. Only cascade possible: A's new symbol name changes search relevance — handled by lazy re-embed.

**Deleted files:** Chunks remain in DB with `stale=1`. On next index, delete chunks whose source file is missing. Chunk eviction handles this (see 6.4).

---

## 7. Hybrid Retrieval

### 7.1 Query Flow

```
User task → "add Stripe webhook handler"
  ↓
Embed task text → vector (via Ollama or remote API)
  ↓
Two parallel paths:
  ┌────────────────────┐  ┌──────────────────────┐
  │ 1. Semantic        │  │ 2. Structural        │
  │ Vector search DB   │  │ Keyword match AST    │
  │ (sqlite-vec ANN)   │  │ Top 30 by name/type  │
  └────────┬───────────┘  └──────────┬───────────┘
           │                          │
           └──────────┬───────────────┘
                      ▼
            Reciprocal Rank Fusion
            RRF(score) = Σ 1/(60 + rank_i)
            Merge + re-rank top 10
                      │
                      ▼
            Graph walk augmentation
            Budget: depth=1, max 5 neighbors/node, 2K token cap
            For each top chunk:
            - Follow imports (top 5 by PageRank)
            - Follow dependents (top 5 by PageRank)
            - Follow extends/implements
            Stop when 2K token budget exhausted
                      │
                      ▼
            Format as context block
            Inject into agent prompt
```

**Context block format** (what the agent receives):

```
## Repo map (compressed)
[repo map text from /repo-map, 3-5K tokens]

## Semantic matches for "add Stripe webhook handler"
- src/payment/webhook.ts::handleStripeWebhook (distance: 0.12)
- src/payment/processor.ts::StripeClient.constructEvent (distance: 0.18)
- src/api/routes.ts::POST /api/webhook/stripe (distance: 0.21)

## Related code (imports + dependents)
- src/payment/processor.ts::validateWebhook [imported by webhook.ts]
- src/billing/types.ts::WebhookEvent [imported by webhook.ts, processor.ts]
```

### 7.2 Graph Walk Budget

```typescript
interface GraphWalkConfig {
  maxDepth: 1;              // direct neighbors only
  maxNeighborsPerNode: 5;   // top N by PageRank per edge type
  maxAugmentationTokens: 2000; // hard cap
}
```

Depth=1 covers 90% of what agent needs. Functions you directly import + functions that directly import you. Depth=2 explodes combinatorially.

**Keyword match algorithm (structural path):** Tokenize query string → split into words. Score each chunk by:
1. Case-insensitive substring match on `signature` and `kind` fields
2. Jaccard similarity on token sets (query tokens ∩ chunk tokens) / (query tokens ∪ chunk tokens)
3. Multiply by chunk's PageRank centrality

Sort descending, take top 30. Fast — no embedding needed (works in degraded mode).

### 7.3 Commands

```
codeview repo-map                           → Full structural map (no query)
codeview context "add Stripe webhook"        → Hybrid: semantic + structural + graph walk
codeview search "refund logic"               → Semantic only (±3 surrounding chunks for context)
codeview find processPayment                 → Exact structural lookup
codeview references processPayment           → All usages of a symbol
```

**Degraded mode (no embedding engine):**

```
codeview repo-map                           → Works normally (structural only)
codeview context "add Stripe webhook"        → Falls back to keyword match on signatures
codeview search "refund logic"               → Keyword match (±3 surrounding chunks), with note: "No embedding engine. Install ollama for semantic search."
codeview find processPayment                 → Works normally (structural only)
codeview references processPayment           → Works normally (structural only)
```

---

## 8. Agent Integration

### 8.1 For Pi

AGENTS.md instructs Pi:

```
## Codebase intelligence (codeview)

At the START of each task, call:
  codeview context "your task description"

This returns relevant code context. Use it before writing any code.

For follow-up questions, use individual commands:
  codeview find <name>         - exact symbol location
  codeview references <name>   - all usages
  codeview search <query>      - semantic code search
```

When Pi starts a task:
1. Embed task text (or keyword-only in degraded mode)
2. Call `context`
3. Inject results into system prompt as "## Relevant code context"
4. Pi works with context already loaded

### 8.2 For Any Agent

HTTP API makes it agent-agnostic.

**Port:** Configurable in `cvconfig.json`. Default auto-assigned, written to `.codeview/port`. Agent reads port file.

**Base URL:** `http://127.0.0.1:{port}`

**Endpoints:**

| Method | Path | Body/Params | Returns | Description |
|--------|------|-------------|---------|-------------|
| `GET` | `/health` | — | `{ status, chunks, ollama, uptime }` | Health check |
| `POST` | `/repo-map` | `{ tokenBudget?: number }` | `{ text: string, tokenCount: number }` | Full structural map |
| `POST` | `/context` | `{ task: string, topK?: number }` | `ContextResponse` | Hybrid: map + semantic + graph walk |
| `POST` | `/search` | `{ query: string, topK?: number }` | `{ results: ChunkResult[] }` | Semantic code search |
| `GET` | `/find?name=X` | query param | `{ symbols: SymbolResult[] }` | Exact symbol lookup |
| `GET` | `/references?name=X` | query param | `{ usages: ReferenceResult[] }` | All usages of a symbol |
| `POST` | `/rebuild` | — | `{ ok: true }` | Force full re-index |

**Response types:**

```typescript
interface ContextResponse {
  repoMap: string;
  semantic: ChunkResult[];
  augmented: ChunkResult[];  // graph walk neighbors
  degraded: boolean;         // true if no embeddings, keyword-only fallback
}

interface ChunkResult {
  hash: string;
  file: string;
  startLine: number;
  endLine: number;
  signature: string;
  kind: string;
  distance?: number;         // only for semantic results
}

interface SymbolResult {
  name: string;
  kind: string;
  file: string;
  line: number;
  signature: string;
}

interface ReferenceResult {
  file: string;
  line: number;
  context: string;           // surrounding code snippet
}
```

**Error format:**

```typescript
{ error: string, hint?: string, code: string }
// 400: { error: "Missing 'task' field", code: "BAD_REQUEST" }
// 503: { error: "Indexing in progress", code: "NOT_READY", hint: "Retry in a few seconds" }
```

**Degraded mode responses:** When no embedding engine is configured, `context` and `search` endpoints still return results (keyword match instead of semantic). `ContextResponse.degraded` is `true`. Server still returns 200, not an error.

---

## 9. Data Model

### 9.1 SQLite Tables

```sql
-- Chunk storage
chunks              — code units (autoincrement id = vec0 rowid), hash for stable lookup, stale markers
chunk_embeddings    — sqlite-vec vec0 virtual table (dimension-encoded name, e.g. chunk_embeddings_768d), ANN index
chunk_edges         — import/call/extend relationships, cross_project flag

-- Cache (speed up repeated calls)
repo_map_cache      — text blob, invalidated on file change
```

### 9.2 In-Memory (Server)

```typescript
interface ServerState {
  project: Project;                    // ts-morph project (warm, multi-tsconfig)
  projects: ProjectConfig[];           // monorepo project definitions
  graph: Map<string, GraphNode>;       // import graph (warm), cross-project edges flagged
  model: EmbeddingProvider;            // "ollama" | "openai" | "voyage" | null
  lastBuild: number;                   // timestamp of last index
  config: CodeviewConfig;              // loaded from cvconfig.json
}

interface ProjectConfig {
  name: string;                        // display name for grouped output
  tsconfig: string;                    // path to tsconfig.json
}

interface CodeviewConfig {
  projects?: ProjectConfig[];          // monorepo: multiple tsconfigs. single: omit.
  exclude?: string[];                  // glob patterns, e.g. ["**/*.test.ts", "**/__mocks__/**"]
  embedding?: {
    provider: "ollama" | "openai" | "voyage";
    apiKey?: string;
    model?: string;
    ollamaUrl?: string;                // default http://localhost:11434
  };
  port?: number;                       // default auto-assign, write to .codeview/port
  tokenBudget?: number;                // repo map compression target, default 5000
  graphWalk?: GraphWalkConfig;         // augmentation budget
}
```

---

## 10. Build Phases

### Phase 1: Repo Map Core ✅
- [x] Add `repo-map` endpoint to server
- [x] Extract function/class/interface/type signatures with type info
- [x] Build PageRank on import graph (with out-degree cold start bootstrap)
- [x] Compress into ~5K token text block (skip compression if edges < 100)
- [x] CLI `repo-map` command
- [x] Monorepo support: `projects[]` config, grouped output, cross-project edges
- [x] Smoke test on real codebase

### Phase 2: Ollama Embeddings ✅
- [x] Ollama integration: auto-detect at startup, pull model guide
- [x] Chunking engine: split AST into chunks, store in SQLite
- [x] Track edges (imports, calls, extends) with cross-project flag
- [x] Incremental update: stale markers, lazy re-embed on query
- [x] Embed all chunks on first index
- [x] Remote API option (OpenAI/Voyage) as config alternative

### Phase 3: Hybrid Retrieval ✅
- [x] Semantic search endpoint (sqlite-vec ANN)
- [x] Reciprocal rank fusion
- [x] Graph walk augmentation with configurable budget
- [x] `context` endpoint that does all of the above
- [x] Degraded mode: keyword-only fallback when no embedding engine

### Phase 4: Agent Integration ✅
- [x] Implement `codeview init` command (generate AGENTS.md at project root)
- [x] AGENTS.md template with codeview-first workflow
- [x] Test with Pi agent on a real task (structural + hybrid)
- [x] Test degraded mode (no Ollama, no API key)
- [x] Document HTTP API for other agents

### Phase 5: Polish & Publish ✅
- [x] README with example workflow (single repo + monorepo)
- [x] Smoke test all commands (normal + degraded)
- [x] Publish to npm as `@ramankarki/codeview`

### Phase 6: Production Readiness ✅
- [x] Conventional Commits enforcement (commitlint + husky)
- [x] Pre-commit test hook
- [x] CI workflow (PR trigger: typecheck, test, build, commit lint)
- [x] Release automation (release-please + merged npm publish with provenance)
- [x] PR template
- [x] Code formatting (prettier)
- [x] CHANGELOG.md
- [x] README badges (CI, version, license)
- [x] `.gitattributes` (LF line endings)
- [x] Stricter tsconfig (`noUncheckedIndexedAccess`, `noImplicitReturns`)
- [x] Build optimised (`--minify`, `--sourcemap=external`, 11.5MB → 5.9MB)
- [x] `publish:dry` for previewing npm package contents

---

## 11. Comparison Matrix

| Feature | Aider | Cursor | Pi + codeview |
|---|---|---|---|
| Structural map | tree-sitter only | No | **ts-morph with TYPES** |
| Type info in map | ❌ | ❌ | ✅ `(amount: number): Promise<Result>` |
| Semantic search | ❌ | Cloud embeddings | **Local embeddings (Ollama)** |
| Privacy | ✅ Local | ❌ Cloud | **✅ Local first** |
| Monorepo support | ❌ Flat only | ✅ Limited | **✅ Grouped by project** |
| Agent-agnostic | ❌ Baked in | ❌ IDE only | **✅ HTTP API** |
| Offline semantic | ❌ | ❌ | **✅ Ollama local** |
| Degraded mode | N/A | N/A | **✅ Structural-only fallback** |
| Incremental update | ✅ File watcher | Merkle + 10min | **✅ Bun.watch + lazy re-embed** |
| Cost | Free | $20/mo + API | **Free (Ollama local)** |
| Git safety | ✅ Auto-commit | ✅ | ❌ |

---

## 12. File Structure

```
codeview/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                   # PR: typecheck, test, build, commitlint
│   │   └── release-please.yml        # Auto version bump + npm publish (OIDC provenance)
│   └── PULL_REQUEST_TEMPLATE.md
├── .husky/
│   ├── commit-msg                    # Runs commitlint
│   ├── pre-commit                    # Runs bun test
│   └── install.mjs                   # Smart install (skips in CI)
├── src/
│   ├── cli.ts                        # Entry point. Parses args, routes commands.
│   ├── server.ts                     # Bun HTTP server. Holds warm state.
│   ├── config.ts                     # Config loading/saving (monorepo + embedding)
│   ├── db.ts                         # SQLite: chunks, embeddings, edges, stale markers
│   ├── types.ts                      # Shared interfaces (ProjectConfig, Chunk, etc.)
│   └── lib/
│       ├── repo-map.ts               # Repo map generation (grouped by project, compressed)
│       ├── chunker.ts                # AST chunking with context windows
│       ├── ranker.ts                 # PageRank on import graph (out-degree cold start)
│       ├── ollama.ts                 # Ollama embedding provider
│       ├── embedding.ts              # Embedding abstraction (Ollama | OpenAI | Voyage)
│       ├── search.ts                 # Hybrid search (RRF fusion, keyword fallback)
│       ├── graph-walk.ts             # Budgeted graph walk augmentation
│       ├── ts-service.ts             # ts-morph wrapper (multi-tsconfig, file watching)
│       ├── graph.ts                  # Import graph utilities (cross-project edges)
│       ├── indexer.ts                # Index chunks, manage stale markers, lazy re-embed
│       ├── agent-instructions.ts     # AGENTS.md generator
│       └── colors.ts                 # ANSI color tokens (NO_COLOR / non-TTY safe)
├── dist/                             # Compiled output (bun build --minify, 5.9MB)
├── test/
│   ├── fixtures/                     # Test projects (tiny, monorepo, fullstack)
│   ├── chunker.test.ts
│   ├── cli.test.ts
│   ├── config.test.ts
│   ├── embedding.test.ts
│   ├── graph.test.ts
│   ├── graph-walk.test.ts
│   ├── monorepo.test.ts
│   ├── ollama.test.ts
│   ├── ranker.test.ts
│   ├── repo-map.test.ts
│   ├── search.test.ts
│   ├── semantic.test.ts
│   ├── server.test.ts
│   └── ts-service.test.ts
├── docs/
│   └── CODEVIEW_SPEC.md              # This document
├── package.json                      # @ramankarki/codeview v1.1.0
├── tsconfig.json                     # strict + noUncheckedIndexedAccess
├── commitlint.config.js              # @commitlint/config-conventional
├── release-please-config.json        # Release automation config
├── .release-please-manifest.json     # Current version tracking
├── .prettierrc                       # Code formatting
├── .prettierignore
├── .gitattributes                    # LF line endings
├── .gitignore
├── bun.lock                          # Committed lockfile
├── CHANGELOG.md
├── cvconfig.example.json             # Example config for users
├── README.md
└── LICENSE
```

---

## 13. Package & Build Config

### 13.1 package.json

```jsonc
{
  "name": "@ramankarki/codeview",
  "version": "1.1.0",
  "type": "module",
  "license": "MIT",
  "sideEffects": false,
  "bin": {
    "codeview": "./dist/cli.js"
  },
  "exports": "./dist/cli.js",
  "files": ["dist", "README.md", "CHANGELOG.md"],
  "publishConfig": {
    "access": "public"
  },
  "funding": {
    "type": "github",
    "url": "https://github.com/sponsors/ramankarki"
  },
  "scripts": {
    "build": "bun build src/cli.ts --outdir dist --target bun --minify --sourcemap=external",
    "prepublishOnly": "bun run build && bun test && bun run typecheck",
    "prepare": "bun .husky/install.mjs",
    "publish:dry": "npm pack --dry-run",
    "format": "prettier --write .",
    "dev": "bun run --watch src/server.ts",
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "ts-morph": "^24",
    "sqlite-vec": "^0.1"
  },
  "devDependencies": {
    "@commitlint/cli": "^21",
    "@commitlint/config-conventional": "^21",
    "@types/bun": "latest",
    "husky": "^9",
    "prettier": "^3",
    "typescript": "^6"
  },
  "engines": {
    "bun": ">=1.1.0"
  }
}
```

### 13.2 Dependencies Rationale

| Dependency | Why | Alternative |
|---|---|---|
| `ts-morph` | Type-aware AST, multi-tsconfig | tree-sitter (no type info) |
| `sqlite-vec` | ANN vector search in SQLite | hnswlib-js, pgvector (external) |
| `bun:sqlite` | Built-in, no dep | better-sqlite3 |
| `Bun.serve` | Built-in HTTP server, no dep | express, hono |
| `Bun.watch` | Built-in file watcher | chokidar |
| `Bun.hash` (SHA256) | Chunk hash, no dep | node:crypto |

Zero JS dependencies beyond ts-morph and sqlite-vec. HTTP server, SQLite, file watcher, crypto — all Bun built-ins.

### 13.3 Build

Single binary target: `bun build src/cli.ts --outdir dist --target bun --minify --sourcemap=external`.
Bun bundles everything (ts-morph included, sqlite-vec excluded as native addon).
`dist/cli.js` is the `bin` entry (~5.9MB minified). Source maps are external (`.js.map`) to keep the binary small.

`tsc --noEmit` for typechecking only — no `.d.ts` emitted (CLI tool, not a library).

### 13.4 Config Discovery

`codeview start` looks for `cvconfig.json` in this order:
1. `./cvconfig.json` (current working directory)
2. Walk up parent directories until root (like `.git` discovery)
3. If not found → use defaults (single project, root `tsconfig.json`, auto-detect Ollama)

---

## 14. Testing Strategy

### 14.1 Test Runner: `bun test`

Built-in, zero-config. Same runtime as production. `bun test` runs `*.test.ts` files.

### 14.2 Test Fixtures

```
codeview/test/
├── fixtures/
│   ├── tiny-project/         # 5 files, 1 tsconfig, no deps
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts      # imports math.ts
│   │   │   ├── math.ts       # exports add(), multiply()
│   │   │   └── types.ts      # exports interface Result
│   │   └── cvconfig.json
│   └── monorepo-project/     # 2 packages, cross-package imports
│       ├── packages/app/tsconfig.json
│       ├── packages/shared/tsconfig.json
│       └── ...
├── repo-map.test.ts          # structural extraction correctness
├── chunker.test.ts           # chunking boundaries, hash stability
├── ranker.test.ts            # PageRank, cold start bootstrap
├── semantic.test.ts          # embedding + vec0 search (integration)
├── search.test.ts            # RRF fusion, degraded mode fallback
├── graph-walk.test.ts        # budget enforcement, neighbor selection
├── server.test.ts            # HTTP endpoints (start server in test)
└── cli.test.ts               # CLI arg parsing, output format
```

### 14.3 Test Categories

| Category | Scope | Mocking |
|----------|-------|---------|
| **Unit** | Individual lib functions (ranker, chunker, graph-walk) | No Ollama, no ts-morph. Test with fixture AST data. |
| **Integration** | sqlite-vec + chunks + embeddings | Real SQLite, real sqlite-vec. Skip Ollama (use hardcoded vectors). |
| **E2E** | Full server lifecycle | Real ts-morph on tiny-project fixture. Mock Ollama (recorded responses). |

### 14.4 Key Test Scenarios

```typescript
// chunker.test.ts
test("function declaration becomes a chunk")
test("class with methods stays as single chunk")
test("chunk hash is stable across re-index")
test("interface and type alias each get their own chunk")

// repo-map.test.ts
test("extracts type info from function params")
test("extracts return type")
test("tracks imports correctly")
test("tracks who imports this file")
test("monorepo: groups output by project name")

// ranker.test.ts
test("cold start: out-degree bootstrap works when no edges")
test("pageRank: file imported by 5 files ranks higher than file imported by 1")
test("bonus points for index.ts")

// semantic.test.ts
test("embedding stores and retrieves via vec0 rowid")
test("ANN search returns correct distance ordered results")
test("dimension change creates new table, old table preserved")

// search.test.ts
test("RRF merges semantic + structural correctly")
test("degraded mode: returns keyword results when no embeddings")

// server.test.ts
test("/health returns chunk count and ollama status")
test("/context returns repoMap + semantic + augmented")
test("returns 503 when indexing in progress")
test("server auto-starts on CLI command if not running")
```

### 14.5 Smoke Test (Pre-Publish)

```bash
# In a test project
bunx codeview start
bunx codeview status
bunx codeview repo-map
bunx codeview context "fix payment bug"
bunx codeview find processPayment
bunx codeview search "refund"
bunx codeview rebuild
bunx codeview stop
```

---

## 15. Production Infrastructure

### 15.1 Conventional Commits

All commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature           → bumps MINOR (1.1.0 → 1.2.0)
fix: handle edge case           → bumps PATCH (1.1.0 → 1.1.1)
perf: improve speed             → bumps PATCH
docs: update readme             → no bump
chore: update deps              → no bump
feat!: drop old API             → bumps MAJOR (1.1.0 → 2.0.0)
```

Enforced by:
- **commitlint** (`@commitlint/config-conventional`) — runs on every commit via `.husky/commit-msg`
- **CI** — commitlint runs on PRs using base/head SHAs for accurate diff

### 15.2 Pre-commit Hook

`.husky/pre-commit` runs `bun test` before every commit. Catches regressions before they leave the machine.

### 15.3 CI Pipeline

`.github/workflows/ci.yml` triggers on PRs to `main`:

```yaml
1. bun install --frozen-lockfile
2. commitlint (PR base → head diff)
3. bun run typecheck
4. bun test
5. bun run build
```

### 15.4 Release Automation

`.github/workflows/release-please.yml` (single workflow, merged publish):

```
push to main
  → release-please opens Release PR (version bump + CHANGELOG.md)
  → review → merge
  → git tag + GitHub Release
  → release_created=true triggers npm-publish job
  → bun publish --provenance --access public
  → smoke test: bun add -g @ramankarki/codeview && codeview --help
```

**Release config** (`release-please-config.json`):
- Release type: `node`
- Changelog sections: Features (feat), Bug Fixes (fix), Performance (perf)
- Hidden sections: Refactoring, Tests, Chores
- Pre-1.0: bump minor for breaking, bump patch for features

### 15.5 npm Provenance

Published with OIDC-based provenance via `bun publish --provenance`:
- `id-token: write` permission in workflow
- GitHub provides OIDC token → npm verifies repo/workflow/commit
- Package page shows "Built and signed on GitHub Actions"

### 15.6 Code Quality

- **Prettier**: `bun run format` — 100 char width, single quotes, trailing commas
- **TypeScript**: `strict: true` + `noUncheckedIndexedAccess` + `noImplicitReturns` + `forceConsistentCasingInFileNames`
- **Line endings**: `.gitattributes` enforces LF across all text files
- **PR template**: Standardized checklist in `.github/PULL_REQUEST_TEMPLATE.md`

---

## Appendix A: Key Risks

| Risk | Mitigation |
|---|---|
| **Ollama not installed** | Degraded mode. Print setup hint. Structural-only still 10x better than blank. |
| **PageRank slow for 100K files** | Precompute on index, cache. Out-degree bootstrap prevents cold start. |
| **Chunk context too large** | Max 512 chars body per chunk. Use signature as summary. |
| **Embeddings > 10K files slow** | Batch embed, show progress. sqlite-vec ANN search handles 1M+ vectors efficiently. |
| **ts-morph too memory-heavy** | ~200-500MB for medium projects. Monitor. Acceptable for server process. |
| **Monorepo cross-package resolution** | Test with real pnpm workspace. Require `paths` in tsconfig. Surface broken refs. |
| **Graph walk explosion** | Budget: depth=1, max 5 neighbors/node, 2K token cap. |
| **sqlite-vec + Bun** | Bun.sqlite supports `db.loadExtension()`. macOS needs `Database.setCustomSQLite()` for Homebrew SQLite. Linux/Windows work natively. npm package `sqlite-vec` provides `load(db)` helper. Verified with Bun example from sqlite-vec repo. |
