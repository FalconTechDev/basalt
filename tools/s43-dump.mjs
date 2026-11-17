// Dump source text of each ITEMS.json item from the base bundle, kind-aware.
// kind -> expected init node type (or FunctionDeclaration for "function").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBase } from "./app-base.mjs";
import { loadBundle } from "./split-app.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const items = JSON.parse(fs.readFileSync(path.join(root, "..", "ITEMS.json"), "utf8"));

const KIND2TYPE = {
  "class-iife": "CallExpression",
  Literal: "Literal",
  FunctionExpression: "FunctionExpression",
  NewExpression: "NewExpression",
  ObjectExpression: "ObjectExpression",
  ArrayExpression: "ArrayExpression",
  SequenceExpression: "SequenceExpression",
  LogicalExpression: "LogicalExpression",
  MemberExpression: "MemberExpression",
  ConditionalExpression: "ConditionalExpression",
  function: "FunctionDeclaration",
};

const base = loadBase("ca5acac");
const src = base.src;
const tmp = path.join(process.env.TEMP || ".", "basalt-s43-base.js");
fs.writeFileSync(tmp, src);
const b = loadBundle(tmp);
const body = b.body;

const namesOf = (pat, out) => {
  if (!pat) return;
  if (pat.type === "Identifier") out.push(pat.name);
  else if (pat.type === "ObjectPattern") pat.properties.forEach((p) => namesOf(p.type === "RestElement" ? p.argument : p.value, out));
  else if (pat.type === "ArrayPattern") pat.elements.forEach((p) => namesOf(p, out));
  else if (pat.type === "RestElement") namesOf(pat.argument, out);
  else if (pat.type === "AssignmentPattern") namesOf(pat.left, out);
};

const outDir = path.join(root, "..", "s43-items");
fs.mkdirSync(outDir, { recursive: true });
const index = [];

for (const it of items) {
  const want = KIND2TYPE[it.kind];
  let node = null;
  for (const st of body) {
    if (want === "FunctionDeclaration") {
      if (st.type === "FunctionDeclaration" && st.id.name === it.name) node = st;
      continue;
    }
    if (st.type !== "VariableDeclaration") continue;
    for (const d of st.declarations) {
      const ns = []; namesOf(d.id, ns);
      if (ns.includes(it.name) && d.init && d.init.type === want) node = d;
    }
  }
  if (!node) { index.push({ ...it, found: false }); continue; }
  const initText = node.init ? src.slice(node.init.start, node.init.end) : null;
  const text = node.type === "VariableDeclarator" ? (initText ?? src.slice(node.start, node.end)) : src.slice(node.start, node.end);
  index.push({ ...it, found: true, nodeType: node.type, initType: node.init ? node.init.type : null, bytes2: node.end - node.start, text });
}
fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index, null, 1));
console.log("dumped", index.filter((i) => i.found).length, "of", items.length);
for (const i of index.filter((i) => !i.found)) console.log("NOT FOUND", i.kind, i.name);
