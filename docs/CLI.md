# Basalt CLI

`cli/basalt.mjs` — самостоятельная командная строка на Node.js 20+ без зависимостей. **Работает без запущенного приложения**, напрямую с папкой хранилища; если приложение открыто, может им управлять (`basalt app ...`, см. [API.md](API.md)). Справка к каждой команде есть на русском и английском: `basalt <команда> --help`, язык `--lang ru|en` (или `BASALT_LANG`).

Rust-крейт `cli/src` (`basalt-cli.exe`) не тронут: он по-прежнему только клиент локального API. Node-версия умеет всё то же и больше; решение, заменять ли крейт, за владельцем.

## Быстрый старт

```bash
node cli/basalt.mjs --vault "D:\Notes" vault info
# или:  set BASALT_VAULT=D:\Notes   (либо запускайте внутри папки с .basalt / .obsidian)
cli\basalt-cli.cmd stats            # Windows;  cli/basalt stats  — sh
basalt completion powershell | Out-String | Invoke-Expression    # автодополнение
eval "$(basalt completion bash)"
```

Общие ключи: `--vault <папка>`, `--json` (на любой команде), `-q/--quiet`, `--lang`, `--no-color` (или `NO_COLOR`), `--no-hooks`. Данные идут в stdout, сообщения и ошибки — в stderr (с `--json` ошибка тоже JSON: `{"error","code"}`). Команда пишется первой: `basalt files list --ext md`.

Коды выхода: `0` успех · `1` ошибка · `2` неверное использование · `3` не найдено · `4` проверка не пройдена (`check`, `board diff` нашёл различия) · `5` приложение недоступно · `6` отказано (eval выключен).

## Хранилище

| команда | пример |
| --- | --- |
| `vault info` | `basalt vault info --json` |
| `files list` | `basalt files list --ext md --folder Projects --modified-since 7d --tag todo --sort mtime --long` |
| `files tree` | `basalt files tree Projects --depth 2` |
| `read` | `basalt read "Meeting" --lines 1-20` (имя как в `[[ссылке]]`; `--body`, `--frontmatter`) |
| `write` | `echo "текст" \| basalt write Inbox/idea` · `--text "…" --append` · `--prepend` (после свойств) · `--no-overwrite` |
| `create` | `basalt create Notes/Plan --template Meeting --title "Q1"` (`{{title}} {{date}} {{time}} {{date:YYYY-MM-DD}}`; шаблоны из папки `Templates` или `templates.json`) |
| `move`, `rename` | `basalt rename Old New --dry-run`, `basalt move Inbox/x Archive/` — обновляет `[[ссылки]]`, `![[вставки]]`, `[текст](путь)`, карточки досок, `.canvas`, историю досок |
| `delete` | в корзину `.trash`; насовсем только `--force` |
| `search` | `basalt search "todo" -C 2` · `--regex` · `--case` · `--tag work` · `--prop status=open` (`k`, `k=v`, `k!=v`, `k~часть`) · `-l` · `--json` |
| `links`, `backlinks`, `unresolved`, `orphans` | `basalt backlinks "Meeting"` |
| `tags` | `basalt tags` / `basalt tags project` (с вложенными) |
| `properties` | `basalt properties set Note status done` · `--list a,b` · `--add` · `properties remove Note status` — остальной текст не меняется |
| `daily` | `basalt daily --append "- сделал X"` · `--date 2026-03-05` · `--offset -1` · `--path` (из `daily-notes.json`) |
| `outline`, `stats` | заголовки заметки; статистика хранилища |
| `check` | `basalt check --only broken,dupes,empty --fail-on broken` → код 4 при проблемах |

## Доски (`.board`)

Работают прямо с файлом через Yjs (тот же документ, что у приложения; файл всегда валиден для приложения, это проверено тестами). Доску можно называть путём, именем или путём без `.board`.

```bash
basalt board new Plans/q1
basalt board card add Plans/q1 "Запуск" --x 0 --y 0 --color green
basalt board card add Plans/q1 "Тесты"
basalt board link add Plans/q1 <id1> <id2> --label "после"        # id или уникальное начало
basalt board layout Plans/q1 tree --dir lr                          # grid | tree | force
basalt board show Plans/q1
basalt board export Plans/q1 --format mermaid --out q1.mmd          # json markdown csv mermaid dot svg png-data-only
basalt board import Plans/q1 --cards cards.csv --edges edges.csv --create
basalt board import Plans/q1 --from-json export.json
basalt board from-canvas Mind.canvas
basalt board merge Plans/q1 Plans/q1-copy
basalt board diff Plans/q1@-2 Plans/q1                              # id снимка, -1, latest; один аргумент = текущая против последней версии
basalt board history list Plans/q1
basalt board history restore Plans/q1 -1                            # перед откатом текущее состояние сохраняется
```

* `card add|edit|move|delete|color|kind`, `link add|delete` — правки; `--snapshot` сохраняет версию перед изменением.
* CSV карточек: заголовок `id,text|title,body,x,y,w,h,color,kind`; лишние столбцы попадают в текст строкой `имя: значение`; без `x,y` карточки встают сеткой справа от остальных. CSV связей: `from,to[,label]`, концы — id или текст карточки.
* `png-data-only` выгружает картинки, вставленные в карточки, отдельными файлами в папку `--out`.
* Версии лежат в `.basalt-history/<путь с __>/<время>.json` (те же, что делает приложение, хранятся последние 40).
* **Если эта доска открыта в приложении**, правьте её через `basalt app board ...`: приложение держит копию в памяти и потом перезапишет файл.

## Приложение (нужно запущенное)

`app status`, `app open <файл>`, `app commands`, `app run-command <id>`, `app search`, `app graph`, `app events` (поток JSON-строк), `app request GET /v1/status` (произвольный запрос), `app board list|show|card add|card edit|card delete|link add|link delete|layout` (для открытых досок, `--open` откроет её сама). Токен и порт берутся из `basalt-api.json`; переопределить: `--api-info <файл>`, `BASALT_API_INFO`, `BASALT_USER_DATA`, либо `BASALT_API_URL` + `BASALT_API_TOKEN`.

`app eval "<js>" --yes` — выполнить JavaScript внутри приложения. По умолчанию **выключено**: сначала `basalt app settings eval on` (пишет флаг в `basalt-api-settings.json` в папке данных приложения), затем явный `--yes`. Выключить: `basalt app settings eval off`.

## Автоматизация

Ничего не запускается само: хуки и вебхуки работают, только если вы создали файлы **и** включили `basalt trust enable` для этого хранилища (флаг хранится вне хранилища, `~/.basalt-cli/trust.json`, поэтому скопированная или синхронизированная папка сама ничего не выполнит). Сетевых запросов нет, пока не настроены вебхуки. Задачи, скрипты и плагины запускаются только вашей командой.

* **`basalt run script.mjs [аргументы]`** — скрипт получает готовые объекты:
  ```js
  export default async ({ vault, board, app, args, flags }) => {
    const hits = await vault.search("todo", { tag: "work" });
    await vault.append("Log", `найдено ${hits.length}`);
    const b = await board("Plans/q1", { create: true });
    b.addCard({ text: "из скрипта", color: "blue" }); b.layout("grid"); await b.save();
    return { hits: hits.length, cards: b.cards().length };   // печатается как JSON
  };
  ```
  `vault`: `list exists read write append search links backlinks unresolved tags properties setProperty move trash check stats daily` (+ `raw` — класс `Vault`); `board(путь)`: `cards links addCard editCard deleteCard addLink layout export save raw`; `app`: `status open command request events` (запущенное приложение). Глобальный `basalt` — то же самое.
* **`basalt x list` / `basalt x <имя>`** — плагины: файлы `.basalt/scripts/<имя>.mjs` (`export const meta = { description }`, `export default async (api) => …`).
* **`basalt watch`** — следит за хранилищем с задержкой: `--exec "команда"` (env `BASALT_FILE`, `BASALT_FILES`), `--script f.mjs`, `--task имя`, `--hooks`; `--ext md,board`, `--debounce 500`, `--max-events N`, `--timeout сек`.
* **Хуки** `.basalt/hooks/on-save|on-create|on-delete|on-move|on-board-change` (`.mjs .js .ps1 .cmd .bat .sh`; env `BASALT_VAULT BASALT_EVENT BASALT_FILE BASALT_DATA`, аргументы `событие файл`). Вызываются командами записи CLI и `watch --hooks`. `basalt hook init save` — заготовка, `hook list`, `hook run save --file x.md` (вручную, без trust), `--no-hooks` отключает.
* **Задачи** `.basalt/tasks.json`:
  ```json
  { "tasks": {
    "nightly": { "description": "проверка", "needs": ["backup"], "schedule": "0 3 * * *",
                 "steps": [ {"basalt": "check --fail-on broken"}, {"script": "report.mjs"}, {"task": "notify"}, "echo готово" ] },
    "backup": { "steps": ["robocopy . ..\\backup /MIR /XD .git"] } } }
  ```
  Шаг: строка/`run` (оболочка), `basalt` (эта же CLI), `script`, `task` (вложенная), `continueOnError`. `needs` выполняются первыми, циклы обнаруживаются. `basalt task list|run <имя> [--dry-run]`.
* **Расписание**: `schedule list` (следующий запуск), `schedule run` (цикл на переднем плане, cron из 5 полей), `schedule install <задача> [--dry-run]` / `uninstall` (Windows: `schtasks`; иначе `crontab`; на Windows понимает `*/N * * * *`, `M * * * *`, `M H * * *`, `M H * * день`).
* **Вебхуки** `.basalt/webhooks.json`: `{"hooks":[{"url":"https://…","events":["save","create"],"secret":"env:MY_SECRET"}]}`. События: `save create delete move board-change`. POST JSON `{event,time,vault,file,…}` с заголовками `X-Basalt-Event`, `X-Basalt-Timestamp`, `X-Basalt-Delivery` и `X-Basalt-Signature: sha256=HMAC_SHA256(secret, "<timestamp>.<тело>")`. `webhook list|add|test|sign`.

## Тесты

`node --test cli/test` — 28 тестов во временных хранилищах (все команды, переименование со ссылками, доски с проверкой загрузки Yjs, история, хуки без доверия и с ним, вебхуки с проверкой HMAC, watch, задачи, мок API). Живой тест API: [API.md](API.md#как-это-проверено).
