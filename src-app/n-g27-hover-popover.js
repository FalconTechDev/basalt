// g27 hover-popover: HoverPopover (orig rX) — delayed floating preview with a
// shared global tracker (pending + shown lists, pointer poll, global click).
import { inherit, methods } from "./n-g27-inherit.js";
import { runTransition } from "./animation.js";

export function defineHoverPopover(host) {

  // ---- shared tracker (module singleton, shared by every instance) --------
  const pending = [];
  const shown = [];
  let pointer = null;      // {x, y, doc} of the last tracked mousemove
  let pollTimer = 0;
  let tracking = false;

  function trackPointer(event) {
    const target = event.targetNode || event.target;
    pointer = {
      x: event.clientX,
      y: event.clientY,
      doc: event.doc || (target && target.ownerDocument) || document,
    };
  }

  function onGlobalClick(event) {
    for (const pop of pending.slice()) pop.hide();
    const target = event.targetNode || event.target;
    const win = event.win
      || (target && target.ownerDocument && target.ownerDocument.defaultView)
      || window;
    for (const pop of shown.slice()) {
      let keep = pop.isFocused;
      if (!keep && target) {
        keep = pop.hoverEl.contains(target);
        if (!keep) {
          for (const child of pop.childHovers) {
            if (child.hoverEl.contains(target)) { keep = true; break; }
          }
        }
      }
      if (!keep) win.setTimeout(() => pop.hide(), 5);
    }
  }

  function poll() {
    if (!pointer) return;
    const under = pointer.doc.elementFromPoint(pointer.x, pointer.y);
    for (const pop of shown.slice()) {
      pop.detect(under);
      pop.transition();
    }
  }

  function ensureTracking() {
    if (tracking) return;
    tracking = true;
    window.addEventListener("click", onGlobalClick, true);
    window.addEventListener("contextmenu", onGlobalClick, true);
    window.addEventListener("mousemove", trackPointer);
    pollTimer = window.setInterval(poll, 500);
  }

  function stopTracking() {
    if (!tracking) return;
    tracking = false;
    window.removeEventListener("click", onGlobalClick, true);
    window.removeEventListener("contextmenu", onGlobalClick, true);
    window.removeEventListener("mousemove", trackPointer);
    window.clearInterval(pollTimer);
    pollTimer = 0;
    pointer = null;
  }

  // ---- the popover ---------------------------------------------------------

  function HoverPopover(parent, targetEl, waitTime, staticPos) {
    const self = host.Component.call(this) || this;
    self.parent = parent;
    self.targetEl = targetEl;
    self.waitTime = waitTime === undefined ? 300 : waitTime;
    self.staticPos = staticPos || null;
    self.onTarget = true;
    self.onHover = false;
    self.isFocused = false;
    self.state = host.PopoverState.Showing;
    self.timer = 0;
    self.observer = null;
    self.hoverEl = createDiv("popover hover-popover");
    self._targetIn = (event) => self.onMouseIn(event);
    self._targetOut = (event) => self.onMouseOut(event);
    self._hoverIn = (event) => {
      if (host.pointerEntered(event, self.hoverEl)) {
        self.onHover = true;
        self.transition();
      }
    };
    self._hoverOut = (event) => {
      if (host.pointerEntered(event, self.hoverEl)) {
        self.onHover = false;
        self.transition();
      }
    };
    if (targetEl) {
      targetEl.addEventListener("mouseover", self._targetIn);
      targetEl.addEventListener("mouseout", self._targetOut);
    }
    self.hoverEl.addEventListener("mouseover", self._hoverIn);
    self.hoverEl.addEventListener("mouseout", self._hoverOut);
    self.timer = host.activeWindow.setTimeout(() => {
      self.timer = 0;
      self.show();
    }, self.waitTime);
    pending.push(self);
    ensureTracking();
    return self;
  }
  inherit(HoverPopover, host.Component);

  methods(HoverPopover, {

    onMouseIn(event) {
      if (this.targetEl && !host.pointerEntered(event, this.targetEl)) return;
      this.onTarget = true;
      this.transition();
    },

    onMouseOut(event) {
      if (this.targetEl && !host.pointerEntered(event, this.targetEl)) return;
      this.onTarget = false;
      this.transition();
    },

    detect(el) {
      const targetEl = this.targetEl;
      if (targetEl) this.onTarget = el === targetEl || targetEl.contains(el);
      this.onHover = el === this.hoverEl || this.hoverEl.contains(el);
    },

    shouldShow() {
      return this.shouldShowSelf() || this.shouldShowChild();
    },

    shouldShowSelf() {
      const doc = this.hoverEl.doc || this.hoverEl.ownerDocument || document;
      return this.onTarget || this.onHover || this.isFocused || this.hoverEl.contains(doc.activeElement);
    },

    shouldShowChild() {
      for (const child of this.childHovers) if (child.shouldShow()) return true;
      return false;
    },

    setIsFocused(focused) {
      this.isFocused = focused;
    },

    clearTimer() {
      if (this.timer) {
        host.activeWindow.clearTimeout(this.timer);
        this.timer = 0;
      }
    },

    transition() {
      const wanted = this.shouldShow();
      if (wanted) {
        if (this.state === host.PopoverState.Hiding) {
          this.state = host.PopoverState.Shown;
          this.clearTimer();
        }
        return;
      }
      if (this.state === host.PopoverState.Showing) {
        this.hide();
        return;
      }
      if (this.state === host.PopoverState.Shown) {
        this.state = host.PopoverState.Hiding;
        this.timer = host.activeWindow.setTimeout(() => {
          this.timer = 0;
          if (this.shouldShow()) this.transition();
          else this.hide();
        }, this.waitTime);
      }
    },
  });

  methods(HoverPopover, {

    show() {
      const targetEl = this.targetEl;
      if (targetEl) {
        const doc = targetEl.doc || targetEl.ownerDocument || document;
        if (!doc.body.contains(targetEl)) {
          this.hide();
          return;
        }
      }
      this.state = host.PopoverState.Shown;
      this.timer = 0;
      this.position();
      this.onShow();
      const pi = pending.indexOf(this);
      if (pi >= 0) pending.splice(pi, 1);
      if (shown.indexOf(this) < 0) shown.push(this);
      ensureTracking();
      this.load();
      runTransition(
        this.hoverEl,
        new host.Transition({ fn: "var(--anim-motion-swing)", duration: 80 }).addProp("opacity", "0", "1", "")
      );
    },

    hide() {
      this.state = host.PopoverState.Hidden;
      const pi = pending.indexOf(this);
      if (pi >= 0) pending.splice(pi, 1);
      const si = shown.indexOf(this);
      if (si >= 0) shown.splice(si, 1);
      if (!pending.length && !shown.length) stopTracking();
      this.clearTimer();
      this.hoverEl.detach();
      const targetEl = this.targetEl;
      if (targetEl) {
        targetEl.removeEventListener("mouseover", this._targetIn);
        targetEl.removeEventListener("mouseout", this._targetOut);
      }
      this.onTarget = true;
      this.onHover = false;
      const hoverEl = this.hoverEl;
      for (const pop of shown.slice()) {
        if (pop === this) continue;
        if (pop.targetEl && hoverEl.contains(pop.targetEl) && !pop.shouldShowSelf()) pop.hide();
      }
      this.onHide();
      this.unload();
    },

    onShow() {
      const prev = this.parent && this.parent.hoverPopover;
      if (prev && prev !== this) prev.hide();
      if (this.parent) this.parent.hoverPopover = this;
      host.hideTooltip();
    },

    onHide() {
      if (this.parent && this.parent.hoverPopover === this) this.parent.hoverPopover = null;
    },
  });

  methods(HoverPopover, {

    position() {
      const targetEl = this.targetEl;
      const point = (p) => ({ top: p.y - 10, bottom: p.y + 10, left: p.x, right: p.x });
      let rect;
      if (this.staticPos) {
        rect = point(this.staticPos);
      } else if (targetEl) {
        if (targetEl.offsetHeight > 300 && pointer) {
          this.staticPos = { x: pointer.x, y: pointer.y };
          rect = point(this.staticPos);
        } else {
          const box = targetEl.getBoundingClientRect();
          rect = {
            top: box.top,
            bottom: box.top + targetEl.offsetHeight,
            left: box.left,
            right: box.left + targetEl.offsetWidth,
          };
        }
      } else if (pointer) {
        rect = point(pointer);
      } else {
        rect = { top: 0, bottom: 0, left: 0, right: 0 };
      }
      const win = targetEl
        ? (targetEl.win || (targetEl.ownerDocument && targetEl.ownerDocument.defaultView) || window)
        : ((pointer && pointer.doc && pointer.doc.defaultView) || window);
      let rtl = false;
      if (targetEl) {
        try { rtl = win.getComputedStyle(targetEl).direction === "rtl"; } catch (e) { /* cross-window */ }
      }
      const mapped = host.rectInTopWindow(rect, win) || { rect, win };
      const topWin = mapped.win || win;
      topWin.document.body.appendChild(this.hoverEl);
      host.positionNear(mapped.rect || rect, this.hoverEl, {
        gap: 10,
        preventOverlap: true,
        horizontalAlignment: rtl ? "right" : "left",
      });
    },

    watchResize(el) {
      if (!this.observer) {
        let fires = 0;
        const self = this;
        this.observer = new ResizeObserver(() => {
          if (self.state !== host.PopoverState.Shown) return;
          self.position();
          fires++;
          if (fires >= 10) {
            self.observer.disconnect();
            self.observer = null;
          }
        });
      }
      this.observer.observe(el);
    },

    onunload() {
      host.Component.prototype.onunload.call(this);
      if (this.observer) {
        this.observer.disconnect();
        this.observer = null;
      }
    },
  });

  Object.defineProperty(HoverPopover.prototype, "childHovers", {
    get() {
      const hoverEl = this.hoverEl;
      return shown.filter((pop) => pop !== this && pop.targetEl && hoverEl.contains(pop.targetEl));
    },
  });

  return HoverPopover;
}