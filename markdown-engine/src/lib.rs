// Markdown engine for Basalt's worker: metadata (links, tags, headings, ...) and reading-view sections.
mod block;
mod entities;
mod html;
mod inline;
mod json;
mod meta;
mod node;
mod parse;
mod util;
mod xform;
mod yaml;

use node::*;
use std::cell::RefCell;
use util::*;

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

fn set_out(s: String) -> usize {
    OUT.with(|o| {
        let mut o = o.borrow_mut();
        o.clear();
        o.extend_from_slice(s.as_bytes());
        o.len()
    })
}

/// Parses the document: returns the tree (already transformed) and the original text.
fn parse_doc(text: &[u16], breaks: bool) -> Option<Node> {
    let mut value: S = Vec::with_capacity(text.len());
    let mut i = 0;
    while i < text.len() {
        let x = text[i];
        if x == 13 {
            value.push(LF);
            if at(text, i + 1) == LF && i + 1 < text.len() {
                i += 1;
            }
        } else {
            value.push(x);
        }
        i += 1;
    }
    let mut col = 1;
    if value.first() == Some(&0xfeff) {
        value.remove(0);
        col = 2;
    }
    let mut p = parse::P::new(text);
    p.breaks = breaks;
    let kids = p.tokenize_block(&value, 1, col);
    if p.fail {
        return None;
    }
    let mut root = Node::new(Ty::Root);
    root.ch = kids;
    xform::transform(&mut root, text);
    Some(root)
}

/// Front matter of the tree: None = absent or not a mapping, Err = invalid.
fn front(root: &Node) -> Result<Option<yaml::Y>, ()> {
    match root.ch.first() {
        Some(n) if n.ty == Ty::Yaml => {
            let src = st(&n.val);
            match yaml::parse_result(&src) {
                Ok(y) => Ok(y),
                Err(()) => Err(()),
            }
        }
        _ => Ok(None),
    }
}

fn utf16_of(bytes: &[u8], strip_bom: bool) -> S {
    let b = if strip_bom && bytes.starts_with(&[0xef, 0xbb, 0xbf]) { &bytes[3..] } else { bytes };
    String::from_utf8_lossy(b).encode_utf16().collect()
}

#[unsafe(no_mangle)]
pub extern "C" fn metadata(ptr: *const u8, len: usize, breaks: u32) -> isize {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let text = utf16_of(bytes, true);
    let root = match parse_doc(&text, breaks != 0) {
        Some(r) => r,
        None => return -1,
    };
    let fm = match front(&root) {
        Ok(f) => f,
        Err(()) => None,
    };
    match meta::metadata(&root, &text, fm.as_ref()) {
        Some(s) => set_out(s) as isize,
        None => -1,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn sections(ptr: *const u8, len: usize, breaks: u32) -> isize {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let text = utf16_of(bytes, false);
    let root = match parse_doc(&text, breaks != 0) {
        Some(r) => r,
        None => return -1,
    };
    let fm = front(&root);
    set_out(html::sections(&root, &text, fm)) as isize
}
