// g38 clean-room: "Properties" core plugin (spec g38 Part 2).
// Status bar frontmatter count, two open-properties commands, the two view types,
// file-menu entry, hover-link source, and the file-properties leaf picker.
export const ng38ViewTypeAllProperties = "all-properties";
export const ng38ViewTypeFileProperties = "file-properties";
export const ng38PropertySortOrders = [
  ["alphabetical", "alphabeticalReverse"],
  ["frequency", "frequencyReverse"],
];

export function ng38PropertySortLabels(t) {
  return {
    alphabetical: t.labelSortByNameAToZ(),
    alphabeticalReverse: t.labelSortByNameZToA(),
    frequency: t.labelSortByFrequencyHighToLow(),
    frequencyReverse: t.labelSortByFrequencyLowToHigh(),
  };
}

export function ng38PropertiesPlugin(host) {
  function PropertiesPlugin() {
    this.id = "properties";
    this.name = host.t.plugins.properties.name();
    this.description = host.t.plugins.properties.desc();
    this.defaultOn = true;
    this.app = null;
    this.plugin = null;
  }

  PropertiesPlugin.prototype.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerStatusBarItem();
    const side = () => (host.Platform.isMobile ? "left" : "right");
    plugin.registerGlobalCommand({
      id: "properties:open",
      name: host.t.plugins.properties.actionShow(),
      icon: "lucide-archive",
      callback: () => app.workspace.ensureSideLeaf(ng38ViewTypeAllProperties, side(), { active: true }),
    });
    plugin.registerGlobalCommand({
      id: "properties:open-local",
      name: host.t.plugins.properties.actionShowLocal(),
      icon: "lucide-info",
      callback: () => this.ensurePropertiesView(app.workspace.getActiveFile()),
    });
    plugin.registerViewType(ng38ViewTypeAllProperties, (leaf) => new host.AllPropertiesView(leaf));
    plugin.registerViewType(ng38ViewTypeFileProperties, (leaf) => new host.FilePropertiesView(leaf, this));
  };

  PropertiesPlugin.prototype.initLeaf = function () {
    const side = host.Platform.isMobile ? "left" : "right";
    this.app.workspace.ensureSideLeaf(ng38ViewTypeAllProperties, side, { reveal: false });
  };

  PropertiesPlugin.prototype.onUserEnable = function () {
    this.initLeaf();
  };

  PropertiesPlugin.prototype.countProperties = function (cache) {
    const fm = cache && cache.frontmatter;
    return fm ? Object.keys(fm).length : 0;
  };

  PropertiesPlugin.prototype.updateStatusbar = function (count) {
    const el = this.plugin && this.plugin.statusBarEl;
    if (!el) return;
    const text = host.t.nouns.propertiesWithCount({ count });
    if (typeof el.setText === "function") el.setText(text);
    else el.textContent = text;
    if (typeof el.toggle === "function") el.toggle(count > 0);
  };

  PropertiesPlugin.prototype.onFileOpen = function (file) {
    const cache = file ? this.app.metadataCache.getFileCache(file) : null;
    this.updateStatusbar(this.countProperties(cache));
  };

  PropertiesPlugin.prototype.onCacheChanged = function (file, oldCache, newCache) {
    if (file !== this.app.workspace.getActiveFile()) return;
    this.updateStatusbar(this.countProperties(newCache));
  };

  PropertiesPlugin.prototype.onFileMenu = function (menu, file, source, leaf) {
    if (host.Platform.isMobile) return;
    if (!(file instanceof host.TFile)) return;
    if (!leaf) return;
    if (file.extension !== "md") return;
    if (source === "sidebar-context-menu") return;
    menu.addItem((item) => {
      item
        .setSection("view.linked")
        .setTitle(host.t.plugins.properties.actionOpenLocal())
        .setIcon("lucide-info")
        .onClick(async () => {
          const newLeaf = await this.app.workspace.splitLeafOrActive(leaf, "horizontal");
          await newLeaf.setViewState({
            type: ng38ViewTypeFileProperties,
            active: true,
            group: leaf,
            state: { file: file.path },
          });
        });
    });
  };

  PropertiesPlugin.prototype.onEnable = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerEvent(app.workspace.on("file-open", (f) => this.onFileOpen(f), this));
    plugin.registerEvent(app.workspace.on("layout-ready", () => this.initLeaf(), this));
    plugin.registerEvent(app.workspace.on("file-menu", (menu, file, source, leaf) => this.onFileMenu(menu, file, source, leaf), this));
    plugin.registerEvent(app.metadataCache.on("changed", (f, o, n) => this.onCacheChanged(f, o, n), this));
    const el = plugin.statusBarEl;
    if (el) {
      if (typeof el.addClass === "function") el.addClass("mod-clickable");
      else el.classList.add("mod-clickable");
      el.addEventListener("click", () => this.ensurePropertiesView(this.app.workspace.getActiveFile()));
    }
    app.workspace.registerHoverLinkSource("properties", {
      display: this.name,
      defaultMod: true,
    });
  };

  PropertiesPlugin.prototype.onDisable = function (app) {
    if (app.workspace.unregisterHoverLinkSource) app.workspace.unregisterHoverLinkSource("properties");
  };

  PropertiesPlugin.prototype.ensurePropertiesView = async function (file) {
    const ws = this.app.workspace;
    const leaves = ws.getLeavesOfType(ng38ViewTypeFileProperties) || [];
    let leaf = null;
    for (const candidate of leaves) {
      if (!candidate.pinned ||
          (candidate.getViewState() && candidate.getViewState().state && candidate.getViewState().state.file === (file ? file.path : undefined))) {
        leaf = candidate;
        break;
      }
    }
    if (!leaf) leaf = ws.getRightLeaf(false);
    await ws.revealLeaf(leaf);
    await leaf.setViewState({
      type: ng38ViewTypeFileProperties,
      state: file ? { file: file.path } : undefined,
    });
    ws.setActiveLeaf(leaf, { focus: true });
    return leaf.view;
  };

  PropertiesPlugin.prototype.addProperty = async function (file) {
    const view = await this.ensurePropertiesView(file);
    view.metadataEditor.addProperty();
  };

  return PropertiesPlugin;
}

// Test-facing aliases for the legacy module contract.
export { ng38ViewTypeAllProperties as s34ViewTypeAllProperties, ng38ViewTypeFileProperties as s34ViewTypeFileProperties, ng38PropertySortOrders as s34PropertySortOrders, ng38PropertySortLabels as s34PropertySortLabels, ng38PropertiesPlugin as definePropertiesPlugin };
