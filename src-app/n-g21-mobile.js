// n-g21-mobile.js — mobile shell: MobileTabItem, TabSwitcher, MobileToolbar,
// ShareIntent, AudioRecorder. Clean-room, spec g21 §3.5.
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";

const ng21M = {}; // lazy per-host slots

function ng21Link(Child, getParent) {
  const link = () => {
    const P = getParent();
    if (typeof P !== "function") return false;
    if (Object.getPrototypeOf(Child) !== P) Object.setPrototypeOf(Child, P);
    if (Object.getPrototypeOf(Child.prototype) !== P.prototype) Object.setPrototypeOf(Child.prototype, P.prototype);
    return true;
  };
  if (!link()) queueMicrotask(link);
}

// =====================================================================================================================
// MobileTabItem ($6)
// =====================================================================================================================

export function ng21DefineS13MobileTabItem(host) {
  if (ng21M.Item) return ng21M.Item;

  function MobileTabItem(leaf, switcher) {
    this.leaf = leaf;
    this.switcher = switcher;
    this.el = host.createDiv("mobile-tab");
    const preview = this.el.createDiv("mobile-tab-preview");
    this.pinEl = preview.createDiv("mobile-tab-pin");
    host.setIcon(this.pinEl, "lucide-pin");
    this.pinEl.addEventListener("click", (e) => { e.stopPropagation(); leaf.setPinned(false); });
    this.closeEl = preview.createDiv("close-button");
    host.setIcon(this.closeEl, "lucide-x");
    this.closeEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.el.parentNode) this.el.detach();
      leaf.detach();
    });
    const img = preview.createEl("img", "mobile-tab-preview-embed");
    img.src = switcher.cacheDir + "leaf-" + leaf.id + ".png?" + Date.now();
    img.addEventListener("error", () => this._showPlaceholder());
    img.addEventListener("load", () => {
      if (leaf.view && host.EmptyView && leaf.view instanceof host.EmptyView) this._showPlaceholder();
    });
    this.imgEl = img;
    this.placeholderEl = preview.createDiv("mobile-tab-preview-empty");
    host.setIcon(this.placeholderEl, leaf.getIcon());
    this.titleEl = this.el.createDiv("mobile-tab-title");
    const syncPin = () => {
      this.pinEl.toggleClass("is-hidden", !leaf.pinned);
      this.closeEl.toggleClass("is-hidden", !!leaf.pinned);
    };
    syncPin();
    leaf.on("pinned-change", syncPin);
    this.el.addEventListener("click", (event) => {
      if (event.defaultPrevented) return;
      leaf.workspace.setActiveLeaf(leaf);
      switcher.hide();
    });
    this.el.addEventListener("contextmenu", (event) => {
      if (event.defaultPrevented) return;
      leaf.onOpenTabHeaderMenu(event, this.el);
    });
    this.render();
  }

  MobileTabItem.prototype._showPlaceholder = function () {
    if (this.imgEl) this.imgEl.addClass("is-hidden");
    if (this.placeholderEl) this.placeholderEl.removeClass("is-hidden");
  };

  MobileTabItem.prototype.render = function () {
    if (this.titleEl) this.titleEl.setText(this.leaf.getDisplayText());
    this.el.removeClass("is-active");
  };

  MobileTabItem.prototype.setActive = function (b) {
    this.el.toggleClass("is-active", !!b);
  };

  ng21M.Item = MobileTabItem;
  return MobileTabItem;
}

// =====================================================================================================================
// TabSwitcher (Z6)
// =====================================================================================================================

export function ng21DefineS13TabSwitcher(host) {
  if (ng21M.Switcher) return ng21M.Switcher;
  const MobileTabItem = ng21M.Item || ng21DefineS13MobileTabItem(host);

  function TabSwitcher(app) {
    this.app = app;
    this.isVisible = false;
    this.cacheDir = "";
    this.tabPreviewLookup = new WeakMap();
    this.lastRenderLeaves = 0;
    this.containerEl = host.createDiv("mobile-tab-switcher");
    this.containerEl.hide();
    const scroll = this.containerEl.createDiv("mobile-tab-switcher-scroll");
    this.scrollEl = scroll;
    this.innerScrollEl = scroll.createDiv("mobile-tab-switcher-inner-scroll");
    this.menuBarEl = this.containerEl.createDiv("mobile-tab-switcher-menubar");
    const left = this.menuBarEl.createDiv("mobile-tab-switcher-menu-spacer");
    const plus = left.createDiv("mobile-tab-switcher-menu-button clickable-icon");
    host.setIcon(plus, "lucide-plus");
    plus.addEventListener("click", () => {
      app.commands.executeCommandById("workspace:new-tab");
      this.hide();
    });
    const center = this.menuBarEl.createDiv("mobile-tab-switcher-menu-button tappable");
    this.tabCountEl = center.createSpan();
    const chev = center.createSpan("mobile-tab-switcher-menu-button-chevron");
    host.setIcon(chev, "lucide-chevron-down");
    const openMenu = (e) => this.showTabManagementMenu(e);
    center.addEventListener("click", openMenu);
    center.addEventListener("contextmenu", openMenu);
    const right = this.menuBarEl.createDiv("mobile-tab-switcher-menu-spacer");
    right.createDiv({ cls: "clickable-icon", text: host.t.dialogue.buttonDone() }, (done) => {
      done.addEventListener("click", () => this.hide());
    });

    this._renderQueued = debounceCall(() => { if (this.isVisible) this.render(); }, 100);
    app.workspace.on("layout-change", () => this._renderQueued());
    this.setupCacheDir();
    return this;
  }
  ng21Link(TabSwitcher, () => host.Component);

  const p = TabSwitcher.prototype;

  p.setupCacheDir = async function () {
    try {
      const bridge = env().capacitor || (window.Capacitor && window.Capacitor.Plugins);
      if (!bridge || !bridge.Filesystem) { this.cacheDir = ""; return; }
      const appId = this.app.appId || "app";
      const uri = await bridge.Filesystem.getUri({ directory: "CACHE", path: appId + "/tab-preview" });
      let src = bridge.convertFileSrc ? bridge.convertFileSrc(uri.uri || uri) : (uri.uri || uri);
      if (!src.endsWith("/")) src += "/";
      this.cacheDir = src;
      if (bridge.addListener) {
        bridge.addListener("screenshotSaved", (payload) => {
          const name = payload && (payload.name || payload.path);
          if (!name) return;
          const sel = 'img.mobile-tab-preview-embed[src*="' + name + '"]';
          for (const img of document.querySelectorAll(sel)) {
            const base = img.src.split("?")[0];
            img.src = base + "?" + Date.now();
          }
        });
      }
    } catch (e) { this.cacheDir = ""; }
  };

  p.requestRender = function () { if (this.isVisible) this._renderQueued(); };

  p._collectLeaves = function () {
    const leaves = [];
    const walk = (node) => {
      if (!node) return;
      if (node.type === "tabs" && node.children) {
        const group = node.children.filter((c) => c instanceof host.WorkspaceLeaf);
        if (group.length) leaves.push({ node, leaves: group });
      }
      for (const c of node.children || []) if (c && c.children) walk(c);
    };
    walk(this.app.workspace.rootSplit);
    return leaves;
  };

  p.render = function () {
    const groups = this._collectLeaves();
    const total = groups.reduce((n, g) => n + g.leaves.length, 0);
    const nouns = host.t.vault || host.t.interface || {};
    const tabsLabel = (nouns.tabsWithCount || (({ count }) => count + " tabs"))({ count: total });
    if (this.tabCountEl) this.tabCountEl.setText(tabsLabel);
    const mostRecent = this.app.workspace.getMostRecentLeaf && this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
    const frag = [];
    for (const group of groups) {
      const gc = host.createDiv("mobile-tab-group-container");
      for (const leaf of group.leaves) {
        let item = this.tabPreviewLookup.get(leaf);
        if (!item) { item = new MobileTabItem(leaf, this); this.tabPreviewLookup.set(leaf, item); }
        const wrap = host.createDiv("mobile-tab-wrapper");
        wrap.appendChild(item.el);
        item.setActive(leaf === mostRecent);
        gc.appendChild(wrap);
      }
      frag.push(gc);
    }
    this.innerScrollEl.setChildrenInPlace(frag);
    this.lastRenderLeaves = total;
    if (mostRecent) {
      const item = this.tabPreviewLookup.get(mostRecent);
      if (item && item.el.scrollIntoView) item.el.scrollIntoView({ block: "nearest" });
    }
  };

  p._captureScreenshot = async function () {
    if (!host.Platform.isMobileApp) return;
    try {
      const leaf = this.app.workspace.getMostRecentLeaf && this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit);
      if (!leaf || !leaf.view) return;
      const view = leaf.view;
      let target = leaf.containerEl;
      if (view instanceof host.ItemView && view.contentEl && view.contentEl.isShown && view.contentEl.isShown()) target = view.contentEl;
      if (!target || !target.win || !target.win.html2canvas && !target.ownerDocument) return;
      const docEl = target.win ? target.win.document.documentElement : document.documentElement;
      const rect = target.getBoundingClientRect();
      const rounded = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
      docEl.classList.add("is-screenshotting");
      await new Promise((r) => setTimeout(r, 16));
      setTimeout(() => docEl.classList.remove("is-screenshotting"), 100);
      const shot = await target.win.html2canvas(target, { ...rounded });
      const appId = this.app.appId || "app";
      const path = appId + "/tab-preview/leaf-" + leaf.id + ".png";
      const bridge = env().capacitor;
      if (bridge && bridge.Filesystem) {
        const dataUrl = shot.toDataURL ? shot.toDataURL("image/png") : shot;
        await bridge.Filesystem.writeFile({ path, data: dataUrl, directory: "CACHE", recursive: true });
      }
    } catch (e) { console.warn("tab preview screenshot failed", e); }
  };

  p.show = async function () {
    if (this.isVisible) return;
    this.isVisible = true;
    if (typeof host.s13OverlayPush === "function") host.s13OverlayPush(this);
    else if (this.app.dom && this.app.dom.appContainerEl) this.app.dom.appContainerEl.appendChild(this.containerEl);
    await this._captureScreenshot();
    this.render();
    const body = this.containerEl.win ? this.containerEl.win.document.body : document.body;
    if (this.containerEl.parentNode !== body) body.appendChild(this.containerEl);
    this.containerEl.show();
    const active = this.tabPreviewLookup && this._lastActiveItem;
    this.containerEl.style.transition = "opacity 90ms var(--anim-motion-swing, ease), transform 90ms var(--anim-motion-swing, ease)";
    this.containerEl.style.opacity = "0";
    this.containerEl.style.transform = "scale(1.1)";
    requestAnimationFrame(() => {
      this.containerEl.style.opacity = "1";
      this.containerEl.style.transform = "scale(1)";
    });
  };

  p.hide = function () {
    if (!this.isVisible) { this.containerEl.hide(); return; }
    this.isVisible = false;
    if (typeof host.s13OverlayPop === "function") host.s13OverlayPop(this);
    const ease = typeof host.s13EaseStandard === "string" ? host.s13EaseStandard : "ease";
    this.containerEl.style.transition = "opacity 90ms " + ease + ", transform 90ms " + ease;
    this.containerEl.style.opacity = "0";
    this.containerEl.style.transform = "scale(1.1)";
    setTimeout(() => {
      this.containerEl.hide();
      if (this.containerEl.parentNode) this.containerEl.detach();
      this.containerEl.style.transition = "";
      this.containerEl.style.opacity = "";
      this.containerEl.style.transform = "";
    }, 100);
  };

  p.close = function () { this.hide(); };

  p.showTabManagementMenu = function (event) {
    const menu = host.Menu.forEvent(event);
    const ws = this.app.workspace;
    menu.addItem((item) => item.setSection("open").setIcon("lucide-plus")
      .setTitle(host.t.commands.newTab ? host.t.commands.newTab() : "New tab")
      .onClick(() => ws.app.commands.executeCommandById("workspace:new-tab")));
    menu.addItem((item) => item.setSection("open").setIcon("lucide-undo-2")
      .setTitle(host.t.commands.undoCloseTab ? host.t.commands.undoCloseTab() : "Undo close tab")
      .setDisabled(!ws.hasUndoHistory || !ws.hasUndoHistory())
      .onClick(() => ws.app.commands.executeCommandById("workspace:undo-close-pane")));
    const leaf = ws.getMostRecentLeaf && ws.getMostRecentLeaf(ws.rootSplit);
    const siblings = leaf && leaf.parent ? leaf.parent.children.length : 0;
    if (siblings > 1) {
      menu.addItem((item) => item.setSection("danger").setIcon("lucide-archive-x")
        .setWarning(true)
        .setTitle(host.t.interface.closeTabs ? host.t.interface.closeTabs({ count: siblings - 1 }) : "Close tabs (" + (siblings - 1) + ")")
        .setDisabled(!leaf)
        .onClick(() => {
          for (const c of leaf.parent.children.slice()) {
            if (c !== leaf) c.detach();
          }
        }));
    }
    if (!this.isVisible) {
      menu.addItem((item) => item.setSection("danger").setIcon("lucide-x")
        .setWarning(true)
        .setTitle(host.t.commands.closeTab ? host.t.commands.closeTab() : "Close")
        .onClick(() => leaf && leaf.detach()));
    }
    return menu;
  };

  p.onLayoutChange = function () { this._renderQueued(); };

  ng21M.Switcher = TabSwitcher;
  return TabSwitcher;
}

// =====================================================================================================================
// MobileToolbar (J6)
// =====================================================================================================================

export function ng21DefineS13MobileToolbar(host) {
  if (ng21M.Toolbar) return ng21M.Toolbar;

  function MobileToolbar(app) {
    this.app = app;
    this.isVisible = false;
    this.lastKeyboardHeight = 0;
    this.hasKeyboardVisible = false;
    this.isMultiWindowMode = false;
    this.lastCommandIds = null;
    this.spacerEl = host.createDiv("mobile-toolbar-spacer");
    this.wrapperEl = host.createDiv("mobile-toolbar");
    const container = this.wrapperEl.createDiv("mobile-toolbar-options-container");
    const listWrap = container.createDiv("mobile-toolbar-options-list-container mod-raised");
    this.optionsListEl = listWrap.createDiv("mobile-toolbar-options-list");
    this.optionsContainerListEl = listWrap;
    this.containerEl = this.wrapperEl;
    if (host.Platform.isIosApp && host.Platform.isMobile) {
      const floating = this.wrapperEl.createDiv("mobile-toolbar-floating-options mod-raised");
      const kb = floating.createDiv("clickable-icon");
      host.setIcon(kb, "keyboard-toggle");
      kb.addEventListener("click", () => app.commands.executeCommandById("editor:toggle-keyboard"));
    }
    this.update = debounceCall(() => this._update(), 0);
    const w = window;
    w.addEventListener("keyboardWillHide", () => { this.hasKeyboardVisible = false; this.animateToKeyboardHeight(); });
    w.addEventListener("keyboardWillShow", () => { this.hasKeyboardVisible = true; this.animateToKeyboardHeight(); if (host.Platform.isAndroid) this.update(); });
    w.addEventListener("focusout", () => this.update());
    w.addEventListener("focusin", () => this.update());
    if (host.Platform.isAndroid) {
      w.addEventListener("multiWindowModeChanged", (e) => { this.isMultiWindowMode = !!(e && e.detail); this.update(); });
      if (w.electron && w.electron.ipcRenderer && w.electron.ipcRenderer.invoke) {
        w.electron.ipcRenderer.invoke("isMultiWindowMode").then((v) => { this.isMultiWindowMode = !!v; this.update(); }).catch(() => {});
      }
    }
    return this;
  }
  ng21Link(MobileToolbar, () => host.Component);
  const p = MobileToolbar.prototype;

  p._commands = function () {
    try { return this.app.vault.getConfig("mobileToolbarCommands") || []; } catch (e) { return []; }
  };

  p.compileToolbar = function () {
    const ids = this._commands();
    if (JSON.stringify(ids) === JSON.stringify(this.lastCommandIds)) return;
    this.lastCommandIds = ids.slice();
    const frag = [];
    for (const id of ids) {
      const cmd = this.app.commands.commands && this.app.commands.commands[id];
      if (!cmd) continue;
      const opt = host.createDiv("mobile-toolbar-option clickable-icon");
      host.setIcon(opt, cmd.icon || "question-mark-glyph");
      if (cmd.name) host.setTooltip(opt, typeof cmd.name === "function" ? cmd.name() : cmd.name, { delay: host.TOOLTIP_DELAY });
      opt.addEventListener("mousedown", (e) => e.preventDefault());
      opt.addEventListener("click", (e) => {
        e.preventDefault();
        this.app.commands.executeCommandById(id, e);
      });
      frag.push(opt);
    }
    this.optionsListEl.setChildrenInPlace(frag);
  };

  p._update = function () {
    this.lastKeyboardHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--keyboard-height")) || 0;
    const editor = this.app.workspace.activeEditor;
    let editing = !!(editor && editor.editor && editor.editor.hasFocus && editor.editor.hasFocus());
    if (editing && host.Platform.isAndroid && !(this.hasKeyboardVisible || this.isMultiWindowMode)) editing = false;
    if (editing && !this.isVisible) this.show();
    else if (!editing && this.isVisible) this.hide();
  };

  p.animateToKeyboardHeight = function () {
    if (!this.isVisible) return;
    const delta = this.lastKeyboardHeight;
    const ios = host.Platform.isIosApp;
    this.wrapperEl.style.transition = "transform " + (ios ? 300 : 350) + "ms " + (ios ? "cubic-bezier(.12,0,.44,.99)" : "cubic-bezier(.22,.25,0,1)");
    this.wrapperEl.style.transform = "translateY(" + (-delta) + "px)";
  };

  p.show = function () {
    if (this._commands().length === 0) { this.hide(); return; }
    if (this.app.mobileNavbar && this.app.mobileNavbar.containerEl) this.app.mobileNavbar.containerEl.hide();
    this.isVisible = true;
    this.compileToolbar();
    const parent = this.app.dom && this.app.dom.appContainerEl;
    if (parent) {
      if (this.spacerEl.parentNode !== parent) parent.appendChild(this.spacerEl);
      if (this.wrapperEl.parentNode !== parent) parent.appendChild(this.wrapperEl);
    }
    document.body.addClass("mod-toolbar-open");
  };

  p.hide = function () {
    if (!this.isVisible && !this.wrapperEl.parentNode) return;
    this.isVisible = false;
    if (this.spacerEl.parentNode) this.spacerEl.detach();
    if (this.wrapperEl.parentNode) this.wrapperEl.detach();
    if (this.app.mobileNavbar && this.app.mobileNavbar.containerEl) this.app.mobileNavbar.containerEl.show();
    document.body.removeClass("mod-toolbar-open");
  };

  ng21M.Toolbar = MobileToolbar;
  return MobileToolbar;
}
