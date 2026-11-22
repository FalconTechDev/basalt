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
  const turnCfg = () => { try { const j = JSON.parse(localStorage.getItem("board-turn") || "null"); if (j && j.url) return [{ urls: j.url.split(",").map((x) => x.trim()).filter(Boolean), username: j.user || undefined, credential: j.pass || undefined }]; } catch (e) { /* none */ } return undefined; };
  const RELAYS = ["wss://nos.lol", "wss://relay.primal.net", "wss://nostr.data.haus", "wss://relay.damus.io", "wss://relay.ditto.pub", "wss://nostr.sathoarder.com", "wss://nostr.hifish.org", "wss://fanfares.nostr1.com"];
  // what can this computer reach: the discovery servers and the STUN server, and what that means for connecting to another computer
  async function diagnose() {
    const rows = []; const list = signaling().length ? signaling() : RELAYS; let ok = 0;
    await Promise.all(list.map((u) => new Promise((res) => { let done = false; let w; try { w = new WebSocket(u); } catch (e) { return res(); } const t = setTimeout(() => { if (!done) { done = true; try { w.close(); } catch (e) { /* ignore */ } res(); } }, 5000); w.onopen = () => { if (!done) { done = true; ok++; clearTimeout(t); try { w.close(); } catch (e) { /* ignore */ } res(); } }; w.onerror = () => { if (!done) { done = true; clearTimeout(t); res(); } }; })));
    rows.push({ ok: ok > 0, text: "Серверы обнаружения: доступно " + ok + " из " + list.length, hint: ok ? "" : "Компьютер не достучался ни до одного. Проверьте интернет, отключите VPN или укажите свои серверы в «Настройки»." });
    const ice = async (servers) => { const types = new Set(); try { const pc = new RTCPeerConnection({ iceServers: servers }); pc.createDataChannel("x"); pc.onicecandidate = (e) => { if (e.candidate) { const m = / typ (\w+)/.exec(e.candidate.candidate); if (m) types.add(m[1]); } }; await pc.setLocalDescription(await pc.createOffer()); await new Promise((r) => setTimeout(r, 4500)); pc.close(); } catch (e) { /* ignore */ } return types; };
    const st = await ice([{ urls: "stun:stun.cloudflare.com:3478" }]);
    rows.push({ ok: st.has("srflx"), text: st.has("srflx") ? "Выход в интернет для прямой связи: есть" : "Выход в интернет для прямой связи: не определён", hint: st.has("srflx") ? "" : "Сеть блокирует вспомогательный сервер. Связь возможна только если оба компьютера в одной локальной сети. Для разных сетей нужен TURN-сервер («Настройки»)." });
    const tc = turnCfg(); if (tc) { const t = await ice([{ urls: "stun:stun.cloudflare.com:3478" }].concat(tc)); rows.push({ ok: t.has("relay"), text: t.has("relay") ? "TURN-сервер отвечает" : "TURN-сервер не отвечает", hint: t.has("relay") ? "" : "Проверьте адрес, логин и пароль TURN-сервера." }); }
    const all = Array.from(shares.values()); rows.push({ ok: all.length > 0, text: all.length ? "Раздача включена, участников рядом: " + all.reduce((a, x) => a + x.peers.length, 0) : "Раздача на этом компьютере не включена", hint: all.length ? "" : "Включите раздачу или подключитесь по коду." });
    return rows;
  }
  let PREFS = null;
  const prefs = () => { if (PREFS) return PREFS; let j = {}; try { j = JSON.parse(localStorage.getItem("board-prefs") || "{}") || {}; } catch (e) { /* default */ } PREFS = Object.assign({ notify: true, sound: true, pointers: true }, j); return PREFS; };
  const setPrefs = (patch) => { PREFS = Object.assign(prefs(), patch); try { localStorage.setItem("board-prefs", JSON.stringify(PREFS)); } catch (e) { /* private */ } };
  let AC = null;
  function beep(kind) {
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === "suspended") AC.resume(); const t = AC.currentTime;
      const seq = { join: [[660, 0], [880, .11]], leave: [[660, 0], [440, .11]], request: [[784, 0], [784, .15], [1046, .3]], edit: [[540, 0]], warn: [[330, 0], [262, .14]] }[kind] || [[600, 0]];
      for (const [f, d] of seq) { const o = AC.createOscillator(), g = AC.createGain(); o.type = "sine"; o.frequency.value = f; g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(kind === "edit" ? .05 : .12, t + d + .012); g.gain.exponentialRampToValueAtTime(.0001, t + d + .2); o.connect(g); g.connect(AC.destination); o.start(t + d); o.stop(t + d + .22); }
    } catch (e) { /* no audio */ }
  }
  function notify(kind, text) { const pr = prefs(); if (pr.notify && text) new window.__bsApi.Notice(text, 4500); if (pr.sound) beep(kind); }
  let resolveReady; window.__bsShareReady = new Promise((r) => { resolveReady = r; });

  class Share {
    constructor(folder, room, pass, opts = {}) {
      this.owner = !!opts.owner; this.pendingList = []; this.ready = false; this.inc0 = opts.include || null; this.hellos = new Map();
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
      if (this.pendingList.some((r) => r.pid === pid)) return; this.pendingList.push({ pid, uid, t: Date.now() }); this.ping(); if (this.owner) { this.tryInvite(pid); if (!this.pendingList.some((r) => r.pid === pid)) return; }
      if (prefs().sound) beep("request"); if (!this.owner) return;
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
    includeList() { const a = this.meta.get("include"); return a ? a.toArray() : null; }
    inScopeWith(rel, list) { return !list || list.some((e) => rel === e || rel.startsWith(e + "/")); }
    inScope(rel) { return this.inScopeWith(rel, this.includeList()); }
    skip(rel) { return !rel || rel.split("/").some((p) => p.startsWith(".")) || !this.inScope(rel); }
    setIncludeRaw(list) { const Y = window.__bsY.Y; this.doc.transact(() => { let a = this.meta.get("include"); if (!a) { a = new Y.Array(); this.meta.set("include", a); } a.delete(0, a.length); a.push(list); }); }
    // the owner changes what is shared; whatever drops out stops syncing, but other people keep their copies
    setInclude(list) {
      if (!this.owner) return; const Y = window.__bsY.Y;
      this.doc.transact(() => {
        let a = this.meta.get("include");
        if (!list || !list.length) { if (a) this.meta.delete("include"); } else { if (!a) { a = new Y.Array(); this.meta.set("include", a); } a.delete(0, a.length); a.push(list); }
        let un = this.meta.get("unshared"); if (!un) { un = new Y.Map(); this.meta.set("unshared", un); }
        const L = list && list.length ? list : null;
        for (const rel of Array.from(this.files.keys())) if (!this.inScopeWith(rel, L)) { un.set(rel, true); this.files.delete(rel); }
      });
      this.scan(); this.queueSave(); this.ping();
    }
    describeScope() { const L = this.includeList(); if (!L) return this.folder ? "Папка" : "Всё хранилище"; let f = 0, d = 0; for (const x of L) { const o = app.vault.getAbstractFileByPath(this.abs(x)); if (o && o.children) d++; else f++; } return { f, d }; }
    // ----- temporary invitations: a code that works for some hours and / or only once
    invites() { const m = this.meta.get("invites"); return m ? Array.from(m.entries()).map(([id, v]) => Object.assign({ id }, v)) : []; }
    createInvite(hours, once) {
      if (!this.owner) return null; const Y = window.__bsY.Y, id = uid(); this.doc.transact(() => { let m = this.meta.get("invites"); if (!m) { m = new Y.Map(); this.meta.set("invites", m); } m.set(id, { t: Date.now(), exp: hours ? Date.now() + hours * 3600000 : null, once: !!once, used: false }); if (!this.meta.get("approval")) this.meta.set("approval", true); });
      return id;
    }
    revokeInvite(id) { const m = this.meta.get("invites"); if (m && this.owner) m.delete(id); this.ping(); }
    inviteValid(v) { return !!v && (!v.exp || Date.now() < v.exp) && !(v.once && v.used); }
    onHello(pid, d) { if (!this.owner || !d || !d.invite) return; this.hellos.set(pid, d.invite); this.tryInvite(pid); }
    tryInvite(pid) {
      const id = this.hellos.get(pid), info = this.prov && this.prov.peers.get(pid); if (!id || !info || !info.userId || info.admitted) return;
      const m = this.meta.get("invites"), v = m && m.get(id); if (!this.inviteValid(v)) return;
      if (v.once) m.set(id, Object.assign({}, v, { used: true, by: info.userId })); this.approve(pid, info.userId); this.hellos.delete(pid);
    }
    async start() {
      const Y = window.__bsY.Y, ad = app.vault.adapter; let st = null;
      try { st = JSON.parse(await ad.read(this.abs(STATE))); } catch (e) { /* first time */ }
      if (st && st.state) Y.applyUpdate(this.doc, unb64(st.state));
      if (st && st.owner) this.owner = true; this.invite = st && st.invite ? st.invite : null;
      this.joining = !!(st && st.room && !st.state);
      if (this.owner && this.inc0 && !this.includeList()) this.setIncludeRaw(this.inc0);
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
      const L = window.__bsY; this.prov = new L.TrysteroProvider("basalt-share-" + this.room, this.doc, { password: this.pass || undefined, relayUrls: signaling(), turnConfig: turnCfg(), helloData: () => (this.invite ? { invite: this.invite } : null), onHello: (pid, d) => this.onHello(pid, d), isReadOnly: () => this.readOnly, canWrite: (uid) => this.canWrite(uid), ok: (pid, uid) => this.okPeer(uid), onPending: (pid, uid) => this.onPending(pid, uid) }); this.prov.onStatus(() => document.dispatchEvent(new CustomEvent("basalt-share-peers", { detail: this })));
      this.aw = this.prov.awareness; this.publish();
      this.aw.on("change", () => { const was = new Set(this.peers.map((u) => u.name + "|" + u.color)); this.peers = Array.from(this.aw.getStates().entries()).filter(([id]) => id !== this.aw.clientID).map(([, s]) => s.user).filter(Boolean);
        if (this.ready) { const now = new Set(this.peers.map((u) => u.name + "|" + u.color)); for (const u of this.peers) if (!was.has(u.name + "|" + u.color)) notify("join", u.name + " подключился(лась)"); for (const k of was) if (!now.has(k)) notify("leave", k.split("|")[0] + " вышел(ла)"); } document.dispatchEvent(new CustomEvent("basalt-share-peers", { detail: this })); });
      this.meta.observeDeep(() => {
        if (this.prov) { this.prov.recheck(); this.assignRoles(); } this.ping();
        const id = this.prov && this.prov.selfUserId; if (id && !this.owner) { const now = this.roleOf(id); if (this._role && this._role !== now) { if (now === "view") notify("warn", "Владелец сделал вас наблюдателем: правки отключены"); else if (now === "edit") notify("join", "Теперь вы можете редактировать"); else if (now === "banned") notify("warn", "Вас удалили из проекта"); } this._role = now; }
      });
      this.prov.onStatus(() => this.assignRoles());
      { const t1 = setInterval(() => { if (this.stopped) return clearInterval(t1); if (this.prov && this.prov.selfUserId) { clearInterval(t1); this.publish(); } }, 400); }
      if (this.owner) { const t0 = setInterval(() => { if (this.stopped) return clearInterval(t0); if (this.prov && this.prov.selfUserId) { clearInterval(t0); if (this.meta.get("owner") !== this.prov.selfUserId) this.meta.set("owner", this.prov.selfUserId); } }, 400); }
      this.onVault = (type) => (f, old) => this.vaultEvent(type, f, old);
      this.evs = ["create", "modify", "delete", "rename"].map((t) => app.vault.on(t, this.onVault(t)));
      this.queueSave(); this.ready = true;
      setTimeout(() => { if (!this.stopped && !this.owner && !this.meta.get("owner") && !this.peers.length && this.prov && this.prov.status !== "connecting") { this.owner = true; this.queueSave(); const t0 = setInterval(() => { if (this.stopped) return clearInterval(t0); if (this.prov && this.prov.selfUserId) { clearInterval(t0); this.meta.set("owner", this.prov.selfUserId); this.ping(); } }, 400); this.ping(); } }, 10000);
    }
    publish(extra) { if (!this.aw) return; if (extra) this.extra = Object.assign(this.extra || {}, extra); const m = me(); this.aw.setLocalStateField("user", Object.assign({ name: m.name, color: m.color, uid: (this.prov && this.prov.selfUserId) || undefined }, this.extra || {})); }
    async list(dir) {
      const ad = app.vault.adapter, out = []; let r; try { r = await ad.list(dir || "/"); } catch (e) { return out; }
      for (const f of r.files) { const rel = this.rel(f); if (!this.skip(rel)) out.push(rel); }
      for (const d of r.folders) { const rel = this.rel(d); if (rel && !rel.split("/").some((x) => x.startsWith("."))) out.push(...await this.list(d)); }
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
      { const af = app.workspace.getActiveFile(); this._nt = this._nt || new Map(); const last = this._nt.get(rel) || 0;
        if (this.ready && Date.now() - last > 20000 && !(af && af.path === this.abs(rel)) && !this.joining) { this._nt.set(rel, Date.now()); const who0 = this.peers.filter((u) => u.file === rel || u.board === rel).map((u) => u.name); notify("edit", (who0[0] || "Кто-то") + ": изменения в «" + rel.replace(/^.*\//, "") + "»"); } }
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
        if (!e) { const un = this.meta.get("unshared"); if (un && un.get(rel)) return; const f = app.vault.getAbstractFileByPath(p); if (f) { try { await app.vault.trash(f, true); } catch (er) { await ad.remove(p); } } return; }
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
    async save() { const Y = window.__bsY.Y; try { await app.vault.adapter.write(this.abs(STATE), JSON.stringify({ room: this.room, pass: this.pass, invite: this.invite || undefined, owner: this.owner || undefined, state: b64(Y.encodeStateAsUpdate(this.doc)) })); } catch (e) { /* ignore */ } }
    stop() { this.stopped = true; clearTimeout(this.saveT); for (const ev of this.evs || []) app.vault.offref(ev); if (this.prov) this.prov.destroy(); }
    code(inviteId) { return "basalt-share:" + this.room + ":" + this.pass + ":" + encodeURIComponent(this.folder ? this.folder.split("/").pop() : (app.vault.getName ? app.vault.getName() : "Общая папка"))  + (inviteId ? ":i" + inviteId : ""); }
  }

  const store = () => { try { return JSON.parse(localStorage.getItem("basalt-shares:" + app.vault.getName()) || "[]"); } catch (e) { return []; } };
  const setStore = (a) => { try { localStorage.setItem("basalt-shares:" + app.vault.getName(), JSON.stringify(a)); } catch (e) { /* private */ } };
  async function begin(folder, room, pass, opts) { const key = folder === "/" ? "" : folder; if (shares.has(key)) return shares.get(key); const s = new Share(folder, room, pass, opts || {}); shares.set(key, s); await s.start(); const l = store().filter((x) => x.folder !== key); l.push({ folder: key, room, pass, owner: !!(opts && opts.owner) }); setStore(l); return s; }
  async function host(folder, include) { const key = folder === "/" ? "" : folder; return shares.get(key) || begin(folder, uid() + uid(), uid() + uid(), { owner: true, include: include && include.length ? include : null }); }
  async function stop(folder) { const key = folder === "/" ? "" : folder; const s = shares.get(key); if (!s) return; s.stop(); shares.delete(key); setStore(store().filter((x) => x.folder !== key)); }
  function forPath(path) { let best = null; for (const [k, s] of shares) { if (k === "" || path.startsWith(k + "/")) { const r = s.rel(path); if (r != null && s.skip(r)) continue; if (!best || k.length > best.folder.length) best = s; } } return best; }

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
    fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(pa.join(target, STATE), JSON.stringify({ room: m[1], pass: m[2], invite: /^i/.test(m[4] || "") ? m[4].slice(1) : undefined, state: "" }));
    new window.__bsApi.Notice("Открываю проект «" + baseName(target) + "»…"); return switchTo(target);
  }
  // ---- follow mode: the screen of the followed person is mirrored, but only when they open something else
  let following = null, followSig = "";
  const peerKey = (u) => u.name + "|" + u.color;
  function openWhere(sh, u) {
    const rel = u.board || u.file; if (!rel) return false; const f = app.vault.getAbstractFileByPath(sh.abs(rel)); if (!f) return false;
    const v = app.workspace.activeLeaf && app.workspace.activeLeaf.view, cur = v && ((v.file && v.file.path) || v.path); if (cur === f.path) return true;
    const leaf = app.workspace.getLeaf(false); leaf.openFile(f); return true;
  }
  function findPeer(key) { for (const sh of shares.values()) for (const u of sh.peers) if (peerKey(u) === key) return { sh, u }; return null; }
  setInterval(() => { if (!following) { followSig = ""; return; } const hit = findPeer(following); if (!hit) return; const rel = hit.u.board || hit.u.file; const sig = (hit.sh.folder || "/") + "|" + (rel || ""); if (!rel || sig === followSig) return; followSig = sig; openWhere(hit.sh, hit.u); }, 700);

  // ---- choosing what to share: any files and folders
  const plural = (n, a, b, c) => n + " " + ((n % 10 === 1 && n % 100 !== 11) ? a : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? b : c);
  function describeList(list) {
    if (!list || !list.length) return "Всё хранилище"; let f = 0, d = 0; for (const p of list) { const o = app.vault.getAbstractFileByPath(p); if (o && o.children) d++; else f++; }
    return [f ? plural(f, "файл", "файла", "файлов") : "", d ? plural(d, "папка", "папки", "папок") : ""].filter(Boolean).join(" и ");
  }
  function pickItems(initial, onDone) {
    const api = window.__bsApi, M = new api.Modal(app); M.modalEl.classList.add("bsp2"); M.titleEl.setText("Что раздавать"); const c = M.contentEl;
    const sel = new Set(initial || []), open = new Set([""]); let q = "";
    const search = c.createEl("input", { cls: "bsp2-search", attr: { placeholder: "Найти файл или папку…", spellcheck: "false" } }), tree = c.createDiv({ cls: "bsp2-tree" }), foot = c.createDiv({ cls: "bsp2-foot" });
    const info = foot.createSpan({ cls: "bsp2-info" }), cancel = foot.createEl("button", { text: "Отмена" }), ok = foot.createEl("button", { text: "Готово", cls: "mod-cta" });
    const covered = (p) => { for (const s of sel) if (p === s || p.startsWith(s + "/")) return s; return null; }, partly = (p) => { for (const s of sel) if (s.startsWith(p + "/")) return true; return false; };
    const toggle = (p) => { const c0 = covered(p); if (c0 === p) sel.delete(p); else if (!c0) { for (const s of Array.from(sel)) if (s.startsWith(p + "/")) sel.delete(s); sel.add(p); } draw(); };
    const visible = (f) => !f.name.startsWith(".");
    const mkRow = (f, depth, flat) => {
      const isF = !!f.children, cov = covered(f.path), row = tree.createDiv({ cls: "bsp2-row" + (cov && cov !== f.path ? " is-lock" : "") }); row.style.paddingLeft = 8 + depth * 18 + "px";
      const car = row.createSpan({ cls: "bsp2-car" }); if (isF && !flat) { api.setIcon(car, open.has(f.path) ? "lucide-chevron-down" : "lucide-chevron-right"); car.onclick = (e) => { e.stopPropagation(); open.has(f.path) ? open.delete(f.path) : open.add(f.path); draw(); }; }
      const cb = row.createSpan({ cls: "bsp2-cb" + (cov ? " is-on" : partly(f.path) ? " is-part" : "") }); if (cov) api.setIcon(cb, "lucide-check"); else if (partly(f.path)) api.setIcon(cb, "lucide-minus");
      const ic = row.createSpan({ cls: "bsp2-ic" }); api.setIcon(ic, isF ? "lucide-folder" : "lucide-file-text"); row.createSpan({ cls: "bsp2-nm", text: flat ? f.path : f.name });
      row.title = cov && cov !== f.path ? "Входит в выбранную папку «" + cov + "»" : "";
      row.onclick = () => { if (cov && cov !== f.path) return; toggle(f.path); };
      if (isF && !flat && open.has(f.path)) walk(f, depth + 1);
    };
    const walk = (folder, depth) => { const kids = folder.children.filter(visible).sort((a, b) => (!!b.children - !!a.children) || a.name.localeCompare(b.name, "ru")); for (const k of kids) mkRow(k, depth, false); };
    const draw = () => {
      const st = tree.scrollTop; tree.empty();
      if (q) { const all = app.vault.getAllLoadedFiles().filter((f) => f.path !== "/" && visible(f) && !f.path.split("/").some((x) => x.startsWith(".")) && f.path.toLowerCase().includes(q)).slice(0, 150); for (const f of all) mkRow(f, 0, true); if (!all.length) tree.createDiv({ cls: "bsp2-none", text: "Ничего не найдено" }); }
      else walk(app.vault.getRoot(), 0);
      info.textContent = sel.size ? "Выбрано: " + describeList(Array.from(sel)) : "Ничего не выбрано"; tree.scrollTop = st;
    };
    search.oninput = () => { q = search.value.trim().toLowerCase(); draw(); };
    cancel.onclick = () => M.close(); ok.onclick = () => { if (!sel.size) { new api.Notice("Выберите хотя бы один файл или папку"); return; } M.close(); onDone(Array.from(sel)); };
    draw(); M.open(); setTimeout(() => search.focus(), 60);
  }
  let draft = null;   // a list chosen in the explorer menu, waiting for "Начать раздачу"

  // ---- the "Совместная работа" window
  const ROLE = { edit: "Редактор", view: "Только просмотр", banned: "Удалён" };
  const myRole = () => { const all = Array.from(shares.values()); if (!all.length || all.some((s) => s.owner)) return "owner"; return all.some((s) => s.readOnly) ? "view" : "edit"; };
  const TABS = { owner: [["ov", "Обзор"], ["pp", "Участники"], ["st", "Настройки"], ["lg", "Журнал"]], edit: [["ov", "Обзор"], ["pp", "Участники"], ["lg", "Журнал"], ["st", "Мои настройки"]], view: [["ov", "Обзор"], ["pp", "Участники"], ["st", "Мои настройки"]] };
  let panelEl = null;
  function panel(openTab) {
    if (panelEl) { panelEl.close(); if (!openTab) return; }
    const api = window.__bsApi, M = new api.Modal(app); panelEl = M; M.modalEl.classList.add("bsm"); M.titleEl.style.display = "none"; const root = M.contentEl; root.classList.add("bsm-root");
    const el = (parent, tag, cls, text) => { const x = parent.createEl(tag, { cls }); if (text != null) x.textContent = text; return x; };
    const icon = (parent, name, cls) => { const s = el(parent, "span", cls || "bsm-i"); api.setIcon(s, name); return s; };
    const btn = (parent, label, cls, fn, ic) => { const b = el(parent, "button", "bsm-btn " + (cls || "")); if (ic) icon(b, ic, "bsm-bi"); if (label) b.createSpan({ text: label }); if (fn) b.onclick = fn; return b; };
    const projName = (sh) => (sh.folder ? sh.folder.split("/").pop() : app.vault.getName());
    const copyTo = (b, text) => { try { navigator.clipboard.writeText(text); } catch (e) { return; } const w = b.querySelector("span:last-child"), was = w ? w.textContent : ""; b.classList.add("is-done"); if (w) w.textContent = "Скопировано"; setTimeout(() => { b.classList.remove("is-done"); if (w) w.textContent = was; }, 1500); };
    let tickFn = null, watchFn = null, screenName = "home";

    // ---- chrome: header (title, back, status pill), scrolling body, footer with "you"
    const head = el(root, "div", "bsm-head2"), back = el(head, "div", "bsm-back2"); api.setIcon(back, "lucide-arrow-left"); const ttl = el(head, "div", "bsm-title"), pill = el(head, "div", "bsm-pill"); pill.createSpan({ cls: "bsm-pd2" }); const pillT = pill.createSpan();
    const body = el(root, "div", "bsm-body"), foot = el(root, "div", "bsm-foot2");
    const setPill = () => {
      const all = Array.from(shares.values()), n = all.reduce((a, s) => a + s.peers.length, 0), srch = all.some((s) => s.prov && s.prov.status === "connecting");
      pill.className = "bsm-pill " + (!all.length ? "is-off" : n ? "is-live" : srch ? "is-wait" : "is-idle"); const t = !all.length ? "Раздача выключена" : n ? "Онлайн: " + (n + 1) : srch ? "Поиск…" : "Вы один"; if (pillT.textContent !== t) pillT.textContent = t;
    };
    const show = (name, title, build) => { screenName = name; tickFn = null; watchFn = null; body.empty(); ttl.textContent = title; back.style.display = name === "home" ? "none" : ""; const v = body.createDiv({ cls: "bsm-view" }); build(v); setPill(); };
    back.onclick = () => home();
    // you: name and colour, always at hand
    { const m = me(), dot = el(foot, "span", "bsm-mdot2"); dot.style.background = m.color; el(foot, "span", "bsm-you", "Вы:"); const inp = el(foot, "input", "bsm-name2"); inp.value = m.name; inp.placeholder = "Как вас называть?"; inp.spellcheck = false; const pal = el(foot, "div", "bsm-pal2");
      const save = (patch) => { const m2 = Object.assign(me(), patch); try { localStorage.setItem("board-me", JSON.stringify(m2)); localStorage.setItem("board-me-set", "1"); } catch (e) { /* private */ } for (const sh of shares.values()) sh.publish(); dot.style.background = m2.color; };
      inp.onchange = () => save({ name: inp.value.trim() || me().name });
      for (const c of PEER) { const s = el(pal, "div", "bsm-sw2" + (c === m.color ? " is-on" : "")); s.style.background = c; s.onclick = () => { save({ color: c }); pal.querySelectorAll(".bsm-sw2").forEach((x) => x.classList.toggle("is-on", x === s)); }; }
      let hint = null; try { hint = localStorage.getItem("board-me-set"); } catch (e) { /* private */ } if (!hint) setTimeout(() => { inp.focus(); inp.select(); }, 120); }

    // ================= home =================
    function home() {
      show("home", "Совместная работа", (v) => {
        const cards = el(v, "div", "bsm-cards");
        const card = (ic, t, d, fn) => { const c = el(cards, "div", "bsm-bigcard"); const i = el(c, "div", "bsm-bigic"); api.setIcon(i, ic); el(c, "div", "bsm-bigt", t); el(c, "div", "bsm-bigd", d); const st = el(c, "div", "bsm-bigs"); c.onclick = fn; return st; };
        const s1 = card("lucide-box", "Этот проект", "Раздача, приглашения, участники и настройки", () => project());
        const s2 = card("lucide-log-in", "Подключиться к проекту", "Вставьте код приглашения — проект откроется в этом окне", join); s2.textContent = "";
        tickFn = () => { const all = Array.from(shares.values()), n = all.reduce((a, s) => a + s.peers.length, 0), t = all.length ? "Раздача включена · " + (n ? "онлайн " + (n + 1) : "вы один") : "Раздача выключена"; if (s1.textContent !== t) s1.textContent = t; setPill(); };
        tickFn();
      });
    }

    // ================= project (tabs) =================
    function project(startTab) {
      const role = myRole(), list = TABS[role];
      show("project", "Этот проект", (v) => {
        let cur = list.some((t) => t[0] === startTab) ? startTab : "ov"; const tabs = el(v, "div", "bsm-tabs2"), area = el(v, "div", "bsm-tabarea"), tabEls = {};
        const draw = () => { for (const k in tabEls) tabEls[k].classList.toggle("is-on", k === cur); area.empty(); tickFn = null; ({ ov: tabOverview, pp: tabPeople, st: tabSettings, lg: tabLog })[cur](area, role); };
        for (const [k, t] of list) { const b = el(tabs, "div", "bsm-tab"); b.createSpan({ text: t }); b.createSpan({ cls: "bsm-badge" }); tabEls[k] = b; b.onclick = () => { if (cur !== k) { cur = k; draw(); } }; }
        draw();
        watchFn = () => { if (myRole() !== role) { project(cur); return; } const pend = Array.from(shares.values()).reduce((a, s) => a + (s.owner ? s.pendingList.length : 0), 0), bd = tabEls.pp && tabEls.pp.querySelector(".bsm-badge"); if (bd) { bd.textContent = pend ? String(pend) : ""; bd.classList.toggle("is-on", !!pend); } };
      });
    }
    const section = (parent, title, hint) => { const s = el(parent, "div", "bsm-sec2"); el(s, "div", "bsm-h2", title); if (hint) el(s, "div", "bsm-hint2", hint); return s; };
    const surface = (parent) => el(parent, "div", "bsm-surface");

    // ---- overview
    function tabOverview(b, role) {
      const banner = el(b, "div", "bsm-banner"); const bdot = el(banner, "span", "bsm-bdot"); const bt = el(banner, "div", "bsm-bt"); const b1 = el(bt, "div", "bsm-b1"), b2 = el(bt, "div", "bsm-b2");
      const dr = el(b, "div", "bsm-diagrow"); const dres = el(b, "div", "bsm-diag");
      const dbtn = btn(dr, "Проверить соединение", "ghost sm", async () => {
        dbtn.disabled = true; dres.empty(); const w = el(dres, "div", "bsm-dwait", "Проверяю… около 6 секунд");
        const rows = await diagnose(); dbtn.disabled = false; dres.empty();
        for (const r of rows) { const line = el(dres, "div", "bsm-dl " + (r.ok ? "is-ok" : "is-bad")); icon(line, r.ok ? "lucide-check-circle-2" : "lucide-alert-circle", "bsm-dli"); const t = el(line, "div", "bsm-dlt"); el(t, "div", "", r.text); if (r.hint) el(t, "div", "bsm-dlh", r.hint); }
      }, "lucide-activity");
      const mid = el(b, "div"), inv = el(b, "div"); let sigM = null, sigI = null, sigE = null, mode = "perm", pickChoice = draft ? "custom" : "all", chosen = draft ? draft.slice() : [];
      const tick = () => {
        setPill(); const all = Array.from(shares.values()), n = all.reduce((a, s) => a + s.peers.length, 0), srch = all.some((s) => s.prov && s.prov.status === "connecting"), pend0 = all.reduce((a, s) => a + s.q.size, 0), tot = all.reduce((a, s) => a + s.total, 0);
        banner.className = "bsm-banner " + (!all.length ? "is-off" : n ? "is-live" : srch || pend0 ? "is-wait" : "is-idle");
        const t1 = !all.length ? "Раздача выключена" : pend0 ? "Загрузка файлов: " + (tot - pend0) + " из " + tot : n ? "Раздача включена · онлайн " + (n + 1) : srch ? "Раздача включена · поиск участников…" : "Раздача включена · вы один", t2 = !all.length ? "Никто, кроме вас, не видит файлы этого хранилища" : (role === "view" ? "Вы только смотрите" : role === "edit" ? "Вы редактор" : "Вы владелец проекта");
        if (b1.textContent !== t1) b1.textContent = t1; if (b2.textContent !== t2) b2.textContent = t2;
        if (role === "view") return;
        if (role === "edit") { const ke = all.map((s2) => s2.folder).join(";") + "#" + all.length; if (ke !== sigE) { sigE = ke; inv.empty(); if (all.length) { const s2 = section(inv, "Код приглашения", "Любой, у кого этот код, сможет войти в проект."); const c2 = surface(s2); const f2 = el(c2, "div", "bsm-field"); const i2 = el(f2, "input", "bsm-code2"); i2.readOnly = true; i2.value = all[0].code(); i2.onfocus = () => i2.select(); btn(f2, "Копировать", "primary", function () { copyTo(this, all[0].code()); }, "lucide-copy"); } } return; }
        const sh = Array.from(shares.values())[0], sm = all.length + "|" + (sh ? JSON.stringify(sh.includeList()) : "") + "|" + pickChoice + "|" + chosen.join(",");
        if (sm !== sigM) { sigM = sm; mid.empty(); all.length ? shared(mid, sh) : notShared(mid); }
        const si = all.map((s) => s.folder + JSON.stringify(s.invites())).join(";") + mode; if (si !== sigI || (mode === "tmp" && all.length)) { if (si !== sigI) { sigI = si; inv.empty(); if (all.length) invite(inv, all[0], () => { sigI = null; }); } else if (all.length) updateInvites(); }
      };
      // before: choose what to share
      const notShared = (m) => {
        const s = section(m, "Что раздавать", "Можно поделиться всем хранилищем или только выбранными файлами и папками."); const choices = el(s, "div", "bsm-choices");
        const ch = (id, ic, t, d, fn) => { const c = el(choices, "div", "bsm-choice" + (pickChoice === id ? " is-on" : "")); const i = el(c, "span", "bsm-ci"); api.setIcon(i, ic); const tx = el(c, "div", "bsm-ctx"); el(tx, "div", "bsm-ct", t); el(tx, "div", "bsm-cd", d); const r = el(c, "span", "bsm-radio"); c.onclick = fn; return c; };
        ch("all", "lucide-box", "Всё хранилище «" + app.vault.getName() + "»", "Все заметки, доски и файлы, включая новые", () => { pickChoice = "all"; sigM = null; tick(); });
        ch("custom", "lucide-list-checks", "Только выбранное", chosen.length ? describeList(chosen) : "Файлы и папки на ваш выбор", () => { pickChoice = "custom"; if (!chosen.length) pickItems(chosen, (l) => { chosen = l; draft = l; sigM = null; tick(); }); else { sigM = null; tick(); } });
        if (pickChoice === "custom") { const r = el(s, "div", "bsm-selrow"); el(r, "span", "bsm-seltxt", chosen.length ? describeList(chosen) : "Ничего не выбрано"); btn(r, chosen.length ? "Изменить" : "Выбрать…", "sm", () => pickItems(chosen, (l) => { chosen = l; draft = l; sigM = null; tick(); }), "lucide-list-checks"); }
        const go = btn(m, "Начать раздачу", "primary big", async () => { if (pickChoice === "custom" && !chosen.length) { new api.Notice("Сначала выберите файлы или папки"); return; } go.disabled = true; go.querySelector("span:last-child").textContent = "Запускаю…"; await host("/", pickChoice === "custom" ? chosen : null); draft = null; sigM = null; sigI = null; tick(); }, "lucide-radio");
      };
      // while sharing: what is shared + invitations
      const shared = (m, sh) => {
        const s = section(m, "Состав раздачи"); const c = surface(s); const L = sh.includeList(); const row = el(c, "div", "bsm-selrow"); const tx = el(row, "div", "bsm-seltxt");
        el(tx, "div", "bsm-n2", L ? describeList(L) : (sh.folder ? "Папка «" + projName(sh) + "»" : "Всё хранилище «" + app.vault.getName() + "»")); el(tx, "div", "bsm-s2", L ? "Остальное остаётся только у вас" : "Новые файлы подключаются автоматически");
        if (sh.owner) btn(row, "Изменить", "sm", () => pickItems(L || [], (l) => { sh.setInclude(l); sigM = null; tick(); }), "lucide-list-checks");
        if (L && L.length) { const chips = el(c, "div", "bsm-chips"); for (const p of L.slice(0, 12)) { const o = app.vault.getAbstractFileByPath(sh.abs(p)); const ch = el(chips, "span", "bsm-chip"); icon(ch, o && o.children ? "lucide-folder" : "lucide-file-text", "bsm-chi"); ch.createSpan({ text: p.replace(/^.*\//, "") }); ch.title = p; } if (L.length > 12) el(chips, "span", "bsm-chip is-more", "+" + (L.length - 12)); }
        const st = el(m, "div", "bsm-stoprow"); btn(st, "Остановить раздачу", "danger ghost", async () => { await stop(sh.folder || "/"); sigM = null; sigI = null; tick(); }, "lucide-square");
      };
      const invite = (host0, sh, refresh) => {
        const s = section(host0, "Приглашение"); const seg = el(s, "div", "bsm-seg2"); const mk = (k, t) => { const x = el(seg, "div", "bsm-sg" + (mode === k ? " is-on" : ""), t); x.onclick = () => { mode = k; refresh(); tick(); }; }; mk("perm", "Постоянный код"); mk("tmp", "Временный код");
        const c = surface(s);
        if (mode === "perm") {
          el(c, "div", "bsm-hint2", "Один код для всех. Права каждого вы задаёте потом, во вкладке «Участники».");
          const f = el(c, "div", "bsm-field"); const i = el(f, "input", "bsm-code2"); i.readOnly = true; i.value = sh.code(); i.onfocus = () => i.select(); btn(f, "Копировать", "primary", function () { copyTo(this, sh.code()); }, "lucide-copy");
          btn(c, "Копировать приглашение с инструкцией", "ghost wide", function () { copyTo(this, "Присоединяйся к проекту «" + projName(sh) + "» в Basalt.\nОткрой «Совместная работа» (кнопка с человечком слева) → «Подключиться к проекту» → вставь код:\n" + sh.code()); }, "lucide-copy");
        } else {
          el(c, "div", "bsm-hint2", "Код сработает ограниченное время или один раз. Создание временного кода включает подтверждение входов для тех, у кого обычный код.");
          const f = el(c, "div", "bsm-form"); const sel = el(f, "select", "bsm-sel"); for (const [h, t] of [[1, "1 час"], [6, "6 часов"], [24, "24 часа"], [168, "7 дней"], [0, "Без срока"]]) { const o = sel.createEl("option", { text: t }); o.value = h; } sel.value = 24;
          const once = el(f, "label", "bsm-chk"); const cb = once.createEl("input", { attr: { type: "checkbox" } }); cb.checked = true; once.createSpan({ text: "Одноразовый" });
          btn(f, "Создать код", "primary", () => { sh.createInvite(+sel.value, cb.checked); sigI = null; refresh(); tick(); }, "lucide-timer");
          el(c, "div", "bsm-invs");
        }
        updateInvites();
      };
      const fmtLeft = (ms) => { if (ms <= 0) return "истёк"; const m = Math.floor(ms / 60000); if (m < 60) return "осталось " + Math.max(1, m) + " мин"; const h = Math.floor(m / 60); return h < 48 ? "осталось " + h + " ч " + (m % 60) + " мин" : "осталось " + Math.floor(h / 24) + " дн"; };
      const updateInvites = () => {
        const box = inv.querySelector(".bsm-invs"); if (!box) return; const sh = Array.from(shares.values())[0]; if (!sh) return; const list = sh.invites().sort((a, c) => c.t - a.t), sig = list.map((v) => v.id + v.used + (sh.inviteValid(v) ? 1 : 0)).join("|");
        if (box.dataset.sig !== sig) {
          box.dataset.sig = sig; box.empty(); if (!list.length) el(box, "div", "bsm-empty2", "Временных кодов пока нет");
          for (const v of list) {
            const r = el(box, "div", "bsm-inv" + (sh.inviteValid(v) ? "" : " is-dead")); const tx = el(r, "div", "bsm-tx"); const code = sh.code(v.id); el(tx, "div", "bsm-n2 bsm-mono", "…" + v.id); const st = el(tx, "div", "bsm-s2"); st.dataset.id = v.id;
            btn(r, "", "icon", function () { copyTo(this, code); }, "lucide-copy").title = "Копировать код"; btn(r, "", "icon danger", () => { sh.revokeInvite(v.id); box.dataset.sig = ""; updateInvites(); }, "lucide-trash-2").title = "Отозвать";
          }
        }
        for (const v of list) { const st = box.querySelector('[data-id="' + v.id + '"]'); if (!st) continue; const dead = !sh.inviteValid(v); const t = (v.once ? "Одноразовый · " : "") + (v.used ? "использован" : v.exp ? (dead ? "срок истёк" : fmtLeft(v.exp - Date.now())) : "без срока"); if (st.textContent !== t) st.textContent = t; }
      };
      tickFn = tick; tick();
    }

    // ---- people
    function tabPeople(b, role) {
      const pend = el(b, "div", "bsm-pend"), list = el(b, "div", "bsm-people2"); let sigW = "", sigP = "";
      const tick = () => {
        setPill(); const all = Array.from(shares.values()), reqs = role === "owner" ? all.flatMap((s) => s.pendingList.map((r) => ({ s, r }))) : [], sp = reqs.map((x) => x.r.pid).join("|");
        if (sp !== sigP) { sigP = sp; pend.empty(); for (const { s, r } of reqs) { const row = el(pend, "div", "bsm-req2"); icon(row, "lucide-user-plus", "bsm-ri"); el(row, "span", "bsm-rt", "Кто-то хочет войти в «" + projName(s) + "»"); btn(row, "Принять", "primary sm", () => { s.approve(r.pid, r.uid); sigP = ""; tick(); }); btn(row, "Отклонить", "ghost sm", () => { s.pendingList = s.pendingList.filter((x) => x.pid !== r.pid); sigP = ""; tick(); }); } }
        const af = app.workspace.getActiveFile(), rows = [{ u: me(), self: true, sh: all[0], what: af ? "«" + af.basename + "»" : "в сети" }], seen = new Set();
        for (const sh of all) for (const u of sh.peers) { const k = peerKey(u); if (!seen.has(k)) { seen.add(k); rows.push({ u, sh, self: false, what: where(u) }); } }
        const sw = role + rows.map((p) => peerKey(p.u) + "|" + p.what + "|" + (p.sh && !p.self ? p.sh.roleOf(p.u.uid) : "") + "|" + (following === peerKey(p.u))).join(";");
        if (sw === sigW) return; sigW = sw; list.empty();
        for (const p of rows) {
          const row = el(list, "div", "bsm-person2"); const d = el(row, "span", "bsm-pd3"); d.style.background = p.u.color; const tx = el(row, "div", "bsm-tx"); const nm = el(tx, "div", "bsm-n2", p.u.name + (p.self ? " (вы)" : ""));
          if (p.self) el(nm, "span", "bsm-role-pill is-" + (role === "owner" ? "owner" : role), role === "owner" ? "Владелец" : ROLE[role]); else if (p.sh) { const r0 = p.sh.roleOf(p.u.uid); if (p.sh.canWrite && p.u.uid === p.sh.meta.get("owner")) el(nm, "span", "bsm-role-pill is-owner", "Владелец"); else if (role !== "owner") el(nm, "span", "bsm-role-pill is-" + r0, ROLE[r0] || "Редактор"); }
          el(tx, "div", "bsm-s2", p.what); if (p.self) continue;
          const act = el(row, "div", "bsm-pa2");
          if (role === "owner" && p.sh && p.u.uid && p.u.uid !== p.sh.meta.get("owner")) { const sel = el(act, "select", "bsm-sel sm"); for (const k of ["edit", "view", "banned"]) { const o = sel.createEl("option", { text: ROLE[k] }); o.value = k; } sel.value = p.sh.roleOf(p.u.uid); sel.onchange = () => { p.sh.setRole(p.u.uid, sel.value); sigW = ""; }; }
          btn(act, "", "icon", () => { if (!openWhere(p.sh, p.u)) new api.Notice("Он пока ничего не открыл"); }, "lucide-crosshair").title = "Перейти туда, где он сейчас";
          const fl = btn(act, "", "icon" + (following === peerKey(p.u) ? " is-on" : ""), () => { following = following === peerKey(p.u) ? null : peerKey(p.u); followSig = ""; sigW = ""; tick(); if (following) new api.Notice("Вы следите за " + p.u.name + ". Нажмите на глаз ещё раз, чтобы остановить."); }, "lucide-eye"); fl.title = following === peerKey(p.u) ? "Перестать следить" : "Следить за ним";
        }
        if (rows.length === 1) { const e = el(list, "div", "bsm-empty3"); icon(e, "lucide-users", "bsm-ei"); el(e, "div", "bsm-et", all.length ? "Пока никого рядом" : "Раздача выключена"); el(e, "div", "bsm-ed", all.length ? "Отправьте код приглашения — вкладка «Обзор»." : "Включите раздачу во вкладке «Обзор»."); }
      };
      tickFn = tick; tick();
    }

    // ---- settings
    function toggleRow(parent, ic, title, sub, on, fn) {
      const r = el(parent, "div", "bsm-trow2"); icon(r, ic, "bsm-ti2"); const tx = el(r, "div", "bsm-tx"); el(tx, "div", "bsm-n2", title); el(tx, "div", "bsm-s2", sub);
      const sw = el(r, "span", "bsm-switch2" + (on ? " is-on" : "")); el(sw, "span", "bsm-knob2"); r.onclick = () => { fn(!sw.classList.contains("is-on")); sw.classList.toggle("is-on"); };
    }
    function tabSettings(b, role) {
      const own = Array.from(shares.values()).find((s) => s.owner);
      if (role === "owner" && own) {
        const s = section(b, "Проект"); toggleRow(s, "lucide-shield-check", "Подтверждать входы", "Новый участник входит, только когда вы нажмёте «Принять». Работает, пока вы в сети.", !!own.meta.get("approval"), (on) => own.setApproval(on));
        const s2 = section(b, "Права новых участников", "Что смогут делать новые участники сразу после входа. Менять права каждого можно во вкладке «Участники»."); const seg = el(s2, "div", "bsm-seg2"); const def = own.meta.get("defaultRole") === "view" ? "view" : "edit", segs = {};
        for (const k of ["edit", "view"]) { const x = el(seg, "div", "bsm-sg" + (def === k ? " is-on" : ""), ROLE[k]); segs[k] = x; x.onclick = () => { own.setDefaultRole(k); for (const y in segs) segs[y].classList.toggle("is-on", y === k); }; }
      }
      const p = prefs(), s3 = section(b, "Мои настройки");
      toggleRow(s3, "lucide-bell", "Уведомления", "Сообщать, когда кто-то подключился, вышел или изменил файл.", p.notify, (on) => setPrefs({ notify: on }));
      toggleRow(s3, "lucide-volume-2", "Звуки", "Тихий сигнал при входе, выходе и запросе на вход.", p.sound, (on) => { setPrefs({ sound: on }); if (on) beep("join"); });
      toggleRow(s3, "lucide-mouse-pointer-2", "Мышь других участников", "Показывать их указатели и курсоры в файлах.", p.pointers, (on) => setPrefs({ pointers: on }));
      const s4 = section(b, "Серверы", "Свои relay-серверы Nostr, через запятую (необязательно). По умолчанию используются публичные. Изменения вступают в силу после перезапуска раздачи."); const sg = el(s4, "input", "bsm-input"); sg.placeholder = "wss://…"; sg.value = signaling().join(", "); sg.onchange = () => { try { localStorage.setItem("board-signaling", JSON.stringify(sg.value.split(",").map((x) => x.trim()).filter(Boolean))); } catch (e) { /* private */ } };
      const s5 = section(b, "TURN-сервер", "Нужен, если компьютеры в разных сетях и напрямую не соединяются (мобильный интернет, строгий роутер). Адрес вида turn:host:3478. Можно взять бесплатный у провайдеров TURN или поднять свой."); let tj = {}; try { tj = JSON.parse(localStorage.getItem("board-turn") || "{}") || {}; } catch (e) { /* none */ }
      const tf = (ph, key, type) => { const i = el(s5, "input", "bsm-input"); i.placeholder = ph; if (type) i.type = type; i.value = tj[key] || ""; i.style.marginBottom = "6px"; i.onchange = () => { tj[key] = i.value.trim(); try { localStorage.setItem("board-turn", JSON.stringify(tj)); } catch (e) { /* private */ } }; };
      tf("turn:host:3478", "url"); tf("Логин", "user"); tf("Пароль", "pass", "password");
    }
    // ---- log
    function tabLog(b) {
      const list = el(b, "div", "bsm-loglist2"); let sig = "";
      const draw = () => {
        setPill(); const items = Array.from(shares.values()).flatMap((sh) => sh.log.toArray().map((e) => ({ sh, e }))).sort((a, c) => c.e.t - a.e.t).slice(0, 80), s2 = items.map((x) => x.e.t + x.e.rel).join("|"); if (s2 === sig) return; sig = s2; list.empty();
        if (!items.length) { const e = el(list, "div", "bsm-empty3"); icon(e, "lucide-history", "bsm-ei"); el(e, "div", "bsm-et", "Записей пока нет"); el(e, "div", "bsm-ed", "Здесь появится, кто и когда менял файлы."); }
        for (const { sh, e } of items) {
          const r = el(list, "div", "bsm-ev2"); el(r, "span", "bsm-evt2", new Date(e.t).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })); const tx = el(r, "div", "bsm-tx");
          el(tx, "div", "bsm-n2", e.who + " — " + ({ edit: "изменил", create: "создал", delete: "удалил", rollback: "откатил" }[e.kind] || e.kind) + " «" + e.rel.replace(/^.*\//, "") + "»"); el(tx, "div", "bsm-s2", e.rel);
          if (e.before != null && (e.kind === "edit" || e.kind === "rollback")) btn(r, "Откатить", "sm", () => { if (sh.rollback(e)) { new api.Notice("Откачено: «" + e.rel.replace(/^.*\//, "") + "»"); sig = ""; draw(); } }, "lucide-undo-2");
        }
      };
      draw(); tickFn = draw;
    }

    // ================= join =================
    function join() {
      show("join", "Подключиться к проекту", (v) => {
        const s = section(v, "Код приглашения", "Вставьте код, который вам прислали. Проект откроется в этом окне."); const f = el(s, "div", "bsm-field"); const inp = el(f, "input", "bsm-code2"); inp.placeholder = "basalt-share:…"; inp.spellcheck = false; const go = btn(f, "Войти", "primary", async () => { go.disabled = true; if (!(await joinCode(inp.value))) go.disabled = false; else M.close(); }, "lucide-log-in");
        inp.onkeydown = (e) => { if (e.key === "Enter") go.click(); }; setTimeout(() => inp.focus(), 80);
        const others = otherVaults(); if (others.length) { const s2 = section(v, "Уже подключённые проекты"); for (const o of others) { const r = el(s2, "div", "bsm-row3"); icon(r, "lucide-box", "bsm-ti2"); el(r, "span", "bsm-n2", o.name); btn(r, "Открыть", "sm", () => switchTo(o.path)); } }
      });
    }

    const iv = setInterval(() => { if (tickFn) tickFn(); if (watchFn) watchFn(); setPill(); }, 1000); const onPeers = () => { if (tickFn) tickFn(); }; document.addEventListener("basalt-share-peers", onPeers);
    M.onClose = () => { clearInterval(iv); document.removeEventListener("basalt-share-peers", onPeers); panelEl = null; };
    M.open(); if (openTab === "project") project("ov"); else home();
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
    const relOf = (path) => { for (const sh of shares.values()) { const r = sh.rel(path); if (r != null && !sh.skip(r)) return { sh, rel: r }; } return null; };
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
      requestAnimationFrame(frame); if (!shares.size || !prefs().pointers) { if (ptrs.size) { for (const o of ptrs.values()) o.el.remove(); ptrs.clear(); } return; }
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
    // explorer: add a file / folder to the share, take it out, or start sharing it
    app.workspace.on("file-menu", (menu, f) => {
      if (!f || f.path === "/" || String(f.path).split("/").some((x) => x.startsWith("."))) return; const sh = shares.get("");
      if (sh) { if (!sh.owner) return; const L = sh.includeList(); if (!L) return; const exact = L.includes(f.path), inside = !exact && sh.inScope(f.path);
        if (exact) menu.addItem((i) => i.setTitle("Убрать из раздачи").setIcon("lucide-eye-off").onClick(() => { sh.setInclude(L.filter((x) => x !== f.path)); new window.__bsApi.Notice("«" + f.name + "» больше не раздаётся"); }));
        else if (inside) menu.addItem((i) => i.setTitle("Раздаётся вместе с папкой").setIcon("lucide-users"));
        else menu.addItem((i) => i.setTitle("Добавить в раздачу").setIcon("lucide-share-2").onClick(() => { sh.setInclude(L.concat([f.path])); new window.__bsApi.Notice("«" + f.name + "» добавлено в раздачу"); }));
      } else if (!shares.size) menu.addItem((i) => i.setTitle("Поделиться…").setIcon("lucide-share-2").onClick(() => { draft = [f.path]; panel("project"); }));
    });
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
