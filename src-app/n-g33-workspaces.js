// g33 clean-room: "workspaces" core plugin — save/restore whole window layouts.
// Replaces orig Iee (class).

function ng33wMoment() {
  return (typeof window !== "undefined" && window.moment) || globalThis.moment;
}

const NG33W_HAS = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export function defineWorkspacesPlugin(host) {
  function WorkspacesPlugin() {
    this.id = "workspaces";
    this.name = host.i18n.plugins.workspaces.name();
    this.description = host.i18n.plugins.workspaces.desc();
    this.workspaces = {};
    this.activeWorkspace = "";
    this.app = null;
    this.plugin = null;
  }

  WorkspacesPlugin.prototype.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    const t = host.i18n.plugins.workspaces;
    const self = this;
    plugin.registerGlobalCommand({ id: "workspaces:load", name: t.actionLoadLayout(), icon: "lucide-layout", callback: () => self.onLoad() });
    plugin.registerGlobalCommand({ id: "workspaces:save", name: t.actionSave(), icon: "lucide-save", callback: () => self.onSave() });
    plugin.registerGlobalCommand({ id: "workspaces:save-and-load", name: t.actionSaveAndLoadLayout(), icon: "lucide-layout", callback: () => self.onSaveAndLoad() });
    plugin.registerGlobalCommand({ id: "workspaces:open-modal", name: t.actionManageLayouts(), icon: "lucide-layout", callback: () => self.onOpenModal() });
    plugin.registerRibbonItem(t.actionManageLayouts(), "lucide-layout", () => self.onOpenModal());
  };

  WorkspacesPlugin.prototype.onEnable = async function (app, plugin) {
    const data = (await plugin.loadData()) || {};
    this.workspaces = data.workspaces || {};
    this.activeWorkspace = data.active || "";
    const self = this;

    plugin.registerCliHandler("workspaces", "List saved workspaces", {
      total: { description: "Return workspace count" },
    }, async (args) => {
      const names = Object.keys(self.workspaces);
      if (args && args.total) return String(names.length);
      if (!names.length) return "No workspaces saved.";
      return names.map((n) => n + (n === self.activeWorkspace ? " (active)" : "")).join("\n");
    });

    plugin.registerCliHandler("workspace:save", "Save current layout as workspace", {
      name: { value: "<name>", description: "Workspace name" },
    }, async (args) => {
      const name = args && args.name;
      if (name) {
        self.saveWorkspace(name);
        self.setActiveWorkspace(name);
        return `Saved workspace: ${name}`;
      }
      if (self.activeWorkspace) {
        self.saveWorkspace(self.activeWorkspace);
        self.setActiveWorkspace(self.activeWorkspace);
        return `Saved workspace: ${self.activeWorkspace}`;
      }
      return "Missing required parameter: name\nUsage: workspace:save name=<name>";
    });

    plugin.registerCliHandler("workspace:load", "Load a saved workspace", {
      name: { value: "<name>", description: "Workspace name", required: true },
    }, async (args) => {
      const name = args && args.name;
      if (!name) throw new Error("Missing required parameter: name\nUsage: workspace:load name=<name>");
      if (!NG33W_HAS(self.workspaces, name)) throw new Error(`Workspace "${name}" not found.`);
      await self.loadWorkspace(name);
      return `Loaded workspace: ${name}`;
    });

    plugin.registerCliHandler("workspace:delete", "Delete a saved workspace", {
      name: { value: "<name>", description: "Workspace name", required: true },
    }, async (args) => {
      const name = args && args.name;
      if (!name) throw new Error("Missing required parameter: name\nUsage: workspace:delete name=<name>");
      if (!NG33W_HAS(self.workspaces, name)) throw new Error(`Workspace "${name}" not found.`);
      await self.deleteWorkspace(name);
      return `Deleted workspace: ${name}`;
    });
  };

  WorkspacesPlugin.prototype.onDisable = async function () {
    await this.saveData();
  };

  WorkspacesPlugin.prototype.onOpenModal = function () {
    new (host.s16ManageWorkspacesModal)(this.app, this).open();
  };

  WorkspacesPlugin.prototype.onLoad = function () {
    new (host.s16WorkspaceSuggestModal)(this.app, this, false).open();
    return false;
  };

  WorkspacesPlugin.prototype.onSave = function () {
    if (this.activeWorkspace && NG33W_HAS(this.workspaces, this.activeWorkspace)) {
      this.saveWorkspace(this.activeWorkspace);
      new host.Notice(host.i18n.plugins.workspaces.msgSaveLayoutSuccess({ name: this.activeWorkspace }));
    } else {
      this.onOpenModal();
    }
  };

  WorkspacesPlugin.prototype.onSaveAndLoad = function () {
    new (host.s16WorkspaceSuggestModal)(this.app, this, true).open();
    return false;
  };

  WorkspacesPlugin.prototype.saveWorkspace = function (name) {
    const layout = this.app.workspace.getLayout();
    layout.mtime = ng33wMoment()().format();
    this.workspaces[name] = layout;
    this.saveData();
  };

  WorkspacesPlugin.prototype.setActiveWorkspace = function (name) {
    this.activeWorkspace = name;
    this.saveData();
  };

  WorkspacesPlugin.prototype.loadWorkspace = async function (name) {
    if (!NG33W_HAS(this.workspaces, name)) return;
    this.activeWorkspace = name;
    await this.app.workspace.changeLayout(this.workspaces[name]);
    await this.saveData();
  };

  WorkspacesPlugin.prototype.deleteWorkspace = async function (name) {
    delete this.workspaces[name];
    await this.saveData();
  };

  WorkspacesPlugin.prototype.saveData = async function () {
    await this.plugin.saveData({ workspaces: this.workspaces, active: this.activeWorkspace });
  };

  return WorkspacesPlugin;
}
