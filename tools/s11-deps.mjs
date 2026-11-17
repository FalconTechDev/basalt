// For each item in ITEMS.json: compute the free names it needs and check coverage
// (other slice items / envBind / host / pure globals / window globals / still-minified app names).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as acorn from "acorn";
import { loadBase } from "./app-base.mjs";
import { freeNames, PURE_GLOBALS, DOM_GLOBALS } from "./split-app.mjs";
import { readManifest } from "../build-app.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const items = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "ITEMS.json"), "utf8"));
const manifest = readManifest();
const base = loadBase(manifest.base);
const src = base.src;
const ast = acorn.parse(src, { ecmaVersion: 2022 });
const outer = ast.body[0].expression.callee;
const seq = outer.body.body[2].expression.expressions;
const appBody = seq[seq.length - 1].callee.body.body;

// all top-level declared names in the app scope
const declared = new Map(); // name -> node
for (const n of appBody) {
  if (n.type === "FunctionDeclaration") declared.set(n.id.name, n);
  else if (n.type === "ClassDeclaration") declared.set(n.id.name, n);
  else if (n.type === "VariableDeclaration") for (const d of n.declarations) {
    const s = new Set();
    (function pn(p) { if (!p) return; if (p.type === "Identifier") s.add(p.name); else if (p.type === "ObjectPattern") p.properties.forEach((q) => pn(q.type === "RestElement" ? q.argument : q.value)); else if (p.type === "ArrayPattern") p.elements.forEach(pn); else if (p.type === "RestElement") pn(p.argument); else if (p.type === "AssignmentPattern") pn(p.left); })(d.id);
    for (const x of s) declared.set(x, d);
  }
}

const mine = new Set(items.map((i) => i.name));
const envKeys = new Set(), envVals = new Set();
for (const part of (manifest.envBind || "").split(",")) { const p = part.trim(); if (!p) continue; const [k, v] = p.split(":"); envKeys.add(k); envVals.add(v || k); }
const hostKeys = new Set(Object.keys(manifest.host || {}));
const hostVals = new Set(Object.values(manifest.host || {}));
const replacedOrig = new Set([...(manifest.entries || []).map((e) => e.orig), ...(manifest.classes || []).map((e) => e.orig), ...(manifest.declarators || []).map((e) => e.orig)]);

function freeOfNode(node) {
  // wrap expression nodes as an arrow returning them; function nodes pass through
  let fn = node;
  if (node.type !== "FunctionDeclaration" && node.type !== "FunctionExpression" && node.type !== "ArrowFunctionExpression") {
    fn = { type: "ArrowFunctionExpression", params: [], body: { type: "BlockStatement", body: [{ type: "ReturnStatement", argument: node }] }, start: node.start, end: node.end };
  } else if (node.type === "FunctionExpression") {
    fn = { type: "FunctionDeclaration", id: { type: "Identifier", name: "__self" }, params: node.params, body: node.body, start: node.start, end: node.end };
  }
  const free = freeNames(fn);
  free.delete("__self");
  return free;
}

const nodeOf = new Map();
for (const n of appBody) {
  if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") nodeOf.set(n.id.name, n);
  else if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.id.type === "Identifier") nodeOf.set(d.id.name, d.init || d);
}

const report = {};
for (const it of items) {
  const node = nodeOf.get(it.name);
  if (!node) { report[it.name] = { error: "no node" }; continue; }
  const target = it.kind === "function" ? node : (node.type === "FunctionExpression" ? node : (declared.get(it.name) && declared.get(it.name).init ? declared.get(it.name).init : node));
  // for var items use the init expression; for function decls the whole node
  const useNode = it.kind === "function" ? node : (node.init || node);
  const free = [...freeOfNode(useNode)];
  const cats = { mine: [], replaced: [], env: [], host: [], pure: [], dom: [], window: [], otherApp: [], unknown: [] };
  for (const f of free) {
    if (mine.has(f)) cats.mine.push(f);
    else if (replacedOrig.has(f)) cats.replaced.push(f);
    else if (envVals.has(f) || envKeys.has(f)) cats.env.push(f);
    else if (hostVals.has(f)) cats.host.push(f);
    else if (PURE_GLOBALS.has(f)) cats.pure.push(f);
    else if (DOM_GLOBALS.has(f)) cats.dom.push(f);
    else if (/^[A-Z]/.test(f) === false && declared.has(f)) cats.otherApp.push(f);
    else if (declared.has(f)) cats.otherApp.push(f);
    else cats.unknown.push(f);
  }
  report[it.name] = { kind: it.kind, bytes: it.bytes, ...cats };
}
fs.writeFileSync(path.join(here, "..", "..", "s11-items", "deps.json"), JSON.stringify(report, null, 1));
// summary: names needed from env (otherApp not covered) across all items
const needEnv = new Map(), needHost = new Map();
for (const [n, r] of Object.entries(report)) {
  for (const f of r.otherApp || []) { if (!needEnv.has(f)) needEnv.set(f, []); needEnv.get(f).push(n); }
  for (const f of r.unknown || []) { if (!needEnv.has("?" + f)) needEnv.set("?" + f, []); needEnv.get("?" + f).push(n); }
}
console.log("== otherApp/unknown deps (need envBind or are window globals) ==");
for (const [k, v] of [...needEnv.entries()].sort()) console.log(k, "<-", v.slice(0, 6).join(","), v.length > 6 ? `+${v.length - 6}` : "");
