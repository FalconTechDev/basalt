// n-g21-chrome.js — window chrome: frameless Titlebar, VaultProfile switcher row and the
// MobileDrawer family (left/right mobile side panels). Clean-room, spec g21 §3.4.
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { s05TitlebarDoubleClick } from "./s05-utils.js";

const ng21CH = {};

function ng21ChromeLink(Child, getParent) {
  const link = () => {
    const P = getParent();
    if (typeof P !== "function") return false;
    if (Object.getPrototypeOf(Child) !== P) Object.setPrototypeOf(Child, P);
    if (Object.getPrototypeOf(Child.prototype) !== P.prototype) Object.setPrototypeOf(Child.prototype, P.prototype);
    return true;
  };
  if (!link()) queueMicrotask(link);
}

function ng21Svg(inner) {
  const span = document.createElement("span");
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  return span.firstChild;
}

const NG21_SVG = {
  minimize: '<path d="M5 12h14"/>',
  maximize: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  restore: '<rect x="9" y="9" width="11" height="11" rx="1"/><path d="M5 15V5h10"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

// =====================================================================================================================
// Titlebar (manifest class BD)
// =====================================================================================================================

export function ng21DefineTitlebar(host) {
  function Titlebar(eWin, win) {
    this.eWin = eWin;
    this.win = win;
    this.isMac = window.process && window.process.platform === "darwin";
    win.document.body.addClass("is-frameless");

    const doc = win.document;
    this.barEl = doc.createElement("div");
    this.barEl.className = "titlebar";
    this.titleBarEl = this.barEl;
    this.innerEl = doc.createElement("div");
    this.innerEl.className = "titlebar-inner";
    this.textEl = doc.createElement("div");
    this.textEl.className = "titlebar-text";
    this.textEl.textContent = "Basalt";
    const left = doc.createElement("div");
    left.className = "titlebar-button-container mod-left";
    const right = doc.createElement("div");
    right.className = "titlebar-button-container mod-right";
    this.leftButtonContainerEl = left;
    this.rightButtonContainerEl = right;
    this.innerEl.append(this.textEl, left, right);
    this.barEl.appendChild(this.innerEl);
    doc.body.prepend(this.barEl);

    this.requestUpdateStatus = debounceCall(() => this.updateStatus(), 50);
    win.addEventListener("resize", () => this.requestUpdateStatus());

    this._titleObserver = null;
    let titleEl = doc.head.querySelector("title");
    if (!titleEl) { titleEl = doc.createElement("title"); doc.head.appendChild(titleEl); }
    this._titleObserver = new MutationObserver(() => this.updateTitle());
    this._titleObserver.observe(titleEl, { subtree: true, characterData: true, childList: true });

    if (!this.isMac) {
      if (eWin.minimizable) {
        const btn = this._addButton("mod-minimize", NG21_SVG.minimize, () => eWin.minimize());
        queueMicrotask(() => host.setTooltip(btn, host.t.interface.window.minimize(), { delay: host.TOOLTIP_DELAY }));
      }
      if (eWin.maximizable) {
        this._maxBtn = this._addButton("mod-maximize", NG21_SVG.maximize, () => {
          if (eWin.isMaximized()) eWin.unmaximize(); else eWin.maximize();
          this._syncMaxButton();
        });
        win.addEventListener("resize", () => { if (!win.closed) this._syncMaxButton(); });
        this._syncMaxButton();
      }
      if (eWin.closable) {
        const btn = this._addButton("mod-close", NG21_SVG.close, () => eWin.close());
        queueMicrotask(() => host.setTooltip(btn, host.t.interface.window.closeWindow(), { delay: host.TOOLTIP_DELAY }));
      }
    }
    s05TitlebarDoubleClick(this.innerEl);
    this.updateStatus();
    this.updateTitle();
    return this;
  }

  Titlebar.prototype._addButton = function (cls, svg, onClick) {
    const btn = this.win.document.createElement("button");
    btn.className = "titlebar-button " + cls;
    btn.appendChild(ng21Svg(svg));
    btn.addEventListener("click", onClick);
    this.innerEl.querySelector(".titlebar-button-container.mod-right").appendChild(btn);
    return btn;
  };

  Titlebar.prototype._syncMaxButton = function () {
    if (!this._maxBtn || this.win.closed) return;
    const max = !this.eWin.isMaximized();
    this._maxBtn.innerHTML = "";
    this._maxBtn.appendChild(ng21Svg(max ? NG21_SVG.maximize : NG21_SVG.restore));
    host.setTooltip(this._maxBtn, host.t.interface.window[max ? "maximize" : "restoreDown"](), { delay: host.TOOLTIP_DELAY });
  };

  Titlebar.prototype.updateTitle = function () {
    this.textEl.textContent = this.win.document.title || "";
  };

  Titlebar.prototype.updateStatus = function () {
    if (this.win.closed) return;
    const body = this.win.document.body;
    let zoom = 1;
    try { zoom = this.eWin.webContents.getZoomFactor(); } catch (e) { /* no webContents */ }
    body.toggleClass("is-fullscreen", !!this.eWin.isFullScreen());
    body.toggleClass("is-maximized", !!this.eWin.isMaximized());
    body.style.setProperty("--zoom-factor", String(zoom));
    if (this.isMac && this.win.titlebarStyle === "hidden") {
      const cs = getComputedStyle(body);
      const ox = parseFloat(cs.getPropertyValue("--traffic-lights-offset-x")) || 40;
      const oy = parseFloat(cs.getPropertyValue("--traffic-lights-offset-y")) || 40;
      const place = (v) => { const r = Math.floor((v * zoom) / 2 - 8); return r < -5 ? 0 : r; };
      const x = place(ox) + 2;
      const y = place(oy === 0 ? 40 : oy);
      if (this.eWin.setWindowButtonPosition) this.eWin.setWindowButtonPosition({ x, y });
      else if (this.eWin.setTrafficLightPosition) this.eWin.setTrafficLightPosition({ x, y });
    }
  };

  ng21CH.Titlebar = Titlebar;
  return Titlebar;
}

// =====================================================================================================================
// VaultProfile (manifest declarator DD -> s05VaultProfile factory)
// =====================================================================================================================

export function ng21VaultProfile(host) {
  function VaultProfile(app, containerEl) {
    if (!host.Platform.isDesktopApp) return;
    this.app = app;
    const vault = app.vault;
    const name = vault.getName();
    const adapter = vault.adapter;
    const fsAdapter = (typeof env === "function" && env().Eu) ? adapter instanceof env().Eu : !!(adapter && adapter.getBasePath);
    let basePath = "";
    try { if (fsAdapter) basePath = adapter.getBasePath(); } catch (e) { basePath = ""; }
    let nodePath = null;
    try { nodePath = window.require && window.require("path"); } catch (e) { nodePath = null; }

    this.el = containerEl.createDiv("workspace-sidedock-vault-profile");
    const row = this.el.createDiv("workspace-drawer-vault-switcher");
    const icon = row.createDiv("workspace-drawer-vault-switcher-icon");
    host.setIcon(icon, "lucide-chevrons-up-down");
    const nameEl = row.createDiv("workspace-drawer-vault-name");
    nameEl.setText(name);

    const self = this;
    const nouns = () => {
      const t = host.t;
      const pick = (keys) => { for (const k of keys) { const v = k.split(".").reduce((o, p) => o && o[p], t); if (typeof v === "function") return v; } return null; };
      return {
        file: pick(["interface.fileWithCount", "vault.fileWithCount", "fileWithCount"]) || (({ count }) => count + " files"),
        folder: pick(["interface.folderWithCount", "vault.folderWithCount", "folderWithCount"]) || (({ count }) => count + " folders"),
      };
    };

    row.addEventListener("mouseover", () => {
      try {
        const root = vault.getRoot();
        const n = nouns();
        const text = basePath + "\n\n" + n.file({ count: root.getFileCount() }) + ", " + n.folder({ count: root.getFolderCount() });
        host.displayTooltip(row, text, { placement: "top", gap: 24, horizontalParent: row, delay: host.TOOLTIP_DELAY });
      } catch (e) { /* tooltip is best-effort */ }
    });
    row.addEventListener("mouseleave", () => host.hideTooltip());

    row.addEventListener("click", (event) => {
      if (row.hasClass("has-active-menu")) return;
      const electron = window.electron;
      if (!electron || !electron.ipcRenderer) return;
      const ipc = electron.ipcRenderer;
      let currentPath = "";
      try { currentPath = (ipc.sendSync("vault") || {}).path || ""; } catch (e) { /* no vault info */ }
      let registry = {};
      try { registry = ipc.sendSync("vault-list") || {}; } catch (e) { registry = {}; }
      const menu = host.Menu.forEvent(event);
      for (const key of Object.keys(registry)) {
        const entry = registry[key];
        const title = nodePath ? nodePath.basename(entry.path) : String(entry.path).split(/[\\/]/).pop();
        const isCurrent = entry.path === currentPath;
        menu.addItem((item) => item
          .setTitle(title)
          .setChecked(isCurrent)
          .onClick(() => {
            if (isCurrent) return;
            const ok = ipc.sendSync("vault-open", entry.path, false);
            if (ok !== true) new host.Notice(host.t.interface.startScreen.msgErrorFailedToOpenVault());
          }));
      }
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle(host.t.interface.manageVaults ? host.t.interface.manageVaults() : "Manage vaults")
        .setIcon("open-vault")
        .onClick(() => app.openVaultChooser()));
      menu.setParentElement(row);
    });

    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const menu = host.Menu.forEvent(event);
      menu.addItem((item) => item
        .setSection("title")
        .setTitle(name)
        .setIsLabel());
      menu.addItem((item) => item
        .setSection("open")
        .setTitle(host.Platform.isMacOS
          ? (host.t.plugins && host.t.plugins.openWithDefaultApp ? host.t.plugins.openWithDefaultApp.actionShowInFolderMac() : "Show in Finder")
          : "Show in folder")
        .setIcon("lucide-arrow-up-right")
        .onClick(() => app.showInFolder("")));
      menu.addItem((item) => item
        .setSection("action")
        .setTitle(host.t.interface.menu.copyPath ? host.t.interface.menu.copyPath() : "Copy path")
        .setIcon("lucide-clipboard")
        .onClick(() => {
          try { navigator.clipboard.writeText(basePath); } catch (e) { /* clipboard unavailable */ }
          new host.Notice(host.t.interface.copied({ context: "generic" }));
        }));
      menu.setParentElement(row);
    });

    const actions = this.el.createDiv("workspace-drawer-vault-actions");
    const help = actions.createDiv("clickable-icon");
    host.setIcon(help, "help");
    help.addEventListener("click", () => app.openHelp());
    const settings = actions.createDiv("clickable-icon");
    host.setIcon(settings, "lucide-settings");
    settings.addEventListener("click", () => app.setting.open());
    return this;
  }

  ng21CH.VaultProfile = VaultProfile;
  return VaultProfile;
}


// =====================================================================================================================
// MobileDrawer (manifest class WD) + FilesDrawer (_D) + InfoDrawer (GD)
// =====================================================================================================================

const ng21MD = {}; // per-host lazy slot

export function ng21DefineMobileDrawer(host) {
  if (ng21MD.C) return ng21MD.C;
  ng21MD.C = ng21MakeMobileDrawer(host);
  return ng21MD.C;
}
export function ng21DefineFilesDrawer(host) {
  if (ng21MD.F) return ng21MD.F;
  ng21MD.F = ng21MakeFilesDrawer(host);
  return ng21MD.F;
}
export function ng21DefineInfoDrawer(host) {
  if (ng21MD.I) return ng21MD.I;
  ng21MD.I = ng21MakeInfoDrawer(host);
  return ng21MD.I;
}

function ng21MakeMobileDrawer(host) {
  function MobileDrawer(workspace, side, id) {
    host.WorkspaceParent.call(this, workspace, id);
    this.children = [];
    this.parent = null;
    this.side = side === "right" ? "right" : "left";
    this.type = "mobile-drawer";
    this.allowSingleChild = true;
    this.autoManageDOM = false;
    this.currentTab = 0;
    this.isPinned = false;
    this.tabOptionsCollapsed = true;
    this.collapsed = true;
    this.tabHeaderEls = [];

    const doc = workspace.app.workspace.containerEl.win.document;
    this.containerEl = doc.createElement("div");
    this.containerEl.className = "workspace-drawer";
    this.containerEl.hide();
    this.innerEl = this.containerEl.createDiv("workspace-drawer-inner");
    this.backdropEl = this.innerEl.createDiv("workspace-drawer-backdrop");
    this.backdropEl.style.opacity = "0";
    this.backdropEl.addEventListener("click", () => this.collapse());
    this.headerEl = this.innerEl.createDiv("workspace-drawer-header");
    this.tabContainerEl = this.innerEl.createDiv("workspace-drawer-tab-container");
    const activeBox = this.tabContainerEl.createDiv("workspace-drawer-active-tab-container");
    this.tabOptionsEl = activeBox.createDiv("workspace-drawer-tab-options");
    const activeHeader = this.tabOptionsEl.createDiv("workspace-tab-header workspace-drawer-tab-select");
    activeHeader.setAttribute("data-ignore-swipe", "");
    const headerInner = activeHeader.createDiv("workspace-tab-header-inner");
    this.activeTabHeaderIconEl = headerInner.createSpan("workspace-tab-header-inner-icon");
    this.activeTabHeaderTitleEl = headerInner.createSpan("workspace-tab-header-inner-title");
    const chevron = headerInner.createDiv("workspace-tab-header-inner-chevron");
    host.setIcon(chevron, "lucide-chevrons-up-down");
    this.activeTabHeaderEl = activeHeader;
    this.activeTabEl = activeHeader;
    this.tabsListEl = this.tabOptionsEl.createDiv("workspace-drawer-tab-options-list");
    this.activeTabContentEl = activeBox.createDiv("workspace-drawer-active-tab-content");
    this.tabsContainerEl = this.tabsListEl;
    this.containerEl.toggleClass("is-collapsed", true);
    this.containerEl.toggleClass("mod-" + this.side, true);

    activeHeader.addEventListener("click", () => this.setTabOptionsCollapsed(!this.tabOptionsCollapsed));
    activeHeader.addEventListener("contextmenu", (event) => {
      const leaf = this.children[this.currentTab];
      if (leaf && leaf.onOpenTabHeaderMenu) leaf.onOpenTabHeaderMenu(event);
    });
    this.tabsListEl.addEventListener("click", (event) => {
      const header = event.target.closest(".workspace-tab-header");
      if (!header) return;
      const index = this.tabHeaderEls.indexOf(header);
      if (index < 0) return;
      this.selectTabIndex(index);
      const leaf = this.children[index];
      if (!host.Platform.isPhone && !this.isPinned && leaf && leaf.containerEl) leaf.containerEl.focus();
      this.setTabOptionsCollapsed(true);
    });

    this.setupSwipe();
    workspace.on("resize", () => { if (host.Platform.isPhone) this.setPinned(false); });
    this.recomputeChildrenDimensions();
    return this;
  }
  inherit(MobileDrawer, host.WorkspaceParent);
  const p = MobileDrawer.prototype;

  p.getRoot = function () { return this; };

  // --- chrome -----------------------------------------------------------------

  p._buildChrome = function () {
    // side-specific header content is added by subclasses via onBuildChrome()
    if (typeof this.onBuildChrome === "function") this.onBuildChrome();
  };

  p._reorderInner = function () {
    const order = this.side === "left"
      ? [this.ribbonEl, this.headerEl, this.tabContainerEl]
      : [this.headerEl, this.tabContainerEl];
    for (const el of order) if (el && el.parentNode === this.innerEl) this.innerEl.appendChild(el);
  };

  p.addHeaderButton = function (icon, onclick, cls) {
    const btn = this.headerEl.createDiv("clickable-icon workspace-drawer-header-icon mod-raised" + (cls ? " " + cls : ""));
    host.setIcon(btn, icon);
    btn.addEventListener("click", onclick);
    return btn;
  };

  // --- tabs -------------------------------------------------------------------

  p.selectTabIndex = function (i) {
    if (i === this.currentTab) return;
    this.currentTab = i;
    this.recomputeChildrenDimensions();
    this.workspace.requestSaveLayout();
    this.workspace.requestResize();
  };

  p.selectTab = function (leaf) { this.selectTabIndex(this.children.indexOf(leaf)); };

  p.openLeaf = function (leaf) {
    this.workspace.setActiveLeaf(leaf);
    this.expand();
  };

  p.setTabOptionsCollapsed = function (b) {
    this.tabOptionsCollapsed = !!b;
    this.tabOptionsEl.toggleClass("is-collapsed", this.tabOptionsCollapsed);
    this.tabsContainerEl.toggleClass("is-collapsed", this.tabOptionsCollapsed);
    this.containerEl.toggleClass("mod-tab-options-collapsed", this.tabOptionsCollapsed);
  };

  p.updateCurrentTab = function () { this.recomputeChildrenDimensions(); };

  p.recomputeChildrenDimensions = function () {
    const children = this.children;
    if (this.currentTab >= children.length) this.currentTab = Math.max(0, children.length - 1);
    if (this.currentTab < 0) this.currentTab = 0;
    const leaf = children[this.currentTab];
    this.activeTabContentEl.setChildrenInPlace(leaf ? [leaf.containerEl] : []);
    if (leaf) {
      host.setIcon(this.activeTabHeaderIconEl, leaf.getIcon());
      this.activeTabHeaderTitleEl.setText(leaf.getDisplayText());
    } else {
      host.setIcon(this.activeTabHeaderIconEl, "lucide-square-dashed");
      this.activeTabHeaderTitleEl.setText(host.t.interface.emptyState.empty());
    }
    const headers = [];
    for (let i = 0; i < children.length; i++) {
      const h = children[i].tabHeaderEl;
      if (h) {
        h.toggleClass("is-active", i === this.currentTab);
        h.draggable = false;
        headers.push(h);
      }
    }
    this.tabHeaderEls = headers;
    this.tabsListEl.setChildrenInPlace(headers);
    this.containerEl.toggleClass("is-collapsed", this.collapsed);
    this._reorderInner();
  };

  p.insertChild = function (index, child) {
    const r = host.WorkspaceParent.prototype.insertChild.call(this, index, child);
    if (child instanceof host.WorkspaceLeaf && child.tabHeaderEl) child.tabHeaderEl.style.width = "";
    this.recomputeChildrenDimensions();
    return r;
  };

  p.removeChild = function (child) {
    const index = this.children.indexOf(child);
    const wasCurrent = index === this.currentTab;
    let prevLeaf = null;
    for (let i = index - 1; i >= 0 && !prevLeaf; i--) prevLeaf = this.children[i] instanceof host.WorkspaceLeaf ? this.children[i] : null;
    const r = host.WorkspaceParent.prototype.removeChild.call(this, child);
    if (wasCurrent) {
      this.currentTab = Math.min(Math.max(0, index), this.children.length - 1);
    } else {
      const idx = prevLeaf ? this.children.indexOf(prevLeaf) : -1;
      if (idx >= 0) this.currentTab = idx;
    }
    this.workspace.onLayoutChange();
    this.recomputeChildrenDimensions();
    return r;
  }

  // --- open / close --------------------------------------------------------------

  p.expand = function () {
    if (!this.collapsed) return;
    this.collapsed = false;
    this.onExpand();
    this._clearSelection();
    const nav = this.app.mobileNavbar;
    const navEl = nav.containerEl;
    if (nav.restoreNavigation) nav.restoreNavigation();
    this._animateIn(navEl);
    this.recomputeChildrenDimensions();
  };

  p.collapse = function () {
    if (this.isPinned || this.collapsed) return;
    this.collapsed = true;
    this.onCollapse();
    this._animateOut();
    this.recomputeChildrenDimensions();
  };

  p.toggle = function () { if (this.collapsed) this.expand(); else this.collapse(); };

  p.onExpand = function () {
    this.workspace.containerEl.addClass("is-" + this.side + "-sidedock-open");
  };

  p.onCollapse = function () {
    this.workspace.containerEl.removeClass("is-" + this.side + "-sidedock-open");
    const leaf = this.children[this.currentTab];
    if (leaf && leaf.getRoot && leaf.getRoot() === this) {
      const most = this.workspace.getMostRecentLeaf(this.workspace.rootSplit);
      if (most) this.workspace.setActiveLeaf(most);
    }
  };

  p._clearSelection = function () {
    const doc = this.containerEl.win ? this.containerEl.win.document : document;
    const sel = doc.getSelection && doc.getSelection();
    if (sel) sel.removeAllRanges();
  };

  p._animateIn = function (navEl) {
    const ws = this.workspace.containerEl;
    ws.appendChild(this.backdropEl);
    ws.appendChild(this.containerEl);
    this.containerEl.show();
    const nav = this.app.mobileNavbar;
    const dur = (env().UD || 250);
    this.backdropEl.style.transition = "opacity " + dur + "ms ease-out";
    this.backdropEl.style.opacity = "1";
    const w = this.containerEl.clientWidth || 300;
    const dir = this.side === "left" ? -1 : 1;
    this.containerEl.style.transition = "transform " + dur + "ms ease-out";
    this.containerEl.style.transform = "translateX(" + dir * w + "px)";
    requestAnimationFrame(() => {
      this.containerEl.style.transform = "translateX(0px)";
      if (navEl) {
        navEl.style.transition = "transform " + dur + "ms ease-out";
        navEl.style.transform = "translateX(" + dir * w + "px)";
      }
    });
  };

  p._animateOut = function () {
    const ws = this.workspace.containerEl;
    const navEl = this.app.mobileNavbar.containerEl;
    const dur = (env().UD || 250);
    const w = this.containerEl.clientWidth || 300;
    const dir = this.side === "left" ? -1 : 1;
    const finish = () => {
      this.containerEl.style.transform = "";
      this.containerEl.style.transition = "";
      this.backdropEl.style.transition = "";
      this.backdropEl.style.opacity = "0";
      this.containerEl.hide();
      if (this.backdropEl.parentNode) this.backdropEl.detach();
      navEl.style.transform = "";
    };
    this.containerEl.style.transition = "transform " + dur + "ms ease-out";
    this.containerEl.style.transform = "translateX(" + dir * w + "px)";
    this.backdropEl.style.transition = "opacity " + dur + "ms ease-out";
    this.backdropEl.style.opacity = "0";
    navEl.style.transition = "transform " + dur + "ms ease-out";
    navEl.style.transform = "";
    setTimeout(finish, dur + 30);
  };

  p.setPinned = function (b) {
    if (host.Platform.canPinDrawer === false) b = false;
    if (this.isPinned === !!b) return;
    this.isPinned = !!b;
    this.containerEl.toggleClass("is-pinned", this.isPinned);
    if (this.isPinned) {
      this.backdropEl.style.display = "none";
      this.expand();
    } else {
      this.backdropEl.style.display = "";
      this.collapse();
    }
    if (this.app.mobileNavbar) this.workspace.requestUpdateLayout();
  };

  p.togglePinned = function () { this.setPinned(!this.isPinned); };

  p.fixIosEvent = function () {
    if (!host.Platform.isIosApp) return;
    const el = this.containerEl;
    el.hide(); el.show(); el.hide(); el.show();
  };

  p.setupSwipe = function () {
    const ws = this.workspace;
    const self = this;
    const onSwipe = (event) => {
      const d = event && event.detail ? event.detail : event;
      if (!d || self.isPinned) return;
      if (d.touches > 1 || (d.direction && d.direction !== "x")) return;
      if (!ws.containerEl.isShown()) return;
      if (host.Platform.isPhone) {
        const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-area-inset-bottom")) || 0;
        if (d.startY != null && d.startY > window.innerHeight - inset - 8) return;
      }
      const isLeft = self.side === "left";
      const dx = d.deltaX || 0;
      const vy = d.velocityX || 0;
      const width = self.containerEl.clientWidth || 300;
      const slide = ws.rootSplit && ws.rootSplit.containerEl;
      const navbar = self.app.mobileNavbar;

      if (d.phase === "start") {
        const opensDrawer = isLeft ? dx > 0 : dx < 0;
        if (!opensDrawer) return;
        const bothClosed = (!ws.leftSplit || ws.leftSplit.collapsed !== false) && (!ws.rightSplit || ws.rightSplit.collapsed !== false);
        const fromCorrectSide = isLeft ? d.startX < window.innerWidth / 2 : d.startX > window.innerWidth / 2;
        if (!(bothClosed && fromCorrectSide)) return;
        self.collapsed = false;
        self.onExpand();
        self._clearSelection();
        if (navbar && navbar.restoreNavigation) navbar.restoreNavigation();
        self.fixIosEvent();
        ws.containerEl.appendChild(self.containerEl);
        self.containerEl.show();
        ws.containerEl.appendChild(self.backdropEl);
        return;
      }
      if (d.phase === "move") {
        const dir = isLeft ? 1 : -1;
        const progress = Math.max(0, Math.min(1, (dir * dx) / width));
        self.containerEl.style.transform = "translateX(" + (dir * (progress - 1) * width) + "px)";
        self.backdropEl.style.opacity = String(progress);
        const shift = dir * progress * width;
        if (slide) slide.style.transform = "translateX(" + shift + "px)";
        if (navbar && navbar.containerEl) navbar.containerEl.style.transform = "translateX(" + shift + "px)";
        return;
      }
      if (d.phase === "end" || d.phase === "cancel") {
        const dir = isLeft ? 1 : -1;
        const open = d.phase === "end" && ((dir * dx > width / 2) || Math.abs(vy) > width / 400);
        const dur = (env().UD || 250);
        if (open) {
          self.containerEl.style.transition = "transform " + dur + "ms ease-out";
          self.containerEl.style.transform = "translateX(0px)";
          self.backdropEl.style.transition = "opacity " + dur + "ms";
          self.backdropEl.style.opacity = "1";
          self.collapsed = false;
        } else {
          self.collapsed = true;
          self.onCollapse();
          self.containerEl.style.transition = "transform " + dur + "ms ease-out";
          self.containerEl.style.transform = "translateX(" + dir * width + "px)";
          self.backdropEl.style.transition = "opacity " + dur + "ms";
          self.backdropEl.style.opacity = "0";
          setTimeout(() => {
            self.containerEl.style.transform = "";
            self.containerEl.style.transition = "";
            self.backdropEl.style.transition = "";
            self.containerEl.hide();
            if (self.backdropEl.parentNode) self.backdropEl.detach();
            if (slide) slide.style.transform = "";
            if (navbar && navbar.containerEl) navbar.containerEl.style.transform = "";
          }, dur + 20);
        }
      }
    };
    ws.on("swipe", onSwipe);
    this._swipeCleanup = () => ws.off("swipe", onSwipe);
  };

  p.setupTabSelectTouchHandler = function () { /* pointer gestures handled via click delegation */ };

  p.serialize = function () {
    const data = host.WorkspaceParent.prototype.serialize.call(this);
    data.currentTab = this.currentTab;
    if (this.isPinned) data.pinned = true;
    return data;
  };

  MobileDrawer.prototype.onBuildChrome = undefined;

  ng21MD.MobileDrawer = MobileDrawer;
  return MobileDrawer;
}

// --- FilesDrawer -----------------------------------------------------------------

function ng21MakeFilesDrawer(host) {
  const MobileDrawer = ng21MD.MobileDrawer || ng21MakeMobileDrawer(host);
  function FilesDrawer(app) {
    MobileDrawer.call(this, app.workspace, "left");
    this.appRef = app;
    this.updateInfo = debounceCall(() => this._updateInfo(), 100);
    app.vault.on("create", () => this.updateInfo());
    app.vault.on("delete", () => this.updateInfo());
    this._buildChrome();
    this.recomputeChildrenDimensions();
    return this;
  }
  inherit(FilesDrawer, MobileDrawer);
  const p = FilesDrawer.prototype;

  p.onBuildChrome = function () {
    const app = this.appRef;
    this.app = app.workspace;
    const left = this.headerEl.createDiv("workspace-drawer-header-left");
    const nameWrap = left.createDiv("workspace-drawer-header-name");
    const label = nameWrap.createEl("label", "workspace-drawer-header-switcher");
    const nameText = label.createSpan("workspace-drawer-header-name-text");
    nameText.setText(app.vault.getName());
    const chev = label.createSpan("workspace-drawer-header-name-chevron");
    host.setIcon(chev, "lucide-chevron-down");
    this._vaultSelect = label.createEl("select");
    this._infoEl = this.headerEl.createDiv("workspace-drawer-header-info");
    this.addHeaderButton("lucide-pin", () => this.togglePinned(), "mod-pin");
    this.addHeaderButton("lucide-settings", () => app.setting.open(), "mod-settings");
    this._reorderInner();
    this._populateSelect();
    this._updateInfo();
  };

  p._vaultList = function () {
    if (typeof s05MobileVaultList === "function") {
      try { return s05MobileVaultList() || []; } catch (e) { return []; }
    }
    return [];
  };

  p._populateSelect = function () {
    const app = this.appRef;
    const select = this._vaultSelect;
    if (!select) return;
    select.empty();
    const mk = (value, text, selected) => {
      const o = select.createEl("option");
      o.value = value;
      o.textContent = text;
      if (selected) o.selected = true;
      return o;
    };
    mk("manage-vaults", host.t.interface.manageVaults ? host.t.interface.manageVaults() : "Manage vaults", false);
    const saved = localStorage.getItem("mobile-selected-vault");
    for (const entry of this._vaultList()) {
      mk(entry.location, (entry.name || "") + (entry.storageType === "iCloud" ? " (iCloud)" : ""), entry.location === saved);
    }
    mk("manage-vaults-end", host.t.interface.manageVaults ? host.t.interface.manageVaults() : "Manage vaults", false);
    select.onchange = () => {
      const v = select.value;
      if (v === "manage-vaults" || v === "manage-vaults-end") { app.openVaultChooser(); return; }
      if (v) {
        localStorage.setItem("mobile-selected-vault", v);
        window.location.reload();
      }
    };
  };

  p._updateInfo = function () {
    if (!this._infoEl) return;
    try {
      const root = this.appRef.vault.getRoot();
      const t = host.t.interface;
      const file = (t.fileWithCount || (({ count }) => count + " files"))({ count: root.getFileCount() });
      const folder = (t.folderWithCount || (({ count }) => count + " folders"))({ count: root.getFolderCount() });
      this._infoEl.setText(file + ", " + folder);
    } catch (e) { this._infoEl.setText(""); }
  };

  return FilesDrawer;
}

// --- InfoDrawer -------------------------------------------------------------------

function ng21MakeInfoDrawer(host) {
  const MobileDrawer = ng21MD.MobileDrawer || ng21MakeMobileDrawer(host);
  function InfoDrawer(app) {
    MobileDrawer.call(this, app.workspace, "right");
    this.appRef = app;
    this._renderers = [];
    this._buildChrome();
    app.workspace.on("file-open", () => { this._updateName(); this._updateInfo(); });
    app.workspace.on("quick-preview", (file) => {
      const active = app.workspace.getActiveFile && app.workspace.getActiveFile();
      if (file === active) this._updateInfo();
    });
    app.vault.on("rename", (file, oldPath) => {
      const active = app.workspace.getActiveFile && app.workspace.getActiveFile();
      if (active && (oldPath === active.path || (file && file.path === active.path))) this._updateName();
    });
    this._updateName();
    this._updateInfo();
    this.recomputeChildrenDimensions();
    return this;
  }
  inherit(InfoDrawer, MobileDrawer);
  const p = InfoDrawer.prototype;

  p.onBuildChrome = function () {
    this.app = this.appRef.workspace;
    this._nameEl = this.headerEl.createDiv("workspace-drawer-header-name workspace-drawer-header-name-text");
    this._infoWrap = this.headerEl.createDiv("workspace-drawer-header-info");
    this.addHeaderButton("lucide-pin", () => this.togglePinned(), "mod-pin");
    this._reorderInner();
  };

  p._updateName = function () {
    if (!this._nameEl) return;
    const file = this.appRef.workspace.getActiveFile && this.appRef.workspace.getActiveFile();
    this._nameEl.setText(file ? file.getShortName() : host.t.interface.noFile());
  };

  p._updateInfo = function () {
    if (!this._infoWrap) return;
    this._infoWrap.empty();
    this._renderers = [];
    for (const info of this.appRef.mobileFileInfos || []) {
      if (!info || !info.renderCallback) continue;
      const el = this._infoWrap.createDiv("workspace-drawer-header-info-item");
      this._renderers.push({ el, renderer: info.renderCallback });
    }
    for (const r of this._renderers) {
      try { r.renderer(r.el); } catch (e) { /* renderer errors are non-fatal */ }
    }
  };

  return InfoDrawer;
}
