// g34 clean-room: small DOM tree-item classes (spec g34 part A).
// Children-capable mixin, collapsible/render item factories and a tree
// container used by publish/outline/PDF-sidebar trees.
import { ng15CollapsibleTreeItem } from "./n-g15-tree.js";

// In-place mount of child elements; falls back to plain DOM ops.
function ng34MountChildrenEl(el, els) {
  if (el.setChildrenInPlace) {
    el.setChildrenInPlace(els);
    return;
  }
  while (el.firstChild) el.firstChild.remove();
  for (const e of els) el.appendChild(e);
}

function ng34MountItemChildren(item) {
  const children = item.children;
  if (!Array.isArray(children)) {
    ng34MountChildrenEl(item.childrenEl, []);
    return;
  }
  ng34MountChildrenEl(item.childrenEl, children.map((c) => c.el));
  for (const c of children) c.render();
}

// Mixin: collapsible tree item that renders an array of child items.
export function ng34ChildrenMixin(Base) {
  const Collapsible = ng15CollapsibleTreeItem(Base);
  class Ng34ChildrenItem extends Collapsible {
    constructor(...args) {
      super(...args);
      this.children = null;
    }
    render() {
      ng34MountItemChildren(this);
    }
  }
  return Ng34ChildrenItem;
}

// Collapsible item with no render of its own.
export function ng34DefineCollapsibleItem(host) {
  const Collapsible = ng15CollapsibleTreeItem(host.TreeItem);
  class Ng34CollapsibleItem extends Collapsible {}
  return Ng34CollapsibleItem;
}

// TreeItem whose render() is a deliberate no-op.
export function ng34DefineRenderItem(host) {
  class Ng34RenderItem extends host.TreeItem {
    render() {}
  }
  return Ng34RenderItem;
}

// Collapsible item with children rendering (folder rows).
export function ng34DefineChildrenItem(host) {
  return ng34ChildrenMixin(host.TreeItem);
}

// Container of root items bound to a children element.
export function ng34DefineTreeContainer() {
  return class Ng34TreeContainer {
    constructor(childrenEl) {
      this.childrenEl = childrenEl;
      this.children = [];
    }
    render() {
      ng34MountChildrenEl(this.childrenEl, this.children.map((c) => c.el));
      for (const c of this.children) c.render();
    }
    addRoot(item) {
      this.children.push(item);
    }
    clear() {
      this.children.length = 0;
      this.render();
    }
  };
}
