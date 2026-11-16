import { loadBundle } from "./split-app.mjs";
const b = loadBundle("F:/orch/basalt-s10/wt/src/app.js");
const { src, body } = b;
const want = new Set(process.argv.slice(2));
for (const n of body) {
  if (n.type !== "VariableDeclaration") continue;
  for (const d of n.declarations) {
    const nm = src.slice(d.id.start, d.id.end);
    if (want.has(nm) && d.init) console.log("=====", nm, "=====\n" + src.slice(d.init.start, d.init.end) + "\n");
  }
}
