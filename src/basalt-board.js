// Basalt board: a free canvas of cards (any text) joined by links, stored as a CRDT (Yjs) so several people edit it at once.
// A board is a ".board" file in the vault. Every peer keeps a full copy; peers find each other over WebRTC (room + password = invite code).
(() => {
  "use strict";
  const VIEW = "basalt-board", EXT = "board", TEXT_EXT = /^(md|markdown|txt|csv|tsv|json|ya?ml|toml|ini|log|xml|html?|css|js|mjs|ts|tsx|jsx|py|rs|go|java|c|cpp|h|cs|sh|ps1|sql)$/;
  // big boards: below CULL_MIN cards everything is drawn in full as before; above it only cards near the view get a DOM node, and below zoom LOD_K they are plain rectangles
  const CULL_MIN = 120, LOD_K = 0.32, MD_CAP = 4000, LITE_CAP = 12000, EDGE_CAP = 9000, INK_SVG_MAX = 1500;
  const COLORS = ["", "#e5484d", "#f59f3b", "#d6b43c", "#46a758", "#3fa7d6", "#8e6bd8"];
  const PEER = ["#e5484d", "#f59f3b", "#3fa7d6", "#46a758", "#8e6bd8", "#c0699f", "#d6b43c"];
  // Buffer (when the renderer has it) is about ten times faster than building a binary string, and big boards are mostly this
  const b64 = (u8) => { if (typeof Buffer !== "undefined") return Buffer.from(u8.buffer, u8.byteOffset, u8.length).toString("base64"); let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => { if (typeof Buffer !== "undefined") { const b = Buffer.from(s, "base64"); return new Uint8Array(b.buffer, b.byteOffset, b.length); } return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const signalingList = () => { try { const j = JSON.parse(localStorage.getItem("board-signaling") || "null"); if (Array.isArray(j) && j.length) return j; } catch (e) { /* default */ } return []; };
  const me = (() => { try { const j = JSON.parse(localStorage.getItem("board-me") || "null"); if (j) return j; } catch (e) { /* none */ } const j = { name: "Участник " + uid().slice(0, 3), color: PEER[Math.floor(Math.random() * PEER.length)] }; try { localStorage.setItem("board-me", JSON.stringify(j)); } catch (e) { /* private */ } return j; })();
  const ask = (title, def, opts) => new Promise((res) => {
    opts = opts || {}; const M = new window.__bsApi.Modal(app); M.modalEl.addClass("bs-ask"); M.titleEl.setText(title); let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
    if (opts.hint) M.contentEl.createDiv({ cls: "bs-ask-hint", text: opts.hint });
    const i = M.contentEl.createEl("input", { cls: "bs-ask-in", attr: { spellcheck: "false" } }); if (opts.max) i.maxLength = opts.max; i.value = def || ""; const row = M.contentEl.createDiv({ cls: "modal-button-container" });
    const no = row.createEl("button", { text: "Отмена" }); no.onclick = () => { fin(null); M.close(); }; const ok = row.createEl("button", { text: "OK", cls: "mod-cta" }); ok.onclick = () => { fin(i.value.trim()); M.close(); };
    i.onkeydown = (e) => { if (e.key === "Enter") ok.click(); }; M.onClose = () => fin(null); M.open(); setTimeout(() => { i.focus(); i.select(); }, 50);
  });

  // a small picture of a board (cards and links) for the graph view
  async function boardThumb(file, size) {
    let j; try { j = JSON.parse(await app.vault.cachedRead(file)); } catch (e) { return null; }
    const ns = Object.entries(j.nodes || {}).map(([id, n]) => ({ id, x: n.x || 0, y: n.y || 0, w: n.w || 260, h: n.h || 110, c: n.color || "" })); if (!ns.length) return null;
    let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9; for (const n of ns) { x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y); x2 = Math.max(x2, n.x + n.w); y2 = Math.max(y2, n.y + n.h); }
    const W = size, H = Math.round(size / 2), pad = 10, sc = Math.min((W - pad * 2) / (x2 - x1 || 1), (H - pad * 2) / (y2 - y1 || 1)), ox = (W - (x2 - x1) * sc) / 2, oy = (H - (y2 - y1) * sc) / 2;
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const ctx = cv.getContext("2d"); ctx.fillStyle = "#1b1713"; ctx.fillRect(0, 0, W, H);
    const by = new Map(ns.map((n) => [n.id, n])), P = (n) => [ox + (n.x + n.w / 2 - x1) * sc, oy + (n.y + n.h / 2 - y1) * sc];
    ctx.strokeStyle = "rgba(200,200,200,.45)"; ctx.lineWidth = Math.max(1, size / 160); ctx.beginPath(); for (const e of Object.values(j.edges || {})) { const a = by.get(e.a), b = by.get(e.b); if (!a || !b) continue; const pa = P(a), pb = P(b); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); } ctx.stroke();
    for (const n of ns) { ctx.fillStyle = n.c ? n.c : "rgba(235,225,210,.78)"; ctx.fillRect(ox + (n.x - x1) * sc, oy + (n.y - y1) * sc, Math.max(3, n.w * sc), Math.max(2, n.h * sc)); }
    return { bmp: cv };
  }
  window.__bsBoardThumb = boardThumb;

  let BOARD_CLIP = null;
  function makeView(api) {
    return class BoardView extends api.ItemView {
      constructor(leaf) { super(leaf); this.path = null; this.sel = new Set(); this.cam = { x: 0, y: 0, k: 1 }; this.peers = []; this.saveT = 0; this.drag = null; this.els = new Map(); this.edgeEls = new Map(); this.cursors = new Map(); this.initIdx(); }
      getViewType() { return VIEW; }
      onPaneMenu(menu, source) {
        try { if (super.onPaneMenu) super.onPaneMenu(menu, source); } catch (e) { /* base menu failed */ }
        const it = (t, ic, fn) => menu.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn)), ids = this.sel.size ? Array.from(this.sel) : null;
        menu.addSeparator(); it("Экспорт в картинку…", "lucide-image-down", () => this.exportDialog()); it("История версий…", "lucide-history", () => this.historyDialog()); if (ids) it("Сохранить выделенное как новую доску", "lucide-file-plus", () => this.saveSelAsBoard(ids));
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
        // a card that is only a rectangle (far away or zoomed out) has no listeners of its own: these two serve all of them
        this.cards.addEventListener("pointerdown", (ev) => { const el = ev.target.closest && ev.target.closest(".osb-card.is-lite"); if (!el || ev.button !== 0 || this.draw) return; const id = el.dataset.id; if (ev.shiftKey || ev.ctrlKey || ev.metaKey) { ev.preventDefault(); ev.stopPropagation(); const n2 = new Set(this.sel); n2.has(id) ? n2.delete(id) : n2.add(id); this.select(n2); this.contentEl.focus(); return; } const t = this.geo.get(id); if (t && t.grp) { const now = performance.now(); if (this._lastMd && this._lastMd.id === id && now - this._lastMd.t < 380 && !this.ro) { this._lastMd = null; ev.preventDefault(); ev.stopPropagation(); setTimeout(() => this.edit(id), 0); return; } this._lastMd = { id, t: now }; } this.startMove(ev, id); });
        this.cards.addEventListener("dblclick", (ev) => { const bc = ev.target.closest && ev.target.closest(".osb-card"); const bm = bc && this.yn.get(bc.dataset.id), bf = bm && bm.get("file"); if (bf && /\.board$/i.test(bf)) { const tf = app.vault.getAbstractFileByPath(bf); ev.stopPropagation(); ev.preventDefault(); if (tf) app.workspace.getLeaf("tab").openFile(tf); else new api.Notice("Доска не найдена: " + bf); } }, true);
        this.cards.addEventListener("dblclick", (ev) => { const el = ev.target.closest && ev.target.closest(".osb-card.is-lite"); if (!el || this.ro) return; ev.stopPropagation(); this.edit(el.dataset.id); });
        this.inkSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); this.inkSvg.setAttribute("class", "osb-ink"); this.inkSvg.innerHTML = '<defs><marker id="osb-inkarrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="context-stroke"/></marker></defs>'; this.world.appendChild(this.inkSvg);
        this.layer = this.root.createDiv({ cls: "osb-cursors" });
        const bar = this.bar = c.createDiv({ cls: "osb-bar" });
        const btn = (icon, tip, fn, cls) => { const x = bar.createDiv({ cls: "osb-btn" + (cls ? " " + cls : ""), attr: { title: tip, "aria-label": tip } }); api.setIcon(x, icon); x.onclick = fn; return x; };
        this.snapBtn = btn("lucide-magnet", "Прилипание к сетке", () => { this.snap = !this.snap; this.snapBtn.classList.toggle("is-on", this.snap); try { localStorage.setItem("board-snap", this.snap ? "1" : "0"); } catch (e) { /* private */ } });
        try { this.snap = localStorage.getItem("board-snap") === "1"; } catch (e) { this.snap = false; } this.snapBtn.classList.toggle("is-on", !!this.snap);
        this.searchBtn = btn("lucide-search", "Поиск", () => this.toggleSearch()); btn("lucide-network", "Раскладка карточек", (e) => this.layoutMenu(e));
        this.share = document.createElement("div"); this.zoomPct = document.createElement("span");
        const rail = this.rail = c.createDiv({ cls: "osb-rail" });
        const rb = (icon, tip, fn, cls) => { const x = rail.createDiv({ cls: "osb-rb" + (cls ? " " + cls : ""), attr: { title: tip, "aria-label": tip } }); api.setIcon(x, icon); x.onclick = fn; return x; }; const rs = () => rail.createDiv({ cls: "osb-rsep" });
        this.lockBtn = rb("lucide-unlock", "Заблокировать доску", () => this.toggleLock()); rs();
        rb("lucide-zoom-in", "Увеличить", () => this.zoomBy(1.25)); rb("lucide-zoom-out", "Уменьшить масштаб", () => this.zoomBy(1 / 1.25)); this.resetBtn = rb("lucide-rotate-cw", "Масштаб 100%", () => { this.cam.k = 1; this.applyCam(); }); rb("lucide-maximize", "Показать всё", () => this.fit()); rs();
        this.undoBtn = rb("lucide-undo-2", "Отменить", () => this.undo()); this.redoBtn = rb("lucide-redo-2", "Вернуть", () => this.redo()); rs();
        this.drawBtn = rb("lucide-pencil", "Рисование", () => this.toggleDraw()); this.transBtn = rb("lucide-languages", "Перевести карточки", () => this.translate(this.transBtn)); rs();
        this.helpBtn = rb("lucide-circle-help", "Управление", () => this.toggleHelp());
        this.searchBox = c.createDiv({ cls: "osb-search" }); const sb = this.searchBox; const sIc = sb.createSpan({ cls: "osb-si" }); api.setIcon(sIc, "lucide-search");
        const si = this.searchInput = sb.createEl("input", { attr: { placeholder: "Поиск по карточкам", spellcheck: "false" } }); this.searchCount = sb.createSpan({ cls: "osb-sc" });
        const sbtn = (ic, tip, fn) => { const x = sb.createDiv({ cls: "osb-sb2", attr: { title: tip } }); api.setIcon(x, ic); x.onclick = fn; return x; }; sbtn("lucide-chevron-up", "Предыдущая", () => this.runSearch(-1, true)); sbtn("lucide-chevron-down", "Следующая", () => this.runSearch(1, true)); sbtn("lucide-x", "Закрыть", () => this.toggleSearch(false));
        si.oninput = () => { clearTimeout(this._sT); if (this.geo && this.geo.size > 1500) this._sT = setTimeout(() => this.runSearch(0, true), 150); else this.runSearch(0, true); }; si.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); this.runSearch(e.shiftKey ? -1 : 1, true); } else if (e.key === "Escape") this.toggleSearch(false); };
        this.emptyEl = this.root.createDiv({ cls: "osb-empty" }); { const bx = this.emptyEl.createDiv({ cls: "osb-empty-box" }); for (const ln of ["Перетащите сюда файл или дважды щёлкните — появится карточка", "Пробел + перетаскивание — перемещение по доске", "Ctrl + колесо — масштаб, / — все действия доски"]) bx.createDiv({ text: ln }); } this.selBar = c.createDiv({ cls: "osb-sel" }); this.box = this.root.createDiv({ cls: "osb-box" });
        const bot = c.createDiv({ cls: "osb-bottom" }); this.people = bot.createDiv({ cls: "osb-people" });
        const fe = this.feedEl = bot.createDiv({ cls: "osb-feed" }); const fh = fe.createDiv({ cls: "osb-feed-h" }); fh.createSpan({ text: "Активность" }); this.feedCount = fh.createSpan({ cls: "osb-feed-c" }); this.feedList = fe.createDiv({ cls: "osb-feed-l" });
        let open = true; try { open = localStorage.getItem("board-feed-open") !== "0"; } catch (e) { /* private */ } fe.classList.toggle("is-closed", !open); fh.onclick = () => { fe.classList.toggle("is-closed"); try { localStorage.setItem("board-feed-open", fe.classList.contains("is-closed") ? "0" : "1"); } catch (e) { /* private */ } };
        this.bindInput(); this.rso = new ResizeObserver(() => { const r = this.root.getBoundingClientRect(), o = this._rc, n = { cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; if (o && r.width > 0 && this.cam.k) { this.cam.x += (n.cx - o.cx) / this.cam.k; this.cam.y += (n.cy - o.cy) / this.cam.k; } if (r.width > 0) this._rc = n; this.applyCam(); }); this.rso.observe(c);
      }
      // ---------- data ----------
      async openBoard() {
        if (this.geo && (this.geo.size || this.els.size)) this.resetIdx();
        const L = window.__bsY, Y = L && L.Y; if (!Y) { new api.Notice("Не загружен модуль синхронизации"); return; }
        if (window.__bsShareReady) await window.__bsShareReady;
        const sh = window.__bsShare && window.__bsShare.forPath(this.path);
        if (sh) { const rel = sh.rel(this.path); if (!sh.files.has(rel)) await sh.fromDisk(rel); const e = sh.files.get(rel);
          if (e && e.get("t") === "board") {
            this.sh = sh; this.relPath = rel; this.doc = sh.doc; this.yn = e.get("nodes"); this.ye = e.get("edges"); this.ym = sh.meta; this.initHistory();
            this.yn.observeDeep((evs) => this.onNodes(evs)); this.ye.observeDeep((evs) => this.onEdges(evs)); this.bindFiles();
            this.aw = sh.aw; this.pc = () => { this.peers = sh.peers.filter((u) => u.board === rel); this.paintPeers(); }; if (sh.aw) sh.aw.on("change", this.pc); this.pc();
            this.fit(); this.sync(); this.feedArr(); this.renderFeed(); this.startHistory(); this.share.classList.add("is-on"); return;
          } }
        let raw = null; try { raw = await app.vault.adapter.read(this.path); } catch (e) { /* new */ }
        this.doc = new Y.Doc(); this.yn = this.doc.getMap("nodes"); this.ye = this.doc.getMap("edges"); this.ym = this.doc.getMap("meta");
        let meta = {}; try { meta = raw ? JSON.parse(raw) : {}; } catch (e) { meta = {}; }
        if (meta.ydoc) Y.applyUpdate(this.doc, unb64(meta.ydoc));
        else if (meta.nodes && typeof meta.nodes === "object") this.fillFromJson(meta);
        if (!this.ym.get("id")) this.ym.set("id", uid() + uid());
        this.initHistory(); this.yn.observeDeep((evs) => this.onNodes(evs));
        this.ye.observeDeep((evs) => this.onEdges(evs)); this.bindFiles();
        this.fit(); this.sync(); this.feedArr(); this.renderFeed(); this.startHistory();
        if (this.ym.get("room")) this.connect(this.ym.get("room"), this.ym.get("pass") || "");
      }
      queueSave() { if (this.sh) return; clearTimeout(this.saveT); const n = this.yn ? this.yn.size : 0; this.saveT = setTimeout(() => this.save(), Math.max(n > 3000 ? 4000 : n > 800 ? 1500 : 400, Math.min(60000, (this._saveMs || 0) * 8))); }
      async save() {
        if (this.sh || !this.doc || !this.path) return; const Y = window.__bsY.Y;
        const nodes = {}; this.yn.forEach((m, id) => { nodes[id] = { x: m.get("x"), y: m.get("y"), w: m.get("w"), h: m.get("h"), color: m.get("color") || "", text: m.get("text") ? m.get("text").toString() : "", file: m.get("file") || "" }; });
        const out = { v: 2, id: this.ym.get("id"), room: this.ym.get("room") || null, nodes, edges: this.ye.toJSON(), ydoc: "@@YDOC@@" }; const t0 = performance.now(), y64 = b64(Y.encodeStateAsUpdate(this.doc));
        // the big base64 string goes in by splicing, not through JSON.stringify (no escaping pass, one copy less)
        try { await app.vault.adapter.write(this.path, (this.yn.size > 600 ? JSON.stringify(out) : JSON.stringify(out, null, 1)).replace('"@@YDOC@@"', () => '"' + y64 + '"')); } catch (e) { console.error(e); }
        this._saveMs = performance.now() - t0;
      }
      get ro() { return !!(this.sh && this.sh.readOnly) || !!this.locked; }
      toggleLock() { this.locked = !this.locked; this.lockBtn.classList.toggle("is-on", this.locked); this.lockBtn.empty(); api.setIcon(this.lockBtn, this.locked ? "lucide-lock" : "lucide-unlock"); this.lockBtn.title = this.locked ? "Разблокировать доску" : "Заблокировать доску"; if (this.locked) { this.sel = new Set(); this.mark(); } this.sync(); this.renderSelBar(); }
      toggleHelp() {
        const M = new api.Modal(app); M.modalEl.addClass("bs-help"); M.titleEl.setText("Справка по доске"); const c = M.contentEl;
        const K = (...k) => k, rows = [
          ["Перемещение", [K("Space", "+ перетаскивание"), K("Колесо мыши"), K("Тачпад двумя пальцами")]], ["Масштаб", [K("Ctrl", "+ колесо"), K("Щипок")]], ["Показать всё", [K("F")]],
          ["Выделить рамкой", [K("Перетащить по пустому месту")]], ["Добавить к выделению", [K("Shift", "+ клик"), K("Ctrl", "+ клик")]], ["Выделить всё", [K("Ctrl", "+ A")]],
          ["Новая карточка", [K("Двойной клик"), K("N")]], ["Свернуть или развернуть карточку", [K("Z")]], ["Двигать выбранное", [K("Стрелки"), K("Shift", "+ стрелки: крупно")]],
          ["Копировать, вставить, дублировать", [K("Ctrl", "+ C"), K("Ctrl", "+ V"), K("Ctrl", "+ D")]], ["Удалить", [K("Delete"), K("Backspace")]], ["Отменить и повторить", [K("Ctrl", "+ Z"), K("Ctrl", "+ Y")]],
          ["Связь между карточками", [K("Потянуть за точку на краю карточки")]], ["Убрать связь", [K("Потянуть конец связи в пустое место")]], ["Поиск", [K("Ctrl", "+ F")]], 
          ["Жирный, курсив, ссылка в тексте карточки", [K("Ctrl", "+ B"), K("Ctrl", "+ I"), K("Ctrl", "+ K")]], ["Отступ в списке", [K("Tab"), K("Shift", "+ Tab")]], ["Рисование", [K("P кисть"), K("H маркер"), K("L линия"), K("A стрелка"), K("R рамка"), K("O овал"), K("T текст"), K("V выделение"), K("E ластик")]], ["Прямая линия кистью", [K("Shift")]],
        ];
        for (const [t, keys] of rows) { const r = c.createDiv({ cls: "bs-help-row" }); r.createSpan({ cls: "bs-help-t", text: t }); const kk = r.createDiv({ cls: "bs-help-k" }); for (const g of keys) { const k = kk.createSpan({ cls: "bs-kbd" }); k.setText(g.join(" ")); } }
        M.open();
      }
      // smart guides: while moving, edges and centres line up with other cards, and the guide lines show what is aligned with what
      guide(d, dx, dy) {
        if (!d.box) {
          let a = 1e9, b = 1e9, c = -1e9, e = -1e9; for (const [id, [x, y]] of d.o) { const m = this.yn.get(id); if (!m) continue; a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x + m.get("w")); e = Math.max(e, y + m.get("h")); } d.box = { x: a, y: b, w: c - a, h: e - b }; d.others = [];
          d.q = null;
        }
        { const cxw = d.box.x + dx + d.box.w / 2, cyw = d.box.y + dy + d.box.h / 2; if (!d.q || Math.abs(cxw - d.q[0]) > 400 || Math.abs(cyw - d.q[1]) > 400) { d.q = [cxw, cyw]; d.others = this.nearRects(d.box.x + dx, d.box.y + dy, d.box.w, d.box.h, 1000, d.o);
          d.gx = new Set(); d.gy = new Set(); const O = d.others.slice(0, 150); for (const A of O) for (const B of O) { if (A === B) continue; const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y), ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x); if (oy > 0 && B.x >= A.x + A.w) { const g = Math.round(B.x - A.x - A.w); if (g >= 4 && g <= 800) d.gx.add(g); } if (ox > 0 && B.y >= A.y + A.h) { const g = Math.round(B.y - A.y - A.h); if (g >= 4 && g <= 800) d.gy.add(g); } }
        } }
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
        { const cxw = x + w / 2, cyw = y + h / 2; if (!d.others || !d.q || Math.abs(cxw - d.q[0]) > 500 || Math.abs(cyw - d.q[1]) > 500) { d.q = [cxw, cyw]; d.others = this.nearRects(x, y, w, h, 1500, new Set([d.id])); } }
        const T = 9 / this.cam.k, best = (v, list) => { let b = null; for (const t of list) { const dd = t - v; if (Math.abs(dd) < T && (!b || Math.abs(dd) < Math.abs(b.d))) b = { d: dd, at: t }; } return b; }; let gx = null, gy = null;
        const xsT = [], ysT = []; for (const o of d.others) { xsT.push(o.x, o.x + o.w / 2, o.x + o.w); ysT.push(o.y, o.y + o.h / 2, o.y + o.h); }
        if (d.dir.includes("e")) { const b = best(x + w, xsT); if (b) { w += b.d; gx = b.at; } } if (d.dir.includes("w")) { const b = best(x, xsT); if (b) { x += b.d; w -= b.d; gx = b.at; } }
        if (d.dir.includes("s")) { const b = best(y + h, ysT); if (b) { h += b.d; gy = b.at; } } if (d.dir.includes("n")) { const b = best(y, ysT); if (b) { y += b.d; h -= b.d; gy = b.at; } }
        let gl = this.guides; if (!gl) gl = this.guides = this.world.createDiv({ cls: "osb-guides" }); gl.empty(); this.edgeLines(gl, { x, y, w, h }, d.others);
        return { x, y, w, h };
      }
      // plain rectangles of the cards within pad of a box (from the geometry cache, no scan of the Yjs maps)
      nearRects(x, y, w, h, pad, skip) { this.flush(); const out = [], x1 = x - pad, y1 = y - pad, x2 = x + w + pad, y2 = y + h + pad; for (const [id, g] of this.geo) { if (skip && skip.has(id)) continue; if (g.x + g.w < x1 || g.x > x2 || g.y + g.h < y1 || g.y > y2) continue; out.push({ x: g.x, y: g.y, w: g.w, h: g.h }); } return out; }
      clearGuides() { if (this.guides) this.guides.empty(); }
      // tidy up: put the selected (or all) cards in order in one go
      tidy(mode, ids) {
        ids = (ids && ids.length ? ids : Array.from(this.yn.keys())).filter((i) => this.yn.get(i) && !this.yn.get(i).get("locked") && !this.yn.get(i).get("group")); if (ids.length < 1 || this.ro) return; this.keepPos(ids); this.um && this.um.stopCapturing(); setTimeout(() => { this.um && this.um.stopCapturing(); this.assignSides(ids); this.refitFrames(ids); this.toastUndo("Карточки упорядочены."); }, 0); const g = (i) => this.yn.get(i), G = 20, snap = (v) => Math.round(v / G) * G, bb = this.bounds(ids), gap = 40;
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
        this._ink.observe((ev) => this.onInk(ev)); return this._ink;
      }
      inkEl(st, step) {
        const NS = "http://www.w3.org/2000/svg", mk = (n) => document.createElementNS(NS, n); let e;
        if (st.k === "t") { e = mk("text"); const sz = this.textSize(st); e.setAttribute("x", st.a[0]); e.setAttribute("y", st.a[1]); e.setAttribute("font-size", sz); e.setAttribute("dominant-baseline", "hanging"); e.style.fill = st.c || "var(--text-normal)"; e.style.stroke = "none"; e.style.fontFamily = "var(--font-interface)"; String(st.txt || "").split("\n").forEach((ln, i) => { const t = mk("tspan"); t.setAttribute("x", st.a[0]); t.setAttribute("dy", i ? sz * 1.25 : 0); t.textContent = ln || " "; e.appendChild(t); }); return e; }
        if (st.k === "pen" || st.k === "hl") { e = mk("path"); const p = step > 1 && st.pts.length > 12 ? st.pts.filter((q, i) => i % step === 0 || i === st.pts.length - 1) : st.pts; let d = "M" + p[0][0] + " " + p[0][1]; if (p.length === 1) d += " l0.01 0"; for (let i = 1; i < p.length - 1; i++) { const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2; d += " Q" + p[i][0] + " " + p[i][1] + " " + mx + " " + my; } if (p.length > 1) d += " L" + p[p.length - 1][0] + " " + p[p.length - 1][1]; e.setAttribute("d", d); }
        else if (st.k === "line" || st.k === "arrow") { e = mk("line"); e.setAttribute("x1", st.a[0]); e.setAttribute("y1", st.a[1]); e.setAttribute("x2", st.b[0]); e.setAttribute("y2", st.b[1]); if (st.k === "arrow") e.setAttribute("marker-end", "url(#osb-inkarrow)"); }
        else if (st.k === "rect") { e = mk("rect"); e.setAttribute("x", Math.min(st.a[0], st.b[0])); e.setAttribute("y", Math.min(st.a[1], st.b[1])); e.setAttribute("width", Math.abs(st.b[0] - st.a[0])); e.setAttribute("height", Math.abs(st.b[1] - st.a[1])); e.setAttribute("rx", 6); }
        else { e = mk("ellipse"); e.setAttribute("cx", (st.a[0] + st.b[0]) / 2); e.setAttribute("cy", (st.a[1] + st.b[1]) / 2); e.setAttribute("rx", Math.abs(st.b[0] - st.a[0]) / 2); e.setAttribute("ry", Math.abs(st.b[1] - st.a[1]) / 2); }
        e.setAttribute("fill", "none"); e.style.stroke = st.c || "var(--text-normal)"; e.style.strokeWidth = String(st.k === "hl" ? (st.w || 4) * 3 : (st.w || 4)); if (st.k === "hl") { e.style.opacity = ".38"; e.style.mixBlendMode = "multiply"; } e.setAttribute("stroke-linecap", "round"); e.setAttribute("stroke-linejoin", "round"); e.style.color = st.c || "var(--text-normal)"; return e;
      }
      renderInk() { if (!this.inkSvg || !this._ink) return; this.inkMirror = this._ink.toArray(); this.inkIds = new Set(this.inkMirror.map((s) => s.id)); this.cullInk(); }
      onInk(ev) {
        let mir = this.inkMirror, ids = this.inkIds;
        if (mir && ids) { let pos = 0; try { for (const d of ev.changes.delta) { if (d.retain) pos += d.retain; else if (d.delete) { for (const s of mir.splice(pos, d.delete)) ids.delete(s.id); } else if (d.insert) { const arr = d.insert; mir = this.inkMirror = mir.slice(0, pos).concat(arr, mir.slice(pos)); for (const s of arr) ids.add(s.id); pos += arr.length; } } } catch (e) { mir = null; } if (mir && mir.length !== this._ink.length) mir = null; }
        if (!mir) { this.inkMirror = this._ink.toArray(); this.inkIds = new Set(this.inkMirror.map((s) => s.id)); }
        this.scheduleCull(true);
      }
      // many strokes: only the ones near the view get an SVG node, and a zoomed-out stroke keeps a few of its points
      cullInk() {
        if (!this.inkSvg || !this._ink || !this.root) return; const mir = this.inkMirror || (this.inkMirror = this._ink.toArray()); if (!this.inkIds) this.inkIds = new Set(mir.map((s) => s.id)); const have = this.inkEls || (this.inkEls = new Map());
        const c = this.cam, k = c.k, W = this.root.clientWidth, H = this.root.clientHeight; if (!(W > 0 && H > 0 && k > 0)) return;
        const big = mir.length > 300, vw = W / k, vh = H / k, X1 = c.x - vw, X2 = c.x + vw, Y1 = c.y - vh, Y2 = c.y + vh, step = !big ? 1 : k >= 0.3 ? 1 : k >= 0.12 ? 3 : k >= 0.05 ? 8 : 20, vis = [];
        for (const s of mir) {
          let b = this.inkBoxC.get(s); if (!b) { b = this.inkBox(s); this.inkBoxC.set(s, b); }
          if (big && (b.x2 < X1 || b.x1 > X2 || b.y2 < Y1 || b.y1 > Y2)) continue; vis.push(s);
        }
        // far more strokes in view than SVG handles well: one canvas picture, moved and scaled with the camera until it needs redrawing
        if (vis.length > INK_SVG_MAX) { this.inkToCanvas(vis, step, W, H); return; } if (this._inkCvOn) { this._inkCvOn = false; if (this.inkCv) this.inkCv.style.display = "none"; this.inkSvg.style.display = ""; }
        const seen = new Set();
        for (const s of vis) {
          seen.add(s.id); let e = have.get(s.id);
          if (e && e.__step !== step && (s.k === "pen" || s.k === "hl")) { e.remove(); have.delete(s.id); e = null; }
          if (!e) { e = this.inkEl(s, step); e.__step = step; e.dataset.id = s.id; this.inkSvg.appendChild(e); have.set(s.id, e); if (this.inkSet && this.inkSet.has(s.id)) e.classList.add("is-sel"); }
        }
        for (const [id, e] of have) if (!seen.has(id)) { e.remove(); have.delete(id); if (this.inkSel === id && !this.inkIds.has(id)) this.inkSel = null; }
      }
      inkToCanvas(vis, step, W, H) {
        const have = this.inkEls; if (have) { for (const e of have.values()) e.remove(); have.clear(); }
        let cv = this.inkCv; if (!cv) { cv = this.inkCv = document.createElement("canvas"); cv.className = "osb-inkcv"; this.root.insertBefore(cv, this.layer); }
        const cw = Math.min(4096, Math.round(W * 2)), ch = Math.min(4096, Math.round(H * 2)); if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; } cv.style.cssText = "display:block;width:" + cw + "px;height:" + ch + "px;left:" + (W - cw) / 2 + "px;top:" + (H - ch) / 2 + "px";
        const ctx = cv.getContext("2d"), c = this.cam, k = c.k, col0 = (getComputedStyle(this.root).getPropertyValue("--text-normal") || "#ddd").trim(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch); ctx.setTransform(k, 0, 0, k, cw / 2 - c.x * k, ch / 2 - c.y * k); ctx.lineCap = "round"; ctx.lineJoin = "round";
        for (const s of vis) {
          ctx.lineWidth = Math.max((s.k === "hl" ? 3 : 1) * (s.w || 4), 1 / k); ctx.strokeStyle = ctx.fillStyle = s.c || col0; ctx.globalAlpha = s.k === "hl" ? 0.38 : 1; ctx.beginPath();
          if (s.k === "pen" || s.k === "hl") { const p = s.pts, n = p.length; ctx.moveTo(p[0][0], p[0][1]); if (n === 1) ctx.lineTo(p[0][0] + 0.01, p[0][1]); for (let i = step; i < n - 1; i += step) ctx.lineTo(p[i][0], p[i][1]); if (n > 1) ctx.lineTo(p[n - 1][0], p[n - 1][1]); ctx.stroke(); }
          else if (s.k === "line" || s.k === "arrow") { ctx.moveTo(s.a[0], s.a[1]); ctx.lineTo(s.b[0], s.b[1]); ctx.stroke(); }
          else if (s.k === "rect") ctx.strokeRect(Math.min(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.abs(s.b[0] - s.a[0]), Math.abs(s.b[1] - s.a[1]));
          else if (s.k === "t") { const sz = this.textSize(s); ctx.font = sz + "px sans-serif"; ctx.textBaseline = "top"; String(s.txt || "").split("\n").forEach((ln, i) => ctx.fillText(ln, s.a[0], s.a[1] + i * sz * 1.25)); }
          else { ctx.ellipse((s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, Math.abs(s.b[0] - s.a[0]) / 2, Math.abs(s.b[1] - s.a[1]) / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
        }
        ctx.globalAlpha = 1; this._inkCvOn = true; this._inkCv0 = { x: c.x, y: c.y, k }; this.inkSvg.style.display = "none";
      }
      toggleDraw(on) {
        if (on !== false && (on || !this.draw)) { const ae = document.activeElement; if (ae && ae.classList && ae.classList.contains("osb-ta")) ae.blur(); this.contentEl.classList.remove("is-writing"); }
        this.renderMini();
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
        const wand = bar.createDiv({ cls: "osb-dt", attr: { title: "Выравнивать фигуры после кисти (задержка в конце штриха)" } }); api.setIcon(wand, "lucide-wand-2"); try { this.inkSnap = localStorage.getItem("board-ink-snap") !== "0"; } catch (e) { this.inkSnap = true; } wand.classList.toggle("is-on", this.inkSnap); wand.onclick = () => { this.inkSnap = !this.inkSnap; try { localStorage.setItem("board-ink-snap", this.inkSnap ? "1" : "0"); } catch (e) { /* private */ } wand.classList.toggle("is-on", this.inkSnap); new api.Notice(this.inkSnap ? "Выравнивание включено: нарисуйте кистью и задержите мышь на полсекунды, не отпуская." : "Выравнивание выключено: кисть рисует как есть."); };
        const fixBtn = bar.createDiv({ cls: "osb-dt", attr: { title: "Выровнять выделенные штрихи в линии и фигуры (выберите штрихи инструментом «Выделение»)" } }); api.setIcon(fixBtn, "lucide-shapes"); fixBtn.onclick = () => this.snapSelected();
        bar.createDiv({ cls: "osb-bsep" });
        const cb = bar.createDiv({ cls: "osb-dt osb-dcol", attr: { title: "Цвет" } }); const dot = cb.createDiv({ cls: "osb-ddot" }); const paintDot = () => { dot.style.background = this.inkColor || "var(--text-normal)"; }; paintDot(); cb.onclick = () => window.__bsColors.pick(cb, this.inkColor, (c) => { this.inkColor = c; if (this.inkSet && this.inkSet.size) this.inkSelect(this.inkEach(this.inkSet, (st) => { st.c = c; })); this.drawCursor(); try { localStorage.setItem("board-ink-color", c); } catch (e) { /* private */ } paintDot(); }, { none: false });
        const sizes = bar.createDiv({ cls: "osb-dsz" }); for (const w of [2, 4, 8, 14]) { const b = sizes.createDiv({ cls: "osb-dw" + (w === this.inkW ? " is-on" : ""), attr: { title: w + " px" } }); const i = b.createDiv(); i.style.width = i.style.height = Math.min(16, w + 3) + "px"; b.onclick = () => { this.inkW = w; this.drawCursor(); if (this.inkSet && this.inkSet.size) this.inkSelect(this.inkEach(this.inkSet, (st) => { st.w = w; })); try { localStorage.setItem("board-ink-w", String(w)); } catch (e) { /* private */ } for (const x of sizes.children) x.classList.toggle("is-on", x === b); }; }
        bar.createDiv({ cls: "osb-bsep" });
        const un = bar.createDiv({ cls: "osb-dt", attr: { title: "Отменить (Ctrl+Z)" } }); api.setIcon(un, "lucide-undo-2"); un.onclick = () => this.undo(); const re = bar.createDiv({ cls: "osb-dt", attr: { title: "Повторить (Ctrl+Y)" } }); api.setIcon(re, "lucide-redo-2"); re.onclick = () => this.redo();
        const clr = bar.createDiv({ cls: "osb-dt is-danger", attr: { title: "Стереть весь рисунок" } }); api.setIcon(clr, "lucide-trash-2"); clr.onclick = () => { const a = this.inkArr(); if (a && a.length) a.delete(0, a.length); };
        const done = bar.createDiv({ cls: "osb-dt osb-ddone", attr: { title: "Готово" } }); api.setIcon(done, "lucide-check"); done.onclick = () => this.toggleDraw(false);
        this.wandBtn = wand; const ORDER = ["select", "pen", "hl", "line", "arrow", "rect", "ellipse", "text", "eraser"];
        for (const b of bar.querySelectorAll(".osb-dt[data-t]")) { const n = ORDER.indexOf(b.dataset.t) + 1; if (n > 0) { b.dataset.n = String(n); b.title = (b.title || "") + " [" + n + "]"; } } wand.dataset.n = "0"; wand.title = (wand.title || "") + " [0]";
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
          const l = d.pts[d.pts.length - 1]; if (Math.hypot(w.x - l[0], w.y - l[1]) * this.cam.k > 2.5) { d.pts.push([dot, doy]); const mv = !d.hp || Math.hypot(w.x - d.hp[0], w.y - d.hp[1]) * this.cam.k > 7; if (mv) { clearTimeout(d.ht); d.hp = [w.x, w.y]; } if (mv && d.tool === "pen" && this.inkSnap !== false) d.ht = setTimeout(() => { if (this.drag !== d || d.snapped) return; const sh = this.recognize(d.pts); if (sh) { d.tool = sh.k; d.a = sh.a; d.b = sh.b; d.snapped = true; this.drawTmp(); } }, 480); }
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
        { let bx = this.inkBoxC.get(st); if (!bx) { bx = this.inkBox(st); this.inkBoxC.set(st, bx); } if (w.x < bx.x1 - tol || w.x > bx.x2 + tol || w.y < bx.y1 - tol || w.y > bx.y2 + tol) return false; }
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
        if (pts.length < 3) return null; let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        const p0 = pts[0], pn = pts[pts.length - 1], chord = Math.hypot(pn[0] - p0[0], pn[1] - p0[1]), min = 24 / this.cam.k; if (len < min) return null;
        let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9; for (const q of pts) { x1 = Math.min(x1, q[0]); y1 = Math.min(y1, q[1]); x2 = Math.max(x2, q[0]); y2 = Math.max(y2, q[1]); }
        const bw = x2 - x1, bh = y2 - y1;
        if (chord > len * 0.82) { let dev = 0; for (const q of pts) { const t = Math.abs((pn[0] - p0[0]) * (p0[1] - q[1]) - (p0[0] - q[0]) * (pn[1] - p0[1])) / (chord || 1); dev = Math.max(dev, t); } if (dev < chord * 0.1) { let b = pn.slice(); const ang = Math.atan2(pn[1] - p0[1], pn[0] - p0[0]), st = Math.PI / 12, sn = Math.round(ang / st) * st; if (Math.abs(ang - sn) < 0.07) b = [p0[0] + Math.cos(sn) * chord, p0[1] + Math.sin(sn) * chord]; return { k: "line", a: p0.slice(), b }; } return null; }
        if (chord < Math.max(bw, bh) * 0.35 && bw > min && bh > min) { const mn2 = Math.min(bw, bh), e = mn2 * 0.07; let on = 0; for (const q of pts) if (Math.min(q[0] - x1, x2 - q[0], q[1] - y1, y2 - q[1]) < e) on++; let corners = 0; for (const [cx2, cy2] of [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]) if (pts.some((q) => Math.hypot(q[0] - cx2, q[1] - cy2) < mn2 * 0.16)) corners++; const rect = on / pts.length > 0.78 && corners >= 3; let a = [x1, y1], b = [x2, y2]; if (!rect && Math.abs(bw - bh) < Math.max(bw, bh) * 0.15) { const m = (bw + bh) / 2; b = [x1 + m, y1 + m]; } return { k: rect ? "rect" : "ellipse", a, b }; }
        return null;
      }
      snapSelected() {
        const ids = this.inkSet && this.inkSet.size ? this.inkSet : null; if (!ids) { new api.Notice("Выделите штрихи инструментом «Выделение» (клавиша 1), потом нажмите эту кнопку."); return; }
        const arr = this._ink ? this._ink.toArray() : [], pick = new Set(); let n = 0; for (const st of arr) if (ids.has(st.id) && st.pts && st.k === "pen") { const sh = this.recognize(st.pts); if (sh) pick.add(st.id); }
        if (!pick.size) { new api.Notice("Среди выделенного нечего выравнивать: нужны рисунки кистью, похожие на линию, прямоугольник или овал."); return; }
        const out = this.inkEach(pick, (st) => { const sh = this.recognize(st.pts); if (!sh) return; n++; st.k = sh.k; st.a = sh.a; st.b = sh.b; delete st.pts; }); const keep = new Set(ids); for (const id of pick) keep.delete(id); for (const id of out) keep.add(id); this.inkSelect(keep); new api.Notice("Выровнено штрихов: " + n);
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
          const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(im, 0, 0, w, h); let data = c.toDataURL(blob.type === "image/png" && blob.size < 1500000 ? "image/png" : "image/jpeg", 0.86), s = 1, q = 0.8;
          // a picture lives inside the board file and every copy of it: keep it under about 1.2 MB
          for (let t = 0; t < 4 && data.length > 1200000; t++) { s *= 0.75; q = Math.max(0.5, q - 0.08); const c2 = document.createElement("canvas"); c2.width = Math.max(1, Math.round(w * s)); c2.height = Math.max(1, Math.round(h * s)); c2.getContext("2d").drawImage(im, 0, 0, c2.width, c2.height); data = c2.toDataURL("image/jpeg", q); }
          if (data.length > 1600000) throw new Error("big"); return { data, w, h };
        } finally { URL.revokeObjectURL(url); }
      }
      async addImageFile(blob, x, y) {
        if (this.ro) return; try { const r = await this.imgData(blob), cw = Math.min(360, Math.max(160, r.w)), ch = Math.round(cw * r.h / r.w) + 22 + 36, id = this.addCard(x - cw / 2, y - ch / 2, ""), m = this.yn.get(id); this.doc.transact(() => { m.set("img", r.data); m.set("w", cw); m.set("h", ch); }); } catch (e) { new api.Notice(e && e.message === "big" ? "Изображение слишком большое для доски: уменьшите его и вставьте снова" : "Не удалось вставить изображение"); }
      }
      pickImage(at) { const i = document.createElement("input"); i.type = "file"; i.accept = "image/*"; i.multiple = true; i.onchange = () => { const c = at || this.worldPt(this.root.clientWidth / 2, this.root.clientHeight / 2); let n = 0; for (const f of i.files) this.addImageFile(f, c.x + n++ * 30, c.y + n * 30); }; i.click(); }
      importDomFiles(fs, w) {
        let i = 0; for (const f of fs) {
          const at = { x: w.x + i * 30, y: w.y + i * 30 }, ext = (f.name.split(".").pop() || "").toLowerCase(); i++;
          if (/^image\//.test(f.type)) this.addImageFile(f, at.x, at.y);
          else if (ext === EXT) f.text().then((t) => { try { const d = this.readBoardDoc(t); this.importBoardData(d, new Set(d.nodes.map((q) => q.id)), at, true); } catch (e) { new api.Notice("Это не файл доски"); } });
          else if (ext === "canvas") f.text().then((t) => canvasData(JSON.parse(t))).then((d) => this.importBoardData(d, new Set(d.nodes.map((q) => q.id)), at, false)).catch(() => new api.Notice("Не удалось прочитать холст"));
          else if (TEXT_EXT.test(ext)) f.text().then((t) => this.addCard(at.x - 130, at.y - 30, this.fileCardText({ name: f.name.replace(/\.[^.]+$/, "") }, t, ext)));
          else this.addCard(at.x - 130, at.y - 30, f.name);
        }
      }
      async pasteAny() {
        const c = this.myCur || this.worldPt(this.root.clientWidth / 2, this.root.clientHeight / 2);
        try { const items = await navigator.clipboard.read(); for (const it of items) { const ty = it.types.find((t) => /^image\//.test(t)); if (ty) { this.addImageFile(await it.getType(ty), c.x, c.y); return; } } } catch (e) { /* no image or no access */ }
        if (BOARD_CLIP) { this.paste(40, 40); return; }
        try { const t = await navigator.clipboard.readText(); if (t) this.addCard(c.x - 130, c.y - 30, t); } catch (e) { /* empty */ }
      }
      assignSides(ids) { const set = new Set(ids); this.doc.transact(() => { for (const e of this.ye.values()) { const a = e.get("a"), b = e.get("b"); if (!set.has(a) && !set.has(b)) continue; const A = this.center(a), B = this.center(b); if (!A || !B) continue; const sa = this.dirSide(A, B), sb = this.dirSide(B, A); if (e.get("sa") !== sa) e.set("sa", sa); if (e.get("sb") !== sb) e.set("sb", sb); } }); this.syncEdges(); }
      resetSides(ids) { const set = new Set(ids); this.doc.transact(() => { for (const e of this.ye.values()) if (set.has(e.get("a")) || set.has(e.get("b"))) { if (e.get("sa")) e.delete("sa"); if (e.get("sb")) e.delete("sb"); } }); this.syncEdges(); }
      keepPos(ids) { this._prevPos = new Map(); for (const id of ids) { const m = this.yn.get(id); if (m) this._prevPos.set(id, [m.get("x"), m.get("y"), m.get("w"), m.get("h"), !!m.get("fold")]); } }
      restorePos() { if (!this._prevPos || this.ro) return; const cur = new Map(); for (const id of this._prevPos.keys()) { const m = this.yn.get(id); if (m) cur.set(id, [m.get("x"), m.get("y"), m.get("w"), m.get("h"), !!m.get("fold")]); } this.um && this.um.stopCapturing(); this.doc.transact(() => { for (const [id, v] of this._prevPos) { const m = this.yn.get(id); if (m) { m.set("x", v[0]); m.set("y", v[1]); m.set("w", v[2]); m.set("h", v[3]); m.set("fold", v[4]); } } }); this.um && this.um.stopCapturing(); this._prevPos = cur; this.syncEdges(); this.selBar.dataset.sig = ""; new api.Notice("Расположение возвращено"); }
      toastUndo(text) { const f = document.createDocumentFragment(); f.append(text + " "); const b = document.createElement("button"); b.textContent = "Вернуть назад"; b.style.marginLeft = "8px"; const n = new api.Notice(f, 7000); b.onclick = () => { this.restorePos(); n.hide(); }; f.append(b); }
      // a card with a "file" field IS that note: typing in the card writes the file, changing the file changes the card
      bindFiles() {
        if (this._fb) return; this._fb = true; this._fw = new Map(); this._ft = new Map();
        const write = (path, text) => { const f = app.vault.getAbstractFileByPath(path); if (!f || f.children) return; this._fw.set(path, text); app.vault.modify(f, text).catch(() => { /* file gone */ }); };
        this.yn.observeDeep((evs, tr) => {
          if (tr && tr.origin === "file-sync") return;
          const hit = new Set(); for (const ev of evs) { const id = ev.path && ev.path[0]; if (id && ev.target instanceof window.__bsY.Y.Text) hit.add(id); }
          for (const id of hit) { const m = this.yn.get(id); const path = m && m.get("file"); if (!path || this.ro || !/\.(md|markdown|txt)$/i.test(path)) continue; clearTimeout(this._ft.get(id)); this._ft.set(id, setTimeout(() => { const mm = this.yn.get(id); if (mm && mm.get("text")) write(mm.get("file"), mm.get("text").toString()); }, 700)); }
        });
        this.registerEvent(app.vault.on("modify", async (f) => {
          if (!f || f.children) return; if (f.extension === EXT) { this.refreshBoardCards(f); return; } if (!/^(md|markdown|txt)$/i.test(f.extension || "")) return; let body = null;
          this.yn.forEach((m, id) => { if (m.get("file") !== f.path) return; const t = m.get("text"); if (!t) return; if (body === null) body = "pending"; });
          if (body === null) return; body = await app.vault.read(f);
          if (this._fw.get(f.path) === body) return;
          this.yn.forEach((m, id) => { if (m.get("file") !== f.path) return; const t = m.get("text"); if (!t || t.toString() === body) return; this.doc.transact(() => { t.delete(0, t.length); t.insert(0, body); }, "file-sync"); });
        }));
      }
      // a board dropped on a board becomes a card that shows it, follows its changes and opens it on double click
      async boardPicture(f) {
        let raw = ""; try { raw = await app.vault.adapter.read(f.path); } catch (e) { return ""; }
        let r = null;
        try {
          const d = this.readBoardDoc(raw);
          if (d.nodes.length && window.__fpRenderNested) r = await window.__fpRenderNested(null, 1000, { nodes: d.nodes.map((n) => ({ id: n.id, type: "text", x: n.x, y: n.y, width: n.w, height: n.h, text: n.text, color: n.color && /^[1-6]$/.test(String(n.color)) ? String(n.color) : "" })), edges: d.edges.map((e, i) => ({ id: "e" + i, fromNode: e.a, toNode: e.b, label: e.label })) });
        } catch (e) { r = null; }
        if (!r || !r.bmp) { const t = await boardThumb(f, 640); return t && t.bmp ? t.bmp.toDataURL("image/png") : ""; }
        const cv = document.createElement("canvas"); cv.width = r.bmp.width; cv.height = r.bmp.height; cv.getContext("2d").drawImage(r.bmp, 0, 0); return cv.toDataURL("image/png");
      }
      async addBoardCard(f, x, y) {
        if (this.ro) return; const pic = await this.boardPicture(f), id = this.addCard(x - 160, y - 95, ""), m = this.yn.get(id); if (!m) return;
        this.doc.transact(() => { m.set("file", f.path); m.set("kind", f.basename || f.name || ""); m.set("w", 320); m.set("h", 210); if (pic) m.set("img", pic); });
        this.bindFiles();
      }
      refreshBoardCards(f) {
        clearTimeout(this._bt); this._bt = setTimeout(async () => { const ids = []; this.yn.forEach((m, id) => { if (m.get("file") === f.path) ids.push(id); }); if (!ids.length) return; const pic = await this.boardPicture(f); if (!pic) return; this.doc.transact(() => { for (const id of ids) { const m = this.yn.get(id); if (m && m.get("img") !== pic) m.set("img", pic); } }, "file-sync"); }, 600);
      }
      addFileCard(x, y, f, body) {
        const id = this.addCard(x, y, String(body || "")); if (!id) return id; const m = this.yn.get(id);
        if (m) this.doc.transact(() => { m.set("file", f.path); m.set("kind", f.basename || f.name || ""); m.set("w", 320); m.set("h", 220); });
        return id;
      }
      // a dropped note or text file becomes a card with its content under a link to the file
      fileCardText(f, body, ext) {
        const name = f.basename || f.name || f.path, max = 4000; let t = String(body || "").replace(/\r\n/g, "\n");
        if (ext === "md") t = t.replace(/^---\n[\s\S]*?\n---\n?/, "");
        if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, "") + "\n\n…";
        if (ext !== "md" && ext !== "txt") t = "```" + ext + "\n" + t + "\n```";
        return "[[" + (f.path || name) + "|" + name + "]]\n\n" + t.trim();
      }
      async dropVaultFiles(list, w) {
        let n = 0; for (const f of list) { if (!f || f.children || f.path === this.path) continue; const ext = String(f.extension || "").toLowerCase(), at = { x: w.x + n * 40, y: w.y + n * 40 }; n++;
          try {
            if (ext === "canvas") { const data = await canvasData(JSON.parse(await app.vault.adapter.read(f.path))); this.importBoardData(data, new Set(data.nodes.map((q) => q.id)), at, false); }
            else if (ext === EXT) { await this.addBoardCard(f, at.x, at.y); }
            else if (/^(png|jpe?g|gif|webp|bmp|svg|avif)$/.test(ext)) { const buf = await app.vault.adapter.readBinary(f.path); this.addImageFile(new Blob([buf], { type: ext === "svg" ? "image/svg+xml" : "image/" + (ext === "jpg" ? "jpeg" : ext) }), at.x, at.y); }
            else if (ext === "md" || ext === "txt") { this.addFileCard(at.x - 130, at.y - 30, f, await app.vault.adapter.read(f.path)); }
            else if (TEXT_EXT.test(ext)) { const body = await app.vault.adapter.read(f.path); this.addCard(at.x - 130, at.y - 30, this.fileCardText(f, body, ext)); }
            else this.addCard(at.x - 130, at.y - 30, "[[" + (f.path || f.name) + "]]");
          } catch (e) { new api.Notice("Не удалось добавить файл " + (f.name || "")); }
        }
      }
      setFold(on) { if (this.ro) return; this.keepPos(Array.from(this.sel)); this.um && this.um.stopCapturing(); this.doc.transact(() => { for (const id of this.sel) { const m = this.yn.get(id); if (m) m.set("fold", !!on); } }); this.um && this.um.stopCapturing(); this.selBar.dataset.sig = ""; this.syncEdges(); }
      addMenu(e) {
        const mn = new api.Menu(), it = (t, ic, fn) => mn.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn)); const c = this.worldPt(this.root.clientWidth / 2, this.root.clientHeight / 2);
        it("Новая карточка", "lucide-square-plus", () => this.addCard()); it("Изображение с компьютера…", "lucide-image-plus", () => this.pickImage(c)); it("Вставить из буфера (Ctrl+V)", "lucide-clipboard-paste", () => this.pasteAny()); mn.addSeparator(); it("Импортировать другую доску…", "lucide-file-input", () => this.importDialog(c));
        mn.showAtMouseEvent(e);
      }
      // import cards (all or chosen ones) from another board file into this one
      // boards written as plain JSON (cards and links under "nodes" / "edges", no ydoc) open with their cards
      fillFromJson(meta) {
        const Y = window.__bsY.Y; let d; try { d = this.readBoardDoc(JSON.stringify(meta)); } catch (e) { return; }
        this.doc.transact(() => {
          const idOf = new Map();
          for (const n of d.nodes) { const m = new Y.Map(), t = new Y.Text(); t.insert(0, n.text || ""); m.set("x", n.x); m.set("y", n.y); m.set("w", n.w); m.set("h", n.h); m.set("color", n.color || ""); m.set("text", t); if (n.img) m.set("img", n.img); if (n.fold) m.set("fold", true); if (n.kind) m.set("kind", n.kind); this.yn.set(String(n.id), m); idOf.set(n.id, String(n.id)); }
          for (const e of d.edges) if (idOf.has(e.a) && idOf.has(e.b)) { const m = new Y.Map(); m.set("a", idOf.get(e.a)); m.set("b", idOf.get(e.b)); m.set("label", e.label || ""); if (e.sa) m.set("sa", e.sa); if (e.sb) m.set("sb", e.sb); this.ye.set(uid(), m); }
        });
      }
      readBoardDoc(text) {
        const Y = window.__bsY.Y, meta = JSON.parse(text), d = new Y.Doc(); if (meta.ydoc) Y.applyUpdate(d, unb64(meta.ydoc)); const nodes = d.getMap("nodes"), edges = d.getMap("edges"), list = [];
        nodes.forEach((m, id) => list.push({ id, x: m.get("x"), y: m.get("y"), w: m.get("w"), h: m.get("h"), color: m.get("color") || "", text: m.get("text") ? m.get("text").toString() : "", img: m.get("img") || "", fold: !!m.get("fold"), kind: m.get("kind") || "" }));
        const es = []; edges.forEach((m) => es.push({ a: m.get("a"), b: m.get("b"), label: m.get("label") || "", sa: m.get("sa") || "", sb: m.get("sb") || "" })); const ink = d.getArray("ink").toArray();
        // newer files keep the cards as plain JSON and have no ydoc at all
        if (!list.length && meta.nodes && typeof meta.nodes === "object") {
          const ents = Array.isArray(meta.nodes) ? meta.nodes.map((n) => [n.id, n]) : Object.entries(meta.nodes);
          for (const [id, n] of ents) if (n && id != null) list.push({ id, x: +n.x || 0, y: +n.y || 0, w: +n.w || 260, h: +n.h || 110, color: n.color || "", text: String(n.text == null ? "" : n.text), img: n.img || "", fold: !!n.fold, kind: n.kind || "" });
          const ee = Array.isArray(meta.edges) ? meta.edges.map((e) => [e && e.id, e]) : Object.entries(meta.edges || {});
          for (const [, e] of ee) if (e && e.a != null && e.b != null) es.push({ a: e.a, b: e.b, label: e.label || "", sa: e.sa || "", sb: e.sb || "" });
        }
        return { nodes: list, edges: es, ink };
      }
      importBoardData(data, ids, at, withInk) {
        if (this.ro) return; const Y = window.__bsY.Y, pick = data.nodes.filter((n) => ids.has(n.id)); if (!pick.length) { new api.Notice("В этой доске нет карточек: импортировать нечего."); return; }
        let x1 = 1e9, y1 = 1e9, x2 = -1e9; for (const n of pick) { x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y); x2 = Math.max(x2, n.x + n.w); }
        let ox, oy; if (at) { ox = at.x - x1; oy = at.y - y1; } else { const bb = this.bounds(Array.from(this.yn.keys())); ox = bb ? bb.x + bb.w + 120 - x1 : 0; oy = bb ? bb.y - y1 : 0; }
        const map = {}, added = []; this.doc.transact(() => {
          for (const n of pick) { const id = uid(), m = new Y.Map(), t = new Y.Text(); map[n.id] = id; t.insert(0, n.text); m.set("x", Math.round(n.x + ox)); m.set("y", Math.round(n.y + oy)); m.set("w", n.w); m.set("h", n.h); m.set("color", n.color); m.set("by", me.name); if (n.img) m.set("img", n.img); if (n.fold) m.set("fold", true); if (n.kind) m.set("kind", n.kind); this.stampM(m); m.set("text", t); this.yn.set(id, m); added.push(id); }
          for (const e of data.edges) if (map[e.a] && map[e.b]) { const m = new Y.Map(); m.set("a", map[e.a]); m.set("b", map[e.b]); m.set("label", e.label); if (e.sa) m.set("sa", e.sa); if (e.sb) m.set("sb", e.sb); this.ye.set(uid(), m); }
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
         mn.addSeparator(); it("По сетке" + sc, "lucide-grid-3x3", () => this.tidy("grid", ids)); it("Расставить блоками" + sc, "lucide-layout-grid", () => this.tidy("cells", ids)); mn.showAtMouseEvent(e);
      }
      layout(mode, ids) {
        if (this.ro) return; ids = (ids && ids.length ? ids : Array.from(this.yn.keys())).filter((i) => this.yn.get(i) && !this.yn.get(i).get("locked") && !this.yn.get(i).get("group")); if (ids.length < 2) return;
        this.keepPos(ids); this.um && this.um.stopCapturing(); const set = new Set(ids), g = (i) => this.yn.get(i), W = (i) => g(i).get("w"), H = (i) => this.effH(g(i)), out = new Map(), und = new Map(), dir = new Map(); for (const i of ids) { und.set(i, new Set()); dir.set(i, new Set()); }
        for (const e of this.ye.values()) { const a = e.get("a"), b = e.get("b"); if (set.has(a) && set.has(b) && a !== b) { und.get(a).add(b); und.get(b).add(a); dir.get(a).add(b); } }
        const bb = this.bounds(ids), gapX = 90, gapY = 40; const seen = new Set(), comps = [];
        for (const i of ids) { if (seen.has(i)) continue; const comp = [], st = [i]; seen.add(i); while (st.length) { const v = st.pop(); comp.push(v); for (const n of und.get(v)) if (!seen.has(n)) { seen.add(n); st.push(n); } } comps.push(comp); }
        comps.sort((a, b) => b.length - a.length); let cursor = 0;
        // layered drawing: cycles broken, longest-path levels, crossings reduced by sweeps, cards pulled toward their neighbours
        const layered = (comp, lr) => {
          const inC = new Set(comp), out = new Map(comp.map((v) => [v, []])), inn = new Map(comp.map((v) => [v, []])), state = new Map(), back = new Set();
          const dfs = (r) => { const stack = [[r, dir.get(r)[Symbol.iterator]()]]; state.set(r, 1); while (stack.length) { const top = stack[stack.length - 1], nx = top[1].next(); if (nx.done) { state.set(top[0], 2); stack.pop(); continue; } const n = nx.value; if (!inC.has(n)) continue; if (state.get(n) === 1) { back.add(top[0] + ">" + n); continue; } if (!state.get(n)) { state.set(n, 1); stack.push([n, dir.get(n)[Symbol.iterator]()]); } } };
          const hasIn = new Set(); for (const v of comp) for (const n of dir.get(v)) if (inC.has(n)) hasIn.add(n); for (const r of comp.filter((v) => !hasIn.has(v)).concat(comp)) if (!state.get(r)) dfs(r);
          for (const v of comp) for (const n of dir.get(v)) if (inC.has(n) && !back.has(v + ">" + n)) { out.get(v).push(n); inn.get(n).push(v); }
          const layer = new Map(), indeg = new Map(comp.map((v) => [v, inn.get(v).length])), q = comp.filter((v) => !indeg.get(v)); q.forEach((v) => layer.set(v, 0));
          for (let h = 0; h < q.length; h++) { const v = q[h]; for (const n of out.get(v)) { layer.set(n, Math.max(layer.get(n) || 0, layer.get(v) + 1)); indeg.set(n, indeg.get(n) - 1); if (!indeg.get(n)) q.push(n); } }
          for (const v of comp) if (!inn.get(v).length && out.get(v).length) layer.set(v, Math.min.apply(null, out.get(v).map((n) => layer.get(n))) - 1);
          const mn = Math.min.apply(null, comp.map((v) => layer.get(v) || 0)); for (const v of comp) layer.set(v, (layer.get(v) || 0) - mn);
          const nl = Math.max.apply(null, comp.map((v) => layer.get(v))) + 1, L = Array.from({ length: nl }, () => []); const seen = new Set(), seq = []; const walk = (r) => { const stack = [r]; while (stack.length) { const v = stack.pop(); if (seen.has(v)) continue; seen.add(v); seq.push(v); const o = out.get(v); for (let i = o.length - 1; i >= 0; i--) stack.push(o[i]); } }; for (const r of comp.filter((v) => !inn.get(v).length).concat(comp)) walk(r); for (const v of seq) L[layer.get(v)].push(v);
          const nbr = new Map(comp.map((v) => [v, []])); for (const v of comp) for (const n of out.get(v)) { nbr.get(v).push(n); nbr.get(n).push(v); }
          const ord = new Map(); const setOrd = () => L.forEach((X) => X.forEach((v, k) => ord.set(v, k))); setOrd();
          const crossings = () => { let c = 0; for (const v of comp) for (const n of out.get(v)) { if (layer.get(n) - layer.get(v) !== 1) continue; for (const u of comp) { if (layer.get(u) !== layer.get(v)) continue; for (const w2 of out.get(u)) { if (layer.get(w2) - layer.get(u) !== 1) continue; if (ord.get(u) < ord.get(v) && ord.get(w2) > ord.get(n)) c++; } } } return c; };
          const crossingsFast = () => { let c = 0; for (let d = 0; d < nl - 1; d++) { const pairs = []; for (const v of L[d]) for (const n of out.get(v)) if (layer.get(n) === d + 1) pairs.push([ord.get(v), ord.get(n)]); pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]); const m = L[d + 1].length, bit = new Int32Array(m + 2); let seen = 0; for (const q of pairs) { const t = q[1]; let s = 0; for (let i = t + 1; i > 0; i -= i & -i) s += bit[i]; c += seen - s; for (let i = t + 1; i <= m; i += i & -i) bit[i]++; seen++; } } return c; };
          const crossingsExact = crossings, crossingsAny = comp.length > 60 ? crossingsFast : crossingsExact;
          let best = L.map((X) => X.slice()), bc = crossingsAny();
          for (let it = 0; it < 12 && bc > 0; it++) { const down = it % 2 === 0, ds = L.map((_, k) => k); if (!down) ds.reverse(); for (const d of ds) { const X = L[d], ref = down ? d - 1 : d + 1; if (ref < 0 || ref >= nl) continue; const med = (v) => { const ns = nbr.get(v).filter((n) => layer.get(n) === ref).map((n) => ord.get(n)).sort((a, b) => a - b); if (!ns.length) return ord.get(v); const m = ns.length >> 1; return ns.length % 2 ? ns[m] : (ns[m - 1] + ns[m]) / 2; }; X.sort((a, b) => med(a) - med(b)); X.forEach((v, k) => ord.set(v, k)); }
            let imp = comp.length <= 60; for (let pass = 0; imp && pass < 3; pass++) { imp = false; for (const X of L) for (let k = 0; k < X.length - 1; k++) { const before = crossings(); [X[k], X[k + 1]] = [X[k + 1], X[k]]; ord.set(X[k], k); ord.set(X[k + 1], k + 1); if (crossings() < before) imp = true; else { [X[k], X[k + 1]] = [X[k + 1], X[k]]; ord.set(X[k], k); ord.set(X[k + 1], k + 1); } } }
            const c = crossingsAny(); if (c < bc) { bc = c; best = L.map((X) => X.slice()); } }
          for (let d = 0; d < nl; d++) { L[d] = best[d]; } setOrd();
          const W = (v) => g(v).get("w"), Hh = (v) => this.effH(g(v)), sz = (v) => (lr ? Hh(v) : W(v)), fl = (v) => (lr ? W(v) : Hh(v)), gap = lr ? 36 : 56, t = new Map();
          for (const X of L) { let y = 0; for (const v of X) { t.set(v, y); y += sz(v) + gap; } }
          const sepFix = (X) => { for (let k = 1; k < X.length; k++) t.set(X[k], Math.max(t.get(X[k]), t.get(X[k - 1]) + sz(X[k - 1]) + gap)); };
          for (let it = 0; it < 8; it++) { const ds = L.map((_, k) => k); if (it % 2) ds.reverse(); for (const d of ds) { const X = L[d], ref = it % 2 ? d + 1 : d - 1; for (const v of X) { const ns = nbr.get(v).filter((n) => layer.get(n) === ref || (it > 5 && layer.get(n) !== d)); if (ns.length) t.set(v, ns.reduce((s2, n) => s2 + t.get(n) + sz(n) / 2, 0) / ns.length - sz(v) / 2); } sepFix(X); let sh = 0; for (const v of X) sh += 0; void sh; } }
          let lo = 1e9, hi = -1e9; for (const v of comp) { lo = Math.min(lo, t.get(v)); hi = Math.max(hi, t.get(v) + sz(v)); }
          const lw = L.map((X) => Math.max.apply(null, X.map(fl))), pos = new Map(); let off = 0; L.forEach((X, d) => { for (const v of X) pos.set(v, lr ? [off + (lw[d] - fl(v)) / 2, t.get(v) - lo] : [t.get(v) - lo, off + (lw[d] - fl(v)) / 2]); off += lw[d] + (lr ? 110 : 90); });
          let W0 = lr ? off - 110 : hi - lo, H0 = lr ? hi - lo : off - 90;
          const fi = lr ? 0 : 1, ci = 1 - fi, flowLen = fi === 0 ? W0 : H0, crossLen = fi === 0 ? H0 : W0;
          if (flowLen > crossLen * 2.4 && nl > 3) {
            const target = Math.sqrt(flowLen * crossLen * 2.8), chunks = []; let cur = [], start = 0, offs = []; let o2 = 0; L.forEach((X, d) => { offs.push(o2); o2 += lw[d] + (lr ? 110 : 90); });
            L.forEach((X, d) => { if (cur.length && offs[d] + lw[d] - start > target) { chunks.push(cur); cur = []; start = offs[d]; } cur.push(d); }); if (cur.length) chunks.push(cur);
            let shift = 0, maxFlow = 0; chunks.forEach((ch) => { const base0 = offs[ch[0]]; let c0 = 1e9, c1 = -1e9; for (const d of ch) for (const v of L[d]) { const q = pos.get(v); c0 = Math.min(c0, q[ci]); c1 = Math.max(c1, q[ci] + sz(v)); } for (const d of ch) for (const v of L[d]) { const q = pos.get(v); q[fi] -= base0; q[ci] += shift - c0; } maxFlow = Math.max(maxFlow, offs[ch[ch.length - 1]] + lw[ch[ch.length - 1]] - base0); shift += c1 - c0 + 90; });
            return fi === 0 ? { pos, w: maxFlow, h: shift - 90 } : { pos, w: shift - 90, h: maxFlow };
          }
          return { pos, w: W0, h: H0 };
        };
        const place = (comp, kind) => {
          if (comp.length === 1) { const i = comp[0]; return { pos: new Map([[i, [0, 0]]]), w: W(i), h: H(i) }; }
          if (kind === "auto") { let ec = 0; for (const v of comp) ec += dir.get(v).size; kind = ec <= comp.length * 1.15 ? "lr" : "force"; } const indeg = new Map(comp.map((v) => [v, 0])); for (const v of comp) for (const n of dir.get(v)) indeg.set(n, (indeg.get(n) || 0) + 1);
          let roots = comp.filter((v) => !indeg.get(v)); if (!roots.length) roots = [comp.slice().sort((a, b) => und.get(b).size - und.get(a).size)[0]]; else roots.sort((a, b) => und.get(b).size - und.get(a).size);
          const depth = new Map(), par = new Map(), q = []; for (const r of roots) { depth.set(r, 0); q.push(r); } for (let h = 0; h < q.length; h++) { const v = q[h]; for (const n of und.get(v)) if (!depth.has(n)) { depth.set(n, depth.get(v) + 1); par.set(n, v); q.push(n); } }
          if (kind === "force") {
            const P = new Map(comp.map((v, k) => [v, [g(v).get("x") + W(v) / 2 + (Math.random() - .5) * 40, g(v).get("y") + H(v) / 2 + (Math.random() - .5) * 40 + k * 0.01]])); const area = comp.length * 340 * 220, kk = Math.sqrt(area / comp.length) * 0.9; let temp = kk;
            const es = []; for (const v of comp) for (const n of dir.get(v)) es.push([v, n]);
            if (comp.length > 250) this.forceGrid(comp, P, es, kk, W); else
            for (let it2 = 0; it2 < 320; it2++) { const D = new Map(comp.map((v) => [v, [0, 0]]));
              for (let a = 0; a < comp.length; a++) for (let b = a + 1; b < comp.length; b++) { const u = comp[a], v = comp[b], pu = P.get(u), pv = P.get(v); let dx = pu[0] - pv[0], dy = pu[1] - pv[1], d = Math.hypot(dx, dy) || 0.01; const ext = (W(u) + W(v)) / 2 + 40, f = (kk * kk) / d * (d < ext + 60 ? 3 : 1); dx /= d; dy /= d; D.get(u)[0] += dx * f; D.get(u)[1] += dy * f; D.get(v)[0] -= dx * f; D.get(v)[1] -= dy * f; }
              for (const [u, v] of es) { const pu = P.get(u), pv = P.get(v); let dx = pu[0] - pv[0], dy = pu[1] - pv[1], d = Math.hypot(dx, dy) || 0.01; const f = (d * d) / kk; dx /= d; dy /= d; D.get(u)[0] -= dx * f; D.get(u)[1] -= dy * f; D.get(v)[0] += dx * f; D.get(v)[1] += dy * f; }
              for (const v of comp) { const d = D.get(v), l = Math.hypot(d[0], d[1]) || 1, m = Math.min(l, temp); P.get(v)[0] += d[0] / l * m; P.get(v)[1] += d[1] / l * m; } temp *= 0.985; }
            let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9; const pos = new Map(); for (const v of comp) { const c = P.get(v); const x = c[0] - W(v) / 2, y = c[1] - H(v) / 2; pos.set(v, [x, y]); x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x + W(v)); y2 = Math.max(y2, y + H(v)); }
            for (const [v, c] of pos) { c[0] -= x1; c[1] -= y1; } return { pos, w: x2 - x1, h: y2 - y1 };
          }
          const kids = new Map(comp.map((v) => [v, []])); for (const [n, p] of par) kids.get(p).push(n); for (const v of comp) if (!depth.has(v)) { depth.set(v, 0); roots.push(v); }
          if (kind === "radial") {
            const leaves = new Map(); const cnt = (r) => { const s2 = [r], order = []; while (s2.length) { const v = s2.pop(); order.push(v); for (const c of kids.get(v)) s2.push(c); } for (let i = order.length - 1; i >= 0; i--) { const v = order[i]; if (leaves.has(v)) continue; const k = kids.get(v); leaves.set(v, k.length ? k.reduce((t, c) => t + leaves.get(c), 0) : 1); } return leaves.get(r); }; const root = roots[0]; for (const r of roots) cnt(r);
            const mw = Math.max.apply(null, comp.map(W)), mh = Math.max.apply(null, comp.map(H)), step = Math.max(mw, mh) + 130, pos = new Map(), ang = (r0, p0, p1) => { const stack = [[r0, p0, p1]]; while (stack.length) { const [v, b0, b1] = stack.pop(), a = (b0 + b1) / 2, rr = depth.get(v) * step; pos.set(v, [Math.cos(a) * rr, Math.sin(a) * rr]); let s0 = b0; for (const c of kids.get(v)) { const sp = (b1 - b0) * leaves.get(c) / leaves.get(v); stack.push([c, s0, s0 + sp]); s0 += sp; } } };
            if (roots.length === 1) ang(root, 0, Math.PI * 2); else { let s0 = 0; const tot = roots.reduce((s2, r) => s2 + leaves.get(r), 0); for (const r of roots) { const sp = Math.PI * 2 * leaves.get(r) / tot; ang(r, s0, s0 + sp); s0 += sp; } }
            let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9; for (const [v, c] of pos) { c[0] -= W(v) / 2; c[1] -= H(v) / 2; x1 = Math.min(x1, c[0]); y1 = Math.min(y1, c[1]); x2 = Math.max(x2, c[0] + W(v)); y2 = Math.max(y2, c[1] + H(v)); } for (const [, c] of pos) { c[0] -= x1; c[1] -= y1; } return { pos, w: x2 - x1, h: y2 - y1 };
          }
          return layered(comp, kind === "lr");
        };
        let res; try { res = comps.map((comp) => place(comp, mode)); } catch (err) { new api.Notice("Раскладка не удалась: схема слишком большая или глубокая"); return; } let area = 0, maxW = 0; for (const r of res) { area += (r.w + 80) * (r.h + 80); maxW = Math.max(maxW, r.w); } const rowW = Math.max(maxW, Math.sqrt(area) * 1.5); this.doc.transact(() => { let x = 0, y = 0, rh = 0; for (const r of res) { if (x > 0 && x + r.w > rowW) { x = 0; y += rh + 80; rh = 0; } for (const [v, c] of r.pos) { g(v).set("x", Math.round(bb.x + x + c[0])); g(v).set("y", Math.round(bb.y + y + c[1])); } x += r.w + 80; rh = Math.max(rh, r.h); } });
        this.assignSides(ids); this.refitFrames(ids); this.um && this.um.stopCapturing(); this.fit(); this.toastUndo("Раскладка применена.");
      }
      // force layout for big sets: repulsion only between cards in neighbouring grid cells, fewer rounds
      forceGrid(comp, P, es, kk, W) {
        const n = comp.length, idx = new Map(comp.map((v, i) => [v, i])), X = new Float64Array(n), Y = new Float64Array(n), DX = new Float64Array(n), DY = new Float64Array(n), EX = new Float64Array(n); comp.forEach((v, i) => { const p = P.get(v); X[i] = p[0]; Y[i] = p[1]; EX[i] = W(v); });
        const E = []; for (const [a, b] of es) { const i = idx.get(a), j = idx.get(b); if (i != null && j != null) E.push(i, j); }
        const iters = n > 3000 ? 40 : n > 1200 ? 60 : 90, cell = kk * 3, decay = Math.pow(0.985, 320 / iters), K2 = kk * kk; let temp = kk;
        for (let it = 0; it < iters; it++) {
          DX.fill(0); DY.fill(0); const grid = new Map(), cx = new Int32Array(n), cy = new Int32Array(n);
          for (let i = 0; i < n; i++) { cx[i] = Math.floor(X[i] / cell); cy[i] = Math.floor(Y[i] / cell); const key = (cx[i] + 32768) * 65536 + (cy[i] + 32768); const l = grid.get(key); if (l) l.push(i); else grid.set(key, [i]); }
          for (let i = 0; i < n; i++) for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = grid.get((cx[i] + a + 32768) * 65536 + (cy[i] + b + 32768)); if (!l) continue; const sk = l.length > 64 ? Math.ceil(l.length / 64) : 1; for (let q = i % sk; q < l.length; q += sk) { const j = l[q]; if (j === i) continue; let dx = X[i] - X[j], dy = Y[i] - Y[j], d = Math.hypot(dx, dy) || 0.01; const ext = (EX[i] + EX[j]) / 2 + 40, f = sk * K2 / d * (d < ext + 60 ? 3 : 1); dx /= d; dy /= d; DX[i] += dx * f; DY[i] += dy * f; } }
          for (let e = 0; e < E.length; e += 2) { const u = E[e], v = E[e + 1]; let dx = X[u] - X[v], dy = Y[u] - Y[v], d = Math.hypot(dx, dy) || 0.01; const f = (d * d) / kk; dx /= d; dy /= d; DX[u] -= dx * f; DY[u] -= dy * f; DX[v] += dx * f; DY[v] += dy * f; }
          for (let i = 0; i < n; i++) { const l = Math.hypot(DX[i], DY[i]) || 1, m = Math.min(l, temp); X[i] += DX[i] / l * m; Y[i] += DY[i] / l * m; } temp *= decay;
        }
        comp.forEach((v, i) => { const p = P.get(v); p[0] = X[i]; p[1] = Y[i]; });
      }
      // ----- export to a picture (white background for documents)
      exportMenu(e, ids) {
        const mn = new api.Menu(), it = (t, ic, fn) => mn.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn)); const what = ids && ids.length ? "выделенное" : "вся доска";
        it("Копировать картинку, белый фон (" + what + ")", "lucide-clipboard-copy", () => this.exportPng(ids, "white", "clip")); it("Сохранить PNG, белый фон", "lucide-image-down", () => this.exportPng(ids, "white", "file")); it("Сохранить PNG, прозрачный фон", "lucide-image", () => this.exportPng(ids, "none", "file")); it("Сохранить PNG, тёмный фон", "lucide-moon", () => this.exportPng(ids, "dark", "file"));
        if (ids && ids.length) { mn.addSeparator(); it("Сохранить выделенное как новую доску", "lucide-file-plus", () => this.saveSelAsBoard(ids)); } mn.showAtMouseEvent(e);
      }
      // formatted text on a canvas: headings, bold, italic, code, lists, check boxes, quotes, links, rough tables
      mdCanvas(ctx, txt, x, y, w, maxY, T, FONT, fs) {
        let cy = y, inCode = false; const lines = String(txt).replace(/\r/g, "").split("\n");
        const inline = (s0) => { const out = []; const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)]+\)|~~[^~]+~~)/g; let last = 0, m; while ((m = re.exec(s0))) { if (m.index > last) out.push({ t: s0.slice(last, m.index) }); const g = m[0]; if (g.startsWith("**") || g.startsWith("__")) out.push({ t: g.slice(2, -2), b: true }); else if (g.startsWith("`")) out.push({ t: g.slice(1, -1), mono: true }); else if (g.startsWith("[[")) out.push({ t: g.slice(2, -2).split("|").pop(), link: true }); else if (g.startsWith("[")) out.push({ t: g.slice(1, g.indexOf("]")), link: true }); else if (g.startsWith("~~")) out.push({ t: g.slice(2, -2), strike: true }); else out.push({ t: g.slice(1, -1), i: true }); last = m.index + g.length; } if (last < s0.length) out.push({ t: s0.slice(last) }); return out; };
        for (const raw of lines) {
          if (cy > maxY - 8) break; let ln = raw, size = fs, bold = false, indent = 0, pre = null, muted = false, quote = false;
          if (/^```/.test(ln)) { inCode = !inCode; continue; }
          if (!inCode) { let m;
            if ((m = ln.match(/^(#{1,6})\s+(.*)$/))) { size = fs * [1.55, 1.35, 1.2, 1.1, 1, 1][m[1].length - 1]; bold = true; ln = m[2]; cy += size * 0.12; }
            else if ((m = ln.match(/^(\s*)[-*+]\s+\[( |x|X)\]\s+(.*)$/))) { indent = 20 + m[1].length * 6; pre = { t: "box", on: m[2] !== " " }; ln = m[3]; }
            else if ((m = ln.match(/^(\s*)[-*+]\s+(.*)$/))) { indent = 16 + m[1].length * 6; pre = { t: "dot" }; ln = m[2]; }
            else if ((m = ln.match(/^(\s*)(\d+)[.)]\s+(.*)$/))) { indent = 20 + m[1].length * 6; pre = { t: "num", n: m[2] }; ln = m[3]; }
            else if ((m = ln.match(/^>\s?(.*)$/))) { quote = true; indent = 12; ln = m[1]; muted = true; }
            else if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(ln)) { ctx.strokeStyle = T.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, cy + 6); ctx.lineTo(x + w, cy + 6); ctx.stroke(); cy += 14; continue; }
            else if (/^\|.*\|\s*$/.test(ln)) { if (/^\|[\s:|-]+\|$/.test(ln)) continue; ln = ln.replace(/^\||\|\s*$/g, "").split("|").map((c2) => c2.trim()).join("   |   "); } }
          const lh = size * 1.5; if (!ln.trim() && !pre) { cy += lh * 0.5; continue; }
          const x0 = x + indent, limit = x + w; let cx = x0; ctx.textBaseline = "alphabetic"; const base = cy + size * 1.08;
          if (pre) { ctx.fillStyle = T.muted; if (pre.t === "dot") { ctx.beginPath(); ctx.arc(x + 6, base - size * 0.32, 2.2, 0, 7); ctx.fill(); } else if (pre.t === "num") { ctx.font = size + "px " + FONT; ctx.fillText(pre.n + ".", x + 1, base); } else { const bs = size * 0.85; ctx.strokeStyle = T.muted; ctx.lineWidth = 1.3; ctx.strokeRect(x + 1, base - bs + 1, bs, bs); if (pre.on) { ctx.strokeStyle = T.accent; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(x + 3, base - bs * 0.45); ctx.lineTo(x + 1 + bs * 0.4, base - 2); ctx.lineTo(x + bs - 1, base - bs + 3); ctx.stroke(); } } }
          if (quote) { ctx.fillStyle = T.border; ctx.fillRect(x + 1, cy, 3, lh); }
          let line = cy;
          for (const run of (inCode ? [{ t: ln, mono: true }] : inline(ln))) {
            const font = run.mono ? (size * 0.92) + "px Consolas, monospace" : (run.i ? "italic " : "") + (bold || run.b ? "700 " : "400 ") + size + "px " + FONT; ctx.font = font;
            for (const wd of run.t.split(/(\s+)/)) { if (!wd) continue; const ww = ctx.measureText(wd).width; if (cx + ww > limit && cx > x0 && wd.trim()) { cx = x0; line += lh; if (line > maxY - 8) return; } if (cx === x0 && !wd.trim()) continue; const by = line + size * 1.08;
              if (run.mono) { ctx.fillStyle = T.code; ctx.fillRect(cx - 1, by - size, ww + 2, size * 1.25); }
              ctx.fillStyle = run.link ? T.accent : muted ? T.muted : T.text; ctx.fillText(wd, cx, by); if (run.link) { ctx.fillRect(cx, by + 2, ww, 1); } if (run.strike) { ctx.fillRect(cx, by - size * 0.32, ww, 1); } cx += ww; }
          }
          cy = line + lh;
        }
      }
      async renderExport(o) {
        const ids = o.ids, bg = o.bg;
        const all = ids && ids.length ? ids.filter((i) => this.yn.get(i)) : Array.from(this.yn.keys()); let ink = o.ink === false ? [] : (this._ink ? this._ink.toArray() : []); if (!all.length && !ink.length) return null;
        const pageLight = bg === "white", dark = !pageLight, ink1 = dark ? "#e5e7eb" : "#111827", card0 = dark ? "#1f2330" : "#ffffff", line0 = dark ? "#8b93a7" : "#6b7280", bord = dark ? "#3a4052" : "#d1d5db";
        let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9; const grow = (a, b, c, d) => { x1 = Math.min(x1, a); y1 = Math.min(y1, b); x2 = Math.max(x2, c); y2 = Math.max(y2, d); };
        for (const id of all) { const m = this.yn.get(id); grow(m.get("x"), m.get("y"), m.get("x") + m.get("w"), m.get("y") + this.effH(m)); } if (ids && ids.length && all.length) { const nb = { x1, y1, x2, y2 }; ink = ink.filter((st) => { const b = this.inkBox(st); return b.x1 < nb.x2 && b.x2 > nb.x1 && b.y1 < nb.y2 && b.y2 > nb.y1; }); } for (const st of ink) { const b = this.inkBox(st); grow(b.x1, b.y1, b.x2, b.y2); }
        const pad = o.pad == null ? 40 : o.pad, sc = o.scale || 2, cw0 = Math.min(8000, Math.ceil((x2 - x1 + pad * 2) * sc)), chh0 = Math.min(8000, Math.ceil((y2 - y1 + pad * 2) * sc)), ar = Math.min(1, Math.sqrt(3.6e7 / (cw0 * chh0))), cw = Math.max(1, Math.floor(cw0 * ar)), chh = Math.max(1, Math.floor(chh0 * ar)), cv = document.createElement("canvas"); cv.width = cw; cv.height = chh; const ctx = cv.getContext("2d"); ctx.scale(cw / ((x2 - x1 + pad * 2)), chh / ((y2 - y1 + pad * 2))); ctx.translate(pad - x1, pad - y1);
        if (bg !== "none") { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = bg === "white" ? "#ffffff" : bg === "black" ? "#000000" : ((getComputedStyle(this.root).getPropertyValue("--background-primary") || "").trim() || "#14110f"); ctx.fillRect(0, 0, cw, chh); ctx.restore(); }
        const FONT = '"Segoe UI", system-ui, sans-serif', rrect = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
        const wrap = (text, mw, font) => { ctx.font = font; const out = []; for (const para of String(text).split("\n")) { let line = ""; for (const word of para.split(/(\s+)/)) { const t = line + word; if (ctx.measureText(t).width > mw && line) { out.push(line.trimEnd()); line = word.trimStart(); } else line = t; } out.push(line); } return out; };
        all.sort((a, b) => (this.yn.get(b).get("group") ? 1 : 0) - (this.yn.get(a).get("group") ? 1 : 0)); const idSet = new Set(all);
        // the same look as on the board: coloured header with the type, formatted text, curved links, frames
        const cs = getComputedStyle(this.root), cv0 = (n, d) => (cs.getPropertyValue(n) || "").trim() || d;
        const T = true ? { card: cv0("--background-secondary", "#1f2330"), text: cv0("--text-normal", "#e5e7eb"), muted: cv0("--text-muted", "#9ca3af"), border: cv0("--background-modifier-border", "#3a4052"), line: cv0("--text-faint", "#8b93a7"), accent: cv0("--interactive-accent", "#c98d5b"), code: "rgba(255,255,255,.10)", halo: "#14161d" }
          : { card: "#ffffff", text: "#111827", muted: "#6b7280", border: "#d1d5db", line: "#6b7280", accent: "#a05a2c", code: "rgba(0,0,0,.07)", halo: "#ffffff" };
        const NV = { t: [0, -1], b: [0, 1], l: [-1, 0], r: [1, 0] }, head = (x, y, an, col) => { ctx.save(); ctx.fillStyle = col; ctx.translate(x, y); ctx.rotate(an); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-11, -5); ctx.lineTo(-11, 5); ctx.closePath(); ctx.fill(); ctx.restore(); };
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        for (const e of this.ye.values()) {
          const a = e.get("a"), b = e.get("b"); if (!idSet.has(a) || !idSet.has(b)) continue; const A = this.center(a), B = this.center(b); if (!A || !B) continue;
          const sa0 = e.get("sa") || this.dirSide(A, B), sb0 = e.get("sb") || this.dirSide(B, A), p0 = this.anchorSide(a, sa0), q0 = this.anchorSide(b, sb0); if (!p0 || !q0) continue; const sh = e.get("sh") || "", ep = this.edgePath(p0, q0, sh, sa0, sb0), col = e.get("ec") || T.line, ls = e.get("ls") || "", ad = e.get("ad") || "end";
          ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash(ls === "dash" ? [9, 6] : ls === "dot" ? [1, 7] : []); ctx.stroke(new Path2D(ep.d)); ctx.restore();
          const dirEnd = sh === "straight" ? Math.atan2(q0.y - p0.y, q0.x - p0.x) : Math.atan2(-NV[sb0][1], -NV[sb0][0]), dirStart = sh === "straight" ? Math.atan2(p0.y - q0.y, p0.x - q0.x) : Math.atan2(-NV[sa0][1], -NV[sa0][0]);
          if (ad !== "none") head(q0.x, q0.y, dirEnd, col); if (ad === "both") head(p0.x, p0.y, dirStart, col);
          const lb = e.get("label"); if (lb) { ctx.save(); ctx.font = "12px " + FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineWidth = 4; ctx.strokeStyle = pageLight ? "#ffffff" : T.halo; ctx.strokeText(lb, ep.mid.x, ep.mid.y - 8); ctx.fillStyle = pageLight ? "#111827" : T.text; ctx.fillText(lb, ep.mid.x, ep.mid.y - 8); ctx.restore(); }
        }
        // cards
        let yc = 0; const yieldNow = () => (++yc % 150 === 0 ? new Promise((r) => setTimeout(r, 0)) : null), tint = (hex, al) => { const h = /^#([0-9a-f]{6})$/i.exec(hex || ""); if (!h) return "rgba(128,128,128," + al + ")"; const n = parseInt(h[1], 16); return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + al + ")"; };
        for (const id of all) { await yieldNow(); const m = this.yn.get(id), x = m.get("x"), y = m.get("y"), w = m.get("w"), h = this.effH(m), col = m.get("color") || "", im = m.get("img"), grp = !!m.get("group"), kind = m.get("kind") || "", txt = m.get("text").toString();
          ctx.save(); rrect(x, y, w, h, 4);
          if (grp) { ctx.fillStyle = tint(col || T.accent, 0.07); ctx.fill(); ctx.setLineDash([7, 5]); ctx.lineWidth = 1.5; ctx.strokeStyle = col || T.border; ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = pageLight ? "#111827" : T.text; ctx.textBaseline = "top"; ctx.font = "600 15px " + FONT; ctx.fillText(txt.split("\n")[0], x + 12, y + 9); ctx.restore(); continue; }
          ctx.fillStyle = T.card; ctx.fill(); ctx.lineWidth = col ? 2 : 1.2; ctx.strokeStyle = col || T.border; ctx.stroke(); ctx.clip();
          ctx.fillStyle = tint(col || T.border, col ? 0.3 : 0.5); ctx.fillRect(x, y, w, 22);
          if (kind) { ctx.font = "600 10.5px " + FONT; ctx.textBaseline = "middle"; const tw = ctx.measureText(kind).width + 10; ctx.fillStyle = col || T.muted; ctx.fillRect(x + 5, y + 3, Math.min(tw, w - 10), 16); ctx.fillStyle = "#fff"; ctx.fillText(kind, x + 10, y + 11.5); }
          let ty = y + 30;
          if (im) { try { const img = await new Promise((res, rej) => { const i2 = new Image(); i2.onload = () => res(i2); i2.onerror = rej; i2.src = im; }); const ah = Math.max(20, h - 22 - (txt.length ? 40 : 6)), r = Math.min((w - 8) / img.naturalWidth, ah / img.naturalHeight), iw = img.naturalWidth * r, ih = img.naturalHeight * r; ctx.drawImage(img, x + (w - iw) / 2, y + 26, iw, ih); ty = y + 26 + ih + 6; } catch (e2) { /* the picture is gone */ } }
          this.mdCanvas(ctx, txt, x + 12, ty, w - 24, y + h - 6, T, FONT, 14); ctx.restore(); }
        // drawing
        for (const st of ink) { await yieldNow(); ctx.save(); ctx.strokeStyle = st.c || ink1; ctx.fillStyle = st.c || ink1; ctx.lineCap = "round"; ctx.lineJoin = "round"; const sw = st.k === "hl" ? (st.w || 4) * 3 : (st.w || 4); ctx.lineWidth = sw; if (st.k === "hl") ctx.globalAlpha = 0.38;
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
      // Export as Obsidian does it: the real, themed picture of the board is captured from the window piece by piece and stitched together
      // o: { scope: "all" | "sel" | "view", k: pixels per board unit, light, logo, privacy }
      async exportCapture(o, onProgress) {
        const el = window.require("electron"), remote = el.remote || window.electron.remote; if (!remote) throw new Error("no remote");
        const contents = remote.getCurrentWebContents(), zf = (el.webFrame && el.webFrame.getZoomFactor && el.webFrame.getZoomFactor()) || 1, sf = window.devicePixelRatio / zf || 1, root = this.root;
        const sel0 = o.scope === "sel" ? Array.from(this.sel).filter((x) => this.yn.get(x)) : null; if (sel0) for (const id of sel0.slice()) { const g = this.yn.get(id); if (!g || !g.get("group")) continue; for (const [i2, m2] of this.yn.entries()) if (!m2.get("group") && (m2.get("frame") === id || (!m2.get("frame") && m2.get("x") + m2.get("w") / 2 >= g.get("x") && m2.get("x") + m2.get("w") / 2 <= g.get("x") + g.get("w") && m2.get("y") + m2.get("h") / 2 >= g.get("y") && m2.get("y") + m2.get("h") / 2 <= g.get("y") + g.get("h"))) && !sel0.includes(i2)) sel0.push(i2); }
        const selIds = sel0, selSet = selIds ? new Set(selIds) : null, ids = selIds || (o.scope === "rect" ? [] : Array.from(this.yn.keys()));
        const keep = { cam: Object.assign({}, this.cam), sel: this.sel, edge: this.selEdge }; this.exporting = true; this.contentEl.classList.add("osb-exporting"); root.classList.add("is-exporting"); root.classList.toggle("is-exp-white", !!o.pageLight); root.classList.toggle("is-text-garbled", !!o.privacy); if (o.ink === false) this.contentEl.classList.add("osb-noink"); if (o.bgCss) root.style.setProperty("background-color", o.bgCss, "important");
        this.sel = new Set(); this.selEdge = null; this.mark(); const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const shot = async () => { const r = root.getBoundingClientRect(), img = await contents.capturePage({ x: Math.round((r.left + 1) * zf), y: Math.round((r.top + 1) * zf), width: Math.round((r.width - 2) * zf), height: Math.round((r.height - 2) * zf) }); return createImageBitmap(new Blob([img.toPNG()], { type: "image/png" })); };
        const prep = () => { if (!selSet) return; for (const [id, e] of this.els) e.el.style.visibility = selSet.has(id) ? "" : "hidden"; for (const [id, r] of this.edgeEls) { const m = this.ye.get(id); r.g.style.visibility = m && selSet.has(m.get("a")) && selSet.has(m.get("b")) ? "" : "hidden"; } };
        try {
          await raf(); await sleep(60);
          if (o.scope === "view") { prep(); await sleep(120); const b = await shot(), cv0 = document.createElement("canvas"); cv0.width = b.width; cv0.height = b.height; cv0.getContext("2d").drawImage(b, 0, 0); if (o.logo) this.exportLogo(cv0.getContext("2d"), cv0.width, cv0.height, o.light, b.width / (root.clientWidth - 2)); return cv0; }
          let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9; for (const id of ids) { const m = this.yn.get(id); x1 = Math.min(x1, m.get("x")); y1 = Math.min(y1, m.get("y")); x2 = Math.max(x2, m.get("x") + m.get("w")); y2 = Math.max(y2, m.get("y") + this.effH(m)); }
          if (!selSet && o.scope !== "rect" && o.ink !== false && this._ink) for (const st of this._ink.toArray()) { const b = this.inkBox(st); x1 = Math.min(x1, b.x1); y1 = Math.min(y1, b.y1); x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2); }
          if (o.scope === "rect" && o.region) { x1 = o.region.x1; y1 = o.region.y1; x2 = o.region.x2; y2 = o.region.y2; } if (!isFinite(x1)) return null; const pad = o.pad == null ? 60 : o.pad; x1 -= pad; y1 -= pad; x2 += pad; y2 += pad; const bw = x2 - x1, bh = y2 - y1; let k = o.k || 1; const ppu0 = zf * sf; while ((bw * k * ppu0 > 15000 || bh * k * ppu0 > 15000 || bw * k * ppu0 * bh * k * ppu0 > 6e7) && k > 0.05) k *= 0.9;
          const ppu = k * ppu0, W = root.clientWidth - 2, H = root.clientHeight - 2, sw = W / k, sh = H / k, cols = Math.ceil(bw / sw), rows = Math.ceil(bh / sh), cv = document.createElement("canvas"); cv.width = Math.max(1, Math.ceil(bw * ppu)); cv.height = Math.max(1, Math.ceil(bh * ppu)); const ctx = cv.getContext("2d");
          ctx.fillStyle = o.bgCss || (getComputedStyle(root).getPropertyValue("--background-primary").trim() || "#14110f"); ctx.fillRect(0, 0, cv.width, cv.height); let n = 0;
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const ox = x1 + c * sw, oy = y1 + r * sh; this.cam = { x: ox + sw / 2, y: oy + sh / 2, k }; this.applyCam(); await raf(); await sleep(this.geo && this.geo.size > 1500 ? 380 : 220); prep(); await sleep(40);
            const b = await shot(); ctx.drawImage(b, 0, 0, b.width, b.height, Math.round((ox - x1) * ppu), Math.round((oy - y1) * ppu), Math.ceil(sw * ppu), Math.ceil(sh * ppu)); if (b.close) b.close(); n++; if (onProgress) onProgress(n / (cols * rows));
          }
          if (o.logo) this.exportLogo(ctx, cv.width, cv.height, o.light, ppu / k); return cv;
        } finally {
          for (const [, e] of this.els) e.el.style.visibility = ""; for (const [, r] of this.edgeEls) r.g.style.visibility = "";
          this.exporting = false; this.contentEl.classList.remove("osb-exporting", "osb-noink"); root.style.removeProperty("background-color"); root.classList.remove("is-exporting", "is-exp-white", "is-text-garbled"); this.cam = keep.cam; this.sel = keep.sel; this.selEdge = keep.edge; this.applyCam(); this.mark();
        }
      }
      exportLogo(ctx, w, h, light, u) { ctx.save(); ctx.font = "600 " + Math.round(15 * u) + "px 'Segoe UI', system-ui, sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "bottom"; ctx.fillStyle = light ? "rgba(0,0,0,.45)" : "rgba(255,255,255,.55)"; ctx.fillText("Basalt", w - 18 * u, h - 14 * u); ctx.restore(); }
      // a transparent background: the board is captured on black and on white, and the transparency is worked out from the two
      expandSel(list) { const out = list.slice(); for (const id of list) { const g = this.yn.get(id); if (!g || !g.get("group")) continue; for (const [i2, m2] of this.yn.entries()) if (!m2.get("group") && (m2.get("frame") === id || (!m2.get("frame") && m2.get("x") + m2.get("w") / 2 >= g.get("x") && m2.get("x") + m2.get("w") / 2 <= g.get("x") + g.get("w") && m2.get("y") + m2.get("h") / 2 >= g.get("y") && m2.get("y") + m2.get("h") / 2 <= g.get("y") + g.get("h"))) && !out.includes(i2)) out.push(i2); } return out; }
      pickRegion(cb) {
        const ov = this.root.createDiv({ cls: "osb-region" }), hint = ov.createDiv({ cls: "osb-region-h", text: "Обведите область для экспорта. Esc — отмена." }), rc = ov.createDiv({ cls: "osb-region-r" }); let a = null, done = false;
        const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fin(null); } }, fin = (r) => { if (done) return; done = true; document.removeEventListener("keydown", key, true); ov.remove(); cb(r); }; document.addEventListener("keydown", key, true);
        ov.addEventListener("pointerdown", (e) => { e.stopPropagation(); if (e.button !== 0) return; a = this.pt(e); hint.style.display = "none"; ov.setPointerCapture(e.pointerId); });
        ov.addEventListener("pointermove", (e) => { e.stopPropagation(); if (!a) return; const q = this.pt(e), x = Math.min(a.sx, q.sx), y = Math.min(a.sy, q.sy); rc.style.cssText = "display:block;left:" + x + "px;top:" + y + "px;width:" + Math.abs(q.sx - a.sx) + "px;height:" + Math.abs(q.sy - a.sy) + "px"; });
        ov.addEventListener("pointerup", (e) => { e.stopPropagation(); if (!a) return; const q = this.pt(e); if (Math.abs(q.sx - a.sx) < 12 || Math.abs(q.sy - a.sy) < 12) { a = null; rc.style.display = "none"; hint.style.display = ""; return; } const p0 = this.worldPt(Math.min(a.sx, q.sx), Math.min(a.sy, q.sy)), p1 = this.worldPt(Math.max(a.sx, q.sx), Math.max(a.sy, q.sy)); fin({ x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y }); });
      }
      mergeAlpha(cb, cw) {
        const w = cb.width, h = cb.height, xb = cb.getContext("2d"), xw = cw.getContext("2d"), out = document.createElement("canvas"); out.width = w; out.height = h; const xo = out.getContext("2d");
        for (let y0 = 0; y0 < h; y0 += 256) { const hh = Math.min(256, h - y0), B = xb.getImageData(0, y0, w, hh), Wd = xw.getImageData(0, y0, w, hh), d = B.data, e = Wd.data; for (let i = 0; i < d.length; i += 4) { const a = 1 - ((e[i] - d[i]) + (e[i + 1] - d[i + 1]) + (e[i + 2] - d[i + 2])) / 765; if (a <= 0.003) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; } else { const al = Math.min(1, a); d[i] = Math.min(255, d[i] / al); d[i + 1] = Math.min(255, d[i + 1] / al); d[i + 2] = Math.min(255, d[i + 2] / al); d[i + 3] = Math.round(al * 255); } } xo.putImageData(B, 0, y0); }
        return out;
      }
      exportDialog(init) {
        const M = new api.Modal(app); M.modalEl.addClass("bs-exp"); M.titleEl.setText("Экспорт в картинку"); const c = M.contentEl, sel = Array.from(this.sel).filter((i) => this.yn.get(i));
        const o = Object.assign({ scope: sel.length ? "sel" : "all", bg: "orig", scale: 2, pad: 40, ink: true, dest: "vault" }, (() => { try { const j = JSON.parse(localStorage.getItem("board-export") || "{}"), r = {}; for (const k of ["bg", "scale", "pad", "ink", "dest"]) if (j[k] !== undefined) r[k] = j[k]; return r; } catch (e) { return {}; } })(), init || {}); const body = c.createDiv({ cls: "bs-exp-body" }), pv = body.createDiv({ cls: "bs-exp-pv" }), opts = body.createDiv({ cls: "bs-exp-opts" }); const info = pv.createDiv({ cls: "bs-exp-info" }); let cvEl = null, tk = 0, tm = 0;
        const seg = (title, list, key, wide) => { const gr = opts.createDiv({ cls: "bs-exp-g" + (wide ? " is-wide" : "") }); gr.createDiv({ cls: "bs-exp-l", text: title }); const g = gr.createDiv({ cls: "bs-exp-seg" }); const bs = []; for (const [v, t, dis] of list) { const b = g.createDiv({ cls: "bs-exp-b" + (dis ? " is-dis" : ""), text: t }); b.onclick = () => { if (dis) return; if (key === "scope" && v === "rect") { M.close(); this.pickRegion((r) => this.exportDialog(r ? { scope: "rect", region: r } : { scope: o.scope === "rect" && !o.region ? "all" : o.scope, region: o.region })); return; } o[key] = v; bs.forEach(([x, y]) => y.classList.toggle("is-on", x === v)); draw(); }; b.classList.toggle("is-on", o[key] === v); bs.push([v, b]); } };
        seg("Что экспортировать", [["all", "Вся доска"], ["sel", "Выделенное" + (sel.length ? " (" + sel.length + ")" : ""), !sel.length], ["rect", o.region ? "Область " + Math.round(o.region.x2 - o.region.x1) + "×" + Math.round(o.region.y2 - o.region.y1) : "Обвести область…"]], "scope", true); seg("Размер картинки", [[1, "1×"], [2, "2×"], [3, "3×"]], "scale", true); seg("Фон картинки", [["orig", "Оригинальный"], ["white", "Белый"], ["black", "Чёрный"], ["none", "Прозрачный"]], "bg", true); seg("Поля картинки", [[0, "Без полей"], [20, "Малые"], [40, "Средние"], [80, "Большие"]], "pad", true); seg("Куда сохранить", [["vault", "В хранилище, рядом с доской"], ["disk", "На диск, выбрать папку…"]], "dest", true);
        const gk = opts.createDiv({ cls: "bs-exp-g" }); gk.createDiv({ cls: "bs-exp-l", text: "Рисунок" }); const lb = gk.createEl("label", { cls: "bs-exp-ck" }); const ck = lb.createEl("input", { attr: { type: "checkbox" } }); ck.checked = o.ink; lb.createSpan({ text: " Включить рисунок" }); ck.onchange = () => { o.ink = ck.checked; draw(); };
        const gn = opts.createDiv({ cls: "bs-exp-g" }); gn.createDiv({ cls: "bs-exp-l", text: "Имя файла" }); const nm = gn.createEl("input", { cls: "bs-exp-name", attr: { placeholder: (this.getDisplayText() || "Доска"), spellcheck: "false" } });
        const inRegion = () => { const r = o.region; if (!r) return []; return Array.from(this.yn.keys()).filter((i) => { const m = this.yn.get(i); return m.get("x") < r.x2 && m.get("x") + m.get("w") > r.x1 && m.get("y") < r.y2 && m.get("y") + this.effH(m) > r.y1; }); };
        const build = () => this.renderExport({ ids: o.scope === "sel" ? this.expandSel(sel) : o.scope === "rect" ? inRegion() : null, bg: o.bg, scale: o.scale, pad: o.pad, ink: o.ink });
        const draw = () => { try { localStorage.setItem("board-export", JSON.stringify({ bg: o.bg, scale: o.scale, pad: o.pad, ink: o.ink, dest: o.dest })); } catch (e) { /* private */ } pv.dataset.bg = o.bg; clearTimeout(tm); tm = setTimeout(async () => { const my = ++tk; const cv = await build(); if (my !== tk) return; if (cvEl) cvEl.remove(); if (!cv) { info.setText("Нечего экспортировать"); return; } cvEl = pv.createEl("canvas", { cls: "bs-exp-cv" }); cvEl.width = cv.width; cvEl.height = cv.height; cvEl.getContext("2d").drawImage(cv, 0, 0); pv.dataset.bg = o.bg; info.setText("Предпросмотр примерный · " + cv.width + " × " + cv.height + " px"); }, 120); };
        // the real picture: the dialog closes first (it would be in the shot), then the board is captured as it looks on screen
        const real = async () => {
          M.close(); const nt = new api.Notice("Снимаю доску…", 0), pr = (f) => nt.setMessage("Снимаю доску: " + Math.round(f * 100) + " %");
          try {
            const k = o.scale, common = { scope: o.scope, region: o.region, k, pad: o.pad, ink: o.ink }; let cv;
            if (o.bg === "none") { const b = await this.exportCapture(Object.assign({ bgCss: "#000000" }, common), (f) => pr(f / 2)); const w = await this.exportCapture(Object.assign({ bgCss: "#ffffff" }, common), (f) => pr(0.5 + f / 2)); cv = b && w ? this.mergeAlpha(b, w) : null; }
            else cv = await this.exportCapture(Object.assign(o.bg === "white" ? { bgCss: "#ffffff", pageLight: true } : o.bg === "black" ? { bgCss: "#000000" } : {}, common), pr);
            nt.hide(); if (!cv) new api.Notice("Нечего экспортировать"); return cv;
          } catch (e) { nt.hide(); console.error(e); new api.Notice("Не удалось снять картинку с экрана, рисую упрощённую"); return build(); }
        };
        const foot = c.createDiv({ cls: "modal-button-container" }); const cl = foot.createEl("button", { text: "Закрыть" }), cp = foot.createEl("button", { text: "Копировать" }), sv = foot.createEl("button", { text: "Сохранить PNG", cls: "mod-cta" });
        nm.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); sv.click(); } }; cl.onclick = () => M.close(); cp.onclick = async () => { const cv = await real(); if (cv) this.outputPng(cv, "clip"); }; sv.onclick = async () => { const cv = await real(); if (cv) { if (o.dest === "disk") await this.saveCapture(cv, nm.value || (this.getDisplayText() || "Доска") + (o.scope === "all" ? "" : " (часть)")); else this.outputPng(cv, "file", o.scope === "all" ? "" : " (часть)", nm.value); } };
        M.open(); draw();
      }
      async saveCapture(cv, name) {
        const blob = await new Promise((r) => cv.toBlob(r, "image/png")); if (!blob) { new api.Notice("Не удалось собрать картинку"); return false; }
        const remote = window.electron.remote, picked = await remote.dialog.showSaveDialog({ defaultPath: ((name && name.trim()) || this.getDisplayText() || "Доска") + ".png", filters: [{ name: "PNG", extensions: ["png"] }, { name: "Все файлы", extensions: ["*"] }] }), fp = picked && (picked.filePath || (picked[1] && picked[1]));
        if (!picked || picked.canceled || !fp) return false; try { await window.require("fs").promises.writeFile(fp, window.require("buffer").Buffer.from(await blob.arrayBuffer())); new api.Notice(fp, 10000); return true; } catch (e) { new api.Notice("Не удалось сохранить файл"); return false; }
      }
      // ---------- version history ----------
      histDir() { return ".basalt-history/" + this.path.replace(/[\\/]/g, "__") + "/"; }
      snapData() { const nodes = []; this.yn.forEach((m, id) => nodes.push({ id, x: m.get("x"), y: m.get("y"), w: m.get("w"), h: m.get("h"), color: m.get("color") || "", text: m.get("text") ? m.get("text").toString() : "", img: m.get("img") || "", fold: !!m.get("fold"), locked: !!m.get("locked") })); const edges = []; this.ye.forEach((m) => edges.push({ a: m.get("a"), b: m.get("b"), label: m.get("label") || "" })); return { v: 1, t: Date.now(), nodes, edges, ink: this._ink ? this._ink.toArray() : [] }; }
      async snapshot(force) {
        if (!this.doc || !this.path || this.ro && !force) return false; const d = this.snapData(); if (!d.nodes.length && !d.ink.length) return false; const body = JSON.stringify({ nodes: d.nodes, edges: d.edges, ink: d.ink }); if (!force && body === this._lastSnap) return false; this._lastSnap = body.length > 4e6 ? body.length + ":" + d.nodes.length : body; this._lastSnapT = Date.now();
        try { const dir = this.histDir(), ad = app.vault.adapter; if (!(await ad.exists(".basalt-history"))) await ad.mkdir(".basalt-history"); if (!(await ad.exists(dir))) await ad.mkdir(dir); await ad.write(dir + d.t + ".json", '{"v":1,"t":' + d.t + "," + body.slice(1)); const ls = (await ad.list(dir)).files.sort(); for (const f of ls.slice(0, Math.max(0, ls.length - 40))) await ad.remove(f);
          { let keep = ls.slice(-40), tot = 0; const sizes = []; for (const f of keep) { let s = 0; try { s = (await ad.stat(f)).size || 0; } catch (e) { /* gone */ } sizes.push(s); tot += s; } let i = 0; while (tot > 150e6 && i < keep.length - 3) { try { await ad.remove(keep[i]); } catch (e) { /* gone */ } tot -= sizes[i]; i++; } }
          return true; } catch (e) { console.error(e); return false; }
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

      // ---------- card types and layout presets ----------
      typesList() { if (this._tl && Date.now() - this._tlT < 1500) return this._tl; const r = this.typesList0(); this._tl = r; this._tlT = Date.now(); return r; }
      typesList0() { try { const j = JSON.parse(localStorage.getItem("board-types") || "null"); if (Array.isArray(j) && j.length) return j; } catch (e) { /* default */ } return [{ n: "Человек", c: "#3fa7d6" }, { n: "Организация", c: "#8e6bd8" }, { n: "Адрес", c: "#46a758" }, { n: "Телефон", c: "#f59f3b" }, { n: "Событие", c: "#e5484d" }, { n: "Документ", c: "#d6b43c" }]; }
      saveTypes(l) { this._tl = null; try { localStorage.setItem("board-types", JSON.stringify(l)); } catch (e) { /* private */ } }
      presetsList() { try { const j = JSON.parse(localStorage.getItem("board-layout-presets") || "null"); if (Array.isArray(j)) return j; } catch (e) { /* none */ } return []; }
      savePresets(l) { try { localStorage.setItem("board-layout-presets", JSON.stringify(l)); } catch (e) { /* private */ } }
      kindMenu(e, id) {
        const mn = new api.Menu(), it = (t, ic, fn) => mn.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn)), cur = this.yn.get(id) && this.yn.get(id).get("kind") || "", ids = this.sel.has(id) ? Array.from(this.sel) : [id];
        for (const t of this.typesList()) mn.addItem((i) => i.setTitle(t.n).setIcon("lucide-tag").setChecked(cur === t.n).onClick(() => this.setKind(t.n, ids)));
        mn.addSeparator(); it("Свой подзаголовок…", "lucide-type", async () => { const n = await ask("Подзаголовок карточки", cur, { max: 40, hint: "Свой короткий подзаголовок или тип. До 40 символов." }); if (n == null) return; if (n) { const l = this.typesList(); if (!l.find((q) => q.n === n)) { l.push({ n, c: "" }); this.saveTypes(l); } } this.setKind(n, ids); }); if (cur) it("Убрать", "lucide-x", () => this.setKind("", ids)); mn.showAtMouseEvent(e);
      }
      setKind(name, only) { if (this.ro) return; const t = this.typesList().find((q) => q.n === name); this.doc.transact(() => { for (const id of (only || this.sel)) { const m = this.yn.get(id); if (!m) continue; if (name) { m.set("kind", name); if (t && t.c) m.set("color", t.c); } else m.delete("kind"); this.stampM(m); } }); this.selBar.dataset.sig = ""; }
      typeMenu(e) {
        const mn = new api.Menu(), it = (t, ic, fn) => mn.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn)), cur = new Set(Array.from(this.sel).map((i) => this.yn.get(i) && this.yn.get(i).get("kind") || ""));
        for (const t of this.typesList()) mn.addItem((i) => i.setTitle(t.n).setIcon("lucide-tag").setChecked(cur.size === 1 && cur.has(t.n)).onClick(() => this.setKind(t.n)));
        mn.addSeparator(); it("Новый тип…", "lucide-plus", async () => { const n = await ask("Название типа"); if (!n) return; const l = this.typesList(); if (!l.find((q) => q.n === n)) { l.push({ n, c: PEER[l.length % PEER.length] }); this.saveTypes(l); } this.setKind(n); }); it("Без типа", "lucide-x", () => this.setKind("")); mn.showAtMouseEvent(e);
      }
      layoutMenu(e) {
        const mn = new api.Menu(), it = (t, ic, fn) => mn.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn)), ids = this.sel.size > 1 ? Array.from(this.sel) : null, sc = ids ? " (выделенные)" : "";
        it("Умная раскладка" + sc, "lucide-wand-sparkles", () => this.layout("auto", ids)); mn.addSeparator(); it("Дерево слева направо", "lucide-git-fork", () => this.layout("lr", ids)); it("Дерево сверху вниз", "lucide-git-branch", () => this.layout("td", ids)); it("Радиально", "lucide-orbit", () => this.layout("radial", ids)); it("Силовая раскладка", "lucide-network", () => this.layout("force", ids));
        mn.addSeparator(); it("По типам карточек" + sc, "lucide-tags", () => this.layoutTyped({ dir: "lr", levels: this.typesList().map((q) => [q.n]), gap: "normal", order: "links" }, ids)); for (const pr of this.presetsList()) it(pr.name + sc, "lucide-layout-template", () => this.layoutTyped(pr, ids));
        it("Свои пресеты раскладки…", "lucide-sliders-horizontal", () => this.presetsDialog()); mn.addSeparator(); if (this._prevPos) it("Вернуть прежнее расположение", "lucide-undo-2", () => this.restorePos()); it("По сетке" + sc, "lucide-grid-3x3", () => this.tidy("grid", ids)); it("Расставить блоками" + sc, "lucide-layout-grid", () => this.tidy("cells", ids)); mn.showAtMouseEvent(e);
      }
      layoutTyped(pr, ids) {
        if (this.ro) return; ids = (ids && ids.length ? ids : Array.from(this.yn.keys())).filter((i) => this.yn.get(i) && !this.yn.get(i).get("locked") && !this.yn.get(i).get("group")); if (ids.length < 2) return; if (!ids.some((i) => this.yn.get(i).get("kind"))) { new api.Notice("У карточек нет типов. Выделите карточки и поставьте тип кнопкой с ярлыком."); return; } this.keepPos(ids); this.um && this.um.stopCapturing();
        const g = (i) => this.yn.get(i), lr = pr.dir !== "td", gp = ({ compact: [60, 16], normal: [100, 32], wide: [170, 56] })[pr.gap] || [100, 32], idx = new Map(); pr.levels.forEach((L, k) => L.forEach((n) => idx.set(n, k)));
        const layers = pr.levels.map(() => []), rest = []; for (const i of ids) { const k = g(i).get("kind") || ""; if (idx.has(k)) layers[idx.get(k)].push(i); else rest.push(i); } if (rest.length) layers.push(rest); const L = layers.filter((x) => x.length);
        const W = (i) => g(i).get("w"), H = (i) => this.effH(g(i)), nb = new Map(ids.map((i) => [i, []])), set = new Set(ids); for (const e of this.ye.values()) { const a = e.get("a"), b = e.get("b"); if (set.has(a) && set.has(b)) { nb.get(a).push(b); nb.get(b).push(a); } }
        const pos0 = (i) => (lr ? g(i).get("y") : g(i).get("x")), name = (i) => g(i).get("text").toString().toLowerCase(); const level = new Map(); L.forEach((x, k) => x.forEach((i) => level.set(i, k)));
        L.forEach((x) => x.sort((a, b) => (pr.order === "name" ? name(a).localeCompare(name(b)) : pos0(a) - pos0(b)))); const order = new Map(); L.forEach((x) => x.forEach((i, k) => order.set(i, k)));
        if (pr.order !== "name" && pr.order !== "pos") for (let sw = 0; sw < 4; sw++) { const seq = sw % 2 ? L.map((_, k) => L.length - 1 - k) : L.map((_, k) => k); for (const d of seq) { const X = L[d]; const bc = (i) => { const ns = nb.get(i).filter((n) => level.get(n) !== d); return ns.length ? ns.reduce((s2, n) => s2 + order.get(n) / Math.max(1, L[level.get(n)].length) , 0) / ns.length : order.get(i) / Math.max(1, X.length); }; X.sort((a, b) => bc(a) - bc(b)); X.forEach((i, k) => order.set(i, k)); } }
        const bb = this.bounds(ids), lw = L.map((X) => Math.max.apply(null, X.map(lr ? W : H))), ext = L.map((X) => X.reduce((s2, i) => s2 + (lr ? H(i) : W(i)) + gp[1], -gp[1])), total = Math.max.apply(null, ext), cc = lr ? bb.y + bb.h / 2 : bb.x + bb.w / 2; let off = lr ? bb.x : bb.y;
        this.doc.transact(() => { L.forEach((X, d) => { let t = cc - ext[d] / 2; for (const i of X) { if (lr) { g(i).set("x", Math.round(off + (lw[d] - W(i)) / 2)); g(i).set("y", Math.round(t)); t += H(i) + gp[1]; } else { g(i).set("y", Math.round(off + (lw[d] - H(i)) / 2)); g(i).set("x", Math.round(t)); t += W(i) + gp[1]; } } off += lw[d] + gp[0]; }); });
        this.assignSides(ids); this.refitFrames(ids); this.um && this.um.stopCapturing(); this.fit(); this.toastUndo("Раскладка «" + (pr.name || "по типам") + "» применена.");
      }
      presetsDialog() {
        const M = new api.Modal(app); M.modalEl.addClass("bs-imp"); M.titleEl.setText("Свои пресеты раскладки"); const c = M.contentEl; c.createDiv({ cls: "bs-imp-top" }).createSpan({ text: "Пресет задаёт, в каком порядке по уровням стоят карточки разных типов. Тип карточки ставится кнопкой с ярлыком на панели выделения." }); const list = c.createDiv({ cls: "bs-imp-list" });
        const draw = () => { list.empty(); const ps = this.presetsList(); if (!ps.length) list.createDiv({ cls: "bs-imp-empty", text: "Пока нет своих пресетов" }); ps.forEach((pr, k) => { const r = list.createDiv({ cls: "bs-imp-row" }); r.createSpan({ cls: "bs-imp-t", text: pr.name }); r.createSpan({ cls: "bs-imp-p", text: pr.levels.map((x) => x.join(" / ")).join(" → ") }); const ed = r.createEl("button", { text: "Изменить" }), de = r.createEl("button", { text: "Удалить" }); ed.style.cssText = de.style.cssText = "height:26px;padding:0 10px;font-size:12px"; ed.onclick = () => this.presetEditor(pr, (np) => { const l = this.presetsList(); l[k] = np; this.savePresets(l); draw(); }); de.onclick = () => { const l = this.presetsList(); l.splice(k, 1); this.savePresets(l); draw(); }; }); };
        draw(); const foot = c.createDiv({ cls: "modal-button-container" }); const nw = foot.createEl("button", { text: "Новый пресет", cls: "mod-cta" }); nw.onclick = () => this.presetEditor(null, (np) => { const l = this.presetsList(); l.push(np); this.savePresets(l); draw(); }); foot.createEl("button", { text: "Закрыть" }).onclick = () => M.close(); M.open();
      }
      presetEditor(pr, done) {
        const M = new api.Modal(app); M.modalEl.addClass("bs-imp"); M.titleEl.setText(pr ? "Изменить пресет" : "Новый пресет"); const c = M.contentEl, o = pr ? JSON.parse(JSON.stringify(pr)) : { name: "", dir: "lr", levels: [[]], gap: "normal", order: "links" };
        c.createDiv({ cls: "bs-exp-l", text: "Название пресета" }); const nm = c.createEl("input", { attr: { placeholder: "Например: Схема связей", spellcheck: "false" } }); nm.style.width = "100%"; nm.value = o.name; nm.oninput = () => { o.name = nm.value; };
        const seg = (title, list, key) => { c.createDiv({ cls: "bs-exp-l", text: title }); const gq = c.createDiv({ cls: "bs-exp-seg" }); const bs = []; for (const [v, t] of list) { const b = gq.createDiv({ cls: "bs-exp-b", text: t }); b.onclick = () => { o[key] = v; bs.forEach(([x, y]) => y.classList.toggle("is-on", x === v)); }; b.classList.toggle("is-on", o[key] === v); bs.push([v, b]); } };
        seg("Направление уровней", [["lr", "Слева направо"], ["td", "Сверху вниз"]], "dir"); seg("Расстояния между карточками", [["compact", "Плотно"], ["normal", "Обычно"], ["wide", "Свободно"]], "gap"); seg("Порядок внутри уровня", [["links", "По связям"], ["name", "По алфавиту"], ["pos", "Как сейчас"]], "order");
        c.createDiv({ cls: "bs-exp-l", text: "Уровни и типы карточек на них" }); const lv = c.createDiv({ cls: "bs-pe-levels" });
        const draw = () => { lv.empty(); const types = this.typesList(); o.levels.forEach((L, k) => { const r = lv.createDiv({ cls: "bs-pe-row" }); r.createSpan({ cls: "bs-pe-n", text: "Уровень " + (k + 1) }); const chips = r.createDiv({ cls: "bs-pe-chips" }); for (const t of types) { const ch = chips.createSpan({ cls: "bs-pe-chip" + (L.includes(t.n) ? " is-on" : ""), text: t.n }); ch.style.setProperty("--c", t.c || "var(--interactive-accent)"); ch.onclick = () => { for (const X of o.levels) { const q = X.indexOf(t.n); if (q >= 0) X.splice(q, 1); } if (!L.includes(t.n)) L.push(t.n); draw(); }; } if (o.levels.length > 1) { const x = r.createSpan({ cls: "bs-pe-x", text: "×" }); x.onclick = () => { o.levels.splice(k, 1); draw(); }; } }); };
        draw(); const row = c.createDiv({ cls: "bs-imp-top" }); const addL = row.createEl("button", { text: "Добавить уровень" }), addT = row.createEl("button", { text: "Новый тип карточек" }); addL.onclick = () => { o.levels.push([]); draw(); }; addT.onclick = async () => { const n = await ask("Название типа"); if (!n) return; const l = this.typesList(); if (!l.find((q) => q.n === n)) { l.push({ n, c: PEER[l.length % PEER.length] }); this.saveTypes(l); } draw(); };
        const foot = c.createDiv({ cls: "modal-button-container" }); foot.createEl("button", { text: "Отмена" }).onclick = () => M.close(); const ok = foot.createEl("button", { text: "Сохранить", cls: "mod-cta" }); ok.onclick = () => { o.name = (o.name || "").trim() || "Мой пресет"; o.levels = o.levels.filter((x) => x.length); if (!o.levels.length) { new api.Notice("Добавьте хотя бы один уровень с типом"); return; } done(o); M.close(); }; M.open();
      }

      // ---------- notes, keyboard work, focus and paths ----------
      childSpot(id) { const m = this.yn.get(id); let bottom = null; for (const ed of this.ye.values()) if (ed.get("a") === id) { const c = this.yn.get(ed.get("b")); if (c) bottom = Math.max(bottom == null ? -1e9 : bottom, c.get("y") + c.get("h")); } return { x: m.get("x") + m.get("w") + 90, y: bottom == null ? m.get("y") : bottom + 30 }; }
      addChild(id) { const m = this.yn.get(id); if (!m || this.ro) return; this.um && this.um.stopCapturing(); const sp = this.childSpot(id), nid = this.addCard(sp.x, sp.y); this.addEdge(id, nid, "r", "l"); this.um && this.um.stopCapturing(); this.revealCard(nid); return nid; }
      addSibling(id) { const m = this.yn.get(id); if (!m || this.ro) return; this.um && this.um.stopCapturing(); const nid = this.addCard(m.get("x"), m.get("y") + this.effH(m) + 36); for (const ed of Array.from(this.ye.values())) if (ed.get("b") === id) this.addEdge(ed.get("a"), nid, ed.get("sa") || "", "l"); this.um && this.um.stopCapturing(); this.revealCard(nid); return nid; }
      revealCard(id) { const m = this.yn.get(id); if (!m) return; const a = this.screenPt(m.get("x"), m.get("y")), b = this.screenPt(m.get("x") + m.get("w"), m.get("y") + m.get("h")); if (a.x < 40 || a.y < 60 || b.x > this.root.clientWidth - 70 || b.y > this.root.clientHeight - 40) { this.cam.x = m.get("x") + m.get("w") / 2; this.cam.y = m.get("y") + m.get("h") / 2; this.applyCam(); } }
      jump(id, dir) {
        const m = this.yn.get(id); if (!m) return; const c = this.center(id), V = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[dir]; let best = null, bs = 1e9;
        for (const [oid, o] of this.yn.entries()) { if (oid === id) continue; const oc = this.center(oid), dx = oc.x - c.x, dy = oc.y - c.y, along = dx * V[0] + dy * V[1]; if (along <= 0) continue; const side = Math.abs(dx * V[1] - dy * V[0]); if (side > along * 1.6) continue; const sc = along + side * 1.5; if (sc < bs) { bs = sc; best = oid; } }
        if (best) { this.select(new Set([best])); this.revealCard(best); }
      }
      neighbours(ids, depth) { const out = new Set(ids), es = new Set(); let front = new Set(ids); for (let d = 0; d < depth; d++) { const nx = new Set(); for (const [eid, e] of this.ye.entries()) { const a = e.get("a"), b = e.get("b"); if (front.has(a) || front.has(b)) { es.add(eid); for (const n of [a, b]) if (!out.has(n)) { out.add(n); nx.add(n); } } } front = nx; } return { ids: out, edges: es }; }
      applyFocus(ids, edges, path) { this._fo = { ids, edges, path: !!path }; this.root.classList.add("has-focus"); for (const [id, e] of this.els) { e.el.classList.toggle("is-dim", !ids.has(id)); e.el.classList.toggle("is-path", !!path && ids.has(id)); } for (const [id, r] of this.edgeEls) r.g.classList.toggle("is-dim", !edges.has(id)); }
      clearFocus() { if (!this.root) return; this._fo = null; this.focusDepth = 0; this.root.classList.remove("has-focus"); for (const [, e] of this.els) { e.el.classList.remove("is-dim", "is-path"); } for (const [, r] of this.edgeEls) r.g.classList.remove("is-dim"); }
      toggleFocus() { const ids = Array.from(this.sel); if (!ids.length) { this.clearFocus(); return; } this.focusDepth = ((this.focusDepth || 0) + 1) % 3; if (!this.focusDepth) { this.clearFocus(); return; } const n = this.neighbours(ids, this.focusDepth); this.applyFocus(n.ids, n.edges); new api.Notice(this.focusDepth === 1 ? "Показаны прямые связи. W — на шаг дальше." : "Показаны связи на два шага. W — выключить."); }
      showPath() {
        const ids = Array.from(this.sel); if (ids.length !== 2) return; const [a, b] = ids, adj = new Map(); for (const [eid, e] of this.ye.entries()) { for (const [x, y] of [[e.get("a"), e.get("b")], [e.get("b"), e.get("a")]]) { if (!adj.has(x)) adj.set(x, []); adj.get(x).push([y, eid]); } }
        const prev = new Map([[a, null]]), q = [a]; for (let h = 0; h < q.length && !prev.has(b); h++) for (const [n, eid] of adj.get(q[h]) || []) if (!prev.has(n)) { prev.set(n, [q[h], eid]); q.push(n); }
        if (!prev.has(b)) { new api.Notice("Связи между этими карточками нет"); return; } const pids = new Set(), pes = new Set(), chain = []; for (let v = b; v; ) { pids.add(v); chain.push(this.label(v)); const p2 = prev.get(v); if (!p2) break; pes.add(p2[1]); v = p2[0]; }
        this.applyFocus(pids, pes, true); this.focusDepth = 0; chain.reverse(); new api.Notice("Цепочка из " + (chain.length - 1) + " звеньев: " + chain.map((x) => "«" + x + "»").join(" → "), 9000);
      }
      boardPalette() {
        const M = new api.Modal(app); M.modalEl.addClass("bs-pal"); const c = M.contentEl; const inp = c.createEl("input", { cls: "bs-pal-in", attr: { placeholder: "Что сделать на доске…", spellcheck: "false" } }); const list = c.createDiv({ cls: "bs-pal-list" });
        const all = Array.from(this.yn.keys()), types = Array.from(new Set(all.map((i) => this.yn.get(i).get("kind")).filter(Boolean)));
        const A = [["Новая карточка", "N", () => this.addCard()], ["Найти карточку", "Ctrl+F", () => this.toggleSearch(true)], ["Показать всё", "F", () => this.fit()], ["Выделить всё", "Ctrl+A", () => this.select(new Set(all))], ["Умная раскладка", "", () => this.layout("auto", this.sel.size > 1 ? Array.from(this.sel) : null)], ["Раскладка: по типам карточек", "", () => this.layoutTyped({ dir: "lr", levels: this.typesList().map((q) => [q.n]), gap: "normal", order: "links" }, null)], ["Раскладка: дерево слева направо", "", () => this.layout("lr", null)], ["Раскладка: дерево сверху вниз", "", () => this.layout("td", null)], ["Раскладка: радиально", "", () => this.layout("radial", null)], ["Раскладка: силовая", "", () => this.layout("force", null)],
          ["Рамка вокруг выделенных карточек", "", () => this.groupSel()], ["Свернуть выделенные карточки", "Z", () => this.setFold(true)], ["Развернуть выделенные карточки", "Z", () => this.setFold(false)], ["Свернуть все карточки", "", () => { this.sel = new Set(all); this.setFold(true); this.sel = new Set(); this.mark(); }], ["Развернуть все карточки", "", () => { this.sel = new Set(all); this.setFold(false); this.sel = new Set(); this.mark(); }],
          ["Показать связи выделенной карточки", "W", () => this.toggleFocus()], ["Как связаны две выделенные карточки", "P", () => this.showPath()], ["Связать две выделенные карточки", "L", () => { const s2 = Array.from(this.sel); if (s2.length === 2) this.addEdge(s2[0], s2[1], this.nearSide(s2[0], this.center(s2[1])), this.nearSide(s2[1], this.center(s2[0]))); }], ["Рисование", "", () => this.toggleDraw(true)], ["Экспорт в картинку", "", () => this.exportDialog()], ["История версий", "", () => this.historyDialog()], ["Импортировать другую доску", "", () => this.importDialog()], ["Добавить изображение", "", () => this.pickImage()], ["Справка по доске", "", () => this.toggleHelp()], ["Заблокировать или разблокировать доску", "", () => this.toggleLock()]];
        for (const t2 of types) A.push(["Выделить карточки типа «" + t2 + "»", "", () => this.select(new Set(all.filter((i) => this.yn.get(i).get("kind") === t2)))]);
        let shown = [], at = 0; const draw = () => { list.empty(); const q = inp.value.trim().toLowerCase(); shown = A.filter((a) => !q || a[0].toLowerCase().includes(q)); at = Math.min(at, Math.max(0, shown.length - 1)); shown.forEach((a, k) => { const r = list.createDiv({ cls: "bs-pal-row" + (k === at ? " is-on" : "") }); r.createSpan({ cls: "bs-pal-t", text: a[0] }); if (a[1]) r.createSpan({ cls: "bs-kbd", text: a[1] }); r.onclick = () => { M.close(); setTimeout(a[2], 30); }; r.onmouseenter = () => { at = k; list.querySelectorAll(".bs-pal-row").forEach((x, j) => x.classList.toggle("is-on", j === k)); }; }); if (!shown.length) list.createDiv({ cls: "bs-pal-empty", text: "Ничего не найдено" }); };
        inp.oninput = () => { at = 0; draw(); }; inp.onkeydown = (e) => { if (e.key === "ArrowDown") { e.preventDefault(); at = Math.min(shown.length - 1, at + 1); draw(); const x = list.children[at]; x && x.scrollIntoView({ block: "nearest" }); } else if (e.key === "ArrowUp") { e.preventDefault(); at = Math.max(0, at - 1); draw(); const x = list.children[at]; x && x.scrollIntoView({ block: "nearest" }); } else if (e.key === "Enter") { e.preventDefault(); const a = shown[at]; if (a) { M.close(); setTimeout(a[2], 30); } } };
        draw(); M.open(); setTimeout(() => inp.focus(), 30);
      }
      initHistory() {
        const Y = window.__bsY.Y; if (this.um) { try { this.um.destroy(); } catch (e) { /* ignore */ } } this.inkArr(); this.renderInk(); this.um = new Y.UndoManager(this._ink ? [this.yn, this.ye, this._ink] : [this.yn, this.ye], { captureTimeout: 500 });
        const upd = () => { if (this.undoBtn) { this.undoBtn.classList.toggle("is-off", !this.um.undoStack.length); this.redoBtn.classList.toggle("is-off", !this.um.redoStack.length); } };
        this.um.on("stack-item-added", upd); this.um.on("stack-item-popped", upd); upd();
      }
      undo() { if (this.ro || !this.um) return; this.um.undo(); this.flush(); }
      redo() { if (this.ro || !this.um) return; this.um.redo(); this.flush(); }
      zoomBy(f) { const k0 = this.cam.k; this.cam.k = Math.max(.1, Math.min(3, k0 * f)); this.applyCam(); }
      sn(v) { return this.snap ? Math.round(v / 20) * 20 : Math.round(v); }
      // ---------- selection toolbar, copy / paste, alignment ----------
      bounds(ids) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const id of ids) { const m = this.yn.get(id); if (!m) continue; a = Math.min(a, m.get("x")); b = Math.min(b, m.get("y")); c = Math.max(c, m.get("x") + m.get("w")); d = Math.max(d, m.get("y") + m.get("h")); } return a === 1e9 ? null : { x: a, y: b, w: c - a, h: d - b }; }
      renderSelBar() {
        const bar = this.selBar; if (!bar) return; if (!this.sel.size || this.ro || (this.drag && this.drag.kind === "move")) { bar.classList.remove("is-on"); return; }
        const key = this._selVer + "|" + this._dataVer; let ids, bb0; if (key === this._sbKey && this._sbIds) { ids = this._sbIds; bb0 = this._sbBB; } else { ids = Array.from(this.sel).filter((i) => this.yn.get(i)); this._sbKey = key; this._sbIds = ids; this._sbBB = bb0 = ids.length ? this.bounds(ids) : null; this._sbSig = null; } if (!ids.length) { bar.classList.remove("is-on"); return; }
        const sig = this._sbSig || (this._sbSig = ids.length + "|" + ids.map((i) => (this.yn.get(i).get("kind") || "") + (this.yn.get(i).get("locked") ? 1 : 0) + (this.yn.get(i).get("fold") ? "f" : "") + (this.yn.get(i).get("trOrig") != null ? "t" : "")).join("")); if (bar.dataset.sig !== sig) {
          bar.dataset.sig = sig; bar.empty(); const mk = (ic, tip, fn) => { const x = bar.createDiv({ cls: "osb-sb", attr: { title: tip } }); api.setIcon(x, ic); x.onclick = (e) => fn(e); return x; };
          const hasOrig = ids.some((i) => this.yn.get(i).get("trOrig") != null); const cols = new Set(ids.map((i) => this.yn.get(i).get("color") || "")), cur = cols.size === 1 ? Array.from(cols)[0] : ""; const cb = bar.createDiv({ cls: "osb-sb osb-colorbtn", attr: { title: "Цвет" } }); const ci = cb.createSpan({ cls: "osb-cico" }); api.setIcon(ci, "lucide-palette"); const cbar = cb.createDiv({ cls: "osb-cbar" }); if (cur) cbar.style.background = cur; else cbar.classList.add("is-none"); cb.onclick = () => window.__bsColors.pick(cb, cur, (c) => this.setColor(c));
          bar.createDiv({ cls: "osb-bsep" }); mk("lucide-copy", "Дублировать (Ctrl+D)", () => this.duplicate());
          const locked = ids.every((i) => this.yn.get(i).get("locked")); mk(locked ? "lucide-unlock" : "lucide-lock", locked ? "Разблокировать" : "Закрепить на месте", () => this.setLock(!locked));
          mk("lucide-frame", "Рамка вокруг выделенных", () => this.groupSel()); if (ids.length === 2) mk("lucide-route", "Как связаны (P)", () => this.showPath()); mk("lucide-tag", "Тип карточки", (e) => this.typeMenu(e)); if (ids.length > 1) mk("lucide-align-horizontal-distribute-center", "Выровнять", (e) => this.alignMenu(e));
          if (ids.length > 1) mk("lucide-network", "Раскладка", (e) => this.layoutMenu(e));
          const folded = ids.every((i) => this.yn.get(i).get("fold")); mk(folded ? "lucide-chevrons-up-down" : "lucide-chevrons-down-up", folded ? "Развернуть" : "Свернуть (Z)", () => this.setFold(!folded));
          mk("lucide-languages", "Перевести", () => this.translate(bar)); if (hasOrig) mk("lucide-undo-2", "Вернуть оригинал", () => this.restoreOrig());
          bar.createDiv({ cls: "osb-bsep" }); mk("lucide-trash-2", "Удалить (Del)", () => this.removeSel()).classList.add("is-danger");
        }
        const bb = bb0; if (!bb) { bar.classList.remove("is-on"); return; } const tl = this.screenPt(bb.x + bb.w / 2, bb.y); bar.classList.add("is-on"); const w = bar.offsetWidth || 260, rw = this.root.clientWidth;
        bar.style.left = Math.max(8, Math.min(rw - w - 8, tl.x - w / 2)) + "px"; bar.style.top = Math.max(56, tl.y - 54) + "px";
      }
      screenPt(wx, wy) { return { x: (wx - this.cam.x) * this.cam.k + this.root.clientWidth / 2, y: (wy - this.cam.y) * this.cam.k + this.root.clientHeight / 2 }; }
      setLock(on) { if (this.ro) return; this.doc.transact(() => { for (const id of this.sel) { const m = this.yn.get(id); if (m) m.set("locked", !!on); } }); this.selBar.dataset.sig = ""; this.sync(); }
      duplicate() { this.copy(); this.paste(30, 30); }
      copy() { const ids = Array.from(this.sel).filter((i) => this.yn.get(i)); if (!ids.length) return; const nodes = ids.map((i) => { const m = this.yn.get(i); return { id: i, x: m.get("x"), y: m.get("y"), w: m.get("w"), h: m.get("h"), color: m.get("color") || "", text: m.get("text").toString() }; }); const idSet = new Set(ids), edges = []; this.ye.forEach((e) => { if (idSet.has(e.get("a")) && idSet.has(e.get("b"))) edges.push({ a: e.get("a"), b: e.get("b"), label: e.get("label") || "" }); }); BOARD_CLIP = { nodes, edges }; try { navigator.clipboard.writeText(nodes.map((n) => n.text).join("\n\n")); } catch (e) { /* ignore */ } }
      paste(dx, dy) {
        if (this.ro || !BOARD_CLIP) return; const Y = window.__bsY.Y, map = {}, ids = [];
        this.doc.transact(() => { for (const n of BOARD_CLIP.nodes) { const id = uid(), m = new Y.Map(), t = new Y.Text(); t.insert(0, n.text); m.set("x", n.x + dx); m.set("y", n.y + dy); m.set("w", n.w); m.set("h", n.h); m.set("color", n.color); m.set("by", me.name); this.stampM(m); m.set("text", t); this.yn.set(id, m); map[n.id] = id; ids.push(id); } for (const e of BOARD_CLIP.edges) { const m = new Y.Map(); m.set("a", map[e.a]); m.set("b", map[e.b]); m.set("label", e.label); this.ye.set(uid(), m); } });
        if (ids.length > 20) this.feed("add", ids[0], ids.length + " карточек"); else for (const id of ids) this.feed("add", id, this.label(id)); this.select(new Set(ids));
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
        this.flush(); const q = this.searchInput.value.trim().toLowerCase(), hits = [];
        if (q) for (const [id, g] of this.geo) { let t = g.tl; if (t == null) { t = g.m.get("text"); t = g.tl = t ? t.toString().toLowerCase() : ""; } if (t.includes(q)) hits.push(id); }
        const prev = this._hits && this._hits[this._hi || 0]; this._hits = hits; this._hitSet = new Set(hits); this._hi = hits.length ? (step ? ((this._hi || 0) + step + hits.length) % hits.length : Math.max(0, hits.indexOf(prev))) : 0; this._curHit = q && hits.length ? hits[this._hi] : null;
        this.root.classList.toggle("has-q", !!q);
        { const old = this._hitOld || new Set(), cur = this._curHit; for (const id of old) if (!this._hitSet.has(id)) { const e = this.els.get(id); if (e) e.el.classList.remove("is-hit", "is-cur"); } for (const id of this._hitSet) { const e = this.els.get(id); if (e) { e.el.classList.add("is-hit"); e.el.classList.toggle("is-cur", cur === id); } } this._hitOld = this._hitSet; }
        this.searchCount.textContent = q ? (hits.length ? (this._hi + 1) + " / " + hits.length : "нет совпадений") : ""; this.searchBox.classList.toggle("is-empty", !!q && !hits.length);
        if (jump && hits.length) { const m = this.yn.get(hits[this._hi]); const bb = { x: m.get("x") + m.get("w") / 2, y: m.get("y") + m.get("h") / 2 }; this.cam.x = bb.x; this.cam.y = bb.y; this.applyCam(); this.cull(); }
      }
      stampM(m) { m.set("lastBy", me.name); m.set("lastAt", Date.now()); m.set("lastColor", me.color); }
      label(id) { const m = this.yn.get(id); const t = m && m.get("text") ? m.get("text").toString().trim().split("\n")[0] : ""; return t ? (t.length > 28 ? t.slice(0, 28) + "…" : t) : "карточка"; }
      feedArr() {
        if (this._feed) return this._feed; const Y = window.__bsY.Y;
        if (this.sh) { const e = this.sh.files.get(this.relPath); if (!e) return null; let f = e.get("feed"); if (!f) { f = new Y.Array(); e.set("feed", f); } this._feed = f; } else this._feed = this.doc.getArray("feed");
        this._feed.observe(() => this.renderFeedSoon()); return this._feed;
      }
      feed(kind, id, note) {
        const f = this.feedArr(); if (!f) return; const now = Date.now(), n = f.length, last = n ? f.get(n - 1) : null;
        if (last && last.who === me.name && last.kind === kind && last.id === id && now - last.t < 30000 && (kind === "edit" || kind === "move")) { this.doc.transact(() => { f.delete(n - 1, 1); f.push([Object.assign({}, last, { t: now })]); }); return; }
        this.doc.transact(() => { f.push([{ t: now, who: me.name, color: me.color, kind, id: id || null, note: note || "" }]); if (f.length > 120) f.delete(0, f.length - 120); });
      }
      flashMany(ids) {
        const list = []; for (const i of ids) { const e = this.els.get(i), m = this.yn.get(i); if (e && m) list.push([e, m]); } if (!list.length) return;
        for (const [e, m] of list) { e.el.style.setProperty("--flash", m.get("lastColor") || "var(--interactive-accent)"); e.el.classList.remove("flash"); }
        void this.cards.offsetWidth; for (const [e] of list) e.el.classList.add("flash");
      }
      renderFeedSoon() { if (this._feedRaf) return; this._feedRaf = requestAnimationFrame(() => { this._feedRaf = 0; this.renderFeed(); }); }
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
      // many cards in one transaction (one redraw, one activity entry); returns their ids
      pasteLines(lines, w, cols) {
        if (this.ro || !lines.length) return []; const Y = window.__bsY.Y, ids = []; cols = cols || Math.max(1, Math.min(5, Math.ceil(Math.sqrt(lines.length))));
        this.doc.transact(() => { lines.forEach((ln, k) => { const id = uid(), m = new Y.Map(), t = new Y.Text(); m.set("x", Math.round(w.x + (k % cols) * 290)); m.set("y", Math.round(w.y + Math.floor(k / cols) * 140)); m.set("w", 260); m.set("h", 110); m.set("color", ""); m.set("by", me.name); this.stampM(m); t.insert(0, ln); m.set("text", t); this.yn.set(id, m); ids.push(id); }); });
        this.feed("add", ids[0], ids.length + " карточек"); this.select(new Set(ids)); return ids;
      }
      addCard(x, y, text) {
        if (this.ro) return;
        const Y = window.__bsY.Y, c = this.worldPt(this.root.clientWidth / 2, this.root.clientHeight / 2), id = uid(), m = new Y.Map(), t = new Y.Text();
        this.doc.transact(() => { m.set("x", x == null ? c.x - 130 + (Math.random() - .5) * 80 : x); m.set("y", y == null ? c.y - 50 + (Math.random() - .5) * 80 : y); m.set("w", 260); m.set("h", 110); m.set("color", ""); m.set("by", me.name); this.stampM(m); t.insert(0, text || ""); m.set("text", t); this.yn.set(id, m); });
        this.feed("add", id, this.label(id));
        this.select(new Set([id])); setTimeout(() => this.edit(id), 30); return id;
      }
      addEdge(a, b, sa, sb, force) {
        if (this.ro) return;
        if (a === b) return; if (!force) for (const e of this.ye.values()) { if (e.get("a") === a && e.get("b") === b && (e.get("sa") || "") === (sa || "") && (e.get("sb") || "") === (sb || "")) return; if (e.get("a") === b && e.get("b") === a && (e.get("sa") || "") === (sb || "") && (e.get("sb") || "") === (sa || "")) return; }
        const Y = window.__bsY.Y, m = new Y.Map(); this.doc.transact(() => { m.set("a", a); m.set("b", b); m.set("label", ""); if (sa) m.set("sa", sa); if (sb) m.set("sb", sb); this.ye.set(uid(), m); });
        this.feed("link", null, "«" + this.label(a) + "» → «" + this.label(b) + "»");
      }
      removeSel() { if (this.ro) return; if (this.sel.size) for (const id of Array.from(this.sel)) { const m0 = this.yn.get(id); if (m0 && m0.get("locked")) this.sel.delete(id); } if (this.sel.size > 20) this.feed("del", null, this.sel.size + " карточек"); else for (const id of this.sel) this.feed("del", id, this.label(id)); if (this.selEdge) this.feed("unlink", null, ""); const del = this.sel; this.doc.transact(() => { for (const id of del) this.yn.delete(id); for (const [k, e] of Array.from(this.ye.entries())) if (del.has(e.get("a")) || del.has(e.get("b"))) this.ye.delete(k); if (this.selEdge) this.ye.delete(this.selEdge); }); this.sel = new Set(); this.selEdge = null; this.mark(); }
      setColor(col) { if (this.ro) return; this.doc.transact(() => { for (const id of this.sel) { const m = this.yn.get(id); if (m) { m.set("color", col); this.stampM(m); } } }); for (const id of this.sel) this.feed("color", id, this.label(id)); }
      // ---------- DOM sync ----------
      // ---------- DOM sync ----------
      // geo: every card's geometry as plain numbers (cheap to scan). els: DOM nodes only for cards near the view (a plain rectangle when
      // far or small, a full card when near and big enough). Yjs changes only mark ids dirty; one flush per frame applies them.
      initIdx() {
        this.geo = new Map(); this.mid = new WeakMap(); this.dirty = new Map(); this.fullDirty = true; this.eg = new Map(); this.emid = new WeakMap(); this.edirty = new Set(); this.efull = false; this.adj = new Map(); this.fm = new Map();
        this.flushRaf = 0; this.cullRaf = 0; this.fillRaf = 0; this._selVer = 0; this._dataVer = 0; this._flashQ = new Set(); this._cc = null; this.fillQ = []; this._markSel = new Set(); this._markEdge = null; this._slotC = null; this._bb = null; this._peerBy = new Map(); this.tsum = 0; this.inkBoxC = new WeakMap(); this.inkMirror = null; this.inkIds = null;
      }
      resetIdx() { for (const k of ["flushRaf", "cullRaf", "fillRaf"]) if (this[k]) cancelAnimationFrame(this[k]); for (const e of this.els.values()) e.el.remove(); for (const r of this.edgeEls.values()) r.g.remove(); this.els.clear(); this.edgeEls.clear(); this.initIdx(); }
      onNodes(evs) {
        const prov = this.sh ? this.sh.prov : this.prov, D = this.dirty;
        for (const ev of evs) {
          const t = ev.target, own = !!prov && ev.transaction.origin === prov;
          if (t === this.yn) { for (const k of ev.keysChanged) { const m = this.yn.get(k); if (m) this.mid.set(m, k); D.set(k, 7); if (own) this._flashQ.add(k); } continue; }
          let p = t, id; while (p && !(id = this.mid.get(p))) p = p.parent;
          if (!id) { this.fullDirty = true; continue; }
          let mask = 2; if (p === t) { mask = 0; for (const k of ev.keysChanged) mask |= k === "text" ? 2 : k === "fold" ? 5 : (k === "x" || k === "y" || k === "w" || k === "h") ? 1 : 4; if (!mask) mask = 4; }
          D.set(id, (D.get(id) || 0) | mask); if (own) this._flashQ.add(id);
        }
        this._dataVer++; this.scheduleFlush(); this.queueSave();
      }
      onEdges(evs) {
        for (const ev of evs) {
          const t = ev.target; if (t === this.ye) { for (const k of ev.keysChanged) { const m = this.ye.get(k); if (m) this.emid.set(m, k); this.edirty.add(k); } continue; }
          let p = t, id; while (p && !(id = this.emid.get(p))) p = p.parent; if (id) this.edirty.add(id); else this.efull = true;
        }
        this._dataVer++; this.scheduleFlush(); this.queueSave();
      }
      scheduleFlush() { if (!this.flushRaf) this.flushRaf = requestAnimationFrame(() => { this.flushRaf = 0; this.flush(); }); }
      sync() { this.fullDirty = true; this.flush(); }
      syncEdges() { this.efull = true; this.flush(); }
      fmSet(id, from, to) { if (from) { const s = this.fm.get(from); if (s) { s.delete(id); if (!s.size) this.fm.delete(from); } } if (to) { let s = this.fm.get(to); if (!s) this.fm.set(to, s = new Set()); s.add(id); } }
      flush() {
        if (this.flushRaf) { cancelAnimationFrame(this.flushRaf); this.flushRaf = 0; }
        if (!this.yn || !this.cards) return; const ro = this.ro; if (this.root) this.root.classList.toggle("is-ro", ro); if (this.feedEl) this.feedEl.style.display = ro ? "none" : "";
        if (this.fullDirty) { this.fullDirty = false; this.efull = true; for (const id of this.yn.keys()) this.dirty.set(id, 7); for (const id of this.geo.keys()) this.dirty.set(id, 7); }
        if (this.efull) { this.efull = false; for (const id of this.ye.keys()) this.edirty.add(id); for (const id of this.eg.keys()) this.edirty.add(id); }
        const moved = [], gone = [];
        for (const [id, mk] of this.dirty) {
          const m = this.yn.get(id); if (!m) { gone.push(id); continue; }
          this.mid.set(m, id); let g = this.geo.get(id), mask = mk; const isNew = !g;
          if (isNew) { g = { m, x: 0, y: 0, w: 0, h: 0, f: "", col: "", grp: false, tl: null }; this.geo.set(id, g); mask = 7; } else if (g.m !== m) { g.m = m; mask = 7; }
          if (mask & 1) { const x = m.get("x"), y = m.get("y"), w = m.get("w"), h = this.effH(m); if (isNew || x !== g.x || y !== g.y || w !== g.w || h !== g.h) { g.x = x; g.y = y; g.w = w; g.h = h; moved.push(id); } }
          if (mask & 2) { g.tl = null; const tt = m.get("text"), n = tt ? tt.length : 0; this.tsum += n - (g.n || 0); g.n = n; }
          if (mask & 4) { const f = m.get("frame") || ""; if (f !== g.f) { this.fmSet(id, g.f, f); g.f = f; } g.col = m.get("color") || ""; g.grp = !!m.get("group"); }
          const e = this.els.get(id); if (e) this.syncCard(id, m, e, mask);
        }
        this.dirty.clear();
        for (const id of gone) this.dropCard(id);
        if (moved.length || gone.length) {
          this._bb = null; this._slotC = null;
          // the ends of a link are spread along a side in the order of the cards at the other end, so those neighbours change too
          const hop = (cid) => { const s = this.adj.get(cid); if (s && s.size < 800) for (const eid of s) this.edirty.add(eid); };
          for (const id of moved) { const s = this.adj.get(id); if (!s) continue; for (const eid of s) { this.edirty.add(eid); if (s.size < 400) { const r = this.eg.get(eid); if (r) hop(r.a === id ? r.b : r.a); } } }
        }
        if (this.edirty.size) {
          this._slotC = null; this._sc = new Set(); for (const id of this.edirty) this.updEdge(id); this.edirty.clear();
          // links that share a side of a card are spread by count and order: when one comes, goes or changes, its neighbours on those cards are drawn again
          for (const card of this._sc) { const s = this.adj.get(card); if (s && s.size < 3000) for (const eid of s) { const r = this.eg.get(eid); if (r) r.dirty = true; } } this._sc = null;
        }
        this.cull(); this.cullInk && this.cullInk();
        if (this._flashQ.size) { const q = this._flashQ; this._flashQ = new Set(); this.flashMany(q); }
        this.mark(); this.renderMini(); if (this.emptyEl) this.emptyEl.classList.toggle("is-hidden", this.yn.size > 0);
      }
      dropCard(id) {
        const g = this.geo.get(id); if (g) { this.fmSet(id, g.f, ""); this.tsum -= g.n || 0; this.geo.delete(id); } const e = this.els.get(id); if (e) { e.el.remove(); this.els.delete(id); } this.sel.delete(id);
        const s = this.adj.get(id); if (s) for (const eid of s) { this.edirty.add(eid); const r = this.eg.get(eid); if (r) { const o = this.adj.get(r.a === id ? r.b : r.a); if (o && o.size < 800) for (const x of o) this.edirty.add(x); } }
      }
      // small boards with ordinary text are drawn in full as always; many cards or a lot of text switch culling on
      isAll() { return this.geo.size <= CULL_MIN && this.tsum < 150000; }
      keepEl(id, e) { const d = this.drag; if (d && ((d.o && d.o.has(id)) || d.id === id || d.from === id)) return true; return !e.lite && (e.el.classList.contains("is-editing") || e.el.contains(document.activeElement)); }
      ensureEl(id) { const g = this.geo.get(id); if (!g) return null; return this.els.get(id) || this.mkLite(id, g); }
      upgrade(id, e) { if (!e || !e.lite) return e; const m = this.yn.get(id); if (!m) return e; this.fillCard(id, e); this.syncCard(id, m, e, 7); this.decor(id, e); return e; }
      // which cards and links have DOM nodes: the ones near the view (a margin around it keeps panning smooth)
      cull() {
        if (!this.root || !this.yn || !this.cards) return; const W = this.root.clientWidth, H = this.root.clientHeight, c = this.cam, k = c.k; if (!(W > 0 && H > 0 && k > 0)) return;
        this._cc = { x: c.x, y: c.y, k, W, H };
        const all = this.isAll(), lod = !all && k < LOD_K, vw = W / k, vh = H / k;
        const ix1 = c.x - vw * 0.75, ix2 = c.x + vw * 0.75, iy1 = c.y - vh * 0.75, iy2 = c.y + vh * 0.75, ox1 = c.x - vw * 1.4, ox2 = c.x + vw * 1.4, oy1 = c.y - vh * 1.4, oy2 = c.y + vh * 1.4;
        const fill = [], far = [], evict = this.els.size > LITE_CAP;
        for (const [id, g] of this.geo) {
          const x2 = g.x + g.w, y2 = g.y + g.h; let e = this.els.get(id);
          if (!all && (x2 < ox1 || g.x > ox2 || y2 < oy1 || g.y > oy2)) { if (e) { if (!e.lite) { if (!this.keepEl(id, e)) this.toLite(id, e); } else if (evict && !this.keepEl(id, e)) { const dx = g.x - c.x, dy = g.y - c.y; far.push([dx * dx + dy * dy, id]); } } continue; }
          if (!e) e = this.mkLite(id, g);
          if (all) { if (e.lite) fill.push(id); continue; }
          if (lod) { if (!e.lite && !this.keepEl(id, e)) this.toLite(id, e); continue; }
          if (e.lite && x2 >= ix1 && g.x <= ix2 && y2 >= iy1 && g.y <= iy2) { const dx = g.x + g.w / 2 - c.x, dy = g.y + g.h / 2 - c.y; fill.push([dx * dx + dy * dy, id]); }
        }
        if (far.length) { far.sort((a, b) => b[0] - a[0]); const drop = this.els.size - Math.floor(LITE_CAP * 0.8); for (let i = 0; i < drop && i < far.length; i++) { const e = this.els.get(far[i][1]); if (e) { e.el.remove(); this.els.delete(far[i][1]); } } }
        if (all) { for (const id of fill) { const e = this.els.get(id); if (e) this.upgrade(id, e); } this.fillQ = []; }
        else { fill.sort((a, b) => b[0] - a[0]); this.fillQ = fill.map((q) => q[1]); if (this.fillQ.length) this.pumpFill(); }
        for (const [id, r] of this.eg) {
          let bb = r.bb; if (bb === null) bb = this.ebb(r); let el = this.edgeEls.get(id);
          if (!bb || (!all && (bb[2] < ox1 || bb[0] > ox2 || bb[3] < oy1 || bb[1] > oy2))) { if (el && this.selEdge !== id && (!bb || this.edgeEls.size > EDGE_CAP)) { el.g.remove(); this.edgeEls.delete(id); } if (!bb) r.dirty = true; continue; }
          if (!el) { el = this.mkEdgeEl(id, lod); r.dirty = true; } else if (el.lite !== lod) { if (lod) this.edgeLite(el); else this.edgeFull(el, id); r.dirty = true; }
          if (r.dirty) { r.dirty = false; this.drawEdge(id, r, el); }
        }
      }
      // back to a bare rectangle: same node, children dropped (cheaper than removing and creating a node)
      toLite(id, e) { const el = e.el; el.textContent = ""; el.classList.remove("is-editing", "has-img", "has-peer"); el.classList.add("is-lite"); for (const k of ["ta", "tag", "by", "kindEl", "mdEl", "img", "mdOk", "mdTxt", "mdFull"]) e[k] = undefined; e.lite = true; this.decor(id, e); }
      // cards near the view become full cards a few at a time, nearest first
      pumpFill() {
        if (this.fillRaf) return; const run = () => {
          this.fillRaf = 0; const t0 = performance.now(), q = this.fillQ; let n = 0;
          while (q.length && (n < 2 || performance.now() - t0 < 10)) { if (this.cam.k < LOD_K && !this.isAll()) { q.length = 0; break; } const id = q.pop(), e = this.els.get(id); if (e && e.lite) { this.upgrade(id, e); n++; } }
          if (q.length) this.fillRaf = requestAnimationFrame(run);
        }; run();
      }
      scheduleCull(force) {
        if (!this.root || !this.yn) return; const c = this.cam, W = this.root.clientWidth, H = this.root.clientHeight, o = this._cc;
        if (!force && o && W === o.W && H === o.H && Math.abs(c.k - o.k) < o.k * 0.02 && Math.abs(c.x - o.x) * c.k < W * 0.06 && Math.abs(c.y - o.y) * c.k < H * 0.06) return;
        if (this.cullRaf) return; this.cullRaf = requestAnimationFrame(() => { this.cullRaf = 0; this.cull(); this.cullInk && this.cullInk(); });
      }
      mkLite(id, g) {
        const el = document.createElement("div"); el.className = "osb-card is-lite" + (this.isAll() ? "" : " no-pop"); el.dataset.id = id; this.cards.appendChild(el);
        const rec = { el, lite: true }; this.els.set(id, rec); this.syncCard(id, g.m, rec, 7); this.decor(id, rec); return rec;
      }
      // marks that depend on state outside the card: selection, search hits, focus mode, other people
      decor(id, e) {
        const cl = e.el.classList; if (this.sel.has(id)) cl.add("is-sel"); if (this._hitSet && this._hitSet.has(id)) { cl.add("is-hit"); if (this._curHit === id) cl.add("is-cur"); } if (this._fo) { cl.toggle("is-dim", !this._fo.ids.has(id)); if (this._fo.path) cl.toggle("is-path", this._fo.ids.has(id)); }
        const u = this._peerBy.get(id); if (u) this.decoPeer(e, u, id);
      }
      decoPeer(e, u, id) { e.el.style.setProperty("--peer", u.color); e.el.classList.add("has-peer"); if (!e.lite) { e.tag.textContent = u.name + (u.typing === id ? " печатает…" : ""); e.tag.style.background = u.color; } }
      syncCard(id, m, e, mask) {
        const g = this.geo.get(id), s = e.el.style; if (!g) return;
        if (mask & 1) { if (e.gx !== g.x) { s.left = g.x + "px"; e.gx = g.x; } if (e.gy !== g.y) { s.top = g.y + "px"; e.gy = g.y; } if (e.gw !== g.w) { s.width = g.w + "px"; e.gw = g.w; } const h = m.get("h"); if (e.gh !== h) { s.height = h + "px"; e.gh = h; } }
        if (mask & 4) {
          const locked = !!m.get("locked"), cl = e.el.classList; cl.toggle("is-locked", locked); cl.toggle("is-group", g.grp); cl.toggle("is-fold", !!m.get("fold")); const col = g.col; if (e.gc !== col) { e.gc = col; s.setProperty("--card", col || "var(--background-modifier-border)"); cl.toggle("has-color", !!col); }
          if (!e.lite) {
            e.ta.readOnly = this.ro || locked;
            const lb = m.get("lastBy") || m.get("by"), la = m.get("lastAt"); const shortN = (n) => (n.length > 14 ? n.slice(0, 13) + "…" : n); const bt = lb ? shortN(lb) + (la ? " · " + new Date(la).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "") : ""; if (e.by.textContent !== bt) e.by.textContent = bt; e.by.style.setProperty("--c", m.get("lastColor") || "var(--text-faint)"); e.by.title = (m.get("by") ? "Создал: " + m.get("by") + "\n" : "") + (lb ? "Последним менял: " + lb : "");
            { const kd = m.get("kind") || "", kc = kd ? ((this.typesList().find((q) => q.n === kd) || {}).c || "") : ""; if (e.kindEl.textContent !== kd) e.kindEl.textContent = kd; e.kindEl.classList.toggle("is-empty", !kd); e.kindEl.title = kd || "Тип карточки или свой подзаголовок"; e.kindEl.style.background = kd ? (kc || "var(--background-modifier-border-hover)") : ""; }
            if (g.grp) e.ta.placeholder = "Название рамки";
            { const im = m.get("img") || ""; if (im && !e.img) { e.img = document.createElement("img"); e.img.className = "osb-img"; e.img.draggable = false; e.img.decoding = "async"; e.el.insertBefore(e.img, e.ta); } if (e.img) { if (!im) { e.img.remove(); e.img = null; } else if (e.img.dataset.s !== String(im.length)) { e.img.src = im; e.img.dataset.s = String(im.length); } } cl.toggle("has-img", !!im); }
          }
        }
        if (!e.lite && (mask & 2)) { this.renderMd(id); const txt = m.get("text").toString(); if (e.ta.value !== txt) { const f = document.activeElement === e.ta, p = e.ta.selectionStart; e.ta.value = txt; if (f) { try { e.ta.setSelectionRange(Math.min(p, txt.length), Math.min(p, txt.length)); } catch (er) { /* ok */ } } } }
      }
      fillCard(id, rec) {
        const el = rec.el, M = () => this.yn.get(id);
        const grip = el.createDiv({ cls: "osb-grip" }); const kindEl = grip.createSpan({ cls: "osb-kind", attr: { title: "Тип карточки или свой подзаголовок" } }); kindEl.addEventListener("pointerdown", (ev) => ev.stopPropagation()); kindEl.addEventListener("click", (ev) => { ev.stopPropagation(); if (!this.ro) this.kindMenu(ev, id); }); const tag = grip.createSpan({ cls: "osb-tag" }); const by = grip.createSpan({ cls: "osb-by" }); const x = grip.createDiv({ cls: "osb-x", attr: { title: "Удалить" } }); api.setIcon(x, "lucide-x");
        x.onclick = (ev) => { ev.stopPropagation(); this.select(new Set([id])); this.removeSel(); };
        const ta = el.createEl("textarea", { cls: "osb-ta", attr: { placeholder: "Текст…", spellcheck: "false", maxlength: "20000" } }); const mdEl = el.createDiv({ cls: "osb-md markdown-rendered" });
        for (const side of ["t", "r", "b", "l"]) { const h = el.createDiv({ cls: "osb-h osb-h-" + side }); h.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); if (this.ro) return; this.drag = { kind: "link", from: id, side }; this.root.classList.add("is-linking"); this.root.setPointerCapture(ev.pointerId); }); }
        for (const dir of ["n", "s", "e", "w", "nw", "ne", "sw", "se"]) { const z = el.createDiv({ cls: "osb-rz osb-rz-" + dir }); z.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); if (this.ro || M().get("locked")) return; const mm = this.yn.get(id), q = this.pt(ev); this.drag = { kind: "size", id, dir, x: mm.get("x"), y: mm.get("y"), w: mm.get("w"), h: mm.get("h"), p: this.worldPt(q.sx, q.sy) }; this.root.setPointerCapture(ev.pointerId); }); }
        const startMove = (ev) => this.startMove(ev, id);
        grip.addEventListener("pointerdown", (ev) => { if (M().get("group")) { const now = performance.now(); if (this._lastMd && this._lastMd.id === id && now - this._lastMd.t < 380 && !this.ro) { this._lastMd = null; ev.preventDefault(); ev.stopPropagation(); setTimeout(() => this.edit(id), 0); return; } this._lastMd = { id, t: now }; } startMove(ev); });
        mdEl.addEventListener("pointerdown", (ev) => { if (ev.target.closest("a, input")) return; const now = performance.now(); if (this._lastMd && this._lastMd.id === id && now - this._lastMd.t < 380 && !this.ro && !M().get("locked")) { this._lastMd = { id, t: now - 10000 }; this._noNew = now; ev.preventDefault(); ev.stopPropagation(); setTimeout(() => this.edit(id), 0); return; } this._lastMd = { id, t: now }; startMove(ev); });
        mdEl.addEventListener("dblclick", (ev) => { if (this.ro || M().get("locked") || ev.target.closest("a, input")) return; ev.stopPropagation(); this.edit(id); });
        mdEl.addEventListener("click", (ev) => {
          const a = ev.target.closest("a.internal-link"); if (a) { ev.preventDefault(); ev.stopPropagation(); try { app.workspace.openLinkText(a.getAttribute("data-href") || a.getAttribute("href") || "", this.path || "", ev.ctrlKey || ev.metaKey); } catch (er) { /* missing */ } return; }
          const cb = ev.target.closest("input[type=checkbox]"); if (cb) { if (this.ro || M().get("locked")) { ev.preventDefault(); return; } const boxes = Array.from(mdEl.querySelectorAll("input[type=checkbox]")), k = boxes.indexOf(cb); let n = -1; const txt = M().get("text").toString().replace(/^(\s*[-*+]\s+)\[( |x|X)\]/gm, (all, pre, st) => { n++; return n === k ? pre + "[" + (st === " " ? "x" : " ") + "]" : all; }); this.doc.transact(() => { const yt = M().get("text"); yt.delete(0, yt.length); yt.insert(0, txt); this.stampM(M()); }); }
        });
        ta.addEventListener("focus", () => { el.classList.add("is-editing"); this.contentEl.classList.add("is-writing"); this.pushKeys(); this.mkFmt(id); this.select(new Set([id])); this.publish({ typing: id }); });
        ta.addEventListener("blur", () => { el.classList.remove("is-editing"); this.contentEl.classList.remove("is-writing"); this.popKeys(); this.renderMd(id); this.publish({ typing: null }); });
        ta.addEventListener("keydown", (ev) => this.fmtKey(ev, ta, id));
        ta.addEventListener("input", () => { if (M().get("locked")) { ta.value = M().get("text").toString(); return; } const t = M().get("text"), old = t.toString(), now = ta.value; let a = 0; while (a < old.length && a < now.length && old[a] === now[a]) a++; let b = 0; while (b < old.length - a && b < now.length - a && old[old.length - 1 - b] === now[now.length - 1 - b]) b++; this.doc.transact(() => { if (old.length - a - b) t.delete(a, old.length - a - b); if (now.length - a - b) t.insert(a, now.slice(a, now.length - b)); this.stampM(M()); }); this.feed("edit", id, this.label(id)); });
        el.addEventListener("pointerdown", (ev) => { if ((!ev.ctrlKey && !ev.shiftKey && !ev.metaKey) || ev.button !== 0 || this.draw || this.ro || ev.target.closest(".osb-h, .osb-rz, .osb-x, .osb-nb, .osb-kind, .osb-note")) return; if (ev.target.closest(".osb-grip")) return; ev.preventDefault(); ev.stopPropagation(); const n2 = new Set(this.sel); n2.has(id) ? n2.delete(id) : n2.add(id); this.select(n2); this.contentEl.focus(); }, true);
        Object.assign(rec, { ta, tag, by, kindEl, mdEl, lite: false }); el.classList.remove("is-lite"); return rec;
      }
      mkCard(id, m) { return this.upgrade(id, this.ensureEl(id) || this.mkLite(id, this.geo.get(id) || { m, x: 0, y: 0, w: 0, h: 0, col: "", grp: false })); }
      startMove(ev, id) { if (ev.target.closest(".osb-x, .osb-kind") || ev.button !== 0 || this.ro) return; if (ev.shiftKey || ev.ctrlKey) { const n2 = new Set(this.sel); n2.has(id) ? n2.delete(id) : n2.add(id); this.select(n2); if (!n2.has(id)) return; } else if (!this.sel.has(id)) this.select(new Set([id])); const o = new Map(); for (const s of this.sel) { const n = this.yn.get(s); if (n && !n.get("locked")) o.set(s, [n.get("x"), n.get("y")]); } for (const s of Array.from(o.keys())) { const gm = this.yn.get(s); if (gm && gm.get("group")) { let mem = []; this.flush(); for (const i2 of (this.fm.get(s) || [])) { const m2 = this.yn.get(i2); if (m2 && !o.has(i2) && !m2.get("locked")) mem.push([i2, m2]); }
            if (!mem.length) { const gx = gm.get("x"), gy = gm.get("y"), gw = gm.get("w"), gh = gm.get("h"); for (const [i2, m2] of this.yn.entries()) { if (o.has(i2) || m2.get("group") || m2.get("locked")) continue; const cx = m2.get("x") + m2.get("w") / 2, cy = m2.get("y") + m2.get("h") / 2; if (cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh) mem.push([i2, m2]); } if (mem.length) this.doc.transact(() => { for (const [, m2] of mem) m2.set("frame", s); }); }
            for (const [i2, m2] of mem) o.set(i2, [m2.get("x"), m2.get("y")]); } } if (!o.size) return; const p = this.pt(ev); this.drag = { kind: "move", o, p: this.worldPt(p.sx, p.sy) }; this.root.setPointerCapture(ev.pointerId); }
      effH(m) { return m.get("fold") ? 52 : m.get("h"); }
      anchor(id, toward) { const m = this.yn.get(id); if (!m) return null; const x = m.get("x"), y = m.get("y"), w = m.get("w"), h = this.effH(m), cx = x + w / 2, cy = y + h / 2, dx = toward.x - cx, dy = toward.y - cy; if (!dx && !dy) return { x: cx, y: cy }; const k = Math.min(dx ? (w / 2) / Math.abs(dx) : 1e9, dy ? (h / 2) / Math.abs(dy) : 1e9); return { x: cx + dx * k, y: cy + dy * k }; }
      cutMove(d, p, w) {
        const dist = Math.hypot(p.sx - d.p0.sx, p.sy - d.p0.sy), r = this.edgeEls.get(d.id); if (!r) return; if (dist < 8) return; d.far = dist >= 56; const NS = "http://www.w3.org/2000/svg";
        if (!this.cutEl) { this.cutEl = document.createElementNS(NS, "path"); this.cutEl.setAttribute("class", "osb-cut"); this.svg.appendChild(this.cutEl); } r.g.style.opacity = ".25";
        const [x1, y1, x2, y2] = r.pq || [0, 0, 0, 0]; this.cutEl.setAttribute("d", "M" + x1 + " " + y1 + " Q" + w.x + " " + w.y + " " + x2 + " " + y2); this.cutEl.classList.toggle("is-far", d.far);
      }
      cutEnd(d) { if (this.cutEl) { this.cutEl.remove(); this.cutEl = null; } const r = this.edgeEls.get(d.id); if (r) r.g.style.opacity = ""; if (d.far) this.removeEdge(d.id); }
      setEdge(id, patch) { const m = this.ye.get(id); if (!m || this.ro) return; this.doc.transact(() => { for (const k of Object.keys(patch)) { if (patch[k]) m.set(k, patch[k]); else m.delete(k); } }); this.syncEdges(); }
      styleLinksOf(ids, patch) { const set = new Set(ids); this.doc.transact(() => { for (const e of this.ye.values()) if (set.has(e.get("a")) || set.has(e.get("b"))) for (const k of Object.keys(patch)) { if (patch[k]) e.set(k, patch[k]); else e.delete(k); } }); this.syncEdges(); }
      flipEdge(id) { const m = this.ye.get(id); if (!m || this.ro) return; this.doc.transact(() => { const a = m.get("a"), b = m.get("b"), sa = m.get("sa"), sb = m.get("sb"); m.set("a", b); m.set("b", a); if (sb) m.set("sa", sb); else m.delete("sa"); if (sa) m.set("sb", sa); else m.delete("sb"); }); this.syncEdges(); }
      edit(id) { if (this.draw) return; this.flush(); const m = this.yn.get(id); if (!m || this.ro || m.get("locked")) return; let e = this.ensureEl(id); if (!e) return; if (e.lite) e = this.upgrade(id, e); e.el.classList.add("is-editing"); e.ta.focus(); }
      renderMd(id) {
        const e = this.els.get(id), m = this.yn.get(id); if (!e || e.lite || !m || e.el.classList.contains("is-editing")) return; const txt = m.get("text").toString(); if (e.mdOk && e.mdTxt === txt) return; e.mdTxt = txt; e.mdOk = true; e.mdEl.empty();
        if (!txt.trim()) { const bf = m.get("file"); e.mdEl.createDiv({ cls: "osb-md-empty", text: bf && /\.board$/i.test(bf) ? "Двойной щелчок — открыть доску" : "Двойной щелчок — писать" }); return; }
        let src = txt, cutAt = 0; if (!e.mdFull && txt.length > MD_CAP) { cutAt = txt.lastIndexOf("\n\n", MD_CAP); if (cutAt < MD_CAP * 0.5) cutAt = MD_CAP; src = txt.slice(0, cutAt); }
        try { const R = api.MarkdownRenderer; if (R && R.renderMarkdown) R.renderMarkdown(src, e.mdEl, this.path || "", this); else e.mdEl.setText(src); } catch (er) { e.mdEl.setText(src); }
        if (cutAt) { const more = e.mdEl.createDiv({ cls: "osb-md-more", text: "Показать всё (ещё " + (txt.length - cutAt) + " симв.)" }); more.addEventListener("pointerdown", (ev) => ev.stopPropagation()); more.onclick = (ev) => { ev.stopPropagation(); e.mdFull = true; e.mdOk = false; this.renderMd(id); }; }
      }
      refitFrames(ids) {
        const fids = new Set(); for (const id of ids) { const m = this.yn.get(id), f = m && m.get("frame"); if (f && this.yn.get(f)) fids.add(f); } if (!fids.size) return;
        this.flush(); const mem = new Map(); for (const f of fids) { const s = this.fm.get(f); if (!s) continue; const l = []; for (const i of s) { const m = this.yn.get(i); if (m) l.push(m); } if (l.length) mem.set(f, l); }
        this.doc.transact(() => { for (const [f, ms] of mem) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const m of ms) { a = Math.min(a, m.get("x")); b = Math.min(b, m.get("y")); c = Math.max(c, m.get("x") + m.get("w")); d = Math.max(d, m.get("y") + this.effH(m)); } const g = this.yn.get(f), x = Math.round(a - 28), y = Math.round(b - 56), w = Math.round(c - a + 56), h = Math.round(d - b + 84); if (g.get("x") !== x) g.set("x", x); if (g.get("y") !== y) g.set("y", y); if (g.get("w") !== w) g.set("w", w); if (g.get("h") !== h) g.set("h", h); } });
      }
      joinFrames(ids) {
        const groups = []; for (const [id, m] of this.yn.entries()) if (m.get("group")) groups.push([id, m]); if (!groups.length) return; const joined = [];
        this.doc.transact(() => { for (const id of ids) { const m = this.yn.get(id); if (!m || m.get("group") || m.get("frame")) continue; const cx = m.get("x") + m.get("w") / 2, cy = m.get("y") + this.effH(m) / 2; for (let k = groups.length - 1; k >= 0; k--) { const [gid, g] = groups[k], gx = g.get("x"), gy = g.get("y"); if (cx >= gx && cx <= gx + g.get("w") && cy >= gy && cy <= gy + g.get("h")) { m.set("frame", gid); joined.push(id); break; } } } });
        if (joined.length) this.refitFrames(joined);
      }
      // ---------- writing in a card: formatting like in a notes editor ----------
      fmtPut(ta, a, b, text, selA, selB) { ta.focus(); ta.setSelectionRange(a, b); document.execCommand("insertText", false, text); if (selA != null) ta.setSelectionRange(selA, selB == null ? selA : selB); }
      fmtWrap(ta, L, R, ph) {
        const v = ta.value, s0 = ta.selectionStart, e0 = ta.selectionEnd, sel = v.slice(s0, e0);
        if (sel && v.slice(s0 - L.length, s0) === L && v.slice(e0, e0 + R.length) === R) { this.fmtPut(ta, s0 - L.length, e0 + R.length, sel, s0 - L.length, s0 - L.length + sel.length); return; }
        const t = sel || ph; this.fmtPut(ta, s0, e0, L + t + R, s0 + L.length, s0 + L.length + t.length);
      }
      fmtLines(ta, fn) { const v = ta.value, s0 = ta.selectionStart, e0 = ta.selectionEnd, a = v.lastIndexOf("\n", s0 - 1) + 1; let b = v.indexOf("\n", e0); if (b < 0) b = v.length; const out = fn(v.slice(a, b).split("\n")).join("\n"); this.fmtPut(ta, a, b, out, a, a + out.length); }
      fmtKind(ta, k) {
        const strip = (l) => l.replace(/^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/, "$1");
        if (k === "bold") return this.fmtWrap(ta, "**", "**", "жирный"); if (k === "italic") return this.fmtWrap(ta, "*", "*", "курсив"); if (k === "strike") return this.fmtWrap(ta, "~~", "~~", "зачёркнуто"); if (k === "code") return this.fmtWrap(ta, "`", "`", "код"); if (k === "link") return this.fmtWrap(ta, "[[", "]]", "заметка");
        const lineEnd = () => { const b = ta.value.indexOf("\n", ta.selectionEnd); return b < 0 ? ta.value.length : b; };
        if (k === "hr") { const b = lineEnd(); return this.fmtPut(ta, b, b, "\n\n---\n", b + 7); }
        if (k === "table") { const b = lineEnd(), t = "\n\n| Колонка 1 | Колонка 2 |\n| --- | --- |\n| ячейка | ячейка |\n"; return this.fmtPut(ta, b, b, t, b + 4, b + 13); }
        if (k === "hl") return this.fmtWrap(ta, "==", "==", "выделение");
        if (k === "url") { const s0 = ta.selectionStart, e0 = ta.selectionEnd, t = ta.value.slice(s0, e0) || "текст", out = "[" + t + "](https://)"; return this.fmtPut(ta, s0, e0, out, s0 + t.length + 3, s0 + t.length + 11); }
        if (k === "callout") return this.fmtLines(ta, (ls) => ["> [!note] Заметка"].concat(ls.map((l) => "> " + l)));
        if (/^h[1-3]$/.test(k)) { const n = +k[1]; return this.fmtLines(ta, (ls) => ls.map((l) => { const m = /^(#{1,6})\s+/.exec(l); return m && m[1].length === n ? l.replace(/^#{1,6}\s+/, "") : "#".repeat(n) + " " + l.replace(/^#{1,6}\s+/, ""); })); }
        if (k === "h0") return this.fmtLines(ta, (ls) => ls.map((l) => l.replace(/^#{1,6}\s+/, "")));
        if (k === "heading") return this.fmtLines(ta, (ls) => ls.map((l) => { const m = /^(#{1,6})\s/.exec(l), n = m ? m[1].length : 0; return n >= 3 ? l.replace(/^#{1,6}\s+/, "") : (n ? "#".repeat(n + 1) + l.slice(n) : "# " + l); }));
        const pre = { quote: "> ", ul: "- ", task: "- [ ] " }[k];
        if (k === "ol") return this.fmtLines(ta, (ls) => { const on = ls.every((l) => /^\s*\d+[.)]\s/.test(l)); return ls.map((l, i) => (on ? strip(l) : (i + 1) + ". " + strip(l))); });
        if (pre) return this.fmtLines(ta, (ls) => { const on = ls.every((l) => l.startsWith(pre)); return ls.map((l) => (on ? l.slice(pre.length) : pre + strip(l))); });
      }
      fmtKey(ev, ta, id) {
        const mod = ev.ctrlKey || ev.metaKey, k = /^Key[A-Z]$/.test(ev.code) ? ev.code.slice(3).toLowerCase() : ev.key.toLowerCase();
        if (ev.key === "Escape") { ev.preventDefault(); ta.blur(); this.contentEl.focus(); this.select(new Set([id])); return; }
        const kind = mod && !ev.altKey ? (k === "b" ? "bold" : k === "i" ? "italic" : k === "e" ? "code" : k === "k" ? "link" : ev.shiftKey && k === "x" ? "strike" : "") : ""; if (kind) { ev.preventDefault(); this.fmtKind(ta, kind); return; }
        if (ev.key === "Tab" && !mod && !ev.altKey) { ev.preventDefault(); const v = ta.value, s0 = ta.selectionStart, e0 = ta.selectionEnd, multi = v.slice(s0, e0).includes("\n"), ln = v.slice(v.lastIndexOf("\n", s0 - 1) + 1, s0), inList = /^\s*([-*+]|\d+[.)])\s/.test(v.slice(v.lastIndexOf("\n", s0 - 1) + 1, (v.indexOf("\n", s0) < 0 ? v.length : v.indexOf("\n", s0))));
          const len0 = v.length; if (ev.shiftKey) this.fmtLines(ta, (ls) => ls.map((l) => l.replace(/^( {1,2}|\t)/, ""))); else if (multi || inList) this.fmtLines(ta, (ls) => ls.map((l) => "  " + l)); else this.fmtPut(ta, s0, e0, "  "); if (!multi) { const d = ta.value.length - len0; ta.setSelectionRange(Math.max(0, s0 + d), Math.max(0, e0 + d)); } void ln; return; }
        if (ev.key === "Enter" && !mod && !ev.shiftKey && !ev.altKey) {
          const v = ta.value, s0 = ta.selectionStart; if (s0 !== ta.selectionEnd) return; const a = v.lastIndexOf("\n", s0 - 1) + 1, line = v.slice(a, s0), m = /^(\s*)([-*+]|(\d+)[.)])\s+(\[[ xX]\]\s+)?(.*)$/.exec(line); if (!m) return; ev.preventDefault();
          if (!m[5].trim()) { this.fmtPut(ta, a, s0, "", a); return; }
          const mk = m[3] ? (parseInt(m[3], 10) + 1) + ". " : m[2] + " "; this.fmtPut(ta, s0, s0, "\n" + m[1] + mk + (m[4] ? "[ ] " : "")); return;
        }
      }
      mkFmt(id) {
        const e = this.els.get(id); if (!e || e.fmt) return; const bar = e.fmt = e.el.createDiv({ cls: "osb-fmt" }); bar.addEventListener("mousedown", (ev) => ev.preventDefault()); bar.addEventListener("pointerdown", (ev) => ev.stopPropagation());
        const B = [["heading", "lucide-heading", "Заголовок"], ["bold", "lucide-bold", "Жирный (Ctrl+B)"], ["italic", "lucide-italic", "Курсив (Ctrl+I)"], ["strike", "lucide-strikethrough", "Зачёркнутый (Ctrl+Shift+X)"], ["hl", "lucide-highlighter", "Выделение маркером (Ctrl+Shift+H)"], ["code", "lucide-code", "Код (Ctrl+E)"], ["|"], ["quote", "lucide-quote", "Цитата (Ctrl+Shift+9)"], ["ul", "lucide-list", "Список (Ctrl+Shift+8)"], ["ol", "lucide-list-ordered", "Нумерованный список (Ctrl+Shift+7)"], ["task", "lucide-list-checks", "Список задач"], ["callout", "lucide-message-square-warning", "Выноска"], ["|"], ["link", "lucide-link", "Ссылка на заметку (Ctrl+K)"], ["url", "lucide-globe", "Ссылка на сайт"], ["table", "lucide-table", "Таблица"], ["hr", "lucide-separator-horizontal", "Разделитель"]];
        for (const b of B) { if (b[0] === "|") { bar.createDiv({ cls: "osb-fsep" }); continue; } const x = bar.createDiv({ cls: "osb-fb", attr: { title: b[2], "aria-label": b[2] } }); api.setIcon(x, b[1]); x.onclick = (ev) => { ev.stopPropagation(); if (b[0] === "heading") { const mn = new api.Menu(); for (const [k, t] of [["h1", "Заголовок 1"], ["h2", "Заголовок 2"], ["h3", "Заголовок 3"], ["h0", "Обычный текст"]]) mn.addItem((it) => it.setTitle(t).onClick(() => { this.edit(id); this.fmtKind(e.ta, k); })); mn.showAtMouseEvent(ev); return; } this.fmtKind(e.ta, b[0]); }; }
      }
      keysScope() {
        if (this._ks) return this._ks; const SC = app.scope && app.scope.constructor; if (!SC) return null; const sc = new SC(app.scope);
        for (const [key, kind, shift] of [["b", "bold"], ["i", "italic"], ["e", "code"], ["k", "link"], ["x", "strike", true], ["h", "hl", true], ["7", "ol", true], ["8", "ul", true], ["9", "quote", true]]) sc.register(shift ? ["Mod", "Shift"] : ["Mod"], key, (ev) => { const ta = document.activeElement; if (!ta || !ta.classList || !ta.classList.contains("osb-ta")) return true; ev.preventDefault(); this.fmtKind(ta, kind); return false; });
        return (this._ks = sc);
      }
      pushKeys() { const sc = this.keysScope(); if (sc && !this._kp && app.keymap) { app.keymap.pushScope(sc); this._kp = true; } }
      popKeys() { if (this._kp && app.keymap) { app.keymap.popScope(this._ks); this._kp = false; } }
      groupSel() {
        const ids = Array.from(this.sel).filter((i) => this.yn.get(i) && !this.yn.get(i).get("group")); if (!ids.length || this.ro) return; const bb = this.bounds(ids); if (!bb) return; this.um && this.um.stopCapturing();
        const id = this.addCard(bb.x - 28, bb.y - 56, "Рамка"), m = this.yn.get(id); this.doc.transact(() => { m.set("group", true); m.set("w", Math.round(bb.w + 56)); m.set("h", Math.round(bb.h + 84)); for (const i2 of ids) { const mm = this.yn.get(i2); if (mm) mm.set("frame", id); } }); this.um && this.um.stopCapturing(); const e = this.els.get(id); if (e) { this.edit(id); e.ta.select(); }
      }
      removeEdge(id) { const m = this.ye.get(id); if (!m) return; this.feed("unlink", null, ""); this.doc.transact(() => { this.ye.delete(id); }); this.selEdge = null; this.syncEdges(); }
      splitEdge(id) {
        const m = this.ye.get(id); if (!m) return; const a = m.get("a"), b = m.get("b"), sa = m.get("sa") || "", sb = m.get("sb") || "", A = this.center(a), B = this.center(b); if (!A || !B) return; this.um && this.um.stopCapturing();
        const nid = this.addCard((A.x + B.x) / 2 - 130, (A.y + B.y) / 2 - 30); this.doc.transact(() => { this.ye.delete(id); }); this.addEdge(a, nid, sa, ""); this.addEdge(nid, b, "", sb); this.um && this.um.stopCapturing(); this.selEdge = null;
      }
      branchEdge(id) {
        const m = this.ye.get(id); if (!m) return; const a = m.get("a"), b = m.get("b"), A = this.center(a), B = this.center(b); if (!A || !B) return; const dx = B.x - A.x, dy = B.y - A.y, l = Math.hypot(dx, dy) || 1, mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, nx = -dy / l, ny = dx / l, side = (nx * (this.myCur ? this.myCur.x - mx : 1) + ny * (this.myCur ? this.myCur.y - my : 1)) >= 0 ? 1 : -1; this.um && this.um.stopCapturing();
        const nid = this.addCard(mx + nx * side * 220 - 130, my + ny * side * 220 - 30); this.addEdge(a, nid, m.get("sa") || "", ""); this.um && this.um.stopCapturing();
      }
      anchorSide(id, side, slot) { const m = this.yn.get(id); if (!m) return null; const x = m.get("x"), y = m.get("y"), w = m.get("w"), h = this.effH(m), f = slot ? (slot[0] + 1) / (slot[1] + 1) : 0.5; return side === "t" ? { x: x + w * f, y } : side === "b" ? { x: x + w * f, y: y + h } : side === "l" ? { x, y: y + h * f } : { x: x + w, y: y + h * f }; }
      nearSide(id, pt) { const m = this.yn.get(id); if (!m) return "l"; const w = m.get("w"), h = this.effH(m), dx = (pt.x - (m.get("x") + w / 2)) / w, dy = (pt.y - (m.get("y") + h / 2)) / h; return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "r" : "l") : (dy > 0 ? "b" : "t"); }
      portDot(key, p) { const NS = "http://www.w3.org/2000/svg"; let c = this["_pd" + key]; if (!c) { c = this["_pd" + key] = document.createElementNS(NS, "circle"); c.setAttribute("class", "osb-port"); c.setAttribute("r", 6); this.svg.appendChild(c); } c.setAttribute("cx", p.x); c.setAttribute("cy", p.y); }
      clearPorts() { for (const k of ["a", "b"]) { const c = this["_pd" + k]; if (c) { c.remove(); this["_pd" + k] = null; } } if (this.lt) { const o = this.els.get(this.lt); if (o) { o.el.classList.remove("is-linktgt"); for (const h of o.el.querySelectorAll(".osb-h")) h.classList.remove("is-port"); } this.lt = null; } this.root.classList.remove("is-linking"); if (this._near) { for (const id of this._near) { const o = this.els.get(id); if (o) o.el.classList.remove("is-near"); } this._near = null; } }
      center(id) { const m = this.yn.get(id); return m ? { x: m.get("x") + m.get("w") / 2, y: m.get("y") + this.effH(m) / 2 } : null; }
      dirSide(p, q) { const dx = q.x - p.x, dy = q.y - p.y; return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "r" : "l") : (dy > 0 ? "b" : "t"); }
      edgePath(p, q, sh, sa, sb) {
        if (sh !== "straight" && sh !== "elbow") { const NV = { t: [0, -1], b: [0, 1], l: [-1, 0], r: [1, 0] }, k = Math.max(40, Math.hypot(q.x - p.x, q.y - p.y) * 0.42), a = NV[sa || this.dirSide(p, q)], b = NV[sb || this.dirSide(q, p)], c1 = [p.x + a[0] * k, p.y + a[1] * k], c2 = [q.x + b[0] * k, q.y + b[1] * k]; return { d: "M" + p.x + " " + p.y + " C" + c1[0] + " " + c1[1] + " " + c2[0] + " " + c2[1] + " " + q.x + " " + q.y, mid: { x: (p.x + 3 * c1[0] + 3 * c2[0] + q.x) / 8, y: (p.y + 3 * c1[1] + 3 * c2[1] + q.y) / 8 } }; }
        if (sh === "elbow") { const hz = Math.abs(q.x - p.x) >= Math.abs(q.y - p.y); if (hz) { const mx = (p.x + q.x) / 2; return { d: "M" + p.x + " " + p.y + " L" + mx + " " + p.y + " L" + mx + " " + q.y + " L" + q.x + " " + q.y, mid: { x: mx, y: (p.y + q.y) / 2 } }; } const my = (p.y + q.y) / 2; return { d: "M" + p.x + " " + p.y + " L" + p.x + " " + my + " L" + q.x + " " + my + " L" + q.x + " " + q.y, mid: { x: (p.x + q.x) / 2, y: my } }; }
        return { d: "M" + p.x + " " + p.y + " L" + q.x + " " + q.y, mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } };
      }
      adjAdd(c, eid) { let s = this.adj.get(c); if (!s) this.adj.set(c, s = new Set()); s.add(eid); }
      adjDel(c, eid) { const s = this.adj.get(c); if (s) { s.delete(eid); if (!s.size) this.adj.delete(c); } }
      updEdge(id) {
        const m = this.ye.get(id), r0 = this.eg.get(id);
        if (!m) { if (r0) { if (this._sc) { this._sc.add(r0.a); this._sc.add(r0.b); } this.adjDel(r0.a, id); this.adjDel(r0.b, id); this.eg.delete(id); } this.dropEdgeEl(id); return; }
        this.emid.set(m, id); const a = m.get("a"), b = m.get("b"); let r = r0;
        if (!r) { r = { m, a, b, bb: null, dirty: true }; this.eg.set(id, r); this.adjAdd(a, id); this.adjAdd(b, id); }
        else { if (r.a !== a || r.b !== b) { if (this._sc) { this._sc.add(r.a); this._sc.add(r.b); } this.adjDel(r.a, id); this.adjDel(r.b, id); r.a = a; r.b = b; this.adjAdd(a, id); this.adjAdd(b, id); } r.m = m; }
        r.dirty = true; r.bb = null; if (this._sc) { this._sc.add(a); this._sc.add(b); }
      }
      dropEdgeEl(id) { const r = this.edgeEls.get(id); if (r) { r.g.remove(); this.edgeEls.delete(id); } }
      // the rough area a link can touch (both cards plus room for a curve); false when an end card is missing
      ebb(r) { const A = this.geo.get(r.a), B = this.geo.get(r.b); if (!A || !B) return (r.bb = false); const pad = 40 + 0.25 * Math.hypot(A.x - B.x, A.y - B.y); return (r.bb = [Math.min(A.x, B.x) - pad, Math.min(A.y, B.y) - pad, Math.max(A.x + A.w, B.x + B.w) + pad, Math.max(A.y + A.h, B.y + B.h) + pad]); }
      // where along its side each link end sits: the ends on one side of a card are ordered by where the other cards are
      slotsOf(card) {
        const C = this._slotC || (this._slotC = new Map()); let t = C.get(card); if (t) return t; t = new Map(); C.set(card, t);
        const es = this.adj.get(card), g0 = this.geo.get(card); if (!es || es.size < 2 || !g0) return t; const groups = new Map(), A = { x: g0.x + g0.w / 2, y: g0.y + g0.h / 2 };
        for (const eid of es) { const r = this.eg.get(eid); if (!r) continue; const isA = r.a === card, o = this.geo.get(isA ? r.b : r.a); if (!o) continue; const O = { x: o.x + o.w / 2, y: o.y + o.h / 2 }, side = (isA ? r.m.get("sa") : r.m.get("sb")) || this.dirSide(A, O); let l = groups.get(side); if (!l) groups.set(side, l = []); l.push([eid, O, isA ? "a" : "b"]); }
        for (const [side, list] of groups) { if (list.length < 2) continue; const horiz = side === "t" || side === "b"; list.sort((x, y) => ((horiz ? x[1].x - y[1].x : x[1].y - y[1].y) || (x[0] < y[0] ? -1 : 1))); list.forEach((q, i) => t.set(q[0] + q[2], [i, list.length])); }
        return t;
      }
      mkEdgeEl(id, lite) {
        const NS = "http://www.w3.org/2000/svg", g = document.createElementNS(NS, "g"), ln = document.createElementNS(NS, "path"); ln.setAttribute("class", "osb-el"); ln.setAttribute("marker-end", "url(#osb-arrow)"); g.appendChild(ln); this.svg.appendChild(g);
        const r = { g, ln, lite: true }; this.edgeEls.set(id, r); if (!lite) this.edgeFull(r, id); if (this.selEdge === id) g.classList.add("is-sel"); if (this._fo) g.classList.toggle("is-dim", !this._fo.edges.has(id)); return r;
      }
      // a link far zoomed out is a bare line; close up it also gets its wide hit area, label, end handles and listeners
      edgeFull(r, id) {
        if (!r.lite) return; const NS = "http://www.w3.org/2000/svg", g = r.g, hit = document.createElementNS(NS, "path"), tx = document.createElementNS(NS, "text"); hit.setAttribute("class", "osb-eh"); tx.setAttribute("class", "osb-et"); tx.setAttribute("text-anchor", "middle");
        const ea = document.createElementNS(NS, "circle"), eb = document.createElementNS(NS, "circle"); for (const [c, end] of [[ea, "a"], [eb, "b"]]) { c.setAttribute("class", "osb-ep"); c.setAttribute("r", 7); c.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); if (this.ro) return; const mm = this.ye.get(id); if (!mm) return; this.drag = { kind: "relink", id, end, fixed: mm.get(end === "a" ? "b" : "a"), fixedSide: mm.get(end === "a" ? "sb" : "sa") || "" }; this.root.classList.add("is-linking"); this.root.setPointerCapture(ev.pointerId); }); }
        const mc = document.createElementNS(NS, "g"); g.insertBefore(hit, r.ln); g.append(tx, ea, eb, mc);
        if (!r.gl) { r.gl = 1; g.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); this.selEdge = id; this.select(new Set()); this.selEdge = id; this.mark(); if (ev.button === 0 && !this.ro) { this.drag = { kind: "edgecut", id, p0: this.pt(ev), far: false }; this.root.setPointerCapture(ev.pointerId); } }); g.addEventListener("dblclick", (ev) => { ev.stopPropagation(); this.editLabel(id); }); }
        Object.assign(r, { hit, tx, ea, eb, mc, lite: false });
      }
      edgeLite(r) { if (r.lite) return; for (const k of ["hit", "tx", "ea", "eb", "mc"]) { r[k].remove(); r[k] = null; } r.lite = true; }
      drawEdge(id, r, e) {
        const m = r.m, A0 = this.geo.get(r.a), B0 = this.geo.get(r.b); if (!A0 || !B0) return; const A = { x: A0.x + A0.w / 2, y: A0.y + A0.h / 2 }, B = { x: B0.x + B0.w / 2, y: B0.y + B0.h / 2 };
        if (!e.lite) { const ls = m.get("ls") || "", ad = m.get("ad") || "end", ec = m.get("ec") || ""; e.ln.style.strokeDasharray = ls === "dash" ? "9 6" : ls === "dot" ? "1 7" : ""; e.ln.style.strokeLinecap = ls === "dot" ? "round" : ""; if (ec) e.ln.style.setProperty("--ec", ec); else e.ln.style.removeProperty("--ec"); if (ad === "none") e.ln.removeAttribute("marker-end"); else e.ln.setAttribute("marker-end", "url(#osb-arrow)"); if (ad === "both") e.ln.setAttribute("marker-start", "url(#osb-arrow)"); else e.ln.removeAttribute("marker-start"); }
        else { e.ln.removeAttribute("marker-end"); e.ln.removeAttribute("marker-start"); }
        const sla = this.slotsOf(r.a).get(id + "a"), slb = this.slotsOf(r.b).get(id + "b"), sa0 = m.get("sa") || (sla ? this.dirSide(A, B) : ""), sb0 = m.get("sb") || (slb ? this.dirSide(B, A) : "");
        const p = (sa0 && this.anchorSide(r.a, sa0, sla)) || this.anchor(r.a, B), q = (sb0 && this.anchorSide(r.b, sb0, slb)) || this.anchor(r.b, A); const ep = this.edgePath(p, q, m.get("sh") || "", sa0, sb0); e.ln.setAttribute("d", ep.d); e.pq = [p.x, p.y, q.x, q.y];
        if (!e.lite) { for (const [k, pt] of [["ea", p], ["eb", q]]) { e[k].setAttribute("cx", pt.x); e[k].setAttribute("cy", pt.y); } e.hit.setAttribute("d", ep.d); e.tx.setAttribute("x", ep.mid.x); e.tx.setAttribute("y", ep.mid.y - 8); e.mc.setAttribute("transform", "translate(" + ep.mid.x + " " + ep.mid.y + ")"); const lb = m.get("label") || ""; if (e.tx.textContent !== lb) e.tx.textContent = lb; }
      }
      select(set) { if (this.ro) { if (this.sel.size) { this.sel = new Set(); this.mark(); } return; } this.sel = set; if (set.size) this.selEdge = null; this.mark(); this.publish(); }
      mark() {
        this._selVer++; this.renderSelBar(); const cur = this.sel, old = this._markSel;
        for (const id of old) if (!cur.has(id)) { const e = this.els.get(id); if (e) e.el.classList.remove("is-sel"); }
        for (const id of cur) if (!old.has(id)) { const e = this.els.get(id); if (e) e.el.classList.add("is-sel"); }
        this._markSel = new Set(cur); if (this.palette) this.palette.classList.toggle("is-on", this.sel.size > 0);
        const se = this.selEdge; if (se !== this._markEdge) { const a = this._markEdge && this.edgeEls.get(this._markEdge), b = se && this.edgeEls.get(se); if (a) a.g.classList.remove("is-sel"); if (b) b.g.classList.add("is-sel"); this._markEdge = se; }
        this.paintPeers();
      }
      // ---------- camera ----------
      pt(e) { const r = this.root.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }
      worldPt(sx, sy) { return { x: (sx - this.root.clientWidth / 2) / this.cam.k + this.cam.x, y: (sy - this.root.clientHeight / 2) / this.cam.k + this.cam.y }; }
      renderMini() { }
      paintMini() { }
      applyCam() {
        if (!this.world) return; const c = this.cam; if (!isFinite(c.x) || !isFinite(c.y) || !(c.k > 0) || !isFinite(c.k)) { c.x = 0; c.y = 0; c.k = 1; }
        this.renderMini(); if (this.draw && this._ck !== c.k) { this._ck = c.k; this.drawCursor(); } if (this.resetBtn) this.resetBtn.title = "Масштаб " + Math.round(c.k * 100) + "% (клик — 100%)"; this.renderSelBar(); this.world.style.transform = "translate(" + (this.root.clientWidth / 2 - c.x * c.k) + "px," + (this.root.clientHeight / 2 - c.y * c.k) + "px) scale(" + c.k + ")"; this.paintCursors(); if (this._inkCvOn) { const o = this._inkCv0; this.inkCv.style.transform = "translate(" + ((o.x - c.x) * c.k) + "px," + ((o.y - c.y) * c.k) + "px) scale(" + (c.k / o.k) + ")"; } this.scheduleCull();
      }
      fit() { const ms = Array.from(this.yn ? this.yn.values() : []); if (!ms.length) { this.cam = { x: 0, y: 0, k: 1 }; return this.applyCam(); } let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const m of ms) { a = Math.min(a, m.get("x")); b = Math.min(b, m.get("y")); c = Math.max(c, m.get("x") + m.get("w")); d = Math.max(d, m.get("y") + m.get("h")); } const w = this.root.clientWidth || 800, h = this.root.clientHeight || 600; this.cam = { x: (a + c) / 2, y: (b + d) / 2, k: Math.min(1.2, Math.max(.03, Math.min((w - 120) / Math.max(1, c - a), (h - 140) / Math.max(1, d - b)))) }; this.applyCam(); }
      // ---------- input ----------
      bindInput() {
        const r = this.root;
        r.addEventListener("pointerdown", (e) => {
          if (e.target.closest(".osb-card:not(.osb-ghost), .osb-sel, .osb-search, .osb-rail, .osb-help, .osb-dtb, .osb-lbl, g")) { if (!(this.draw && e.target.closest(".osb-card"))) return; }
          if (e.button !== 0 && e.button !== 1) return; const p = this.pt(e);
          if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); this.contentEl.focus();
          if (this.draw && e.button === 0 && !this.ro) { e.preventDefault(); this.startInk(e); r.setPointerCapture(e.pointerId); return; }
          const pan = e.button === 1 || this.space || this.ro || !this.yn.size;
          if (pan) { this.drag = { kind: "pan", sx: p.sx, sy: p.sy, cx: this.cam.x, cy: this.cam.y }; r.classList.add("is-panning"); }
          else { const add = e.shiftKey || e.ctrlKey; if (!add) { this.select(new Set()); this.selEdge = null; this.mark(); } this.drag = { kind: "box", x0: p.sx, y0: p.sy, base: new Set(add ? this.sel : []), add }; }
          r.setPointerCapture(e.pointerId);
        });
        r.addEventListener("pointermove", (e) => {
          const p = this.pt(e), w = this.worldPt(p.sx, p.sy); this.myCur = w; const d = this.drag; if (this.ringEl) { if (this.draw && !e.target.closest(".osb-dtb, .osb-rail, .osb-sel")) { this.ringEl.style.transform = "translate(" + p.sx + "px," + p.sy + "px)"; this.ringEl.style.opacity = "1"; } else this.ringEl.style.opacity = "0"; }
          if (d && d.kind === "pan") { if (Math.abs(p.sx - d.sx) + Math.abs(p.sy - d.sy) > 3) d.moved = true; this.cam.x = d.cx - (p.sx - d.sx) / this.cam.k; this.cam.y = d.cy - (p.sy - d.sy) / this.cam.k; this.applyCam(); }
          else if (d && d.kind === "move") { d.moved = true; let dx = w.x - d.p.x, dy = w.y - d.p.y; const g = this.guide(d, dx, dy); dx = g.dx; dy = g.dy; this.doc.transact(() => { for (const [s0, [x, y]] of d.o) { const n = this.yn.get(s0); if (n) { n.set("x", g.sx ? Math.round(x + dx) : this.sn(x + dx)); n.set("y", g.sy ? Math.round(y + dy) : this.sn(y + dy)); } } }); { const fr = []; for (const k of d.o.keys()) { const mm = this.yn.get(k), f = mm && mm.get("frame"); if (f && !d.o.has(f)) fr.push(k); } if (fr.length) this.refitFrames(fr); } }
          else if (d && d.kind === "size") {
            d.moved = true; const n = this.yn.get(d.id); if (n) { const dx = w.x - d.p.x, dy = w.y - d.p.y, MW = 120, MH = 60; let x = d.x, y = d.y, ww = d.w, hh = d.h;
              if (d.dir.includes("e")) ww = Math.max(MW, this.sn(d.w + dx)); if (d.dir.includes("s")) hh = Math.max(MH, this.sn(d.h + dy));
              if (d.dir.includes("w")) { ww = Math.max(MW, this.sn(d.w - dx)); x = d.x + d.w - ww; } if (d.dir.includes("n")) { hh = Math.max(MH, this.sn(d.h - dy)); y = d.y + d.h - hh; }
              const sn2 = this.sizeSnap(d, x, y, ww, hh); x = sn2.x; y = sn2.y; ww = Math.max(MW, sn2.w); hh = Math.max(MH, sn2.h); this.doc.transact(() => { n.set("x", Math.round(x)); n.set("y", Math.round(y)); n.set("w", Math.round(ww)); n.set("h", Math.round(hh)); }); this.refitFrames([d.id]); } }
          else if (d && (d.kind === "link" || d.kind === "relink")) this.drawTemp(w);
          else if (d && d.kind === "ink") this.moveInk(w, e);
          else if (d && d.kind === "edgecut") this.cutMove(d, p, w);
          else if (d && d.kind === "box") { const x = Math.min(d.x0, p.sx), y = Math.min(d.y0, p.sy), bw = Math.abs(p.sx - d.x0), bh = Math.abs(p.sy - d.y0); if (bw + bh > 6) { d.live = true; this.box.style.cssText = "display:block;left:" + x + "px;top:" + y + "px;width:" + bw + "px;height:" + bh + "px"; const a = this.worldPt(x, y), b2 = this.worldPt(x + bw, y + bh), hit = new Set(d.base); for (const [id, m] of this.yn.entries()) { const cx = m.get("x"), cy = m.get("y"); if (cx < b2.x && cx + m.get("w") > a.x && cy < b2.y && cy + m.get("h") > a.y) hit.add(id); } this.sel = hit; this.mark(); } }
          this.publish();
        });
        const up = (e) => { const d = this.drag; this.drag = null; if (d && d.kind === "edgecut") this.cutEnd(d); if (d && d.kind === "ink") this.endInk(d); r.classList.remove("is-panning"); this.clearGuides(); if (d && d.kind === "pan" && !d.moved && !this.ro) { this.select(new Set()); this.selEdge = null; this.mark(); } if (d && d.kind === "box") { this.box.style.display = "none"; if (d.live) this.publish(); } this.renderSelBar(); if (d && (d.kind === "move" || d.kind === "size") && !this.ro && d.moved) { const ids = d.kind === "move" ? Array.from(d.o.keys()) : [d.id]; if (d.kind === "move") this.joinFrames(ids); this.doc.transact(() => { for (const i of ids) { const m = this.yn.get(i); if (m) this.stampM(m); } }); if (ids.length > 20) this.feed("move", ids[0], ids.length + " карточек"); else for (const i of ids) this.feed("move", i, this.label(i)); } if (this.temp) { this.temp.remove(); this.temp = null; } const endW = (() => { const p = this.pt(e); return this.worldPt(p.sx, p.sy); })(); const tgt = this.lt || ((d && (d.kind === "link" || d.kind === "relink")) ? this.linkTarget(endW, d.kind === "link" ? d.from : d.fixed) : null); this.clearPorts();
          if (d && d.kind === "link") { const w = endW; if (tgt) this.addEdge(d.from, tgt, d.side || this.nearSide(d.from, this.center(tgt)), this.nearSide(tgt, w), true); else { const near = Array.from(this.yn.entries()).some(([i, m]) => i !== d.from && w.x >= m.get("x") && w.x <= m.get("x") + m.get("w") && w.y >= m.get("y") && w.y <= m.get("y") + m.get("h")); if (!near && Math.hypot(w.x - this.center(d.from).x, w.y - this.center(d.from).y) > 40) { const sd = this.nearSide(d.from, w), CW = 260, CH = 110, opp = { t: "b", b: "t", l: "r", r: "l" }[sd], id = this.addCard(sd === "r" ? w.x : sd === "l" ? w.x - CW : w.x - CW / 2, sd === "b" ? w.y : sd === "t" ? w.y - CH : w.y - CH / 2); this.addEdge(d.from, id, sd, opp); } } }
          else if (d && d.kind === "relink") { const m = this.ye.get(d.id); if (m && !tgt) { this.feed("unlink", null, ""); this.doc.transact(() => { this.ye.delete(d.id); }); this.selEdge = null; } else if (m && tgt && tgt !== d.fixed) { const sd = this.nearSide(tgt, endW); this.doc.transact(() => { m.set(d.end, tgt); m.set(d.end === "a" ? "sa" : "sb", sd); }); } this.syncEdges(); } };
        r.addEventListener("pointerleave", () => { if (this.ringEl) this.ringEl.style.opacity = "0"; }); r.addEventListener("pointerup", up); r.addEventListener("pointercancel", up);
        r.addEventListener("wheel", (e) => {
          const ta = e.target.closest && e.target.closest(".osb-ta"); if (ta && !e.ctrlKey && ta.scrollHeight > ta.clientHeight) return; e.preventDefault();
          const mouse = e.deltaMode === 1 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 100 && (Math.abs(e.deltaY) % 100 === 0 || Math.abs(e.deltaY) % 120 === 0));
          if (e.ctrlKey || mouse) { const p = this.pt(e), b = this.worldPt(p.sx, p.sy); this.cam.k = Math.max(.04, Math.min(3, this.cam.k * Math.exp(-(e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY) * (e.ctrlKey ? .01 : .0015)))); const a = this.worldPt(p.sx, p.sy); this.cam.x += b.x - a.x; this.cam.y += b.y - a.y; }
          else { this.cam.x += (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) / this.cam.k; this.cam.y += (e.shiftKey && !e.deltaX ? 0 : e.deltaY) / this.cam.k; }
          this.applyCam();
        }, { passive: false });
        r.addEventListener("dragover", (e) => { if ((e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) || (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("text/x-basalt-abs")) || (app.dragManager && app.dragManager.draggable)) { e.preventDefault(); try { e.dataTransfer.dropEffect = "copy"; } catch (er) { /* ok */ } } }, true);
        r.addEventListener("paste", (e) => {
          const t = e.target; if (this.ro || (t && (/INPUT|TEXTAREA/.test(t.tagName) || t.isContentEditable))) return; e.preventDefault();
          const fs = Array.from((e.clipboardData && e.clipboardData.files) || []), cur = this.myCur || this.worldPt(this.root.clientWidth / 2, this.root.clientHeight / 2);
          if (fs.length) this.importDomFiles(fs, cur); else this.pasteAny();
        });
        r.addEventListener("drop", (e) => { const ab = e.dataTransfer && e.dataTransfer.getData("text/x-basalt-abs"); if (ab && !this.ro) { e.preventDefault(); e.stopPropagation(); try { const fs = require("fs"), pa = require("path"), MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml", avif: "image/avif" }; const files = []; for (const a of JSON.parse(ab)) { if (fs.statSync(a).size > 80 * 1048576) { new api.Notice("Файл больше 80 МБ пропущен: " + pa.basename(a)); continue; } files.push(new File([fs.readFileSync(a)], pa.basename(a), { type: MIME[pa.extname(a).slice(1).toLowerCase()] || "" })); } const p1 = this.pt(e); this.importDomFiles(files, this.worldPt(p1.sx, p1.sy)); } catch (er) { new api.Notice("Не удалось прочитать файл"); } return; } const dr = app.dragManager && app.dragManager.draggable; if (this.ro && ((e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) || dr)) { new api.Notice("Эта доска открыта только для чтения: файлы добавить нельзя."); e.preventDefault(); return; } if (dr && !this.ro) { const list = dr.type === "files" ? dr.files : dr.type === "file" ? [dr.file] : []; if (list.length) { e.preventDefault(); e.stopPropagation(); const p0 = this.pt(e), w0 = this.worldPt(p0.sx, p0.sy); this.dropVaultFiles(list, w0); return; } } const fs = e.dataTransfer && Array.from(e.dataTransfer.files || []); if (!fs || !fs.length || this.ro) return; e.preventDefault(); e.stopPropagation(); const p = this.pt(e), w = this.worldPt(p.sx, p.sy); this.importDomFiles(fs, w); }, true);
        r.addEventListener("dblclick", (e) => { if (this.draw || this.ro) return; if (e.target.closest(".osb-card, g")) return; if ((this._noNew && performance.now() - this._noNew < 450) || (this._lastMd && performance.now() - this._lastMd.t < 700)) return; { const hit = document.elementFromPoint(e.clientX, e.clientY); if (hit && hit.closest && hit.closest(".osb-card, .osb-fmt, .osb-sel")) return; } const p = this.pt(e), w = this.worldPt(p.sx, p.sy); this.addCard(w.x - 130, w.y - 30); });
        r.addEventListener("contextmenu", (e) => {
          e.preventDefault(); if (!this.doc || this.draw) return; const M = api.Menu; const m = new M(), p = this.pt(e), w = this.worldPt(p.sx, p.sy), it = (t, ic, fn) => m.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn));
          const card = e.target.closest && e.target.closest(".osb-card"), eg = e.target.closest && e.target.closest("g");
          if (card) {
            const id = card.dataset.id; if (!this.sel.has(id)) this.select(new Set([id]));
            it("Дублировать", "lucide-copy", () => { for (const s of Array.from(this.sel)) { const n = this.yn.get(s); if (n) this.addCard(n.get("x") + 30, n.get("y") + 30, n.get("text").toString()); } });
            it("Экспорт выделенного…", "lucide-image-down", () => this.exportDialog()); { const fm = this.yn.get(id); if (fm && fm.get("frame")) it("Убрать из рамки", "lucide-square-dashed", () => { this.doc.transact(() => { for (const s2 of this.sel) { const mm = this.yn.get(s2); if (mm) mm.delete("frame"); } }); }); } it("Связи выделенных: изогнуть", "lucide-spline", () => this.styleLinksOf(Array.from(this.sel), { sh: "" })); it("Связи выделенных: выпрямить", "lucide-slash", () => this.styleLinksOf(Array.from(this.sel), { sh: "straight" })); it("Рамка вокруг выделенных", "lucide-frame", () => this.groupSel()); it("Копировать текст", "lucide-clipboard", () => { const n = this.yn.get(id); if (n) navigator.clipboard.writeText(n.get("text").toString()).catch(() => {}); });
            it("На передний план", "lucide-bring-to-front", () => { const n = this.yn.get(id), e2 = this.els.get(id); if (e2) this.cards.appendChild(e2.el); });
            m.addSeparator(); it("Удалить", "lucide-trash-2", () => this.removeSel());
          } else if (eg) {
            const id = Array.from(this.edgeEls).find(([, r2]) => r2.g === eg || eg.contains(r2.g))?.[0]; const ed = id && this.ye.get(id);
            if (ed) { it("Подписать связь", "lucide-type", () => this.editLabel(id)); m.addSeparator();
              const ls = ed.get("ls") || "", ad = ed.get("ad") || "end", ck = (t, ic, on, fn) => m.addItem((i) => i.setTitle(t).setIcon(ic).setChecked(on).onClick(fn));
              ck("Линия сплошная", "lucide-minus", ls === "", () => this.setEdge(id, { ls: "" })); ck("Линия пунктиром", "lucide-ellipsis", ls === "dash", () => this.setEdge(id, { ls: "dash" })); ck("Линия точками", "lucide-more-horizontal", ls === "dot", () => this.setEdge(id, { ls: "dot" })); m.addSeparator();
              ck("Стрелка к концу", "lucide-move-right", ad === "end", () => this.setEdge(id, { ad: "" })); ck("Стрелки с двух сторон", "lucide-move-horizontal", ad === "both", () => this.setEdge(id, { ad: "both" })); ck("Без стрелки", "lucide-minus", ad === "none", () => this.setEdge(id, { ad: "none" })); m.addSeparator();
              { const sh = ed.get("sh") || ""; ck("Форма: прямая", "lucide-slash", sh === "straight", () => this.setEdge(id, { sh: "straight" })); ck("Форма: изогнутая", "lucide-spline", sh === "" || sh === "curve", () => this.setEdge(id, { sh: "" })); ck("Форма: под прямым углом", "lucide-corner-down-right", sh === "elbow", () => this.setEdge(id, { sh: "elbow" })); m.addSeparator(); }
              it("Цвет связи…", "lucide-palette", () => window.__bsColors.pick({ x: e.clientX, y: e.clientY }, ed.get("ec") || "", (c) => this.setEdge(id, { ec: c }), { none: true })); it("Поменять направление", "lucide-arrow-left-right", () => this.flipEdge(id)); m.addSeparator(); it("Удалить связь", "lucide-trash-2", () => { this.feed("unlink", null, ""); this.ye.delete(id); }); }
          } else {
            it("Новая карточка здесь", "lucide-square-plus", () => this.addCard(w.x - 130, w.y - 30));
            it("Вставить построчно: строка — карточка", "lucide-list-plus", async () => { try { const t = await navigator.clipboard.readText(), ls = t.replace(/\r/g, "").split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 200); if (!ls.length) return; this.um && this.um.stopCapturing(); const cols = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(ls.length)))), ids = []; ids.push(...this.pasteLines(ls, w, cols)); this.um && this.um.stopCapturing(); this.select(new Set(ids)); } catch (er) { /* no access */ } }); it("Вставить текст карточкой", "lucide-clipboard-paste", async () => { try { const t = await navigator.clipboard.readText(); if (t) this.addCard(w.x - 130, w.y - 30, t); } catch (er) { /* no access */ } });
            m.addSeparator(); if (this.yn.size > 1) { it("Упорядочить всё по сетке", "lucide-grid-3x3", () => this.tidy("grid", null)); it("Расставить сеткой", "lucide-layout-grid", () => this.tidy("cells", null)); m.addSeparator(); } it("Показать всё", "lucide-maximize", () => this.fit());
          }
          m.showAtMouseEvent(e);
        });
        this.contentEl.tabIndex = 0;
        // toolbar buttons are plain divs: make them reachable with Tab and operable with Enter / Space like real buttons
        { const BTN = ".osb-btn,.osb-sb,.osb-dt,.osb-zb,.osb-x,.osb-rb"; const mk = (n) => { if (n.nodeType !== 1) return; const l = n.matches(BTN) ? [n] : []; for (const x of [...l, ...n.querySelectorAll(BTN)]) { if (!x.hasAttribute("tabindex")) x.tabIndex = 0; if (!x.hasAttribute("role")) x.setAttribute("role", "button"); } }; mk(this.contentEl);
          new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach(mk); }).observe(this.contentEl, { childList: true, subtree: true });
          this.contentEl.addEventListener("keydown", (e) => { const t = e.target; if ((e.key === "Enter" || e.key === " ") && t.matches && t.matches(BTN) && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.stopPropagation(); t.click(); } }, true); }
        this.contentEl.addEventListener("keyup", (e) => { if (e.code === "Space") { this.space = false; this.root.classList.remove("is-hand"); } });
        this.contentEl.addEventListener("keydown", (e) => {
          const inField = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName), mod = e.ctrlKey || e.metaKey, k = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
          if (mod && k === "f") { e.preventDefault(); this.toggleSearch(true); return; } if (inField) return;
          if (e.code === "Space" && !inField) { this.space = true; this.root.classList.add("is-hand"); e.preventDefault(); return; }
          if (this.draw && !mod && !e.altKey && !e.shiftKey) { const dm = /^(?:Digit|Numpad)(\d)$/.exec(e.code || ""); if (dm) { e.preventDefault(); const n = +dm[1]; if (n === 0) { if (this.wandBtn) this.wandBtn.click(); } else { const t = ["select", "pen", "hl", "line", "arrow", "rect", "ellipse", "text", "eraser"][n - 1]; if (t) this.setTool(t); } return; } }
          if (this.draw) { if (e.key === "Escape") this.toggleDraw(false); else if ((e.key === "Delete" || e.key === "Backspace") && this.inkSet && this.inkSet.size) { this.inkDeleteSel(); } else if (mod && k === "a" && this.tool === "select") { e.preventDefault(); this.inkSelect(new Set((this._ink ? this._ink.toArray() : []).map((q) => q.id))); return; } else if (k === "v" && !mod) this.setTool("select"); else if (k === "h" && !mod) this.setTool("hl"); else if (k === "t" && !mod) this.setTool("text"); else if (k === "p") this.setTool("pen"); else if (k === "e") this.setTool("eraser"); else if (k === "l") this.setTool("line"); else if (k === "r") this.setTool("rect"); else if (k === "o") this.setTool("ellipse"); else if (k === "a" && !mod) this.setTool("arrow"); if (!(mod && (k === "z" || k === "y"))) return; }
          if (this.ro) { if (k === "f") this.fit(); return; }
          if (e.key === "Escape") this.clearFocus();
          if (mod && k === "a") { e.preventDefault(); this.select(new Set(this.yn.keys())); }
          else if (mod && k === "z") { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); } else if (mod && k === "y") { e.preventDefault(); this.redo(); }
          else if (mod && k === "c") { this.copy(); } else if (mod && k === "x") { this.copy(); this.removeSel(); } else if (mod && k === "v") { /* the paste event below decides */ }
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
        const NS = "http://www.w3.org/2000/svg"; if (!this.temp) { this.temp = document.createElementNS(NS, "line"); this.temp.setAttribute("class", "osb-el osb-temp"); this.temp.style.transition = "none"; this.svg.appendChild(this.temp); } const d = this.drag, from = d.kind === "relink" ? d.fixed : d.from; if (!this.center(from)) return;
        { const now = performance.now(); if (!this._nt || now - this._nt > 60) { this._nt = now; const R = 260 / this.cam.k, cand = []; for (const [oid, om] of this.yn.entries()) { const dx = Math.max(om.get("x") - w.x, 0, w.x - om.get("x") - om.get("w")), dy = Math.max(om.get("y") - w.y, 0, w.y - om.get("y") - om.get("h")), dd = Math.hypot(dx, dy); if (dd < R) cand.push([dd, oid]); } cand.sort((a, b) => a[0] - b[0]); const nx = new Set(cand.slice(0, 6).map((q) => q[1])); nx.add(from); const old = this._near || new Set(); for (const id of old) if (!nx.has(id)) { const o = this.els.get(id); if (o) o.el.classList.remove("is-near"); } for (const id of nx) if (!old.has(id)) { const o = this.els.get(id); if (o) o.el.classList.add("is-near"); } this._near = nx; } }
        const t = this.linkTarget(w, from); if (t !== this.lt) { if (this.lt) { const o = this.els.get(this.lt); if (o) { o.el.classList.remove("is-linktgt"); for (const h of o.el.querySelectorAll(".osb-h")) h.classList.remove("is-port"); } } this.lt = t; if (t) { const o = this.els.get(t); if (o) o.el.classList.add("is-linktgt"); } }
        const a = d.kind === "relink" ? (d.fixedSide ? this.anchorSide(from, d.fixedSide) : this.anchor(from, w)) : this.anchorSide(from, d.side || this.nearSide(from, t ? this.center(t) : w)); let end = w; if (t) { const ts = this.nearSide(t, w); end = this.anchorSide(t, ts); const o = this.els.get(t); if (o) for (const h of o.el.querySelectorAll(".osb-h")) h.classList.toggle("is-port", h.classList.contains("osb-h-" + ts)); this.portDot("b", end); } else { const c = this._pdb; if (c) { c.remove(); this._pdb = null; } }
        this.portDot("a", a); this.temp.setAttribute("x1", a.x); this.temp.setAttribute("y1", a.y); this.temp.setAttribute("x2", end.x); this.temp.setAttribute("y2", end.y);
      }
      // ---------- people ----------
      selArr() { if (this._selArrV !== this._selVer) { this._selArr = Array.from(this.sel); this._selArrV = this._selVer; } return this._selArr; }
      publish(extra) {
        if (extra) return this.publish0(extra); const now = performance.now(); if (now - (this._pubT || 0) >= 80) { this._pubT = now; return this.publish0(); }
        if (!this._pubTm) this._pubTm = setTimeout(() => { this._pubTm = 0; this._pubT = performance.now(); this.publish0(); }, 80);
      }
      publish0(extra) { if (this.sh) { this.sh.publish(Object.assign({ board: this.relPath, cur: this.myCur || null, sel: this.selArr() }, extra || {})); return; } if (!this.aw) return; if (extra) this.extra = Object.assign(this.extra || {}, extra); this.aw.setLocalStateField("user", Object.assign({ name: me.name, color: me.color, cur: this.myCur || null, sel: this.selArr() }, this.extra || {})); }
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
        const by = new Map(); for (const u of this.peers) for (const id of u.sel || []) by.set(id, u); const oldBy = this._peerBy;
        for (const id of oldBy.keys()) if (!by.has(id)) { const e = this.els.get(id); if (e) { e.el.style.removeProperty("--peer"); e.el.classList.remove("has-peer"); if (!e.lite) e.tag.textContent = ""; } }
        this._peerBy = by; for (const [id, u] of by) { const e = this.els.get(id); if (e) this.decoPeer(e, u, id); }
        this.paintCursors();
      }
      paintCursors() {
        if (!this.layer) return;
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
        c.createEl("p", { text: "Ваше имя:" }); const n = c.createEl("input", { attr: { style: "width:100%" } }); n.value = me.name; n.maxLength = 32; n.onchange = () => { me.name = (n.value || me.name).slice(0, 32); try { localStorage.setItem("board-me", JSON.stringify(me)); } catch (e) { /* private */ } this.publish(); };
        M.open();
      }
      async onClose() { this.popKeys(); for (const k of ["flushRaf", "cullRaf", "fillRaf"]) if (this[k]) { cancelAnimationFrame(this[k]); this[k] = 0; } clearTimeout(this._pubTm); clearTimeout(this._sT); clearTimeout(this.saveT); clearInterval(this._hT); await this.save(); this.snapshot().catch(() => {}); if (this.sh) { if (this.sh.aw && this.pc) this.sh.aw.off("change", this.pc); this.sh.publish({ board: null, cur: null }); } else { if (this.prov) this.prov.destroy(); if (this.doc) this.doc.destroy(); } if (this.rso) this.rso.disconnect(); this.teardown(); }
      // let go of the data and the nodes: the workspace may keep this view object around after the tab is closed
      teardown() {
        try { if (this.um) this.um.destroy(); } catch (e) { /* ignore */ } this.um = null; this.sel = new Set(); this.drag = null; if (this.els) this.resetIdx(); this._ink = null; this.inkMirror = null; this.inkIds = null; this.inkEls = null; this._feed = null; this.yn = null; this.ye = null; this.ym = null; this.doc = null; this.sh = null; this.peers = [];
        if (this.cards) this.cards.replaceChildren(); if (this.svg) this.svg.querySelectorAll("g").forEach((g) => g.remove()); if (this.inkSvg) this.inkSvg.querySelectorAll("*:not(defs)").forEach((n) => { if (n.tagName !== "defs" && n.tagName !== "marker" && n.parentNode === this.inkSvg) n.remove(); });
      }
    };
  }

  async function openBoard(path) { const leaf = app.workspace.getLeaf("tab"); await leaf.setViewState({ type: VIEW, active: true, state: { path } }); app.workspace.setActiveLeaf(leaf, { focus: true }); }
  async function newBoard() { let i = 0, p; do { p = "Доска" + (i ? " " + i : "") + "." + EXT; i++; } while (await app.vault.adapter.exists(p)); await app.vault.adapter.write(p, "{}"); await openBoard(p); return p; }
  // JSON-canvas file -> board data (cards, links with their sides, images, groups as typed cards)
  async function canvasData(j) {
    const CM = { "1": "#e5484d", "2": "#f59f3b", "3": "#d6b43c", "4": "#46a758", "5": "#3fa7d6", "6": "#8e6bd8" }, SD = { top: "t", right: "r", bottom: "b", left: "l" }, nodes = [], edges = [];
    for (const n of j.nodes || []) {
      const ext = String(n.file || "").split(".").pop().toLowerCase(), card = { id: String(n.id), x: n.x || 0, y: n.y || 0, w: n.width || 260, h: n.height || 110, color: CM[n.color] || (/^#[0-9a-f]{6}$/i.test(n.color || "") ? n.color : ""), text: "", img: "", fold: false, kind: "" };
      if (n.type === "file") { const nm = String(n.file || "").replace(/^.*\//, "").replace(/\.[^.]+$/, ""); card.text = /^(png|jpe?g|gif|webp|bmp|avif)$/.test(ext) ? nm : "[[" + nm + "]]"; if (/^(png|jpe?g|gif|webp|bmp|avif)$/.test(ext)) { try { const buf = await app.vault.adapter.readBinary(n.file); if (buf.byteLength < 3000000) { const u8 = new Uint8Array(buf); let b = ""; for (let k = 0; k < u8.length; k += 0x8000) b += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000)); card.img = "data:image/" + (ext === "jpg" ? "jpeg" : ext) + ";base64," + btoa(b); } } catch (e) { /* the picture is gone: keep the name */ } } }
      else if (n.type === "link") card.text = n.url || ""; else if (n.type === "group") { card.text = n.label || ""; card.kind = "Группа"; } else card.text = n.text || "";
      nodes.push(card);
    }
    for (const e of j.edges || []) if (e.fromNode && e.toNode) edges.push({ a: String(e.fromNode), b: String(e.toNode), label: e.label || "", sa: SD[e.fromSide] || "", sb: SD[e.toSide] || "" });
    return { nodes, edges, ink: [] };
  }
  async function convertCanvas(file) {
    const Y = window.__bsY.Y; let data; try { data = await canvasData(JSON.parse(await app.vault.adapter.read(file.path))); } catch (e) { new window.__bsApi.Notice("Не удалось прочитать холст"); return; }
    const d = new Y.Doc(), yn = d.getMap("nodes"), ye = d.getMap("edges"), ym = d.getMap("meta"), ids = new Set(data.nodes.map((n) => n.id));
    d.transact(() => {
      ym.set("id", uid() + uid());
      for (const n of data.nodes) { const m = new Y.Map(), t = new Y.Text(); t.insert(0, n.text); m.set("x", n.x); m.set("y", n.y); m.set("w", n.w); m.set("h", n.h); m.set("color", n.color); m.set("by", me.name); if (n.img) m.set("img", n.img); if (n.kind) m.set("kind", n.kind); m.set("text", t); yn.set(n.id, m); }
      for (const e of data.edges) { if (!ids.has(e.a) || !ids.has(e.b)) continue; const m = new Y.Map(); m.set("a", e.a); m.set("b", e.b); m.set("label", e.label); if (e.sa) m.set("sa", e.sa); if (e.sb) m.set("sb", e.sb); ye.set(uid(), m); }
    });
    let i = 0, p; do { p = file.path.replace(/\.canvas$/, "") + (i ? " " + i : "") + "." + EXT; i++; } while (await app.vault.adapter.exists(p));
    await app.vault.adapter.write(p, JSON.stringify({ v: 2, ydoc: b64(Y.encodeStateAsUpdate(d)) })); new window.__bsApi.Notice("Холст преобразован в доску: " + p); await openBoard(p);
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
