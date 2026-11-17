// dump the s61 items from the base bundle to s61/ directory
import { loadBase } from "./app-base.mjs";
import * as acorn from "acorn";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle } from "./split-app.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const items = JSON.parse(fs.readFileSync("F:/orch/basalt-s61/ITEMS.json", "utf8"));
const base = loadBase("ca5acac");
const tmp = base.funcs && null;
// need the raw file path used by app-base: recreate analysis on a temp copy
const os = await import("node:os");
const file = path.join(os.tmpdir(), "basalt-app-base-ca5acac.js");
const b = loadBundle(file);
const body = b.body;
const src = b.src;

// map name -> node
const map = new Map();
for (const n of body) {
  if (n.type === "FunctionDeclaration") map.set(n.id.name, n);
  else if (n.type === "VariableDeclaration") for (const d of n.declarations) {
    const names = new Set();
    (function pat(p){ if(!p) return; if(p.type==="Identifier") names.add(p.name); else if(p.type==="ObjectPattern") p.properties.forEach(pr=>pat(pr.value||pr.key)); else if(p.type==="ArrayPattern") p.elements.forEach(pat); else if(p.type==="AssignmentPattern") pat(p.left); else if(p.type==="RestElement") pat(p.argument); })(d.id);
    for (const nm of names) map.set(nm, d);
  }
}
const outDir = path.join(root, "tools", "s61");
fs.mkdirSync(outDir, { recursive: true });
for (const it of items) {
  const n = map.get(it.name);
  if (!n) { console.log("MISSING", it.name); continue; }
  const text = src.slice(n.start, n.end);
  fs.writeFileSync(path.join(outDir, `${it.name}.js`), text);
  console.log(it.name, it.kind, it.bytes, "actual", text.length, n.type, n.init ? n.init.type : "");
}
// also write list of preceding/following context names for ordering
console.log("body len", body.length);
