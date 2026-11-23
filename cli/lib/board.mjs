// Headless .board files: JSON envelope + a Yjs document (the same one the app keeps). Every write goes through Yjs so the app can load it back.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { CliError, EXIT, usage, notFound } from "./util.mjs";

// ---------------- Yjs (the bundle the app ships, loaded in a sandbox; nothing is installed) ----------------
let _Y = null;
export function loadY() {
  if (_Y) return _Y;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cands = [process.env.BASALT_YJS, path.join(here, "../vendor/yjs-bundle.js"), path.join(here, "../../src/lib/yjs-bundle.js")].filter(Boolean);
  const file = cands.find((c) => fs.existsSync(c));
  if (!file) throw new CliError("Yjs bundle not found (expected cli/vendor/yjs-bundle.js)", EXIT.ERROR);
  const win = {};
  win.window = win; win.self = win;
  const ctx = vm.createContext({ window: win, self: win, console: { log() {}, warn() {}, error() {}, info() {}, debug() {} }, navigator: { userAgent: "node" }, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder, crypto: globalThis.crypto, performance, queueMicrotask, atob, btoa, Buffer, URL, structuredClone });
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  if (!win.__bsY || !win.__bsY.Y) throw new CliError("Yjs bundle did not expose Y", EXIT.ERROR);
  return (_Y = win.__bsY.Y);
}

export const COLORS = { red: "#e5484d", orange: "#f59f3b", yellow: "#d6b43c", green: "#46a758", blue: "#3fa7d6", purple: "#8e6bd8", none: "" };
export const colorOf = (c) => (c == null ? "" : COLORS[String(c).toLowerCase()] ?? (/^#[0-9a-f]{6}$/i.test(c) ? String(c).toLowerCase() : (() => { throw usage(`unknown colour "${c}" (red, orange, yellow, green, blue, purple, none or #rrggbb)`); })()));
const uid = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");
const b64 = (u8) => Buffer.from(u8.buffer, u8.byteOffset, u8.length).toString("base64");
const unb64 = (s) => { const b = Buffer.from(s, "base64"); return new Uint8Array(b.buffer, b.byteOffset, b.length); };
const NODE_KEYS = ["x", "y", "w", "h", "color", "kind", "frame", "group", "img", "fold", "locked", "by"];
const EDGE_KEYS = ["a", "b", "label", "sa", "sb", "sh", "ls", "ad", "ec"];
export const title = (text) => { const l = String(text || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean) || ""; return l.replace(/^[#>*\-\s]+/, "").replace(/[*_`]/g, "").slice(0, 80) || "(empty)"; };

export class Board {
  constructor(doc, env = {}) {
    const Y = loadY();
    this.Y = Y; this.doc = doc; this.yn = doc.getMap("nodes"); this.ye = doc.getMap("edges"); this.ym = doc.getMap("meta"); this.yi = doc.getArray("ink");
    this.room = env.room ?? null;
    if (!this.ym.get("id")) this.ym.set("id", uid() + uid());
  }
  static create() { return new Board(new (loadY().Doc)()); }
  /** Parse the file text. Old files without a ydoc are rebuilt from their plain `nodes`/`edges`. */
  static parse(text, name = "board") {
    const Y = loadY(); let j;
    try { j = JSON.parse(text); } catch { throw new CliError(`${name} is not a board file (bad JSON)`, EXIT.ERROR); }
    if (!j || typeof j !== "object") throw new CliError(`${name} is not a board file`, EXIT.ERROR);
    const doc = new Y.Doc();
    if (j.ydoc) { try { Y.applyUpdate(doc, unb64(j.ydoc)); } catch (e) { throw new CliError(`${name}: damaged ydoc (${e.message})`, EXIT.ERROR); } }
    const b = new Board(doc, { room: j.room });
    if (!j.ydoc && j.nodes && typeof j.nodes === "object") {
      doc.transact(() => {
        for (const [id, n] of Object.entries(j.nodes)) b.addCard({ id, x: n.x, y: n.y, w: n.w, h: n.h, color: n.color, text: n.text });
        for (const [id, e] of Object.entries(j.edges || {})) b.addEdge(e.a, e.b, { label: e.label, id });
      });
    }
    return b;
  }
  static load(file) { if (!fs.existsSync(file)) throw notFound(`board not found: ${file}`); return Board.parse(fs.readFileSync(file, "utf8"), file); }

  /** File text in exactly the shape the app writes */
  toText() {
    const Y = this.Y, nodes = {};
    this.yn.forEach((m, id) => { nodes[id] = { x: m.get("x"), y: m.get("y"), w: m.get("w"), h: m.get("h"), color: m.get("color") || "", text: m.get("text") ? m.get("text").toString() : "" }; });
    const out = { v: 2, id: this.ym.get("id"), room: this.ym.get("room") || this.room || null, nodes, edges: this.ye.toJSON(), ydoc: "@@YDOC@@" };
    const y64 = b64(Y.encodeStateAsUpdate(this.doc));
    return (this.yn.size > 600 ? JSON.stringify(out) : JSON.stringify(out, null, 1)).replace('"@@YDOC@@"', () => '"' + y64 + '"');
  }
  save(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + ".basalt-tmp-" + process.pid; fs.writeFileSync(tmp, this.toText()); fs.renameSync(tmp, file); }

  // ---------- reading ----------
  cards() {
    const out = [];
    this.yn.forEach((m, id) => { const c = { id, text: m.get("text") ? m.get("text").toString() : "" }; for (const k of NODE_KEYS) { const v = m.get(k); if (v !== undefined && v !== null && v !== "" && v !== false) c[k] = v; } c.x ??= 0; c.y ??= 0; c.w ??= 260; c.h ??= 110; out.push(c); });
    return out;
  }
  links() { const out = []; this.ye.forEach((m, id) => { const e = { id }; for (const k of EDGE_KEYS) { const v = m.get(k); if (v !== undefined && v !== null && v !== "") e[k] = v; } out.push(e); }); return out; }
  ink() { return this.yi.toArray(); }
  /** accepts a full id or a unique prefix */
  id(input) {
    if (this.yn.has(input)) return input;
    const hits = [...this.yn.keys()].filter((k) => k.startsWith(input));
    if (hits.length === 1) return hits[0];
    if (!hits.length) throw notFound(`no card "${input}"`);
    throw usage(`card id "${input}" is ambiguous (${hits.slice(0, 4).join(", ")}...)`);
  }
  linkId(input) {
    if (this.ye.has(input)) return input;
    const hits = [...this.ye.keys()].filter((k) => k.startsWith(input));
    if (hits.length === 1) return hits[0];
    throw hits.length ? usage(`link id "${input}" is ambiguous`) : notFound(`no link "${input}"`);
  }

  // ---------- writing ----------
  bounds() {
    const cs = this.cards(); if (!cs.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const c of cs) { x1 = Math.min(x1, c.x); y1 = Math.min(y1, c.y); x2 = Math.max(x2, c.x + c.w); y2 = Math.max(y2, c.y + c.h); }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, right: x2, bottom: y2 };
  }
  setText(map, text) { // minimal edit so concurrent edits in the app still merge
    let t = map.get("text"); const Y = this.Y;
    if (!t) { t = new Y.Text(); t.insert(0, text); map.set("text", t); return; }
    const old = t.toString(); if (old === text) return;
    let a = 0; while (a < old.length && a < text.length && old[a] === text[a]) a++;
    let b = 0; while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) b++;
    if (old.length - a - b > 0) t.delete(a, old.length - a - b);
    if (text.length - a - b > 0) t.insert(a, text.slice(a, text.length - b));
  }
  stamp(m, by) { m.set("lastBy", by); m.set("lastAt", Date.now()); m.set("lastColor", "#8e8e8e"); }
  addCard(o = {}, by = "cli") {
    const Y = this.Y, id = o.id || uid(), m = new Y.Map();
    let { x, y } = o;
    if (x == null || y == null) { const bb = this.bounds(); x = bb ? bb.right + 60 : 0; y = bb ? bb.y : 0; }
    m.set("x", Math.round(x)); m.set("y", Math.round(y)); m.set("w", Math.round(o.w || 260)); m.set("h", Math.round(o.h || 110)); m.set("color", colorOf(o.color)); m.set("by", by);
    for (const k of ["kind", "img", "frame", "group"]) if (o[k]) m.set(k, o[k]);
    if (o.fold) m.set("fold", true); if (o.locked) m.set("locked", true);
    this.stamp(m, by);
    const t = new Y.Text(); t.insert(0, String(o.text ?? "")); m.set("text", t);
    this.yn.set(id, m); return id;
  }
  editCard(id, patch, by = "cli") {
    const m = this.yn.get(id); if (!m) throw notFound(`no card "${id}"`);
    this.doc.transact(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if (k === "text") this.setText(m, String(v));
        else if (k === "color") m.set("color", colorOf(v));
        else if (["x", "y", "w", "h"].includes(k)) m.set(k, Math.round(Number(v)));
        else if (k === "fold" || k === "locked") { if (v) m.set(k, true); else m.delete(k); }
        else if (v === "" || v === null) m.delete(k); else m.set(k, v);
      }
      this.stamp(m, by);
    });
  }
  deleteCard(id) {
    if (!this.yn.has(id)) throw notFound(`no card "${id}"`);
    let removed = 0;
    this.doc.transact(() => { for (const [eid, m] of [...this.ye.entries()]) if (m.get("a") === id || m.get("b") === id) { this.ye.delete(eid); removed++; } this.yn.delete(id); });
    return removed;
  }
  addEdge(a, b, o = {}) {
    if (!this.yn.has(a)) throw notFound(`no card "${a}"`); if (!this.yn.has(b)) throw notFound(`no card "${b}"`);
    const m = new this.Y.Map(), id = o.id || uid(); m.set("a", a); m.set("b", b); m.set("label", o.label || "");
    for (const k of ["sa", "sb", "sh", "ls", "ad", "ec"]) if (o[k]) m.set(k, o[k]);
    this.ye.set(id, m); return id;
  }
  deleteEdge(id) { if (!this.ye.has(id)) throw notFound(`no link "${id}"`); this.ye.delete(id); }
  /** replace every card and link with a snapshot ({nodes:[{id,...}], edges:[{a,b,label}], ink}) as the app does on "restore" */
  restore(d) {
    this.doc.transact(() => {
      for (const k of [...this.yn.keys()]) this.yn.delete(k); for (const k of [...this.ye.keys()]) this.ye.delete(k);
      if (this.yi.length) this.yi.delete(0, this.yi.length);
      for (const n of d.nodes || []) this.addCard(n);
      for (const e of d.edges || []) if (this.yn.has(e.a) && this.yn.has(e.b)) this.addEdge(e.a, e.b, e);
      if (d.ink && d.ink.length) this.yi.push(d.ink);
    });
  }
  /** merge another board into this one through the CRDT (same lineage merges cleanly, unrelated boards are unioned) */
  merge(other) { this.Y.applyUpdate(this.doc, this.Y.encodeStateAsUpdate(other.doc)); }
}

/** Rewrite the text of every card through fn(text)->text; returns the new file text (or the same one if nothing changed). */
export async function rewriteBoardText(text, fn) {
  const b = Board.parse(text); let changed = false;
  b.doc.transact(() => { b.yn.forEach((m) => { const t = m.get("text"); if (!t) return; const old = t.toString(), nw = fn(old); if (nw !== old) { b.setText(m, nw); changed = true; } }); });
  return changed ? b.toText() : text;
}

// ---------------- layouts (pure: take cards+links, give positions) ----------------
const byReading = (a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1);
export function layoutGrid(cards, { gap = 40, cols } = {}) {
  const list = [...cards].sort(byReading), n = list.length, c = cols || Math.max(1, Math.ceil(Math.sqrt(n)));
  const cw = Math.max(...list.map((k) => k.w)), ch = Math.max(...list.map((k) => k.h));
  const x0 = Math.min(...list.map((k) => k.x)), y0 = Math.min(...list.map((k) => k.y)), out = new Map();
  list.forEach((k, i) => out.set(k.id, { x: x0 + (i % c) * (cw + gap), y: y0 + Math.floor(i / c) * (ch + gap) }));
  return out;
}
export function layoutTree(cards, links, { dir = "lr", root, gapX = 90, gapY = 40 } = {}) {
  const by = new Map(cards.map((c) => [c.id, c])), kids = new Map(cards.map((c) => [c.id, []])), und = new Map(cards.map((c) => [c.id, []])), indeg = new Map(cards.map((c) => [c.id, 0]));
  for (const e of links) if (by.has(e.a) && by.has(e.b) && e.a !== e.b) { kids.get(e.a).push(e.b); und.get(e.a).push(e.b); und.get(e.b).push(e.a); indeg.set(e.b, indeg.get(e.b) + 1); }
  const order = [...cards].sort(byReading).map((c) => c.id);
  const roots = root ? [root] : order.filter((id) => indeg.get(id) === 0);
  const seen = new Set(), depth = new Map(), tree = new Map(order.map((id) => [id, []])), tops = [];
  const grow = (r) => { // BFS spanning tree from r, following directed links first
    const q = [r]; seen.add(r); depth.set(r, 0);
    while (q.length) { const u = q.shift(); for (const v of [...kids.get(u), ...und.get(u)]) if (!seen.has(v)) { seen.add(v); depth.set(v, depth.get(u) + 1); tree.get(u).push(v); q.push(v); } }
  };
  for (const r of [...roots, ...order]) if (!seen.has(r)) { tops.push(r); grow(r); }
  const horiz = dir !== "td"; // lr: depth runs along x
  const colSize = new Map(); for (const c of cards) { const d = depth.get(c.id); colSize.set(d, Math.max(colSize.get(d) || 0, horiz ? c.w : c.h)); }
  const colStart = new Map(); let acc = 0; for (const d of [...colSize.keys()].sort((a, b) => a - b)) { colStart.set(d, acc); acc += colSize.get(d) + (horiz ? gapX : gapY * 2); }
  const out = new Map(); let slot = 0;
  const place = (id) => {
    const c = by.get(id), ch = tree.get(id); let mid;
    if (!ch.length) { mid = slot; slot += (horiz ? c.h : c.w) + (horiz ? gapY : gapX); mid += (horiz ? c.h : c.w) / 2; }
    else { const ms = ch.map(place); mid = (ms[0] + ms[ms.length - 1]) / 2; }
    const d = colStart.get(depth.get(id)), cross = mid - (horiz ? c.h : c.w) / 2;
    out.set(id, horiz ? { x: d, y: cross } : { x: cross, y: d });
    return mid;
  };
  for (const t of tops) place(t);
  const x0 = Math.min(...cards.map((c) => c.x)), y0 = Math.min(...cards.map((c) => c.y));
  for (const p of out.values()) { p.x = Math.round(p.x + x0); p.y = Math.round(p.y + y0); }
  return out;
}
export function layoutForce(cards, links, { iterations, gap = 40 } = {}) {
  const n = cards.length, list = [...cards].sort((a, b) => (a.id < b.id ? -1 : 1)), idx = new Map(list.map((c, i) => [c.id, i]));
  const avgW = list.reduce((s, c) => s + c.w, 0) / n + gap, avgH = list.reduce((s, c) => s + c.h, 0) / n + gap;
  const k = Math.sqrt(avgW * avgH) * 1.6, iters = iterations || (n > 1000 ? 40 : n > 300 ? 100 : 250);
  const px = new Float64Array(n), py = new Float64Array(n), R = k * Math.sqrt(n) / 2;
  list.forEach((c, i) => { const a = (i / n) * Math.PI * 2; px[i] = Math.cos(a) * R; py[i] = Math.sin(a) * R; });
  const es = links.filter((e) => idx.has(e.a) && idx.has(e.b) && e.a !== e.b).map((e) => [idx.get(e.a), idx.get(e.b)]);
  const dx = new Float64Array(n), dy = new Float64Array(n);
  for (let it = 0; it < iters; it++) {
    const temp = (k * 2) * (1 - it / iters) + 1; dx.fill(0); dy.fill(0);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let ddx = px[i] - px[j], ddy = py[i] - py[j], d2 = ddx * ddx + ddy * ddy; if (d2 < 0.01) { ddx = (i - j) * 0.1; ddy = 0.1; d2 = ddx * ddx + ddy * ddy; }
      const d = Math.sqrt(d2), f = (k * k) / d / d; dx[i] += ddx * f; dy[i] += ddy * f; dx[j] -= ddx * f; dy[j] -= ddy * f;
    }
    for (const [a, b] of es) { const ddx = px[a] - px[b], ddy = py[a] - py[b], d = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01, f = d / k; dx[a] -= ddx * f; dy[a] -= ddy * f; dx[b] += ddx * f; dy[b] += ddy * f; }
    for (let i = 0; i < n; i++) { const d = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 0.01, s = Math.min(d, temp) / d; px[i] += dx[i] * s; py[i] += dy[i] * s; }
  }
  for (let pass = 0; pass < 30 && n <= 1500; pass++) { // push overlapping cards apart
    let moved = false;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = list[i], b = list[j], ox = (a.w + b.w) / 2 + gap / 2 - Math.abs(px[i] - px[j]), oy = (a.h + b.h) / 2 + gap / 2 - Math.abs(py[i] - py[j]);
      if (ox > 0 && oy > 0) { moved = true; if (ox < oy) { const s = px[i] >= px[j] ? 1 : -1; px[i] += s * ox / 2; px[j] -= s * ox / 2; } else { const s = py[i] >= py[j] ? 1 : -1; py[i] += s * oy / 2; py[j] -= s * oy / 2; } }
    }
    if (!moved) break;
  }
  const x0 = Math.min(...cards.map((c) => c.x)), y0 = Math.min(...cards.map((c) => c.y)), mx = Math.min(...list.map((c, i) => px[i] - c.w / 2)), my = Math.min(...list.map((c, i) => py[i] - c.h / 2));
  return new Map(list.map((c, i) => [c.id, { x: Math.round(px[i] - c.w / 2 - mx + x0), y: Math.round(py[i] - c.h / 2 - my + y0) }]));
}
export function applyLayout(board, mode, opts = {}) {
  const cards = board.cards().filter((c) => !c.locked && !c.group); if (cards.length < 2) return 0;
  const links = board.links();
  const pos = mode === "grid" ? layoutGrid(cards, opts) : mode === "tree" ? layoutTree(cards, links, opts) : mode === "force" ? layoutForce(cards, links, opts) : (() => { throw usage(`unknown layout "${mode}" (grid, tree, force)`); })();
  board.doc.transact(() => { for (const [id, p] of pos) { const m = board.yn.get(id); m.set("x", p.x); m.set("y", p.y); } });
  return pos.size;
}

// ---------------- CSV ----------------
export function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
    if (ch === '"') q = true; else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((v) => v !== "")) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); if (row.some((v) => v !== "")) rows.push(row);
  return rows;
}
export const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

// ---------------- import ----------------
/** Cards from CSV rows: columns id,text|title,body,x,y,w,h,color,kind (header row required; unknown columns become "name: value" lines). */
export function cardsFromCsv(text) {
  const rows = parseCsv(text); if (rows.length < 2) throw usage("CSV needs a header row and at least one data row");
  const head = rows[0].map((h) => h.trim().toLowerCase()), known = new Set(["id", "text", "title", "body", "x", "y", "w", "h", "width", "height", "color", "kind"]);
  const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));
  return rows.slice(1).map((r) => {
    const g = (k) => { const i = head.indexOf(k); return i >= 0 ? r[i] : undefined; };
    let t = g("text") ?? ""; const ti = g("title"), bo = g("body");
    if (ti) t = ti + (bo ? "\n\n" + bo : t ? "\n\n" + t : ""); else if (bo && !t) t = bo;
    const extra = head.map((h, i) => (known.has(h) || !h || r[i] === undefined || r[i] === "" ? null : `${rows[0][i].trim()}: ${r[i]}`)).filter(Boolean);
    if (extra.length) t += (t ? "\n\n" : "") + extra.join("\n");
    return { id: g("id") || undefined, text: t, x: num(g("x")), y: num(g("y")), w: num(g("w") ?? g("width")), h: num(g("h") ?? g("height")), color: g("color") || "", kind: g("kind") || "" };
  });
}
/** Links from "from,to[,label]" rows; from/to match a card id or its title/text. */
export function linksFromCsv(text, board) {
  const rows = parseCsv(text), out = []; const cards = board.cards();
  const find = (s) => {
    s = s.trim(); if (board.yn.has(s)) return s;
    const t = cards.find((c) => c.text.trim() === s) || cards.find((c) => title(c.text).toLowerCase() === s.toLowerCase());
    return t ? t.id : null;
  };
  rows.forEach((r, i) => { if (i === 0 && /^(from|source|a)$/i.test(r[0].trim())) return; const a = find(r[0] || ""), b = find(r[1] || ""); if (!a || !b) throw usage(`links file, row ${i + 1}: cannot find card "${!a ? r[0] : r[1]}"`); out.push({ a, b, label: r[2] || "" }); });
  return out;
}
/** Import from the JSON shape `board export --format json` writes ({cards|nodes, links|edges}); returns the ids created. */
export function importJson(board, data, { keepIds = false } = {}) {
  const cs = data.cards || data.nodes || [], es = data.links || data.edges || [], map = new Map(), made = [];
  board.doc.transact(() => {
    for (const c of Array.isArray(cs) ? cs : Object.entries(cs).map(([id, v]) => ({ id, ...v }))) {
      const id = board.addCard({ ...c, id: keepIds && c.id && !board.yn.has(c.id) ? c.id : undefined }); map.set(String(c.id ?? id), id); made.push(id);
    }
    for (const e of Array.isArray(es) ? es : Object.values(es)) { const a = map.get(String(e.a ?? e.from)), b = map.get(String(e.b ?? e.to)); if (a && b) board.addEdge(a, b, e); }
    if (Array.isArray(data.ink)) board.yi.push(data.ink);
  });
  return made;
}
/** .canvas (JSON Canvas) -> cards and links; images are inlined through readFile(path)->Buffer|null */
export function canvasToData(j, readFile) {
  const CM = { 1: "#e5484d", 2: "#f59f3b", 3: "#d6b43c", 4: "#46a758", 5: "#3fa7d6", 6: "#8e6bd8" }, SD = { top: "t", right: "r", bottom: "b", left: "l" }, nodes = [], edges = [];
  for (const n of j.nodes || []) {
    const file = String(n.file || ""), ext = file.split(".").pop().toLowerCase(), isImg = /^(png|jpe?g|gif|webp|bmp|avif)$/.test(ext);
    const c = { id: String(n.id), x: n.x || 0, y: n.y || 0, w: n.width || 260, h: n.height || 110, color: CM[n.color] || (/^#[0-9a-f]{6}$/i.test(n.color || "") ? n.color : ""), text: "" };
    if (n.type === "file") {
      const nm = file.replace(/^.*\//, "").replace(/\.[^.]+$/, ""); c.text = isImg ? nm : "[[" + nm + "]]";
      if (isImg && readFile) { const buf = readFile(file); if (buf && buf.length < 3e6) c.img = `data:image/${ext === "jpg" ? "jpeg" : ext};base64,` + buf.toString("base64"); }
    } else if (n.type === "link") c.text = n.url || ""; else if (n.type === "group") { c.text = n.label || ""; c.kind = "Группа"; } else c.text = n.text || "";
    nodes.push(c);
  }
  for (const e of j.edges || []) if (e.fromNode && e.toNode) edges.push({ a: String(e.fromNode), b: String(e.toNode), label: e.label || "", sa: SD[e.fromSide] || "", sb: SD[e.toSide] || "" });
  return { cards: nodes, links: edges };
}

// ---------------- export ----------------
const esc = (s) => String(s).replace(/"/g, "#quot;").replace(/\r?\n/g, " ");
export function exportBoard(board, format, o = {}) {
  const cards = board.cards().sort(byReading), links = board.links(), nm = o.name || "board", by = new Map(cards.map((c) => [c.id, c]));
  const T = (id) => (by.has(id) ? title(by.get(id).text) : id);
  switch (format) {
    case "json": return JSON.stringify({ id: board.ym.get("id"), name: nm, cards: cards.map((c) => { const { img, ...r } = c; return o.images ? c : img ? { ...r, hasImage: true } : r; }), links, ink: o.ink ? board.ink() : undefined }, null, 2) + "\n";
    case "markdown": {
      const L = [`# ${nm}`, ""];
      for (const c of cards) { const lines = c.text.split(/\r?\n/); L.push(`## ${title(c.text)}`, ""); const rest = (/^[#>*\-\s]/.test(lines[0] || "") ? lines : lines.slice(1)).join("\n").trim(); if (rest) L.push(rest, ""); const meta = [c.kind && `kind: ${c.kind}`, c.color && `color: ${c.color}`].filter(Boolean); if (meta.length) L.push(`<!-- ${c.id} ${meta.join(", ")} -->`, ""); }
      if (links.length) { L.push("## Links", ""); for (const e of links) L.push(`- ${T(e.a)} -> ${T(e.b)}${e.label ? ` (${e.label})` : ""}`); L.push(""); }
      return L.join("\n");
    }
    case "csv": return o.edges ? toCsv([["id", "from", "to", "label"], ...links.map((e) => [e.id, e.a, e.b, e.label || ""])]) : toCsv([["id", "x", "y", "w", "h", "color", "kind", "text"], ...cards.map((c) => [c.id, c.x, c.y, c.w, c.h, c.color || "", c.kind || "", c.text])]);
    case "mermaid": {
      const L = ["graph LR"]; for (const c of cards) L.push(`  n_${c.id}["${esc(title(c.text))}"]`);
      for (const e of links) if (by.has(e.a) && by.has(e.b)) L.push(`  n_${e.a} -->${e.label ? `|${esc(e.label)}|` : ""} n_${e.b}`);
      return L.join("\n") + "\n";
    }
    case "dot": {
      const L = ["digraph board {", "  rankdir=LR;", "  node [shape=box, style=filled, fillcolor=white];"];
      for (const c of cards) L.push(`  "${c.id}" [label="${esc(title(c.text)).replace(/#quot;/g, '\\"')}"${c.color ? `, fillcolor="${c.color}"` : ""}];`);
      for (const e of links) if (by.has(e.a) && by.has(e.b)) L.push(`  "${e.a}" -> "${e.b}"${e.label ? ` [label="${esc(e.label).replace(/#quot;/g, '\\"')}"]` : ""};`);
      return L.join("\n") + "\n}\n";
    }
    case "svg": {
      const bb = board.bounds() || { x: 0, y: 0, w: 100, h: 100 }, p = 40, x = (v) => v - bb.x + p, y = (v) => v - bb.y + p, X = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
      const L = [`<svg xmlns="http://www.w3.org/2000/svg" width="${bb.w + p * 2}" height="${bb.h + p * 2}" font-family="sans-serif" font-size="14"><rect width="100%" height="100%" fill="#1b1713"/>`];
      for (const e of links) { const a = by.get(e.a), b = by.get(e.b); if (a && b) L.push(`<line x1="${x(a.x + a.w / 2)}" y1="${y(a.y + a.h / 2)}" x2="${x(b.x + b.w / 2)}" y2="${y(b.y + b.h / 2)}" stroke="#999" stroke-width="2"/>`); }
      for (const c of cards) L.push(`<rect x="${x(c.x)}" y="${y(c.y)}" width="${c.w}" height="${c.h}" rx="8" fill="${c.color || "#eae1d2"}" fill-opacity=".85"/><text x="${x(c.x) + 10}" y="${y(c.y) + 24}" fill="#111">${X(title(c.text))}</text>`);
      return L.join("\n") + "\n</svg>\n";
    }
    default: throw usage(`unknown format "${format}" (json, markdown, csv, mermaid, dot, svg, png-data-only)`);
  }
}
/** `png-data-only`: write the pictures embedded in cards (data: URIs) to a folder. Returns the written file names. */
export function exportImages(board, dir) {
  fs.mkdirSync(dir, { recursive: true }); const out = [];
  for (const c of board.cards()) {
    const m = /^data:image\/([a-z0-9.+-]+);base64,(.*)$/s.exec(c.img || ""); if (!m) continue;
    const ext = m[1] === "jpeg" ? "jpg" : m[1] === "svg+xml" ? "svg" : m[1], f = path.join(dir, `${c.id}.${ext}`);
    fs.writeFileSync(f, Buffer.from(m[2], "base64")); out.push(f);
  }
  return out;
}

// ---------------- diff and history ----------------
const norm = (cards, links) => ({
  nodes: new Map(cards.map((c) => [c.id, { x: c.x, y: c.y, w: c.w, h: c.h, color: c.color || "", text: c.text || "", kind: c.kind || "", fold: !!c.fold, locked: !!c.locked, img: c.img ? "(image)" : "" }])),
  edges: links.map((e) => ({ a: e.a, b: e.b, label: e.label || "" })),
});
export const normBoard = (b) => norm(b.cards(), b.links());
export const normSnapshot = (d) => norm((d.nodes || []).map((n) => ({ ...n })), d.edges || []);
export function diffBoards(A, B) {
  const added = [], removed = [], changed = [];
  for (const [id, n] of B.nodes) if (!A.nodes.has(id)) added.push({ id, title: title(n.text) });
  for (const [id, n] of A.nodes) {
    const m = B.nodes.get(id); if (!m) { removed.push({ id, title: title(n.text) }); continue; }
    const f = {}; for (const k of Object.keys(n)) if (n[k] !== m[k]) f[k] = [n[k], m[k]];
    if (Object.keys(f).length) changed.push({ id, title: title(m.text), fields: f });
  }
  const key = (e) => `${e.a}\u0000${e.b}\u0000${e.label}`, ka = new Set(A.edges.map(key)), kb = new Set(B.edges.map(key));
  const linksAdded = B.edges.filter((e) => !ka.has(key(e))), linksRemoved = A.edges.filter((e) => !kb.has(key(e)));
  return { same: !added.length && !removed.length && !changed.length && !linksAdded.length && !linksRemoved.length, cards: { added, removed, changed }, links: { added: linksAdded, removed: linksRemoved } };
}

export const historyDir = (root, boardPath) => path.join(root, ".basalt-history", boardPath.replace(/[\\/]/g, "__"));
export function listHistory(root, boardPath) {
  const dir = historyDir(root, boardPath); if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).sort().map((f, i, all) => {
    const t = Number(f.slice(0, -5)); let cards = null, links = null;
    try { const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); cards = d.nodes.length; links = d.edges.length; } catch { /* damaged snapshot */ }
    return { id: String(t), index: i - all.length, time: new Date(t).toISOString(), cards, links, size: fs.statSync(path.join(dir, f)).size };
  });
}
/** "123456789" (id), "-1"/"latest", or an index */
export function readSnapshot(root, boardPath, ref) {
  const list = listHistory(root, boardPath); if (!list.length) throw notFound(`no history for ${boardPath}`);
  let item = ref === "latest" || ref == null ? list[list.length - 1] : list.find((s) => s.id === String(ref)) || (/^-\d+$/.test(String(ref)) ? list[list.length + Number(ref)] : null);
  if (!item) throw notFound(`no snapshot "${ref}" (see: basalt board history list)`);
  return { ...item, data: JSON.parse(fs.readFileSync(path.join(historyDir(root, boardPath), item.id + ".json"), "utf8")) };
}
export function writeSnapshot(root, boardPath, board, keep = 40) {
  const dir = historyDir(root, boardPath); fs.mkdirSync(dir, { recursive: true });
  let t = Date.now(); while (fs.existsSync(path.join(dir, t + ".json"))) t++;
  const nodes = board.cards().map((c) => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h, color: c.color || "", text: c.text, img: c.img || "", fold: !!c.fold, locked: !!c.locked }));
  const edges = board.links().map((e) => ({ a: e.a, b: e.b, label: e.label || "" }));
  fs.writeFileSync(path.join(dir, t + ".json"), JSON.stringify({ v: 1, t, nodes, edges, ink: board.ink() }));
  const all = fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(dir, f), { force: true });
  return String(t);
}
