// A Basalt Wasm plugin written in Rust. Build: cargo build --release --target wasm32-unknown-unknown
// then copy target/wasm32-unknown-unknown/release/hello_wasm.wasm to plugin.wasm next to manifest.json.

#[link(wasm_import_module = "basalt")]
extern "C" {
    fn log(ptr: *const u8, len: usize);
    fn notice(ptr: *const u8, len: usize);
    fn register_command(id: *const u8, id_len: usize, name: *const u8, name_len: usize);
    fn take(dst: *mut u8, cap: usize) -> i32;
    fn active_path() -> i32;
    fn read_note(path: *const u8, len: usize) -> i32;
    fn selection() -> i32;
    fn replace_selection(ptr: *const u8, len: usize) -> i32;
}

// the host calls this to hand the plugin memory for strings
#[no_mangle]
pub extern "C" fn bs_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

fn say(s: &str) { unsafe { notice(s.as_ptr(), s.len()) } }
// read what the last host call put aside
fn fetch(n: i32) -> Option<String> {
    if n < 0 { return None; }
    let mut buf = vec![0u8; n as usize];
    unsafe { take(buf.as_mut_ptr(), buf.len()) };
    String::from_utf8(buf).ok()
}

#[no_mangle]
pub extern "C" fn bs_init() {
    let msg = "hello-wasm started";
    unsafe {
        log(msg.as_ptr(), msg.len());
        register_command(b"count".as_ptr(), 5, "посчитать слова".as_ptr(), "посчитать слова".len());
        register_command(b"reverse".as_ptr(), 7, "перевернуть выделение".as_ptr(), "перевернуть выделение".len());
    }
}

#[no_mangle]
pub extern "C" fn bs_command(id: *const u8, len: usize) {
    let id = unsafe { std::str::from_utf8_unchecked(std::slice::from_raw_parts(id, len)) };
    match id {
        "count" => {
            let Some(path) = fetch(unsafe { active_path() }) else { return say("Нет открытой заметки") };
            match fetch(unsafe { read_note(path.as_ptr(), path.len()) }) {
                Some(text) => say(&format!("{}: {} слов, {} символов", path, text.split_whitespace().count(), text.chars().count())),
                None => say("Не удалось прочитать заметку (нет разрешения?)"),
            }
        }
        "reverse" => match fetch(unsafe { selection() }) {
            Some(sel) if !sel.is_empty() => { let r: String = sel.chars().rev().collect(); unsafe { replace_selection(r.as_ptr(), r.len()) }; }
            _ => say("Сначала выделите текст"),
        },
        _ => {}
    }
}
