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
        this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); this.svg.setAttribute("class", "osb-edges"); this.world.appendChild(this.svg);
        this.cards = this.world.createDiv({ cls: "osb-cards" });
        this.layer = this.root.createDiv({ cls: "osb-cursors" });
        const bar = this.bar = c.createDiv({ cls: "osb-bar" });
        const btn = (icon, tip, fn) => { const x = bar.createDiv({ cls: "osb-btn", attr: { title: tip, "aria-label": tip } }); api.setIcon(x, icon); x.onclick = fn; return x; };
        btn("lucide-square-plus", "Новая карточка", () => this.addCard());
        btn("lucide-maximize", "Показать всё", () => this.fit());
        this.share = document.createElement("div");
        this.palette = bar.createDiv({ cls: "osb-pal" });
        COLORS.forEach((col) => { const d = this.palette.createDiv({ cls: "osb-sw" }); d.style.background = col || "var(--background-modifier-border)"; d.onclick = () => this.setColor(col); });
        this.people = c.createDiv({ cls: "osb-people" });
        const fe = this.feedEl = c.createDiv({ cls: "osb-feed" }); const fh = fe.createDiv({ cls: "osb-feed-h" }); fh.createSpan({ text: "Активность" }); this.feedCount = fh.createSpan({ cls: "osb-feed-c" }); this.feedList = fe.createDiv({ cls: "osb-feed-l" });
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
            this.sh = sh; this.ro = !!sh.readOnly; if (this.ro) this.root.classList.add("is-ro"); this.relPath = rel; this.doc = sh.doc; this.yn = e.get("nodes"); this.ye = e.get("edges"); this.ym = sh.meta;
            this.yn.observeDeep((evs) => { this.sync(); this.flash(evs); }); this.ye.observeDeep(() => this.syncEdges());
            this.aw = sh.aw; this.pc = () => { this.peers = sh.peers.filter((u) => u.board === rel); this.paintPeers(); }; if (sh.aw) sh.aw.on("change", this.pc); this.pc();
            this.sync(); this.fit(); this.feedArr(); this.renderFeed(); this.share.classList.add("is-on"); return;
          } }
        let raw = null; try { raw = await app.vault.adapter.read(this.path); } catch (e) { /* new */ }
        this.doc = new Y.Doc(); this.yn = this.doc.getMap("nodes"); this.ye = this.doc.getMap("edges"); this.ym = this.doc.getMap("meta");
        let meta = {}; try { meta = raw ? JSON.parse(raw) : {}; } catch (e) { meta = {}; }
        if (meta.ydoc) Y.applyUpdate(this.doc, unb64(meta.ydoc));
        if (!this.ym.get("id")) this.ym.set("id", uid() + uid());
        this.yn.observeDeep((evs) => { this.sync(); this.flash(evs); this.queueSave(); });
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
      removeSel() { if (this.ro) return; for (const id of this.sel) this.feed("del", id, this.label(id)); if (this.selEdge) this.feed("unlink", null, ""); this.doc.transact(() => { for (const id of this.sel) { this.yn.delete(id); for (const [k, e] of Array.from(this.ye.entries())) if (e.get("a") === id || e.get("b") === id) this.ye.delete(k); } if (this.selEdge) this.ye.delete(this.selEdge); }); this.sel = new Set(); this.selEdge = null; this.mark(); }
      setColor(col) { if (this.ro) return; this.doc.transact(() => { for (const id of this.sel) { const m = this.yn.get(id); if (m) { m.set("color", col); this.stampM(m); } } }); for (const id of this.sel) this.feed("color", id, this.label(id)); }
      // ---------- DOM sync ----------
      sync() {
        const seen = new Set();
        this.yn.forEach((m, id) => {
          seen.add(id); let e = this.els.get(id); if (!e) e = this.mkCard(id, m);
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
        const ta = el.createEl("textarea", { cls: "osb-ta", attr: { placeholder: "Текст…", spellcheck: "false" } }); if (this.ro) ta.readOnly = true;
        for (const side of ["t", "r", "b", "l"]) { const h = el.createDiv({ cls: "osb-h osb-h-" + side }); h.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); ev.preventDefault(); if (this.ro) return; this.drag = { kind: "link", from: id }; this.root.setPointerCapture(ev.pointerId); }); }
        const rs = el.createDiv({ cls: "osb-rs" }); rs.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); ev.preventDefault(); if (this.ro) return; const mm = this.yn.get(id), q = this.pt(ev); this.drag = { kind: "size", id, w: mm.get("w"), h: mm.get("h"), p: this.worldPt(q.sx, q.sy) }; this.root.setPointerCapture(ev.pointerId); });
        grip.addEventListener("pointerdown", (ev) => { if (ev.target.closest(".osb-x") || ev.button !== 0 || this.ro) return; ev.preventDefault(); if (!this.sel.has(id)) this.select(ev.ctrlKey ? new Set([...this.sel, id]) : new Set([id])); const o = new Map(); for (const s of this.sel) { const n = this.yn.get(s); if (n) o.set(s, [n.get("x"), n.get("y")]); } const p = this.pt(ev); this.drag = { kind: "move", o, p: this.worldPt(p.sx, p.sy) }; this.root.setPointerCapture(ev.pointerId); });
        ta.addEventListener("focus", () => { this.select(new Set([id])); this.publish({ typing: id }); });
        ta.addEventListener("blur", () => this.publish({ typing: null }));
        ta.addEventListener("input", () => { const t = m.get("text"), old = t.toString(), now = ta.value; let a = 0; while (a < old.length && a < now.length && old[a] === now[a]) a++; let b = 0; while (b < old.length - a && b < now.length - a && old[old.length - 1 - b] === now[now.length - 1 - b]) b++; this.doc.transact(() => { if (old.length - a - b) t.delete(a, old.length - a - b); if (now.length - a - b) t.insert(a, now.slice(a, now.length - b)); this.stampM(m); }); this.feed("edit", id, this.label(id)); });
        const rec = { el, ta, tag, by }; this.els.set(id, rec); return rec;
      }
      anchor(id, toward) { const m = this.yn.get(id); if (!m) return null; const x = m.get("x"), y = m.get("y"), w = m.get("w"), h = m.get("h"), cx = x + w / 2, cy = y + h / 2, dx = toward.x - cx, dy = toward.y - cy; if (!dx && !dy) return { x: cx, y: cy }; const k = Math.min(dx ? (w / 2) / Math.abs(dx) : 1e9, dy ? (h / 2) / Math.abs(dy) : 1e9); return { x: cx + dx * k, y: cy + dy * k }; }
      center(id) { const m = this.yn.get(id); return m ? { x: m.get("x") + m.get("w") / 2, y: m.get("y") + m.get("h") / 2 } : null; }
      syncEdges() {
        if (!this.ye || !this.svg) return; const seen = new Set(); const NS = "http://www.w3.org/2000/svg";
        this.ye.forEach((m, id) => {
          const A = this.center(m.get("a")), B = this.center(m.get("b")); if (!A || !B) return; seen.add(id);
          let r = this.edgeEls.get(id); if (!r) { const g = document.createElementNS(NS, "g"), hit = document.createElementNS(NS, "line"), ln = document.createElementNS(NS, "line"), tx = document.createElementNS(NS, "text"); hit.setAttribute("class", "osb-eh"); ln.setAttribute("class", "osb-el"); tx.setAttribute("class", "osb-et"); tx.setAttribute("text-anchor", "middle"); g.append(hit, ln, tx); this.svg.appendChild(g); g.addEventListener("pointerdown", (ev) => { ev.stopPropagation(); this.selEdge = id; this.select(new Set()); this.selEdge = id; this.mark(); }); g.addEventListener("dblclick", async (ev) => { ev.stopPropagation(); const v = await ask("Подпись связи", m.get("label")); if (v != null) m.set("label", v); }); r = { g, hit, ln, tx }; this.edgeEls.set(id, r); }
          const p = this.anchor(m.get("a"), B), q = this.anchor(m.get("b"), A); for (const l of [r.hit, r.ln]) { l.setAttribute("x1", p.x); l.setAttribute("y1", p.y); l.setAttribute("x2", q.x); l.setAttribute("y2", q.y); }
          r.tx.setAttribute("x", (p.x + q.x) / 2); r.tx.setAttribute("y", (p.y + q.y) / 2 - 5); r.tx.textContent = m.get("label") || "";
        });
        for (const [id, r] of this.edgeEls) if (!seen.has(id)) { r.g.remove(); this.edgeEls.delete(id); }
      }
      select(set) { this.sel = set; if (set.size) this.selEdge = null; this.mark(); this.publish(); }
      mark() { for (const [id, e] of this.els) e.el.classList.toggle("is-sel", this.sel.has(id)); this.palette.classList.toggle("is-on", this.sel.size > 0); for (const [id, r] of this.edgeEls) r.g.classList.toggle("is-sel", this.selEdge === id); this.paintPeers(); }
      // ---------- camera ----------
      pt(e) { const r = this.root.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }
      worldPt(sx, sy) { return { x: (sx - this.root.clientWidth / 2) / this.cam.k + this.cam.x, y: (sy - this.root.clientHeight / 2) / this.cam.k + this.cam.y }; }
      applyCam() { if (!this.world) return; const c = this.cam; this.world.style.transform = "translate(" + (this.root.clientWidth / 2 - c.x * c.k) + "px," + (this.root.clientHeight / 2 - c.y * c.k) + "px) scale(" + c.k + ")"; this.paintPeers(); }
      fit() { const ms = Array.from(this.yn ? this.yn.values() : []); if (!ms.length) { this.cam = { x: 0, y: 0, k: 1 }; return this.applyCam(); } let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const m of ms) { a = Math.min(a, m.get("x")); b = Math.min(b, m.get("y")); c = Math.max(c, m.get("x") + m.get("w")); d = Math.max(d, m.get("y") + m.get("h")); } const w = this.root.clientWidth || 800, h = this.root.clientHeight || 600; this.cam = { x: (a + c) / 2, y: (b + d) / 2, k: Math.min(1.2, Math.max(.15, Math.min((w - 120) / Math.max(1, c - a), (h - 140) / Math.max(1, d - b)))) }; this.applyCam(); }
      // ---------- input ----------
      bindInput() {
        const r = this.root;
        r.addEventListener("pointerdown", (e) => { if (e.button !== 0 || e.target.closest(".osb-card")) return; const p = this.pt(e); this.select(new Set()); this.selEdge = null; this.mark(); this.drag = { kind: "pan", sx: p.sx, sy: p.sy, cx: this.cam.x, cy: this.cam.y }; r.setPointerCapture(e.pointerId); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); this.contentEl.focus(); });
        r.addEventListener("pointermove", (e) => {
          const p = this.pt(e), w = this.worldPt(p.sx, p.sy); this.myCur = w; const d = this.drag;
          if (d && d.kind === "pan") { this.cam.x = d.cx - (p.sx - d.sx) / this.cam.k; this.cam.y = d.cy - (p.sy - d.sy) / this.cam.k; this.applyCam(); }
          else if (d && d.kind === "move") { d.moved = true; this.doc.transact(() => { for (const [s, [x, y]] of d.o) { const n = this.yn.get(s); if (n) { n.set("x", Math.round(x + w.x - d.p.x)); n.set("y", Math.round(y + w.y - d.p.y)); } } }); }
          else if (d && d.kind === "size") { d.moved = true; const n = this.yn.get(d.id); if (n) this.doc.transact(() => { n.set("w", Math.max(120, Math.round(d.w + w.x - d.p.x))); n.set("h", Math.max(60, Math.round(d.h + w.y - d.p.y))); }); }
          else if (d && d.kind === "link") this.drawTemp(w);
          this.publish();
        });
        const up = (e) => { const d = this.drag; this.drag = null; if (d && (d.kind === "move" || d.kind === "size") && !this.ro && d.moved) { const ids = d.kind === "move" ? Array.from(d.o.keys()) : [d.id]; this.doc.transact(() => { for (const i of ids) { const m = this.yn.get(i); if (m) this.stampM(m); } }); for (const i of ids) this.feed("move", i, this.label(i)); } if (this.temp) { this.temp.remove(); this.temp = null; } if (d && d.kind === "link") { const t = document.elementFromPoint(e.clientX, e.clientY), c = t && t.closest && t.closest(".osb-card"); if (c && c.dataset.id !== d.from) this.addEdge(d.from, c.dataset.id); else if (!c) { const p = this.pt(e), w = this.worldPt(p.sx, p.sy), id = this.addCard(w.x - 130, w.y - 30); this.addEdge(d.from, id); } } };
        r.addEventListener("pointerup", up); r.addEventListener("pointercancel", up);
        r.addEventListener("wheel", (e) => { const ta = e.target.closest && e.target.closest(".osb-ta"); if (ta && !e.ctrlKey && ta.scrollHeight > ta.clientHeight) return; e.preventDefault(); const p = this.pt(e), b = this.worldPt(p.sx, p.sy); this.cam.k = Math.max(.1, Math.min(3, this.cam.k * Math.exp(-e.deltaY * .0015))); const a = this.worldPt(p.sx, p.sy); this.cam.x += b.x - a.x; this.cam.y += b.y - a.y; this.applyCam(); }, { passive: false });
        r.addEventListener("dblclick", (e) => { if (e.target.closest(".osb-card, g")) return; const p = this.pt(e), w = this.worldPt(p.sx, p.sy); this.addCard(w.x - 130, w.y - 30); });
        r.addEventListener("contextmenu", (e) => {
          e.preventDefault(); if (!this.doc) return; const M = api.Menu; const m = new M(), p = this.pt(e), w = this.worldPt(p.sx, p.sy), it = (t, ic, fn) => m.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn));
          const card = e.target.closest && e.target.closest(".osb-card"), eg = e.target.closest && e.target.closest("g");
          if (card) {
            const id = card.dataset.id; if (!this.sel.has(id)) this.select(new Set([id]));
            it("Дублировать", "lucide-copy", () => { for (const s of Array.from(this.sel)) { const n = this.yn.get(s); if (n) this.addCard(n.get("x") + 30, n.get("y") + 30, n.get("text").toString()); } });
            it("Копировать текст", "lucide-clipboard", () => { const n = this.yn.get(id); if (n) navigator.clipboard.writeText(n.get("text").toString()).catch(() => {}); });
            m.addItem((i) => { i.setTitle("Цвет").setIcon("lucide-palette"); const sub = i.setSubmenu(); [["Без цвета", ""], ["Красный", COLORS[1]], ["Оранжевый", COLORS[2]], ["Жёлтый", COLORS[3]], ["Зелёный", COLORS[4]], ["Голубой", COLORS[5]], ["Фиолетовый", COLORS[6]]].forEach(([t, c]) => sub.addItem((x) => x.setTitle(t).setIcon("lucide-circle").onClick(() => this.setColor(c)))); });
            it("На передний план", "lucide-bring-to-front", () => { const n = this.yn.get(id), e2 = this.els.get(id); if (e2) this.cards.appendChild(e2.el); });
            m.addSeparator(); it("Удалить", "lucide-trash-2", () => this.removeSel());
          } else if (eg) {
            const id = Array.from(this.edgeEls).find(([, r2]) => r2.g === eg || eg.contains(r2.g))?.[0]; const ed = id && this.ye.get(id);
            if (ed) { it("Подписать связь", "lucide-type", async () => { const v = await ask("Подпись связи", ed.get("label")); if (v != null) ed.set("label", v); }); m.addSeparator(); it("Удалить связь", "lucide-trash-2", () => { this.feed("unlink", null, ""); this.ye.delete(id); }); }
          } else {
            it("Новая карточка здесь", "lucide-square-plus", () => this.addCard(w.x - 130, w.y - 30));
            it("Вставить текст карточкой", "lucide-clipboard-paste", async () => { try { const t = await navigator.clipboard.readText(); if (t) this.addCard(w.x - 130, w.y - 30, t); } catch (er) { /* no access */ } });
            m.addSeparator(); it("Показать всё", "lucide-maximize", () => this.fit());
          }
          m.showAtMouseEvent(e);
        });
        this.contentEl.tabIndex = 0;
        this.contentEl.addEventListener("keydown", (e) => { if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; if ((e.key === "Delete" || e.key === "Backspace") && (this.sel.size || this.selEdge)) { e.preventDefault(); this.removeSel(); } });
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
        if (!this.people) return; this.people.empty();
        const chip = (u, self) => { const c = this.people.createDiv({ cls: "osb-chip" }); const d = c.createSpan({ cls: "osb-dot" }); d.style.background = u.color; c.createSpan({ text: u.name + (self ? " (вы)" : "") }); };
        chip(me, true); for (const u of this.peers) chip(u);
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
