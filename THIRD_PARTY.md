# Third-party components

| Component | Where | License |
|---|---|---|
| Electron | runtime | MIT |
| xterm.js (+ addon-fit) | `src/vendor/` | MIT |
| portable-pty | `pty-helper` | MIT |
| serde_json, crossterm | `cli` | MIT / Apache-2.0 |
| yaml-rust2 | `markdown-engine` (front matter) | MIT / Apache-2.0 |
| Rust standard library, wasm-bindgen-free engines | engines | MIT / Apache-2.0 |
| Inno Setup | installer build | Inno Setup License |
| Inherited application code (`src/app.js`, `src/app.css`, `src/main.js`, starter/help pages, language files) | `src/` | original terms of that application; **not** under this project's MIT license; being replaced, see `docs/CORE-REWRITE.md` |
| Source Code Pro (4 faces) | `src/public/fonts/source-code-pro-*.ttf` | SIL Open Font License 1.1 |
| Inter Variable (regular + italic) | `src/public/fonts/inter-variable*.woff2` | SIL Open Font License 1.1 |
| Flow Circular | `src/public/fonts/flow-circular.woff2` | SIL Open Font License 1.1 (HYPD/flow-typeface) |
| pdf.js viewer chrome styles | `src-css/01-pdf-viewer.css` | Apache-2.0 (Mozilla pdf.js), rewritten |
| @codemirror/lint + lint theme (diagnostics panel, gutter markers, tooltips) | inside `src/app.js` bundle (slice s11 items) | MIT |
| @codemirror/merge rebase/change-set helpers (collab module) | inside `src/app.js` bundle (slice s11 items) | MIT |

Public plugin list used by the plugin catalog is read from a public GitHub repository at run time; plugins installed from it keep their own licenses.
