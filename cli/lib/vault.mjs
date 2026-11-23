// A vault is just a folder: notes are .md files, config lives in .basalt/ (or .obsidian/). Everything here works without the app.
import fs from "node:fs";
import path from "node:path";
import { CliError, EXIT, notFound, usage, posix, readJson, formatDate, parseWhen } from "./util.mjs";
import { extractLinks, extractTags, extractHeadings, getProperties, wordCount } from "./md.mjs";

const SKIP_DIRS = new Set([".git", ".basalt", ".obsidian", ".trash", ".basalt-history", "node_modules"]);
const BASE = (p) => p.slice(p.lastIndexOf("/") + 1);
const STEM = (p) => BASE(p).replace(/\.[^.]+$/, "");
const EXT = (p) => { const m = /\.([^./]+)$/.exec(p); return m ? m[1].toLowerCase() : ""; };
const DIR = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const slash = (p) => posix(p).replace(/^\.?\/+/, "");

export class Vault {
  constructor(root) { this.root = path.resolve(root); this._idx = null; this._text = new Map(); }

  /** Locate a vault: explicit path, BASALT_VAULT, or walk up from `start` to a folder holding .basalt or .obsidian. */
  static find(explicit, start = process.cwd()) {
    const given = explicit || process.env.BASALT_VAULT;
    if (given) {
      const p = path.resolve(given);
      if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) throw notFound(`vault folder not found: ${p}`);
      return new Vault(p);
    }
    for (let d = path.resolve(start); ; d = path.dirname(d)) {
      if (fs.existsSync(path.join(d, ".basalt")) || fs.existsSync(path.join(d, ".obsidian"))) return new Vault(d);
      if (path.dirname(d) === d) break;
    }
    throw new CliError("no vault here: pass --vault <folder>, set BASALT_VAULT, or run inside a folder with .basalt or .obsidian", EXIT.NOT_FOUND);
  }

  get name() { return path.basename(this.root); }
  abs(rel) {
    const r = slash(rel), full = path.resolve(this.root, r);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) throw usage(`path leaves the vault: ${rel}`);
    return full;
  }
  get configDir() { return fs.existsSync(path.join(this.root, ".basalt")) ? ".basalt" : fs.existsSync(path.join(this.root, ".obsidian")) ? ".obsidian" : null; }
  basaltPath(...p) { return path.join(this.root, ".basalt", ...p); }
  config(name, dflt = {}) {
    for (const d of [".basalt", ".obsidian"]) { const j = readJson(path.join(this.root, d, name), undefined); if (j !== undefined) return j; }
    return dflt;
  }

  // ---------- files ----------
  invalidate() { this._idx = null; this._links = null; this._text.clear(); }
  /** [{path, ext, size, mtime}] for every visible file, sorted by path */
  files() { return this.index().files; }
  index() {
    if (this._idx) return this._idx;
    const files = [];
    const walk = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith(".") && (e.isDirectory() || SKIP_DIRS.has(e.name))) continue;
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), rel + e.name + "/"); continue; }
        if (!e.isFile() || e.name.startsWith(".")) continue;
        const st = fs.statSync(path.join(dir, e.name));
        files.push({ path: rel + e.name, ext: EXT(e.name), size: st.size, mtime: st.mtimeMs });
      }
    };
    walk(this.root, "");
    files.sort((a, b) => (a.path < b.path ? -1 : 1));
    const byPath = new Map(), byName = new Map();
    for (const f of files) {
      byPath.set(f.path.toLowerCase(), f);
      const n = BASE(f.path).toLowerCase(); (byName.get(n) || byName.set(n, []).get(n)).push(f);
    }
    return (this._idx = { files, byPath, byName });
  }
  notes() { return this.files().filter((f) => f.ext === "md"); }
  exists(rel) { return fs.existsSync(this.abs(rel)); }
  read(rel) { const full = this.abs(rel); if (!fs.existsSync(full)) throw notFound(`file not found: ${rel}`); return fs.readFileSync(full, "utf8"); }
  cached(rel) { let t = this._text.get(rel); if (t === undefined) { t = this.read(rel); this._text.set(rel, t); } return t; }
  write(rel, text) {
    const full = this.abs(rel); fs.mkdirSync(path.dirname(full), { recursive: true });
    const tmp = full + ".basalt-tmp-" + process.pid; fs.writeFileSync(tmp, text); fs.renameSync(tmp, full);
    this.invalidate();
  }

  /** Resolve what the user typed (path, path without .md, or a bare note name) to a vault path. */
  resolve(input, { exts } = {}) {
    if (!input) throw usage("a file is required");
    const p = slash(input), { byPath } = this.index();
    for (const c of [p, p + ".md"]) { const f = byPath.get(c.toLowerCase()); if (f && (!exts || exts.includes(f.ext))) return f.path; }
    const hit = this.lookup(p, "", true, exts);
    if (hit) return hit;
    throw notFound(`not found: ${input}`);
  }
  /** Obsidian-style name lookup. Prefers a file next to `from`, then the shortest path. */
  lookup(target, from = "", anyExt = true, exts) {
    const { byPath, byName } = this.index();
    let t = slash(target).toLowerCase();
    if (!t) return from || null;
    for (const c of [t, t + ".md"]) { const f = byPath.get(c); if (f && (!exts || exts.includes(f.ext))) return f.path; }
    let list;
    if (t.includes("/")) {
      list = [];
      for (const [k, f] of byPath) if (k.endsWith("/" + t) || k.endsWith("/" + t + ".md")) list.push(f);
    } else list = byName.get(t) || byName.get(t + ".md") || [];
    if (exts) list = list.filter((f) => exts.includes(f.ext));
    if (!list.length) return null;
    const near = list.filter((f) => DIR(f.path) === DIR(from));
    return (near.length ? near : list).sort((a, b) => a.path.length - b.path.length || (a.path < b.path ? -1 : 1))[0].path;
  }

  // ---------- links ----------
  /** Where does this link point? (vault path or null). `link` comes from extractLinks. */
  resolveLink(link, from) {
    if (link.target === "" ) return from;
    if (link.kind === "md" || (link.kind === "embed" && link.mdRaw !== undefined)) {
      const rel = slash(path.posix.normalize(link.target.startsWith("/") ? link.target.slice(1) : path.posix.join(DIR(from), link.target)));
      const f = this.index().byPath.get(rel.toLowerCase()); if (f) return f.path;
    }
    return this.lookup(link.target, from);
  }
  linksOf(rel) {
    const text = this.cached(rel);
    return extractLinks(text).map((l) => ({ ...l, from: rel, to: this.resolveLink(l, rel) }));
  }
  /** Map of note path -> its links (only .md notes; boards and canvases are added as link sources too) */
  allLinks() {
    if (this._links) return this._links;
    const m = new Map();
    for (const n of this.notes()) m.set(n.path, this.linksOf(n.path));
    return (this._links = m);
  }
  backlinks(rel) {
    const out = [];
    for (const [from, ls] of this.allLinks()) for (const l of ls) if (l.to === rel && from !== rel) out.push({ from, line: l.line, kind: l.kind, text: l.raw });
    return out;
  }
  unresolved() {
    const out = [];
    for (const [from, ls] of this.allLinks()) for (const l of ls) if (!l.to) out.push({ from, line: l.line, kind: l.kind, target: l.target });
    return out;
  }

  // ---------- tags / properties ----------
  tagsOf(rel) { return extractTags(this.cached(rel)); }
  propsOf(rel) { return getProperties(this.cached(rel)); }
  allTags() {
    const m = new Map();
    for (const n of this.notes()) for (const t of this.tagsOf(n.path)) (m.get(t) || m.set(t, []).get(t)).push(n.path);
    return m;
  }
  hasTag(rel, tag) {
    const t = tag.replace(/^#/, "").toLowerCase();
    return this.tagsOf(rel).some((x) => { x = x.toLowerCase(); return x === t || x.startsWith(t + "/"); });
  }

  // ---------- moving ----------
  /**
   * Plan (and with dryRun=false do) a move of a file or folder. Links, embeds and canvas/board references everywhere are rewritten.
   * Returns {moves, edits, dryRun}
   */
  async move(from, to, { dryRun = false, force = false } = {}) {
    const src = slash(from).replace(/\/+$/, ""), absSrc = this.abs(src);
    if (!fs.existsSync(absSrc)) throw notFound(`not found: ${from}`);
    const isDir = fs.statSync(absSrc).isDirectory();
    let dest = slash(to);
    if (dest.endsWith("/") || (fs.existsSync(this.abs(dest)) && fs.statSync(this.abs(dest)).isDirectory() && !isDir)) dest = dest.replace(/\/+$/, "") + "/" + BASE(src);
    if (!isDir && !EXT(dest) && EXT(src)) dest += "." + EXT(src);
    if (isDir && dest.startsWith(src + "/")) throw usage("cannot move a folder into itself");
    if (!force && fs.existsSync(this.abs(dest)) && src.toLowerCase() !== dest.toLowerCase()) throw new CliError(`destination exists: ${dest} (use --force to overwrite)`, EXIT.ERROR);
    this.abs(dest);
    const moves = new Map();
    if (isDir) for (const f of this.files()) { if (f.path.startsWith(src + "/")) moves.set(f.path, dest + f.path.slice(src.length)); }
    else moves.set(src, dest);
    if (!isDir && !this.index().byPath.has(src.toLowerCase())) moves.set(src, dest);

    const edits = await this.planLinkEdits(moves);
    const result = { moves: [...moves].map(([a, b]) => ({ from: a, to: b })), edits: edits.summary, dryRun };
    if (dryRun) return result;

    for (const e of edits.apply) this.write(e.file, e.text); // edit at the old location first
    if (isDir) { fs.mkdirSync(path.dirname(this.abs(dest)), { recursive: true }); fs.renameSync(absSrc, this.abs(dest)); }
    else { fs.mkdirSync(path.dirname(this.abs(dest)), { recursive: true }); if (force && fs.existsSync(this.abs(dest))) fs.rmSync(this.abs(dest)); fs.renameSync(absSrc, this.abs(dest)); }
    // history folders of moved boards follow them
    for (const [a, b] of moves) if (EXT(a) === "board") this.moveHistory(a, b);
    this.invalidate(); this._links = null;
    return result;
  }
  moveHistory(a, b) {
    const h = (p) => path.join(this.root, ".basalt-history", p.replace(/[\\/]/g, "__"));
    try { if (fs.existsSync(h(a)) && !fs.existsSync(h(b))) fs.renameSync(h(a), h(b)); } catch { /* history is best effort */ }
  }

  async planLinkEdits(moves) {
    const rel = (p) => moves.get(p) || p;
    const movedBase = (p) => BASE(p).toLowerCase();
    // basenames that exist after the move (to know whether a bare name is still unique)
    const after = new Map();
    for (const f of this.files()) { const n = movedBase(rel(f.path)); after.set(n, (after.get(n) || 0) + 1); }
    const nameOf = (np, orig, f) => { // text to put inside [[ ]] for file f living at np
      const keepExt = EXT(np) !== "md" || /\.md$/i.test(orig);
      const full = keepExt ? np : np.replace(/\.md$/i, "");
      const bare = keepExt ? BASE(np) : BASE(np).replace(/\.md$/i, "");
      if (orig.includes("/") || (after.get(movedBase(np)) || 0) > 1) return full;
      void f; return bare;
    };
    const apply = [], summary = [];
    const handleText = (file, text, getEdits) => {
      const list = getEdits(); if (!list.length) return;
      let out = text; for (const e of [...list].sort((a, b) => b.index - a.index)) out = out.slice(0, e.index) + e.to + out.slice(e.index + e.length);
      apply.push({ file, text: out }); summary.push({ file, count: list.length, links: list.map((e) => ({ line: e.line, from: e.from, to: e.to })) });
    };
    for (const n of this.files()) {
      const e = EXT(n.path);
      if (e === "md") {
        const text = this.cached(n.path), newFrom = rel(n.path);
        handleText(n.path, text, () => {
          const edits = [];
          for (const l of extractLinks(text)) {
            const target = this.resolveLink(l, n.path);
            const isRel = (l.kind === "md" || l.mdRaw !== undefined) && !l.mdRaw.startsWith("/") && !l.mdRaw.startsWith("<");
            if (!target) continue;
            const moved = moves.has(target), selfMoved = newFrom !== n.path;
            if (!moved && !(isRel && selfMoved)) continue;
            const np = rel(target); let to;
            if (l.mdRaw !== undefined) {
              if (!moved && !selfMoved) continue;
              let r = l.mdRaw.startsWith("/") ? "/" + np : path.posix.relative(DIR(newFrom) || ".", np) || BASE(np);
              if (l.mdRaw.startsWith("<")) r = "<" + r + (l.heading ? "#" + l.heading : "") + ">"; else r = r.replace(/ /g, "%20") + (l.heading ? "#" + l.heading : "");
              to = l.raw.replace(l.mdRaw, () => r);
            } else {
              if (!moved) continue;
              to = (l.kind === "embed" ? "!" : "") + "[[" + nameOf(np, l.target, target) + (l.heading ? "#" + l.heading : "") + (l.alias ? "|" + l.alias : "") + "]]";
            }
            if (to !== l.raw) edits.push({ index: l.index, length: l.length, line: l.line, from: l.raw, to });
          }
          return edits;
        });
      } else if (e === "canvas") {
        const text = this.cached(n.path);
        let j; try { j = JSON.parse(text); } catch { continue; }
        let count = 0;
        for (const node of j.nodes || []) if (node.type === "file" && node.file && moves.has(this.resolveLink({ kind: "wiki", target: node.file }, n.path) || "")) { const np = rel(this.resolveLink({ kind: "wiki", target: node.file }, n.path)); summary.push({ file: n.path, count: 1, links: [{ line: 0, from: node.file, to: np }] }); node.file = np; count++; }
        if (count) { const ind = /^\{\r?\n(\t| +)/.exec(text); apply.push({ file: n.path, text: JSON.stringify(j, null, ind ? ind[1] : undefined) }); }
      } else if (e === "board") {
        const text = this.cached(n.path);
        const mod = await import("./board.mjs");
        let changed = 0, lines = [];
        const out = await mod.rewriteBoardText(text, (card) => {
          const edits = [];
          for (const l of extractLinks(card)) {
            if (l.mdRaw !== undefined) continue;
            const target = this.resolveLink(l, n.path); if (!target || !moves.has(target)) continue;
            const to = (l.kind === "embed" ? "!" : "") + "[[" + nameOf(rel(target), l.target, target) + (l.heading ? "#" + l.heading : "") + (l.alias ? "|" + l.alias : "") + "]]";
            if (to !== l.raw) edits.push({ index: l.index, length: l.length, from: l.raw, to });
          }
          if (!edits.length) return card;
          changed += edits.length; for (const e2 of edits) lines.push({ line: 0, from: e2.from, to: e2.to });
          let r = card; for (const e2 of edits.sort((a, b) => b.index - a.index)) r = r.slice(0, e2.index) + e2.to + r.slice(e2.index + e2.length);
          return r;
        });
        if (changed) { apply.push({ file: n.path, text: out }); summary.push({ file: n.path, count: changed, links: lines }); }
      }
    }
    return { apply, summary };
  }

  // ---------- delete ----------
  /** Move to <vault>/.trash (never hard delete unless force). Returns where it went. */
  trash(rel, { force = false } = {}) {
    const p = slash(rel).replace(/\/+$/, ""), full = this.abs(p);
    if (!fs.existsSync(full)) throw notFound(`not found: ${rel}`);
    if (force) { fs.rmSync(full, { recursive: true, force: true }); this.invalidate(); return { deleted: p, trashed: null }; }
    const trashDir = path.join(this.root, ".trash"); fs.mkdirSync(trashDir, { recursive: true });
    let name = BASE(p), target = path.join(trashDir, name);
    for (let i = 1; fs.existsSync(target); i++) { const e = path.extname(name); target = path.join(trashDir, path.basename(name, e) + " " + i + e); }
    fs.renameSync(full, target); this.invalidate(); this._links = null;
    return { deleted: p, trashed: posix(path.relative(this.root, target)) };
  }

  // ---------- daily ----------
  dailyPath(date = new Date()) {
    const c = this.config("daily-notes.json", {}), fmt = c.format || "YYYY-MM-DD", folder = (c.folder || "").replace(/^\/+|\/+$/g, "");
    return (folder ? folder + "/" : "") + formatDate(date, fmt) + ".md";
  }

  // ---------- search ----------
  /** Search notes. opts: regex, caseSensitive, tag, prop[] ("k=v","k!=v","k~v","k"), folder, context, limit, ext */
  search(query, o = {}) {
    const props = (o.prop || []).map((s) => { const m = /^([^=!~]+)(!=|=|~)?(.*)$/.exec(s); return { k: m[1].trim(), op: m[2] || "exists", v: m[3] }; });
    let re = null;
    if (query) {
      try { re = new RegExp(o.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), o.caseSensitive ? "g" : "gi"); } catch (e) { throw usage("bad regex: " + e.message); }
    }
    const folder = o.folder ? slash(o.folder).replace(/\/+$/, "") + "/" : "";
    const exts = o.ext && o.ext.length ? o.ext.map((e) => e.replace(/^\./, "").toLowerCase()) : ["md"];
    const hits = [], ctx = o.context || 0, limit = o.limit || 0;
    const propOk = (p) => props.every(({ k, op, v }) => {
      const val = p[k]; if (op === "exists") return val !== undefined;
      if (val === undefined) return op === "!=";
      const flat = Array.isArray(val) ? val.map(String) : [String(val)];
      const eq = flat.some((x) => x.toLowerCase() === v.toLowerCase());
      return op === "=" ? eq : op === "!=" ? !eq : flat.some((x) => x.toLowerCase().includes(v.toLowerCase()));
    });
    let nfiles = 0;
    for (const f of this.files()) {
      if (!exts.includes(f.ext) || (folder && !f.path.startsWith(folder))) continue;
      if (o.tag && !(f.ext === "md" && this.hasTag(f.path, o.tag))) continue;
      if (props.length && !(f.ext === "md" && propOk(this.propsOf(f.path)))) continue;
      if (o.modifiedSince && f.mtime < o.modifiedSince.getTime()) continue;
      if (!re) { hits.push({ path: f.path }); if (limit && ++nfiles >= limit) break; continue; }
      let text; try { text = this.cached(f.path); } catch { continue; }
      const lines = text.split(/\r?\n/), found = [];
      lines.forEach((ln, i) => { re.lastIndex = 0; if (re.test(ln)) found.push(i); });
      const nameHit = (re.lastIndex = 0, re.test(STEM(f.path)));
      if (!found.length && !nameHit) continue;
      hits.push({
        path: f.path, nameMatch: nameHit,
        matches: found.map((i) => ({ line: i + 1, text: lines[i], before: lines.slice(Math.max(0, i - ctx), i), after: lines.slice(i + 1, i + 1 + ctx) })),
      });
      if (limit && ++nfiles >= limit) break;
    }
    return hits;
  }

  // ---------- stats / check ----------
  stats() {
    const files = this.files(), notes = files.filter((f) => f.ext === "md"), byExt = {};
    let words = 0, chars = 0, links = 0, tagSet = new Map();
    for (const f of files) { const b = (byExt[f.ext || "(none)"] ||= { files: 0, bytes: 0 }); b.files++; b.bytes += f.size; }
    for (const n of notes) { const t = this.cached(n.path); words += wordCount(t); chars += t.length; links += extractLinks(t).length; for (const tg of extractTags(t)) tagSet.set(tg, (tagSet.get(tg) || 0) + 1); }
    const biggest = [...notes].sort((a, b) => b.size - a.size).slice(0, 5).map((f) => ({ path: f.path, size: f.size }));
    return { files: files.length, notes: notes.length, boards: byExt.board?.files || 0, canvases: byExt.canvas?.files || 0, attachments: files.length - notes.length - (byExt.board?.files || 0) - (byExt.canvas?.files || 0), bytes: files.reduce((s, f) => s + f.size, 0), words, characters: chars, links, tags: tagSet.size, folders: new Set(files.map((f) => DIR(f.path)).filter(Boolean)).size, byExtension: byExt, biggest };
  }
  check() {
    const broken = this.unresolved(), dupes = [], empty = [];
    const names = new Map();
    for (const n of this.notes()) { const k = STEM(n.path).toLowerCase(); (names.get(k) || names.set(k, []).get(k)).push(n.path); if (n.size === 0 || !this.cached(n.path).trim()) empty.push(n.path); }
    for (const [name, list] of names) if (list.length > 1) dupes.push({ name, paths: list });
    return { broken, duplicates: dupes, empty };
  }
  outline(rel) { return extractHeadings(this.cached(rel)); }
  info() {
    const cfg = this.configDir;
    return { name: this.name, root: this.root, config: cfg, trash: fs.existsSync(path.join(this.root, ".trash")), notes: this.notes().length, files: this.files().length, dailyNotes: this.config("daily-notes.json", null), hasHistory: fs.existsSync(path.join(this.root, ".basalt-history")) };
  }
}

export { parseWhen };
