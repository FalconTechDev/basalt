// Structure report for src/app.js (the big minified bundle).
//   node tools/split-app.mjs [--file src/app.js] [--json out.json] [--md docs/APP-MAP.md]
//
// The bundle is  (()=>{ var modules={...}; function require(){}; (()=>{ ...the whole application... })() })()
// The application is ONE function scope: ~1200 function declarations, ~600 var statements,
// classes and `X.prototype.y=` assignments. This tool parses it (acorn), does a real scope
// analysis per top-level function and decides which functions are "leaf": they only touch
// JS built-ins and other leaf functions, nothing from the DOM, Electron or the app state.
// That is the set that can be rewritten as standalone modules first.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";
export { acorn };

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);

export const PURE_GLOBALS = new Set(("undefined NaN Infinity Object Array String Number Boolean Symbol BigInt Math JSON Date RegExp Error TypeError RangeError SyntaxError " +
  "Map Set WeakMap WeakSet WeakRef Promise Proxy Reflect Uint8Array Uint16Array Uint32Array Int8Array Int16Array Int32Array Float32Array Float64Array ArrayBuffer DataView " +
  "parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent encodeURI decodeURI escape unescape globalThis Intl arguments").split(" "));
export const DOM_GLOBALS = new Set(("window document navigator location localStorage sessionStorage self console setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame " +
  "HTMLElement Element Node Event KeyboardEvent MouseEvent CustomEvent MutationObserver ResizeObserver IntersectionObserver Image Audio URL URLSearchParams Blob File FileReader fetch XMLHttpRequest " +
  "TextEncoder TextDecoder crypto performance structuredClone queueMicrotask btoa atob getComputedStyle DOMParser XMLSerializer Worker require process Buffer app activeDocument activeWindow createEl createDiv createSpan").split(" "));

// ---------------------------------------------------------------- scope analysis

function patternNames(p, out) {
  if (!p) return;
  switch (p.type) {
    case "Identifier": out.add(p.name); break;
    case "ObjectPattern": for (const q of p.properties) patternNames(q.type === "RestElement" ? q.argument : q.value, out); break;
    case "ArrayPattern": for (const q of p.elements) patternNames(q, out); break;
    case "RestElement": patternNames(p.argument, out); break;
    case "AssignmentPattern": patternNames(p.left, out); break;
  }
}

// var-declared names + function declarations hoisted to the function level
function hoisted(body, out) {
  const visit = (n) => {
    if (!n || typeof n.type !== "string") return;
    switch (n.type) {
      case "VariableDeclaration": if (n.kind === "var") for (const d of n.declarations) patternNames(d.id, out); break;
      case "FunctionDeclaration": out.add(n.id.name); return;
      case "FunctionExpression": case "ArrowFunctionExpression": case "ClassDeclaration": case "ClassExpression": return;
    }
    for (const k in n) {
      if (k === "type" || k === "start" || k === "end") continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v.type === "string") visit(v);
    }
  };
  if (Array.isArray(body)) body.forEach(visit); else visit(body);
}
function blockLexicals(stmts, out) {
  for (const s of stmts) {
    if (s.type === "VariableDeclaration" && s.kind !== "var") for (const d of s.declarations) patternNames(d.id, out);
    else if (s.type === "ClassDeclaration") out.add(s.id.name);
  }
}

// Returns the Set of free identifier names referenced by `fnNode` (a whole function node).
export function freeNames(fnNode) {
  const free = new Set();
  const lookup = (sc, name) => { for (let s = sc; s; s = s.parent) if (s.names.has(name)) return true; return false; };
  const ref = (sc, name) => { if (!lookup(sc, name)) free.add(name); };

  function fn(n, sc) {
    const names = new Set(["arguments"]);
    if (n.type === "FunctionExpression" && n.id) names.add(n.id.name);
    for (const p of n.params) patternNames(p, names);
    const inner = { names, parent: sc };
    if (n.body.type === "BlockStatement") { hoisted(n.body.body, names); blockLexicals(n.body.body, names); }
    for (const p of n.params) expr(p, inner, true);
    if (n.body.type === "BlockStatement") n.body.body.forEach((s) => stmt(s, inner)); else expr(n.body, inner);
  }
  function stmt(n, sc) { expr(n, sc); }
  function expr(n, sc, patOnlyDefaults) {
    if (!n || typeof n.type !== "string") return;
    switch (n.type) {
      case "Identifier": if (!patOnlyDefaults) ref(sc, n.name); return;
      case "FunctionDeclaration": fn(n, sc); return;
      case "FunctionExpression": case "ArrowFunctionExpression": fn(n, sc); return;
      case "MemberExpression": expr(n.object, sc); if (n.computed) expr(n.property, sc); return;
      case "Property": case "PropertyDefinition": case "MethodDefinition":
        if (n.computed) expr(n.key, sc); expr(n.value, sc, patOnlyDefaults); return;
      case "LabeledStatement": expr(n.body, sc); return;
      case "BreakStatement": case "ContinueStatement": return;
      case "BlockStatement": case "StaticBlock": { const names = new Set(); blockLexicals(n.body, names); const s2 = { names, parent: sc }; n.body.forEach((s) => expr(s, s2)); return; }
      case "ForStatement": case "ForInStatement": case "ForOfStatement": {
        const names = new Set(); const d = n.init || n.left;
        if (d && d.type === "VariableDeclaration" && d.kind !== "var") for (const x of d.declarations) patternNames(x.id, names);
        const s2 = { names, parent: sc };
        for (const k of ["init", "test", "update", "left", "right", "body"]) expr(n[k], s2);
        return;
      }
      case "SwitchStatement": { expr(n.discriminant, sc); const names = new Set(); for (const c of n.cases) blockLexicals(c.consequent, names); const s2 = { names, parent: sc }; for (const c of n.cases) { expr(c.test, s2); c.consequent.forEach((s) => expr(s, s2)); } return; }
      case "CatchClause": { const names = new Set(); patternNames(n.param, names); const s2 = { names, parent: sc }; expr(n.body, s2); return; }
      case "ClassDeclaration": case "ClassExpression": {
        const names = new Set(); if (n.id) names.add(n.id.name);
        const s2 = { names, parent: sc }; expr(n.superClass, sc); n.body.body.forEach((m) => expr(m, s2)); return;
      }
    }
    for (const k in n) {
      if (k === "type" || k === "start" || k === "end") continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((x) => expr(x, sc)); else if (v && typeof v.type === "string") expr(v, sc);
    }
  }
  const outer = { names: new Set(), parent: null };
  if (fnNode.type === "FunctionDeclaration") outer.names.add(fnNode.id.name); // own name stays resolvable (recursion), reported separately
  fn(fnNode, outer);
  return free;
}

// ---------------------------------------------------------------- bundle structure

export function loadBundle(file) {
  const src = fs.readFileSync(file, "utf8");
  const ast = acorn.parse(src, { ecmaVersion: 2022 });
  const outer = ast.body[0].expression.callee;
  const prelude = outer.body.body[0]; // var modules = {...}
  const seq = outer.body.body[2].expression.expressions;
  const appCall = seq[seq.length - 1];
  const app = appCall.callee; // the big arrow function
  return { src, ast, outer, prelude, app, body: app.body.body };
}

export function analyze(file) {
  const b = loadBundle(file);
  const { src, body } = b;
  const declared = new Map(); // name -> kind
  for (const n of body) {
    if (n.type === "FunctionDeclaration") declared.set(n.id.name, "function");
    else if (n.type === "ClassDeclaration") declared.set(n.id.name, "class");
    else if (n.type === "VariableDeclaration") for (const d of n.declarations) { const s = new Set(); patternNames(d.id, s); for (const x of s) declared.set(x, "var"); }
  }
  // constants: var declarators whose initialiser is built only from literals, built-ins and other constants
  const consts = new Map();
  const declNodes = [];
  for (const n of body) if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.id.type === "Identifier" && d.init) declNodes.push(d);
  const pureExpr = (e) => {
    if (!e) return true;
    switch (e.type) {
      case "Literal": return true;
      case "TemplateLiteral": return e.expressions.every(pureExpr);
      case "ArrayExpression": return e.elements.every((x) => !x || (x.type !== "SpreadElement" && pureExpr(x)));
      case "ObjectExpression": return e.properties.every((p) => p.type === "Property" && !p.computed && p.kind === "init" && !p.method && pureExpr(p.value));
      case "Identifier": return PURE_GLOBALS.has(e.name) || consts.has(e.name);
      case "MemberExpression": return pureExpr(e.object) && (!e.computed || pureExpr(e.property));
      case "UnaryExpression": return e.operator !== "delete" && pureExpr(e.argument);
      case "BinaryExpression": case "LogicalExpression": return pureExpr(e.left) && pureExpr(e.right);
      case "ConditionalExpression": return pureExpr(e.test) && pureExpr(e.consequent) && pureExpr(e.alternate);
      case "SequenceExpression": return e.expressions.every(pureExpr);
      case "NewExpression": case "CallExpression": {
        let c = e.callee; while (c.type === "MemberExpression") c = c.object;
        return c.type === "Identifier" && PURE_GLOBALS.has(c.name) && pureExpr(e.callee) && e.arguments.every(pureExpr);
      }
    }
    return false;
  };
  for (let changed = true; changed;) { changed = false; for (const d of declNodes) if (!consts.has(d.id.name) && pureExpr(d.init)) { consts.set(d.id.name, { name: d.id.name, start: d.start, end: d.end }); changed = true; } }
  // a name assigned more than once is not a constant
  const assigned = new Map();
  (function scan(n) { if (!n || typeof n.type !== "string") return; if (n.type === "AssignmentExpression" && n.left.type === "Identifier") assigned.set(n.left.name, 1); if (n.type === "UpdateExpression" && n.argument.type === "Identifier") assigned.set(n.argument.name, 1); for (const k in n) { if (k === "type") continue; const v = n[k]; if (Array.isArray(v)) v.forEach(scan); else if (v && typeof v.type === "string") scan(v); } })(b.app);
  for (const k of assigned.keys()) consts.delete(k);
  const funcs = [];
  for (const n of body) if (n.type === "FunctionDeclaration") {
    const free = freeNames(n); free.delete(n.id.name);
    const deps = [], globals = [], dom = [], unknown = [], constDeps = [];
    for (const f of free) {
      if (consts.has(f) && declared.get(f) === "var") constDeps.push(f);
      else if (declared.has(f)) deps.push(f);
      else if (PURE_GLOBALS.has(f)) globals.push(f);
      else if (DOM_GLOBALS.has(f)) dom.push(f);
      else unknown.push(f);
    }
    funcs.push({ name: n.id.name, start: n.start, end: n.end, size: n.end - n.start, params: n.params.length, deps, constDeps, globals, dom, unknown });
  }
  // fixpoint: leaf = only globals + other leaves (functions only) and no dom/unknown
  const byName = new Map(funcs.map((f) => [f.name, f]));
  let leaf = new Set(funcs.filter((f) => !f.dom.length && !f.unknown.length).map((f) => f.name));
  for (let changed = true; changed;) {
    changed = false;
    for (const name of [...leaf]) {
      const f = byName.get(name);
      if (f.deps.some((d) => !leaf.has(d))) { leaf.delete(name); changed = true; }
    }
  }
  for (const f of funcs) { f.leaf = leaf.has(f.name); f.selfContained = f.leaf && f.deps.length === 0 && f.constDeps.length === 0; }

  // classes
  const classes = body.filter((n) => n.type === "ClassDeclaration").map((n) => ({ name: n.id.name, start: n.start, size: n.end - n.start, ext: n.superClass ? src.slice(n.superClass.start, n.superClass.end) : null, methods: n.body.body.length }));
  // prototype groups:  X.prototype.y = ...   (also inside sequence expressions)
  const proto = new Map();
  const note = (e, stmtSize) => {
    if (e.type === "SequenceExpression") return e.expressions.forEach((x) => note(x, 0));
    if (e.type !== "AssignmentExpression") return;
    const l = e.left;
    if (l.type === "MemberExpression" && l.object.type === "MemberExpression" && !l.object.computed && l.object.property.name === "prototype" && l.object.object.type === "Identifier") {
      const k = l.object.object.name; const g = proto.get(k) || { name: k, members: 0, size: 0 };
      g.members++; g.size += e.end - e.start; proto.set(k, g);
    }
  };
  for (const n of body) if (n.type === "ExpressionStatement") note(n.expression);
  const varBytes = body.filter((n) => n.type === "VariableDeclaration").reduce((a, n) => a + n.end - n.start, 0);
  const other = body.filter((n) => !["FunctionDeclaration", "ClassDeclaration", "VariableDeclaration"].includes(n.type));
  // webpack package modules
  const mods = b.prelude.declarations[0].init.properties.map((p) => ({ id: String(p.key.value ?? p.key.name), size: p.end - p.start }));

  return {
    consts: [...consts.values()],
    file, bytes: src.length, appStart: b.app.start, appEnd: b.app.end, appBytes: b.app.end - b.app.start,
    packageModules: { count: mods.length, bytes: mods.reduce((a, m) => a + m.size, 0), largest: mods.sort((a, b) => b.size - a.size).slice(0, 8) },
    functions: funcs, classes, protoGroups: [...proto.values()].sort((a, b) => b.size - a.size),
    varBytes, varCount: body.filter((n) => n.type === "VariableDeclaration").reduce((a, n) => a + n.declarations.length, 0),
    otherBytes: other.reduce((a, n) => a + n.end - n.start, 0), otherCount: other.length,
  };
}

// ---------------------------------------------------------------- report

const kb = (n) => (n / 1024).toFixed(1) + " KB";
export function printSummary(r) {
  const f = r.functions, leaf = f.filter((x) => x.leaf), sc = f.filter((x) => x.selfContained);
  const sum = (a) => a.reduce((s, x) => s + x.size, 0);
  console.log(`${r.file}: ${kb(r.bytes)}; app scope ${kb(r.appBytes)}; package modules ${r.packageModules.count} (${kb(r.packageModules.bytes)})`);
  console.log(`functions ${f.length} (${kb(sum(f))}); leaf ${leaf.length} (${kb(sum(leaf))}); self-contained ${sc.length} (${kb(sum(sc))})`);
  console.log(`classes ${r.classes.length} (${kb(sum(r.classes))}); prototype groups ${r.protoGroups.length} (${kb(sum(r.protoGroups))}); var statements ${r.varCount} (${kb(r.varBytes)})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const file = path.resolve(arg("--file", path.join(root, "src/app.js")));
  const r = analyze(file);
  printSummary(r);
  const j = arg("--json");
  if (j) fs.writeFileSync(j, JSON.stringify(r, null, 1));
  const md = arg("--md");
  if (md) { const { renderMap } = await import("./app-map-render.mjs"); fs.writeFileSync(md, renderMap(r)); console.log("wrote", md); }
}
