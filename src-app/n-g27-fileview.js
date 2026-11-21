// g27 fileview: FileView (orig MD) — an ItemView bound to one vault file.
// Owns the file binding, header breadcrumbs, rename/delete reaction, view-state
// persistence (state.file) and linked-tab sync inside a tab group.
import { inherit, methods } from "./n-g27-inherit.js";

export function defineFileView(host) {
  function FileView(leaf) {
    const self = host.ItemView.call(this, leaf) || this;
    self.allowNoFile = false;
    self.navigation = true;
    self.file = null;
    return self;
  }
  inherit(FileView, host.ItemView);

  methods(FileView, {

    getDisplayText() {
      return this.file ? this.file.basename : host.t.interface.noFile();
    },

    // ------------------------------------------------------------ breadcrumbs

    renderBreadcrumbs() {
      const parentEl = this.titleParentEl;
      parentEl.empty();
      const file = this.file;
      const folder = file && file.parent;
      if (!folder || folder.path === "/") return;
      const app = this.app;
      const vault = app.vault;
      const segments = folder.path.split("/").filter((s) => s.length > 0);
      let prefix = "";
      for (const segment of segments) {
        prefix = prefix ? prefix + "/" + segment : segment;
        const crumb = parentEl.createEl("span", { cls: "view-header-breadcrumb" });
        crumb.setText(segment);
        const dir = vault.getAbstractFileByPath(prefix);
        if (!host.Platform.isMobile) host.setTooltip(crumb, segment);
        crumb.addEventListener("click", () => {
          const explorer = app.internalPlugins.getEnabledPluginById("file-explorer");
          if (explorer && explorer.revealInFolder && dir) explorer.revealInFolder(dir);
        });
        crumb.addEventListener("contextmenu", (event) => {
          if (!dir) return;
          const menu = host.Menu.forEvent(event);
          menu.addSections(["title", "open", "action-primary", "action", "info", "info.copy", "view", "system", "", "danger"]);
          menu.addItem((item) => item
            .setSection("action-primary")
            .setTitle(host.t.plugins.fileExplorer.menuOptNewNote())
            .setIcon("lucide-edit")
            .onClick(async (clickEvent) => {
              const created = await app.fileManager.createNewMarkdownFile(dir, null);
              if (!created) return;
              const leaf = app.workspace.getLeaf(host.Keymap.isModEvent(clickEvent));
              await leaf.openFile(created, { active: true, state: { mode: "source" }, eState: { rename: "all" } });
            }));
          menu.setParentElement(crumb);
          app.workspace.trigger("file-menu", menu, dir, "file-explorer-context-menu");
        });
        app.dragManager.handleDrag(crumb, (evt) => {
          const target = vault.getAbstractFileByPath(prefix);
          if (!(target instanceof host.TFolder)) return null;
          app.dragManager.updateSource([crumb], "is-being-dragged");
          return app.dragManager.dragFolder(evt, target, "file-explorer");
        });
        parentEl.createEl("span", { cls: "view-header-breadcrumb-separator", text: "/" });
      }
    },

    // ------------------------------------------------------------ lifecycle

    onload() {
      host.ItemView.prototype.onload.call(this);
      this.registerEvent(this.app.vault.on("rename", this.onRename, this));
      this.registerEvent(this.app.vault.on("delete", this.onDelete, this));
    },

    getState() {
      const state = host.ItemView.prototype.getState.call(this);
      if (this.file) state.file = this.file.path;
      return state;
    },

    setState(state, result) {
      return (async () => {
        state = state || {};
        let changed = false;
        if (Object.prototype.hasOwnProperty.call(state, "file")) {
          const resolved = this.app.vault.getAbstractFileByPath(state.file);
          if (resolved instanceof host.TFile) changed = await this.loadFile(resolved);
          else changed = await this.loadFile(null);
        }
        if (!this.file && !this.allowNoFile) result.close = true;
        if (changed) {
          result.layout = true;
          result.history = true;
        }
        await host.ItemView.prototype.setState.call(this, state, result);
        if (!state.sync && (result.layout || result.history)) {
          result.done = () => this.syncState();
        }
      })();
    },

    onClose() {
      return (async () => {
        this.contentEl.empty();
        await this.loadFile(null);
      })();
    },

    /** false when `file` is already bound; true after any (re)bind attempt. */
    async loadFile(file) {
      if (file === this.file) return false;
      const previous = this.file;
      if (previous) await this.onUnloadFile(previous);
      this.file = null;
      if (file) {
        try {
          this.file = file;
          await this.onLoadFile(file);
        } catch (err) {
          this.file = null;
          new host.Notice(host.t.interface.msgFailedToLoadFile({ plugin: file.path }));
          console.error(err);
        }
      }
      this.renderBreadcrumbs();
      this.titleEl.setText(this.getDisplayText());
      if (this.leaf.isActiveLeaf()) this.app.workspace.requestActiveLeafEvents();
      this.leaf.updateHeader();
      return true;
    },

    async onLoadFile(file) {},
    async onUnloadFile(file) {},

    // ------------------------------------------------------------ vault events

    async onRename(file) {
      if (file !== this.file) return;
      this.renderBreadcrumbs();
      this.titleEl.setText(file.basename);
      this.app.workspace.onLayoutChange();
      this.leaf.updateHeader();
    },

    async onDelete(file) {
      if (file !== this.file) return;
      const leaf = this.leaf;
      if (this.allowNoFile) {
        await this.loadFile(null);
      } else if (leaf.history.backHistory.length > 0) {
        await leaf.history.back();
      } else {
        await leaf.open(null);
      }
      if (this.leaf.view instanceof host.EmptyView && leaf.parent && leaf.parent.children.length > 1) {
        leaf.detach();
      }
      this.app.workspace.onLayoutChange();
    },

    // ------------------------------------------------------------ linked tabs

    syncState() {
      const group = this.leaf.group;
      if (!group) return;
      for (const leaf of this.app.workspace.getGroupLeaves(group)) {
        if (leaf === this.leaf) continue;
        const view = leaf.view;
        if (view instanceof FileView) view.receiveSyncState(this);
      }
    },

    receiveSyncState(source) {
      if (source.file !== this.file) this.leaf.openFile(source.file);
    },

    canAcceptExtension() {
      return false;
    },
  });

  return FileView;
}
