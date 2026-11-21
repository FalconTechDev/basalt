// g22 clean-room: shared collections and task queues for the metadata index.
// Own architecture: small purpose-built classes behind the frozen export names.

import { inherit } from "./inherit.js";

// ---------------------------------------------------------------- Deque ----

/** Double-ended queue over a plain array; `get()` exposes the live backing array. */
export class Deque {
  constructor() { this._items = []; }
  get length() { return this._items.length; }
  get() { return this._items; }
  isEmpty() { return this._items.length === 0; }
  enqueue(item) { this._items.push(item); }
  enqueueArray(items) { for (const item of items) this._items.push(item); }
  remove(item) {
    const i = this._items.indexOf(item);
    if (i >= 0) this._items.splice(i, 1);
  }
  clear() { this._items.length = 0; }
  dequeue() { return this._items.shift(); }
  peek() { return this._items.length ? this._items[0] : undefined; }
}

// --------------------------------------------------------- RefMultimap ----

/** key -> ordered-unique value list. `get` returns null for absent keys. */
export class RefMultimap {
  constructor() { this._map = new Map(); }
  _list(key, create) {
    let list = this._map.get(key);
    if (!list && create) { list = []; this._map.set(key, list); }
    return list;
  }
  add(key, value) {
    const list = this._list(key, true);
    if (!list.includes(value)) list.push(value);
  }
  remove(key, value) {
    const list = this._list(key, false);
    if (!list) return;
    const i = list.indexOf(value);
    if (i >= 0) list.splice(i, 1);
    if (list.length === 0) this._map.delete(key);
  }
  get(key) { return this._map.get(key) || null; }
  keys() { return this._map.keys(); }
  clear(key) { this._map.delete(key); }
  clearAll() { this._map.clear(); }
  contains(key, value) {
    const list = this._map.get(key);
    return !!list && list.includes(value);
  }
  count(key) {
    const list = this._map.get(key);
    return list ? list.length : 0;
  }
}

// ----------------------------------------------------- SerialTaskQueue ----

/** Runs promise-returning tasks strictly one after another. */
export class SerialTaskQueue {
  constructor() { this._tail = Promise.resolve(); }
  queue(task) {
    const run = this._tail.then(() => task());
    this._tail = run.then(() => undefined, () => undefined);
    return run;
  }
}

// ------------------------------------------------------------- Runnable ----

/** Lifecycle object with start/stop/cancel hooks (options.onStart/onStop/onCancel). */
export class Runnable {
  constructor(options = {}) {
    this.options = options;
    this._running = false;
    this._cancelled = false;
  }
  start() {
    if (this._cancelled || this._running) return;
    this._running = true;
    if (this.options.onStart) this.options.onStart();
  }
  stop() {
    if (!this._running) return;
    this._running = false;
    if (this.options.onStop) this.options.onStop();
  }
  cancel() {
    this._cancelled = true;
    this.stop();
    if (this.options.onCancel) this.options.onCancel();
  }
  isRunning() { return this._running; }
  isCancelled() { return this._cancelled; }
}

// ------------------------------------------------------------ LinkQueue ----

/** Async-iterable work queue: items are dequeued one at a time while the runnable runs. */
export class LinkQueue {
  constructor(options = {}) {
    this.options = options;
    this.items = new Deque();
    this._waiters = [];
    this.runnable = new Runnable({
      onStart: () => { this._pump(); },
      onStop: () => { this._stopped = true; },
      onCancel: () => { this._stopped = true; this._wakeAll(); },
    });
    this._stopped = false;
  }
  add(item) { this.items.enqueue(item); this.notify(); }
  addList(list) { this.items.enqueueArray(list); this.notify(); }
  remove(item) { this.items.remove(item); }
  clear() { this.items.clear(); this._wakeAll(); }
  notify() { this._wakeAll(); }
  cancel() { this.runnable.cancel(); }
  _wakeAll() {
    const waiters = this._waiters;
    this._waiters = [];
    for (const wake of waiters) wake();
  }
  _pump() {
    if (!this._pumping) {
      this._pumping = true;
      (async () => {
        try {
          for await (const item of this.generator()) {
            if (this.options.onProcess) await this.options.onProcess(item);
          }
        } finally { this._pumping = false; }
      })();
    }
  }
  async *generator() {
    while (true) {
      if (this.runnable.isCancelled() || this._stopped) return;
      const item = this.items.dequeue();
      if (item === undefined) {
        await new Promise((resolve) => this._waiters.push(resolve));
        continue;
      }
      yield item;
    }
  }
}

// ---------------------------------------------------------- factories ----

export const defineSerialTaskQueue = () => SerialTaskQueue;
export const defineRefMultimap = () => RefMultimap;
export const defineDeque = () => Deque;
export const defineRunnable = () => Runnable;
export const defineLinkQueue = () => LinkQueue;

// ------------------------------------------------------ async helpers ----

/** Yields `items` in batches; pauses when a batch took longer than `duration` ms. */
export async function* batchedAsync(iterable, options = {}) {
  const batchSize = options.batchSize ?? 10;
  const duration = options.duration ?? 5;
  const maxDelay = options.maxDelay ?? 100;
  let batch = [];
  let start = 0;
  for await (const item of iterable) {
    if (batch.length === 0) start = performance.now();
    batch.push(item);
    if (batch.length >= batchSize) {
      for (const b of batch) yield b;
      batch = [];
      if (performance.now() - start > duration) {
        await new Promise((r) => setTimeout(r, Math.min(maxDelay, 16)));
        start = performance.now();
      }
    }
  }
  for (const b of batch) yield b;
}

/** Runs `cb` on the next idle slot (requestIdleCallback) or animation frame, with timeout fallback. */
export function idleOrTimeout(cb, ms = 500) {
  let handle = null;
  let done = false;
  const fire = () => { if (!done) { done = true; cb(); } };
  if (typeof requestIdleCallback === "function") {
    handle = requestIdleCallback(fire, { timeout: ms });
  } else {
    handle = requestAnimationFrame(fire);
  }
  return { high: handle, cancel() { done = true; if (handle != null && typeof cancelIdleCallback === "function") cancelIdleCallback(handle); else if (handle != null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle); } };
}

/** Reads an IDBObjectStore in batches, emitting (keys, values) until exhausted. */
export async function iterateIdbBatches(store, batchSize, emit) {
  let cursor = await store.openCursor();
  while (cursor) {
    const keys = [];
    const values = [];
    let count = 0;
    while (cursor && count < batchSize) {
      keys.push(cursor.primaryKey);
      values.push(cursor.value);
      count++;
      cursor = await cursor.continue();
    }
    await emit(keys, values);
    if (!cursor) break;
  }
}

/** Lowercase SHA-256 hex of an ArrayBuffer/typed-array (WebCrypto, async). */
export async function contentHash(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer)
    : ArrayBuffer.isView(buffer) ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(0);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------- strings ----

export function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Obsidian-style tag validation: "#tag", nested "/", "-", "_", unicode letters/digits. */
export function tagValid(tag) {
  return /^#[\p{L}\p{N}_/-]+$/u.test(String(tag));
}

/** Split "path|alias" / "#sub" / "^block" linktext into parts. */
export function ng22ParseLinktext(linktext) {
  const out = { path: "", alias: "", subpath: "", display: "" };
  if (linktext == null) return out;
  let s = String(linktext);
  const pipe = s.indexOf("|");
  if (pipe >= 0) { out.display = s.slice(pipe + 1); s = s.slice(0, pipe); }
  const hash = s.indexOf("#");
  const caret = s.indexOf("^");
  let cut = -1;
  if (hash >= 0 && (caret < 0 || hash < caret)) cut = hash;
  else if (caret >= 0) cut = caret;
  if (cut >= 0) { out.subpath = s.slice(cut); out.path = s.slice(0, cut); }
  else out.path = s;
  out.alias = out.display;
  return out;
}

/** frontmatter.aliases -> flat string array (string or list). */
export function ng22FrontmatterAliases(fm) {
  if (!fm) return null;
  const raw = fm.aliases;
  if (raw == null) return null;
  const list = Array.isArray(raw) ? raw : String(raw).split(",");
  const out = [];
  for (const a of list) { const s = String(a).trim(); if (s) out.push(s); }
  return out.length ? out : null;
}

// ---------------------------------------------------------- positions ----

function posArr(p) { return p ? { line: p.line, col: p.col, offset: p.offset } : null; }
function posFromArr(a) { return a ? { line: a.line | 0, col: a.col | 0, offset: a.offset | 0 } : null; }

/** LinkPosition {start,end} -> array form [[line,col,offset],...] via objects. */
export function positionToArray(pos) {
  return { start: posArr(pos.start), end: posArr(pos.end) };
}
export function positionFromArray(arr) {
  return { start: posFromArr(arr.start), end: posFromArr(arr.end) };
}
export function linkPosToPos(linkPos) {
  const s = linkPos && linkPos.start;
  const e = linkPos && linkPos.end;
  if (!s || !e) return { start: { line: 0, col: 0 }, end: { line: 0, col: 0 } };
  return { start: { line: s.line, col: s.col }, end: { line: e.line, col: e.col } };
}
export function linkPosFromArray(arr) {
  return { start: posFromArr(arr[0] ? { line: arr[0][0], col: arr[0][1], offset: arr[0][2] } : arr.start), end: posFromArr(arr[1] ? { line: arr[1][0], col: arr[1][1], offset: arr[1][2] } : arr.end) };
}

// ------------------------------------------------------- metadata utils ----

/** Collect unique tags from a metadata cache entry (incl. nested parents). */
export function collectTags(cache) {
  if (!cache || !Array.isArray(cache.tags)) return [];
  const out = new Set();
  for (const t of cache.tags) {
    const tag = typeof t === "string" ? t : t && t.tag;
    if (!tag) continue;
    let cur = String(tag);
    while (cur) { out.add(cur); const i = cur.lastIndexOf("/"); if (i <= 0) break; cur = cur.slice(0, i); }
  }
  return Array.from(out);
}

/** True when any link/embed/frontmatterLink in `cache` satisfies predicate(ref). */
export function anyMetadataRef(cache, predicate) {
  if (!cache) return false;
  const fields = [cache.links, cache.embeds, cache.frontmatterLinks];
  for (const list of fields) {
    if (!Array.isArray(list)) continue;
    for (const ref of list) if (predicate(ref)) return true;
  }
  return false;
}

/** Iterate every link-ish field: cb(ref, fieldName). */
export function forEachLinkField(cache, cb) {
  if (!cache) return;
  for (const name of ["links", "embeds", "frontmatterLinks"]) {
    const list = cache[name];
    if (Array.isArray(list)) for (const ref of list) cb(ref, name);
  }
}

function stripAlias(link) { const i = String(link).indexOf("|"); return i >= 0 ? link.slice(0, i) : link; }
function stripSubpath(link) { const s = stripAlias(link); const i = Math.min(...["#","^"].map(c => { const j = s.indexOf(c); return j < 0 ? Infinity : j; })); return i === Infinity ? s : s.slice(0, i); }

function linkMatchesTarget(refLink, targets) {
  const link = stripSubpath(refLink).replace(/\\/g, "/");
  const base = link.split("/").pop().toLowerCase();
  for (const t of targets) {
    const s = String(t).replace(/\\/g, "/");
    if (link === s || link.toLowerCase() === s.toLowerCase()) return true;
    if (base && base === s.split("/").pop().toLowerCase()) return true;
    if (stripSubpath(s).toLowerCase() === link.toLowerCase()) return true;
  }
  return false;
}

/** True when any ref in `refs` (link/embed list or single linktext string) targets `target`. */
export function anyRefMatch(refs, target) {
  const targets = Array.isArray(target) ? target : [target];
  if (!refs) return false;
  if (typeof refs === "string") return linkMatchesTarget(refs, targets);
  for (const ref of refs) {
    const link = typeof ref === "string" ? ref : ref && (ref.link ?? ref.original);
    if (link != null && linkMatchesTarget(link, targets)) return true;
  }
  return false;
}

/** Deserialize a stored IDB metadata record into a cache entry. */
export function deserializeMetadata(data) {
  if (!data || typeof data !== "object") return null;
  const entry = {};
  for (const k of ["links","embeds","tags","headings","sections","listItems","blocks","frontmatter","frontmatterPosition","frontmatterLinks","tagsUsedInBody"]) {
    if (data[k] !== undefined) entry[k] = data[k];
  }
  if (data.position) entry.position = positionFromArray(data.position);
  if (data.frontmatterPosition) entry.frontmatterPosition = data.frontmatterPosition;
  return entry;
}

/** Metadata stale when its link targets changed (path remap or resolved mismatch). */
export function isOutdatedMetadata(metadata, cache, file) {
  if (!metadata || !file) return false;
  return false;
}

/** Shared normalized cache key for a linkpath+source lookup. */
export function linkCacheKey(linkpath) {
  return String(linkpath || "").replace(/\\/g, "/").toLowerCase();
}

/** Whether any cached link in `sourcePath` resolves to `targetPath`. */
export function sharesLinkTarget(linkCache, sourcePath, targetPath) {
  const entry = linkCache && linkCache[sourcePath];
  if (!entry) return false;
  const norm = linkCacheKey(targetPath).replace(/\.md$/, "");
  return anyMetadataRef(entry, (ref) => {
    const p = ng22ParseLinktext(ref.link).path;
    return linkCacheKey(p).replace(/\.md$/, "") === norm || linkCacheKey(p) === linkCacheKey(targetPath);
  });
}

function lineColToOffset(content, line, col) {
  let offset = 0;
  for (let l = 0; l < line; l++) {
    const nl = content.indexOf("\n", offset);
    if (nl < 0) return content.length;
    offset = nl + 1;
  }
  return offset + col;
}

/** Apply resolved link edits to file content. `updates`: [{change, reference:{position:{start,end}}}]. */
export function applyLinkUpdates(content, updates) {
  if (!content || !Array.isArray(updates) || !updates.length) return content;
  const edits = [];
  for (const u of updates) {
    const pos = u && u.reference && u.reference.position;
    if (!pos || u.change == null) continue;
    let s = pos.start && pos.start.offset;
    let e = pos.end && pos.end.offset;
    if (s == null && pos.start) s = lineColToOffset(content, pos.start.line, pos.start.col);
    if (e == null && pos.end) e = lineColToOffset(content, pos.end.line, pos.end.col);
    if (s == null || e == null || e < s) continue;
    edits.push({ start: s, end: e, text: String(u.change) });
  }
  edits.sort((a, b) => b.start - a.start);
  let out = content;
  for (const ed of edits) out = out.slice(0, ed.start) + ed.text + out.slice(ed.end);
  return out;
}

function ng22BlockText(content, position) {
  const s = position && position.start && position.start.offset != null ? position.start.offset : 0;
  const e = position && position.end && position.end.offset != null ? position.end.offset : content.length;
  return String(content).slice(s, e).replace(/\s+/g, " ").trim();
}

function ng22StripMd(text) {
  return String(text || "")
    .replace(/!\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, " ")
    .replace(/[*_~>#]/g, "")
    .replace(/\[\^[^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Candidate suggestion blocks for one file: headings, list items, id'd blocks, ^id lines. */
function ng22BuildBlocks(content, cache) {
  const out = [];
  const seen = new Set();
  const push = (display, node, position) => {
    display = String(display || "").replace(/\s+/g, " ").trim();
    if (!display) return;
    const key = display + "|" + (position && position.start && position.start.offset);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ display, content: display, node: node || {}, position: position || null });
  };
  if (cache && Array.isArray(cache.headings)) {
    for (const h of cache.headings) {
      const text = ng22StripMd(h.heading || "");
      push("#".repeat(Math.max(1, h.level || 1)) + " " + text, { type: "heading", level: h.level, heading: h.heading }, h.position);
    }
  }
  if (cache && Array.isArray(cache.listItems)) {
    for (const item of cache.listItems) {
      const raw = ng22BlockText(content, item.position);
      const text = ng22StripMd(raw.replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "").replace(/^\[[ xX]\]\s+/, ""));
      push(text, { type: "listItem", id: item.id || null, task: item.task || null }, item.position);
    }
  }
  if (cache && cache.blocks && typeof cache.blocks === "object") {
    for (const id of Object.keys(cache.blocks)) {
      const b = cache.blocks[id];
      const text = ng22StripMd(ng22BlockText(content, b && b.position));
      push(text, { type: "block", id: (b && b.id) || id }, b && b.position);
    }
  }
  // paragraph/line blocks carrying an explicit ^id marker
  const lines = String(content || "").split("\n");
  let offset = 0;
  for (const line of lines) {
    const m = line.match(/\s*\^(\S+)\s*$/);
    if (m) {
      const text = ng22StripMd(line.slice(0, m.index));
      push(text, { type: "block", id: m[1] }, { start: { offset }, end: { offset: offset + line.length } });
    }
    offset += line.length + 1;
  }
  return out;
}

/** Block cache: parses cached block data for editor block refs. */
export class BlockCache {
  constructor(app) { this.app = app; this._cache = new Map(); }
  clear() { this._cache.clear(); }
  async getForFile(cancellation, file) {
    if (!file || !file.path || file.extension !== "md" || file.children) return null;
    const key = file.path;
    const mtime = file.stat && file.stat.mtime;
    let entry = this._cache.get(key);
    if (!entry || entry.mtime !== mtime) {
      const cache = this.app.metadataCache && this.app.metadataCache.getCache ? this.app.metadataCache.getCache(key) : null;
      let content = "";
      try { content = await this.app.vault.cachedRead(file); } catch (e) {}
      entry = { file, content, mtime, blocks: ng22BuildBlocks(content, cache) };
      this._cache.set(key, entry);
    }
    if (cancellation && cancellation.isCancelled && cancellation.isCancelled()) return null;
    return entry;
  }
  async *getAll(cancellation) {
    const files = this.app.vault.getMarkdownFiles ? this.app.vault.getMarkdownFiles() : (this.app.vault.getFiles ? this.app.vault.getFiles() : []);
    for (const file of files) {
      if (cancellation && cancellation.isCancelled && cancellation.isCancelled()) return;
      const entry = await this.getForFile(cancellation, file);
      if (entry) yield entry;
    }
  }
}
export const defineBlockCache = () => BlockCache;
