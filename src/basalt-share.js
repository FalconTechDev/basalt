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
    constructor(folder, room, pass, opts = {}) {
      this.owner = !!opts.owner; this.pendingList = []; this.ready = false;
      this.folder = folder === "/" ? "" : folder; this.room = room; this.pass = pass; const Y = window.__bsY.Y;
      this.doc = new Y.Doc(); this.files = this.doc.getMap("files"); this.meta = this.doc.getMap("meta"); this.log = this.doc.getArray("log"); this.written = new Map(); this.q = new Set(); this.total = 0; this.done = 0; this.pumping = false; this.activity = []; this.lastRemote = new Map(); this.timers = new Map(); this.saveT = 0; this.peers = [];
    }
    get readOnly() { const r = this.meta.get("roles"), id = this.prov && this.prov.selfUserId; return !!(r && id && r.get && r.get(id) === "view"); }
    roleOf(uid) { const r = this.meta.get("roles"); return (r && uid && r.get && r.get(uid)) || "edit"; }
    canWrite(uid) { if (uid && uid === this.meta.get("owner")) return true; const x = this.roleOf(uid); return x !== "view" && x !== "banned"; }
    setRole(uid, role) { if (!this.owner || !uid) return; const Y = window.__bsY.Y; this.doc.transact(() => { let r = this.meta.get("roles"); if (!r) { r = new Y.Map(); this.meta.set("roles", r); } r.set(uid, role); }); if (this.prov) this.prov.recheck(); this.ping(); }
    setDefaultRole(role) { if (this.owner) this.meta.set("defaultRole", role === "view" ? "view" : "edit"); }
    assignRoles() {
      if (!this.owner || !this.prov) return; const Y = window.__bsY.Y, def = this.meta.get("defaultRole") === "view" ? "view" : "edit"; let r = this.meta.get("roles"); const need = [];
      for (const i of this.prov.peers.values()) if (i.userId && !(r && r.get(i.userId))) need.push(i.userId);
      if (!need.length) return; this.doc.transact(() => { if (!r) { r = new Y.Map(); this.meta.set("roles", r); } for (const u of need) r.set(u, def); });
    }
    okPeer(uid) {
      if (this.roleOf(uid) === "banned") return false;
      if (!this.meta.get("approval")) return true; if (uid && uid === this.meta.get("owner")) return true;
      const al = this.meta.get("allowed"); return !!(al && al.get && uid && al.get(uid));
    }
    onPending(pid, uid) {
      if (this.pendingList.some((r) => r.pid === pid)) return; this.pendingList.push({ pid, uid, t: Date.now() }); this.ping();
      if (!this.owner) return;
      const frag = document.createDocumentFragment(), t = document.createElement("div"); t.textContent = "Кто-то хочет войти в «" + (this.folder ? this.folder.split("/").pop() : app.vault.getName()) + "»"; frag.appendChild(t);
      const row = document.createElement("div"); row.style.cssText = "display:flex;gap:6px;margin-top:6px"; const a = document.createElement("button"), d = document.createElement("button"); a.textContent = "Принять"; d.textContent = "Отклонить"; a.className = "mod-cta"; row.append(a, d); frag.appendChild(row);
      const n = new window.__bsApi.Notice(frag, 0); (this.notices = this.notices || new Map()).set(pid, n); a.onclick = () => { this.approve(pid, uid); try { n.hide(); } catch (e) { /* ignore */ } }; d.onclick = () => { this.pendingList = this.pendingList.filter((r) => r.pid !== pid); this.ping(); try { n.hide(); } catch (e) { /* ignore */ } };
    }
    approve(pid, uid) {
      const Y = window.__bsY.Y; this.doc.transact(() => { let al = this.meta.get("allowed"); if (!al) { al = new Y.Map(); this.meta.set("allowed", al); } al.set(uid, true); });
      this.pendingList = this.pendingList.filter((r) => r.pid !== pid); if (this.prov) this.prov.admit(pid); try { const n = this.notices && this.notices.get(pid); if (n) n.hide(); } catch (e) { /* ignore */ } this.ping();
    }
    setApproval(on) { this.meta.set("approval", !!on); }
    addLog(kind, rel, before) {
      if (!this.ready) return; const who = me().name, now = Date.now(), n = this.log.length, last = n ? this.log.get(n - 1) : null;
      if (last && last.rel === rel && last.who === who && last.kind === kind && now - last.t < 60000) { const keep = last.before; this.doc.transact(() => { this.log.delete(n - 1, 1); this.log.push([Object.assign({}, last, { t: now, before: keep })]); }); return; }
      const e = { t: now, who, rel, kind }; if (before != null && before.length < 30000) e.before = before; this.doc.transact(() => { this.log.push([e]); if (this.log.length > 300) this.log.delete(0, this.log.length - 300); });
    }
    rollback(e) {
      const en = this.files.get(e.rel); if (!en || en.get("t") !== "text" || e.before == null) return false; const t = en.get("text"), cur = t.toString(); if (cur === e.before) return true;
      this.diff(t, cur, e.before); this.addLog("rollback", e.rel, cur); return true;
    }
    abs(rel) { return join(this.folder, rel); }
    rel(path) { return this.folder ? (path.startsWith(this.folder + "/") ? path.slice(this.folder.length + 1) : null) : path; }
    skip(rel) { return !rel || rel.split("/").some((p) => p.startsWith(".")); }
    async start() {
      const Y = window.__bsY.Y, ad = app.vault.adapter; let st = null;
      try { st = JSON.parse(await ad.read(this.abs(STATE))); } catch (e) { /* first time */ }
      if (st && st.state) Y.applyUpdate(this.doc, unb64(st.state));
      if (st && st.owner) this.owner = true;
      this.joining = !!(st && st.room && !st.state);
      await this.scan();
      if (this.joining && this.files.size === 0) loadingCard(this); else this.joining = false;
      this.files.observeDeep((evs) => {
        for (const ev of evs) {
          const remote = !!(this.prov && ev.transaction.origin === this.prov), keys = ev.path.length === 0 ? Array.from(ev.keysChanged) : [ev.path[0]];
          for (const k of keys) { this.toDisk(k); if (remote) this.noteRemote(k); }
        }
        this.queueSave();
      });
      this.doc.on("update", () => this.queueSave());
      const L = window.__bsY; this.prov = new L.TrysteroProvider("basalt-share-" + this.room, this.doc, { password: this.pass || undefined, relayUrls: signaling(), isReadOnly: () => this.readOnly, canWrite: (uid) => this.canWrite(uid), ok: (pid, uid) => this.okPeer(uid), onPending: (pid, uid) => this.onPending(pid, uid) }); this.prov.onStatus(() => document.dispatchEvent(new CustomEvent("basalt-share-peers", { detail: this })));
      this.aw = this.prov.awareness; this.publish();
      this.aw.on("change", () => { this.peers = Array.from(this.aw.getStates().entries()).filter(([id]) => id !== this.aw.clientID).map(([, s]) => s.user).filter(Boolean); document.dispatchEvent(new CustomEvent("basalt-share-peers", { detail: this })); });
      this.meta.observeDeep(() => { if (this.prov) { this.prov.recheck(); this.assignRoles(); } this.ping(); });
      this.prov.onStatus(() => this.assignRoles());
      { const t1 = setInterval(() => { if (this.stopped) return clearInterval(t1); if (this.prov && this.prov.selfUserId) { clearInterval(t1); this.publish(); } }, 400); }
      if (this.owner) { const t0 = setInterval(() => { if (this.stopped) return clearInterval(t0); if (this.prov && this.prov.selfUserId) { clearInterval(t0); if (this.meta.get("owner") !== this.prov.selfUserId) this.meta.set("owner", this.prov.selfUserId); } }, 400); }
      this.onVault = (type) => (f, old) => this.vaultEvent(type, f, old);
      this.evs = ["create", "modify", "delete", "rename"].map((t) => app.vault.on(t, this.onVault(t)));
      this.queueSave(); this.ready = true;
    }
    publish(extra) { if (!this.aw) return; if (extra) this.extra = Object.assign(this.extra || {}, extra); const m = me(); this.aw.setLocalStateField("user", Object.assign({ name: m.name, color: m.color, uid: (this.prov && this.prov.selfUserId) || undefined }, this.extra || {})); }
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
      const Y = window.__bsY.Y, ad = app.vault.adapter, p = this.abs(rel); if (this.skip(rel) || this.readOnly) return;
      let e = this.files.get(rel);
      try {
        if (this.isBoard(rel)) {
          if (e) return; let j = {}; try { j = JSON.parse(await ad.read(p)); } catch (er) { j = {}; }
          const m = new Y.Map(), nodes = new Y.Map(), edges = new Y.Map();
          this.doc.transact(() => { if (this.files.get(rel)) return; for (const [id, n] of Object.entries(j.nodes || {})) { const c = new Y.Map(), t = new Y.Text(); t.insert(0, n.text || ""); c.set("x", n.x || 0); c.set("y", n.y || 0); c.set("w", n.w || 260); c.set("h", n.h || 110); c.set("color", n.color || ""); c.set("text", t); nodes.set(id, c); } for (const [id, ed] of Object.entries(j.edges || {})) { const c = new Y.Map(); c.set("a", ed.a); c.set("b", ed.b); c.set("label", ed.label || ""); edges.set(id, c); } m.set("t", "board"); m.set("nodes", nodes); m.set("edges", edges); this.files.set(rel, m); });
        } else if (TEXT.test(rel)) {
          const txt = await ad.read(p);
          if (!e || e.get("t") !== "text") { const m = new Y.Map(), t = new Y.Text(); t.insert(0, txt); m.set("t", "text"); m.set("text", t); this.files.set(rel, m); if (!e) this.addLog("create", rel); }
          else { const t = e.get("text"), old = t.toString(); if (old !== txt) { this.addLog("edit", rel, old); this.diff(t, old, txt); } }
        } else {
          const buf = await ad.readBinary(p); if (buf.byteLength > MAXBIN) return; const d = b64(new Uint8Array(buf));
          if (!e || e.get("data") !== d) { const m = new Y.Map(); m.set("t", "bin"); m.set("data", d); this.files.set(rel, m); }
        }
      } catch (er) { console.error("share read", rel, er); }
    }
    diff(t, old, now) { let a = 0; while (a < old.length && a < now.length && old[a] === now[a]) a++; let b = 0; while (b < old.length - a && b < now.length - a && old[old.length - 1 - b] === now[now.length - 1 - b]) b++; this.doc.transact(() => { if (old.length - a - b) t.delete(a, old.length - a - b); if (now.length - a - b) t.insert(a, now.slice(a, now.length - b)); }); }
    boardJson(e) { const nodes = {}, edges = {}; e.get("nodes").forEach((m, id) => { nodes[id] = { x: m.get("x"), y: m.get("y"), w: m.get("w"), h: m.get("h"), color: m.get("color") || "", text: m.get("text") ? m.get("text").toString() : "" }; }); e.get("edges").forEach((m, id) => { edges[id] = { a: m.get("a"), b: m.get("b"), label: m.get("label") || "" }; }); return JSON.stringify({ v: 3, nodes, edges }, null, 1); }
    noteRemote(rel) {
      if (this.skip(rel)) return; this.lastRemote.set(rel, Date.now());
      const who = this.peers.filter((u) => u.file === rel || u.board === rel).map((u) => u.name); const e = this.activity[0];
      if (e && e.rel === rel && Date.now() - e.t < 4000) { e.t = Date.now(); return; }
      this.activity.unshift({ t: Date.now(), rel, who: who.length ? who.join(", ") : "Кто-то" }); if (this.activity.length > 30) this.activity.pop();
    }
    toDisk(rel) { if (this.skip(rel)) return; this.q.add(rel); this.total = Math.max(this.total, this.done + this.q.size); this.pump(); }
    async pump() {
      if (this.pumping) return; this.pumping = true; await new Promise((r) => setTimeout(r, 150));
      try { while (this.q.size) { const rel = this.q.values().next().value; this.q.delete(rel); await this.toDiskNow(rel); this.done++; this.ping(); if (this.joining || this.q.size > 6) await new Promise((r) => setTimeout(r, 40)); } }
      finally { this.pumping = false; if (!this.q.size) { this.total = 0; this.done = 0; } this.ping(); }
    }
    ping() { document.dispatchEvent(new CustomEvent("basalt-share-peers", { detail: this })); }
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
      const rel = this.rel(f.path); const orel = old ? this.rel(old) : null; if (f.children || this.readOnly) return;
      if (type === "rename") { if (orel && !this.skip(orel) && this.files.has(orel)) { this.doc.transact(() => this.files.delete(orel)); } if (rel && !this.skip(rel)) this.fromDisk(rel); return; }
      if (rel == null || this.skip(rel)) return;
      if (Date.now() - (this.written.get(rel) || 0) < 1500) return;
      if (this.readOnly) return;
      if (type === "delete") { if (this.files.has(rel)) { this.addLog("delete", rel); this.doc.transact(() => this.files.delete(rel)); } return; }
      if (this.isBoard(rel) && this.files.has(rel)) return;
      this.fromDisk(rel);
    }
    queueSave() { clearTimeout(this.saveT); this.saveT = setTimeout(() => this.save(), 800); }
    async save() { const Y = window.__bsY.Y; try { await app.vault.adapter.write(this.abs(STATE), JSON.stringify({ room: this.room, pass: this.pass, owner: this.owner || undefined, state: b64(Y.encodeStateAsUpdate(this.doc)) })); } catch (e) { /* ignore */ } }
    stop() { this.stopped = true; clearTimeout(this.saveT); for (const ev of this.evs || []) app.vault.offref(ev); if (this.prov) this.prov.destroy(); }
    code() { return "basalt-share:" + this.room + ":" + this.pass + ":" + encodeURIComponent(this.folder ? this.folder.split("/").pop() : (app.vault.getName ? app.vault.getName() : "Общая папка")) ; }
  }

  const store = () => { try { return JSON.parse(localStorage.getItem("basalt-shares:" + app.vault.getName()) || "[]"); } catch (e) { return []; } };
  const setStore = (a) => { try { localStorage.setItem("basalt-shares:" + app.vault.getName(), JSON.stringify(a)); } catch (e) { /* private */ } };
  async function begin(folder, room, pass, opts) { const key = folder === "/" ? "" : folder; if (shares.has(key)) return shares.get(key); const s = new Share(folder, room, pass, opts || {}); shares.set(key, s); await s.start(); const l = store().filter((x) => x.folder !== key); l.push({ folder: key, room, pass, owner: !!(opts && opts.owner) }); setStore(l); return s; }
  async function host(folder) { const key = folder === "/" ? "" : folder; return shares.get(key) || begin(folder, uid() + uid(), uid() + uid(), { owner: true }); }
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
  // open another vault and close this window, so the project takes the place of the current one
  function switchTo(target) {
    const r = ipc(); if (!r) return false; let res = ""; try { res = r.sendSync("vault-open", target, false); } catch (e) { res = String(e); }
    if (res) { new window.__bsApi.Notice(String(res)); return false; }
    setTimeout(() => { try { window.onbeforeunload = null; app.workspace.saveLayout && app.workspace.saveLayout(); } catch (e) { /* ignore */ } try { window.close(); } catch (e) { /* ignore */ } }, 1400); return true;
  }
  async function joinCode(code) {
    const m = /^basalt-share:([^:]+):([^:]+):?([^:]*):?(.*)$/.exec(String(code || "").trim()); if (!m) { new window.__bsApi.Notice("Неверный код приглашения"); return false; }
    const fs = nodeReq("fs"), pa = nodeReq("path"), r = ipc(); if (!fs || !pa || !r) { new window.__bsApi.Notice("Не удалось создать хранилище"); return false; }
    const name = (decodeURIComponent(m[3] || "") || "Общий проект").replace(/[\\/:*?"<>|]/g, "_"); let dir = r.sendSync("get-default-vault-path"); dir = pa.join(pa.dirname(dir), "Basalt shared"); fs.mkdirSync(dir, { recursive: true });
    let target = pa.join(dir, name), k = 1; while (fs.existsSync(target)) target = pa.join(dir, name + " " + ++k);
    fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(pa.join(target, STATE), JSON.stringify({ room: m[1], pass: m[2], state: "" }));
    new window.__bsApi.Notice("Открываю проект «" + baseName(target) + "»…"); return switchTo(target);
  }
  // ---- follow mode: the window of the followed person is mirrored (the same note / board opens on this screen)
  let following = null, followSig = "";
  const peerKey = (u) => u.name + "|" + u.color;
  function openWhere(sh, u) {
    const rel = u.board || u.file; if (!rel) return false; const f = app.vault.getAbstractFileByPath(sh.abs(rel)); if (!f) return false;
    const v = app.workspace.activeLeaf && app.workspace.activeLeaf.view, cur = v && ((v.file && v.file.path) || v.path); if (cur === f.path) return true;
    const leaf = app.workspace.getLeaf(false); leaf.openFile(f); return true;
  }
  function findPeer(key) { for (const sh of shares.values()) for (const u of sh.peers) if (peerKey(u) === key) return { sh, u }; return null; }
  // following: the screen changes only when the followed person opens something else (never every tick)
  setInterval(() => { if (!following) { followSig = ""; return; } const hit = findPeer(following); if (!hit) return; const rel = hit.u.board || hit.u.file; const sig = (hit.sh.folder || "/") + "|" + (rel || ""); if (!rel || sig === followSig) return; followSig = sig; openWhere(hit.sh, hit.u); }, 700);

  // ---- the "Совместная работа" window
  let panelEl = null;
  function panel() {
    if (panelEl) { panelEl.close(); return; }
    const api = window.__bsApi, M = new api.Modal(app); panelEl = M; M.modalEl.classList.add("bsm"); M.titleEl.setText("Совместная работа"); const root = M.contentEl; root.classList.add("bsm-root");
    const copy = (t) => { try { navigator.clipboard.writeText(t); new api.Notice("Скопировано"); } catch (e) { /* none */ } };
    let tickFn = null;
    const el = (parent, tag, cls, text) => { const x = parent.createEl(tag, { cls }); if (text != null) x.textContent = text; return x; };
    const show = (build) => { tickFn = null; root.empty(); const prof = root.createDiv({ cls: "bsm-prof" }); profile(prof); const v = root.createDiv({ cls: "bsm-view" }); build(v); };
    const back = (v, title) => { const h = v.createDiv({ cls: "bsm-head" }); const b = h.createDiv({ cls: "bsm-back", attr: { title: "Назад" } }); api.setIcon(b, "lucide-arrow-left"); b.onclick = home; h.createDiv({ cls: "bsm-ttl", text: title }); };
    const sec = (v, t) => v.createDiv({ cls: "bsm-sub", text: t });
    const projName = (sh) => (sh.folder ? sh.folder.split("/").pop() : app.vault.getName());

    // your name and colour are always at the top
    function profile(host) {
      const m = me(), sw = host.createDiv({ cls: "bsm-me" }); const dot = el(sw, "span", "bsm-mdot"); dot.style.background = m.color; const inp = host.createEl("input", { cls: "bsm-name", attr: { placeholder: "Как вас называть?", spellcheck: "false" } }); inp.value = m.name;
      const pal = host.createDiv({ cls: "bsm-pal" });
      const save = (patch) => { const m2 = Object.assign(me(), patch); try { localStorage.setItem("board-me", JSON.stringify(m2)); localStorage.setItem("board-me-set", "1"); } catch (e) { /* private */ } for (const sh of shares.values()) sh.publish(); dot.style.background = m2.color; };
      inp.onchange = () => save({ name: inp.value.trim() || me().name });
      for (const c of PEER) { const s = pal.createDiv({ cls: "bsm-sw" + (c === m.color ? " is-on" : "") }); s.style.background = c; s.onclick = () => { save({ color: c }); pal.querySelectorAll(".bsm-sw").forEach((x) => x.classList.toggle("is-on", x === s)); }; }
      let hint = null; try { hint = localStorage.getItem("board-me-set"); } catch (e) { /* private */ } if (!hint) setTimeout(() => { inp.focus(); inp.select(); }, 80);
    }

    // ----- home: always two choices - this project / connect to a project
    function home() {
      show((v) => {
        const tiles = v.createDiv({ cls: "bsm-tiles" });
        const tile = (icon, t, fn) => { const x = tiles.createDiv({ cls: "bsm-tile" }); const i = x.createDiv({ cls: "bsm-ti" }); api.setIcon(i, icon); x.createDiv({ cls: "bsm-tt", text: t }); const sub = x.createDiv({ cls: "bsm-ts" }); x.onclick = fn; return sub; };
        const s1 = tile("lucide-box", "Этот проект", () => projectScreen());
        const s2 = tile("lucide-log-in", "Подключиться к проекту", joinScreen); s2.textContent = "по коду приглашения";
        tickFn = () => {
          const all = Array.from(shares.values()), n = all.reduce((a, s) => a + s.peers.length, 0);
          const t = all.length ? "раздача включена · " + (n ? "онлайн " + (n + 1) : "вы один") : "раздача выключена"; if (s1.textContent !== t) s1.textContent = t;
        };
        tickFn();
      });
    }

    // ----- this project: four tabs (overview / people / settings / log). Rights are set per person by the owner, never by the invite.
    const ROLE = { edit: "Редактор", view: "Только просмотр", banned: "Удалён" };
    function projectScreen(startTab) {
      show((v) => {
        back(v, "Этот проект");
        const tabs = v.createDiv({ cls: "bsm-seg" }), body = v.createDiv({ cls: "bsm-tabbody" }); let cur = startTab || "ov"; const tabEls = {};
        const draw = () => { for (const k in tabEls) tabEls[k].classList.toggle("is-on", k === cur); body.empty(); tickFn = null; const f = { ov: tabOverview, pp: tabPeople, st: tabSettings, lg: tabLog }[cur]; f(body); };
        for (const [k, t] of [["ov", "Обзор"], ["pp", "Участники"], ["st", "Настройки"], ["lg", "Журнал"]]) { const b = el(tabs, "div", "bsm-segb", t); tabEls[k] = b; b.onclick = () => { if (cur !== k) { cur = k; draw(); } }; }
        draw();
      });
    }
    // overview: is it on, start / stop, the invite code
    function tabOverview(b) {
      let pick = "/", more = false;
      const card = b.createDiv({ cls: "bsm-card" }); const dot = el(card, "span", "bsm-dot"); const ct = card.createDiv({ cls: "bsm-ct" }); const c1 = el(ct, "div", "bsm-c1"), c2 = el(ct, "div", "bsm-c2");
      const scope = b.createDiv({ cls: "bsm-opts" }), inv = b.createDiv();
      let sigS = "", sigI = null;
      const tick = () => {
        const all = Array.from(shares.values()), n = all.reduce((a, s) => a + s.peers.length, 0), searching = all.some((s) => s.prov && s.prov.status === "connecting"), pend0 = all.reduce((a, s) => a + s.q.size, 0), tot = all.reduce((a, s) => a + s.total, 0);
        dot.className = "bsm-dot " + (!all.length ? "" : n ? "is-live" : searching || pend0 ? "is-wait" : "");
        const t1 = !all.length ? "Раздача выключена" : pend0 ? "Загрузка файлов: " + (tot - pend0) + "/" + tot : n ? "Раздача включена · онлайн " + (n + 1) : searching ? "Раздача включена · поиск участников…" : "Раздача включена · вы один", t2 = all.length ? all.map(projName).join(", ") : app.vault.getName();
        if (c1.textContent !== t1) c1.textContent = t1; if (c2.textContent !== t2) c2.textContent = t2;
        const f = app.workspace.getActiveFile(), dir = f && f.parent && f.parent.path !== "/" ? f.parent.path : null, free = [];
        if (!shares.has("")) free.push(["/", "lucide-box", "Всё хранилище «" + app.vault.getName() + "»"]); if (dir && !shares.has(dir)) free.push([dir, "lucide-folder", "Папка «" + dir.split("/").pop() + "»"]);
        if (free.length && !free.some((x) => x[0] === pick)) pick = free[0][0];
        const ss = (all.length && !more ? "hide" : free.map((x) => x[0]).join("|")) + "#" + pick + "#" + more + "#" + all.length;
        if (ss !== sigS) {
          sigS = ss; scope.empty();
          if (all.length && !more) { if (free.length) { const l = el(scope, "button", "bsm-link", "Поделиться ещё…"); l.onclick = () => { more = true; sigS = ""; tick(); }; } }
          else if (free.length) {
            if (!all.length) el(scope, "div", "bsm-hint", "Выберите, чем поделиться, и нажмите «Начать раздачу». Появится код приглашения.");
            for (const [key, icon, label] of free) { const o = scope.createDiv({ cls: "bsm-opt" + (pick === key ? " is-pick" : "") }); const ic = el(o, "span", "bsm-oi"); api.setIcon(ic, icon); el(o, "span", "", label); o.onclick = () => { pick = key; sigS = ""; tick(); }; }
            const go = el(scope, "button", "mod-cta bsm-go", "Начать раздачу"); go.onclick = async () => { go.disabled = true; go.textContent = "Запускаю…"; await host(pick); more = false; sigS = ""; sigI = null; tick(); };
          }
        }
        const si = all.map((s) => s.folder).join(";"); if (si !== sigI) {
          sigI = si; inv.empty();
          if (all.length) {
            sec(inv, "Код приглашения"); el(inv, "div", "bsm-hint", "Один код для всех. Права каждого участника вы задаёте потом, во вкладке «Участники».");
            for (const [k, sh] of shares) {
              const c = inv.createDiv({ cls: "bsm-code" }); el(c, "div", "bsm-cn", projName(sh) + (k ? " (папка)" : " (всё хранилище)"));
              const row = c.createDiv({ cls: "bsm-crow" }); const i = row.createEl("input", { attr: { readonly: "true" } }); i.value = sh.code(); i.onfocus = () => i.select();
              const cb = el(row, "button", "mod-cta", "Копировать"); cb.onclick = () => copy(sh.code()); const st = el(row, "button", "", "Остановить"); st.onclick = async () => { await stop(k || "/"); sigS = ""; sigI = null; tick(); };
            }
          }
        }
      };
      tickFn = tick; tick();
    }
    // people: who is here, what they are doing, and (for the owner) what each of them may do
    function tabPeople(b) {
      const pend = b.createDiv({ cls: "bsm-pend" }), list = b.createDiv({ cls: "bsm-people" }); let sigW = "", sigP = "";
      const tick = () => {
        const all = Array.from(shares.values()), reqs = all.flatMap((s) => (s.owner ? s.pendingList.map((r) => ({ s, r })) : [])), sp = reqs.map((x) => x.r.pid).join("|");
        if (sp !== sigP) { sigP = sp; pend.empty(); for (const { s, r } of reqs) { const row = pend.createDiv({ cls: "bsm-req" }); row.createSpan({ text: "Кто-то хочет войти в «" + projName(s) + "»" }); const a = el(row, "button", "mod-cta", "Принять"), d = el(row, "button", "", "Отклонить"); a.onclick = () => { s.approve(r.pid, r.uid); sigP = ""; tick(); }; d.onclick = () => { s.pendingList = s.pendingList.filter((x) => x.pid !== r.pid); sigP = ""; tick(); }; } }
        const af = app.workspace.getActiveFile(), me0 = all.find((s) => s.owner), rows = [{ u: me(), self: true, sh: all[0], what: af ? "«" + af.basename + "»" : "в сети" }], seen = new Set();
        for (const sh of all) for (const u of sh.peers) { const k = peerKey(u); if (!seen.has(k)) { seen.add(k); rows.push({ u, sh, self: false, what: where(u) }); } }
        const sw = rows.map((p) => peerKey(p.u) + "|" + p.what + "|" + (p.sh && !p.self ? p.sh.roleOf(p.u.uid) : "") + "|" + (following === peerKey(p.u))).join(";") + (me0 ? "O" : "");
        if (sw === sigW) return; sigW = sw; list.empty();
        for (const p of rows) {
          const row = list.createDiv({ cls: "bsm-person" }); const d = el(row, "span", "bsm-pd"); d.style.background = p.u.color; const tx = row.createDiv({ cls: "bsm-tx" });
          el(tx, "div", "bsm-n", p.u.name + (p.self ? " (вы)" : "")); el(tx, "div", "bsm-s", p.self ? (me0 ? "Владелец · " : (p.sh && p.sh.readOnly ? "Только просмотр · " : "")) + p.what : p.what);
          if (p.self) continue;
          const act = row.createDiv({ cls: "bsm-pa" });
          if (me0 && p.sh && p.sh.owner && p.u.uid) {
            const sel = act.createEl("select", { cls: "bsm-role" }); for (const k of ["edit", "view", "banned"]) { const o = sel.createEl("option", { text: ROLE[k] }); o.value = k; } sel.value = p.sh.roleOf(p.u.uid); sel.onchange = () => { p.sh.setRole(p.u.uid, sel.value); sigW = ""; };
          } else if (p.sh) el(act, "span", "bsm-rl", ROLE[p.sh.roleOf(p.u.uid)] || "Редактор");
          const go = el(act, "button", "bsm-b", "Перейти"); go.onclick = () => { if (!openWhere(p.sh, p.u)) new api.Notice("Он пока ничего не открыл"); };
          const fl = el(act, "button", "bsm-b" + (following === peerKey(p.u) ? " is-on" : ""), following === peerKey(p.u) ? "Слежу" : "Следить"); fl.onclick = () => { following = following === peerKey(p.u) ? null : peerKey(p.u); followSig = ""; sigW = ""; tick(); if (following) new api.Notice("Вы следите за " + p.u.name + ". Нажмите ещё раз, чтобы остановить."); };
        }
        if (rows.length === 1) el(list, "div", "bsm-empty", all.length ? "Пока никого рядом. Отправьте код приглашения (вкладка «Обзор»)." : "Раздача выключена — подключённых нет.");
      };
      tickFn = tick; tick();
    }
    // settings
    function tabSettings(b) {
      const own = Array.from(shares.values()).find((s) => s.owner);
      const toggle = (icon, title, sub, on, fn) => { const r = b.createDiv({ cls: "bsm-opt" + (on ? " is-pick" : "") }); const ic = el(r, "span", "bsm-oi"); api.setIcon(ic, icon); const tx = r.createDiv({ cls: "bsm-tx" }); el(tx, "div", "bsm-n", title); el(tx, "div", "bsm-s", sub); if (fn) r.onclick = fn; else r.style.opacity = ".6"; };
      sec(b, "Доступ");
      toggle("lucide-shield-check", "Подтверждать входы", own ? "Новый участник входит, только когда вы нажмёте «Принять». Работает, пока вы в сети." : "Доступно владельцу проекта (тому, кто начал раздачу).", !!(own && own.meta.get("approval")), own ? () => { own.setApproval(!own.meta.get("approval")); b.empty(); tabSettings(b); } : null);
      sec(b, "Права новых участников"); el(b, "div", "bsm-hint", "Что смогут делать новые участники сразу после входа. Менять права каждого можно во вкладке «Участники».");
      const seg = b.createDiv({ cls: "bsm-seg" }); const def = own && own.meta.get("defaultRole") === "view" ? "view" : "edit";
      for (const k of ["edit", "view"]) { const s2 = el(seg, "div", "bsm-segb" + (def === k ? " is-on" : ""), ROLE[k]); if (own) s2.onclick = () => { own.setDefaultRole(k); b.empty(); tabSettings(b); }; else s2.style.opacity = ".6"; }
      sec(b, "Серверы"); el(b, "div", "bsm-hint", "Свои relay-серверы Nostr, через запятую (необязательно). По умолчанию используются публичные.");
      const sg = b.createEl("input", { attr: { style: "width:100%", placeholder: "wss://…" } }); sg.value = signaling().join(", "); sg.onchange = () => { try { localStorage.setItem("board-signaling", JSON.stringify(sg.value.split(",").map((x) => x.trim()).filter(Boolean))); } catch (e) { /* private */ } };
    }
    // log with rollback
    function tabLog(b) {
      const list = b.createDiv({ cls: "bsm-loglist" }); let sig = "";
      const draw = () => {
        const items = Array.from(shares.values()).flatMap((sh) => sh.log.toArray().map((e) => ({ sh, e }))).sort((a, c) => c.e.t - a.e.t).slice(0, 80), s2 = items.map((x) => x.e.t + x.e.rel).join("|"); if (s2 === sig) return; sig = s2; list.empty();
        if (!items.length) el(list, "div", "bsm-empty", "Пока нет записей. Здесь появится, кто и когда менял файлы.");
        for (const { sh, e } of items) {
          const r = list.createDiv({ cls: "bsm-ev" }); el(r, "span", "bsm-evt", new Date(e.t).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })); const tx = r.createDiv({ cls: "bsm-tx" });
          el(tx, "div", "bsm-n", e.who + " — " + ({ edit: "изменил", create: "создал", delete: "удалил", rollback: "откатил" }[e.kind] || e.kind) + " «" + e.rel.replace(/^.*\//, "") + "»"); el(tx, "div", "bsm-s", e.rel);
          if (e.before != null && (e.kind === "edit" || e.kind === "rollback")) { const bt = el(r, "button", "bsm-b", "Откатить"); bt.onclick = () => { if (sh.rollback(e)) { new api.Notice("Откачено: «" + e.rel.replace(/^.*\//, "") + "»"); sig = ""; draw(); } }; }
        }
      };
      draw(); tickFn = draw;
    }

    // ----- join
    function joinScreen() {
      show((v) => {
        back(v, "Присоединиться");
        el(v, "div", "bsm-hint", "Вставьте код приглашения. Проект откроется в этом окне.");
        const row = v.createDiv({ cls: "bsm-crow" }); const inp = row.createEl("input", { attr: { placeholder: "basalt-share:…" } }); const go = el(row, "button", "mod-cta", "Войти");
        go.onclick = async () => { if (await joinCode(inp.value)) M.close(); }; inp.onkeydown = (e) => { if (e.key === "Enter") go.click(); }; setTimeout(() => inp.focus(), 60);
        const others = otherVaults(); if (others.length) { sec(v, "Уже подключённые проекты"); for (const o of others) { const r = v.createDiv({ cls: "bsm-opt" }); const ic = el(r, "span", "bsm-oi"); api.setIcon(ic, "lucide-box"); el(r, "span", "", o.name); r.onclick = () => { switchTo(o.path); }; } }
      });
    }

    const iv = setInterval(() => { if (tickFn) tickFn(); }, 1200); const onPeers = () => { if (tickFn) tickFn(); }; document.addEventListener("basalt-share-peers", onPeers);
    M.onClose = () => { clearInterval(iv); document.removeEventListener("basalt-share-peers", onPeers); panelEl = null; };
    home(); M.open();
  }
  async function togglePanel() { panel(); }
  async function dialog() { panel(); }
  const joinDialog = panel;

  // ---- while a joined project is still arriving: a card with a progress bar, so files can land one by one
  function loadingCard(sh) {
    const el = document.createElement("div"); el.className = "bsh-load"; const t1 = document.createElement("div"); t1.className = "bsh-load-t"; const t2 = document.createElement("div"); t2.className = "bsh-load-s"; const bar = document.createElement("div"); bar.className = "bsh-load-bar"; const fill = document.createElement("div"); bar.appendChild(fill);
    el.append(t1, t2, bar); document.body.appendChild(el); requestAnimationFrame(() => el.classList.add("is-on"));
    const t0 = Date.now(); let quiet = 0, last = -1;
    const iv = setInterval(() => {
      const n = sh.files.size, pend = sh.q.size, online = sh.peers.length > 0;
      if (n !== last) { last = n; quiet = Date.now(); }
      t1.textContent = n ? "Загружаю проект…" : online ? "Получаю список файлов…" : "Подключаюсь к участникам…";
      t2.textContent = n ? "Файлов: " + n + (pend ? " · записано " + (n - pend) : "") : "Это занимает несколько секунд";
      fill.style.width = n ? Math.round(((n - pend) / n) * 100) + "%" : "8%"; el.classList.toggle("is-wait", !n);
      const done = n > 0 && !pend && Date.now() - quiet > 1800, timeout = Date.now() - t0 > 90000;
      if (done || timeout || sh.stopped) { clearInterval(iv); sh.joining = false; if (!n && timeout) { t1.textContent = "Пока никого нет в сети"; t2.textContent = "Файлы появятся, когда кто-то из участников подключится."; setTimeout(() => el.remove(), 6000); } else { el.classList.remove("is-on"); setTimeout(() => el.remove(), 500); } }
    }, 300);
  }

  // ---- who is where: markers in the file list and tabs, the other people's carets inside notes, "typing…" badges
  function startPresence() {
    const peersOn = (rel) => { const out = []; for (const sh of shares.values()) for (const u of sh.peers) if ((u.file === rel || u.board === rel) && sh.rel) out.push({ u, sh }); return out; };
    const relOf = (path) => { for (const sh of shares.values()) { const r = sh.rel(path); if (r != null) return { sh, rel: r }; } return null; };
    // local caret -> awareness
    let lastCur = "";
    setInterval(() => {
      if (!shares.size) return; const leaf = app.workspace.activeLeaf, v = leaf && leaf.view; if (!v || v.getViewType() !== "markdown" || !v.file) return;
      let cm = null; try { cm = v.editor && v.editor.cm; } catch (e) { /* none */ } if (!cm || !cm.state) return; const sel = cm.state.selection.main, key = v.file.path + ":" + sel.head + ":" + sel.anchor; if (key === lastCur) return; lastCur = key;
      const hit = relOf(v.file.path); if (hit) hit.sh.publish({ file: hit.rel, cur: { h: sel.head, a: sel.anchor } });
    }, 300);
    // markers in the explorer and on tabs
    const dots = (host, list, key, pending) => {
      let w = host.querySelector(":scope > .bsh-who"); const sig = list.map((x) => x.u.name + x.u.color).join("|") + (pending ? "#p" : "") + (list.some((x) => Date.now() - (x.sh.lastRemote.get(key) || 0) < 2500) ? "#t" : "");
      if (!list.length && !pending) { if (w) w.remove(); return; }
      if (!w) { w = document.createElement("span"); w.className = "bsh-who"; host.appendChild(w); } if (w.dataset.sig === sig) return; w.dataset.sig = sig; w.textContent = "";
      if (pending) { const sp = document.createElement("span"); sp.className = "bsh-spin"; sp.title = "Синхронизируется…"; w.appendChild(sp); }
      for (const x of list) { const d = document.createElement("span"); d.className = "bsh-wd"; d.style.background = x.u.color; d.title = x.u.name; w.appendChild(d); }
      if (list.length) { const lb = document.createElement("span"); lb.className = "bsh-wl"; lb.style.color = list[0].u.color; lb.textContent = list[0].u.name + (list.length > 1 ? " +" + (list.length - 1) : "") + (list.some((x) => Date.now() - (x.sh.lastRemote.get(key) || 0) < 2500) ? " ✎" : ""); w.appendChild(lb); }
      w.title = list.map((x) => x.u.name).join(", ");
    };
    setInterval(() => {
      if (!shares.size) return;
      document.querySelectorAll(".bsf-tree [data-path]").forEach((row) => { const path = row.getAttribute("data-path"), hit = relOf(path); const host = row.querySelector(".bsf-n") ? row.querySelector(".bsf-n").parentElement : row; if (!hit) return; dots(host, peersOn(hit.rel), hit.rel, hit.sh.q.has(hit.rel)); });
      for (const leaf of app.workspace.getLeavesOfType("markdown").concat(app.workspace.getLeavesOfType("basalt-board"), app.workspace.getLeavesOfType("canvas"), app.workspace.getLeavesOfType("basalt-textfile"))) { const f = leaf.view && (leaf.view.file || (leaf.view.path ? { path: leaf.view.path } : null)); if (!f || !leaf.tabHeaderEl) continue; const hit = relOf(f.path); if (hit) dots(leaf.tabHeaderEl.querySelector(".workspace-tab-header-inner") || leaf.tabHeaderEl, peersOn(hit.rel), hit.rel, hit.sh.q.has(hit.rel)); }
    }, 1500);
    // the mouse pointer of other people, in any file (notes, text files, images, pdf, json ...): sent as a position inside the pane, drawn over the same pane,
    // smoothed on the receiving side (every frame the arrow glides towards the latest position)
    const PANE = ".workspace-leaf-content";
    const SCROLLERS = ".cm-scroller, .markdown-preview-view, .pdf-viewer-container, #viewerContainer, .bs-text-scroll, .bsf-scroll, .view-content, .image-container";
    const scrollerOf = (pane) => { const list = pane.querySelectorAll(SCROLLERS); for (const el of list) if (el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 80) return el; return null; };
    const leafOfPane = (pane) => { let found = null; app.workspace.iterateAllLeaves((l) => { if (!found && l.view && l.view.containerEl && (l.view.containerEl === pane || l.view.containerEl.closest(PANE) === pane)) found = l; }); return found; };
    const pathOf = (v) => (v.file && v.file.path) || v.path || (v.getState && v.getState() && (v.getState().file || v.getState().path)) || null;
    let sendT = 0, pending = null;
    const flushPtr = () => { sendT = 0; if (!pending) return; const { sh, ptr } = pending; pending = null; lastSent = Date.now(); sh.publish({ ptr }); };
    let lastSent = 0;
    document.addEventListener("pointermove", (e) => {
      if (!shares.size) return;
      const pane = e.target && e.target.closest ? e.target.closest(PANE) : null, leaf = pane && leafOfPane(pane), v = leaf && leaf.view;
      const path = v && pathOf(v), hit = path && relOf(path);
      if (!hit || (v.getViewType && v.getViewType() === "basalt-board")) { if (pending !== "none") { for (const sh of shares.values()) if (sh.extra && sh.extra.ptr) sh.publish({ ptr: null }); } return; }
      const r = pane.getBoundingClientRect(), sc = scrollerOf(pane);
      pending = { sh: hit.sh, ptr: { f: hit.rel, x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top + (sc ? sc.scrollTop : 0)) } };
      const wait = 28 - (Date.now() - lastSent); if (wait <= 0) flushPtr(); else if (!sendT) sendT = setTimeout(flushPtr, wait);
    }, true);
    document.addEventListener("mouseleave", () => { pending = null; for (const sh of shares.values()) if (sh.extra && sh.extra.ptr) sh.publish({ ptr: null }); }, true);
    const ptrs = new Map(); let leaves = [], leavesAt = 0;
    const frame = () => {
      requestAnimationFrame(frame); if (!shares.size) { if (ptrs.size) { for (const o of ptrs.values()) o.el.remove(); ptrs.clear(); } return; }
      const now = performance.now();
      if (now - leavesAt > 400) { leavesAt = now; leaves = []; app.workspace.iterateAllLeaves((l) => { const v = l.view; if (v && v.containerEl && v.containerEl.isConnected && !(v.getViewType && v.getViewType() === "basalt-board")) { const p = pathOf(v), hit = p && relOf(p); if (hit) leaves.push({ pane: v.containerEl.closest(PANE) || v.containerEl, hit, v }); } }); }
      const live = new Set();
      for (const L of leaves) {
        if (!L.pane.isConnected) continue; let layer = L.pane.querySelector(":scope > .bsh-ptrs");
        const list = []; for (const sh of shares.values()) for (const u of sh.peers) if (u.ptr && u.ptr.f === L.hit.rel) list.push(u);
        if (!list.length) { if (layer) layer.remove(); continue; }
        if (!layer) { if (getComputedStyle(L.pane).position === "static") L.pane.style.position = "relative"; layer = document.createElement("div"); layer.className = "bsh-ptrs"; L.pane.appendChild(layer); }
        const sc = scrollerOf(L.pane), st = sc ? sc.scrollTop : 0;
        for (const u of list) {
          const key = L.hit.rel + "|" + u.name + u.color; live.add(key); let o = ptrs.get(key);
          if (!o || !o.el.isConnected) { const el = document.createElement("div"); el.className = "bsh-ptr"; el.style.color = u.color; el.innerHTML = '<svg width="16" height="18" viewBox="0 0 14 16"><path d="M1 1l11 5-5 2-2 6z" fill="currentColor" stroke="#000" stroke-opacity=".35"/></svg><span></span>'; el.lastChild.textContent = u.name; el.lastChild.style.background = u.color; layer.appendChild(el); o = { el, cx: u.ptr.x, cy: u.ptr.y - st }; ptrs.set(key, o); }
          const tx = u.ptr.x, ty = u.ptr.y - st; o.cx += (tx - o.cx) * 0.3; o.cy += (ty - o.cy) * 0.3; if (Math.abs(tx - o.cx) < .3) o.cx = tx; if (Math.abs(ty - o.cy) < .3) o.cy = ty;
          o.el.style.transform = "translate(" + o.cx.toFixed(1) + "px," + o.cy.toFixed(1) + "px)";
        }
      }
      for (const [k, o] of ptrs) if (!live.has(k)) { o.el.remove(); ptrs.delete(k); }
    };
    requestAnimationFrame(frame);
    // carets of other people inside the open note
    setInterval(() => {
      if (!shares.size) return;
      for (const leaf of app.workspace.getLeavesOfType("markdown")) {
        const v = leaf.view; if (!v || !v.file || !v.containerEl.isConnected) continue; let cm = null; try { cm = v.editor && v.editor.cm; } catch (e) { /* none */ } if (!cm || !cm.scrollDOM) continue;
        const hit = relOf(v.file.path), sd = cm.scrollDOM; let layer = sd.querySelector(":scope > .bsh-cursors");
        const list = hit ? peersOn(hit.rel) : []; const want = list.filter((x) => x.u.cur);
        if (!want.length && !list.length) { if (layer) layer.remove(); const bd = v.containerEl.querySelector(".bsh-badge"); if (bd) bd.remove(); continue; }
        if (!layer) { if (getComputedStyle(sd).position === "static") sd.style.position = "relative"; layer = document.createElement("div"); layer.className = "bsh-cursors"; sd.appendChild(layer); }
        layer.textContent = ""; const sr = sd.getBoundingClientRect(), len = cm.state.doc.length;
        for (const x of want) {
          const head = Math.max(0, Math.min(len, x.u.cur.h || 0)); let c = null; try { c = cm.coordsAtPos(head); } catch (e) { /* offscreen */ } if (!c) continue;
          const typing = Date.now() - (x.sh.lastRemote.get(hit.rel) || 0) < 2500;
          const el = document.createElement("div"); el.className = "bsh-caret"; el.style.cssText = "left:" + (c.left - sr.left + sd.scrollLeft) + "px;top:" + (c.top - sr.top + sd.scrollTop) + "px;height:" + Math.max(14, c.bottom - c.top) + "px;background:" + x.u.color + ";color:" + x.u.color;
          const tag = document.createElement("span"); tag.textContent = x.u.name + (typing ? " печатает…" : ""); tag.style.background = x.u.color; el.appendChild(tag); layer.appendChild(el);
        }
        // a small badge in the corner: who else is in this note
        let bd = v.containerEl.querySelector(".bsh-badge"); if (!bd) { bd = document.createElement("div"); bd.className = "bsh-badge"; v.containerEl.appendChild(bd); }
        const sig = list.map((x) => x.u.name + x.u.color).join("|"); if (bd.dataset.sig !== sig) { bd.dataset.sig = sig; bd.textContent = ""; for (const x of list) { const c = document.createElement("span"); c.className = "bsh-bc"; const d = document.createElement("span"); d.className = "bsh-wd"; d.style.background = x.u.color; c.append(d, x.u.name); bd.appendChild(c); } }
      }
    }, 350);
  }

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
      const upd = () => { const all = Array.from(shares.values()); if (!all.length) { chip.style.display = "none"; return; } const n = all.reduce((a, s) => a + s.peers.length, 0), st = all.some((s) => s.prov && s.prov.status === "connecting"); chip.style.display = ""; chip.classList.toggle("is-searching", st && !n); chip.classList.toggle("is-live", n > 0); chip.textContent = ""; const d = document.createElement("span"); d.className = "bsh-dot"; const pend = all.reduce((x, s2) => x + s2.q.size, 0), tot = all.reduce((x, s2) => x + s2.total, 0); chip.append(d, pend ? "Загрузка файлов: " + (tot - pend) + "/" + tot : n ? "Онлайн: " + (n + 1) : st ? "Поиск участников…" : "Один в сети"); chip.classList.toggle("is-searching", pend > 0 || (st && !n)); for (const sh of all) for (const u of sh.peers) { const pd = document.createElement("span"); pd.className = "bsh-wd"; pd.style.background = u.color; chip.appendChild(pd); }
      chip.title = all.map((s) => (s.folder || "весь vault") + ": " + (s.peers.length ? s.peers.map((p) => p.name).join(", ") : "никого рядом")).join(String.fromCharCode(10)); };
      chip.style.cursor = "pointer"; chip.onclick = () => panel();
      document.addEventListener("basalt-share-peers", upd); setInterval(upd, 2000); upd();
    }
    const pubFile = () => {
      const lf = app.workspace.activeLeaf, v = lf && lf.view, isBoard = v && v.getViewType && v.getViewType() === "basalt-board", path = v ? (isBoard ? v.path : (v.file && v.file.path) || v.path || null) : null;
      for (const sh of shares.values()) { const r = path ? sh.rel(path) : null; sh.publish({ file: r && !isBoard ? r : null, board: r && isBoard ? r : null, cur: null }); }
    };
    app.workspace.on("file-open", pubFile); app.workspace.on("active-leaf-change", pubFile);
    startPresence();
    window.__bsShare = { forPath, host, stop, dialog, join: joinDialog, begin, shares };
    (async () => { try { const st = JSON.parse(await app.vault.adapter.read(STATE)); if (st && st.room && !shares.has("")) await begin("/", st.room, st.pass, { owner: !!st.owner }); } catch (e) { /* not a shared vault */ } })().then(() => Promise.all(store().filter((x) => !shares.has(x.folder || "")).map((x) => begin(x.folder || "/", x.room, x.pass, { owner: !!x.owner }).catch((e) => console.error(e))))).then(resolveReady, resolveReady);
  }, 600);
})();
