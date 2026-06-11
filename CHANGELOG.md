# Changelog

## [1.2.1](https://github.com/ramankarki/codeview/compare/codeview-v1.2.0...codeview-v1.2.1) (2026-06-11)


### Bug Fixes

* npm publish ([011abbe](https://github.com/ramankarki/codeview/commit/011abbe4178b0aee4df3a81f87e9cbbf3178c70e))

## [1.2.0](https://github.com/ramankarki/codeview/compare/codeview-v1.1.0...codeview-v1.2.0) (2026-06-11)


### Features

* add color system, help command, mem command ([d276cd4](https://github.com/ramankarki/codeview/commit/d276cd419641e6a9955a0fd048549cac5b8aff51))
* add cvconfig.example.json, document cross-platform support ([cc72150](https://github.com/ramankarki/codeview/commit/cc72150dba22dcdbaedfb56b2245258b39a94572))
* initial release — type-aware repo maps + Ollama semantic search ([bb8301a](https://github.com/ramankarki/codeview/commit/bb8301a5367d99c2edf8d30b2c36dd1cadb93c3c))
* production infrastructure, build optimization, stricter types ([30acc9d](https://github.com/ramankarki/codeview/commit/30acc9d8a2a7afd71850040ecb7e0a42358679b3))


### Bug Fixes

* bundle server-daemon for production, rename cgconfig→cvconfig, slim npm package ([f39b73b](https://github.com/ramankarki/codeview/commit/f39b73bcca815f7c0d667d870b321fcb0fa955fe))
* **ci:** add setup-node for OIDC auth, fix checkout@v6 -&gt; v4 ([8183c20](https://github.com/ramankarki/codeview/commit/8183c208f85abf6eb9a4258cd7aa5bd451745e88))
* deduplicate 11MB bundle and enforce codeview-first agent rules ([33fe14f](https://github.com/ramankarki/codeview/commit/33fe14f9be268b31530b65f12c0ea47681863dae))


### Documentation

* add table of contents to README ([db6d80f](https://github.com/ramankarki/codeview/commit/db6d80fe439f92317c6ed2ea5134682c72b2d39f))
* reference cvconfig.example.json in README ([0eaff6d](https://github.com/ramankarki/codeview/commit/0eaff6defb7b5ae5863d546c49494c4a3abd7feb))
* reorder README sections for better flow ([c755eb3](https://github.com/ramankarki/codeview/commit/c755eb3fd511cea142fa38ef10363fb059ade825))

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
