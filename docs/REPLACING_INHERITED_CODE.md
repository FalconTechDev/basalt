# Replacing the inherited code in `src/app.js`

Measured on 2026-11-24 on the committed `src/app.js` (5 780 000 characters). Reproduce with `node tools/inherited-stats.mjs` (needs no git history);
the share of the ORIGINAL bundle that was replaced comes from `node tools/own-stats.mjs` (still reads the base revision `ca5acac` from git).

## 1. Where things stand

Composition of the file as it is now:

| Part | Size | Share |
|---|---|---|
| Own modules (`src-app/*.js`, readable, spliced in by `build-app.mjs`) | 4 192 KB | 74.3 % |
| Glue: one-line wrappers left where a function or class was replaced | 78 KB | 1.4 % |
| Third-party libraries (see section 4) | 1 190 KB | 21.1 % |
| **Still Obsidian's code** | **172 KB** | **3.0 %** |
| Separators, webpack runtime | 12 KB | 0.2 % |

Seen from the original bundle (3 689 KB): 542 functions and 678 classes (2 227 KB, **60.4 %**; a further 485 declarators and 62 methods are replaced too, but own-stats does not count them) are replaced by own code; the same anchors run on the
untouched bundle count 1 341 KB of libraries and 2 335 KB of Obsidian code. About 150 KB of what a plain anchor count calls "library" in the original bundle was
Obsidian code sitting between library parts and has since been replaced, which is why the library figure shrinks from 1 341 to 1 190 KB.
The remaining inherited code is therefore about **172 KB certain**, plus a possible tail (below 60 KB, my estimate) of Obsidian lines hidden inside the library
regions: the region boundaries were set by reading the bundle, so treat the split as +-3 % of the file. The totals of the first three rows are exact.

What the 172 KB are (576 top-level items; `node tools/inherited-stats.mjs --list` prints them all):

| Area | Size | Items | What it does |
|---|---|---|---|
| Bases formula functions (`QW.addGlobal`, `QW.addForType`) | 25.6 KB | 3 | the built-in functions of the Bases formula language: `now`, `date`, string / number / list / date / link methods |
| Obsidian custom icon set (`Qm`) and icon aliases (`Ym`) | 19.8 KB | 6 | SVG paths drawn by Obsidian, and the name table that maps old icon names to Lucide names |
| Markdown-to-HTML glue on the remark chain | 20.7 KB | 96 | `==mark==`, tag, wikilink and image-size extensions, the `Hx` / `Zx` render entry points |
| DOM focus, scroll, key-name, pointer, tooltip helpers | 21.3 KB | 130 | many small utilities (`Nv`, `Cg`, `_g`, key-name table `Tg`, lazy promise `Hv`, ...) |
| Vim cursor layer and CM5 compat (`oj`, `Pq`, `Iq`, `tj`, `Aq`) | 19.2 KB | 40 | draws the Vim cursor in CodeMirror 6 and adapts the CodeMirror 5 vim keymap |
| hypermd CodeMirror 5 mode | 16.6 KB | 22 | the old live-preview tokenizer (HyperMD-derived, MIT upstream) |
| Platform, animation, clipboard, mobile touch helpers | 13.6 KB | 78 | height animations, OS detection, long-press and tap handling for touch screens |
| Plugin API export tables (`n.r(d),n.d(d,{AbstractInputSuggest:...`) | 11.1 KB | 26 | the list of names a community plugin can import (this is the compatibility surface) |
| Bases expression grammar (lezer tables `xK` and helpers) | 7.2 KB | 22 | generated parser tables of the formula language |
| Startup tail (font preload, theme classes, sort options, collab/lint glue) | 8.3 KB | 79 | small statements at the end of the application scope |
| Turndown rules (HTML to Markdown) | 6.4 KB | 34 | the rules added on top of `src/lib/turndown.js` |
| Mobile / Capacitor / haptics glue | 3.9 KB | 22 | the same for the phone app; Basalt is a Windows desktop app |
| Not assigned to an area | 2.1 KB | 18 | |

Webpack modules written by Obsidian: one 121-byte stub (`RateAppWeb`). All other webpack modules are third-party (section 4).

## 2. Build and git history

Done in this change: `build-app.mjs` reads the base revision from git only when a manifest entry is replaced for the first time (to check that the text being
replaced is the original). Once `src/app.js` holds the wrapper, nothing is read from git. Verified on a copy of the tree **without `.git`**: `--check` passes and a
full rebuild produces a file with the same sha256 as the committed `src/app.js`; an entry whose wrapper was removed fails with a message that names the missing
history (checked, not assumed).

What still needs the history, precisely:

* adding a new entry, class, declarator or method to `src-app/manifest.json` (the check against the original text);
* the dev-only tools `tools/own-stats.mjs`, `app-compare.mjs`, `class-compare.mjs`, `vault-compare.mjs`, `worker-compare.mjs`, `check-dom-classes.mjs`
  (differential tests against the original bundle). They can be pointed at an out-of-repo copy of `ca5acac:src/app.js` by changing `loadBase` in `tools/app-base.mjs`
  to read a file; that was not done here.

What this does **not** give you: the build is still not independent of the inherited code. `src/app.js` is both the input and the output of `build-app.mjs`
(it is committed with the inherited code inside), and the own modules reach the inherited ones through 829 `__basaltHost` getters and 809 `envBind` names, which are
the original minified identifiers (`VT`, `jm`, `Yl`, ...). Deleting the history removes the check, not the dependency. The dependency ends only when the list in
section 3 is empty and the host names are replaced by explicit imports between own modules.
The git history also still holds the untouched bundle (`d89c49d` .. `ca5acac`); it was not rewritten here.

## 3. Order of replacement

Ordered by (legal sensitivity x size) / effort, cheap deletions first. "Test" is how the project already checks equivalence (`tools/class-compare.mjs`, `tools/app-compare.mjs`,
`tools/app-smoke.mjs`).

1. **Mobile and Capacitor glue, about 10 KB.** Delete, do not rewrite: Basalt ships on Windows only. That is the 3.9 KB mobile / Capacitor / haptics block plus the touch and long-press handlers
   (`Vm`, `Gc`, `jc`, about 6.6 KB) that sit in the platform-helper block; the rest of that block (animations, OS detection, clipboard, about 7 KB) is rewritten normally in step 4. Remove the `Yl.isMobile`
   branches and the `Capacitor` platform checks, then the webpack modules `@capacitor/core`, `async-mutex`, secure-storage glue and `RateAppWeb` (17 KB, section 4) if nothing else requires them (check the
   `n(6043)` call sites first). Test: smoke run, no console errors.
2. **Obsidian icon set and alias table, 19.8 KB.** These are drawings, the most sensitive thing on the list per kilobyte. Map every name to a Lucide icon (ISC) or to an own drawing,
   delete `Qm` and `Ym`. Test: screenshot compare of the toolbar, file explorer and settings (`tools/ui-audit.mjs`).
3. **Bases formula functions and grammar, 32.8 KB.** Pure functions with a documented behaviour, so the easiest large block to rebuild from a written specification (the function list is in
   the user-facing docs) and test by table. Write an own lezer grammar with the same node names instead of keeping the generated tables. Test: a table of expression -> value, plus opening
   an existing `.base` file.
4. **DOM helpers, 21.3 KB (130 small items).** Mechanical: the project's usual loop (own function in `src-app/`, manifest entry, `app-compare`). Do it in batches of 20.
5. **Plugin API export tables, 11.1 KB.** Rewrite as one own file that lists the exported names; the names themselves are the compatibility contract and stay. Test: the plugin API scenario
   (`tools/api-scenario.mjs`).
6. **Markdown-to-HTML glue and the whole remark chain, 20.7 KB + 110 KB of webpack modules.** First find the call sites of `Hx` / `Zx` / the `Parser` binding. If the reading view already
   goes through `markdown-engine` (Rust), the chain is only used by export / copy-as-HTML and can be replaced by it or deleted. This is the largest single removal.
7. **Vim, 19.2 KB.** Replace the cursor layer and the CM5 adapter with the maintained `@replit/codemirror-vim` (MIT), pinned. Removes inherited code by adding an upstream dependency.
8. **hypermd CM5 mode, 16.6 KB.** Retire together with the CodeMirror 5 editor path once the CM6 editor (`src-app/n-g09-editor-*.js`) is the only one. Upstream HyperMD is MIT, so a copy with attribution is
   an acceptable fallback but is still code that came through Obsidian.
9. **Turndown rules, 6.4 KB; startup tail, 8.3 KB; the rest, 2 KB.** Small, last.

After the list is empty, remove the host coupling: replace `__basaltHost` / `envBind` by an explicit `host.js` registry between own modules, make `build-app.mjs` assemble `src/app.js`
from `src-app/` + pinned libraries only (no committed input), and run `node tools/inherited-stats.mjs`: the "Obsidian's code" line has to read 0.

## 4. Third-party code (not Obsidian's, but not pinned either)

Full table with licences: `THIRD_PARTY.md`, files and hashes: `vendor/MANIFEST.json`, licence texts: `vendor/licenses/`.

| Library | Size | Licence | Note |
|---|---|---|---|
| Lucide icon table | 282 KB | ISC (+ MIT, Feather) | cut out verbatim into `vendor/lucide/icons.js` |
| CodeMirror 6 (state, view, commands, search, autocomplete, lint, 2nd language copy) | 417 KB | MIT | second copy of `@codemirror/language` (32 KB) is a duplicate to drop |
| Lezer common / highlight / language, lr | 112 KB | MIT | |
| yaml (eemeli) | 95 KB | ISC | |
| diff-match-patch, DOMPurify 3.0.1, idb, tslib | 46 KB | Apache-2.0, Apache-2.0 OR MPL-2.0, ISC, 0BSD | |
| unified / remark family (165 webpack modules) | 110 KB | MIT | candidate for deletion (step 6) |
| ts-ebml and Node polyfills (18 modules) | 108 KB | MIT, BSD-3-Clause | webm duration fix; candidate for deletion if recording audio is dropped, else pin |
| @capacitor/core, async-mutex, secure-storage glue (5 modules) | 17 KB | MIT; the secure-storage plugin is not identified | delete with step 1 |
| crypto-js (sha256, hmac, hex) | 6 KB | MIT | replace by `crypto.subtle` (a few lines) |

To get the libraries of the application scope out of `src/app.js` for good (they cannot be sliced, see `vendor/README.md`), take the upstream npm release of each
package, record the exact version, bundle it (esbuild) and bind it to the own code through explicit imports. Do it in this order: yaml, diff-match-patch, DOMPurify, idb
(each independent, a few KB), then Lucide, then CodeMirror 6 + Lezer together (the own editor reads their internals through `envBind`, so that is one coordinated change).

## 5. A caution about the rewrites themselves

60 % "replaced" means: the original minified text is no longer in the file. It does not by itself mean the replacement is free of the original.
The 1 220 replaced functions and classes are structural ports: each own function or class keeps the original's boundaries and parameter lists, is wired in under the original's minified
name (`function nu(e){return/*own*/__basaltOwn.lastSegment(e)}`), and is accepted only when a differential test shows identical behaviour against the original text.
Some modules are labelled clean-room, written against a specification (`src-app/n-g25-misc.js` cites `F:\orch\specs\g25.md`); those specifications are not in the repository,
so I could not check who wrote them and from what. A readable rewrite produced by reading the deobfuscated original can still be a derivative work in the legal sense, whatever the
identifiers look like. Whether Basalt's own modules are clean is a question for a lawyer and for the provenance records, not something the byte counts above answer.
For the highest-risk parts (icons, Bases formula functions, English UI strings, the stylesheet) prefer rewriting from a behavioural description written by someone who has not read the
original source, and keep a short provenance note per module.
