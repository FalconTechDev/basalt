// s22 slice: the markdown table widgets — S22TableCell (one <td>/<th> with its
// source offsets and padding) and S22TableWidget (the CM6 embed widget that owns
// the whole table: selection, editing, drag handles, context menus, copy/paste
// and markdown serialisation). Ported from the inherited class-IIFEs gq/bq.
import { env } from "./env.js";
import { inherit } from "./inherit.js";


/** Annotation marking transactions that originate from the table widget itself. */
export function s22TableUpdateAnnotation(Annotation) {
  return Annotation.define();
}

// ---------------------------------------------------------------------------
// Table cell
// ---------------------------------------------------------------------------

/**
 * One rendered table cell. `start`/`end` are offsets inside the table document
 * (relative to the widget), `padStart`/`padEnd` the literal space padding that
 * surrounds `text` in the source.
 */
export function defineTableCell() {
  function TableCell(table, row, col, text, padStart, padEnd) {
    this.start = 0;
    this.padStart = 1;
    this.end = 0;
    this.padEnd = 1;
    this.dirty = false;
    this.table = table;
    this.row = row;
    this.col = col;
    this.text = text === undefined ? "" : text;
    this.padStart = padStart === undefined ? 1 : padStart;
    this.padEnd = padEnd === undefined ? 1 : padEnd;
  }

  TableCell.prototype.setTextDir = function () {
    const el = this.el;
    el.dir = env().Mg(el);
    if (this.row === 0 && this.col === 0) this.table.containerEl.dir = el.dir;
  };

  /** Wraps the cell element's children in a `.table-cell-wrapper` div and wires events. */
  TableCell.prototype.init = function (el, start, end) {
    const self = this;
    this.el = el;
    this.start = start;
    this.end = end;
    this.setTextDir();
    const children = Array.from(el.childNodes);
    const wrapper = (this.contentEl = el.createDiv("table-cell-wrapper"));
    wrapper.append.apply(wrapper, children);
    if (children.length === 0) wrapper.createEl("br");

    el.addEventListener("click", (event) => {
      if (event.detail === 4) {
        event.preventDefault();
        const table = self.table;
        const first = table.rows.first().first();
        const last = table.rows.last().last();
        self.contentEl.win.setTimeout(() => table.selectCells(first, last));
      }
    });

    el.addEventListener("contextmenu", (event) => {
      if (event.defaultPrevented) return;
      const table = self.table;
      const cellEditor = table.editor.tableCell;
      const hasSelection = table.selectedCells.length > 0;
      if (event.pointerType === "mouse") {
        if (hasSelection && !table.selectedCells.contains(self)) {
          table.deselectCells();
          table.setCellFocus(self.row, self.col);
          return cellEditor.onContextMenu(event);
        }
        if (!hasSelection && (cellEditor === null || cellEditor === void 0 ? void 0 : cellEditor.cell) === self) {
          if (cellEditor.cm.hasFocus) return;
          cellEditor.cm.focus();
          return cellEditor.onContextMenu(event);
        }
        table.onContextMenu(self, env().Ug.forEvent(event));
      } else if (hasSelection && table.selectedCells.contains(self)) {
        table.onContextMenu(self, env().Ug.forEvent(event));
      }
    });

    el.addEventListener("dragenter", () => {
      const table = self.table;
      const cellEditor = table.editor.tableCell;
      if ((cellEditor === null || cellEditor === void 0 ? void 0 : cellEditor.cell) !== self) {
        table.editor.editTableCell(table, self);
      }
    });

    el.addEventListener("dragleave", (event) => {
      const editor = self.table.editor;
      const cellEditor = editor.tableCell;
      if (!env().Bv(event, el) && (cellEditor === null || cellEditor === void 0 ? void 0 : cellEditor.cell) === self) {
        editor.destroyTableCell();
      }
    });

    el.addEventListener("pointerdown", (event) => {
      const table = self.table;
      if (event.button === 2 && table.selectedCells.contains(self)) event.preventDefault();
      if (!(event.isPrimary && event.button === 0 && !event.defaultPrevented)) return;
      const win = event.win;
      let anchorCell = self;
      let headCell = self;
      let wasMalformed = table.isMalformed;
      const selectRange = () => {
        if (wasMalformed && !table.isMalformed) {
          anchorCell = table.getCellAt(anchorCell.row, anchorCell.col);
          headCell = table.getCellAt(headCell.row, headCell.col);
          wasMalformed = false;
        }
        table.selectCells(anchorCell, headCell);
      };
      const cellEditor = table.editor.tableCell;
      if (cellEditor && event.shiftKey) {
        anchorCell = cellEditor.cell;
        headCell = self;
      }
      const focusEditor = () => {
        const current = table.editor.tableCell;
        if (anchorCell === (current === null || current === void 0 ? void 0 : current.cell)) return;
        const range = pointerSelectionRange(event);
        table.setCellFocus(anchorCell.row, anchorCell.col, (cm) =>
          env().pe.single(cm.posAtCoords(range.anchor), cm.posAtCoords(range.head))
        );
      };
      const isTouch = event.pointerType === "touch";
      if (isTouch) {
        if (cellEditor) {
          const cm = cellEditor.cm;
          const main = cm.state.selection.main;
          if (cm.hasFocus && cm.contentDOM.contains(event.targetNode) && main.empty) {
            return self.handleMobileCaretDrag(event, anchorCell);
          }
        }
      } else {
        selectRange();
      }
      let clickTimer = 0;
      const onClick = (clickEvent) => {
        cleanup();
        if (!clickEvent.defaultPrevented) {
          clickEvent.preventDefault();
          focusEditor();
        }
      };
      const cleanup = () => {
        win.removeEventListener("click", onClick);
        win.clearTimeout(clickTimer);
      };
      win.addEventListener("click", onClick);
      const start = env().Fl(event);
      const drag = env().Cg(
        event,
        () => ({
          move: (moveEvent) => {
            if (isTouch) {
              if (env().Bl(env().Fl(moveEvent), start) > 5) {
                cleanup();
                drag();
              }
            } else {
              headCell = table.getClosestCell(moveEvent.clientX, moveEvent.clientY);
              selectRange();
            }
          },
          end: (endEvent) => {
            if (endEvent.type !== "dragstart") {
              clickTimer = win.setTimeout(() => focusEditor(), 10);
            }
          },
          cancel: () => cleanup(),
        }),
        0
      );
    });
  };

  /** Converts the current DOM selection into editor coordinates relative to a pointer event. */
  function pointerSelectionRange(event) {
    const selection = event.win.getSelection();
    const point = { x: event.clientX, y: event.clientY };
    const fallback = { head: point, anchor: point };
    if (selection.rangeCount < 1) return fallback;
    const rects = selection.getRangeAt(0).getClientRects();
    if (rects.length === 0) return fallback;
    const rtl = env().Tv(selection.toString()) === "rtl" ? true : false;
    // Tv returns a direction string; treat anything reporting rtl as rtl
    const first = rects[0];
    const last = rects[rects.length - 1];
    const start = { x: rtl ? first.right : first.left, y: first.y + first.height / 2 };
    const end = { x: rtl ? last.left : last.right, y: last.y + last.height / 2 };
    return env().Bl(point, start) > env().Bl(point, end) ? { head: end, anchor: start } : { head: start, anchor: end };
  }

  /** Touch-drag caret tracking for mobile table editing. */
  TableCell.prototype.handleMobileCaretDrag = function (event, anchorCell) {
    const table = this.table;
    const containerEl = table.containerEl;
    const editor = table.editor;
    const win = event.win;
    const pointerId = event.pointerId;
    const scrollEl = editor.cm.scrollDOM;
    let point = null;
    let frame = 0;
    let lastTime = 0;
    const step = (time) => {
      const delta = lastTime === 0 ? 50 : time - lastTime;
      frame = win.requestAnimationFrame(step);
      lastTime = time;
      const scrolledContainer = env().wg(containerEl, point, delta, 1);
      const scrolledEditor = env().wg(scrollEl, point, delta, 1);
      if (scrolledContainer || scrolledEditor) {
        const cell = table.getClosestCell(point.x, point.y);
        table.selectCells(anchorCell, cell);
      }
    };
    if (env().Yl.isIosApp) {
      const startTime = Date.now();
      const onMove = (moveEvent) => {
        if (moveEvent.pointerId === pointerId && Date.now() - startTime >= 200) {
          point = env().Fl(moveEvent);
          if (!frame) frame = win.requestAnimationFrame(step);
          const cell = table.getClosestCell(point.x, point.y);
          table.selectCells(anchorCell, cell);
        }
      };
      const onUp = (upEvent) => {
        if (upEvent.pointerId === pointerId) {
          stop();
          if (table.selectedCells.length) table.editor.destroyTableCell();
        }
      };
      const onCancel = (cancelEvent) => {
        if (cancelEvent.pointerId === pointerId) stop();
      };
      const stop = () => {
        win.cancelAnimationFrame(frame);
        win.removeEventListener("pointermove", onMove);
        win.removeEventListener("pointerup", onUp);
        win.removeEventListener("pointercancel", onCancel);
      };
      win.addEventListener("pointermove", onMove);
      win.addEventListener("pointerup", onUp);
      win.addEventListener("pointercancel", onCancel);
      return;
    }
    if (env().Yl.isAndroidApp) {
      let touchId = 0;
      let dragging = false;
      let downTime = 0;
      const startScrollTop = scrollEl.scrollTop;
      const startScrollLeft = containerEl.scrollLeft;
      const onTouchStart = (touchEvent) => {
        if (touchEvent.touches.length === 1) touchId = touchEvent.touches[0].identifier;
      };
      const onTouchMove = (touchEvent) => {
        const touch = env().Wc(touchEvent, touchId);
        if (!touch) return;
        if (dragging || (startScrollTop === scrollEl.scrollTop && startScrollLeft === containerEl.scrollLeft)) {
          point = env().Fl(touch);
          const cell = table.getClosestCell(point.x, point.y);
          if (cell !== anchorCell && !dragging && downTime > 0 && Date.now() - downTime > 50) {
            dragging = true;
            if (!frame) frame = win.requestAnimationFrame(step);
          }
          if (dragging) table.selectCells(anchorCell, cell);
        } else {
          stop();
        }
      };
      const onTouchEnd = (touchEvent) => {
        if (env().Wc(touchEvent, touchId)) {
          stop();
          if (table.selectedCells.length) table.editor.destroyTableCell();
        }
      };
      const onTouchCancel = (touchEvent) => {
        if (env().Wc(touchEvent, touchId)) stop();
      };
      const onPointerCancel = (cancelEvent) => {
        if (cancelEvent.pointerId === pointerId) downTime = Date.now();
      };
      const stop = () => {
        win.cancelAnimationFrame(frame);
        win.removeEventListener("touchstart", onTouchStart);
        win.removeEventListener("touchmove", onTouchMove);
        win.removeEventListener("touchend", onTouchEnd);
        win.removeEventListener("touchcancel", onTouchCancel);
        win.removeEventListener("pointerup", stop);
        win.removeEventListener("pointercancel", onPointerCancel);
      };
      win.addEventListener("touchstart", onTouchStart);
      win.addEventListener("touchmove", onTouchMove);
      win.addEventListener("touchend", onTouchEnd);
      win.addEventListener("touchcancel", onTouchCancel);
      win.addEventListener("pointerup", stop);
      win.addEventListener("pointercancel", onPointerCancel);
    }
  };

  /** Recomputes this cell's padding for a new column width. */
  TableCell.prototype.updateWidth = function (width) {
    const extra = width - this.text.length;
    const alignment = this.table.alignments[this.col];
    let padStart = 1;
    let padEnd = 1;
    if (alignment === "right") padStart = extra - 1;
    else if (alignment === "center") {
      padStart = Math.floor(extra / 2);
      padEnd = Math.ceil(extra / 2);
    } else padEnd = extra - 1;
    this.padStart = padStart;
    this.padEnd = padEnd;
  };

  TableCell.prototype.getTextWithPadding = function () {
    return " ".repeat(this.padStart) + this.text + " ".repeat(this.padEnd);
  };

  TableCell.prototype.getLength = function () {
    return this.padStart + this.padEnd + this.text.length;
  };

  /** Absolute doc offsets: start/end of the cell content including its pipes' inner span. */
  TableCell.prototype.getAbsoluteOffsets = function () {
    const tableStart = this.table.start;
    const start = this.start;
    const end = this.end;
    return {
      start: tableStart + start,
      end: tableStart + end,
      textStart: tableStart + start + this.padStart,
      textEnd: tableStart + end - this.padEnd,
    };
  };

  /** Freezes the cell's pixel size for one frame (used while a drag is in flight). */
  TableCell.prototype.lockDimensions = function () {
    const el = this.el;
    const rect = el.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    el.setCssStyles({ width: width + "px", height: height + "px" });
    el.win.setTimeout(() => el.removeAttribute("style"));
  };

  /** Scrolls the cell into view inside both the widget and the editor scrollers. */
  TableCell.prototype.scrollIntoView = function () {
    const table = this.table;
    const el = this.el;
    const editor = table.editor;
    const containerEl = table.containerEl;
    if (!containerEl.isShown()) return;
    const scrollEl = editor.cm.scrollDOM;
    let rect = null;
    const cellEditor = editor.tableCell;
    let cellRect = null;
    if ((cellEditor === null || cellEditor === void 0 ? void 0 : cellEditor.cell) === this) {
      cellRect = cellEditor.cm.coordsAtPos(cellEditor.state.selection.main.head);
    }
    if (containerEl.scrollWidth > containerEl.clientWidth) {
      const box = containerEl.getBoundingClientRect();
      rect = el.getBoundingClientRect();
      let pos = rect;
      if (cellRect && rect.width > box.width) pos = cellRect;
      if (pos.left < box.left) containerEl.scrollBy(pos.left - box.left, 0);
      else if (pos.right > box.right) containerEl.scrollBy(pos.right - box.right, 0);
    }
    if (scrollEl.scrollHeight > scrollEl.clientHeight) {
      if (!rect) rect = el.getBoundingClientRect();
      const box = scrollEl.getBoundingClientRect();
      const pos = cellRect && rect.height > box.height ? cellRect : rect;
      if (pos.top < box.top) scrollEl.scrollBy(0, pos.top - box.top);
      else if (pos.bottom > box.bottom) scrollEl.scrollBy(0, pos.bottom - box.bottom);
    }
  };

  return TableCell;
}

// ---------------------------------------------------------------------------
// Table widget
// ---------------------------------------------------------------------------

/** The CM6 embed widget that renders and edits one markdown table. */
export function defineTableWidget(host) {
  const TableCell = defineTableCell();

  function TableWidget(app, editor, doc, isDocComplete) {
    const self = env().NV.call(this, app, editor) || this;
    self.rows = [];
    self.alignments = [];
    self.colWidths = [];
    self.isMalformed = false;
    self.tableEl = null;
    self.selectedCells = [];
    self.selectionAnchor = null;
    self.selectionHead = null;
    self.updateCellReadonly = env().debounce(() => {
      const anchor = self.selectionAnchor;
      const head = self.selectionHead;
      const cellEditor = self.editor.tableCell;
      if (cellEditor) {
        cellEditor.setReadonly(!(!anchor || !head));
      }
    }, 50, true);
    self.cellChildMap = new Map();
    self.doc = doc;
    self.containerEl = env().createDiv({
      cls: "cm-embed-block cm-table-widget markdown-rendered",
      onpointerdown: (event) => {
        if (event.target === event.currentTarget) event.preventDefault();
      },
    });
    self.isDocComplete = isDocComplete;
    return self;
  }
  inherit(TableWidget, env().NV);

  Object.defineProperty(TableWidget.prototype, "text", {
    get: function () { return this.doc.toString(); },
    enumerable: false,
    configurable: true,
  });

  TableWidget.prototype.clear = function () {
    this.rows.length = 0;
    this.alignments.length = 0;
    this.containerEl.empty();
    this.cleanupChildren();
  };

  /** The single cell fully containing the (possibly multi-range) selection, or null. */
  TableWidget.prototype.getSelectedCell = function (selection) {
    if (!selection) return null;
    const rows = this.rows;
    let found = null;
    for (const range of selection.ranges) {
      const from = range.from;
      const to = range.to;
      if (found) {
        const fs = found.start;
        const fe = found.end;
        if (from >= fs && from <= fe && to >= fs && to <= fe) continue;
        return null;
      }
      for (const row of rows) {
        for (const cell of row) {
          const cs = cell.start;
          const ce = cell.end;
          if (from >= cs && from <= ce && to >= cs && to <= ce) {
            found = cell;
            break;
          }
        }
        if (found) break;
      }
    }
    return found;
  };

  TableWidget.prototype.containsSelection = function (selection) {
    const self = this;
    return !!selection && selection.ranges.every((range) => self.containsRange(range.from, range.to));
  };

  TableWidget.prototype.containedBySelection = function (selection) {
    if (!selection) return false;
    const start = this.start;
    const end = this.end;
    return selection.ranges.some((range) => range.from <= start && range.to >= end);
  };

  TableWidget.prototype.containsRange = function (from, to) {
    const start = this.start;
    const end = this.end;
    return from >= start && from <= end && to >= start && to <= end;
  };

  /** Serialises the selected (or whole) table region back to markdown. */
  TableWidget.prototype.getTableString = function (bounds) {
    const { minRow, maxRow, minCol, maxCol } = this.validateSelectionBounds(bounds);
    const rows = this.rows;
    const alignments = this.alignments;
    const colWidths = this.colWidths;
    let out = "";
    for (let row = minRow; row <= maxRow; row++) {
      const cells = rows[row];
      for (let col = minCol; col <= maxCol; col++) {
        const text = cells[col].text;
        const extra = colWidths[col] - text.length;
        const alignment = alignments[col];
        let padStart = 1;
        let padEnd = 1;
        if (alignment === "right") padStart = extra - 1;
        else if (alignment === "center") {
          padStart = Math.floor(extra / 2);
          padEnd = Math.ceil(extra / 2);
        } else padEnd = extra - 1;
        out += "|" + " ".repeat(padStart) + text + " ".repeat(padEnd);
      }
      out += "|";
      if (row === minRow) out += "\n" + this.makeAlignmentRow(minCol, maxCol);
      if (row !== maxRow) out += "\n";
    }
    return out;
  };

  TableWidget.prototype.makeAlignmentRow = function (minCol, maxCol) {
    const alignments = this.alignments;
    const colWidths = this.colWidths;
    let out = "";
    for (let col = minCol; col <= maxCol; col++) {
      const width = colWidths[col];
      switch (alignments[col]) {
        case "left": out += "| :" + "-".repeat(width - 3) + " "; break;
        case "center": out += "| :" + "-".repeat(width - 4) + ": "; break;
        case "right": out += "| " + "-".repeat(width - 3) + ": "; break;
        default: out += "| " + "-".repeat(width - 2) + " ";
      }
    }
    return out + "|";
  };

  /** Re-renders the widget and returns the new table source as a Text. */
  TableWidget.prototype.rebuildTable = function () {
    const editor = this.editor;
    const rowCount = this.rows.length;
    const text = this.getTableString({ minRow: 0, maxRow: rowCount - 1, minCol: 0, maxCol: this.alignments.length - 1 });
    const cm = editor.cm;
    const doc = (this.doc = cm.state.toText(text));
    if (text) this.render();
    return doc;
  };

  /** Rebuilds the table and dispatches the replacement over [start,end). */
  TableWidget.prototype.dispatchTable = function (focusRow, focusCol, selectFn) {
    const start = this.start;
    const end = this.end;
    const cm = this.editor.cm;
    let selection = cm.state.selection;
    const text = this.rebuildTable();
    if (text.length && focusRow !== undefined && focusCol !== undefined) {
      const rows = this.rows;
      const cols = this.alignments;
      const row = Math.clamp(focusRow, 0, rows.length - 1);
      const col = Math.clamp(focusCol, 0, cols.length - 1);
      const cell = this.getCellAt(row, col);
      if (cell) {
        const offsets = cell.getAbsoluteOffsets();
        let posFrom = offsets.textStart;
        let posTo = offsets.textStart;
        const wrapped = selectFn
          ? (cellCm) => {
              const sel = selectFn(cellCm);
              const parse = env().qA(cellCm.state.doc.toString());
              const main = sel.map(parse.changes).main;
              posFrom += main.from;
              posTo += main.to;
              return sel;
            }
          : undefined;
        this.receiveCellFocus(cell.row, cell.col, wrapped);
        selection = env().pe.single(posFrom, posTo);
      }
    }
    cm.dispatch({
      selection,
      changes: [{ from: start, to: end, insert: text }],
      scrollIntoView: false,
    });
  };

  /** Trims a cell's text; flags the table malformed when padding changes. */
  TableWidget.prototype.trimCell = function (cell) {
    const text = cell.text;
    const trimmed = text.trim();
    if (text !== trimmed) {
      this.isMalformed = true;
      this.updateCell(cell, trimmed);
    }
  };

  /**
   * Handles an edit transaction coming from a cell editor: maps the cell's doc
   * changes back into table-source changes and dispatches them on the main editor.
   * `cellEditor` is the table-cell editor controller, `transaction` the CM transaction.
   */
  TableWidget.prototype.dispatchUpdate = function (cellEditor, transaction) {
    const doc = this.doc;
    const editor = this.editor;
    const start = this.start;
    const cell = cellEditor.cell;
    const annotations = [env().yq.of(true)];
    const userEvent = transaction.annotation(env()._e.userEvent);
    if (userEvent && !/^select/.test(userEvent)) annotations.push(env()._e.userEvent.of(userEvent));
    const parse = env().qA(transaction.newDoc.toString());
    let changes = null;
    if (transaction.docChanged || parse.result !== cell.text) {
      const mapped = this.updateCell(cell, parse.result);
      if (mapped.length) {
        changes = mapped.map((change) => ({
          from: change.from + start,
          to: change.to + start,
          insert: change.insert,
        }));
        this.doc = env().re.of(changes, doc.length).apply(doc);
      }
    }
    const offsets = cell.getAbsoluteOffsets();
    const textStart = offsets.textStart;
    const textLen = offsets.textEnd - textStart;
    const selection = env().zA(transaction.newSelection.map(parse.changes), 0, textLen);
    editor.cm.dispatch({
      annotations,
      changes,
      selection: env().HA(selection, textStart),
      scrollIntoView: false,
    });
  };

  /**
   * Tries to express a main-editor transaction as cell-level changes; returns the
   * reconciled doc or null when the change cannot be mapped cleanly.
   */
  TableWidget.prototype.reconcileChanges = function (newDoc, transaction) {
    const self = this;
    const start = this.start;
    const end = this.end;
    const tableEl = this.tableEl;
    const doc = this.doc;
    if (!tableEl) return null;
    let ok = true;
    const cellUpdates = new Map();
    const changes = [];
    const separator = doc.line(2);
    let separatorText = null;
    transaction.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      if (ok) {
        if ((fromA < start && toA > start) || (fromA < end && toA > end)) {
          ok = false;
        } else if (self.containsRange(fromA, toA)) {
          const relFrom = fromA - start;
          const relTo = toA - start;
          if (env().FA(separator, relFrom, relTo)) {
            if (relFrom !== separator.from || relTo !== separator.to) ok = false;
            else {
              changes.push({ from: relFrom, to: relTo, insert: inserted });
              separatorText = inserted;
            }
          } else if (fromA === start && toA === end && newDoc.eq(inserted)) {
            ok = false;
          } else {
            const cell = self.getSelectedCell(env().pe.single(relFrom, relTo));
            if (cell) {
              let list = cellUpdates.get(cell);
              if (!list) {
                list = [];
                cellUpdates.set(cell, list);
              }
              const cellStart = cell.getAbsoluteOffsets().start;
              list.push({ from: fromA - cellStart, to: toA - cellStart, insert: inserted });
              changes.push({ from: relFrom, to: relTo, insert: inserted });
            } else {
              ok = false;
            }
          }
        }
      }
    });
    if (!ok) return null;
    const applied = env().re.of(changes, doc.length).apply(doc);
    const sepDelta = separatorText ? separatorText.length - separator.length : 0;
    if (cellUpdates.size) this.applyCellUpdates(transaction, cellUpdates, sepDelta);
    else {
      const last = this.rows.first() && this.rows.first().last();
      if (last && sepDelta !== 0) this.offsetCellsAfter(last, sepDelta);
    }
    return applied;
  };

  /** Applies a doc update coming from the main editor to the widget state. */
  TableWidget.prototype.receiveUpdate = function (transaction, newDoc) {
    const doc = this.doc;
    if (!this.isDocComplete) {
      this.isDocComplete = true;
      return !!s22RangesEqual(doc, newDoc) && (this.doc = newDoc, this.render(), true);
    }
    const unchanged = newDoc.eq(doc);
    if (!transaction.docChanged || transaction.annotation(env().yq)) return unchanged;
    let touched = false;
    const cellEditor = this.editor.tableCell;
    if (cellEditor && (transaction.isUserEvent("undo") || transaction.isUserEvent("redo"))) {
      const offsets = cellEditor.cell.getAbsoluteOffsets();
      const cs = offsets.start;
      const ce = offsets.end;
      if (transaction.changes.touchesRange(cs, ce)) touched = true;
    }
    if (!touched && unchanged) return true;
    const reconciled = this.reconcileChanges(newDoc, transaction);
    if (reconciled && reconciled.eq(newDoc)) {
      this.doc = reconciled;
      return true;
    }
    this.doc = newDoc;
    this.render();
    return true;
  };

  /** Update path while the table doc is still being completed incrementally. */
  TableWidget.prototype.receiveIncompleteUpdate = function (transaction, newDoc) {
    if (!transaction.docChanged || transaction.annotation(env().yq)) return s22RangesEqual(this.doc, newDoc);
    let doc = this.doc;
    const reconciled = this.reconcileChanges(newDoc, transaction);
    if (reconciled) this.doc = doc = reconciled;
    return s22RangesEqual(doc, newDoc);
  };

  /** Re-syncs cell text/padding from per-cell change lists after a reconcile. */
  TableWidget.prototype.applyCellUpdates = function (transaction, cellUpdates, sepDelta) {
    const start = this.start;
    const editor = this.editor;
    const colWidths = this.colWidths;
    const rows = this.rows;
    const cm = editor.cm;
    const hadFocus = cm.hasFocus;
    const dirty = [];
    const entries = Array.from(cellUpdates.entries());
    const widenedCols = new Set();
    entries.sort((a, b) => b[0].start - a[0].start);
    for (const [cell, changes] of entries) {
      const offsets = cell.getAbsoluteOffsets();
      const cellStart = offsets.start;
      const cellEnd = offsets.end;
      const slice = cm.state.doc.slice(cellStart, cellEnd);
      const match = env().re.of(changes, slice.length).apply(slice).toString().match(/^(\s*)(.*?)(\s*)$/);
      if (match) {
        const oldStart = cell.start;
        const oldEnd = cell.end;
        cell.padStart = match[1].length;
        cell.text = match[2];
        cell.padEnd = match[3].length;
        cell.dirty = true;
        const newEnd = oldStart + cell.getLength();
        cell.end = newEnd;
        if (oldEnd !== newEnd) {
          this.isMalformed = true;
          widenedCols.add(cell.col);
        }
        this.offsetCellsAfter(cell, newEnd - oldEnd);
        dirty.push(cell);
      }
    }
    const lastCell = this.rows.first() && this.rows.first().last();
    if (lastCell && sepDelta !== 0) this.offsetCellsAfter(lastCell, sepDelta);
    if (this.isMalformed) {
      for (const col of Array.from(widenedCols)) {
        let width = 5;
        for (const row of rows) {
          const len = row[col].text.length;
          width = Math.max(width, len + 2);
        }
        colWidths[col] = width;
      }
    }
    let selectedCell = null;
    let mappedSelection = null;
    if (transaction.selection) {
      const rel = env().HA(transaction.selection, -start);
      selectedCell = this.getSelectedCell(rel);
      if (selectedCell) {
        const offsets = selectedCell.getAbsoluteOffsets();
        const v = offsets.textStart;
        const h = offsets.textEnd;
        const clamped = env().zA(transaction.selection, v, h);
        mappedSelection = env().HA(clamped, -v);
      }
    }
    const cellEditor = editor.tableCell;
    if (cellEditor && cellEditor.table === this) {
      const cell = cellEditor.cell;
      const cellCm = cellEditor.cm;
      if (cell.dirty || selectedCell === cell) {
        const parsed = env().jA(cell.text);
        const changes = env().re.of(parsed.changes, cell.text.length);
        let updateChanges;
        let updateSelection;
        if (cell.dirty) {
          updateChanges = [{ from: 0, to: cellCm.state.doc.length, insert: parsed.result }];
        }
        if (selectedCell === cell) updateSelection = mappedSelection && mappedSelection.map(changes);
        if (updateChanges || updateSelection) {
          cellCm.dispatch({ changes: updateChanges, selection: updateSelection, annotations: [env().yq.of(true)] });
        }
      }
      dirty.remove(cell);
    }
    for (const cell of dirty) this.rerenderCell(cell);
    if (hadFocus && selectedCell && (!cellEditor || cellEditor.cell !== selectedCell)) {
      const parsed = env().jA(selectedCell.text);
      const changes = env().re.of(parsed.changes, selectedCell.text.length);
      this.receiveCellFocus(selectedCell.row, selectedCell.col, () =>
        mappedSelection === null || mappedSelection === void 0 ? void 0 : mappedSelection.map(changes)
      );
    }
  };

  /** Routes a main-editor selection change into cell focus when appropriate. */
  TableWidget.prototype.receiveSelection = function (transaction) {
    const rows = this.rows;
    const start = this.start;
    const end = this.end;
    const editor = this.editor;
    const tableEl = this.tableEl;
    const undoRedo = transaction.isUserEvent("undo") || transaction.isUserEvent("redo");
    const cellEditor = editor.tableCell;
    const cellFocused = (cellEditor === null || cellEditor === void 0 ? void 0 : cellEditor.cm.hasFocus) || false;
    if (
      tableEl &&
      start !== end &&
      (undoRedo || editor.cm.hasFocus || cellFocused) &&
      !transaction.annotation(env().yq) &&
      !transaction.annotation(env().AA) &&
      this.containsSelection(transaction.newSelection)
    ) {
      const selection = transaction.newSelection;
      const cell = this.getSelectedCell(env().HA(selection, -start));
      if (cell) {
        const cellEditor = editor.tableCell;
        const alreadyThere = (cellEditor === null || cellEditor === void 0 ? void 0 : cellEditor.cell) === cell;
        if (alreadyThere && !transaction.selection) return;
        const offsets = cell.getAbsoluteOffsets();
        const v = offsets.textStart;
        const g = offsets.textEnd;
        const parsed = env().jA(cell.text);
        const mapped = env().HA(env().zA(selection, v, g), -v).map(parsed.changes);
        if (alreadyThere) {
          const cellCm = cellEditor.editor.cm;
          if (editor.cm.hasFocus) cellCm.focus();
          cellCm.dispatch({ annotations: [env().yq.of(true)], selection: mapped });
          if (!this.selectionHead) cell.scrollIntoView();
        } else {
          this.receiveCellFocus(cell.row, cell.col, () => mapped);
        }
      } else {
        const ranges = selection.ranges;
        if (ranges.length === 1) {
          const range = ranges[0];
          if (range.from === range.to) {
            const prev = transaction.startState.selection && transaction.startState.selection.ranges;
            const prevRange = prev && prev.length ? prev[0] : null;
            if (prevRange) {
              const win = this.containerEl.win;
              if (prevRange.head <= start) {
                const first = rows.first().first();
                if (first) win.setTimeout(() => this.placeCursorInCell(first, "start"));
              } else {
                const last = rows.last().first();
                if (last) win.setTimeout(() => this.placeCursorInCell(last, "last-line"));
              }
            }
          }
        }
      }
    }
  };

  /** Shifts every cell offset after `cell` (same row tail + all later rows). */
  TableWidget.prototype.offsetCellsAfter = function (cell, delta) {
    const rows = this.rows;
    const row = rows[cell.row];
    for (let col = cell.col + 1, len = row.length; col < len; col++) {
      row[col].start += delta;
      row[col].end += delta;
    }
    for (let r = cell.row + 1, rowCount = rows.length; r < rowCount; r++) {
      const rrow = rows[r];
      for (let c = 0, clen = rrow.length; c < clen; c++) {
        const ccell = rrow[c];
        ccell.start += delta;
        ccell.end += delta;
      }
    }
  };

  /**
   * Rewrites column `cell.col` to width `width` and returns the source changes
   * needed to re-pad every affected cell (plus the separator row when width changed).
   */
  TableWidget.prototype.updateCell = function (cell, text) {
    const rows = this.rows;
    const colWidths = this.colWidths;
    const alignments = this.alignments;
    const col = cell.col;
    let width = 5;
    cell.text = text;
    cell.dirty = true;
    for (const row of rows) {
      const len = row[col].text.length;
      width = Math.max(width, len + 2);
    }
    const changes = [];
    const widthChanged = colWidths[col] !== width;
    let drift = 0;
    colWidths[col] = width;
    for (let r = 0, rowCount = rows.length; r < rowCount; r++) {
      const row = rows[r];
      for (let c = 0, colCount = row.length; c < colCount; c++) {
        const ccell = row[c];
        const oldPadStart = ccell.padStart;
        const oldPadEnd = ccell.padEnd;
        const oldStart = ccell.start;
        const oldEnd = ccell.end;
        if (ccell.col === col) {
          ccell.updateWidth(width);
          const newPadStart = ccell.padStart;
          const newPadEnd = ccell.padEnd;
          if (ccell !== cell) {
            ccell.start += drift;
            if (newPadStart !== oldPadStart) {
              drift += newPadStart - oldPadStart;
              changes.push({ from: oldStart, to: oldStart + oldPadStart, insert: " ".repeat(newPadStart) });
            }
            if (newPadEnd !== oldPadEnd) {
              drift += newPadEnd - oldPadEnd;
              changes.push({ from: oldEnd - oldPadEnd, to: oldEnd, insert: " ".repeat(newPadEnd) });
            }
            ccell.end += drift;
          } else {
            const padded = ccell.getTextWithPadding();
            ccell.start = oldStart + drift;
            ccell.end = oldStart + drift + padded.length;
            drift = ccell.end - oldEnd;
            changes.push({ from: oldStart, to: oldEnd, insert: padded });
          }
        } else if (drift) {
          ccell.start += drift;
          ccell.end += drift;
        }
      }
      if (r === 0 && widthChanged) {
        const sep = this.doc.line(2);
        const alignmentRow = this.makeAlignmentRow(0, alignments.length - 1);
        drift += alignmentRow.length - sep.length;
        changes.push({ from: sep.from, to: sep.to, insert: alignmentRow });
      }
    }
    return changes;
  };

  /** Focus path used while the table is malformed (full rebuild instead of cell edit). */
  TableWidget.prototype.setCellFocus = function (row, col, selectFn) {
    if (this.isMalformed) this.dispatchTable(row, col, selectFn);
    else this.receiveCellFocus(row, col, selectFn, true);
  };

  /** Opens the cell editor for cell (row,col); returns the editor controller. */
  TableWidget.prototype.receiveCellFocus = function (row, col, selectFn, skipAnnotation) {
    if (skipAnnotation === undefined) skipAnnotation = false;
    const rows = this.rows;
    const alignments = this.alignments;
    const editor = this.editor;
    const containerEl = this.containerEl;
    const r = Math.clamp(row, 0, rows.length - 1);
    const c = Math.clamp(col, 0, alignments.length - 1);
    const cell = rows[r][c];
    const cellEditor = editor.editTableCell(this, cell);
    const cm = cellEditor.editor.cm;
    if (!containerEl.isShown()) {
      containerEl.onNodeInserted(() => cm.focus(), true);
    }
    if (selectFn) {
      cm.dispatch({
        annotations: skipAnnotation ? [] : [env().yq.of(true)],
        selection: selectFn(cm),
      });
    }
    if (!this.selectionHead) cell.scrollIntoView();
    this.updateCellReadonly();
    return cellEditor;
  };

  /** Applies an alignment to the given columns (start/end/center, rtl-aware). */
  TableWidget.prototype.setAlignment = function (cols, alignment) {
    const alignments = this.alignments;
    for (const col of cols) {
      if (col < 0 || col >= alignments.length) continue;
      const rtl = getComputedStyle(this.tableEl).direction === "rtl";
      let value = null;
      if (alignment === "start") value = rtl ? "right" : "left";
      else if (alignment === "end") value = rtl ? "left" : "right";
      else if (alignment === "center") value = "center";
      alignments[col] = value;
      for (const row of this.rows) {
        row[col].el.setAttr("align", value);
      }
    }
    this.dispatchTable();
  };

  /** Inserts an empty row at `row`, duplicating cells from `fromRow` when copyFrom. */
  TableWidget.prototype.insertRow = function (row, col, copyFrom) {
    const rows = this.rows;
    row = Math.clamp(row, 0, rows.length);
    const source = copyFrom ? rows[row] : null;
    const cells = [];
    for (let c = 0, len = this.alignments.length; c < len; c++) {
      const src = source ? source[c] : null;
      cells.push(new TableCell(this, row, c, src && src.text, src && src.padStart, src && src.padEnd));
    }
    rows.splice(row, 0, cells);
    this.dispatchTable(copyFrom ? row + 1 : row, col);
  };

  /** Moves row `from` to index `to`. */
  TableWidget.prototype.moveRow = function (from, to, col) {
    const rows = this.rows;
    if (to >= rows.length || to < 0) return;
    env().lc(rows, from, to);
    this.dispatchTable(to, col);
  };

  TableWidget.prototype.removeRow = function (row, col) {
    const rows = this.rows;
    if (row < 0 || row >= rows.length) return;
    rows.splice(row, 1);
    this.cleanupChildren();
    this.dispatchTable(row - 1, col);
  };

  /** Inserts a column at `col` with the given alignment and width (or duplicated). */
  TableWidget.prototype.insertColumn = function (row, col, alignment, copyFrom) {
    const rows = this.rows;
    const colWidths = this.colWidths;
    const alignments = this.alignments;
    if (col < 0 || col > alignments.length) return;
    alignments.splice(col, 0, alignment);
    colWidths.splice(col, 0, copyFrom ? colWidths[col] : 5);
    for (let r = 0, rowCount = rows.length; r < rowCount; r++) {
      const rrow = rows[r];
      const src = copyFrom ? rrow[col] : null;
      rrow.splice(col, 0, new TableCell(this, r, col, src && src.text, src && src.padStart, src && src.padEnd));
    }
    this.dispatchTable(row, copyFrom ? col + 1 : col);
  };

  /** Moves column `from` to index `to`; `row` is the focus hint for dispatchTable. */
  TableWidget.prototype.moveColumn = function (from, to, row) {
    const rows = this.rows;
    const alignments = this.alignments;
    const colWidths = this.colWidths;
    if (to >= alignments.length || to < 0) return;
    env().lc(alignments, from, to);
    env().lc(colWidths, from, to);
    for (const rrow of rows) env().lc(rrow, from, to);
    this.dispatchTable(row, to);
  };

  TableWidget.prototype.removeColumn = function (row, col) {
    const alignments = this.alignments;
    const colWidths = this.colWidths;
    if (col < 0 || col >= alignments.length) return;
    alignments.splice(col, 1);
    colWidths.splice(col, 1);
    if (alignments.length === 0) {
      const start = this.start;
      const end = this.end;
      const cm = this.editor.cm;
      cm.dispatch({
        changes: [{ from: start, to: end, insert: "" }],
        selection: { anchor: start, head: start },
      });
      cm.focus();
      return;
    }
    for (const rrow of this.rows) rrow.splice(col, 1);
    this.cleanupChildren();
    this.dispatchTable(row, col - 1);
  };

  /** Sorts body rows by the text of column `col` using comparator `cmp`. */
  TableWidget.prototype.sortByColumn = function (row, col, cmp) {
    const rows = this.rows;
    const head = rows[0];
    const body = rows.slice(1).sort((a, b) => cmp(a[col], b[col]));
    this.rows = env().k([head], body, true);
    this.dispatchTable(row, col);
  };

  /** Inserts a newline before/after the whole table block and focuses it. */
  TableWidget.prototype.addNewLine = function (where) {
    const cm = this.editor.cm;
    if (where === "before") {
      cm.dispatch({
        changes: [{ from: this.start, insert: "\n" }],
        selection: env().pe.cursor(this.start),
        annotations: [env().yq.of(true)],
        scrollIntoView: true,
      });
    } else {
      cm.dispatch({
        annotations: [env().yq.of(true)],
        changes: [{ from: this.end, insert: "\n" }],
        selection: env().pe.cursor(this.end + 1),
        scrollIntoView: true,
      });
    }
    cm.focus();
  };

  TableWidget.prototype.getCellAt = function (row, col) {
    const rrow = this.rows[row];
    if (!rrow) return null;
    return rrow[col] || null;
  };

  /** Next cell in reading order (or null past the last one). */
  TableWidget.prototype.getNextCell = function (cell, dir) {
    const row = cell.row;
    const col = cell.col;
    if (dir === "end") {
      const rrow = this.rows[row];
      if (col === rrow.length - 1) {
        return row === this.rows.length - 1 ? null : this.rows[row + 1].first();
      }
      return rrow[col + 1];
    }
    if (col === 0 && row === 0) return null;
    if (col === 0) return this.rows[row - 1].last();
    return this.rows[row][col - 1];
  };

  TableWidget.prototype.getCellAbove = function (cell) {
    return this.getCellAt(cell.row - 1, cell.col);
  };

  TableWidget.prototype.getCellBelow = function (cell) {
    return this.getCellAt(cell.row + 1, cell.col);
  };

  /** Places the cursor on the line before/after the table. */
  TableWidget.prototype.placeCursorAround = function (where) {
    const cm = this.editor.cm;
    const doc = cm.state.doc;
    const line = where === "before" ? doc.lineAt(this.start).number - 1 : doc.lineAt(this.end).number + 1;
    if (line < 1) this.addNewLine("before");
    else if (line > doc.lines) this.addNewLine("after");
    else {
      cm.dispatch({ selection: env().pe.cursor(doc.line(line).from) });
      cm.focus();
    }
  };

  /** Focuses a cell and puts the cursor at start/end/last-line of its text. */
  TableWidget.prototype.placeCursorInCell = function (cell, where) {
    this.setCellFocus(cell.row, cell.col, (cm) => {
      const doc = cm.state.doc;
      let pos = 0;
      if (where === "end") pos = doc.length;
      else if (where === "last-line") {
        const end = doc.length;
        pos = cm.moveToLineBoundary(env().pe.range(end, end), false, true).from;
      }
      return env().pe.single(pos, pos);
    });
  };

  /** Finds the cell whose bounding box is nearest to viewport point (x,y). */
  TableWidget.prototype.getClosestCell = function (x, y) {
    const rows = this.rows;
    let bestRow = rows[0];
    let bestDist = Infinity;
    for (const row of rows) {
      const rect = row.first().el.getBoundingClientRect();
      if (rect.top <= y && y <= rect.bottom) {
        bestDist = 0;
        bestRow = row;
        break;
      }
      const dist = Math.min(Math.abs(rect.bottom - y), Math.abs(rect.top - y));
      if (dist > bestDist) break;
      bestRow = row;
      bestDist = dist;
    }
    let bestCell = bestRow[0];
    let cellDist = Infinity;
    for (const cell of bestRow) {
      const rect = cell.el.getBoundingClientRect();
      if (rect.left <= x && x <= rect.right) {
        cellDist = 0;
        bestCell = cell;
        break;
      }
      const dist = Math.min(Math.abs(rect.left - x), Math.abs(rect.right - x));
      if (dist > cellDist) break;
      bestCell = cell;
      cellDist = dist;
    }
    return bestCell;
  };

  // ---- widget lifecycle ----

  TableWidget.prototype.toDOM = function () {
    const self = this;
    const containerEl = this.containerEl;
    const editor = this.editor;
    const complete = this.isDocComplete;
    if (!this.tableEl) {
      if (complete) this.render();
      else {
        containerEl.onNodeInserted(() => {
          if (!self.isDocComplete && !self.tableEl) {
            containerEl.addClass("is-loading");
            containerEl.style.height = 1.1 * editor.containerEl.clientHeight + "px";
          }
        }, true);
      }
    }
    return containerEl;
  };

  TableWidget.prototype.initDOM = function () {
    return this.containerEl;
  };

  /** Parses the table doc into rows/cells and builds the <table> DOM. */
  TableWidget.prototype.render = function () {
    const doc = this.doc;
    const containerEl = this.containerEl;
    const rows = this.rows;
    this.clear();
    const tree = env().Kx(doc.toString());
    let tableNode = null;
    env().jC(tree, "table", (node) => {
      tableNode = node;
      return env().jC.EXIT;
    });
    if (!tableNode) return;
    const alignments = (this.alignments = tableNode.align);
    if (!(alignments === null || alignments === void 0 ? void 0 : alignments.length)) return;
    const colWidths = (this.colWidths = alignments.map(() => 5));
    const fragment = env().xL(env().Zx(tree));
    const tableEl = fragment === null || fragment === void 0 ? void 0 : fragment.firstChild;
    if (!(tableEl instanceof HTMLTableElement)) return;
    tableEl.addClass("table-editor");
    tableEl.tabIndex = -1;
    const domRows = [];
    domRows.push.apply(domRows, Array.from(tableEl.tHead.rows));
    for (const body of Array.from(tableEl.tBodies)) {
      domRows.push.apply(domRows, Array.from(body.rows));
    }
    let colCount = alignments.length;
    let maxCols = colCount;
    let malformed = false;
    env().jC(tableNode, "tableRow", (rowNode) => {
      const cells = [];
      const rowIndex = rows.length;
      const domRow = domRows[rowIndex];
      let isSeparator = true;
      env().jC(rowNode, "tableCell", (cellNode) => {
        const pos = cellNode.position;
        const padding = cellNode.padding;
        const from = pos.start;
        const to = pos.end;
        const col = cells.length;
        let domCell = domRow.cells[col];
        const text = doc.sliceString(from.offset + padding.start, to.offset - padding.end);
        if (!domCell) {
          malformed = true;
          domCell = domRow.insertCell(col);
        }
        if (isSeparator && (!text || !/^\s*:?\s*-+\s*:?\s*$/.test(text))) isSeparator = false;
        const cell = new TableCell(this, rowIndex, col, text, padding.start, padding.end);
        cell.init(domCell, from.offset, to.offset);
        cells.push(cell);
        this.postProcess(cell);
        if (rowIndex === 0) this.createDragHandle(cell, "col");
        if (col === 0) this.createDragHandle(cell, "row");
        if (col >= colCount) {
          malformed = true;
          for (let c = colCount; c <= col; c++) {
            alignments[c] = null;
            colWidths[c] = 5;
          }
          colCount = alignments.length;
        }
        colWidths[col] = Math.max(colWidths[col], text.length + 2);
      });
      if (isSeparator) malformed = true;
      else rows.push(cells);
    });
    // pad short rows with empty cells
    for (let r = 0, rowCount = rows.length; r < rowCount; r++) {
      const cells = rows[r];
      const width = cells.length;
      if (width < colCount) {
        malformed = true;
        let domRow = tableEl.rows[r];
        if (!domRow) domRow = tableEl.insertRow(r);
        for (let c = width; c < colCount; c++) {
          let domCell = domRow.cells[c];
          if (!domCell) domCell = domRow.insertCell(c);
          const cell = new TableCell(this, r, c);
          cell.init(domCell, -1, -1);
          cells[c] = cell;
        }
      }
    }
    // malformed when the source has a trailing partial row or a mismatched separator
    const lastLine = doc.line(doc.lines).text;
    if (/^\|[^\|]*$/.test(lastLine) || (maxCols !== colCount && /^\|(?:\s*:?\s*-+\s*:?\s*\|)+$/.test(lastLine))) {
      malformed = true;
      const cells = [];
      const rowIndex = rows.length;
      const domRow = tableEl.insertRow(rowIndex);
      rows.push(cells);
      for (let c = 0; c < colCount; c++) {
        const domCell = domRow.insertCell();
        const cell = new TableCell(this, rowIndex, c);
        cell.init(domCell, -1, -1);
        cells[c] = cell;
      }
    }
    if (!malformed) {
      let col = 0;
      outer: for (; col < colWidths.length; col++) {
        const width = colWidths[col];
        for (const row of rows) {
          const cell = row[col];
          if (cell.end - cell.start !== width) {
            malformed = true;
            break outer;
          }
        }
      }
    }
    containerEl.createDiv("table-wrapper", (wrapper) => {
      wrapper.append(tableEl);
      wrapper.createDiv("table-row-btn", (btn) => {
        env().tv(btn, "lucide-plus");
        env().Mv(btn, env().gm.table.actionRowAfter());
        btn.addEventListener("pointerdown", (event) => event.preventDefault());
        btn.addEventListener("click", () => this.insertRow(this.rows.length, 0));
      });
      wrapper.createDiv("table-col-btn", (btn) => {
        env().tv(btn, "lucide-plus");
        env().Mv(btn, env().gm.table.actionColumnAfter());
        btn.addEventListener("pointerdown", (event) => event.preventDefault());
        btn.addEventListener("click", () => this.insertColumn(0, this.alignments.length, null));
      });
    });
    containerEl.removeClass("is-loading");
    containerEl.removeAttribute("style");
    containerEl.addEventListener("click", (event) => {
      if (event.target === containerEl) this.placeCursorAround("after");
    });
    this.isMalformed = malformed;
    this.tableEl = tableEl;
    let anchor = this.selectionAnchor;
    let head = this.selectionHead;
    if (anchor && head) {
      anchor = this.getCellAt(anchor.row, anchor.col);
      head = this.getCellAt(head.row, head.col);
      if (anchor && head) this.selectCells(anchor, head);
      else this.deselectCells();
    }
  };

  /** Adds the column/row resize+reorder drag handle to a cell. */
  TableWidget.prototype.createDragHandle = function (cell, kind) {
    const self = this;
    const row = cell.row;
    const col = cell.col;
    const el = cell.el;
    const editor = this.editor;
    const containerEl = this.containerEl;
    const isCol = kind === "col";
    const scroller = isCol ? containerEl : editor.cm.scrollDOM;
    el.createDiv("table-" + kind + "-drag-handle", (handle) => {
      env().tv(handle, "lucide-grip-" + (isCol ? "horizontal" : "vertical"));
      handle.dataset.ignoreSwipe = "true";
      handle.addEventListener("contextmenu", (event) => {
        const menu = env().Ug.forEvent(event);
        if (isCol) {
          self.makeSortMenu(menu, cell);
          self.makeColMenu(menu, cell);
        } else {
          self.makeRowMenu(menu, cell);
        }
        menu.showAtMouseEvent(event);
        menu.onHide(() => self.deselectCells());
      });
      handle.addEventListener("pointerdown", (event) => {
        if (!(event.isPrimary && event.button === 0)) return;
        const tableEl = self.tableEl;
        event.preventDefault();
        containerEl.addClass("is-dragging");
        if (isCol) {
          self.receiveCellFocus(0, col);
          self.selectCells(self.getCellAt(0, col), self.getCellAt(self.rows.length - 1, col), true);
        } else {
          self.receiveCellFocus(row, 0);
          self.selectCells(self.getCellAt(row, 0), self.getCellAt(row, self.alignments.length - 1), true);
        }
        const handleRect = handle.getBoundingClientRect();
        const tableRect = tableEl.getBoundingClientRect();
        const parent = tableEl.parentElement;
        let borderWidth = parseInt(getComputedStyle(handle).getPropertyValue("--table-border-width"));
        if (isNaN(borderWidth)) borderWidth = 0;
        let targetCell = null;
        let targetMarker = null;
        const domCells = isCol ? Array.from(tableEl.rows[0].cells) : Array.from(tableEl.rows);
        const boxes = domCells.map((domCell, index) => {
          const rect = domCell.getBoundingClientRect();
          return {
            index,
            left: rect.left - tableRect.left,
            top: rect.top - tableRect.top,
            right: rect.right - tableRect.left,
            bottom: rect.bottom - tableRect.top,
          };
        });
        const span = (box) => ({ min: box[isCol ? "left" : "top"], max: box[isCol ? "right" : "bottom"] });
        const axis = (point) => (isCol ? point.x : point.y);
        const scrollPos = () => (isCol ? scroller.scrollLeft : scroller.scrollTop);
        const tableSpan = span(tableRect);
        const handleSpan = span(handleRect);
        const startOffset = isCol ? handle.offsetLeft : handle.offsetTop;
        const startScroll = scrollPos();
        const startPoint = env().Fl(event);
        let point = startPoint;
        const centerOffset = (handleSpan.min + handleSpan.max) / 2 - tableSpan.min;
        const minOffset = tableSpan.min - handleSpan.min + borderWidth;
        const maxOffset = tableSpan.max - handleSpan.max - borderWidth;
        let frame = null;
        let lastTime = 0;
        const rtl = containerEl.dir === "rtl";
        const win = event.win;
        const tick = (time) => {
          frame = win.requestAnimationFrame(tick);
          let delta = time - lastTime;
          if (lastTime === 0) delta = 50;
          lastTime = time;
          env().wg(scroller, point, delta);
          const scrollDelta = startScroll - scrollPos();
          const move = axis(point) - axis(startPoint) - scrollDelta;
          const pos = Math.clamp(centerOffset + move, 0, tableSpan.max - tableSpan.min);
          const offset = Math.clamp(startOffset + move, minOffset, maxOffset);
          handle.style[isCol ? "left" : "top"] = offset + "px";
          for (const box of boxes) {
            const boxSpan = span(box);
            if (pos >= boxSpan.min && pos <= boxSpan.max) {
              targetCell = box;
              if (!targetMarker) targetMarker = containerEl.createDiv("table-drag-target mod-" + kind);
              const inner = rtl ? box.right : box.left;
              const outer = rtl ? box.left : box.right;
              const styles = isCol
                ? {
                    display: box.index === col ? "none" : "block",
                    left: (box.index < col ? inner : outer) + parent.offsetLeft + "px",
                    top: parent.offsetTop + "px",
                    height: tableRect.height + "px",
                  }
                : {
                    display: box.index === row ? "none" : "block",
                    left: parent.offsetLeft + "px",
                    top: (box.index < row ? box.top : box.bottom) + parent.offsetTop + "px",
                    width: tableRect.width + "px",
                  };
              targetMarker.setCssStyles(styles);
              return;
            }
          }
        };
        frame = win.requestAnimationFrame(tick);
        env().Cg(
          event,
          () => ({
            move: (moveEvent) => {
              point = env().Fl(moveEvent);
            },
            end: () => {
              if (targetCell) {
                if (isCol) {
                  if (col !== targetCell.index) self.moveColumn(col, targetCell.index, 0);
                  if (event.pointerType === "mouse") {
                    const top = self.rows.first()[targetCell.index];
                    const bottom = self.rows.last()[targetCell.index];
                    self.selectCells(top, bottom);
                  } else self.deselectCells();
                } else {
                  if (row !== targetCell.index) self.moveRow(row, targetCell.index, 0);
                  if (event.pointerType === "mouse") {
                    const first = self.rows[targetCell.index].first();
                    const last = self.rows[targetCell.index].last();
                    self.selectCells(first, last);
                  } else self.deselectCells();
                }
              }
            },
            cleanup: () => {
              win.cancelAnimationFrame(frame);
              handle.style.left = "";
              handle.style.top = "";
              if (targetMarker) targetMarker.detach();
              targetMarker = null;
              containerEl.removeClass("is-dragging");
            },
          }),
          0
        );
      });
    });
  };

  TableWidget.prototype.setActiveDragHandles = function (cell) {
    const rowCell = this.getCellAt(cell.row, 0);
    if (rowCell) rowCell.el.addClass("mod-active-row-handle");
    const colCell = this.getCellAt(0, cell.col);
    if (colCell) colCell.el.addClass("mod-active-col-handle");
  };

  TableWidget.prototype.unsetActiveDragHandles = function (cell) {
    const rowCell = this.getCellAt(cell.row, 0);
    if (rowCell) rowCell.el.removeClass("mod-active-row-handle");
    const colCell = this.getCellAt(0, cell.col);
    if (colCell) colCell.el.removeClass("mod-active-col-handle");
  };

  // ---- selection ----

  TableWidget.prototype.getSelectionBounds = function () {
    const anchor = this.selectionAnchor;
    const head = this.selectionHead;
    if (!anchor || !head) return null;
    return this.validateSelectionBounds({
      minRow: Math.min(anchor.row, head.row),
      maxRow: Math.max(anchor.row, head.row),
      minCol: Math.min(anchor.col, head.col),
      maxCol: Math.max(anchor.col, head.col),
    });
  };

  TableWidget.prototype.validateSelectionBounds = function (bounds) {
    const alignments = this.alignments;
    const rows = this.rows;
    let minCol = bounds.minCol;
    let maxCol = bounds.maxCol;
    let minRow = bounds.minRow;
    let maxRow = bounds.maxRow;
    if (minCol < 0) minCol = 0;
    if (maxCol >= alignments.length) maxCol = alignments.length - 1;
    if (minRow < 0) minRow = 0;
    if (maxRow >= rows.length) maxRow = rows.length - 1;
    return { minRow, maxRow, minCol, maxCol };
  };

  TableWidget.prototype.selectTable = function () {
    this.containerEl.addClass("is-selected");
  };

  TableWidget.prototype.deselectTable = function () {
    this.containerEl.removeClass("is-selected");
  };

  /** Selects the rectangle between two cells, tagging edge classes on each cell. */
  TableWidget.prototype.selectCells = function (anchor, head, dragging) {
    if (dragging === undefined) dragging = false;
    if (this.selectionAnchor === anchor && this.selectionHead === head && !dragging) return;
    this.deselectCells();
    if (anchor === head) return;
    this.selectionAnchor = anchor;
    this.selectionHead = head;
    const bounds = this.getSelectionBounds();
    if (!bounds) return;
    const rows = this.rows;
    const selected = [];
    for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
      const row = rows[r];
      for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
        const cell = row[c];
        const classes = ["is-selected"];
        if (dragging) classes.push("mod-dragging");
        if (c === bounds.minCol) classes.push("start");
        if (c === bounds.maxCol) classes.push("end");
        if (r === bounds.minRow) classes.push("top");
        if (r === bounds.maxRow) classes.push("bottom");
        cell.el.addClasses(classes);
        selected.push(cell);
      }
    }
    this.selectedCells = selected;
    this.containerEl.addClass("has-selection");
    this.updateCellReadonly();
  };

  TableWidget.prototype.deselectCells = function () {
    const selected = this.selectedCells;
    if (selected.length === 0) return;
    this.selectionAnchor = null;
    this.selectionHead = null;
    const classes = ["mod-dragging", "is-selected", "start", "end", "top", "bottom"];
    for (const cell of selected) cell.el.removeClasses(classes);
    this.selectedCells = [];
    this.containerEl.removeClass("has-selection");
    this.updateCellReadonly();
  };

  /** Deletes the selected rectangle (whole rows/columns when fully spanned). */
  TableWidget.prototype.deleteSelection = function (dir) {
    const bounds = this.getSelectionBounds();
    if (!bounds) return;
    const minRow = bounds.minRow;
    const maxRow = bounds.maxRow;
    const minCol = bounds.minCol;
    const maxCol = bounds.maxCol;
    const alignments = this.alignments;
    const colWidths = this.colWidths;
    const rows = this.rows;
    const head = this.selectionHead;
    this.deselectCells();
    if (minCol === 0 && maxCol === alignments.length - 1) {
      const start = this.start;
      const end = this.end;
      const cm = this.editor.cm;
      const rowCount = rows.length;
      if (minRow === 0 && maxRow === rowCount - 1) {
        cm.dispatch({
          changes: [{ from: start, to: end, insert: "" }],
          selection: { anchor: start },
        });
        cm.focus();
        return;
      }
      rows.splice(minRow, maxRow - minRow + 1);
      this.cleanupChildren();
      if (minRow > 0 && maxRow < rowCount - 1) {
        this.dispatchTable(dir === -1 ? minRow - 1 : minRow, head.col);
        return;
      }
      let text = this.rebuildTable();
      if (minRow === 0) {
        text = env().re.of([{ from: 0, insert: "\n" }], text.length).apply(text);
      } else if (maxRow === rowCount - 1) {
        text = env().re.of([{ from: text.length, insert: "\n" }], text.length).apply(text);
      }
      cm.dispatch({
        selection: { anchor: minRow === 0 ? start : start + text.length },
        changes: [{ from: start, to: end, insert: text }],
        scrollIntoView: false,
      });
      cm.focus();
      return;
    }
    if (minRow === 0 && maxRow === rows.length - 1) {
      const count = maxCol - minCol + 1;
      alignments.splice(minCol, count);
      colWidths.splice(minCol, count);
      for (let r = minRow; r <= maxRow; r++) rows[r].splice(minCol, count);
      this.cleanupChildren();
      this.dispatchTable(head.row, dir === -1 ? minCol - 1 : minCol);
      return;
    }
    for (let r = minRow; r <= maxRow; r++) {
      const row = rows[r];
      for (let c = minCol; c <= maxCol; c++) {
        this.updateCell(row[c], "");
      }
    }
    this.dispatchTable(dir === -1 ? minRow : maxRow, dir === -1 ? minCol : maxCol);
  };

  /** Copies the selection to the clipboard (text + html + internal table JSON). */
  TableWidget.prototype.copySelection = function (event, cut) {
    const bounds = this.getSelectionBounds();
    if (!bounds) return false;
    const text = this.getTableString(bounds);
    const rows = this.rows;
    const alignments = this.alignments;
    const rowData = [];
    for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
      const row = [];
      for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
        row.push(rows[r][c].text);
      }
      rowData.push(row);
    }
    const colAlignments = alignments.slice(bounds.minCol, bounds.maxCol + 1);
    event.clipboardData.setData("text/plain", text);
    event.clipboardData.setData("text/markdown", text);
    event.clipboardData.setData("text/html", env().DL + env().Zx(env().Kx(text)));
    event.clipboardData.setData(
      "basalt/table",
      JSON.stringify({ rows: rowData, alignment: colAlignments })
    );
    if (cut) this.deleteSelection(-1);
    return true;
  };

  /** Pastes internal table JSON over the current cell/selection. */
  TableWidget.prototype.pasteSelection = function (event) {
    const rows = this.rows;
    const alignments = this.alignments;
    const bounds = this.getSelectionBounds();
    const target = bounds
      ? this.getCellAt(bounds.minRow, bounds.minCol)
      : this.editor.tableCell && this.editor.tableCell.cell;
    if (!target) return false;
    const data = event.clipboardData.getData("basalt/table");
    if (!data) return false;
    let pastedRows;
    let pastedAlignments;
    try {
      const parsed = JSON.parse(data);
      pastedRows = parsed.rows;
      pastedAlignments = parsed.alignment;
    } catch (e) {
      return false;
    }
    const startCol = target.col;
    const startRow = target.row;
    const endCol = startCol + pastedAlignments.length - 1;
    const endRow = startRow + pastedRows.length - 1;
    if (target.row === 0) {
      for (let c = startCol; c <= endCol; c++) alignments[c] = pastedAlignments[c - startCol];
    } else {
      const oldLen = alignments.length;
      for (let c = oldLen; c <= endCol; c++) alignments[c] = pastedAlignments[c - oldLen];
    }
    const neededRows = Math.max(endRow + 1, rows.length);
    const colCount = alignments.length;
    for (let r = 0; r < neededRows; r++) {
      let row = rows[r];
      if (!row) row = rows[r] = [];
      if (r < startRow || r > endRow) {
        for (let c = 0; c < colCount; c++) {
          if (!row[c]) row[c] = new TableCell(this, r, c);
        }
      } else {
        for (let c = 0; c < colCount; c++) {
          if (c >= startCol && c <= endCol) {
            row[c] = new TableCell(this, r, c, pastedRows[r - startRow][c - startCol]);
          } else if (!row[c]) {
            row[c] = new TableCell(this, r, c);
          }
        }
      }
    }
    const colWidths = this.colWidths;
    for (let c = startCol; c <= endCol; c++) {
      let width = 5;
      for (const row of rows) {
        width = Math.max(width, row[c].text.length + 2);
      }
      if (width !== colWidths[c]) {
        colWidths[c] = width;
        for (const row of rows) row[c].updateWidth(width);
      }
    }
    this.dispatchTable(endRow, endCol);
    return true;
  };

  /** Re-renders a dirty cell's inline content through the markdown pipeline. */
  TableWidget.prototype.rerenderCell = function (cell) {
    if (!cell.dirty) return;
    this.removeChildren(cell);
    cell.contentEl.empty();
    if (cell.text) {
      const th = env().xL(env().Zx(env().Kx("| " + cell.text + " |\n| - |"))).find("th");
      const nodes = th && th.childNodes.length ? Array.from(th.childNodes) : [env().createEl("br")];
      cell.contentEl.append.apply(cell.contentEl, nodes);
      cell.dirty = false;
      cell.setTextDir();
      this.postProcess(cell);
    } else {
      cell.contentEl.createEl("br");
    }
  };

  TableWidget.prototype.removeChildren = function (cell) {
    const map = this.cellChildMap;
    if (map.has(cell)) {
      const children = map.get(cell);
      map.delete(cell);
      for (const child of children) this.removeChild(child);
    }
  };

  /** Drops render children of cells that no longer exist; fixes stray cell editors. */
  TableWidget.prototype.cleanupChildren = function () {
    const map = this.cellChildMap;
    const rows = this.rows;
    const editor = this.editor;
    const alive = new Set();
    for (const row of rows) {
      for (const cell of row) alive.add(cell);
    }
    for (const cell of Array.from(map.keys())) {
      if (!alive.has(cell)) {
        const children = map.get(cell);
        map.delete(cell);
        for (const child of children) this.removeChild(child);
      }
    }
    const cellEditor = editor.tableCell;
    if ((cellEditor === null || cellEditor === void 0 ? void 0 : cellEditor.table) !== this || !alive.has(cellEditor.cell)) {
      editor.destroyTableCell();
    }
  };

  /** Runs the markdown post-processor over one cell's content element. */
  TableWidget.prototype.postProcess = function (cell) {
    const self = this;
    const app = this.app;
    const map = this.cellChildMap;
    const containerEl = this.containerEl;
    const editor = this.editor;
    const contentEl = cell.contentEl;
    map.set(cell, []);
    env().fq.postProcess(app, {
      docId: env().cc(16),
      sourcePath: editor.path,
      frontmatter: undefined,
      promises: [],
      addChild: (child) => {
        if (map.has(cell)) {
          map.get(cell).push(child);
          self.addChild(child);
        }
      },
      getSectionInfo: () => null,
      replace: () => null,
      containerEl,
      el: contentEl,
      displayMode: false,
    });
    env().uq(app, contentEl, editor.path);
  };

  // ---- context menus ----

  TableWidget.prototype.onContextMenu = function (cell, menu) {
    const editor = this.editor.editor.cm;
    const selected = this.selectedCells;
    if (selected.length > 0) {
      if (env().Yl.isDesktopApp) {
        const electron = this.containerEl.win.electron;
        menu.addItem((item) =>
          item.setTitle(env().gm.interface.menu.cut()).setSection("clipboard").setIcon("lucide-scissors").onClick(() => {
            electron.remote.getCurrentWebContents().cut();
          })
        );
        menu.addItem((item) =>
          item.setTitle(env().gm.interface.menu.copy()).setSection("clipboard").setIcon("lucide-copy").onClick(() => {
            electron.remote.getCurrentWebContents().copy();
          })
        );
        menu.addItem((item) =>
          item.setTitle(env().gm.interface.menu.paste()).setSection("clipboard").setIcon("lucide-clipboard-check").onClick(() => {
            electron.remote.getCurrentWebContents().paste();
          })
        );
      }
      const offsets = selected.first().getAbsoluteOffsets();
      const s = offsets.textStart;
      const l = offsets.textEnd;
      const range = env().pe.range(s, l);
      const state = env().df(editor.state, range);
      s22FormattingMenu(menu, this.editor.editor, state, "selection");
      const bounds = this.getSelectionBounds();
      if (bounds) {
        const minRow = bounds.minRow;
        const maxRow = bounds.maxRow;
        const minCol = bounds.minCol;
        const maxCol = bounds.maxCol;
        const cols = [];
        for (let c = minCol; c <= maxCol; c++) cols.push(c);
        this.makeAlignmentMenu(menu, cols);
        menu.addItem((item) =>
          item
            .setSection("table")
            .setIcon("lucide-eraser")
            .setTitle(env().gm.table.actionClearSelection())
            .onClick(() => {
              for (let r = minRow; r <= maxRow; r++) {
                const row = this.rows[r];
                for (let c = minCol; c <= maxCol; c++) row[c].text = "";
              }
              this.dispatchTable(minRow, minCol);
            })
        );
      }
      menu.addItem((item) =>
        item
          .setSection("table")
          .setIcon("lucide-trash-2")
          .setTitle(env().gm.table.actionDeleteSelection())
          .onClick(() => this.deleteSelection(-1))
      );
    } else {
      menu.addItem((item) => {
        const sub = item.setSection("table").setIcon("lucide-table").setTitle(env().gm.table.labelRow()).setSubmenu();
        this.makeRowMenu(sub, cell);
      });
      menu.addItem((item) => {
        const sub = item.setSection("table").setIcon("lucide-table").setTitle(env().gm.table.labelColumn()).setSubmenu();
        this.makeColMenu(sub, cell);
      });
      this.makeSortMenu(menu, cell);
    }
  };

  TableWidget.prototype.makeColMenu = function (menu, cell) {
    const self = this;
    menu.addItem((item) =>
      item.setSection("table-add").setIcon("lucide-panel-left-close").setTitle(env().gm.table.actionColumnBefore()).onClick(() => {
        const alignment = self.alignments[cell.col];
        self.insertColumn(cell.row, cell.col, alignment);
      })
    );
    menu.addItem((item) =>
      item.setSection("table-add").setIcon("lucide-panel-right-close").setTitle(env().gm.table.actionColumnAfter()).onClick(() => {
        const alignment = self.alignments[cell.col];
        self.insertColumn(cell.row, cell.col + 1, alignment);
      })
    );
    if (cell.col > 0) {
      menu.addItem((item) =>
        item.setSection("table-move").setIcon("lucide-arrow-left").setTitle(env().gm.table.actionColumnLeft()).onClick(() => {
          self.moveColumn(cell.col, cell.col - 1, cell.row);
        })
      );
    }
    if (cell.col < self.alignments.length - 1) {
      menu.addItem((item) =>
        item.setSection("table-move").setIcon("lucide-arrow-right").setTitle(env().gm.table.actionColumnRight()).onClick(() => {
          self.moveColumn(cell.col, cell.col + 1, cell.row);
        })
      );
    }
    this.makeAlignmentMenu(menu, [cell.col]);
    menu.addItem((item) =>
      item.setSection("table-modify").setIcon("lucide-copy").setTitle(env().gm.table.actionDuplicateColumn()).onClick(() => {
        const alignment = self.alignments[cell.col];
        self.insertColumn(cell.row, cell.col, alignment, true);
      })
    );
    menu.addItem((item) =>
      item.setSection("table-modify").setIcon("lucide-trash-2").setTitle(env().gm.table.actionDeleteColumn()).onClick(() => {
        self.removeColumn(cell.row, cell.col);
      })
    );
  };

  TableWidget.prototype.makeAlignmentMenu = function (menu, cols) {
    const self = this;
    menu.addItem((item) =>
      item.setSection("table-align").setIcon("lucide-align-left").setTitle(env().gm.table.actionAlignLeft()).onClick(() => {
        self.setAlignment(cols, "start");
      })
    );
    menu.addItem((item) =>
      item.setSection("table-align").setIcon("lucide-align-center").setTitle(env().gm.table.actionAlignCenter()).onClick(() => {
        self.setAlignment(cols, "center");
      })
    );
    menu.addItem((item) =>
      item.setSection("table-align").setIcon("lucide-align-right").setTitle(env().gm.table.actionAlignRight()).onClick(() => {
        self.setAlignment(cols, "end");
      })
    );
  };

  TableWidget.prototype.makeRowMenu = function (menu, cell) {
    const self = this;
    menu.addItem((item) =>
      item.setSection("table-add").setIcon("lucide-panel-top-close").setTitle(env().gm.table.actionRowBefore()).onClick(() => {
        self.insertRow(cell.row, cell.col);
      })
    );
    menu.addItem((item) =>
      item.setSection("table-add").setIcon("lucide-panel-bottom-close").setTitle(env().gm.table.actionRowAfter()).onClick(() => {
        self.insertRow(cell.row + 1, cell.col);
      })
    );
    if (cell.row > 0) {
      menu.addItem((item) =>
        item.setSection("table-move").setIcon("lucide-arrow-up").setTitle(env().gm.table.actionRowUp()).onClick(() => {
          self.moveRow(cell.row, cell.row - 1, cell.col);
        })
      );
    }
    if (cell.row !== this.rows.length - 1) {
      menu.addItem((item) =>
        item.setSection("table-move").setIcon("lucide-arrow-down").setTitle(env().gm.table.actionRowDown()).onClick(() => {
          self.moveRow(cell.row, cell.row + 1, cell.col);
        })
      );
    }
    menu.addItem((item) =>
      item.setSection("table-modify").setIcon("lucide-copy").setTitle(env().gm.table.actionDuplicateRow()).onClick(() => {
        self.insertRow(cell.row, cell.col, true);
      })
    );
    menu.addItem((item) =>
      item.setSection("table-modify").setIcon("lucide-trash-2").setTitle(env().gm.table.actionDeleteRow()).onClick(() => {
        self.removeRow(cell.row, cell.col);
      })
    );
  };

  TableWidget.prototype.makeSortMenu = function (menu, cell) {
    const self = this;
    menu.addItem((item) =>
      item.setSection("table-sort").setIcon("lucide-arrow-down-az").setTitle(env().gm.table.actionSortAZ()).onClick(() => {
        const texts = self.rows.map((row) => row.map((c) => c.contentEl.innerText));
        self.sortByColumn(cell.row, cell.col, (a, b) => env().ub(texts[a.row][a.col], texts[b.row][b.col]));
      })
    );
    menu.addItem((item) =>
      item.setSection("table-sort").setIcon("lucide-arrow-up-za").setTitle(env().gm.table.actionSortZA()).onClick(() => {
        const texts = self.rows.map((row) => row.map((c) => c.contentEl.innerText));
        self.sortByColumn(cell.row, cell.col, (a, b) => env().ub(texts[b.row][b.col], texts[a.row][a.col]));
      })
    );
  };

  Object.defineProperty(TableWidget.prototype, "estimatedHeight", {
    get: function () {
      const height = this.containerEl.offsetHeight;
      return height > 0 ? height : 50;
    },
    enumerable: false,
    configurable: true,
  });

  /** Change filter that keeps cell-editor transactions inside the cell doc. */
  TableWidget.cellSanitizerPlugin = function (editor) {
    return env().nt.changeFilter.of((transaction) => {
      if (!editor.tableCell || !transaction.docChanged || transaction.annotation(env().yq)) return true;
      if (transaction.isUserEvent("set")) {
        editor.destroyTableCell();
        return true;
      }
      const cell = editor.tableCell.cell;
      const offsets = cell.getAbsoluteOffsets();
      const textStart = offsets.textStart;
      const textEnd = offsets.textEnd;
      let outside = false;
      const changes = [];
      transaction.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
        if (outside) return;
        if (fromA < textStart || toA > textEnd) {
          outside = true;
        } else {
          changes.push({ from: fromA - textStart, to: toA - textStart, insert: inserted });
        }
      });
      if (outside) return true;
      const text = cell.text;
      const changeSet = env().re.of(changes, text.length);
      const baseDoc = transaction.startState.toText(text);
      const parsed = env().jA(text);
      const newParsed = env().jA(changeSet.apply(baseDoc).toString());
      const mappedChanges = changeSet.map(parsed.changes);
      const selection = env().HA(transaction.newSelection, -textStart).map(newParsed.changes);
      const annotations = [];
      const userEvent = transaction.annotation(env()._e.userEvent);
      if (userEvent) annotations.push(env()._e.userEvent.of(userEvent));
      const cm = editor.tableCell.cm;
      cm.dom.win.setTimeout(() => {
        cm.dispatch({ annotations, selection, changes: mappedChanges });
      });
      return [textStart - 1, textEnd + 1];
    });
  };

  /** Click handler that inserts a newline when clicking beside a table widget. */
  TableWidget.detectSurroundingClick = function (field) {
    return env()._o.domEventHandlers({
      pointerdown: (event, view) => {
        if (event.button === 0 || event.isPrimary) {
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
          const tableStart = env().tP(view.state.doc) + 1;
          const docLength = view.state.doc.length;
          if (pos > tableStart && pos < docLength) return;
          view.state.field(field).between(pos, pos, (from, to, spec) => {
            if (spec.widget instanceof TableWidget) {
              view.dispatch({
                changes: [{ from: pos, insert: "\n" }],
                selection: env().pe.cursor(pos === 0 ? 0 : pos + 1),
                annotations: [env().yq.of(true)],
              });
              view.focus();
              return false;
            }
          });
        }
      },
    });
  };

  return TableWidget;
}
