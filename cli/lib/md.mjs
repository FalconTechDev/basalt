// Markdown helpers: frontmatter (a practical YAML subset), links, tags, headings. No dependencies.

/** Replace code blocks and inline code with spaces (same length) so scanners skip them. */
export function maskCode(text) {
  const blank = (s) => s.replace(/[^\n]/g, " ");
  return text
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?(^\1[^\n]*$|(?![\s\S]))/gm, blank)
    .replace(/(`+)[^`\n]*?\1/g, blank)
    .replace(/%%[\s\S]*?%%/g, blank);
}

// ---------------- frontmatter ----------------
/** Split a note into {fm: raw yaml text|null, body, end}. `end` is the index where the body begins. */
export function splitFrontmatter(text) {
  const m = /^﻿?---[ \t]*\r?\n([\s\S]*?\r?\n)?---[ \t]*(\r?\n|$)/.exec(text);
  if (!m) return { fm: null, body: text, end: 0 };
  return { fm: m[1] || "", body: text.slice(m[0].length), end: m[0].length };
}

function scalar(s) {
  s = s.trim();
  if (s === "" || s === "~" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^".*"$/s.test(s)) { try { return JSON.parse(s); } catch { return s.slice(1, -1); } }
  if (/^'.*'$/s.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}
function splitFlow(s) {
  const out = []; let cur = "", q = null, depth = 0;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; } else if (ch === "[" || ch === "{") { depth++; cur += ch; } else if (ch === "]" || ch === "}") { depth--; cur += ch; }
    else if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}
function value(s) {
  s = s.trim();
  if (s.startsWith("[") && s.endsWith("]")) return splitFlow(s.slice(1, -1)).map(value);
  if (s.startsWith("{") && s.endsWith("}")) { const o = {}; for (const p of splitFlow(s.slice(1, -1))) { const i = p.indexOf(":"); if (i > 0) o[p.slice(0, i).trim()] = value(p.slice(i + 1)); } return o; }
  return scalar(s);
}

/** Parse frontmatter text to an object (top-level keys; lists, flow lists and nested maps). */
export function parseYaml(yaml) {
  const out = {}, lines = yaml.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([^\s#-][^:]*?):(?:\s+(.*)|\s*)$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1].replace(/^["']|["']$/g, ""), rest = (m[2] ?? "").trim();
    if (rest !== "" && !/^[|>][+-]?$/.test(rest)) { out[key] = value(/^["'\[{]/.test(rest) ? rest : rest.replace(/\s+#.*$/, "")); continue; }
    const block = [];
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || /^-\s/.test(lines[i + 1]) || lines[i + 1].trim() === "")) block.push(lines[++i]);
    while (block.length && block[block.length - 1].trim() === "") block.pop();
    if (/^[|>]/.test(rest)) { out[key] = block.map((l) => l.replace(/^\s{1,4}/, "")).join(rest[0] === ">" ? " " : "\n"); continue; }
    if (block.length && /^\s*-(\s|$)/.test(block[0])) out[key] = block.filter((l) => /^\s*-/.test(l)).map((l) => value(l.replace(/^\s*-\s*/, "")));
    else if (block.length) out[key] = parseYaml(block.map((l) => l.replace(/^\s{2}/, "")).join("\n"));
    else out[key] = null;
  }
  return out;
}

const needsQuote = (s) => s === "" || /^[\s\-?:,\[\]{}#&*!|>'"%@`]/.test(s) || /:\s|\s#|\s$/.test(s) || /^(true|false|null|~|yes|no)$/i.test(s) || /^-?\d+(\.\d+)?$/.test(s);
const sc = (v) => (typeof v === "string" ? (needsQuote(v) ? JSON.stringify(v) : v) : v === null ? "" : String(v));
/** One top-level key as YAML lines (no trailing newline). */
export function yamlEntry(key, v) {
  if (Array.isArray(v)) return v.length ? `${key}:\n` + v.map((x) => `  - ${sc(x)}`).join("\n") : `${key}: []`;
  if (v && typeof v === "object") { const ks = Object.keys(v); return ks.length ? `${key}:\n` + ks.map((k) => yamlEntry(k, v[k]).split("\n").map((l) => "  " + l).join("\n")).join("\n") : `${key}: {}`; }
  return `${key}: ${sc(v)}`.trimEnd();
}

export function getProperties(text) { const { fm } = splitFrontmatter(text); return fm ? parseYaml(fm) : {}; }

/** Return new note text with the property set (value===undefined removes it). Other lines stay byte for byte. */
export function setProperty(text, key, v) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const { fm, end } = splitFrontmatter(text);
  const entry = v === undefined ? null : yamlEntry(key, v).split("\n").join(eol);
  if (fm === null) return entry === null ? text : `---${eol}${entry}${eol}---${eol}${text}`;
  const lines = fm.split(/\r?\n/); if (lines[lines.length - 1] === "") lines.pop();
  const keyRe = new RegExp("^[\"']?" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\"']?\\s*:");
  const at = lines.findIndex((l) => keyRe.test(l));
  if (at >= 0) {
    let stop = at + 1; while (stop < lines.length && (/^\s+\S/.test(lines[stop]) || /^-\s/.test(lines[stop]) || lines[stop].trim() === "")) stop++;
    while (stop > at + 1 && lines[stop - 1].trim() === "") stop--;
    lines.splice(at, stop - at, ...(entry === null ? [] : entry.split(eol)));
  } else if (entry !== null) lines.push(...entry.split(eol));
  const body = text.slice(end), bom = text.startsWith("﻿") ? "﻿" : "";
  return `${bom}---${eol}${lines.join(eol)}${lines.length ? eol : ""}---${eol}${body}`;
}

/** Parse a CLI value: JSON when valid (true, 3, [1,2], "x"), otherwise the raw string. */
export function parseCliValue(s) { try { return JSON.parse(s); } catch { return s; } }

// ---------------- links ----------------
/**
 * Every link in a note: {kind: "wiki"|"embed"|"md", raw, target, heading, alias, index, length, line}
 * `index/length` cover the whole link source so it can be rewritten.
 */
export function extractLinks(text) {
  const masked = maskCode(text), out = [], nl = [];
  for (let k = masked.indexOf("\n"); k >= 0; k = masked.indexOf("\n", k + 1)) nl.push(k);
  const lineOf = (i) => { let lo = 0, hi = nl.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid] < i) lo = mid + 1; else hi = mid; } return lo + 1; };
  const wiki = /(!?)\[\[([^\[\]\n|#^]*)((?:#[^\[\]\n|]*)?)((?:\|[^\[\]\n]*)?)\]\]/g;
  for (let m; (m = wiki.exec(masked));) {
    out.push({ kind: m[1] ? "embed" : "wiki", raw: m[0], target: m[2].trim(), heading: m[3].slice(1), alias: m[4].slice(1), index: m.index, length: m[0].length, line: lineOf(m.index) });
  }
  const md = /(!?)\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^()\s]+(?:\([^()\s]*\)[^()\s]*)*)(?:\s+"[^"\n]*")?\s*\)/g;
  for (let m; (m = md.exec(masked));) {
    let t = m[3]; if (t.startsWith("<")) t = t.slice(1, -1);
    if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("#") || t.startsWith("//")) continue; // web links, mailto, anchors
    const h = t.indexOf("#"); let target = h >= 0 ? t.slice(0, h) : t; const heading = h >= 0 ? t.slice(h + 1) : "";
    try { target = decodeURIComponent(target); } catch { /* keep */ }
    out.push({ kind: m[1] ? "embed" : "md", raw: m[0], target, heading, alias: m[2], index: m.index, length: m[0].length, line: lineOf(m.index), mdRaw: m[3], mdEmbed: !!m[1] });
  }
  return out.sort((a, b) => a.index - b.index);
}

// ---------------- tags / headings ----------------
export function extractTags(text) {
  const set = new Set(), { fm, body } = splitFrontmatter(text);
  if (fm) {
    const p = parseYaml(fm);
    for (const k of ["tags", "tag"]) {
      const v = p[k], list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\s]+/) : [];
      for (const t of list) if (t) set.add(String(t).replace(/^#/, ""));
    }
  }
  for (const m of maskCode(body).matchAll(/(?:^|[\s(])#([\p{L}\p{N}_\-/]+)/gu)) if (/\D/.test(m[1])) set.add(m[1]);
  return [...set];
}

export function extractHeadings(text) {
  const out = [];
  maskCode(text).split("\n").forEach((l, i) => { const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l); if (m) out.push({ level: m[1].length, text: m[2], line: i + 1 }); });
  return out;
}

export const wordCount = (text) => (text.replace(/\s+/g, " ").trim().match(/[\p{L}\p{N}'’-]+/gu) || []).length;
