// Dump the top-level statements of the base bundle whose declared names are in ITEMS.json
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBundle, acorn } from "./split-app.mjs";

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const base = path.join(os.tmpdir(), "basalt-app-base-ca5acac.js");
const items = JSON.parse(fs.readFileSync("F:/orch/basalt-s35/ITEMS.json", "utf8"));
const want = new Set(items.map((i) => i.name));
const b = loadBundle(base);

function* declNames(node) {
  if (!node) return;
  switch (node.type) {
    case "FunctionDeclaration":
    case "ClassDeclaration":
      yield node.id.name;
      return;
    case "VariableDeclaration":
      for (const d of node.declarations) yield* pattern(d.id);
      return;
    case "ExpressionStatement": {
      const e = node.expression;
      if (e.type === "AssignmentExpression" && e.left.type === "Identifier") yield e.left.name;
      if (e.type === "AssignmentExpression" && e.left.type === "MemberExpression" && !e.left.computed && e.left.object.type === "Identifier") yield e.left.object.name + "." + e.left.property.name;
      return;
    }
  }
}
function* pattern(p) {
  if (!p) return;
  if (p.type === "Identifier") yield p.name;
  else if (p.type === "ObjectPattern") for (const q of p.properties) yield* pattern(q.type === "RestElement" ? q.argument : q.value);
  else if (p.type === "ArrayPattern") for (const q of p.elements) yield* pattern(q);
  else if (p.type === "RestElement" || p.type === "AssignmentPattern") yield* pattern(p.argument || p.left);
}

const found = new Map();
for (const n of b.body) {
  for (const name of declNames(n)) {
    const key = name.split(".")[0];
    if (want.has(key) || want.has(name)) found.set(want.has(name) ? name : key, n);
  }
}
for (const it of items) {
  const n = found.get(it.name);
  if (!n) { console.log(`// MISSING ${it.name}`); continue; }
  console.log(`\n===== ${it.name} (${it.kind}, ${it.bytes} bytes) stmtType=${n.type} =====`);
  console.log(b.src.slice(n.start, Math.min(n.end, n.start + it.bytes + 4000)));
}
