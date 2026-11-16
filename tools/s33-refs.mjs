import { execFileSync } from "node:child_process";
const src = execFileSync("git", ["show", "ca5acac:src/app.js"], { maxBuffer: 64 << 20, encoding: "utf8" });
const names = ["b8","O8","r8","R8","P5","R5","G5","X5","a8","N8","s8","F8","C8","M8","m8","g8","o8","V5","z5","b5","U5","W5","_5","d8","L8","x8","k5","C5","B5","Y5","J5","f8","w8","A8","I8","$5","Z5"];
for (const name of names) {
  const re = new RegExp("\\b" + name.replace(/[$]/g, "\\$") + "\\b", "g");
  let m, c = 0; const uses = [];
  while ((m = re.exec(src)) && c < 80) { c++; if (uses.length < 12) uses.push(src.slice(Math.max(0, m.index - 55), m.index + 60).replace(/\s+/g, " ")); }
  console.log("=== " + name + " (" + c + ")");
  uses.forEach((u) => console.log("   " + u));
}
