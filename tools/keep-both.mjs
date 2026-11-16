// resolves git conflict markers in a text file by keeping both sides (ours first)
import fs from "node:fs";
const f = process.argv[2];
let p = fs.readFileSync(f, "utf8");
p = p.replace(/<<<<<<< [^\n]*\r?\n([\s\S]*?)=======\r?\n([\s\S]*?)>>>>>>> [^\n]*\r?\n/g, (x, h, b) => h + "\n" + b);
fs.writeFileSync(f, p);
