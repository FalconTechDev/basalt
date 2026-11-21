// Basalt OSINT board: entities + relations on an infinite board, stored as a CRDT (Yjs) so several people edit it at once.
// A board is a ".osint" file in the vault. Every peer keeps a full copy; peers find each other over WebRTC (room = board id + password).
(() => {
  "use strict";
  const VIEW = "osint-board", EXT = "osint";
  const TYPES = {
    person: ["Человек", "#e5484d"], nick: ["Ник", "#f59f3b"], email: ["E-mail", "#d6b43c"], phone: ["Телефон", "#46a758"],
    domain: ["Домен", "#3fa7d6"], ip: ["IP", "#5b8def"], org: ["Организация", "#8e6bd8"], place: ["Адрес", "#c0699f"], doc: ["Документ", "#8a8f98"],
  };
  const COLORS = ["#e5484d", "#f59f3b", "#3fa7d6", "#46a758", "#8e6bd8", "#c0699f", "#d6b43c"];
  const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const ask = (title, def) => new Promise((res) => {
    const M = new window.__bsApi.Modal(app); M.titleEl.setText(title); let done = false; const fin = (v) => { if (!done) { done = true; res(v); } };
    const i = M.contentEl.createEl("input", { attr: { style: "width:100%" } }); i.value = def || ""; const row = M.contentEl.createDiv({ attr: { style: "margin-top:12px;display:flex;justify-content:flex-end;gap:8px" } });
    const ok = row.createEl("button", { text: "OK", cls: "mod-cta" }); ok.onclick = () => { fin(i.value.trim()); M.close(); }; i.onkeydown = (e) => { if (e.key === "Enter") ok.click(); };
    M.onClose = () => fin(null); M.open(); setTimeout(() => i.focus(), 50);
  });
  const signalingList = () => { try { const j = JSON.parse(localStorage.getItem("osint-signaling") || "null"); if (Array.isArray(j) && j.length) return j; } catch (e) { /* default */ } return ["wss://signaling.yjs.dev"]; };
  const uid = () => Math.random().toString(36).slice(2, 10);
  const me = (() => { try { const j = JSON.parse(localStorage.getItem("osint-me") || "null"); if (j) return j; } catch (e) { /* none */ } const j = { name: "Аналитик " + uid().slice(0, 3), color: COLORS[Math.floor(Math.random() * COLORS.length)] }; try { localStorage.setItem("osint-me", JSON.stringify(j)); } catch (e) { /* private */ } return j; })();

  function makeView(api) {
    return class OsintView extends api.ItemView {
      constructor(leaf) { super(leaf); this.path = null; this.nodes = new Map(); this.sel = new Set(); this.cam = { x: 0, y: 0, k: 1 }; this.peers = []; this.saveT = 0; this.drag = null; this.linkFrom = null; this.cursor = null; }
      getViewType() { return VIEW; }
      getDisplayText() { return this.path ? this.path.replace(/^.*\//, "").replace(/\.osint$/, "") : "Доска OSINT"; }
      getIcon() { return "lucide-waypoints"; }
      getState() { return { path: this.path }; }
      async setState(s, r) { if (s && s.path && s.path !== this.path) { this.path = s.path; if (!this.cv) this.build(); await this.openBoard(); } return super.setState ? super.setState(s, r) : undefined; }
      async onOpen() { if (!this.cv) this.build(); if (this.path && !this.doc) await this.openBoard(); }
      build() {
        const c = this.contentEl; c.empty(); c.classList.add("osb");
        this.cv = c.createEl("canvas", { cls: "osb-cv" });
        this.bar = c.createDiv({ cls: "osb-bar" });
        this.side = c.createDiv({ cls: "osb-side" });
        this.ro = new ResizeObserver(() => this.draw()); this.ro.observe(c);
        this.bindInput(); this.renderBar();
      }
      renderBar() {
        const b = this.bar; b.empty();
        const btn = (t, tip, fn) => { const x = b.createEl("button", { text: t, attr: { title: tip } }); x.onclick = fn; return x; };
        for (const [k, [name]] of Object.entries(TYPES)) btn("+ " + name, "Добавить: " + name, () => this.addNode(k));
        b.createDiv({ cls: "osb-sp" });
        btn("Вписать", "Показать всё", () => this.fit());
        this.shareBtn = btn("Совместная работа", "Подключить людей", () => this.shareDialog());
      }
      // ---------- data ----------
      async openBoard() {
        const Y = window.__bsY && window.__bsY.Y; if (!Y) { new api.Notice("Не загружен модуль синхронизации"); return; }
        const ad = app.vault.adapter; let raw = null; try { raw = await ad.read(this.path); } catch (e) { /* new */ }
        this.doc = new Y.Doc(); this.yn = this.doc.getMap("nodes"); this.ye = this.doc.getMap("edges"); this.ym = this.doc.getMap("meta"); this.ylog = this.doc.getArray("log");
        let meta = {}; try { meta = raw ? JSON.parse(raw) : {}; } catch (e) { meta = {}; }
        if (meta.ydoc) Y.applyUpdate(this.doc, unb64(meta.ydoc));
        if (!this.ym.get("id")) this.ym.set("id", uid() + uid());
        this.doc.on("update", () => { this.refresh(); this.queueSave(); });
        this.refresh(); this.fit(true);
        if (this.ym.get("room")) this.connect(this.ym.get("room"), this.ym.get("pass") || "");
      }
      refresh() { this.draw(); this.renderSide(); }
      queueSave() { clearTimeout(this.saveT); this.saveT = setTimeout(() => this.save(), 400); }
      async save() {
        if (!this.doc || !this.path) return; const Y = window.__bsY.Y;
        const out = { v: 1, id: this.ym.get("id"), room: this.ym.get("room") || null, nodes: this.yn.toJSON(), edges: this.ye.toJSON(), ydoc: b64(Y.encodeStateAsUpdate(this.doc)) };
        try { await app.vault.adapter.write(this.path, JSON.stringify(out, null, 1)); } catch (e) { console.error(e); }
      }
      log(text) { try { this.ylog.push([{ t: Date.now(), who: me.name, text }]); if (this.ylog.length > 200) this.ylog.delete(0, this.ylog.length - 200); } catch (e) { /* none */ } }
      async addNode(type, x, y) {
        const w = this.world(this.cv.clientWidth / 2, this.cv.clientHeight / 2), id = uid();
        const label = await ask("Значение (" + TYPES[type][0] + ")"); if (!label) return;
        const Y = window.__bsY.Y, m = new Y.Map(); this.doc.transact(() => { m.set("type", type); m.set("label", label); m.set("x", x == null ? w.x + (Math.random() - .5) * 120 : x); m.set("y", y == null ? w.y + (Math.random() - .5) * 120 : y); m.set("src", ""); m.set("note", ""); m.set("conf", 2); m.set("by", me.name); this.yn.set(id, m); this.log("добавил " + TYPES[type][0] + " «" + label + "»"); });
        this.sel = new Set([id]); this.refresh();
      }
      async addEdge(a, b) {
        if (a === b) return; for (const e of this.ye.values()) if ((e.get("a") === a && e.get("b") === b) || (e.get("a") === b && e.get("b") === a)) return;
        const label = (await ask("Связь (владелец, использует, работает в ...)")) || ""; const Y = window.__bsY.Y, m = new Y.Map();
        this.doc.transact(() => { m.set("a", a); m.set("b", b); m.set("label", label); m.set("src", ""); this.ye.set(uid(), m); this.log("связал «" + this.yn.get(a).get("label") + "» → «" + this.yn.get(b).get("label") + "»"); });
      }
      removeSel() {
        this.doc.transact(() => { for (const id of this.sel) { const n = this.yn.get(id); if (n) this.log("удалил «" + n.get("label") + "»"); this.yn.delete(id); for (const [k, e] of Array.from(this.ye.entries())) if (e.get("a") === id || e.get("b") === id) this.ye.delete(k); } }); this.sel.clear();
      }
      // ---------- geometry ----------
      world(sx, sy) { return { x: (sx - this.cv.clientWidth / 2) / this.cam.k + this.cam.x, y: (sy - this.cv.clientHeight / 2) / this.cam.k + this.cam.y }; }
      screen(wx, wy) { return { x: (wx - this.cam.x) * this.cam.k + this.cv.clientWidth / 2, y: (wy - this.cam.y) * this.cam.k + this.cv.clientHeight / 2 }; }
      hit(wx, wy) { let best = null; for (const [id, n] of this.yn.entries()) { const dx = wx - n.get("x"), dy = wy - n.get("y"); if (dx * dx + dy * dy <= 22 * 22) best = id; } return best; }
      fit(soft) { const pts = Array.from(this.yn.values()); if (!pts.length) { this.cam = { x: 0, y: 0, k: 1 }; return this.draw(); } let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const n of pts) { a = Math.min(a, n.get("x")); b = Math.min(b, n.get("y")); c = Math.max(c, n.get("x")); d = Math.max(d, n.get("y")); } const w = this.cv.clientWidth || 800, h = this.cv.clientHeight || 600; this.cam = { x: (a + c) / 2, y: (b + d) / 2, k: Math.min(1.4, Math.max(.2, Math.min((w - 160) / Math.max(1, c - a), (h - 160) / Math.max(1, d - b)))) }; this.draw(); }
      // ---------- render ----------
      draw() {
        if (!this.cv || !this.cv.isConnected) return; const cv = this.cv, d = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
        if (cv.width !== W * d || cv.height !== H * d) { cv.width = W * d; cv.height = H * d; }
        const g = cv.getContext("2d"), st = getComputedStyle(this.contentEl); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, W, H);
        const text = st.getPropertyValue("--text-normal") || "#ddd", faint = st.getPropertyValue("--text-faint") || "#888", acc = st.getPropertyValue("--interactive-accent") || "#7c5cff";
        if (!this.yn) return;
        g.lineWidth = 1.4; g.font = "11px sans-serif"; g.textAlign = "center";
        for (const e of this.ye.values()) { const A = this.yn.get(e.get("a")), B = this.yn.get(e.get("b")); if (!A || !B) continue; const p = this.screen(A.get("x"), A.get("y")), q = this.screen(B.get("x"), B.get("y")); g.strokeStyle = faint; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); const l = e.get("label"); if (l) { g.fillStyle = faint; g.fillText(l, (p.x + q.x) / 2, (p.y + q.y) / 2 - 4); } }
        if (this.linkFrom && this.cursor && this.yn.get(this.linkFrom)) { const p = this.screen(this.yn.get(this.linkFrom).get("x"), this.yn.get(this.linkFrom).get("y")); g.strokeStyle = acc; g.setLineDash([5, 4]); g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(this.cursor.sx, this.cursor.sy); g.stroke(); g.setLineDash([]); }
        const r = 18 * Math.min(1.4, Math.max(.6, this.cam.k));
        for (const [id, n] of this.yn.entries()) {
          const p = this.screen(n.get("x"), n.get("y")), t = TYPES[n.get("type")] || TYPES.doc; g.fillStyle = t[1]; g.beginPath(); g.arc(p.x, p.y, r, 0, 7); g.fill();
          if (this.sel.has(id)) { g.strokeStyle = acc; g.lineWidth = 3; g.stroke(); g.lineWidth = 1.4; }
          g.fillStyle = text; g.font = "12px sans-serif"; g.fillText(n.get("label"), p.x, p.y + r + 14);
          g.fillStyle = "#fff"; g.font = "bold 11px sans-serif"; g.fillText(t[0].slice(0, 2), p.x, p.y + 4);
        }
        // other people: their cursor and selection
        for (const p of this.peers) { const u = p.user; if (!u) continue;
          for (const id of u.sel || []) { const n = this.yn.get(id); if (!n) continue; const s = this.screen(n.get("x"), n.get("y")); g.strokeStyle = u.color; g.lineWidth = 3; g.setLineDash([4, 3]); g.beginPath(); g.arc(s.x, s.y, r + 5, 0, 7); g.stroke(); g.setLineDash([]); g.lineWidth = 1.4; }
          if (u.cur) { const s = this.screen(u.cur.x, u.cur.y); g.fillStyle = u.color; g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x + 12, s.y + 5); g.lineTo(s.x + 5, s.y + 12); g.closePath(); g.fill(); g.font = "11px sans-serif"; const w = g.measureText(u.name).width + 10; g.fillRect(s.x + 12, s.y + 10, w, 16); g.fillStyle = "#fff"; g.textAlign = "left"; g.fillText(u.name, s.x + 17, s.y + 22); g.textAlign = "center"; }
        }
      }
      renderSide() {
        const s = this.side; if (!s || !this.yn) return; s.empty();
        const sec = (t) => s.createDiv({ cls: "osb-h", text: t });
        sec("Участники");
        const row = (u, self) => { const r = s.createDiv({ cls: "osb-u" }); const dot = r.createSpan({ cls: "osb-dot" }); dot.style.background = u.color; r.createSpan({ text: u.name + (self ? " (вы)" : "") }); };
        row(me, true); for (const p of this.peers) if (p.user) row(p.user, false);
        const one = this.sel.size === 1 ? this.yn.get(Array.from(this.sel)[0]) : null;
        if (one) {
          sec("Сущность");
          const f = (label, key, area) => { const w = s.createDiv({ cls: "osb-f" }); w.createEl("label", { text: label }); const i = w.createEl(area ? "textarea" : "input"); i.value = one.get(key) || ""; i.onchange = () => { one.set(key, i.value); this.log("изменил «" + one.get("label") + "»: " + label); }; };
          f("Значение", "label"); f("Источник (URL)", "src"); f("Заметка", "note", true);
          const w = s.createDiv({ cls: "osb-f" }); w.createEl("label", { text: "Достоверность" }); const sel = w.createEl("select"); [["1", "низкая"], ["2", "средняя"], ["3", "высокая"]].forEach(([v, t]) => sel.createEl("option", { value: v, text: t })); sel.value = String(one.get("conf") || 2); sel.onchange = () => one.set("conf", +sel.value);
          s.createDiv({ cls: "osb-by", text: "добавил: " + (one.get("by") || "?") });
        }
        sec("Журнал");
        const lg = s.createDiv({ cls: "osb-log" }); for (const e of this.ylog.toArray().slice(-30).reverse()) lg.createDiv({ text: new Date(e.t).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) + " " + e.who + " " + e.text });
      }
      // ---------- input ----------
      bindInput() {
        const cv = this.cv, pt = (e) => { const r = cv.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };
        cv.addEventListener("pointerdown", (e) => {
          if (e.button !== 0 || !this.yn) return; const p = pt(e), w = this.world(p.sx, p.sy), id = this.hit(w.x, w.y);
          if (e.shiftKey && id) { this.linkFrom = id; this.cursor = p; return; }
          if (id) { if (!this.sel.has(id)) this.sel = e.ctrlKey ? new Set([...this.sel, id]) : new Set([id]); const o = new Map(); for (const s of this.sel) { const n = this.yn.get(s); o.set(s, [n.get("x"), n.get("y")]); } this.drag = { kind: "move", w, o }; }
          else { this.sel.clear(); this.drag = { kind: "pan", sx: p.sx, sy: p.sy, cx: this.cam.x, cy: this.cam.y }; }
          cv.setPointerCapture(e.pointerId); this.publish(); this.refresh();
        });
        cv.addEventListener("pointermove", (e) => {
          const p = pt(e), w = this.world(p.sx, p.sy); this.cursor = p; this.myCur = w;
          if (this.drag && this.drag.kind === "pan") { this.cam.x = this.drag.cx - (p.sx - this.drag.sx) / this.cam.k; this.cam.y = this.drag.cy - (p.sy - this.drag.sy) / this.cam.k; this.draw(); }
          else if (this.drag && this.drag.kind === "move") { this.doc.transact(() => { for (const [s, [x, y]] of this.drag.o) { const n = this.yn.get(s); n.set("x", x + w.x - this.drag.w.x); n.set("y", y + w.y - this.drag.w.y); } }); }
          else if (this.linkFrom) this.draw();
          this.publish();
        });
        cv.addEventListener("pointerup", (e) => {
          if (this.linkFrom) { const p = pt(e), w = this.world(p.sx, p.sy), id = this.hit(w.x, w.y); const a = this.linkFrom; this.linkFrom = null; if (id) this.addEdge(a, id); this.draw(); }
          this.drag = null;
        });
        cv.addEventListener("wheel", (e) => { e.preventDefault(); const p = pt(e), b = this.world(p.sx, p.sy); this.cam.k = Math.max(.1, Math.min(4, this.cam.k * Math.exp(-e.deltaY * .0015))); const a = this.world(p.sx, p.sy); this.cam.x += b.x - a.x; this.cam.y += b.y - a.y; this.draw(); }, { passive: false });
        cv.addEventListener("dblclick", (e) => { const p = pt(e), w = this.world(p.sx, p.sy); if (!this.hit(w.x, w.y)) this.addNode("person", w.x, w.y); });
        this.contentEl.tabIndex = 0;
        this.contentEl.addEventListener("keydown", (e) => { if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; if ((e.key === "Delete" || e.key === "Backspace") && this.sel.size) { e.preventDefault(); this.removeSel(); } });
      }
      // ---------- peers ----------
      publish() { if (!this.aw) return; this.aw.setLocalStateField("user", { name: me.name, color: me.color, cur: this.myCur || null, sel: Array.from(this.sel) }); }
      connect(room, pass) {
        const L = window.__bsY; if (this.prov) this.prov.destroy();
        this.prov = new L.WebrtcProvider("basalt-osint-" + room, this.doc, { password: pass || undefined, signaling: signalingList() });
        this.aw = this.prov.awareness; this.publish();
        this.aw.on("change", () => { this.peers = Array.from(this.aw.getStates().entries()).filter(([id]) => id !== this.aw.clientID).map(([, s]) => s); this.refresh(); });
        if (this.shareBtn) this.shareBtn.classList.add("is-on");
      }
      shareDialog() {
        if (!this.doc) return; let room = this.ym.get("room"), pass = this.ym.get("pass");
        if (!room) { room = this.ym.get("id"); pass = uid() + uid(); this.doc.transact(() => { this.ym.set("room", room); this.ym.set("pass", pass); }); this.connect(room, pass); }
        const code = "basalt-osint:" + room + ":" + pass;
        const M = new api.Modal(app); M.titleEl.setText("Совместная работа"); const c = M.contentEl;
        c.createEl("p", { text: "Код приглашения. Каждый, кто его введёт, получает полную копию доски и сам начинает её раздавать: если ваш компьютер выключится, остальные продолжат работать." });
        const i = c.createEl("input", { attr: { readonly: "true", style: "width:100%" } }); i.value = code; i.onfocus = () => i.select();
        c.createEl("p", { text: "Серверы сигнализации (через запятую; нужны только чтобы пиры нашли друг друга):" }); const sg = c.createEl("input", { attr: { style: "width:100%" } }); sg.value = signalingList().join(", "); sg.onchange = () => { try { localStorage.setItem("osint-signaling", JSON.stringify(sg.value.split(",").map((x) => x.trim()).filter(Boolean))); } catch (e) { /* private */ } };
        c.createEl("p", { text: "Ваше имя:" }); const n = c.createEl("input", { attr: { style: "width:100%" } }); n.value = me.name; n.onchange = () => { me.name = n.value || me.name; try { localStorage.setItem("osint-me", JSON.stringify(me)); } catch (e) { /* private */ } this.publish(); };
        M.open();
      }
      async onClose() { clearTimeout(this.saveT); await this.save(); if (this.prov) this.prov.destroy(); if (this.ro) this.ro.disconnect(); if (this.doc) this.doc.destroy(); }
    };
  }

  async function openBoard(path) { const leaf = app.workspace.getLeaf("tab"); await leaf.setViewState({ type: VIEW, active: true, state: { path } }); app.workspace.setActiveLeaf(leaf, { focus: true }); }
  async function newBoard() { let n = "Доска OSINT", i = 0, p; do { p = n + (i ? " " + i : "") + "." + EXT; i++; } while (await app.vault.adapter.exists(p)); await app.vault.adapter.write(p, "{}"); await openBoard(p); }
  async function joinBoard() {
    const code = await ask("Код приглашения"); const m = code && /^basalt-osint:([^:]+):(.+)$/.exec(code.trim()); if (!m) return;
    const p = "Доска (подключена " + m[1].slice(0, 4) + ")." + EXT; const Y = window.__bsY.Y, d = new Y.Doc(); d.getMap("meta").set("id", m[1]); d.getMap("meta").set("room", m[1]); d.getMap("meta").set("pass", m[2]);
    await app.vault.adapter.write(p, JSON.stringify({ v: 1, ydoc: b64(Y.encodeStateAsUpdate(d)) })); await openBoard(p);
  }

  const t = setInterval(() => {
    if (!window.app || !app.workspace || !app.viewRegistry || !app.commands || !window.__bsApi || !window.__bsApi.ItemView || !window.__bsY) return;
    clearInterval(t);
    const V = makeView(window.__bsApi), creator = (leaf) => new V(leaf);
    try { app.viewRegistry.registerView(VIEW, creator); } catch (e) { app.viewRegistry.viewByType[VIEW] = creator; }
    try { app.viewRegistry.registerExtensions([EXT], VIEW); } catch (e) { /* opened by command */ }
    app.commands.addCommand({ id: "basalt:osint-new", name: "Новая доска OSINT", icon: "lucide-waypoints", callback: newBoard });
    app.commands.addCommand({ id: "basalt:osint-join", name: "Подключиться к доске OSINT по коду", icon: "lucide-users", callback: joinBoard });
    window.__bsOsint = { open: openBoard, create: newBoard, join: joinBoard };
  }, 500);
})();
