// For each s27 name, list which top-level bundle items reference it.
//   node tools/s27-refs.mjs name...
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadBase } from "./app-base.mjs";
import { loadBundle } from "./split-app.mjs";

loadBase("ca5acac");
const file = path.join(os.tmpdir(), "basalt-app-base-ca5acac.js");
const src = fs.readFileSync(file, "utf8");
const b = loadBundle(file);
const ranges = [];
for (const n of b.body) {
  if (n.type === "FunctionDeclaration") ranges.push([n.start, n.end, n.id.name]);
  else if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.id.type === "Identifier" && d.init) ranges.push([d.init.start, d.init.end, d.id.name]);
}
ranges.sort((a, c) => a[0] - c[0]);
const owner = (pos) => { for (const r of ranges) if (pos >= r[0] && pos < r[1]) return r[2]; return "?"; };
for (const name of process.argv.slice(2)) {
  const re = new RegExp(`\\b${name.replace(/[$]/g, "\\$")}\\b`, "g");
  const owners = {};
  let m;
  while ((m = re.exec(src))) { const o = owner(m.index); owners[o] = (owners[o] || 0) + 1; }
  console.log(name, JSON.stringify(owners));
}
