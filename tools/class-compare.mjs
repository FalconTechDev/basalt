// Differential test for CLASSES replaced through manifest "classes": the original class text (cut from the base revision of
// src/app.js) and the own factory (src-app/) are both instantiated and driven by the same generated scenarios; the logs of what
// they did (return values, callbacks fired, thrown errors, resulting state) must be identical.
//   node tools/class-compare.mjs [--only VT,jm] [--n 300] [--seed 1]
// A test file in tools/class-tests/<name>.mjs exports  { cases: [{ orig, use, origWorld(O), ownWorld(W), scenario(world, ctx) }] }
//   O(names, extra) builds the ORIGINAL classes (minified text from the base revision, evaluated in a closure with `extra` bindings),
//   W(spec, host)   builds the OWN ones: spec = [[orig, factoryName], ...] applied in order, each result is also put on `host[orig]`.
//   ctx = { log, rnd }: everything that must be identical goes into `log`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { loadBundle } from "./split-app.mjs";
import { loadBase } from "./app-base.mjs";
import { readManifest, JS_MODULES } from "../build-app.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const N = +opt("--n", 300), SEED = +opt("--seed", 1), ONLY = opt("--only", null)?.split(",");

export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
class Rnd {
  constructor(s) { this.r = rng(s); }
  f() { return this.r(); }
  i(n) { return Math.floor(this.r() * n); }
  pick(a) { return a[this.i(a.length)]; }
  bool(p = 0.5) { return this.r() < p; }
}

// helpers the app defines on built-ins (src/enhance.js)
const def = (t, n, v) => { if (!t[n]) Object.defineProperty(t, n, { value: v, enumerable: false, configurable: true, writable: true }); };
def(Array.prototype, "remove", function (x) { const i = this.indexOf(x); if (i >= 0) this.splice(i, 1); });
def(Array.prototype, "contains", Array.prototype.includes);
def(Array.prototype, "first", function () { return this[0]; });
def(Array.prototype, "last", function () { return this[this.length - 1]; });

const manifest = readManifest();
const base = loadBase(manifest.base);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "basalt-class-compare-"));
const NEW = {};
for (const m of JS_MODULES) {
  fs.writeFileSync(path.join(stage, m), fs.readFileSync(path.join(root, "src-app", m), "utf8"));
  Object.assign(NEW, await import(pathToFileURL(path.join(stage, m)).href));
}

const bf = path.join(os.tmpdir(), `basalt-app-base-${manifest.base}.js`);
const bb = loadBundle(bf);
const baseInit = new Map();
for (const n of bb.body) if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.id.type === "Identifier" && d.init) baseInit.set(d.id.name, base.src.slice(d.init.start, d.init.end));

// tslib's __extends as in the bundle (the original classes call it as `m`)
const EXT = `var f=function(e,t){return f=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(e,t){e.__proto__=t}||function(e,t){for(var n in t)Object.prototype.hasOwnProperty.call(t,n)&&(e[n]=t[n])},f(e,t)};function m(e,t){function n(){this.constructor=e}f(e,t),e.prototype=null===t?Object.create(t):(n.prototype=t.prototype,new n)}\n`;

function originalWorld(names, extra = {}) {
  const keys = Object.keys(extra);
  // "fn:name" asks for a top-level function declaration instead of a var
  const body = EXT + names.map((n) => (n.startsWith("fn:") ? base.fn(n.slice(3)) : `var ${n}=${baseInit.get(n)};`)).join("\n") + `\nreturn {${names.map((n) => n.replace(/^fn:/, "")).join(",")}};`;
  return new Function(...keys, body)(...keys.map((k) => extra[k]));
}
function ownWorld(spec, host) {
  const out = {};
  for (const [orig, use] of spec) { out[orig] = NEW[use](host); host[orig] = out[orig]; }
  return out;
}

const files = fs.readdirSync(path.join(root, "tools", "class-tests")).filter((f) => f.endsWith(".mjs"));
let failed = 0, total = 0;
for (const f of files) {
  const mod = await import(pathToFileURL(path.join(root, "tools", "class-tests", f)).href);
  for (const c of mod.cases) {
    if (ONLY && !ONLY.includes(c.orig)) continue;
    let bad = 0;
    for (let k = 0; k < N; k++) {
      const seed = SEED * 100003 + k;
      const runSide = (side) => {
        const log = [];
        const ctx = { log, rnd: new Rnd(seed) };
        try {
          const world = side === "orig" ? c.origWorld(originalWorld) : c.ownWorld(ownWorld);
          c.scenario(world, ctx);
        } catch (e) { log.push("THROW " + (e && e.constructor && e.constructor.name) + ": " + String(e && e.message).slice(0, 120)); }
        return log;
      };
      const a = runSide("orig"), b = runSide("own");
      total++;
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        bad++;
        if (bad === 1) {
          const i = Math.max(0, a.findIndex((x, j) => JSON.stringify(x) !== JSON.stringify(b[j])));
          console.log(`  MISMATCH ${c.orig} (seed ${seed}) at step ${i}:\n    orig: ${JSON.stringify(a[i])}\n    own : ${JSON.stringify(b[i])}`);
        }
      }
    }
    failed += bad;
    console.log(`${bad ? "FAIL" : "ok  "} ${c.orig} -> ${c.use}  (${N} scenarios${bad ? ", " + bad + " differ" : ""})`);
  }
}
console.log(failed ? `${failed} of ${total} scenarios differ` : `all ${total} scenarios identical`);
process.exit(failed ? 1 : 0);
