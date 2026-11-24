// Builds dist/Basalt-Setup-<version>.exe: stages the Electron runtime + the app into dist/stage, then runs Inno Setup.
//   node build-installer.mjs [--version 0.1.0] [--skip-build]
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const version = args.includes("--version") ? args[args.indexOf("--version") + 1] : "0.1.0";
const stage = path.join(root, "dist", "stage");
const iscc = [
  process.env.ISCC,
  path.join(process.env.LOCALAPPDATA || "", "Programs", "Inno Setup 6", "ISCC.exe"),
  "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
  "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
].find((p) => p && fs.existsSync(p));
if (!iscc) throw new Error("Inno Setup 6 not found: install it or set ISCC to ISCC.exe");

if (!args.includes("--skip-build")) {
  execSync("node brand.mjs", { cwd: root, stdio: "inherit" });
  execSync("node build-canvas.mjs --no-cargo", { cwd: root, stdio: "inherit", env: { ...process.env, CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || path.join(root, "canvas-engine", "target") } });
}

const runtime = path.join(root, "runtime");
if (!fs.existsSync(path.join(runtime, "Basalt.exe"))) throw new Error("runtime/Basalt.exe is missing: run run.ps1 once so the runtime is created from stock Electron");

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// the runtime, without the two junctions that point at the working copies
const skip = new Set([path.join(runtime, "resources", "app"), path.join(runtime, "resources", "app-src")].map((p) => p.toLowerCase()));
// btime and get-fonts are native modules written by the Obsidian authors (package.json says UNLICENSED); the stock runtime has
// none, but old stub/node_modules copies may, and they must not be shipped. Both are optional: the app falls back (no birth-time write, system font list).
const NOT_SHIPPED = /[\\/](btime|get-fonts)([\\/]|$)/i;
fs.cpSync(runtime, stage, { recursive: true, filter: (from) => !skip.has(from.toLowerCase()) && !NOT_SHIPPED.test(from) });

// the real folders instead
fs.cpSync(path.join(root, "stub"), path.join(stage, "resources", "app"), { recursive: true, filter: (from) => !NOT_SHIPPED.test(from) });
fs.cpSync(path.join(root, "src"), path.join(stage, "resources", "app-src"), {
  recursive: true,
  filter: (from) => !/app\.js\.orig$/.test(from),
});

const count = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(d, e.name)) : 1), 0);
// `basalt` in a terminal must reach OUR command line: the old Obsidian shim (Basalt.com) cannot find the app, so it is replaced
const cliExe = path.join(root, "src", "bin", "basalt-cli.exe");
if (fs.existsSync(cliExe)) fs.copyFileSync(cliExe, path.join(stage, "Basalt.com"));
if (fs.existsSync(cliExe)) fs.copyFileSync(cliExe, path.join(stage, "basalt-cli.exe")); // `basalt-cli` in any terminal
console.log(`staged ${count(stage)} files`);

execFileSync(iscc, [`/DAppVersion=${version}`, path.join(root, "installer", "basalt.iss")], { stdio: "inherit" });
const out = path.join(root, "dist", `Basalt-Setup-${version}.exe`);
console.log(`\n${out}  ${(fs.statSync(out).size / 1048576).toFixed(0)} MB`);
