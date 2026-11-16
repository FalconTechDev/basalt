import { loadBase } from "./app-base.mjs";
import { loadBundle } from "./split-app.mjs";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const base = loadBase("ca5acac");
const tmp = path.join(os.tmpdir(), "basalt-s33-base.js");
fs.writeFileSync(tmp, base.src);
const b = loadBundle(tmp);
for (const n of b.body) {
  if (n.type === "VariableDeclaration") for (const d of n.declarations) {
    if (d.id.type === "Identifier" && ["b5","k5","C5","P5","B5","V5","z5","o8","m8","g8","U5","W5","_5","d8","L8","x8","$5","Z5","w8","A8","I8","Y5","J5","f8"].includes(d.id.name))
      console.log("var", d.id.name, "init", d.init && d.init.type, "start", d.start, JSON.stringify(base.src.slice(d.start, Math.min(d.start+90,d.end))));
  }
  if (n.type === "FunctionDeclaration" && ["b5","V5","z5","o8","m8","g8"].includes(n.id.name))
    console.log("fn", n.id.name, n.start);
}
