// merges src-app/manifest.json during a git merge: three-way per entry id (stage 1 = merge base, 2 = ours, 3 = theirs).
// An entry that theirs removed or changed relative to the base follows theirs (a clean-room branch rewired it); an entry that only
// ours changed stays; entries new on either side are kept.
import { execSync } from "node:child_process";
import fs from "node:fs";

const stage = (n) => {
  try { return JSON.parse(execSync(`git show :${n}:src-app/manifest.json`, { maxBuffer: 1e9, stdio: ["ignore", "pipe", "ignore"] }).toString()); } catch (e) { return null; }
};
const base = stage(1) || {}, a = stage(2), b = stage(3);
const idOf = {
  entries: (e) => e.orig,
  classes: (e) => e.orig,
  declarators: (e) => e.orig,
  methods: (e) => `${e.class}.${e.name}`,
  patches: (e) => e.find,
};
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const out = { ...a };
const report = [];
for (const k of Object.keys({ ...a, ...b })) {
  if (idOf[k]) {
    const id = idOf[k];
    const mapOf = (arr) => new Map((arr || []).map((e) => [id(e), e]));
    const B = mapOf(base[k]), A = mapOf(a[k]), T = mapOf(b[k]);
    const res = new Map();
    for (const [i, e] of A) {
      if (!T.has(i)) {
        if (B.has(i)) { report.push(`${k} ${i}: removed by theirs`); continue; }
        res.set(i, e);
        continue;
      }
      const te = T.get(i), be = B.get(i);
      if (be && same(e, be)) res.set(i, te);
      else if (be && same(te, be)) res.set(i, e);
      else { if (!same(e, te)) report.push(`${k} ${i}: both changed, took theirs`); res.set(i, te); }
    }
    for (const [i, e] of T) if (!A.has(i) && !B.has(i)) res.set(i, e);
    out[k] = [...res.values()];
  } else if (k === "host") {
    out.host = { ...(a.host || {}), ...(b.host || {}) };
    for (const h in base.host || {}) if (!(h in (b.host || {})) && h in (a.host || {})) delete out.host[h];
  } else if (k === "envBind") {
    const parts = new Set(`${a.envBind || ""},${b.envBind || ""}`.split(",").filter(Boolean));
    out.envBind = [...parts].join(",");
  } else if (!same(a[k], b[k])) report.push(`${k}: differs`);
}
fs.writeFileSync("src-app/manifest.json", JSON.stringify(out, null, 2) + "\n");
console.log(Object.entries(out).map(([k, v]) => `${k}:${Array.isArray(v) ? v.length : typeof v === "object" ? Object.keys(v).length : v}`).join(" ").slice(0, 120));
if (report.length) console.log(report.slice(0, 25).join("\n"));
