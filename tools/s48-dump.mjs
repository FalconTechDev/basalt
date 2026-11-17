import { loadBase } from "./app-base.mjs";
import fs from "fs";
const b = loadBase("ca5acac");
const ctor = b.src.slice(2666538, 2696159);
let out = "", inStr = null, paren = 0;
for (let i = 0; i < ctor.length; i++) {
  const c = ctor[i];
  if (inStr) {
    out += c;
    if (c === inStr && ctor[i - 1] !== "\\") inStr = null;
    continue;
  }
  if (c === '"' || c === "'" || c === "`") { inStr = c; out += c; continue; }
  if (c === "(") paren++;
  if (c === ")") paren--;
  out += c;
  if (c === ";" && paren === 0) out += "\n";
  if (c === "{" && paren === 0) out += "\n";
  if (c === "}" && paren === 0) out += "\n";
}
fs.writeFileSync("s48-ctor.js", out);
console.log("written", out.length);
