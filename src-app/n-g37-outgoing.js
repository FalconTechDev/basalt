// g37 — outgoing-links core plugin shell (clean-room). Factory: ng37OutgoingLinksPlugin(host).
import { env } from "./env.js";
import { parseLinktext } from "./path.js";

export const ng37OutgoingLinkViewType = "outgoing-link";

const ng37OutgoingStrings = () => env().gm.plugins.outgoingLinks;

export function ng37OutgoingLinksPlugin(host) {
  function Ng37OutgoingLinksPlugin() {
    this.id = "outgoing-link";
    this.defaultOn = true;
    const t = ng37OutgoingStrings();
    this.name = t.name();
    this.description = t.desc();
  }

  const proto = Ng37OutgoingLinksPlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerViewType(ng37OutgoingLinkViewType, (leaf) => new (env().o7)(leaf));
    const t = ng37OutgoingStrings();
    plugin.registerGlobalCommand({
      id: "outgoing-links:open",
      name: t.actionShow(),
      icon: "lucide-link",
      callback: () => {
        this.app.workspace.ensureSideLeaf(ng37OutgoingLinkViewType, "right", { active: true });
      },
    });
    plugin.registerGlobalCommand({
      id: "outgoing-links:open-for-current",
      name: t.actionOpenForCurrent(),
      icon: "lucide-link",
      checkCallback: (checking) => this.openForCurrentFile(checking),
    });
  };

  proto.onEnable = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerEvent(app.workspace.on("layout-ready", () => this.initLeaf()));
    plugin.registerEvent(app.workspace.on("file-menu", (menu, file, source, leaf) => this.onFileMenu(menu, file, source, leaf)));
    plugin.registerCliHandler("links", "List outgoing links from a file", {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
      total: { description: "Return link count" },
    }, (args) => this.cliLinks(args));
  };

  proto.onUserEnable = function () { this.initLeaf(); };

  proto.onUserDisable = function (app) {
    app.workspace.detachLeavesOfType(ng37OutgoingLinkViewType);
  };

  proto.initLeaf = function () {
    this.app.workspace.ensureSideLeaf(ng37OutgoingLinkViewType, "right", { reveal: false });
  };

  proto._activeFile = function () {
    const leaf = this.app.workspace.activeLeaf;
    const file = leaf && leaf.view && leaf.view.file;
    const TFile = env().$T;
    return file && TFile && file instanceof TFile ? file : null;
  };

  proto.openForCurrentFile = function (checking) {
    if ((env().Yl || {}).isPhone) return false;
    const file = this._activeFile();
    if (!file) return undefined;
    if (!checking) {
      const leaf = this.app.workspace.activeLeaf;
      const newLeaf = this.app.workspace.splitActiveLeaf("vertical");
      if (newLeaf && newLeaf.setViewState) {
        newLeaf.setViewState({
          type: ng37OutgoingLinkViewType,
          state: { file: file.path },
          active: true,
          group: leaf,
        });
      }
    }
    return true;
  };

  proto.onFileMenu = function (menu, file, source, leaf) {
    const TFile = env().$T;
    const Yl = env().Yl || {};
    if (Yl.isMobile || !file || !(TFile && file instanceof TFile)) return;
    if (file.extension !== "md" || !leaf || source === "sidebar-context-menu") return;
    const t = ng37OutgoingStrings();
    menu.addItem((item) => {
      item.setSection("view.linked")
        .setTitle(t.actionOpen())
        .setIcon("links-going-out")
        .onClick(async () => {
          const newLeaf = await this.app.workspace.splitLeafOrActive(leaf, "horizontal");
          if (newLeaf && newLeaf.setViewState) {
            await newLeaf.setViewState({
              type: ng37OutgoingLinkViewType,
              state: { file: file.path },
              active: true,
              group: leaf,
            });
          }
        });
    });
  };

  proto.cliLinks = function (args) {
    const file = this.app.cli.tryResolveFile(args);
    const cache = file && this.app.metadataCache.getFileCache(file);
    const targets = new Set();
    if (cache) {
      const refs = [];
      for (const key of ["links", "embeds", "frontmatterLinks"]) {
        const list = cache[key];
        if (Array.isArray(list)) for (const ref of list) refs.push(ref);
      }
      const mc = this.app.metadataCache;
      for (const ref of refs) {
        if (!ref || typeof ref.link !== "string") continue;
        const link = parseLinktext(ref.link).path;
        if (!link) continue;
        const dest = mc.getFirstLinkpathDest(link, file.path);
        targets.add(dest ? dest.path : link + " (unresolved)");
      }
    }
    if (args.total) return String(targets.size);
    if (targets.size === 0) return "No links found.";
    return Array.from(targets).sort().join("\n");
  };

  return Ng37OutgoingLinksPlugin;
}
