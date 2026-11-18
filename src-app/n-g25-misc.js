// g25 clean-room misc helpers: numbers, lists, dates, colours, binary, geometry, DOM/clipboard glue.
// Spec: F:\orch\specs\g25.md Part A. No host/env usage; `activeDocument` is a bundle-scope free variable.

export function smaller(a, b) { return a < b ? a : b; }
export function larger(a, b) { return a > b ? a : b; }

/** Perceptual slider mapping: slider fraction `x` at position `t`. */
export function sliderCurve(x, t) { return (Math.pow(t, 1 - x) - t) / (1 - t); }

/** Inverse of sliderCurve for the same `t`. */
export function sliderCurveInverse(y, t) {
  return 1 - Math.log(y * (1 - t) + t) / Math.log(t);
}

/** n+1 evenly spaced values from 0 to 1 inclusive. */
export function unitSteps(n) {
  const out = new Array(n + 1);
  for (let i = 0; i <= n; i++) out[i] = i / n;
  return out;
}

/** `length` lowercase hex chars from Math.random (not crypto-random). */
export function randomHex(length) {
  let s = "";
  for (let i = 0; i < length; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

export function asArray(v) { return Array.isArray(v) ? v : [v]; }

/** Deduped array, first occurrence wins (=== equality). */
export function distinct(list) {
  const out = [];
  for (const v of list) if (!out.includes(v)) out.push(v);
  return out;
}

/** In-place move of the element at `from` to index `to`; returns the list. */
export function moveItem(list, from, to) {
  list.splice(to, 0, list.splice(from, 1)[0]);
  return list;
}

/** Removes and returns the first element matching `test`, or null. */
export function takeFirst(list, test) {
  for (let i = 0; i < list.length; i++) {
    if (test(list[i])) return list.splice(i, 1)[0];
  }
  return null;
}

/**
 * Three-way binary search: probe returns 0 on match, negative to search the left
 * half, positive for the right half. Returns the item or null.
 */
export function binaryFind(list, probe) {
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = probe(list[mid]);
    if (r === 0) return list[mid];
    if (r < 0) hi = mid - 1; else lo = mid + 1;
  }
  return null;
}

/** Every element is a string; `lenient` ignores null/undefined entries. */
export function isStringArray(v, lenient = false) {
  if (!Array.isArray(v)) return false;
  for (const x of v) {
    if (lenient && (x === null || x === undefined)) continue;
    if (typeof x !== "string") return false;
  }
  return true;
}

/** Concat that avoids copying when either side is empty. */
export function joinLists(a, b) {
  if (!a || a.length === 0) return b || [];
  if (!b || b.length === 0) return a;
  return a.concat(b);
}

/**
 * Sliding undo window: entries history[from..at-1] plus `entry`. Once the
 * history grows past `keep + 20` entries the oldest are dropped.
 */
export function pushHistory(history, at, keep, entry) {
  const from = at + 1 > keep + 20 ? at - keep - 1 : 0;
  return history.slice(from, at).concat(entry);
}

export function sameItems(a, b) {
  if (a == b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function sameItemsBy(a, b, eq) {
  if (a == b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false;
  return true;
}

/** In-place sort by index in `order`; unknown ids sort last (stable). */
export function sortByOrder(items, order) {
  const rank = new Map();
  for (let i = 0; i < order.length; i++) if (!rank.has(order[i])) rank.set(order[i], i);
  const r = (item) => {
    const v = rank.get(item.id);
    return v === undefined ? Infinity : v;
  };
  items.sort((a, b) => {
    const ra = r(a), rb = r(b);
    return ra === rb ? 0 : ra < rb ? -1 : 1;
  });
  return items;
}

/** Suggestion penalty: 0 without matches, else -(count + firstScore/10). */
export function matchPenalty(matches) {
  if (!matches) return 0;
  return -(matches.length + matches[0][0] / 10);
}

export function twoDigits(n) { return n < 10 ? "0" + n : String(n); }

function ng25Pad2(n) { return n < 10 ? "0" + n : String(n); }

/** "YYYY-MM-DD" in local time; year padded to 4 digits. */
export function localDate(d) {
  return String(d.getFullYear()).padStart(4, "0") + "-" + ng25Pad2(d.getMonth() + 1) + "-" + ng25Pad2(d.getDate());
}

/** "HH:MM:SS" in local time. */
export function localTime(d) {
  return ng25Pad2(d.getHours()) + ":" + ng25Pad2(d.getMinutes()) + ":" + ng25Pad2(d.getSeconds());
}

export function hexByte(n) { return n.toString(16).padStart(2, "0"); }

function ng25Channel(v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"); }

export function rgbToHex({ r, g, b }) { return "#" + ng25Channel(r) + ng25Channel(g) + ng25Channel(b); }
export function rgbToInt({ r, g, b }) { return (r << 16) | (g << 8) | b; }

/** Perceived brightness (Rec. 601 luma) at or above 150. */
export function isLightColor({ r, g, b }) { return (299 * r + 587 * g + 114 * b) / 1000 >= 150; }

/** h 0-360, s/l 0-100 -> {r,g,b} 0-255 rounded. */
export function hslToRgb({ h, s, l }) {
  h = ((h % 360) + 360) % 360 / 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: Math.round(hue(h + 1 / 3) * 255), g: Math.round(hue(h) * 255), b: Math.round(hue(h - 1 / 3) * 255) };
}

/** 0-255 rgb -> {h,s,l} integer degrees/percents. */
export function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: Math.round(h * 60), s: Math.round(s * 100), l: Math.round(l * 100) };
}

const ng25Hex6 = /^#?([0-9a-fA-F]{6})$/;

/** "#aabbcc" or "aabbcc" -> {r,g,b}; anything else -> null. */
export function parseHexColor(text) {
  const m = ng25Hex6.exec(String(text));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const ng25RgbTriple = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*$/;

/** "r, g, b" -> "#rrggbb"; non-matching input returned unchanged. */
export function rgbTripleToHex(text) {
  const m = ng25RgbTriple.exec(String(text));
  if (!m) return text;
  return "#" + [+m[1], +m[2], +m[3]].map((v) => (v & 255).toString(16).padStart(2, "0")).join("");
}

/** Hex string -> ArrayBuffer; odd tail and non-hex chars degrade to 0 bytes. */
export function hexToBuffer(hex) {
  const s = String(hex);
  const out = new Uint8Array(Math.ceil(s.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out.buffer;
}

/** ArrayBuffer -> lowercase hex. */
export function bufferToHex(buf) {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i++) s += u[i].toString(16).padStart(2, "0");
  return s;
}

export function stringFromCodes(codes) { return String.fromCharCode.apply(null, codes); }

export function readInt32BE(bytes, at) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(at, false);
}

export function readInt32LE(bytes, at) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(at, true);
}

/** Exact copy of the bytes a typed array view covers. */
export function ownBuffer(view) {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

/** Fill with 0 and return the array. */
export function zeroFill(list) { list.fill(0); return list; }

/** dst[i] ^= src[i] in place. */
export function xorInto(dst, src) {
  for (let i = 0; i < dst.length; i++) dst[i] ^= src[i];
  return dst;
}

/** Clear bit 7 of the bytes at length-8 and length-4 (SIV tag positions). */
export function clearTopBits(bytes) {
  bytes[bytes.length - 8] &= 0x7f;
  bytes[bytes.length - 4] &= 0x7f;
  return bytes;
}

/** fs.Stats-like -> {ctime,mtime,size} with rounded times. */
export function statFromNode(st) {
  return { ctime: Math.round(st.birthtimeMs), mtime: Math.round(st.mtimeMs), size: st.size };
}

/** Capacitor stat -> {ctime,mtime,size} with rounded times. */
export function statFromCapacitor(st) {
  return { ctime: Math.round(st.ctime), mtime: Math.round(st.mtime), size: st.size };
}

// ---------------------------------------------------------------- geometry

export function point(x, y) { return { x, y }; }
export function rect(x, y, width, height) { return { x, y, width, height }; }

export function distance(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function rectAt(origin, size) {
  return { x: origin.x, y: origin.y, width: size.width, height: size.height };
}

export function pointOfEvent(e) { return { x: e.clientX, y: e.clientY }; }

export function box(minX, minY, maxX, maxY) { return { minX, minY, maxX, maxY }; }

export function boxOfPoints(a, b) {
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

export function boxOfRect(r) {
  return { minX: r.x, minY: r.y, maxX: r.x + r.width, maxY: r.y + r.height };
}

export function rectOfBox(b) {
  return { x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY };
}

export function boxContains(a, b) {
  return a.minX <= b.minX && a.minY <= b.minY && a.maxX >= b.maxX && a.maxY >= b.maxY;
}

export function boxCenter(b) {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** Point offset so `size` is centered on `p`. */
export function centeredOrigin(p, size) {
  return { x: p.x - size.width / 2, y: p.y - size.height / 2 };
}

export function boxX(p) { return p.x; }
export function boxY(p) { return p.y; }

/** Smallest box containing all; empty input -> inverted infinite box. */
export function boxUnion(boxes) {
  if (!boxes || boxes.length === 0) return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of boxes) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

export function boxGrow(b, by) {
  return { minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by };
}

/** 4 corners then centre: (minX,minY),(minX,maxY),(maxX,minY),(maxX,maxY),centre. */
export function boxPoints(b) {
  return [
    { x: b.minX, y: b.minY },
    { x: b.minX, y: b.maxY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    boxCenter(b),
  ];
}

const ng25Sides = {
  top: { axis: "y", sign: -1 },
  right: { axis: "x", sign: 1 },
  bottom: { axis: "y", sign: 1 },
  left: { axis: "x", sign: -1 },
};

/** Midpoint of a "top"|"right"|"bottom"|"left" side; undefined otherwise. */
export function sideMidpoint(b, side) {
  const s = ng25Sides[side];
  if (!s) return undefined;
  if (side === "top") return { x: (b.minX + b.maxX) / 2, y: b.minY };
  if (side === "bottom") return { x: (b.minX + b.maxX) / 2, y: b.maxY };
  if (side === "left") return { x: b.minX, y: (b.minY + b.maxY) / 2 };
  return { x: b.maxX, y: (b.minY + b.maxY) / 2 };
}

/** `p` moved `by` px out of a side; undefined for unknown side names. */
export function pushOut(side, p, by) {
  const s = ng25Sides[side];
  if (!s) return undefined;
  const out = { x: p.x, y: p.y };
  out[s.axis] += s.sign * by;
  return out;
}

/** Distinct corner/center points of many boxes, sorted x-then-y. */
export function sortedBoxPoints(boxes) {
  const seen = new Set();
  const pts = [];
  for (const b of boxes) {
    for (const p of boxPoints(b)) {
      const k = p.x + "," + p.y;
      if (!seen.has(k)) { seen.add(k); pts.push(p); }
    }
  }
  pts.sort((a, b) => (a.x - b.x) || (a.y - b.y));
  return pts;
}

/** Cubic bezier edge between two points leaving/entering through box sides. */
export function bezierEdge(from, fromSide, to, toSide) {
  const d = distance(from, to);
  const reach = Math.min(150, Math.max(70, d / 2));
  const cp1 = pushOut(fromSide, from, reach);
  const cp2 = pushOut(toSide, to, reach);
  const path = `M${from.x},${from.y} C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${to.x},${to.y}`;
  return { from, to, cp1, cp2, path };
}

/** In-place sort by numeric key ascending. */
export function sortByKey(list, key) {
  list.sort((a, b) => key(a) - key(b));
  return list;
}

/** In-place sort by match.score descending. */
export function sortHitsByScore(hits) {
  hits.sort((a, b) => b.match.score - a.match.score);
  return hits;
}

/** Add `by` to every [from,to] pair in place. */
export function shiftRanges(ranges, by) {
  for (const r of ranges) { r[0] += by; r[1] += by; }
  return ranges;
}

/** True when `value` parses as an absolute URL. */
export function isUrl(value) {
  if (!value) return false;
  try { new URL(value); return true; } catch { return false; }
}

/**
 * Clipboard copy: the async clipboard API when available, else a hidden
 * textarea + execCommand("copy"). Failures are silent.
 */
export function copyText(text) {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.permissions) {
      navigator.clipboard.writeText(text);
      return;
    }
    const doc = typeof activeDocument !== "undefined" && activeDocument ? activeDocument : document;
    const ta = doc.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    doc.body.appendChild(ta);
    ta.select();
    doc.execCommand("copy");
    ta.remove();
  } catch { /* silent */ }
}

/** Run `callback` now when `el` is shown, else on its next insertion. */
export function focusWhenShown(el, callback) {
  if (el.isShown && el.isShown()) callback();
  else el.onNodeInserted(callback, true);
}

/** Shared locale-aware string collator. */
export const stringCollator = new Intl.Collator(undefined, { usage: "sort", sensitivity: "base", numeric: true });
