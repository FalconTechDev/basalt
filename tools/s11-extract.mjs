// Extract the source text of each item in ../ITEMS.json from the original bundle.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBase } from "./app-base.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const items = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "ITEMS.json"), "utf8"));
const base = loadBase("ca5acac");
import * as acorn from "acorn";
const ast = acorn.parse(base.src, { ecmaVersion: 2022 });
const outer = ast.body[0].expression.callee;
const seq = outer.body.body[2].expression.expressions;
const appCall = seq[seq.length - 1];
const appBody = appCall.callee.body.body;
const src = base.src;

const found = new Map();
for (const n of appBody) {
  if (n.type === "FunctionDeclaration") found.set(n.id.name, { node: n, kind: "function" });
  else if (n.type === "ClassDeclaration") found.set(n.id.name, { node: n, kind: "class" });
  else if (n.type === "VariableDeclaration") for (const d of n.declarations) {
    if (d.id.type === "Identifier") found.set(d.id.name, { node: d, kind: "var", stmt: n });
  } else if (n.type === "ExpressionStatement") {
    // e.g. X.prototype.y=... not needed
  }
}

const outDir = path.join(here, "..", "..", "s11-items");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const index = [];
items.forEach((it, idx) => {
  const f = found.get(it.name);
  if (!f) { index.push({ name: it.name, kind: it.kind, bytes: it.bytes, error: "not found" }); return; }
  const text = src.slice(f.node.start, f.node.end);
  const kind = f.kind === "var" ? (f.node.init ? f.node.init.type : "novar") : f.kind;
  fs.writeFileSync(path.join(outDir, `${String(idx).padStart(3, "0")}-${it.name}.js`), text);
  index.push({ name: it.name, kind: it.kind, nodeKind: kind, bytes: it.bytes, textBytes: text.length, file: `${String(idx).padStart(3, "0")}-${it.name}.js` });
});
fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index, null, 1));
console.log("wrote", index.length, "items;", index.filter(i => i.error).length, "missing");
for (const i of index) console.log(i.name, i.kind, "->", i.nodeKind, i.textBytes, i.error || "");
