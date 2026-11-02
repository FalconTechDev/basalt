# Basalt interface style

One shape language for every module (viewer, drawing, graph, palette, settings, home, catalog, canvas pop-ups, history).

## Shapes
- **Panels** (floating bars, cards, pop-ups, modals, tiles, minimap): `border-radius: 0; clip-path: var(--bs-clip)`. Two corners are cut: top-left and bottom-right, by `--bs-c` (6px). No box-shadow on a clipped panel, the clip would eat it.
- **Small controls** (icon buttons, chips, list rows, tags): `border-radius: var(--bs-r)` (4px).
- **Inputs and flat rows**: `border-radius: 0`; the focus ring is the accent border, never a blurred rounded glow.
- **Drawn on a canvas** (graph thumbnails, previews): the same cut corners, drawn by hand with a path (see `cut()` in `graph-engine/fp-graph.src.js`).

## Tokens (defined once in `src/basalt-ui.js`)
`--bs-clip`, `--bs-c`, `--bs-r`, `--bs-gap` (8px), `--bs-pad` (12px), `--bs-ease` (.12s). Colours always come from the theme variables (`--background-secondary`, `--background-modifier-border`, `--interactive-accent`, `--text-muted` ...), never hard-coded, so both themes (dark "basalt", light "moonstone") work.

## Rules for a new module
1. Take the panel, control and row shapes above; do not invent radii.
2. Background `--background-secondary`, border `1px solid var(--background-modifier-border)`, accent only for the active state.
3. Text sizes from `--font-ui-small` / `--font-ui-medium`; labels in the theme font, numbers tabular.
4. Hover: `--background-modifier-hover`; active: accent at 24% over transparent.
5. Check the screen in both themes before shipping.
