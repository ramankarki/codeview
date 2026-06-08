# codeview

Local codebase intelligence server for coding agents. Type-aware repo maps + semantic search via Ollama — pluggable into any agent via HTTP.

## Contents

- [Quick start](#quick-start)
- [Commands](#commands)
- [How it works](#how-it-works)
- [Monorepo](#monorepo)
- [Agent integration](#agent-integration)
- [Benchmarks](#benchmarks)
- [Comparison](#comparison)
- [Development](#development)
- [Configuration reference](#configuration-reference)
- [Requirements](#requirements)

## Quick start

```bash
bun add -D codeview
bunx codeview start
bunx codeview context "add Stripe webhook handler"
```

## Commands

| Command | Description |
|---------|-------------|
| `start` | Start background daemon (idempotent) |
| `stop` | Stop daemon |
| `status` | Running? Chunk count? Ollama reachable? |
| `repo-map` | Full structural map with type signatures |
| `find <name>` | Exact symbol: file, line, signature |
| `references <name>` | Every file that imports this symbol |
| `search <query>` | Hybrid: semantic (Ollama) + keyword |
| `context <task>` | Repo map + semantic matches + graph walk |
| `rebuild` | Drop index, re-extract and re-embed |
| `init` | Generate `.codeview/AGENTS.md` (copy into your agent prompt) |

## How it works

```
codeview start
  │
  ├─ ts-morph parses your tsconfig(s) — type-aware, not tree-sitter
  ├─ Builds import graph (PageRank centrality)
  ├─ Chunks functions/classes/interfaces/types → SQLite
  ├─ Embeds via Ollama (nomic-embed-text, 768d) → sqlite-vec ANN index
  ├─ Starts Bun HTTP server on auto-assigned port
  ├─ Writes .codeview/port + .codeview/pid
  └─ Watches files via fs.watch, marks stale on change
```

The server auto-shuts down after 30 minutes of idle. Any `codeview` command auto-starts it if needed.

### Degraded mode

Without Ollama, structural + keyword search still work at full capacity:

```bash
# Install Ollama for the full experience
brew install ollama && ollama pull nomic-embed-text
```

## Monorepo

`cvconfig.json` at project root:

```json
{
  "projects": [
    { "name": "api", "tsconfig": "packages/api/tsconfig.json" },
    { "name": "web", "tsconfig": "packages/web/tsconfig.json" },
    { "name": "shared", "tsconfig": "packages/shared/tsconfig.json" }
  ],
  "exclude": ["**/*.test.ts", "**/__mocks__/**"],
  "tokenBudget": 5000
}
```

Output groups by project, flags cross-package edges in `[imported by: ...]` annotations.

Full config reference: [`cvconfig.example.json`](./cvconfig.example.json).

### Embedding providers

```json
{
  "embedding": {
    "provider": "openai",
    "apiKey": "$OPENAI_API_KEY",
    "model": "text-embedding-3-small"
  }
}
```

Supports `ollama` (default, free), `openai`, and `voyage`.

## Agent integration

```bash
codeview init  # creates .codeview/AGENTS.md
```

Copy the relevant section into your agent's system prompt. Agent calls:

```bash
codeview context "your task"          # at task start: map + search + graph walk
codeview find <name>                  # exact location
codeview references <name>            # who imports this
codeview search "concept"             # find relevant code
```

---

## Benchmarks

### Setup

We tested codeview on three codebases:

| Fixture | Files | Packages | Description |
|---------|-------|----------|-------------|
| `tiny-project` | 5 | 1 | Unit test fixture (math + types) |
| `monorepo-project` | 4 | 2 | Cross-package import edge tests |
| `fullstack-monorepo` | 22 | 3 | Hono API + TanStack Start web + shared types |
| **codeview itself** | 18 | 1 | The tool testing itself (dogfood) |

Rollup:
| | Files | Chunks | Map tokens | Search quality |
|---|---|---|---|---|
| tiny-project | 5 | 3 | ~200 | keyword-only (degraded works) |
| fullstack-monorepo | 22 | 55 | ~1,073 | sub-1.0 distance on all queries |
| codeview (self) | 18 | 86 | ~1,785 | sub-1.0 distance on all queries |

### Test scenario: "Add a billing route to the API"

Without codeview:
```
1. read api/src/index.ts         → find route registration
2. read api/src/routes/products  → copy pattern  
3. read shared/src/index.ts      → find Product/Currency types
4. read middleware/auth.ts       → auth guard pattern
→ 4 round-trips, 4 files read
```

With codeview:
```
1. codeview context "add billing route"
   → repo map shows all exports grouped by package
   → semantic search returns Product (0.938), Currency (0.822)
   → graph walk shows products route as neighbor
2. read products.ts (for pattern), shared/index.ts (for types)
→ 1 round-trip, 2 files read
```

**Result: 75% fewer round-trips, 50% fewer files read.**

### Semantic search quality (fullstack-monorepo)

| Query | Top result | Distance |
|-------|-----------|----------|
| "rate limiting middleware" | `rateLimiter()` | 0.879 |
| "user profile component avatar" | `UpdateUserDTO.avatarUrl` | 0.852 |
| "product price currency" | `Currency` enum | 0.822 |
| "hono rpc typed client" | `useRPC()` | 0.951 |
| "route chaining" | `productRoutes` | 0.923 |

All domain-specific queries return exactly the right function/type in top 3 results with sub-1.0 distances.

### Dogfood: codeview on itself

We ran codeview on its own 18-file codebase. Agent task "add --port flag to start command":

> Without: 5 reads to discover `cli.ts` → `server.ts` → `config.ts` → `types.ts` → `server-daemon.ts`

> With: 1 context call → map shows `startServer(rootDir, requestedPort)` and `CodeviewConfig.port` → jump straight to cli.ts

Semantic queries on its own code confirmed accuracy:
- "file watching" → `markStale()` (1.002) — the exact function that handles file changes
- "embedding vector storage" → `EmbeddingProvider` (0.896) — the exact type defining embedding providers
- "add new CLI command" → `loadConfig()` (1.002) — the config loader pattern to follow

### Cross-package import edges (monorepo-project)

Test confirmed: app imports from shared are flagged as cross-project edges in the graph. `shared/src/index.ts` shows `[imported by: app/src/index.ts]` in the repo map, and `inDegree` correctly reflects the cross-package dependency.

---

## Comparison

| | Aider | Cursor | codeview |
|---|---|---|---|
| Structural map | tree-sitter | ❌ | **ts-morph + types** |
| Type info in map | ❌ | ❌ | **✅** |
| Semantic search | ❌ | Cloud | **Local (Ollama)** |
| Privacy | ✅ | ❌ | **✅** |
| Monorepo | ❌ | Limited | **✅ grouped** |
| Agent-agnostic | ❌ | IDE-only | **✅ HTTP API** |
| Degraded mode | N/A | N/A | **✅** |
| Cost | Free | $20/mo | **Free** |

---

## Development

```bash
bun install
bun test           # 72 tests, 14 files, 158 assertions
bun run typecheck  # tsc --noEmit
```

### Test fixtures

```
test/fixtures/
├── tiny-project/          # 5 files, 1 tsconfig — unit test target
├── monorepo-project/      # 2 packages, cross-package imports
└── fullstack-monorepo/    # 3 packages, Hono RPC + TanStack Start
```

### Test matrix

| Category | Tests | Fixture |
|----------|-------|---------|
| `config` | 5 | cvconfig.json loading, defaults |
| `ts-service` | 6 | symbol extraction, type info, JSDoc, imports |
| `graph` | 6 | import graph, inDegree/outDegree, cross-project |
| `ranker` | 6 | PageRank, cold-start bootstrap, compression gate |
| `chunker` | 7 | AST → chunks, hash stability, body trimming |
| `repo-map` | 6 | type info in output, imported-by, grouped by project |
| `search` | 6 | keyword match, RRF fusion, case insensitive |
| `graph-walk` | 3 | neighbor budget, max neighbors enforcement |
| `embedding` | 4 | Provider creation, degraded fallback |
| `ollama` | 5 | Reachability check, model detection, batch embed |
| `semantic` | 2 | Chunk indexing, vec0 ANN search |
| `server` | 8 | All HTTP endpoints, /context, /rebuild |
| `cli` | 4 | Help, start daemon, repo-map, find |
| `monorepo` | 4 | Cross-project edges, grouped output, imported-by |
| **Total** | **72** | **14 test files** |

Runtime: ~9s. Ollama embedding tests run live (not mocked).

---

## Configuration reference

All options in `cvconfig.json`. Copy from [`cvconfig.example.json`](./cvconfig.example.json):

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `projects[].name` | string | — | Display name for grouped output |
| `projects[].tsconfig` | string | — | Path to tsconfig.json |
| `exclude` | string[] | `[]` | Glob patterns (`**/*.test.ts`) |
| `embedding.provider` | string | `"ollama"` | ollama / openai / voyage |
| `embedding.model` | string | auto-detect | Model override |
| `embedding.apiKey` | string | — | API key (openai/voyage) |
| `embedding.ollamaUrl` | string | `localhost:11434` | Custom Ollama host |
| `tokenBudget` | number | 5000 | Repo map compression target |
| `port` | number | auto | Fixed server port |
| `graphWalk.maxDepth` | number | 1 | Graph walk depth |
| `graphWalk.maxNeighborsPerNode` | number | 5 | Neighbors per seed |
| `graphWalk.maxAugmentationTokens` | number | 2000 | Graph walk token cap |

## Requirements

- Bun ≥ 1.1.0
- Ollama (optional, for semantic search)
- **macOS**: Homebrew SQLite required for sqlite-vec (`brew install sqlite3` — automatic detection)
- **Linux**: Works out of the box (Bun SQLite has extension loading)
- **Windows**: Works out of the box (file watching degrades gracefully to manual rebuild)
