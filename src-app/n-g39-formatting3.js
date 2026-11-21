// g39 clean-room: live-preview formatting helpers (spec g39 part E), file 3 —
// expand a range to the full run of same-mark nodes.
import { ng39FormatInnerMark } from "./n-g39-formatting2.js";

function ng39NodeCls(node, host) {
  return node && node.type && typeof node.type.prop === "function"
    ? node.type.prop(host.cmSyntaxPropClasses) : "";
}

export function ng39FormatNodeRange(state, cursor, range, kindIndex, host) {
  const mark = host.s91FormatMarks[kindIndex];
  const isMarkNode = (node) => {
    const cls = ng39NodeCls(node, host);
    return cls && String(cls).split(/\s+/).indexOf(mark.nodeType) >= 0;
  };
  let from = range.from;
  let to = range.to;

  host.cmFormatSeek(cursor, from);
  for (;;) {
    const node = cursor.node;
    if (!node || !isMarkNode(node)) break;
    const inner = ng39FormatInnerMark(state, cursor.from, mark, 1);
    if (inner) from = cursor.from;
    if (!cursor.prevSibling()) break;
  }

  host.cmFormatSeek(cursor, to);
  for (;;) {
    const node = cursor.node;
    if (!node || !isMarkNode(node)) break;
    const inner = ng39FormatInnerMark(state, cursor.to, mark, -1);
    if (inner) to = cursor.to;
    if (!cursor.nextSibling()) break;
  }

  return { from, to };
}
