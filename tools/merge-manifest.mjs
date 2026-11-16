// merges src-app/manifest.json during a git merge: union of the entry lists of both sides (stage 2 = ours, 3 = theirs)
import { execSync } from "node:child_process";
import fs from "node:fs";
const stage = (n) => JSON.parse(execSync(`git show :${n}:src-app/manifest.json`, { maxBuffer: 1e9 }).toString());
const a = stage(2), b = stage(3);
const idOf = { entries: (e) => e.orig, classes: (e) => e.orig, declarators: (e) => e.orig, patches: (e) => e.find, methods: (e) => `${e.class}.${e.name}` };
const out = { ...a };
const report = [];
for (const k of Object.keys({ ...a, ...b })) {
  if (idOf[k]) {
    const seen = new Map();
    for (const e of a[k] || []) seen.set(idOf[k](e), e);
    for (const e of b[k] || []) {
      const id = idOf[k](e);
      if (seen.has(id)) { if (JSON.stringify(seen.get(id)) !== JSON.stringify(e)) report.push(`${k} ${id}: differs, kept ours`); }
      else seen.set(id, e);
    }
    out[k] = [...seen.values()];
  } else if (k === "host") {
    out.host = { ...(b.host || {}), ...(a.host || {}) };
    for (const h in b.host || {}) if (a.host && h in a.host && a.host[h] !== b.host[h]) report.push(`host ${h}: differs`);
  } else if (k === "envBind") {
    const parts = new Set(`${a.envBind || ""},${b.envBind || ""}`.split(",").filter(Boolean));
    out.envBind = [...parts].join(",");
  } else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) report.push(`${k}: differs ours=${JSON.stringify(a[k])} theirs=${JSON.stringify(b[k])}`);
}
fs.writeFileSync("src-app/manifest.json", JSON.stringify(out, null, 2) + "\n");
console.log(Object.entries(out).map(([k, v]) => `${k}:${Array.isArray(v) ? v.length : typeof v === "object" ? Object.keys(v).length : v}`).join(" "));
if (report.length) console.log(report.join("\n"));
