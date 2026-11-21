// g28 keyboard scopes (spec g28 Part B): Scope and DynamicScope plus the
// shared pure helpers (modifier compile/decompile, binding match).
import { inherit } from "./inherit.js";

const ng28ScopeCache = new WeakMap();

/** True on macOS-like hosts ("Mod" means Meta there, Ctrl elsewhere). */
export function ng28HostIsMac(host) {
  return host.isMacOS === true || /mac/i.test(String(host.osName || ""));
}

/** ["Mod","Shift"] -> "Ctrl,Shift" (non-mac) / "Meta,Shift" (mac); sorted, comma-joined. */
export function ng28CompileModifiers(list, isMac) {
  return (list || []).map((m) => (m === "Mod" ? (isMac ? "Meta" : "Ctrl") : m)).sort().join(",");
}

/** Inverse of compile: the platform mod token is written back as "Mod". */
export function ng28DecompileModifiers(text, isMac) {
  const platform = isMac ? "Meta" : "Ctrl";
  return String(text || "").split(",").filter((m) => m).map((m) => (m === platform ? "Mod" : m));
}

const NG28_MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "OS", "Meta"]);

export function ng28IsModifierKey(key) {
  return NG28_MODIFIER_KEYS.has(key);
}

/** A binding matches when modifiers are wild or equal, and key is wild, the
 * physical key, or the produced character (case-insensitive). */
export function ng28IsMatch(binding, info) {
  if (!(binding.modifiers === null || binding.modifiers === info.modifiers)) return false;
  const key = binding.key;
  if (!key) return true;
  if (key === info.vkey) return true;
  return !!info.key && key.toLowerCase() === info.key.toLowerCase();
}

function ng28DefineScopeImpl(host) {
  const isMac = () => ng28HostIsMac(host);

  function Scope(parent) {
    this.tabFocusContainerEl = null;
    this.keys = [];
    this.parent = parent == null ? null : parent;
  }

  /** Registers a binding; modifiers are compiled once here. Returns the binding record. */
  Scope.prototype.register = function (modifiers, key, func) {
    const binding = {
      scope: this,
      modifiers: modifiers == null ? null : ng28CompileModifiers(modifiers, isMac()),
      key: key == null ? null : key,
      func,
    };
    this.keys.push(binding);
    return binding;
  };

  Scope.prototype.unregister = function (binding) {
    const i = this.keys.indexOf(binding);
    if (i >= 0) this.keys.splice(i, 1);
  };

  Scope.prototype.setTabFocusContainerEl = function (el) {
    this.tabFocusContainerEl = el;
  };

  /** Offers the event to bindings in registration order, then to the parent scope. */
  Scope.prototype.handleKey = function (event, info) {
    for (const binding of this.keys) {
      if (!ng28IsMatch(binding, info)) continue;
      const result = binding.func(event, info);
      if (result !== undefined) return result;
      // a specific binding that returned undefined still consumes the key silently
      if (binding.key !== null || binding.modifiers !== null) return undefined;
      // catch-all bindings fall through to the next one
    }
    return this.parent ? this.parent.handleKey(event, info) : undefined;
  };

  return Scope;
}

/** Scope class for a host; cached so every factory sees the same constructor. */
export function ng28ScopeFor(host) {
  let Scope = ng28ScopeCache.get(host);
  if (!Scope) {
    Scope = ng28DefineScopeImpl(host);
    ng28ScopeCache.set(host, Scope);
  }
  return Scope;
}

/** Manifest entry Ng -> Scope. */
export function defineScope(host) {
  return ng28ScopeFor(host);
}

/** Manifest entry Rg -> DynamicScope: delegates to getActive() when it yields a scope. */
export function defineDynamicScope(host) {
  const Scope = ng28ScopeFor(host);

  function DynamicScope(parent, getActive) {
    const self = Scope.call(this, parent) || this;
    self.getActive = getActive;
    return self;
  }
  inherit(DynamicScope, Scope);

  DynamicScope.prototype.handleKey = function (event, info) {
    const active = this.getActive ? this.getActive() : null;
    if (active) return active.handleKey(event, info);
    return Scope.prototype.handleKey.call(this, event, info);
  };

  return DynamicScope;
}
