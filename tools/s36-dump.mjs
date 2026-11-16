import { loadBase } from "./app-base.mjs";
import fs from "node:fs";
const b = loadBase("ca5acac");
const items = JSON.parse(fs.readFileSync("F:/orch/basalt-s36/ITEMS.json", "utf8"));
for (const it of items) {
  const re = new RegExp("\\b" + it.name + "\\b", "g");
  let m; const idx = [];
  while ((m = re.exec(b.src))) idx.push(m.index);
  console.log("=====", it.name, it.kind, it.bytes, "occ:", idx.length);
  for (const i of idx.slice(0, 8)) {
    console.log("  @" + i, JSON.stringify(b.src.slice(Math.max(0, i - 70), i + 120)));
  }
}
