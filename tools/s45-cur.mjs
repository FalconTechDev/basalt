import { loadBundle } from "./split-app.mjs";
import fs from "node:fs";
const b = loadBundle("src/app.js");
const names = ["x1","T1","D1","A1","I1","O1","F1","N1","R1","B1","V1","H1","z1","q1","j1","G1","c0","h0","v0","b0","E0","x0","T0","A0"];
const decl = new Map();
for (const n of b.body) {
  if (n.type === "FunctionDeclaration") decl.set(n.id.name, n);
  if (n.type === "VariableDeclaration") for (const d of n.declarations) {
    const collect=(p)=>{ if(!p)return; if(p.type==="Identifier") decl.set(p.name,d); else if(p.type==="ObjectPattern") p.properties.forEach(q=>collect(q.value||q.argument)); else if(p.type==="ArrayPattern") p.elements.forEach(collect); else if(p.type==="RestElement"||p.type==="AssignmentPattern") collect(p.argument||p.left); };
    collect(d.id);
  }
}
const src = fs.readFileSync("src/app.js","utf8");
for (const nm of names) {
  const d = decl.get(nm);
  if (!d) { console.log("=====", nm, "NOT-FOUND"); continue; }
  let s;
  if (d.init) s = src.slice(d.init.start, d.init.end);
  else s = src.slice(d.start, Math.min(d.end, d.start+400));
  console.log("=====", nm, "=====", s.slice(0,400).replace(/\n/g," "));
}
