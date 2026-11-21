// g40 clean-room: workspace layout tree, part 3 — WorkspaceSplit (row/column with
// draggable dividers), WorkspaceContainer (window top), WorkspaceRoot (main root).
import { inherit } from "./inherit.js";

const ng40MinPaneSize = 200;

export function ng40DefineWorkspaceSplit(host) {
  function WorkspaceSplit(workspace, direction, id) {
    const self = host.WorkspaceParent.call(this, workspace, id) || this;
    self.type = "split";
    self.direction = direction;
    self.resizeStartPos = null;
    self.originalSizes = null;
    self.isResizing = false;
    self.containerEl.addClass("workspace-split");
    self.containerEl.addClass("mod-" + direction);
    return self;
  }
  inherit(WorkspaceSplit, host.WorkspaceParent);
  const proto = WorkspaceSplit.prototype;

  proto.serialize = function () {
    const data = host.WorkspaceParent.prototype.serialize.call(this);
    data.direction = this.direction;
    return data;
  };

  proto.setDirection = function (direction) {
    this.containerEl.removeClass("mod-" + this.direction);
    this.direction = direction;
    this.containerEl.addClass("mod-" + direction);
  };

  proto.recomputeChildrenDimensions = function () {
    const children = this.children;
    let sum = 0;
    let allNumeric = children.length > 0;
    for (const child of children) {
      if (child.dimension == null || Number.isNaN(child.dimension)) allNumeric = false;
      else sum += child.dimension;
    }
    if (!allNumeric || Number.isNaN(sum)) {
      for (const child of children) child.setDimension(null);
    } else {
      for (const child of children) child.setDimension((100 * child.dimension) / sum);
    }
    this.workspace.requestResize();
  };

  proto.getElSize = function (el) {
    return this.direction === "vertical" ? el.offsetWidth : el.offsetHeight;
  };

  proto.setElSize = function (el, px) {
    if (this.direction === "vertical") el.style.width = px + "px";
    else el.style.height = px + "px";
    el.style.flex = "0 0 auto";
  };

  proto.unsetElSize = function (el) {
    el.style.width = "";
    el.style.height = "";
    el.style.flex = "";
  };

  // Distribute `diff` px across `items`: sign > 0 shrinks them toward the minimum
  // pane size, sign < 0 grows them. Returns the px actually applied.
  proto.resizeItemsByDiff = function (items, diff, sign) {
    if (!items || items.length === 0 || !diff) return 0;
    const sizes = items.map((item) => this.getElSize(item.containerEl));
    const targets = sizes.slice();
    let remaining = Math.abs(diff);
    if (sign < 0) {
      const share = remaining / items.length;
      for (let i = 0; i < items.length; i++) targets[i] += share;
      remaining = 0;
    } else {
      let active = items.map((_, i) => i);
      while (remaining > 0.5 && active.length > 0) {
        const share = remaining / active.length;
        const next = [];
        for (const i of active) {
          const room = Math.max(0, sizes[i] - ng40MinPaneSize);
          const take = Math.min(share, room);
          if (take <= 0) continue;
          targets[i] -= take;
          remaining -= take;
          if (targets[i] > ng40MinPaneSize + 0.5) next.push(i);
        }
        if (next.length === active.length && remaining > 0.5) {
          // no progress possible beyond rounding
          if (active.every((i) => sizes[i] - targets[i] >= sizes[i] - ng40MinPaneSize - 0.5)) break;
        }
        active = next;
      }
    }
    let applied = 0;
    for (let i = 0; i < items.length; i++) {
      if (targets[i] === sizes[i]) continue;
      applied += Math.abs(targets[i] - sizes[i]);
      this.setElSize(items[i].containerEl, targets[i]);
    }
    return applied;
  };

  proto.onChildResizeStart = function (child, downEvent) {
    if (downEvent.button !== 0) return;
    const win = downEvent.win || window;
    const doc = win.document || document;
    const vertical = this.direction === "vertical";
    const startPos = vertical ? downEvent.clientX : downEvent.clientY;
    this.resizeStartPos = startPos;
    this.isResizing = true;
    doc.body.addClass("is-grabbing");
    const onMove = (event) => {
      const pos = vertical ? event.clientX : event.clientY;
      const delta = pos - startPos;
      if (!this.originalSizes) {
        this.originalSizes = this.children.map((c) => this.getElSize(c.containerEl));
      }
      const index = this.children.indexOf(child);
      const before = this.children.slice(0, index).reverse();
      const after = this.children.slice(index + 1);
      if (delta > 0) {
        const absorbed = this.resizeItemsByDiff(after, delta, 1);
        const leftover = delta - absorbed;
        if (leftover > 0) this.resizeItemsByDiff(before, leftover, -1);
      } else if (delta < 0) {
        const d = -delta;
        const absorbed = this.resizeItemsByDiff(before, d, 1);
        const leftover = d - absorbed;
        if (leftover > 0) this.resizeItemsByDiff(after, leftover, -1);
      }
      event.preventDefault();
    };
    const onUp = (event) => {
      if (event.button !== 0) return;
      win.removeEventListener("mousemove", onMove);
      win.removeEventListener("mouseup", onUp);
      doc.body.removeClass("is-grabbing");
      try {
        this.finishResize();
      } catch (e) {
        console.error(e);
      }
    };
    win.addEventListener("mousemove", onMove);
    win.addEventListener("mouseup", onUp);
  };

  proto.finishResize = function () {
    this.isResizing = false;
    this.resizeStartPos = null;
    this.originalSizes = null;
    const sizes = this.children.map((child) => this.getElSize(child.containerEl));
    const total = sizes.reduce((a, b) => a + b, 0);
    this.children.forEach((child, i) => {
      this.unsetElSize(child.containerEl);
      child.setDimension(total > 0 ? (sizes[i] / total) * 100 : null);
    });
    this.workspace.requestSaveLayout();
    this.workspace.requestResize();
  };

  return WorkspaceSplit;
}

export function ng40DefineWorkspaceContainer(host) {
  function WorkspaceContainer(workspace, direction, id) {
    const self = host.WorkspaceSplit.call(this, workspace, direction, id) || this;
    self.allowSingleChild = true;
    return self;
  }
  inherit(WorkspaceContainer, host.WorkspaceSplit);
  const proto = WorkspaceContainer.prototype;

  proto.onFocus = function () {
    const self = this;
    setTimeout(() => {
      const doc = self.doc || document;
      if (typeof doc.hasFocus === "function" && !doc.hasFocus()) return;
      const modalOpen = !!doc.querySelector(".modal-container");
      const active = self.workspace.activeLeaf;
      if (active) {
        let node = active;
        while (node) {
          if (node === self) return;
          node = node.parent;
        }
      }
      const leaf = self.workspace.getMostRecentLeaf(self);
      if (leaf) self.workspace.setActiveLeaf(leaf, { focus: !host.Platform.isMobile && !modalOpen });
    }, 100);
  };

  proto.focus = function () {
    if (!host.Platform.isDesktopApp) return;
    const win = this.win || window;
    const doc = this.doc || document;
    if (typeof doc.hasFocus === "function" && doc.hasFocus()) return;
    const eWin = win.electronWindow;
    if (!eWin) return;
    if (eWin.isMinimized && eWin.isMinimized()) eWin.restore();
    eWin.focus();
  };

  return WorkspaceContainer;
}

export function ng40DefineWorkspaceRoot(host) {
  function WorkspaceRoot(workspace, direction, id) {
    const self = host.WorkspaceContainer.call(this, workspace, direction, id) || this;
    self.win = window;
    self.doc = document;
    self.containerEl.addClass("mod-root");
    return self;
  }
  inherit(WorkspaceRoot, host.WorkspaceContainer);
  return WorkspaceRoot;
}
