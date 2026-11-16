// Slice s09 — publish site: option keys and defaults, the site cache, nav/outline tree
// views, modals, the publish graph view, link-hover popovers and the two renderers
// (embed card + page). Bases toolbar dropdown menu lives here too. App internals are
// reached through env(); DOM factories (createDiv/createEl/ajaxPromise) are page globals.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { s09GraphRenderer, s09GraphLocalData, s09LoadPixiScript, s09GraphNodeData, s09SortTreeItems } from "./s09-graph.js";

const s09PCache = {};
function s09POnce(key, build) { return s09PCache[key] ??= build(); }

// ---------------------------------------------------------------- option keys (`var YY`..`var pQ`)

export const s09PubOptIndexFile = "indexFile";
export const s09PubOptSiteName = "siteName";
export const s09PubOptLogo = "logo";
export const s09PubOptNoindex = "noindex";
export const s09PubOptDefaultTheme = "defaultTheme";
export const s09PubOptShowThemeToggle = "showThemeToggle";
export const s09PubOptShowNavigation = "showNavigation";
export const s09PubOptShowGraph = "showGraph";
export const s09PubOptShowOutline = "showOutline";
export const s09PubOptShowSearch = "showSearch";
export const s09PubOptGoogleAnalytics = "googleAnalytics";
export const s09PubOptHideTitle = "hideTitle";
export const s09PubOptReadableLineLength = "readableLineLength";
export const s09PubOptStrictLineBreaks = "strictLineBreaks";
export const s09PubOptShowHoverPreview = "showHoverPreview";
export const s09PubOptShowBacklinks = "showBacklinks";
export const s09PubOptSlidingWindowMode = "slidingWindowMode";
export const s09PubOptNavigationOrdering = "navigationOrdering";
export const s09PubOptNavigationHiddenItems = "navigationHiddenItems";

/** `var dQ`/`var VY` — default values of every publish site option. */
export function s09PublishDefaults() {
  return {
    [s09PubOptIndexFile]: "",
    [s09PubOptSiteName]: "",
    [s09PubOptLogo]: "",
    [s09PubOptNoindex]: false,
    [s09PubOptDefaultTheme]: "light",
    [s09PubOptShowThemeToggle]: false,
    [s09PubOptShowNavigation]: true,
    [s09PubOptShowGraph]: true,
    [s09PubOptShowOutline]: false,
    [s09PubOptShowSearch]: false,
    [s09PubOptGoogleAnalytics]: "",
    [s09PubOptHideTitle]: false,
    [s09PubOptReadableLineLength]: true,
    [s09PubOptStrictLineBreaks]: false,
    [s09PubOptShowHoverPreview]: false,
    [s09PubOptShowBacklinks]: false,
    [s09PubOptSlidingWindowMode]: false,
    [s09PubOptNavigationOrdering]: [],
    [s09PubOptNavigationHiddenItems]: [],
  };
}

// ---------------------------------------------------------------- link-hover popovers (`var XQ`..`var iX`)

/** `var XQ` — hovers that were hidden and may reappear. */
export const s09PublishHiddenHovers = [];
/** `var $Q` — currently shown hovers. */
export const s09PublishActiveHovers = [];
/** `var ZQ` — interval id driving hover detection. */
export const s09PublishHoverTimer = 0;
/** `var JQ` — last known mouse position + document. */
export const s09PublishHoverPoint = null;

/** `var eX` — click/contextmenu outside every hover hides the stale ones. */
export function s09PublishHoverClick(e) {
  for (let t = 0; t < s09PublishHiddenHovers.length; t++) s09PublishHiddenHovers[t].hide();
  const target = e.targetNode;
  const stale = [];
  for (let o = 0; o < s09PublishActiveHovers.length; o++) {
    const hover = s09PublishActiveHovers[o];
    if (!hover.isFocused && !hover.hoverEl.contains(target)
      && !hover.childHovers.some((child) => child.hoverEl.contains(target))) {
      stale.push(hover);
    }
  }
  e.win.setTimeout(() => { stale.forEach((hover) => hover.hide()); }, 5);
}

/** `var tX` — remembers the mouse position for hover hit-testing. */
export function s09PublishHoverMove(e) {
  s09PublishHoverPointRef.value = { x: e.clientX, y: e.clientY, doc: e.doc };
}
// JQ is a `var` the bundle reassigns; the declarator replacement binds it to this holder
// only for the initial `null`. Writes go through the app-scope var, reads here use the holder.
export const s09PublishHoverPointRef = { value: null };

/** `var nX` — one hover tick: detect what is under the cursor and transition every hover. */
export function s09PublishHoverTick() {
  if (s09PublishActiveHovers.length === 0) {
    window.removeEventListener("click", s09PublishHoverClick, { capture: true });
    window.removeEventListener("contextmenu", s09PublishHoverClick, { capture: true });
    window.removeEventListener("mousemove", s09PublishHoverMove);
    clearInterval(s09PublishHoverTimerApp);
    s09PublishHoverTimerApp = 0;
    s09PublishHoverPointRef.value = null;
    return;
  }
  const point = s09PublishHoverPointRef.value;
  if (!point) return;
  const el = point.doc.elementFromPoint(point.x, point.y);
  for (let t = 0; t < s09PublishActiveHovers.length; t++) s09PublishActiveHovers[t].detect(el);
  for (let i = 0; i < s09PublishActiveHovers.length; i++) s09PublishActiveHovers[i].transition();
}
let s09PublishHoverTimerApp = 0;

/** `var iX` — starts the hover machinery on first use. */
export function s09PublishHoverStart() {
  if (s09PublishHoverTimerApp) return;
  window.addEventListener("click", s09PublishHoverClick, { capture: true });
  window.addEventListener("contextmenu", s09PublishHoverClick, { capture: true });
  window.addEventListener("mousemove", s09PublishHoverMove);
  s09PublishHoverTimerApp = window.setInterval(s09PublishHoverTick, 500);
}

// ---------------------------------------------------------------- `var oX` — footnote-aware subpath resolve

/** `var oX` — resolves an in-page subpath (heading/footnote) against a cache entry. */
export function s09PublishResolveSub(e, t, n) {
  if (n && !t.footnotes && n.match(/^#\[\^.*]$/)) {
    const parsed = env().fT(e);
    t.footnotes = parsed.footnotes;
  }
  return env().FT(t, n);
}

// ---------------------------------------------------------------- `var KY` — publish site cache

function s09buildPublishSiteCache() {
  function PublishSiteCache() {
    this.cache = {};
    this.uniqueFiles = new (env().sc)();
    this.aliases = {};
    this.permalinks = {};
  }
  PublishSiteCache.prototype.load = async function (cache) {
    this.cache = cache;
    const uniqueFiles = this.uniqueFiles = new (env().sc)();
    for (const path in cache) {
      if (!cache.hasOwnProperty(path)) continue;
      uniqueFiles.add(env().nu(path).toLowerCase(), path);
      const entry = cache[path];
      if (!entry) continue;
      env().wT(entry);
      const fm = entry.frontmatter;
      if (fm) {
        const aliases = env().nT(fm);
        if (aliases) for (const alias of aliases) this.aliases[alias.toLowerCase()] = path;
        const permalink = fm.permalink;
        if (permalink && typeof permalink === "string") {
          let p = permalink;
          if (p.startsWith("/")) p = p.substring(1);
          this.permalinks[p] = path;
        }
      }
    }
  };
  PublishSiteCache.prototype.getCache = function (path) {
    const cache = this.cache;
    return cache.hasOwnProperty(path) ? cache[path] : null;
  };
  PublishSiteCache.prototype.has = function (path) { return this.cache.hasOwnProperty(path); };
  PublishSiteCache.prototype.getLinktextDest = function (linktext, sourcePath) {
    const path = env().ET(linktext);
    return this.getLinkpathDest(path, sourcePath);
  };
  PublishSiteCache.prototype.getLinkpathDest = function (path, sourcePath) {
    if (path === "" && sourcePath && this.cache.hasOwnProperty(sourcePath)) return sourcePath;
    let found = this._getLinkpathDest(path, sourcePath);
    if (found.length > 0) return found[0];
    found = this._getLinkpathDest(path + ".md", sourcePath);
    if (found.length > 0) return found[0];
    const aliases = this.aliases;
    const lower = path.toLowerCase();
    if (aliases.hasOwnProperty(lower)) return aliases[lower];
    const base = env().nu(path);
    return aliases.hasOwnProperty(base) ? aliases[base] : null;
  };
  PublishSiteCache.prototype._getLinkpathDest = function (path, sourcePath) {
    const lower = path.toLowerCase();
    const base = env().nu(lower);
    const candidates = this.uniqueFiles.get(base);
    if (!candidates) return [];
    const folder = env().iu(sourcePath).toLowerCase();
    const prefixed = path.startsWith("./") || path.startsWith("../");
    if (prefixed) {
      let p = path;
      if (p.startsWith("./../")) p = p.substr(2);
      if (p.startsWith("./")) {
        if (folder !== "") folder += "/";
        p = folder + p.substring(2);
      } else {
        while (p.startsWith("../")) { p = p.substr(3); folder = env().iu(folder); }
        if (folder !== "") folder += "/";
        p = folder + p;
      }
      const near = [];
      for (const candidate of candidates) {
        const c = candidate.toLowerCase();
        if (c === p) near.push(candidate);
      }
      return near;
    }
    for (const candidate of candidates) {
      if (candidate.toLowerCase() === lower) return [candidate];
    }
    const withFolder = [], without = [];
    for (const candidate of candidates) {
      const c = candidate.toLowerCase();
      if (c.endsWith(lower)) (c.startsWith(folder) ? withFolder : without).push(candidate);
    }
    withFolder.sort((a, b) => a.length - b.length);
    without.sort((a, b) => a.length - b.length);
    return withFolder.concat(without);
  };
  return PublishSiteCache;
}
export function s09PublishSiteCache() { return s09POnce("s09PublishSiteCache", s09buildPublishSiteCache); }

// ---------------------------------------------------------------- Bases toolbar menu (`var zY`, `var qY`, `var jY`)

function s09buildBasesToolbarButton() {
  function BasesToolbarButton(containerEl, text, icon, onClick) {
    this.containerEl = containerEl.createDiv("bases-toolbar-item");
    this.buttonEl = this.containerEl.createDiv({ cls: "text-icon-button", attr: { tabindex: 0 } });
    this.iconEl = this.buttonEl.createSpan("text-button-icon", (el) => env().tv(el, icon));
    this.labelEl = this.buttonEl.createSpan({ cls: "text-button-label", text });
    this.buttonEl.addEventListener("click", (e) => { e.preventDefault(); onClick(); });
    this.buttonEl.addEventListener("keydown", (e) => {
      if (e.isComposing || e.defaultPrevented || (e.key !== " " && e.key !== "Enter")) return;
      onClick();
    });
  }
  BasesToolbarButton.prototype.addContainerClass = function (cls) { this.containerEl.addClass(cls); };
  BasesToolbarButton.prototype.setText = function (text) { this.labelEl.setText(text); };
  BasesToolbarButton.prototype.setIcon = function (icon) { env().tv(this.iconEl, icon); };
  return BasesToolbarButton;
}
export function s09BasesToolbarButton() { return s09POnce("s09BasesToolbarButton", s09buildBasesToolbarButton); }

function s09buildBasesDropdown() {
  const Button = s09BasesToolbarButton();
  function BasesDropdown(app, parentEl, text, icon) {
    const self = this;
    this.enabled = true;
    (this.scope = new (env().Ng)(app.scope)).register([], "Escape", () => self.setOpen(false));
    this.button = new Button(parentEl, text, icon, () => self.toggle());
    this.menu = new (s09BasesMenu())(app, this.button.buttonEl, icon);
  }
  BasesDropdown.prototype.addClass = function (cls) {
    this.button.addContainerClass(cls);
    this.menu.menuEl.addClass(cls);
  };
  Object.defineProperty(BasesDropdown.prototype, "scrollEl", {
    get() { return this.menu.scrollEl; }, enumerable: false, configurable: true,
  });
  BasesDropdown.prototype.onOpen = function (cb) { this.menu.handleOpen = cb; return this; };
  BasesDropdown.prototype.onClose = function (cb) { this.menu.handleClose = cb; return this; };
  BasesDropdown.prototype.setEnabled = function (enabled) {
    this.enabled = enabled;
    this.button.buttonEl.toggleClass("is-disabled", !enabled);
    if (!enabled && this.menu.isOpen) this.setOpen(false);
    return this;
  };
  BasesDropdown.prototype.setOpen = function (open) {
    if (open && !this.enabled) return;
    if (open) this.menu.setAutoDestroy(this.button.buttonEl);
    this.menu.setOpen(open);
  };
  BasesDropdown.prototype.toggle = function () { this.setOpen(!this.menu.isOpen); };
  return BasesDropdown;
}
export function s09BasesDropdown() { return s09POnce("s09BasesDropdown", s09buildBasesDropdown); }

function s09buildBasesMenu() {
  function BasesMenu(app, parentEl, title) {
    const self = this;
    this.enabled = true;
    this._isOpen = false;
    this._cleanup = null;
    this.app = app;
    this.parentEl = parentEl;
    (this.scope = new (env().Ng)(app.scope)).register([], "Escape", () => self.setOpen(false));
    const bgEl = this.bgEl = createDiv("suggestion-bg");
    bgEl.style.opacity = "0";
    bgEl.addEventListener("mousedown", (e) => e.preventDefault());
    bgEl.onClickEvent(() => self.setOpen(false));
    const menuEl = this.menuEl = createDiv("menu bases-toolbar-menu");
    menuEl.createDiv("menu-grabber");
    const mobileHeaderEl = menuEl.createDiv("modal-header");
    this.mobileTitleEl = mobileHeaderEl.createDiv({ cls: "modal-title", text: title });
    const closeEl = mobileHeaderEl.createDiv("modal-close-button tappable mod-raised clickable-icon");
    env().tv(closeEl, "lucide-check");
    closeEl.addEventListener("click", (e) => { e.preventDefault(); self.setOpen(false); });
    this.scrollEl = menuEl.createDiv("menu-scroll");
    if (env().Yl.isPhone) env()._g(menuEl, this.scrollEl, bgEl, () => { self.menuEl.detach(); self.setOpen(false); });
  }
  BasesMenu.prototype.isNodeOutside = function (node) {
    return !node.closest(".suggestion-container") && !this.parentEl.contains(node) && !this.menuEl.contains(node);
  };
  BasesMenu.prototype.registerOnClickOutside = function () {
    const self = this, parentEl = this.parentEl;
    const doc = parentEl.doc, win = parentEl.win;
    let clickedInside = false;
    const onAux = (e) => {
      if (self.isNodeOutside(e.target)) { self.setOpen(false); clickedInside = false; }
    };
    const onDown = (e) => {
      clickedInside = false;
      if (!e.defaultPrevented && self.isNodeOutside(e.targetNode)) clickedInside = true;
    };
    const onClick = () => {
      if (!self._isOpen) return;
      if (clickedInside) { self.setOpen(false); clickedInside = false; return; }
      win.setTimeout(() => {
        const active = doc.activeElement;
        if (active !== doc.body && self.isNodeOutside(active)) { self.setOpen(false); clickedInside = false; }
      }, 0);
    };
    win.addEventListener("auxclick", onAux);
    win.addEventListener("mousedown", onDown);
    win.addEventListener("click", onClick);
    this._cleanup?.();
    this._cleanup = () => {
      win.removeEventListener("auxclick", onAux);
      win.removeEventListener("mousedown", onDown);
      win.removeEventListener("click", onClick);
    };
  };
  BasesMenu.prototype.onOpen = function (cb) { this.handleOpen = cb; return this; };
  BasesMenu.prototype.onClose = function (cb) { this.handleClose = cb; return this; };
  Object.defineProperty(BasesMenu.prototype, "isOpen", { get() { return this._isOpen; }, enumerable: false, configurable: true });
  BasesMenu.prototype.position = function () {
    env().Nv(this.parentEl.getBoundingClientRect(), this.menuEl, { preventOverlap: true, gap: 4 });
  };
  BasesMenu.prototype.watchResize = function () {
    const self = this;
    if (!this.observer) {
      let last = 0, count = 0;
      this.observer = new ResizeObserver(() => {
        const now = Date.now();
        if (now - last > 100) { last = now; count = 0; }
        if (++count >= 10) return;
        self.position();
      });
    }
    this.observer.observe(this.menuEl);
  };
  BasesMenu.prototype.setAutoDestroy = function (el) {
    this.autoDestroy?.();
    this.autoDestroy = env().Rv(el, 500, () => this.setOpen(false));
  };
  BasesMenu.prototype.setOpen = function (open) {
    if (this._isOpen === open || (open && !this.enabled)) return;
    const app = this.app, menuEl = this.menuEl, bgEl = this.bgEl, containerEl = this.parentEl;
    this._isOpen = open;
    containerEl.toggleClass("has-active-menu", open);
    if (open) {
      this.app.keymap.pushScope(this.scope);
      containerEl.win.setTimeout(() => this.registerOnClickOutside(), 0);
      this.handleOpen?.();
      const body = containerEl.doc.body;
      body.appendChild(bgEl);
      body.appendChild(menuEl);
      if (env().Yl.isPhone) {
        if (env().Yl.isMobileApp && env().Im) env().Im.hide();
        const height = menuEl.offsetHeight - 1;
        env().yl(menuEl, new (env().dl)({ duration: 150, fn: "var(--anim-motion-swing)" }).addProp("transform", `translateY(${height}px)`, ""));
        env().yl(bgEl, new (env().dl)({ duration: 150 }).addProp("opacity", "0", "0.85"));
      } else {
        this.position();
        this.watchResize();
      }
    } else {
      this.autoDestroy?.();
      this.autoDestroy = null;
      this.handleClose?.();
      this._cleanup?.();
      this.app.keymap.popScope(this.scope);
      if (env().Yl.isPhone && menuEl.isShown()) {
        const height = menuEl.offsetHeight - 1;
        env().yl(menuEl, new (env().dl)({ duration: 150 }).addProp("transform", "", `translateY(${height}px)`), () => menuEl.detach());
        env().yl(bgEl, new (env().dl)({ duration: 150 }).addProp("opacity", null, "0"), () => bgEl.detach());
      } else {
        const refocus = this.menuEl.contains(this.menuEl.doc.activeElement);
        this.bgEl.detach();
        this.menuEl.detach();
        this.observer?.disconnect();
        this.observer = null;
        if (refocus) containerEl.focus();
      }
    }
  };
  BasesMenu.prototype.toggle = function () { this.setOpen(!this._isOpen); };
  return BasesMenu;
}
export function s09BasesMenu() { return s09POnce("s09BasesMenu", s09buildBasesMenu); }

// ---------------------------------------------------------------- publish nav tree (`var zQ`..`var UQ`)

function s09buildPublishTreeItem() {
  const Base = env().$L;
  function PublishTreeItem(owner, file) {
    const self = Base.call(this) || this;
    self.owner = owner;
    self.file = file;
    const innerEl = self.innerEl;
    let text = file.name;
    if (file.type === "file") text = env().ou(text);
    innerEl.setText(text);
    self.selfEl.setAttr("data-path", file.path);
    return self;
  }
  inherit(PublishTreeItem, Base);
  PublishTreeItem.prototype.setActive = function (active) { this.selfEl.toggleClass("mod-active", active); };
  PublishTreeItem.prototype.getItemPath = function () { return this.file.path; };
  return PublishTreeItem;
}
export function s09PublishTreeItem() { return s09POnce("s09PublishTreeItem", s09buildPublishTreeItem); }

function s09buildPublishFileItem() {
  const Base = s09PublishTreeItem();
  function PublishFileItem(owner, file) { return Base.call(this, owner, file) || this; }
  inherit(PublishFileItem, Base);
  PublishFileItem.prototype.onSelfClick = function (e) {
    if (e.defaultPrevented) return;
    this.owner.onItemClick(this, e);
  };
  PublishFileItem.prototype.render = function () {
    Base.prototype.render.call(this);
    this.selfEl.addClass("is-clickable");
    const innerEl = this.innerEl;
    const link = createEl("a");
    link.setText(innerEl.getText());
    const href = this.owner.publish.site.getPublicHref(this.getItemPath());
    link.setAttr("href", href);
    innerEl.setChildrenInPlace([link]);
  };
  return PublishFileItem;
}
export function s09PublishFileItem() { return s09POnce("s09PublishFileItem", s09buildPublishFileItem); }

function s09buildPublishFolderItem() {
  const FileItem = s09PublishFileItem();
  const Mixed = env().ZL(FileItem);
  function PublishFolderItem(owner, file) {
    const self = Mixed.call(this, owner, file) || this;
    self.children = [];
    self.setCollapsible(file.name !== "");
    self.setCollapsed(true, false);
    return self;
  }
  inherit(PublishFolderItem, Mixed);
  PublishFolderItem.prototype.onSelfClick = function (e) {
    if (e.defaultPrevented) return;
    this.toggleCollapsed(true);
  };
  PublishFolderItem.prototype.render = function () {
    Mixed.prototype.render.call(this);
    this.selfEl.addClass("is-clickable");
  };
  return PublishFolderItem;
}
export function s09PublishFolderItem() { return s09POnce("s09PublishFolderItem", s09buildPublishFolderItem); }

function s09buildPublishTree() {
  const Base = env().eI;
  function PublishTree(containerEl, publish, onItemClick) {
    const self = Base.call(this, containerEl) || this;
    self.activeItem = null;
    self.rootFolder = null;
    self.publish = publish;
    self.onItemClick = onItemClick;
    return self;
  }
  inherit(PublishTree, Base);
  PublishTree.prototype.setActiveItem = function (path) {
    const previous = this.activeItem;
    if (previous == null || previous.setActive(false), !path) { this.activeItem = null; return; }
    const parts = path.split("/");
    const chain = [];
    let node = this.rootFolder;
    for (const part of parts) {
      if (!(node instanceof (s09PublishFolderItem()))) return;
      let next = null;
      for (const child of node.children) {
        if (child.file.name === part) { next = child; break; }
      }
      if (!next) return;
      chain.push(next);
      node = next;
    }
    let deferred = null, last = null;
    for (const item of chain) {
      last = item;
      if (item instanceof (s09PublishFolderItem()) && item.collapsed) {
        if (deferred) item.setCollapsed(false, false); else deferred = item;
      }
    }
    if (deferred) deferred.setCollapsed(false, true);
    this.activeItem = last;
    if (last) last.setActive(true);
  };
  PublishTree.prototype.renderTree = function (root) {
    let folder = this.rootFolder = this.renderFolder(null, root);
    if (folder === null) folder = new (s09PublishFolderItem())(this, root);
    while (folder.children.length === 1) {
      const only = folder.children[0];
      if (!(only instanceof (s09PublishFolderItem()))) break;
      folder = only;
    }
    folder.setCollapsed(false, false);
    folder.setCollapsible(false);
    folder.selfEl.addClass("mod-root");
    this.addRoot(folder);
    this.render();
  };
  PublishTree.prototype.renderFolder = function (parent, folder) {
    const item = new (s09PublishFolderItem())(this, folder);
    for (const child of folder.children) {
      if (child.type === "file") this.renderFile(item, child);
      else if (child.type === "folder") this.renderFolder(item, child);
    }
    if (item.children.length === 0) return null;
    if (parent) parent.children.push(item);
    return item;
  };
  PublishTree.prototype.renderFile = function (parent, file) {
    if (env().su(file.path) !== "md") return null;
    const item = new (s09PublishFileItem())(this, file);
    parent.children.push(item);
  };
  return PublishTree;
}
export function s09PublishTree() { return s09POnce("s09PublishTree", s09buildPublishTree); }

// ---------------------------------------------------------------- publish outline (`var WQ`, `var _Q`, `var GQ`)

function s09buildPublishOutlineItem() {
  const Base = env().JL;
  function PublishOutlineItem(owner, heading) {
    const self = Base.call(this, owner, heading) || this;
    self.owner = owner;
    self.heading = heading;
    self.innerEl.setText(env().OT(heading));
    return self;
  }
  inherit(PublishOutlineItem, Base);
  PublishOutlineItem.prototype.onSelfClick = function (e) {
    if (e.defaultPrevented) return;
    const owner = this.owner;
    if (owner.onItemClick) owner.onItemClick(this.heading);
  };
  PublishOutlineItem.prototype.render = function () {
    Base.prototype.render.call(this);
    const owner = this.owner, children = this.children;
    this.setCollapsible(owner.collapsible && children && children.length > 0);
    this.setClickable(!!owner.onItemClick);
  };
  PublishOutlineItem.prototype.setActive = function (active) { this.selfEl.toggleClass("mod-active", active); };
  return PublishOutlineItem;
}
export function s09PublishOutlineItem() { return s09POnce("s09PublishOutlineItem", s09buildPublishOutlineItem); }

function s09buildPublishOutlineTree() {
  const Base = env().eI;
  function PublishOutlineTree(containerEl, onItemClick) {
    const self = Base.call(this, containerEl) || this;
    self.collapsible = true;
    self.highlighted = null;
    self.allItems = [];
    self.onItemClick = onItemClick;
    return self;
  }
  inherit(PublishOutlineTree, Base);
  PublishOutlineTree.prototype.renderOutline = function (headings) {
    const stack = [], allItems = this.allItems = [];
    for (const heading of headings) {
      const level = heading.level;
      const item = new (s09PublishOutlineItem())(this, heading);
      let top = stack.last();
      while (top && top.heading.level >= level) { stack.pop(); top = stack.last(); }
      const parent = top;
      stack.push(item);
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push(item);
      } else {
        this.addRoot(item);
      }
      allItems.push(item);
    }
    this.highlighted = null;
    this.render();
  };
  PublishOutlineTree.prototype.highlightLine = function (line) {
    const prev = this.highlighted;
    let next = null;
    for (const item of this.allItems) {
      if (!(item.heading.position.start.line <= line)) break;
      next = item;
    }
    if (next !== prev) {
      if (prev) prev.setActive(false);
      this.highlighted = next;
      if (next) next.setActive(true);
    }
  };
  return PublishOutlineTree;
}
export function s09PublishOutlineTree() { return s09POnce("s09PublishOutlineTree", s09buildPublishOutlineTree); }

function s09buildPublishOutlineView() {
  function PublishOutlineView(publish, containerEl) {
    this.publish = publish;
    const outer = this.containerEl = containerEl.createDiv("outline-view-outer");
    outer.createDiv("list-item published-section-header", (el) => {
      el.createSpan("published-section-header-icon", (icon) => env().tv(icon, "lucide-list"));
      el.createSpan({ text: "On this page" });
    });
    const inner = outer.createDiv("outline-view");
    (this.treeView = new (s09PublishOutlineTree())(inner, this.onItemClick.bind(this))).collapsible = false;
    publish.on("options-updated", this.updateOptions.bind(this));
    publish.on("navigated", this.onNavigated.bind(this));
  }
  PublishOutlineView.prototype.updateOptions = function () {
    let show = this.publish.site.getConfig(s09PubOptShowOutline);
    if (env().Fc) show = false;
    this.publish.containerEl.toggleClass("has-outline", show);
    this.containerEl.toggle(show);
    if (show) this.containerEl.onNodeInserted(this.onNavigated.bind(this));
  };
  PublishOutlineView.prototype.onItemClick = function (heading) {
    const publish = this.publish;
    publish.render.scrollToLoc(heading.position.start);
    const href = publish.site.getPublicHref(publish.render.currentFilepath) + "#" + env().IT(heading);
    history.replaceState(null, null, href);
  };
  PublishOutlineView.prototype.onNavigated = function () {
    const publish = this.publish, treeView = this.treeView, containerEl = this.containerEl;
    const site = publish.site;
    if (!site.getConfig(s09PubOptShowOutline)) return;
    treeView.clear();
    if (!containerEl.isShown()) return;
    const path = publish.render.currentFilepath;
    const cache = site.cache.getCache(path);
    if (cache && cache.headings && cache.headings.length !== 0) {
      containerEl.toggleVisibility(true);
      treeView.renderOutline(cache.headings);
      this.highlightLine(0);
    } else {
      containerEl.toggleVisibility(false);
    }
  };
  PublishOutlineView.prototype.highlightLine = function (line) { this.treeView.highlightLine(line); };
  return PublishOutlineView;
}
export function s09PublishOutlineView() { return s09POnce("s09PublishOutlineView", s09buildPublishOutlineView); }

// ---------------------------------------------------------------- publish nav view (`var HQ`)

function s09buildPublishNavView() {
  function PublishNavView(publish, containerEl) {
    this.initialized = false;
    this.publish = publish;
    const outerEl = this.outerEl = containerEl.createDiv("nav-view-outer");
    this.containerEl = outerEl.createDiv("nav-view");
    this.treeView = new (s09PublishTree())(this.containerEl, publish, this.onItemClick.bind(this));
    publish.on("options-updated", this.updateOptions.bind(this));
    publish.on("navigated", this.onNavigated.bind(this));
  }
  PublishNavView.prototype.getOuterEl = function () { return this.outerEl; };
  PublishNavView.prototype.updateOptions = function () {
    let show = this.publish.site.getConfig(s09PubOptShowNavigation);
    if (env().Fc) show = false;
    this.containerEl.toggle(show);
    this.publish.containerEl.toggleClass("has-navigation", show);
    if (show) {
      this.init();
      try {
        window.matchMedia("(max-width: 750px)").addEventListener("change", () => this.init());
      } catch (e) { console.error(e); }
    }
  };
  PublishNavView.prototype.init = function (force = false) {
    if (this.initialized) return;
    const site = this.publish.site;
    if (!site.getConfig(s09PubOptShowNavigation)) return;
    if (!force && this.containerEl.getBoundingClientRect().right <= 0) return;
    this.initialized = true;
    const order = site.getConfig(s09PubOptNavigationOrdering);
    const hidden = new Set(site.getConfig(s09PubOptNavigationHiddenItems));
    const rank = {};
    for (let i = 0; i < order.length; i++) rank[order[i]] = i;
    const hiddenSet = hidden;
    // build the folder tree from every cached path
    const top = { type: "folder", name: "", path: "", children: [], parent: null };
    const folders = { "": top };
    for (const path of Object.keys(site.cache.cache)) {
      const segments = path.split("/");
      let node = top, prefix = "";
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const p = prefix + seg;
        if (i === segments.length - 1) {
          node.children.push({ type: "file", name: seg, path: p, parent: node });
        } else {
          const key = p + "/";
          let folder = folders[key];
          if (!folder) {
            folder = { type: "folder", path: p, name: seg, children: [], parent: node };
            folders[key] = folder;
            node.children.push(folder);
          }
          node = folder;
        }
        prefix = p + "/";
      }
    }
    const prune = (folder) => {
      const kept = [];
      for (const child of folder.children) {
        if (!hiddenSet.has(child.path)) kept.push(child);
        if (child.type === "folder") prune(child);
      }
      folder.children = kept;
    };
    prune(top);
    s09SortTreeItems(top.children, rank);
    this.treeView.renderTree(top);
    this.treeView.setActiveItem(this.publish.render.currentFilepath);
  };
  PublishNavView.prototype.onNavigated = function () {
    this.treeView.setActiveItem(this.publish.render.currentFilepath);
  };
  PublishNavView.prototype.onItemClick = function (item, e) {
    const publish = this.publish;
    e.preventDefault();
    publish.containerEl.removeClass("is-left-column-open");
    publish.navigate(item.getItemPath(), "", e);
  };
  return PublishNavView;
}
export function s09PublishNavView() { return s09POnce("s09PublishNavView", s09buildPublishNavView); }

// ---------------------------------------------------------------- publish modals (`var KQ`, `var YQ`, `var QQ`)

function s09buildPublishModalBase() {
  function PublishModalBase(publish) {
    this.publish = publish;
    this.scope = new (env().Ng)();
    this.scope.register([], "Escape", this.close.bind(this));
    this.containerEl = createDiv("modal-container");
    const bg = this.containerEl.createDiv("modal-bg");
    this.modalEl = this.containerEl.createDiv("modal");
    this.closeButtonEl = this.modalEl.createDiv("modal-close-button mod-raised");
    this.titleEl = this.modalEl.createDiv("modal-title");
    this.contentEl = this.modalEl.createDiv("modal-content");
    this.closeButtonEl.addEventListener("click", this.close.bind(this));
    bg.addEventListener("click", this.close.bind(this));
  }
  PublishModalBase.prototype.open = function () {
    this.publish.keymap.pushScope(this.scope);
    document.body.appendChild(this.containerEl);
    this.onOpen();
  };
  PublishModalBase.prototype.close = function () {
    this.publish.keymap.popScope(this.scope);
    this.containerEl.remove();
    this.onClose();
  };
  PublishModalBase.prototype.onOpen = function () {};
  PublishModalBase.prototype.onClose = function () {};
  return PublishModalBase;
}
export function s09PublishModalBase() { return s09POnce("s09PublishModalBase", s09buildPublishModalBase); }

function s09buildPublishPasswordModal() {
  const Base = s09PublishModalBase();
  function PublishPasswordModal(publish, cb) {
    const self = Base.call(this, publish) || this;
    self.done = false;
    self.cb = cb;
    self.modalEl.addClass("mod-password-required");
    self.titleEl.setText("Protected site");
    self.closeButtonEl.hide();
    return self;
  }
  inherit(PublishPasswordModal, Base);
  PublishPasswordModal.prototype.close = function () {
    if (this.done) Base.prototype.close.call(this);
  };
  PublishPasswordModal.prototype.onOpen = function () { this.showPasswordRequired(); };
  PublishPasswordModal.prototype.showPasswordRequired = function () {
    const self = this, contentEl = this.contentEl;
    contentEl.empty();
    this.passwordIncorrectMsg = contentEl.createDiv("message-container", (el) => {
      el.createDiv({ cls: "message mod-error", text: "Password is incorrect, please try again." });
      el.hide();
    });
    contentEl.createEl("p", { cls: "" }, (p) => {
      self.passwordEl = p.createEl("input", { type: "password" }, (input) => {
        input.setAttribute("placeholder", "Enter password...");
        input.addEventListener("keydown", (e) => {
          if (e.isComposing || e.key !== "Enter") return;
          self.tryUnlockSite();
        });
      });
    });
    contentEl.createDiv("modal-button-container", (el) => {
      el.createEl("button", { text: "Confirm", cls: "mod-cta" }).addEventListener("click", self.tryUnlockSite.bind(self));
    });
  };
  PublishPasswordModal.prototype.tryUnlockSite = async function () {
    const pw = this.passwordEl.value;
    const site = this.publish.site;
    try {
      const res = await ajaxPromise({ method: "POST", url: site.host + "/pw", data: { id: site.id, pw } });
      try {
        const parsed = JSON.parse(res);
        this.publish.site.hpw = parsed.hpw;
        localStorage[site.id] = parsed.hpw;
      } catch (e) { console.error(e); }
      this.done = true;
      this.cb();
      this.showPasswordCorrect();
    } catch (e) {
      this.passwordIncorrectMsg.show();
    }
  };
  PublishPasswordModal.prototype.showPasswordCorrect = function () {
    const self = this, contentEl = this.contentEl;
    contentEl.empty();
    this.titleEl.setText("Site unlocked");
    contentEl.createDiv("message-container", (el) => {
      el.createDiv({ cls: "message mod-success", text: "Thank you, the password is correct." });
    });
    contentEl.createEl("p", { cls: "u-muted", text: "The password will be remembered during the following sessions for your convenience." });
    contentEl.createDiv("modal-button-container", (el) => {
      el.createEl("button", { text: "Enter", cls: "mod-cta" }).addEventListener("click", () => self.close());
    });
  };
  return PublishPasswordModal;
}
export function s09PublishPasswordModal() { return s09POnce("s09PublishPasswordModal", s09buildPublishPasswordModal); }

function s09buildPublishTagModal() {
  const Base = s09PublishModalBase();
  function PublishTagModal(publish, tag) {
    const self = Base.call(this, publish) || this;
    self.tag = tag;
    self.titleEl.createSpan({ text: "Pages with tag " + tag });
    return self;
  }
  inherit(PublishTagModal, Base);
  PublishTagModal.prototype.onOpen = function () {
    const self = this, publish = this.publish, tag = this.tag;
    const site = publish.site, cache = site.cache.cache;
    const re = new RegExp("^" + env().oc(tag) + "(\\/|$)", "i");
    const pages = [];
    for (const path in cache) {
      if (!cache.hasOwnProperty(path)) continue;
      const tags = env().DT(cache[path]);
      if (tags) {
        for (const t of tags) {
          if (re.test(t)) { pages.push(path); break; }
        }
      }
    }
    const list = this.contentEl.createEl("ol", "files-with-tag-container");
    if (pages.length > 0) {
      for (const path of pages) {
        list.createEl("li", "files-with-tag-item", (li) => {
          li.createEl("a", { cls: "internal-link", href: site.getPublicHref(path), text: env().hu(path) })
            .addEventListener("click", (e) => {
              e.preventDefault();
              self.close();
              publish.navigate(path, "");
            });
        });
      }
    } else {
      list.createDiv({ cls: "files-with-tag-item", text: "There are no pages that contain this tag." });
    }
  };
  return PublishTagModal;
}
export function s09PublishTagModal() { return s09POnce("s09PublishTagModal", s09buildPublishTagModal); }

// ---------------------------------------------------------------- publish graph data + view (`var OQ`, `var IQ`)

/** `var OQ` — walks the site cache into the {nodes, links} graph the renderer consumes. */
export async function s09PublishGraphData(cache, options) {
  const showAttachments = options.showAttachments, hideUnresolved = options.hideUnresolved, showTags = options.showTags;
  const nodes = {};
  const visitPath = (path) => {
    if (!showAttachments && env().su(path) !== "md") return;
    const links = (nodes[path] = s09GraphNodeData()).links;
    const entry = cache.cache[path];
    env().ST(entry, (ref) => {
      const target = env().ET(ref.link);
      const dest = cache.getLinktextDest(target, path);
      if (dest) {
        if (!showAttachments && env().su(dest) !== "md") return;
        links[dest] = true;
      } else if (hideUnresolved) {
        links[target] = true;
        if (!nodes.hasOwnProperty(target)) nodes[target] = s09GraphNodeData("unresolved");
      }
    });
    if (showTags) {
      const tags = env().DT(entry);
      if (tags && tags.length > 0) {
        for (const tag of tags) {
          links[tag] = true;
          if (!nodes.hasOwnProperty(tag)) nodes[tag] = s09GraphNodeData("tag");
        }
      }
    }
  };
  // The original drives an async batched iterator; the traversal order is Object.keys order.
  for (const path of Object.keys(cache.cache)) visitPath(path);
  return { nodes };
}

function s09buildPublishGraphView() {
  function PublishGraphView(publish, containerEl) {
    this.expanded = false;
    this.global = false;
    this.publish = publish;
    const outer = this.outerContainerEl = containerEl.createDiv("graph-view-outer");
    outer.createDiv("list-item published-section-header", (el) => {
      el.createSpan("published-section-header-icon", (icon) => env().tv(icon, "lucide-git-fork"));
      el.createSpan({ text: "Interactive graph" });
    });
    const box = this.outerEl = outer.createDiv("graph-view-container");
    this.containerEl = box.createDiv("graph-view");
    const expand = box.createDiv("graph-icon graph-expand");
    expand.setAttr("role", "button");
    env().tv(expand, "lucide-arrow-up-right");
    env().Mv(expand, "Expand", { placement: "top" });
    expand.addEventListener("click", this.onExpand.bind(this));
    const globalBtn = box.createDiv("graph-icon graph-global");
    globalBtn.setAttr("role", "button");
    env().tv(globalBtn, "lucide-git-fork");
    env().Mv(globalBtn, "Global Graph", { placement: "top" });
    globalBtn.addEventListener("click", this.onGlobalGraph.bind(this));
    this.modalEl = createDiv("modal-container");
    const bg = this.modalEl.createDiv("modal-bg");
    this.modalContainerEl = this.modalEl.createDiv("graph-view-container mod-expanded");
    bg.addEventListener("click", (e) => e.button === 0 && this.onExitExpand());
    publish.on("options-updated", this.updateOptions.bind(this));
    publish.on("navigated", this.onNavigated.bind(this));
  }
  PublishGraphView.prototype.updateOptions = function () {
    const self = this;
    let show = this.publish.site.getConfig(s09PubOptShowGraph);
    if (env().Fc) show = false;
    this.publish.containerEl.toggleClass("has-graph", show);
    this.containerEl.toggle(show);
    if (!show || this.renderer) return;
    env().gg(this.containerEl, () => {
      const worker = env().Hz("/sim.js", { name: "Graph Worker" });
      s09LoadPixiScript().then(async () => {
        const w = await worker;
        if (document.fonts) await document.fonts.ready;
        if (this.renderer) return;
        const renderer = this.renderer = new (s09GraphRenderer())(this.containerEl, false, false, w);
        renderer.onNodeClick = this.onNodeClick.bind(this);
        renderer.setScale(0.5);
        renderer.targetScale = 0.5;
        renderer.setRenderOptions({ textFadeMultiplier: -1 });
        this.onNavigated();
      });
    });
  };
  PublishGraphView.prototype.onNodeClick = function (e, path, type) {
    this.onExitExpand();
    this.publish.navigate(path, "", e instanceof MouseEvent || e instanceof PointerEvent ? e : null);
  };
  PublishGraphView.prototype.onResize = function () {
    if (this.renderer) this.renderer.onResize();
  };
  PublishGraphView.prototype.onExpand = function () {
    if (this.expanded) return;
    this.expanded = true;
    const containerEl = this.containerEl, renderer = this.renderer;
    const modalEl = this.modalEl, modalContainerEl = this.modalContainerEl;
    document.body.appendChild(modalEl);
    modalContainerEl.appendChild(containerEl);
    if (renderer) { renderer.onResize(); renderer.zoomTo(2 * renderer.scale); }
  };
  PublishGraphView.prototype.onExitExpand = function () {
    if (!this.expanded) return;
    this.expanded = false;
    const outerEl = this.outerEl, modalEl = this.modalEl, containerEl = this.containerEl;
    const renderer = this.renderer, wasGlobal = this.global;
    modalEl.detach();
    outerEl.insertBefore(containerEl, outerEl.firstChild);
    if (renderer) { renderer.onResize(); if (!wasGlobal) renderer.zoomTo(renderer.scale / 2); }
    this.global = false;
    if (wasGlobal) this.onNavigated();
  };
  PublishGraphView.prototype.onGlobalGraph = function () {
    this.onExpand();
    this.global = true;
    const renderer = this.renderer;
    if (renderer) renderer.zoomTo(renderer.scale);
    this.onNavigated();
  };
  PublishGraphView.prototype.getGraphData = function (cache) {
    if (!this._graphData) {
      this._graphData = (async () => s09PublishGraphData(cache, {
        showAttachments: false, hideUnresolved: true, showTags: false,
      }))();
    }
    return this._graphData;
  };
  PublishGraphView.prototype.onNavigated = async function () {
    const renderer = this.renderer;
    if (!renderer) return;
    const site = this.publish.site;
    if (!site.getConfig(s09PubOptShowGraph)) return;
    const path = this.publish.render.currentFilepath;
    if (path !== this.currentFilepath) {
      renderer.resetPan();
      this.currentFilepath = path;
    }
    renderer.highlightNode = null;
    let data;
    if (path) {
      data = await this.getGraphData(site.cache);
      if (!this.global) {
        data = s09GraphLocalData(data, {
          localFile: path, localJumps: 1, localInterlinks: true, localForelinks: true, localBacklinks: true,
        });
      }
    } else {
      data = { nodes: {} };
    }
    renderer.setData(data);
  };
  return PublishGraphView;
}
export function s09PublishGraphView() { return s09POnce("s09PublishGraphView", s09buildPublishGraphView); }

// `LQ` loads pixi; the graph view waits on it before constructing the renderer.

// ---------------------------------------------------------------- renderers (`var aX`, `var sX`)

function s09buildPublishEmbedView() {
  const Base = env().jm;
  function PublishEmbedView(publish, contentEl) {
    const self = Base.call(this, publish, contentEl) || this;
    self.id = env().cc(16);
    self.hoverPopover = null;
    self.currentFilepath = null;
    self.embedDepth = 0;
    self.publish = publish;
    const renderer = self.renderer = new (env().Gz)(self, self, contentEl, "/worker.js");
    renderer.addHeader();
    renderer.addFooter();
    return self;
  }
  inherit(PublishEmbedView, Base);
  PublishEmbedView.prototype.renderContent = function (text, path) {
    this.currentFilepath = path;
    const renderer = this.renderer, hover = this.hoverPopover;
    if (hover) { hover.hide(); this.hoverPopover = null; }
    renderer.clear();
    renderer.set(text);
  };
  PublishEmbedView.prototype.onScroll = function () {};
  PublishEmbedView.prototype.onFoldChange = function () {};
  PublishEmbedView.prototype.onCheckboxClick = function (e, t, n) {};
  PublishEmbedView.prototype.onExternalLinkClick = function (e, t, n) {};
  PublishEmbedView.prototype.onInternalLinkClick = function (e, t, path) {
    e.preventDefault();
    this.publish.navigate(path, this.currentFilepath, e);
  };
  PublishEmbedView.prototype.onInternalLinkDrag = function (e, t, n) {};
  PublishEmbedView.prototype.onInternalLinkRightClick = function (e, t, n) {};
  PublishEmbedView.prototype.onExternalLinkRightClick = function (e, t, n) {};
  PublishEmbedView.prototype.onInternalLinkMouseover = function (e, target, path) {
    const self = this;
    if (!this.publish.site.getConfig(s09PubOptShowHoverPreview)) return;
    let hover = this.hoverPopover;
    if (hover && hover.state !== env().VQ.Hidden && hover.targetEl === target) return;
    hover = new (env().rX)(this, target);
    setTimeout(async () => {
      if (hover.state === env().VQ.Hidden) return;
      const el = hover.hoverEl.createDiv();
      const loaded = await this.loadEmbed(path, this.currentFilepath, el, true);
      if (!loaded) {
        el.createDiv({ cls: "markdown-embed", text: "This page does not yet exist." });
        el.addClass("mod-empty");
      }
      if (hover.state === env().VQ.Shown) hover.position();
    }, 100);
  };
  PublishEmbedView.prototype.onTagClick = function (e, target, tag) {
    new (s09PublishTagModal())(this.publish, tag).open();
  };
  PublishEmbedView.prototype.onQueryClick = function (e, t, n) {};
  PublishEmbedView.prototype.postProcess = function (rendered, promises, frontmatter) {
    const self = this;
    const result = this._postProcess({
      docId: this.id,
      sourcePath: this.currentFilepath,
      frontmatter,
      promises,
      addChild: (child) => self.addChild(child),
      getSectionInfo: (el) => self.renderer.getSectionInfo(el),
      replace: () => null,
      containerEl: this.renderer.sizerEl,
      el: rendered.el,
    });
    rendered.usesFrontMatter = !!result.usesFrontMatter;
  };
  PublishEmbedView.prototype.onRenderComplete = function () {};
  PublishEmbedView.prototype._postProcess = function (ctx) {
    const site = this.publish.site;
    const promises = ctx.promises, root = ctx.el;
    for (const processor of env().Gz.postProcessors) {
      const out = processor(root, ctx);
      if (out && out.then) promises.push(out);
    }
    const links = root.findAll("a.internal-link");
    if (links.length > 0) {
      for (const link of links) {
        const href = link.getAttribute("data-href");
        if (href) {
          const parsed = env().MT(href);
          const targetPath = parsed.path, subpath = parsed.subpath;
          const dest = site.cache.getLinkpathDest(targetPath, ctx.sourcePath);
          link.toggleClass("is-unresolved", !dest);
          const resolved = dest || targetPath || "";
          link.setAttr("href", site.getPublicHref(resolved) + subpath);
        }
      }
    }
    const first = root.firstChild;
    if (first instanceof HTMLHeadingElement) {
      const heading = first.getAttr("data-heading");
      if (heading) {
        first.appendText(" ");
        first.addClass("publish-article-heading");
        const icon = first.createSpan({ cls: "clickable-icon" });
        icon.addEventListener("click", async () => {
          const url = site.getPublicHref(ctx.sourcePath) + "#" + env().NQ(env().IT(heading));
          history.replaceState(null, null, url);
          env().Ec(url);
          new (env().fb)("Link copied to your clipboard");
        });
        env().tv(icon, "lucide-link");
        env().Mv(icon, "Copy link");
      }
    }
    const embeds = root.findAll(".internal-embed:not(.is-loaded)");
    if (embeds.length > 0) {
      for (const embed of embeds) {
        const src = embed.getAttribute("src");
        const done = this.loadEmbed(src, ctx.sourcePath, embed);
        promises.push(done);
      }
    }
    const images = root.findAll("img:not([alt])");
    for (const img of images) img.setAttr("alt", env().nu(img.getAttr("src")));
    const emptyLinks = root.findAll('a:not([href]), a[href=""]');
    for (const link of emptyLinks) link.setAttr("href", "#");
    const checkboxes = root.findAll('input[type="checkbox"]:not([aria-label])');
    for (const box of checkboxes) box.setAttr("aria-label", "Task");
    const media = root.findAll("img, audio, video");
    for (const el of media) {
      if (!el) continue;
      const src = el.getAttr("src");
      if (env().YC(src)) {
        const decoded = env().JC(env().ZC(src));
        const dest = site.cache.getLinkpathDest(decoded, ctx.sourcePath);
        if (dest) el.src = site.getInternalUrl(dest);
      }
    }
    return ctx;
  };
  PublishEmbedView.prototype.loadEmbed = async function (target, sourcePath, containerEl, hoverOnly = false) {
    const publish = this.publish, site = publish.site, cache = site.cache;
    const parsed = env().MT(target);
    const path = parsed.path, subpath = parsed.subpath;
    const dest = cache.getLinkpathDest(path, sourcePath);
    containerEl.empty();
    if (!dest) return false;
    const name = env().nu(dest);
    const ext = env().su(dest);
    const href = site.getInternalUrl(dest);
    if (env().Vy.includes(ext)) {
      containerEl.addClass("image-embed");
      await env().xc(containerEl, href);
      containerEl.addClass("is-loaded");
      return true;
    }
    if (env().Hy.includes(ext)) {
      containerEl.addClass("media-embed", "audio-embed");
      await env().Dc(containerEl, href);
      containerEl.addClass("is-loaded");
      return true;
    }
    if (env().zy.includes(ext)) {
      containerEl.addClass("media-embed", "video-embed");
      await env().Ac(containerEl, href);
      containerEl.addClass("is-loaded");
      return true;
    }
    if (env().qy.includes(ext)) {
      containerEl.addClass("pdf-embed");
      const frame = containerEl.createEl("iframe");
      frame.src = href + (subpath || "");
      frame.style.width = "100%";
      frame.style.height = "100%";
      containerEl.addClass("is-loaded");
      return true;
    }
    if (env().jy.includes(ext) && this.embedDepth < 5) {
      const entry = cache.getCache(dest);
      let text;
      if (dest !== this.currentFilepath) {
        try {
          text = await ajaxPromise({ withCredentials: true, url: href });
        } catch (e) {
          text = e instanceof XMLHttpRequest && e.status === 404 ? "File not found" : "Failed to load";
        }
      } else {
        text = this.renderer.text;
      }
      const resolved = s09PublishResolveSub(text, entry, subpath);
      const title = name.substr(0, name.length - env().su(name).length - 1);
      containerEl.addClass("markdown-embed");
      if (!hoverOnly || resolved) containerEl.createDiv({ cls: "markdown-embed-title", text: title });
      const content = containerEl.createDiv("markdown-embed-content");
      containerEl.createDiv("markdown-embed-link", (el) => {
        env().tv(el, "lucide-link");
        env().Mv(el, "Open link");
        el.setAttr("role", "button");
        el.onClickEvent((e) => {
          if (e.button !== 0 && e.button !== 1) return;
          e.preventDefault();
          e.stopPropagation();
          publish.navigate(target, sourcePath, e);
        });
      });
      if (resolved) text = env().NT(text, entry, resolved).content;
      const child = new (s09PublishPageViewCtor())(publish, content);
      child.embedDepth = this.embedDepth + 1;
      child.renderContent(text, dest);
      await new Promise((resolve) => child.renderer.onRendered(resolve));
      containerEl.addClass("is-loaded");
      return true;
    }
    containerEl.addClass("file-embed");
    containerEl.createDiv({ cls: "file-embed-title", text: name });
    containerEl.createDiv("file-embed-link", (el) => {
      el.addEventListener("click", () => window.open(href));
      env().tv(el, "lucide-arrow-up-right");
      env().Mv(el, "Open in default app");
    });
    containerEl.addClass("is-loaded");
    return true;
  };
  return PublishEmbedView;
}
export function s09PublishEmbedView() { return s09POnce("s09PublishEmbedView", s09buildPublishEmbedView); }

// The embed renderer instantiates the page renderer for nested markdown embeds; resolved lazily
// so the two factories can reference each other.
function s09PublishPageViewCtor() { return s09PublishPageView(); }

function s09buildPublishPageView() {
  const Base = s09PublishEmbedView();
  function PublishPageView(publish) {
    const wrap = createDiv("publish-renderer");
    const self = Base.call(this, publish, wrap) || this;
    const title = wrap.createDiv("extra-title");
    self.renderContainerEl = wrap;
    self.extraTitle = title.createSpan("extra-title-text");
    const close = title.createSpan();
    env().tv(close, "lucide-x");
    env().Mv(close, "Close page");
    close.setAttr("role", "button");
    close.addEventListener("click", () => publish.closeRenderer(self));
    return self;
  }
  inherit(PublishPageView, Base);
  PublishPageView.prototype.loadFile = async function (path, subpath) {
    const publish = this.publish, renderer = this.renderer;
    let hover = this.hoverPopover;
    const site = publish.site;
    if (this.currentFilepath === path) { this.navigateSubpath(subpath); return; }
    this.currentFilepath = path;
    const name = env().nu(path);
    const ext = env().su(name);
    const title = env().hu(path);
    if (hover) { hover.hide(); this.hoverPopover = hover = null; }
    this.extraTitle.setText(title);
    const header = renderer.header;
    const headerEl = header.el;
    headerEl.empty();
    if (!site.getConfig(s09PubOptHideTitle)) headerEl.createEl("h1", { cls: "page-header", text: title });
    renderer.updateHeader();
    renderer.clear();
    const footer = renderer.footer;
    const footerEl = footer.el;
    footerEl.empty();
    renderer.updateFooter();
    if (ext !== "md") {
      renderer.set("![[" + path + "]]");
    } else {
      let text = "";
      try {
        text = await site.loadMarkdownFile(path);
      } catch (e) {
        if (e instanceof XMLHttpRequest && e.status === 404) {
          new (env().fb)(`"${path}" does not exist`);
        } else {
          new (env().fb)(`An error occurred while loading "${path}"`);
          console.error(e);
        }
      }
      renderer.set(text || " ");
      if (!this.navigateSubpath(subpath)) subpath = "";
    }
    publish.trigger("navigated");
    if (subpath) {
      const url = site.getPublicHref(path) + env().RQ(subpath, "#");
      history.replaceState(null, null, url);
    }
    if (site.getConfig(s09PubOptShowBacklinks)) {
      const cache = site.cache.cache;
      const backlinks = [];
      for (const other in cache) {
        if (!cache.hasOwnProperty(other) || other === path) continue;
        const found = env().ST(cache[other], (ref) => {
          if (site.cache.getLinktextDest(ref.link, other) === path) return true;
        });
        if (found) {
          const label = env().hu(other);
          const el = createDiv("backlink-item", (div) => {
            div.createEl("a", { cls: "internal-link", href: site.getPublicHref(other), attr: { "data-href": other }, text: label });
          });
          backlinks.push({ el, name: label });
        }
      }
      if (backlinks.length > 0) {
        renderer.onRendered(() => {
          footerEl.empty();
          const section = footerEl.createDiv("backlinks");
          section.createDiv("published-section-header", (el) => {
            el.createSpan("published-section-header-icon", (icon) => env().tv(icon, "lucide-link"));
            el.createSpan({ text: "Links to this page" });
          });
          const container = section.createDiv("backlink-items-container");
          backlinks.sort((a, b) => env().ub(a.name, b.name));
          container.setChildrenInPlace(backlinks.map((b) => b.el));
          renderer.updateFooter();
        });
      }
    }
  };
  PublishPageView.prototype.onScroll = function () {
    const publish = this.publish, renderer = this.renderer;
    if (!publish.site.getConfig(s09PubOptShowOutline)) return;
    const scroll = renderer.getScroll();
    publish.outline.highlightLine(Math.round(scroll));
  };
  PublishPageView.prototype.onResize = function () { this.renderer.onResize(); };
  PublishPageView.prototype.navigateSubpath = function (subpath) {
    if (subpath) {
      const cache = this.publish.site.cache.getCache(this.currentFilepath);
      if (cache) {
        const resolved = s09PublishResolveSub(this.renderer.text, cache, subpath);
        if (resolved) { this.scrollToLoc(resolved.start); return true; }
      }
    }
    return false;
  };
  PublishPageView.prototype.scrollToLoc = function (loc) {
    this.renderer.applyScrollDelayed(loc.line, { highlight: true });
    this.onScroll();
  };
  return PublishPageView;
}
export function s09PublishPageView() { return s09POnce("s09PublishPageView", s09buildPublishPageView); }
