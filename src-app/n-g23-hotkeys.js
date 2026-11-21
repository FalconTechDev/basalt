// g23 clean-room: "Hotkeys" settings tab (spec g23 §3.3).
import { inherit } from "./inherit.js";
import { makeHotkey } from "./text.js";
import { ng23T, ng23FormatHotkey, ng23Collator, ng23Contains } from "./n-g23-util.js";

const NG23HK_T = (host, key, fb, arg) => ng23T(host, "setting.hotkeys." + key, fb, arg);
const NG23HK_OPT_T = (host, key, fb, arg) => ng23T(host, "setting.options." + key, fb, arg);
const NG23HK_IF_T = (host, key, fb) => ng23T(host, "interface." + key, fb);

const FILTERS = [
  ["show-all", "labelShowAll", "Everything"],
  ["show-assigned", "labelShowAssigned", "Assigned"],
  ["show-user-assigned", "labelShowUserAssigned", "Set by me"],
  ["show-unassigned", "labelShowUnassigned", "Not assigned"],
];

/** Removable filter chip: .hotkey-filter > .hotkey-filter-inner + .hotkey-filter-remove-button. */
function Ng23HotkeyFilterChip(host, containerEl) {
  const self = this;
  self.el = containerEl.createDiv("hotkey-filter");
  self.innerEl = self.el.createDiv("hotkey-filter-inner");
  self.value = "";
  self.title = "";
  self.onRemoveCallback = null;
  self.removed = false;
  const btn = self.el.createDiv("hotkey-filter-remove-button clickable-icon");
  host.setIcon(btn, "lucide-x");
  host.setTooltip(btn, NG23HK_IF_T(host, "menu.close", "Close"));
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    self.remove();
  });
  self._render();
}
const chipProto = Ng23HotkeyFilterChip.prototype;
chipProto._render = function () {
  this.innerEl.setText(this.value || this.title || "");
};
chipProto.setValue = function (value) { this.value = value; this._render(); return this; };
chipProto.setTitle = function (title) { this.title = title; this._render(); return this; };
chipProto.onRemove = function (cb) { this.onRemoveCallback = cb; return this; };
chipProto.remove = function () {
  if (this.removed) return;
  this.removed = true;
  if (this.el) this.el.detach();
  const cb = this.onRemoveCallback;
  this.onRemoveCallback = null;
  if (cb) cb();
};

export function defineHotkeysTab(host) {
  function HotkeysTab(app, setting) {
    const self = host.SettingTab.call(this, app, setting) || this;
    self.name = NG23HK_T(host, "name", "Hotkeys");
    self.id = "hotkeys";
    self.icon = "command";
    self.query = "";
    self.statusFilter = "show-all";
    self.hotkeyFilter = ""; // formatted hotkey text
    self.commandBeingCustomized = null;
    self.setHotkeyScope = null;
    self.filterHotkeyScope = null;
    self._searchSetting = null;
    self._searchInput = null;
    self._chips = [];
    self._listEl = null;
    self._descEl = null;
    return self;
  }
  inherit(HotkeysTab, host.SettingTab);
  const proto = HotkeysTab.prototype;

  proto._effective = function (id) {
    const mgr = this.app.hotkeyManager;
    const custom = mgr.getHotkeys(id);
    return custom !== undefined ? custom : (mgr.getDefaultHotkeys(id) || []);
  };

  proto._commands = function () {
    const list = Object.values(this.app.commands.commands);
    const nameOf = (c) => (typeof c.name === "function" ? c.name() : c.name) || c.id;
    return list.slice().sort((a, b) => ng23Collator.compare(nameOf(a), nameOf(b)));
  };

  proto.display = function () {
    const self = this;
    this.containerEl.empty();
    this._chips = [];
    const group = new host.SettingGroup(this.containerEl);

    // search setting + status filter + hotkey capture buttons
    group.addSetting((setting) => {
      setting.setName(NG23HK_T(host, "optionSearch", "Find hotkeys"));
      self._descEl = setting.descEl;
      setting.addSearch((search) => {
        self._searchInput = search;
        search.setPlaceholder(NG23HK_T(host, "promptFilter", "Filter..."));
        search.setValue(self.query);
        search.onChange((value) => { self.setQuery(value); });
        search.addRightDecorator((decorator) => {
          decorator.addClass("clickable-icon");
          host.setIcon(decorator, "lucide-keyboard");
          host.setTooltip(decorator, NG23HK_T(host, "labelWaitingForHotkeyPress", "Press a key combination..."));
          decorator.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            self._armHotkeyFilter();
          });
        });
      });
      setting.addExtraButton((button) => {
        button.setIcon("lucide-filter");
        button.setTooltip(NG23HK_OPT_T(host, "labelFilter", "Filter"));
        button.extraSettingsEl.addEventListener("click", (event) => self.showFilterMenu(event));
      });
      self._searchSetting = setting;
    });

    // filter chip container + command list container
    const filterBox = group.listEl.createDiv("setting-filter-container");
    const listBox = group.listEl.createDiv("hotkey-list-container");
    this._filterBoxEl = filterBox;
    this._listEl = listBox;

    // restore chips for active filters
    if (this.statusFilter !== "show-all") this._addStatusChip();
    if (this.hotkeyFilter) this._addHotkeyChip();

    this.updateHotkeyVisibility();
    if (host.Platform.hasPhysicalKeyboard && self._searchInput) {
      try { self._searchInput.inputEl.focus(); } catch (err) {}
    }
  };

  proto._addStatusChip = function () {
    const found = FILTERS.find((f) => f[0] === this.statusFilter);
    if (!found) return;
    const chip = new Ng23HotkeyFilterChip(host, this._filterBoxEl);
    chip.setTitle(NG23HK_T(host, found[1], found[2]));
    chip.onRemove(() => { this.statusFilter = "show-all"; this.updateHotkeyVisibility(); });
    this._chips.push(chip);
  };

  proto._addHotkeyChip = function () {
    const chip = new Ng23HotkeyFilterChip(host, this._filterBoxEl);
    chip.setValue(this.hotkeyFilter);
    chip.setTitle(this.hotkeyFilter);
    chip.onRemove(() => { this.hotkeyFilter = ""; this.updateHotkeyVisibility(); });
    this._chips.push(chip);
  };

  proto._clearChips = function () {
    for (const chip of this._chips) chip.remove();
    this._chips = [];
  };

  proto.setDescription = function (shown, conflicts) {
    if (!this._descEl) return;
    const desc = NG23HK_T(host, "optionSearchDesc", "{{count}} hotkey matches the current filter. ", { count: shown });
    const conflict = conflicts > 0
      ? NG23HK_T(host, "optionSearchConflict", "{{count}} command has a clash. ", { count: conflicts })
      : "";
    this._descEl.empty();
    this._descEl.setText(desc + (conflict ? " " : "") + conflict);
  };

  proto.setQuery = function (query) {
    this.query = String(query || "");
    if (this._searchInput) {
      try { this._searchInput.setValue(this.query); } catch (err) {}
      try { this._searchInput.inputEl.focus(); } catch (err) {}
    }
    this.updateHotkeyVisibility();
  };

  proto.setStatusFilter = function (filter) {
    this.statusFilter = FILTERS.some((f) => f[0] === filter) ? filter : "show-all";
    if (this.statusFilter !== "show-all") {
      // single-instance chips: a status filter replaces the hotkey filter
      this.hotkeyFilter = "";
    }
    if (this._filterBoxEl) {
      this._clearChips();
      if (this.statusFilter !== "show-all") this._addStatusChip();
      if (this.hotkeyFilter) this._addHotkeyChip();
    }
    this.updateHotkeyVisibility();
  };

  proto.setHotkeyFilter = function (hotkey) {
    this.hotkeyFilter = hotkey ? ng23FormatHotkey(host, hotkey) : "";
    if (this.hotkeyFilter) {
      this.statusFilter = "show-all";
      if (this._filterBoxEl) {
        this._clearChips();
        this._addHotkeyChip();
      }
    }
    this.updateHotkeyVisibility();
  };

  proto.showFilterMenu = function (event) {
    const self = this;
    const menu = new host.Menu();
    for (const [value, key, fb] of FILTERS) {
      menu.addItem((item) => {
        item.setTitle(NG23HK_T(host, key, fb));
        item.setChecked(self.statusFilter === value);
        item.onClick(() => self.setStatusFilter(value));
      });
    }
    menu.showAtMouseEvent(event);
  };

  proto._armHotkeyFilter = function () {
    // keyboard icon in the search field: capture the next key combo as filter
    if (this.filterHotkeyScope) return;
    this._waitingChip = new Ng23HotkeyFilterChip(host, this._filterBoxEl || this.containerEl);
    this._waitingChip.setValue(NG23HK_T(host, "labelWaitingForHotkeyPress", "Press a key combination..."));
    this._waitingChip.onRemove(() => this.finishFilteringByHotkey());
    const scope = new host.Scope(host.Keymap.global.getRootScope());
    scope.register(null, null, (event, info) => {
      event.preventDefault();
      event.stopPropagation();
      if (info.key === "Escape" || info.vkey === "Escape") {
        self.finishFilteringByHotkey();
        return false;
      }
      self.setHotkeyFilter(makeHotkey(host.Keymap.decompileModifiers(info.modifiers || ""), info.vkey));
      self.finishFilteringByHotkey();
      return false;
    });
    this.filterHotkeyScope = scope;
    host.Keymap.global.pushScope(scope);
  };

  proto.finishFilteringByHotkey = function () {
    if (this.filterHotkeyScope) {
      host.Keymap.global.popScope(this.filterHotkeyScope);
      this.filterHotkeyScope = null;
    }
    if (this._waitingChip) {
      this._waitingChip.remove();
      this._waitingChip = null;
    }
    this.updateHotkeyVisibility();
  };

  proto._startCustomizing = function (command) {
    this.finishCustomizingHotkey();
    this.commandBeingCustomized = command.id;
    const scope = new host.Scope(host.Keymap.global.getRootScope());
    scope.register(null, null, (event, info) => {
      event.preventDefault();
      event.stopPropagation();
      const keyName = info.vkey || info.key;
      if (keyName === "Escape" || info.key === "Escape") {
        this.finishCustomizingHotkey();
        return false;
      }
      const modifiers = host.Keymap.decompileModifiers(info.modifiers || "");
      const isFunctionKey = /^F\d+$/.test(keyName);
      const valid = modifiers.length > 0 || isFunctionKey;
      const shiftLetter = modifiers.length === 1 && modifiers[0] === "Shift" && keyName.length === 1;
      if (!valid || shiftLetter) return false;
      const hotkey = makeHotkey(modifiers, keyName);
      const mgr = this.app.hotkeyManager;
      const effective = mgr.getHotkeys(command.id) !== undefined
        ? mgr.getHotkeys(command.id)
        : (mgr.getDefaultHotkeys(command.id) || []);
      const formatted = ng23FormatHotkey(host, hotkey);
      const duplicate = effective.some((h) => ng23FormatHotkey(host, h) === formatted);
      if (duplicate) return false;
      mgr.setHotkeys(command.id, effective.concat([hotkey]));
      mgr.save();
      this.finishCustomizingHotkey();
      return false;
    });
    this.setHotkeyScope = scope;
    host.Keymap.global.pushScope(scope);
    this.updateHotkeyVisibility();
  };

  proto.finishCustomizingHotkey = function () {
    if (this.setHotkeyScope) {
      host.Keymap.global.popScope(this.setHotkeyScope);
      this.setHotkeyScope = null;
    }
    if (this.commandBeingCustomized !== null) {
      this.commandBeingCustomized = null;
      this.updateHotkeyVisibility();
    }
  };

  proto.hide = function () {
    this.finishCustomizingHotkey();
  };

  proto._removeHotkey = function (command, hotkey) {
    const mgr = this.app.hotkeyManager;
    const id = command.id;
    const custom = mgr.getHotkeys(id);
    const defaults = mgr.getDefaultHotkeys(id) || [];
    const base = custom !== undefined ? custom : defaults;
    const formatted = ng23FormatHotkey(host, hotkey);
    const remaining = base.filter((h) => ng23FormatHotkey(host, h) !== formatted);
    if (custom !== undefined) {
      if (remaining.length === 0 && defaults.length === 0) mgr.removeHotkeys(id);
      else mgr.setHotkeys(id, remaining);
    } else {
      mgr.setHotkeys(id, remaining);
    }
    mgr.save();
    this.updateHotkeyVisibility();
  };

  proto._restoreHotkeys = function (command) {
    const mgr = this.app.hotkeyManager;
    mgr.removeHotkeys(command.id);
    mgr.save();
    this.finishCustomizingHotkey();
    this.updateHotkeyVisibility();
  };

  proto.updateHotkeyVisibility = function () {
    const listEl = this._listEl;
    if (!listEl) return;
    const app = this.app;
    const mgr = app.hotkeyManager;
    const query = this.query.toLowerCase();
    const nameOf = (c) => (typeof c.name === "function" ? c.name() : c.name) || c.id;

    // formatted hotkey -> set of command names (conflict detection over ALL commands)
    const owners = new Map();
    const commands = this._commands();
    for (const command of commands) {
      const effective = this._effective(command.id);
      for (const hotkey of effective) {
        const text = ng23FormatHotkey(host, hotkey);
        if (!text) continue;
        if (!owners.has(text)) owners.set(text, new Set());
        owners.get(text).add(nameOf(command));
      }
    }

    let shown = 0;
    let conflicts = 0;
    listEl.empty();

    for (const command of commands) {
      const name = nameOf(command);
      const custom = mgr.getHotkeys(command.id);
      const defaults = mgr.getDefaultHotkeys(command.id) || [];
      const effective = custom !== undefined ? custom : defaults;

      if (query && !(ng23Contains(name, query) || command.id.toLowerCase().startsWith(query))) continue;
      if (this.hotkeyFilter && !effective.some((h) => ng23FormatHotkey(host, h) === this.hotkeyFilter)) continue;
      const hasCustom = custom !== undefined && custom.length > 0;
      if (this.statusFilter === "show-assigned" && effective.length === 0) continue;
      if (this.statusFilter === "show-user-assigned" && !hasCustom) continue;
      if (this.statusFilter === "show-unassigned" && effective.length > 0) continue;

      const commandConflicts = [];
      for (const hotkey of effective) {
        const text = ng23FormatHotkey(host, hotkey);
        const set = owners.get(text);
        if (set && set.size > 1) {
          const others = [...set].filter((n) => n !== name);
          if (others.length) commandConflicts.push({ hotkey, count: set.size - 1, other: others[0] });
        }
      }
      if (commandConflicts.length) conflicts++;
      shown++;

      const setting = new host.Setting(listEl);
      setting.setName(name);
      const box = setting.controlEl.createDiv("setting-command-hotkeys");
      const customizing = this.commandBeingCustomized === command.id;

      if (customizing) {
        box.createSpan("setting-hotkey mod-active", (el) => {
          el.setText(NG23HK_T(host, "labelWaitingForHotkeyPress", "Press a key combination..."));
        });
      }
      if (effective.length === 0 && !customizing) {
        box.createSpan("setting-hotkey mod-empty", (el) => {
          el.setText(NG23HK_T(host, "labelBlankHotkey", "Empty"));
        });
      }
      for (const hotkey of effective) {
        const formatted = ng23FormatHotkey(host, hotkey);
        const conflict = commandConflicts.find((c) => ng23FormatHotkey(host, c.hotkey) === formatted);
        const span = box.createSpan("setting-hotkey", (el) => {
          el.setText(" " + formatted + " ");
          if (conflict) {
            el.addClass("has-conflict");
            const tip = conflict.count === 1
              ? NG23HK_T(host, "tooltipHotkeySingleConflict", "Clashes with “{{command}}”", { command: conflict.other })
              : NG23HK_T(host, "tooltipHotkeyMultipleConflicts", "Also bound to {{count}} other commands", { count: conflict.count });
            host.setTooltip(el, tip);
            el.addEventListener("click", () => {
              this.query = "";
              if (this._searchInput) { try { this._searchInput.setValue(""); } catch (err) {} }
              this.setHotkeyFilter(hotkey);
            });
          }
        });
        const del = box.createDiv("setting-hotkey-icon setting-delete-hotkey clickable-icon", (el) => {
          host.setIcon(el, "lucide-x");
          host.setTooltip(el, NG23HK_T(host, "tooltipDeleteHotkey", "Remove hotkey"));
          el.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._removeHotkey(command, hotkey);
          });
        });
      }

      // restore-defaults button (only with custom hotkeys)
      if (custom !== undefined) {
        box.createDiv("clickable-icon setting-restore-hotkey-button", (el) => {
          host.setIcon(el, "lucide-rotate-ccw");
          host.setTooltip(el, NG23HK_T(host, "tooltipRestoreDefault", "Back to default"));
          el.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            this._restoreHotkeys(command);
          });
        });
      }
      // add/customize button
      const addCls = customizing ? "clickable-icon setting-add-hotkey-button mod-active" : "clickable-icon setting-add-hotkey-button";
      box.createDiv(addCls, (el) => {
        host.setIcon(el, "lucide-plus-circle");
        host.setTooltip(el, NG23HK_T(host, "tooltipCustomizeCommand", "Edit this command"));
        el.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this._startCustomizing(command);
        });
      });
    }

    this.setDescription(shown, conflicts);
  };

  return HotkeysTab;
}
