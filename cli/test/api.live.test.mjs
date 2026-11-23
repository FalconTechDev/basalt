// Every endpoint of src/basalt-api.js against a REAL (headless) app. Skipped unless BASALT_TEST_API_INFO points at its basalt-api.json:
//   BASALT_TEST_API_INFO=<userData>/basalt-api.json node --test cli/test/api.live.test.mjs
// Use a throw-away vault and user-data dir (see tools/board-stress/README.md). The test creates and deletes files in that vault.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const INFO = process.env.BASALT_TEST_API_INFO, skip = !INFO || !fs.existsSync(INFO);
const info = skip ? {} : JSON.parse(fs.readFileSync(INFO, "utf8"));
const base = `http://127.0.0.1:${info.port}`;
const call = async (method, route, { q, body, token = info.token, headers = {} } = {}) => {
  const url = base + route + (q ? "?" + new URLSearchParams(q) : "");
  const r = await fetch(url, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const t = await r.text(); let j = t; try { j = JSON.parse(t); } catch { /* text */ }
  return { status: r.status, body: j };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("security: token, origin, host header", { skip }, async () => {
  assert.equal((await call("GET", "/v1/status", { token: "" })).status, 401);
  assert.equal((await call("GET", "/v1/status", { token: "wrong" })).status, 401);
  assert.equal((await call("GET", "/v1/status", { headers: { Origin: "http://evil.example" } })).status, 403);
  // a wrong Host header (DNS rebinding) is refused; fetch cannot set Host, so use raw http
  const code = await new Promise((ok) => { const r = http.request({ host: "127.0.0.1", port: info.port, path: "/v1/status", headers: { Host: "evil.example", Authorization: "Bearer " + info.token } }, (res) => { res.resume(); ok(res.statusCode); }); r.end(); });
  assert.equal(code, 403);
  const unknown = await call("GET", "/v1/nope"); assert.equal(unknown.status, 404); assert.ok(unknown.body.routes.includes("GET /v1/status"));
});

test("status, files, file read/write/delete, note, append, move, meta, backlinks, graph, tags, search", { skip }, async () => {
  const st = (await call("GET", "/v1/status")).body; assert.equal(st.app, "Basalt"); assert.ok(st.api >= 2); assert.equal(typeof st.notes, "number"); assert.equal(st.eval, false);
  assert.ok((await call("GET", "/v1/files")).body.some((f) => /Note A\.md$/.test(f.path)));
  assert.ok((await call("GET", "/v1/files", { q: { ext: "md", folder: "" , limit: "1" } })).body.length === 1);
  let r = await call("PUT", "/v1/file", { q: { path: "api-test/one.md" }, body: "# One\nlink [[Note A]] #apitest\n" }); assert.deepEqual([r.status, r.body.created], [200, true]);
  assert.equal((await call("GET", "/v1/file", { q: { path: "api-test/one.md" } })).body, "# One\nlink [[Note A]] #apitest\n");
  assert.equal((await call("GET", "/v1/note", { q: { path: "api-test/one.md" } })).status, 200);
  r = await call("PUT", "/v1/note", { q: { path: "api-test/two.md" }, body: "two" }); assert.equal(r.body.created, true);
  assert.equal((await call("POST", "/v1/note/append", { q: { path: "api-test/two.md" }, body: "more" })).status, 200);
  assert.equal((await call("GET", "/v1/note", { q: { path: "api-test/two.md" } })).body, "two\nmore");
  const b64 = Buffer.from([1, 2, 3, 250]).toString("base64");
  assert.equal((await call("PUT", "/v1/file", { q: { path: "api-test/bin.dat", encoding: "base64" }, body: b64 })).body.bytes, 4);
  assert.equal((await call("GET", "/v1/file", { q: { path: "api-test/bin.dat", encoding: "base64" } })).body, b64);
  await wait(1500); // let the metadata cache see the new note
  const meta = (await call("GET", "/v1/note/meta", { q: { path: "api-test/one.md" } })).body; assert.ok(meta.tags.includes("#apitest")); assert.ok(meta.resolved.includes("Note A.md"));
  assert.ok((await call("GET", "/v1/backlinks", { q: { path: "Note A.md" } })).body.some((x) => x.path === "api-test/one.md"));
  const g = (await call("GET", "/v1/graph")).body; assert.ok(g.edges.some((e) => e.source === "api-test/one.md" && e.target === "Note A.md"));
  assert.equal((await call("GET", "/v1/graph", { q: { unresolved: "1" } })).status, 200);
  assert.ok("#apitest" in (await call("GET", "/v1/tags")).body);
  assert.ok((await call("GET", "/v1/search", { q: { q: "link" } })).body.length >= 1);
  assert.equal((await call("GET", "/v1/search")).status, 400);
  r = await call("POST", "/v1/move", { q: { path: "api-test/two.md", to: "api-test/sub/moved.md" } }); assert.equal(r.body.path, "api-test/sub/moved.md");
  assert.equal((await call("POST", "/v1/move", { q: { path: "api-test/one.md", to: "api-test/sub/moved.md" } })).status, 409);
  assert.equal((await call("GET", "/v1/note", { q: { path: "../etc/passwd" } })).status, 404);
  assert.equal((await call("GET", "/v1/file", { q: { path: "missing.md" } })).status, 404);
  assert.equal((await call("DELETE", "/v1/note", { q: { path: "api-test/sub/moved.md" } })).status, 200);
  assert.equal((await call("DELETE", "/v1/file", { q: { path: "api-test/bin.dat", force: "1" } })).body.force, true);
});

test("open, workspace, commands, run-command, search/run", { skip }, async () => {
  assert.equal((await call("POST", "/v1/open", { q: { path: "Note A.md" } })).status, 200); await wait(500);
  const ws = (await call("GET", "/v1/workspace")).body; assert.ok(ws.leaves.some((l) => l.path === "Note A.md"));
  const cmds = (await call("GET", "/v1/commands")).body; assert.ok(cmds.length > 10 && cmds[0].id);
  assert.ok((await call("GET", "/v1/commands", { q: { q: "api-info" } })).body.some((c) => c.id === "basalt:api-info"));
  assert.equal((await call("POST", "/v1/command", { q: { id: "editor:toggle-bold" } })).status, 200);
  assert.equal((await call("POST", "/v1/command", { q: { id: "no:such" } })).status, 404);
  assert.equal((await call("POST", "/v1/command")).status, 400);
  assert.ok([200, 501].includes((await call("POST", "/v1/search/run", { q: { q: "Note" } })).status));
});

test("boards open in the app: card, link, layout, state, events", { skip }, async () => {
  const bp = "api-test/live.board";
  await call("PUT", "/v1/file", { q: { path: bp }, body: JSON.stringify({ v: 2, nodes: {}, edges: {} }) });
  assert.equal((await call("GET", "/v1/board", { q: { path: bp } })).status, 409, "closed board is refused with a hint");
  assert.ok((await call("GET", "/v1/board", { q: { path: bp } })).body.hint);
  assert.equal((await call("GET", "/v1/board", { q: { path: bp, open: "1" } })).status, 200);
  assert.ok((await call("GET", "/v1/boards/open")).body.some((b) => b.path === bp));
  // events: collect while we change the board
  const events = []; const req = http.request({ host: "127.0.0.1", port: info.port, path: "/v1/events", headers: { Authorization: "Bearer " + info.token } }, (res) => { res.setEncoding("utf8"); res.on("data", (c) => { for (const l of c.split("\n")) if (l.startsWith("data: ")) events.push(JSON.parse(l.slice(6))); }); }); req.end(); await wait(400);
  const a = (await call("POST", "/v1/board/card", { q: { path: bp }, body: { text: "Alpha", x: 0, y: 0, color: "red" } })).body.id;
  const b = (await call("POST", "/v1/board/card", { q: { path: bp }, body: { text: "Beta", kind: "Task" } })).body.id;
  const c = (await call("POST", "/v1/board/card", { q: { path: bp }, body: { text: "Gamma", w: 300 } })).body.id;
  assert.equal((await call("POST", "/v1/board/card", { q: { path: bp }, body: { color: "pink" } })).status, 400);
  let s = (await call("GET", "/v1/board", { q: { path: bp } })).body; assert.equal(s.cards.length, 3); assert.equal(s.cards.find((x) => x.id === a).color, "#e5484d"); assert.equal(s.cards.find((x) => x.id === c).w, 300);
  assert.equal((await call("PATCH", "/v1/board/card", { q: { path: bp, id: a.slice(0, 5) }, body: { text: "Alpha 2", x: 40, y: 50, color: "blue", fold: false } })).status, 200);
  s = (await call("GET", "/v1/board", { q: { path: bp } })).body; const ca = s.cards.find((x) => x.id === a); assert.deepEqual([ca.text, ca.x, ca.y, ca.color], ["Alpha 2", 40, 50, "#3fa7d6"]);
  assert.equal((await call("PATCH", "/v1/board/card", { q: { path: bp, id: "zzzzzz" }, body: {} })).status, 404);
  const l1 = (await call("POST", "/v1/board/link", { q: { path: bp }, body: { a, b, label: "to" } })).body.id; await call("POST", "/v1/board/link", { q: { path: bp }, body: { a, b: c } });
  assert.equal((await call("POST", "/v1/board/link", { q: { path: bp }, body: { a, b: "nope" } })).status, 404);
  assert.equal((await call("GET", "/v1/board", { q: { path: bp } })).body.links.length, 2);
  for (const mode of ["auto", "lr", "td", "radial", "force"]) assert.equal((await call("POST", "/v1/board/layout", { q: { path: bp, mode } })).status, 200, mode);
  assert.equal((await call("POST", "/v1/board/layout", { q: { path: bp, mode: "spiral" } })).status, 400);
  assert.equal((await call("DELETE", "/v1/board/link", { q: { path: bp, id: l1 } })).status, 200);
  assert.equal((await call("DELETE", "/v1/board/link", { q: { path: bp, id: l1 } })).status, 404);
  const del = (await call("DELETE", "/v1/board/card", { q: { path: bp, id: a } })).body; assert.equal(del.linksRemoved, 1);
  // the app saves the board file by itself; the CLI can read it back and it is a valid board
  await wait(2500);
  const j = (await call("GET", "/v1/file", { q: { path: bp } })).body; assert.equal(Object.keys(j.nodes).length, 2);
  assert.ok(events.some((e) => e.type === "board-change" && e.path === bp), "board-change event: " + JSON.stringify(events.map((e) => e.type)));
  assert.ok(events.some((e) => e.type === "file-modify" || e.type === "file-create"));
  req.destroy();
  await call("DELETE", "/v1/file", { q: { path: bp, force: "1" } });
});

test("events: file events for create, modify, rename and delete", { skip }, async () => {
  const events = []; const req = http.request({ host: "127.0.0.1", port: info.port, path: "/v1/events", headers: { Authorization: "Bearer " + info.token } }, (res) => { res.setEncoding("utf8"); res.on("data", (c) => { for (const l of c.split("\n")) if (l.startsWith("data: ")) events.push(JSON.parse(l.slice(6))); }); }); req.end(); await wait(400);
  await call("PUT", "/v1/file", { q: { path: "api-test/ev.md" }, body: "1" }); await wait(300);
  await call("PUT", "/v1/file", { q: { path: "api-test/ev.md" }, body: "2" }); await wait(300);
  await call("POST", "/v1/move", { q: { path: "api-test/ev.md", to: "api-test/ev2.md" } }); await wait(300);
  await call("DELETE", "/v1/file", { q: { path: "api-test/ev2.md", force: "1" } }); await wait(500);
  req.destroy(); const types = events.map((e) => e.type);
  for (const t of ["file-create", "file-modify", "file-rename", "file-delete"]) assert.ok(types.includes(t), t + " in " + types.join());
  assert.equal(events.find((e) => e.type === "file-rename").oldPath, "api-test/ev.md");
});

test("eval is refused by default, works only after the local flag file, and can be switched off", { skip }, async () => {
  const dir = path.dirname(INFO), flag = path.join(dir, "basalt-api-settings.json");
  try {
    assert.equal((await call("POST", "/v1/eval", { body: "1+1" })).status, 403);
    assert.equal((await call("GET", "/v1/settings")).body.eval, false);
    fs.writeFileSync(flag, JSON.stringify({ eval: true }));
    assert.equal((await call("POST", "/v1/eval", { body: "1+1" })).body.result, 2);
    assert.equal((await call("POST", "/v1/eval", { body: "return app.vault.getName()" })).body.result, (await call("GET", "/v1/status")).body.vault);
    assert.equal((await call("GET", "/v1/status")).body.eval, true);
  } finally { fs.rmSync(flag, { force: true }); }
  assert.equal((await call("POST", "/v1/eval", { body: "1+1" })).status, 403);
});
