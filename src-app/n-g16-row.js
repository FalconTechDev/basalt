// g16 clean-room: one frontmatter property row — key input with autocomplete,
// the per-type value widget, warning icon, selection state and the property
// context menu (change type / clipboard / delete).
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { ng16EmptyValue, ng16Lower, ng16Compare, ng16PropT, ng16PluginT, ng16Widget } from "./n-g16-shared.js";

const NG16_RESERVED_KEYS = { aliases: true, cssclasses: true, tags: true };

export function ng16DefinePropertyKeySuggest(host) {
  return function (app, inputEl, properties) {
    const s = new host.AbstractInputSuggest(app, inputEl);
    s.suggestEl.addClass("mod-property-key");
    const used = () => new Set((properties || []).map((p) => ng16Lower(p.key || p)));
    s.getSuggestions = (query) => {
      const q = String(query || "").toLowerCase();
      const taken = used();
      const all = Object.values((app.metadataTypeManager.getAllProperties && app.metadataTypeManager.getAllProperties()) || {});
      const out = [];
      for (const info of all) {
        const name = info.name || String(info);
        if (taken.has(ng16Lower(name))) continue;
        if (q && !host.containsAllWords(q, ng16Lower(name))) continue;
        out.push({ name, widget: info.widget, score: q ? (host.matchScore ? host.matchScore(null, q.length, name.length, false) : 0) : 0, matches: null });
      }
      out.sort((a, b) => b.score - a.score || ng16Compare(a.name, b.name));
      if (String(query || "") !== "") out.push({ name: String(query), freeText: true, score: -1, matches: null });
      return out;
    };
    s.renderSuggestion = (value, el) => {
      el.addClass("mod-complex");
      const icon = el.createDiv("suggestion-icon");
      const flair = icon.createDiv("suggestion-flair");
      const widget = value.widget ? ng16Widget(host, value.widget) : null;
      try { host.setIcon(flair, (widget && widget.icon) || "lucide-text"); } catch (e) {}
      const content = el.createDiv("suggestion-content");
      const title = content.createDiv("suggestion-title");
      try { host.renderResults(title, value.name, value.matches); } catch (e) { title.setText(value.name); }
    };
    s.selectSuggestion = (value, event) => {
      if (!value) return;
      s.close();
      inputEl.value = value.name;
      inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    };
    return s;
  };
}

let ng16RowCtor = null;
export function ng16DefinePropertyRow(host) {
  if (ng16RowCtor) return ng16RowCtor;
  ng16RowCtor = buildPropertyRow(host);
  return ng16RowCtor;
}
function buildPropertyRow(host) {
  function PropertyRow(editor, entry) {
    const self = host.Component.call(this) || this;
    self.editor = editor;
    self.entry = entry;
    self.containerEl = createDiv({ cls: "metadata-property", attr: { tabindex: "0" } });
    self.containerEl.dataset.propertyKey = ng16Lower(entry.key);
    const keyWrap = self.containerEl.createDiv("metadata-property-key");
    self.iconEl = keyWrap.createSpan({ cls: "metadata-property-icon clickable-icon" });
    self.iconEl.setAttribute("aria-disabled", entry.key ? "false" : "true");
    self.keyInputEl = keyWrap.createEl("input", { cls: "metadata-property-key-input", type: "text", attr: { spellcheck: "false" } });
    self.valueEl = self.containerEl.createDiv({ cls: "metadata-property-value" });
    self.warningEl = self.containerEl.createDiv({ cls: "metadata-property-warning-icon clickable-icon" });
    host.setIcon(self.warningEl, "lucide-alert-triangle");
    self.warningEl.hide();
    self.rendered = null;
    self.typeInfo = null;
    self.keyInputEl.value = entry.key;
    self._lastKey = entry.key;
    self._bind();
    self.renderProperty(entry, true, true);
    return self;
  }
  inherit(PropertyRow, host.Component);
  const proto = PropertyRow.prototype;

  proto._bind = function () {
    const row = this;
    try { host.setTooltip(this.iconEl, this.entry.key || ""); } catch (e) {}
    this.keyInputEl.addEventListener("input", () => {
      this.containerEl.dataset.propertyKey = ng16Lower(this.keyInputEl.value);
      try { if (!host.Platform.isMobileApp) host.setTooltip(this.keyInputEl, this.keyInputEl.value); } catch (e) {}
    });
    this.keyInputEl.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        this.handleUpdateKey(this.keyInputEl.value);
        this.renderProperty(this.entry, true, true);
        this.focusValue("both");
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.keyInputEl.value = this.entry.key;
        this.containerEl.dataset.propertyKey = ng16Lower(this.entry.key);
        this.editor.clearSelection();
      }
    });
    this.keyInputEl.addEventListener("blur", () => this.handleKeyBlur());
    try { new (ng16DefinePropertyKeySuggest(host))(this.editor.app, this.keyInputEl, this.editor.properties); } catch (e) {}
    this.iconEl.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); this.editor.handleItemSelection(e, this); });
    this.iconEl.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); this.containerEl.focus(); this.showPropertyMenu(e); });
    this.containerEl.addEventListener("click", (e) => {
      if (e.target === this.containerEl || e.target === this.keyInputEl.parentElement) this.editor.handleItemSelection(e, this);
    });
    this.containerEl.addEventListener("contextmenu", (e) => {
      if (e.target !== this.containerEl && e.target !== this.iconEl) return;
      this.containerEl.focus();
      this.showPropertyMenu(e);
    });
    this.containerEl.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (this.editor.selectedLines.size > 1) { this.editor.handleKeypress(e); return; }
      const t = e.target;
      if (t !== this.containerEl) { this.editor.handleKeypress(e); return; }
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.focusValue("both"); }
      else if (e.key === "a" || e.key === "A" || e.key === "i" || e.key === "I") { e.preventDefault(); this.focusValue(e.key === "a" || e.key === "A" ? "end" : "start"); }
      else if (e.key === "ArrowLeft" || e.key === "h") { e.preventDefault(); this.focusKey(); }
      else if (e.key === "ArrowRight" || e.key === "l") { e.preventDefault(); this.focusValue(); }
      else this.editor.handleKeypress(e);
    });
    try {
      if (host.makeDragReorderable) {
        host.makeDragReorderable(this.iconEl, this.containerEl, this.editor.propertyListEl, 10, () => true, (index) => {
          this.editor.reorderKey(this.entry, index);
        });
      }
    } catch (e) {}
    void row;
  };

  proto.setSelected = function (on) { this.containerEl.toggleClass("is-selected", !!on); };
  proto.focusProperty = function () { try { this.containerEl.focus({ preventScroll: true }); } catch (e) { this.containerEl.focus(); } };
  proto.focusKey = function () { this.keyInputEl.focus(); this.keyInputEl.select && this.keyInputEl.select(); };
  proto.focusValue = function (pos) { if (this.rendered && this.rendered.focus) this.rendered.focus(pos || "both"); };

  proto.handleKeyBlur = function () {
    const key = this.keyInputEl.value.trim();
    const hadKey = !!this.entry.key;
    if (!key) {
      if (!hadKey) { this.editor.removeProperties([this], false); return; }
      this.keyInputEl.value = this.entry.key;
      this.containerEl.dataset.propertyKey = ng16Lower(this.entry.key);
      return;
    }
    if (key !== this.entry.key) this.handleUpdateKey(key);
  };

  proto.handleUpdateKey = function (key) {
    key = String(key == null ? "" : key).trim();
    const lower = ng16Lower(key);
    if (!key) {
      try { host.displayTooltip(this.keyInputEl, ng16PropT(host).msgEmptyPropertyName(), { classes: ["mod-error"] }); } catch (e) {}
      return;
    }
    const focused = this.containerEl.contains(env().activeDocument.activeElement);
    for (const row of this.editor.rendered) {
      if (row === this) continue;
      if (ng16Lower(row.entry.key) === lower) {
        this.containerEl.addClass("is-flashing");
        setTimeout(() => this.containerEl.removeClass("is-flashing"), 750);
        try { host.displayTooltip(this.keyInputEl, ng16PropT(host).msgDuplicatePropertyName(), { classes: ["mod-error"] }); } catch (e) {}
        return;
      }
    }
    if (lower !== ng16Lower(this.entry.key)) {
      this.entry.key = key;
      this.containerEl.dataset.propertyKey = lower;
      this.keyInputEl.value = key;
      this.editor.save();
    }
    void focused;
  };

  proto.handleUpdateValue = function (value) {
    this.entry.value = ng16EmptyValue(value);
    this.editor.save();
    this.renderProperty(this.entry, false, false);
  };

  proto.renderProperty = function (entry, force = false, isInitial = false) {
    const mgr = this.editor.app.metadataTypeManager;
    const info = mgr.getTypeInfo(entry.key, entry.value);
    this.typeInfo = info;
    const widget = isInitial ? info.expected : info.inferred;
    const valueEl = this.valueEl;
    const active = valueEl.contains(env().activeDocument.activeElement);
    const unchanged = this.rendered && this._lastType === widget.type && ng16SameEntry(this._lastValue, entry.value);
    if (!force && unchanged && active) return this.rendered;
    this._lastType = widget.type;
    this._lastValue = entry.value;
    valueEl.empty();
    valueEl.dataset.propertyType = widget.type;
    const file = this.editor.owner && this.editor.owner.getFile ? this.editor.owner.getFile() : null;
    const ctx = {
      app: this.editor.app,
      key: entry.key,
      onChange: (v) => this.handleUpdateValue(v),
      sourcePath: file ? file.path : "",
      blur: () => this.editor.containerEl.focus(),
      hoverSource: this.editor.owner && this.editor.owner.getHoverSource ? this.editor.owner.getHoverSource() : "properties",
    };
    try {
      this.rendered = widget.render(valueEl, entry.value, ctx);
    } catch (e) {
      this.rendered = null;
    }
    try { host.setIcon(this.iconEl, info.expected.icon || "lucide-text"); } catch (e) {}
    const mismatch = !!(info.expected && info.inferred && info.expected !== info.inferred);
    if (!isInitial) this.warningEl.toggle(mismatch);
    else this.warningEl.hide();
    try {
      if (mismatch) host.setTooltip(this.warningEl, ng16PropT(host).labelTypeMismatchWarning({ type: info.expected.name() }));
    } catch (e) {}
    return this.rendered;
  };

  proto.showPropertyMenu = function (event) {
    event.preventDefault();
    event.stopPropagation();
    const menu = host.Menu.forEvent ? host.Menu.forEvent(event) : new host.Menu();
    menu.addSections(["title", "action", "action.changeType", "selection", "clipboard", "", "danger"]);
    const t = ng16PropT(host);
    const pluginT = ng16PluginT(host);
    if (host.Platform.isPhone) {
      menu.addItem((item) => item.setSection("title").setTitle(this.entry.key).setIsLabel());
    }
    if (host.Platform.isMobileApp) {
      menu.addItem((item) => item.setSection("action").setTitle(pluginT.optionPropertyType ? pluginT.optionPropertyType() : "Type").setIsLabel());
      try { menu.onHide && menu.onHide(() => host.blurAndClearSelection && host.blurAndClearSelection()); } catch (e) {}
    }
    const self = this;
    menu.setSectionSubmenu("action.changeType", { title: pluginT.optionPropertyType ? pluginT.optionPropertyType() : "Type", icon: "lucide-info" });
    const widgets = Object.values(this.editor.app.metadataTypeManager.registeredTypeWidgets || {});
    const lowerKey = ng16Lower(this.entry.key);
    const reserved = NG16_RESERVED_KEYS[lowerKey];
    for (const widget of widgets) {
      if (Array.isArray(widget.reservedKeys) && widget.reservedKeys.length > 0 && !widget.reservedKeys.some((k) => ng16Lower(k) === lowerKey)) continue;
      menu.addItem((item) => item
        .setSection("action.changeType")
        .setTitle(widget.name())
        .setIcon(widget.icon)
        .setDisabled(!!reserved)
        .setChecked(!!(this.typeInfo && this.typeInfo.expected && this.typeInfo.expected.type === widget.type))
        .onClick(() => {
          self.editor.app.metadataTypeManager.setType(self.entry.key, widget.type);
          self.renderProperty(self.entry, true, true);
          const value = self.entry.value;
          if (value != null && !widget.validate(value)) {
            try {
              const Modal = host.TypeInfoModal || env().FO;
              if (Modal) new Modal(self.editor.app, self, widget).open();
            } catch (e) {}
          }
        }));
    }
    if (host.Platform.isDesktop) {
      try {
        const wc = env().electron && env().electron.remote ? env().electron.remote.getCurrentWebContents() : null;
        if (wc) {
          menu.addItem((item) => item.setSection("clipboard").setTitle((host.t.interface && host.t.interface.menu && host.t.interface.menu.cut) ? host.t.interface.menu.cut() : "Cut").setIcon("lucide-scissors").onClick(() => wc.cut()));
          menu.addItem((item) => item.setSection("clipboard").setTitle((host.t.interface && host.t.interface.menu && host.t.interface.menu.copy) ? host.t.interface.menu.copy() : "Copy").setIcon("lucide-copy").onClick(() => wc.copy()));
          menu.addItem((item) => item.setSection("clipboard").setTitle((host.t.interface && host.t.interface.menu && host.t.interface.menu.paste) ? host.t.interface.menu.paste() : "Paste").setIcon("lucide-clipboard-check").onClick(() => wc.paste()));
        }
      } catch (e) {}
    }
    menu.addItem((item) => item
      .setSection("danger")
      .setTitle(((host.t.interface && host.t.interface.menu && host.t.interface.menu.remove) ? host.t.interface.menu.remove() : "Remove"))
      .setIcon("lucide-trash-2")
      .setWarning(true)
      .onClick(() => this.editor.removeProperties([this])));
    menu.showAtMouseEvent(event);
  };

  return PropertyRow;
}
void buildPropertyRow;

function ng16SameEntry(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => ng16SameEntry(x, b[i]));
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => ng16SameEntry(a[k], b[k]));
  }
  return false;
}
void ng16Compare; void ng16Widget;
