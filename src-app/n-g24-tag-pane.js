// g24 clean-room: the "tag" sidebar view (defineTagPaneView/Item/Tree).
// Uses the shared tree engine (host.Tree/TreeItem/TreeChildren) with the
// ng15 collapsible-item mixin; hierarchy comes from "/" in tag names.
import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { ng24StringCompare } from "./n-g24-themes.js";
import { ng15CollapsibleTreeItem } from "./n-g15-tree.js";
import { debounceCall } from "./timing.js";

const NG24_TAG_SORT_KEYS = ["alphabetical", "reverseAlphabetical", "frequency", "reverseFrequency"];

// ---------------------------------------------------------------------------
// TagPaneItem (gee): one tag row (collapsible when it has children).
// ---------------------------------------------------------------------------

let ng24TagItemCollapsible = null;

export function ng24DefineTagPaneItem(host) {
  function TagPaneItemBase(view, tag, count) {
    const self = host.TreeItem.call(this) || this;
    self.view = view;
    self.tag = tag || "";
    self.count = count || 0;
    self.level = self.tag ? self.tag.split("/").length - 1 : 0;
    self.setClickable(true);
    self.el.addClass("tag-pane-tag-item");
    self.innerEl.createDiv({ cls: "tag-pane-tag-content" });
    self.titleEl = self.innerEl.firstChild;
    self.vChildren = new host.TreeChildren(self);
    self.updateTitle();
    return self;
  }
  inherit(TagPaneItemBase, host.TreeItem);
  const proto = TagPaneItemBase.prototype;

  proto.getSortKey = function () { return this.tag; };
  proto.getCount = function () {
    let count = this.count || 0;
    for (const child of this.vChildren ? this.vChildren.children : []) {
      count += child.getCount ? child.getCount() : (child.count || 0);
    }
    return count;
  };

  proto.updateTitle = function () {
    const el = this.titleEl;
    if (!el) return;
    el.empty();
    el.createSpan({ cls: "tag-pane-tag-name", text: this.tag });
    el.createSpan({ cls: "tag-pane-tag-count", text: String(this.getCount()) });
  };

  proto.onSelfClick = function (event) {
    const app = this.view.app;
    const plugin = app.internalPlugins.getEnabledPluginById("global-search");
    if (plugin && plugin.openGlobalSearch) {
      plugin.openGlobalSearch("tag:" + this.tag);
    } else {
      app.workspace.openLinkText("tag:" + this.tag, "", false);
    }
  };

  if (!ng24TagItemCollapsible) ng24TagItemCollapsible = ng15CollapsibleTreeItem(TagPaneItemBase);
  return ng24TagItemCollapsible;
}

// ---------------------------------------------------------------------------
// TagPaneTree (yee) — kept as a thin data helper; the view owns host.Tree.
// ---------------------------------------------------------------------------

export function ng24DefineTagPaneTree(host) {
  function TagPaneTree(view) {
    this.view = view;
    this.sortMode = NG24_TAG_SORT_KEYS[0];
    this.filter = "";
  }
  const proto = TagPaneTree.prototype;

  proto.setSortMode = function (mode) {
    if (NG24_TAG_SORT_KEYS.indexOf(mode) >= 0) this.sortMode = mode;
  };

  proto.compare = function (a, b) {
    const mode = this.sortMode;
    if (mode === "reverseAlphabetical") return ng24StringCompare(b.tag, a.tag);
    if (mode === "frequency") return (b.getCount() - a.getCount()) || ng24StringCompare(a.tag, b.tag);
    if (mode === "reverseFrequency") return (a.getCount() - b.getCount()) || ng24StringCompare(a.tag, b.tag);
    return ng24StringCompare(a.tag, b.tag);
  };

  /** Rebuilds root.vChildren from metadataCache tags, honouring filter+sort. */
  proto.rebuild = function () {
    const view = this.view;
    const app = view.app;
    const ItemClass = ng24TagPaneItemClass || (ng24TagPaneItemClass = ng24DefineTagPaneItem(host));
    const tags = app.metadataCache.getTags ? app.metadataCache.getTags() : {};
    const filter = (this.filter || "").toLowerCase();
    const entries = [];
    for (const key of Object.keys(tags)) {
      const raw = key.charAt(0) === "#" ? key.slice(1) : key;
      if (!raw || (filter && raw.toLowerCase().indexOf(filter) < 0)) continue;
      const count = typeof tags[key] === "number" ? tags[key] : 1;
      entries.push({ tag: raw, count });
    }
    entries.sort((a, b) => ng24StringCompare(a.tag, b.tag));
    const root = view.tree.root;
    root.vChildren.clear();
    const nodes = new Map(); // path -> item
    const getNode = (path, count) => {
      let item = nodes.get(path);
      if (!item) {
        item = new ItemClass(view, path, 0);
        nodes.set(path, item);
      }
      if (count) item.count = count;
      return item;
    };
    for (const { tag, count } of entries) {
      const parts = tag.split("/");
      let parent = root;
      let acc = "";
      for (let i = 0; i < parts.length; i++) {
        acc = acc ? acc + "/" + parts[i] : parts[i];
        const leaf = i === parts.length - 1;
        const item = getNode(acc, leaf ? count : 0);
        if (parent.vChildren.children.indexOf(item) < 0) parent.vChildren.addChild(item);
        if (item.vChildren.children.length || !leaf) item.setCollapsible(true);
        parent = item;
      }
    }
    // sort recursively
    const sortRec = (owner) => {
      const list = owner.vChildren ? owner.vChildren.children : [];
      list.sort((a, b) => this.compare(a, b));
      for (const item of list) sortRec(item);
    };
    sortRec(root);
    view.tree.infinityScroll.invalidateAll();
  };

  return TagPaneTree;
}

let ng24TagPaneItemClass = null;

// ---------------------------------------------------------------------------
// TagPaneView (bee): the "tag" workspace leaf.
// ---------------------------------------------------------------------------

export function ng24DefineTagPaneView(host) {
  function TagPaneView(leaf) {
    const self = host.ItemView.call(this, leaf) || this;
    self.app = leaf.app;
    self.icon = "lucide-tag";
    self.navigation = true;
    self.path = "";
    self._sortMode = NG24_TAG_SORT_KEYS[0];
    self.scope = new host.Scope(self.app.scope);
    self._rebuild = debounceCall(() => self.tagTree && self.tagTree.rebuild(), 100);
    return self;
  }
  inherit(TagPaneView, host.ItemView);
  const proto = TagPaneView.prototype;

  Object.defineProperty(proto, "VIEW_TYPE", { get() { return "tag"; } });
  proto.getViewType = function () { return "tag"; };
  proto.getDisplayText = function () { return "Tags"; };
  proto.getIcon = function () { return "lucide-tag"; };

  proto.onload = function () {
    host.ItemView.prototype.onload.call(this);
    // search box in the header area
    const searchWrap = this.contentEl.createDiv({ cls: "search-input-container tag-pane-search" });
    this.searchComponent = new host.SearchComponent(searchWrap, (query) => {
      if (this.tagTree) { this.tagTree.filter = query || ""; this.tagTree.rebuild(); }
    });
    const treeEl = this.contentEl.createDiv({ cls: "tree-container tag-pane-tree" });
    this.tagTree = new (ng24DefineTagPaneTree(host))(this);
    this.tree = new host.Tree(this, {
      app: this.app,
      containerEl: treeEl,
      id: "tag-pane",
      scope: this.scope,
      getNodeId: (item) => "tag-" + (item.tag || ""),
      handleCollapseAll: (collapsed) => {},
    });
    this.registerEvent(this.app.metadataCache.on("changed", this._rebuild));
    this.registerEvent(this.app.metadataCache.on("resolved", this._rebuild));
    this.tagTree.rebuild();
    this.tree.loadFolds && this.tree.loadFolds();
  };

  proto.getState = function () {
    const state = host.ItemView.prototype.getState.call(this);
    state.sortMode = this._sortMode;
    return state;
  };

  proto.setState = async function (state, result) {
    if (state && state.sortMode) this._sortMode = state.sortMode;
    return host.ItemView.prototype.setState.call(this, state, result);
  };

  proto.setSortMode = function (mode) {
    this._sortMode = mode;
    if (this.tagTree) { this.tagTree.sortMode = mode; this.tagTree.rebuild(); }
    this.app.workspace.requestSaveLayout && this.app.workspace.requestSaveLayout();
  };

  proto.onPaneMenu = function (menu, source) {
    host.ItemView.prototype.onPaneMenu.call(this, menu, source);
    menu.addSeparator();
    for (const mode of NG24_TAG_SORT_KEYS) {
      menu.addItem((item) => item
        .setTitle(mode === "alphabetical" ? "Alphabetical" : mode === "reverseAlphabetical" ? "Reverse alphabetical" : mode === "frequency" ? "Frequency" : "Reverse frequency")
        .setChecked(this._sortMode === mode)
        .onClick(() => this.setSortMode(mode)));
    }
  };

  proto.onClose = function () {
    host.ItemView.prototype.onClose.call(this);
    this.tree && this.tree.saveFolds && this.tree.saveFolds();
  };

  return TagPaneView;
}

export const defineTagPaneItem = ng24DefineTagPaneItem;
export const defineTagPaneTree = ng24DefineTagPaneTree;
export const defineTagPaneView = ng24DefineTagPaneView;
