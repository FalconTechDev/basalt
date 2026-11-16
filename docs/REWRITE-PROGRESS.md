# src/app.js rewrite: progress

Branch `rewrite-core` (worktree `basalt-wt-core`). Own code lives in `src-app/` and is spliced into the inherited bundle by

Branch `rewrite-editor` (worktree `basalt-wt-editor`). Own code lives in `src-app/` and is spliced into the inherited bundle by
`build-app.mjs`; the manifest `src-app/manifest.json` says what is replaced. Numbers come from `node tools/own-stats.mjs`
(bytes of the ORIGINAL text of every replaced function / class, divided by the size of the base bundle).

| | replaced | bytes of original text |
| --- | --- | --- |
| functions (leaf helpers, search, timing, transitions, tooltips, metadata helpers) | 189 | 25.5 KB |
| classes / objects | 76 | 182.7 KB |
| methods (Workspace `H0` 81, App `Tte` 49, FileManager `mI` 13) | 143 | 83.8 KB |
| **total** | | **292.0 KB = 7.92 % of the 3688.9 KB bundle** |

Own readable source: 568.2 KB in `src-app/*.js` (comments included).

| functions (leaf helpers, search, timing, transitions, tooltips, clipboard/url) | 173 | 21.8 KB |
| classes / objects | 70 | 148.5 KB |
| **total** | | **170.4 KB = 4.6 % of the 3688.9 KB bundle** |

Own readable source: 374 KB in `src-app/*.js` (37 files, comments included).

What the percentage means: about 240 KB of the bundle are third-party package modules and most of the 2.9 MB of `var` statements are
bundled libraries (CodeMirror 6, Lezer, yaml, moment, tslib, ...). Those are not "application code"; they go away by dropping the
library, not by rewriting it by hand. The share of the application-specific part is therefore larger than 4.1 %, but the number is
kept on the full bundle so it cannot flatter itself.

## Mechanism (new in this branch)

* `manifest.classes`: `{ orig: "VT", use: "defineEvents" }` replaces the initialiser of `var VT = function () {...}()` by
  `__basaltOwn.defineEvents(__basaltHost)`. The factory runs at the original position, so every class it extends already exists.
  (`hv -> initTooltips` uses the same hook to give the tooltip functions their two app helpers; it returns the old value `null`.)
* `manifest.host`: readable name -> minified name (`Platform: "Yl"`, a value may also be an expression such as `gm.commands`).
  It becomes the lazily evaluated object `__basaltHost`; own code uses `host.Platform`, never a minified identifier. This table is
  the only place where minified names appear.
* Own classes that inherited classes derive from are written as constructor functions and linked with `inherit()`
  (`src-app/inherit.js`), because the inherited code still calls `Base.call(this)`.
* Function entries work as before (same name and parameters, body forwards to `__basaltOwn`).
* `build-app.mjs` refuses to replace anything whose text differs from the base revision, so a rebuild is always repeatable.

## Replaced modules

| module (src-app) | replaces |
| --- | --- |
| markdown-render.js | `MarkdownRenderChild` (`zz`), `MarkdownPreviewSection` (`qz`), the preview link/hover handlers (`lq`), `MarkdownRenderer` (`hq`, statics `render`/`renderMarkdown`/`postProcess`/`toggleCheckbox` included); `misc.js` also gained `isUrl` (`Yc`) and `copyText` (`Ec`) |
| document-search.js | the reading-view find bar (`lz`: scope keys, match count, highlight ranges, prev/next) |
| preview-view.js | `MarkdownPreviewView` (`fq`: reading-mode settings classes, find bar wiring, ephemeral scroll/selection state, touch double-tap mode toggle, copy/context-menu keys) |
| markdown-extras.js | reading-mode helpers: unresolved-link marking (`uq`), query-block embed (`pq`), embed depth lookup (`JZ`), properties-editor getter (`eO`), `EmbedLoader` (`sJ`); `misc.js` gained `focusWhenShown` (`gg`). `build-app.mjs` entries may now opt into `"host": true` to receive `__basaltHost` as a trailing argument |
| markdown-view.js | `MarkdownView` (`W6`: mode switching source/preview, inline title, properties editor + backlinks pane wiring, view state, scroll sync, fold persistence, pane menu, frontmatter css classes); `j6` edit mode, `tO` metadata editor, `z6` backlinks and `G6` print modal remain inherited via the host table |
| modal.js (+defineDialogModal), print-modal.js | `DialogModal` (`nb`: button-container base of the confirm/prompt dialogs) and `PrintToPdfModal` (`G6`: export-to-PDF settings dialog, hidden print window, electron print IPC) |
| edit-mode.js | `MarkdownEditMode` (`j6`): source edit mode — reparents title/properties/backlinks into the editor sizer, ephemeral cursor/scroll/property-match state, search-match highlighting, fold info incl. properties block, live-preview properties extension hook, backlinks bottom padding |
| edit-mode-base.js | `EditModeBase` (`aZ`): markdown edit-mode base over CodeMirror — scroll DOM layout, fractional-line scroll math, in-editor search, Enter/Tab list keymaps, dynamic CM extensions (line numbers, indent guides, folding, pairing) |
| editor-api.js | `Editor` (`cP`): public editor API — setLine, processLines, heading/blockquote/bullet/number/check-list toggles, callout/codeblock/math insertion, list-aware newline continuation, CJK bracket expansion |
| properties-editor.js | `MetadataEditor` (`tO`), `PropertyRow` (`nO`), `PropertyKeySuggest` (`AO`): frontmatter/properties UI — rows with type widgets, key suggest, vim-style nav, multi-select, clipboard (`basalt/properties` + YAML), collapse, drag reorder, invalid-frontmatter error state |
| preview-renderer.js | `MarkdownPreviewRenderer` (`Gz`): section parse (sync + worker), section recycling, progressive virtualization, measurement, delegated DOM events (links, tags, footnotes, checkboxes, heading/list collapse indicators, media), search-highlight rectangles, scroll line mapping (`getScroll`/`applyScroll`), fold state export/import, mobile image viewer pinch/pan |
| events.js, timing.js | `Events`, `Component`, `debounce` |
| keymap.js | `Scope`, the dynamic-parent scope of the workspace, `Keymap` |
| commands.js | the command registry (`app.commands`), `HotkeyManager` |
| workspace-tree.js | `WorkspaceItem`, `WorkspaceParent`, `WorkspaceSplit`, `WorkspaceContainer`, `WorkspaceRoot`, `WorkspaceFloating`, `WorkspaceWindow` (pop-out) |
| sidedock.js | `WorkspaceSidedock` (collapse / expand / drag) |
| tabs.js | `WorkspaceTabs` (header strip, stacked mode, tab list menu, drop of files / links / bookmarks) |
| leaf.js | `WorkspaceLeaf` and its history (`back` / `forward`, the back list is now really capped at 20) |
| ribbon.js | `WorkspaceRibbon` |
| view.js, view-placeholders.js | `View`, `ItemView`, and the deferred / empty / unknown placeholder views |
| fileview.js | `FileView`, `ViewRegistry` |
| textfileview.js | `EditableFileView` (rename in the title), `TextFileView` (load / save / merge) |
| hover-popover.js | `HoverPopover` with the global pointer tracker |
| animation.js | `Transition`, `runTransition`, `cancelTransition` (also fixes a leaked `transitionend` listener) |
| tooltip.js | the whole tooltip system (`setTooltip`, `displayTooltip`, hover handlers) |
| components.js | `Setting`, `SettingGroup`, `SettingTab`, `PluginSettingTab`, all form components |
| notice.js, modal.js | `Notice`, `Modal` |
| menu.js | `Menu`, `MenuItem`, `MenuSeparator`, `closeAllMenus` |
| suggest.js | the suggestion list, `SuggestModal`, `FuzzySuggestModal`, `PopoverSuggest`, `AbstractInputSuggest`, `EditorSuggest` |
| plugin.js | `Plugin` |
| platform.js | `Platform` |
| search-simple.js | `prepareFuzzySearch`, `prepareSimpleSearch`, the simple matcher, `renderMatches`, `renderResults`, `resolveSubpath` |
| path.js, text.js, misc.js, frontmatter.js, search.js | the 143 leaf functions of the previous round |
| drag.js | `DragManager` (`xP`), the dataTransfer helpers `wP`/`bP`/`SP`/`Eg`/`TP`, the `MP` effect map and `EP` drag pixel |
| statusbar.js | `StatusBar` (`Nee`) |
| core-plugins.js | `PluginWrapper` (`i2`), `InternalPlugins` (`o2`), the `r2` core-plugin id list |
| metadata-types.js | `MetadataTypeManager` (`RL`), the `PL` types.json defaults, `inferPropertyWidget` (`NL`) |
| community-plugins.js | `CommunityPlugins` (`$0`): manifests, enable/disable, install, deprecation and update checks |
| metadata-cache.js | `MetadataCache` (`_L`): worker indexing, IndexedDB persistence, link/tag/backlink resolution |
| metadata-helpers.js, env.js | MetadataCache support: `SerialTaskQueue`/`RefMultimap`/`Deque`/`Runnable`/`LinkQueue`/`BlockCache`, `batchedAsync`, `idleOrTimeout`, `iterateIdbBatches`, `contentHash`, `collectTags`, `sharesLinkTarget`, `anyRefMatch`/`anyMetadataRef`, `forEachLinkField`, position (de)serialization, `escapeRegExp`, `tagValid`, `isOutdatedMetadata`, `applyLinkUpdates`; `env.js` shares the lazy host bindings |
| workspace.js | all 81 `Workspace` (`H0`) methods: leaf iteration/lookup, active leaf, recent files, layout save/load round trip, splits, sidedocks, tabs, stacking, drops, pinning, link groups, history, ribbon, pop-outs, URI/protocol handlers, context menus, frameless layout |
| app.js | all 49 `App` (`Tte`) methods + `initializeWithAdapter` startup orchestration + `registerCommands` (all 96 global/editor commands with ids, hotkeys and callbacks) |
| vault.js | `FileManager` (`mI`) methods: file creation/rename/move, attachment import |

Behaviour changes (all bug fixes, nothing observable in normal use): the leaf history list is trimmed at 20 entries (the inherited
`unshift()` without an argument did nothing), `FileView.onDelete` no longer throws when the leaf is already detached,
`runTransition` removes the `transitionend` listener it adds.

## How each module is verified

1. `node tools/class-compare.mjs` runs the ORIGINAL class text (cut from the base revision) and the own one on the same random
   scenarios and compares every observable result: Events, Component, debounce (virtual clock, two windows), Scope / Keymap,
   Commands + HotkeyManager (fake app), Plugin (fake app, async parts included). 2400 scenarios, all identical.
2. `node tools/app-compare.mjs --no-cargo` does the same for plain functions, including functions returned by functions and the
   match renderer on a fake DOM: 172 functions, 18840 comparisons, 0 differences.
3. `tools/ws-scenario.mjs` (workspace) and `tools/api-scenario.mjs` (settings components, Notice, Modal, Menu, suggest modals,
   editor suggest, commands / hotkeys, file view, text file view, hover popover, tooltips) drive a real isolated runtime through fixed
   operations and print a normalised snapshot per step; the output of the base revision and of the branch is compared with
   `tools/ws-diff.mjs`. Workspace: 33 steps (splits, tabs, stacking, drops of files / links / several files on the tab strip, pinning,
   link groups, history, sidebar collapse, ribbon items, layout round trip, pop-out window, closing everything), 0 differences.
   API: 11 steps, 0 differences. (The only runtime problem the base shows and the branch does not is the `onDelete` exception above.)
4. `tools/app-smoke.mjs` (note, canvas, text file, explorer, graph, search, inherited settings dialog, command palette, split + close,
   pop-out, title bar buttons, console errors) after every commit. Note: the isolated window is off screen and its timers are throttled,
   so a canvas sometimes needs longer than the old fixed wait; the check now polls for up to 30 s (the base revision flaked the same way).
   Latest full run on a clean profile: 13/13 checks pass, 0 console errors. `App` was additionally verified by boot probes:
   `initializeWithAdapter` completes, vault loads, 244 commands registered (same count as the inherited build), theme/accent,
   localStorage, spellcheck/vim helpers, `obsidian://` URL generation and font-size updates all behave.

## Commands

```
node build-app.mjs                    # rebuild src/app.js from src-app/ (add --check to only verify)
node tools/own-stats.mjs              # the numbers above
node tools/class-compare.mjs          # classes: original vs own on random scenarios
node tools/app-compare.mjs --no-cargo # functions: original vs own
# runtime tests (the isolated runtime of tools/test-runtime.ps1, run from the main checkout; link stub/node_modules and
# tools/node_modules to the main checkout's first, or run npm i)
powershell -File tools\test-runtime.ps1 -Worktree <worktree> -Scratch <empty dir> -Port 9655 -Vault <vault>
node tools/app-smoke.mjs --make-vault <vault> ; node tools/app-smoke.mjs --port 9655
node tools/ws-scenario.mjs --port 9655 > new.json   # and the same on a runtime that runs the base revision
                                                    # (git worktree add <dir> 7eeaf47 --detach, point test-runtime at it), then
node tools/ws-diff.mjs base.json new.json           # (same for tools/api-scenario.mjs)
```

## Not done yet

* `Vault` (`Tg`) belongs to the other agent's branch; its adapter-level helpers used by `App.initializeWithAdapter` are still
  inherited host bindings.
* The mobile drawer (`WD`, mobile only). The workspace tree it manages is already own code.
* The markdown view and its siblings (`W6`, preview, properties, outline, backlinks, search UI, canvas glue), `Editor` wrapper
  (`cP`, `iZ`) — explicitly out of scope for this phase; App commands call their existing APIs for compatibility.
* `MetadataCache`'s remaining host-mapped helpers and a few plugin-manager internals are still inherited.
* Bundled libraries (CodeMirror, Lezer, yaml, moment, tslib) are third-party and are not rewritten.


# src/app.js rewrite: progress

Branch `app-rewrite-big` (worktree `basalt-wt-big`). Own code lives in `src-app/` and is spliced into the inherited bundle by
`build-app.mjs`; the manifest `src-app/manifest.json` says what is replaced. Numbers come from `node tools/own-stats.mjs`
(bytes of the ORIGINAL text of every replaced function / class, divided by the size of the base bundle).

| | replaced | bytes of original text |
| --- | --- | --- |
| functions (leaf helpers, search, timing, transitions, tooltips) | 223 | 37.4 KB |
| classes / objects | 142 | 333.6 KB |
| **total** | | **371.0 KB = 10.06 % of the 3688.9 KB bundle** |

Own readable source: 761 KB in `src-app/*.js` (comments included).

What the percentage means: about 240 KB of the bundle are third-party package modules and most of the 2.9 MB of `var` statements are
bundled libraries (CodeMirror 6, Lezer, yaml, moment, tslib, ...). Those are not "application code"; they go away by dropping the
library, not by rewriting it by hand. The share of the application-specific part is therefore larger than 6.9 %, but the number is

| functions (leaf helpers, search, timing, transitions, tooltips) | 166 | 20.4 KB |
| classes / objects | 63 | 130.3 KB |
| **total** | | **150.7 KB = 4.1 % of the 3688.9 KB bundle** |

Own readable source: 283 KB in `src-app/*.js` (32 modules, comments included).

What the percentage means: about 240 KB of the bundle are third-party package modules and most of the 2.9 MB of `var` statements are
bundled libraries (CodeMirror 6, Lezer, yaml, moment, tslib, ...). Those are not "application code"; they go away by dropping the
library, not by rewriting it by hand. The share of the application-specific part is therefore larger than 4.1 %, but the number is
kept on the full bundle so it cannot flatter itself.

## Mechanism (new in this branch)

* `manifest.classes`: `{ orig: "VT", use: "defineEvents" }` replaces the initialiser of `var VT = function () {...}()` by
  `__basaltOwn.defineEvents(__basaltHost)`. The factory runs at the original position, so every class it extends already exists.
  (`hv -> initTooltips` uses the same hook to give the tooltip functions their two app helpers; it returns the old value `null`.)
* `manifest.host`: readable name -> minified name (`Platform: "Yl"`, a value may also be an expression such as `gm.commands`).
  It becomes the lazily evaluated object `__basaltHost`; own code uses `host.Platform`, never a minified identifier. This table is
  the only place where minified names appear.
* Own classes that inherited classes derive from are written as constructor functions and linked with `inherit()`
  (`src-app/inherit.js`), because the inherited code still calls `Base.call(this)`.
* Function entries work as before (same name and parameters, body forwards to `__basaltOwn`).
* `build-app.mjs` refuses to replace anything whose text differs from the base revision, so a rebuild is always repeatable.

## Replaced modules

| module (src-app) | replaces |
| --- | --- |
| events.js, timing.js | `Events`, `Component`, `debounce` |
| keymap.js | `Scope`, the dynamic-parent scope of the workspace, `Keymap` |
| commands.js | the command registry (`app.commands`), `HotkeyManager` |
| workspace-tree.js | `WorkspaceItem`, `WorkspaceParent`, `WorkspaceSplit`, `WorkspaceContainer`, `WorkspaceRoot`, `WorkspaceFloating`, `WorkspaceWindow` (pop-out) |
| sidedock.js | `WorkspaceSidedock` (collapse / expand / drag) |
| tabs.js | `WorkspaceTabs` (header strip, stacked mode, tab list menu, drop of files / links / bookmarks) |
| leaf.js | `WorkspaceLeaf` and its history (`back` / `forward`, the back list is now really capped at 20) |
| ribbon.js | `WorkspaceRibbon` |
| view.js, view-placeholders.js | `View`, `ItemView`, and the deferred / empty / unknown placeholder views |
| fileview.js | `FileView`, `ViewRegistry` |
| textfileview.js | `EditableFileView` (rename in the title), `TextFileView` (load / save / merge) |
| hover-popover.js | `HoverPopover` with the global pointer tracker |
| animation.js | `Transition`, `runTransition`, `cancelTransition` (also fixes a leaked `transitionend` listener) |
| tooltip.js | the whole tooltip system (`setTooltip`, `displayTooltip`, hover handlers) |
| components.js | `Setting`, `SettingGroup`, `SettingTab`, `PluginSettingTab`, all form components |
| notice.js, modal.js | `Notice`, `Modal` |
| menu.js | `Menu`, `MenuItem`, `MenuSeparator`, `closeAllMenus` |
| suggest.js | the suggestion list, `SuggestModal`, `FuzzySuggestModal`, `PopoverSuggest`, `AbstractInputSuggest`, `EditorSuggest` |
| plugin.js | `Plugin` |
| platform.js | `Platform` |
| search-simple.js | `prepareFuzzySearch`, `prepareSimpleSearch`, the simple matcher, `renderMatches`, `renderResults`, `resolveSubpath` |
| tree.js | the tree widget: `TreeItem`, `TreeChildren`, `TreeRoot`, collapsible items, virtualised `InfinityScroll`, `Tree`, plus traversal / fold / animation helpers |
| view-header.js | `ViewHeader` (nav buttons, sort menu) |
| search-query.js | the search query engine: tokenizer, recursive-descent parser (operators, properties, OR/AND/NOT, comparisons, regexes), the matcher class tree, `SearchQuery` |
| search-view.js | the global search view: `SearchView`, `SearchResults`, file / match / property result items, `FileQueue`, copy-results modal, search suggest |
| link-panes.js | the "Backlinks" and "Outgoing links" panes: shared file-following view base, both views, the backlink component (linked + unlinked mentions) and the outgoing-link component (resolved links + unlinked mentions) |
| tag-pane.js | the "Tags" pane: `TagPaneView` (sort / hierarchy / collapse-all / search header, query filtering that keeps ancestors of matches), `TagPaneTree` (fixed `"tag-pane-fold"` key), `TagPaneItem` rows that open `tag:<tag>` in the global search and recycle their DOM across rebuilds |
| bookmarks.js | the "Bookmarks" pane and plugin: `BookmarksView` + leaf/group tree rows (rename, context menus, active state, drag & drop, copy/cut/paste), the add/edit and add-many modals, the button-modal base, the `Runnable` token, the item factories and the plugin itself (commands, menus, CLI, lookups, open-in-leaf) |
| palette.js | the quick switcher and command palette: the file/alias/unresolved/bookmark suggest modal (recent files on empty query, basename-first matching, Tab folder completion, create-new-file CTA), the command modal (pinned + recent ordering, hotkey hints, pin flair, last-100 recents in localStorage), both settings tabs (pin list with search suggest and drag reorder) and both plugins; plus `InstanceSettingTab`, the settings-tab base the internal plugins share |
| file-explorer.js | the "file-explorer" view (kept for compatibility; `src/basalt-files.js` swaps its leaf to the "Files" panel on every layout change, same as before): `FileExplorerView` + `FileExplorerTree`, the file/folder rows (drag source, contenteditable rename, unsupported-file tags, tooltips, hover-link events), the header (new note / folder, sort menu, auto-reveal, collapse-all), clipboard copy/cut/paste (`basalt/files`), drag & drop into folders with auto-expand, rename validation, vault event sync, context menus and the plugin (commands, reveal-in-folder, hover source). Helpers: promise queue, item->file map, clipboard entry extraction, move/copy-into-folder |
| notes-utils.js | the small core plugins: templates (`TemplatesPlugin` + `TemplateSuggestModal` + settings tab; `{{title}}`/`{{date}}`/`{{time}}` substitution, frontmatter split into the metadata editor, CLI `templates`/`template:read`/`template:insert`), daily notes (`DailyNotesPlugin` + settings tab; format/folder/template options, create-from-template, prev/next navigation, `daily` protocol + `daily:*` CLI, startup path/template helpers), random note and word count (status-bar segments fed by a Web Worker with the stock word regex, `wordcount` CLI, mobile file info). Helpers: frontmatter bounds, template splitter, pane-type check, format validation |

| path.js, text.js, misc.js, frontmatter.js, search.js | the 143 leaf functions of the previous round |

Behaviour changes (all bug fixes, nothing observable in normal use): the leaf history list is trimmed at 20 entries (the inherited
`unshift()` without an argument did nothing), `FileView.onDelete` no longer throws when the leaf is already detached,
`runTransition` removes the `transitionend` listener it adds.

## How each module is verified

1. `node tools/class-compare.mjs` runs the ORIGINAL class text (cut from the base revision) and the own one on the same random
   scenarios and compares every observable result: Events, Component, debounce (virtual clock, two windows), Scope / Keymap,
   Commands + HotkeyManager (fake app), Plugin (fake app, async parts included). 2400 scenarios, all identical.
2. `node tools/app-compare.mjs --no-cargo` does the same for plain functions, including functions returned by functions and the
   match renderer on a fake DOM: 172 functions, 18840 comparisons, 0 differences.
3. `tools/ws-scenario.mjs` (workspace) and `tools/api-scenario.mjs` (settings components, Notice, Modal, Menu, suggest modals,
   editor suggest, commands / hotkeys, file view, text file view, hover popover, tooltips) drive a real isolated runtime through fixed
   operations and print a normalised snapshot per step; the output of the base revision and of the branch is compared with
   `tools/ws-diff.mjs`. Workspace: 33 steps (splits, tabs, stacking, drops of files / links / several files on the tab strip, pinning,
   link groups, history, sidebar collapse, ribbon items, layout round trip, pop-out window, closing everything), 0 differences.
   API: 11 steps, 0 differences. (The only runtime problem the base shows and the branch does not is the `onDelete` exception above.)
4. `tools/app-smoke.mjs` (note, canvas, text file, explorer, graph, search, inherited settings dialog, command palette, split + close,
   pop-out, title bar buttons, console errors) after every commit. Note: the isolated window is off screen and its timers are throttled,
   so a canvas sometimes needs longer than the old fixed wait; the check now polls for up to 30 s (the base revision flaked the same way).

## Commands

```
node build-app.mjs                    # rebuild src/app.js from src-app/ (add --check to only verify)
node tools/own-stats.mjs              # the numbers above
node tools/class-compare.mjs          # classes: original vs own on random scenarios
node tools/app-compare.mjs --no-cargo # functions: original vs own
# runtime tests (the isolated runtime of tools/test-runtime.ps1, run from the main checkout; link stub/node_modules and
# tools/node_modules to the main checkout's first, or run npm i)
powershell -File tools\test-runtime.ps1 -Worktree <worktree> -Scratch <empty dir> -Port 9655 -Vault <vault>
node tools/app-smoke.mjs --make-vault <vault> ; node tools/app-smoke.mjs --port 9655
node tools/ws-scenario.mjs --port 9655 > new.json   # and the same on a runtime that runs the base revision
                                                    # (git worktree add <dir> 7eeaf47 --detach, point test-runtime at it), then
node tools/ws-diff.mjs base.json new.json           # (same for tools/api-scenario.mjs)
```

## Not done yet

* `Workspace` itself (`H0`, 66 KB: layout save / load, active leaf, recent files, hotkey glue, URI handlers) and the mobile drawer
  (`WD`, mobile only). The tree it manages is already own code, so what remains is the controller on top.
* `App` (`Tte`, 56 KB), the internal plugin manager and wrapper (`i2`, `uee`, ...), `StatusBar`, `MetadataCache`, `Vault` (belongs to the
  other agent's branch), drag manager (`xP`), the markdown view and its siblings (`W6`, preview, properties, outline,
  canvas glue), `Editor` wrapper (`cP`, `iZ`). The global search UI, the backlink / outgoing-link panes,
  the tag pane, bookmarks, the quick switcher / command palette, the file explorer and the small core
  plugins (templates, daily notes, random note, word count — notes-utils.js) are done. Graph and canvas
  views are already own code shipped as separate scripts (`src/fp-graph.js` on `graph-engine` WASM,
  `src/fp-canvas.js` on `canvas-engine` WASM); the inherited `kJ`/`EJ`/`AQ`/`xJ` and `r8`/`y5` classes are
  dead compatibility code kept only so old view states still resolve.
* Canvas: `src/fp-canvas.js` (canvas-engine WASM) is *not* a standalone replacement — it is
  baked into `src/fp-canvas.js` and loaded before `app.js`, where `build-canvas.mjs` patches
  ~30 anchors inside the inherited canvas classes (`showMenu`, `createEdgeEnd`,
  `nodeInteractionLayer.render`, export progress, version history, ...). The inherited canvas
  region is therefore live code. Own so far (`src-app/canvas-utils.js`, `canvas-plugin.js`):
  undo stack (`l5`), spatial index (`Y3`) + bbox/point variants (`m5`/`v5`/`g5`), data cache
  (`n8`), node interaction layer (`M5`), `.canvas` metadata extractor (`e8`), link updater
  (`t8`) and the plugin itself (`i8`). Node/modal/suggest/embed classes (`src-app/canvas-nodes.js`,
  `canvas-node.js`): `w5`, `E5`, `K5`, `Q5`, `L5`, `O5`, `N5`, `lI`, `cI`, `x3`, `T3`, `D3`, node
  bases `S5`/`x5`/`T5`/`A5` and node types `I5`/`F5`. Still inherited: file node `P5`, frame `R5`,
  edge `G5`, selection `z3`, menu `U3`, the Canvas class `y5` (~62 KB), view `r8`, embed `a8`,
  settings `s8`, geometry helpers `L3`/`O3`/`A3`/`E3`/`P3`/`I3` and misc `D5`/`dg`/`M$`/`Cg`/`TT`.
* Bundled libraries (CodeMirror, Lezer, yaml, moment, tslib) are third-party and are not rewritten.

  other agent's branch), drag manager (`xP`), the markdown view and its siblings (`W6`, preview, properties, outline, backlinks,
  search UI, canvas glue), `Editor` wrapper (`cP`, `iZ`).
* Bundled libraries (CodeMirror, Lezer, yaml, moment, tslib) are third-party and are not rewritten.

---

## Branch `rewrite-settings-sync` (worktree `basalt-wt-settings-sync`)

Area: settings tabs, theme/plugin browsers, account/licence, sync/publish clients, update checker, branding audit.
Numbers (`node tools/own-stats.mjs`, cumulative over all branches): **267.1 KB = 7.24 % of the bundle** replaced,
own readable source 540.9 KB.

### Replaced in this branch

| module (src-app) | replaces |
| --- | --- |
| secrets.js | the whole keychain/secrets cluster: `SecretStorage` + desktop/mobile backends, secret chooser/edit/picker modals, encryption-info modal, `KeychainTab` (storage keys `secrets`, `secrets-encrypted`, `secrets-meta`, `secrets-encryption-warning-dismissed` unchanged) |
| account.js | account/licence/vault/publish API client (`/login`, `/subscription/*`, `/vault*`, `/publish/*` — wire formats identical), `LoginModal`, `LicenseModal` (neutral Basalt branding, `https://github.com/FalconTechDev/basalt` links) |
| about.js | About/general settings tab: version, update IPC flow (`update`, `check-update`, `disable-update`, `insider-build`, `cli`), language, help, account/licence buttons, advanced |
| tab-hotkeys.js | hotkeys settings tab `C0`: search, shortcut/status filters, default vs user keys, conflicts, add/delete/restore/customize, `hotkeys.json` persistence |
| tab-files.js | files-and-links tab `ute`: startup file, new-note/attachment locations, link format, wikilinks, trash, ignore-filters modal, custom config folder, URI callbacks |
| tab-editor.js | editor tab `rte`: view/edit modes, readable line length, properties, folding, line numbers, spellcheck + dictionary modal, auto-pairing, tabs, HTML conversion, vim confirm flow |
| tab-appearance.js | appearance tab `tte`: base theme, accent colour, theme/snippet managers, interface options, fonts, zoom, native menus, frame style, custom icon (png/ico/icns decode + trim), translucency, GPU toggle |
| tab-plugins.js | core plugins tab `mte` |
| tab-community.js | community plugins tab `ite` (restricted-mode flow, per-plugin settings/hotkeys/donate/uninstall) |
| community.js | community modal base `y0` (search, sort, installed-only, detail pane, swipe nav, render queue), plugin browser `M0` (10k+ plugin feed, manifests, versions.json compat pick, install/update/enable/disable/uninstall, share link `basalt://show-plugin`), theme browser `D0` (1k+ theme feed, screenshots, install/use/update/uninstall), donate dialog `S0`. Feeds stay `obsidianmd/obsidian-releases` (required wire compat) |
| vault-crypto.js | vault crypto: scrypt key, HKDF keyhash (v0/v2/v3), AES-GCM payload, AES-SIV deterministic codec, `obsidian://` callback parser — byte-compatible with inherited impl (cross-decrypt verified) |
| sync-screens.js | sync onboarding screen stack `oC`..`DC` (25 classes): start/intro/create-vault/setup/encryption/features/auth-choice/vault-list/sign-in/sign-up/verify/method-select/iCloud/Android-perms screens. Same DOM classes, i18n keys, navigation, account+vault API calls. Dead controller IIFE inside `AC` replaced by the synced-keys array it evaluated to |

### Runtime-verified

settings tabs (about, hotkeys, files, editor, appearance, core/community plugins) render localized rows with 0 exceptions;
community plugin browser lists 10 375 plugins with working detail pane; theme browser lists 1 005 themes.
`build-app.mjs --check` clean after every change.

### Not done in this area

* **Publish plugin UI**: wire layer own (`account.js` `/publish/*` endpoints). The plugin itself
  (`u9`/`h9`, `https://publish.basalt.md`, classes `V7`..`$9` + plugin `f9`, ~3.68-3.82 MB,
  ~142 KB minified, 44 classes) is still inherited — site list, create flow, slug setup,
  site settings, nav/share management, share-code accept. Basalt's data sync itself is the
  own git engine (`src/vault-sync.js`, `src/basalt-git.js`); no Obsidian chunk-sync
  worker/crypto exists in this bundle. Sync onboarding screens are now own (`sync-screens.js`,
  verified: full `app-smoke.mjs` passes with 0 exceptions on the rebuilt bundle).
* Remaining inherited bits reachable through bindEnv: theme/font/ribbon dialogs (`A0`→now own `D0`, `ete`, `zee`),
  markdown render pipeline for READMEs (`Zx`,`Kx`,`xL`,`eb`), HTTP layer `cy`.
