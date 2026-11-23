// Automation building blocks: the scripting API, tasks, cron.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { CliError, EXIT, usage, notFound, readJson, parseArgs } from "./util.mjs";
import { Board, applyLayout, exportBoard } from "./board.mjs";
import { App } from "./app.mjs";
import { emit } from "./events.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CLI_ENTRY = path.join(here, "..", "basalt.mjs");

/** The object handed to `basalt run` / `basalt x` scripts. Everything is async-safe and works without the app. */
export function scriptApi(vault, { args = [], flags = {}, env = process.env, noHooks = false } = {}) {
  const boardPath = (p) => { for (const c of [p, p + ".board"]) { try { return vault.resolve(c, { exts: ["board"] }); } catch { /* next */ } } return p.endsWith(".board") ? p : p + ".board"; };
  const v = {
    root: vault.root, name: vault.name, raw: vault,
    list: (ext) => vault.files().filter((f) => !ext || f.ext === ext).map((f) => f.path),
    exists: (p) => vault.exists(p),
    read: async (p) => vault.read(vault.resolve(p)),
    write: async (p, text) => { const e = vault.exists(p); vault.write(p, text); await emit(vault, e ? "save" : "create", { file: p }, { noHooks }); return p; },
    append: async (p, text) => { const old = vault.exists(p) ? vault.read(p) : ""; return v.write(p, old + (old && !old.endsWith("\n") ? "\n" : "") + text); },
    search: async (q, o) => vault.search(q, o),
    links: async (p) => vault.linksOf(vault.resolve(p)), backlinks: async (p) => vault.backlinks(vault.resolve(p)), unresolved: async () => vault.unresolved(),
    tags: async () => Object.fromEntries([...vault.allTags()].map(([t, f]) => [t, f.length])),
    properties: async (p) => vault.propsOf(vault.resolve(p)),
    setProperty: async (p, k, val) => { const { setProperty } = await import("./md.mjs"); const f = vault.resolve(p); return v.write(f, setProperty(vault.read(f), k, val)); },
    move: async (a, b, o) => vault.move(a, b, o), trash: async (p, o) => vault.trash(p, o), check: async () => vault.check(), stats: async () => vault.stats(),
    daily: async (d) => vault.dailyPath(d),
  };
  const board = async (p, { create = false } = {}) => {
    const rel = boardPath(p), abs = vault.abs(rel), exists = fs.existsSync(abs);
    if (!exists && !create) throw notFound(`board not found: ${p}`);
    const b = exists ? Board.load(abs) : Board.create();
    return {
      raw: b, path: rel, cards: () => b.cards(), links: () => b.links(),
      addCard: (o) => b.addCard(o), editCard: (id, patch) => b.editCard(b.id(id), patch), deleteCard: (id) => b.deleteCard(b.id(id)),
      addLink: (a, c, o) => b.addEdge(b.id(a), b.id(c), o), layout: (mode, o) => applyLayout(b, mode, o), export: (fmt, o) => exportBoard(b, fmt, o),
      save: async () => { b.save(abs); vault.invalidate(); await emit(vault, "board-change", { file: rel }, { noHooks }); },
    };
  };
  let app = null;
  const appProxy = new Proxy({}, { get: (_, k) => {
    app ||= new App({}, env);
    const o = { status: () => app.get("/v1/status"), open: (p) => app.post("/v1/open", { path: p }), command: (id) => app.post("/v1/command", { id }), request: (m, r, x) => app.request(m, r, x), events: (fn) => app.events(fn) };
    return o[k];
  } });
  return { vault: v, board, app: appProxy, args, flags, env, parseArgs, log: (...a) => console.error(...a) };
}

export async function runScript(file, api) {
  const url = pathToFileURL(path.resolve(file)).href;
  globalThis.basalt = api;
  const mod = await import(url + "?t=" + Date.now());
  return typeof mod.default === "function" ? await mod.default(api) : mod.default;
}

// ---------------- cron (5 fields: minute hour day month weekday) ----------------
function field(src, lo, hi) {
  const set = new Set();
  for (const part of src.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part); if (!m) throw usage(`bad cron field "${src}"`);
    const step = m[2] ? +m[2] : 1; let a = lo, b = hi;
    if (m[1] !== "*") { const r = m[1].split("-").map(Number); a = r[0]; b = r.length > 1 ? r[1] : m[2] ? hi : r[0]; }
    if (a < lo || b > hi || step < 1) throw usage(`cron value out of range in "${src}"`);
    for (let i = a; i <= b; i += step) set.add(i);
  }
  return set;
}
export function parseCron(expr) {
  const f = String(expr).trim().split(/\s+/); if (f.length !== 5) throw usage(`cron needs 5 fields, got "${expr}"`);
  const c = { min: field(f[0], 0, 59), hour: field(f[1], 0, 23), dom: field(f[2], 1, 31), mon: field(f[3], 1, 12), dow: field(f[4].replace(/7/g, "0"), 0, 6), domStar: f[2] === "*", dowStar: f[4] === "*" };
  return c;
}
export function cronMatches(c, d) {
  if (!c.min.has(d.getMinutes()) || !c.hour.has(d.getHours()) || !c.mon.has(d.getMonth() + 1)) return false;
  const dm = c.dom.has(d.getDate()), dw = c.dow.has(d.getDay());
  return c.domStar && c.dowStar ? true : c.domStar ? dw : c.dowStar ? dm : dm || dw;
}
export function nextRun(expr, from = new Date()) {
  const c = parseCron(expr), d = new Date(from.getTime()); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++, d.setMinutes(d.getMinutes() + 1)) if (cronMatches(c, d)) return new Date(d);
  return null;
}

// ---------------- tasks ----------------
export const tasksOf = (vault) => readJson(vault.basaltPath("tasks.json"), { tasks: {} }).tasks || {};
const splitArgs = (s) => (s.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((x) => x.replace(/^["']|["']$/g, ""));

/** Run a task: needs first, then its steps. Returns {ok, steps:[{step, status}]}. */
export function runTask(vault, name, { stack = [], extra = [], env = process.env, log = () => {}, dry = false } = {}) {
  const tasks = tasksOf(vault), t = tasks[name]; if (!t) throw notFound(`no task "${name}" (see: basalt task list)`);
  if (stack.includes(name)) throw new CliError(`task cycle: ${[...stack, name].join(" -> ")}`, EXIT.ERROR);
  const steps = [], out = { task: name, ok: true, steps };
  const sub = (n) => runTask(vault, n, { stack: [...stack, name], env, log, dry });
  for (const n of t.needs || []) { const r = sub(n); steps.push(...r.steps); if (!r.ok) return { ...out, ok: false }; }
  const list = t.steps || (t.run ? [t.run] : []);
  for (const raw of list) {
    const s = typeof raw === "string" ? { run: raw } : raw; let label, status = 0;
    if (s.task) { label = "task " + s.task; log(`> ${label}`); if (!dry) { const r = sub(s.task); steps.push(...r.steps); if (!r.ok) status = 1; } }
    else {
      const stepEnv = { ...env, ...(t.env || {}), BASALT_VAULT: vault.root };
      let cmd, args, shell = false;
      if (s.basalt !== undefined) { cmd = process.execPath; args = [CLI_ENTRY, "--vault", vault.root, ...splitArgs(s.basalt), ...extra]; label = "basalt " + s.basalt; }
      else if (s.script !== undefined) { cmd = process.execPath; args = [CLI_ENTRY, "--vault", vault.root, "run", s.script, ...extra]; label = "script " + s.script; }
      else if (s.run !== undefined) { cmd = s.run + (extra.length ? " " + extra.join(" ") : ""); args = []; shell = true; label = s.run; }
      else throw usage(`task "${name}": a step needs run, basalt, script or task`);
      log(`> ${label}`);
      if (!dry) { const r = spawnSync(cmd, args, { cwd: vault.root, env: stepEnv, shell, stdio: ["ignore", "inherit", "inherit"], windowsHide: true }); status = r.status ?? 1; }
    }
    steps.push({ step: label, status });
    if (status !== 0 && !s.continueOnError) return { ...out, ok: false };
  }
  return out;
}
