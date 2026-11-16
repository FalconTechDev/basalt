// Dump the source text of the items listed in ITEMS.json from src/app.js.
import fs from "node:fs";
import { loadBundle } from "./split-app.mjs";

const b = loadBundle("src/app.js");
const { src, body } = b;
const items = JSON.parse(fs.readFileSync("F:/orch/basalt-s26/ITEMS.json", "utf8"));
const want = new Map(items.map((i, idx) => [i.name, idx]));
const outDir = "F:/orch/basalt-s26/s26-dump";
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const index = [];

for (const n of body) {
  if (n.type === "FunctionDeclaration" && n.id && want.has(n.id.name)) {
    const idx = want.get(n.id.name);
    const text = src.slice(n.start, n.end);
    fs.writeFileSync(`${outDir}/${String(idx).padStart(3, "0")}-${n.id.name}.js`, text);
    index[idx] = { name: n.id.name, kind: "function-decl", start: n.start, size: text.length };
    continue;
  }
  if (n.type === "ExpressionStatement") {
    const t = src.slice(n.start, n.end);
    for (const [name, idx] of want) {
      const re = new RegExp(`(^|[^\\w$])${name.replace(/\$/g, "\\$")}([^\\w$]|$)`);
      if (re.test(t)) {
        fs.writeFileSync(`${outDir}/${String(idx).padStart(3, "0")}-${name}.js`, t);
        index[idx] = { name, kind: "expr-stmt", start: n.start, size: t.length };
      }
    }
  }
  if (n.type !== "VariableDeclaration") continue;
  for (const d of n.declarations) {
    if (d.id.type !== "Identifier" || !d.init) continue;
    const idx = want.get(d.id.name);
    if (idx === undefined) continue;
    const text = src.slice(d.init.start, d.init.end);
    fs.writeFileSync(`${outDir}/${String(idx).padStart(3, "0")}-${d.id.name}.js`, text);
    index[idx] = { name: d.id.name, kind: d.init.type, start: d.init.start, size: text.length };
  }
}
const missing = [...want.keys()].filter((k) => index[want.get(k)] === undefined);
console.log(`dumped ${index.filter(Boolean).length}/${items.length}; missing: ${missing.join(", ") || "none"}`);
for (const it of items) {
  const rec = index[it.idx ?? items.indexOf(it)];
}
items.forEach((it, i) => {
  const r = index[i];
  console.log(`${String(i).padStart(2)} ${it.name} ${it.kind} ${it.bytes}B -> ${r ? `${r.kind} ${r.size}B` : "MISSING"}`);
});
