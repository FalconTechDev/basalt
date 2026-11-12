// Block tokenizers.
use crate::node::*;
use crate::parse::*;
use crate::util::*;

const INT_PARAGRAPH: &[&str] = &["thematicBreak", "list", "atxHeading", "fencedCode", "comment", "math", "blockquote", "html", "setextHeading"];
const INT_LIST: &[&str] = &["atxHeading", "fencedCode", "comment", "math", "thematicBreak"];
const INT_BLOCKQUOTE: &[&str] = &["indentedCode", "fencedCode", "comment", "math", "atxHeading", "setextHeading", "thematicBreak", "html", "list"];
const INT_FOOTNOTE: &[&str] =
    &["math", "fencedCode", "blockquote", "atxHeading", "thematicBreak", "list", "setextHeading", "html", "definition", "table", "footnoteDefinition"];

const TABSIZE: usize = 4;

pub fn sl(v: &[u16], a: usize, b: usize) -> &[u16] {
    let b = b.min(v.len());
    if a >= b { &[] } else { &v[a..b] }
}

pub fn interrupt(p: &mut P, list: &[&str], rest: &[u16]) -> bool {
    for &n in list {
        let mut tr = Run::new(1, 1);
        if run(p, n, &mut tr, rest, true).is_some() {
            return true;
        }
    }
    false
}

pub fn run(p: &mut P, name: &str, r: &mut Run, v: &[u16], silent: bool) -> Out {
    match name {
        "frontmatter" => frontmatter(p, r, v, silent),
        "newline" => newline(p, r, v, silent),
        "indentedCode" => indented_code(p, r, v, silent),
        "comment" => comment(p, r, v, silent),
        "math" => math(p, r, v, silent),
        "fencedCode" => fenced_code(p, r, v, silent),
        "blockquote" => blockquote(p, r, v, silent),
        "atxHeading" => atx_heading(p, r, v, silent),
        "thematicBreak" => thematic_break(p, r, v, silent),
        "list" => list(p, r, v, silent),
        "setextHeading" => setext_heading(p, r, v, silent),
        "html" => html(p, r, v, silent),
        "footnoteDefinition" => footnote_definition(p, r, v, silent),
        "definition" => definition(p, r, v, silent),
        "table" => table(p, r, v, silent),
        "blockid" => blockid(p, r, v, silent),
        "paragraph" => paragraph(p, r, v, silent),
        _ => None,
    }
}

fn done(p: &P, r: &mut Run, sub: &[u16], ty: Ty) -> Node {
    let s = r.eat(p, sub);
    let e = r.now(p);
    mk(ty, s, e)
}

fn frontmatter(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    if !(starts_with(v, "---") && at(v, 3) == LF && v.len() > 3) {
        return None;
    }
    let mut i = find_str(v, &u("---"), 3);
    while let Some(k) = i {
        if v[k - 1] == LF {
            break;
        }
        i = find_str(v, &u("---"), k + 3);
    }
    let k = i?;
    if silent {
        return Some(None);
    }
    let mut n = done(p, r, &v[..k + 3], Ty::Yaml);
    n.val = sl(v, 4, k - 1).to_vec();
    Some(Some(n))
}

fn newline(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    if at(v, 0) != LF {
        return None;
    }
    if silent {
        return Some(None);
    }
    let mut sub = vec![LF];
    let mut queue: S = Vec::new();
    let mut i = 1;
    while i < v.len() {
        let ch = v[i];
        if !is_ws(ch) {
            break;
        }
        queue.push(ch);
        if ch == LF {
            sub.append(&mut queue);
        }
        i += 1;
    }
    r.eat(p, &sub);
    Some(None)
}

fn indented_code(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let len = v.len();
    let mut index: usize = 0;
    let mut sub: S = Vec::new();
    let mut content: S = Vec::new();
    let mut sub_q: S = Vec::new();
    let mut content_q: S = Vec::new();
    let mut indent = false;
    while index < len {
        let mut ch = v[index];
        if indent {
            indent = false;
            sub.append(&mut sub_q);
            content.append(&mut content_q);
            if ch == LF {
                sub_q = vec![ch];
                content_q = vec![ch];
            } else {
                sub.push(ch);
                content.push(ch);
                index += 1;
                while index < len {
                    ch = v[index];
                    if ch == LF {
                        content_q = vec![ch];
                        sub_q = vec![ch];
                        break;
                    }
                    sub.push(ch);
                    content.push(ch);
                    index += 1;
                }
            }
        } else if ch == SP && at(v, index + 1) == SP && at(v, index + 2) == SP && at(v, index + 3) == SP && index + 3 < len {
            sub_q.extend_from_slice(&[SP, SP, SP, SP]);
            index += 3;
            indent = true;
        } else if ch == TAB {
            sub_q.push(ch);
            indent = true;
        } else {
            let mut blank: S = Vec::new();
            while ch == TAB || ch == SP {
                blank.push(ch);
                index += 1;
                ch = if index < len { v[index] } else { 0 };
            }
            if ch != LF || index >= len {
                break;
            }
            sub_q.append(&mut blank);
            sub_q.push(ch);
            content_q.push(ch);
        }
        index += 1;
    }
    if !content.is_empty() {
        if silent {
            return Some(None);
        }
        let mut n = done(p, r, &sub, Ty::Code);
        n.val = trim_trailing_lines(&content).to_vec();
        return Some(Some(n));
    }
    None
}

fn fenced_code(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let len0 = v.len();
    let length = len0 + 1;
    let mut index = 0;
    let mut sub: S = Vec::new();
    while index < length {
        let ch = at(v, index);
        if ch != SP && ch != TAB || index >= len0 {
            break;
        }
        sub.push(ch);
        index += 1;
    }
    let indent = index;
    let mut ch = at(v, index);
    if (ch != c('~') && ch != c('`')) || index >= len0 {
        return None;
    }
    index += 1;
    let marker = ch;
    let mut fence_count = 1;
    sub.push(ch);
    while index < length {
        ch = at(v, index);
        if ch != marker || index >= len0 {
            break;
        }
        sub.push(ch);
        fence_count += 1;
        index += 1;
    }
    if fence_count < 3 {
        return None;
    }
    while index < length {
        ch = at(v, index);
        if (ch != SP && ch != TAB) || index >= len0 {
            break;
        }
        sub.push(ch);
        index += 1;
    }
    let mut flag: S = Vec::new();
    let mut queue: S = Vec::new();
    while index < length {
        ch = at(v, index);
        if index >= len0 || ch == LF || (marker == c('`') && ch == marker) {
            break;
        }
        if ch == SP || ch == TAB {
            queue.push(ch);
        } else {
            flag.append(&mut queue);
            flag.push(ch);
        }
        index += 1;
    }
    ch = at(v, index);
    if index < len0 && ch != LF {
        return None;
    }
    if silent {
        return Some(None);
    }
    sub.extend_from_slice(&flag);
    let flag_dec = decode_raw(&unescape(&flag));
    if !queue.is_empty() {
        sub.extend_from_slice(&queue);
    }
    let mut closing: S = Vec::new();
    let mut exd_closing: S = Vec::new();
    let mut content: S = Vec::new();
    let mut exd_content: S = Vec::new();
    let mut skip = true;
    while index < length {
        ch = at(v, index);
        let in_range = index < len0;
        content.append(&mut closing);
        exd_content.append(&mut exd_closing);
        if !in_range {
            // end of input: charAt gives '' which is not a line feed, so it is content (a no-op at the end)
            index += 1;
            continue;
        }
        if ch != LF {
            content.push(ch);
            exd_closing.push(ch);
            index += 1;
            continue;
        }
        if skip {
            sub.push(ch);
            skip = false;
        } else {
            closing.push(ch);
            exd_closing.push(ch);
        }
        index += 1;
        let mut q: S = Vec::new();
        while index < length {
            ch = at(v, index);
            if ch != SP || index >= len0 {
                break;
            }
            q.push(ch);
            index += 1;
        }
        closing.extend_from_slice(&q);
        exd_closing.extend_from_slice(sl(&q, indent, q.len()));
        if q.len() >= 4 {
            continue;
        }
        q.clear();
        while index < length {
            ch = at(v, index);
            if ch != marker || index >= len0 {
                break;
            }
            q.push(ch);
            index += 1;
        }
        closing.extend_from_slice(&q);
        exd_closing.extend_from_slice(&q);
        if q.len() < fence_count {
            continue;
        }
        while index < length {
            ch = at(v, index);
            if (ch != SP && ch != TAB) || index >= len0 {
                break;
            }
            closing.push(ch);
            exd_closing.push(ch);
            index += 1;
        }
        if index >= len0 || ch == LF {
            break;
        }
    }
    sub.extend_from_slice(&content);
    sub.extend_from_slice(&closing);
    // lang and meta from the flag
    let mut lang: Option<S> = None;
    let mut meta: Option<S> = None;
    for (i, &x) in flag_dec.iter().enumerate() {
        if x == SP || x == TAB {
            if lang.is_none() {
                lang = Some(flag_dec[..i].to_vec());
            }
        } else if lang.is_some() {
            meta = Some(flag_dec[i..].to_vec());
            break;
        }
    }
    let mut n = done(p, r, &sub, Ty::Code);
    n.lang = match lang {
        Some(l) if !l.is_empty() => Some(l),
        _ => {
            if flag_dec.is_empty() { None } else { Some(flag_dec.clone()) }
        }
    };
    n.meta = match meta {
        Some(m) if !m.is_empty() => Some(m),
        _ => None,
    };
    n.val = exd_content;
    Some(Some(n))
}

fn math(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let d = v.len();
    let mut m = 0;
    while m < d && v[m] == SP {
        m += 1;
    }
    let a = m;
    while m < d && v[m] == c('$') {
        m += 1;
    }
    let l = m - a;
    if l < 2 {
        return None;
    }
    while m < d && v[m] == SP {
        m += 1;
    }
    let cc = m;
    while m < d {
        let x = v[m];
        if x == c('$') {
            return None;
        }
        if x == LF {
            break;
        }
        m += 1;
    }
    if at(v, m) != LF || m >= d {
        return None;
    }
    if silent {
        return Some(None);
    }
    let mut lines: Vec<S> = Vec::new();
    if cc != m {
        lines.push(v[cc..m].to_vec());
    }
    m += 1;
    let mut o = find(v, LF, m + 1).unwrap_or(d);
    while m < d {
        let mut closing = false;
        let mut h = m;
        let mut pp = o;
        let mut s = o;
        let mut f = 0;
        while s > h && v[s - 1] == SP {
            s -= 1;
        }
        while s > h && v[s - 1] == c('$') {
            f += 1;
            s -= 1;
        }
        if l <= f && find(v, c('$'), h) == Some(s) {
            closing = true;
            pp = s;
        }
        while h <= pp && h - m < a && at(v, h) == SP && h < d {
            h += 1;
        }
        if closing {
            while pp > h && v[pp - 1] == SP {
                pp -= 1;
            }
        }
        if !(closing && h == pp) {
            lines.push(sl(v, h, pp).to_vec());
        }
        if closing {
            break;
        }
        m = o + 1;
        o = find(v, LF, m + 1).unwrap_or(d);
    }
    let mut n = done(p, r, &v[..o.min(d)], Ty::Math);
    n.val = join_owned(&lines);
    n.is_math_block = true;
    Some(Some(n))
}

fn comment(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let len = v.len();
    let mut i = 0;
    while i < len && v[i] == SP {
        i += 1;
    }
    let o = i;
    while i < len && v[i] == c('%') {
        i += 1;
    }
    let s = i - o;
    if s < 2 {
        return None;
    }
    let a = i;
    while i < len {
        let l = v[i];
        if l == c('%') {
            return None;
        }
        if l == LF {
            break;
        }
        i += 1;
    }
    if silent {
        return Some(None);
    }
    let mut cc = len;
    let mut u = 0;
    while i < len {
        if v[i] == c('%') {
            u += 1;
            if s == u {
                cc = i + 1;
                break;
            }
        } else {
            u = 0;
        }
        i += 1;
    }
    let f: S = if cc >= s { sl(v, a, cc - s).to_vec() } else { S::new() };
    let h = r.now(p);
    let mut n = done(p, r, &v[..cc], Ty::Comment);
    n.val = f.clone();
    n.ch = p.tokenize_inline(&f, h.line, h.col);
    Some(Some(n))
}

fn blockid(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    if at(v, 0) != c('^') || v.is_empty() {
        return None;
    }
    let mut i = 1;
    while i < v.len() && (is_alpha(v[i]) || is_digit(v[i]) || v[i] == c('-')) {
        i += 1;
    }
    if i == 1 {
        return None;
    }
    // (?=$|\n$|\n\n)
    let ok = i == v.len() || (v[i] == LF && (i + 1 == v.len() || v[i + 1] == LF));
    if !ok {
        return None;
    }
    if silent {
        return Some(None);
    }
    let mut n = done(p, r, &v[..i], Ty::Blockid);
    n.id = Some(v[1..i].to_vec());
    Some(Some(n))
}

fn atx_heading(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let length = v.len() + 1;
    let mut index: isize = -1;
    let mut now = r.now(p);
    let mut sub: S = Vec::new();
    let mut ch;
    loop {
        index += 1;
        if index as usize >= length {
            break;
        }
        ch = at(v, index as usize);
        if (ch != SP && ch != TAB) || index as usize >= v.len() {
            index -= 1;
            break;
        }
        sub.push(ch);
    }
    let mut depth = 0;
    loop {
        index += 1;
        if index as usize > length {
            break;
        }
        ch = at(v, index as usize);
        if ch != c('#') || index as usize >= v.len() {
            index -= 1;
            break;
        }
        sub.push(ch);
        depth += 1;
    }
    if depth > 6 || depth == 0 {
        return None;
    }
    let mut queue: S = Vec::new();
    ch = 0;
    loop {
        index += 1;
        if index as usize >= length {
            break;
        }
        ch = at(v, index as usize);
        if (ch != SP && ch != TAB) || index as usize >= v.len() {
            index -= 1;
            break;
        }
        queue.push(ch);
    }
    // `character` is the char that stopped the loop
    let stop = at(v, (index + 1) as usize);
    let stop_exists = ((index + 1) as usize) < v.len();
    let _ = ch;
    if queue.is_empty() && stop_exists && stop != LF {
        return None;
    }
    if silent {
        return Some(None);
    }
    sub.append(&mut queue);
    let mut content: S = Vec::new();
    loop {
        index += 1;
        if index as usize >= length {
            break;
        }
        let mut ch = at(v, index as usize);
        let exists = (index as usize) < v.len();
        if !exists || ch == LF {
            break;
        }
        if ch != SP && ch != TAB && ch != c('#') {
            content.append(&mut queue);
            content.push(ch);
            continue;
        }
        while (ch == SP || ch == TAB) && (index as usize) < v.len() {
            queue.push(ch);
            index += 1;
            ch = at(v, index as usize);
        }
        if !content.is_empty() && queue.is_empty() && ch == c('#') && (index as usize) < v.len() {
            content.push(ch);
            continue;
        }
        while ch == c('#') && (index as usize) < v.len() {
            queue.push(ch);
            index += 1;
            ch = at(v, index as usize);
        }
        while (ch == SP || ch == TAB) && (index as usize) < v.len() {
            queue.push(ch);
            index += 1;
            ch = at(v, index as usize);
        }
        index -= 1;
    }
    now.col += sub.len();
    let mut all = sub.clone();
    all.extend_from_slice(&content);
    all.extend_from_slice(&queue);
    let kids = p.tokenize_inline(&content, now.line, now.col);
    let mut n = done(p, r, &all, Ty::Heading);
    n.depth = depth;
    n.ch = kids;
    Some(Some(n))
}

fn thematic_break(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let length = v.len() + 1;
    let mut index: usize = 0;
    let mut sub: S = Vec::new();
    let mut ch = 0;
    while index < length {
        ch = at(v, index);
        if (ch != TAB && ch != SP) || index >= v.len() {
            break;
        }
        sub.push(ch);
        index += 1;
    }
    if index >= v.len() || (ch != c('*') && ch != c('-') && ch != c('_')) {
        return None;
    }
    let marker = ch;
    sub.push(ch);
    let mut count = 1;
    let mut queue: S = Vec::new();
    index += 1;
    while index < length {
        ch = at(v, index);
        let exists = index < v.len();
        if exists && ch == marker {
            count += 1;
            sub.append(&mut queue);
            sub.push(marker);
        } else if exists && ch == SP {
            queue.push(ch);
        } else if count >= 3 && (!exists || ch == LF) {
            sub.append(&mut queue);
            if silent {
                return Some(None);
            }
            return Some(Some(done(p, r, &sub, Ty::ThematicBreak)));
        } else {
            return None;
        }
        index += 1;
    }
    None
}

fn setext_heading(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let length = v.len();
    let mut now = r.now(p);
    let mut index: isize = -1;
    let mut sub: S = Vec::new();
    loop {
        index += 1;
        if index as usize >= length {
            break;
        }
        let ch = v[index as usize];
        if ch != SP || index >= 3 {
            index -= 1;
            break;
        }
        sub.push(ch);
    }
    let mut content: S = Vec::new();
    let mut queue: S = Vec::new();
    loop {
        index += 1;
        if index as usize >= length {
            break;
        }
        let ch = v[index as usize];
        if ch == LF {
            index -= 1;
            break;
        }
        if ch == SP || ch == TAB {
            queue.push(ch);
        } else {
            content.append(&mut queue);
            content.push(ch);
        }
    }
    now.col += sub.len();
    sub.extend_from_slice(&content);
    sub.extend_from_slice(&queue);
    index += 1;
    let ch = at(v, index as usize);
    index += 1;
    let marker = at(v, index as usize);
    if ch != LF || (marker != c('=') && marker != c('-')) || (index as usize) >= length || (index - 1) as usize >= length {
        return None;
    }
    sub.push(ch);
    let mut q: S = vec![marker];
    let depth = if marker == c('=') { 1 } else { 2 };
    loop {
        index += 1;
        if index as usize >= length {
            break;
        }
        let ch = v[index as usize];
        if ch != marker {
            if ch != LF {
                return None;
            }
            break;
        }
        q.push(ch);
    }
    if silent {
        return Some(None);
    }
    sub.extend_from_slice(&q);
    let kids = p.tokenize_inline(&content, now.line, now.col);
    let mut n = done(p, r, &sub, Ty::Heading);
    n.depth = depth;
    n.ch = kids;
    Some(Some(n))
}

fn blockquote(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let length = v.len();
    let mut now = r.now(p);
    let mut index = 0;
    while index < length && (v[index] == SP || v[index] == TAB) {
        index += 1;
    }
    if at(v, index) != c('>') || index >= length {
        return None;
    }
    if silent {
        return Some(None);
    }
    let mut values: Vec<S> = Vec::new();
    let mut contents: Vec<S> = Vec::new();
    let mut indents: Vec<usize> = Vec::new();
    let mut callout: Option<Callout> = None;
    index = 0;
    while index < length {
        let mut next = find(v, LF, index).unwrap_or(length);
        let start = index;
        let mut prefixed = false;
        while index < length && (v[index] == SP || v[index] == TAB) {
            index += 1;
        }
        if index < length && v[index] == c('>') {
            index += 1;
            prefixed = true;
            if at(v, index) == SP && index < length {
                index += 1;
            }
        } else {
            index = start;
        }
        let mut content: S = sl(v, index, next).to_vec();
        if !prefixed && is_blank(&content) {
            index = start;
            break;
        }
        if !prefixed {
            let rest = &v[index.min(length)..];
            if interrupt(p, INT_BLOCKQUOTE, rest) {
                break;
            }
        }
        if start == 0 {
            if let Some((len, co)) = callout_head(&content) {
                callout = Some(co);
                index += len;
                content = content[len..].to_vec();
            }
        }
        let line: S = if start == index { content.clone() } else { sl(v, start, next).to_vec() };
        indents.push(index - start);
        values.push(line);
        contents.push(content);
        index = next + 1;
        next = 0;
        let _ = next;
    }
    let all = join_owned(&values);
    let n_lines = indents.len();
    let start_line = now.line;
    let s = r.eat(p, &all);
    let e = r.now(p);
    let mut ln = start_line;
    for i in 0..n_lines {
        p.add_off(ln, indents[i] as i64);
        ln += 1;
    }
    let save = p.in_block;
    p.in_block = true;
    let mut children: Vec<Node> = Vec::new();
    if callout.is_some() && !contents.is_empty() && !contents[0].is_empty() {
        let first = contents.remove(0);
        children = p.tokenize_block(&first, now.line, now.col);
        now.line += 1;
    }
    let rest = p.tokenize_block(&join_owned(&contents), now.line, now.col);
    children.extend(rest);
    p.in_block = save;
    let mut n = mk(Ty::Blockquote, s, e);
    n.ch = children;
    n.callout = callout;
    Some(Some(n))
}

/// `[!type|data]+ ` at the start of a quote line: returns the length of the marker and the callout.
fn callout_head(h: &[u16]) -> Option<(usize, Callout)> {
    if !(at(h, 0) == c('[') && at(h, 1) == c('!') && h.len() > 2) {
        return None;
    }
    let mut i = 2;
    while i < h.len() && h[i] != c(']') {
        i += 1;
    }
    if i >= h.len() || i == 2 {
        return None;
    }
    let inner = &h[2..i];
    i += 1;
    let mut fold = S::new();
    if i < h.len() && (h[i] == c('+') || h[i] == c('-')) {
        fold.push(h[i]);
        i += 1;
    }
    if !(i >= h.len() || is_ws(h[i])) {
        return None;
    }
    let len = if i < h.len() { i + 1 } else { i };
    let (ty_raw, data) = match find(inner, c('|'), 0) {
        Some(k) => (&inner[..k], inner[k + 1..].to_vec()),
        None => (inner, S::new()),
    };
    let t = trim(ty_raw);
    let mut ty = S::new();
    let mut prev_ws = false;
    for &x in t {
        if is_ws(x) {
            if !prev_ws {
                ty.push(c('-'));
            }
            prev_ws = true;
        } else {
            prev_ws = false;
            ty.push(x);
        }
    }
    let ty = to_lower_str(&ty);
    Some((len, Callout { ty, fold, data }))
}

fn paragraph(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let length = v.len();
    let mut index = find(v, LF, 0);
    let mut idx: usize;
    loop {
        match index {
            None => {
                idx = length;
                break;
            }
            Some(i) => {
                idx = i;
                if idx >= length {
                    break;
                }
                if at(v, idx + 1) == LF && idx + 1 < length {
                    break;
                }
                // commonmark: following indented lines belong to the paragraph
                let mut size = 0;
                let mut position = idx + 1;
                let mut ch = 0;
                while position < length {
                    ch = v[position];
                    if ch == TAB {
                        size = TABSIZE;
                        break;
                    } else if ch == SP {
                        size += 1;
                    } else {
                        break;
                    }
                    position += 1;
                }
                if size >= TABSIZE && ch != LF {
                    index = find(v, LF, idx + 1);
                    continue;
                }
                let sub = &v[idx + 1..];
                if interrupt(p, INT_PARAGRAPH, sub) {
                    break;
                }
                let position = idx;
                index = find(v, LF, idx + 1);
                if let Some(ni) = index {
                    if is_blank(&v[position..ni]) {
                        idx = position;
                        break;
                    }
                }
            }
        }
    }
    let sub = &v[..idx];
    if is_blank(sub) {
        r.eat(p, sub);
        return Some(None);
    }
    if silent {
        return Some(None);
    }
    let now = r.now(p);
    let sub = trim_trailing_lines(sub);
    let kids = p.tokenize_inline(sub, now.line, now.col);
    let mut n = done(p, r, sub, Ty::Paragraph);
    n.ch = kids;
    Some(Some(n))
}

// ---------------------------------------------------------------------------------------------- html

const BLOCKS: &[&str] = &[
    "address", "article", "aside", "base", "basefont", "blockquote", "body", "caption", "center", "col", "colgroup", "dd", "details", "dialog", "dir", "div",
    "dl", "dt", "fieldset", "figcaption", "figure", "footer", "form", "frame", "frameset", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header", "hgroup",
    "hr", "html", "iframe", "legend", "li", "link", "main", "menu", "menuitem", "meta", "nav", "noframes", "ol", "optgroup", "option", "p", "param", "pre",
    "section", "source", "title", "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "track", "ul",
];

fn seq_open(line: &[u16]) -> Option<usize> {
    // 0..=6 as in the CommonMark html block start conditions
    if at(line, 0) != c('<') {
        return None;
    }
    // 1: <script|pre|style followed by whitespace, > or end
    for name in ["script", "pre", "style"] {
        if starts_with_ci(&line[1..], name) {
            let k = 1 + name.len();
            if k >= line.len() || is_ws(line[k]) || line[k] == c('>') {
                return Some(0);
            }
        }
    }
    if starts_with(line, "<!--") {
        return Some(1);
    }
    if starts_with(line, "<?") {
        return Some(2);
    }
    if at(line, 1) == c('!') && is_alpha(at(line, 2)) {
        return Some(3);
    }
    if starts_with(line, "<![CDATA[") {
        return Some(4);
    }
    // 6: block element names
    let mut i = 1;
    if at(line, i) == c('/') {
        i += 1;
    }
    let s0 = i;
    while i < line.len() && (is_alpha(line[i]) || is_digit(line[i])) {
        i += 1;
    }
    if i > s0 {
        let nm = st(&line[s0..i]).to_ascii_lowercase();
        if BLOCKS.contains(&nm.as_str()) {
            let t = at(line, i);
            if i >= line.len() || is_ws(t) || t == c('>') || (t == c('/') && at(line, i + 1) == c('>')) {
                return Some(5);
            }
        }
    }
    // 7: a single complete open or close tag on the line
    if let Some(k) = match_open_close_tag(line) {
        if is_blank(&line[k..]) {
            return Some(6);
        }
    }
    None
}

fn seq_close(kind: usize, line: &[u16]) -> bool {
    match kind {
        0 => {
            for i in 0..line.len() {
                if starts_with(&line[i..], "</") {
                    for name in ["script", "pre", "style"] {
                        if starts_with_ci(&line[i + 2..], name) && at(line, i + 2 + name.len()) == c('>') && i + 2 + name.len() < line.len() {
                            return true;
                        }
                    }
                }
            }
            false
        }
        1 => find_str(line, &u("-->"), 0).is_some(),
        2 => find_str(line, &u("?>"), 0).is_some(),
        3 => find(line, c('>'), 0).is_some(),
        4 => find_str(line, &u("]]>"), 0).is_some(),
        _ => line.is_empty(),
    }
}

fn html(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let length = v.len();
    let mut index = 0;
    while index < length && (v[index] == TAB || v[index] == SP) {
        index += 1;
    }
    let mut next = find(v, LF, index + 1).unwrap_or(length);
    let line = sl(v, index, next);
    let kind = seq_open(line)?;
    if silent {
        return if kind != 6 { Some(None) } else { None };
    }
    index = next;
    if !seq_close(kind, line) {
        while index < length {
            next = find(v, LF, index + 1).unwrap_or(length);
            let line = sl(v, index + 1, next);
            if seq_close(kind, line) {
                if !line.is_empty() {
                    index = next;
                }
                break;
            }
            index = next;
        }
    }
    let sub = &v[..index.min(length)];
    let mut n = done(p, r, sub, Ty::Html);
    n.val = sub.to_vec();
    Some(Some(n))
}

/// Matches `<tag ...>` or `</tag>` at the start of `v`; returns its length.
pub fn match_open_close_tag(v: &[u16]) -> Option<usize> {
    match_open_tag(v).or_else(|| match_close_tag(v))
}

pub fn match_open_tag(v: &[u16]) -> Option<usize> {
    if at(v, 0) != c('<') || !is_alpha(at(v, 1)) || v.len() < 2 {
        return None;
    }
    let mut i = 2;
    while i < v.len() && (is_alpha(v[i]) || is_digit(v[i]) || v[i] == c('-')) {
        i += 1;
    }
    loop {
        let save = i;
        let mut j = i;
        while j < v.len() && is_ws(v[j]) {
            j += 1;
        }
        if j == i {
            break;
        }
        // attribute name
        if !(j < v.len() && (is_alpha(v[j]) || v[j] == c('_') || v[j] == c(':'))) {
            i = save;
            break;
        }
        j += 1;
        while j < v.len() && (is_alpha(v[j]) || is_digit(v[j]) || v[j] == c(':') || v[j] == c('.') || v[j] == c('_') || v[j] == c('-')) {
            j += 1;
        }
        // optional value
        let mut k = j;
        while k < v.len() && is_ws(v[k]) {
            k += 1;
        }
        if k < v.len() && v[k] == c('=') {
            k += 1;
            while k < v.len() && is_ws(v[k]) {
                k += 1;
            }
            if k < v.len() {
                let q = v[k];
                if q == c('"') || q == c('\'') {
                    if let Some(e) = find(v, q, k + 1) {
                        j = e + 1;
                    }
                } else {
                    let s0 = k;
                    while k < v.len() && !matches!(v[k], 0..=32) && !matches!(v[k], 34 | 39 | 61 | 60 | 62 | 96) {
                        k += 1;
                    }
                    if k > s0 {
                        j = k;
                    }
                }
            }
        }
        i = j;
    }
    let mut j = i;
    while j < v.len() && is_ws(v[j]) {
        j += 1;
    }
    if at(v, j) == c('/') && j < v.len() {
        j += 1;
    }
    if at(v, j) == c('>') && j < v.len() {
        return Some(j + 1);
    }
    None
}

pub fn match_close_tag(v: &[u16]) -> Option<usize> {
    if !(at(v, 0) == c('<') && at(v, 1) == c('/') && is_alpha(at(v, 2)) && v.len() > 2) {
        return None;
    }
    let mut i = 3;
    while i < v.len() && (is_alpha(v[i]) || is_digit(v[i]) || v[i] == c('-')) {
        i += 1;
    }
    while i < v.len() && is_ws(v[i]) {
        i += 1;
    }
    if at(v, i) == c('>') && i < v.len() { Some(i + 1) } else { None }
}

/// The inline `tag` expression: open tag, close tag, comment, processing instruction, declaration, CDATA.
pub fn match_html_tag(v: &[u16]) -> Option<usize> {
    if let Some(k) = match_open_close_tag(v) {
        return Some(k);
    }
    if starts_with(v, "<!---->") {
        return Some(7);
    }
    if starts_with(v, "<!--") {
        let mut i = 4;
        if at(v, i) == c('-') && i < v.len() {
            i += 1;
        }
        if i < v.len() && v[i] != c('>') && v[i] != c('-') {
            i += 1;
            loop {
                let mut j = i;
                if at(v, j) == c('-') && j < v.len() {
                    j += 1;
                }
                if j < v.len() && v[j] != c('-') {
                    i = j + 1;
                } else {
                    break;
                }
            }
            if starts_with(&v[i..], "-->") {
                return Some(i + 3);
            }
        }
    }
    if starts_with(v, "<?") {
        let mut i = 2;
        while i < v.len() && v[i] != LF {
            if v[i] == c('?') && at(v, i + 1) == c('>') && i + 1 < v.len() {
                return Some(i + 2);
            }
            i += 1;
        }
    }
    if starts_with(v, "<![") && false {
        return None;
    }
    if at(v, 1) == c('!') && is_alpha(at(v, 2)) {
        let mut i = 2;
        while i < v.len() && is_alpha(v[i]) {
            i += 1;
        }
        let w0 = i;
        while i < v.len() && is_ws(v[i]) {
            i += 1;
        }
        if i > w0 {
            while i < v.len() && v[i] != c('>') {
                i += 1;
            }
            if i < v.len() {
                return Some(i + 1);
            }
        }
    }
    if starts_with(v, "<![CDATA[") {
        if let Some(k) = find_str(v, &u("]]>"), 9) {
            return Some(k + 3);
        }
    }
    None
}

// ---------------------------------------------------------------------------------------------- list

fn indent_of(s: &[u16]) -> (usize, Vec<(usize, usize)>) {
    // returns the indent and the stops (indent -> index)
    let mut index = 0;
    let mut indent = 0usize;
    let mut stops = Vec::new();
    while index < s.len() && (s[index] == TAB || s[index] == SP) {
        let size = if s[index] == TAB { 4 } else { 1 };
        let before = indent;
        indent += size;
        if size > 1 {
            indent = (indent / size) * size;
        }
        // every column the character spans maps to it
        for k in before + 1..=indent {
            stops.push((k, index));
        }
        index += 1;
    }
    (indent, stops)
}

fn stop_at(stops: &[(usize, usize)], k: usize) -> Option<usize> {
    let mut r = None;
    for &(i, x) in stops {
        if i == k {
            r = Some(x);
        }
    }
    r
}

fn remove_indentation(value: &[u16], maximum: usize) -> Vec<S> {
    let mut values: Vec<S> = value.split(|&x| x == LF).map(|x| x.to_vec()).collect();
    let mut first: S = vec![SP; maximum];
    first.push(c('!'));
    values.insert(0, first);
    let mut min_indent = usize::MAX;
    let mut matrix: Vec<Vec<(usize, usize)>> = vec![Vec::new(); values.len()];
    let mut position = values.len();
    while position > 0 {
        position -= 1;
        let (ind, stops) = indent_of(&values[position]);
        matrix[position] = stops;
        if trim(&values[position]).is_empty() {
            continue;
        }
        if ind != 0 && ind < min_indent {
            min_indent = ind;
        }
    }
    if min_indent != usize::MAX {
        let mut position = values.len();
        while position > 0 {
            position -= 1;
            let stops = &matrix[position];
            let mut index = min_indent;
            while index > 0 && stop_at(stops, index).is_none() {
                index -= 1;
            }
            let pad = !trim(&values[position]).is_empty() && min_indent != 0 && index != min_indent && !stops.is_empty();
            let cut = match stop_at(stops, index) {
                Some(x) if index != 0 || true => x + 1,
                _ => 0,
            };
            let cut = if index == 0 && stop_at(stops, 0).is_none() { 0 } else { cut };
            let mut nv: S = Vec::new();
            if pad {
                nv.push(TAB);
            }
            nv.extend_from_slice(sl(&values[position], cut, values[position].len()));
            values[position] = nv;
        }
    }
    values.remove(0);
    values
}

fn is_task(v: &[u16]) -> Option<(usize, S)> {
    // /^\[(.)][ \t]/
    if at(v, 0) == c('[') && v.len() > 3 && v[1] != LF && v[2] == c(']') && (v[3] == SP || v[3] == TAB) {
        return Some((4, vec![v[1]]));
    }
    None
}

fn normal_list_item(p: &mut P, value: &[u16], line0: usize) -> S {
    // EXPRESSION_BULLET
    let mut i = 0;
    while i < value.len() && (value[i] == SP || value[i] == TAB) {
        i += 1;
    }
    let m1 = &value[..i];
    let b0 = i;
    if i < value.len() && (value[i] == c('*') || value[i] == c('+') || value[i] == c('-')) {
        i += 1;
    } else {
        while i < value.len() && is_digit(value[i]) {
            i += 1;
        }
        i += 1;
    }
    let m2 = sl(value, b0, i);
    // m3
    let mut j = i;
    while j < value.len() && value[j] == SP {
        j += 1;
    }
    let spaces = j - i;
    let m3: S = if (1..=4).contains(&spaces) {
        vec![SP; spaces]
    } else if spaces >= 5 {
        vec![SP]
    } else if at(value, i) == TAB && i < value.len() {
        vec![TAB]
    } else {
        S::new()
    };
    let rest_start = i + m3.len();
    let nl = find(value, LF, rest_start).unwrap_or(value.len());
    let rest = sl(value, rest_start, nl).to_vec();
    let tail = &value[nl..];
    let mut bullet: S = m1.to_vec();
    bullet.extend_from_slice(m2);
    bullet.extend_from_slice(&m3);
    let mut m2x = m2.to_vec();
    let numeric_small = {
        let s = st(m2);
        let t = s.trim_end_matches('.');
        !s.ends_with(')') && !t.is_empty() && t.chars().all(|c| c.is_ascii_digit()) && t.parse::<u64>().map(|n| n < 10).unwrap_or(false)
    };
    if numeric_small && m3.len() == 1 {
        m2x.insert(0, SP);
    }
    let mut max: S = m1.to_vec();
    max.extend(std::iter::repeat(SP).take(m2x.len()));
    max.extend_from_slice(&m3);
    let mut replaced = max.clone();
    replaced.extend_from_slice(&rest);
    replaced.extend_from_slice(tail);
    let lines: Vec<S> = replaced.split(|&x| x == LF).map(|x| x.to_vec()).collect();
    let (max_indent, _) = indent_of(&max);
    let mut trimmed = remove_indentation(&replaced, max_indent);
    trimmed[0] = rest;
    let mut line = line0;
    p.add_off(line, bullet.len() as i64);
    line += 1;
    for index in 1..lines.len() {
        p.add_off(line, lines[index].len() as i64 - trimmed[index].len() as i64);
        line += 1;
    }
    join_owned(&trimmed)
}

fn is_loose(value: &[u16]) -> bool {
    // /\n\n(?!\s*$)/
    let mut i = 0;
    while i + 1 < value.len() {
        if value[i] == LF && value[i + 1] == LF {
            let rest = &value[i + 2..];
            if !is_blank(rest) {
                return true;
            }
        }
        i += 1;
    }
    false
}

fn list_item(p: &mut P, value: &[u16], pos: Pt) -> Node {
    let mut val = normal_list_item(p, value, pos.line);
    let mut checked: Option<bool> = None;
    let mut checklist: Option<S> = None;
    if let Some((len, ch)) = is_task(&val) {
        checked = Some(!(ch.len() == 1 && ch[0] == SP));
        checklist = Some(ch);
        p.add_off(pos.line, len as i64);
        val = val[len..].to_vec();
    }
    let mut n = Node::new(Ty::ListItem);
    n.spread = is_loose(&val);
    n.checked = checked;
    n.checklist = checklist;
    n.ch = p.tokenize_block(&val, pos.line, pos.col);
    n
}

fn list(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let length = v.len();
    let mut index = 0;
    let mut size = 0;
    while index < length {
        let ch = v[index];
        if ch == TAB {
            size += TABSIZE - (size % TABSIZE);
        } else if ch == SP {
            size += 1;
        } else {
            break;
        }
        index += 1;
    }
    if size >= TABSIZE {
        return None;
    }
    let mut ch = at(v, index);
    let marker;
    let ordered;
    let mut start: Option<u64> = None;
    if index < length && (ch == c('*') || ch == c('+') || ch == c('-')) {
        marker = ch;
        ordered = false;
    } else {
        ordered = true;
        let mut queue: S = Vec::new();
        while index < length {
            ch = v[index];
            if !is_digit(ch) {
                break;
            }
            queue.push(ch);
            index += 1;
        }
        ch = at(v, index);
        if queue.is_empty() || index >= length || !(ch == c('.') || ch == c(')')) {
            return None;
        }
        if silent && queue != vec![c('1')] {
            return None;
        }
        start = st(&queue).parse::<u64>().ok();
        marker = ch;
    }
    index += 1;
    ch = at(v, index);
    let exists = index < length;
    if ch != SP && ch != TAB && (ch != LF && exists) {
        return None;
    }
    if silent {
        return Some(None);
    }

    struct Item {
        value: Vec<S>,
        indent: usize,
        trail: Vec<S>,
    }
    index = 0;
    let mut items: Vec<Item> = Vec::new();
    let mut all_lines: Vec<S> = Vec::new();
    let mut empty_lines: Vec<S> = Vec::new();
    let mut spread = false;
    let mut empty = false;
    while index < length {
        let mut next_index = find(v, LF, index).unwrap_or(length);
        let start_index = index;
        let mut prefixed;
        let mut indented = false;
        let mut size = 0;
        while index < length {
            let ch = v[index];
            if ch == TAB {
                size += TABSIZE - (size % TABSIZE);
            } else if ch == SP {
                size += 1;
            } else {
                break;
            }
            index += 1;
        }
        if let Some(it) = items.last() {
            if size >= it.indent {
                indented = true;
            }
        }
        let mut ch = at(v, index);
        let mut current: Option<u16> = None;
        if !indented {
            if index < length && (ch == c('*') || ch == c('+') || ch == c('-')) {
                current = Some(ch);
                index += 1;
                size += 1;
            } else {
                let mut queue = 0;
                while index < length {
                    ch = v[index];
                    if is_digit(ch) {
                        queue += 1;
                        index += 1;
                    } else {
                        break;
                    }
                }
                ch = at(v, index);
                let ex = index < length;
                index += 1;
                if queue > 0 && ex && (ch == c('.') || ch == c(')')) {
                    current = Some(ch);
                    size += queue + 1;
                }
            }
            if current.is_some() {
                ch = at(v, index);
                let ex = index < length;
                if ex && ch == TAB {
                    size += TABSIZE - (size % TABSIZE);
                    index += 1;
                } else if ex && ch == SP {
                    let end = index + TABSIZE;
                    while index < end {
                        if at(v, index) != SP || index >= length {
                            break;
                        }
                        index += 1;
                        size += 1;
                    }
                    if index == end && at(v, index) == SP && index < length {
                        index -= TABSIZE - 1;
                        size -= TABSIZE - 1;
                    }
                } else if ex && ch != LF {
                    current = None;
                }
            }
        }
        if let Some(cm) = current {
            if marker != cm {
                break;
            }
            prefixed = true;
        } else {
            if let Some(it) = items.last() {
                indented = size >= it.indent || size > TABSIZE;
            }
            prefixed = false;
            index = start_index;
        }
        let line = sl(v, start_index, next_index).to_vec();
        let content = if start_index == index { line.clone() } else { sl(v, index, next_index).to_vec() };
        if let Some(cm) = current {
            if cm == c('*') || cm == c('_') || cm == c('-') {
                let mut tr = Run::new(1, 1);
                if thematic_break(p, &mut tr, &line, true).is_some() {
                    break;
                }
            }
        }
        let prev_empty = empty;
        empty = !prefixed && trim(&content).is_empty();
        if indented && !items.is_empty() {
            let it = items.last_mut().unwrap();
            it.value.extend(empty_lines.iter().cloned());
            it.value.push(line.clone());
            all_lines.extend(empty_lines.drain(..));
            all_lines.push(line);
        } else if prefixed {
            if !empty_lines.is_empty() {
                spread = true;
                if let Some(it) = items.last_mut() {
                    it.value.push(S::new());
                    it.trail = empty_lines.clone();
                }
            }
            items.push(Item { value: vec![line.clone()], indent: size, trail: Vec::new() });
            all_lines.extend(empty_lines.drain(..));
            all_lines.push(line);
        } else if empty {
            if prev_empty && false {
                break;
            }
            empty_lines.push(line);
        } else {
            if prev_empty {
                break;
            }
            if interrupt(p, INT_LIST, &line) {
                break;
            }
            if let Some(it) = items.last_mut() {
                it.value.extend(empty_lines.iter().cloned());
                it.value.push(line.clone());
            }
            all_lines.extend(empty_lines.drain(..));
            all_lines.push(line);
        }
        index = next_index + 1;
        next_index = 0;
        let _ = next_index;
    }
    let _ = spread;
    let all = join_owned(&all_lines);
    let s = r.now(p);
    let mut tmp = r.clone();
    tmp.eat(p, &all);
    let e = tmp.now(p);
    let mut node = mk(Ty::List, s, e);
    node.ordered = ordered;
    node.start = start;
    let save_list = p.in_list;
    let save_block = p.in_block;
    p.in_list = true;
    p.in_block = true;
    let count = items.len();
    let mut loose = false;
    for (i, it) in items.iter().enumerate() {
        let item = join_owned(&it.value);
        let now = r.now(p);
        let st_pt = r.eat(p, &item);
        let en_pt = r.now(p);
        let mut li = list_item(p, &item, now);
        li.s = st_pt;
        li.e = en_pt;
        if li.spread {
            loose = true;
        }
        node.ch.push(li);
        let mut trail = join_owned(&it.trail);
        if i != count - 1 {
            trail.push(LF);
        }
        r.eat(p, &trail);
    }
    p.in_list = save_list;
    p.in_block = save_block;
    node.spread = loose;
    Some(Some(node))
}

// ---------------------------------------------------------------------------------------------- definitions

fn footnote_definition(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let a_len = v.len() + 1;
    let mut s = 0;
    while s < a_len && (at(v, s) == TAB || at(v, s) == SP) && s < v.len() {
        s += 1;
    }
    if !(at(v, s) == c('[') && s < v.len()) {
        return None;
    }
    s += 1;
    if !(at(v, s) == c('^') && s < v.len()) {
        return None;
    }
    s += 1;
    let i0 = s;
    let mut o: Option<usize> = None;
    while s < a_len {
        if s >= v.len() {
            return None;
        }
        let a = v[s];
        if a == LF || a == TAB || a == SP {
            return None;
        }
        if a == c(']') {
            o = Some(s);
            s += 1;
            break;
        }
        s += 1;
    }
    let o = o?;
    if i0 == o || !(at(v, s) == c(':') && s < v.len()) {
        return None;
    }
    s += 1;
    if silent {
        return Some(None);
    }
    let label = v[i0..o].to_vec();
    let l = r.now(p);
    struct Rec {
        start: usize,
        cs: usize,
        ce: usize,
        end: usize,
    }
    let mut h = 0usize;
    let mut pp: Option<usize> = Some(0);
    let mut y: Option<usize> = Some(s);
    let mut recs: Vec<Rec> = Vec::new();
    while s < a_len {
        let exists = s < v.len();
        let a = at(v, s);
        if !exists || a == LF {
            let mut b = Rec { start: h, cs: y.unwrap_or(s), ce: s, end: s };
            if exists {
                h = s + 1;
                pp = Some(0);
                y = None;
                b.end = h;
            }
            recs.push(b);
        } else if let Some(pv) = pp {
            if a == SP || a == TAB {
                let np = pv + if a == SP { 1 } else { 4 - pv % 4 };
                if np > 4 {
                    pp = None;
                    y = Some(s);
                } else {
                    pp = Some(np);
                }
            } else {
                if pv < 4 {
                    if let Some(b) = recs.last() {
                        if b.cs == b.ce || interrupt(p, INT_FOOTNOTE, sl(v, s, 1024)) {
                            break;
                        }
                    }
                }
                pp = None;
                y = Some(s);
            }
        }
        s += 1;
    }
    let mut n_rec = recs.len();
    while n_rec > 0 && recs[n_rec - 1].cs == recs[n_rec - 1].ce {
        n_rec -= 1;
    }
    let last_idx = if n_rec > 0 { n_rec - 1 } else { 0 };
    let ce = recs[last_idx].ce;
    let mut content: S = Vec::new();
    let sline = l.line;
    let sp = r.eat(p, &v[..ce]);
    let ep = r.now(p);
    for k in 0..n_rec {
        let b = &recs[k];
        p.add_off(sline + k, (b.cs - b.start) as i64);
        content.extend_from_slice(sl(v, b.cs, b.end));
    }
    let save = p.in_block;
    p.in_block = true;
    let kids = p.tokenize_block(&content, l.line, l.col);
    p.in_block = save;
    let mut n = mk(Ty::FootnoteDefinition, sp, ep);
    n.ident = to_lower_str(&label);
    n.label = label;
    n.ch = kids;
    Some(Some(n))
}

fn definition(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let length = v.len();
    let mut index = 0;
    let mut sub: S = Vec::new();
    while index < length && (v[index] == SP || v[index] == TAB) {
        sub.push(v[index]);
        index += 1;
    }
    if !(at(v, index) == c('[') && index < length) {
        return None;
    }
    if at(v, index + 1) == c('^') {
        return None;
    }
    index += 1;
    sub.push(c('['));
    let mut queue: S = Vec::new();
    while index < length {
        let mut ch = v[index];
        if ch == c(']') {
            break;
        } else if ch == c('\\') {
            queue.push(ch);
            index += 1;
            ch = at(v, index);
            if index >= length {
                break;
            }
        }
        queue.push(ch);
        index += 1;
    }
    if queue.is_empty() || at(v, index) != c(']') || index >= length || at(v, index + 1) != c(':') || index + 1 >= length {
        return None;
    }
    let identifier = queue.clone();
    sub.extend_from_slice(&queue);
    sub.push(c(']'));
    sub.push(c(':'));
    index = sub.len();
    while index < length && (v[index] == TAB || v[index] == SP || v[index] == LF) {
        sub.push(v[index]);
        index += 1;
    }
    let mut ch = at(v, index);
    let mut queue: S = Vec::new();
    let before_url = sub.clone();
    if ch == c('<') && index < length {
        index += 1;
        while index < length {
            ch = v[index];
            if ch == c('>') || ch == c('[') || ch == c(']') {
                break;
            }
            queue.push(ch);
            index += 1;
        }
        ch = at(v, index);
        if ch == c('>') && index < length {
            sub.push(c('<'));
            sub.extend_from_slice(&queue);
            sub.push(ch);
            index += 1;
        } else {
            return None; // commonmark: unclosed enclosed url
        }
    }
    if queue.is_empty() {
        while index < length {
            ch = v[index];
            if ch == c('[') || ch == c(']') || is_ws(ch) {
                break;
            }
            queue.push(ch);
            index += 1;
        }
        sub.extend_from_slice(&queue);
    }
    if queue.is_empty() {
        return None;
    }
    let url = queue.clone();
    let mut queue: S = Vec::new();
    while index < length && (v[index] == TAB || v[index] == SP || v[index] == LF) {
        queue.push(v[index]);
        index += 1;
    }
    ch = at(v, index);
    let test: Option<u16> = if index >= length {
        None
    } else if ch == c('"') {
        Some(c('"'))
    } else if ch == c('\'') {
        Some(c('\''))
    } else if ch == c('(') {
        Some(c(')'))
    } else {
        None
    };
    let mut title: Option<S> = None;
    let mut before_title_len = 0;
    match test {
        None => {
            index = sub.len();
        }
        Some(t) => {
            if queue.is_empty() {
                return None;
            }
            sub.extend_from_slice(&queue);
            sub.push(ch);
            index = sub.len();
            let mut q: S = Vec::new();
            while index < length {
                ch = v[index];
                if ch == t {
                    break;
                }
                if ch == LF {
                    index += 1;
                    ch = at(v, index);
                    if index >= length || ch == t || ch == LF {
                        return None;
                    }
                    q.push(LF);
                }
                q.push(ch);
                index += 1;
            }
            ch = at(v, index);
            if ch != t || index >= length {
                return None;
            }
            before_title_len = sub.len();
            sub.extend_from_slice(&q);
            sub.push(ch);
            index += 1;
            title = Some(q);
        }
    }
    let _ = before_title_len;
    while index < length && (v[index] == TAB || v[index] == SP) {
        sub.push(v[index]);
        index += 1;
    }
    let ex = index < length;
    if !ex || v[index] == LF {
        if silent {
            return Some(None);
        }
        let _ = before_url;
        let url_d = decode_raw(&unescape(&url));
        let title_d = title.map(|t| decode_raw(&unescape(&t))).filter(|t| !t.is_empty());
        let mut n = done(p, r, &sub, Ty::Definition);
        n.ident = normalize_id(&identifier);
        n.label = identifier;
        n.title = title_d;
        n.url = url_d;
        return Some(Some(n));
    }
    None
}

// ---------------------------------------------------------------------------------------------- table

fn table(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let mut index = 0;
    let mut line_count: isize = 0;
    let length = v.len() + 1;
    let mut lines: Vec<S> = Vec::new();
    while index < length {
        let mut line_index = find(v, LF, index).unwrap_or(v.len());
        let pipe_index = find(v, c('|'), index + 1);
        if line_index > v.len() {
            line_index = v.len();
        }
        match pipe_index {
            Some(pi) if pi <= line_index => {}
            _ => {
                if line_count < 2 {
                    return None;
                }
                break;
            }
        }
        lines.push(sl(v, index, line_index).to_vec());
        line_count += 1;
        index = line_index + 1;
    }
    let sub_all = join_owned(&lines);
    let alignments: S = if lines.len() > 1 { lines.remove(1) } else { S::new() };
    // the header and the delimiter row must agree on a pipe in the very first column
    if (at(&lines[0], 0) == c('|') && !lines[0].is_empty()) != (at(&alignments, 0) == c('|') && !alignments.is_empty()) {
        return None;
    }
    line_count -= 1;
    let mut align: Vec<u8> = Vec::new();
    let mut alignment: Option<Option<u8>> = None; // None = false, Some(None) = null, Some(Some(a))
    let mut first: Option<bool> = None;
    let mut has_dash: Option<bool> = None;
    for &ch in alignments.iter() {
        if ch == c('|') {
            has_dash = None;
            if alignment.is_none() {
                if first == Some(false) {
                    return None;
                }
            } else {
                align.push(alignment.unwrap().unwrap_or(0));
                alignment = None;
            }
            first = Some(false);
        } else if ch == c('-') {
            has_dash = Some(true);
            if alignment.is_none() {
                alignment = Some(None);
            }
        } else if ch == c(':') {
            if alignment == Some(Some(1)) {
                alignment = Some(Some(3));
            } else if has_dash == Some(true) && alignment == Some(None) {
                alignment = Some(Some(2));
            } else {
                alignment = Some(Some(1));
            }
        } else if !is_ws(ch) {
            return None;
        }
    }
    if let Some(a) = alignment {
        align.push(a.unwrap_or(0));
    }
    if align.is_empty() {
        return None;
    }
    if silent {
        return Some(None);
    }
    let s = r.now(p);
    let mut tmp = r.clone();
    tmp.eat(p, &sub_all);
    let e = tmp.now(p);
    let mut tnode = mk(Ty::Table, s, e);
    tnode.align = align;
    let mut position: isize = -1;
    loop {
        position += 1;
        if position >= line_count {
            break;
        }
        let line = lines[position as usize].clone();
        let mut row = Node::new(Ty::TableRow);
        if position > 0 {
            r.eat(p, &[LF]);
        }
        row.s = r.now(p);
        let mut tmp = r.clone();
        tmp.eat(p, &line);
        row.e = tmp.now(p);
        let len = line.len() + 1;
        let mut idx = 0;
        let mut queue: S = Vec::new();
        let mut cell: S = Vec::new();
        let mut preamble = true;
        while idx < len {
            let ch = at(&line, idx);
            let exists = idx < line.len();
            if exists && (ch == TAB || ch == SP) {
                if !cell.is_empty() {
                    queue.push(ch);
                } else {
                    r.eat(p, &[ch]);
                }
                idx += 1;
                continue;
            }
            if !exists || ch == c('|') {
                if preamble {
                    if exists {
                        r.eat(p, &[ch]);
                    }
                } else {
                    if !cell.is_empty() || exists {
                        let mut subv = cell.clone();
                        if queue.len() > 1 {
                            if exists {
                                subv.extend_from_slice(&queue[..queue.len() - 1]);
                                queue = vec![queue[queue.len() - 1]];
                            } else {
                                subv.extend_from_slice(&queue);
                                queue.clear();
                            }
                        }
                        let now = r.now(p);
                        let kids = p.tokenize_inline(&cell, now.line, now.col);
                        let cs = r.eat(p, &subv);
                        let ce = r.now(p);
                        let mut cn = mk(Ty::TableCell, cs, ce);
                        cn.ch = kids;
                        row.ch.push(cn);
                    }
                    let mut q2 = queue.clone();
                    if exists {
                        q2.push(ch);
                    }
                    r.eat(p, &q2);
                    queue.clear();
                    cell.clear();
                }
            } else {
                if !queue.is_empty() {
                    cell.append(&mut queue);
                }
                cell.push(ch);
                if ch == c('\\') && idx != len - 1 {
                    cell.push(at(&line, idx + 1));
                    idx += 1;
                }
            }
            preamble = false;
            idx += 1;
        }
        if position == 0 {
            let mut a = vec![LF];
            a.extend_from_slice(&alignments);
            r.eat(p, &a);
        }
        tnode.ch.push(row);
    }
    Some(Some(tnode))
}
