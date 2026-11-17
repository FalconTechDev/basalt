// Turns eager `const X = host.key;` captures at the top of a class factory into lazy `host.key` uses.
// (Needed when the factory runs before the host value exists, e.g. a class declared later in the bundle.)
//   node tools/lazy-host.mjs src-app/file.js [prefix]    (prefix: only captures whose key starts with it, default "")
import fs from "node:fs";
import { parse } from "acorn";
const f = process.argv[2], prefix = process.argv[3] || "";
let s = fs.readFileSync(f, "utf8");
const re = /^  const (\w+) = host\.(\w+);\r?\n/gm;
const map = new Map(); let m;
while ((m = re.exec(s))) if (m[2].startsWith(prefix)) map.set(m[1], m[2]);
const ast = parse(s, { ecmaVersion: 2022, sourceType: "module" });
const edits = [];
const walk = (n, parent, key) => {
  if (!n || typeof n.type !== "string") return;
  if (n.type === "Identifier" && map.has(n.name)) {
    const skip = (parent?.type === "Property" && key === "key" && !parent.computed && !parent.shorthand)
      || (parent?.type === "MemberExpression" && key === "property" && !parent.computed)
      || (parent?.type === "MethodDefinition" && key === "key" && !parent.computed)
      || (parent?.type === "PropertyDefinition" && key === "key" && !parent.computed);
    if (!skip) {
      if (parent?.type === "Property" && parent.shorthand && key === "value") return; // handled at key
      if (parent?.type === "Property" && parent.shorthand && key === "key") edits.push([n.start, n.end, `${n.name}: host.${map.get(n.name)}`]);
      else edits.push([n.start, n.end, `host.${map.get(n.name)}`]);
    }
  }
  for (const k of Object.keys(n)) {
    const v = n[k];
    if (Array.isArray(v)) v.forEach((c) => walk(c, n, k)); else if (v && typeof v.type === "string") walk(v, n, k);
  }
};
walk(ast, null, "");
// the declarations themselves are removed, so drop edits inside them
const declRanges = [];
const re2 = /^  const (\w+) = host\.(\w+);\r?\n/gm; let d;
while ((d = re2.exec(s))) if (map.has(d[1])) declRanges.push([d.index, d.index + d[0].length]);
const inDecl = (p) => declRanges.some(([a, b]) => p >= a && p < b);
const all = [...edits.filter(([a]) => !inDecl(a)), ...declRanges.map(([a, b]) => [a, b, ""])].sort((x, y) => y[0] - x[0]);
for (const [a, b, t] of all) s = s.slice(0, a) + t + s.slice(b);
fs.writeFileSync(f, s);
console.log(`captures ${map.size}, edits ${edits.length}`);
