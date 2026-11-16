import { loadBase } from "./app-base.mjs";
const base = loadBase("ca5acac");
const src = base.src;
for (const name of process.argv.slice(2)) {
  const esc = name.replace(/[$]/g, "\\$");
  const re = new RegExp("[,;{}(]" + esc + "=", "g");
  let m, idx = -1;
  while ((m = re.exec(src))) { idx = m.index; break; }
  if (idx < 0) {
    const re2 = new RegExp("function " + esc + "\\(");
    const m2 = re2.exec(src);
    idx = m2 ? m2.index : -1;
  }
  if (idx >= 0) console.log(name, "@", idx, JSON.stringify(src.slice(Math.max(0, idx - 10), idx + 240)));
  else console.log(name, "NOT FOUND");
}
