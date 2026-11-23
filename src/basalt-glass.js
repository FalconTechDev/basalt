// Basalt transparency of windows, dialogs, menus and floating panels: how much shows through (0 = solid) and of which kind.
//   __bsGlass.set(level)   level 0..1        __bsGlass.setType("glass" | "frost" | "clear" | "tint")
(() => {
  "use strict";
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const level = () => { const v = parseFloat(get("bs-glass-level", "0.5")); return Math.max(0, Math.min(1, isNaN(v) ? 0.5 : v)); };
  const TYPES = { glass: { blur: 1, sat: 1.3, tint: 0 }, frost: { blur: 2.2, sat: 1.8, tint: 0 }, clear: { blur: 0, sat: 1, tint: 0 }, tint: { blur: 1, sat: 1.4, tint: 0.16 } };
  const type = () => (TYPES[get("bs-glass-type", "glass")] ? get("bs-glass-type", "glass") : "glass");
  function apply() { const r = document.documentElement, l = level(), T = TYPES[type()]; r.style.setProperty("--bs-win-a", (1 - 0.6 * l).toFixed(3)); r.style.setProperty("--bs-blur", l ? ((4 + 24 * l) * T.blur).toFixed(0) + "px" : "0px"); r.style.setProperty("--bs-sat", String(T.sat)); r.style.setProperty("--bs-tint", String(l ? T.tint : 0)); r.dataset.glass = l ? type() : "off"; }
  function set(l) { try { localStorage.setItem("bs-glass-level", String(l)); } catch (e) { /* private */ } apply(); }
  function setType(t) { try { localStorage.setItem("bs-glass-type", t); } catch (e) { /* private */ } apply(); }
  apply(); window.__bsGlass = { set, level, apply, type, setType };
})();
