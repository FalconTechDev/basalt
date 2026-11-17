import fs from "node:fs";
import { loadBundle } from "./split-app.mjs";
const src = fs.readFileSync("src/app.js", "utf8");
const b = loadBundle("src/app.js");
const items = JSON.parse(fs.readFileSync("F:/orch/basalt-s92/ITEMS.json", "utf8"));
const base = fs.readFileSync(".s92-base.js", "utf8");
const bb = loadBundle(".s92-base.js");
const find = (body, name, kind) => {
  if (kind === "function") return body.find((n) => n.type === "FunctionDeclaration" && n.id.name === name);
  for (const n of body) if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.id.type === "Identifier" && d.id.name === name && d.init) return d.init;
};
for (const it of items) {
  const cur = find(b.body, it.name, it.kind);
  const old = find(bb.body, it.name, it.kind);
  const ct = cur ? src.slice(cur.start, cur.end) : "MISSING";
  const ot = old ? base.slice(old.start, old.end) : "MISSING";
  console.log(`${it.name}: ${ct === ot ? "SAME" : "DIFF"} cur=${ct.length}B base=${ot.length}B`);
  if (ct !== ot) fs.writeFileSync(`F:/orch/basalt-s92/dump/${it.name}.cur.txt`, ct);
}
