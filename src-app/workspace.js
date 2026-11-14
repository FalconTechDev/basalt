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


export function wsGetActiveFileView() {
  let leaf = this.activeLeaf;
  if (leaf && leaf.view.navigation) return leaf.view instanceof env().MD ? leaf.view : null;
  leaf = null;
  let view = null;
  this.iterateAllLeaves((candidate) => {
    if (candidate.view.navigation && (!leaf || leaf.activeTime < candidate.activeTime)) {
      leaf = candidate;
      view = candidate.view instanceof env().MD ? candidate.view : null;
    }
  });
  return view;
}

export function wsActiveLeafEvents() {
  if (!this.layoutReady) return;
  const leaf = this.activeLeaf;
  this.trigger("active-leaf-change", leaf);
  const prevFile = this.lastActiveFile;
  const file = this.getActiveFile();
  if (prevFile !== file) {
    this.recentFileTracker.onFileOpen(file, prevFile);
    this.lastActiveFile = file;
    this.trigger("file-open", file);
  }
}

export function wsPushUndoHistory(leaf, parentId, rootId) {
  if (!leaf) return;
  const state = leaf.getViewState();
  if (state.type === "empty") return;
  const eState = leaf.getEphemeralState();
  const history = this.undoHistory;
  history.unshift({
    leafId: leaf.id,
    state,
    eState,
    parentId,
    rootId,
    leafHistory: leaf.history.serialize(),
  });
  if (history.length > 10) history.pop();
}

export async function wsChangeLayout(layout) {
  if (!this.layoutReady) return;
  await this.clearLayout();
  await this.setLayout(layout);
}

export function wsUpdateOptions() {
  if (!this.layoutReady) return;
  this.iterateAllLeaves((leaf) => {
    if (leaf && leaf.view instanceof env().W6) leaf.view.updateOptions();
  });
  if (env().Yl.isDesktopApp && !env().jl) env().Kf(this.app.getSpellcheckLanguages());
}

export function wsRegisterObsidianProtocolHandler(action, handler) {
  if (this.protocolHandlers.has(action)) {
    throw new Error(`Action "${action}" is already registered as a handler.`);
  }
  this.protocolHandlers.set(action, handler);
}

export function wsUnregisterObsidianProtocolHandler(action, handler) {
  if (!handler || this.protocolHandlers.get(action) === handler) this.protocolHandlers.delete(action);
}

export function wsRegisterUriHook() {
  const self = this;
  const dispatch = (action) => {
    if (!action) return;
    console.log("Received URL action", action);
    self.getFocusedContainer().focus();
    const handlers = self.protocolHandlers;
    const name = action.action;
    if (name) {
      if (handlers.has(name)) handlers.get(name)(action);
      else new env().fb(env().gm.interface.msgInvalidUriAction({ action: name }));
    }
  };
  const previous = window.OBS_ACT;
  window.OBS_ACT = dispatch;
  if (previous) dispatch(previous);
  if (env().Em) {
    env().xm.addListener("appUrlOpen", (event) => {
      const action = env().Ek(event.url);
      if (action) {
        if (action.vault && action.vault.toLowerCase() !== self.app.vault.getName().toLowerCase()) {
          sessionStorage.setItem("obsidian-uri", event.url);
          window.location.reload();
        } else {
          dispatch(action);
        }
      }
    });
  }
}

export function wsGetUnpinnedLeaf(reveal = true) {
  const { jD, zD } = env();
  const active = this.activeLeaf;
  if (active && active.canNavigate()) return active;
  const container = active?.getContainer() ?? this.rootSplit;
  let candidate = null;
  this.iterateLeaves(container, (leaf) => {
    if (leaf.canNavigate()) {
      const parent = leaf.parent;
      if (parent && (parent.children[parent.currentTab] === leaf || (parent instanceof zD && parent.isStacked))) {
        if (!candidate || candidate.activeTime < leaf.activeTime) candidate = leaf;
      }
    }
  });
  if (!candidate) {
    const recent = this.getMostRecentLeaf(container);
    const parent = recent?.parent ?? container;
    candidate = new jD(this.app);
    parent.insertChild(-1, candidate);
  }
  if (reveal) this.setActiveLeaf(candidate);
  return candidate;
}

export async function wsEnsureSideLeaf(viewType, side, options) {
  const opts = options || {};
  const { active, split, state } = opts;
  const reveal = opts.reveal === undefined ? true : opts.reveal;
  const leaves = this.getLeavesOfType(viewType);
  const leaf = leaves.length === 0
    ? (side === "left" ? this.getLeftLeaf(split) : this.getRightLeaf(split))
    : leaves[0];
  if (active || reveal) await leaf.loadIfDeferred();
  if (state || leaf.view.getViewType() !== viewType) {
    await leaf.setViewState({ type: viewType, state });
  }
  if (reveal) await this.revealLeaf(leaf);
  if (active) this.setActiveLeaf(leaf, { focus: true });
  return leaf;
}

export async function wsRevealLeaf(leaf) {
  const { FD, zD, Iv } = env();
  const root = leaf.getRoot();
  let changed = false;
  if (root instanceof FD && root.collapsed) {
    changed = true;
    root.expand();
  }
  if (root instanceof env().WD) {
    root.openLeaf(leaf);
    root.expand();
    if (root === this.leftSplit) this.rightSplit.collapse();
    else if (root === this.rightSplit) this.leftSplit.collapse();
  }
  const parent = leaf.parent;
  if (parent instanceof zD) {
    const previous = parent.currentTab;
    parent.selectTab(leaf);
    if (changed || parent.currentTab !== previous) Iv(leaf.tabHeaderEl);
  }
  const container = leaf.getContainer();
  if (container) container.focus();
  await leaf.loadIfDeferred();
}

export function wsSplitLeaf(leaf, tabs, direction = "vertical", before) {
  const { OD, zD } = env();
  let node = leaf;
  let child = leaf;
  let parent = null;
  let index = -1;
  while (node) {
    if (node instanceof OD) {
      parent = node;
      index = parent.children.indexOf(child);
      break;
    }
    child = node;
    node = node.parent;
  }
  if (!(tabs instanceof zD)) tabs = zD.createFrom(this, tabs);
  const dimension = child.dimension;
  if (direction !== parent.direction) {
    child.setDimension(null);
    const split = new OD(this, direction);
    parent.replaceChild(index, split);
    split.setDimension(dimension);
    if (before) {
      split.insertChild(0, tabs);
      split.insertChild(1, child);
    } else {
      split.insertChild(0, child);
      split.insertChild(1, tabs);
    }
  } else {
    if (dimension !== null) {
      child.setDimension(dimension / 2);
      tabs.setDimension(dimension / 2);
    }
    if (before) parent.insertChild(index, tabs);
    else parent.insertChild(index + 1, tabs);
  }
}

export function wsGetDropDirection(event, rect, exclude, tabGroup) {
  const { zD, Bv } = env();
  const x = event.clientX;
  const y = event.clientY;
  const relX = Math.abs(x - rect.x) / rect.width;
  const relY = Math.abs(y - rect.y) / rect.height;
  const farX = Math.abs(x - (rect.x + rect.width)) / rect.width;
  const farY = Math.abs(y - (rect.y + rect.height)) / rect.height;
  exclude = exclude || [];
  if (tabGroup instanceof zD && tabGroup.isStacked && !Bv(event, tabGroup.tabHeaderContainerEl)) {
    exclude.push("left", "right");
  }
  let direction = "center";
  let ratio = 1;
  if (relY < 0.33 && relY < ratio && !exclude.includes("top")) {
    ratio = relY;
    if (tabGroup instanceof zD) {
      if (!tabGroup.isStacked && Bv(event, tabGroup.tabHeaderContainerEl)) ratio = 0;
      const headerRect = tabGroup.tabHeaderContainerEl.getBoundingClientRect();
      if (y - rect.y <= headerRect.height / 3) direction = "top";
      else {
        direction = "center";
        if (tabGroup.isStacked) ratio = 1;
      }
    } else {
      direction = "top";
    }
  }
  if (relX < 0.33 && relX < ratio && !exclude.includes("left")) {
    ratio = relX;
    direction = "left";
  }
  if (farX < 0.33 && farX < ratio && !exclude.includes("right")) {
    ratio = farX;
    direction = "right";
  }
  if (farY < 0.33 && farY < ratio && !exclude.includes("bottom")) {
    ratio = farY;
    direction = "bottom";
  }
  let size = ["left", "right"].includes(direction) ? rect.width : rect.height;
  size = Math.max(size / 3, 40);
  switch (direction) {
    case "center":
      break;
    case "left":
      rect.width = size;
      break;
    case "top":
      rect.height = size;
      break;
    case "right":
      rect.x += rect.width - size;
      rect.width = size;
      break;
    case "bottom":
      rect.y += rect.height - size;
      rect.height = size;
  }
  return direction;
}

export function wsGetDropLocation(event) {
  const { Bv, O0 } = env();
  const win = event.win;
  if (win !== window) {
    const children = this.floatingSplit.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child instanceof O0 && child.win === win) return this.recursiveGetTarget(event, child);
    }
  }
  const leftRibbon = this.leftRibbon;
  const rightRibbon = this.rightRibbon;
  const leftToggle = this.leftSidebarToggleButtonEl;
  const rightToggle = this.rightSidebarToggleButtonEl;
  const leftSplit = this.leftSplit;
  const rightSplit = this.rightSplit;
  const rootSplit = this.rootSplit;
  if (Bv(event, leftRibbon.containerEl) || Bv(event, leftToggle)) return leftSplit;
  if (Bv(event, rightRibbon.containerEl) || Bv(event, rightToggle)) return rightSplit;
  if (Bv(event, leftSplit.containerEl)) {
    return leftSplit.children.length === 0 ? leftSplit : this.recursiveGetTarget(event, leftSplit);
  }
  if (Bv(event, rightSplit.containerEl)) {
    return rightSplit.children.length === 0 ? rightSplit : this.recursiveGetTarget(event, rightSplit);
  }
  if (Bv(event, rootSplit.containerEl)) return this.recursiveGetTarget(event, rootSplit);
  return null;
}

export function wsRecursiveGetTarget(event, parent) {
  const { Bv, zD, ID } = env();
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (Bv(event, child.containerEl)) {
      if (child instanceof zD) return child;
      if (child instanceof ID) return this.recursiveGetTarget(event, child);
      return child;
    }
  }
  return null;
}

export async function wsDuplicateLeaf(leaf, type, direction) {
  if (!leaf) return;
  if (type !== "horizontal" && type !== "vertical") {
    direction = type;
    type = "split";
  }
  const viewState = leaf.getViewState();
  const eState = leaf.getEphemeralState();
  const leafHistory = leaf.history.serialize();
  const newLeaf = type === "split" ? this.createLeafBySplit(leaf, direction) : this.getLeaf(type);
  await newLeaf.setViewState(viewState, { ...eState, focus: true });
  newLeaf.history.deserialize(leafHistory);
  return newLeaf;
}

export function wsCreateLeafInTabGroup(parent) {
  const { jD, tD } = env();
  if (!parent) {
    const recent = this.getMostRecentLeaf();
    if (!recent) throw new Error("No tab group found.");
    parent = recent.parent;
  }
  let index = parent.children.length - 1;
  let leaf = parent.children[index];
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child.activeTime > leaf.activeTime) {
      leaf = child;
      index = i;
    }
  }
  if (leaf.view instanceof tD) return leaf;
  const newLeaf = new jD(this.app);
  parent.insertChild(index + 1, newLeaf);
  if (this.app.vault.getConfig("focusNewTab")) this.setActiveLeaf(newLeaf);
  return newLeaf;
}

export function wsUpdateMobileVisibleTabGroup() {
  const { Yl, WD, ID } = env();
  if (!Yl.isMobile) return;
  let leaf = this.activeLeaf;
  if (this.activeTabGroup instanceof WD) leaf = this.getMostRecentLeaf();
  const visible = new Set();
  let node = leaf.parent;
  while (node) {
    visible.add(node);
    node.containerEl.addClass("mod-visible");
    node = node.parent;
  }
  const hide = (item) => {
    if (!visible.has(item)) item.containerEl.removeClass("mod-visible");
    for (let i = 0; i < item.children.length; i++) {
      const child = item.children[i];
      if (child instanceof ID) hide(child);
    }
  };
  hide(this.rootSplit);
}

export async function wsReadWorkspaceFile() {
  const { Yl, N0, F0 } = env();
  const fileName = Yl.isMobile ? N0 : F0;
  let data = {};
  try {
    data = JSON.parse(await this.app.vault.adapter.read(this.app.vault.configDir + "/" + fileName));
  } catch (error) {}
  return data;
}

export function wsMoveLeafToPopout(leaf, options) {
  const { V0, Yg, zD } = env();
  V0();
  if (!(leaf.view instanceof Yg)) return;
  if (options == null) options = {};
  if (!options.size) options.size = leaf.containerEl.getBoundingClientRect();
  if (!options.zoom) options.zoom = leaf.containerEl.win.electron.webFrame.getZoomLevel();
  const popout = this.app.workspace.openPopout(options);
  leaf.parent?.removeChild(leaf);
  leaf.setDimension(null);
  popout.insertChild(0, zD.createFrom(this, leaf));
  return popout;
}

export function wsSplitActiveLeaf(direction) {
  const leaf = this.getMostRecentLeaf();
  return leaf ? this.createLeafBySplit(leaf, direction) : this.createLeafInParent(this.rootSplit, 0);
}

export async function wsOpenLinkText(linktext, sourcePath, direction, newLeaf) {
  await this.getLeaf(direction).openLinkText(linktext, sourcePath, newLeaf);
}

export function wsCreateLeafInParent(parent, index) {
  const newLeaf = new env().jD(this.app);
  if (parent.children.length > 0) newLeaf.setDimension(100 / parent.children.length);
  parent.insertChild(index, newLeaf);
  this.setActiveLeaf(newLeaf);
  return newLeaf;
}

export function wsGetLeafById(id) {
  let found = null;
  this.iterateAllLeaves((leaf) => {
    if (leaf.id === id) {
      found = leaf;
      return true;
    }
  });
  return found;
}

export function wsDetachLeavesOfType(type) {
  const leaves = this.getLeavesOfType(type);
  for (let i = 0; i < leaves.length; i++) leaves[i].detach();
}

export function wsRegisterEditorExtension(extension) {
  this.editorExtensions.push(extension);
  this.updateOptions();
}

export function wsUnregisterEditorExtension(extension) {
  this.editorExtensions.remove(extension);
  this.updateOptions();
}

export function wsRegisterHoverLinkSource(id, source) {
  this.hoverLinkSources[id] = source;
}

export function wsUnregisterHoverLinkSource(id) {
  delete this.hoverLinkSources[id];
}

export function wsRegisterOperatorFuncConfigs(id, configs) {
  this.operatorFuncConfigs[id] = configs;
}

export function wsUnregisterOperatorFuncConfigs(id) {
  delete this.operatorFuncConfigs[id];
}
