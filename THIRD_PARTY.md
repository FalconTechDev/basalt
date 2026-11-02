# Third-party components

| Component | Where | License |
|---|---|---|
| Electron | runtime | MIT |
| xterm.js (+ addon-fit) | `src/vendor/` | MIT |
| portable-pty | `pty-helper` | MIT |
| serde_json, crossterm | `cli` | MIT / Apache-2.0 |
| Rust standard library, wasm-bindgen-free engines | engines | MIT / Apache-2.0 |
| Inno Setup | installer build | Inno Setup License |
| Inherited application code (`src/app.js`, `src/app.css`, `src/main.js`, starter/help pages, language files) | `src/` | original terms of that application; **not** under this project's MIT license; being replaced, see `docs/CORE-REWRITE.md` |

Public plugin list used by the plugin catalog is read from a public GitHub repository at run time; plugins installed from it keep their own licenses.
