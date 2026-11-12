// Metadata extraction (the `metadataCache` reply), written straight to JSON.
use crate::json::*;
use crate::node::*;
use crate::util::*;
use crate::xform::*;

pub use crate::xform::split_link;

/// The plain-text stringifier used for link display text.
pub fn mr(n: &Node) -> S {
    match n.ty {
        Ty::Html => return S::new(),
        Ty::IEmbed => return n.url.clone(),
        Ty::ListItem => {
            let parts: Vec<S> = n.ch.iter().map(mr).collect();
            if parts.len() == 1 {
                let mut o = parts[0].clone();
                o.push(LF);
                return o;
            }
            return join_owned(&parts);
        }
        Ty::Tag => return n.val.clone(),
        Ty::Comment => return S::new(),
        _ => {}
    }
    let mut r: S = match n.ty {
        Ty::Text | Ty::InlineCode | Ty::InlineMath | Ty::Code | Ty::Math | Ty::Yaml => n.val.clone(),
        _ => S::new(),
    };
    if r.is_empty() {
        if let Some(a) = &n.alt {
            r = a.clone();
        }
    }
    if r.is_empty() {
        if let Some(t) = &n.title {
            r = t.clone();
        }
    }
    if r.is_empty() && has_children(n) {
        let mut o = S::new();
        for c in &n.ch {
            o.extend(mr(c));
        }
        r = o;
    }
    if n.ty == Ty::List && n.start.is_some() {
        let mut o = u(&format!("{}. ", n.start.unwrap()));
        o.extend(r);
        r = o;
    }
    match n.ty {
        Ty::Paragraph | Ty::Break | Ty::Heading | Ty::Code => r.push(LF),
        _ => {
            if r.last() == Some(&LF) {
                r.pop();
            }
        }
    }
    match n.ty {
        Ty::TableCell => r.push(SP),
        Ty::TableRow => r.push(LF),
        _ => {}
    }
    r
}

fn has_children(n: &Node) -> bool {
    !matches!(
        n.ty,
        Ty::Text | Ty::InlineCode | Ty::InlineMath | Ty::Code | Ty::Math | Ty::Yaml | Ty::Tag | Ty::Break | Ty::ThematicBreak | Ty::Html | Ty::Definition | Ty::Image | Ty::FnBackref
            | Ty::Blockid | Ty::FootnoteReference | Ty::Checklist | Ty::Raw
    ) && !(n.ty == Ty::FnRef)
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

fn sub(orig: &[u16], s: Pt, e: Pt) -> S {
    let a = s.off.max(0) as usize;
    let b = e.off.max(0) as usize;
    crate::block::sl(orig, a, b).to_vec()
}

#[derive(Default)]
struct Acc {
    links: Vec<J>,
    embeds: Vec<J>,
    tags: Vec<J>,
    headings: Vec<J>,
    footnotes: Vec<J>,
    footnote_refs: Vec<J>,
    reference_links: Vec<J>,
    list_items: Vec<J>,
    blocks: Vec<(String, J)>,
}

fn set_block(a: &mut Acc, id: &S, val: J) {
    let key = st(&to_lower_str(id));
    if let Some(e) = a.blocks.iter_mut().find(|(k, _)| *k == key) {
        e.1 = val;
    } else {
        a.blocks.push((key, val));
    }
}

fn visit(n: &Node, parent: Ty, lpp: Option<Pt>, orig: &[u16], a: &mut Acc) {
    let mut skip = false;
    match n.ty {
        Ty::FnRef => {
            if let Some((s, e)) = n.content_pos {
                a.footnotes.push(J::Obj(vec![("position".into(), pos_json(s, e)), ("id".into(), J::Str(st(&n.ident)))]));
            } else {
                a.footnote_refs.push(J::Obj(vec![("position".into(), pos_json(n.s, n.e)), ("id".into(), J::Str(st(&n.ident)))]));
            }
        }
        Ty::FootnoteDefinition => {
            a.footnotes.push(J::Obj(vec![("position".into(), pos_json(n.s, n.e)), ("id".into(), J::Str(st(&n.ident)))]));
        }
        Ty::Definition if !n.url.is_empty() => {
            let id = if !n.label.is_empty() { n.label.clone() } else { n.ident.clone() };
            a.reference_links.push(J::Obj(vec![
                ("position".into(), pos_json(n.s, n.e)),
                ("id".into(), J::Str(st(&id))),
                ("link".into(), J::Str(st(&n.url))),
            ]));
        }
        Ty::Heading if parent == Ty::Root => {
            a.headings.push(J::Obj(vec![
                ("position".into(), pos_json(n.s, n.e)),
                ("heading".into(), J::Str(st(&n.val))),
                ("level".into(), J::Num(n.depth.max(1) as f64)),
            ]));
        }
        Ty::ILink => {
            let original = sub(orig, n.s, n.e);
            let mut disp = n.title.clone().unwrap_or_default();
            if disp.is_empty() && n.converted {
                disp = mr(n);
            }
            a.links.push(J::Obj(vec![
                ("position".into(), pos_json(n.s, n.e)),
                ("link".into(), J::Str(st(&n.url))),
                ("original".into(), J::Str(st(&original))),
                ("displayText".into(), J::Str(st(&disp))),
            ]));
        }
        Ty::IEmbed => {
            let original = sub(orig, n.s, n.e);
            let disp = n.title.clone().unwrap_or_default();
            a.embeds.push(J::Obj(vec![
                ("position".into(), pos_json(n.s, n.e)),
                ("link".into(), J::Str(st(&n.url))),
                ("original".into(), J::Str(st(&original))),
                ("displayText".into(), J::Str(st(&disp))),
            ]));
        }
        Ty::Tag => {
            a.tags.push(J::Obj(vec![("position".into(), pos_json(n.s, n.e)), ("tag".into(), J::Str(st(&n.val)))]));
        }
        Ty::ListItem => {
            if n.synthetic && !n.is_inline_fn {
                skip = true;
            }
        }
        _ => {}
    }
    if skip {
        return;
    }
    for ch in &n.ch {
        visit_child(n, ch, orig, a);
    }
}

fn visit_child(parent: &Node, ch: &Node, orig: &[u16], a: &mut Acc) {
    if ch.ty == Ty::ListItem && !ch.synthetic && parent.ty == Ty::List {
        visit_item(parent, ch, orig, a);
        return;
    }
    visit(ch, parent.ty, None, orig, a);
}

fn visit_item(list: &Node, item: &Node, orig: &[u16], a: &mut Acc) {
    let ys = item.s;
    let mut ye = item.e;
    let mut trailing = 0usize;
    if item.ch.len() > 1 {
        let mut b = item.ch.len();
        while b > 0 {
            let k = &item.ch[b - 1];
            if k.ty != Ty::List {
                ye = k.e;
                break;
            }
            trailing += 1;
            b -= 1;
        }
    }
    let w: i64 = match LIST_PARENT.with(|c| c.borrow().get(&(list as *const Node as usize)).copied()) {
        Some(pp) => pp.line as i64 - 1,
        None => {
            let w0 = -(list.s.line as i64 - 1);
            if w0 == 0 { -1 } else { w0 }
        }
    };
    let mut o: Vec<(String, J)> = vec![("position".into(), pos_json(ys, ye)), ("parent".into(), J::Num(w as f64))];
    if let Some(t) = &item.checklist {
        o.push(("task".into(), J::Str(st(t))));
    }
    if let Some(id) = &item.id {
        if !id.is_empty() {
            o.push(("id".into(), J::Str(st(id))));
            set_block(a, id, J::Obj(vec![("position".into(), pos_json(ys, ye)), ("id".into(), J::Str(st(id)))]));
        }
    }
    a.list_items.push(J::Obj(o));
    // mark the trailing nested lists with this item's position
    let n_ch = item.ch.len();
    if item.ch.len() > 1 {
        for k in 0..trailing {
            let child = &item.ch[n_ch - 1 - k];
            LIST_PARENT.with(|c| c.borrow_mut().insert(child as *const Node as usize, item.s));
        }
    }
    for ch in &item.ch {
        visit(ch, Ty::ListItem, None, orig, a);
    }
}

thread_local! {
    static LIST_PARENT: std::cell::RefCell<VM<usize, Pt>> = std::cell::RefCell::new(VM::new());
}

pub fn metadata(root: &Node, orig: &[u16], fm: Option<&crate::yaml::Y>) -> Option<String> {
    LIST_PARENT.with(|c| c.borrow_mut().clear());
    let mut acc = Acc::default();
    let mut out: Vec<(String, J)> = Vec::new();
    let mut fm_json: Option<(J, Vec<J>)> = None;
    let mut fm_pos: Option<J> = None;
    if let Some(first) = root.ch.first() {
        if first.ty == Ty::Yaml {
            if let Some(y) = fm {
                fm_pos = Some(pos_json(first.s, first.e));
                let links = crate::yaml::frontmatter_links(y)?;
                fm_json = Some((crate::yaml::to_json(y), links));
            }
        }
    }
    // sections and top-level block ids
    let mut sections: Vec<J> = Vec::new();
    for ch in &root.ch {
        let ty = match ch.ty {
            Ty::Root => "root",
            Ty::Paragraph => "paragraph",
            Ty::Heading => "heading",
            Ty::Code => "code",
            Ty::Math => "math",
            Ty::Blockquote => "blockquote",
            Ty::Callout => "callout",
            Ty::List => "list",
            Ty::ThematicBreak => "thematicBreak",
            Ty::Html => "html",
            Ty::Table => "table",
            Ty::Definition => "definition",
            Ty::FootnoteDefinition => "footnoteDefinition",
            Ty::Yaml => "yaml",
            Ty::Comment => "comment",
            Ty::Text => "text",
            Ty::FnSection => "element",
            _ => "unknown",
        };
        let mut o: Vec<(String, J)> = vec![("type".into(), J::Str(ty.into())), ("position".into(), pos_json(ch.s, ch.e))];
        if let Some(id) = &ch.id {
            if !id.is_empty() {
                o.push(("id".into(), J::Str(st(id))));
                set_block(&mut acc, id, J::Obj(vec![("position".into(), pos_json(ch.s, ch.e)), ("id".into(), J::Str(st(id)))]));
            }
        }
        sections.push(J::Obj(o));
    }
    for ch in &root.ch {
        visit(ch, Ty::Root, None, orig, &mut acc);
    }
    let mut put = |k: &str, v: Vec<J>| {
        if !v.is_empty() {
            out.push((k.into(), J::Arr(v)));
        }
    };
    put("links", std::mem::take(&mut acc.links));
    put("embeds", std::mem::take(&mut acc.embeds));
    put("tags", std::mem::take(&mut acc.tags));
    put("headings", std::mem::take(&mut acc.headings));
    put("footnotes", std::mem::take(&mut acc.footnotes));
    put("footnoteRefs", std::mem::take(&mut acc.footnote_refs));
    put("referenceLinks", std::mem::take(&mut acc.reference_links));
    put("sections", sections);
    put("listItems", std::mem::take(&mut acc.list_items));
    if !acc.blocks.is_empty() {
        out.push(("blocks".into(), J::Obj(std::mem::take(&mut acc.blocks))));
    }
    if let (Some((fj, fl)), Some(fp)) = (fm_json, fm_pos) {
        out.push(("frontmatter".into(), fj));
        out.push(("frontmatterPosition".into(), fp));
        out.push(("frontmatterLinks".into(), J::Arr(fl)));
    }
    Some(to_string(&J::Obj(out)))
}
