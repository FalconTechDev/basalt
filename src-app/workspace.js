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

export function wsGetLeavesOfType(type) {
  const leaves = [];
  this.iterateAllLeaves((leaf) => {
    if (leaf.view.getViewType() === type) leaves.push(leaf);
  });
  return leaves;
}

export function wsGetLayout() {
  const layout = {};
  layout.main = this.rootSplit.serialize();
  layout.left = this.leftSplit.serialize();
  layout.right = this.rightSplit.serialize();
  layout["left-ribbon"] = this.leftRibbon.serialize();
  if (this.floatingSplit.children.length) layout.floating = this.floatingSplit.serialize();
  const leaf = this.activeLeaf;
  if (leaf) layout.active = leaf.id;
  return layout;
}

export function wsSetActiveLeaf(leaf, options, focus) {
  let focusFlag;
  if (options && typeof options !== "boolean") {
    focusFlag = options.focus;
  } else {
    focusFlag = focus;
  }
  if (!this.isAttached(leaf)) return;
  const previous = this.activeLeaf;
  if (previous !== leaf) {
    if (previous) {
      previous.containerEl.removeClass("mod-active");
      previous.tabHeaderEl.removeClass("mod-active");
    }
    if (this.activeTabGroup) this.activeTabGroup.containerEl.removeClass("mod-active");
    this.activeLeaf = leaf;
    this.activeTabGroup = leaf?.parent;
    this._activeEditor = null;
    if (leaf) {
      leaf.activeTime = Date.now();
      leaf.containerEl.addClass("mod-active");
      leaf.tabHeaderEl.addClass("mod-active");
      this.activeTabGroup?.containerEl.addClass("mod-active");
      const parent = leaf.parent;
      if (parent instanceof env().zD) {
        const index = parent.children.indexOf(leaf);
        parent.selectTabIndex(index);
      }
      const container = leaf.getContainer();
      if (container instanceof env().O0) container.updateTitle();
      else this.updateTitle();
      if (focusFlag) this.focusLeaf(leaf);
      this.updateMobileVisibleTabGroup();
      this.requestActiveLeafEvents();
    }
  } else if (focusFlag && leaf) {
    this.focusLeaf(leaf);
  }
}

export function wsFocusLeaf(leaf) {
  const { Yl, WD } = env();
  const container = leaf.getContainer();
  if (Yl.isDesktopApp) container.focus();
  leaf.setEphemeralState({ focus: true });
  if (Yl.isMobile && leaf.getRoot() === this.rootSplit) {
    const left = this.leftSplit;
    const right = this.rightSplit;
    if (left instanceof WD) left.collapse();
    if (right instanceof WD) right.collapse();
  }
  const setting = this.app.setting;
  if (setting.win && setting.win === container.win) setting.close();
}

export function wsUnsetActiveEditor(editor) {
  if (!editor || this._activeEditor === editor) this._activeEditor = null;
}

export function wsSplitLeafOrActive(leaf, direction) {
  return leaf ? this.createLeafBySplit(leaf, direction) : this.splitActiveLeaf(direction);
}

export function wsOpenPopout(options) {
  const { V0, O0 } = env();
  V0();
  const popout = new O0(this, null, options);
  this.floatingSplit.insertChild(-1, popout);
  return popout;
}

export function wsOpenPopoutLeaf(options) {
  const { jD, zD } = env();
  const popout = this.openPopout(options);
  const leaf = new jD(this.app);
  popout.insertChild(0, zD.createFrom(this, leaf));
  return leaf;
}

export function wsCreateLeafBySplit(leaf, direction, before) {
  const { jD } = env();
  const newLeaf = new jD(this.app);
  this.splitLeaf(leaf, newLeaf, direction, before);
  this.setActiveLeaf(newLeaf);
  return newLeaf;
}

export function wsClearLayout() {
  return (async () => {
    this.layoutReady = false;
    this.requestLayoutChangeEvents.cancel();
    const closers = [];
    this.iterateAllLeaves((leaf) => {
      closers.push(leaf.open(null));
    });
    await Promise.all(closers);
    this.leftSplit.containerEl.detach();
    this.rootSplit.containerEl.detach();
    this.rightSplit.containerEl.detach();
    this.floatingSplit.containerEl.detach();
    this.rootSplit.component.unload();
    this.leftSplit.component.unload();
    this.rightSplit.component.unload();
    this.floatingSplit.component.unload();
    const children = this.floatingSplit.children.slice();
    for (let i = 0; i < children.length; i++) {
      if (children[i] instanceof env().O0) children[i].close();
    }
    this.rootSplit = null;
    this.leftSplit = null;
    this.rightSplit = null;
    this.floatingSplit = null;
    this.activeLeaf = null;
    this.layoutItemQueue = [];
  })();
}

export async function wsSaveLayout() {
  if (!this.layoutReady) return;
  const vault = this.app.vault;
  const layout = this.getLayout();
  layout.lastOpenFiles = this.recentFileTracker.serialize();
  try {
    const fileName = env().Yl.isMobile ? env().N0 : env().F0;
    await vault.adapter.write(vault.configDir + "/" + fileName, JSON.stringify(layout, null, 2));
  } catch (error) {}
}

export function wsGetAdjacentLeafInDirection(leaf, direction) {
  const { jD, zD, ID, OD, activeDocument } = env();
  if (!leaf) return null;
  if (leaf instanceof jD && leaf.parent instanceof zD) leaf = leaf.parent;
  const rect = leaf.containerEl.getBoundingClientRect();
  let point = null;
  switch (direction) {
    case "top":
      point = { x: rect.left + rect.width / 2, y: rect.top - 5 };
      break;
    case "bottom":
      point = { x: rect.left + rect.width / 2, y: rect.top + rect.height + 5 };
      break;
    case "left":
      point = { x: rect.left - 5, y: rect.top + rect.height / 2 };
      break;
    case "right":
      point = { x: rect.left + rect.width + 5, y: rect.top + rect.height / 2 };
  }
  if (point) {
    const element = activeDocument.elementFromPoint(point.x, point.y);
    let found = null;
    const container = leaf.getContainer();
    this.iterateLeaves(container, (candidate) => {
      if (candidate.containerEl.contains(element)) {
        found = candidate;
        return true;
      }
    });
    if (!found) {
      this.iterateTabs(container, (tabs) => {
        if (tabs.containerEl.contains(element)) {
          found = tabs.children[tabs.currentTab];
          return true;
        }
      });
    }
    if (found) return found;
  }
  let sibling = null;
  const axis = direction === "left" || direction === "right" ? "vertical" : "horizontal";
  for (let node = leaf; node;) {
    const parent = node.parent;
    if ((parent instanceof zD && (direction === "left" || direction === "right")) ||
        (parent instanceof OD && parent.direction === axis)) {
      const children = parent.children;
      const index = children.indexOf(node);
      if (direction === "left" || direction === "top") {
        if (index > 0) {
          sibling = children[index - 1];
          break;
        }
      } else if (index < children.length - 1) {
        sibling = children[index + 1];
        break;
      }
    }
    node = parent;
  }
  if (!sibling) return null;
  while (sibling instanceof ID) {
    const index = sibling instanceof zD ? sibling.currentTab : 0;
    sibling = sibling.children[index];
  }
  return sibling instanceof jD ? sibling : null;
}

export function wsOnStartLink(leaf) {
  const self = this;
  const dragManager = this.app.dragManager;
  const onMove = (event) => {
    event.preventDefault();
    const target = self.getDropLocation(event);
    if (target && target !== leaf) {
      let resolved = target;
      if (resolved instanceof env().zD) resolved = resolved.children[resolved.currentTab];
      if (resolved instanceof env().jD) {
        if (resolved.view instanceof env().Yg) {
          const rect = resolved.containerEl.getBoundingClientRect();
          dragManager.showOverlay(event.doc, rect);
        } else {
          dragManager.hideOverlay();
        }
      } else {
        dragManager.hideOverlay();
      }
    } else {
      dragManager.hideOverlay();
    }
  };
  const onUp = (event) => {
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    dragManager.removeOverlay();
    const target = self.getDropLocation(event);
    if (target && target !== leaf) {
      let resolved = target;
      if (resolved instanceof env().zD) resolved = resolved.children[resolved.currentTab];
      if (resolved instanceof env().jD && resolved.view instanceof env().Yg) {
        leaf.setGroupMember(resolved);
      }
    }
  };
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

export function wsHandleLinkContextMenu(menu, linktext, sourcePath, source) {
  const { Yl, MT, Bg, fb, gm } = env();
  if (!linktext) return false;
  const { path } = MT(linktext);
  const file = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
  if (Yl.isPhone) {
    menu.addItem((item) => item.setSection("title").setTitle(file ? file.getShortName() : path).setIsLabel(true));
  }
  if (file) {
    if (Yl.isPhone) {
      menu.addItem((item) => item.setSection("open").setTitle(gm.interface.menu.openLink()).setIcon("lucide-file")
        .onClick((event) => this.openLinkText(linktext, sourcePath, Bg.isModEvent(event))));
    }
    menu.addItem((item) => item.setSection("open").setTitle(gm.interface.menu.openInNewTab()).setIcon("lucide-file-plus")
      .onClick(() => this.app.workspace.openLinkText(linktext, sourcePath, "tab")));
    if (Yl.canSplit) {
      menu.addItem((item) => item.setSection("open").setTitle(gm.interface.menu.openToTheRight()).setIcon("lucide-separator-vertical")
        .onClick(() => this.app.workspace.openLinkText(linktext, sourcePath, "split")));
    }
    menu.addItem((item) => item.setSection("action").setTitle(gm.plugins.fileExplorer.menuOptRename()).setIcon("lucide-edit-3")
      .onClick(() => this.app.fileManager.promptForFileRename(file)));
    this.trigger("file-menu", menu, file, "link-context-menu", source);
    return true;
  }
  menu.addItem((item) => item.setSection("open").setTitle(gm.interface.menu.createFile()).setIcon("lucide-file")
    .onClick((event) => this.openLinkText(linktext, sourcePath, Bg.isModEvent(event))));
  return true;
}

export function wsHandleExternalLinkContextMenu(menu, url) {
  const { Ec, fb, gm } = env();
  if (!url) return false;
  menu.addItem((item) => item.setTitle(gm.interface.menu.copyUrl()).setSection("info").setIcon("lucide-link")
    .onClick(() => {
      Ec(url);
      new fb(gm.interface.copied({ item: "URL" }));
    }));
  menu.addItem((item) => item.setTitle(gm.plugins.webViewer.actionOpenLinkDefaultBrowser()).setIcon("lucide-globe-2")
    .setSection("open").onClick(() => window.open(url, "_external")));
  this.trigger("url-menu", menu, url);
  return true;
}

export async function wsDeserializeLayout(data, sidebar) {
  const { L0, FD, OD, I0, O0, zD, jD, WD, Yl, qf } = env();
  const self = this;
  const fill = async (parent) => {
    for (let i = 0; i < data.children.length; i++) {
      const child = await self.deserializeLayout(data.children[i], null);
      if (child) {
        if (child.type !== "leaf" || parent.type === "tabs" || parent instanceof WD) {
          parent.insertChild(i, child);
        } else {
          const tabs = new zD(self);
          tabs.insertChild(0, child);
          parent.insertChild(i, tabs);
        }
      } else {
        data.children.splice(i, 1);
        i--;
      }
    }
  };
  if (data.type === "split") {
    let parent;
    if (sidebar === "root") {
      parent = new L0(this, data.direction, data.id);
    } else if (sidebar) {
      if (Yl.isMobile) return null;
      parent = new FD(this, data.direction, sidebar, data.id);
      if (data.width) parent.setSize(data.width);
      if (data.collapsed) parent.collapse();
    } else {
      parent = new OD(this, data.direction, data.id);
    }
    await fill(parent);
    if (parent.children.length === 0 && !(parent instanceof FD)) return null;
    for (let i = 0; i < data.children.length; i++) {
      const dimension = data.children[i].dimension;
      parent.children[i].setDimension(dimension);
    }
    parent.recomputeChildrenDimensions();
    return parent;
  }
  if (data.type === "floating") {
    const floating = new I0(this, data.id);
    for (let i = 0; i < data.children.length; i++) {
      if (data.children[i].type !== "window") {
        data.children.splice(i, 1);
        i--;
      }
    }
    await fill(floating);
    return floating;
  }
  if (data.type === "window" && Yl.isDesktopApp && qf >= 13) {
    const win = new O0(this, data.id, data);
    await fill(win);
    if (win.children.length === 0) return null;
    for (let i = 0; i < data.children.length; i++) {
      const dimension = data.children[i].dimension;
      win.children[i].setDimension(dimension);
    }
    win.recomputeChildrenDimensions();
    return win;
  }
  if (data.type === "tabs") {
    const tabs = new zD(this, data.id);
    if (data.stacked) tabs.setStacked(true);
    await fill(tabs);
    if (tabs.children.length === 0) return null;
    const current = data.currentTab || 0;
    tabs.selectTabIndex(current);
    tabs.recomputeChildrenDimensions();
    return tabs;
  }
  if (data.type === "leaf") {
    const leaf = new jD(this.app, data.id);
    const state = data.state || {};
    await leaf.setViewState(state);
    if (leaf.view) {
      if (data.group) leaf.setGroup(data.group);
      if (data.pinned) leaf.togglePinned();
      return leaf;
    }
    leaf.detach();
    return null;
  }
  if (data.type === "mobile-drawer") {
    if (!Yl.isMobile) return null;
    let drawer;
    if (sidebar === "left") drawer = new env()._D(this, data.id);
    else if (sidebar === "right") drawer = new env().GD(this, data.id);
    await fill(drawer);
    drawer.currentTab = data.currentTab;
    drawer.recomputeChildrenDimensions();
    if (data.pinned) drawer.setPinned(true);
    return drawer;
  }
  return null;
}

export async function wsSetLayout(data) {
  const { L0, FD, _D, GD, I0, zD, jD, $T, Yl } = env();
  this.layoutReady = false;
  const vault = this.app.vault;
  const isMobile = Yl.isMobile;
  let rootSplit;
  let leftSplit;
  let rightSplit;
  let floatingSplit;
  const main = data.main;
  if (main) {
    rootSplit = this.rootSplit = await this.deserializeLayout(main, "root");
    if (rootSplit && rootSplit.direction !== "vertical") {
      rootSplit.setDirection("vertical");
      rootSplit.recomputeChildrenDimensions();
    }
  }
  const left = data.left;
  if (left) {
    leftSplit = this.leftSplit = await this.deserializeLayout(left, "left");
    if (leftSplit && leftSplit instanceof FD && leftSplit.direction !== "horizontal") {
      leftSplit.setDirection("horizontal");
      leftSplit.recomputeChildrenDimensions();
    }
  }
  const right = data.right;
  if (right) {
    rightSplit = this.rightSplit = await this.deserializeLayout(right, "right");
    if (rightSplit && rightSplit instanceof FD && rightSplit.direction !== "horizontal") {
      rightSplit.setDirection("horizontal");
      rightSplit.recomputeChildrenDimensions();
    }
  }
  const floating = data.floating;
  if (floating) {
    floatingSplit = this.floatingSplit = await this.deserializeLayout(floating, null);
  }
  if (data["left-ribbon"]) this.leftRibbon.load(data["left-ribbon"]);
  if (!rootSplit) {
    this.rootSplit = rootSplit = new L0(this, "vertical");
    const tabs = new zD(this);
    const leaf = new jD(this.app);
    tabs.insertChild(0, leaf);
    rootSplit.insertChild(0, tabs);
    const recents = this.getLastOpenFiles();
    if (recents.length > 0) {
      const path = recents[0];
      const file = vault.getAbstractFileByPath(path);
      if (file && file instanceof $T) await leaf.openFile(file);
    }
    this.setActiveLeaf(leaf);
  }
  if (!leftSplit) {
    if (isMobile) {
      this.leftSplit = leftSplit = new _D(this);
      leftSplit.collapse();
    } else {
      this.leftSplit = leftSplit = new FD(this, "horizontal", "left");
    }
  }
  if (!rightSplit) {
    this.rightSplit = rightSplit = isMobile ? new GD(this) : new FD(this, "horizontal", "right");
    rightSplit.collapse();
  }
  if (!floatingSplit) this.floatingSplit = floatingSplit = new I0(this);
  const container = this.containerEl;
  if (Yl.isMobile) {
    container.setChildrenInPlace([leftSplit.containerEl, rootSplit.containerEl, rightSplit.containerEl]);
  } else {
    container.setChildrenInPlace([
      this.leftRibbon.containerEl,
      leftSplit.containerEl,
      rootSplit.containerEl,
      rightSplit.containerEl,
      this.rightRibbon.containerEl,
    ]);
  }
  const activeId = data.active;
  const activeLeaf = this.getLeafById(activeId);
  if (activeLeaf) this.setActiveLeaf(activeLeaf, { focus: true });
  const deferred = [];
  this.iterateAllLeaves((leaf) => {
    if (leaf.isVisible()) deferred.push(leaf.loadIfDeferred());
  });
  await Promise.all(deferred);
  this.layoutReady = true;
  this.onLayoutChange();
  this.requestActiveLeafEvents();
}

export async function wsLoadLayout() {
  const { Yl, Eu, fb, gm, jD, zD, ID, sleep, electron } = env();
  const data = await this.readWorkspaceFile();
  if (data.hasOwnProperty("lastOpenFiles")) this.recentFileTracker.load(data.lastOpenFiles);
  await this.setLayout(data);
  if (Yl.isDesktopApp && this.app.vault.getName() === "Basalt Sandbox") {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof Eu && electron.ipcRenderer.sendSync("get-sandbox-vault-path") === adapter.getBasePath()) {
      new fb(gm.interface.msgSandboxVault(), 0);
      const leaves = [];
      this.iterateLeaves([this.rootSplit, this.floatingSplit], (leaf) => {
        leaves.push(leaf);
      });
      for (const leaf of leaves) leaf.detach();
      this.updateLayout();
      const start = this.app.metadataCache.getFirstLinkpathDest("Start here", "");
      if (start && start.extension === "md") {
        await this.getLeaf().openFile(start, { active: true, state: { mode: "source", source: false } });
      }
    }
  }
  this.trigger("layout-ready");
  const callbacks = this.onLayoutReadyCallbacks;
  this.onLayoutReadyCallbacks = null;
  (async () => {
    for (let i = 0; i < callbacks.length; i++) {
      const { pluginId, callback } = callbacks[i];
      try {
        await sleep(0);
        callback();
      } catch (error) {
        console.error(error);
        if (pluginId) new fb(gm.interface.msgPluginError({ plugin: pluginId }));
      }
    }
  })();
}

export function wsUpdateLayout() {
  if (!this.layoutReady) return;
  const queue = this.layoutItemQueue;
  while (queue.length > 0) queue.pop().recomputeChildrenDimensions();
  if (this.rootSplit.children.length === 0) {
    const leaf = new env().jD(this.app);
    const tabs = new env().zD(this);
    if (this.lastTabGroupStacked) tabs.setStacked(true);
    tabs.insertChild(0, leaf);
    this.rootSplit.insertChild(0, tabs);
  }
  if (!this.activeLeaf || !this.isAttached(this.activeLeaf)) {
    const group = this.activeTabGroup;
    let leaf = null;
    if (group && group instanceof env().zD && this.isAttached(group)) {
      leaf = group.children[group.currentTab];
    }
    if (!leaf) leaf = this.getMostRecentLeaf(this.getFocusedContainer());
    if (!leaf) {
      this.iterateAllLeaves((candidate) => {
        if (!leaf || leaf.activeTime < candidate.activeTime) leaf = candidate;
      });
    }
    if (!leaf) leaf = this.createLeafInParent(this.rootSplit, 0);
    this.setActiveLeaf(leaf, { focus: true });
  }
  const previous = this.activeLeaf?.parent;
  if (previous !== this.activeTabGroup) {
    this.activeTabGroup?.containerEl.removeClass("mod-active");
    this.activeTabGroup = previous;
    previous?.containerEl.addClass("mod-active");
  }
  this.updateMobileVisibleTabGroup();
  const groups = {};
  this.iterateAllLeaves((leaf) => {
    const group = leaf.group;
    if (group) groups[group] = (groups[group] || 0) + 1;
  });
  for (const key in groups) {
    if (groups.hasOwnProperty(key) && groups[key] === 1) {
      const leaves = this.getGroupLeaves(key);
      for (let i = 0; i < leaves.length; i++) leaves[i].setGroup(null);
    }
  }
  this.updateFrameless();
  this.updateTitle();
  this.requestSaveLayout();
  this.requestResize();
  this.requestLayoutChangeEvents();
}

export function wsUpdateFrameless() {
  const { zD, ID, OD, O0, WD, Yl, dl, PD, yl, electronWindow } = env();
  const self = this;
  if (!this.layoutReady) return;
  const root = this.rootSplit;
  const left = this.leftSplit;
  const right = this.rightSplit;
  const floating = this.floatingSplit;
  const allTabs = [];
  const collectAll = (item) => {
    if (item instanceof zD) allTabs.push(item);
    else if (item instanceof ID) {
      for (let i = 0; i < item.children.length; i++) collectAll(item.children[i]);
    }
  };
  collectAll(root);
  collectAll(left);
  collectAll(right);
  collectAll(floating);
  for (let i = 0; i < allTabs.length; i++) {
    allTabs[i].containerEl.removeClass("mod-top", "mod-top-left-space", "mod-top-right-space");
  }
  const update = (topItem) => {
    const tabs = [];
    const collect = (item) => {
      if (item instanceof zD) tabs.push(item);
      else if (item instanceof OD) {
        if (item.direction === "vertical") {
          for (let i = 0; i < item.children.length; i++) collect(item.children[i]);
        } else {
          const first = item.children[0];
          if (first) collect(first);
        }
      }
    };
    collect(topItem);
    for (let i = 0; i < tabs.length; i++) tabs[i].containerEl.addClass("mod-top");
    let leftSpace = null;
    let rightSpace = null;
    let leftSpaceTabs = null;
    let rightSpaceTabs = null;
    if (tabs.length > 0) {
      leftSpaceTabs = leftSpace = tabs[0];
      rightSpaceTabs = rightSpace = tabs[tabs.length - 1];
    }
    if (topItem === root) {
      const leftFirst = left.children[0];
      const rightFirst = right.children[0];
      if (leftFirst instanceof zD) {
        leftFirst.containerEl.addClass("mod-top", "mod-top-left-space");
        if (!left.collapsed) leftSpace = leftFirst;
      }
      if (rightFirst instanceof zD) {
        rightFirst.containerEl.addClass("mod-top", "mod-top-right-space");
        if (!right.collapsed) rightSpace = rightFirst;
      }
      const leftButton = self.leftSidebarToggleButtonEl;
      const rightButton = self.rightSidebarToggleButtonEl;
      const moveButton = (button, target, options) => {
        const oldParent = button.parentElement;
        if (target === oldParent) return;
        const prepend = options.prepend;
        const oldStyle = options.oldStyle;
        const newStyle = options.newStyle;
        let width = button.offsetWidth;
        let oldPad = oldParent ? parseInt(getComputedStyle(oldParent).paddingLeft) : 0;
        let newPad = target ? parseInt(getComputedStyle(target).paddingLeft) : 0;
        if (isNaN(oldPad)) oldPad = 0;
        if (isNaN(newPad)) newPad = 0;
        if (oldParent && oldStyle !== "") {
          const clone = button.cloneNode(true);
          button.replaceWith(clone);
          const transition = new dl(PD);
          if (oldStyle === "offset") {
            transition.addProp("margin-left", newPad + "px", -width + "px").addProp("left", "", -oldPad + "px");
          } else if (oldStyle !== "none") {
            transition.addProp("overflow", "hidden", "hidden", "").addProp("width", width + "px", "0");
          }
          yl(clone, transition, () => clone.detach());
        }
        if (prepend) target.prepend(button);
        else target.appendChild(button);
        if (oldParent && newStyle !== "") {
          const transition = new dl(PD);
          if (newStyle === "offset") {
            transition.addProp("margin-left", -(width + oldPad) + "px", "").addProp("left", -oldPad + "px", "");
          } else if (newStyle !== "none") {
            transition.addProp("overflow", "hidden", "hidden", "").addProp("width", "0", width + "px", "");
          }
          yl(button, transition);
        }
      };
      const hideLeftRibbon = Yl.isDesktopApp && (!self.leftRibbon.containerEl.isShown() || (Yl.isMacOS && window.titlebarStyle === "hidden"));
      if (hideLeftRibbon || Yl.isTablet) {
        if (!left.collapsed && leftFirst instanceof zD) {
          moveButton(leftButton, leftFirst.tabHeaderContainerEl, { oldStyle: "offset", newStyle: "" });
        } else if (left.collapsed && leftSpaceTabs) {
          moveButton(leftButton, leftSpaceTabs.tabHeaderContainerEl, { prepend: true, oldStyle: "none", newStyle: "offset" });
        }
      } else {
        self.leftRibbon.containerEl.prepend(leftButton);
      }
      if (Yl.isTablet && left instanceof WD && left.isPinned) leftButton.detach();
      const showRightButton = Yl.isDesktopApp && !right.collapsed &&
        (Yl.isMacOS || window.titlebarStyle !== "hidden" || electronWindow.isFullScreen());
      if (showRightButton) {
        if (rightFirst instanceof zD) moveButton(rightButton, rightFirst.tabHeaderContainerEl, { newStyle: "" });
      } else if (rightSpaceTabs) {
        moveButton(rightButton, rightSpaceTabs.tabHeaderContainerEl, { oldStyle: "none", newStyle: "" });
      }
      if (Yl.isTablet && right instanceof WD && right.isPinned) rightButton.detach();
    }
    if (Yl.isDesktopApp) {
      if (leftSpace) leftSpace.containerEl.addClass("mod-top-left-space");
      if (rightSpace) rightSpace.containerEl.addClass("mod-top-right-space");
    }
  };
  update(root);
  for (let i = 0; i < floating.children.length; i++) {
    const child = floating.children[i];
    if (child instanceof O0) update(child);
  }
  this.trigger("window-frame-change");
}

export function wsOnDragLeaf(event, leaf) {
  const { Yl, FD, jD, zD, ID, OD, WD, Yg, tD, Nc, TP, tv, gc, createDiv, electronWindow } = env();
  const self = this;
  if (Yl.isPhone) {
    event.preventDefault();
    return;
  }
  const onTouchEnd = (e) => {
    if (e.touches.length === 0) cleanup();
  };
  if (Yl.isMobile) window.addEventListener("touchend", onTouchEnd);
  if (Yl.isIosApp) {
    Nc();
    navigator.vibrate(200);
  }
  event.dataTransfer.setData("text/plain", "");
  const ghost = createDiv("drag-ghost mod-leaf", (el) => {
    el.createDiv("drag-ghost-icon", (icon) => tv(icon, leaf.getIcon()));
    el.createSpan({ text: gc(leaf.getDisplayText(), 60) });
  });
  if (Yl.isMobile) {
    TP(event);
  } else {
    event.doc.body.appendChild(ghost);
    event.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => ghost.detach());
  }
  const dragManager = this.app.dragManager;
  let fakeTarget = null;
  const fakeOverlay = createDiv("workspace-fake-target-overlay");
  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;
  let hiddenEl = null;
  leaf.loadIfDeferred();
  const getDirections = (target, isSidebar) => {
    if (target instanceof FD) return ["left", "right", "top", "bottom"];
    return isSidebar ? ["left", "right"] : null;
  };
  const hideOverlay = () => {
    if (hiddenEl) hiddenEl.style.opacity = null;
    dragManager.hideOverlay();
    fakeOverlay.hide();
  };
  const onDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "none";
    const x = e.clientX;
    const y = e.clientY;
    if (!dragging) {
      const dx = x - startX;
      const dy = y - startY;
      if (dx * dx + dy * dy < 25) return;
      dragging = true;
      document.body.addClass("is-grabbing");
    }
    const doc = e.doc;
    const target = self.getDropLocation(e);
    if (target && target !== leaf) {
      if (Yl.isMobile) {
        ghost.style.left = x - ghost.offsetWidth / 2 + "px";
        ghost.style.top = y - ghost.offsetHeight - 20 + "px";
        if (ghost.parentNode !== doc.body) doc.body.appendChild(ghost);
        ghost.show();
      }
      const root = target.getRoot();
      const isSidebar = root === self.leftSplit || root === self.rightSplit;
      if (leaf.view instanceof Yg || root === self.leftSplit || root === self.rightSplit) {
        let rect = target.containerEl.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const left = rect.x;
        const top = rect.y;
        const direction = self.getDropDirection(e, rect, getDirections(target, isSidebar), target);
        if (target instanceof zD || target !== leaf.parent || (direction !== "center" && leaf.parent.children.length !== 1)) {
          e.dataTransfer.dropEffect = "move";
          if (target === self.leftSplit && self.leftSplit.collapsed) {
            rect = self.leftSidebarToggleButtonEl.getBoundingClientRect();
          } else if (target === self.rightSplit && self.rightSplit.collapsed) {
            rect = self.rightSidebarToggleButtonEl.getBoundingClientRect();
          } else if (target instanceof zD && direction === "center") {
            rect = target.getTabInsertLocation(x).rect;
          }
          if (target instanceof ID && target.children.length === 1 && target.children[0] === leaf) {
            hideOverlay();
          } else {
            dragManager.showOverlay(doc, rect);
            if (direction === "center") {
              if (hiddenEl) hiddenEl.style.opacity = null;
              fakeOverlay.hide();
              return;
            }
            let fx;
            let fy;
            let fw;
            let fh;
            if (direction === "top") {
              fx = rect.x; fy = top + rect.height; fw = width; fh = height - rect.height;
            } else if (direction === "left") {
              fx = left + rect.width; fy = rect.y; fw = width - rect.width; fh = height;
            } else if (direction === "right") {
              fx = left; fy = top; fw = width - rect.width; fh = height;
            } else {
              fx = left; fy = top; fw = width; fh = height - rect.height;
            }
            if (!fakeTarget || !hiddenEl || target.containerEl !== hiddenEl) {
              if (hiddenEl) hiddenEl.style.opacity = null;
              fakeOverlay.empty();
              fakeOverlay.appendChild(target.containerEl.cloneNode(true));
              target.containerEl.style.opacity = "0";
              hiddenEl = target.containerEl;
              let wrapper = fakeOverlay;
              let node = target.containerEl.parentElement;
              const body = node.doc.body;
              while (node && node !== body) {
                const clone = createDiv(node.className);
                clone.appendChild(wrapper);
                wrapper = clone;
                node = node.parentElement;
              }
              if (fakeTarget) fakeTarget.detach();
              fakeTarget = wrapper;
            }
            target.containerEl.style.opacity = direction === "center" ? null : "0";
            if (fakeTarget.parentNode !== doc.body) {
              fakeTarget.addClass("workspace-fake-target-container");
              doc.body.appendChild(fakeTarget);
            }
            fakeOverlay.toggle(direction !== "center");
            fakeOverlay.toggleClass("is-in-sidebar", root !== self.rootSplit);
            fakeOverlay.style.transform = "translate(" + fx + "px, " + fy + "px)";
            fakeOverlay.style.width = fw + "px";
            fakeOverlay.style.height = fh + "px";
          }
        } else {
          hideOverlay();
        }
      } else {
        hideOverlay();
      }
    } else {
      hideOverlay();
    }
  };
  let popoutCandidate = false;
  const onDrop = (e) => {
    popoutCandidate = false;
    cleanup();
    if (!dragging) return;
    const target = self.getDropLocation(e);
    if (target && target !== leaf) {
      const root = target.getRoot();
      const isSidebar = root === self.leftSplit || root === self.rightSplit;
      const oldParent = leaf.parent;
      if (target instanceof ID && (target === self.leftSplit || target === self.rightSplit)) {
        oldParent.removeChild(leaf);
        leaf.setDimension(null);
        if (Yl.isMobile) {
          target.insertChild(-1, leaf);
        } else {
          const first = target.children.first();
          let tabs;
          if (first instanceof zD) tabs = first;
          else {
            tabs = new zD(self);
            target.insertChild(-1, tabs);
          }
          tabs.insertChild(-1, leaf);
        }
        self.requestResize();
      } else if (leaf.view instanceof Yg || root === self.leftSplit || root === self.rightSplit) {
        const rect = target.containerEl.getBoundingClientRect();
        const direction = self.getDropDirection(e, rect, getDirections(target, isSidebar), target);
        if (target instanceof zD || target !== leaf.parent || (direction !== "center" && leaf.parent.children.length !== 1)) {
          if (isSidebar) leaf.setGroupMember(null);
          if (target instanceof zD && direction === "center") {
            let index = target.getTabInsertLocation(e.clientX).index;
            if (oldParent === target) {
              const oldIndex = target.children.indexOf(leaf);
              if (index > oldIndex) index--;
              if (oldIndex === index) return;
            }
            oldParent.removeChild(leaf);
            leaf.setDimension(null);
            target.insertChild(index, leaf);
            target.selectTabIndex(target.children.indexOf(leaf));
            self.requestResize();
            return;
          }
          if (target instanceof ID && target.children.length === 1 && target.children[0] === leaf) {
            // no-op
          } else {
            const parent = target.parent;
            if (parent && parent instanceof OD) {
              const axis = direction === "top" || direction === "bottom" ? "horizontal" : "vertical";
              let newParent;
              if (isSidebar) {
                newParent = new zD(self);
                self.splitLeaf(target, newParent, axis, direction === "left" || direction === "top");
                oldParent.removeChild(leaf);
                leaf.setDimension(null);
                newParent.insertChild(0, leaf);
              } else if (direction === "center") {
                const leafIndex = oldParent.children.indexOf(leaf);
                const targetIndex = parent.children.indexOf(target);
                const leafDim = leaf.dimension;
                const targetDim = target.dimension;
                const newLeaf = new jD(self.app);
                parent.replaceChild(targetIndex, newLeaf);
                oldParent.replaceChild(leafIndex, target);
                parent.replaceChild(targetIndex, leaf);
                leaf.setDimension(targetDim);
                target.setDimension(leafDim);
                if (target instanceof jD && target.view instanceof tD) target.detach();
              } else {
                oldParent.removeChild(leaf);
                leaf.setDimension(null);
                self.splitLeaf(target, leaf, axis, direction === "left" || direction === "top");
              }
              self.requestResize();
            }
          }
        }
      }
    }
  };
  const cleanup = () => {
    window.removeEventListener("touchend", onTouchEnd);
    window.removeEventListener("dragover", onDragOver);
    window.removeEventListener("dragenter", onDragEnter);
    window.removeEventListener("dragleave", onDragLeave);
    window.removeEventListener("dragend", cleanup, { capture: true });
    window.removeEventListener("drop", onDrop);
    if (hiddenEl) hiddenEl.style.opacity = null;
    dragManager.removeOverlay();
    ghost.detach();
    if (fakeTarget) fakeTarget.detach();
    fakeOverlay.detach();
    document.body.removeClass("is-grabbing");
    if (Yl.isMobile && !dragging) {
      event.target.dispatchEvent(new MouseEvent("contextmenu", {
        button: 0, buttons: 0,
        ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey, shiftKey: event.shiftKey,
        screenX: event.screenX, screenY: event.screenY,
        bubbles: true, cancelable: true,
        clientX: event.clientX, clientY: event.clientY,
      }));
    }
    if (Yl.isDesktopApp && event && popoutCandidate && leaf.view instanceof Yg) {
      const rect = leaf.containerEl.getBoundingClientRect();
      const zoom = leaf.containerEl.win.electron.webFrame.getZoomLevel();
      popoutCandidate = false;
      if (leaf.parent) leaf.parent.removeChild(leaf);
      leaf.setDimension(null);
      self.openPopout({ x: event.screenX, y: event.screenY, size: rect, zoom: zoom })
        .insertChild(0, zD.createFrom(self, leaf));
      self.setActiveLeaf(leaf, { focus: true });
    }
  };
  const onDragEnter = (e) => {
    if (e.target) popoutCandidate = false;
    onDragOver(e);
  };
  const onDragLeave = (e) => {
    if (e.relatedTarget || e.buttons === 0) return;
    hideOverlay();
    e.win.setTimeout(() => { popoutCandidate = true; }, 10);
  };
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("dragenter", onDragEnter);
  window.addEventListener("dragleave", onDragLeave);
  window.addEventListener("dragend", cleanup, { capture: true });
  window.addEventListener("drop", onDrop);
}
