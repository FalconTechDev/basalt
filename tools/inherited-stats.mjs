// What src/app.js is made of: own modules, glue, third-party libraries, and code that is still inherited from the original bundle.
//   node tools/inherited-stats.mjs [--json out.json]
// Needs only the working tree (no git history). Shares are of the CURRENT src/app.js; the share of the ORIGINAL bundle that has been
// replaced comes from tools/own-stats.mjs (that one still reads the base revision).
//
// src/app.js layout:   (()=>{ var <webpack module table>; function <webpack require>; <runtime>; (()=>{ <application scope> })() })()
//   1. webpack module table  -> every module is a third-party package or Obsidian-written glue (see WEBPACK_GROUPS)
//   2. application scope     -> the own block (between /*basalt-own:begin*/ and /*basalt-own:end*/), then the old top-level code.
//      Old top-level code = functions/vars that were not replaced. Part of it is bundled libraries (see APP_LIBS), the rest is Obsidian's.
// The library regions are found by anchors: the text a library item starts with, up to (not including) the first item of whatever
// follows. Each anchor has to match exactly once, otherwise the tool stops (a rebuilt bundle needs new anchors).
// Boundaries were set by reading the bundle; inside a library region a few lines of Obsidian glue can hide, outside of it a few lines of
// library can hide, so treat the split as +-3 % rather than exact. The totals of the first three layers are exact.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fileArg = process.argv.indexOf("--file") > 0 ? process.argv[process.argv.indexOf("--file") + 1] : path.join(root, "src", "app.js");
const src = fs.readFileSync(fileArg, "utf8");
const ast = acorn.parse(src, { ecmaVersion: 2022 });
const outer = ast.body[0].expression.callee.body.body; // [var modules, function require, (seq)]
const table = outer[0].declarations[0].init.properties;
const seq = outer[2].expression.expressions;
const appCall = seq[seq.length - 1];
const appBody = appCall.callee.body.body;

// ---- 1. webpack modules ---------------------------------------------------------------------------------------------------------
// id lists found by following the n(ID) requires from the application scope (remark chain, crypto-js, ts-ebml chain, capacitor)
const WEBPACK_GROUPS = [
  ["crypto-js (core, sha256, hmac, hex)", "MIT", [1126, 3490, 8190, 1928, 5897, 3936]],
  ["ts-ebml (webm/matroska reader) + ebml-block", "MIT", [5416, 9840, 4741, 4635, 8193, 3179, 9547, 5226, 8177, 927, 2877, 5420]],
  ["buffer / events / ieee754 / base64-js / int64-buffer / is-buffer (node polyfills for ts-ebml, vfile)", "MIT / BSD-3-Clause (ieee754)", [4686, 9784, 7947, 5350, 6661, 2660]],
  ["@capacitor/core + async-mutex + secure-storage glue", "MIT", [6043, 3860, 8173, 3357, 9804]],
  ["RateApp web stub (Obsidian-written capacitor plugin, 1 class)", "Obsidian", [1979]],
];
const mods = table.map((p) => ({ id: Number(p.key.value ?? p.key.name), size: p.end - p.start }));
const grouped = new Map();
for (const [name, lic, ids] of WEBPACK_GROUPS) grouped.set(name, { lic, size: 0, n: 0, ids: new Set(ids) });
const remark = { name: "unified/remark family: remark-parse, mdast-util-to-hast, hast-util-to-html, property-information, vfile, unist-util-*, parse-entities, character-entities, ...", lic: "MIT", size: 0, n: 0 };
for (const m of mods) {
  let hit = null;
  for (const g of grouped.values()) if (g.ids.has(m.id)) hit = g;
  const g = hit || remark;
  g.size += m.size; g.n++;
}
const tableBytes = table[table.length - 1].end - table[0].start;

// ---- 2. application scope ---------------------------------------------------------------------------------------------------------
const hasOwn = src.includes("/*basalt-own:begin*/"); // an unmodified bundle (--file) has no own block
const BEGIN = hasOwn ? src.indexOf("/*basalt-own:begin*/") : 0;
const END = hasOwn ? src.indexOf("/*basalt-own:end*/") + "/*basalt-own:end*/".length : 0;
const items = [];
const isOwn = (t) => /__basaltOwn\./.test(t.slice(0, 200)) || /\/\*own\*\//.test(t.slice(0, 120));
for (const n of appBody) {
  const text = src.slice(n.start, n.end);
  if (n.type === "FunctionDeclaration") items.push({ name: n.id.name, start: n.start, size: text.length, own: isOwn(text) });
  else if (n.type === "VariableDeclaration") {
    for (const d of n.declarations) {
      if (!d.init || d.id.type !== "Identifier") { items.push({ name: "?", start: d.start, size: d.end - d.start, own: false }); continue; }
      const t = src.slice(d.init.start, d.init.end);
      items.push({ name: d.id.name, start: d.init.start, size: t.length, own: isOwn(t) });
    }
  } else items.push({ start: n.start, size: text.length, own: false });
}
items.sort((a, b) => a.start - b.start);
const ownBlock = END - BEGIN;
const inApp = items.filter((x) => !(x.start >= BEGIN && x.start < END));
const fromBase = !hasOwn; // base bundle: libraries are counted the same way, everything else is "Obsidian code"

// [name, licence, startAnchor, endAnchor]: a library occupies the items from the one that starts with startAnchor to the one that starts with endAnchor
const APP_LIBS = [
  ["tslib helpers (__extends, __assign, __awaiter, __generator, ...)", "0BSD", "function(e,t){return f=Object.setPrototypeOf||{__proto__:[]}instanceof", "S,x,T,D;Object.create;"],
  ["CodeMirror 6: @codemirror/state + @codemirror/view + text/range/gutter/layer/tooltip/panel parts", "MIT", "[],P=[];function L(e){if(e<768)", '{height:"",paddingTop:"",paddingBottom:"",marginTop:""'],
  ["Lezer (@lezer/common, @lezer/highlight) + @codemirror/language + fold gutter", "MIT", "1024,Su=0,xu=function(e,t){this.from=e,this.to=t}", 'Of((function(e){Rf=e.ipcRenderer.sendSync("is-dev")'],
  ["Lucide icon data (1500+ icons)", "ISC (+ MIT for the Feather-derived icons)", '{"a-arrow-down":[[6,"m14 12 4 4 4-4"]', '{"create-new":"edit",trash:"trash-2"'],
  ["idb (IndexedDB promise wrapper)", "ISC", "(e,t)=>t.some((t=>e instanceof t));let qw,jw;", 'function Mk(e){var t=document.createElementNS("http://www.w3.org/2000/svg","svg")'],
  ["yaml (eemeli): lexer, parser, composer, document, schema, stringify", "ISC", 'Symbol.for("yaml.alias"),hE=Symbol.for("yaml.document")', "n(9650),Dx=n(6658),Ax=n(1039),Px=n(6859)"],
  ["diff-match-patch (Google)", "Apache-2.0", "function(){function e(){this.diffTimeout=1,", "function mA(e){return xx(e,null,{})}"],
  ["DOMPurify 3.0.1", "Apache-2.0 OR MPL-2.0", "Object.entries,AP=Object.setPrototypeOf,PP=Object.isFrozen", "window.DOMPurify=EL,EL.addHook"],
  ["CodeMirror 6: @codemirror/commands, history, search, comment, closebrackets, goto-line, drawSelection", "MIT", "function(e){var t=e.state,n=t.doc.lineAt(t.selection.main.from),i=WO(e.state,n.from)", 'Gz.registerPostProcessor((function(e,t){var n,i=e.find(".frontmatter")'],
  ["CodeMirror 6: second copy of @codemirror/language (StreamLanguage, parse worker, syntax highlighting)", "MIT", "function(){function e(e,t,n,i){void 0===n&&(n=[]),void 0===i&&(i=\"\"),this.data=e", "QW.addGlobal(new(function(e){", "window.DOMPurify=EL,EL.addHook"],
  ["CodeMirror 6: @codemirror/autocomplete + snippets + closebrackets", "MIT", "function JW(e){var t=e.map((function(e){return\"string\"==typeof e?{label:e}", "function(){function e(e,t,n,i,r,o,a,s,l,c,u){void 0===c&&(c=0),this.p=e,this.stack=t"],
  ["@lezer/lr (parser runtime)", "MIT", "function(){function e(e,t,n,i,r,o,a,s,l,c,u){void 0===c&&(c=0),this.p=e,this.stack=t", "CK.deserialize({version:14"],
  ["CodeMirror 6: @codemirror/lint", "MIT", "function(){function e(e,t,n){this.diagnostics=e,this.panel=t,this.selected=n}", null],
];
function indexOfOnce(a, from = END) {
  const i = src.indexOf(a, from);
  if (i < 0) throw new Error(`anchor not found: ${a.slice(0, 60)}`);
  return i;
}
const libTotals = [];
const replacedNames = new Set();
if (fromBase) {
  const man = JSON.parse(fs.readFileSync(path.join(root, "src-app", "manifest.json"), "utf8"));
  for (const k of ["entries", "classes", "declarators"]) for (const e of man[k] || []) replacedNames.add(e.orig);
}
const libByItem = new Map();
for (const [name, lic, a, b, after] of APP_LIBS) { // "after": the text occurs twice (two copies of a library), take the one after this anchor
  const s = indexOfOnce(a, after ? indexOfOnce(after) : END);
  let e = b === null ? -1 : indexOfOnce(b, s);
  if (e < 0) {
    // lint: the end anchor is soft, fall back to the end of the last item that still looks like lint (its theme object)
    e = indexOfOnce('_o.baseTheme({".cm-gutter-lint":{width:"1.4em"', s);
    e = items.find((x) => x.start > e).start;
  }
  let size = 0, n = 0;
  for (const it of inApp) if (it.start >= s && it.start < e && !it.own) { size += it.size; n++; libByItem.set(it, name); }
  // on an unmodified bundle: how much of the region was later replaced by own code (= Obsidian code that sat inside the region)
  let replacedInside = 0;
  if (fromBase) for (const it of inApp) if (it.start >= s && it.start < e && replacedNames.has(it.name)) replacedInside += it.size;
  const ownInside = inApp.filter((it) => it.start >= s && it.start < e && it.own).length;
  libTotals.push({ name, lic, size, n, from: s, to: e, replacedInside, ownInside });
}
const wrappers = inApp.filter((x) => x.own).reduce((a, x) => a + x.size, 0);
const inheritedApp = inApp.filter((x) => !x.own);
const inheritedAppBytes = inheritedApp.reduce((a, x) => a + x.size, 0);
const libApp = libTotals.reduce((a, x) => a + x.size, 0);
const obsidianApp = inheritedAppBytes - libApp;
const libWebpack = [...grouped.values()].reduce((a, g) => a + g.size, 0) - (grouped.get(WEBPACK_GROUPS[4][0]).size) + remark.size;
const obsidianWebpack = grouped.get(WEBPACK_GROUPS[4][0]).size;
// bytes that belong to no item: separators, "use strict", the webpack runtime, the closing of the application scope
const total = src.length;
const webpackOverhead = appCall.start - tableBytes;
const appOverhead = total - appCall.start - ownBlock - wrappers - inheritedAppBytes;
const rest = webpackOverhead + appOverhead;

const pct = (n) => ((100 * n) / total).toFixed(1).padStart(5) + " %";
const kb = (n) => (n / 1024).toFixed(0).padStart(6) + " KB";
console.log(`src/app.js                                   ${kb(total)}  100.0 %`);
console.log(`  own modules (readable, spliced in)         ${kb(ownBlock)} ${pct(ownBlock)}`);
console.log(`  glue left from replaced functions/classes  ${kb(wrappers)} ${pct(wrappers)}`);
console.log(`  third-party libraries                      ${kb(libApp + libWebpack)} ${pct(libApp + libWebpack)}   (webpack ${kb(libWebpack)}, application scope ${kb(libApp)})`);
console.log(`  still Obsidian's code                      ${kb(obsidianApp + obsidianWebpack)} ${pct(obsidianApp + obsidianWebpack)}   (application scope ${kb(obsidianApp)}, webpack glue ${kb(obsidianWebpack)})`);
console.log(`  separators, runtime, unclassified          ${kb(rest)} ${pct(rest)}`);
console.log("\nwebpack modules (" + mods.length + ", " + kb(tableBytes) + "):");
for (const [name, g] of grouped) console.log(`  ${kb(g.size)}  ${String(g.n).padStart(3)} modules  ${name}  [${g.lic}]`);
console.log(`  ${kb(remark.size)}  ${String(remark.n).padStart(3)} modules  ${remark.name}  [${remark.lic}]`);
console.log("\nlibraries inside the application scope:");
for (const l of libTotals) console.log(`  ${kb(l.size)}  ${String(l.n).padStart(4)} items  ${l.name}  [${l.lic}]${!fromBase && l.ownInside ? `  (${l.ownInside} own wrappers inside the range)` : ""}${fromBase ? `  (of which later replaced by own code: ${kb(l.replacedInside).trim()})` : ""}`);
console.log(`\nObsidian code in the application scope: ${inheritedApp.length - [...libByItem.keys()].length} items, ${kb(obsidianApp)}`);
if (process.argv.includes("--list")) { // the remaining Obsidian items, biggest first (input for docs/REPLACING_INHERITED_CODE.md)
  const rest = inheritedApp.filter((x) => !libByItem.has(x)).sort((a, b) => b.size - a.size);
  for (const x of rest) console.log(`${String(x.size).padStart(7)}  @${x.start}  ${x.name}  ${src.slice(x.start, x.start + 90).replace(/\s+/g, " ")}`);
}
if (process.argv.includes("--json")) {
  const out = { total, ownBlock, wrappers, libWebpack, libApp, obsidianApp, obsidianWebpack, webpack: [...grouped].map(([n, g]) => ({ n, lic: g.lic, size: g.size, modules: g.n })).concat([{ n: remark.name, lic: remark.lic, size: remark.size, modules: remark.n }]), libs: libTotals };
  fs.writeFileSync(process.argv[process.argv.indexOf("--json") + 1], JSON.stringify(out, null, 1));
}
