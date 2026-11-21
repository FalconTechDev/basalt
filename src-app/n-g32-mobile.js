// g32 clean-room: mobile toolbar settings tab + pull-down quick-action picker.
import { inherit } from "./inherit.js";

function ng32ListContains(list, id) {
  return typeof list.contains === "function" ? list.contains(id) : list.includes(id);
}
function ng32ListRemove(list, id) {
  if (typeof list.remove === "function") list.remove(id);
  else {
    const at = list.indexOf(id);
    if (at >= 0) list.splice(at, 1);
  }
}

export function ng32DefineQuickActionSuggest(host) {
  function Ng32QuickActionSuggest(app, callback) {
    const self = host.FuzzySuggestModal.call(this, app) || this;
    self.emptyStateText = host.i18n.plugins.commandPalette.labelNoCommands();
    self.callback = callback;
    self.setPlaceholder(host.i18n.setting.mobileToolbar.placeholderSelectQuickAction());
    return self;
  }
  inherit(Ng32QuickActionSuggest, host.FuzzySuggestModal);
  const proto = Ng32QuickActionSuggest.prototype;

  proto.getItems = function () {
    return [null].concat(Object.values(this.app.commands.commands));
  };

  proto.getItemText = function (item) {
    return item ? item.name : host.i18n.setting.mobileToolbar.quickActionDisabled();
  };

  proto.onChooseItem = function (item) {
    this.app.vault.setConfig("mobilePullAction", item ? item.id : "");
    if (this.callback) this.callback();
  };

  return Ng32QuickActionSuggest;
}

export function ng32DefineMobileToolbarTab(host) {
  const Base = host.SettingTab;
  const toolbarT = () => host.i18n.setting.mobileToolbar;

  function Ng32MobileToolbarTab(app, plugin) {
    const self = Base.call(this, app, plugin) || this;
    self.name = toolbarT().name();
    self.id = "mobile";
    self.icon = "wrench";
    app.commands.addCommand({
      id: "mobile:quick-action",
      name: toolbarT().optionConfigureQuickAction(),
      icon: "lucide-terminal-square",
      checkCallback: (checking) => {
        if (!host.Platform.isMobile) return false;
        if (!checking) new host.s16QuickActionModal(app).open();
        return true;
      },
    });
    return self;
  }
  inherit(Ng32MobileToolbarTab, Base);
  const proto = Ng32MobileToolbarTab.prototype;

  proto.display = function () {
    const self = this;
    const app = this.app;
    this.containerEl.empty();
    const allCommands = app.commands.commands;
    const editorCommands = app.commands.editorCommands;
    const pullAction = app.vault.getConfig("mobilePullAction");
    const pullCommand = app.commands.findCommand(pullAction);
    let toolbarCommands = app.vault.getConfig("mobileToolbarCommands") || [];

    const persist = () => {
      app.vault.setConfig("mobileToolbarCommands", toolbarCommands);
      self.display();
    };

    new host.SettingGroup(this.containerEl).addSetting((setting) => setting
      .setName(toolbarT().optionConfigureQuickAction())
      .setDesc(toolbarT().optionConfigureQuickActionDescription({ command: pullCommand ? pullCommand.name : toolbarT().quickActionDisabled() }))
      .addButton((button) => button
        .setButtonText(toolbarT().buttonConfigure())
        .onClick(() => new host.s16QuickActionModal(app, () => self.display()).open())));

    const enabledGroup = new host.SettingGroup(this.containerEl);
    if (toolbarCommands && toolbarCommands.length) {
      enabledGroup.setHeading(toolbarT().manageToolbarOptions());
      const listEl = enabledGroup.listEl.createDiv();
      toolbarCommands = toolbarCommands.filter((id) => allCommands[id]);
      for (const id of toolbarCommands) {
        const command = allCommands[id];
        listEl.createDiv("mobile-option-setting-item", (row) => {
          row.createSpan("mobile-option-setting-item-remove-icon", (icon) => {
            host.setIcon(icon, "lucide-minus-circle");
            icon.addEventListener("click", () => {
              if (ng32ListContains(toolbarCommands, id)) {
                ng32ListRemove(toolbarCommands, id);
                persist();
              }
            });
          });
          row.createSpan("mobile-option-setting-item-option-icon", (icon) => host.setIcon(icon, command.icon || "question-mark-glyph"));
          row.createSpan({ cls: "mobile-option-setting-item-name", text: command.name });
          row.createDiv("clickable-icon mobile-option-setting-item-option-icon mobile-option-setting-drag-icon", (handle) => {
            host.setIcon(handle, "lucide-menu");
            host.setTooltip(handle, host.i18n.interface.dragToRearrange());
            host.makeDragReorderable(handle, row, listEl, 5, () => null, (to) => {
              ng32ListRemove(toolbarCommands, id);
              toolbarCommands.splice(to, 0, id);
              persist();
            });
          });
        });
      }
    }

    const addable = Object.keys(editorCommands).filter((id) => !ng32ListContains(toolbarCommands, id));
    if (addable.length) {
      const moreGroup = new host.SettingGroup(this.containerEl);
      moreGroup.setHeading(toolbarT().optionMoreToolbarOptions());
      for (const id of addable) {
        const command = allCommands[id];
        moreGroup.listEl.createDiv("mobile-option-setting-item", (row) => {
          row.createSpan("mobile-option-setting-item-add-icon", (icon) => {
            host.setIcon(icon, "lucide-plus-circle");
            icon.addEventListener("click", () => {
              if (!ng32ListContains(toolbarCommands, id)) {
                toolbarCommands.push(id);
                persist();
              }
            });
          });
          row.createSpan("mobile-option-setting-item-option-icon", (icon) => host.setIcon(icon, command.icon || "question-mark-glyph"));
          row.createSpan({ text: command.name });
        });
      }
    }

    const searchable = Object.keys(allCommands)
      .filter((id) => !editorCommands[id] && !ng32ListContains(toolbarCommands, id))
      .map((id) => allCommands[id]);
    enabledGroup.addSearch((search) => search
      .setPlaceholder(host.i18n.plugins.commandPalette.promptTypeCommand())
      .then(() => new host.s16CommandSuggest(app, search.inputEl, searchable, (command) => {
        const id = command.id;
        if (!ng32ListContains(toolbarCommands, id)) {
          toolbarCommands.push(id);
          persist();
        }
      })));
  };

  return Ng32MobileToolbarTab;
}
