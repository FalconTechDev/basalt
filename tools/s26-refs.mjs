// Look up where names occur in src/app.js: first declaration-ish occurrence + all use contexts.
//   node tools/s26-refs.mjs name1 name2 ...
import fs from "node:fs";
import { loadBundle } from "./split-app.mjs";

const b = loadBundle("src/app.js");
const { src, body } = b;
const names = process.argv.slice(2);

// map name -> list of top-level statement indices covering it
const spans = body.map((n) => [n.start, n.end]);

for (const name of names) {
  const re = new RegExp("(?<![\\w$])" + name.replace(/[$]/g, "\\$") + "(?![\\w$])", "g");
  const hits = [];
  let m;
  while ((m = re.exec(src))) hits.push(m.index);
  // classify: inside own block?
  const bi = src.indexOf("/*basalt-own:begin*/"), ei = src.indexOf("/*basalt-own:end*/");
  const ownHits = hits.filter((i) => i > bi && i < ei).length;
  console.log(`== ${name}: ${hits.length} hits (${ownHits} inside own block)`);
  for (const i of hits.slice(0, 6)) {
    const stmt = spans.find(([a, z]) => i >= a && i < z);
    const kind = stmt ? body[spans.indexOf(stmt)].type : "?";
    console.log(`   @${i} [${kind}]`, JSON.stringify(src.slice(Math.max(0, i - 50), i + 70)));
  }
}
