// every name the manifest wires into the bundle must be exported by some src-app module
import fs from "node:fs";
import path from "node:path";
import { parse } from "acorn";
const m = JSON.parse(fs.readFileSync("src-app/manifest.json", "utf8"));
const exported = new Set();
for (const f of fs.readdirSync("src-app").filter((f) => f.endsWith(".js"))) {
  const ast = parse(fs.readFileSync(path.join("src-app", f), "utf8"), { ecmaVersion: 2022, sourceType: "module", allowHashBang: true });
  for (const n of ast.body) {
    if (n.type === "ExportNamedDeclaration") {
      if (n.declaration) { if (n.declaration.id) exported.add(n.declaration.id.name); for (const d of n.declaration.declarations || []) if (d.id.name) exported.add(d.id.name); }
      for (const s of n.specifiers || []) exported.add(s.exported.name);
    }
  }
}
const missing = [];
const need = (kind, orig, name) => { if (name && !exported.has(name)) missing.push(`${kind} ${orig}: ${name}`); };
for (const e of m.entries || []) need("entry", e.orig, e.use);
for (const e of m.classes || []) need("class", e.orig, e.use);
for (const e of m.methods || []) need("method", `${e.class}.${e.name}`, e.use);
for (const e of m.declarators || []) for (const x of String(e.expr || "").matchAll(/__basaltOwn\.(\w+)/g)) need("declarator", e.orig, x[1]);
console.log(missing.length ? missing.join("\n") : "manifest ok");
process.exit(missing.length ? 1 : 0);
