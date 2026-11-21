// n-g25-view.js — clean-room View / ItemView base classes (spec g25 Part G).
// Plain constructor functions + prototype methods: inherited code calls
// `host.View.call(this, leaf)` / `host.ItemView.call(this, leaf)` and links
// subclasses with inherit(), so ES6 classes are not usable here.

import { inherit } from "./inherit.js";

function ng25vDiv(cls, doc) {
  const d = (doc || document).createElement("div");
  if (cls) d.className = cls;
  return d;
}

function ng25vSetText(el, text) {
  if (el.setText) el.setText(text);
  else el.textContent = text;
}

function ng25vDebounce(fn, ms) {
  let t = null;
  const d = (...a) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...a); }, ms);
  };
  return d;
}

export function defineView(host) {
  const H = host;

  function View(leaf) {
    const self = H.Component.call(this) || this;
    self.icon = "lucide-file";
    self.navigation = false;
    self.app = leaf.app;
    self.leaf = leaf;
    const parent = leaf.containerEl;
    self.containerEl = parent && parent.createDiv
      ? parent.createDiv("workspace-leaf-content")
      : ng25vDiv("workspace-leaf-content", parent && parent.ownerDocument);
    self.containerEl.setAttribute("data-type", self.getViewType());
    return self;
  }
  inherit(View, H.Component);

  View.prototype.getViewType = function () { return undefined; };
  View.prototype.getIcon = function () { return this.icon || "lucide-file"; };
  View.prototype.getState = function () { return {}; };
  View.prototype.setState = function () {};
  View.prototype.getEphemeralState = function () { return {}; };
  View.prototype.setEphemeralState = function () {};
  View.prototype.load = function () {};
  View.prototype.unload = function () {};
  View.prototype.onOpen = function () {};
  View.prototype.onClose = function () {};
  View.prototype.onResize = function () {};
  View.prototype.onHeaderMenu = function () {};
  View.prototype.onPaneMenu = function () {};
  View.prototype.handleCut = function () {};
  View.prototype.handleCopy = function () {};
  View.prototype.handlePaste = function () {};

  View.prototype.onTabMenu = function (menu) {
    const leaf = this.leaf;
    const ws = this.app.workspace;
    const t = H.t.interface.menu;
    menu.addItem((item) => item
      .setSection("close")
      .setTitle(t.close())
      .setIcon("lucide-x")
      .onClick(() => leaf.detach()));
    const parent = leaf.parent;
    if (!parent || ws.isInSidebar(leaf)) return;
    const kids = parent.children || [];
    const unpinned = kids.filter((c) => !c.pinned);
    const others = unpinned.filter((c) => c !== leaf);
    const idx = kids.indexOf(leaf);
    const after = others.filter((c) => kids.indexOf(c) > idx);
    if (others.length) {
      menu.addItem((item) => item
        .setSection("close")
        .setTitle(t.closeOthers())
        .setIcon("lucide-x")
        .onClick(() => { for (const c of others) c.detach(); }));
    }
    if (after.length) {
      menu.addItem((item) => item
        .setSection("close")
        .setTitle(t.closeAfter())
        .setIcon("lucide-x")
        .onClick(() => { for (const c of after) c.detach(); }));
    }
    if (unpinned.length > 1 || (unpinned.length === 1 && unpinned[0] !== leaf)) {
      menu.addItem((item) => item
        .setSection("close")
        .setTitle(t.closeAll())
        .setIcon("lucide-x")
        .onClick(() => { for (const c of unpinned) c.detach(); }));
    }
  };

  View.prototype.getSideTooltipPlacement = function () {
    const root = this.leaf.getRoot && this.leaf.getRoot();
    const side = root && root.side;
    if (side === "left") return "right";
    if (side === "right") return "left";
    return undefined;
  };

  View.prototype.open = async function (parentEl) {
    parentEl.appendChild(this.containerEl);
    // load() is not awaited (as in the original): views that define their own async load() build their DOM in onOpen
    // and would otherwise fail here before it ran
    const loading = this.load();
    if (loading && typeof loading.catch === "function") loading.catch(() => {});
    await this.onOpen();
  };

  View.prototype.close = async function () {
    if (this.containerEl.parentElement) this.containerEl.parentElement.removeChild(this.containerEl);
    this.unload();
    await this.onClose();
  };

  return View;
}

export function defineItemView(host) {
  const H = host;

  function ItemView(leaf) {
    const self = H.View.call(this, leaf) || this;
    self.canDropAnywhere = false;
    const app = self.app;
    const ws = app.workspace;
    self.headerEl = ng25vDiv("view-header");
    self.contentEl = ng25vDiv("view-content");
    self.containerEl.appendChild(self.headerEl);
    self.containerEl.appendChild(self.contentEl);
    const headerLeft = ng25vDiv("view-header-left");
    self.headerEl.appendChild(headerLeft);
    if (H.Platform.isMobile) {
      const toggle = document.createElement("button");
      toggle.className = "view-action clickable-icon mod-left-split-toggle mod-raised sidebar-toggle-button mod-left";
      H.setTooltip(toggle, H.t.interface.sidebarExpand());
      H.setIcon(toggle, "sidebar-toggle-button-icon");
      toggle.addEventListener("click", () => {
        if (navigator.vibrate) navigator.vibrate(100);
        ws.leftSplit.toggle();
      });
      self.leftSidebarToggleEl = toggle;
      headerLeft.appendChild(toggle);
    } else {
      self.leftSidebarToggleEl = null;
    }
    const navBtns = ng25vDiv("view-header-nav-buttons");
    headerLeft.appendChild(navBtns);
    const navFn = () => self.leaf;
    self.backButtonEl = H.createNavButton(app, navFn, "backward");
    self.forwardButtonEl = H.createNavButton(app, navFn, "forward");
    H.setIcon(self.backButtonEl, "lucide-arrow-left");
    H.setIcon(self.forwardButtonEl, "lucide-arrow-right");
    navBtns.appendChild(self.backButtonEl);
    navBtns.appendChild(self.forwardButtonEl);
    self.titleContainerEl = ng25vDiv("view-header-title-container mod-at-start mod-fade");
    self.titleParentEl = ng25vDiv("view-header-title-parent");
    self.titleEl = ng25vDiv("view-header-title");
    self.titleContainerEl.appendChild(self.titleParentEl);
    self.titleParentEl.appendChild(self.titleEl);
    self.headerEl.appendChild(self.titleContainerEl);
    const updateFade = ng25vDebounce(() => {
      const el = self.titleParentEl;
      const atStart = el.scrollLeft === 0;
      const atEnd = Math.ceil(el.scrollLeft) >= el.scrollWidth - el.offsetWidth;
      self.titleContainerEl.classList.toggle("mod-at-start", atStart);
      self.titleContainerEl.classList.toggle("mod-at-end", atEnd);
    }, 10);
    self.titleParentEl.addEventListener("scroll", updateFade);
    self.actionsEl = ng25vDiv("view-actions" + (H.Platform.isPhone ? " mod-raised" : ""));
    self.headerEl.appendChild(self.actionsEl);
    const openMore = (e) => {
      if (!self.moreOptionsButtonEl.classList.contains("has-active-menu")) self.onMoreOptions(e);
    };
    self.moreOptionsButtonEl = self.addAction("lucide-more-vertical", H.t.interface.menu.moreOptions(), openMore);
    if (H.Platform.isMobile) {
      self.moreOptionsButtonEl.addEventListener("contextmenu", (e) => {
        if (H.Platform.isPhone) {
          e.preventDefault();
          ws.rightSplit.expand();
        }
      });
    }
    if (app.dragManager && app.dragManager.handleDrop) {
      app.dragManager.handleDrop(self.containerEl, self.handleDrop.bind(self));
    }
    return self;
  }
  inherit(ItemView, H.View);
  const proto = ItemView.prototype;

  proto.getDisplayText = function () { return ""; };

  proto.updateNavButtons = function () {
    const hist = this.leaf.history || {};
    this.backButtonEl.ariaDisabled = String((hist.backHistory || []).length === 0);
    this.forwardButtonEl.ariaDisabled = String((hist.forwardHistory || []).length === 0);
  };

  proto.load = function () {
    H.View.prototype.load.call(this);
    ng25vSetText(this.titleEl, this.getDisplayText());
    this.leaf.on("group-change", () => this.onGroupChange());
    this.leaf.on("history-change", () => this.updateNavButtons());
  };

  proto.onGroupChange = function () {};
  proto.onMoreOptionsMenu = function () {};

  proto.handleDrop = function (event, data, isPreview) {
    const mod = H.isMacLike ? event.shiftKey : event.altKey;
    const inHeader = this.headerEl.contains(event.target);
    if (!this.canDropAnywhere && !mod && !inHeader) return undefined;
    const hint = this.leaf.handleDrop(event, data, isPreview);
    if (hint) {
      hint.hoverEl = this.headerEl;
      hint.hoverClass = "is-highlighted";
    }
    return hint;
  };

  proto.addAction = function (icon, title, cb) {
    const btn = document.createElement("button");
    btn.className = "clickable-icon view-action";
    H.setIcon(btn, icon);
    H.setTooltip(btn, title);
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", (e) => {
      if (e.button === 0 || e.button === 1) cb(e);
    });
    this.actionsEl.prepend(btn);
    return btn;
  };

  proto.onMoreOptions = function (event) {
    event.preventDefault();
    const menu = new H.Menu();
    const t = H.t.interface.menu;
    menu.addSections(["close", "pane", "open", "action", "find", "info", "info.copy", "view", "view.linked", "system", "", "danger"]);
    menu.setSectionSubmenu("info.copy", { title: t.copyPath(), icon: "lucide-clipboard" });
    menu.setSectionSubmenu("view.linked", { title: t.openLinkedView(), icon: "lucide-link" });
    this.onPaneMenu(menu, "more-options");
    this.onMoreOptionsMenu(menu);
    this.app.workspace.trigger("leaf-menu", menu, this.leaf);
    const btn = this.moreOptionsButtonEl;
    const rect = btn.getBoundingClientRect();
    menu.setParentElement(btn);
    menu.showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true, left: true });
  };

  proto.onPaneMenu = function (menu, source) {
    H.View.prototype.onPaneMenu.call(this, menu, source);
    const t = H.t.interface.menu;
    const ws = this.app.workspace;
    const leaf = this.leaf;
    if (H.Platform.isPhone && source === "more-options") {
      menu.addItem((item) => item.setSection("close").setTitle(t.close()).setIcon("lucide-x").onClick(() => leaf.detach()));
      menu.addItem((item) => item
        .setSection("pane")
        .setTitle(leaf.pinned ? t.unpin() : t.pin())
        .setIcon(leaf.pinned ? "lucide-pin-off" : "lucide-pin")
        .onClick(() => leaf.togglePinned()));
    }
    if (H.Platform.canSplit && leaf.canPin && leaf.canPin()) {
      const inSidebar = ws.isInSidebar && ws.isInSidebar(leaf);
      menu.addItem((item) => item
        .setSection("pane")
        .setTitle(H.tc.splitRight())
        .setIcon("lucide-separator-vertical")
        .setDisabled(!!inSidebar)
        .onClick(() => ws.duplicateLeaf(leaf, "vertical")));
      menu.addItem((item) => item
        .setSection("pane")
        .setTitle(H.tc.splitDown())
        .setIcon("lucide-separator-horizontal")
        .setDisabled(false)
        .onClick(() => ws.duplicateLeaf(leaf, "horizontal")));
    }
  };

  proto.onTabMenu = function (menu) {
    H.View.prototype.onTabMenu.call(this, menu);
    const t = H.t.interface.menu;
    const ws = this.app.workspace;
    const leaf = this.leaf;
    if (leaf.canPin && leaf.canPin()) {
      menu.addItem((item) => item
        .setSection("pane")
        .setTitle(leaf.pinned ? t.unpin() : t.pin())
        .setIcon("lucide-pin")
        .onClick(() => leaf.togglePinned()));
      if (leaf.group) {
        menu.addItem((item) => item
          .setSection("pane")
          .setTitle(t.unlinkTab())
          .setIcon("lucide-link")
          .onClick(() => leaf.setGroup(null)));
      } else {
        menu.addItem((item) => item
          .setSection("pane")
          .setTitle(t.linkTab())
          .setIcon("lucide-link")
          .onClick(() => ws.onStartLink(leaf)));
      }
    }
    if (H.Platform.canPopoutWindow) {
      menu.addItem((item) => item
        .setSection("pane")
        .setTitle(t.moveToNewWindow())
        .setIcon("lucide-picture-in-picture")
        .onClick(() => ws.moveLeafToPopout(leaf)));
    }
  };

  return ItemView;
}
