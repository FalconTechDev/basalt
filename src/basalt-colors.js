// Basalt colour palette: one popover used everywhere a colour is chosen (cards, people ...).
//   __bsColors.pick(anchor, current, (hex|"") => ..., { none: true })    anchor: an element or {x, y}
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
  function close() { if (pop) { pop.remove(); pop = null; } if (off) { off(); off = null; } }
  function pick(anchor, current, cb, opts) {
    close(); opts = opts || {}; const cur = hex(current); const p = pop = document.createElement("div"); p.className = "bpal-pop";
    const done = (v) => { cb(v); close(); };
    for (const row of ROWS) { const r = document.createElement("div"); r.className = "bpal-row"; for (const c of row) { const s = document.createElement("div"); s.className = "bpal-sw" + (c === cur ? " is-on" : ""); s.style.background = c; s.dataset.c = c; s.onclick = () => done(c); r.appendChild(s); } p.appendChild(r); }
    const f = document.createElement("div"); f.className = "bpal-foot";
    const native = document.createElement("input"); native.type = "color"; native.className = "bpal-native"; native.value = cur || "#8b5cf6"; native.title = "Свой цвет"; native.onchange = () => { cb(native.value); hexIn.value = native.value; };
    const hexIn = document.createElement("input"); hexIn.type = "text"; hexIn.className = "bpal-hex"; hexIn.placeholder = "#RRGGBB"; hexIn.spellcheck = false; hexIn.value = cur || ""; hexIn.onkeydown = (e) => { if (e.key === "Enter") { const h = hex(hexIn.value); if (h) done(h); } };
    f.append(native, hexIn);
    if (opts.none !== false) { const n = document.createElement("button"); n.className = "bpal-none"; n.textContent = "Без цвета"; n.onclick = () => done(""); f.appendChild(n); }
    p.appendChild(f); document.body.appendChild(p);
    const a = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y }, w = p.offsetWidth, h = p.offsetHeight;
    let x = a.left, y = a.bottom + 6; if (x + w > innerWidth - 8) x = innerWidth - w - 8; if (y + h > innerHeight - 8) y = Math.max(8, a.top - h - 6); p.style.left = Math.max(8, x) + "px"; p.style.top = y + "px";
    const down = (e) => { if (!p.contains(e.target)) close(); }, key = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    setTimeout(() => { document.addEventListener("pointerdown", down, true); document.addEventListener("keydown", key, true); off = () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("keydown", key, true); }; }, 0);
  }
  window.__bsColors = { pick, close, hex, ROWS };
})();
