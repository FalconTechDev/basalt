// How much of the inherited bundle has been replaced by own code.
//   node tools/own-stats.mjs            prints the numbers used in docs/REWRITE-PROGRESS.md
// "replaced" = bytes of the ORIGINAL text (base revision named in src-app/manifest.json) of every function / class that now only
// forwards to src-app/. Own code size = the readable source in src-app/*.js (what the owner reviews), not the spliced copy.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle } from "./split-app.mjs";
import { loadBase } from "./app-base.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "src-app", "manifest.json"), "utf8"));
const base = loadBase(manifest.base);
const bb = loadBundle(path.join(os.tmpdir(), `basalt-app-base-${manifest.base}.js`));
const initText = new Map();
for (const n of bb.body) if (n.type === "VariableDeclaration") for (const d of n.declarations) if (d.id.type === "Identifier" && d.init) initText.set(d.id.name, d.init.end - d.init.start);

let fn = 0, fnBytes = 0, cls = 0, clsBytes = 0;
for (const e of manifest.entries) { const t = base.fn(e.orig); if (t) { fn++; fnBytes += t.length; } }
for (const e of manifest.classes || []) { cls++; clsBytes += initText.get(e.orig) || 0; }
const total = base.src.length;
const replaced = fnBytes + clsBytes;
let own = 0;
for (const f of fs.readdirSync(path.join(root, "src-app"))) if (f.endsWith(".js") && f !== "core.js" && f !== "rust.js") own += fs.statSync(path.join(root, "src-app", f)).size;
const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log(`base bundle            ${kb(total)}`);
console.log(`functions replaced     ${fn} (${kb(fnBytes)})`);
console.log(`classes replaced       ${cls} (${kb(clsBytes)})`);
console.log(`replaced total         ${kb(replaced)} = ${(100 * replaced / total).toFixed(2)} % of the bundle`);
console.log(`own source in src-app  ${kb(own)}`);
