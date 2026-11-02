//! Hybrid canvas renderer for the Obsidian fork.
//!
//! JS hands over nodes and edges as flat u32/f32 words, asks for a frame at a
//! given viewport, and gets back (1) a command stream replayed on a Canvas2D
//! context and (2) the list of nodes that are close enough to stay real DOM.
//! Everything between is an `fp_core::draw::DrawList`; the Canvas2D replay is
//! just another backend for it.

use fp_core::draw::{Path, Prim, StrokeStyle};
use fp_core::prelude::*;

const STRIDE: usize = 8;

const KIND_GROUP: u32 = 3;
const SIDE_AUTO: u32 = 4;

/// Cards narrower than this are batched per colour as plain rectangles.
const TINY_PX: f32 = 90.0;

const PRESETS: [[u8; 3]; 7] = [
    [126, 126, 126],
    [251, 70, 76],
    [233, 151, 63],
    [224, 222, 113],
    [68, 207, 110],
    [83, 223, 221],
    [168, 130, 255],
];

#[derive(Default)]
struct Scene {
    nodes: Vec<u32>,
    edges: Vec<u32>,
    out: Vec<f32>,
    near: Vec<u32>,
    dom: Vec<bool>,
    /// Cards at least this wide (px) get real text from the backend, so the stand-in bars are skipped. 0 = bars everywhere.
    text_px: f32,
    /// Dot grid step at the base zoom (the stock value is 20); it doubles as the zoom drops.
    grid_base: f32,
    /// 0 = rounded rectangle; 1..=4 = polygon card shapes (Грань, Базальт, Скол, Кристалл) with the warm palette.
    shape: u32,
    shape_buf: Vec<f32>,
    /// Edges whose path the user shaped by hand: edge index -> polyline in world units.
    polys: std::collections::BTreeMap<u32, Vec<Vec2>>,
    /// false while the DOM draws the edges itself (a link is being dragged).
    edges_on: bool,
    /// Dot grid as (dot colour, radius px, step px, screen x of a dot, screen y of a dot); drawn by the backend as a tiled pattern.
    grid: Option<(Rgba, f32, f32, f32, f32)>,
    dark: bool,
}

static mut SCENE: Option<Scene> = None;
static mut INBUF: Vec<u32> = Vec::new();

#[allow(static_mut_refs)]
fn scene() -> &'static mut Scene {
    unsafe {
        if SCENE.is_none() {
            SCENE = Some(Scene { dark: true, edges_on: true, ..Default::default() });
        }
        SCENE.as_mut().unwrap()
    }
}

#[inline]
fn f(w: u32) -> f32 {
    f32::from_bits(w)
}

fn rgb_of(code: u32) -> [u8; 3] {
    if code >= 0x0100_0000 {
        [(code >> 16) as u8, (code >> 8) as u8, code as u8]
    } else {
        PRESETS[(code as usize).min(6)]
    }
}

struct Node {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    color: u32,
    kind: u32,
    selected: bool,
    shape: u32,
}

fn node_at(nodes: &[u32], i: usize) -> Node {
    let b = &nodes[i * STRIDE..];
    Node { x: f(b[0]), y: f(b[1]), w: f(b[2]), h: f(b[3]), color: b[4], kind: b[5], selected: b[6] & 1 != 0, shape: b[7].min(4) }
}

fn side_point(side: u32, n: &Node) -> Vec2 {
    match side {
        0 => vec2(n.x + n.w * 0.5, n.y),
        1 => vec2(n.x + n.w, n.y + n.h * 0.5),
        2 => vec2(n.x + n.w * 0.5, n.y + n.h),
        _ => vec2(n.x, n.y + n.h * 0.5),
    }
}

fn side_dir(side: u32) -> Vec2 {
    match side {
        0 => vec2(0.0, -1.0),
        1 => vec2(1.0, 0.0),
        2 => vec2(0.0, 1.0),
        _ => vec2(-1.0, 0.0),
    }
}

fn auto_side(from: &Node, to: &Node) -> (u32, u32) {
    let dx = (to.x + to.w * 0.5) - (from.x + from.w * 0.5);
    let dy = (to.y + to.h * 0.5) - (from.y + from.h * 0.5);
    if dx.abs() >= dy.abs() {
        if dx >= 0.0 { (1, 3) } else { (3, 1) }
    } else if dy >= 0.0 {
        (2, 0)
    } else {
        (0, 2)
    }
}

fn cubic(p0: Vec2, c1: Vec2, c2: Vec2, p1: Vec2, steps: usize) -> Vec<Vec2> {
    (0..=steps)
        .map(|i| {
            let t = i as f32 / steps as f32;
            let u = 1.0 - t;
            let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
            vec2(
                a * p0.x + b * c1.x + c * c2.x + d * p1.x,
                a * p0.y + b * c1.y + c * c2.y + d * p1.y,
            )
        })
        .collect()
}

fn srgb(rgb: [u8; 3], a: f32) -> Rgba {
    Rgba::srgb8(rgb[0], rgb[1], rgb[2], (a.clamp(0.0, 1.0) * 255.0) as u8)
}

fn overlaps(r: &Rect, vw: f32, vh: f32) -> bool {
    r.x1 >= 0.0 && r.x0 <= vw && r.y1 >= 0.0 && r.y0 <= vh
}

fn build(s: &mut Scene, cx: f32, cy: f32, zoom: f32, vw: f32, vh: f32, accent: u32, all_far: bool) -> DrawList {
    let mut dl = DrawList::new();
    s.near.clear();
    s.grid = None;

    let to_screen = |p: Vec2| vec2((p.x - cx) * zoom + vw * 0.5, (p.y - cy) * zoom + vh * 0.5);
    let n_nodes = s.nodes.len() / STRIDE;

    // dot grid (Obsidian steps the spacing with zoom)
    let base = if s.grid_base >= 4.0 { s.grid_base } else { 20.0 };
    let spacing: f32 = base * if zoom >= 0.534 { 1.0 } else if zoom >= 0.22 { 2.0 } else if zoom >= 0.1 { 4.0 } else { 8.0 };
    let step = spacing * zoom;
    if step >= 6.0 {
        let gx0 = ((cx - vw * 0.5 / zoom) / spacing).floor() * spacing;
        let gy0 = ((cy - vh * 0.5 / zoom) / spacing).floor() * spacing;
        let origin = to_screen(vec2(gx0, gy0));
        let dot = srgb(if s.dark { [54, 54, 54] } else { [218, 218, 218] }, 1.0);
        s.grid = Some((dot, (0.7 * zoom.sqrt()).clamp(0.5, 2.0), step, origin.x, origin.y));
    }

    let accent_rgb = [(accent >> 16) as u8, (accent >> 8) as u8, accent as u8];

    // groups first
    for i in 0..n_nodes {
        let n = node_at(&s.nodes, i);
        if n.kind != KIND_GROUP {
            continue;
        }
        let a = to_screen(vec2(n.x, n.y));
        let r = Rect::new(a.x, a.y, a.x + n.w * zoom, a.y + n.h * zoom);
        if !overlaps(&r, vw, vh) {
            continue;
        }
        if !all_far && s.dom.get(i).copied().unwrap_or(false) {
            continue;
        }
        let rgb = rgb_of(n.color);
        let rad = (8.0 * zoom.min(1.0)).max(2.0);
        dl.fill(Path::rounded_rect(r, rad), srgb(rgb, 0.12));
        let bw = if n.selected { 2.0 } else { 1.0 };
        let col = if n.selected { srgb(accent_rgb, 1.0) } else { srgb(rgb, if n.color == 0 { 1.0 } else { 0.7 }) };
        outline(&mut dl, r, rad, bw, col);
    }

    // edges
    // Obsidian strokes edges at 2px * sqrt(1/zoom) in world units, i.e. 2*sqrt(zoom) on screen.
    let edge_w = (2.0 * zoom.sqrt()).clamp(0.6, 8.0);
    let mut order: Vec<usize> = (0..s.edges.len() / STRIDE).collect();
    order.sort_by_key(|&i| s.edges[i * STRIDE + 4]);
    let mut arrows = Path::new();
    let mut arrow_col: Option<(u32, Rgba)> = None;
    let draw_arrows = zoom >= 0.12;
    for &ei in &order {
        let e = &s.edges[ei * STRIDE..ei * STRIDE + STRIDE];
        let (fi, ti) = (e[0] as usize, e[1] as usize);
        if fi >= n_nodes || ti >= n_nodes || !s.edges_on || (e[7] >> 8) & 1 == 1 {
            continue;
        }
        let (a, b) = (node_at(&s.nodes, fi), node_at(&s.nodes, ti));
        let (mut fs, mut ts) = (e[2], e[3]);
        if fs == SIDE_AUTO || ts == SIDE_AUTO {
            let (af, at) = auto_side(&a, &b);
            if fs == SIDE_AUTO {
                fs = af;
            }
            if ts == SIDE_AUTO {
                ts = at;
            }
        }
        let (p0, p1) = (side_point(fs, &a), side_point(ts, &b));
        let dist = ((p1.x - p0.x).powi(2) + (p1.y - p0.y).powi(2)).sqrt();
        let off = (dist * 0.5).clamp(70.0, 150.0);
        let (d0, d1) = (side_dir(fs), side_dir(ts));
        let c1 = vec2(p0.x + d0.x * off, p0.y + d0.y * off);
        let c2 = vec2(p1.x + d1.x * off, p1.y + d1.y * off);
        let (sp0, sp1) = (to_screen(p0), to_screen(p1));
        let (cs1, cs2) = (to_screen(c1), to_screen(c2));
        let (x0, x1) = (sp0.x.min(sp1.x).min(cs1.x).min(cs2.x), sp0.x.max(sp1.x).max(cs1.x).max(cs2.x));
        let (y0, y1) = (sp0.y.min(sp1.y).min(cs1.y).min(cs2.y), sp0.y.max(sp1.y).max(cs1.y).max(cs2.y));
        if !overlaps(&Rect::new(x0, y0, x1, y1), vw, vh) {
            continue;
        }
        let span = (x1 - x0).max(y1 - y0);
        let steps = ((span / 8.0) as usize).clamp(2, 28);
        let style = e[7] & 0xff;
        let pts = if let Some(poly) = s.polys.get(&(ei as u32)) {
            poly.iter().map(|&q| to_screen(q)).collect()
        } else if style == 0 {
            cubic(sp0, cs1, cs2, sp1, steps)
        } else {
            route(style, p0, d0, p1, d1, [a.x, a.y, a.x + a.w, a.y + a.h], [b.x, b.y, b.x + b.w, b.y + b.h]).into_iter().map(to_screen).collect()
        };
        let col = srgb(rgb_of(e[4]), if e[4] == 0 { 1.0 } else { 0.7 });
        if arrow_col.is_some_and(|(code, _)| code != e[4]) {
            let (_, c) = arrow_col.take().unwrap();
            dl.fill(std::mem::take(&mut arrows), c);
        }
        arrow_col = Some((e[4], col));
        if draw_arrows && pts.len() >= 3 {
            let len = (10.0 * zoom.sqrt()).clamp(2.5, 30.0);
            let k = len / 10.4;
            let n = pts.len();
            for (kind, tip, from_pt) in [(e[6], pts[n - 1], pts[n - 2]), (e[5], pts[0], pts[1])] {
                let shape = end_pts(kind);
                if shape.is_empty() {
                    continue;
                }
                let (dx, dy) = (tip.x - from_pt.x, tip.y - from_pt.y);
                let l = (dx * dx + dy * dy).sqrt().max(1e-3);
                let (nx, ny) = (dx / l, dy / l);
                arrows.push(shape.iter().map(|&(x, y)| vec2(tip.x - nx * y * k - ny * x * k, tip.y - ny * y * k + nx * x * k)).collect());
            }
        }
        dl.stroke(pts, StrokeStyle::round(edge_w), col);
    }
    if let Some((_, c)) = arrow_col {
        dl.fill(arrows, c);
    }

    // cards: far ones are drawn here, near ones stay DOM
    let (bg, ink) = match (s.shape > 0, s.dark) {
        (true, true) => ([34, 28, 24], [236, 228, 219]),
        (true, false) => ([250, 247, 242], [42, 33, 26]),
        (false, true) => ([30, 30, 30], [218, 218, 218]),
        (false, false) => ([255, 255, 255], [34, 34, 34]),
    };
    let (warm_bg, warm_ink, warm_edge) = if s.dark { ([34, 28, 24], [236, 228, 219], [90, 70, 52]) } else { ([250, 247, 242], [42, 33, 26], [185, 169, 148]) };
    let mut tiny: std::collections::BTreeMap<(u32, bool, u32), (Vec<Vec<Vec2>>, Vec<Vec<Vec2>>)> = Default::default();
    let mut bars: Vec<Vec<Vec2>> = Vec::new();
    for i in 0..n_nodes {
        let n = node_at(&s.nodes, i);
        if n.kind == KIND_GROUP {
            continue;
        }
        let a = to_screen(vec2(n.x, n.y));
        let r = Rect::new(a.x, a.y, a.x + n.w * zoom, a.y + n.h * zoom);
        if !overlaps(&r, vw, vh) {
            continue;
        }
        if !all_far && s.dom.get(i).copied().unwrap_or(false) {
            continue;
        }
        if r.w() < TINY_PX {
            let entry = tiny.entry((n.color, n.selected, n.shape)).or_default();
            if n.shape > 0 {
                let poly: Vec<Vec2> = shape_pts(n.shape, n.w, n.h).into_iter().map(|(px, py)| vec2(r.x0 + px * zoom, r.y0 + py * zoom)).collect();
                entry.0.push(poly.clone());
                if r.w() >= 6.0 && r.h() > 3.0 {
                    let c = vec2((r.x0 + r.x1) * 0.5, (r.y0 + r.y1) * 0.5);
                    let (sx, sy) = ((r.w() - 2.0) / r.w(), (r.h() - 2.0) / r.h());
                    entry.1.push(poly.iter().map(|p| vec2(c.x + (p.x - c.x) * sx, c.y + (p.y - c.y) * sy)).collect());
                }
            } else {
                entry.0.push(r.corners().to_vec());
                if r.w() >= 6.0 && r.h() > 3.0 {
                    entry.1.push(Rect::new(r.x0 + 1.0, r.y0 + 1.0, r.x1 - 1.0, r.y1 - 1.0).corners().to_vec());
                }
            }
            if r.w() >= 28.0 && r.h() >= 14.0 && !(s.text_px > 0.0 && r.w() >= s.text_px) {
                let pad = (r.w() * 0.1).max(3.0);
                let bar_h = (zoom * 5.0).clamp(1.5, 4.0);
                let mut y = r.y0 + pad;
                let mut k = 0;
                while y + bar_h < r.y1 - pad * 0.5 && k < 6 {
                    let w = (r.w() - pad * 2.0) * if k % 3 == 2 { 0.6 } else { 1.0 };
                    bars.push(Rect::new(r.x0 + pad, y, r.x0 + pad + w, y + bar_h).corners().to_vec());
                    y += bar_h * 2.0;
                    k += 1;
                }
            }
            continue;
        }
        let rgb = rgb_of(n.color);
        let rad = (8.0 * zoom.min(1.0)).max(2.0);
        let (bg, ink, edge) = if n.shape > 0 { (warm_bg, warm_ink, warm_edge) } else { (bg, ink, [0, 0, 0]) };
        if n.shape > 0 {
            let mut pts: Vec<Vec2> = shape_pts(n.shape, n.w, n.h).into_iter().map(|(px, py)| vec2(r.x0 + px * zoom, r.y0 + py * zoom)).collect();
            dl.fill(Path { subpaths: vec![pts.clone()] }, srgb(bg, 1.0));
            if n.color != 0 {
                dl.fill(Path { subpaths: vec![pts.clone()] }, srgb(rgb, 0.07));
            }
            pts.push(pts[0]);
            let col = if n.selected { srgb(accent_rgb, 1.0) } else if n.color == 0 { srgb(edge, 1.0) } else { srgb(rgb, 0.8) };
            let mut st = StrokeStyle::width(if n.selected { 2.0 } else { 1.5 });
            st.join = StrokeStyle::round(1.0).join;
            dl.stroke(pts, st, col);
        } else {
        let rr = Path::rounded_rect(r, rad);
        dl.fill(rr.clone(), srgb(bg, 1.0));
        dl.fill(rr, srgb(rgb, 0.07));
        let col = if n.selected { srgb(accent_rgb, 1.0) } else { srgb(rgb, if n.color == 0 { 1.0 } else { 0.7 }) };
        outline(&mut dl, r, rad, if n.selected { 2.0 } else { 1.0 }, col);
        }
        // text stand-in: a few skeleton bars once the card is big enough to read as a card
        if r.w() >= 28.0 && r.h() >= 14.0 && !(s.text_px > 0.0 && r.w() >= s.text_px) {
            let pad = (r.w() * 0.1).max(3.0);
            let bar_h = (zoom * 5.0).clamp(1.5, 4.0);
            let gap = bar_h * 2.0;
            let mut y = r.y0 + pad;
            let mut k = 0;
            while y + bar_h < r.y1 - pad * 0.5 && k < 8 {
                let w = (r.w() - pad * 2.0) * if k % 3 == 2 { 0.6 } else { 1.0 };
                dl.fill(Path::rounded_rect(Rect::new(r.x0 + pad, y, r.x0 + pad + w, y + bar_h), bar_h * 0.5), srgb(ink, 0.22));
                y += gap;
                k += 1;
            }
        }
    }
    for ((code, selected, shp), (outer, inner)) in tiny {
        let (bg, edge_c) = if shp > 0 { (warm_bg, warm_edge) } else { (bg, [0, 0, 0]) };
        let rgb = rgb_of(code);
        let border = if selected { srgb(accent_rgb, 1.0) } else if shp > 0 && code == 0 { srgb(edge_c, 1.0) } else { srgb(rgb, if code == 0 { 1.0 } else { 0.7 }) };
        dl.fill(Path { subpaths: outer }, border);
        let mix = |k: usize| (bg[k] as f32 * 0.93 + rgb[k] as f32 * 0.07) as u8;
        dl.fill(Path { subpaths: inner }, srgb([mix(0), mix(1), mix(2)], 1.0));
    }
    dl.fill(Path { subpaths: bars }, srgb(ink, 0.22));
    dl
}

/// Axis-aligned segment against a rectangle interior (x0, y0, x1, y1).
fn seg_hits(a: Vec2, b: Vec2, r: &[f32; 4]) -> bool {
    let (lx, hx, ly, hy) = (a.x.min(b.x), a.x.max(b.x), a.y.min(b.y), a.y.max(b.y));
    let eps = 0.5;
    if (a.y - b.y).abs() < 0.01 {
        a.y > r[1] + eps && a.y < r[3] - eps && hx > r[0] + eps && lx < r[2] - eps
    } else if (a.x - b.x).abs() < 0.01 {
        a.x > r[0] + eps && a.x < r[2] - eps && hy > r[1] + eps && ly < r[3] - eps
    } else {
        false
    }
}

/// Polyline for an edge that is not a curve, in world units: 1 straight, 2 right-angled, 3 right-angled with rounded corners.
/// The right-angled ones are chosen among many candidates so they go round the two cards they join instead of through them.
fn route(style: u32, p0: Vec2, d0: Vec2, p1: Vec2, d1: Vec2, ra: [f32; 4], rb: [f32; 4]) -> Vec<Vec2> {
    if style == 1 {
        return vec![p0, p1];
    }
    let m = 28.0;
    let a = vec2(p0.x + d0.x * m, p0.y + d0.y * m);
    let b = vec2(p1.x + d1.x * m, p1.y + d1.y * m);
    let xs = [a.x, b.x, (a.x + b.x) * 0.5, ra[0] - m, ra[2] + m, rb[0] - m, rb[2] + m];
    let ys = [a.y, b.y, (a.y + b.y) * 0.5, ra[1] - m, ra[3] + m, rb[1] - m, rb[3] + m];
    let mut cands: Vec<Vec<Vec2>> = vec![vec![a, vec2(b.x, a.y), b], vec![a, vec2(a.x, b.y), b]];
    for &x in &xs {
        cands.push(vec![a, vec2(x, a.y), vec2(x, b.y), b]);
    }
    for &y in &ys {
        cands.push(vec![a, vec2(a.x, y), vec2(b.x, y), b]);
    }
    let mut best: Option<(f32, Vec<Vec2>)> = None;
    for c in cands {
        let mut full = vec![p0];
        full.extend(c);
        full.push(p1);
        // drop repeated points and points in the middle of a straight run
        full.dedup_by(|x, y| (x.x - y.x).abs() < 0.01 && (x.y - y.y).abs() < 0.01);
        let mut k = 1;
        while k + 1 < full.len() {
            let (u, v, w) = (full[k - 1], full[k], full[k + 1]);
            if ((u.x - v.x).abs() < 0.01 && (v.x - w.x).abs() < 0.01) || ((u.y - v.y).abs() < 0.01 && (v.y - w.y).abs() < 0.01) {
                full.remove(k);
            } else {
                k += 1;
            }
        }
        let mut cost = 0.0;
        for i in 0..full.len() - 1 {
            let (u, v) = (full[i], full[i + 1]);
            cost += (u.x - v.x).abs() + (u.y - v.y).abs();
            // the first and last runs leave / enter their own card, the others must not cross either card
            if i > 0 && seg_hits(u, v, &ra) {
                cost += 5000.0;
            }
            if i + 2 < full.len() && seg_hits(u, v, &rb) {
                cost += 5000.0;
            }
        }
        cost += 30.0 * (full.len() as f32 - 2.0);
        if best.as_ref().map_or(true, |(bc, _)| cost < *bc) {
            best = Some((cost, full));
        }
    }
    let pts = best.map(|(_, p)| p).unwrap_or_else(|| vec![p0, a, b, p1]);
    if style != 3 || pts.len() < 3 {
        return pts;
    }
    let r = 14.0_f32;
    let mut out = vec![pts[0]];
    for i in 1..pts.len() - 1 {
        let (u, v, w) = (pts[i - 1], pts[i], pts[i + 1]);
        let (lu, lw) = (((u.x - v.x).powi(2) + (u.y - v.y).powi(2)).sqrt().max(1e-3), ((w.x - v.x).powi(2) + (w.y - v.y).powi(2)).sqrt().max(1e-3));
        let (ru, rw) = (r.min(lu * 0.5), r.min(lw * 0.5));
        let pin = vec2(v.x + (u.x - v.x) / lu * ru, v.y + (u.y - v.y) / lu * ru);
        let pout = vec2(v.x + (w.x - v.x) / lw * rw, v.y + (w.y - v.y) / lw * rw);
        for k in 0..=6 {
            let t = k as f32 / 6.0;
            let q = 1.0 - t;
            out.push(vec2(q * q * pin.x + 2.0 * q * t * v.x + t * t * pout.x, q * q * pin.y + 2.0 * q * t * v.y + t * t * pout.y));
        }
    }
    out.push(pts[pts.len() - 1]);
    out
}

/// Edge end markers in the DOM's local frame (tip at 0,0, body towards +y, the stock arrow is 13 wide and 10.4 long).
/// 0 none, 1 arrow, 2 open arrow, 3 square, 4 diamond, 5 circle, 6 bar, 7 dot.
fn end_pts(kind: u32) -> Vec<(f32, f32)> {
    let circle = |cy: f32, r: f32| (0..20).map(|i| { let a = i as f32 / 20.0 * std::f32::consts::TAU; (r * a.cos(), cy + r * a.sin()) }).collect::<Vec<_>>();
    match kind {
        1 => vec![(0.0, 0.0), (6.5, 10.4), (-6.5, 10.4)],
        2 => vec![(0.0, 0.0), (6.5, 10.4), (4.3, 11.8), (0.0, 5.0), (-4.3, 11.8), (-6.5, 10.4)],
        3 => vec![(-5.5, 1.0), (5.5, 1.0), (5.5, 12.0), (-5.5, 12.0)],
        4 => vec![(0.0, 0.0), (6.5, 8.0), (0.0, 16.0), (-6.5, 8.0)],
        5 => circle(6.5, 6.5),
        6 => vec![(-7.0, 0.0), (7.0, 0.0), (7.0, 2.6), (-7.0, 2.6)],
        7 => circle(3.5, 3.5),
        _ => vec![],
    }
}

/// Card outline in world units. Corner cuts have a fixed size; the long edges of Базальт and Скол get
/// more facets as the card grows instead of stretching the same few.
fn shape_pts(shape: u32, w: f32, h: f32) -> Vec<(f32, f32)> {
    // corner cuts TL, TR, BR, BL; facet spacing along an edge; how far a facet may dent inwards
    let (cut, space, amp): ([f32; 4], f32, f32) = match shape {
        1 => ([28.0, 8.0, 28.0, 8.0], 0.0, 0.0),
        2 => ([16.0, 22.0, 14.0, 30.0], 120.0, 10.0),
        3 => ([44.0, 34.0, 34.0, 64.0], 100.0, 14.0),
        _ => ([34.0; 4], 0.0, 0.0),
    };
    let lim = 0.3 * w.min(h);
    let cut = cut.map(|c| c.min(lim));
    let corner = [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)];
    let dir = |e: usize| {
        let (a, b) = (corner[e], corner[(e + 1) % 4]);
        let l = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt().max(1e-3);
        ((b.0 - a.0) / l, (b.1 - a.1) / l, l)
    };
    let hash = |e: usize, i: usize| -> f32 {
        let mut x = (shape as u32).wrapping_mul(2654435761) ^ (e as u32 * 40503 + i as u32 * 9973 + 17);
        x ^= x >> 13;
        x = x.wrapping_mul(1274126177);
        x ^= x >> 16;
        (x & 0xffff) as f32 / 65535.0
    };
    let mut out = Vec::new();
    for e in 0..4 {
        let (dx, dy, len) = dir(e);
        let k = (e + 1) % 4;
        let start = (corner[e].0 + dx * cut[e], corner[e].1 + dy * cut[e]);
        let end = (corner[k].0 - dx * cut[k], corner[k].1 - dy * cut[k]);
        out.push(start);
        if space > 0.0 {
            let n = (((len - cut[e] - cut[k]) / space).floor() as usize).min(40);
            let (nx, ny) = (-dy, dx);
            for i in 0..n {
                let t = (i as f32 + 1.0 + (hash(e, i) - 0.5) * 0.5) / (n as f32 + 1.0);
                let d = amp * (0.15 + 0.85 * hash(e, i + 100));
                out.push((start.0 + (end.0 - start.0) * t + nx * d, start.1 + (end.1 - start.1) * t + ny * d));
            }
        }
        out.push(end);
    }
    out
}

fn outline(dl: &mut DrawList, r: Rect, rad: f32, w: f32, col: Rgba) {
    let inner = Rect::new(r.x0 + w * 0.5, r.y0 + w * 0.5, r.x1 - w * 0.5, r.y1 - w * 0.5);
    let mut pts = Path::rounded_rect(inner, (rad - w * 0.5).max(0.0)).subpaths.remove(0);
    pts.push(pts[0]);
    dl.stroke(pts, StrokeStyle::width(w), col);
}

fn encode(dl: &DrawList, grid: Option<(Rgba, f32, f32, f32, f32)>, out: &mut Vec<f32>) {
    out.clear();
    let put_color = |out: &mut Vec<f32>, c: Rgba| {
        let [r, g, b, a] = c.to_srgb8();
        out.extend_from_slice(&[r as f32, g as f32, b as f32, a as f32 / 255.0]);
    };
    if let Some((c, r, step, ox, oy)) = grid {
        out.push(6.0);
        let [cr, cg, cb, ca] = c.to_srgb8();
        out.extend_from_slice(&[cr as f32, cg as f32, cb as f32, ca as f32 / 255.0, r, step, ox, oy]);
    }
    let prims = &dl.prims;
    let mut i = 0;
    while i < prims.len() {
        match &prims[i] {
            Prim::Fill { color, .. } => {
                let mut j = i;
                let mut total = 0;
                while j < prims.len() {
                    match &prims[j] {
                        Prim::Fill { color: c2, path } if c2 == color => total += path.subpaths.len(),
                        _ => break,
                    }
                    j += 1;
                }
                out.push(1.0);
                put_color(out, *color);
                out.push(total as f32);
                for p in &prims[i..j] {
                    if let Prim::Fill { path, .. } = p {
                        for sp in &path.subpaths {
                            out.push(sp.len() as f32);
                            for v in sp {
                                out.extend_from_slice(&[v.x, v.y]);
                            }
                        }
                    }
                }
                i = j;
            }
            Prim::Stroke { style, color, .. } => {
                let mut j = i;
                while j < prims.len() {
                    match &prims[j] {
                        Prim::Stroke { style: s2, color: c2, .. } if c2 == color && s2.width == style.width => j += 1,
                        _ => break,
                    }
                }
                out.push(2.0);
                put_color(out, *color);
                out.push(style.width);
                out.push((j - i) as f32);
                for p in &prims[i..j] {
                    if let Prim::Stroke { pts, .. } = p {
                        out.push(pts.len() as f32);
                        for v in pts {
                            out.extend_from_slice(&[v.x, v.y]);
                        }
                    }
                }
                i = j;
            }
            Prim::Points { centers, size, fill, .. } => {
                out.push(3.0);
                put_color(out, *fill);
                out.push(*size * 0.5);
                out.push(centers.len() as f32);
                for v in centers {
                    out.extend_from_slice(&[v.x, v.y]);
                }
                i += 1;
            }
            Prim::PushClip(r) => {
                out.extend_from_slice(&[4.0, r.x0, r.y0, r.x1, r.y1]);
                i += 1;
            }
            Prim::PopClip => {
                out.push(5.0);
                i += 1;
            }
            _ => i += 1,
        }
    }
    out.push(0.0);
}

// ---- C ABI ---------------------------------------------------------------

/// Scratch u32 buffer JS writes node/edge words into.
#[unsafe(no_mangle)]
#[allow(static_mut_refs)]
pub extern "C" fn ce_input(words: u32) -> *mut u32 {
    unsafe {
        INBUF.resize(words as usize, 0);
        INBUF.as_mut_ptr()
    }
}

#[unsafe(no_mangle)]
#[allow(static_mut_refs)]
pub extern "C" fn ce_set_nodes(words: u32) {
    scene().nodes = unsafe { INBUF[..words as usize].to_vec() };
}

#[unsafe(no_mangle)]
#[allow(static_mut_refs)]
pub extern "C" fn ce_set_edges(words: u32) {
    scene().edges = unsafe { INBUF[..words as usize].to_vec() };
}

/// Indices (in the node table) of cards JS keeps as real DOM this frame; the engine skips them.
#[unsafe(no_mangle)]
#[allow(static_mut_refs)]
pub extern "C" fn ce_set_dom(count: u32) {
    let s = scene();
    s.dom = vec![false; s.nodes.len() / STRIDE];
    for k in 0..count as usize {
        let idx = unsafe { INBUF[k] } as usize;
        if idx < s.dom.len() {
            s.dom[idx] = true;
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn ce_set_grid(base: f32) {
    scene().grid_base = base;
}

#[unsafe(no_mangle)]
pub extern "C" fn ce_set_text_px(px: f32) {
    scene().text_px = px;
}

#[unsafe(no_mangle)]
pub extern "C" fn ce_set_shape(shape: u32) {
    scene().shape = shape.min(4);
}

/// Outline of a card as x,y pairs (world units), for the DOM clip-path; length via `ce_shape_len`.
#[unsafe(no_mangle)]
pub extern "C" fn ce_shape(shape: u32, w: f32, h: f32) -> *const f32 {
    let s = scene();
    s.shape_buf = shape_pts(shape, w, h).into_iter().flat_map(|(x, y)| [x, y]).collect();
    s.shape_buf.as_ptr()
}

/// Route of a non-curve edge as x,y pairs; sides are 0 top, 1 right, 2 bottom, 3 left; length via `ce_shape_len`.
#[unsafe(no_mangle)]
pub extern "C" fn ce_route(style: u32, x0: f32, y0: f32, side0: u32, x1: f32, y1: f32, side1: u32, ax0: f32, ay0: f32, ax1: f32, ay1: f32, bx0: f32, by0: f32, bx1: f32, by1: f32) -> *const f32 {
    let s = scene();
    let pts = route(style, vec2(x0, y0), side_dir(side0), vec2(x1, y1), side_dir(side1), [ax0, ay0, ax1, ay1], [bx0, by0, bx1, by1]);
    s.shape_buf = pts.into_iter().flat_map(|p| [p.x, p.y]).collect();
    s.shape_buf.as_ptr()
}

/// Edge end marker `kind` as x,y pairs (DOM local frame); length via `ce_shape_len`.
#[unsafe(no_mangle)]
pub extern "C" fn ce_end_pts(kind: u32) -> *const f32 {
    let s = scene();
    s.shape_buf = end_pts(kind).into_iter().flat_map(|(x, y)| [x, y]).collect();
    s.shape_buf.as_ptr()
}

/// Hand-shaped edges: [count, (edge index, point count, x, y, ...)...] as f32 words in the input buffer.
#[unsafe(no_mangle)]
#[allow(static_mut_refs)]
pub extern "C" fn ce_set_polys(words: u32) {
    let s = scene();
    s.polys.clear();
    let w = unsafe { &INBUF[..words as usize] };
    if w.is_empty() {
        return;
    }
    let n = f(w[0]) as usize;
    let mut k = 1;
    for _ in 0..n {
        if k + 1 >= w.len() {
            break;
        }
        let idx = f(w[k]) as u32;
        let m = f(w[k + 1]) as usize;
        k += 2;
        let mut pts = Vec::with_capacity(m);
        for _ in 0..m {
            if k + 1 >= w.len() {
                break;
            }
            pts.push(vec2(f(w[k]), f(w[k + 1])));
            k += 2;
        }
        if pts.len() >= 2 {
            s.polys.insert(idx, pts);
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn ce_set_edges_on(on: u32) {
    scene().edges_on = on != 0;
}

#[unsafe(no_mangle)]
pub extern "C" fn ce_shape_len() -> u32 {
    scene().shape_buf.len() as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn ce_set_dark(dark: u32) {
    scene().dark = dark != 0;
}

/// Builds a frame. Returns the command stream pointer; length via `ce_out_len`.
#[unsafe(no_mangle)]
pub extern "C" fn ce_render(cx: f32, cy: f32, zoom: f32, vw: f32, vh: f32, accent: u32, all_far: u32) -> *const f32 {
    let s = scene();
    let dl = build(s, cx, cy, zoom, vw, vh, accent, all_far != 0);
    let mut out = std::mem::take(&mut s.out);
    encode(&dl, s.grid, &mut out);
    s.out = out;
    s.out.as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn ce_out_len() -> u32 {
    scene().out.len() as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn ce_near_ptr() -> *const u32 {
    scene().near.as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn ce_near_len() -> u32 {
    scene().near.len() as u32
}
