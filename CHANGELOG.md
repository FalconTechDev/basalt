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

## [0.3.9]

### Added
- Dropping a board from the vault onto a board adds a board card: a picture drawn with the board's own link rules, refreshed when the file changes, opened with a double click, linked in the graph.
- Notes and `.txt` files dropped on a board become live file cards (edits go both ways).
- Dropping or pasting `.board`, `.canvas`, images and text files from the computer or from an opened folder's file manager works; Ctrl+V takes files from the clipboard.

### Fixed
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
