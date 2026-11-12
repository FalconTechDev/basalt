# Replacing the inherited core

Basalt started as a patched copy of Obsidian 1.12.7 (Electron). About 92% of the JavaScript that ships (`src/app.js`, ~7.5 MB)
is still that code; everything in `basalt-*.js`, `fp-canvas.js`, `fp-graph.js`, `vault-sync.js` and the Rust/WASM engines is ours.
`node tools/obsidian-audit.mjs --files` lists what still carries the old name (626 mentions today, by kind).

Removing the name from strings is cheap, but the code itself stays Obsidian's until it is replaced. Obsidian's licence does not allow
redistributing or modifying the app, so a public release is only clean once the inherited code is gone.

## Order of replacement (each piece keeps the file formats: plain Markdown, `.canvas` JSON)
1. **Shell**: tabs, panes, file explorer, quick switcher, settings, start screen (start screen, pins, tabs styling already ours).
2. **Search, graph, history, sync, terminal, canvas drawing**: done (own code and Rust/WASM).
   The **Markdown worker** (`src/worker.js`: links, tags, headings, sections and the reading-view HTML) is done too: `markdown-engine`
   (Rust/WASM) behind a small shim, built by `build-markdown.mjs`, checked against the old worker with `tools/worker-compare.mjs`.
3. **Editor and preview**: CodeMirror 6 (MIT) for editing, an open Markdown parser for preview, own live-preview rules.
4. **Canvas model** (cards, edges, undo): the drawing is ours, the data model and interaction layer are still inherited.
5. **Plugin host**: our own API. Community plugins are written for the old API, so a thin compatibility layer
   (one file, clearly named) stays as long as those plugins are wanted; Wasm plugins use the new API only.
6. **Main process** (`main.js`): windows, vault registry, CLI pipe, protocol handler.

Each step ships on its own: the old and new pieces run side by side until the new one covers the old behaviour.
