import fs from "node:fs";
const s = fs.readFileSync(process.argv[2] || "C:/Users/sasha/AppData/Local/Temp/basalt-app-base-ca5acac.js", "utf8");
for (const name of process.argv.slice(3)) {
  const re = new RegExp("\\b" + name + "\\b", "g");
  let m; const hits = [];
  while ((m = re.exec(s)) && hits.length < 60) hits.push(m.index);
  console.log("=== " + name + " " + hits.length);
  for (const p of hits) console.log("  @" + p, JSON.stringify(s.slice(Math.max(0, p - 42), p + 42)));
}
