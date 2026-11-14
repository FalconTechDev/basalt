// The generic tree widget behind the file explorer, bookmarks, the tag pane and the outline.
//
// A tree is made of items. Every item that can have children carries `vChildren` (the child list) and
// `childrenEl` (the DOM node the children are rendered into); `hasChildList` tells them apart from plain rows.
// `TreeRoot` is the sentinel root item; `InfinityScroll` only renders the rows near the viewport and moves
// the rest in and out of the DOM, so a vault with thousands of files stays cheap. `Tree` adds selection,
// keyboard navigation and persistence of the collapsed folders.
//
// The pieces, top to bottom: row item, child list, root sentinel, collapsible mixin, virtual scroller,
// the tree controller, then the small traversal / measurement / animation helpers they share.

import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { runTransition, cancelTransition } from "./animation.js";
import { floatOr } from "./text.js";

// =====================================================================================================================
// Traversal helpers (also exported for the per-view tree subclasses)
// =====================================================================================================================

/** Calls `visit` on every descendant of `item` (not on `item` itself). A truthy return from `visit` prunes that
 *  subtree; with `skipCollapsed` the children of collapsed items are not visited either. Always returns false. */
export function walkTree(item, visit, skipCollapsed = false) {
  if (!item) return false;
  for (const child of item.vChildren.children) {
    if (!visit(child) && hasChildList(child) && !(skipCollapsed && child.collapsed)) walkTree(child, visit, skipCollapsed);
  }
  return false;
}

/** True for items that can have children (they own a `vChildren` list and a `childrenEl` container). */
export function hasChildList(item) {
  return !!item && "vChildren" in item && "childrenEl" in item;
}

/** Every node of the subtree, `item` itself first (pre-order). */
export function walkTreeAll(item, visit) {
  visit(item);
  if (hasChildList(item) && item.childrenEl.parentNode) {
    for (const child of item.vChildren.children) walkTreeAll(child, visit);
  }
}

/** Path of child indices from the root down to `item` (used to compare tree positions). */
export function treeAncestorPath(item) {
  const path = [];
  for (let node = item; node.parent;) {
    path.push(node.parent.vChildren.children.indexOf(node));
    node = node.parent;
  }
  return path.reverse();
}

export function prevTreeSibling(item) {
  const siblings = item.parent.vChildren.children;
  const index = siblings.indexOf(item) - 1;
  return index >= 0 ? siblings[index] : null;
}

export function nextTreeSibling(item) {
  const siblings = item.parent.vChildren.children;
  const index = siblings.indexOf(item) + 1;
  return index < siblings.length ? siblings[index] : null;
}

/** The items between `a` and `b` in tree order (inclusive of the endpoints' neighbours, order not guaranteed). */
export function treeRange(a, b) {
  const [first, last] = orderTreePair(a, b);
  const range = [last];
  for (let item = first; item && item !== last; item = nextVisibleTreeItem(item, false)) range.push(item);
  return range;
}

function orderTreePair(a, b) {
  const pathA = treeAncestorPath(a);
  const pathB = treeAncestorPath(b);
  for (let i = 0; i < pathA.length; i++) {
    const indexA = pathA[i];
    const indexB = pathB[i];
    if (indexB === undefined) return [b, a];
    if (indexA !== indexB) return indexA <= indexB ? [a, b] : [b, a];
  }
  return [a, b];
}

/** The next item a user would land on when moving down (into children, then across, skipping hidden rows). */
export function nextVisibleTreeItem(item, skipCollapsed) {
  for (; item;) {
    if (!hasChildList(item) || (skipCollapsed && item.collapsed) || !item.vChildren.hasChildren()) {
      let found = false;
      while (item && item.parent && !found) {
        const sibling = nextTreeSibling(item);
        if (sibling) { item = sibling; found = true; } else item = item.parent;
      }
    } else {
      item = item.vChildren.children[0];
    }
    if (item && !item.info.hidden) return item.parent ? item : null;
  }
  return null;
}

/** The previous visible item (mirrors nextVisibleTreeItem). */
export function prevVisibleTreeItem(item, skipCollapsed) {
  for (; item;) {
    if (!item || !item.parent) return null;
    if (item.parent.vChildren.children.indexOf(item) === 0) item = item.parent;
    else item = lastVisibleTreeItem(prevTreeSibling(item), skipCollapsed);
    if (item && !item.info.hidden) return item;
  }
  return null;
}

/** The deepest last child chain of `item`, skipping hidden rows and stopping at collapsed subtrees when asked. */
export function lastVisibleTreeItem(item, skipCollapsed) {
  if (!item) return null;
  let node = item;
  if (hasChildList(node)) {
    const blocked = skipCollapsed && node.collapsed;
    while (!blocked && hasChildList(node) && node.vChildren.hasChildren()) node = node.vChildren.last();
  }
  while (node.info.hidden) node = prevVisibleTreeItem(node, true);
  // climb out of collapsed ancestors: the row a user actually sees is the outermost one under a collapsed parent
  while (node.parent && node.parent.collapsed) node = node.parent;
  return node;
}

// =====================================================================================================================
// Small DOM / scheduling helpers
// =====================================================================================================================

/** The spacer element that reserves the height of the rows not currently rendered. */
export function makeTreePusher() {
  const el = createDiv();
  el.style.width = "1px";
  el.style.height = "0.1px";
  el.style.marginBottom = "0";
  return el;
}

/** Runs `fn` when the main thread is idle (or after `timeout` ms at the latest); returns { cancel }. */
export function scheduleIdle(fn, timeout) {
  const win = activeWindow;
  if (timeout > 0 && win.requestIdleCallback) {
    let done = false;
    const handle = win.requestIdleCallback(() => {
      done = true;
      win.clearTimeout(fallback);
      fn();
    }, { timeout });
    const fallback = win.setTimeout(() => {
      done = true;
      win.cancelIdleCallback(handle);
      fn();
    }, timeout);
    return {
      high: false,
      cancel() { if (!done) { done = true; win.cancelIdleCallback(handle); win.clearTimeout(fallback); } },
    };
  }
  const frame = win.requestAnimationFrame(fn);
  return { high: true, cancel() { win.cancelAnimationFrame(frame); } };
}

/** The box of `el` relative to `until` (scroll offsets of intermediate containers subtracted). */
export function offsetBox(el, until) {
  const elWidth = el.offsetWidth;
  let parentWidth = elWidth;
  let top = 0;
  let left = 0;
  const boundary = until ? until.offsetParent : null;
  for (let node = el; node && node !== until && node !== boundary;) {
    top += node.offsetTop;
    left += node.offsetLeft;
    const offsetParent = node.offsetParent;
    for (let p = node.parentElement; p && p !== offsetParent;) {
      top -= p.scrollTop;
      left -= p.scrollLeft;
      p = p.parentElement;
    }
    if (offsetParent && offsetParent !== boundary) {
      parentWidth = offsetParent.offsetWidth;
      if (offsetParent !== until) {
        top -= offsetParent.scrollTop;
        left -= offsetParent.scrollLeft;
      }
    }
    node = offsetParent;
  }
  return { top, left, right: parentWidth - left - elWidth };
}

const BOX_PROPS = { height: "", paddingTop: "", paddingBottom: "", marginTop: "", marginBottom: "" };

/** The non-zero pixel metrics of `el` for the properties in BOX_PROPS (used to animate a collapse). */
export function boxMetrics(el) {
  const style = window.getComputedStyle(el);
  const metrics = {};
  for (const name in BOX_PROPS) {
    if (!BOX_PROPS.hasOwnProperty(name)) continue;
    const value = style[name];
    if (value && value.endsWith("px")) {
      const size = parseFloat(value.slice(0, value.length - 2));
      if (size !== 0) metrics[name] = size;
    }
  }
  return metrics;
}

/** Height/padding/margin animation specs: shrink everything to 0 (closing) or grow back (opening). */
function collapseTransition(el, opening) {
  cancelTransition(el);
  const metrics = boxMetrics(el);
  const spec = { duration: 100, fn: "cubic-bezier(.02, .01, .47, 1)", from: {}, to: {}, end: {} };
  spec.from.overflowY = "clip";
  spec.to.overflowY = "clip";
  for (const name in metrics) {
    if (!metrics.hasOwnProperty(name)) continue;
    spec.from[name] = opening ? "0px" : metrics[name] + "px";
    spec.to[name] = opening ? metrics[name] + "px" : "0px";
    spec.end[name] = "";
  }
  spec.end.overflowY = "";
  // runTransition reads spec.from/to/end/duration/fn only; the object above is the same shape a Transition builds
  return new Promise((resolve) => runTransition(el, spec, resolve));
}

/** Animates `el` closed (all box metrics to 0). */
export function animateCollapse(el) {
  return collapseTransition(el, false);
}

/** Animates `el` open (all box metrics back to their natural size). */
export function expandFromZero(el) {
  return collapseTransition(el, true);
}

/** Shows or hides the children container of a collapsible item, with the height animation when `animate`. */
export async function mountChildren(childrenEl, itemEl, collapsed, animate) {
  if (collapsed) {
    if (animate) await animateCollapse(childrenEl);
    childrenEl.detach();
  } else {
    childrenEl.show();
    itemEl.appendChild(childrenEl);
    if (animate) await expandFromZero(childrenEl);
  }
}

/** Toggles the `is-collapsed` class on the item element and its collapse icon. */
export function markItemCollapsed(itemEl, collapsed) {
  itemEl.toggleClass("is-collapsed", collapsed);
  const icon = itemEl.find(".collapse-icon");
  if (icon) icon.toggleClass("is-collapsed", collapsed);
}

/** True when `node` is an input or a contenteditable element (tree keys must not fire while typing). */
export function isEditableNode(node) {
  return !!node && ("INPUT" === node.nodeName || (node.instanceOf(HTMLElement) && "true" === node.contentEditable));
}

/** A real KeyboardEvent with the modifiers of `event` overridden — used to replay a key without its modifiers. */
export function syntheticKeyEvent(event, overrides = {}) {
  return new KeyboardEvent(event.type, Object.assign({
    key: event.key,
    code: event.code,
    location: event.location,
    repeat: event.repeat,
    isComposing: event.isComposing,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    bubbles: event.bubbles,
    cancelable: event.cancelable,
    composed: event.composed,
  }, overrides));
}

// =====================================================================================================================
// Item classes
// =====================================================================================================================

/** The child list of a tree item (or of the root sentinel). */
export function defineTreeChildren() {
  function TreeChildren(owner) {
    this._children = [];
    this.owner = owner;
  }
  TreeChildren.prototype.addChild = function (item) {
    this._children.push(item);
    item.parent = this.owner;
  };
  TreeChildren.prototype.setChildren = function (items) {
    this.clear();
    for (const item of items) this.addChild(item);
  };
  TreeChildren.prototype.removeChild = function (item) {
    this._children.remove(item);
    item.parent = undefined;
  };
  TreeChildren.prototype.hasChildren = function () { return this._children.length > 0; };
  TreeChildren.prototype.first = function () { return this._children.first(); };
  TreeChildren.prototype.last = function () { return this._children.last(); };
  TreeChildren.prototype.size = function () { return this._children.length; };
  TreeChildren.prototype.sort = function (compare) { return this._children.sort(compare); };
  Object.defineProperty(TreeChildren.prototype, "children", {
    get() { return this._children; },
    enumerable: false,
    configurable: true,
  });
  TreeChildren.prototype.clear = function () { this._children = []; };
  return TreeChildren;
}

/** One row of a tree: the DOM (`el` / `selfEl` / `innerEl` / `coverEl`) and the click hook. */
export function defineTreeItem() {
  function TreeItem(el) {
    if (el) {
      this.el = el;
      this.selfEl = this.el.firstChild;
      this.innerEl = this.selfEl.firstChild;
      this.coverEl = this.selfEl;
      return;
    }
    this.el = createDiv("tree-item");
    const self = this.selfEl = this.el.createDiv("tree-item-self");
    self.addEventListener("click", (event) => {
      if (event.button === 0 && !event.defaultPrevented) this.onSelfClick(event);
    });
    self.addEventListener("auxclick", (event) => {
      if (event.button === 1 && !event.defaultPrevented) this.onSelfClick(event);
    });
    this.innerEl = self.createDiv("tree-item-inner");
    this.coverEl = this.selfEl;
  }
  TreeItem.prototype.onSelfClick = function () {};
  TreeItem.prototype.setClickable = function (clickable) {
    this.selfEl.toggleClass("is-clickable", clickable);
  };
  return TreeItem;
}

/** The sentinel root every tree hangs its top-level items on. */
export function defineTreeRoot(host) {
  function TreeRoot(el) {
    this.vChildren = new host.TreeChildren(this);
    this.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
    this.pusherEl = makeTreePusher();
    this.el = el;
    this.childrenEl = el.createDiv();
  }
  return TreeRoot;
}

/** Adds collapse/expand behaviour to a TreeItem subclass: a caret icon, `collapsed` state, children container. */
export function collapsibleTreeItem(Base) {
  function CollapsibleTreeItem() {
    const args = [];
    for (let i = 0; i < arguments.length; i++) args[i] = arguments[i];
    const self = Base.apply(this, args) || this;
    self.collapsible = false;
    self.collapsed = false;
    self.collapseEl = null;
    self.childrenEl = self.el.find(".tree-item-children") || self.el.createDiv("tree-item-children");
    return self;
  }
  inherit(CollapsibleTreeItem, Base);
  const proto = CollapsibleTreeItem.prototype;

  proto.onCollapseClick = function (event) {
    if (event.button === 0) {
      event.preventDefault();
      this.toggleCollapsed(true);
    }
  };

  proto.toggleCollapsed = function (animate) {
    if (this.collapsible) this.setCollapsed(!this.collapsed, animate);
  };

  proto.setCollapsed = function (collapsed, animate) {
    if (this.collapsed === collapsed) return;
    this.collapsed = collapsed;
    this.updateCollapsed(animate);
  };

  proto.setCollapsible = function (collapsible) {
    if (this.collapsible === collapsible) return;
    const selfEl = this.selfEl;
    let collapseEl = this.collapseEl;
    this.collapsible = collapsible;
    if (collapsible) {
      if (!collapseEl) {
        collapseEl = this.collapseEl = createDiv("tree-item-icon collapse-icon");
        __basaltHost.setIcon(collapseEl, "right-triangle");
        collapseEl.addEventListener("click", this.onCollapseClick.bind(this));
      }
      selfEl.prepend(collapseEl);
    } else if (collapseEl) {
      collapseEl.detach();
      this.collapseEl = null;
      this.collapsed = false;
    }
    selfEl.toggleClass("mod-collapsible", collapsible);
  };

  proto.updateCollapsed = async function (animate) {
    const itemEl = this.el;
    const childrenEl = this.childrenEl;
    const collapsed = this.collapsed;
    markItemCollapsed(itemEl, collapsed);
    await mountChildren(childrenEl, itemEl, collapsed, animate);
  };

  return CollapsibleTreeItem;
}

// =====================================================================================================================
// InfinityScroll: renders only the rows near the viewport
// =====================================================================================================================

export function defineInfinityScroll() {
  function InfinityScroll(scrollEl) {
    this.rootMargin = 0.25;
    this.renderBlockSize = 50;
    this.width = 0;
    this.height = 0;
    this.lastScroll = 0;
    this.queued = null;
    this.yScale = 1;
    this.rtl = getComputedStyle(scrollEl).direction === "rtl";
    const overflowX = getComputedStyle(scrollEl).overflowX;
    this.setWidth = overflowX === "auto" || overflowX === "scroll";
    scrollEl.style.position = "relative";
    scrollEl.addEventListener("scroll", this.onScroll.bind(this), { passive: true });
    scrollEl.onNodeInserted(() => this.queueCompute());
    this.scrollEl = scrollEl;
  }
  const proto = InfinityScroll.prototype;

  /** Marks `item` (or its whole subtree with `deep`) as needing layout again. */
  proto.invalidate = function (item, deep) {
    if (deep) walkTreeAll(item, (node) => { node.info.computed = false; });
    else item.info.computed = false;
    this.queueCompute();
  };

  proto.invalidateAll = function () {
    if (this.rootEl) {
      walkTreeAll(this.rootEl, (node) => { node.info.computed = false; });
      this.queueCompute();
    }
  };

  proto.onScroll = function () {
    const scrollEl = this.scrollEl;
    const last = this.lastScroll;
    const height = this.height;
    const top = scrollEl.scrollTop;
    if (Math.abs(last - top) > Math.max(height, 300) / 2) this.updateVirtualDisplay(top);
  };

  proto.onResize = function () {
    const scrollEl = this.scrollEl;
    if (scrollEl.offsetParent === null) return;
    this.height = scrollEl.clientHeight;
    const width = scrollEl.clientWidth;
    if (!this.setWidth || width === this.width) this.updateVirtualDisplay();
    else {
      this.width = width;
      this.invalidateAll();
    }
  };

  proto.queueCompute = function () {
    if (!this.queued) this.queued = scheduleIdle(() => this.compute(), 50);
  };

  /** Lays out the whole tree (or up to `limit` rows per pass) and refreshes the virtual window. */
  proto.compute = function (limitPasses) {
    if (this.queued) {
      this.queued.cancel();
      this.queued = null;
    }
    const scrollEl = this.scrollEl;
    const root = this.rootEl;
    if (!root) return;
    const scrollTop = scrollEl.scrollTop;
    if (scrollEl.offsetParent === null) return;
    const budget = { num: 0, limit: limitPasses ? 9999 : this.renderBlockSize, finished: true };
    this.precompute(root);
    this.layout(root, budget);
    const rootEl = root.el;
    const rect = rootEl.getBoundingClientRect();
    this.yScale = 1;
    if (Math.round(rect.height) !== rootEl.clientHeight) {
      const cssHeight = floatOr(rootEl.win.getComputedStyle(rootEl).height, 0);
      if (cssHeight !== 0) this.yScale = rect.height / cssHeight;
    }
    this.measureDeep(root);
    let allComputed = budget.finished;
    if (allComputed && hasChildList(root)) {
      for (const child of root.vChildren.children) {
        if (!child.info.computed) { allComputed = false; break; }
      }
    }
    root.info.computed = allComputed;
    this.updateVirtualDisplay(scrollTop);
    if (!allComputed) this.queueCompute();
  };

  proto.precompute = function (item) {
    if (hasChildList(item)) {
      const children = item.vChildren;
      const childrenEl = item.childrenEl;
      if (children.hasChildren() && childrenEl.parentNode) {
        const last = children.last();
        for (const child of children.children) {
          if (!this.precompute(child)) item.info.computed = false;
          const hasNext = child !== last;
          if (child.info.next !== hasNext) {
            child.info.next = hasNext;
            child.info.computed = false;
            item.info.computed = false;
          }
        }
      }
    }
    item.info.queued = false;
    return item.info.computed;
  };

  /** Decides which child rows must be in the DOM; returns true when everything below was already computed. */
  proto.layout = function (item, budget) {
    const info = item.info;
    if (info.computed) return false;
    if (budget.num >= budget.limit) {
      budget.finished = false;
      return false;
    }
    let allComputed = true;
    let progressed = false;
    if (hasChildList(item)) {
      const children = item.vChildren;
      const childrenEl = item.childrenEl;
      const pusher = item.pusherEl;
      if (childrenEl.parentNode) {
        pusher.style.marginBottom = "0";
        const inPlace = [pusher];
        let height = 0;
        let pendingHidden = false;
        for (const child of children.children) {
          const childProgress = this.layout(child, budget);
          if (childProgress) progressed = true;
          if (child.info.computed) {
            walkTreeAll(child, (node) => { height += node.info.height; });
            if (childProgress || pendingHidden || child.el.parentNode === childrenEl) {
              inPlace.push(child.el);
              if (child.onRender) child.onRender.call(child);
              pendingHidden = false;
            }
          } else {
            allComputed = false;
            if (childProgress || budget.finished) {
              inPlace.push(child.el);
              if (child.onRender) child.onRender.call(child);
              pendingHidden = true;
            } else if (pendingHidden) {
              inPlace.push(child.el);
              if (child.onRender) child.onRender.call(child);
              pendingHidden = false;
            }
          }
        }
        childrenEl.setChildrenInPlace(inPlace);
        childrenEl.style.minHeight = height + "px";
      }
    }
    if (allComputed) {
      info.queued = true;
      if (item.coverEl) {
        item.coverEl.style.marginInlineStart = "";
        item.coverEl.style.paddingInlineStart = "";
      }
      budget.num++;
    }
    return allComputed || progressed;
  };

  /** Depth-first pass over unmeasured subtrees; finished rows are measured through measureRow. */
  proto.measureDeep = function (item) {
    if (item.info.computed || !hasChildList(item)) return;
    const children = item.vChildren;
    if (!item.childrenEl.parentNode) return;
    for (const child of children.children) {
      this.measureDeep(child);
      if (child.info.queued) {
        this.measureRow(item, child);
        child.info.computed = true;
      }
    }
  };

  /** Measures one row: height (from the next visible sibling or the parent's bottom), width, child indent. */
  proto.measureRow = function (parent, item) {
    const el = item.el;
    const info = item.info;
    if (!el.offsetParent) {
      info.hidden = true;
      return;
    }
    info.hidden = false;
    const isFirst = item === parent.vChildren.children[0];
    let next = el.nextSibling;
    while (next && !next.isShown()) next = next.nextSibling;
    const scale = this.yScale;
    const rect = el.getBoundingClientRect();
    const top = isFirst ? parent.childrenEl.getBoundingClientRect().top : rect.top;
    const bottom = next ? next.getBoundingClientRect().top : rect.bottom;
    info.height = (bottom - top) / scale;
    let childTop = 0;
    if (hasChildList(item)) {
      const childrenEl = item.childrenEl;
      const style = childrenEl.win.getComputedStyle(childrenEl);
      const cssHeight = floatOr(style.height, 0);
      childTop = cssHeight;
      if (cssHeight && style.boxSizing === "border-box") {
        childTop -= floatOr(style.paddingTop, 0) + floatOr(style.borderTopWidth, 0)
          + floatOr(style.paddingBottom, 0) + floatOr(style.borderBottomWidth, 0);
      }
      info.height -= childTop;
      info.childTop = (childrenEl.getBoundingClientRect().top - top) / scale;
    }
    if (info.height < 0) info.height = 0;
    if (info.height === 0 && childTop === 0) info.hidden = true;
    if (this.setWidth) info.width = Math.max(el.scrollWidth, el.offsetWidth);
    if (item.coverEl) {
      const box = offsetBox(item.el, this.scrollEl);
      info.childLeft = this.rtl ? box.right : box.left;
      info.childLeftPadding = parseInt(getComputedStyle(item.coverEl).paddingInlineStart);
    }
  };

  proto.updateVirtualDisplay = function (scrollTop) {
    const scrollEl = this.scrollEl;
    const root = this.rootEl;
    const margin = this.rootMargin;
    let top = scrollEl.scrollTop;
    if (typeof scrollTop === "number") top = scrollTop;
    this.lastScroll = top;
    const viewHeight = scrollEl.clientHeight;
    const bottom = top + viewHeight;
    const visibleTop = Math.min(top, scrollEl.scrollTop);
    const visibleBottom = Math.max(viewHeight * margin, 300);
    const rangeTop = visibleTop - visibleBottom;
    const rangeBottom = bottom + visibleBottom;
    const paddingInlineStart = parseInt(getComputedStyle(scrollEl).paddingInlineStart);
    let totalHeight = 0;
    let count = 0;
    walkTreeAll(root, (item) => {
      const h = item.info.height;
      if (h > 0) { totalHeight += h; count++; }
    });
    const avgHeight = totalHeight / count;
    this.update(root, this.getRootTop(), rangeTop, rangeBottom, paddingInlineStart, avgHeight);
    if (scrollEl.scrollTop !== top) scrollEl.scrollTop = top;
  };

  /** Moves rows in and out of the DOM so that only [rangeTop, rangeBottom] is rendered; `top` is the root's top offset. */
  proto.update = function (item, top, rangeTop, rangeBottom, paddingInlineStart, avgHeight) {
    const info = item.info;
    const coverEl = item.coverEl;
    if (coverEl && info.childLeft !== 0) {
      const shift = info.childLeft - paddingInlineStart;
      coverEl.style.setProperty("margin-inline-start", -shift + "px", "important");
      coverEl.style.setProperty("padding-inline-start", shift + info.childLeftPadding + "px", "important");
    }
    if (!hasChildList(item)) return;
    const children = item.vChildren;
    const childrenEl = item.childrenEl;
    const pusher = item.pusherEl;
    if (!childrenEl.parentNode) {
      const all = [];
      for (const child of children.children) all.push(child.el);
      childrenEl.setChildrenInPlace(all);
      childrenEl.style.minHeight = "";
      return;
    }
    if (info.hidden) return;
    const setWidth = this.setWidth;
    let spacerHeight = 0;
    let contentHeight = 0;
    let maxWidth = 0;
    const inPlace = [pusher];
    let lastRendered = false;
    top += info.height;
    const renderChild = (child) => {
      let subtreeHeight = 0;
      walkTreeAll(child, (node) => { subtreeHeight += node.info.hidden ? 0 : node.info.height || avgHeight; });
      contentHeight += subtreeHeight;
      const childBottom = top + subtreeHeight;
      if (setWidth) maxWidth = Math.max(maxWidth, child.info.width);
      lastRendered = false;
      if (childBottom < rangeTop) {
        spacerHeight += subtreeHeight;
        walkTreeAll(child, (node) => { if (node.el.parentNode) node.el.detach(); });
      } else if (top > rangeBottom) {
        walkTreeAll(child, (node) => { if (node.el.parentNode) node.el.detach(); });
      } else {
        inPlace.push(child.el);
        if (child.onRender) child.onRender.call(child);
        this.update(child, top, rangeTop, rangeBottom, paddingInlineStart, avgHeight);
        lastRendered = true;
      }
      top = childBottom;
    };
    for (const child of children.children) renderChild(child);
    childrenEl.setChildrenInPlace(inPlace);
    if (children.children.length === 0) childrenEl.empty();
    pusher.style.marginBottom = spacerHeight + "px";
    if (setWidth) {
      maxWidth = Math.max(1, maxWidth);
      pusher.style.width = maxWidth + "px";
    }
    childrenEl.style.minHeight = lastRendered ? "" : contentHeight + "px";
  };

  /** Scrolls so that `item` is visible. */
  proto.scrollIntoView = function (item, margin = 0) {
    this.compute(true);
    for (let i = 0; i < 9 && !this.rootEl.info.computed; i++) this.compute(true);
    const top = this.findElementTop(item, this.rootEl, this.getRootTop());
    if (top === null) return;
    const bottom = top + item.info.height;
    const scrollEl = this.scrollEl;
    const scrollTop = scrollEl.scrollTop;
    const viewBottom = scrollTop + scrollEl.clientHeight;
    const wantTop = top - margin;
    const wantBottom = bottom + margin;
    if (wantTop < scrollTop) scrollEl.scrollTop = wantTop;
    else if (wantBottom > viewBottom) scrollEl.scrollTop = wantBottom - scrollEl.clientHeight;
    this.updateVirtualDisplay();
  };

  proto.findElementTop = function (target, item, top) {
    if (target === item) return top;
    if (hasChildList(item)) {
      const children = item.vChildren;
      const childrenEl = item.childrenEl;
      const info = item.info;
      if (childrenEl.parentNode) {
        top += info.childTop;
        for (const child of children.children) {
          const found = this.findElementTop(target, child, top);
          if (found !== null) return found;
          let height = 0;
          walkTreeAll(child, (node) => { height += node.info.hidden ? 0 : node.info.height; });
          top += height;
        }
      }
    }
    return null;
  };

  proto.getRootTop = function () {
    const scrollEl = this.scrollEl;
    let el = this.rootEl.childrenEl;
    let top = 0;
    while (el && el !== scrollEl) {
      top += el.offsetTop;
      el = el.offsetParent;
    }
    return top;
  };

  return InfinityScroll;
}

// =====================================================================================================================
// Tree: selection, keyboard navigation, persisted folds
// =====================================================================================================================

export function defineTree(host) {
  function Tree(view, options) {
    this.activeDom = null;
    this.focusedItem = null;
    this.selectedDoms = new Set();
    this.prefersCollapsed = false;
    this.isAllCollapsed = true;
    this.requestSaveFolds = debounceCall(this.saveFolds.bind(this), 200);
    this.id = options.id;
    this.app = options.app;
    this.view = view;
    this.scope = options.scope;
    this.handleDeleteSelectedItems = options.handleDeleteSelectedItems;
    this.handleCollapseAll = options.handleCollapseAll;
    this.handleRenameFocusedItem = options.handleRenameFocusedItem;
    this.containerEl = options.containerEl;
    this.getNodeId = options.getNodeId;
    this.infinityScroll = new host.InfinityScroll(options.containerEl);
    this.infinityScroll.rootEl = new host.TreeRoot(options.containerEl);
    this.initializeKeyboardNav();
    this.containerEl.addEventListener("click", (event) => {
      if (event.target === this.containerEl) {
        this.clearSelectedDoms();
        this.setFocusedItem(null, false);
      }
    });
  }
  const proto = Tree.prototype;

  proto.isItem = function (item) {
    return !(item && item instanceof host.TreeRoot) && !!item;
  };

  Object.defineProperty(Tree.prototype, "root", {
    get() { return this.infinityScroll.rootEl; },
    enumerable: false,
    configurable: true,
  });

  proto.initializeKeyboardNav = function () {
    const scope = this.scope;
    scope.register([], "ArrowDown", this.onKeyArrowDown.bind(this));
    scope.register(["Shift"], "ArrowDown", this.onKeyArrowDown.bind(this));
    scope.register(["Mod"], "ArrowDown", this.onKeyArrowDown.bind(this));
    scope.register([], "ArrowUp", this.onKeyArrowUp.bind(this));
    scope.register(["Shift"], "ArrowUp", this.onKeyArrowUp.bind(this));
    scope.register(["Mod"], "ArrowUp", this.onKeyArrowUp.bind(this));
    scope.register([], "ArrowLeft", this.onKeyArrowLeft.bind(this));
    scope.register(["Mod"], "ArrowLeft", this.onKeyArrowLeft.bind(this));
    scope.register([], "ArrowRight", this.onKeyArrowRight.bind(this));
    scope.register(["Mod"], "ArrowRight", this.onKeyArrowRight.bind(this));
    if (host.Platform.isMacOS && this.handleRenameFocusedItem) scope.register([], "Enter", this.handleRenameFocusedItem.bind(this));
    else scope.register([], "Enter", this.onKeyOpen.bind(this));
    scope.register([], " ", this.onKeyOpen.bind(this));
    if (this.handleRenameFocusedItem) scope.register([], "F2", this.handleRenameFocusedItem.bind(this));
    scope.register(["Mod"], "Enter", this.onKeyOpen.bind(this));
    if (this.handleDeleteSelectedItems) {
      if (host.Platform.isMacOS) scope.register(["Mod"], "Backspace", this.handleDeleteSelectedItems.bind(this));
      else scope.register([], "Delete", this.handleDeleteSelectedItems.bind(this));
    }
  };

  proto.toggleCollapseAll = function () {
    this.setCollapseAll(!this.isAllCollapsed);
  };

  proto.setCollapseAll = function (collapsed) {
    if (this.isAllCollapsed === collapsed) return;
    this.isAllCollapsed = collapsed;
    walkTree(this.root, (item) => {
      if (hasChildList(item)) item.setCollapsed(collapsed, false);
    });
    if (this.handleCollapseAll) this.handleCollapseAll(collapsed);
    this.requestSaveFolds();
  };

  proto.onResize = function () {
    this.infinityScroll.onResize();
  };

  /** Mouse/keyboard selection rules: ctrl/cmd toggles, shift extends a range, plain click moves focus. */
  proto.handleItemSelection = function (event, item) {
    const selectedDoms = this.selectedDoms;
    const activeDom = this.activeDom;
    const view = this.view;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.instanceOf(MouseEvent)) {
      this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
      if (event.shiftKey) {
        const range = activeDom ? treeRange(activeDom, item) : [item];
        for (const entry of range) this.selectItem(entry);
        return true;
      }
      if (selectedDoms.has(item)) this.deselectItem(item);
      else {
        if (this.activeDom) this.selectItem(this.activeDom);
        this.selectItem(item);
        this.setFocusedItem(item, false);
        this.activeDom = item;
      }
      return true;
    }
    if (!host.Keymap.isModEvent(event)) {
      if (event.altKey && !event.shiftKey) {
        this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
        if (selectedDoms.has(item)) this.deselectItem(item);
        else {
          if (this.activeDom) this.selectItem(this.activeDom);
          this.selectItem(item);
          this.setFocusedItem(item, false);
          this.activeDom = item;
        }
        return true;
      }
      if (event.shiftKey) {
        this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
        const range = activeDom ? treeRange(activeDom, item) : [item];
        for (const entry of range) this.selectItem(entry);
        return true;
      }
      if (item.selfEl.hasClass("is-being-renamed")) return true;
      if (item.selfEl.hasClass("is-active")) {
        if (!(event.instanceOf(MouseEvent) && host.isTouchSyntheticMouse(event))
          && !(event.instanceOf(PointerEvent) && event.pointerType === "touch")) {
          this.app.workspace.setActiveLeaf(view.leaf, { focus: true });
          this.setFocusedItem(item, false);
          return true;
        }
      }
    }
    if (event.instanceOf(MouseEvent)) {
      this.clearSelectedDoms();
      this.setFocusedItem(null);
    }
    this.activeDom = item;
    return false;
  };

  proto.getSelectedItems = function () {
    const focused = this.focusedItem;
    const selected = this.selectedDoms;
    if (selected.size > 0) return Array.from(selected);
    return focused && this.isItem(focused) ? [focused] : [];
  };

  proto.clearSelectedDoms = function () {
    this.selectedDoms.forEach((dom) => dom.selfEl.removeClass("is-selected"));
    this.selectedDoms.clear();
  };

  proto.deselectItem = function (item) {
    if (this.isItem(item) && this.selectedDoms.has(item)) {
      this.selectedDoms.delete(item);
      item.selfEl.removeClass("is-selected");
    }
  };

  proto.selectItem = function (item) {
    if (this.isItem(item) && !this.selectedDoms.has(item)) {
      this.selectedDoms.add(item);
      item.selfEl.addClass("is-selected");
    }
  };

  proto.onKeyOpen = function (event) {
    if (this.isItem(this.focusedItem)) this.focusedItem.onSelfClick(event);
  };

  proto.onKeyArrowUp = function (event) {
    event.preventDefault();
    const previous = this.focusedItem;
    this.changeFocusedItem("backwards");
    const focused = this.focusedItem;
    if (!(hasChildList(focused) && focused.collapsible) && host.Keymap.isModEvent(event)) {
      this.onKeyOpen(syntheticKeyEvent(event, { metaKey: false }));
    }
    if (event.shiftKey) {
      this.selectItem(previous);
      this.selectItem(focused);
    }
  };

  proto.onKeyArrowDown = function (event) {
    event.preventDefault();
    host.blurAndClearSelection();
    const previous = this.focusedItem;
    this.changeFocusedItem("forwards");
    const focused = this.focusedItem;
    if (!(hasChildList(focused) && focused.collapsible) && host.Keymap.isModEvent(event)) {
      this.onKeyOpen(syntheticKeyEvent(event, { metaKey: false }));
    }
    if (event.shiftKey) {
      this.selectItem(previous);
      this.selectItem(focused);
    }
  };

  proto.onKeyArrowLeft = function (event) {
    if (isEditableNode(event.targetNode)) return;
    event.preventDefault();
    if (!this.focusedItem) return;
    if (this.focusedItem === this.root) {
      this.setCollapseAll(true);
      return;
    }
    const focused = this.focusedItem;
    if (hasChildList(focused) && focused.collapsible) {
      if (focused.collapsed) {
        if (hasChildList(focused.parent)) this.setFocusedItem(focused.parent);
      } else {
        focused.setCollapsed(true, true);
      }
    } else {
      if (focused.parent === this.root) {
        this.setCollapseAll(true);
        return;
      }
      focused.parent.setCollapsed(true, true);
    }
    // keep focus on a visible row: climb out of any collapsed ancestors
    let node = this.focusedItem;
    while (node.parent && node.parent.collapsed) node = node.parent;
    this.setFocusedItem(node);
  };

  proto.onKeyArrowRight = function (event) {
    if (isEditableNode(event.targetNode)) return;
    event.preventDefault();
    const focused = this.focusedItem;
    if (!focused || !hasChildList(focused)) return;
    if (focused.collapsed) focused.setCollapsed(false, true);
    else if (focused.vChildren.hasChildren()) this.changeFocusedItem("forwards");
  };

  proto.setFocusedItem = function (item, scroll = true) {
    if (item === this.root) return;
    if (this.isItem(this.focusedItem)) this.focusedItem.selfEl.removeClass("has-focus");
    this.focusedItem = item;
    if (item && this.isItem(item)) {
      item.selfEl.addClass("has-focus");
      if (scroll) this.infinityScroll.scrollIntoView(item);
    }
  };

  proto.changeFocusedItem = function (direction) {
    let focused = this.focusedItem;
    if (!focused || focused.info.hidden) {
      if (this.activeDom) focused = this.focusedItem = this.activeDom;
      else if (this.selectedDoms.size) focused = this.focusedItem = Array.from(this.selectedDoms).last();
      else focused = this.focusedItem = this.root;
    }
    if (focused !== this.root || direction !== "backwards") {
    const next = direction === "forwards"
      ? nextVisibleTreeItem(this.focusedItem, true)
      : prevVisibleTreeItem(this.focusedItem, true);
    if (next) this.setFocusedItem(next);
  } else {
    this.setFocusedItem(lastVisibleTreeItem(this.root, true));
  }
  }

  proto.getFoldKey = function () {
    return this.prefersCollapsed ? this.id + "-unfold" : this.id + "-folds";
  };

  proto.loadFolds = function () {
    if (!this.getNodeId) return;
    const folded = new Set(this.app.loadLocalStorage(this.getFoldKey()));
    const collapsed = !this.prefersCollapsed;
    walkTree(this.root, (item) => {
      if (hasChildList(item) && folded.has(this.getNodeId(item))) item.setCollapsed(collapsed, false);
    });
  };

  proto.saveFolds = function () {
    if (!this.getNodeId || !this.app.workspace.layoutReady) return;
    const folded = [];
    walkTree(this.root, (item) => {
      if (hasChildList(item) && item.collapsed !== this.prefersCollapsed) folded.push(this.getNodeId(item));
    });
    this.app.saveLocalStorage(this.getFoldKey(), folded);
  };

  return Tree;
}
