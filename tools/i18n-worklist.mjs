// Builds i18n-fix/work.json: keys needing rewrite, in original tree order.
// Trivial rule: keep when (words<=3 && chars<=20) for sim>=0.5 keys; for the
// 0.35..0.5 band keep only clearly trivial labels (words<=2 && chars<=16).
import fs from "fs";
import path from "path";
import vm from "vm";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixDir = path.join(root, "i18n-fix");
fs.mkdirSync(fixDir, { recursive: true });

function loadGlobal(t, g) { const s = { window: {} }; vm.createContext(s); vm.runInContext(t, s); return s.window[g]; }
function flatten(o, p = "", out = {}) { for (const [k, v] of Object.entries(o)) { const key = p ? p + "." + k : k; if (v && typeof v === "object") flatten(v, key, out); else out[key] = String(v); } return out; }
const PLACEHOLDER = /\{\{[^}]*\}\}|%[sdif]|\[\[[^\]]*\]\]|\{[a-zA-Z_][\w.]*\}/g;
const normalize = s => s.toLowerCase().replace(PLACEHOLDER, " ").replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
const tokens = s => { const n = normalize(s); return n ? n.split(" ").filter(Boolean) : []; };
const dice = (a, b) => { const A = new Set(tokens(a)), B = new Set(tokens(b)); if (!A.size && !B.size) return 1; if (!A.size || !B.size) return 0; let i = 0; for (const t of A) if (B.has(t)) i++; return 2 * i / (A.size + B.size); };
const gram = (s, n) => { const t = normalize(s).replace(/\s+/g, ""); const g = new Set(); for (let i = 0; i + n <= t.length; i++) g.add(t.slice(i, i + n)); return g; };
const jac = (a, b) => { const A = gram(a, 4), B = gram(b, 4); if (!A.size && !B.size) return 1; if (!A.size || !B.size) return 0; let i = 0; for (const g of A) if (B.has(g)) i++; return i / (A.size + B.size - i); };
const sim = (a, b) => Math.max(dice(a, b), jac(a, b));

const cur = flatten(loadGlobal(fs.readFileSync(path.join(root, "src/i18n.js"), "utf8"), "BASALT_I18N"));
const orig = flatten(loadGlobal(execSync("git show bbad17f~1:src/i18n.js", { cwd: root, maxBuffer: 64 << 20 }).toString("utf8"), "OBSIDIAN_DEFAULT_I18N"));

const words = s => s.trim().split(/\s+/).filter(Boolean).length;
const work = [];
for (const [key, cv] of Object.entries(cur)) {
  const ov = orig[key];
  if (ov === undefined) continue;
  const s = sim(cv, ov);
  const w = words(cv), len = cv.length;
  const trivial5 = w <= 3 && len <= 20;
  const trivial35 = w <= 2 && len <= 16;
  if ((s >= 0.5 && !trivial5) || (s >= 0.35 && s < 0.5 && !trivial35)) {
    work.push({ key, sim: +s.toFixed(3), cur: cv, orig: ov });
  }
}
fs.writeFileSync(path.join(fixDir, "work.json"), JSON.stringify(work, null, 1));
console.log("work items:", work.length);
const hist = {};
for (const it of work) { const b = it.sim >= 0.5 ? ">=0.5" : "0.35-0.5"; hist[b] = (hist[b] || 0) + 1; }
console.log(hist);
