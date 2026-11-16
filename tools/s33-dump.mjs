import { loadBase } from "./app-base.mjs";
import { loadBundle } from "./split-app.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const items = JSON.parse(fs.readFileSync("F:/orch/basalt-s33/ITEMS.json","utf8"));
const base = loadBase("ca5acac");
const tmp = path.join(os.tmpdir(), "basalt-s33-base.js");
fs.writeFileSync(tmp, base.src);
const b = loadBundle(tmp);
const decl = new Map();
for (const n of b.body) {
  if (n.type === "FunctionDeclaration") decl.set(n.id.name, n);
  if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.id.type === "Identifier") decl.set(d.id.name, d);
}
const outdir = "F:/orch/basalt-s33/dump2";
fs.mkdirSync(outdir, {recursive:true});
for (const it of items) {
  const n = decl.get(it.name);
  const node = n.init && n.init.type !== "Identifier" ? (["Literal","MemberExpression","ObjectExpression","CallExpression","FunctionExpression","ArrowFunctionExpression","ClassExpression"].includes(n.init.type) ? n.init : n) : n;
  const text = n ? base.src.slice(node.start, node.end) : "MISSING";
  fs.writeFileSync(`${outdir}/${it.name}-${it.kind}.js`, text);
}
console.log("done");
