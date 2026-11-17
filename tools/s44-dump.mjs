import { loadBase } from "./app-base.mjs";
import { loadBundle } from "./split-app.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const base = loadBase("ca5acac");
const file = path.join(os.tmpdir(), "basalt-app-base-ca5acac.js");
const bb = loadBundle(file);
const items = JSON.parse(fs.readFileSync("F:/orch/basalt-s44/ITEMS.json", "utf8"));
const decls = new Map();
for (const n of bb.body) {
  if (n.type === "VariableDeclaration") for (const d of n.declarations)
    if (d.id.type === "Identifier" && d.init) decls.set(d.id.name, d);
  if ((n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") && n.id) decls.set(n.id.name, n);
}
const outdir = "F:/orch/basalt-s44/dump";
fs.mkdirSync(outdir, { recursive: true });
items.forEach((it, i) => {
  const d = decls.get(it.name);
  if (!d) { console.log("MISSING", it.name); return; }
  const t = base.src.slice(d.start, d.end);
  const fn = String(i).padStart(2, "0") + "-" + it.name.replace(/[$]/g, "D") + ".js";
  fs.writeFileSync(path.join(outdir, fn), t);
  console.log(i, it.name, it.kind, it.bytes, "->", fn);
});
