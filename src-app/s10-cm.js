// s10 CodeMirror glue: the editor's fold-range providers, indent/dedent commands,
// cursor-motion commands, vim helpers, state fields/compartments and the hypermd
// language modes. Vendor CodeMirror 6 stays inherited; every dependency is reached
// through the host table or env().
import { s10LinePrefix, s10UnboundEditorKeys } from "./s10-consts.js";
import { s10ChangeByLineRange, s10RangeInTable } from "./s10-app.js";

// Matches the leading list marker of a line (used to keep the cursor out of the marker).
const s10ListLine = /^([>\s]*)(([*+-] |(\d+)([.)] ))(?:\[(.)\] )?)?/;

// countColumn: visual column of `e` up to `n` chars, expanding tabs to `t` columns.
function s10NextPos(e, r) {
  const code = e.charCodeAt(r);
  return code >= 0xd800 && code < 0xdbff && r + 1 < e.length ? r + 2 : r + 1;
}
function s10CountColumn(e, t, n) {
  if (n === undefined) n = e.length;
  let col = 0;
  for (let r = 0; r < n;) {
    if (e.charCodeAt(r) === 9) { col += t - (col % t); r++; }
    else { col++; r = s10NextPos(e, r); }
  }
  return col;
}

// Indent column of a line: -1 for blank lines, else the visual column of its first
// non-whitespace character.
function s10IndentColumnOf(host, e, t) {
  const n = t.text.search(/\S/);
  return n === -1 ? -1 : s10CountColumn(t.text.substr(0, n), e.facet(host.cmState.tabSize));
}

// Fold provider: folds the run of following lines that share the same indent.
function s10FoldIndentProvider(host, e, t, n) {
  try {
    const i = e.doc.lineAt(t);
    const r = s10IndentColumnOf(host, e, i);
    if (r < 0) return;
    let o = null;
    for (let a = i.number + 1, s = e.doc.lines; a <= s; ++a) {
      const l = e.doc.line(a);
      const c = s10IndentColumnOf(host, e, l);
      if (c === -1) continue;
      if (!(c > r)) break;
      o = l;
    }
    if (o) return { from: n, to: o.to };
  } catch (e) { console.error(e); }
  return null;
}

// Fold provider: folds ATX/setext headings with their section body.
function s10FoldHeadingProvider(host, e, t, n) {
  const { cmSyntaxTree: tp, cmSyntaxPropClasses: $d } = host;
  const i = tp(e);
  function r(line) {
    if (i.length < line.to) return true;
    const prop = i.resolve(line.from, 1).type.prop($d);
    return prop && /\bheader\b/.test(prop);
  }
  function o(line) {
    const m = line && line.text.match(/^\s*(#{1,6})(\s+|$)/);
    if (m && r(line)) return m[1].length;
    if (e.doc.lines <= line.number) return 100;
    const next = e.doc.line(line.number + 1);
    const setext = next.text.match(/^[=\-]+\s*$/);
    return setext && i.length >= next.to && r(next) ? (next.text[0] === "=" ? 1 : 2) : 100;
  }
  try {
    const a = e.doc.lines;
    const s = e.doc.lineAt(t);
    if (s.number === a) return null;
    const l = o(s);
    if (l === 100) return null;
    let c = e.doc.line(s.number + 1);
    let u = s.to;
    while (c && !(o(c) <= l) && c.number !== a) { u = c.to; c = e.doc.line(c.number + 1); }
    return u === s.to ? null : { from: s.to, to: u };
  } catch (e) { console.error(e); }
  return null;
}

// Fold provider: folds a --- frontmatter block.
function s10FoldFrontmatterProvider(host, e, t, n) {
  const i = e.doc.lineAt(t);
  if (i.text !== "---") return;
  for (let r = i.number - 1; r > 0; r--) if (e.doc.line(r).text.trim()) return;
  for (let o = e.doc.lines, a = i.number + 1; a <= o && e.doc.line(a).text !== "---";) a++;
  if (!(a > o)) return { from: t, to: e.doc.line(a).to };
}

// Editor field type that carries "set field" effects (used by the metadata editor).
let s10FieldSetFx = null;
export function s10FieldSetEffect(host) {
  if (!s10FieldSetFx) s10FieldSetFx = host.s10StateEffect.define();
  return s10FieldSetFx;
}

// Factory for the settable state fields (editor field, owner field, live-preview field).
export function s10MakeCmField(host) {
  return function (initial) {
    const field = host.cmStateField.define({
      create: () => initial,
      update(value, tr) {
        for (let i = 0; i < tr.effects.length; i++) {
          const ef = tr.effects[i];
          if (ef.is(host.fieldSetEffect) && ef.value.field === field) value = ef.value.value;
        }
        return value;
      },
    });
    return field;
  };
}

// "Move cursor/selection to line start" command factory (select flag chooses range vs cursor).
export function s10LineStartFactory(host) {
  const { cmSyntaxTree: tp, cmSelection: pe } = host;
  return function (select) {
    return function (view) {
      const n = view.state;
      const i = n.doc;
      const r = n.selection;
      const o = [];
      const a = tp(n);
      for (let s = 0; s < r.ranges.length; s++) {
        const c = r.ranges[s];
        const u = c.head;
        const h = c.anchor;
        const p = view.lineBlockAt(u);
        const d = !s10RangeInTable(a, c.from, c.to, host);
        let f = view.moveToLineBoundary(c, false, d);
        if (f.head === u && f.head !== p.from) f = view.moveToLineBoundary(c, false, false);
        const m = i.sliceString(p.from, p.to);
        const v = s10ListLine.exec(m);
        if (v && v[0] && f.head <= p.from + v[0].length) {
          const g = v[1];
          const y = g === undefined ? "" : g;
          const b = v[2];
          const w = b === undefined ? "" : b;
          const k = p.from + y.length + w.length;
          const C = k < u ? k : p.from;
          f = pe.cursor(C);
        }
        if (select) o.push(pe.range(h, f.head, f.goalColumn));
        else o.push(f);
      }
      view.dispatch({ selection: pe.create(o, r.mainIndex), scrollIntoView: true });
      return true;
    };
  };
}

// "Move cursor/selection to line end" command factory.
export function s10LineEndFactory(host) {
  const { cmSyntaxTree: tp, cmSelection: pe } = host;
  return function (select) {
    return function (view) {
      const n = view.state.selection;
      const i = [];
      const r = tp(view.state);
      for (let o = 0; o < n.ranges.length; o++) {
        const s = n.ranges[o];
        const l = s.head;
        const c = s.anchor;
        const u = view.lineBlockAt(l);
        const h = !s10RangeInTable(r, s.from, s.to, host);
        let p = view.moveToLineBoundary(s, true, h);
        if (p.head === l && p.head !== u.from) p = view.moveToLineBoundary(s, true, false);
        if (select) i.push(pe.range(c, p.head, p.goalColumn));
        else i.push(p);
      }
      view.dispatch({ selection: pe.create(i, n.mainIndex), scrollIntoView: true });
      return true;
    };
  };
}

// ---------------------------------------------------------------- manifest factories

export function s10FilteredKeymap(host) {
  return host.s10DefaultKeymap.filter((e) => !s10UnboundEditorKeys.has(e.key));
}

export function s10IndentColumn(host) {
  return (e, t) => s10IndentColumnOf(host, e, t);
}

export function s10FoldIndent(host) {
  return host.s10FoldService.of((e, t, n) => s10FoldIndentProvider(host, e, t, n));
}

export function s10FoldHeading(host) {
  return host.s10FoldService.of((e, t, n) => s10FoldHeadingProvider(host, e, t, n));
}

export function s10FoldFrontmatter(host) {
  return host.s10FoldService.of((e, t, n) => s10FoldFrontmatterProvider(host, e, t, n));
}

export function s10LastInsertPlugin(host) {
  return host.cmViewPlugin.define(() => ({ lastInsert: "" }));
}

export function s10DashInputHandler(host) {
  const plugin = host.s10LastInsertPlugin;
  return host.CMEditorView.inputHandler.of((e, t, n, i) => {
    if (e.compositionStarted || e.state.readOnly) return false;
    if (t === n) {
      const r = e.plugin(plugin);
      const o = r.lastInsert === "-" && i === "—" && e.state.doc.lineAt(t).from === t;
      r.lastInsert = i;
      if (o) {
        e.dispatch({ changes: [{ insert: "--", from: t }], selection: { anchor: t + 2 }, userEvent: "input.type" });
        return true;
      }
    }
    return false;
  });
}

export function s10CmdGoStart(host) {
  return (e) => {
    const t = e.state;
    e.dispatch(t.update({ selection: { anchor: 0 }, scrollIntoView: true }));
    return true;
  };
}

export function s10CmdFoldAll(host) {
  const { cmFoldableRange: Hp, cmFoldEffect: qp } = host;
  return (e) => {
    host.s10EnsureSyntaxTree(e, e.state.doc.length, 5000);
    const t = e.state;
    const n = [];
    for (let i = 1; i <= t.doc.lines; i++) {
      const r = t.doc.line(i);
      const o = Hp(t, r.from, r.to);
      if (o) n.push(qp.of(o));
    }
    for (let a = 0; a < t.doc.length;) {
      const r = e.lineBlockAt(a);
      a = r.to + 1;
    }
    if (n.length) e.dispatch({ effects: n });
    return !!n.length;
  };
}

export function s10CmdIndentMore(host) {
  const { cmIndentUnit: yp } = host;
  return (e) => {
    const t = e.state;
    const n = e.dispatch;
    if (t.readOnly) return false;
    n(t.update(s10ChangeByLineRange(t, (line, changes) => {
      let i = line.from;
      const r = line.text.match(s10LinePrefix);
      if (r) {
        const o = r[0].lastIndexOf(">");
        if (o !== -1) {
          if (r[0].charAt(o + 1) === " ") o++;
          i = i + o + 1;
        }
      }
      changes.push({ from: i, insert: t.facet(yp) });
    }, host), { userEvent: "input.indent" }));
    return true;
  };
}

export function s10CmdIndentLess(host) {
  return (e) => {
    const t = e.state;
    const n = e.dispatch;
    if (t.readOnly) return false;
    n(t.update(s10ChangeByLineRange(t, (line, changes) => {
      const i = line.text.match(s10LinePrefix);
      if (i) {
        const r = i[0];
        const o = r.indexOf(">");
        if (o > 0) changes.push({ from: line.from, to: line.from + o, insert: "" });
        else if (r !== "> ") {
          const a = r.lastIndexOf(">");
          let at = a;
          if (a !== -1 && r.charAt(a + 1) === " ") at++;
          const s = at + 1;
          const l = r.substr(s);
          if (l) {
            const c = s10CountColumn(l, t.tabSize);
            const h = host.s10IndentString(t, Math.max(0, c - host.s10GetIndentUnit(t)));
            let u = 0;
            while (u < l.length && u < h.length && l.charCodeAt(u) === h.charCodeAt(u)) u++;
            changes.push({ from: line.from + s + u, to: line.from + r.length, insert: h.slice(u) });
          }
        }
      }
    }, host), { userEvent: "delete.dedent" }));
    return true;
  };
}

export function s10MakeCmFieldFactory(host) {
  return s10MakeCmField(host);
}

export function s10EditorField(host) {
  return s10MakeCmField(host)(null);
}

export function s10OwnerField(host) {
  return s10MakeCmField(host)(null);
}

export function s10LivePreviewField(host) {
  return s10MakeCmField(host)(false);
}

export function s10MouseSelectionStyle(host) {
  const { cmSelection: pe } = host;
  return host.CMEditorView.mouseSelectionStyle.of((e, t) => {
    if (t.detail !== 3 || t.button !== 0) return null;
    const n = e.posAtCoords(t);
    if (n == null) return null;
    const i = e.state.selection;
    return {
      get(t2, r, o) {
        const a = e.posAtCoords(t2);
        if (a == null) return i;
        const s = r ? i.main.anchor : n;
        const l = e.state.doc.lineAt(s);
        const c = e.state.doc.lineAt(a);
        const u = a >= s ? pe.range(l.from, c.to) : pe.range(l.to, c.from);
        return o ? i.addRange(u) : pe.create([u]);
      },
      update(e2) {
        n = e2.changes.mapPos(n);
        i = i.map(e2.changes);
      },
    };
  });
}

export function s10HypermdMode(host) {
  return host.s10StreamLanguage.define(CodeMirror.getMode({}, { name: "hypermd" }));
}

export function s10TableCellMode(host) {
  return host.s10StreamLanguage.define(CodeMirror.getMode({}, {
    name: "hypermd",
    front_matter: false, table: false, fencedCodeBlockHighlighting: false,
    taskLists: false, headers: false, blockquotes: false, indentedCode: false,
    lists: false, hr: false, blockId: false,
  }));
}

export function s10CompartmentOf(comp, exts) {
  return comp.of(exts);
}
