import { execFileSync } from "node:child_process";
const src = execFileSync("git", ["show", "ca5acac:src/app.js"], { maxBuffer: 64 << 20, encoding: "utf8" });
for (const n of ["P5","R5","G5","X5","a8","N8","s8","F8","r8","R8","O8","b8","C8","M8","I5","F5","S5","A5","x5","T5","K5","N5","E5","L5","x3","sJ","O5","BX","Y0","tb","SI","jm","y5","D3","T3","Q5","i8","e8","t8","l5","n8","M5","U3","k8","T8","D8","E8","P8"]) {
  const re = new RegExp("\\}\\(" + n + "\\)", "g");
  let m, c = 0; const ctx = [];
  while ((m = re.exec(src)) && c < 8) { c++; ctx.push(src.slice(Math.max(0, m.index - 90), m.index + 12).replace(/\s+/g, " ")); }
  console.log("### " + n + " extends-count " + c);
  ctx.forEach((x) => console.log("   " + x));
}
