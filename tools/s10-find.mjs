import fs from "node:fs";
const src = fs.readFileSync("F:/orch/basalt-s10/wt/src/app.js", "utf8");
const names = process.argv.slice(2);
for (const n of names) {
  const esc = n.replace(/\$/g, "\\$");
  const re = new RegExp("(?:^|[ ,;{}(=])" + esc + "=", "g");
  let m, hits = [];
  while ((m = re.exec(src))) hits.push(m.index);
  console.log(n, hits.length, hits.slice(0, 4).join(","));
  for (const h of hits.slice(0, 2)) console.log("   ...", src.slice(Math.max(0, h - 80), h + 120).replace(/\n/g, " "));
}
