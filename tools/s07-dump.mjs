// Dump the s07 slice items (F:/orch/basalt-s07/ITEMS.json) from the base bundle.
//   node tools/s07-dump.mjs            -> summary table to stdout
//   node tools/s07-dump.mjs --json f   -> full JSON {name,kind,bytes,start,end,text,deps}
//   node tools/s07-dump.mjs --src NAME -> print the source of one item
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle } from "./split-app.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const items = JSON.parse(fs.readFileSync("F:/orch/basalt-s07/ITEMS.json", "utf8"));

// find the base app.js: prefer the git base revision file cached by app-base, else extract via git
import { execFileSync } from "node:child_process";
import os from "node:os";
const baseFile = path.join(os.tmpdir(), "basalt-app-base-ca5acac.js");
if (!fs.existsSync(baseFile)) {
  fs.writeFileSync(baseFile, execFileSync("git", ["show", "ca5acac:src/app.js"], { cwd: root, maxBuffer: 64 << 20 }));
}
const b = loadBundle(baseFile);
const src = fs.readFileSync(baseFile, "utf8");
const body = b.body;

// map every top-level name -> {node, kind}
const decls = new Map();
for (const n of body) {
  if (n.type === "FunctionDeclaration") decls.set(n.id.name, { node: n, kind: "function" });
  else if (n.type === "ClassDeclaration") decls.set(n.id.name, { node: n, kind: "class" });
  else if (n.type === "VariableDeclaration") {
    for (const d of n.declarations) {
      const names = [];
      (function pn(p) {
        if (!p) return;
        if (p.type === "Identifier") names.push(p.name);
        else if (p.type === "ObjectPattern") p.properties.forEach((q) => pn(q.type === "RestElement" ? q.argument : q.value));
        else if (p.type === "ArrayPattern") p.elements.forEach(pn);
        else if (p.type === "RestElement") pn(p.argument);
        else if (p.type === "AssignmentPattern") pn(p.left);
      })(d.id);
      for (const nm of names) decls.set(nm, { node: d, kind: "var" });
    }
  }
}

// collect free identifier names inside a node (rough: all identifiers minus property names/member non-computed)
function idents(node, out = new Set()) {
  (function w(n) {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "Identifier") { out.add(n.name); return; }
    if (n.type === "MemberExpression" && !n.computed) { w(n.object); return; }
    if (n.type === "Property" && !n.computed && n.key.type === "Identifier") { w(n.value); return; }
    if (n.type === "LabeledStatement") { w(n.body); return; }
    if (n.type === "BreakStatement" || n.type === "ContinueStatement") return;
    for (const k in n) {
      if (k === "type" || k === "start" || k === "end") continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(w); else if (v && typeof v.type === "string") w(v);
    }
  })(node);
  return out;
}

const declared = new Set(decls.keys());
const rows = [];
for (const it of items) {
  const d = decls.get(it.name);
  if (!d) { rows.push({ name: it.name, kind: it.kind, missing: true }); continue; }
  const node = d.node;
  const text = src.slice(node.start, node.end);
  let deps = [];
  if (node.type === "FunctionDeclaration") {
    // reuse freeNames from split-app for accuracy
    const { freeNames } = await import("./split-app.mjs");
    deps = [...freeNames(node)].filter((x) => x !== node.id.name && declared.has(x));
  } else {
    deps = [...idents(node.init || node)].filter((x) => declared.has(x));
  }
  rows.push({
    name: it.name, kind: it.kind, bytes: it.bytes, text,
    deps, start: node.start, end: node.end,
    head: text.slice(0, 160).replace(/\s+/g, " "),
  });
}

const arg = process.argv[2];
if (arg === "--json") {
  fs.writeFileSync(process.argv[3], JSON.stringify(rows, null, 1));
  console.log("wrote", process.argv[3], rows.length, "rows");
} else if (arg === "--src") {
  const r = rows.find((x) => x.name === process.argv[3]);
  console.log(r ? r.text : "MISSING " + process.argv[3]);
} else {
  const missing = rows.filter((r) => r.missing);
  for (const r of rows.sort((a, b) => (b.bytes || 0) - (a.bytes || 0))) {
    if (r.missing) { console.log(`${r.name}\tMISSING\t${r.kind}`); continue; }
    console.log(`${r.name}\t${String(r.bytes).padStart(6)}\t${r.kind}\tdeps:${r.deps.length}\t${r.head}`);
  }
  console.log("missing:", missing.length, missing.map((m) => m.name).join(","));
}
