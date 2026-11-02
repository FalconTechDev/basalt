# Basalt Wasm plugins

A plugin is a WebAssembly module plus a `manifest.json`, placed in `<vault>/.basalt/wasm-plugins/<id>/` (or installed from a
GitHub release in the plugin catalog: the release needs `manifest.json` and the `.wasm` file as assets).

```json
{ "id": "hello-wasm", "name": "Hello Wasm", "version": "0.1.0", "wasm": "plugin.wasm", "permissions": ["vault.read", "editor"] }
```

The module cannot touch anything by itself. It can only call the host functions below, and the sensitive ones work only for
permissions that are listed in the manifest **and approved by the user** when the plugin is enabled.

## Exports the plugin provides
| name | signature | |
|---|---|---|
| `memory` | | the linear memory |
| `bs_alloc(len) -> ptr` | | host asks for memory to put strings in |
| `bs_init()` | optional | called once when the plugin starts |
| `bs_command(id_ptr, id_len)` | optional | a registered command was run |

## Host functions (import module `basalt`)
| function | permission | |
|---|---|---|
| `log(ptr, len)` | | console |
| `notice(ptr, len)` | | a toast message |
| `register_command(id_ptr, id_len, name_ptr, name_len)` | | adds a command to the palette |
| `active_path() -> len` | | path of the open note |
| `read_note(path_ptr, path_len) -> len` | `vault.read` | |
| `list_notes() -> len` | `vault.read` | paths, one per line |
| `write_note(path_ptr, path_len, data_ptr, data_len) -> 0` | `vault.write` | creates or overwrites |
| `selection() -> len` | `editor` | selected text |
| `replace_selection(ptr, len) -> 0` | `editor` | |
| `take(dst_ptr, cap) -> n` | | copies the text a previous call put aside (`-1` from a call = refused or failed) |

Calls that return text (`active_path`, `read_note`, `list_notes`, `selection`) return its length and keep it aside; call `take`
with a buffer of that size to get it. Paths are relative to the vault; `..`, `.git` and the settings folder are refused.

## Example
`hello-wasm/` is a complete plugin in Rust: `cargo build --release --target wasm32-unknown-unknown`, then copy
`hello_wasm.wasm` as `plugin.wasm` next to `manifest.json`. Any language that compiles to plain Wasm works (Rust, C, Zig, Go via
TinyGo, AssemblyScript).

Plugins run on the app's main thread: keep calls short.
