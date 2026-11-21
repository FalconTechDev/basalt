// g28 Plugin base class, part 1 (spec g28 Part F): constructor, lifecycle,
// and every register* method. Data/persistence methods live in
// n-g28-plugin-data.js (ng28PluginData attaches them to the prototype).
import { normalizePath } from "./n-g28-path.js";
import { debounceCall } from "./timing.js";
import { inherit } from "./inherit.js";
import { ng28PluginData } from "./n-g28-plugin-data.js";

/** Manifest entry G0 -> Plugin. */
export function definePlugin(host) {
  function Plugin(app, manifest) {
    const self = host.Component.call(this) || this;
    self._lastDataModifiedTime = 0;
    self._userDisabled = false;
    self.onConfigFileChange = debounceCall(() => self._onConfigFileChange(), 50);
    self.app = app;
    self.manifest = manifest;
    return self;
  }
  inherit(Plugin, host.Component);

  /** Waits for an async onload() before loading children (unlike Component.load). */
  Plugin.prototype.load = function () {
    if (this._loaded) return;
    this._loaded = true;
    const own = this.onload();
    const loadChildren = () => {
      for (const child of this._children.slice()) child.load();
    };
    if (own && typeof own.then === "function") return Promise.resolve(own).then(loadChildren);
    loadChildren();
    return undefined;
  };

  Plugin.prototype.onload = function () {};
  Plugin.prototype.onUserEnable = function () {};

  Plugin.prototype.addRibbonIcon = function (icon, title, callback) {
    const id = this.manifest.id + ":" + title;
    const button = this.app.workspace.leftRibbon.addRibbonItemButton(id, icon, title, callback);
    this.register(() => {
      this.app.workspace.leftRibbon.removeRibbonAction(id);
      if (button && button.parentNode) button.parentNode.removeChild(button);
    });
    return button;
  };

  Plugin.prototype.addStatusBarItem = function () {
    const el = this.app.statusBar.registerStatusBarItem();
    const sanitized = this.manifest.id.toLowerCase().replace(/[^a-zA-Z0-9_-]/, "-");
    el.classList.add("plugin-" + sanitized);
    this.register(() => { if (el.parentNode) el.parentNode.removeChild(el); });
    return el;
  };

  Plugin.prototype.addCommand = function (command) {
    command.id = this.manifest.id + ":" + command.id;
    command.name = this.manifest.name + ": " + command.name;
    this.app.commands.addCommand(command);
    this.register(() => this.app.commands.removeCommand(command.id));
    return command;
  };

  Plugin.prototype.removeCommand = function (id) {
    this.app.commands.removeCommand(this.manifest.id + ":" + id);
  };

  Plugin.prototype.addSettingTab = function (tab) {
    this.app.setting.addSettingTab(tab);
    this.register(() => this.app.setting.removeSettingTab(tab));
  };

  Plugin.prototype.registerView = function (type, creator) {
    this.app.viewRegistry.registerView(type, creator);
    this.register(() => {
      this.app.viewRegistry.unregisterView(type);
      if (this._userDisabled) this.app.workspace.detachLeavesOfType(type);
    });
  };

  Plugin.prototype.registerHoverLinkSource = function (id, info) {
    this.app.workspace.registerHoverLinkSource(id, info);
    this.register(() => this.app.workspace.unregisterHoverLinkSource(id));
  };

  Plugin.prototype.registerExtensions = function (extensions, viewType) {
    this.app.viewRegistry.registerExtensions(extensions, viewType);
    this.register(() => this.app.viewRegistry.unregisterExtensions(extensions, viewType));
  };

  Plugin.prototype.registerMarkdownPostProcessor = function (processor, sortOrder) {
    host.MarkdownPreviewRenderer.registerPostProcessor(processor, sortOrder);
    this.app.workspace.trigger("post-processor-change");
    this.register(() => {
      host.MarkdownPreviewRenderer.unregisterPostProcessor(processor);
      this.app.workspace.trigger("post-processor-change");
    });
    return processor;
  };

  Plugin.prototype.registerMarkdownCodeBlockProcessor = function (language, handler, sortOrder) {
    const processor = host.MarkdownPreviewRenderer.createCodeBlockPostProcessor(language, handler);
    host.MarkdownPreviewRenderer.registerPostProcessor(processor, sortOrder);
    host.MarkdownPreviewRenderer.registerCodeBlockPostProcessor(language, handler);
    this.app.workspace.trigger("post-processor-change");
    this.register(() => {
      host.MarkdownPreviewRenderer.unregisterPostProcessor(processor);
      host.MarkdownPreviewRenderer.unregisterCodeBlockPostProcessor(language, handler);
      this.app.workspace.trigger("post-processor-change");
    });
    return processor;
  };

  Plugin.prototype.registerBasesView = function (type, registration) {
    const bases = this.app.internalPlugins.getEnabledPluginById("bases");
    if (!bases) return false;
    bases.registerView(type, registration);
    this.register(() => bases.deregisterView(type));
    return true;
  };

  Plugin.prototype.registerGlobalFunc = function (func) {
    host.FormulaFunctions.addGlobal(func);
    this.register(() => host.FormulaFunctions.removeGlobal(func.name));
  };

  Plugin.prototype.registerInstanceFunc = function (type, func) {
    host.FormulaFunctions.addForType(type, func);
    this.register(() => host.FormulaFunctions.removeForType(type, func.name));
  };

  /** CM5 is gone; kept as a no-op so older plugins do not crash. */
  Plugin.prototype.registerCodeMirror = function () {};

  Plugin.prototype.registerEditorExtension = function (extension) {
    this.app.workspace.registerEditorExtension(extension);
    this.register(() => this.app.workspace.unregisterEditorExtension(extension));
  };

  Plugin.prototype.registerObsidianProtocolHandler = function (action, handler) {
    this.app.workspace.registerObsidianProtocolHandler(action, handler);
    this.register(() => this.app.workspace.unregisterObsidianProtocolHandler(action, handler));
  };

  Plugin.prototype.registerEditorSuggest = function (suggest) {
    this.app.workspace.editorSuggest.addSuggest(suggest);
    this.register(() => this.app.workspace.editorSuggest.removeSuggest(suggest));
  };

  Plugin.prototype.registerCliHandler = function (command, description, flags, handler) {
    this.app.cli.registerHandler(command, "[" + this.manifest.name + "]: " + description, flags, handler);
    this.register(() => this.app.cli.unregisterHandler(command, handler));
  };

  ng28PluginData(Plugin, host, normalizePath);
  return Plugin;
}
