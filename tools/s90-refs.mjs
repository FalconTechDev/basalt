import { loadBase } from "./app-base.mjs";
const b = loadBase("ca5acac");
const src = b.src;
for (const n of ["uf", "df", "cf", "Xd", "_d", "sf", "Jd", "hf", "pf", "ff", "mf", "af", "nf", "rf", "lf", "ef", "tf", "of", "Gd", "Kd", "Yd", "Qd", "Zd", "$d"]) {
  const re = new RegExp("\\b" + n.replace("$", "\\$") + "\\b", "g");
  let c = 0; const idx = [];
  let m;
  while ((m = re.exec(src))) { c++; if (idx.length < 10) idx.push(m.index); }
  console.log(n, c, idx.join(","));
}
