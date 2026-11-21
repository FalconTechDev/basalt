// g40 clean-room: workspace layout tree, part 1 — WorkspaceItem (leaf DOM node).
// Owns containerEl, id, dimension, resize handle, parent bookkeeping helpers.
import { inherit } from "./inherit.js";
import { randomHex } from "./misc.js";

export function ng40DefineWorkspaceItem(host) {
  function WorkspaceItem(workspace, id) {
    host.Events.call(this);
    const self = this;
    self.workspace = workspace;
    self.app = workspace.app;
    self.id = id || randomHex(16);
    self.parent = null;
    self.dimension = null;
    self.component = new host.Component();
    self.component.load();
    self.containerEl = createDiv();
    self.resizeHandleEl = createEl("hr", "workspace-leaf-resize-handle");
    self.containerEl.appendChild(self.resizeHandleEl);
    self.resizeHandleEl.addEventListener("mousedown", (event) => self.onResizeStart(event));
    return self;
  }
  inherit(WorkspaceItem, host.Events);
  const proto = WorkspaceItem.prototype;

  proto.serialize = function () {
    const data = { id: this.id, type: this.type };
    if (this.dimension != null) data.dimension = this.dimension;
    return data;
  };

  proto.setParent = function (p) { this.parent = p; };

  proto.getRoot = function () {
    let node = this;
    while (node.parent) node = node.parent;
    return node;
  };

  proto.getContainer = function () {
    let node = this;
    while (node) {
      if (node instanceof host.WorkspaceContainer) return node;
      node = node.parent;
    }
    return (this.workspace && this.workspace.rootSplit) || this;
  };

  Object.defineProperty(proto, "parentSplit", {
    get() { return this.parent; },
    enumerable: true,
    configurable: true,
  });

  proto.setDimension = function (percent) {
    if (percent != null && (percent <= 0 || percent >= 100)) percent = null;
    this.dimension = percent;
    this.containerEl.style.flexGrow = percent == null ? "" : String(percent);
  };

  proto.detach = function () {
    if (this.parent) this.parent.removeChild(this);
  };

  proto.getIcon = function () { return "lucide-file"; };

  proto.onResizeStart = function (event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const parent = this.parent;
    if (parent && typeof parent.onChildResizeStart === "function") {
      parent.onChildResizeStart(this, event);
    }
  };

  return WorkspaceItem;
}
