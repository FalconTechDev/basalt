// Inline tokenizers and their locators.
use crate::block::{match_html_tag, sl};
use crate::node::*;
use crate::parse::*;
use crate::util::*;

const METHODS_LOC: &[&str] = &[
    "escape", "autoLink", "url", "email", "html", "ilink", "link", "inlineNote", "footnoteCall", "reference", "strong", "emphasis", "deletion", "code", "break",
    "mark", "tag", "math", "blockid", "comment",
];

pub fn run(p: &mut P, name: &str, r: &mut Run, v: &[u16], silent: bool) -> Out {
    match name {
        "escape" => escape(p, r, v, silent),
        "autoLink" => auto_link(p, r, v, silent),
        "url" => url(p, r, v, silent),
        "email" => email(p, r, v, silent),
        "html" => inline_html(p, r, v, silent),
        "ilink" => ilink(p, r, v, silent),
        "link" => link(p, r, v, silent),
        "inlineNote" => inline_note(p, r, v, silent),
        "footnoteCall" => footnote_call(p, r, v, silent),
        "reference" => reference(p, r, v, silent),
        "strong" => strong(p, r, v, silent),
        "emphasis" => emphasis(p, r, v, silent),
        "deletion" => deletion(p, r, v, silent),
        "code" => code(p, r, v, silent),
        "break" => brk(p, r, v, silent),
        "mark" => mark(p, r, v, silent),
        "tag" => tag(p, r, v, silent),
        "math" => math(p, r, v, silent),
        "blockid" => blockid(p, r, v, silent),
        "comment" => comment(p, r, v, silent),
        "text" => text(p, r, v, silent),
        _ => None,
    }
}

fn done(p: &P, r: &mut Run, sub: &[u16], ty: Ty) -> Node {
    let s = r.eat(p, sub);
    let e = r.now(p);
    mk(ty, s, e)
}

fn locate(name: &str, v: &[u16], from: usize) -> Option<usize> {
    match name {
        "escape" => find(v, c('\\'), from),
        "autoLink" | "html" => find(v, c('<'), from),
        "email" => {
            let mut from = from;
            loop {
                let rr = find(v, c('@'), from)?;
                let ok = |x: u16| is_digit(x) || is_alpha(x) || x == c('+') || x == c('-') || x == c('.') || x == c('_');
                if rr == from || !ok(v[rr - 1]) {
                    from = rr + 1;
                    continue;
                }
                let mut i = rr;
                while i > from && ok(v[i - 1]) {
                    i -= 1;
                }
                return Some(i);
            }
        }
        "url" => {
            let mut min: Option<usize> = None;
            for pr in ["www.", "http://", "https://"] {
                if let Some(k) = find_str(v, &u(pr), from) {
                    if min.map_or(true, |m| k < m) {
                        min = Some(k);
                    }
                }
            }
            min
        }
        "ilink" => {
            let mut i = from;
            while i + 1 < v.len() {
                if v[i] == c('[') && v[i + 1] == c('[') {
                    return Some(i);
                }
                if v[i] == c('!') && i + 2 < v.len() && v[i + 1] == c('[') && v[i + 2] == c('[') {
                    return Some(i);
                }
                i += 1;
            }
            None
        }
        "link" | "reference" => {
            let l = find(v, c('['), from);
            let im = find_str(v, &u("!["), from);
            match (l, im) {
                (Some(a), Some(b)) => Some(a.min(b)),
                (a, None) => a,
                (None, b) => b,
            }
        }
        "inlineNote" => find_str(v, &u("^["), from),
        "footnoteCall" => find(v, c('['), from),
        "strong" => {
            let a = find_str(v, &u("**"), from);
            let b = find_str(v, &u("__"), from);
            match (a, b) {
                (Some(x), Some(y)) => Some(x.min(y)),
                (x, None) => x,
                (None, y) => y,
            }
        }
        "emphasis" => {
            let a = find(v, c('*'), from);
            let b = find(v, c('_'), from);
            match (a, b) {
                (Some(x), Some(y)) => Some(x.min(y)),
                (x, None) => x,
                (None, y) => y,
            }
        }
        "deletion" => find_str(v, &u("~~"), from),
        "code" => find(v, c('`'), from),
        "break" => {
            let mut idx = find(v, LF, from)?;
            while idx > from {
                if v[idx - 1] != SP {
                    break;
                }
                idx -= 1;
            }
            Some(idx)
        }
        "mark" => find_str(v, &u("=="), from),
        "tag" => {
            let mut rr = from;
            while let Some(k) = find(v, c('#'), rr) {
                if k == 0 {
                    return Some(k);
                }
                if is_ws(v[k - 1]) {
                    return Some(k);
                }
                rr = k + 1;
            }
            None
        }
        "math" => find(v, c('$'), from),
        "blockid" => {
            let mut rr = from;
            while let Some(k) = find(v, c('^'), rr) {
                if k == 0 {
                    return None;
                }
                if is_ws(v[k - 1]) {
                    return Some(k);
                }
                rr = k + 1;
            }
            None
        }
        "comment" => find_str(v, &u("%%"), from),
        _ => None,
    }
}

fn text(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let mut min = v.len();
    if !p.only_text {
        for &m in METHODS_LOC {
            if let Some(k) = locate(m, v, 1) {
                if k < min {
                    min = k;
                }
            }
        }
    }
    if silent {
        return Some(None);
    }
    let sub = &v[..min];
    let mut i = 0;
    let mut seg = 0;
    let mut nodes: Vec<Node> = Vec::new();
    while i < sub.len() {
        if sub[i] == c('&') {
            if let Some((len, dec)) = entity_at(&sub[i..]) {
                if i > seg {
                    let s = r.eat(p, &sub[seg..i]);
                    let e = r.now(p);
                    let mut n = mk(Ty::Text, s, e);
                    n.val = sub[seg..i].to_vec();
                    nodes.push(n);
                }
                let s = r.eat(p, &sub[i..i + len]);
                let e = r.now(p);
                let mut n = mk(Ty::Text, s, e);
                n.val = dec;
                nodes.push(n);
                i += len;
                seg = i;
                continue;
            }
        }
        i += 1;
    }
    if sub.len() > seg {
        let s = r.eat(p, &sub[seg..]);
        let e = r.now(p);
        let mut n = mk(Ty::Text, s, e);
        n.val = sub[seg..].to_vec();
        nodes.push(n);
    }
    p.extra.extend(nodes);
    Some(None)
}

fn escape(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    if at(v, 0) == c('\\') && v.len() > 1 {
        let ch = v[1];
        if is_escapable(ch) {
            if silent {
                return Some(None);
            }
            if ch == LF {
                return Some(Some(done(p, r, &v[..2], Ty::Break)));
            }
            let mut n = done(p, r, &v[..2], Ty::Text);
            n.val = vec![ch];
            return Some(Some(n));
        }
    }
    None
}

fn is_url_ws(x: u16) -> bool {
    is_ws(x)
}

fn auto_link(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    if p.in_link {
        return None;
    }
    let length = v.len();
    if at(v, 0) != c('<') || length == 0 {
        return None;
    }
    let mut index = 1;
    let mut queue: S = Vec::new();
    while index < length {
        let ch = v[index];
        if is_url_ws(ch) || ch == c('>') || ch == c('@') || (ch == c(':') && at(v, index + 1) == c('/') && index + 1 < length) {
            break;
        }
        queue.push(ch);
        index += 1;
    }
    if queue.is_empty() {
        return None;
    }
    let mut link: S = queue.clone();
    let mut has_at = false;
    let ch = at(v, index);
    let ex = index < length;
    link.push(ch);
    index += 1;
    if ex && ch == c('@') {
        has_at = true;
    } else {
        if !ex || ch != c(':') || at(v, index + 1) != c('/') || index + 1 >= length {
            return None;
        }
        link.push(c('/'));
        index += 1;
    }
    queue.clear();
    while index < length {
        let ch = v[index];
        if is_url_ws(ch) || ch == c('>') {
            break;
        }
        queue.push(ch);
        index += 1;
    }
    if queue.is_empty() || at(v, index) != c('>') || index >= length {
        return None;
    }
    if silent {
        return Some(None);
    }
    link.extend_from_slice(&queue);
    let mut content = link.clone();
    let mut sub: S = vec![c('<')];
    sub.extend_from_slice(&link);
    sub.push(c('>'));
    let mut now = r.now(p);
    now.col += 1;
    if has_at {
        if starts_with_ci(&link, "mailto:") {
            content = content[7..].to_vec();
            now.col += 7;
        } else {
            let mut l2 = u("mailto:");
            l2.extend_from_slice(&link);
            link = l2;
        }
    }
    let save_only = p.only_text;
    let save_link = p.in_link;
    p.only_text = true;
    p.in_link = true;
    let kids = p.tokenize_inline(&content, now.line, now.col);
    p.only_text = save_only;
    p.in_link = save_link;
    let mut n = done(p, r, &sub, Ty::Link);
    n.url = decode_raw(&link);
    n.ch = kids;
    Some(Some(n))
}

fn url(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    if p.in_link {
        return None;
    }
    let u_len = v.len();
    let www;
    let mut c0;
    if starts_with(v, "www.") {
        www = true;
        c0 = 4;
    } else if starts_with_ci(v, "http://") {
        www = false;
        c0 = 7;
    } else if starts_with_ci(v, "https://") {
        www = false;
        c0 = 8;
    } else {
        return None;
    }
    // the domain: letters, digits, `-`, `_`, separated by single dots
    let mut prev_dot = c0 as isize - 1;
    let e0 = c0;
    let mut dots: Vec<usize> = Vec::new();
    let mut t: u16 = 0;
    while c0 < u_len {
        t = v[c0];
        if t != c('.') {
            if !(is_digit(t) || is_alpha(t)) && t != c('-') && t != c('_') {
                break;
            }
            c0 += 1;
        } else {
            if prev_dot == c0 as isize - 1 {
                break;
            }
            dots.push(c0);
            prev_dot = c0 as isize;
            c0 += 1;
        }
    }
    if t == c('.') {
        dots.pop();
        c0 -= 1;
    }
    if dots.is_empty() {
        return None;
    }
    let s0 = if dots.len() < 2 { e0 } else { dots[dots.len() - 2] + 1 };
    if sl(v, s0, c0).contains(&c('_')) {
        return None;
    }
    if silent {
        return Some(None);
    }
    // the path, minus trailing punctuation
    let o0 = c0;
    let mut l0 = c0;
    while c0 < u_len {
        let t = v[c0];
        if is_ws(t) || t == c('<') {
            break;
        }
        c0 += 1;
        if !matches!(t, 33 | 42 | 44 | 46 | 58 | 63 | 95 | 126) {
            l0 = c0;
        }
    }
    c0 = l0;
    if c0 > 0 && v[c0 - 1] == c(')') {
        let mut n = sl(v, o0, c0).to_vec();
        let opens = n.iter().filter(|&&x| x == c('(')).count();
        let mut closes = n.iter().filter(|&&x| x == c(')')).count();
        while closes > opens {
            match n.iter().rposition(|&x| x == c(')')) {
                Some(k) => {
                    c0 = o0 + k;
                    n = sl(v, o0, c0).to_vec();
                }
                None => break,
            }
            closes -= 1;
        }
    }
    if c0 > 0 && v[c0 - 1] == c(';') {
        c0 -= 1;
        if c0 > 0 && is_alpha(v[c0 - 1]) {
            let mut l = c0 as isize - 2;
            while l >= 0 && is_alpha(v[l as usize]) {
                l -= 1;
            }
            if l >= 0 && v[l as usize] == c('&') {
                c0 = l as usize;
            }
        }
    }
    let sub = &v[..c0];
    let mut url = decode_raw(sub);
    if www {
        let mut h = u("http://");
        h.extend(url);
        url = h;
    }
    let now = r.now(p);
    let save_only = p.only_text;
    let save_link = p.in_link;
    p.only_text = true;
    p.in_link = true;
    let kids = p.tokenize_inline(sub, now.line, now.col);
    p.only_text = save_only;
    p.in_link = save_link;
    let mut n = done(p, r, sub, Ty::Link);
    n.url = url;
    n.ch = kids;
    Some(Some(n))
}

fn email(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    if p.in_link {
        return None;
    }
    let b = v.len();
    let mut i = 0;
    let ok = |x: u16| is_digit(x) || is_alpha(x) || x == c('+') || x == c('-') || x == c('.') || x == c('_');
    let mut s = at(v, 0);
    while i < b && ok(s) {
        i += 1;
        s = at(v, i);
        if i >= b {
            s = 0;
        }
    }
    if i == 0 || s != c('@') || i >= b {
        return None;
    }
    i += 1;
    let mut k: isize = -1;
    while i < b {
        s = v[i];
        if !(is_digit(s) || is_alpha(s) || s == c('-') || s == c('.') || s == c('_')) {
            break;
        }
        i += 1;
        if k == -1 && s == c('.') {
            k = i as isize;
        }
    }
    if k != -1 && k != i as isize && s != c('-') && s != c('_') {
        if s == c('.') {
            i -= 1;
        }
        if silent {
            return Some(None);
        }
        let h = &v[..i];
        let now = r.now(p);
        let save_only = p.only_text;
        let save_link = p.in_link;
        p.only_text = true;
        p.in_link = true;
        let kids = p.tokenize_inline(h, now.line, now.col);
        p.only_text = save_only;
        p.in_link = save_link;
        let mut n = done(p, r, h, Ty::Link);
        let mut url = u("mailto:");
        url.extend(decode_raw(h));
        n.url = url;
        n.ch = kids;
        return Some(Some(n));
    }
    None
}

fn inline_html(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    if at(v, 0) != c('<') || v.len() < 3 {
        return None;
    }
    let ch = v[1];
    if !is_alpha(ch) && ch != c('?') && ch != c('!') && ch != c('/') {
        return None;
    }
    let k = match_html_tag(v)?;
    if silent {
        return Some(None);
    }
    let sub = &v[..k];
    if !p.in_link && starts_with_ci(sub, "<a ") {
        p.in_link = true;
    } else if p.in_link && starts_with_ci(sub, "</a>") {
        p.in_link = false;
    }
    let mut n = done(p, r, sub, Ty::Html);
    n.val = sub.to_vec();
    Some(Some(n))
}

// [[target|alias]] and ![[embed]]
fn ilink(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let mut i = 0;
    let embed = at(v, 0) == c('!') && !v.is_empty();
    if embed {
        i = 1;
    }
    if !(at(v, i) == c('[') && at(v, i + 1) == c('[') && i + 1 < v.len()) {
        return None;
    }
    let g0 = i + 2;
    // `.+?` then `]]`, no line terminators
    let mut k = g0;
    let mut end: Option<usize> = None;
    while k < v.len() {
        let x = v[k];
        if x == LF || x == 13 || x == 0x2028 || x == 0x2029 {
            break;
        }
        if k > g0 && x == c(']') && at(v, k + 1) == c(']') && k + 1 < v.len() {
            end = Some(k);
            break;
        }
        k += 1;
    }
    let end = end?;
    let group = &v[g0..end];
    let o = trim(group);
    if find_str(o, &u("[["), 0).is_some() {
        return None;
    }
    if silent {
        return Some(None);
    }
    let whole = &v[..end + 2];
    let (href, title, is_alias) = crate::meta::split_link(o);
    let mut n = done(p, r, whole, if embed { Ty::IEmbed } else { Ty::ILink });
    n.url = href;
    n.title = Some(title);
    n.reftype = if is_alias { 1 } else { 0 };
    Some(Some(n))
}

fn link(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let length = v.len();
    let mut sub: S = Vec::new();
    let mut index = 0;
    let mut ch = at(v, 0);
    let mut is_image = false;
    if ch == c('!') && length > 0 {
        is_image = true;
        sub.push(ch);
        index += 1;
        ch = at(v, index);
    }
    if ch != c('[') || index >= length {
        return None;
    }
    if !is_image && p.in_link {
        return None;
    }
    sub.push(ch);
    let mut queue: S = Vec::new();
    index += 1;
    let mut now = r.now(p);
    now.col += index;
    let mut depth: i32 = 0;
    let mut opening = 0;
    let mut closed = false;
    let mut subqueue: S = Vec::new();
    while index < length {
        let mut ch = v[index];
        subqueue = vec![ch];
        if ch == c('`') {
            let mut count = 1;
            while at(v, index + 1) == c('`') && index + 1 < length {
                subqueue.push(ch);
                index += 1;
                count += 1;
            }
            if opening == 0 {
                opening = count;
            } else if count >= opening {
                opening = 0;
            }
        } else if ch == c('\\') {
            index += 1;
            if index < length {
                subqueue.push(v[index]);
            }
        } else if ch == c('[') {
            depth += 1;
        } else if ch == c(']') {
            if depth > 0 {
                depth -= 1;
            } else {
                if at(v, index + 1) != c('(') || index + 1 >= length {
                    return None;
                }
                subqueue.push(c('('));
                closed = true;
                index += 1;
                break;
            }
        }
        queue.append(&mut subqueue);
        index += 1;
    }
    if !closed {
        return None;
    }
    let content = queue.clone();
    sub.extend_from_slice(&queue);
    sub.extend_from_slice(&subqueue);
    index += 1;
    while index < length {
        let ch = v[index];
        if !is_ws(ch) {
            break;
        }
        sub.push(ch);
        index += 1;
    }
    let mut ch = at(v, index);
    let mut queue: S = Vec::new();
    let url_raw: S;
    if ch == c('<') && index < length {
        index += 1;
        loop {
            if index >= length {
                break;
            }
            ch = v[index];
            if ch == c('>') {
                break;
            }
            if ch == LF {
                return None;
            }
            queue.push(ch);
            index += 1;
        }
        if at(v, index) != c('>') || index >= length {
            return None;
        }
        sub.push(c('<'));
        sub.extend_from_slice(&queue);
        sub.push(c('>'));
        url_raw = queue.clone();
        index += 1;
    } else {
        let mut sq: S = Vec::new();
        while index < length {
            let ch = v[index];
            if !sq.is_empty() && (ch == c('"') || ch == c('\'') || ch == c('(')) {
                break;
            }
            if is_ws(ch) {
                break;
            } else {
                if ch == c('(') {
                    depth += 1;
                } else if ch == c(')') {
                    if depth == 0 {
                        break;
                    }
                    depth -= 1;
                }
                queue.append(&mut sq);
                let mut ch2 = ch;
                if ch == c('\\') {
                    queue.push(c('\\'));
                    index += 1;
                    ch2 = at(v, index);
                    if index >= length {
                        break;
                    }
                }
                queue.push(ch2);
            }
            index += 1;
        }
        sub.extend_from_slice(&queue);
        url_raw = queue.clone();
        index = sub.len();
    }
    let mut q: S = Vec::new();
    while index < length {
        let ch = v[index];
        if !is_ws(ch) {
            break;
        }
        q.push(ch);
        index += 1;
    }
    ch = at(v, index);
    sub.extend_from_slice(&q);
    let mut title: Option<S> = None;
    if !q.is_empty() && index < length && (ch == c('"') || ch == c('\'') || ch == c('(')) {
        index += 1;
        sub.push(ch);
        let marker = if ch == c('(') { c(')') } else { ch };
        let mut tq: S = Vec::new();
        while index < length {
            let mut ch = v[index];
            if ch == marker {
                break;
            }
            if ch == c('\\') {
                tq.push(c('\\'));
                index += 1;
                ch = at(v, index);
            }
            index += 1;
            tq.push(ch);
        }
        ch = at(v, index);
        if ch != marker || index >= length {
            return None;
        }
        sub.extend_from_slice(&tq);
        sub.push(ch);
        title = Some(tq);
        index += 1;
        while index < length {
            let ch = v[index];
            if !is_ws(ch) {
                break;
            }
            sub.push(ch);
            index += 1;
        }
    }
    if at(v, index) != c(')') || index >= length {
        return None;
    }
    if silent {
        return Some(None);
    }
    sub.push(c(')'));
    let url_d = decode_raw(&unescape(&url_raw));
    let title_d = title.map(|t| decode_raw(&unescape(&t))).filter(|t| !t.is_empty());
    let mut kids = Vec::new();
    let mut alt = None;
    if is_image {
        let a = decode_raw(&unescape(&content));
        alt = if a.is_empty() { None } else { Some(a) };
    } else {
        let save = p.in_link;
        p.in_link = true;
        kids = p.tokenize_inline(&content, now.line, now.col);
        p.in_link = save;
    }
    let mut n = done(p, r, &sub, if is_image { Ty::Image } else { Ty::Link });
    n.url = url_d;
    n.title = title_d;
    n.alt = alt;
    n.ch = kids;
    Some(Some(n))
}

fn inline_note(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let u_len = v.len() + 1;
    let mut f = 0;
    if !(at(v, f) == c('^') && f < v.len()) {
        return None;
    }
    f += 1;
    if !(at(v, f) == c('[') && f < v.len()) {
        return None;
    }
    f += 1;
    let o = f;
    let mut h = 0;
    let mut l: Option<usize> = None;
    let mut s: Option<usize> = None;
    while f < u_len {
        if f >= v.len() {
            return None;
        }
        let i = v[f];
        match l {
            None => {
                if i == c('\\') {
                    f += 2;
                } else if i == c('[') {
                    h += 1;
                    f += 1;
                } else if i == c(']') {
                    if h == 0 {
                        s = Some(f);
                        f += 1;
                        break;
                    }
                    h -= 1;
                    f += 1;
                } else if i == c('`') {
                    let mut ll = 1;
                    while at(v, f + ll) == c('`') && f + ll < v.len() {
                        ll += 1;
                    }
                    l = Some(ll);
                    f += ll;
                } else {
                    f += 1;
                }
            }
            Some(lv) => {
                if i == c('`') {
                    let mut cc = 1;
                    while at(v, f + cc) == c('`') && f + cc < v.len() {
                        cc += 1;
                    }
                    f += cc;
                    if lv == cc {
                        l = None;
                    }
                } else {
                    f += 1;
                }
            }
        }
    }
    let s = s?;
    if silent {
        return Some(None);
    }
    let mut now = r.now(p);
    now.col += 2;
    let kids = p.tokenize_inline(sl(v, o, s), now.line, now.col);
    let mut n = done(p, r, &v[..f], Ty::Footnote);
    n.ch = kids;
    Some(Some(n))
}

fn footnote_call(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let a = v.len() + 1;
    let mut l = 0;
    if !(at(v, l) == c('[') && l < v.len()) {
        return None;
    }
    l += 1;
    if !(at(v, l) == c('^') && l < v.len()) {
        return None;
    }
    l += 1;
    let i = l;
    let mut o: Option<usize> = None;
    while l < a {
        if l >= v.len() {
            return None;
        }
        let s = v[l];
        if s == LF || s == TAB || s == SP {
            return None;
        }
        if s == c(']') {
            o = Some(l);
            l += 1;
            break;
        }
        l += 1;
    }
    let o = o?;
    if i == o {
        return None;
    }
    if silent {
        return Some(None);
    }
    let label = v[i..o].to_vec();
    let mut n = done(p, r, &v[..l], Ty::FootnoteReference);
    n.ident = to_lower_str(&label);
    n.label = label;
    Some(Some(n))
}

fn reference(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let length = v.len();
    let mut index = 0;
    let mut ch = at(v, 0);
    let mut intro: S = Vec::new();
    let mut is_image = false;
    if ch == c('!') && length > 0 {
        is_image = true;
        intro.push(ch);
        index += 1;
        ch = at(v, index);
    }
    if ch != c('[') || index >= length {
        return None;
    }
    // footnote-ish labels are handled by their own tokenizer
    if at(v, index + 1) == c('^') && index + 1 < length {
        return None;
    }
    index += 1;
    intro.push(ch);
    let mut queue: S = Vec::new();
    let mut depth = 0;
    let mut bracketed = false;
    while index < length {
        ch = v[index];
        if ch == c('[') {
            bracketed = true;
            depth += 1;
        } else if ch == c(']') {
            if depth == 0 {
                break;
            }
            depth -= 1;
        }
        if ch == c('\\') {
            queue.push(ch);
            index += 1;
            if index >= length {
                break;
            }
            ch = v[index];
        }
        queue.push(ch);
        index += 1;
    }
    let mut sub: S = queue.clone();
    let content = queue.clone();
    if at(v, index) != c(']') || index >= length {
        return None;
    }
    index += 1;
    sub.push(c(']'));
    let mut reftype = 0u8;
    let identifier: S;
    if at(v, index) == c('[') && index < length {
        let mut idq: S = Vec::new();
        let mut q: S = vec![c('[')];
        index += 1;
        while index < length {
            let mut ch = v[index];
            if ch == c('[') || ch == c(']') {
                break;
            }
            if ch == c('\\') {
                idq.push(ch);
                index += 1;
                ch = at(v, index);
                if index >= length {
                    break;
                }
            }
            idq.push(ch);
            index += 1;
        }
        let mut ident = idq.clone();
        if at(v, index) == c(']') && index < length {
            reftype = if idq.is_empty() { 1 } else { 2 };
            q.extend_from_slice(&idq);
            q.push(c(']'));
            index += 1;
        } else {
            ident.clear();
        }
        sub.extend_from_slice(&q);
        identifier = ident;
    } else {
        if content.is_empty() {
            return None;
        }
        identifier = content.clone();
    }
    let _ = index;
    if reftype != 2 && bracketed {
        return None;
    }
    let mut full = intro.clone();
    full.extend_from_slice(&sub);
    if !is_image && p.in_link {
        return None;
    }
    if silent {
        return Some(None);
    }
    let label = if reftype == 2 { identifier.clone() } else { content.clone() };
    let mut now = r.now(p);
    now.col += intro.len();
    let mut kids = Vec::new();
    let mut alt = None;
    if !is_image {
        let save = p.in_link;
        p.in_link = true;
        kids = p.tokenize_inline(&content, now.line, now.col);
        p.in_link = save;
    } else {
        let a = decode_raw(&unescape(&content));
        alt = if a.is_empty() { None } else { Some(a) };
    }
    let mut n = done(p, r, &full, if is_image { Ty::ImageReference } else { Ty::LinkReference });
    n.ident = normalize_id(&label);
    n.label = label;
    n.reftype = reftype;
    n.ch = kids;
    n.alt = alt;
    Some(Some(n))
}

fn strong(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let length = v.len();
    let ch = at(v, 0);
    if (ch != c('*') && ch != c('_')) || length < 2 || at(v, 1) != ch {
        return None;
    }
    let marker = ch;
    let mut index = 2;
    let mut queue: S = Vec::new();
    while index < length {
        let mut ch = v[index];
        if ch == marker && at(v, index + 1) == marker && index + 1 < length {
            ch = at(v, index + 2);
            let ex = index + 2 < length;
            if !(ex && ch == marker) {
                if trim(&queue).is_empty() {
                    return None;
                }
                if silent {
                    return Some(None);
                }
                let mut now = r.now(p);
                now.col += 2;
                let kids = p.tokenize_inline(&queue, now.line, now.col);
                let mut sub = vec![marker, marker];
                sub.extend_from_slice(&queue);
                sub.push(marker);
                sub.push(marker);
                let mut n = done(p, r, &sub, Ty::Strong);
                n.ch = kids;
                return Some(Some(n));
            }
        }
        if ch == c('\\') {
            queue.push(ch);
            index += 1;
            if index >= length {
                break;
            }
            ch = v[index];
        }
        queue.push(ch);
        index += 1;
    }
    None
}

fn emphasis(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let length = v.len();
    let ch = at(v, 0);
    if (ch != c('*') && ch != c('_')) || length == 0 {
        return None;
    }
    let marker = ch;
    let mut index = 1;
    let mut queue: S = Vec::new();
    let mut character: u16 = 0;
    while index < length {
        let prev = character;
        character = v[index];
        if character == marker {
            index += 1;
            character = at(v, index);
            let ex = index < length;
            if !(ex && character == marker) {
                if trim(&queue).is_empty() || prev == marker {
                    return None;
                }
                if marker == c('_') && ex && is_word(character) {
                    queue.push(marker);
                    continue;
                }
                if silent {
                    return Some(None);
                }
                let mut now = r.now(p);
                now.col += 1;
                let kids = p.tokenize_inline(&queue, now.line, now.col);
                let mut sub = vec![marker];
                sub.extend_from_slice(&queue);
                sub.push(marker);
                let mut n = done(p, r, &sub, Ty::Emphasis);
                n.ch = kids;
                return Some(Some(n));
            }
            queue.push(marker);
        }
        if character == c('\\') {
            queue.push(character);
            index += 1;
            character = at(v, index);
            if index >= length {
                break;
            }
        }
        queue.push(character);
        index += 1;
    }
    None
}

fn deletion(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    if !(at(v, 0) == c('~') && at(v, 1) == c('~') && v.len() >= 2) || is_ws(at(v, 2)) && v.len() > 2 {
        return None;
    }
    let length = v.len();
    let mut index = 1;
    let mut now = r.now(p);
    now.col += 2;
    let mut character: u16;
    let mut previous: u16 = 0;
    let mut preceding: u16 = 0;
    let mut subvalue: S = Vec::new();
    loop {
        index += 1;
        if index >= length {
            break;
        }
        character = v[index];
        if character == c('~') && previous == c('~') && (preceding == 0 || !is_ws(preceding)) {
            if silent {
                return Some(None);
            }
            let kids = p.tokenize_inline(&subvalue, now.line, now.col);
            let mut sub = u("~~");
            sub.extend_from_slice(&subvalue);
            sub.extend_from_slice(&u("~~"));
            let mut n = done(p, r, &sub, Ty::Delete);
            n.ch = kids;
            return Some(Some(n));
        }
        if previous != 0 {
            subvalue.push(previous);
        }
        preceding = previous;
        previous = character;
    }
    None
}

fn code(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let length = v.len();
    let mut index = 0;
    while index < length && v[index] == c('`') {
        index += 1;
    }
    if index == 0 || index == length {
        return None;
    }
    let opening_end = index;
    let mut closing_start: Option<usize> = None;
    let mut closing_end: usize = 0;
    let mut next = v[index];
    let mut found = false;
    while index < length {
        let code = next;
        next = at(v, index + 1);
        let ex_next = index + 1 < length;
        if code == c('`') {
            if closing_start.is_none() {
                closing_start = Some(index);
            }
            closing_end = index + 1;
            if !(ex_next && next == c('`')) && closing_end - closing_start.unwrap() == opening_end {
                found = true;
                break;
            }
        } else if closing_start.is_some() {
            closing_start = None;
        }
        index += 1;
    }
    if !found {
        return None;
    }
    if silent {
        return Some(None);
    }
    let mut opening_end = opening_end;
    let mut closing_start = closing_start.unwrap();
    let mut index = opening_end;
    let mut len = closing_start;
    let code0 = v[index];
    let next0 = v[len - 1];
    let mut f = false;
    if len > index && len - index > 2 && (code0 == SP || code0 == LF) && (next0 == SP || next0 == LF) {
        index += 1;
        len -= 1;
        while index < len {
            let cc = v[index];
            if cc != SP && cc != LF {
                f = true;
                break;
            }
            index += 1;
        }
        if f {
            opening_end += 1;
            closing_start -= 1;
        }
    }
    let mut n = done(p, r, &v[..closing_end], Ty::InlineCode);
    n.val = v[opening_end..closing_start].to_vec();
    Some(Some(n))
}

fn brk(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    if !p.breaks {
        // two or more spaces before the line feed
        for (s, &x) in v.iter().enumerate() {
            if x == LF {
                if s < 2 {
                    return None;
                }
                if silent {
                    return Some(None);
                }
                return Some(Some(done(p, r, &v[..s + 1], Ty::Break)));
            }
            if x != SP {
                return None;
            }
        }
        return None;
    }
    for (s, &x) in v.iter().enumerate() {
        if x == LF {
            if silent {
                return Some(None);
            }
            return Some(Some(done(p, r, &v[..s + 1], Ty::Break)));
        }
        if x != SP {
            return None;
        }
    }
    None
}

fn mark(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    if !(starts_with(v, "==") && !starts_with(v, "====")) || is_ws(at(v, 2)) && v.len() > 2 {
        return None;
    }
    let u_len = v.len();
    let mut now = r.now(p);
    now.col += 2;
    let mut o: u16;
    let mut s: u16 = 0;
    let mut a: u16 = 0;
    let mut l: S = Vec::new();
    let mut cc = 1;
    loop {
        cc += 1;
        if cc >= u_len {
            break;
        }
        o = v[cc];
        if o == c('=') && s == c('=') && !(a != 0 && is_ws(a)) {
            if silent {
                return Some(None);
            }
            let kids = p.tokenize_inline(&l, now.line, now.col);
            let mut sub = u("==");
            sub.extend_from_slice(&l);
            sub.extend_from_slice(&u("=="));
            let mut n = done(p, r, &sub, Ty::Mark);
            n.ch = kids;
            return Some(Some(n));
        }
        if s != 0 {
            l.push(s);
        }
        a = s;
        s = o;
    }
    None
}

fn tag_char(x: u16) -> bool {
    if (0x2000..=0x206f).contains(&x) || (0x2e00..=0x2e7f).contains(&x) || is_ws(x) {
        return false;
    }
    if x < 128 && "'!\"#$%&()*+,.:;<=>?@^`{|}~[]\\".contains(x as u8 as char) {
        return false;
    }
    true
}

fn tag(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    if at(v, 0) != c('#') || v.is_empty() {
        return None;
    }
    let mut i = 1;
    while i < v.len() && tag_char(v[i]) {
        i += 1;
    }
    if i == 1 {
        return None;
    }
    let o = &v[..i];
    if o[1..].iter().all(|&x| is_digit(x)) {
        return None;
    }
    if silent {
        return Some(None);
    }
    let mut n = done(p, r, o, Ty::Tag);
    n.val = o.to_vec();
    Some(Some(n))
}

fn math(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    let u_len = v.len();
    let mut dbl = false;
    let mut pp = 0;
    let mut esc = false;
    if at(v, pp) == c('\\') && u_len > 0 {
        esc = true;
        pp += 1;
    }
    if !(at(v, pp) == c('$') && pp < u_len) {
        return None;
    }
    pp += 1;
    if esc {
        if silent {
            return Some(None);
        }
        let mut n = done(p, r, &v[..pp], Ty::Text);
        n.val = vec![c('$')];
        return Some(Some(n));
    }
    if at(v, pp) == c('$') && pp < u_len {
        dbl = true;
        pp += 1;
    }
    let mut o = at(v, pp);
    let o_ex = pp < u_len;
    if !(dbl || (o != SP && o != TAB) || !o_ex) {
        return None;
    }
    let s = pp;
    let mut l: Option<usize> = None;
    let mut a = 0usize;
    while pp < u_len {
        let i = o;
        let o_next_ex = pp + 1 < u_len;
        o = at(v, pp + 1);
        if i == c('$') {
            let rr = if pp > 0 { v[pp - 1] } else { 0 };
            if (!dbl && rr != SP && rr != TAB && (!o_next_ex || o < 48 || o > 57)) || (dbl && o_next_ex && o == c('$')) {
                a = pp - 1;
                pp += 1;
                if dbl {
                    pp += 1;
                    let mut d = pp;
                    while d < u_len {
                        let m = v[d];
                        if m == LF {
                            pp = d + 1;
                            break;
                        }
                        if !is_ws(m) {
                            break;
                        }
                        d += 1;
                    }
                }
                l = Some(pp);
                break;
            }
        } else if i == c('\\') {
            pp += 1;
            o = at(v, pp + 1);
        }
        pp += 1;
    }
    let l = l?;
    if silent {
        return Some(None);
    }
    let content = sl(v, s, a + 1).to_vec();
    let mut n = done(p, r, &v[..l], Ty::InlineMath);
    n.val = content;
    n.is_math_block = dbl;
    Some(Some(n))
}

fn blockid(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    if at(v, 0) != c('^') || v.len() < 2 {
        return None;
    }
    let rest = &v[1..];
    if rest.is_empty() || !rest.iter().all(|&x| is_alpha(x) || is_digit(x) || x == c('-')) {
        return None;
    }
    if silent {
        return Some(None);
    }
    let mut n = done(p, r, v, Ty::Blockid);
    n.id = Some(rest.to_vec());
    Some(Some(n))
}

fn comment(p: &mut P, r: &mut Run, v: &[u16], silent: bool) -> Out {
    if !starts_with(v, "%%") {
        return None;
    }
    // ^%%(.+?)%%
    let mut k = 3;
    let mut end: Option<usize> = None;
    if v.len() < 5 {
        return None;
    }
    if v[2] == LF || v[2] == 13 || v[2] == 0x2028 || v[2] == 0x2029 {
        return None;
    }
    while k + 1 < v.len() {
        let x = v[k - 1];
        if x == LF || x == 13 || x == 0x2028 || x == 0x2029 {
            return None;
        }
        if v[k] == c('%') && v[k + 1] == c('%') {
            end = Some(k);
            break;
        }
        k += 1;
    }
    let end = end?;
    if silent {
        return Some(None);
    }
    let mut now = r.now(p);
    now.col += 2;
    let inner = v[2..end].to_vec();
    let kids = p.tokenize_inline(&inner, now.line, now.col);
    let mut n = done(p, r, &v[..end + 2], Ty::Comment);
    n.ch = kids;
    n.val = inner;
    Some(Some(n))
}
