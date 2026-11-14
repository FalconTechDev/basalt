// Workspace (H0) controller methods, ported incrementally. Each export replaces one
// `H0.prototype.<name>` through the manifest "methods" mechanism; `this` is the workspace instance.
// Bundle-scope names (workspace tree classes, Events, activeWindow) arrive through env().
import { env } from "./env.js";

export function wsOn(name, callback, context) {
  return env().VT.prototype.on.call(this, name, callback, context);
}

export function wsTrigger(name, ...args) {
  return env().VT.prototype.trigger.apply(this, [name, ...args]);
}

export function wsIsAttached(leaf) {
  if (!leaf) return false;
  const root = leaf.getRoot();
  return [this.leftSplit, this.rootSplit, this.floatingSplit, this.rightSplit].includes(root);
}

export function wsGetLeftLeaf(dir) {
  return this.getSideLeaf(this.leftSplit, dir);
}

export function wsGetRightLeaf(dir) {
  return this.getSideLeaf(this.rightSplit, dir);
}

export function wsGetLeaf(direction, makeActive) {
  if (direction === "split") return this.splitActiveLeaf(makeActive);
  if (direction === "tab" || direction === true) return this.createLeafInTabGroup();
  if (direction === "window") return this.openPopoutLeaf();
  return this.getUnpinnedLeaf();
}

export function wsGetGroupLeaves(group) {
  const leaves = [];
  if (group) {
    this.iterateAllLeaves((leaf) => {
      if (leaf.group === group) leaves.push(leaf);
    });
  }
  return leaves;
}

export function wsIterateLeaves(node, callback) {
  const { LD, ID, jD } = env();
  if (typeof node === "function" && callback instanceof LD) {
    const tmp = callback;
    callback = node;
    node = tmp;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (this.iterateLeaves(node[i], callback)) return true;
    }
  } else if (node instanceof jD) {
    if (callback(node)) return true;
  } else if (node instanceof ID) {
    for (let i = 0; i < node.children.length; i++) {
      if (this.iterateLeaves(node.children[i], callback)) return true;
    }
  }
  return false;
}

export function wsIterateTabs(node, callback) {
  const { zD, ID } = env();
  if (!Array.isArray(node)) node = [node];
  for (let i = 0; i < node.length; i++) {
    const item = node[i];
    if (item instanceof zD && callback(item)) return true;
    if (item instanceof ID && this.iterateTabs(item.children, callback)) return true;
  }
  return false;
}

export function wsIterateAllLeaves(callback) {
  this.iterateLeaves(this.rootSplit, callback);
  this.iterateLeaves(this.leftSplit, callback);
  this.iterateLeaves(this.rightSplit, callback);
  this.iterateLeaves(this.floatingSplit, callback);
}

export function wsIterateRootLeaves(callback) {
  this.iterateLeaves(this.rootSplit, callback);
}

export function wsIterateCodeMirrors(callback) {}

export function wsHasUndoHistory() {
  return this.undoHistory.length > 0;
}

export function wsIsInSidebar(item) {
  const root = item.getRoot();
  return root === this.leftSplit || root === this.rightSplit;
}

export function wsOnLayoutChange(item) {
  this.requestUpdateLayout();
  if (item) {
    const queue = this.layoutItemQueue;
    if (!queue.contains(item)) queue.push(item);
  }
}

export function wsOnLayoutReady(callback) {
  if (this.onLayoutReadyCallbacks === null) callback();
  else {
    this.onLayoutReadyCallbacks.push({
      pluginId: this.app.plugins.loadingPluginId,
      callback,
    });
  }
}

export function wsOnQuickPreview(leaf, file) {
  this.trigger("quick-preview", leaf, file);
}

export function wsAddMobileFileInfo(info) {
  this.mobileFileInfos.push(info);
}

export function wsGetRecentFiles(count) {
  return this.recentFileTracker.getRecentFiles(count);
}

export function wsGetLastOpenFiles() {
  return this.recentFileTracker.getLastOpenFiles();
}

export function wsAddRecentFile(file) {
  this.recentFileTracker.addRecentFile(file);
}

export function wsOnResize() {
  this.trigger("resize");
}

export function wsUpdateTitle() {
  const leaf = this.getMostRecentLeaf(this.rootSplit);
  document.title = this.app.getAppTitle(leaf ? leaf.getDisplayText().trim() : "");
}

export function wsGetActiveFile() {
  return this.activeEditor?.file || this.getActiveFileView()?.file || null;
}

export function wsGetFocusedContainer() {
  if (env().activeWindow === window) return this.rootSplit;
  const children = this.floatingSplit.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child instanceof env().O0 && child.win === env().activeWindow) return child;
  }
  return this.rootSplit;
}

export function wsGetMostRecentLeaf(root) {
  let first = null;
  let mostRecent = null;
  this.iterateLeaves(root != null ? root : [this.rootSplit, this.floatingSplit], (leaf) => {
    if (!first) first = leaf;
    if (leaf.isVisible() && (!mostRecent || mostRecent.activeTime < leaf.activeTime)) mostRecent = leaf;
  });
  return mostRecent != null ? mostRecent : first;
}

export function wsGetActiveViewOfType(type) {
  const leaf = this.activeLeaf;
  if (!leaf) return null;
  const view = leaf.view;
  return view instanceof type ? view : null;
}

export function wsGetActiveLeafOfViewType(type) {
  return this.getActiveViewOfType(type);
}

export function wsGetSideLeaf(split, splitNew) {
  const { jD, zD, ID, WD } = env();
  let leaf;
  if (split instanceof WD) {
    leaf = new jD(this.app);
    split.insertChild(-1, leaf);
    return leaf;
  }
  if (splitNew) {
    const tabs = new zD(this);
    split.insertChild(-1, tabs);
    leaf = new jD(this.app);
    tabs.insertChild(-1, leaf);
    return leaf;
  }
  if (split.children.length === 0) split.insertChild(0, new zD(this));
  const first = split.children[0];
  if (first instanceof ID) {
    leaf = new jD(this.app);
    first.insertChild(-1, leaf);
    return leaf;
  }
  return null;
}
