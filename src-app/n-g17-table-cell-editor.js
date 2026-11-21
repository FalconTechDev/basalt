// g17 clean-room table cell editor (was `uZ`).
//
// The nested CodeMirror editor that opens inside a markdown table cell:
// owns a small EditorView seeded with the cell's unescaped text, forwards
// document transactions back into the TableWidget model (which re-serializes
// the cell into the main document), and implements the cell-navigation
// keymap (Tab / Shift-Tab / Enter, row insertion on the last cell).
//
// Host values are read lazily through env() / the `host` argument.

import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng17tceE = () => env();

let ng17CellEditorClass = null;

export function defineTableCellEditor(host) {
  if (ng17CellEditorClass) return ng17CellEditorClass;
  const Base = host.Component || ng17tceE().jm || function Component() {};
  const yq = () => ng17tceE().yq;

  function TableCellEditor(editor, wrapper, table, cell) {
    const self = Base.call(this) || this;
    self.editor = editor;          // CMEditorComponent (has .cm, .app, .path)
    self.table = table;            // TableWidget
    self.cell = cell;              // ng10TableCell
    self.containerEl = wrapper;    // div.table-cell-wrapper
    if (typeof self.register === "function") self.register(() => self.destroy());
    self.build();
    return self;
  }
  inherit(TableCellEditor, Base);

  const proto = TableCellEditor.prototype;

  proto.build = function () {
    const self = this;
    const cell = self.cell;
    const table = self.table;
    const editor = self.editor;

    // display text: unescape the stored cell source
    let text = cell.text || "";
    try {
      const un = host.parseTableCellText ? host.parseTableCellText(text) : text;
      if (typeof un === "string") text = un;
    } catch (e) { /* keep raw */ }

    const yqAnn = yq();

    const navTo = (target) => {
      if (!target) return false;
      table.setCellFocus(target.row, target.col);
      return true;
    };

    const keymap = host.cmKeymapFacet.of([
      {
        key: "Tab",
        run(view) {
          const next = table.getNextCell(cell, "end");
          if (next) { navTo(next); return true; }
          // last cell: append a row and focus its first cell in this column
          try {
            table.insertRow(table.rows.length, cell.col);
            const row = table.rows.length - 1;
            const nc = table.getCellAt(row, Math.min(cell.col, table.alignments.length - 1));
            if (nc) table.setCellFocus(nc.row, nc.col);
          } catch (e) { /* malformed table: fall through */ }
          return true;
        },
      },
      {
        key: "Shift-Tab",
        run(view) {
          const prev = table.getNextCell(cell, "start");
          if (prev) { navTo(prev); return true; }
          // first cell: return focus to the main editor before the table
          try {
            const cm = editor.cm;
            cm.dispatch({ selection: ng17tceE().pe.cursor(Math.max(0, table.start)) });
            editor.destroyTableCell();
            cm.focus();
          } catch (e) { /* noop */ }
          return true;
        },
      },
      {
        key: "Enter",
        run(view) {
          const below = table.getCellBelow(cell);
          if (below) { navTo(below); return true; }
          try {
            table.insertRow(table.rows.length, cell.col);
            const row = table.rows.length - 1;
            const nc = table.getCellAt(row, Math.min(cell.col, table.alignments.length - 1));
            if (nc) table.setCellFocus(nc.row, nc.col);
          } catch (e) { /* noop */ }
          return true;
        },
      },
      {
        key: "Escape",
        run(view) {
          try { editor.destroyTableCell(); } catch (e) { /* noop */ }
          try { editor.cm.focus(); } catch (e) { /* noop */ }
          return true;
        },
      },
    ]);

    const updateListener = host.cmView.updateListener.of((update) => {
      for (const tr of update.transactions) {
        if (!tr.docChanged) continue;
        if (yqAnn && tr.annotation(yqAnn)) continue; // echo of a main->cell sync
        try { table.dispatchUpdate(self, tr); } catch (e) { /* noop */ }
      }
    });

    const extensions = [keymap, updateListener];

    const state = host.cmState.create({ doc: text, extensions });
    self.cm = new host.CMEditorView({ state, parent: self.containerEl });
    self.cm.focus();
  };

  /** Main-editor transaction already applied inside the cell span -> refresh doc. */
  proto.applyExternalChanges = function (changes) {
    const self = this;
    if (!self.cm || !changes || !changes.length) return;
    const specs = changes.map((c) => ({ from: c.from, to: c.to, insert: c.insert }));
    self.cm.dispatch({ changes: specs, annotations: yqAnnOf() });
  };

  function yqAnnOf() {
    const a = yq();
    return a ? [a.of(true)] : [];
  }

  proto.onunload = function () {
    try { if (this.cm) this.cm.destroy(); } catch (e) { /* noop */ }
    this.cm = null;
  };
  proto.unload = proto.onunload;
  proto.destroy = proto.onunload;

  ng17CellEditorClass = TableCellEditor;
  return ng17CellEditorClass;
}
