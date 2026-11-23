// Vault commands: work directly on the folder, no app needed.
import fs from "node:fs";
import path from "node:path";
import { register } from "../lib/cli.mjs";
import { EXIT, CliError, usage, notFound, parseWhen, formatDate, table, dim, cyan, green, yellow, red, posix } from "../lib/util.mjs";
import { splitFrontmatter, getProperties, setProperty, parseCliValue } from "../lib/md.mjs";
import { emit } from "../lib/events.mjs";

const EXT = (p) => (/\.([^./]+)$/.exec(p) || [])[1]?.toLowerCase() || "";
const DIR = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const fmtSize = (n) => (n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB");
/** run hooks/webhooks for an event; problems are only warnings */
async function fire(ctx, event, data) {
  const r = await emit(ctx.vault, event, data, { noHooks: ctx.flags["no-hooks"] });
  if (r.hook && (r.hook.status || r.hook.error)) ctx.info(yellow(`hook on-${event} failed: ${r.hook.error || "exit " + r.hook.status}`));
  for (const w of r.webhooks) if (!w.ok) ctx.info(yellow(`webhook ${w.url} failed: ${w.error || w.status}`));
}
const withExt = (p) => (EXT(p) ? p : p + ".md");

/** find an existing note or board by what the user typed */
const note = (ctx, input) => ctx.vault.resolve(input);

register([
  {
    name: "vault info", usage: "vault info",
    ru: "Сведения о хранилище: папка, число заметок, настройки.\nРаботает без запущенного приложения.", en: "Vault facts: folder, note count, config.\nWorks without the app running.",
    run(ctx) { const i = ctx.vault.info(); ctx.result(i, `${green(i.name)}\n  folder:  ${i.root}\n  config:  ${i.config || "(none)"}\n  notes:   ${i.notes}\n  files:   ${i.files}\n  trash:   ${i.trash ? ".trash" : "(empty)"}`, true); },
  },
  {
    name: "files list", usage: "files list [--ext md,board] [--folder dir] [--modified-since 7d] [--modified-before date] [--tag t] [--sort name|mtime|size] [--limit N] [--long]",
    spec: { ext: "list", folder: "str", "modified-since": "str", "modified-before": "str", tag: "str", sort: "str", limit: "num", long: "bool", reverse: "bool" },
    ru: "Список файлов хранилища.\n  --ext md,board      только эти расширения\n  --folder <папка>    только внутри папки\n  --modified-since    изменённые после даты (2026-01-31, 7d, 12h)\n  --modified-before   изменённые до даты\n  --tag <тег>         только заметки с тегом\n  --sort name|mtime|size, --reverse, --limit N, --long (размер и дата)",
    en: "List vault files.\n  --ext md,board      only these extensions\n  --folder <dir>      only inside the folder\n  --modified-since    changed after a date (2026-01-31, 7d, 12h)\n  --modified-before   changed before a date\n  --tag <tag>         only notes with the tag\n  --sort name|mtime|size, --reverse, --limit N, --long (size and date)",
    run(ctx) {
      const f = ctx.flags, v = ctx.vault, since = f["modified-since"] && parseWhen(f["modified-since"]), before = f["modified-before"] && parseWhen(f["modified-before"]);
      const folder = f.folder ? posix(f.folder).replace(/^\/+|\/+$/g, "") + "/" : "";
      let list = v.files().filter((x) => (!f.ext || f.ext.map((e) => e.replace(/^\./, "").toLowerCase()).includes(x.ext)) && (!folder || x.path.startsWith(folder))
        && (!since || x.mtime >= since.getTime()) && (!before || x.mtime < before.getTime()) && (!f.tag || (x.ext === "md" && v.hasTag(x.path, f.tag))));
      const key = { name: (a, b) => (a.path < b.path ? -1 : 1), mtime: (a, b) => b.mtime - a.mtime, size: (a, b) => b.size - a.size }[f.sort || "name"];
      if (!key) throw usage("--sort is name, mtime or size");
      list = [...list].sort(key); if (f.reverse) list.reverse(); if (f.limit) list = list.slice(0, f.limit);
      const data = list.map((x) => ({ path: x.path, size: x.size, mtime: new Date(x.mtime).toISOString() }));
      ctx.result(data, f.long ? data.map((x) => `${String(fmtSize(x.size)).padStart(9)}  ${x.mtime.slice(0, 16).replace("T", " ")}  ${x.path}`).join("\n") : data.map((x) => x.path).join("\n"), true);
    },
  },
  {
    name: "files tree", usage: "files tree [folder] [--depth N] [--ext md]", spec: { depth: "num", ext: "list" },
    ru: "Дерево папок и файлов.\n  --depth N  глубина\n  --ext md   только эти расширения", en: "Folder and file tree.\n  --depth N  depth limit\n  --ext md   only these extensions",
    run(ctx) {
      const root = { dirs: {}, files: [] }, base = ctx.args[0] ? posix(ctx.args[0]).replace(/^\/+|\/+$/g, "") + "/" : "", ext = ctx.flags.ext?.map((e) => e.replace(/^\./, ""));
      for (const x of ctx.vault.files()) {
        if (base && !x.path.startsWith(base)) continue; if (ext && !ext.includes(x.ext)) continue;
        const parts = x.path.slice(base.length).split("/"); let n = root; for (const d of parts.slice(0, -1)) n = n.dirs[d] ||= { dirs: {}, files: [] }; n.files.push(parts.at(-1));
      }
      const lines = [], max = ctx.flags.depth || 99;
      const walk = (n, pre, d) => { const names = [...Object.keys(n.dirs).sort().map((k) => [k, true]), ...n.files.sort().map((k) => [k, false])];
        names.forEach(([k, isDir], i) => { const last = i === names.length - 1; lines.push(pre + (last ? "└─ " : "├─ ") + (isDir ? cyan(k + "/") : k)); if (isDir && d < max) walk(n.dirs[k], pre + (last ? "   " : "│  "), d + 1); }); };
      walk(root, "", 1);
      const jsonTree = (n, d) => ({ ...Object.fromEntries(Object.entries(n.dirs).map(([k, c]) => [k + "/", d < max ? jsonTree(c, d + 1) : "..."])), ...Object.fromEntries(n.files.map((f) => [f, null])) });
      ctx.result(jsonTree(root, 1), lines.join("\n"), true);
    },
  },
  {
    name: "read", usage: "read <note> [--body] [--frontmatter] [--lines 10-20]", spec: { body: "bool", frontmatter: "bool", lines: "str" },
    ru: "Вывести содержимое заметки (путь или имя, как в [[ссылке]]).\n  --body         без блока свойств\n  --frontmatter  только блок свойств\n  --lines 10-20  диапазон строк", en: "Print a note (path or name as in a [[link]]).\n  --body         without the properties block\n  --frontmatter  only the properties block\n  --lines 10-20  line range",
    run(ctx) {
      ctx.need(1, "note"); const p = note(ctx, ctx.args[0]); let t = ctx.vault.read(p); const { fm, body } = splitFrontmatter(t);
      if (ctx.flags.frontmatter) t = fm ?? ""; else if (ctx.flags.body) t = body;
      if (ctx.flags.lines) { const m = /^(\d+)(?:-(\d+))?$/.exec(ctx.flags.lines); if (!m) throw usage("--lines is N or N-M"); const ls = t.split("\n"); t = ls.slice(+m[1] - 1, +(m[2] || m[1])).join("\n"); }
      ctx.result({ path: p, content: t }, t, true);
    },
  },
  {
    name: "write", usage: "write <path> [--text \"...\"] [--append|--prepend] [--no-overwrite]", spec: { text: "str", append: "bool", prepend: "bool", "no-overwrite": "bool" },
    ru: "Записать заметку. Текст из --text или со стандартного ввода. Папки создаются сами, .md добавляется если нет расширения.\n  --append       дописать в конец\n  --prepend      вставить в начало (после блока свойств)\n  --no-overwrite не трогать существующий файл (код 1)",
    en: "Write a note. Text from --text or stdin. Folders are created, .md is added when there is no extension.\n  --append       add at the end\n  --prepend      insert at the start (after the properties block)\n  --no-overwrite fail if the file exists (code 1)",
    async run(ctx) {
      ctx.need(1, "path"); const v = ctx.vault; let text = ctx.flags.text ?? (await ctx.stdin());
      let p; try { p = v.resolve(ctx.args[0]); } catch { p = withExt(posix(ctx.args[0]).replace(/^\/+/, "")); }
      const exists = v.exists(p);
      if (exists && ctx.flags["no-overwrite"]) throw new CliError(`already exists: ${p}`, EXIT.ERROR);
      let out = text;
      if (exists && ctx.flags.append) { const old = v.read(p); out = old + (old && !old.endsWith("\n") ? "\n" : "") + text; }
      else if (exists && ctx.flags.prepend) { const old = v.read(p), { end } = splitFrontmatter(old); out = old.slice(0, end) + text + (text.endsWith("\n") ? "" : "\n") + old.slice(end); }
      v.write(p, out);
      await fire(ctx, exists ? "save" : "create", { file: p });
      ctx.result({ path: p, created: !exists, bytes: Buffer.byteLength(out) }, `${exists ? "updated" : "created"} ${p}`);
    },
  },
  {
    name: "create", usage: "create <path> [--template name] [--title t] [--text \"...\"] [--force]", spec: { template: "str", title: "str", text: "str", force: "bool" },
    ru: "Создать заметку, по желанию из шаблона. В шаблоне работают {{title}}, {{date}}, {{time}}, {{date:YYYY-MM-DD}}.\n  --template <имя|путь>  файл шаблона (по умолчанию ищется в папке шаблонов)\n  --title <текст>        заголовок (по умолчанию имя файла)\n  --force                перезаписать, если есть",
    en: "Create a note, optionally from a template. Templates may use {{title}}, {{date}}, {{time}}, {{date:YYYY-MM-DD}}.\n  --template <name|path>  template file (looked up in the templates folder)\n  --title <text>          title (defaults to the file name)\n  --force                 overwrite if it exists",
    async run(ctx) {
      ctx.need(1, "path"); const v = ctx.vault, p = withExt(posix(ctx.args[0]).replace(/^\/+/, ""));
      if (v.exists(p) && !ctx.flags.force) throw new CliError(`already exists: ${p}`, EXIT.ERROR);
      const title = ctx.flags.title || path.posix.basename(p).replace(/\.[^.]+$/, ""), now = new Date();
      let body = ctx.flags.text ?? "";
      if (ctx.flags.template) {
        const folder = (v.config("templates.json", {}).folder || "Templates").replace(/\/+$/, "");
        let tp; for (const c of [ctx.flags.template, folder + "/" + ctx.flags.template]) { try { tp = v.resolve(c); break; } catch { /* next */ } }
        if (!tp) throw notFound(`template not found: ${ctx.flags.template}`);
        body = v.read(tp);
      }
      body = body.replace(/\{\{\s*title\s*\}\}/g, () => title).replace(/\{\{\s*(date|time)(?::([^}]*))?\s*\}\}/g, (_, k, f) => formatDate(now, (f || (k === "date" ? "YYYY-MM-DD" : "HH:mm")).trim()));
      const existed = v.exists(p); v.write(p, body);
      await fire(ctx, existed ? "save" : "create", { file: p });
      ctx.result({ path: p, template: ctx.flags.template || null }, `created ${p}`);
    },
  },
  ...["move", "rename"].map((name) => ({
    name, usage: name === "move" ? "move <from> <to> [--dry-run] [--force]" : "rename <path> <new-name> [--dry-run] [--force]", spec: { "dry-run": "bool", force: "bool" },
    ru: name === "move" ? "Переместить файл или папку. Ссылки [[...]], ![[...]], [текст](путь), карточки досок и .canvas обновляются во всём хранилище.\n  --dry-run  только показать, что изменится\n  --force    перезаписать существующий файл"
      : "Переименовать файл (остаётся в той же папке). Все ссылки в хранилище обновляются.\n  --dry-run  только показать, что изменится\n  --force    перезаписать существующий файл",
    en: name === "move" ? "Move a file or folder. [[links]], ![[embeds]], [text](path) links, board cards and .canvas files are rewritten vault-wide.\n  --dry-run  only show what would change\n  --force    overwrite an existing file"
      : "Rename a file (stays in its folder). Every link in the vault is updated.\n  --dry-run  only show what would change\n  --force    overwrite an existing file",
    async run(ctx) {
      ctx.need(2, "source and destination"); const v = ctx.vault;
      let from = ctx.args[0]; try { from = v.resolve(from); } catch { /* maybe a folder */ }
      let to = ctx.args[1]; if (name === "rename") { if (/[\\/]/.test(to)) throw usage("rename takes a new name, not a path (use move)"); const d = DIR(posix(from)); to = (d ? d + "/" : "") + to; if (!EXT(to) && EXT(from)) to += "." + EXT(from); }
      const r = await v.move(from, to, { dryRun: ctx.flags["dry-run"], force: ctx.flags.force });
      if (!ctx.flags["dry-run"]) for (const m of r.moves.slice(0, 50)) await fire(ctx, "move", { file: m.to, from: m.from });
      const n = r.edits.reduce((s, e) => s + e.count, 0);
      const lines = [...r.moves.map((m) => `${ctx.flags["dry-run"] ? "would move" : "moved"} ${m.from} -> ${m.to}`), ...r.edits.flatMap((e) => e.links.map((l) => `  ${e.file}${l.line ? ":" + l.line : ""}  ${l.from} -> ${l.to}`)), `${n} link(s) ${ctx.flags["dry-run"] ? "would be " : ""}updated in ${r.edits.length} file(s)`];
      ctx.result(r, lines.join("\n"));
    },
  })),
  {
    name: "delete", usage: "delete <path> [--force]", spec: { force: "bool" },
    ru: "Удалить файл или папку в корзину хранилища (.trash). Насовсем — только с --force.", en: "Delete a file or folder into the vault trash (.trash). Permanent only with --force.",
    async run(ctx) {
      ctx.need(1, "path"); let p = ctx.args[0]; try { p = ctx.vault.resolve(p); } catch { /* folder */ }
      const r = ctx.vault.trash(p, { force: ctx.flags.force }); await fire(ctx, "delete", { file: r.deleted });
      ctx.result(r, r.trashed ? `moved to ${r.trashed}` : `deleted ${r.deleted} permanently`);
    },
  },
  {
    name: "search", usage: "search [query] [--regex] [--case] [--tag t] [--prop k=v] [--folder dir] [--context N] [--limit N] [-l]",
    spec: { regex: "bool", case: "bool", tag: "str", prop: "multi", folder: "str", context: "num", limit: "num", "files-only": "bool", ext: "list", "modified-since": "str" }, alias: { l: "files-only", C: "context" },
    ru: "Поиск по заметкам: текст, регулярное выражение, тег, свойство.\n  --regex          запрос — регулярное выражение\n  --case           учитывать регистр\n  --tag <тег>      только заметки с тегом (и вложенными)\n  --prop k=v       свойство: k (есть), k=v, k!=v, k~часть (можно несколько)\n  --folder <папка> --ext md,txt --modified-since 7d\n  --context N / -C строки вокруг совпадения\n  -l, --files-only только пути\n  --limit N        сколько файлов",
    en: "Search notes: text, regex, tag, property.\n  --regex          query is a regular expression\n  --case           case sensitive\n  --tag <tag>      only notes with the tag (and nested tags)\n  --prop k=v       property: k (exists), k=v, k!=v, k~part (repeatable)\n  --folder <dir> --ext md,txt --modified-since 7d\n  --context N / -C lines around a match\n  -l, --files-only paths only\n  --limit N        max files",
    run(ctx) {
      const f = ctx.flags, q = ctx.args.join(" ");
      if (!q && !f.tag && !f.prop) throw usage("give a query, --tag or --prop");
      const hits = ctx.vault.search(q, { regex: f.regex, caseSensitive: f.case, tag: f.tag, prop: f.prop, folder: f.folder, context: f.context, limit: f.limit, ext: f.ext, modifiedSince: f["modified-since"] && parseWhen(f["modified-since"]) });
      const L = [];
      for (const h of hits) {
        if (f["files-only"] || !h.matches) { L.push(h.path); continue; }
        if (!h.matches.length) L.push(`${h.path}  ${dim("(name)")}`);
        for (const m of h.matches) { for (const [i, b] of h.matches.length ? m.before.entries() : []) L.push(dim(`${h.path}-${m.line - m.before.length + i}- ${b}`)); L.push(`${cyan(h.path)}:${m.line}: ${m.text}`); m.after.forEach((a, i) => L.push(dim(`${h.path}-${m.line + 1 + i}- ${a}`))); }
      }
      ctx.result(hits, L.join("\n"), true);
    },
  },
  {
    name: "links", usage: "links <note>", ru: "Исходящие ссылки заметки и куда они ведут.", en: "Outgoing links of a note and where they point.",
    run(ctx) { ctx.need(1, "note"); const p = note(ctx, ctx.args[0]); const ls = ctx.vault.linksOf(p).map((l) => ({ line: l.line, kind: l.kind, target: l.target + (l.heading ? "#" + l.heading : ""), resolved: l.to })); ctx.result(ls, ls.map((l) => `${String(l.line).padStart(4)}  ${l.kind.padEnd(5)} ${l.target}  ->  ${l.resolved ?? red("(unresolved)")}`).join("\n"), true); },
  },
  {
    name: "backlinks", usage: "backlinks <note>", ru: "Какие заметки ссылаются на эту.", en: "Which notes link to this one.",
    run(ctx) { ctx.need(1, "note"); const p = note(ctx, ctx.args[0]), b = ctx.vault.backlinks(p); ctx.result(b, b.map((l) => `${l.from}:${l.line}  ${l.text}`).join("\n"), true); },
  },
  {
    name: "unresolved", usage: "unresolved", ru: "Битые ссылки: на заметки, которых нет.", en: "Broken links: pointing at notes that do not exist.",
    run(ctx) { const u = ctx.vault.unresolved(); ctx.result(u, u.map((l) => `${l.from}:${l.line}  ${l.target}`).join("\n"), true); },
  },
  {
    name: "orphans", usage: "orphans [--no-inbound]", spec: { "no-inbound": "bool" },
    ru: "Заметки-сироты: нет ни входящих, ни исходящих ссылок.\n  --no-inbound  считать сиротами всё, на что никто не ссылается", en: "Orphan notes: no incoming and no outgoing links.\n  --no-inbound  count anything nobody links to",
    run(ctx) {
      const v = ctx.vault, inb = new Set(); for (const ls of v.allLinks().values()) for (const l of ls) if (l.to) inb.add(l.to);
      const out = v.notes().filter((n) => !inb.has(n.path) && (ctx.flags["no-inbound"] || !(v.allLinks().get(n.path) || []).some((l) => l.to && l.to !== n.path))).map((n) => n.path);
      ctx.result(out, out.join("\n"), true);
    },
  },
  {
    name: "tags", usage: "tags [tag] [--files]", spec: { files: "bool" },
    ru: "Теги хранилища с числом заметок. С именем тега — какие заметки его содержат.", en: "Vault tags with note counts. With a tag name, the notes that carry it.",
    run(ctx) {
      const v = ctx.vault;
      if (ctx.args[0] || ctx.flags.files) { const t = (ctx.args[0] || "").replace(/^#/, ""), list = v.notes().filter((n) => !t || v.hasTag(n.path, t)).map((n) => n.path); return ctx.result(list, list.join("\n"), true); }
      const m = [...v.allTags()].map(([tag, f]) => ({ tag, count: f.length })).sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1));
      ctx.result(m, m.map((x) => `${String(x.count).padStart(5)}  #${x.tag}`).join("\n"), true);
    },
  },
  {
    name: "properties", usage: "properties <note> [key]", ru: "Свойства заметки (блок --- в начале). С ключом — только его значение.", en: "Note properties (the --- block at the top). With a key, only its value.",
    run(ctx) { ctx.need(1, "note"); const p = note(ctx, ctx.args[0]), props = getProperties(ctx.vault.read(p)); if (ctx.args[1]) { const val = props[ctx.args[1]]; if (val === undefined) throw notFound(`no property "${ctx.args[1]}" in ${p}`); return ctx.result(val, typeof val === "string" ? val : JSON.stringify(val), true); } ctx.result(props, Object.entries(props).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n"), true); },
  },
  {
    name: "properties set", usage: "properties set <note> <key> <value> [--string] [--list] [--add]", spec: { string: "bool", list: "bool", add: "bool" },
    ru: "Записать свойство. Значение читается как JSON (true, 3, [\"a\",\"b\"]), иначе строка.\n  --string  всегда строка\n  --list    значение через запятую — список\n  --add     добавить к существующему списку\nОстальной текст заметки не меняется.",
    en: "Set a property. The value is read as JSON (true, 3, [\"a\",\"b\"]), otherwise a string.\n  --string  always a string\n  --list    comma separated value becomes a list\n  --add     append to an existing list\nThe rest of the note stays untouched.",
    async run(ctx) {
      ctx.need(3, "note, key and value"); const p = note(ctx, ctx.args[0]), key = ctx.args[1], raw = ctx.args.slice(2).join(" ");
      let val = ctx.flags.string ? raw : ctx.flags.list ? raw.split(",").map((s) => s.trim()).filter(Boolean) : parseCliValue(raw);
      const text = ctx.vault.read(p);
      if (ctx.flags.add) { const cur = getProperties(text)[key], base = cur === undefined || cur === null ? [] : Array.isArray(cur) ? cur : [cur]; val = [...base, ...(Array.isArray(val) ? val : [val]).filter((x) => !base.includes(x))]; }
      ctx.vault.write(p, setProperty(text, key, val)); await fire(ctx, "save", { file: p });
      ctx.result({ path: p, key, value: val }, `${p}: ${key} = ${JSON.stringify(val)}`);
    },
  },
  {
    name: "properties remove", usage: "properties remove <note> <key>", ru: "Удалить свойство.", en: "Remove a property.",
    async run(ctx) { ctx.need(2, "note and key"); const p = note(ctx, ctx.args[0]), text = ctx.vault.read(p); if (getProperties(text)[ctx.args[1]] === undefined) throw notFound(`no property "${ctx.args[1]}" in ${p}`); ctx.vault.write(p, setProperty(text, ctx.args[1], undefined)); await fire(ctx, "save", { file: p }); ctx.result({ path: p, removed: ctx.args[1] }, `removed ${ctx.args[1]} from ${p}`); },
  },
  {
    name: "daily", usage: "daily [--date 2026-01-31] [--offset -1] [--append text] [--path]", spec: { date: "str", offset: "num", append: "str", path: "bool", print: "bool" },
    ru: "Ежедневная заметка (папка и формат берутся из настроек daily-notes.json, шаблон — оттуда же). Создаётся, если её нет.\n  --date ГГГГ-ММ-ДД, --offset -1 (вчера)\n  --append <текст> дописать строку\n  --path только вывести путь, не создавая файл\n  --print вывести содержимое",
    en: "Daily note (folder and format come from daily-notes.json, template too). Created when missing.\n  --date YYYY-MM-DD, --offset -1 (yesterday)\n  --append <text> add a line\n  --path only print the path, do not create\n  --print print the content",
    async run(ctx) {
      const v = ctx.vault, d = ctx.flags.date ? parseWhen(ctx.flags.date) : new Date(); if (ctx.flags.offset) d.setDate(d.getDate() + ctx.flags.offset);
      const p = v.dailyPath(d); if (ctx.flags.path) return ctx.result({ path: p, exists: v.exists(p) }, p, true);
      let created = false;
      if (!v.exists(p)) {
        let body = `# ${formatDate(d, "YYYY-MM-DD")}\n`; const tpl = v.config("daily-notes.json", {}).template;
        if (tpl) { try { body = v.read(v.resolve(tpl)).replace(/\{\{\s*(?:title|date)(?::([^}]*))?\s*\}\}/g, (_, f) => formatDate(d, (f || "YYYY-MM-DD").trim())); } catch { /* no template */ } }
        v.write(p, body); created = true;
      }
      if (ctx.flags.append) { const old = v.read(p); v.write(p, old + (old.endsWith("\n") ? "" : "\n") + ctx.flags.append + "\n"); }
      if (created || ctx.flags.append) await fire(ctx, created ? "create" : "save", { file: p });
      ctx.result({ path: p, created }, ctx.flags.print ? v.read(p) : p, !!ctx.flags.print || true);
    },
  },
  {
    name: "outline", usage: "outline <note>", ru: "Заголовки заметки (структура).", en: "Headings of a note (its structure).",
    run(ctx) { ctx.need(1, "note"); const o = ctx.vault.outline(note(ctx, ctx.args[0])); ctx.result(o, o.map((h) => `${"  ".repeat(h.level - 1)}${"#".repeat(h.level)} ${h.text}  ${dim(":" + h.line)}`).join("\n"), true); },
  },
  {
    name: "stats", usage: "stats", ru: "Статистика: заметки, слова, ссылки, теги, размеры.", en: "Stats: notes, words, links, tags, sizes.",
    run(ctx) { const s = ctx.vault.stats(); ctx.result(s, [`notes ${s.notes}  boards ${s.boards}  canvases ${s.canvases}  attachments ${s.attachments}  folders ${s.folders}`, `words ${s.words}  characters ${s.characters}  links ${s.links}  tags ${s.tags}  size ${fmtSize(s.bytes)}`, "", table(Object.entries(s.byExtension).sort((a, b) => b[1].files - a[1].files).map(([e, x]) => [e, x.files, fmtSize(x.bytes)]), ["ext", "files", "size"]), "", "biggest notes:", ...s.biggest.map((b) => `  ${fmtSize(b.size).padStart(9)}  ${b.path}`)].join("\n"), true); },
  },
  {
    name: "check", usage: "check [--fail-on broken,dupes,empty] [--only broken,dupes,empty]", spec: { "fail-on": "list", only: "list" },
    ru: "Проверка хранилища: битые ссылки, одинаковые имена заметок, пустые файлы.\n  --only    какие проверки запускать (по умолчанию все)\n  --fail-on при каких проблемах выходить с кодом 4 (по умолчанию: broken)",
    en: "Vault check: broken links, duplicate note names, empty files.\n  --only    which checks to run (default all)\n  --fail-on which problems give exit code 4 (default: broken)",
    run(ctx) {
      const c = ctx.vault.check(), only = ctx.flags.only || ["broken", "dupes", "empty"], fail = ctx.flags["fail-on"] || ["broken"];
      const res = { broken: only.includes("broken") ? c.broken : [], dupes: only.includes("dupes") ? c.duplicates : [], empty: only.includes("empty") ? c.empty : [] };
      const L = [...res.broken.map((b) => `${red("broken")}  ${b.from}:${b.line}  [[${b.target}]]`), ...res.dupes.map((d) => `${yellow("dupe")}    ${d.name}: ${d.paths.join(", ")}`), ...res.empty.map((e) => `${yellow("empty")}   ${e}`)];
      const bad = fail.some((k) => res[k] && res[k].length), total = res.broken.length + res.dupes.length + res.empty.length;
      ctx.result({ ok: !bad, problems: total, ...res }, L.concat(total ? "" : green("ok: no problems"), total ? `${total} problem(s)` : []).join("\n"), true);
      return bad ? EXIT.CHECK_FAILED : EXIT.OK;
    },
  },
]);
