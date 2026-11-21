// g28 Notice toasts (spec g28 Part D): stacked corner messages per window.
import { runTransition } from "./animation.js";
import { ng28ActiveWindow, ng28Detach, ng28El, ng28IsShown } from "./n-g28-dom.js";

/** .notice-container elements keyed by their window. */
const ng28NoticeContainers = new Map();

function ng28ContainerFor(win) {
  let container = ng28NoticeContainers.get(win);
  if (container && container.isConnected !== false && container.parentNode) return container;
  container = ng28El(win.document, "div", "notice-container");
  win.document.body.appendChild(container);
  ng28NoticeContainers.set(win, container);
  return container;
}

function ng28CleanupContainer(el) {
  const container = el.parentNode;
  ng28Detach(el);
  if (container && !container.querySelector(".notice")) ng28Detach(container);
}

/** Manifest entry fb -> Notice. */
export function defineNotice(host) {
  function Notice(message, duration = 4000) {
    const win = ng28ActiveWindow();
    this.win = win;
    this.containerEl = ng28El(win.document, "div", "notice");
    ng28ContainerFor(win).appendChild(this.containerEl);
    this.messageEl = this.noticeEl = ng28El(win.document, "div", "notice-message");
    this.containerEl.appendChild(this.messageEl);
    this.timerId = -1;
    this.buttonContainerEl = null;
    this.hovered = false;
    this.autoHide = duration;
    this.setMessage(message);
    // slide in from off-screen
    const offscreen = host.Platform.isMobile ? "translateY(100%)" : "translateX(350px)";
    runTransition(this.containerEl, new host.Transition().addProp("transform", offscreen, "", ""));
    this.setAutoHide(duration);
    const self = this;
    this.containerEl.addEventListener("click", () => self.hide());
    this.containerEl.addEventListener("mouseenter", () => {
      self.hovered = true;
      if (self.timerId !== -1) { self.win.clearTimeout(self.timerId); self.timerId = -1; }
    });
    this.containerEl.addEventListener("mouseleave", () => {
      self.hovered = false;
      if (self.autoHide && self.timerId === -1) {
        self.timerId = self.win.setTimeout(() => self.hide(), 1000);
      }
    });
    if (host.Platform.isPhone) {
      host.swipeToDismiss(this.containerEl, this.containerEl, null, () => {
        ng28CleanupContainer(this.containerEl);
        this.hide();
      });
    }
  }

  Notice.prototype.setMessage = function (message) {
    const el = this.messageEl;
    if (typeof message === "string") {
      el.textContent = message;
    } else {
      el.textContent = "";
      if (message) el.appendChild(message);
    }
    return this;
  };

  /** (Re)arms the auto-hide timer; a falsy duration means "stay until dismissed". */
  Notice.prototype.setAutoHide = function (ms) {
    if (this.timerId !== -1) {
      this.win.clearTimeout(this.timerId);
      this.timerId = -1;
    }
    this.autoHide = ms;
    if (ms && !this.hovered) {
      this.timerId = this.win.setTimeout(() => this.hide(), ms);
    }
    return this;
  };

  Notice.prototype.addButton = function (label, callback) {
    if (!this.buttonContainerEl) {
      this.buttonContainerEl = ng28El(this.win.document, "div", "notice-button-container");
      this.containerEl.appendChild(this.buttonContainerEl);
    }
    const btn = ng28El(this.win.document, "div", "notice-cta", label);
    btn.addEventListener("click", (event) => {
      this.hide();
      callback(event);
    });
    this.buttonContainerEl.appendChild(btn);
    return this;
  };

  Notice.prototype.hide = function () {
    const el = this.containerEl;
    const win = this.win;
    if (this.timerId !== -1) {
      win.clearTimeout(this.timerId);
      this.timerId = -1;
    }
    if (!ng28IsShown(el)) {
      ng28CleanupContainer(el);
      return;
    }
    const done = () => ng28CleanupContainer(el);
    if (host.Platform.isMobile) {
      runTransition(el, new host.Transition({ duration: 150 })
        .addProp("transform", "scale(1, 1)", "scale(0.85, 0.85)", "")
        .addProp("opacity", "1", "0", ""), done);
    } else {
      const style = win.getComputedStyle(el);
      const marginBottom = parseFloat(style.marginBottom) || 0;
      const drop = -(el.offsetHeight + marginBottom);
      runTransition(el, new host.Transition({ duration: 120 })
        .addProp("opacity", "1", "0", "")
        .addProp("margin-top", style.marginTop || "0px", drop + "px", ""), done);
    }
  };

  return Notice;
}
