//! The vault graph for Basalt: falconplot's force-directed layout and views (2D and 3D)
//! compiled to WASM. JS hands over notes and links, steps the layout, asks for a frame, and
//! replays the returned command stream on a Canvas2D context.

use fp_core::draw::{Align, Prim};
use fp_core::prelude::*;
use fp_graph::prelude::*;

struct State {
    graph: Graph,
    l2: Layout<2>,
    l3: Layout<3>,
    v2: GraphView,
    v3: GraphView3,
    params: LayoutParams,
    mode: u32,
    out: Vec<f32>,
    /// Smoothed fit bounds for the 2D view, so a settling layout does not make the whole picture breathe.
    bounds: Option<([f32; 2], [f32; 2])>,
    seed: u64,
}

static mut STATE: Option<State> = None;
static mut INBUF: Vec<u32> = Vec::new();
static mut BYTES: Vec<u8> = Vec::new();
/// Layout steps run before the first picture (-1: the default for the graph size) and how far from the centre the nodes start (1 = the layout's own seed radius).
static mut PRERUN: i32 = -1;
static mut SPREAD: f32 = 1.0;
/// While set the 2D camera keeps a fixed frame sized for the settled graph, so a growing layout is watched from a still camera.
static mut LOCK: bool = false;
/// A settled graph keeps its camera frame: nothing but the user moves the picture (hovering must not shift it).
static mut FREEZE: bool = false;
/// For the next graph: per new node the index it had in the old graph (u32::MAX if it is new), so the layout keeps its places and only the changes move.
static mut KEEP: Vec<u32> = Vec::new();
/// How the next graph arrives: 0 live physics as before, 1 revealed from the centre outwards, 2 moves from where it was, 3 the same with a new camera frame.
static mut TW_MODE: u32 = 0;
static mut TW_DUR: f32 = 900.0;

/// The positions are computed first (the layout runs to rest out of sight); what the eye sees is a tween from the start to the finished places,
/// so nothing wobbles or is pulled by springs while it appears.
struct Tween {
    from2: Vec<[f32; 2]>,
    to2: Vec<[f32; 2]>,
    from3: Vec<[f32; 3]>,
    to3: Vec<[f32; 3]>,
    delay2: Vec<f32>,
    delay3: Vec<f32>,
    t: f32,
    dur: f32,
}
static mut TW: Option<Tween> = None;

#[allow(static_mut_refs)]
fn st() -> &'static mut State {
    unsafe {
        if STATE.is_none() {
            let g = Graph::new();
            let params = LayoutParams::default();
            STATE = Some(State {
                l2: Layout::<2>::new(&g, params.clone(), 1),
                l3: Layout::<3>::new(&g, params.clone(), 1),
                v2: GraphView::new(800.0, 600.0),
                v3: GraphView3::new(800.0, 600.0),
                graph: g,
                params,
                mode: 2,
                out: Vec::new(),
                bounds: None,
                seed: 1,
            });
        }
        STATE.as_mut().unwrap()
    }
}

#[inline]
fn f(w: u32) -> f32 {
    f32::from_bits(w)
}

fn rgb(c: u32) -> Rgba {
    Rgba::srgb8((c >> 16) as u8, (c >> 8) as u8, c as u8, 255)
}

// ---- input -----------------------------------------------------------------

/// Scratch u32 buffer for numbers.
#[unsafe(no_mangle)]
#[allow(static_mut_refs)]
pub extern "C" fn ge_input(words: u32) -> *mut u32 {
    unsafe {
        INBUF.resize(words as usize, 0);
        INBUF.as_mut_ptr()
    }
}

/// Scratch byte buffer for the note names (UTF-8, one per line).
#[unsafe(no_mangle)]
#[allow(static_mut_refs)]
pub extern "C" fn ge_bytes(len: u32) -> *mut u8 {
    unsafe {
        BYTES.resize(len as usize, 0);
        BYTES.as_mut_ptr()
    }
}

/// Replaces the graph. Words: n, m, then per node (group, weight bits, unresolved), then per link (a, b).
/// The names come from the byte buffer, one line per node.
#[unsafe(no_mangle)]
#[allow(static_mut_refs)]
pub extern "C" fn ge_set_graph(words: u32, byte_len: u32) {
    let s = st();
    let w = unsafe { &INBUF[..words as usize] };
    let names = unsafe { String::from_utf8_lossy(&BYTES[..byte_len as usize]).to_string() };
    let labels: Vec<&str> = names.split('\n').collect();
    let (n, m) = (w[0] as usize, w[1] as usize);
    let mut g = Graph::new();
    for i in 0..n {
        let id = g.add_node(&i.to_string());
        let nd = g.node_mut(id);
        nd.label = labels.get(i).copied().unwrap_or("").to_string();
        nd.group = w[2 + i * 3] as u16;
        nd.weight = f(w[3 + i * 3]);
        nd.unresolved = w[4 + i * 3] != 0;
    }
    let base = 2 + n * 3;
    for k in 0..m {
        let (a, b) = (w[base + k * 2], w[base + k * 2 + 1]);
        if (a as usize) < n && (b as usize) < n {
            g.link_idx(a, b);
        }
    }
    let old2 = s.l2.pos.clone();
    let old3 = s.l3.pos.clone();
    let keep: Vec<u32> = unsafe { std::mem::take(&mut KEEP) };
    s.seed += 1;
    s.l2 = Layout::<2>::new(&g, s.params.clone(), s.seed);
    s.l3 = Layout::<3>::new(&g, s.params.clone(), s.seed);
    let keeping = keep.len() == n && n > 0 && !old2.is_empty();
    if keeping {
        // places of the nodes that were there; a new node starts next to the nodes it links to
        let place = |new: &mut Vec<[f32; 2]>, old: &Vec<[f32; 2]>| {
            for i in 0..n {
                if (keep[i] as usize) < old.len() {
                    new[i] = old[keep[i] as usize];
                }
            }
        };
        place(&mut s.l2.pos, &old2);
        let place3 = |new: &mut Vec<[f32; 3]>, old: &Vec<[f32; 3]>| {
            for i in 0..n {
                if (keep[i] as usize) < old.len() {
                    new[i] = old[keep[i] as usize];
                }
            }
        };
        place3(&mut s.l3.pos, &old3);
        for k in 0..m {
            let (a, b) = (w[base + k * 2] as usize, w[base + k * 2 + 1] as usize);
            if a < n && b < n {
                for (x, y) in [(a, b), (b, a)] {
                    if (keep[x] as usize) >= old2.len() && (keep[y] as usize) < old2.len() {
                        let j = s.l2.pos[y];
                        s.l2.pos[x] = [j[0] + 6.0 * (x % 5) as f32 - 12.0, j[1] + 6.0 * (x % 3) as f32 - 6.0];
                        let j3 = s.l3.pos[y];
                        s.l3.pos[x] = [j3[0] + 6.0 * (x % 5) as f32 - 12.0, j3[1] + 6.0 * (x % 3) as f32 - 6.0, j3[2] + 6.0 * (x % 4) as f32 - 9.0];
                    }
                }
            }
        }
    }
    // a start like d3-force's: nodes on a golden-angle spiral (a flat sunflower in 2D, a Fibonacci sphere in 3D) that the forces then push apart
    let spread = unsafe { SPREAD };
    if spread != 1.0 && !keeping {
        let step = s.params.link_distance * spread;
        for (i, p) in s.l2.pos.iter_mut().enumerate() {
            let r = step * ((i as f32) + 0.5).sqrt();
            let a = (i as f32) * 2.399_963;
            p[0] = r * a.cos();
            p[1] = r * a.sin();
        }
        let n3 = s.l3.pos.len().max(1) as f32;
        for (i, p) in s.l3.pos.iter_mut().enumerate() {
            let y = 1.0 - 2.0 * ((i as f32) + 0.5) / n3;
            let rr = (1.0 - y * y).max(0.0).sqrt();
            let a = (i as f32) * 2.399_963;
            let r = step * 1.6 * ((i as f32) + 0.5).powf(1.0 / 3.0);
            p[0] = r * rr * a.cos();
            p[1] = r * y;
            p[2] = r * rr * a.sin();
        }
    }
    s.graph = g;
    if !keeping {
        s.bounds = None;
    }
    s.v2.selected = None;
    s.v2.hover = None;
    s.v3.selected = None;
    // a first stretch of steps so the first picture is already roughly settled
    let pre = unsafe { PRERUN };
    let mode = unsafe { TW_MODE };
    unsafe {
        TW = None;
    }
    let from2: Vec<[f32; 2]> = if mode == 1 || !keeping { vec![[0.0; 2]; n] } else { s.l2.pos.clone() };
    let from3: Vec<[f32; 3]> = if mode == 1 || !keeping { vec![[0.0; 3]; n] } else { s.l3.pos.clone() };
    let steps = if pre >= 0 { pre as usize } else if n > 3000 { 40 } else if n > 800 { 150 } else if keeping { 200 } else { 400 };
    let steps = if keeping && mode == 0 { 0 } else { steps };
    s.l2.run(&s.graph, steps);
    s.l3.run(&s.graph, steps);
    if keeping && mode == 0 {
        s.l2.reheat(0.3);
        s.l3.reheat(0.3);
    }
    if mode != 0 && n > 0 {
        let to2 = s.l2.pos.clone();
        let to3 = s.l3.pos.clone();
        // a node that did not exist before starts where its neighbour ends up
        let mut f2 = from2.clone();
        let mut f3 = from3.clone();
        let mut delay2 = vec![0.0f32; n];
        let mut delay3 = vec![0.0f32; n];
        if mode == 1 {
            // as in Obsidian: the picture grows out of a small copy of itself, the nodes setting off one after another in no particular order
            let hash = |i: usize| (((i as u32).wrapping_mul(2654435761) >> 8) & 1023) as f32 / 1023.0;
            for i in 0..n {
                delay2[i] = hash(i);
                delay3[i] = hash(i + 7919);
                for a in 0..2 {
                    f2[i][a] = to2[i][a] * 0.18;
                }
                for a in 0..3 {
                    f3[i][a] = to3[i][a] * 0.18;
                }
            }
        } else if keeping {
            let old_len = keep.iter().filter(|&&k| k != u32::MAX).count();
            let _ = old_len;
            for k in 0..m {
                let (a, b) = (w[base + k * 2] as usize, w[base + k * 2 + 1] as usize);
                if a < n && b < n {
                    for (x, y) in [(a, b), (b, a)] {
                        if keep[x] == u32::MAX && keep[y] != u32::MAX {
                            f2[x] = to2[y];
                            f3[x] = to3[y];
                        }
                    }
                }
            }
        }
        // the camera frame of the finished picture, known in advance
        if mode == 1 || mode == 3 || s.bounds.is_none() {
            let (lo, hi) = {
                let saved = std::mem::replace(&mut s.l2.pos, to2.clone());
                let b = s.l2.display_bounds(s.v2.fit_trim);
                s.l2.pos = saved;
                b
            };
            s.bounds = Some((lo, hi));
        }
        s.l2.pos = f2.clone();
        s.l3.pos = f3.clone();
        unsafe {
            TW = Some(Tween { from2: f2, to2, from3: f3, to3, delay2, delay3, t: 0.0, dur: TW_DUR });
        }

}
}

/// How the next graph starts: `prerun` steps before the first picture (negative: default) and the start spread (0.05 = a tight knot that grows).
#[unsafe(no_mangle)]
pub extern "C" fn ge_set_intro(prerun: i32, spread: f32) {
    unsafe {
        PRERUN = prerun;
        SPREAD = if spread > 0.0 { spread } else { 1.0 };
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn ge_lock_bounds(on: u32) {
    unsafe {
        LOCK = on != 0;
    }
}

/// A speed limit for the layout, in layout units per step (0 restores the default); lets a growing graph move at a watchable pace.
#[unsafe(no_mangle)]
pub extern "C" fn ge_set_max_step(v: f32) {
    let s = st();
    s.params.max_step = if v > 0.0 { v } else { 40.0 };
    s.l2.params.max_step = s.params.max_step;
    s.l3.params.max_step = s.params.max_step;
}

#[unsafe(no_mangle)]
#[allow(static_mut_refs)]
pub extern "C" fn ge_keep(len: u32) -> *mut u32 {
    unsafe {
        KEEP.resize(len as usize, u32::MAX);
        KEEP.as_mut_ptr()
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn ge_freeze_bounds(on: u32) {
    unsafe {
        FREEZE = on != 0;
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn ge_set_tween(mode: u32, dur_ms: f32) {
    unsafe {
        TW_MODE = mode;
        TW_DUR = dur_ms.max(100.0);
    }
}

/// Advances the arrival by `dt` milliseconds. Returns 1 while it is still moving.
#[unsafe(no_mangle)]
#[allow(static_mut_refs)]
pub extern "C" fn ge_tween_step(dt: f32) -> u32 {
    unsafe {
        let s = st();
        let Some(tw) = TW.as_mut() else { return 0 };
        let n = tw.to2.len();
        if s.l2.pos.len() != n || s.l3.pos.len() != n {
            TW = None;
            return 0;
        }
        tw.t += dt;
        let d = tw.dur * 0.6;
        let ease = |k: f32| {
            let k = k.clamp(0.0, 1.0);
            k * k * k * (k * (k * 6.0 - 15.0) + 10.0)
        };
        for i in 0..n {
            let k2 = ease((tw.t - tw.delay2[i] * (tw.dur - d)) / d);
            for a in 0..2 {
                s.l2.pos[i][a] = tw.from2[i][a] + (tw.to2[i][a] - tw.from2[i][a]) * k2;
            }
            let k3 = ease((tw.t - tw.delay3[i] * (tw.dur - d)) / d);
            for a in 0..3 {
                s.l3.pos[i][a] = tw.from3[i][a] + (tw.to3[i][a] - tw.from3[i][a]) * k3;
            }
        }
        if tw.t >= tw.dur {
            for i in 0..n {
                s.l2.pos[i] = tw.to2[i];
                s.l3.pos[i] = tw.to3[i];
            }
            TW = None;
            return 0;
        }
        1
    }
}

/// Layout forces: repulsion, link distance, link strength, then velocity decay.
#[unsafe(no_mangle)]
pub extern "C" fn ge_set_params(repulsion: f32, link_distance: f32, link_strength: f32, recenter: f32) {
    let s = st();
    s.params.repulsion = repulsion;
    s.params.link_distance = link_distance;
    s.params.link_strength = link_strength;
    s.params.recenter = recenter;
    s.params.alpha_decay = 0.03; // settles in a couple of seconds instead of drifting for ten
    // the running layouts keep their positions and pick the new forces up
    s.l2.params = s.params.clone();
    s.l3.params = s.params.clone();
    s.l2.rebuild_springs(&s.graph);
    s.l3.rebuild_springs(&s.graph);
    s.l2.reheat(0.6);
    s.l3.reheat(0.6);
}

/// Colours (0xRRGGBB): background, link, label, accent, unresolved; then flags.
#[unsafe(no_mangle)]
pub extern "C" fn ge_set_style(bg: u32, edge: u32, label: u32, accent: u32, unresolved: u32, color_by: u32, labels: u32, label_min_degree: u32, node_scale: f32, edge_alpha: f32) {
    let s = st();
    let mut style = GraphStyle::dark();
    style.bg = rgb(bg);
    style.edge = rgb(edge);
    style.label = rgb(label);
    style.accent = rgb(accent);
    style.unresolved = rgb(unresolved);
    style.node_radius *= node_scale;
    style.degree_radius *= node_scale;
    style.max_radius *= node_scale.max(0.6);
    style.edge_alpha = edge_alpha;
    let cb = match color_by {
        1 => ColorBy::Degree,
        2 => ColorBy::Uniform,
        _ => ColorBy::Group,
    };
    s.v2.style = style.clone();
    s.v3.style = style;
    s.v2.color_by = cb;
    s.v3.color_by = cb;
    s.v2.show_labels = labels != 0;
    s.v3.show_labels = labels != 0;
    s.v2.label_min_degree = label_min_degree as usize;
    s.v3.label_min_degree = label_min_degree as usize;
}

#[unsafe(no_mangle)]
pub extern "C" fn ge_set_mode(mode: u32) {
    st().mode = if mode == 3 { 3 } else { 2 };
}

// ---- simulation --------------------------------------------------------------

/// Runs `n` layout steps for the active mode. Returns 1 when it has settled.
#[unsafe(no_mangle)]
pub extern "C" fn ge_step(n: u32) -> u32 {
    let s = st();
    for _ in 0..n {
        if s.mode == 3 {
            s.l3.step(&s.graph);
        } else {
            s.l2.step(&s.graph);
        }
    }
    if (if s.mode == 3 { s.l3.settled() } else { s.l2.settled() }) { 1 } else { 0 }
}

#[unsafe(no_mangle)]
pub extern "C" fn ge_reheat(alpha: f32) {
    let s = st();
    s.l2.reheat(alpha);
    s.l3.reheat(alpha);
}

// ---- camera and picking ---------------------------------------------------------

fn resize(s: &mut State, w: f32, h: f32) {
    s.v2.width = w;
    s.v2.height = h;
    s.v3.width = w;
    s.v3.height = h;
}

/// Pan in 2D (pixels) or orbit in 3D (pixels of drag).
#[unsafe(no_mangle)]
pub extern "C" fn ge_drag(dx: f32, dy: f32) {
    let s = st();
    if s.mode == 3 {
        s.v3.orbit(dx, dy);
    } else {
        s.v2.pan_by(dx, dy);
    }
}

/// Wheel zoom around a point (2D) or towards the centre (3D).
#[unsafe(no_mangle)]
pub extern "C" fn ge_zoom(x: f32, y: f32, ticks: f32) {
    let s = st();
    if s.mode == 3 {
        s.v3.zoom(ticks);
    } else {
        let factor = (1.0f32 + 0.12 * ticks.abs()).powf(if ticks < 0.0 { 1.0 } else { -1.0 });
        s.v2.zoom_at(&s.l2, vec2(x, y), factor);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn ge_fit() {
    let s = st();
    s.v2.fit();
    s.bounds = None;
    s.v3.camera = Camera { distance: 1.7, ..Camera::default() };
}

/// Node under a screen point, or -1.
#[unsafe(no_mangle)]
pub extern "C" fn ge_pick(x: f32, y: f32, w: f32, h: f32) -> i32 {
    let s = st();
    resize(s, w, h);
    let hit = if s.mode == 3 { s.v3.pick(&s.graph, &s.l3, vec2(x, y), 4.0) } else { s.v2.pick(&s.graph, &s.l2, vec2(x, y)) };
    hit.map_or(-1, |i| i as i32)
}

/// Highlights a node's neighbourhood (-1 clears it).
#[unsafe(no_mangle)]
pub extern "C" fn ge_select(i: i32, depth: u32) {
    let s = st();
    let id = if i >= 0 && (i as usize) < s.graph.len() { Some(i as u32) } else { None };
    s.v2.selected = id;
    s.v3.selected = id;
    s.v2.highlight_depth = depth;
    s.v3.highlight_depth = depth;
}

/// Holds a node at a screen point while it is dragged (2D) and wakes the layout.
#[unsafe(no_mangle)]
pub extern "C" fn ge_pin(i: u32, x: f32, y: f32) {
    let s = st();
    if s.mode == 3 || (i as usize) >= s.graph.len() {
        return;
    }
    let at = s.v2.to_layout(&s.l2, vec2(x, y));
    s.l2.pin(i, at);
    s.l2.reheat(0.35);
}

#[unsafe(no_mangle)]
pub extern "C" fn ge_unpin(i: u32) {
    let s = st();
    if (i as usize) < s.graph.len() {
        s.l2.unpin(i);
        s.l3.unpin(i);
    }
}

/// Where a node is on screen (x, y written to the scratch buffer as f32); returns 1 if visible.
#[unsafe(no_mangle)]
#[allow(static_mut_refs)]
pub extern "C" fn ge_screen_of(i: u32) -> u32 {
    let s = st();
    if (i as usize) >= s.graph.len() {
        return 0;
    }
    let p = if s.mode == 3 {
        match s.v3.screen_of(&s.l3, i) {
            Some((p, _)) => p,
            None => return 0,
        }
    } else {
        s.v2.screen_of(&s.l2, i)
    };
    unsafe {
        INBUF.resize(2, 0);
        INBUF[0] = p.x.to_bits();
        INBUF[1] = p.y.to_bits();
    }
    1
}

#[unsafe(no_mangle)]
pub extern "C" fn ge_degree(i: u32) -> u32 {
    let s = st();
    if (i as usize) < s.graph.len() { s.graph.degree(i) as u32 } else { 0 }
}

// ---- drawing -----------------------------------------------------------------------

/// Builds a frame for a `w` x `h` view. Returns the command stream; length via `ge_out_len`.
#[unsafe(no_mangle)]
pub extern "C" fn ge_render(w: f32, h: f32, hover: i32) -> *const f32 {
    let s = st();
    resize(s, w, h);
    let hov = if hover >= 0 && (hover as usize) < s.graph.len() { Some(hover as u32) } else { None };
    s.v2.hover = hov;
    let dl = if s.mode == 3 {
        s.v3.render(&s.graph, &s.l3)
    } else {
        // smooth the fitted bounds a little so a layout that is still settling does not rescale the whole picture each frame
        let (lo, hi) = if unsafe { LOCK } {
            let r = s.params.link_distance * (s.graph.len() as f32).sqrt() * 0.85 + 10.0;
            ([-r, -r], [r, r])
        } else {
            s.l2.display_bounds(s.v2.fit_trim)
        };
        let b = match s.bounds {
            Some(frozen) if unsafe { FREEZE } => frozen,
            Some((plo, phi)) => ([plo[0] + (lo[0] - plo[0]) * 0.04, plo[1] + (lo[1] - plo[1]) * 0.04], [phi[0] + (hi[0] - phi[0]) * 0.04, phi[1] + (hi[1] - phi[1]) * 0.04]),
            None => (lo, hi),
        };
        s.bounds = Some(b);
        s.v2.fixed_bounds = Some(b);
        s.v2.render(&s.graph, &s.l2)
    };
    let mut out = std::mem::take(&mut s.out);
    encode(&dl, &mut out);
    s.out = out;
    s.out.as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn ge_out_len() -> u32 {
    st().out.len() as u32
}

fn encode(dl: &DrawList, out: &mut Vec<f32>) {
    out.clear();
    let put_color = |out: &mut Vec<f32>, c: Rgba| {
        let [r, g, b, a] = c.to_srgb8();
        out.extend_from_slice(&[r as f32, g as f32, b as f32, a as f32 / 255.0]);
    };
    for p in &dl.prims {
        match p {
            Prim::Fill { path, color } => {
                out.push(1.0);
                put_color(out, *color);
                out.push(path.subpaths.len() as f32);
                for sp in &path.subpaths {
                    out.push(sp.len() as f32);
                    for v in sp {
                        out.extend_from_slice(&[v.x, v.y]);
                    }
                }
            }
            Prim::Stroke { pts, style, color } => {
                out.push(2.0);
                put_color(out, *color);
                out.push(style.width);
                out.push(1.0);
                out.push(pts.len() as f32);
                for v in pts {
                    out.extend_from_slice(&[v.x, v.y]);
                }
            }
            Prim::Points { centers, size, fill, outline, .. } => {
                out.push(8.0);
                put_color(out, *fill);
                let (oc, ow) = outline.unwrap_or((Rgba::srgb8(0, 0, 0, 0), 0.0));
                put_color(out, oc);
                out.push(ow);
                out.push(*size * 0.5);
                out.push(centers.len() as f32);
                for v in centers {
                    out.extend_from_slice(&[v.x, v.y]);
                }
            }
            Prim::Text(t) => {
                out.push(7.0);
                out.extend_from_slice(&[t.pos.x, t.pos.y, t.size]);
                put_color(out, t.color);
                out.push(match t.h_align {
                    Align::Start => 0.0,
                    Align::Center => 1.0,
                    Align::End => 2.0,
                });
                out.push(match t.v_align {
                    Align::Start => 0.0,
                    Align::Center => 1.0,
                    Align::End => 2.0,
                });
                let units: Vec<u16> = t.content.encode_utf16().collect();
                out.push(units.len() as f32);
                out.extend(units.iter().map(|&u| u as f32));
            }
            Prim::PushClip(r) => out.extend_from_slice(&[4.0, r.x0, r.y0, r.x1, r.y1]),
            Prim::PopClip => out.push(5.0),
            _ => {}
        }
    }
    out.push(0.0);
}
