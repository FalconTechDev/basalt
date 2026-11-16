import { loadBundle } from "./split-app.mjs";
const b = loadBundle("F:/orch/basalt-s10/wt/src/app.js");
const { src, body } = b;
const want = new Set(process.argv.slice(2));
for (const n of body) {
  if (n.type === "VariableDeclaration") {
    const names = n.declarations.map((d) => src.slice(d.id.start, d.id.end));
    const hit = names.filter((x) => want.has(x));
    if (hit.length) {
      console.log("VAR stmt @", n.start, "size", n.end - n.start, "declarators", n.declarations.length);
      for (const h of hit) {
        const d = n.declarations[names.indexOf(h)];
        console.log("  ", h, "init?", !!d.init, d.init ? src.slice(d.init.start, Math.min(d.init.end, d.init.start + 80)) : "(none)");
      }
    }
  } else if ((n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") && want.has(n.id.name)) {
    console.log(n.type, n.id.name, "@", n.start);
  } else if (n.type === "ExpressionStatement") {
    // check for assignments to wanted names
    const t = src.slice(n.start, n.end);
    for (const w of want) {
      const re = new RegExp("(^|[^\\w$])" + w.replace(/\$/g, "\\$") + "\\s*=");
      if (re.test(t)) console.log("EXPR assign", w, "@", n.start, "stmt", n.end - n.start);
    }
  }
}
