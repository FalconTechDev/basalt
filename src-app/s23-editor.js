// s23 — own replacements for the inherited editor-extension items:
//   gj  EditorSearchBar        (in-document find/replace bar, extends the s08 SearchBarBase)
//   wq  table-sync filter      (keeps wrapped table rows on their own lines)
//   Mq  list-renumber filter   (renumbers ordered lists after edits)
//   Eq  list/block break regex used by the renumber filter
//   Sq  leading list-marker extractor used by the indent plugin
//   xq  "inside code block" syntax-tree probe used by the indent plugin
//   Tq  hanging-indent decoration plugin for list markers
//   Dq  the CodeMirror view plugin wrapping Tq
//   fj  input handler that wraps a selection in = ~ $ % pairs
//   dj  the pair characters used by fj
//   aj  the search-match highlight mark decoration
//   mj  the search-match highlight class name
// Vendor CodeMirror/Lezer internals stay inherited and are reached through the
// host table or env(); nothing here copies minified source.
import { env } from "./env.js";
import { s08SearchBarBase } from "./s08-values.js";
import { countQuoteMarks, quoteIndentDepth } from "./text.js";
import { distinct } from "./misc.js";

/** Numeric comparator for line numbers (was `pb`, already own as s04NumberCompare). */
function s23NumCompare(a, b) { return a - b; }

// ---------------------------------------------------------------- small helpers

/** Code point at `index`, surrogate-pair aware (was `Z`). */
function s23CodePointAt(text, index) {
  const first = text.charCodeAt(index);
  if (first >= 0xd800 && first < 0xdc00 && index + 1 !== text.length) {
    const second = text.charCodeAt(index + 1);
    if (second >= 0xdc00 && second < 0xe000) return second - 0xdc00 + ((first - 0xd800) << 10) + 0x10000;
  }
  return first;
}

/** UTF-16 length of a code point (was `ee`). */
function s23Utf16Size(cp) { return cp < 0x10000 ? 1 : 2; }

/** Advance one code point (was `$` as used by the column counter). */
function s23NextUnit(text, index) {
  const cp = text.charCodeAt(index);
  return cp >= 0xd800 && cp < 0xdc00 && index + 1 < text.length ? index + 2 : index + 1;
}

/** Visual column of `text` up to `end`, expanding tabs (was `wt`). */
function s23CountColumn(text, tabSize, end) {
  if (end === undefined) end = text.length;
  let col = 0;
  for (let i = 0; i < end;) {
    if (text.charCodeAt(i) === 9) { col += tabSize - (col % tabSize); i++; }
    else { col++; i = s23NextUnit(text, i); }
  }
  return col;
}

/** True when any transaction carries an effect of `type` (was `VA`). */
function s23HasEffect(transactions, type) {
  return transactions.some((tr) => tr.effects.some((ef) => ef.is(type)));
}

/** Ordered/unordered list marker, block quote or heading prefix, hr or fence (was `Eq`). */
export const s23BreakPattern = /^\s*(?:> |#{1,6} |([-_*])(\s*\1){2,}\s*$|~~~|```)/;

/** Characters that wrap the current selection when typed (was `dj`). */
export const s23WrapPairChars = ["=", "~", "$", "%"];

/** Class name marking search matches in the editor (was `mj`). */
export const s23SearchMatchClass = "basalt-search-match-highlight";

// ---------------------------------------------------------------- list helpers

/** The leading list marker of a line, or null (was `Sq`). */
export function s23ListMarker(text, host) {
  const m = host.listLinePattern.exec(text);
  return m && m[0] ? m[0] : null;
}

function s23ListMarkerOf(host, text) { return s23ListMarker(text, host); }

/** Whether [from,to) of the syntax tree sits inside a code block (was `xq`). */
export function s23InsideCode(tree, from, to, host) {
  let inside = false;
  tree.iterate({
    from, to,
    enter(node) {
      const cls = node.type.prop(host.livePreviewSyntaxClasses);
      if (cls && cls.contains("HyperMD-codeblock")) inside = true;
      const prop = node.type.prop(host.cmSyntaxPropClasses);
      if (prop && prop.contains("hmd-indented-code")) inside = true;
    },
  });
  return inside;
}

function s23InsideCodeOf(host, tree, from, to) { return s23InsideCode(tree, from, to, host); }

// ---------------------------------------------------------------- wq: table sync

/**
 * Transaction filter keeping multi-line table rows intact: after an edit it
 * inserts a line break after a table-widget range when the line above the
 * mapped position is not blank (was `wq`).
 */
export function s23TableSync(editor, field, host) {
  const { cmState: nt, tableUpdateAnnotation: yq, tableWidget: bq, cmSelection: pe } = host;
  const frontmatterEnd = host.s23FrontmatterEnd;
  const Transaction = host.s23Transaction;

  // delete.backward: splitting a table row at the caret deletes the row
  // separator and moves the caret into the joined line instead.
  function splitBackward(tr, ranges) {
    const changes = [], cursors = [];
    const doc = tr.startState.doc, selection = tr.selection;
    let split = false;
    tr.changes.iterChanges(function (fromA, toA, fromB, toB, inserted) {
      let target = null;
      if (toB === fromB && fromA + 1 === toA && inserted.length === 0) {
        ranges.between(fromA - 1, toA + 1, function (f, t) {
          if (t === fromA) {
            const a = host.Platform.isAndroidApp && f > 0 ? f - 1 : f;
            target = pe.range(toA, a);
            return false;
          }
          if (f === toA + 1 && doc.lineAt(toA - 1).text.trim() !== "") {
            target = pe.cursor(fromA);
            changes.push({ from: fromA, to: toA, insert: "\n" });
            return false;
          }
        });
      }
      if (target) { split = true; cursors.push(target); }
      else { changes.push({ from: fromA, to: toA, insert: inserted }); cursors.push(pe.cursor(fromA)); }
    });
    return split
      ? { changes, selection: pe.create(cursors, selection.mainIndex), annotations: [Transaction.userEvent.of("delete.backward"), yq.of(true)] }
      : tr;
  }

  // other edits: a table widget that ends up sharing a line with text above
  // gets a fresh line break inserted at its start.
  function syncBreaks(tr, ranges) {
    const changes = [], doc = tr.newDoc, fmEnd = frontmatterEnd(doc);
    tr.changes.iterChanges(function (fromA, toA) {
      ranges.between(fromA, toA + 1, function (pos) {
        if (toA <= pos && fromA !== fmEnd) {
          const mapped = tr.changes.mapPos(pos);
          if (mapped > 0 && doc.lineAt(mapped - 1).text.trim() !== "") {
            changes.push({ insert: "\n", from: mapped });
            return false;
          }
        }
      });
    });
    return changes.length ? [tr, { annotations: [yq.of(true)], changes, sequential: true }] : tr;
  }

  return nt.transactionFilter.of(function (tr) {
    if (!tr.docChanged || editor.tableCell || tr.isUserEvent("set") || tr.annotation(yq) || editor.cm.composing) return tr;
    const ranges = tr.startState.field(field).update({
      filter: function (state, from, spec) { return spec.widget instanceof bq; },
    });
    if (ranges.size === 0) return tr;
    return tr.isUserEvent("delete.backward") ? splitBackward(tr, ranges) : syncBreaks(tr, ranges);
  });
}

// ---------------------------------------------------------------- Mq: list renumber

/**
 * Transaction filter renumbering ordered lists after edits (was `Mq`).
 * `aP` is the list-line pattern; `FA` the range-overlap test.
 */
export function s23ListRenumber(editor, host) {
  const { cmState: nt, tableUpdateAnnotation: yq, listLinePattern: aP, cmRangeContains: FA } = host;

  // Previous ordered-list number at the same quote/indent level, or null.
  function prevNumber(doc, lineNo, ind, depth, match) {
    let found = null, blocked = false;
    for (let s = lineNo - 1; s >= 1; s--) {
      const line = doc.line(s), m = match(line.text), q = countQuoteMarks(m[1]);
      if (line.text && line.text !== m[1]) {
        if (m[0]) {
          if (m[2]) {
            const h = quoteIndentDepth(m[1]);
            if (h === ind && q === depth) { if (m[4]) found = parseInt(m[4], 10); break; }
            if (h < ind || q < depth) break;
          } else blocked = true;
        } else {
          if (depth || s23BreakPattern.test(line.text)) break;
          blocked = true;
        }
      } else if (depth > q || blocked) break;
    }
    return found;
  }

  // Number the contiguous block above `lineNo` should continue from (>= 1).
  function blockBase(doc, lineNo, ind, depth, match) {
    let num = 1, blocked = false;
    for (let s = lineNo; s >= 1; s--) {
      const line = doc.line(s);
      if (line.text) {
        const m = match(line.text);
        if (m[0]) {
          if (m[2]) {
            const h = quoteIndentDepth(m[1]), q = countQuoteMarks(m[1]);
            if (h === ind && q === depth && m[4]) num = parseInt(m[4], 10);
            if (h < ind || q < depth) break;
          } else blocked = true;
        } else {
          if (depth || s23BreakPattern.test(line.text)) break;
          blocked = true;
        }
      } else if (depth || blocked) break;
    }
    return num;
  }

  return nt.transactionFilter.of(function (tr) {
    if (!tr.docChanged || editor.tableCell || tr.isUserEvent("set") || tr.isUserEvent("input.renumber") || tr.annotation(yq) || editor.cm.composing) return tr;
    const newDoc = tr.newDoc, oldDoc = tr.startState.doc;
    const cache = new Map();
    const match = (text) => {
      if (cache.has(text)) return cache.get(text);
      const m = aP.exec(text);
      cache.set(text, m);
      return m;
    };
    const changes = [], visited = new Set(), ranges = [], lineNos = [];
    tr.changes.iterChangedRanges(function (fromA, toA, fromB, toB) {
      ranges.push({ from: fromB, to: toB });
      for (let n = newDoc.lineAt(fromB).number; n <= newDoc.lineAt(toB).number + 1; n++) lineNos.push(n);
    });
    const sorted = distinct(lineNos).sort(s23NumCompare);

    function visitLine(line) {
      if (visited.has(line.number)) return;
      visited.add(line.number);
      const m = match(line.text);
      if (!(m && m[0] && m[4])) return;
      const prefix = m[1], ind = quoteIndentDepth(prefix), depth = countQuoteMarks(prefix), suffix = m[5];
      let num = prevNumber(newDoc, line.number, ind, depth, match);
      if (num === null) {
        num = 1;
        let edited = false;
        for (const range of ranges) {
          if (FA(range, line.from, line.to)) {
            const mappedEnd = tr.changes.invertedDesc.mapPos(line.to);
            const om = match(oldDoc.lineAt(mappedEnd).text);
            if (!om || om[2] !== m[2]) { edited = true; break; }
          }
        }
        if (edited) num = parseInt(m[4], 10);
        else {
          const mappedEnd = tr.changes.invertedDesc.mapPos(line.to);
          const om = match(oldDoc.lineAt(mappedEnd).text);
          if (om && quoteIndentDepth(om[1]) === ind) {
            num = blockBase(oldDoc, oldDoc.lineAt(mappedEnd).number, ind, countQuoteMarks(om[1]), match);
          }
        }
      } else num++;
      if (String(num) !== m[4]) changes.push({ insert: num + suffix, from: line.from + prefix.length, to: line.from + prefix.length + m[3].length });
      let blank = false;
      for (let n = line.number + 1; n <= newDoc.lines && !visited.has(n); n++) {
        const l = newDoc.line(n);
        if (l.text) {
          const m2 = match(l.text);
          if (m2 && m2[0]) {
            const ind2 = quoteIndentDepth(m2[1]), depth2 = countQuoteMarks(m2[1]);
            if (!m2[1] || m2[2]) {
              if (ind2 === ind && depth2 === depth) {
                if (!m2[4]) break;
                num++;
                if (String(num) === m2[4]) { visited.add(n); break; }
                changes.push({ insert: num + m2[5], from: l.from + m2[1].length, to: l.from + m2[1].length + m2[3].length });
                visited.add(n);
              }
              if (ind2 < ind) break;
            }
          }
        } else if (blank || s23BreakPattern.test(l.text)) break;
        else blank = true;
      }
    }

    for (const n of sorted) { if (n <= newDoc.lines) visitLine(newDoc.line(n)); }
    return changes.length ? [tr, { changes, sequential: true, userEvent: "input.renumber" }] : tr;
  });
}

// ---------------------------------------------------------------- Tq/Dq: list indent decorations

let s23IndentClass = null;

/** The hanging-indent decoration plugin class (was `Tq`). */
export function s23ListIndentClass(host) {
  if (s23IndentClass) return s23IndentClass;
  const { cmDecoration: Vn, cmSyntaxTree: tp } = host;
  const schedule = host.s23ScheduleFrame;
  const builder = host.s23RangeSetBuilder;
  const StateEffect = host.s10StateEffect;
  const direction = host.textDirectionEnum;

  class ListIndent {
    constructor(view) {
      this.decorations = Vn.none;
      this.indentCache = new Map();
      this.markCache = new Map();
      this.requestUpdateDom = schedule(this.updateDom.bind(this));
      this.view = view;
      this.observer = new MutationObserver((muts) => this.checkMutations(muts));
      this.observe();
      this.buildDeco(view);
    }
    destroy() { this.observer.disconnect(); }
    update(tr) {
      const cache = this.indentCache;
      if (s23HasEffect(tr.transactions, ListIndent.clearCache)) { cache.clear(); this.markCache.clear(); }
      if (tr.docChanged || tr.viewportChanged || tr.geometryChanged || tr.selectionSet || tr.focusChanged || this.tree !== tp(tr.view.state)) {
        this.buildDeco(tr.view);
        this.requestUpdateDom();
      }
    }
    buildDeco(view) {
      const cache = this.indentCache, charW = view.defaultCharacterWidth;
      const set = new builder(), marks = this.markCache;
      const tree = tp(view.state);
      this.tree = tree;
      for (const block of view.viewportLineBlocks) {
        const line = view.state.doc.lineAt(block.from), num = line.number;
        const marker = s23ListMarkerOf(host, line.text);
        if (marker && !s23InsideCodeOf(host, tree, line.from, line.from + marker.length)) {
          let info = this.getCached(num, marker);
          if (!info) info = { text: marker, size: Math.floor(s23CountColumn(marker, view.state.tabSize) * charW), dirty: false };
          const size = info.size;
          if (size > 0) {
            let deco = marks.get(size);
            if (!deco) {
              deco = Vn.line({ attributes: { style: "text-indent:" + (-size) + "px;padding-inline-start:" + size + "px" } });
              marks.set(size, deco);
            }
            set.add(line.from, line.from, deco);
          }
        } else cache.delete(num);
      }
      this.decorations = set.finish();
    }
    observe() {
      this.observer.observe(this.view.contentDOM, { subtree: true, childList: true, characterData: true });
    }
    checkMutations(mutations) {
      const view = this.view, node = view.contentDOM, touched = new Set();
      for (const mut of mutations) {
        let target = mut.target;
        while (target.parentNode && target.parentNode !== node) target = target.parentNode;
        if (target && node.contains(target)) touched.add(target);
      }
      let dirty = false;
      for (const el of Array.from(touched)) {
        if (el.instanceOf(HTMLElement) && el.hasClass("cm-line")) {
          const pos = view.posAtDOM(el), line = view.state.doc.lineAt(pos);
          const info = this.indentCache.get(line.number);
          if (info) { info.dirty = true; dirty = true; }
        }
      }
      if (dirty) this.requestUpdateDom();
    }
    getCached(lineNo, text) {
      const cache = this.indentCache, own = cache.get(lineNo);
      if (own && own.text === text) return own;
      const prev = cache.get(lineNo - 1);
      if (prev && prev.text === text) return prev;
      const next = cache.get(lineNo + 1);
      if (next && next.text === text) return next;
      return own && own.text.length === text.length ? own : null;
    }
    updateDom() {
      const scheduled = this.requestUpdateDom, scroller = this.view.scrollDOM;
      this.view.coordsAtPos(0);
      const top = scroller.scrollTop;
      try {
        this.requestUpdateDom = function () {};
        Object.defineProperty(scroller, "scrollTop", { configurable: true, get: function () { return top; }, set: function () { return 0; } });
        const records = this.observer.takeRecords();
        this.observer.disconnect();
        if (records.length > 0) this.checkMutations(records);
        this.updateDomInternal();
      } finally {
        this.requestUpdateDom = scheduled;
        this.observe();
        delete scroller.scrollTop;
      }
    }
    updateDomInternal() {
      const view = this.view, cache = this.indentCache, node = view.contentDOM;
      if (!node.offsetParent) return;
      const tree = this.tree, redo = [];
      for (const child of Array.from(node.childNodes)) {
        if (child.instanceOf(HTMLElement) && child.hasClass("cm-line") && child.contentEditable !== "false") {
          const pos = view.posAtDOM(child), line = view.state.doc.lineAt(pos);
          if (tree.length < line.to) break;
          const marker = s23ListMarkerOf(host, line.text);
          if (marker && !s23InsideCodeOf(host, tree, line.from, line.from + marker.length)) {
            const info = cache.get(line.number);
            if (!(info && info.text === marker && !info.dirty)) redo.push({ lineEl: child, pos: line.from, line: line.number, text: marker });
          }
        }
      }
      if (redo.length === 0) return;
      for (const r of redo) { r.lineEl.style.textIndent = ""; r.lineEl.style.paddingInlineStart = ""; }
      const apply = [];
      let dirty = false;
      for (const r of redo) {
        const lineEl = r.lineEl, pos = r.pos, marker = r.text;
        let end = view.coordsAtPos(pos + marker.length, 1);
        if (end) {
          const dir = view.textDirectionAt(pos);
          const rect = lineEl.getBoundingClientRect(), cs = getComputedStyle(lineEl);
          let edge = dir === direction.LTR ? rect.left + parseFloat(cs.borderLeft) : rect.right - parseFloat(cs.borderRight);
          let size = Math.floor(Math.abs((dir === direction.LTR ? end.right : end.left) - edge));
          if (size && size > lineEl.offsetWidth / 2) {
            end = view.coordsAtPos(pos + marker.length, -1);
            if (!end) continue;
            size = Math.floor(Math.abs((dir === direction.LTR ? end.right : end.left) - edge));
          }
          if (size) {
            const info = cache.get(r.line);
            if (info && info.size === size) { info.text = marker; info.dirty = false; }
            else { cache.set(r.line, { text: marker, size, dirty: false }); dirty = true; }
            apply.push({ lineEl, size });
          }
        }
      }
      for (const a of apply) {
        a.lineEl.style.textIndent = "" + (-a.size) + "px";
        a.lineEl.style.paddingInlineStart = "" + a.size + "px";
      }
      if (dirty) this.buildDeco(view);
    }
  }
  ListIndent.clearCache = StateEffect.define();
  s23IndentClass = ListIndent;
  return ListIndent;
}

/** The CodeMirror view plugin exposing the indent decorations (was `Dq`). */
export function s23ListIndentPlugin(host) {
  const Cls = s23ListIndentClass(host);
  return host.cmViewPlugin.define(function (view) { return new Cls(view); }, {
    decorations: function (plugin) { return plugin.decorations; },
  });
}

// ---------------------------------------------------------------- fj: wrap-pair input

/** Input handler wrapping the selection in = ~ $ % when one is typed (was `fj`). */
export function s23WrapPairInput(host) {
  const pe = host.cmSelection;
  return host.CMEditorView.inputHandler.of(function (view, from, to, text) {
    if (view.composing || view.state.readOnly) return false;
    const main = view.state.selection.main;
    if (text.length > 2 || text.length === 2 && s23Utf16Size(s23CodePointAt(text, 0)) === 1 || from !== main.from || to !== main.to) return false;
    if (s23WrapPairChars.indexOf(text) < 0) return false;
    const state = view.state;
    let emptyPos = null;
    const tr = state.changeByRange(function (range) {
      return range.empty
        ? { range: (emptyPos = range) }
        : { changes: [{ insert: text, from: range.from }, { insert: text, from: range.to }], range: pe.range(range.anchor + text.length, range.head + text.length) };
    });
    if (emptyPos) return { value: false };
    view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: "input.type" }));
    return { value: true };
  });
}

// ---------------------------------------------------------------- aj/mj: search match mark

/** The mark decoration for editor search matches (was `aj`). */
export function s23SearchMatchMark(host) {
  return host.cmDecoration.mark({ class: s23SearchMatchClass });
}

// ---------------------------------------------------------------- gj: EditorSearchBar

/** The in-document find/replace bar (was `gj`); extends the s08 SearchBarBase. */
export function s23EditorSearchBar(host) {
  const Base = s08SearchBarBase(host);
  class EditorSearchBar extends Base {
    constructor(editor, containerEl, applyScope) {
      super(containerEl);
      this.editor = null;
      this.cursor = null;
      this.isActive = false;
      this.isReplace = false;
      this.requestUpdateCount = env().debounce(this.updateCount.bind(this), 20, true);
      this.editor = editor;
      this.applyScope = applyScope;
      const self = this;
      this.searchButtonContainerEl.createEl("button", { cls: "clickable-icon document-search-button" }, (btn) => {
        host.tv(btn, "lucide-text-select");
        host.Mv(btn, host.gm.editor.search.labelFindAll() + "\n" + host.Rb(host.Fb(["Alt"], "Enter")), { placement: "top" });
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.addEventListener("click", (e) => { e.preventDefault(); self.searchAll(); });
      });
      const replaceWrap = this.searchContainerEl.createDiv("document-replace");
      this.replaceInputEl = replaceWrap.createEl("input", { cls: "document-replace-input", type: "text" });
      this.replaceInputEl.setAttribute("placeholder", host.gm.editor.search.placeholderReplace());
      const btns = replaceWrap.createDiv({ cls: "document-replace-buttons", type: "text" });
      btns.createEl("button", { cls: "clickable-icon document-search-button" }, (btn) => {
        host.tv(btn, "lucide-replace");
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.addEventListener("click", (e) => { e.preventDefault(); self.replaceCurrentMatch(); });
        host.Mv(btn, host.gm.editor.search.labelReplace() + "\n" + host.Rb(host.Fb([], "Enter")), { placement: "top" });
      });
      btns.createEl("button", { cls: "clickable-icon document-search-button" }, (btn) => {
        host.tv(btn, "lucide-replace-all");
        host.Mv(btn, host.gm.editor.search.labelReplaceAll() + "\n" + host.Rb(host.Fb(["Mod", "Alt"], "Enter")), { placement: "top" });
        btn.addEventListener("mousedown", (e) => e.preventDefault());
        btn.addEventListener("click", (e) => { e.preventDefault(); self.replaceAll(); });
      });
      this.scope.register(["Alt"], "Enter", this.onAltEnter.bind(this));
      this.scope.register(["Mod", "Alt"], "Enter", this.onModAltEnter.bind(this));
    }
    show(showReplace = false) {
      this.isActive = true;
      this.isReplace = showReplace;
      const containerEl = this.containerEl, searchContainerEl = this.searchContainerEl, editor = this.editor, searchInputEl = this.searchInputEl;
      searchContainerEl.toggleClass("mod-replace-mode", showReplace);
      containerEl.prepend(searchContainerEl);
      const sel = editor.getSelection();
      if (sel) searchInputEl.value = sel;
      searchInputEl.focus();
      searchInputEl.select();
      this.applyScope(this.scope);
      this.onSearchInput();
    }
    hide() {
      if (!this.isActive) return;
      this.isActive = false;
      const editor = this.editor, searchContainerEl = this.searchContainerEl, searchInputEl = this.searchInputEl;
      if (this.cursor && (searchInputEl.isActiveElement() || this.replaceInputEl.isActiveElement())) {
        const cur = this.cursor.current();
        if (cur) editor.setSelection(cur.from, cur.to);
      }
      searchContainerEl.detach();
      searchInputEl.value = "";
      searchInputEl.removeClass("mod-no-match");
      this.cursor = null;
      editor.removeHighlights(s23SearchMatchClass);
      this.applyScope(null);
      editor.focus();
    }
    updateCount() {
      let index = 0, count = 0;
      const query = this.getQuery();
      if (this.cursor && query) {
        const pair = this.cursor.getIndexAndCount();
        index = pair[0]; count = pair[1];
      }
      this.countEl.toggle(!!query);
      this.countEl.setText(index + " / " + count);
    }
    onSearchInput() {
      const query = this.getQuery();
      this.cursor = this.editor.searchCursor(query);
      const first = query ? this.cursor.findNext() : null;
      if (first) this.highlight([first]); else this.clear();
      this.searchInputEl.toggleClass("mod-no-match", !!query && !first);
      this.requestUpdateCount();
    }
    findPrevious() {
      if (!this.cursor) return;
      const prev = this.cursor.findPrevious();
      if (prev) this.highlight([prev]); else this.clear();
      this.requestUpdateCount();
    }
    findNextOrReplace() {
      if (!this.cursor) return;
      const replacement = this.replaceInputEl.value;
      if (this.replaceInputEl.isActiveElement() && replacement !== "") this.cursor.replace(replacement, "searchReplace");
      this.findNext();
    }
    replaceCurrentMatch() {
      if (!this.cursor) return;
      this.cursor.replace(this.replaceInputEl.value, "searchReplace");
      this.findNext();
    }
    replaceAll() {
      this.cursor.replaceAll(this.replaceInputEl.value, "searchReplace");
    }
    findNext() {
      if (!this.cursor) return;
      const next = this.cursor.findNext();
      if (next) this.highlight([next]); else this.clear();
      this.requestUpdateCount();
    }
    searchAll() {
      const all = this.cursor.findAll();
      this.highlight(all);
    }
    highlight(ranges) {
      this.editor.addHighlights(ranges, s23SearchMatchClass, true, true);
      const first = ranges[0];
      if (first) this.editor.scrollIntoView(first, true);
    }
    clear() {
      this.editor.removeHighlights(s23SearchMatchClass);
    }
    onAltEnter() {
      if (this.searchInputEl.isActiveElement() || this.replaceInputEl.isActiveElement()) this.searchAll();
    }
    onModAltEnter() {
      if (this.isReplace && this.replaceInputEl.isActiveElement()) this.replaceAll();
    }
  }
  return EditorSearchBar;
}
