// g22 clean-room: suggestion widgets.
// Own architecture: one SuggestionList renderer shared by modals, popovers and
// editor suggests; chooser objects implement renderSuggestion/selectSuggestion.
// DOM classes, keyboard semantics and limits follow the spec contract.

import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { prepareQuery, fuzzyMatchJs } from "./search.js";
import { renderResults } from "./search-simple.js";

const ng22Win = () => env().activeWindow || globalThis;
const ng22Doc = () => env().activeDocument || globalThis.document;

// ---------------------------------------------------------------- SuggestionList ----

class Ng22SuggestionList {
  constructor(chooser, containerEl, scope) {
    this.chooser = chooser;
    this.containerEl = containerEl;
    this.scope = scope;
    this.values = [];
    this.suggestions = [];
    this.selectedItem = -1;
    this.selectOnHover = true;
    this._rows = [];
    this._extras = [];
    if (scope) {
      const nav = (fn) => (event) => { fn.call(this); return false; };
      scope.register([], "ArrowUp", nav(this.moveUp));
      scope.register([], "ArrowDown", nav(this.moveDown));
      scope.register([], "PageUp", nav(this.pageUp));
      scope.register([], "PageDown", nav(this.pageDown));
      scope.register([], "Home", nav(this.moveToFirst));
      scope.register([], "End", nav(this.moveToLast));
      if (env().Yl && env().Yl.isMacOS) {
        scope.register(["Mod"], "p", nav(this.moveUp));
        scope.register(["Mod"], "n", nav(this.moveDown));
      }
    }
  }

  shouldSelectOnHover(value) { this.selectOnHover = value !== false; return this; }

  setSuggestions(values) {
    this.values = values || [];
    this.suggestions = this.values.slice();
    this.renderSuggestions();
    this.setSelectedItem(this.values.length ? 0 : -1);
    return this;
  }

  addSuggestion(value) { this.values.push(value); this.suggestions.push(value); this._renderOne(value, this.values.length - 1); }

  addMessage(text) {
    const el = this.containerEl.createDiv("suggestion-empty");
    el.setText(text == null ? "" : String(text));
    this._extras.push(el);
    return el;
  }

  renderSuggestions() {
    const container = this.containerEl;
    container.empty();
    this._rows = [];
    this._extras = [];
    for (let i = 0; i < this.values.length; i++) this._renderOne(this.values[i], i);
    this._applySelection();
  }

  _renderOne(value, index) {
    const el = this.containerEl.createDiv("suggestion-item");
    try { this.chooser.renderSuggestion(value, el); } catch (e) { el.setText(""); }
    el.addEventListener("click", (event) => this.onSuggestionClick(event, index));
    el.addEventListener("auxclick", (event) => { if (event.button === 1) this.onSuggestionClick(event, index); });
    el.addEventListener("mouseover", (event) => this.onSuggestionMouseover(event, index));
    this._rows[index] = el;
    return el;
  }

  _applySelection() {
    for (let i = 0; i < this._rows.length; i++) {
      const row = this._rows[i];
      if (!row) continue;
      row.toggleClass("is-selected", i === this.selectedItem);
      if (i === this.selectedItem && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
    }
  }

  getSelectedElement() { return this.selectedItem >= 0 ? this._rows[this.selectedItem] || null : null; }
  getSelectedValue() { return this.selectedItem >= 0 ? this.values[this.selectedItem] ?? null : null; }

  rowHeight() {
    const row = this._rows.find((r) => r && r.offsetHeight);
    return row ? row.offsetHeight : 40;
  }
  numVisibleItems() {
    const h = this.containerEl.clientHeight || 0;
    return Math.max(1, Math.floor(h / this.rowHeight()));
  }
  firstVisibleIndex() {
    return Math.max(0, Math.floor((this.containerEl.scrollTop || 0) / this.rowHeight()));
  }

  setSelectedItem(index, event) { return this._setSelected(index, true, event); }
  forceSetSelectedItem(index, event) { return this._setSelected(index, false, event); }

  _setSelected(index, fireCallback, event) {
    const len = this.values.length;
    if (len === 0) index = -1;
    else {
      index = ((index % len) + len) % len;
      if (!Number.isFinite(index)) index = 0;
    }
    const changed = index !== this.selectedItem;
    this.selectedItem = index;
    this._applySelection();
    if (changed && fireCallback && index >= 0 && this.chooser.onSelectedChange) {
      try { this.chooser.onSelectedChange(this.values[index], event); } catch (e) {}
    }
    return index;
  }

  moveUp() { if (this.values.length) this.setSelectedItem(this.selectedItem <= 0 ? this.values.length - 1 : this.selectedItem - 1); }
  moveDown() { if (this.values.length) this.setSelectedItem(this.selectedItem < 0 ? 0 : (this.selectedItem + 1) % this.values.length); }
  moveToFirst() { if (this.values.length) this.setSelectedItem(0); }
  moveToLast() { if (this.values.length) this.setSelectedItem(this.values.length - 1); }
  pageUp() { this.setSelectedItem(this.selectedItem - this.numVisibleItems()); }
  pageDown() { this.setSelectedItem(this.selectedItem + this.numVisibleItems()); }

  onSuggestionMouseover(event, index) {
    if (!this.selectOnHover || event.buttons) return;
    if (index !== this.selectedItem) this.setSelectedItem(index, event);
  }

  onSuggestionClick(event, index) {
    event.preventDefault();
    this.setSelectedItem(index, event);
    this.useSelectedItem(event);
  }

  useSelectedItem(event) {
    const index = this.selectedItem;
    if (index < 0 || index >= this.values.length) return false;
    const value = this.values[index];
    if (value === undefined) return false;
    if (this.chooser.selectSuggestion) this.chooser.selectSuggestion(value, event);
    else if (this.chooser.onChooseSuggestion) this.chooser.onChooseSuggestion(value, event);
    return true;
  }
}

// Grouped variant: consecutive values sharing `value.group` render inside
// .suggestion-group[data-group] wrappers.
class Ng22GroupedSuggestionList extends Ng22SuggestionList {
  renderSuggestions() {
    const container = this.containerEl;
    container.empty();
    this._rows = [];
    this._extras = [];
    let groupEl = null;
    let groupName = Symbol("none");
    for (let i = 0; i < this.values.length; i++) {
      const value = this.values[i];
      const name = value && value.group != null ? String(value.group) : null;
      if (name !== groupName) {
        groupName = name;
        groupEl = container.createDiv("suggestion-group");
        if (name !== null) groupEl.setAttribute("data-group", name);
      }
      const hostEl = groupEl || container;
      const el = hostEl.createDiv("suggestion-item");
      try { this.chooser.renderSuggestion(value, el); } catch (e) { el.setText(""); }
      el.addEventListener("click", (event) => this.onSuggestionClick(event, i));
      el.addEventListener("auxclick", (event) => { if (event.button === 1) this.onSuggestionClick(event, i); });
      el.addEventListener("mouseover", (event) => this.onSuggestionMouseover(event, i));
      this._rows[i] = el;
    }
    this._applySelection();
  }
}
// ---------------------------------------------------------------- SuggestModal ----

export function defineSuggestionList() { return Ng22SuggestionList; }
export function defineGroupedSuggestionList() { return Ng22GroupedSuggestionList; }

export function defineSuggestModal(host) {
  function SuggestModal(app) {
    const self = host.Modal.call(this, app) || this;
    self.limit = 100;
    self.isOpen = false;
    self.chooser = null;
    self.inputEl = null;
    self.ctaEl = null;
    self.resultsEl = null;
    self.instructionsEl = null;
    self.emptyStateText = host.t.setting.thirdPartyPlugin.labelNoResultsFound();
    self._placeholder = "";
    self._instructions = null;
    return self;
  }
  inherit(SuggestModal, host.Modal);
  const proto = SuggestModal.prototype;

  proto.onOpen = function () {
    this.isOpen = true;
    const modalEl = this.modalEl;
    modalEl.addClass("prompt");
    if (!this.inputEl) {
      const wrap = this.contentEl.createDiv("prompt-input-container");
      this.inputEl = wrap.createEl("input", { cls: "prompt-input", attr: { type: "text" } });
      this.ctaEl = wrap.createDiv("prompt-input-cta");
      const clear = this.ctaEl.createEl("button", { cls: "search-input-clear-button" });
      host.setIcon(clear, "x");
      clear.hide();
      clear.addEventListener("click", () => {
        if (this.inputEl.value) { this.inputEl.value = ""; this.onInput(); }
        else this.close();
      });
      this.resultsEl = this.contentEl.createDiv("prompt-results");
      this.instructionsEl = modalEl.createDiv("prompt-instructions");
      this.inputEl.addEventListener("input", () => this.onInput());
      this.chooser = new Ng22SuggestionList(this, this.resultsEl, this.scope);
    }
    if (this._placeholder) this.inputEl.setAttribute("placeholder", this._placeholder);
    if (this._instructions) host.renderInstructions(this.instructionsEl, this._instructions);
    this.inputEl.value = "";
    this.updateClearButton();
    this.updateSuggestions();
    try { this.inputEl.focus(); } catch (e) {}
  };

  proto.onClose = function () {
    this.isOpen = false;
  };

  proto.setPlaceholder = function (text) {
    this._placeholder = text == null ? "" : String(text);
    if (this.inputEl) this.inputEl.setAttribute("placeholder", this._placeholder);
    return this;
  };

  proto.setInstructions = function (instructions) {
    this._instructions = instructions || [];
    if (this.instructionsEl) host.renderInstructions(this.instructionsEl, this._instructions);
    return this;
  };

  proto.updateClearButton = function () {
    if (!this.ctaEl) return;
    const clear = this.ctaEl.querySelector(".search-input-clear-button");
    if (clear) clear.toggle(!!(this.inputEl && this.inputEl.value));
  };

  proto.onInput = function () {
    this.updateClearButton();
    this.updateSuggestions();
  };

  proto.updateSuggestions = function () {
    const self = this;
    const query = this.inputEl ? this.inputEl.value : "";
    let result;
    try { result = this.getSuggestions(query); } catch (e) { result = []; }
    Promise.resolve(result).then((results) => {
      if (!self.isOpen || !self.chooser) return;
      results = Array.isArray(results) ? results : [];
      if (results.length === 0) { self.onNoSuggestion(); return; }
      self.chooser.setSuggestions(results.slice(0, self.limit));
    }).catch(() => {});
  };

  proto.getSuggestions = function () { return []; };
  proto.renderSuggestion = function (suggestion, el) {
    if (suggestion == null) { el.setText(""); return; }
    const text = typeof suggestion === "string" ? suggestion : (suggestion.text ?? suggestion.name ?? suggestion.display ?? "");
    el.setText(String(text));
  };
  proto.onChooseSuggestion = function () {};
  proto.onNoSuggestion = function () {
    if (!this.chooser) return;
    this.chooser.setSuggestions(null);
    this.chooser.addMessage(this.emptyStateText);
  };

  proto.selectSuggestion = function (suggestion, event) {
    this.close();
    this.onChooseSuggestion(suggestion, event);
  };

  proto.selectActiveSuggestion = function (event) {
    return this.chooser ? this.chooser.useSelectedItem(event) : false;
  };

  return SuggestModal;
}
// ---------------------------------------------------------------- FuzzySuggestModal ----

export function defineFuzzySuggestModal(host) {
  function FuzzySuggestModal(app) {
    const self = host.SuggestModal.call(this, app) || this;
    return self;
  }
  inherit(FuzzySuggestModal, host.SuggestModal);
  const proto = FuzzySuggestModal.prototype;

  proto.getItems = function () { return []; };
  proto.getItemText = function (item) { return item == null ? "" : String(item); };

  proto.getSuggestions = function (query) {
    const prepared = prepareQuery(query || "");
    const results = [];
    const items = this.getItems() || [];
    for (const item of items) {
      const text = this.getItemText(item);
      if (text == null) continue;
      const hit = fuzzyMatchJs(prepared, text);
      if (hit) results.push({ item, match: hit });
    }
    this.sortSuggestions(results);
    return results;
  };

  proto.sortSuggestions = function (results) {
    results.sort((a, b) => (b.match ? b.match.score : 0) - (a.match ? a.match.score : 0));
  };

  proto.renderSuggestion = function (result, el) {
    if (result == null || result.item === undefined) { el.setText(""); return; }
    const text = this.getItemText(result.item);
    renderResults(el, text, result.match);
  };

  proto.onChooseItem = function () {};

  proto.onChooseSuggestion = function (suggestion, event) {
    const item = suggestion && typeof suggestion === "object" && "item" in suggestion ? suggestion.item : suggestion;
    this.onChooseItem(item, event);
  };

  proto.onSelectedChange = function (suggestion, event) {};

  return FuzzySuggestModal;
}

// ---------------------------------------------------------------- PopoverSuggest ----

export function definePopoverSuggest(host) {
  function PopoverSuggest(app) {
    this.app = app;
    this.scope = new host.Scope();
    this.isOpen = false;
    this.suggestEl = createDiv("suggestion-container");
    this.suggestInnerEl = this.suggestEl.createDiv("suggestion");
    this.suggestions = null;
    this._scrollCleanup = null;
    this.scope.register([], "Escape", (event) => { this.onEscapeKey(event); });
  }
  const proto = PopoverSuggest.prototype;

  proto.attachDom = function () {
    (ng22Doc()).body.appendChild(this.suggestEl);
  };

  proto.detachDom = function () {
    if (this.suggestEl && this.suggestEl.parentNode) this.suggestEl.detach();
    return Promise.resolve();
  };

  proto.open = function () {
    if (this.isOpen) return;
    this.isOpen = true;
    this.attachDom();
    const self = this;
    this._escHandler = function (event) {
      if (event.key === "Escape" && self.isOpen) { event.preventDefault(); self.onEscapeKey(event); }
    };
    (ng22Doc()).addEventListener("keydown", this._escHandler);
    try { this.app.keymap.pushScope(this.scope); } catch (e) {}
    try { host.registerOpenModal(this); } catch (e) {}
  };

  proto.close = function () {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this._escHandler) { (ng22Doc()).removeEventListener("keydown", this._escHandler); this._escHandler = null; }
    try { this.app.keymap.popScope(this.scope); } catch (e) {}
    try { host.unregisterOpenModal(this); } catch (e) {}
    this.detachDom();
  };

  proto.onEscapeKey = function (event) {
    this.close();
  };

  proto.reposition = function (rect) {
    if (!rect || !this.suggestEl) return;
    const rtl = (ng22Doc()).documentElement.dir === "rtl";
    host.positionNear(rect, this.suggestEl, {
      gap: 5,
      preventOverlap: true,
      horizontalAlignment: rtl ? "right" : "left",
    });
  };

  proto.setAutoDestroy = function (el) {
    if (!el || !host.watchElementGone) return;
    host.watchElementGone(el, 500, () => { if (this.isOpen) this.close(); });
  };

  proto.getSuggestions = function () { return []; };
  proto.renderSuggestion = function (value, el) {
    if (value == null) { el.setText(""); return; }
    const text = value.display ?? value.text ?? value.name ?? (value.item != null ? String(value.item) : String(value));
    el.setText(String(text));
  };
  proto.selectSuggestion = function (value, event) { this.close(); };
  proto.onSelectedChange = function () {};
  proto.onInputChange = function () {};

  proto.showSuggestions = function (values) {
    if (!this.suggestions) this.suggestions = new Ng22SuggestionList(this, this.suggestInnerEl, this.scope);
    this.suggestions.setSuggestions(values || []);
    this.open();
  };

  return PopoverSuggest;
}
// ---------------------------------------------------------------- AbstractInputSuggest ----

export function defineAbstractInputSuggest(host) {
  function AbstractInputSuggest(app, textInputEl) {
    const self = host.PopoverSuggest.call(this, app) || this;
    self.textInputEl = textInputEl;
    self.inputEl = textInputEl;
    self._selectCallback = null;
    if (textInputEl) {
      textInputEl.addEventListener("input", () => self.onInputChange(self.getValue()));
      textInputEl.addEventListener("focus", () => self.onInputFocus());
      textInputEl.addEventListener("blur", (event) => self.onInputBlur(event));
      self.suggestEl.addEventListener("mousedown", (event) => event.preventDefault());
    }
    const doc = ng22Doc();
    self._scrollReposition = () => { if (self.isOpen) self.reposition(self.getRect()); };
    doc.addEventListener("scroll", self._scrollReposition, true);
    return self;
  }
  inherit(AbstractInputSuggest, host.PopoverSuggest);
  const proto = AbstractInputSuggest.prototype;

  proto.getValue = function () {
    const el = this.textInputEl;
    if (!el) return "";
    if (!el.isContentEditable && el.value !== undefined) return el.value;
    return el.getText ? el.getText() : (el.textContent || "");
  };

  proto.setValue = function (value) {
    const el = this.textInputEl;
    if (!el) return;
    const text = value == null ? "" : String(value);
    if (!el.isContentEditable && el.value !== undefined) el.value = text;
    else el.textContent = text;
  };

  proto.getRect = function () {
    const el = this.textInputEl;
    if (!el || !el.getBoundingClientRect) return null;
    try {
      if (el.isContentEditable) {
        const sel = (el.win || ng22Win()).getSelection();
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          const rects = range.getClientRects ? range.getClientRects() : null;
          if (rects && rects.length) return rects[rects.length - 1];
          const r = range.getBoundingClientRect ? range.getBoundingClientRect() : null;
          if (r) return r;
        }
      }
      return el.getBoundingClientRect();
    } catch (e) { return el.getBoundingClientRect(); }
  };

  proto.onInputChange = function (value) {
    if (value === undefined) value = this.getValue();
    let result;
    try { result = this.getSuggestions(value); } catch (e) { result = []; }
    Promise.resolve(result).then((values) => {
      this.showSuggestions(Array.isArray(values) ? values : []);
    }).catch(() => {});
  };

  proto.getSuggestions = function () { return []; };
  proto.onInputFocus = function () {};
  proto.onInputBlur = function (event) {
    if (event && event.relatedTarget && this.suggestEl && this.suggestEl.contains(event.relatedTarget)) return;
    this.close();
  };

  proto.open = function () {
    host.PopoverSuggest.prototype.open.call(this);
    this.reposition(this.getRect());
  };

  proto.reposition = function (rect) {
    if (rect) host.PopoverSuggest.prototype.reposition.call(this, rect);
  };

  proto.showSuggestions = function (values) {
    host.PopoverSuggest.prototype.showSuggestions.call(this, values);
    this.reposition(this.getRect());
  };

  proto.onSelect = function (callback) { this._selectCallback = callback; return this; };

  proto.selectSuggestion = function (value, event) {
    const cb = this._selectCallback;
    this.close();
    if (cb) cb(value);
  };

  return AbstractInputSuggest;
}

// ---------------------------------------------------------------- EditorSuggest ----

export function defineEditorSuggest(host) {
  function EditorSuggest(app) {
    const self = this;
    self.app = app;
    self.scope = new host.Scope();
    self.isOpen = false;
    self.suggestEl = createDiv("suggestion-container");
    self.suggestInnerEl = self.suggestEl.createDiv("suggestion");
    self.instructionsEl = null;
    self.suggestions = null;
    self.context = null;
    self.scope.register([], "Escape", (event) => { self.onEscapeKey(event); });
    return self;
  }
  const proto = EditorSuggest.prototype;

  proto.attachDom = function () {
    (ng22Doc()).body.appendChild(this.suggestEl);
  };
  proto.detachDom = function () {
    if (this.suggestEl && this.suggestEl.parentNode) this.suggestEl.detach();
    return Promise.resolve();
  };
  proto.open = function () {
    if (this.isOpen) return;
    this.isOpen = true;
    this.attachDom();
    try { this.app.keymap.pushScope(this.scope); } catch (e) {}
    try { host.registerOpenModal(this); } catch (e) {}
  };
  proto.close = function () {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.context = null;
    try { this.app.keymap.popScope(this.scope); } catch (e) {}
    try { host.unregisterOpenModal(this); } catch (e) {}
    this.detachDom();
  };
  proto.onEscapeKey = function (event) { this.close(); };

  proto.setAutoDestroy = function (el) {
    if (!el || !host.watchElementGone) return;
    host.watchElementGone(el, 500, () => { if (this.isOpen) this.close(); });
  };

  proto.reposition = function (rect) {
    if (!rect || !this.suggestEl) return;
    const rtl = (ng22Doc()).documentElement.dir === "rtl";
    host.positionNear(rect, this.suggestEl, {
      gap: 5,
      preventOverlap: true,
      horizontalAlignment: rtl ? "right" : "left",
    });
  };

  proto.setInstructions = function (instructions) {
    if (!this.instructionsEl) this.instructionsEl = this.suggestEl.createDiv("prompt-instructions");
    host.renderInstructions(this.instructionsEl, instructions || []);
  };

  proto.getSuggestions = function () { return []; };
  proto.renderSuggestion = function (value, el) {
    if (value == null) { el.setText(""); return; }
    const text = value.display ?? value.text ?? value.name ?? (value.tag != null ? "#" + value.tag : String(value));
    el.setText(String(text));
  };
  proto.selectSuggestion = function () { this.close(); };
  proto.onSelectedChange = function () {};
  proto.onTrigger = function () { return null; };

  proto.showSuggestions = function (values) {
    if (!this.suggestions) this.suggestions = new Ng22SuggestionList(this, this.suggestInnerEl, this.scope);
    this.suggestions.setSuggestions(values || []);
    this.open();
    this.updatePosition();
  };

  proto.trigger = function (editor, file, forceOpen) {
    if (!editor) return false;
    let focused = true;
    try {
      if (editor.hasFocus) focused = !!editor.hasFocus();
      else if (editor.cm && editor.cm.hasFocus) focused = !!editor.cm.hasFocus();
    } catch (e) { focused = true; }
    if (!focused && !forceOpen) { this.close(); return false; }
    let selection = "";
    try { selection = editor.getSelection ? editor.getSelection() : ""; } catch (e) {}
    if (selection && !forceOpen) { this.close(); return false; }
    const cursor = editor.getCursor ? editor.getCursor() : null;
    if (!cursor) { this.close(); return false; }
    const raw = this.onTrigger(cursor, editor, file);
    if (!raw) { this.close(); return false; }
    const context = Object.assign({ editor, file }, raw);
    this.context = context;
    let result;
    try { result = this.getSuggestions(context); } catch (e) { result = []; }
    Promise.resolve(result).then((values) => {
      if (this.context !== context) return;
      if (!forceOpen && editor.hasFocus && !editor.hasFocus()) { this.close(); return; }
      if (!values || values.length === 0) { this.close(); return; }
      this.showSuggestions(values);
    }).catch(() => {});
    return true;
  };

  proto.updatePosition = function () {
    const context = this.context;
    if (!context || !context.editor) return;
    const editor = context.editor;
    let coords = null;
    try {
      if (editor.coordsAtPos) {
        const c = editor.coordsAtPos(context.start);
        if (c) coords = {
          left: c.left, top: c.top,
          right: c.right != null ? c.right : c.left,
          bottom: c.bottom != null ? c.bottom : c.top,
        };
      }
    } catch (e) {}
    if (coords) this.reposition(coords);
  };

  return EditorSuggest;
}
// __END__
