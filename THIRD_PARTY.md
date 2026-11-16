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
| CodeMirror 5 + addons (incl. vim mode, dialogs, search) | bundled inside `src/app.js` | MIT (Marijn Haverbeke / CodeMirror contributors) |
| CodeMirror 6 + @codemirror/* (state, view, commands, autocomplete, language, search) | bundled inside `src/app.js` | MIT (Marijn Haverbeke / CodeMirror contributors) |
| Lezer + @lezer/* (parser, common, highlight, markdown) | bundled inside `src/app.js` | MIT (Marijn Haverbeke / CodeMirror contributors) |
| HyperMD-style markdown inline helpers | bundled inside `src/app.js` | MIT (the-simian / HyperMD contributors) |
| moment.js | bundled inside `src/app.js` | MIT (Tim Wood, Iskren Chernev, Moment.js contributors) |
| yaml (eemeli) | bundled inside `src/app.js` | ISC (Eemeli Aro) |
| tslib helpers | bundled inside `src/app.js` | Apache-2.0 (Microsoft) |
| pdf.js rules | bundled inside `src/app.js` | Apache-2.0 (Mozilla) |

| CodeMirror 6 + Lezer | inside inherited `src/app.js` (editor) | MIT |
| CodeMirror 5 modes (incl. `hypermd`) | inside inherited `src/app.js` (`CodeMirror.getMode`) | MIT |
| diff-match-patch | inside inherited `src/app.js` (`dA`) | Apache-2.0 |
| DOMPurify | inside inherited `src/app.js` (publish sanitizing) | Apache-2.0 / MPL-2.0 |

| tslib (`__awaiter` helper, webpack module 9547 inside `src/app.js`) | `src/app.js` | 0BSD |

Public plugin list used by the plugin catalog is read from a public GitHub repository at run time; plugins installed from it keep their own licenses.
