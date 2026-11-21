// g36 clean-room: editor suggests (spec g36 Part B) — the footnote reference
// suggester and the workspace EditorSuggestManager that owns link/tag/footnote.

import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { prepareQuery, fuzzyMatchJs } from "./search.js";
import { s05NextFootnoteId } from "./s05-utils.js";

const NG36_INLINE_PREFIX = "[inline";

// ---------------------------------------------------------------------------
// FootnoteSuggest
// ---------------------------------------------------------------------------

export function ng36FootnoteSuggest(host) {
  function FootnoteSuggest(app) {
    const self = host.EditorSuggest.call(this, app) || this;
    self.runnable = null;
    return self;
  }
  inherit(FootnoteSuggest, host.EditorSuggest);
  const proto = FootnoteSuggest.prototype;

  /**
   * Triggers on `[^` references. The range starts at `[`, extends through a
   * closing `]` when the cursor sits on it, and is suppressed inside footnote
   * definitions (`[^x]:`) or when preceded by another `[`.
   */
  proto.onTrigger = function (cursor, editor, file) {
    const line = editor.getLine(cursor.line);
    const ch = cursor.ch;
    const idx = line.slice(0, ch).lastIndexOf("[^");
    if (idx < 0) return null;
    if (idx > 0 && line.charAt(idx - 1) === "[") return null;
    if (ch < idx + 2) return null;
    const close = line.indexOf("]", idx + 2);
    if (close >= 0) {
      if (ch > close + 1) return null;
      if (line.charAt(close + 1) === ":") return null;
    }
    const queryEnd = close >= 0 ? Math.min(ch, close) : ch;
    const query = line.slice(idx + 2, queryEnd);
    let endCh = ch;
    if (close < 0 || ch <= close) {
      if (line.charAt(ch) === "]") endCh = ch + 1;
    }
    return {
      start: { line: cursor.line, ch: idx },
      end: { line: cursor.line, ch: endCh },
      query,
    };
  };

  proto.getSuggestions = async function (context) {
    if (this.runnable) { try { this.runnable.cancel(); } catch (e) { /* noop */ } }
    const runnable = (this.runnable = new host.Runnable());
    if (!context || !context.file) return null;
    const app = this.app;
    let content;
    try { content = await app.vault.cachedRead(context.file); } catch (e) { return null; }
    if (content == null) {
      try { content = await app.vault.read(context.file); } catch (e) { return null; }
    }
    if (runnable.isCancelled()) return null;
    const cache = app.metadataCache.getFileCache(context.file);
    const raw = cache && cache.footnotes;
    const footnotes = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? Object.values(raw) : []);
    const prepared = prepareQuery(context.query || "");
    const out = [];
    for (const note of footnotes) {
      if (!note || typeof note.id !== "string" || note.id.startsWith(NG36_INLINE_PREFIX)) continue;
      const pos = note.position;
      if (!pos || !pos.start || !pos.end) continue;
      const text = content.substring(pos.start.offset, pos.end.offset);
      const hit = fuzzyMatchJs(prepared, text);
      if (hit) out.push({ id: note.id, footnote: text, score: hit.score, matches: hit.matches, type: "match" });
    }
    if (!context.query) {
      const id = String(s05NextFootnoteId(cache));
      out.push({
        id,
        type: "create",
        score: 1,
        matches: [],
        footnote: "[^" + id + "]: " + host.i18n.editor.linkSuggestion.labelNewFootnote(),
      });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  };

  proto.selectSuggestion = function (suggestion) {
    this.close();
    const ctx = this.context;
    if (!ctx || !ctx.editor) return;
    const editor = ctx.editor;
    if (suggestion && suggestion.type === "create") {
      editor.replaceRange("", ctx.start, ctx.end);
      editor.insertFootnote();
      return;
    }
    if (suggestion && suggestion.type === "match") {
      const text = "[^" + suggestion.id + "]";
      editor.transaction({
        changes: [{ from: ctx.start, to: ctx.end, text }],
        selection: { from: { line: ctx.start.line, ch: ctx.start.ch + text.length } },
      });
      env().activeWindow.setTimeout(() => editor.focus(), 0);
    }
  };

  return FootnoteSuggest;
}

// ---------------------------------------------------------------------------
// EditorSuggestManager
// ---------------------------------------------------------------------------

export function ng36EditorSuggestManager(host) {
  function EditorSuggestManager(app) {
    const self = this;
    const e = env();
    self.app = app;
    self.suggests = [
      new (e._I)(app),
      new ((e.YI || e._YI))(app),
      new (e.d0)(app),
    ];
    self.currentSuggest = null;
    return self;
  }

  EditorSuggestManager.prototype.trigger = function (editor, context, forceOpen) {
    if (!editor || !editor.cm || !editor.cm.hasFocus) return;
    let winner = null;
    for (const suggest of this.suggests) {
      if (suggest.trigger(editor, context)) { winner = suggest; break; }
    }
    if (!winner) { this.close(); return; }
    this.setCurrentSuggest(forceOpen || winner.isOpen ? winner : null);
  };

  EditorSuggestManager.prototype.setCurrentSuggest = function (suggest) {
    if (suggest === this.currentSuggest) return;
    if (this.currentSuggest) this.currentSuggest.close();
    this.currentSuggest = suggest || null;
  };

  EditorSuggestManager.prototype.removeSuggest = function (suggest) {
    if (this.currentSuggest === suggest) this.close();
    const i = this.suggests.indexOf(suggest);
    if (i >= 0) this.suggests.splice(i, 1);
  };

  EditorSuggestManager.prototype.isShowingSuggestion = function () {
    return !!(this.currentSuggest && this.currentSuggest.isOpen);
  };

  EditorSuggestManager.prototype.reposition = function () {
    const s = this.currentSuggest;
    if (s && s.isOpen && typeof s.updatePosition === "function") s.updatePosition();
  };

  EditorSuggestManager.prototype.close = function () {
    if (this.currentSuggest) {
      this.currentSuggest.close();
      this.currentSuggest = null;
    }
  };

  return EditorSuggestManager;
}
