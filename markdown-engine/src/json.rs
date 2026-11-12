// A tiny JSON value and writer.
pub enum J {
    Null,
    Bool(bool),
    Num(f64),
    Raw(String), // a number written as is
    Str(String),
    Arr(Vec<J>),
    Obj(Vec<(String, J)>),
}

pub fn esc(s: &str, out: &mut String) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 || c == '\u{2028}' || c == '\u{2029}' => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

fn write(j: &J, out: &mut String) {
    match j {
        J::Null => out.push_str("null"),
        J::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        J::Num(n) => {
            if n.is_finite() {
                if n.fract() == 0.0 && n.abs() < 1e15 {
                    if *n == 0.0 && n.is_sign_negative() {
                        out.push_str("-0");
                    } else {
                        out.push_str(&format!("{}", *n as i64));
                    }
                } else {
                    out.push_str(&format!("{}", n));
                }
            } else {
                out.push_str("null");
            }
        }
        J::Raw(s) => out.push_str(s),
        J::Str(s) => esc(s, out),
        J::Arr(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write(x, out);
            }
            out.push(']');
        }
        J::Obj(o) => {
            out.push('{');
            for (i, (k, v)) in o.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                esc(k, out);
                out.push(':');
                write(v, out);
            }
            out.push('}');
        }
    }
}

pub fn to_string(j: &J) -> String {
    let mut s = String::new();
    write(j, &mut s);
    s
}
