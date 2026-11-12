// Builds the Markdown engine (markdown-engine, Rust -> WebAssembly) and bakes it into src/worker.js:
//   node build-markdown.mjs            compile with cargo and write src/worker.js
//   node build-markdown.mjs --no-cargo reuse the wasm that is already built
//   node build-markdown.mjs --out F    write the worker to F instead of src/worker.js
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const eng = path.join(root, "markdown-engine");
const target = process.env.CARGO_TARGET_DIR || "E:/rust-target/markdown-engine";
const outArg = process.argv.indexOf("--out");
const out = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(root, "src", "worker.js");

if (!process.argv.includes("--no-cargo")) {
  execSync("cargo build --release --target wasm32-unknown-unknown", { cwd: eng, stdio: "inherit", env: { ...process.env, CARGO_TARGET_DIR: target } });
}
const wasm = fs.readFileSync(path.join(target, "wasm32-unknown-unknown/release/markdown_engine.wasm"));
const shim = fs.readFileSync(path.join(eng, "worker.src.js"), "utf8");
fs.writeFileSync(out, shim.replace("__WASM_B64__", wasm.toString("base64")));
console.log(`worker: ${out} (${fs.statSync(out).size} bytes, wasm ${wasm.length} bytes)`);
