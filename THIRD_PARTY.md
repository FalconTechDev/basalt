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
| CodeMirror 5 + addons (vim, search, dialog, markdown mode) | `src/lib/codemirror/` | MIT |
| CodeMirror 6 / @codemirror/* and @lezer/* (state, view, language, incremental parser) | inside `src/app.js` | MIT |
| Lezer parser runtime (stack, mixed stream, node props, style tables) | inside `src/app.js` | MIT |
| moment.js | inside `src/app.js`, `src/lib/moment.min.js` | MIT |
| yaml (eemeli) | inside `src/app.js` | ISC |
| tslib helpers (`__awaiter`, `__generator`) | inside `src/app.js` | 0BSD |
| i18next | `src/lib/i18next.min.js` | MIT |
| PIXI.js 7.2.4 | `src/lib/pixi.min.js` | MIT |
| Mermaid | `src/lib/mermaid.min.js` | MIT |
| Prism | `src/lib/prism.min.js` | MIT |
| Turndown | `src/lib/turndown.js` | MIT |
| Mozilla Readability | `src/lib/readability.js` | Apache-2.0 |
| d3 | inside `src/app.js` (graph/canvas helpers) | ISC |
| Fuse.js | inside `src/app.js` (search ranking) | Apache-2.0 |

Public plugin list used by the plugin catalog is read from a public GitHub repository at run time; plugins installed from it keep their own licenses.
