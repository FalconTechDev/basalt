// g30 clean-room: DOM-rect/geometry helpers, scroll watcher, key-name joiner,
// view-config padding reader, edge/resize anchor geometry, nearest-side hit
// test, span matching and canvas colour application (spec g30 part L).
import {point, rect, distance, rectAt, centeredOrigin, boxX, boxY, sideMidpoint, sortByKey, unitSteps,} from "./misc.js";
import {floatOr} from "./text.js";

export const ng30DigitsRe = /^(\d+)$/;
export const ng30RgbRe = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/i;

/** Client rect offset by border, with centred box extents for hit tests. */
export function ng30DomRect(el) {
  const r = el.getBoundingClientRect();
  const left = r.left + el.clientLeft;
  const top = r.top + el.clientTop;
  const width = el.clientWidth;
  const height = el.clientHeight;
  return {
    left, top, width, height,
    cx: left + width / 2, cy: top + height / 2,
    minX: -width / 2, minY: -height / 2, maxX: width / 2, maxY: height / 2,
  };
}

/** The part of `el` actually visible, in element-local coordinates scaled for zoom. */
export function ng30VisibleRect(el) {
  if (el.closest && el.closest(".print")) return { top: 0, left: 0, bottom: Infinity, right: Infinity };
  const win = el.win || window;
  const r = el.getBoundingClientRect();
  const rw = Math.round(r.width), rh = Math.round(r.height);
  const scale = rw ? el.clientWidth / rw : rh ? el.clientHeight / rh : 1;
  let clipLeft = 0, clipTop = 0, clipRight = win.innerWidth, clipBottom = win.innerHeight;
  const body = el.ownerDocument ? el.ownerDocument.body : document.body;
  let node = el.parentNode;
  let direct = true;
  while (node && node !== body) {
    if (node.nodeType === 1) {
      const cs = win.getComputedStyle(node);
      if ((node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth) && cs.overflow !== "visible") {
        const br = node.getBoundingClientRect();
        clipLeft = Math.max(clipLeft, br.left);
        clipRight = Math.min(clipRight, br.right);
        clipTop = Math.max(clipTop, br.top);
        clipBottom = Math.min(clipBottom, direct ? win.innerHeight : br.bottom);
      }
      node = (cs.position === "absolute" || cs.position === "fixed") ? node.offsetParent : node.parentNode;
    } else if (node.nodeType === 11) {
      node = node.host;
    } else {
      break;
    }
    direct = false;
  }
  return {
    left: scale * (clipLeft - r.left),
    right: scale * (Math.max(clipLeft, clipRight) - r.left),
    top: scale * (clipTop - r.top),
    bottom: scale * (Math.max(clipTop, clipBottom) - r.top),
  };
}

/**
 * Observes `el`'s visibility fraction (dense 0..1 thresholds) and the scroll
 * events of the window it is shown in; `onChange` fires on either. Returns a
 * disposer. `el` follows the Component contract (isShown/win/onNodeInserted).
 */
export function ng30ScrollWatch(el, onChange) {
  let win = null;
  const observer = new IntersectionObserver(onChange, { threshold: unitSteps(1000) });
  observer.observe(el);
  function onScroll(evt) {
    const target = evt.target;
    if (target && target.contains && target.contains(el)) onChange();
  }
  function sync() {
    const next = el.isShown() ? el.win : null;
    if (next !== win) {
      if (win) win.removeEventListener("scroll", onScroll, true);
      win = next;
      if (win) win.addEventListener("scroll", onScroll, { capture: true, passive: true });
    }
    onChange();
  }
  const unsub = el.onNodeInserted(sync);
  sync();
  return function dispose() {
    if (unsub) unsub();
    observer.disconnect();
    if (win) win.removeEventListener("scroll", onScroll, true);
    win = null;
  };
}

/** Display names for key chords; only OWN keyNames entries translate. */
export function ng30KeyNames(keys, host) {
  const sep = host.Platform.isMacOS ? " " : " + ";
  const table = host.keyNames || {};
  const has = Object.prototype.hasOwnProperty;
  return keys.map((k) => (has.call(table, k) ? table[k] : k)).join(sep);
}

/** Padding of a view config as {top,bottom,start,end}; parseFloat semantics. */
export function ng30PaddingBox(config) {
  return {
    top: floatOr(config.paddingTop, 0),
    bottom: floatOr(config.paddingBottom, 0),
    start: floatOr(config.paddingInlineStart, 0),
    end: floatOr(config.paddingInlineEnd, 0),
  };
}

/** Rect placed at `origin` for `box`; `placement` recentres or edge-anchors it. */
export function ng30AnchorRect(origin, box, placement) {
  let o = origin;
  if (placement === "center") {
    o = centeredOrigin(origin, box);
  } else if (placement) {
    const w = box.width, h = box.height;
    switch (placement) {
      case "left": o = point(origin.x, origin.y - h / 2); break;
      case "top": o = point(origin.x - w / 2, origin.y); break;
      case "right": o = point(origin.x - w, origin.y - h / 2); break;
      case "bottom": o = point(origin.x - w / 2, origin.y - h); break;
      default: o = undefined;
    }
  }
  return rectAt(o, box);
}

/** The zero-area source rect + axis flags a side/corner resize drag starts from. */
export function ng30ResizeOrigin(side, p, box) {
  switch (side) {
    case "top":
    case "bottom":
      return { source: rect(box.x, p.y, box.width, 0), resizeX: false, resizeY: true };
    case "left":
    case "right":
      return { source: rect(p.x, box.y, 0, box.height), resizeX: true, resizeY: false };
    case "topleft":
    case "topright":
    case "bottomleft":
    case "bottomright":
      return { source: rect(p.x, p.y, 0, 0), resizeX: true, resizeY: true };
  }
  return { source: undefined, resizeX: undefined, resizeY: undefined };
}

const NG30_SIDES = ["top", "right", "bottom", "left"];

/** First in-range side wins; otherwise the closest side seen across all nodes. */
export function ng30NearestSide(p, nodes, maxDistance) {
  let best = null;
  for (const node of nodes) {
    const bbox = node.getBBox();
    for (const side of NG30_SIDES) {
      const mid = sideMidpoint(bbox, side);
      const d = distance(p, mid);
      if (d <= maxDistance) return { side, node };
      if (!best || d < best.d) best = { side, node, d };
    }
  }
  return best ? { side: best.side, node: best.node } : null;
}

/**
 * Aligns two item lists on one axis to find matching spans (canvas snapping).
 * Sorts BOTH inputs in place; returns {matches:[{src,dest}], delta} or null.
 * Candidate offsets join the run when they equal the running best delta or are
 * strictly smaller in magnitude (which resets the accumulated matches).
 */
export function ng30MatchSpans(source, dest, delta, axis) {
  if (!source.length || !dest.length) return null;
  const key = axis === "y" ? boxY : boxX;
  sortByKey(source, key);
  sortByKey(dest, key);
  const matches = [];
  let bestDelta = delta;
  let i = 0;
  while (i < source.length) {
    const k = key(source[i]);
    let j = i + 1;
    while (j < source.length && key(source[j]) === k) j++;
    const srcGroup = source.slice(i, j);
    i = j;
    // binary search dest for k -> insertion point `lo`
    let lo = 0, hi = dest.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (key(dest[mid]) < k) lo = mid + 1; else hi = mid;
    }
    // candidate indices lo-1 (below) and lo (at/above); pick the nearer key,
    // ties prefer the side whose offset equals bestDelta, else the higher index
    let pick = -1;
    if (lo < dest.length && lo > 0) {
      const dLo = k - key(dest[lo - 1]), dHi = key(dest[lo]) - k;
      if (dLo !== dHi) pick = dLo < dHi ? lo - 1 : lo;
      else {
        const offLo = key(dest[lo - 1]) - k, offHi = key(dest[lo]) - k;
        pick = offLo === bestDelta ? lo - 1 : lo;
      }
    } else if (lo < dest.length) pick = lo;
    else if (lo > 0) pick = lo - 1;
    if (pick < 0) continue;
    const destKey = key(dest[pick]);
    let e = pick;
    while (e > 0 && key(dest[e - 1]) === destKey) e--;
    let f = pick;
    while (f + 1 < dest.length && key(dest[f + 1]) === destKey) f++;
    const destGroup = dest.slice(e, f + 1);
    const off = destKey - k;
    if (Math.abs(off) < Math.abs(bestDelta) || off === bestDelta) {
      if (Math.abs(off) < Math.abs(bestDelta)) {
        matches.length = 0;
        bestDelta = off;
      }
      matches.push({ src: srcGroup, dest: destGroup });
    }
  }
  return matches.length ? { matches, delta: bestDelta } : null;
}

/** Applies a canvas node colour: numbered palette class, custom rgb, or themed only. */
export function ng30ApplyCanvasColor(el, color, host) {
  const c = (color || "").trim();
  for (const cls of Array.from(el.classList)) {
    if (cls.startsWith("mod-canvas-color")) el.classList.remove(cls);
  }
  el.style.removeProperty("--canvas-color");
  el.classList.toggle("is-themed", !!c);
  if (!c) return;
  if (ng30DigitsRe.test(c)) {
    el.classList.add("mod-canvas-color-" + c);
    return;
  }
  const parsed = host.s13ParseColor(c);
  if (parsed) {
    el.classList.add("mod-canvas-color-custom");
    el.style.setProperty("--canvas-color", parsed.r + "," + parsed.g + "," + parsed.b);
  }
}
