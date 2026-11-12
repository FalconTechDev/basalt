// app-core: Basalt's pure string/number logic, compiled to WebAssembly and inlined into src/app.js by build-app.mjs.
//
// ABI (no JSON, no dependencies): the host writes a list of strings into linear memory, each as a little-endian u32 byte
// length followed by UTF-8 bytes, then calls an export with (ptr, len). The export returns the length of its result, which
// is in a host-readable buffer at out_ptr(): a text for most functions. Negative means "could not handle, use the JS fallback".
// Numbers travel as their decimal text. Text is UTF-8, so lone surrogates cannot cross; the shim keeps those inputs in JS.
use std::cell::RefCell;

thread_local! {
    static OUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(n: usize) -> *mut u8 {
    let mut v: Vec<u8> = Vec::with_capacity(n.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[unsafe(no_mangle)]
pub extern "C" fn dealloc(p: *mut u8, cap: usize) {
    unsafe { drop(Vec::from_raw_parts(p, 0, cap.max(1))) }
}

#[unsafe(no_mangle)]
pub extern "C" fn out_ptr() -> *const u8 {
    OUT.with(|o| o.borrow().as_ptr())
}

fn set_out(s: String) -> isize {
    OUT.with(|o| {
        let mut o = o.borrow_mut();
        o.clear();
        o.extend_from_slice(s.as_bytes());
        o.len() as isize
    })
}

fn args<'a>(ptr: *const u8, len: usize) -> Vec<&'a str> {
    let b = unsafe { std::slice::from_raw_parts(ptr, len) };
    let mut out = Vec::new();
    let mut i = 0;
    while i + 4 <= b.len() {
        let n = u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]) as usize;
        i += 4;
        out.push(std::str::from_utf8(&b[i..i + n]).unwrap_or(""));
        i += n;
    }
    out
}

// ------------------------------------------------------------------ JavaScript string rules

/// \s of JavaScript regular expressions (also what String.prototype.trim removes).
fn js_space(u: u16) -> bool {
    matches!(u, 0x09..=0x0D | 0x20 | 0xA0 | 0x1680 | 0x2000..=0x200A | 0x2028 | 0x2029 | 0x202F | 0x205F | 0x3000 | 0xFEFF)
}

fn trim_js(s: &[u16]) -> &[u16] {
    let a = s.iter().position(|&u| !js_space(u)).unwrap_or(s.len());
    let b = s.iter().rposition(|&u| !js_space(u)).map_or(a, |p| p + 1);
    &s[a..b]
}

fn utf16(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}
fn from16(s: &[u16]) -> String {
    String::from_utf16_lossy(s)
}

/// Number.prototype.toFixed: exact decimal expansion, ties round up.
fn to_fixed(x: f64, d: usize) -> String {
    let neg = x < 0.0;
    let exact = format!("{:.*}", d + 40, x.abs());
    let (int, frac) = exact.split_once('.').unwrap();
    let mut digits: Vec<u8> = int.bytes().chain(frac.bytes().take(d)).collect();
    let round_up = frac.as_bytes()[d] >= b'5';
    if round_up {
        let mut i = digits.len();
        loop {
            if i == 0 {
                digits.insert(0, b'1');
                break;
            }
            i -= 1;
            if digits[i] == b'9' { digits[i] = b'0'; } else { digits[i] += 1; break; }
        }
    }
    let int_len = digits.len() - d;
    let mut s = String::from_utf8(digits[..int_len].to_vec()).unwrap();
    if d > 0 {
        s.push('.');
        s.push_str(std::str::from_utf8(&digits[int_len..]).unwrap());
    }
    // toFixed prints "-0.00" for small negatives only when x is negative and non-zero rounds to zero: JS keeps the sign
    if neg && x != 0.0 { s.insert(0, '-'); }
    s
}

// ------------------------------------------------------------------ byte sizes

fn group_number(value: f64, decimals: usize) -> String {
    let abs = value.abs();
    let sign = if value < 0.0 { "-" } else { "" };
    let rounded = to_fixed(abs, decimals);
    let whole: String = rounded.split('.').next().unwrap().to_string();
    let lead = if whole.len() > 3 { whole.len() % 3 } else { 0 };
    let mut out = String::from(sign);
    if lead > 0 {
        out.push_str(&whole[..lead]);
        out.push(',');
    }
    let rest = &whole[lead..];
    for (i, c) in rest.chars().enumerate() {
        if i > 0 && i % 3 == 0 { out.push(','); }
        out.push(c);
    }
    if decimals > 0 {
        let frac = to_fixed((abs - abs.floor()).abs(), decimals);
        out.push('.');
        out.push_str(&frac[2..]);
    }
    out
}

/// formatBytes(n): "1.50 KB". Finite numbers only (the shim keeps NaN/Infinity in JS).
#[unsafe(no_mangle)]
pub extern "C" fn format_bytes(ptr: *const u8, len: usize) -> isize {
    let a = args(ptr, len);
    let Ok(bytes) = a[0].parse::<f64>() else { return -1 };
    if !bytes.is_finite() { return -1; }
    if bytes <= 0.0 { return set_out("0 B".into()); }
    const UNITS: [&str; 6] = ["B", "KB", "MB", "GB", "TB", "PB"];
    let mut unit = UNITS.len() - 1;
    for i in 0..UNITS.len() {
        if bytes < 1024f64.powi(i as i32 + 1) { unit = i; break; }
    }
    let scaled = bytes / 1024f64.powi(unit as i32);
    set_out(format!("{} {}", group_number(scaled, if unit == 0 { 0 } else { 2 }), UNITS[unit]))
}

// ------------------------------------------------------------------ paths

/// Slash collapsing half of normalizePath (the host adds NFC): "\\" and "/" runs become one "/", ends trimmed,
/// non-breaking spaces become spaces, empty result is "/".
#[unsafe(no_mangle)]
pub extern "C" fn collapse_path(ptr: *const u8, len: usize) -> isize {
    let a = args(ptr, len);
    let mut out = String::with_capacity(a[0].len());
    let mut last_sep = false;
    for c in a[0].chars() {
        if c == '/' || c == '\\' {
            if !last_sep { out.push('/'); }
            last_sep = true;
        } else {
            last_sep = false;
            out.push(c);
        }
    }
    let trimmed = out.trim_matches('/');
    let res = if trimmed.is_empty() { "/".to_string() } else { trimmed.to_string() };
    set_out(res.replace(['\u{00A0}', '\u{202F}'], " "))
}

// ------------------------------------------------------------------ headings and lists

fn squeeze(units: &[u16], is_punct: impl Fn(u16) -> bool) -> String {
    // replace punctuation by " ", squeeze whitespace runs into one space, trim
    let mut tmp: Vec<u16> = Vec::with_capacity(units.len());
    for &u in units { tmp.push(if is_punct(u) { 0x20 } else { u }); }
    let mut out: Vec<u16> = Vec::with_capacity(tmp.len());
    let mut in_space = false;
    for &u in &tmp {
        if js_space(u) {
            if !in_space { out.push(0x20); }
            in_space = true;
        } else {
            in_space = false;
            out.push(u);
        }
    }
    from16(trim_js(&out))
}

/// Heading text for matching: punctuation removed, whitespace squeezed.
#[unsafe(no_mangle)]
pub extern "C" fn plain_heading(ptr: *const u8, len: usize) -> isize {
    let a = args(ptr, len);
    set_out(squeeze(&utf16(a[0]), |u| {
        matches!(u as u8 as char, '!' | '"' | '#' | '$' | '%' | '&' | '(' | ')' | '*' | '+' | ',' | '.' | ':' | ';' | '<' | '=' | '>' | '?' | '@' | '^' | '`' | '{' | '|' | '}' | '~' | '/' | '[' | ']' | '\\' | '\r' | '\n') && u < 128
    }))
}

/// Heading text inside links: removes ":#|^\\", line breaks, "%%", "[[" and "]]" only.
#[unsafe(no_mangle)]
pub extern "C" fn link_safe_heading(ptr: *const u8, len: usize) -> isize {
    let a = args(ptr, len);
    let u = utf16(a[0]);
    let mut spaced: Vec<u16> = Vec::with_capacity(u.len());
    let mut i = 0;
    while i < u.len() {
        let c = u[i];
        let next = u.get(i + 1).copied();
        let single = c < 128 && matches!(c as u8 as char, ':' | '#' | '|' | '^' | '\\' | '\r' | '\n');
        let pair = (c == b'%' as u16 && next == Some(b'%' as u16)) || (c == b'[' as u16 && next == Some(b'[' as u16)) || (c == b']' as u16 && next == Some(b']' as u16));
        if single { spaced.push(0x20); i += 1; } else if pair { spaced.push(0x20); i += 2; } else { spaced.push(c); i += 1; }
    }
    set_out(squeeze(&spaced, |_| false))
}

// ------------------------------------------------------------------ versions

fn parse_version(s: &str) -> Option<Vec<i64>> {
    // parseInt semantics: optional sign + leading digits; anything else (empty, letters first) is NaN
    let mut out = Vec::new();
    for part in s.split('.') {
        let t = part.trim_start_matches(|c: char| c.is_whitespace() || c == '\u{FEFF}');
        let (neg, rest) = match t.strip_prefix('-') { Some(r) => (true, r), None => (false, t.strip_prefix('+').unwrap_or(t)) };
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if digits.is_empty() || digits.len() > 15 { return None; }
        let n: i64 = digits.parse().ok()?;
        out.push(if neg { -n } else { n });
    }
    Some(out)
}

/// isOlderVersion(current, latest). Replies "1"/"0".
#[unsafe(no_mangle)]
pub extern "C" fn is_older_version(ptr: *const u8, len: usize) -> isize {
    let a = args(ptr, len);
    let latest = parse_version(a[1]);
    let Some(latest) = latest else { return set_out("0".into()) };
    let Some(current) = parse_version(a[0]) else { return set_out("1".into()) };
    let n = current.len().min(latest.len());
    for i in 0..n {
        if current[i] < latest[i] { return set_out("1".into()); }
        if current[i] > latest[i] { return set_out("0".into()); }
    }
    set_out(if current.len() < latest.len() { "1" } else { "0" }.into())
}

// ------------------------------------------------------------------ fuzzy search

fn ky(u: u16) -> bool {
    matches!(u, 0x2000..=0x206F | 0x2E00..=0x2E7F)
        || (u < 128 && matches!(u as u8 as char, '\\' | '\'' | '!' | '"' | '#' | '$' | '%' | '&' | '(' | ')' | '*' | '+' | ',' | '-' | '.' | '/' | ':' | ';' | '<' | '=' | '>' | '?' | '@' | '[' | ']' | '^' | '_' | '`' | '{' | '|' | '}' | '~'))
}
fn ey(u: u16) -> bool {
    matches!(u, 0x0F00..=0x0FFF | 0x3040..=0x30FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF | 0xFF66..=0xFF9F)
}
fn lower_differs(u: u16) -> bool {
    match char::from_u32(u as u32) { Some(c) => { let mut it = c.to_lowercase(); !(it.next() == Some(c) && it.next().is_none()) } None => false }
}
fn upper_differs(u: u16) -> bool {
    match char::from_u32(u as u32) { Some(c) => { let mut it = c.to_uppercase(); !(it.next() == Some(c) && it.next().is_none()) } None => false }
}

fn index_of(hay: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    let from = from.min(hay.len());
    if needle.is_empty() { return Some(from); }
    if needle.len() > hay.len() { return None; }
    (from..=hay.len() - needle.len()).find(|&i| &hay[i..i + needle.len()] == needle)
}

fn score(m: &[(usize, usize)], qlen: usize, tlen: usize, camel: usize) -> f64 {
    if m.is_empty() { return 0.0; }
    let mut r = 0.0f64;
    r -= (m.len() - 1) as f64;
    r -= camel as f64 / 10.0;
    let o = m[0].0 as f64;
    r -= (m[m.len() - 1].1 as f64 - o + 1.0 - qlen as f64) / 100.0;
    r -= o / 1000.0;
    r -= tlen as f64 / 10000.0;
    r
}

fn match_tokens(tokens: &[Vec<u16>], qlen: usize, text: &[u16], lower: &[u16], fuzzy: bool) -> Option<(Vec<(usize, usize)>, f64)> {
    if tokens.is_empty() { return None; }
    let mut camel = 0usize;
    let mut from = 0usize;
    let mut spans: Vec<(usize, usize)> = Vec::new();
    let mut l = 0usize;
    while l < tokens.len() {
        let tok = &tokens[l];
        let u = index_of(lower, tok, from)?;
        let h = text.get(u).copied();
        let h_boundary = match h { Some(x) => ky(x) || ey(x), None => false };
        if u > 0 && !h_boundary {
            let p = text.get(u - 1).copied();
            let (hl, hu) = match h { Some(x) => (lower_differs(x), upper_differs(x)), None => (false, false) };
            let pl = match p { Some(x) => lower_differs(x), None => false };
            let p_plain = match p { Some(x) => !ky(x) && !js_space(x) && !ey(x), None => true };
            if (hl && pl) || (hu && p_plain) {
                if fuzzy {
                    if u != from {
                        from += tok.len();
                        continue;
                    }
                } else {
                    camel += 1;
                }
            }
        }
        match spans.last_mut() {
            Some(d) if d.1 >= u => d.1 = u + tok.len(),
            _ => spans.push((u, u + tok.len())),
        }
        from = u + tok.len();
        l += 1;
    }
    let s = score(&spans, qlen, lower.len(), camel);
    Some((spans, s))
}

fn fmt_result(r: Option<(Vec<(usize, usize)>, f64)>, out: &mut String) {
    match r {
        None => out.push('-'),
        Some((m, s)) => {
            out.push_str(&format!("{}", s));
            for (a, b) in m { out.push_str(&format!(";{},{}", a, b)); }
        }
    }
}

/// fuzzy(query, ntokens, tokens.., nfuzzy, fuzzy.., texts..): one result line per text, "-" for no match,
/// otherwise "score;from,to;from,to". Mirrors the editor's quick-switcher scoring.
#[unsafe(no_mangle)]
pub extern "C" fn fuzzy(ptr: *const u8, len: usize) -> isize {
    let a = args(ptr, len);
    let query = a[0];
    let nt: usize = a[1].parse().unwrap_or(0);
    let tokens: Vec<Vec<u16>> = a[2..2 + nt].iter().map(|s| utf16(s)).collect();
    let nf: usize = a[2 + nt].parse().unwrap_or(0);
    let fz: Vec<Vec<u16>> = a[3 + nt..3 + nt + nf].iter().map(|s| utf16(s)).collect();
    let texts = &a[3 + nt + nf..];
    let qlen = query.encode_utf16().count();
    let mut out = String::new();
    let mut text: Vec<u16> = Vec::new();
    let mut lower: Vec<u16> = Vec::new();
    for (i, t) in texts.iter().enumerate() {
        if i > 0 { out.push('\n'); }
        if query.is_empty() { out.push_str("0"); continue; }
        text.clear();
        lower.clear();
        if t.is_ascii() {
            text.extend(t.bytes().map(u16::from));
            lower.extend(t.bytes().map(|b| b.to_ascii_lowercase() as u16));
        } else {
            text.extend(t.encode_utf16());
            lower.extend(t.to_lowercase().encode_utf16());
        }
        let r = match_tokens(&tokens, qlen, &text, &lower, false).or_else(|| match_tokens(&fz, qlen, &text, &lower, true));
        fmt_result(r, &mut out);
    }
    set_out(out)
}
