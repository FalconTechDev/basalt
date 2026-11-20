// g31 clean-room: footnotes, markdown-importer, editor-status and
// outgoing-link core plugin shells + importer path suggester
// (spec g31 part F).
import { env } from "./env.js";

const ng31I18n = (path) => env().gm.plugins[path];

export function ng31FootnotesPlugin() {
  return class Ng31FootnotesPlugin {
    constructor() {
      const i18n = ng31I18n("footnotesPane");
      this.id = "footnotes";
      this.name = i18n.name();
      this.description = i18n.desc();
      this.defaultOn = false;
    }

    init(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      plugin.registerViewType(env().V8, (leaf) => new (env().z8)(leaf));
      plugin.registerGlobalCommand({
        id: "footnotes:open",
        name: ng31I18n("footnotesPane").actionShow(),
        icon: "lucide-file-signature",
        callback: () => app.workspace.ensureSideLeaf(env().V8, "right", { active: true }),
      });
    }

    onUserEnable() { this.initLeaf(); }

    initLeaf() {
      this.app.workspace.ensureSideLeaf(env().V8, "right", { reveal: false });
    }
  };
}


export function ng31MarkdownImporterPlugin() {
  return class Ng31MarkdownImporterPlugin {
    constructor() {
      const i18n = ng31I18n("markdownFormatImporter");
      this.id = "markdown-importer";
      this.name = i18n.name();
      this.description = i18n.desc();
    }

    init(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      const i18n = ng31I18n("markdownFormatImporter");
      plugin.registerRibbonItem(i18n.actionOpen(), "lucide-binary", () => this.onOpen());
      plugin.registerGlobalCommand({
        id: "markdown-importer:open",
        name: i18n.actionOpen(),
        icon: "lucide-download",
        callback: () => this.onOpen(),
      });
    }

    onOpen() {
      new (env().X8)(this.app).open();
      return false;
    }
  };
}


// Path suggester for the markdown importer modal.
export function ng31ImporterPathSuggest() {
  const Base = env().SI;
  return class Ng31ImporterPathSuggest extends Base {
    constructor(app, inputEl, paths, modal) {
      super(app, inputEl);
      this.paths = paths || [];
      this.modal = modal || null;
    }

    renderSuggestion(path, el) {
      el.setText(env().pu(path));
    }

    getSuggestions(query) {
      const q = String(query).toLowerCase();
      return this.paths
        .filter((p) => String(p).toLowerCase().includes(q))
        .slice(0, 100);
    }

    selectSuggestion(path) {
      this.modal.switchToPath(path);
      this.textInputEl.trigger("input");
      this.close();
    }
  };
}


// Status-bar mode indicator (read / source / live-preview) with click menu.
const NG31_STATUS_MODES = {
  read: { viewMode: "preview", icon: "lucide-book-open", i18n: "read" },
  source: { viewMode: "source", source: true, icon: "lucide-code-2", i18n: "editSource" },
  "live-preview": { viewMode: "source", source: false, icon: "lucide-edit-3", i18n: "editLivePreview" },
};

export function ng31EditorStatusPlugin() {
  return class Ng31EditorStatusPlugin {
    constructor() {
      const i18n = ng31I18n("editorStatus");
      this.id = "editor-status";
      this.name = i18n.name();
      this.description = i18n.desc();
      this.defaultOn = true;
      this.hiddenFromList = true;
    }

    init(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      plugin.registerStatusBarItem();
    }

    onEnable(app, plugin) {
      plugin.registerEvent(app.workspace.on("layout-change", () => this.updateStatus()));
      plugin.registerEvent(app.workspace.on("active-leaf-change", () => this.updateStatus()));
      plugin.statusBarEl.addEventListener("click", (ev) => this.onClick(ev));
      plugin.statusBarEl.addEventListener("contextmenu", (ev) => this.onClick(ev));
      plugin.statusBarEl.addClass("mod-clickable");
      this.updateStatus();
    }

    onDisable() {}

    getActiveView() {
      const view = this.app.workspace.getActiveFileView();
      return view instanceof env().W6 ? view : null;
    }

    getStatus() {
      const view = this.getActiveView();
      if (!view) return "";
      if (view.getMode() === "preview") return "read";
      const editMode = view.editMode;
      if (!editMode) return "source";
      return editMode.sourceMode ? "source" : "live-preview";
    }

    async setStatus(mode) {
      const view = this.getActiveView();
      if (!view) return;
      const state = view.getState();
      const spec = NG31_STATUS_MODES[mode];
      if (spec) {
        state.mode = spec.viewMode;
        if ("source" in spec) state.source = spec.source;
      }
      await view.leaf.setViewState({ type: env().U6, state });
    }

    updateStatus() {
      const bar = this.plugin.statusBarEl;
      bar.empty();
      const status = this.getStatus();
      if (!status) {
        bar.hide();
        return;
      }
      bar.show();
      const iconEl = createSpan({ cls: "status-bar-item-icon" });
      bar.appendChild(iconEl);
      const spec = NG31_STATUS_MODES[status];
      const i18n = ng31I18n("editorStatus");
      env().tv(iconEl, spec.icon);
      env().Mv(iconEl, i18n[spec.i18n](), { placement: "top" });
    }

    onClick(ev) {
      const view = this.getActiveView();
      if (!view) return;
      const status = this.getStatus();
      const i18n = ng31I18n("editorStatus");
      const menu = new (env().Ug)();
      const addMode = (mode) => {
        const spec = NG31_STATUS_MODES[mode];
        menu.addItem((item) => item
          .setTitle(i18n[spec.i18n]())
          .setIcon(spec.icon)
          .setChecked(status === mode)
          .onClick(() => this.setStatus(mode)));
      };
      addMode("read");
      addMode("source");
      if (view.editMode) addMode("live-preview");
      menu.showAtMouseEvent(ev);
    }
  };
}


export function ng31OutgoingLinkPlugin() {
  return class Ng31OutgoingLinkPlugin {
    constructor() {
      const i18n = ng31I18n("outgoingLinks");
      this.id = "outgoing-link";
      this.name = i18n.name();
      this.description = i18n.desc();
      this.defaultOn = true;
    }

    init(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      plugin.registerViewType(env().n7, (leaf) => new (env().o7)(leaf));
      const i18n = ng31I18n("outgoingLinks");
      plugin.registerGlobalCommand({
        id: "outgoing-links:open",
        name: i18n.actionShow(),
        icon: "lucide-link",
        callback: () => app.workspace.ensureSideLeaf(env().n7, "right", { active: true }),
      });
      plugin.registerGlobalCommand({
        id: "outgoing-links:open-for-current",
        name: i18n.actionOpenForCurrent(),
        icon: "lucide-link",
        checkCallback: (checking) => this.openForCurrentFile(checking),
      });
    }

    onEnable(app, plugin) {
      plugin.registerEvent(app.workspace.on("layout-ready", () => this.initLeaf()));
      plugin.registerEvent(app.workspace.on("file-menu", (menu, file, source, leaf) =>
        this.onFileMenu(menu, file, source, leaf)));
      plugin.registerCliHandler(
        "links",
        "List outgoing links from a file",
        {
          file: { value: "<name>", description: "File name" },
          path: { value: "<path>", description: "File path" },
          total: { description: "Return link count" },
        },
        (args) => this.cliLinks(args));
    }

    cliLinks(args) {
      const file = this.app.cli.tryResolveFile(args);
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache) return "No links found.";
      const links = new Set();
      env().xT(cache, (link) => {
        const linkPath = env().MT(link).path;
        const dest = this.app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
        links.add(dest ? dest.path : linkPath + " (unresolved)");
      });
      if (args.total) return String(links.size);
      if (!links.size) return "No links found.";
      return [...links].sort().join("\n");
    }

    onUserEnable() { this.initLeaf(); }

    initLeaf() {
      this.app.workspace.ensureSideLeaf(env().n7, "right", { reveal: false });
    }

    onUserDisable(app) {
      app.workspace.detachLeavesOfType(env().n7);
    }

    async onFileMenu(menu, file, source, leaf) {
      if (env().Yl.isMobile || !(file instanceof env().$T) ||
          !leaf || file.extension !== "md" || source === "sidebar-context-menu") {
        return;
      }
      menu.addItem((item) => item
        .setSection("view.linked")
        .setTitle(ng31I18n("outgoingLinks").actionOpen())
        .setIcon("links-going-out")
        .onClick(async () => {
          await this.app.workspace.splitLeafOrActive(leaf, "horizontal").setViewState({
            type: env().n7,
            active: true,
            group: leaf,
            state: { file: file.path },
          });
        }));
    }

    openForCurrentFile(checking) {
      if (env().Yl.isPhone) return false;
      const file = this.app.workspace.getActiveFile();
      if (!file) return undefined;
      if (!checking) {
        this.app.workspace.splitActiveLeaf("vertical").setViewState({
          type: env().n7,
          active: true,
          group: this.app.workspace.activeLeaf,
          state: { file: file.path },
        });
      }
      return true;
    }
  };
}

