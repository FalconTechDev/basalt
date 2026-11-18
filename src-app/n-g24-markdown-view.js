// g24 clean-room: the "markdown" workspace view (edit/preview modes).
import { inherit } from "./inherit.js";
import { env, hostEnv } from "./env.js";
import { debounceCall } from "./timing.js";
import { firstHeadingText } from "./path.js";
import { lineBounds } from "./text.js";
import { ng24SettlePromise } from "./n-g24-themes.js";

const NG24_MODES = {};

// ---------------------------------------------------------------------------
// Mode registration: edit (source) and preview modes.
// ---------------------------------------------------------------------------

export function ng24DefineMarkdownViewModeRegistry(host) {
  const registry = NG24_MODES;
  registry.edit = {
    type: "source",
    name: () => host.t.view.edit(),
    icon: "lucide-pencil",
    init(view) { return view.editMode; },
  };
  registry.preview = {
    type: "preview",
    name: () => host.t.view.preview(),
    icon: "lucide-eye",
    init(view) { return view.previewMode; },
  };
  return registry;
}

// ---------------------------------------------------------------------------
// MarkdownView (W6)
// ---------------------------------------------------------------------------

export function ng24DefineMarkdownView(host) {
  function MarkdownView(leaf, sourcePath) {
    const self = host.TextFileView.call(this, leaf) || this;
    self.app = leaf.app || (leaf.view && leaf.view.app);
    self.path = "";
    self.file = null;
    self.icon = "lucide-file";
    self.navigation = true;
    self.editModeType = "source";
    self.currentMode = "source";
    self.editor = null;
    self.preview = null;
    self.backlinks = null;
    self.backlinkOpts = {};
    self.sourceMode = null;
    self.previewMode = null;
    self._mode = "source";
    self._scrollSync = debounceCall(() => self.syncScroll(), 16);
    self._state = null;
    self._ephemeralState = null;
    self.titleListeners = [];
    return self;
  }
  inherit(MarkdownView, host.TextFileView);
  const proto = MarkdownView.prototype;

  Object.defineProperty(proto, "VIEW_TYPE", { get() { return "markdown"; } });
  proto.getViewType = function () { return "markdown"; };
  proto.getIcon = function () { return "lucide-file"; };

  // ---------------------------------------------------------------- open

  proto.onOpen = function () {
    this._registerModes();
    // source mode container
    this.editModeEl = host.createDiv({ cls: "markdown-source-view" });
    this.contentEl.appendChild(this.editModeEl);
    // preview mode container
    this.previewModeEl = host.createDiv({ cls: "markdown-preview-view" });
    this.contentEl.appendChild(this.previewModeEl);
    this.previewModeEl.hide();
    // mode button + header actions
    this.registerEvent(this.app.workspace.on("css-change", () => {}));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.onActiveLeafChange()));
    this._setupHeader();
    this._setupBacklinks();
  };

  proto._registerModes = function () {
    ng24DefineMarkdownViewModeRegistry(host);
    this.sourceMode = NG24_MODES.edit;
    this.previewMode = NG24_MODES.preview;
    // instantiate modes
    this.editMode = host.MarkdownEditMode ? new host.MarkdownEditMode(this) : null;
    this.previewModeInstance = host.MarkdownPreviewView ? new host.MarkdownPreviewView(this) : null;
  };

  proto._setupHeader = function () {
    this.headerEl = host.createEl("div", { cls: "view-header" }, this.contentEl);
    const titleEl = host.createEl("div", { cls: "view-header-title" }, this.headerEl);
    this.titleEl = host.createEl("div", { cls: "view-header-breadcrumb", text: "" }, titleEl);
    const actions = host.createEl("div", { cls: "view-actions" }, this.headerEl);
    // mode toggle button
    this.modeButtonEl = host.createEl("a", { cls: "clickable-icon view-action", attr: { "aria-label": "Reading view" } }, actions);
    setIcon(this.modeButtonEl, "lucide-eye");
    this.modeButtonEl.addEventListener("click", () => this.toggleMode());
    // more options
    this.moreButtonEl = host.createEl("a", { cls: "clickable-icon view-action", attr: { "aria-label": "More options" } }, actions);
    setIcon(this.moreButtonEl, "lucide-ellipsis");
    this.moreButtonEl.addEventListener("click", (e) => this.onMoreMenu(e));
  };

  proto._setupBacklinks = function () {
    this.backlinkEl = host.createDiv({ cls: "embedded-backlinks" });
    this.contentEl.appendChild(this.backlinkEl);
    this.backlinks = new host.BacklinksPane(this.app, this.backlinkEl, this);
  };

  // ---------------------------------------------------------------- file

  proto.getViewData = function () {
    return { type: "markdown", state: this._state, ephemeralState: this._ephemeralState };
  };

  proto.setViewData = function (data) {
    if (data && data.state) this._state = data.state;
    if (data && data.ephemeralState) this._ephemeralState = data.ephemeralState;
  };

  proto.onLoadFile = async function (file) {
    this.file = file;
    this.path = file.path;
    if (this._state && this._state.mode) this.currentMode = this._state.mode;
    else this.currentMode = this.app.vault.getConfig("defaultViewMode") === "preview" ? "preview" : "source";
    this.updateMode();
    this.updateTitle();
    this.backlinks && this.backlinks.update(file, this.backlinkOpts);
    this.dataEl = this.app.vault.adapter.read ? null : null;
  };

  proto.onUnloadFile = function (file) {
    if (this.file === file) {
      this.file = null;
      this.path = "";
    }
    this.backlinks && this.backlinks.update(null, this.backlinkOpts);
  };

  proto.updateTitle = function () {
    const file = this.file;
    const title = file ? firstHeadingText(file.basename) || file.basename : "";
    if (this.titleEl) this.titleEl.setText(title);
    for (const fn of this.titleListeners) fn(title);
  };

  proto.onAddTitleListener = function (fn) { this.titleListeners.push(fn); };
  proto.onRemoveTitleListener = function (fn) {
    const i = this.titleListeners.indexOf(fn);
    if (i >= 0) this.titleListeners.splice(i, 1);
  };

  // ---------------------------------------------------------------- modes

  proto.getMode = function () { return this.currentMode; };

  proto.setMode = function (mode) {
    if (mode === this.currentMode) return;
    this.currentMode = mode;
    this.updateMode();
    this.app.workspace.trigger("markdown-view-mode-changed", this);
    this._state = this._state || {};
    this._state.mode = mode;
  };

  proto.toggleMode = function () {
    this.setMode(this.currentMode === "source" ? "preview" : "source");
  };

  proto.updateMode = function () {
    const source = this.currentMode === "source";
    this.contentEl.setAttr("data-mode", source ? "source" : "preview");
    if (this.editModeEl) this.editModeEl.toggle(!source);
    if (this.previewModeEl) this.previewModeEl.toggle(source);
    if (this.modeButtonEl) {
      setIcon(this.modeButtonEl, source ? "lucide-eye" : "lucide-pencil");
      this.modeButtonEl.setAttr("aria-label", source ? "Reading view" : "Editing view");
    }
    if (source && this.editMode && this.editMode.onModeEnter) this.editMode.onModeEnter();
    if (!source && this.previewModeInstance && this.previewModeInstance.onModeEnter) this.previewModeInstance.onModeEnter();
    this.updateTitle();
  };

  // ---------------------------------------------------------------- editor

  proto.onDataChanged = function () {
    this.app.metadataCache.trigger("changed", this.file);
  };

  // ---------------------------------------------------------------- menus

  proto.onMoreMenu = function (event) {
    const menu = host.Menu.forEvent(event);
    menu.addItem((item) => item.setTitle("Open in new window").setIcon("lucide-external-link").onClick(() => this.app.workspace.moveLeafToPopout(this.leaf)));
    menu.addItem((item) => item.setTitle("Copy link to file").setIcon("lucide-link").onClick(() => {
      navigator.clipboard && navigator.clipboard.writeText("obsidian://open?vault=" + encodeURIComponent(this.app.vault.getName()) + "&file=" + encodeURIComponent(this.path));
    }));
    if (this.file) {
      menu.addSeparator();
      menu.addItem((item) => item.setTitle("Open file properties").setIcon("lucide-info").onClick(() => {
        const plugin = this.app.internalPlugins.getPluginById("properties");
        plugin && plugin.openProperties(this.file);
      }));
    }
  };

  // ---------------------------------------------------------------- lifecycle

  proto.onClose = function () {
    this.app.workspace.detachLeavesOfType("backlink", true);
  };

  proto.onResize = function () {
    this._scrollSync();
  };

  proto.syncScroll = function () {};

  proto.onActiveLeafChange = function () {};

  return MarkdownView;
}

export const defineMarkdownView = ng24DefineMarkdownView;
