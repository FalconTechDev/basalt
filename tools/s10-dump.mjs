// Dump the source text of the items listed in ITEMS.json from src/app.js.
import fs from "node:fs";
import { loadBundle } from "./split-app.mjs";

const b = loadBundle("F:/orch/basalt-s10/wt/src/app.js");
const { src, body } = b;
const items = JSON.parse(fs.readFileSync("F:/orch/basalt-s10/ITEMS.json", "utf8"));
const want = new Map(items.map((i, idx) => [i.name, idx]));
const outDir = "F:/orch/basalt-s10/s10-dump2";
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const index = [];

const emit = (name, text, extra) => {
  const idx = want.get(name);
  if (idx === undefined) return false;
  fs.writeFileSync(`${outDir}/${String(idx).padStart(3, "0")}.js`, text);
  index[idx] = { name, ...extra };
  return true;
};

for (const n of body) {
  if (n.type === "VariableDeclaration") {
    for (const d of n.declarations) {
      const text = src.slice(d.start, d.end);
      const m = text.match(/^\s*([A-Za-z_$][\w$]*)\s*=/);
      if (m) emit(m[1], text, { node: "declarator", bytes: d.end - d.start });
    }
  } else if ((n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") && n.id) {
    emit(n.id.name, src.slice(n.start, n.end), { node: n.type, bytes: n.end - n.start });
  } else if (n.type === "ExpressionStatement") {
    // prototype assignments / sequence expressions: find declarator-like names inside
    const t = src.slice(n.start, n.end);
    for (const [name] of want) {
      const re = new RegExp(`(^|[^\\w$])${name.replace(/\$/g, "\\$")}([^\\w$]|$)`);
      if (re.test(t)) {
        // locate the assignment sub-expression containing it
        let sub = null;
        const walk = (node) => {
          if (!node || typeof node.type !== "string") return;
          if (node.type === "AssignmentExpression") {
            const lt = src.slice(node.left.start, node.left.end);
            if (lt === name || lt.endsWith("." + name) || lt.includes(name)) { sub = node; return; }
          }
          for (const k in node) {
            if (k === "type" || k === "start" || k === "end") continue;
            const v = node[k];
            if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === "string") walk(v);
          }
        };
        walk(n.expression);
        emit(name, src.slice(sub ? sub.start : n.start, sub ? sub.end : n.end), { node: "expr", bytes: (sub ? sub.end - sub.start : n.end - n.start) });
      }
    }
  }
}
fs.writeFileSync(`${outDir}/index.json`, JSON.stringify(index, null, 1));
console.log("dumped", index.filter(Boolean).length, "of", items.length);
console.log("missing:", items.map((i) => i.name).filter((n) => index[want.get(n)] === undefined).join(","));
