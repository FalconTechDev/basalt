// g22 clean-room: built-in file-recovery plugin — IndexedDB snapshots of
// md/canvas/base files, retention cleanup, history modal, settings tab, CLI.
// Own architecture: a snapshot store (IndexedDB) + retention policy behind the
// plugin descriptor; the modal/settings are separate classes per contract.
// NOTE: the runtime bootstrap does not wire this plugin in; the classes are
// exported for manifest completeness only.

import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { s14FileRecoverySettingsTab } from "./s14-file-recovery.js";
import { formatBytes } from "./text.js";
import { parentPath, baseName } from "./path.js";

const NG22_RECOVERY_EXTS = new Set(["md", "canvas", "base"]);
const NG22_DEFAULTS = { intervalMinutes: 5, keepDays: 7 };

function ng22OpenBackupDb(app) {
  return new Promise((resolve, reject) => {
    const name = `${app.appId || "obsidian"}-backup`;
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("backups")) {
        const store = db.createObjectStore("backups", { autoIncrement: true });
        store.createIndex("path", "path", { unique: false });
        store.createIndex("ts", "ts", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function ng22Idb(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction("backups", mode);
    const store = t.objectStore("backups");
    const out = fn(store);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

async function ng22IdbAll(db) {
  return ng22Idb(db, "readonly", (store) => new Promise((res, rej) => {
    const rows = [];
    const cur = store.openCursor();
    cur.onsuccess = () => { const c = cur.result; if (!c) return res(rows); rows.push(c.value); c.continue(); };
    cur.onerror = () => rej(cur.error);
  }));
}

async function ng22IdbPut(db, rec) {
  return ng22Idb(db, "readwrite", (store) => new Promise((res, rej) => {
    const r = store.add(rec);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

async function ng22IdbDeleteWhere(db, indexName, range) {
  return ng22Idb(db, "readwrite", (store) => new Promise((res, rej) => {
    const idx = store.index(indexName);
    const keys = [];
    const cur = idx.openCursor(range);
    cur.onsuccess = () => { const c = cur.result; if (!c) return res(keys); keys.push(c.primaryKey); c.delete(); c.continue(); };
    cur.onerror = () => rej(cur.error);
  }));
}

async function ng22IdbClear(db) {
  return ng22Idb(db, "readwrite", (store) => new Promise((res, rej) => {
    const r = store.clear();
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  }));
}

// ------------------------------------------------------------- plugin ----

export function defineS33FileRecoveryPlugin(host) {
  function FileRecoveryPlugin() {
    this.id = "file-recovery";
    this.name = "File recovery";
    this.description = "Periodically saves snapshots of your notes so you can restore earlier versions.";
    this.defaultOn = true;
    this.hiddenFromList = true;
  }
  const P = FileRecoveryPlugin.prototype;

  P.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.options = Object.assign({}, NG22_DEFAULTS);
    this._lastTs = new Map();
    this._pending = new Set();
    this._db = null;
    this._dbFailed = false;
    plugin.registerGlobalCommand({
      id: "file-recovery:open",
      name: "Open file recovery history",
      icon: "lucide-rotate-ccw",
      callback: () => this.openModal(),
    });
  };

  P.onEnable = async function () {
    const app = this.app;
    const plugin = this.plugin;
    try {
      const saved = await plugin.loadData();
      if (saved && typeof saved === "object") this.options = Object.assign({}, NG22_DEFAULTS, saved);
    } catch (e) {}
    this._intervalMinutes = Math.max(0, +this.options.intervalMinutes || NG22_DEFAULTS.intervalMinutes);
    this._keepDays = Math.max(1, +this.options.keepDays || NG22_DEFAULTS.keepDays);
    plugin.addSettingTab(new (defineS33RecoverySettingsTab(host))(app, plugin, this));
    this._offModify = app.vault.on("modify", (f) => this.onFileChanged(f));
    this._offCreate = app.vault.on("create", (f) => this.onFileChanged(f));
    this._offOpen = app.workspace.on("file-open", (f) => { if (f) this.onFileChanged(f); });
    plugin.register(() => { if (this._offModify) app.vault.offref && 0; });
    this._resaveTimer = setInterval(() => this.resave(), 60000);
    this._cleanupTimer = setInterval(() => this.cleanup(), 3600000);
    try {
      this._db = await ng22OpenBackupDb(app);
    } catch (e) { this._dbFailed = true; this._db = null; }
    this._registerCli();
    setTimeout(() => this.cleanup(), 60000);
  };

  P.onDisable = function () {
    if (this._resaveTimer) clearInterval(this._resaveTimer);
    if (this._cleanupTimer) clearInterval(this._cleanupTimer);
    if (this._db) { try { this._db.close(); } catch (e) {} this._db = null; }
  };

  P._registerCli = function () {
    const app = this.app;
    const self = this;
    const needDb = () => { if (!self._db) throw "File recovery database not available."; return self._db; };
    const resolveFile = (arg) => {
      if (!arg) throw "A file path is required.";
      const f = app.vault.getAbstractFileByPath(arg) || app.metadataCache.getFirstLinkpathDest(arg, "");
      if (!f) throw `File not found: ${arg}`;
      return f;
    };
    const versions = async (path) => {
      const rows = await ng22IdbAll(needDb());
      return rows.filter((r) => r && r.path === path).sort((a, b) => b.ts - a.ts);
    };
    app.cli.registerHandler("history", "Show file recovery history", { path: { value: "<path>", description: "File path", required: true } }, async (args) => {
      const f = resolveFile(args.path || args.file);
      const vs = await versions(f.path);
      return vs.map((v, i) => `${i + 1}. ${new Date(v.ts).toISOString().slice(0, 16).replace("T", " ")} ${formatBytes(v.data ? v.data.length : 0)}`).join("\n") || "No backups.";
    });
    app.cli.registerHandler("history:list", "List files with recovery history", null, async () => {
      const rows = await ng22IdbAll(needDb());
      const paths = Array.from(new Set(rows.map((r) => r && r.path).filter(Boolean))).sort();
      return paths.join("\n") || "No backups.";
    });
    app.cli.registerHandler("history:read", "Read a recovery version", { path: { value: "<path>", description: "File path", required: true }, version: { value: "<n>", description: "Version number (default 1)" } }, async (args) => {
      const f = resolveFile(args.path || args.file);
      const vs = await versions(f.path);
      const n = Math.max(1, parseInt(args.version, 10) || 1);
      const v = vs[n - 1];
      if (!v) throw `No version ${n} for ${f.path}`;
      return `${f.path} @ ${new Date(v.ts).toISOString()}\n---\n${v.data}`;
    });
    app.cli.registerHandler("history:restore", "Restore a recovery version", { path: { value: "<path>", description: "File path", required: true }, version: { value: "<n>", description: "Version number", required: true } }, async (args) => {
      const f = resolveFile(args.path || args.file);
      const vs = await versions(f.path);
      const n = parseInt(args.version, 10);
      if (!n || n < 1 || n > vs.length) throw `Version out of range: ${args.version}`;
      const v = vs[n - 1];
      const parent = parentPath(f.path);
      if (parent && !app.vault.getAbstractFileByPath(parent)) await app.vault.createFolder(parent);
      await app.vault.adapter.write(f.path, v.data);
      await this.forceAdd(f.path, v.data);
      return `Restored ${f.path} to version ${n}.`;
    });
    app.cli.registerHandler("history:open", "Open recovery history", { path: { value: "<path>", description: "File path" } }, async (args) => {
      let path = args.path;
      if (!path && args.file) {
        const f = app.metadataCache.getFirstLinkpathDest(args.file, "");
        path = f && f.path;
      }
      if (!path) {
        const active = app.workspace.getActiveFile && app.workspace.getActiveFile();
        path = active && active.path;
      }
      this.openModal(path || "");
      return path ? `Opened history for ${path}` : "Opened history.";
    });
  };
  // --------------------------------------------------------- snapshots ----

  P._snapshotPath = function (file) {
    return typeof file === "string" ? file : file && file.path;
  };

  P.onFileChanged = async function (file) {
    const path = this._snapshotPath(file);
    if (!path || !NG22_RECOVERY_EXTS.has((path.split(".").pop() || "").toLowerCase())) return;
    if (this._dbFailed || !this._db) return;
    const now = Date.now();
    const last = this._lastTs.get(path) || 0;
    if (now - last < this._intervalMinutes * 60000) { this._pending.add(path); return; }
    try {
      const content = await this.app.vault.cachedRead(path);
      const newest = await this._newest(path);
      if (newest && newest.data === content) { this._lastTs.set(path, now); return; }
      await this._write(path, content, now);
      this._lastTs.set(path, now);
      this._pending.delete(path);
    } catch (e) {}
  };

  P._newest = async function (path) {
    if (!this._db) return null;
    const rows = await ng22IdbAll(this._db);
    let best = null;
    for (const r of rows) if (r && r.path === path && (!best || r.ts > best.ts)) best = r;
    return best;
  };

  P._write = async function (path, data, ts) {
    if (!this._db) return;
    await ng22IdbPut(this._db, { path, ts: ts || Date.now(), data: String(data) });
  };

  /** Unconditional snapshot write (used by restore and FileManager backups). */
  P.forceAdd = async function (path, data) {
    path = this._snapshotPath(path);
    if (!path || this._dbFailed) return;
    if (!this._db) {
      try { this._db = await ng22OpenBackupDb(this.app); } catch (e) { this._dbFailed = true; return; }
    }
    await this._write(path, data);
    this._lastTs.set(path, Date.now());
  };

  P.resave = async function () {
    if (!this._pending || !this._pending.size || !this._db) { this._pending && this._pending.clear(); return; }
    const paths = Array.from(this._pending);
    this._pending.clear();
    for (const path of paths) {
      try {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!file) continue;
        const content = await this.app.vault.cachedRead(file);
        await this.forceAdd(path, content);
      } catch (e) {}
    }
  };

  P.cleanup = async function () {
    if (!this._db) return;
    const cutoff = Date.now() - this._keepDays * 86400000;
    try { await ng22IdbDeleteWhere(this._db, "ts", IDBKeyRange.upperBound(cutoff)); } catch (e) {}
  };

  P.clearData = async function () {
    this._lastTs.clear();
    this._pending.clear();
    if (this._db) { try { await ng22IdbClear(this._db); } catch (e) {} }
    new host.Notice("File recovery history cleared");
  };

  P.getLastVersionByPath = async function (path) {
    path = this._snapshotPath(path);
    if (!path || !this._db) return null;
    const rows = await ng22IdbAll(this._db);
    let best = null;
    for (const r of rows) if (r && r.path === path && (!best || r.ts > best.ts)) best = r;
    return best;
  };

  /** All snapshots for `path`, newest first. */
  P.listVersions = async function (path) {
    path = this._snapshotPath(path);
    if (!path || !this._db) return [];
    const rows = await ng22IdbAll(this._db);
    return rows.filter((r) => r && r.path === path).sort((a, b) => b.ts - a.ts);
  };

  /** All paths that have at least one snapshot, sorted. */
  P.listPaths = async function () {
    if (!this._db) return [];
    const rows = await ng22IdbAll(this._db);
    return Array.from(new Set(rows.map((r) => r && r.path).filter(Boolean))).sort();
  };

  P.openModal = function (path) {
    const Modal = defineS33RecoveryHistoryModal(host);
    const modal = new Modal(this.app, this);
    modal.open();
    if (path) modal.switchToPath(path);
    return modal;
  };

  return FileRecoveryPlugin;
}

// ---------------------------------------------------------- settings tab ----

export function defineS33RecoverySettingsTab(host) {
  // The settings tab already exists as an own s14 module with the same contract
  // (interval/keep-days/open-history/clear + unsupported-IndexedDB row).
  return s14FileRecoverySettingsTab();
}
// --------------------------------------------------------- history modal ----

export function defineS33RecoveryHistoryModal(host) {
  function HistoryModal(app, plugin) {
    const self = host.Modal.call(this, app) || this;
    self.plugin = plugin;
    self.path = "";
    self.versions = [];
    self.currentVersion = null;
    self.previousVersion = null;
    self.showDiff = false;
    return self;
  }
  inherit(HistoryModal, host.Modal);
  const P = HistoryModal.prototype;

  P.onOpen = function () {
    this.modalEl.addClass("mod-sync-history", "mod-sidebar-layout");
    this.titleEl.setText("File recovery");
    const fr = env().gm && env().gm.plugins && env().gm.plugins.fileRecovery || {};
    const ti = env().gm && env().gm.plugins && env().gm.plugins.sync || {};
    this._fr = fr; this._ti = ti;
    const body = this.contentEl;
    body.empty();
    // left: search + version list
    const side = body.createDiv("modal-sidebar");
    this.searchEl = side.createEl("input", { cls: "settings-search-input", attr: { type: "search", placeholder: fr.placeholderChooseFile ? fr.placeholderChooseFile() : "Choose a file..." } });
    this.listEl = side.createDiv("file-recovery-list-item-container");
    // right: content pane
    const right = body.createDiv("modal-content");
    const pane = right.createDiv("sync-history-content-container");
    this.contentPane = pane.createDiv("sync-history-content");
    this._buildToolbar(right);
    this._loadPaths();
    this.searchEl.addEventListener("input", () => this._renderPathList());
  };

  P._buildToolbar = function (right) {
    const bar = right.createDiv("modal-toolbar");
    const ti = this._ti || {};
    const diffBtn = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": ti.labelShowDiff ? ti.labelShowDiff() : "Diff" } });
    try { host.setIcon(diffBtn, "lucide-git-compare"); } catch (e) {}
    diffBtn.addEventListener("click", () => { this.showDiff = !this.showDiff; this.openHistory(this.currentVersion, this.previousVersion); });
    const copyBtn = bar.createEl("button", { cls: "clickable-icon", attr: { "aria-label": ti.labelCopyToClipboard ? ti.labelCopyToClipboard() : "Copy" } });
    try { host.setIcon(copyBtn, "lucide-copy"); } catch (e) {}
    copyBtn.addEventListener("click", async () => {
      const v = this.currentVersion;
      if (!v) return;
      try { await navigator.clipboard.writeText(String(v.data || "")); } catch (e) {}
      new host.Notice("Copied");
    });
    const restoreBtn = bar.createEl("button", { cls: "mod-cta", text: ti.labelRestoreThisVersion ? ti.labelRestoreThisVersion() : "Restore" });
    restoreBtn.addEventListener("click", () => this._restore());
  };

  P._loadPaths = async function () {
    this._paths = (await this.plugin.listPaths().catch(() => [])) || [];
    this._renderPathList();
  };

  P._renderPathList = function () {
    const el = this.listEl;
    if (!el) return;
    el.empty();
    const q = (this.searchEl && this.searchEl.value || "").toLowerCase();
    const paths = (this._paths || []).filter((p) => !q || p.toLowerCase().includes(q));
    if (!paths.length) {
      el.createDiv({ cls: "file-recovery-list-item-details u-muted", text: this._fr.labelSelectFile ? this._fr.labelSelectFile() : "Pick a file" });
      return;
    }
    for (const path of paths) {
      const row = el.createDiv("file-recovery-list-item-header mod-selectable tappable");
      row.setText(baseName(path));
      row.createDiv({ cls: "file-recovery-list-item-details u-muted", text: path });
      row.addEventListener("click", () => this.switchToPath(path));
    }
  };

  P.switchToPath = async function (path) {
    this.path = path;
    this.versions = (await this.plugin.listVersions(path).catch(() => [])) || [];
    this.currentVersion = this.versions[0] || null;
    this.previousVersion = this.versions[1] || null;
    this.titleEl.setText(path || "File recovery");
    this.openHistory(this.currentVersion, this.previousVersion);
  };

  P.openHistory = function (version, previous) {
    const pane = this.contentPane;
    if (!pane) return;
    pane.empty();
    this.currentVersion = version || this.currentVersion;
    this.previousVersion = previous || this.previousVersion;
    const v = this.currentVersion;
    if (!v) {
      pane.createDiv({ cls: "u-muted", text: this._fr.labelNoHistoryFound ? this._fr.labelNoHistoryFound() : "No snapshots" });
      return;
    }
    const when = new Date(v.ts);
    pane.createDiv({ cls: "file-recovery-list-item-details u-muted", text: when.toLocaleString() + " — " + formatBytes(String(v.data || "").length) });
    const holder = pane.createDiv("file-recovery-text");
    if (this.showDiff && this.previousVersion) {
      const diff = pane.createDiv("file-recovery-diff");
      try {
        if (host.s10RenderDiffView) host.s10RenderDiffView(diff, String(this.previousVersion.data || ""), String(v.data || ""));
        else diff.setText(String(v.data || ""));
      } catch (e) { diff.setText(String(v.data || "")); }
    } else {
      const area = holder.createEl("textarea", { cls: "file-recovery-text" });
      area.value = String(v.data || "");
      area.readOnly = true;
    }
  };

  P._restore = async function () {
    const v = this.currentVersion;
    if (!v || !this.path) return;
    const app = this.app;
    const parent = parentPath(this.path);
    try {
      if (parent && !app.vault.getAbstractFileByPath(parent)) await app.vault.createFolder(parent);
      await app.vault.adapter.write(this.path, String(v.data || ""));
      await this.plugin.forceAdd(this.path, v.data);
      const ti = this._ti || {};
      new host.Notice(ti.msgRestoredVersion ? ti.msgRestoredVersion({ time: new Date(v.ts).toLocaleString() }) : "Restored");
      await this.switchToPath(this.path);
    } catch (e) {
      new host.Notice("Restore failed: " + (e && e.message || e));
    }
  };

  return HistoryModal;
}

