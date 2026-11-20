// g16 clean-room: MetadataEditor — the collapsible frontmatter block shown above
// a markdown note (and inside the file-properties view). Owns the row list,
// selection, keyboard nav, clipboard and persistence through the owner.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { ng16PropT, ng16PluginT, ng16Lower, ng16Compare, ng16EmptyValue } from "./n-g16-shared.js";
import { ng16DefinePropertyRow } from "./n-g16-row.js";

const ng16T = (host, path, fallback) => {
  let node = host.t;
  for (const part of path.split(".")) node = node && node[part];
  try { return typeof node === "function" ? node() : (node || fallback); } catch (e) { return fallback; }
};

export function ng16DefineMetadataEditor(host) {
  function MetadataEditor(app, owner) {
    const self = host.Component.call(this) || this;
    self.app = app;
    self.owner = owner;
    self.properties = [];
    self.rendered = [];
    self.selectedLines = new Set();
    self.collapsed = false;
    self.invalidFrontmatter = false;
    self.containerEl = createDiv({ cls: "metadata-container", attr: { tabindex: "-1" } });
    self.containerEl.dataset.propertyCount = "0";

    self.errorEl = self.containerEl.createDiv("metadata-error-container");
    self.errorEl.hide();

    self.headingEl = self.containerEl.createDiv({ cls: "metadata-properties-heading", attr: { tabindex: "0" } });
    self.foldEl = self.headingEl.createDiv({ cls: "collapse-indicator collapse-icon", attr: { tabindex: "0" } });
    try { host.setIcon(self.foldEl, "right-triangle"); } catch (e) {}
    self.headingEl.createSpan({ cls: "metadata-properties-title", text: ng16T(host, "properties.labelHeading", "Properties") });

    self.contentEl = self.containerEl.createDiv("metadata-content");
    self.propertyListEl = self.contentEl.createDiv("metadata-properties");
    self.addPropertyButtonEl = self.contentEl.createDiv({ cls: "metadata-add-button text-icon-button", attr: { tabindex: "0" } });
    try { host.setIcon(self.addPropertyButtonEl, "lucide-plus"); } catch (e) {}
    try { host.setTooltip(self.addPropertyButtonEl, ng16T(host, "properties.labelAddPropertyButton", "Add property")); } catch (e) {}

    self._bind();
    return self;
  }
  inherit(MetadataEditor, host.Component);
  const proto = MetadataEditor.prototype;

  proto._bind = function () {
    const e = this;
    this.headingEl.addEventListener("click", () => e.toggleCollapse());
    this.headingEl.addEventListener("contextmenu", (ev) => e.showPropertiesMenu(ev));
    this.headingEl.addEventListener("keydown", (ev) => {
      if (ev.isComposing) return;
      if (ev.key === "ArrowLeft") { ev.preventDefault(); e.setCollapse(true); }
      else if (ev.key === "ArrowRight") { ev.preventDefault(); e.setCollapse(false); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); e.owner && e.owner.shiftFocusBefore && e.owner.shiftFocusBefore(); }
      else if (ev.key === "ArrowDown" || ev.key === "j") {
        ev.preventDefault();
        if (e.collapsed) { e.owner && e.owner.shiftFocusAfter && e.owner.shiftFocusAfter(); }
        else e.focusPropertyAtIndex(0);
      }
    });
    this.foldEl.addEventListener("click", (ev) => { ev.stopPropagation(); e.toggleCollapse(); });
    this.addPropertyButtonEl.addEventListener("click", () => e.addProperty(""));
    this.addPropertyButtonEl.addEventListener("keydown", (ev) => {
      if (ev.isComposing) return;
      if (ev.key === " " || ev.key === "Enter") { ev.preventDefault(); e.addProperty(""); }
      else if (ev.key === "ArrowUp" || ev.key === "k" || ev.key === "Tab" && ev.shiftKey) {
        ev.preventDefault();
        if (e.rendered.length) e.rendered[e.rendered.length - 1].focusProperty(); else e.owner && e.owner.shiftFocusAfter && e.owner.shiftFocusAfter();
      } else if (ev.key === "ArrowDown" || ev.key === "j" || ev.key === "Tab") {
        ev.preventDefault(); e.owner && e.owner.shiftFocusAfter && e.owner.shiftFocusAfter();
      } else e.handleKeypress(ev);
    });
    this.containerEl.addEventListener("keydown", (ev) => e.handleKeypress(ev));
    this.containerEl.addEventListener("copy", (ev) => e.handleCopy(ev));
    this.containerEl.addEventListener("cut", (ev) => e.handleCut(ev));
    this.containerEl.addEventListener("paste", (ev) => e.handlePaste(ev));
    this.containerEl.addEventListener("contextmenu", (ev) => {
      if (ev.target === this.containerEl) e.showPropertiesMenu(ev);
    });
  };

  proto.onload = function () {
    try {
      this.registerEvent(this.app.metadataTypeManager.on("changed", (key) => {
        const lower = ng16Lower(key);
        for (const row of this.rendered) {
          if (ng16Lower(row.entry.key) === lower) row.renderProperty(row.entry, true, true);
        }
      }));
    } catch (e) {}
  };

  // ---- focus / selection ---------------------------------------------------------------

  proto._activeRow = function () {
    const ae = env().activeDocument && env().activeDocument.activeElement;
    if (!ae) return null;
    return this.rendered.find((r) => r.containerEl === ae || r.containerEl.contains(ae)) || null;
  };
  proto.hasFocus = function () { const ae = env().activeDocument && env().activeDocument.activeElement; return !!(ae && this.containerEl.contains(ae)); };
  proto.hasPropertyFocused = function () { return !!this._activeRow(); };
  Object.defineProperty(proto, "focusedLine", { get() { return this._activeRow() || (this.selectedLines.size ? [...this.selectedLines][0] : null); } });

  proto.focus = function (options = {}) {
    if (!this.properties.length) return false;
    if (this.collapsed || !options.bottom) { this.headingEl.focus(); return true; }
    if (this.addPropertyButtonEl.style.display !== "none" && this.addPropertyButtonEl.isShown && this.addPropertyButtonEl.isShown()) { this.addPropertyButtonEl.focus(); return true; }
    const last = this.rendered[this.rendered.length - 1];
    if (last) { last.focusProperty(); return true; }
    this.headingEl.focus();
    return true;
  };
  proto.focusProperty = function (key) {
    const row = this.rendered.find((r) => ng16Lower(r.entry.key) === ng16Lower(key));
    if (row) { if (host.Platform.isPhone) row.containerEl.addClass("is-flashing"); row.focusProperty(); }
  };
  proto.focusKey = function (key) { const row = this.rendered.find((r) => r.entry.key === key); if (row) row.focusKey(); };
  proto.focusValue = function (key, pos) { const row = this.rendered.find((r) => r.entry.key === key); if (row) row.focusValue(pos); };
  proto.focusPropertyAtIndex = function (i) {
    const row = this.rendered[i < 0 ? this.rendered.length - 1 : i];
    if (row) row.focusProperty();
  };

  proto.selectAll = function () {
    this.clearSelection();
    for (const row of this.rendered) { this.selectedLines.add(row); row.setSelected(true); }
  };
  proto.clearSelection = function () {
    for (const row of this.selectedLines) row.setSelected(false);
    this.selectedLines.clear();
  };
  proto.handleItemSelection = function (event, row) {
    row.focusProperty();
    if (event.altKey) {
      if (this.selectedLines.has(row)) { this.selectedLines.delete(row); row.setSelected(false); }
      else { this.selectedLines.add(row); row.setSelected(true); }
      return;
    }
    if (event.shiftKey) {
      const focused = this.focusedLine && this.focusedLine !== row ? this.focusedLine : null;
      const a = this.rendered.indexOf(focused || row);
      const b = this.rendered.indexOf(row);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const both = this.rendered.slice(lo, hi + 1).every((r) => this.selectedLines.has(r));
      if (both && lo <= hi) {
        for (const r of this.rendered.slice(lo, hi + 1)) { this.selectedLines.delete(r); r.setSelected(false); }
        return;
      }
      for (let i = lo; i <= hi; i++) { const r = this.rendered[i]; if (r && !this.selectedLines.has(r)) { this.selectedLines.add(r); r.setSelected(true); } }
      return;
    }
    if (this.selectedLines.size === 1 && this.selectedLines.has(row)) return;
    this.clearSelection();
  };
  proto.selectProperty = proto.handleItemSelection;

  // ---- render / serialize / persist -----------------------------------------------------

  proto.synchronize = function (props) {
    const invalid = props == null || typeof props !== "object" || Array.isArray(props);
    this.invalidFrontmatter = invalid;
    const Row = ng16DefinePropertyRow(host);
    const oldByKey = new Map();
    for (const row of this.rendered) if (row.entry && row.entry.key !== "") oldByKey.set(row.entry.key, row);
    const pending = this.rendered.find((r) => r.entry && r.entry.key === "" && r.containerEl.contains(env().activeDocument.activeElement));

    const entries = [];
    const rows = [];
    if (!invalid) {
      for (const [key, value] of Object.entries(props)) {
        let row = oldByKey.get(key);
        if (row) { row.entry.value = value; entries.push(row.entry); }
        else { const entry = { key, value }; row = new Row(this, entry); entries.push(entry); }
        rows.push(row);
        oldByKey.delete(key);
      }
    }
    if (pending && !invalid) { rows.push(pending); entries.push(pending.entry); }
    for (const row of oldByKey.values()) row.unload && row.unload();

    this.properties = entries;
    this.rendered = rows;
    this.propertyListEl.setChildrenInPlace(rows.map((r) => r.containerEl));
    this.containerEl.dataset.propertyCount = String(entries.length);

    this.containerEl.toggleClass("mod-error", invalid);
    const show = !invalid;
    this.headingEl.style.display = show ? "" : "none";
    this.addPropertyButtonEl.style.display = show ? "" : "none";
    this.errorEl.style.display = invalid ? "" : "none";
    if (invalid) this._renderError();
    else this.errorEl.empty();
    return this;
  };

  proto._renderError = function () {
    this.errorEl.empty();
    this.errorEl.createDiv({ cls: "metadata-error-title", text: ng16T(host, "properties.labelInvalidHeading", "Invalid properties") });
    const btn = this.errorEl.createDiv({ cls: "text-icon-button metadata-show-source-button", text: ng16T(host, "properties.labelShowSource", "Show source") });
    btn.addEventListener("click", () => {
      const file = this.owner && this.owner.getFile ? this.owner.getFile() : null;
      if (!file) return;
      const leaf = this.app.workspace.getLeaf && this.app.workspace.getLeaf();
      if (!leaf) return;
      leaf.openFile(file).then((view) => {
        try {
          if (view && view.setEphemeralState) view.setEphemeralState({ focus: true, cursor: { from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } } });
          if (view && view.modes && view.modes.source) { /* source mode preferred */ }
        } catch (e) {}
      });
    });
  };

  proto.serialize = function () {
    const out = {};
    for (const row of this.rendered) {
      const key = row.entry.key;
      if (key) out[key] = row.entry.value;
    }
    return out;
  };
  proto.save = function () {
    if (this.owner && this.owner.saveFrontmatter) this.owner.saveFrontmatter(this.serialize());
  };

  // ---- mutations ------------------------------------------------------------------------

  proto.addProperty = function (key = "") {
    if (this.invalidFrontmatter) {
      try { new host.Notice(ng16T(host, "properties.msgInvalidProperties", "Invalid properties")); } catch (e) {}
      return null;
    }
    key = String(key);
    const data = this.serialize();
    if (!Object.prototype.hasOwnProperty.call(data, key)) data[key] = null;
    // the "" row is transient: it is fed through synchronize as a fake entry and
    // only survives later synchronizes while it holds DOM focus
    const syncObj = key === "" ? Object.assign({}, data, { "": null }) : data;
    this.synchronize(syncObj);
    // named keys persist immediately; the "" row is transient until named
    if (key !== "") this.owner && this.owner.saveFrontmatter && this.owner.saveFrontmatter(data);
    const row = this.rendered[this.rendered.length - 1];
    if (row) { key === "" ? row.focusKey() : row.focusValue(key, "both"); }
    return { key, value: null };
  };

  proto.removeProperties = function (rows, refocus = true) {
    const targets = (rows && rows.length ? rows : this.rendered.filter((r) => this.selectedLines.has(r)));
    if (!targets || !targets.length) return;
    const keys = new Set(targets.map((r) => r.entry.key));
    const data = {};
    for (const row of this.rendered) if (row.entry.key && !keys.has(row.entry.key)) data[row.entry.key] = row.entry.value;
    const focusIndex = this.rendered.indexOf(this.focusedLine);
    let removedBefore = 0;
    for (const row of targets) { const i = this.rendered.indexOf(row); if (i >= 0 && i < focusIndex) removedBefore++; }
    this.synchronize(data);
    if (refocus) {
      if (this.rendered.length) this.focusPropertyAtIndex(Math.max(0, focusIndex - removedBefore));
      else this.owner && this.owner.shiftFocusAfter && this.owner.shiftFocusAfter();
    }
    if (this.owner && this.owner.saveFrontmatter) this.owner.saveFrontmatter(data);
  };

  proto.insertProperties = function (obj) {
    if (!obj || typeof obj !== "object") return;
    for (const [key, value] of Object.entries(obj)) {
      const existing = this.properties.find((e) => e.key === key);
      if (existing) existing.value = value;
      else this.properties.push({ key, value });
    }
    const data = {};
    for (const e of this.properties) if (e.key) data[e.key] = e.value;
    this.synchronize(data);
    this.save();
  };

  proto.sortProperties = function (descending = false) {
    const data = this.serialize();
    const keys = Object.keys(data).sort(ng16Compare);
    if (descending) keys.reverse();
    const sorted = {};
    for (const k of keys) sorted[k] = data[k];
    this.synchronize(sorted);
    // deliberately no save: order persists on the next edit
  };

  proto.reorderKey = function (entry, targetIndex) {
    const at = this.properties.findIndex((e) => e === entry || e.key === entry.key);
    if (at < 0) return;
    const [item] = this.properties.splice(at, 1);
    const rest = this.properties.length;
    this.properties.splice(targetIndex >= rest ? rest : targetIndex, 0, item);
    const data = {};
    for (const e of this.properties) if (e.key) data[e.key] = e.value;
    this.synchronize(data);
    if (this.owner && this.owner.saveFrontmatter) this.owner.saveFrontmatter(data);
  };

  proto.clear = function () {
    this.clearSelection();
    if (this.hasFocus() && host.blurAndClearSelection) { try { host.blurAndClearSelection(); } catch (e) {} }
    try { this.containerEl.focus({ preventScroll: true }); } catch (e) { this.containerEl.focus(); }
  };

  // ---- keyboard ---------------------------------------------------------------------------

  proto.handleKeypress = function (event) {
    if (!event || event.isComposing) return;
    if (event.defaultPrevented) return;
    const key = event.key;
    const mod = host.Keymap.isModEvent(event);
    if (mod && key.toLowerCase() === "a") { event.preventDefault(); this.selectAll(); return; }
    if (mod && key.toLowerCase() === "z") {
      if (this.owner && (event.shiftKey ? this.owner.redo : this.owner.undo)) {
        event.preventDefault();
        (event.shiftKey ? this.owner.redo : this.owner.undo).call(this.owner);
      }
      return;
    }
    if (key === "Escape") { if (this.selectedLines.size) { event.preventDefault(); this.clearSelection(); } return; }
    if (key === "Delete" || (key === "Backspace" && host.Platform.isMacOS && mod)) {
      const rows = this.selectedLines.size ? [...this.selectedLines] : (this._activeRow() ? [this._activeRow()] : []);
      if (rows.length) { event.preventDefault(); this.removeProperties(rows); }
      return;
    }
    if (key === "o" && !mod && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault(); this.addProperty(""); return;
    }
    if (key === "Home" || (event.altKey && key === "ArrowDown")) {
      event.preventDefault(); this.owner && this.owner.shiftFocusAfter && this.owner.shiftFocusAfter(); return;
    }
    if (key === "ArrowUp" || key === "k" || (key === "Tab" && event.shiftKey)) {
      if (!event.shiftKey || key !== "ArrowUp") { /* fallthrough below handles plain nav */ }
      if (key === "ArrowUp" && event.shiftKey) { this._extendSelection(-1, event); return; }
      event.preventDefault();
      this.clearSelection();
      const idx = this.rendered.indexOf(this.focusedLine);
      if (idx > 0) this.rendered[idx - 1].focusProperty();
      else this.headingEl.focus();
      return;
    }
    if (key === "ArrowDown" || key === "j" || (key === "Tab" && !event.shiftKey)) {
      if (key === "ArrowDown" && event.shiftKey) { this._extendSelection(1, event); return; }
      event.preventDefault();
      this.clearSelection();
      const idx = this.rendered.indexOf(this.focusedLine);
      const next = this.rendered[idx + 1];
      if (next) next.focusProperty();
      else if (this.addPropertyButtonEl.style.display !== "none") this.addPropertyButtonEl.focus();
      else this.owner && this.owner.shiftFocusAfter && this.owner.shiftFocusAfter();
      return;
    }
  };

  proto._extendSelection = function (dir, event) {
    event.preventDefault();
    const focused = this.focusedLine;
    if (!focused) return;
    const idx = this.rendered.indexOf(focused);
    const next = this.rendered[idx + dir];
    if (!next) return;
    if (this.selectedLines.has(focused) && this.selectedLines.has(next)) {
      this.selectedLines.delete(focused);
      focused.setSelected(false);
      return;
    }
    for (const row of this.rendered) {
      const i = this.rendered.indexOf(row);
      if ((dir > 0 && i >= idx && i <= idx + 1) || (dir < 0 && i >= idx - 1 && i <= idx)) {
        this.selectedLines.add(row);
        row.setSelected(true);
      }
    }
    next.focusProperty();
  };

  // ---- menus / clipboard ---------------------------------------------------------------

  proto._clipboardRows = function () {
    if (this.selectedLines.size) return [...this.selectedLines];
    const row = this._activeRow();
    return row ? [row] : [];
  };
  proto._copyToClipboard = function (data, rows) {
    const obj = {};
    for (const row of rows) if (row.entry.key) obj[row.entry.key] = row.entry.value;
    const json = JSON.stringify(obj);
    let yaml = json;
    try { yaml = host.yamlStringify(obj); } catch (e) {}
    try { data.setData("basalt/properties", json); } catch (e) {}
    try { data.setData("application/json", json); } catch (e) {}
    try { data.setData("Text", yaml); } catch (e) {}
    try { data.setData("text/plain", yaml); } catch (e) {}
  };
  proto.handleCopy = function (event) {
    if (!this.hasPropertyFocused()) return;
    const rows = this._clipboardRows();
    if (!rows.length || !event.clipboardData) return;
    this._copyToClipboard(event.clipboardData, rows);
    event.preventDefault();
  };
  proto.handleCut = function (event) {
    if (!this.hasPropertyFocused()) return;
    const rows = this._clipboardRows();
    if (!rows.length || !event.clipboardData) return;
    this._copyToClipboard(event.clipboardData, rows);
    event.preventDefault();
    this.removeProperties(rows, false);
    this.focusPropertyAtIndex(0);
  };
  proto.handlePaste = function (event) {
    const raw = event.clipboardData && event.clipboardData.getData("basalt/properties");
    if (!raw) return;
    let obj;
    try { obj = JSON.parse(raw); } catch (e) { console.error(e); return; }
    this.insertProperties(obj);
    event.preventDefault();
  };

  proto.showPropertiesMenu = function (event) {
    event.preventDefault();
    const menu = host.Menu.forEvent ? host.Menu.forEvent(event) : new host.Menu();
    menu.addSections(["title", "action-primary", "action", "action.sort", "", "danger"]);
    if (host.Platform.isPhone) {
      menu.addItem((item) => item.setSection("title").setTitle(ng16T(host, "properties.labelHeading", "Properties")).setIsLabel());
    }
    const cmd = (path, fallback) => ng16T(host, "commands." + path, fallback);
    menu.addItem((item) => item.setSection("action-primary").setTitle(cmd("addProperty", "Add property")).setIcon("lucide-plus").onClick(() => this.addProperty("")));
    menu.setSectionSubmenu("action.sort", { title: ng16T(host, "properties.optionSort", "Sort"), icon: "lucide-sort-asc" });
    menu.addItem((item) => item.setSection("action.sort").setTitle(cmd("labelSortPropertyAToZ", "Sort A to Z")).onClick(() => this.sortProperties(false)));
    menu.addItem((item) => item.setSection("action.sort").setTitle(cmd("labelSortPropertyZToA", "Sort Z to A")).onClick(() => this.sortProperties(true)));
    menu.addItem((item) => item.setSection("danger").setTitle(cmd("clearProperties", "Clear properties")).setIcon("lucide-trash-2").setWarning(true).onClick(() => this.removeProperties(this.rendered.slice())));
    try { menu.setParentElement(this.headingEl); } catch (e) {}
    menu.showAtMouseEvent(event);
    try {
      if (this.owner && this.owner.getFile && this.app.workspace.trigger) {
        this.app.workspace.trigger("markdown-properties-menu", menu, this.owner.getFile());
      }
    } catch (e) {}
  };

  // ---- collapse -------------------------------------------------------------------------

  proto.setCollapse = function (collapsed, animate = true) {
    this.collapsed = collapsed;
    this.containerEl.toggleClass("is-collapsed", collapsed);
    this.headingEl.toggleClass("is-collapsed", collapsed);
    this.foldEl.toggleClass("is-collapsed", collapsed);
    try { if (host.collapseElement) host.collapseElement(this.contentEl, collapsed, animate); } catch (e) {}
    if (animate && this.owner && this.owner.onMarkdownFold) this.owner.onMarkdownFold();
  };
  proto.toggleCollapse = function () { this.setCollapse(!this.collapsed); };

  return MetadataEditor;
}
void ng16PropT; void ng16PluginT; void ng16EmptyValue;
