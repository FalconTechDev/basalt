# Third-party components and inherited code

Audit of 2026-11-24, done on the working tree and the git history. "Not verified" means the licence was taken from the
upstream project name or a header comment and was not checked against the exact upstream release.

Basalt is **not affiliated with, endorsed by or sponsored by Obsidian / Dynalist Inc.** It started as a patched fork of the closed-source
Obsidian desktop app (version 1.12.7) and has since been largely rewritten. See section 1 for what of that origin still ships.

## 1. Inherited code that is NOT covered by the project licence

Obsidian is proprietary software. Its licence does not allow redistributing or modifying the app. The pieces below still derive from it.
They stay in the repository because the app does not run without them. **A public release of a build that contains them is not covered
by this project's MIT licence and may not be allowed by Obsidian's terms.** This is an open legal question for the owner (see the
report that came with this audit).

| Item | Where | State |
|---|---|---|
| Remaining original application code | `src/app.js` (generated: own modules from `src-app/` are spliced into the inherited minified bundle by `build-app.mjs`) | About 60 % of the original bundle by size is replaced (`node tools/own-stats.mjs`); the rest is still the original minified code, a large part of it third-party libraries (section 2). `build-app.mjs` reads the original from git history (`src-app/manifest.json` -> `base`), so the history is part of the build. |
| Stylesheet | `src/app.css` (generated), `src-css/*` | Derived from the original `app.css` (split into components, partly rewritten). Class names and many rules are the original's. |
| English interface strings | `src/i18n.js` | Derived from the original string table (reworded in part). The Russian table `src/i18n-ru.js` is Basalt's own translation. |
| Plugin API compatibility layer | names such as `registerObsidianProtocolHandler`, `getObsidianUrl`, class `obsidian-app`, `.obsidian` config folder, `obsidian://` links, community plugin lists from `github.com/obsidianmd/obsidian-releases` | Names and compatibility shims only (see section 4). |
| Obsidian-built runtime | `runtime/` (not tracked) is created by `run.ps1` from an installed Obsidian: its Electron build renamed to `Basalt.exe`, plus its native modules `btime` and `get-fonts` (package.json: `UNLICENSED`) | The installer builder no longer copies `btime` and `get-fonts` (both are optional). The renamed `Obsidian.exe` is Obsidian's repackaging of Electron; for a release use a stock Electron build of the same version instead. |
| Logo | `branding/*`, `src/icon.png`, `src/basalt-logo.png`, `icon.ico`, `cli/src/logo.rs` | A faceted gem in bronze. Its design origin was not determined by this audit; check that it is not a recoloured copy of the Obsidian gem. |

Files that were derived from or contained verbatim Obsidian text and were removed from the working tree in this cleanup (still in the git
history): `i18n-fix/` (the original English strings next to the rewrites), `docs/APP-MAP.md` (structure map of the original bundle),
`tools/s48-*.txt` (original method lists), the i18n helper scripts that read the original files, `docs/handoff/` (an archive of
sources). `src/app.js.orig` (the untouched original bundle) and the original help vault were already removed from the tree earlier but
live in the history (commits `d89c49d` .. `ca5acac`).

## 2. JavaScript and assets that ship in the app

| Component | Version | Licence | Where | Notice kept in file / next to it | Compatible |
|---|---|---|---|---|---|
| CodeMirror 5 (+ addons, modes, vim keymap) | 5.64.0 | MIT | `src/lib/codemirror/` | yes (headers) | yes |
| CodeMirror 6 (`@codemirror/*`) and Lezer (`@lezer/*`) | not recorded | MIT | inside `src/app.js` | no (banners stripped by the bundler) | yes, add notice |
| @replit/codemirror-vim, codemirror-search-panel | not recorded | MIT | inside `src/app.js` | no | yes, add notice |
| moment.js with locales | 2.29.4 | MIT | `src/lib/moment.min.js`, also inside `src/app.js` | version comment only | yes, add notice |
| yaml (eemeli) | not recorded | ISC | inside `src/app.js` | no | yes, add notice |
| tslib | not recorded | 0BSD | inside `src/app.js` | no | yes |
| DOMPurify | 3.0.1 | Apache-2.0 OR MPL-2.0 | inside `src/app.js` | no | yes; Apache NOTICE not shipped |
| Turndown | 7.2.0 | MIT | `src/lib/turndown.js`, inside `src/app.js` | URL comment only | yes, add notice |
| Mozilla Readability | not recorded | Apache-2.0 | `src/lib/readability.js` | yes (header) | yes |
| i18next | not recorded | MIT | `src/lib/i18next.min.js` | no | yes, add notice |
| scrypt-js | commit 3f106c1 | MIT | `src/lib/scrypt.js` | source URL only | yes, add notice |
| diff-match-patch | not recorded | Apache-2.0 | inside `src/app.js` | no | yes |
| Fuse.js | not recorded | Apache-2.0 | inside `src/app.js` | no | yes |
| CryptoJS (`enc.Hex`, `HmacSHA256`) | not recorded | MIT | inside `src/app.js` | no | yes |
| d3 modules (force, quadtree, ...) | not recorded | ISC | `src/sim.js`, inside `src/app.js` | no | yes, add notice |
| Lucide icons (and the Feather parts) | not recorded | ISC / MIT | table inside `src/app.js` | no | yes, add notice |
| 195 webpack package modules (Markdown tooling and helpers) | not recorded | presumably MIT/ISC, not verified | first line of `src/app.js` | no | not verified |
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
| Electron | the version of the Obsidian runtime (see `run.ps1`; check `process.versions.electron`) | MIT | `runtime/` (not tracked, shipped by the installer) | `LICENSE.electron.txt` ships |
| Chromium and its dependencies | with Electron | BSD-3-Clause and others | `runtime/` | `LICENSES.chromium.html` ships |
| @electron/remote | 2.1.3 | MIT | `stub/node_modules/` (not tracked) | shipped inside `resources/app` |
| node-addon-api | not recorded | MIT | `stub/node_modules/` | only needed to build the removed native modules |
| Inno Setup | 6 | Inno Setup License (free) | installer build only | not shipped |
| Rust standard library and toolchain | stable | MIT OR Apache-2.0 | all crates | |
| `portable-pty` 0.8.1 + 30 crates | see `pty-helper/Cargo.lock` | MIT / Apache-2.0 / Unicode-3.0 | `pty-helper` (`src/bin/basalt-pty.exe`) | all permissive |
| `crossterm` 0.27, `serde_json` 1 + 50 crates | see `cli/Cargo.lock` | MIT / Apache-2.0 / Unlicense / Unicode-3.0 | `cli` (`src/bin/basalt*.exe`) | all permissive |
| `yaml-rust2` 0.10.4, `hashbrown`, `hashlink`, `arraydeque`, `foldhash` (Zlib) | see `markdown-engine/Cargo.lock` | MIT OR Apache-2.0 / Zlib | `markdown-engine` (compiled into `src/worker.js`) | all permissive |
| `fp-core`, `fp-graph` | 0.1.0 | MIT OR Apache-2.0 | `../falconplot/crates/` (a **sibling repository**, path dependency) | `graph-engine` and `canvas-engine` do not build without it |
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

* Add the missing notices marked "add notice" / "add licence" above (a `licenses/` folder shipped with the installer is the usual place).
* Pin and record versions of the bundled libraries (`tools/yjs-bundle-entry.js` has no `package.json` for its npm dependencies).
* Decide what to do with the inherited code of section 1 (replace it, get permission, or do not publish builds).
