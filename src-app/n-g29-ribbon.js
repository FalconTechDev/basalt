// g29 clean-room: workspace side ribbon (spec Part B). Core features and
// plugins contribute icon buttons; the user reorders by dragging and hides
// via a right-click checklist. Order/visibility persist in the left ribbon
// slot of the workspace layout.

export function defineWorkspaceRibbon(host) {
  class WorkspaceRibbon {
    constructor(workspace, side) {
      this.workspace = workspace;
      this.side = side;
      this.items = [];
      this.containerEl = createDiv("workspace-ribbon side-dock-ribbon mod-" + side);
      this.ribbonItemsEl = null;
      this.ribbonSettingEl = null;
      if (side === "left") {
        this.ribbonItemsEl = this.containerEl.createDiv("side-dock-actions");
        this.ribbonSettingEl = this.containerEl.createDiv("side-dock-settings");
        if (!host.Platform.isMobile) host.scrollWithPointer(this.containerEl);
      }
      this.containerEl.addEventListener("contextmenu", (event) => this.onContextMenu(event));
    }

    makeRibbonItemButton(icon, title, callback) {
      const button = createDiv("clickable-icon side-dock-ribbon-action");
      button.onClickEvent(callback);
      host.setTooltip(button, title, { delay: host.TOOLTIP_DELAY, placement: "right" });
      host.setIcon(button, icon);
      return button;
    }

    addRibbonItemButton(id, icon, title, callback) {
      const existing = this.items.find((item) => item.id === id);
      if (existing) {
        existing.title = title;
        existing.icon = icon;
        existing.callback = callback;
        existing.buttonEl = this.makeRibbonItemButton(icon, title, callback);
        this.installDrag(existing.buttonEl, existing);
        this.onChange(false);
        return existing.buttonEl;
      }
      const item = { id, icon, title, callback, hidden: false };
      item.buttonEl = this.makeRibbonItemButton(icon, title, callback);
      this.items.push(item);
      this.installDrag(item.buttonEl, item);
      this.onChange(false);
      return item.buttonEl;
    }

    installDrag(button, item) {
      if (!this.ribbonItemsEl) return;
      host.makeDragReorderable(button, button, this.ribbonItemsEl, 5, () => false, (to) => {
        const movable = this.items.filter((entry) => entry.buttonEl);
        const from = movable.indexOf(item);
        if (from < 0) return;
        movable.splice(from, 1);
        movable.splice(Math.max(0, Math.min(to, movable.length)), 0, item);
        let i = 0;
        this.items = this.items.map((entry) => (entry.buttonEl ? movable[i++] : entry));
        this.onChange(true);
      });
    }

    removeRibbonAction(id) {
      const item = this.items.find((entry) => entry.id === id);
      if (!item) return;
      delete item.buttonEl;
      delete item.callback;
    }

    onChange(save) {
      const shown = [];
      for (const item of this.items) {
        if (!item.buttonEl) continue;
        item.buttonEl.toggle(!item.hidden);
        shown.push(item.buttonEl);
      }
      if (this.ribbonItemsEl) this.ribbonItemsEl.setChildrenInPlace(shown);
      if (save) this.workspace.requestSaveLayout();
    }

    serialize() {
      const hiddenItems = {};
      for (const item of this.items) hiddenItems[item.id] = !!item.hidden;
      return { hiddenItems };
    }

    load(data) {
      if (data && Object.prototype.hasOwnProperty.call(data, "hiddenItems")) {
        const saved = data.hiddenItems;
        const order = Object.keys(saved);
        for (const item of this.items) item.hidden = saved[item.id] === undefined ? false : !!saved[item.id];
        this.items.sort((a, b) => {
          const ia = order.indexOf(a.id);
          const ib = order.indexOf(b.id);
          return (ia < 0 ? -1 : ia) - (ib < 0 ? -1 : ib);
        });
      }
      this.onChange(false);
    }

    setCollapsedState(collapsed) {
      this.containerEl.toggleClass("is-collapsed", collapsed);
    }

    hide() { this.containerEl.addClass("is-hidden"); }
    show() { this.containerEl.removeClass("is-hidden"); }

    onContextMenu(event) {
      if (event.target !== this.containerEl) return;
      const menu = new host.Menu();
      for (const item of this.items) {
        if (!item.buttonEl) continue;
        menu.addItem((menuItem) => {
          menuItem.setSection("order");
          menuItem.setTitle(item.title);
          menuItem.setIcon(item.icon);
          menuItem.setChecked(!item.hidden);
          menuItem.onClick(() => {
            item.hidden = !item.hidden;
            this.onChange(true);
          });
        });
      }
      menu.addItem((menuItem) => {
        menuItem.setSection("ribbon");
        menuItem.setTitle(host.t.interface.optionHideRibbon());
        menuItem.setIcon("lucide-panel-left-close");
        menuItem.onClick(() => {
          this.workspace.app.vault.setConfig("showRibbon", false);
        });
      });
      menu.showAtMouseEvent(event);
    }
  }
  return WorkspaceRibbon;
}
