# Changelog

## [1.1.0](https://github.com/ramankarki/codeview/compare/v1.0.0...v1.1.0) (2026-06-09)

### Features

- monorepo support with grouped project output
- graph walk augmentation for context endpoint
- hybrid retrieval with reciprocal rank fusion
- degraded mode fallback for keyword-only search
- real-time memory usage command (`codeview mem`)
- embedding provider support (ollama, openai, voyage)
- file watching with stale markers for incremental updates

### Bug Fixes

- cross-package import resolution for monorepo workspaces
- macOS Brew SQLite detection for sqlite-vec extension loading
- idle timer cleanup on server stop
- port file cleanup on daemon shutdown

## 1.0.0 (2026-06-08)

### Features

- initial release: type-aware repo maps, semantic code search via Ollama
- ts-morph powered AST extraction with full type signatures
- sqlite-vec vector storage with ANN search
- HTTP API for agent integration
- CLI with start, stop, status, search, find, references, context commands
- PageRank-based file ranking with cold start bootstrap
- token-budgeted repo map compression
