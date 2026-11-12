// Compares the Rust Markdown worker (src/worker.js) with the old worker on a corpus of notes.
//
//   node tools/worker-compare.mjs                    metadata + HTML on the default corpus
//   node tools/worker-compare.mjs --meta             metadata only
//   node tools/worker-compare.mjs --html             HTML only
//   node tools/worker-compare.mjs --file a.md        one file, with the full diff
//   node tools/worker-compare.mjs --text "# a\n- b"  one snippet (\n is a line break), with the full diff
//   node tools/worker-compare.mjs --bench            speed on a ~1 MB note
//   options: --old FILE   the old worker (default: src/worker.js of commit OLD_REV, read with git)
//            --new FILE   the new worker (default: src/worker.js)
//            --root DIR   extra corpus folder (repeatable); --no-default-root skips the machine-wide scan
//            --limit N    examples shown per difference class (default 3)
//            --breaks 0   run with the "strict line breaks" option
//
// Metadata must match exactly (deep equality). HTML is compared per section after whitespace is normalised:
// all whitespace runs become one space and spaces between tags are dropped.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const OLD_REV = "b66df53"; // the last commit that still has the third-party worker
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const optAll = (n) => args.flatMap((a, i) => (a === n ? [args[i + 1]] : []));

const OPTIONS = { breaks: opt("--breaks", "1") !== "0", commonmark: true };

function loadWorker(src, name) {
  const posted = [];
  const self = { postMessage: (m) => posted.push(m) };
  const ctx = vm.createContext({ self, console, TextDecoder, TextEncoder, URL, atob, btoa, WebAssembly, setTimeout, clearTimeout });
  vm.runInContext(src, ctx, { filename: name });
  const ask = (data) => {
    posted.length = 0;
    self.onmessage({ data });
    return posted[0] === undefined ? undefined : structuredClone(posted[0]); // what postMessage would deliver
  };
  return {
    meta: (text) => ask({ metadataCache: new TextEncoder().encode(text).buffer }),
    sections: (text) => ask({ parseSections: text, options: { ...OPTIONS } }),
  };
}

const oldSrc = opt("--old") ? fs.readFileSync(opt("--old"), "utf8") : execFileSync("git", ["show", `${OLD_REV}:src/worker.js`], { cwd: repo, maxBuffer: 1 << 28, encoding: "utf8" });
const newSrc = fs.readFileSync(opt("--new", path.join(repo, "src", "worker.js")), "utf8");
const oldW = loadWorker(oldSrc, "old-worker.js");
const newW = loadWorker(newSrc, "new-worker.js");
// the old worker keeps the options of the last parseSections message: start both from the same state
oldW.sections("x");
newW.sections("x");

// ------------------------------------------------------------------------------------------------ corpus
function walk(dir, out) {
  let list;
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of list) {
    if (d.name === ".git" || d.name === "target") continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out);
    else if (d.isFile() && /\.md$/i.test(d.name)) out.push(p);
  }
}
function corpus() {
  const files = [];
  walk(path.join(here, "worker-corpus"), files);
  walk(path.join(repo, "src", "sandbox"), files);
  for (const r of optAll("--root")) walk(r, files);
  if (!flag("--no-default-root")) walk("C:/Users/sasha/OneDrive/Desktop/GithubRepos", files);
  const seen = new Set();
  const uniq = [];
  for (const f of files) {
    let real = f;
    try { real = fs.realpathSync(f); } catch { /* keep */ }
    if (seen.has(real)) continue;
    seen.add(real);
    try { if (fs.statSync(f).size > 6 * 1024 * 1024) continue; } catch { continue; }
    uniq.push(f);
  }
  return uniq;
}

// ------------------------------------------------------------------------------------------------ diffing
function diff(a, b, p, out) {
  if (out.length > 40) return;
  if (a === b) return;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    if (!(typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b))) out.push({ path: p, a, b });
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push({ path: p, a, b }); return; }
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.push({ path: p + ".length", a: a.length, b: b.length });
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${p}[${i}]`, out);
    return;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(k in a)) out.push({ path: `${p}.${k}`, a: undefined, b: b[k] });
    else if (!(k in b)) out.push({ path: `${p}.${k}`, a: a[k], b: undefined });
    else diff(a[k], b[k], `${p}.${k}`, out);
  }
}
const short = (v) => { const s = typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v) ?? "undefined"; return s.length > 160 ? s.slice(0, 160) + "..." : s; };
const cls = (p) => p.replace(/\[\d+\]/g, "[]").replace(/^\./, "");

const normHtml = (h) => String(h).replace(/\s+/g, " ").replace(/> </g, "><").replace(/^ | $/g, "");

function compareMeta(text) {
  let a, b;
  try { a = oldW.meta(text); } catch (e) { a = { threw: String(e) }; }
  try { b = newW.meta(text); } catch (e) { b = { threw: String(e) }; }
  if (isDeepStrictEqual(a, b)) return [];
  const out = [];
  diff(a, b, "", out);
  if (!out.length) out.push({ path: "(deep-equal says different, no path found)", a: undefined, b: undefined });
  return out;
}

function compareHtml(text) {
  let a, b;
  try { a = oldW.sections(text); } catch (e) { a = { threw: String(e) }; }
  try { b = newW.sections(text); } catch (e) { b = { threw: String(e) }; }
  const out = [];
  if (a === null || b === null || a?.threw || b?.threw) {
    if (!isDeepStrictEqual(a, b)) out.push({ path: "reply", a, b });
    return out;
  }
  if (!isDeepStrictEqual(a.frontmatter, b.frontmatter)) out.push({ path: "frontmatter", a: a.frontmatter, b: b.frontmatter });
  if (a.sections.length !== b.sections.length) out.push({ path: "sections.length", a: a.sections.length, b: b.sections.length });
  for (let i = 0; i < Math.min(a.sections.length, b.sections.length); i++) {
    const x = a.sections[i], y = b.sections[i];
    if (!isDeepStrictEqual(x.pos, y.pos)) out.push({ path: `sections[${i}].pos`, a: x.pos, b: y.pos });
    if (x.level !== y.level) out.push({ path: `sections[${i}].level`, a: x.level, b: y.level });
    const nx = normHtml(x.html), ny = normHtml(y.html);
    if (nx !== ny) {
      let k = 0;
      while (k < nx.length && nx[k] === ny[k]) k++;
      out.push({ path: `sections[${i}].html`, a: nx.slice(Math.max(0, k - 40), k + 70), b: ny.slice(Math.max(0, k - 40), k + 70), full: [nx, ny] });
    }
    if (out.length > 20) break;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ modes
const limit = +opt("--limit", 3);
const doMeta = !flag("--html");
const doHtml = !flag("--meta");

function showOne(name, text) {
  console.log(`== ${name} (${text.length} chars)`);
  if (doMeta) {
    const d = compareMeta(text);
    console.log(d.length ? `metadata: ${d.length} difference(s)` : "metadata: identical");
    for (const x of d) console.log(`  ${x.path}\n    old: ${short(x.a)}\n    new: ${short(x.b)}`);
  }
  if (doHtml) {
    const d = compareHtml(text);
    console.log(d.length ? `html: ${d.length} difference(s)` : "html: identical (after whitespace normalisation)");
    for (const x of d) console.log(`  ${x.path}\n    old: ${short(x.a)}\n    new: ${short(x.b)}`);
  }
}

if (flag("--text")) {
  showOne("snippet", opt("--text").replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r"));
  process.exit(0);
}
// delete lines (then characters) while the difference stays
function shrink(text, kind) {
  const differs = (t) => (kind === "html" ? compareHtml(t) : compareMeta(t)).length > 0;
  let lines = text.split("\n");
  for (let chunk = Math.ceil(lines.length / 2); chunk >= 1; chunk = chunk === 1 ? 0 : Math.ceil(chunk / 2)) {
    for (let i = 0; i < lines.length; ) {
      const t = lines.slice(0, i).concat(lines.slice(i + chunk));
      if (t.length && differs(t.join("\n"))) lines = t; else i += chunk;
    }
    if (chunk === 0) break;
  }
  let t = lines.join("\n");
  for (let chunk = Math.ceil(t.length / 4); chunk >= 1; chunk = chunk === 1 ? 0 : Math.ceil(chunk / 2)) {
    for (let i = 0; i < t.length; ) {
      const u = t.slice(0, i) + t.slice(i + chunk);
      if (u.length && differs(u)) t = u; else i += chunk;
    }
    if (chunk === 0) break;
  }
  return t;
}
if (flag("--min")) {
  // shrink a file to a few lines that still differ (metadata, or HTML with --html)
  let lines = fs.readFileSync(opt("--min"), "utf8").split("\n");
  const differs = (ls) => (doHtml && !doMeta ? compareHtml(ls.join("\n")) : compareMeta(ls.join("\n"))).length > 0;
  if (!differs(lines)) { console.log("no difference"); process.exit(0); }
  for (let chunk = Math.ceil(lines.length / 2); chunk >= 1; chunk = chunk === 1 ? 0 : Math.ceil(chunk / 2)) {
    for (let i = 0; i < lines.length; ) {
      const t = lines.slice(0, i).concat(lines.slice(i + chunk));
      if (t.length && differs(t)) lines = t; else i += chunk;
    }
    if (chunk === 0) break;
  }
  console.log(JSON.stringify(lines.join("\n")));
  process.exit(0);
}
if (flag("--file")) {
  const f = opt("--file");
  showOne(f, fs.readFileSync(f, "utf8"));
  process.exit(0);
}

if (flag("--bench")) {
  const parts = [];
  let size = 0;
  for (const f of corpus()) {
    if (size > 1_000_000) break;
    const t = fs.readFileSync(f, "utf8");
    if (t.length < 20000) { parts.push(t); size += t.length; }
  }
  const text = parts.join("\n\n");
  const time = (fn) => { const ts = []; for (let i = 0; i < 5; i++) { const t0 = performance.now(); fn(); ts.push(performance.now() - t0); } ts.sort((a, b) => a - b); return ts[2]; };
  console.log(`note: ${(text.length / 1e6).toFixed(2)} M chars`);
  for (const [label, w] of [["old", oldW], ["new", newW]]) {
    w.meta("# warm up\n"); w.sections("# warm up\n");
    console.log(`${label}: metadata ${time(() => w.meta(text)).toFixed(0)} ms, sections ${time(() => w.sections(text)).toFixed(0)} ms`);
  }
  process.exit(0);
}

// the hand-written notes and the sandbox notes are also run in other dress: line ends, BOM, tabs, very long lines
const variants = (text) => [
  ["crlf", text.replace(/\r?\n/g, "\r\n")],
  ["cr", text.replace(/\r?\n/g, "\r")],
  ["bom", "﻿" + text],
  ["tabs", text.replace(/^( {4})+/gm, (m) => "\t".repeat(m.length / 4))],
  ["notrail", text.replace(/\s+$/, "")],
  ["blanklead", "\n\n" + text],
  ["longline", text.replace(/\n\n/g, " " + "word ".repeat(3000) + "\n\n")],
  ["unicode", text.replace(/\b(\w)/g, "é$1").replace(/ /g, "  ")],
  ["astral", text.replace(/^(\S)/gm, "\u{1F600}$1")],
];
const handwritten = (f) => f.includes(`${path.sep}worker-corpus${path.sep}`) || f.startsWith(path.join(repo, "src", "sandbox"));

const files = corpus();
const fuzzN = +opt("--fuzz", 0);
console.log(`corpus: ${files.length} files`);
const classes = new Map(); // "meta:path" -> { count, examples }
let metaBad = 0, htmlBad = 0, bytes = 0;
const t0 = performance.now();
const jobs = [];
for (const f of files) {
  let text;
  try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
  jobs.push([f, text]);
  if (handwritten(f)) for (const [n, t] of variants(text)) jobs.push([`${f}#${n}`, t]);
}
// fuzzing: random damage to real notes (cut, repeat, swap lines, insert markdown fragments)
if (fuzzN) {
  let seed = +opt("--seed", 1);
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const bits = ["[[", "]]", "![[", "#", "^id", "\n", "\n\n", "  ", "\t", "- ", "1. ", "> ", "```", "~~~", "$$", "%%", "==", "**", "*", "_", "`", "[", "](", ")", "<", ">", "|", "---", "***", "[ ] ", "[x] ", "\\", "&amp;", "[^1]", "^[", "<div>", "<!--", "-->", "http://a.b/c", "\r\n", "é", "\u{1F600}"];
  const pool = jobs.filter(([f, t]) => t.length > 200 && t.length < 30000);
  for (let n = 0; n < fuzzN; n++) {
    const [f, t] = pool[Math.floor(rnd() * pool.length)];
    const lines = t.split("\n");
    const a = Math.floor(rnd() * lines.length), len = 3 + Math.floor(rnd() * 25);
    let chunk = lines.slice(a, a + len).join("\n");
    for (let k = 0, m = 1 + Math.floor(rnd() * 6); k < m; k++) {
      const pos = Math.floor(rnd() * (chunk.length + 1));
      const r = rnd();
      if (r < 0.6) chunk = chunk.slice(0, pos) + bits[Math.floor(rnd() * bits.length)] + chunk.slice(pos);
      else if (r < 0.8) chunk = chunk.slice(0, pos) + chunk.slice(pos + 1 + Math.floor(rnd() * 5));
      else chunk = chunk.slice(0, pos) + chunk.slice(Math.floor(rnd() * chunk.length));
    }
    jobs.push([`fuzz#${n} (${path.basename(f)})`, chunk]);
  }
}
for (const [f, text] of jobs) {
  bytes += text.length;
  const add = (kind, d) => {
    const key = `${kind}:${cls(d.path)}`;
    let c = classes.get(key);
    if (!c) classes.set(key, (c = { count: 0, files: new Set(), examples: [] }));
    c.count++;
    if (!c.files.has(f)) { c.files.add(f); if (c.examples.length < limit) c.examples.push({ f, d, text, kind }); }
  };
  if (doMeta) { const d = compareMeta(text); if (d.length) { metaBad++; for (const x of d) add("meta", x); } }
  if (doHtml) { const d = compareHtml(text); if (d.length) { htmlBad++; for (const x of d) add("html", x); } }
}
console.log(`compared ${jobs.length} texts, ${(bytes / 1e6).toFixed(1)} M chars in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
if (doMeta) console.log(`metadata: ${jobs.length - metaBad} identical, ${metaBad} differ`);
if (doHtml) console.log(`html:     ${jobs.length - htmlBad} identical, ${htmlBad} differ`);
const sorted = [...classes.entries()].sort((a, b) => b[1].files.size - a[1].files.size);
for (const [key, c] of sorted) {
  console.log(`\n[${key}]  ${c.files.size} file(s), ${c.count} difference(s)`);
  for (const e of c.examples) {
    console.log(`  ${e.f}\n    at ${e.d.path}\n    old: ${short(e.d.a)}\n    new: ${short(e.d.b)}`);
    if (e.f.startsWith("fuzz#") || flag("--min-all")) console.log(`    smallest: ${JSON.stringify(shrink(e.text, e.kind))}`);
  }
}
process.exit(metaBad || htmlBad ? 1 : 0);
