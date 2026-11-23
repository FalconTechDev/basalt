// Basalt transparency of windows (settings, dialogs), menus and floating panels: on or off.
//   __bsGlass.setOn(true|false)
(() => {
  "use strict";
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const on = () => get("bs-glass-on", "1") !== "0";
  function apply() { const r = document.documentElement, o = on(); r.style.setProperty("--bs-win-a", o ? "0.78" : "1"); r.style.setProperty("--bs-blur", o ? "18px" : "0px"); r.dataset.glass = o ? "on" : "off"; }
  function setOn(v) { try { localStorage.setItem("bs-glass-on", v ? "1" : "0"); } catch (e) { /* private */ } apply(); }
  apply(); window.__bsGlass = { setOn, on, apply };
})();
