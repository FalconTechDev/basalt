import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { makeVault, cli, cliAsync, rm, put, get, tmp } from "./helpers.mjs";
import { nextRun, parseCron, cronMatches } from "../lib/auto.mjs";
import { sign } from "../lib/events.mjs";

test("cron: parse, match, next run", () => {
  assert.equal(nextRun("*/15 * * * *", new Date(2026, 0, 1, 10, 7)).getMinutes(), 15);
  const n = nextRun("30 9 * * 1", new Date(2026, 0, 1, 10, 0)); // next Monday 09:30
  assert.deepEqual([n.getDay(), n.getHours(), n.getMinutes()], [1, 9, 30]);
  assert.ok(cronMatches(parseCron("0 0 1 1 *"), new Date(2027, 0, 1, 0, 0)));
  assert.throws(() => parseCron("* * *")); assert.throws(() => parseCron("61 * * * *"));
});

test("run: scripts get vault/board objects and can return JSON", () => {
  const r = makeVault({ "A.md": "hello [[B]]", "B.md": "b" });
  try {
    put(r, "s.mjs", `export default async ({ vault, board, args }) => {
      await vault.write("out/new.md", "from script " + args.join("+"));
      const b = await board("sb", { create: true }); b.addCard({ text: "c1" }); b.addCard({ text: "c2" }); b.layout("grid"); await b.save();
      return { notes: vault.list("md").length, links: (await vault.links("A")).length, cards: b.cards().length };
    };`);
    const o = cli(r, ["run", "s.mjs", "x", "--weird", "y", "--json"]); assert.equal(o.code, 0, o.err);
    assert.deepEqual(o.json(), { notes: 3, links: 1, cards: 2 });
    assert.equal(get(r, "out/new.md"), "from script x+--weird+y");
    assert.equal(cli(r, ["board", "show", "sb", "--json"]).json().cards.length, 2);
    assert.equal(cli(r, ["run", "missing.mjs"]).code, 3);
    put(r, "g.mjs", `const n = basalt.vault.list().length; console.log("n=" + n);`);
    assert.match(cli(r, ["run", "g.mjs"]).out, /n=/);
  } finally { rm(r); }
});

test("x: plugin scripts from .basalt/scripts", () => {
  const r = makeVault({ "A.md": "a" });
  try {
    put(r, ".basalt/scripts/count.mjs", `export const meta = { description: "count notes" };\nexport default async ({ vault }) => ({ count: vault.list("md").length });`);
    assert.match(cli(r, ["x", "list"]).out, /count\s+count notes/);
    assert.deepEqual(cli(r, ["x", "count", "--json"]).json(), { count: 1 });
    assert.equal(cli(r, ["x", "nope"]).code, 3);
  } finally { rm(r); }
});

test("tasks: needs, steps, failure stops, cycles, extra steps kinds", () => {
  const r = makeVault({ "A.md": "[[Missing]]" });
  try {
    put(r, ".basalt/tasks.json", JSON.stringify({ tasks: {
      a: { steps: [`node -e "require('fs').appendFileSync('log.txt','a;')"`] },
      b: { needs: ["a"], steps: [`node -e "require('fs').appendFileSync('log.txt','b;')"`, { basalt: "stats --json" }] },
      bad: { steps: [`node -e "process.exit(3)"`, `node -e "require('fs').appendFileSync('log.txt','NEVER;')"`] },
      soft: { steps: [{ run: `node -e "process.exit(3)"`, continueOnError: true }, `node -e "require('fs').appendFileSync('log.txt','soft;')"`] },
      chk: { steps: [{ basalt: "check" }] },
      c1: { needs: ["c2"], steps: ["echo x"] }, c2: { needs: ["c1"], steps: ["echo y"] },
      sch: { schedule: "*/5 * * * *", steps: ["echo s"], description: "d" },
      comp: { steps: [{ task: "a" }, { task: "a" }] },
    } }));
    assert.equal(cli(r, ["task", "run", "b"]).code, 0); assert.equal(get(r, "log.txt"), "a;b;");
    assert.equal(cli(r, ["task", "run", "bad"]).code, 1); assert.ok(!get(r, "log.txt").includes("NEVER"));
    assert.equal(cli(r, ["task", "run", "soft"]).code, 0); assert.ok(get(r, "log.txt").endsWith("soft;"));
    assert.equal(cli(r, ["task", "run", "chk"]).code, 1);
    assert.equal(cli(r, ["task", "run", "c1"]).code, 1);
    assert.equal(cli(r, ["task", "run", "comp", "--dry-run"]).code, 0);
    assert.equal(cli(r, ["task", "run", "nope"]).code, 3);
    assert.equal(cli(r, ["task", "list", "--json"]).json().length, 9);
    const s = cli(r, ["schedule", "list", "--json"]).json(); assert.equal(s[0].task, "sch"); assert.ok(s[0].next);
    const inst = cli(r, ["schedule", "install", "sch", "--dry-run", "--json"]).json(); assert.equal(inst.dryRun, true); assert.ok(JSON.stringify(inst.plan).includes("task run sch"));
    assert.equal(cli(r, ["schedule", "install", "a", "--dry-run"]).code, 2);
  } finally { rm(r); }
});

test("hooks: never run without trust; run after `trust enable`; board-change hook", () => {
  const r = makeVault({});
  try {
    assert.equal(cli(r, ["hook", "init", "save"]).code, 0);
    put(r, ".basalt/hooks/on-save.mjs", `import fs from "node:fs"; fs.appendFileSync(process.env.BASALT_VAULT + "/hook.log", process.argv.slice(2).join(" ") + "\\n");`);
    put(r, ".basalt/hooks/on-create.mjs", `import fs from "node:fs"; fs.appendFileSync(process.env.BASALT_VAULT + "/hook.log", "created " + process.env.BASALT_FILE + "\\n");`);
    put(r, ".basalt/hooks/on-board-change.mjs", `import fs from "node:fs"; fs.appendFileSync(process.env.BASALT_VAULT + "/hook.log", "board " + process.env.BASALT_FILE + "\\n");`);
    cli(r, ["write", "n", "--text", "1"]); assert.ok(!fs.existsSync(path.join(r, "hook.log")), "untrusted vault must not run hooks");
    assert.match(cli(r, ["hook", "list"]).out, /automation: off/);
    assert.equal(cli(r, ["trust", "enable", "--json"]).json().automation, true);
    cli(r, ["write", "n2", "--text", "1"]); cli(r, ["write", "n2", "--text", "2"]); cli(r, ["board", "new", "bb"]);
    const log = get(r, "hook.log").split("\n").filter(Boolean);
    assert.deepEqual(log, ["created n2.md", "save n2.md", "board bb.board"]);
    cli(r, ["write", "n3", "--text", "1", "--no-hooks"]); assert.equal(get(r, "hook.log").split("\n").filter(Boolean).length, 3);
    assert.equal(cli(r, ["trust", "disable", "--json"]).json().automation, false);
    cli(r, ["write", "n4", "--text", "1"]); assert.equal(get(r, "hook.log").split("\n").filter(Boolean).length, 3);
    assert.equal(cli(r, ["hook", "run", "save", "--file", "x.md"]).code, 0); // explicit run needs no trust
    assert.match(get(r, "hook.log"), /save x\.md\n$/);
  } finally { cli(r, ["trust", "disable"]); rm(r); }
});

test("webhooks: signed POST with HMAC, event filter, only with trust; test and sign commands", async () => {
  const r = makeVault({}), got = [];
  const srv = http.createServer((req, res) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => { got.push({ h: req.headers, body: Buffer.concat(c).toString() }); res.end("ok"); }); });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${srv.address().port}/hook`;
  try {
    put(r, ".basalt/webhooks.json", JSON.stringify({ hooks: [{ url, events: ["create"], secret: "env:BS_SECRET" }] }));
    const env = { BS_SECRET: "s3cret" };
    await cliAsync(r, ["write", "a", "--text", "1"], { env }); assert.equal(got.length, 0, "no delivery without trust");
    await cliAsync(r, ["trust", "enable"]);
    await cliAsync(r, ["write", "b", "--text", "1"], { env }); // create -> delivered
    await cliAsync(r, ["write", "b", "--text", "2"], { env }); // save -> filtered out
    assert.equal(got.length, 1);
    const g = got[0], payload = JSON.parse(g.body);
    assert.deepEqual([payload.event, payload.file, payload.vault], ["create", "b.md", path.basename(r)]);
    assert.equal(g.h["x-basalt-event"], "create");
    assert.equal(g.h["x-basalt-signature"], "sha256=" + crypto.createHmac("sha256", "s3cret").update(`${g.h["x-basalt-timestamp"]}.${g.body}`).digest("hex"));
    assert.equal(g.h["x-basalt-signature"], sign("s3cret", g.h["x-basalt-timestamp"], g.body));
    const t = await cliAsync(r, ["webhook", "test", "0", "--json"], { env }); assert.equal(t.code, 0); assert.equal(got.length, 2);
    assert.equal((await cliAsync(r, ["webhook", "test", "http://127.0.0.1:9/none"])).code, 1);
    assert.equal(cli(r, ["webhook", "sign", "k", "1", "body", "--json"]).json().signature, sign("k", "1", "body"));
    await cliAsync(r, ["webhook", "add", url, "--events", "save"]); assert.equal(cli(r, ["webhook", "list", "--json"]).json().length, 2);
  } finally { await cliAsync(r, ["trust", "disable"]); srv.close(); rm(r); }
});

test("watch: debounced batch runs exec; --ext filter; stops by itself", async () => {
  const r = makeVault({ "A.md": "a" });
  try {
    const p = cliAsync(r, ["watch", "--exec", `node -e "require('fs').appendFileSync('w.log', process.env.BASALT_FILES + '\\n')"`, "--ext", "md", "--debounce", "300", "--max-events", "1", "--timeout", "20", "--json"]);
    await new Promise((s) => setTimeout(s, 1500));
    put(r, "skip.txt", "x"); put(r, "B.md", "1"); put(r, "B.md", "2"); put(r, "C.md", "3");
    const res = await p; assert.equal(res.code, 0);
    const files = JSON.parse(get(r, "w.log").trim().split("\n")[0]); assert.ok(files.includes("B.md") && files.includes("C.md") && !files.includes("skip.txt"), JSON.stringify(files));
    assert.equal(cli(r, ["watch"]).code, 2);
  } finally { rm(r); }
});
