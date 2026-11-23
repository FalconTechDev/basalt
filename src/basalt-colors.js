// Basalt colour picker: one popover used everywhere a colour is chosen.
//   __bsColors.pick(anchor, current, (hex|"") => ..., { none: true })    anchor: an element or {x, y}
// Two modes: a ready palette, and a full spectrum (2D field + hue / saturation / brightness).
(() => {
  "use strict";
  const ROWS = [
    ["#ef4444", "#f97316", "#f59e0b", "#eab308", "#84cc16", "#22c55e", "#14b8a6", "#06b6d4"],
    ["#0ea5e9", "#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e"],
    ["#fca5a5", "#fdba74", "#fde68a", "#bef264", "#86efac", "#5eead4", "#7dd3fc", "#c4b5fd"],
    ["#ffffff", "#d4d4d8", "#a1a1aa", "#71717a", "#52525b", "#3f3f46", "#27272a", "#0a0a0a"],
  ];
  let pop = null, off = null;
  const hex = (v) => { const s = String(v || "").trim().toLowerCase(); return /^#[0-9a-f]{6}$/.test(s) ? s : /^#[0-9a-f]{3}$/.test(s) ? "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3] : null; };
  const toRgb = (h, s, v) => { const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c; const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return [r + m, g + m, b + m].map((n) => Math.round(n * 255)); };
  const toHex = (h, s, v) => "#" + toRgb(h, s, v).map((n) => n.toString(16).padStart(2, "0")).join("");
  const toHsv = (hx) => { const n = parseInt(hx.slice(1), 16), r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = Math.round(h * 60); if (h < 0) h += 360; return { h, s: mx ? d / mx : 0, v: mx }; };
  function close() { if (pop) { pop.remove(); pop = null; } if (off) { off(); off = null; } }
  function pick(anchor, current, cb, opts) {
    close(); opts = opts || {}; const cur = hex(current); const p = pop = document.createElement("div"); p.className = "bpal-pop";
    let mode = "pal"; try { mode = localStorage.getItem("bs-color-mode") === "spec" ? "spec" : "pal"; } catch (e) { /* private */ }
    let hsv = toHsv(cur || "#8b5cf6"), value = cur || "";
    const done = (v) => { cb(v); close(); };
    // ---- tabs
    const tabs = document.createElement("div"); tabs.className = "bpal-tabs"; const tp = document.createElement("div"), ts = document.createElement("div"); tp.textContent = "Палитра"; ts.textContent = "Спектр"; tabs.append(tp, ts); p.appendChild(tabs);
    // ---- ready palette
    const pal = document.createElement("div"); pal.className = "bpal-pal";
    for (const row of ROWS) { const r = document.createElement("div"); r.className = "bpal-row"; for (const c of row) { const s = document.createElement("div"); s.className = "bpal-sw"; s.style.background = c; s.dataset.c = c; s.onclick = () => done(c); r.appendChild(s); } pal.appendChild(r); }
    p.appendChild(pal);
    // ---- spectrum
    const spec = document.createElement("div"); spec.className = "bpal-spec";
    const cv = document.createElement("canvas"); cv.className = "bpal-sv"; cv.width = 264; cv.height = 168; const knob = document.createElement("div"); knob.className = "bpal-knob"; const svw = document.createElement("div"); svw.className = "bpal-svw"; svw.append(cv, knob);
    const mk = (label, max) => { const row = document.createElement("div"); row.className = "bpal-srow"; const l = document.createElement("span"); l.textContent = label; const r = document.createElement("input"); r.type = "range"; r.min = 0; r.max = max; r.className = "bpal-range"; const n = document.createElement("input"); n.type = "number"; n.min = 0; n.max = max; n.className = "bpal-num"; row.append(l, r, n); return { row, r, n }; };
    const H = mk("Тон", 360), S = mk("Насыщ.", 100), V = mk("Яркость", 100); spec.append(svw, H.row, S.row, V.row); p.appendChild(spec);
    // ---- footer
    const foot = document.createElement("div"); foot.className = "bpal-foot"; const prev = document.createElement("div"); prev.className = "bpal-prev"; const hexIn = document.createElement("input"); hexIn.type = "text"; hexIn.className = "bpal-hex"; hexIn.placeholder = "#RRGGBB"; hexIn.spellcheck = false; foot.append(prev, hexIn);
    if (opts.none !== false) { const n = document.createElement("button"); n.className = "bpal-none"; n.textContent = "Без цвета"; n.onclick = () => done(""); foot.appendChild(n); }
    p.appendChild(foot);
    // ---- drawing / syncing
    let pend = 0; const emit = () => { if (pend) return; pend = setTimeout(() => { pend = 0; cb(value); }, 40); };
    const paint = () => { const g = cv.getContext("2d"), w = cv.width, h = cv.height; g.clearRect(0, 0, w, h); const a = g.createLinearGradient(0, 0, w, 0); a.addColorStop(0, "#fff"); a.addColorStop(1, toHex(hsv.h, 1, 1)); g.fillStyle = a; g.fillRect(0, 0, w, h); const b = g.createLinearGradient(0, 0, 0, h); b.addColorStop(0, "rgba(0,0,0,0)"); b.addColorStop(1, "#000"); g.fillStyle = b; g.fillRect(0, 0, w, h); };
    const sync = (fromInput) => {
      value = toHex(hsv.h, hsv.s, hsv.v); paint(); knob.style.left = hsv.s * 100 + "%"; knob.style.top = (1 - hsv.v) * 100 + "%"; knob.style.background = value;
      H.r.value = H.n.value = Math.round(hsv.h); S.r.value = S.n.value = Math.round(hsv.s * 100); V.r.value = V.n.value = Math.round(hsv.v * 100);
      H.r.style.background = "linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"; S.r.style.background = "linear-gradient(90deg," + toHex(hsv.h, 0, hsv.v) + "," + toHex(hsv.h, 1, hsv.v) + ")"; V.r.style.background = "linear-gradient(90deg,#000," + toHex(hsv.h, hsv.s, 1) + ")";
      prev.style.background = value; if (!fromInput) hexIn.value = value;
    };
    const wire = (c, key, max, scale) => { const set = (x) => { hsv[key] = Math.max(0, Math.min(max, +x || 0)) / scale; sync(); emit(); }; c.r.oninput = () => set(c.r.value); c.n.onchange = () => set(c.n.value); };
    wire(H, "h", 360, 1); wire(S, "s", 100, 100); wire(V, "v", 100, 100);
    const fromPoint = (e) => { const r = cv.getBoundingClientRect(); hsv.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); hsv.v = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)); sync(); emit(); };
    let drag = false; svw.addEventListener("pointerdown", (e) => { drag = true; svw.setPointerCapture(e.pointerId); fromPoint(e); }); svw.addEventListener("pointermove", (e) => { if (drag) fromPoint(e); }); svw.addEventListener("pointerup", () => { drag = false; });
    hexIn.onkeydown = (e) => { if (e.key === "Enter") { const h = hex(hexIn.value); if (h) { hsv = toHsv(h); sync(); cb(value); } } }; hexIn.oninput = () => { const h = hex(hexIn.value); if (h) { hsv = toHsv(h); sync(true); emit(); } };
    const show = (m) => { mode = m; try { localStorage.setItem("bs-color-mode", m); } catch (e) { /* private */ } tp.classList.toggle("is-on", m === "pal"); ts.classList.toggle("is-on", m === "spec"); pal.style.display = m === "pal" ? "" : "none"; spec.style.display = m === "spec" ? "" : "none"; for (const s of pal.querySelectorAll(".bpal-sw")) s.classList.toggle("is-on", s.dataset.c === (value || cur)); place(); };
    tp.onclick = () => show("pal"); ts.onclick = () => show("spec");
    document.body.appendChild(p);
    const place = () => { const a = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y }, w = p.offsetWidth, h = p.offsetHeight; let x = a.left, y = a.bottom + 6; if (x + w > innerWidth - 8) x = innerWidth - w - 8; if (y + h > innerHeight - 8) y = Math.max(8, a.top - h - 6); p.style.left = Math.max(8, x) + "px"; p.style.top = y + "px"; };
    sync(); if (!cur) hexIn.value = ""; show(mode);
    const down = (e) => { if (!p.contains(e.target)) close(); }, key = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    setTimeout(() => { document.addEventListener("pointerdown", down, true); document.addEventListener("keydown", key, true); off = () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key, true); }; }, 0);
  }
  window.__bsColors = { pick, close, hex, ROWS };
})();
