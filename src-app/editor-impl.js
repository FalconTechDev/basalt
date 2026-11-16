import { inherit, methods } from "./inherit.js";

// CodeMirror-backed Editor implementation (iZ): the concrete class behind
// the public Editor API (cP). Translates the Obsidian-style editor surface
// (getLine/setSelection/transaction/exec/searchCursor/folds/highlights/
// clickable tokens/tables/markdown formatting) onto CodeMirror 6 state,
// using the app's CM6 extension layer reached through host bindings.

// {line, ch} -> doc offset.
function cmPosToOffset(doc, pos) {
  if (pos.line < 0) return 0;
  const lineNo = pos.line + 1;
  if (lineNo > doc.lines) return doc.length;
  const line = doc.line(lineNo);
  return Math.min(line.from + Math.max(0, pos.ch), line.to);
}

// doc offset -> {line, ch}.
function cmOffsetToPos(doc, offset) {
  offset = Math.clamp(offset, 0, doc.length);
  const line = doc.lineAt(offset);
  return { line: line.number - 1, ch: offset - line.from };
}

const FORMATTING_TABLE = {
  bold: { nodeType: "strong", surroundingChars: "**", altSurroundingChars: "__" },
  italic: { nodeType: "em", surroundingChars: "*", altSurroundingChars: "_" },
  code: { nodeType: "inline-code", surroundingChars: "`" },
  highlight: { nodeType: "highlight", surroundingChars: "==" },
  strikethrough: { nodeType: "strikethrough", surroundingChars: "~~" },
  comment: { nodeType: "comment", surroundingChars: "%%" },
  math: { nodeType: "math", surroundingChars: "$" },
};

export function defineEditorImpl(host) {
  function EditorImpl(component) {
    const self = host.EditorApi.call(this) || this;
    self.init(component);
    return self;
  }
  inherit(EditorImpl, host.EditorApi);

  Object.defineProperty(EditorImpl.prototype, "activeCM", {
    get() { return this.editorComponent.activeCM; },
    enumerable: false,
    configurable: true,
  });

  Object.defineProperty(EditorImpl.prototype, "inTableCell", {
    get() {
      const component = this.editorComponent;
      return component instanceof host.TableCellEditor || !!component.tableCell;
    },
    enumerable: false,
    configurable: true,
  });

  methods(EditorImpl, {
    init(component) {
      this.editorComponent = component;
      this.cm = component.cm;
      this.containerEl = component.cm.dom;
    },
    refresh() {
      this.cm.requestMeasure();
    },
    getValue() {
      return this.cm.state.doc.toString();
    },
    setValue(value) {
      const cm = this.cm;
      cm.dispatch({ changes: { from: 0, to: cm.state.doc.length, insert: value } });
    },
    getLine(line) {
      const doc = this.cm.state.doc;
      return line >= doc.lines ? "" : doc.line(line + 1).text;
    },
    lineCount() {
      return this.cm.state.doc.lines;
    },
    lastLine() {
      return this.cm.state.doc.lines - 1;
    },
    getSelection() {
      const cm = this.cm;
      const main = cm.state.selection.main;
      return cm.state.doc.sliceString(main.from, main.to);
    },
    getRange(from, to) {
      const cm = this.cm;
      const doc = cm.state.doc;
      return doc.sliceString(cmPosToOffset(doc, from), cmPosToOffset(doc, to));
    },
    replaceSelection(text, userEvent) {
      const cm = this.cm;
      const tr = cm.state.replaceSelection(text);
      tr.userEvent = userEvent;
      cm.dispatch(tr);
    },
    replaceRange(text, from, to, userEvent) {
      const cm = this.cm;
      const doc = cm.state.doc;
      const start = cmPosToOffset(doc, from);
      const end = to ? cmPosToOffset(doc, to) : start;
      cm.dispatch({ changes: { from: start, to: end, insert: text }, scrollIntoView: true, userEvent });
    },
    getCursor(which) {
      if (which === undefined) which = "head";
      const cm = this.cm;
      const main = cm.state.selection.main;
      const doc = cm.state.doc;
      switch (which) {
        case "from": return cmOffsetToPos(doc, main.from);
        case "to": return cmOffsetToPos(doc, main.to);
        case "anchor": return cmOffsetToPos(doc, main.anchor);
        case "head": return cmOffsetToPos(doc, main.head);
      }
      return null;
    },
    listSelections() {
      const cm = this.cm;
      const ranges = cm.state.selection.ranges;
      const doc = cm.state.doc;
      const out = [];
      for (const range of ranges) {
        out.push({ anchor: cmOffsetToPos(doc, range.anchor), head: cmOffsetToPos(doc, range.head) });
      }
      return out;
    },
    setSelection(anchor, head) {
      const cm = this.cm;
      const doc = cm.state.doc;
      const from = cmPosToOffset(doc, anchor);
      const to = head ? cmPosToOffset(doc, head) : from;
      cm.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    },
    setSelections(selections, userEvent) {
      const cm = this.cm;
      const doc = cm.state.doc;
      cm.dispatch({
        selection: host.cmSelection.create(selections.map((sel) => {
          const anchor = cmPosToOffset(doc, sel.anchor);
          const head = sel.head ? cmPosToOffset(doc, sel.head) : anchor;
          return host.cmSelection.range(anchor, head);
        })),
        scrollIntoView: true,
        userEvent,
      });
    },
    exec(command) {
      const cm = this.editorComponent.activeCM;
      EditorImpl.commands[command](cm);
    },
    focus() {
      this.editorComponent.activeCM.focus();
    },
    blur() {
      this.editorComponent.activeCM.contentDOM.blur();
    },
    hasFocus() {
      return this.editorComponent.activeCM.hasFocus;
    },
    getScrollInfo() {
      const dom = this.cm.scrollDOM;
      return {
        top: dom.scrollTop, left: dom.scrollLeft,
        clientHeight: dom.clientHeight, clientWidth: dom.clientWidth,
        height: dom.offsetHeight, width: dom.offsetWidth,
      };
    },
    scrollTo(left, top) {
      const dom = this.cm.scrollDOM;
      if (left == null) left = dom.scrollLeft;
      if (top == null) top = dom.scrollTop;
      dom.scroll(left, top);
    },
    scrollIntoView(range, center) {
      const cm = this.cm;
      const from = cmPosToOffset(cm.state.doc, range.from);
      const to = cmPosToOffset(cm.state.doc, range.to);
      const selectionRange = host.cmSelection.range(from, to);
      cm.dispatch({ effects: host.cmView.scrollIntoView(selectionRange, { y: center ? "center" : "nearest" }) });
    },
    transaction(spec, userEvent) {
      const replaceSelection = spec.replaceSelection;
      const changesSpec = spec.changes;
      const selection = spec.selection;
      const selections = spec.selections;
      const cm = this.cm;
      const doc = cm.state.doc;
      const tr = {};
      const changeSets = [];
      tr.scrollIntoView = true;
      if (typeof replaceSelection === "string") {
        const tr2 = cm.state.replaceSelection(replaceSelection);
        changeSets.push(tr2.changes);
        tr.selection = tr2.selection;
        tr.effects = tr2.effects;
      }
      if (changesSpec) {
        for (const change of changesSpec) {
          const from = cmPosToOffset(doc, change.from);
          const to = change.to ? cmPosToOffset(doc, change.to) : from;
          changeSets.push({ from, to, insert: change.text });
        }
      }
      let appliedDoc = doc;
      if (changeSets.length > 0) {
        const set = host.cmChangeSet.of(changeSets, doc.length, cm.state.facet(host.cmState.lineSeparator));
        tr.changes = [set];
        if (selections || selection) appliedDoc = set.apply(doc);
      } else {
        tr.changes = changeSets;
      }
      if (selections) {
        tr.selection = host.cmSelection.create(selections.map((sel) => {
          const from = cmPosToOffset(appliedDoc, sel.from);
          const to = sel.to ? cmPosToOffset(appliedDoc, sel.to) : from;
          return host.cmSelection.range(from, to);
        }));
      } else if (selection) {
        const from = cmPosToOffset(appliedDoc, selection.from);
        const to = selection.to ? cmPosToOffset(appliedDoc, selection.to) : from;
        tr.selection = { anchor: from, head: to };
      }
      tr.userEvent = userEvent;
      cm.dispatch(tr);
    },
    wordAt(pos) {
      const cm = this.cm;
      const doc = cm.state.doc;
      const range = cm.state.wordAt(cmPosToOffset(doc, pos));
      return range ? { from: cmOffsetToPos(doc, range.from), to: cmOffsetToPos(doc, range.to) } : null;
    },
    posToOffset(pos) {
      return cmPosToOffset(this.cm.state.doc, pos);
    },
    offsetToPos(offset) {
      return cmOffsetToPos(this.cm.state.doc, offset);
    },
    undo() {
      host.cmUndo(this.cm);
    },
    redo() {
      host.cmRedo(this.cm);
    },
    coordsAtPos(pos, clipToScroll) {
      const cm = this.cm;
      const coords = cm.coordsAtPos(cmPosToOffset(cm.state.doc, pos));
      if (!coords) return null;
      const rect = { top: coords.top, left: coords.left, bottom: coords.bottom, right: coords.right };
      if (clipToScroll) {
        const bounds = cm.scrollDOM.getBoundingClientRect();
        const left = bounds.left - cm.scrollDOM.scrollLeft;
        const top = bounds.top - cm.scrollDOM.scrollTop;
        rect.top -= top;
        rect.bottom -= top;
        rect.left -= left;
        rect.right -= left;
      }
      return rect;
    },
    posAtCoords(x, y) {
      const cm = this.cm;
      const pos = cm.posAtCoords({ x, y }, false);
      return pos === null ? null : cmOffsetToPos(cm.state.doc, pos);
    },
    addHighlights(ranges, cls, replace, excludeFolds) {
      const cm = this.cm;
      const effects = [];
      const marks = [];
      let markSpec = host.highlightCache.get(cls);
      if (!markSpec) {
        markSpec = host.cmDecoration.mark({ class: cls });
        host.highlightCache.set(cls, markSpec);
      }
      const doc = cm.state.doc;
      const folded = host.cmFoldedRanges(cm.state);
      const addRange = (range) => {
        const from = cmPosToOffset(doc, range.from);
        const to = cmPosToOffset(doc, range.to);
        if (from >= to) return;
        marks.push(markSpec.range(from, to));
        if (excludeFolds) {
          folded.between(from, to, (a, b) => {
            if (to !== a && from !== b) effects.push(host.cmUnfoldEffect.of({ from: a, to: b }));
          });
        }
      };
      for (const range of ranges) addRange(range);
      if (replace) effects.push(host.cmFilterEffect.of((from, to, value) => value !== markSpec));
      effects.push(host.cmHighlightField.of(marks));
      cm.dispatch({ effects });
    },
    removeHighlights(cls) {
      if (!this.cm.dom.isShown() || !this.hasHighlight(cls)) return;
      if (cls) {
        const markSpec = host.highlightCache.get(cls);
        this.cm.dispatch({ effects: host.cmFilterEffect.of((from, to, value) => value !== markSpec) });
      } else {
        this.cm.dispatch({ effects: host.cmFilterEffect.of(() => false) });
      }
    },
    hasHighlight(cls) {
      const field = this.cm.state.field(host.cmHighlightState, false);
      if (!cls) return field.size > 0;
      const markSpec = host.highlightCache.get(cls);
      for (let iter = field.iter(); iter.value;) {
        if (iter.value === markSpec) return true;
        iter.next();
      }
      return false;
    },
    getAllFoldableLines() {
      const state = this.cm.state;
      const lines = [];
      for (let n = 1; n <= state.doc.lines; n++) {
        const line = state.doc.line(n);
        const range = host.cmFoldableRange(state, line.from, line.to);
        if (range) lines.push(range);
      }
      return lines;
    },
    getFoldOffsets() {
      const folded = host.cmFoldedRanges(this.cm.state);
      const offsets = new Set();
      for (let iter = folded.iter(); iter.value;) {
        offsets.add(iter.from);
        iter.next();
      }
      return offsets;
    },
    foldLess() {
      const doc = this.cm.state.doc;
      const folded = this.getFoldOffsets();
      const foldable = this.getAllFoldableLines();
      const toFold = [];
      const visit = (range) => {
        const end = doc.lineAt(range.to).to;
        const span = { from: range.from, to: end };
        const candidates = foldable.filter((f) => host.cmRangeContains(span, f.from, f.to));
        for (const candidate of candidates) {
          if (folded.has(candidate.from)) {
            toFold.push(candidate);
            break;
          }
        }
      };
      for (const range of this.cm.state.selection.ranges) visit(range);
      if (toFold.length > 0) {
        this.cm.dispatch({ effects: toFold.map((f) => host.cmUnfoldEffect.of(f)) });
      }
    },
    foldMore() {
      const doc = this.cm.state.doc;
      const folded = this.getFoldOffsets();
      const foldable = this.getAllFoldableLines();
      const toUnfold = [];
      const visit = (range) => {
        const end = doc.lineAt(range.to).to;
        const span = { from: range.from, to: end };
        const candidates = foldable.filter((f) => host.cmRangeContains(span, f.from, f.to));
        for (let i = candidates.length - 1; i >= 0; i--) {
          const candidate = candidates[i];
          if (!folded.has(candidate.from)) {
            toUnfold.push(candidate);
            break;
          }
        }
      };
      for (const range of this.cm.state.selection.ranges) visit(range);
      if (toUnfold.length > 0) {
        this.cm.dispatch({ effects: toUnfold.map((f) => host.cmFoldEffect.of(f)) });
      }
    },
    insertHorizontalRule() {
      const state = this.cm.state;
      this.cm.dispatch(state.changeByRange((range) => {
        const ch = cmOffsetToPos(state.doc, range.from).ch > 0 ? 2 : 1;
        const insert = "\n".repeat(ch) + "---\n";
        return { range: host.cmSelection.cursor(range.from + insert.length), changes: [{ from: range.from, to: range.to, insert }] };
      }));
    },
    insertBlock(open, close) {
      const cm = this.cm;
      const state = cm.state;
      const doc = state.doc;
      const selection = state.selection;
      const lineRanges = host.cmSelection.create(selection.ranges.map((range) => {
        const from = doc.lineAt(range.from);
        const to = doc.lineAt(range.to);
        return host.cmSelection.range(from.from, to.to);
      }));
      const changes = [];
      for (const range of lineRanges.ranges) {
        changes.push({ insert: open + "\n", from: range.from });
        changes.push({ insert: "\n" + close, from: range.to });
      }
      const delta = open.length + 1;
      cm.dispatch({
        changes,
        selection: host.cmSelection.create(selection.ranges.map((range) => host.cmSelection.range(range.anchor + delta, range.head + delta))),
      });
    },
    insertMarkdownLink() {
      const state = this.cm.state;
      const tr = state.changeByRange((range) => {
        const selected = state.sliceDoc(range.from, range.to);
        const insert = "[" + selected + "]()";
        const cursor = range.empty ? 1 : 1 + selected.length + 2;
        return { changes: { from: range.from, to: range.to, insert }, range: host.cmCursorRange(range, range.from + cursor, range.from + cursor) };
      });
      tr.userEvent = "input.autocomplete";
      this.cm.dispatch(tr);
    },
    triggerWikilink(embed) {
      const state = this.cm.state;
      const tr = state.changeByRange((range) => {
        const open = embed ? "![[" : "[[";
        const selected = state.sliceDoc(range.from, range.to);
        const insert = open + selected + "]]";
        const cursor = range.from + open.length + selected.length;
        return { changes: { from: range.from, to: range.to, insert }, range: host.cmCursorRange(range, cursor, cursor) };
      });
      tr.userEvent = "input.autocomplete";
      this.cm.dispatch(tr);
    },
    clearMarkdownFormatting() {
      const cm = this.cm;
      const changes = [];
      const tableRanges = this.getTableSelection();
      const ranges = tableRanges.length > 0
        ? tableRanges.map((cell) => {
            const offsets = cell.getAbsoluteOffsets();
            return host.cmSelection.range(offsets.textStart, offsets.textEnd);
          })
        : cm.state.selection.ranges;
      for (const range of ranges) {
        if (range.empty) continue;
        host.cmSyntaxTree(cm.state).iterate({
          from: range.from,
          to: range.to,
          enter(node) {
            const classes = node.type.prop(host.cmSyntaxPropClasses);
            if (classes && new Set(classes.split(" ")).has("formatting")) {
              changes.push({ from: node.from, to: node.to, insert: "" });
            }
          },
        });
      }
      cm.dispatch({ changes });
    },
    getTableSelection() {
      return this.editorComponent.tableCell ? this.editorComponent.tableCell.table.selectedCells : [];
    },
    toggleMarkdownFormatting(kind) {
      const cm = this.cm;
      const tree = host.cmSyntaxTree(cm.state).cursor(host.cmSyntaxExcludeBuffers);
      const format = FORMATTING_TABLE[kind];
      let offset = 0;
      const changes = [];
      const selections = [];
      let singleSelection = true;
      const tableCells = this.getTableSelection();
      let ranges = cm.state.selection.ranges;
      if (tableCells.length > 0) {
        ranges = tableCells.map((cell) => {
          const offsets = cell.getAbsoluteOffsets();
          return host.cmSelection.range(offsets.textStart, offsets.textEnd);
        });
        singleSelection = false;
      }
      const hasFormat = host.cmFormatQuery(cm.state, ranges[0])[kind];
      const visit = (range) => {
        host.cmFormatSeek(tree, range.from);
        const span = host.cmFormatSpan(cm.state, range);
        const from = span.from;
        const to = span.to;
        const local = [];
        const remap = (start, end, extra) => {
          if (extra === undefined) extra = 0;
          let anchorOffset = offset;
          let headOffset = offset;
          for (const change of local) {
            const delta = change.from - change.to + change.insert.length;
            if (change.to <= start) anchorOffset += delta;
            if ((delta < 0 && change.to <= end) || change.to < end) headOffset += delta;
            offset += delta;
          }
          const newAnchor = start + anchorOffset + extra;
          const newHead = end === start ? newAnchor : end + headOffset + extra;
          return range.head >= range.anchor
            ? host.cmSelection.range(newAnchor, newHead)
            : host.cmSelection.range(newHead, newAnchor);
        };
        if (hasFormat) {
          if (range.empty) {
            const inner = host.cmFormatInner(cm.state, span, format);
            if (inner) {
              const length = inner.to - inner.from;
              selections.push(remap(span.from, span.from, length));
              return "continue-selectionLoop";
            }
          }
          const nodes = host.cmFormatNodes(cm.state, tree, { from, to }, kind);
          const removals = host.cmFormatRemove(cm.state, nodes, kind);
          local.push(...removals);
          selections.push(remap(span.from, Math.min(span.to, nodes.to)));
        } else {
          if (range.empty) {
            const word = cm.state.wordAt(span.from);
            if (word) {
              span.from = word.from;
              span.to = word.to;
            }
          }
          const startLine = cm.state.doc.lineAt(range.from);
          const endLine = cm.state.doc.lineAt(range.to);
          for (let lineNo = startLine.number; lineNo <= endLine.number; lineNo++) {
            let start = from;
            let end = to;
            const line = cm.state.doc.line(lineNo);
            const intersects = !(range.from < line.from || range.to > line.to);
            if (intersects || !host.isSmartIndentTarget(cm.state, line)) {
              if (!range.empty) {
                const bounds = host.cmFormatLineBounds(cm.state, lineNo);
                start = Math.clamp(bounds.from, from, to);
                end = Math.clamp(bounds.to, from, to);
              }
              if ((singleSelection && range.empty) || start !== end) {
                const nodes = host.cmFormatNodes(cm.state, tree, { from: start, to: end }, kind);
                local.push(...nodes);
                local.push({ from: start, to: start, insert: format.surroundingChars });
                local.push({ from: end, to: end, insert: format.surroundingChars });
              }
            }
          }
          if (range.empty && singleSelection) {
            const cursorShift = from === to ? -format.surroundingChars.length : 0;
            selections.push(remap(range.from, range.from, cursorShift));
          } else {
            selections.push(remap(from, to));
          }
        }
        changes.push(...local);
      };
      for (let i = 0; i < ranges.length; i++) visit(ranges[i]);
      cm.dispatch({
        changes,
        selection: selections.length > 0 ? host.cmSelection.create(selections) : undefined,
        userEvent: "input.type",
      });
    },
    insertTable() {
      const cm = this.cm;
      const anchor = cm.state.selection.main.anchor;
      const line = cm.state.doc.lineAt(anchor);
      let separator = "\n";
      if (line.text.length) {
        anchor = line.to;
        separator = "\n\n";
      }
      cm.dispatch({ changes: [{ from: anchor, insert: separator + "|     |     |\n| --- | --- |\n|     |     |\n" }] });
      cm.dispatch({ selection: { anchor: anchor + separator.length + 1 } });
    },
    toggleComment() {
      const cm = this.cm;
      const tree = host.cmSyntaxTree(cm.state).cursor(host.cmSyntaxExcludeBuffers);
      const tr = cm.state.changeByRange((range) => {
        let word;
        let comment;
        const info = host.cmFormatQuery(cm.state, range);
        let changes;
        if (info.comment) {
          const nodes = host.cmFormatNodes(cm.state, tree, range, "comment");
          changes = host.cmFormatRemove(cm.state, nodes, "comment");
        } else {
          if (range.empty) range = (word = cm.state.wordAt(range.from)) !== null && word !== undefined ? word : range;
          changes = host.cmFormatRemove(cm.state, range, "comment");
          changes.push({ from: range.from, to: range.from, insert: "%% " });
          changes.push({ from: range.to, to: range.to, insert: " %%" });
        }
        range = range.map(host.cmChangeSet.of(changes, cm.state.doc.length));
        if (!info.comment && range.empty) {
          range = host.cmSelection.cursor(range.anchor + 3, range.assoc, range.goalColumn, range.bidiLevel);
        }
        return { range, changes };
      });
      cm.dispatch(tr);
    },
    searchCursor(query) {
      const cm = this.cm;
      const self = this;
      const cursor = (from, to) => new host.SearchCursorImpl(cm.state.doc, query, from, to, (s) => s.toLowerCase());
      let from = cm.state.selection.main.from;
      let to = cm.state.selection.main.to;
      let current = null;
      const findBackward = (start, end) => {
        for (;;) {
          const windowStart = Math.max(start, end - 10000 - query.length);
          const it = cursor(windowStart, end);
          let last = null;
          while (!it.nextOverlapping().done) last = it.value;
          if (last) return last;
          if (windowStart === start) return null;
          end -= 10000;
        }
      };
      return {
        getIndexAndCount() {
          if (!current) return [0, 0];
          let index = 0;
          let count = 0;
          const pos = cmPosToOffset(cm.state.doc, current.to);
          const it = cursor();
          while (count < 9999 && !it.next().done) {
            if (it.value.from <= pos) index++;
            count++;
          }
          return [index, count];
        },
        current() { return current; },
        findPrevious() {
          current = null;
          const found = findBackward(0, from) || findBackward(from, cm.state.doc.length);
          if (!found) return null;
          const doc = cm.state.doc;
          from = found.from;
          to = found.to;
          current = { from: cmOffsetToPos(doc, found.from), to: cmOffsetToPos(doc, found.to) };
          return current;
        },
        findNext() {
          let result = cursor(to).nextOverlapping();
          if (result.done) result = cursor(0).nextOverlapping();
          if (result.done) {
            current = null;
            return null;
          }
          const found = result.value;
          const doc = cm.state.doc;
          from = found.from;
          to = found.to;
          current = { from: cmOffsetToPos(doc, found.from), to: cmOffsetToPos(doc, found.to) };
          return current;
        },
        replace(text, userEvent) {
          const cur = this.current();
          if (cur) self.replaceRange(text, cur.from, cur.to, userEvent);
        },
        findAll() {
          const it = cursor();
          const doc = cm.state.doc;
          const all = [];
          while (!it.next().done) {
            const found = it.value;
            all.push({ from: cmOffsetToPos(doc, found.from), to: cmOffsetToPos(doc, found.to) });
          }
          return all;
        },
        replaceAll(text, userEvent) {
          const changes = self.findAll().map((range) => ({ from: range.from, to: range.to, text }));
          self.transaction({ changes }, userEvent);
        },
      };
    },
    getClickableTokenAt(pos) {
      if (!pos) return null;
      const cm = this.cm;
      const doc = cm.state.doc;
      const tokens = [];
      const line = doc.line(pos.line + 1);
      let segmentStart = line.from;
      const tree = host.cmSyntaxTree(cm.state);
      tree.iterate({
        from: line.from,
        to: line.to,
        enter(node) {
          const classes = node.type.prop(host.cmSyntaxPropClasses);
          if (classes) {
            if (segmentStart < node.from) tokens.push({ type: "", from: segmentStart, to: node.from });
            tokens.push({ type: classes, from: node.from, to: node.to });
            segmentStart = node.to;
          }
        },
      });
      if (segmentStart < line.to) tokens.push({ type: "", from: segmentStart, to: line.to });
      const offset = cmPosToOffset(doc, pos);
      let index = -1;
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.from <= offset && token.to >= offset) {
          index = i;
          break;
        }
      }
      if (index < 0) return null;
      const text = (range) => doc.sliceString(range.from, range.to);
      let token = tokens[index];
      let classes = token.type;
      const parts = classes.split(" ");
      let tokenText = text(token);
      const isInternal = parts.contains("hmd-internal-link");
      const isFormatLink = parts.contains("formatting-link") && ["[[", "![[", "]]"].contains(tokenText);
      if (isInternal || isFormatLink) {
        let start = index - 1;
        while (start >= 0) {
          const type = tokens[start].type;
          if (!type || !type.contains("hmd-internal-link")) break;
          start--;
        }
        let end = index + 1;
        while (end < tokens.length) {
          const type = tokens[end].type;
          if (!type || !type.contains("hmd-internal-link")) break;
          end++;
        }
        let linkText = "";
        let linkStart = line.to;
        let linkEnd = line.from;
        for (let i = start + 1; i < end; i++) {
          const part = tokens[i];
          if (part.type.contains("hmd-internal-link")) {
            linkText += text(part);
            if (part.from < linkStart) linkStart = part.from;
            if (part.to > linkEnd) linkEnd = part.to;
          }
        }
        const parsed = host.parseLinkText(linkText);
        let path = parsed.path;
        const subpath = parsed.subpath;
        let displayText = parsed.displayText;
        if (host.mediaExtensions.contains(host.getExtension(path))) {
          if (host.isImageDimension(displayText)) displayText = "";
        }
        return { type: "internal-link", text: path + subpath, displayText, start: cmOffsetToPos(doc, linkStart), end: cmOffsetToPos(doc, linkEnd) };
      }
      if (parts.contains("link")) {
        let next = index + 1;
        while (next < tokens.length) {
          const part = tokens[next];
          if (!part || !part.type.split(" ").contains("link")) {
            if (part) {
              const partClasses = part.type.split(" ");
              if (partClasses.contains("string") && partClasses.contains("url")) break;
            }
            next = -1;
            break;
          }
          next++;
        }
        if (next > -1 && next < tokens.length) {
          index = next;
          classes = (token = tokens[next]).type;
          parts.length = 0;
          parts.push(...classes.split(" "));
        }
      }
      if (parts.contains("url")) {
        let url = text(token);
        if (url === "(" || url === "[") {
          url = text(token = tokens[index + 1]);
        } else if (url === ")" || url === "]") {
          url = text(token = tokens[index - 1]);
        }
        if (!token) return null;
        let type = "external-link";
        if (parts.contains("hmd-footref2")) {
          type = "external-ref-link";
        } else if (parts.contains("string")) {
          url = host.decodeExternalUrl(url);
          if (host.isInternalUrl(url)) {
            type = "internal-link";
            try {
              url = decodeURI(url);
            } catch (e) {
              return null;
            }
            url = host.trimSlashes(url).trim();
          }
        } else if (host.isEmailAddress(url)) {
          url = "mailto:" + url;
        } else if (!/^([a-z0-9+.-]+):/.test(url)) {
          url = "https://" + url;
        }
        if (type === "external-link") url = host.normalizeExternalUrl(url);
        return { type, text: url, start: cmOffsetToPos(doc, token.from), end: cmOffsetToPos(doc, token.to) };
      }
      if (parts.contains("hashtag")) {
        let tag = "";
        let tagStart = line.to;
        let tagEnd = line.from;
        for (let i = 0; i < tokens.length; i++) {
          const part = tokens[i];
          if (part.type && part.type.split(" ").contains("hashtag")) {
            tag += text(part);
            if (part.from < tagStart) tagStart = part.from;
            if (part.to > tagEnd) tagEnd = part.to;
          } else {
            if (!(i < index)) break;
            tag = "";
            tagStart = offset;
            tagEnd = offset;
          }
        }
        if (tag) {
          return { type: "tag", text: tag, start: cmOffsetToPos(doc, tagStart), end: cmOffsetToPos(doc, tagEnd) };
        }
      }
      if (parts.contains("blockid")) {
        return { type: "blockid", text: text(token), start: cmOffsetToPos(doc, token.from), end: cmOffsetToPos(doc, token.to) };
      }
      if (parts.contains("footref") && !parts.contains("inline-footnote")) {
        if (parts.contains("formatting-link-start")) token = tokens[index + 1];
        else if (parts.contains("formatting-link-end")) token = tokens[index - 1];
        return { type: "footref", text: text(token).toLowerCase(), start: cmOffsetToPos(doc, token.from - 2), end: cmOffsetToPos(doc, token.to + 1) };
      }
      return null;
    },
    insertFootnote() {
      return (async () => {
        const cm = this.cm;
        const component = this.editorComponent;
        const app = component.app;
        const owner = component.owner;
        const file = component.file;
        const cache = file ? app.metadataCache.getFileCache(file) : null;
        const marker = "[^" + host.nextFootnoteId(cache) + "]";
        const state = cm.state;
        const main = state.selection.main;
        const from = main.from;
        const to = main.to;
        const changes = [{ from, insert: marker }];
        const doc = state.doc;
        const trailing = doc.slice(to).toString().match(/\n*$/);
        const newlines = trailing[0].length;
        const gap = "\n".repeat(2 - Math.min(newlines, 2));
        changes.push({ from: doc.length, insert: gap + marker + ": \n" });
        cm.dispatch({ changes, selection: host.cmSelection.cursor(from + marker.length) });
        if (owner instanceof host.MarkdownView) {
          await owner.saveImmediately();
        } else if (owner instanceof host.EmbedFileView) {
          await owner.save(owner.text, true);
        } else {
          return;
        }
        await app.metadataCache.computeFileMetadataAsync(file);
        const node = cm.domAtPos(from + 1).node;
        const target = node instanceof HTMLElement ? node : node.parentElement;
        const rtl = getComputedStyle(target).direction === "rtl";
        const coords = cm.coordsAtPos(from);
        const popover = await host.HoverPopover.create({
          app,
          hoverParent: owner,
          targetEl: target,
          linktext: "#" + marker,
          sourcePath: file ? file.path : undefined,
          waitTime: 0,
          state: { mode: "source" },
          position: { x: coords[rtl ? "right" : "left"], y: (coords.top + coords.bottom) / 2 },
        });
        const embed = popover.embed;
        if (embed instanceof host.EmbedFileView) {
          embed.editMode.register(() => {
            const win = target.win;
            const doc = target.doc;
            win.setTimeout(() => {
              if (doc.activeElement === doc.body) this.focus();
            });
          });
        }
      })();
    },
  });

  // Static command table — the CM command functions stay inherited.
  EditorImpl.commands = {
    goUp: host.cmdGoUp,
    goDown: host.cmdGoDown,
    goLeft: host.cmdGoLeft,
    goRight: host.cmdGoRight,
    goStart: host.cmdGoStart,
    goEnd: host.cmdGoEnd,
    goWordLeft: host.cmdGoWordLeft,
    goWordRight: host.cmdGoWordRight,
    indentMore: host.cmdIndentMore,
    indentLess: host.cmdIndentLess,
    newlineAndIndent: host.cmdNewlineAndIndent,
    swapLineUp: host.cmdSwapLineUp,
    swapLineDown: host.cmdSwapLineDown,
    deleteLine: host.cmdDeleteLine,
    toggleFold(cm) {
      return host.cmFoldToggle(cm) || host.cmUnfoldToggle(cm);
    },
    foldAll: host.cmdFoldAll,
    unfoldAll: host.cmdUnfoldAll,
  };

  return EditorImpl;
}
