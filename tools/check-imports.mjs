// the bundle has ONE flat scope: every imported name must be exported by some module
import fs from "node:fs";
import path from "node:path";
import { parse } from "acorn";
const files = fs.readdirSync("src-app").filter((f) => f.endsWith(".js"));
const exportsOf = new Map();
for (const f of files) {
  const ast = parse(fs.readFileSync(path.join("src-app", f), "utf8"), { ecmaVersion: 2022, sourceType: "module", allowHashBang: true });
  const set = new Set();
  for (const n0 of ast.body) { const n = n0.type === "ExportNamedDeclaration" ? n0 : null; const d = n0.type === "ExportNamedDeclaration" ? n0.declaration : n0; if (d && (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") && d.id) set.add(d.id.name); if (d && d.type === "VariableDeclaration") for (const x of d.declarations) if (x.id.type === "Identifier") set.add(x.id.name); }
  for (const n of ast.body) if (n.type === "ExportNamedDeclaration") {
    if (n.declaration) { if (n.declaration.id) set.add(n.declaration.id.name); for (const d of n.declaration.declarations || []) set.add(d.id.name); }
    for (const s of n.specifiers || []) set.add(s.exported.name);
  }
  exportsOf.set(f, set);
}
const allNames = new Set();for (const set of exportsOf.values()) for (const x of set) allNames.add(x);
const bad = [];
for (const f of files) {
  const ast = parse(fs.readFileSync(path.join("src-app", f), "utf8"), { ecmaVersion: 2022, sourceType: "module", allowHashBang: true });
  for (const n of ast.body) if (n.type === "ImportDeclaration" && n.source.value.startsWith("./")) {
    const target = n.source.value.slice(2);
        for (const s of n.specifiers) if (s.imported && !allNames.has(s.imported.name)) bad.push(`${f}: imports ${s.imported.name} from ${target}, but no module exports that name (flat scope: undefined at runtime)`);
  }
}
console.log(bad.length ? bad.join("\n") : "imports ok");
process.exit(bad.length ? 1 : 0);
