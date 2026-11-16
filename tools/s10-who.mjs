import { loadBundle } from "./split-app.mjs";
const b = loadBundle("F:/orch/basalt-s10/wt/src/app.js");
const { src, body } = b;
const want = new Set(process.argv.slice(2));
for (const n of body) {
  const text = n.type === "VariableDeclaration"
    ? n.declarations.map((d) => `${src.slice(d.id.start, d.id.end)}=${d.init ? src.slice(d.init.start, Math.min(d.init.end, d.init.start + 100)) : ""}`).join(" | ")
    : n.type === "FunctionDeclaration" || n.type === "ClassDeclaration" ? `${n.id.name} (decl)` : "";
  for (const w of want) {
    const re = new RegExp("(^|[^\\w$])" + w.replace(/\$/g, "\\$") + "\\s*=", "");
    if (text && re.test(text)) console.log(n.type, "@", n.start, ":", text.slice(0, 300));
  }
}
