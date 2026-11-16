import { loadBase } from "./app-base.mjs";
import { loadBundle } from "./split-app.mjs";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const base = loadBase("ca5acac");
const tmp = path.join(os.tmpdir(), "basalt-s33-base.js");
fs.writeFileSync(tmp, base.src);
const b = loadBundle(tmp);
const decl = new Map();
for (const n of b.body) {
  if (n.type === "FunctionDeclaration") decl.set(n.id.name, n);
  if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.id.type === "Identifier") decl.set(d.id.name, d);
}
const n = decl.get("b5");
console.log(n.type, n.start, n.end, JSON.stringify(base.src.slice(n.start, n.end)));
