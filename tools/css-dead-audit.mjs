// Lists CSS selectors whose classes never appear in the app's JS/HTML sources.
// Heuristic only: a class may still be added by plugins at runtime, so results
// are candidates for review, not proof of deadness.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const cssDir = path.join(repo, "src-css");

// gather "haystack" of every class-ish token used in JS/HTML sources
const hay = [];
const collect = (d, exts) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "lib") collect(p, exts); continue; }
    if (exts.some((x) => e.name.endsWith(x))) hay.push(fs.readFileSync(p, "utf8"));
  }
};
collect(path.join(repo, "src"), [".js", ".html"]);
collect(path.join(repo, "src-app"), [".js"]);
const text = hay.join("\n");

const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".css")) files.push(p); } };
walk(cssDir);

const selRe = /(^|})\s*([^{}@]+)\{/g;
const report = new Map();
for (const f of files.sort()) {
  const css = fs.readFileSync(f, "utf8");
  // strip comments
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let m;
  const rel = path.relative(cssDir, f).replace(/\\/g, "/");
  while ((m = selRe.exec(clean))) {
    for (let sel of m[2].split(",")) {
      sel = sel.trim();
      if (!sel || sel.startsWith("@") || sel.includes("%")) continue;
      const classes = [...sel.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/g)].map((x) => x[1]);
      if (!classes.length) continue;
      const missing = classes.filter((c) => !text.includes(c));
      if (missing.length === classes.length) {
        const key = rel;
        if (!report.has(key)) report.set(key, []);
        report.get(key).push(sel.slice(0, 120));
      }
    }
  }
}
for (const [f, sels] of report) {
  console.log(`\n### ${f} (${sels.length})`);
  for (const s of sels.slice(0, 40)) console.log("  " + s);
  if (sels.length > 40) console.log(`  ... +${sels.length - 40} more`);
}
