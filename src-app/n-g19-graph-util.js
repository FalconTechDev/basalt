// g19 clean-room: graph view data helpers and small math/DOM utilities.
// Pure functions plus the local-graph flood fill and the nav-tree sort helper.
import { env } from "./env.js";

// ---------------------------------------------------------------------------
// scalar helpers
// ---------------------------------------------------------------------------

/** Frame-rate independent damp: `a*t + b*(1-t)`. */
export function ng19Damp(a, b, t = 0.9) {
  return a * t + b * (1 - t);
}

/** Per-channel damp of two 0xRRGGBB colours. */
export function ng19LerpColor(a, b) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ng19Damp(ar, br)), g = Math.round(ng19Damp(ag, bg)), bl = Math.round(ng19Damp(ab, bb));
  return (r << 16) | (g << 8) | bl;
}

/** True when the two {left,right,top,bottom} boxes do NOT intersect. */
export function ng19BoxesDisjoint(a, b) {
  return a.left > b.right || a.right < b.left || a.top > b.bottom || a.bottom < b.top;
}

/** Box of half-size `n` around (x, y). */
export function ng19BoxAround(x, y, n) {
  return { left: x - n, right: x + n, top: y - n, bottom: y + n };
}

/** Reset a canvas element to a bare full-size block. */
export function ng19ResetCanvasStyle(el) {
  el.style.margin = "0";
  el.style.padding = "0";
  el.style.border = "0";
  el.style.width = "100%";
  el.style.height = "100%";
  el.style.overflow = "hidden";
}

// ---------------------------------------------------------------------------
// constants (exact contract values)
// ---------------------------------------------------------------------------

export const ng19GraphDefaults = {
  showAttachments: false,
  hideUnresolved: false,
  showOrphans: true,
  showTags: false,
  localFile: null,
  localJumps: 1,
  localInterlinks: false,
  localForelinks: true,
  localBacklinks: true,
};

export const ng19GraphLinkAlpha = 0.2;
export const ng19GraphNoWeightTypes = { tag: true };
export const ng19GraphNodeBaseSize = 100;

export const ng19GraphColorClasses = {
  fill: "color-fill",
  fillFocused: "color-fill-focused",
  fillTag: "color-fill-tag",
  fillUnresolved: "color-fill-unresolved",
  fillAttachment: "color-fill-attachment",
  arrow: "color-arrow",
  circle: "color-circle",
  line: "color-line",
  text: "color-text",
  fillHighlight: "color-fill-highlight",
  lineHighlight: "color-line-highlight",
};

export const ng19PixiScriptUrl = "/lib/pixi.min.js?7.2.4";
export const ng19WorkerUrl = "/sim.js";
export const ng19WorkerName = "Graph Worker";
export const ng19PowerTagText = "Powered by Basalt";

/** Kicks off the PIXI script load through the host script loader; returns its handle. */
export function ng19LoadPixiScript() {
  return env().Hv(ng19PixiScriptUrl);
}

// ---------------------------------------------------------------------------
// node data records
// ---------------------------------------------------------------------------

/** Fresh node data record: `{type, links:{}}`. */
export function ng19GraphNodeData(type = "") {
  return { type, links: {} };
}

/** Copy of a node record preserving `type` and an optional `color`; links start empty. */
export function ng19GraphNodeDataFrom(node) {
  if (node == null) return ng19GraphNodeData();
  const out = ng19GraphNodeData(node.type || "");
  if (node.color !== undefined && node.color !== null) out.color = node.color;
  return out;
}

// ---------------------------------------------------------------------------
// local-graph flood fill
// ---------------------------------------------------------------------------

/**
 * BFS-ish flood over `graph.nodes` ({path: {type, links, color?}}) starting at
 * `options.localFile`. Returns `{nodes, weights}`; the seed weighs 30 and each
 * subsequent jump pass weighs `30 - (30/localJumps)*(p+1)`.
 */
export function ng19GraphLocalData(graph, options) {
  const source = graph && graph.nodes ? graph.nodes : {};
  const opts = options || {};
  const localFile = opts.localFile;
  const nodes = {};
  const weights = {};
  if (localFile == null) return { nodes, weights };
  weights[localFile] = 30;
  const seed = source[localFile];
  if (!seed) {
    nodes[localFile] = ng19GraphNodeData();
    return { nodes, weights };
  }
  nodes[localFile] = ng19GraphNodeDataFrom(seed);

  const jumps = Math.max(1, opts.localJumps | 0 || 1);
  const step = 30 / jumps;
  const fore = opts.localForelinks !== false;
  const back = opts.localBacklinks !== false;
  const noWeight = ng19GraphNoWeightTypes;

  for (let p = 0; p < jumps; p++) {
    const w = 30 - step * (p + 1);
    const reached = new Set(Object.keys(nodes));
    for (const id in source) {
      if (!Object.hasOwn(source, id)) continue;
      const rec = source[id];
      const links = rec && rec.links;
      if (!links) continue;
      for (const other in links) {
        if (!Object.hasOwn(links, other)) continue;
        if (fore && reached.has(id) && !reached.has(other) && !nodes[other]) {
          if (noWeight[rec.type]) continue;
          nodes[other] = ng19GraphNodeDataFrom(source[other] || rec);
          if (nodes[id]) nodes[id].links[other] = true;
          weights[other] = w;
        } else if (back && reached.has(other) && !reached.has(id) && !nodes[id]) {
          if (noWeight[source[other] && source[other].type]) continue;
          nodes[id] = ng19GraphNodeDataFrom(rec);
          nodes[id].links[other] = true;
          weights[id] = w;
        }
      }
    }
  }

  if (opts.localInterlinks) {
    for (const path in nodes) {
      if (!Object.hasOwn(nodes, path)) continue;
      const full = source[path];
      if (!full) continue;
      const rec = ng19GraphNodeDataFrom(full);
      rec.links = Object.assign({}, full.links || {});
      nodes[path] = rec;
    }
  }
  return { nodes, weights };
}

// ---------------------------------------------------------------------------
// nav-tree ordering helper
// ---------------------------------------------------------------------------

/**
 * In-place sort of tree items. With `recurse`, folder children are sorted first.
 * Order: paths listed in `order` before unlisted, listed by `order[path]` asc,
 * then folders before other items, then by `name` via the locale-aware compare.
 */
export function ng19SortTreeItems(tree, order, recurse = true) {
  if (!Array.isArray(tree)) return;
  if (recurse) {
    for (const item of tree) {
      if (item && item.type === "folder" && Array.isArray(item.children)) {
        ng19SortTreeItems(item.children, order, recurse);
      }
    }
  }
  const rank = (item) => {
    const p = item && item.path;
    return p != null && order != null && Object.hasOwn(order, p) ? order[p] : null;
  };
  tree.sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    const la = ra !== null, lb = rb !== null;
    if (la !== lb) return la ? -1 : 1;
    if (la && ra !== rb) return ra - rb;
    const fa = a && a.type === "folder" ? 0 : 1;
    const fb = b && b.type === "folder" ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return env().ub((a && a.name) || "", (b && b.name) || "");
  });
}
