// Dump the s40 slice items from the base bundle.
//   node tools/s40-dump.mjs [name ...]   (default: all names in F:/orch/basalt-s40/ITEMS.json)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle } from "./split-app.mjs";
import { execFileSync } from "node:child_process";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rev = "ca5acac";
const src = execFileSync("git", ["show", `${rev}:src/app.js`], { cwd: root, maxBuffer: 64 << 20, encoding: "utf8" });
const file = path.join(process.env.TEMP || "/tmp", "basalt-s40-base.js");
fs.writeFileSync(file, src);
const b = loadBundle(file);

const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : JSON.parse(fs.readFileSync("F:/orch/basalt-s40/ITEMS.json", "utf8")).map((x) => x.name);

const found = new Map();
for (const n of b.body) {
  if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") found.set(n.id.name, n);
  else if (n.type === "VariableDeclaration") for (const d of n.declarations) {
    const walk = (p, nm) => {
      if (!p) return;
      if (p.type === "Identifier") { if (nm === null) found.set(p.name, n); return; }
      if (p.type === "ObjectPattern") for (const q of p.properties) walk(q.type === "RestElement" ? q.argument : q.value, null);
      else if (p.type === "ArrayPattern") for (const q of p.elements) walk(q, null);
      else if (p.type === "AssignmentPattern") walk(p.left, null);
      else if (p.type === "RestElement") walk(p.argument, null);
    };
    walk(d.id, null);
  } else if (n.type === "ExpressionStatement") {
    // assignment X = ... or sequence
    const exprs = n.expression.type === "SequenceExpression" ? n.expression.expressions : [n.expression];
    for (const e of exprs) {
      if (e.type === "AssignmentExpression" && e.left.type === "Identifier") found.set(e.left.name, n);
    }
  }
}

for (const name of names) {
  const n = found.get(name);
  if (!n) { console.log(`### ${name}: NOT FOUND`); continue; }
  // find the declarator if the statement has several
  let node = n;
  if (n.type === "VariableDeclaration") {
    for (const d of n.declarations) {
      const has = (p) => p && (p.type === "Identifier" ? p.name === name : true);
      // check pattern contains name
      const contains = (p) => {
        if (!p) return false;
        if (p.type === "Identifier") return p.name === name;
        if (p.type === "ObjectPattern") return p.properties.some((q) => contains(q.type === "RestElement" ? q.argument : q.value));
        if (p.type === "ArrayPattern") return p.elements.some(contains);
        if (p.type === "AssignmentPattern") return contains(p.left);
        if (p.type === "RestElement") return contains(p.argument);
        return false;
      };
      if (contains(d.id)) { node = d; break; }
    }
  }
  console.log(`### ${name} [${node.type}] ${node.end - node.start}b`);
  console.log(src.slice(node.start, node.end));
  console.log();
}
