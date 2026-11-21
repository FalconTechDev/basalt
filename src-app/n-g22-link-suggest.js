// g22 clean-room: [[...]] link suggestions — file/alias/heading/block/display/global
// modes behind one async provider, plus the row renderer and apply helper.
// Own architecture: a query parser -> mode providers -> score-sorted result list;
// DOM rendering and text replacement are separate pure-ish helpers.

import { env } from "./env.js";
import { prepareQuery, fuzzyMatchJs } from "./search.js";
import { renderResults, prepareSimpleFinder } from "./search-simple.js";
import { plainHeading, linkSafeHeading } from "./text.js";
import { randomHex } from "./misc.js";
import { baseName } from "./path.js";

const NG22_FUZZY_LIMIT = 10000;

function ng22Cancelled(context) {
  return !!(context && typeof context.isCancelled === "function" && context.isCancelled());
}

function ng22ScoreDesc(a, b) { return (b.score || 0) - (a.score || 0); }

function ng22T(host) { return (host && host.t) || env().t || {}; }
function ng22LS(host) { const t = ng22T(host); return (t.editor && t.editor.linkSuggestion) || {}; }

function ng22LinktextFor(app, file, sourcePath) {
  const mc = app.metadataCache;
  if (mc && typeof mc.fileToLinktext === "function") {
    try { return mc.fileToLinktext(file, sourcePath, true) || file.path; } catch (e) {}
  }
  return String(file.path || "").replace(/\.md$/i, "");
}

function ng22MarkdownLinks(app) {
  try { return !!(app.vault.getConfig && app.vault.getConfig("useMarkdownLinks")); } catch (e) { return false; }
}

function ng22SourcePath(app, getSourcePath) {
  try {
    const p = typeof getSourcePath === "function" ? getSourcePath() : getSourcePath;
    return typeof p === "string" ? p : p && p.path || "";
  } catch (e) { return ""; }
}

// ------------------------------------------------------- heading suggestions ----

/**
 * Heading suggestions for a `#`-separated query inside `file`.
 * `path` is the resolved link path prefix; `query` the text typed after the last `#`.
 */
export function s20HeadingSuggestions(context, file, headings, path, query, host) {
  const out = [];
  const list = Array.isArray(headings) ? headings : [];
  const segments = String(query || "").split("#").filter((s) => s !== "");
  const lastEmpty = /#$/.test(String(query || "")) || String(query || "") === "";
  const leaf = segments.length ? segments[segments.length - 1] : "";
  const prepared = leaf ? prepareQuery(leaf) : null;
  const prefix = segments.slice(0, -1);

  // candidate headings: those whose plain text fuzzy-matches the leaf segment and
  // whose ancestor chain matches the earlier segments
  for (const h of list) {
    if (ng22Cancelled(context)) return out;
    if (!h || h.type === "block") continue;
    const text = plainHeading(h.heading || "");
    let score = 0;
    let matches = null;
    if (leaf) {
      const m = fuzzyMatchJs(prepared, text);
      if (!m) continue;
      score = m.score;
      matches = m.matches;
    } else {
      score = -((h.level || 1) * 0.001);
    }
    // verify ancestor path: walk earlier segments against preceding headings
    let ancestorPath = "";
    if (prefix.length) {
      const idx = list.indexOf(h);
      const ancestors = [];
      let lvl = h.level || 1;
      for (let i = idx - 1; i >= 0 && ancestors.length < prefix.length; i--) {
        const p = list[i];
        if ((p.level || 1) < lvl) { ancestors.unshift(p); lvl = p.level || 1; }
      }
      let ok = ancestors.length >= prefix.length;
      for (let i = 0; ok && i < prefix.length; i++) {
        const want = prefix[i].toLowerCase();
        const got = plainHeading(ancestors[ancestors.length - prefix.length + i].heading || "").toLowerCase();
        ok = got === want || got.includes(want);
      }
      if (!ok) continue;
      ancestorPath = ancestors.slice(ancestors.length - prefix.length)
        .map((a) => "#" + linkSafeHeading(a.heading || "")).join("");
    }
    const safe = linkSafeHeading(h.heading || "");
    const sub = (path || "") + ancestorPath + "#" + safe;
    out.push({
      type: "heading", heading: h.heading, level: h.level, subpath: sub,
      path, file, score, matches, position: h.position,
    });
  }
  if (lastEmpty && !leaf) {
    out.push({ type: "heading", heading: "", subpath: (path || "") + "#", path, file, score: -1, matches: null });
  }
  out.sort(ng22ScoreDesc);
  return out;
}
// ---------------------------------------------------------- block suggestions ----

function ng22MatchBlock(block, query, prepared) {
  const q = String(query || "").trim();
  if (!q) return { score: -0.001, matches: null };
  const node = block && block.node;
  if (node && node.id && String(node.id).toLowerCase() === q.toLowerCase().replace(/^\^/, "")) {
    return { score: 0, matches: [[0, q.length]] };
  }
  const display = block && block.display || "";
  const m = fuzzyMatchJs(prepared, display);
  if (m) return m;
  if (node && node.id) {
    const mi = fuzzyMatchJs(prepared, String(node.id));
    if (mi) return { score: mi.score - 0.5, matches: mi.matches };
  }
  return null;
}

/** Block suggestions from a BlockCache entry `{content, blocks}`. */
export function s20BlockSuggestions(context, file, path, blocksData, query, host) {
  const out = [];
  const data = blocksData || {};
  const list = Array.isArray(data.blocks) ? data.blocks : [];
  const q = String(query || "").trim().replace(/^\^/, "");
  const prepared = q ? prepareQuery(q) : null;
  const sourcePos = context && context.sourcePosition;
  for (const block of list) {
    if (ng22Cancelled(context)) return out;
    if (sourcePos && block.position && block.position.start && block.position.start.offset != null) {
      const s = block.position.start.offset;
      const e = block.position.end && block.position.end.offset != null ? block.position.end.offset : s;
      if (sourcePos.offset >= s && sourcePos.offset <= e) continue;
    }
    const m = ng22MatchBlock(block, q, prepared);
    if (!m) continue;
    const id = block.node && block.node.id;
    out.push({
      type: "block", display: block.display, content: block.content || block.display,
      node: block.node, file, path, score: m.score, matches: m.matches,
      position: block.position, blockId: id || null,
    });
  }
  out.sort(ng22ScoreDesc);
  return out;
}

// --------------------------------------------------------- suggestion render ----

/** Renders one suggestion row (the `.mod-complex` contract used by the editor). */
export function s20RenderSectionSuggestion(suggestion, el, showNote, host) {
  const ls = ng22LS(host);
  el.addClass("mod-complex");
  if (suggestion && suggestion.downranked) el.addClass("mod-downranked");
  const content = el.createDiv("suggestion-content");
  const aux = el.createDiv("suggestion-aux");
  const title = content.createDiv("suggestion-title");
  const note = content.createDiv("suggestion-note");
  const type = suggestion && suggestion.type;

  if (type === "none" || type == null) {
    title.setText(ls.labelNoMatchFound ? ls.labelNoMatchFound() : "Nothing matches");
    return;
  }
  if (type === "file") {
    const path = suggestion.path || (suggestion.file && suggestion.file.path) || "";
    renderResults(title, baseName(path), suggestion);
    if (showNote && suggestion.file && suggestion.file.parent && !suggestion.file.parent.isRoot()) {
      note.setText(suggestion.file.parent.path);
    }
    aux.createSpan({ cls: "suggestion-flair" }, (flair) => {
      try { host.setIcon(flair, "lucide-link"); } catch (e) {}
    });
    return;
  }
  if (type === "alias") {
    const alias = suggestion.alias || "";
    title.setText(alias || (ls.labelNoAlias ? ls.labelNoAlias() : "Displayed text"));
    if (alias) renderResults(title, alias, suggestion);
    if (showNote !== false && suggestion.path) note.setText(suggestion.path);
    aux.createSpan({ cls: "suggestion-flair" }, (flair) => {
      try { host.setIcon(flair, "lucide-forward"); } catch (e) {}
      try { if (host.setElementTooltip) host.setElementTooltip(flair, "Alias"); } catch (e) {}
    });
    return;
  }
  if (type === "linktext") {
    const text = suggestion.linktext || "";
    title.setText(text);
    renderResults(title, text, suggestion);
    return;
  }
  if (type === "heading") {
    const heading = suggestion.heading || "";
    if (!heading) {
      title.createSpan({ cls: "suggestion-empty-suggestion", text: ls.labelNoHeading ? ls.labelNoHeading() : "Heading" });
    } else {
      const text = "#" + heading;
      title.setText(text);
      renderResults(title, text, suggestion);
    }
    if (showNote !== false && suggestion.path) note.setText(suggestion.path);
    return;
  }
  if (type === "block") {
    const display = suggestion.display || suggestion.content || "";
    title.setText(display);
    renderResults(title, display, suggestion);
    if (showNote !== false && suggestion.path) note.setText(suggestion.path);
    aux.createSpan({ cls: "suggestion-flair" }, (flair) => {
      try { host.setIcon(flair, "lucide-corner-down-right"); } catch (e) {}
    });
    return;
  }
  if (type === "bases-view" || type === "view") {
    title.setText(suggestion.name || suggestion.view || "");
    const vt = suggestion.viewType || suggestion.type2;
    if (vt) note.setText(vt);
    return;
  }
  const text = suggestion.text || suggestion.display || suggestion.path || "";
  title.setText(text);
  renderResults(title, text, suggestion);
}
// ------------------------------------------------------------- apply ----

function ng22InnerFor(app, suggestion, sourcePath, displayTail) {
  const type = suggestion && suggestion.type;
  const path = suggestion && (suggestion.subpath || suggestion.path) || "";
  if (type === "heading") {
    const sub = suggestion.subpath || (path + "#" + linkSafeHeading(suggestion.heading || ""));
    return sub;
  }
  if (type === "block") {
    const id = suggestion.blockId || (suggestion.node && suggestion.node.id) || randomHex(6);
    suggestion._mintedBlockId = suggestion.blockId ? null : id;
    return path + "^" + id;
  }
  if (type === "alias" || type === "display") {
    const alias = suggestion.alias != null ? suggestion.alias : displayTail;
    return alias ? path + "|" + alias : path;
  }
  if (type === "bases-view" || type === "view") {
    const name = suggestion.name || suggestion.view || "";
    return path + "#" + name;
  }
  return path;
}

/**
 * Computes the replacement for accepting `suggestion`.
 * keepText: link text typed before the caret (inside the brackets).
 * tailText: line text after the caret (wikilink mode) or whole value (frontmatter).
 * cursor/end: caret offset and link-end offset in the caller's coordinate space.
 * key: the key that accepted ("Enter"/"Tab" or "#"/"^"/"|").
 */
export function s20ApplyLinkSuggestion(app, suggestion, keepText, tailText, cursor, end, sourcePath, key, mode, host) {
  const type = suggestion && suggestion.type;
  const tail = String(tailText || "");
  // locate the "[[" opener: two chars before keepText ends at the caret `end`
  let start = end - String(keepText || "").length - 2;
  if (start < 0) start = 0;
  let regionEnd = end;
  if (tail.slice(0, 2) === "]]") regionEnd = end + 2;
  const displayTail = (() => {
    const k = String(keepText || "");
    const i = k.indexOf("|");
    return i >= 0 ? k.slice(i + 1) : "";
  })();

  if (type === "none" || suggestion == null) {
    const inner = String(keepText || "");
    const replacement = "[[" + inner + "]]";
    return { replacement, start, end: regionEnd, selectionStart: start + replacement.length - 2, selectionEnd: start + replacement.length - 2, blockId: null };
  }

  const inner = ng22InnerFor(app, suggestion, sourcePath, displayTail);
  const marker = key === "#" ? "#" : key === "^" ? "^" : key === "|" ? "|" : "";
  const replacement = marker ? "[[" + inner + marker : "[[" + inner + "]]";
  const sel = start + replacement.length - (marker ? 0 : 2);
  const blockId = type === "block" ? (suggestion.blockId || suggestion._mintedBlockId || null) : null;
  return { replacement, start, end: regionEnd, selectionStart: sel, selectionEnd: sel, blockId };
}

// ------------------------------------------------------- LinkSuggestManager ----

function ng22DefineLinkSuggestManager(host) {
  function LinkSuggestManager(app, getSourcePath) {
    this.app = app;
    this.getSourcePath = getSourcePath;
    this.mode = "file";
    this.global = false;
    this.fileSuggestions = null;
    this.runnable = null;
  }
  const P = LinkSuggestManager.prototype;

  P.getInstructions = function () {
    const ls = ng22LS(host);
    if (this.mode === "file") {
      return [
        { command: ls.labelTypeHash ? ls.labelTypeHash() : "#", purpose: ls.labelLinkHeading ? ls.labelLinkHeading() : "" },
        { command: ls.labelTypeBlock ? ls.labelTypeBlock() : "^", purpose: ls.labelLinkBlock ? ls.labelLinkBlock() : "" },
        { command: ls.labelTypePipe ? ls.labelTypePipe() : "|", purpose: ls.labelChangeDisplayText ? ls.labelChangeDisplayText() : "" },
      ];
    }
    return [{ command: "↵", purpose: ls.labelAccept ? ls.labelAccept() : "" }];
  };

  P._parseQuery = function (query) {
    const q = String(query || "");
    // global modes first
    if (q.startsWith("##")) return { mode: "heading", global: true, fileQuery: "", subQuery: q.slice(2) };
    if (q.startsWith("^^")) return { mode: "block", global: true, fileQuery: "", subQuery: q.slice(2) };
    // display mode: text after the first "|"
    const pipe = q.indexOf("|");
    if (pipe >= 0) return { mode: "display", global: false, fileQuery: q.slice(0, pipe), subQuery: q.slice(pipe + 1) };
    // heading/block subpath: earliest of "#" / "^"
    const h = q.indexOf("#");
    const b = q.indexOf("^");
    if (h >= 0 && (b < 0 || h < b)) return { mode: "heading", global: false, fileQuery: q.slice(0, h), subQuery: q.slice(h + 1) };
    if (b >= 0) return { mode: "block", global: false, fileQuery: q.slice(0, b), subQuery: q.slice(b + 1) };
    return { mode: "file", global: false, fileQuery: q, subQuery: "" };
  };

  P.getSuggestionsAsync = async function (context, query) {
    const parsed = this._parseQuery(query);
    this.mode = parsed.mode;
    this.global = !!parsed.global;
    const sourcePath = ng22SourcePath(this.app, this.getSourcePath);
    let results;
    if (parsed.mode === "file") {
      results = await this.getFileSuggestions(context, parsed.fileQuery);
    } else if (parsed.mode === "display") {
      results = await this.getDisplaySuggestions(context, parsed.fileQuery, parsed.subQuery);
    } else if (parsed.mode === "heading") {
      results = parsed.global
        ? await this.getGlobalHeadingSuggestions(context, parsed.subQuery)
        : await this.getHeadingSuggestions(context, parsed.fileQuery, parsed.subQuery);
    } else {
      results = parsed.global
        ? await this.getGlobalBlockSuggestions(context, parsed.subQuery)
        : await this.getBlockSuggestions(context, parsed.fileQuery, parsed.subQuery);
    }
    if (ng22Cancelled(context)) return null;
    results = (results || []).slice().sort(ng22ScoreDesc);
    return results;
  };

  // ---------------------------------------------------------- file mode ----

  P._allFileSuggestions = function () {
    if (this.fileSuggestions) return this.fileSuggestions;
    const mc = this.app.metadataCache;
    const list = mc && typeof mc.getLinkSuggestions === "function" ? mc.getLinkSuggestions() : [];
    // empty-query ordering: files by mtime desc, then aliases, then linktexts
    for (const s of list) {
      const f = s.file;
      const mtime = f && f.stat && f.stat.mtime || 0;
      if (s.type === "file") s.score = mtime;
      else if (s.type === "alias") s.score = mtime - 0.5;
      else s.score = 0;
      s.matches = null;
    }
    list.sort(ng22ScoreDesc);
    this.fileSuggestions = list;
    return list;
  };

  P._matchFileSuggestion = function (s, query) {
    const mc = this.app.metadataCache;
    const ignored = mc && mc.isUserIgnored && s.file ? mc.isUserIgnored(s.file.path) : false;
    if (!query) {
      if (ignored) return null; // ignored files skipped entirely for empty queries
      return s;
    }
    const text = s.type === "alias" ? (s.alias || "") : s.type === "linktext" ? (s.linktext || "") : (s.path || "");
    const path = s.path || "";
    const base = path.split("/").pop();
    // prefer basename matches (shifted highlight), then full-path matches (-1 penalty)
    let match = null;
    let offset = 0;
    let penalty = 0;
    const prepared = prepareQuery(query);
    const onBase = base ? fuzzyMatchJs(prepared, base) : null;
    const onPath = path ? fuzzyMatchJs(prepared, path) : null;
    const onText = text && text !== path ? fuzzyMatchJs(prepared, text) : null;
    if (onBase && (!onPath || onBase.score >= onPath.score)) {
      match = onBase; offset = path.length - base.length; penalty = 0;
    } else if (onPath) {
      match = onPath; offset = 0; penalty = 1;
    } else if (onText) {
      match = onText; offset = 0; penalty = 0.5;
    } else if (s.type === "linktext") {
      const lm = fuzzyMatchJs(prepared, s.linktext || "");
      if (lm) { match = lm; offset = 0; penalty = 0; }
    }
    if (!match) return null;
    const out = Object.assign({}, s, {
      score: match.score - penalty - (ignored ? 10 : 0),
      matches: match.matches ? match.matches.map((r) => [r[0] + offset, r[1] + offset]) : null,
    });
    if (ignored) out.downranked = true;
    return out;
  };

  P.getFileSuggestions = async function (context, query) {
    const all = this._allFileSuggestions();
    const q = String(query || "").trim();
    const out = [];
    if (!q) {
      for (const s of all) {
        if (ng22Cancelled(context)) return out;
        const m = this._matchFileSuggestion(s, "");
        if (m) out.push(m);
      }
      return out;
    }
    if (all.length < NG22_FUZZY_LIMIT) {
      for (const s of all) {
        if (ng22Cancelled(context)) return out;
        const m = this._matchFileSuggestion(s, q);
        if (m) out.push(m);
      }
    } else {
      const finder = prepareSimpleFinder(q);
      for (const s of all) {
        if (ng22Cancelled(context)) return out;
        const text = s.type === "alias" ? s.alias : s.type === "linktext" ? s.linktext : s.path;
        const m = finder(text || "");
        if (m) out.push(Object.assign({}, s, { score: m.score, matches: m.matches }));
      }
    }
    return out;
  };

  // -------------------------------------------------------- display mode ----

  P.getDisplaySuggestions = async function (context, fileQuery, displayQuery) {
    const app = this.app;
    const sourcePath = ng22SourcePath(app, this.getSourcePath);
    const out = [];
    const file = app.metadataCache.getFirstLinkpathDest(fileQuery, sourcePath);
    const linktext = file ? ng22LinktextFor(app, file, sourcePath) : fileQuery;
    const q = String(displayQuery || "").trim();
    const prepared = q ? prepareQuery(q) : null;
    const push = (alias) => {
      let score = 0, matches = null;
      if (q) {
        const m = fuzzyMatchJs(prepared, alias || "");
        if (!m) return;
        score = m.score; matches = m.matches;
      }
      out.push({ type: "alias", path: linktext, alias: alias || "", file, score, matches });
    };
    if (file) {
      const cache = app.metadataCache.getFileCache(file);
      const fm = cache && cache.frontmatter;
      const aliases = fm && fm.aliases;
      const list = Array.isArray(aliases) ? aliases : aliases != null ? String(aliases).split(",") : [];
      for (const a of list) {
        if (ng22Cancelled(context)) return out;
        push(String(a).trim());
      }
      // tags also work as display text in wikilinks
      const tags = fm && fm.tags;
      const tlist = Array.isArray(tags) ? tags : tags != null ? String(tags).split(/[\s,]+/) : [];
      for (const tg of tlist) {
        if (ng22Cancelled(context)) return out;
        const tag = String(tg).trim().replace(/^#/, "");
        if (tag) push(tag);
      }
    }
    // unresolved linktexts that start with the file query can serve as display text
    if (!file && q === "") push("");
    out.sort(ng22ScoreDesc);
    return out;
  };

  // ------------------------------------------------------- heading mode ----

  P._fileForQuery = function (fileQuery) {
    const app = this.app;
    const sourcePath = ng22SourcePath(app, this.getSourcePath);
    const mc = app.metadataCache;
    if (fileQuery === "") {
      const src = sourcePath && app.vault.getAbstractFileByPath(sourcePath);
      return src || null;
    }
    return mc.getFirstLinkpathDest(fileQuery, sourcePath);
  };

  P._headingSuggestionsFor = function (context, file, fileQuery, subQuery) {
    if (!file) return [];
    const cache = this.app.metadataCache.getFileCache(file);
    const headings = cache && Array.isArray(cache.headings) ? cache.headings : [];
    const linktext = ng22LinktextFor(this.app, file, ng22SourcePath(this.app, this.getSourcePath));
    return s20HeadingSuggestions(context, file, headings, linktext, subQuery, host);
  };

  P.getHeadingSuggestions = async function (context, fileQuery, subQuery) {
    const out = [];
    const file = this._fileForQuery(fileQuery);
    const local = this._headingSuggestionsFor(context, file, fileQuery, subQuery);
    for (const s of local) {
      if (ng22Cancelled(context)) return out;
      // .base view suggestions ride along when the resolved file is a base
      out.push(s);
    }
    if (file && /\.base$/i.test(file.path || "")) {
      out.push(...this._baseViewSuggestions(context, file, fileQuery));
    }
    return out;
  };

  P._baseViewSuggestions = function (context, file, fileQuery) {
    const out = [];
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache && cache.frontmatter;
    const views = fm && fm.views;
    const list = Array.isArray(views) ? views : views && typeof views === "object" ? Object.keys(views).map((k) => ({ name: k, ...views[k] })) : [];
    let icon = "lucide-file-question";
    try {
      const bases = this.app.plugins && this.app.plugins.getPlugin && this.app.plugins.getPlugin("bases");
      if (bases && bases.viewTypeIcon) icon = bases.viewTypeIcon;
    } catch (e) {}
    for (const v of list) {
      if (ng22Cancelled(context)) return out;
      const name = typeof v === "string" ? v : v && (v.name || v.id) || "";
      if (!name) continue;
      out.push({
        type: "bases-view", name, view: name, viewType: (v && v.type) || "", icon,
        path: ng22LinktextFor(this.app, file, ng22SourcePath(this.app, this.getSourcePath)),
        file, score: -0.01, matches: null,
      });
    }
    return out;
  };

  P.getGlobalHeadingSuggestions = async function (context, query) {
    const out = [];
    const mc = this.app.metadataCache;
    const files = this.app.vault.getMarkdownFiles ? this.app.vault.getMarkdownFiles() : [];
    const q = String(query || "").trim();
    for (const file of files) {
      if (ng22Cancelled(context)) return out;
      if (mc.isUserIgnored && mc.isUserIgnored(file.path)) continue;
      const cache = mc.getFileCache(file);
      const headings = cache && Array.isArray(cache.headings) ? cache.headings : [];
      const linktext = ng22LinktextFor(this.app, file, "");
      const local = s20HeadingSuggestions(context, file, headings, linktext, q, host);
      for (const s of local) {
        if (!q || s.heading) out.push(s);
      }
      if (file.path && /\.base$/i.test(file.path)) {
        for (const v of this._baseViewSuggestions(context, file, "")) out.push(v);
      }
    }
    // drop the synthetic empty-heading rows in global mode unless query is empty
    return out.filter((s) => s.type !== "heading" || s.heading || !q);
  };

  // ---------------------------------------------------------- block mode ----

  P.matchBlock = function (block, query) {
    const q = String(query || "").trim().replace(/^\^/, "");
    if (!q) return { score: -0.001, matches: null };
    return ng22MatchBlock(block, q, prepareQuery(q));
  };

  P._blockEntryFor = async function (context, fileQuery) {
    const file = this._fileForQuery(fileQuery);
    if (!file) return null;
    const bc = this.app.metadataCache.blockCache;
    if (!bc || typeof bc.getForFile !== "function") return null;
    return bc.getForFile(context, file);
  };

  P.getBlockSuggestions = async function (context, fileQuery, subQuery) {
    const out = [];
    const entry = await this._blockEntryFor(context, fileQuery);
    if (!entry || ng22Cancelled(context)) return out;
    const sourcePath = ng22SourcePath(this.app, this.getSourcePath);
    const linktext = ng22LinktextFor(this.app, entry.file, sourcePath);
    const local = s20BlockSuggestions(context, entry.file, linktext, entry, subQuery, host);
    for (const s of local) {
      if (ng22Cancelled(context)) return out;
      out.push(s);
    }
    return out;
  };

  P.getGlobalBlockSuggestions = async function (context, query) {
    const out = [];
    const bc = this.app.metadataCache.blockCache;
    if (!bc || typeof bc.getAll !== "function") return out;
    const q = String(query || "").trim().replace(/^\^/, "");
    for await (const entry of bc.getAll(context)) {
      if (ng22Cancelled(context)) return out;
      if (!entry || !entry.file) continue;
      const mc = this.app.metadataCache;
      if (mc.isUserIgnored && mc.isUserIgnored(entry.file.path)) continue;
      const linktext = ng22LinktextFor(this.app, entry.file, "");
      const local = s20BlockSuggestions(context, entry.file, linktext, entry, q, host);
      for (const s of local) out.push(s);
    }
    return out;
  };

  return LinkSuggestManager;
}

export function defineS20LinkSuggestManager(host) {
  return ng22DefineLinkSuggestManager(host);
}

