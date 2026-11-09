# Basalt IDE: full list (VS Code level)

`[x]` done and checked, `[~]` partly, `[ ]` not started. Every cycle: take the top undone items of the highest-value group, build, check in the isolated test instance (`tools/test-runtime.ps1`), sync to the installed copy, commit, tick here.

Files that carry it: `src/basalt-textfile.js` (editor), `src/basalt-graphs.js` (file graph), `src/basalt-find.js` (search in files), `src/basalt-quick.js` (quick open / symbols / line), `src/basalt-term.js` (terminal), `src/basalt-workspace.js` (open any folder), `src/basalt-files.js` (explorer).

## 1. Editor core
- [x] Syntax colours for every language (CodeMirror modes), VS Code Dark+/Light+ palette
- [x] Line numbers, current line highlight, bracket matching, auto close brackets
- [x] Folding with gutter markers
- [x] Find / replace in file (regex, case, word, count, Enter / F3)
- [x] Go to line (Ctrl+G), comment toggle (Ctrl+/), move line (Alt+Up/Down)
- [x] Multi-cursor: Ctrl+D next occurrence, Ctrl+Shift+L all, Alt+click
- [x] Duplicate line (Shift+Alt+Up/Down), delete line (Ctrl+Shift+K)
- [x] Indent guides, same-word highlight, thin scrollbars
- [x] Minimap with slider (click and drag)
- [x] CRLF kept, indent style detected, autosave, external change reload
- [x] Right-click menu (cut, copy, paste, select all, find, comment, run)
- [x] Zoom with Ctrl+wheel, Ctrl+= / Ctrl+-
- [ ] Bracket pair colours
- [ ] Sticky scroll (current function header stays on top)
- [ ] Word wrap per language, ruler at column 80/120
- [ ] Auto indent on paste, format document (prettier / rustfmt / gofmt / black if found)
- [ ] Trim trailing whitespace and final newline on save (option)
- [ ] Select line (Ctrl+L), expand selection (Shift+Alt+Right), cursor undo (Ctrl+U)
- [ ] Column (box) selection with Shift+Alt+drag
- [ ] Emmet-like tag close for html / xml / jsx
- [ ] Auto-complete: words in file, keywords per language
- [ ] Parameter hints and hover docs (language servers, see group 6)
- [ ] Rename symbol in file (F2), go to definition (F12), peek definition, find all references
- [~] Encoding picker (UTF-8, UTF-16, cp1251) and line ending switch (LF / CRLF) in the status bar
- [x] Language picker in the status bar (change highlighting for a file)
- [ ] Image / SVG / PDF / audio preview tabs instead of "external app"
- [ ] Markdown preview side by side, JSON tree view, CSV table view
- [ ] Hex view for binary files
- [ ] Large file mode (over 5 MB: virtual rendering, no highlighting)
- [ ] Diff editor (side by side and inline) for two files and for git changes
- [ ] Split editor right / down, drag a tab to split (Obsidian splits work, tab menu entry missing)
- [ ] Breadcrumbs clickable: folder menu, symbol path

## 2. Navigation
- [x] Search in files (Ctrl+Shift+F), regex, mask, grouped results, open on line
- [x] Quick open file by fuzzy name (Ctrl+Alt+P)
- [x] Go to symbol in file (Ctrl+Shift+O, `@`) and go to line (`:`)
- [ ] Go to symbol in project (`#`)
- [ ] Recent files list, back / forward through cursor positions (Alt+Left / Right)
- [x] Replace in files with preview (checkboxes per hit)
- [ ] Search results as a tab you can keep, search history, include / exclude folders
- [x] Outline panel (symbols tree of the open file, follows cursor)
- [ ] Bookmarks on lines (gutter), list in a panel
- [ ] TODO / FIXME panel (scan comments in project)
- [ ] Open file from a path or `file:line` pasted anywhere (terminal output links too)

## 3. Explorer and files
- [x] Open any folder without a vault, lazy tree, ignore toggle, reveal in system explorer
- [x] File graph: tree / ladder / radial / free, icons by extension, collapsible, search, context menu
- [ ] Explorer file icons by extension and folder names (like VS Code icon themes)
- [ ] New file / folder / rename / delete / duplicate / move by drag in the opened folder
- [ ] Copy path, copy relative path, reveal in explorer, open in terminal here (context menu)
- [ ] Multi-select, cut / copy / paste files, undo of file operations
- [ ] File watcher: tree refreshes when files change outside
- [ ] Compact folders (`a/b/c` on one row), sticky parent folders while scrolling
- [ ] Workspace-wide excludes (`files.exclude`) and `.gitignore` aware by default
- [ ] Multi-root workspace (several folders in one tree)
- [ ] Timeline per file (git history of the file)
- [ ] Open editors list, pinned tabs, tab colours by git state / problems

## 4. Terminal and running code
- [x] Terminal under the editor (Ctrl+`), resizable, cwd = file folder
- [x] Run file by extension (F5 and the play action in the tab header)
- [ ] Terminal tabs / split terminals, rename, kill, shell profiles (PowerShell, cmd, bash, WSL)
- [ ] Terminal panel docked at the bottom of the whole window (not per file), maximize
- [ ] Clickable `file:line:col` in terminal output
- [ ] Run configurations (`.basalt/run.json`: command, args, cwd, env), run / debug dropdown
- [ ] Run selection / run current line in REPL (Python, Node)
- [ ] Task runner: detect `package.json` scripts, `Makefile`, `Cargo.toml`, `justfile`, list as tasks
- [ ] Problems panel from compiler / linter output (rustc, tsc, eslint, python tracebacks, go vet)
- [ ] Output panel for tasks, with clear / copy
- [ ] Debugger: breakpoints in gutter, step, variables (Node inspector first, then Python debugpy)
- [ ] Test explorer: discover and run tests (cargo test, pytest, jest, go test), gutter run icons
- [ ] Trace run on the file graph (functions executed, hot paths)

## 5. Git
- [ ] Status markers in explorer and gutter (added / modified / removed lines)
- [x] Source control panel: changes, staged, commit message, commit / amend
- [~] Diff view for a file (inline and side by side), stage / discard hunk
- [~] Branch switcher in the status bar, create / delete / merge
- [~] Pull / push / fetch with progress, stash
- [ ] Log view with branch graph, file history, blame in the gutter and on hover
- [ ] Merge conflict editor (accept current / incoming / both)
- [x] Never run a destructive command without a confirmation naming what is lost

## 6. Language intelligence
- [ ] Language server client (stdio): rust-analyzer, typescript-language-server, pyright, gopls, clangd
- [ ] Diagnostics squiggles + Problems list
- [ ] Completion, signature help, hover, definition, references, rename, code actions
- [ ] Format on save / format selection
- [ ] Symbols from the server for outline and workspace symbol search
- [ ] Linter integration (eslint, ruff) without a server

## 7. Interface shell (the whole window, not only the editor)
- [x] One VS Code style for editor, graph, search overlay, terminal (variables on `body`)
- [ ] Activity bar (explorer, search, git, run, extensions) with icons, like VS Code
- [ ] Side bar views: Explorer, Search, Source control, Outline, Problems, TODO
- [ ] Bottom panel with tabs: Terminal, Problems, Output (one dock for the window)
- [ ] Status bar for the whole window: branch, errors, language, encoding, line ending, cursor, run state
- [ ] Command palette in VS Code form (`>` commands, `@` symbols, `:` line, none = files) in one box
- [ ] Settings page for the editor (font, size, tab size, wrap, minimap, guides, format on save), JSON view
- [ ] Keyboard shortcuts page with search and conflict warnings
- [ ] Themes: Dark+, Light+, Monokai, Solarized, GitHub, user JSON theme; follow system
- [ ] Zen mode, full screen, centered layout
- [ ] Tab bar: dirty dot, close button, preview tabs (italic), scroll arrows, drag to reorder
- [ ] Welcome page with recent folders and files (home exists, make it VS Code form)
- [ ] Workspace trust prompt before running anything from an opened folder
- [ ] Everything works with the Russian keyboard layout

## 8. Performance and safety
- [x] File graph: collapsed folders, LOD, 60 fps on 5000 files
- [ ] Editor opens a 5 MB file without a freeze (measure, virtualize if needed)
- [ ] Search in files uses `rg` when it is next to the app (fast path)
- [ ] Parse and index in a worker (symbols, imports) with a cache in `.basalt`
- [ ] Crash-safe saves (write temp + rename), backup of unsaved buffers on exit
- [ ] Undo history kept per file across tab closes

## 9. Extensions
- [ ] Snippets (user JSON, per language) with tab stops
- [ ] Simple extension API: commands, views, status items (reuse the Obsidian plugin API)
- [ ] Marketplace-less install from a folder or git URL

## Style rule
Every IDE module takes its colours from the app palette (--background-*, --text-*, --interactive-accent, mapped through the --vs-* variables defined in asalt-textfile.js) and its shape from --bs-r / --bs-clip. No hard-coded greys or blues (only syntax colours are fixed).

## Gap list from the side-by-side with VS Code (same file, `analysis_options.yaml`, 2026-11-09)
- [ ] Explorer shows dotfiles and dot folders (`.github`, `.idea`, `.vscode`, `.gitignore`, `.ci.yaml`), toggle in the explorer menu
- [ ] Explorer shows full file names with extension (`CHANGELOG.md`, not `CHANGELOG` + a tag on the right)
- [ ] Explorer file icons per type (yaml, md, bat, license, json, images...) and folder icons per name
- [ ] Explorer root header (folder name, collapse all) and the sections under it: Open Editors, Outline, Timeline
- [ ] Git colours and letters on files and folders in the explorer (M, U, A, D, ignored dimmed)
- [ ] Activity bar like VS Code: Explorer, Search, Source control, Run, Extensions, Account, Settings (now the Obsidian ribbon with unrelated icons)
- [ ] Title bar menu: File, Edit, Selection, View, Go, Run, Terminal, Help + command centre box with the folder name
- [ ] One global status bar at the bottom: branch, sync, problems count, line / column, spaces, encoding, EOL, language (now per editor)
- [ ] Bottom panel with tabs Problems / Output / Terminal shared by the whole window
- [ ] Editor tab: file-type icon, preview tab in italics, dirty dot instead of close button, split editor and "..." actions on the right
- [ ] Breadcrumb: file-type icon, folder / symbol path clickable
- [ ] Links in comments and strings: underline, Ctrl+click opens
- [ ] Comment italics (as in Dark+), active indent guide highlighted, horizontal scrollbar, overview ruler (marks for search hits and changes)
- [ ] Editor font size and line height setting, ligatures option
