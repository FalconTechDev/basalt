// g39 clean-room: markdown format detection over the syntax tree (spec g39
// part D). env() lookups stay lazy inside functions.
import { env } from "./env.js";

export const ng39S90FormatSpecs = {
  bold: { nodeType: "strong", surroundingChars: "**", altSurroundingChars: "__" },
  italic: { nodeType: "em", surroundingChars: "*", altSurroundingChars: "_" },
  code: { nodeType: "inline-code", surroundingChars: "`" },
  highlight: { nodeType: "highlight", surroundingChars: "==" },
  strikethrough: { nodeType: "strikethrough", surroundingChars: "~~" },
  comment: { nodeType: "comment", surroundingChars: "%%" },
  math: { nodeType: "math", surroundingChars: "$" },
};

const NG39_SCAN_KINDS = ["italic", "code", "comment", "bold", "highlight", "strikethrough", "math"];
const NG39_NODE_TYPE_OF = {
  italic: "em", code: "inline-code", comment: "comment", bold: "strong",
  highlight: "highlight", strikethrough: "strikethrough", math: "math",
};

export function ng39TrimWhitespace(state, range) {
  let from = range.from;
  let to = range.to;
  while (from < to && /\s/.test(state.sliceDoc(from, from + 1))) from++;
  while (to > from && /\s/.test(state.sliceDoc(to - 1, to))) to--;
  return { from, to };
}

export function ng39CursorToContentSide(cursor, pos) {
  cursor.moveTo(pos, -1);
  const node = cursor.node;
  const parent = node && node.parent;
  const pcls = parent && parent.type && typeof parent.type.prop === "function"
    ? parent.type.prop(env().Zd) : null;
  const inTable = pcls && String(pcls).split(/\s+/).indexOf("table") >= 0;
  if (!inTable) cursor.moveTo(pos, 1);
}

function ng39ClassList(node) {
  const p = env().$d;
  const raw = node && node.type && typeof node.type.prop === "function" ? node.type.prop(p) : null;
  return raw ? String(raw).split(/\s+/).filter(Boolean) : [];
}

function ng39HeaderLevel(tokens) {
  for (const t of tokens) {
    const m = /^header-(\d)$/.exec(t);
    if (m) return parseInt(m[1], 10);
  }
  return 0;
}

export function ng39DetectFormatting(state, range) {
  const e = env();
  const doc = state.doc;
  const tree = e.tp(state);
  const firstLine = doc.lineAt(range.from).number;
  const lastLine = doc.lineAt(range.to).number;
  const multi = lastLine > firstLine;
  const alive = {};
  for (const k of NG39_SCAN_KINDS) alive[k] = true;
  let sawContent = false;
  let headingLevel = 0;
  let uniformHeading = true;
  let levelInit = false;

  for (let n = firstLine; n <= lastLine; n++) {
    const line = doc.line(n);
    const outside = line.to <= range.from || line.from >= range.to;
    if (outside && e.ff(state, { from: line.from, to: line.to })) continue;
    let bounds = { from: line.from, to: line.to };
    try { bounds = e.mf(state, n) || bounds; } catch (err) { /* keep line bounds */ }
    const from = Math.max(bounds.from, range.from);
    const to = Math.min(bounds.to, range.to);
    if (from > to || (from === to && multi)) continue;
    try {
      tree.iterate({
        from, to,
        enter(node) {
          const toks = ng39ClassList(node);
          if (toks.length === 0) return undefined;
          const lvl = ng39HeaderLevel(toks);
          if (!levelInit) { headingLevel = lvl; levelInit = true; }
          else if (lvl !== headingLevel) { uniformHeading = false; headingLevel = lvl; }
          if (toks.indexOf("formatting") >= 0) return undefined;
          sawContent = true;
          for (const k of NG39_SCAN_KINDS) {
            if (alive[k] && toks.indexOf(NG39_NODE_TYPE_OF[k]) < 0) alive[k] = false;
          }
          return undefined;
        },
      });
    } catch (err) { /* partial tree */ }
  }

  if (alive.math && sawContent) {
    try {
      const cur = tree.cursor(e.Lu);
      cur.moveTo(range.to, -1);
      for (;;) {
        const toks = ng39ClassList(cur.node);
        const isBegin = toks.indexOf("format-math-begin") >= 0 || toks.indexOf("formatting-math-begin") >= 0;
        if (isBegin) {
          const isBlock = toks.indexOf("math-block") >= 0 || toks.some((t) => /(^|-)math-block$/.test(t));
          if (isBlock) alive.math = false;
          break;
        }
        if (!cur.prevSibling()) break;
      }
    } catch (err) { /* no cursor */ }
  }

  const out = { headingLevel, uniformHeading };
  for (const k of NG39_SCAN_KINDS) out[k] = sawContent ? !!alive[k] : false;
  return out;
}
