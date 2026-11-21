// g17 clean-room live preview.
//
// Replaces the derived live-preview module with an independent implementation:
// a CodeMirror state field that walks the syntax tree and emits widget/mark
// decorations for math, html embeds, internal embeds, images, code blocks,
// callouts, rules and markdown tables; the plugin extension list that wires
// the field together with the mouse/selection machinery, table sync and the
// cell sanitizer; and the frontmatter/properties extension (hide-by-default,
// source mode, invalid-YAML marker).
//
// Host values are read lazily through env() / the `host` argument; widget
// classes come from host.livePreview* (the s12 adapters) and host.tableWidget.

import { env } from "./env.js";
import { ng17EditorExtensions } from "./n-g17-widgets.js";

const ng17lpE = () => env();

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function ng17ClassSet(node, prop) {
  const raw = node && node.type ? node.type.prop(prop) : "";
  return new Set(String(raw == null ? "" : raw).split(" "));
}

function ng17HasAny(set, names) {
  for (const n of names) if (set.has(n)) return true;
  return false;
}

/** End offset (inclusive line end) of a leading `---` frontmatter block, or -1. */
function ng17FrontmatterEnd(doc) {
  try {
    if (doc.lines < 2) return -1;
    const first = doc.line(1);
    if (first.text.trim() !== "---") return -1;
    for (let i = 2; i <= doc.lines; i++) {
      const t = doc.line(i).text.trim();
      if (t === "---" || t === "...") return doc.line(i).to;
    }
    return -1;
  } catch (e) { return -1; }
}

function ng17FrontmatterYaml(doc, end) {
  try {
    const closeLine = doc.lineAt(end);
    const open = doc.line(1);
    if (closeLine.number <= 1) return "";
    return doc.sliceString(open.to + 1, closeLine.from);
  } catch (e) { return ""; }
}

/** Does [from,to) intersect the current selection? */
function ng17Covered(state, from, to) {
  for (const r of state.selection.ranges) {
    if (r.from < to && r.to > from) return true;
  }
  return false;
}

function ng17SetPos(w, from, to) {
  try { w.start = from; w.end = to; } catch (e) { /* read-only */ }
  if (w && typeof w.setPos === "function") { try { w.setPos(from, to); } catch (e) { /* noop */ } }
}

/** Tags that stay inline when embedded as raw html. */
const NG17_INLINE_HTML = new Set(["a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data",
  "del", "dfn", "em", "i", "img", "ins", "kbd", "mark", "q", "rp", "rt", "ruby", "s", "samp",
  "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr"]);

// ---------------------------------------------------------------------------
// inline construct extraction (embed / image / internal link)
// ---------------------------------------------------------------------------

/** Expand around `pos` to the enclosing `![[...]]`; returns {from,to,inner} or null. */
function ng17ExpandWiki(doc, pos, bang) {
  const text = doc.toString();
  const open = bang ? "![[" : "[[";
  const close = "]]";
  const win = 400;
  const lo = Math.max(0, pos - win), hi = Math.min(text.length, pos + win);
  const slice = text.slice(lo, hi);
  // nearest opener at-or-before pos that closes after pos
  let best = -1;
  for (let i = slice.lastIndexOf(open, pos - lo + 2); i >= 0; i = slice.lastIndexOf(open, i - 1)) {
    const end = text.indexOf(close, lo + i + open.length);
    if (end > pos) { best = lo + i; break; }
    if (i === 0) break;
  }
  if (best < 0) return null;
  const end = text.indexOf(close, best + open.length);
  if (end < 0 || end > hi + win) return null;
  return { from: best, to: end + close.length, inner: text.slice(best + open.length, end) };
}

/** Expand around `pos` to the enclosing `![alt](url "title")`; returns parts or null. */
function ng17ExpandMdImage(doc, pos) {
  const text = doc.toString();
  const win = 600;
  const lo = Math.max(0, pos - win), hi = Math.min(text.length, pos + win);
  const slice = text.slice(lo, hi);
  let best = -1;
  for (let i = slice.lastIndexOf("![", pos - lo + 1); i >= 0; i = slice.lastIndexOf("![", i - 1)) {
    const close = text.indexOf("](", lo + i + 2);
    if (close > pos) { best = lo + i; break; }
    if (i === 0) break;
  }
  if (best < 0) return null;
  const mid = text.indexOf("](", best + 2);
  const end = text.indexOf(")", mid + 2);
  if (mid < 0 || end < 0 || end > hi + win) return null;
  const alt = text.slice(best + 2, mid);
  const inside = text.slice(mid + 2, end).trim();
  let url = inside, title = "";
  const tm = inside.match(/^(\S+)(?:\s+["']([^"']*)["'])?$/);
  if (tm) { url = tm[1]; title = tm[2] || ""; }
  return { from: best, to: end + 1, alt, url, title };
}

// ---------------------------------------------------------------------------
// the decoration builder (shared by the field and the table sync)
// ---------------------------------------------------------------------------

function ng17WidgetMap(component) {
  const st = component.__ng17lp || (component.__ng17lp = { widgets: new Map(), tables: [] });
  return st;
}

function ng17DisposeWidgets(component) {
  const st = component.__ng17lp;
  if (!st) return;
  for (const w of st.widgets.values()) {
    try { if (component.removeChild) component.removeChild(w); } catch (e) { /* noop */ }
  }
  for (const t of st.tables) {
    try { if (component.removeChild) component.removeChild(t.w); } catch (e) { /* noop */ }
  }
  st.widgets.clear();
  st.tables = [];
}

function ng17BuildDeco(component, tr, host) {
  const E = ng17lpE();
  const D = E.s12cmDecoration;
  const state = tr.state;
  const doc = state.doc;
  const tree = host.cmSyntaxTree(state);
  const decos = [];
  const st = ng17WidgetMap(component);
  const W = st.widgets;
  const used = new Set();
  const app = component.app || (component.view && component.view.app) || null;
  const sourcePath = component.path || (component.file && component.file.path) || "";
  const blockRanges = [];   // [from,to] claimed by block widgets
  const inlineDone = [];    // [from,to] claimed by inline widgets/marks

  const overlaps = (list, from, to) => {
    for (const r of list) if (from < r[1] && to > r[0]) return true;
    return false;
  };

  function getWidget(key, make) {
    let w = W.get(key);
    if (w) { used.add(key); return w; }
    try { w = make(); } catch (e) { return null; }
    if (!w) return null;
    W.set(key, w);
    used.add(key);
    // only register real Components as children; plain CM widgets have no unload()
    try {
      if (component.addChild && (typeof w.unload === "function" || typeof w.onunload === "function")) component.addChild(w);
    } catch (e) { /* noop */ }
    return w;
  }

  function place(key, make, from, to, opts) {
    opts = opts || {};
    const w = getWidget(key, make);
    if (!w) return;
    ng17SetPos(w, opts.posFrom != null ? opts.posFrom : from, opts.posTo != null ? opts.posTo : to);
    if (opts.extra) { try { opts.extra(w); } catch (e) { /* noop */ } }
    if (ng17Covered(state, from, to)) {
      decos.push(D.widget({ widget: w, side: 1, block: !!opts.block }).range(opts.at != null ? opts.at : to));
    } else {
      decos.push(D.replace({
        widget: w,
        block: !!opts.block,
        inclusiveStart: !!opts.inclusiveStart,
        inclusiveEnd: !!opts.inclusiveEnd,
      }).range(from, to));
    }
    if (opts.claim !== false) blockRanges.push([from, to]);
  }

  function placeInline(key, make, from, to, markOnly) {
    if (overlaps(blockRanges, from, to) || overlaps(inlineDone, from, to)) return;
    inlineDone.push([from, to]);
    if (markOnly) { decos.push(markOnly.range(from, to)); return; }
    const w = getWidget(key, make);
    if (!w) return;
    ng17SetPos(w, from, to);
    if (ng17Covered(state, from, to)) {
      decos.push(D.widget({ widget: w, side: 1 }).range(to));
    } else {
      decos.push(D.replace({ widget: w }).range(from, to));
    }
  }

  // ------------------------------------------------------------- collect pass
  const maths = [], htmls = [], codes = [], calloutEv = [], tableEv = [], inlines = [];
  let mBegin = -1, mContentFrom = 0, mBlock = false;
  let hBegin = -1, hTag = "";
  let cBegin = -1, cLang = "";

  try {
    tree.iterate({
      from: 0,
      to: doc.length,
      enter(node) {
        const from = node.from, to = node.to;
        const pc = ng17ClassSet(node, host.cmSyntaxPropClasses);
        const sc = ng17ClassSet(node, host.livePreviewSyntaxClasses);

        // -- math ---------------------------------------------------------
        if (pc.has("formatting-math-begin")) {
          mBegin = from; mContentFrom = to;
          mBlock = pc.has("math-block") || sc.has("math-block") || sc.has("HyperMD-math-block");
        } else if (pc.has("formatting-math-end") && mBegin >= 0) {
          maths.push({ from: mBegin, to, contentFrom: mContentFrom, contentTo: from, block: mBlock });
          mBegin = -1;
        }

        // -- raw html -----------------------------------------------------
        if (ng17HasAny(pc, ["hmd-html-begin", "formatting-html-begin"]) ||
            ng17HasAny(sc, ["HyperMD-html-begin", "html-begin"])) {
          if (hBegin < 0) {
            hBegin = from;
            const win = doc.sliceString(from, Math.min(doc.length, from + 80));
            const m = win.match(/<\s*([a-zA-Z][\w-]*)/);
            hTag = m ? m[1].toLowerCase() : "";
          }
        } else if ((ng17HasAny(pc, ["hmd-html-end", "formatting-html-end"]) ||
                    ng17HasAny(sc, ["HyperMD-html-end", "html-end"])) && hBegin >= 0) {
          htmls.push({ from: hBegin, to, tag: hTag });
          hBegin = -1; hTag = "";
        }

        // -- fenced code --------------------------------------------------
        if (sc.has("HyperMD-codeblock-begin")) {
          if (cBegin < 0) {
            cBegin = from;
            const line = doc.lineAt(from).text;
            const m = line.match(/^\s*(?:`{3,}|~{3,})[ \t]*([\w/+\-#]*)/);
            cLang = m ? (m[1] || "") : "";
          }
        } else if (sc.has("HyperMD-codeblock-end") && cBegin >= 0) {
          codes.push({ from: cBegin, to, lang: cLang });
          cBegin = -1; cLang = "";
        }

        // -- callout / quote ----------------------------------------------
        if (sc.has("HyperMD-callout")) calloutEv.push({ kind: "callout", from, to });
        else if (sc.has("HyperMD-quote")) calloutEv.push({ kind: "quote", from, to });

        // -- table rows ---------------------------------------------------
        if (sc.has("HyperMD-table-row")) tableEv.push({ from, to });

        // -- inline candidates --------------------------------------------
        const all = pc.size || sc.size;
        if (all) {
          const flat = new Set([...pc, ...sc]);
          if (ng17HasAny(flat, ["hmd-embed", "formatting-embed", "HyperMD-embed", "image",
                               "hmd-internal-link", "HyperMD-internal-link", "link", "url",
                               "formatting-link", "hmd-link"])) {
            inlines.push({ from, to });
          }
        }
      },
    });
  } catch (e) { /* partial tree: keep what was collected */ }
  if (mBegin >= 0) { /* unclosed math: ignore */ }
  if (hBegin >= 0) { /* unclosed html: ignore */ }
  if (cBegin >= 0) { /* unclosed fence: treat rest of doc as code */ codes.push({ from: cBegin, to: doc.length, lang: cLang }); }

  // ------------------------------------------------------------- callouts
  const calloutGroups = [];
  {
    let cur = null;
    for (const ev of calloutEv) {
      if (ev.kind === "callout") {
        if (cur) calloutGroups.push(cur);
        cur = { from: ev.from, to: ev.to, lineEnd: doc.lineAt(ev.to).to };
      } else if (cur) {
        if (ev.from <= cur.lineEnd + 1) {
          cur.to = ev.to;
          cur.lineEnd = doc.lineAt(ev.to).to;
        } else {
          calloutGroups.push(cur);
          cur = null;
        }
      }
    }
    if (cur) calloutGroups.push(cur);
  }
  for (const g of calloutGroups) {
    const from = doc.lineAt(g.from).from;
    const to = doc.lineAt(g.to).to;
    if (overlaps(blockRanges, from, to)) continue;
    const text = doc.sliceString(from, to);
    const Callout = host.livePreviewCalloutWidget;
    if (!Callout) continue;
    place("callout:" + text, () => new Callout(app, component, false, text), from, to,
      { block: true, inclusiveStart: from > 0 });
  }

  // ------------------------------------------------------------- tables
  const tableBlocks = [];
  {
    let cur = null;
    for (const ev of tableEv) {
      if (cur && ev.from - cur.to <= 1) { cur.to = ev.to; }
      else { if (cur) tableBlocks.push(cur); cur = { from: ev.from, to: ev.to }; }
    }
    if (cur) tableBlocks.push(cur);
  }
  const TableW = host.tableWidget;
  const nextTables = [];
  for (const b of tableBlocks) {
    const from = doc.lineAt(b.from).from;
    const to = doc.lineAt(b.to).to;
    if (overlaps(blockRanges, from, to) || !TableW) continue;
    const text = doc.sliceString(from, to);
    // try to reuse a widget whose previous range maps onto this block
    let widget = null, entry = null;
    for (const t of st.tables) {
      if (t.used) continue;
      let ms = t.start, me = t.end;
      try { ms = tr.changes.mapPos(t.start, -1); me = tr.changes.mapPos(t.end, 1); } catch (e) { /* keep */ }
      if (Math.abs(ms - from) <= 1 && Math.abs(me - to) <= 1) { entry = t; widget = t.w; break; }
    }
    if (widget) {
      entry.used = true;
      let ok = true;
      try { ok = widget.receiveUpdate(tr, text); } catch (e) { ok = false; }
      if (!ok) { try { component.removeChild && component.removeChild(widget); } catch (e) { /* noop */ } widget = null; entry = null; }
    }
    if (!widget) {
      try { widget = new TableW(app, component, text, true); }
      catch (e) { widget = null; }
      entry = widget ? { w: widget, start: from, end: to, used: true } : null;
    }
    if (!widget) continue;
    ng17SetPos(widget, from, to);
    if (ng17Covered(state, from, to)) {
      decos.push(D.widget({ widget, side: 1, block: true }).range(to));
    } else {
      decos.push(D.replace({ widget, block: true, inclusiveStart: from > 0 }).range(from, to));
    }
    blockRanges.push([from, to]);
    if (entry) { entry.start = from; entry.end = to; nextTables.push(entry); }
    try { widget.receiveSelection && widget.receiveSelection(trShim(tr)); } catch (e) { /* noop */ }
  }
  for (const t of st.tables) {
    if (!t.used) { try { component.removeChild && component.removeChild(t.w); } catch (e) { /* noop */ } }
  }
  st.tables = nextTables;

  // ------------------------------------------------------------- code blocks
  for (const c of codes) {
    const openLine = doc.lineAt(c.from);
    const closeLine = doc.lineAt(Math.min(c.to, doc.length));
    const hasClose = closeLine.number > openLine.number && /^\s*(?:`{3,}|~{3,})\s*$/.test(closeLine.text);
    const codeTo = hasClose ? closeLine.from - 1 : c.to;
    const codeFrom = Math.min(openLine.to + 1, codeTo);
    const code = doc.sliceString(codeFrom, Math.max(codeFrom, codeTo)).replace(/\n$/, "");
    const CodeW = host.livePreviewCodeblockWidget;
    const renderable = CodeW && CodeW.canRenderLang && CodeW.canRenderLang(c.lang);
    if (renderable) {
      const from = openLine.from, to = hasClose ? closeLine.to : closeLine.to;
      if (overlaps(blockRanges, from, to)) continue;
      place("code:" + c.lang + "|" + code, () => new CodeW(app, component, c.lang, code), from, to,
        { block: true, inclusiveStart: from > 0, posFrom: from, posTo: to });
    } else {
      // hide both fence lines, keep the code as plain text + flair widget
      if (!overlaps(blockRanges, openLine.from, openLine.to)) {
        decos.push(D.replace({}).range(openLine.from, openLine.to));
      }
      const endLine = hasClose ? closeLine : openLine;
      if (hasClose && !overlaps(blockRanges, closeLine.from, closeLine.to)) {
        decos.push(D.replace({}).range(closeLine.from, closeLine.to));
      }
      const Flair = host.livePreviewCodeFallbackWidget;
      if (Flair && !overlaps(inlineDone, openLine.from, openLine.to)) {
        inlineDone.push([openLine.from, openLine.to]);
        const w = getWidget("flair:" + c.lang + "|" + code, () => new Flair(c.lang, code));
        decos.push(D.widget({ widget: w, side: -1 }).range(openLine.to));
      }
      void endLine;
    }
  }

  // ------------------------------------------------------------- html embeds
  const blocklist = host.livePreviewTagBlocklist || [];
  for (const h of htmls) {
    if (!h.tag || blocklist.indexOf(h.tag) >= 0) continue;
    const block = !NG17_INLINE_HTML.has(h.tag);
    const from = block ? doc.lineAt(h.from).from : h.from;
    const to = block ? doc.lineAt(h.to).to : h.to;
    if (overlaps(blockRanges, from, to)) continue;
    const html = doc.sliceString(h.from, h.to);
    const HtmlW = host.livePreviewHtmlWidget;
    if (!HtmlW) continue;
    place("html:" + h.tag + "|" + html, () => new HtmlW(app, component, html, block), from, to,
      { block, posFrom: from, posTo: to, claim: block });
  }

  // ------------------------------------------------------------- math
  for (const m of maths) {
    let text = doc.sliceString(m.contentFrom, m.contentTo);
    if (m.block) text = text.replace(/^\n/, "").replace(/\n$/, "");
    const MathW = host.livePreviewMathWidget;
    if (!MathW) continue;
    if (m.block) {
      if (overlaps(blockRanges, m.from, m.to)) continue;
      place("math:" + m.block + "|" + text, () => new MathW(text, true), m.from, m.to,
        { block: true, inclusiveStart: m.from > 0 });
    } else {
      placeInline("math:" + text, () => new MathW(text, false), m.from, m.to);
    }
  }

  // ------------------------------------------------------------- hr
  {
    const HR = host.livePreviewHrWidget;
    if (HR) {
      const hrRe = /^ {0,3}((\* *){3,}|(- *){3,}|(_ *){3,})$/;
      for (let i = 1; i <= doc.lines; i++) {
        const line = doc.line(i);
        if (!hrRe.test(line.text)) continue;
        if (overlaps(blockRanges, line.from, line.to)) continue;
        const w = getWidget("hr", () => HR);
        ng17SetPos(w, line.from, line.to);
        if (ng17Covered(state, line.from, line.to)) {
          decos.push(D.widget({ widget: w, side: 1, block: true }).range(line.to));
        } else {
          decos.push(D.replace({ widget: w, block: true, inclusiveStart: line.from > 0 }).range(line.from, line.to));
        }
        blockRanges.push([line.from, line.to]);
      }
    }
  }

  // ------------------------------------------------------------- inlines
  for (const n of inlines) {
    if (overlaps(blockRanges, n.from, n.to) || overlaps(inlineDone, n.from, n.to)) continue;
    // embed ![[target|alias]]
    const emb = ng17ExpandWiki(doc, n.from, true);
    if (emb && emb.from <= n.from && emb.to >= n.to) {
      const parts = emb.inner.split("|");
      const href = (parts[0] || "").trim();
      const title = parts.length > 1 ? parts.slice(1).join("|").trim() : "";
      if (href) {
        const LinkW = host.livePreviewLinkWidget;
        if (LinkW) {
          const depth = host.embedDepthAt ? safeDepth(host.embedDepthAt, component) : 0;
          placeInline("embed:" + sourcePath + "|" + href + "|" + title,
            () => new LinkW(app, component, sourcePath, href, title, depth),
            emb.from, emb.to);
        }
        continue;
      }
    }
    // markdown image ![alt](url)
    const img = ng17ExpandMdImage(doc, n.from);
    if (img && img.from <= n.from && img.to >= n.to && img.url) {
      if (!overlaps(inlineDone, img.from, img.to)) {
        inlineDone.push([img.from, img.to]);
        const ImgW = host.livePreviewImageWidget;
        if (ImgW) {
          const w = getWidget("img:" + img.url + "|" + img.title,
            () => { const x = new ImgW(img.url, img.title); if (x.applyTitle) x.applyTitle(img.alt); return x; });
          ng17SetPos(w, img.from, img.to);
          if (ng17Covered(state, img.from, img.to)) {
            decos.push(D.widget({ widget: w, side: 1 }).range(img.to));
          } else {
            decos.push(D.replace({ widget: w }).range(img.from, img.to));
          }
        }
        continue;
      }
    }
    // internal link [[target]] -> unresolved mark
    const lk = ng17ExpandWiki(doc, n.from, false);
    if (lk && lk.from <= n.from && lk.to >= n.to) {
      if (!overlaps(inlineDone, lk.from, lk.to)) {
        inlineDone.push([lk.from, lk.to]);
        const target = (lk.inner.split("|")[0] || "").split("#")[0].trim();
        let unresolved = false;
        try {
          const cache = app && app.metadataCache;
          unresolved = !!(cache && cache.isUnresolved && target &&
            cache.isUnresolved(target, sourcePath));
        } catch (e) { unresolved = false; }
        if (unresolved && host.livePreviewUnresolvedMark) {
          decos.push(host.livePreviewUnresolvedMark.range(lk.from, lk.to));
        }
      }
    }
  }

  // ------------------------------------------------------------- cleanup
  for (const [key, w] of W) {
    if (!used.has(key)) {
      try { if (component.removeChild) component.removeChild(w); } catch (e) { /* noop */ }
      W.delete(key);
    }
  }
  return D.set(decos, true);
}

function safeDepth(fn, component) {
  try { return fn(component.containerEl || component) || 0; } catch (e) { return 0; }
}

/** Minimal ViewUpdate-shaped shim for TableWidget.receiveSelection. */
function trShim(tr) {
  return {
    docChanged: tr.docChanged,
    selectionSet: tr.startState && tr.state ? !tr.startState.selection.eq(tr.state.selection) : true,
    newSelection: tr.state ? tr.state.selection : null,
    transactions: [tr],
    annotation(a) { return tr.annotation(a); },
  };
}

// ---------------------------------------------------------------------------
// exports
// ---------------------------------------------------------------------------

/** T6: the live-preview decorations StateField (component, view, host). */
export function livePreviewDecorations(component, view, host) {
  const E = ng17lpE();
  const D = E.s12cmDecoration;
  const Field = E.s12cmStateField;
  const gate = host.livePreviewField;
  return Field.define({
    create() { return D.none; },
    update(deco, tr) {
      const state = tr.state;
      let active = true;
      try { if (gate) active = !!state.field(gate); } catch (e) { active = true; }
      if (!active) {
        try { ng17DisposeWidgets(component); } catch (e) { /* noop */ }
        return D.none;
      }
      const selSame = tr.startState && tr.state ? tr.startState.selection.eq(tr.state.selection) : true;
      if (!tr.docChanged && tr.effects.length === 0 && selSame) {
        return deco.map(tr.changes);
      }
      try {
        return ng17BuildDeco(component, tr, host);
      } catch (e) {
        console.error(e);
        return deco.map(tr.changes);
      }
    },
    provide(f) {
      return E.s12cmEditorViewStatics.decorations.from(f);
    },
  });
}

/** O6: the live-preview extension list (component, view, host). */
export function livePreviewPlugin(component, view, host) {
  const exts = [];
  const field = livePreviewDecorations(component, view, host);
  exts.push(field);

  // mouse / drag-selection machinery + post-processor refresh
  try { exts.push(...ng17EditorExtensions()); } catch (e) { /* noop */ }
  if (host.mobileCursorPlugin) { try { exts.push(host.mobileCursorPlugin); } catch (e) { /* noop */ } }

  // selection-highlight + task-line decoration plugins
  try { if (host.livePreviewThemeA) exts.push(host.livePreviewThemeA); } catch (e) { /* noop */ }
  try { if (host.livePreviewThemeB) exts.push(host.livePreviewThemeB); } catch (e) { /* noop */ }

  // refresh decorations when the markdown post-processor reruns
  try { if (host.propertiesLivePreview) exts.push(host.propertiesLivePreview(component)); } catch (e) { /* noop */ }

  // vim-aware vertical motion over block widgets (low precedence)
  try {
    const vimHook = host.vimPrecedence && host.vimPrecedence.low(
      host.cmViewPlugin.define((v) => {
        v.getNextPosUpDown = function (pos, dir) {
          try {
            const decos = v.state.field(field);
            let hit = null;
            decos.between(Math.max(0, pos - 1), Math.min(v.state.doc.length, pos + 1), (f, t, spec) => {
              const w = spec && (spec.widget || (spec.spec && spec.spec.widget));
              if (w && w.estimatedHeight > 0) { hit = { from: f, to: t }; return false; }
            });
            if (hit) return { value: dir > 0 ? hit.to : hit.from };
          } catch (e) { /* noop */ }
        };
        return {};
      }));
    if (vimHook) exts.push(vimHook);
  } catch (e) { /* noop */ }

  // table sync filter + cell sanitizer + surrounding-click handler
  try { if (host.tableSyncExtension) exts.push(host.tableSyncExtension(component, field)); } catch (e) { /* noop */ }
  try {
    if (host.tableWidget && host.tableWidget.cellSanitizerPlugin) {
      exts.push(host.tableWidget.cellSanitizerPlugin(component));
    }
  } catch (e) { /* noop */ }
  try {
    if (host.tableWidget && host.tableWidget.detectSurroundingClick) {
      exts.push(host.tableWidget.detectSurroundingClick(field));
    }
  } catch (e) { /* noop */ }

  return exts;
}

// ---------------------------------------------------------------------------
// frontmatter / properties live preview (nP)
// ---------------------------------------------------------------------------

let ng17FmCache = { text: null, valid: true, pos: -1 };

function ng17YamlCheck(text, host, app) {
  if (ng17FmCache.text === text) return ng17FmCache;
  let valid = true, pos = -1;
  try {
    const parsed = host.parseYaml ? host.parseYaml(text) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) valid = true;
    else if (parsed === null || parsed === undefined) valid = true;
    else valid = false;
  } catch (e) {
    valid = false;
    try {
      const err = host.yamlParseError && host.yamlParseError(text);
      pos = err && typeof err.pos === "number" ? err.pos : -1;
    } catch (e2) { pos = -1; }
  }
  ng17FmCache = { text, valid, pos };
  return ng17FmCache;
}

function ng17PropertiesMode(component) {
  try {
    const app = component.app || (component.view && component.view.app) || (component.owner && component.owner.app);
    const vault = app && app.vault;
    return vault && vault.getConfig ? vault.getConfig("propertiesInDocument") : "document";
  } catch (e) { return "document"; }
}

/** nP: frontmatter hide/show + invalid marker, plus the edit-blocking filter. */
export function livePreviewProperties(component, view, host) {
  const E = ng17lpE();
  const D = E.s12cmDecoration;
  const Field = E.s12cmStateField;

  const field = Field.define({
    create() { return D.none; },
    update(deco, tr) {
      const doc = tr.state.doc;
      const end = ng17FrontmatterEnd(doc);
      if (end < 0) return D.none;
      if (ng17PropertiesMode(component) === "source") return D.none;
      const yaml = ng17FrontmatterYaml(doc, end);
      const check = ng17YamlCheck(yaml, host, component.app);
      if (check.valid) {
        const spec = host.livePreviewBlockReplace;
        return spec && spec.range ? D.set([spec.range(0, end)], true) : D.none;
      }
      const decos = [];
      if (host.livePreviewInvalidMark && host.livePreviewInvalidMark.range) {
        decos.push(host.livePreviewInvalidMark.range(0, end));
      }
      // error marker on the offending line (clamped into the yaml region)
      try {
        const open = doc.line(1);
        const closeLine = doc.lineAt(end);
        let p = open.to + 1 + Math.max(0, check.pos | 0);
        p = Math.min(Math.max(p, open.to + 1), Math.max(open.to + 1, closeLine.from - 1));
        const errLine = doc.lineAt(p);
        decos.push(D.mark({ class: "error-marker" }).range(errLine.from, errLine.to));
      } catch (e) { /* keep the invalid mark only */ }
      return D.set(decos, true);
    },
    provide(f) {
      return E.s12cmEditorViewStatics.decorations.from(f);
    },
  });

  const filter = host.cmState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    if (ng17PropertiesMode(component) === "source") return tr;
    const end = ng17FrontmatterEnd(tr.state.doc);
    if (end < 0) return tr;
    let inside = false;
    tr.changes.iterChangedRanges((fA, tA, fB, tB) => {
      if (fB < end && tB > 0) inside = true;
    });
    if (!inside) return tr;
    return false;
  });

  return [field, filter];
}
