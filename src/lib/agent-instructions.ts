/**
 * Generate AGENTS.md snippet for codeview integration.
 * Intended to be copied into the user's AGENTS.md or system prompt.
 */
export function generateAgentInstructions(port?: number): string {
  const portNote = port ? ` (port ${port})` : " (auto-assigned, read from .codeview/port)";
  return `## Codebase intelligence (codeview)

codeview is a local codebase intelligence server that gives you
type-aware repo maps and semantic code search before you write any code.
It auto-starts and auto-stops — you never need to manage it manually.

### Routine (do this at the start of every coding session)

1. Call \`codeview start\` — idempotent, exits immediately if already running${portNote}
2. For every task, call \`codeview context "<task description>"\`
3. Inject the returned repo map + semantic matches + related code into your system prompt
4. Write code with full context already loaded — no exploratory file reads needed

### What you get

\`codeview context "add Stripe webhook"\` returns:

1. **Repo map** — every exported function/class/interface/type with full type signatures,
   ranked by import centrality, grouped by package (monorepo-aware).
   Shows \`[imported by: ...]\` so you know dependencies.
2. **Semantic matches** — code chunks closest to your task description,
   via local Ollama embeddings (nomic-embed-text) or keyword fallback.
   Each result has distance score — lower = better match.
3. **Related code** — import neighbors from graph walk (depth=1, top 5 per node).

### Quick lookups (after context, while coding)

\`\`\`bash
codeview find <name>           # exact location: file, line, type signature
codeview references <name>     # every file that imports this symbol
codeview search "<query>"      # semantic + keyword hybrid (top 10)
codeview repo-map              # full structural map (no query, full detail)
\`\`\`

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
