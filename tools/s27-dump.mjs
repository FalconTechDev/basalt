// Dump the s27 slice items from the base bundle with context.
//   node tools/s27-dump.mjs [name ...] [--refs name]
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadBase } from "./app-base.mjs";
import { loadBundle, acorn } from "./split-app.mjs";

const base = loadBase("ca5acac");
const file = path.join(os.tmpdir(), `basalt-app-base-ca5acac.js`);
const src = fs.readFileSync(file, "utf8");
const b = loadBundle(file);
const items = new Map();
for (const n of b.body) {
  if (n.type === "FunctionDeclaration") items.set(n.id.name, { kind: "function", node: n });
  else if (n.type === "ClassDeclaration") items.set(n.id.name, { kind: "class", node: n });
  else if (n.type === "VariableDeclaration") for (const d of n.declarations) {
    if (d.id.type !== "Identifier") continue;
    items.set(d.id.name, { kind: d.init ? d.init.type : "noinit", node: d.init || d.id, size: d.init ? d.init.end - d.init.start : 0 });
  } else if (n.type === "ExpressionStatement") items.set(`expr@${n.start}`, { kind: "expr", node: n });
}

const args = process.argv.slice(2);
const refsIdx = args.indexOf("--refs");
for (const name of (refsIdx >= 0 ? args.slice(0, refsIdx) : args)) {
  const it = items.get(name);
  if (!it) { console.log(`### ${name}: NOT FOUND`); continue; }
  const n = it.node;
  const t = src.slice(n.start, n.end);
  console.log(`\n### ${name} kind=${it.kind} bytes=${t.length} start=${n.start}`);
  console.log(t.length > 4000 ? t.slice(0, 4000) + `\n... [truncated, ${t.length - 4000} more bytes]` : t);
}
if (refsIdx >= 0) {
  // count references of each name in the whole bundle
  for (const name of args.slice(refsIdx + 1)) {
    const re = new RegExp(`\\b${name.replace(/[$]/g, "\\$")}\\b`, "g");
    const m = src.match(re);
    console.log(`refs ${name}: ${m ? m.length : 0}`);
  }
}
