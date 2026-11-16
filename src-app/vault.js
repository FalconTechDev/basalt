// The vault model: files and folders (TAbstractFile / TFile / TFolder), the Vault, the desktop FileSystemAdapter and the
// file-manager methods that create and rename files.
//
// Plugins see these classes through the `obsidian` module, so every public method name, argument list, event name and return
// shape stays as it was. The classes are written as ES5-style constructors (function + prototype) on purpose: plugins compiled to
// ES5 subclass them with `Base.call(this, ...)`, which a `class` would refuse.
//
// What the host has to provide (things that live in the application scope, not here) arrives through `bindEnv`:
//   Yl (platform info), If (lazy `require`), UT (regex of characters forbidden in names), KT (path check that throws),
//   AC (names of appearance settings), PC (default settings), debounce, gm (translations), GT (valid name?), qT (list of forbidden
//   characters for messages), vb (promise queue class). They are read lazily, at call time.
import { lastSegment, parentPath, isHiddenPath, baseName, withoutExtension, extensionOf, joinNameExt, collapseSlashes, plainSpaces, normalizePath, linkPath } from "./path.js";
import { linkSafeHeading } from "./text.js";
import { ownBuffer, statFromNode } from "./misc.js";
import { env } from "./env.js";

const vaultEnv = env;

const vaultHas = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const CONTROL_CHARS = /[\x00-\x1F]/g;
// "a name that already ends in a dot and 1-10 letters/digits": the user typed an extension, keep it (Basalt patch; the dot is not escaped on purpose)
const EXPLICIT_EXTENSION = /.[A-Za-z][A-Za-z0-9]{0,9}$/;
const DEFAULT_CONFIG_DIR = ".basalt";
const UTF8_BOM = 0xfeff;

/** ES5-style inheritance: child.prototype -> base.prototype, statics copied through the constructor chain. */
function vaultInherit(child, base) {
  Object.setPrototypeOf(child, base);
  child.prototype = Object.create(base.prototype, { constructor: { value: child, writable: true, configurable: true } });
}

/** Array.prototype.remove of the app: drops every occurrence. */
function vaultRemoveAll(list, item) {
  for (let i = list.length - 1; i >= 0; i--) if (list[i] === item) list.splice(i, 1);
}

// =====================================================================================================================
// Files and folders
// =====================================================================================================================

// Text cache of files, kept outside the file objects so that plugins never see it.
const textCache = new WeakMap();

// For Vault.getAbstractFileByPathInsensitive: lower-cased path -> path, per vault; dropped when the vault's fileMap changes.
const lowerPathIndex = new WeakMap();

let fileModel = null;
function buildFileModel() {
  function TAbstractFile(vault, path) {
    this.parent = null;
    this.deleted = false;
    this.vault = vault;
    this.setPath(path);
  }
  TAbstractFile.prototype.setPath = function (path) {
    this.path = path;
    this.name = lastSegment(path);
  };
  /** The path this item would get if it were renamed to `name` inside its current folder ("" for the root). */
  TAbstractFile.prototype.getNewPathAfterRename = function (name) {
    name = name.replace(CONTROL_CHARS, " ").trim();
    if (!this.parent) return "";
    return this.parent.isRoot() ? name : this.parent.path + "/" + name;
  };

  function TFile(vault, path) {
    TAbstractFile.call(this, vault, path);
    this.saving = false;
    this.stat = null;
  }
  vaultInherit(TFile, TAbstractFile);
  TFile.prototype.setPath = function (path) {
    TAbstractFile.prototype.setPath.call(this, path);
    this.basename = baseName(this.name);
    this.extension = extensionOf(this.name);
  };
  TFile.prototype.getShortName = function () {
    return this.extension === "md" ? this.basename : this.name;
  };
  // Renaming to a name that carries an explicit extension keeps it; otherwise the file keeps its own extension.
  TFile.prototype.getNewPathAfterRename = function (name) {
    const withExtension = EXPLICIT_EXTENSION.test(name.trim()) ? name : joinNameExt(name, this.extension);
    return TAbstractFile.prototype.getNewPathAfterRename.call(this, withExtension);
  };
  /** Remembers the text of the file (when it is small enough for the vault's cache limit); null/undefined forgets it. */
  TFile.prototype.cache = function (text) {
    if (text != null && text.length <= this.vault.cacheLimit) textCache.set(this, text);
    else textCache.delete(this);
  };
  TFile.prototype.updateCacheLimit = function () {
    const cached = textCache.get(this);
    if (cached !== undefined && cached.length > this.vault.cacheLimit) textCache.delete(this);
  };
  TFile.prototype.toString = function () {
    return this.path;
  };

  function TFolder(vault, path) {
    TAbstractFile.call(this, vault, path);
    this.children = [];
  }
  vaultInherit(TFolder, TAbstractFile);
  TFolder.prototype.isRoot = function () {
    return this.path === "/";
  };
  TFolder.prototype.getParentPrefix = function () {
    return this.isRoot() ? "" : this.path + "/";
  };
  TFolder.prototype.getFileCount = function () {
    let count = 0;
    for (const child of this.children) count += child instanceof TFolder ? child.getFileCount() : 1;
    return count;
  };
  TFolder.prototype.getFolderCount = function () {
    let count = 0;
    for (const child of this.children) if (child instanceof TFolder) count += 1 + child.getFolderCount();
    return count;
  };
  return { TAbstractFile, TFile, TFolder };
}

/** "TAbstractFile" | "TFile" | "TFolder": the three classes are created once and handed out by name. */
export function fileClass(name) {
  if (!fileModel) fileModel = buildFileModel();
  return fileModel[name];
}

// =====================================================================================================================
// The desktop file-system adapter
// =====================================================================================================================

/**
 * Builds the FileSystemAdapter class. It owns the real directory, keeps `files` (what the adapter has told the vault so far,
 * path -> { type, realpath, ctime, mtime, size }) and watches the disk. Every disk operation goes through one queue, so they run
 * one after another; a queue step that hangs for a minute is cancelled.
 *
 * Events handed to the watch handler: "file-created", "folder-created", "modified", "file-removed", "folder-removed",
 * "renamed", "raw", "closed".
 */
export function createFileSystemAdapter() {
  const platform = (typeof window !== "undefined" && window.process && window.process.platform) || "";
  const isMac = platform === "darwin";
  const isWin = platform === "win32";
  // the platforms whose fs.watch can watch a whole tree with one watcher
  const recursiveWatch = isMac || isWin;

  function FileSystemAdapter(basePath) {
    this.thingsHappening = vaultEnv().debounce(this.kill.bind(this), 60000, true);
    this.basePath = basePath;
    this.fs = window.require("original-fs");
    this.fsPromises = this.fs.promises;
    this.path = window.require("path");
    this.url = window.require("url");
    const electron = window.require("electron");
    this.ipcRenderer = electron.ipcRenderer;
    this.files = {};
    this.promise = Promise.resolve();
    this.watcher = null;
    this.watchers = {};
    this.handler = null;
    try {
      this.btime = window.require("btime");
    } catch (e) { /* optional module */ }
    this.insensitive = isMac || isWin;
    try {
      this.testInsensitive();
    } catch (e) {
      console.error(e);
    }
  }

  const methods = {
    /** Finds out whether the vault's disk ignores case by creating a file and looking for it under another case. */
    testInsensitive() {
      const { fs, path, basePath } = this;
      const probe = path.join(basePath, ".BASALTTEST");
      const lowerProbe = path.join(basePath, ".BASALTTEST".toLowerCase());
      if (fs.existsSync(probe)) fs.unlinkSync(probe);
      fs.writeFileSync(probe, "", "utf8");
      this.insensitive = fs.existsSync(lowerProbe);
      fs.unlinkSync(probe);
    },
    getName() {
      return this.path.basename(this.basePath);
    },
    getBasePath() {
      return this.basePath;
    },

    // ---- the queue ----
    /** Runs `task` after everything queued before it; resolves with its result. */
    queue(task) {
      const step = () => {
        const killed = new Promise((_, reject) => { this.killLastAction = reject; });
        this.thingsHappening();
        return Promise.race([killed, task()]);
      };
      const result = this.promise.then(step, step);
      this.promise = result;
      return result;
    },
    /** Called when nothing has finished for a minute: the running step fails with a timeout error. */
    kill() {
      if (this.killLastAction) {
        this.killLastAction(new Error("File system operation timed out."));
        this.killLastAction = null;
      }
    },

    // ---- path mapping (a symlinked folder keeps the path the vault knows under another real path) ----
    getRealPath(path) {
      for (let probe = path; probe; probe = parentPath(probe)) {
        if (vaultHas(this.files, probe)) return this.files[probe].realpath + path.substr(probe.length);
      }
      return path;
    },
    getFullPath(path) {
      return this.getFullRealPath(this.getRealPath(path));
    },
    getFullRealPath(realPath) {
      return this.path.join(this.basePath, realPath);
    },
    getResourcePath(path) {
      const full = this.getFullPath(path);
      let stamp = 0;
      const known = this.files[path];
      if (known && known.type === "file") stamp = known.mtime;
      if (!stamp) stamp = Date.now();
      let href = this.url.pathToFileURL(full).href;
      if (href.startsWith("file:///")) href = href.substring(8);
      else if (href.startsWith("file://")) href = "%5C%5C" + href.substring(7);
      return vaultEnv().Yl.resourcePathPrefix + href + "?" + stamp;
    },
    getFilePath(path) {
      return window.require("url").pathToFileURL(this.getFullPath(path)).toString();
    },

    // ---- reading and writing ----
    read(path) {
      return this.queue(async () => {
        const full = this.getFullPath(path);
        try {
          // not awaited, as before: a failing read is not turned into a rescan
          return this.fsPromises.readFile(full, "utf8");
        } catch (error) {
          this.queue(() => this.reconcileInternalFile(path));
          throw error;
        }
      });
    },
    readBinary(path) {
      return this.queue(async () => {
        const full = this.getFullPath(path);
        try {
          return ownBuffer(await this.fsPromises.readFile(full));
        } catch (error) {
          this.queue(() => this.reconcileInternalFile(path));
          throw error;
        }
      });
    },
    write(path, data, options) {
      return this.queue(() => this.changeFile(path, options, (full) => this.fsPromises.writeFile(full, data, "utf8")));
    },
    writeBinary(path, data, options) {
      return this.queue(() => {
        const bytes = Buffer.from(data);
        return this.changeFile(path, options, (full) => this.fsPromises.writeFile(full, bytes));
      });
    },
    append(path, data, options) {
      return this.queue(() => this.changeFile(path, options, (full) => this.fsPromises.appendFile(full, data, "utf8")));
    },
    appendBinary(path, data, options) {
      return this.queue(() => {
        const bytes = Buffer.from(data);
        return this.changeFile(path, options, (full) => this.fsPromises.appendFile(full, bytes));
      });
    },
    /** Shared by the four writers: do the disk work, apply ctime/mtime/immediate, and always tell the vault about the result. */
    async changeFile(path, options, doWrite) {
      const full = this.getFullPath(path);
      try {
        await doWrite(full);
        await this.applyWriteOptions(full, options);
      } finally {
        await this.reconcileInternalFile(path);
      }
    },
    process(path, transform, options) {
      return this.queue(async () => {
        const full = this.getFullPath(path);
        const before = await this.fsPromises.readFile(full, "utf8");
        const after = transform(before);
        if (after === before) return before;
        try {
          await this.fsPromises.writeFile(full, after, "utf8");
          await this.applyWriteOptions(full, options);
        } finally {
          await this.reconcileInternalFile(path);
        }
        return after;
      });
    },
    async applyWriteOptions(fullPath, options) {
      if (!options) return;
      const { ctime, mtime, immediate } = options;
      if (ctime && this.btime) this.btime.btime(fullPath, ctime);
      if (mtime) await this.fsPromises.utimes(fullPath, mtime / 1000, mtime / 1000);
      if (immediate) immediate();
    },

    // ---- structure ----
    mkdir(path) {
      return this.queue(async () => {
        await this.fsPromises.mkdir(this.getFullPath(path), { recursive: true });
        await this.reconcileInternalFile(path);
      });
    },
    remove(path) {
      return this.queue(async () => {
        await this.fsPromises.unlink(this.getFullPath(path));
        await this.reconcileInternalFile(path);
      });
    },
    rmdir(path, recursive) {
      return this.queue(async () => {
        const full = this.getFullPath(path);
        if (recursive) await this.fsPromises.rm(full, { maxRetries: 5, recursive });
        else await this.fsPromises.rmdir(full, { maxRetries: 5 });
        await this.reconcileInternalFile(path);
      });
    },
    /** Asks the main process to move the item to the system trash; false when that did not work. */
    trashSystem(path) {
      return this.queue(async () => {
        if (!this.ipcRenderer.sendSync("trash", this.getFullPath(path))) return false;
        await this.reconcileInternalFile(path);
        return true;
      });
    },
    /** Moves the item into the vault's own ".trash" folder under a free name ("name 2.ext", ...). */
    trashLocal(path) {
      return this.queue(async () => {
        const full = this.getFullPath(path);
        const trashDir = this.getFullPath(".trash");
        await this.fsPromises.mkdir(trashDir, { recursive: true });
        const ext = this.path.extname(full);
        const stem = this.path.basename(full, ext);
        let target = this.path.join(trashDir, stem + ext);
        let n = 1;
        while (await this._exists(target)) {
          n++;
          target = this.path.join(trashDir, stem + " " + n + ext);
        }
        await this.fsPromises.rename(full, target);
        await this.reconcileInternalFile(path);
      });
    },
    async rename(from, to) {
      if (from === to) return;
      await this.queue(async () => {
        const fullFrom = this.getFullPath(from);
        const fullTo = this.getFullPath(to);
        const taken = await this._exists(fullTo, false);
        if (taken && (!this.insensitive || from.toLowerCase() !== to.toLowerCase())) throw new Error("Destination file already exists!");
        const entry = this.files[from];
        const oldReal = entry ? entry.realpath : null;
        await this.fsPromises.rename(fullFrom, fullTo);
        if (!entry) return;
        delete this.files[from];
        const newReal = this.getRealPath(to);
        entry.realpath = newReal;
        this.files[to] = entry;
        this.trigger("renamed", to, from);
        if (entry.type === "folder" && vaultHas(this.watchers, from)) {
          this.stopWatchPath(from);
          await this.startWatchPath(to);
        }
        if (entry.type === "folder") {
          for (const key in this.files) {
            if (!vaultHas(this.files, key) || !key.startsWith(from + "/")) continue;
            const moved = to + key.slice(from.length);
            const child = this.files[key];
            delete this.files[key];
            child.realpath = newReal + child.realpath.slice(oldReal.length);
            this.files[moved] = child;
            this.trigger("renamed", moved, key);
          }
        }
      });
    },
    async copyRecursive(from, to) {
      const info = await this.fsPromises.stat(from);
      if (info.isFile()) await this.fsPromises.copyFile(from, to, this.fs.constants.COPYFILE_EXCL);
      if (info.isDirectory()) {
        await this.fsPromises.mkdir(to, { recursive: true });
        for (const name of await this.fsPromises.readdir(from)) await this.copyRecursive(this.path.join(from, name), this.path.join(to, name));
      }
    },
    async copy(from, to) {
      await this.queue(async () => {
        await this.copyRecursive(this.getFullPath(from), this.getFullPath(to));
        await this.reconcileInternalFile(to);
      });
    },
    async update(path) {
      return this.queue(() => this.reconcileInternalFile(path));
    },

    // ---- questions ----
    exists(path, caseSensitive) {
      return this.queue(() => this._exists(this.getFullPath(path), caseSensitive));
    },
    /** Does the full path exist? With `caseSensitive` on a case-insensitive disk the directory listing has to contain the exact name. */
    async _exists(fullPath, caseSensitive) {
      try {
        await this.fsPromises.access(fullPath);
      } catch (e) {
        return false;
      }
      if (caseSensitive && this.insensitive) {
        const names = await this.fsPromises.readdir(this.path.dirname(fullPath));
        if (names.indexOf(this.path.basename(fullPath)) === -1) return false;
      }
      return true;
    },
    /** { type: "file" | "folder", ctime, mtime, size } or null (missing, or neither file nor folder). */
    stat(path) {
      return this.queue(async () => {
        const full = this.getFullPath(path);
        try {
          const info = await this.fsPromises.stat(full);
          if (info.isFile()) return { type: "file", ...statFromNode(info) };
          if (info.isDirectory()) return { type: "folder", ...statFromNode(info) };
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        return null;
      });
    },
    /** { folders: [...], files: [...] }, full vault paths of the direct children. */
    list(path) {
      return this.queue(async () => {
        const names = await this.fsPromises.readdir(this.getFullPath(path));
        const result = { folders: [], files: [] };
        for (const name of names) {
          const child = collapseSlashes(path === "" ? name : path + "/" + name);
          const info = await this.fsPromises.stat(this.getFullRealPath(child));
          if (info.isFile()) result.files.push(normalizePath(child));
          if (info.isDirectory()) result.folders.push(normalizePath(child));
        }
        return result;
      });
    },

    // ---- watching ----
    /** Starts watching the vault and scans it; `handler(event, path, oldPath, stat)` hears everything. */
    async watch(handler) {
      this.stopWatch();
      this.handler = handler;
      await this.startWatchPath("/");
      return this.queue(() => this.listAll());
    },
    /** Where the platform's watcher is not recursive, hidden folders (which the scan skips) are watched one by one. */
    async watchHiddenRecursive(path) {
      if (recursiveWatch) return;
      try {
        const names = await this.fsPromises.readdir(this.getFullRealPath(path));
        await this.startWatchPath(path);
        for (const name of names) {
          try {
            const child = collapseSlashes(path === "" ? name : path + "/" + name);
            if ((await this.fsPromises.lstat(this.getFullRealPath(child))).isDirectory()) await this.watchHiddenRecursive(child);
          } catch (e) { /* vanished while looking */ }
        }
      } catch (e) { /* not a readable folder */ }
    },
    stopWatch() {
      for (const path in this.watchers) if (vaultHas(this.watchers, path)) this.stopWatchPath(path);
      this.handler = null;
    },
    async startWatchPath(path) {
      const realPath = this.getRealPath(path);
      if (this.watchers[path]) return;
      const full = this.getFullPath(path);
      let resolved = full;
      try {
        resolved = await this.fsPromises.realpath(full);
      } catch (error) {
        if (error.code !== "ENOENT") console.error(error);
      }
      const watcher = this.fs.watch(full, { persistent: false, encoding: "utf8", recursive: recursiveWatch });
      watcher.on("change", (kind, name) => this.onFileChange(realPath === "/" ? name : realPath + "/" + name));
      watcher.on("error", () => this.onFileChange(realPath));
      this.watchers[path] = { watcher, resolvedPath: resolved };
    },
    stopWatchPath(path) {
      const entry = this.watchers[path];
      if (entry) {
        entry.watcher.close();
        delete this.watchers[path];
      }
    },
    /** A change reported by the disk; looked at on the next tick, through the queue. */
    onFileChange(path) {
      if (!path) return;
      path = collapseSlashes(path);
      setTimeout(() => {
        const vaultPath = normalizePath(path);
        this.queue(() => this.reconcileFile(path, vaultPath, false));
      }, 0);
    },
    trigger(event, path, oldPath, stat) {
      if (this.handler) this.handler(event, path, oldPath, stat);
    },

    // ---- comparing the disk with `files` ----
    /** Forgets everything and scans the whole vault. */
    async listAll() {
      this.files = {};
      this.files["/"] = { type: "folder", realpath: "/" };
      await this.listRecursive("");
    },
    async listRecursive(realPath) {
      const names = await this.fsPromises.readdir(this.getFullRealPath(realPath));
      this.thingsHappening();
      await Promise.all(names.map((name) => this.listRecursiveChild(realPath, name)));
    },
    async listRecursiveChild(realPath, name) {
      const child = collapseSlashes(realPath === "" ? name : realPath + "/" + name);
      const vaultPath = normalizePath(child);
      this.trigger("raw", vaultPath);
      if (isHiddenPath(vaultPath)) return this.reconcileDeletion(child, vaultPath);
      try {
        await this.reconcileFileInternal(child, vaultPath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await this.reconcileDeletion(child, vaultPath, true);
      }
    },
    reconcileInternalFile(path) {
      return this.reconcileFile(this.getRealPath(path), path);
    },
    /**
     * Looks at one path on disk and reports what changed since the last look. `realPath` is where it is on disk, `vaultPath` the
     * name the vault uses; `confirmed` false means a possible removal is re-checked 100 ms later before it is believed.
     */
    async reconcileFile(realPath, vaultPath, confirmed = true) {
      this.trigger("raw", vaultPath);
      if (isHiddenPath(vaultPath)) return this.reconcileDeletion(realPath, vaultPath, confirmed);
      const parent = parentPath(vaultPath);
      if (parent && parent !== "/" && !this.files[vaultPath]) await this.reconcileFile(parentPath(realPath), parent, confirmed);
      try {
        const full = this.getFullRealPath(realPath);
        if (this.insensitive) {
          const names = await this.fsPromises.readdir(this.path.dirname(full));
          const wanted = this.path.basename(vaultPath);
          if (names.map((name) => plainSpaces(name).normalize("NFC")).indexOf(wanted) === -1) {
            return await this.reconcileDeletion(realPath, vaultPath, confirmed);
          }
        }
        await this.reconcileFileInternal(realPath, vaultPath);
      } catch (error) {
        if (error.code !== "ENOENT") console.error(error);
        else await this.reconcileDeletion(realPath, vaultPath, confirmed);
      }
    },
    async reconcileFileInternal(realPath, vaultPath) {
      const info = await this.fsPromises.lstat(this.getFullRealPath(realPath));
      if (info.isFile()) await this.reconcileFileCreation(realPath, vaultPath, info);
      else if (info.isDirectory()) await this.reconcileFolderCreation(realPath, vaultPath);
      else if (info.isSymbolicLink()) await this.reconcileSymbolicLinkCreation(realPath, vaultPath);
    },
    async reconcileFileCreation(realPath, vaultPath, info) {
      const stat = statFromNode(info);
      const known = this.files[vaultPath];
      if (known) {
        known.realpath = realPath;
        if (known.type === "file") {
          if (known.mtime === Math.round(info.mtimeMs) && known.size === info.size) return;
          known.mtime = Math.round(info.mtimeMs);
          known.size = info.size;
          this.trigger("raw", vaultPath, vaultPath, stat);
          this.trigger("modified", vaultPath, vaultPath, stat);
          return;
        }
        this.removeFile(vaultPath);
      }
      this.files[vaultPath] = describeEntry(realPath, info);
      this.trigger("file-created", vaultPath, vaultPath, stat);
    },
    async reconcileFolderCreation(realPath, vaultPath) {
      if (vaultHas(this.files, vaultPath)) {
        this.files[vaultPath].realpath = realPath;
        return;
      }
      this.files[vaultPath] = { type: "folder", realpath: realPath };
      this.trigger("folder-created", vaultPath);
      if (!recursiveWatch) await this.startWatchPath(vaultPath);
      await this.listRecursive(realPath);
    },
    /** A symlink counts as what it points to, unless something it overlaps is already watched. */
    async reconcileSymbolicLinkCreation(realPath, vaultPath) {
      const full = this.getFullRealPath(realPath);
      let target;
      try {
        target = await this.fsPromises.realpath(full);
      } catch (e) {
        return; // dangling link
      }
      const sep = this.path.sep;
      const watchers = this.watchers;
      if (vaultHas(watchers, vaultPath)) {
        watchers[vaultPath].resolvedPath = target;
      } else {
        for (const other in watchers) {
          if (!vaultHas(watchers, other) || other === vaultPath) continue;
          const watched = watchers[other].resolvedPath;
          if (target === watched || watched.startsWith(target + sep) || target.startsWith(watched + sep)) return;
        }
      }
      const info = await this.fsPromises.stat(full);
      if (info.isFile()) {
        await this.reconcileFileCreation(realPath, vaultPath, info);
      } else if (info.isDirectory()) {
        if (recursiveWatch) await this.startWatchPath(vaultPath);
        await this.reconcileFolderCreation(realPath, vaultPath);
      }
    },
    async reconcileDeletion(realPath, vaultPath, confirmed = true) {
      if (vaultPath === "/") {
        this.trigger("closed", vaultPath);
        return;
      }
      this.stopWatchPath(vaultPath);
      const entry = this.files[vaultPath];
      if (!entry) return;
      if (!confirmed) {
        setTimeout(() => this.queue(() => this.reconcileFile(realPath, vaultPath)), 100);
        return;
      }
      if (entry.type === "folder") {
        for (const key in this.files) if (vaultHas(this.files, key) && key.startsWith(vaultPath + "/")) this.removeFile(key);
      }
      this.removeFile(vaultPath);
    },
    removeFile(path) {
      const entry = this.files[path];
      delete this.files[path];
      if (!entry) return;
      if (entry.type === "file") this.trigger("file-removed", path);
      else if (entry.type === "folder") this.trigger("folder-removed", path);
    },
  };

  function describeEntry(realPath, info) {
    if (info.isFile()) return { type: "file", realpath: realPath, ctime: Math.round(info.birthtimeMs), mtime: Math.round(info.mtimeMs), size: info.size };
    if (info.isDirectory()) return { type: "folder", realpath: realPath };
    return undefined;
  }

  Object.assign(FileSystemAdapter.prototype, methods);

  // statics used outside a vault (e.g. before the vault exists)
  FileSystemAdapter.readLocalFile = async function (path) {
    const nodeRequire = window.require;
    if (!nodeRequire) return null;
    return ownBuffer(await nodeRequire("fs").promises.readFile(path));
  };
  FileSystemAdapter.mkdir = async function (path) {
    const nodeRequire = window.require;
    if (!nodeRequire) return null;
    return nodeRequire("fs").promises.mkdir(path, { recursive: true });
  };
  return FileSystemAdapter;
}

// =====================================================================================================================
// The vault
// =====================================================================================================================

/**
 * Builds the Vault class on top of the host's event class.
 * `fileMap` maps every vault path ("/" for the root) to its TFile/TFolder; the vault keeps it in step with the adapter's events
 * (create, modify, delete, rename, raw, closed) and re-triggers those for plugins.
 */
export function createVault(Events, FileSystemAdapter) {
  const { TFile, TFolder } = { TFile: fileClass("TFile"), TFolder: fileClass("TFolder") };

  function Vault(adapter) {
    const self = Events.call(this) || this;
    self.fileMap = {};
    self.config = {};
    self.configTs = 0;
    self.configDir = DEFAULT_CONFIG_DIR;
    self.requestSaveConfig = vaultEnv().debounce(self.saveConfig.bind(self), 1000, true);
    self.cacheLimit = 65536;
    self.reloadConfig = vaultEnv().debounce(() => self.reloadConfigNow(), 500, true);
    self.adapter = adapter;
    self.root = new TFolder(self, "");
    self.onChange("folder-created", "/");
    self.root = self.fileMap["/"];
    return self;
  }
  vaultInherit(Vault, Events);

  Vault.validateConfigDir = function (dir) {
    return dir !== "." && dir.startsWith(".") && !vaultEnv().UT.test(dir);
  };
  /** Calls `visit` for the item and everything below it (last child first, like a stack). */
  Vault.recurseChildren = function (start, visit) {
    const stack = [start];
    while (stack.length > 0) {
      const item = stack.pop();
      if (!item) continue;
      visit(item);
      if (item instanceof TFolder) for (const child of item.children) stack.push(child);
    }
  };

  const methods = {
    getName() {
      return this.adapter.getName();
    },
    setFileCacheLimit(limit) {
      this.cacheLimit = limit;
      for (const path in this.fileMap) {
        if (!vaultHas(this.fileMap, path)) continue;
        const item = this.fileMap[path];
        if (item instanceof TFile) item.updateCacheLimit();
      }
    },

    // ---- settings kept in the config folder ----
    setConfigDir(dir) {
      if (!Vault.validateConfigDir(dir)) dir = DEFAULT_CONFIG_DIR;
      this.configDir = dir;
    },
    setupConfig() {
      this.copyObsidianSettings();
      return (async () => {
        const { adapter, configDir } = this;
        if (!(await adapter.exists(configDir))) await adapter.mkdir(configDir);
        this.configTs = Date.now();
        const app = await this.readConfigJson("app");
        const appearance = await this.readConfigJson("appearance");
        const config = (this.config = Object.assign({}, appearance, app));
        // settings that changed their name
        const renamed = { editorFontFamily: "textFontFamily" };
        for (const oldName in renamed) {
          if (!vaultHas(renamed, oldName) || !vaultHas(config, oldName)) continue;
          const newName = renamed[oldName];
          const value = config[oldName];
          delete config[oldName];
          if (!vaultHas(config, newName) && value) config[newName] = value;
        }
        this.requestSaveConfig();
      })();
    },
    /** Basalt: a vault that only has ".obsidian" gets a copy of it as ".basalt" the first time it is opened. */
    copyObsidianSettings() {
      try {
        const fs = window.require("fs");
        const pa = window.require("path");
        const base = this.adapter.basePath;
        const from = pa.join(base, ".obsidian");
        const to = pa.join(base, DEFAULT_CONFIG_DIR);
        const copyTree = (src, dest) => {
          fs.mkdirSync(dest, { recursive: true });
          for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            const s = pa.join(src, entry.name);
            const d = pa.join(dest, entry.name);
            if (entry.isDirectory()) copyTree(s, d);
            else fs.copyFileSync(s, d);
          }
        };
        if (base && !fs.existsSync(to) && fs.existsSync(from)) copyTree(from, to);
      } catch (error) {
        console.error("[basalt] settings copy failed", error);
      }
    },
    async saveConfig() {
      const { adapter, configDir } = this;
      if (!(await adapter.exists(configDir))) await adapter.mkdir(configDir);
      const app = {};
      const appearance = {};
      const config = this.config;
      for (const key in config) {
        if (!vaultHas(config, key)) continue;
        if (vaultEnv().AC.contains(key)) appearance[key] = config[key];
        else app[key] = config[key];
      }
      await this.writeConfigJson("app", app);
      await this.writeConfigJson("appearance", appearance);
      this.configTs = Date.now();
    },
    /** The files in the config folder changed on disk: re-read them when they are newer than what we loaded. */
    async reloadConfigNow() {
      const appFile = this.getConfigFile("app");
      const appearanceFile = this.getConfigFile("appearance");
      let changed = false;
      for (const file of [appFile, appearanceFile]) {
        try {
          if ((await this.adapter.stat(file)).mtime > this.configTs) changed = true;
        } catch (e) {
          changed = true;
        }
      }
      if (!changed) return;
      this.configTs = Date.now();
      const app = await this.readConfigJson("app");
      const appearance = await this.readConfigJson("appearance");
      const fresh = Object.assign({}, appearance, app);
      const config = this.config;
      for (const key in fresh) {
        if (!vaultHas(fresh, key)) continue;
        if (vaultHas(config, key) && JSON.stringify(config[key]) === JSON.stringify(fresh[key])) continue;
        config[key] = fresh[key];
        this.trigger("config-changed", key);
      }
      for (const key in config) {
        if (vaultHas(config, key) && !vaultHas(fresh, key)) {
          delete config[key];
          this.trigger("config-changed", key);
        }
      }
    },
    getConfig(key) {
      let value = this.config[key];
      if (value === undefined) value = vaultEnv().PC[key];
      return Array.isArray(value) || (value && typeof value === "object") ? JSON.parse(JSON.stringify(value)) : value;
    },
    setConfig(key, value) {
      if (this.config[key] === value) return;
      if (value !== undefined) this.config[key] = value;
      else delete this.config[key];
      this.requestSaveConfig();
      this.trigger("config-changed", key);
    },
    readPluginData(pluginDir) {
      return this.readJson(normalizePath(pluginDir + "/data.json"));
    },
    writePluginData(pluginDir, data, options) {
      return this.writeJson(normalizePath(pluginDir + "/data.json"), data, options);
    },
    getConfigFile(name) {
      return this.configDir + "/" + name + ".json";
    },
    readConfigJson(name) {
      return this.readJson(this.getConfigFile(name));
    },
    writeConfigJson(name, data, options) {
      return this.writeJson(this.getConfigFile(name), data, options);
    },
    deleteConfigJson(name) {
      return this.adapter.remove(normalizePath(this.configDir + "/" + name + ".json"));
    },
    /** The parsed JSON; null when the file does not exist; undefined when it cannot be read or parsed. */
    async readJson(path) {
      const clean = normalizePath(path);
      try {
        return JSON.parse(await this.adapter.read(clean));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        console.error("failed to read JSON", path, error);
      }
      return undefined;
    },
    async writeJson(path, data, options) {
      const clean = normalizePath(path);
      try {
        await this.adapter.write(clean, JSON.stringify(data, undefined, 2), options);
      } catch (e) { /* settings are best effort */ }
    },
    async load() {
      await this.adapter.watch(this.onChange.bind(this));
      if (this.adapter instanceof FileSystemAdapter) await this.adapter.watchHiddenRecursive(this.configDir);
    },

    // ---- looking things up ----
    getFileByPath(path) {
      if (vaultHas(this.fileMap, path)) {
        const item = this.fileMap[path];
        if (item instanceof TFile) return item;
      }
      return null;
    },
    getFolderByPath(path) {
      if (vaultHas(this.fileMap, path)) {
        const item = this.fileMap[path];
        if (item instanceof TFolder) return item;
      }
      return null;
    },
    getAbstractFileByPath(path) {
      return vaultHas(this.fileMap, path) ? this.fileMap[path] : null;
    },
    getAbstractFileByPathInsensitive(path) {
      const map = this.fileMap;
      if (vaultHas(map, path)) return map[path];
      const lower = path.toLowerCase();
      // Several paths can differ only by case on a case-sensitive disk; the first one in fileMap order wins, as it always did.
      let index = lowerPathIndex.get(this);
      if (!index) {
        index = new Map();
        for (const key in map) {
          if (!vaultHas(map, key)) continue;
          const folded = key.toLowerCase();
          if (folded.length === key.length && !index.has(folded)) index.set(folded, key);
        }
        lowerPathIndex.set(this, index);
      }
      const key = index.get(lower);
      return key !== undefined && vaultHas(map, key) ? map[key] : null;
    },
    isEmpty() {
      return Object.keys(this.fileMap).length === 1;
    },
    getRoot() {
      return this.root;
    },
    /** Would renaming `item` to `name` land on a different, existing item? */
    checkForDuplicate(item, name) {
      const target = this.fileMap[item.getNewPathAfterRename(name)];
      return target && target !== item;
    },
    checkPath(path) {
      vaultEnv().KT(path);
    },
    getAllLoadedFiles() {
      const all = [];
      for (const path in this.fileMap) if (vaultHas(this.fileMap, path)) all.push(this.fileMap[path]);
      return all;
    },
    getAllFolders(includeRoot = false) {
      const folders = [];
      for (const path in this.fileMap) {
        if (!vaultHas(this.fileMap, path)) continue;
        const item = this.fileMap[path];
        if (item instanceof TFolder) {
          if (!includeRoot && item.isRoot()) continue;
          folders.push(item);
        }
      }
      return folders;
    },
    getMarkdownFiles() {
      const files = [];
      Vault.recurseChildren(this.getRoot(), (item) => {
        if (item instanceof TFile && item.extension === "md") files.push(item);
      });
      return files;
    },
    getFiles() {
      const files = [];
      Vault.recurseChildren(this.getRoot(), (item) => {
        if (item instanceof TFile) files.push(item);
      });
      return files;
    },
    /** "name.ext", or "name 1.ext", "name 2.ext", ... the first one nobody (in any letter case) has. */
    getAvailablePath(name, ext) {
      let candidate = joinNameExt(name, ext);
      for (let n = 1; this.getAbstractFileByPathInsensitive(candidate); n++) candidate = joinNameExt(name + " " + n, ext);
      return candidate;
    },
    /** Where an attachment called name.ext goes, following the "attachmentFolderPath" setting; creates the folder when needed. */
    async getAvailablePathForAttachments(name, ext, note) {
      let folderPath = this.getConfig("attachmentFolderPath");
      const nextToNote = folderPath === "." || folderPath === "./";
      let subfolder = null;
      if (folderPath.startsWith("./")) subfolder = folderPath.slice(2);
      if (nextToNote) folderPath = note ? note.parent.path : "";
      else if (subfolder) folderPath = (note ? note.parent.getParentPrefix() : "") + subfolder;
      folderPath = normalizePath(folderPath);
      name = linkSafeHeading(normalizePath(name)).slice(0, 250);
      const folder = this.getAbstractFileByPathInsensitive(folderPath) || (await this.createFolder(folderPath));
      if (folder instanceof TFolder) return this.getAvailablePath(folder.getParentPrefix() + name, ext);
      return this.getAvailablePath(name, ext);
    },
    resolveFileUrl(url) {
      const { Yl, If } = vaultEnv();
      if (Yl.isDesktopApp) {
        if (url.startsWith(Yl.resourcePathPrefix)) url = "file:///" + url.substring(Yl.resourcePathPrefix.length).split("?")[0];
        const urlModule = If("url");
        if (urlModule && url.startsWith("file://")) return this.resolveFilePath(urlModule.fileURLToPath(url));
      }
      return null;
    },
    resolveFilePath(fullPath) {
      const adapter = this.adapter;
      if (vaultEnv().Yl.isDesktopApp && adapter instanceof FileSystemAdapter) {
        const base = adapter.getBasePath();
        if (fullPath.startsWith(base)) {
          const file = this.getAbstractFileByPath(normalizePath(fullPath.substring(base.length)));
          if (file instanceof TFile) return file;
        }
      }
      return null;
    },

    // ---- keeping fileMap in step with the adapter ----
    /** The adapter's event handler. */
    onChange(event, path, oldPath, stat) {
      lowerPathIndex.delete(this);
      if (event === "folder-created") {
        const folder = new TFolder(this, path);
        this.fileMap[path] = folder;
        this.addChild(folder);
        this.trigger("create", this.fileMap[path]);
      } else if (event === "file-created") {
        const file = new TFile(this, path);
        file.stat = stat;
        this.fileMap[path] = file;
        this.addChild(file);
        this.trigger("create", this.fileMap[path]);
      } else if (event === "modified") {
        if (!vaultHas(this.fileMap, path)) return;
        const item = this.fileMap[path];
        if (item instanceof TFile) {
          item.stat = stat;
          if (!item.saving) item.cache(null);
        }
        this.trigger("modify", item);
      } else if (event === "file-removed" || event === "folder-removed") {
        if (vaultHas(this.fileMap, path)) {
          const item = this.fileMap[path];
          this.removeChild(item);
          delete this.fileMap[path];
          item.deleted = true;
          this.trigger("delete", item);
        }
      } else if (event === "renamed") {
        if (vaultHas(this.fileMap, oldPath)) {
          const item = this.fileMap[oldPath];
          this.removeChild(item);
          item.setPath(path);
          this.addChild(item);
          this.fileMap[path] = item;
          delete this.fileMap[oldPath];
          this.trigger("rename", item, oldPath);
        }
      } else if (event === "closed") {
        this.trigger("closed");
      } else if (event === "raw") {
        this.trigger("raw", path);
        if (path.startsWith(this.configDir + "/") && this.adapter instanceof FileSystemAdapter) this.adapter.watchHiddenRecursive(path);
        if (path === this.getConfigFile("app") || path === this.getConfigFile("appearance")) this.reloadConfig();
      }
    },
    /** The folder an item belongs in, from its path; null when that folder is not known. */
    getDirectParent(item) {
      const path = item.path;
      const slash = path.lastIndexOf("/");
      if (slash === -1) return this.fileMap["/"];
      const parent = this.fileMap[path.slice(0, slash)];
      return parent && parent instanceof TFolder ? parent : null;
    },
    addChild(item) {
      const current = item.parent;
      const parent = this.getDirectParent(item);
      if (parent && parent !== current) {
        if (current) vaultRemoveAll(current.children, item);
        parent.children.push(item);
        item.parent = parent;
      }
    },
    removeChild(item) {
      const parent = item.parent;
      if (parent) {
        vaultRemoveAll(parent.children, item);
        item.parent = null;
      }
    },

    // ---- changing files ----
    async exists(path, caseSensitive) {
      return this.adapter.exists(normalizePath(path), caseSensitive);
    },
    async create(path, data, options) {
      const clean = normalizePath(path);
      this.checkPath(clean);
      if (await this.adapter.exists(clean)) throw new Error("File already exists.");
      await this.adapter.write(clean, data, options);
      const file = this.getAbstractFileByPath(clean);
      return file instanceof TFile ? file : null;
    },
    async createBinary(path, data, options) {
      const clean = normalizePath(path);
      this.checkPath(clean);
      if (await this.adapter.exists(clean)) throw new Error("File already exists.");
      await this.adapter.writeBinary(clean, data, options);
      const file = this.getAbstractFileByPath(clean);
      return file instanceof TFile ? file : null;
    },
    async createFolder(path) {
      const clean = normalizePath(path);
      this.checkPath(clean);
      if (await this.adapter.exists(clean)) throw new Error("Folder already exists.");
      await this.adapter.mkdir(clean);
      const folder = this.getAbstractFileByPath(clean);
      return folder instanceof TFolder ? folder : null;
    },
    /** The text of the file; a leading byte-order mark is dropped, and the text is cached on the file. */
    async read(file) {
      let text = await this.adapter.read(file.path);
      if (text.charCodeAt(0) === UTF8_BOM) text = text.substring(1);
      file.cache(text);
      return text;
    },
    async cachedRead(file) {
      return textCache.has(file) ? textCache.get(file) : this.read(file);
    },
    async readBinary(file) {
      const data = await this.adapter.readBinary(file.path);
      try {
        if (file.extension === "md" && data.byteLength <= this.cacheLimit) file.cache(new TextDecoder().decode(data));
      } catch (e) { /* not text */ }
      return data;
    },
    async readRaw(path) {
      return this.adapter.read(normalizePath(path));
    },
    getResourcePath(file) {
      return this.adapter.getResourcePath(file.path);
    },
    async delete(item, force = false) {
      if (!item || item === this.root) return;
      if (item instanceof TFile) await this.adapter.remove(item.path);
      else if (item instanceof TFolder) await this.adapter.rmdir(item.path, force);
    },
    /** Moves to the system trash when `system` (falling back to the vault's .trash when that fails), else to .trash. */
    async trash(item, system) {
      if (!item || item === this.root) return;
      if (system && (await this.adapter.trashSystem(item.path))) return;
      await this.adapter.trashLocal(item.path);
    },
    async rename(item, newPath) {
      const path = normalizePath(newPath);
      if (item.path === path) return;
      this.checkPath(path);
      await this.adapter.rename(item.path, path);
    },
    // The four writers mark the file as "saving" so that the change they cause does not drop the cache they are about to fill.
    modify(file, data, options) {
      return this.writeWhileSaving(file, options, () => file.cache(data), (opts) => this.adapter.write(file.path, data, opts), { dropCacheOnError: true });
    },
    modifyBinary(file, data, options) {
      return this.writeWhileSaving(file, options, () => file.cache(null), (opts) => this.adapter.writeBinary(file.path, data, opts));
    },
    append(file, data, options) {
      return this.writeWhileSaving(file, options, () => file.cache(null), (opts) => this.adapter.append(file.path, data, opts));
    },
    appendBinary(file, data, options) {
      return this.writeWhileSaving(file, options, () => file.cache(null), (opts) => this.adapter.appendBinary(file.path, data, opts));
    },
    async process(file, transform, options) {
      const saving = file.saving;
      file.saving = true;
      try {
        options = options || {};
        options.immediate = () => file.cache(null);
        const result = await this.adapter.process(file.path, transform, options);
        file.cache(result);
        return result;
      } finally {
        file.saving = saving;
      }
    },
    async writeWhileSaving(file, options, immediate, write, { dropCacheOnError = false } = {}) {
      const saving = file.saving;
      file.saving = true;
      try {
        options = options || {};
        options.immediate = immediate;
        await write(options);
      } catch (error) {
        if (dropCacheOnError) file.cache(null);
        throw error;
      } finally {
        file.saving = saving;
      }
    },
    async copy(item, newPath) {
      const path = normalizePath(newPath).normalize("NFC");
      this.checkPath(path);
      await this.adapter.copy(item.path, path);
      return this.getAbstractFileByPath(path);
    },

    // ---- iterating ----
    async *iterateFiles(files, useCache) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let content = "";
        if (file.extension === "md") content = useCache ? await this.cachedRead(file) : await this.read(file);
        yield { file, content };
      }
    },
    async *generateFiles(files, useCache) {
      for await (const file of files) {
        let content = "";
        if (file.extension === "md" || file.extension === "canvas") content = useCache ? await this.cachedRead(file) : await this.read(file);
        yield { file, content };
      }
    },
    trigger(name, ...args) {
      Events.prototype.trigger.apply(this, [name, ...args]);
    },
    on(name, callback, context) {
      return Events.prototype.on.call(this, name, callback, context);
    },
  };
  Object.assign(Vault.prototype, methods);
  return Vault;
}

// =====================================================================================================================
// FileManager: where new files go, creating them, renaming with link updates
// =====================================================================================================================
// These are installed on the existing FileManager class (its constructor and the dialog-heavy methods stay as they are).

/** Folder for a new Markdown file, following the "newFileLocation" setting; `activePath` is the path of the open file. */
export function fmMarkdownNewFileParent(activePath) {
  const vault = this.vault;
  const where = vault.getConfig("newFileLocation");
  const TFolderClass = fileClass("TFolder");
  if (where === "folder") {
    const folder = vault.getAbstractFileByPath(vault.getConfig("newFileFolderPath"));
    if (folder instanceof TFolderClass) return folder;
  } else if (where === "current") {
    const folder = vault.getAbstractFileByPath(parentPath(activePath));
    if (folder instanceof TFolderClass) return folder;
  }
  return vault.getRoot();
}
export function fmNewFileParent(activePath, fileName) {
  const ext = (fileName && extensionOf(fileName)) || "md";
  let creator = this.fileParentCreatorByType[ext];
  if (!creator) {
    console.error("No file creator assigned to create file with extension " + ext + ". Falling back to Markdown file creator.");
    creator = this.fileParentCreatorByType.md;
  }
  return creator(activePath);
}
export function fmRegisterFileParentCreator(ext, creator) {
  this.fileParentCreatorByType[ext] = creator;
}
export function fmUnregisterFileCreator(ext) {
  delete this.fileParentCreatorByType[ext];
}
export function fmCanCreateFileWithExt(ext) {
  return vaultHas(this.fileParentCreatorByType, ext || "md");
}
export async function fmCreateNewMarkdownFileFromLinktext(linktext, sourcePath) {
  const { GT, gm, qT } = vaultEnv();
  if (!GT(linktext)) throw new Error(gm.plugins.fileExplorer.msgInvalidCharacters() + qT);
  let parent = null;
  if (!linktext.contains("/")) parent = this.getNewFileParent(sourcePath, linktext);
  return this.createNewMarkdownFile(parent, linktext);
}
export async function fmCreateNewMarkdownFile(parent, name, content) {
  return this.createNewFile(parent, name, "md", content);
}
/** Creates a file (and any missing folders of a path given in `name`) under `parent`; an empty name becomes "Untitled", "Untitled 1", ... */
export async function fmCreateNewFile(parent, name, ext, content) {
  const vault = this.vault;
  const TFolderClass = fileClass("TFolder");
  if (!parent) parent = vault.getRoot();
  if (!ext) ext = (name && extensionOf(name)) || "md";
  if (!vaultHas(this.fileParentCreatorByType, ext)) ext = "md";
  const prefix = parent.getParentPrefix();
  let path;
  if (name) {
    name = name.trim();
    if (extensionOf(name) === ext) name = withoutExtension(name);
    name = normalizePath(name);
    path = vault.getAvailablePath(prefix + name, ext);
  } else {
    path = vault.getAvailablePath(prefix + vaultEnv().gm.plugins.fileExplorer.labelUntitledFile(), ext);
  }
  const folderPath = parentPath(path);
  const fileName = lastSegment(path);
  const folder = await (async () => {
    if (!folderPath || folderPath === "/") return vault.getRoot();
    const existing = vault.getAbstractFileByPathInsensitive(folderPath);
    if (existing && existing instanceof TFolderClass) return existing;
    return vault.createFolder(folderPath);
  })();
  return vault.create(folder.getParentPrefix() + fileName, content || "");
}
export async function fmCreateNewFolder(parent) {
  const prefix = !parent || parent.isRoot() ? "" : parent.path + "/";
  const path = this.vault.getAvailablePath(prefix + vaultEnv().gm.plugins.fileExplorer.labelUntitledFolder());
  await this.vault.createFolder(path);
  const folder = this.vault.getAbstractFileByPath(path);
  return folder && folder instanceof fileClass("TFolder") ? folder : null;
}
/** Renames/moves through the vault, then rewrites the links that pointed at it (asking first, unless "alwaysUpdateLinks"). */
export async function fmRenameFile(item, newPath) {
  await this.runAsyncLinkUpdate(() => this.vault.rename(item, newPath));
}
/**
 * Runs `action` (something that renames files) between two snapshots of the links: before it, every link that resolves to a file
 * is recorded; after it, updateAllLinks rewrites those that would now point elsewhere. Calls made while one is running are run by
 * it, so nested renames share one link update.
 */
export async function fmRunAsyncLinkUpdate(action) {
  if (this.inProgressUpdates) {
    this.inProgressUpdates.push(action);
    return;
  }
  const TFileClass = fileClass("TFile");
  return this.updateQueue.queue(async () => {
    await new Promise((resolve) => this.app.metadataCache.onCleanCache(resolve));
    const links = [];
    const { metadataCache, vault } = this.app;
    metadataCache.iterateAllRefs((sourcePath, reference) => {
      const target = linkPath(reference.link);
      if (!target) return;
      const sourceFile = vault.getAbstractFileByPath(sourcePath);
      if (!(sourceFile instanceof TFileClass)) return;
      const destinations = metadataCache.getLinkpathDest(target, sourcePath);
      if (destinations.length > 0) {
        links.push({ sourceFile, reference, resolvedFile: destinations[0], resolvedPaths: destinations.map((f) => f.path) });
      }
    });
    try {
      this.inProgressUpdates = [];
      await action(links);
      while (this.inProgressUpdates.length > 0) {
        const pending = this.inProgressUpdates;
        this.inProgressUpdates = [];
        await Promise.all(pending.map((run) => run(links)));
      }
    } finally {
      this.inProgressUpdates = null;
    }
    await this.updateAllLinks(links);
  });
}
/** Deletes by the "trashOption" setting: "system" trash, the vault's ".trash", or for good. */
export async function fmTrashFile(item) {
  const vault = this.app.vault;
  const option = vault.getConfig("trashOption");
  if (option === "system") await vault.trash(item, true);
  else if (option === "local") await vault.trash(item, false);
  else if (option === "none") await vault.delete(item, true);
}
export async function fmGetAvailablePathForAttachment(fileName, sourcePath) {
  const { vault, workspace } = this.app;
  const name = baseName(fileName);
  const ext = extensionOf(fileName);
  let note = null;
  if (sourcePath) {
    const file = vault.getAbstractFileByPath(sourcePath);
    if (file && file instanceof fileClass("TFile")) note = file;
  } else {
    note = workspace.getActiveFile();
  }
  return vault.getAvailablePathForAttachments(name, ext, note);
}

