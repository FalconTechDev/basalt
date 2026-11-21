// n-g21-menu.js — context menus, drop-down menus and nested submenus (clean-room, spec g21 §3.1).
// A Menu owns a flat item list plus a section table; sort() folds sections into groups,
// merges configured section prefixes into submenu parents and rebuilds the DOM.
import { debounceCall } from "./timing.js";
import { env } from "./env.js";

let ng21MenuItemCtor = null;
let ng21MenuSepCtor = null;
let ng21ActiveMenu = null;
const ng21ForEventCache = new WeakMap();
const ng21PopstateWins = new WeakSet();

function ng21Keymap() {
  const K = env().Bg;
  return K && K.init ? K.init() : null;
}

function ng21RootScope() {
  const km = ng21Keymap();
  if (!km) return null;
  return km.getRootScope ? km.getRootScope() : km.rootScope || null;
}

function ng21PushScope(scope) {
  const km = ng21Keymap();
  if (km && km.pushScope) km.pushScope(scope);
}

function ng21PopScope(scope) {
  const km = ng21Keymap();
  if (km && km.popScope) km.popScope(scope);
}

function ng21EnsurePopstate(win) {
  if (ng21PopstateWins.has(win)) return;
  ng21PopstateWins.add(win);
  win.addEventListener("popstate", () => ng21CloseAllMenus());
}

/** Exported entry `jg`: force-close the whole open menu chain. */
export function ng21CloseAllMenus() {
  let menu = ng21ActiveMenu;
  while (menu) {
    const parent = menu.parentMenu;
    menu.close();
    menu = parent;
  }
}

// =====================================================================================================================
// MenuItem
// =====================================================================================================================

export function ng21DefineMenuItem(host) {
  function MenuItem(menu) {
    this.menu = menu || null;
    this.dom = host.createDiv("menu-item tappable");
    this.iconEl = this.dom.createDiv("menu-item-icon");
    this.titleEl = this.dom.createDiv("menu-item-title");
    this.checkIconEl = null;
    this.submenu = null;
    this.disabled = false;
    this.checked = false;
    this.section = "";
    this.callback = null;
    this._ng21FoldChild = false;
    this._ng21FoldParent = false;
    this._ng21FullSection = null;
    this.dom.addEventListener("click", (event) => this.handleClick(event));
  }
  MenuItem.create = function (menu) { return new MenuItem(menu); };
  const proto = MenuItem.prototype;

  proto.setTitle = function (title) { this.titleEl.setText(title); return this; };

  proto.setIcon = function (icon) {
    if (icon) host.setIcon(this.iconEl, icon);
    else this.iconEl.empty();
    return this;
  };

  proto.removeIcon = function () { this.iconEl.empty(); return this; };

  proto.setChecked = function (b) {
    this.checked = !!b;
    this.dom.toggleClass("mod-checked", this.checked);
    if (this.checked && !this.checkIconEl) {
      this.checkIconEl = this.dom.createDiv("menu-item-icon mod-checked");
      host.setIcon(this.checkIconEl, "lucide-check");
    } else if (!this.checked && this.checkIconEl) {
      this.checkIconEl.detach();
      this.checkIconEl = null;
    }
    return this;
  };
  proto.setActive = proto.setChecked;

  proto.setDisabled = function (b) {
    this.disabled = !!b;
    this.dom.toggleClass("is-disabled", this.disabled);
    return this;
  };

  proto.setWarning = function (b) { this.dom.toggleClass("is-warning", !!b); return this; };

  proto.setIsLabel = function (b) {
    this.dom.toggleClass("is-label", !!b);
    this.dom.toggleClass("tappable", !b);
    return this;
  };

  proto.setSection = function (name) {
    this.section = name || "";
    if (this.section) this.dom.setAttribute("data-section", this.section);
    else this.dom.removeAttribute("data-section");
    return this;
  };

  proto.onClick = function (cb) { this.callback = cb; return this; };

  proto.setSubmenu = function () {
    if (!this.submenu) {
      this.submenu = new host.Menu();
      this.submenu.parentMenu = this.menu;
      this.dom.addClass("has-submenu");
      this.dom.createDiv("mod-submenu");
    }
    return this.submenu;
  };

  /** Runs the click callback (no hide; callers decide). */
  proto.handleEvent = function (event) {
    if (this.callback) this.callback(event);
  };

  proto.handleClick = function (event) {
    if (this.disabled || this.dom.hasClass("is-label")) return;
    if (this.submenu) {
      const idx = this.menu.items.indexOf(this);
      if (idx >= 0) this.menu.select(idx);
      if (host.Platform.isPhone) {
        this.menu.openSubmenu(this, true);
        this.slideIntoSubmenu();
        return;
      }
      this.menu.openSubmenu(this, true);
      return;
    }
    this.handleEvent(event);
    this.menu.hide();
  };

  /** Phone path: slide the (already open) submenu in over the parent with a back row. */
  proto.slideIntoSubmenu = function () {
    const sub = this.submenu;
    if (!sub || sub._ng21Slid) return;
    sub._ng21Slid = true;
    const back = ng21MenuItemCtor.create(sub);
    back.setSection("title").setIsLabel(true);
    back.setTitle(this.titleEl.textContent);
    back.setIcon("lucide-chevron-left");
    back.onClick(() => { sub._ng21Slid = false; sub.hide(); });
    sub.items.unshift(back);
    sub.sort();
    const prevActive = ng21ActiveMenu === sub ? sub.parentMenu : ng21ActiveMenu;
    if (prevActive && prevActive.scrollEl) {
      sub.scrollEl.style.minHeight = prevActive.scrollEl.offsetHeight + "px";
    }
    sub.selectFirstEnabled();
    if (host.slideBetween && prevActive && prevActive.dom) {
      try { host.slideBetween(prevActive.dom, sub.dom, "right"); } catch (e) { /* animation only */ }
    }
  };

  ng21MenuItemCtor = MenuItem;
  return MenuItem;
}

// =====================================================================================================================
// MenuSeparator
// =====================================================================================================================

export function ng21DefineMenuSeparator(host) {
  function MenuSeparator(menu) {
    this.menu = menu || null;
    this.section = "";
    this.dom = host.createDiv("menu-separator");
  }
  ng21MenuSepCtor = MenuSeparator;
  return MenuSeparator;
}

// =====================================================================================================================
// Menu
// =====================================================================================================================

export function ng21DefineMenu(host) {
  function Menu() {
    this.items = [];
    this.sections = [];
    this.submenuConfigs = new Map();
    this.selected = null;
    this.dom = host.createDiv("menu");
    this.dom.createDiv("menu-grabber");
    this.scrollEl = this.dom.createDiv("menu-scroll");
    this.bgEl = host.createDiv("suggestion-bg");
    this.parentEl = null;
    this.parentMenu = null;
    this.currentSubmenu = null;
    this.scope = new host.Scope(ng21RootScope());
    this.unloading = false;
    this._loaded = false;
    this._scopePushed = false;
    this._winCleanup = null;
    this._win = null;
    this._doc = null;
    this.hideCallback = null;
    this.useNativeMenu = Menu.useNativeMenu;
    this.showMacWritingTools = false;
    this._foldParents = new Map();
    this._openSubmenuPending = null;

    this.bgEl.addEventListener("mousedown", (event) => event.preventDefault());
    this.bgEl.addEventListener("click", () => this.hide());
    this.dom.addEventListener("mouseover", (event) => {
      if (host.isTouchSyntheticMouse && host.isTouchSyntheticMouse(event)) return;
      const target = event.target;
      const el = target && target.closest ? target.closest(".menu-item") : null;
      if (el && this.dom.contains(el)) this.selectElement(el, false);
    });

    const self = this;
    const key = (name, fn) => this.scope.register([], name, (event) => { fn.call(self, event); return false; });
    key("ArrowUp", this.onArrowUp);
    key("ArrowDown", this.onArrowDown);
    key("ArrowLeft", this.onArrowLeft);
    key("ArrowRight", this.onArrowRight);
    key("Enter", this.onEnter);
    key("Escape", () => this.hide());
  }

  Menu.useNativeMenu = false;

  /** Per-event cached menu; the show is scheduled on the event window's next tick. */
  Menu.forEvent = function (event) {
    if (event && event.preventDefault) event.preventDefault();
    if (!event || typeof event !== "object") {
      const m = new Menu();
      window.setTimeout(() => m.showAtMouseEvent(event || {}), 0);
      return m;
    }
    let menu = ng21ForEventCache.get(event);
    if (!menu) {
      menu = new Menu();
      ng21ForEventCache.set(event, menu);
      const win = (event && (event.win || (event.doc && event.doc.defaultView))) || window;
      win.setTimeout(() => menu.showAtMouseEvent(event), 0);
    }
    return menu;
  };

  const proto = Menu.prototype;

  proto.addItem = function (configure) {
    if (this._loaded) return this;
    const item = ng21MenuItemCtor ? ng21MenuItemCtor.create(this) : new host.MenuItem(this);
    if (configure) configure(item);
    this.items.push(item);
    return this;
  };

  proto.addSeparator = function () {
    if (this._loaded) return this;
    this.items.push(ng21MenuSepCtor ? new ng21MenuSepCtor(this) : new host.MenuSeparator(this));
    return this;
  };

  proto.addSections = function (names) {
    for (const name of names) {
      if (this.sections.includes(name)) continue;
      const at = this.sections.indexOf("");
      if (at >= 0) this.sections.splice(at, 0, name);
      else this.sections.push(name);
    }
    return this;
  };

  proto.setSectionSubmenu = function (name, config) {
    this.submenuConfigs.set(name, config || {});
    return this;
  };

  proto.setNoIcon = function () { this.dom.addClass("mod-no-icon"); return this; };
  proto.setUseNativeMenu = function (b) { this.useNativeMenu = !!b; return this; };
  proto.setShowMacWritingTools = function (b) { this.showMacWritingTools = !!b; return this; };
  proto.setParentElement = function (el) { this.parentEl = el; return this; };
  proto.onHide = function (cb) { this.hideCallback = cb; return this; };

  /** First `.`-separated part of a section name ("" stays ""). */
  proto._firstPart = function (name) { return name.split(".")[0]; };

  /** The submenu-config key a section folds into, or null (insertion order wins). */
  proto._foldKey = function (name) {
    for (const key of this.submenuConfigs.keys()) {
      if (name === key || name.startsWith(key + ".")) return key;
    }
    return null;
  };

  /** A separator belongs between two emitted groups unless one side is an undeclared "". */
  proto._needsSeparator = function (prevName, nextName) {
    if (this._firstPart(prevName) === this._firstPart(nextName)) return false;
    const emptyDeclared = this.sections.includes("");
    if (prevName === "" && !emptyDeclared) return false;
    if (nextName === "" && !emptyDeclared) return false;
    return true;
  };

  /**
   * Groups items by section, orders the groups (declared sections first, undeclared in
   * first-seen order, "" last unless declared), folds configured section prefixes into
   * submenu parents, then rebuilds scrollEl. Runs on every show.
   */
  proto.sort = function () {
    const CItem = ng21MenuItemCtor, CSep = ng21MenuSepCtor;
    // 1) unfold: restore folded children and drop parent rows from the item list
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (!it._ng21FoldParent) continue;
      const sub = it.submenu;
      if (sub) {
        for (const k of sub.items) {
          if (k._ng21FoldChild) {
            k._ng21FoldChild = false;
            k.menu = this;
            k.section = k._ng21FullSection;
            k._ng21FullSection = null;
            if (k.section) k.dom.setAttribute("data-section", k.section);
            else k.dom.removeAttribute("data-section");
          }
        }
        sub.items = [];
      }
      this.items.splice(i, 1);
    }
    // 2) group by section (first-seen order inside a group)
    const groups = new Map();
    const seen = [];
    for (const item of this.items) {
      if (item._ng21FoldParent) continue;
      const name = item.section || "";
      let g = groups.get(name);
      if (!g) { g = []; groups.set(name, g); seen.push(name); }
      g.push(item);
    }
    // 3) order group names
    const ordered = [];
    for (const s of this.sections) if (groups.has(s)) ordered.push(s);
    for (const s of seen) if (!this.sections.includes(s) && s !== "") ordered.push(s);
    if (groups.has("") && !this.sections.includes("")) ordered.push("");
    // 4) emit runs: a run is one section group or one merged fold run (name = key)
    const runs = [];
    let i = 0;
    while (i < ordered.length) {
      const name = ordered[i];
      const key = this._foldKey(name);
      if (key === null) { runs.push({ name, key: null, names: [name] }); i++; continue; }
      const names = [];
      while (i < ordered.length && this._foldKey(ordered[i]) === key) { names.push(ordered[i]); i++; }
      runs.push({ name: key, key, names });
    }
    // 5) build parent items + distribute folded children into their submenus
    for (const run of runs) {
      if (run.key === null) { run.entries = groups.get(run.names[0]); continue; }
      const cfg = this.submenuConfigs.get(run.key) || {};
      let parent = this._foldParents.get(run.key);
      if (!parent) {
        parent = CItem ? CItem.create(this) : new host.MenuItem(this);
        parent._ng21FoldParent = true;
        parent.setSubmenu();
        this._foldParents.set(run.key, parent);
      }
      parent.setTitle(cfg.title || run.key);
      if (cfg.icon) parent.setIcon(cfg.icon); else parent.removeIcon();
      parent.setDisabled(!!cfg.disabled);
      parent.setSection(run.key);
      const sub = parent.submenu;
      sub.items = [];
      let first = true;
      for (const gname of run.names) {
        const remainder = gname === run.key ? "" : gname.slice(run.key.length + 1);
        if (!first && CSep) sub.items.push(new CSep(sub));
        first = false;
        for (const it of groups.get(gname)) {
          it._ng21FoldChild = true;
          it._ng21FullSection = it.section;
          it.section = remainder;
          it.menu = sub;
          if (remainder) it.dom.setAttribute("data-section", remainder);
          else it.dom.removeAttribute("data-section");
          sub.items.push(it);
        }
      }
      // insert the parent row just before its first folded child
      const firstKid = this.items.find((it) => it._ng21FoldChild && groups.get(run.names[0]) && run.names[0] === it._ng21FullSection);
      const at = firstKid ? this.items.indexOf(firstKid) : this.items.length;
      if (!this.items.includes(parent)) this.items.splice(at, 0, parent);
      run.entries = [parent];
    }
    // 6) DOM rebuild + trailing separator trim
    const scroll = this.scrollEl;
    while (scroll.firstChild) scroll.firstChild.remove();
    let groupEl = null;
    let prevName = null;
    const openGroup = () => { if (!groupEl) { groupEl = scroll.createDiv("menu-group"); } };
    for (const run of runs) {
      if (prevName !== null && this._needsSeparator(prevName, run.name)) {
        const sep = CSep ? new CSep(this) : new host.MenuSeparator(this);
        scroll.appendChild(sep.dom);
        groupEl = null;
      }
      prevName = run.name;
      for (const entry of run.entries) {
        if (entry instanceof (CSep || host.MenuSeparator)) { scroll.appendChild(entry.dom); groupEl = null; continue; }
        openGroup();
        groupEl.appendChild(entry.dom);
      }
    }
    // drop trailing separators (display-level: rebuild without them)
    while (scroll.lastChild && scroll.lastChild.classList.contains("menu-separator")) scroll.lastChild.remove();
    // a trailing .menu-group left empty by the trim is removed too
    while (scroll.lastChild && scroll.lastChild.classList.contains("menu-group") && !scroll.lastChild.firstChild) scroll.lastChild.remove();
    while (scroll.firstChild && scroll.firstChild.classList.contains("menu-group") && !scroll.firstChild.firstChild) scroll.firstChild.remove();
  };

  // ---------- selection & keyboard ----------

  proto._isSelectable = function (item) {
    return !!(item && item.dom && !item._ng21FoldChild && !(ng21MenuSepCtor && item instanceof ng21MenuSepCtor) && !item.disabled);
  };

  proto.select = function (i) {
    const items = this.items;
    if (i < 0) i = 0;
    if (i >= items.length) i = items.length - 1;
    for (const it of items) if (it.dom) it.dom.removeClass("selected");
    this.selected = i;
    const it = items[i];
    if (it && it.dom) {
      it.dom.addClass("selected");
      if (it.dom.scrollIntoView) it.dom.scrollIntoView({ block: "nearest" });
    }
  };

  proto.unselect = function () {
    this.selected = null;
    for (const it of this.items) if (it.dom) it.dom.removeClass("selected");
    this.closeSubmenu();
  };

  proto.selectFirstEnabled = function () {
    for (let i = 0; i < this.items.length; i++) {
      if (this._isSelectable(this.items[i])) { this.select(i); return; }
    }
    this.selected = null;
  };

  proto._stepSelection = function (dir) {
    const items = this.items;
    if (!items.length) return;
    let i = this.selected == null ? (dir > 0 ? -1 : items.length) : this.selected;
    for (let n = 0; n < items.length; n++) {
      i += dir;
      if (i < 0) i = items.length - 1;
      else if (i >= items.length) i = 0;
      if (this._isSelectable(items[i])) { this.select(i); return; }
    }
  };

  proto.onArrowUp = function (event) { if (event) event.preventDefault && event.preventDefault(); this._stepSelection(-1); };
  proto.onArrowDown = function (event) { if (event) event.preventDefault && event.preventDefault(); this._stepSelection(1); };

  proto.onArrowRight = function (event) {
    if (event) event.preventDefault && event.preventDefault();
    const it = this.selected != null ? this.items[this.selected] : null;
    if (it && it.submenu && !it.disabled) {
      this.openSubmenu(it);
      it.submenu.selectFirstEnabled();
    }
  };

  proto.onArrowLeft = function (event) {
    if (event) event.preventDefault && event.preventDefault();
    this.hide();
  };

  proto.onEnter = function (event) {
    if (event) event.preventDefault && event.preventDefault();
    const it = this.selected != null ? this.items[this.selected] : null;
    if (!it || it.disabled || it.dom.hasClass("is-label")) return;
    if (it.submenu) { this.openSubmenu(it); it.submenu.selectFirstEnabled(); return; }
    it.handleEvent(event);
    this.hide();
  };

  // ---------- submenus ----------

  proto._cancelPendingSubmenu = function () {
    if (this._openSubmenuPending) { this._openSubmenuPending.cancel(); this._openSubmenuPending = null; }
  };

  proto.selectElement = function (el, openNow) {
    const idx = this.items.findIndex((it) => it.dom === el);
    if (idx < 0) return;
    this.select(idx);
    const item = this.items[idx];
    if (item && item.submenu && !item.disabled) {
      if (openNow) { this._cancelPendingSubmenu(); this.openSubmenu(item); }
      else {
        this._cancelPendingSubmenu();
        this._openSubmenuPending = debounceCall(() => { this._openSubmenuPending = null; this.openSubmenu(item); }, 250);
      }
    } else {
      this._cancelPendingSubmenu();
    }
  };

  proto.openSubmenu = function (item) {
    if (!item || item.disabled || !item.submenu) return;
    const sub = item.submenu;
    if (this.currentSubmenu === sub) return;
    if (this.selected != null && this.items[this.selected] !== item) return;
    this.closeSubmenu();
    const rect = item.dom.getBoundingClientRect();
    const cs = getComputedStyle(this.dom);
    const px = (v) => parseFloat(v) || 0;
    const left = px(cs.paddingLeft) + px(cs.borderLeftWidth);
    const right = px(cs.paddingRight) + px(cs.borderRightWidth);
    const top = px(cs.paddingTop) + px(cs.borderTopWidth);
    const pos = { x: rect.left - left + 2, y: rect.top - top + 2, width: rect.width + left + right };
    const doc = this.dom.ownerDocument || env().activeDocument;
    sub.parentMenu = this;
    sub.showAtPosition(pos, doc);
    this.currentSubmenu = sub;
    item.dom.addClass("is-active");
  };

  proto.closeSubmenu = function () {
    this._cancelPendingSubmenu();
    const sub = this.currentSubmenu;
    if (sub) sub.hide();
    this.currentSubmenu = null;
    for (const it of this.items) if (it.dom) it.dom.removeClass("is-active");
  };

  // ---------- showing ----------

  proto.showAtMouseEvent = function (event) {
    const x = event && event.clientX != null ? event.clientX : 0;
    const y = event && event.clientY != null ? event.clientY : 0;
    return this.showAtPosition({ x, y }, event && event.doc);
  };

  proto.showAtPosition = function (position, doc) {
    if (this._loaded || this.dom.parentNode) this.close();
    if (this.items.length === 0) return this;
    doc = doc || env().activeDocument || document;
    let win = doc.defaultView || window;
    // menus anchored inside an iframe are positioned in top-window coordinates
    if (win !== window && host.frameOffset) {
      const frame = host.frameOffset(win);
      if (frame) {
        position = { x: position.x * frame.scale + frame.x, y: position.y * frame.scale + frame.y, width: position.width, left: position.left };
        win = window;
        doc = document;
      }
    }
    this._win = win;
    this._doc = doc;
    ng21EnsurePopstate(win);

    if (this.parentEl) {
      this.parentEl.addClass("has-active-menu");
      if (host.watchElementGone) host.watchElementGone(this.parentEl, 500, () => this.hide());
    }
    this.sort();
    if (host.hideTooltip) host.hideTooltip();

    if (this.useNativeMenu && host.Platform.isDesktop) {
      this._showNative(position, win);
      return undefined;
    }

    host.registerOpenModal(this);
    this._loaded = true;
    const body = doc.body;
    body.appendChild(this.dom);
    body.appendChild(this.bgEl);

    if (host.Platform.isMobileApp) {
      this._showPhone(position);
    } else {
      this._placeDesktop(position, win);
    }

    ng21ActiveMenu = this;
    const self = this;
    win.setTimeout(() => self.load(), 0);
    return this;
  };

  /** Desktop placement: measure, fit inside the viewport, scroll with the wheel. */
  proto._placeDesktop = function (position, win) {
    const dom = this.dom;
    const width = dom.offsetWidth, height = dom.offsetHeight;
    const viewWidth = win.innerWidth, viewHeight = win.innerHeight;
    let rightEdge, leftEdge;
    if (position.width != null) {
      if (position.overlap) { rightEdge = position.x; leftEdge = position.x + position.width; }
      else { rightEdge = position.x + position.width; leftEdge = position.x; }
    } else { rightEdge = position.x + 2; leftEdge = position.x - 2; }
    let left;
    if (rightEdge + width > viewWidth || (position.left && leftEdge - width >= 0)) {
      left = Math.max(0, leftEdge - width);
    } else {
      left = rightEdge;
    }
    let top = position.y + 2;
    if (position.y + height > viewHeight) {
      const bs = getComputedStyle(this._doc.body);
      const pad = parseFloat(bs.paddingTop) || 0;
      const sat = parseFloat(bs.getPropertyValue("--safe-area-inset-top")) || 0;
      top = Math.max(pad + sat, position.y - height);
    }
    dom.style.left = left + "px";
    dom.style.top = top + "px";
    if (host.scrollWithPointer) host.scrollWithPointer(this.scrollEl);
    this.bgEl.style.opacity = "0.85";
  };

  /** Phone placement: full-width bottom sheet sliding up. */
  proto._showPhone = function (position) {
    const dom = this.dom, bg = this.bgEl;
    if (host.keyboard && host.keyboard.hide) host.keyboard.hide();
    dom.style.left = "";
    dom.style.top = "";
    const height = dom.offsetHeight || dom.scrollHeight || 300;
    dom.style.transition = "transform 150ms var(--anim-motion-swing), opacity 150ms var(--anim-motion-swing)";
    bg.style.transition = "opacity 150ms linear";
    dom.style.transform = `translateY(${height}px)`;
    bg.style.opacity = "0";
    requestAnimationFrame(() => {
      dom.style.transform = "translateY(0)";
      bg.style.opacity = "0.85";
    });
  };

  /** Deferred once-per-show wiring: outside clicks, context menu, scope. */
  proto.load = function () {
    if (this._winCleanup || !this._loaded) return;
    const win = this._win || window;
    ng21PushScope(this.scope);
    this._scopePushed = true;
    const onMouseDown = (event) => {
      if (this.parentEl && event.target && !this.parentEl.contains(event.target)) this.hide();
    };
    const onClick = (event) => {
      const target = event.targetNode || event.target;
      if (target && !this.isInside(target)) this.hide();
    };
    const onContext = () => { if (host.Platform.isDesktop) this.hide(); };
    win.addEventListener("mousedown", onMouseDown, true);
    win.addEventListener("click", onClick, true);
    if (host.Platform.isDesktop) win.addEventListener("contextmenu", onContext, true);
    this._winCleanup = () => {
      win.removeEventListener("mousedown", onMouseDown, true);
      win.removeEventListener("click", onClick, true);
      win.removeEventListener("contextmenu", onContext, true);
    };
  };

  proto.unload = function () {
    if (this._scopePushed) { ng21PopScope(this.scope); this._scopePushed = false; }
    this._loaded = false;
    if (this._winCleanup) { this._winCleanup(); this._winCleanup = null; }
  };

  proto.isInside = function (node) {
    if (!node) return false;
    if (this.dom === node || this.dom.contains(node)) return true;
    if (this.parentMenu && this.parentMenu.isInside(node)) return true;
    if (this.currentSubmenu && this.currentSubmenu.isInside(node)) return true;
    return false;
  };

  // ---------- hiding ----------

  proto.hide = function () { this.close(); };

  proto.close = function () {
    this.unload();
    if (this.unloading) return;
    this.unloading = true;
    try {
      host.unregisterOpenModal(this);
      this.unselect();
      this.closeSubmenu();
      if (this.parentMenu) {
        if (ng21ActiveMenu === this) ng21ActiveMenu = this.parentMenu;
        if (this.parentMenu.currentSubmenu === this) this.parentMenu.currentSubmenu = null;
      } else if (ng21ActiveMenu === this) {
        ng21ActiveMenu = null;
      }
      const parent = this.parentMenu;
      this.parentMenu = null;
      if (this.parentEl) this.parentEl.removeClass("has-active-menu");
      const shown = this.dom.parentNode != null;
      const phone = host.Platform.isMobileApp && shown;
      const finish = () => {
        if (this.dom.parentNode) this.dom.remove();
        if (this.bgEl.parentNode) this.bgEl.remove();
        if (this.hideCallback) { const cb = this.hideCallback; this.hideCallback = null; cb(); }
      };
      if (phone) {
        const h = this.dom.offsetHeight || 200;
        this.dom.style.transition = "transform 150ms var(--anim-motion-swing)";
        this.bgEl.style.transition = "opacity 150ms linear";
        this.dom.style.transform = `translateY(${h}px)`;
        this.bgEl.style.opacity = "0";
        setTimeout(finish, 160);
      } else {
        finish();
      }
    } finally {
      this.unloading = false;
    }
  };

  /** Electron-native popup path (desktop + useNativeMenu). */
  proto._showNative = function (position, win) {
    const CSep = ng21MenuSepCtor;
    const esc = (s) => String(s).replace(/&(?!&|\w)/g, "&&");
    const template = (menu) => {
      menu.sort();
      const out = [];
      for (const item of menu.items) {
        if (item._ng21FoldChild) continue;
        if (CSep && item instanceof CSep) { out.push({ type: "separator" }); continue; }
        if (!item.dom) continue;
        const entry = {
          label: esc(item.titleEl ? item.titleEl.textContent : ""),
          enabled: !item.disabled && !item.dom.hasClass("is-label"),
        };
        if (item.checked !== false && item.checked !== null && item.checked !== undefined) {
          entry.checked = !!item.checked;
          if (typeof item.checked === "boolean") entry.type = "checkbox";
        }
        entry.click = () => item.handleEvent(new MouseEvent("click"));
        if (item.submenu) entry.submenu = template(item.submenu);
        out.push(entry);
      }
      return out;
    };
    try {
      env().Of((electron) => {
        const tpl = template(this);
        const eMenu = electron.Menu.buildFromTemplate(tpl);
        const contents = win.electronWindow && win.electronWindow.webContents;
        const zoom = contents ? contents.getZoomLevel() : 0;
        const factor = Math.round(Math.pow(1.2, zoom) * 100) / 100 || 1;
        const x = Math.round(position.x * factor);
        const y = Math.round(position.y * factor);
        const opts = { x, y, window: win.electronWindow || undefined };
        if (this.showMacWritingTools && contents && contents.focusedFrame) opts.frame = contents.focusedFrame;
        eMenu.once("menu-will-close", () => this.hide());
        eMenu.popup(opts);
      });
    } catch (e) {
      console.error(e);
      this._placeDesktop(position, win);
      this.bgEl.style.opacity = "0.85";
      ng21ActiveMenu = this;
      const self = this;
      win.setTimeout(() => self.load(), 0);
      this.dom && this.dom.parentNode === null && win.document.body.appendChild(this.dom);
      this.bgEl.parentNode === null && win.document.body.appendChild(this.bgEl);
    }
  };

  return Menu;
}
