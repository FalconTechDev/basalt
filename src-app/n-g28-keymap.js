// g28 Keymap (spec g28 Part B): global key dispatcher with a scope stack.
import { ng28HostIsMac, ng28CompileModifiers, ng28DecompileModifiers, ng28IsModifierKey, ng28IsMatch, ng28ScopeFor } from "./n-g28-scope.js";

/** Manifest entry Bg -> Keymap. */
export function defineKeymap(host) {
  const isMac = () => ng28HostIsMac(host);
  const Scope = ng28ScopeFor(host);

  function Keymap() {
    this.modifiers = "";
    this.rootScope = new Scope(null);
    this.scope = this.rootScope;
    this.prevScopes = [];
    this._keydown = (event) => this.onKeyEvent(event);
    this._focusin = (event) => this.onFocusIn(event);
    window.addEventListener("keydown", this._keydown, true);
    window.addEventListener("focusin", this._focusin);
  }

  /** The shared instance used by the app (created lazily on first init). */
  Keymap.init = function () {
    if (!Keymap.global) Keymap.global = new Keymap();
    return Keymap.global;
  };

  /** Held subset of Ctrl/Meta/Alt/Shift as a sorted, comma-joined string. */
  Keymap.getModifiers = function (event) {
    const held = [];
    if (event.ctrlKey) held.push("Ctrl");
    if (event.metaKey) held.push("Meta");
    if (event.altKey) held.push("Alt");
    if (event.shiftKey) held.push("Shift");
    return held.sort().join(",");
  };

  Keymap.compileModifiers = function (list) {
    return ng28CompileModifiers(list, isMac());
  };

  Keymap.decompileModifiers = function (text) {
    return ng28DecompileModifiers(text, isMac());
  };

  Keymap.isModifierKey = ng28IsModifierKey;
  Keymap.isMatch = ng28IsMatch;

  /** Per-event modifier check; "Mod" is metaKey on macOS, ctrlKey elsewhere. */
  Keymap.isModifier = function (event, name) {
    if (!event) return false;
    const prop = name === "Mod" ? (isMac() ? "metaKey" : "ctrlKey")
      : name === "Ctrl" ? "ctrlKey"
      : name === "Meta" || name === "OS" ? "metaKey"
      : name === "Alt" ? "altKey"
      : name === "Shift" ? "shiftKey"
      : null;
    return prop ? event[prop] : false;
  };

  /** Middle click -> "tab"; Mod(+Alt)(+Shift) -> "tab"/"split"/"window"; else false. */
  Keymap.isModEvent = function (event) {
    if (!event) return false;
    const isMouse = (typeof MouseEvent !== "undefined" && event instanceof MouseEvent)
      || (typeof PointerEvent !== "undefined" && event instanceof PointerEvent);
    if (isMouse && event.button === 1) return "tab";
    if (!Keymap.isModifier(event, "Mod")) return false;
    if (event.altKey) return event.shiftKey ? "window" : "split";
    return "tab";
  };

  Keymap.prototype.getRootScope = function () {
    return this.rootScope;
  };

  Keymap.prototype.pushScope = function (scope) {
    if (scope === this.scope) return;
    this.prevScopes.push(this.scope);
    this.scope = scope;
  };

  Keymap.prototype.popScope = function (scope) {
    if (scope === this.rootScope) return;
    if (scope === this.scope) {
      this.scope = this.prevScopes.pop() || this.rootScope;
      return;
    }
    const i = this.prevScopes.indexOf(scope);
    if (i >= 0) this.prevScopes.splice(i, 1);
  };

  Keymap.prototype.updateModifiers = function (event) {
    this.modifiers = Keymap.getModifiers(event);
  };

  Keymap.prototype.matchModifiers = function (compiled) {
    return this.modifiers === compiled;
  };

  Keymap.prototype.hasModifier = function (name) {
    return Keymap.decompileModifiers(this.modifiers).indexOf(name) >= 0;
  };

  Keymap.prototype.onKeyEvent = function (event) {
    this.updateModifiers(event);
    const key = host.eventKey(event);
    if (ng28IsModifierKey(key)) return;
    let vkey = host.eventVirtualKey(event);
    // dead-key workaround: some layouts report ^ for a real KeyI press
    if (event.which === 54 && event.key === "^" && event.code === "KeyI") vkey = "KeyI";
    const info = { modifiers: this.modifiers, key, vkey };
    const result = this.scope.handleKey(event, info);
    if (result === false) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
  };

  /** Keeps focus inside the current scope's tab-focus container. */
  Keymap.prototype.onFocusIn = function (event) {
    const scope = this.scope;
    const container = scope && scope.tabFocusContainerEl;
    if (!container) return;
    const target = event.target;
    if (!target || !(target instanceof Element)) return;
    const doc = target.ownerDocument || document;
    if (target === doc.body || target === doc.documentElement) return;
    if (container.contains(target)) return;
    setTimeout(() => {
      if (this.scope !== scope) return;
      const ok = host.focusElement(container, { preventScroll: true });
      if (!ok) {
        const active = doc.activeElement;
        const HTMLElementCtor = (doc.defaultView && doc.defaultView.HTMLElement) || (typeof HTMLElement !== "undefined" ? HTMLElement : null);
        if (active && HTMLElementCtor && active instanceof HTMLElementCtor) active.blur();
      }
    }, 0);
  };

  return Keymap;
}
