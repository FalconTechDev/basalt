// Lists what still carries the name of the original app, by kind, so the rewrite can be planned and tracked.
//   node tools/obsidian-audit.mjs [--files]
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, "")), "..");
const src = path.join(root, "src");
const KINDS = [
  ["server URL (sync, publish, releases, help)", /https?:\/\/[\w.-]*obsidian[\w.-]*/gi],
  ["protocol / url scheme", /obsidian:\/\//gi],
  ["settings folder / config file", /\.obsidian\b|obsidian\.(json|css|log)/gi],
  ["clipboard / storage keys", /obsidian[-/](files|table|properties|bases-cells|vault-path|sync)\b/gi],
  ["crypto labels (sync format)", /Obsidian(AesSiv\w*|KeyHash|AesGcm)/g],
  ["plugin API names", /\w*Obsidian\w*(?=\s*[=(:])|require\(["']obsidian["']\)/g],
  ["CSS class / selector", /\.obsidian-[\w-]+|obsidian-app|obsidian-search-match-highlight/g],
];
const files = ["app.js", "main.js", "app.css", "index.html", "starter.html", "help.html", "starter.js", "help.js", "i18n.js", "package.json"].map((f) => path.join(src, f)).filter(fs.existsSync);
const total = {}; let all = 0; const perFile = {};
for (const f of files) {
  const t = fs.readFileSync(f, "utf8"); const n = (t.match(/obsidian/gi) || []).length; if (!n) continue;
  all += n; perFile[path.relative(root, f)] = n;
  let left = n;
  for (const [name, re] of KINDS) { const c = (t.match(re) || []).length; if (c) { total[name] = (total[name] || 0) + c; left -= c; } }
  if (left > 0) total["other"] = (total["other"] || 0) + left;
}
console.log(`mentions in shipped files: ${all}`);
for (const [k, v] of Object.entries(total).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(6), k);
if (process.argv.includes("--files")) console.log(perFile);
