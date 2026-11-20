// g16 clean-room link layer: renders a property value as a link chip when it is a
// [[wikilink]], [text](url) markdown link, bare URL or e-mail address, plus the
// three wired suggest classes (value links, editor [[…]] and #tag triggers).
import { env } from "./env.js";
import { containsAllWords } from "./search-simple.js";
import { s06TagSuggestions } from "./s06-util.js";
import { ng16TagText } from "./n-g16-shared.js";

const MD_LINK_RE = /^\[([^\]]*)\]\(\s*(<[^>]+>|[^)\s]+)[^)]*\)$/;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function ng16ParseLink(value) {
  const text = String(value);
  if (text.startsWith("[[") && text.endsWith("]]")) {
    const inner = text.slice(2, -2);
    let parsed = null;
    try { parsed = env().iE ? env().iE(inner) : null; } catch (e) { parsed = null; }
    const href = parsed && (parsed.href || parsed.path) || inner.split("|")[0].trim();
    const alias = parsed && parsed.title !== undefined ? parsed.title : (inner.includes("|") ? inner.split("|").slice(1).join("|").trim() : "");
    return { href, title: alias || href, internal: true };
  }
  const md = MD_LINK_RE.exec(text);
  if (md) {
    let href = md[2];
    if (href.startsWith("<") && href.endsWith(">")) href = href.slice(1, -1);
    const internal = !SCHEME_RE.test(href) && !href.startsWith("//");
    return { href, title: md[1] || href, internal };
  }
  if (env().Qc && env().Qc(text)) return { href: text, title: text, internal: false };
  if (env().Zc && env().Zc(text)) return { href: "mailto:" + text, title: text, internal: false };
  return null;
}

/**
 * (value, el, ctx, hoverParent) -> boolean. On success `el` becomes the anchor:
 * internal-link/external-link class, data-href, is-unresolved for dead internal
 * links; click opens the link, contextmenu shows the link menu.
 */
export function ng16RenderLinkValue(value, el, ctx, hoverParent, host) {
  if (value == null) return false;
  const link = ng16ParseLink(value);
  if (!link) return false;
  const { href, title, internal } = link;
  el.empty();
  el.setText(title);
  el.dataset.href = href;
  el.addClass(internal ? "internal-link" : "external-link");
  const cache = ctx && ctx.app && ctx.app.metadataCache;
  if (internal && cache && cache.getFirstLinkpathDest && !cache.getFirstLinkpathDest(href, ctx.sourcePath)) {
    el.addClass("is-unresolved");
  }
  const open = (event) => {
    if (event && event.button !== undefined && event.button !== 0 && event.button !== 1) return;
    if (event) { event.preventDefault(); event.stopPropagation(); }
    if (internal) {
      const ws = ctx.app.workspace;
      ws.openLinkText(href, ctx.sourcePath, event ? host.Keymap.isModEvent(event) : false);
    } else {
      window.open(href, "_blank");
    }
  };
  el.addEventListener("click", open);
  el.addEventListener("auxclick", open);
  el.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const menu = host.Menu.forEvent ? host.Menu.forEvent(event) : new host.Menu();
    const im = host.t.interface && host.t.interface.menu;
    const em = host.t.editor && host.t.editor.menu;
    const label = internal ? (em && em.openLink ? em.openLink() : "Open link") : (im && im.openInBrowser ? im.openInBrowser() : "Open in browser");
    menu.addItem((item) => item.setTitle(label).setIcon(internal ? "lucide-link" : "lucide-external-link").onClick(() => open(event)));
    if (internal && ctx.app.workspace && ctx.app.workspace.trigger) {
      try { ctx.app.workspace.trigger("hover-link", { event, source: ctx.hoverSource || "properties", hoverParent: hoverParent || null }); } catch (e) {}
    }
    menu.showAtMouseEvent(event);
  });
  if (internal && ctx.app && ctx.app.dragManager) {
    try {
      el.addEventListener("dragstart", (event) => {
        ctx.app.dragManager.dragLink(event, href, ctx.sourcePath, event.dataTransfer);
      });
    } catch (e) {}
  }
  return true;
}

// ---- shared suggest plumbing ----------------------------------------------------------

function ng16SuggestClasses(host, suggestEl, ctx) {
  try { suggestEl.addClass("mod-property-value"); } catch (e) {}
  try { if (ctx && ctx.key != null) suggestEl.dataset.propertyKey = String(ctx.key).toLowerCase(); } catch (e) {}
}

/** Existing frontmatter values for the same key, ranked by containsAllWords+matchScore. */
function ng16PropertyValueItems(host, app, key, query) {
  const q = String(query || "");
  let values = [];
  try {
    values = app.metadataCache.getFrontmatterPropertyValuesForKey
      ? app.metadataCache.getFrontmatterPropertyValuesForKey(key) || []
      : [];
  } catch (e) { values = []; }
  const lower = q.toLowerCase();
  const out = [];
  for (const value of values) {
    const s = String(value);
    if (!q || containsAllWords(lower, s.toLowerCase())) {
      out.push({ type: "text", value: s, score: hostMatchScore(host, q, s), matches: null });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}
function hostMatchScore(host, q, s) {
  try {
    return host.matchScore ? host.matchScore(null, q.length, s.length, false) : 0;
  } catch (e) { return 0; }
}

// ---- ValueLinkSuggest (DO): property text-value completion ----------------------------

export function ng16DefineValueLinkSuggest(host) {
  return function (ctx, inputEl, onSelectLink, suggestionFilter) {
    const app = ctx && ctx.app;
    const s = new host.AbstractInputSuggest(app, inputEl);
    ng16SuggestClasses(host, s.suggestEl, ctx);
    let manager = null;
    let token = 0;
    const getManager = () => {
      if (!manager && env().WI) {
        try { manager = new (env().WI)(app, () => (ctx && ctx.sourcePath) || ""); } catch (e) { manager = null; }
      }
      return manager;
    };
    s.getSuggestions = (query) => {
      const q = String(query || "");
      if (q.includes("[[")) {
        const mgr = getManager();
        if (!mgr || !mgr.getSuggestionsAsync) return [];
        const inner = q.slice(q.indexOf("[[") + 2);
        const my = ++token;
        const context = { isCancelled: () => my !== token };
        return (async () => {
          const list = await mgr.getSuggestionsAsync(context, inner);
          if (my !== token || !list || !list.length) return env().VI ? [env().VI] : [];
          const sorted = list.slice().sort(env().BI || ((a, b) => b.score - a.score));
          return sorted;
        })();
      }
      const items = ng16PropertyValueItems(host, app, ctx && ctx.key, q);
      if (suggestionFilter) return items.filter(suggestionFilter);
      return items;
    };
    s.renderSuggestion = (value, el) => {
      if (value && value.type === "text") { el.setText(value.value); return; }
      try {
        if (env().jI) { env().jI(value, el, false); return; }
      } catch (e) {}
      el.setText(value && (value.alias || value.path || value.value) || "");
    };
    s.selectSuggestion = (value, event) => {
      if (!value) return;
      s.close();
      if (value.type === "text") {
        if (onSelectLink) onSelectLink(value.value);
        return;
      }
      // link suggestion: build the [[…]] replacement through the shared link-info helper
      try {
        const keepText = "";
        const cursor = inputEl.selectionStart != null ? inputEl.selectionStart : 0;
        const end = inputEl.selectionEnd != null ? inputEl.selectionEnd : cursor;
        const replacement = env().UI
          ? env().UI(app, value, keepText, "", { line: 0, ch: cursor }, end, ctx && ctx.sourcePath || "", event && event.key, "frontmatter")
          : null;
        void replacement;
      } catch (e) {}
      const text = value.alias || value.path || value.heading || value.display || "";
      if (onSelectLink) onSelectLink(text);
    };
    return s;
  };
}

// ---- WikilinkSuggest (_I): editor [[…]] suggestions ------------------------------------

export function ng16DefineWikilinkSuggest(host) {
  return function (app) {
    const s = new host.EditorSuggest(app);
    let manager = null;
    let token = 0;
    const getManager = () => {
      if (!manager && env().WI) {
        try { manager = new (env().WI)(app, () => ""); } catch (e) { manager = null; }
      }
      return manager;
    };
    s.onTrigger = (cursor, editor, file) => {
      const line = editor.getLine(cursor.line);
      const before = line.slice(0, cursor.ch);
      const at = before.lastIndexOf("[[");
      if (at === -1) return null;
      const after = line.slice(cursor.ch);
      if (after.startsWith("]]")) return null;
      const query = before.slice(at + 2);
      if (query.includes("\n")) return null;
      return { start: { line: cursor.line, ch: at }, end: cursor, query };
    };
    s.getSuggestions = (context) => {
      const mgr = getManager();
      if (!mgr || !mgr.getSuggestionsAsync) return null;
      const my = ++token;
      const cancellable = { isCancelled: () => my !== token };
      return (async () => {
        const list = await mgr.getSuggestionsAsync(cancellable, context.query);
        if (my !== token) return null;
        if (!list || list.length === 0) return env().VI ? [env().VI] : null;
        return list.slice().sort(env().BI || ((a, b) => b.score - a.score));
      })();
    };
    s.renderSuggestion = (value, el) => {
      try {
        if (env().jI) { env().jI(value, el, mgrGlobal(mgrSafe(manager))); return; }
      } catch (e) {}
      el.setText(value && (value.alias || value.path || value.heading || value.display || "") || "");
    };
    function mgrSafe(m) { return m; }
    function mgrGlobal(m) { return !!(m && m.global); }
    s.selectSuggestion = (value, event) => {
      const context = s.context;
      if (!context) return;
      s.close();
      const editor = context.editor;
      try {
        const keepText = "";
        const cursor = context.end;
        const end = { line: cursor.line, ch: cursor.ch };
        const src = context.file ? context.file.path : "";
        const replacement = env().UI
          ? env().UI(s.app, value, keepText, "", cursor, end, src, event && event.key, "markdown")
          : null;
        void replacement;
      } catch (e) {}
      const text = value && value.type === "none" ? "" : (value.alias || value.path || value.heading || value.display || "");
      try {
        editor.replaceRange("[[" + text + "]]", context.start, context.end);
      } catch (e) {}
      try { editor.focus(); } catch (e) {}
    };
    return s;
  };
}

// ---- TagTriggerSuggest (YI): editor #tag suggestions -----------------------------------

export function ng16DefineTagTriggerSuggest(host) {
  const TAG_RE = /(^|\s)#[^ -⁯⸀-⹿'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\\s]*$/;
  return function (app) {
    const s = new host.EditorSuggest(app);
    s.onTrigger = (cursor, editor, file) => {
      const line = editor.getLine(cursor.line);
      const before = line.slice(0, cursor.ch);
      if (!TAG_RE.test(before)) return null;
      const hashPos = before.lastIndexOf("#");
      const query = before.slice(hashPos + 1);
      const nextChar = line[cursor.ch];
      if (nextChar === "#") return null;
      return { start: { line: cursor.line, ch: hashPos }, end: cursor, query };
    };
    s.getSuggestions = (context) => {
      try {
        return s06TagSuggestions(app.metadataCache, context.query, false, host);
      } catch (e) { return []; }
    };
    s.renderSuggestion = (value, el) => {
      try { host.renderResults(el, value.tag, value.matches); } catch (e) { el.setText("#" + value.tag); }
    };
    s.selectSuggestion = (value, event) => {
      const context = s.context;
      if (!context) return;
      s.close();
      const tag = "#" + ng16TagText(value.tag);
      const end = { line: context.end.line, ch: context.end.ch + (event && event.key === "Tab" ? 0 : 0) };
      try {
        context.editor.replaceRange(tag + " ", context.start, end);
        context.editor.focus();
      } catch (e) {}
    };
    return s;
  };
}
