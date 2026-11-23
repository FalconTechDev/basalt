// Basalt transparency: the window sits on a system material (Mica / Acrylic on Windows 11) and the big surfaces are semi-transparent.
//   __bsGlass.set(mode, level)   mode: "mica" | "acrylic" | "off", level 0..1 (how much shows through)
(() => {
  "use strict";
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const level = () => Math.max(0, Math.min(1, parseFloat(get("bs-glass-level", "0.6")) || 0));
  const mode = () => (["mica", "acrylic", "off"].includes(get("bs-glass", "mica")) ? get("bs-glass", "mica") : "mica");
  function apply() {
    const r = document.documentElement, m = mode(), g = level(); r.dataset.glass = m;
    r.style.setProperty("--bs-a-main", (1 - 0.34 * g).toFixed(3)); r.style.setProperty("--bs-a-side", (1 - 0.64 * g).toFixed(3)); r.style.setProperty("--bs-a-chrome", (1 - 0.72 * g).toFixed(3));
  }
  function set(m, l) { try { if (m) localStorage.setItem("bs-glass", m); if (l != null) localStorage.setItem("bs-glass-level", String(l)); } catch (e) { /* private */ } apply(); try { window.electron.ipcRenderer.send("set-glass", mode()); } catch (e) { /* no ipc */ } }
  apply(); try { window.electron.ipcRenderer.send("set-glass", mode()); } catch (e) { /* no ipc */ }
  window.__bsGlass = { set, apply, mode, level };
})();
