// Talking to the running app through its local API. `app board ...` edits boards that are OPEN in the app.
import fs from "node:fs";
import path from "node:path";
import { register } from "../lib/cli.mjs";
import { CliError, EXIT, usage, table, green } from "../lib/util.mjs";
import { App, settingsPath } from "../lib/app.mjs";
import { title } from "../lib/board.mjs";

const mk = (ctx) => new App({ infoFile: ctx.flags["api-info"] }, ctx.env);
const A = { "api-info": "str" };
const B = { ...A, open: "bool" };
const bq = (ctx, extra = {}) => ({ path: ctx.args[0], open: ctx.flags.open, ...extra });
const CARD = { text: "str", x: "num", y: "num", w: "num", h: "num", color: "str", kind: "str" };
const cardBody = (f) => ({ text: f.text, x: f.x, y: f.y, w: f.w, h: f.h, color: f.color, kind: f.kind });

register([
  {
    name: "app status", usage: "app status", spec: A, ru: "Состояние запущенного приложения (код 5, если оно не запущено).", en: "State of the running app (exit 5 when it is not running).",
    async run(ctx) { const s = await mk(ctx).get("/v1/status"); ctx.result(s, `${green("Basalt is running")}  vault ${s.vault}\n  notes ${s.notes}  boards ${s.boards}  files ${s.files}\n  active: ${s.activeFile || "-"}\n  open boards: ${s.openBoards.join(", ") || "-"}\n  eval: ${s.eval ? "on" : "off"}`, true); },
  },
  {
    name: "app open", usage: "app open <file> [--line N]", spec: { ...A, line: "num" }, ru: "Открыть файл в приложении (в новой вкладке).", en: "Open a file in the app (new tab).",
    async run(ctx) { ctx.need(1, "file"); await mk(ctx).post("/v1/open", { path: ctx.args[0], line: ctx.flags.line }); ctx.result({ ok: true }, "opened " + ctx.args[0]); },
  },
  {
    name: "app commands", usage: "app commands [filter]", spec: A, ru: "Список команд приложения (id и название).", en: "List app commands (id and name).",
    async run(ctx) { const l = await mk(ctx).get("/v1/commands", { q: ctx.args[0] }); ctx.result(l, l.map((c) => `${c.id}  ${c.name}`).join("\n"), true); },
  },
  {
    name: "app run-command", usage: "app run-command <id>", spec: A, ru: "Выполнить команду приложения по id (см. app commands).", en: "Run an app command by id (see app commands).",
    async run(ctx) { ctx.need(1, "command id"); const r = await mk(ctx).post("/v1/command", { id: ctx.args[0] }); ctx.result(r, `ran ${ctx.args[0]}`); },
  },
  {
    name: "app search", usage: "app search <text> [--show]", spec: { ...A, show: "bool", limit: "num" }, ru: "Поиск через приложение. --show показывает запрос в панели поиска.", en: "Search through the app. --show puts the query into the search pane.",
    async run(ctx) {
      ctx.need(1, "text"); const q = ctx.args.join(" "), a = mk(ctx);
      if (ctx.flags.show) return ctx.result(await a.post("/v1/search/run", { q }), "shown in the search pane");
      const r = await a.get("/v1/search", { q, limit: ctx.flags.limit }); ctx.result(r, r.map((x) => x.path).join("\n"), true);
    },
  },
  {
    name: "app graph", usage: "app graph [--unresolved]", spec: { ...A, unresolved: "bool" }, ru: "Данные графа (узлы и связи) из кэша приложения.", en: "Graph data (nodes and edges) from the app cache.",
    async run(ctx) { const g = await mk(ctx).get("/v1/graph", { unresolved: ctx.flags.unresolved }); ctx.result(g, `${g.nodes.length} nodes, ${g.edges.length} edges`, true); },
  },
  {
    name: "app eval", usage: "app eval <js> --yes", spec: { ...A, yes: "bool" },
    ru: "Выполнить JavaScript внутри приложения. По умолчанию ВЫКЛЮЧЕНО: сначала `basalt app settings eval on`. Нужен ключ --yes.",
    en: "Run JavaScript inside the app. OFF by default: first `basalt app settings eval on`. Needs --yes.",
    async run(ctx) {
      ctx.need(1, "code"); if (!ctx.flags.yes) throw new CliError("app eval runs code inside your app; add --yes to confirm", EXIT.REFUSED);
      const r = await mk(ctx).post("/v1/eval", {}, ctx.args.join(" ")); ctx.result(r, JSON.stringify(r.result, null, 2), true);
    },
  },
  {
    name: "app settings", usage: "app settings [eval on|off]", spec: A,
    ru: "Настройки API. `eval on|off` пишет флаг в basalt-api-settings.json в папке данных приложения (только локально).", en: "API settings. `eval on|off` writes the flag to basalt-api-settings.json in the app data folder (local only).",
    run(ctx) {
      const f = settingsPath(ctx.env); let j = {}; try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* none */ }
      if (ctx.args[0] === "eval") {
        if (!["on", "off"].includes(ctx.args[1])) throw usage("eval on|off");
        j.eval = ctx.args[1] === "on"; fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(j, null, 2));
      }
      ctx.result({ eval: !!j.eval, file: f }, `eval: ${j.eval ? "on" : "off"}  (${f})`, true);
    },
  },
  {
    name: "app events", usage: "app events [--type t] [--max N] [--timeout sec]", spec: { ...A, type: "list", max: "num", timeout: "num" },
    ru: "Поток событий приложения (файлы, вкладки, доски), по строке JSON на событие.\n  --type file-modify,board-change  фильтр\n  --max N / --timeout сек  остановиться",
    en: "Stream app events (files, tabs, boards), one JSON line per event.\n  --type file-modify,board-change  filter\n  --max N / --timeout sec  stop after",
    run(ctx) {
      return new Promise((resolve) => {
        let n = 0, h; const done = (code) => { h && h.close(); resolve(code); };
        h = mk(ctx).events((e) => { if (ctx.flags.type && !ctx.flags.type.includes(e.type)) return; ctx.print(JSON.stringify(e)); if (ctx.flags.max && ++n >= ctx.flags.max) done(0); }, (err) => done(err ? EXIT.APP : 0));
        if (ctx.flags.timeout) setTimeout(() => done(0), ctx.flags.timeout * 1000);
      });
    },
  },
  {
    name: "app request", usage: "app request <METHOD> <route> [--query k=v] [--body text|-]", spec: { ...A, query: "multi", body: "str" }, ru: "Произвольный запрос к API (для скриптов и отладки).", en: "Raw API request (for scripts and debugging).",
    async run(ctx) {
      ctx.need(2, "method and route"); const q = Object.fromEntries((ctx.flags.query || []).map((s) => s.split(/=(.*)/s).slice(0, 2)));
      const body = ctx.flags.body === "-" ? await ctx.stdin() : ctx.flags.body;
      const r = await mk(ctx).request(ctx.args[0].toUpperCase(), ctx.args[1], { query: q, body }); ctx.result(r, typeof r === "string" ? r : JSON.stringify(r, null, 2), true);
    },
  },
  {
    name: "app board list", usage: "app board list", spec: A, ru: "Доски, открытые сейчас в приложении.", en: "Boards open in the app right now.",
    async run(ctx) { const l = await mk(ctx).get("/v1/boards/open"); ctx.result(l, l.map((b) => `${b.path}  ${b.cards} cards, ${b.links} links`).join("\n"), true); },
  },
  {
    name: "app board show", usage: "app board show <board> [--open]", spec: B, ru: "Карточки и связи открытой доски (--open откроет её сам).", en: "Cards and links of an open board (--open opens it first).",
    async run(ctx) { ctx.need(1, "board"); const s = await mk(ctx).get("/v1/board", bq(ctx)); ctx.result(s, table(s.cards.map((c) => [c.id, c.x, c.y, c.w, c.h, c.color || "", title(c.text)]), ["id", "x", "y", "w", "h", "color", "title"]), true); },
  },
  {
    name: "app board card add", usage: "app board card add <board> [text] [--x --y --w --h --color --kind] [--open]", spec: { ...B, ...CARD }, ru: "Добавить карточку на открытую доску.", en: "Add a card to an open board.",
    async run(ctx) { ctx.need(1, "board"); const r = await mk(ctx).post("/v1/board/card", bq(ctx), { ...cardBody(ctx.flags), text: ctx.flags.text ?? ctx.args.slice(1).join(" ") }); ctx.result(r, "added card " + r.id); },
  },
  {
    name: "app board card edit", usage: "app board card edit <board> <id> [--text --x --y --w --h --color --kind] [--open]", spec: { ...B, ...CARD }, ru: "Изменить карточку открытой доски.", en: "Edit a card of an open board.",
    async run(ctx) { ctx.need(2, "board and id"); const r = await mk(ctx).request("PATCH", "/v1/board/card", { query: bq(ctx, { id: ctx.args[1] }), body: cardBody(ctx.flags) }); ctx.result(r, "edited " + r.id); },
  },
  {
    name: "app board card delete", usage: "app board card delete <board> <id> [--open]", spec: B, ru: "Удалить карточку открытой доски.", en: "Delete a card of an open board.",
    async run(ctx) { ctx.need(2, "board and id"); const r = await mk(ctx).request("DELETE", "/v1/board/card", { query: bq(ctx, { id: ctx.args[1] }) }); ctx.result(r, `deleted ${r.id}, ${r.linksRemoved} link(s)`); },
  },
  {
    name: "app board link add", usage: "app board link add <board> <from> <to> [--label L] [--open]", spec: { ...B, label: "str" }, ru: "Связать две карточки открытой доски.", en: "Link two cards of an open board.",
    async run(ctx) { ctx.need(3, "board, from, to"); const r = await mk(ctx).post("/v1/board/link", bq(ctx), { a: ctx.args[1], b: ctx.args[2], label: ctx.flags.label }); ctx.result(r, "linked " + r.id); },
  },
  {
    name: "app board link delete", usage: "app board link delete <board> <link-id> [--open]", spec: B, ru: "Удалить связь открытой доски.", en: "Delete a link of an open board.",
    async run(ctx) { ctx.need(2, "board and link id"); const r = await mk(ctx).request("DELETE", "/v1/board/link", { query: bq(ctx, { id: ctx.args[1] }) }); ctx.result(r, "deleted " + r.id); },
  },
  {
    name: "app board layout", usage: "app board layout <board> [auto|lr|td|radial|force] [--open]", spec: B, ru: "Раскладка карточек открытой доски средствами приложения.", en: "Arrange the cards of an open board with the app's own layouts.",
    async run(ctx) { ctx.need(1, "board"); const r = await mk(ctx).post("/v1/board/layout", bq(ctx, { mode: ctx.args[1] || "auto" })); ctx.result(r, "layout " + r.mode); },
  },
]);
