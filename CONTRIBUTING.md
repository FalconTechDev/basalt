# Contributing to Basalt

Thanks for helping. This page gets you from a fresh checkout to a tested change.

## Set up

Windows, Node.js 22, PowerShell. Rust with the `wasm32-unknown-unknown` target only if you touch an engine crate.

```powershell
git clone https://github.com/FalconTechDev/basalt.git
cd basalt
.\run.ps1          # first run builds .\runtime from stock Electron, then starts Basalt on the checkout
```

`runtime\resources\app-src` is a junction into `src\`, so edits apply on the next launch. Always test on a throw-away profile so you never touch real data:

```powershell
runtime\Basalt.exe --user-data-dir=$env:TEMP\basalt-test
```

## Where things live

| You want to change | Edit | Then run |
| --- | --- | --- |
| Interface, board, graph, features | `src/basalt-*.js`, `src/fp-*.js` | reload the window |
| Core app logic | `src-app/*.js` (see `src-app/manifest.json`) | `node build-app.mjs --no-cargo` |
| Styles | `src-css/` | `node build-css.mjs` |
| Interface text | `i18n-src/en.json` | `node tools/build-i18n.mjs` |
| CLI | `cli/basalt.mjs` | `node --test cli/test` |
| Local API | `src/basalt-api.js`, `docs/api/openapi.yaml` | `node --test cli/test` |

`src/app.js` and `src/app.css` are generated. Do not edit them by hand.

**Do not run `node build-canvas.mjs` casually.** It regenerates engine files in `src/` and overwrites hand edits there. To package, use `node build-installer.mjs --version X.Y.Z --skip-build`.

## Testing

```powershell
node --test cli/test          # CLI and API tests
bash tools/smoke-local.sh     # headless launch and basic checks
```

Board and graph work is checked headless against a temp vault with `tools/board-stress/` (see its README). Please do not open windows on someone else's machine for tests; use `BASALT_HEADLESS=1`.

## Commits and pull requests

- One logical change per commit, message in the imperative: `Fix board export on transparent background`.
- Say what you tested. For anything visible, attach a screenshot.
- Keep diffs focused. Do not reformat files you are not changing.
- New third-party code needs a licence entry in [THIRD_PARTY.md](THIRD_PARTY.md) and, for libraries, a file under `vendor/licenses/`.

## Inherited code

Part of `src/app.js` still derives from the application Basalt started from. Do not copy code from that application, or from anything under a licence incompatible with AGPL-3.0, into Basalt. The plan for replacing what remains is in [docs/REPLACING_INHERITED_CODE.md](docs/REPLACING_INHERITED_CODE.md).

## License

By contributing you agree that your work is licensed under the [AGPL-3.0](LICENSE).
