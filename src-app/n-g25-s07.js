// g25 clean-room s07-helpers: CM position conversion, _handlers trio, IME dispatch,
// cursor restore, embed URLs/iframe, writing-tools menu, outline HTML, sort
// comparators, match rendering, weak-map caches, DOM/list helpers.
// Spec: F:\orch\specs\g25.md Part E.

import { env } from "./env.js";

// ---------------------------------------------------------------- positions

/** CM6 {line,ch} -> offset; ch clamped to line end (unlike s06's from-end rule). */
export function s07posToOffset(doc, pos) {
  const n = pos.line + 1;
  if (n < 1) return 0;
  if (n > doc.lines) return doc.length;
  const line = doc.line(n);
  return Math.min(line.from + Math.max(0, pos.ch), line.to);
}

/** Offset -> {line,ch}; null when out of [0, doc.length]. */
export function s07offsetToPos(doc, offset) {
  if (offset < 0 || offset > doc.length) return null;
  const line = doc.lineAt(offset);
  return { line: line.number - 1, ch: offset - line.from };
}

// ---------------------------------------------------------------- _handlers trio

function ng25IsDom(t) {
  return !!(t && typeof t.addEventListener === "function" && typeof t.removeEventListener === "function");
}

export function s07addHandler(t, type, fn) {
  if (ng25IsDom(t)) {
    t.addEventListener(type, fn, false);
    return;
  }
  const h = t._handlers || (t._handlers = {});
  const list = h[type] || (h[type] = []);
  list.push(fn);
}

export function s07removeHandler(t, type, fn) {
  if (ng25IsDom(t)) {
    t.removeEventListener(type, fn, false);
    return;
  }
  const h = t && t._handlers;
  const list = h && h[type];
  if (!list) return;
  const i = list.indexOf(fn);
  if (i !== -1) list.splice(i, 1);
}

/** Run every fn stored under target._handlers[type] with `args`. */
export function s07emitStored(target, type, ...args) {
  const h = target && target._handlers;
  const list = h && h[type];
  if (!list) return;
  for (let i = 0; i < list.length; i++) list[i].apply(list, args);
}

/** Invoke every fn in `fns` with `args`. */
export function s07callAll(fns, ...args) {
  for (let i = 0; i < fns.length; i++) fns[i].apply(fns, args);
}

// ---------------------------------------------------------------- CM6 glue

/** IME-aware dispatch: compose userEvent, rewrite "input" annotations, respect readOnly. */
export function s07cm6Dispatch(facade, spec) {
  const cm6 = facade && facade.cm6;
  if (!cm6 || (cm6.state && cm6.state.readOnly)) return undefined;
  const userEvent = facade.curOp && !facade.lastChange ? "input.type.compose.start" : "input.type.compose";
  if (spec && spec.annotations) {
    for (const a of spec.annotations) {
      if (a && a.value === "input") {
        try { a.value = userEvent; } catch (e) { console.error(e); }
      }
    }
  } else if (spec) {
    spec.userEvent = userEvent;
  }
  return cm6.dispatch(spec);
}

/** undo/redo on facade.cm6, then restore the recorded selection start when possible. */
export function s07cm6RestoreCursor(facade, undo) {
  const op = facade && facade.curOp;
  const start = op ? op.$changeStart : undefined;
  if (op) op.$changeStart = undefined;
  const cm6 = facade.cm6;
  if (undo) env().nF(cm6); else env().iF(cm6);
  if (start !== undefined && start !== null) {
    const doc = cm6.state && cm6.state.doc;
    let anchor = null;
    if (start && typeof start === "object") anchor = start;
    else if (typeof start === "number" && doc) anchor = s07offsetToPos(doc, start);
    if (anchor && typeof cm6.dispatch === "function") cm6.dispatch({ selection: { anchor } });
  }
}

// ---------------------------------------------------------------- embeds

export const s07youtubeRe = /(?:youtube\.com\/(?:watch\?[^#]*v=|embed\/|v\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/i;
export const s07tweetRe = /(?:twitter\.com|x\.com)\/[^/?#]+\/status(?:es)?\/(\d+)/i;

function ng25YoutubeId(text) {
  let m;
  if (/youtu\.be\//i.test(text)) {
    m = /youtu\.be\/([A-Za-z0-9_-]{3,})/i.exec(text);
  } else if (/youtube\.com\/watch/i.test(text)) {
    m = /[?&]v=([A-Za-z0-9_-]{3,})/.exec(text);
  } else {
    m = /youtube\.com\/(?:embed|v|shorts)\/([A-Za-z0-9_-]{3,})/i.exec(text);
    if (!m && /^[A-Za-z0-9_-]{6,}$/.test(text.trim())) m = [null, text.trim()];
  }
  return m ? m[1] : null;
}

function ng25YoutubeStart(text) {
  const tm = /[?&](?:t|start)=([^&#]+)/.exec(text);
  if (!tm) return "";
  const raw = tm[1];
  const hm = /^(\d+)m(\d+)s?$/.exec(raw);
  const sm = /^(\d+)s$/.exec(raw);
  const dm = /^(\d+)$/.exec(raw);
  if (hm) return String(+hm[1] * 60 + +hm[2]);
  if (sm) return sm[1];
  if (dm) return dm[1];
  return raw;
}

/** YouTube/Twitter URL -> sandboxed embed URL, else null. */
export function s07embedUrlFor(text) {
  if (typeof text !== "string" || !text) return null;
  const ytId = ng25YoutubeId(text);
  if (ytId) {
    const st = ng25YoutubeStart(text);
    return "https://www.youtube-nocookie.com/embed/" + ytId + (st ? "?start=" + st : "");
  }
  const tw = s07tweetRe.exec(text);
  if (tw) {
    const dark = typeof document !== "undefined" && document.body && document.body.classList.contains("theme-dark");
    return "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=" + (dark ? "dark" : "light") + "&id=" + tw[1];
  }
  return null;
}

/** Sandboxed iframe for an external embed URL. */
export function s07externalEmbed(url) {
  const frame = document.createElement("iframe");
  frame.className = "external-embed mod-receives-events";
  frame.setAttribute("sandbox", "allow-forms allow-presentation allow-same-origin allow-popups-to-escape-sandbox allow-scripts allow-modals allow-popups");
  frame.setAttribute("allow", "fullscreen");
  frame.setAttribute("frameborder", "0");
  frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  frame.src = url;
  if (/platform\.twitter\.com/.test(String(url))) {
    frame.setAttribute("scrolling", "no");
    const onMsg = (e) => {
      const d = e && e.data;
      if (d && d.type === "twttr.private.resize") {
        const h = d.params && d.params[0] && d.params[0].height;
        if (typeof h === "number" && isFinite(h)) frame.style.height = Math.min(1000, h) + "px";
      }
    };
    const win = frame.contentWindow || frame.win;
    if (win && win.addEventListener) win.addEventListener("message", onMsg);
    try {
      if (env().Iz) env().Iz(frame.win || win, onMsg);
    } catch { /* no bridge */ }
  }
  return frame;
}

// ---------------------------------------------------------------- menus

function ng25SubItem(menu, section, fmt, editor, state, spec) {
  menu.addItem((item) => {
    item.setSection(section);
    item.setTitle(fmt[spec.title]());
    item.setIcon(spec.icon);
    if (spec.checked !== undefined) item.setChecked(!!state[spec.checked]);
    item.onClick(() => {
      if (spec.comment) editor.toggleComment();
      else if (spec.clear) editor.clearMarkdownFormatting();
      else editor.toggleMarkdownFormatting(spec.kind);
    });
  });
}

/** macOS writing-tools formatting menu (basic/advanced/danger sections). */
export function s07writingToolsMenu(menu, editor, state, section) {
  const fmt = env().gm.interface.formatting;
  menu.setShowMacWritingTools(true);
  menu.addSections([section + ".basic", section + ".advanced", section + ".danger"]);
  menu.addItem((item) => {
    item.setSection(section);
    item.setTitle(fmt.labelFormatting());
    item.setIcon("lucide-paintbrush");
    const sub = item.setSubmenu();
    const mk = (title, icon, extra) => ng25SubItem(sub, section, fmt, editor, state || {}, Object.assign({ title, icon }, extra));
    mk("toggleBold", "lucide-bold", { kind: "bold", checked: "bold" });
    mk("toggleItalics", "lucide-italic", { kind: "italic", checked: "italic" });
    mk("toggleStrikethrough", "lucide-strikethrough", { kind: "strikethrough", checked: "strikethrough" });
    mk("toggleHighlight", "lucide-highlighter", { kind: "highlight", checked: "highlight" });
    mk("toggleCode", "lucide-code-2", { kind: "code" });
    mk("toggleMath", "lucide-sigma", { kind: "math" });
    mk("toggleComments", "lucide-percent", { comment: true });
    mk("clear", "lucide-eraser", { clear: true });
  });
}

// ---------------------------------------------------------------- outline / markdown pipeline

/** TOC sections {html,pos,level} for top-level markdown blocks plus frontmatter. */
export function s07outlineHtml(markdown) {
  const ast = env().Kx(markdown);
  const children = (ast && ast.children) || [];
  const markTypes = ["checklist", "listItem", "code"];
  const defs = ast ? { definitions: env().oT(ast) } : undefined;
  const frontmatter = env().$x(ast);
  const sections = [];
  for (const child of children) {
    if (!child || !child.position) continue;
    const level = child.type === "heading" ? (child.depth || 1) : 7;
    env().jC(child, markTypes, (node) => {
      if (!node || !node.position) return;
      const data = node.data || (node.data = {});
      const hp = data.hProperties || (data.hProperties = {});
      const ns = node.position && node.position.start;
      const cs = child.position && child.position.start;
      if (ns && cs) hp["data-line"] = ns.line - cs.line;
    });
    ast.children = [child];
    sections.push({
      html: env().Zx(ast, defs),
      pos: env().hT(child.position),
      level,
    });
  }
  return { sections, frontmatter };
}

// ---------------------------------------------------------------- sorting

export const s07sortOrderPairs = [
  ["alphabetical", "alphabeticalReverse"],
  ["byModifiedTime", "byModifiedTimeReverse"],
  ["byCreatedTime", "byCreatedTimeReverse"],
];

function ng25ItemName(x) {
  return x.basename !== undefined ? x.basename : String(x.path || "");
}

/** Six file-explorer sort comparators (forward + reverse). */
export function s07fileSortComparators() {
  const fwd = {
    alphabetical: (a, b) => env().ub(ng25ItemName(a), ng25ItemName(b)),
    byModifiedTime: (a, b) => (b.stat ? b.stat.mtime : 0) - (a.stat ? a.stat.mtime : 0),
    byCreatedTime: (a, b) => (b.stat ? b.stat.ctime : 0) - (a.stat ? a.stat.ctime : 0),
  };
  const out = {};
  for (const key of Object.keys(fwd)) {
    out[key] = fwd[key];
    out[key + "Reverse"] = (a, b) => -fwd[key](a, b);
  }
  return out;
}

const NG25_LABEL_KEYS = {
  alphabetical: "labelSortAToZ",
  alphabeticalReverse: "labelSortZToA",
  byModifiedTime: "labelSortNewToOld",
  byModifiedTimeReverse: "labelSortOldToNew",
  byCreatedTime: "labelSortCreatedNewToOld",
  byCreatedTimeReverse: "labelSortCreatedOldToNew",
};

/** The six i18n label strings for the sort menu. */
export function s07labelSortComparators() {
  const labels = env().gm.plugins.fileExplorer;
  const out = {};
  for (const key of Object.keys(NG25_LABEL_KEYS)) out[key] = labels[NG25_LABEL_KEYS[key]];
  return out;
}

export const s07paraBreakRe = /\r?\n\r?\n/y;
export const s07searchKeyFilepath = "filepath";
export const s07searchResultKeys = ["filename", "filepath", "content", "propertyName", "tag"];
export function s07sentinelKey() {}
export const s07mermaidFlowConfig = { progressiveRender: true, asyncParse: true, listBullet: true };

// ---------------------------------------------------------------- match rendering

/** Render `text[start,end)` into `el` with matched ranges as highlighted spans. */
export function s07renderMatchSegments(el, text, start, end, ranges) {
  const clipped = [];
  for (const r of ranges || []) {
    const rFrom = Math.max(r[0], start);
    const rTo = Math.min(r[1], end);
    if (rTo <= rFrom) continue;
    clipped.push([rFrom, rTo]);
  }
  clipped.sort((a, b) => a[0] - b[0]);
  let pos = start;
  const push = (from, to, matched) => {
    if (to <= from) return;
    const span = env().createEl ? env().createEl("span", matched ? "search-result-file-matched-text" : undefined) : document.createElement("span");
    if (matched) span.className = "search-result-file-matched-text";
    span.textContent = text.substring(from, to);
    el.appendChild(span);
  };
  for (const r of clipped) {
    if (r[0] >= end) break;
    if (r[0] > pos) push(pos, Math.min(r[0], end), false);
    push(Math.max(r[0], pos), Math.min(r[1], end), true);
    pos = Math.max(pos, r[1]);
    if (pos >= end) break;
  }
  if (pos < end) push(pos, end, false);
}

// ---------------------------------------------------------------- weak maps

export class s07weakMapBox {
  constructor() { this._m = new WeakMap(); }
  set(k, v) { this._m.set(k, v); return this; }
  get(k) { return this._m.get(k); }
  has(k) { return this._m.has(k); }
  delete(k) { return this._m.delete(k); }
}

let ng25WeakmapSeq = 0;

/** WeakMap-shaped polyfill storing values under a unique own property of the key. */
export class s07weakMapPolyfill {
  constructor() { this._id = "_weakmap_" + (++ng25WeakmapSeq); }
  set(k, v) { if (k && (typeof k === "object" || typeof k === "function")) k[this._id] = v; return this; }
  get(k) { return k ? k[this._id] : undefined; }
  has(k) { return !!(k && this._id in k); }
  delete(k) { if (k && this._id in k) { delete k[this._id]; return true; } return false; }
}

/** Box when a real WeakMap exists, polyfill otherwise. */
export function s07weakMapFactory() {
  return typeof WeakMap === "function" ? new s07weakMapBox() : new s07weakMapPolyfill();
}

export const s07loadedWindows = new WeakSet();

// ---------------------------------------------------------------- misc DOM/list helpers

/** Fill `el` from an embed attribute value (quoted string, JSON string, inline SVG, or icon). */
export function s07embedAttrValue(el, raw) {
  let value = String(raw);
  if (value.length >= 2 && value.charAt(0) === "'" && value.charAt(value.length - 1) === "'") {
    value = value.slice(1, -1).replace(/\\'/g, "'");
  }
  if (value.length >= 2 && value.charAt(0) === '"') {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "string") value = parsed;
    } catch { /* keep raw */ }
  }
  if (/^<svg[\s>]/i.test(value)) {
    const frag = env().xL(value);
    const node = frag && (frag.firstChild || frag.firstElementChild);
    if (node && node instanceof SVGSVGElement) {
      node.setAttribute("width", "16");
      node.setAttribute("height", "16");
      node.setAttribute("fill", "currentColor");
      node.setAttribute("stroke", "currentColor");
      el.appendChild(node);
      return;
    }
  }
  env().tv(el, value);
}

/** cb for every <li> under `root` that contains a nested list. */
export function s07forEachNestedItem(root, cb) {
  const items = root && root.findAll ? root.findAll("li") : (root ? Array.from(root.querySelectorAll("li")) : []);
  for (const li of items) {
    const nested = li.findAll ? li.findAll("ul, ol") : li.querySelectorAll("ul, ol");
    if (nested && nested.length) cb(li);
  }
}

/** cb(firstChild) when the first child is a heading element. */
export function s07ifFirstHeading(el, cb) {
  const first = el && el.firstChild;
  if (first && first instanceof HTMLHeadingElement) cb(first);
}

/** Leading list/quote marker text of `text`, or null. */
export function s07leadingListMarker(text) {
  const m = env().aP.exec(text);
  return m && m[0] ? m[0] : null;
}

/** Continuation indent for a list line at `offset`: quote prefix + marker-width spaces. */
export function s07listMarkerIndent(doc, offset) {
  const line = doc.lineAt(offset);
  const m = env().aP.exec(line.text);
  if (!m) return "";
  return (m[1] || "") + " ".repeat((m[3] || "").length);
}

/** RangeSet equality: eq() for equal lengths, prefix-compare otherwise. */
export function s07rangeSetsEqual(a, b) {
  if (a.length === b.length) return a.eq(b);
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  return short.eq(long.slice(0, short.length));
}
