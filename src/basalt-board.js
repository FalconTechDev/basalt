// Basalt board: a free canvas of cards (any text) joined by links, stored as a CRDT (Yjs) so several people edit it at once.
// A board is a ".board" file in the vault. Every peer keeps a full copy; peers find each other over WebRTC (room + password = invite code).
(() => {
  "use strict";
  const VIEW = "basalt-board", EXT = "board";
  const COLORS = ["", "#e5484d", "#f59f3b", "#d6b43c", "#46a758", "#3fa7d6", "#8e6bd8"];
  const PEER = ["#e5484d", "#f59f3b", "#3fa7d6", "#46a758", "#8e6bd8", "#c0699f", "#d6b43c"];
  const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const signalingList = () => { try { const j = JSON.parse(localStorage.getItem("board-signaling") || "null"); if (Array.isArray(j) && j.length) return j; } catch (e) { /* default */ } return []; };
  const me = (() => { try { const j = JSON.parse(localStorage.getItem("board-me") || "null"); if (j) return j; } catch (e) { /* none */ } const j = { name: "Участник " + uid().slice(0, 3), color: PEER[Math.floor(Math.random() * PEER.length)] }; try { localStorage.setItem("board-me", JSON.stringify(j)); } catch (e) { /* private */ } return j; })();
  const ask = (title, def) => new Promise((res) => {
    const M = new window.__bsApi.Modal(app); M.titleEl.setText(title); let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
    const i = M.contentEl.createEl("input", { attr: { style: "width:100%" } }); i.value = def || ""; const row = M.contentEl.createDiv({ attr: { style: "margin-top:12px;display:flex;justify-content:flex-end;gap:8px" } });
    const ok = row.createEl("button", { text: "OK", cls: "mod-cta" }); ok.onclick = () => { fin(i.value.trim()); M.close(); }; i.onkeydown = (e) => { if (e.key === "Enter") ok.click(); };
    M.onClose = () => fin(null); M.open(); setTimeout(() => i.focus(), 50);
  });

  let BOARD_CLIP = null;
  function makeView(api) {
    return class BoardView extends api.ItemView {
      constructor(leaf) { super(leaf); this.path = null; this.sel = new Set(); this.cam = { x: 0, y: 0, k: 1 }; this.peers = []; this.saveT = 0; this.drag = null; this.els = new Map(); this.edgeEls = new Map(); this.cursors = new Map(); }
      getViewType() { return VIEW; }
      getDisplayText() { return this.path ? this.path.replace(/^.*\//, "").replace(/\.board$/, "") : "Доска"; }
      getIcon() { return "lucide-layout-dashboard"; }
      getState() { return { path: this.path, file: this.path }; }
      async setState(s, r) { const np = s && (s.path || s.file); if (np && np !== this.path) { this.path = np; if (!this.root) this.build(); try { this.leaf.updateHeader && this.leaf.updateHeader(); } catch (e) { /* ok */ } await this.openBoard(); } return super.setState ? super.setState(s, r) : undefined; }
      async onOpen() { if (!this.root) this.build(); if (this.path && !this.doc) await this.openBoard(); }
      // ---------- chrome ----------
      build() {
        const c = this.contentEl; c.empty(); c.classList.add("osb");
        this.root = c.createDiv({ cls: "osb-root" });
        this.world = this.root.createDiv({ cls: "osb-world" });
        this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); this.svg.setAttribute("class", "osb-edges"); this.svg.innerHTML = '<defs><marker id="osb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="context-stroke"/></marker></defs>'; this.world.appendChild(this.svg);
        this.cards = this.world.createDiv({ cls: "osb-cards" });
        this.inkSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); this.inkSvg.setAttribute("class", "osb-ink"); this.inkSvg.innerHTML = '<defs><marker id="osb-inkarrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="context-stroke"/></marker></defs>'; this.world.appendChild(this.inkSvg);
        this.layer = this.root.createDiv({ cls: "osb-cursors" });
        const bar = this.bar = c.createDiv({ cls: "osb-bar" });
        const btn = (icon, tip, fn, cls) => { const x = bar.createDiv({ cls: "osb-btn" + (cls ? " " + cls : ""), attr: { title: tip, "aria-label": tip } }); api.setIcon(x, icon); x.onclick = fn; return x; };
        this.snapBtn = btn("lucide-magnet", "Прилипание к сетке", () => { this.snap = !this.snap; this.snapBtn.classList.toggle("is-on", this.snap); try { localStorage.setItem("board-snap", this.snap ? "1" : "0"); } catch (e) { /* private */ } });
        try { this.snap = localStorage.getItem("board-snap") === "1"; } catch (e) { this.snap = false; } this.snapBtn.classList.toggle("is-on", !!this.snap);
        this.searchBtn = btn("lucide-search", "Поиск", () => this.toggleSearch());
        this.share = document.createElement("div"); this.zoomPct = document.createElement("span");
        const rail = this.rail = c.createDiv({ cls: "osb-rail" });
        const rb = (icon, tip, fn, cls) => { const x = rail.createDiv({ cls: "osb-rb" + (cls ? " " + cls : ""), attr: { title: tip, "aria-label": tip } }); api.setIcon(x, icon); x.onclick = fn; return x; }; const rs = () => rail.createDiv({ cls: "osb-rsep" });
        this.lockBtn = rb("lucide-unlock", "Заблокировать доску", () => this.toggleLock()); rs();
        rb("lucide-zoom-in", "Увеличить", () => this.zoomBy(1.25)); rb("lucide-zoom-out", "Уменьшить", () => this.zoomBy(1 / 1.25)); this.resetBtn = rb("lucide-rotate-cw", "Масштаб 100%", () => { this.cam.k = 1; this.applyCam(); }); rb("lucide-maximize", "Показать всё", () => this.fit()); rs();
        this.undoBtn = rb("lucide-undo-2", "Отменить", () => this.undo()); this.redoBtn = rb("lucide-redo-2", "Вернуть", () => this.redo()); rs();
        this.drawBtn = rb("lucide-pencil", "Рисование", () => this.toggleDraw()); this.transBtn = rb("lucide-languages", "Перевести карточки", () => this.translate(this.transBtn)); rs();
        this.helpBtn = rb("lucide-circle-help", "Управление", () => this.toggleHelp());
        this.searchBox = c.createDiv({ cls: "osb-search" }); const sb = this.searchBox; const sIc = sb.createSpan({ cls: "osb-si" }); api.setIcon(sIc, "lucide-search");
        const si = this.searchInput = sb.createEl("input", { attr: { placeholder: "Поиск по карточкам", spellcheck: "false" } }); this.searchCount = sb.createSpan({ cls: "osb-sc" });
        const sbtn = (ic, tip, fn) => { const x = sb.createDiv({ cls: "osb-sb2", attr: { title: tip } }); api.setIcon(x, ic); x.onclick = fn; return x; }; sbtn("lucide-chevron-up", "Предыдущая", () => this.runSearch(-1, true)); sbtn("lucide-chevron-down", "Следующая", () => this.runSearch(1, true)); sbtn("lucide-x", "Закрыть", () => this.toggleSearch(false));
        si.oninput = () => this.runSearch(0, true); si.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); this.runSearch(e.shiftKey ? -1 : 1, true); } else if (e.key === "Escape") this.toggleSearch(false); };
        this.selBar = c.createDiv({ cls: "osb-sel" }); this.box = this.root.createDiv({ cls: "osb-box" });
        const bot = c.createDiv({ cls: "osb-bottom" }); this.people = bot.createDiv({ cls: "osb-people" });
        const fe = this.feedEl = bot.createDiv({ cls: "osb-feed" }); const fh = fe.createDiv({ cls: "osb-feed-h" }); fh.createSpan({ text: "Активность" }); this.feedCount = fh.createSpan({ cls: "osb-feed-c" }); this.feedList = fe.createDiv({ cls: "osb-feed-l" });
        let open = true; try { open = localStorage.getItem("board-feed-open") !== "0"; } catch (e) { /* private */ } fe.classList.toggle("is-closed", !open); fh.onclick = () => { fe.classList.toggle("is-closed"); try { localStorage.setItem("board-feed-open", fe.classList.contains("is-closed") ? "0" : "1"); } catch (e) { /* private */ } };
        this.bindInput(); this.ro = new ResizeObserver(() => this.applyCam()); this.ro.observe(c);
      }
      // ---------- data ----------
      async openBoard() {
        const L = window.__bsY, Y = L && L.Y; if (!Y) { new api.Notice("Не загружен модуль синхронизации"); return; }
        if (window.__bsShareReady) await window.__bsShareReady;
        const sh = window.__bsShare && window.__bsShare.forPath(this.path);
        if (sh) { const rel = sh.rel(this.path); if (!sh.files.has(rel)) await sh.fromDisk(rel); const e = sh.files.get(rel);
          if (e && e.get("t") === "board") {
            this.sh = sh; this.relPath = rel; this.doc = sh.doc; this.yn = e.get("nodes"); this.ye = e.get("edges"); this.ym = sh.meta; this.initHistory();
            this.yn.observeDeep((evs) => { this.sync(); this.flash(evs); }); this.ye.observeDeep(() => this.syncEdges());
            this.aw = sh.aw; this.pc = () => { this.peers = sh.peers.filter((u) => u.board === rel); this.paintPeers(); }; if (sh.aw) sh.aw.on("change", this.pc); this.pc();
            this.sync(); this.fit(); this.feedArr(); this.renderFeed(); this.share.classList.add("is-on"); return;
          } }
        let raw = null; try { raw = await app.vault.adapter.read(this.path); } catch (e) { /* new */ }
        this.doc = new Y.Doc(); this.yn = this.doc.getMap("nodes"); this.ye = this.doc.getMap("edges"); this.ym = this.doc.getMap("meta");
        let meta = {}; try { meta = raw ? JSON.parse(raw) : {}; } catch (e) { meta = {}; }
        if (meta.ydoc) Y.applyUpdate(this.doc, unb64(meta.ydoc));
        if (!this.ym.get("id")) this.ym.set("id", uid() + uid());
        this.initHistory(); this.yn.observeDeep((evs) => { this.sync(); this.flash(evs); this.queueSave(); });
        this.ye.observeDeep(() => { this.syncEdges(); this.queueSave(); });
        this.sync(); this.fit(); this.feedArr(); this.renderFeed();
        if (this.ym.get("room")) this.connect(this.ym.get("room"), this.ym.get("pass") || "");
      }
      queueSave() { if (this.sh) return; clearTimeout(this.saveT); this.saveT = setTimeout(() => this.save(), 400); }
      async save() {
        if (this.sh || !this.doc || !this.path) return; const Y = window.__bsY.Y;
        const nodes = {}; this.yn.forEach((m, id) => { nodes[id] = { x: m.get("x"), y: m.get("y"), w: m.get("w"), h: m.get("h"), color: m.get("color") || "", text: m.get("text") ? m.get("text").toString() : "" }; });
        const out = { v: 2, id: this.ym.get("id"), room: this.ym.get("room") || null, nodes, edges: this.ye.toJSON(), ydoc: b64(Y.encodeStateAsUpdate(this.doc)) };
        try { await app.vault.adapter.write(this.path, JSON.stringify(out, null, 1)); } catch (e) { console.error(e); }
      }
      get ro() { return !!(this.sh && this.sh.readOnly) || !!this.locked; }
      toggleLock() { this.locked = !this.locked; this.lockBtn.classList.toggle("is-on", this.locked); this.lockBtn.empty(); api.setIcon(this.lockBtn, this.locked ? "lucide-lock" : "lucide-unlock"); this.lockBtn.title = this.locked ? "Разблокировать доску" : "Заблокировать доску"; if (this.locked) { this.sel = new Set(); this.mark(); } this.sync(); this.renderSelBar(); }
      toggleHelp() {
        let h = this.helpEl; if (h) { h.remove(); this.helpEl = null; this.helpBtn.classList.remove("is-on"); return; }
        h = this.helpEl = this.contentEl.createDiv({ cls: "osb-help" }); this.helpBtn.classList.add("is-on");
        const rows = [["Перетащить пустое место", "двигать доску"], ["Колесо мыши, щипок", "масштаб"], ["Тачпад двумя пальцами", "двигать в любую сторону"], ["Shift + перетащить", "выделить рамкой"], ["Shift или Ctrl + клик", "добавить к выделению"], ["Двойной клик", "новая карточка"], ["Ctrl+A", "выделить всё"], ["Ctrl+C / Ctrl+V / Ctrl+D", "копировать, вставить, дублировать"], ["Ctrl+Z / Ctrl+Shift+Z", "отменить, вернуть"], ["Стрелки (Shift — крупно)", "сдвинуть выбранное"], ["Ctrl+F", "поиск"], ["F", "показать всё"]];
        for (const [k, v] of rows) { const r = h.createDiv({ cls: "osb-hrow" }); r.createSpan({ cls: "osb-hk", text: k }); r.createSpan({ cls: "osb-hv", text: v }); }
      }
      // smart guides: while moving, edges and centres line up with other cards, and the guide lines show what is aligned with what
      guide(d, dx, dy) {
        if (!d.box) {
          let a = 1e9, b = 1e9, c = -1e9, e = -1e9; for (const [id, [x, y]] of d.o) { const m = this.yn.get(id); if (!m) continue; a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x + m.get("w")); e = Math.max(e, y + m.get("h")); } d.box = { x: a, y: b, w: c - a, h: e - b }; d.others = [];
          for (const [id, m] of this.yn.entries()) if (!d.o.has(id)) d.others.push({ x: m.get("x"), y: m.get("y"), w: m.get("w"), h: m.get("h") });
          d.gx = new Set(); d.gy = new Set(); const O = d.others.slice(0, 150); for (const A of O) for (const B of O) { if (A === B) continue; const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y), ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x); if (oy > 0 && B.x >= A.x + A.w) { const g = Math.round(B.x - A.x - A.w); if (g >= 4 && g <= 800) d.gx.add(g); } if (ox > 0 && B.y >= A.y + A.h) { const g = Math.round(B.y - A.y - A.h); if (g >= 4 && g <= 800) d.gy.add(g); } }
        }
        const k = this.cam.k, T = 9 / k, R = 18 / k, bx = d.box.x + dx, by = d.box.y + dy, W = d.box.w, H = d.box.h, xs = [bx, bx + W / 2, bx + W], ys = [by, by + H / 2, by + H];
        const bestOf = (cands, st, ref) => { if (st) { const cur = st.at - ref[st.ai]; if (Math.abs(cur) < R) return Object.assign({}, st, { d: cur }); } let best = null; for (const c of cands) if (Math.abs(c.d) < T && (!best || Math.abs(c.d) < Math.abs(best.d))) best = c; return best; };
        const cx = [], cy = [];
        for (const o of d.others) {
          const ox = [o.x, o.x + o.w / 2, o.x + o.w], oy = [o.y, o.y + o.h / 2, o.y + o.h];
          for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { cx.push({ d: ox[j] - xs[i], at: ox[j], ai: i, o, kind: "edge" }); cy.push({ d: oy[j] - ys[i], at: oy[j], ai: i, o, kind: "edge" }); }
          const vo = Math.min(by + H, o.y + o.h) - Math.max(by, o.y), ho = Math.min(bx + W, o.x + o.w) - Math.max(bx, o.x);
          if (vo > 0) { const gr = o.x - (bx + W), gl = bx - (o.x + o.w); for (const g of d.gx) { if (gr > 0) cx.push({ d: gr - g, at: bx + (gr - g) + W, ai: 2, o, kind: "gap", g, side: "r" }); if (gl > 0) cx.push({ d: g - gl, at: bx + (g - gl), ai: 0, o, kind: "gap", g, side: "l" }); } }
          if (ho > 0) { const gb = o.y - (by + H), gt = by - (o.y + o.h); for (const g of d.gy) { if (gb > 0) cy.push({ d: gb - g, at: by + (gb - g) + H, ai: 2, o, kind: "gap", g, side: "b" }); if (gt > 0) cy.push({ d: g - gt, at: by + (g - gt), ai: 0, o, kind: "gap", g, side: "t" }); } }
        }
        const sx = bestOf(cx, d.stX, xs), sy = bestOf(cy, d.stY, ys); d.stX = sx; d.stY = sy; const out = { dx: dx + (sx ? sx.d : 0), dy: dy + (sy ? sy.d : 0), sx: !!sx, sy: !!sy }; this.drawGuides(sx, sy, { x: d.box.x + out.dx, y: d.box.y + out.dy, w: W, h: H }); return out;
      }
      drawGuides(sx, sy, box) {
        let gl = this.guides; if (!gl) gl = this.guides = this.world.createDiv({ cls: "osb-guides" }); gl.empty(); const line = (o, at, a, b) => { const l = gl.createDiv({ cls: "osb-gl is-" + o }); if (o === "v") l.style.cssText = "left:" + at + "px;top:" + a + "px;height:" + (b - a) + "px"; else l.style.cssText = "top:" + at + "px;left:" + a + "px;width:" + (b - a) + "px"; };
        const gapLbl = (x, y, g) => { const t = gl.createDiv({ cls: "osb-gap", text: String(Math.round(g)) }); t.style.cssText = "left:" + x + "px;top:" + y + "px"; };
        if (sx) { if (sx.kind === "edge") line("v", sx.at, Math.min(box.y, sx.o.y), Math.max(box.y + box.h, sx.o.y + sx.o.h)); else { const y = Math.max(box.y, sx.o.y) + Math.min(box.h, sx.o.h) / 2; if (sx.side === "r") { line("h", y, box.x + box.w, sx.o.x); gapLbl((box.x + box.w + sx.o.x) / 2, y, sx.g); } else { line("h", y, sx.o.x + sx.o.w, box.x); gapLbl((sx.o.x + sx.o.w + box.x) / 2, y, sx.g); } } }
        if (sy) { if (sy.kind === "edge") line("h", sy.at, Math.min(box.x, sy.o.x), Math.max(box.x + box.w, sy.o.x + sy.o.w)); else { const x = Math.max(box.x, sy.o.x) + Math.min(box.w, sy.o.w) / 2; if (sy.side === "b") { line("v", x, box.y + box.h, sy.o.y); gapLbl(x, (box.y + box.h + sy.o.y) / 2, sy.g); } else { line("v", x, sy.o.y + sy.o.h, box.y); gapLbl(x, (sy.o.y + sy.o.h + box.y) / 2, sy.g); } } }
      }
      // resizing sticks to the edges and the sizes of other cards
      sizeSnap(d, x, y, w, h) {
        if (!d.others) { d.others = []; for (const [id, m] of this.yn.entries()) if (id !== d.id) d.others.push({ x: m.get("x"), y: m.get("y"), w: m.get("w"), h: m.get("h") }); }
        const T = 9 / this.cam.k, best = (v, list) => { let b = null; for (const t of list) { const dd = t - v; if (Math.abs(dd) < T && (!b || Math.abs(dd) < Math.abs(b.d))) b = { d: dd, at: t }; } return b; }; let gx = null, gy = null;
        const xsT = [], ysT = []; for (const o of d.others) { xsT.push(o.x, o.x + o.w / 2, o.x + o.w); ysT.push(o.y, o.y + o.h / 2, o.y + o.h); }
        if (d.dir.includes("e")) { const b = best(x + w, xsT); if (b) { w += b.d; gx = b.at; } } if (d.dir.includes("w")) { const b = best(x, xsT); if (b) { x += b.d; w -= b.d; gx = b.at; } }
        if (d.dir.includes("s")) { const b = best(y + h, ysT); if (b) { h += b.d; gy = b.at; } } if (d.dir.includes("n")) { const b = best(y, ysT); if (b) { y += b.d; h -= b.d; gy = b.at; } }
        let gl = this.guides; if (!gl) gl = this.guides = this.world.createDiv({ cls: "osb-guides" }); gl.empty();
        if (gx != null) { const l = gl.createDiv({ cls: "osb-gl is-v" }); l.style.cssText = "left:" + gx + "px;top:" + (y - 30) + "px;height:" + (h + 60) + "px"; } if (gy != null) { const l = gl.createDiv({ cls: "osb-gl is-h" }); l.style.cssText = "top:" + gy + "px;left:" + (x - 30) + "px;width:" + (w + 60) + "px"; }
        return { x, y, w, h };
      }
      clearGuides() { if (this.guides) this.guides.empty(); }
      // tidy up: put the selected (or all) cards in order in one go
      tidy(mode, ids) {
        ids = (ids && ids.length ? ids : Array.from(this.yn.keys())).filter((i) => this.yn.get(i) && !this.yn.get(i).get("locked")); if (ids.length < 1 || this.ro) return; const g = (i) => this.yn.get(i), G = 20, snap = (v) => Math.round(v / G) * G, bb = this.bounds(ids), gap = 40;
        this.doc.transact(() => {
          if (mode === "grid") for (const i of ids) { const m = g(i); m.set("x", snap(m.get("x"))); m.set("y", snap(m.get("y"))); m.set("w", Math.max(120, snap(m.get("w")))); m.set("h", Math.max(60, snap(m.get("h")))); }
          else if (mode === "row") { const o = ids.slice().sort((a, b) => g(a).get("x") - g(b).get("x")); let x = bb.x; for (const i of o) { g(i).set("x", Math.round(x)); g(i).set("y", bb.y); x += g(i).get("w") + gap; } }
          else if (mode === "col") { const o = ids.slice().sort((a, b) => g(a).get("y") - g(b).get("y")); let y = bb.y; for (const i of o) { g(i).set("y", Math.round(y)); g(i).set("x", bb.x); y += g(i).get("h") + gap; } }
          else if (mode === "cells") { const o = ids.slice().sort((a, b) => (Math.abs(g(a).get("y") - g(b).get("y")) > 60 ? g(a).get("y") - g(b).get("y") : g(a).get("x") - g(b).get("x"))), cols = Math.max(1, Math.round(Math.sqrt(o.length))); const cw = Math.max(...o.map((i) => g(i).get("w"))), ch = Math.max(...o.map((i) => g(i).get("h"))); o.forEach((i, n) => { g(i).set("x", Math.round(bb.x + (n % cols) * (cw + gap))); g(i).set("y", Math.round(bb.y + Math.floor(n / cols) * (ch + gap))); }); }
        });
      }
      editLabel(id) {
        const m = this.ye.get(id); if (!m || this.ro) return; const A = this.center(m.get("a")), B = this.center(m.get("b")); if (!A || !B) return; if (this.lbl) this.lbl.remove();
        const pt = this.screenPt((A.x + B.x) / 2, (A.y + B.y) / 2), i = this.lbl = this.root.createEl("input", { cls: "osb-lbl", attr: { placeholder: "Подпись", spellcheck: "false" } }); i.value = m.get("label") || ""; i.style.left = pt.x + "px"; i.style.top = pt.y + "px";
        const fin = (save) => { if (!this.lbl) return; const v = i.value.trim(); this.lbl = null; i.remove(); if (save) m.set("label", v); }; i.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") fin(true); else if (e.key === "Escape") fin(false); }; i.onblur = () => fin(true); i.onpointerdown = (e) => e.stopPropagation(); setTimeout(() => { i.focus(); i.select(); }, 20);
      }
      // ---------- translator (the one of the canvas) ----------
      setText(m, now) { const t = m.get("text"), old = t.toString(); if (old === now) return; let a = 0; while (a < old.length && a < now.length && old[a] === now[a]) a++; let b = 0; while (b < old.length - a && b < now.length - a && old[old.length - 1 - b] === now[now.length - 1 - b]) b++; if (old.length - a - b) t.delete(a, old.length - a - b); if (now.length - a - b) t.insert(a, now.slice(a, now.length - b)); }
      translate(anchor) {
        if (this.ro) return; const T = window.__bsTr; if (!T) { new api.Notice("Перевод недоступен"); return; }
        const ids = (this.sel.size ? Array.from(this.sel) : Array.from(this.yn.keys())).filter((i) => this.yn.get(i) && this.yn.get(i).get("text").toString().trim());
        if (!ids.length) { new api.Notice("Нет текста для перевода"); return; }
        T.pick(anchor, async (tl, sl, hooks) => {
          const texts = ids.map((i) => this.yn.get(i).get("text").toString()), trs = await T.resolve(texts, tl, sl, hooks && hooks.onProgress); let ok = 0, fail = 0;
          this.doc.transact(() => { ids.forEach((id, k) => { const m = this.yn.get(id), t = trs[k]; if (!m) return; if (t == null) { fail++; return; } if (t === texts[k]) return; if (m.get("trOrig") == null) m.set("trOrig", texts[k]); this.setText(m, t); this.stampM(m); ok++; }); });
          if (ok) this.feed("edit", ids[0], "перевод: " + ok); this.selBar && (this.selBar.dataset.sig = ""); this.renderSelBar();
          return { ok, fail, msg: "Переведено карточек: " + ok + (fail ? ", ошибок: " + fail : "") };
        }, T.defaultLang());
      }
      restoreOrig() { if (this.ro) return; const ids = (this.sel.size ? Array.from(this.sel) : Array.from(this.yn.keys())).filter((i) => this.yn.get(i) && this.yn.get(i).get("trOrig") != null); if (!ids.length) return; this.doc.transact(() => { for (const id of ids) { const m = this.yn.get(id); this.setText(m, m.get("trOrig")); m.delete("trOrig"); this.stampM(m); } }); this.selBar.dataset.sig = ""; this.renderSelBar(); }
      // ---------- drawing: strokes live in the board document, so everybody sees them ----------
      inkArr() {
        if (this._ink) return this._ink; const Y = window.__bsY.Y;
        if (this.sh) { const e = this.sh.files.get(this.relPath); if (!e) return null; let a = e.get("ink"); if (!a) { a = new Y.Array(); e.set("ink", a); } this._ink = a; } else this._ink = this.doc.getArray("ink");
        this._ink.observe(() => this.renderInk()); return this._ink;
      }
      inkEl(st) {
        const NS = "http://www.w3.org/2000/svg", mk = (n) => document.createElementNS(NS, n); let e;
        if (st.k === "pen") { e = mk("path"); const p = st.pts; let d = "M" + p[0][0] + " " + p[0][1]; if (p.length === 1) d += " l0.01 0"; for (let i = 1; i < p.length - 1; i++) { const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2; d += " Q" + p[i][0] + " " + p[i][1] + " " + mx + " " + my; } if (p.length > 1) d += " L" + p[p.length - 1][0] + " " + p[p.length - 1][1]; e.setAttribute("d", d); }
        else if (st.k === "line" || st.k === "arrow") { e = mk("line"); e.setAttribute("x1", st.a[0]); e.setAttribute("y1", st.a[1]); e.setAttribute("x2", st.b[0]); e.setAttribute("y2", st.b[1]); if (st.k === "arrow") e.setAttribute("marker-end", "url(#osb-inkarrow)"); }
        else if (st.k === "rect") { e = mk("rect"); e.setAttribute("x", Math.min(st.a[0], st.b[0])); e.setAttribute("y", Math.min(st.a[1], st.b[1])); e.setAttribute("width", Math.abs(st.b[0] - st.a[0])); e.setAttribute("height", Math.abs(st.b[1] - st.a[1])); e.setAttribute("rx", 6); }
        else { e = mk("ellipse"); e.setAttribute("cx", (st.a[0] + st.b[0]) / 2); e.setAttribute("cy", (st.a[1] + st.b[1]) / 2); e.setAttribute("rx", Math.abs(st.b[0] - st.a[0]) / 2); e.setAttribute("ry", Math.abs(st.b[1] - st.a[1]) / 2); }
        e.setAttribute("fill", "none"); e.style.stroke = st.c || "var(--text-normal)"; e.style.strokeWidth = String(st.w || 4); e.setAttribute("stroke-linecap", "round"); e.setAttribute("stroke-linejoin", "round"); e.style.color = st.c || "var(--text-normal)"; return e;
      }
      renderInk() {
        if (!this.inkSvg || !this._ink) return; const have = this.inkEls || (this.inkEls = new Map()), seen = new Set();
        for (const st of this._ink.toArray()) { seen.add(st.id); if (!have.has(st.id)) { const e = this.inkEl(st); e.dataset.id = st.id; this.inkSvg.appendChild(e); have.set(st.id, e); } }
        for (const [id, e] of have) if (!seen.has(id)) { e.remove(); have.delete(id); }
      }
      toggleDraw(on) {
        if (this.ro && on) return; this.draw = on == null ? !this.draw : !!on; this.root.classList.toggle("is-draw", this.draw); if (this.drawBtn) this.drawBtn.classList.toggle("is-on", this.draw);
        if (this.draw) { this.inkArr(); this.select(new Set()); this.tool = this.tool || "pen"; try { this.inkColor = localStorage.getItem("board-ink-color") || ""; this.inkW = +localStorage.getItem("board-ink-w") || 4; } catch (e) { this.inkW = 4; } this.buildDrawBar(); }
        else if (this.dtb) { this.dtb.remove(); this.dtb = null; }
      }
      setTool(t) { this.tool = t; if (this.dtb) for (const b of this.dtb.querySelectorAll(".osb-dt")) b.classList.toggle("is-on", b.dataset.t === t); this.root.classList.toggle("is-erase", t === "eraser"); }
      buildDrawBar() {
        if (this.dtb) this.dtb.remove(); const bar = this.dtb = this.contentEl.createDiv({ cls: "osb-dtb" });
        const tb = (t, ic, tip) => { const b = bar.createDiv({ cls: "osb-dt", attr: { title: tip } }); b.dataset.t = t; api.setIcon(b, ic); b.onclick = () => this.setTool(t); return b; };
        tb("pen", "lucide-pencil", "Кисть (P)"); tb("line", "lucide-minus", "Линия (L)"); tb("arrow", "lucide-move-up-right", "Стрелка (A)"); tb("rect", "lucide-square", "Прямоугольник (R)"); tb("ellipse", "lucide-circle", "Овал (O)"); tb("eraser", "lucide-eraser", "Ластик (E)");
        bar.createDiv({ cls: "osb-bsep" });
        const cb = bar.createDiv({ cls: "osb-dt osb-dcol", attr: { title: "Цвет" } }); const dot = cb.createDiv({ cls: "osb-ddot" }); const paintDot = () => { dot.style.background = this.inkColor || "var(--text-normal)"; }; paintDot(); cb.onclick = () => window.__bsColors.pick(cb, this.inkColor, (c) => { this.inkColor = c; try { localStorage.setItem("board-ink-color", c); } catch (e) { /* private */ } paintDot(); }, { none: false });
        const sizes = bar.createDiv({ cls: "osb-dsz" }); for (const w of [2, 4, 8, 14]) { const b = sizes.createDiv({ cls: "osb-dw" + (w === this.inkW ? " is-on" : ""), attr: { title: w + " px" } }); const i = b.createDiv(); i.style.width = i.style.height = Math.min(16, w + 3) + "px"; b.onclick = () => { this.inkW = w; try { localStorage.setItem("board-ink-w", String(w)); } catch (e) { /* private */ } for (const x of sizes.children) x.classList.toggle("is-on", x === b); }; }
        bar.createDiv({ cls: "osb-bsep" });
        const clr = bar.createDiv({ cls: "osb-dt is-danger", attr: { title: "Стереть весь рисунок" } }); api.setIcon(clr, "lucide-trash-2"); clr.onclick = () => { const a = this.inkArr(); if (a && a.length) a.delete(0, a.length); };
        const done = bar.createDiv({ cls: "osb-dt osb-ddone", attr: { title: "Готово" } }); api.setIcon(done, "lucide-check"); done.onclick = () => this.toggleDraw(false);
        this.setTool(this.tool || "pen");
      }
      startInk(e) {
        const p = this.pt(e), w = this.worldPt(p.sx, p.sy); this.drag = { kind: "ink", tool: this.tool, pts: [[Math.round(w.x * 10) / 10, Math.round(w.y * 10) / 10]], a: [w.x, w.y], b: [w.x, w.y], erased: false };
        if (this.tool === "eraser") this.eraseAt(w); else this.drawTmp();
      }
      moveInk(w, e) {
        const d = this.drag; if (!d) return; if (d.tool === "eraser") { this.eraseAt(w); return; }
        if (d.tool === "pen") { const l = d.pts[d.pts.length - 1]; if (Math.hypot(w.x - l[0], w.y - l[1]) * this.cam.k > 2.5) d.pts.push([Math.round(w.x * 10) / 10, Math.round(w.y * 10) / 10]); }
        else { let bx = w.x, by = w.y; if (e && e.shiftKey) { const dx = bx - d.a[0], dy = by - d.a[1]; if (d.tool === "line" || d.tool === "arrow") { if (Math.abs(dx) > Math.abs(dy) * 2) by = d.a[1]; else if (Math.abs(dy) > Math.abs(dx) * 2) bx = d.a[0]; } else { const m = Math.max(Math.abs(dx), Math.abs(dy)); bx = d.a[0] + Math.sign(dx || 1) * m; by = d.a[1] + Math.sign(dy || 1) * m; } } d.b = [bx, by]; }
        this.drawTmp();
      }
      drawTmp() {
        const d = this.drag; if (!d || d.tool === "eraser" || !this.inkSvg) return; if (this.inkTmp) this.inkTmp.remove(); const st = this.inkStroke(d); this.inkTmp = this.inkEl(st); this.inkTmp.setAttribute("opacity", ".85"); this.inkSvg.appendChild(this.inkTmp);
      }
      inkStroke(d) { const st = { id: "", k: d.tool, c: this.inkColor || "", w: this.inkW || 4, by: me.name }; if (d.tool === "pen") st.pts = d.pts; else { st.a = d.a.map((n) => Math.round(n * 10) / 10); st.b = d.b.map((n) => Math.round(n * 10) / 10); } return st; }
      endInk(d) {
        if (this.inkTmp) { this.inkTmp.remove(); this.inkTmp = null; } if (!d || d.tool === "eraser") return;
        if ((d.tool !== "pen") && Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) < 3) return; const st = this.inkStroke(d); st.id = uid(); const a = this.inkArr(); if (a) a.push([st]);
      }
      eraseAt(w) {
        const a = this.inkArr(); if (!a) return; const r = Math.max(7, (this.inkW || 4) * 1.2) / this.cam.k, dist = (px, py, x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy; let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)); };
        const hit = (st) => {
          const tol = r + (st.w || 4) / 2; if (st.k === "pen") { const p = st.pts; if (p.length === 1) return Math.hypot(w.x - p[0][0], w.y - p[0][1]) < tol; for (let i = 0; i < p.length - 1; i++) if (dist(w.x, w.y, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]) < tol) return true; return false; }
          if (st.k === "line" || st.k === "arrow") return dist(w.x, w.y, st.a[0], st.a[1], st.b[0], st.b[1]) < tol;
          const x1 = Math.min(st.a[0], st.b[0]), x2 = Math.max(st.a[0], st.b[0]), y1 = Math.min(st.a[1], st.b[1]), y2 = Math.max(st.a[1], st.b[1]);
          if (st.k === "rect") return dist(w.x, w.y, x1, y1, x2, y1) < tol || dist(w.x, w.y, x2, y1, x2, y2) < tol || dist(w.x, w.y, x2, y2, x1, y2) < tol || dist(w.x, w.y, x1, y2, x1, y1) < tol;
          const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.max(1, (x2 - x1) / 2), ry = Math.max(1, (y2 - y1) / 2), k = Math.hypot((w.x - cx) / rx, (w.y - cy) / ry); return Math.abs(k - 1) * Math.min(rx, ry) < tol;
        };
        const arr = a.toArray(), del = []; arr.forEach((st, i) => { if (hit(st)) del.push(i); }); if (del.length) this.doc.transact(() => { for (const i of del.reverse()) a.delete(i, 1); });
      }
      initHistory() {
        const Y = window.__bsY.Y; if (this.um) { try { this.um.destroy(); } catch (e) { /* ignore */ } } this.inkArr(); this.renderInk(); this.um = new Y.UndoManager(this._ink ? [this.yn, this.ye, this._ink] : [this.yn, this.ye], { captureTimeout: 500 });
        const upd = () => { if (this.undoBtn) { this.undoBtn.classList.toggle("is-off", !this.um.undoStack.length); this.redoBtn.classList.toggle("is-off", !this.um.redoStack.length); } };
        this.um.on("stack-item-added", upd); this.um.on("stack-item-popped", upd); upd();
      }
      undo() { if (this.ro || !this.um) return; this.um.undo(); this.sync(); this.syncEdges(); }
      redo() { if (this.ro || !this.um) return; this.um.redo(); this.sync(); this.syncEdges(); }
      zoomBy(f) { const k0 = this.cam.k; this.cam.k = Math.max(.1, Math.min(3, k0 * f)); this.applyCam(); }
      sn(v) { return this.snap ? Math.round(v / 20) * 20 : Math.round(v); }
      // ---------- selection toolbar, copy / paste, alignment ----------
      bounds(ids) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const id of ids) { const m = this.yn.get(id); if (!m) continue; a = Math.min(a, m.get("x")); b = Math.min(b, m.get("y")); c = Math.max(c, m.get("x") + m.get("w")); d = Math.max(d, m.get("y") + m.get("h")); } return a === 1e9 ? null : { x: a, y: b, w: c - a, h: d - b }; }
      renderSelBar() {
        const bar = this.selBar; if (!bar) return; const ids = Array.from(this.sel).filter((i) => this.yn.get(i)); if (!ids.length || this.ro || (this.drag && this.drag.kind === "move")) { bar.classList.remove("is-on"); return; }
        const sig = ids.length + "|" + ids.map((i) => (this.yn.get(i).get("locked") ? 1 : 0) + (this.yn.get(i).get("trOrig") != null ? "t" : "")).join(""); if (bar.dataset.sig !== sig) {
          bar.dataset.sig = sig; bar.empty(); const mk = (ic, tip, fn) => { const x = bar.createDiv({ cls: "osb-sb", attr: { title: tip } }); api.setIcon(x, ic); x.onclick = (e) => fn(e); return x; };
          const hasOrig = ids.some((i) => this.yn.get(i).get("trOrig") != null); const cols = new Set(ids.map((i) => this.yn.get(i).get("color") || "")), cur = cols.size === 1 ? Array.from(cols)[0] : ""; const cb = bar.createDiv({ cls: "osb-sb osb-colorbtn", attr: { title: "Цвет" } }); const ci = cb.createSpan({ cls: "osb-cico" }); api.setIcon(ci, "lucide-palette"); const cbar = cb.createDiv({ cls: "osb-cbar" }); if (cur) cbar.style.background = cur; else cbar.classList.add("is-none"); cb.onclick = () => window.__bsColors.pick(cb, cur, (c) => this.setColor(c));
          bar.createDiv({ cls: "osb-bsep" }); mk("lucide-copy", "Дублировать (Ctrl+D)", () => this.duplicate());
          const locked = ids.every((i) => this.yn.get(i).get("locked")); mk(locked ? "lucide-unlock" : "lucide-lock", locked ? "Разблокировать" : "Закрепить на месте", () => this.setLock(!locked));
          if (ids.length > 1) mk("lucide-align-horizontal-distribute-center", "Выровнять", (e) => this.alignMenu(e));
          if (ids.length > 1) mk("lucide-layout-grid", "Упорядочить", (e) => this.tidyMenu(e, ids));
          mk("lucide-languages", "Перевести", () => this.translate(bar)); if (hasOrig) mk("lucide-undo-2", "Вернуть оригинал", () => this.restoreOrig());
          bar.createDiv({ cls: "osb-bsep" }); mk("lucide-trash-2", "Удалить (Del)", () => this.removeSel()).classList.add("is-danger");
        }
        const bb = this.bounds(ids); if (!bb) { bar.classList.remove("is-on"); return; } const tl = this.screenPt(bb.x + bb.w / 2, bb.y); bar.classList.add("is-on"); const w = bar.offsetWidth || 260, rw = this.root.clientWidth;
        bar.style.left = Math.max(8, Math.min(rw - w - 8, tl.x - w / 2)) + "px"; bar.style.top = Math.max(56, tl.y - 54) + "px";
      }
      screenPt(wx, wy) { return { x: (wx - this.cam.x) * this.cam.k + this.root.clientWidth / 2, y: (wy - this.cam.y) * this.cam.k + this.root.clientHeight / 2 }; }
      setLock(on) { if (this.ro) return; this.doc.transact(() => { for (const id of this.sel) { const m = this.yn.get(id); if (m) m.set("locked", !!on); } }); this.selBar.dataset.sig = ""; this.sync(); }
      duplicate() { this.copy(); this.paste(30, 30); }
      copy() { const ids = Array.from(this.sel).filter((i) => this.yn.get(i)); if (!ids.length) return; const nodes = ids.map((i) => { const m = this.yn.get(i); return { id: i, x: m.get("x"), y: m.get("y"), w: m.get("w"), h: m.get("h"), color: m.get("color") || "", text: m.get("text").toString() }; }); const edges = []; this.ye.forEach((e) => { if (ids.includes(e.get("a")) && ids.includes(e.get("b"))) edges.push({ a: e.get("a"), b: e.get("b"), label: e.get("label") || "" }); }); BOARD_CLIP = { nodes, edges }; try { navigator.clipboard.writeText(nodes.map((n) => n.text).join("\n\n")); } catch (e) { /* ignore */ } }
      paste(dx, dy) {
        if (this.ro || !BOARD_CLIP) return; const Y = window.__bsY.Y, map = {}, ids = [];
        this.doc.transact(() => { for (const n of BOARD_CLIP.nodes) { const id = uid(), m = new Y.Map(), t = new Y.Text(); t.insert(0, n.text); m.set("x", n.x + dx); m.set("y", n.y + dy); m.set("w", n.w); m.set("h", n.h); m.set("color", n.color); m.set("by", me.name); this.stampM(m); m.set("text", t); this.yn.set(id, m); map[n.id] = id; ids.push(id); } for (const e of BOARD_CLIP.edges) { const m = new Y.Map(); m.set("a", map[e.a]); m.set("b", map[e.b]); m.set("label", e.label); this.ye.set(uid(), m); } });
        for (const id of ids) this.feed("add", id, this.label(id)); this.select(new Set(ids));
      }
      tidyMenu(e, ids) { const mn = new api.Menu(), it = (t, ic, fn) => mn.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn)); it("По сетке", "lucide-grid-3x3", () => this.tidy("grid", ids)); it("В ряд", "lucide-rows-3", () => this.tidy("row", ids)); it("В столбец", "lucide-columns-3", () => this.tidy("col", ids)); it("Сеткой", "lucide-layout-grid", () => this.tidy("cells", ids)); mn.showAtMouseEvent(e); }
      alignMenu(e) {
        const mn = new api.Menu(), it = (t, ic, fn) => mn.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn)), ids = Array.from(this.sel).filter((i) => this.yn.get(i)), g = (i) => this.yn.get(i), bb = this.bounds(ids);
        const set = (fn) => { this.doc.transact(() => { for (const id of ids) fn(g(id), id); }); };
        it("По левому краю", "lucide-align-horizontal-justify-start", () => set((m) => m.set("x", bb.x))); it("По центру (горизонтально)", "lucide-align-horizontal-justify-center", () => set((m) => m.set("x", Math.round(bb.x + bb.w / 2 - m.get("w") / 2)))); it("По правому краю", "lucide-align-horizontal-justify-end", () => set((m) => m.set("x", bb.x + bb.w - m.get("w"))));
        mn.addSeparator(); it("По верхнему краю", "lucide-align-vertical-justify-start", () => set((m) => m.set("y", bb.y))); it("По центру (вертикально)", "lucide-align-vertical-justify-center", () => set((m) => m.set("y", Math.round(bb.y + bb.h / 2 - m.get("h") / 2)))); it("По нижнему краю", "lucide-align-vertical-justify-end", () => set((m) => m.set("y", bb.y + bb.h - m.get("h"))));
        if (ids.length > 2) { mn.addSeparator(); it("Распределить по горизонтали", "lucide-align-horizontal-distribute-center", () => { const o = ids.slice().sort((a, b) => g(a).get("x") - g(b).get("x")); const gap = (bb.w - o.reduce((s0, i) => s0 + g(i).get("w"), 0)) / (o.length - 1); let x = bb.x; this.doc.transact(() => { for (const i of o) { g(i).set("x", Math.round(x)); x += g(i).get("w") + gap; } }); }); it("Распределить по вертикали", "lucide-align-vertical-distribute-center", () => { const o = ids.slice().sort((a, b) => g(a).get("y") - g(b).get("y")); const gap = (bb.h - o.reduce((s0, i) => s0 + g(i).get("h"), 0)) / (o.length - 1); let y = bb.y; this.doc.transact(() => { for (const i of o) { g(i).set("y", Math.round(y)); y += g(i).get("h") + gap; } }); }); }
        mn.showAtMouseEvent(e);
      }
      // ---------- search ----------
      toggleSearch(on) { const open = on == null ? !this.searchBox.classList.contains("is-on") : on; this.searchBox.classList.toggle("is-on", open); this.searchBtn.classList.toggle("is-on", open); if (open) { this.searchInput.focus(); this.searchInput.select(); } else { this.searchInput.value = ""; this.runSearch(); this.root.classList.remove("has-q"); this.contentEl.focus(); } }
      runSearch(step, jump) {
        const q = this.searchInput.value.trim().toLowerCase(), hits = []; for (const [id, m] of this.yn.entries()) if (q && m.get("text").toString().toLowerCase().includes(q)) hits.push(id);
        const prev = this._hits && this._hits[this._hi || 0]; this._hits = hits; this._hi = hits.length ? (step ? ((this._hi || 0) + step + hits.length) % hits.length : Math.max(0, hits.indexOf(prev))) : 0;
        this.root.classList.toggle("has-q", !!q); for (const [id, e] of this.els) { e.el.classList.toggle("is-hit", hits.includes(id)); e.el.classList.toggle("is-cur", !!q && hits[this._hi] === id); }
        this.searchCount.textContent = q ? (hits.length ? (this._hi + 1) + " / " + hits.length : "нет совпадений") : ""; this.searchBox.classList.toggle("is-empty", !!q && !hits.length);
        if (jump && hits.length) { const m = this.yn.get(hits[this._hi]); const bb = { x: m.get("x") + m.get("w") / 2, y: m.get("y") + m.get("h") / 2 }; this.cam.x = bb.x; this.cam.y = bb.y; this.applyCam(); }
      }
      stampM(m) { m.set("lastBy", me.name); m.set("lastAt", Date.now()); m.set("lastColor", me.color); }
      label(id) { const m = this.yn.get(id); const t = m && m.get("text") ? m.get("text").toString().trim().split("\n")[0] : ""; return t ? (t.length > 28 ? t.slice(0, 28) + "…" : t) : "карточка"; }
      feedArr() {
        if (this._feed) return this._feed; const Y = window.__bsY.Y;
        if (this.sh) { const e = this.sh.files.get(this.relPath); if (!e) return null; let f = e.get("feed"); if (!f) { f = new Y.Array(); e.set("feed", f); } this._feed = f; } else this._feed = this.doc.getArray("feed");
        this._feed.observe(() => this.renderFeed()); return this._feed;
      }
      feed(kind, id, note) {
        const f = this.feedArr(); if (!f) return; const now = Date.now(), n = f.length, last = n ? f.get(n - 1) : null;
        if (last && last.who === me.name && last.kind === kind && last.id === id && now - last.t < 30000 && (kind === "edit" || kind === "move")) { this.doc.transact(() => { f.delete(n - 1, 1); f.push([Object.assign({}, last, { t: now })]); }); return; }
        this.doc.transact(() => { f.push([{ t: now, who: me.name, color: me.color, kind, id: id || null, note: note || "" }]); if (f.length > 120) f.delete(0, f.length - 120); });
      }
      flash(evs) {
        const prov = this.sh ? this.sh.prov : this.prov; if (!prov) return;
        for (const ev of evs) {
          if (ev.transaction.origin !== prov) continue; const ids = ev.path.length ? [ev.path[0]] : Array.from(ev.keysChanged || []);
          for (const i of ids) { const e = this.els.get(i), m = this.yn.get(i); if (!e || !m) continue; e.el.style.setProperty("--flash", m.get("lastColor") || "var(--interactive-accent)"); e.el.classList.remove("flash"); void e.el.offsetWidth; e.el.classList.add("flash"); }
        }
      }
      renderFeed() {
        if (!this.feedEl || !this._feed) return; const list = this.feedList; list.empty(); const items = this._feed.toArray().slice(-14).reverse();
        this.feedCount.textContent = this._feed.length ? String(this._feed.length) : "";
        if (!items.length) { list.createDiv({ cls: "osb-fe-empty", text: "Пока нет действий" }); return; }
        const TXT = { add: (e) => "новая карточка «" + e.note + "»", edit: (e) => "правка «" + e.note + "»", move: (e) => "перемещена «" + e.note + "»", color: (e) => "цвет «" + e.note + "»", del: (e) => "удалена «" + e.note + "»", link: (e) => "связь " + e.note, unlink: () => "связь удалена" };
        for (const e of items) {
          const r = list.createDiv({ cls: "osb-fe" }); const d = r.createSpan({ cls: "osb-fe-d" }); d.style.background = e.color || "var(--text-faint)"; const tx = r.createDiv({ cls: "osb-fe-t" });
          tx.createSpan({ cls: "osb-fe-w", text: e.who }); tx.createSpan({ text: " " + (TXT[e.kind] ? TXT[e.kind](e) : e.kind) }); r.createSpan({ cls: "osb-fe-time", text: new Date(e.t).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) });
          if (e.id && this.yn.get(e.id)) r.onclick = () => { const m = this.yn.get(e.id); this.cam.x = m.get("x") + m.get("w") / 2; this.cam.y = m.get("y") + m.get("h") / 2; this.applyCam(); this.select(new Set([e.id])); this.flash2(e.id); };
        }
      }
      flash2(id) { const e = this.els.get(id); if (!e) return; e.el.style.setProperty("--flash", "var(--interactive-accent)"); e.el.classList.remove("flash"); void e.el.offsetWidth; e.el.classList.add("flash"); }
      addCard(x, y, text) {
        if (this.ro) return;
        const Y = window.__bsY.Y, c = this.worldPt(this.root.clientWidth / 2, this.root.clientHeight / 2), id = uid(), m = new Y.Map(), t = new Y.Text();
        this.doc.transact(() => { m.set("x", x == null ? c.x - 130 + (Math.random() - .5) * 80 : x); m.set("y", y == null ? c.y - 50 + (Math.random() - .5) * 80 : y); m.set("w", 260); m.set("h", 110); m.set("color", ""); m.set("by", me.name); this.stampM(m); t.insert(0, text || ""); m.set("text", t); this.yn.set(id, m); });
        this.feed("add", id, this.label(id));
        this.select(new Set([id])); setTimeout(() => { const e = this.els.get(id); if (e) e.ta.focus(); }, 30); return id;
      }
      addEdge(a, b) {
        if (this.ro) return;
        if (a === b) return; for (const e of this.ye.values()) if ((e.get("a") === a && e.get("b") === b) || (e.get("a") === b && e.get("b") === a)) return;
        const Y = window.__bsY.Y, m = new Y.Map(); this.doc.transact(() => { m.set("a", a); m.set("b", b); m.set("label", ""); this.ye.set(uid(), m); });
        this.feed("link", null, "«" + this.label(a) + "» → «" + this.label(b) + "»");
      }
      removeSel() { if (this.ro) return; for (const id of Array.from(this.sel)) { const m0 = this.yn.get(id); if (m0 && m0.get("locked")) this.sel.delete(id); } for (const id of this.sel) this.feed("del", id, this.label(id)); if (this.selEdge) this.feed("unlink", null, ""); this.doc.transact(() => { for (const id of this.sel) { this.yn.delete(id); for (const [k, e] of Array.from(this.ye.entries())) if (e.get("a") === id || e.get("b") === id) this.ye.delete(k); } if (this.selEdge) this.ye.delete(this.selEdge); }); this.sel = new Set(); this.selEdge = null; this.mark(); }
      setColor(col) { if (this.ro) return; this.doc.transact(() => { for (const id of this.sel) { const m = this.yn.get(id); if (m) { m.set("color", col); this.stampM(m); } } }); for (const id of this.sel) this.feed("color", id, this.label(id)); }
      // ---------- DOM sync ----------
      sync() {
        const seen = new Set(); const ro = this.ro; if (this.root) this.root.classList.toggle("is-ro", ro); if (this.feedEl) this.feedEl.style.display = ro ? "none" : "";
        this.yn.forEach((m, id) => {
          seen.add(id); let e = this.els.get(id); if (!e) e = this.mkCard(id, m); e.ta.readOnly = ro || !!m.get("locked"); e.el.classList.toggle("is-locked", !!m.get("locked"));
          const s = e.el.style; s.left = m.get("x") + "px"; s.top = m.get("y") + "px"; s.width = m.get("w") + "px"; s.height = m.get("h") + "px";
          const col = m.get("color") || ""; s.setProperty("--card", col || "var(--background-modifier-border)"); e.el.classList.toggle("has-color", !!col);
          const lb = m.get("lastBy") || m.get("by"), la = m.get("lastAt"); const bt = lb ? lb + (la ? " · " + new Date(la).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "") : ""; if (e.by.textContent !== bt) e.by.textContent = bt; e.by.style.setProperty("--c", m.get("lastColor") || "var(--text-faint)"); e.by.title = (m.get("by") ? "Создал: " + m.get("by") + "\n" : "") + (lb ? "Последним менял: " + lb : "");
          const txt = m.get("text").toString(); if (e.ta.value !== txt) { const f = document.activeElement === e.ta, p = e.ta.selectionStart; e.ta.value = txt; if (f) { try { e.ta.setSelectionRange(Math.min(p, txt.length), Math.min(p, txt.length)); } catch (er) { /* ok */ } } }
        });
        for (const [id, e] of this.els) if (!seen.has(id)) { e.el.remove(); this.els.delete(id); this.sel.delete(id); }
        this.syncEdges(); this.mark();
      }
      mkCard(id, m) {
        const el = this.cards.createDiv({ cls: "osb-card" }); el.dataset.id = id;
        const grip = el.createDiv({ cls: "osb-grip" }); const tag = grip.createSpan({ cls: "osb-tag" }); const by = grip.createSpan({ cls: "osb-by" }); const x = grip.createDiv({ cls: "osb-x", attr: { title: "Удалить" } }); api.setIcon(x, "lucide-x");
        x.onclick = (ev) => { ev.stopPropagation(); this.select(new Set([id])); this.removeSel(); };
        const ta = el.createEl("textarea", { cls: "osb-ta", attr: { placeholder: "Текст…", spellcheck: "false" } });
        for (const side of ["t", "r", "b", "l"]) { const h = el.createDiv({ cls: "osb-h osb-h-" + side }); h.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); if (this.ro) return; this.drag = { kind: "link", from: id }; this.root.setPointerCapture(ev.pointerId); }); }
        for (const dir of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) { const z = el.createDiv({ cls: "osb-rz osb-rz-" + dir }); z.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); if (this.ro || m.get("locked")) return; const mm = this.yn.get(id), q = this.pt(ev); this.drag = { kind: "size", id, dir, x: mm.get("x"), y: mm.get("y"), w: mm.get("w"), h: mm.get("h"), p: this.worldPt(q.sx, q.sy) }; this.root.setPointerCapture(ev.pointerId); }); }
        grip.addEventListener("pointerdown", (ev) => { if (ev.target.closest(".osb-x") || ev.button !== 0 || this.ro) return; if (ev.shiftKey || ev.ctrlKey) { const n2 = new Set(this.sel); n2.has(id) ? n2.delete(id) : n2.add(id); this.select(n2); if (!n2.has(id)) return; } else if (!this.sel.has(id)) this.select(new Set([id])); const o = new Map(); for (const s of this.sel) { const n = this.yn.get(s); if (n && !n.get("locked")) o.set(s, [n.get("x"), n.get("y")]); } if (!o.size) return; const p = this.pt(ev); this.drag = { kind: "move", o, p: this.worldPt(p.sx, p.sy) }; this.root.setPointerCapture(ev.pointerId); });
        ta.addEventListener("focus", () => { this.select(new Set([id])); this.publish({ typing: id }); });
        ta.addEventListener("blur", () => this.publish({ typing: null }));
        ta.addEventListener("input", () => { if (m.get("locked")) { ta.value = m.get("text").toString(); return; } const t = m.get("text"), old = t.toString(), now = ta.value; let a = 0; while (a < old.length && a < now.length && old[a] === now[a]) a++; let b = 0; while (b < old.length - a && b < now.length - a && old[old.length - 1 - b] === now[now.length - 1 - b]) b++; this.doc.transact(() => { if (old.length - a - b) t.delete(a, old.length - a - b); if (now.length - a - b) t.insert(a, now.slice(a, now.length - b)); this.stampM(m); }); this.feed("edit", id, this.label(id)); });
        const rec = { el, ta, tag, by }; this.els.set(id, rec); return rec;
      }
      anchor(id, toward) { const m = this.yn.get(id); if (!m) return null; const x = m.get("x"), y = m.get("y"), w = m.get("w"), h = m.get("h"), cx = x + w / 2, cy = y + h / 2, dx = toward.x - cx, dy = toward.y - cy; if (!dx && !dy) return { x: cx, y: cy }; const k = Math.min(dx ? (w / 2) / Math.abs(dx) : 1e9, dy ? (h / 2) / Math.abs(dy) : 1e9); return { x: cx + dx * k, y: cy + dy * k }; }
      center(id) { const m = this.yn.get(id); return m ? { x: m.get("x") + m.get("w") / 2, y: m.get("y") + m.get("h") / 2 } : null; }
      syncEdges() {
        if (!this.ye || !this.svg) return; const seen = new Set(); const NS = "http://www.w3.org/2000/svg";
        this.ye.forEach((m, id) => {
          const A = this.center(m.get("a")), B = this.center(m.get("b")); if (!A || !B) return; seen.add(id);
          let r = this.edgeEls.get(id); if (!r) { const g = document.createElementNS(NS, "g"), hit = document.createElementNS(NS, "line"), ln = document.createElementNS(NS, "line"), tx = document.createElementNS(NS, "text"); hit.setAttribute("class", "osb-eh"); ln.setAttribute("class", "osb-el"); ln.setAttribute("marker-end", "url(#osb-arrow)"); tx.setAttribute("class", "osb-et"); tx.setAttribute("text-anchor", "middle"); g.append(hit, ln, tx); this.svg.appendChild(g); g.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); this.selEdge = id; this.select(new Set()); this.selEdge = id; this.mark(); }); g.addEventListener("dblclick", (ev) => { ev.stopPropagation(); this.editLabel(id); }); r = { g, hit, ln, tx }; this.edgeEls.set(id, r); }
          const p = this.anchor(m.get("a"), B), q = this.anchor(m.get("b"), A); for (const l of [r.hit, r.ln]) { l.setAttribute("x1", p.x); l.setAttribute("y1", p.y); l.setAttribute("x2", q.x); l.setAttribute("y2", q.y); }
          r.tx.setAttribute("x", (p.x + q.x) / 2); r.tx.setAttribute("y", (p.y + q.y) / 2 - 5); r.tx.textContent = m.get("label") || "";
        });
        for (const [id, r] of this.edgeEls) if (!seen.has(id)) { r.g.remove(); this.edgeEls.delete(id); }
      }
      select(set) { if (this.ro) { if (this.sel.size) { this.sel = new Set(); this.mark(); } return; } this.sel = set; if (set.size) this.selEdge = null; this.mark(); this.publish(); }
      mark() { this.renderSelBar(); for (const [id, e] of this.els) e.el.classList.toggle("is-sel", this.sel.has(id)); if (this.palette) this.palette.classList.toggle("is-on", this.sel.size > 0); for (const [id, r] of this.edgeEls) r.g.classList.toggle("is-sel", this.selEdge === id); this.paintPeers(); }
      // ---------- camera ----------
      pt(e) { const r = this.root.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }
      worldPt(sx, sy) { return { x: (sx - this.root.clientWidth / 2) / this.cam.k + this.cam.x, y: (sy - this.root.clientHeight / 2) / this.cam.k + this.cam.y }; }
      applyCam() { if (!this.world) return; if (this.resetBtn) this.resetBtn.title = "Масштаб " + Math.round(this.cam.k * 100) + "% (клик — 100%)"; this.renderSelBar(); const c = this.cam; this.world.style.transform = "translate(" + (this.root.clientWidth / 2 - c.x * c.k) + "px," + (this.root.clientHeight / 2 - c.y * c.k) + "px) scale(" + c.k + ")"; this.paintPeers(); }
      fit() { const ms = Array.from(this.yn ? this.yn.values() : []); if (!ms.length) { this.cam = { x: 0, y: 0, k: 1 }; return this.applyCam(); } let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const m of ms) { a = Math.min(a, m.get("x")); b = Math.min(b, m.get("y")); c = Math.max(c, m.get("x") + m.get("w")); d = Math.max(d, m.get("y") + m.get("h")); } const w = this.root.clientWidth || 800, h = this.root.clientHeight || 600; this.cam = { x: (a + c) / 2, y: (b + d) / 2, k: Math.min(1.2, Math.max(.15, Math.min((w - 120) / Math.max(1, c - a), (h - 140) / Math.max(1, d - b)))) }; this.applyCam(); }
      // ---------- input ----------
      bindInput() {
        const r = this.root;
        r.addEventListener("pointerdown", (e) => {
          if (e.target.closest(".osb-card:not(.osb-ghost), .osb-sel, .osb-search, .osb-rail, .osb-help, .osb-dtb, .osb-lbl, g")) { if (!(this.draw && e.target.closest(".osb-card"))) return; }
          if (e.button !== 0 && e.button !== 1) return; const p = this.pt(e);
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); this.contentEl.focus();
          if (this.draw && e.button === 0 && !this.ro) { e.preventDefault(); this.startInk(e); r.setPointerCapture(e.pointerId); return; }
          const pan = e.button === 1 || this.space || this.ro;
          if (pan) { this.drag = { kind: "pan", sx: p.sx, sy: p.sy, cx: this.cam.x, cy: this.cam.y }; r.classList.add("is-panning"); }
          else { const add = e.shiftKey || e.ctrlKey; if (!add) { this.select(new Set()); this.selEdge = null; this.mark(); } this.drag = { kind: "box", x0: p.sx, y0: p.sy, base: new Set(add ? this.sel : []), add }; }
          r.setPointerCapture(e.pointerId);
        });
        r.addEventListener("pointermove", (e) => {
          const p = this.pt(e), w = this.worldPt(p.sx, p.sy); this.myCur = w; const d = this.drag;
          if (d && d.kind === "pan") { if (Math.abs(p.sx - d.sx) + Math.abs(p.sy - d.sy) > 3) d.moved = true; this.cam.x = d.cx - (p.sx - d.sx) / this.cam.k; this.cam.y = d.cy - (p.sy - d.sy) / this.cam.k; this.applyCam(); }
          else if (d && d.kind === "move") { d.moved = true; let dx = w.x - d.p.x, dy = w.y - d.p.y; const g = this.guide(d, dx, dy); dx = g.dx; dy = g.dy; this.doc.transact(() => { for (const [s0, [x, y]] of d.o) { const n = this.yn.get(s0); if (n) { n.set("x", g.sx ? Math.round(x + dx) : this.sn(x + dx)); n.set("y", g.sy ? Math.round(y + dy) : this.sn(y + dy)); } } }); }
          else if (d && d.kind === "size") {
            d.moved = true; const n = this.yn.get(d.id); if (n) { const dx = w.x - d.p.x, dy = w.y - d.p.y, MW = 120, MH = 60; let x = d.x, y = d.y, ww = d.w, hh = d.h;
              if (d.dir.includes("e")) ww = Math.max(MW, this.sn(d.w + dx)); if (d.dir.includes("s")) hh = Math.max(MH, this.sn(d.h + dy));
              if (d.dir.includes("w")) { ww = Math.max(MW, this.sn(d.w - dx)); x = d.x + d.w - ww; } if (d.dir.includes("n")) { hh = Math.max(MH, this.sn(d.h - dy)); y = d.y + d.h - hh; }
              const sn2 = this.sizeSnap(d, x, y, ww, hh); x = sn2.x; y = sn2.y; ww = Math.max(MW, sn2.w); hh = Math.max(MH, sn2.h); this.doc.transact(() => { n.set("x", Math.round(x)); n.set("y", Math.round(y)); n.set("w", Math.round(ww)); n.set("h", Math.round(hh)); }); } }
          else if (d && d.kind === "link") this.drawTemp(w);
          else if (d && d.kind === "ink") this.moveInk(w, e);
          else if (d && d.kind === "box") { const x = Math.min(d.x0, p.sx), y = Math.min(d.y0, p.sy), bw = Math.abs(p.sx - d.x0), bh = Math.abs(p.sy - d.y0); if (bw + bh > 6) { d.live = true; this.box.style.cssText = "display:block;left:" + x + "px;top:" + y + "px;width:" + bw + "px;height:" + bh + "px"; const a = this.worldPt(x, y), b2 = this.worldPt(x + bw, y + bh), hit = new Set(d.base); for (const [id, m] of this.yn.entries()) { const cx = m.get("x"), cy = m.get("y"); if (cx < b2.x && cx + m.get("w") > a.x && cy < b2.y && cy + m.get("h") > a.y) hit.add(id); } this.sel = hit; this.mark(); } }
          this.publish();
        });
        const up = (e) => { const d = this.drag; this.drag = null; if (d && d.kind === "ink") this.endInk(d); r.classList.remove("is-panning"); this.clearGuides(); if (d && d.kind === "pan" && !d.moved && !this.ro) { this.select(new Set()); this.selEdge = null; this.mark(); } if (d && d.kind === "box") { this.box.style.display = "none"; if (d.live) this.publish(); } this.renderSelBar(); if (d && (d.kind === "move" || d.kind === "size") && !this.ro && d.moved) { const ids = d.kind === "move" ? Array.from(d.o.keys()) : [d.id]; this.doc.transact(() => { for (const i of ids) { const m = this.yn.get(i); if (m) this.stampM(m); } }); for (const i of ids) this.feed("move", i, this.label(i)); } if (this.temp) { this.temp.remove(); this.temp = null; } if (d && d.kind === "link") { const t = document.elementFromPoint(e.clientX, e.clientY), c = t && t.closest && t.closest(".osb-card"); if (c && c.dataset.id !== d.from) this.addEdge(d.from, c.dataset.id); else if (!c) { const p = this.pt(e), w = this.worldPt(p.sx, p.sy), id = this.addCard(w.x - 130, w.y - 30); this.addEdge(d.from, id); } } };
        r.addEventListener("pointerup", up); r.addEventListener("pointercancel", up);
        r.addEventListener("wheel", (e) => {
          const ta = e.target.closest && e.target.closest(".osb-ta"); if (ta && !e.ctrlKey && ta.scrollHeight > ta.clientHeight) return; e.preventDefault();
          const mouse = e.deltaMode === 1 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 100 && (Math.abs(e.deltaY) % 100 === 0 || Math.abs(e.deltaY) % 120 === 0));
          if (e.ctrlKey || mouse) { const p = this.pt(e), b = this.worldPt(p.sx, p.sy); this.cam.k = Math.max(.1, Math.min(3, this.cam.k * Math.exp(-(e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY) * (e.ctrlKey ? .01 : .0015)))); const a = this.worldPt(p.sx, p.sy); this.cam.x += b.x - a.x; this.cam.y += b.y - a.y; }
          else { this.cam.x += (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) / this.cam.k; this.cam.y += (e.shiftKey && !e.deltaX ? 0 : e.deltaY) / this.cam.k; }
          this.applyCam();
        }, { passive: false });
        r.addEventListener("dblclick", (e) => { if (e.target.closest(".osb-card, g")) return; const p = this.pt(e), w = this.worldPt(p.sx, p.sy); this.addCard(w.x - 130, w.y - 30); });
        r.addEventListener("contextmenu", (e) => {
          e.preventDefault(); if (!this.doc) return; const M = api.Menu; const m = new M(), p = this.pt(e), w = this.worldPt(p.sx, p.sy), it = (t, ic, fn) => m.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn));
          const card = e.target.closest && e.target.closest(".osb-card"), eg = e.target.closest && e.target.closest("g");
          if (card) {
            const id = card.dataset.id; if (!this.sel.has(id)) this.select(new Set([id]));
            it("Дублировать", "lucide-copy", () => { for (const s of Array.from(this.sel)) { const n = this.yn.get(s); if (n) this.addCard(n.get("x") + 30, n.get("y") + 30, n.get("text").toString()); } });
            it("Копировать текст", "lucide-clipboard", () => { const n = this.yn.get(id); if (n) navigator.clipboard.writeText(n.get("text").toString()).catch(() => {}); });
            it("На передний план", "lucide-bring-to-front", () => { const n = this.yn.get(id), e2 = this.els.get(id); if (e2) this.cards.appendChild(e2.el); });
            m.addSeparator(); it("Удалить", "lucide-trash-2", () => this.removeSel());
          } else if (eg) {
            const id = Array.from(this.edgeEls).find(([, r2]) => r2.g === eg || eg.contains(r2.g))?.[0]; const ed = id && this.ye.get(id);
            if (ed) { it("Подписать связь", "lucide-type", () => this.editLabel(id)); m.addSeparator(); it("Удалить связь", "lucide-trash-2", () => { this.feed("unlink", null, ""); this.ye.delete(id); }); }
          } else {
            it("Новая карточка здесь", "lucide-square-plus", () => this.addCard(w.x - 130, w.y - 30));
            it("Вставить текст карточкой", "lucide-clipboard-paste", async () => { try { const t = await navigator.clipboard.readText(); if (t) this.addCard(w.x - 130, w.y - 30, t); } catch (er) { /* no access */ } });
            m.addSeparator(); if (this.yn.size > 1) { it("Упорядочить всё по сетке", "lucide-grid-3x3", () => this.tidy("grid", null)); it("Расставить сеткой", "lucide-layout-grid", () => this.tidy("cells", null)); m.addSeparator(); } it("Показать всё", "lucide-maximize", () => this.fit());
          }
          m.showAtMouseEvent(e);
        });
        this.contentEl.tabIndex = 0;
        this.contentEl.addEventListener("keyup", (e) => { if (e.code === "Space") { this.space = false; this.root.classList.remove("is-hand"); } });
        this.contentEl.addEventListener("keydown", (e) => {
          const inField = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName), mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
          if (mod && k === "f") { e.preventDefault(); this.toggleSearch(true); return; } if (inField) return;
          if (e.code === "Space" && !inField) { this.space = true; this.root.classList.add("is-hand"); e.preventDefault(); return; }
          if (this.draw) { if (e.key === "Escape") this.toggleDraw(false); else if (k === "p") this.setTool("pen"); else if (k === "e") this.setTool("eraser"); else if (k === "l") this.setTool("line"); else if (k === "r") this.setTool("rect"); else if (k === "o") this.setTool("ellipse"); else if (k === "a" && !mod) this.setTool("arrow"); if (!mod) return; }
          if (this.ro) { if (k === "f") this.fit(); return; }
          if (mod && k === "a") { e.preventDefault(); this.select(new Set(this.yn.keys())); }
          else if (mod && k === "z") { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); } else if (mod && k === "y") { e.preventDefault(); this.redo(); }
          else if (mod && k === "c") { this.copy(); } else if (mod && k === "x") { this.copy(); this.removeSel(); } else if (mod && k === "v") { e.preventDefault(); if (BOARD_CLIP) this.paste(40, 40); else navigator.clipboard.readText().then((t) => { if (t) { const w = this.worldPt(this.root.clientWidth / 2, this.root.clientHeight / 2); this.addCard(w.x - 130, w.y - 30, t); } }).catch(() => {}); }
          else if (mod && k === "d") { e.preventDefault(); this.duplicate(); }
          else if ((e.key === "Delete" || e.key === "Backspace") && (this.sel.size || this.selEdge)) { e.preventDefault(); this.removeSel(); }
          else if (e.key === "Escape") { this.select(new Set()); this.selEdge = null; this.mark(); this.toggleSearch(false); }
          else if (k === "f" && !mod) this.fit(); else if (k === "n" && !mod) { const w = this.myCur || this.worldPt(this.root.clientWidth / 2, this.root.clientHeight / 2); this.addCard(w.x - 130, w.y - 30); }
          else if (e.key === "+" || e.key === "=") this.zoomBy(1.25); else if (e.key === "-") this.zoomBy(1 / 1.25);
          else if (e.key.startsWith("Arrow") && this.sel.size) { e.preventDefault(); const st = e.shiftKey ? 10 : 1, dx = e.key === "ArrowLeft" ? -st : e.key === "ArrowRight" ? st : 0, dy = e.key === "ArrowUp" ? -st : e.key === "ArrowDown" ? st : 0; this.doc.transact(() => { for (const id of this.sel) { const m = this.yn.get(id); if (m && !m.get("locked")) { m.set("x", m.get("x") + dx); m.set("y", m.get("y") + dy); } } }); }
        });
      }
      drawTemp(w) { const NS = "http://www.w3.org/2000/svg"; if (!this.temp) { this.temp = document.createElementNS(NS, "line"); this.temp.setAttribute("class", "osb-el osb-temp"); this.svg.appendChild(this.temp); } if (!this.center(this.drag.from)) return; const p = this.anchor(this.drag.from, w); this.temp.setAttribute("x1", p.x); this.temp.setAttribute("y1", p.y); this.temp.setAttribute("x2", w.x); this.temp.setAttribute("y2", w.y); }
      // ---------- people ----------
      publish(extra) { if (this.sh) { this.sh.publish(Object.assign({ board: this.relPath, cur: this.myCur || null, sel: Array.from(this.sel) }, extra || {})); return; } if (!this.aw) return; if (extra) this.extra = Object.assign(this.extra || {}, extra); this.aw.setLocalStateField("user", Object.assign({ name: me.name, color: me.color, cur: this.myCur || null, sel: Array.from(this.sel) }, this.extra || {})); }
      connect(room, pass) {
        const L = window.__bsY; if (this.prov) this.prov.destroy();
        this.prov = new L.TrysteroProvider("basalt-board-" + room, this.doc, { password: pass || undefined, relayUrls: signalingList() });
        this.aw = this.prov.awareness; this.publish();
        this.aw.on("change", () => { this.peers = Array.from(this.aw.getStates().entries()).filter(([id]) => id !== this.aw.clientID).map(([, s]) => s.user).filter(Boolean); this.paintPeers(); });
        this.share.classList.add("is-on");
      }
      paintPeers() {
        if (!this.people) return; const psig = me.name + "|" + me.color + "#" + this.peers.map((u) => u.name + "|" + u.color).join(";");
        if (psig !== this._psig) { this._psig = psig; this.people.empty(); const chip = (u, self) => { const c = this.people.createDiv({ cls: "osb-chip" }); const d = c.createSpan({ cls: "osb-dot" }); d.style.background = u.color; c.createSpan({ text: u.name + (self ? " (вы)" : "") }); }; chip(me, true); for (const u of this.peers) chip(u); }
        for (const [, e] of this.els) { e.el.style.removeProperty("--peer"); e.el.classList.remove("has-peer"); e.tag.textContent = ""; }
        for (const u of this.peers) { for (const id of u.sel || []) { const e = this.els.get(id); if (e) { e.el.style.setProperty("--peer", u.color); e.el.classList.add("has-peer"); e.tag.textContent = u.name + (u.typing === id ? " печатает…" : ""); e.tag.style.background = u.color; } } }
        const live = new Set(); this.peers.forEach((u, i) => { if (!u.cur) return; live.add(i); let c = this.cursors.get(i); if (!c) { c = this.layer.createDiv({ cls: "osb-cur" }); c.innerHTML = '<svg width="14" height="16" viewBox="0 0 14 16"><path d="M1 1l11 5-5 2-2 6z" fill="currentColor"/></svg><span></span>'; this.cursors.set(i, c); }
          c.style.color = u.color; c.lastChild.textContent = u.name; c.lastChild.style.background = u.color; const k = this.cam.k; c.style.transform = "translate(" + ((u.cur.x - this.cam.x) * k + this.root.clientWidth / 2) + "px," + ((u.cur.y - this.cam.y) * k + this.root.clientHeight / 2) + "px)"; });
        for (const [i, c] of this.cursors) if (!live.has(i)) { c.remove(); this.cursors.delete(i); }
      }
      shareDialog() {
        if (!this.doc) return; if (this.sh) { window.__bsShare.dialog(this.sh.folder || "/"); return; } let room = this.ym.get("room"), pass = this.ym.get("pass");
        if (!room) { room = this.ym.get("id"); pass = uid() + uid(); this.doc.transact(() => { this.ym.set("room", room); this.ym.set("pass", pass); }); this.connect(room, pass); }
        const M = new api.Modal(app); M.titleEl.setText("Совместная работа"); const c = M.contentEl;
        c.createEl("p", { text: "Код приглашения. Каждый, кто его введёт, получает полную копию доски и сам начинает её раздавать: если ваш компьютер выключится, остальные продолжат работать." });
        const i = c.createEl("input", { attr: { readonly: "true", style: "width:100%" } }); i.value = "basalt-board:" + room + ":" + pass; i.onfocus = () => i.select();
        c.createEl("p", { text: "Свои relay-серверы Nostr (необязательно):" }); const sg = c.createEl("input", { attr: { style: "width:100%" } }); sg.value = signalingList().join(", "); sg.onchange = () => { try { localStorage.setItem("board-signaling", JSON.stringify(sg.value.split(",").map((x) => x.trim()).filter(Boolean))); } catch (e) { /* private */ } };
        c.createEl("p", { text: "Ваше имя:" }); const n = c.createEl("input", { attr: { style: "width:100%" } }); n.value = me.name; n.onchange = () => { me.name = n.value || me.name; try { localStorage.setItem("board-me", JSON.stringify(me)); } catch (e) { /* private */ } this.publish(); };
        M.open();
      }
      async onClose() { clearTimeout(this.saveT); await this.save(); if (this.sh) { if (this.sh.aw && this.pc) this.sh.aw.off("change", this.pc); this.sh.publish({ board: null, cur: null }); } else { if (this.prov) this.prov.destroy(); if (this.doc) this.doc.destroy(); } if (this.ro) this.ro.disconnect(); }
    };
  }

  async function openBoard(path) { const leaf = app.workspace.getLeaf("tab"); await leaf.setViewState({ type: VIEW, active: true, state: { path } }); app.workspace.setActiveLeaf(leaf, { focus: true }); }
  async function newBoard() { let i = 0, p; do { p = "Доска" + (i ? " " + i : "") + "." + EXT; i++; } while (await app.vault.adapter.exists(p)); await app.vault.adapter.write(p, "{}"); await openBoard(p); return p; }
  async function convertCanvas(file) {
    const Y = window.__bsY.Y; let j; try { j = JSON.parse(await app.vault.adapter.read(file.path)); } catch (e) { new window.__bsApi.Notice("Не удалось прочитать холст"); return; }
    const CM = { "1": "#e5484d", "2": "#f59f3b", "3": "#d6b43c", "4": "#46a758", "5": "#3fa7d6", "6": "#8e6bd8" }, d = new Y.Doc(), yn = d.getMap("nodes"), ye = d.getMap("edges"), ym = d.getMap("meta");
    d.transact(() => {
      ym.set("id", uid() + uid());
      for (const n of j.nodes || []) { const m = new Y.Map(), t = new Y.Text(); const txt = n.type === "file" ? "[[" + String(n.file || "").replace(/\.md$/, "") + "]]" : n.type === "link" ? (n.url || "") : n.type === "group" ? (n.label || "") : (n.text || ""); t.insert(0, txt); m.set("x", n.x || 0); m.set("y", n.y || 0); m.set("w", n.width || 260); m.set("h", n.height || 110); m.set("color", CM[n.color] || (/^#/.test(n.color || "") ? n.color : "")); m.set("by", me.name); m.set("text", t); yn.set(n.id || uid(), m); }
      for (const e of j.edges || []) { if (!e.fromNode || !e.toNode) continue; const m = new Y.Map(); m.set("a", e.fromNode); m.set("b", e.toNode); m.set("label", e.label || ""); ye.set(e.id || uid(), m); }
    });
    let i = 0, p; do { p = file.path.replace(/\.canvas$/, "") + (i ? " " + i : "") + "." + EXT; i++; } while (await app.vault.adapter.exists(p));
    await app.vault.adapter.write(p, JSON.stringify({ v: 2, ydoc: b64(Y.encodeStateAsUpdate(d)) })); await openBoard(p);
  }
  async function joinBoard() {
    const code = await ask("Код приглашения"); const m = code && /^basalt-board:([^:]+):(.+)$/.exec(code.trim()); if (!m) return;
    const p = "Доска (подключена " + m[1].slice(0, 4) + ")." + EXT; const Y = window.__bsY.Y, d = new Y.Doc(); d.getMap("meta").set("id", m[1]); d.getMap("meta").set("room", m[1]); d.getMap("meta").set("pass", m[2]);
    await app.vault.adapter.write(p, JSON.stringify({ v: 2, ydoc: b64(Y.encodeStateAsUpdate(d)) })); await openBoard(p);
  }

  const t = setInterval(() => {
    if (!window.app || !app.workspace || !app.viewRegistry || !app.commands || !window.__bsApi || !window.__bsApi.ItemView || !window.__bsY) return;
    clearInterval(t);
    const V = makeView(window.__bsApi), creator = (leaf) => new V(leaf);
    try { app.viewRegistry.registerView(VIEW, creator); } catch (e) { app.viewRegistry.viewByType[VIEW] = creator; }
    try { app.viewRegistry.registerExtensions([EXT], VIEW); } catch (e) { /* opened by command */ }
    app.commands.addCommand({ id: "basalt:board-new", name: "Новая доска", icon: "lucide-layout-dashboard", callback: newBoard });
    app.commands.addCommand({ id: "basalt:board-join", name: "Подключиться к доске по коду", icon: "lucide-users", callback: joinBoard });
    app.commands.addCommand({ id: "basalt:board-from-canvas", name: "Преобразовать холст в доску", icon: "lucide-layout-dashboard", checkCallback: (chk) => { const f = app.workspace.getActiveFile(); if (!f || f.extension !== "canvas") return false; if (!chk) convertCanvas(f); return true; } });
    app.workspace.on("file-menu", (menu, f) => { if (f && f.extension === "canvas") menu.addItem((i) => i.setTitle("Преобразовать в доску").setIcon("lucide-layout-dashboard").onClick(() => convertCanvas(f))); });
    window.__bsBoard = { convert: convertCanvas, open: openBoard, create: newBoard, join: joinBoard };
  }, 500);
})();
