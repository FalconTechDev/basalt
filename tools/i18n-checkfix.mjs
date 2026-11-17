// Scores i18n-fix/fix-*.json values against the Obsidian original tree.
// Prints keys with sim >= --min (default 0.45). Usage: node tools/i18n-checkfix.mjs [min]
import fs from "fs";
import path from "path";
import vm from "vm";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixDir = path.join(root, "i18n-fix");
const min = +(process.argv[2] ?? 0.45);

function loadGlobal(t, g) { const s = { window: {} }; vm.createContext(s); vm.runInContext(t, s); return s.window[g]; }
function flatten(o, p = "", out = {}) { for (const [k, v] of Object.entries(o)) { const key = p ? p + "." + k : k; if (v && typeof v === "object") flatten(v, key, out); else out[key] = String(v); } return out; }
const PLACEHOLDER = /\{\{[^}]*\}\}|%[sdif]|\[\[[^\]]*\]\]|\{[a-zA-Z_][\w.]*\}/g;
const normalize = s => s.toLowerCase().replace(PLACEHOLDER, " ").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
const tokens = s => { const n = normalize(s); return n ? n.split(" ").filter(Boolean) : []; };
const dice = (a, b) => { const A = new Set(tokens(a)), B = new Set(tokens(b)); if (!A.size && !B.size) return 1; if (!A.size || !B.size) return 0; let i = 0; for (const t of A) if (B.has(t)) i++; return 2 * i / (A.size + B.size); };
const gram = (s, n) => { const t = normalize(s).replace(/\s+/g, ""); const g = new Set(); for (let i = 0; i + n <= t.length; i++) g.add(t.slice(i, i + n)); return g; };
const jac = (a, b) => { const A = gram(a, 4), B = gram(b, 4); if (!A.size && !B.size) return 1; if (!A.size || !B.size) return 0; let i = 0; for (const g of A) if (B.has(g)) i++; return i / (A.size + B.size - i); };
const sim = (a, b) => Math.max(dice(a, b), jac(a, b));
const ph = s => (s.match(PLACEHOLDER) || []).sort().join("|");

const orig = flatten(loadGlobal(execSync("git show f8a742c8dd6f8ecc4c10d90eab68fd3e1cca0e11:src/i18n.js", { cwd: root, maxBuffer: 64 << 20 }).toString("utf8"), "OBSIDIAN_DEFAULT_I18N"));

let bad = 0, n = 0, phBad = 0;
for (const f of fs.readdirSync(fixDir).filter(f => /^fix-.*\.json$/.test(f)).sort()) {
  const fixes = JSON.parse(fs.readFileSync(path.join(fixDir, f), "utf8"));
  for (const [k, v] of Object.entries(fixes)) {
    n++;
    const ov = orig[k];
    if (ov === undefined) { console.log("NO-ORIG", k); continue; }
    const s = sim(v, ov);
    if (ph(v) !== ph(ov)) { phBad++; console.log("PH", k, "|", ph(ov), "->", ph(v)); }
    if (s >= min) { bad++; console.log(s.toFixed(3), k, "|NEW:", v, "|ORIG:", ov); }
  }
}
console.log(`checked=${n} flagged=${bad} placeholder-mismatch=${phBad}`);
