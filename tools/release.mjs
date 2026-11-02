// Publishes a release: builds the installer, tags the commit and uploads the installer to GitHub Releases.
//   node tools/release.mjs 0.2.0 "what is new"            (dry run: prints what it would do)
//   node tools/release.mjs 0.2.0 "what is new" --yes      (does it; needs `gh` signed in)
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, "")), "..");
const [version, notes] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!/^\d+\.\d+\.\d+$/.test(version || "")) { console.error("usage: node tools/release.mjs <x.y.z> \"notes\" [--yes]"); process.exit(1); }
const yes = process.argv.includes("--yes"), exe = path.join(root, "dist", `Basalt-Setup-${version}.exe`);
const steps = [`node build-installer.mjs --skip-build   (installer ${exe})`, `gh release create v${version} "${exe}" --repo FalconTechDev/basalt --title "Basalt ${version}" --notes "${notes || ""}"`];
console.log(steps.join("\n"));
if (!yes) { console.log("\ndry run: add --yes to publish"); process.exit(0); }
execSync("node build-installer.mjs --skip-build", { cwd: root, stdio: "inherit" });
if (!fs.existsSync(exe)) { console.error("installer not found: bump the version in installer/basalt.iss first"); process.exit(1); }
execSync(steps[1].replace(/^gh /, "gh "), { cwd: root, stdio: "inherit" });
