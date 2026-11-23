// Board commands: .board files edited directly through Yjs. If the app has the same board open, use `basalt app board ...` instead
// (the app keeps its own copy in memory and would overwrite a file changed behind its back).
import fs from "node:fs";
import path from "node:path";
import { register } from "../lib/cli.mjs";
import { EXIT, CliError, usage, notFound, table, dim, cyan, green, red, yellow, posix } from "../lib/util.mjs";
import { Vault } from "../lib/vault.mjs";
import { emit } from "../lib/events.mjs";
import * as B from "../lib/board.mjs";

const SNAP = { snapshot: "bool" };
const vaultOrNull = (ctx) => { try { return ctx.vault; } catch { return null; } };
const withBoardExt = (p) => (/\.board$/i.test(p) ? p : p + ".board");

/** Find a board file by what the user typed. Returns {abs, rel, vault}; with create, a missing file gets a target path. */
function locate(ctx, input, { create = false } = {}) {
  if (!input) throw usage("a board is required");
  const vault = vaultOrNull(ctx); let abs = null, rel = null;
  if (vault) for (const c of [input, withBoardExt(input)]) { try { rel = vault.resolve(c, { exts: ["board"] }); abs = vault.abs(rel); break; } catch { /* next */ } }
  if (!abs) { const hit = [input, withBoardExt(input)].map((p) => path.resolve(p)).find((p) => fs.existsSync(p) && fs.statSync(p).isFile()); if (hit) { abs = hit; rel = vault && hit.startsWith(vault.root + path.sep) ? posix(path.relative(vault.root, hit)) : null; } }
  if (!abs && create) { if (vault && !path.isAbsolute(input) && !/^\.\.?[\\/]/.test(input)) { rel = withBoardExt(posix(input).replace(/^\/+/, "")); abs = vault.abs(rel); } else { abs = path.resolve(withBoardExt(input)); rel = vault && abs.startsWith(vault.root + path.sep) ? posix(path.relative(vault.root, abs)) : null; } }
  if (!abs) throw notFound(`board not found: ${input}`);
  return { abs, rel, vault };
}
const fire = async (ctx, loc) => { if (loc.vault && loc.rel) { const r = await emit(loc.vault, "board-change", { file: loc.rel }, { noHooks: ctx.flags["no-hooks"] }); if (r.hook && (r.hook.status || r.hook.error)) ctx.info(yellow("hook on-board-change failed")); } };
/** load, change, save, announce */
async function mutate(ctx, input, fn, opts = {}) {
  const loc = locate(ctx, input, opts), existed = fs.existsSync(loc.abs);
  const board = existed ? B.Board.load(loc.abs) : B.Board.create();
  if (ctx.flags.snapshot && existed && loc.vault && loc.rel) B.writeSnapshot(loc.vault.root, loc.rel, board);
  const res = await fn(board, loc); board.save(loc.abs); await fire(ctx, loc);
  return { res, loc, board };
}
const read = (ctx, input) => { const loc = locate(ctx, input); return { loc, board: B.Board.load(loc.abs) }; };
const num = (v) => (v === undefined ? undefined : Number(v));
const patchOf = (f) => ({ text: f.text, x: f.x, y: f.y, w: f.w, h: f.h, color: f.color, kind: f.kind, fold: f.fold, locked: f.lock });
const CARD_SPEC = { text: "str", x: "num", y: "num", w: "num", h: "num", color: "str", kind: "str", id: "str", stdin: "bool", ...SNAP };
const cardLine = (c) => [c.id, c.x, c.y, c.w, c.h, c.color || "", c.kind || "", B.title(c.text)];

register([
  {
    name: "board list", usage: "board list", ru: "Все доски хранилища: карточки, связи, размер.", en: "All boards in the vault: cards, links, size.",
    run(ctx) {
      const rows = ctx.vault.files().filter((f) => f.ext === "board").map((f) => { let cards = null, links = null; try { const b = B.Board.load(ctx.vault.abs(f.path)); cards = b.yn.size; links = b.ye.size; } catch { /* damaged */ } return { path: f.path, cards, links, size: f.size, mtime: new Date(f.mtime).toISOString() }; });
      ctx.result(rows, table(rows.map((r) => [r.path, r.cards ?? "?", r.links ?? "?", r.size, r.mtime.slice(0, 16).replace("T", " ")]), ["board", "cards", "links", "bytes", "modified"]), true);
    },
  },
  {
    name: "board new", usage: "board new <path>", spec: { force: "bool" }, ru: "Создать пустую доску.", en: "Create an empty board.",
    async run(ctx) { ctx.need(1, "path"); const loc = locate(ctx, ctx.args[0], { create: true }); if (fs.existsSync(loc.abs) && !ctx.flags.force) throw new CliError(`already exists: ${loc.rel || loc.abs}`, EXIT.ERROR); B.Board.create().save(loc.abs); await fire(ctx, loc); ctx.result({ path: loc.rel || loc.abs }, `created ${loc.rel || loc.abs}`); },
  },
  {
    name: "board show", usage: "board show <board>", ru: "Карточки и связи доски.", en: "Cards and links of a board.",
    run(ctx) {
      ctx.need(1, "board"); const { loc, board } = read(ctx, ctx.args[0]), cards = board.cards().sort((a, b) => a.y - b.y || a.x - b.x), links = board.links(), T = new Map(cards.map((c) => [c.id, B.title(c.text)]));
      const data = { path: loc.rel || loc.abs, id: board.ym.get("id"), cards, links };
      ctx.result(data, [`${green(data.path)}  ${cards.length} cards, ${links.length} links`, "", table(cards.map(cardLine), ["id", "x", "y", "w", "h", "color", "kind", "title"]), "", ...(links.length ? [table(links.map((e) => [e.id, `${e.a} (${T.get(e.a) ?? "?"})`, `${e.b} (${T.get(e.b) ?? "?"})`, e.label || ""]), ["link", "from", "to", "label"])] : [])].join("\n"), true);
    },
  },
  {
    name: "board export", usage: "board export <board> [--format json|markdown|csv|mermaid|dot|svg|png-data-only] [--out file] [--edges] [--images] [--ink]",
    spec: { format: "str", out: "str", edges: "bool", images: "bool", ink: "bool" },
    ru: "Экспорт доски.\n  --format json (по умолчанию) | markdown | csv | mermaid | dot | svg | png-data-only\n  --out <файл>  куда записать (иначе в stdout); для png-data-only это папка\n  --edges       csv: выгрузить связи вместо карточек\n  --images      json: вставить картинки карточек (data:)\n  --ink         json: добавить рисунки от руки\npng-data-only сохраняет встроенные в карточки картинки как отдельные файлы.",
    en: "Export a board.\n  --format json (default) | markdown | csv | mermaid | dot | svg | png-data-only\n  --out <file>  where to write (else stdout); a folder for png-data-only\n  --edges       csv: export links instead of cards\n  --images      json: include card pictures (data:)\n  --ink         json: include hand drawings\npng-data-only writes the pictures embedded in cards as separate files.",
    run(ctx) {
      ctx.need(1, "board"); const { loc, board } = read(ctx, ctx.args[0]), fmt = (ctx.flags.format || "json").toLowerCase(), name = path.basename(loc.abs).replace(/\.board$/i, "");
      if (fmt === "png-data-only") { if (!ctx.flags.out) throw usage("png-data-only needs --out <folder>"); const files = B.exportImages(board, ctx.flags.out); return ctx.result({ files }, `${files.length} image(s) written to ${ctx.flags.out}`); }
      const text = B.exportBoard(board, fmt, { name, edges: ctx.flags.edges, images: ctx.flags.images, ink: ctx.flags.ink });
      if (ctx.flags.out) { fs.mkdirSync(path.dirname(path.resolve(ctx.flags.out)), { recursive: true }); fs.writeFileSync(ctx.flags.out, text); return ctx.result({ out: ctx.flags.out, bytes: Buffer.byteLength(text) }, `wrote ${ctx.flags.out}`); }
      if (ctx.json && fmt !== "json") return ctx.result({ format: fmt, content: text });
      process.stdout.write(text);
    },
  },
  {
    name: "board import", usage: "board import <board> [--from-json file] [--cards file.csv] [--edges file.csv] [--create] [--replace]", spec: { "from-json": "str", cards: "str", edges: "str", create: "bool", replace: "bool", ...SNAP },
    ru: "Импорт в доску (файл «-» — стандартный ввод).\n  --from-json  файл в формате board export --format json\n  --cards CSV: заголовок id,text|title,body,x,y,w,h,color,kind (лишние столбцы попадут в текст); без x,y карточки встают сеткой справа\n  --edges CSV «from,to[,label]» — карточки по id или по тексту\n  --create создать доску, если её нет;  --replace сначала очистить доску",
    en: "Import into a board (file \"-\" is stdin).\n  --from-json  a file in the board export --format json shape\n  --cards CSV with header id,text|title,body,x,y,w,h,color,kind (other columns go into the text); cards without x,y are laid out in a grid to the right\n  --edges CSV \"from,to[,label]\" — cards by id or by text\n  --create create the board if missing;  --replace clear the board first",
    async run(ctx) {
      ctx.need(1, "board"); const f = ctx.flags; if (!f["from-json"] && !f.cards && !f.edges) throw usage("give --from-json, --cards or --edges");
      const rd = async (p) => (p === "-" ? await ctx.stdin() : fs.readFileSync(p, "utf8"));
      if (!f.create && !fs.existsSync(locate(ctx, ctx.args[0], { create: true }).abs)) throw notFound(`board not found: ${ctx.args[0]} (use --create)`);
      const { res } = await mutate(ctx, ctx.args[0], async (board) => {
        let added = 0, linked = 0;
        if (f.replace) board.restore({ nodes: [], edges: [] });
        if (f["from-json"]) { const d = JSON.parse(await rd(f["from-json"])); added += B.importJson(board, d, { keepIds: true }).length; linked += (d.links || d.edges || []).length; }
        if (f.cards) {
          const cs = B.cardsFromCsv(await rd(f.cards)), bb = board.bounds(), need = cs.filter((c) => c.x == null || c.y == null);
          if (need.length) { const g = B.layoutGrid(need.map((c, i) => ({ id: String(i), x: bb ? bb.right + 80 : 0, y: bb ? bb.y : 0, w: c.w || 260, h: c.h || 110 }))); need.forEach((c, i) => { c.x = g.get(String(i)).x; c.y = g.get(String(i)).y; }); }
          board.doc.transact(() => { for (const c of cs) { if (c.id && board.yn.has(c.id)) c.id = undefined; board.addCard(c); added++; } });
        }
        if (f.edges) { const ls = B.linksFromCsv(await rd(f.edges), board); board.doc.transact(() => { for (const l of ls) board.addEdge(l.a, l.b, l); }); linked += ls.length; }
        return { cards: added, links: linked, total: board.yn.size };
      }, { create: true });
      ctx.result(res, `imported ${res.cards} card(s), ${res.links} link(s); board now has ${res.total} cards`);
    },
  },
  {
    name: "board card add", usage: "board card add <board> [text...] [--x N --y N --w N --h N --color red --kind K --id ID --stdin]", spec: CARD_SPEC,
    ru: "Добавить карточку. Текст — аргументами, --text или (--stdin) со стандартного ввода. Без --x/--y карточка встаёт справа от остальных.\nЦвета: red orange yellow green blue purple none или #rrggbb. --snapshot сохранит версию доски перед изменением.",
    en: "Add a card. Text as arguments, --text or (--stdin) from stdin. Without --x/--y the card goes to the right of the others.\nColours: red orange yellow green blue purple none or #rrggbb. --snapshot saves a history version before the change.",
    async run(ctx) {
      ctx.need(1, "board"); const f = ctx.flags; const text = f.text ?? (f.stdin ? await ctx.stdin() : ctx.args.slice(1).join(" "));
      const { res } = await mutate(ctx, ctx.args[0], (b) => { if (f.id && b.yn.has(f.id)) throw new CliError(`card id exists: ${f.id}`, EXIT.ERROR); const id = b.addCard({ id: f.id, text, x: f.x, y: f.y, w: f.w, h: f.h, color: f.color, kind: f.kind }); return { id, ...b.cards().find((c) => c.id === id) }; });
      ctx.result(res, `added card ${res.id}`);
    },
  },
  {
    name: "board card edit", usage: "board card edit <board> <id> [--text T] [--x N --y N --w N --h N --color C --kind K --fold|--no-fold --lock|--no-lock]", spec: { ...CARD_SPEC, fold: "bool", lock: "bool" },
    ru: "Изменить карточку (id или его начало). Текст правится минимальной заменой, поэтому одновременные правки в приложении не теряются.", en: "Edit a card (id or its beginning). Text is changed by a minimal edit so simultaneous edits in the app are not lost.",
    async run(ctx) { ctx.need(2, "board and card id"); const { res } = await mutate(ctx, ctx.args[0], async (b) => { const id = b.id(ctx.args[1]); b.editCard(id, { ...patchOf(ctx.flags), text: ctx.flags.stdin ? await ctx.stdin() : ctx.flags.text }); return id; }); ctx.result({ id: res }, `edited card ${res}`); },
  },
  {
    name: "board card move", usage: "board card move <board> <id> <x> <y> | --dx N --dy N", spec: { dx: "num", dy: "num", ...SNAP },
    ru: "Переместить карточку в точку x y или сдвинуть на --dx/--dy.", en: "Move a card to x y or shift it by --dx/--dy.",
    async run(ctx) {
      ctx.need(2, "board and card id"); const f = ctx.flags;
      const { res } = await mutate(ctx, ctx.args[0], (b) => { const id = b.id(ctx.args[1]), c = b.cards().find((k) => k.id === id); let x, y; if (f.dx != null || f.dy != null) { x = c.x + (f.dx || 0); y = c.y + (f.dy || 0); } else { ctx.need(4, "x and y"); x = Number(ctx.args[2]); y = Number(ctx.args[3]); if ([x, y].some(Number.isNaN)) throw usage("x and y must be numbers"); } b.editCard(id, { x, y }); return { id, x, y }; });
      ctx.result(res, `moved ${res.id} to ${res.x},${res.y}`);
    },
  },
  {
    name: "board card delete", usage: "board card delete <board> <id...>", spec: SNAP, ru: "Удалить карточки вместе с их связями.", en: "Delete cards together with their links.",
    async run(ctx) { ctx.need(2, "board and card id"); const { res } = await mutate(ctx, ctx.args[0], (b) => { let links = 0; const ids = ctx.args.slice(1).map((i) => b.id(i)); for (const id of ids) links += b.deleteCard(id); return { deleted: ids, linksRemoved: links }; }); ctx.result(res, `deleted ${res.deleted.length} card(s), ${res.linksRemoved} link(s)`); },
  },
  {
    name: "board card color", usage: "board card color <board> <id> <color>", spec: SNAP, ru: "Цвет карточки: red orange yellow green blue purple none #rrggbb.", en: "Card colour: red orange yellow green blue purple none #rrggbb.",
    async run(ctx) { ctx.need(3, "board, card id and colour"); const { res } = await mutate(ctx, ctx.args[0], (b) => { const id = b.id(ctx.args[1]); b.editCard(id, { color: ctx.args[2] }); return { id, color: B.colorOf(ctx.args[2]) }; }); ctx.result(res, `${res.id}: colour ${res.color || "none"}`); },
  },
  {
    name: "board card kind", usage: "board card kind <board> <id> <kind>", spec: SNAP, ru: "Тип (вид) карточки; пустая строка сбрасывает.", en: "Card kind; an empty string clears it.",
    async run(ctx) { ctx.need(3, "board, card id and kind"); const { res } = await mutate(ctx, ctx.args[0], (b) => { const id = b.id(ctx.args[1]); b.editCard(id, { kind: ctx.args[2] }); return { id, kind: ctx.args[2] }; }); ctx.result(res, `${res.id}: kind "${res.kind}"`); },
  },
  {
    name: "board link add", usage: "board link add <board> <from> <to> [--label L] [--sa t|r|b|l] [--sb t|r|b|l]", spec: { label: "str", sa: "str", sb: "str", ...SNAP },
    ru: "Связать две карточки стрелкой от from к to.", en: "Join two cards with an arrow from from to to.",
    async run(ctx) { ctx.need(3, "board, from and to"); const { res } = await mutate(ctx, ctx.args[0], (b) => { const a = b.id(ctx.args[1]), c = b.id(ctx.args[2]); return { id: b.addEdge(a, c, { label: ctx.flags.label, sa: ctx.flags.sa, sb: ctx.flags.sb }), a, b: c }; }); ctx.result(res, `linked ${res.a} -> ${res.b} (${res.id})`); },
  },
  {
    name: "board link delete", usage: "board link delete <board> <link-id> | <from> <to>", spec: SNAP, ru: "Удалить связь по её id или по паре карточек.", en: "Delete a link by id or by the pair of cards.",
    async run(ctx) {
      ctx.need(2, "board and link"); const { res } = await mutate(ctx, ctx.args[0], (b) => {
        if (ctx.args.length >= 3) { const a = b.id(ctx.args[1]), c = b.id(ctx.args[2]), ids = b.links().filter((e) => e.a === a && e.b === c).map((e) => e.id); if (!ids.length) throw notFound(`no link ${a} -> ${c}`); b.doc.transact(() => ids.forEach((i) => b.deleteEdge(i))); return { deleted: ids }; }
        const id = b.linkId(ctx.args[1]); b.deleteEdge(id); return { deleted: [id] };
      });
      ctx.result(res, `deleted ${res.deleted.length} link(s)`);
    },
  },
  {
    name: "board layout", usage: "board layout <board> <grid|tree|force> [--dir lr|td] [--cols N] [--gap N] [--root id] [--iterations N]", spec: { dir: "str", cols: "num", gap: "num", root: "str", iterations: "num", ...SNAP },
    ru: "Расставить карточки без приложения.\n  grid  сетка (--cols, --gap)\n  tree  дерево по связям (--dir lr слева направо | td сверху вниз, --root id)\n  force силовая раскладка (--iterations)\nЗаблокированные карточки и рамки не двигаются.", en: "Arrange cards without the app.\n  grid  a grid (--cols, --gap)\n  tree  tree along the links (--dir lr left to right | td top down, --root id)\n  force force-directed (--iterations)\nLocked cards and frames stay put.",
    async run(ctx) {
      ctx.need(2, "board and layout"); const f = ctx.flags;
      const { res } = await mutate(ctx, ctx.args[0], (b) => ({ moved: B.applyLayout(b, ctx.args[1], { dir: f.dir, cols: f.cols, gap: f.gap, root: f.root && b.id(f.root), iterations: f.iterations }) }));
      ctx.result({ layout: ctx.args[1], ...res }, `${ctx.args[1]} layout: ${res.moved} card(s) placed`);
    },
  },
  {
    name: "board from-canvas", usage: "board from-canvas <file.canvas> [--out path.board] [--force]", spec: { out: "str", force: "bool" },
    ru: "Превратить .canvas (Obsidian) в доску: текст, ссылки, файлы-картинки, группы, цвета и стрелки.", en: "Convert an Obsidian .canvas into a board: text, links, image files, groups, colours and arrows.",
    async run(ctx) {
      ctx.need(1, "canvas file"); const vault = vaultOrNull(ctx); let src = path.resolve(ctx.args[0]);
      if (!fs.existsSync(src) && vault) src = vault.abs(vault.resolve(ctx.args[0], { exts: ["canvas"] }));
      if (!fs.existsSync(src)) throw notFound(`canvas not found: ${ctx.args[0]}`);
      const j = JSON.parse(fs.readFileSync(src, "utf8")), base = vault && src.startsWith(vault.root + path.sep) ? vault.root : path.dirname(src);
      const data = B.canvasToData(j, (rel) => { for (const p of [path.join(base, rel), path.join(path.dirname(src), rel)]) if (fs.existsSync(p)) return fs.readFileSync(p); return null; });
      const out = path.resolve(ctx.flags.out || src.replace(/\.canvas$/i, "") + ".board");
      if (fs.existsSync(out) && !ctx.flags.force) throw new CliError(`already exists: ${out} (use --force)`, EXIT.ERROR);
      const b = B.Board.create(); B.importJson(b, data, { keepIds: true }); b.save(out);
      if (vault && out.startsWith(vault.root + path.sep)) await emit(vault, "create", { file: posix(path.relative(vault.root, out)) }, { noHooks: ctx.flags["no-hooks"] });
      ctx.result({ out, cards: data.cards.length, links: data.links.length }, `${out}: ${data.cards.length} card(s), ${data.links.length} link(s)`);
    },
  },
  {
    name: "board merge", usage: "board merge <target> <source...> [--out file]", spec: { out: "str", ...SNAP },
    ru: "Слить доски через Yjs: карточки и связи источников добавляются в целевую (правки одной и той же доски объединяются, чужие доски складываются). Источники не меняются.", en: "Merge boards through Yjs: cards and links of the sources are added to the target (edits of the same board combine, unrelated boards are unioned). Sources are not changed.",
    async run(ctx) {
      ctx.need(2, "target and at least one source"); const srcs = ctx.args.slice(1).map((s) => B.Board.load(locate(ctx, s).abs));
      const { res, loc } = await mutate(ctx, ctx.args[0], (b) => { const before = b.yn.size; for (const s of srcs) b.merge(s); return { cards: b.yn.size, links: b.ye.size, added: b.yn.size - before }; });
      if (ctx.flags.out) { const t = B.Board.load(loc.abs); t.save(path.resolve(ctx.flags.out)); }
      ctx.result(res, `merged: ${res.cards} cards, ${res.links} links (${res.added} new)`);
    },
  },
  {
    name: "board diff", usage: "board diff <A> [B]   (A and B: board path or path@snapshot, snapshot = id, -1, latest)",
    ru: "Сравнить две доски или две версии из .basalt-history. С одним аргументом — текущая доска против последней версии.\nПримеры: board diff a.board b.board;  board diff plan.board@-2 plan.board;  board diff plan.board\nКод выхода 0, если различий нет, и 4, если есть.", en: "Compare two boards or two versions from .basalt-history. With one argument: current board against its latest version.\nExamples: board diff a.board b.board;  board diff plan.board@-2 plan.board;  board diff plan.board\nExit code 0 when equal, 4 when different.",
    run(ctx) {
      ctx.need(1, "board"); const load = (s, forceRef) => {
        const m = /^(.*)@(latest|-?\d+)$/.exec(s), p = m ? m[1] : s, loc = locate(ctx, p);
        if (m || forceRef) { if (!loc.rel || !loc.vault) throw usage("history needs a board inside a vault"); return { label: `${loc.rel}@${(m && m[2]) || "latest"}`, n: B.normSnapshot(B.readSnapshot(loc.vault.root, loc.rel, (m && m[2]) || "latest").data) }; }
        return { label: loc.rel || loc.abs, n: B.normBoard(B.Board.load(loc.abs)) };
      };
      const a = ctx.args[1] ? load(ctx.args[0]) : load(ctx.args[0] + "@latest"), b = ctx.args[1] ? load(ctx.args[1]) : load(ctx.args[0]);
      const d = B.diffBoards(a.n, b.n), L = [`${a.label}  ->  ${b.label}`];
      for (const c of d.cards.added) L.push(green(`+ card ${c.id}  ${c.title}`)); for (const c of d.cards.removed) L.push(red(`- card ${c.id}  ${c.title}`));
      for (const c of d.cards.changed) L.push(yellow(`~ card ${c.id}  ${c.title}: `) + Object.entries(c.fields).map(([k, [o, n]]) => k === "text" ? "text" : `${k} ${JSON.stringify(o)}->${JSON.stringify(n)}`).join(", "));
      for (const e of d.links.added) L.push(green(`+ link ${e.a} -> ${e.b}${e.label ? " (" + e.label + ")" : ""}`)); for (const e of d.links.removed) L.push(red(`- link ${e.a} -> ${e.b}${e.label ? " (" + e.label + ")" : ""}`));
      if (d.same) L.push(green("no differences"));
      ctx.result({ a: a.label, b: b.label, ...d }, L.join("\n"), true); return d.same ? EXIT.OK : EXIT.CHECK_FAILED;
    },
  },
  {
    name: "board history list", usage: "board history list <board>", ru: "Версии доски из .basalt-history (приложение сохраняет их само).", en: "Versions of a board from .basalt-history (the app saves them itself).",
    run(ctx) { ctx.need(1, "board"); const loc = locate(ctx, ctx.args[0]); if (!loc.rel || !loc.vault) throw usage("history needs a board inside a vault"); const l = B.listHistory(loc.vault.root, loc.rel); ctx.result(l, l.length ? table(l.map((s) => [s.id, s.index, s.time.slice(0, 19).replace("T", " "), s.cards ?? "?", s.links ?? "?", s.size]), ["id", "index", "time (UTC)", "cards", "links", "bytes"]) : "no versions", true); },
  },
  {
    name: "board history snapshot", usage: "board history snapshot <board>", ru: "Сохранить текущее состояние как версию (хранятся последние 40).", en: "Save the current state as a version (the last 40 are kept).",
    run(ctx) { ctx.need(1, "board"); const { loc, board } = read(ctx, ctx.args[0]); if (!loc.rel || !loc.vault) throw usage("history needs a board inside a vault"); const id = B.writeSnapshot(loc.vault.root, loc.rel, board); ctx.result({ id }, `snapshot ${id}`); },
  },
  {
    name: "board history restore", usage: "board history restore <board> <id|-1|latest> [--as new.board]", spec: { as: "str" },
    ru: "Восстановить версию. Перед этим текущее состояние сохраняется как новая версия, так что откат обратим.\n  --as <путь>  не трогать доску, а сохранить версию копией", en: "Restore a version. The current state is saved as a new version first, so the restore can be undone.\n  --as <path>  leave the board alone and save the version as a copy",
    async run(ctx) {
      ctx.need(2, "board and version"); const loc = locate(ctx, ctx.args[0]); if (!loc.rel || !loc.vault) throw usage("history needs a board inside a vault");
      const snap = B.readSnapshot(loc.vault.root, loc.rel, ctx.args[1]);
      if (ctx.flags.as) { const nb = B.Board.create(); nb.restore(snap.data); const to = locate(ctx, ctx.flags.as, { create: true }); nb.save(to.abs); await fire(ctx, to); return ctx.result({ restored: snap.id, copy: to.rel || to.abs }, `version ${snap.id} saved as ${to.rel || to.abs}`); }
      const board = B.Board.load(loc.abs); B.writeSnapshot(loc.vault.root, loc.rel, board); board.restore(snap.data); board.save(loc.abs); await fire(ctx, loc);
      ctx.result({ restored: snap.id, cards: snap.data.nodes.length }, `restored version ${snap.id} (${snap.data.nodes.length} cards); the previous state was saved as a version`);
    },
  },
]);
