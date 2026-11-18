// g24 clean-room: the "tag" sidebar view (defineTagPaneView/Item/Tree).
import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { ng24StringCompare } from "./n-g24-themes.js";
import { baseName } from "./path.js";

const NG24_TAG_FOLD_KEY = "tag-pane-fold";
const NG24_TAG_SORT_KEYS = ["alphabetical", "reverseAlphabetical", "frequency", "reverseFrequency"];

// ---------------------------------------------------------------------------
// TagPaneItem (gee)
// ---------------------------------------------------------------------------

export function ng24DefineTagPaneItem(host) {
  function TagPaneItem() {
    return host.TreeItem.call(this);
  }
  inherit(TagPaneItem, host.TreeItem);
  const proto = TagPaneItem.prototype;

  proto.getSortKey = function () {
    return this.tag || "";
  };

  proto.getCount = function () {
    let count = this.count || 0;
    for (const child of this.children || []) count += child.getCount ? child.getCount() : 0;
    return count;
  };

  proto.openFile = function () {
    const app = this.view && this.view.app;
    if (!app) return;
    app.workspace.openLinkText("tag:" + this.tag, this.view && this.view.path || "", false);
  };

  proto.render = function () {
    const el = host.createEl("div", { cls: "tag-pane-tag" }, this.el);
    const name = host.createEl("span", { cls: "tag-pane-tag-name" }, el);
    name.setText(this.tag || "");
    const count = host.createEl("span", { cls: "tag-pane-tag-count" }, el);
    count.setText(String(this.getCount()));
    return el;
  };

  return TagPaneItem;
}

// ---------------------------------------------------------------------------
// TagPaneTree (yee): hierarchical tag tree with sorting + search.
// ---------------------------------------------------------------------------

export function ng24DefineTagPaneTree(host) {
  function TagPaneTree(view) {
    const self = host.Tree.call(this, view) || this;
    self.view = view;
    self.sortMode = NG24_TAG_SORT_KEYS[0];
    self._items = new Map(); // tag -> TagPaneItem
    self._root = new host.TreeItem();
    self._root.children = [];
    self._filter = "";
    return self;
  }
  inherit(TagPaneTree, host.Tree);
  const proto = TagPaneTree.prototype;

  proto.setSortMode = function (mode) {
    if (NG24_TAG_SORT_KEYS.includes(mode)) this.sortMode = mode;
    this.requestSort();
  };

  proto.setFilter = function (filter) {
    this._filter = (filter || "").toLowerCase();
    this.refresh();
  };

  proto._sortItems = function (items) {
    const mode = this.sortMode;
    const key = (item) => item.getSortKey();
    const count = (item) => item.getCount();
    const arr = items.slice();
    if (mode === "reverseAlphabetical") arr.sort((a, b) => ng24StringCompare(key(b), key(a)));
    else if (mode === "frequency") arr.sort((a, b) => count(b) - count(a) || ng24StringCompare(key(a), key(b)));
    else if (mode === "reverseFrequency") arr.sort((a, b) => count(a) - count(b) || ng24StringCompare(key(a), key(b)));
    else arr.sort((a, b) => ng24StringCompare(key(a), key(b)));
    return arr;
  };

  /** Builds/updates the tree from the metadata cache tags. */
  proto.refresh = function () {
    const app = this.view.app;
    const tags = app.metadataCache.getTags ? app.metadataCache.getTags() : {};
    // flatten { "#tag": count, "#parent/child": count }
    const entries = Object.entries(tags).map(([k, count]) => {
      const raw = k.startsWith("#") ? k.slice(1) : k;
      return { tag: raw, count: typeof count === "number" ? count : 1 };
    }).filter((e) => e.tag && (!this._filter || e.tag.toLowerCase().includes(this._filter)));
    this._root.children = [];
    const nodes = new Map(); // full path -> item
    const getNode = (path) => {
      if (nodes.has(path)) return nodes.get(path);
      const item = new host.TagPaneItem();
      item.tag = path;
      item.view = this.view;
      item.level = path.split("/").length - 1;
      nodes.set(path, item);
      return item;
    };
    for (const { tag, count } of entries.sort((a, b) => ng24StringCompare(a.tag, b.tag))) {
      const parts = tag.split("/");
      let parent = this._root;
      let acc = "";
      for (const part of parts) {
        acc = acc ? acc + "/" + part : part;
        const isLeaf = acc === tag;
        const node = getNode(acc);
        node.count = isLeaf ? count : (node.count || 0);
        if (parent.children.indexOf(node) === -1) parent.children.push(node);
        parent = node;
      }
    }
    // sort children recursively
    const sortRec = (item) => {
      if (item.children && item.children.length) {
        item.children = this._sortItems(item.children);
        item.children.forEach(sortRec);
      }
    };
    sortRec(this._root);
    this.setChildren(this._root.children);
    // persist fold state
    this.saveFold?.();
  };

  proto.onHeaderClick = function () {};
  return TagPaneTree;
}

// ---------------------------------------------------------------------------
// TagPaneView (bee): the "tag" workspace leaf.
// ---------------------------------------------------------------------------

export function ng24DefineTagPaneView(host) {
  function TagPaneView(leaf) {
    const self = host.View.call(this, leaf) || this;
    self.app = leaf.app || (leaf.view && leaf.view.app);
    self.path = "";
    self.icon = "lucide-tag";
    self.navigation = true;
    self.scope = self.app.scope.register([], "tag-pane", self);
    return self;
  }
  inherit(TagPaneView, host.View);
  const proto = TagPaneView.prototype;

  Object.defineProperty(proto, "VIEW_TYPE", { get() { return "tag"; } });

  proto.getViewType = function () { return "tag"; };
  proto.getDisplayText = function () { return "Tags"; };
  proto.getIcon = function () { return "lucide-tag"; };

  proto.onOpen = function () {
    const app = this.app;
    this.tree = new host.TagPaneTree(this);
    const container = this.contentEl;
    this.headerEl = host.createEl("div", { cls: "view-header" }, container);
    const titleEl = host.createEl("div", { cls: "view-header-title" }, this.headerEl);
    host.createEl("div", { cls: "view-header-breadcrumb", text: "Tags" }, titleEl);
    // search box
    this.searchComponent = new host.SearchComponent(this.scope);
    const searchEl = host.createDiv({ cls: "search-input-container" }, container);
    this.searchComponent.render(searchEl);
    this.searchComponent.inputEl.addEventListener("input", () => this.tree.setFilter(this.searchComponent.getValue()));
    // tree container
    this.treeEl = host.createDiv({ cls: "tree-container tag-pane-tree" }, container);
    this.tree.setRootEl(this.treeEl);
    this.tree.on("select", (item) => item.openFile());
    this.tree.on("load", () => this.tree.refresh());
    // load persisted fold + sort
    this.tree.loadFoldState?.();
    this.registerEvent(app.metadataCache.on("changed", () => this.tree.refresh()));
    this.registerEvent(app.workspace.on("css-change", () => this.tree.refresh()));
    this.tree.refresh();
  };

  proto.onClose = function () {
    this.tree && this.tree.saveFoldState?.();
  };

  proto.getState = function () {
    return { sortMode: this.tree ? this.tree.sortMode : NG24_TAG_SORT_KEYS[0] };
  };

  proto.setState = function (state) {
    if (state && state.sortMode && this.tree) this.tree.setSortMode(state.sortMode);
  };

  proto.onPaneMenu = function (menu, source) {
    menu.addItem((item) => item.setTitle("Alphabetical").setChecked(this.tree && this.tree.sortMode === "alphabetical").onClick(() => this.tree.setSortMode("alphabetical")));
    menu.addItem((item) => item.setTitle("Reverse alphabetical").setChecked(this.tree && this.tree.sortMode === "reverseAlphabetical").onClick(() => this.tree.setSortMode("reverseAlphabetical")));
    menu.addItem((item) => item.setTitle("Frequency").setChecked(this.tree && this.tree.sortMode === "frequency").onClick(() => this.tree.setSortMode("frequency")));
    menu.addItem((item) => item.setTitle("Reverse frequency").setChecked(this.tree && this.tree.sortMode === "reverseFrequency").onClick(() => this.tree.setSortMode("reverseFrequency")));
  };

  return TagPaneView;
}

export const defineTagPaneItem = ng24DefineTagPaneItem;
export const defineTagPaneTree = ng24DefineTagPaneTree;
export const defineTagPaneView = ng24DefineTagPaneView;
