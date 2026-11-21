// g39 clean-room: live-preview formatting helpers (spec g39 part E), file 2.

function ng39Cls(node, host) {
  return node && node.type && typeof node.type.prop === "function"
    ? node.type.prop(host.cmSyntaxPropClasses) : null;
}

function ng39Tokens(cls) {
  return cls ? String(cls).split(/\s+/).filter(Boolean) : [];
}

export function ng39FormatLineRange(state, lineNo, host) {
  const line = state.doc.line(lineNo);
  let from = line.from;
  const to = line.to;
  try {
    host.cmSyntaxTree(state).iterate({
      from: line.from,
      to: line.to,
      enter(node) {
        const cls = ng39Cls(node, host);
        if (!cls) return undefined;
        const toks = ng39Tokens(cls);
        for (const m of ["hmd-list-indent", "formatting-quote", "formatting-list", "formatting-task", "formatting-header"]) {
          if (toks.indexOf(m) >= 0) {
            const e = Math.min(line.to, node.to);
            if (e > from) from = e;
            break;
          }
        }
        return undefined;
      },
    });
  } catch (e) { /* partial tree */ }
  return host.cmFormatSpan(state, { from, to });
}

export function ng39FormatInnerMark(state, pos, mark, dir) {
  const cands = [mark.surroundingChars];
  if (mark.altSurroundingChars != null) cands.push(mark.altSurroundingChars);
  for (const c of cands) {
    const len = c.length;
    const from = dir === -1 ? pos - len : pos;
    const to = dir === -1 ? pos : pos + len;
    if (state.sliceDoc(from, to) === c) return { from, to };
  }
  return null;
}

export function ng39FormatRemoveMarks(state, range, kind, host) {
  const mark = host.s91FormatMarks[kind];
  const edits = [];
  try {
    host.cmSyntaxTree(state).iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        const cls = ng39Cls(node, host);
        if (!cls) return undefined;
        const toks = ng39Tokens(cls);
        if (toks.indexOf("formatting") >= 0 && toks.indexOf(mark.nodeType) >= 0) {
          const inner = ng39FormatInnerMark(state, node.from, mark, 1);
          if (inner) edits.push({ from: inner.from, to: inner.to, insert: "" });
        }
        return undefined;
      },
    });
  } catch (e) { /* partial tree */ }
  return edits;
}
