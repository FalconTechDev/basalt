// WorkspaceLeaf (one tab / pane that hosts a view) and the per-leaf navigation history.
import { inherit } from "./inherit.js";
import { randomHex } from "./misc.js";
import { parseLinktext } from "./path.js";
import { ellipsize } from "./text.js";
import { debounceCall } from "./timing.js";

/** How many entries the back list of a leaf keeps. */
const HISTORY_LIMIT = 20;

export function defineLeafHistory(host) {
  /** Back / forward stacks of a leaf; each entry is { title, icon, state, eState }. */
  function LeafHistory(owner) {
    this.owner = owner;
    this.backHistory = [];
    this.forwardHistory = [];
  }

  /** Re-opens the view state of an entry in the owning leaf (flagged as a history move, so it is not recorded again). */
  LeafHistory.prototype.updateState = async function (entry) {
    const viewState = entry.state;
    viewState.popstate = true;
    await this.owner.setViewState(viewState, entry.eState);
    this.owner.trigger("history-change");
  };

  LeafHistory.prototype.forward = async function () { return this.go(1); };
  LeafHistory.prototype.back = async function () { return this.go(-1); };

  /** Records the state the leaf is leaving; a new entry invalidates everything that was "forward". */
  LeafHistory.prototype.pushState = function (entry) {
    const back = this.backHistory;
    back.push(entry);
    if (back.length > HISTORY_LIMIT) back.shift();
    this.forwardHistory = [];
    this.owner.trigger("history-change");
  };

  /** Moves `steps` entries (positive = forward, negative = back); stops at the ends. */
  LeafHistory.prototype.go = async function (steps) {
    if (this.owner.working) {
      new host.Notice(host.t.interface.msgTabBusy());
      return;
    }
    const here = this.owner.getHistoryState();
    let target = here;
    let entry;
    while (steps > 0 && (entry = this.forwardHistory.pop())) {
      this.backHistory.push(target);
      target = entry;
      steps--;
    }
    while (steps < 0 && (entry = this.backHistory.pop())) {
      this.forwardHistory.push(target);
      target = entry;
      steps++;
    }
    if (target !== here) await this.updateState(target);
  };

  LeafHistory.prototype.serialize = function () {
    return { backHistory: [...this.backHistory], forwardHistory: [...this.forwardHistory] };
  };

  LeafHistory.prototype.deserialize = function (data) {
    if (!data) return;
    if (data.backHistory) this.backHistory = data.backHistory;
    if (data.forwardHistory) this.forwardHistory = data.forwardHistory;
    this.owner.trigger("history-change");
  };

  return LeafHistory;
}

export function defineWorkspaceLeaf(host) {
  /** One pane: owns a view (or an empty / deferred / "unknown type" placeholder) and the tab header that represents it. */
  function WorkspaceLeaf(app, id) {
    const self = host.WorkspaceItem.call(this, app.workspace, id) || this;
    self.type = "leaf";
    self.activeTime = 0;
    self.history = new host.LeafHistory(self);
    self.hoverPopover = null;
    self.group = null; // id shared by leaves that follow each other ("linked" tabs)
    self.pinned = false;
    self.width = 0;
    self.height = 0;
    self.resizeObserver = null;
    self.working = false; // a setViewState is in flight
    self.app = app;

    const container = self.containerEl;
    container.addClass("workspace-leaf");
    container.addEventListener("focusin", () => { self.app.workspace.setActiveLeaf(self); });
    container.addEventListener("pointerdown", () => { self.app.workspace.setActiveLeaf(self); }, { capture: true });

    // closing through the x button: keep the tab widths still when the pointer stays in the strip
    const closeTab = () => {
      if (self.parent instanceof host.WorkspaceTabs) {
        const siblings = self.parent.children;
        if (self === siblings.last()) self.parent.unlockTabWidths();
        else self.parent.lockTabWidths();
      }
      self.detach();
    };

    const header = (self.tabHeaderEl = createDiv("workspace-tab-header tappable"));
    header.draggable = true;
    header.createDiv("workspace-tab-header-inner", (inner) => {
      self.tabHeaderInnerIconEl = inner.createDiv("workspace-tab-header-inner-icon");
      self.tabHeaderInnerTitleEl = inner.createDiv("workspace-tab-header-inner-title");
      self.tabHeaderStatusContainerEl = inner.createDiv("workspace-tab-header-status-container");
      self.tabHeaderCloseEl = inner.createDiv("workspace-tab-header-inner-close-button", (button) => {
        host.setIcon(button, "lucide-x");
        host.setTooltip(button, host.t.interface.menu.close());
        button.addEventListener("click", closeTab);
      });
    });
    header.addEventListener("dragstart", (event) => { self.workspace.onDragLeaf(event, self); });
    header.addEventListener("contextmenu", (event) => self.onOpenTabHeaderMenu(event, header));
    header.addEventListener("mousedown", (event) => { if (event.button === 1) event.preventDefault(); });
    header.addEventListener("auxclick", (event) => { if (event.button === 1) closeTab(); });
    header.addEventListener("mouseover", (event) => {
      if (event.defaultPrevented || !host.pointerEntered(event, header)) return;
      const state = self.getViewState().state;
      const file = state ? state.file : undefined;
      if (file && String.isString(file) && self.app.vault.getFileByPath(file)) {
        self.workspace.trigger("hover-link", { event, source: "tab-header", hoverParent: self, targetEl: header, linktext: file });
      }
    });

    // views are told about size changes, at most every 20 ms, and only when the size really changed
    const notifyResize = debounceCall(self.onResize.bind(self), 20, true);
    self.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target !== container) continue;
        const width = container.offsetWidth;
        const height = container.offsetHeight;
        if (width === self.width && height === self.height) return;
        self.width = width;
        self.height = height;
        notifyResize();
        return;
      }
    });
    self.resizeObserver.observe(container);

    self.view = self._empty = new host.EmptyView(self);
    self.view.open(self.containerEl);
    return self;
  }
  inherit(WorkspaceLeaf, host.WorkspaceItem);

  WorkspaceLeaf.prototype.serialize = function () {
    const data = host.WorkspaceItem.prototype.serialize.call(this);
    if (this.pinned) data.pinned = true;
    data.state = this.getViewState();
    if (this.group) data.group = this.group;
    return data;
  };

  /** True when something may be opened here (the view navigates and the tab is not pinned). */
  WorkspaceLeaf.prototype.canNavigate = function () {
    return this.view.navigation && !this.pinned;
  };

  /** Opens `file` with the view type registered for its extension (or keeps the current file view when it accepts it). */
  WorkspaceLeaf.prototype.openFile = async function (file, options) {
    if (!file) return;
    options = options || {};
    const current = this.view;
    let type = this.app.viewRegistry.getTypeByExtension(file.extension);
    if (current && current instanceof host.FileView && current.canAcceptExtension(file.extension)) type = current.getViewType();
    if (!type) {
      this.app.openWithDefaultApp(file.path);
      return;
    }
    const state = options.state || {};
    const active = options.active !== null && options.active !== undefined ? options.active : this === this.workspace.activeLeaf;
    state.file = file.path;
    await this.setViewState({ type, state, active, group: options.group }, options.eState);
  };

  /** Opens a wiki link ("Note#Heading"); a link to a missing note creates it. Errors are shown as a notice. */
  WorkspaceLeaf.prototype.openLinkText = async function (linktext, sourcePath, options) {
    const app = this.app;
    try {
      options = options || {};
      const { path, subpath } = parseLinktext(linktext);
      let file = app.metadataCache.getFirstLinkpathDest(path, sourcePath);
      const state = options.state || {};
      const eState = options.eState || {};
      if (file) {
        if (subpath) eState.subpath = subpath;
      } else {
        let parent = null;
        if (!path.contains("/")) parent = app.fileManager.getNewFileParent(sourcePath, linktext);
        file = await app.fileManager.createNewFile(parent, path);
        state.mode = "source";
      }
      options.state = state;
      options.eState = eState;
      await this.openFile(file, options);
    } catch (err) {
      new host.Notice(err.message);
      console.error(err);
    }
  };

  /** Swaps the leaf's view for `view` (null = the empty view); the old view is closed first. */
  WorkspaceLeaf.prototype.open = async function (view) {
    const old = this.view;
    if (view === old) return view;
    if (old) {
      const closing = old.close();
      // deferred and empty views have nothing to wait for
      if (!(old instanceof host.DeferredView || old instanceof host.EmptyView)) await closing;
    }
    this.containerEl.setChildrenInPlace([this.resizeHandleEl]);
    if (!view) view = this._empty;
    this.view = view;
    try {
      await view.open(this.containerEl);
    } catch (err) {
      console.error("Failed to open view", err);
    }
    return view;
  };

  WorkspaceLeaf.prototype.highlight = function () { this.containerEl.addClass("is-highlighted"); };
  WorkspaceLeaf.prototype.unhighlight = function () { this.containerEl.removeClass("is-highlighted"); };

  /** { type, state, pinned?, icon?, title? } as stored in the layout file. */
  WorkspaceLeaf.prototype.getViewState = function () {
    const view = this.view;
    const data = { type: view ? view.getViewType() : "empty", state: view ? view.getState() : {} };
    if (this.pinned) data.pinned = true;
    if (view) {
      data.icon = view.getIcon() || undefined;
      data.title = view.getDisplayText().trim() || undefined;
    }
    return data;
  };

  /**
   * Makes the leaf show `viewState` (creating the view when the type changes); `eState` is ephemeral state (scroll, focus, ...).
   * A call while another one is in flight is ignored. History: the state that was left is recorded unless this was a history move.
   */
  WorkspaceLeaf.prototype.setViewState = async function (viewState, eState) {
    if (this.working) return;
    this.working = true;
    try {
      let view = this.view;
      const oldType = view ? view.getViewType() : "";
      const wasDeferred = view instanceof host.DeferredView;
      const typeChanged = viewState.type !== oldType;
      let leftState;
      if (view && !(view instanceof host.EmptyView)) leftState = this.getHistoryState();
      const result = { history: false, layout: false, close: false };

      if (typeChanged || wasDeferred) {
        const create = this.app.viewRegistry.getViewCreatorByType(viewState.type);
        if (create) {
          // a hidden tab restored from a layout does not need its view yet: use a placeholder until it is shown
          const needsRealView = leftState || wasDeferred || !viewState.icon || viewState.title === undefined || this.containerEl.isShown();
          view = needsRealView ? create(this) : new host.DeferredView(this, viewState.type, viewState.icon, viewState.title);
        } else if (typeof viewState.type !== "string" || viewState.type === "empty") {
          view = this._empty;
        } else {
          view = new host.UnknownView(this, viewState.type);
        }
        await this.open(view);
        result.history = true;
        result.layout = true;
      }

      const state = viewState.state || {};
      try {
        await view.setState(state, result);
      } catch (err) {
        console.error(err);
      }
      if (result.close) await this.open(null);

      if (viewState.active) this.workspace.setActiveLeaf(this, { focus: true });
      if (viewState.group !== undefined) this.setGroupMember(viewState.group);
      if (eState) this.setEphemeralState(eState);
      if (viewState.popstate || state.sync || (wasDeferred && !typeChanged)) result.history = false;
      if (result.layout) this.workspace.onLayoutChange();
      this.updateHeader();
      if (result.history && leftState) this.recordHistory(leftState);
      if (result.done) result.done();
    } finally {
      this.working = false;
    }
  };

  Object.defineProperty(WorkspaceLeaf.prototype, "isDeferred", {
    get() { return this.view instanceof host.DeferredView; },
    enumerable: false,
    configurable: true,
  });

  /** Builds the real view of a leaf that so far only has a placeholder. */
  WorkspaceLeaf.prototype.loadIfDeferred = async function () {
    if (this.view instanceof host.DeferredView) await this.view.rerender();
  };

  /** Throws the view away and creates it again from its own state. */
  WorkspaceLeaf.prototype.rebuildView = async function () {
    const viewState = this.getViewState();
    const eState = this.getEphemeralState();
    await this.open(null);
    await this.setViewState(viewState, eState);
  };

  WorkspaceLeaf.prototype.getEphemeralState = function () { return this.view.getEphemeralState(); };

  WorkspaceLeaf.prototype.setEphemeralState = function (eState) {
    if (eState && eState.focus) {
      // the view is about to take focus: drop the selection and focus of whatever else holds it
      const focused = this.containerEl.doc.activeElement;
      if (focused && focused.instanceOf(HTMLElement) && focused !== document.body && this.containerEl !== focused &&
          !this.containerEl.contains(focused) && this.app.workspace.layoutReady) {
        focused.blur();
        getSelection().removeAllRanges();
      }
    }
    this.view.setEphemeralState(eState);
  };

  WorkspaceLeaf.prototype.togglePinned = function () { this.setPinned(!this.pinned); };

  /** Pins / unpins the leaf and every leaf linked to it. */
  WorkspaceLeaf.prototype.setPinned = function (pinned) {
    this.pinned = pinned;
    this.trigger("pinned-change", pinned);
    this.updateHeader();
    this.workspace.requestSaveLayout();
    const group = this.group;
    if (group) {
      for (const leaf of this.workspace.getGroupLeaves(group)) if (leaf.pinned !== pinned) leaf.setPinned(pinned);
    }
  };

  WorkspaceLeaf.prototype.canPin = function () { return this.parent instanceof host.WorkspaceTabs; };

  /** Joins the link group of `other` (creating the group when it has none); null leaves any group. */
  WorkspaceLeaf.prototype.setGroupMember = function (other) {
    if (other === this) return;
    let group = null;
    if (other) {
      group = other.group;
      if (!group) {
        group = randomHex(16);
        other.setGroup(group);
      }
    }
    this.setGroup(group);
  };

  WorkspaceLeaf.prototype.setGroup = function (group) {
    if (group === this.group) return;
    // a leaf joining a group with a pinned member becomes pinned too
    let pinned = this.pinned;
    if (!pinned) {
      for (const leaf of this.workspace.getGroupLeaves(group)) {
        if (leaf.pinned) { pinned = true; break; }
      }
    }
    this.setPinned(pinned);
    this.group = group;
    this.trigger("group-change", group);
    this.updateHeader();
    this.workspace.requestUpdateLayout();
  };

  /** Closes the leaf: the view is closed (the closed leaf goes on the "reopen closed tab" stack) and the node leaves the tree. */
  WorkspaceLeaf.prototype.detach = function () {
    const parentId = this.parent ? this.parent.id : undefined;
    const rootId = this.getRoot().id;
    host.WorkspaceItem.prototype.detach.call(this);
    const { group, view, resizeObserver } = this;
    if (group) for (const leaf of this.workspace.getGroupLeaves(group)) leaf.unhighlight();
    if (view) {
      this.workspace.pushUndoHistory(this, parentId, rootId);
      view.close();
      this.view = this._empty;
    }
    if (resizeObserver) resizeObserver.disconnect();
  };

  /** Refreshes icon, title, link / pin markers and tooltip of the tab header. */
  WorkspaceLeaf.prototype.updateHeader = function () {
    const leaf = this;
    host.setIcon(this.tabHeaderInnerIconEl, this.getIcon());
    this.tabHeaderInnerTitleEl.setText(this.getDisplayText());

    if (this.group) {
      if (!this.tabHeaderStatusLinkEl) {
        this.tabHeaderStatusLinkEl = this.tabHeaderStatusContainerEl.createDiv({ cls: "workspace-tab-header-status-icon mod-linked", prepend: true }, (el) => {
          host.setIcon(el, "lucide-link");
          host.setTooltip(el, host.t.interface.menu.unlinkTab());
          el.addEventListener("click", () => {
            for (const member of leaf.workspace.getGroupLeaves(leaf.group)) member.unhighlight();
            leaf.setGroup(null);
          });
          el.addEventListener("mouseover", () => {
            host.setIcon(el, "lucide-unlink");
            for (const member of leaf.workspace.getGroupLeaves(leaf.group)) member.highlight();
          });
          el.addEventListener("mouseout", () => {
            host.setIcon(el, "lucide-link");
            for (const member of leaf.workspace.getGroupLeaves(leaf.group)) member.unhighlight();
          });
        });
      }
    } else {
      if (this.tabHeaderStatusLinkEl) this.tabHeaderStatusLinkEl.detach();
      this.tabHeaderStatusLinkEl = null;
    }

    if (this.pinned) {
      this.tabHeaderCloseEl.hide();
      if (!this.tabHeaderStatusPinEl) {
        this.tabHeaderStatusPinEl = this.tabHeaderStatusContainerEl.createDiv("workspace-tab-header-status-icon mod-pinned", (el) => {
          host.setIcon(el, "lucide-pin");
          host.setTooltip(el, host.t.interface.menu.unpin());
          el.addEventListener("click", () => leaf.setPinned(false));
        });
      }
    } else {
      this.tabHeaderCloseEl.show();
      if (this.tabHeaderStatusPinEl) this.tabHeaderStatusPinEl.detach();
      this.tabHeaderStatusPinEl = null;
    }

    host.setTooltip(this.tabHeaderEl, ellipsize(this.getDisplayText(), 100), { delay: host.TOOLTIP_DELAY });
    if (this.parent instanceof host.MobileDrawer) this.parent.updateCurrentTab();
    const type = this.view ? this.view.getViewType() : "";
    this.tabHeaderEl.setAttr("data-type", type);
    this.tabHeaderEl.toggleClass("mod-unknown", this.view && this.view instanceof host.UnknownView);
  };

  WorkspaceLeaf.prototype.getIcon = function () {
    return this.view.getIcon() || host.WorkspaceItem.prototype.getIcon.call(this);
  };

  WorkspaceLeaf.prototype.getDisplayText = function () {
    return this.view.getDisplayText() || "";
  };

  WorkspaceLeaf.prototype.isVisible = function () { return this.containerEl.isShown(); };

  /** Right click on the tab header: the view and plugins contribute the menu items. */
  WorkspaceLeaf.prototype.onOpenTabHeaderMenu = function (event, headerEl) {
    event.preventDefault();
    const menu = host.Menu.forEvent(event).addSections([
      "title", "close", "pane", "open", "action", "find", "info", "info.copy", "view", "view.linked", "system", "", "danger",
    ]);
    menu.setSectionSubmenu("info.copy", { title: host.t.interface.menu.copyPath(), icon: "lucide-clipboard" });
    menu.setSectionSubmenu("view.linked", { title: host.t.interface.menu.openLinkedView(), icon: "lucide-link" });
    if (host.Platform.isPhone) {
      menu.addItem((item) => item
        .setSection("title")
        .setTitle(this.view.getDisplayText())
        .setIcon(this.view.getIcon())
        .setIsLabel(true)
        .titleEl.addClass("u-muted"));
    }
    this.view.onTabMenu(menu);
    const switcher = this.app.mobileTabSwitcher;
    if (this.isVisible() && !(host.Platform.isMobile && switcher && switcher.isVisible)) {
      this.view.onPaneMenu(menu, this.workspace.isInSidebar(this) ? "sidebar-context-menu" : "tab-header");
      this.app.workspace.trigger("leaf-menu", menu, this);
    }
    menu.setParentElement(headerEl);
  };

  /** Something is dragged onto the leaf's content: bookmarks and files / links open in this leaf. */
  WorkspaceLeaf.prototype.handleDrop = function (event, data, isPreview) {
    const ui = host.t.interface.dragAndDrop;
    if (data.type === "bookmarks") {
      const plugin = this.app.internalPlugins.getEnabledPluginById("bookmarks");
      if (plugin) {
        const items = data.items.map((entry) => entry.item).filter((item) => item.type === "file" || item.type === "graph");
        if (items.length !== 1) return undefined;
        if (!isPreview) plugin.openBookmarkInLeaf(items[0], this, { active: true });
      }
      return { action: ui.openInThisTab(), dropEffect: "move" };
    }
    if (data.type === "file" || data.type === "link") {
      if (!isPreview) {
        this.workspace.setActiveLeaf(this);
        if (data.type === "file") this.openFile(data.file);
        else this.openLinkText(data.linktext, data.sourcePath);
      }
      return { action: ui.openInThisTab(), dropEffect: "move" };
    }
    return undefined;
  };

  WorkspaceLeaf.prototype.getHistoryState = function () {
    return { title: this.getDisplayText(), icon: this.getIcon(), state: this.getViewState(), eState: this.getEphemeralState() };
  };

  /** Pushes `entry` (the state that was left) on the back stack unless it equals the last recorded one. */
  WorkspaceLeaf.prototype.recordHistory = function (entry) {
    const view = this.view;
    if (!view || !view.navigation || view instanceof host.EmptyView) return;
    const last = this.history.backHistory.last();
    if (last && JSON.stringify(last.state) === JSON.stringify(entry.state)) return;
    this.history.pushState(entry);
  };

  WorkspaceLeaf.prototype.onResize = function () {
    if (this.view) this.view.onResize();
  };

  WorkspaceLeaf.prototype.trigger = function (name, ...args) {
    host.WorkspaceItem.prototype.trigger.apply(this, [name, ...args]);
  };

  WorkspaceLeaf.prototype.on = function (name, callback, context) {
    return host.WorkspaceItem.prototype.on.call(this, name, callback, context);
  };

  return WorkspaceLeaf;
}
