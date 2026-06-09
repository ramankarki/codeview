/**
 * Generate AGENTS.md snippet for codeview integration.
 * Designed to be placed at the TOP of the agent's instructions,
 * establishing codeview as the primary source of truth for the codebase.
 */
export function generateAgentInstructions(port?: number): string {
  const portNote = port ? ` (port ${port})` : " (auto-assigned, read from .codeview/port)";
  return `## Codebase intelligence — codeview (PRIMARY SOURCE OF TRUTH)

**RULE: codeview is the first and primary way you understand this codebase.
Use it BEFORE reading any file, running any grep, or exploring anything manually.**

### The codeview-first workflow (MANDATORY for every task)

1. \`codeview start\` — idempotent, exits immediately if already running${portNote}
2. \`codeview context "<your task description>"\` — returns everything you need
3. Inject the output (repo map + semantic matches + related code) into your context
4. Write code with full context loaded — no blind file reads, no guessing

**ANTI-PATTERNS (DO NOT DO):**
- ❌ Reading files one-by-one to "understand" the codebase
- ❌ Using grep/rg to find symbols before consulting codeview
- ❌ Guessing a function exists without checking \`codeview find\`
- ❌ Exploring directory trees manually when \`codeview repo-map\` exists

### What \`codeview context "add Stripe webhook"\` returns

1. **Repo map** — every exported function/class/interface/type with full type signatures,
   ranked by import centrality, grouped by package (monorepo-aware).
   Shows \`[imported by: ...]\` so you know dependencies cold.
2. **Semantic matches** — code chunks closest to your task description,
   via local Ollama embeddings (nomic-embed-text) or keyword fallback.
   Each result has distance score — lower = better match.
3. **Related code** — import neighbors from graph walk (depth=1, top 5 per node).

### Quick lookups (use during coding, after context)

\`\`\`bash
codeview find <name>           # exact location: file, line, type signature
codeview references <name>     # every file that imports this symbol
codeview search "<query>"      # semantic + keyword hybrid (top 10)
codeview repo-map              # full structural map (no query, full detail)
\`\`\`

### When to read files directly

Only AFTER codeview gives you the exact file path and line. Read only the
specific region you need (use offset/limit). Never read entire files cold.

### Server lifecycle (rarely needed)

\`\`\`bash
codeview status   # is it running? how many chunks? Ollama reachable?
codeview rebuild  # drop index, re-extract AST and re-embed from scratch
codeview stop     # manual shutdown (auto-stops after 30min idle anyway)
\`\`\`

### No Ollama? No problem

codeview enters degraded mode automatically — structural map + keyword search
still work at full capacity. To enable semantic search:
\`\`\`bash
brew install ollama && ollama pull nomic-embed-text
\`\`\`
`;
}
