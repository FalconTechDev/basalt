// The tokenizer engine: positions, the offset map for nested containers, and the block / inline loops.
use crate::node::*;
use crate::util::*;
use std::collections::HashMap;

pub struct P {
    pub starts: Vec<usize>, // offset of every line start in the original text
    pub off_map: HashMap<usize, i64>,
    pub in_list: bool,
    pub in_block: bool,
    pub in_link: bool,
    pub at_start: bool,
    pub only_text: bool,
    pub fail: bool,
    pub depth: usize,
    pub extra: Vec<Node>,
    pub breaks: bool,
}

#[derive(Clone)]
pub struct Run {
    pub line: usize,
    pub col: usize,
    pub idx: usize,
}

impl Run {
    pub fn new(line: usize, col: usize) -> Run {
        Run { line, col, idx: 0 }
    }
    pub fn now(&self, p: &P) -> Pt {
        Pt { line: self.line, col: self.col, off: p.to_offset(self.line, self.col) }
    }
    pub fn sync(&mut self, p: &P) {
        self.update(p, &[]);
    }
    /// Consume `sub` (which must be the next text) and return the position before it.
    pub fn eat(&mut self, p: &P, sub: &[u16]) -> Pt {
        let s = self.now(p);
        self.idx += sub.len();
        self.update(p, sub);
        s
    }
    fn update(&mut self, p: &P, sub: &[u16]) {
        let mut last: Option<usize> = None;
        for (i, &x) in sub.iter().enumerate() {
            if x == LF {
                self.line += 1;
                last = Some(i);
            }
        }
        match last {
            None => self.col += sub.len(),
            Some(l) => self.col = sub.len() - l,
        }
        if let Some(&o) = p.off_map.get(&self.line) {
            if last.is_some() {
                self.col = (self.col as i64 + o) as usize;
            } else if (self.col as i64) <= o {
                self.col = (o + 1) as usize;
            }
        }
    }
}

pub type Out = Option<Option<Node>>;

const BLOCK: &[&str] = &[
    "frontmatter", "newline", "indentedCode", "comment", "math", "fencedCode", "blockquote", "atxHeading", "thematicBreak", "list",
    "setextHeading", "html", "footnoteDefinition", "definition", "table", "blockid", "paragraph",
];
const INLINE: &[&str] = &[
    "escape", "autoLink", "url", "html", "ilink", "link", "inlineNote", "footnoteCall", "reference", "strong", "emphasis", "deletion",
    "code", "break", "mark", "tag", "math", "blockid", "comment", "text",
];

impl P {
    pub fn new(orig: &[u16]) -> P {
        let mut starts = vec![0usize];
        let mut i = 0;
        while i < orig.len() {
            let x = orig[i];
            if x == 13 {
                if at(orig, i + 1) == LF && i + 1 < orig.len() {
                    i += 1;
                }
                starts.push(i + 1);
            } else if x == LF {
                starts.push(i + 1);
            }
            i += 1;
        }
        P { starts, off_map: HashMap::new(), in_list: false, in_block: false, in_link: false, at_start: true, only_text: false, fail: false, depth: 0, extra: Vec::new(), breaks: true }
    }

    pub fn add_off(&mut self, line: usize, n: i64) {
        *self.off_map.entry(line).or_insert(0) += n;
    }

    pub fn to_offset(&self, line: usize, col: usize) -> i64 {
        if line >= 1 && line <= self.starts.len() && col >= 1 {
            (self.starts[line - 1] + col - 1) as i64
        } else {
            -1
        }
    }

    pub fn tokenize_block(&mut self, value: &[u16], line: usize, col: usize) -> Vec<Node> {
        self.tokenize(value, line, col, true)
    }
    pub fn tokenize_inline(&mut self, value: &[u16], line: usize, col: usize) -> Vec<Node> {
        self.tokenize(value, line, col, false)
    }

    fn allowed(&self, name: &str, block: bool) -> bool {
        if block {
            match name {
                "frontmatter" => self.at_start,
                _ => true,
            }
        } else {
            match name {
                "autoLink" | "url" => !self.in_link,
                _ => true,
            }
        }
    }

    fn tokenize(&mut self, value: &[u16], line: usize, col: usize, block: bool) -> Vec<Node> {
        let mut out: Vec<Node> = Vec::new();
        if value.is_empty() {
            return out;
        }
        self.depth += 1;
        if self.depth > 150 {
            self.fail = true;
            self.depth -= 1;
            return out;
        }
        let mut r = Run::new(line, if col == 0 { 1 } else { col });
        r.sync(self);
        while r.idx < value.len() && !self.fail {
            let before = r.idx;
            let methods: &[&str] = if block {
                BLOCK
            } else if self.only_text {
                &["text"]
            } else {
                INLINE
            };
            for &m in methods {
                if !self.allowed(m, block) {
                    continue;
                }
                let rest = &value[r.idx..];
                let res = if block { crate::block::run(self, m, &mut r, rest, false) } else { crate::inline::run(self, m, &mut r, rest, false) };
                if let Some(Some(n)) = res {
                    self.add(&mut out, n);
                }
                if !self.extra.is_empty() {
                    let ex = std::mem::take(&mut self.extra);
                    for n in ex {
                        self.add(&mut out, n);
                    }
                }
                if r.idx != before {
                    break;
                }
            }
            if r.idx == before {
                self.fail = true;
                break;
            }
        }
        self.depth -= 1;
        out
    }

    pub fn add(&mut self, out: &mut Vec<Node>, node: Node) {
        if node.ty == Ty::Text {
            if let Some(prev) = out.last_mut() {
                if prev.ty == Ty::Text && mergeable(prev) && mergeable(&node) {
                    prev.val.extend_from_slice(&node.val);
                    prev.e = node.e;
                    self.at_start = false;
                    return;
                }
            }
        }
        out.push(node);
        self.at_start = false;
    }
}

fn mergeable(n: &Node) -> bool {
    n.s.line != n.e.line || n.e.col - n.s.col == n.val.len()
}

pub fn mk(ty: Ty, s: Pt, e: Pt) -> Node {
    let mut n = Node::new(ty);
    n.s = s;
    n.e = e;
    n
}

/// remark's `unescape`: drop the backslash in front of an escapable character.
pub fn unescape(v: &[u16]) -> S {
    let mut out = S::new();
    let mut prev = 0usize;
    let mut idx = find(v, c('\\'), 0);
    while let Some(i) = idx {
        out.extend_from_slice(&v[prev..i]);
        prev = i + 1;
        let ch = at(v, prev);
        if prev >= v.len() || !is_escapable(ch) {
            out.push(c('\\'));
        }
        idx = find(v, c('\\'), i + 1);
    }
    out.extend_from_slice(&v[prev.min(v.len())..]);
    out
}

pub fn is_escapable(ch: u16) -> bool {
    if ch == 0 || ch > 127 {
        return false;
    }
    "\\`*{}[]()#+-.!_>~|\n\"$%&',/:;<=?@^".contains(ch as u8 as char)
}

/// Decode character references (`&amp;`, `&#35;`, `&#x23;`).
pub fn decode_raw(v: &[u16]) -> S {
    let mut out = S::new();
    let mut i = 0;
    while i < v.len() {
        if v[i] == c('&') {
            if let Some((len, dec)) = entity_at(&v[i..]) {
                out.extend_from_slice(&dec);
                i += len;
                continue;
            }
        }
        out.push(v[i]);
        i += 1;
    }
    out
}

/// If an entity starts at the beginning of `v`, return its source length and decoded text.
pub fn entity_at(v: &[u16]) -> Option<(usize, S)> {
    if at(v, 0) != c('&') {
        return None;
    }
    if at(v, 1) == c('#') {
        let mut i = 2;
        let hex = at(v, i) == c('x') || at(v, i) == c('X');
        if hex {
            i += 1;
        }
        let s0 = i;
        while i < v.len() && (if hex { (v[i] as u8 as char).is_ascii_hexdigit() && v[i] < 128 } else { is_digit(v[i]) }) {
            i += 1;
        }
        if i == s0 || at(v, i) != c(';') || i >= v.len() {
            return None;
        }
        let digits = st(&v[s0..i]);
        let n = u32::from_str_radix(&digits, if hex { 16 } else { 10 }).ok()?;
        let ch = if n == 0 || n > 0x10ffff || (0xd800..=0xdfff).contains(&n) { '\u{fffd}' } else { char::from_u32(n).unwrap_or('\u{fffd}') };
        let mut b = [0u16; 2];
        return Some((i + 1, ch.encode_utf16(&mut b).to_vec()));
    }
    let mut i = 1;
    while i < v.len() && (is_alpha(v[i]) || is_digit(v[i])) {
        i += 1;
    }
    if i == 1 || at(v, i) != c(';') || i >= v.len() {
        return None;
    }
    let name = st(&v[1..i]);
    let d = crate::entities::lookup(&name)?;
    Some((i + 1, d.encode_utf16().collect()))
}
