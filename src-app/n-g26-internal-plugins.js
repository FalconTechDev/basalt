// g26 clean-room: app.internalPlugins (spec g26 Part C.2-C.3).
// Loads core plugin objects into wrappers, restores the enabled set from
// core-plugins.json (with legacy array migration) and persists changes through
// a debounced save. plugins is a plain id -> wrapper object (settings UI reads
// it with Object.keys).

import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { parentPath, baseName, extensionOf } from "./path.js";
import { corePluginIds } from "./n-g26-core-plugins.js";
import { ng26DefinePluginWrapper } from "./n-g26-core-plugins.js";

function ng26MigrationConfig(app) {
  return app.vault.readConfigJson("core-plugins-migration").then((data) =>
    data && typeof data === "object" && !Array.isArray(data) ? data : {});
}

export function ng26DefineInternalPlugins(host) {
  const WrapperClass = ng26DefinePluginWrapper(host);

  function InternalPlugins(app) {
    const self = host.Events.call(this) || this;
    self.app = app;
    self.plugins = {};
    self.config = {};
    self.requestSaveConfig = debounceCall(() => self.saveConfig(), 500);
    if (app.vault) app.vault.on("raw", (path) => self.onRaw(path));
    return self;
  }
  inherit(InternalPlugins, host.Events);
  const proto = InternalPlugins.prototype;

  proto.onRaw = function (path) {
    const vault = this.app.vault;
    if (parentPath(path) !== vault.configDir || extensionOf(path) !== "json") return;
    const wrapper = this.plugins[baseName(path)];
    if (wrapper && wrapper.enabled) wrapper.onConfigFileChange();
  };

  proto.getPluginById = function (id) { return this.plugins[id] || null; };

  proto.getEnabledPluginById = function (id) {
    const wrapper = this.plugins[id];
    return wrapper && wrapper.enabled ? wrapper.instance : null;
  };

  proto.getEnabledPlugins = function () {
    return Object.keys(this.plugins).filter((id) => this.plugins[id].enabled).map((id) => this.plugins[id]);
  };

  proto.loadPlugin = function (instance) {
    if (this.plugins[instance.id]) {
      throw new Error("Plugin " + instance.name + " has already been loaded");
    }
    const wrapper = new WrapperClass(this.app, instance, this);
    wrapper.init();
    this.plugins[instance.id] = wrapper;
    return instance;
  };

  proto.enable = async function () {
    const saved = await this.app.vault.readConfigJson("core-plugins");
    let config;
    if (Array.isArray(saved)) {
      config = await ng26MigrationConfig(this.app);
      const listed = new Set(saved);
      for (const id of corePluginIds) {
        if (this.plugins[id]) config[id] = listed.has(id);
      }
    } else if (saved && typeof saved === "object") {
      config = saved;
    } else {
      config = {};
    }
    const enabling = [];
    for (const id of Object.keys(this.plugins)) {
      const wrapper = this.plugins[id];
      if (config[id] !== undefined) {
        if (config[id]) enabling.push(wrapper.enable(false));
      } else if (wrapper.instance.defaultOn) {
        enabling.push(wrapper.enable(false));
        this.requestSaveConfig();
      }
    }
    await Promise.all(enabling);
    this.config = config;
  };

  proto.enablePlugin = function (id) {
    const wrapper = this.plugins[id];
    return wrapper ? wrapper.enable(true) : Promise.resolve();
  };
  proto.disablePlugin = function (id) {
    const wrapper = this.plugins[id];
    return wrapper ? wrapper.disable(true) : Promise.resolve();
  };

  proto.saveConfig = function () {
    const config = this.config;
    for (const id of Object.keys(this.plugins)) config[id] = this.plugins[id].enabled;
    return this.app.vault.writeConfigJson("core-plugins", config);
  };

  return InternalPlugins;
}
