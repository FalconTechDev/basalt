# Basalt → IDE: work split for the Devin agents

Goal: Basalt opens an existing folder (code or files) **without creating a vault**, works like a light IDE, shows a graph of files and of code,
lets you see which pieces of code ran, and has git built in.

Claude (the coordinator) gives each agent one task below, then checks the result. Agents work **in parallel on separate branches**; no two tasks touch the same files.

## Rules for every agent

- Repo: `C:\Users\sasha\OneDrive\Desktop\GithubRepos\basalt` (git, local only, no remote). Start from branch `main`; work on the branch named in your task; never commit to `main`.
- Commit after every logical change. **No `Co-Authored-By` or any Claude/Devin trailer** in commits. Commit messages: short, plain.
- The app is an Obsidian 1.12.7 fork patched by anchor strings: `build-canvas.mjs` patches `src/app.js.orig` into `src/app.js`. Never edit `src/app.js`, `src/fp-*.js` (they are build outputs); edit the sources: `canvas-engine/fp-canvas.src.js`, `graph-engine/fp-graph.src.js`, `graph-engine/src/lib.rs`, `src/basalt-*.js`, `src/vault-sync.js`.
- Build: `CARGO_TARGET_DIR=E:/rust-target/canvas-engine node build-canvas.mjs --no-cargo` (graph WASM: `cd graph-engine && CARGO_TARGET_DIR=E:/rust-target/graph-engine cargo build --release --target wasm32-unknown-unknown`).
- **Test only in an isolated profile**, never the user's: `runtime\Basalt.exe --user-data-dir=<your temp dir> --remote-debugging-port=<free port> --window-position=-3000,0` on a throw-away vault or folder. Do not open or write into `C:\Users\sasha\OneDrive\Документы\Масява`.
- UI rules: `docs/UI-STYLE.md` (cut corners `--bs-clip`, 4px small controls, theme variables only, both themes). Use the application's own components (`Menu`, `Modal`, `Setting`, `setIcon` with `lucide-*`) through `window.__bsApi`. No filler descriptions under titles. Russian UI text.
- Do not add dependencies that need a network at runtime. WASM/JS libraries are vendored into `src/vendor/` with their licence listed in `THIRD_PARTY.md`.
- Report in your final message: branch name, what works (with the exact steps you ran to check it), what does not, files changed, and screenshots taken from the isolated profile.

## Shared contract: the graph data format

All graph sources produce this JSON, the graph view only draws it (`docs/GRAPH-FORMAT.md` is written by task C and used by D, F):

```json
{ "nodes": [{ "id": "src/a.ts", "kind": "file|dir|symbol|external", "name": "a.ts", "path": "src/a.ts", "loc": 120, "lang": "ts", "group": "src", "meta": {} }],
  "edges": [{ "from": "src/a.ts", "to": "src/b.ts", "kind": "import|call|contains|extends|git-cochange" }] }
```

## Task A: open a folder, no vault (branch `devin/a-open-folder`)

- File > "Открыть папку…" and a start-page tile. The chosen folder becomes the workspace as it is: **nothing is written into it** except one hidden `.basalt/` directory, and that directory name is added to `.git/info/exclude` (or `.git/info/exclude` is created) so `git status` stays clean.
- Explorer shows every file, not only notes and canvases. Ignore rules: `.git`, `node_modules`, `target`, `dist`, `build`, `.venv`, plus `.gitignore` of the folder (a toggle "показывать игнорируемые").
- Must stay fast on a folder with 100 000 files: lazy listing by directory, no full-tree watchers on ignored directories.
- Opening a non-note file opens the code editor of task B (until B is merged: a read-only text view). Binary files: picture viewer or "двоичный файл".
- Acceptance: open `C:\Users\sasha\OneDrive\Desktop\GithubRepos\falconplot` (copy it first) and a folder with 50k files; `git status` in the folder is clean after the app closes; the explorer opens in under 2 s.
- Files: `src/basalt-files.js`, `src/basalt-home.js`, new `src/basalt-workspace.js`. Do not touch graph or canvas files.

## Task B: code editor (branch `devin/b-editor`)

- Vendor CodeMirror 6 (state, view, commands, search, autocomplete, language packages for js/ts/py/rust/go/java/c/cpp/json/toml/yaml/md/html/css/sh/powershell). Editor view type `basalt-code` for any text file that is not a note.
- Tabs, Ctrl+S, find/replace, go to line, indentation guides, bracket matching, multi-cursor, minimap-free. Theme from the app variables (both themes).
- Left or right panel "Структура": symbols of the open file (functions, classes) from the CodeMirror syntax tree, click to jump.
- Search in files (Ctrl+Shift+F) through `rg` if it is found next to the app, otherwise a JS fallback; results grouped by file, click opens at the line.
- Terminal already exists (`src/basalt-term.js`), do not rewrite it; add "run file" for the current file using the existing runner (`src/basalt-code.js`).
- Acceptance: open a 5 MB source file without a freeze; edit, save, undo/redo; hotkeys also work on the Russian layout.
- Files: new `src/basalt-editor.js` and `src/vendor/cm6/*`; touch `src/basalt-code.js` only for the run button.

## Task C: code graph (branch `devin/c-code-graph`)

- Parser: tree-sitter WASM per language (js/ts/tsx, python, rust, go, java, c/cpp), vendored; runs in a worker. Produces the graph format above: files, directories (`contains`), imports between files (`import`), symbols and calls (`call`) where it can be resolved by name inside the project, `extends`.
- Incremental: re-parse only changed files (mtime + content hash cache in `.basalt/code-graph.json`).
- Writes `docs/GRAPH-FORMAT.md` first (the contract above, with every field), then the parser.
- API: `window.__bsCodeGraph.build(root, opts) → graph`, `.update(changedPaths)`, `.on("change", fn)`.
- Acceptance: on `falconplot` (Rust) and on a TypeScript project of ≥ 500 files: the graph is built in under 30 s cold, under 1 s warm after one file change; unit checks listed in your report (a known import and a known call appear as edges).
- Files: new `src/basalt-codegraph.js`, `src/codegraph-worker.js`, `src/vendor/tree-sitter/*`. Do not touch the graph view.

## Task D: graph view for files and for code, saved layouts (branch `devin/d-graph-view`)

Depends on the format only (use a mock graph file until C is merged).

- The existing graph view (`graph-engine/fp-graph.src.js`, engine `graph-engine/src/lib.rs`) gets a source switch: "Заметки" (current), "Файлы" (directory tree + imports), "Код" (symbols and calls).
- Node look by kind (dir / file / symbol / external), size by `loc` or by degree, colour by language or by git status (task E provides `window.__bsGit.status()`; until then by directory).
- **Saved layouts**: node positions are stored per workspace in `.basalt/graph-layouts.json`, named views ("Архитектура", "Только src/api"); pin a node, drag it, reset a group; the layout survives re-parse (nodes are matched by `id`).
- Click on a node opens the file (at the symbol line for symbols); hover shows the signature and the first lines.
- Keep everything that already works: hover fade, tween arrival, groups, focus, undo, labels without overlap, controls column.
- Acceptance: 5 000-node graph keeps 60 fps while panning; a moved node stays where it was after reopening the view and after a re-parse.
- Files: `graph-engine/*`, `src/fp-graph.js` is built output.

## Task E: git integration (branch `devin/e-git`)

- Reuse the git helpers in `src/vault-sync.js` (`histGit`, `histBuf`) by extracting them into `src/basalt-git.js`; `vault-sync` keeps working (the notes sync is a separate feature, do not change its behaviour).
- Panel "Git": branch switcher, changed files (staged / unstaged / untracked) with checkboxes, diff view (side by side and inline) in the code editor tab, commit box with message, commit / amend / discard hunk, push / pull / fetch with progress, stash.
- Log view: commit list with a compact graph of branches, click shows the changed files; file history and blame in the gutter (toggle).
- Status markers in the explorer (colour + letter) and in the editor gutter (added / changed / removed lines).
- API for the graph: `window.__bsGit.status()` → map path → `A|M|D|U|!`, `.log(path)`, `.coChange(path)`, events on change.
- Never run a destructive command (reset --hard, clean, force push) without a confirm dialog naming what is lost.
- Acceptance: on a copy of a real repo: stage a hunk, commit, switch branch, resolve a trivial conflict, push to a local bare repo; every step visible in the panel and equal to `git status`.
- Files: new `src/basalt-git.js`, `src/basalt-gitpanel.js`; small hooks in `src/basalt-files.js` for the status marks (coordinate with A: only add one exported function `statusMark(path)` there).

## Task F: seeing code run (branch `devin/f-run-trace`)

Depends on C (graph) and D (view); can start with the tracer alone.

- "Запустить с трассировкой": runs a command in the terminal and collects which functions ran, how often and how long.
  - JavaScript/TypeScript: `node --cpu-prof` / the inspector protocol; Python: `sys.setprofile` wrapper script; Rust/Go: sampled with `perf`/pprof if present, otherwise function-level logs by `--trace` flags. Start with JS and Python.
- Result is a trace JSON (`calls: [{id, count, selfMs, totalMs}]`, call order) written to `.basalt/traces/<time>.json`.
- On the code graph: executed nodes are lit, heat colour by time, edges used by the run are thick; a play button replays the call order as an animation; click a node → the code editor opens with per-line hit counts in the gutter.
- Acceptance: a small Python and a small Node project: the trace lights exactly the functions that run, the numbers match `cProfile` / `--cpu-prof` output within 10 %.
- Files: new `src/basalt-trace.js` + tracer helper scripts in `tools/tracers/`; hook into D only through its documented API.

## Order and merge

1. A, B, C, E start at once (no shared files).
2. D starts at once on a mock graph; F starts on the tracer alone.
3. Claude merges branch by branch into `main` in this order: A, E, B, C, D, F; after each merge builds, runs the isolated-profile checks and the UI audit (`node tools/ui-audit.mjs`), then copies `src` into the installed copy and verifies hashes.
4. A branch is sent back if: it edits build outputs, writes into a real vault, adds a trailer to commits, breaks the Russian-layout hotkeys, or has no steps to reproduce its acceptance checks.
