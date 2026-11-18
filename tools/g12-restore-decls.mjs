import { loadBase } from "./app-base.mjs";
import * as acorn from "../tools/node_modules/acorn/dist/acorn.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const want = new Set(JSON.parse(fs.readFileSync(path.join(root, "tools", "g12-decl-names.json"), "utf8")));
const base = loadBase("ca5acac");
const baseAst = acorn.parse(base.src, { ecmaVersion: "latest" });
const inits = {};
(function walk(n) {
  if (!n || typeof n !== "object") return;
  if (n.type === "VariableDeclarator" && n.id && n.id.type === "Identifier" && want.has(n.id.name) && n.init) {
    inits[n.id.name] = base.src.slice(n.init.start, n.init.end);
  }
  for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object" && v.type) walk(v); }
})(baseAst);

const appPath = path.join(root, "src", "app.js");
const app = fs.readFileSync(appPath, "utf8");
const ast = acorn.parse(app, { ecmaVersion: "latest" });
const edits = [];
(function walk(n) {
  if (!n || typeof n !== "object") return;
  if (n.type === "VariableDeclarator" && n.id && n.id.type === "Identifier" && want.has(n.id.name) && n.init) {
    const text = app.slice(n.init.start, n.init.end);
    if (text.includes("__basaltOwn.")) {
      if (!(n.id.name in inits)) { console.log("no base init for", n.id.name); return; }
      edits.push([n.init.start, n.init.end, inits[n.id.name]]);
    }
  }
  for (const k in n) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object" && v.type) walk(v); }
})(ast);
edits.sort((a, b) => b[0] - a[0]);
let out = app;
for (const [a, b, t] of edits) out = out.slice(0, a) + t + out.slice(b);
fs.writeFileSync(appPath, out);
console.log("restored", edits.length, "of", want.size);
