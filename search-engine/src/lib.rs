//! Basalt's note search: an inverted index with BM25 ranking, title / path boosts, prefix and one-typo matching.
//! JS feeds it notes (id, title, path, text) and gets back ranked hits with the position of the best match,
//! so it can cut a snippet out of the text it already holds.

use std::collections::HashMap;

#[derive(Default)]
struct Doc {
    /// Terms this document contributed to the postings (to remove them when it is re-indexed).
    terms: Vec<String>,
    len: f32,
    live: bool,
}

struct Posting {
    doc: u32,
    /// Weighted term frequency (title and path occurrences count more).
    tf: f32,
    /// UTF-16 offset of the first occurrence in the body text, u32::MAX when it only appears in the title / path.
    pos: u32,
}

#[derive(Default)]
struct Index {
    docs: Vec<Doc>,
    live: u32,
    total_len: f32,
    postings: HashMap<String, Vec<Posting>>,
    /// Sorted vocabulary, rebuilt lazily, for prefix and fuzzy lookups.
    vocab: Vec<String>,
    vocab_dirty: bool,
    out: Vec<u32>,
}

static mut INDEX: Option<Index> = None;
static mut BUF: Vec<u8> = Vec::new();

#[allow(static_mut_refs)]
fn ix() -> &'static mut Index {
    unsafe {
        if INDEX.is_none() {
            INDEX = Some(Index::default());
        }
        INDEX.as_mut().unwrap()
    }
}

/// Lower-cased word tokens with the UTF-16 offset of each.
fn tokens(text: &str) -> Vec<(String, u32)> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut start = 0u32;
    let mut u16pos = 0u32;
    for ch in text.chars() {
        if ch.is_alphanumeric() {
            if cur.is_empty() {
                start = u16pos;
            }
            for l in ch.to_lowercase() {
                cur.push(l);
            }
        } else if !cur.is_empty() {
            out.push((std::mem::take(&mut cur), start));
        }
        u16pos += ch.len_utf16() as u32;
    }
    if !cur.is_empty() {
        out.push((cur, start));
    }
    out
}

fn remove_doc(ix: &mut Index, id: u32) {
    let Some(doc) = ix.docs.get_mut(id as usize) else { return };
    if !doc.live {
        return;
    }
    doc.live = false;
    ix.live = ix.live.saturating_sub(1);
    ix.total_len -= doc.len;
    for t in std::mem::take(&mut doc.terms) {
        if let Some(list) = ix.postings.get_mut(&t) {
            list.retain(|p| p.doc != id);
            if list.is_empty() {
                ix.postings.remove(&t);
            }
        }
    }
    ix.vocab_dirty = true;
}

fn lev1(a: &str, b: &str) -> bool {
    // true when the edit distance is at most one (insert, delete or substitute a char)
    let (x, y): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    if x.len().abs_diff(y.len()) > 1 {
        return false;
    }
    let (mut i, mut j, mut edits) = (0, 0, 0);
    while i < x.len() && j < y.len() {
        if x[i] == y[j] {
            i += 1;
            j += 1;
            continue;
        }
        edits += 1;
        if edits > 1 {
            return false;
        }
        if x.len() > y.len() {
            i += 1;
        } else if y.len() > x.len() {
            j += 1;
        } else {
            i += 1;
            j += 1;
        }
    }
    edits + (x.len() - i) + (y.len() - j) <= 1
}

// ---- C ABI -----------------------------------------------------------------

/// A scratch byte buffer JS writes UTF-8 into.
#[unsafe(no_mangle)]
#[allow(static_mut_refs)]
pub extern "C" fn se_buf(len: u32) -> *mut u8 {
    unsafe {
        BUF.resize(len as usize, 0);
        BUF.as_mut_ptr()
    }
}

#[allow(static_mut_refs)]
fn read_buf(len: u32) -> String {
    unsafe { String::from_utf8_lossy(&BUF[..len as usize]).into_owned() }
}

#[unsafe(no_mangle)]
pub extern "C" fn se_clear() {
    *ix() = Index::default();
}

/// Adds or replaces document `id`. The scratch buffer holds `title \u{1}path \u{1}text`.
#[unsafe(no_mangle)]
pub extern "C" fn se_add(id: u32, len: u32) {
    let s = read_buf(len);
    let mut parts = s.splitn(3, '\u{1}');
    let (title, path, text) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let ix = ix();
    remove_doc(ix, id);
    while ix.docs.len() <= id as usize {
        ix.docs.push(Doc::default());
    }
    let mut per: HashMap<String, (f32, u32)> = HashMap::new();
    let mut count = 0f32;
    for (t, _) in tokens(title) {
        per.entry(t).or_insert((0.0, u32::MAX)).0 += 3.0;
        count += 1.0;
    }
    for (t, _) in tokens(path) {
        per.entry(t).or_insert((0.0, u32::MAX)).0 += 1.4;
    }
    for (t, pos) in tokens(text) {
        let e = per.entry(t).or_insert((0.0, u32::MAX));
        e.0 += 1.0;
        if e.1 == u32::MAX {
            e.1 = pos;
        }
        count += 1.0;
    }
    let mut terms = Vec::with_capacity(per.len());
    for (t, (tf, pos)) in per {
        ix.postings.entry(t.clone()).or_default().push(Posting { doc: id, tf, pos });
        terms.push(t);
    }
    let d = &mut ix.docs[id as usize];
    d.terms = terms;
    d.len = count.max(1.0);
    d.live = true;
    ix.live += 1;
    ix.total_len += d.len;
    ix.vocab_dirty = true;
}

#[unsafe(no_mangle)]
pub extern "C" fn se_remove(id: u32) {
    remove_doc(ix(), id);
}

#[unsafe(no_mangle)]
pub extern "C" fn se_doc_count() -> u32 {
    ix().live
}

/// Searches. The scratch buffer holds the query. Returns the number of hits; results are triples
/// (doc id, score * 1000, offset of the best body match or u32::MAX) behind `se_out`.
#[unsafe(no_mangle)]
pub extern "C" fn se_search(len: u32, limit: u32) -> u32 {
    let q = read_buf(len);
    let ix = ix();
    ix.out.clear();
    let qt: Vec<String> = tokens(&q).into_iter().map(|t| t.0).collect();
    if qt.is_empty() || ix.live == 0 {
        return 0;
    }
    if ix.vocab_dirty {
        ix.vocab = ix.postings.keys().cloned().collect();
        ix.vocab.sort();
        ix.vocab_dirty = false;
    }
    let avg = (ix.total_len / ix.live as f32).max(1.0);
    let n = ix.live as f32;
    // per doc: (score, matched query words, best position)
    let mut acc: HashMap<u32, (f32, u32, u32)> = HashMap::new();
    for (qi, tok) in qt.iter().enumerate() {
        let last = qi + 1 == qt.len();
        // expansions: the word itself, words that start with it (the last word, as you type), and one-typo neighbours
        let mut cands: Vec<(&String, f32)> = Vec::new();
        if let Some((k, _)) = ix.postings.get_key_value(tok) {
            cands.push((k, 1.0));
        }
        if last || tok.chars().count() >= 3 {
            let from = ix.vocab.partition_point(|v| v.as_str() < tok.as_str());
            for v in ix.vocab[from..].iter().take_while(|v| v.starts_with(tok.as_str())).take(40) {
                if v != tok {
                    cands.push((v, 0.55));
                }
            }
        }
        if tok.chars().count() >= 4 && cands.len() < 3 {
            for v in ix.vocab.iter().filter(|v| v.chars().count().abs_diff(tok.chars().count()) <= 1 && lev1(tok, v)).take(30) {
                if v != tok {
                    cands.push((v, 0.4));
                }
            }
        }
        let mut seen_doc: HashMap<u32, ()> = HashMap::new();
        for (term, w) in cands {
            let list = &ix.postings[term];
            let idf = ((n - list.len() as f32 + 0.5) / (list.len() as f32 + 0.5) + 1.0).ln();
            for p in list {
                let d = &ix.docs[p.doc as usize];
                let tf = p.tf;
                let s = idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * d.len / avg)) * w;
                let e = acc.entry(p.doc).or_insert((0.0, 0, u32::MAX));
                e.0 += s;
                if seen_doc.insert(p.doc, ()).is_none() {
                    e.1 += 1;
                }
                if p.pos < e.2 {
                    e.2 = p.pos;
                }
            }
        }
    }
    let all = qt.len() as u32;
    let mut hits: Vec<(u32, f32, u32)> = acc
        .into_iter()
        // every word has to match somewhere, except in a long query where one stray word is forgiven
        .filter(|(_, (_, m, _))| *m == all || (all >= 4 && *m + 1 >= all))
        .map(|(d, (s, m, pos))| (d, s * (0.6 + 0.4 * m as f32 / all as f32), pos))
        .collect();
    hits.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(&b.0)));
    hits.truncate(limit as usize);
    for (d, s, p) in &hits {
        ix.out.extend_from_slice(&[*d, (*s * 1000.0) as u32, *p]);
    }
    hits.len() as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn se_out() -> *const u32 {
    ix().out.as_ptr()
}
