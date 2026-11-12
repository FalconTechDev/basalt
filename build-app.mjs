// Builds the own-code part of src/app.js.
//   node build-app.mjs              bundle src-app/*.js and write them into src/app.js (plain JS)
//   node build-app.mjs --wasm       also compile app-core (Rust -> wasm) and inline it (needs cargo; --no-cargo reuses the built wasm)
//   node build-app.mjs --out F      write the result to F instead of src/app.js (input is still src/app.js)
//   node build-app.mjs --check      only verify that src/app.js is up to date with src-app/ (exit 1 if not)
//
// How it works. src/app.js is the inherited minified bundle. Own code lives in src-app/ (readable ES modules + the Rust crate
// app-core/). The build concatenates the modules into one object `__basaltOwn` placed between the markers /*basalt-own:begin*/ and
// /*basalt-own:end*/ right at the start of the application scope, and turns every function listed in src-app/manifest.json into a
// one-line wrapper:   function nu(e){return/*own*/__basaltOwn.lastSegment(e)}   (same name, same parameters, so no call site changes).
// The build is repeatable: wrappers are regenerated, the block between the markers is replaced. A function is only swapped if its
// text is still byte-identical to the one in the base revision named in the manifest (git history keeps the originals).
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle, acorn } from "./tools/split-app.mjs";
import { loadBase } from "./tools/app-base.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(root, "src-app");
// order matters only for readability: every module is a flat scope, names must be unique across them
export const JS_MODULES = ["path.js", "text.js", "misc.js", "frontmatter.js", "search.js"];
// the WebAssembly side (app-core): shipped only with --wasm, because on every function measured so far plain JS is as fast or faster
export const WASM_MODULES = ["core.js", "rust.js"];
export const MODULES = [...WASM_MODULES.slice(0, 1), ...JS_MODULES, ...WASM_MODULES.slice(1)];
const BEGIN = "/*basalt-own:begin*/";
const END = "/*basalt-own:end*/";

export function readManifest() {
  return JSON.parse(fs.readFileSync(path.join(srcDir, "manifest.json"), "utf8"));
}

export function buildWasm({ cargo = true } = {}) {
  const eng = path.join(root, "app-core");
  const target = process.env.CARGO_TARGET_DIR || "E:/rust-target/app-core";
  if (cargo) execSync("cargo build --release --target wasm32-unknown-unknown", { cwd: eng, stdio: "inherit", env: { ...process.env, CARGO_TARGET_DIR: target } });
  return fs.readFileSync(path.join(target, "wasm32-unknown-unknown/release/app_core.wasm"));
}

/** Module sources with imports/exports stripped, joined; returns { code, exported: Set } */
export function bundleModules(wasm) {
  const exported = new Set();
  const parts = [];
  for (const m of wasm ? MODULES : JS_MODULES) {
    let code = fs.readFileSync(path.join(srcDir, m), "utf8");
    if (m === "core.js") code = code.replace("__WASM_B64__", wasm.toString("base64"));
    const lines = code.split("\n").filter((l) => !/^import\s.*from\s+["'][^"']+["'];?\s*$/.test(l)).filter((l) => !/^export\s*\{.*\};?\s*$/.test(l));
    code = lines.join("\n").replace(/^export\s+(async\s+)?(function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/gm, (_, a, kind, name) => { exported.add(name); return `${a || ""}${kind} ${name}`; });
    parts.push(`// ---- ${m} ----\n${code.trim()}\n`);
  }
  const seen = new Map();
  const ast = acorn.parse(parts.join("\n"), { ecmaVersion: 2022 });
  for (const n of ast.body) {
    const names = n.type === "VariableDeclaration" ? n.declarations.map((d) => d.id.name) : n.id ? [n.id.name] : [];
    for (const name of names) { if (seen.has(name)) throw new Error(`duplicate top-level name ${name} in own modules`); seen.set(name, 1); }
  }
  const body = parts.join("\n").replace(/\n{3,}/g, "\n\n");
  const exportList = [...exported].sort();
  return { code: `var __basaltOwn=(()=>{\n${body}\nreturn {${exportList.join(",")}};\n})();`, exported };
}

/** Applies the manifest to the application text; returns the new text and the replaced byte count. */
export function applyOwn(srcText, wasm, tmpPath) {
  const manifest = readManifest();
  const base = loadBase(manifest.base);
  const { code, exported } = bundleModules(wasm);
  for (const e of manifest.entries) if (!exported.has(e.use)) throw new Error(`manifest: ${e.orig} -> ${e.use} is not exported by src-app`);

  // 1) wrappers (from the end of the file to the start, so earlier offsets stay valid)
  fs.writeFileSync(tmpPath, srcText);
  const b = loadBundle(tmpPath);
  const decl = new Map();
  for (const n of b.body) if (n.type === "FunctionDeclaration") decl.set(n.id.name, n);
  const jobs = [];
  let replaced = 0;
  for (const e of manifest.entries) {
    const n = decl.get(e.orig);
    if (!n) throw new Error(`manifest: no top-level function ${e.orig} in src/app.js`);
    if (!n.params.every((p) => p.type === "Identifier")) throw new Error(`manifest: ${e.orig} has non-trivial parameters`);
    const params = n.params.map((p) => p.name).join(",");
    const wrapper = `function ${e.orig}(${params}){return/*own*/__basaltOwn.${e.use}(${params})}`;
    const text = srcText.slice(n.start, n.end);
    const wrapped = /^function [^(]+\([^)]*\)\{return\/\*own\*\/\__basaltOwn\./.test(text);
    if (!wrapped) {
      if (text !== base.fn(e.orig)) throw new Error(`manifest: ${e.orig} differs from base ${manifest.base}; refusing to replace it`);
      replaced += text.length;
      e.originalBytes = text.length;
    }
    jobs.push({ start: n.start, end: n.end, wrapper, orig: e.orig, text });
  }
  jobs.sort((x, y) => y.start - x.start);
  let out = srcText;
  const fresh = [];
  for (const j of jobs) {
    if (out.slice(j.start, j.end) !== j.text) throw new Error("internal: offsets moved");
    out = out.slice(0, j.start) + j.wrapper + out.slice(j.end);
    if (!j.text.includes("/*own*/")) fresh.push(j.orig);
  }

  // 2) the block with the own modules
  const block = `${BEGIN}${code}${END}`;
  const bi = out.indexOf(BEGIN);
  if (bi >= 0) {
    const ei = out.indexOf(END, bi);
    out = out.slice(0, bi) + block + out.slice(ei + END.length);
  } else {
    const first = b.body[0]; // "use strict", always before any replaced function
    out = out.slice(0, first.end) + block + out.slice(first.end);
  }
  return { text: out, codeBytes: code.length, replacedFresh: fresh, entries: manifest.entries.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const input = path.join(root, "src", "app.js");
  const withWasm = process.argv.includes("--wasm");
  const wasm = withWasm ? buildWasm({ cargo: !process.argv.includes("--no-cargo") }) : null;
  const tmp = path.join(process.env.TEMP || process.env.TMPDIR || ".", "basalt-app-build.js");
  const res = applyOwn(fs.readFileSync(input, "utf8"), wasm, tmp);
  if (process.argv.includes("--check")) {
    if (res.text !== fs.readFileSync(input, "utf8")) { console.error("src/app.js is out of date with src-app/ (run node build-app.mjs)"); process.exit(1); }
    console.log("src/app.js is up to date");
  } else {
    const out = arg("--out") ? path.resolve(arg("--out")) : input;
    fs.writeFileSync(out, res.text);
    console.log(`app.js: ${out} (${res.text.length} bytes); own block ${res.codeBytes} bytes (${wasm ? `wasm ${wasm.length}` : "no wasm"}); ${res.entries} functions wrapped, ${res.replacedFresh.length} newly`);
  }
}
