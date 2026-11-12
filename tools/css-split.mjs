// One-off migration: reads the old flattened stylesheet and lays out src-css/ (one readable file per component).
//   node tools/css-split.mjs <old app.css> [--out src-css] [--no-prune]
//
// What it does, in order:
//   1. parses the sheet into items (a style rule, @font-face, @keyframes) with the chain of at-rules around it;
//   2. drops what Chromium ignores (-moz-/-ms- selectors, properties and @-moz-* blocks) and repeated declarations in one rule;
//   3. merges rules with the same selector when no rule in between can fight over the same property at equal specificity;
//   4. drops selectors that need a class or id which no script of the app can ever produce (see usedTokens);
//   5. sorts every rule into a component bucket (tools/css-map.mjs), then repairs the cascade: when moving a rule to its
//      component file would put it before a rule that used to come earlier and competes with it, it follows that rule instead;
//   6. writes the files with one selector per line and declarations grouped by purpose (position, box, type, paint, motion).
// The cascade check is a conservative model (same property family, same importance, equal specificity, selectors that may match
// one element); tools/css-compare.mjs checks the result against a running app.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { bucketOf } from "./css-map.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const args = process.argv.slice(2);
const inFile = path.resolve(args.find((a) => !a.startsWith("--") && args[args.indexOf("--out") + 1] !== a) || path.join(repo, "src", "app.css"));
const outDir = path.resolve(args.includes("--out") ? args[args.indexOf("--out") + 1] : path.join(repo, "src-css"));
const prune = !args.includes("--no-prune");

// ------------------------------------------------------------------------------------------------------------ buckets
// File order is also the cascade order of the build. Each entry: [bucket, file name, what lives there].
export const FILES = [
  ["pdf", "01-pdf-viewer", "PDF viewer chrome. Derived from Mozilla pdf.js (Apache-2.0), see THIRD_PARTY.md."],
  ["fonts", "02-fonts", "Font faces shipped with the app."],
  ["tokens", "03-tokens", "Design tokens: the variables every component reads (colours, type, spacing, radii, layers) and the light/dark theme values."],
  ["print", "04-print", "Print layout."],
  ["scrollbar", "05-scrollbars", "Scrollbar styling."],
  ["services", "06-services", "Account-side screens: sync, publish, web viewer, file recovery, release notes, vault chooser."],
  ["modal", "07-modals", "Modals and the settings dialog, hotkey list, plugin browser."],
  ["menu", "08-menus", "Context and drop-down menus."],
  ["base", "09-base", "Document-level defaults and small shared pieces that belong to no single component."],
  ["workspace", "10-workspace", "The window frame: the split tree of leaves, dock sides, resize handles, drag feedback, popovers."],
  ["elements", "11-elements", "Bare HTML elements: headings, lists, tables, rules, images."],
  ["editor", "12-editor", "Source mode and live preview editor (CodeMirror) and its syntax colours."],
  ["explorer", "13-sidebar", "Side panes: file explorer, search results, backlinks, outline, tags, bookmarks."],
  ["tooltip", "14-tooltips", "Tooltips and notices."],
  ["tabs", "15-tabs", "Tab strip, tab headers, view header and its actions, ribbon, title bar, status bar."],
  ["utilities", "16-utilities", "Utility and state classes (hidden, flashing, loading, icon sizing)."],
  ["suggest", "17-suggest", "Suggestion popups, command palette and quick switcher."],
  ["graph", "18-graph", "Graph view and its settings panel."],
  ["preview", "19-preview", "Reading view: rendered Markdown, callouts, embeds, tables, footnotes, front matter."],
  ["form", "20-forms", "Buttons, text inputs, selects, toggles, sliders and other controls."],
  ["canvas", "21-canvas", "Canvas view: board, nodes, edges, toolbar and popups."],
  ["code", "22-code", "Syntax highlight tokens for fenced code."],
  ["bases", "23-bases", "Database-style views: table, cards, list, toolbar, filters."],
  ["mobile", "24-mobile", "Phone and tablet layout (.is-mobile, .is-phone, .is-tablet)."],
  ["animations", "25-animations", "Keyframes."],
];
const rank = Object.fromEntries(FILES.map((f, i) => [f[0], i]));

const EXTRA = [
  ["bases", /\.bases-|\.formula-editor|\.filter-(group|row|expression|rhs)|\.conjunction|\.input-group|\.summary-function/],
  ["services", /\.sync-|\.publish-|\.webviewer|\.file-recovery|\.release-notes|\.changelog|\.feedback|\.spellchecker|\.recent-vaults|\.starter|\.splash|\.loader-cube|\.open-vault|\.slug-input|\.version-group|\.diff-|\.attachments-gallery/],
  ["code", /\.token\b|code\[class|^pre\b|\.prism/],
  ["elements", /^(h[1-6]|ul|ol|li|p|a|table|th|td|tr|hr|blockquote|mjx-container|img|svg|kbd|code|details|summary|ul >|ol >)(\b|[ >:.\[])/],
];
function bucketFor(selList, ctx, decls) {
  if (ctx.some((c) => /print/.test(c)) && bucketOf(selList[0]) !== "pdf") return "print";
  const sel = selList[0];
  if (/^(:root|html|body|\.theme-(dark|light))(?![\w-])/.test(sel) && !/ /.test(sel.replace(/:(not|is|where)\([^)]*\)/g, ""))) {
    if (/\.is-(mobile|phone|tablet)|\.emulate-mobile/.test(sel)) return "mobile";
    const custom = decls.filter((d) => d.prop.startsWith("--")).length;
    return custom >= decls.length * 0.6 && !/\.is-|\.mod-/.test(sel) ? "tokens" : "base";
  }
  for (const [n, re] of EXTRA) if (re.test(sel) && !/\.is-(mobile|phone|tablet)/.test(sel)) return n;
  return bucketOf(sel) === "utilities" ? "utilities" : bucketOf(sel);
}

// ------------------------------------------------------------------------------------------------------------ helpers
const FAMILY_ALIAS = { top: "inset", right: "inset", bottom: "inset", left: "inset", width: "size", height: "size", "min-width": "size", "max-width": "size", "min-height": "size", "max-height": "size", "inline-size": "size", "block-size": "size", "row-gap": "gap", "column-gap": "gap", "grid-gap": "gap", "grid-row-gap": "gap", "grid-column-gap": "gap", "min-inline-size": "size", "max-inline-size": "size", "min-block-size": "size", "max-block-size": "size", "line-height": "font" };
function family(prop) {
  if (prop.startsWith("--")) return prop;
  const p = prop.replace(/^-(webkit|moz|ms|o)-/, "");
  if (FAMILY_ALIAS[p]) return FAMILY_ALIAS[p];
  if (/^(place|align|justify)-/.test(p)) return "align";
  return p.split("-")[0];
}

function specOf(node) {
  // [ids, classes+attrs+pseudo-classes, tags+pseudo-elements]
  const s = [0, 0, 0];
  const add = (t) => { s[0] += t[0]; s[1] += t[1]; s[2] += t[2]; };
  node.walk?.(() => {});
  for (const n of node.nodes || []) {
    switch (n.type) {
      case "id": s[0]++; break;
      case "class": case "attribute": s[1]++; break;
      case "tag": s[2]++; break;
      case "pseudo": {
        if (/^::|^:(before|after|first-line|first-letter)$/.test(n.value)) { s[2]++; break; }
        if (n.value === ":where") break;
        if (/^:(is|not|has|matches|-webkit-any)$/.test(n.value)) {
          let best = [0, 0, 0];
          for (const arg of n.nodes) { const a = specOf(arg); if (cmp(a, best) > 0) best = a; }
          add(best); break;
        }
        s[1]++;
        for (const arg of n.nodes || []) { /* :nth-child(an+b of S) is rare; ignore */ }
        break;
      }
      case "nesting": break;
      default: break;
    }
  }
  return s;
}
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const selCache = new Map();
function analyseSelector(sel) {
  if (selCache.has(sel)) return selCache.get(sel);
  let out = { last: { cls: new Set(), tag: "", id: "" }, spec: [0, 0, 0], pe: "", classes: [], ids: [], vendorBad: false };
  try {
    selectorParser((root) => {
      const only = root.nodes[0];
      let spec = [0, 0, 0];
      // specificity: sum over every compound of the complex selector
      const walkSel = (s, top) => {
        for (const n of s.nodes) {
          if (n.type === "id") { spec[0]++; if (top) out.ids.push(n.value); }
          else if (n.type === "class") { spec[1]++; if (top) out.classes.push(n.value); }
          else if (n.type === "attribute") spec[1]++;
          else if (n.type === "tag") spec[2]++;
          else if (n.type === "pseudo") {
            if (/^::|^:(before|after|first-line|first-letter)$/.test(n.value)) { spec[2]++; if (top) out.pe = n.value.replace(/^:(?!:)/, "::"); }
            else if (n.value === ":where") { /* zero */ }
            else if (/^:(is|not|has|matches|-webkit-any)$/.test(n.value)) {
              let best = [0, 0, 0];
              for (const arg of n.nodes) { const save = spec; spec = [0, 0, 0]; walkSel(arg, false); const a = spec; spec = save; if (cmp(a, best) > 0) best = a; }
              spec[0] += best[0]; spec[1] += best[1]; spec[2] += best[2];
            } else spec[1]++;
            if (/-(moz|ms|o)-/.test(n.value)) out.vendorBad = true;
          }
        }
      };
      walkSel(only, true);
      let lastC = { cls: new Set(), tag: "", id: "" };
      for (const n of only.nodes) {
        if (n.type === "combinator") lastC = { cls: new Set(), tag: "", id: "" };
        else if (n.type === "class") lastC.cls.add(n.value);
        else if (n.type === "tag") lastC.tag = n.value;
        else if (n.type === "id") lastC.id = n.value;
      }
      out.last = lastC;
      out.spec = spec;
    }).processSync(sel);
  } catch (e) { out.vendorBad = false; }
  selCache.set(sel, out);
  return out;
}

const clean = (s) => s.replace(/\s+/g, " ").trim();

// ------------------------------------------------------------------------------------------------------------ parse
const root = postcss.parse(fs.readFileSync(inFile, "utf8"), { from: inFile });
const items = []; // {kind:'rule'|'face'|'frames', ctx:[], sels:[], decls:[{prop,value,imp}], name?, idx}
const sizeBefore = fs.statSync(inFile).size;
let dropped = { vendor: 0, dupDecl: 0, merged: 0, dead: 0, frames: 0, emptied: 0 };

function declsOf(node) {
  const out = [];
  node.each((d) => { if (d.type === "decl") out.push({ prop: d.prop.startsWith("--") ? d.prop : d.prop.toLowerCase(), value: clean(d.value), imp: !!d.important }); });
  return out;
}
function visit(node, ctx) {
  node.each((n) => {
    if (n.type === "rule") {
      items.push({ kind: "rule", ctx, sels: n.selectors.map(clean), decls: declsOf(n) });
    } else if (n.type === "atrule") {
      const nm = n.name.toLowerCase();
      if (nm === "font-face") items.push({ kind: "face", ctx: [], decls: declsOf(n) });
      else if (/keyframes$/.test(nm)) {
        if (/^-moz-|^-ms-/.test(nm)) { dropped.vendor++; return; }
        const frames = [];
        n.each((f) => { if (f.type === "rule") frames.push({ sel: clean(f.selector), decls: declsOf(f) }); });
        items.push({ kind: "frames", name: n.params.trim(), prefixed: nm !== "keyframes", frames });
      } else if (/^-moz-|^-ms-|^-o-/.test(nm)) dropped.vendor++;
      else if (/^(media|supports|container|layer)$/.test(nm)) visit(n, [...ctx, `@${nm} ${clean(n.params)}`]);
      else console.error("unhandled at-rule", nm);
    }
  });
}
visit(root, []);
items.forEach((it, i) => (it.idx = i));
const nRulesIn = items.filter((i) => i.kind === "rule").length;

// ------------------------------------------------------------------------------------------------------------ cleanup
const VENDOR_PROP = /^-(moz|ms|o)-/;
const VENDOR_VAL = /-(moz|ms)-(?!user)/; // values such as -moz-box
for (const it of items) {
  if (it.kind === "frames") continue;
  const list = it.decls;
  const seen = new Map();
  const keep = [];
  list.forEach((d, i) => {
    if (VENDOR_PROP.test(d.prop)) { dropped.vendor++; return; }
    if (VENDOR_VAL.test(d.value) && list.some((o, j) => j !== i && o.prop === d.prop && !VENDOR_VAL.test(o.value))) { dropped.vendor++; return; }
    keep.push(d);
  });
  // a later declaration of the same property replaces an earlier one (a var() value never falls back to the earlier one)
  const res = [];
  for (const d of keep) {
    const j = res.findIndex((o) => o.prop === d.prop);
    if (j >= 0) {
      if (res[j].imp && !d.imp) { dropped.dupDecl++; continue; }
      res.splice(j, 1); dropped.dupDecl++;
    }
    res.push(d);
  }
  it.decls = res;
  if (it.kind === "rule") {
    // Chromium discards a whole rule whose selector list holds a -moz-/-ms- pseudo
    const sels = [...new Set(it.sels)];
    it.sels = sels;
    if (sels.some((s) => analyseSelector(s).vendorBad || /::?-(moz|ms|o)-/.test(s))) it.dead = "vendor";
  }
}

// ------------------------------------------------------------------------------------------------------------ unused ids/classes
function tokenSet() {
  const set = new Set();
  const prefixes = [];
  const roots = [path.join(repo, "src"), path.join(repo, "canvas-engine"), path.join(repo, "graph-engine"), path.join(repo, "markdown-engine"), path.join(repo, "search-engine"), path.join(repo, "plugins-sdk"), path.join(repo, "stub")];
  const exts = new Set([".js", ".mjs", ".html", ".ts", ".rs", ".json"]);
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "target" || e.name === "dist" || e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name === "sandbox") continue; walk(p); }
      else if (exts.has(path.extname(e.name))) {
        const txt = fs.readFileSync(p, "utf8");
        for (const m of txt.matchAll(/[A-Za-z_][\w-]*/g)) { set.add(m[0]); }
      }
    }
  };
  for (const r of roots) if (fs.existsSync(r)) walk(r);
  for (const t of set) if (t.endsWith("-") || t.endsWith("_")) prefixes.push(t);
  return { set, prefixes };
}
const used = prune ? tokenSet() : null;
// A name counts as produced when the scripts contain it, a prefix of it ("mod-" + x), or the name minus its last "-part" ("HyperMD-header-" + level).
const allText = prune ? "\n" + [...used.set].join("\n") + "\n" : "";
const isUsed = (name) => {
  if (used.set.has(name) || used.prefixes.some((p) => name.startsWith(p))) return true;
  const cut = name.lastIndexOf("-");
  return cut > 2 && allText.includes(name.slice(0, cut));
};
const SAFE = /^(theme-|is-|mod-|cm-|CodeMirror|HyperMD|markdown-|callout|app-|workspace|obsidian|css-|pdf|hl|token|language-)/; // classes the DOM, themes or snippets add by composition
if (prune) {
  for (const it of items) {
    if (it.kind !== "rule" || it.dead) continue;
    const keepSels = it.sels.filter((s) => {
      const a = analyseSelector(s);
      return a.classes.every((c) => isUsed(c) || SAFE.test(c)) && a.ids.every((i) => isUsed(i));
    });
    if (keepSels.length !== it.sels.length) {
      if (!keepSels.length) it.dead = "unused";
      else it.sels = keepSels;
    }
  }
}
let live = items.filter((it) => !it.dead);
dropped.dead = items.length - live.length;

// ------------------------------------------------------------------------------------------------------------ cascade model
function prep(it) {
  it.fam = new Map(); // family -> {n:bool, i:bool, d:[decls]}
  for (const d of it.decls) { const f = family(d.prop), e = it.fam.get(f) || { d: [] }; e[d.imp ? "i" : "n"] = true; e.d.push(d); it.fam.set(f, e); }
  it.sa = it.sels.map(analyseSelector);
  it.hasAll = it.decls.some((d) => d.prop === "all");
}
live.filter((i) => i.kind === "rule").forEach(prep);
// Two selectors are taken to match a common element when the classes of one rightmost compound are all in the other's (or tags/ids
// agree and neither has a class). Unrelated class names are assumed to belong to different components; the harness checks that.
// Classes that are mixed into many components ("is-active", "clickable-icon") may share an element with anything.
const MIXIN = /^(clickable-icon|svg-icon|tappable)$/;
const USE_PAIRS = args.includes("--pairs");
const pairs = new Set();
{
  // two classes written together in one string literal of the scripts ("a b") land on one element
  const dir = path.join(repo, "src");
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const txt = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of txt.matchAll(/(["'`])((?:[\w-]+ ){1,6}[\w-]+)\1/g)) {
      const toks = m[2].split(" ").filter((x) => /[a-z]-[a-z]/i.test(x));
      for (let i = 0; i < toks.length; i++) for (let j = i + 1; j < toks.length; j++) { pairs.add(toks[i] + "\0" + toks[j]); pairs.add(toks[j] + "\0" + toks[i]); }
    }
  }
}
function mayMeet(p, q) {
  if (p.tag && q.tag && p.tag !== q.tag) return false;
  if (p.id && q.id && p.id !== q.id) return false;
  if (!p.cls.size && !q.cls.size) return true;
  const sub = (x, y) => [...x].every((c) => y.has(c));
  if (sub(p.cls, q.cls) || sub(q.cls, p.cls)) return true;
  if (USE_PAIRS) for (const c of p.cls) for (const d of q.cls) if (pairs.has(c + "\0" + d)) return true;
  const mixed = (s) => [...s].some((c) => MIXIN.test(c));
  return mixed(p.cls) || mixed(q.cls);
}function conflict(a, b) {
  let shared = a.hasAll || b.hasAll;
  if (!shared) for (const [f, ea] of a.fam) { const eb = b.fam.get(f); if (eb && ((ea.n && eb.n) || (ea.i && eb.i)) && !(ea.d.length === eb.d.length && ea.d.every((x, i) => x.prop === eb.d[i].prop && x.value === eb.d[i].value && x.imp === eb.d[i].imp))) { shared = true; break; } }
  if (!shared) return false;
  for (const x of a.sa) for (const y of b.sa) if (cmp(x.spec, y.spec) === 0 && x.pe === y.pe && mayMeet(x.last, y.last)) return true;
  return false;
}

// ------------------------------------------------------------------------------------------------------------ merge same-selector rules
{
  const rules = live.filter((i) => i.kind === "rule");
  const key = (r) => r.ctx.join("|") + "\u0000" + [...r.sels].sort().join(",");
  const lastByKey = new Map();
  const famIndex = new Map(); // family -> sorted list of rules seen so far
  const posOf = new Map(rules.map((r, i) => [r, i]));
  const between = (lo, hi, pred) => { for (let i = lo + 1; i < hi; i++) { if (rules[i].dead) continue; if (pred(rules[i])) return true; } return false; };
  for (const r of rules) {
    const k = key(r);
    const e = lastByKey.get(k);
    if (e && !e.dead) {
      const lo = posOf.get(e), hi = posOf.get(r);
      // move r's declarations back to e only when nothing between e and r competes with them; the reverse (e forward) likewise
      const backOK = !between(lo, hi, (m) => conflict(m, r) || (r.decls.some((d) => d.prop.startsWith("--")) && false));
      const fwdOK = !between(lo, hi, (m) => conflict(m, e));
      if (backOK || fwdOK) {
        const merged = [...e.decls];
        for (const d of r.decls) {
          const j = merged.findIndex((o) => o.prop === d.prop);
          if (j >= 0) { if (merged[j].imp && !d.imp) continue; merged.splice(j, 1); }
          merged.push(d);
        }
        if (backOK) { e.decls = merged; r.dead = "merged"; prep(e); lastByKey.set(k, e); }
        else { r.decls = merged; e.dead = "merged"; prep(r); lastByKey.set(k, r); }
        dropped.merged++;
        continue;
      }
    }
    lastByKey.set(k, r);
  }
}
live = items.filter((it) => !it.dead);
// empty rules vanish
live = live.filter((it) => it.kind !== "rule" || it.decls.length);

// ------------------------------------------------------------------------------------------------------------ buckets + cascade repair
const rules = live.filter((i) => i.kind === "rule");
for (const r of rules) r.bucket = bucketFor(r.sels, r.ctx, r.decls);
for (const r of rules) { r.home = r.bucket; r.layer = 0; }
const tup = (r) => r.layer * 1000 + rank[r.bucket];
if (args.includes("--pos")) {
  const m = {};
  for (const r of rules) { const e = (m[r.bucket] ||= { n: 0, s: 0, min: 1e9, max: 0 }); e.n++; e.s += r.idx; e.min = Math.min(e.min, r.idx); e.max = Math.max(e.max, r.idx); }
  console.log(Object.entries(m).map(([k, e]) => `${k.padEnd(10)} n=${e.n} mean=${Math.round(e.s / e.n)} min=${e.min} max=${e.max}`).sort().join("\n"));
}
const byFam = new Map();
for (const r of rules) for (const f of r.fam.keys()) { if (!byFam.has(f)) byFam.set(f, []); byFam.get(f).push(r); }
let moved = 0;
// earlier rules each rule has to stay behind
const preds = new Map(rules.map((r) => [r, []]));
for (const list of byFam.values()) for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) if (conflict(list[a], list[b])) preds.get(list[b]).push(list[a]);
for (const r of rules) preds.set(r, [...new Set(preds.get(r))]);
const seq = [...rules].sort((a, b) => a.idx - b.idx);
function assign(rk) {
  let n = 0, top = 0;
  for (const y of seq) {
    let layer = 0;
    for (const x of preds.get(y)) layer = Math.max(layer, rk[y.bucket] >= rk[x.bucket] ? x.layer : x.layer + 1);
    y.layer = layer; if (layer) n++; top = Math.max(top, layer);
  }
  return [n, top];
}
if (args.includes("--optimize")) {
  let order = FILES.map((f) => f[0]).filter((b) => b !== "fonts" && b !== "animations");
  const score = (o) => { if (o[0] !== "pdf" || o[o.length - 1] !== "mobile") return 1e9; const [n, top] = assign(Object.fromEntries(o.map((b, i) => [b, i]))); return n + top * 40; };
  order = order.filter((b) => b !== "mobile").concat("mobile");
  let best = score(order);
  const t0 = Date.now();
  for (let improved = true; improved && Date.now() - t0 < 240000;) {
    improved = false;
    for (let i = 0; i < order.length; i++) for (let j = 0; j < order.length; j++) {
      if (i === j) continue;
      const o = order.slice(); const [b] = o.splice(i, 1); o.splice(j, 0, b);
      const s = score(o); if (s < best) { best = s; order = o; improved = true; }
    }
    console.error("score", best, order.join(" "));
  }
}
assign(rank);
for (const r of rules) if (r.layer) r.pulled = true;const pulled = rules.filter((r) => r.pulled).length;
if (args.includes("--why")) {
  const m = new Map();
  for (const r of rules) if (r.layer) { const k = r.home + " L" + r.layer; m.set(k, (m.get(k) || 0) + 1); }
  console.log([...m].sort((a, b) => b[1] - a[1]).slice(0, 25));
  const ex = rules.filter((r) => r.layer).filter((_, i) => i % 40 === 0).map((r) => r.home + " L" + r.layer + "  " + r.sels[0]);
  console.log(ex.join("\n"));
}

// ------------------------------------------------------------------------------------------------------------ keyframes and fonts
const frames = new Map();
for (const it of live.filter((i) => i.kind === "frames")) {
  const prev = frames.get(it.name);
  if (prev && !prev.prefixed && it.prefixed) continue; // the unprefixed definition wins in Chromium when both exist
  frames.set(it.name, it);
}
const faces = live.filter((i) => i.kind === "face");

// ------------------------------------------------------------------------------------------------------------ writing
const ORDER = [
  ["position", ["display", "position", "inset", "z", "float", "clear", "flex", "grid", "order", "align", "justify", "place", "gap", "overflow", "contain", "visibility", "isolation"]],
  ["box", ["box", "width", "height", "size", "aspect", "min", "max", "margin", "padding", "border", "outline", "inline", "block"]],
  ["type", ["font", "line", "letter", "text", "white", "word", "overflow-wrap", "hyphens", "color", "list", "vertical", "direction", "tab", "caret", "quotes", "user", "writing", "unicode", "white-space"]],
  ["paint", ["background", "opacity", "filter", "backdrop", "box-shadow", "mask", "fill", "stroke", "cursor", "pointer", "appearance", "outline-offset", "mix", "clip", "content", "object", "image", "scrollbar", "accent", "color-scheme"]],
  ["motion", ["transform", "transition", "animation", "will", "scroll", "touch", "perspective", "translate", "rotate", "scale", "offset"]],
];
function groupOf(prop) {
  if (prop.startsWith("--")) return -1;
  const f = family(prop);
  const base = prop.replace(/^-(webkit|moz|ms|o)-/, "");
  for (let g = 0; g < ORDER.length; g++) if (ORDER[g][1].some((k) => f === k || base === k || base.startsWith(k + "-") || f.startsWith(k))) return g;
  return ORDER.length;
}
function ordered(decls) {
  // family members keep their relative order (shorthand before longhand); families are ranked by purpose
  const famRank = new Map(), famFirst = new Map();
  decls.forEach((d, i) => { const f = family(d.prop); if (!famRank.has(f)) { famRank.set(f, groupOf(d.prop)); famFirst.set(f, i); } });
  return decls.map((d, i) => ({ d, i, f: family(d.prop) })).sort((a, b) => famRank.get(a.f) - famRank.get(b.f) || famFirst.get(a.f) - famFirst.get(b.f) || a.i - b.i).map((x) => x.d);
}
const fmtDecl = (d, ind) => `${ind}${d.prop}: ${d.value}${d.imp ? " !important" : ""};`;
function fmtBlock(sels, decls, ind, tokens) {
  const head = sels.map((s) => ind + s).join(",\n");
  let body;
  if (tokens) {
    // variables: grouped by the first word of their name, groups and names sorted, a blank line between groups
    const vars = decls.filter((d) => d.prop.startsWith("--")).sort((a, b) => a.prop.localeCompare(b.prop));
    const groups = [];
    for (const d of vars) { const g = d.prop.split("-")[2] || ""; if (!groups.length || groups[groups.length - 1].g !== g) groups.push({ g, l: [] }); groups[groups.length - 1].l.push(d); }
    const rest = ordered(decls.filter((d) => !d.prop.startsWith("--")));
    body = [...groups.map((g) => g.l.map((d) => fmtDecl(d, ind + "  ")).join("\n")), rest.map((d) => fmtDecl(d, ind + "  ")).join("\n")].filter(Boolean).join("\n\n");
  } else body = ordered(decls).map((d) => fmtDecl(d, ind + "  ")).join("\n");
  return `${head} {\n${body}\n${ind}}`;
}
function stem(sels) {
  const m = sels[0].match(/[.#]([A-Za-z][\w]*(?:-[A-Za-z0-9]+)?)/);
  return m ? m[1].replace(/-[A-Za-z0-9]+$/, (x) => x) : null;
}
function wrapCtx(blocks) {
  // blocks: [{ctx, text}] in order -> consecutive blocks in the same at-rule chain share one wrapper
  const out = [];
  let cur = null;
  const indent = (t, n) => t.split("\n").map((l) => (l ? "  ".repeat(n) + l : l)).join("\n");
  for (const b of blocks) {
    if (cur && cur.ctx.join("|") === b.ctx.join("|")) cur.texts.push(b.text);
    else { cur = { ctx: b.ctx, texts: [b.text] }; out.push(cur); }
  }
  return out.map((g) => {
    let t = g.texts.join("\n\n");
    for (let i = g.ctx.length - 1; i >= 0; i--) t = `${g.ctx[i]} {\n${indent(t, 1)}\n}`;
    return t;
  }).join("\n\n");
}

fs.mkdirSync(outDir, { recursive: true });
const wipe = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory() && /^overrides-\d+$/.test(e.name)) { wipe(p); fs.rmdirSync(p); } else if (e.name.endsWith(".css")) fs.unlinkSync(p); } };
wipe(outDir);
const sizes = {};
const maxLayer = Math.max(0, ...rules.map((r) => r.layer));
for (let layer = 0; layer <= maxLayer; layer++) {
  const dir = layer ? path.join(outDir, `overrides-${layer}`) : outDir;
  for (const [bucket, file, about] of FILES) {
    let text = "";
    if (layer === 0 && bucket === "fonts") text = faces.map((f) => `@font-face {\n${f.decls.map((d) => fmtDecl(d, "  ")).join("\n")}\n}`).join("\n\n");
    else if (layer === 0 && bucket === "animations") text = [...frames.values()].map((f) => `@keyframes ${f.name} {\n${f.frames.map((fr) => fmtBlock([fr.sel], fr.decls, "  ")).join("\n")}\n}`).join("\n\n");
    else {
      const mine = rules.filter((r) => r.bucket === bucket && r.layer === layer);
      if (!mine.length) continue;
      const blocks = [];
      let lastStem = null;
      for (const r of mine) {
        const s = stem(r.sels);
        let t = fmtBlock(r.sels, r.decls, "", bucket === "tokens");
        if (s && s !== lastStem && bucket !== "tokens") { t = `/* ${s} */\n${t}`; lastStem = s; }
        blocks.push({ ctx: r.ctx, text: t });
      }
      text = wrapCtx(blocks);
    }
    if (!text) continue;
    fs.mkdirSync(dir, { recursive: true });
    const header = layer
      ? `/* ${file.replace(/^\d+-/, "")} (late): rules of this component that have to stay after rules of components further down the build order. */\n\n`
      : `/* ${file.replace(/^\d+-/, "")}: ${about} */\n\n`;
    fs.writeFileSync(path.join(dir, file + ".css"), header + text + "\n");
    sizes[(layer ? `overrides-${layer}/` : "") + file] = text.length;
  }
}
console.log(`in: ${nRulesIn} rules, ${sizeBefore} bytes`);
console.log(`dropped:`, dropped, `rules in override layers: ${pulled}, layers: ${maxLayer}`);
console.log(Object.entries(sizes).map(([k, v]) => `${k} ${v}`).join("\n"));












