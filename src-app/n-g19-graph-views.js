// g19 clean-room: global/local graph views and the "graph" core plugin
// (commands, ribbon, file-menu entry, hover-link source, options persistence).
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { makeHotkey } from "./text.js";
import { ng19GraphViewType, ng19LocalGraphViewType, ng19GT, ng19Graph, ng19Host } from "./n-g19-graph-consts.js";
import { ng19GraphRenderer } from "./n-g19-graph-render.js";
import { ng19GraphEngine } from "./n-g19-graph-engine.js";
import { ng19GraphControlSection, ng19GraphFilterSection, ng19GraphColorSection, ng19GraphDisplaySection, ng19GraphForceSection, } from "./n-g19-graph-sections.js";

function ng19GraphPluginInstance(app) {
  const w = app.internalPlugins && app.internalPlugins.getPluginById("graph");
  return w && w.instance ? w.instance : null;
}

function ng19AddScreenshotItem(view, menu) {
  menu.addItem((item) => item
    .setSection("action")
    .setTitle(ng19GT("actionCopyScreenshot"))
    .setIcon("lucide-image")
    .onClick(() => view.copyScreenshot()));
}

async function ng19CopyScreenshot(view) {
  const host = ng19Host();
  try {
    const canvas = await view.renderer.getTransparentScreenshot();
    await view.renderer.copyToClipboard(canvas, "image/png");
    new host.Notice(ng19GT("msgScreenshotCopied"));
  } catch (e) {
    new host.Notice(e && e.message ? e.message : String(e));
  }
}

// ---------------------------------------------------------------- global view

/** Manifest factory: global graph view (ItemView + PIXI renderer + engine). */
export function ng19GraphView() {
  if (ng19Graph.View) return ng19Graph.View;
  ng19GraphControlSection();
  ng19GraphFilterSection();
  ng19GraphColorSection();
  ng19GraphDisplaySection();
  ng19GraphForceSection();
  ng19GraphRenderer();
  ng19GraphEngine();
  const host = ng19Host();

  function Ng19GraphView(leaf) {
    const self = host.ItemView.call(this, leaf) || this;
    self.icon = "lucide-git-fork";
    self.navigation = true;
    self.renderer = null;
    self.engine = null;
    return self;
  }
  inherit(Ng19GraphView, host.ItemView);
  const proto = Ng19GraphView.prototype;

  Ng19GraphView.VIEW_TYPE = ng19GraphViewType;

  proto.getViewType = function () { return ng19GraphViewType; };
  proto.getDisplayText = function () { return ng19GT("name"); };

  proto.onload = function () {
    const app = this.app;
    this.renderer = new (ng19GraphRenderer())(this.contentEl, !env().Yl.isIosApp, true);
    this.engine = new (ng19GraphEngine())(app, this, this.renderer);
    this.dataEngine = this.engine;
    this.registerEvent(app.metadataCache.on("resolved", this.update, this));
    this.engine.load();
    const plugin = ng19GraphPluginInstance(app);
    if (plugin && plugin.options) this.engine.setOptions(plugin.options);
    this.engine.requestUpdateSearch();
    this.update();
  };

  proto.update = function () {
    if (this.engine) this.engine.render();
  };

  proto.showSearch = function () {
    const engine = this.engine;
    if (!engine) return;
    if (engine.controlsEl) engine.controlsEl.classList.remove("is-close");
    const f = engine.filterOptions;
    if (f && f.setCollapsed) f.setCollapsed(false);
    const s = f && f.search;
    if (s && s.inputEl) s.inputEl.focus();
  };

  proto.onOptionsChange = function () {
    if (!this.engine) return;
    const plugin = ng19GraphPluginInstance(this.app);
    if (plugin) {
      plugin.options = this.engine.getOptions();
      if (typeof plugin.saveOptions === "function") plugin.saveOptions();
    }
  };

  proto.onPaneMenu = function (menu, source) {
    host.ItemView.prototype.onPaneMenu.call(this, menu, source);
    ng19AddScreenshotItem(this, menu);
  };

  proto.copyScreenshot = function () { return ng19CopyScreenshot(this); };

  proto.onunload = function () {
    if (this.engine && this.engine._progTimer) {
      clearInterval(this.engine._progTimer);
      this.engine._progTimer = null;
    }
    if (this.renderer) this.renderer.destroy();
  };

  ng19Graph.View = Ng19GraphView;
  return Ng19GraphView;
}

// ---------------------------------------------------------------- local view

/** Manifest factory: local graph view (link-pane base + engine). */
export function ng19LocalGraphView() {
  if (ng19Graph.LocalView) return ng19Graph.LocalView;
  ng19GraphControlSection();
  ng19GraphFilterSection();
  ng19GraphColorSection();
  ng19GraphDisplaySection();
  ng19GraphForceSection();
  ng19GraphRenderer();
  ng19GraphEngine();
  const host = ng19Host();
  const Base = env().gJ;

  function Ng19LocalGraphView(leaf) {
    const self = Base.call(this, leaf) || this;
    self.icon = "lucide-git-fork";
    self.renderer = null;
    self.engine = null;
    self._lastGraphFile = undefined;
    return self;
  }
  inherit(Ng19LocalGraphView, Base);
  const proto = Ng19LocalGraphView.prototype;

  Ng19LocalGraphView.VIEW_TYPE = ng19LocalGraphViewType;

  proto.getViewType = function () { return ng19LocalGraphViewType; };

  proto.load = function () {
    Base.prototype.load.call(this);
    this.renderer = new (ng19GraphRenderer())(this.contentEl, !env().Yl.isIosApp, true);
    this.engine = new (ng19GraphEngine())(this.app, this, this.renderer);
    this.dataEngine = this.engine;
    this.registerEvent(this.app.metadataCache.on("resolved", this.update, this));
    this.engine.load();
    const saved = this._pendingState && this._pendingState.options;
    if (saved) { this.engine.setOptions(saved); this._pendingState = null; }
  };

  proto.update = function () {
    const file = this.file;
    this.renderedFile = file || null;
    if (file !== this._lastGraphFile) {
      this._lastGraphFile = file;
      if (this.renderer) this.renderer.resetPan();
    }
    if (this.renderer) this.renderer.highlightNode = null;
    if (this.engine) {
      this.engine.options.localFile = file ? file.path : null;
      this.engine.render();
    }
  };

  proto.onFileChanged = function (file) {
    if (file && this.file && file.path === this.file.path) {
      if (this.requestUpdate) this.requestUpdate();
      else this.update();
    }
  };

  proto.getDisplayText = function () {
    const file = this.file;
    if (!file || env().Yl.isMobile) return ng19GT("name");
    let baseText = "";
    if (Base.prototype.getDisplayText) {
      baseText = Base.prototype.getDisplayText.call(this);
    } else if (file) {
      baseText = file.basename || file.name;
    }
    return ng19GT("tabTitle", { displayText: baseText });
  };

  proto.canAcceptExtension = function () { return true; };

  proto.getState = function () {
    const s = Base.prototype.getState.call(this);
    if (this.engine) s.options = this.engine.getOptions();
    return s;
  };

  proto.setState = function (state, result) {
    if (state && state.options) {
      if (this.engine) this.engine.setOptions(state.options);
      else this._pendingState = state;
    }
    return Base.prototype.setState.call(this, state, result);
  };

  proto.onOptionsChange = function () {
    if (this.app && this.app.workspace) this.app.workspace.requestSaveLayout();
  };

  proto.onPaneMenu = function (menu, source) {
    if (Base.prototype.onPaneMenu) Base.prototype.onPaneMenu.call(this, menu, source);
    ng19AddScreenshotItem(this, menu);
  };

  proto.copyScreenshot = function () { return ng19CopyScreenshot(this); };

  ng19Graph.LocalView = Ng19LocalGraphView;
  return Ng19LocalGraphView;
}

// --------------------------------------------------------------------- plugin

/** Manifest factory: the "graph" core plugin class. */
export function ng19GraphPlugin() {
  if (ng19Graph.Plugin) return ng19Graph.Plugin;
  const host = ng19Host();

  function Ng19GraphPlugin() {
    this.id = "graph";
    this.name = ng19GT("name");
    this.description = ng19GT("desc");
    this.defaultOn = true;
    this.options = {};
  }
  const proto = Ng19GraphPlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    const T = ng19GT;
    plugin.registerViewType(ng19GraphViewType, (leaf) => new (ng19GraphView())(leaf));
    plugin.registerViewType(ng19LocalGraphViewType, (leaf) => new (ng19LocalGraphView())(leaf));
    plugin.registerGlobalCommand({
      id: "graph:open",
      name: T("actionOpen"),
      icon: "lucide-git-fork",
      hotkeys: [makeHotkey(["Mod"], "G")],
      callback: (evt) => this.openGraphView(evt),
    });
    plugin.registerGlobalCommand({
      id: "graph:open-local",
      name: T("actionOpenLocal"),
      icon: "lucide-git-fork",
      checkCallback: (checking) => this.openLocalGraph(checking),
    });
    plugin.registerGlobalCommand({
      id: "graph:animate",
      name: T("actionTimelapse"),
      icon: "lucide-wand-2",
      checkCallback: (checking) => {
        const leaf = app.workspace.activeLeaf;
        const view = leaf && leaf.view;
        const ok = !!(view && view.getViewType && view.getViewType() === ng19GraphViewType && view.engine);
        if (!checking && ok) view.engine.renderProgression();
        return ok;
      },
    });
  };

  proto.onEnable = async function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
    plugin.registerRibbonItem(ng19GT("actionOpen"), "lucide-git-fork", (evt) => this.openGraphView(evt));
    this.options = Object.assign({}, (await plugin.loadData()) || {});
    app.workspace.registerHoverLinkSource("graph", { display: this.name, defaultMod: true });
    plugin.register(() => app.workspace.unregisterHoverLinkSource("graph"));
  };

  proto.onDisable = function (app) {
    app.workspace.unregisterHoverLinkSource("graph");
  };

  proto.onExternalSettingsChange = async function () {
    this.options = Object.assign({}, (await this.plugin.loadData()) || {});
  };

  proto.saveOptions = function () {
    if (this.plugin && this.plugin.saveData) this.plugin.saveData(this.options);
  };

  proto.openGraphView = function (event) {
    const app = this.app;
    const evt = event ?? app.lastEvent;
    const leaf = app.workspace.getLeaf(evt ? host.Keymap.isModEvent(evt) : false);
    leaf.setViewState({ type: ng19GraphViewType, active: true, state: {} });
  };

  proto.openLocalGraph = function (checking) {
    const app = this.app;
    const file = app.workspace.getActiveFile();
    if (!file) return false;
    if (!checking) {
      const leaf = app.workspace.getLeaf("split");
      leaf.setViewState({ type: ng19LocalGraphViewType, active: true, state: { file: file.path } });
    }
    return true;
  };

  proto.onFileMenu = function (menu, file, source, leaf) {
    const app = this.app;
    if (source === "sidebar-context-menu") return;
    if (!leaf) return;
    if (!(file instanceof env().$T)) return;
    if (file.extension !== "md") return;
    menu.addItem((item) => item
      .setSection("view.linked")
      .setTitle(ng19GT("actionOpenLocal"))
      .setIcon("lucide-git-fork")
      .onClick(() => {
        const target = app.workspace.getLeaf("split");
        target.setViewState({
          type: ng19LocalGraphViewType,
          active: true,
          group: leaf,
          state: { file: file.path },
        });
      }));
  };

  ng19Graph.Plugin = Ng19GraphPlugin;
  return Ng19GraphPlugin;
}
