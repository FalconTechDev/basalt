You are rewriting Basalt, an Electron note-taking app, until none of the code is inherited. Basalt began as a fork of Obsidian 1.12.7.
The owner's goal is that all the code is our own: written from observed behaviour, not copied from the minified original, and with
no Obsidian text, names or code in what we ship (the only exceptions are listed under "Must stay" below).

Repository: C:\Users\sasha\OneDrive\Desktop\GithubRepos\basalt (local git, branch `main`).
FIRST create your own worktree and work only in it, never in the main checkout:
`git -C C:\Users\sasha\OneDrive\Desktop\GithubRepos\basalt worktree add ..\basalt-wt-<area> -b rewrite-<area> main`
Do not merge into main yourself. The owner merges.

### Layout
- `src/` the app that Electron loads: `main.js` (own, done), `enhance.js` (own, done), `starter.*`, `help.*` (own, done),
  `app.js` (3.9 MB bundle, the big inherited piece, partly replaced), `app.css` (built from `src-css/`), `index.html`, `i18n.js` (own wording),
  `i18n-ru.js` (own), `basalt-*.js` (own feature scripts), `worker.js` (own Rust/WASM), `lib/*` (open-source libraries, kept, listed in THIRD_PARTY.md),
  `public/` (inherited fonts and images), `sim.js` (d3-force, open source).
- `src-app/` our own readable sources for pieces of `app.js`; `src-app/manifest.json` says which minified function, class, declarator or method each one replaces.
- `build-app.mjs` splices the own modules into `src/app.js` (`node build-app.mjs`, `--check` to verify, `--wasm` to include the Rust build).
- `src-css/` + `build-css.mjs` build `src/app.css`. `markdown-engine/` + `build-markdown.mjs` build `src/worker.js`. `app-core/` is a Rust crate (built to WASM).
- `tools/` tests: `app-compare.mjs` (old-vs-new functions), `class-compare.mjs`, `vault-compare.mjs`, `app-smoke.mjs` (runtime smoke test), `ws-scenario.mjs`,
  `api-scenario.mjs`, `ws-diff.mjs`, `css-compare.mjs`, `own-stats.mjs` (percent of the bundle that is own code), `split-app.mjs` (structure map).
- `docs/APP-MAP.md` (structure of the bundle), `docs/REWRITE-PROGRESS.md` (what is done, numbers, full test recipe). READ BOTH FIRST.
- The original bundle is at git revision `ca5acac` (`git show ca5acac:src/app.js`); `tools/app-base.mjs` loads it for the tests.

### State (about 5 % of the bundle bytes replaced; most of the rest is libraries or still inherited)
Done: workspace tree (split/tabs/leaf/sidedock/ribbon/window), View/ItemView/FileView/TextFileView, Setting + form components, Notice, Modal, Menu,
suggest family, tooltips, hotkeys/commands/Scope/Keymap, Plugin/Component/Events/Platform, vault + file model + FileManager methods, 166 leaf functions.
NOT done (the work): the controller `Workspace` (H0), `App`, internal plugin manager, StatusBar, MetadataCache, drag manager, MarkdownView and siblings
(editor, preview, properties, outline, backlinks, search UI, canvas glue, graph glue, bookmarks, tags, templates, daily notes, sync/publish glue,
settings tabs content), everything the plan below lists.

### Method for every module
1. Read the minified code and RUN it in the isolated runtime; trace calls over CDP. Understand behaviour and the public plugin API contract.
2. Write your own readable implementation in `src-app/` (own structure, own internal names, own comments; no copy-paste of minified text).
3. Keep every public method, property, event name, DOM class name and CSS variable name the rest of `app.js`, plugins and CSS rely on.
4. Splice via `src-app/manifest.json` (`entries`, `classes`, `declarators`, `methods`, `host`, `envBind`: see `build-app.mjs`).
5. Verify: differential or scripted-scenario comparison against the original (`git show ca5acac`), then `tools/app-smoke.mjs`.
6. Use Rust/WASM (`app-core/`, pattern of `markdown-engine/`) only where a benchmark shows a win (parsing, search, scans, layout maths). Otherwise own JS.
7. Commit after each verified module, small commits, clear messages, NO Co-Authored-By and no attribution lines of any kind (owner's rule).
8. Keep `src/app.js` building and passing the smoke test at every commit. Update `docs/REWRITE-PROGRESS.md` (module table, percent from `node tools/own-stats.mjs`).

### Test recipe
Isolated runtime, never the installed app: from the MAIN checkout run
`powershell -File tools\test-runtime.ps1 -Worktree <your worktree> -Scratch <empty temp dir> -Port <unique port> -Vault <temp vault>`
(link `stub\node_modules` into your worktree temporarily; `cd tools && npm i`; make a vault with `node tools/app-smoke.mjs --make-vault <dir>`;
then `node tools/app-smoke.mjs --port <port>`). Chromium caches `app://` scripts: kill the previous test instance before each run
(filter on the scratch path, not on a generic name). Use a unique port and scratch dir per agent. Do not open or focus GUI windows.
Do not touch the installed copy under %LOCALAPPDATA%\Programs\Basalt.

### Must stay (do not rename or remove)
`app://obsidian.md/` host, `obsidian://` URI compatibility, plugin API names (`registerObsidianProtocolHandler`, `require("obsidian")` map, etc.),
sync crypto constants, `.obsidian` config migration, GitHub sources of the plugin and theme browser. Libraries in `src/lib` and the bundled
third-party modules inside `app.js` (CodeMirror, Lezer, yaml, moment, tslib, pdf.js rules) stay as they are.

### Final report
What was replaced (modules, KB and % of the bundle from `own-stats.mjs`), what still differs in behaviour, commands to rebuild and test, what is left in your area.

---

# YOUR AREA: markdown editing and reading
Worktree/branch name: rewrite-editor (use it in the git worktree command above, as basalt-wt-editor).
Use a unique test port and scratch dir (port 96110 and up), other agents run at the same time.

Replace `MarkdownView` and siblings: source/live-preview editor glue over CodeMirror (extensions, decorations, commands, vim, hotkeys, paste/drop,
embeds, live-preview widgets), the reading-mode renderer (post-processors, embeds, callouts, math, code highlight), properties/frontmatter panel,
outline, backlinks, tags pane, find/replace, the text-file view. Use the Rust markdown engine (`markdown-engine/`) where it applies.

Stay inside your area: other agents edit the other areas at the same time. If you must change a shared file (build-app.mjs, manifest.json, app-smoke.mjs), keep the change small and append-only so the merge is easy.
