// Finds custom properties DEFINED in src-css but never referenced via var()
// anywhere in src-css or src/app.js (inline styles / JS-set styles can use them,
// so also scan src/*.js and src-app/*.js). Read-only report.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const cssFiles = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".css")) cssFiles.push(p); } };
walk(path.join(root, "src-css"));

const defined = new Map(); // name -> [file:line]
const used = new Set();
const defRe = /(--[a-zA-Z0-9_-]+)\s*:/g;
const useRe = /var\(\s*(--[a-zA-Z0-9_-]+)/g;

for (const f of cssFiles) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    let m;
    defRe.lastIndex = 0;
    while ((m = defRe.exec(l))) {
      if (!defined.has(m[1])) defined.set(m[1], []);
      defined.get(m[1]).push(`${path.relative(root, f)}:${i + 1}`);
    }
    useRe.lastIndex = 0;
    while ((m = useRe.exec(l))) used.add(m[1]);
  });
}

// scan JS for var(--x) and inline style usage
const jsFiles = [];
const walkJs = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkJs(p); else if (/\.(js|html)$/.test(e.name)) jsFiles.push(p); } };
walkJs(path.join(root, "src"));
walkJs(path.join(root, "src-app"));
for (const f of jsFiles) {
  const t = fs.readFileSync(f, "utf8");
  let m; useRe.lastIndex = 0;
  while ((m = useRe.exec(t))) used.add(m[1]);
  // style.setProperty("--x", ...) and el.style.setProperty
  const spRe = /setProperty\(\s*["'`](--[a-zA-Z0-9_-]+)/g;
  while ((m = spRe.exec(t))) used.add(m[1]);
  // object literal keys "--x": used by style objects
  const keyRe = /["'`](--[a-zA-Z0-9_-]+)["'`]\s*:/g;
  while ((m = keyRe.exec(t))) used.add(m[1]);
}

const dead = [...defined.keys()].filter((n) => !used.has(n));
console.log(`defined: ${defined.size}, referenced: ${used.size}, defined-but-unused: ${dead.length}`);
for (const n of dead.sort()) {
  const locs = defined.get(n);
  console.log(`${n}  (${locs.length}x, e.g. ${locs[0]})`);
}
