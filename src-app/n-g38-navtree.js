// g38 clean-room: publish "Navigation preview" modal + nav tree (spec g38 Part 4).
// Tree item classes over env().eI (tree) and env().JL (item); deterministic
// nav-order rebuild that emits only sibling groups whose canonical order differs;
// hidden-item context menu; settings modal with reset buttons.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { lastSegment, parentPath } from "./path.js";
import { ng19SortTreeItems } from "./n-g19-graph-util.js";

const ng38NavBags = new WeakMap(); // host -> {item, folder, file, tree, modal}
function ng38NavBag(host) {
  let bag = ng38NavBags.get(host);
  if (!bag) { bag = {}; ng38NavBags.set(host, bag); }
  return bag;
}

function ng38ElShow(el) { if (typeof el.show === "function") el.show(); else el.style.display = ""; }
function ng38ElHide(el) { if (typeof el.hide === "function") el.hide(); else el.style.display = "none"; }

function ng38BuildNavItem(host) {
  function PublishNavItem(tree, path) {
    env().JL.call(this);
    this.hidden = false;
    this.tree = tree;
    this.name = lastSegment(path);
    this.path = path;
    this.el.classList.add("mod-custom-nav");
    this.selfEl.addEventListener("contextmenu", (event) => this.onContextMenu(event));
  }
  inherit(PublishNavItem, env().JL);

  PublishNavItem.prototype.onContextMenu = function (event) {
    const item = this;
    const menu = new host.Menu();
    menu.addItem((menuItem) => {
      menuItem
        .setTitle(host.i18n.plugins.publish.optionHideInNavigation())
        .setChecked(item.hidden)
        .onClick(() => {
          item.hidden = !item.hidden;
          const hiddenItems = item.tree.hiddenItems;
          if (item.hidden) hiddenItems.push(item.path);
          else if (typeof hiddenItems.remove === "function") hiddenItems.remove(item.path);
          else {
            const at = hiddenItems.indexOf(item.path);
            if (at >= 0) hiddenItems.splice(at, 1);
          }
          if (item.tree.visibilityChangeCb) item.tree.visibilityChangeCb(hiddenItems);
          item.render();
        });
    });
    menu.showAtMouseEvent(event);
  };

  PublishNavItem.prototype.render = function () {
    this.el.classList.toggle("hidden", this.hidden);
    if (!this.hidden || this.tree.showHidden) {
      ng38ElShow(this.el);
      env().JL.prototype.render.call(this);
      const parent = this.parent;
      const siblingsEl = (parent && parent.childrenEl) || this.tree.childrenEl;
      host.makeDragReorderable(this.selfEl, this.el, siblingsEl, 10, () => {}, (index) => {
        const siblings = (parent && parent.children) || this.tree.children;
        const at = siblings.indexOf(this);
        if (at >= 0) siblings.splice(at, 1);
        siblings.splice(index, 0, this);
        this.tree.rebuildNavOrder();
      });
    } else {
      ng38ElHide(this.el);
    }
  };

  return PublishNavItem;
}

function ng38BuildNavFolder(host) {
  const Item = ng38PublishNavItem(host);
  function PublishNavFolderItem(tree, path) {
    Item.call(this, tree, path);
    this.type = "folder";
    this.children = [];
    this.selfEl.classList.add("mod-folder");
    this.setCollapsible(true);
    this.setClickable(true);
    this.setCollapsed(true, false);
    const doc = this.innerEl.ownerDocument || document;
    const title = doc.createElement("div");
    title.className = "file-tree-item-title";
    title.textContent = this.name;
    this.innerEl.appendChild(title);
  }
  inherit(PublishNavFolderItem, Item);
  PublishNavFolderItem.prototype.onSelfClick = function () {
    this.toggleCollapsed(true);
  };
  return PublishNavFolderItem;
}

function ng38BuildNavFile(host) {
  const Item = ng38PublishNavItem(host);
  function PublishNavFileItem(tree, path) {
    Item.call(this, tree, path);
    this.type = "file";
    const doc = this.innerEl.ownerDocument || document;
    const title = doc.createElement("div");
    title.className = "tree-item-title";
    title.textContent = lastSegment(path);
    this.innerEl.appendChild(title);
  }
  inherit(PublishNavFileItem, Item);
  PublishNavFileItem.prototype.render = function () {
    Item.prototype.render.call(this);
    this.setCollapsible(false);
    this.setClickable(true);
  };
  return PublishNavFileItem;
}

// A sibling group "would change" when the canonical sort (folders first, then
// name via env().ub, ranks ignored) differs from the current order.
function ng38GroupChanged(group) {
  const sorted = group.slice();
  ng19SortTreeItems(sorted, {}, false);
  return sorted.some((item, i) => item !== group[i]);
}

function ng38EmitGroup(order, group) {
  for (const item of group) {
    order.push(item.path);
    if (item.type === "folder" && Array.isArray(item.children) && item.children.length) {
      ng38EmitGroup(order, item.children);
    }
  }
}

function ng38RebuildGroup(order, group) {
  if (ng38GroupChanged(group)) {
    ng38EmitGroup(order, group);
    return;
  }
  for (const item of group) {
    if (item.type === "folder" && Array.isArray(item.children) && item.children.length) {
      ng38RebuildGroup(order, item.children);
    }
  }
}

function ng38BuildNavTree(host) {
  function PublishNavTree(plugin, containerEl, navOrder, hiddenItems) {
    env().eI.call(this, containerEl);
    this.children = [];
    this.showHidden = false;
    this.hiddenItems = hiddenItems;
    this.navOrder = navOrder;
    this.folders = {};
    this.files = {};
    this.publish = plugin;
    const doc = containerEl.ownerDocument || document;
    const wrap = doc.createElement("div");
    wrap.className = "tree-list-container";
    containerEl.appendChild(wrap);
    const header = doc.createElement("div");
    header.className = "tree-list-header";
    wrap.appendChild(header);
    const title = doc.createElement("div");
    title.className = "tree-list-title";
    title.textContent = host.i18n.plugins.publish.labelNavigationPreview();
    header.appendChild(title);
    const label = doc.createElement("label");
    label.className = "tree-list-action mod-checkbox";
    header.appendChild(label);
    const box = doc.createElement("input");
    box.type = "checkbox";
    box.tabIndex = -1;
    label.appendChild(box);
    box.addEventListener("click", () => this.setShowHidden(!this.showHidden));
    label.appendChild(doc.createTextNode(host.i18n.plugins.publish.optionShowHiddenItems()));
    this.childrenEl = doc.createElement("div");
    this.childrenEl.className = "tree-list";
    wrap.appendChild(this.childrenEl);
  }
  inherit(PublishNavTree, env().eI);

  PublishNavTree.prototype.setShowHidden = function (show) {
    this.showHidden = show;
    this.render();
  };

  PublishNavTree.prototype.addChild = function (item) {
    const parent = parentPath(item.path);
    if (!parent) {
      this.addRoot(item);
      return;
    }
    let folder = this.folders[parent];
    if (!folder) {
      folder = new (ng38PublishNavFolderItem(host))(this, parent);
      this.folders[parent] = folder;
      this.addChild(folder);
    }
    folder.children.push(item);
    item.parent = folder;
  };

  PublishNavTree.prototype.createItem = function (path) {
    const item = new (ng38PublishNavFileItem(host))(this, path);
    this.files[path] = item;
    this.addChild(item);
    return item;
  };

  PublishNavTree.prototype.rebuildNavOrder = function () {
    const order = [];
    ng38RebuildGroup(order, this.children);
    this.navOrder = order;
    if (this.orderChangeCb) this.orderChangeCb(order);
    return order;
  };

  PublishNavTree.prototype.render = function () {
    const ranks = {};
    for (let i = 0; i < (this.navOrder || []).length; i++) ranks[this.navOrder[i]] = i;
    ng19SortTreeItems(this.children, ranks);
    const hidden = this.hiddenItems || [];
    const mark = (items) => {
      for (const item of items) {
        item.hidden = hidden.includes(item.path);
        if (item.type === "folder" && Array.isArray(item.children)) mark(item.children);
      }
    };
    mark(this.children);
    env().eI.prototype.render.call(this);
  };

  return PublishNavTree;
}

function ng38BuildNavModal(host) {
  function PublishNavModal(app, plugin, paths, navOrder, hiddenItems) {
    const self = host.Modal.call(this, app) || this;
    self.plugin = plugin;
    self.modalEl.classList.add("mod-scrollable-content");
    self.titleEl.textContent = host.i18n.plugins.publish.labelNavigationModalTitle();
    const doc = self.contentEl.ownerDocument || document;
    const mkSetting = (name, desc, onReset) => {
      new host.Setting(self.contentEl)
        .setName(name)
        .setDesc(desc)
        .addExtraButton((btn) => {
          btn.setIcon("lucide-rotate-ccw")
            .setTooltip(host.i18n.setting.hotkeys.tooltipRestoreDefault())
            .onClick(onReset);
        });
    };
    mkSetting(
      host.i18n.plugins.publish.optionNavigationOrder(),
      host.i18n.plugins.publish.labelNavigationModalDesc(),
      () => {
        self.tree.navOrder = [];
        if (self.tree.orderChangeCb) self.tree.orderChangeCb([]);
        self.tree.render();
      }
    );
    self.tree = new (ng38PublishNavTree(host))(plugin, self.contentEl, navOrder, hiddenItems);
    for (const path of paths) self.tree.createItem(path);
    self.tree.render();
    mkSetting(
      host.i18n.plugins.publish.optionHideItemsInNavigation(),
      host.i18n.plugins.publish.optionHideItemsInNavigationDesc(),
      () => {
        self.tree.hiddenItems = [];
        if (self.tree.visibilityChangeCb) self.tree.visibilityChangeCb([]);
        self.tree.render();
      }
    );
    const bc = typeof self.modalEl.createDiv === "function"
      ? self.modalEl.createDiv("modal-button-container")
      : (() => {
        const el = doc.createElement("div");
        el.className = "modal-button-container";
        self.modalEl.appendChild(el);
        return el;
      })();
    const done = doc.createElement("button");
    done.textContent = host.i18n.dialogue.buttonDone();
    done.addEventListener("click", () => self.close());
    bc.appendChild(done);
    return self;
  }
  inherit(PublishNavModal, host.Modal);

  PublishNavModal.prototype.onOrderChange = function (cb) {
    this.tree.orderChangeCb = cb;
    return this;
  };

  PublishNavModal.prototype.onVisibilityChange = function (cb) {
    this.tree.visibilityChangeCb = cb;
    return this;
  };

  return PublishNavModal;
}

export function ng38PublishNavItem(host) {
  const bag = ng38NavBag(host);
  if (!bag.item) bag.item = ng38BuildNavItem(host);
  return bag.item;
}
export function ng38PublishNavFolderItem(host) {
  const bag = ng38NavBag(host);
  if (!bag.folder) bag.folder = ng38BuildNavFolder(host);
  return bag.folder;
}
export function ng38PublishNavFileItem(host) {
  const bag = ng38NavBag(host);
  if (!bag.file) bag.file = ng38BuildNavFile(host);
  return bag.file;
}
export function ng38PublishNavTree(host) {
  const bag = ng38NavBag(host);
  if (!bag.tree) bag.tree = ng38BuildNavTree(host);
  return bag.tree;
}
export function ng38PublishNavModal(host) {
  const bag = ng38NavBag(host);
  if (!bag.modal) bag.modal = ng38BuildNavModal(host);
  return bag.modal;
}

// Test-facing aliases for the legacy module contract.
export { ng38PublishNavItem as s35PublishNavItem, ng38PublishNavFolderItem as s35PublishNavFolderItem, ng38PublishNavFileItem as s35PublishNavFileItem, ng38PublishNavTree as s35PublishNavTree, ng38PublishNavModal as s35PublishNavModal };
