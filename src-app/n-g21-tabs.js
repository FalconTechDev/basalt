// n-g21-tabs.js — WorkspaceTabs: the tab-group node of the workspace layout tree
// (clean-room, spec g21 §3.3). One strip of leaf headers on top, one content pane below;
// stacked mode turns the group into a vertical accordion of header+pane pairs.
import { inherit } from "./inherit.js";
import { s05TitlebarDoubleClick } from "./s05-utils.js";

export function ng21DefineWorkspaceTabs(host) {
  function WorkspaceTabs(workspace, id) {
    const self = host.WorkspaceParent.call(this, workspace, id) || this;
    self.type = "tabs";
    self.children = [];
    self.parent = null;
    self.allowSingleChild = true;
    self.autoManageDOM = false;
    self.currentTab = 0;
    self.isStacked = false;
    self.hasLockedTabWidths = false;
    self.tabHeaderEls = [];

    self.containerEl.addClass("workspace-tabs");
    const headerContainer = (self.tabHeaderContainerEl = self.containerEl.createDiv("workspace-tab-header-container"));
    self.tabsInnerEl = headerContainer.createDiv("workspace-tab-header-container-inner");

    const plusWrap = headerContainer.createDiv("workspace-tab-header-new-tab");
    const plus = plusWrap.createDiv("clickable-icon");
    host.setIcon(plus, "lucide-plus");
    host.setTooltip(plus, host.t.interface.labelNewTab(), { delay: host.TOOLTIP_DELAY });
    plus.addEventListener("click", () => {
      const leaf = new host.WorkspaceLeaf(self.workspace.app);
      self.insertChild(self.children.length, leaf);
      self.selectTabIndex(self.children.length - 1);
      self.workspace.setActiveLeaf(leaf, { focus: true });
    });

    headerContainer.createDiv("workspace-tab-header-spacer");

    const listWrap = headerContainer.createDiv("workspace-tab-header-tab-list");
    const listBtn = listWrap.createDiv("clickable-icon");
    host.setIcon(listBtn, "lucide-chevron-down");
    const openList = () => {
      if (!listWrap.hasClass("has-active-menu")) self.showTabListMenu(listWrap);
    };
    listBtn.addEventListener("click", openList);
    listBtn.addEventListener("contextmenu", (event) => { event.preventDefault(); openList(); });

    self.tabsContainerEl = self.containerEl.createDiv("workspace-tab-container");

    self.containerEl.addEventListener("click", (event) => {
      const header = event.target && event.target.closest ? event.target.closest(".workspace-tab-header") : null;
      if (!header || !self.containerEl.contains(header)) return;
      const index = self.children.findIndex((child) => child.tabHeaderEl === header || (child.tabHeaderEl && child.tabHeaderEl.contains(header)));
      if (index < 0) return;
      self.selectTabIndex(index);
      const leaf = self.children[index];
      if (leaf instanceof host.WorkspaceLeaf) self.workspace.setActiveLeaf(leaf, { focus: true });
    });

    self.tabsInnerEl.addEventListener("wheel", (event) => {
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) self.tabsInnerEl.scrollLeft += event.deltaY;
      else self.tabsInnerEl.scrollLeft += event.deltaX;
      event.preventDefault();
    }, { passive: false });
    self.tabsInnerEl.addEventListener("mouseleave", () => self.unlockTabWidths());
    self.tabsContainerEl.addEventListener("scroll", () => self.onContainerScroll(), { passive: true });

    self._resizeObserver = new ResizeObserver(() => self.updateSlidingTabs());
    self._resizeObserver.observe(self.tabsContainerEl);

    const win = self.containerEl.win || window;
    if (win.frameDom) s05TitlebarDoubleClick(headerContainer);

    const dragManager = self.workspace.app && self.workspace.app.dragManager;
    if (dragManager && dragManager.handleDrop) {
      dragManager.handleDrop(headerContainer, (event, data, isPreview) => self.onHeaderDrop(event, data, isPreview));
    }

    return self;
  }
  inherit(WorkspaceTabs, host.WorkspaceParent);
  const p = WorkspaceTabs.prototype;

  p.getRoot = function () { return host.WorkspaceItem.prototype.getRoot.call(this); };

  p.serialize = function () {
    const data = host.WorkspaceParent.prototype.serialize.call(this);
    if (this.currentTab > 0) data.currentTab = this.currentTab;
    if (this.isStacked) data.stacked = true;
    return data;
  };

  p.selectTab = function (leaf) {
    const index = this.children.indexOf(leaf);
    if (index >= 0) this.selectTabIndex(index);
  };

  p.selectTabIndex = function (index) {
    const len = this.children.length;
    if (!len) { this.currentTab = 0; return; }
    index = Math.max(0, Math.min(index, len - 1));
    if (index === this.currentTab) return;
    this.currentTab = index;
    this.updateTabDisplay();
    if (this.isStacked) {
      const leaf = this.children[index];
      if (leaf && leaf.containerEl && leaf.containerEl.scrollIntoView) leaf.containerEl.scrollIntoView({ block: "nearest" });
      this.scrollIntoView(index);
    }
    this.workspace.requestSaveLayout();
    this.workspace.requestResize();
  };

  p.updateHeader = function () {
    const headers = this.children.map((child) => child.tabHeaderEl).filter(Boolean);
    this.tabHeaderEls = headers;
    this.tabsInnerEl.setChildrenInPlace(headers);
  };

  p.insertChild = function (index, node) {
    host.WorkspaceParent.prototype.insertChild.call(this, index, node);
    if (node.tabHeaderEl) node.tabHeaderEl.cancelTransition && node.tabHeaderEl.cancelTransition();
    this.updateHeader();
    this.unlockTabWidths();
    this.updateTabDisplay();
  };

  p.removeChild = function (node) {
    const index = this.children.indexOf(node);
    const wasCurrent = index === this.currentTab;
    const previousLeaf = this.children[this.currentTab];
    if (node.tabHeaderEl) node.tabHeaderEl.removeClass("is-active");
    if (this.children.length === 1) this.workspace.lastTabGroupStacked = this.isStacked;
    host.WorkspaceParent.prototype.removeChild.call(this, node);
    if (wasCurrent) {
      this.currentTab = Math.min(index, this.children.length - 1);
      this.workspace.onLayoutChange(this);
    } else {
      this.currentTab = this.children.indexOf(previousLeaf);
      if (this.currentTab < 0) this.currentTab = 0;
    }
    this.updateTabDisplay();
  };

  p.recomputeChildrenDimensions = function () { this.updateSlidingTabs(); };

  WorkspaceTabs.createFrom = function (workspace, leaf) {
    if (leaf instanceof host.WorkspaceParent) return leaf;
    const tabs = new WorkspaceTabs(workspace);
    tabs.insertChild(0, leaf);
    tabs.selectTabIndex(0);
    return tabs;
  };

  // --- display reconciliation -------------------------------------------------

  p.updateTabDisplay = function () {
    const content = this.tabsContainerEl;
    const children = this.children;
    if (!children.length) {
      content.setChildrenInPlace([]);
      this.tabHeaderEls = [];
      this.updateSlidingTabs();
      return;
    }
    let clamped = false;
    if (this.currentTab >= children.length) { this.currentTab = children.length - 1; clamped = true; }
    if (this.currentTab < 0) { this.currentTab = 0; clamped = true; }
    if (clamped) { this.workspace.requestSaveLayout(); this.workspace.requestResize(); }

    const stacked = this.isStacked;
    const wanted = [];
    children.forEach((leaf, i) => {
      const isCurrent = i === this.currentTab;
      if (leaf.tabHeaderEl) {
        leaf.tabHeaderEl.toggleClass("is-active", isCurrent);
        if (stacked && leaf.tabHeaderEl.cancelTransition) leaf.tabHeaderEl.cancelTransition();
      }
      if (stacked) {
        if (leaf.loadIfDeferred) leaf.loadIfDeferred();
        wanted.push(leaf.tabHeaderEl, leaf.containerEl);
        if (leaf.containerEl.hide || leaf.containerEl.show) {
          if (isCurrent) leaf.containerEl.show(); else leaf.containerEl.hide();
        }
      } else {
        wanted.push(leaf.containerEl);
      }
    });

    if (stacked) {
      content.setChildrenInPlace(wanted);
    } else {
      const current = children[this.currentTab];
      for (const node of Array.from(content.children)) {
        if (!current || node !== current.containerEl) node.detach();
      }
      if (current && current.containerEl.parentNode !== content) content.appendChild(current.containerEl);
    }
    this.updateSlidingTabs();

    if (!stacked && this.tabsInnerEl.isShown && this.tabsInnerEl.isShown()) {
      this.animateHeaderChanges(this.tabHeaderEls);
    } else {
      this.tabsInnerEl.setChildrenInPlace(this.tabHeaderEls);
    }

    const leaf = children[this.currentTab];
    if (leaf) {
      const doc = content.win ? content.win.document : document;
      const durVar = doc.documentElement.style;
      durVar.setProperty("--animation-dur", "0s");
      const root = this.getRoot && this.getRoot();
      if (root instanceof host.WorkspaceSidedock && this.tabHeaderContainerEl) {
        const headerWidth = this.tabHeaderContainerEl.clientWidth || 0;
        this.tabsInnerEl.scrollLeft = headerWidth * this.currentTab;
      }
      if (this.isShown && this.isShown()) {
        if (leaf.loadIfDeferred) leaf.loadIfDeferred();
      }
      durVar.setProperty("--animation-dur", "250ms");
    }
  };

  p.isShown = function () { return this.containerEl.isShown(); };

  p.animateHeaderChanges = function (headers) {
    const inner = this.tabsInnerEl;
    const wanted = headers.slice();
    const current = Array.from(inner.children).filter((el) => el.classList.contains("workspace-tab-header"));
    const added = wanted.filter((el) => !current.includes(el));
    const removed = current.filter((el) => !wanted.includes(el));
    inner.setChildrenInPlace(wanted);
    for (const el of added) {
      const w = el.clientWidth || 0;
      el.style.flex = "0 0 auto";
      el.style.width = "0px";
      el.style.opacity = "0";
      requestAnimationFrame(() => {
        el.style.transition = "width 200ms, opacity 200ms";
        el.style.width = w + "px";
        el.style.opacity = "1";
        setTimeout(() => { el.style.flex = ""; el.style.width = ""; el.style.opacity = ""; el.style.transition = ""; }, 220);
      });
    }
    for (const el of removed) {
      const clone = el.cloneNode(true);
      clone.style.flex = "0 0 auto";
      clone.style.width = (el.clientWidth || 0) + "px";
      el.parentNode && el.parentNode.insertBefore(clone, el);
      requestAnimationFrame(() => {
        clone.style.transition = "width 200ms, opacity 200ms";
        clone.style.width = "0px";
        clone.style.opacity = "0";
        setTimeout(() => clone.remove(), 220);
      });
    }
  };

  // --- stacked mode ------------------------------------------------------------

  p.setStacked = function (b) {
    if (!host.Platform.canStackTabs) b = false;
    if (this.isStacked === !!b) return;
    this.isStacked = !!b;
    this.containerEl.toggleClass("mod-stacked", this.isStacked);
    this.updateTabDisplay();
    this.scrollIntoView(this.currentTab);
    this.workspace.requestUpdateLayout();
  };

  p.updateSlidingTabs = function () {
    const headers = this.tabHeaderEls || [];
    const stacked = this.isStacked;
    for (const header of headers) {
      header.style.left = ""; header.style.right = "";
      header.style.minWidth = ""; header.style.maxWidth = "";
    }
    if (!stacked) {
      for (const leaf of this.children) {
        if (leaf.containerEl) {
          leaf.containerEl.style.left = "";
          leaf.containerEl.style.minWidth = "";
          leaf.containerEl.style.maxWidth = "";
        }
      }
      return;
    }
    const content = this.tabsContainerEl;
    const contentWidth = content.clientWidth || 0;
    const headerWidths = headers.map((h) => h.clientWidth || 0);
    const headerSum = headerWidths.reduce((a, b) => a + b, 0);
    const n = Math.max(1, this.children.length);
    const maxPane = Math.max(300, contentWidth - headerSum);
    const minPane = maxPane / n;
    let acc = 0;
    headers.forEach((header, i) => {
      header.style.position = "sticky";
      header.style.left = acc + "px";
      header.style.right = (contentWidth - acc - (headerWidths[i] || 0)) + "px";
      acc += headerWidths[i] || 0;
    });
    acc = 0;
    this.children.forEach((leaf, i) => {
      const pane = leaf.containerEl;
      if (!pane) return;
      pane.style.position = "relative";
      pane.style.left = acc + "px";
      pane.style.minWidth = minPane + "px";
      pane.style.maxWidth = minPane + "px";
      acc += minPane;
    });
    this.onContainerScroll();
  };

  p.onContainerScroll = function () {
    if (!this.isStacked) return;
    const content = this.tabsContainerEl;
    const viewTop = content.scrollTop;
    const viewBottom = viewTop + content.clientHeight;
    this.children.forEach((leaf, i) => {
      if (!leaf.containerEl) return;
      const top = leaf.containerEl.offsetTop;
      const bottom = top + leaf.containerEl.offsetHeight;
      const hidden = bottom <= viewTop || top >= viewBottom;
      leaf.containerEl.toggleClass("is-hidden", hidden && i !== this.currentTab);
    });
  };

  p.scrollIntoView = function (index) {
    if (!this.isStacked) return;
    const content = this.tabsContainerEl;
    const leaf = this.children[index];
    if (!leaf || !leaf.containerEl) return;
    const header = leaf.tabHeaderEl;
    const top = Math.min(header ? header.offsetTop : leaf.containerEl.offsetTop, leaf.containerEl.offsetTop);
    const bottom = leaf.containerEl.offsetTop + leaf.containerEl.offsetHeight;
    const viewH = content.clientHeight;
    const target = top < content.scrollTop ? top : (bottom > content.scrollTop + viewH ? bottom - viewH : content.scrollTop);
    content.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  };

  // --- width locking -------------------------------------------------------------

  p.lockTabWidths = function () {
    if (this.hasLockedTabWidths || this.isStacked) return;
    if (!this.tabsInnerEl.isShown || !this.tabsInnerEl.isShown()) return;
    this.hasLockedTabWidths = true;
    for (const header of this.tabHeaderEls) {
      if (header) header.style.width = header.clientWidth + "px";
    }
  };

  p.unlockTabWidths = function () {
    if (!this.hasLockedTabWidths) return;
    this.hasLockedTabWidths = false;
    for (const header of this.tabHeaderEls) {
      if (!header) continue;
      if (this.tabsInnerEl.isShown && this.tabsInnerEl.isShown()) {
        header.style.transition = "width 250ms";
        header.style.width = "";
        setTimeout(() => { header.style.transition = ""; }, 260);
      } else {
        header.style.width = "";
      }
    }
  };

  // --- tab list menu ---------------------------------------------------------------

  p.showTabListMenu = function (anchor) {
    const menu = new host.Menu();
    menu.dom.addClass("mod-tab-list");
    const t = host.t.interface;
    menu.addItem((item) => item
      .setSection("action")
      .setIcon("lucide-layers")
      .setTitle(this.isStacked
        ? (t.unstackTabs ? t.unstackTabs() : (t.stackTabs ? t.stackTabs() : "Unstack tabs"))
        : (t.stackTabs ? t.stackTabs() : "Stack tabs"))
      .onClick(() => this.setStacked(!this.isStacked)));
    menu.addItem((item) => item
      .setSection("close")
      .setIcon("lucide-x")
      .setTitle(t.menu.closeAll ? t.menu.closeAll() : "Close all tabs")
      .onClick(() => {
        for (const leaf of this.children.slice()) {
          if (leaf instanceof host.WorkspaceLeaf && !leaf.pinned) leaf.detach();
        }
      }));
    menu.addSeparator();
    this.workspace.trigger("tab-group-menu", menu, this);
    for (const leaf of this.children) {
      if (!(leaf instanceof host.WorkspaceLeaf) || !leaf.view) continue;
      const isCurrent = this.children[this.currentTab] === leaf;
      menu.addItem((item) => item
        .setSection("tablist")
        .setTitle(leaf.getDisplayText())
        .setIcon(leaf.getIcon())
        .setChecked(isCurrent)
        .onClick(() => this.workspace.setActiveLeaf(leaf)));
    }
    const rect = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    menu.showAtPosition({ x: rect.left, y: rect.bottom, width: rect.width, overlap: true, left: true });
    return menu;
  };

  // --- drag & drop -----------------------------------------------------------------

  p.getTabInsertLocation = function (clientX) {
    const headers = this.tabHeaderEls;
    let insertIndex = this.children.length;
    let droppedIndex = null;
    let marker = null;
    for (let i = 0; i < headers.length; i++) {
      const el = headers[i];
      if (!el || !el.isShown || !el.isShown()) continue;
      const rect = el.getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      if (Math.abs(clientX - mid) / Math.max(1, rect.width) < 0.25) droppedIndex = i;
      if (clientX < mid) { insertIndex = i; break; }
      insertIndex = i + 1;
    }
    const refIndex = Math.min(insertIndex, headers.length - 1);
    const refEl = headers[refIndex];
    if (refEl && refEl.isShown && refEl.isShown()) {
      const rect = refEl.getBoundingClientRect();
      const edge = insertIndex <= refIndex ? rect.left : rect.right;
      marker = { left: edge - 5, top: rect.top, width: 10, height: rect.height };
    }
    return { index: insertIndex, droppedIndex, marker };
  };

  p.onHeaderDrop = function (event, data, isPreview) {
    const kind = data && data.type;
    if (kind !== "file" && kind !== "files" && kind !== "link" && kind !== "bookmarks") return undefined;
    const ui = host.t.interface.dragAndDrop || {};
    const app = this.workspace.app;
    const loc = this.getTabInsertLocation(event.clientX);
    const leaf = loc.droppedIndex != null ? this.children[loc.droppedIndex] : null;

    const bookmarkItems = () => {
      const plugin = app.internalPlugins && app.internalPlugins.getEnabledPluginById("bookmarks");
      if (!plugin) return null;
      const items = (data.items || []).map((entry) => entry.item || entry)
        .filter((item) => item && (item.type === "file" || item.type === "graph"));
      return items.length ? { plugin, items } : null;
    };

    // drop onto the middle of a tab: reuse that leaf
    if (leaf) {
      const reuse = () => {
        this.workspace.setActiveLeaf(leaf);
        if (kind === "link" && leaf.canNavigate && leaf.canNavigate()) {
          leaf.openLinkText(data.linktext, data.sourcePath, { active: true });
        } else if (kind === "file" || kind === "files") {
          const file = kind === "files" ? (data.files || [])[0] : data.file;
          if (file) leaf.openFile(file, { active: true });
        } else if (kind === "bookmarks") {
          const bm = bookmarkItems();
          if (bm && bm.items.length === 1) bm.plugin.openBookmarkInLeaf(bm.items[0], leaf, { active: true });
        }
      };
      if (isPreview) {
        return { hoverEl: leaf.tabHeaderEl, hoverClass: "is-highlighted", action: ui.openInThisTab ? ui.openInThisTab() : "", dropEffect: "move" };
      }
      reuse();
      return { action: ui.openInThisTab ? ui.openInThisTab() : "", dropEffect: "move" };
    }

    // drop between tabs: open payload in fresh leaves at the insert index
    const openable =
      (kind === "files" && (data.files || []).length > 0) ||
      (kind === "file" && data.file) ||
      (kind === "link" && data.linktext) ||
      (kind === "bookmarks" && bookmarkItems());
    if (!openable) return undefined;
    if (kind === "bookmarks") {
      const bm = bookmarkItems();
      if (!bm || bm.items.length !== (data.items || []).length) {
        // multi/mixed bookmark drops are not supported here
        if ((data.items || []).length > 1) return undefined;
      }
    }

    if (isPreview) {
      if (app.dragManager && app.dragManager.showOverlay) app.dragManager.showOverlay(event.doc || document, loc.marker ? { x: loc.marker.left, y: loc.marker.top, width: loc.marker.width, height: loc.marker.height } : this.tabHeaderContainerEl.getBoundingClientRect());
      return { action: ui.openAsTab ? ui.openAsTab() : "", dropEffect: "copy" };
    }

    let index = loc.index;
    const makeLeaf = () => {
      const nl = new host.WorkspaceLeaf(app);
      this.insertChild(index++, nl);
      return nl;
    };
    if (kind === "files") {
      let last = null;
      for (const file of data.files || []) {
        const nl = makeLeaf();
        nl.openFile(file, { active: false });
        last = nl;
      }
      if (last) this.workspace.setActiveLeaf(last, { focus: true });
    } else if (kind === "file") {
      const nl = makeLeaf();
      nl.openFile(data.file, { active: true });
    } else if (kind === "link") {
      const nl = makeLeaf();
      nl.openLinkText(data.linktext, data.sourcePath, { active: true });
    } else if (kind === "bookmarks") {
      const bm = bookmarkItems();
      if (bm) {
        for (const item of bm.items) {
          const nl = makeLeaf();
          bm.plugin.openBookmarkInLeaf(item, nl, { active: false });
        }
        const last = this.children[Math.min(index - 1, this.children.length - 1)];
        if (last) this.workspace.setActiveLeaf(last, { focus: true });
      }
    }
    this.selectTabIndex(Math.min(index - 1, this.children.length - 1));
    if (app.dragManager && app.dragManager.showOverlay) app.dragManager.showOverlay(event.doc || document, loc.marker ? { x: loc.marker.left, y: loc.marker.top, width: loc.marker.width, height: loc.marker.height } : this.tabHeaderContainerEl.getBoundingClientRect());
    return { action: ui.openAsTab ? ui.openAsTab() : "", dropEffect: "copy" };
  };

  return WorkspaceTabs;
}
