// lists top-level names declared by more than one src-app module (they share one flat scope in the bundle)
import fs from "node:fs";
import path from "node:path";
import { parse } from "acorn";
const dir = "src-app";
const seen = new Map();
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".js") && !["core.js", "rust.js"].includes(f))) {
  const ast = parse(fs.readFileSync(path.join(dir, f), "utf8"), { ecmaVersion: 2022, sourceType: "module", allowHashBang: true });
  for (let n of ast.body) {
    if (n.type === "ExportNamedDeclaration" && n.declaration) n = n.declaration;
    const names = [];
    if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") names.push(n.id.name);
    if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.id.type === "Identifier") names.push(d.id.name);
    for (const nm of names) { if (!seen.has(nm)) seen.set(nm, []); seen.get(nm).push(f); }
  }
}
let bad = 0;
for (const [k, v] of seen) if (v.length > 1) { console.log(k, v.join(" , ")); bad++; }
process.exit(bad ? 1 : 0);
