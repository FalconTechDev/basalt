import { loadBase } from "./app-base.mjs";
const b = loadBase("ca5acac");
const f = b.report.functions.find((x) => x.name === "kte");
import fs from "node:fs";
fs.writeFileSync("tools/s36-kte.js", b.src.slice(f.start, f.end));
console.log("wrote", f.end - f.start);
// also dump the small items' declarator context
const small = ["pee","vee","Eee","Mee","Lee","Hee","Uee","Zee","nte","ste","cte","pte"];
for (const n of small) {
  const re = new RegExp("\\b" + n + "\\s*=", "g");
  const m = re.exec(b.src);
  if (m) console.log("=====", n, "@", m.index, JSON.stringify(b.src.slice(m.index, m.index + 400)));
}
