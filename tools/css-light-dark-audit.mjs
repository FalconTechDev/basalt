// Audit of the csstools light-dark() fallback scaffolding in src-css/.
// Reports, per file and selector, which custom properties go through
// --csstools-light-dark-toggle--N and whether an @supports (color: light-dark())
// block re-declares them (the value Chromium actually uses).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "package.json"));
const postcss = require("postcss");
const src = path.resolve(here, "..", "src-css");

const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".css")) files.push(p); } };
walk(src);

const TOGGLE_DEF = /^--csstools-light-dark-toggle--\d+$/;
const TOGGLE_USE = /var\(--csstools-light-dark-toggle--(\d+)(?:,([^)]+))?\)/;

for (const file of files.sort()) {
  const root = postcss.parse(fs.readFileSync(file, "utf8"));
  const rel = path.relative(src, file).replace(/\\/g, "/");
  // supports blocks: map "media|selector" -> Map(prop -> value)
  const supports = new Map();
  const mediaDark = [];
  root.walkAtRules((at) => {
    if (at.name === "supports" && /light-dark/.test(at.params)) {
      at.walkRules((r) => {
        const key = r.selector.replace(/\s+/g, " ").trim();
        if (!supports.has(key)) supports.set(key, new Map());
        r.walkDecls((d) => supports.get(key).set(d.prop, d.value));
      });
    }
    if (at.name === "media" && /prefers-color-scheme:\s*dark/.test(at.params)) mediaDark.push(at);
  });
  const rows = [];
  root.walkRules((r) => {
    if (r.parent && r.parent.type === "atrule") {
      // inside @supports/@media: skip base collection here, handled above
      if (/light-dark/.test(r.parent.params || "")) return;
    }
    const sel = r.selector.replace(/\s+/g, " ").trim();
    const toggles = new Map(); // n -> light value
    const uses = []; // {prop, n, fallback}
    let resetsScheme = false;
    r.walkDecls((d) => {
      if (TOGGLE_DEF.test(d.prop)) {
        const m = d.value.match(/^var\(--csstools-color-scheme--dark\)\s*(.*)$/s);
        toggles.set(d.prop, m ? m[1].trim() : d.value);
      } else if (d.prop === "--csstools-color-scheme--dark") resetsScheme = true;
      else {
        const m = d.value.match(TOGGLE_USE);
        if (m) uses.push({ prop: d.prop, n: m[1], fb: (m[2] || "").trim() });
      }
    });
    if (!toggles.size && !uses.length) return;
    const sup = supports.get(sel);
    for (const u of uses) {
      const tname = `--csstools-light-dark-toggle--${u.n}`;
      const light = toggles.get(tname);
      const hasSup = sup && sup.has(u.prop);
      rows.push({ sel, prop: u.prop, light, fb: u.fb, sup: hasSup ? sup.get(u.prop) : null, resets: resetsScheme });
    }
  });
  if (!rows.length) continue;
  console.log(`\n### ${rel}`);
  let cur = "";
  for (const r of rows) {
    if (r.sel !== cur) { cur = r.sel; console.log(`  ${cur}`); }
    const tag = r.resets ? " [scope=light]" : "";
    console.log(`    ${r.prop}: light=${JSON.stringify(r.light)} fb=${JSON.stringify(r.fb)}${r.sup != null ? ` supports=${JSON.stringify(r.sup)}` : " NO-SUPPORTS"}${tag}`);
  }
}
