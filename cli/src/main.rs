// basalt-cli: talks to the running Basalt through its local API (localhost + token).
//   basalt daemon start|stop|status   -- run Basalt in the background without a window
//   any other command goes to Basalt's own command line
//   basalt-cli status | list [folder] | search <text> | read <path> | write <path> [text] | append <path> [text] | open <path> | delete <path>
// `write` / `append` take the text from stdin when it is not given on the command line.
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::net::TcpStream;

fn enc(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~/".contains(&b) { o.push(b as char) } else { o.push_str(&format!("%{:02X}", b)) }
    }
    o
}

fn info_path() -> std::path::PathBuf {
    if let Ok(p) = std::env::var("BASALT_API_INFO") { return p.into(); }
    let base = std::env::var("APPDATA").or_else(|_| std::env::var("HOME").map(|h| format!("{h}/.config"))).unwrap_or_default();
    std::path::Path::new(&base).join("Basalt").join("basalt-api.json")
}

fn call(port: u64, token: &str, method: &str, route: &str, query: &[(&str, &str)], body: &[u8]) -> Result<(u16, Vec<u8>), String> {
    let qs = if query.is_empty() { String::new() } else { format!("?{}", query.iter().map(|(k, v)| format!("{}={}", k, enc(v))).collect::<Vec<_>>().join("&")) };
    let mut s = TcpStream::connect(("127.0.0.1", port as u16)).map_err(|e| format!("cannot reach Basalt on port {port}: {e}"))?;
    let head = format!("{method} {route}{qs} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    s.write_all(head.as_bytes()).and_then(|_| s.write_all(body)).map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    s.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    let split = raw.windows(4).position(|w| w == b"\r\n\r\n").ok_or("bad response")?;
    let status: u16 = String::from_utf8_lossy(&raw[..split]).lines().next().and_then(|l| l.split(' ').nth(1)).and_then(|c| c.parse().ok()).ok_or("bad status")?;
    let chunked = String::from_utf8_lossy(&raw[..split]).to_lowercase().contains("transfer-encoding: chunked");
    let mut body = raw[split + 4..].to_vec();
    if chunked {
        let (mut out, mut i) = (Vec::new(), 0);
        while i < body.len() {
            let nl = match body[i..].windows(2).position(|w| w == b"\r\n") { Some(p) => i + p, None => break };
            let n = usize::from_str_radix(String::from_utf8_lossy(&body[i..nl]).trim(), 16).unwrap_or(0);
            if n == 0 { break; }
            out.extend_from_slice(&body[nl + 2..nl + 2 + n]);
            i = nl + 2 + n + 2;
        }
        body = out;
    }
    Ok((status, body))
}


fn basalt_exe() -> Option<std::path::PathBuf> {
    if let Ok(p) = std::env::var("BASALT_EXE") { return Some(p.into()); }
    let mut c = vec![];
    if let Ok(me) = std::env::current_exe() { if let Some(d) = me.parent() { c.push(d.join("Basalt.exe")); c.push(d.join("..").join("..").join("..").join("Basalt.exe")); } }
    if let Ok(l) = std::env::var("LOCALAPPDATA") { c.push(std::path::Path::new(&l).join("Programs").join("Basalt").join("Basalt.exe")); }
    c.into_iter().find(|p| p.exists())
}

fn read_info() -> Option<(u64, String)> {
    let v: serde_json::Value = std::fs::read_to_string(info_path()).ok().and_then(|t| serde_json::from_str(&t).ok())?;
    Some((v["port"].as_u64()?, v["token"].as_str()?.to_string()))
}

fn alive() -> Option<serde_json::Value> {
    let (port, token) = read_info()?;
    let (code, body) = call(port, &token, "GET", "/v1/status", &[], b"").ok()?;
    if code == 200 { serde_json::from_slice(&body).ok() } else { None }
}

fn daemon(sub: &str) {
    match sub {
        "status" => match alive() { Some(v) => println!("running: vault \"{}\", {} notes", v["vault"].as_str().unwrap_or("?"), v["notes"]), None => { println!("not running"); std::process::exit(1) } },
        "stop" => match read_info() {
            Some((port, token)) if alive().is_some() => { let _ = call(port, &token, "POST", "/v1/quit", &[], b""); println!("stopping"); }
            _ => println!("not running"),
        },
        "start" => {
            if alive().is_some() { println!("already running"); return; }
            let exe = match basalt_exe() { Some(e) => e, None => { eprintln!("Basalt.exe not found (set BASALT_EXE)"); std::process::exit(1) } };
            let mut cmd = Command::new(exe);
            if let Ok(d) = std::env::var("BASALT_USER_DATA") { cmd.arg(format!("--user-data-dir={d}")); }
            cmd.env("BASALT_HEADLESS", "1").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
            #[cfg(windows)]
            { use std::os::windows::process::CommandExt; cmd.creation_flags(0x08000000 | 0x00000008); }
            if let Err(e) = cmd.spawn() { eprintln!("cannot start Basalt: {e}"); std::process::exit(1) }
            for _ in 0..60 {
                std::thread::sleep(std::time::Duration::from_millis(500));
                if let Some(v) = alive() { println!("running in the background: vault \"{}\"", v["vault"].as_str().unwrap_or("?")); return; }
            }
            eprintln!("Basalt did not answer in 30 s"); std::process::exit(1);
        }
        _ => { eprintln!("usage: basalt daemon <start | stop | status>"); std::process::exit(1) }
    }
}

// everything else goes to Basalt's own command line (it talks to the running app over a pipe)
fn ensure_running() {
    if alive().is_some() { return; }
    eprintln!("Basalt is not running. Start the app, or run `basalt-cli daemon start` to run it in the background.");
    std::process::exit(2);
}

fn passthrough(args: &[String]) -> ! {
    if !args.is_empty() && args[0] != "help" { ensure_running(); }
    let exe = match basalt_exe() { Some(e) => e, None => { eprintln!("Basalt.exe not found (set BASALT_EXE)"); std::process::exit(1) } };
    let mut cmd = Command::new(exe);
    if let Ok(d) = std::env::var("BASALT_USER_DATA") { cmd.arg(format!("--user-data-dir={d}")); }
    match cmd.args(args).stdin(Stdio::inherit()).stdout(Stdio::inherit()).stderr(Stdio::inherit()).status() {
        Ok(s) => std::process::exit(s.code().unwrap_or(0)),
        Err(e) => { eprintln!("{e}"); std::process::exit(1) }
    }
}

// ---- interactive shell: `basalt` without arguments
mod logo;
use crossterm::{cursor, event::{self, Event, KeyCode, KeyEvent, KeyModifiers}, execute, queue, style::Print, terminal};

fn split_args(line: &str) -> Vec<String> {
    let (mut out, mut cur, mut q, mut any) = (Vec::new(), String::new(), None::<char>, false);
    for c in line.chars() {
        match (q, c) {
            (Some(x), c) if c == x => q = None,
            (Some(_), c) => cur.push(c),
            (None, '"') | (None, '\'') => { q = Some(c); any = true }
            (None, c) if c.is_whitespace() => { if any || !cur.is_empty() { out.push(std::mem::take(&mut cur)); any = false } }
            (None, c) => cur.push(c),
        }
    }
    if any || !cur.is_empty() { out.push(cur) }
    out
}

fn stock_commands() -> Vec<(String, String)> {
    let mut v: Vec<(String, String)> = [("status", "State of the running Basalt"), ("list", "List files"), ("search", "Search notes"), ("read", "Read a note"), ("write", "Write a note"), ("append", "Append to a note"), ("open", "Open in the app"), ("delete", "Delete (to trash)"), ("daemon", "Background mode: start | stop | status"), ("help", "All commands"), ("exit", "Leave the shell")].iter().map(|(a, b)| (a.to_string(), b.to_string())).collect();
    // the full list comes from the running app and is remembered, so the shell never has to start the app just to list commands
    let cache = std::env::var("APPDATA").map(|a| std::path::Path::new(&a).join("Basalt").join("cli-commands.txt")).ok();
    let mut fresh: Vec<(String, String)> = Vec::new();
    if alive().is_some() {
        if let Some(exe) = basalt_exe() {
            let mut cmd = Command::new(exe);
            if let Ok(d) = std::env::var("BASALT_USER_DATA") { cmd.arg(format!("--user-data-dir={d}")); }
            if let Ok(o) = cmd.arg("help").stdin(Stdio::null()).output() {
                let text = String::from_utf8_lossy(&o.stdout).to_string();
                let mut on = false;
                for l in text.lines() {
                    if l.starts_with("Commands:") { on = true; continue; }
                    if !on { continue; }
                    if l.starts_with("  ") && !l.starts_with("    ") {
                        let t = l.trim_start();
                        let (name, desc) = match t.find("  ") { Some(i) => (&t[..i], t[i..].trim()), None => (t, "") };
                        if !name.is_empty() { fresh.push((name.to_string(), desc.to_string())); }
                    }
                }
            }
        }
        if !fresh.is_empty() { if let Some(c) = &cache { let _ = std::fs::write(c, fresh.iter().map(|(n, d)| format!("{n}	{d}")).collect::<Vec<_>>().join("
")); } }
    }
    if fresh.is_empty() { if let Some(c) = &cache { if let Ok(t) = std::fs::read_to_string(c) { for l in t.lines() { if let Some((n, d)) = l.split_once('\t') { fresh.push((n.to_string(), d.to_string())); } } } } }
    for (n, d) in fresh { if !v.iter().any(|(x, _)| *x == n) { v.push((n, d)); } }
    v.sort_by(|a, b| a.0.cmp(&b.0));
    v
}

const COPPER: &str = "\x1b[38;2;196;150;108m";
const DIM: &str = "\x1b[2m";
const RST: &str = "\x1b[0m";

fn banner() {
    let vault = alive().and_then(|v| v["vault"].as_str().map(|s| s.to_string()));
    let width = terminal::size().map(|(w, _)| w as usize).unwrap_or(100);
    let logo_w = 20 + 5;
    let mut right: Vec<String> = vec![String::new(); logo::LOGO.len()];
    let mid = logo::LOGO.len() / 2;
    let room = width.saturating_sub(logo_w + 2);
    right[mid - 1] = format!("{COPPER}[1mBasalt{RST} {DIM}0.1.0{RST}");
    right[mid] = match &vault { Some(v) => format!("[1m{}{RST}", fit(v, room)), None => format!("{DIM}{}{RST}", fit("Basalt is not running: start the app or `daemon start`", room)) };
    right[mid + 1] = format!("{DIM}{}{RST}", fit("Tab to autocomplete, ↑/↓ history, Ctrl+C quit", room));
    println!();
    for (i, l) in logo::LOGO.iter().enumerate() { if width >= logo_w + 8 { println!("  {l}   {}", right[i]); } else { println!("  {l}"); } }
    if width < logo_w + 8 { println!("  {COPPER}[1mBasalt{RST} {DIM}0.1.0{RST}"); }
    println!();
}

fn fit(s: &str, width: usize) -> String { s.chars().take(width).collect() }

fn matches<'a>(all: &'a [(String, String)], input: &str) -> Vec<&'a (String, String)> {
    if input.contains(' ') { return vec![]; }
    all.iter().filter(|(n, _)| n.starts_with(input)).collect()
}

fn repl() {
    banner();
    let all = stock_commands();
    let mut hist: Vec<String> = Vec::new();
    let hist_file = std::env::var("APPDATA").map(|a| std::path::Path::new(&a).join("Basalt").join("cli-history.txt")).ok();
    if let Some(h) = &hist_file { if let Ok(t) = std::fs::read_to_string(h) { hist = t.lines().map(|l| l.to_string()).collect(); } }
    let mut out = std::io::stdout();
    loop {
        let mut input = String::new();
        let (mut sel, mut hi) = (0usize, hist.len());
        let mut below = 0u16;
        let _ = terminal::enable_raw_mode();
        let draw = |out: &mut std::io::Stdout, input: &str, sel: usize, below: &mut u16| {
            let width = terminal::size().map(|(w, _)| w as usize).unwrap_or(100).max(20);
            // back to the divider line, repaint divider + prompt + suggestions
            let _ = queue!(out, cursor::MoveToColumn(0), cursor::MoveUp(*below + 1));
            let _ = queue!(out, terminal::Clear(terminal::ClearType::FromCursorDown));
            let _ = queue!(out, Print(format!("{DIM}{}{RST}\r\n", "─".repeat(width.min(100)))));
            let _ = queue!(out, Print(format!("{COPPER}>{RST} {}", { let n = input.chars().count(); if n + 3 > width { input.chars().skip(n + 3 - width).collect::<String>() } else { input.to_string() } })));
            let m = matches(&all, input);
            let shown = m.len().min(8);
            let top = if sel >= shown { sel + 1 - shown } else { 0 };
            let mut n = 0u16;
            for (j, (name, desc)) in m.iter().skip(top).take(shown).enumerate() {
                let i = top + j;
                let line = if i == sel { format!("  {COPPER}\x1b[1m{:<22}{RST} {DIM}{}{RST}", name, desc) } else { format!("  {:<22} {DIM}{}{RST}", name, desc) };
                let _ = queue!(out, Print("\r\n"), Print(line));
                n += 1;
            }
            if m.len() > shown { let _ = queue!(out, Print("\r\n"), Print(format!("  {DIM}{} more{RST}", m.len() - shown))); n += 1; }
            *below = n;
            if n > 0 { let _ = queue!(out, cursor::MoveUp(n)); }
            let _ = queue!(out, cursor::MoveToColumn((2 + input.chars().count().min(width.saturating_sub(3))) as u16));
            let _ = std::io::Write::flush(out);
        };
        // one line for the divider is reserved above the prompt
        let _ = execute!(out, Print("\r\n"));
        draw(&mut out, &input, sel, &mut below);
        let mut quit = false;
        loop {
            let ev = match event::read() { Ok(e) => e, Err(_) => { quit = true; break } };
            if let Event::Key(KeyEvent { code, modifiers, kind, .. }) = ev {
                if kind == event::KeyEventKind::Release { continue; }
                let ctrl = modifiers.contains(KeyModifiers::CONTROL);
                match code {
                    KeyCode::Char('c') if ctrl => { quit = true; break }
                    KeyCode::Char('d') if ctrl && input.is_empty() => { quit = true; break }
                    KeyCode::Char(c) => { input.push(c); sel = 0; }
                    KeyCode::Backspace => { input.pop(); sel = 0; }
                    KeyCode::Tab => { let m = matches(&all, &input); if let Some((n, _)) = m.get(sel.min(m.len().saturating_sub(1))) { input = format!("{n} "); sel = 0; } }
                    KeyCode::Down => { let m = matches(&all, &input); if !m.is_empty() && sel + 1 < m.len() { sel += 1; } else if hi + 1 < hist.len() { hi += 1; input = hist[hi].clone(); sel = 0; } else if m.is_empty() { hi = hist.len(); input.clear(); } }
                    KeyCode::Up => { let m = matches(&all, &input); if !m.is_empty() && sel > 0 { sel -= 1; } else if hi > 0 { hi -= 1; input = hist[hi].clone(); sel = 0; } }
                    KeyCode::Esc => { input.clear(); sel = 0; }
                    KeyCode::Enter => {
                        let m = matches(&all, &input);
                        // a highlighted command that is not typed out yet is filled in first; Enter again runs it
                        if !input.contains(' ') && !m.is_empty() { let (n, _) = m[sel.min(m.len() - 1)]; if *n != input { input = n.to_string(); sel = 0; draw(&mut out, &input, sel, &mut below); continue; } }
                        break;
                    }
                    _ => {}
                }
                draw(&mut out, &input, sel, &mut below);
            }
        }
        // leave the suggestion lines, put the finished command on its own line
        let _ = queue!(out, terminal::Clear(terminal::ClearType::FromCursorDown));
        let _ = std::io::Write::flush(&mut out);
        let _ = terminal::disable_raw_mode();
        println!();
        if quit { break; }
        let line = input.trim().to_string();
        if line.is_empty() { continue; }
        if line == "exit" || line == "quit" { break; }
        if hist.last().map(|l| l != &line).unwrap_or(true) { hist.push(line.clone()); }
        let args = split_args(&line);
        if let Ok(me) = std::env::current_exe() { let _ = Command::new(me).args(&args).status(); }
    }
    if let Some(h) = &hist_file { let keep = hist.len().saturating_sub(500); let _ = std::fs::write(h, hist[keep..].join("\n")); }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let usage = || { eprintln!("usage: basalt-cli <status | list [folder] | search <text> | read <path> | write <path> [text] | append <path> [text] | open <path> | delete <path>>"); std::process::exit(1) };
    if args.is_empty() { repl(); return; } // the interactive shell
    if args[0] == "daemon" { daemon(args.get(1).map(|s| s.as_str()).unwrap_or("")); return; }
    const OURS: [&str; 8] = ["status", "list", "search", "read", "write", "append", "open", "delete"];
    if !OURS.contains(&args[0].as_str()) { passthrough(&args); }
    ensure_running();
    let info: serde_json::Value = match std::fs::read_to_string(info_path()).ok().and_then(|t| serde_json::from_str(&t).ok()) {
        Some(v) => v,
        None => { eprintln!("Basalt is not running (no {}). Start the app first.", info_path().display()); std::process::exit(2) }
    };
    let (port, token) = (info["port"].as_u64().unwrap_or(27124), info["token"].as_str().unwrap_or("").to_string());
    let a = args.get(1).map(|s| s.as_str());
    let stdin = || { let mut t = String::new(); let _ = std::io::stdin().read_to_string(&mut t); t };
    let rest = if args.len() > 2 { Some(args[2..].join(" ")) } else { None };
    let r = match (args[0].as_str(), a) {
        ("status", _) => call(port, &token, "GET", "/v1/status", &[], b""),
        ("list", f) => call(port, &token, "GET", "/v1/files", &f.map(|f| vec![("folder", f)]).unwrap_or_default(), b""),
        ("search", Some(_)) => call(port, &token, "GET", "/v1/search", &[("q", &args[1..].join(" "))], b""),
        ("read", Some(p)) => call(port, &token, "GET", "/v1/note", &[("path", p)], b""),
        ("write", Some(p)) => { let t = rest.unwrap_or_else(stdin); call(port, &token, "PUT", "/v1/note", &[("path", p)], t.as_bytes()) }
        ("append", Some(p)) => { let t = rest.unwrap_or_else(stdin); call(port, &token, "POST", "/v1/note/append", &[("path", p)], t.as_bytes()) }
        ("open", Some(p)) => call(port, &token, "POST", "/v1/open", &[("path", p)], b""),
        ("delete", Some(p)) => call(port, &token, "DELETE", "/v1/note", &[("path", p)], b""),
        _ => { usage(); unreachable!() }
    };
    match r {
        Ok((code, body)) if code < 400 => {
            let text = String::from_utf8_lossy(&body).to_string();
            let out = serde_json::from_str::<serde_json::Value>(&text).ok().and_then(|v| serde_json::to_string_pretty(&v).ok()).unwrap_or(text);
            println!("{}", out.trim_end());
        }
        Ok((code, body)) => { eprintln!("error {code}: {}", String::from_utf8_lossy(&body)); std::process::exit(1) }
        Err(e) => { eprintln!("{e}"); std::process::exit(1) }
    }
}
