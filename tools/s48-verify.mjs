import { loadBase } from "./app-base.mjs";
import { loadBundle } from "./split-app.mjs";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

const manifest = JSON.parse(fs.readFileSync("../src-app/manifest.json", "utf8"));
const base = loadBase(manifest.base);
const srcText = fs.readFileSync("../src/app.js", "utf8");
const tmp = path.join(os.tmpdir(), "basalt-app-build.js");
fs.writeFileSync(tmp, srcText);
const b = loadBundle(tmp);

// replicate findMethod + classInitWithMethodWrappers from build-app.mjs
function findMethod(init, name) {
  const fn = init.type === "CallExpression" ? init.callee : init;
  const ret = fn.body.body.find((st) => st.type === "ReturnStatement" && st.argument && st.argument.type === "SequenceExpression");
  if (!ret) return null;
  for (const ex of ret.argument.expressions) {
    const l = ex.type === "AssignmentExpression" && ex.left;
    if (l && l.type === "MemberExpression" && !l.computed && l.property.name === name && l.object.type === "MemberExpression" && l.object.property.name === "prototype") return ex.right;
  }
  return null;
}
function classInitWithMethodWrappers(baseSrc, init, methods) {
  let text = baseSrc.slice(init.start, init.end);
  const reps = [];
  for (const m of methods) {
    const node = findMethod(init, m.name);
    if (node) reps.push({ start: node.start - init.start, end: node.end - init.start, text: `__basaltOwn.${m.use}` });
  }
  reps.sort((a, b) => b.start - a.start);
  for (const r of reps) text = text.slice(0, r.start) + r.text + text.slice(r.end);
  return text;
}

const vdecl = new Map();
for (const n of b.body) if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.id.type === "Identifier") vdecl.set(d.id.name, d);
const d = vdecl.get("H0");
const text = srcText.slice(d.init.start, d.init.end);
console.log("current init len", text.length);

// base decl nodes
const bf = path.join(os.tmpdir(), `basalt-app-base-decls-${manifest.base}.js`);
fs.writeFileSync(bf, base.src);
const bb = loadBundle(bf);
const baseDeclNodes = new Map();
for (const n of bb.body) if (n.type === "VariableDeclaration") for (const x of n.declarations) if (x.id.type === "Identifier" && x.init) baseDeclNodes.set(x.id.name, x.init);

const methods = manifest.methods.filter((m) => m.class === "H0");
let expected = base.src.slice(baseDeclNodes.get("H0").start, baseDeclNodes.get("H0").end);
expected = classInitWithMethodWrappers(base.src, baseDeclNodes.get("H0"), methods);
console.log("expected len", expected.length, "match:", text === expected);
if (text !== expected) {
  for (let i = 0; i < Math.min(text.length, expected.length); i++) {
    if (text[i] !== expected[i]) { console.log("first diff at", i, JSON.stringify(text.slice(i - 60, i + 60)), "VS", JSON.stringify(expected.slice(i - 60, i + 60))); break; }
  }
}
