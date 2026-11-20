// g25 clean-room s06-util: positions, frontmatter, table cells, link/tag helpers, shared regexes.
// Spec: F:\orch\specs\g25.md Part C. env() names are the minified bundle bindings (lazy).

import { env } from "./env.js";
import { lastSegment, baseName, displayName, withoutExtension, parseLinktext, escapeLinkChars } from "./path.js";
import { linkSafeHeading } from "./text.js";
import { prepareQuery, fuzzyMatchJs } from "./search.js";
import { shiftRanges, matchPenalty } from "./n-g25-misc.js";

// ---------------------------------------------------------------- regexes / consts (contract-exact)

export const s06BlockquoteRe = /^\s{0,3}>(\s*)/;
export const s06TagRe = /(^|\s)#[^ -⁯⸀-⹿'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\\s]*$/g;
export const s06WikiLinkRe = /^(!?\[\[)(.*?)(\|(.*))?(]])$/;
export const s06FootnoteRefRe = /^#\d+$/;
export const s06ListMarkerRe = /^([>\s]*)(([*+-] |(\d+)([.)] ))(?:\[(.)\] )?)?/;
export const s06HeadingRe = /^([>\s]*)(#{1,6} )?(.*)/;
export const s06DateTimeRe = /^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d$/;
export const s06DateRe = /^\d{4}-[01]\d-[0-3]\d$/;
export const s06DateTimeFormats = ["YYYY-MM-DD[T]HH:mm:ss", "YYYY-MM-DD[T]HH:mm", "YYYY-MM-DD HH:mm:ss", "YYYY-MM-DD HH:mm"];
export const s06DateFormats = ["YYYY-MM-DD"];
export const s06CommentPrefix = "<!-- basalt -->";
export const s06CjkBrackets = [
  { regex: /(！)?【【$/, replace: (m) => (m[1] ? "![[" : "[[") },
  { regex: /】】$/, replace: "]]" },
  { regex: /【【$/, replace: "[[" },
];
export const s06EmptySuggestion = { type: "none", matches: null, score: 0 };

// ---------------------------------------------------------------- positions

export function s06Pos(line, ch = 0) { return { line, ch }; }
export function s06PosEq(a, b) { return a.line === b.line && a.ch === b.ch; }
export function s06PosAdd(pos, ch) { return { line: pos.line, ch: pos.ch + ch }; }

/** {line,ch} (0-based line) -> absolute offset. ch<0 counts from line end; missing/Infinity ch -> line end. */
export function s06PosToOffset(doc, pos) {
  const n = pos.line;
  if (n < 0) {
    const l0 = doc.line(1);
    return l0.from + ng25ChOffset(l0, pos.ch);
  }
  if (n >= doc.lines) return doc.length;
  const l = doc.line(n + 1);
  return l.from + ng25ChOffset(l, pos.ch);
}

function ng25ChOffset(line, ch) {
  if (ch === undefined || ch === null || ch === Infinity) return line.length;
  if (ch < 0) return Math.max(0, line.length + ch);
  return ch;
}

/** Absolute offset -> {line,ch} clamped into the doc. */
export function s06OffsetToPos(doc, offset) {
  const o = Math.max(0, Math.min(doc.length, offset));
  const l = doc.lineAt(o);
  return { line: l.number - 1, ch: o - l.from };
}

/** Visual width of the leading blockquote indent captured by s06BlockquoteRe. */
function ng25IndentWidth(s) {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === " ") {
      let n = 0;
      while (i < s.length && s[i] === " ") { n++; i++; }
      i--;
      w += Math.floor(n / 4) + (n % 4);
    } else if (c === "\t") {
      w += 4 - (w % 4);
    } else {
      w += 1;
    }
  }
  return w;
}

/** Width of the leading ">" marker run plus its indent; 0 without a marker. */
export function s06QuotePrefixWidth(text) {
  const m = s06BlockquoteRe.exec(text);
  if (!m) return 0;
  return 1 + ng25IndentWidth(m[1]);
}

// ---------------------------------------------------------------- object helpers

/** Set obj[path...] = value; path array is consumed (shift). Aborts silently on type/index mismatch. */
export function s06SetPath(obj, path, value) {
  while (path.length > 1) {
    const key = path.shift();
    if (Array.isArray(obj)) {
      const i = Number(key);
      if (!Number.isInteger(i) || i < 0 || i >= obj.length) return;
      obj = obj[i];
    } else if (obj && typeof obj === "object") {
      const next = obj[key];
      if (next === undefined || next === null || typeof next !== "object") return;
      obj = next;
    } else {
      return;
    }
  }
  if (path.length === 0) return;
  const key = path.shift();
  if (Array.isArray(obj)) {
    const i = Number(key);
    if (Number.isInteger(i) && i >= 0 && i < obj.length) obj[i] = value;
  } else if (obj && typeof obj === "object") {
    obj[key] = value;
  }
}

/** Deep merge into target: arrays concat+dedupe, plain objects recurse, scalars overwrite (null ignored over existing). */
export function s06MergeDeep(target, source) {
  if (!source || typeof source !== "object") return target;
  for (const key of Object.keys(source)) {
    const nv = source[key];
    const ov = target[key];
    if (Array.isArray(nv)) {
      const base = Array.isArray(ov) ? ov : [];
      target[key] = base.concat(nv).filter((v, i, a) => a.indexOf(v) === i);
    } else if (nv && typeof nv === "object") {
      if (ov && typeof ov === "object" && !Array.isArray(ov) && !Array.isArray(nv)) s06MergeDeep(ov, nv);
      else target[key] = nv;
    } else {
      if (nv === null && ov !== undefined) continue;
      target[key] = nv;
    }
  }
  return target;
}

// ---------------------------------------------------------------- frontmatter

/** "---\n<yaml>\n---\n" or "" for null/empty data. */
export function s06FrontmatterBlock(data) {
  if (!data || typeof data !== "object" || Object.keys(data).length === 0) return "";
  const yaml = env().vA(data);
  return "---\n" + String(yaml).trim() + "\n---\n";
}

function ng25FmObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

/** {content, frontmatter} split at the frontmatter block. */
export function s06ParseFrontmatter(text) {
  const info = env().Xx(text);
  const fm = info && info.frontmatter ? env().mA(info.frontmatter) : {};
  return { content: text.slice(info ? info.contentStart : 0), frontmatter: ng25FmObject(fm) };
}

/** Serialized `data` block followed by the body of `text`. */
export function s06WithFrontmatter(text, data) {
  const info = env().Xx(text);
  return s06FrontmatterBlock(data) + text.slice(info ? info.contentStart : 0);
}

/** Parse fm, run mutate(obj), rewrite the block; empty result drops the block. */
export function s06UpdateFrontmatter(text, mutate) {
  const info = env().Xx(text);
  const had = !!(info && info.exists);
  const parsed = had && info.frontmatter ? env().mA(info.frontmatter) : {};
  const obj = ng25FmObject(parsed);
  if (mutate) mutate(obj);
  const empty = !obj || typeof obj !== "object" || Object.keys(obj).length === 0;
  if (empty) return had ? text.slice(info.contentStart) : text;
  const yaml = String(env().vA(obj)).trim();
  if (had) return text.slice(0, info.from) + yaml + "\n" + text.slice(info.to);
  return "---\n" + yaml + "\n---\n" + text;
}

// ---------------------------------------------------------------- tables / DOM

/** True for a header row: THEAD row, first TABLE row, or first TBODY row after absent/blank THEAD — all-TH cells. */
export function s06IsHeaderRow(el) {
  const cells = el.childNodes;
  let allTh = cells.length > 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].nodeName !== "TH") { allTh = false; break; }
  }
  if (!allTh) return false;
  const p = el.parentNode;
  if (!p) return false;
  if (p.nodeName === "THEAD") return true;
  if (el !== p.firstChild) return false;
  if (p.nodeName === "TABLE") return true;
  if (p.nodeName === "TBODY") {
    const prev = p.previousSibling;
    if (!prev) return true;
    if (prev.nodeName === "THEAD") return !prev.textContent || !prev.textContent.trim();
  }
  return false;
}

/** Sorted offsets -> [{line,ch}] via one forward scan. */
export function s06OffsetsToPositions(text, offsets) {
  const out = [];
  let line = 0, start = 0, nl = text.indexOf("\n");
  for (const off of offsets) {
    while (nl !== -1 && off > nl) {
      line++;
      start = nl + 1;
      nl = text.indexOf("\n", start);
    }
    out.push({ line, ch: off - start });
  }
  return out;
}

/** colspan-1 (0 when absent/invalid). */
export function s06Colspan(cell) {
  const v = cell.getAttribute && cell.getAttribute("colspan");
  if (v === null || v === undefined) return 0;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : Math.max(0, n - 1);
}

/** Filler repeated for the extra colspan columns. */
export function s06ColspanRepeat(cell, filler) {
  return String(filler).repeat(s06Colspan(cell));
}

function ng25Changeset(changes, length) {
  return env().re.of(changes, length);
}

/** Escape newlines -> <br> and unescaped pipes -> \| for a table cell. */
export function s06EscapeTableCell(text) {
  const changes = [];
  let out = "";
  let bs = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\r" && text[i + 1] === "\n") {
      changes.push({ from: i, to: i + 2, insert: "<br>" });
      out += "<br>";
      i++;
      bs = 0;
      continue;
    }
    if (c === "\n") {
      changes.push({ from: i, to: i + 1, insert: "<br>" });
      out += "<br>";
      bs = 0;
      continue;
    }
    if (c === "\\") { bs++; out += c; continue; }
    if (c === "|") {
      if (bs % 2 === 0) {
        changes.push({ from: i, to: i, insert: "\\" });
        out += "\\|";
      } else {
        out += "|";
      }
      bs = 0;
      continue;
    }
    bs = 0;
    out += c;
  }
  return { result: out, changes: ng25Changeset(changes, text.length) };
}

/** Reverse of s06EscapeTableCell: <br> -> \n (outside code spans), odd-backslash \| -> |. */
export function s06UnescapeTableCell(text) {
  const changes = [];
  let out = "";
  let i = 0;
  let codeLen = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "`") {
      let n = 0;
      while (i + n < text.length && text[i + n] === "`") n++;
      if (codeLen === 0) codeLen = n;
      else if (n === codeLen) codeLen = 0;
      out += text.substr(i, n);
      i += n;
      continue;
    }
    if (codeLen === 0 && text.startsWith("<br>", i)) {
      changes.push({ from: i, to: i + 4, insert: "\n" });
      out += "\n";
      i += 4;
      continue;
    }
    if (c === "|") {
      let bs = 0, j = i - 1;
      while (j >= 0 && text[j] === "\\") { bs++; j--; }
      if (bs % 2 === 1) {
        // odd run: drop one backslash, keep the literal pipe
        changes.push({ from: j + 1, to: j + 2, insert: "" });
        if (out.charAt(out.length - 1) === "\\") out = out.slice(0, -1);
        out += "|";
      } else {
        out += "|";
      }
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return { result: out, changes: ng25Changeset(changes, text.length) };
}

// ---------------------------------------------------------------- suggestions / matching

/** Try basename match first (ranges shifted); else whole text with score-1. */
export function s06MatchBasenameFirst(matchFn, text) {
  const base = lastSegment(text);
  const hit = matchFn(base);
  if (hit) {
    const shift = text.length - base.length;
    if (hit.matches) shiftRanges(hit.matches, shift);
    return hit;
  }
  const whole = matchFn(text);
  if (whole) whole.score -= 1;
  return whole === undefined ? null : whole;
}

export function s06CompareScoreDesc(a, b) { return b.score - a.score; }
export function s06ComparePathLength(a, b) { return a.path.length - b.path.length; }

/** dataTransfer carries file items, or iOS "Files" drop. */
export function s06HasIosFilesDrop(dt) {
  const items = dt && dt.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      if (items[i] && items[i].kind === "file") return true;
    }
  }
  const platform = env().Yl;
  return !!(platform && platform.isIosApp && dt && dt.types && dt.types.indexOf("Files") !== -1);
}

// ---------------------------------------------------------------- views / links

function ng25HasOwnMeta(view, host) {
  return !!(view && Object.prototype.hasOwnProperty.call(view, "metadataEditor")
    && host && host.MetadataEditor && view.metadataEditor instanceof host.MetadataEditor);
}

/** View owns a MetadataEditor instance. */
export function s06HasMetadataEditor(view, host) {
  return ng25HasOwnMeta(view, host);
}

/** metadataEditor of activeEditor (preferred) or activeLeaf view, when it can show properties. */
export function s06ActivePropertiesEditor(ws, host) {
  const ed = ws && ws.activeEditor;
  if (ng25HasOwnMeta(ed, host) && typeof ed.canShowProperties === "function" && ed.canShowProperties()) {
    return ed.metadataEditor;
  }
  const leaf = ws && ws.activeLeaf && ws.activeLeaf.view;
  if (ng25HasOwnMeta(leaf, host) && typeof leaf.canShowProperties === "function" && leaf.canShowProperties()) {
    return leaf.metadataEditor;
  }
  return null;
}

/** DOMPurify-sanitize `html` and return the imported DOM node (DocumentFragment). */
export function s06SanitizeHtml(html, host) {
  const purify = (host && host.s06Purify) || env().s06Purify || env().EL;
  const config = (host && host.s06PurifyConfig) || env().s06PurifyConfig || env().SL;
  const clean = purify.sanitize(String(html), config);
  const tpl = document.createElement("template");
  tpl.innerHTML = clean;
  return tpl.content;
}


/** Markdown link strings for drop targets; `embed` prefixes image links with "!". */
export function s06DropLinkTexts(app, target, sourcePath, embed, host) {
  const out = [];
  const fm = app && app.fileManager;
  const vault = app && app.vault;
  const push = (file, subpath, alias) => {
    if (!file) return;
    let link = fm ? fm.generateMarkdownLink(file, sourcePath, subpath || "", alias || "") : "";
    if (embed && host && host.isImageExtension && host.isImageExtension(file.extension)) link = "!" + link;
    out.push(link);
  };
  const resolve = (f) => {
    if (!f) return null;
    if (host && host.TFile && f instanceof host.TFile) return f;
    if (typeof f === "string" && vault) {
      const r = vault.getAbstractFileByPath(f);
      return host && host.TFile && r instanceof host.TFile ? r : null;
    }
    return null;
  };
  const t = target && target.type;
  if (t === "file") {
    push(resolve(target.file));
  } else if (t === "files") {
    const list = target.files || [];
    for (let i = 0; i < list.length; i++) push(resolve(list[i]));
  } else if (t === "link") {
    const lp = parseLinktext(String(target.linktext || ""));
    const file = resolve(target.file);
    if (file) push(file, lp.subpath);
    else out.push(String(target.linktext || ""));
  } else if (t === "heading") {
    const file = resolve(target.file);
    if (file) {
      const h = target.heading;
      const text = h && typeof h === "object" ? (h.text || "") : String(h || "");
      push(file, "#" + linkSafeHeading(text));
    }
  } else if (t === "bookmarks") {
    const items = target.items || target.bookmarks || [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || item.type !== "file") continue;
      const file = vault ? vault.getAbstractFileByPath(item.path) : null;
      if (host && host.TFile && !(file instanceof host.TFile)) continue;
      if (!file) continue;
      push(file, item.subpath || "", item.title || "");
    }
  }
  return out;
}

const ng25WikiRe = s06WikiLinkRe;

function ng25MdPattern(host) {
  return (host && host.s06MdLinkPattern) || env().s06MdLinkPattern || env().pT;
}

/** Rewrite {original, link} to newLink preserving alias/format; fallback "[](<escaped>)". */
export function s06RewriteLink(pair, newLink, host) {
  const original = String(pair.original || "");
  const oldLink = String(pair.link || "");
  const wiki = ng25WikiRe.exec(original);
  if (wiki) {
    const bang = wiki[1].charAt(0) === "!" ? "!" : "";
    const open = wiki[1].charAt(bang.length) === "[" ? wiki[1].slice(bang.length) : wiki[1];
    let inner = wiki[2];
    let alias = wiki[4];
    const sep = wiki[3]; // "|alias" or undefined
    if (inner.indexOf("/") !== -1 && alias !== undefined && alias.trim() === baseName(inner)) {
      alias = baseName(newLink);
    }
    const tail = sep !== undefined ? "|" + alias : "";
    return bang + "[[" + newLink + tail + "]]";
  }
  const md = ng25MdPattern(host);
  if (md) {
    const m = md.exec(original);
    if (m) {
      // groups: 1 prefix "["/"![", 2 text, 3 "](", 4 dest(+title), 5 dest, 6 title-part, 9 close ")"
      const prefix = m[1];
      const oldText = m[2];
      const oldDest = m[5] || "";
      const angle = oldDest.charAt(0) === "<";
      const newDest = angle ? "<" + newLink + ">" : escapeLinkChars(newLink);
      const oldName = displayName(oldLink);
      const oldNoExt = withoutExtension(oldLink);
      let newText = oldText;
      if (oldText === oldName || oldText === oldNoExt || oldText === oldLink) {
        newText = displayName(newLink);
      }
      const titlePart = m[6] || "";
      const close = m[9] || ")";
      return prefix + newText + m[3] + newDest + titlePart + close;
    }
  }
  const esc = escapeLinkChars(newLink);
  return (original.charAt(0) === "!" ? "![" : "[") + "](" + esc + ")";
}

/** On rename resolution: {sourcePath, reference, change} or undefined. */
export function s06LinkChangeFor(resolved, cache, host) {
  if (!resolved || !cache) return undefined;
  const reference = resolved.reference;
  const sourcePath = resolved.sourcePath;
  if (!reference || !reference.link) return undefined;
  const parsed = parseLinktext(reference.link);
  const dest = cache.getLinkpathDest(parsed.path, sourcePath);
  const resolvedPath = resolved.file ? resolved.file.path : resolved.path;
  if (dest === resolvedPath) return undefined;
  const wasWiki = /^!?\[\[/.test(String(reference.original || ""));
  const file = resolved.file;
  if (!file || typeof cache.fileToLinktext !== "function") return undefined;
  const newLink = cache.fileToLinktext(file, sourcePath, wasWiki) + (parsed.subpath || "");
  if (newLink === reference.link) return undefined;
  return { sourcePath, reference, change: s06RewriteLink(reference, newLink, host) };
}

/** {path, subpath} for link-bearing items. */
export function s06LinkTarget(item) {
  const t = item && item.type;
  if (t === "block") {
    return { path: item.file.path, subpath: "#^" + item.id };
  }
  if (t === "heading") {
    const h = item.heading;
    const text = h && typeof h === "object" ? (h.text || "") : String(h || "");
    return { path: item.file.path, subpath: "#" + linkSafeHeading(text) };
  }
  if (t === "file" || t === "alias") {
    return { path: item.file.path, subpath: "" };
  }
  if (t === "linktext") {
    const p = parseLinktext(String(item.linktext || ""));
    return { path: p.path, subpath: p.subpath };
  }
  return { path: "", subpath: "" };
}

/** Fuzzy tag suggestions sorted by score desc (alpha pre-order via host.compareStrings). */
export function s06TagSuggestions(cache, query, withHash = false, host) {
  const tags = (cache && typeof cache.getTags === "function" ? cache.getTags() : null) || {};
  const cmp = (host && host.compareStrings) || ((a, b) => String(a).localeCompare(String(b)));
  const q = String(query || "").toLowerCase();
  const prepared = prepareQuery(q);
  const strip = (t) => (withHash ? t : String(t).replace(/^#/, ""));
  const keys = Object.keys(tags).map(strip);
  keys.sort(cmp);
  const emptyQ = q === "" || (withHash && q === "#");
  const out = [];
  for (const tag of keys) {
    let score = 0, matches = null;
    if (!emptyQ) {
      const m = fuzzyMatchJs(prepared, tag.toLowerCase());
      if (!m) continue;
      score = m.score + matchPenalty(m.matches);
      matches = m.matches;
    }
    out.push({ tag, score, matches });
  }
  out.sort(s06CompareScoreDesc);
  return out;
}