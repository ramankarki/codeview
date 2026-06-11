# codeview

[![CI](https://github.com/ramankarki/codeview/actions/workflows/ci.yml/badge.svg)](https://github.com/ramankarki/codeview/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ramankarki/codeview)](https://www.npmjs.com/package/@ramankarki/codeview)
[![license](https://img.shields.io/npm/l/@ramankarki/codeview)](./LICENSE)

Local codebase intelligence server for coding agents. Type-aware repo maps + semantic search via Ollama — pluggable into any agent via HTTP.

## Requirements

- Bun ≥ 1.1.0
- Ollama (optional, for semantic search)
- **macOS**: Homebrew SQLite required for sqlite-vec (`brew install sqlite3` — automatic detection)
- **Linux**: Works out of the box (Bun SQLite has extension loading)
- **Windows**: Works out of the box (file watching degrades gracefully to manual rebuild)

## Quick start

```bash
bun add -D @ramankarki/codeview
bunx @ramankarki/codeview start
bunx @ramankarki/codeview context "add Stripe webhook handler"
```

No Ollama? No problem — structural + keyword search work without it.

## Why codeview?

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

codeview gives coding agents structural understanding of your TypeScript codebase — **type-aware**, not regex or tree-sitter. It builds an import graph, extracts chunks with full type signatures, and runs semantic search locally via Ollama. Everything stays on your machine.

## Commands

| Command | Description |
|---------|-------------|
| `start` | Start background daemon (idempotent, auto-starts on any command) |
| `stop` | Stop daemon |
| `status` | Running? Chunk count? Ollama reachable? |
| `mem \| memory` | Real-time memory usage (RSS, heap, DB, vector index) |
| `repo-map` | Full structural map with type signatures and import relationships |
| `find <name>` | Exact symbol: file, line, signature |
| `references <name>` | Every file that imports this symbol |
| `search <query>` | Hybrid: semantic (Ollama) + keyword with reciprocal rank fusion |
| `context <task>` | Repo map + semantic matches + graph walk — one call for agents |
| `rebuild` | Drop index, re-extract and re-embed |
| `init` | Generate `.codeview/AGENTS.md` for your agent's system prompt |

The daemon auto-shuts down after 30 minutes idle.

## Agent integration

codeview was built for coding agents. One command gives them everything:

```bash
codeview init  # creates .codeview/AGENTS.md
```

Copy into your agent's system prompt, then your agent calls:

```bash
codeview context "your task"          # at task start: map + search + graph walk
codeview find <name>                  # exact location
codeview references <name>            # who imports this
codeview search "concept"             # find relevant code
```

## Benchmarks

### Real-world scenario: "Add a billing route to the API"

**Without codeview** — 4 round-trips, 4 files read:
```
1. read api/src/index.ts         → find route registration
2. read api/src/routes/products  → copy pattern  
3. read shared/src/index.ts      → find Product/Currency types
4. read middleware/auth.ts       → auth guard pattern
```

**With codeview** — 1 round-trip, 2 files read:
```
1. codeview context "add billing route"
   → repo map shows all exports grouped by package
   → semantic search returns Product (0.938), Currency (0.822)
   → graph walk shows products route as neighbor
2. read products.ts (for pattern), shared/index.ts (for types)
```

**75% fewer round-trips, 50% fewer files read.**

### Semantic search quality

Tested on 3-package monorepo (Hono API + TanStack Start + shared types):

| Query | Top result | Distance |
|-------|-----------|----------|
| "rate limiting middleware" | `rateLimiter()` | 0.879 |
| "user profile component avatar" | `UpdateUserDTO.avatarUrl` | 0.852 |
| "product price currency" | `Currency` enum | 0.822 |
| "hono rpc typed client" | `useRPC()` | 0.951 |
| "route chaining" | `productRoutes` | 0.923 |

All queries return the exact symbol in top 3 results, sub-1.0 distances.

### Dogfood: codeview on itself

Agent task: *"add --port flag to start command"*

| Approach | Round-trips | Files read |
|----------|-------------|------------|
| Without codeview | 5 | `cli.ts` → `server.ts` → `config.ts` → `types.ts` |
| With codeview | 1 | `codeview context` → map shows `startServer(rootDir, requestedPort)` + `CodeviewConfig.port` |

### Test fixtures

| Fixture | Files | Chunks | Map tokens | Search quality |
|---------|-------|--------|------------|----------------|
| `tiny-project` (5 files, 1 pkg) | 5 | 3 | ~200 | keyword-only |
| `fullstack-monorepo` (22 files, 3 pkgs) | 22 | 55 | ~1,073 | sub-1.0 on all queries |
| **codeview itself** (18 files, 1 pkg) | 18 | 86 | ~1,785 | sub-1.0 on all queries |

## How it works

```
codeview start
  │
  ├─ ts-morph parses your tsconfig(s) — type-aware AST, not tree-sitter
  ├─ Builds import graph with PageRank centrality
  ├─ Chunks functions/classes/interfaces/types → SQLite
  ├─ Embeds via Ollama (nomic-embed-text, 768d) → sqlite-vec ANN index
  ├─ Starts Bun HTTP server on auto-assigned port
  ├─ Writes .codeview/port + .codeview/pid
  └─ Watches files via fs.watch, marks stale on change
```

### Degraded mode

Without Ollama, structural + keyword search work at full capacity:

```bash
brew install ollama && ollama pull nomic-embed-text  # optional, for semantic search
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

## Development

```bash
bun install
bun test           # 72 tests, 14 files
bun run typecheck  # tsc --noEmit
```

Runtime: ~9s. Ollama embedding tests run live.

### Test fixtures

```
test/fixtures/
├── tiny-project/          # 5 files, 1 tsconfig — unit test target
├── monorepo-project/      # 2 packages, cross-package imports
└── fullstack-monorepo/    # 3 packages, Hono RPC + TanStack Start
```

### Test matrix

| Category | Tests | What |
|----------|-------|------|
| `config` | 5 | cvconfig.json loading, defaults |
| `ts-service` | 6 | Symbol extraction, type info, JSDoc, imports |
| `graph` | 6 | Import graph, inDegree/outDegree, cross-project edges |
| `ranker` | 6 | PageRank, cold-start bootstrap, compression gate |
| `chunker` | 7 | AST → chunks, hash stability, body trimming |
| `repo-map` | 6 | Type info in output, imported-by, grouped by project |
| `search` | 6 | Keyword match, RRF fusion, case insensitive |
| `graph-walk` | 3 | Neighbor budget, max neighbors enforcement |
| `embedding` | 4 | Provider creation, degraded fallback |
| `ollama` | 5 | Reachability check, model detection, batch embed |
| `semantic` | 2 | Chunk indexing, vec0 ANN search |
| `server` | 8 | All HTTP endpoints, /context, /rebuild |
| `cli` | 4 | Help, start daemon, repo-map, find |
| `monorepo` | 4 | Cross-project edges, grouped output, imported-by |
| **Total** | **72** | **14 test files** |

## Contributing

Conventional Commits required. Pre-commit hook runs `bun test`.

```bash
git checkout -b feat/my-feature
# code... (pre-commit runs bun test)
git commit -m "feat: add my feature"
git push → open PR → CI runs (typecheck + test + build + commitlint)
```

See [CODEVIEW_SPEC.md](./docs/CODEVIEW_SPEC.md#15-production-infrastructure) for full production infrastructure details.

## License

MIT © Raman Karki
