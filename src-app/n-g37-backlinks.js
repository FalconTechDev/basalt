// g37 — backlink core plugin (clean-room). Factory: ng37BacklinkPlugin(host) -> plugin class.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

export const ng37BacklinkViewType = "backlink";
export const ng37MarkdownViewType = "markdown";

export function ng37CommandCallback(command) {
  if (command.checkCallback) command.checkCallback(false);
  else if (command.callback) command.callback();
  else console.error("Command ".concat(command, " did not provide a callback"));
}

const ng37Strings = () => env().gm.plugins.backlinks;

export function ng37BacklinkPlugin(host) {
  function Ng37BacklinkPlugin() {
    this.id = "backlink";
    this.defaultOn = true;
    this._file = null;
    this._options = {};
    const t = ng37Strings();
    this.name = t.name();
    this.description = t.desc();
  }

  const proto = Ng37BacklinkPlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerStatusBarItem();
    plugin.registerViewType(ng37BacklinkViewType, (leaf) => new (env().H6)(leaf));
    const t = ng37Strings();
    plugin.registerGlobalCommand({
      id: "backlink:open",
      name: t.actionShow(),
      icon: "lucide-link",
      callback: () => {
        this.app.workspace.ensureSideLeaf(ng37BacklinkViewType, "right", { active: true });
      },
    });
    plugin.registerGlobalCommand({
      id: "backlink:open-backlinks",
      name: t.actionOpenForCurrent(),
      icon: "lucide-link",
      checkCallback: (checking) => this.openBacklinksForActiveFile(checking),
    });
    plugin.registerGlobalCommand({
      id: "backlink:toggle-backlinks-in-document",
      name: t.actionToggleBacklinksInDocument(),
      icon: "lucide-link",
      checkCallback: (checking) => this.toggleBacklinksInDocument(checking),
    });
  };

  proto.onEnable = async function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerEvent(app.workspace.on("file-open", (file) => this.onFileOpen(file)));
    plugin.registerEvent(app.workspace.on("layout-ready", () => this.updateBacklinks()));
    plugin.registerEvent(app.workspace.on("file-menu", (menu, file, source, leaf) => this.onFileMenu(menu, file, source, leaf)));
    plugin.registerEvent(app.metadataCache.on("resolved", () => this.updateBacklinks()));

    const bar = plugin.statusBarEl;
    if (bar) {
      bar.addClass("mod-clickable");
      const open = () => {
        this.app.workspace.ensureSideLeaf(ng37BacklinkViewType, "right", { active: true, reveal: true });
      };
      bar.addEventListener("click", open);
      plugin.register(() => bar.removeEventListener("click", open));
    }

    const data = await plugin.loadData();
    this._options = data && typeof data === "object" ? data : {};
    app.workspace.backlinkInDocument = this._options.backlinkInDocument;
    plugin.addSettingTab(new (ng37BacklinksSettingTab(host))(app, plugin, this));
  };

  proto.onExternalSettingsChange = async function () {
    const data = await this.plugin.loadData();
    this._options = data && typeof data === "object" ? data : {};
    this.app.workspace.backlinkInDocument = this._options.backlinkInDocument;
  };

  proto.onUserEnable = function () { this.initLeaf(); };

  proto.initLeaf = function () {
    this.app.workspace.ensureSideLeaf(ng37BacklinkViewType, "right", { reveal: false });
  };

  proto.onUserDisable = function (app) {
    app.workspace.detachLeavesOfType(ng37BacklinkViewType);
    const leaves = [];
    app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view && leaf.view.getViewType && leaf.view.getViewType() === ng37MarkdownViewType) leaves.push(leaf);
    });
    for (const leaf of leaves) {
      const state = leaf.getViewState ? leaf.getViewState() : null;
      if (state && state.state) {
        state.state.backlinks = false;
        leaf.setViewState(state);
      }
    }
    app.workspace.requestSaveLayout();
  };

  proto.onFileOpen = function (file) {
    const TFile = env().$T;
    this._file = file && TFile && file instanceof TFile ? file : null;
    this.updateBacklinks();
  };

  proto.updateBacklinks = function () {
    const bar = this.plugin && this.plugin.statusBarEl;
    if (!bar) return;
    if (!this._file) {
      bar.setText("");
      bar.hide();
      return;
    }
    const resolved = this.app.metadataCache.resolvedLinks || {};
    let count = 0;
    for (const source in resolved) {
      if (!resolved.hasOwnProperty(source) || source === this._file.path) continue;
      const links = resolved[source];
      if (links && links[this._file.path] != null) count += links[this._file.path];
    }
    if (count <= 0) {
      bar.setText("");
      bar.hide();
      return;
    }
    bar.setText(env().gm.nouns.backlinkWithCount({ count }));
    bar.show();
  };

  proto._activeMarkdownView = function () {
    const leaf = this.app.workspace.activeLeaf;
    const view = leaf && leaf.view;
    const MD = env().W6;
    return view && MD && view instanceof MD ? view : null;
  };

  proto.openBacklinksForActiveFile = function (byPassCheck) {
    if ((env().Yl || {}).isPhone) return false;
    const leaf = this.app.workspace.activeLeaf;
    const file = leaf && leaf.view && leaf.view.file;
    if (!file) return undefined;
    if (!byPassCheck) {
      const group = leaf;
      const newLeaf = this.app.workspace.splitLeafOrActive(leaf, "vertical");
      if (newLeaf && newLeaf.setViewState) {
        newLeaf.setViewState({
            type: ng37BacklinkViewType,
            state: { file: file.path },
            active: true,
            group,
          });
      }
    }
    return true;
  };

  proto.toggleBacklinksInDocument = function (byPassCheck) {
    const view = this._activeMarkdownView();
    if (!view || typeof view.canToggleBacklinks !== "function" || !view.canToggleBacklinks()) return undefined;
    if (!byPassCheck && typeof view.toggleBacklinks === "function") view.toggleBacklinks();
    return true;
  };

  proto.onFileMenu = function (menu, file, source, leaf) {
    const TFile = env().$T;
    if (!file || !(TFile && file instanceof TFile)) return;
    const t = ng37Strings();
    const Yl = env().Yl || {};
    if (!Yl.isMobile && source !== "sidebar-context-menu" && leaf) {
      menu.addItem((item) => {
        item.setSection("view.linked")
          .setTitle(t.actionOpen())
          .setIcon("links-coming-in")
          .onClick(() => {
            const newLeaf = this.app.workspace.splitLeafOrActive(leaf, "horizontal");
            if (newLeaf && newLeaf.setViewState) {
              newLeaf.setViewState({
                  type: ng37BacklinkViewType,
                  state: { file: file.path },
                  active: true,
                });
            }
          });
      });
    }
    const view = leaf && leaf.view;
    const MD = env().W6;
    if (view && MD && view instanceof MD && typeof view.canToggleBacklinks === "function" && view.canToggleBacklinks()) {
      const state = view.getState ? view.getState() : {};
      menu.addItem((item) => {
        item.setSection("pane")
          .setTitle(t.menuOptBacklinksInDocument())
          .setIcon("links-coming-in")
          .setChecked(!!(state && state.backlinks))
          .onClick(() => { if (typeof view.toggleBacklinks === "function") view.toggleBacklinks(); });
      });
    }
  };

  return Ng37BacklinkPlugin;
}

let ng37BacklinksTabClass = null;

/** s31BacklinksSettingTab: one toggle for "backlinks in document", persisted via plugin data. */
export function ng37BacklinksSettingTab(host) {
  if (ng37BacklinksTabClass) return ng37BacklinksTabClass;
  const Base = env().Y0;
  function Ng37BacklinksSettingTab(app, plugin, instance) {
    const self = Base.call(this, app, plugin) || this;
    self.icon = "links-coming-in";
    self.instance = instance;
    return self;
  }
  inherit(Ng37BacklinksSettingTab, Base);
  Ng37BacklinksSettingTab.prototype.display = function () {
    const containerEl = this.containerEl;
    containerEl.empty();
    const t = ng37Strings();
    const options = this.instance._options || {};
    const group = new host.SettingGroup(containerEl);
    group.addSetting((setting) => {
      setting
        .setName(t.optionBacklinkInDocument())
        .setDesc(t.optionBacklinkInDocumentDesc())
        .addToggle((toggle) => {
          toggle.setValue(!!options.backlinkInDocument);
          toggle.onChange(async (value) => {
            this.instance._options.backlinkInDocument = value;
            this.app.workspace.backlinkInDocument = value;
            await this.plugin.saveData(this.instance._options);
          });
        });
    });
  };
  ng37BacklinksTabClass = Ng37BacklinksSettingTab;
  return ng37BacklinksTabClass;
}
