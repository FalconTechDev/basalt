// g33 clean-room: workspaces UI — the manage modal (name input + layout list)
// and the fuzzy suggest picker used for load / save-and-load.
// Replaces orig Oee and Fee (classes).
import { inherit } from "./inherit.js";
import { renderMatches } from "./search-simple.js";

const NG33M_HAS = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function ng33mMoment() {
  return (typeof window !== "undefined" && window.moment) || globalThis.moment;
}

export function defineManageWorkspacesModal(host) {
  function ManageWorkspacesModal(app, plugin) {
    const self = host.Modal.call(this, app) || this;
    self.app = app;
    self.plugin = plugin;
    self.setTitle(host.i18n.plugins.workspaces.actionManageLayouts());

    const t = host.i18n.plugins.workspaces;
    const inputRow = self.contentEl.createDiv("list-item");
    self.nameEl = inputRow.createEl("input", { cls: "list-item-part mod-extended" });
    self.nameEl.type = "text";
    self.nameEl.placeholder = t.placeholderSaveCurrentLayoutAs();
    const saveBtn = inputRow.createEl("button", { cls: "list-item-part", text: t.buttonSave() });
    saveBtn.addEventListener("mousedown", (e) => e.preventDefault());
    saveBtn.addEventListener("click", () => self.onFinish());
    self.nameEl.addEventListener("keypress", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter") self.onFinish();
    });

    self.listContainerEl = self.contentEl.createDiv("list-container mod-manage-workspaces");
    self.renderList();
    return self;
  }
  inherit(ManageWorkspacesModal, host.Modal);

  ManageWorkspacesModal.prototype.onOpen = function () {
    host.Modal.prototype.onOpen.call(this);
    this.nameEl.focus();
  };

  ManageWorkspacesModal.prototype.renderList = function () {
    const t = host.i18n.plugins.workspaces;
    const ws = this.plugin.workspaces || {};
    this.listContainerEl.empty();
    for (const name in ws) {
      if (!NG33M_HAS(ws, name)) continue;
      const layout = ws[name];
      const row = this.listContainerEl.createDiv("list-item");
      const info = row.createDiv("list-item-part mod-extended");
      info.createSpan().setText(name);
      if (name === this.plugin.activeWorkspace) {
        info.createSpan("flair mod-pop").setText(host.i18n.setting.appearance.labelCurrentlyActive());
      }
      const desc = row.createDiv("list-item-desc");
      if (layout && layout.mtime) {
        desc.createDiv("list-item-part").setText(
          t.labelWorkspaceModifiedTime({ time: ng33mMoment()(layout.mtime).fromNow() })
        );
      }
      const actions = row.createDiv("list-item-actions");
      const loadBtn = actions.createEl("button", { cls: "list-item-part", text: t.buttonLoad() });
      loadBtn.addEventListener("click", () => {
        const p = this.plugin.loadWorkspace(name);
        if (p && p.catch) p.catch(() => {});
        this.close();
      });
      const del = actions.createDiv("list-item-part clickable-icon");
      host.setIcon(del, "lucide-x");
      host.setTooltip(del, t.tooltipDeleteLayout());
      del.addEventListener("mousedown", (e) => e.preventDefault());
      del.addEventListener("click", async () => {
        await this.plugin.deleteWorkspace(name);
        this.renderList();
      });
    }
  };

  ManageWorkspacesModal.prototype.onFinish = function () {
    const t = host.i18n.plugins.workspaces;
    const name = this.nameEl.value.trim();
    if (!name) {
      new host.Notice(t.msgEnterName());
      return;
    }
    this.plugin.saveWorkspace(name);
    this.plugin.setActiveWorkspace(name);
    new host.Notice(t.msgSaveLayoutSuccess({ name }));
    this.nameEl.value = "";
    this.renderList();
  };

  return ManageWorkspacesModal;
}

export function defineWorkspaceSuggestModal(host) {
  function WorkspaceSuggestModal(app, plugin, shouldSave) {
    const self = host.FuzzySuggestModal.call(this, app) || this;
    self.plugin = plugin;
    self.shouldSave = !!shouldSave;
    const t = host.i18n.plugins.workspaces;
    self.emptyStateText = t.labelNoLayoutFound();
    self.setPlaceholder(t.placeholderTypeToSearchLayouts());
    self.setInstructions([
      { command: "↑↓", purpose: host.i18n.plugins.commandPalette.instructionNavigate() },
      { command: "↵", purpose: host.i18n.plugins.commandPalette.instructionUse() },
      { command: "esc", purpose: host.i18n.plugins.commandPalette.instructionDismiss() },
    ]);
    return self;
  }
  inherit(WorkspaceSuggestModal, host.FuzzySuggestModal);

  WorkspaceSuggestModal.prototype.getItems = function () {
    return Object.keys(this.plugin.workspaces || {});
  };

  WorkspaceSuggestModal.prototype.getEmptySearchItems = function () {
    return this.getItems();
  };

  WorkspaceSuggestModal.prototype.getItemText = function (item) {
    return item;
  };

  WorkspaceSuggestModal.prototype.renderSuggestion = function (result, el) {
    const name = result.item;
    renderMatches(el, name, result.match ? result.match.matches : null);
    if (name === this.plugin.activeWorkspace) {
      el.createSpan("flair mod-pop").setText(host.i18n.setting.appearance.labelCurrentlyActive());
    }
  };

  WorkspaceSuggestModal.prototype.onChooseItem = function (name) {
    const ws = this.plugin.workspaces || {};
    if (this.shouldSave && this.plugin.activeWorkspace && NG33M_HAS(ws, this.plugin.activeWorkspace)) {
      this.plugin.saveWorkspace(this.plugin.activeWorkspace);
    }
    return this.plugin.loadWorkspace(name);
  };

  return WorkspaceSuggestModal;
}
