# src/app.js rewrite: progress

Branch `app-rewrite-big` (worktree `basalt-wt-big`). Own code lives in `src-app/` and is spliced into the inherited bundle by
`build-app.mjs`; the manifest `src-app/manifest.json` says what is replaced. Numbers below come from `node tools/own-stats.mjs`
(bytes of the ORIGINAL text of every replaced function / class, divided by the size of the base bundle).

| | replaced | bytes of original text |
| --- | --- | --- |
| functions (leaf helpers, search, timing, transitions) | 155 | 17.5 KB |
| classes | 41 | 78.0 KB |
| **total** | | **95.5 KB = 2.6 % of the 3688.9 KB bundle** |

Own readable source: 189 KB in `src-app/*.js` (comments included).

What the percentage means: about 240 KB of the bundle are third-party package modules and most of the 2.9 MB of `var` statements are
bundled libraries (CodeMirror 6, Lezer, yaml, moment, tslib, ...). Those are not "application code" and are replaced by dropping the
library, not by rewriting it; the share of the application-specific part is therefore larger than 2.6 %, but the number is kept
on the full bundle so it cannot flatter itself.

## Mechanism (new in this branch)

* `manifest.classes`: `{ orig: "VT", use: "defineEvents" }` replaces the initialiser of `var VT = function () {...}()` by
  `__basaltOwn.defineEvents(__basaltHost)`. The factory runs at the original position, so every class it extends already exists.
* `manifest.host`: readable name -> minified name (`Platform: "Yl"`). It becomes the lazily evaluated object `__basaltHost`; own code
  uses `host.Platform`, never a minified identifier. This table is the only place where minified names appear.
* Own classes that other (inherited) classes derive from are written as constructor functions and linked with `inherit()`
  (`src-app/inherit.js`), because the inherited code still calls `Base.call(this)`.
* Function entries still work as before (same name and parameters, body forwards to `__basaltOwn`).
* `build-app.mjs` refuses to replace anything whose text differs from the base revision, so a rebuild is always repeatable.

## Replaced modules

| module (src-app) | replaces |
| --- | --- |
| events.js, timing.js | `Events`, `Component`, `debounce` |
| keymap.js | `Scope`, the dynamic-parent scope of the workspace, `Keymap` |
| workspace-tree.js | `WorkspaceItem`, `WorkspaceParent`, `WorkspaceSplit`, `WorkspaceContainer`, `WorkspaceRoot`, `WorkspaceFloating`, `WorkspaceWindow` (pop-out) |
| sidedock.js | `WorkspaceSidedock` (collapse / expand / drag) |
| tabs.js | `WorkspaceTabs` (header strip, stacked mode, tab list menu, drop of files / links / bookmarks) |
| leaf.js | `WorkspaceLeaf` and its history (`back` / `forward`, now really capped at 20 entries) |
| ribbon.js | `WorkspaceRibbon` |
| animation.js | `Transition` (the `dl` helper), `runTransition`, `cancelTransition` (also fixes a leaked `transitionend` listener) |
| components.js | `Setting`, `SettingGroup`, `SettingTab`, `PluginSettingTab`, and all form components (`Button`, `ExtraButton`, `Toggle`, `Text`, `TextArea`, `Search`, `MomentFormat`, `Dropdown`, `Slider`, `Color`, `ProgressBar`) |
| notice.js, modal.js | `Notice`, `Modal` |
| menu.js | `Menu`, `MenuItem`, `MenuSeparator`, `closeAllMenus` |
| search-simple.js | `prepareFuzzySearch`, `prepareSimpleSearch`, the simple matcher, `renderMatches`, `renderResults`, `resolveSubpath` |
| path.js, text.js, misc.js, frontmatter.js, search.js | the 143 leaf functions of the previous round |

## How each module is verified

1. `node tools/class-compare.mjs` runs the ORIGINAL class text (cut from the base revision) and the own one on the same random
   scenarios and compares every observable result (Events, Component, debounce with a virtual clock and two windows, Scope / Keymap).
2. `node tools/app-compare.mjs --no-cargo` does the same for plain functions (including functions returned by functions and the
   match renderer on a fake DOM).
3. `tools/ws-scenario.mjs` (workspace) and `tools/api-scenario.mjs` (settings components, Notice, Modal, Menu) drive a real isolated runtime
   through fixed operations and print a normalised snapshot per step; the output of the base revision and of the branch is compared with
   `tools/ws-diff.mjs`. The workspace scenario covers split / tabs / stacking / drop of files, links and several files on the tab strip /
   pinning / link groups / history / sidebar collapse / ribbon items / layout round trip / pop-out window / closing everything: 33 steps, 0 differences.
4. `tools/app-smoke.mjs` (note, canvas, text file, explorer, graph, search, inherited settings dialog, command palette, split + close,
   pop-out, title bar buttons, console errors) after every commit.

## Commands

```
node build-app.mjs                    # rebuild src/app.js from src-app/ (add --check to only verify)
node tools/own-stats.mjs              # the numbers above
node tools/class-compare.mjs          # classes: original vs own on random scenarios
node tools/app-compare.mjs --no-cargo # functions: original vs own
# runtime tests (the isolated runtime of tools/test-runtime.ps1, run from the main checkout; link stub/node_modules and tools/node_modules first)
powershell -File tools\test-runtime.ps1 -Worktree <worktree> -Scratch <empty dir> -Port 9655 -Vault <vault>
node tools/app-smoke.mjs --make-vault <vault> ; node tools/app-smoke.mjs --port 9655
node tools/ws-scenario.mjs --port 9655 > new.json   # and the same on a runtime that runs the base revision, then
node tools/ws-diff.mjs base.json new.json
```

## Not done yet (see the final report for the order)

* `Workspace` itself (`H0`, 66 KB: layout save / load, active leaf, recent files, hotkey glue), `WorkspaceMobileDrawer` (`WD`, mobile only).
* Suggest family (`SuggestModal`, `FuzzySuggestModal`, `EditorSuggest`, `PopoverSuggest`, `AbstractInputSuggest`), `HoverPopover`, `Tooltip`.
* `App`, `Plugin` (note: Basalt loads WebAssembly plugins, not Obsidian JS plugins; `window.__bsApi` is the only API object the Basalt scripts use),
  command registry, hotkey manager, internal plugin manager (`Tte`, `i2`, `G0`, ...).
* The editor / view layer (`MarkdownView`, preview renderer, properties panel, outline, backlinks, search UI, canvas view glue), `MetadataCache`.
* Bundled libraries (CodeMirror, Lezer, yaml, moment, tslib) are third-party and are not rewritten.
