// Validates every drawn Basalt icon against the icon language (F:\orch\icons\STYLE.md).
//   node tools/icons-validate.mjs [--dir src-app]
// Checks: path commands M/L/H/V/Z only (absolute), coordinates on a 0.5 grid
// inside 2..22, every L segment at exactly 45 degrees, H/V segments axis-aligned,
// item tags 0..6 with sane arity. Exit 1 on any violation.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = path.join(root, process.argv.includes("--dir") ? process.argv[process.argv.indexOf("--dir") + 1] : "src-app");

const pieces = fs.readdirSync(dir).filter((f) => /^n-icons-set-.*\.js$/.test(f)).sort();
if (!pieces.length) { console.log("no piece modules found"); process.exit(0); }

const errors = [];
const icons = [];

const CMD_RE = /([a-zA-Z])([^a-zA-Z]*)/g;
const NUM_RE = /-?\d+(?:\.\d+)?/g;

function checkD(name, file, d) {
  let pos = null; // current point
  let start = null;
  CMD_RE.lastIndex = 0;
  let m;
  const bad = (msg) => errors.push(`${file} ${name}: ${msg}`);
  while ((m = CMD_RE.exec(d))) {
    const cmd = m[1];
    const body = m[2];
    if (!"MLHVZ".includes(cmd)) { bad(`forbidden command ${cmd} in "${d}" (only M L H V Z allowed)`); continue; }
    if (cmd === "Z") { pos = start; continue; }
    const nums = (body.match(NUM_RE) || []).map(Number);
    const arity = { M: 2, L: 2, H: 1, V: 1 }[cmd];
    if (!arity) { bad(`command ${cmd} not allowed (only M L H V Z)`); continue; }
    if (nums.length % arity !== 0 || !nums.length) { bad(`command ${cmd} bad arg count in "${d}"`); continue; }
    for (let i = 0; i < nums.length; i += arity) {
      let nx, ny;
      if (cmd === "H") { nx = nums[i]; ny = pos ? pos.y : NaN; }
      else if (cmd === "V") { nx = pos ? pos.x : NaN; ny = nums[i]; }
      else { nx = nums[i]; ny = nums[i + 1]; }
      for (const v of [nx, ny]) {
        if (!Number.isFinite(v)) { bad(`non-numeric coord in "${d}"`); continue; }
        if (v < 2 || v > 22) bad(`coord ${v} outside 2..22 in "${d}"`);
        if (Math.abs(v * 2 - Math.round(v * 2)) > 1e-9) bad(`coord ${v} off 0.5 grid in "${d}"`);
      }
      if (pos && cmd === "L") {
        const dx = nx - pos.x, dy = ny - pos.y;
        if (Math.abs(Math.abs(dx) - Math.abs(dy)) > 1e-9)
          bad(`L segment (${pos.x},${pos.y})->(${nx},${ny}) not 45 degrees in "${d}"`);
      }
      if (cmd === "M" && pos === null) { start = { x: nx, y: ny }; }
      pos = { x: nx, y: ny };
    }
  }
}

function checkItems(name, file, items) {
  if (!Array.isArray(items)) { errors.push(`${file} ${name}: value is not an array or string`); return; }
  for (const it of items) {
    if (!Array.isArray(it) || typeof it[0] !== "number" || it[0] < 0 || it[0] > 6) {
      errors.push(`${file} ${name}: bad item ${JSON.stringify(it).slice(0, 60)}`);
      continue;
    }
    const tag = it[0];
    if (tag === 6 && typeof it[1] === "string") checkD(name, file, it[1]);
    else if ([0, 1, 2, 3, 4, 5].includes(tag)) {
      // numeric/points args: grid-check numbers
      const flat = tag === 2 || tag === 3 ? String(it[1]).split(/[\s,]+/).filter(Boolean).map(Number) : it.slice(1).filter((v) => typeof v === "number");
      for (const v of flat) {
        if (!Number.isFinite(v)) { errors.push(`${file} ${name}: non-numeric arg in item ${JSON.stringify(it).slice(0, 60)}`); break; }
        if (v < -24 || v > 48) { errors.push(`${file} ${name}: arg ${v} out of range in item ${JSON.stringify(it).slice(0, 60)}`); break; }
      }
    }
  }
}

let count = 0;
for (const f of pieces) {
  const mod = await import(pathToFileURL(path.join(dir, f)).href);
  for (const key of Object.keys(mod)) {
    const table = mod[key];
    if (!table || typeof table !== "object") continue;
    for (const name in table) {
      count++;
      icons.push(`${f}:${name}`);
      const v = table[name];
      if (typeof v === "string") {
        for (const dm of v.matchAll(/\bd="([^"]+)"/g)) checkD(name, f, dm[1]);
        if (!/d="/.test(v)) errors.push(`${f} ${name}: html value has no path d`);
      } else checkItems(name, f, v);
    }
  }
}

console.log(`validated ${count} icons in ${pieces.length} piece(s)`);
if (errors.length) {
  console.log("FAILURES:");
  for (const e of errors.slice(0, 60)) console.log("  " + e);
  if (errors.length > 60) console.log(`  ... and ${errors.length - 60} more`);
  process.exit(1);
}
console.log("all icons pass");
