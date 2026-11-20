// g33 clean-room: ribbon configuration modal — pick which commands sit in the
// left ribbon, their order, and (on phones) the quick-ribbon tap target.
// Replaces orig ete (class).
import { inherit } from "./inherit.js";

function ng33rItemRow(host, self, item, hidden) {
  const row = document.createElement("div");
  row.className = "mobile-option-setting-item";
  if (hidden) {
    const add = row.createDiv("mobile-option-setting-item-add-icon");
    host.setIcon(add, "lucide-plus-circle");
    add.addEventListener("click", () => {
      item.hidden = false;
      self.ribbons.onChange(true);
      self.render();
    });
  } else {
    const remove = row.createDiv("mobile-option-setting-item-remove-icon");
    host.setIcon(remove, "lucide-minus-circle");
    remove.addEventListener("click", () => {
      item.hidden = true;
      self.ribbons.onChange(true);
      self.render();
    });
    const drag = row.createDiv("mobile-option-setting-item-option-icon mobile-option-setting-drag-icon clickable-icon");
    host.setIcon(drag, "lucide-menu");
    host.setTooltip(drag, host.i18n.interface.dragToRearrange());
    host.makeDragReorderable(drag, row, self.listEl, 5, () => null, (to) => {
      const items = self.ribbons.items;
      const from = items.indexOf(item);
      if (from < 0) return;
      items.splice(from, 1);
      items.splice(to, 0, item);
      self.ribbons.onChange(true);
    });
  }
  const icon = row.createDiv("mobile-option-setting-item-option-icon");
  host.setIcon(icon, item.icon);
  row.createDiv("mobile-option-setting-item-name").setText(item.title);
  return row;
}

export function defineRibbonConfigModal(host) {
  function RibbonConfigModal(app) {
    const self = host.Modal.call(this, app) || this;
    self.app = app;
    self.modalEl.addClass("mod-lg");
    self.setTitle(host.i18n.setting.appearance.labelModalConfiguration());
    self.listEl = null;
    return self;
  }
  inherit(RibbonConfigModal, host.Modal);

  RibbonConfigModal.prototype.onOpen = function () {
    host.Modal.prototype.onOpen.call(this);
    this.render();
  };

  RibbonConfigModal.prototype.render = function () {
    const content = this.contentEl;
    content.empty();
    this.ribbons = this.app.workspace.leftRibbon;
    const items = this.ribbons.items || [];

    if (host.Platform.isPhone) {
      let quickIconEl = null;
      new host.Setting(content)
        .setName(host.i18n.setting.appearance.optionMobileQuickRibbonItem())
        .setDesc(host.i18n.setting.appearance.optionMobileQuickRibbonItemDesc())
        .addExtraButton((btn) => {
          quickIconEl = btn.extraSettingsEl;
          host.setIcon(quickIconEl, "lucide-menu");
        })
        .addDropdown((dd) => {
          dd.addOption("", host.i18n.setting.appearance.optionMobileQuickRibbonDefault());
          for (const item of items) dd.addOption(item.id, item.title);
          const current = this.app.vault.getConfig("mobileQuickRibbonItem");
          const match = items.find((it) => it.id === current);
          dd.setValue(match ? current : "");
          if (match && quickIconEl) host.setIcon(quickIconEl, match.icon);
          dd.onChange((value) => {
            this.app.vault.setConfig("mobileQuickRibbonItem", value);
            this.render();
          });
        });
      content.createEl("hr");
    }

    content.createEl("p").setText(host.i18n.setting.appearance.labelModalConfigurationDesc());

    this.listEl = content.createDiv();
    for (const item of items) {
      const row = ng33rItemRow(host, this, item, !!item.hidden);
      this.listEl.appendChild(row);
      if (item.hidden) row.hide();
    }

    if (items.some((it) => it.hidden)) {
      const group = new host.SettingGroup(content);
      group.setHeading(host.i18n.setting.appearance.labelAdditionalRibbonItems());
      for (const item of items) {
        if (item.hidden) group.listEl.appendChild(ng33rItemRow(host, this, item, true));
      }
    }

    const footer = content.createDiv("modal-button-container");
    const done = footer.createEl("button", { cls: "mod-cta", text: host.i18n.dialogue.buttonDone() });
    done.addEventListener("click", () => this.close());
  };

  return RibbonConfigModal;
}
