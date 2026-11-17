// finds uses of the identifier `host` that are not bound by an enclosing function parameter/declaration (it only exists inside factories)
import fs from "node:fs";
import path from "node:path";
import { parse } from "acorn";
const bad = [];
const declNames = (pat, out) => {
  if (!pat) return;
  if (pat.type === "Identifier") out.add(pat.name);
  else if (pat.type === "ObjectPattern") pat.properties.forEach((p) => declNames(p.value || p.argument, out));
  else if (pat.type === "ArrayPattern") pat.elements.forEach((p) => declNames(p, out));
  else if (pat.type === "AssignmentPattern") declNames(pat.left, out);
  else if (pat.type === "RestElement") declNames(pat.argument, out);
};
const collect = (body, out) => { // hoisted + block declarations of this scope level (shallow walk through blocks)
  const visit = (n) => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "VariableDeclaration") n.declarations.forEach((d) => declNames(d.id, out));
    if (n.type === "FunctionDeclaration" && n.id) { out.add(n.id.name); return; }
    if (n.type === "ClassDeclaration" && n.id) { out.add(n.id.name); return; }
    if (n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") return;
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v.type === "string") visit(v); }
  };
  body.forEach(visit);
};
for (const f of fs.readdirSync("src-app").filter((f) => f.endsWith(".js"))) {
  const src = fs.readFileSync(path.join("src-app", f), "utf8");
  const ast = parse(src, { ecmaVersion: 2022, sourceType: "module", allowHashBang: true, locations: true });
  const walk = (n, scopes, parent, key) => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "Identifier" && n.name === "host") {
      const isProp = (parent?.type === "MemberExpression" && key === "property" && !parent.computed) || (parent?.type === "Property" && key === "key" && !parent.computed && !parent.shorthand);
      if (!isProp && !scopes.some((s) => s.has("host"))) bad.push(`${f}:${n.loc.start.line}`);
      return;
    }
    let sc = scopes;
    if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") {
      const s = new Set(); n.params.forEach((p) => declNames(p, s));
      if (n.body.type === "BlockStatement") collect(n.body.body, s);
      sc = [...scopes, s];
    } else if (n.type === "Program") { const s = new Set(); collect(n.body, s); sc = [...scopes, s]; }
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach((c) => walk(c, sc, n, k)); else if (v && typeof v.type === "string") walk(v, sc, n, k); }
  };
  walk(ast, [], null, "");
}
console.log(bad.length ? bad.join("\n") : "no free host");
process.exit(bad.length ? 1 : 0);
