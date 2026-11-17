import { loadBase } from "./app-base.mjs";
import { loadBundle } from "./split-app.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const b = loadBase("ca5acac");
const f = path.join(os.tmpdir(), "basalt-s90-base.js");
fs.writeFileSync(f, b.src);
const bl = loadBundle(f);
// print all top-level decls between 662000 and 672000
for (const n of bl.body) {
  if (n.start >= 662000 && n.start <= 672500) {
    const nm = n.id ? n.id.name : n.declarations ? n.declarations.map(d => d.id.name).join(",") : "?";
    console.log(n.type.padEnd(22), String(n.start).padStart(7), String(n.end - n.start).padStart(6), nm);
  }
}
// find declarations of helper names
const want = new Set(["Pu", "Tu", "Iu", "tp", "ct", "Te", "ji", "me", "_o", "Xn", "Vn", "Lu", "Zd"]);
for (const n of bl.body) {
  const names = [];
  if (n.type === "FunctionDeclaration") names.push(n.id.name);
  if (n.type === "VariableDeclaration") for (const d of n.declarations) {
    const ids = [];
    (function pat(p) { if (!p) return; if (p.type === "Identifier") ids.push(p.name); else if (p.type === "ObjectPattern") p.properties.forEach(pr => pat(pr.value || pr.key)); else if (p.type === "ArrayPattern") p.elements.forEach(pat); else if (p.type === "AssignmentPattern") pat(p.left); else if (p.type === "RestElement") pat(p.argument); })(d.id);
    for (const i of ids) names.push(i);
  }
  if (names.some(x => want.has(x))) console.log("DEF", n.type, n.start, names.filter(x => want.has(x)).join(","));
}
