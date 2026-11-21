// g26 clean-room: built-in plugin ids and the PluginWrapper that owns one core
// plugin's lifetime (spec g26 Part C). A wrapper collects contributions during
// init (commands, ribbon items, views, status bar, mobile file info, setting
// tabs, cli handlers) and replays them in a fixed order on enable/disable.

import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";

export const corePluginIds = [
  "file-explorer", "global-search", "switcher", "graph", "backlink", "outgoing-link",
  "tag-pane", "page-preview", "daily-notes", "templates", "note-composer",
  "command-palette", "slash-command", "editor-status", "starred", "markdown-importer",
  "zk-prefixer", "random-note", "outline", "word-count", "slides", "audio-recorder",
  "workspaces", "file-recovery", "publish", "sync",
];

export function ng26DefinePluginWrapper(host) {
  function PluginWrapper(app, instance, manager) {
    const self = host.Component.call(this) || this;
    self.app = app;
    self.instance = instance;
    self.manager = manager;
    self.enabled = false;
    self.commands = [];
    self.ribbonItems = [];
    self.views = {};
    self.statusBarEl = null;
    self.lastSave = 0;
    self.addedButtonEls = [];
    self.mobileFileInfo = [];
    self.hasStatusBarItem = false;
    self.onConfigFileChange = debounceCall(() => self.handleConfigFileChange(), 50);
    return self;
  }
  inherit(PluginWrapper, host.Component);
  const proto = PluginWrapper.prototype;

  proto.init = function () {
    if (this.instance.init) this.instance.init(this.app, this);
  };

  proto.enable = async function (byUser) {
    if (this.enabled) return;
    this.enabled = true;
    const app = this.app;
    const inst = this.instance;
    for (const command of this.commands) app.commands.addCommand(command);
    for (const item of this.ribbonItems) {
      const el = app.workspace.leftRibbon.addRibbonItemButton(item.id, item.icon, item.title, item.callback);
      this.addedButtonEls.push(el);
    }
    if (host.Platform.isMobile) {
      for (const info of this.mobileFileInfo) app.workspace.addMobileFileInfo(info);
    }
    if (this.hasStatusBarItem) {
      const el = app.statusBar.registerStatusBarItem();
      el.addClass("plugin-" + inst.id.toLowerCase().replace(/[^_a-zA-Z0-9-]/, "-"));
      this.statusBarEl = el;
    }
    for (const type of Object.keys(this.views)) app.viewRegistry.registerView(type, this.views[type]);
    if (inst.onEnable) await inst.onEnable(app, this);
    if (byUser && inst.onUserEnable) inst.onUserEnable(app);
    this.load();
    this.manager.requestSaveConfig();
    this.manager.trigger("change", this);
  };

  proto.disable = async function (byUser) {
    if (!this.enabled) return;
    this.enabled = false;
    const app = this.app;
    const inst = this.instance;
    const pending = inst.onDisable ? inst.onDisable(app, this) : null;
    if (pending && typeof pending.then === "function") await pending;
    if (byUser && inst.onUserDisable) inst.onUserDisable(app);
    for (const command of this.commands) app.commands.removeCommand(command.id);
    for (const el of this.addedButtonEls) el.detach();
    this.addedButtonEls = [];
    for (const item of this.ribbonItems) app.workspace.leftRibbon.removeRibbonAction(item.id);
    if (this.statusBarEl) { this.statusBarEl.detach(); this.statusBarEl = null; }
    for (const type of Object.keys(this.views)) {
      app.viewRegistry.unregisterView(type);
      if (byUser) app.workspace.detachLeavesOfType(type);
    }
    this.unload();
    this.manager.requestSaveConfig();
    this.manager.trigger("change", this);
  };

  proto.getModifiedTime = async function () {
    try {
      return (await this.app.vault.adapter.stat(this.app.vault.getConfigFile(this.instance.id))).mtime;
    } catch (err) {
      return 0;
    }
  };

  proto.handleConfigFileChange = async function () {
    if (!this.instance.onExternalSettingsChange) return;
    const mtime = await this.getModifiedTime();
    if (this.lastSave < mtime) this.instance.onExternalSettingsChange();
    this.lastSave = mtime;
  };

  proto.loadData = function () { return this.app.vault.readConfigJson(this.instance.id); };
  proto.saveData = function (data) {
    this.lastSave = Date.now();
    return this.app.vault.writeConfigJson(this.instance.id, data);
  };
  proto.deleteData = function () { return this.app.vault.deleteConfigJson(this.instance.id); };

  proto.registerViewType = function (type, view) { this.views[type] = view; };

  proto.registerGlobalCommand = function (command) {
    command.name = this.instance.name + ": " + command.name;
    this.commands.push(command);
  };

  proto.registerRibbonItem = function (title, icon, callback) {
    this.ribbonItems.push({ id: this.instance.id + ":" + title, title, icon, callback, hidden: false });
  };

  proto.registerStatusBarItem = function () { this.hasStatusBarItem = true; };
  proto.registerMobileFileInfo = function (renderCallback) { this.mobileFileInfo.push({ renderCallback }); };

  proto.addSettingTab = function (tab) {
    this.app.setting.addSettingTab(tab);
    this.register(() => this.app.setting.removeSettingTab(tab));
  };

  proto.registerCliHandler = function (id, name, options, callback) {
    this.app.cli.registerHandler(id, name, options, callback);
    this.register(() => this.app.cli.unregisterHandler(id, callback));
  };

  return PluginWrapper;
}
