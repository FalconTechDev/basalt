// Clean-room formula glue (g07, part L): the document search bar base, the
// formula completion suggester and the shared anonymous editor extension.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07ClsL = {};
function ng07OnceL(key, build) { return (ng07ClsL[key] ??= build()); }

// ---------------------------------------------------------- SearchBarBase

function ng07BuildSearchBarBase() {
  function SearchBarBase(containerEl) {
    this.containerEl = containerEl;
    this.scope = null;
    const doc = containerEl && containerEl.doc ? containerEl.doc : document;
    const root = doc.createElement("div");
    root.className = "document-search-container";
    const inputWrap = doc.createElement("div");
    inputWrap.className = "search-input-container";
    this.searchInputEl = doc.createElement("input");
    this.searchInputEl.className = "document-search-input";
    this.searchInputEl.placeholder = "Search";
    this.replaceInputEl = doc.createElement("input");
    this.replaceInputEl.className = "document-search-input";
    inputWrap.appendChild(this.searchInputEl);
    inputWrap.appendChild(this.replaceInputEl);
    this.countEl = doc.createElement("div");
    this.countEl.className = "document-search-count";
    const buttons = doc.createElement("div");
    buttons.className = "document-search-buttons";
    const mk = (cls, title, fn) => {
      const b = doc.createElement("button");
      b.className = cls + " text-icon-button";
      b.title = title;
      b.addEventListener("click", fn);
      buttons.appendChild(b);
      return b;
    };
    mk("document-search-previous", "Previous", () => this.findPrevious());
    mk("document-search-next", "Next", () => this.findNext());
    mk("document-search-close", "Close", () => this.hide());
    root.appendChild(inputWrap);
    root.appendChild(this.countEl);
    root.appendChild(buttons);
    if (containerEl) containerEl.appendChild(root);
    this.searchInputEl.addEventListener("input", () => this.onSearchInput());
    this.searchInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? this.onShiftEnter() : this.onEnter(); }
      else if (e.key === "Escape") { e.preventDefault(); this.hide(); }
      else if (e.key === "Tab") this.goToNextInput(e);
    });
  }
  SearchBarBase.prototype.getQuery = function () {
    return { query: this.searchInputEl.value, replace: this.replaceInputEl ? this.replaceInputEl.value : "" };
  };
  SearchBarBase.prototype.onSearchInput = function () { /* host hooks may override */ };
  SearchBarBase.prototype.findNext = function () { return this.findNextOrReplace(false); };
  SearchBarBase.prototype.findPrevious = function () { return this.findNextOrReplace(true); };
  SearchBarBase.prototype.findNextOrReplace = function () { return false; };
  SearchBarBase.prototype.onEnter = function () {};
  SearchBarBase.prototype.onShiftEnter = function () {};
  SearchBarBase.prototype.goToNextInput = function (e) {
    if (!e) return;
    e.preventDefault();
    const inputs = [this.searchInputEl, this.replaceInputEl].filter(Boolean);
    const i = inputs.indexOf(e.target);
    inputs[(i + 1) % inputs.length].focus();
  };
  SearchBarBase.prototype.hide = function () {
    if (this.containerEl && this.containerEl.parentNode) {
      const root = this.containerEl.querySelector(".document-search-container");
      if (root) root.remove();
    }
  };
  return SearchBarBase;
}
export function s08SearchBarBase(host) { ng07H(host); return ng07OnceL("SearchBarBase", ng07BuildSearchBarBase); }

// --------------------------------------------------------- FormulaSuggester

function ng07BuildFormulaSuggester() {
  function FormulaSuggester(ctx) {
    this.ctx = ctx;
  }
  /** Identifier-ish keys offered by the context (note props, globals, ...). */
  FormulaSuggester.prototype.contextKeys = function () {
    try { return this.ctx && typeof this.ctx.keys === "function" ? this.ctx.keys() : []; }
    catch (e) { return []; }
  };
  FormulaSuggester.prototype.getEncodedIdentifier = function (name) {
    return "note[" + JSON.stringify(name) + "]";
  };
  FormulaSuggester.prototype.expressionCompletions = function () {
    const out = [];
    const push = (label, type, apply) => out.push({ label, type: type || "text", apply });
    for (const key of this.contextKeys()) {
      push(key, "lucide-tag", (from, to, insert, cursor, hostGG) => {
        const enc = this.getEncodedIdentifier(key);
        if (hostGG) hostGG(from, to, insert, cursor, enc); else insert(enc);
      });
    }
    const registry = env().QW;
    if (registry && typeof registry.getAllGlobal === "function") {
      for (const fn of registry.getAllGlobal()) {
        if (fn && fn.name) push(fn.name, "lucide-function", null);
      }
    }
    return out;
  };
  /** CM6 completion source: (context) => {options, from, to} | null */
  FormulaSuggester.prototype.getCompletions = function (context) {
    const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_.[\]"]*/);
    if (!word || (word.from === word.to && !context.explicit)) return null;
    const completions = this.expressionCompletions().map((c) => ({
      label: c.label,
      type: c.type,
      apply: c.apply ? (view, completion, from, to) => c.apply(from, to, completion.label, null, null) : completion.label,
    }));
    return { from: word.from, options: completions, validFor: /^[A-Za-z0-9_.[\]"]*$/ };
  };
  return FormulaSuggester;
}
export function s08FormulaSuggester(host) { ng07H(host); return ng07OnceL("FormulaSuggester", ng07BuildFormulaSuggester); }

// ------------------------------------------------------------- RtInstance

/** `yG` declarator — shared anonymous editor extension instance (lazy). */
export function s08RtInstance(host) {
  return ng07OnceL("RtInstance", () => {
    try {
      const ac = env().s12reqAutocomplete;
      const auto = typeof ac === "function" ? ac : ac && ac.autocompletion;
      if (auto) return auto({ override: [(ctx) => new (s08FormulaSuggester(ng07Host))(ctx)] });
    } catch (e) { /* autocomplete unavailable */ }
    return [];
  });
}
