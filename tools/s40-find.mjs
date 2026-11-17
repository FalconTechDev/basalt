// Show the declaration/init of arbitrary top-level names in the base bundle.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadBundle } from "./split-app.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = execFileSync("git", ["show", "ca5acac:src/app.js"], { cwd: root, maxBuffer: 64 << 20, encoding: "utf8" });
const file = path.join(process.env.TEMP || "/tmp", "basalt-s40-base.js");
fs.writeFileSync(file, src);
const b = loadBundle(file);
const names = new Set(process.argv.slice(2));
const max = Number(process.env.DUMP_LEN || 400);
for (const n of b.body) {
  if (n.type === "FunctionDeclaration" && names.has(n.id.name)) {
    console.log(`### ${n.id.name} function`);
    console.log(src.slice(n.start, Math.min(n.end, n.start + max)));
  } else if (n.type === "VariableDeclaration") {
    for (const d of n.declarations) {
      const ids = [];
      const c = (p) => { if (!p) return; if (p.type === "Identifier") ids.push(p.name); else if (p.type === "ObjectPattern") p.properties.forEach((q) => c(q.type === "RestElement" ? q.argument : q.value)); else if (p.type === "ArrayPattern") p.elements.forEach(c); else if (p.type === "AssignmentPattern") c(p.left); else if (p.type === "RestElement") c(p.argument); };
      c(d.id);
      if (ids.some((x) => names.has(x))) {
        console.log(`### ${ids.join(",")} [${d.init ? d.init.type : "none"}]`);
        console.log(src.slice(d.start, Math.min(d.end, d.start + max)));
      }
    }
  }
}
