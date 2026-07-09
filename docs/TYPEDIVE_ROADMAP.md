# typedive — Project Rename & Improvement Roadmap

> **Formerly:** codeview → **Now:** typedive
>
> **Rationale:** "Dive into your TypeScript" captures the type-aware depth that differentiates this from Aider, Cursor, and Graphify. Punchy, available on npm (unscoped), 8 characters.

---

## What we learned from Graphify

[Graphify](https://github.com/safishamsi/graphify) is a universal knowledge graph tool. It handles 36 languages, docs, PDFs, images, and video. It runs community detection, generates interactive HTML, and serves as an MCP server. Comparing it against typedive revealed gaps — not in what typedive does (type-aware signatures, vector search, warm daemon are irreplaceable), but in what typedive *could* do on top of its existing data.

typedive already has:
- Full import graph with PageRank centrality
- SQLite chunk store with embeddings
- Per-chunk import edges with cross-project flags
- HTTP API for agents

What it's missing is the *analysis layer* on top of that data. Graphify's value isn't just the extraction — it's the insights it generates: god nodes, surprising connections, community boundaries, architecture reports.

---

## Improvement plan (priority-ordered)

### Tier 1 — High value, low effort

These build directly on existing data. No new extraction needed.

---

#### 1.1 God nodes / hub detection

**What Graphify does:** Identifies the most-connected concepts in the project. "Everything flows through these."

**typedive already has:** PageRank scores on every file, inDegree/outDegree counts, cross-project edge flags.

**Implement:**

| Artifact | Details |
|----------|---------|
| New endpoint | `GET /hubs?topK=5` — returns top N files by PageRank with their inDegree, outDegree, exported symbols |
| `context` response | Add `hubs: HubResult[]` field |
| Repo map | Add `## Key hubs` section showing top 5 files and what imports them |

```typescript
interface HubResult {
  file: string;
  rank: number;
  inDegree: number;
  outDegree: number;
  project: string;
  topImporters: string[];   // top 3 files that import this
  topDependencies: string[]; // top 3 files this imports
}
```

**Success criteria:** `typedive hubs` CLI command. `GET /hubs` HTTP endpoint. Hub list in REPO_REPORT.md.

---

#### 1.2 Surprising connections

**What Graphify does:** Ranks edges by how unexpected they are. Cross-module connections between low-centrality nodes.

**typedive already has:** Cross-project edge flags, PageRank scores per file.

**Implement:** Score each edge by `surprise = 1 / (rank_a × rank_b)` for cross-project edges, or edges between files in different directories that share no common prefix. Expose top N.

| Artifact | Details |
|----------|---------|
| New endpoint | `GET /surprising?topK=5` |
| `context` response | Add `surprising: SurprisingEdge[]` field |
| REPO_REPORT.md | `## Surprising connections` section |

```typescript
interface SurprisingEdge {
  fromFile: string;
  toFile: string;
  fromProject: string;
  toProject: string;
  importedSymbols: string[];
  surpriseScore: number;
}
```

**Success criteria:** `typedive surprising` CLI command. Meaningful results on monorepo test fixture.

---

#### 1.3 Architecture report generation

**What Graphify does:** `GRAPH_REPORT.md` — highlights, key concepts, surprising connections, suggested questions.

**typedive already has:** Graph, PageRank, chunk count, cross-project edges, embedding status.

**Implement:** Generate `.typedive/REPORT.md` on first index and on rebuild. Generated from template + live data.

**Report sections:**
1. **Overview** — chunk count, file count, project count, embedding provider
2. **Key hubs** — top 5 files by PageRank with import counts
3. **Surprising connections** — top 5 cross-project edges by surprise score
4. **Monorepo breakdown** — per-project file counts and cross-project edge counts
5. **Suggested queries** — 4–5 questions the graph can answer
6. **Degraded mode status** — embedding engine reachable?

| Artifact | Details |
|----------|---------|
| CLI | `typedive report` — prints to stdout |
| Auto-generate | On `typedive start` first index |
| Auto-update | On `typedive rebuild` |
| File | `.typedive/REPORT.md` |

**Success criteria:** Report generated on first index. Agent can read `.typedive/REPORT.md` for architecture overview.

---

#### 1.4 Suggested agent queries

**What Graphify does:** 4–5 questions the graph is uniquely positioned to answer.

**Implement:** Auto-generate from graph structure. Templates based on node types present:

```
- "What depends on {topHub}?"
- "What connects {hubA} to {hubB}?"
- "Which files would break if {hub} changes?"
- "What is the full path from {entryFile} to {leafFile}?"
- "Show me all exported symbols in {project}"
```

Include in `REPORT.md` and as `suggestedQueries: string[]` in `/context` response.

**Success criteria:** Realistic, useful queries generated from the actual graph. Agent can copy-paste them as `typedive context "..."` calls.

---

### Tier 2 — Medium value, medium effort

These require new code but no new dependencies.

---

#### 2.1 Community detection (Louvain / label propagation)

**What Graphify does:** Leiden community detection partitions the graph into architectural communities, names them via LLM.

**typedive already has:** Import graph as adjacency list.

**Implement:** Label propagation (simpler than Louvain, good enough for import graphs). Pure TypeScript, no native deps. Each node starts in its own community → iteratively adopts the most common community among its neighbors → converges in <10 iterations.

```typescript
// src/lib/communities.ts
export function detectCommunities(
  graph: GraphMap,
  maxIterations: number = 10
): Map<string, number>;  // file → communityId
```

**Expose:**

| Artifact | Details |
|----------|---------|
| New endpoint | `GET /communities` — returns `{ communities: { id: number, files: string[], topSymbols: string[] }[] }` |
| Repo map | Group by community instead of project (or both, via query param `?groupBy=community`) |
| `context` response | Add `communityId` to each chunk result |
| REPO_REPORT.md | `## Architecture communities` section |

**Community naming:** Heuristic based on top symbols and directory prefix. Example: community with `payment/processor.ts`, `billing/refunds.ts` → named "Payment & Billing".

**Success criteria:** Community detection runs on fullstack-monorepo fixture. Produces 3–5 recognizable communities. Grouping by community in repo map shows architectural boundaries.

---

#### 2.2 Markdown / non-code file extraction

**What Graphify does:** Extracts headings, links, wikilinks from `.md`, `.mdx`, `.txt`, `.rst` files.

**typedive currently:** Only processes TypeScript source files.

**Implement:** Lightweight markdown parser (no external dep — regex-based). Extract:
- `# Heading` → chunk node (kind: "doc-section")
- `[text](./other.md)` → `references` edge
- `[[wikilink]]` → `references` edge
- `# NOTE:`, `# WHY:`, `# HACK:` → special "rationale" nodes linked to the code file they describe

```typescript
// src/lib/markdown-extractor.ts
export function extractMarkdownChunks(
  filePath: string,
  content: string
): MarkdownChunk[];
```

| Artifact | Details |
|----------|---------|
| Extraction | `*.md`, `*.mdx` files found alongside source files |
| Chunks | Each heading = one chunk (kind: `"doc-section"`) |
| Edges | `[link](./file.md)` → `references` edge between doc chunks; `[link](../src/file.ts)` → `references` edge from doc to code |
| Search | Doc chunks are keyword-searchable (no embedding — too few to justify) |
| `context` response | Include relevant doc sections when they link to matched code |

**Success criteria:** Monorepo fixture with a `docs/` directory produces doc chunks linked to code. `typedive search "architecture decision"` returns relevant doc sections.

---

#### 2.3 Interactive graph visualization

**What Graphify does:** `graph.html` — D3 force-graph with clickable nodes, search, filter.

**typedive already has:** HTTP server, import graph data.

**Implement:** Serve a `/viz` HTML page from the existing server. Inline D3 from CDN (or bundle a <20KB force-graph renderer). No new dependency. The page loads graph data from `/graph-data` endpoint.

```
GET /viz          → serves graph.html (inline, no file written to disk)
GET /graph-data   → returns { nodes: GraphDataNode[], edges: GraphDataEdge[] }
```

Features:
- Force-directed layout with PageRank as node radius
- Click node → show its exports, imports, dependents
- Search bar → highlight matching nodes
- Color by project (monorepo) or community (once 2.1 is done)
- Toggle: show/hide cross-project edges

**Success criteria:** `typedive viz` opens browser. Graph renders on fullstack-monorepo fixture. Clicking a node shows its details.

---

### Tier 3 — High value, high effort

These are larger features requiring design decisions.

---

#### 3.1 MCP server

**What Graphify does:** `python -m graphify.serve` exposes the graph as MCP stdio server with structured tools.

**typedive already has:** HTTP API with typed endpoints.

**Implement:** `typedive mcp` subcommand. Starts MCP stdio server. Maps existing HTTP endpoints to MCP tools.

```typescript
// MCP tools:
find_symbol(name: string)        → GET /find?name=
search_code(query: string)        → POST /search
get_references(name: string)      → GET /references?name=
get_repo_map(tokenBudget?: num)   → POST /repo-map
get_context(task: string)         → POST /context
get_hubs(topK?: number)           → GET /hubs
get_surprising(topK?: number)     → GET /surprising
```

No HTTP transport to start — stdio only. HTTP can come later if demand exists.

**Success criteria:** Can register `typedive mcp` in Claude Desktop config. Claude can call `search_code` and `get_context` directly.

---

#### 3.2 Git hooks for auto-rebuild

**What Graphify does:** `graphify hook install` → post-commit hook rebuilds graph.

**typedive already has:** `typedive rebuild` command, Bun.watch for live changes.

**Implement:** `typedive hook install` writes a `.git/hooks/post-commit` script that calls `typedive rebuild` in the background. `typedive hook uninstall` removes it.

**Why:** Embeds get stale after commits. Auto-rebuild keeps embeddings fresh without manual intervention. Different from Bun.watch — Bun.watch handles live edits during dev; the hook handles after-commit consistency.

**Success criteria:** After `typedive hook install`, committing a change triggers background re-index. Semantic search returns results for new symbols.

---

#### 3.3 Graph query language (shortest path, neighborhood)

**What Graphify does:** `graphify path "A" "B"` finds shortest path between nodes. `graphify explain "X"` shows neighborhood.

**Implement:** Two new CLI commands and endpoints.

```
typedive path <fromName> <toName>
typedive explain <name>
```

| Endpoint | Returns |
|----------|---------|
| `GET /path?from=X&to=Y` | `{ path: string[], length: number }` — shortest import chain |
| `GET /explain?name=X` | `{ symbol, importedBy, dependsOn, sameFile, communityContext }` |

**Success criteria:** `typedive path "processPayment" "DatabasePool"` returns the import chain connecting them.

---

### Tier 4 — Not implementing (by design)

| Graphify feature | Why skip |
|-----------------|----------|
| Multi-language support (36 tree-sitter grammars) | typedive's USP is ts-morph type info. Tree-sitter would lose type signatures — the one thing no other tool has |
| PDF, image, video, Office extraction | Needs LLM API calls. typedive is local-first. Out of scope |
| Cloud LLM backends for semantic extraction | typedive already has Ollama/OpenAI/Voyage for *embeddings*. Semantic extraction of docs would be a different feature |
| Obsidian vault generation | typedive is for coding agents, not knowledge management for humans |
| Cross-project global graph (`graphify global add`) | Premature. Single-repo daemon model is correct for now |
| PR dashboard (`graphify prs`) | Interesting but outside typedive's scope (codebase intelligence, not GitHub workflow tool) |
| Call flow diagrams (`graphify export callflow-html`) | Could be added later if demand exists. Lower priority than items above |

---

## Rename checklist

```
[ ] Rename npm package: @ramankarki/codeview → typedive
[ ] Update package.json: name, bin, description, keywords, repository
[ ] Rename CLI binary: codeview → typedive
[ ] Rename config file: cvconfig.json → typedive.json (keep cvconfig.json as fallback)
[ ] Rename data directory: .codeview/ → .typedive/
[ ] Update all source code: string references, imports, comments
[ ] Update test files and fixtures
[ ] Update README.md
[ ] Update CODEVIEW_SPEC.md → TYPEDIVE_SPEC.md
[ ] Update CHANGELOG.md (breaking change: rename)
[ ] Update CI workflow badges and references
[ ] Update .gitignore: .codeview/ → .typedive/
[ ] New npm publish as typedive v2.0.0
[ ] Deprecation notice on @ramankarki/codeview pointing to typedive
```

---

## Implementation order

```
Phase A: God nodes + surprising connections + report + suggested queries
         (Tier 1 complete — 1.1 through 1.4)
         → typedive becomes insight-generating, not just query-answering

Phase B: Community detection + markdown extraction + graph viz
         (Tier 2 complete — 2.1 through 2.3)
         → typedive reveals architecture + documentation

Phase C: MCP server + git hooks + graph queries
         (Tier 3 complete)
         → typedive integrates everywhere + stays fresh
```

---

## Success metrics (post-implementation)

| Metric | Current (codeview) | Target (typedive) |
|--------|--------------------|--------------------|
| Agent round-trips per task | 75% fewer (vs blank) | 80% fewer (hub/surprise context eliminates discovery reads) |
| Files read per task | 50% fewer | 60% fewer (community context groups related files) |
| First-time architecture understanding | Agent reads README | Agent reads `.typedive/REPORT.md` |
| Cross-module awareness | Agent discovers by trial | Agent gets surprising connections in context |
| MCP integration | Not supported | Native MCP tool for any MCP agent |
