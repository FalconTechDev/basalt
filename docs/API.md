# Basalt API (локальный HTTP)

Приложение Basalt поднимает на `127.0.0.1` небольшой HTTP-сервер (`src/basalt-api.js`). Полное описание: [`docs/api/openapi.yaml`](api/openapi.yaml) (OpenAPI 3). Командная строка `basalt app ...` — готовый клиент ([CLI.md](CLI.md)).

## Подключение и безопасность

Адрес и токен лежат в `<папка данных>/basalt-api.json` (Windows: `%APPDATA%\Basalt\basalt-api.json`):

```json
{ "port": 27124, "token": "…", "vault": "MyVault", "pid": 1234, "api": 2 }
```

* каждый запрос: `Authorization: Bearer <token>`; без токена или с чужим — `401`;
* только loopback; запросы с заголовком `Origin` (браузеры) — `403`; заголовок `Host` должен быть `127.0.0.1` или `localhost` (защита от DNS rebinding);
* пути — относительно хранилища, с `/`; `..`, `.git` и абсолютные пути отклоняются;
* ошибки приходят как JSON `{ "error": "…" }` (иногда с `hint`).

```bash
# bash / Git Bash
INFO="$APPDATA/Basalt/basalt-api.json"
PORT=$(node -p "require('$INFO').port"); TOKEN=$(node -p "require('$INFO').token")
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/v1/status
```

```powershell
$i = Get-Content "$env:APPDATA\Basalt\basalt-api.json" | ConvertFrom-Json
Invoke-RestMethod "http://127.0.0.1:$($i.port)/v1/status" -Headers @{ Authorization = "Bearer $($i.token)" }
```

```js
// Node 22
const i = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, "Basalt", "basalt-api.json"), "utf8"));
const api = (m, r, body) => fetch(`http://127.0.0.1:${i.port}${r}`, { method: m, body, headers: { Authorization: "Bearer " + i.token } }).then((x) => x.json());
console.log(await api("GET", "/v1/status"));
```

## Маршруты

| метод и путь | что делает |
| --- | --- |
| `GET /v1/status` | приложение, хранилище, число файлов, активный файл, открытые доски, включён ли eval |
| `GET /v1/files?folder=&ext=md,board&limit=` | список файлов `[{path,size,mtime}]` |
| `GET/PUT/DELETE /v1/file?path=` | чтение, запись, удаление в корзину (`force=1` — насовсем); `encoding=base64` для бинарных |
| `GET/PUT/DELETE /v1/note?path=`, `POST /v1/note/append?path=` | то же для заметок (API v1) |
| `POST /v1/move?path=&to=` | переместить средствами приложения (ссылки обновляет оно); `409`, если `to` занят |
| `GET /v1/note/meta?path=` | свойства, теги, заголовки, ссылки, обратные ссылки из кэша |
| `GET /v1/backlinks?path=`, `GET /v1/graph[?unresolved=1]`, `GET /v1/tags` | данные графа и тегов |
| `GET /v1/search?q=&limit=`, `POST /v1/search/run?q=` | поиск / показать запрос в панели поиска |
| `GET /v1/workspace`, `POST /v1/open?path=[&line=&new=0]` | вкладки; открыть файл |
| `GET /v1/commands[?q=]`, `POST /v1/command?id=` | список и запуск команд приложения |
| `GET /v1/boards/open` | доски, открытые сейчас |
| `GET /v1/board?path=[&open=1]` | карточки и связи **открытой** доски |
| `POST/PATCH/DELETE /v1/board/card?path=[&id=]` | добавить / изменить / удалить карточку (JSON-тело) |
| `POST/DELETE /v1/board/link?path=[&id=]` | связь между карточками |
| `POST /v1/board/layout?path=&mode=auto\|lr\|td\|radial\|force` | раскладка средствами приложения |
| `GET /v1/events` | поток Server-Sent Events |
| `GET /v1/settings`, `POST /v1/eval` | настройки; выполнение JS (по умолчанию выключено) |
| `POST /v1/quit` | закрыть приложение |

### Доски через API

Правки идут через `BoardView` открытой доски, поэтому видны сразу и сохраняются самим приложением. Если доска не открыта, ответ `409` с подсказкой; добавьте `open=1`, чтобы приложение открыло её во вкладке.

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text":"Идея","x":0,"y":0,"color":"green"}' \
  "http://127.0.0.1:$PORT/v1/board/card?path=Plans/q1.board&open=1"        # {"ok":true,"id":"k3j9x0aa"}
curl -s -X POST -H "Authorization: Bearer $TOKEN" -d '{"a":"k3j9x0aa","b":"p2m1c8zz","label":"зависит"}' \
  "http://127.0.0.1:$PORT/v1/board/link?path=Plans/q1.board"
curl -s -X POST -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/v1/board/layout?path=Plans/q1.board&mode=lr"
```

Цвета: `red orange yellow green blue purple none` или `#rrggbb`. `id` карточки можно сокращать до уникального начала. Если доска только для чтения или заблокирована — `403`.

> Файл `.board` можно править и без приложения (`basalt board ...`), но если эта же доска открыта, приложение держит её копию в памяти и позже перезапишет файл. Для открытых досок используйте эти маршруты.

### События (SSE)

```bash
curl -N -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/v1/events
# event: file-modify
# data: {"type":"file-modify","time":1763990000000,"path":"Plans/q1.board"}
```

Типы: `file-create`, `file-modify`, `file-delete`, `file-rename` (`path`, `oldPath`), `file-open`, `active-leaf-change`, `layout-change`, `board-change` (`path`, `cards`, `links`; срабатывает через 150 мс после правки доски, в том числе чужой). Раз в 20 секунд приходит комментарий `: ping`. В командной строке: `basalt app events --type board-change`.

### Выполнение JavaScript (`/v1/eval`)

Выключено. Включается только локально, файлом `basalt-api-settings.json` в папке данных: `{"eval": true}` (команда `basalt app settings eval on`; токен API включить его не может). Тело запроса — код; результат выражения или `return` приходит в `{"result": …}`. Внутри доступны `app` и `window`. Выключить: `basalt app settings eval off`.

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -d 'app.vault.getMarkdownFiles().length' http://127.0.0.1:$PORT/v1/eval
```

## Как это проверено

`cli/test/api.live.test.mjs` обращается к каждому маршруту настоящего приложения (временная папка данных и хранилище, `BASALT_HEADLESS=1`, порт отладки; рецепт в `tools/board-stress/README.md`): токен, Origin, Host, файлы, заметки, base64, перемещение, метаданные, граф, теги, поиск, вкладки, команды, все операции с открытой доской и пять раскладок, события создания/изменения/переименования/удаления файлов и `board-change`, eval (выкл / вкл / выкл). Запуск: `BASALT_TEST_API_INFO=<папка данных>/basalt-api.json node --test cli/test/api.live.test.mjs`. Без переменной тест пропускается. Маршрут `/v1/quit` в тесте не вызывается.
