// The `app` commands against a mock of the API (the real one is covered by api.live.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { makeVault, cliAsync, rm, tmp } from "./helpers.mjs";

async function mock() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"), c = [];
    req.on("data", (d) => c.push(d));
    req.on("end", () => {
      const body = Buffer.concat(c).toString(); seen.push({ m: req.method, p: u.pathname, q: Object.fromEntries(u.searchParams), body, auth: req.headers.authorization });
      const J = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      if (req.headers.authorization !== "Bearer tok") return J(401, { error: "bad or missing token" });
      const k = req.method + " " + u.pathname;
      if (k === "GET /v1/status") return J(200, { app: "Basalt", vault: "V", notes: 1, boards: 1, files: 2, activeFile: "a.md", openBoards: ["b.board"], eval: false });
      if (k === "POST /v1/eval") return J(403, { error: "eval is disabled" });
      if (k === "GET /v1/events") { res.writeHead(200, { "Content-Type": "text/event-stream" }); res.write(": hi\n\n"); res.write('event: file-modify\ndata: {"type":"file-modify","path":"a.md"}\n\n'); res.write('event: board-change\ndata: {"type":"board-change","path":"b.board"}\n\n'); return; }
      if (k === "GET /v1/board") return J(200, { path: u.searchParams.get("path"), cards: [{ id: "c1", x: 1, y: 2, w: 3, h: 4, text: "T" }], links: [] });
      if (k === "GET /v1/nothing") return J(404, { error: "unknown route" });
      J(200, { ok: true, id: "new1", mode: u.searchParams.get("mode"), linksRemoved: 0 });
    });
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  return { srv, seen, env: { BASALT_API_URL: `http://127.0.0.1:${srv.address().port}`, BASALT_API_TOKEN: "tok" } };
}

test("app commands talk to the API with the bearer token and map errors to exit codes", async () => {
  const { srv, seen, env } = await mock();
  try {
    const s = await cliAsync(null, ["app", "status", "--json"], { env }); assert.equal(s.code, 0); assert.equal(s.json().vault, "V");
    assert.equal(seen[0].auth, "Bearer tok");
    assert.equal((await cliAsync(null, ["app", "status"], { env: { ...env, BASALT_API_TOKEN: "wrong" } })).code, 5);
    assert.equal((await cliAsync(null, ["app", "status"], { env: { BASALT_API_URL: "http://127.0.0.1:9", BASALT_API_TOKEN: "x" } })).code, 5);
    assert.equal((await cliAsync(null, ["app", "open", "a.md", "--line", "3"], { env })).code, 0);
    assert.deepEqual([seen.at(-1).m, seen.at(-1).p, seen.at(-1).q], ["POST", "/v1/open", { path: "a.md", line: "3" }]);
    await cliAsync(null, ["app", "run-command", "app:reload"], { env }); assert.deepEqual([seen.at(-1).p, seen.at(-1).q.id], ["/v1/command", "app:reload"]);
    assert.equal((await cliAsync(null, ["app", "eval", "1+1"], { env })).code, 6, "needs --yes");
    assert.equal((await cliAsync(null, ["app", "eval", "1+1", "--yes"], { env })).code, 6, "server says disabled");
    assert.equal(seen.filter((x) => x.p === "/v1/eval").length, 1);
    assert.equal(seen.find((x) => x.p === "/v1/eval").body, "1+1");
    assert.equal((await cliAsync(null, ["app", "request", "GET", "/v1/nothing"], { env })).code, 3);
    const ev = await cliAsync(null, ["app", "events", "--max", "1", "--type", "board-change"], { env }); assert.equal(ev.code, 0); assert.equal(JSON.parse(ev.out.trim()).path, "b.board");
    const b = await cliAsync(null, ["app", "board", "show", "b.board", "--json"], { env }); assert.equal(b.json().cards[0].id, "c1");
    await cliAsync(null, ["app", "board", "card", "add", "b.board", "hello", "world", "--x", "5", "--color", "red", "--open"], { env });
    const add = seen.at(-1); assert.deepEqual([add.m, add.p, add.q.open, JSON.parse(add.body).text, JSON.parse(add.body).x], ["POST", "/v1/board/card", "1", "hello world", 5]);
    await cliAsync(null, ["app", "board", "card", "edit", "b.board", "c1", "--text", "z"], { env }); assert.deepEqual([seen.at(-1).m, seen.at(-1).q.id], ["PATCH", "c1"]);
    await cliAsync(null, ["app", "board", "card", "delete", "b.board", "c1"], { env }); assert.equal(seen.at(-1).m, "DELETE");
    await cliAsync(null, ["app", "board", "link", "add", "b.board", "c1", "c2", "--label", "x"], { env }); assert.deepEqual(JSON.parse(seen.at(-1).body), { a: "c1", b: "c2", label: "x" });
    await cliAsync(null, ["app", "board", "layout", "b.board", "td"], { env }); assert.equal(seen.at(-1).q.mode, "td");
  } finally { srv.close(); }
});

test("app settings eval writes the local flag file only", async () => {
  const ud = tmp(), env = { BASALT_USER_DATA: ud };
  try {
    assert.equal((await cliAsync(null, ["app", "settings", "--json"], { env })).json().eval, false);
    assert.equal((await cliAsync(null, ["app", "settings", "eval", "on", "--json"], { env })).json().eval, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(ud, "basalt-api-settings.json"), "utf8")).eval, true);
    await cliAsync(null, ["app", "settings", "eval", "off"], { env }); assert.equal(JSON.parse(fs.readFileSync(path.join(ud, "basalt-api-settings.json"), "utf8")).eval, false);
    assert.equal((await cliAsync(null, ["app", "settings", "eval", "maybe"], { env })).code, 2);
  } finally { rm(ud); }
});

test("api info file is discovered through BASALT_API_INFO", async () => {
  const { srv, env } = await mock(), d = tmp(), f = path.join(d, "info.json");
  try {
    fs.writeFileSync(f, JSON.stringify({ port: +new URL(env.BASALT_API_URL).port, token: "tok" }));
    assert.equal((await cliAsync(null, ["app", "status"], { env: { BASALT_API_INFO: f } })).code, 0);
  } finally { srv.close(); rm(d); }
});
