// Test helpers: temp vault, running the CLI as a child process.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "basalt.mjs");
export const tmp = (p = "bs-test-") => fs.mkdtempSync(path.join(os.tmpdir(), p));
export function makeVault(files = {}) {
  const root = tmp(); fs.mkdirSync(path.join(root, ".basalt"));
  for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); }
  return root;
}
export const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
export const put = (root, f, t) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), t); };
export const get = (root, f) => fs.readFileSync(path.join(root, f), "utf8");

/** run the CLI; returns {code, out, err, json()} */
export function cli(root, args, { input, env } = {}) {
  const home = path.join(os.tmpdir(), "bs-test-home");
  const r = spawnSync(process.execPath, [ENTRY, ...(root ? ["--vault", root] : []), ...(args.includes("--lang") ? [] : ["--lang", "en"]), "--no-color", ...args], { input: input ?? "", encoding: "utf8", env: { ...process.env, BASALT_HOME: home, BASALT_USER_DATA: path.join(home, "ud"), ...env }, timeout: 60000 });
  return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
}

import { spawn } from "node:child_process";
/** async variant (needed when the test process itself serves HTTP to the CLI) */
export function cliAsync(root, args, { input, env } = {}) {
  const home = path.join(os.tmpdir(), "bs-test-home");
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [ENTRY, ...(root ? ["--vault", root] : []), ...(args.includes("--lang") ? [] : ["--lang", "en"]), "--no-color", ...args], { env: { ...process.env, BASALT_HOME: home, BASALT_USER_DATA: path.join(home, "ud"), ...env } });
    let out = "", err = ""; p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err, json: () => JSON.parse(out) }));
    p.stdin.end(input ?? "");
  });
}
