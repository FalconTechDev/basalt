// g33 clean-room: combobox dropdown control — a button showing the current
// value that opens a searchable suggestion popover (bottom sheet on phones).
// Replaces orig MI (class, PopoverSuggest subclass).
import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { fuzzyMatchJs, prepareQuery } from "./search.js";


export function defineS20Combobox(host) {
  const ng33cFocus = (el) => {
    if (host.s20FocusEl) host.s20FocusEl(el, { preventScroll: true });
    else if (el && el.focus) el.focus({ preventScroll: true });
  };
  const ng33cDetach = (el) => {
    if (el.detach) el.detach();
    else if (el.parentNode) el.parentNode.removeChild(el);
  };
  const isPhone = () => host.Platform.isPhone;

  function Combobox(app, buttonContainer) {
    const self = host.PopoverSuggest.call(this, app) || this;
    self.app = app;
    self.value = null;
    self.clearable = false;
    self._items = [];
    self.selectCb = null;
    self._onOpen = null;
    self._onClose = null;

    self.suggestEl.addClass("combobox");
    self.bgEl = document.createElement("div");
    self.bgEl.className = "suggestion-bg";
    self.bgEl.style.opacity = "0";

    self.buttonEl = buttonContainer.createDiv({ cls: "combobox-button", attr: { tabindex: 0 } });
    self.iconEl = self.buttonEl.createDiv("combobox-button-icon");
    self.iconEl.hide();
    self.labelEl = self.buttonEl.createDiv("combobox-button-label");
    self.buttonEl.createDiv("combobox-clear-button", (clear) => {
      host.setIcon(clear, "lucide-x");
      clear.addEventListener("mousedown", (e) => e.preventDefault());
      clear.addEventListener("click", (e) => {
        e.preventDefault();
        self.buttonEl.blur();
        self.selectSuggestion(null, e);
      });
    });
    self.buttonEl.createDiv("combobox-button-chevron", (chev) => host.setIcon(chev, "lucide-chevrons-up-down"));

    self.buttonEl.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key.startsWith("Arrow") || e.key.length === 1) self.open();
    });
    self.buttonEl.addEventListener("click", (e) => {
      if (e.defaultPrevented) return;
      e.preventDefault();
      self.toggle();
    });

    self.searchComponent = new host.SearchComponent(self.suggestEl)
      .setPlaceholder(host.t.plugins.search.promptStartSearch())
      .onChange((value) => self.onInputChange(value));
    self.suggestEl.prepend(self.searchComponent.containerEl);

    self.suggestEl.addEventListener("mousedown", (e) => {
      if (e.target && e.target.closest && e.target.closest(".suggestion")) e.preventDefault();
    });
    const inputEl = self.searchComponent.inputEl;
    inputEl.addEventListener("focus", () => self.suggestEl.addClass("has-input-focus"));
    inputEl.addEventListener("blur", () => self.suggestEl.removeClass("has-input-focus"));
    inputEl.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Tab") host.s20FocusEl(self.buttonEl, { preventScroll: true });
    });
    self.suggestEl.addEventListener("focusout", () => {
      setTimeout(() => {
        const doc = env().activeDocument;
        if (!doc || doc.activeElement !== self.buttonEl) self.close();
      }, 0);
    });

    if (isPhone()) {
      self.suggestEl.createDiv({ cls: "menu-grabber", prepend: true });
      self.suggestEl.addClass("menu");
      self.suggestInnerEl.addClass("menu-scroll");
      self.bgEl.addEventListener("mousedown", (e) => e.preventDefault());
      self.bgEl.addEventListener("click", () => self.close());
      host.swipeToDismiss(self.suggestEl, self.suggestInnerEl, self.bgEl, () => {
        ng33cDetach(self.suggestEl);
        self.close();
      });
    }
    return self;
  }
  inherit(Combobox, host.PopoverSuggest);

  Combobox.prototype.setPlaceholder = function (placeholder) {
    this.labelEl.setAttribute("placeholder", placeholder);
    return this;
  };

  Combobox.prototype.setItems = function (items) {
    this._items = items;
    return this;
  };

  Combobox.prototype.getItems = function () {
    return this._items;
  };

  Combobox.prototype.setClearable = function (clearable) {
    this.clearable = !!clearable;
    if (this.value != null) this.renderLabel();
    return this;
  };

  Combobox.prototype.renderLabel = function () {
    const value = this.value;
    this.labelEl.setText(value ? (value.display != null ? value.display : value.value) : "");
    if (value && value.icon != null) host.setIcon(this.iconEl, value.icon);
    else this.iconEl.empty();
    this.buttonEl.toggleClass("mod-clearable", this.clearable && value != null);
    this.iconEl.toggle(!!(value && value.icon != null));
  };

  Combobox.prototype.setValue = function (value) {
    this.value = value;
    this.renderLabel();
    return this;
  };

  Combobox.prototype.setValueById = function (id) {
    const found = this.getItems().find((item) => item.value === id);
    if (found) this.setValue(found);
    return this;
  };

  Combobox.prototype.toggle = function () {
    if (this.isOpen) {
      ng33cFocus(this.buttonEl);
      this.close();
    } else {
      this.open();
    }
  };

  Combobox.prototype.open = function () {
    if (this.isOpen) return;
    host.PopoverSuggest.prototype.open.call(this);
    this.buttonEl.addClass("has-focus");
    if (isPhone()) {
      this.suggestions.setSuggestions(this.getSuggestions(""));
    } else {
      const rect = this.buttonEl.getBoundingClientRect();
      this.suggestions.setSuggestions(this.getSuggestions(""));
      this.reposition(rect);
      this.searchComponent.autoSelect();
    }
    this.setAutoDestroy(this.buttonEl);
    if (this._onOpen) this._onOpen.call(this);
  };

  Combobox.prototype.close = function () {
    if (!this.isOpen) return;
    host.PopoverSuggest.prototype.close.call(this);
    this.isOpen = false;
    this.buttonEl.removeClass("has-focus");
    this.searchComponent.inputEl.value = "";
    if (this._onClose) this._onClose.call(this);
  };

  Combobox.prototype.onOpen = function (cb) {
    this._onOpen = cb;
    return this;
  };

  Combobox.prototype.onClose = function (cb) {
    this._onClose = cb;
    return this;
  };

  Combobox.prototype.onEscapeKey = function () {
    ng33cFocus(this.buttonEl);
    this.close();
  };

  Combobox.prototype.selectSuggestion = function (value) {
    this.setValue(value);
    ng33cFocus(this.buttonEl);
    if (this.selectCb) this.selectCb.call(this, value);
    this.close();
  };

  Combobox.prototype.onSelect = function (cb) {
    this.selectCb = cb;
    return this;
  };

  Combobox.prototype.focus = function () {
    ng33cFocus(this.buttonEl);
    this.open();
  };

  Combobox.prototype.attachDom = function () {
    const doc = env().activeDocument;
    doc.body.appendChild(this.suggestEl);
    if (isPhone()) {
      doc.body.appendChild(this.bgEl);
      host.Pl(this.suggestEl, this.bgEl);
    } else {
      host.PopoverSuggest.prototype.attachDom.call(this);
    }
    this.suggestEl.style.left = "";
    this.suggestEl.style.top = "";
  };

  Combobox.prototype.detachDom = async function () {
    if (isPhone()) {
      const shown = this.bgEl.isShown ? this.bgEl.isShown() : this.bgEl.style.display !== "none";
      if (shown) await host.Ll(this.suggestEl, this.bgEl);
      else host.PopoverSuggest.prototype.detachDom.call(this);
    } else {
      host.PopoverSuggest.prototype.detachDom.call(this);
    }
    ng33cDetach(this.suggestEl);
    ng33cDetach(this.bgEl);
  };

  Combobox.prototype.onInputChange = function (value) {
    this.suggestions.setSuggestions(this.getSuggestions(value));
  };

  /** Fuzzy rank: value hits at full score, display-only hits penalised by 10. */
  Combobox.prototype.getSuggestions = function (query) {
    const prepared = prepareQuery(query);
    const results = [];
    for (const item of this.getItems()) {
      let match = fuzzyMatchJs(prepared, item.value);
      if (match) {
        results.push({ ...item, matches: match.matches, score: match.score });
        continue;
      }
      if (item.display != null) {
        match = fuzzyMatchJs(prepared, item.display);
        if (match) results.push({ ...item, matches: match.matches, score: match.score - 10 });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results;
  };

  Combobox.prototype.renderSuggestion = function (item, el) {
    el.addClass("mod-complex");
    el.addClass("mod-toggle");
    if (this.value && this.value.value === item.value) {
      const check = el.createDiv({ cls: "suggestion-icon mod-checked", prepend: true });
      host.setIcon(check, "lucide-check");
    }
    if (item.icon != null) {
      host.setIcon(el.createDiv("suggestion-icon").createDiv("suggestion-flair"), item.icon);
    }
    const title = el.createDiv("suggestion-content").createDiv("suggestion-title");
    host.renderResults(title, item.display != null ? item.display : item.value, item);
  };

  return Combobox;
}
