// g26 clean-room: app.hotkeyManager (spec g26 Part B.3-B.4).
// Two hotkey tables (built-in defaults + user overrides from hotkeys.json),
// a lazily rebuilt flat bake list consulted by a catch-all root scope binding.

import { debounceCall } from "./timing.js";
import { keyLabel } from "./text.js";

function ng26CompileHotkey(hotkey, host) {
  return {
    modifiers: host.Keymap.compileModifiers(hotkey.modifiers || []),
    key: hotkey.code ? keyLabel(hotkey.code) : hotkey.key,
  };
}

function ng26FirstHotkeyText(hotkeys, host) {
  if (!hotkeys || !hotkeys.length) return "";
  const h = hotkeys[0];
  return host.formatHotkey({ modifiers: h.modifiers || [], key: h.code ? keyLabel(h.code) : h.key });
}

export function ng26DefineHotkeyManager(host) {
  function HotkeyManager(app) {
    this.app = app;
    this.defaultKeys = {};
    this._custom = {};
    this.baked = false;
    this.bakedHotkeys = [];
    this.bakedIds = [];
    this._listening = false;
    this.onConfigFileChange = debounceCall(() => this.load(), 50);
    app.scope.register(null, null, (event, info) => this.onTrigger(event, info));
  }
  const proto = HotkeyManager.prototype;

  Object.defineProperty(proto, "customKeys", {
    get() { return Object.assign({}, this._custom); },
  });

  proto.registerListeners = function () {
    if (this._listening) return;
    this._listening = true;
    this.app.vault.on("raw", (path) => this.onRaw(path));
  };

  proto.onRaw = function (path) {
    if (path === this.app.vault.configDir + "/hotkeys.json") this.onConfigFileChange();
  };

  proto.addDefaultHotkeys = function (id, hotkeys) {
    this.defaultKeys[id] = hotkeys;
    this.baked = false;
  };
  proto.getDefaultHotkeys = function (id) { return this.defaultKeys[id]; };
  proto.removeDefaultHotkeys = function (id) { delete this.defaultKeys[id]; };

  proto.getHotkeys = function (id) { return this._custom[id]; };
  proto.setHotkeys = function (id, hotkeys) {
    this._custom[id] = hotkeys;
    this.baked = false;
    if (host.Platform.isDesktopApp && this.app.appMenuBarManager) this.app.appMenuBarManager.requestRender();
  };
  proto.removeHotkeys = function (id) {
    delete this._custom[id];
    this.baked = false;
  };

  proto.printHotkeyForCommand = function (id) {
    const hotkeys = this._custom[id] !== undefined ? this._custom[id] : this.defaultKeys[id];
    return ng26FirstHotkeyText(hotkeys, host);
  };

  proto.bake = function () {
    if (this.baked) return;
    this.baked = true;
    this.bakedHotkeys = [];
    this.bakedIds = [];
    const push = (id, hotkeys) => {
      for (const h of hotkeys || []) {
        this.bakedHotkeys.push(ng26CompileHotkey(h, host));
        this.bakedIds.push(id);
      }
    };
    for (const id of Object.keys(this._custom)) push(id, this._custom[id]);
    for (const id of Object.keys(this.defaultKeys)) {
      if (this._custom[id] === undefined) push(id, this.defaultKeys[id]);
    }
  };

  proto.onTrigger = function (event, info) {
    this.bake();
    for (let i = 0; i < this.bakedIds.length; i++) {
      const id = this.bakedIds[i];
      if (!host.Keymap.isMatch({ modifiers: this.bakedHotkeys[i].modifiers, key: this.bakedHotkeys[i].key }, info)) continue;
      const command = this.app.commands.findCommand(id);
      if (!command) continue;
      if (event && event.repeat && !command.repeatable) continue;
      if (this.app.commands.executeCommand(command, event)) return false;
    }
    return undefined;
  };

  proto.save = function () {
    return this.app.vault.writeConfigJson("hotkeys", this._custom);
  };

  proto.load = function () {
    if (!this._listening && this.app.vault) this.registerListeners();
    return this.app.vault.readConfigJson("hotkeys").then((data) => {
      if (data && typeof data === "object" && !Array.isArray(data)) {
        this._custom = data;
        this.baked = false;
      }
    });
  };

  return HotkeyManager;
}
