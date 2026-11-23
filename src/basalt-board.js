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
      onPaneMenu(menu, source) {
        try { if (super.onPaneMenu) super.onPaneMenu(menu, source); } catch (e) { /* base menu failed */ }
        const it = (t, ic, fn) => menu.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn)), ids = this.sel.size ? Array.from(this.sel) : null, part = ids ? " (выделенное)" : "";
        menu.addSeparator(); it("Экспорт в картинку…", "lucide-image-down", () => this.exportDialog()); it("История версий…", "lucide-history", () => this.historyDialog());
        if (ids) it("Сохранить выделенное как новую доску", "lucide-file-plus", () => this.saveSelAsBoard(ids));
        menu.addSeparator(); it("Импортировать доску…", "lucide-file-input", () => this.importDialog()); it("Добавить изображение…", "lucide-image-plus", () => this.pickImage());
        menu.addSeparator(); it("Раскладка: дерево слева направо", "lucide-git-fork", () => this.layout("lr", ids && ids.length > 1 ? ids : null)); it("Раскладка: дерево сверху вниз", "lucide-git-branch", () => this.layout("td", ids && ids.length > 1 ? ids : null)); it("Раскладка: радиально", "lucide-orbit", () => this.layout("radial", ids && ids.length > 1 ? ids : null)); it("Раскладка: силовая", "lucide-network", () => this.layout("force", ids && ids.length > 1 ? ids : null)); if (this._prevPos) it("Вернуть прежнее расположение", "lucide-undo-2", () => this.restorePos());
        menu.addSeparator(); it("Показать или скрыть правую панель", "lucide-panel-right", () => { try { const sp = app.workspace.rightSplit; sp.collapsed ? sp.expand() : sp.collapse(); } catch (e) { /* no side panel */ } });
      }
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
        this.bindInput(); this.rso = new ResizeObserver(() => { const r = this.root.getBoundingClientRect(), o = this._rc, n = { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; if (o && r.width > 0 && this.cam.k) { this.cam.x += (n.cx - o.cx) / this.cam.k; this.cam.y += (n.cy - o.cy) / this.cam.k; } if (r.width > 0) this._rc = n; this.applyCam(); }); this.rso.observe(c);
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
            this.sync(); this.fit(); this.feedArr(); this.renderFeed(); this.startHistory(); this.share.classList.add("is-on"); return;
          } }
        let raw = null; try { raw = await app.vault.adapter.read(this.path); } catch (e) { /* new */ }
        this.doc = new Y.Doc(); this.yn = this.doc.getMap("nodes"); this.ye = this.doc.getMap("edges"); this.ym = this.doc.getMap("meta");
        let meta = {}; try { meta = raw ? JSON.parse(raw) : {}; } catch (e) { meta = {}; }
        if (meta.ydoc) Y.applyUpdate(this.doc, unb64(meta.ydoc));
        if (!this.ym.get("id")) this.ym.set("id", uid() + uid());
        this.initHistory(); this.yn.observeDeep((evs) => { this.sync(); this.flash(evs); this.queueSave(); });
        this.ye.observeDeep(() => { this.syncEdges(); this.queueSave(); });
        this.sync(); this.fit(); this.feedArr(); this.renderFeed(); this.startHistory();
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
        const sx = bestOf(cx, d.stX, xs), sy = bestOf(cy, d.stY, ys); d.stX = sx; d.stY = sy; const out = { dx: dx + (sx ? sx.d : 0), dy: dy + (sy ? sy.d : 0), sx: !!sx, sy: !!sy }; this.drawGuides(sx, sy, { x: d.box.x + out.dx, y: d.box.y + out.dy, w: W, h: H }, d.others); return out;
      }
      // every edge / centre line of `box` that coincides with one of the other cards gets a guide that reaches all of them
      edgeLines(gl, box, others) {
        const tol = 1.2 / this.cam.k + 0.01, xs = [box.x, box.x + box.w / 2, box.x + box.w], ys = [box.y, box.y + box.h / 2, box.y + box.h], vx = new Map(), hy = new Map();
        const add = (m, at, a, b) => { const key = Math.round(at * 2); const cur = m.get(key); if (cur) { cur.a = Math.min(cur.a, a); cur.b = Math.max(cur.b, b); } else m.set(key, { at, a, b }); };
        for (const o of others) { const ox = [o.x, o.x + o.w / 2, o.x + o.w], oy = [o.y, o.y + o.h / 2, o.y + o.h];
          for (const a of xs) for (const b of ox) if (Math.abs(a - b) < tol) add(vx, b, Math.min(box.y, o.y), Math.max(box.y + box.h, o.y + o.h));
          for (const a of ys) for (const b of oy) if (Math.abs(a - b) < tol) add(hy, b, Math.min(box.x, o.x), Math.max(box.x + box.w, o.x + o.w)); }
        for (const g of vx.values()) { const l = gl.createDiv({ cls: "osb-gl is-v" }); l.style.cssText = "left:" + g.at + "px;top:" + g.a + "px;height:" + (g.b - g.a) + "px"; }
        for (const g of hy.values()) { const l = gl.createDiv({ cls: "osb-gl is-h" }); l.style.cssText = "top:" + g.at + "px;left:" + g.a + "px;width:" + (g.b - g.a) + "px"; }
      }
      drawGuides(sx, sy, box, others) {
        let gl = this.guides; if (!gl) gl = this.guides = this.world.createDiv({ cls: "osb-guides" }); gl.empty(); if (others) this.edgeLines(gl, box, others); const line = (o, at, a, b) => { const l = gl.createDiv({ cls: "osb-gl is-" + o }); if (o === "v") l.style.cssText = "left:" + at + "px;top:" + a + "px;height:" + (b - a) + "px"; else l.style.cssText = "top:" + at + "px;left:" + a + "px;width:" + (b - a) + "px"; };
        const gapLbl = (x, y, g) => { const t = gl.createDiv({ cls: "osb-gap", text: String(Math.round(g)) }); t.style.cssText = "left:" + x + "px;top:" + y + "px"; };
        if (sx) { if (sx.kind === "edge") { if (!others) line("v", sx.at, Math.min(box.y, sx.o.y), Math.max(box.y + box.h, sx.o.y + sx.o.h)); } else { const y = Math.max(box.y, sx.o.y) + Math.min(box.h, sx.o.h) / 2; if (sx.side === "r") { line("h", y, box.x + box.w, sx.o.x); gapLbl((box.x + box.w + sx.o.x) / 2, y, sx.g); } else { line("h", y, sx.o.x + sx.o.w, box.x); gapLbl((sx.o.x + sx.o.w + box.x) / 2, y, sx.g); } } }
        if (sy) { if (sy.kind === "edge") { if (!others) line("h", sy.at, Math.min(box.x, sy.o.x), Math.max(box.x + box.w, sy.o.x + sy.o.w)); } else { const x = Math.max(box.x, sy.o.x) + Math.min(box.w, sy.o.w) / 2; if (sy.side === "b") { line("v", x, box.y + box.h, sy.o.y); gapLbl(x, (box.y + box.h + sy.o.y) / 2, sy.g); } else { line("v", x, sy.o.y + sy.o.h, box.y); gapLbl(x, (sy.o.y + sy.o.h + box.y) / 2, sy.g); } } }
      }
      // resizing sticks to the edges and the sizes of other cards
      sizeSnap(d, x, y, w, h) {
        if (!d.others) { d.others = []; for (const [id, m] of this.yn.entries()) if (id !== d.id) d.others.push({ x: m.get("x"), y: m.get("y"), w: m.get("w"), h: m.get("h") }); }
        const T = 9 / this.cam.k, best = (v, list) => { let b = null; for (const t of list) { const dd = t - v; if (Math.abs(dd) < T && (!b || Math.abs(dd) < Math.abs(b.d))) b = { d: dd, at: t }; } return b; }; let gx = null, gy = null;
        const xsT = [], ysT = []; for (const o of d.others) { xsT.push(o.x, o.x + o.w / 2, o.x + o.w); ysT.push(o.y, o.y + o.h / 2, o.y + o.h); }
        if (d.dir.includes("e")) { const b = best(x + w, xsT); if (b) { w += b.d; gx = b.at; } } if (d.dir.includes("w")) { const b = best(x, xsT); if (b) { x += b.d; w -= b.d; gx = b.at; } }
        if (d.dir.includes("s")) { const b = best(y + h, ysT); if (b) { h += b.d; gy = b.at; } } if (d.dir.includes("n")) { const b = best(y, ysT); if (b) { y += b.d; h -= b.d; gy = b.at; } }
        let gl = this.guides; if (!gl) gl = this.guides = this.world.createDiv({ cls: "osb-guides" }); gl.empty(); this.edgeLines(gl, { x, y, w, h }, d.others);
        return { x, y, w, h };
      }
      clearGuides() { if (this.guides) this.guides.empty(); }
      // tidy up: put the selected (or all) cards in order in one go
      tidy(mode, ids) {
        ids = (ids && ids.length ? ids : Array.from(this.yn.keys())).filter((i) => this.yn.get(i) && !this.yn.get(i).get("locked")); if (ids.length < 1 || this.ro) return; this.keepPos(ids); this.um && this.um.stopCapturing(); setTimeout(() => { this.um && this.um.stopCapturing(); this.toastUndo("Карточки упорядочены."); }, 0); const g = (i) => this.yn.get(i), G = 20, snap = (v) => Math.round(v / G) * G, bb = this.bounds(ids), gap = 40;
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
        if (st.k === "t") { e = mk("text"); const sz = this.textSize(st); e.setAttribute("x", st.a[0]); e.setAttribute("y", st.a[1]); e.setAttribute("font-size", sz); e.setAttribute("dominant-baseline", "hanging"); e.style.fill = st.c || "var(--text-normal)"; e.style.stroke = "none"; e.style.fontFamily = "var(--font-interface)"; String(st.txt || "").split("\n").forEach((ln, i) => { const t = mk("tspan"); t.setAttribute("x", st.a[0]); t.setAttribute("dy", i ? sz * 1.25 : 0); t.textContent = ln || " "; e.appendChild(t); }); return e; }
        if (st.k === "pen" || st.k === "hl") { e = mk("path"); const p = st.pts; let d = "M" + p[0][0] + " " + p[0][1]; if (p.length === 1) d += " l0.01 0"; for (let i = 1; i < p.length - 1; i++) { const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2; d += " Q" + p[i][0] + " " + p[i][1] + " " + mx + " " + my; } if (p.length > 1) d += " L" + p[p.length - 1][0] + " " + p[p.length - 1][1]; e.setAttribute("d", d); }
        else if (st.k === "line" || st.k === "arrow") { e = mk("line"); e.setAttribute("x1", st.a[0]); e.setAttribute("y1", st.a[1]); e.setAttribute("x2", st.b[0]); e.setAttribute("y2", st.b[1]); if (st.k === "arrow") e.setAttribute("marker-end", "url(#osb-inkarrow)"); }
        else if (st.k === "rect") { e = mk("rect"); e.setAttribute("x", Math.min(st.a[0], st.b[0])); e.setAttribute("y", Math.min(st.a[1], st.b[1])); e.setAttribute("width", Math.abs(st.b[0] - st.a[0])); e.setAttribute("height", Math.abs(st.b[1] - st.a[1])); e.setAttribute("rx", 6); }
        else { e = mk("ellipse"); e.setAttribute("cx", (st.a[0] + st.b[0]) / 2); e.setAttribute("cy", (st.a[1] + st.b[1]) / 2); e.setAttribute("rx", Math.abs(st.b[0] - st.a[0]) / 2); e.setAttribute("ry", Math.abs(st.b[1] - st.a[1]) / 2); }
        e.setAttribute("fill", "none"); e.style.stroke = st.c || "var(--text-normal)"; e.style.strokeWidth = String(st.k === "hl" ? (st.w || 4) * 3 : (st.w || 4)); if (st.k === "hl") { e.style.opacity = ".38"; e.style.mixBlendMode = "multiply"; } e.setAttribute("stroke-linecap", "round"); e.setAttribute("stroke-linejoin", "round"); e.style.color = st.c || "var(--text-normal)"; return e;
      }
      renderInk() {
        if (!this.inkSvg || !this._ink) return; const have = this.inkEls || (this.inkEls = new Map()), seen = new Set();
        for (const st of this._ink.toArray()) { seen.add(st.id); if (!have.has(st.id)) { const e = this.inkEl(st); e.dataset.id = st.id; this.inkSvg.appendChild(e); have.set(st.id, e); } }
        for (const [id, e] of have) if (!seen.has(id)) { e.remove(); have.delete(id); if (this.inkSel === id) this.inkSel = null; }
        if (this.inkSet) for (const id of this.inkSet) { const e = have.get(id); if (e) e.classList.add("is-sel"); }
      }
      toggleDraw(on) {
        if (!on && on != null && this.inkEd) this.inkEd.blur();
        if (this.ro && on) return; this.draw = on == null ? !this.draw : !!on; this.root.classList.toggle("is-draw", this.draw); if (this.drawBtn) this.drawBtn.classList.toggle("is-on", this.draw);
        if (this.draw) { this.inkArr(); this.select(new Set()); this.tool = this.tool || "pen"; try { this.inkColor = localStorage.getItem("board-ink-color") || ""; this.inkW = +localStorage.getItem("board-ink-w") || 4; } catch (e) { this.inkW = 4; } this.buildDrawBar(); }
        else if (this.dtb) { this.dtb.remove(); this.dtb = null; }
      }
      setTool(t) { this.tool = t; if (this.dtb) for (const b of this.dtb.querySelectorAll(".osb-dt")) b.classList.toggle("is-on", b.dataset.t === t); this.root.classList.toggle("is-erase", t === "eraser"); if (t !== "select") this.inkSelect(null); this.drawCursor(); }
      buildDrawBar() {
        if (this.dtb) this.dtb.remove(); const bar = this.dtb = this.contentEl.createDiv({ cls: "osb-dtb" }); bar.addEventListener("mousedown", (ev) => { if (!ev.target.closest("input,textarea")) ev.preventDefault(); }); bar.addEventListener("click", () => setTimeout(() => this.contentEl.focus(), 0));
        const tb = (t, ic, tip) => { const b = bar.createDiv({ cls: "osb-dt", attr: { title: tip } }); b.dataset.t = t; api.setIcon(b, ic); b.onclick = () => this.setTool(t); return b; };
        tb("select", "lucide-mouse-pointer-2", "Выделение: двигать, перекрашивать, Delete (V)"); tb("pen", "lucide-pencil", "Кисть (P). Shift — прямая линия, задержка в конце — ровная фигура"); tb("hl", "lucide-highlighter", "Маркер (H)"); tb("line", "lucide-minus", "Линия (L)"); tb("arrow", "lucide-move-up-right", "Стрелка (A)"); tb("rect", "lucide-square", "Прямоугольник (R)"); tb("ellipse", "lucide-circle", "Овал (O)"); tb("text", "lucide-type", "Текст (T): клик и печатай, Enter — готово, Shift+Enter — новая строка"); tb("eraser", "lucide-eraser", "Ластик (E)");
        const wand = bar.createDiv({ cls: "osb-dt", attr: { title: "Выравнивать фигуры после кисти (задержка в конце штриха)" } }); api.setIcon(wand, "lucide-wand-2"); try { this.inkSnap = localStorage.getItem("board-ink-snap") !== "0"; } catch (e) { this.inkSnap = true; } wand.classList.toggle("is-on", this.inkSnap); wand.onclick = () => { this.inkSnap = !this.inkSnap; try { localStorage.setItem("board-ink-snap", this.inkSnap ? "1" : "0"); } catch (e) { /* private */ } wand.classList.toggle("is-on", this.inkSnap); };
        bar.createDiv({ cls: "osb-bsep" });
        const cb = bar.createDiv({ cls: "osb-dt osb-dcol", attr: { title: "Цвет" } }); const dot = cb.createDiv({ cls: "osb-ddot" }); const paintDot = () => { dot.style.background = this.inkColor || "var(--text-normal)"; }; paintDot(); cb.onclick = () => window.__bsColors.pick(cb, this.inkColor, (c) => { this.inkColor = c; if (this.inkSet && this.inkSet.size) this.inkSelect(this.inkEach(this.inkSet, (st) => { st.c = c; })); this.drawCursor(); try { localStorage.setItem("board-ink-color", c); } catch (e) { /* private */ } paintDot(); }, { none: false });
        const sizes = bar.createDiv({ cls: "osb-dsz" }); for (const w of [2, 4, 8, 14]) { const b = sizes.createDiv({ cls: "osb-dw" + (w === this.inkW ? " is-on" : ""), attr: { title: w + " px" } }); const i = b.createDiv(); i.style.width = i.style.height = Math.min(16, w + 3) + "px"; b.onclick = () => { this.inkW = w; this.drawCursor(); if (this.inkSet && this.inkSet.size) this.inkSelect(this.inkEach(this.inkSet, (st) => { st.w = w; })); try { localStorage.setItem("board-ink-w", String(w)); } catch (e) { /* private */ } for (const x of sizes.children) x.classList.toggle("is-on", x === b); }; }
        bar.createDiv({ cls: "osb-bsep" });
        const un = bar.createDiv({ cls: "osb-dt", attr: { title: "Отменить (Ctrl+Z)" } }); api.setIcon(un, "lucide-undo-2"); un.onclick = () => this.undo(); const re = bar.createDiv({ cls: "osb-dt", attr: { title: "Повторить (Ctrl+Y)" } }); api.setIcon(re, "lucide-redo-2"); re.onclick = () => this.redo();
        const clr = bar.createDiv({ cls: "osb-dt is-danger", attr: { title: "Стереть весь рисунок" } }); api.setIcon(clr, "lucide-trash-2"); clr.onclick = () => { const a = this.inkArr(); if (a && a.length) a.delete(0, a.length); };
        const done = bar.createDiv({ cls: "osb-dt osb-ddone", attr: { title: "Готово" } }); api.setIcon(done, "lucide-check"); done.onclick = () => this.toggleDraw(false);
        this.setTool(this.tool || "pen");
      }
      startInk(e) {
        const p = this.pt(e), w = this.worldPt(p.sx, p.sy), t = this.tool;
        if (t === "text") { this.inkText(w); return; }
        if (t === "select") { const arr = this._ink ? this._ink.toArray() : [], r = 8 / this.cam.k; let hit = null; for (let i = arr.length - 1; i >= 0; i--) if (this.hitStroke(arr[i], w, r)) { hit = arr[i]; break; }
          if (!hit) { if (!e.shiftKey) this.inkSelect(null); this.drag = { kind: "ink", tool: "selbox", p0: p, base: new Set(e.shiftKey ? this.inkSet : []) }; return; }
          if (e.shiftKey) { const n = new Set(this.inkSet); n.has(hit.id) ? n.delete(hit.id) : n.add(hit.id); this.inkSelect(n); if (!n.has(hit.id)) return; } else if (!this.inkSet || !this.inkSet.has(hit.id)) this.inkSelect(hit.id);
          this.drag = { kind: "ink", tool: "select", ids: new Set(this.inkSet), p: w, dx: 0, dy: 0 }; return; }
        this.drag = { kind: "ink", tool: t, pts: [[Math.round(w.x * 10) / 10, Math.round(w.y * 10) / 10]], a: [w.x, w.y], b: [w.x, w.y], erased: false };
        if (t === "eraser") this.eraseAt(w); else this.drawTmp();
      }
      moveInk(w, e) {
        const d = this.drag; if (!d) return; if (d.tool === "eraser") { this.eraseAt(w); return; }
        if (d.tool === "selbox") { const q = this.pt(e), x = Math.min(d.p0.sx, q.sx), y = Math.min(d.p0.sy, q.sy), bw = Math.abs(q.sx - d.p0.sx), bh = Math.abs(q.sy - d.p0.sy); this.box.style.cssText = "display:block;left:" + x + "px;top:" + y + "px;width:" + bw + "px;height:" + bh + "px"; const a = this.worldPt(x, y), b = this.worldPt(x + bw, y + bh), hit = new Set(d.base); for (const st of (this._ink ? this._ink.toArray() : [])) { const c = this.inkBox(st); if (c.x1 < b.x && c.x2 > a.x && c.y1 < b.y && c.y2 > a.y) hit.add(st.id); } this.inkSelect(hit); return; }
        if (d.tool === "select") { d.dx = w.x - d.p.x; d.dy = w.y - d.p.y; for (const id of d.ids) { const el = this.inkEls && this.inkEls.get(id); if (el) el.style.transform = "translate(" + d.dx + "px," + d.dy + "px)"; } return; }
        if (d.snapped) return;
        const dot = Math.round(w.x * 10) / 10, doy = Math.round(w.y * 10) / 10;
        if (d.tool === "pen" || d.tool === "hl") {
          const l = d.pts[d.pts.length - 1]; if (Math.hypot(w.x - l[0], w.y - l[1]) * this.cam.k > 2.5) { d.pts.push([dot, doy]); clearTimeout(d.ht); if (d.tool === "pen" && this.inkSnap !== false) d.ht = setTimeout(() => { if (this.drag !== d || d.snapped) return; const sh = this.recognize(d.pts); if (sh) { d.tool = sh.k; d.a = sh.a; d.b = sh.b; d.snapped = true; this.drawTmp(); } }, 520); }
          d.straight = !!(e && e.shiftKey); if (d.straight) { const a = d.pts[0], dx = w.x - a[0], dy = w.y - a[1], len = Math.hypot(dx, dy), st = Math.PI / 12, ang = Math.round(Math.atan2(dy, dx) / st) * st; d.sb = [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len]; }
        } else { let bx = w.x, by = w.y; if (e && e.shiftKey) { const dx = bx - d.a[0], dy = by - d.a[1]; if (d.tool === "line" || d.tool === "arrow") { const len = Math.hypot(dx, dy), st = Math.PI / 12, ang = Math.round(Math.atan2(dy, dx) / st) * st; bx = d.a[0] + Math.cos(ang) * len; by = d.a[1] + Math.sin(ang) * len; } else { const m = Math.max(Math.abs(dx), Math.abs(dy)); bx = d.a[0] + Math.sign(dx || 1) * m; by = d.a[1] + Math.sign(dy || 1) * m; } } d.b = [bx, by]; }
        this.drawTmp();
      }
      drawTmp() {
        const d = this.drag; if (!d || d.tool === "eraser" || !this.inkSvg) return; if (this.inkTmp) this.inkTmp.remove(); const st = this.inkStroke(d); this.inkTmp = this.inkEl(st); this.inkTmp.setAttribute("opacity", ".85"); this.inkSvg.appendChild(this.inkTmp);
      }
      inkStroke(d) { const st = { id: "", k: d.tool, c: this.inkColor || "", w: this.inkW || 4, by: me.name }; if ((d.tool === "pen" || d.tool === "hl") && d.straight && d.sb) { st.k = "line"; if (d.tool === "hl") st.k = "hl"; if (st.k === "hl") st.pts = [d.pts[0], d.sb]; else { st.a = d.pts[0].slice(); st.b = d.sb.map((n) => Math.round(n * 10) / 10); } } else if (d.tool === "pen" || d.tool === "hl") st.pts = d.pts; else { st.a = d.a.map((n) => Math.round(n * 10) / 10); st.b = d.b.map((n) => Math.round(n * 10) / 10); } return st; }
      endInk(d) {
        if (d && d.ht) clearTimeout(d.ht); if (this.inkTmp) { this.inkTmp.remove(); this.inkTmp = null; } if (!d || d.tool === "eraser") return;
        if (d.tool === "selbox") { this.box.style.display = "none"; return; }
        if (d.tool === "select") { for (const id of d.ids) { const el = this.inkEls && this.inkEls.get(id); if (el) el.style.transform = ""; } if (Math.abs(d.dx) + Math.abs(d.dy) < 0.5) return; const n = this.inkEach(d.ids, (st) => { const mv = (q) => [Math.round((q[0] + d.dx) * 10) / 10, Math.round((q[1] + d.dy) * 10) / 10]; if (st.pts) st.pts = st.pts.map(mv); if (st.a) st.a = mv(st.a); if (st.b) st.b = mv(st.b); }); this.inkSelect(n); return; }
        if ((d.tool !== "pen" && d.tool !== "hl") && Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) < 3) return; const st = this.inkStroke(d); st.id = uid(); const a = this.inkArr(); if (a) a.push([st]);
      }
      hitStroke(st, w, r) {
        const dist = (px, py, x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy; let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)); };
        const sw = st.k === "hl" ? (st.w || 4) * 3 : (st.w || 4), tol = r + sw / 2;
        if (st.k === "t") { const sz = this.textSize(st), lines = String(st.txt || "").split("\n"), wd = Math.max.apply(null, lines.map((l) => l.length)) * sz * 0.6; return w.x >= st.a[0] - r && w.x <= st.a[0] + wd + r && w.y >= st.a[1] - r && w.y <= st.a[1] + lines.length * sz * 1.25 + r; }
        if (st.k === "pen" || st.k === "hl") { const p = st.pts; if (p.length === 1) return Math.hypot(w.x - p[0][0], w.y - p[0][1]) < tol; for (let i = 0; i < p.length - 1; i++) if (dist(w.x, w.y, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]) < tol) return true; return false; }
        if (st.k === "line" || st.k === "arrow") return dist(w.x, w.y, st.a[0], st.a[1], st.b[0], st.b[1]) < tol;
        const x1 = Math.min(st.a[0], st.b[0]), x2 = Math.max(st.a[0], st.b[0]), y1 = Math.min(st.a[1], st.b[1]), y2 = Math.max(st.a[1], st.b[1]);
        if (st.k === "rect") return dist(w.x, w.y, x1, y1, x2, y1) < tol || dist(w.x, w.y, x2, y1, x2, y2) < tol || dist(w.x, w.y, x2, y2, x1, y2) < tol || dist(w.x, w.y, x1, y2, x1, y1) < tol;
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.max(1, (x2 - x1) / 2), ry = Math.max(1, (y2 - y1) / 2), k = Math.hypot((w.x - cx) / rx, (w.y - cy) / ry); return Math.abs(k - 1) * Math.min(rx, ry) < tol;
      }
      textSize(st) { return 12 + (st.w || 4) * 2; }
      eraseAt(w) {
        const a = this.inkArr(); if (!a) return; const r = Math.max(7, (this.inkW || 4) * 1.2) / this.cam.k;
        const arr = a.toArray(), del = []; arr.forEach((st, i) => { if (this.hitStroke(st, w, r)) del.push(i); }); if (del.length) this.doc.transact(() => { for (const i of del.reverse()) a.delete(i, 1); });
      }
      // ----- the pointer shows the tool: a ring of the real brush size, a dashed ring for the eraser, a fine cross for shapes
      drawCursor() {
        if (!this.root) return; const t = this.tool || "pen", k = this.cam.k; let d = 0, kind = "";
        if (t === "pen") { d = Math.min(120, Math.max(6, (this.inkW || 4) * k)); kind = "ring"; } else if (t === "hl") { d = Math.min(160, Math.max(10, (this.inkW || 4) * 3 * k)); kind = "ring"; } else if (t === "eraser") { d = Math.min(140, Math.max(14, Math.max(7, (this.inkW || 4) * 1.2) * 2 * k)); kind = "dash"; } else if (t === "line" || t === "arrow" || t === "rect" || t === "ellipse") { d = 22; kind = "cross"; }
        if (!this.ringEl) { this.ringEl = this.root.createDiv({ cls: "osb-ring" }); }
        const r = this.ringEl; r.className = "osb-ring is-" + (kind || "none"); r.style.width = r.style.height = d + "px"; r.style.marginLeft = r.style.marginTop = -d / 2 + "px";
        this.root.classList.toggle("is-ringed", !!kind); this.root.style.setProperty("--osb-cur", kind ? "none" : t === "text" ? "text" : "default");
      }
      // a stroke that was drawn and then held still becomes a clean line, rectangle or ellipse
      recognize(pts) {
        if (pts.length < 6) return null; let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        const p0 = pts[0], pn = pts[pts.length - 1], chord = Math.hypot(pn[0] - p0[0], pn[1] - p0[1]), min = 24 / this.cam.k; if (len < min) return null;
        let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9; for (const q of pts) { x1 = Math.min(x1, q[0]); y1 = Math.min(y1, q[1]); x2 = Math.max(x2, q[0]); y2 = Math.max(y2, q[1]); }
        const bw = x2 - x1, bh = y2 - y1;
        if (chord > len * 0.82) { let dev = 0; for (const q of pts) { const t = Math.abs((pn[0] - p0[0]) * (p0[1] - q[1]) - (p0[0] - q[0]) * (pn[1] - p0[1])) / (chord || 1); dev = Math.max(dev, t); } if (dev < chord * 0.07) { let b = pn.slice(); const ang = Math.atan2(pn[1] - p0[1], pn[0] - p0[0]), st = Math.PI / 12, sn = Math.round(ang / st) * st; if (Math.abs(ang - sn) < 0.07) b = [p0[0] + Math.cos(sn) * chord, p0[1] + Math.sin(sn) * chord]; return { k: "line", a: p0.slice(), b }; } return null; }
        if (chord < Math.max(bw, bh) * 0.35 && bw > min && bh > min) { const e = Math.min(bw, bh) * 0.16; let on = 0; for (const q of pts) if (Math.min(q[0] - x1, x2 - q[0], q[1] - y1, y2 - q[1]) < e) on++; const rect = on / pts.length > 0.8; let a = [x1, y1], b = [x2, y2]; if (!rect && Math.abs(bw - bh) < Math.max(bw, bh) * 0.15) { const m = (bw + bh) / 2; b = [x1 + m, y1 + m]; } return { k: rect ? "rect" : "ellipse", a, b }; }
        return null;
      }
      inkSelect(x) { const set = x == null ? new Set() : typeof x === "string" ? new Set([x]) : x; this.inkSet = set; this.inkSel = set.size ? Array.from(set)[0] : null; if (this.inkEls) for (const [i, e] of this.inkEls) e.classList.toggle("is-sel", set.has(i)); }
      inkBox(st) { if (st.k === "t") { const sz = this.textSize(st), ls = String(st.txt || "").split("\n"); return { x1: st.a[0], y1: st.a[1], x2: st.a[0] + Math.max.apply(null, ls.map((l) => l.length)) * sz * 0.6, y2: st.a[1] + ls.length * sz * 1.25 }; } const q = st.pts || [st.a, st.b]; let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9; for (const c of q) { x1 = Math.min(x1, c[0]); y1 = Math.min(y1, c[1]); x2 = Math.max(x2, c[0]); y2 = Math.max(y2, c[1]); } const h = (st.w || 4) / 2; return { x1: x1 - h, y1: y1 - h, x2: x2 + h, y2: y2 + h }; }
      inkEach(ids, fn) { const a = this.inkArr(); if (!a) return new Set(); const out = new Set(); this.doc.transact(() => { const arr = a.toArray(); for (let i = 0; i < arr.length; i++) { if (!ids.has(arr[i].id)) continue; const st = JSON.parse(JSON.stringify(arr[i])); fn(st); st.id = uid(); a.delete(i, 1); a.insert(i, [st]); out.add(st.id); } }); return out; }
      inkDeleteSel() { const a = this.inkArr(); if (!a || !this.inkSet || !this.inkSet.size) return; const ids = this.inkSet; this.doc.transact(() => { const arr = a.toArray(); for (let i = arr.length - 1; i >= 0; i--) if (ids.has(arr[i].id)) a.delete(i, 1); }); this.inkSelect(null); }
      inkReplace(id, fn) { const a = this.inkArr(); if (!a) return null; const arr = a.toArray(), i = arr.findIndex((x) => x.id === id); if (i < 0) return null; const st = JSON.parse(JSON.stringify(arr[i])); fn(st); st.id = uid(); this.doc.transact(() => { a.delete(i, 1); a.insert(i, [st]); }); return st.id; }
      inkRemove(id) { const a = this.inkArr(); if (!a) return; const i = a.toArray().findIndex((x) => x.id === id); if (i >= 0) a.delete(i, 1); }
      inkText(w) {
        if (this.inkEd) { this.inkEd.blur(); }
        const p = this.world.getBoundingClientRect(), k = this.cam.k, ta = document.createElement("textarea"); const sz = 12 + (this.inkW || 4) * 2; this.inkEd = ta;
        ta.className = "osb-inktext"; ta.rows = 1; ta.placeholder = "Текст"; ta.style.cssText = "left:" + w.x + "px;top:" + w.y + "px;font-size:" + sz + "px;color:" + (this.inkColor || "var(--text-normal)"); this.world.appendChild(ta); setTimeout(() => ta.focus(), 0);
        let fin = false; const done = (ok) => { if (fin) return; fin = true; this.inkEd = null; const t = ta.value.replace(/\s+$/, ""); ta.remove(); if (ok && t) { const a = this.inkArr(); if (a) a.push([{ id: uid(), k: "t", a: [Math.round(w.x * 10) / 10, Math.round(w.y * 10) / 10], txt: t, c: this.inkColor || "", w: this.inkW || 4, by: me.name }]); } };
        const fit = () => { ta.style.height = "0"; ta.style.height = ta.scrollHeight + "px"; ta.style.width = Math.max(90, Math.min(600, ta.value.split("\n").reduce((m, l) => Math.max(m, l.length), 0) * sz * 0.62 + 24)) + "px"; };
        ta.oninput = fit; fit(); ta.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); done(true); } else if (e.key === "Escape") { e.preventDefault(); done(false); } }; ta.onblur = () => done(true); ta.onpointerdown = (e) => e.stopPropagation();
      }

      // ---------- images, import, layout, export ----------
      async imgData(blob) {
        const url = URL.createObjectURL(blob); try {
          const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); const M = 1400, k = Math.min(1, M / Math.max(im.naturalWidth, im.naturalHeight)), w = Math.max(1, Math.round(im.naturalWidth * k)), h = Math.max(1, Math.round(im.naturalHeight * k));
          if (k === 1 && blob.size < 600000) { return { data: await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); }), w, h }; }
          const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(im, 0, 0, w, h); return { data: c.toDataURL(blob.type === "image/png" && blob.size < 1500000 ? "image/png" : "image/jpeg", 0.86), w, h };
        } finally { URL.revokeObjectURL(url); }
      }
      async addImageFile(blob, x, y) {
        if (this.ro) return; try { const r = await this.imgData(blob), cw = Math.min(360, Math.max(160, r.w)), ch = Math.round(cw * r.h / r.w) + 22 + 36, id = this.addCard(x - cw / 2, y - ch / 2, ""), m = this.yn.get(id); this.doc.transact(() => { m.set("img", r.data); m.set("w", cw); m.set("h", ch); }); } catch (e) { new api.Notice("Не удалось вставить изображение"); }
      }
      pickImage(at) { const i = document.createElement("input"); i.type = "file"; i.accept = "image/*"; i.multiple = true; i.onchange = () => { const c = at || this.worldPt(this.root.clientWidth / 2, this.root.clientHeight / 2); let n = 0; for (const f of i.files) this.addImageFile(f, c.x + n++ * 30, c.y + n * 30); }; i.click(); }
      async pasteAny() {
        const c = this.myCur || this.worldPt(this.root.clientWidth / 2, this.root.clientHeight / 2);
        try { const items = await navigator.clipboard.read(); for (const it of items) { const ty = it.types.find((t) => /^image\//.test(t)); if (ty) { this.addImageFile(await it.getType(ty), c.x, c.y); return; } } } catch (e) { /* no image or no access */ }
        if (BOARD_CLIP) { this.paste(40, 40); return; }
        try { const t = await navigator.clipboard.readText(); if (t) this.addCard(c.x - 130, c.y - 30, t); } catch (e) { /* empty */ }
      }
      keepPos(ids) { this._prevPos = new Map(); for (const id of ids) { const m = this.yn.get(id); if (m) this._prevPos.set(id, [m.get("x"), m.get("y"), m.get("w"), m.get("h"), !!m.get("fold")]); } }
      restorePos() { if (!this._prevPos || this.ro) return; const cur = new Map(); for (const id of this._prevPos.keys()) { const m = this.yn.get(id); if (m) cur.set(id, [m.get("x"), m.get("y"), m.get("w"), m.get("h"), !!m.get("fold")]); } this.um && this.um.stopCapturing(); this.doc.transact(() => { for (const [id, v] of this._prevPos) { const m = this.yn.get(id); if (m) { m.set("x", v[0]); m.set("y", v[1]); m.set("w", v[2]); m.set("h", v[3]); m.set("fold", v[4]); } } }); this.um && this.um.stopCapturing(); this._prevPos = cur; this.syncEdges(); this.selBar.dataset.sig = ""; new api.Notice("Расположение возвращено"); }
      toastUndo(text) { const f = document.createDocumentFragment(); f.append(text + " "); const b = document.createElement("button"); b.textContent = "Вернуть назад"; b.style.marginLeft = "8px"; const n = new api.Notice(f, 7000); b.onclick = () => { this.restorePos(); n.hide(); }; f.append(b); }
      setFold(on) { if (this.ro) return; this.keepPos(Array.from(this.sel)); this.um && this.um.stopCapturing(); this.doc.transact(() => { for (const id of this.sel) { const m = this.yn.get(id); if (m) m.set("fold", !!on); } }); this.um && this.um.stopCapturing(); this.selBar.dataset.sig = ""; this.syncEdges(); }
      addMenu(e) {
        const mn = new api.Menu(), it = (t, ic, fn) => mn.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn)); const c = this.worldPt(this.root.clientWidth / 2, this.root.clientHeight / 2);
        it("Новая карточка", "lucide-square-plus", () => this.addCard()); it("Изображение с компьютера…", "lucide-image-plus", () => this.pickImage(c)); it("Вставить из буфера (Ctrl+V)", "lucide-clipboard-paste", () => this.pasteAny()); mn.addSeparator(); it("Импортировать другую доску…", "lucide-file-input", () => this.importDialog(c));
        mn.showAtMouseEvent(e);
      }
      // import cards (all or chosen ones) from another board file into this one
      readBoardDoc(text) {
        const Y = window.__bsY.Y, meta = JSON.parse(text), d = new Y.Doc(); if (meta.ydoc) Y.applyUpdate(d, unb64(meta.ydoc)); const nodes = d.getMap("nodes"), edges = d.getMap("edges"), list = [];
        nodes.forEach((m, id) => list.push({ id, x: m.get("x"), y: m.get("y"), w: m.get("w"), h: m.get("h"), color: m.get("color") || "", text: m.get("text") ? m.get("text").toString() : "", img: m.get("img") || "", fold: !!m.get("fold") }));
        const es = []; edges.forEach((m) => es.push({ a: m.get("a"), b: m.get("b"), label: m.get("label") || "" })); const ink = d.getArray("ink").toArray(); return { nodes: list, edges: es, ink };
      }
      importBoardData(data, ids, at, withInk) {
        if (this.ro) return; const Y = window.__bsY.Y, pick = data.nodes.filter((n) => ids.has(n.id)); if (!pick.length) return;
        let x1 = 1e9, y1 = 1e9, x2 = -1e9; for (const n of pick) { x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y); x2 = Math.max(x2, n.x + n.w); }
        let ox, oy; if (at) { ox = at.x - x1; oy = at.y - y1; } else { const bb = this.bounds(Array.from(this.yn.keys())); ox = bb ? bb.x + bb.w + 120 - x1 : 0; oy = bb ? bb.y - y1 : 0; }
        const map = {}, added = []; this.doc.transact(() => {
          for (const n of pick) { const id = uid(), m = new Y.Map(), t = new Y.Text(); map[n.id] = id; t.insert(0, n.text); m.set("x", Math.round(n.x + ox)); m.set("y", Math.round(n.y + oy)); m.set("w", n.w); m.set("h", n.h); m.set("color", n.color); m.set("by", me.name); if (n.img) m.set("img", n.img); if (n.fold) m.set("fold", true); this.stampM(m); m.set("text", t); this.yn.set(id, m); added.push(id); }
          for (const e of data.edges) if (map[e.a] && map[e.b]) { const m = new Y.Map(); m.set("a", map[e.a]); m.set("b", map[e.b]); m.set("label", e.label); this.ye.set(uid(), m); }
          if (withInk && data.ink.length) { const a = this.inkArr(); if (a) for (const st of data.ink) { const c = JSON.parse(JSON.stringify(st)); c.id = uid(); const mv = (q) => [q[0] + ox, q[1] + oy]; if (c.pts) c.pts = c.pts.map(mv); if (c.a) c.a = mv(c.a); if (c.b) c.b = mv(c.b); a.push([c]); } }
        });
        this.select(new Set(added)); this.feed("add", added[0], this.label(added[0])); new api.Notice("Добавлено карточек: " + added.length);
      }
      importBoardText(text, name, at) { let data; try { data = this.readBoardDoc(text); } catch (e) { new api.Notice("Это не файл доски"); return; } this.importChoose(data, name || "доска", at); }
      importChoose(data, name, at) {
        const M = new api.Modal(app); M.modalEl.addClass("bs-imp"); M.titleEl.setText("Импорт: " + name); const c = M.contentEl, sel = new Set(data.nodes.map((n) => n.id));
        const top = c.createDiv({ cls: "bs-imp-top" }); const cnt = top.createSpan(); const all = top.createEl("button", { text: "Выбрать все" }), none = top.createEl("button", { text: "Снять выбор" }); const list = c.createDiv({ cls: "bs-imp-list" });
        const upd = () => { cnt.setText("Выбрано: " + sel.size + " / " + data.nodes.length); ok.disabled = !sel.size; }; const rows = [];
        for (const n of data.nodes) { const r = list.createDiv({ cls: "bs-imp-row is-on" }); const bx = r.createSpan({ cls: "bs-imp-box" }); api.setIcon(bx, "lucide-check"); const sw = r.createSpan({ cls: "bs-imp-sw" }); sw.style.background = n.color || "var(--background-modifier-border-hover)"; r.createSpan({ cls: "bs-imp-t", text: (n.img ? "[изображение] " : "") + ((n.text || "").split("\n")[0].slice(0, 90) || "Без текста") }); r.onclick = () => { sel.has(n.id) ? sel.delete(n.id) : sel.add(n.id); r.classList.toggle("is-on", sel.has(n.id)); upd(); }; rows.push([n.id, r]); }
        const foot = c.createDiv({ cls: "modal-button-container" }); const ink = data.ink.length ? foot.createEl("label", { cls: "bs-imp-ink" }) : null; let withInk = true; if (ink) { const cb = ink.createEl("input", { attr: { type: "checkbox" } }); cb.checked = true; cb.onchange = () => { withInk = cb.checked; }; ink.createSpan({ text: " вместе с рисунком" }); }
        const no = foot.createEl("button", { text: "Отмена" }), ok = foot.createEl("button", { text: "Импортировать", cls: "mod-cta" }); no.onclick = () => M.close(); ok.onclick = () => { this.importBoardData(data, sel, at, withInk && sel.size === data.nodes.length); M.close(); };
        all.onclick = () => { for (const [id, r] of rows) { sel.add(id); r.classList.add("is-on"); } upd(); }; none.onclick = () => { sel.clear(); for (const [, r] of rows) r.classList.remove("is-on"); upd(); }; upd(); M.open();
      }
      importDialog(at) {
        const M = new api.Modal(app); M.modalEl.addClass("bs-imp"); M.titleEl.setText("Импорт доски"); const c = M.contentEl; const q = c.createEl("input", { attr: { placeholder: "Найти доску в хранилище", spellcheck: "false" } }); q.style.width = "100%"; const list = c.createDiv({ cls: "bs-imp-list" });
        const files = app.vault.getFiles().filter((f) => f.extension === EXT && f.path !== this.path).sort((a, b) => b.stat.mtime - a.stat.mtime);
        const draw = () => { list.empty(); const f = q.value.toLowerCase(); const got = files.filter((x) => x.path.toLowerCase().includes(f)); if (!got.length) list.createDiv({ cls: "bs-imp-empty", text: "Других досок в хранилище нет" }); for (const x of got.slice(0, 80)) { const r = list.createDiv({ cls: "bs-imp-row" }); const ic = r.createSpan({ cls: "bs-imp-ic" }); api.setIcon(ic, "lucide-layout-dashboard"); r.createSpan({ cls: "bs-imp-t", text: x.basename }); r.createSpan({ cls: "bs-imp-p", text: x.parent && x.parent.path !== "/" ? x.parent.path : "" }); r.onclick = async () => { M.close(); try { this.importBoardText(await app.vault.adapter.read(x.path), x.basename, at); } catch (e) { new api.Notice("Не удалось прочитать доску"); } }; } };
        q.oninput = draw; draw(); const foot = c.createDiv({ cls: "modal-button-container" }); const disk = foot.createEl("button", { text: "С диска…" }); disk.onclick = () => { const i = document.createElement("input"); i.type = "file"; i.accept = ".board"; i.onchange = async () => { const f = i.files[0]; if (!f) return; M.close(); this.importBoardText(await f.text(), f.name, at); }; i.click(); };
        M.open(); setTimeout(() => q.focus(), 40);
      }
      // ----- graph layouts
      layoutMenu(e) {
        const mn = new api.Menu(), it = (t, ic, fn) => mn.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn)), ids = this.sel.size > 1 ? Array.from(this.sel) : null; const sc = ids ? " (выделенные)" : "";
        it("Дерево слева направо" + sc, "lucide-git-fork", () => this.layout("lr", ids)); it("Дерево сверху вниз" + sc, "lucide-git-branch", () => this.layout("td", ids)); it("Радиально" + sc, "lucide-orbit", () => this.layout("radial", ids)); it("Силовая раскладка" + sc, "lucide-network", () => this.layout("force", ids));
        if (this._prevPos) it("Вернуть прежнее расположение", "lucide-undo-2", () => this.restorePos()); mn.addSeparator(); it("По сетке" + sc, "lucide-grid-3x3", () => this.tidy("grid", ids)); it("Расставить блоками" + sc, "lucide-layout-grid", () => this.tidy("cells", ids)); mn.showAtMouseEvent(e);
      }
      layout(mode, ids) {
        if (this.ro) return; ids = (ids && ids.length ? ids : Array.from(this.yn.keys())).filter((i) => this.yn.get(i) && !this.yn.get(i).get("locked")); if (ids.length < 2) return;
        this.keepPos(ids); this.um && this.um.stopCapturing(); const set = new Set(ids), g = (i) => this.yn.get(i), W = (i) => g(i).get("w"), H = (i) => this.effH(g(i)), out = new Map(), und = new Map(), dir = new Map(); for (const i of ids) { und.set(i, new Set()); dir.set(i, new Set()); }
        for (const e of this.ye.values()) { const a = e.get("a"), b = e.get("b"); if (set.has(a) && set.has(b) && a !== b) { und.get(a).add(b); und.get(b).add(a); dir.get(a).add(b); } }
        const bb = this.bounds(ids), gapX = 90, gapY = 40; const seen = new Set(), comps = [];
        for (const i of ids) { if (seen.has(i)) continue; const comp = [], st = [i]; seen.add(i); while (st.length) { const v = st.pop(); comp.push(v); for (const n of und.get(v)) if (!seen.has(n)) { seen.add(n); st.push(n); } } comps.push(comp); }
        comps.sort((a, b) => b.length - a.length); let cursor = 0;
        const place = (comp, kind) => {
          if (comp.length === 1) { const i = comp[0]; return { pos: new Map([[i, [0, 0]]]), w: W(i), h: H(i) }; }
          const indeg = new Map(comp.map((v) => [v, 0])); for (const v of comp) for (const n of dir.get(v)) indeg.set(n, (indeg.get(n) || 0) + 1);
          let roots = comp.filter((v) => !indeg.get(v)); if (!roots.length) roots = [comp.slice().sort((a, b) => und.get(b).size - und.get(a).size)[0]]; else roots.sort((a, b) => und.get(b).size - und.get(a).size);
          const depth = new Map(), par = new Map(), q = []; for (const r of roots) { depth.set(r, 0); q.push(r); } for (let h = 0; h < q.length; h++) { const v = q[h]; for (const n of und.get(v)) if (!depth.has(n)) { depth.set(n, depth.get(v) + 1); par.set(n, v); q.push(n); } }
          if (kind === "force") {
            const P = new Map(comp.map((v, k) => [v, [g(v).get("x") + W(v) / 2 + (Math.random() - .5) * 40, g(v).get("y") + H(v) / 2 + (Math.random() - .5) * 40 + k * 0.01]])); const area = comp.length * 340 * 220, kk = Math.sqrt(area / comp.length) * 0.9; let temp = kk;
            const es = []; for (const v of comp) for (const n of dir.get(v)) es.push([v, n]);
            for (let it2 = 0; it2 < 320; it2++) { const D = new Map(comp.map((v) => [v, [0, 0]]));
              for (let a = 0; a < comp.length; a++) for (let b = a + 1; b < comp.length; b++) { const u = comp[a], v = comp[b], pu = P.get(u), pv = P.get(v); let dx = pu[0] - pv[0], dy = pu[1] - pv[1], d = Math.hypot(dx, dy) || 0.01; const ext = (W(u) + W(v)) / 2 + 40, f = (kk * kk) / d * (d < ext + 60 ? 3 : 1); dx /= d; dy /= d; D.get(u)[0] += dx * f; D.get(u)[1] += dy * f; D.get(v)[0] -= dx * f; D.get(v)[1] -= dy * f; }
              for (const [u, v] of es) { const pu = P.get(u), pv = P.get(v); let dx = pu[0] - pv[0], dy = pu[1] - pv[1], d = Math.hypot(dx, dy) || 0.01; const f = (d * d) / kk; dx /= d; dy /= d; D.get(u)[0] -= dx * f; D.get(u)[1] -= dy * f; D.get(v)[0] += dx * f; D.get(v)[1] += dy * f; }
              for (const v of comp) { const d = D.get(v), l = Math.hypot(d[0], d[1]) || 1, m = Math.min(l, temp); P.get(v)[0] += d[0] / l * m; P.get(v)[1] += d[1] / l * m; } temp *= 0.985; }
            let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9; const pos = new Map(); for (const v of comp) { const c = P.get(v); const x = c[0] - W(v) / 2, y = c[1] - H(v) / 2; pos.set(v, [x, y]); x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x + W(v)); y2 = Math.max(y2, y + H(v)); }
            for (const [v, c] of pos) { c[0] -= x1; c[1] -= y1; } return { pos, w: x2 - x1, h: y2 - y1 };
          }
          const kids = new Map(comp.map((v) => [v, []])); for (const [n, p] of par) kids.get(p).push(n); for (const v of comp) if (!depth.has(v)) { depth.set(v, 0); roots.push(v); }
          if (kind === "radial") {
            const leaves = new Map(); const cnt = (v) => { if (leaves.has(v)) return leaves.get(v); const k = kids.get(v); const n = k.length ? k.reduce((s2, c) => s2 + cnt(c), 0) : 1; leaves.set(v, n); return n; }; const root = roots[0]; for (const r of roots) cnt(r);
            const mw = Math.max.apply(null, comp.map(W)), mh = Math.max.apply(null, comp.map(H)), step = Math.max(mw, mh) + 130, pos = new Map(), ang = (v, a0, a1) => { const a = (a0 + a1) / 2, r = depth.get(v) * step; pos.set(v, [Math.cos(a) * r, Math.sin(a) * r]); let s0 = a0; for (const c of kids.get(v)) { const sp = (a1 - a0) * leaves.get(c) / leaves.get(v); ang(c, s0, s0 + sp); s0 += sp; } };
            if (roots.length === 1) ang(root, 0, Math.PI * 2); else { let s0 = 0; const tot = roots.reduce((s2, r) => s2 + leaves.get(r), 0); for (const r of roots) { const sp = Math.PI * 2 * leaves.get(r) / tot; ang(r, s0, s0 + sp); s0 += sp; } }
            let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9; for (const [v, c] of pos) { c[0] -= W(v) / 2; c[1] -= H(v) / 2; x1 = Math.min(x1, c[0]); y1 = Math.min(y1, c[1]); x2 = Math.max(x2, c[0] + W(v)); y2 = Math.max(y2, c[1] + H(v)); } for (const [, c] of pos) { c[0] -= x1; c[1] -= y1; } return { pos, w: x2 - x1, h: y2 - y1 };
          }
          // layered tree: each level is a column (left to right) or a row (top down)
          const lr = kind === "lr", layers = []; for (const v of comp) (layers[depth.get(v)] = layers[depth.get(v)] || []).push(v);
          const order = new Map(); layers.forEach((L) => L.forEach((v, k) => order.set(v, k))); for (let sweep = 0; sweep < 3; sweep++) for (let d = 1; d < layers.length; d++) { const L = layers[d]; const bc = (v) => { const ps = Array.from(und.get(v)).filter((n) => depth.get(n) === d - 1); return ps.length ? ps.reduce((s2, n) => s2 + order.get(n), 0) / ps.length : order.get(v); }; L.sort((a, b) => bc(a) - bc(b)); L.forEach((v, k) => order.set(v, k)); }
          const lw = layers.map((L) => Math.max.apply(null, L.map(lr ? W : H))), ext = layers.map((L) => L.reduce((s2, v) => s2 + (lr ? H(v) : W(v)) + (lr ? gapY : 60), -(lr ? gapY : 60))), total = Math.max.apply(null, ext); const pos = new Map(); let off = 0;
          layers.forEach((L, d) => { let t = (total - ext[d]) / 2; for (const v of L) { pos.set(v, lr ? [off, t] : [t, off]); t += (lr ? H(v) : W(v)) + (lr ? gapY : 60); } off += lw[d] + (lr ? gapX : 110); });
          return { pos, w: lr ? off - gapX : total, h: lr ? total : off - 110 };
        };
        this.doc.transact(() => { let yy = bb.y; for (const comp of comps) { const r = place(comp, mode); for (const [v, c] of r.pos) { g(v).set("x", Math.round(bb.x + c[0])); g(v).set("y", Math.round(yy + c[1])); } yy += r.h + 90; } });
        this.um && this.um.stopCapturing(); this.fit(); this.toastUndo("Раскладка применена.");
      }
      // ----- export to a picture (white background for documents)
      exportMenu(e, ids) {
        const mn = new api.Menu(), it = (t, ic, fn) => mn.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn)); const what = ids && ids.length ? "выделенное" : "вся доска";
        it("Копировать картинку, белый фон (" + what + ")", "lucide-clipboard-copy", () => this.exportPng(ids, "white", "clip")); it("Сохранить PNG, белый фон", "lucide-image-down", () => this.exportPng(ids, "white", "file")); it("Сохранить PNG, прозрачный фон", "lucide-image", () => this.exportPng(ids, "none", "file")); it("Сохранить PNG, тёмный фон", "lucide-moon", () => this.exportPng(ids, "dark", "file"));
        if (ids && ids.length) { mn.addSeparator(); it("Сохранить выделенное как новую доску", "lucide-file-plus", () => this.saveSelAsBoard(ids)); } mn.showAtMouseEvent(e);
      }
      async renderExport(o) {
        const ids = o.ids, bg = o.bg;
        const all = ids && ids.length ? ids.filter((i) => this.yn.get(i)) : Array.from(this.yn.keys()); let ink = o.ink === false ? [] : (this._ink ? this._ink.toArray() : []); if (!all.length && !ink.length) return null;
        const dark = bg === "dark", ink1 = dark ? "#e5e7eb" : "#111827", card0 = dark ? "#1f2330" : "#ffffff", line0 = dark ? "#8b93a7" : "#6b7280", bord = dark ? "#3a4052" : "#d1d5db";
        let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9; const grow = (a, b, c, d) => { x1 = Math.min(x1, a); y1 = Math.min(y1, b); x2 = Math.max(x2, c); y2 = Math.max(y2, d); };
        for (const id of all) { const m = this.yn.get(id); grow(m.get("x"), m.get("y"), m.get("x") + m.get("w"), m.get("y") + this.effH(m)); } if (ids && ids.length && all.length) { const nb = { x1, y1, x2, y2 }; ink = ink.filter((st) => { const b = this.inkBox(st); return b.x1 < nb.x2 && b.x2 > nb.x1 && b.y1 < nb.y2 && b.y2 > nb.y1; }); } for (const st of ink) { const b = this.inkBox(st); grow(b.x1, b.y1, b.x2, b.y2); }
        const pad = o.pad == null ? 40 : o.pad, sc = o.scale || 2, cw = Math.min(8000, Math.ceil((x2 - x1 + pad * 2) * sc)), chh = Math.min(8000, Math.ceil((y2 - y1 + pad * 2) * sc)), cv = document.createElement("canvas"); cv.width = cw; cv.height = chh; const ctx = cv.getContext("2d"); ctx.scale(cw / ((x2 - x1 + pad * 2)), chh / ((y2 - y1 + pad * 2))); ctx.translate(pad - x1, pad - y1);
        if (bg !== "none") { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = dark ? "#14161d" : "#ffffff"; ctx.fillRect(0, 0, cw, chh); ctx.restore(); }
        const FONT = '"Segoe UI", system-ui, sans-serif', rrect = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
        const wrap = (text, mw, font) => { ctx.font = font; const out = []; for (const para of String(text).split("\n")) { let line = ""; for (const word of para.split(/(\s+)/)) { const t = line + word; if (ctx.measureText(t).width > mw && line) { out.push(line.trimEnd()); line = word.trimStart(); } else line = t; } out.push(line); } return out; };
        const idSet = new Set(all);
        // links
        ctx.lineWidth = 2; ctx.strokeStyle = line0; ctx.fillStyle = line0; ctx.lineCap = "round";
        for (const e of this.ye.values()) { const a = e.get("a"), b = e.get("b"); if (!idSet.has(a) || !idSet.has(b)) continue; const A = this.center(a), B = this.center(b), p = this.anchor(a, B), q = this.anchor(b, A); if (!p || !q) continue; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); const an = Math.atan2(q.y - p.y, q.x - p.x); ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - 11 * Math.cos(an - 0.4), q.y - 11 * Math.sin(an - 0.4)); ctx.lineTo(q.x - 11 * Math.cos(an + 0.4), q.y - 11 * Math.sin(an + 0.4)); ctx.closePath(); ctx.fill(); const lb = e.get("label"); if (lb) { ctx.font = "12px " + FONT; ctx.textAlign = "center"; const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2, tw = ctx.measureText(lb).width + 10; ctx.fillStyle = dark ? "#14161d" : "#fff"; ctx.fillRect(mx - tw / 2, my - 10, tw, 20); ctx.fillStyle = ink1; ctx.textBaseline = "middle"; ctx.fillText(lb, mx, my); ctx.fillStyle = line0; ctx.textAlign = "left"; } }
        // cards
        for (const id of all) { const m = this.yn.get(id), x = m.get("x"), y = m.get("y"), w = m.get("w"), h = this.effH(m), col = m.get("color") || "", im = m.get("img");
          ctx.save(); rrect(x, y, w, h, 4); ctx.fillStyle = card0; ctx.fill(); if (col) { ctx.globalAlpha = dark ? 0.14 : 0.1; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1; } ctx.lineWidth = col ? 2 : 1.2; ctx.strokeStyle = col || bord; ctx.stroke(); ctx.clip(); let ty = y + 10;
          if (im) { try { const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = im; }); const ah = Math.max(20, h - 22 - (m.get("text").length ? 40 : 6)), r = Math.min((w - 8) / img.naturalWidth, ah / img.naturalHeight), iw = img.naturalWidth * r, ih = img.naturalHeight * r; ctx.drawImage(img, x + (w - iw) / 2, y + 4, iw, ih); ty = y + 4 + ih + 6; } catch (e2) { /* skip */ } }
          ctx.fillStyle = ink1; ctx.textBaseline = "top"; const lines = wrap(m.get("text").toString(), w - 22, "14px " + FONT); ctx.font = "14px " + FONT; for (const ln of lines) { if (ty > y + h - 12) break; ctx.fillText(ln, x + 11, ty); ty += 19.6; } ctx.restore(); }
        // drawing
        for (const st of ink) { ctx.save(); ctx.strokeStyle = st.c || ink1; ctx.fillStyle = st.c || ink1; ctx.lineCap = "round"; ctx.lineJoin = "round"; const sw = st.k === "hl" ? (st.w || 4) * 3 : (st.w || 4); ctx.lineWidth = sw; if (st.k === "hl") ctx.globalAlpha = 0.38;
          if (st.k === "t") { const sz = this.textSize(st); ctx.font = sz + "px " + FONT; ctx.textBaseline = "top"; String(st.txt || "").split("\n").forEach((ln, i) => ctx.fillText(ln, st.a[0], st.a[1] + i * sz * 1.25)); }
          else if (st.k === "pen" || st.k === "hl") { const q = st.pts; ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); if (q.length === 1) ctx.lineTo(q[0][0] + 0.01, q[0][1]); for (let i = 1; i < q.length - 1; i++) ctx.quadraticCurveTo(q[i][0], q[i][1], (q[i][0] + q[i + 1][0]) / 2, (q[i][1] + q[i + 1][1]) / 2); if (q.length > 1) ctx.lineTo(q[q.length - 1][0], q[q.length - 1][1]); ctx.stroke(); }
          else if (st.k === "line" || st.k === "arrow") { ctx.beginPath(); ctx.moveTo(st.a[0], st.a[1]); ctx.lineTo(st.b[0], st.b[1]); ctx.stroke(); if (st.k === "arrow") { const an = Math.atan2(st.b[1] - st.a[1], st.b[0] - st.a[0]), L = 8 + sw * 1.5; ctx.beginPath(); ctx.moveTo(st.b[0], st.b[1]); ctx.lineTo(st.b[0] - L * Math.cos(an - 0.45), st.b[1] - L * Math.sin(an - 0.45)); ctx.lineTo(st.b[0] - L * Math.cos(an + 0.45), st.b[1] - L * Math.sin(an + 0.45)); ctx.closePath(); ctx.fill(); } }
          else if (st.k === "rect") { rrect(Math.min(st.a[0], st.b[0]), Math.min(st.a[1], st.b[1]), Math.abs(st.b[0] - st.a[0]), Math.abs(st.b[1] - st.a[1]), 3); ctx.stroke(); }
          else { ctx.beginPath(); ctx.ellipse((st.a[0] + st.b[0]) / 2, (st.a[1] + st.b[1]) / 2, Math.abs(st.b[0] - st.a[0]) / 2, Math.abs(st.b[1] - st.a[1]) / 2, 0, 0, Math.PI * 2); ctx.stroke(); } ctx.restore(); }
        return cv;
      }
      async exportPng(ids, bg, to) {
        const cv = await this.renderExport({ ids, bg, scale: 2, pad: 40 }); if (!cv) { new api.Notice("Доска пуста"); return; } return this.outputPng(cv, to, ids && ids.length ? " (часть)" : "");
      }
      async outputPng(cv, to, suffix, name) {
        const blob = await new Promise((r) => cv.toBlob(r, "image/png")); if (!blob) { new api.Notice("Не удалось собрать картинку"); return false; }
        if (to === "clip") { try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); new api.Notice("Картинка скопирована, её можно вставить в документ"); return true; } catch (e) { new api.Notice("Буфер обмена недоступен"); return false; } }
        const dir = this.path.replace(/[^/]*$/, ""), base = (name && name.trim()) || ((this.getDisplayText() || "Доска") + (suffix || "")); let n = "", path; do { path = dir + base + n + ".png"; n = n ? n + 1 : 2; } while (app.vault.getAbstractFileByPath(path));
        try { await app.vault.createBinary(path, await blob.arrayBuffer()); new api.Notice("Сохранено: " + path); return true; } catch (e) { new api.Notice("Не удалось сохранить файл"); return false; }
      }
      exportDialog() {
        const M = new api.Modal(app); M.modalEl.addClass("bs-exp"); M.titleEl.setText("Экспорт в картинку"); const c = M.contentEl, sel = Array.from(this.sel).filter((i) => this.yn.get(i));
        const o = { scope: sel.length ? "sel" : "all", bg: "white", scale: 2, pad: 40, ink: true }; const body = c.createDiv({ cls: "bs-exp-body" }), pv = body.createDiv({ cls: "bs-exp-pv" }), opts = body.createDiv({ cls: "bs-exp-opts" }); const info = pv.createDiv({ cls: "bs-exp-info" }); let cvEl = null, tk = 0, tm = 0;
        const seg = (title, list, key) => { opts.createDiv({ cls: "bs-exp-l", text: title }); const g = opts.createDiv({ cls: "bs-exp-seg" }); const bs = []; for (const [v, t, dis] of list) { const b = g.createDiv({ cls: "bs-exp-b" + (dis ? " is-dis" : ""), text: t }); b.onclick = () => { if (dis) return; o[key] = v; bs.forEach(([x, y]) => y.classList.toggle("is-on", x === v)); draw(); }; b.classList.toggle("is-on", o[key] === v); bs.push([v, b]); } };
        seg("Что экспортировать", [["all", "Вся доска"], ["sel", "Выделенное" + (sel.length ? " (" + sel.length + ")" : ""), !sel.length]], "scope"); seg("Фон картинки", [["white", "Белый"], ["none", "Прозрачный"], ["dark", "Тёмный"]], "bg"); seg("Размер картинки", [[1, "1×"], [2, "2×"], [3, "3×"]], "scale"); seg("Поля картинки", [[0, "Без полей"], [20, "Малые"], [40, "Средние"], [80, "Большие"]], "pad");
        const lb = opts.createEl("label", { cls: "bs-exp-ck" }); const ck = lb.createEl("input", { attr: { type: "checkbox" } }); ck.checked = true; lb.createSpan({ text: " Включить рисунок" }); ck.onchange = () => { o.ink = ck.checked; draw(); };
        opts.createDiv({ cls: "bs-exp-l", text: "Имя файла" }); const nm = opts.createEl("input", { attr: { placeholder: (this.getDisplayText() || "Доска"), spellcheck: "false" } }); nm.style.width = "100%";
        const build = () => this.renderExport({ ids: o.scope === "sel" ? sel : null, bg: o.bg, scale: o.scale, pad: o.pad, ink: o.ink });
        const draw = () => { clearTimeout(tm); tm = setTimeout(async () => { const my = ++tk; const cv = await build(); if (my !== tk) return; if (cvEl) cvEl.remove(); if (!cv) { info.setText("Нечего экспортировать"); return; } cvEl = pv.createEl("canvas", { cls: "bs-exp-cv" }); cvEl.width = cv.width; cvEl.height = cv.height; cvEl.getContext("2d").drawImage(cv, 0, 0); pv.dataset.bg = o.bg; info.setText(cv.width + " × " + cv.height + " px"); }, 120); };
        const foot = c.createDiv({ cls: "modal-button-container" }); const cl = foot.createEl("button", { text: "Закрыть" }), cp = foot.createEl("button", { text: "Копировать" }), sv = foot.createEl("button", { text: "Сохранить PNG", cls: "mod-cta" });
        cl.onclick = () => M.close(); cp.onclick = async () => { const cv = await build(); if (cv) this.outputPng(cv, "clip"); }; sv.onclick = async () => { const cv = await build(); if (cv && await this.outputPng(cv, "file", o.scope === "sel" ? " (часть)" : "", nm.value)) M.close(); };
        M.open(); draw();
      }
      // ---------- version history ----------
      histDir() { return ".basalt-history/" + this.path.replace(/[\\/]/g, "__") + "/"; }
      snapData() { const nodes = []; this.yn.forEach((m, id) => nodes.push({ id, x: m.get("x"), y: m.get("y"), w: m.get("w"), h: m.get("h"), color: m.get("color") || "", text: m.get("text") ? m.get("text").toString() : "", img: m.get("img") || "", fold: !!m.get("fold"), locked: !!m.get("locked") })); const edges = []; this.ye.forEach((m) => edges.push({ a: m.get("a"), b: m.get("b"), label: m.get("label") || "" })); return { v: 1, t: Date.now(), nodes, edges, ink: this._ink ? this._ink.toArray() : [] }; }
      async snapshot(force) {
        if (!this.doc || !this.path || this.ro && !force) return false; const d = this.snapData(); if (!d.nodes.length && !d.ink.length) return false; const body = JSON.stringify({ nodes: d.nodes, edges: d.edges, ink: d.ink }); if (!force && body === this._lastSnap) return false; this._lastSnap = body; this._lastSnapT = Date.now();
        try { const dir = this.histDir(), ad = app.vault.adapter; if (!(await ad.exists(".basalt-history"))) await ad.mkdir(".basalt-history"); if (!(await ad.exists(dir))) await ad.mkdir(dir); await ad.write(dir + d.t + ".json", JSON.stringify(d)); const ls = (await ad.list(dir)).files.sort(); for (const f of ls.slice(0, Math.max(0, ls.length - 40))) await ad.remove(f); return true; } catch (e) { console.error(e); return false; }
      }
      startHistory() { clearInterval(this._hT); this._hT = setInterval(() => { if (Date.now() - (this._lastSnapT || 0) > 180000) this.snapshot(); }, 60000); }
      restoreSnap(d) {
        if (this.ro) return; const Y = window.__bsY.Y; this.um && this.um.stopCapturing(); this.doc.transact(() => {
          for (const id of Array.from(this.yn.keys())) this.yn.delete(id); for (const id of Array.from(this.ye.keys())) this.ye.delete(id); const a = this.inkArr(); if (a && a.length) a.delete(0, a.length);
          for (const n of d.nodes) { const m = new Y.Map(), t = new Y.Text(); t.insert(0, n.text || ""); m.set("x", n.x); m.set("y", n.y); m.set("w", n.w); m.set("h", n.h); m.set("color", n.color || ""); m.set("by", me.name); if (n.img) m.set("img", n.img); if (n.fold) m.set("fold", true); if (n.locked) m.set("locked", true); this.stampM(m); m.set("text", t); this.yn.set(n.id, m); }
          for (const e of d.edges) { const m = new Y.Map(); m.set("a", e.a); m.set("b", e.b); m.set("label", e.label || ""); this.ye.set(uid(), m); } if (a && d.ink && d.ink.length) a.push(d.ink);
        }); this.um && this.um.stopCapturing(); this.select(new Set()); this.fit(); new api.Notice("Версия восстановлена. Ctrl+Z вернёт текущее состояние.");
      }
      async historyDialog() {
        const M = new api.Modal(app); M.modalEl.addClass("bs-imp"); M.titleEl.setText("История версий"); const c = M.contentEl, ad = app.vault.adapter, dir = this.histDir(); const note = c.createDiv({ cls: "bs-imp-top" }); note.createSpan({ text: "Версии сохраняются сами каждые несколько минут, пока вы работаете. Хранятся последние 40." }); const list = c.createDiv({ cls: "bs-imp-list" });
        const draw = async () => { list.empty(); let files = []; try { if (await ad.exists(dir)) files = (await ad.list(dir)).files.sort().reverse(); } catch (e) { /* none */ } if (!files.length) list.createDiv({ cls: "bs-imp-empty", text: "Пока нет сохранённых версий" });
          for (const f of files) { const ts = +f.replace(/^.*\//, "").replace(/\.json$/, ""), r = list.createDiv({ cls: "bs-imp-row" }); const ic = r.createSpan({ cls: "bs-imp-ic" }); api.setIcon(ic, "lucide-history"); r.createSpan({ cls: "bs-imp-t", text: new Date(ts).toLocaleString("ru-RU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }) }); const meta = r.createSpan({ cls: "bs-imp-p", text: "" });
            ad.read(f).then((t) => { try { const d = JSON.parse(t); meta.setText(d.nodes.length + " карточек, " + d.edges.length + " связей"); } catch (e) { /* bad file */ } });
            const rs = r.createEl("button", { text: "Восстановить" }), cp = r.createEl("button", { text: "Копией" }); rs.style.cssText = cp.style.cssText = "height:26px;padding:0 10px;font-size:12px";
            rs.onclick = async (ev) => { ev.stopPropagation(); try { const d = JSON.parse(await ad.read(f)); await this.snapshot(true); this.restoreSnap(d); M.close(); } catch (e) { new api.Notice("Не удалось восстановить версию"); } };
            cp.onclick = async (ev) => { ev.stopPropagation(); try { const d = JSON.parse(await ad.read(f)), Y = window.__bsY.Y, doc = new Y.Doc(), nn = doc.getMap("nodes"), ee = doc.getMap("edges"); doc.transact(() => { for (const n of d.nodes) { const m = new Y.Map(), t = new Y.Text(); t.insert(0, n.text || ""); for (const k of ["x", "y", "w", "h", "color", "img", "fold"]) if (n[k] != null && n[k] !== "") m.set(k, n[k]); m.set("text", t); nn.set(n.id, m); } for (const e of d.edges) { const m = new Y.Map(); m.set("a", e.a); m.set("b", e.b); m.set("label", e.label || ""); ee.set(uid(), m); } const a = doc.getArray("ink"); if (d.ink && d.ink.length) a.push(d.ink); doc.getMap("meta").set("id", uid() + uid()); }); const out = { v: 2, id: doc.getMap("meta").get("id"), room: null, nodes: {}, edges: ee.toJSON(), ydoc: b64(Y.encodeStateAsUpdate(doc)) }; const bdir = this.path.replace(/[^/]*$/, ""); let n = "", path; do { path = bdir + this.getDisplayText() + " (версия)" + n + "." + EXT; n = n ? n + 1 : 2; } while (app.vault.getAbstractFileByPath(path)); await app.vault.create(path, JSON.stringify(out)); new api.Notice("Создана доска: " + path); M.close(); } catch (e) { new api.Notice("Не удалось создать копию"); } }; } };
        await draw(); const foot = c.createDiv({ cls: "modal-button-container" }); const now = foot.createEl("button", { text: "Сохранить версию сейчас", cls: "mod-cta" }); now.onclick = async () => { await this.snapshot(true); await draw(); }; foot.createEl("button", { text: "Закрыть" }).onclick = () => M.close(); M.open();
      }
      async saveSelAsBoard(ids) {
        const Y = window.__bsY.Y, d = new Y.Doc(), nn = d.getMap("nodes"), ee = d.getMap("edges"), set = new Set(ids), map = {}; d.transact(() => {
          for (const id of ids) { const m = this.yn.get(id); if (!m) continue; const c = new Y.Map(), t = new Y.Text(); t.insert(0, m.get("text").toString()); for (const k of ["x", "y", "w", "h", "color", "by", "img", "fold"]) if (m.get(k) != null) c.set(k, m.get(k)); c.set("text", t); map[id] = id; nn.set(id, c); }
          for (const e of this.ye.values()) if (set.has(e.get("a")) && set.has(e.get("b"))) { const c = new Y.Map(); c.set("a", e.get("a")); c.set("b", e.get("b")); c.set("label", e.get("label") || ""); ee.set(uid(), c); } d.getMap("meta").set("id", uid() + uid()); });
        const out = { v: 2, id: d.getMap("meta").get("id"), room: null, nodes: {}, edges: ee.toJSON(), ydoc: b64(Y.encodeStateAsUpdate(d)) }; const dir = this.path.replace(/[^/]*$/, ""), base = (this.getDisplayText() || "Доска") + " (часть)"; let n = "", path; do { path = dir + base + n + "." + EXT; n = n ? n + 1 : 2; } while (app.vault.getAbstractFileByPath(path));
        try { await app.vault.create(path, JSON.stringify(out)); new api.Notice("Создана доска: " + path); } catch (e) { new api.Notice("Не удалось создать доску"); }
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
        const sig = ids.length + "|" + ids.map((i) => (this.yn.get(i).get("locked") ? 1 : 0) + (this.yn.get(i).get("fold") ? "f" : "") + (this.yn.get(i).get("trOrig") != null ? "t" : "")).join(""); if (bar.dataset.sig !== sig) {
          bar.dataset.sig = sig; bar.empty(); const mk = (ic, tip, fn) => { const x = bar.createDiv({ cls: "osb-sb", attr: { title: tip } }); api.setIcon(x, ic); x.onclick = (e) => fn(e); return x; };
          const hasOrig = ids.some((i) => this.yn.get(i).get("trOrig") != null); const cols = new Set(ids.map((i) => this.yn.get(i).get("color") || "")), cur = cols.size === 1 ? Array.from(cols)[0] : ""; const cb = bar.createDiv({ cls: "osb-sb osb-colorbtn", attr: { title: "Цвет" } }); const ci = cb.createSpan({ cls: "osb-cico" }); api.setIcon(ci, "lucide-palette"); const cbar = cb.createDiv({ cls: "osb-cbar" }); if (cur) cbar.style.background = cur; else cbar.classList.add("is-none"); cb.onclick = () => window.__bsColors.pick(cb, cur, (c) => this.setColor(c));
          bar.createDiv({ cls: "osb-bsep" }); mk("lucide-copy", "Дублировать (Ctrl+D)", () => this.duplicate());
          const locked = ids.every((i) => this.yn.get(i).get("locked")); mk(locked ? "lucide-unlock" : "lucide-lock", locked ? "Разблокировать" : "Закрепить на месте", () => this.setLock(!locked));
          if (ids.length > 1) mk("lucide-align-horizontal-distribute-center", "Выровнять", (e) => this.alignMenu(e));
          if (ids.length > 1) mk("lucide-layout-grid", "Упорядочить", (e) => this.tidyMenu(e, ids));
          const folded = ids.every((i) => this.yn.get(i).get("fold")); mk(folded ? "lucide-chevrons-up-down" : "lucide-chevrons-down-up", folded ? "Развернуть" : "Свернуть (Z)", () => this.setFold(!folded));
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
          { const im = m.get("img") || ""; if (im && !e.img) { e.img = document.createElement("img"); e.img.className = "osb-img"; e.img.draggable = false; e.el.insertBefore(e.img, e.ta); } if (e.img) { if (!im) { e.img.remove(); e.img = null; } else if (e.img.dataset.s !== String(im.length)) { e.img.src = im; e.img.dataset.s = String(im.length); } } e.el.classList.toggle("has-img", !!im); e.el.classList.toggle("is-fold", !!m.get("fold")); }
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
      effH(m) { return m.get("fold") ? 52 : m.get("h"); }
      anchor(id, toward) { const m = this.yn.get(id); if (!m) return null; const x = m.get("x"), y = m.get("y"), w = m.get("w"), h = this.effH(m), cx = x + w / 2, cy = y + h / 2, dx = toward.x - cx, dy = toward.y - cy; if (!dx && !dy) return { x: cx, y: cy }; const k = Math.min(dx ? (w / 2) / Math.abs(dx) : 1e9, dy ? (h / 2) / Math.abs(dy) : 1e9); return { x: cx + dx * k, y: cy + dy * k }; }
      center(id) { const m = this.yn.get(id); return m ? { x: m.get("x") + m.get("w") / 2, y: m.get("y") + this.effH(m) / 2 } : null; }
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
      applyCam() { if (!this.world) return; if (this.draw && this._ck !== this.cam.k) { this._ck = this.cam.k; this.drawCursor(); } if (this.resetBtn) this.resetBtn.title = "Масштаб " + Math.round(this.cam.k * 100) + "% (клик — 100%)"; this.renderSelBar(); const c = this.cam; this.world.style.transform = "translate(" + (this.root.clientWidth / 2 - c.x * c.k) + "px," + (this.root.clientHeight / 2 - c.y * c.k) + "px) scale(" + c.k + ")"; this.paintPeers(); }
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
          const p = this.pt(e), w = this.worldPt(p.sx, p.sy); this.myCur = w; const d = this.drag; if (this.ringEl) { if (this.draw && !e.target.closest(".osb-dtb, .osb-rail, .osb-sel")) { this.ringEl.style.transform = "translate(" + p.sx + "px," + p.sy + "px)"; this.ringEl.style.opacity = "1"; } else this.ringEl.style.opacity = "0"; }
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
        const up = (e) => { const d = this.drag; this.drag = null; if (d && d.kind === "ink") this.endInk(d); r.classList.remove("is-panning"); this.clearGuides(); if (d && d.kind === "pan" && !d.moved && !this.ro) { this.select(new Set()); this.selEdge = null; this.mark(); } if (d && d.kind === "box") { this.box.style.display = "none"; if (d.live) this.publish(); } this.renderSelBar(); if (d && (d.kind === "move" || d.kind === "size") && !this.ro && d.moved) { const ids = d.kind === "move" ? Array.from(d.o.keys()) : [d.id]; this.doc.transact(() => { for (const i of ids) { const m = this.yn.get(i); if (m) this.stampM(m); } }); for (const i of ids) this.feed("move", i, this.label(i)); } if (this.temp) { this.temp.remove(); this.temp = null; } if (this.lt) { const o = this.els.get(this.lt); if (o) o.el.classList.remove("is-linktgt"); this.lt = null; } if (d && d.kind === "link") { const p = this.pt(e), w = this.worldPt(p.sx, p.sy), t = this.linkTarget(w, d.from); if (t) this.addEdge(d.from, t); else { const near = Array.from(this.yn.entries()).some(([i, m]) => i !== d.from && w.x >= m.get("x") && w.x <= m.get("x") + m.get("w") && w.y >= m.get("y") && w.y <= m.get("y") + m.get("h")); if (!near && Math.hypot(w.x - this.center(d.from).x, w.y - this.center(d.from).y) > 40) { const id = this.addCard(w.x - 130, w.y - 30); this.addEdge(d.from, id); } } } };
        r.addEventListener("pointerleave", () => { if (this.ringEl) this.ringEl.style.opacity = "0"; }); r.addEventListener("pointerup", up); r.addEventListener("pointercancel", up);
        r.addEventListener("wheel", (e) => {
          const ta = e.target.closest && e.target.closest(".osb-ta"); if (ta && !e.ctrlKey && ta.scrollHeight > ta.clientHeight) return; e.preventDefault();
          const mouse = e.deltaMode === 1 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 100 && (Math.abs(e.deltaY) % 100 === 0 || Math.abs(e.deltaY) % 120 === 0));
          if (e.ctrlKey || mouse) { const p = this.pt(e), b = this.worldPt(p.sx, p.sy); this.cam.k = Math.max(.1, Math.min(3, this.cam.k * Math.exp(-(e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY) * (e.ctrlKey ? .01 : .0015)))); const a = this.worldPt(p.sx, p.sy); this.cam.x += b.x - a.x; this.cam.y += b.y - a.y; }
          else { this.cam.x += (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) / this.cam.k; this.cam.y += (e.shiftKey && !e.deltaX ? 0 : e.deltaY) / this.cam.k; }
          this.applyCam();
        }, { passive: false });
        r.addEventListener("dragover", (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) e.preventDefault(); });
        r.addEventListener("drop", (e) => { const fs = e.dataTransfer && Array.from(e.dataTransfer.files || []); if (!fs || !fs.length || this.ro) return; e.preventDefault(); const p = this.pt(e), w = this.worldPt(p.sx, p.sy); let i = 0; for (const f of fs) { if (/^image\//.test(f.type)) this.addImageFile(f, w.x + i * 30, w.y + i * 30), i++; else if (/\.board$/i.test(f.name)) f.text().then((t) => this.importBoardText(t, f.name, w)); } });
        r.addEventListener("dblclick", (e) => { if (e.target.closest(".osb-card, g")) return; const p = this.pt(e), w = this.worldPt(p.sx, p.sy); this.addCard(w.x - 130, w.y - 30); });
        r.addEventListener("contextmenu", (e) => {
          e.preventDefault(); if (!this.doc) return; const M = api.Menu; const m = new M(), p = this.pt(e), w = this.worldPt(p.sx, p.sy), it = (t, ic, fn) => m.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn));
          const card = e.target.closest && e.target.closest(".osb-card"), eg = e.target.closest && e.target.closest("g");
          if (card) {
            const id = card.dataset.id; if (!this.sel.has(id)) this.select(new Set([id]));
            it("Дублировать", "lucide-copy", () => { for (const s of Array.from(this.sel)) { const n = this.yn.get(s); if (n) this.addCard(n.get("x") + 30, n.get("y") + 30, n.get("text").toString()); } });
            it("Экспорт выделенного…", "lucide-image-down", () => this.exportDialog()); it("Копировать текст", "lucide-clipboard", () => { const n = this.yn.get(id); if (n) navigator.clipboard.writeText(n.get("text").toString()).catch(() => {}); });
            it("На передний план", "lucide-bring-to-front", () => { const n = this.yn.get(id), e2 = this.els.get(id); if (e2) this.cards.appendChild(e2.el); });
            m.addSeparator(); it("Удалить", "lucide-trash-2", () => this.removeSel());
          } else if (eg) {
            const id = Array.from(this.edgeEls).find(([, r2]) => r2.g === eg || eg.contains(r2.g))?.[0]; const ed = id && this.ye.get(id);
            if (ed) { it("Подписать связь", "lucide-type", () => this.editLabel(id)); m.addSeparator(); it("Удалить связь", "lucide-trash-2", () => { this.feed("unlink", null, ""); this.ye.delete(id); }); }
          } else {
            it("Новая карточка здесь", "lucide-square-plus", () => this.addCard(w.x - 130, w.y - 30)); it("Вставить изображение…", "lucide-image-plus", () => this.pickImage(w)); it("Импортировать доску…", "lucide-file-input", () => this.importDialog(w)); it("Раскладка графа…", "lucide-network", () => this.layoutMenu(e)); it("Экспорт в картинку…", "lucide-image-down", () => this.exportDialog()); it("История версий…", "lucide-history", () => this.historyDialog()); if (this._prevPos) it("Вернуть прежнее расположение", "lucide-undo-2", () => this.restorePos()); it("Показать или скрыть правую панель", "lucide-panel-right", () => { try { const sp = app.workspace.rightSplit; sp.collapsed ? sp.expand() : sp.collapse(); } catch (er) { /* no side panel */ } });
            it("Вставить текст карточкой", "lucide-clipboard-paste", async () => { try { const t = await navigator.clipboard.readText(); if (t) this.addCard(w.x - 130, w.y - 30, t); } catch (er) { /* no access */ } });
            m.addSeparator(); if (this.yn.size > 1) { it("Упорядочить всё по сетке", "lucide-grid-3x3", () => this.tidy("grid", null)); it("Расставить сеткой", "lucide-layout-grid", () => this.tidy("cells", null)); m.addSeparator(); } it("Показать всё", "lucide-maximize", () => this.fit());
          }
          m.showAtMouseEvent(e);
        });
        this.contentEl.tabIndex = 0;
        this.contentEl.addEventListener("keyup", (e) => { if (e.code === "Space") { this.space = false; this.root.classList.remove("is-hand"); } });
        this.contentEl.addEventListener("keydown", (e) => {
          const inField = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName), mod = e.ctrlKey || e.metaKey, k = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
          if (mod && k === "f") { e.preventDefault(); this.toggleSearch(true); return; } if (inField) return;
          if (e.code === "Space" && !inField) { this.space = true; this.root.classList.add("is-hand"); e.preventDefault(); return; }
          if (this.draw) { if (e.key === "Escape") this.toggleDraw(false); else if ((e.key === "Delete" || e.key === "Backspace") && this.inkSet && this.inkSet.size) { this.inkDeleteSel(); } else if (mod && k === "a" && this.tool === "select") { e.preventDefault(); this.inkSelect(new Set((this._ink ? this._ink.toArray() : []).map((q) => q.id))); return; } else if (k === "v" && !mod) this.setTool("select"); else if (k === "h" && !mod) this.setTool("hl"); else if (k === "t" && !mod) this.setTool("text"); else if (k === "p") this.setTool("pen"); else if (k === "e") this.setTool("eraser"); else if (k === "l") this.setTool("line"); else if (k === "r") this.setTool("rect"); else if (k === "o") this.setTool("ellipse"); else if (k === "a" && !mod) this.setTool("arrow"); if (!mod) return; }
          if (this.ro) { if (k === "f") this.fit(); return; }
          if (mod && k === "a") { e.preventDefault(); this.select(new Set(this.yn.keys())); }
          else if (mod && k === "z") { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); } else if (mod && k === "y") { e.preventDefault(); this.redo(); }
          else if (mod && k === "c") { this.copy(); } else if (mod && k === "x") { this.copy(); this.removeSel(); } else if (mod && k === "v") { e.preventDefault(); this.pasteAny(); }
          else if (mod && k === "d") { e.preventDefault(); this.duplicate(); }
          else if ((e.key === "Delete" || e.key === "Backspace") && (this.sel.size || this.selEdge)) { e.preventDefault(); this.removeSel(); }
          else if (e.key === "Escape") { this.select(new Set()); this.selEdge = null; this.mark(); this.toggleSearch(false); }
          else if (k === "z" && !mod) { const ids = Array.from(this.sel); if (ids.length) this.setFold(!ids.every((i) => this.yn.get(i) && this.yn.get(i).get("fold"))); } else if (k === "f" && !mod) this.fit(); else if (k === "n" && !mod) { const w = this.myCur || this.worldPt(this.root.clientWidth / 2, this.root.clientHeight / 2); this.addCard(w.x - 130, w.y - 30); }
          else if (e.key === "+" || e.key === "=") this.zoomBy(1.25); else if (e.key === "-") this.zoomBy(1 / 1.25);
          else if (e.key.startsWith("Arrow") && this.sel.size) { e.preventDefault(); const st = e.shiftKey ? 10 : 1, dx = e.key === "ArrowLeft" ? -st : e.key === "ArrowRight" ? st : 0, dy = e.key === "ArrowUp" ? -st : e.key === "ArrowDown" ? st : 0; this.doc.transact(() => { for (const id of this.sel) { const m = this.yn.get(id); if (m && !m.get("locked")) { m.set("x", m.get("x") + dx); m.set("y", m.get("y") + dy); } } }); }
        });
      }
      // the card the arrow is aimed at: the one under the pointer, or the nearest one within a few pixels
      linkTarget(w, from) {
        const tol = 30 / this.cam.k; let best = null, bd = 1e9;
        for (const [id, m] of this.yn.entries()) { if (id === from) continue; const x = m.get("x"), y = m.get("y"), cw = m.get("w"), ch = m.get("h"), dx = Math.max(x - w.x, 0, w.x - (x + cw)), dy = Math.max(y - w.y, 0, w.y - (y + ch)), d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = id; } }
        return bd <= tol ? best : null;
      }
      drawTemp(w) {
        const NS = "http://www.w3.org/2000/svg"; if (!this.temp) { this.temp = document.createElementNS(NS, "line"); this.temp.setAttribute("class", "osb-el osb-temp"); this.temp.style.transition = "none"; this.svg.appendChild(this.temp); } const from = this.drag.from; if (!this.center(from)) return;
        const t = this.linkTarget(w, from); if (t !== this.lt) { if (this.lt) { const o = this.els.get(this.lt); if (o) o.el.classList.remove("is-linktgt"); } this.lt = t; if (t) { const o = this.els.get(t); if (o) o.el.classList.add("is-linktgt"); } }
        let end = w; if (t) { const c = this.center(t), q = this.anchor(t, this.center(from)); end = q || c; } const a = this.anchor(from, t ? this.center(t) : w);
        this.temp.setAttribute("x1", a.x); this.temp.setAttribute("y1", a.y); this.temp.setAttribute("x2", end.x); this.temp.setAttribute("y2", end.y);
      }
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
      async onClose() { clearTimeout(this.saveT); clearInterval(this._hT); try { await this.snapshot(); } catch (e) { /* history is optional */ } await this.save(); if (this.sh) { if (this.sh.aw && this.pc) this.sh.aw.off("change", this.pc); this.sh.publish({ board: null, cur: null }); } else { if (this.prov) this.prov.destroy(); if (this.doc) this.doc.destroy(); } if (this.rso) this.rso.disconnect(); }
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
