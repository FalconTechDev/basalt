// usage: node tools/fix-free-host.mjs src-app/file.js Prefix   -- binds free `host` uses to a module-level reference set by the exported factories
import fs from "node:fs";
import { parse } from "acorn";
const [f, pref] = process.argv.slice(2);
const ref = `${pref}HostRef`;
let src = fs.readFileSync(f, "utf8");
const ast = parse(src, { ecmaVersion: 2022, sourceType: "module", allowHashBang: true });
const declNames = (p, out) => { if (!p) return; if (p.type === "Identifier") out.add(p.name); else if (p.type === "ObjectPattern") p.properties.forEach((x) => declNames(x.value || x.argument, out)); else if (p.type === "ArrayPattern") p.elements.forEach((x) => declNames(x, out)); else if (p.type === "AssignmentPattern") declNames(p.left, out); else if (p.type === "RestElement") declNames(p.argument, out); };
const collect = (body, out) => { const v = (n) => { if (!n || typeof n.type !== "string") return; if (n.type === "VariableDeclaration") n.declarations.forEach((d) => declNames(d.id, out)); if ((n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") && n.id) { out.add(n.id.name); return; } if (n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") return; for (const k of Object.keys(n)) { const c = n[k]; if (Array.isArray(c)) c.forEach(v); else if (c && typeof c.type === "string") v(c); } }; body.forEach(v); };
const edits = []; const setPoints = [];
const walk = (n, scopes, parent, key) => {
  if (!n || typeof n.type !== "string") return;
  if (n.type === "Identifier" && n.name === "host") {
    const isProp = (parent?.type === "MemberExpression" && key === "property" && !parent.computed) || (parent?.type === "Property" && key === "key" && !parent.computed && !parent.shorthand);
    if (!isProp && !scopes.some((s) => s.has("host"))) edits.push([n.start, n.end, parent?.type === "Property" && parent.shorthand ? `host: ${ref}` : ref]);
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
for (const n of ast.body) { // exported factories that take `host`: remember it
  const d = n.type === "ExportNamedDeclaration" ? n.declaration : n;
  if (d && d.type === "FunctionDeclaration" && d.params.some((p) => p.type === "Identifier" && p.name === "host") && d.body.body.length) setPoints.push(d.body.start + 1);
}
if (!edits.length) { console.log("nothing to fix"); process.exit(0); }
const all = [...edits.map(([a, b, t]) => [a, b, t]), ...setPoints.map((p) => [p, p, `\n  ${ref} = host;`])];
// module-level declaration after the last import
const lastImport = ast.body.filter((n) => n.type === "ImportDeclaration").pop();
const declAt = lastImport ? lastImport.end : 0;
all.push([declAt, declAt, `\nlet ${ref} = null;`]);
all.sort((x, y) => y[0] - x[0] || y[1] - x[1]);
for (const [a, b, t] of all) src = src.slice(0, a) + t + src.slice(b);
fs.writeFileSync(f, src);
console.log(`${f}: ${edits.length} uses bound to ${ref}, ${setPoints.length} factories set it`);
