// g20 clean-room: canvas file index, the metadata extractor that powers
// plugin.index (getAll/getForPath over .canvas files), and the link updater
// registered as metadataCache.linkUpdaters.canvas.
//
// Replaces orig X5/e8/t8 (canvas-file-index.js).
import { env } from "./env.js";
import { canvas, ng20CanvasExtension } from "./n-g20-shared.js";

const NG20_LINK_RE = /(!?)\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g;

function ng20LinksInText(text) {
  const out = [];
  NG20_LINK_RE.lastIndex = 0;
  let m;
  while ((m = NG20_LINK_RE.exec(text || ""))) {
    const target = (m[2] || "").trim();
    if (target) out.push(target + (m[3] || ""));
  }
  return out;
}

// ---- metadata extractor / canvas file index (e8) --------------------------------------------------
// A Component that incrementally scans every .canvas file and records, per path:
//   embeds: [{file: <node.file>}]            — file/group nodes referencing vault files
//   caches: {<nodeId>: [<wikilink targets>]} — text/link nodes containing [[links]]
// Exposed to the plugin as plugin.index with getAll()/getForPath().

export function defineNg20MetadataExtractor(host) {
  class MetadataExtractor extends host.Component {
    constructor(app) {
      super(app);
      this.app = app;
      this.data = new Map(); // canvasPath -> {embeds:[], caches:{}, nodeIds:Set, refs:[]}
      this.refNodeIds = new WeakMap(); // TFile -> Set<nodeId> of nodes holding links
      this.queue = [];
      this.scanning = false;
    }

    /** All indexed records as a plain {path: record} object. */
    getAll() {
      const out = {};
      for (const [path, rec] of this.data) out[path] = rec;
      return out;
    }

    getForPath(path) { return this.data.get(path); }
    get(path) { return this.data.get(path); }

    onload() {
      const vault = this.app.vault;
      this.registerEvent(vault.on("create", (f) => this.onFileEvent(f)));
      this.registerEvent(vault.on("modify", (f) => this.onFileEvent(f)));
      this.registerEvent(vault.on("rename", (f, oldPath) => this.onRename(f, oldPath)));
      this.registerEvent(vault.on("delete", (f) => this.onDelete(f)));
      // initial pass over existing canvases
      for (const f of vault.getFiles ? vault.getFiles() : []) {
        if (f.extension === ng20CanvasExtension) this.enqueue(f);
      }
      this.pump();
    }

    onunload() {
      this.data.clear();
      this.queue = [];
    }

    isCanvas(file) { return !!file && file.extension === ng20CanvasExtension; }

    onFileEvent(file) {
      if (this.isCanvas(file)) this.enqueue(file);
    }

    onRename(file, oldPath) {
      if (!this.isCanvas(file)) return;
      const rec = this.data.get(oldPath);
      if (rec) {
        this.data.delete(oldPath);
        this.data.set(file.path, rec);
      }
      this.enqueue(file);
    }

    onDelete(file) {
      if (!this.isCanvas(file)) return;
      this.data.delete(file.path);
    }

    enqueue(file) {
      const path = file.path || file;
      const i = this.queue.findIndex((q) => (q.path || q) === path);
      if (i >= 0) this.queue.splice(i, 1);
      this.queue.push(file);
      if (!this.scanning) this.pump();
    }

    /** Processes queued files one at a time so huge vaults never block. */
    pump() {
      if (this.queue.length === 0) { this.scanning = false; return; }
      this.scanning = true;
      const file = this.queue.shift();
      const done = () => setTimeout(() => this.pump(), 0);
      let text;
      try {
        text = this.app.vault.cachedRead(file);
      } catch (e) {
        text = null;
      }
      if (text && typeof text.then === "function") {
        text.then((t) => { this.scanText(file, t); done(); }).catch(() => { this.data.delete(file.path); done(); });
      } else {
        this.scanText(file, text);
        done();
      }
    }

    scanText(file, text) {
      if (typeof text !== "string" || !text) { this.data.delete(file.path); return; }
      let data;
      try { data = JSON.parse(text); } catch (e) { this.data.delete(file.path); return; }
      const embeds = [];
      const caches = {};
      for (const node of (data && data.nodes) || []) {
        if (!node || typeof node !== "object") continue;
        if (node.type === "file" && typeof node.file === "string" && node.file) {
          embeds.push({ file: node.file });
        } else if ((node.type === "text" || node.type === "link") && typeof node.text === "string") {
          const links = ng20LinksInText(node.text);
          if (links.length) caches[node.id] = links;
        }
      }
      this.data.set(file.path, { embeds, caches });
    }

    /** Called by FileNode when a file link is added/removed (kept for parity). */
    registerLink(canvasPath, targetPath) {
      const rec = this.data.get(canvasPath);
      if (rec && !rec.embeds.some((e) => e.file === targetPath)) rec.embeds.push({ file: targetPath });
    }

    unregisterLink(canvasPath, targetPath) {
      const rec = this.data.get(canvasPath);
      if (rec) rec.embeds = rec.embeds.filter((e) => e.file !== targetPath);
    }
  }
  canvas.MetadataExtractor = MetadataExtractor;
  canvas.MetadataExtractorBase = MetadataExtractor;
  return MetadataExtractor;
}

// ---- standalone file index (X5) ------------------------------------------------------------------
// Queue-based incremental scanner kept for registry parity; the live index used by
// the plugin is MetadataExtractor above.

export function defineNg20FileIndex(host) {
  class FileIndex {
    constructor(app) {
      this.app = app;
      this.index = new Map();
      this.queue = [];
      this.active = false;
    }

    get size() { return this.index.size; }
    get(path) { return this.index.get(path); }

    update(pathOrPaths) {
      const paths = Array.isArray(pathOrPaths) ? pathOrPaths : [pathOrPaths];
      for (const p of paths) if (p && !this.queue.includes(p)) this.queue.push(p);
      if (!this.active) this.processNext();
    }

    processNext() {
      if (this.queue.length === 0) { this.active = false; return; }
      this.active = true;
      const path = this.queue.shift();
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!file || file.extension !== "md") { this.index.delete(path); this.processNext(); return; }
      let text = null;
      try { text = this.app.vault.cachedRead(file); } catch (e) { /* ignore */ }
      const finish = (t) => {
        const embeds = [];
        for (const link of ng20LinksInText(t)) embeds.push({ path: link.split("#")[0], subpath: link.includes("#") ? "#" + link.split("#").slice(1).join("#") : "" });
        this.index.set(path, { embeds, caches: [] });
        setTimeout(() => this.processNext(), 0);
      };
      if (text && typeof text.then === "function") text.then(finish).catch(() => this.processNext());
      else { finish(text); }
    }
  }
  canvas.FileIndex = FileIndex;
  return FileIndex;
}

// ---- link updater (t8) -------------------------------------------------------------------------
export function defineNg20LinkUpdater(host) {
  class LinkUpdater {
    constructor(app, canvasOrPlugin) {
      this.app = app;
      this.canvas = canvasOrPlugin || null;
      this.index = (canvasOrPlugin && canvasOrPlugin.index) || null;
    }

    _indexAll() {
      const idx = this.index;
      if (idx && typeof idx.getAll === "function") return idx.getAll() || {};
      return {};
    }

    _indexFor(path) {
      const idx = this.index;
      if (idx && typeof idx.getForPath === "function") return idx.getForPath(path) || null;
      return null;
    }

    /** Visits every link/embed reference of every indexed .canvas file: cb(path, ref). */
    iterateReferences(visit) {
      const all = this._indexAll();
      for (const path in all) {
        const rec = all[path];
        for (const ref of (rec && rec.refs) || []) visit(path, ref);
      }
    }

    /** Same, restricted to one canvas path. */
    iterateReferencesForFile(path, visit) {
      const rec = this._indexFor(path);
      for (const ref of (rec && rec.refs) || []) visit(path, ref);
    }

    /**
     * Rewrites "text" nodes whose links were retargeted by a file rename.
     * updates: [{sourcePath, reference, change}] — reference.nodeId picks the node,
     * reference.original is the old link text replaced by change inside node.text.
     */
    async applyUpdates(file, updates) {
      const rec = this._indexFor(file.path);
      const wanted = new Map(); // nodeId -> [update]
      for (const u of updates || []) {
        const ref = u && u.reference;
        if (!ref || ref.kind !== "text" || !ref.nodeId) continue;
        if (rec && rec.nodeIds && !rec.nodeIds.has(ref.nodeId)) continue;
        if (!wanted.has(ref.nodeId)) wanted.set(ref.nodeId, []);
        wanted.get(ref.nodeId).push(u);
      }
      if (wanted.size === 0) return;
      let text;
      try { text = await this.app.vault.read(file); } catch (e) { return; }
      let data;
      try { data = JSON.parse(text); } catch (e) {
        console.warn("canvas link updater: cannot parse " + file.path);
        return;
      }
      let changed = false;
      for (const node of (data && data.nodes) || []) {
        const list = wanted.get(node && node.id);
        if (!list || !node || node.type !== "text" || typeof node.text !== "string") continue;
        for (const u of list) {
          const ref = u.reference;
          const next = typeof u.change === "string" ? u.change : "";
          if (ref.original && node.text.includes(ref.original)) {
            node.text = node.text.split(ref.original).join(next);
          }
        }
        changed = true;
      }
      if (changed) {
        try { await this.app.vault.modify(file, JSON.stringify(data)); }
        catch (e) { console.warn("canvas link updater: write failed for " + file.path); }
      }
    }

    /**
     * Heading/block renames: canvas files whose file/group node embeds point at
     * `file` with a matching subpath get that node's subpath rewritten.
     */
    async renameSubpath(file, oldSubpath, newSubpath) {
      const all = this._indexAll();
      const wantCaret = typeof oldSubpath === "string" && oldSubpath.startsWith("^");
      const strip = (s) => String(s || "").replace(/^#/, "");
      const norm = (s) => strip(s).toLowerCase();
      const oldNorm = wantCaret ? strip(oldSubpath) : norm(oldSubpath);
      for (const path in all) {
        const rec = all[path];
        const hits = ((rec && rec.embeds) || []).filter((e) => {
          if (!e || e.file !== file.path) return false;
          const sub = strip(e.subpath || "");
          if (!sub) return !oldNorm;
          return wantCaret ? sub.toLowerCase() === oldNorm : norm(sub) === oldNorm;
        });
        if (!hits.length) continue;
        const nodeIds = new Set(hits.map((h) => h.nodeId));
        const target = this.app.vault.getAbstractFileByPath(path);
        if (!target) continue;
        try {
          await this.app.vault.process(target, (content) => {
            let data;
            try { data = JSON.parse(content); } catch (e) { return content; }
            let touched = false;
            for (const node of (data && data.nodes) || []) {
              if (node && nodeIds.has(node.id) && typeof node === "object") {
                node.subpath = "#" + newSubpath;
                touched = true;
              }
            }
            return touched ? host.canvasSerialize(data) : content;
          });
        } catch (e) { /* leave file unmodified */ }
      }
    }

    /** Kept for parity: the plugin's own rename listener drives storage migration. */
    onFileRename(oldPath, newFile) {
      const dm = this.canvas && this.canvas.localDataManager;
      if (dm && typeof dm.handleRename === "function") dm.handleRename(oldPath, newFile);
    }

    onFileDelete(f) {
      const dm = this.canvas && this.canvas.localDataManager;
      if (dm && typeof dm.handleDelete === "function") dm.handleDelete(f);
    }
  }
  canvas.LinkUpdater = LinkUpdater;
  return LinkUpdater;
}
