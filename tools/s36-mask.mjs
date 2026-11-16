import fs from "node:fs";
const src = fs.readFileSync("tools/s36-kte.js", "utf8");
// mask string literals longer than 200 chars
const masked = src.replace(/"([^"\\]|\\.){200,}"/g, (m) => `"<STR${m.length}>"`);
fs.writeFileSync("tools/s36-kte-masked.js", masked);
console.log("orig", src.length, "masked", masked.length);
// list all string literals under 200 chars with offsets
const re2 = /"([^"\\]{1,200})"/g;
let m; const arr=[];
while ((m = re2.exec(masked))) arr.push([m.index, m[1]]);
for (const [i, s] of arr) console.log("STR @" + i, JSON.stringify(s));
