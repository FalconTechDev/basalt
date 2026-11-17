// Free identifier names of each s40 item init (as seen from app scope).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import * as acorn from "acorn";
import { freeNames } from "./split-app.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = execFileSync("git", ["show", "ca5acac:src/app.js"], { cwd: root, maxBuffer: 64 << 20, encoding: "utf8" });
const file = path.join(process.env.TEMP || "/tmp", "basalt-s40-base.js");
fs.writeFileSync(file, src);
const ast = acorn.parse(src, { ecmaVersion: 2022 });
const outer = ast.body[0].expression.callee;
const seq = outer.body.body[2].expression.expressions;
const app = seq[seq.length - 1].callee;

const items = JSON.parse(fs.readFileSync("F:/orch/basalt-s40/ITEMS.json", "utf8"));
const want = new Set(process.argv.slice(2));
const nodes = new Map();
for (const n of app.body.body) {
  if (n.type === "FunctionDeclaration") nodes.set(n.id.name, n);
  else if (n.type === "VariableDeclaration") for (const d of n.declarations) {
    const has = (p) => {
      if (!p) return false;
      if (p.type === "Identifier") return p.name === d.id.name || hasName(p);
      return false;
    };
    const hasName = (p) => {
      if (!p) return false;
      if (p.type === "Identifier") return items.some((i) => i.name === p.name);
      if (p.type === "ObjectPattern") return p.properties.some((q) => hasName(q.type === "RestElement" ? q.argument : q.value));
      if (p.type === "ArrayPattern") return p.elements.some(hasName);
      if (p.type === "AssignmentPattern") return hasName(p.left);
      if (p.type === "RestElement") return hasName(p.argument);
      return false;
    };
    if (hasName(d.id)) for (const it of items) {
      const contains = (p) => {
        if (!p) return false;
        if (p.type === "Identifier") return p.name === it.name;
        if (p.type === "ObjectPattern") return p.properties.some((q) => contains(q.type === "RestElement" ? q.argument : q.value));
        if (p.type === "ArrayPattern") return p.elements.some(contains);
        if (p.type === "AssignmentPattern") return contains(p.left);
        if (p.type === "RestElement") return contains(p.argument);
        return false;
      };
      if (contains(d.id)) nodes.set(it.name, d.init || d);
    }
  }
}

// declared names in app scope (to filter out)
const declared = new Set();
for (const n of app.body.body) {
  if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") declared.add(n.id.name);
  else if (n.type === "VariableDeclaration") for (const d of n.declarations) {
    const c = (p) => { if (!p) return; if (p.type === "Identifier") declared.add(p.name); else if (p.type === "ObjectPattern") p.properties.forEach((q) => c(q.type === "RestElement" ? q.argument : q.value)); else if (p.type === "ArrayPattern") p.elements.forEach(c); else if (p.type === "AssignmentPattern") c(p.left); else if (p.type === "RestElement") c(p.argument); };
    c(d.id);
  }
}

for (const it of items) {
  if (want.size && !want.has(it.name)) continue;
  const node = nodes.get(it.name);
  if (!node) { console.log(`${it.name}: NOT FOUND`); continue; }
  // wrap non-function inits
  let fnNode = node;
  if (node.type !== "FunctionDeclaration") {
    const wrapped = acorn.parse(`function __w(){return (${src.slice(node.start, node.end)});}`, { ecmaVersion: 2022 }).body[0];
    fnNode = wrapped;
  }
  const free = [...freeNames(fnNode)].filter((x) => x !== "__w" && !declared.has(x) || declared.has(x));
  // freeNames already excludes names bound inside; it includes app-scope names too (they're free). Just report all.
  console.log(`${it.name} [${node.type}] free: ${[...freeNames(fnNode)].filter((x) => x !== "__w").sort().join(" ")}`);
}
