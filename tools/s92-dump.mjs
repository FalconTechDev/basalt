// Dump the s92 slice items from the base bundle (ca5acac) into F:/orch/basalt-s92/dump/.
//   node tools/s92-dump.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBase } from "./app-base.mjs";
import { loadBundle } from "./split-app.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const items = JSON.parse(fs.readFileSync("F:/orch/basalt-s92/ITEMS.json", "utf8"));
const base = loadBase("ca5acac");
const tmp = path.join(process.env.TEMP || ".", "basalt-s92-base.js");
fs.writeFileSync(tmp, base.src);
const b = loadBundle(tmp);
const outDir = "F:/orch/basalt-s92/dump";
fs.mkdirSync(outDir, { recursive: true });
for (const it of items) {
  let node = null;
  if (it.kind === "function") {
    node = b.body.find((n) => n.type === "FunctionDeclaration" && n.id.name === it.name);
  } else {
    for (const n of b.body) if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.id.type === "Identifier" && d.id.name === it.name && d.init) node = d.init;
  }
  if (!node) { console.log(`${it.name}: NOT FOUND`); continue; }
  const text = base.src.slice(node.start, node.end);
  fs.writeFileSync(path.join(outDir, `${it.name}.txt`), text);
  console.log(`${it.name} ${it.kind} ${text.length}B @${node.start} :: ${text.slice(0, 300).replace(/\n/g, " ")}`);
}
