// File explorer ("file-explorer"): the sidebar tree of the vault.
//
// FileExplorerView (D8) owns a FileExplorerTree (T8, a Tree with prefersCollapsed) whose rows are
// FileExplorerItemBase (k8: drag source, rename via contenteditable, title measurement) specialised into
// FileItem (E8) and FolderItem (S8, collapsible). The plugin (P8) wires commands, the "file-menu" /
// "files-menu" / "hover-link" events, the side leaf and revealInFolder.
//
// Helpers ported alongside: the item->file map, the promise queue, the touch/mouse guards, the
// "basalt/files" clipboard format (copy/cut/paste of vault files), the drop handler with folder
// auto-expand, rename validation and the sort-order tables.

import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { makeTreePusher, markItemCollapsed, collapsibleTreeItem } from "./tree.js";
import { fileClass } from "./vault.js";
import { baseName, extensionOf, lastSegment, withoutExtension } from "./path.js";
import { ng08FlattenUniqueFiles } from "./n-g08-bookmarks.js";
import { sortOrderComparator, SEARCH_SORT_GROUPS } from "./n-g11-view.js";
import { displayTooltip, hideTooltip, setElementTooltip } from "./tooltip.js";
import { preventMiddleClick } from "./n-g11-view.js";

// Classes produced by the factories below, visible to each other regardless of factory order.
const explorer = {};

const VIEW_TYPE_FILE_EXPLORER = "file-explorer";
const CLIPBOARD_FILES_TYPE = "basalt/files";
const FILE_TOOLTIP_DELAY = 1000;
const MD_ONLY_TAGS = ["md"];

// host is provided per factory; explorerHost is bound by the first factory that runs (all share the same host).
let explorerHost = null;
function bindExplorerHost(host) {
  explorerHost = host;
  return host;
}

const ExplorerFile = () => fileClass("TFile");
const ExplorerFolder = () => fileClass("TFolder");
const feStrings = () => explorerHost.t.plugins.fileExplorer;

// Case-insensitive, numeric-aware name comparison (same collator the rest of the app sorts with).
const nameCollator = new Intl.Collator(undefined, { usage: "sort", sensitivity: "base", numeric: true }).compare;

// Sort orders offered by the header sort button (pairs of normal/reverse), with their labels.
// SEARCH_SORT_GROUPS comes from search-view.js; read it lazily so module order cannot hit a TDZ.
function sortOrderGroups() { return SEARCH_SORT_GROUPS; }
function sortOrderLabels() {
  const t = feStrings();
  return {
    alphabetical: () => t.labelSortAToZ(),
    alphabeticalReverse: () => t.labelSortZToA(),
    byModifiedTime: () => t.labelSortNewToOld(),
    byModifiedTimeReverse: () => t.labelSortOldToNew(),
    byCreatedTime: () => t.labelSortCreatedNewToOld(),
    byCreatedTimeReverse: () => t.labelSortCreatedOldToNew(),
  };
}

// =====================================================================================================================
// Small helpers
// =====================================================================================================================

/** Serial promise queue: each task waits for the previous one (success or failure). */
function PromiseQueue() {
  this.promise = Promise.resolve();
}
PromiseQueue.prototype.queue = function (task) {
  const next = this.promise.then(task, task);
  this.promise = next;
  return next;
};

let itemFileMapId = 0;
/** element -> vault item map; WeakMap where available, expando-property fallback otherwise. */
function ItemFileMap() {
  if (typeof WeakMap === "function") {
    this.map = new WeakMap();
    this.key = null;
  } else {
    this.map = null;
    this.key = "_basaltItemFile_" + (++itemFileMapId);
  }
}
ItemFileMap.prototype.get = function (el) { return this.map ? this.map.get(el) : el[this.key]; };
ItemFileMap.prototype.set = function (el, item) { if (this.map) this.map.set(el, item); else el[this.key] = item; };
ItemFileMap.prototype.delete = function (el) { if (this.map) this.map.delete(el); else delete el[this.key]; };

/** True when the pointer really left `el` (relatedTarget outside it). */
function pointerLeftElement(event, el) {
  const target = event.relatedTarget;
  return !target || !el.contains(target);
}

/** Filters out the synthetic mouse events browsers fire right after a touch. */
function isSyntheticMouseEvent(event) {
  if (!(event instanceof MouseEvent)) return false;
  if (explorerHost.activeTouches > 0) return true;
  const now = Date.now();
  return now - explorerHost.lastTouchEnd < 400 || (explorerHost.Platform.isIosApp && now - explorerHost.lastScrollAt < 100);
}

/** DOM template factory: the callback builds the element once, every call returns a clone. */
function domTemplate(build) {
  let template = null;
  return function () {
    if (!template) {
      template = build();
      build = null;
    }
    return template.cloneNode(true);
  };
}

/** Places the caret at the start (false) or end (true) of a contenteditable element. */
function selectEditableContents(el, toEnd) {
  el.focus({ preventScroll: true });
  const win = el.win;
  const range = win.document.createRange();
  range.selectNodeContents(el);
  if (typeof toEnd === "boolean") range.collapse(toEnd);
  const selection = win.getSelection();
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(range);
    if (explorerHost.Platform.isMobile) {
      setTimeout(() => el.scrollIntoView({ block: "nearest" }), 0);
    }
  }
}

// =====================================================================================================================
// Clipboard ("basalt/files"): copy/cut/paste of vault files through the system clipboard
// =====================================================================================================================

function clipboardHasFiles(data) {
  for (let i = 0; i < data.items.length; i++) {
    if (data.items[i].kind === "file") return true;
  }
  return !!(explorerHost.Platform.isIosApp && data.types.indexOf("Files") !== -1);
}

function fileDataFromItem(item) {
  if (item.arrayBuffer) return item.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onabort = reader.onerror = (event) => reject(event);
    reader.readAsArrayBuffer(item);
  });
}

function readFileBuffer(path) {
  try {
    const fs = window.require("fs");
    if (fs && fs.existsSync(path)) return fs.promises.readFile(path);
  } catch (err) { /* not a desktop runtime */ }
  return Promise.resolve(null);
}

function bufferToArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/**
 * Extracts { name, filepath, extension, data } entries from a paste/drop DataTransfer.
 * `source` is "drop" | "clipboard"; `asFiles` additionally loads the file bytes.
 */
async function clipboardFilesData(dataTransfer, source, asFiles) {
  const entries = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    let path = file.path || "";
    const name = file.name;
    let extension = extensionOf(name);
    let base = baseName(name);
    let data = null;
    if (explorerHost.Platform.isDesktopApp) {
      const electron = window.require("electron");
      if (electron && electron.webUtils) path = electron.webUtils.getPathForFile(file);
    }
    if (!path) {
      const type = file.type;
      if (type === "image/png") { extension = "png"; base = "Pasted image"; }
      else if (type === "image/jpeg") { extension = "jpg"; base = "Pasted image"; }
    }
    if (asFiles) data = path ? readFileBuffer(path) : fileDataFromItem(file);
    entries.push({ name: base, filepath: path, extension, data });
  }
  if (source === "clipboard" && entries.length === 0 && explorerHost.Platform.isDesktopApp &&
      !dataTransfer.getData("text/plain") && !explorerHost.Keymap.global.hasModifier("Shift")) {
    const electron = window.require("electron");
    const entry = (() => {
      if (!electron) return null;
      const clipboard = electron.remote.clipboard;
      const image = clipboard.readImage();
      if (image && !image.isEmpty()) {
        return { name: "Pasted image", extension: "png", data: Promise.resolve(bufferToArrayBuffer(image.toPNG())) };
      }
      let path = "";
      if (explorerHost.isWindows) path = clipboard.readBuffer("FileNameW").toString("ucs2").replace("\0", "");
      else if (explorerHost.isMacOS) {
        path = clipboard.read("public.file-url") || "";
        if (path) path = decodeURI(path.replace("file://", ""));
      }
      if (!path) return null;
      const fileName = lastSegment(normalizePath(path));
      return { filepath: path, name: baseName(fileName), extension: extensionOf(fileName), data: readFileBuffer(path) };
    })();
    if (entry) entries.push(entry);
  }
  return entries;
}

/** Moves `files` into `folder`, renaming on collision; returns a promise of the move operation. */
async function moveFilesIntoFolder(app, files, folder) {
  return app.fileManager.runAsyncLinkUpdate(async () => {
    const vault = app.vault;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.parent === folder) continue;
      let target = file.name;
      if (folder.path !== "/") target = folder.path + "/" + target;
      if (file instanceof ExplorerFile()) {
        const ext = withoutExtension(target);
        const name = extensionOf(lastSegment(target));
        target = vault.getAvailablePath(ext, name);
      } else if (file instanceof ExplorerFolder()) {
        target = vault.getAvailablePath(target);
      }
      await vault.rename(file, target);
    }
  });
}

/** True when `file` may be dropped into `folder` (not into itself or a descendant). */
function canMoveInto(file, folder) {
  return file !== folder &&
    !(file instanceof ExplorerFolder() && file.isRoot()) &&
    !(file instanceof ExplorerFolder() && folder.path.startsWith(file.path + "/"));
}

/** The subset of `files` that can move into `folder`, deduplicated by flattenUniqueFiles. */
function movableFiles(files, folder) {
  const movable = [];
  for (const file of files) if (canMoveInto(file, folder)) movable.push(file);
  return ng08FlattenUniqueFiles(movable);
}

// =====================================================================================================================
// Tree and items
// =====================================================================================================================

export function defineFileExplorerTree(host) {
  bindExplorerHost(host);

  function FileExplorerTree(view, options) {
    const self = host.Tree.call(this, view, options) || this;
    self.prefersCollapsed = true;
    return self;
  }
  inherit(FileExplorerTree, host.Tree);
  const proto = FileExplorerTree.prototype;

  proto.selectItem = function (item) {
    if ((!this.app.vault.getConfig("showUnsupportedFiles") && item instanceof explorer.FileItem && !item.isSupported())) {
      // hidden unsupported files cannot be selected
    } else {
      host.Tree.prototype.selectItem.call(this, item);
    }
  };

  proto.onKeyArrowRight = function (event) {
    if (this.focusedItem && this.focusedItem instanceof explorer.FileItem) {
      this.focusedItem.onSelfClick(event);
    } else {
      host.Tree.prototype.onKeyArrowRight.call(this, event);
    }
  };

  explorer.Tree = FileExplorerTree;
  return FileExplorerTree;
}

const FILE_ITEM_TEMPLATE = domTemplate(() => {
  const el = createDiv("tree-item nav-file");
  el.createDiv("tree-item-self nav-file-title tappable is-clickable").createDiv("tree-item-inner nav-file-title-content");
  return el;
});

const FOLDER_ITEM_TEMPLATE = domTemplate(() => {
  const el = createDiv("tree-item nav-folder");
  el.createDiv("tree-item-self nav-folder-title is-clickable").createDiv("tree-item-inner nav-folder-title-content");
  el.createDiv("tree-item-children nav-folder-children");
  return el;
});

export function defineFileExplorerItemBase(host) {
  bindExplorerHost(host);

  function FileExplorerItemBase(view, file, el) {
    const self = host.TreeItem.call(this, el) || this;
    self.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
    self.rendered = false;
    self.view = view;
    self.file = file;
    return self;
  }
  inherit(FileExplorerItemBase, host.TreeItem);
  const proto = FileExplorerItemBase.prototype;

  proto.updateTitle = function () {
    this.innerEl.setText(this.getTitle());
    this.selfEl.setAttr("data-path", this.file.path);
  };

  proto.onRender = function () {
    const self = this;
    if (this.rendered) return;
    this.rendered = true;
    this.updateTitle();
    const selfEl = this.selfEl;
    const view = this.view;
    const dragManager = view.app.dragManager;
    dragManager.handleDrag(selfEl, (event) => {
      if (view.fileBeingRenamed) return null;
      const files = view.dragFiles(event, self);
      if (files) return files;
      dragManager.updateSource([selfEl], "is-being-dragged");
      const file = self.file;
      if (file instanceof ExplorerFile()) return dragManager.dragFile(event, file);
      if (file instanceof ExplorerFolder()) return dragManager.dragFolder(event, file);
      return null;
    });
  };

  /** True when the whole title fits without scrolling (used to decide whether a tooltip is needed). */
  proto.isFullTitleShown = function () {
    const selfEl = this.selfEl;
    const innerEl = this.innerEl;
    const parent = selfEl.offsetParent;
    const left = parseInt(getComputedStyle(selfEl).paddingLeft) + selfEl.offsetLeft;
    const width = parent.clientWidth;
    return left + innerEl.scrollWidth <= width + parent.scrollLeft;
  };

  proto.startRename = function () {
    const selfEl = this.selfEl;
    const innerEl = this.innerEl;
    selfEl.addClass("is-being-renamed");
    innerEl.setAttribute("contenteditable", "true");
    const spellcheck = this.view.app.vault.getConfig("spellcheck");
    innerEl.setAttribute("spellcheck", String(spellcheck));
    selectEditableContents(innerEl);
  };

  proto.stopRename = function () {
    const innerEl = this.innerEl;
    this.selfEl.removeClass("is-being-renamed");
    innerEl.removeAttribute("contenteditable");
    innerEl.scrollLeft = 0;
    const tooltip = innerEl.parentElement.find(".tooltip");
    if (tooltip) tooltip.remove();
  };

  explorer.ItemBase = FileExplorerItemBase;
  return FileExplorerItemBase;
}

export function defineFileItem(host) {
  bindExplorerHost(host);

  function FileItem(view, file) {
    const self = explorer.ItemBase.call(this, view, file, FILE_ITEM_TEMPLATE()) || this;
    self.tagEl = null;
    return self;
  }
  inherit(FileItem, explorer.ItemBase);
  const proto = FileItem.prototype;

  proto.getTitle = function () { return this.file.basename; };

  proto.updateTitle = function () {
    explorer.ItemBase.prototype.updateTitle.call(this);
    const selfEl = this.selfEl;
    let tagEl = this.tagEl;
    selfEl.toggleClass("is-unsupported", !this.isSupported());
    const extension = this.file.extension;
    if (MD_ONLY_TAGS.includes(extension)) {
      if (tagEl) {
        tagEl.detach();
        this.tagEl = null;
      }
    } else {
      if (!tagEl) tagEl = this.tagEl = selfEl.createDiv({ cls: "nav-file-tag" });
      tagEl.setText(extension);
    }
  };

  proto.isSupported = function () {
    return this.view.app.viewRegistry.isExtensionRegistered(this.file.extension);
  };

  proto.onSelfClick = function (event) {
    if (this.view.tree.handleItemSelection(event, this)) return;
    const workspace = this.view.app.workspace;
    if (event instanceof KeyboardEvent && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      workspace.getUnpinnedLeaf(false).openFile(this.file, { active: false });
      workspace.trigger("file-open", this.file);
    } else {
      workspace.getLeaf(host.Keymap.isModEvent(event)).openFile(this.file);
      workspace.setActiveLeaf(workspace.getMostRecentLeaf(), { focus: true });
    }
  };

  explorer.FileItem = FileItem;
  return FileItem;
}

export function defineCollapsibleFileItem(host) {
  bindExplorerHost(host);
  explorer.CollapsibleItem = collapsibleTreeItem(explorer.ItemBase);
  return explorer.CollapsibleItem;
}

export function defineFolderItem(host) {
  bindExplorerHost(host);
  if (!explorer.CollapsibleItem) explorer.CollapsibleItem = collapsibleTreeItem(explorer.ItemBase);
  const CollapsibleItem = explorer.CollapsibleItem;

  function FolderItem(view, file) {
    const self = CollapsibleItem.call(this, view, file, FOLDER_ITEM_TEMPLATE()) || this;
    self.vChildren = new host.TreeChildren(self);
    self.pusherEl = makeTreePusher();
    self.setCollapsible(true);
    self.collapsed = true;
    markItemCollapsed(self.el, true);
    self.childrenEl.detach();
    return self;
  }
  inherit(FolderItem, CollapsibleItem);
  const proto = FolderItem.prototype;

  proto.getTitle = function () {
    const file = this.file;
    let title = file.name;
    if (file.isRoot()) title = file.vault.getName();
    return title;
  };

  proto.onSelfClick = function (event) {
    if (event instanceof MouseEvent && event.button !== 0) return;
    if (this.view.fileBeingRenamed === this.file) return;
    if (this.view.tree.handleItemSelection(event, this)) return;
    this.toggleCollapsed(true);
  };

  proto.setCollapsed = async function (collapsed, animate) {
    if (this.collapsed === collapsed) return;
    const view = this.view;
    const childrenEl = this.childrenEl;
    const tree = view.tree;
    childrenEl.style.minHeight = "";
    tree.infinityScroll.invalidate(this, true);
    await CollapsibleItem.prototype.setCollapsed.call(this, collapsed, animate);
    tree.infinityScroll.invalidate(this, true);
    if (!collapsed && !this.file.isRoot()) view.setIsAllCollapsed(false);
    if (view.ready) tree.requestSaveFolds();
  };

  proto.sort = function () {
    const view = this.view;
    this.vChildren.setChildren(view.getSortedFolderItems(this.file));
  };

  explorer.FolderItem = FolderItem;
  return FolderItem;
}

// =====================================================================================================================
// The view (D8)
// =====================================================================================================================

export function defineFileExplorerView(host) {
  bindExplorerHost(host);

  function FileExplorerView(leaf) {
    const self = host.View.call(this, leaf) || this;
    self.icon = "lucide-folder-closed";
    self.activeDom = null;
    self.collapseOrExpandAllEl = null;
    self.ready = false;
    self.sortOrder = "alphabetical";
    self.autoRevealFile = false;
    self.fileBeingRenamed = null;
    self.workQueue = new PromiseQueue();
    self.itemsBeingCut = [];
    self.requestSort = debounceCall(self.sort.bind(self), 20);
    self._revealActiveFileQueued = false;
    self._sortQueued = false;
    self.mouseoverExpandTimeout = null;
    self.lastDropTargetEl = null;

    const containerEl = self.containerEl;
    self.navFileContainerEl = containerEl.createDiv("nav-files-container");
    const scope = (self.scope = new host.Scope(self.app.scope));
    self.tree = new explorer.Tree(self, {
      app: self.app,
      containerEl: self.navFileContainerEl,
      id: VIEW_TYPE_FILE_EXPLORER,
      scope,
      getNodeId: self.getNodeId.bind(self),
      handleDeleteSelectedItems: self.onDeleteSelectedFiles.bind(self),
      handleRenameFocusedItem: self.onKeyRename.bind(self),
      handleCollapseAll: self.setIsAllCollapsed.bind(self),
    });
    self.tree.infinityScroll.setWidth = true;

    const header = (self.headerDom = new host.ViewHeader(self.app, containerEl));
    header.addNavButton("lucide-edit", feStrings().actionNewNote(), self.onCreateNewNoteClick.bind(self));
    header.addNavButton("lucide-folder-plus", feStrings().actionNewFolder(), self.onCreateNewFolderClick.bind(self));
    header.addSortButton(sortOrderGroups(), sortOrderLabels, (order) => self.setSortOrder(order), () => self.sortOrder);
    self.autoRevealButtonEl = header.addNavButton("lucide-gallery-vertical", feStrings().actionAutoReveal(), self.onToggleAutoReveal.bind(self));
    self.collapseOrExpandAllEl = header.addNavButton("lucide-chevrons-up-down", feStrings().actionExpandAll(), () => self.tree.toggleCollapseAll());

    self.fileItems = {};
    self.files = new ItemFileMap();
    self.fileRenameScope = new host.Scope(self.app.scope);
    self.fileRenameScope.register([], "Enter", self.onKeyEnterInRename.bind(self));
    self.fileRenameScope.register([], "Escape", self.onKeyEscInRename.bind(self));

    preventMiddleClick(containerEl);
    containerEl.on("click", ".nav-file-title, .nav-folder-title", self.onFileClick.bind(self));
    containerEl.on("auxclick", ".nav-file-title, .nav-folder-title", self.onFileClick.bind(self));
    containerEl.on("pointerover", ".nav-file-title, .nav-folder-title", self.onFilePointerover.bind(self));
    containerEl.on("pointerout", ".nav-file-title, .nav-folder-title", self.onFilePointerout.bind(self));
    containerEl.on("contextmenu", ".nav-file-title, .nav-folder-title", self.openFileContextMenu.bind(self));
    containerEl.on("blur", ".nav-file-title-content, .nav-folder-title-content", self.onTitleBlur.bind(self), { capture: true });
    containerEl.on("input", ".nav-file-title-content, .nav-folder-title-content", self.onFileRenameInput.bind(self));
    return self;
  }
  inherit(FileExplorerView, host.View);
  const proto = FileExplorerView.prototype;

  proto.isItem = function (item) { return item instanceof explorer.ItemBase; };
  proto.getNodeId = function (item) { return item.file.path; };

  proto.getState = function () {
    const state = host.View.prototype.getState.call(this);
    state.sortOrder = this.sortOrder;
    state.autoReveal = this.autoRevealFile;
    return state;
  };

  proto.setState = async function (state, result) {
    const autoReveal = state.autoReveal;
    const sortOrder = state.sortOrder;
    if (typeof autoReveal === "boolean") this.setAutoReveal(autoReveal);
    if (sortOrder && this.sortOrder !== sortOrder) {
      this.sortOrder = state.sortOrder;
      this.requestSort();
    }
    if (state.hasOwnProperty("newFile") && typeof state.newFile === "string") {
      const path = state.newFile;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file) this.afterCreate(file, false);
    }
    await host.View.prototype.setState.call(this, state, result);
  };

  proto.setIsAllCollapsed = function (collapsed) {
    this.tree.isAllCollapsed = collapsed;
    if (collapsed) {
      host.setIcon(this.collapseOrExpandAllEl, "lucide-chevrons-up-down");
      setElementTooltip(this.collapseOrExpandAllEl, feStrings().actionExpandAll());
    } else {
      host.setIcon(this.collapseOrExpandAllEl, "lucide-chevrons-down-up");
      setElementTooltip(this.collapseOrExpandAllEl, feStrings().actionCollapseAll());
    }
  };

  proto.getDisplayText = function () { return feStrings().name(); };
  proto.getViewType = function () { return VIEW_TYPE_FILE_EXPLORER; };

  proto.load = function () {
    host.View.prototype.load.call(this);
    const app = this.app;
    const vault = app.vault;
    this.registerEvent(vault.on("create", this.onCreate, this));
    this.registerEvent(vault.on("delete", this.onDelete, this));
    this.registerEvent(vault.on("rename", this.onRename, this));
    this.registerEvent(vault.on("modify", this.onModify, this));
    this.registerEvent(vault.on("config-changed", this.onConfigChanged, this));
    this.registerEvent(app.workspace.on("file-open", this.onFileOpen, this));
    this.registerEvent(app.viewRegistry.on("extensions-updated", this.onExtensionsUpdated, this));
    this.navFileContainerEl.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (event.targetNode === this.navFileContainerEl) {
        this.tree.clearSelectedDoms();
        this.tree.setFocusedItem(null);
        this.onFileContextMenu(event, vault.getRoot());
      }
    });
    this.ready = false;
    const files = vault.getAllLoadedFiles();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file instanceof ExplorerFolder() && file.isRoot()) continue;
      this.onCreate(file);
    }
    this.attachDropHandler(vault.getRoot(), this.navFileContainerEl);
    this.updateShowUnsupportedFiles();
    app.workspace.onLayoutReady(() => {
      this.ready = true;
      this.sort();
      this.onFileOpen(app.workspace.getActiveFile());
      this.tree.loadFolds();
    });
  };

  proto.onCreate = function (file) {
    if (file instanceof ExplorerFolder() && file.isRoot()) return;
    const items = this.fileItems;
    const path = file.path;
    if (items.hasOwnProperty(path)) return;
    let item;
    if (file instanceof ExplorerFile()) item = new explorer.FileItem(this, file);
    else if (file instanceof ExplorerFolder()) {
      item = new explorer.FolderItem(this, file);
      this.attachDropHandler(file, item.el);
    } else return;
    items[path] = item;
    this.files.set(item.el, file);
    this.requestSort();
  };

  proto.onDelete = function (file) {
    const items = this.fileItems;
    const path = file.path;
    if (items.hasOwnProperty(path)) {
      const item = items[path];
      this.files.delete(item.el);
      delete items[path];
      if (this.activeDom === item) this.activeDom = null;
      this.tree.selectedDoms.delete(item);
      if (this.tree.focusedItem === item) this.tree.setFocusedItem(null);
    }
    this.requestSort();
  };

  proto.onRename = function (file, oldPath) {
    const items = this.fileItems;
    if (items.hasOwnProperty(oldPath)) {
      const item = items[oldPath];
      delete items[oldPath];
      items[file.path] = item;
      item.updateTitle();
      this.files.set(item.el, file);
      if (item instanceof explorer.FolderItem) this.tree.requestSaveFolds();
      item.info.computed = false;
    }
    this.requestSort();
  };

  proto.onModify = function () {
    if (this.sortOrder === "byModifiedTime" || this.sortOrder === "byModifiedTimeReverse") this.requestSort();
  };

  proto.onConfigChanged = function (key) {
    if (key === "showUnsupportedFiles") this.updateShowUnsupportedFiles();
  };

  proto.updateShowUnsupportedFiles = function () {
    const vault = this.app.vault;
    this.navFileContainerEl.toggleClass("show-unsupported", vault.getConfig("showUnsupportedFiles"));
    this.tree.infinityScroll.invalidateAll();
  };

  // ---------- context menu ----------

  proto.onFileContextMenu = function (event, file) {
    const self = this;
    const app = this.app;
    const menu = new host.Menu().addSections(["title", "open", "action-primary", "action", "info", "info.copy", "view", "system", "", "danger"]);
    const isRoot = file instanceof ExplorerFolder() && file.isRoot();
    const selected = Array.from(this.tree.selectedDoms);

    if (selected.length > 1 && selected.some((item) => item.file === file)) {
      const files = selected.map((item) => item.file);
      const unique = ng08FlattenUniqueFiles(files);
      const folderCount = unique.length;
      if (host.Platform.isPhone) {
        menu.addItem((item) => item.setSection("title").setIcon("lucide-files").setTitle(host.t.nouns.fileWithCount({ count: selected.length })).setIsLabel(true));
      }
      menu.addItem((item) => item.setSection("action-primary")
        .setTitle(feStrings().actionNewFolderWithCount({ count: folderCount }))
        .setIcon("lucide-folder-plus")
        .onClick(async () => {
          let parent = null;
          if (file) parent = file instanceof ExplorerFolder() ? file : file.parent;
          const folder = await app.fileManager.createNewFolder(parent);
          await self.afterCreate(folder, false);
          await moveFilesIntoFolder(app, unique, folder);
          self.tree.clearSelectedDoms();
        }));
      menu.addItem((item) => item.setSection("danger")
        .setTitle(feStrings().menuOptDelete())
        .setIcon("lucide-trash-2")
        .setWarning(true)
        .onClick(async () => {
          for (let i = 0; i < files.length; i++) {
            const target = files[i];
            if (await app.vault.exists(target.path)) {
              if (await app.fileManager.promptForDeletion(target)) { /* deleted */ }
            }
          }
        }));
      app.workspace.trigger("files-menu", menu, files, "file-explorer-context-menu", null);
      return;
    }

    // single item (or empty space -> root)
    if (host.Platform.isPhone) {
      const title = createFragment((frag) => frag.createDiv({ text: file.name }));
      if (file instanceof ExplorerFile()) {
        const modified = feStrings().tooltipModifiedTime({ time: window.moment(file.stat.mtime).format("YYYY-MM-DD HH:mm") });
        const created = feStrings().tooltipCreatedTime({ time: window.moment(file.stat.ctime).format("YYYY-MM-DD HH:mm") });
        title.createDiv("menu-item-desc", (desc) => {
          desc.createDiv({ text: modified });
          desc.createDiv({ text: created });
        });
      } else if (file instanceof ExplorerFolder()) {
        const fileCount = host.t.nouns.fileWithCount({ count: file.getFileCount() });
        const folderCount = host.t.nouns.folderWithCount({ count: file.getFolderCount() });
        title.createDiv({ cls: "menu-item-desc", text: `${fileCount}, ${folderCount}` });
      }
      menu.addItem((item) => item.setSection("title").setTitle(title).removeIcon().setIsLabel(true));
    }

    if (file instanceof ExplorerFolder()) {
      const folder = file;
      menu.addItem((item) => item.setSection("action-primary")
        .setTitle(feStrings().menuOptNewNote())
        .setIcon("lucide-edit")
        .onClick((clickEvent) => {
          const inNewLeaf = host.Keymap.isModifier(clickEvent, "Mod");
          self.createAbstractFile("file", folder, inNewLeaf);
        }));
      menu.addItem((item) => item.setSection("action-primary")
        .setTitle(feStrings().menuOptNewFolder())
        .setIcon("lucide-folder-open")
        .onClick((clickEvent) => {
          const inNewLeaf = host.Keymap.isModifier(clickEvent, "Mod");
          self.createAbstractFile("folder", folder, inNewLeaf);
        }));
    }

    if (!isRoot) {
      menu.addItem((item) => item.setSection("danger")
        .setTitle(feStrings().menuOptRename())
        .setIcon("lucide-edit-3")
        .onClick(() => self.startRenameFile(file)));
    }

    if (file instanceof ExplorerFile()) {
      menu.addItem((item) => item.setSection("open")
        .setTitle(host.t.interface.menu.openInNewTab())
        .setIcon("lucide-file-plus")
        .onClick(async () => {
          if (file instanceof ExplorerFile()) await app.workspace.openLinkText(file.path, "", "tab");
        }));
      if (host.Platform.canSplit) {
        menu.addItem((item) => item.setSection("open")
          .setTitle(host.t.interface.menu.openToTheRight())
          .setIcon("lucide-separator-vertical")
          .onClick(async () => {
            if (file instanceof ExplorerFile()) await app.workspace.openLinkText(file.path, "", "split");
          }));
      }
    }

    if (!isRoot) {
      menu.addItem((item) => item.setSection("action")
        .setTitle(host.Platform.isMacOS ? feStrings().menuOptMakeCopyMac() : feStrings().menuOptMakeCopy())
        .setIcon("lucide-files")
        .onClick(async (clickEvent) => {
          const inNewLeaf = host.Keymap.isModifier(clickEvent, "Mod");
          const target = file instanceof ExplorerFile()
            ? app.vault.getAvailablePath(withoutExtension(file.path), extensionOf(file.path))
            : app.vault.getAvailablePath(file.path);
          const copy = await app.vault.copy(file, target);
          self.afterCreate(copy, inNewLeaf);
        }));
      menu.addItem((item) => item.setSection("danger")
        .setTitle(feStrings().menuOptDelete())
        .setIcon("lucide-trash-2")
        .setWarning(true)
        .onClick(() => app.fileManager.promptForDeletion(file)));
    }

    app.workspace.trigger("file-menu", menu, file, "file-explorer-context-menu", null);
    const item = this.fileItems[file.path];
    if (item) {
      menu.setParentElement(item.selfEl);
      this.tree.setFocusedItem(item);
    }
    menu.showAtMouseEvent(event);
  };

  proto.openFileContextMenu = function (event, target) {
    const file = this.files.get(target.parentElement);
    if (this.fileBeingRenamed === file) return;
    event.preventDefault();
    this.onFileContextMenu(event, file);
  };

  // ---------- header buttons ----------

  proto.setSortOrder = function (order) {
    this.sortOrder = order;
    this.app.workspace.requestSaveLayout();
    this.sort();
  };

  proto.setAutoReveal = function (autoReveal) {
    if (autoReveal === this.autoRevealFile) return;
    this.autoRevealFile = autoReveal;
    this.autoRevealButtonEl.toggleClass("is-active", autoReveal);
  };

  proto.onToggleAutoReveal = function () {
    this.setAutoReveal(!this.autoRevealFile);
    if (this.autoRevealFile) this.revealActiveFile();
    this.app.workspace.requestSaveLayout();
  };

  proto.onCreateNewFolderClick = function (event) {
    event.preventDefault();
    this.createAbstractFile("folder", null, false);
  };

  proto.onCreateNewNoteClick = function (event) {
    event.preventDefault();
    let parentPath = "";
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) parentPath = activeFile.path;
    const parent = this.app.fileManager.getNewFileParent(parentPath);
    this.createAbstractFile("file", parent, host.Keymap.isModEvent(event) || "tab");
  };

  // ---------- clipboard ----------

  proto.handlePaste = async function (event) {
    const raw = event.clipboardData.getData(CLIPBOARD_FILES_TYPE);
    if (!raw) return;
    const focused = this.tree.focusedItem;
    let files = [];
    let operation = "copy";
    try {
      const data = JSON.parse(raw);
      files = data.paths;
      if ((data.operation && data.operation === "copy") || data.operation === "cut") operation = data.operation;
    } catch (err) {
      console.error("Failed to parse file list from clipboard", err);
    }
    if (!files || !Array.isArray(files)) return;
    files.sort((a, b) => nameCollator(a, b));
    let folder = this.app.vault.getRoot();
    if (focused) {
      if (focused instanceof explorer.FileItem) folder = focused.file.parent;
      else if (focused instanceof explorer.FolderItem) folder = focused.file;
    }
    const items = ng08FlattenUniqueFiles(files.map((path) => this.app.vault.getAbstractFileByPath(path)).filter((file) => !!file));
    if (items.length === 0) return;
    const placed = [];
    if (operation === "copy") {
      await this.workQueue.queue(async () => {
        for (const file of items) {
          if (!canMoveInto(file, folder)) continue;
          const parent = file === folder ? folder.parent : folder;
          const target = this.app.vault.getAvailablePath(parent.getParentPrefix() + baseName(file.path), extensionOf(lastSegment(file.path)));
          await this.app.vault.copy(file, target);
          if (Object.hasOwn(this.fileItems, target)) placed.push(this.fileItems[target]);
        }
      });
    } else if (operation === "cut") {
      const movable = movableFiles(items, folder);
      await this.workQueue.queue(async () => moveFilesIntoFolder(this.app, movable, folder));
      for (const file of movable) {
        if (Object.hasOwn(this.fileItems, file.path)) placed.push(this.fileItems[file.path]);
      }
    }
    this.tree.clearSelectedDoms();
    placed.forEach((item) => this.tree.selectItem(item));
    this.itemsBeingCut.forEach((item) => item.selfEl.removeClass("is-cut"));
    this.itemsBeingCut = [];
    const first = placed.first();
    if (first) {
      this.tree.setFocusedItem(first, true);
      this.revealInFolder(first.file);
    }
  };

  proto.handleCopy = function (event) {
    const paths = ng08FlattenUniqueFiles(this.tree.getSelectedItems().map((item) => item.file)).map((file) => file.path);
    if (paths.length > 0) {
      event.preventDefault();
      event.clipboardData.setData(CLIPBOARD_FILES_TYPE, JSON.stringify({ operation: "copy", paths }));
    }
  };

  proto.handleCut = function (event) {
    const items = (this.itemsBeingCut = this.tree.getSelectedItems());
    for (const item of items) item.selfEl.addClass("is-cut");
    const paths = ng08FlattenUniqueFiles(items.map((item) => item.file)).map((file) => file.path);
    if (paths.length > 0) {
      event.preventDefault();
      event.clipboardData.setData(CLIPBOARD_FILES_TYPE, JSON.stringify({ operation: "cut", paths }));
    }
  };

  proto.createAbstractFile = async function (kind, parent, inNewLeaf) {
    const app = this.app;
    let file = null;
    try {
      if (kind === "file") file = await app.fileManager.createNewMarkdownFile(parent);
      else if (kind === "folder") file = await app.fileManager.createNewFolder(parent);
    } catch (err) {
      new host.Notice(err.toString());
      return;
    }
    this.afterCreate(file, inNewLeaf);
  };

  proto.afterCreate = async function (file, inNewLeaf) {
    if (!file) return;
    if (file instanceof ExplorerFile()) {
      const leaf = this.app.workspace.getLeaf(inNewLeaf);
      await leaf.openFile(file, { active: true, state: { mode: "source" }, eState: { rename: "all" } });
    } else {
      this.app.nextFrame(() => {
        this.sort();
        this.startRenameFile(file);
        const item = this.fileItems[file.path];
        if (item) this.tree.infinityScroll.scrollIntoView(item, 4);
      });
    }
  };

  // ---------- mouse / rename ----------

  proto.onFileClick = function (event, target) {
    if (event.defaultPrevented) return;
    if (event.button !== 0 && event.button !== 1) return;
    const file = this.files.get(target.parentElement);
    if (!file) return;
    const item = this.fileItems[file.path];
    if (item) item.onSelfClick(event);
  };

  proto.onFilePointerover = function (event, target) {
    if (event.pointerType === "touch" || isSyntheticMouseEvent(event) || !pointerLeftElement(event, target)) return;
    const file = this.files.get(target.parentElement);
    if (!file) return;
    let modified = "";
    let created = "";
    if (file instanceof ExplorerFile()) {
      modified = feStrings().tooltipModifiedTime({ time: window.moment(file.stat.mtime).format("YYYY-MM-DD HH:mm") });
      created = feStrings().tooltipCreatedTime({ time: window.moment(file.stat.ctime).format("YYYY-MM-DD HH:mm") });
    }
    const item = this.fileItems[file.path];
    let text = "";
    if (item && !item.isFullTitleShown()) text += item.getTitle();
    if (file instanceof ExplorerFile()) {
      if (text !== "") text += "\n\n";
      text += `${modified}\n${created}`;
    } else if (file instanceof ExplorerFolder()) {
      const fileCount = host.t.nouns.fileWithCount({ count: file.getFileCount() });
      const folderCount = host.t.nouns.folderWithCount({ count: file.getFolderCount() });
      if (text !== "") text += "\n\n";
      text += `${fileCount}, ${folderCount}`;
    }
    if (text !== "") {
      displayTooltip(target, text, {
        placement: this.getSideTooltipPlacement(),
        gap: 24,
        horizontalParent: this.containerEl,
        delay: FILE_TOOLTIP_DELAY,
      });
    }
    if (file instanceof ExplorerFile()) {
      this.app.workspace.trigger("hover-link", {
        event,
        source: "file-explorer",
        hoverParent: this,
        targetEl: target,
        linktext: file.path,
      });
    }
  };

  proto.onFilePointerout = function (event, target) {
    if (event.pointerType === "touch" || !pointerLeftElement(event, target)) return;
    hideTooltip();
  };

  proto.onFileOpen = function (file) {
    const item = file ? this.fileItems[file.path] : null;
    if (item === this.activeDom) return;
    if (item !== this.tree.focusedItem) this.tree.clearSelectedDoms();
    if (this.activeDom) this.activeDom.selfEl.removeClass("is-active");
    if (item) item.selfEl.addClass("is-active");
    this.activeDom = item;
    if (this.autoRevealFile) this.revealActiveFile();
  };

  proto.revealActiveFile = function () {
    const active = this.activeDom;
    const container = this.containerEl;
    if (!active) return;
    if (container.isShown()) {
      this._revealActiveFileQueued = false;
      let item = active.parent;
      while (item && item instanceof explorer.FolderItem) {
        item.setCollapsed(false, false);
        item = item.parent;
      }
      this.tree.infinityScroll.scrollIntoView(active, 4);
    } else if (!this._revealActiveFileQueued) {
      container.onNodeInserted(() => this.revealActiveFile(), true);
      this._revealActiveFileQueued = true;
    }
  };

  proto.revealInFolder = function (file) {
    const items = this.fileItems;
    if (!items.hasOwnProperty(file.path)) return;
    const item = items[file.path];
    let parent = file.parent;
    while (parent && parent.path !== null) {
      const parentItem = items[parent.path];
      if (parentItem && parentItem instanceof explorer.FolderItem && parentItem.collapsed) parentItem.toggleCollapsed(false);
      parent = parent.parent;
    }
    this.tree.setFocusedItem(item);
    this.app.nextFrame(() => {
      this.tree.infinityScroll.scrollIntoView(item, 4);
      focusElementSafe(item.selfEl);
      this.app.workspace.setActiveLeaf(this.leaf);
    });
  };

  function focusElementSafe(el) { el.focus && el.focus({ preventScroll: true }); }

  // ---------- sorting ----------

  proto.sort = function () {
    const self = this;
    if (!this.ready) return;
    if (this.containerEl.isShown()) {
      this._sortQueued = false;
      const items = this.fileItems;
      const all = [];
      for (const path in items) {
        if (items.hasOwnProperty(path)) all.push(items[path]);
      }
      for (const item of all) {
        if (item instanceof explorer.FolderItem) item.sort();
      }
      const vault = this.app.vault;
      const top = this.getSortedFolderItems(vault.getRoot());
      const scrollEl = this.navFileContainerEl;
      const scrollTop = scrollEl.scrollTop;
      this.tree.infinityScroll.rootEl.vChildren.setChildren(top);
      scrollEl.scrollTop = scrollTop;
      this.tree.infinityScroll.compute();
      if (this.autoRevealFile) this.revealActiveFile();
    } else if (!this._sortQueued) {
      this.containerEl.onNodeInserted(() => this.requestSort(), true);
      this._sortQueued = true;
    }
  };

  proto.getSortedFolderItems = function (folder) {
    const compareFiles = sortOrderComparator(this.sortOrder);
    const children = folder.children.slice();
    children.sort((a, b) => {
      const aFolder = a instanceof ExplorerFolder();
      const bFolder = b instanceof ExplorerFolder();
      if (aFolder || bFolder) {
        if (aFolder && !bFolder) return -1;
        if (bFolder && !aFolder) return 1;
        return nameCollator(a.name, b.name);
      }
      return compareFiles(a, b);
    });
    const items = [];
    for (const child of children) {
      const item = this.fileItems[child.path];
      if (item) items.push(item);
    }
    return items;
  };

  // ---------- drag & drop ----------

  proto.dragFiles = function (event, item) {
    const selected = this.tree.selectedDoms;
    const first = selected.entries().next().value;
    if (selected.size === 0 || (selected.size === 1 && first === item)) return null;
    if (!selected.has(item)) return null;
    const files = [];
    const els = [];
    selected.forEach((entry) => {
      files.push(entry.file);
      els.push(entry.el);
    });
    const dragManager = this.app.dragManager;
    dragManager.updateSource(els, "is-being-dragged");
    return dragManager.dragFiles(event, files);
  };

  proto.attachDropHandler = function (folder, targetEl) {
    const self = this;
    this.app.dragManager.handleDrop(targetEl, (event, data, isHovering) => {
      event.preventDefault();
      const folderName = folder.name || self.app.vault.getName();
      if (isHovering) {
        const item = self.fileItems[folder.path];
        if (self.lastDropTargetEl !== targetEl) {
          targetEl.win.clearTimeout(self.mouseoverExpandTimeout);
          self.mouseoverExpandTimeout = targetEl.win.setTimeout(() => {
            if (self.lastDropTargetEl === targetEl && item instanceof explorer.FolderItem) item.setCollapsed(false, true);
          }, 750);
          self.lastDropTargetEl = targetEl;
        }
      } else {
        targetEl.win.clearTimeout(self.mouseoverExpandTimeout);
        self.lastDropTargetEl = null;
        self.mouseoverExpandTimeout = null;
      }
      if (!data) {
        if (clipboardHasFiles(event.dataTransfer)) {
          if (!isHovering) self.app.importAttachments(clipboardFilesData(event.dataTransfer, "drop", true), folder);
          return { dropEffect: "copy", hoverEl: targetEl, hoverClass: "is-being-dragged-over" };
        }
        return undefined;
      }
      if (data.type === "file" || data.type === "folder") {
        const file = data.file;
        if (!canMoveInto(file, folder)) return;
        if (!isHovering) {
          let target = file.name;
          if (folder.path !== "/") target = folder.path + "/" + target;
          if (file.parent === folder) return;
          if (data.type === "file") {
            const ext = withoutExtension(target);
            const name = extensionOf(lastSegment(target));
            target = self.app.vault.getAvailablePath(ext, name);
          } else {
            target = self.app.vault.getAvailablePath(target);
          }
          self.app.fileManager.renameFile(file, target);
        }
        return {
          action: host.t.interface.dragAndDrop.moveIntoFolder({ folder: folderName }),
          dropEffect: "move",
          hoverEl: targetEl,
          hoverClass: "is-being-dragged-over",
        };
      }
      if (data.type === "files") {
        const movable = movableFiles(data.files, folder);
        if (movable.length === 0) return;
        if (!isHovering) {
          moveFilesIntoFolder(self.app, movable, folder);
          const item = self.fileItems[folder.path];
          if (item && item instanceof explorer.FolderItem && item.collapsed) self.tree.clearSelectedDoms();
        }
        return {
          action: host.t.interface.dragAndDrop.moveIntoFolder({ folder: folderName }),
          dropEffect: "move",
          hoverEl: targetEl,
          hoverClass: "is-being-dragged-over",
        };
      }
    }, true);
  };

  // ---------- rename ----------

  proto.onTitleBlur = function () { this.acceptRename(); };

  proto.onFileRenameInput = function (event, target) {
    const file = this.files.get(target.parentElement.parentElement);
    let text = target.getText();
    const singleText = target.childNodes.length === 1 && target.firstChild.nodeType === Node.TEXT_NODE;
    if (!singleText) {
      target.setText(text);
      selectEditableContents(target, false);
    }
    text = text.trim();
    hideTooltip();
    if (host.forbiddenNameChars.test(text)) {
      displayTooltip(target.parentElement, feStrings().msgInvalidCharacters() + host.forbiddenNameCharsList, { classes: ["mod-error"] });
    } else if (this.app.vault.checkForDuplicate(file, text)) {
      displayTooltip(target.parentElement, feStrings().msgFileAlreadyExists(), { classes: ["mod-error"] });
    } else if (host.unsafeNameChars.test(text)) {
      displayTooltip(target.parentElement, feStrings().msgUnsafeCharacters() + host.unsafeNameCharsList, { classes: ["mod-error"] });
    }
  };

  proto.startRenameFile = async function (file) {
    if (file instanceof ExplorerFolder() && file.isRoot()) return;
    await this.acceptRename();
    this.fileBeingRenamed = file;
    let parent = file.parent;
    while (parent && parent.path !== null) {
      const item = this.fileItems[parent.path];
      if (item && item instanceof explorer.FolderItem && item.collapsed) item.toggleCollapsed(false);
      parent = parent.parent;
    }
    this.app.keymap.pushScope(this.fileRenameScope);
    const item = this.fileItems[file.path];
    this.tree.setFocusedItem(item, true);
    item.startRename();
  };

  proto.acceptRename = async function () {
    const file = this.fileBeingRenamed;
    if (!file) return;
    this.exitRename();
    const item = this.fileItems[file.path];
    const innerEl = item.innerEl;
    const name = innerEl.getText().trim();
    if (name === "") {
      item.updateTitle();
      this.displayError(feStrings().msgEmptyFileName(), item);
      return;
    }
    if (name.startsWith(".")) {
      item.updateTitle();
      this.displayError(feStrings().msgBadDotfile(), item);
      return;
    }
    const newPath = file.getNewPathAfterRename(name);
    if (file.path === newPath) {
      item.updateTitle();
      return;
    }
    try {
      await this.app.fileManager.renameFile(file, newPath);
    } catch (err) {
      if (err) {
        console.error(err);
        const message = err.message || err.code || err.toString();
        this.displayError(message, item);
      }
    }
    item.updateTitle();
    setTimeout(() => this.tree.infinityScroll.scrollIntoView(item, 4), 0);
  };

  proto.displayError = function (message, item) {
    displayTooltip(item.selfEl, message, { placement: "bottom", classes: ["mod-error"] });
    setTimeout(hideTooltip, 2000);
  };

  proto.exitRename = function () {
    const file = this.fileBeingRenamed;
    this.fileBeingRenamed = null;
    this.fileItems[file.path].stopRename();
    this.app.keymap.popScope(this.fileRenameScope);
  };

  proto.onKeyEnterInRename = function (event) {
    if (event.isComposing) return;
    event.preventDefault();
    this.acceptRename();
  };

  proto.onKeyEscInRename = function () {
    const file = this.fileBeingRenamed;
    if (file) {
      this.fileItems[file.path].updateTitle();
      this.exitRename();
    }
  };

  proto.onDeleteSelectedFiles = async function (event) {
    event.preventDefault();
    const files = [];
    const tree = this.tree;
    const focused = tree.focusedItem;
    const selected = tree.selectedDoms;
    if (selected.size > 0) files.push(...Array.from(selected).map((item) => item.file));
    else if (focused instanceof explorer.ItemBase) files.push(focused.file);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file === this.app.vault.getRoot()) continue;
      if (await this.app.vault.exists(file.path)) {
        await this.app.fileManager.promptForDeletion(file);
      }
    }
  };

  proto.onKeyRename = function (event) {
    const focused = this.tree.focusedItem;
    if (!focused) return;
    event.preventDefault();
    const file = this.files.get(focused.el);
    if (file) this.startRenameFile(file);
  };

  proto.onExtensionsUpdated = function () {
    const items = this.fileItems;
    for (const path in items) {
      if (items.hasOwnProperty(path)) items[path].updateTitle();
    }
  };

  explorer.View = FileExplorerView;
  return FileExplorerView;
}

// =====================================================================================================================
// The plugin (P8)
// =====================================================================================================================

export function defineFileExplorerPlugin(host) {
  bindExplorerHost(host);

  function FileExplorerPlugin() {
    this.id = "file-explorer";
    this.name = feStrings().name();
    this.description = feStrings().desc();
    this.defaultOn = true;
  }
  const proto = FileExplorerPlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    const t = feStrings();
    plugin.registerGlobalCommand({
      id: "file-explorer:open",
      name: t.actionShow(),
      icon: "lucide-files",
      callback: () => app.workspace.ensureSideLeaf(VIEW_TYPE_FILE_EXPLORER, "left", { active: true }),
    });
    plugin.registerGlobalCommand({
      id: "file-explorer:reveal-active-file",
      name: t.actionRevealActiveFile(),
      icon: "lucide-navigation",
      checkCallback: (checking) => {
        const file = app.workspace.getActiveFile();
        if (!file) return false;
        if (!checking) this.revealInFolder(file);
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "file-explorer:new-folder",
      name: t.actionCreateFolder(),
      icon: "lucide-folder-plus",
      callback: async () => {
        const folder = await app.fileManager.createNewFolder();
        app.workspace.ensureSideLeaf(VIEW_TYPE_FILE_EXPLORER, "left", { active: true, reveal: true, state: { newFile: folder.path } });
      },
    });
    plugin.registerViewType(VIEW_TYPE_FILE_EXPLORER, (leaf) => new explorer.View(leaf));
  };

  proto.onEnable = function (app, plugin) {
    plugin.registerEvent(app.workspace.on("layout-ready", this.initLeaf, this));
    plugin.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
    app.workspace.registerHoverLinkSource("file-explorer", { display: this.name, defaultMod: true });
  };

  proto.onDisable = function (app) {
    app.workspace.unregisterHoverLinkSource("file-explorer");
  };

  proto.onUserEnable = function () {
    this.initLeaf();
  };

  proto.onFileMenu = function (menu, file, source) {
    if (host.Platform.isMobile || !(file instanceof ExplorerFile()) || source === "file-explorer-context-menu") return;
    const self = this;
    menu.addItem((item) => item
      .setSection("system")
      .setTitle(feStrings().actionRevealFile())
      .setIcon("lucide-folder-open")
      .onClick(() => self.revealInFolder(file)));
  };

  proto.initLeaf = function () {
    this.app.workspace.ensureSideLeaf(VIEW_TYPE_FILE_EXPLORER, "left", { reveal: false });
  };

  proto.revealInFolder = async function (file) {
    const app = this.app;
    const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_FILE_EXPLORER);
    let leaf;
    if (leaves.length === 0) {
      leaf = app.workspace.getLeftLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE_FILE_EXPLORER });
    } else {
      leaf = leaves[0];
    }
    await app.workspace.revealLeaf(leaf);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    leaf.view.revealInFolder(file);
  };

  explorer.Plugin = FileExplorerPlugin;
  return FileExplorerPlugin;
}
