// g24 clean-room: the "markdown" workspace view (W6).
// Composes the already-independent edit mode (j6) and preview mode (fq);
// owns inline title, MetadataEditor, embedded backlinks, mode switching,
// view state (mode/source/backlinks/backlinkOpts) and file lifecycle via
// TextFileView.
import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { debounceCall } from "./timing.js";
import { firstHeadingText } from "./path.js";

// ---------------------------------------------------------------------------
// MarkdownView
// ---------------------------------------------------------------------------

export function ng24DefineMarkdownView(host) {
  function MarkdownView(leaf) {
    const self = host.TextFileView.call(this, leaf) || this;
    self.app = leaf.app;
    self.icon = "lucide-file";
    self.navigation = true;
    self.editModeType = "source";
    self.currentMode = "source";
    self.path = "";
    self._modeState = null; // persisted layout state fragment
    self._ephemeral = null;
    self._scroll = null;
    self.titleListeners = [];
    self.metadataEditor = null;
    self.inlineTitleEl = null;
    self.backlinksEl = null;
    self.backlinks = null;
    self.editMode = null;
    self.previewMode = null;
    self._modeButtonEl = null;
    self._saveFolds = debounceCall(() => self.onMarkdownFold(), 500);
    return self;
  }
  inherit(MarkdownView, host.TextFileView);
  const proto = MarkdownView.prototype;

  Object.defineProperty(proto, "VIEW_TYPE", { get() { return "markdown"; } });
  proto.getViewType = function () { return "markdown"; };
  proto.getIcon = function () { return "lucide-file"; };

  /** The public Editor surface: the active mode's editor (source mode only). */
  Object.defineProperty(proto, "editor", {
    get() {
      const mode = this.currentModeInstance();
      return mode && mode.editor ? mode.editor : null;
    },
    enumerable: false,
    configurable: true,
  });

  proto.currentModeInstance = function () {
    return this.currentMode === "preview" ? this.previewMode : this.editMode;
  };

  // ------------------------------------------------------------------ open

  proto.onload = function () {
    host.TextFileView.prototype.onload.call(this);
    // inline title + properties editor + backlinks host elements; the active
    // mode reparents them into its own chrome on show().
    this.inlineTitleEl = this.contentEl.createDiv("inline-title");
    this.metadataEditor = new host.MetadataEditor(this.app, this);
    this.addChild(this.metadataEditor);
    this.backlinksEl = this.contentEl.createDiv("embedded-backlinks");
    this.backlinksEl.hide();
    this.backlinks = new host.BacklinksPane(this.app, this.backlinksEl, this.contentEl);
    this.addChild(this.backlinks);
    // modes
    this.editMode = new host.MarkdownEditMode(this);
    this.previewMode = new host.MarkdownPreviewView(this);
    this.addChild(this.previewMode);
    // mode toggle action in the view header
    this._modeButtonEl = this.addAction("lucide-eye", "Reading view", () => this.toggleMode());
    this.registerEvent(this.app.workspace.on("css-change", () => this.onResize()));
    this.registerEvent(this.app.vault.on("config-changed", this.onConfigChanged, this));
    this.updateModeButton();
  };

  proto.onConfigChanged = function () {};

  proto.updateModeButton = function () {
    if (!this._modeButtonEl) return;
    const reading = this.currentMode === "preview";
    host.setIcon(this._modeButtonEl, reading ? "lucide-pencil" : "lucide-eye");
    const label = reading
      ? "Editing view"
      : "Reading view";
    host.setTooltip(this._modeButtonEl, label);
    this._modeButtonEl.setAttr("aria-label", label);
  };

  // ------------------------------------------------------------------ file

  proto.onLoadFile = async function (file) {
    this.path = file.path;
    // pick the mode before the text is pushed into it
    const saved = this._modeState;
    this.currentMode = saved && (saved.mode === "source" || saved.mode === "preview")
      ? saved.mode
      : (this.app.vault.getConfig("defaultViewMode") === "preview" ? "preview" : "source");
    await host.TextFileView.prototype.onLoadFile.call(this, file);
    // inline title: first heading text or the basename
    const cache = this.app.metadataCache.getFileCache(file);
    const headings = cache && cache.headings;
    const title = headings && headings.length ? headings[0].heading : file.basename;
    this.inlineTitleEl.setText(title);
    for (const fn of this.titleListeners) { try { fn(title); } catch (e) {} }
    // backlinks pane follows the file
    if (this.backlinks) {
      this.backlinks.file = file;
      this.backlinks.update && this.backlinks.update();
    }
    this.updateMode();
    this.metadataEditor && this.metadataEditor.update && this.metadataEditor.update();
  };

  proto.onUnloadFile = async function (file) {
    await host.TextFileView.prototype.onUnloadFile.call(this, file);
    this.path = "";
    if (this.backlinks) { this.backlinks.file = null; this.backlinks.update && this.backlinks.update(); }
  };

  // TextFileView data channel: the text itself.
  proto.getViewData = function () {
    const mode = this.currentModeInstance();
    return mode && mode.get ? mode.get() : "";
  };

  proto.setViewData = function (text, clear) {
    const mode = this.currentModeInstance();
    if (mode && mode.set) mode.set(text, clear);
  };

  proto.clear = function () {
    const mode = this.currentModeInstance();
    if (mode && mode.clear) mode.clear();
  };

  // ------------------------------------------------------------------ state

  proto.canAcceptExtension = function (ext) {
    return ext === "md" || ext === "markdown";
  };

  proto.getState = function () {
    const state = host.FileView.prototype.getState.call(this);
    state.mode = this.currentMode;
    if (this._modeState) {
      if (this._modeState.source !== undefined) state.source = this._modeState.source;
      if (this._modeState.backlinks !== undefined) state.backlinks = this._modeState.backlinks;
      if (this._modeState.backlinkOpts) state.backlinkOpts = this._modeState.backlinkOpts;
    }
    return state;
  };

  proto.setState = async function (state, result) {
    if (state) {
      this._modeState = state;
      if (state.mode === "source" || state.mode === "preview") this.currentMode = state.mode;
    }
    return host.FileView.prototype.setState.call(this, state, result);
  };

  proto.getEphemeralState = function (state) {
    const mode = this.currentModeInstance();
    if (mode && mode.getEphemeralState) mode.getEphemeralState(state);
    state.mode = this.currentMode;
    return state;
  };

  proto.setEphemeralState = function (state) {
    this._ephemeral = state;
    const mode = this.currentModeInstance();
    if (mode && mode.setEphemeralState) mode.setEphemeralState(state);
  };

  // ------------------------------------------------------------------ modes

  proto.getMode = function () { return this.currentMode; };

  proto.setMode = function (mode) {
    if (mode !== "source" && mode !== "preview") return;
    if (mode === this.currentMode) { this.updateMode(); return; }
    // hand the scroll position across
    const from = this.currentModeInstance();
    if (from && from.getScroll) this._scroll = from.getScroll();
    this.currentMode = mode;
    this.updateMode();
    this._modeState = this._modeState || {};
    this._modeState.mode = mode;
    this.app.workspace.trigger("markdown-view-mode-changed", this);
  };

  proto.toggleMode = function () {
    this.setMode(this.currentMode === "source" ? "preview" : "source");
  };

  proto.updateMode = function () {
    const preview = this.currentMode === "preview";
    this.containerEl.setAttr("data-mode", preview ? "preview" : "source");
    if (this.editMode) preview ? this.editMode.hide() : this.editMode.show();
    if (this.previewMode) preview ? this.previewMode.show() : this.previewMode.hide();
    this.updateModeButton();
    this.updateBacklinksVisibility();
    const mode = this.currentModeInstance();
    if (mode && mode.onResize) mode.onResize();
    if (this._scroll !== null && mode && mode.applyScroll) {
      mode.applyScroll(this._scroll);
      this._scroll = null;
    }
  };

  // ------------------------------------------------------------------ backlinks

  proto.canToggleBacklinks = function () {
    return !!this.file;
  };

  proto.toggleBacklinks = function () {
    this._modeState = this._modeState || {};
    this._modeState.backlinks = !this._modeState.backlinks;
    this.updateBacklinksVisibility();
    this.app.workspace.requestSaveLayout && this.app.workspace.requestSaveLayout();
  };

  proto.updateBacklinksVisibility = function () {
    const show = !!(this._modeState && this._modeState.backlinks) && this.canToggleBacklinks();
    if (this.backlinksEl) this.backlinksEl.toggle(show);
  };

  // ------------------------------------------------------------------ helpers used by modes / plugins

  proto.canShowProperties = function () {
    return this.app.vault.getConfig("propertiesInDocument") !== "hidden" && !!this.file;
  };

  proto.onInternalDataChange = function () {
    this.requestSave();
    if (this.file) this.app.metadataCache.trigger("changed", this.file);
  };

  proto.syncScroll = function () {
    const mode = this.currentModeInstance();
    if (mode && mode.getScroll) this._scroll = mode.getScroll();
  };

  proto.onMarkdownFold = function () {
    if (!this.file) return;
    const mode = this.currentModeInstance();
    if (mode && mode.getFoldInfo) {
      this.app.foldManager.save(this.file, mode.getFoldInfo());
    }
  };

  proto.replaceScope = function (scope) {
    if (scope === this.scope) return;
    if (this.scope) this.app.keymap.popScope(this.scope);
    this.scope = scope;
    if (scope) this.app.keymap.pushScope(scope);
  };

  proto.focus = function () {
    const mode = this.currentModeInstance();
    if (mode && mode.focus) mode.focus();
  };

  proto.hasFocus = function () {
    return this.containerEl.contains(document.activeElement);
  };

  // MetadataEditor owner hooks
  proto.shiftFocusBefore = function () { this.editMode && this.editMode.focus && this.editMode.focus(); };
  proto.shiftFocusAfter = function () { this.editMode && this.editMode.focus && this.editMode.focus(); };

  // inline title listeners (tab header sync etc.)
  proto.onAddTitleListener = function (fn) { this.titleListeners.push(fn); };
  proto.onRemoveTitleListener = function (fn) {
    const i = this.titleListeners.indexOf(fn);
    if (i >= 0) this.titleListeners.splice(i, 1);
  };

  // ------------------------------------------------------------------ menus / misc

  proto.onMoreOptions = function (event) {
    const menu = host.Menu.forEvent(event);
    menu.addSections(["view"]);
    const modeItem = menu.addItem((item) => item
      .setSection("view")
      .setTitle(this.currentMode === "source" ? "Reading view" : "Editing view")
      .setIcon(this.currentMode === "source" ? "lucide-eye" : "lucide-pencil")
      .onClick(() => this.toggleMode()));
    if (this.canToggleBacklinks()) {
      menu.addItem((item) => item
        .setSection("view")
        .setTitle("Backlinks in document")
        .setChecked(!!(this._modeState && this._modeState.backlinks))
        .onClick(() => this.toggleBacklinks()));
    }
    menu.addSeparator("view");
    menu.addItem((item) => item
      .setSection("view")
      .setTitle(host.t.interface.copyLinkText ? host.t.interface.copyLinkText() : "Copy link to file")
      .setIcon("lucide-link-2")
      .onClick(() => {
        const link = "obsidian://open?vault=" + encodeURIComponent(this.app.vault.getName()) + "&file=" + encodeURIComponent(this.path);
        navigator.clipboard && navigator.clipboard.writeText(link);
      }));
    menu.showAtMouseEvent(event);
  };

  proto.onPaneMenu = function (menu, source) {
    host.ItemView.prototype.onPaneMenu.call(this, menu, source);
    if (source === "more-options") return;
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle(this.currentMode === "source" ? "Reading view" : "Editing view")
      .setIcon(this.currentMode === "source" ? "lucide-eye" : "lucide-pencil")
      .onClick(() => this.toggleMode()));
  };

  proto.handleCopy = function () {};
  proto.handleCut = function () {};
  proto.handlePaste = function () {};

  proto.onResize = function () {
    const mode = this.currentModeInstance();
    if (mode && mode.onResize) mode.onResize();
  };

  return MarkdownView;
}

export const defineMarkdownView = ng24DefineMarkdownView;
