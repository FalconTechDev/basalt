// scratch scan: which top-level vars/functions contain a given string (or match a regex)
import { loadBase } from "./app-base.mjs";
import { loadBundle } from "./split-app.mjs";
const b = loadBase("ca5acac");
const src = b.src;
const file = "C:/Users/sasha/AppData/Local/Temp/basalt-app-base-ca5acac.js";
const bundle = loadBundle(file);
const decls = [];
for (const n of bundle.body) {
  if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.id.type === "Identifier" && d.init) decls.push({ name: d.id.name, start: d.init.start, end: d.init.end });
  if (n.type === "FunctionDeclaration") decls.push({ name: n.id.name, start: n.start, end: n.end, fn: true });
}
const args = process.argv.slice(2);
const re = args[0].startsWith("/") ? new RegExp(args[0].slice(1, -1)) : null;
const pats = re ? [re] : args.map((a) => a);
for (const d of decls) {
  const t = src.slice(d.start, d.end);
  const hit = pats.some((p) => (p instanceof RegExp ? p.test(t) : t.includes(p)));
  if (hit) console.log(d.name, d.end - d.start, (d.fn ? "fn " : "") + t.slice(0, 60).replace(/\n/g, " "));
}
