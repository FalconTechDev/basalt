import { loadBase } from "./app-base.mjs";
import * as acorn from "../tools/node_modules/acorn/dist/acorn.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = loadBase("ca5acac");
const ast = acorn.parse(base.src, { ecmaVersion: "latest" });
const want = new Set(["q$", "j$", "X$", "$$", "T$", "D$", "A$", "O$", "F$", "P$", "L$", "N$", "R$", "H$", "z$", "U$", "W$", "G$", "K$", "Z$", "J$", "Dq", "Eq", "fj", "dj", "aj", "mj"]);
const inits = {};
(function walk(n) {
  if (!n || typeof n !== "object") return;
  if (n.type === "VariableDeclarator" && n.id && n.id.type === "Identifier" && want.has(n.id.name) && n.init) {
    inits[n.id.name] = base.src.slice(n.init.start, n.init.end);
  }
  for (const k in n) {
    const v = n[k];
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object" && v.type) walk(v);
  }
})(ast);
console.log("found inits:", Object.keys(inits).length);

const appPath = path.join(root, "src", "app.js");
let app = fs.readFileSync(appPath, "utf8");
let count = 0;
const miss = [];
for (const o of want) {
  const orig = inits[o];
  if (orig === undefined) { miss.push(o); continue; }
  const esc = o.replace(/[$]/g, "\\$");
  const re = new RegExp("(?<![A-Za-z0-9_$.])" + esc + "=(__basaltOwn\\.[A-Za-z0-9_$.]+(?:\\([^)]*\\))?)");
  const m = re.exec(app);
  if (!m) { miss.push(o + ":noexpr"); continue; }
  app = app.slice(0, m.index) + o + "=" + orig + app.slice(m.index + m[0].length);
  count++;
}
fs.writeFileSync(appPath, app);
console.log("restored", count, "miss", JSON.stringify(miss));
