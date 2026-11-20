// g23 clean-room: command palette internal plugin (palette.js replacement, palette half).
import { inherit } from "./inherit.js";
import { makeHotkey } from "./text.js";
import { sortByOrder } from "./misc.js";
import { prepareQuery, fuzzyMatchJs } from "./search.js";
import { renderResults } from "./search-simple.js";
import { ng23T, ng23SplitPrefix, ng23FormatHotkey, ng23OrderByPinned, ng23Collator, ng23Compare } from "./n-g23-util.js";

const CP_T = (host, key, fallback, arg) => ng23T(host, "plugins.commandPalette." + key, fallback, arg);
const II_T = (host, key, fallback, arg) => ng23T(host, "interface." + key, fallback, arg);

// ===========================================================================
// CommandPaletteSuggest (orig l8): AbstractInputSuggest over commands.
// ===========================================================================

export function defineCommandPaletteSuggest(host) {
  function CommandPaletteSuggest(app, inputEl, onChoose) {
    const self = host.AbstractInputSuggest.call(this, app, inputEl) || this;
    self.onChooseCallback = onChoose || null;
    return self;
  }
  inherit(CommandPaletteSuggest, host.AbstractInputSuggest);
  const proto = CommandPaletteSuggest.prototype;

  proto.getSuggestions = function (query) {
    const prepared = prepareQuery(String(query || ""));
    const out = [];
    for (const cmd of this.app.commands.listCommands()) {
      const match = fuzzyMatchJs(prepared, cmd.name);
      if (match) out.push({ match, item: cmd });
    }
    out.sort((a, b) => b.match.score - a.match.score);
    return out;
  };

  proto.renderSuggestion = function (value, el) {
    el.addClass("mod-complex");
    const content = el.createDiv("suggestion-content");
    const [prefix, rest] = ng23SplitPrefix(value.item.name);
    const span = content.createSpan();
    if (prefix) {
      span.createSpan({ cls: "suggestion-prefix", text: prefix });
      renderResults(span, rest, value.match);
    } else {
      renderResults(span, value.item.name, value.match);
    }
    if (value.item.icon) {
      const flair = el.createDiv("suggestion-flair");
      try { host.setIcon(flair, value.item.icon); } catch (e) {}
    }
  };

  proto.selectSuggestion = function (value, event) {
    this.close();
    if (this.onChooseCallback) this.onChooseCallback(value.item, event);
  };
  return CommandPaletteSuggest;
}

// ===========================================================================
// CommandPaletteModal (orig h8): FuzzySuggestModal over commands.
// ===========================================================================

export function defineCommandPaletteModal(host) {
  function CommandPaletteModal(app, plugin) {
    const self = host.FuzzySuggestModal.call(this, app) || this;
    self.plugin = plugin;
    self.setPlaceholder(CP_T(host, "promptTypeCommand", "Pick which command to include..."));
    self.setInstructions([
      { command: "↑↓", purpose: CP_T(host, "instructionNavigate", "to move around") },
      { command: "↵", purpose: CP_T(host, "instructionUse", "to run") },
      { command: "esc", purpose: CP_T(host, "instructionDismiss", "to close") },
    ]);
    self._items = null;
    return self;
  }
  inherit(CommandPaletteModal, host.FuzzySuggestModal);
  const proto = CommandPaletteModal.prototype;

  proto.getItems = function () {
    if (!this._items) this._items = this.plugin ? this.plugin.getCommands() : [];
    return this._items;
  };

  proto.getItemText = function (command) { return command.name; };

  proto.sortSuggestions = function (results) {
    for (const r of results) if (r.match && r.match.score > 0) r.match.score += (r.item.name || "").length / 10000;
    host.FuzzySuggestModal.prototype.sortSuggestions.call(this, results);
  };

  proto.renderSuggestion = function (result, el) {
    el.addClass("mod-complex");
    const content = el.createDiv("suggestion-content");
    const span = content.createSpan();
    const [prefix, rest] = ng23SplitPrefix(result.item.name);
    if (prefix) {
      span.createSpan({ cls: "suggestion-prefix", text: prefix });
      renderResults(span, rest, result.match);
    } else {
      renderResults(span, result.item.name, result.match);
    }
    const aux = el.createDiv("suggestion-aux");
    const hotkeys = ng23EffectiveHotkeysLocal(this.app, result.item.id);
    for (const hk of hotkeys) {
      const kbd = aux.createEl("kbd", { cls: "suggestion-hotkey" });
      kbd.setText(ng23FormatHotkey(host, hk));
    }
    const pinned = this.plugin && this.plugin.options && Array.isArray(this.plugin.options.pinned)
      ? this.plugin.options.pinned : [];
    if (pinned.includes(result.item.id)) {
      const flair = el.createDiv("suggestion-flair");
      host.setIcon(flair, "lucide-pin");
    }
  };

  proto.onOpen = function () {
    this._items = null;
    host.FuzzySuggestModal.prototype.onOpen.call(this);
  };

  proto.onClose = function () {
    this._items = null;
    host.SuggestModal.prototype.onClose.call(this);
  };

  proto.onChooseItem = function (command, event) {
    const app = this.app;
    const plugin = this.plugin;
    app.lastEvent = event;
    host.runCommandCallback(command);
    if (plugin) {
      const recents = (plugin.recentCommands || []).filter((id) => id !== command.id);
      recents.unshift(command.id);
      plugin.recentCommands = recents.slice(0, 100);
      try { app.saveLocalStorage("recent-commands", plugin.recentCommands); } catch (e) {}
    }
  };

  proto.onInput = function () { host.SuggestModal.prototype.onInput.call(this); };
  return CommandPaletteModal;
}

function ng23EffectiveHotkeysLocal(app, id) {
  const mgr = app.hotkeyManager;
  if (!mgr) return [];
  const custom = mgr.getHotkeys(id);
  return custom !== undefined ? custom : (mgr.getDefaultHotkeys(id) || []);
}

// ===========================================================================
// CommandPaletteSettingTab (orig p8): pin/unpin/reorder commands.
// ===========================================================================

export function defineCommandPaletteSettingTab(host) {
  function CommandPaletteSettingTab(app, pluginInstance, wrapper) {
    const self = host.PluginInstanceSettingTab.call(this, app, wrapper) || this;
    self.icon = "terminal";
    self.pluginInstance = pluginInstance;
    return self;
  }
  inherit(CommandPaletteSettingTab, host.PluginInstanceSettingTab);
  const proto = CommandPaletteSettingTab.prototype;

  proto._inst = function () { return this.pluginInstance; };
  proto._options = function () { const i = this.pluginInstance; return (i && i.options) || {}; };
  proto._save = function () {
    const inst = this.pluginInstance;
    const plugin = inst && inst.plugin;
    const options = this._options();
    const pinned = Array.isArray(options.pinned) && options.pinned.length ? options.pinned.slice() : null;
    options.pinned = pinned;
    if (plugin && plugin.saveSettings) plugin.saveSettings(plugin);
    else if (plugin && plugin.saveData) plugin.saveData(options);
  };

  proto.display = function () {
    const self = this;
    const inst = this.pluginInstance;
    const app = this.app;
    this.containerEl.empty();
    const options = this._options();
    const pinned = Array.isArray(options.pinned) ? options.pinned.slice() : [];
    const group = new host.SettingGroup(this.containerEl);

    group.addHeading(() => CP_T(host, "labelPinnedCommands", "Pinned commands"));

    // search field with command suggest
    group.addSetting((setting) => {
      setting.setName(II_T(host, "promptFilter", "Filter...")).setDesc("");
      setting.addText((text) => {
        text.setPlaceholder(CP_T(host, "promptTypeCommand", "Pick which command to include..."));
        const Suggest = defineCommandPaletteSuggest(host);
        const suggest = new Suggest(app, text.inputEl, (command) => {
          const opts = self._options();
          const list = Array.isArray(opts.pinned) ? opts.pinned.slice() : [];
          if (!list.includes(command.id)) list.push(command.id);
          opts.pinned = list;
          self._save();
          self.display();
        });
        // hide already-pinned commands from candidates
        const baseGet = suggest.getSuggestions.bind(suggest);
        suggest.getSuggestions = function (query) {
          const pinnedNow = self._options().pinned || [];
          const prepared = prepareQueryLocal(query);
          const out = [];
          for (const cmd of app.commands.listCommands()) {
            if (pinnedNow.includes(cmd.id)) continue;
            const m = fuzzyMatchJsLocal(prepared, cmd.name);
            if (m) out.push({ match: m, item: cmd });
          }
          out.sort((a, b) => b.match.score - a.match.score);
          return out;
        };
        void baseGet;
      });
    });

    // pinned rows
    const byId = new Map();
    for (const cmd of app.commands.listCommands()) byId.set(cmd.id, cmd);
    const listEl = group.listEl;
    if (pinned.length === 0) {
      listEl.createDiv("setting-item mod-empty").createDiv("setting-item-info").createDiv("setting-item-name")
        .setText(CP_T(host, "labelNoCommands", "Nothing matched those terms."));
    }
    for (const id of pinned) {
      const cmd = byId.get(id);
      if (!cmd) continue;
      const row = listEl.createDiv("mobile-option-setting-item");
      const nameEl = row.createDiv("mobile-option-setting-item-name");
      nameEl.setText(cmd.name);
      const nameText = ng23SplitPrefix(cmd.name)[1] || cmd.name;
      nameEl.setText(nameText);
      // remove button
      const rm = row.createDiv("clickable-icon");
      host.setIcon(rm, "lucide-x");
      try { host.setTooltip(rm, II_T(host, "deleteActionShortName", "Delete")); } catch (e) {}
      rm.addEventListener("click", () => {
        const opts = self._options();
        const list = (Array.isArray(opts.pinned) ? opts.pinned : []).filter((x) => x !== id);
        opts.pinned = list.length ? list : null;
        self._save();
        self.display();
      });
      // drag handle
      const handle = row.createDiv("clickable-icon");
      host.setIcon(handle, "lucide-menu");
      try { host.setTooltip(handle, II_T(host, "dragToRearrange", "Drag to reorder")); } catch (e) {}
      try {
        host.makeDragReorderable(row, handle, {
          group: listEl,
          itemSelector: ".mobile-option-setting-item",
          onChange: (from, to) => {
            const opts = self._options();
            const list = Array.isArray(opts.pinned) ? opts.pinned.slice() : [];
            const item = list.splice(from, 1)[0];
            list.splice(to, 0, item);
            opts.pinned = list.length ? list : null;
            self._save();
          },
        });
      } catch (e) {}
    }
    void inst;
  };
  return CommandPaletteSettingTab;
}

function prepareQueryLocal(q) { return prepareQuery(q); }
function fuzzyMatchJsLocal(p, t) { return fuzzyMatchJs(p, t); }

// ===========================================================================
// CommandPalettePlugin (orig u8): internal plugin id `command-palette`.
// ===========================================================================

export function defineCommandPalettePlugin(host) {
  function CommandPalettePlugin() {
    this.id = "command-palette";
    this.name = CP_T(host, "name", "Command palette");
    this.description = CP_T(host, "desc", "Cmd/Ctrl+P brings up the palette — then start typing.");
    this.defaultOn = true;
    this.options = {};
    this.app = null;
    this.plugin = null;
    this.modal = null;
    this.recentCommands = [];
  }
  const proto = CommandPalettePlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    const self = this;
    plugin.loadData().then((data) => {
      self.options = data && typeof data === "object" ? data : {};
    });
    const recents = ng23LoadStorageSafe(app, "recent-commands");
    if (Array.isArray(recents)) self.recentCommands = recents.slice(0, 100);
  };

  proto.onEnable = function (app, plugin) {
    const self = this;
    plugin.registerRibbonItem(CP_T(host, "actionOpen", "Command palette"), "lucide-terminal", () => self.onOpen());
    plugin.registerGlobalCommand({
      id: "command-palette:open",
      name: CP_T(host, "actionOpen", "Command palette"),
      icon: "lucide-terminal-square",
      hotkeys: [makeHotkey(["Mod"], "P")],
      showOnMobileToolbar: true,
      callback: () => self.onOpen(),
    });
    plugin.addSettingTab(new (defineCommandPaletteSettingTab(host))(app, this, plugin));
  };

  proto.onExternalSettingsChange = function () {
    const self = this;
    this.plugin.loadData().then((data) => {
      self.options = data && typeof data === "object" ? data : {};
    });
  };

  proto.onDisable = function () { this.modal = null; };

  proto.saveSettings = function (plugin) {
    const self = this;
    const data = { pinned: Array.isArray(self.options.pinned) && self.options.pinned.length ? self.options.pinned.slice() : null };
    self.options.pinned = data.pinned;
    if (plugin && plugin.saveData) plugin.saveData(data);
    try { self.app.saveLocalStorage("recent-commands", self.recentCommands || []); } catch (e) {}
  };

  /** Pinned first (pin order), rest name-sorted then floated by recency. */
  proto.getCommands = function () {
    const app = this.app;
    const commands = app.commands.listCommands();
    const pinned = Array.isArray(this.options.pinned) ? this.options.pinned.filter(Boolean) : [];
    const pinSet = new Set(pinned);
    const pinnedCmds = commands.filter((c) => pinSet.has(c.id));
    const rest = commands.filter((c) => !pinSet.has(c.id));
    rest.sort((a, b) => ng23Compare(a.name, b.name));
    sortByOrder(rest, this.recentCommands || []);
    const orderedPinned = pinnedCmds.slice().sort((a, b) => pinned.indexOf(a.id) - pinned.indexOf(b.id));
    return orderedPinned.concat(rest);
  };

  proto.onOpen = function () {
    if (this.modal) { this.modal.open(); return; }
    const Modal = defineCommandPaletteModal(host);
    const modal = new Modal(this.app, this);
    this.modal = modal;
    modal.open();
  };
  return CommandPalettePlugin;
}

function ng23LoadStorageSafe(app, key) {
  try { return app.loadLocalStorage(key); } catch (e) { return null; }
}
