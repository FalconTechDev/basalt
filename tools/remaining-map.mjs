// What of the application scope of src/app.js is still inherited: top-level functions and var declarators that are not own code.
//   node tools/remaining-map.mjs [--json out.json]
import fs from "node:fs";
import { loadBundle } from "./split-app.mjs";
const file = "src/app.js";
const src = fs.readFileSync(file, "utf8");
const b = loadBundle(file);
const items = [];
for (const n of b.body) {
  const text = src.slice(n.start, n.end);
  const own = (t) => /__basaltOwn\./.test(t.slice(0, 200)) || /\/\*own\*\//.test(t.slice(0, 120));
  if (n.type === "FunctionDeclaration") { if (!own(text)) items.push({ name: n.id.name, kind: "function", start: n.start, size: text.length }); }
  else if (n.type === "VariableDeclaration") {
    for (const d of n.declarations) {
      if (!d.init || d.id.type !== "Identifier") continue;
      const t = src.slice(d.init.start, d.init.end);
      if (own(t)) continue;
      items.push({ name: d.id.name, kind: d.init.type === "CallExpression" ? "class-iife" : d.init.type, start: d.init.start, size: t.length });
    }
  }
}
const total = items.reduce((a, x) => a + x.size, 0);
console.log(`app scope statements: ${b.body.length}; still inherited: ${items.length} items, ${(total / 1024).toFixed(0)} KB`);
const big = items.filter((x) => x.size > 20000).sort((a, b) => b.size - a.size);
console.log(`items > 20 KB: ${big.length} (${(big.reduce((a, x) => a + x.size, 0) / 1024).toFixed(0)} KB)`);
for (const x of big.slice(0, 25)) console.log(`  ${x.name} ${x.kind} ${(x.size / 1024).toFixed(0)} KB @${x.start}`);
if (process.argv.includes("--json")) fs.writeFileSync(process.argv[process.argv.indexOf("--json") + 1], JSON.stringify(items));
