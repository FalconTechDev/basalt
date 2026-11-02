//! basalt-pty: runs a program on a pseudo-terminal (ConPTY on Windows, openpty elsewhere) for Basalt's terminal.
//!
//!   basalt-pty <cols> <rows> <cwd> <program> [args...]
//!
//! stdout carries the terminal's raw output. stdin carries frames: [tag u8][len u32 LE][payload]
//!   tag 0: bytes typed into the terminal            tag 1: resize, payload = cols u16 LE, rows u16 LE
//! The process exits with the child.

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 4 {
        eprintln!("usage: basalt-pty <cols> <rows> <cwd> <program> [args...]");
        std::process::exit(2);
    }
    let size = PtySize { cols: args[0].parse().unwrap_or(80), rows: args[1].parse().unwrap_or(24), pixel_width: 0, pixel_height: 0 };
    let pair = native_pty_system().openpty(size).expect("cannot open a pseudo-terminal");
    let mut cmd = CommandBuilder::new(&args[3]);
    cmd.args(&args[4..]);
    if !args[2].is_empty() {
        cmd.cwd(&args[2]);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    let mut child = pair.slave.spawn_command(cmd).expect("cannot start the program");
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().expect("reader");
    let mut writer = pair.master.take_writer().expect("writer");
    let master = Arc::new(Mutex::new(pair.master));

    // terminal -> stdout
    let out = std::thread::spawn(move || {
        let mut stdout = std::io::stdout();
        let mut buf = [0u8; 16384];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if stdout.write_all(&buf[..n]).is_err() || stdout.flush().is_err() {
                        break;
                    }
                }
            }
        }
    });

    // stdin frames -> terminal
    let m2 = Arc::clone(&master);
    std::thread::spawn(move || {
        let mut stdin = std::io::stdin().lock();
        let mut head = [0u8; 5];
        while stdin.read_exact(&mut head).is_ok() {
            let len = u32::from_le_bytes([head[1], head[2], head[3], head[4]]) as usize;
            let mut payload = vec![0u8; len];
            if stdin.read_exact(&mut payload).is_err() {
                break;
            }
            match head[0] {
                0 => {
                    if writer.write_all(&payload).is_err() || writer.flush().is_err() {
                        break;
                    }
                }
                1 if len >= 4 => {
                    let cols = u16::from_le_bytes([payload[0], payload[1]]);
                    let rows = u16::from_le_bytes([payload[2], payload[3]]);
                    let _ = m2.lock().unwrap().resize(PtySize { cols, rows, pixel_width: 0, pixel_height: 0 });
                }
                _ => {}
            }
        }
        // the app went away: take the child with it
        std::process::exit(0);
    });

    let status = child.wait();
    let _ = out.join();
    std::process::exit(status.map(|s| s.exit_code() as i32).unwrap_or(1));
}
