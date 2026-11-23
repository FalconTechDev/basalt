// Basalt sound effects: short sounds synthesised with the Web Audio API (no sound files). Settings: Appearance > Sound.
//   __bsSfx.play("click" | "open" | "close" | "add" | "link" | "cut" | "delete" | "notice" | "error" | "done" | "toggle")
(() => {
  "use strict";
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) { /* private */ } };
  const cfg = {
    on: () => get("bs-sfx-on", "1") !== "0", vol: () => Math.max(0, Math.min(1, parseFloat(get("bs-sfx-vol", "0.45")) || 0)),
    group: (g) => get("bs-sfx-" + g, "1") !== "0",
  };
  let ctx = null, last = {};
  const ac = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } } if (ctx.state === "suspended") ctx.resume().catch(() => {}); return ctx; };
  // one note: sine/triangle/square with a quick attack and an exponential decay, optional pitch glide
  const tone = (c, t0, f0, f1, dur, vol, type) => {
    const o = c.createOscillator(), g = c.createGain(); o.type = type || "sine"; o.frequency.setValueAtTime(f0, t0); if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.03);
  };
  const noise = (c, t0, dur, vol, cutoff) => {
    const n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = buf; f.type = "lowpass"; f.frequency.value = cutoff || 900; g.gain.value = vol; s.connect(f); f.connect(g); g.connect(c.destination); s.start(t0);
  };
  const SOUNDS = {
    click: (c, t, v) => tone(c, t, 1500, 1100, 0.035, v * 0.35, "sine"),
    toggle: (c, t, v) => { tone(c, t, 900, 1300, 0.05, v * 0.4, "triangle"); },
    open: (c, t, v) => { tone(c, t, 440, 660, 0.09, v * 0.45, "sine"); tone(c, t + 0.06, 660, 880, 0.11, v * 0.35, "sine"); },
    close: (c, t, v) => { tone(c, t, 760, 480, 0.09, v * 0.4, "sine"); },
    add: (c, t, v) => { tone(c, t, 420, 900, 0.09, v * 0.55, "sine"); tone(c, t + 0.05, 1260, 1260, 0.06, v * 0.2, "triangle"); },
    link: (c, t, v) => { tone(c, t, 620, 620, 0.07, v * 0.45, "triangle"); tone(c, t + 0.07, 930, 930, 0.1, v * 0.45, "triangle"); },
    cut: (c, t, v) => { noise(c, t, 0.09, v * 0.5, 2400); tone(c, t, 900, 300, 0.1, v * 0.25, "sawtooth"); },
    delete: (c, t, v) => { noise(c, t, 0.12, v * 0.5, 700); tone(c, t, 320, 130, 0.13, v * 0.4, "sine"); },
    notice: (c, t, v) => { tone(c, t, 880, 880, 0.12, v * 0.35, "sine"); tone(c, t + 0.09, 1320, 1320, 0.16, v * 0.3, "sine"); },
    error: (c, t, v) => { tone(c, t, 220, 170, 0.16, v * 0.35, "square"); },
    done: (c, t, v) => { tone(c, t, 523, 523, 0.09, v * 0.4, "triangle"); tone(c, t + 0.08, 659, 659, 0.09, v * 0.4, "triangle"); tone(c, t + 0.16, 784, 784, 0.16, v * 0.4, "triangle"); },
  };
  const GROUP = { click: "ui", toggle: "ui", open: "ui", close: "ui", add: "board", link: "board", cut: "board", delete: "board", done: "board", notice: "notice", error: "notice" };
  function play(name, force) {
    if (!force && !cfg.on()) return; if (!force && !cfg.group(GROUP[name] || "ui")) return; const fn = SOUNDS[name]; if (!fn) return;
    const now = performance.now(); if (!force && last[name] && now - last[name] < 45) return; last[name] = now; const c = ac(); if (!c) return; fn(c, c.currentTime + 0.005, cfg.vol());
  }
  // interface: soft tick on buttons, a sound when a window or a menu opens and closes, a ping for notices
  const CLICKABLE = "button, .clickable-icon, .menu-item, .osb-btn, .osb-rb, .osb-dt, .osb-sb, .checkbox-container, .bset-ni, .tree-item-self, .nav-file-title, .nav-folder-title";
  document.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; const t = e.target; if (t && t.closest) { const c = t.closest(CLICKABLE); if (c) play(c.classList.contains("checkbox-container") ? "toggle" : "click"); } }, true);
  const mo = new MutationObserver((list) => { for (const m of list) { for (const n of m.addedNodes) { if (n.nodeType !== 1) continue; if (n.matches && (n.matches(".modal-container, .bs-closing") || n.matches(".menu"))) play("open"); else if (n.matches && n.matches(".notice")) play(/не удалось|ошибк|error|failed/i.test(n.textContent || "") ? "error" : "notice"); } for (const n of m.removedNodes) { if (n.nodeType === 1 && n.matches && n.matches(".modal-container")) play("close"); } } });
  const start = () => mo.observe(document.body, { childList: true, subtree: true }); if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  window.addEventListener("bs-sfx", (e) => play(e.detail));
  window.__bsSfx = { play, get on() { return cfg.on(); }, set: (k, v) => set("bs-sfx-" + k, v), level: () => cfg.vol(), group: cfg.group, enabled: cfg.on };
})();
