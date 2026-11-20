// g25 clean-room s04-mobile-adapter: CapacitorAdapter — mobile (Capacitor) DataAdapter
// over the filesystem plugin bridge. Spec: F:\orch\specs\g25.md Part K.
// files = vault-relative path -> {type:"file"|"folder", realpath, ctime?, mtime?, size?};
// mutations serialised through a promise queue; watch events reconcile create/modify/delete.

import { env } from "./env.js";
import { lastSegment, isHiddenPath, normalizePath, collapseSlashes, baseName, withoutExtension, extensionOf, joinNameExt, parentPath } from "./path.js";
import { statFromCapacitor } from "./n-g25-misc.js";

const NG25AD_TRASH_RETRY = 100;

export function s04CapacitorAdapter(host) {
  void host;

  class CapacitorAdapter {
    constructor(basePath, fs) {
      this.fs = fs;
      this.basePath = basePath;
      this.files = {};
      this.promise = null;
      this.handler = null;
      this.insensitive = false;
      this._dmHandler = null;
    }

    testInsensitive() {}

    // Serial promise chain; a failing op must not break the chain.
    queue(fn) {
      const run = () => Promise.resolve().then(fn);
      const p = (this.promise || Promise.resolve()).then(run, run);
      this.promise = p.then(() => {}, () => {});
      return p;
    }

    trigger(event, path, oldPath, stat) {
      if (this.handler) this.handler(event, path, oldPath, stat);
    }

    // ---- path mapping ----

    getName() { return lastSegment(this.basePath); }

    // Deepest registered ancestor's realpath + the remaining suffix.
    getRealPath(path) {
      let p = collapseSlashes(path);
      if (p === "/") return "/";
      p = p.replace(/^\/+/, "");
      if (!p) return "/";
      const parts = p.split("/");
      for (let i = parts.length; i >= 0; i--) {
        const cand = i === 0 ? "/" : parts.slice(0, i).join("/");
        const e = this.files[cand];
        if (e) {
          const base = e.realpath === "/" ? "" : String(e.realpath).replace(/^\/+|\/+$/g, "");
          const tail = parts.slice(i).join("/");
          return [base, tail].filter((s) => s).join("/") || "/";
        }
      }
      return p;
    }

    getFullRealPath(p) { return collapseSlashes(this.basePath + "/" + p); }
    getFullPath(path) { return this.getFullRealPath(this.getRealPath(path)); }

    // ---- listing / watch ----

    watchAndList() {
      return this.queue(() => this._watchAndList());
    }

    async _watchAndList() {
      this.files = { "/": { type: "folder", realpath: "/" } };
      try {
        const res = await this.fs.watchAndStatAll(this.basePath);
        const children = res && res.children ? res.children : [];
        for (const child of children) await this.quickList(child);
      } catch (e) {
        console.error("Failed to run quick list");
        try { await this.fs.watch(this.basePath); } catch (e2) {}
        await this._listRecursive("");
      }
    }

    // Register one entry reported by watchAndStatAll / readdir.
    async quickList(child) {
      const name = child && child.name;
      if (!name) return;
      const norm = normalizePath(name);
      if (norm === "/" || !norm) return;
      this.trigger("raw", norm);
      if (isHiddenPath(norm)) {
        if (this.files[norm]) await this.reconcileDeletion(this.getRealPath(norm), norm, true);
        return;
      }
      const type = child.type === "directory" || child.type === "folder" ? "folder" : "file";
      if (type === "file") {
        if (this.files[norm]) { await this.reconcileFileChanged(this.getRealPath(norm), norm); return; }
        await this.reconcileFileCreation(this.getRealPath(norm), norm, child);
        return;
      }
      await this.reconcileFolderCreation(this.getRealPath(norm), norm, null, false);
    }

    listRecursive(path) {
      return this.queue(() => this._listRecursive(path));
    }

    async _listRecursive(path) {
      const norm = normalizePath(path || "");
      const full = norm === "/" || norm === "" ? this.basePath : this.getFullPath(norm);
      let entries;
      try { entries = await this.fs.readdir(full); } catch (e) { return; }
      for (const child of entries || []) {
        const name = child && child.name;
        if (!name) continue;
        const childPath = norm === "/" || norm === "" ? normalizePath(name) : normalizePath(norm + "/" + name);
        if (isHiddenPath(childPath)) continue;
        const type = child.type === "directory" || child.type === "folder" ? "folder" : "file";
        this.trigger("raw", childPath);
        if (type === "file") {
          if (!this.files[childPath]) await this.reconcileFileCreation(this.getRealPath(childPath), childPath, child);
        } else {
          if (!this.files[childPath]) {
            this.files[childPath] = { type: "folder", realpath: this.getRealPath(childPath) };
            this.trigger("folder-created", childPath);
          }
          await this._listRecursive(childPath);
        }
      }
    }

    // ---- mutations (all queued) ----

    mkdir(path) {
      return this.queue(async () => {
        const norm = normalizePath(path);
        try { await this.fs.mkdir(this.getFullPath(norm)); }
        catch (e) { if (!/Directory exists/.test(String(e && e.message || e))) throw e; }
        await this.reconcileInternalFile(norm);
      });
    }

    trashSystem(path) {
      return this.queue(async () => {
        const norm = normalizePath(path);
        try {
          await this.fs.trash(this.getFullPath(norm));
          await this.reconcileFile(this.getRealPath(norm), norm, true);
          return true;
        } catch (e) { return false; }
      });
    }

    trashLocal(path) {
      return this.queue(async () => {
        const norm = normalizePath(path);
        const trashDir = ".trash";
        try { await this.fs.mkdir(this.getFullPath(trashDir)); } catch (e) {}
        const stem = baseName(norm);
        const ext = extensionOf(norm);
        let candidate = joinNameExt(stem, ext);
        for (let n = 2; ; n++) {
          const rel = trashDir + "/" + candidate;
          let taken = false;
          try { await this.fs.stat(this.getFullPath(rel)); taken = true; } catch (e) {}
          if (!taken) break;
          candidate = joinNameExt(stem + " " + n, ext);
        }
        const target = trashDir + "/" + candidate;
        await this.fs.rename(this.getFullPath(norm), this.getFullPath(target));
        await this.reconcileFile(this.getRealPath(target), target, true);
      });
    }

    rmdir(path) {
      return this.queue(async () => {
        const norm = normalizePath(path);
        const fn = this.fs.rmdir || this.fs.delete;
        await fn.call(this.fs, this.getFullPath(norm));
        await this.reconcileFile(this.getRealPath(norm), norm, true);
      });
    }

    remove(path) {
      return this.queue(async () => {
        const norm = normalizePath(path);
        await this.fs.delete(this.getFullPath(norm));
        await this.reconcileFile(this.getRealPath(norm), norm, true);
      });
    }

    update(path) {
      return this.queue(() => this.reconcileInternalFile(path));
    }

    // ---- content ops ----

    read(path) {
      return this.queue(async () => {
        const norm = normalizePath(path);
        try { return await this.fs.read(this.getFullPath(norm)); }
        catch (e) { this._scheduleReconcile(norm); throw e; }
      });
    }

    readBinary(path) {
      return this.queue(async () => {
        const norm = normalizePath(path);
        try { return await this.fs.readBinary(this.getFullPath(norm)); }
        catch (e) { this._scheduleReconcile(norm); throw e; }
      });
    }

    _scheduleReconcile(norm) {
      setTimeout(() => { this.reconcileInternalFile(norm).catch(() => {}); }, 0);
    }

    async _readRaw(norm) {
      return this.fs.read(this.getFullPath(norm));
    }

    async _readBinaryRaw(norm) {
      return this.fs.readBinary(this.getFullPath(norm));
    }

    async _writeRaw(norm, data, options, op) {
      const full = this.getFullPath(norm);
      try {
        if (op === "writeBinary") await this.fs.writeBinary(full, data);
        else if (op === "append") await this.fs.append(full, data);
        else if (op === "appendBinary") await this.fs.appendBinary(full, data);
        else await this.fs.write(full, data);
        if (options && (options.ctime || options.mtime)) {
          await this.fs.setTimes(full, options.ctime, options.mtime);
        }
        if (options && options.immediate) options.immediate();
      } catch (e) {
        await this.reconcileInternalFile(norm).catch(() => {});
        throw e;
      }
    }

    write(path, data, options) { return this.queue(() => this._writeRaw(normalizePath(path), data, options, "write")); }
    writeBinary(path, data, options) { return this.queue(() => this._writeRaw(normalizePath(path), data, options, "writeBinary")); }
    append(path, data, options) { return this.queue(() => this._writeRaw(normalizePath(path), data, options, "append")); }
    appendBinary(path, data, options) { return this.queue(() => this._writeRaw(normalizePath(path), data, options, "appendBinary")); }

    process(path, fn, options) {
      return this.queue(async () => {
        const norm = normalizePath(path);
        try {
          const contents = await this._readRaw(norm);
          const next = await fn(contents);
          if (next === contents) return contents;
          await this._writeRaw(norm, next, options, "write");
          return next;
        } catch (e) {
          await this.reconcileInternalFile(norm).catch(() => {});
          throw e;
        }
      });
    }

    getResourcePath(path) { return this.fs.getUri(this.getFullPath(path)); }
    getNativePath(path) { return this.fs.getNativeUri(this.getFullPath(path)); }
    open(path) { return this.fs.open(this.getFullPath(path)); }

    exists(path, strict) {
      return this.queue(async () => {
        const norm = normalizePath(path);
        try { await this.fs.stat(this.getFullPath(norm)); return true; }
        catch (e) {
          if (strict && this.insensitive) {
            const parent = parentPath(norm);
            try {
              const entries = await this.fs.readdir(this.getFullPath(parent || "/"));
              const want = normalizePath(lastSegment(norm));
              return (entries || []).some((en) => en && normalizePath(en.name) === want);
            } catch (e2) { return false; }
          }
          return false;
        }
      });
    }

    stat(path) {
      return this.queue(async () => {
        const norm = normalizePath(path);
        let st;
        try { st = await this.fs.stat(this.getFullPath(norm)); }
        catch (e) {
          if (e && (e.code === "ENOENT" || /ENOENT/.test(String(e && e.message || e)))) return null;
          throw e;
        }
        const info = statFromCapacitor(st);
        info.type = st.type === "directory" || st.type === "folder" ? "folder" : "file";
        return info;
      });
    }

    list(prefix) {
      return this.queue(() => {
        const pre = normalizePath(prefix || "");
        const folders = new Set(), filesOut = new Set();
        for (const key of Object.keys(this.files)) {
          if (key === "/") continue;
          if (pre && !(key === pre || key.startsWith(pre + "/"))) continue;
          const rel = pre ? key.slice(pre.length).replace(/^\/+/, "") : key;
          if (!rel) continue;
          const first = rel.split("/")[0];
          if (rel.includes("/")) { folders.add(first); continue; }
          const e = this.files[key];
          if (e && e.type === "folder") folders.add(first); else filesOut.add(first);
        }
        return { folders: [...folders].sort(), files: [...filesOut].sort() };
      });
    }

    // ---- watch ----

    async stopWatch() {
      try {
        const Dm = env().Dm;
        if (Dm && Dm.stopWatch) await Dm.stopWatch();
      } catch (e) {}
    }

    watch(handler) {
      return this.queue(async () => {
        await this.stopWatch();
        this.handler = handler;
        try {
          const Dm = env().Dm;
          if (Dm && Dm.addListener) {
            this._dmHandler = await Dm.addListener("change", (event) => {
              const p = event && event.path;
              if (typeof p !== "string") return;
              const rel = p.startsWith(this.basePath) ? p.slice(this.basePath.length) : p;
              this.onFileChange(rel);
            });
          }
        } catch (e) {}
        await this._watchAndList();
      });
    }

    onFileChange(path) {
      setTimeout(() => {
        const norm = normalizePath(String(path || "").replace(/^\/+/, ""));
        if (!norm || norm === "/") return;
        this.queue(() => this.reconcileFile(this.getRealPath(norm), norm, false));
      }, 0);
    }

    // ---- reconcile ----

    async reconcileInternalFile(path) {
      const norm = normalizePath(path || "");
      if (!norm || norm === "/") return;
      let st;
      try { st = await this.fs.stat(this.getFullPath(norm)); }
      catch (e) {
        if (e && (e.code === "ENOENT" || /ENOENT/.test(String(e && e.message || e)))) {
          if (this.files[norm]) await this.reconcileDeletion(this.getRealPath(norm), norm, true);
        }
        return;
      }
      const isDir = st.type === "directory" || st.type === "folder";
      const real = this.getRealPath(norm);
      if (isDir) {
        if (!this.files[norm]) {
          this.files[norm] = { type: "folder", realpath: real };
          this.trigger("folder-created", norm, norm, this.files[norm]);
        } else {
          this.files[norm].realpath = real;
        }
        return;
      }
      const info = statFromCapacitor(st);
      const prev = this.files[norm];
      if (!prev) {
        this.files[norm] = { type: "file", realpath: real, ctime: info.ctime, mtime: info.mtime, size: info.size };
        this.trigger("file-created", norm, norm, this.files[norm]);
      } else if (prev.type !== "file" || prev.mtime !== info.mtime || prev.size !== info.size) {
        prev.type = "file"; prev.realpath = real;
        prev.ctime = info.ctime; prev.mtime = info.mtime; prev.size = info.size;
        this.trigger("modified", norm, norm, { type: "file", realpath: real, ctime: info.ctime, mtime: info.mtime, size: info.size });
      } else {
        prev.realpath = real;
      }
    }

    async reconcileFile(realPath, path, remove = true) {
      const norm = normalizePath(path);
      this.trigger("raw", norm);
      if (isHiddenPath(norm)) { await this.reconcileDeletion(realPath, norm, remove); return; }
      const parent = parentPath(norm);
      if (parent && parent !== "/" && !this.files[parent]) {
        await this.reconcileFile(this.getRealPath(parent), parent, remove);
      }
      if (this.insensitive && parent && parent !== "/") {
        try {
          const entries = await this.fs.readdir(this.getFullPath(parent));
          const want = normalizePath(lastSegment(norm));
          const found = (entries || []).some((en) => en && normalizePath(en.name) === want);
          if (!found) { await this.reconcileDeletion(realPath, norm, remove); return; }
        } catch (e) { await this.reconcileDeletion(realPath, norm, remove); return; }
      }
      let st;
      try { st = await this.fs.stat(this.getFullPath(norm)); }
      catch (e) {
        if (e && (e.code === "ENOENT" || /ENOENT/.test(String(e && e.message || e)))) {
          await this.reconcileDeletion(realPath, norm, remove);
        } else {
          console.error(e);
        }
        return;
      }
      const isDir = st.type === "directory" || st.type === "folder";
      if (isDir) await this.reconcileFolderCreation(realPath, norm, st);
      else await this.reconcileFileChanged(realPath, norm, st);
    }

    async reconcileFileChanged(realPath, path, st) {
      const norm = normalizePath(path);
      const prev = this.files[norm];
      const real = realPath || this.getRealPath(norm);
      if (!prev) { await this.reconcileFileCreation(real, norm, st); return; }
      prev.realpath = real;
      if (prev.type === "file" && st) {
        const info = statFromCapacitor(st);
        if (prev.mtime !== info.mtime || prev.size !== info.size) {
          prev.ctime = info.ctime; prev.mtime = info.mtime; prev.size = info.size;
          this.trigger("modified", norm, norm, { type: "file", realpath: real, ctime: info.ctime, mtime: info.mtime, size: info.size });
        }
      }
    }

    async reconcileFileCreation(realPath, path, info) {
      const norm = normalizePath(path);
      const real = realPath || this.getRealPath(norm);
      let entry;
      if (info && (info.type === "directory" || info.type === "folder")) {
        entry = { type: "folder", realpath: real };
      } else {
        const ctime = Math.round(info && info.ctime != null ? info.ctime : (info && info.birthtime != null ? info.birthtime : 0));
        const mtime = Math.round(info && info.mtime != null ? info.mtime : 0);
        const size = info && info.size != null ? info.size : 0;
        entry = { type: "file", realpath: real, ctime, mtime, size };
      }
      this.files[norm] = entry;
      this.trigger(entry.type === "folder" ? "folder-created" : "file-created", norm, norm, entry);
    }

    async reconcileFolderCreation(realPath, path, info, recurse = true) {
      const norm = normalizePath(path);
      const real = realPath || this.getRealPath(norm);
      const prev = this.files[norm];
      if (!prev) {
        this.files[norm] = { type: "folder", realpath: real };
        this.trigger("folder-created", norm, norm, this.files[norm]);
        if (recurse) await this._listRecursive(norm);
        return;
      }
      prev.realpath = real;
    }

    async reconcileDeletion(realPath, path, remove = true) {
      const norm = normalizePath(path);
      if (norm === "/") { this.trigger("closed", norm); return; }
      if (!remove) {
        setTimeout(() => { this.reconcileDeletion(realPath, norm, true).catch(() => {}); }, NG25AD_TRASH_RETRY);
        return;
      }
      const e = this.files[norm];
      if (e && e.type === "folder") {
        for (const k of Object.keys(this.files)) {
          if (k !== norm && k.startsWith(norm + "/")) {
            await this.removeFile(k, this.files[k] && this.files[k].type === "folder");
          }
        }
      }
      await this.removeFile(norm, e ? e.type === "folder" : false);
    }

    async removeFile(path, isFolder) {
      const norm = normalizePath(path);
      delete this.files[norm];
      this.trigger(isFolder ? "folder-removed" : "file-removed", norm);
    }

    // ---- move / copy ----

    rename(oldPath, newPath) {
      return this.queue(async () => {
        const o = normalizePath(oldPath);
        const n = normalizePath(newPath);
        if (o === n) return;
        let destExists = false;
        try { await this.fs.stat(this.getFullPath(n)); destExists = true; } catch (e) {}
        if (destExists && (!this.insensitive || o.toLowerCase() !== n.toLowerCase())) {
          throw new Error("Destination file already exists!");
        }
        const entry = this.files[o];
        if (entry) {
          this.files[n] = { ...entry, realpath: this.getRealPath(n) };
          delete this.files[o];
        }
        this.trigger("renamed", n, o);
        if (entry && entry.type === "folder") {
          for (const k of Object.keys(this.files)) {
            if (k !== n && k.startsWith(o + "/")) {
              const nk = n + k.slice(o.length);
              const e2 = this.files[k];
              this.files[nk] = { ...e2, realpath: this.getRealPath(nk) };
              delete this.files[k];
              this.trigger("renamed", nk, k);
            }
          }
        }
      });
    }

    copy(oldPath, newPath) {
      return this.queue(async () => {
        const o = normalizePath(oldPath);
        const n = normalizePath(newPath);
        await this.fs.copy(this.getFullPath(o), this.getFullPath(n));
        await this.reconcileInternalFile(n);
      });
    }
  }

  return CapacitorAdapter;
}
