// Command registry, argument routing, help (ru + en), output and error handling.
import { CliError, EXIT, parseArgs, usage, color, readStdin, bold, dim, cyan, red } from "./util.mjs";
import { Vault } from "./vault.mjs";

export const GLOBAL_SPEC = { json: "bool", quiet: "bool", vault: "str", lang: "str", "no-color": "bool", color: "bool", help: "bool", "no-hooks": "bool", version: "bool" };
export const GLOBAL_ALIAS = { q: "quiet", h: "help", v: "vault", j: "json" };
export const VERSION = "1.0.0";

export const registry = [];
/** Register commands: {name, usage, ru, en, spec, alias, run(ctx)}  (ru/en: first line summary, then details) */
export function register(list) { for (const c of list) registry.push({ spec: {}, alias: {}, ...c }); }

function findCommand(argv) {
  const words = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--") break;
    if (t.startsWith("-")) { const n = t.replace(/^--?/, ""); if ((n === "vault" || n === "v" || n === "lang") && !t.includes("=")) i++; continue; }
    words.push(i); if (words.length >= 3) break;
  }
  for (let n = words.length; n >= 1; n--) {
    const name = words.slice(0, n).map((i) => argv[i]).join(" ");
    const cmd = registry.find((c) => c.name === name);
    if (cmd) { const rest = argv.filter((_, i) => !words.slice(0, n).includes(i)); return { cmd, rest }; }
  }
  return { cmd: null, rest: argv, words: words.map((i) => argv[i]) };
}

const pick = (c, lang) => (lang === "en" ? c.en || c.ru : c.ru || c.en) || "";
const firstLine = (s) => s.split("\n")[0];

export function helpAll(lang) {
  const groups = new Map();
  for (const c of registry) { const g = c.name.split(" ")[0]; (groups.get(g) || groups.set(g, []).get(g)).push(c); }
  const ru = lang !== "en";
  const L = [bold("basalt") + " " + VERSION + (ru ? " — командная строка и автоматизация Basalt" : " — Basalt command line and automation"), "",
    ru ? "Использование: basalt [--vault <папка>] [--json] [-q] [--lang ru|en] <команда> [аргументы]" : "Usage: basalt [--vault <folder>] [--json] [-q] [--lang ru|en] <command> [arguments]", "",
    ru ? "Команды (подробно: basalt <команда> --help):" : "Commands (details: basalt <command> --help):"];
  for (const [g, list] of groups) for (const c of list) L.push("  " + cyan(c.name.padEnd(24)) + dim(firstLine(pick(c, lang))));
  L.push("", ru ? "Общие ключи: --vault <папка> (или BASALT_VAULT), --json, -q/--quiet, --lang ru|en, --no-color (или NO_COLOR), --no-hooks"
    : "Global flags: --vault <folder> (or BASALT_VAULT), --json, -q/--quiet, --lang ru|en, --no-color (or NO_COLOR), --no-hooks");
  L.push(ru ? "Коды выхода: 0 успех, 1 ошибка, 2 неверное использование, 3 не найдено, 4 проверка не пройдена, 5 приложение недоступно, 6 отказано"
    : "Exit codes: 0 ok, 1 error, 2 usage, 3 not found, 4 check failed, 5 app unreachable, 6 refused");
  return L.join("\n");
}
export function helpCommand(c, lang) {
  const t = pick(c, lang).split("\n");
  return [bold("basalt " + (c.usage || c.name)), "", t[0], ...(t.length > 1 ? ["", ...t.slice(1)] : [])].join("\n");
}

export async function main(argv, io = {}) {
  const out = io.stdout || ((s) => process.stdout.write(s)), err = io.stderr || ((s) => process.stderr.write(s));
  const env = io.env || process.env;
  const wantJson = argv.includes("--json") || argv.includes("-j");
  try {
    const lang0 = (() => { const i = argv.indexOf("--lang"); return (i >= 0 ? argv[i + 1] : (argv.find((a) => a.startsWith("--lang=")) || "").slice(7)) || env.BASALT_LANG || "ru"; })();
    const lang = String(lang0).toLowerCase().startsWith("en") ? "en" : "ru";
    color.on = !!(process.stdout.isTTY && !env.NO_COLOR && !argv.includes("--no-color") && env.TERM !== "dumb") || argv.includes("--color");
    if (argv.includes("--no-color")) color.on = false;
    const found = findCommand(argv);
    if (!found.cmd) {
      if (!found.words || !found.words.length || argv.includes("--help") || argv.includes("-h") || found.words[0] === "help") {
        if (argv.includes("--version")) { out(VERSION + "\n"); return EXIT.OK; }
        out(helpAll(lang) + "\n"); return EXIT.OK;
      }
      if (argv.includes("--version")) { out(VERSION + "\n"); return EXIT.OK; }
      const w = found.words[0], near = registry.map((c) => c.name).filter((n) => n.startsWith(w)).slice(0, 5);
      throw usage(`unknown command "${found.words.join(" ")}"` + (near.length ? `. Did you mean: ${near.join(", ")}?` : ". Run: basalt --help"));
    }
    const { cmd, rest } = found;
    const { pos, flags } = parseArgs(rest, { ...GLOBAL_SPEC, ...cmd.spec }, { ...GLOBAL_ALIAS, ...cmd.alias }, !!cmd.passthrough);
    if (flags.help) { out(helpCommand(cmd, lang) + "\n"); return EXIT.OK; }
    const json = !!flags.json, quiet = !!flags.quiet;
    let vault = null;
    const ctx = {
      args: pos, flags, lang, json, quiet, env, cmd,
      get vault() { return vault || (vault = Vault.find(flags.vault, io.cwd || process.cwd())); },
      stdin: io.stdin || readStdin,
      print: (s) => out(String(s).endsWith("\n") ? String(s) : s + "\n"),
      info: (s) => { if (!quiet && !json) err(s + "\n"); },
      /** Print a result: JSON when --json, else the text. `essential` output (read, list...) ignores --quiet. */
      result(data, text, essential = false) {
        if (json) out(JSON.stringify(data, null, 2) + "\n");
        else if (text != null && (essential || !quiet)) out(String(text).endsWith("\n") ? String(text) : text + "\n");
      },
      need(n, what) { if (pos.length < n) throw usage(`missing ${what || "argument"}\nUsage: basalt ${cmd.usage || cmd.name}`); },
    };
    const code = await cmd.run(ctx);
    return typeof code === "number" ? code : EXIT.OK;
  } catch (e) {
    const code = e instanceof CliError ? e.code : EXIT.ERROR, msg = e && e.message || String(e);
    if (wantJson) err(JSON.stringify({ error: msg, code, ...(e && e.data ? { data: e.data } : {}) }) + "\n");
    else err(red("error: ") + msg + "\n");
    if (!(e instanceof CliError) && env.BASALT_DEBUG) err(String(e.stack) + "\n");
    return code;
  }
}
