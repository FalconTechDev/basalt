// s52 — own replacement for the inherited `_q` class: the CodeMirror-5-style
// editor facade that wraps a CM6 EditorView (`cm6`) and exposes the legacy
// CodeMirror.Adapter API used by the vim mode and by `window.CodeMirrorAdapter`.
//
// Everything here is application glue written from the observed behaviour: the
// facade translates {line, ch} positions to CM6 offsets, dispatches transactions
// through the view, tracks the curOp change/cursorActivity handler batches and
// re-expresses CM6 state (selections, folds, search, overlays) in CM5 shapes.
// CodeMirror 6/Lezer internals and the small app-scope helpers (position
// conversion, event trio, indent commands, bracket matching, the vim search
// query, bookmark marks, StringStream, Pos, ...) stay inherited and are reached
// lazily through env() so late-bound bundle variables stay correct.
//
// The factory returns the constructor function itself: `_q` doubles as a
// namespace (`_q.Pos`, `_q.commands`, `_q.keys`, `_q.signal`, ...), which is why
// the static members are attached to the constructor before it is returned.

import { env } from "./env.js";

/** Factory installed at the original `_q` position; returns the facade constructor. */
export function s52Cm5Adapter(host) {
  // env() object whose getters resolve app-scope names lazily at each access;
  // captured once here is safe because every read still goes through the getter.
  const E = env();

  // ---------------------------------------------------------------- internals

  /** Advance the bracket-scanner state for one line; shared by scanForBracket. */
  function bracketPairs() { return E.$q; }

  /** CM5-compatible bracket pair scan over the facade's lines. */
  function scanBracket(facade, pos, dir, options) {
    const maxLineLength = (options && options.maxScanLineLength) || 10000;
    const maxScanLines = (options && options.maxScanLines) || 1000;
    const stack = [];
    const re = (options && options.bracketRegex) || /[(){}[\]]/;
    const pairs = bracketPairs();
    const stop = dir > 0
      ? Math.min(pos.line + maxScanLines, facade.lastLine() + 1)
      : Math.max(facade.firstLine() - 1, pos.line - maxScanLines);
    let line = pos.line;
    for (; line != stop; line += dir) {
      const text = facade.getLine(line);
      if (text) {
        const from = dir > 0 ? 0 : text.length - 1;
        const to = dir > 0 ? text.length : -1;
        if (!(text.length > maxLineLength)) {
          let col = from;
          if (line == pos.line) col = pos.ch - (dir < 0 ? 1 : 0);
          for (; col != to; col += dir) {
            const ch = text.charAt(col);
            if (re.test(ch)) {
              const pair = pairs[ch];
              if (pair && (pair.charAt(1) == ">") == (dir > 0)) stack.push(ch);
              else {
                if (!stack.length) return { pos: new E.Bq(line, col), ch: ch };
                stack.pop();
              }
            }
          }
        }
      }
    }
    return line - dir != (dir > 0 ? facade.lastLine() : facade.firstLine()) && null;
  }

  /** Find the offset where a line of `text` should wrap at `width`. */
  function wrapPoint(text, width, maxIndent) {
    if (text.length < width) return undefined;
    const before = text.slice(0, width);
    const after = text.slice(width);
    const leadAfter = /^(?:(\s+)|(\S+)(\s+))/.exec(after);
    const trailBefore = /(?:(\s+)|(\s+)(\S+))$/.exec(before);
    let start = 0;
    let end = 0;
    if (trailBefore && !trailBefore[2]) {
      start = width - trailBefore[1].length;
      end = width;
    }
    if (leadAfter && !leadAfter[2]) {
      if (!start) start = width;
      end = width + leadAfter[1].length;
    }
    if (start) return { start: start, end: end };
    if (trailBefore && trailBefore[2] && trailBefore.index > maxIndent) {
      return { start: trailBefore.index, end: trailBefore.index + trailBefore[2].length };
    }
    if (leadAfter && leadAfter[2]) {
      start = width + leadAfter[2].length;
      return { start: start, end: start + leadAfter[3].length };
    }
    return undefined;
  }

  /** CM5 hardWrap: reflow the [from, to] line range to the configured width. */
  function hardWrap(facade, options) {
    const column = options.column || facade.getOption("textwidth") || 80;
    const allowMerge = options.allowMerge != 0;
    const first = Math.min(options.from, options.to);
    let last = Math.max(options.from, options.to);
    for (let line = first; line <= last; line++) {
      const text = facade.getLine(line);
      if (text.length > column) {
        const at = wrapPoint(text, column, 5);
        if (at) {
          const indent = /^\s*/.exec(text)?.[0];
          facade.replaceRange("\n" + indent, new E.Bq(line, at.start), new E.Bq(line, at.end));
        }
        last++;
      } else if (allowMerge && /\S/.test(text) && line != last) {
        const next = facade.getLine(line + 1);
        if (next && /\S/.test(next)) {
          const head = text.replace(/\s+$/, "");
          const tail = next.replace(/^\s+/, "");
          const joined = head + " " + tail;
          const at = wrapPoint(joined, column, 5);
          if ((at && at.start > head.length) || joined.length < column) {
            facade.replaceRange(" ", new E.Bq(line, head.length), new E.Bq(line + 1, next.length - tail.length));
            line--;
            last--;
          } else if (head.length < text.length) {
            facade.replaceRange("", new E.Bq(line, head.length), new E.Bq(line, text.length));
          }
        }
      }
    }
    return line;
  }

  // ---------------------------------------------------------------- constructor

  function Cm5Editor(cm6) {
    this.state = {};
    this.marks = Object.create(null);
    this.$mid = 0;
    this.options = {};
    this._handlers = {};
    this.$lastChangeEndOffset = 0;
    this.virtualSelection = null;
    this.cm6 = cm6;
    this.onChange = this.onChange.bind(this);
    this.onSelectionChange = this.onSelectionChange.bind(this);
  }

  const P = Cm5Editor.prototype;

  // ---- dialogs / notifications / events ----

  P.openDialog = function (content, onClose, options) { return E.Xq(this, content, onClose, options); };

  P.openNotification = function (message, options) {
    return (function (editor, text, opts) {
      let timer;
      E.Kq(editor, close);
      const box = E.Gq(editor, text, opts && opts.bottom);
      let closed = false;
      const duration = opts && opts.duration !== undefined ? opts.duration : 5000;
      function close() {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        box.remove();
        E.Qq(editor, box);
      }
      box.onclick = function (e) { e.preventDefault(); close(); };
      E.Yq(editor, box);
      if (duration) timer = window.setTimeout(close, duration);
      return close;
    })(this, message, options);
  };

  P.on = function (type, fn) { E.Vq(this, type, fn); };
  P.off = function (type, fn) { E.Hq(this, type, fn); };
  P.signal = function (type, arg1, arg2) { E.zq(this, type, arg1, arg2); };

  // ---- position conversion ----

  P.indexFromPos = function (pos) { return E.Fq(this.cm6.state.doc, pos); };
  P.posFromIndex = function (offset) { return E.Nq(this.cm6.state.doc, offset); };

  // ---- folds / lines ----

  P.foldCode = function (pos) {
    const view = this.cm6;
    const ranges = view.state.selection.ranges;
    const offset = E.Fq(view.state.doc, pos);
    const single = E.pe.create([E.pe.range(offset, offset)], 0).ranges;
    view.state.selection.ranges = single;
    E.Qp(view);
    view.state.selection.ranges = ranges;
  };

  P.firstLine = function () { return 0; };
  P.lastLine = function () { return this.cm6.state.doc.lines - 1; };
  P.lineCount = function () { return this.cm6.state.doc.lines; };

  // ---- selections ----

  P.setCursor = function (lineOrPos, ch) {
    if (typeof lineOrPos === "object") { ch = lineOrPos.ch; lineOrPos = lineOrPos.line; }
    const offset = E.Fq(this.cm6.state.doc, { line: lineOrPos, ch: ch || 0 });
    this.cm6.dispatch({ selection: { anchor: offset } }, { scrollIntoView: !this.curOp, userEvent: "select" });
    if (this.curOp && !this.curOp.isVimOp) this.onBeforeEndOperation();
  };

  P.getCursor = function (which) {
    const main = this.cm6.state.selection.main;
    const offset = which != "head" && which
      ? which == "anchor" ? main.anchor : which == "start" ? main.from : which == "end" ? main.to : null
      : main.head;
    if (offset == null) throw new Error("Invalid cursor type");
    return this.posFromIndex(offset);
  };

  P.listSelections = function () {
    const doc = this.cm6.state.doc;
    return this.cm6.state.selection.ranges.map((range) => ({
      anchor: E.Nq(doc, range.anchor),
      head: E.Nq(doc, range.head),
    }));
  };

  P.getMainSelection = function () {
    const doc = this.cm6.state.doc;
    const main = this.cm6.state.selection.main;
    return { anchor: E.Nq(doc, main.anchor), head: E.Nq(doc, main.head) };
  };

  P.setSelections = function (ranges, mainIndex) {
    const doc = this.cm6.state.doc;
    const selection = ranges.map((r) => {
      const head = E.Fq(doc, r.head);
      const anchor = E.Fq(doc, r.anchor);
      return head == anchor ? E.pe.cursor(head, 1) : E.pe.range(anchor, head);
    });
    this.cm6.dispatch({ selection: E.pe.create(selection, mainIndex) });
  };

  P.setSelection = function (anchor, head, options) {
    this.setSelections([{ anchor: anchor, head: head }], 0);
    if (options && options.origin == "*mouse") this.onBeforeEndOperation();
  };

  P.getLine = function (line) {
    const doc = this.cm6.state.doc;
    return line < 0 || line >= doc.lines ? "" : doc.line(line + 1).text;
  };

  P.getLineHandle = function (row) {
    if (!this.$lineHandleChanges) this.$lineHandleChanges = [];
    return { row: row, index: this.indexFromPos(new E.Bq(row, 0)) };
  };

  P.getLineNumber = function (handle) {
    const changes = this.$lineHandleChanges;
    if (!changes) return null;
    let index = handle.index;
    for (let i = 0; i < changes.length; i++) {
      index = changes[i].changes.mapPos(index, 1, E.ne.TrackAfter);
      if (index == null) return null;
    }
    const pos = this.posFromIndex(index);
    return pos.ch == 0 ? pos.line : null;
  };

  P.releaseLineHandles = function () { this.$lineHandleChanges = undefined; };

  // ---- text ----

  P.getRange = function (from, to) {
    const doc = this.cm6.state.doc;
    return this.cm6.state.sliceDoc(E.Fq(doc, from), E.Fq(doc, to));
  };

  P.replaceRange = function (text, from, to) {
    if (!to) to = from;
    const doc = this.cm6.state.doc;
    E.jq(this, { changes: { from: E.Fq(doc, from), to: E.Fq(doc, to), insert: text } });
  };

  P.replaceSelection = function (text) {
    E.jq(this, this.cm6.state.replaceSelection(text));
  };

  P.replaceSelections = function (texts) {
    const changes = this.cm6.state.selection.ranges.map((range, i) => ({
      from: range.from, to: range.to, insert: texts[i] || "",
    }));
    E.jq(this, { changes: changes });
  };

  P.getSelection = function () { return this.getSelections().join("\n"); };

  P.getSelections = function () {
    const view = this.cm6;
    return view.state.selection.ranges.map((range) => view.state.sliceDoc(range.from, range.to));
  };

  P.somethingSelected = function () {
    return this.cm6.state.selection.ranges.some((range) => !range.empty);
  };

  P.getInputField = function () { return this.cm6.contentDOM; };

  P.clipPos = function (pos) {
    const doc = this.cm6.state.doc;
    let ch = pos.ch;
    let line = pos.line + 1;
    if (line < 1) { line = 1; ch = 0; }
    if (line > doc.lines) { line = doc.lines; ch = Number.MAX_VALUE; }
    const l = doc.line(line);
    ch = Math.min(Math.max(0, ch), l.to - l.from);
    return new E.Bq(line - 1, ch);
  };

  P.getValue = function () { return this.cm6.state.doc.toString(); };

  P.setValue = function (text) {
    const view = this.cm6;
    return view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: E.pe.range(0, 0),
    });
  };

  P.focus = function () { return this.cm6.focus(); };
  P.blur = function () { return this.cm6.contentDOM.blur(); };
  P.defaultTextHeight = function () { return this.cm6.defaultLineHeight; };

  // ---- brackets ----

  P.findMatchingBracket = function (pos) {
    const state = this.cm6.state;
    const offset = E.Fq(state.doc, pos);
    let found = E.Nd(state, offset + 1, -1);
    if (!(found && found.end)) found = E.Nd(state, offset, 1);
    return found && found.end ? { to: this.posFromIndex(found.end.from) } : { to: undefined };
  };

  P.scanForBracket = function (pos, dir, style, options) {
    return scanBracket(this, pos, dir, options);
  };

  // ---- indentation ----

  P.indentLine = function (line, dir) { dir ? this.indentMore() : this.indentLess(); };
  P.indentMore = function () { E.PR(this.cm6); };
  P.indentLess = function () { E.LR(this.cm6); };

  P.execCommand = function (name) {
    if (name == "indentAuto") Cm5Editor.commands.indentAuto(this);
    else if (name == "goLineLeft") E.aN(this.cm6);
    else if (name == "goLineRight") {
      E.oN(this.cm6);
      const state = this.cm6.state;
      const head = state.selection.main.head;
      if (head < state.doc.length && state.sliceDoc(head, head + 1) !== "\n") E.PF(this.cm6);
    } else console.log(name + " is not implemented");
  };

  // ---- bookmarks / overlays ----

  P.setBookmark = function (pos, options) {
    const assoc = (options && options.insertLeft) ? 1 : -1;
    return new E.tj(this, this.indexFromPos(pos), assoc);
  };

  P.addOverlay = function (overlay) {
    const query = overlay.query;
    const search = new E.uB({ regexp: true, search: query.source, caseSensitive: !/i/.test(query.flags) });
    if (search.valid) {
      search.forVim = true;
      this.cm6Query = search;
      const effect = E.yB.of(search);
      this.cm6.dispatch({ effects: effect });
      return search;
    }
  };

  P.removeOverlay = function () {
    if (this.cm6Query) {
      this.cm6Query.forVim = false;
      const effect = E.yB.of(this.cm6Query);
      this.cm6.dispatch({ effects: effect });
    }
  };

  // ---- search cursor ----

  P.getSearchCursor = function (query, start) {
    const editor = this;
    let current = null;
    let result = null;
    if (start.ch == null) start.ch = Number.MAX_VALUE;
    const fromOffset = E.Fq(editor.cm6.state.doc, start);
    const pattern = query.source.replace(/(\\.|{(?:\d+(?:,\d*)?|,\d+)})|[{}]/g, (m, keep) => keep || "\\" + m);
    function makeCursor(text, from, to) {
      if (from === undefined) from = 0;
      if (to === undefined) to = text.length;
      return new E.UR(text, pattern, { ignoreCase: query.ignoreCase }, from, to);
    }
    function searchBack(text, to) {
      for (let radius = 1; ; radius++) {
        const from = Math.max(0, to - 10000 * radius);
        const cursor = makeCursor(text, from, to);
        let last = null;
        let step;
        while (!(step = cursor.next()).done) last = step.value;
        if (last && (from == 0 || last.from > from + 10)) return last;
        if (from == 0) return null;
      }
    }
    function searchForward(text, from) {
      if (from > text.length) return null;
      const step = makeCursor(text, from).next();
      return step.done ? null : step.value;
    }
    return {
      findNext: function () { return this.find(false); },
      findPrevious: function () { return this.find(true); },
      find: function (backward) {
        const doc = editor.cm6.state.doc;
        if (backward) {
          const before = current ? (current.from == current.to ? current.to - 1 : current.from) : fromOffset;
          current = searchBack(doc, before);
        } else {
          const after = current ? (current.from == current.to ? current.to + 1 : current.to) : fromOffset;
          current = searchForward(doc, after);
        }
        result = current && { from: E.Nq(doc, current.from), to: E.Nq(doc, current.to), match: current.match };
        return current && current.match;
      },
      from: function () { return result == null ? undefined : result.from; },
      to: function () { return result == null ? undefined : result.to; },
      replace: function (text) {
        if (current) {
          E.jq(editor, { changes: { from: current.from, to: current.to, insert: text } });
          current.to = current.from + text.length;
          if (result) result.to = E.Nq(editor.cm6.state.doc, current.to);
        }
      },
    };
  };

  // ---- vertical movement / coordinates ----

  P.moveByChar = function (pos, forward, count) {
    const view = this.cm6;
    const offset = E.Fq(view.state.doc, pos);
    let cursor = E.pe.cursor(offset);
    for (let i = count; i > 0; i--) {
      const tablePos = view.getNextTablePos;
      if (tablePos && tablePos(view, cursor, forward ? "end" : "start")) break;
      cursor = view.moveByChar(cursor, forward);
    }
    const moved = this.posFromIndex(cursor.head);
    return moved.line !== pos.line ? pos : moved;
  };

  P.findPosV = function (pos, amount, unit, goalColumn) {
    const view = this.cm6;
    const doc = view.state.doc;
    const pageHeight = unit == "page" ? view.dom.clientHeight : 0;
    const offset = E.Fq(doc, pos);
    let cursor = E.pe.cursor(offset, 1, undefined, goalColumn);
    const steps = Math.round(Math.abs(amount));
    const down = amount > 0;
    let focusBefore;
    const editor = this;
    function stepOnce() {
      if (unit == "page") {
        cursor = view.moveVertically(cursor, down, pageHeight);
      } else if (unit == "line") {
        let next = view.moveVertically(cursor, down);
        const tablePos = view.getNextTablePos;
        if (tablePos && tablePos(view, cursor, down ? "down" : "up")) return { value: next };
        const upDown = view.getNextPosUpDown;
        if (upDown) {
          const better = upDown(view.state, cursor, down);
          if (better && Math.abs(next.head - cursor.head) > Math.abs(better.head - cursor.head)) next = better;
          else if (steps === 1 && !down && E.eP(view, cursor.head)) {
            const owner = view.state.field(E.W$);
            if (E.$I(owner) && owner.metadataEditor.containerEl.isShown()) {
              const target = owner;
              focusBefore = "ArrowUp" === (editor.state.vimPlugin && editor.state.vimPlugin.lastKeydown)
                ? function () { return target.shiftFocusBefore(); }
                : function () { return target.metadataEditor.focus({ bottom: true }); };
            }
          }
        }
        cursor = next;
      }
    }
    for (let i = 0; i < steps; i++) {
      const early = stepOnce();
      if (typeof early === "object") return early.value;
    }
    const result = E.Nq(doc, cursor.head);
    if (focusBefore) result.focusBefore = focusBefore;
    if ((amount < 0 && cursor.head == 0 && goalColumn != 0 && pos.line == 0 && pos.ch != 0)
      || (amount > 0 && cursor.head == doc.length && result.ch != goalColumn && pos.line == result.line)) {
      result.hitSide = true;
    }
    return result;
  };

  P.charCoords = function (pos, mode) {
    const view = this.cm6;
    const offset = E.Fq(view.state.doc, pos);
    const at = view.coordsAtPos(offset) || { left: 0, top: 0, bottom: 0 };
    let x = 0;
    let y = 0;
    if (mode === "div") {
      const rect = view.contentDOM.getBoundingClientRect();
      x = rect.left;
      y = rect.top;
    } else {
      const rect = view.scrollDOM.getBoundingClientRect();
      x = rect.left - view.scrollDOM.scrollLeft;
      y = rect.top - view.scrollDOM.scrollTop;
    }
    return { left: at.left - x, top: at.top - y, bottom: at.bottom - y };
  };

  P.coordsChar = function (coords, mode) {
    const view = this.cm6;
    let x = 0;
    let y = 0;
    if (mode === "div") {
      const rect = view.contentDOM.getBoundingClientRect();
      x = rect.left;
      y = rect.top;
    } else {
      const rect = view.scrollDOM.getBoundingClientRect();
      x = rect.left - view.scrollDOM.scrollLeft;
      y = rect.top - view.scrollDOM.scrollTop;
    }
    const offset = view.posAtCoords({ x: coords.left + x, y: coords.top + y }) || 0;
    return E.Nq(view.state.doc, offset);
  };

  // ---- scroll / size ----

  P.getScrollInfo = function () {
    const el = this.cm6.scrollDOM;
    return {
      left: el.scrollLeft, top: el.scrollTop,
      height: el.scrollHeight, width: el.scrollWidth,
      clientHeight: el.clientHeight, clientWidth: el.clientWidth,
    };
  };

  P.scrollTo = function (x, y) {
    if (x != null) this.cm6.scrollDOM.scrollLeft = x;
    if (y != null) this.cm6.scrollDOM.scrollTop = y;
  };

  P.scrollInfo = function () { return 0; };

  P.scrollIntoView = function (pos, margin) {
    if (pos) {
      this.cm6.dispatch({ effects: E._o.scrollIntoView(this.indexFromPos(pos), { yMargin: margin }) });
    } else {
      this.cm6.dispatch({ scrollIntoView: true, userEvent: "scroll" });
    }
  };

  P.getWrapperElement = function () { return this.cm6.dom; };
  P.getMode = function () { return { name: this.getOption("mode") }; };

  P.setSize = function (width, height) {
    this.cm6.dom.style.width = width + 4 + "px";
    this.cm6.dom.style.height = height + "px";
    this.refresh();
  };

  P.refresh = function () { this.cm6.measure(); };
  P.destroy = function () { this.removeOverlay(); };
  P.getLastEditEnd = function () { return this.posFromIndex(this.$lastChangeEndOffset); };

  // ---- change / operation tracking ----

  P.onChange = function (update) {
    const editor = this;
    if (this.$lineHandleChanges) this.$lineHandleChanges.push(update);
    for (const id in this.marks) this.marks[id].update(update.changes);
    if (this.virtualSelection) {
      this.virtualSelection = E.pe.create(
        this.virtualSelection.ranges.map((range) => range.map(update.changes)),
        this.virtualSelection.mainIndex
      );
    }
    const op = this.curOp = this.curOp || {};
    update.changes.iterChanges(function (fromA, toA, fromB, toB, inserted) {
      if (op.$changeStart == null || op.$changeStart > fromB) op.$changeStart = fromB;
      editor.$lastChangeEndOffset = toB;
      const change = { text: inserted.toJSON() };
      if (op.lastChange) op.lastChange.next = op.lastChange = change;
      else op.lastChange = op.change = change;
    }, true);
    if (!op.changeHandlers) {
      op.changeHandlers = this._handlers.change && this._handlers.change.slice();
    }
  };

  P.onSelectionChange = function () {
    const op = this.curOp = this.curOp || {};
    if (!op.cursorActivityHandlers) {
      op.cursorActivityHandlers = this._handlers.cursorActivity && this._handlers.cursorActivity.slice();
    }
    this.curOp.cursorActivity = true;
  };

  P.operation = function (fn) {
    let result;
    if (!this.curOp) this.curOp = { $d: 0 };
    this.curOp.$d++;
    try {
      result = fn();
    } finally {
      if (this.curOp) {
        this.curOp.$d--;
        if (!this.curOp.$d) this.onBeforeEndOperation();
      }
    }
    return result;
  };

  P.onBeforeEndOperation = function () {
    const op = this.curOp;
    let scrollIntoView = false;
    if (op) {
      if (op.change) E.qq(op.changeHandlers, this, op.change);
      if (op.cursorActivity) {
        E.qq(op.cursorActivityHandlers, this, null);
        if (op.isVimOp) scrollIntoView = true;
      }
      if (op.isVimOp) {
        const folds = E.Gp(this.cm6.state);
        const effects = [];
        const collect = (range) => {
          folds.between(range.from, range.to, (from, to) => {
            if (range.to !== from && range.from !== to) effects.push(E.jp.of({ from: from, to: to }));
          });
        };
        const ranges = this.cm6.state.selection.ranges;
        for (let i = 0; i < ranges.length; i++) collect(ranges[i]);
        if (effects.length > 0) this.cm6.dispatch({ effects: effects });
      }
      this.curOp = null;
    }
    if (scrollIntoView) this.scrollIntoView();
  };

  P.moveH = function (amount, unit) {
    if (unit == "char") {
      const cursor = this.getCursor();
      this.setCursor(cursor.line, cursor.ch + amount);
    }
  };

  // ---- options ----

  P.setOption = function (name, value) {
    switch (name) {
      case "keyMap": this.state.keyMap = value; break;
      case "textwidth": this.state.textwidth = value; break;
    }
  };

  P.getOption = function (name) {
    switch (name) {
      case "firstLineNumber": return 1;
      case "tabSize": return this.cm6.state.tabSize || 4;
      case "readOnly": return this.cm6.state.readOnly;
      case "indentWithTabs": return "\t" == this.cm6.state.facet(E.yp);
      case "indentUnit": return this.cm6.state.facet(E.yp).length || 2;
      case "textwidth": return this.state.textwidth;
      case "keyMap": return this.state.keyMap || "vim";
    }
  };

  P.toggleOverwrite = function (on) { this.state.overwrite = on; };

  P.getTokenTypeAt = function (pos) {
    const offset = this.indexFromPos(pos);
    const tree = E.np(this.cm6.state, offset);
    const node = tree == null ? undefined : tree.resolve(offset);
    const typeName = (node && node.type && node.type.name) || "";
    return /comment/i.test(typeName) ? "comment" : /string/i.test(typeName) ? "string" : "";
  };

  P.overWriteSelection = function (text) {
    const doc = this.cm6.state.doc;
    const selection = this.cm6.state.selection;
    const ranges = selection.ranges.map((range) => {
      if (range.empty) {
        const next = range.to < doc.length ? doc.sliceString(range.from, range.to + 1) : "";
        if (next && !/\n/.test(next)) return E.pe.range(range.from, range.to + 1);
      }
      return range;
    });
    this.cm6.dispatch({ selection: E.pe.create(ranges, selection.mainIndex) });
    this.replaceSelection(text);
  };

  // ---- multi-selection ----

  P.isInMultiSelectMode = function () {
    return this.cm6.state.selection.ranges.length > 1;
  };

  P.virtualSelectionMode = function () { return !!this.virtualSelection; };

  P.forEachSelection = function (fn) {
    const selection = this.cm6.state.selection;
    this.virtualSelection = E.pe.create(selection.ranges, selection.mainIndex);
    for (let i = 0; i < this.virtualSelection.ranges.length; i++) {
      const range = this.virtualSelection.ranges[i];
      if (range) {
        this.cm6.dispatch({ selection: E.pe.create([range]) });
        fn();
        this.virtualSelection.ranges[i] = this.cm6.state.selection.ranges[0];
      }
    }
    this.cm6.dispatch({ selection: this.virtualSelection });
    this.virtualSelection = null;
  };

  P.hardWrap = function (options) { return hardWrap(this, options); };

  // ---------------------------------------------------------------- statics

  Cm5Editor.isMac = "undefined" != typeof navigator && /Mac/.test(navigator.platform);
  Cm5Editor.Pos = E.Bq;
  Cm5Editor.StringStream = E.Vd;
  Cm5Editor.commands = {
    cursorCharLeft: function (editor) { E.TF(editor.cm6); },
    redo: function (editor) { E.Uq(editor, false); },
    undo: function (editor) { E.Uq(editor, true); },
    newlineAndIndent: function (editor) {
      E.SR({ state: editor.cm6.state, dispatch: function (spec) { return E.jq(editor, spec); } });
    },
    newlineAndIndentBefore: function (editor) { E.Oq(editor.cm6); },
    indentAuto: function (editor) { E.AR(editor.cm6); },
  };
  Cm5Editor.isWordChar = function (ch) { return E.Rq.test(ch); };
  Cm5Editor.keys = E.Wq;
  Cm5Editor.addClass = function () {};
  Cm5Editor.rmClass = function () {};
  Cm5Editor.e_preventDefault = function (e) { e.preventDefault(); };
  Cm5Editor.e_stop = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();
    if (e && e.preventDefault) e.preventDefault();
  };
  Cm5Editor.lookupKey = function (name, map, fn) {
    const keys = Cm5Editor.keys[name];
    if (keys) fn(keys);
  };
  Cm5Editor.on = E.Vq;
  Cm5Editor.off = E.Hq;
  Cm5Editor.signal = E.zq;
  Cm5Editor.findMatchingTag = E.Zq;
  Cm5Editor.findEnclosingTag = E.Jq;
  Cm5Editor.keyName = undefined;

  return Cm5Editor;
}
