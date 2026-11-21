// g22 clean-room: MetadataCache — vault indexing, link resolution, IndexedDB persistence.
// Own architecture: single-flight WASM worker queue, in-memory maps, lazy linkpath
// resolution over the vault file list, IDB "<appId>-cache" store for warm starts.

import { inherit } from "./inherit.js";
import { Deque, RefMultimap, SerialTaskQueue, Runnable, LinkQueue, BlockCache, batchedAsync, contentHash, collectTags, anyMetadataRef, anyRefMatch, forEachLinkField, linkPosToPos, positionToArray, positionFromArray, linkPosFromArray, deserializeMetadata, escapeRegExp, tagValid, isOutdatedMetadata, applyLinkUpdates, sharesLinkTarget, linkCacheKey, ng22ParseLinktext, ng22FrontmatterAliases, idleOrTimeout, iterateIdbBatches } from "./n-g22-helpers.js";

export function defineMetadataCache(host) {
  const DB_NAME = (app) => `${app.appId || "obsidian"}-cache`;
  const STORE = "files";
  const DB_VERSION = 1;

  function openDb(app) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME(app), DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "path" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function tx(db, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      const out = fn(store);
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  async function idbGetAll(db) {
    return tx(db, "readonly", (store) => {
      return new Promise((res, rej) => {
        const rows = [];
        const cur = store.openCursor();
        cur.onsuccess = () => { const c = cur.result; if (!c) return res(rows); rows.push(c.value); c.continue(); };
        cur.onerror = () => rej(cur.error);
      });
    });
  }
  async function idbPut(db, rec) {
    return tx(db, "readwrite", (store) => new Promise((res, rej) => {
      const r = store.put(rec);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    }));
  }
  async function idbDelete(db, path) {
    return tx(db, "readwrite", (store) => new Promise((res, rej) => {
      const r = store.delete(path);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    }));
  }
  async function idbClear(db) {
    return tx(db, "readwrite", (store) => new Promise((res, rej) => {
      const r = store.clear();
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    }));
  }

  function MetadataCache(app, vault) {
    const self = host.Events.call(this) || this;
    self.app = app;
    self.vault = vault;
    self.fileCache = {};
    self.metadataCache = {};
    self.resolvedLinks = {};
    self.unresolvedLinks = {};
    self.uniqueFileLookup = {};
    self.blockCache = new BlockCache(app);
    self.initialized = false;
    self.inProgressTaskCount = 0;
    self.db = null;
    self.transactionSave = null;
    self.linkResolverQueue = new LinkQueue({ onProcess: (item) => self.resolveLinks(item) });
    self.userIgnoreFilters = [];
    self.worker = null;
    self.workerResolve = null;
    self.workerQueue = [];
    self.workerBusy = false;
    self._cleanWaiters = [];
    self._saveQueue = [];
    self._saveScheduled = false;
    self._eventsBound = false;
    self._fileTasks = new Map();
    self.linkUpdaters = {};
    self._preloadPromise = null;
    self._initPromise = null;
    self._idbRows = null;
    return self;
  }
  inherit(MetadataCache, host.Events);
  const P = MetadataCache.prototype;

  // ------------------------------------------------------------ lifecycle ----

  P.preloadAll = function () {
    const p = (async () => {
      try {
        this.db = await openDb(this.app);
        const rows = await idbGetAll(this.db);
        this._idbRows = {};
        for (const row of rows) {
          if (row && row.path) this._idbRows[row.path] = row;
        }
      } catch (e) {
        this.db = null;
      }
    })();
    this._preloadPromise = p;
    return p;
  };

  P.initialize = function () {
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      if (this._preloadPromise) await this._preloadPromise;
      else await this.preloadAll();
      this.watchVaultChanges();
      this.refreshUserIgnoreFilters();
      const files = this.vault.getAllLoadedFiles ? this.vault.getAllLoadedFiles() : this.vault.getFiles();
      const seen = new Set();
      for (const file of files) {
        if (!file || !file.path || file.children) continue;
        seen.add(file.path);
        const idb = this._idbRows && this._idbRows[file.path];
        if (idb && file.stat && idb.mtime === file.stat.mtime && idb.size === file.stat.size) {
          this.fileCache[file.path] = { mtime: idb.mtime, size: idb.size, hash: idb.hash };
          if (file.extension === "md" && idb.metadata) {
            this.metadataCache[file.path] = deserializeMetadata(idb.metadata);
            continue;
          }
        }
        this.computeFileMetadataAsync(file);
      }
      if (this._idbRows) {
        for (const p of Object.keys(this._idbRows)) {
          if (!seen.has(p) && !this.vault.getAbstractFileByPath(p)) {
            delete this._idbRows[p];
            if (this.db) idbDelete(this.db, p).catch(() => {});
          }
        }
      }
      this._rebuildUniqueLookup();
      this._resolveAllQueued();
      this._armFinished();
    })();
    return this._initPromise;
  };

  P.watchVaultChanges = function () {
    if (this._eventsBound) return;
    this._eventsBound = true;
    const vault = this.vault;
    vault.on("create", (f) => this.onCreate(f));
    vault.on("modify", (f) => this.computeFileMetadataAsync(f));
    vault.on("delete", (f) => this.onDelete(f));
    vault.on("rename", (f, oldPath) => this.onRename(f, oldPath));
    vault.on("config-changed", () => this.onConfigChanged());
  };

  P.refreshUserIgnoreFilters = function () {
    try {
      const cfg = this.vault.getConfig("userIgnoreFilters");
      this.userIgnoreFilters = Array.isArray(cfg) ? cfg.slice() : [];
    } catch (e) { this.userIgnoreFilters = []; }
  };
  P.onConfigChanged = function () { this.refreshUserIgnoreFilters(); };

  // --------------------------------------------------------- file indexing ----

  P.onCreate = function (file) { this.computeFileMetadataAsync(file); };
  P.onModify = function (file) { this.computeFileMetadataAsync(file); };

  P.onDelete = function (file) {
    const path = file.path;
    delete this.fileCache[path];
    delete this.metadataCache[path];
    delete this.resolvedLinks[path];
    delete this.unresolvedLinks[path];
    this._removeFromUniqueLookup(path);
    // drop inbound links pointing at the deleted file
    for (const src of Object.keys(this.resolvedLinks)) {
      const targets = this.resolvedLinks[src];
      if (targets && targets[path] !== undefined) { delete targets[path]; if (!Object.keys(targets).length) delete this.resolvedLinks[src]; }
    }
    this.blockCache.clear && this.blockCache.clear();
    if (this.db) idbDelete(this.db, path).catch(() => {});
    this.trigger("delete", file);
    this._resolveAllQueued();
    this._checkClean();
  };

  P.onRename = function (file, oldPath) {
    oldPath = oldPath || (arguments[1] && arguments[1].path) || null;
    // vault.rename fires with (file, oldPath); remap every cached structure
    for (const map of [this.fileCache, this.metadataCache, this.resolvedLinks, this.unresolvedLinks]) {
      if (map[oldPath]) { map[file.path] = map[oldPath]; delete map[oldPath]; }
    }
    this._removeFromUniqueLookup(oldPath);
    this._registerUniqueLookup(file.path);
    // retarget resolved links whose destination was the renamed file
    for (const src of Object.keys(this.resolvedLinks)) {
      const targets = this.resolvedLinks[src];
      if (targets && targets[oldPath] !== undefined) {
        targets[file.path] = targets[oldPath];
        delete targets[oldPath];
      }
    }
    if (this.db) { idbDelete(this.db, oldPath).catch(() => {}); }
    this.computeFileMetadataAsync(file);
    this.trigger("rename", file, oldPath);
    this._resolveAllQueued();
  };

  P._removeFromUniqueLookup = function (path) {
    const base = this._baseKey(path);
    if (this.uniqueFileLookup[base] === path) delete this.uniqueFileLookup[base];
  };
  P._baseKey = function (path) {
    const base = String(path).split("/").pop();
    const dot = base.lastIndexOf(".");
    return (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
  };
  P._registerUniqueLookup = function (path) {
    const file = this.vault.getAbstractFileByPath(path);
    if (!file || file.extension !== "md") return;
    const key = this._baseKey(path);
    if (this.uniqueFileLookup[key] === undefined || this.uniqueFileLookup[key] === path) this.uniqueFileLookup[key] = path;
    else if (this.uniqueFileLookup[key] !== path) this.uniqueFileLookup[key] = null; // ambiguous
  };

  P._rebuildUniqueLookup = function () {
    this.uniqueFileLookup = {};
    const counts = {};
    const files = this.vault.getAllLoadedFiles ? this.vault.getAllLoadedFiles() : this.vault.getFiles();
    for (const f of files) {
      if (!f || !f.path || f.extension !== "md") continue;
      const key = this._baseKey(f.path);
      counts[key] = (counts[key] || 0) + 1;
      this.uniqueFileLookup[key] = f.path;
    }
    for (const k of Object.keys(counts)) if (counts[k] !== 1) delete this.uniqueFileLookup[k];
  };

  // ------------------------------------------------------------- worker ----

  P._ensureWorker = function () {
    if (this.worker || this._workerFailed) return this.worker;
    try {
      const w = new Worker("/worker.js", { name: "Metadata Cache Worker" });
      w.onmessage = (ev) => this._onWorkerMessage(ev.data);
      w.onerror = () => { this._workerFailed = true; };
      this.worker = w;
    } catch (e) { this._workerFailed = true; }
    return this.worker;
  };

  P._onWorkerMessage = function (data) {
    this.workerBusy = false;
    const job = this.workerQueue.shift();
    if (job) {
      clearTimeout(job.timer);
      if (data === null || data === undefined) job.reject(new Error("metadata worker returned null"));
      else job.resolve(data);
    }
    this._pumpWorker();
  };

  P._pumpWorker = function () {
    if (this.workerBusy || this.workerQueue.length === 0) return;
    const job = this.workerQueue[0];
    const w = this._ensureWorker();
    if (!w) {
      this.workerQueue.shift();
      job.reject(new Error("metadata worker unavailable"));
      this._pumpWorker();
      return;
    }
    this.workerBusy = true;
    try {
      w.postMessage({ metadataCache: job.buffer }, [job.buffer]);
    } catch (e) {
      this.workerQueue.shift();
      this.workerBusy = false;
      job.reject(e);
      this._pumpWorker();
    }
  };

  P._workerParse = function (buffer) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.workerQueue.indexOf(job);
        if (i >= 0) this.workerQueue.splice(i, 1);
        reject(new Error("metadata worker timeout"));
        this._pumpWorker();
      }, 60000);
      const job = { buffer, resolve, reject, timer };
      this.workerQueue.push(job);
      this._pumpWorker();
    });
  };

  // --------------------------------------------------------- compute path ----

  P.computeFileMetadataAsync = async function (file) {
    if (!file || !file.path || file.children) return null;
    if (file.extension !== "md") {
      this.fileCache[file.path] = { mtime: file.stat && file.stat.mtime, size: file.stat && file.stat.size, hash: "" };
      if (this.metadataCache[file.path] === undefined) this.metadataCache[file.path] = {};
      this._registerUniqueLookup(file.path);
      return this.metadataCache[file.path];
    }
    const path = file.path;
    const existing = this._fileTasks.get(path);
    if (existing) return existing;
    const task = this._computeOne(file).finally(() => this._fileTasks.delete(path));
    this._fileTasks.set(path, task);
    return task;
  };

  P._computeOne = async function (file) {
    const path = file.path;
    this.inProgressTaskCount++;
    try {
      const buffer = await this.vault.readBinary(file);
      const hash = await contentHash(buffer);
      const stat = file.stat || {};
      // warm start: reuse persisted metadata when the content hash matches
      const idb = this._idbRows && this._idbRows[path];
      let metadata = null;
      if (idb && idb.hash === hash && idb.metadata) metadata = deserializeMetadata(idb.metadata);
      if (!metadata) {
        const ab = buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        metadata = await this._workerParse(ab);
        metadata = metadata || {};
      }
      this.fileCache[path] = { mtime: stat.mtime, size: stat.size, hash };
      this.metadataCache[path] = metadata;
      this._registerUniqueLookup(path);
      this._indexLinks(path, metadata);
      this._persist(path, hash, stat, metadata);
      this.trigger("changed", file);
      this.trigger("resolve");
      this._resolveAllQueued();
      this._checkClean();
      return metadata;
    } catch (e) {
      this.fileCache[path] = { mtime: file.stat && file.stat.mtime, size: file.stat && file.stat.size, hash: "" };
      this.metadataCache[path] = {};
      this.trigger("changed", file);
      return {};
    } finally {
      this.inProgressTaskCount--;
      this._checkClean();
    }
  };

  P._persist = function (path, hash, stat, metadata) {
    if (!this.db) return;
    if (this._saveScheduled) { this._saveQueue.push([path, hash, stat, metadata]); return; }
    this._saveScheduled = true;
    setTimeout(async () => {
      this._saveScheduled = false;
      const batch = this._saveQueue.splice(0);
      batch.push([path, hash, stat, metadata]);
      try {
        for (const [p, h, st, md] of batch) {
          await idbPut(this.db, { path: p, hash: h, mtime: st.mtime, size: st.size, metadata: md });
        }
      } catch (e) {}
      this._checkClean();
    }, 50);
  };

  // ---------------------------------------------------------- link index ----

  P._indexLinks = function (sourcePath, metadata) {
    const resolved = {};
    const unresolved = {};
    const bump = (map, key) => { map[key] = (map[key] || 0) + 1; };
    forEachLinkField(metadata, (ref) => {
      const linktext = ref && ref.link;
      if (linktext == null) return;
      const linkpath = ng22ParseLinktext(linktext).path;
      if (!linkpath) { bump(unresolved, linktext); return; }
      const dests = this.getLinkpathDest(linkpath, sourcePath);
      if (dests && dests.length) {
        for (const dest of dests) bump(resolved, dest.path);
      } else {
        bump(unresolved, linktext);
      }
    });
    if (Object.keys(resolved).length) this.resolvedLinks[sourcePath] = resolved;
    else delete this.resolvedLinks[sourcePath];
    if (Object.keys(unresolved).length) this.unresolvedLinks[sourcePath] = unresolved;
    else delete this.unresolvedLinks[sourcePath];
  };

  P._resolveAllQueued = function () {
    // re-resolve inbound links for every cached markdown file (rename/delete safety)
    for (const path of Object.keys(this.metadataCache)) {
      const file = this.vault.getAbstractFileByPath(path);
      if (file) this._indexLinks(path, this.metadataCache[path]);
    }
    this.trigger("resolved");
  };

  // --------------------------------------------------------- link lookup ----

  P._isMdFile = function (file) { return !!file && file.extension === "md" && !file.children; };

  P.isSupportedFile = function (file) {
    if (!file || file.children) return false;
    return file.extension === "md" || !!this.linkUpdaters[file.extension];
  };

  P.isUserIgnored = function (path) {
    if (!path) return false;
    const p = String(path).toLowerCase();
    for (const f of this.userIgnoreFilters) {
      if (typeof f !== "string" || !f) continue;
      if (f.length > 2 && f.startsWith("/") && f.endsWith("/")) {
        try {
          if (new RegExp(f.slice(1, -1), "i").test(path)) return true;
        } catch (e) { /* invalid regex: skip */ }
      } else if (p.startsWith(f.toLowerCase())) return true;
    }
    return false;
  };

  P._normLink = function (linkpath) {
    return String(linkpath || "").replace(new RegExp("\\","g"), "/").trim();
  };

  P._resolveRelative = function (linkpath, sourcePath) {
    const p = this._normLink(linkpath);
    if (!sourcePath || !(p.startsWith("./") || p.startsWith("../") || p.startsWith("/"))) return null;
    const srcDir = sourcePath.split("/").slice(0, -1);
    const parts = p.startsWith("/") ? [] : srcDir.slice();
    for (const seg of p.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    return parts.join("/");
  };

  P.getLinkpathDest = function (linkpath, sourcePath) {
    const parsed = ng22ParseLinktext(linkpath);
    const raw = parsed.path != null && parsed.path !== "" ? parsed.path : String(linkpath || "");
    if (raw === "") {
      const src = sourcePath && this.vault.getAbstractFileByPath(sourcePath);
      return src ? [src] : [];
    }
    const files = this.vault.getAllLoadedFiles ? this.vault.getAllLoadedFiles() : this.vault.getFiles();
    const rel = this._resolveRelative(raw, sourcePath);
    const base = rel != null ? rel : this._normLink(raw);
    const cands = [];
    const pushCand = (c) => { if (c && !cands.includes(c)) cands.push(c); };
    pushCand(base);
    pushCand(/\.md$/i.test(base) ? base.replace(/\.md$/i, "") : base + ".md");
    const noExt = base.replace(/\.md$/i, "");
    const last = noExt.split("/").pop();
    pushCand(last);
    pushCand(last + ".md");
    pushCand(noExt);
    const lower = cands.map((c) => c.toLowerCase());
    const hits = [];
    const seen = new Set();
    const push = (f) => { if (f && !seen.has(f.path)) { seen.add(f.path); hits.push(f); } };
    const vaultFiles = files.filter((f) => f && f.path && !f.children);
    for (const f of vaultFiles) {
      const pl = f.path.toLowerCase();
      const noMd = f.path.replace(/\.md$/i, "").toLowerCase();
      for (let i = 0; i < cands.length; i++) {
        const c = lower[i];
        if (pl === c || noMd === c) { push(f); break; }
      }
    }
    if (!hits.length) {
      for (const f of vaultFiles) {
        const pl = f.path.toLowerCase();
        const noMd = f.path.replace(/\.md$/i, "").toLowerCase();
        for (let i = 0; i < cands.length; i++) {
          const c = lower[i];
          if (pl.endsWith("/" + c) || noMd.endsWith("/" + c)) { push(f); break; }
        }
      }
    }
    if (!hits.length) {
      for (const c of cands) {
        const f = this.vault.getAbstractFileByPathInsensitive ? this.vault.getAbstractFileByPathInsensitive(c) : this.vault.getAbstractFileByPath(c);
        if (f) { push(f); break; }
      }
    }
    hits.sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path));
    return hits;
  };

  P.getFirstLinkpathDest = function (linkpath, sourcePath) {
    const dests = this.getLinkpathDest(linkpath, sourcePath);
    return dests && dests.length ? dests[0] : null;
  };

  P.isUnresolved = function (linktext, sourcePath) {
    const parsed = ng22ParseLinktext(linktext);
    if (!parsed.path) return false;
    return this.getLinkpathDest(parsed.path, sourcePath).length === 0;
  };

  // ------------------------------------------------------------ queries ----

  P.getCache = function (path) {
    if (!path) return null;
    const file = this.vault.getAbstractFileByPath(path);
    if (!file) return null;
    const entry = this.metadataCache[file.path];
    return entry === undefined ? null : entry;
  };

  P.getFileCache = function (file) {
    if (!file || !file.path) return null;
    const entry = this.metadataCache[file.path];
    return entry === undefined ? null : entry;
  };

  P.getCachedFiles = function () {
    return Object.keys(this.fileCache);
  };

  P.getLinks = function () {
    const out = {};
    for (const path of Object.keys(this.metadataCache)) {
      const cache = this.metadataCache[path];
      if (!cache) continue;
      const links = [];
      if (Array.isArray(cache.links)) links.push(...cache.links);
      if (Array.isArray(cache.embeds)) links.push(...cache.embeds);
      if (links.length) out[path] = links;
    }
    return out;
  };

  P.iterateAllRefs = function (cb, sourcePath) {
    if (typeof cb !== "function") return;
    const paths = sourcePath ? [sourcePath] : Object.keys(this.metadataCache);
    for (const path of paths) {
      const cache = this.metadataCache[path];
      if (!cache) continue;
      for (const field of ["links", "embeds", "frontmatterLinks"]) {
        const list = cache[field];
        if (!Array.isArray(list)) continue;
        for (const ref of list) {
          if (cb(path, ref) === true) return;
        }
      }
    }
    for (const updater of Object.values(this.linkUpdaters)) {
      if (updater && typeof updater.iterateReferences === "function") {
        let stop = false;
        updater.iterateReferences((p, ref) => { if (cb(p, ref) === true) stop = true; return stop; });
        if (stop) return;
      }
    }
  };

  P.iterateRefsForFile = function (file, cb) {
    if (!file || typeof cb !== "function") return;
    const path = file.path || file;
    const cache = this.metadataCache[path];
    if (cache) {
      for (const field of ["links", "embeds", "frontmatterLinks"]) {
        const list = cache[field];
        if (!Array.isArray(list)) continue;
        for (const ref of list) {
          if (cb(path, ref) === true) return;
        }
      }
    }
    const updater = this.linkUpdaters[file.extension];
    if (updater && typeof updater.iterateReferencesForFile === "function") {
      updater.iterateReferencesForFile(path, (p, ref) => cb(p, ref));
    }
  };

  P.getFileInfo = function (path) {
    return this.fileCache[path] || null;
  };

  P.resolveLinks = function (path) {
    const cache = this.metadataCache[path];
    if (cache) this._indexLinks(path, cache);
    return cache;
  };

  P.queueFileForLinkResolution = function (file) {
    const path = file && file.path ? file.path : file;
    if (path) this.linkResolverQueue.add(path);
  };

  P.updateRelatedLinks = function (paths) {
    this._resolveAllQueued();
  };

  P.saveFileCache = function (path, entry) {
    if (entry) this.fileCache[path] = entry;
    return entry;
  };

  P.saveMetaCache = function (hash, meta) {
    if (hash && meta) this.metadataCache[hash] = meta;
    return meta;
  };

  P.getTags = function () {
    const counts = {};
    const spellings = {};
    const addTag = (raw, seen) => {
      const tag = "#" + String(raw || "").replace(/^#/, "").trim();
      if (!tag || tag === "#" || !tagValid(tag)) return;
      const parts = tag.split("/");
      for (let i = 1; i <= parts.length; i++) {
        const t = "#" + parts.slice(0, i).join("/");
        if (seen.has(t)) continue;
        seen.add(t);
        const key = t.toLowerCase();
        if (!spellings[key]) spellings[key] = t;
        const name = spellings[key];
        counts[name] = (counts[name] || 0) + 1;
      }
    };
    for (const path of Object.keys(this.metadataCache)) {
      const cache = this.metadataCache[path];
      if (!cache || this.isUserIgnored(path)) continue;
      const seen = new Set();
      const fm = cache.frontmatter;
      const fmTags = fm && fm.tags;
      const fmList = Array.isArray(fmTags) ? fmTags : fmTags != null ? String(fmTags).split(/[,\s]+/) : [];
      for (const t of fmList) addTag(t, seen);
      if (Array.isArray(cache.tags)) {
        for (const t of cache.tags) addTag(typeof t === "string" ? t : t && t.tag, seen);
      }
    }
    return counts;
  };

  P.getBacklinksForFile = function (file) {
    const path = typeof file === "string" ? file : file && file.path;
    const map = new Map();
    for (const src of Object.keys(this.resolvedLinks)) {
      const targets = this.resolvedLinks[src];
      if (targets && targets[path] !== undefined) map.set(src, targets[path]);
    }
    return {
      count: () => { let n = 0; for (const v of map.values()) n += v; return n; },
      keys: () => map.keys(),
      values: () => map.values(),
      entries: () => map.entries(),
      get: (k) => map.get(k) || 0,
      has: (k) => map.has(k),
      size: map.size,
    };
  };

  P._shortestLinktext = function (file) {
    const path = file.path;
    const noExt = path.replace(/\.md$/i, "");
    const base = noExt.split("/").pop();
    const files = this.vault.getAllLoadedFiles ? this.vault.getAllLoadedFiles() : this.vault.getFiles();
    const mdFiles = files.filter((f) => f && this._isMdFile(f));
    const basenameCount = {};
    for (const f of mdFiles) {
      const b = f.path.replace(/\.md$/i, "").split("/").pop().toLowerCase();
      basenameCount[b] = (basenameCount[b] || 0) + 1;
    }
    if (basenameCount[base.toLowerCase()] === 1) return base;
    const parts = noExt.split("/");
    for (let i = parts.length - 1; i >= 0; i--) {
      const cand = parts.slice(i).join("/");
      let matches = 0;
      for (const f of mdFiles) {
        const fe = f.path.replace(/\.md$/i, "");
        if (fe === cand || fe.endsWith("/" + cand)) { if (++matches > 1) break; }
      }
      if (matches === 1) return cand;
    }
    return noExt;
  };

  P._relativeLinkPath = function (fromPath, toPath) {
    const fromDir = fromPath ? fromPath.split("/").slice(0, -1) : [];
    const toParts = toPath.split("/");
    let common = 0;
    while (common < fromDir.length && common < toParts.length - 1 && fromDir[common] === toParts[common]) common++;
    const ups = fromDir.length - common;
    const rest = toParts.slice(common);
    const rel = (ups ? Array(ups).fill("..").concat(rest) : rest).join("/");
    return rel || toPath;
  };

  // Third argument selects the link flavour: truthy -> wikilink text (no ".md"),
  // falsy -> markdown destination (keeps ".md"). Path shape follows vault newLinkFormat.
  P.fileToLinktext = function (file, sourcePath, useWikiLinktext) {
    if (!file || !file.path) return "";
    if (file.extension !== "md") return file.path;
    const format = this.vault.getConfig ? this.vault.getConfig("newLinkFormat") : "shortest";
    const srcPath = typeof sourcePath === "string" ? sourcePath : sourcePath && sourcePath.path;
    let link;
    if (format === "absolute") {
      link = file.path.replace(/\.md$/i, "");
    } else if (format === "relative" && srcPath) {
      link = this._relativeLinkPath(srcPath, file.path.replace(/\.md$/i, ""));
    } else {
      link = this._shortestLinktext(file);
    }
    return useWikiLinktext ? link : link + ".md";
  };

  // -------------------------------------------------------- suggestions ----

  P.getLinkSuggestions = function () {
    const out = [];
    const seen = new Set();
    const files = this.vault.getAllLoadedFiles ? this.vault.getAllLoadedFiles() : this.vault.getFiles();
    for (const f of files) {
      if (!this._isMdFile(f)) continue;
      const linktext = this._shortestLinktext(f);
      const key = "f:" + f.path;
      if (!seen.has(key)) { seen.add(key); out.push({ type: "file", path: linktext, file: f }); }
      const cache = this.getFileCache(f);
      const aliases = ng22FrontmatterAliases(cache && cache.frontmatter);
      if (aliases) {
        for (const alias of aliases) {
          const ak = "a:" + f.path + "|" + alias;
          if (seen.has(ak)) continue;
          seen.add(ak);
          out.push({ type: "alias", path: linktext, alias, file: f });
        }
      }
    }
    for (const src of Object.keys(this.unresolvedLinks)) {
      for (const linktext of Object.keys(this.unresolvedLinks[src])) {
        const k = "l:" + linktext;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ type: "linktext", linktext });
      }
    }
    return out;
  };

  P.getAllPropertyInfos = function () {
    const infos = {};
    for (const path of Object.keys(this.metadataCache)) {
      const fm = this.metadataCache[path] && this.metadataCache[path].frontmatter;
      if (!fm || typeof fm !== "object") continue;
      for (const key of Object.keys(fm)) {
        const e = infos[key] || (infos[key] = { name: key, widget: "text", occurrences: 0 });
        e.occurrences++;
      }
    }
    return infos;
  };

  P.getFrontmatterPropertyValuesForKey = function (key) {
    const values = new Set();
    for (const path of Object.keys(this.metadataCache)) {
      const fm = this.metadataCache[path] && this.metadataCache[path].frontmatter;
      if (!fm || fm[key] === undefined) continue;
      const v = fm[key];
      const list = Array.isArray(v) ? v : [v];
      for (const item of list) values.add(String(item));
    }
    return Array.from(values);
  };

  // ---------------------------------------------------------- updates ----

  // `changes`: RefMultimap/Map sourcePath -> [{sourcePath, reference, change}]
  P.updateInternalLinks = async function (changes) {
    const jobs = [];
    const iterate = (key, list) => {
      const file = this.vault.getAbstractFileByPath(key);
      if (!file) return;
      if (file.extension === "md") {
        jobs.push(this.vault.process(file, (content) => applyLinkUpdates(content, list || [])));
      } else {
        const updater = this.linkUpdaters[file.extension];
        if (updater && typeof updater.applyUpdates === "function") {
          jobs.push(Promise.resolve(updater.applyUpdates(file, list || [])));
        }
      }
    };
    if (changes && typeof changes.keys === "function") {
      for (const key of changes.keys()) iterate(key, changes.get(key));
    } else if (changes instanceof Map) {
      for (const [key, list] of changes) iterate(key, list);
    }
    if (jobs.length) await Promise.all(jobs);
    this.trigger("resolve");
    this.trigger("resolved");
  };

  P.isCacheClean = function () {
    return this.inProgressTaskCount === 0 && this.workerQueue.length === 0 && this._fileTasks.size === 0;
  };

  P.onCleanCache = function (cb) {
    if (this.isCacheClean()) { setTimeout(cb, 0); return; }
    this._cleanWaiters.push(cb);
  };

  P._checkClean = function () {
    if (!this.isCacheClean()) return;
    if (!this.initialized) {
      // first clean pass after initialize(): consider indexing finished
    }
    if (this._cleanWaiters.length) {
      const waiters = this._cleanWaiters.splice(0);
      for (const cb of waiters) setTimeout(cb, 0);
    }
    this.trigger("clean-cache");
  };

  P.triggerFinished = function () {
    this.initialized = true;
    this._rebuildUniqueLookup();
    this._resolveAllQueued();
    this.trigger("finished");
    this._checkClean();
  };

  // schedule the "finished" event once the initial scan drains
  P._armFinished = function () {
    const tick = () => {
      if (this.isCacheClean()) { this.triggerFinished(); return; }
      setTimeout(tick, 250);
    };
    setTimeout(tick, 250);
  };

  // ---------------------------------------------------------- misc API ----

  P.clear = async function () {
    this.fileCache = {};
    this.metadataCache = {};
    this.resolvedLinks = {};
    this.unresolvedLinks = {};
    this.uniqueFileLookup = {};
    this.blockCache.clear();
    if (this.db) await idbClear(this.db).catch(() => {});
    this._idbRows = null;
    const files = this.vault.getAllLoadedFiles ? this.vault.getAllLoadedFiles() : this.vault.getFiles();
    for (const file of files) {
      if (file && file.path && !file.children) this.computeFileMetadataAsync(file);
    }
    this._armFinished();
  };

  P.checkCleanCache = function () { this._checkClean(); };

  P.showIndexingNotice = function () {
    try {
      new host.Notice(host.t.interface.indexing ? host.t.interface.indexing() : "Indexing...");
    } catch (e) {}
  };

  P.cleanupDeletedCache = function () {
    const alive = new Set();
    const files = this.vault.getAllLoadedFiles ? this.vault.getAllLoadedFiles() : this.vault.getFiles();
    for (const f of files) if (f && f.path) alive.add(f.path);
    for (const p of Object.keys(this.fileCache)) {
      if (!alive.has(p)) this.deletePath(p);
    }
  };

  P.deletePath = function (path) {
    delete this.fileCache[path];
    delete this.metadataCache[path];
    delete this.resolvedLinks[path];
    delete this.unresolvedLinks[path];
    this._removeFromUniqueLookup(path);
    if (this.db) idbDelete(this.db, path).catch(() => {});
  };

  // Worker entry points kept for protocol compatibility; the cache drives the
  // worker itself through _workerParse, these accept the same message shapes.
  P.computeMetadataAsync = function (payload) {
    const buffer = payload && (payload.metadataCache || payload.buffer || payload);
    return this._workerParse(buffer);
  };
  P.work = function (payload) {
    if (this._workActive) throw new Error("Work queue must be sequential!");
    this._workActive = true;
    return Promise.resolve(this.computeMetadataAsync(payload)).finally(() => { this._workActive = false; });
  };
  P.onReceiveMessageFromWorker = function (event) {
    const data = event && event.data !== undefined ? event.data : event;
    if (this.workerResolve) {
      const r = this.workerResolve;
      this.workerResolve = null;
      r(data);
    }
  };
}

export { ng22ParseLinktext, ng22FrontmatterAliases, applyLinkUpdates, deserializeMetadata, collectTags, anyMetadataRef, anyRefMatch, forEachLinkField, linkPosToPos, positionToArray, positionFromArray, linkPosFromArray, escapeRegExp, tagValid, isOutdatedMetadata, sharesLinkTarget, linkCacheKey, contentHash, batchedAsync, idleOrTimeout, iterateIdbBatches, Runnable, Deque, RefMultimap, SerialTaskQueue, LinkQueue, BlockCache };
