// g39 clean-room: pure helpers, file 2 of 3 (spec g39 part A).

export function ng39QuoteIndentDepth(line) {
  const s = String(line);
  let i = s.charAt(0) === ">" ? 1 : 0;
  let depth = 0;
  for (;;) {
    const c = s.charAt(i);
    if (c === "\t") { depth++; i++; continue; }
    if (c === " " && s.charAt(i + 1) === " " && s.charAt(i + 2) === " " && s.charAt(i + 3) === " "
        && !/[\s]/.test(s.charAt(i + 4))) { depth++; i += 4; continue; }
    if (c === " ") { i++; continue; }
    break;
  }
  return depth;
}

export function ng39DropWordsContaining(text, part) {
  const re = new RegExp("\\s?[^\\s]*(?:" + part + ")[^\\s]*", "g");
  return String(text).replace(re, "");
}

export function ng39FormDecode(text) {
  return decodeURIComponent(String(text).replace(/\+/g, "%20"));
}

export function ng39FormEncode(text) {
  return encodeURIComponent(text).replace(/%20/g, "+");
}

export function ng39FormEncodePath(text, sep) {
  const s = sep === undefined ? "/" : sep;
  return String(text).split(s).map(ng39FormEncode).join(s);
}

export function ng39LinesOf(text) {
  const lines = String(text).split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function ng39HasLatinLetter(text) {
  return /[a-z]/i.test(text);
}

export function ng39ParseImageSize(text) {
  const m = /^\s*(\d+)\s*(?:x\s*(\d+)\s*)?$/.exec(String(text));
  if (!m) return null;
  return { x: parseInt(m[1], 10), y: m[2] === undefined ? 0 : parseInt(m[2], 10) };
}

export function ng39IntOrNull(text) {
  if (!text) return null;
  const n = parseInt(text, 10);
  return isNaN(n) ? null : n;
}

export function ng39FloatOr(text, fallback) {
  const n = parseFloat(text);
  return isNaN(n) ? fallback : n;
}

export function ng39JoinClasses(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a + " " + b;
}
