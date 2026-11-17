// Find references to s40 item names in the base bundle (excluding their own declaration).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import * as acorn from "acorn";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const names = process.argv.slice(2);
const src = execFileSync("git", ["show", "ca5acac:src/app.js"], { cwd: root, maxBuffer: 64 << 20, encoding: "utf8" });
const ast = acorn.parse(src, { ecmaVersion: 2022 });
const b = ast.body[0].expression.callee;
const seq = b.body.body[2].expression.expressions;
const app = seq[seq.length - 1].callee;

// collect declaration spans
const declSpans = [];
for (const n of app.body.body) {
  if (n.type === "VariableDeclaration") for (const d of n.declarations) {
    const collect = (p) => {
      if (!p) return;
      if (p.type === "Identifier") declSpans.push([p.start, p.end]);
      else if (p.type === "ObjectPattern") for (const q of p.properties) collect(q.type === "RestElement" ? q.argument : q.value);
      else if (p.type === "ArrayPattern") for (const q of p.elements) collect(q);
      else if (p.type === "AssignmentPattern") collect(p.left);
      else if (p.type === "RestElement") collect(p.argument);
    };
    collect(d.id);
  } else if ((n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") && n.id) declSpans.push([n.id.start, n.id.end]);
  else if (n.type === "ExpressionStatement") {
    const exprs = n.expression.type === "SequenceExpression" ? n.expression.expressions : [n.expression];
    for (const e of exprs) if (e.type === "AssignmentExpression" && e.left.type === "Identifier") declSpans.push([e.left.start, e.left.end]);
  }
}
const isDecl = (pos) => declSpans.some(([s, e]) => pos >= s && pos < e);

const hits = new Map(names.map((n) => [n, []]));
(function walk(n) {
  if (!n || typeof n.type !== "string") return;
  if (n.type === "Identifier" && hits.has(n.name) && !isDecl(n.start)) {
    // skip property positions
    hits.get(n.name).push(n.start);
  }
  for (const k in n) { if (k === "type" || k === "start" || k === "end") continue; const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === "string") walk(v); }
})(app);

for (const name of names) {
  const pos = hits.get(name) || [];
  console.log(`=== ${name}: ${pos.length} refs`);
  for (const p of pos.slice(0, 12)) {
    console.log("   ..." + src.slice(Math.max(0, p - 90), Math.min(src.length, p + 90)).replace(/\n/g, " ") + "...");
  }
}
