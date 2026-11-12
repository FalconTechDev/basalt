// Reading-view HTML: one section per top-level block, in the same shape the old mdast -> hast -> html pipeline produced.
use crate::json::*;
use crate::node::*;
use crate::util::*;
use std::collections::HashMap;

enum H {
    T(String),
    Raw(String),
    E(El),
}

struct El {
    tag: String,
    props: Vec<(String, Pv)>,
    ch: Vec<H>,
}

#[derive(Clone)]
enum Pv {
    S(String),
    B(bool),
}

fn el(tag: &str, ch: Vec<H>) -> El {
    El { tag: tag.to_string(), props: Vec::new(), ch }
}

fn assign(props: &mut Vec<(String, Pv)>, k: &str, v: Pv) {
    if let Some(e) = props.iter_mut().find(|(n, _)| n == k) {
        e.1 = v;
    } else {
        props.push((k.to_string(), v));
    }
}

impl El {
    fn p(mut self, k: &str, v: &str) -> El {
        assign(&mut self.props, k, Pv::S(v.to_string()));
        self
    }
    fn po(mut self, k: &str, v: Option<String>) -> El {
        if let Some(v) = v {
            assign(&mut self.props, k, Pv::S(v));
        }
        self
    }
}

struct Ctx {
    defs: HashMap<String, (String, Option<String>)>,
    base: i64,
}

fn s(v: &[u16]) -> String {
    st(v)
}

fn collect_defs(n: &Node, defs: &mut HashMap<String, (String, Option<String>)>) {
    if n.ty == Ty::Definition {
        let id = st(&n.ident).to_uppercase();
        defs.entry(id).or_insert_with(|| (st(&n.url), n.title.as_ref().map(|t| st(t))));
    }
    for c in &n.ch {
        collect_defs(c, defs);
    }
}

/// markdown-it style URL encoding: keep `;/?:@&=+$,-_.!~*'()#` and existing %XX escapes.
fn encode_url(url: &str) -> String {
    let b: Vec<u16> = url.encode_utf16().collect();
    let keep = ";/?:@&=+$,-_.!~*'()#";
    let mut out = String::new();
    let mut i = 0;
    while i < b.len() {
        let x = b[i];
        if x == c('%') && i + 2 < b.len() + 0 && i + 2 <= b.len() - 1 + 0 && is_hex(b[i + 1]) && is_hex(b[i + 2]) {
            out.push_str(&String::from_utf16_lossy(&b[i..i + 3]));
            i += 3;
            continue;
        }
        if x < 128 {
            let ch = x as u8 as char;
            if ch.is_ascii_alphanumeric() || keep.contains(ch) {
                out.push(ch);
            } else {
                out.push_str(&format!("%{:02X}", x));
            }
        } else if (0xd800..=0xdbff).contains(&x) && i + 1 < b.len() && (0xdc00..=0xdfff).contains(&b[i + 1]) {
            let ch = String::from_utf16_lossy(&b[i..i + 2]);
            for by in ch.bytes() {
                out.push_str(&format!("%{:02X}", by));
            }
            i += 1;
        } else if (0xd800..=0xdfff).contains(&x) {
            out.push_str("%EF%BF%BD");
        } else {
            let ch = String::from_utf16_lossy(&b[i..i + 1]);
            for by in ch.bytes() {
                out.push_str(&format!("%{:02X}", by));
            }
        }
        i += 1;
    }
    out
}

fn is_hex(x: u16) -> bool {
    x < 128 && (x as u8 as char).is_ascii_hexdigit()
}

/// `[ \t]*(\r?\n|\r)[ \t]*` -> the line break alone
fn trim_lines(v: &[u16]) -> String {
    let mut out = S::new();
    let mut i = 0;
    while i < v.len() {
        // look for a line break after optional blanks
        let mut j = i;
        while j < v.len() && (v[j] == SP || v[j] == TAB) {
            j += 1;
        }
        if j < v.len() && (v[j] == LF || v[j] == 13) {
            let mut k = j + 1;
            if v[j] == 13 && k < v.len() && v[k] == LF {
                k += 1;
            }
            out.extend_from_slice(&v[j..k]);
            while k < v.len() && (v[k] == SP || v[k] == TAB) {
                k += 1;
            }
            i = k;
            continue;
        }
        out.push(v[i]);
        i += 1;
    }
    st(&out)
}

fn trim_leading_ws(h: &mut H) {
    match h {
        H::T(t) | H::Raw(t) => {
            let v: S = t.encode_utf16().collect();
            let k = v.len() - trim_start_len(&v);
            *t = st(&v[k..]);
        }
        H::E(e) => {
            if let Some(f) = e.ch.first_mut() {
                if let H::T(t) | H::Raw(t) = f {
                    let v: S = t.encode_utf16().collect();
                    let k = v.len() - trim_start_len(&v);
                    *t = st(&v[k..]);
                }
            }
        }
    }
}

fn trim_start_len(v: &[u16]) -> usize {
    trim_start(v).len()
}

fn all(cx: &Ctx, n: &Node) -> Vec<H> {
    let mut out: Vec<H> = Vec::new();
    for (i, ch) in n.ch.iter().enumerate() {
        let mut r = one(cx, ch, n);
        if r.is_empty() {
            continue;
        }
        if i > 0 && n.ch[i - 1].ty == Ty::Break && r.len() == 1 {
            trim_leading_ws(&mut r[0]);
        }
        out.extend(r);
    }
    out
}

fn wrap(nodes: Vec<H>, loose: bool) -> Vec<H> {
    let mut out = Vec::new();
    let n = nodes.len();
    if loose {
        out.push(H::T("\n".into()));
    }
    for (i, h) in nodes.into_iter().enumerate() {
        if i > 0 {
            out.push(H::T("\n".into()));
        }
        out.push(h);
    }
    if loose && n > 0 {
        out.push(H::T("\n".into()));
    }
    out
}

fn text_h(t: &str) -> H {
    H::T(t.to_string())
}

fn item_loose(n: &Node) -> bool {
    // an item's own `spread` is always set by the parser; synthetic items have none
    if n.synthetic {
        return n.ch.len() > 1;
    }
    n.spread
}

fn one(cx: &Ctx, n: &Node, parent: &Node) -> Vec<H> {
    match n.ty {
        Ty::Paragraph => vec![H::E(el("p", all(cx, n)))],
        Ty::Heading => {
            let e = el(&format!("h{}", n.depth), all(cx, n)).p("data-heading", &s(&n.val));
            vec![H::E(e)]
        }
        Ty::ThematicBreak => vec![H::E(el("hr", vec![]))],
        Ty::Blockquote => vec![H::E(el("blockquote", wrap(all(cx, n), true)))],
        Ty::Code => {
            let mut text = s(&n.val);
            if !n.val.is_empty() {
                text.push('\n');
            }
            let mut code = el("code", vec![text_h(&text)]);
            if let Some(l) = &n.lang {
                let lang = s(l);
                // the first run without blanks, when it is followed by a blank or the end
                let first: String = lang.chars().take_while(|c| *c != ' ' && *c != '\t').collect();
                if !first.is_empty() {
                    code = code.p("class", &format!("language-{}", first));
                }
            }
            code = code.p("data-line", &(n.s.line as i64 - cx.base).to_string());
            vec![H::E(el("pre", vec![H::E(code)]))]
        }
        Ty::Math => {
            let e = el("div", vec![text_h(&s(&n.val))]).p("class", "math math-block");
            vec![H::E(e)]
        }
        Ty::Html => vec![H::Raw(s(&n.val))],
        Ty::List => {
            let kids = all(cx, n);
            let mut e = el(if n.ordered { "ol" } else { "ul" }, Vec::new());
            if let Some(st) = n.start {
                if st != 1 && n.ordered_start_is_number() {
                    e = e.p("start", &st.to_string());
                }
            }
            let tasks = kids.iter().any(|k| match k {
                H::E(x) => x.props.iter().any(|(k, v)| k == "class" && matches!(v, Pv::S(c) if c.contains("task-list-item"))),
                _ => false,
            });
            if tasks {
                e = e.p("class", "contains-task-list");
            }
            e.ch = wrap(kids, true);
            vec![H::E(e)]
        }
        Ty::ListItem => vec![H::E(list_item(cx, n, parent))],
        Ty::Text => vec![H::T(trim_lines(&n.val))],
        Ty::Break => vec![H::E(el("br", vec![])), text_h("\n")],
        Ty::Emphasis => vec![H::E(el("em", all(cx, n)))],
        Ty::Strong => vec![H::E(el("strong", all(cx, n)))],
        Ty::Delete => vec![H::E(el("del", all(cx, n)))],
        Ty::InlineCode => {
            let v: S = n.val.iter().map(|&x| x).collect();
            let mut o = S::new();
            let mut i = 0;
            while i < v.len() {
                if v[i] == 13 {
                    o.push(SP);
                    if i + 1 < v.len() && v[i + 1] == LF {
                        i += 1;
                    }
                } else if v[i] == LF {
                    o.push(SP);
                } else {
                    o.push(v[i]);
                }
                i += 1;
            }
            vec![H::E(el("code", vec![text_h(&st(&o))]))]
        }
        Ty::Link => {
            let e = el("a", all(cx, n)).p("href", &encode_url(&s(&n.url))).po("title", n.title.as_ref().map(|t| s(t)));
            // properties order: href, title
            vec![H::E(e)]
        }
        Ty::Image => {
            let mut e = el("img", vec![]).p("src", &encode_url(&s(&n.url)));
            if let Some(a) = &n.alt {
                e = e.p("alt", &s(a));
            }
            if let Some(t) = &n.title {
                e = e.p("title", &s(t));
            }
            if let Some(w) = &n.width {
                e = e.p("width", &s(w));
            }
            if let Some(h) = &n.height {
                e = e.p("height", &s(h));
            }
            vec![H::E(e)]
        }
        Ty::LinkReference => match cx.defs.get(&s(&n.ident).to_uppercase()) {
            Some((url, title)) => {
                let e = el("a", all(cx, n)).p("href", &encode_url(url)).po("title", title.clone());
                vec![H::E(e)]
            }
            None => revert(cx, n),
        },
        Ty::ImageReference => match cx.defs.get(&s(&n.ident).to_uppercase()) {
            Some((url, title)) => {
                let mut e = el("img", vec![]).p("src", &encode_url(url));
                if let Some(a) = &n.alt {
                    e = e.p("alt", &s(a));
                }
                if let Some(t) = title {
                    e = e.p("title", t);
                }
                vec![H::E(e)]
            }
            None => revert(cx, n),
        },
        Ty::Table => vec![H::E(table(cx, n))],
        Ty::Yaml => {
            let code = el("code", vec![text_h(&s(&n.val))]).p("class", "language-yaml");
            vec![H::E(el("pre", vec![H::E(code)]).p("class", "frontmatter"))]
        }
        Ty::Callout => {
            let co = n.callout.clone().unwrap_or_default();
            let e = el("div", all(cx, n))
                .p("class", "callout")
                .p("data-callout", &s(&co.ty))
                .p("data-callout-fold", &s(&co.fold))
                .p("data-callout-metadata", &s(&co.data));
            vec![H::E(e)]
        }
        Ty::CalloutTitle => {
            let icon = el("div", vec![]).p("class", "callout-icon");
            let inner = el("div", all(cx, n)).p("class", "callout-title-inner");
            vec![H::E(el("div", vec![H::E(icon), H::E(inner)]).p("class", "callout-title"))]
        }
        Ty::CalloutContent => vec![H::E(el("div", wrap(all(cx, n), true)).p("class", "callout-content"))],
        Ty::ILink => {
            let href = s(&n.url);
            if n.converted {
                let e = el("a", all(cx, n)).p("href", &href).p("data-href", &href).p("class", "internal-link").po("title", n.meta.as_ref().map(|t| s(t)));
                vec![H::E(e)]
            } else {
                let mut e = el("a", vec![text_h(&s(&n.title.clone().unwrap_or_default()))]).p("class", "internal-link").p("href", &href).p("data-href", &href);
                if n.reftype == 1 {
                    e = e.p("aria-label", &s(&crate::xform::hash_path(&n.url))).p("data-tooltip-position", "top");
                }
                vec![H::E(e)]
            }
        }
        Ty::IEmbed => {
            let href = s(&n.url);
            let mut e = el("span", Vec::new()).p("class", "internal-embed").p("src", &href);
            if let Some(a) = &n.alt {
                e = e.p("alt", &s(a));
            }
            if let Some(w) = &n.width {
                e = e.p("width", &s(w));
            }
            if let Some(h) = &n.height {
                e = e.p("height", &s(h));
            }
            if n.converted {
                e.ch = all(cx, n);
            } else {
                e.ch = vec![text_h(&s(&n.title.clone().unwrap_or_default()))];
            }
            vec![H::E(e)]
        }
        Ty::Tag => {
            let t = s(&n.val);
            vec![H::E(el("a", vec![text_h(&t)]).p("class", "tag").p("href", &t))]
        }
        Ty::Mark => vec![H::E(el("mark", all(cx, n)))],
        Ty::InlineMath => {
            let cls = if n.is_math_block { "math math-block" } else { "math math-inline" };
            vec![H::E(el("span", vec![text_h(&s(&n.val))]).p("class", cls))]
        }
        Ty::FnRef => {
            let a = s(&n.val);
            let l = s(&n.fn_id);
            let link = el("a", vec![text_h(&format!("[{}]", l))]).p("class", "footnote-link").p("href", &format!("#fn-{}", a)).p("data-footref", &s(&n.ident));
            vec![H::E(el("sup", vec![H::E(link)]).p("class", "footnote-ref").p("data-footnote-id", &format!("fnref-{}", l)))]
        }
        Ty::FnBackref => vec![H::E(el("a", vec![text_h("\u{21a9}\u{fe0e}")]).p("class", "footnote-backref footnote-link").p("href", &format!("#fnref-{}", s(&n.val))))],
        Ty::FnSection => vec![H::E(el("section", all(cx, n)).p("class", "footnotes"))],
        Ty::Checklist => {
            let mut e = el("input", vec![]).p("class", "task-list-item-checkbox").p("type", "checkbox");
            if n.checked == Some(true) {
                assign(&mut e.props, "checked", Pv::B(true));
            }
            e = e.p("data-line", &(n.s.line as i64 - cx.base).to_string());
            vec![H::E(e)]
        }
        // definitions, footnote definitions, comments and block ids leave no trace
        _ => Vec::new(),
    }
}

impl Node {
    fn ordered_start_is_number(&self) -> bool {
        self.start.is_some()
    }
}

fn revert(cx: &Ctx, n: &Node) -> Vec<H> {
    let mut close = "]".to_string();
    if n.reftype == 1 {
        close.push_str("[]");
    } else if n.reftype == 2 {
        let l = if !n.label.is_empty() { &n.label } else { &n.ident };
        close.push_str(&format!("[{}]", s(l)));
    }
    if n.ty == Ty::ImageReference {
        let alt = n.alt.as_ref().map(|a| s(a)).unwrap_or_else(|| "null".into());
        return vec![H::T(format!("![{}{}", alt, close))];
    }
    let mut kids = all(cx, n);
    match kids.first_mut() {
        Some(H::T(t)) => t.insert(0, '['),
        _ => kids.insert(0, text_h("[")),
    }
    match kids.last_mut() {
        Some(H::T(t)) => t.push_str(&close),
        _ => kids.push(text_h(&close)),
    }
    kids
}

fn list_item(cx: &Ctx, n: &Node, parent: &Node) -> El {
    let c = all(cx, n);
    let loose = if parent.ty == Ty::List {
        parent.spread || parent.ch.iter().any(item_loose)
    } else {
        item_loose(n)
    };
    let mut p: Vec<H> = Vec::new();
    let total = c.len();
    let mut last_is_p = false;
    for (a, l) in c.into_iter().enumerate() {
        let is_p = matches!(&l, H::E(e) if e.tag == "p");
        if loose || a != 0 || !is_p {
            p.push(text_h("\n"));
        }
        if is_p && !loose {
            if let H::E(e) = l {
                p.extend(e.ch);
            }
        } else {
            p.push(l);
        }
        last_is_p = is_p;
        let _ = total;
    }
    if total > 0 && (loose || !last_is_p) {
        p.push(text_h("\n"));
    }
    let mut e = el("li", p);
    if n.synthetic {
        e = e.p("data-footnote-id", &format!("fn-{}", s(&n.val)));
    } else if let Some(ch) = n.checked {
        let mut cls = "task-list-item".to_string();
        if ch {
            cls.push_str(" is-checked");
        }
        e = e.p("class", &cls);
        if let Some(t) = &n.checklist {
            e = e.p("data-task", &s(t));
        }
    }
    e = e.p("data-line", &(n.s.line as i64 - cx.base).to_string());
    e
}

fn table(cx: &Ctx, n: &Node) -> El {
    let aligns = &n.align;
    let p = aligns.len();
    let mut rows: Vec<El> = Vec::new();
    for (f, row) in n.ch.iter().enumerate() {
        let tag = if f == 0 { "th" } else { "td" };
        let count = if p > 0 { p } else { row.ch.len() };
        let mut cells: Vec<H> = Vec::new();
        for k in 0..count {
            let cell = row.ch.get(k);
            let kids = match cell {
                Some(cn) => all(cx, cn),
                None => Vec::new(),
            };
            let mut e = el(tag, kids);
            match aligns.get(k) {
                Some(1) => e = e.p("align", "left"),
                Some(2) => e = e.p("align", "right"),
                Some(3) => e = e.p("align", "center"),
                _ => {}
            }
            cells.push(H::E(e));
        }
        rows.push(el("tr", wrap(cells, true)));
    }
    let mut parts: Vec<H> = Vec::new();
    let mut it = rows.into_iter();
    if let Some(head) = it.next() {
        parts.push(H::E(el("thead", wrap(vec![H::E(head)], true))));
    }
    let body: Vec<H> = it.map(H::E).collect();
    if !body.is_empty() {
        parts.push(H::E(el("tbody", wrap(body, true))));
    }
    el("table", wrap(parts, true))
}

// -------------------------------------------------------------------------------------------- hast -> html

fn esc_text(t: &str, out: &mut String) {
    for ch in t.chars() {
        match ch {
            '&' => out.push_str("&#x26;"),
            '<' => out.push_str("&#x3C;"),
            c => out.push(c),
        }
    }
}

fn esc_attr(t: &str, out: &mut String) {
    for ch in t.chars() {
        match ch {
            '&' => out.push_str("&#x26;"),
            '"' => out.push_str("&#x22;"),
            '`' => out.push_str("&#x60;"),
            '\0' => out.push_str("&#x0;"),
            c => out.push(c),
        }
    }
}

const VOIDS: &[&str] = &["area", "base", "basefont", "bgsound", "br", "col", "command", "embed", "frame", "hr", "image", "img", "input", "isindex", "keygen", "link", "menuitem", "meta", "nextid", "param", "source", "track", "wbr"];

fn write(h: &H, out: &mut String) {
    match h {
        H::T(t) => esc_text(t, out),
        H::Raw(t) => out.push_str(t),
        H::E(e) => {
            out.push('<');
            out.push_str(&e.tag);
            for (k, v) in &e.props {
                match v {
                    Pv::B(false) => {}
                    Pv::B(true) => {
                        out.push(' ');
                        out.push_str(k);
                    }
                    Pv::S(s) => {
                        out.push(' ');
                        out.push_str(k);
                        out.push_str("=\"");
                        esc_attr(s, out);
                        out.push('"');
                    }
                }
            }
            out.push('>');
            let mut inner = String::new();
            for c in &e.ch {
                write(c, &mut inner);
            }
            if inner.is_empty() && VOIDS.contains(&e.tag.as_str()) {
                return;
            }
            out.push_str(&inner);
            out.push_str("</");
            out.push_str(&e.tag);
            out.push('>');
        }
    }
}

/// `<a>` elements without a class are external links: open in a new tab, show the address.
fn external_links(h: &mut H) {
    if let H::E(e) = h {
        if e.tag == "a" && !e.props.iter().any(|(k, _)| k == "class") {
            let href = e.props.iter().find(|(k, _)| k == "href").and_then(|(_, v)| if let Pv::S(s) = v { Some(s.clone()) } else { None });
            let first: Option<String> = match e.ch.first() {
                None => Some(String::new()),
                Some(H::T(t)) | Some(H::Raw(t)) => Some(t.clone()),
                Some(H::E(_)) => None,
            };
            assign(&mut e.props, "class", Pv::S("external-link".into()));
            assign(&mut e.props, "target", Pv::S("_blank".into()));
            assign(&mut e.props, "rel", Pv::S("noopener nofollow".into()));
            if href != first {
                if let Some(h) = href {
                    assign(&mut e.props, "aria-label", Pv::S(h));
                }
                assign(&mut e.props, "data-tooltip-position", Pv::S("top".into()));
            }
        }
        for c in e.ch.iter_mut() {
            external_links(c);
        }
    }
}

fn pos_json(s: Pt, e: Pt) -> J {
    let p = |x: Pt| {
        J::Obj(vec![
            ("line".into(), J::Num((x.line as i64 - 1) as f64)),
            ("col".into(), J::Num((x.col as i64 - 1) as f64)),
            ("offset".into(), J::Num(x.off as f64)),
        ])
    };
    J::Obj(vec![("start".into(), p(s)), ("end".into(), p(e))])
}

pub fn sections(root: &Node, _orig: &[u16], fm: Result<Option<crate::yaml::Y>, ()>) -> String {
    let mut defs = HashMap::new();
    collect_defs(root, &mut defs);
    let mut list: Vec<J> = Vec::new();
    for top in &root.ch {
        let level = if top.ty == Ty::Heading { top.depth.max(1) } else { 7 };
        let cx = Ctx { defs: defs.clone(), base: top.s.line as i64 };
        let mut wrapper = Node::new(Ty::Root);
        wrapper.ch = vec![top.clone()];
        let mut hs = all(&cx, &wrapper);
        for h in hs.iter_mut() {
            external_links(h);
        }
        let mut html = String::new();
        for h in &hs {
            write(h, &mut html);
        }
        list.push(J::Obj(vec![("html".into(), J::Str(html)), ("pos".into(), pos_json(top.s, top.e)), ("level".into(), J::Num(level as f64))]));
    }
    let mut out: Vec<(String, J)> = vec![("sections".into(), J::Arr(list))];
    match fm {
        Ok(Some(y)) => out.push(("frontmatter".into(), crate::yaml::to_json(&y))),
        Ok(None) => {}
        Err(()) => out.push(("frontmatter".into(), J::Null)),
    }
    to_string(&J::Obj(out))
}
