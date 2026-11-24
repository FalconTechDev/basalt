# Third-party components and inherited code

Audit of 2026-11-24, done on the working tree and the git history. "Not verified" means the licence was taken from the
upstream project name or a header comment and was not checked against the exact upstream release.

Basalt is **not affiliated with, endorsed by or sponsored by Obsidian / Dynalist Inc.** It started as a patched fork of the closed-source
Obsidian desktop app (version 1.12.7) and has since been largely rewritten. See section 1 for what of that origin still ships.

## 1. Inherited code that is NOT covered by the project licence

Obsidian is proprietary software. Its licence does not allow redistributing or modifying the app. The pieces below still derive from it.
They stay in the repository because the app does not run without them. **A public release of a build that contains them is not covered
by this project's AGPL-3.0 licence and may not be allowed by Obsidian's terms.** This is an open legal question for the owner (see the
report that came with this audit).

| Item | Where | State |
|---|---|---|
| Remaining original application code | `src/app.js` (generated: own modules from `src-app/` are spliced into the inherited minified bundle by `build-app.mjs`) | Measured on the file as it is (`node tools/inherited-stats.mjs`, no git needed): 74.3 % own modules, 1.4 % glue, 21.1 % third-party libraries (section 2), **3.0 % (about 172 KB) still Obsidian's code**, 0.2 % separators. Of the ORIGINAL bundle, 60.4 % by size has been replaced (`node tools/own-stats.mjs`, needs git history). The list of what remains and the order to replace it: `docs/REPLACING_INHERITED_CODE.md`. `build-app.mjs` no longer reads git history unless a new entry is added to `src-app/manifest.json` (see that document); the history still holds the original bundle (`d89c49d` .. `ca5acac`). |
| Stylesheet | `src/app.css` (generated), `src-css/*` | Derived from the original `app.css` (split into components, partly rewritten). Class names and many rules are the original's. |
| English interface strings | `src/i18n.js` | Derived from the original string table (reworded in part). The Russian table `src/i18n-ru.js` is Basalt's own translation. |
| Plugin API compatibility layer | names such as `registerObsidianProtocolHandler`, `getObsidianUrl`, class `obsidian-app`, `.obsidian` config folder, `obsidian://` links, community plugin lists from `github.com/obsidianmd/obsidian-releases` | Names and compatibility shims only (see section 4). |
| Stock Electron runtime | `runtime/` (not tracked) is created by `run.ps1` from the official `electron-v39.8.6-win32-x64.zip`: `electron.exe` renamed to `Basalt.exe`, only the en-US and ru locales kept, icon replaced | Nothing from Obsidian's install is copied any more (the former Obsidian-built runtime and its `btime`/`get-fonts` modules are gone). `LICENSE` and `LICENSES.chromium.html` ship. |
| Logo | `branding/*`, `src/icon.png`, `src/basalt-logo.png`, `cli/src/logo.rs` | Basalt's own logo (a faceted bronze gem), confirmed by the project owner as original work. |

Files that were derived from or contained verbatim Obsidian text and were removed from the working tree in this cleanup (still in the git
history): `i18n-fix/` (the original English strings next to the rewrites), `docs/APP-MAP.md` (structure map of the original bundle),
`tools/s48-*.txt` (original method lists), the i18n helper scripts that read the original files, `docs/handoff/` (an archive of
sources). `src/app.js.orig` (the untouched original bundle) and the original help vault were already removed from the tree earlier but
live in the history (commits `d89c49d` .. `ca5acac`).

## 2. JavaScript and assets that ship in the app

The libraries that sit inside `src/app.js` are located, sized and hashed in `vendor/MANIFEST.json`; their licence texts are in `vendor/licenses/` and verified copies of the
webpack modules and the Lucide table are in `vendor/` (see `vendor/README.md`). Versions and copyright lines of those libraries were not read from the shipped bytes (the bundler
stripped every banner); they must be confirmed against the pinned upstream release before a public build.

| Component | Version | Licence | Where | Notice kept in file / next to it | Compatible |
|---|---|---|---|---|---|
| CodeMirror 5 (+ addons, modes, vim keymap) | 5.64.0 | MIT | `src/lib/codemirror/` | yes (headers) | yes |
| CodeMirror 6 (`@codemirror/state`, `view`, `language`, `commands`, `search`, `autocomplete`, `lint`, ...) and Lezer (`@lezer/common`, `highlight`, `lr`) | not recoverable from the minified code (6.x / 1.x) | MIT | inside `src/app.js` (about 530 KB: state/view 272 KB, commands/search 56 KB, language 115 KB in two copies, autocomplete 41 KB, lr 29 KB, lint 15 KB) | licences in `vendor/licenses/codemirror6.txt`, `lezer.txt` | yes |
| @replit/codemirror-vim, codemirror-search-panel | not found in `src/app.js` any more (Vim mode uses the CodeMirror 5 vim keymap in `src/lib/codemirror/` through an inherited adapter) | MIT | - | - | - |
| moment.js with locales | 2.29.4 | MIT | `src/lib/moment.min.js` (app.js only reads `window.moment`; it is not inside it) | version comment only | yes, add notice |
| yaml (eemeli) | v2.x (not recoverable) | ISC | inside `src/app.js` (95 KB: lexer, parser, composer, schema, stringify) | `vendor/licenses/yaml.txt` | yes |
| tslib (helpers `__extends`, `__awaiter`, `__generator`, ...) | not recoverable | 0BSD | inside `src/app.js` (4 KB) | `vendor/licenses/tslib.txt` | yes |
| DOMPurify | 3.0.1 | Apache-2.0 OR MPL-2.0 (used under Apache-2.0) | inside `src/app.js` (19 KB) | `vendor/licenses/dompurify.txt`, `Apache-2.0.txt` | yes; the Apache NOTICE is not shipped separately (upstream has none) |
| Turndown | 7.2.0 | MIT | `src/lib/turndown.js` (app.js only holds the rules added on top, about 6 KB, which are inherited) | URL comment only | yes, add notice |
| Mozilla Readability | not recorded | Apache-2.0 | `src/lib/readability.js` | yes (header) | yes |
| i18next | not recorded | MIT | `src/lib/i18next.min.js` | no | yes, add notice |
| scrypt-js | commit 3f106c1 | MIT | `src/lib/scrypt.js` | source URL only | yes, add notice |
| diff-match-patch (Google) | not recoverable | Apache-2.0 | inside `src/app.js` (19 KB) | `vendor/licenses/diff-match-patch.txt`, `Apache-2.0.txt` | yes |
| crypto-js (`enc.Hex`, `HmacSHA256`) | 3.x or 4.x | MIT | webpack modules in `src/app.js`, copy in `vendor/webpack-modules/crypto-js.js` | `vendor/licenses/crypto-js.txt` | yes |
| d3 modules (force, quadtree, ...) | not recorded | ISC | `src/sim.js` only (no d3 code is left in `src/app.js`) | no | yes, add notice |
| Lucide icons (and the Feather parts) | not recoverable (1874 entries) | ISC / MIT | table inside `src/app.js` (282 KB), copy in `vendor/lucide/icons.js` | `vendor/licenses/lucide.txt` | yes |
| unified / remark family (remark-parse 8-style tokenizer, mdast-util-to-hast, hast-util-to-html, property-information, vfile, unist-util-*, parse-entities, ... 165 modules, 110 KB) | not recoverable | MIT | webpack modules, copy in `vendor/webpack-modules/unified-remark.js` | `vendor/licenses/unified-remark.txt` | yes |
| idb | v7.1+ (not recoverable) | ISC | inside `src/app.js` (about 4 KB left; Obsidian's wrapper code around it was already replaced) | `vendor/licenses/idb.txt` | yes |
| ts-ebml + ebml-block, buffer, events, ieee754, base64-js, int64-buffer, is-buffer (webm duration fix; 18 modules, 108 KB) | not recoverable | MIT / BSD-3-Clause (ieee754) | webpack modules, copies in `vendor/webpack-modules/ts-ebml.js`, `node-polyfills.js` | `vendor/licenses/ts-ebml.txt`, `node-polyfills.txt` | yes |
| @capacitor/core, async-mutex and a secure-storage plugin (5 modules, 17 KB) | not recoverable; the secure-storage plugin is not identified | MIT (secure-storage: not verified) | webpack modules, copy in `vendor/webpack-modules/capacitor.js` | `vendor/licenses/capacitor.txt` | identify the plugin first |
| PixiJS (`@pixi/core`, `@pixi/math`, `@pixi/unsafe-eval`, ...) | 7.x (exact build not recorded) | MIT | `src/lib/pixi.min.js` | partial (one MIT line) | yes |
| Mermaid | 11.4.1 (one local patch, see the first line of the file) | MIT, bundles d3, dagre, DOMPurify (Apache-2.0/MPL-2.0), khroma, lodash, etc. | `src/lib/mermaid.min.js` | partial | yes, add notices |
| MathJax (`tex-chtml-full`) + its web fonts | 3.2.2 | Apache-2.0 (fonts: see MathJax repo, not verified) | `src/lib/mathjax/` | header mention only | yes; Apache NOTICE not shipped |
| PrismJS (many languages) | 1.30.0 | MIT | `src/lib/prism.min.js` | download-URL comment | yes, add notice |
| reveal.js | 4.3.1 | MIT | `src/lib/reveal/` | yes | yes |
| pdf.js (viewer, worker) | 5.3.34 | Apache-2.0 | `src/lib/pdfjs/` | yes (headers) | yes |
| pdf.js CMaps (Adobe) | with pdf.js | BSD-3-Clause (Adobe) | `src/lib/pdfjs/cmaps/` | no licence file in the folder | yes, add licence |
| pdf.js standard fonts: Liberation Sans | with pdf.js | SIL OFL 1.1 | `src/lib/pdfjs/standard_fonts/` | yes (`LICENSE_LIBERATION`) | yes |
| pdf.js standard fonts: Foxit | with pdf.js | PDFium BSD-style | `src/lib/pdfjs/standard_fonts/*.pfb` | yes (`LICENSE_FOXIT`) | yes |
| OpenJPEG, qcms (wasm) and ICC profile | with pdf.js | BSD-2-Clause / MIT / CC0 | `src/lib/pdfjs/wasm/`, `iccs/` | yes | yes |
| xterm.js + addon-fit | not recorded | MIT | `src/vendor/` | yes (`xterm.LICENSE`) | yes |
| Yjs, lib0, y-protocols, y-webrtc, Trystero (+ torrent strategy) and their dependencies | not recorded (the entry file `tools/yjs-bundle-entry.js` has no pinned versions) | MIT (transitive: BSD, ISC) | `src/lib/yjs-bundle.js`, `cli/vendor/yjs-bundle.js` (identical) | partial | yes, add notices |
| Inter Variable (regular, italic) | not recorded | SIL OFL 1.1 | `src/public/fonts/inter-variable*.woff2` | no licence file | yes, add licence |
| Source Code Pro (4 faces) | not recorded | SIL OFL 1.1 | `src/public/fonts/source-code-pro-*.ttf` | no licence file | yes, add licence |
| Flow Circular | not recorded | SIL OFL 1.1 | `src/public/fonts/flow-circular.woff2` | no licence file | yes, add licence |
| Easylist / EasyPrivacy filter lists | downloaded at run time | GPL-3.0 / CC BY-SA 3.0 | fetched by `src/main.js`, not shipped | n/a | not redistributed |

## 3. Native and build-time components

| Component | Version | Licence | Where | Notes |
|---|---|---|---|---|
| Electron | 39.8.3 (measured in the headless run; Chromium 142.0.7444.265) | MIT | `runtime/` (not tracked, shipped by the installer) | `LICENSE.electron.txt` ships |
| Chromium and its dependencies | with Electron | BSD-3-Clause and others | `runtime/` | `LICENSES.chromium.html` ships |
| @electron/remote | 2.1.3 | MIT | `stub/node_modules/` (not tracked) | shipped inside `resources/app` |
| node-addon-api | not recorded | MIT | `stub/node_modules/` | only needed to build the removed native modules |
| Inno Setup | 6 | Inno Setup License (free) | installer build only | not shipped |
| Rust standard library and toolchain | stable | MIT OR Apache-2.0 | all crates | |
| `portable-pty` 0.8.1 + 30 crates | see `pty-helper/Cargo.lock` | MIT / Apache-2.0 / Unicode-3.0 | `pty-helper` (`src/bin/basalt-pty.exe`) | all permissive |
| `crossterm` 0.27, `serde_json` 1 + 50 crates | see `cli/Cargo.lock` | MIT / Apache-2.0 / Unlicense / Unicode-3.0 | `cli` (`src/bin/basalt*.exe`) | all permissive |
| `yaml-rust2` 0.10.4, `hashbrown`, `hashlink`, `arraydeque`, `foldhash` (Zlib) | see `markdown-engine/Cargo.lock` | MIT OR Apache-2.0 / Zlib | `markdown-engine` (compiled into `src/worker.js`) | all permissive |
| `fp-core`, `fp-graph` | 0.1.0 | MIT OR Apache-2.0 | `../falconplot/crates/` (the owner's own **sibling repository**, path dependency, kept on purpose) | `graph-engine` and `canvas-engine` do not build without it |
| `app-core`, `search-engine`, `plugins-sdk/hello-wasm` | | no dependencies | own code | |
| postcss, postcss-selector-parser, nanoid, picocolors, util-deprecate, pngjs | see `tools/package-lock.json` | MIT / ISC | `tools/` (dev only, not shipped) | |
| lightningcss | ^1.33 | MPL-2.0 | `tools/` (dev only, not shipped) | |
| source-map-js | | BSD-3-Clause | `tools/` (dev only) | |
| acorn, acorn-walk | 8.14.0 / 8.3.4 | MIT | `tools/` (dev only) | |
| detect-libc | | Apache-2.0 | `tools/` (dev only) | |

Run-time services: the community plugin catalog is read from `github.com/obsidianmd/obsidian-releases` and a public plugin list;
plugins installed from them keep their own licences.

## 4. Obsidian names that stay, and why

| Item | Why it stays | Recommendation |
|---|---|---|
| `app://obsidian.md/` host (`APP_HOST` in `src/main.js`) | It is the origin of the app page. localStorage / IndexedDB of every existing installation are keyed to it, so renaming it would reset user settings. Not changed. | Keep for now; change together with a migration of local storage if a clean name is wanted. |
| `obsidian://` URI handler, `getObsidianUrl` and the plugin API names | Compatibility with community plugins and with links made for other apps. | Keep, documented here. |
| `.obsidian` folder read as a fallback and copied once to `.basalt` | Lets users open an existing vault. | Keep. |
| Crypto labels (`ObsidianAesSivEnc`, `ObsidianKeyHash`, ...) | Changing them would make existing encrypted data unreadable. | Keep. |
| `src/package.json` version `1.12.7`, `ng32ApiVersion` | Plugin compatibility checks. | Keep. |
| `tools/obsidian-audit.mjs`, build scripts, docs | Describe the origin. | Keep. |

## 5. Licence texts

MIT, ISC and the other licences are those of the upstream projects; copyright holders are the authors named in each project.
Standard texts: MIT https://opensource.org/license/mit, ISC https://opensource.org/license/isc-license-txt, 0BSD https://opensource.org/license/0bsd,
BSD-2/3 https://opensource.org/license/bsd-3-clause, Apache-2.0 https://www.apache.org/licenses/LICENSE-2.0,
MPL-2.0 https://www.mozilla.org/MPL/2.0/, SIL OFL 1.1 https://openfontlicense.org/open-font-license-official-text/.

The text of the MIT licence, which most of the components above use:

```
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files
(the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## 6. Still to do before a release

* Ship `vendor/licenses/` with the installer and add the remaining notices marked "add notice" / "add licence" above. Confirm the copyright lines in `vendor/licenses/*.txt` against the pinned upstream releases.
* Pin and record versions of the bundled libraries (`tools/yjs-bundle-entry.js` has no `package.json` for its npm dependencies).
* Decide what to do with the inherited code of section 1 (replace it, get permission, or do not publish builds).
