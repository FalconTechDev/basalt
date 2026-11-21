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
  const signaling = () => { try { const j = JSON.parse(localStorage.getItem("board-signaling") || "null"); if (Array.isArray(j) && j.length) return j; } catch (e) { /* default */ } return []; };
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
      const L = window.__bsY; this.prov = new L.TrysteroProvider("basalt-share-" + this.room, this.doc, { password: this.pass || undefined, relayUrls: signaling() }); this.prov.onStatus(() => document.dispatchEvent(new CustomEvent("basalt-share-peers", { detail: this })));
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

  const ipc = () => (window.electron && window.electron.ipcRenderer) || null;
  const nodeReq = (m) => { try { return window.require(m); } catch (e) { return null; } };
  const baseName = (p) => String(p || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  const initial = (n) => (String(n || "?").trim()[0] || "?").toUpperCase();
  const where = (u) => (u.board ? "доска «" + u.board.replace(/^.*\//, "").replace(/\.board$/, "") + "»" : u.file ? "«" + u.file.replace(/^.*\//, "").replace(/\.md$/, "") + "»" : "в сети");
  function otherVaults() {
    const out = [], r = ipc(), fs = nodeReq("fs"), pa = nodeReq("path"); if (!r || !fs || !pa) return out;
    let list = {}; try { list = r.sendSync("vault-list") || {}; } catch (e) { return out; }
    const here = (app.vault.adapter.getBasePath ? app.vault.adapter.getBasePath() : "").toLowerCase();
    for (const v of Object.values(list)) { if (!v || !v.path || v.path.toLowerCase() === here) continue; try { const st = JSON.parse(fs.readFileSync(pa.join(v.path, STATE), "utf8")); if (st && st.room) out.push({ path: v.path, name: baseName(v.path), room: st.room, pass: st.pass }); } catch (e) { /* not shared */ } }
    return out;
  }
  async function joinCode(code) {
    const m = /^basalt-share:([^:]+):([^:]+):?(.*)$/.exec(String(code || "").trim()); if (!m) { new window.__bsApi.Notice("Неверный код приглашения"); return false; }
    const fs = nodeReq("fs"), pa = nodeReq("path"), r = ipc(); if (!fs || !pa || !r) { new window.__bsApi.Notice("Не удалось создать хранилище"); return false; }
    const name = (decodeURIComponent(m[3] || "") || "Общий проект").replace(/[\\/:*?"<>|]/g, "_"); let dir = r.sendSync("get-default-vault-path"); dir = pa.join(pa.dirname(dir), "Basalt shared"); fs.mkdirSync(dir, { recursive: true });
    let target = pa.join(dir, name), k = 1; while (fs.existsSync(target)) target = pa.join(dir, name + " " + ++k);
    fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(pa.join(target, STATE), JSON.stringify({ room: m[1], pass: m[2], state: "" }));
    new window.__bsApi.Notice("Открываю проект «" + baseName(target) + "»…"); r.sendSync("vault-open", target, false); return true;
  }
  // ---- the "Совместная работа" window: two big choices (share / join); each opens its own simple screen inside the same window
  let panelEl = null;
  function panel() {
    if (panelEl) { panelEl.close(); return; }
    const api = window.__bsApi, M = new api.Modal(app); panelEl = M; M.modalEl.classList.add("bsm"); M.titleEl.setText("Совместная работа"); const root = M.contentEl; root.classList.add("bsm-root");
    const copy = (t) => { try { navigator.clipboard.writeText(t); new api.Notice("Скопировано"); } catch (e) { /* none */ } };
    let tickFn = null, screen = null;
    const show = (name, build) => { screen = name; tickFn = null; root.empty(); const v = root.createDiv({ cls: "bsm-view" }); build(v); };
    const back = (v, title) => { const h = v.createDiv({ cls: "bsm-head" }); const b = h.createDiv({ cls: "bsm-back", attr: { title: "Назад" } }); api.setIcon(b, "lucide-arrow-left"); b.onclick = home; h.createDiv({ cls: "bsm-ttl", text: title }); };
    const statusText = () => { const all = Array.from(shares.values()), n = all.reduce((a, s) => a + s.peers.length, 0), searching = all.some((s) => s.prov && s.prov.status === "connecting"); return { all, n, searching }; };

    // ----- home
    function home() {
      show("home", (v) => {
        const tiles = v.createDiv({ cls: "bsm-tiles" });
        const tile = (icon, t, s, fn) => { const x = tiles.createDiv({ cls: "bsm-tile" }); const i = x.createDiv({ cls: "bsm-ti" }); api.setIcon(i, icon); x.createDiv({ cls: "bsm-tt", text: t }); x.createDiv({ cls: "bsm-ts", text: s }); x.onclick = fn; };
        tile("lucide-share-2", "Поделиться", "хранилищем или папкой", shareScreen);
        tile("lucide-log-in", "Присоединиться", "по коду приглашения", joinScreen);
        const now = v.createDiv({ cls: "bsm-now" }); const line = now.createDiv({ cls: "bsm-line" }); const dot = line.createSpan({ cls: "bsm-dot" }); const lt = line.createSpan(); const who = now.createDiv({ cls: "bsm-who" }); const projs = now.createDiv({ cls: "bsm-projs" });
        let sigP = "";
        tickFn = () => {
          const { all, n, searching } = statusText();
          now.style.display = all.length ? "" : "none"; dot.className = "bsm-dot " + (n ? "is-live" : searching ? "is-wait" : "");
          const t = n ? "Онлайн: " + (n + 1) : searching ? "Поиск участников…" : "Вы один в сети"; if (lt.textContent !== t) lt.textContent = t;
          const names = [me().name + " (вы)"].concat(Array.from(new Set(all.flatMap((s) => s.peers.map((p) => p.name + (p.board || p.file ? " — " + where(p) : "")))))).join("\n"); if (who.textContent !== names) who.textContent = names; who.style.display = n ? "" : "none";
          const sp = all.map((s) => (s.folder || "/") + "|" + s.peers.length + "|" + (s.prov ? s.prov.status : "")).join(";");
          if (sp !== sigP) { sigP = sp; projs.empty(); for (const s of all) { const r = projs.createDiv({ cls: "bsm-pr" }); r.createSpan({ text: s.folder ? s.folder.split("/").pop() : app.vault.getName() }); r.createSpan({ cls: "bsm-prs", text: s.peers.length ? "онлайн: " + (s.peers.length + 1) : s.prov && s.prov.status === "connecting" ? "поиск…" : "один" }); } }
        };
        tickFn();
        const set = v.createEl("details", { cls: "bsm-set" }); set.createEl("summary", { text: "Имя и серверы" });
        set.createEl("label", { text: "Ваше имя" }); const nm = set.createEl("input"); nm.value = me().name; nm.onchange = () => { const m2 = me(); m2.name = nm.value.trim() || m2.name; try { localStorage.setItem("board-me", JSON.stringify(m2)); } catch (e) { /* private */ } for (const sh of shares.values()) sh.publish(); };
        set.createEl("label", { text: "Свои relay-серверы Nostr, через запятую (необязательно)" }); const sg = set.createEl("input"); sg.value = signaling().join(", "); sg.onchange = () => { try { localStorage.setItem("board-signaling", JSON.stringify(sg.value.split(",").map((x) => x.trim()).filter(Boolean))); } catch (e) { /* private */ } };
      });
    }
    // ----- share
    function shareScreen() {
      show("share", (v) => {
        back(v, "Поделиться");
        const list = v.createDiv({ cls: "bsm-codes" }), opts = v.createDiv({ cls: "bsm-opts" });
        let sig = "";
        const draw = () => {
          const f = app.workspace.getActiveFile(), dir = f && f.parent && f.parent.path !== "/" ? f.parent.path : null, s2 = Array.from(shares.keys()).join("|") + "#" + (dir || "");
          if (s2 === sig) return; sig = s2; list.empty(); opts.empty();
          for (const [k, sh] of shares) {
            const c = list.createDiv({ cls: "bsm-code" }); c.createDiv({ cls: "bsm-cn", text: (k ? k.split("/").pop() : app.vault.getName()) + (k ? " (папка)" : " (всё хранилище)") });
            const row = c.createDiv({ cls: "bsm-crow" }); const i = row.createEl("input", { attr: { readonly: "true" } }); i.value = sh.code(); i.onfocus = () => i.select();
            const b = row.createEl("button", { text: "Копировать", cls: "mod-cta" }); b.onclick = () => copy(sh.code());
            const st = row.createEl("button", { text: "Прекратить" }); st.onclick = async () => { await stop(k || "/"); sig = ""; draw(); };
          }
          if (!shares.has("")) { const b = opts.createDiv({ cls: "bsm-opt" }); const ic = b.createSpan({ cls: "bsm-oi" }); api.setIcon(ic, "lucide-box"); b.createSpan({ text: "Всё хранилище «" + app.vault.getName() + "»" }); b.onclick = async () => { await host("/"); sig = ""; draw(); }; }
          if (dir && !shares.has(dir)) { const b = opts.createDiv({ cls: "bsm-opt" }); const ic = b.createSpan({ cls: "bsm-oi" }); api.setIcon(ic, "lucide-folder"); b.createSpan({ text: "Папка «" + dir.split("/").pop() + "»" }); b.onclick = async () => { await host(dir); sig = ""; draw(); }; }
          if (!list.children.length && !opts.children.length) opts.createDiv({ cls: "bsm-hint", text: "Открыта заметка в папке — тогда можно поделиться и только этой папкой." });
          if (!list.children.length) opts.insertBefore(Object.assign(document.createElement("div"), { className: "bsm-hint", textContent: "Выберите, чем поделиться. После этого появится код — отправьте его тем, кто будет работать вместе с вами." }), opts.firstChild);
        };
        draw();
      });
    }
    // ----- join
    function joinScreen() {
      show("join", (v) => {
        back(v, "Присоединиться");
        v.createDiv({ cls: "bsm-hint", text: "Вставьте код приглашения. Проект откроется отдельным хранилищем в новом окне." });
        const row = v.createDiv({ cls: "bsm-crow" }); const inp = row.createEl("input", { attr: { placeholder: "basalt-share:…" } }); const go = row.createEl("button", { text: "Войти", cls: "mod-cta" });
        go.onclick = async () => { if (await joinCode(inp.value)) M.close(); }; inp.onkeydown = (e) => { if (e.key === "Enter") go.click(); }; setTimeout(() => inp.focus(), 60);
        const others = otherVaults();
        if (others.length) { v.createDiv({ cls: "bsm-sub", text: "Уже подключённые проекты" }); for (const o of others) { const r = v.createDiv({ cls: "bsm-opt" }); const ic = r.createSpan({ cls: "bsm-oi" }); api.setIcon(ic, "lucide-box"); r.createSpan({ text: o.name }); r.onclick = () => { const rr = ipc(); if (rr) rr.sendSync("vault-open", o.path, false); }; } }
      });
    }
    const iv = setInterval(() => { if (tickFn) tickFn(); }, 1500); document.addEventListener("basalt-share-peers", () => { if (tickFn) tickFn(); });
    M.onClose = () => { clearInterval(iv); panelEl = null; };
    home(); M.open();
  }
  async function togglePanel() { panel(); }
  async function dialog() { panel(); }
  const joinDialog = panel;

  const t = setInterval(() => {
    if (!window.app || !app.workspace || !app.workspace.layoutReady || !app.commands || !window.__bsApi || !window.__bsY || !app.vault) return;
    clearInterval(t);
    app.commands.addCommand({ id: "basalt:share-folder", name: "Общая папка: поделиться этой папкой", icon: "lucide-users", callback: () => panel() });
    app.commands.addCommand({ id: "basalt:share-vault", name: "Общая папка: поделиться всем vault", icon: "lucide-users", callback: () => panel() });
    app.commands.addCommand({ id: "basalt:share-join", name: "Общая папка: подключиться по коду", icon: "lucide-user-plus", callback: () => panel() });
    app.workspace.on("file-menu", (menu, f) => { if (f && f.children) menu.addItem((i) => i.setTitle(shares.has(f.path === "/" ? "" : f.path) ? "Общая папка…" : "Поделиться папкой…").setIcon("lucide-users").onClick(() => dialog(f.path))); });
    try { app.workspace.leftRibbon.addRibbonItemButton("basalt:share", "lucide-users", "Совместная работа", () => togglePanel()); } catch (e) { /* no ribbon */ }
    if (app.statusBar && app.statusBar.registerStatusBarItem) {
      const chip = app.statusBar.registerStatusBarItem(); chip.classList.add("bsh-chip"); chip.style.display = "none";
      const upd = () => { const all = Array.from(shares.values()); if (!all.length) { chip.style.display = "none"; return; } const n = all.reduce((a, s) => a + s.peers.length, 0), st = all.some((s) => s.prov && s.prov.status === "connecting"); chip.style.display = ""; chip.classList.toggle("is-searching", st && !n); chip.classList.toggle("is-live", n > 0); chip.textContent = ""; const d = document.createElement("span"); d.className = "bsh-dot"; chip.append(d, n ? "Онлайн: " + (n + 1) : st ? "Поиск участников…" : "Один в сети"); chip.title = all.map((s) => (s.folder || "весь vault") + ": " + (s.peers.length ? s.peers.map((p) => p.name).join(", ") : "никого рядом")).join(String.fromCharCode(10)); };
      document.addEventListener("basalt-share-peers", upd); setInterval(upd, 2000); upd();
    }
    const pubFile = () => { const f = app.workspace.getActiveFile(); for (const sh of shares.values()) { const r = f ? sh.rel(f.path) : null; sh.publish({ file: r && !/\.board$/.test(r) ? r : null }); } };
    app.workspace.on("file-open", pubFile); app.workspace.on("active-leaf-change", pubFile);
    window.__bsShare = { forPath, host, stop, dialog, join: joinDialog, begin, shares };
    (async () => { try { const st = JSON.parse(await app.vault.adapter.read(STATE)); if (st && st.room && !shares.has("")) await begin("/", st.room, st.pass); } catch (e) { /* not a shared vault */ } })().then(() => Promise.all(store().filter((x) => !shares.has(x.folder || "")).map((x) => begin(x.folder || "/", x.room, x.pass).catch((e) => console.error(e))))).then(resolveReady, resolveReady);
  }, 600);
})();
