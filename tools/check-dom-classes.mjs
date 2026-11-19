// DOM class names are a contract with the stylesheet and with the original app (themes/plugins rely on them).
// Lists class names emitted by the clean-room modules (n-*.js) that appear neither in the stylesheet nor in the original bundle.
//   node tools/check-dom-classes.mjs [--all]   (default: only n-* modules)
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { parse } from "acorn";
const tok = /^[a-z][a-z0-9_-]*$/i;
const known = new Set();
for (const m of fs.readFileSync("src/app.css", "utf8").matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) known.add(m[1]);
const orig = execSync("git show ca5acac:src/app.js", { maxBuffer: 1e9 }).toString();
for (const m of orig.matchAll(/["'`]([a-z][a-z0-9_-]*(?: [a-z][a-z0-9_-]*)*)["'`]/gi)) for (const t of m[1].split(" ")) known.add(t);
const API = new Set(["createDiv", "createSpan", "addClass", "removeClass", "toggleClass", "hasClass", "createSvg", "createEl"]);
const all = process.argv.includes("--all");
const files = fs.readdirSync("src-app").filter((f) => f.endsWith(".js") && (all || /^n-/.test(f)));
const report = new Map();
const add = (f, cls) => { for (const t of String(cls).split(/\s+/).filter(Boolean)) if (tok.test(t) && !known.has(t) && !t.startsWith("is-") && !t.startsWith("mod-")) { if (!report.has(f)) report.set(f, new Set()); report.get(f).add(t); } };
for (const f of files) {
  const ast = parse(fs.readFileSync(path.join("src-app", f), "utf8"), { ecmaVersion: 2022, sourceType: "module", allowHashBang: true });
  const walk = (n) => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "CallExpression" && n.callee.type === "MemberExpression" && API.has(n.callee.property.name || "")) {
      for (const a of n.arguments.slice(0, 2)) { if (a.type === "Literal" && typeof a.value === "string") add(f, a.value); if (a.type === "ObjectExpression") for (const p of a.properties) if (p.key && (p.key.name === "cls" || p.key.value === "cls") && p.value.type === "Literal") add(f, p.value.value); }
    }
    if (n.type === "CallExpression" && n.callee.type === "Identifier" && API.has(n.callee.name)) for (const a of n.arguments.slice(0, 2)) { if (a.type === "Literal" && typeof a.value === "string") add(f, a.value); if (a.type === "ObjectExpression") for (const p of a.properties) if (p.key && (p.key.name === "cls") && p.value.type === "Literal") add(f, p.value.value); }
    for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === "string") walk(v); }
  };
  walk(ast);
}
let total = 0;
for (const [f, set] of [...report].sort()) { total += set.size; console.log(`${f}: ${[...set].join(" ")}`); }
console.log(total ? `${total} unknown class names in ${report.size} modules` : "dom classes ok");
process.exit(total ? 1 : 0);
