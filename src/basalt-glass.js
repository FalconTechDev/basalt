// Basalt transparency of windows (settings, dialogs), menus and floating panels: how much shows through, 0 = solid.
//   __bsGlass.set(level)   level 0..1
(() => {
  "use strict";
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const level = () => { const v = parseFloat(get("bs-glass-level", "0.5")); return Math.max(0, Math.min(1, isNaN(v) ? 0.5 : v)); };
  function apply() { const r = document.documentElement, l = level(); r.style.setProperty("--bs-win-a", (1 - 0.6 * l).toFixed(3)); r.style.setProperty("--bs-blur", l ? (4 + 24 * l).toFixed(0) + "px" : "0px"); r.dataset.glass = l ? "on" : "off"; }
  function set(l) { try { localStorage.setItem("bs-glass-level", String(l)); } catch (e) { /* private */ } apply(); }
  apply(); window.__bsGlass = { set, level, apply };
})();
