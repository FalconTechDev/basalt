// Basalt transparency of windows (settings, dialogs), menus and floating panels: how much of the page shows through them.
//   __bsGlass.set(level)   level 0..1  (0 = solid, 1 = most transparent)
(() => {
  "use strict";
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const level = () => Math.max(0, Math.min(1, parseFloat(get("bs-glass-level", "0.5")) || 0));
  function apply() { const r = document.documentElement; r.style.setProperty("--bs-win-a", (1 - 0.5 * level()).toFixed(3)); r.style.setProperty("--bs-blur", (6 + 22 * level()).toFixed(0) + "px"); }
  function set(l) { try { localStorage.setItem("bs-glass-level", String(l)); } catch (e) { /* private */ } apply(); }
  apply(); window.__bsGlass = { set, apply, level };
})();
