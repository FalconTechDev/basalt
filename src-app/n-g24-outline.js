// g24 clean-room: outline plugin + "outline" view.
// View uses the shared tree engine; headings come from the metadata cache.
import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { ng15CollapsibleTreeItem } from "./n-g15-tree.js";
import { debounceCall } from "./timing.js";

// ---------------------------------------------------------------------------
// OutlineTreeItem (h7): one heading row.
// ---------------------------------------------------------------------------

let ng24OutlineItemClass = null;

export function ng24DefineOutlineTreeItem(host) {
  function OutlineItemBase(view, heading) {
    const self = host.TreeItem.call(this) || this;
    self.view = view;
    self.heading = heading;
    self.level = heading.level;
    self.setClickable(true);
    self.el.addClass("outline-item");
    self.innerEl.createDiv({ cls: "outline-item-content" });
    self.titleEl = self.innerEl.firstChild;
    self.vChildren = new host.TreeChildren(self);
    self.updateTitle();
    return self;
  }
  inherit(OutlineItemBase, host.TreeItem);
  const proto = OutlineItemBase.prototype;

  proto.getSortKey = function () { return this.heading.from.line; };

  proto.updateTitle = function () {
    const el = this.titleEl;
    if (!el) return;
    el.empty();
    el.createSpan({ cls: "outline-item-title", text: this.heading.title });
  };

  proto.onSelfClick = function (event) {
    const view = this.view;
    const file = view.file;
    if (!file) return;
    const leaf = view.app.workspace.getLeaf(host.Keymap.isModEvent(event));
    leaf.openFile(file, {
      eState: { line: this.heading.from.line },
    });
  };

  if (!ng24OutlineItemClass) ng24OutlineItemClass = ng15CollapsibleTreeItem(OutlineItemBase);
  return ng24OutlineItemClass;
}

// ---------------------------------------------------------------------------
// heading extraction shared by the view and the CLI handler
// ---------------------------------------------------------------------------

export function ng24OutlineHeadings(app, file) {
  if (!file || file.extension !== "md") return [];
  const cache = app.metadataCache.getFileCache(file);
  if (!cache || !Array.isArray(cache.headings)) return [];
  return cache.headings
    .filter((h) => h && h.heading && h.level > 0)
    .map((h) => ({
      level: h.level,
      title: h.heading,
      from: { line: h.position.start.line, col: h.position.start.col, offset: h.position.start.offset },
      to: { line: h.position.end.line, col: h.position.end.col, offset: h.position.end.offset },
    }));
}

// ---------------------------------------------------------------------------
// OutlineView (d7): the "outline" workspace leaf.
// ---------------------------------------------------------------------------

export function ng24DefineOutlineView(host) {
  function OutlineView(leaf) {
    const self = host.ItemView.call(this, leaf) || this;
    self.app = leaf.app;
    self.icon = "lucide-list";
    self.navigation = true;
    self.file = null;
    self.path = "";
    self.followCursor = true;
    self._headings = [];
    self._rebuild = debounceCall(() => self.rebuild(), 100);
    self.scope = new host.Scope(self.app.scope);
    return self;
  }
  inherit(OutlineView, host.ItemView);
  const proto = OutlineView.prototype;

  Object.defineProperty(proto, "VIEW_TYPE", { get() { return "outline"; } });
  proto.getViewType = function () { return "outline"; };
  proto.getDisplayText = function () { return "Outline"; };
  proto.getIcon = function () { return "lucide-list"; };

  proto.onload = function () {
    host.ItemView.prototype.onload.call(this);
    const searchWrap = this.contentEl.createDiv({ cls: "search-input-container outline-search" });
    this.searchComponent = new host.SearchComponent(searchWrap, (query) => {
      this._filter = (query || "").toLowerCase();
      this.rebuild();
    });
    const treeEl = this.contentEl.createDiv({ cls: "tree-container outline-tree" });
    this.tree = new host.Tree(this, {
      app: this.app,
      containerEl: treeEl,
      id: "outline",
      scope: this.scope,
      getNodeId: (item) => "outline-" + item.heading.from.line,
      handleCollapseAll: (collapsed) => {},
    });
    this.registerEvent(this.app.workspace.on("file-open", this.onActiveFileChange, this));
    this.registerEvent(this.app.workspace.on("active-leaf-change", this.onActiveFileChange, this));
    this.registerEvent(this.app.metadataCache.on("changed", this._rebuild));
    this.onActiveFileChange();
  };

  proto.getActiveMarkdownFile = function () {
    const view = this.app.workspace.getActiveViewOfType("markdown");
    return view && view.file;
  };

  proto.onActiveFileChange = function () {
    const file = this.getActiveMarkdownFile();
    if (file !== this.file) this.setFile(file);
    else this._rebuild();
  };

  proto.setFile = function (file) {
    this.file = file || null;
    this.path = file ? file.path : "";
    this._headings = file ? ng24OutlineHeadings(this.app, file) : [];
    this.rebuild();
  };

  proto.rebuild = function () {
    const ItemClass = ng24OutlineItemClass || (ng24OutlineItemClass = ng24DefineOutlineTreeItem(host));
    const filter = this._filter || "";
    const headings = this._headings.filter((h) => !filter || h.title.toLowerCase().indexOf(filter) >= 0);
    const root = this.tree.root;
    root.vChildren.clear();
    const stack = [];
    for (const heading of headings) {
      const item = new ItemClass(this, heading);
      while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
      const parent = stack.length ? stack[stack.length - 1] : root;
      parent.vChildren.addChild(item);
      if (stack.length) {
        item.setCollapsible(true);
        item.setCollapsed(false);
      }
      stack.push(item);
    }
    this.tree.infinityScroll.invalidateAll();
  };

  proto.collapseAll = function () {
    const walk = (owner) => {
      for (const item of owner.vChildren ? owner.vChildren.children : []) {
        if (item.setCollapsed) item.setCollapsed(true);
        walk(item);
      }
    };
    walk(this.tree.root);
  };

  proto.getState = function () { return {}; };
  proto.setState = function () {};

  // ------------------------------------------------------------- CLI
  proto.handleCli = async function (args) {
    const file = await this.app.cli.tryResolveFile(args);
    if (!file || file.extension !== "md") throw new Error("File is not a markdown file.");
    const headings = ng24OutlineHeadings(this.app, file);
    if (!headings.length) return "No headings found.";
    const format = (args && args.format) || "tree";
    const showTotal = !args || args.total === undefined || args.total !== false;
    if (format === "json") {
      return JSON.stringify(headings.map((h) => ({ level: h.level, title: h.title })));
    }
    if (format === "md") {
      return headings.map((h) => "#".repeat(Math.min(h.level, 6)) + " " + h.title).join("\n");
    }
    const lines = [];
    const walk = (items, depth) => {
      for (const h of items) {
        lines.push("  ".repeat(depth) + h.title);
        // children are handled by nesting below
      }
    };
    // build nested list for tree output
    const nested = [];
    const stack = [];
    for (const h of headings) {
      const node = { title: h.title, level: h.level, children: [] };
      while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
      if (stack.length) stack[stack.length - 1].children.push(node);
      else nested.push(node);
      stack.push(node);
    }
    const emit = (nodes, depth) => {
      for (const n of nodes) {
        lines.push("  ".repeat(depth) + n.title);
        emit(n.children, depth + 1);
      }
    };
    emit(nested, 0);
    let out = lines.join("\n");
    if (showTotal) out += "\nTotal: " + headings.length;
    return out;
  };

  return OutlineView;
}

// ---------------------------------------------------------------------------
// OutlinePlugin (p7)
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
      id: "open",
      name: "Open outline",
      callback: () => app.workspace.getRightLeaf(false).openFile(null, { viewType: "outline" }),
    });
    this.addCommand({
      id: "open-for-current",
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
    if (app.cli && app.cli.registerHandler) {
      const handler = async (args) => {
        const view = new (ng24DefineOutlineView(host))(null);
        view.app = app;
        return view.handleCli(args);
      };
      app.cli.registerHandler("outline", "Show headings of a markdown file", { format: { type: "string" }, total: { type: "boolean" } }, handler);
    }
  };

  return OutlinePlugin;
}

export const defineOutlineTreeItem = ng24DefineOutlineTreeItem;
export const defineOutlineView = ng24DefineOutlineView;
export const defineOutlinePlugin = ng24DefineOutlinePlugin;
