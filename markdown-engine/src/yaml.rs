// Front matter: YAML 1.2 (core schema) -> value tree, plus the links found in its string values.
use crate::json::*;
use crate::util::*;
use yaml_rust2::parser::{Event, EventReceiver, Parser};
use yaml_rust2::scanner::TScalarStyle;

#[derive(Clone, Debug)]
pub enum Y {
    Null,
    Bool(bool),
    Num(String, f64),
    Str(String),
    Seq(Vec<Y>),
    Map(Vec<(String, Y)>),
}

struct B {
    stack: Vec<(Vec<Y>, usize, bool)>, // items, anchor, is_map
    docs: usize,
    root: Option<Y>,
    anchors: std::collections::HashMap<usize, Y>,
    err: bool,
}

fn resolve(s: &str, style: TScalarStyle, tag: &Option<yaml_rust2::parser::Tag>) -> Y {
    if let Some(t) = tag {
        if t.suffix == "str" {
            return Y::Str(s.to_string());
        }
    }
    if style != TScalarStyle::Plain {
        return Y::Str(s.to_string());
    }
    match s {
        "" | "~" | "null" | "Null" | "NULL" => return Y::Null,
        "true" | "True" | "TRUE" => return Y::Bool(true),
        "false" | "False" | "FALSE" => return Y::Bool(false),
        ".inf" | ".Inf" | ".INF" | "+.inf" | "+.Inf" | "+.INF" => return Y::Num("null".into(), f64::INFINITY),
        "-.inf" | "-.Inf" | "-.INF" => return Y::Num("null".into(), f64::NEG_INFINITY),
        ".nan" | ".NaN" | ".NAN" => return Y::Num("null".into(), f64::NAN),
        _ => {}
    }
    let b = s.as_bytes();
    // integers
    let (sign, body) = match b.first() {
        Some(b'-') => (-1.0, &s[1..]),
        Some(b'+') => (1.0, &s[1..]),
        _ => (1.0, s),
    };
    if !body.is_empty() && body.bytes().all(|x| x.is_ascii_digit()) {
        let v: f64 = body.parse().unwrap_or(0.0) * sign;
        return Y::Num(num_text(v), v);
    }
    if b.first().map_or(false, |x| *x != b'-' && *x != b'+') {
        if let Some(h) = s.strip_prefix("0x") {
            if !h.is_empty() && h.bytes().all(|x| x.is_ascii_hexdigit()) {
                let v = u128::from_str_radix(h, 16).map(|x| x as f64).unwrap_or(0.0);
                return Y::Num(num_text(v), v);
            }
        }
        if let Some(o) = s.strip_prefix("0o") {
            if !o.is_empty() && o.bytes().all(|x| (b'0'..=b'7').contains(&x)) {
                let v = u128::from_str_radix(o, 8).map(|x| x as f64).unwrap_or(0.0);
                return Y::Num(num_text(v), v);
            }
        }
    }
    // floats: [-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?
    {
        let t = body;
        let tb = t.as_bytes();
        let mut i = 0;
        let mut digits = 0;
        while i < tb.len() && tb[i].is_ascii_digit() {
            i += 1;
            digits += 1;
        }
        let mut ok = false;
        if i < tb.len() && tb[i] == b'.' {
            i += 1;
            let mut frac = 0;
            while i < tb.len() && tb[i].is_ascii_digit() {
                i += 1;
                frac += 1;
            }
            ok = digits > 0 || frac > 0;
        } else if digits > 0 {
            ok = true;
        }
        if ok && i < tb.len() && (tb[i] == b'e' || tb[i] == b'E') {
            let mut j = i + 1;
            if j < tb.len() && (tb[j] == b'-' || tb[j] == b'+') {
                j += 1;
            }
            let e0 = j;
            while j < tb.len() && tb[j].is_ascii_digit() {
                j += 1;
            }
            if j > e0 {
                i = j;
            } else {
                ok = false;
            }
        }
        if ok && i == tb.len() {
            let v: f64 = t.parse().unwrap_or(f64::NAN) * sign;
            return Y::Num(num_text(v), v);
        }
    }
    Y::Str(s.to_string())
}

fn num_text(v: f64) -> String {
    if !v.is_finite() {
        return "null".into();
    }
    if v == 0.0 {
        return if v.is_sign_negative() { "-0".into() } else { "0".into() };
    }
    if v.fract() == 0.0 && v.abs() < 1e21 {
        return format!("{:.0}", v);
    }
    format!("{}", v)
}

impl B {
    fn push_val(&mut self, y: Y, anchor: usize) {
        if anchor > 0 {
            self.anchors.insert(anchor, y.clone());
        }
        match self.stack.last_mut() {
            Some((items, _, _)) => items.push(y),
            None => self.root = Some(y),
        }
    }
}

impl EventReceiver for B {
    fn on_event(&mut self, ev: Event) {
        match ev {
            Event::DocumentStart => self.docs += 1,
            Event::Scalar(s, style, anchor, tag) => {
                let y = resolve(&s, style, &tag);
                self.push_val(y, anchor);
            }
            Event::Alias(id) => match self.anchors.get(&id).cloned() {
                Some(y) => self.push_val(y, 0),
                None => self.err = true,
            },
            Event::SequenceStart(a, _) => self.stack.push((Vec::new(), a, false)),
            Event::MappingStart(a, _) => self.stack.push((Vec::new(), a, true)),
            Event::SequenceEnd => {
                if let Some((items, a, _)) = self.stack.pop() {
                    self.push_val(Y::Seq(items), a);
                }
            }
            Event::MappingEnd => {
                if let Some((items, a, _)) = self.stack.pop() {
                    let mut pairs: Vec<(String, Y)> = Vec::new();
                    let mut it = items.into_iter();
                    while let (Some(k), Some(v)) = (it.next(), it.next()) {
                        let key = match k {
                            Y::Str(s) => s,
                            Y::Null => String::new(),
                            Y::Bool(b) => b.to_string(),
                            Y::Num(t, f) => {
                                if t == "null" {
                                    if f.is_nan() { "NaN".into() } else if f > 0.0 { "Infinity".into() } else { "-Infinity".into() }
                                } else {
                                    t
                                }
                            }
                            _ => {
                                self.err = true;
                                continue;
                            }
                        };
                        if pairs.iter().any(|(k2, _)| *k2 == key) {
                            self.err = true;
                        }
                        pairs.push((key, v));
                    }
                    // JavaScript orders integer-like keys first, ascending
                    let is_idx = |k: &str| k == "0" || (!k.is_empty() && !k.starts_with('0') && k.len() < 10 && k.bytes().all(|x| x.is_ascii_digit()));
                    let mut idx: Vec<(String, Y)> = pairs.iter().filter(|(k, _)| is_idx(k)).cloned().collect();
                    idx.sort_by_key(|(k, _)| k.parse::<u64>().unwrap_or(0));
                    let rest: Vec<(String, Y)> = pairs.into_iter().filter(|(k, _)| !is_idx(k)).collect();
                    idx.extend(rest);
                    self.push_val(Y::Map(idx), a);
                }
            }
            _ => {}
        }
    }
}

/// The YAML library this replaces refuses a flow collection (`[...]` / `{...}`) whose later lines are not indented deeper than the
/// line that opened it; the parser used here does not, so that rule is checked first.
fn flow_indent_error(src: &str) -> bool {
    let mut depth = 0i32;
    let mut open_indent = 0usize;
    let mut quote: Option<char> = None;
    for line in src.split('\n') {
        let indent = line.len() - line.trim_start_matches(' ').len();
        if depth > 0 && quote.is_none() && !line.trim().is_empty() && indent <= open_indent {
            return true;
        }
        let mut prev = ' ';
        let mut chars = line.chars();
        while let Some(ch) = chars.next() {
            match quote {
                Some('"') => {
                    if ch == '\\' {
                        chars.next();
                    } else if ch == '"' {
                        quote = None;
                    }
                }
                Some(_) => {
                    if ch == '\'' {
                        quote = None;
                    }
                }
                None => {
                    if ch == '#' && (prev == ' ' || prev == '\t') {
                        break;
                    }
                    if (ch == '"' || ch == '\'') && (depth > 0 || prev == ' ' || prev == ':' || prev == '-') {
                        quote = Some(ch);
                    } else if ch == '[' || ch == '{' {
                        if depth == 0 {
                            open_indent = indent;
                        }
                        depth += 1;
                    } else if ch == ']' || ch == '}' {
                        depth = (depth - 1).max(0);
                    }
                }
            }
            prev = ch;
        }
    }
    false
}

/// Parses the front matter. Ok(None) when it is empty or not a mapping, Err when it is invalid.
pub fn parse_result(src: &str) -> Result<Option<Y>, ()> {
    if flow_indent_error(src) {
        return Err(());
    }
    let mut b = B { stack: Vec::new(), docs: 0, root: None, anchors: Default::default(), err: false };
    let mut p = Parser::new_from_str(src);
    if p.load(&mut b, true).is_err() || b.err || b.docs > 1 {
        return Err(());
    }
    match b.root {
        Some(y @ Y::Map(_)) => Ok(Some(y)),
        _ => Ok(None),
    }
}

pub fn to_json(y: &Y) -> J {
    match y {
        Y::Null => J::Null,
        Y::Bool(b) => J::Bool(*b),
        Y::Num(t, _) => J::Raw(t.clone()),
        Y::Str(s) => J::Str(s.clone()),
        Y::Seq(a) => J::Arr(a.iter().map(to_json).collect()),
        Y::Map(m) => J::Obj(m.iter().map(|(k, v)| (k.clone(), to_json(v))).collect()),
    }
}

fn link_obj(key: &str, link: S, original: &str, display: S) -> J {
    J::Obj(vec![
        ("key".into(), J::Str(key.into())),
        ("link".into(), J::Str(st(&link))),
        ("original".into(), J::Str(original.into())),
        ("displayText".into(), J::Str(st(&display))),
    ])
}

/// Links in string values: `[[a|b]]` and `[b](a)`.
pub fn frontmatter_links(y: &Y) -> Option<Vec<J>> {
    let mut out = Vec::new();
    let mut err = false;
    walk(y, "", &mut out, &mut err);
    if err { None } else { Some(out) }
}

fn walk(y: &Y, path: &str, out: &mut Vec<J>, err: &mut bool) {
    match y {
        Y::Seq(a) => {
            for (i, x) in a.iter().enumerate() {
                item(path, &i.to_string(), x, out, err);
            }
        }
        Y::Map(m) => {
            for (k, x) in m {
                item(path, k, x, out, err);
            }
        }
        _ => {}
    }
}

fn item(path: &str, key: &str, y: &Y, out: &mut Vec<J>, err: &mut bool) {
    let o = if path.is_empty() { key.to_string() } else { format!("{}.{}", path, key) };
    if let Y::Str(s) = y {
        let v = u(s);
        if starts_with(&v, "[[") && v.len() >= 4 && v[v.len() - 2..] == u("]]")[..] {
            let (href, title, _) = crate::xform::split_link(&v[2..v.len() - 2]);
            out.push(link_obj(&o, href, s, title));
        }
        if starts_with(&v, "[") && v.last() == Some(&c(')')) {
            if let Some((text, url)) = match_md_link(&v) {
                let mut url = url;
                if url.is_empty() {
                    *err = true;
                }
                if url.len() >= 2 && url[0] == c('<') && url[url.len() - 1] == c('>') {
                    url = trim(&url[1..url.len() - 1]).to_vec();
                }
                let internal = starts_with(&url, "./") || starts_with(&url, "../") || find(&url, c(':'), 0).is_none();
                if internal {
                    let f = crate::xform::decode_uri(&url).unwrap_or_else(|| url.clone());
                    out.push(link_obj(&o, f, s, text));
                }
            }
        }
    } else {
        walk(y, &o, out, err);
    }
}

fn ws_only(v: &[u16]) -> bool {
    v.iter().all(|&x| is_ws(x))
}

fn rest_ok(v: &[u16]) -> bool {
    // (\s+(title))?\s*\)$   with `v` holding everything after the url
    if v.last() != Some(&c(')')) {
        return false;
    }
    let inner = &v[..v.len() - 1];
    if ws_only(inner) {
        return true;
    }
    let mut i = 0;
    while i < inner.len() && is_ws(inner[i]) {
        i += 1;
    }
    if i == 0 {
        return false;
    }
    let t = &inner[i..];
    if t.is_empty() {
        return false;
    }
    // [^ ]+ then \s*
    let first_space = t.iter().position(|&x| x == SP);
    match first_space {
        None => return true,
        Some(k) => {
            if k > 0 && ws_only(&t[k..]) {
                return true;
            }
        }
    }
    for (o, cl) in [(c('"'), c('"')), (c('\''), c('\'')), (c('('), c(')'))] {
        if t[0] == o {
            let bad = if o == c('(') { c('\'') } else { cl };
            if let Some(e) = t[1..].iter().position(|&x| x == cl) {
                let _ = bad;
                if e >= 1 && ws_only(&t[e + 2..]) {
                    return true;
                }
            }
        }
    }
    false
}

/// Matches /^(!?\[)(.*?)(]\(\s*)((<[^>]*?>|[^ "]+?)(\s+(...))?)?(\s*\))$/ and returns (text, url).
/// `Some` with an empty url stands for the case where JavaScript would throw on an undefined group.
fn match_md_link(v: &[u16]) -> Option<(S, S)> {
    let mut start = 0;
    if at(v, 0) == c('!') {
        start = 1;
    }
    if at(v, start) != c('[') {
        return None;
    }
    let t0 = start + 1;
    let mut j = t0;
    while j + 1 < v.len() {
        if v[j] == LF || v[j] == 13 || v[j] == 0x2028 || v[j] == 0x2029 {
            return None;
        }
        if v[j] == c(']') && v[j + 1] == c('(') {
            if let Some(url) = match_after(v, j + 2) {
                return Some((v[t0..j].to_vec(), url));
            }
        }
        j += 1;
    }
    None
}

fn match_after(v: &[u16], p0: usize) -> Option<S> {
    // \s* greedy, with the option of giving back
    let mut p = p0;
    while p < v.len() && is_ws(v[p]) {
        p += 1;
    }
    for start in (p0..=p).rev() {
        // url group present
        if at(v, start) == c('<') && start < v.len() {
            if let Some(e) = find(v, c('>'), start + 1) {
                if rest_ok(&v[e + 1..]) {
                    return Some(v[start..e + 1].to_vec());
                }
            }
        }
        let mut e = start;
        while e < v.len() {
            if v[e] == SP || v[e] == c('"') {
                break;
            }
            e += 1;
            if e > start && rest_ok(&v[e..]) {
                return Some(v[start..e].to_vec());
            }
        }
        // no url group: (\s*\))$
        if rest_only_close(&v[start..]) {
            return Some(Vec::new());
        }
    }
    None
}

fn rest_only_close(v: &[u16]) -> bool {
    v.last() == Some(&c(')')) && ws_only(&v[..v.len() - 1])
}
