// Tree transforms that run after parsing (wikilink conversion, footnotes, block ids, callouts ...).
use crate::node::*;
use crate::util::*;
use std::collections::HashMap;

pub const NFC_OPEN: char = '\u{E000}';
pub const NFC_CLOSE: char = '\u{E001}';

/// `[[a#b|c]]` target handling: returns (href, title, is_alias).
pub fn split_link(e: &[u16]) -> (S, S, bool) {
    let pipe = find(e, c('|'), 0);
    let alias = matches!(pipe, Some(k) if k > 0);
    let (target, title): (S, S);
    if alias {
        let k = pipe.unwrap();
        title = trim(&e[k + 1..]).to_vec();
        target = trim(&e[..k]).to_vec();
    } else {
        target = trim(e).to_vec();
        title = hash_path(&target);
    }
    let mut target = target;
    if target.last() == Some(&c('\\')) {
        target.pop();
    }
    (norm_href(&target), title, alias)
}

/// `a#b#c` -> `a > b > c`
pub fn hash_path(e: &[u16]) -> S {
    let parts: Vec<&[u16]> = e.split(|&x| x == c('#')).filter(|p| !p.is_empty()).collect();
    let mut o = S::new();
    for (i, p) in parts.iter().enumerate() {
        if i > 0 {
            o.extend_from_slice(&u(" > "));
        }
        o.extend_from_slice(p);
    }
    trim(&o).to_vec()
}

/// no-break spaces to spaces, trim; the NFC step is marked and finished by the JS shim.
pub fn norm_href(e: &[u16]) -> S {
    let r: S = e.iter().map(|&x| if x == 0xa0 { SP } else { x }).collect();
    let t = trim(&r).to_vec();
    if t.iter().all(|&x| x < 128) {
        return t;
    }
    let mut o = S::new();
    o.push(NFC_OPEN as u16);
    o.extend_from_slice(&t);
    o.push(NFC_CLOSE as u16);
    o
}

fn is_internal(url: &[u16]) -> bool {
    starts_with(url, "./") || starts_with(url, "../") || find(url, c(':'), 0).is_none()
}

/// JavaScript `decodeURI`; None when it would throw.
pub fn decode_uri(v: &[u16]) -> Option<S> {
    let mut out = S::new();
    let mut i = 0;
    let hex = |x: u16| -> Option<u8> {
        match x {
            48..=57 => Some((x - 48) as u8),
            65..=70 => Some((x - 55) as u8),
            97..=102 => Some((x - 87) as u8),
            _ => None,
        }
    };
    while i < v.len() {
        if v[i] != c('%') {
            out.push(v[i]);
            i += 1;
            continue;
        }
        let start = i;
        if i + 2 >= v.len() + 0 && i + 2 > v.len() - 1 + 0 {
            if i + 2 >= v.len() {
                return None;
            }
        }
        let b = hex(v[i + 1])? * 16 + hex(v[i + 2])?;
        i += 3;
        if b < 0x80 {
            if ";/?:@&=+$,#".contains(b as char) {
                out.extend_from_slice(&v[start..i]);
            } else {
                out.push(b as u16);
            }
            continue;
        }
        let n = if b & 0xe0 == 0xc0 {
            2
        } else if b & 0xf0 == 0xe0 {
            3
        } else if b & 0xf8 == 0xf0 {
            4
        } else {
            return None;
        };
        let mut bytes = vec![b];
        for _ in 1..n {
            if i + 2 >= v.len() + 0 && !(i + 2 < v.len()) {
                return None;
            }
            if v[i] != c('%') {
                return None;
            }
            let bb = hex(v[i + 1])? * 16 + hex(v[i + 2])?;
            if bb & 0xc0 != 0x80 {
                return None;
            }
            bytes.push(bb);
            i += 3;
        }
        let s = std::str::from_utf8(&bytes).ok()?;
        out.extend(s.encode_utf16());
    }
    Some(out)
}

pub fn walk_mut(n: &mut Node, f: &mut dyn FnMut(&mut Node)) {
    f(n);
    for ch in n.ch.iter_mut() {
        walk_mut(ch, f);
    }
}

fn size_parse(s: &[u16]) -> Option<(S, S)> {
    // /^\s*([0-9]+)\s*(?:x\s*([0-9]+)\s*)?$/
    let mut i = 0;
    while i < s.len() && is_ws(s[i]) {
        i += 1;
    }
    let a0 = i;
    while i < s.len() && is_digit(s[i]) {
        i += 1;
    }
    if i == a0 {
        return None;
    }
    let x = s[a0..i].to_vec();
    while i < s.len() && is_ws(s[i]) {
        i += 1;
    }
    if i == s.len() {
        return Some((x, S::new()));
    }
    if s[i] != c('x') {
        return None;
    }
    i += 1;
    while i < s.len() && is_ws(s[i]) {
        i += 1;
    }
    let b0 = i;
    while i < s.len() && is_digit(s[i]) {
        i += 1;
    }
    if i == b0 {
        return None;
    }
    let y = s[b0..i].to_vec();
    while i < s.len() && is_ws(s[i]) {
        i += 1;
    }
    if i != s.len() {
        return None;
    }
    Some((x, y))
}

/// Parses an integer the way `parseInt` would (leading zeros dropped).
fn int_str(d: &[u16]) -> S {
    let s = st(d);
    let t = s.trim_start_matches('0');
    if t.is_empty() { u("0") } else { u(t) }
}

fn apply_size(s: &[u16], n: &mut Node) -> bool {
    match size_parse(s) {
        Some((x, y)) => {
            n.width = Some(int_str(&x));
            let yy = int_str(&y);
            if !y.is_empty() && yy != u("0") {
                n.height = Some(yy);
            }
            true
        }
        None => false,
    }
}

pub fn transform(root: &mut Node, orig: &[u16]) {
    // task list items get their checkbox: inside the first paragraph when there is one, else as the first child
    walk_mut(root, &mut |n| {
        if n.ty == Ty::ListItem && n.checked.is_some() {
            let mut cb = Node::new(Ty::Checklist);
            cb.s = n.s;
            cb.e = n.e;
            cb.checked = n.checked;
            cb.checklist = n.checklist.clone();
            match n.ch.first_mut() {
                Some(f) if f.ty == Ty::Paragraph => f.ch.insert(0, cb),
                _ => n.ch.insert(0, cb),
            }
        }
    });
    // links and images to internal links / embeds
    walk_mut(root, &mut |n| match n.ty {
        Ty::Link => {
            if !n.url.is_empty() && is_internal(&n.url) {
                if let Some(d) = decode_uri(&n.url) {
                    let href = norm_href(&d);
                    n.orig_url = n.url.clone();
                    n.ty = Ty::ILink;
                    n.converted = true;
                    n.meta = n.title.take(); // the link's own title attribute
                    n.title = Some(S::new());
                    n.url = href;
                }
            }
        }
        Ty::Image => {
            if !n.url.is_empty() && is_internal(&n.url) {
                let d = decode_uri(&n.url).unwrap_or_else(|| n.url.clone());
                let href = norm_href(&d);
                n.ty = Ty::IEmbed;
                n.converted = true;
                n.url = href;
                n.title = n.alt.clone();
                n.alt = None;
            }
        }
        _ => {}
    });
    footnotes(root);
    // image alt sizes
    walk_mut(root, &mut |n| {
        if n.ty == Ty::Image {
            if let Some(alt) = n.alt.clone() {
                if let Some(k) = alt.iter().rposition(|&x| x == c('|')) {
                    let suffix = alt[k + 1..].to_vec();
                    if apply_size(&suffix, n) {
                        n.alt = Some(alt[..k].to_vec());
                    }
                }
            }
        }
    });
    // embed alt text and size
    walk_mut(root, &mut |n| {
        if n.ty == Ty::IEmbed {
            let t = n.title.clone().unwrap_or_default();
            if !t.is_empty() {
                let mut t2 = t.clone();
                if let Some(k) = t.iter().rposition(|&x| x == c('|')) {
                    if apply_size(&t[k + 1..], n) {
                        t2 = t[..k].to_vec();
                    }
                } else if apply_size(&t, n) {
                    t2 = S::new();
                }
                if t2.is_empty() {
                    t2 = n.url.clone();
                }
                n.alt = Some(t2);
            } else {
                // no title: the initial alt stays (the title itself: empty text, or none for an image without alt)
                n.alt = n.title.clone();
            }
        }
    });
    blockids(root);
    // heading raw text
    walk_mut(root, &mut |n| {
        if n.ty == Ty::Heading {
            let (a, b) = if n.ch.is_empty() { (n.e.off, n.e.off) } else { (n.ch[0].s.off, n.ch[n.ch.len() - 1].e.off) };
            let a = a.max(0) as usize;
            let b = (b.max(0) as usize).max(a);
            n.val = trim(crate::block::sl(orig, a, b)).to_vec();
        }
    });
    callouts(root);
}

fn footnotes(root: &mut Node) {
    struct Entry {
        count: usize,
        key: S, // identifier key or inline index
    }
    let mut defs: HashMap<S, (Vec<Node>, Pt, Pt)> = HashMap::new(); // key -> children, pos
    let mut state: HashMap<S, i64> = HashMap::new();
    fn collect(n: &Node, defs: &mut HashMap<S, (Vec<Node>, Pt, Pt)>, state: &mut HashMap<S, i64>) {
        if n.ty == Ty::FootnoteDefinition {
            state.insert(n.ident.clone(), -1);
            defs.insert(n.ident.clone(), (n.ch.clone(), n.s, n.e));
        }
        for c in &n.ch {
            collect(c, defs, state);
        }
    }
    collect(root, &mut defs, &mut state);
    let mut order: Vec<Entry> = Vec::new();
    let mut inline_defs: HashMap<usize, (Vec<Node>, Pt, Pt, bool)> = HashMap::new();

    fn mk_ref(e: &mut Node, t: usize, n: usize) {
        let a = u(&(t + 1).to_string());
        let mut l = a.clone();
        if n > 0 {
            l.extend(u(&format!("-{}", n)));
        }
        e.ty = Ty::FnRef;
        e.val = a;
        e.fn_id = l;
        if e.ident.is_empty() && !e.ch.is_empty() {
            let first = e.ch[0].s;
            let last = e.ch[e.ch.len() - 1].e;
            e.content_pos = Some((first, last));
            e.ident = u(&format!("[inline{}", t));
        }
        e.ch.clear();
    }
    fn visit(
        n: &mut Node,
        defs: &mut HashMap<S, (Vec<Node>, Pt, Pt)>,
        state: &mut HashMap<S, i64>,
        order: &mut Vec<Entry>,
        inline_defs: &mut HashMap<usize, (Vec<Node>, Pt, Pt, bool)>,
    ) {
        if n.ty == Ty::Footnote {
            let o = order.len();
            order.push(Entry { count: 1, key: u(&o.to_string()) });
            inline_defs.insert(o, (n.ch.clone(), n.s, n.e, true));
            mk_ref(n, o, 0);
            return;
        }
        if n.ty == Ty::FootnoteReference {
            if !state.contains_key(&n.ident) {
                n.ty = Ty::Text;
                n.val = n.ident.clone();
                return;
            }
            let mut o = state[&n.ident];
            if o == -1 {
                o = order.len() as i64;
                state.insert(n.ident.clone(), o);
                order.push(Entry { count: 0, key: n.ident.clone() });
            }
            let o = o as usize;
            let cnt = order[o].count;
            order[o].count += 1;
            mk_ref(n, o, cnt);
            return;
        }
        for ch in n.ch.iter_mut() {
            visit(ch, defs, state, order, inline_defs);
        }
    }
    visit(root, &mut defs, &mut state, &mut order, &mut inline_defs);
    // backrefs go onto the definition content itself (shared in the original), then into the synthetic list
    let mut items: Vec<Node> = Vec::new();
    for (s, ent) in order.iter().enumerate() {
        let (mut children, sp, ep, is_inline) = if ent.key.iter().all(|&x| is_digit(x)) && inline_defs.contains_key(&s) {
            inline_defs[&s].clone()
        } else if let Some((ch, a, b)) = defs.get(&ent.key) {
            (ch.clone(), *a, *b, false)
        } else {
            continue;
        };
        let f = u(&(s + 1).to_string());
        let backrefs: Vec<Node> = (0..ent.count)
            .map(|p| {
                let mut d = f.clone();
                if p > 0 {
                    d.extend(u(&format!("-{}", p)));
                }
                let mut b = Node::new(Ty::FnBackref);
                b.val = d;
                b
            })
            .collect();
        match children.last_mut() {
            Some(last) if last.ty == Ty::Paragraph => last.ch.extend(backrefs),
            _ => children.extend(backrefs),
        }
        let mut para = Node::new(Ty::Paragraph);
        para.s = sp;
        para.e = ep;
        para.ch = children;
        let mut li = Node::new(Ty::ListItem);
        li.synthetic = true;
        li.is_inline_fn = is_inline;
        li.val = f;
        li.s = sp;
        li.e = ep;
        li.ch = vec![para];
        items.push(li);
    }
    if !items.is_empty() {
        let m = match root.ch.last() {
            Some(g) => Pt { line: g.e.line + 1, col: 1, off: g.e.off },
            None => Pt { line: 1, col: 1, off: 0 },
        };
        let mut t = Node::new(Ty::Text);
        t.val = vec![LF];
        t.s = m;
        t.e = m;
        let mut sec = Node::new(Ty::FnSection);
        sec.s = m;
        sec.e = m;
        let mut tb = Node::new(Ty::ThematicBreak);
        tb.s = m;
        tb.e = m;
        let mut list = Node::new(Ty::List);
        list.s = m;
        list.e = m;
        list.ordered = true;
        list.start = Some(1);
        list.ch = items;
        sec.ch = vec![tb, list];
        root.ch.push(t);
        root.ch.push(sec);
    }
}

fn find_blockids(n: &Node, last: &mut Option<S>) {
    if n.ty == Ty::Blockid {
        *last = n.id.clone();
    }
    for c in &n.ch {
        find_blockids(c, last);
    }
}

fn first_blockid(n: &Node, out: &mut Option<S>, done: &mut bool) {
    if *done {
        return;
    }
    if n.ty == Ty::List {
        return;
    }
    if n.ty == Ty::Blockid {
        *out = n.id.clone();
        *done = true;
        return;
    }
    for c in &n.ch {
        first_blockid(c, out, done);
    }
}

fn item_ids(n: &mut Node) {
    if n.ty == Ty::ListItem {
        let mut t: Option<S> = None;
        let mut done = false;
        // the item itself is never a list or a block id, so only its children matter
        for c in &n.ch {
            first_blockid(c, &mut t, &mut done);
        }
        if let Some(t) = t {
            if !t.is_empty() {
                n.id = Some(t);
            }
        }
    }
    for c in n.ch.iter_mut() {
        item_ids(c);
    }
}

fn blockids(root: &mut Node) {
    let mut i: isize = 0;
    while (i as usize) < root.ch.len() {
        let idx = i as usize;
        match root.ch[idx].ty {
            Ty::Blockid => {
                if idx > 0 {
                    let id = root.ch[idx].id.clone();
                    root.ch[idx - 1].id = id;
                }
                root.ch.remove(idx);
                i -= 1;
            }
            Ty::List => {
                item_ids(&mut root.ch[idx]);
            }
            _ => {
                let mut last: Option<S> = None;
                find_blockids(&root.ch[idx], &mut last);
                if let Some(l) = last {
                    if !l.is_empty() {
                        root.ch[idx].id = Some(l);
                    }
                }
            }
        }
        i += 1;
    }
}

fn callouts(root: &mut Node) {
    walk_mut(root, &mut |e| {
        if e.ty != Ty::Blockquote || e.callout.is_none() {
            return;
        }
        let co = e.callout.clone().unwrap();
        e.ty = Ty::Callout;
        let r = std::mem::take(&mut e.ch);
        let mut n: Vec<Node> = Vec::new();
        let first_on_line = r.first().map(|i| i.s.line == e.s.line).unwrap_or(false);
        if first_on_line {
            let mut r = r;
            let mut i = r.remove(0);
            if i.ty == Ty::Paragraph {
                let brk = i.ch.iter().position(|x| x.ty == Ty::Break);
                let mut l: Vec<Node> = r;
                match brk {
                    Some(s) => {
                        let a_start = i.ch[s].s;
                        let a_end = i.ch[s].e;
                        let mut title = Node::new(Ty::CalloutTitle);
                        title.s = i.s;
                        title.e = a_start;
                        title.ch = i.ch[..s].to_vec();
                        n.push(title);
                        i.s = a_end;
                        i.ch = i.ch[s + 1..].to_vec();
                        l.insert(0, i);
                    }
                    None => {
                        let mut title = Node::new(Ty::CalloutTitle);
                        title.s = i.s;
                        title.e = i.e;
                        title.ch = i.ch.clone();
                        n.push(title);
                    }
                }
                if !l.is_empty() {
                    let mut content = Node::new(Ty::CalloutContent);
                    content.s = l[0].s;
                    content.e = l[l.len() - 1].e;
                    content.ch = l;
                    n.push(content);
                }
            } else {
                let mut title = Node::new(Ty::CalloutTitle);
                title.s = i.s;
                title.e = i.e;
                title.ch = vec![i];
                n.push(title);
                if !r.is_empty() {
                    let mut content = Node::new(Ty::CalloutContent);
                    content.s = r[0].s;
                    content.e = r[r.len() - 1].e;
                    content.ch = r;
                    n.push(content);
                }
            }
        } else {
            let tt = trim(&co.ty).to_vec();
            let mut name: S = tt.iter().map(|&x| if x == c('-') { SP } else { x }).collect();
            name = to_lower_str(&name);
            if let Some(f) = name.first().copied() {
                let up = to_upper_str(&[f]);
                let mut nn = up;
                nn.extend_from_slice(&name[1..]);
                name = nn;
            }
            let mut title = Node::new(Ty::CalloutTitle);
            title.s = e.s;
            title.e = e.s;
            let mut tx = Node::new(Ty::Text);
            tx.s = e.s;
            tx.e = e.s;
            tx.val = name;
            title.ch = vec![tx];
            n.push(title);
            if !r.is_empty() {
                let mut content = Node::new(Ty::CalloutContent);
                content.s = e.s;
                content.e = e.e;
                content.ch = r;
                n.push(content);
            }
        }
        e.ch = n;
    });
}
