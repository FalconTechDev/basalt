// Hooks and webhooks. Nothing here runs unless the user created the files AND switched automation on for this vault
// (`basalt trust enable`, stored outside the vault so a copied or synced vault can never run code by itself).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { readJson } from "./util.mjs";

export const EVENTS = ["save", "create", "delete", "move", "board-change"];

// ---------- trust store (per user, per vault path) ----------
const homeDir = () => process.env.BASALT_HOME || path.join(os.homedir(), ".basalt-cli");
const trustFile = () => path.join(homeDir(), "trust.json");
export const isTrusted = (root) => !!readJson(trustFile(), {}).vaults?.[path.resolve(root)]?.automation;
export function setTrusted(root, on) {
  const j = readJson(trustFile(), {}); j.vaults ||= {};
  if (on) j.vaults[path.resolve(root)] = { automation: true, since: new Date().toISOString() }; else delete j.vaults[path.resolve(root)];
  fs.mkdirSync(homeDir(), { recursive: true }); fs.writeFileSync(trustFile(), JSON.stringify(j, null, 2));
}
export const settingsFile = () => path.join(homeDir(), "settings.json");

// ---------- running a file by extension ----------
export function runFile(file, args, env, opts = {}) {
  const ext = path.extname(file).toLowerCase(), E = { ...process.env, ...env };
  let cmd = file, a = args;
  if (ext === ".mjs" || ext === ".js" || ext === ".cjs") { cmd = process.execPath; a = [file, ...args]; }
  else if (ext === ".ps1") { cmd = "powershell"; a = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, ...args]; }
  else if (ext === ".cmd" || ext === ".bat") { cmd = process.env.ComSpec || "cmd.exe"; a = ["/c", file, ...args]; }
  else if (ext === ".sh") { cmd = "sh"; a = [file, ...args]; }
  const r = spawnSync(cmd, a, { env: E, cwd: opts.cwd, stdio: ["ignore", 2, 2], timeout: opts.timeout || 60000, windowsHide: true });
  return { status: r.status, error: r.error ? String(r.error.message) : null, signal: r.signal };
}
export function findHook(vault, name) {
  const dir = vault.basaltPath("hooks"); if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).find((n) => n === name || n.replace(/\.[^.]+$/, "") === name);
  return f ? path.join(dir, f) : null;
}
export function listHooks(vault) {
  const dir = vault.basaltPath("hooks"); if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => EVENTS.includes(n.replace(/^on-/, "").replace(/\.[^.]+$/, ""))).map((n) => ({ event: n.replace(/^on-/, "").replace(/\.[^.]+$/, ""), file: path.join(dir, n) }));
}

// ---------- webhooks ----------
export const webhookConfig = (vault) => readJson(vault.basaltPath("webhooks.json"), { hooks: [] }).hooks || [];
const secretOf = (s) => (typeof s === "string" && s.startsWith("env:") ? process.env[s.slice(4)] || "" : s || "");
export function sign(secret, timestamp, body) { return "sha256=" + crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"); }

export function deliver(hook, event, payload) {
  return new Promise((resolve) => {
    let u; try { u = new URL(hook.url); } catch { return resolve({ ok: false, error: "bad url" }); }
    const body = JSON.stringify({ event, time: new Date().toISOString(), ...payload }), ts = String(Math.floor(Date.now() / 1000)), secret = secretOf(hook.secret);
    const headers = { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "User-Agent": "basalt-cli", "X-Basalt-Event": event, "X-Basalt-Timestamp": ts, "X-Basalt-Delivery": crypto.randomUUID(), ...(hook.headers || {}) };
    if (secret) headers["X-Basalt-Signature"] = sign(secret, ts, body);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, { method: "POST", headers, timeout: hook.timeoutMs || 5000 }, (res) => { res.resume(); res.on("end", () => resolve({ ok: res.statusCode < 300, status: res.statusCode })); });
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.on("error", (e) => resolve({ ok: false, error: e.message }));
    req.end(body);
  });
}

/**
 * Fire an event: runs .basalt/hooks/on-<event>, then posts to matching webhooks. Silent no-op without trust.
 * `data`: {file, ...}. Returns a report (hooks run, deliveries).
 */
export async function emit(vault, event, data = {}, { noHooks = false, force = false } = {}) {
  const rep = { hook: null, webhooks: [] };
  if (noHooks || (!force && !isTrusted(vault.root))) return rep;
  const hook = findHook(vault, "on-" + event);
  if (hook) rep.hook = { file: path.basename(hook), ...runFile(hook, [event, data.file || ""], { BASALT_VAULT: vault.root, BASALT_EVENT: event, BASALT_FILE: data.file || "", BASALT_DATA: JSON.stringify(data) }, { cwd: vault.root }) };
  for (const h of webhookConfig(vault)) {
    const evs = h.events || ["*"]; if (!evs.includes("*") && !evs.includes(event)) continue;
    rep.webhooks.push({ url: h.url, ...(await deliver(h, event, { vault: vault.name, ...data })) });
  }
  return rep;
}
