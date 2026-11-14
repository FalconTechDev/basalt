# src/app.js rewrite: progress

Branch `rewrite-editor` (worktree `basalt-wt-editor`). Own code lives in `src-app/` and is spliced into the inherited bundle by
`build-app.mjs`; the manifest `src-app/manifest.json` says what is replaced. Numbers come from `node tools/own-stats.mjs`
(bytes of the ORIGINAL text of every replaced function / class, divided by the size of the base bundle).

| | replaced | bytes of original text |
| --- | --- | --- |
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
  other agent's branch), drag manager (`xP`), the markdown view and its siblings (`W6`, preview, properties, outline, backlinks,
  search UI, canvas glue), `Editor` wrapper (`cP`, `iZ`).
* Bundled libraries (CodeMirror, Lezer, yaml, moment, tslib) are third-party and are not rewritten.
