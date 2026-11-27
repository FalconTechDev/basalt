# Changelog

All notable changes. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed
- Project licence is now AGPL-3.0 (own files); inherited code keeps its original terms until replaced.
- The runtime is built from a stock Electron 39.8.6 instead of a renamed copy of another app's runtime. The installer is 94 MB.
- The README, contributing guide and issue templates are rewritten in English.

### Added
- `vendor/` with third-party libraries, their licence texts and a manifest.
- `docs/REPLACING_INHERITED_CODE.md`: measured share of inherited code (about 3 % of `src/app.js`) and the replacement plan.
- `build-app.mjs` no longer needs git history once a function has been replaced.

## [0.3.11]

### Fixed
- Board export no longer captures dialogs, notices, menus, bars or scrollbars into the picture.
- "Copy path" in the file menu had no action: it is now two items, the full path on disk and the path inside the vault.
- The app reported itself as 0.1.0 and kept offering an update; the installer now stamps the packaged version.

## [0.3.10]

### Fixed
- Ctrl+V on a board works wherever the focus is: a picture from the clipboard, a file copied in the file manager (a `.board` becomes cards, images and text files become cards) or plain text.
- Pictures pasted or dropped from outside are saved as files in the vault root (the "move images" feature can file them away); the card follows the file when it is moved or renamed.
- The README no longer lists the integrated terminal, which is not part of the app at the moment.

## [0.3.9]

### Added
- Linux x64 (`.tar.gz`) and macOS arm64 / x64 (`.zip`) builds from stock Electron 39.8.6, made by `build-unix.mjs` (see `docs/BUILD-UNIX.md`). The macOS builds are unsigned, untested on a Mac and have no terminal helper; the Linux build includes the terminal and command-line helpers.
- Dropping a board from the vault onto a board adds a board card: a picture drawn with the board's own link rules, refreshed when the file changes, opened with a double click, linked in the graph.
- Notes and `.txt` files dropped on a board become live file cards (edits go both ways).
- Dropping or pasting `.board`, `.canvas`, images and text files from the computer or from an opened folder's file manager works; Ctrl+V takes files from the clipboard.

### Fixed
- The launcher finds the app through `process.resourcesPath` (needed inside a macOS `.app`); the in-app updater no longer tries to run the Windows installer on other systems; without `basalt-pty` the terminal says so.
- Idle CPU: a graph tab swap loop and a share animation loop kept the window repainting.
- Boards written as plain JSON (no ydoc) open with their cards, and the board file now keeps link sides, shapes and card fields.
- Round toggle thumbs and click-outside closing in the graph panels; English strings in the interface.

## [0.3.7]

### Added
- Board: virtualised rendering for very large boards, frames with explicit membership, curved links by default, link ports, markdown cards with a formatting toolbar, export through window capture (all, selection or a drawn area; original, white, black or transparent), drawing lock, number keys for tools, shape snapping.
- Graph: redesigned 2D renderer with filters, legend, path finding, pins and export.
- CLI and local API: about 25 routes, documented in `docs/CLI.md`, `docs/API.md` and `docs/api/openapi.yaml`.
- Interface: calmer home screen, custom thin scrollbars and cursors, transparency level, type and on/off switch.
- A new start window.

### Fixed
- Closing the app flushes open boards and shared rooms before exit.
- Double click on card text no longer creates a new card.
- Ctrl+B, I, E and K work inside cards.
