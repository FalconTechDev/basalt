// UTF-16 helpers. The whole parser works on UTF-16 code units so that every offset and column is the
// same number a JavaScript string index would be.

pub type S = Vec<u16>;

pub const LF: u16 = 10;
pub const TAB: u16 = 9;
pub const SP: u16 = 32;

#[inline]
pub fn c(x: char) -> u16 {
    x as u16
}

pub fn u(s: &str) -> S {
    s.encode_utf16().collect()
}

pub fn st(v: &[u16]) -> String {
    String::from_utf16_lossy(v)
}

/// JavaScript `\s` / `String.prototype.trim` whitespace.
pub fn is_ws(ch: u16) -> bool {
    matches!(
        ch,
        9 | 10 | 11 | 12 | 13 | 32 | 0xa0 | 0x1680 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x205f | 0x3000 | 0xfeff
    )
}

pub fn trim(v: &[u16]) -> &[u16] {
    let mut a = 0;
    let mut b = v.len();
    while a < b && is_ws(v[a]) {
        a += 1;
    }
    while b > a && is_ws(v[b - 1]) {
        b -= 1;
    }
    &v[a..b]
}

pub fn trim_start(v: &[u16]) -> &[u16] {
    let mut a = 0;
    while a < v.len() && is_ws(v[a]) {
        a += 1;
    }
    &v[a..]
}

pub fn trim_end(v: &[u16]) -> &[u16] {
    let mut b = v.len();
    while b > 0 && is_ws(v[b - 1]) {
        b -= 1;
    }
    &v[..b]
}

pub fn is_blank(v: &[u16]) -> bool {
    v.iter().all(|&x| is_ws(x))
}

pub fn at(v: &[u16], i: usize) -> u16 {
    if i < v.len() { v[i] } else { 0 }
}

pub fn find(h: &[u16], ch: u16, from: usize) -> Option<usize> {
    if from >= h.len() {
        return None;
    }
    h[from..].iter().position(|&x| x == ch).map(|p| p + from)
}

pub fn find_str(h: &[u16], n: &[u16], from: usize) -> Option<usize> {
    if n.is_empty() {
        return if from <= h.len() { Some(from) } else { None };
    }
    if h.len() < n.len() {
        return None;
    }
    let mut i = from;
    while i + n.len() <= h.len() {
        if &h[i..i + n.len()] == n {
            return Some(i);
        }
        i += 1;
    }
    None
}

pub fn starts_with(h: &[u16], n: &str) -> bool {
    let mut i = 0;
    for x in n.encode_utf16() {
        if at(h, i) != x || i >= h.len() {
            return false;
        }
        i += 1;
    }
    true
}

pub fn starts_with_ci(h: &[u16], n: &str) -> bool {
    let mut i = 0;
    for x in n.encode_utf16() {
        if i >= h.len() {
            return false;
        }
        if lower(h[i]) != lower(x) {
            return false;
        }
        i += 1;
    }
    true
}

pub fn lower(x: u16) -> u16 {
    if (65..=90).contains(&x) { x + 32 } else { x }
}

pub fn is_digit(x: u16) -> bool {
    (48..=57).contains(&x)
}

pub fn is_alpha(x: u16) -> bool {
    (65..=90).contains(&x) || (97..=122).contains(&x)
}

pub fn is_word(x: u16) -> bool {
    is_digit(x) || is_alpha(x) || x == 95
}

pub fn split_lines(v: &[u16]) -> Vec<&[u16]> {
    v.split(|&x| x == LF).collect()
}

pub fn join_lines(parts: &[&[u16]]) -> S {
    let mut o = S::new();
    for (i, p) in parts.iter().enumerate() {
        if i > 0 {
            o.push(LF);
        }
        o.extend_from_slice(p);
    }
    o
}

pub fn join_owned(parts: &[S]) -> S {
    let mut o = S::new();
    for (i, p) in parts.iter().enumerate() {
        if i > 0 {
            o.push(LF);
        }
        o.extend_from_slice(p);
    }
    o
}

pub fn trim_trailing_lines(v: &[u16]) -> &[u16] {
    let mut e = v.len();
    while e > 0 && v[e - 1] == LF {
        e -= 1;
    }
    &v[..e]
}

/// Collapse whitespace runs to one space and lower-case (remark's `normalize` for references).
pub fn normalize_id(v: &[u16]) -> S {
    let mut o = S::new();
    let mut prev_ws = false;
    for &x in v {
        if is_ws(x) {
            if !prev_ws {
                o.push(SP);
            }
            prev_ws = true;
        } else {
            prev_ws = false;
            o.push(lower_full(x));
        }
    }
    o
}

pub fn lower_full(x: u16) -> u16 {
    if x < 128 {
        return lower(x);
    }
    match char::from_u32(x as u32) {
        Some(ch) => {
            let mut it = ch.to_lowercase();
            let f = it.next().unwrap();
            if it.next().is_some() || (f as u32) > 0xffff { x } else { f as u16 }
        }
        None => x,
    }
}

pub fn to_lower_str(v: &[u16]) -> S {
    st(v).to_lowercase().encode_utf16().collect()
}

pub fn to_upper_str(v: &[u16]) -> S {
    st(v).to_uppercase().encode_utf16().collect()
}
