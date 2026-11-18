// g24 clean-room: outline plugin + "outline" view.
import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { ng24StringCompare } from "./n-g24-themes.js";
import { firstHeadingText } from "./path.js";
import { debounceCall } from "./timing.js";

// ---------------------------------------------------------------------------
// OutlineTreeItem (h7): one heading row.
// ---------------------------------------------------------------------------

export function ng24DefineOutlineTreeItem(host) {
  function OutlineTreeItem(heading) {
    const self = host.TreeItem.call(this) || this;
    self.heading = heading;
    self.level = heading.level;
    self.title = heading.title;
    self.from = heading.from;
    self.to = heading.to;
    return self;
  }
  inherit(OutlineTreeItem, host.TreeItem);
  const proto = OutlineTreeItem.prototype;

  proto.getSortKey = function () { return this.from; };

  proto.render = function () {
    const el = host.createEl("div", { cls: "outline-item" }, this.el);
    host.createEl("span", { cls: "outline-item-title", text: this.title }, el);
    return el;
  };

  return OutlineTreeItem;
}

// ---------------------------------------------------------------------------
// OutlineView (d7): the "outline" workspace leaf.
// ---------------------------------------------------------------------------

export function ng24DefineOutlineView(host) {
  function OutlineView(leaf) {
    const self = host.View.call(this, leaf) || this;
    self.app = leaf.app || (leaf.view && leaf.view.app);
    self.path = "";
    self.icon = "lucide-list";
    self.navigation = true;
    self.file = null;
    self.headings = [];
    self.followCursor = true;
    self._pendingFile = null;
    self._refresh = debounceCall(() => self.refresh(), 100);
    self.scope = self.app.scope.register([], "outline", self);
    return self;
  }
  inherit(OutlineView, host.View);
  const proto = OutlineView.prototype;

  Object.defineProperty(proto, "VIEW_TYPE", { get() { return "outline"; } });
  proto.getViewType = function () { return "outline"; };
  proto.getDisplayText = function () { return "Outline"; };
  proto.getIcon = function () { return "lucide-list"; };

  proto.onOpen = function () {
    const app = this.app;
    this.contentEl.empty();
    this.headerEl = host.createEl("div", { cls: "view-header" }, this.contentEl);
    const titleEl = host.createEl("div", { cls: "view-header-title" }, this.headerEl);
    host.createEl("div", { cls: "view-header-breadcrumb", text: "Outline" }, titleEl);
    const actions = host.createEl("div", { cls: "view-actions" }, this.headerEl);
    this.collapseAllBtn = host.createEl("a", { cls: "clickable-icon view-action", attr: { "aria-label": "Collapse all" } }, actions);
    setIcon(this.collapseAllBtn, "lucide-chevrons-down-up");
    this.collapseAllBtn.addEventListener("click", () => this.tree.collapseAll());
    this.searchComponent = new host.SearchComponent(this.scope);
    const searchEl = host.createDiv({ cls: "search-input-container" }, this.contentEl);
    this.searchComponent.render(searchEl);
    this.searchComponent.inputEl.addEventListener("input", () => this.tree.setFilter(this.searchComponent.getValue()));
    this.treeEl = host.createDiv({ cls: "tree-container outline-tree" }, this.contentEl);
    this.tree = new host.Tree(this);
    this.tree.setRootEl(this.treeEl);
    this.tree.on("select", (item) => this.onItemClick(item));
    this.registerEvent(app.workspace.on("file-open", () => this.onActiveFileChange()));
    this.registerEvent(app.metadataCache.on("changed", (file) => {
      if (file === this.file || file.path === this.path) this._refresh();
    }));
    this.registerEvent(app.workspace.on("active-leaf-change", () => this.onActiveFileChange()));
    this.onActiveFileChange();
  };

  proto.getActiveMarkdownFile = function () {
    const view = this.app.workspace.getActiveViewOfType("markdown");
    return view && view.file;
  };

  proto.onActiveFileChange = function () {
    const file = this.getActiveMarkdownFile();
    if (file !== this._pendingFile) {
      this._pendingFile = file;
      this.setFile(file);
    }
  };

  proto.setFile = function (file) {
    this.file = file;
    this.path = file ? file.path : "";
    this.headings = file ? this.extractHeadings(file) : [];
    this.refresh();
  };

  proto.extractHeadings = function (file) {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache || !Array.isArray(cache.headings)) return [];
    return cache.headings
      .filter((h) => h && h.heading && h.level > 0)
      .map((h) => ({
        level: h.level,
        title: h.heading,
        from: { line: h.position.start.line, col: h.position.start.col, offset: h.position.start.offset },
        to: { line: h.position.end.line, col: h.position.end.col, offset: h.position.end.offset },
      }));
  };

  proto.refresh = function () {
    if (!this.tree) return;
    const filter = this.searchComponent ? this.searchComponent.getValue().toLowerCase() : "";
    const headings = this.headings.filter((h) => !filter || h.title.toLowerCase().includes(filter));
    const items = headings.map((h) => new host.OutlineTreeItem(h));
    items.forEach((item) => { item.view = this; });
    this.tree.setChildren(items);
    // nest by level
    this.nestItems(items);
  };

  proto.nestItems = function (items) {
    const stack = [];
    for (const item of items) {
      while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
      if (stack.length) {
        stack[stack.length - 1].children.push(item);
        item.parent = stack[stack.length - 1];
      }
      stack.push(item);
    }
  };

  proto.onItemClick = function (item) {
    const file = this.file;
    if (!file) return;
    const view = this.app.workspace.getActiveViewOfType("markdown");
    if (view && view.editor) {
      view.editor.setCursor({ line: item.heading.from.line, ch: item.heading.from.col || 0 });
      view.editor.scrollIntoView({ from: item.heading.from, to: item.heading.to }, true);
    }
  };

  proto.getState = function () { return {}; };
  proto.setState = function () {};

  // ------------------------------------------------------------- CLI
  proto.handleCli = async function (args) {
    const file = await this.app.cli.tryResolveFile(args);
    if (!file || file.extension !== "md") throw new Error("File is not a markdown file.");
    const view = new host.OutlineView(null);
    view.app = this.app;
    view.file = file;
    view.path = file.path;
    view.headings = view.extractHeadings(file);
    if (!view.headings.length) return "No headings found.";
    const format = args.format || "tree";
    const showTotal = args.total !== undefined && args.total !== false;
    if (format === "json") {
      return JSON.stringify(view.headings.map((h) => ({ level: h.level, title: h.title })));
    }
    if (format === "md") {
      return view.headings.map((h) => "#".repeat(h.level) + " " + h.title).join("\n");
    }
    // tree
    const lines = [];
    const walk = (items, depth) => {
      for (const item of items) {
        lines.push("  ".repeat(depth) + item.title);
        if (item.children && item.children.length) walk(item.children, depth + 1);
      }
    };
    const items = view.headings.map((h) => new host.OutlineTreeItem(h));
    view.nestItems(items);
    walk(items, 0);
    let out = lines.join("\n");
    if (showTotal) out += "\nTotal: " + view.headings.length;
    return out;
  };

  return OutlineView;
}

// ---------------------------------------------------------------------------
// OutlinePlugin (p7): registers commands + CLI handler.
// ---------------------------------------------------------------------------

export function ng24DefineOutlinePlugin(host) {
  function OutlinePlugin(app, manifest) {
    const self = host.Plugin.call(this, app, manifest) || this;
    self.app = app;
    return self;
  }
  inherit(OutlinePlugin, host.Plugin);
  const proto = OutlinePlugin.prototype;

  proto.onload = function () {
    const app = this.app;
    this.addCommand({
      id: "outline:open",
      name: "Open outline",
      callback: () => app.workspace.getRightLeaf(false).openFile(null, { viewType: "outline" }),
    });
    this.addCommand({
      id: "outline:open-for-current",
      name: "Open outline for current file",
      checkCallback: (checking) => {
        const file = app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) {
          app.workspace.getRightLeaf(false).openFile(null, { viewType: "outline" });
        }
        return true;
      },
    });
    this.registerEvent(app.workspace.on("file-open", () => {}));
  };

  return OutlinePlugin;
}

export const defineOutlineTreeItem = ng24DefineOutlineTreeItem;
export const defineOutlineView = ng24DefineOutlineView;
export const defineOutlinePlugin = ng24DefineOutlinePlugin;
