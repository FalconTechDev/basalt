// Bookmarks: the sidebar view ("bookmarks"), its tree rows (file / folder / search / graph / url leaves and
// collapsible groups), the add/edit modals, and the internal plugin that owns the item list, the lookups,
// the menu contributions and the open-in-leaf logic.
//
// Items are plain objects { type, ctime, ... } plus a non-enumerable parent link (bookmarkParent) that the
// plugin maintains in addItem / removeItem / moveItem / loadData.

import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { setElementTooltip } from "./tooltip.js";
import { makeTreePusher, collapsibleTreeItem, walkTree, treeDropPosition, updateTreeDropIndicator } from "./tree.js";
import { searchViewClasses } from "./search-view.js";
import { fileClass } from "./vault.js";
import { binaryFind, randomHex } from "./misc.js";
import { displayName, withoutMd, parseLinktext } from "./path.js";
import { linkSafeHeading, firstHeadingText } from "./text.js";

// Classes defined by the factories below, visible to each other regardless of factory order.
const bookmarks = {};

const VIEW_TYPE_BOOKMARKS = "bookmarks";
const bookmarkParent = Symbol("parent");
const bookmarksT = () => hostT.t.plugins.bookmarks;
const fileExplorerT = () => hostT.t.plugins.fileExplorer;
const interfaceMenu = () => hostT.t.interface.menu;

// host is provided per factory; hostT is bound by the first factory that runs (all share the same host).
let hostT = null;
function bindHost(host) {
  hostT = host;
  return host;
}

const TFileClass = () => fileClass("TFile");
const TFolderClass = () => fileClass("TFolder");

// =====================================================================================================================
// Leaf helpers
// =====================================================================================================================

/** A never-cancelled runnable token (the shape metadataCache.blockCache.getForFile expects). */
export function defineRunnable(host) {
  bindHost(host);
  function Runnable(options) {
    const opts = options || {};
    this.running = false;
    this.cancelled = false;
    this.onStart = opts.onStart || null;
    this.onStop = opts.onStop || null;
    this.onCancel = opts.onCancel || null;
  }
  Runnable.prototype.start = function () {
    if (!this.running) {
      this.running = true;
      if (this.onStart) this.onStart();
    }
  };
  Runnable.prototype.stop = function () {
    if (this.running) {
      this.running = false;
      if (this.onStop) this.onStop();
    }
  };
  Runnable.prototype.cancel = function () {
    this.stop();
    if (!this.cancelled) {
      this.cancelled = true;
      if (this.onCancel) this.onCancel();
    }
  };
  Runnable.prototype.isRunning = function () { return this.running; };
  Runnable.prototype.isCancelled = function () { return this.cancelled; };
  bookmarks.Runnable = Runnable;
  return Runnable;
}

/** A plain-text clipboard write for drag data. */
export function setPlainText(dataTransfer, text) {
  dataTransfer.setData("text/plain", text);
}

/** file bookmark item */
export function bookmarkItemForFile(file, subpath) {
  if (!subpath) subpath = undefined;
  return { type: "file", ctime: Date.now(), path: file.path, subpath };
}

/** folder bookmark item */
export function bookmarkItemForFolder(folder) {
  return { type: "folder", ctime: Date.now(), path: folder.path };
}

/** group bookmark item */
export function bookmarkGroupItem(title) {
  return { type: "group", ctime: Date.now(), items: [], title: title || bookmarksT().labelUntitledGroup() };
}

/** graph bookmark item */
export function bookmarkItemForGraph(options, title) {
  return { type: "graph", ctime: Date.now(), title: title || bookmarksT().labelUntitledGraph(), options };
}

/** url bookmark item */
export function bookmarkItemForUrl(url, title) {
  return { type: "url", ctime: Date.now(), url, title: title || "" };
}

/** search bookmark item */
export function bookmarkItemForSearch(query) {
  return { type: "search", ctime: Date.now(), query };
}

/** The bookmark item describing a leaf's current view, or null when the view cannot be bookmarked. */
export function viewToBookmarkItem(leaf) {
  const view = leaf.view;
  if (view instanceof hostT.GraphView) return bookmarkItemForGraph(view.dataEngine.getOptions());
  if (view instanceof searchViewClasses.SearchView) return bookmarkItemForSearch(view.getQuery());
  if (view instanceof hostT.FileView) return bookmarkItemForFile(view.file);
  if (view instanceof hostT.WebViewerView) return bookmarkItemForUrl(view.url, view.getDisplayText());
  return null;
}

/** Bookmark items for a list of files/folders (folders inside folders are skipped). */
export function filesToBookmarkItems(files) {
  const items = [];
  for (const file of flattenUniqueFiles(files)) {
    if (file instanceof TFileClass()) items.push(bookmarkItemForFile(file));
    else if (file instanceof TFolderClass()) items.push(bookmarkItemForFolder(file));
  }
  return items;
}

/** Files with any ancestor folder already present removed. */
export function flattenUniqueFiles(files) {
  const result = [];
  for (const file of files) {
    let keep = true;
    for (const other of files) {
      if (other !== file && other instanceof TFolderClass() && file.path.startsWith(other.path)) {
        keep = false;
        break;
      }
    }
    if (keep) result.push(file);
  }
  return result;
}

/** Depth-first walk over bookmark items; `visit(item, path)` may stop descending by returning early via throw? No —
 *  faithful port: visit every item, recurse into groups with the accumulated "title/" path. */
export function walkBookmarkItems(items, visit) {
  const walk = (list, prefix) => {
    for (const item of list) {
      if (visit(item, prefix)) return;
      if (item.type === "group") walk(item.items, prefix + item.title + "/");
    }
  };
  walk(items, "");
}

/** The heading whose span contains the cursor position (binary search over the file's heading cache). */
export function headingAtPosition(app, file, position) {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache || !cache.headings) return null;
  let result = null;
  for (const heading of cache.headings) {
    if (heading.position.start.line > position.line) break;
    result = heading;
  }
  return result;
}

/** Text to append to create a block reference with id `id` inside node `node`, plus the insertion offsets. */
export function blockRefInsertion(contentInfo, id) {
  const content = contentInfo.content;
  const node = contentInfo.node;
  const start = node.position.start.offset;
  let end = node.position.end.offset;
  let addition;
  let newlines = 0;
  const isParagraph = node.type === "paragraph" || node.type === "listItem";
  let ref = "^" + id;
  if (isParagraph) {
    ref = " " + ref;
    if (node.type === "listItem") {
      const children = node.children;
      if (children && children.length > 1) {
        const last = children[children.length - 1];
        const prev = children[children.length - 2];
        if (last.type === "list") end = prev.position.end.offset;
      }
    }
  } else {
    ref = "\n\n" + ref;
    newlines = 2;
  }
  if (!isParagraph && !(content.charAt(end) === "\n" && content.charAt(end + 1) === "\n")) {
    ref += "\n";
    newlines++;
  }
  return { blockStart: start, blockEnd: end, addition: ref, newlines };
}

// =====================================================================================================================
// Modals
// =====================================================================================================================

/** Modal base with a button container (the original `nb`). */
export function defineButtonModal(host) {
  bindHost(host);
  function ButtonModal(app) {
    const self = host.Modal.call(this, app) || this;
    self.buttonContainerEl = null;
    self.containerEl.addClass("mod-confirmation");
    self.buttonContainerEl = self.modalEl.createDiv("modal-button-container");
    return self;
  }
  inherit(ButtonModal, host.Modal);
  const proto = ButtonModal.prototype;

  proto.addCheckbox = function (label, onClick) {
    this.buttonContainerEl.createEl("label", { cls: "mod-checkbox" }, (el) => {
      el.createEl("input", { attr: { tabindex: -1 }, type: "checkbox" }).addEventListener("click", onClick);
      el.appendText(label);
    });
    return this;
  };

  proto.addButton = function (cls, text, onClick) {
    const self = this;
    const classes = Array.isArray(cls) ? cls : [cls];
    const button = this.buttonContainerEl.createEl("button", { cls: classes.join(" "), text });
    button.addEventListener("click", (event) => (async () => {
      button.addClass("mod-loading");
      try {
        const keepOpen = await onClick(event);
        if (!keepOpen) self.close();
      } finally {
        button.removeClass("mod-loading");
      }
    })());
    return this;
  };

  proto.addCancelButton = function (onClick) {
    return this.addButton("mod-cancel", host.t.dialogue.buttonCancel(), () => {
      if (onClick) onClick();
    });
  };

  proto.onClose = function () {
    host.hideTooltip();
  };
  return ButtonModal;
}

/** The add / edit bookmark dialog (title, group picker, optional remove button, optional post-add callback). */
export function defineBookmarkEditModal(host) {
  bindHost(host);
  const ButtonModal = bookmarks.ButtonModal;

  function BookmarkEditModal(plugin, item, isExisting, onAdded) {
    const self = ButtonModal.call(this, plugin.app) || this;
    self.plugin = plugin;
    self.item = item;
    self.isExistingItem = isExisting;
    self.initialBookmarkGroup = null;
    self.bookmarkGroup = null;
    self.bookmarkGroupOptions = new Map();
    self.reverseBookmarkGroupOptions = new Map();
    self.modalEl.addClass("mod-bookmark", "mod-lg");
    const title = isExisting ? bookmarksT().actionEditBookmark() : bookmarksT().actionAddBookmark();
    self.setTitle(title);

    const suggestedTitle = plugin.getItemTitle(item);
    let titleText = item.title;
    const save = () => {
      item.title = titleText;
      if (isExisting) {
        plugin.editItem(item);
        if (self.initialBookmarkGroup !== self.bookmarkGroup) {
          plugin.moveItem(item, self.bookmarkGroup, self.bookmarkGroup.items.length - 1);
        }
      } else {
        plugin.addItem(item, self.bookmarkGroup);
      }
      if (onAdded) onAdded();
      self.close();
    };
    const onTitleKey = (event) => {
      if (event.isComposing || event.key !== "Enter") return;
      event.preventDefault();
      save();
    };

    if (item.type === "file" || item.type === "folder") {
      let pathText = withoutMd(item.path);
      if (item.type === "file" && item.subpath) pathText += item.subpath;
      new host.Setting(self.contentEl).setName(bookmarksT().optionPath()).addText((text) => {
        text.setDisabled(true).setValue(pathText);
      });
    } else if (item.type === "search") {
      new host.Setting(self.contentEl).setName(bookmarksT().optionQuery()).addText((text) => {
        text.setDisabled(true).setValue(item.query);
      });
    } else if (item.type === "url") {
      new host.Setting(self.contentEl).setName("URL").addText((text) => {
        text.setDisabled(true).setValue(item.url);
      });
    }

    new host.Setting(self.contentEl).setName(bookmarksT().optionTitle()).addText((text) => {
      self.titleInputEl = text.inputEl;
      self.titleInputEl.enterKeyHint = hostT.Platform.isAndroidApp ? "enter" : "done";
      text.setPlaceholder(suggestedTitle).setValue(titleText).onChange((value) => { titleText = value; });
      text.inputEl.addEventListener("keydown", onTitleKey);
    });

    new host.Setting(self.contentEl).setName(bookmarksT().optionGroup()).addDropdown((dropdown) => {
      self.bookmarkGroupComponent = dropdown;
      const fill = (items, indent) => {
        for (const entry of items) {
          if (entry.type === "group") {
            const value = randomHex(16);
            dropdown.addOption(value, indent + entry.title);
            self.bookmarkGroupOptions.set(value, entry);
            self.reverseBookmarkGroupOptions.set(entry, value);
            fill(entry.items, indent + "    ");
          }
        }
      };
      fill(plugin.items, "");
      dropdown.onChange((value) => { self.bookmarkGroup = self.bookmarkGroupOptions.get(value); });
    });

    const remove = () => {
      plugin.removeItem(item);
      self.close();
    };

    if (hostT.Platform.isPhone) {
      self.modalEl.createEl("button", { cls: "modal-nav-action mod-secondary", text: hostT.t.dialogue.buttonCancel() }, (el) => {
        el.addEventListener("click", () => self.close());
      });
      self.modalEl.createEl("button", { cls: "modal-nav-action mod-cta", text: hostT.t.dialogue.buttonSave() }, (el) => {
        el.addEventListener("click", save);
      });
      if (isExisting) {
        self.contentEl.appendChild(self.buttonContainerEl);
        self.buttonContainerEl.createEl("button", { cls: "mod-warning", text: bookmarksT().menuOptRemove() }, (el) => {
          el.addEventListener("click", remove);
        });
      } else {
        self.buttonContainerEl.detach();
      }
    } else {
      if (isExisting) self.addButton(["mod-secondary", "mod-destructive"], bookmarksT().menuOptRemove(), remove);
      self.addCancelButton();
      self.addButton("mod-cta", hostT.t.dialogue.buttonSave(), save);
    }
    return self;
  }
  inherit(BookmarkEditModal, ButtonModal);
  const proto = BookmarkEditModal.prototype;

  proto.setBookmarkGroup = function (group) {
    this.bookmarkGroup = group;
    const value = this.reverseBookmarkGroupOptions.get(group);
    this.bookmarkGroupComponent.setValue(value);
    return this;
  };

  proto.onOpen = function () {
    if (!this.bookmarkGroup) this.bookmarkGroup = this.item[bookmarkParent];
    this.initialBookmarkGroup = this.bookmarkGroup;
    const value = this.reverseBookmarkGroupOptions.get(this.initialBookmarkGroup);
    this.bookmarkGroupComponent.setValue(value);
    hostT.selectOnFocus(this.titleInputEl);
  };

  bookmarks.BookmarkEditModal = BookmarkEditModal;
  return BookmarkEditModal;
}

/** The "add N bookmarks" dialog used when bookmarking several tabs / files at once. */
export function defineBookmarkManyModal(host) {
  bindHost(host);
  const ButtonModal = bookmarks.ButtonModal;

  function BookmarkManyModal(app, plugin, items) {
    const self = ButtonModal.call(this, app) || this;
    self.modalEl.addClass("mod-bookmark");
    self.setTitle("Add " + items.length + " bookmarks");
    const placeholder = window.moment().format("LLL");
    let title = "";
    let group = null;
    const save = () => {
      const groupItem = bookmarkGroupItem(title || placeholder);
      plugin.addItem(groupItem, group);
      for (const item of items) plugin.addItem(item, groupItem);
      self.close();
    };
    const onTitleKey = (event) => {
      if (event.isComposing || event.key !== "Enter") return;
      event.preventDefault();
      save();
    };
    new host.Setting(self.contentEl).setName(bookmarksT().optionTitle()).addText((text) => {
      text.setPlaceholder(placeholder).setValue(title).onChange((value) => { title = value; });
      text.inputEl.addEventListener("keydown", onTitleKey);
    });
    const groupOptions = new Map();
    new host.Setting(self.contentEl).setName(bookmarksT().optionGroup()).addDropdown((dropdown) => {
      const fill = (list, indent) => {
        for (const entry of list) {
          if (entry.type === "group") {
            const value = randomHex(16);
            dropdown.addOption(value, indent + entry.title);
            groupOptions.set(value, entry);
            fill(entry.items, indent + "    ");
          }
        }
      };
      fill(plugin.items, "");
      dropdown.onChange((value) => { group = groupOptions.get(value); });
    });
    self.addCancelButton();
    self.addButton("mod-cta", hostT.t.dialogue.buttonSave(), save);
    return self;
  }
  inherit(BookmarkManyModal, ButtonModal);
  bookmarks.BookmarkManyModal = BookmarkManyModal;
  return BookmarkManyModal;
}

// =====================================================================================================================
// Tree rows
// =====================================================================================================================

/** Base bookmark row: rename support, context menu, "parent/title" path. */
export function defineBookmarkItemBase(host) {
  bindHost(host);

  function BookmarkItemBase(view, tree) {
    const self = host.TreeItem.call(this) || this;
    self.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
    self.renameScope = null;
    self.tree = tree;
    self.view = view;
    self.selfEl.addClass("bookmark");
    self.selfEl.addEventListener("contextmenu", self.onContextMenu.bind(self));
    self.titleEl = self.innerEl.createSpan({ cls: "tree-item-inner-text" });
    const scope = (self.renameScope = new host.Scope(view.app.scope));
    scope.register([], "Enter", () => self.stopRename(true));
    scope.register([], "Escape", () => self.stopRename(false));
    return self;
  }
  inherit(BookmarkItemBase, host.TreeItem);
  const proto = BookmarkItemBase.prototype;

  Object.defineProperty(proto, "path", {
    get: function () {
      const plugin = this.view.plugin;
      const parts = [];
      let node = this;
      while (node) {
        parts.push(plugin.getItemTitle(node.item));
        node = node.parent instanceof bookmarks.GroupItem ? node.parent : null;
      }
      return parts.reverse().join("/");
    },
    enumerable: false,
    configurable: true,
  });

  proto.startRename = function () {
    const selfEl = this.selfEl;
    const titleEl = this.titleEl;
    const tree = this.tree;
    const view = this.view;
    selfEl.addClass("is-being-renamed");
    tree.setFocusedItem(this, true);
    titleEl.setAttribute("contenteditable", "true");
    host.focusAndSelectContents(titleEl);
    view.app.keymap.pushScope(this.renameScope);
  };

  proto.update = function () {
    const item = this.item;
    const view = this.view;
    const title = view.plugin.getItemTitle(item);
    this.titleEl.setText(title);
    this.el.setAttr("data-path", this.path);
    let deep = false;
    if (item.type === "file") {
      this.selfEl.toggle(!!view.app.vault.getAbstractFileByPath(item.path));
      deep = true;
    }
    this.tree.infinityScroll.invalidate(this, deep);
  };

  proto.setActive = function (active) {
    this.selfEl.toggleClass("is-active", active);
  };

  proto.stopRename = function (save) {
    const item = this.item;
    const selfEl = this.selfEl;
    const view = this.view;
    if (save) {
      const text = this.titleEl.textContent.trim();
      if (text) {
        item.title = text;
        view.plugin.onItemsChanged(true);
      } else {
        this.update();
      }
    } else {
      this.update();
    }
    this.titleEl.removeAttribute("contenteditable");
    selfEl.removeClass("is-being-renamed");
    view.app.keymap.popScope(this.renameScope);
  };

  proto.onTitleBlur = function (event) {
    this.stopRename(true);
  };

  proto.onContextMenu = function (event) {
    const self = this;
    const view = this.view;
    const app = view.app;
    const tree = view.tree;
    const plugin = view.plugin;
    const menu = host.Menu.forEvent(event)
      .setParentElement(this.selfEl)
      .addSections(["title", "open", "action", "view", "info", "", "danger"]);

    if (tree.selectedDoms.size > 1 && tree.selectedDoms.has(this)) {
      const items = Array.from(tree.selectedDoms).map((dom) => dom.item);
      menu.addItem((item) => item.setSection("open").setTitle(interfaceMenu().openInNewTab()).setIcon("lucide-file-plus").onClick(() => plugin.openBookmarks(items, "tab")));
      if (hostT.Platform.canSplit) {
        menu.addItem((item) => item.setSection("open").setTitle(interfaceMenu().openToTheRight()).setIcon("lucide-separator-vertical").onClick(() => plugin.openBookmarks(items, "split")));
      }
      if (hostT.Platform.canPopoutWindow) {
        menu.addItem((item) => item.setSection("open").setTitle(interfaceMenu().openInNewWindow()).setIcon("lucide-picture-in-picture-2").onClick(() => plugin.openBookmarks(items, "window")));
      }
      menu.addItem((item) => item.setSection("danger").setTitle(bookmarksT().menuOptRemove()).setIcon("lucide-trash-2").onClick(() => {
        tree.selectedDoms.forEach((dom) => plugin.removeItem(dom.item));
      }));
      app.workspace.trigger("bookmarks:bookmarks-menu", menu, items);
    } else {
      menu.addItem((item) => item.setSection("action").setTitle(bookmarksT().menuOptRename()).setIcon("lucide-pencil").onClick(() => self.startRename()));
      menu.addItem((item) => item.setSection("danger").setTitle(bookmarksT().menuOptRemove()).setIcon("lucide-trash-2").onClick(() => view.plugin.removeItem(self.item)));
      if (this.item.type === "group") {
        const group = this.item;
        const children = this.item.items;
        menu.addItem((item) => item.setSection("action").setTitle(bookmarksT().actionNewBookmark()).setIcon("lucide-bookmark-plus").onClick(() => {
          const leaf = app.workspace.getMostRecentLeaf();
          const bookmark = viewToBookmarkItem(leaf);
          if (bookmark) new bookmarks.BookmarkEditModal(plugin, bookmark, false).setBookmarkGroup(group).open();
        }));
        menu.addItem((item) => item.setSection("action").setIcon("lucide-folder-plus").setTitle(bookmarksT().actionNewGroup()).onClick(() => view.createNewGroup(group)));
        menu.addItem((item) => item.setSection("open").setTitle(interfaceMenu().openInNewTab()).setIcon("lucide-file-plus").onClick(() => plugin.openBookmarks(children, "tab")));
        if (hostT.Platform.canSplit) {
          menu.addItem((item) => item.setSection("open").setTitle(interfaceMenu().openToTheRight()).setIcon("lucide-separator-vertical").onClick(() => plugin.openBookmarks(children, "split")));
        }
        if (hostT.Platform.canPopoutWindow) {
          menu.addItem((item) => item.setSection("open").setTitle(interfaceMenu().openInNewWindow()).setIcon("lucide-picture-in-picture-2").onClick(() => plugin.openBookmarks(children, "window")));
        }
      } else if (this.item.type === "file" || this.item.type === "graph") {
        menu.addItem((item) => item.setSection("open").setTitle(interfaceMenu().openInNewTab()).setIcon("lucide-file-plus").onClick(() => plugin.openBookmark(self.item, "tab")));
        if (hostT.Platform.canSplit) {
          menu.addItem((item) => item.setSection("open").setTitle(interfaceMenu().openToTheRight()).setIcon("lucide-separator-vertical").onClick(() => plugin.openBookmark(self.item, "split")));
        }
        if (hostT.Platform.canPopoutWindow) {
          menu.addItem((item) => item.setSection("open").setTitle(interfaceMenu().openInNewWindow()).setIcon("lucide-picture-in-picture-2").onClick(() => plugin.openBookmark(self.item, "window")));
        }
      }
      menu.addItem((item) => item.setSection("action").setTitle(bookmarksT().menuOptEdit()).setIcon("lucide-wrench").onClick(() => {
        new bookmarks.BookmarkEditModal(view.plugin, self.item, true).open();
      }));
      if (this.item.type === "file" || this.item.type === "folder") {
        const file = app.vault.getAbstractFileByPath(this.item.path);
        if (file) {
          menu.addItem((item) => item.setSection("view").setTitle(fileExplorerT().actionRevealFile()).setIcon("lucide-folder-open").onClick(() => {
            app.internalPlugins.getEnabledPluginById("file-explorer").revealInFolder(file);
          }));
        }
      }
      app.workspace.trigger("bookmarks:bookmarks-menu", menu, [this.item]);
    }
  };

  bookmarks.Item = BookmarkItemBase;
  return BookmarkItemBase;
}

/** A leaf bookmark row (file / folder / search / graph / url): icon, active state, hover-link, click to open. */
export function defineBookmarkLeafItem(host) {
  bindHost(host);
  const ItemBase = bookmarks.Item;

  function BookmarkLeafItem(view, tree, item) {
    const self = ItemBase.call(this, view, tree) || this;
    self.app = view.app;
    self.item = item;
    self.iconEl = self.selfEl.createDiv({ cls: "tree-item-icon", prepend: true });
    self.setClickable(true);
    self.constructDom();
    if (item.type === "file" && !item.subpath) {
      const activeFile = view.app.workspace.getActiveFile();
      self.setActive(item.path === (activeFile ? activeFile.path : undefined));
    }
    return self;
  }
  inherit(BookmarkLeafItem, ItemBase);
  const proto = BookmarkLeafItem.prototype;

  proto.onFileMouseover = function (event) {
    if (host.isTouchSyntheticMouse(event) || this.item.type !== "file") return;
    const app = this.view.app;
    const file = app.vault.getAbstractFileByPath(this.item.path);
    if (file instanceof TFileClass()) {
      app.workspace.trigger("hover-link", {
        event,
        source: VIEW_TYPE_BOOKMARKS,
        hoverParent: this,
        targetEl: this.selfEl,
        linktext: file.path + (this.item.subpath != null ? this.item.subpath : ""),
      });
    }
  };

  proto.onSelfClick = function (event) {
    if (this.tree.handleItemSelection(event, this)) return;
    this.view.plugin.openBookmark(this.item, host.Keymap.isModEvent(event), { eState: { focus: true } });
  };

  proto.constructDom = function () {
    const item = this.item;
    if (item.type === "file") {
      if (item.path.endsWith(".canvas")) host.setIcon(this.iconEl, "lucide-layout-dashboard");
      else if (item.subpath != null && item.subpath.startsWith("#^")) host.setIcon(this.iconEl, "lucide-toy-brick");
      else if (item.subpath != null && item.subpath.startsWith("#")) host.setIcon(this.iconEl, "lucide-heading");
      else host.setIcon(this.iconEl, "lucide-file");
      this.selfEl.addEventListener("mouseover", this.onFileMouseover.bind(this));
    } else if (item.type === "folder") {
      host.setIcon(this.iconEl, "lucide-folder");
    } else if (item.type === "search") {
      host.setIcon(this.iconEl, "lucide-search");
    } else if (item.type === "graph") {
      host.setIcon(this.iconEl, "lucide-git-fork");
    } else if (item.type === "url") {
      const plugin = this.app.internalPlugins.getEnabledPluginById("webviewer");
      if (plugin) plugin.db.setIcon(this.iconEl, item.url);
      else host.setIcon(this.iconEl, "globe-2");
    }
    this.titleEl.addEventListener("blur", this.onTitleBlur.bind(this));
  };

  bookmarks.LeafItem = BookmarkLeafItem;
  return BookmarkLeafItem;
}

/** A group bookmark row: collapsible, lazily builds child rows through the view's getItemDom. */
export function defineBookmarkGroupItem(host) {
  bindHost(host);
  const ItemBase = bookmarks.Item;
  const GroupBase = collapsibleTreeItem(ItemBase);

  function BookmarkGroupItem(view, tree, item) {
    const self = GroupBase.call(this, view, tree) || this;
    self.vChildren = new host.TreeChildren(self);
    self.pusherEl = makeTreePusher();
    self.view = view;
    self.item = item;
    self.setCollapsible(true);
    self.setClickable(true);
    self.titleEl.addEventListener("blur", self.onTitleBlur.bind(self));
    return self;
  }
  inherit(BookmarkGroupItem, GroupBase);
  const proto = BookmarkGroupItem.prototype;

  proto.onSelfClick = function (event) {
    if (this.tree.handleItemSelection(event, this)) return;
    this.onCollapseClick(event);
  };

  proto.refreshChildren = function () {
    const view = this.view;
    const item = this.item;
    this.vChildren.clear();
    this.tree.infinityScroll.invalidate(this);
    for (const child of item.items) {
      const dom = view.getItemDom(child);
      this.vChildren.addChild(dom);
      dom.update();
      if (dom instanceof BookmarkGroupItem) dom.refreshChildren();
    }
  };

  proto.onCollapseClick = function (event) {
    GroupBase.prototype.onCollapseClick.call(this, event);
    this.tree.requestSaveFolds();
  };

  proto.updateCollapsed = async function (animate) {
    const scroller = this.tree.infinityScroll;
    if (!this.collapsed) {
      const tree = this.tree;
      if (tree.handleCollapseAll) tree.handleCollapseAll(false);
    }
    scroller.invalidate(this, true);
    await GroupBase.prototype.updateCollapsed.call(this, animate);
    scroller.invalidate(this);
  };

  bookmarks.GroupItem = BookmarkGroupItem;
  return BookmarkGroupItem;
}

// =====================================================================================================================
// The view
// =====================================================================================================================

/** The bookmarks sidebar: a Tree of group/leaf rows over plugin.items with drag&drop, rename, copy/cut/paste. */
export function defineBookmarksView(host) {
  bindHost(host);

  function BookmarksView(leaf, plugin) {
    const self = host.ItemView.call(this, leaf) || this;
    self.plugin = plugin;
    self.icon = "lucide-bookmark";
    self.itemDoms = new WeakMap();
    self.collapseOrExpandAllEl = null;
    self.requestUpdate = debounceCall(self.update.bind(self), 50);
    self.emptyEl = createDiv({ cls: "pane-empty bookmarks-pane-empty", text: bookmarksT().labelNoBookmarks() });
    self.invalidStateEl = createDiv({ cls: "pane-empty mod-error" }, (el) => {
      el.createDiv({ text: bookmarksT().labelInvalidData() });
      el.createDiv({ text: bookmarksT().labelInvalidDataDesc() });
    });
    self.scope = new host.Scope(self.app.scope);

    const header = new host.ViewHeader(self.app, self.containerEl);
    header.addNavButton("lucide-bookmark-plus", bookmarksT().actionNewBookmark(), () => {
      const mostRecent = self.app.workspace.getMostRecentLeaf();
      if (mostRecent) new bookmarks.BookmarkEditModal(self.plugin, mostRecent, false).open();
    });
    header.addNavButton("lucide-folder-plus", bookmarksT().actionNewGroup(), () => self.createNewGroup());
    self.collapseOrExpandAllEl = header.addNavButton("lucide-chevrons-down-up", bookmarksT().actionCollapseAll(), () => self.tree.toggleCollapseAll());
    self.containerEl.addEventListener("contextmenu", self.onContextMenu.bind(self));
    self.tree = new host.Tree(self, {
      app: self.app,
      containerEl: self.contentEl,
      id: VIEW_TYPE_BOOKMARKS,
      scope: self.scope,
      getNodeId: self.getNodeId.bind(self),
      handleDeleteSelectedItems: self.onDeleteSelectedItems.bind(self),
      handleRenameFocusedItem: self.onRenameKey.bind(self),
      handleCollapseAll: self.handleCollapseAll.bind(self),
    });
    self.attachDropHandler();
    return self;
  }
  inherit(BookmarksView, host.ItemView);
  const proto = BookmarksView.prototype;

  proto.load = function () {
    host.ItemView.prototype.load.call(this);
    const app = this.app;
    this.registerEvent(app.vault.on("create", this.onFileCreate.bind(this), this));
    this.registerEvent(app.vault.on("delete", this.onFileDelete.bind(this), this));
    this.registerEvent(this.plugin.on("changed", this.requestUpdate, this));
    this.registerEvent(app.metadataCache.on("finished", this.requestUpdate, this));
    this.registerEvent(app.workspace.on("file-open", this.onFileOpen, this));
    app.workspace.onLayoutReady(() => {
      this.onFileOpen(app.workspace.getActiveFile());
      this.update();
      this.tree.loadFolds();
    });
  };

  proto.onFileCreate = function (file) {
    walkTree(this.tree.root, (item) => {
      if ((item.item.type !== "file" && item.item.type !== "folder") || item.item.path !== file.path) return;
      item.update();
    });
  };

  proto.onFileDelete = function (file) {
    walkTree(this.tree.root, (item) => {
      if ((item.item.type !== "file" && item.item.type !== "folder") || item.item.path !== file.path) return;
      item.update();
    });
  };

  proto.handleCollapseAll = function (collapsed) {
    this.tree.isAllCollapsed = collapsed;
    if (collapsed) {
      host.setIcon(this.collapseOrExpandAllEl, "lucide-chevrons-up-down");
      setElementTooltip(this.collapseOrExpandAllEl, fileExplorerT().actionExpandAll());
    } else {
      host.setIcon(this.collapseOrExpandAllEl, "lucide-chevrons-down-up");
      setElementTooltip(this.collapseOrExpandAllEl, fileExplorerT().actionCollapseAll());
    }
  };

  proto.getDisplayText = function () {
    return bookmarksT().name();
  };

  proto.getViewType = function () {
    return VIEW_TYPE_BOOKMARKS;
  };

  proto.isItem = function (item) {
    return item instanceof bookmarks.Item;
  };

  Object.defineProperty(proto, "root", {
    get: function () {
      return this.tree.infinityScroll.rootEl;
    },
    enumerable: false,
    configurable: true,
  });

  proto.attachDropHandler = function () {
    const self = this;
    const dropEffect = "move";
    this.app.dragManager.handleDrop(this.containerEl, (event, data, isOver) => {
      const pos = treeDropPosition(event, self.tree);
      let dragItems = [];
      if (data.source === "bookmarks" && data.type === "bookmarks") dragItems = data.items;
      const indicator = updateTreeDropIndicator(self.tree, pos, dragItems, isOver);
      if (!pos) return null;
      let effect = dropEffect;
      if (!isOver) {
        const move = (item) => {
          const parentItem = pos.parentNode instanceof bookmarks.GroupItem ? pos.parentNode.item : null;
          self.plugin.moveItem(item, parentItem, pos.idx);
        };
        if (data.type === "bookmarks") {
          for (const entry of data.items) {
            if (pos.parentNode !== entry) move(entry.item);
          }
        } else if (data.type === "file") {
          effect = "copy";
          move(bookmarkItemForFile(data.file));
        } else if (data.type === "heading") {
          effect = "copy";
          const subpath = "#" + linkSafeHeading(data.heading.heading);
          move(bookmarkItemForFile(data.file, subpath));
        } else if (data.type === "link") {
          if (data.file) {
            effect = "copy";
            const subpath = parseLinktext(data.linktext).subpath;
            const item = bookmarkItemForFile(data.file, subpath);
            item.title = data.title;
            move(item);
          }
        } else if (data.type === "folder") {
          effect = "copy";
          for (const item of filesToBookmarkItems([data.file])) move(item);
        } else if (data.type === "files") {
          effect = "copy";
          for (const item of filesToBookmarkItems(data.files)) move(item);
        }
      }
      return { dropEffect: effect, hoverEl: indicator, hoverClass: "is-active" };
    });
  };

  proto.onRenameKey = function (event) {
    event.preventDefault();
    if (this.tree.isItem(this.tree.focusedItem)) this.tree.focusedItem.startRename();
  };

  proto.onDeleteSelectedItems = async function (event) {
    event.preventDefault();
    const tree = this.tree;
    const focused = tree.focusedItem;
    const selected = tree.selectedDoms;
    if (selected.size > 0) {
      selected.forEach((dom) => this.plugin.removeItem(dom.item));
    } else if (focused instanceof bookmarks.LeafItem) {
      this.plugin.removeItem(focused.item);
    }
  };

  proto.getNodeId = function (dom) {
    return "item-" + dom.item.ctime;
  };

  proto.createNewGroup = function (parent) {
    const group = bookmarkGroupItem();
    if (parent) parent.items.push(group);
    else this.plugin.items.push(group);
    this.plugin.saveData();
    this.update();
    this.getItemDom(group).startRename();
  };

  proto.onContextMenu = function (event) {
    if (event.defaultPrevented) return;
    const self = this;
    new host.Menu().addItem((item) => item.setIcon("lucide-folder-plus").setTitle(bookmarksT().actionNewGroup()).onClick(() => self.createNewGroup())).showAtMouseEvent(event);
  };

  proto.onFileOpen = function (file) {
    walkTree(this.root, (dom) => {
      if (dom.item.type === "file") {
        const active = file && dom.item.path === file.path && !dom.item.subpath;
        dom.setActive(active);
      }
    });
  };

  proto.onResize = function () {
    this.tree.infinityScroll.onResize();
  };

  proto.dragSelectedBookmarks = function (event, dom) {
    const selected = this.tree.selectedDoms;
    if (selected.size === 0 || (selected.size === 1 && selected.has(dom))) return null;
    if (!selected.has(dom)) return null;
    const els = [];
    selected.forEach((entry) => els.push(entry.selfEl));
    const ordered = Array.from(selected);
    ordered.sort((a, b) => a.selfEl.offsetTop - b.selfEl.offsetTop);
    this.app.dragManager.updateSource(els, "is-being-dragged");
    return {
      source: "bookmarks",
      type: "bookmarks",
      icon: "lucide-bookmark",
      items: ordered,
      title: bookmarksT().labelBookmarkWithCount({ count: selected.size }),
    };
  };

  proto.getItemDom = function (item) {
    let dom = this.itemDoms.get(item);
    if (!dom) {
      dom = item.type === "group" ? new bookmarks.GroupItem(this, this.tree, item) : new bookmarks.LeafItem(this, this.tree, item);
      this.itemDoms.set(item, dom);
      this.attachDragHandler(dom);
    }
    return dom;
  };

  proto.attachDragHandler = function (dom) {
    const self = this;
    const plugin = this.plugin;
    const dragManager = this.app.dragManager;
    dragManager.handleDrag(dom.selfEl, (event) => {
      const data = self.dragSelectedBookmarks(event, dom);
      if (data) return data;
      if (!self.tree.selectedDoms.has(dom)) {
        self.tree.clearSelectedDoms();
        self.tree.selectItem(dom);
      }
      dragManager.updateSource([dom.selfEl], "is-being-dragged");
      setPlainText(event.dataTransfer, plugin.getItemTitle(dom.item));
      return {
        source: "bookmarks",
        type: "bookmarks",
        icon: "lucide-bookmark",
        items: [dom],
        title: plugin.getItemTitle(dom.item),
      };
    });
  };

  proto.update = function () {
    const children = this.root.vChildren;
    children.clear();
    this.invalidStateEl.detach();
    this.emptyEl.detach();
    if (this.plugin.hasValidData) {
      let hasVisible = false;
      for (const item of this.plugin.items) {
        const dom = this.getItemDom(item);
        children.addChild(dom);
        dom.update();
        if (dom instanceof bookmarks.GroupItem) dom.refreshChildren();
        if (dom.el.style.display !== "none") hasVisible = true;
      }
      if (!hasVisible) this.contentEl.appendChild(this.emptyEl);
    } else {
      this.contentEl.appendChild(this.invalidStateEl);
    }
    this.tree.infinityScroll.invalidate(this.root);
  };

  proto.handlePaste = function (event) {
    const data = event.clipboardData.getData("basalt/bookmarks");
    if (!data) return;
    const focused = this.tree.focusedItem;
    let items = null;
    try {
      items = JSON.parse(data);
    } catch (error) {
      console.log(error);
    }
    if (!items || !Array.isArray(items)) return;
    let parent = undefined;
    if (focused) {
      if (focused instanceof bookmarks.GroupItem) parent = focused.item;
      else if (focused.parent instanceof bookmarks.GroupItem) parent = focused.parent.item;
    }
    const ctime = Date.now();
    for (const item of items) {
      this.plugin.addItem(Object.assign({}, item, { ctime }), parent);
    }
  };

  proto._copyToClipboard = function (event, items) {
    event.clipboardData.setData("basalt/bookmarks", JSON.stringify(items));
  };

  proto._getActiveBookmarks = function () {
    const tree = this.tree;
    const focused = tree.focusedItem;
    const selected = tree.selectedDoms;
    if (selected.size > 0) return Array.from(selected).map((dom) => dom.item);
    if (focused && this.tree.isItem(focused)) return [focused.item];
    return [];
  };

  proto.handleCopy = function (event) {
    const items = this._getActiveBookmarks();
    if (items.length === 0) return;
    event.preventDefault();
    this._copyToClipboard(event, items);
  };

  proto.handleCut = function (event) {
    const items = this._getActiveBookmarks();
    if (items.length === 0) return;
    event.preventDefault();
    this._copyToClipboard(event, items);
    for (const item of items) this.plugin.removeItem(item);
  };

  bookmarks.View = BookmarksView;
  return BookmarksView;
}

// =====================================================================================================================
// The plugin
// =====================================================================================================================

/** Internal plugin: owns the item list + caches, registers the view type, commands, menus, CLI and hover source. */
export function defineBookmarksPlugin(host) {
  bindHost(host);

  function BookmarksPlugin() {
    const self = host.Events.call(this) || this;
    self.id = VIEW_TYPE_BOOKMARKS;
    self.name = bookmarksT().name();
    self.description = bookmarksT().desc();
    self.defaultOn = true;
    self.hasValidData = false;
    self.items = [];
    self.bookmarkLookup = {};
    self.urlBookmarkLookup = {};
    self.bookmarkedViews = new WeakMap();
    self.onItemsChanged = debounceCall(self._onItemsChanged.bind(self), 20);
    return self;
  }
  inherit(BookmarksPlugin, host.Events);
  const proto = BookmarksPlugin.prototype;

  proto.init = function (app, plugin) {
    const self = this;
    this.app = app;
    this.plugin = plugin;

    plugin.registerGlobalCommand({
      id: "bookmarks:open",
      name: bookmarksT().actionShow(),
      icon: "lucide-bookmark",
      callback: () => {
        self.app.workspace.ensureSideLeaf(VIEW_TYPE_BOOKMARKS, "left", { active: true });
      },
    });
    plugin.registerGlobalCommand({
      id: "bookmarks:bookmark-current-view",
      name: bookmarksT().actionBookmark(),
      icon: "lucide-bookmark-plus",
      checkCallback: (checking) => {
        const leaf = app.workspace.getMostRecentLeaf();
        if (!leaf) return false;
        let item = self.findBookmarkByView(leaf.view);
        const exists = !!item;
        if (!item) item = viewToBookmarkItem(leaf);
        if (!item) return undefined;
        if (!checking) new bookmarks.BookmarkEditModal(self, item, exists).open();
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "bookmarks:bookmark-current-search",
      name: bookmarksT().actionBookmarkSearch(),
      icon: "lucide-search",
      checkCallback: (checking) => {
        const searchPlugin = self.app.internalPlugins.getEnabledPluginById("global-search");
        if (!searchPlugin) return undefined;
        if (!checking) {
          const query = searchPlugin.getGlobalSearchQuery();
          if (!query) {
            new host.Notice(bookmarksT().msgNoSearchQuery());
            return true;
          }
          const item = bookmarkItemForSearch(query);
          new bookmarks.BookmarkEditModal(self, item, false).open();
        }
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "bookmarks:unbookmark-current-view",
      name: bookmarksT().actionRemoveBookmark(),
      icon: "lucide-bookmark-plus",
      checkCallback: (checking) => {
        const leaf = app.workspace.getMostRecentLeaf();
        if (!leaf) return false;
        const item = self.findBookmarkByView(leaf.view);
        if (!item) return false;
        if (!checking) self.removeItem(item);
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "bookmarks:bookmark-current-section",
      name: bookmarksT().actionBookmarkBlock(),
      icon: "lucide-bookmark-plus",
      editorCallback: (editor, context) => {
        const editMode = context.editMode;
        const file = context.file;
        const cursor = editor.getCursor("to");
        const section = sectionAtCursor(editMode, cursor);
        let item;
        let onAdded;
        if (section) {
          if (Object.prototype.hasOwnProperty.call(section, "heading")) {
            item = bookmarkItemForFile(file, "#" + linkSafeHeading(section.heading));
          } else {
            let blockId = section.id;
            if (!blockId) {
              blockId = randomHex(6);
              onAdded = () => {
                insertBlockRef(editMode, editor.getCursor("to"), blockId);
              };
            }
            item = bookmarkItemForFile(file, "#^" + blockId);
          }
          if (editor.somethingSelected()) item.title = editor.getSelection().trim();
          new bookmarks.BookmarkEditModal(self, item, false, onAdded).open();
        }
      },
    });
    plugin.registerGlobalCommand({
      id: "bookmarks:bookmark-current-heading",
      name: bookmarksT().actionBookmarkHeading(),
      icon: "lucide-bookmark-plus",
      editorCallback: (editor, context) => {
        const editMode = context.editMode;
        const position = editMode.editor.getCursor("to");
        const heading = editMode.file ? headingAtPosition(editMode.app, editMode.file, position) : null;
        if (heading) {
          const item = bookmarkItemForFile(context.file, "#" + linkSafeHeading(heading.heading));
          new bookmarks.BookmarkEditModal(self, item, false).open();
        }
      },
    });
    plugin.registerGlobalCommand({
      id: "bookmarks:bookmark-all-tabs",
      name: bookmarksT().actionBookmarkAllTabs(),
      icon: "lucide-bookmark-plus",
      callback: () => {
        const workspace = self.app.workspace;
        const items = [];
        workspace.iterateLeaves([workspace.rootSplit, workspace.floatingSplit], (leaf) => {
          const item = viewToBookmarkItem(leaf);
          if (item) items.push(item);
        });
        if (items.length > 0) new bookmarks.BookmarkManyModal(self.app, self, items).open();
      },
    });
    plugin.registerViewType(VIEW_TYPE_BOOKMARKS, (leaf) => new bookmarks.View(leaf, self));
  };

  proto.onUserEnable = function () {
    this.initLeaf();
  };

  proto.initLeaf = function () {
    this.app.workspace.ensureSideLeaf(VIEW_TYPE_BOOKMARKS, "left", { reveal: false });
  };

  proto.findBookmarkByView = function (view) {
    if (view instanceof host.FileView && view.file) return this.bookmarkLookup[view.file.path];
    if (view instanceof host.WebViewerView) return this.urlBookmarkLookup[view.url];
    return null;
  };

  proto.onFileRename = function (file, oldPath) {
    let changed = false;
    walkBookmarkItems(this.items, (item) => {
      if ((item.type !== "file" && item.type !== "folder") || item.path !== oldPath) return;
      item.path = file.path;
      changed = true;
    });
    if (changed) this.onItemsChanged(true);
  };

  proto.updateTabHeaders = function () {
    const self = this;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view;
      if (!(view instanceof host.ItemView)) return;
      const item = self.findBookmarkByView(view);
      const title = item ? bookmarksT().labelBookmarked() : bookmarksT().labelBookmark();
      let action = self.bookmarkedViews.get(view);
      if (!action) {
        action = view.addAction("lucide-bookmark", title, () => {
          const existing = self.findBookmarkByView(view);
          const exists = !!existing;
          let target = existing;
          if (!target) target = viewToBookmarkItem(leaf);
          if (target) new bookmarks.BookmarkEditModal(self, target, exists).open();
        }).addClass("mod-bookmark");
        self.bookmarkedViews.set(view, action);
      }
      action.toggleClass(["mod-bookmarked", "mod-filled"], !!item);
      setElementTooltip(action, title);
    });
  };

  proto.getBookmarks = function () {
    const items = [];
    walkBookmarkItems(this.items, (item) => items.push(item));
    return items;
  };

  proto.getItemTitle = function (item) {
    if (!item.title) {
      if (item.type === "file" && item.subpath) return displayName(item.path) + item.subpath;
      if (item.type === "file" || item.type === "folder") {
        const file = this.app.vault.getAbstractFileByPath(item.path);
        if (file instanceof TFileClass()) return file.getShortName();
        if (file instanceof TFolderClass()) return file.name;
        return displayName(item.path);
      }
      if (item.type === "search") return item.query;
    }
    return item.title;
  };

  proto.addItem = function (item, parent) {
    const list = parent ? parent.items : this.items;
    item[bookmarkParent] = parent;
    list.push(item);
    this.onItemsChanged(true);
  };

  proto.editItem = function (item) {
    this._onItemsChanged(true);
  };

  proto.removeItem = function (item) {
    if (!item) return;
    const parentItems = item[bookmarkParent] ? item[bookmarkParent].items : this.items;
    parentItems.remove(item);
    this.onItemsChanged(true);
  };

  proto.moveItem = function (item, parent, index) {
    const oldParent = item[bookmarkParent];
    const oldList = oldParent ? oldParent.items : this.items;
    const oldIndex = oldList.indexOf(item);
    oldList.remove(item);
    const newList = parent ? parent.items : this.items;
    if (oldIndex !== -1 && oldIndex < index && oldList === newList) index--;
    newList.splice(index, 0, item);
    item[bookmarkParent] = parent;
    this._onItemsChanged(true);
  };

  proto.onEnable = async function (app, plugin) {
    plugin.registerEvent(app.workspace.on("editor-menu", this.onEditorMenu, this));
    plugin.registerEvent(app.workspace.on("layout-ready", this.initLeaf, this));
    plugin.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
    plugin.registerEvent(app.workspace.on("files-menu", this.onFilesMenu, this));
    plugin.registerEvent(app.workspace.on("leaf-menu", this.onLeafMenu, this));
    plugin.registerEvent(app.workspace.on("search:results-menu", this.onSearchResultsMenu, this));
    plugin.registerEvent(app.workspace.on("tab-group-menu", this.onTabGroupMenu, this));
    plugin.registerEvent(app.workspace.on("layout-change", this.updateTabHeaders, this));
    plugin.registerEvent(app.vault.on("rename", this.onFileRename.bind(this), this));
    plugin.registerCliHandler("bookmarks", "List bookmarks", {
      total: { description: "Return bookmark count" },
      verbose: { description: "Include bookmark types" },
      format: { value: "json|tsv|csv", description: "Output format (default: tsv)" },
    }, (args) => {
      const items = this.getBookmarks();
      if (args.total) return String(items.length);
      if (items.length === 0) return "No bookmarks found.";
      const header = args.verbose ? ["type", "value", "title"] : ["value"];
      const rows = items.map((item) => {
        const title = this.getItemTitle(item) || "";
        const value = bookmarkValue(item);
        return args.verbose ? [item.type, value, title] : [value || "[" + item.type + "] " + title];
      });
      return app.cli.formatTable(header, rows, args.format);
    });
    plugin.registerCliHandler("bookmark", "Add a bookmark", {
      file: { value: "<path>", description: "File to bookmark" },
      subpath: { value: "<subpath>", description: "Subpath (heading or block) within file" },
      folder: { value: "<path>", description: "Folder to bookmark" },
      search: { value: "<query>", description: "Search query to bookmark" },
      url: { value: "<url>", description: "URL to bookmark" },
      title: { value: "<title>", description: "Bookmark title" },
    }, (args) => {
      let item;
      if (args.file) {
        const file = app.vault.getAbstractFileByPath(args.file);
        if (!file) throw 'File "' + args.file + '" not found.';
        if (file instanceof TFolderClass()) item = bookmarkItemForFolder(file);
        else if (file instanceof TFileClass()) item = bookmarkItemForFile(file, args.subpath);
      } else if (args.folder) {
        const folder = app.vault.getFolderByPath(args.folder);
        if (!folder) throw 'Folder "' + args.folder + '" not found.';
        item = bookmarkItemForFolder(folder);
      } else if (args.search) {
        item = bookmarkItemForSearch(args.search);
      } else if (args.url) {
        item = bookmarkItemForUrl(args.url, args.title);
      } else {
        const file = app.workspace.getActiveFile();
        if (!file) throw "No active file. Specify what to bookmark with: file=<path>, folder=<path>, search=<query>, or url=<url>";
        item = bookmarkItemForFile(file);
      }
      if (args.title && item.type !== "url") item.title = args.title;
      this.addItem(item);
      if (item.type === "file") return "Bookmarked: " + item.path + (item.subpath || "");
      if (item.type === "folder") return "Bookmarked folder: " + item.path;
      if (item.type === "search") return "Bookmarked search: " + item.query;
      if (item.type === "url") return "Bookmarked URL: " + item.url;
      return "Bookmark added.";
    });
    app.workspace.registerHoverLinkSource(VIEW_TYPE_BOOKMARKS, { display: this.name, defaultMod: true });
    if (await this.loadData()) return;
    app.workspace.onLayoutReady(async () => {
      const starred = await this.app.vault.readConfigJson("starred");
      if (starred && starred.hasOwnProperty("items") && Array.isArray(starred.items)) {
        const items = [];
        const ctime = Date.now();
        for (const entry of starred.items) {
          if ((entry.type !== "file" && entry.type !== "folder") || this.app.vault.getAbstractFileByPath(entry.path)) {
            if (entry.type === "file") delete entry.title;
            if (!entry.ctime) entry.ctime = ctime;
            items.push(entry);
          }
        }
        this.items = items;
        this._onItemsChanged(true);
      }
    });
  };

  proto.loadData = async function () {
    const data = await this.plugin.loadData();
    this.hasValidData = data !== undefined;
    if (data && data.hasOwnProperty("items") && Array.isArray(data.items)) {
      const assignParents = (items, parent) => {
        for (const item of items) {
          item[bookmarkParent] = parent;
          if (item.type === "group") assignParents(item.items, item);
        }
      };
      assignParents(data.items, null);
      this.items = data.items;
    }
    this.rebuildBookmarkCache();
    return !!this.items;
  };

  proto.onExternalSettingsChange = async function () {
    await this.loadData();
    this.onItemsChanged(false);
  };

  proto.onEditorMenu = function (menu, editor, info) {
    const file = info.file;
    if (!file) return;
    const cursor = editor.getCursor();
    const headingText = firstHeadingText(editor.getLine(cursor.line));
    if (headingText) {
      const subpath = "#" + linkSafeHeading(headingText);
      menu.addItem((item) => item.setTitle(bookmarksT().menuOptBookmarkHeading()).setIcon("lucide-bookmark").setSection("action").onClick(() => {
        const bookmark = bookmarkItemForFile(file, subpath);
        new bookmarks.BookmarkEditModal(this, bookmark, false).open();
      }));
    }
  };

  proto.onFilesMenu = function (menu, files, info) {
    const self = this;
    menu.addItem((item) => item.setSection("action").setTitle(bookmarksT().actionBookmark()).setIcon("lucide-bookmark").onClick(() => {
      const items = filesToBookmarkItems(files);
      new bookmarks.BookmarkManyModal(self.app, self, items).open();
    }));
  };

  proto.onFileMenu = function (menu, file) {
    if (file instanceof TFolderClass() && file.isRoot()) return;
    const exists = this.bookmarkLookup.hasOwnProperty(file.path);
    menu.addItem((item) => item.setSection("action").setTitle(exists ? bookmarksT().actionEditBookmark() : bookmarksT().actionBookmark()).setIcon("lucide-bookmark").onClick(() => {
      let bookmark = this.bookmarkLookup[file.path];
      if (!bookmark) {
        if (file instanceof TFileClass()) bookmark = bookmarkItemForFile(file);
        else if (file instanceof TFolderClass()) bookmark = bookmarkItemForFolder(file);
      }
      if (bookmark) new bookmarks.BookmarkEditModal(this, bookmark, exists).open();
    }));
  };

  proto.onTabGroupMenu = function (menu, group) {
    const items = group.children.map(viewToBookmarkItem).filter(Boolean);
    const count = items.length;
    if (count > 0) {
      menu.addItem((item) => item.setSection("action").setTitle(bookmarksT().actionBookmarkTabGroup({ count })).setIcon("lucide-bookmark").onClick(() => {
        new bookmarks.BookmarkManyModal(this.app, this, items).open();
      }));
    }
  };

  proto.onSearchResultsMenu = function (menu, results) {
    const self = this;
    const query = results.getQuery();
    menu.addItem((item) => item.setSection("action").setTitle(bookmarksT().actionBookmark()).setIcon("lucide-bookmark").onClick(() => {
      const bookmark = bookmarkItemForSearch(query);
      new bookmarks.BookmarkEditModal(self, bookmark, false).open();
    }));
  };

  proto.onLeafMenu = function (menu, leaf) {
    const view = leaf.view;
    if (view instanceof host.GraphView) {
      const options = view.dataEngine.getOptions();
      menu.addItem((item) => item.setSection("action").setTitle(bookmarksT().actionBookmark()).setIcon("lucide-bookmark").onClick(() => {
        const bookmark = bookmarkItemForGraph(options);
        new bookmarks.BookmarkEditModal(this, bookmark, false).open();
      }));
    } else if (view instanceof host.WebViewerView) {
      const url = view.url;
      const title = view.title;
      const exists = this.urlBookmarkLookup.hasOwnProperty(url);
      menu.addItem((item) => item.setSection("action").setTitle(exists ? bookmarksT().actionEditBookmark() : bookmarksT().actionBookmark()).setIcon("lucide-bookmark").onClick(() => {
        let bookmark = this.urlBookmarkLookup[url];
        if (!bookmark) bookmark = bookmarkItemForUrl(url, title);
        if (bookmark) new bookmarks.BookmarkEditModal(this, bookmark, exists).open();
      }));
    }
  };

  proto._onItemsChanged = function (save) {
    this.trigger("changed");
    this.rebuildBookmarkCache();
    this.updateTabHeaders();
    if (save) this.saveData();
  };

  proto.saveData = function () {
    this.plugin.saveData({ items: this.items });
  };

  proto.rebuildBookmarkCache = function () {
    this.bookmarkLookup = {};
    this.urlBookmarkLookup = {};
    const self = this;
    walkBookmarkItems(this.items, (item) => {
      if ((item.type === "folder") || (item.type === "file" && !item.subpath)) {
        self.bookmarkLookup[item.path] = item;
      } else if (item.type === "url") {
        self.urlBookmarkLookup[item.url] = item;
      }
    });
  };

  proto.openBookmarkInLeaf = async function (item, leaf, options) {
    if (item.type === "file") {
      const linktext = item.path + (item.subpath != null ? item.subpath : "");
      leaf.openLinkText(linktext, "", options);
    } else if (item.type === "graph") {
      const graphPlugin = this.app.internalPlugins.getEnabledPluginById("graph");
      if (graphPlugin) {
        await leaf.setViewState({ type: "graph" });
        if (leaf.view instanceof host.GraphView) {
          leaf.view.dataEngine.setOptions(item.options);
          graphPlugin.options.options = item.options;
        }
      }
    } else if (item.type === "url") {
      window.open(item.url, "_blank");
    }
  };

  proto.openBookmark = async function (item, newLeaf, options) {
    if (item.type === "file" || item.type === "graph") {
      const leaf = this.app.workspace.getLeaf(newLeaf);
      return this.openBookmarkInLeaf(item, leaf, options);
    }
    if (item.type === "url") {
      window.open(item.url, "_blank");
    } else if (item.type === "folder") {
      const file = this.app.vault.getAbstractFileByPath(item.path);
      const explorer = this.app.internalPlugins.getEnabledPluginById("file-explorer");
      if (file && explorer) explorer.revealInFolder(file);
    } else if (item.type === "search") {
      const query = item.query;
      const searchPlugin = this.app.internalPlugins.getEnabledPluginById("global-search");
      if (searchPlugin) {
        const current = searchPlugin.getGlobalSearchQuery();
        if (!newLeaf || current === "") {
          searchPlugin.openGlobalSearch(query);
          return;
        }
        if (current.contains(query)) searchPlugin.openGlobalSearch(current.replace(query, "").trim());
        else searchPlugin.openGlobalSearch(current.trim() + " " + query);
      }
    }
  };

  proto.openBookmarks = async function (items, placement) {
    const openable = items.filter((item) => item.type === "file" || item.type === "graph");
    if (openable.length === 0) return;
    const firstLeaf = this.app.workspace.getLeaf(placement);
    let index = firstLeaf.parent.children.length;
    const leaves = [firstLeaf];
    for (let i = 1; i < openable.length; i++) {
      const leaf = new host.WorkspaceLeaf(this.app);
      firstLeaf.parent.insertChild(index, leaf);
      leaves.push(leaf);
      index++;
    }
    for (let i = 0; i < leaves.length; i++) {
      await this.openBookmarkInLeaf(openable[i], leaves[i], { active: false });
    }
    if (this.app.vault.getConfig("focusNewTab")) {
      this.app.workspace.setActiveLeaf(firstLeaf, { focus: true });
    }
  };

  proto.trigger = function () {
    const args = Array.prototype.slice.call(arguments);
    return host.Events.prototype.trigger.apply(this, args);
  };

  proto.on = function (name, fn, ctx) {
    return host.Events.prototype.on.call(this, name, fn, ctx);
  };

  bookmarks.Plugin = BookmarksPlugin;
  return BookmarksPlugin;
}

// helpers used by the plugin that mirror small original functions
function bookmarkValue(item) {
  switch (item.type) {
    case "file": return item.path + (item.subpath || "");
    case "folder": return item.path;
    case "search": return item.query;
    case "url": return item.url;
    default: return "";
  }
}

/** The section (heading / list / block) at the editor cursor, from the file cache. */
function sectionAtCursor(editMode, position) {
  const cache = editMode.app.metadataCache;
  const file = editMode.file;
  const fileCache = cache.getFileCache(file);
  if (!fileCache) return null;
  const probe = (entry) => (position.line < entry.position.start.line ? -1 : position.line > entry.position.end.line ? 1 : 0);
  const section = binaryFind(fileCache.sections || [], probe);
  if (section && section.type === "list") return binaryFind(fileCache.listItems || [], probe);
  if (section && section.type === "heading") return binaryFind(fileCache.headings || [], probe);
  return section;
}

/** Writes the "^id" block reference into the block under the cursor (used when saving a new section bookmark). */
async function insertBlockRef(editMode, position, blockId) {
  const id = blockId != null ? blockId : randomHex(6);
  const editor = editMode.editor;
  const file = editMode.file;
  const cache = await editMode.app.metadataCache.blockCache.getForFile(new bookmarks.Runnable(), file);
  for (const block of cache.blocks) {
    const nodePosition = block.node.position;
    if (nodePosition && nodePosition.start.line - 1 <= position.line && nodePosition.end.line - 1 >= position.line) {
      const info = { content: cache.content, node: block.node };
      const insertion = blockRefInsertion(info, id);
      editor.cm.dispatch({ changes: { from: insertion.blockEnd, insert: insertion.addition } });
      return;
    }
  }
}


