// Basalt local API: a small HTTP server inside the app for scripts, bots and the `basalt` command line (cli/basalt.mjs).
// Localhost only, every request needs the token (header "Authorization: Bearer <token>"), browsers are refused (no Origin allowed,
// the Host header must be the loopback address, so DNS rebinding does not work). Address and token are written to
// <userData>/basalt-api.json so the CLI finds them. The full contract is in docs/api/openapi.yaml, the guide in docs/API.md.
(() => {
  "use strict";
  const fs = window.require("fs"), path = window.require("path"), http = window.require("http"), crypto = window.require("crypto");
  const API_VERSION = 2;

  const userData = () => window.electron.remote.app.getPath("userData");
  const infoFile = () => path.join(userData(), "basalt-api.json");
  const settingsFile = () => path.join(userData(), "basalt-api-settings.json");
  const readJsonFile = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { return {}; } };
  const readInfo = () => readJsonFile(infoFile());

  class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
  const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

  const safe = (p) => {
    if (typeof p !== "string" || !p) return null;
    const n = p.replace(/\\/g, "/").replace(/^\/+/, "");
    if (n.split("/").some((s) => s === ".." || s === ".git") || /^[a-zA-Z]:/.test(n)) return null;
    return n;
  };
  const send = (res, code, body, type) => {
    const data = typeof body === "string" ? body : JSON.stringify(body);
    res.writeHead(code, { "Content-Type": type || (typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8"), "Cache-Control": "no-store" });
    res.end(data);
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > 50 * 1024 * 1024) { reject(new HttpError(413, "body too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
  const readText = async (req) => (await readBody(req)).toString("utf8");
  const readJson = async (req) => { const t = await readText(req); if (!t.trim()) return {}; try { return JSON.parse(t); } catch (e) { return fail(400, "body is not valid JSON"); } };

  const ensureFolder = async (p) => {
    const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    if (dir && !(await app.vault.adapter.exists(dir))) await app.vault.createFolder(dir).catch(() => {});
  };
  const fileOf = (p) => { const f = app.vault.getAbstractFileByPath(p); return f && f.extension !== undefined ? f : null; };
  const needFile = (p) => { const f = p && fileOf(p); return f || fail(404, "not found"); };
  const needPath = (p) => p || fail(400, "valid path is required");

  // ---------- events (Server-Sent Events) ----------
  const clients = new Set(); let eventId = 0;
  const emit = (type, data) => {
    if (!clients.size) return;
    const msg = `id: ${++eventId}\nevent: ${type}\ndata: ${JSON.stringify({ type, time: Date.now(), ...data })}\n\n`;
    for (const r of clients) { try { r.write(msg); } catch (e) { clients.delete(r); } }
  };
  const hookedViews = new WeakSet(), boardTimers = new Map();
  function hookBoards() {
    for (const v of boardViews()) {
      if (hookedViews.has(v)) continue; hookedViews.add(v);
      v.doc.on("update", () => { const p = v.path; clearTimeout(boardTimers.get(p)); boardTimers.set(p, setTimeout(() => emit("board-change", { path: p, cards: v.yn.size, links: v.ye.size }), 150)); });
    }
  }
  function startEvents() {
    const on = (src, name, fn) => { try { src.on(name, fn); } catch (e) { /* source without this event */ } };
    on(app.vault, "create", (f) => emit("file-create", { path: f.path }));
    on(app.vault, "modify", (f) => emit("file-modify", { path: f.path }));
    on(app.vault, "delete", (f) => emit("file-delete", { path: f.path }));
    on(app.vault, "rename", (f, old) => emit("file-rename", { path: f.path, oldPath: old }));
    on(app.workspace, "file-open", (f) => emit("file-open", { path: f ? f.path : null }));
    on(app.workspace, "active-leaf-change", () => { hookBoards(); emit("active-leaf-change", { path: activePath() }); });
    on(app.workspace, "layout-change", () => { hookBoards(); emit("layout-change", {}); });
    setInterval(() => { for (const r of clients) { try { r.write(": ping\n\n"); } catch (e) { clients.delete(r); } } }, 20000);
    hookBoards();
  }

  // ---------- boards (the open ones, through their BoardView) ----------
  const uid = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");
  const COLORS = { red: "#e5484d", orange: "#f59f3b", yellow: "#d6b43c", green: "#46a758", blue: "#3fa7d6", purple: "#8e6bd8", none: "" };
  const colorOf = (c) => (c == null ? "" : c in COLORS ? COLORS[c] : /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : fail(400, "bad colour: " + c));
  const boardViews = () => app.workspace.getLeavesOfType("basalt-board").map((l) => l.view).filter((v) => v && v.doc && v.yn);
  async function viewFor(p, open) {
    needPath(p);
    let v = boardViews().find((x) => x.path === p);
    if (!v && open) {
      await app.workspace.getLeaf("tab").openFile(needFile(p));
      for (let i = 0; i < 40 && !v; i++) { v = boardViews().find((x) => x.path === p); if (!v) await new Promise((r) => setTimeout(r, 100)); }
    }
    return v || fail(409, "board is not open in the app", { hint: "pass open=1, open it with POST /v1/open, or edit the file with PUT /v1/file" });
  }
  const KEYS = ["x", "y", "w", "h", "color", "kind", "frame", "group", "img", "fold", "locked", "by"];
  const cardsOf = (v) => { const out = []; v.yn.forEach((m, id) => { const c = { id, text: m.get("text") ? m.get("text").toString() : "" }; for (const k of KEYS) { const x = m.get(k); if (x !== undefined && x !== null && x !== "" && x !== false && !(k === "img")) c[k] = x; } if (m.get("img")) c.hasImage = true; out.push(c); }); return out; };
  const linksOf = (v) => { const out = []; v.ye.forEach((m, id) => { const e = { id }; for (const k of ["a", "b", "label", "sa", "sb", "sh", "ls", "ad", "ec"]) { const x = m.get(k); if (x !== undefined && x !== null && x !== "") e[k] = x; } out.push(e); }); return out; };
  const boardState = (v) => ({ path: v.path, cards: cardsOf(v), links: linksOf(v) });
  const cardId = (v, id) => { if (v.yn.has(id)) return id; const h = [...v.yn.keys()].filter((k) => k.startsWith(id || "\u0000")); return h.length === 1 ? h[0] : fail(h.length ? 400 : 404, h.length ? "card id is ambiguous" : "no such card"); };
  function patchCard(v, m, o) {
    for (const [k, val] of Object.entries(o)) {
      if (val === undefined) continue;
      if (k === "text") v.setText(m, String(val));
      else if (k === "color") m.set("color", colorOf(val));
      else if (["x", "y", "w", "h"].includes(k)) m.set(k, Math.round(Number(val)));
      else if (k === "fold" || k === "locked") { if (val) m.set(k, true); else m.delete(k); }
      else if (k === "kind") { if (val) m.set("kind", String(val)); else m.delete("kind"); }
    }
    v.stampM(m);
  }
  const boardOps = {
    add(v, o) {
      const Y = window.__bsY.Y, id = o.id && !v.yn.has(o.id) ? String(o.id) : uid(), m = new Y.Map(), t = new Y.Text();
      let { x, y } = o; if (x == null || y == null) { const ids = [...v.yn.keys()], bb = ids.length ? v.bounds(ids) : null; x = bb ? bb.x + bb.w + 60 : 0; y = bb ? bb.y : 0; }
      v.doc.transact(() => {
        m.set("x", Math.round(x)); m.set("y", Math.round(y)); m.set("w", Math.round(o.w || 260)); m.set("h", Math.round(o.h || 110)); m.set("color", colorOf(o.color)); m.set("by", "api");
        if (o.kind) m.set("kind", String(o.kind)); v.stampM(m); t.insert(0, String(o.text == null ? "" : o.text)); m.set("text", t); v.yn.set(id, m);
      });
      return id;
    },
  };
  const rw = (v) => { if (v.ro) fail(403, "board is read-only or locked"); };

  const activePath = () => { const f = app.workspace.getActiveFile && app.workspace.getActiveFile(); return f ? f.path : null; };
  const settings = () => ({ eval: false, ...readJsonFile(settingsFile()) });

  // ---------- routes ----------
  const routes = {
    "GET /v1/status": () => {
      const files = app.vault.getFiles();
      return { app: "Basalt", api: API_VERSION, vault: app.vault.getName(), vaultPath: app.vault.adapter.getBasePath ? app.vault.adapter.getBasePath() : null, notes: files.filter((f) => f.extension === "md").length, canvases: files.filter((f) => f.extension === "canvas").length, boards: files.filter((f) => f.extension === "board").length, files: files.length, activeFile: activePath(), openBoards: boardViews().map((v) => v.path), eval: !!settings().eval };
    },
    "GET /v1/files": ({ q }) => {
      const prefix = (q.get("folder") || "").replace(/^\/+|\/+$/g, ""), exts = (q.get("ext") || "").split(",").filter(Boolean);
      return app.vault.getFiles().filter((f) => (!prefix || f.path.startsWith(prefix + "/")) && (!exts.length || exts.includes(f.extension))).slice(0, +q.get("limit") || 5000).map((f) => ({ path: f.path, size: f.stat.size, mtime: f.stat.mtime }));
    },
    "GET /v1/search": async ({ q }) => {
      const text = q.get("q") || ""; if (!text.trim()) fail(400, "q is required");
      if (window.__bsSearchApi) return window.__bsSearchApi(text, +q.get("limit") || 20);
      const low = text.toLowerCase(), out = [];
      for (const f of app.vault.getMarkdownFiles()) { if (out.length >= (+q.get("limit") || 20)) break; const t = await app.vault.cachedRead(f); const i = t.toLowerCase().indexOf(low); if (i >= 0 || f.basename.toLowerCase().includes(low)) out.push({ path: f.path, title: f.basename, snippet: t.slice(Math.max(0, i - 40), i + 100) }); }
      return out;
    },
    "POST /v1/search/run": async ({ q }) => {
      const text = q.get("q") || ""; if (!text.trim()) fail(400, "q is required");
      app.commands.executeCommandById("global-search:open");
      await new Promise((r) => setTimeout(r, 250));
      const leaf = app.workspace.getLeavesOfType("search")[0], view = leaf && leaf.view;
      if (!view || !view.setQuery) fail(501, "the search pane is not available");
      view.setQuery(text); return { ok: true, query: text };
    },
    // notes (kept from API v1) and generic files
    "GET /v1/note": async ({ p }) => app.vault.read(needFile(p)),
    "PUT /v1/note": async ({ p, req }) => {
      needPath(p); const body = await readText(req), f = fileOf(p);
      if (f) await app.vault.modify(f, body); else { await ensureFolder(p); await app.vault.create(p, body); }
      return { ok: true, path: p, created: !f };
    },
    "POST /v1/note/append": async ({ p, req }) => {
      needPath(p); const body = await readText(req), f = fileOf(p);
      if (f) await app.vault.append(f, (body.startsWith("\n") ? "" : "\n") + body); else { await ensureFolder(p); await app.vault.create(p, body); }
      return { ok: true, path: p, created: !f };
    },
    "DELETE /v1/note": async ({ p }) => { await app.vault.trash(needFile(p), true); return { ok: true }; },
    "GET /v1/file": async ({ p, q }) => {
      const f = needFile(p);
      if (q.get("encoding") === "base64") return Buffer.from(await app.vault.adapter.readBinary(f.path)).toString("base64");
      return app.vault.read(f);
    },
    "PUT /v1/file": async ({ p, q, req }) => {
      needPath(p); const f = fileOf(p);
      if (q.get("encoding") === "base64") { const buf = Buffer.from(await readText(req), "base64"); await ensureFolder(p); await app.vault.adapter.writeBinary(p, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)); return { ok: true, path: p, created: !f, bytes: buf.length }; }
      const body = await readText(req);
      if (f) await app.vault.modify(f, body); else { await ensureFolder(p); await app.vault.create(p, body); }
      return { ok: true, path: p, created: !f, bytes: Buffer.byteLength(body) };
    },
    "DELETE /v1/file": async ({ p, q }) => { const f = needFile(p); if (q.get("force") === "1") await app.vault.delete(f, true); else await app.vault.trash(f, true); return { ok: true, force: q.get("force") === "1" }; },
    "POST /v1/move": async ({ p, q }) => {
      const f = needFile(p), to = safe(q.get("to")); if (!to) fail(400, "valid to is required");
      if (app.vault.getAbstractFileByPath(to)) fail(409, "destination exists");
      await ensureFolder(to); await app.fileManager.renameFile(f, to); return { ok: true, path: to };
    },
    "GET /v1/note/meta": ({ p }) => {
      const f = needFile(p), c = app.metadataCache.getFileCache(f) || {}, rl = app.metadataCache.resolvedLinks || {};
      const backlinks = Object.keys(rl).filter((src) => rl[src] && rl[src][f.path] && src !== f.path);
      return { path: f.path, frontmatter: c.frontmatter || {}, tags: (c.tags || []).map((t) => t.tag), headings: (c.headings || []).map((h) => ({ level: h.level, text: h.heading })), links: (c.links || []).map((l) => ({ link: l.link, text: l.displayText })), resolved: Object.keys(rl[f.path] || {}), backlinks };
    },
    "GET /v1/backlinks": ({ p }) => { const f = needFile(p), rl = app.metadataCache.resolvedLinks || {}; return Object.keys(rl).filter((s) => rl[s] && rl[s][f.path] && s !== f.path).map((s) => ({ path: s, count: rl[s][f.path] })); },
    "GET /v1/graph": ({ q }) => {
      const rl = app.metadataCache.resolvedLinks || {}, ul = app.metadataCache.unresolvedLinks || {}, nodes = new Set(), edges = [], withU = q.get("unresolved") === "1";
      for (const [s, ds] of Object.entries(rl)) { nodes.add(s); for (const [d, n] of Object.entries(ds)) { nodes.add(d); edges.push({ source: s, target: d, count: n }); } }
      if (withU) for (const [s, ds] of Object.entries(ul)) for (const [d, n] of Object.entries(ds)) { nodes.add(s); nodes.add("?" + d); edges.push({ source: s, target: "?" + d, count: n, unresolved: true }); }
      return { nodes: [...nodes].map((id) => ({ id })), edges };
    },
    "GET /v1/tags": () => app.metadataCache.getTags ? app.metadataCache.getTags() : {},
    "GET /v1/workspace": () => ({ activeFile: activePath(), leaves: ["markdown", "basalt-board", "canvas", "image", "pdf", "graph"].flatMap((t) => app.workspace.getLeavesOfType(t).map((l) => ({ type: t, path: l.view && (l.view.path || (l.view.file && l.view.file.path)) || null }))) }),
    "POST /v1/open": async ({ p, q }) => {
      const f = needFile(p), leaf = app.workspace.getLeaf(q.get("new") === "0" ? false : "tab");
      await leaf.openFile(f, q.get("line") ? { eState: { line: +q.get("line") - 1 } } : undefined); return { ok: true };
    },
    "GET /v1/commands": ({ q }) => { const s = (q.get("q") || "").toLowerCase(); return Object.values(app.commands.commands).filter((c) => !s || c.id.toLowerCase().includes(s) || String(c.name).toLowerCase().includes(s)).map((c) => ({ id: c.id, name: c.name })); },
    "POST /v1/command": ({ q }) => {
      const id = q.get("id"); if (!id) fail(400, "id is required");
      if (!app.commands.commands[id]) fail(404, "unknown command: " + id);
      return { ok: !!app.commands.executeCommandById(id), id };
    },
    // boards that are open in the app
    "GET /v1/boards/open": () => boardViews().map((v) => ({ path: v.path, cards: v.yn.size, links: v.ye.size, active: app.workspace.getActiveViewOfType ? app.workspace.getActiveViewOfType(v.constructor) === v : false })),
    "GET /v1/board": async ({ p, q }) => boardState(await viewFor(p, q.get("open") === "1")),
    "POST /v1/board/card": async ({ p, q, req }) => { const v = await viewFor(p, q.get("open") === "1"); rw(v); const id = boardOps.add(v, await readJson(req)); return { ok: true, id }; },
    "PATCH /v1/board/card": async ({ p, q, req }) => {
      const v = await viewFor(p, q.get("open") === "1"); rw(v); const id = cardId(v, q.get("id")), body = await readJson(req);
      v.doc.transact(() => patchCard(v, v.yn.get(id), body)); return { ok: true, id };
    },
    "DELETE /v1/board/card": async ({ p, q }) => {
      const v = await viewFor(p, q.get("open") === "1"); rw(v); const id = cardId(v, q.get("id")); let links = 0;
      v.doc.transact(() => { for (const [k, e] of Array.from(v.ye.entries())) if (e.get("a") === id || e.get("b") === id) { v.ye.delete(k); links++; } v.yn.delete(id); });
      v.sel && v.sel.delete(id); return { ok: true, id, linksRemoved: links };
    },
    "POST /v1/board/link": async ({ p, q, req }) => {
      const v = await viewFor(p, q.get("open") === "1"); rw(v); const b = await readJson(req), a = cardId(v, b.a), c = cardId(v, b.b), Y = window.__bsY.Y, m = new Y.Map(), id = uid();
      v.doc.transact(() => { m.set("a", a); m.set("b", c); m.set("label", b.label || ""); for (const k of ["sa", "sb"]) if (b[k]) m.set(k, b[k]); v.ye.set(id, m); }); return { ok: true, id };
    },
    "DELETE /v1/board/link": async ({ p, q }) => { const v = await viewFor(p, q.get("open") === "1"); rw(v); const id = q.get("id"); if (!v.ye.has(id)) fail(404, "no such link"); v.ye.delete(id); return { ok: true, id }; },
    "POST /v1/board/layout": async ({ p, q }) => {
      const v = await viewFor(p, q.get("open") === "1"); rw(v); const mode = q.get("mode") || "auto";
      if (!["auto", "lr", "td", "radial", "force"].includes(mode)) fail(400, "mode is auto, lr, td, radial or force");
      v.layout(mode); return { ok: true, mode };
    },
    // events
    "GET /v1/events": ({ req, res }) => {
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write(`: connected\nretry: 2000\n\n`); clients.add(res);
      req.on("close", () => clients.delete(res)); return null;
    },
    // guarded JavaScript execution: off unless the user wrote {"eval": true} into basalt-api-settings.json (basalt app settings eval on)
    "GET /v1/settings": () => ({ ...settings(), settingsFile: settingsFile() }),
    "POST /v1/eval": async ({ req }) => {
      if (!settings().eval) fail(403, "eval is disabled", { hint: "run `basalt app settings eval on` on this computer (it writes basalt-api-settings.json in the app data folder)" });
      const code = await readText(req);
      const fn = new Function("app", "window", `return (async () => { ${/^\s*(return|const|let|var|if|for|while|try|await)\b/.test(code) ? code : "return (" + code + "\n)"} })()`);
      const out = await fn(app, window);
      let json; try { json = JSON.parse(JSON.stringify(out === undefined ? null : out)); } catch (e) { json = String(out); }
      return { ok: true, result: json };
    },
    "POST /v1/quit": ({ res }) => { send(res, 200, { ok: true }); setTimeout(() => window.electron.remote.app.quit(), 200); return null; },
  };

  const hostOk = (h, port) => !h || h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === "127.0.0.1" || h === "localhost";
  async function handle(req, res, token, port) {
    if (req.headers.origin) return send(res, 403, { error: "browser requests are not allowed" });
    if (!hostOk(req.headers.host, port)) return send(res, 403, { error: "bad host header" });
    const given = String(req.headers.authorization || ""), want = "Bearer " + token;
    if (given.length !== want.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want))) return send(res, 401, { error: "bad or missing token" });
    const url = new URL(req.url, "http://127.0.0.1"), key = req.method + " " + url.pathname.replace(/\/+$/, "");
    const route = routes[key];
    if (!route) return send(res, 404, { error: "unknown route", routes: Object.keys(routes) });
    const q = url.searchParams, out = await route({ req, res, q, p: safe(q.get("path")) });
    if (out === null) return; // the route answered itself (stream, quit)
    return send(res, 200, out);
  }

  function start() {
    const prev = readInfo();
    const token = prev.token || crypto.randomBytes(24).toString("hex");
    let port = prev.port || 27124, tries = 0;
    const server = http.createServer((req, res) => {
      handle(req, res, token, port).catch((e) => { if (!res.headersSent) send(res, e instanceof HttpError ? e.status : 500, { error: String(e && e.message || e), ...(e && e.extra || {}) }); else try { res.end(); } catch (e2) { /* closed */ } });
    });
    server.on("error", (e) => { if (e.code === "EADDRINUSE" && tries++ < 20) { port++; server.listen(port, "127.0.0.1"); } else console.error("[basalt-api]", e.message); });
    server.on("listening", () => {
      try { fs.writeFileSync(infoFile(), JSON.stringify({ port, token, vault: app.vault.getName(), pid: process.pid, api: API_VERSION }, null, 2), { mode: 0o600 }); } catch (e) { console.error("[basalt-api] info file", e); }
      window.__bsApiInfo = { port, token };
    });
    server.listen(port, "127.0.0.1");
    try { startEvents(); } catch (e) { console.error("[basalt-api] events", e); }
    window.addEventListener("beforeunload", () => { try { for (const r of clients) r.end(); server.close(); } catch (e) { /* gone */ } });
    app.commands.addCommand({
      id: "basalt:api-info", name: "API: показать адрес и скопировать токен",
      callback: () => { const i = window.__bsApiInfo; if (!i) return; navigator.clipboard.writeText(i.token).catch(() => {}); new window.__bsApi.Notice(`Basalt API: http://127.0.0.1:${i.port}\nТокен скопирован в буфер обмена`, 8000); },
    });
  }
  const t = setInterval(() => { if (window.app && app.vault && app.vault.adapter && app.workspace && app.workspace.layoutReady && app.commands && window.__bsApi) { clearInterval(t); try { start(); } catch (e) { console.error("[basalt-api]", e); } } }, 700);
})();
