// n-g25-view.js — clean-room View / ItemView base classes (spec g25 Part G).

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
  return class View extends H.Component {
    constructor(leaf) {
      super();
      this.icon = "lucide-file";
      this.navigation = false;
      this.app = leaf.app;
      this.leaf = leaf;
      this.containerEl = ng25vDiv("workspace-leaf-content");
      this.containerEl.setAttribute("data-type", this.getViewType());
    }
    getViewType() { return undefined; }
    getIcon() { return this.icon || "lucide-file"; }
    getState() { return {}; }
    setState() {}
    getEphemeralState() { return {}; }
    setEphemeralState() {}
    load() {}
    unload() {}
    onOpen() {}
    onClose() {}
    onResize() {}
    onHeaderMenu() {}
    onPaneMenu() {}
    onTabMenu(menu) {
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
    }
    getSideTooltipPlacement() {
      const root = this.leaf.getRoot && this.leaf.getRoot();
      const side = root && root.side;
      if (side === "left") return "right";
      if (side === "right") return "left";
      return undefined;
    }
    handleCut() {}
    handleCopy() {}
    handlePaste() {}
    async open(parentEl) {
      parentEl.appendChild(this.containerEl);
      await this.load();
      await this.onOpen();
    }
    async close() {
      if (this.containerEl.parentElement) this.containerEl.parentElement.removeChild(this.containerEl);
      this.unload();
      await this.onClose();
    }
  };
}

export function defineItemView(host) {
  const H = host;
  return class ItemView extends H.View {
    constructor(leaf) {
      super(leaf);
      this.canDropAnywhere = false;
      const app = this.app;
      const ws = app.workspace;
      this.headerEl = ng25vDiv("view-header");
      this.contentEl = ng25vDiv("view-content");
      this.containerEl.appendChild(this.headerEl);
      this.containerEl.appendChild(this.contentEl);
      const headerLeft = ng25vDiv("view-header-left");
      this.headerEl.appendChild(headerLeft);
      if (H.Platform.isMobile) {
        const toggle = document.createElement("button");
        toggle.className = "view-action clickable-icon mod-left-split-toggle mod-raised sidebar-toggle-button mod-left";
        H.setTooltip(toggle, H.t.interface.sidebarExpand());
        H.setIcon(toggle, "sidebar-toggle-button-icon");
        toggle.addEventListener("click", () => {
          if (navigator.vibrate) navigator.vibrate(100);
          ws.leftSplit.toggle();
        });
        this.leftSidebarToggleEl = toggle;
        headerLeft.appendChild(toggle);
      } else {
        this.leftSidebarToggleEl = null;
      }
      const navBtns = ng25vDiv("view-header-nav-buttons");
      headerLeft.appendChild(navBtns);
      const navFn = () => this.leaf;
      this.backButtonEl = H.createNavButton(app, navFn, "backward");
      this.forwardButtonEl = H.createNavButton(app, navFn, "forward");
      H.setIcon(this.backButtonEl, "lucide-arrow-left");
      H.setIcon(this.forwardButtonEl, "lucide-arrow-right");
      navBtns.appendChild(this.backButtonEl);
      navBtns.appendChild(this.forwardButtonEl);
      this.titleContainerEl = ng25vDiv("view-header-title-container mod-at-start mod-fade");
      this.titleParentEl = ng25vDiv("view-header-title-parent");
      this.titleEl = ng25vDiv("view-header-title");
      this.titleContainerEl.appendChild(this.titleParentEl);
      this.titleParentEl.appendChild(this.titleEl);
      this.headerEl.appendChild(this.titleContainerEl);
      const updateFade = ng25vDebounce(() => {
        const el = this.titleParentEl;
        const atStart = el.scrollLeft === 0;
        const atEnd = Math.ceil(el.scrollLeft) >= el.scrollWidth - el.offsetWidth;
        this.titleContainerEl.classList.toggle("mod-at-start", atStart);
        this.titleContainerEl.classList.toggle("mod-at-end", atEnd);
      }, 10);
      this.titleParentEl.addEventListener("scroll", updateFade);
      this.actionsEl = ng25vDiv("view-actions" + (H.Platform.isPhone ? " mod-raised" : ""));
      this.headerEl.appendChild(this.actionsEl);
      const openMore = (e) => {
        if (!this.moreOptionsButtonEl.classList.contains("has-active-menu")) this.onMoreOptions(e);
      };
      this.moreOptionsButtonEl = this.addAction("lucide-more-vertical", H.t.interface.menu.moreOptions(), openMore);
      if (H.Platform.isMobile) {
        this.moreOptionsButtonEl.addEventListener("contextmenu", (e) => {
          if (H.Platform.isPhone) {
            e.preventDefault();
            ws.rightSplit.expand();
          }
        });
      }
      if (app.dragManager && app.dragManager.handleDrop) {
        app.dragManager.handleDrop(this.containerEl, this.handleDrop.bind(this));
      }
    }
    getDisplayText() { return ""; }
    updateNavButtons() {
      const hist = this.leaf.history || {};
      this.backButtonEl.ariaDisabled = String((hist.backHistory || []).length === 0);
      this.forwardButtonEl.ariaDisabled = String((hist.forwardHistory || []).length === 0);
    }
    load() {
      super.load();
      ng25vSetText(this.titleEl, this.getDisplayText());
      this.leaf.on("group-change", () => this.onGroupChange());
      this.leaf.on("history-change", () => this.updateNavButtons());
    }
    onGroupChange() {}
    onMoreOptionsMenu() {}
    handleDrop(event, data, isPreview) {
      const mod = H.isMacLike ? event.shiftKey : event.altKey;
      const inHeader = this.headerEl.contains(event.target);
      if (!this.canDropAnywhere && !mod && !inHeader) return undefined;
      const hint = this.leaf.handleDrop(event, data, isPreview);
      if (hint) {
        hint.hoverEl = this.headerEl;
        hint.hoverClass = "is-highlighted";
      }
      return hint;
    }
    addAction(icon, title, cb) {
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
    }
    onMoreOptions(event) {
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
    }
    onPaneMenu(menu, source) {
      super.onPaneMenu(menu, source);
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
    }
    onTabMenu(menu) {
      super.onTabMenu(menu);
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
    }
  };
}
