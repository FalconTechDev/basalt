// Basalt shared folders: a whole folder (or the whole vault) is kept in sync between several people, with no central server.
// The folder lives in a Yjs CRDT document; every participant holds a full copy and re-shares it, so the work goes on when the first host goes away.
// Notes and other text files are Y.Text, boards are native Y.Map structures (the board view edits them directly), images and the like are stored as base64.
(() => {
  "use strict";
  const STATE = ".basalt-share", TEXT = /\.(md|txt|csv|json|canvas|base|css|html?|xml|ya?ml|toml|js|mjs|ts|py|sh|log|ini|cfg)$/i, MAXBIN = 8 * 1024 * 1024;
  const b64 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const PEER = ["#e5484d", "#f59f3b", "#3fa7d6", "#46a758", "#8e6bd8", "#c0699f", "#d6b43c"];
  const me = () => { try { const j = JSON.parse(localStorage.getItem("board-me") || "null"); if (j) return j; } catch (e) { /* none */ } const j = { name: "Участник " + uid().slice(0, 3), color: PEER[Math.floor(Math.random() * PEER.length)] }; try { localStorage.setItem("board-me", JSON.stringify(j)); } catch (e) { /* private */ } return j; };
  const signaling = () => { try { const j = JSON.parse(localStorage.getItem("board-signaling") || "null"); if (Array.isArray(j) && j.length) return j; } catch (e) { /* default */ } return ["wss://signaling.yjs.dev"]; };
  const join = (a, b) => (!a || a === "/" ? "" : a.replace(/\/$/, "") + "/") + b;
  const shares = new Map();
  let resolveReady; window.__bsShareReady = new Promise((r) => { resolveReady = r; });

  class Share {
    constructor(folder, room, pass) {
      this.folder = folder === "/" ? "" : folder; this.room = room; this.pass = pass; const Y = window.__bsY.Y;
      this.doc = new Y.Doc(); this.files = this.doc.getMap("files"); this.meta = this.doc.getMap("meta"); this.written = new Map(); this.timers = new Map(); this.saveT = 0; this.peers = [];
    }
    abs(rel) { return join(this.folder, rel); }
    rel(path) { return this.folder ? (path.startsWith(this.folder + "/") ? path.slice(this.folder.length + 1) : null) : path; }
    skip(rel) { return !rel || rel.split("/").some((p) => p.startsWith(".")); }
    async start() {
      const Y = window.__bsY.Y, ad = app.vault.adapter; let st = null;
      try { st = JSON.parse(await ad.read(this.abs(STATE))); } catch (e) { /* first time */ }
      if (st && st.state) Y.applyUpdate(this.doc, unb64(st.state));
      await this.scan();
      this.files.observeDeep((evs) => { for (const ev of evs) { const p = ev.path; if (p.length === 0) { for (const k of ev.keysChanged) this.toDisk(k); } else this.toDisk(p[0]); } this.queueSave(); });
      this.doc.on("update", () => this.queueSave());
      const L = window.__bsY; this.prov = new L.WebrtcProvider("basalt-share-" + this.room, this.doc, { password: this.pass || undefined, signaling: signaling() });
      this.aw = this.prov.awareness; this.publish();
      this.aw.on("change", () => { this.peers = Array.from(this.aw.getStates().entries()).filter(([id]) => id !== this.aw.clientID).map(([, s]) => s.user).filter(Boolean); document.dispatchEvent(new CustomEvent("basalt-share-peers", { detail: this })); });
      this.onVault = (type) => (f, old) => this.vaultEvent(type, f, old);
      this.evs = ["create", "modify", "delete", "rename"].map((t) => app.vault.on(t, this.onVault(t)));
      this.queueSave();
    }
    publish(extra) { if (!this.aw) return; if (extra) this.extra = Object.assign(this.extra || {}, extra); const m = me(); this.aw.setLocalStateField("user", Object.assign({ name: m.name, color: m.color }, this.extra || {})); }
    async list(dir) {
      const ad = app.vault.adapter, out = []; let r; try { r = await ad.list(dir || "/"); } catch (e) { return out; }
      for (const f of r.files) { const rel = this.rel(f); if (!this.skip(rel)) out.push(rel); }
      for (const d of r.folders) { const rel = this.rel(d); if (!this.skip(rel)) out.push(...await this.list(d)); }
      return out;
    }
    async scan() {
      const disk = await this.list(this.folder);
      for (const rel of disk) await this.fromDisk(rel);
      for (const rel of this.files.keys()) if (!disk.includes(rel)) await this.toDiskNow(rel);
    }
    isBoard(rel) { return /\.board$/i.test(rel); }
    async fromDisk(rel) {
      const Y = window.__bsY.Y, ad = app.vault.adapter, p = this.abs(rel); if (this.skip(rel)) return;
      let e = this.files.get(rel);
      try {
        if (this.isBoard(rel)) {
          if (e) return; let j = {}; try { j = JSON.parse(await ad.read(p)); } catch (er) { j = {}; }
          const m = new Y.Map(), nodes = new Y.Map(), edges = new Y.Map();
          this.doc.transact(() => { if (this.files.get(rel)) return; for (const [id, n] of Object.entries(j.nodes || {})) { const c = new Y.Map(), t = new Y.Text(); t.insert(0, n.text || ""); c.set("x", n.x || 0); c.set("y", n.y || 0); c.set("w", n.w || 260); c.set("h", n.h || 110); c.set("color", n.color || ""); c.set("text", t); nodes.set(id, c); } for (const [id, ed] of Object.entries(j.edges || {})) { const c = new Y.Map(); c.set("a", ed.a); c.set("b", ed.b); c.set("label", ed.label || ""); edges.set(id, c); } m.set("t", "board"); m.set("nodes", nodes); m.set("edges", edges); this.files.set(rel, m); });
        } else if (TEXT.test(rel)) {
          const txt = await ad.read(p);
          if (!e || e.get("t") !== "text") { const m = new Y.Map(), t = new Y.Text(); t.insert(0, txt); m.set("t", "text"); m.set("text", t); this.files.set(rel, m); }
          else { const t = e.get("text"), old = t.toString(); if (old !== txt) this.diff(t, old, txt); }
        } else {
          const buf = await ad.readBinary(p); if (buf.byteLength > MAXBIN) return; const d = b64(new Uint8Array(buf));
          if (!e || e.get("data") !== d) { const m = new Y.Map(); m.set("t", "bin"); m.set("data", d); this.files.set(rel, m); }
        }
      } catch (er) { console.error("share read", rel, er); }
    }
    diff(t, old, now) { let a = 0; while (a < old.length && a < now.length && old[a] === now[a]) a++; let b = 0; while (b < old.length - a && b < now.length - a && old[old.length - 1 - b] === now[now.length - 1 - b]) b++; this.doc.transact(() => { if (old.length - a - b) t.delete(a, old.length - a - b); if (now.length - a - b) t.insert(a, now.slice(a, now.length - b)); }); }
    boardJson(e) { const nodes = {}, edges = {}; e.get("nodes").forEach((m, id) => { nodes[id] = { x: m.get("x"), y: m.get("y"), w: m.get("w"), h: m.get("h"), color: m.get("color") || "", text: m.get("text") ? m.get("text").toString() : "" }; }); e.get("edges").forEach((m, id) => { edges[id] = { a: m.get("a"), b: m.get("b"), label: m.get("label") || "" }; }); return JSON.stringify({ v: 3, nodes, edges }, null, 1); }
    toDisk(rel) { if (this.skip(rel)) return; clearTimeout(this.timers.get(rel)); this.timers.set(rel, setTimeout(() => this.toDiskNow(rel), 400)); }
    async toDiskNow(rel) {
      const ad = app.vault.adapter, p = this.abs(rel), e = this.files.get(rel); this.written.set(rel, Date.now());
      try {
        if (!e) { const f = app.vault.getAbstractFileByPath(p); if (f) { try { await app.vault.trash(f, true); } catch (er) { await ad.remove(p); } } return; }
        const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ""; if (dir && !(await ad.exists(dir))) await ad.mkdir(dir);
        const t = e.get("t");
        if (t === "board") { const s = this.boardJson(e); let cur = null; try { cur = await ad.read(p); } catch (er) { /* none */ } if (cur !== s) await ad.write(p, s); }
        else if (t === "text") { const s = e.get("text").toString(); let cur = null; try { cur = await ad.read(p); } catch (er) { /* none */ } if (cur !== s) await ad.write(p, s); }
        else if (t === "bin") { const u = unb64(e.get("data")); let same = false; try { const c = new Uint8Array(await ad.readBinary(p)); same = c.length === u.length && c.every((x, i) => x === u[i]); } catch (er) { /* none */ } if (!same) await ad.writeBinary(p, u.buffer); }
      } catch (er) { console.error("share write", rel, er); }
      this.written.set(rel, Date.now());
    }
    vaultEvent(type, f, old) {
      const rel = this.rel(f.path); const orel = old ? this.rel(old) : null; if (f.children) return;
      if (type === "rename") { if (orel && !this.skip(orel) && this.files.has(orel)) { this.doc.transact(() => this.files.delete(orel)); } if (rel && !this.skip(rel)) this.fromDisk(rel); return; }
      if (rel == null || this.skip(rel)) return;
      if (Date.now() - (this.written.get(rel) || 0) < 1500) return;
      if (type === "delete") { if (this.files.has(rel)) this.doc.transact(() => this.files.delete(rel)); return; }
      if (this.isBoard(rel) && this.files.has(rel)) return;
      this.fromDisk(rel);
    }
    queueSave() { clearTimeout(this.saveT); this.saveT = setTimeout(() => this.save(), 800); }
    async save() { const Y = window.__bsY.Y; try { await app.vault.adapter.write(this.abs(STATE), JSON.stringify({ room: this.room, pass: this.pass, state: b64(Y.encodeStateAsUpdate(this.doc)) })); } catch (e) { /* ignore */ } }
    stop() { clearTimeout(this.saveT); for (const ev of this.evs || []) app.vault.offref(ev); if (this.prov) this.prov.destroy(); }
    code() { return "basalt-share:" + this.room + ":" + this.pass + ":" + encodeURIComponent(this.folder ? this.folder.split("/").pop() : (app.vault.getName ? app.vault.getName() : "Общая папка")); }
  }

  const store = () => { try { return JSON.parse(localStorage.getItem("basalt-shares:" + app.vault.getName()) || "[]"); } catch (e) { return []; } };
  const setStore = (a) => { try { localStorage.setItem("basalt-shares:" + app.vault.getName(), JSON.stringify(a)); } catch (e) { /* private */ } };
  async function begin(folder, room, pass) { const key = folder === "/" ? "" : folder; if (shares.has(key)) return shares.get(key); const s = new Share(folder, room, pass); shares.set(key, s); await s.start(); const l = store().filter((x) => x.folder !== key); l.push({ folder: key, room, pass }); setStore(l); return s; }
  async function host(folder) { const key = folder === "/" ? "" : folder; return shares.get(key) || begin(folder, uid() + uid(), uid() + uid()); }
  async function stop(folder) { const key = folder === "/" ? "" : folder; const s = shares.get(key); if (!s) return; s.stop(); shares.delete(key); setStore(store().filter((x) => x.folder !== key)); }
  function forPath(path) { let best = null; for (const [k, s] of shares) { if (k === "" || path.startsWith(k + "/")) if (!best || k.length > best.folder.length) best = s; } return best; }

  async function dialog(folder) {
    const s = await host(folder); const M = new window.__bsApi.Modal(app); M.titleEl.setText("Общая папка: " + (s.folder || "весь vault")); const c = M.contentEl;
    c.createEl("p", { text: "Вся папка (заметки, доски, файлы) синхронизируется между всеми, кто введёт этот код. У каждого полная копия: если ваш компьютер выключится, остальные продолжат работать и смогут приглашать новых людей." });
    const i = c.createEl("input", { attr: { readonly: "true", style: "width:100%" } }); i.value = s.code(); i.onfocus = () => i.select();
    c.createEl("p", { text: "Серверы сигнализации (через запятую; нужны только чтобы участники нашли друг друга):" }); const sg = c.createEl("input", { attr: { style: "width:100%" } }); sg.value = signaling().join(", "); sg.onchange = () => { try { localStorage.setItem("board-signaling", JSON.stringify(sg.value.split(",").map((x) => x.trim()).filter(Boolean))); } catch (e) { /* private */ } };
    c.createEl("p", { text: "Ваше имя:" }); const n = c.createEl("input", { attr: { style: "width:100%" } }); n.value = me().name; n.onchange = () => { const m = me(); m.name = n.value || m.name; try { localStorage.setItem("board-me", JSON.stringify(m)); } catch (e) { /* private */ } s.publish(); };
    const row = c.createDiv({ attr: { style: "margin-top:14px;display:flex;justify-content:flex-end" } }); const st = row.createEl("button", { text: "Прекратить обмен" }); st.onclick = async () => { await stop(folder); M.close(); };
    M.open();
  }
  async function joinDialog() {
    const M = new window.__bsApi.Modal(app); M.titleEl.setText("Подключиться к общей папке"); const c = M.contentEl; const i = c.createEl("input", { attr: { style: "width:100%", placeholder: "basalt-share:…" } });
    const row = c.createDiv({ attr: { style: "margin-top:12px;display:flex;justify-content:flex-end" } }); const ok = row.createEl("button", { text: "Подключиться", cls: "mod-cta" });
    ok.onclick = async () => { const m = /^basalt-share:([^:]+):([^:]+):?(.*)$/.exec(i.value.trim()); if (!m) { new window.__bsApi.Notice("Неверный код"); return; } M.close(); const name = decodeURIComponent(m[3] || "Общая папка") || "Общая папка"; let n = name, k = 1; while (await app.vault.adapter.exists(n)) n = name + " " + ++k; await app.vault.adapter.mkdir(n); await begin(n, m[1], m[2]); new window.__bsApi.Notice("Подключено: «" + n + "»"); };
    i.onkeydown = (e) => { if (e.key === "Enter") ok.click(); }; M.open(); setTimeout(() => i.focus(), 50);
  }

  const t = setInterval(() => {
    if (!window.app || !app.workspace || !app.workspace.layoutReady || !app.commands || !window.__bsApi || !window.__bsY || !app.vault) return;
    clearInterval(t);
    app.commands.addCommand({ id: "basalt:share-folder", name: "Общая папка: поделиться этой папкой", icon: "lucide-users", callback: () => { const f = app.workspace.getActiveFile(); dialog(f && f.parent ? f.parent.path : "/"); } });
    app.commands.addCommand({ id: "basalt:share-vault", name: "Общая папка: поделиться всем vault", icon: "lucide-users", callback: () => dialog("/") });
    app.commands.addCommand({ id: "basalt:share-join", name: "Общая папка: подключиться по коду", icon: "lucide-user-plus", callback: joinDialog });
    app.workspace.on("file-menu", (menu, f) => { if (f && f.children) menu.addItem((i) => i.setTitle(shares.has(f.path === "/" ? "" : f.path) ? "Общая папка…" : "Поделиться папкой…").setIcon("lucide-users").onClick(() => dialog(f.path))); });
    const menu = (e) => {
      const m = new window.__bsApi.Menu(), it = (t, ic, fn) => m.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn)), f = app.workspace.getActiveFile(), dir = f && f.parent && f.parent.path !== "/" ? f.parent.path : null;
      it("Поделиться всем vault", "lucide-share-2", () => dialog("/"));
      if (dir) it("Поделиться папкой «" + dir.split("/").pop() + "»", "lucide-folder-up", () => dialog(dir));
      it("Подключиться по коду", "lucide-user-plus", joinDialog);
      if (shares.size) { m.addSeparator(); for (const [k, s] of shares) it("Открыть: " + (k ? k.split("/").pop() : "весь vault") + (s.peers.length ? " · " + (s.peers.length + 1) + " чел." : ""), "lucide-users", () => dialog(k || "/")); }
      if (e && e.clientX != null) m.showAtMouseEvent(e); else m.showAtPosition({ x: 56, y: 240 });
    };
    try { app.workspace.leftRibbon.addRibbonItemButton("basalt:share", "lucide-users", "Совместная работа", menu); } catch (e) { /* no ribbon */ }
    window.__bsShare = { forPath, host, stop, dialog, join: joinDialog, begin, shares };
    Promise.all(store().map((x) => begin(x.folder || "/", x.room, x.pass).catch((e) => console.error(e)))).then(resolveReady, resolveReady);
  }, 600);
})();
