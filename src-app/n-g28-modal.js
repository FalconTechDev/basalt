// g28 Modal base class (spec g28 Part E): dialog skeleton, scope, backdrop,
// selection save/restore, open-modal registry, mobile swipe-to-dismiss.
// Written as a constructor function so both `new Modal(app)` and the
// ES5-style `Modal.call(this, app)` subclassing used across the codebase work.
import { runTransition, cancelTransition } from "./animation.js";
import { ng28ActiveDocument, ng28ActiveWindow, ng28El } from "./n-g28-dom.js";

const ng28ModalCache = new WeakMap();

function ng28Clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function ng28DefineModalImpl(host) {
  function Modal(app) {
    const self = this;
    self.app = app;
    self.shouldRestoreSelection = true;
    self.selection = null;
    self.win = null;
    self.shouldAnimate = true;
    self.dimBackground = true;
    self.bgOpacity = "0.85";
    self.onCloseCallback = undefined;
    self.onWindowClose = self.onWindowClose.bind(self);

    const doc = ng28ActiveDocument();
    self.containerEl = ng28El(doc, "div", "modal-container");
    self.bgEl = ng28El(doc, "div", "modal-bg");
    self.modalEl = ng28El(doc, "div", "modal");
    self.containerEl.appendChild(self.bgEl);
    self.containerEl.appendChild(self.modalEl);

    const closeBtn = ng28El(doc, "div", "modal-close-button mod-raised clickable-icon");
    host.setIcon(closeBtn, "x");
    closeBtn.addEventListener("click", () => self.close());
    self.modalEl.appendChild(closeBtn);

    const headerEl = ng28El(doc, "div", "modal-header");
    self.titleEl = ng28El(doc, "div", "modal-title");
    headerEl.appendChild(self.titleEl);
    self.modalEl.appendChild(headerEl);
    self.headerEl = headerEl;

    self.contentEl = ng28El(doc, "div", "modal-content");
    self.modalEl.appendChild(self.contentEl);

    self.scope = new host.Scope(null);
    self.scope.register([], "Escape", (event) => self.onEscapeKey(event));
    self.scope.setTabFocusContainerEl(self.containerEl);

    // backdrop dismissal rules per platform
    if (host.Platform.isDesktopApp && host.Platform.isMacOS) {
      let downX = 0, downY = 0;
      self.bgEl.addEventListener("mousedown", (event) => { downX = event.screenX; downY = event.screenY; });
      self.bgEl.addEventListener("click", (event) => {
        if (Math.abs(event.screenX - downX) < 5 && Math.abs(event.screenY - downY) < 5) self.onClickOutside(event);
      });
    } else {
      self.bgEl.addEventListener("click", (event) => self.onClickOutside(event));
    }

    if (host.Platform.isMobile) {
      host.onSwipe(self.titleEl, (gesture) => {
        if (gesture.points !== 1 || gesture.direction !== "y") return;
        gesture.registerCallback({
          move(_event, y) {
            const height = self.modalEl.offsetHeight;
            const fraction = ng28Clamp((y - gesture.startY) / height, 0, 1);
            self.modalEl.style.transform = "translateY(" + fraction * height + "px)";
            self.bgEl.style.opacity = String(1 - fraction);
          },
          cancel() {
            self.modalEl.style.transform = "";
            self.bgEl.style.opacity = "";
          },
          finish(_event, y, velocity) {
            const height = self.modalEl.offsetHeight;
            const fraction = ng28Clamp((y - gesture.startY) / height, 0, 1);
            if (velocity < height / 2) {
              runTransition(self.modalEl, new host.Transition({ duration: 150 * fraction }).addProp("transform", null, "translateY(0)", ""));
              runTransition(self.bgEl, new host.Transition({ duration: 150 * fraction, fn: "linear" }).addProp("opacity", null, "1", ""));
            } else {
              const remaining = 1 - fraction;
              runTransition(self.modalEl, new host.Transition({ duration: 150 * remaining, fn: "ease-out" }).addProp("transform", null, "translateY(" + height + "px)", ""), () => self.close());
              runTransition(self.bgEl, new host.Transition({ duration: 150 * remaining, fn: "linear" }).addProp("opacity", null, "0", ""));
            }
          },
        });
      });
    }
  }

  Modal.prototype.onOpen = function () {};
  Modal.prototype.onClose = function () {};
  Modal.prototype.onWindowClose = function () { this.close(); };

  Modal.prototype.onClickOutside = function (event) {
    if (!event.defaultPrevented) this.close();
  };

  Modal.prototype.onEscapeKey = function (event) {
    if (!event.defaultPrevented) this.close();
  };

  Modal.prototype.setTitle = function (title) {
    this.titleEl.textContent = title;
    return this;
  };

  Modal.prototype.setContent = function (content) {
    if (typeof content === "string") this.contentEl.textContent = content;
    else this.contentEl.appendChild(content);
    return this;
  };

  Modal.prototype.setBackgroundOpacity = function (opacity) {
    this.bgOpacity = opacity;
    return this;
  };

  Modal.prototype.setCloseCallback = function (callback) {
    this.onCloseCallback = callback;
    return this;
  };

  Modal.prototype.setDimBackground = function (dim) {
    this.dimBackground = dim;
    return this;
  };

  Modal.prototype.animateOpen = async function () {
    const body = this.win ? this.win.document.body : document.body;
    body.classList.add("hide-cursor");
    try {
      await host.slideModalIn(this.modalEl);
    } finally {
      body.classList.remove("hide-cursor");
    }
  };

  Modal.prototype.animateClose = async function () {
    const body = this.win ? this.win.document.body : document.body;
    body.classList.add("hide-cursor");
    try {
      await host.slideModalOut(this.modalEl);
    } finally {
      body.classList.remove("hide-cursor");
    }
  };

  Modal.prototype.open = function () {
    if (this.containerEl.parentNode) return;
    const win = ng28ActiveWindow();
    this.win = win;
    if (this.shouldRestoreSelection) this._captureSelection(win);
    host.blurAndClearSelection(win);
    this.app.keymap.pushScope(this.scope);
    win.document.body.appendChild(this.containerEl);
    if (host.Platform.isPhone) cancelTransition(this.modalEl);
    this.onOpen();
    this.containerEl.classList.toggle("mod-dim", !!this.dimBackground);
    if (host.Platform.isPhone) this.animateOpen();
    else this.bgEl.style.opacity = this.dimBackground ? this.bgOpacity : "0";
    host.closeAllMenus();
    host.registerOpenModal(this);
    if (host.Platform.hasPhysicalKeyboard) host.focusElement(this.modalEl, { preventScroll: true });
    if (win !== window) win.addEventListener("beforeunload", this.onWindowClose);
  };

  Modal.prototype.close = function () {
    const self = this;
    const win = self.win || ng28ActiveWindow();
    self.app.keymap.popScope(self.scope);
    const finish = () => {
      if (self.containerEl.parentNode) self.containerEl.parentNode.removeChild(self.containerEl);
      self.onClose();
      if (self.onCloseCallback) self.onCloseCallback.call(self);
      host.unregisterOpenModal(self);
      if (self.shouldRestoreSelection) self._restoreSelection(win);
      if (win !== window) win.removeEventListener("beforeunload", self.onWindowClose);
      self.win = null;
    };
    if (host.Platform.isPhone) self.animateClose().then(finish, finish);
    else finish();
  };

  /** Remembers the focused element and selection range (when inside it). */
  Modal.prototype._captureSelection = function (win) {
    const doc = win.document;
    let active = doc.activeElement;
    if (active && active.tagName === "IFRAME" && active.contentDocument) {
      active = active.contentDocument.activeElement;
    }
    if (!active || active === doc.body) active = null;
    let range = null;
    const sel = doc.getSelection ? doc.getSelection() : null;
    if (sel && sel.rangeCount > 0 && active) {
      const r = sel.getRangeAt(0);
      const ancestor = r.commonAncestorContainer;
      const inside = ancestor === active || (typeof active.contains === "function" && active.contains(ancestor));
      if (inside) range = r.cloneRange ? r.cloneRange() : r;
    }
    this.selection = { win, active, range };
  };

  Modal.prototype._restoreSelection = function (win) {
    const saved = this.selection;
    this.selection = null;
    if (!saved) return;
    const selWin = saved.win || win;
    try { selWin.focus(); } catch (e) { /* pop-out may be gone */ }
    const doc = selWin.document;
    const inWindow = (node) => host.nodeInWindow(selWin, node);
    if (saved.range && saved.active) {
      const isEditor = saved.active.classList && saved.active.classList.contains("cm-content");
      if (!isEditor && inWindow(saved.range.startContainer) && inWindow(saved.range.endContainer)) {
        const sel = doc.getSelection ? doc.getSelection() : null;
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(saved.range);
        }
      }
    }
    const focusEl = saved.active;
    if (focusEl) {
      const isEl = focusEl.instanceOf
        ? focusEl.instanceOf(selWin.HTMLElement) || focusEl.instanceOf(selWin.SVGElement)
        : (focusEl instanceof selWin.HTMLElement || focusEl instanceof selWin.SVGElement);
      if (isEl && inWindow(focusEl)) {
        host.focusElement(focusEl, { preventScroll: true });
      }
    }
  };

  return Modal;
}

/** The Modal class for a host; cached so DialogModal extends the same constructor. */
export function ng28ModalFor(host) {
  let Modal = ng28ModalCache.get(host);
  if (!Modal) {
    Modal = ng28DefineModalImpl(host);
    ng28ModalCache.set(host, Modal);
  }
  return Modal;
}

/** Manifest entry tb -> Modal. */
export function defineModal(host) {
  return ng28ModalFor(host);
}
