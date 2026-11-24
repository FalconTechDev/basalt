# vendor/

Third-party code that ships inside `src/app.js`, with the licence texts that have to travel with it.

| Path | What |
|---|---|
| `licenses/*.txt` | one licence file per library family (copyright line + licence text); `Apache-2.0.txt` is the shared Apache text |
| `webpack-modules/*.js` | the 195 webpack modules of `src/app.js`, cut out verbatim and grouped by package (valid JS: `{ id: function }`) |
| `lucide/icons.js` | the Lucide icon table (1874 entries), verbatim |
| `MANIFEST.json` | every library: licence, where it sits, byte count, sha256; for the libraries that cannot be cut out, the anchors that locate them |

The files under `webpack-modules/` and `lucide/` are **verified copies, not build inputs**: `src/app.js` is still what runs.
`node tools/vendor-extract.mjs` writes them, `node tools/vendor-extract.mjs --check` fails when they no longer match `src/app.js`.

Not cut out, only located in `MANIFEST.json` (`appScopeLibraries`): CodeMirror 6, Lezer, yaml, DOMPurify, diff-match-patch, idb and the tslib helpers.
They are fragments of one `var a=..,b=..;` chain in the application scope, interleaved with own wrappers and old code, so a slice is not valid JS.
The way to get them out for good is to take the upstream release of each package (npm), pin its version, and bundle it; that is step 1 of
`docs/REPLACING_INHERITED_CODE.md`.

Not recorded and not verifiable from the shipped bytes: exact versions (the bundler stripped every banner) and the copyright lines (written from the
upstream projects, see the note at the top of each licence file). Confirm both against the pinned upstream release before a public build.
