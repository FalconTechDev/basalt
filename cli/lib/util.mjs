// Small shared helpers: errors with exit codes, argument parser, output, dates, colours.
import fs from "node:fs";

// Stable exit codes (documented in docs/CLI.md)
export const EXIT = { OK: 0, ERROR: 1, USAGE: 2, NOT_FOUND: 3, CHECK_FAILED: 4, APP: 5, REFUSED: 6 };

export class CliError extends Error {
  constructor(message, code = EXIT.ERROR, data) { super(message); this.code = code; this.data = data; }
}
export const usage = (m) => new CliError(m, EXIT.USAGE);
export const notFound = (m) => new CliError(m, EXIT.NOT_FOUND);

/** Parse argv by a spec {name: "bool"|"str"|"num"|"list"}; short aliases come from `alias`. Returns {pos, flags}. */
export function parseArgs(argv, spec = {}, alias = {}) {
  const pos = [], flags = {};
  const set = (name, val) => {
    const t = spec[name];
    if (t === "list") (flags[name] ||= []).push(...String(val).split(",").filter(Boolean));
    else if (t === "multi") (flags[name] ||= []).push(String(val));
    else if (t === "num") { const n = Number(val); if (Number.isNaN(n)) throw usage(`--${name} expects a number, got "${val}"`); flags[name] = n; }
    else flags[name] = val;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") { pos.push(...argv.slice(i + 1)); break; }
    let m;
    if ((m = /^--([^=]+)=(.*)$/s.exec(a))) { const n = m[1]; if (!(n in spec)) throw usage(`unknown option --${n}`); set(n, m[2]); continue; }
    if (a.startsWith("--") && a.length > 2) {
      let n = a.slice(2);
      if (n.startsWith("no-") && spec[n.slice(3)] === "bool") { flags[n.slice(3)] = false; continue; }
      if (!(n in spec)) throw usage(`unknown option --${n}`);
      if (spec[n] === "bool") { flags[n] = true; continue; }
      if (i + 1 >= argv.length) throw usage(`--${n} needs a value`);
      set(n, argv[++i]); continue;
    }
    if (/^-[a-zA-Z]$/.test(a) && alias[a[1]]) {
      const n = alias[a[1]];
      if (spec[n] === "bool") flags[n] = true; else { if (i + 1 >= argv.length) throw usage(`${a} needs a value`); set(n, argv[++i]); }
      continue;
    }
    pos.push(a);
  }
  return { pos, flags };
}

export async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

// ---- colours (NO_COLOR, non-TTY and --no-color switch them off)
export const color = { on: false };
export const paint = (code, s) => (color.on ? `\u001b[${code}m${s}\u001b[0m` : String(s));
export const dim = (s) => paint(2, s), red = (s) => paint(31, s), green = (s) => paint(32, s), yellow = (s) => paint(33, s), cyan = (s) => paint(36, s), bold = (s) => paint(1, s);

// ---- dates
const pad = (n, l = 2) => String(n).padStart(l, "0");
/** moment-style subset: YYYY YY MM M DD D HH mm ss dddd (English day names) */
export function formatDate(d, fmt = "YYYY-MM-DD") {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const map = { YYYY: d.getFullYear(), YY: pad(d.getFullYear() % 100), MM: pad(d.getMonth() + 1), M: d.getMonth() + 1, DD: pad(d.getDate()), D: d.getDate(), HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()), dddd: days[d.getDay()] };
  return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MM|M|DD|D|HH|mm|ss|dddd/g, (s, lit) => (lit !== undefined ? lit : String(map[s])));
}
/** "2026-01-31", "7d", "12h", "2w", "now" -> Date (relative values are in the past) */
export function parseWhen(s) {
  if (s == null) return null;
  const m = /^(\d+)\s*(m|h|d|w)$/.exec(String(s).trim());
  if (m) return new Date(Date.now() - Number(m[1]) * { m: 6e4, h: 36e5, d: 864e5, w: 6048e5 }[m[2]]);
  if (s === "now") return new Date();
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00:00" : s);
  if (Number.isNaN(d.getTime())) throw usage(`cannot read date "${s}" (use 2026-01-31, 7d, 12h)`);
  return d;
}

export const posix = (p) => p.split("\\").join("/");
export const readJson = (file, dflt) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return dflt; } };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sha = (s) => import("node:crypto").then((c) => c.createHash("sha256").update(s).digest("hex"));

/** Plain text table with aligned columns */
export function table(rows, cols) {
  const w = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => String(r[i] ?? "").length)));
  const line = (r) => r.map((v, i) => String(v ?? "").padEnd(w[i])).join("  ").trimEnd();
  return [dim(line(cols)), ...rows.map(line)].join("\n");
}
