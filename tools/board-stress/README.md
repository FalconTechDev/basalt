# Board stress tools

Measure and regression-test the board view (`src/basalt-board.js`) under heavy load. Everything drives a headless Basalt over the
Chrome DevTools Protocol (node 22+, no dependencies).

## Start a headless Basalt (never touches your real data)

`runtime\resources\app` and `app-src` are junctions into this repo (`run.ps1` makes them). If they point at a folder that no longer
exists the exe starts and silently shows nothing, so check them first.

```
mkdir %TEMP%\bsstress\ud %TEMP%\bsstress\vault
set BASALT_HEADLESS=1
runtime\Basalt.exe --user-data-dir=%TEMP%\bsstress\ud --remote-debugging-port=9333 ^
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling ^
  --disable-features=CalculateNativeWinOcclusion
```

A fresh data dir shows the start window; open the scratch vault with the page's own IPC (forward slashes!):

```
node tools\board-stress\probe.mjs 9333 starter "require('electron').ipcRenderer.sendSync('vault-open','C:/Users/<you>/AppData/Local/Temp/bsstress/vault',false)"
```

Kill only that process (the one whose command line contains `bsstress`) when done and delete the temp folder.

## Scripts

| script | what it does |
| --- | --- |
| `cdp.mjs` | tiny CDP client (`connect(port, urlRegex)`, `eval`, exceptions and crash events collected) |
| `reload.mjs <port>` | hard reload of the vault window (the page caches scripts, a normal reload may keep old code) |
| `harness.js` | injected into the page: card/edge/ink builders, frame recorder (rAF deltas), long tasks, per-method timers |
| `run.mjs <port> <scenario> [n] [tag]` | scenarios `cards` `bigmd` `images` `links` `ink` `frame` `remote` `all`; appends to `results.jsonl` |
| `ops.mjs <port> <tag> [cards]` | timed operations on a 2 000-card board: layouts, undo, export, save, snapshot, paste, import, search, select all, delete |
| `smoke.mjs <port>` | functional check through real mouse/keyboard events (drag, box select, edit, delete/undo, zoom levels, remote edit, search) |
| `prof.mjs <port> "<expr>"` | CPU profile of an expression, top self-time functions |
| `baseline.mjs <port> <old basalt-board.js>` | serves an old copy of the board script to the running app (no file touched) to measure "before" |

## Numbers recorded in `results.jsonl`

`before` / `base*` tags are the old code, `after*` the optimised one. Frame times are rAF deltas (16.7 ms = 60 fps).
Long task = a main-thread task over 50 ms.
