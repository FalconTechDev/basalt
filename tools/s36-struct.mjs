// Crude structural scan of kte: list function boundaries and string literals with offsets.
import fs from "node:fs";
const src = fs.readFileSync("tools/s36-kte.js", "utf8");
// find function keyword positions and names
const re = /function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(/g;
let m;
while ((m = re.exec(src))) {
  console.log("FUNC @" + m.index, m[1] || "(anon)", "|", JSON.stringify(src.slice(m.index, m.index + 90)));
}
console.log("--- strings ---");
const re2 = /"([^"\\]{3,80})"/g;
const seen = new Set();
while ((m = re2.exec(src))) {
  if (!seen.has(m[1])) { seen.add(m[1]); console.log("STR @" + m.index, JSON.stringify(m[1])); }
}
