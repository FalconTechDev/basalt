// Automation: scripts, watch, hooks, tasks, schedule, webhooks, plugins (x), trust.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { register } from "../lib/cli.mjs";
import { CliError, EXIT, usage, notFound, table, green, yellow, dim, sleep } from "../lib/util.mjs";
import { scriptApi, runScript, runTask, tasksOf, parseCron, cronMatches, nextRun, CLI_ENTRY } from "../lib/auto.mjs";
import * as ev from "../lib/events.mjs";

const apiFor = (ctx, args) => scriptApi(ctx.vault, { args, flags: ctx.flags, env: ctx.env, noHooks: ctx.flags["no-hooks"] });
const show = (ctx, r) => { if (r !== undefined && r !== null) ctx.result(r, typeof r === "string" ? r : JSON.stringify(r, null, 2), true); };
const scriptsDir = (v) => v.basaltPath("scripts");

register([
  {
    name: "run", usage: "run <script.mjs> [args...]", passthrough: true,
    ru: "Запустить скрипт. Ему передаётся готовый объект: export default async ({ vault, board, app, args, flags }) => { ... }\n(или глобальный `basalt`). vault: read/write/search/links/move/..., board(путь): cards/addCard/layout/save, app: status/open/command/events.\nРезультат, если он есть, печатается как JSON.",
    en: "Run a script. It receives a ready object: export default async ({ vault, board, app, args, flags }) => { ... }\n(or the global `basalt`). vault: read/write/search/links/move/..., board(path): cards/addCard/layout/save, app: status/open/command/events.\nThe returned value, if any, is printed as JSON.",
    async run(ctx) { ctx.need(1, "script"); if (!fs.existsSync(ctx.args[0])) throw notFound(`script not found: ${ctx.args[0]}`); show(ctx, await runScript(ctx.args[0], apiFor(ctx, ctx.args.slice(1)))); },
  },
  {
    name: "x list", usage: "x list", ru: "Скрипты-плагины из .basalt/scripts/*.mjs (запуск: basalt x <имя>).", en: "Plugin scripts from .basalt/scripts/*.mjs (run: basalt x <name>).",
    async run(ctx) {
      const d = scriptsDir(ctx.vault), l = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".mjs")).map((f) => f.slice(0, -4)) : [], out = [];
      for (const n of l) { let desc = ""; try { const m = await import(path.join(d, n + ".mjs").replace(/^/, "file:///").replace("file:////", "file:///").replace(/\\/g, "/") + "?l=" + Date.now()); desc = m.meta?.description || ""; } catch { /* broken script */ } out.push({ name: n, description: desc }); }
      ctx.result(out, out.map((o) => `${o.name.padEnd(20)} ${o.description}`).join("\n"), true);
    },
  },
  {
    name: "x", usage: "x <name> [args...]", passthrough: true, ru: "Запустить скрипт-плагин .basalt/scripts/<имя>.mjs (так же, как basalt run).", en: "Run a plugin script .basalt/scripts/<name>.mjs (like basalt run).",
    async run(ctx) { ctx.need(1, "name"); const f = path.join(scriptsDir(ctx.vault), ctx.args[0].replace(/\.mjs$/, "") + ".mjs"); if (!fs.existsSync(f)) throw notFound(`no plugin script ${f} (see: basalt x list)`); show(ctx, await runScript(f, apiFor(ctx, ctx.args.slice(1)))); },
  },
  {
    name: "watch", usage: "watch [--exec cmd | --script file | --task name | --hooks] [--ext md] [--debounce ms] [--max-events N] [--timeout sec]",
    spec: { exec: "str", script: "str", task: "str", hooks: "bool", ext: "list", debounce: "num", "max-events": "num", timeout: "num" },
    ru: "Следить за хранилищем и при изменениях (с задержкой, по умолчанию 500 мс) выполнить действие.\n  --exec <команда>  оболочка; переменные BASALT_FILE, BASALT_FILES (JSON)\n  --script <файл>   скрипт как у `run`, получает { files }\n  --task <имя>      задача из tasks.json\n  --hooks           вызвать хуки .basalt/hooks и вебхуки (нужно `basalt trust enable`)\n  --ext md,board    только эти расширения;  --max-events N / --timeout сек — остановиться сами",
    en: "Watch the vault and run an action on changes (debounced, default 500 ms).\n  --exec <command>  shell; env BASALT_FILE, BASALT_FILES (JSON)\n  --script <file>   script as in `run`, gets { files }\n  --task <name>     a task from tasks.json\n  --hooks           fire .basalt/hooks and webhooks (needs `basalt trust enable`)\n  --ext md,board    only these extensions;  --max-events N / --timeout sec — stop by itself",
    run(ctx) {
      const f = ctx.flags, v = ctx.vault; if (!f.exec && !f.script && !f.task && !f.hooks) throw usage("give --exec, --script, --task or --hooks");
      const exts = f.ext?.map((e) => e.replace(/^\./, "")), deb = f.debounce ?? 500, pending = new Set(), known = new Set(v.files().map((x) => x.path));
      let timer = null, events = 0, busy = false;
      return new Promise((resolve) => {
        const w = fs.watch(v.root, { recursive: true }, (_t, name) => {
          if (!name) return; const rel = name.split(path.sep).join("/");
          if (/(^|\/)(\.git|\.trash|\.basalt-history|\.basalt|\.obsidian|node_modules)(\/|$)/.test(rel) || /\.basalt-tmp-/.test(rel)) return;
          if (exts && !exts.includes((/\.([^./]+)$/.exec(rel) || [])[1])) return;
          if (busy) return; pending.add(rel); clearTimeout(timer); timer = setTimeout(flush, deb);
        });
        const stop = (code = 0) => { w.close(); resolve(code); };
        async function flush() {
          const files = [...pending]; pending.clear(); busy = true; v.invalidate();
          try {
            if (f.exec) spawnSync(f.exec, { shell: true, cwd: v.root, stdio: ["ignore", 2, 2], env: { ...ctx.env, BASALT_VAULT: v.root, BASALT_FILE: files[0], BASALT_FILES: JSON.stringify(files) } });
            if (f.task) runTask(v, f.task, { log: (s) => ctx.info(dim(s)) });
            if (f.script) await runScript(f.script, { ...apiFor(ctx, []), files });
            if (f.hooks) for (const file of files) {
              const exists = fs.existsSync(v.abs(file)), kind = !exists ? "delete" : known.has(file) ? "save" : "create"; exists ? known.add(file) : known.delete(file);
              await ev.emit(v, kind, { file }); if (file.endsWith(".board") && exists) await ev.emit(v, "board-change", { file });
            }
          } catch (e) { ctx.info(yellow("watch action failed: " + e.message)); }
          ctx.print(JSON.stringify({ event: "batch", files })); busy = false; pending.clear();
          if (f["max-events"] && ++events >= f["max-events"]) stop();
        }
        if (f.timeout) setTimeout(() => stop(), f.timeout * 1000);
        ctx.info(`watching ${v.root} (Ctrl+C to stop)`);
      });
    },
  },
  {
    name: "trust", usage: "trust enable|disable|status", ru: "Разрешить или запретить этому хранилищу автоматически запускать хуки и вебхуки. Флаг хранится вне хранилища (~/.basalt-cli/trust.json), поэтому скопированное хранилище само ничего не выполнит.",
    en: "Allow or forbid this vault to run hooks and webhooks automatically. The flag lives outside the vault (~/.basalt-cli/trust.json), so a copied vault never runs anything by itself.",
    run(ctx) { const a = ctx.args[0]; if (a === "enable" || a === "disable") ev.setTrusted(ctx.vault.root, a === "enable"); else if (a !== "status") throw usage("trust enable|disable|status"); const on = ev.isTrusted(ctx.vault.root); ctx.result({ vault: ctx.vault.root, automation: on }, `automation for this vault: ${on ? green("on") : "off"}`, true); },
  },
  {
    name: "hook list", usage: "hook list", ru: "Хуки в .basalt/hooks (on-save, on-create, on-delete, on-move, on-board-change) и включена ли автоматизация.", en: "Hooks in .basalt/hooks (on-save, on-create, on-delete, on-move, on-board-change) and whether automation is on.",
    run(ctx) { const h = ev.listHooks(ctx.vault).map((x) => ({ event: x.event, file: path.basename(x.file) })), on = ev.isTrusted(ctx.vault.root); ctx.result({ automation: on, hooks: h }, `automation: ${on ? "on" : "off (basalt trust enable)"}\n` + h.map((x) => `on-${x.event.padEnd(13)} ${x.file}`).join("\n"), true); },
  },
  {
    name: "hook init", usage: "hook init <event>", ru: "Создать заготовку хука (.mjs). Она ничего не делает, пока вы не включите `basalt trust enable`.", en: "Create a hook skeleton (.mjs). It does nothing until you run `basalt trust enable`.",
    run(ctx) {
      const e = ctx.args[0]; if (!ev.EVENTS.includes(e)) throw usage("event is one of: " + ev.EVENTS.join(", "));
      const f = ctx.vault.basaltPath("hooks", `on-${e}.mjs`); if (fs.existsSync(f)) throw new CliError("hook exists: " + f, EXIT.ERROR);
      fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `// Runs on "${e}". Env: BASALT_VAULT, BASALT_EVENT, BASALT_FILE, BASALT_DATA (JSON). Args: event, file.\nconst [event, file] = process.argv.slice(2);\nconsole.error(\`[hook] \${event}: \${file}\`);\n`);
      ctx.result({ file: f }, "created " + f);
    },
  },
  {
    name: "hook run", usage: "hook run <event> [--file path]", spec: { file: "str" }, ru: "Запустить хук вручную (доверие не требуется: вы запускаете его сами).", en: "Run a hook by hand (no trust needed: you start it yourself).",
    async run(ctx) { const e = ctx.args[0]; if (!ev.EVENTS.includes(e)) throw usage("event is one of: " + ev.EVENTS.join(", ")); const r = await ev.emit(ctx.vault, e, { file: ctx.flags.file || "" }, { force: true }); if (!r.hook) throw notFound(`no hook on-${e}`); ctx.result(r, `hook ${r.hook.file}: exit ${r.hook.status}`, true); return r.hook.status ? EXIT.ERROR : EXIT.OK; },
  },
  {
    name: "task list", usage: "task list", ru: "Задачи из .basalt/tasks.json.", en: "Tasks from .basalt/tasks.json.",
    run(ctx) { const t = tasksOf(ctx.vault), l = Object.entries(t).map(([n, x]) => ({ name: n, description: x.description || "", needs: x.needs || [], schedule: x.schedule || null })); ctx.result(l, table(l.map((x) => [x.name, x.schedule || "", x.needs.join(","), x.description]), ["task", "schedule", "needs", "description"]), true); },
  },
  {
    name: "task run", usage: "task run <name> [--dry-run] [-- extra args]", passthrough: true, spec: { "dry-run": "bool" },
    ru: "Выполнить задачу. В tasks.json: {\"tasks\": {\"имя\": {\"needs\": [\"другая\"], \"steps\": [\"команда\", {\"basalt\": \"check\"}, {\"script\": \"x.mjs\"}, {\"task\": \"другая\"}], \"schedule\": \"*/15 * * * *\"}}}\nЗадача останавливается на первом шаге с ошибкой (шаг можно пометить continueOnError).",
    en: "Run a task. In tasks.json: {\"tasks\": {\"name\": {\"needs\": [\"other\"], \"steps\": [\"command\", {\"basalt\": \"check\"}, {\"script\": \"x.mjs\"}, {\"task\": \"other\"}], \"schedule\": \"*/15 * * * *\"}}}\nA task stops at the first failing step (mark a step continueOnError to go on).",
    run(ctx) { ctx.need(1, "task"); const r = runTask(ctx.vault, ctx.args[0], { extra: ctx.args.slice(1).filter((a) => a !== "--dry-run"), env: ctx.env, dry: ctx.flags["dry-run"] || ctx.args.includes("--dry-run"), log: (s) => ctx.info(dim(s)) }); ctx.result(r, r.ok ? green("ok: " + r.task) : "task failed: " + r.task, true); return r.ok ? EXIT.OK : EXIT.ERROR; },
  },
  {
    name: "schedule list", usage: "schedule list", ru: "Задачи с расписанием (cron из пяти полей) и время следующего запуска.", en: "Tasks with a schedule (five-field cron) and their next run.",
    run(ctx) { const l = Object.entries(tasksOf(ctx.vault)).filter(([, t]) => t.schedule).map(([n, t]) => ({ task: n, schedule: t.schedule, next: nextRun(t.schedule)?.toISOString() || null })); ctx.result(l, table(l.map((x) => [x.task, x.schedule, x.next]), ["task", "schedule", "next run (UTC)"]), true); },
  },
  {
    name: "schedule run", usage: "schedule run [--max-runs N] [--timeout sec]", spec: { "max-runs": "num", timeout: "num", "tick-ms": "num" },
    ru: "Цикл на переднем плане: раз в минуту запускает задачи, чьё расписание подошло. Останавливается по Ctrl+C.", en: "Foreground loop: every minute it runs the tasks whose schedule matches. Stop with Ctrl+C.",
    async run(ctx) {
      const tasks = Object.entries(tasksOf(ctx.vault)).filter(([, t]) => t.schedule).map(([n, t]) => [n, parseCron(t.schedule)]); if (!tasks.length) throw usage("no task has a schedule");
      const end = ctx.flags.timeout ? Date.now() + ctx.flags.timeout * 1000 : Infinity; let runs = 0, last = -1;
      while (Date.now() < end) {
        const now = new Date(), key = Math.floor(now.getTime() / 60000);
        if (key !== last) { last = key; for (const [n, c] of tasks) if (cronMatches(c, now)) { ctx.print(JSON.stringify({ time: now.toISOString(), task: n, ok: runTask(ctx.vault, n, { env: ctx.env }).ok })); if (ctx.flags["max-runs"] && ++runs >= ctx.flags["max-runs"]) return EXIT.OK; } }
        await sleep(ctx.flags["tick-ms"] || 5000);
      }
    },
  },
  {
    name: "schedule install", usage: "schedule install <task> [--dry-run]", spec: { "dry-run": "bool" },
    ru: "Поставить задачу в планировщик ОС (Windows: schtasks; иначе crontab). Только по вашей команде. Windows понимает: */N * * * *, M * * * *, M H * * *, M H * * день-недели.", en: "Put a task into the OS scheduler (Windows: schtasks; elsewhere crontab). Only when you ask. Windows handles: */N * * * *, M * * * *, M H * * *, M H * * weekday.",
    run(ctx) {
      const name = ctx.args[0]; const t = tasksOf(ctx.vault)[name]; if (!t) throw notFound(`no task "${name}"`); if (!t.schedule) throw usage(`task "${name}" has no schedule`);
      const tag = `basalt-${ctx.vault.name}-${name}`, cmdline = `"${process.execPath}" "${CLI_ENTRY}" --vault "${ctx.vault.root}" task run ${name}`, plan = [];
      if (process.platform === "win32") {
        const f = t.schedule.trim().split(/\s+/), pad = (n) => String(n).padStart(2, "0"); let sc;
        if (/^\*\/\d+$/.test(f[0]) && f.slice(1).every((x) => x === "*")) sc = ["/SC", "MINUTE", "/MO", f[0].slice(2)];
        else if (/^\d+$/.test(f[0]) && f.slice(1).every((x) => x === "*") ) sc = ["/SC", "HOURLY", "/ST", `00:${pad(f[0])}`];
        else if (/^\d+$/.test(f[0]) && /^\d+$/.test(f[1]) && f[2] === "*" && f[3] === "*" && f[4] === "*") sc = ["/SC", "DAILY", "/ST", `${pad(f[1])}:${pad(f[0])}`];
        else if (/^\d+$/.test(f[0]) && /^\d+$/.test(f[1]) && f[2] === "*" && f[3] === "*" && /^[0-7]$/.test(f[4])) sc = ["/SC", "WEEKLY", "/D", ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"][+f[4]], "/ST", `${pad(f[1])}:${pad(f[0])}`];
        else throw usage("this cron expression is too complex for schtasks; use `basalt schedule run` instead");
        plan.push({ cmd: "schtasks", args: ["/Create", "/F", "/TN", `Basalt\\${tag}`, "/TR", cmdline, ...sc] });
      } else plan.push({ cron: `${t.schedule} ${cmdline} # ${tag}`, tag });
      if (!ctx.flags["dry-run"]) {
        for (const p of plan) {
          if (p.cmd) { const r = spawnSync(p.cmd, p.args, { stdio: ["ignore", 2, 2] }); if (r.status) throw new CliError("schtasks failed", EXIT.ERROR); }
          else { const cur = spawnSync("crontab", ["-l"], { encoding: "utf8" }).stdout || "", keep = cur.split("\n").filter((l) => l && !l.endsWith("# " + p.tag)); const w = spawnSync("crontab", ["-"], { input: [...keep, p.cron].join("\n") + "\n" }); if (w.status) throw new CliError("crontab failed", EXIT.ERROR); }
        }
      }
      ctx.result({ dryRun: !!ctx.flags["dry-run"], plan }, plan.map((p) => (p.cmd ? p.cmd + " " + p.args.join(" ") : p.cron)).join("\n"), true);
    },
  },
  {
    name: "schedule uninstall", usage: "schedule uninstall <task> [--dry-run]", spec: { "dry-run": "bool" }, ru: "Убрать задачу из планировщика ОС.", en: "Remove a task from the OS scheduler.",
    run(ctx) {
      const name = ctx.args[0]; if (!name) throw usage("task name needed"); const tag = `basalt-${ctx.vault.name}-${name}`;
      if (!ctx.flags["dry-run"]) { if (process.platform === "win32") spawnSync("schtasks", ["/Delete", "/F", "/TN", `Basalt\\${tag}`], { stdio: "ignore" }); else { const cur = spawnSync("crontab", ["-l"], { encoding: "utf8" }).stdout || ""; spawnSync("crontab", ["-"], { input: cur.split("\n").filter((l) => l && !l.endsWith("# " + tag)).join("\n") + "\n" }); } }
      ctx.result({ removed: tag, dryRun: !!ctx.flags["dry-run"] }, `${ctx.flags["dry-run"] ? "would remove" : "removed"} ${tag}`);
    },
  },
  {
    name: "webhook list", usage: "webhook list", ru: "Вебхуки из .basalt/webhooks.json: {\"hooks\": [{\"url\", \"events\": [\"save\",...], \"secret\": \"env:ИМЯ\"}]}. Отправляются только при `basalt trust enable`.", en: "Webhooks from .basalt/webhooks.json: {\"hooks\": [{\"url\", \"events\": [\"save\",...], \"secret\": \"env:NAME\"}]}. Sent only with `basalt trust enable`.",
    run(ctx) { const l = ev.webhookConfig(ctx.vault).map((h) => ({ url: h.url, events: h.events || ["*"], signed: !!h.secret })); ctx.result(l, l.map((h) => `${h.url}  [${h.events.join(",")}]${h.signed ? "  signed" : ""}`).join("\n"), true); },
  },
  {
    name: "webhook add", usage: "webhook add <url> [--events save,create] [--secret s|env:NAME]", spec: { events: "list", secret: "str" }, ru: "Добавить вебхук в .basalt/webhooks.json.", en: "Add a webhook to .basalt/webhooks.json.",
    run(ctx) { ctx.need(1, "url"); new URL(ctx.args[0]); const f = ctx.vault.basaltPath("webhooks.json"); let j = { hooks: [] }; try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* new */ } j.hooks.push({ url: ctx.args[0], events: ctx.flags.events || ["*"], ...(ctx.flags.secret ? { secret: ctx.flags.secret } : {}) }); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(j, null, 2)); ctx.result({ count: j.hooks.length }, "added"); },
  },
  {
    name: "webhook test", usage: "webhook test <url|index> [--event save]", spec: { event: "str" }, ru: "Отправить тестовое событие (по вашей команде, доверие не нужно).", en: "Send a test event (on your command, no trust needed).",
    async run(ctx) {
      ctx.need(1, "url or index"); const cfg = ev.webhookConfig(ctx.vault), h = /^\d+$/.test(ctx.args[0]) ? cfg[+ctx.args[0]] : cfg.find((x) => x.url === ctx.args[0]) || { url: ctx.args[0] };
      if (!h) throw notFound("no such webhook"); const r = await ev.deliver(h, ctx.flags.event || "test", { vault: ctx.vault.name, file: "test.md" }); ctx.result(r, r.ok ? green("delivered " + r.status) : "failed: " + (r.error || r.status), true); return r.ok ? EXIT.OK : EXIT.ERROR;
    },
  },
  {
    name: "webhook sign", usage: "webhook sign <secret> <timestamp> <body>", ru: "Посчитать подпись X-Basalt-Signature: sha256=HMAC(secret, \"<timestamp>.<тело>\") — для проверки на принимающей стороне.", en: "Compute X-Basalt-Signature: sha256=HMAC(secret, \"<timestamp>.<body>\") — for checking on the receiving side.",
    run(ctx) { ctx.need(3, "secret, timestamp and body"); const s = ev.sign(ctx.args[0], ctx.args[1], ctx.args.slice(2).join(" ")); ctx.result({ signature: s }, s, true); },
  },
]);
