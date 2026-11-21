// g40 clean-room: workspace layout tree, part 2 — WorkspaceParent (node with children).
// insert/replace/remove with DOM bookkeeping, single-child collapse, empty removal.
import { inherit } from "./inherit.js";

export function ng40DefineWorkspaceParent(host) {
  function WorkspaceParent(workspace, id) {
    const self = host.WorkspaceItem.call(this, workspace, id) || this;
    self.children = [];
    self.allowSingleChild = false;
    self.autoManageDOM = true;
    return self;
  }
  inherit(WorkspaceParent, host.WorkspaceItem);
  const proto = WorkspaceParent.prototype;

  proto.serialize = function () {
    const data = host.WorkspaceItem.prototype.serialize.call(this);
    data.children = this.children.map((child) => child.serialize());
    return data;
  };

  proto.recomputeChildrenDimensions = function () {};

  proto.insertChild = function (index, node) {
    if (node.parent && node.parent !== this) node.parent.removeChild(node);
    index = Math.min(Math.max(0, index), this.children.length);
    this.children.splice(index, 0, node);
    node.setParent(this);
    if (this.autoManageDOM) {
      const next = this.children[index + 1];
      if (next) this.containerEl.insertBefore(node.containerEl, next.containerEl);
      else this.containerEl.appendChild(node.containerEl);
    }
    this.workspace.onLayoutChange(this);
  };

  proto.replaceChild = function (index, node) {
    index = Math.min(Math.max(0, index), this.children.length - 1);
    const old = this.children[index];
    old.setParent(null);
    old.containerEl.remove();
    this.children[index] = node;
    node.setParent(this);
    if (this.autoManageDOM) {
      const next = this.children[index + 1];
      if (next) this.containerEl.insertBefore(node.containerEl, next.containerEl);
      else this.containerEl.appendChild(node.containerEl);
    }
    this.workspace.onLayoutChange(this);
  };

  proto.removeChild = function (node) {
    const index = this.children.indexOf(node);
    if (index === -1) return;
    this.children.splice(index, 1);
    node.setParent(null);
    if (this.autoManageDOM) node.containerEl.remove();
    const parent = this.parent;
    if (!parent) {
      this.workspace.onLayoutChange(this);
      return;
    }
    if (this.children.length === 0) {
      parent.removeChild(this);
      return;
    }
    if (this.children.length === 1 && !this.allowSingleChild) {
      const survivor = this.children[0];
      this.children.splice(0, 1);
      parent.replaceChild(parent.children.indexOf(this), survivor);
      survivor.setDimension(this.dimension);
      this.workspace.onLayoutChange(this);
      return;
    }
    this.workspace.onLayoutChange(this);
  };

  return WorkspaceParent;
}
