// Compares flattened BASALT_I18N values in src/i18n.js against the original
// Obsidian tree (git show bbad17f^:src/i18n.js -> window.OBSIDIAN_DEFAULT_I18N).
// Usage: node tools/i18n-similarity.mjs [--json out.json] [--threshold 0.5]
//        [--report] [--dump start end] [--keys start end] [--show n]
//        [--check-placeholders]
import fs from "fs";
import path from "path";
import vm from "vm";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => args.includes(name) ? args[args.indexOf(name) + 1] : dflt;
const jsonOut = opt("--json", null);
const threshold = parseFloat(opt("--threshold", "0.5"));
const showN = parseInt(opt("--show", "0"), 10) || 0;
const rangeStart = parseInt(opt("--dump", opt("--keys", "0")), 10) || 0;
const rangeEnd = parseInt(args[args.indexOf("--dump") + 2] ?? args[args.indexOf("--keys") + 2] ?? "0", 10) || Infinity;

function loadGlobal(fileText, globalName) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(fileText, sandbox);
  return sandbox.window[globalName];
}

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + "." + k : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}

const PLACEHOLDER = /\{\{[^}]*\}\}|%[sdif]|\[\[[^\]]*\]\]|\{[a-zA-Z_][\w.]*\}/g;

function normalize(s) {
  return s.toLowerCase().replace(PLACEHOLDER, " ").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
}

function tokens(s) {
  const n = normalize(s);
  return n ? n.split(" ").filter(Boolean) : [];
}

function tokenDice(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size && !B.size) return 1;
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

function ngrams(s, n) {
  const t = normalize(s).replace(/\s+/g, "");
  const g = new Set();
  for (let i = 0; i + n <= t.length; i++) g.add(t.slice(i, i + n));
  return g;
}

function jaccard(a, b) {
  const A = ngrams(a, 4), B = ngrams(b, 4);
  if (!A.size && !B.size) return 1;
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

function similarity(a, b) {
  return Math.max(tokenDice(a, b), jaccard(a, b));
}

const curText = fs.readFileSync(path.join(root, "src", "i18n.js"), "utf8");
const origText = execSync("git show bbad17f~1:src/i18n.js", { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
const cur = flatten(loadGlobal(curText, "BASALT_I18N"));
const orig = flatten(loadGlobal(origText, "OBSIDIAN_DEFAULT_I18N"));

const rows = [];
let missing = 0;
for (const [key, cv] of Object.entries(cur)) {
  const ov = orig[key];
  if (ov === undefined) { missing++; continue; }
  const sim = similarity(cv, ov);
  rows.push({ key, sim, cur: cv, orig: ov });
}
rows.sort((a, b) => b.sim - a.sim);

const above = rows.filter(r => r.sim >= threshold);
const buckets = { verbatim: 0, ge05: 0, ge035: 0, lt035: 0 };
for (const r of rows) {
  if (r.cur === r.orig) buckets.verbatim++;
  if (r.sim >= 0.5) buckets.ge05++;
  else if (r.sim >= 0.35) buckets.ge035++;
  else buckets.lt035++;
}

console.log(`keys: ${rows.length} (missing in orig: ${missing})`);
console.log(`verbatim: ${buckets.verbatim} (${(100 * buckets.verbatim / rows.length).toFixed(1)}%)`);
console.log(`sim>=0.5: ${buckets.ge05} (${(100 * buckets.ge05 / rows.length).toFixed(1)}%)`);
console.log(`0.35<=sim<0.5: ${buckets.ge035} (${(100 * buckets.ge035 / rows.length).toFixed(1)}%)`);
console.log(`sim<0.35: ${buckets.lt035} (${(100 * buckets.lt035 / rows.length).toFixed(1)}%)`);

if (jsonOut) {
  const p = path.resolve(root, jsonOut);
  fs.writeFileSync(p, JSON.stringify({ threshold, buckets, rows }, null, 1));
  console.log("wrote", p);
}
if (args.includes("--show")) {
  for (const r of above.slice(0, showN || above.length)) {
    console.log(`\n[${r.sim.toFixed(2)}] ${r.key}\n  cur : ${r.cur}\n  orig: ${r.orig}`);
  }
}
if (args.includes("--keys")) {
  for (const r of above.slice(rangeStart, rangeEnd)) console.log(`${r.key}\t${r.cur}`);
}
if (args.includes("--dump")) {
  for (const r of above.slice(rangeStart, rangeEnd)) console.log([r.key, r.cur, r.orig].join("\t"));
}
if (args.includes("--check-placeholders")) {
  const ph = s => (s.match(new RegExp(PLACEHOLDER.source, "g")) || []).map(x => x.toLowerCase()).sort().join(",");
  let bad = 0;
  for (const r of rows) {
    if (ph(r.cur) !== ph(r.orig)) { bad++; console.log("PH MISMATCH", r.key, "|", ph(r.cur), "!=", ph(r.orig)); }
  }
  console.log("placeholder mismatches:", bad);
}
if (args.includes("--report")) {
  const out = rows.map(r => `${r.sim.toFixed(3)}\t${r.key}\t${JSON.stringify(r.cur)}\t${JSON.stringify(r.orig)}`);
  fs.writeFileSync(path.join(root, "i18n-sim-report.tsv"), out.join("\n"));
  console.log("wrote i18n-sim-report.tsv");
}
