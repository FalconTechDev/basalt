// g37 — mobile bottom navbar (clean-room). Factory: ng37MobileNavbar(host) -> class.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng37El = (tag, cls, parent) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (parent) parent.appendChild(el);
  return el;
};
const ng37SetText = (el, text) => {
  if (typeof el.setText === "function") el.setText(text);
  else el.textContent = text;
};

export function ng37MobileNavbar(host) {
  function Ng37MobileNavbar(app) {
    const self = host && host.Component ? (host.Component.call(this) || this) : this;
    self.app = app;
    self.isVisible = false;
    self._scrollTops = new WeakMap();
    self._subs = [];

    const actions = ng37El("div", "mobile-navbar-actions");
    self.containerEl = ng37El("div", "mobile-navbar mod-raised", null);
    self.containerEl.appendChild(actions);

    const Yl = () => env().Yl || {};
    const Pm = () => env().Pm || null;

    // 1-2: back / forward history buttons
    self.backButtonEl = env().Gg(app, () => app.workspace.activeLeaf, "backward");
    self.forwardButtonEl = env().Gg(app, () => app.workspace.activeLeaf, "forward");
    env().tv(self.backButtonEl, "lucide-chevron-left");
    env().tv(self.forwardButtonEl, "lucide-chevron-right");
    ng37El("div", "mobile-navbar-action mobile-navbar-action-back", actions).appendChild(self.backButtonEl);
    ng37El("div", "mobile-navbar-action mobile-navbar-action-forward", actions).appendChild(self.forwardButtonEl);

    // 3: quick switcher
    const qs = ng37El("span", "mobile-navbar-action mobile-navbar-action-quick-switcher clickable-icon", actions);
    env().tv(qs, "lucide-search");
    qs.addEventListener("click", () => {
      const wrapper = app.internalPlugins && app.internalPlugins.getPluginById
        ? app.internalPlugins.getPluginById("switcher") : null;
      const inst = wrapper && (wrapper.instance || wrapper);
      const fn = inst && (inst.onOpen || (inst.plugin && inst.plugin.onOpen));
      if (typeof fn === "function") fn.call(inst);
    });

    // 4: new tab
    const nt = ng37El("span", "mobile-navbar-action mobile-navbar-action-new-tab clickable-icon", actions);
    env().tv(nt, "lucide-plus");
    nt.addEventListener("click", () => {
      const view = app.workspace.activeLeaf && app.workspace.activeLeaf.view;
      const Empty = env().tD;
      if (view && Empty && view instanceof Empty) return;
      app.commands.executeCommandById("workspace:new-tab");
    });

    // 5: tabs badge
    const tabs = ng37El("div", "mobile-navbar-action mobile-navbar-action-tabs clickable-icon", actions);
    const tabsIcon = ng37El("span", "", tabs);
    env().tv(tabsIcon, "tab-frame");
    self.tabButtonEl = ng37El("div", "mobile-navbar-tabs-number", tabs);
    tabs.addEventListener("click", () => { if (app.mobileTabSwitcher) app.mobileTabSwitcher.show(); });
    tabs.addEventListener("contextmenu", (evt) => {
      if (app.mobileTabSwitcher && app.mobileTabSwitcher.showTabManagementMenu) {
        app.mobileTabSwitcher.showTabManagementMenu(evt);
      }
    });

    // 6: ribbon menu
    const menu = ng37El("span", "mobile-navbar-action mobile-navbar-action-menu has-longpress-menu clickable-icon", actions);
    env().tv(menu, "lucide-menu");
    self.ribbonMenuItemEl = menu;
    self.ribbonMenuFlairEl = ng37El("div", "navbar-action-flair", menu);
    env().tv(self.ribbonMenuFlairEl, "chevrons-up-down");
    self.ribbonMenuFlairEl.style.display = "none";

    self.showRibbonMenuBound = (evt) => self.showRibbonMenu(evt);
    menu.addEventListener("click", self.showRibbonMenuBound);
    self._menuClick = self.showRibbonMenuBound;

    // events
    const on = (emitter, name, fn, ctx) => {
      const ref = emitter.on(name, fn, ctx || self);
      self._subs.push(ref);
      return ref;
    };
    const ws = app.workspace;
    on(ws, "layout-ready", self.updateTabCount);
    on(ws, "layout-change", self.updateTabCount);
    on(ws, "layout-ready", self.updateRibbonMenuItem);
    on(ws, "config-changed", self.onConfigChanged);
    on(ws, "active-leaf-change", self.onLeafChange);
    window.addEventListener("mousedown", self.onWindowMouseDown = () => self.restoreNavigation(true));
    window.addEventListener("keyboardWillShow", self.onKbShow = () => self.hide());
    window.addEventListener("keyboardWillHide", self.onKbHide = () => self.show());

    self.updateTabCount();
    self.updateRibbonMenuItem();
    self.onLeafChange();
    self.show();
    return self;
  }
  if (host && host.Component) inherit(Ng37MobileNavbar, host.Component);

  const proto = Ng37MobileNavbar.prototype;

  proto.show = function () {
    const app = this.app;
    const toolbar = app.mobileToolbar;
    if (this.isVisible || (toolbar && toolbar.isVisible) || (env().Yl || {}).mobileSoftKeyboardVisible) return;
    this.isVisible = true;
    app.dom.appContainerEl.appendChild(this.containerEl);
  };

  proto.hide = function () {
    if (!this.isVisible) return;
    this.isVisible = false;
    if (this.containerEl.detach) this.containerEl.detach();
    else this.containerEl.remove();
  };

  proto.onScroll = function (view, scrollTop) {
    const prev = this._scrollTops.get(view);
    this._scrollTops.set(view, scrollTop);
    const Yl = env().Yl || {};
    if (!Yl.isPhone || Yl.mobileSoftKeyboardVisible) return;
    if (!this.app.vault.getConfig("autoFullScreen")) return;
    if (prev === undefined) return;
    if ((prev < 0.1 && scrollTop < 0.1) || Math.abs(scrollTop - prev) < 0.125) return;
    if (scrollTop > prev) this.hideNavigation();
    else this.restoreNavigation();
  };

  proto.hideNavigation = function () {
    if (!(env().Yl || {}).isPhone) return;
    document.body.classList.add("is-hidden-nav");
    const pm = env().Pm;
    if (pm && typeof pm.hide === "function") pm.hide();
  };

  proto.restoreNavigation = function (animated = true) {
    if (!(env().Yl || {}).isPhone) return;
    if (!document.body.classList.contains("is-hidden-nav")) return;
    document.body.classList.remove("is-hidden-nav");
    const pm = env().Pm;
    const D = env().D || {};
    if (pm && typeof pm.show === "function") {
      pm.show({ animation: animated ? D.Fade : D.None });
    }
    if (!animated && typeof this.app.disableCssTransition === "function") {
      this.app.disableCssTransition();
      setTimeout(() => { if (typeof this.app.enableCssTransition === "function") this.app.enableCssTransition(); }, 0);
    }
  };

  proto.updateTabCount = function () {
    let count = 0;
    this.app.workspace.iterateRootLeaves(() => { count++; });
    ng37SetText(this.tabButtonEl, String(count));
  };

  proto._pinnedRibbonItem = function () {
    const wanted = this.app.vault.getConfig("mobileQuickRibbonItem");
    if (!wanted) return null;
    const items = (this.app.workspace.leftRibbon && this.app.workspace.leftRibbon.items) || [];
    return items.find((item) => item.id === wanted) || null;
  };

  proto.updateRibbonMenuItem = function () {
    if (this._pinnedClick) this.ribbonMenuItemEl.removeEventListener("click", this._pinnedClick);
    const pinned = this._pinnedRibbonItem();
    if (pinned && !pinned.hidden) {
      env().tv(this.ribbonMenuItemEl, pinned.icon || "lucide-menu");
      this.ribbonMenuItemEl.removeEventListener("click", this._menuClick);
      this._pinnedClick = () => { if (typeof pinned.callback === "function") pinned.callback(); };
      this.ribbonMenuItemEl.addEventListener("click", this._pinnedClick);
      this.ribbonMenuFlairEl.style.display = "";
      this.ribbonMenuFlairEl.show && this.ribbonMenuFlairEl.show();
    } else {
      env().tv(this.ribbonMenuItemEl, "lucide-menu");
      if (this._pinnedClick) this.ribbonMenuItemEl.removeEventListener("click", this._pinnedClick);
      this.ribbonMenuItemEl.addEventListener("click", this._menuClick);
      this.ribbonMenuFlairEl.style.display = "none";
      this.ribbonMenuFlairEl.hide && this.ribbonMenuFlairEl.hide();
    }
  };

  proto.showRibbonMenu = function (evt) {
    if (evt && typeof evt.preventDefault === "function") evt.preventDefault();
    const Menu = env().Ug;
    const menu = new Menu();
    const wanted = this.app.vault.getConfig("mobileQuickRibbonItem");
    const items = (this.app.workspace.leftRibbon && this.app.workspace.leftRibbon.items) || [];
    for (const item of items) {
      if (item.hidden) continue;
      menu.addItem((entry) => entry
        .setTitle(item.title)
        .setIcon(item.icon)
        .setChecked(item.id === wanted)
        .onClick(() => { if (typeof item.callback === "function") item.callback(); }));
    }
    const rect = this.ribbonMenuItemEl.getBoundingClientRect();
    menu.setParentElement && menu.setParentElement(this.ribbonMenuItemEl);
    menu.showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true, left: true });
  };

  proto.onLeafChange = function () {
    const leaf = this.app.workspace.activeLeaf;
    const back = (leaf && leaf.history && leaf.history.backHistory) || [];
    const forward = (leaf && leaf.history && leaf.history.forwardHistory) || [];
    if (this.backButtonEl) this.backButtonEl.ariaDisabled = String(back.length === 0);
    if (this.forwardButtonEl) this.forwardButtonEl.ariaDisabled = String(forward.length === 0);
    this.restoreNavigation();
  };

  proto.onConfigChanged = function () {
    if (!this.app.vault.getConfig("autoFullScreen")) this.restoreNavigation();
  };

  proto.unload = function () {
    for (const ref of this._subs || []) { try { ref.e.offref(ref); } catch (e) {} }
    this._subs = [];
    window.removeEventListener("mousedown", this.onWindowMouseDown);
    window.removeEventListener("keyboardWillShow", this.onKbShow);
    window.removeEventListener("keyboardWillHide", this.onKbHide);
    if (host && host.Component && host.Component.prototype.unload) {
      return host.Component.prototype.unload.call(this);
    }
  };

  return Ng37MobileNavbar;
}
