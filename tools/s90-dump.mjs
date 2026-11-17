// dump the s90 items from the base bundle to tools/s90/
import { loadBase } from "./app-base.mjs";
import { loadBundle } from "./split-app.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const items = JSON.parse(fs.readFileSync("F:/orch/basalt-s90/ITEMS.json", "utf8"));
const base = loadBase("ca5acac");
const tmp = path.join(os.tmpdir(), "basalt-s90-base.js");
fs.writeFileSync(tmp, base.src);
const b = loadBundle(tmp);
const src = base.src;
const decl = new Map();
for (const n of b.body) {
  if (n.type === "FunctionDeclaration") decl.set(n.id.name, n);
  if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.id.type === "Identifier") decl.set(d.id.name, d);
}
const outdir = path.join(root, "tools", "s90");
fs.mkdirSync(outdir, { recursive: true });
for (const it of items) {
  const n = decl.get(it.name);
  let text = "MISSING";
  if (n) {
    if (n.type === "FunctionDeclaration") text = src.slice(n.start, n.end);
    else if (n.type === "VariableDeclaration") {
      for (const d of n.declarations) if (d.id.name === it.name && d.init) text = src.slice(d.init.start, d.init.end);
    } else text = src.slice(n.start, n.end);
  }
  fs.writeFileSync(path.join(outdir, `${it.name}-${it.kind}.js`), text);
  console.log(it.name, it.kind, it.bytes, text.length);
}
