// g26 clean-room: the "canvas" core plugin object (spec g26 Part D).
// Registers the .canvas view type, its commands/ribbon/file-menu entry, keeps
// the metadata index + localStorage data cache and forwards renames to the
// batch repair queue (n-g26-canvas-renames.js).

import { debounceCall } from "./timing.js";
import { parentPath } from "./path.js";
import { boxOfRect } from "./misc.js";
import { canvas } from "./n-g20-shared.js";
import { fileClass } from "./n-g13-vault.js";
import { ng26ProcessCanvasRenames } from "./n-g26-canvas-renames.js";

function ng26Strings(host) {
  return host.canvasI18n;
}

function ng26T(host) {
  return host.t;
}

export function ng26DefineCanvasPlugin(host) {
  const TFolder = () => fileClass("TFolder");
  const TFile = () => host.TFile;

  class CanvasPlugin {
    constructor() {
      const strings = ng26Strings(host);
      this.id = "canvas";
      this.name = typeof strings.name === "function" ? strings.name() : strings.name;
      this.description = typeof strings.desc === "function" ? strings.desc() : strings.desc;
      this.defaultOn = true;
      this.options = {};
      this.renames = [];
      this.index = null;
      this.localDataManager = null;
      this.app = null;
      this.plugin = null;
      this.renameQueue = null;
      this.requestProcessRename = debounceCall(() => {
        const run = () => ng26ProcessCanvasRenames(this, host);
        if (this.renameQueue) this.renameQueue.queue(run);
        else run();
      }, 500, true);
    }

    init(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      const t = ng26Strings(host);
      plugin.registerViewType(host.CanvasViewType, (leaf) => new (host.CanvasViewClass)(leaf, this));

      plugin.registerGlobalCommand({
        id: "canvas:new-file",
        name: t.commandCreateNewCanvas(),
        icon: "lucide-layout-dashboard",
        callback: async () => {
          const parent = this.getNewFileParent(this.app.workspace.getActiveFile() && this.app.workspace.getActiveFile().path);
          const file = await this.createNewCanvasFile(parent);
          await this.app.workspace.getLeaf().openFile(file, { eState: { rename: "all" } });
        },
      });

      if (host.Platform.isDesktopApp) {
        plugin.registerGlobalCommand({
          id: "canvas:export-as-image",
          name: t.actionExportPng(),
          icon: "lucide-image",
          checkCallback: (checking) => {
            const view = this.app.workspace.getActiveViewOfType(host.CanvasViewClass);
            const ok = !!view;
            if (!checking && ok) view.canvas.generateHDImage();
            return ok;
          },
        });
      }

      plugin.registerGlobalCommand({
        id: "canvas:jump-to-group",
        name: t.actionJumpToGroup(),
        icon: "lucide-move",
        checkCallback: (checking) => {
          const view = this.app.workspace.getActiveViewOfType(host.CanvasViewClass);
          const ok = !!view;
          if (!checking && ok) {
            new (host.JumpToGroupModal)(view, (item) => view.canvas.zoomToBbox(boxOfRect(item)));
          }
          return ok;
        },
      });

      plugin.registerGlobalCommand({
        id: "canvas:convert-to-file",
        name: t.commandConvertToFile(),
        icon: "lucide-file-input",
        checkCallback: (checking) => {
          const view = this.app.workspace.getActiveViewOfType(host.CanvasViewClass);
          const sel = view && view.canvas && view.canvas.selection;
          let node = null;
          if (sel && sel.size === 1) node = sel.values().next().value;
          const ok = !!(node && node.type === "group" && typeof node.convertToFile === "function");
          if (!checking && ok) node.convertToFile();
          return ok;
        },
      });

      plugin.registerRibbonItem(t.commandCreateNewCanvas(), "lucide-layout-dashboard", (evt) => {
        const parent = this.getNewFileParent(this.app.workspace.getActiveFile() && this.app.workspace.getActiveFile().path);
        this.createNewCanvasFile(parent).then((file) => {
          this.app.workspace.getLeaf(host.Keymap.isModEvent(evt)).openFile(file, { active: true, eState: { rename: "all" } });
        });
      });

      this.index = plugin.addChild(new canvas.MetadataExtractor(app));
      this.localDataManager = new canvas.DataCache(app);
      this.renameQueue = new host.RenameQueue();
    }

    async onEnable(app, plugin) {
      plugin.registerEvent(app.workspace.on("file-menu", (menu, file, source, evt) => this.onFileMenu(menu, file, source, evt)));
      plugin.registerEvent(app.vault.on("rename", (file, oldPath) => this.onRename(file, oldPath)));
      plugin.registerEvent(app.vault.on("delete", (file) => this.onDelete(file)));
      app.metadataCache.linkUpdaters["canvas"] = new canvas.LinkUpdater(app, this);
      plugin.register(() => { delete app.metadataCache.linkUpdaters["canvas"]; });
      app.viewRegistry.registerExtensions(["canvas"], "canvas");
      app.embedRegistry.registerExtension("canvas", (m, el, ctx) => new (host.CanvasEmbedRenderer)(m, el, ctx));
      app.fileManager.registerFileParentCreator("canvas", (sourcePath) => this.getNewFileParent(sourcePath));
      const saved = await plugin.loadData();
      this.options = Object.assign({ snapToObjects: true, snapToGrid: true }, saved || {});
      plugin.addSettingTab(new (host.CanvasSettingsTab)(app, plugin, this));
    }

    onDisable(app) {
      app.viewRegistry.unregisterExtensions(["canvas"]);
      app.embedRegistry.unregisterExtension("canvas");
      app.fileManager.unregisterFileCreator("canvas");
    }

    onUserDisable(app) {
      app.workspace.detachLeavesOfType("canvas");
    }

    async onExternalSettingsChange() {
      this.options = (await this.plugin.loadData()) || {};
      this.rerenderCanvases();
    }

    getNewFileParent(sourcePath) {
      const vault = this.app.vault;
      const opts = this.options || {};
      if (opts.newFileLocation === "folder" && opts.newFileFolderPath != null) {
        const folder = vault.getAbstractFileByPath(opts.newFileFolderPath);
        if (folder instanceof TFolder()) return folder;
        return vault.getRoot();
      }
      if (opts.newFileLocation === "current" && sourcePath) {
        const folder = vault.getAbstractFileByPath(parentPath(sourcePath));
        if (folder instanceof TFolder()) return folder;
        return vault.getRoot();
      }
      return vault.getRoot();
    }

    createNewCanvasFile(folder, name, contents) {
      return this.app.fileManager.createNewFile(folder, name, "board", "{}");
    }

    saveOptions() { return this.plugin.saveData(this.options); }

    rerenderCanvases() {
      for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
        const view = leaf.view;
        if (view instanceof host.CanvasViewClass && view.canvas && view.canvas.rerenderViewport) {
          view.canvas.rerenderViewport();
        }
      }
    }

    onDelete(file) {
      if (file instanceof TFile() && file.extension === "canvas") this.localDataManager.handleDelete(file);
    }

    onRename(file, oldPath) {
      if (!(file instanceof TFile())) return;
      if (file.extension === "canvas") {
        this.localDataManager.handleRename(oldPath, file);
      }
      this.renames.push([oldPath, file.path]);
      this.requestProcessRename();
    }

    onFileMenu(menu, file, source) {
      if (source !== "file-explorer-context-menu" || !(file instanceof TFolder())) return;
      const t = ng26T(host);
      menu.addItem((item) => {
        item.setSection("action-primary")
          .setIcon("lucide-layout-dashboard")
          .setTitle(t.plugins.canvas.actionNewCanvas())
          .onClick((evt) => {
            this.createNewCanvasFile(file).then((created) => {
              this.app.workspace.getLeaf(host.Keymap.isModEvent(evt)).openFile(created, { eState: { rename: "all" } });
            });
          });
      });
    }
  }
  return CanvasPlugin;
}
