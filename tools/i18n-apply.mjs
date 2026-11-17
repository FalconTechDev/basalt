// Applies rewrite maps from i18n-fix/fix-*.json ({"dotted.key": "new value"})
// into src/i18n.js, preserving the IIFE wrapper and key order.
// Usage: node tools/i18n-apply.mjs [--dry]
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixDir = path.join(root, "i18n-fix");
const dry = process.argv.includes("--dry");

const file = path.join(root, "src", "i18n.js");
const text = fs.readFileSync(file, "utf8");
const m = text.match(/^\(\(\)=>\{"use strict";window\.BASALT_I18N=(.*)\}\)\(\);?\s*$/s);
if (!m) { console.error("unexpected i18n.js format"); process.exit(1); }
const trailing = text.endsWith("\n") ? "\n" : "";
const obj = JSON.parse(m[1]);

const fixes = {};
let nFiles = 0;
for (const f of fs.readdirSync(fixDir).filter(f => /^fix-.*\.json$/.test(f)).sort()) {
  Object.assign(fixes, JSON.parse(fs.readFileSync(path.join(fixDir, f), "utf8")));
  nFiles++;
}

function setPath(o, dotted, val) {
  const parts = dotted.split(".");
  let cur = o;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === undefined) { console.error("missing path", dotted); return false; }
    cur = cur[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (cur[last] === undefined) { console.error("missing leaf", dotted); return false; }
  cur[last] = val;
  return true;
}

let ok = 0, bad = 0;
for (const [k, v] of Object.entries(fixes)) {
  if (setPath(obj, k, v)) ok++; else bad++;
}
console.log(`files=${nFiles} fixes=${Object.keys(fixes).length} applied=${ok} bad=${bad}`);
if (bad) process.exit(1);
if (!dry) {
  fs.writeFileSync(file, '(()=>{"use strict";window.BASALT_I18N=' + JSON.stringify(obj) + '})();' + trailing);
  console.log("wrote src/i18n.js");
}
