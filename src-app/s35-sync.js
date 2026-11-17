// The "sync" core plugin: remote-vault sync engine, version history, CLI
// handlers, status-bar icon and sync log. Faithful port of the inherited code:
// same IndexedDB layout, wire protocol calls, log lines, statuses and DOM
// classes. App-scope helpers arrive through host/env or own-module imports;
// bundle async plumbing becomes native async/await.

import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { account } from "./account.js";
import { utf8Bytes } from "./vault-crypto.js";
import { utf8String } from "./vault-crypto.js";
import { encodeBase64 } from "./vault-crypto.js";
import { decodeBase64 } from "./vault-crypto.js";
import { deriveScryptKey } from "./vault-crypto.js";
import { initCipher } from "./vault-crypto.js";
import { contentHash } from "./metadata-helpers.js";
import { escapeRegExp } from "./metadata-helpers.js";
import { s10MergeText } from "./s10-app.js";
import { formatBytes } from "./text.js";
import { s05IsValidFileName } from "./s05-utils.js";
import { s04SettlePromise } from "./s04-themes.js";
import { normalizePath } from "./path.js";
import { isPluginFileName } from "./path.js";
import { withoutExtension } from "./path.js";
import { parentPath } from "./path.js";
import { lastSegment } from "./path.js";
import { extensionOf } from "./path.js";
import { s16SyncWorkerName } from "./s16-constants.js";
import { defineSyncSettingsView } from "./s15-sync.js";
import { defineSyncChangesView } from "./s15-sync.js";
import { defineSyncFileHistoryView } from "./s15-sync.js";
import { defineSyncFileHistoryModal } from "./s15-sync.js";
import { defineSyncDeletedFilesModal } from "./s15-sync.js";
import { defineSyncRemoteVaultsModal } from "./s15-sync.js";
import { defineSyncConnectVaultModal } from "./s15-sync.js";
import { defineSyncLogModal } from "./s15-sync.js";


// Lazily-built shared classes from the s15 sync slice (they memoize internally).
let s35SyncViews = null;
function s35SyncViewClasses(host) {
  if (!s35SyncViews) {
    s35SyncViews = {
      settings: defineSyncSettingsView(host),
      changes: defineSyncChangesView(host),
      history: defineSyncFileHistoryView(host),
      historyModal: defineSyncFileHistoryModal(host),
      deletedModal: defineSyncDeletedFilesModal(host),
      remoteVaults: defineSyncRemoteVaultsModal(host),
      connect: defineSyncConnectVaultModal(host),
      log: defineSyncLogModal(host),
    };
  }
  return s35SyncViews;
}

// Sanitize a device name for use inside a conflicted-copy filename (was the
// inline helper inside `_sync`).
function s35SyncDeviceTag(deviceName, fallback) {
  let tag = deviceName.trim();
  if (tag) {
    tag = deviceName.replace(env().UT, "_");
    if ("_".length === 1) {
      const escaped = escapeRegExp("_");
      const repeats = new RegExp(`${escaped}{2,}`, "g");
      tag = tag.replace(repeats, "_");
    }
  }
  return tag || fallback;
}

// The sync plugin class itself (was `uee`).
export function s35SyncPlugin(host) {
  const Base = host.Events;
  const i18n = host.i18n;
  const syncT = () => i18n.plugins.sync;
  const platform = host.Platform;
  const VIEWS = () => s35SyncViewClasses(host);

  function SyncPlugin() {
    const self = Base.call(this) || this;
    self.id = "sync";
    self.name = syncT().name();
    self.description = syncT().desc();
    self.defaultOn = true;
    self.app = null;
    self.vault = null;
    self.plugin = null;
    self.db = null;
    self.vaultId = null;
    self.vaultName = null;
    self.key = null;
    self.salt = null;
    self.encryptionVersion = -1;
    self.encryptionProvider = null;
    self.host = null;
    self.deviceName = "";
    self.userId = -1;
    self.version = 0;
    self.initial = true;
    self.localFiles = {};
    self.scanSpecialFiles = false;
    self.scanSpecialFileQueue = [];
    self.serverFiles = {};
    self.fileRetry = {};
    self.skippedFiles = {};
    self.newServerFiles = [];
    self.allowTypes = new Set(env().gk);
    self.conflictAction = "merge";
    self.allowSpecialFiles = new Set(env().yk);
    self.ignoreFolders = [];
    self.preventSleep = false;
    self.initialized = false;
    self.dirty = false;
    self.dataLoaded = false;
    self.requestSaveData = host.debounce(self.saveData.bind(self), 2000);
    self.boundOnFileAdd = self.onFileAdd.bind(self);
    self.boundOnFileRemove = self.onFileRemove.bind(self);
    self.boundOnFileRename = self.onFileRename.bind(self);
    self.boundOnRaw = self.onRaw.bind(self);
    self.pause = false;
    self.syncing = false;
    self.error = false;
    self.ready = false;
    self.server = null;
    self.syncLog = [];
    self.timer = 0;
    self.backoff = new (env().Z9)(0, 300000, 5000, true);
    self.statusIconEl = null;
    self.filterCache = {};
    self.syncingPath = "";
    self.syncStatus = "";
    self.requestStatusBarUpdate = host.debounce(self._updateStatusBar, 100);
    return self;
  }
  inherit(SyncPlugin, Base);
  const proto = SyncPlugin.prototype;

  proto.getRemoteVaultId = function () { return this.vaultId; };
  proto.getRemoteVaultName = function () { return this.vaultName; };

  proto.setRemoteVaultName = async function (name) {
    this.vaultName = name;
    await this.saveData();
  };

  proto.init = function (app, plugin) {
    const self = this;
    this.app = app;
    this.vault = app.vault;
    this.plugin = plugin;
    this.settingTab = new (VIEWS().settings)(app, plugin, this);
    plugin.registerStatusBarItem();
    plugin.registerViewType(s16SyncWorkerName, (leaf) => new (VIEWS().changes)(leaf, self));
    plugin.registerGlobalCommand({
      id: "sync:setup",
      name: i18n.plugins.sync.actionSetupSync(),
      icon: "lucide-settings",
      checkCallback: (checking) => {
        if (!checking) self.openSettings();
        return !self.vaultId;
      },
    });
    plugin.registerGlobalCommand({
      id: "sync:view-version-history",
      name: i18n.plugins.sync.actionViewVersionHistory(),
      icon: "lucide-history",
      checkCallback: (checking) => {
        if (!self.vaultId) return false;
        const view = self.app.workspace.getActiveViewOfType(host.FileView);
        if (!view) return;
        if (!checking) self.showVersionHistory(view.file.path);
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "sync:open-sync-view",
      name: syncT().actionViewSyncSidebar(),
      icon: "lucide-rotate-ccw",
      checkCallback: (checking) => {
        if (!self.vaultId) return false;
        if (!checking) {
          self.app.workspace.ensureSideLeaf(s16SyncWorkerName, "right", { active: true, reveal: true });
        }
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "sync:open-sync-log",
      name: syncT().actionActivityLog(),
      icon: "lucide-align-left",
      checkCallback: (checking) => {
        if (!self.vaultId) return false;
        if (!checking) self.showSyncLog();
        return true;
      },
    });
    this.setStatus("Uninitialized");
  };

  proto.openChooseRemoteVaultModal = function () {
    new (VIEWS().remoteVaults)(this.app, this).open();
  };

  proto.connectToVault = function (vault) {
    const modal = new (VIEWS().connect)(this.app, this).connect(vault);
    modal.shouldAnimate = false;
    modal.open();
  };

  proto.onEnable = async function (app, plugin) {
    const self = this;
    const workspace = app.workspace;
    this.registerEvents();
    plugin.addSettingTab(this.settingTab);
    plugin.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
    workspace.onLayoutReady(async () => {
      await this.loadData();
      this.initialized = true;
      this.dataLoaded = true;
      this.requestSync();
      this.requestStatusBarUpdate();
    });
    this.timer = window.setInterval(this.requestSync.bind(this), 30000);
    this.on("status-change", () => self.requestStatusBarUpdate());

    let statusSegment = null;
    if (platform.isMobile) {
      workspace.onLayoutReady(() => {
        const header = workspace.rightSplit;
        self.statusIconEl = header.addHeaderButton("sync-small", self.openStatusIconMenu.bind(self));
        self.statusIconEl.addEventListener("contextmenu", self.openStatusIconMenu.bind(self));
        self.statusIconEl.addClass("sync-status-icon");
      });
    } else if (plugin.statusBarEl) {
      statusSegment = plugin.statusBarEl.createDiv("status-bar-item-segment");
      this.statusIconEl = statusSegment.createSpan("status-bar-item-icon sync-status-icon");
      plugin.statusBarEl.addEventListener("click", this.openStatusIconMenu.bind(this));
      plugin.statusBarEl.addEventListener("contextmenu", this.openStatusIconMenu.bind(this));
    }

    const assertSyncReady = () => {
      if (!this.vaultId) throw "Sync is not set up for this vault.";
      const status = this.getStatus();
      if (status === "paused") throw "Sync is paused. Resume sync to access version history.";
      if (status === "disconnected") throw "Sync is disconnected. Check your connection.";
      if (status === "error") throw "Sync is in error state. Check sync settings.";
    };

    plugin.registerCliHandler(
      "sync",
      "Pause or resume sync",
      {
        on: { description: "Resume sync" },
        off: { description: "Pause sync" },
      },
      (args) => {
        if (args.on) {
          if (self.pause) {
            self.setPause(false);
            return "Sync resumed.";
          }
          return "Sync is already running.";
        }
        if (args.off) {
          if (self.pause) return "Sync is already paused.";
          self.setPause(true);
          return "Sync paused.";
        }
        return `Sync is ${self.pause ? "paused" : "running"}.`;
      },
    );

    plugin.registerCliHandler(
      "sync:history",
      "List sync version history for a file",
      {
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
        total: { description: "Return version count" },
      },
      async (args) => {
        assertSyncReady();
        const file = app.cli.tryResolveFile(args);
        try {
          const result = await this.getHistory(file.path, null);
          const count = result.items.length;
          if (count === 0) return "No sync history found for this file.";
          if (args.total) return String(count) + (result.more ? "+" : "");
          const lines = [];
          for (let i = 0; i < count; i++) {
            const item = result.items[i];
            const ts = window.moment(item.ts).format("YYYY-MM-DD HH:mm:ss");
            const size = item.size > 0 ? ` (${item.size} bytes)` : "";
            const device = item.device ? ` [${item.device}]` : "";
            const deleted = item.deleted ? " [deleted]" : "";
            const related = item.relatedpath ? ` (renamed from ${item.relatedpath})` : "";
            lines.push(`${i}: ${ts}${size}${device}${deleted}${related}`);
          }
          if (result.more) lines.push("(more history available)");
          return lines.join("\n");
        } catch (e) {
          const err = e;
          throw "Failed to retrieve sync history: " + (err.message || err);
        }
      },
    );

    plugin.registerCliHandler(
      "sync:read",
      "Read a sync version",
      {
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
        version: { value: "<n>", description: "Version number", required: true },
      },
      async (args) => {
        assertSyncReady();
        const file = app.cli.tryResolveFile(args);
        const version = parseInt(args.version);
        if (isNaN(version) || version < 0) {
          throw "Invalid version number. Use sync:history to see available versions.";
        }
        try {
          const result = await this.getHistory(file.path, null);
          const items = result.items;
          if (version >= items.length) {
            throw `Version ${version} not found. File has ${items.length} versions (0-${items.length - 1}).`;
          }
          const item = items[version];
          const data = await this.getContentForVersion(item.uid);
          const content = utf8String(data);
          const ts = window.moment(item.ts).format("YYYY-MM-DD HH:mm:ss");
          return `${file.path} (version ${version}, ${ts})\n---\n${content}`;
        } catch (e) {
          const err = e;
          throw "Failed to retrieve version: " + (err.message || err);
        }
      },
    );

    plugin.registerCliHandler(
      "sync:restore",
      "Restore a sync version",
      {
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
        version: { value: "<n>", description: "Version number", required: true },
      },
      async (args) => {
        assertSyncReady();
        const file = app.cli.tryResolveFile(args);
        const version = parseInt(args.version);
        if (isNaN(version) || version < 0) {
          throw "Invalid version number. Use sync:history to see available versions.";
        }
        try {
          const result = await this.getHistory(file.path, null);
          const items = result.items;
          if (version >= items.length) {
            throw `Version ${version} not found. File has ${items.length} versions (0-${items.length - 1}).`;
          }
          if (version === 0) throw "Cannot restore to the current version.";
          const item = items[version];
          await this.restoreVersion(item.uid, file.path);
          const ts = window.moment(item.ts).format("YYYY-MM-DD HH:mm:ss");
          return `Restored ${file.path} to version ${version} (${ts}).`;
        } catch (e) {
          const err = e;
          throw "Failed to restore version: " + (err.message || err);
        }
      },
    );

    plugin.registerCliHandler(
      "sync:open",
      "Open sync history",
      {
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
      },
      async (args) => {
        assertSyncReady();
        const file = app.cli.tryResolveFile(args);
        await this.showVersionHistory(file.path);
        return `Opened sync history for ${file.path}.`;
      },
    );

    plugin.registerCliHandler(
      "sync:deleted",
      "List deleted files in sync",
      { total: { description: "Return deleted file count" } },
      async (args) => {
        assertSyncReady();
        const server = await this.getServer();
        if (!server) throw "Unable to connect to sync server.";
        const items = (await server.listDeleted()).reverse();
        if (items.length === 0) return "No deleted files found in sync history.";
        if (args.total) return String(items.length);
        const lines = [];
        for (const item of items) {
          const ts = window.moment(item.ts).format("YYYY-MM-DD HH:mm:ss");
          const size = item.size > 0 ? ` (${item.size} bytes)` : "";
          const device = item.device ? ` [${item.device}]` : "";
          lines.push(`${ts}: ${item.path}${size}${device}`);
        }
        return lines.join("\n");
      },
    );

    plugin.registerCliHandler("sync:status", "Show sync status", null, async () => {
      const status = this.getStatus();
      if (!this.vaultId) return `status: ${status}\nSync is not set up for this vault.`;
      const lines = [`status: ${status}`];
      if (this.vaultName) lines.push(`vault: ${this.vaultName}`);
      if (this.deviceName) lines.push(`device: ${this.deviceName}`);
      try {
        const size = await this.size();
        if (size.size >= 0) {
          lines.push(`vault size: ${formatBytes(size.vault_size)}`);
          lines.push(`account usage: ${formatBytes(size.size)} / ${formatBytes(size.limit)}`);
        }
      } catch (e) {
        // size lookup failed; report what we have
      }
      return lines.join("\n");
    });
  };

  proto.onDisable = function () {
    if (this.server) {
      this.server.disconnect();
      this.server = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = 0;
    }
    if (this.statusIconEl) this.statusIconEl.detach();
    this.unregisterEvents();
  };

  proto.onFileMenu = function (menu, file, source) {
    const self = this;
    if (!(file instanceof host.TFile)) return;
    if (source !== "tab-header" && source !== "more-options" && source !== "file-explorer-context-menu") return;
    menu.addItem((item) =>
      item
        .setSection("view")
        .setTitle(syncT().menuOptViewVersionHistory())
        .setIcon("lucide-history")
        .onClick(() => self.showVersionHistory(file.path)),
    );
  };

  proto.openStatusIconMenu = function (event) {
    const self = this;
    const menu = host.Menu.forEvent(event);
    menu.addSections(["status", "selection", "", "global"]);
    const activeFile = this.app.workspace.getActiveFile();
    menu.addItem((item) =>
      item
        .setSection("status")
        .setTitle(syncT().labelSyncStatus({ status: self.syncStatus }))
        .setIsLabel(true)
        .removeIcon()
        .titleEl.addClass("u-small"),
    );
    if (this.vaultId) {
      const paused = this.pause;
      menu
        .addItem((item) =>
          item
            .setSection("status")
            .setTitle(syncT()(paused ? "button-resume" : "button-pause"))
            .setIcon(paused ? "lucide-play-circle" : "paused")
            .onClick(() => self.setPause(!paused)),
        )
        .addItem((item) =>
          item
            .setTitle(syncT().labelVersionHistory())
            .setIcon("lucide-history")
            .setSection("selection")
            .setDisabled(!activeFile)
            .onClick(() => {
              if (activeFile) self.showVersionHistory(activeFile.path);
            }),
        )
        .addItem((item) =>
          item
            .setTitle(syncT().optionSyncLog())
            .setIcon("lucide-align-left")
            .setSection("global")
            .onClick(() => self.showSyncLog()),
        )
        .addItem((item) =>
          item
            .setTitle(syncT().optionViewDeletedFiles())
            .setIcon("lucide-trash-2")
            .setSection("global")
            .onClick(() => self.showDeletedFiles()),
        )
        .addItem((item) =>
          item
            .setTitle(i18n.interface.settings())
            .setIcon("lucide-settings")
            .setSection("global")
            .onClick(() => self.openSettings()),
        );
    } else {
      menu.addItem((item) =>
        item
          .setTitle(i18n.interface.settings())
          .setIcon("lucide-settings")
          .onClick(() => self.openSettings()),
      );
    }
    menu.setParentElement(this.statusIconEl).showAtMouseEvent(event);
  };

  proto.loadData = async function () {
    let record = null;
    try {
      const opened = await host.openMetadataDb(this.app.appId + "-sync", 1, {
        upgrade: (db) => {
          if (!db.objectStoreNames.contains("data")) db.createObjectStore("data");
        },
      });
      this.db = opened;
      record = await opened.get("data", "data");
    } catch (e) {
      console.error("Failed to load sync data", e);
    }
    if (!record) return;

    let dataVer = 0;
    try {
      this.vaultId = record.vaultId;
      this.vaultName = record.vaultName;
      this.encryptionVersion = record.encryptionVersion || 0;
      this.key = decodeBase64(record.key);
      this.salt = record.salt;
      this.host = record.host;
      this.deviceName = record.deviceName || "";
      this.userId = record.userId || -1;
      this.pause = !!record.pause;
      this.version = record.version || 0;
      this.initial = record.initial === undefined || !!record.initial;
      this.localFiles = record.local || {};
      this.serverFiles = record.remote || {};
      this.newServerFiles = record.pending || [];
      const appIdMismatch = record.appId && record.appId !== this.app.appId;
      if (appIdMismatch) {
        this.pause = true;
        this.version = 0;
        this.initial = true;
        this.localFiles = {};
        this.serverFiles = {};
        this.newServerFiles = [];
      }
      this.fileRetry = {};
      this.filterCache = {};
      this.skippedFiles = {};
      this.allowTypes = new Set(record.allowTypes || env().gk);
      this.allowSpecialFiles = new Set(record.allowSpecialFiles || []);
      this.ignoreFolders = record.ignoreFolders || [];
      this.preventSleep = record.preventSleep || false;
      if (!Object.hasOwn(record, "conflictAction") || (record.conflictAction !== "merge" && record.conflictAction !== "conflict")) {
        this.conflictAction = "merge";
      } else {
        this.conflictAction = record.conflictAction;
      }
      dataVer = record.dataVer || 0;
    } catch (e) {
      console.error(e);
    }

    this.scanFiles();
    if (this.vault.getRoot().children.length === 0) {
      this.pause = true;
      this.setStatus("Error");
      this.log(
        "Empty vault detected, sync paused to prevent accidental data loss. Resuming Sync may delete all files from your remote vault. See https://github.com/FalconTechDev/basalt/wiki for more details.",
      );
    }

    // `remote`/`local` bookkeeping carried over from older data versions; the
    // original read a nonexistent `localFiles` member off the file map, which
    // threw inside the try and skipped the migration — kept verbatim.
    const remote = this.serverFiles;
    const local = remote.localFiles;
    try {
      if (dataVer < 1) {
        for (const path in remote) {
          if (Object.hasOwn(remote, path) && !Object.hasOwn(local, path) && path.toLowerCase().endsWith(".canvas")) {
            const file = remote[path];
            if (!file.folder) this.newServerFiles.push(file);
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
    try {
      if (dataVer < 2) {
        for (const path in remote) {
          if (Object.hasOwn(remote, path) && !Object.hasOwn(local, path) && path.toLowerCase().endsWith(".base")) {
            const file = remote[path];
            if (!file.folder) this.newServerFiles.push(file);
          }
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  proto.saveData = async function () {
    if (!this.dirty) return;
    this.dirty = false;
    const data = {};
    data.appId = this.app.appId;
    data.vaultId = this.vaultId;
    data.vaultName = this.vaultName;
    data.key = encodeBase64(this.key);
    data.salt = this.salt;
    data.encryptionVersion = this.encryptionVersion;
    data.host = this.host;
    data.deviceName = this.deviceName;
    data.userId = this.userId;
    data.pause = this.pause;
    data.version = this.version;
    data.initial = this.initial;
    data.local = this.localFiles;
    data.remote = this.serverFiles;
    data.pending = this.newServerFiles;
    data.allowTypes = Array.from(this.allowTypes);
    data.allowSpecialFiles = Array.from(this.allowSpecialFiles);
    data.ignoreFolders = this.ignoreFolders;
    data.preventSleep = this.preventSleep;
    data.conflictAction = this.conflictAction;
    data.dataVer = 2;
    await this.db.put("data", data, "data");
  };

  proto.getDefaultDeviceName = function () {
    return platform.deviceName || "Unknown";
  };

  proto.setup = async function (vaultId, vaultName, password, salt, hostName, encryptionVersion) {
    this.vaultId = vaultId;
    this.vaultName = vaultName;
    this.key = await deriveScryptKey(password, salt);
    this.salt = salt;
    this.encryptionVersion = encryptionVersion;
    this.host = hostName;
    this.clear();
    this.scanFiles();
    await this.saveData();
    this.requestSync();
  };

  proto.unsetup = async function () {
    this.vaultId = null;
    this.vaultName = null;
    this.key = null;
    this.salt = null;
    this.encryptionVersion = -1;
    this.encryptionProvider = null;
    this.host = null;
    this.clear();
    this.setStatus("Uninitialized");
    await this.saveData();
  };

  proto.clear = function () {
    this.dirty = true;
    this.version = 0;
    this.initial = true;
    this.serverFiles = {};
    this.newServerFiles = [];
    this.fileRetry = {};
    this.ignoreFolders = [];
    this.filterCache = {};
    this.skippedFiles = {};
    this.allowTypes = new Set(env().gk);
    this.allowSpecialFiles = new Set(env().yk);
    const server = this.server;
    if (server) {
      server.disconnect();
      this.server = null;
    }
    this.gettingServer = null;
    this.backoff.success();
  };

  proto.setVaultName = function (name) {
    this.vaultName = name;
    this.forceSaveData();
  };

  proto.setPause = function (pause) {
    this.pause = pause;
    if (pause) {
      this.setStatus("Paused");
      this.log("Paused");
    } else {
      this.setStatus("Resumed");
      this.log("Resumed. Detecting changes...");
    }
    this.dirty = true;
    this.saveData();
    this.requestSync();
  };

  proto.getPause = function () { return this.pause; };

  proto.changeFilter = function (change) {
    const serverFiles = this.serverFiles;
    const pending = this.newServerFiles;
    const rejected = [];
    for (const path in serverFiles) {
      if (serverFiles.hasOwnProperty(path)) {
        const file = serverFiles[path];
        if (!this.allowSyncFile(file.path, file.folder)) rejected.push(file);
      }
    }
    change();
    this.filterCache = {};
    this.skippedFiles = {};
    const accepted = [];
    for (const file of rejected) {
      if (this.allowSyncFile(file.path, file.folder)) accepted.push(file);
    }
    accepted.sort((a, b) => a.path.length - b.path.length);
    pending.unshift(...accepted);
  };

  proto.log = function (info, file, isError = false) {
    this.logTags(info, "", file, isError);
  };
  proto.logMerge = function (info, file, isError = false) {
    this.logTags(info, "merge", file, isError);
  };
  proto.logSkip = function (info, file) {
    const skipped = this.skippedFiles;
    if (Object.hasOwn(skipped, file) && skipped[file] === info) return;
    skipped[file] = info;
    this.logTags(info, "skip", file, true);
  };

  proto.logTags = function (info, type, file, isError = false) {
    const log = this.syncLog;
    if (info === "Fully synced" && log.last() && log.last().info === info) return;
    log.push({ file, info, ts: Date.now(), error: isError, type });
    if (log.length > env().lee) log.splice(0, 100);
    this.trigger("new-log");
  };

  proto.scanFiles = function () {
    const vault = this.vault;
    const localFiles = this.localFiles;
    const stack = [vault.getRoot()];
    while (stack.length) {
      const item = stack.pop();
      this.onFileAdd(item);
      if (item instanceof host.TFolder) {
        for (const child of item.children) stack.push(child);
      }
    }
    for (const path in localFiles) {
      if (localFiles.hasOwnProperty(path) && !path.startsWith(".")) {
        if (!vault.getAbstractFileByPath(path)) delete localFiles[path];
      }
    }
    this.scanSpecialFiles = true;
  };

  proto.setIgnoreFolders = function (folders) {
    const self = this;
    this.changeFilter(() => {
      self.ignoreFolders = folders;
    });
    this.forceSaveData();
    this.requestSync();
  };

  proto.setSyncType = function (type, enabled) {
    const self = this;
    if (this.allowTypes.has(type) === enabled) return;
    this.changeFilter(() => {
      if (enabled) self.allowTypes.add(type);
      else self.allowTypes.delete(type);
    });
    this.forceSaveData();
    this.requestSync();
  };

  proto.setAllowSpecialFile = function (type, enabled) {
    const self = this;
    if (this.allowSpecialFiles.has(type) === enabled) return;
    this.changeFilter(() => {
      if (enabled) self.allowSpecialFiles.add(type);
      else self.allowSpecialFiles.delete(type);
    });
    this.forceSaveData();
    this.requestSync();
  };

  proto.registerEvents = function () {
    this.vault.on("create", this.boundOnFileAdd);
    this.vault.on("modify", this.boundOnFileAdd);
    this.vault.on("delete", this.boundOnFileRemove);
    this.vault.on("rename", this.boundOnFileRename);
    this.vault.on("raw", this.boundOnRaw);
  };

  proto.unregisterEvents = function () {
    this.vault.off("create", this.boundOnFileAdd);
    this.vault.off("modify", this.boundOnFileAdd);
    this.vault.off("delete", this.boundOnFileRemove);
    this.vault.off("rename", this.boundOnFileRename);
    this.vault.off("raw", this.boundOnRaw);
  };

  proto.onFileAdd = function (file) {
    const path = file.path;
    if (path === "/") return;
    const localFiles = this.localFiles;
    let record = localFiles[path];
    if (!record) {
      record = localFiles[path] = {
        path,
        previouspath: "",
        folder: false,
        ctime: 0,
        mtime: 0,
        size: 0,
        hash: "",
        synctime: 0,
        synchash: "",
      };
    }
    record.path = path;
    if (file instanceof host.TFolder) {
      record.folder = true;
      record.ctime = 0;
      record.mtime = 0;
      record.size = 0;
      record.hash = "";
    } else if (file instanceof host.TFile) {
      record.folder = false;
      const stat = file.stat;
      const mtime = Math.ceil(stat.mtime);
      const ctime = Math.ceil(stat.ctime);
      const size = stat.size;
      if (!(record.mtime && record.mtime === mtime && record.size === stat.size)) record.hash = "";
      record.mtime = mtime;
      record.ctime = ctime;
      record.size = size;
    }
    this.requestSync();
  };

  proto.onFileRemove = function (file) {
    delete this.localFiles[file.path];
    delete this.skippedFiles[file.path];
    this.requestSync();
  };

  proto.onFileRename = function (file, oldPath) {
    const localFiles = this.localFiles;
    const record = localFiles[oldPath];
    localFiles[file.path] = record;
    delete localFiles[oldPath];
    delete this.skippedFiles[oldPath];
    delete this.skippedFiles[file.path];
    record.path = file.path;
    if (!record.previouspath) record.previouspath = oldPath;
    record.synctime = 0;
    this.onFileAdd(file);
    this.setDirty();
    this.requestSync();
  };

  proto.onRaw = function (path) {
    if (!path.startsWith(this.vault.configDir + "/")) return;
    const queue = this.scanSpecialFileQueue;
    if (queue.contains(path)) return;
    queue.push(path);
    this.requestSync();
  };

  proto.onPushedFile = function (entry) {
    this.version = entry.uid;
    if (this.initial && entry.deleted) return;
    const path = entry.path;
    const record = {
      path: entry.path,
      size: entry.size,
      hash: entry.hash,
      ctime: entry.ctime,
      mtime: entry.mtime,
      folder: entry.folder,
      deleted: entry.deleted,
      uid: entry.uid,
      device: entry.device,
      user: entry.user,
    };
    if (this.initial) record.initial = true;
    const pending = this.newServerFiles;
    if (entry.wasJustPushed) {
      for (let i = 0; i < pending.length; i++) {
        if (pending[i].path === path) {
          pending.splice(i, 1);
          i -= 1;
        }
      }
      this.serverFiles[path] = record;
      this.setDirty();
      return;
    }
    this.log("Server pushed" + (entry.folder ? " (folder)" : "") + (entry.deleted ? " (deleted or renamed)" : "") + (entry.device ? " [" + entry.device + "]" : ""), entry.path);
    pending.push(record);
    this.requestSync();
  };

  proto.allowSyncFile = function (path, isFolder) {
    const cache = this.filterCache;
    if (cache.hasOwnProperty(path)) return cache[path];
    return (cache[path] = this._allowSyncFile(path, isFolder));
  };

  proto._allowSyncFile = function (path, isFolder) {
    for (const folder of this.ignoreFolders) {
      if ((isFolder && path === folder) || path.startsWith(folder + "/")) return false;
    }
    if (!isFolder && path.startsWith(this.vault.configDir + "/")) {
      const inner = path.substring((this.vault.configDir + "/").length);
      const parts = inner.split("/");
      if (parts.some((part) => part === "node_modules" || part.startsWith("."))) return false;
      const name = lastSegment(inner);
      const ext = extensionOf(name);
      let special = null;
      if (inner === "workspace.json" || inner === "workspace-mobile.json") {
        // never synced
      } else if (inner === "app.json" || inner === "types.json") {
        special = "app";
      } else if (inner === "appearance.json") {
        special = "appearance";
      } else if (inner === "hotkeys.json") {
        special = "hotkey";
      } else if (inner === "core-plugins.json" || inner === "core-plugins-migration.json") {
        special = "core-plugin";
      } else if (inner === "community-plugins.json") {
        special = "community-plugin";
      } else if (
        parts[0] === "themes" &&
        parts.length === 3 &&
        (name === "theme.css" || name === "manifest.json")
      ) {
        special = "appearance-data";
      } else if (parts[0] === "snippets" && parts.length === 2 && ext === "css") {
        special = "appearance-data";
      } else if (parts.length === 1 && ext === "json") {
        special = "core-plugin-data";
      } else if (parts[0] === "plugins" && parts.length === 3 && isPluginFileName(name)) {
        special = "community-plugin-data";
      }
      return !!special && this.allowSpecialFiles.has(special);
    }
    if (path.startsWith(".")) return false;
    if (isFolder) return true;
    if (path.startsWith(".")) return false;
    const ext = extensionOf(lastSegment(path));
    if (ext === "md" || ext === "canvas" || ext === "base") return true;
    const allow = this.allowTypes;
    if (host.imageExtensions.contains(ext)) return allow.has("image");
    if (ext === "webm") return allow.has("audio") || allow.has("video");
    if (host.audioExtensions.contains(ext)) return allow.has("audio");
    if (host.videoExtensions.contains(ext)) return allow.has("video");
    if (host.pdfExtensions.contains(ext)) return allow.has("pdf");
    return !!allow.has("unsupported");
  };

  proto.canSyncPath = function (since, path) {
    const retries = this.fileRetry;
    for (const key in retries) {
      if (retries.hasOwnProperty(key) && retries[key].ts > since && path.startsWith(key)) return false;
    }
    return true;
  };

  proto.canSyncLocalFile = function (since, record) {
    if (!record.synctime) return true;
    const size = record.size;
    const interval = size > 10240 ? (size > 102400 ? 30 : 20) : 10;
    return since - record.synctime > 1000 * interval;
  };

  proto.getHost = function () {
    const hostName = this.host || "127.0.0.1:3003";
    return hostName.startsWith("127.0.0.1") || hostName.startsWith("localhost") ? "ws://" + hostName : "wss://" + hostName;
  };

  proto.setStatus = function (status) {
    this.syncStatus = status;
    this.trigger("status-change");
  };

  proto.getStatus = function () {
    if (!this.initialized) return "uninitialized";
    if (!this.vaultId) return "disconnected";
    if (this.error || Object.keys(this.fileRetry).length > 0) return "error";
    if (this.pause) return "paused";
    if (this.syncing) return "syncing";
    return "synced";
  };

  proto.failedSync = function (message) {
    const path = this.syncingPath;
    this.log(message, path, true);
    if (!path) return;
    const retries = this.fileRetry;
    const now = Date.now();
    let retry = retries[path];
    if (!retry) retry = retries[path] = { count: 0, error: "", ts: 0 };
    retry.error = message;
    const count = (retry.count = retry.count + 1);
    let delay = 5 * Math.pow(2, count) * 1000;
    delay = Math.min(delay, 300000);
    retry.ts = now + delay;
  };

  proto.requestSync = async function () {
    if (this.syncing) return;
    this.syncing = true;
    this.error = false;
    this.trigger("status-change");
    await host.sleep(50);
    let keepAwake = null;
    let keepRunning = true;
    try {
      while (keepRunning && this.plugin.enabled && !this.pause && this.vaultId) {
        if (!keepAwake && host.s16Em && this.preventSleep) keepAwake = host.s13KeepAwake();
        try {
          this.error = false;
          this.syncingPath = null;
          keepRunning = await this._sync();
          const syncedPath = this.syncingPath;
          if (syncedPath) delete this.fileRetry[syncedPath];
        } catch (e) {
          console.log("Sync Error!");
          console.error(e);
          this.error = true;
          this.failedSync(e.message);
          keepRunning = false;
          this.trigger("status-change");
        }
        if (this.dirty) this.requestSaveData();
        let wait = 0;
        if (this.server) {
          const elapsed = Date.now() - this.server.lastNetworkRequestTs;
          wait = Math.max(0, 50 - elapsed);
        }
        await host.sleep(wait);
      }
    } finally {
      if (keepAwake) keepAwake.release();
      this.syncing = false;
      this.trigger("status-change");
    }
  };

  proto.getServer = function () {
    let pending = this.gettingServer;
    if (!pending) {
      this.gettingServer = pending = this.asyncGetServer();
      const clear = () => {
        this.gettingServer = null;
      };
      pending.then(clear, clear);
    }
    return pending;
  };

  proto.asyncGetServer = async function () {
    let server = this.server;
    // Keep an existing server only while it is connected or connecting; a dead
    // socket is disconnected, dropped and pushed through the backoff.
    if (server && !server.isConnected() && !server.isConnecting()) {
      server.disconnect();
      server = this.server = null;
      this.backoff.fail();
    }
    if (!server) {
      if (this.encryptionProvider || !this.key) return null;
      try {
        this.encryptionProvider = await initCipher(this.encryptionVersion, this.key, this.salt);
      } catch (e) {
        console.error(e);
        this.log("Unable to decrypt vault", null, true);
        this.error = true;
        this.backoff.fail();
        return null;
      }
      if (!(this.host && account.token && this.vaultId && this.encryptionProvider)) return null;
      server = this.server = new (env().hee)(this.encryptionProvider);
    }
    if (!server.hasConnection()) {
      this.setStatus("Connecting to server");
      this.log("Connecting to server");
      this.ready = false;
      try {
        const deviceName = this.deviceName || this.getDefaultDeviceName();
        await server.connect(
          this.getHost(),
          account.token,
          this.vaultId,
          this.version,
          this.initial,
          deviceName,
          (serverVersion) => {
            this.log("Connection successful. Detecting changes...");
            this.ready = true;
            if (this.initial) this.initial = false;
            if (this.version < serverVersion) this.version = serverVersion;
            this.dirty = true;
            this.requestSaveData();
            this.requestSync();
          },
          this.onPushedFile.bind(this),
        );
        this.backoff.success();
      } catch (e) {
        const err = e;
        if (err.message && err.message.contains("Your subscription to Basalt Sync has expired")) {
          new host.Notice(err.message);
        } else if (err.message && err.message.contains("Vault not found")) {
          new host.Notice(syncT().msgDisconnectFromDeletedVault());
          await this.unsetup();
        }
        console.error(err);
        this.log(err.message, null, true);
        server.disconnect();
        server = this.server = null;
        this.error = true;
        this.backoff.fail();
        return null;
      }
    }
    this.userId = server.userId;
    return server;
  };

  proto._sync = async function () {
    const self = this;
    if (this.pause) return false;
    if (!this.backoff.isReady()) {
      this.log("Waiting to connect to server");
      return false;
    }
    if (!account.token) throw new Error("Not logged in");
    const server = await this.getServer();
    if (!server) return false;
    if (this.pause || !this.vaultId) return false;

    const localFiles = this.localFiles;
    const serverFiles = this.serverFiles;
    const pending = this.newServerFiles;
    const vault = this.vault;
    const adapter = vault.adapter;
    const since = Date.now();
    let deferred = 0;
    this.setStatus("Indexing...");
    const configDir = vault.configDir;
    const configPrefix = configDir + "/";

    // One-time scan of dot-prefixed config files after (re)connect. Any failure
    // here is logged and the rest of the sync cycle continues.
    try {
      const hiddenLocal = {};
      if (this.scanSpecialFiles) {
        this.scanSpecialFiles = false;
        this.setStatus("Initializing...");
        const queue = (this.scanSpecialFileQueue = []);
        for (const path in localFiles) {
          if (localFiles.hasOwnProperty(path) && path.startsWith(".")) {
            hiddenLocal[path] = localFiles[path];
            delete localFiles[path];
          }
        }
        if (await adapter.exists(configDir)) {
          queue.push(configPrefix + "config");
          const listing = await adapter.list(configDir);
          for (const file of listing.files) {
            if (extensionOf(file) === "json") queue.push(file);
          }
          if (await adapter.exists(configPrefix + "themes")) {
            const themes = await adapter.list(configPrefix + "themes");
            for (const folder of themes.folders) {
              const inner = await adapter.list(folder);
              for (const file of inner.files) {
                const name = lastSegment(file);
                if (name === "manifest.json" || name === "theme.css") queue.push(file);
              }
            }
          }
          if (await adapter.exists(configPrefix + "snippets")) {
            const snippets = await adapter.list(configPrefix + "snippets");
            for (const file of snippets.files) {
              if (extensionOf(file) === "css") queue.push(file);
            }
          }
          if (await adapter.exists(configPrefix + "plugins")) {
            const plugins = await adapter.list(configPrefix + "plugins");
            for (const folder of plugins.folders) {
              const inner = await adapter.list(folder);
              for (const file of inner.files) {
                if (isPluginFileName(lastSegment(file))) queue.push(file);
              }
            }
          }
          this.forceSaveData();
        }
        while (queue.length > 0) {
          const path = queue.pop();
          if (!(await adapter.exists(path))) {
            delete localFiles[path];
            continue;
          }
          const stat = await adapter.stat(path);
          if (stat && stat.type === "file") {
            let record = localFiles[path];
            if (!record) {
              record = localFiles[path] = hiddenLocal.hasOwnProperty(path)
                ? (localFiles[path] = hiddenLocal[path])
                : {
                    path,
                    previouspath: "",
                    ctime: 0,
                    mtime: 0,
                    size: 0,
                    folder: false,
                    hash: "",
                    synchash: "",
                    synctime: 0,
                  };
            }
            const mtime = Math.ceil(stat.mtime);
            const ctime = Math.ceil(stat.ctime);
            const size = stat.size;
            if (!(record.mtime && record.mtime === mtime && record.size === stat.size)) record.hash = "";
            record.mtime = mtime;
            record.ctime = ctime;
            record.size = size;
          } else {
            delete localFiles[path];
          }
        }
      }
    } catch (e) {
      console.error("Failed to scan config files", e);
    }

    // ---- apply server-pushed changes (pending queue), one accepted entry
    // causes the whole sync cycle to end, like the original ----------
    if (pending.length > 0) {
      const acceptEntry = (index, entry, path, localRecord, silent, skipStore) => {
        if (!silent) self.log("Accepted", path);
        if (localRecord) localRecord.synctime = Date.now();
        if (!skipStore) serverFiles[path] = entry;
        pending.splice(index, 1);
        self.setDirty();
        return true;
      };

      const processPending = async (index) => {
        const entry = pending[index];
        const path = entry.path;
        const serverRecord = serverFiles[path];
        const localRecord = localFiles[path];
        const accept = (silent, skipStore) => ({
          value: acceptEntry(index, entry, path, localRecord, silent, skipStore),
        });

        if (!self.allowSyncFile(path, entry.folder)) {
          return accept(true);
        }
        if (!s05IsValidFileName(path) || (platform.isAndroidApp && /[*?<>"]/.test(path))) {
          self.log("Ignoring remote file name with illegal characters", path, true);
          new host.Notice(`Sync: Unable to download file with illegal name "${path}"`);
          return accept(true, true);
        }
        if (normalizePath(path).split("/").contains("..")) {
          return accept(true);
        }
        if (!self.canSyncPath(since, path)) {
          deferred += 1;
          return "continue";
        }
        self.syncingPath = path;
        if (!(localRecord && !localRecord.folder && !localRecord.hash)) {
          // record already has a hash (or is missing/folder): skip compute
        } else {
          self.getHashFromMetadataCache(localRecord);
          if (!localRecord.hash) {
            self.setStatus("Computing hash " + path);
            await self.updateHash(localRecord);
          }
        }
        if (localRecord && !localRecord.folder && !entry.folder && localRecord.hash === entry.hash) {
          return accept(true);
        }
        for (let i = index + 1; i < pending.length; i++) {
          if (pending[i].path === path) {
            self.log("Skipped", path);
            return accept(true, true);
          }
        }
        if (!localRecord) {
          if (entry.deleted) return accept(true);
          self.setStatus("Downloading " + path);
          if (!platform.isAndroidApp) {
            await self.syncFileDown(server, entry);
          } else {
            try {
              await self.syncFileDown(server, entry);
            } catch (e) {
              const err = e;
              if (err && typeof err.message === "string" && err.message.contains("FILE_NOTCREATED")) {
                self.log("Ignoring remote file name with illegal characters", path, true);
                new host.Notice(`Sync: Unable to download file with illegal name "${path}"`);
                return accept(true, true);
              }
              throw err;
            }
          }
          return accept();
        }

        // ---- local record exists ----
        if (localRecord.folder && entry.folder) {
          if (!entry.deleted) return accept(true);
          const existing = vault.getAbstractFileByPath(path);
          if (!existing) return accept(true);
          if (existing instanceof host.TFolder && existing.children.length > 0) return accept(true);
          self.setStatus("Deleting " + path);
          self.log("Deleting", path);
          try {
            await vault.delete(existing, true);
          } catch (e) {
            const err = e;
            const message = (err && err.message) || "Failed to delete folder";
            self.log(message, path, true);
          }
          return accept(true);
        }

        if (serverRecord && (localRecord.folder && serverRecord.folder || localRecord.hash === serverRecord.hash)) {
          if (entry.deleted) {
            self.setStatus("Deleting " + path);
            const existing = vault.getAbstractFileByPath(path);
            if (existing) {
              self.log("Deleting", path);
              await vault.delete(existing);
            } else {
              self.log("Deleting", path);
              await adapter.remove(path);
            }
          } else {
            self.setStatus("Downloading " + path);
            await self.syncFileDown(server, entry);
          }
          return accept();
        }

        if (!(localRecord.folder || !entry.folder)) {
          // local file vs incoming folder: rename the local file aside
          const existing = vault.getAbstractFileByPath(path);
          if (existing instanceof host.TFile) {
            const ext = existing.extension;
            const suffix = ext ? path.substr(path.length - ext.length - 1) : "";
            const base = path.substr(0, path.length - suffix.length);
            const renamed = base + " (Conflicted copy)" + suffix;
            self.setStatus("Renaming conflicted file " + path);
            self.log("Renaming conflicted file", path);
            await vault.rename(existing, renamed);
            self.setDirty();
            return { value: true };
          }
        }

        if (entry.initial && entry.mtime > localRecord.mtime) {
          self.setStatus("Downloading " + path);
          await self.syncFileDown(server, entry);
          return accept();
        }

        // ---- markdown three-way merge ----
        if (
          entry.initial ||
          localRecord.folder ||
          entry.folder ||
          entry.deleted ||
          extensionOf(path) !== "md" ||
          entry.hash === localRecord.synchash
        ) {
          // not a merge candidate: fall through to config-json handling
        } else {
          self.setStatus("Merging " + path);
          self.logMerge("Merging conflicted file", path);
          const existing = vault.getAbstractFileByPath(path);
          if (!(existing instanceof host.TFile)) {
            self.logMerge("Merge failed.", path, true);
            return accept(true);
          }
          let localText;
          try {
            localText = await vault.read(existing);
          } catch (e) {
            const err = e;
            self.logMerge("Merge failed. " + err.toString(), path, true);
            return accept(true);
          }
          if (!localText) {
            await self.syncFileDown(server, entry);
            return accept();
          }
          let serverPrevText = "";
          if (serverRecord && !serverRecord.deleted) {
            try {
              serverPrevText = utf8String(await server.pull(serverRecord.uid));
            } catch (e) {
              const err = e;
              self.logMerge("Merge failed. " + err.toString(), path, true);
              return accept(true);
            }
          }
          let serverText;
          try {
            serverText = utf8String(await server.pull(entry.uid));
          } catch (e) {
            const err = e;
            self.logMerge("Merge failed. " + err.toString(), path, true);
            return accept(true);
          }
          if (serverPrevText === serverText || localText === serverText) {
            return accept();
          }
          if (!serverText) {
            return accept();
          }
          if (self.conflictAction === "conflict") {
            const stamp = window.moment().format("YYYYMMDDHHmm");
            const tag = s35SyncDeviceTag(self.deviceName || self.getDefaultDeviceName());
            const target = vault.getAvailablePath(
              withoutExtension(path) + " (Conflicted copy " + tag + " " + stamp + ")",
              extensionOf(path),
            );
            try {
              await vault.create(target, localText, { ctime: existing.stat.ctime, mtime: existing.stat.mtime });
              await vault.modify(existing, serverText, { ctime: entry.ctime, mtime: entry.mtime });
              self.logMerge("Conflicted copy stored", path);
            } catch (e) {
              // conflicted-copy failure still accepts the entry
            }
            return accept();
          }
          if (serverPrevText) {
            self.app.fileManager.storeTextFileBackup(path, localText);
            const merged = s10MergeText(serverPrevText, localText, serverText, host);
            await vault.modify(existing, merged);
            self.logMerge("Merge successful", path);
            return accept();
          }
          if (Math.abs(Date.now() - localRecord.ctime) < 180000) {
            self.app.fileManager.storeTextFileBackup(path, localText);
            self.setStatus("Downloading " + path);
            await vault.modify(existing, serverText, { ctime: entry.ctime, mtime: entry.mtime });
            return accept();
          }
          if (entry.mtime > localRecord.mtime) {
            self.app.fileManager.storeTextFileBackup(path, localText);
            self.setStatus("Downloading " + path);
            await vault.modify(existing, serverText, { ctime: entry.ctime, mtime: entry.mtime });
            return accept();
          }
          return accept();
        }

        // ---- config-file JSON merge (local keys win, remote fills gaps) ----
        if (entry.folder || entry.deleted || !(entry.size > 0) || !path.startsWith(configPrefix)) {
          self.log("Rejected server change", path);
          return accept(true);
        }
        if (extensionOf(path) !== "json") {
          await self.syncFileDown(server, entry);
          return accept();
        }
        try {
          self.setStatus("Merging " + path);
          self.log("Merging conflicted file", path);
          const localJson = JSON.parse(await adapter.read(path));
          if (localJson && !Array.isArray(localJson) && typeof localJson === "object") {
            const remoteJson = JSON.parse(utf8String(await server.pull(entry.uid)));
            if (remoteJson && !Array.isArray(remoteJson) && typeof remoteJson === "object") {
              for (const key in remoteJson) {
                if (remoteJson.hasOwnProperty(key)) localJson[key] = remoteJson[key];
              }
              let out = utf8Bytes(JSON.stringify(localJson, undefined, 2));
              if (path === self.vault.configDir + "/core-plugins.json") {
                const patched = self.patchCorePluginsFile(out);
                if (patched !== out) {
                  out = patched;
                  self.log("Fixing core plugins list", path);
                }
              }
              await adapter.writeBinary(path, out);
              self.log("Merge successful", path);
              return accept(true);
            }
          }
        } catch (e) {
          const err = e;
          self.log("Merge failed. " + err.toString(), path, true);
        }
        await self.syncFileDown(server, entry);
        return accept();
      };

      for (let index = 0; index < pending.length; ) {
        const result = await processPending(index);
        if (typeof result === "object") return result.value;
        index += 1;
      }
    }

    if (!this.ready) return false;

    // ---- push local deletions, deepest path first (one per cycle) ----
    let deleteFile = null;
    let deleteFolder = null;
    for (const path in serverFiles) {
      if (!serverFiles.hasOwnProperty(path)) continue;
      const record = serverFiles[path];
      if (localFiles.hasOwnProperty(path)) continue;
      if (record.deleted) {
        delete serverFiles[path];
        continue;
      }
      if (!this.allowSyncFile(path, record.folder)) continue;
      if (record.folder) {
        if (!deleteFolder || record.path.length > deleteFolder.path.length) deleteFolder = record;
      } else if (!deleteFile || record.path.length > deleteFile.path.length) {
        deleteFile = record;
      }
    }
    if (deleteFile) {
      const path = deleteFile.path;
      this.setStatus("Deleting remote file " + path);
      this.log("Deleting remote file", path);
      this.syncingPath = path;
      await server.push(path, null, false, true, 0, 0, "", null);
      deleteFile.deleted = true;
      this.setDirty();
      return true;
    }
    if (deleteFolder) {
      const path = deleteFolder.path;
      this.setStatus("Deleting remote folder " + path);
      this.log("Deleting remote folder", path);
      this.syncingPath = path;
      await server.push(path, null, true, true, 0, 0, "", null);
      deleteFolder.deleted = true;
      this.setDirty();
      return true;
    }

    // ---- upload one changed local file/folder per cycle ----
    let uploadFolder = null;
    let uploadFile = null;
    for (const path in localFiles) {
      if (!localFiles.hasOwnProperty(path)) continue;
      const local = localFiles[path];
      const remote = serverFiles[path];
      const changed =
        !remote ||
        remote.deleted ||
        local.folder !== remote.folder ||
        local.ctime !== remote.ctime ||
        local.mtime !== remote.mtime ||
        local.size !== remote.size ||
        !local.hash ||
        local.hash !== remote.hash;
      if (!changed || !this.allowSyncFile(path, local.folder)) continue;
      if (!this.canSyncPath(since, path)) continue;
      if (env().see && !local.folder && remote && remote.ctime && (local.ctime === 0 || local.ctime > remote.ctime) && !remote.folder && !remote.deleted) {
        local.ctime = remote.ctime;
      }
      if (!local.folder && local.size > server.perFileMax) {
        this.logSkip(`File too large to sync (${formatBytes(local.size)}, max ${formatBytes(server.perFileMax)})`, path);
        continue;
      }
      if (remote && !remote.deleted) {
        if (local.folder) {
          if (!this.canSyncLocalFile(since, local)) {
            deferred += 1;
            continue;
          }
          if (remote.folder || !uploadFolder || local.path.length < uploadFolder.path.length) uploadFolder = local;
        } else if (remote.folder) {
          if (!this.canSyncLocalFile(since, local)) {
            deferred += 1;
            continue;
          }
          deleteFolder = remote;
        } else {
          if (!local.hash) this.getHashFromMetadataCache(local);
          if (!local.hash || local.hash !== remote.hash) {
            if (!this.canSyncLocalFile(since, local)) {
              deferred += 1;
              continue;
            }
            if (!uploadFile || local.size > uploadFile.size) uploadFile = local;
          } else {
            deferred += 1;
          }
        }
      } else {
        if (!this.canSyncLocalFile(since, local)) {
          deferred += 1;
          continue;
        }
        if (local.folder) {
          if (!uploadFolder || local.path.length < uploadFolder.path.length) uploadFolder = local;
        } else if (!uploadFile || local.size > uploadFile.size) {
          uploadFile = local;
        }
      }
    }

    if (uploadFolder) {
      const path = uploadFolder.path;
      this.syncingPath = path;
      this.setStatus("Uploading " + path);
      this.log("Uploading", path);
      await server.push(path, uploadFolder.previouspath, true, false, 0, 0, "", null);
      if (serverFiles.hasOwnProperty(path)) {
        if (serverFiles[path].deleted) serverFiles[path].deleted = false;
      } else {
        serverFiles[path] = {
          uid: 0,
          path,
          size: 0,
          hash: "",
          ctime: 0,
          mtime: 0,
          folder: true,
          deleted: false,
          device: this.deviceName,
        };
      }
      uploadFolder.previouspath = "";
      uploadFolder.synctime = Date.now();
      this.setDirty();
      return true;
    }

    if (uploadFile) {
      const path = uploadFile.path;
      this.syncingPath = path;
      this.setStatus("Uploading " + path);
      const remote = serverFiles[path];
      if (!uploadFile.hash) {
        this.getHashFromMetadataCache(uploadFile);
        if (uploadFile.hash && remote && !remote.deleted && remote.hash === uploadFile.hash) {
          this.setStatus("Comparing " + path);
          this.setDirty();
          return true;
        }
      }
      const ctime = uploadFile.ctime;
      const mtime = uploadFile.mtime;
      const data = await adapter.readBinary(path);
      uploadFile.hash = await contentHash(data);
      if (remote && !remote.deleted && remote.hash === uploadFile.hash) {
        this.setStatus("Comparing " + path);
        this.setDirty();
        return true;
      }
      this.log("Uploading file", path);
      await server.push(path, uploadFile.previouspath, false, false, ctime, mtime, uploadFile.hash, data);
      uploadFile.synchash = uploadFile.hash;
      this.log("Upload complete", path);
      uploadFile.previouspath = "";
      uploadFile.synctime = Date.now();
      this.setDirty();
      return true;
    }

    if (deferred === 0) {
      this.log("Fully synced");
      this.setStatus("Fully synced");
      this.fileRetry = {};
      return false;
    }
    this.setStatus("Indexing...");
    return true;
  };

  proto.setDirty = function () {
    this.dirty = true;
    this.trigger("status-change");
  };

  proto.forceSaveData = function () {
    this.setDirty();
    this.requestSaveData();
  };

  proto.getHashFromMetadataCache = function (record) {
    const info = this.app.metadataCache.getFileInfo(record.path);
    if (info && Math.ceil(info.mtime) === record.mtime && info.size === record.size) {
      record.hash = info.hash;
    }
  };

  proto.syncFileDown = async function (server, entry) {
    const path = entry.path;
    const adapter = this.vault.adapter;
    const stat = await adapter.stat(path);
    if (entry.folder) {
      if (stat && stat.type === "folder") {
        let record = this.localFiles[path];
        if (!record) {
          const lower = path.toLowerCase();
          let collision = "";
          for (const key in this.localFiles) {
            if (this.localFiles.hasOwnProperty(key) && key.toLowerCase() === lower) {
              collision = key;
              break;
            }
          }
          if (collision) {
            this.log("Detected case sensitive folder collision, renaming folder", path);
            await stat.rename(collision, normalizePath(path));
          }
        }
        return;
      }
      if (stat && stat.type === "file") {
        this.log("Deleting local file", path);
        await stat.remove(path);
      }
      this.log("Creating local folder", path);
      await stat.mkdir(path);
      return;
    }
    if (stat && stat.type === "folder") {
      const listing = await stat.list(path);
      if (listing.files.length !== 0 || listing.folders.length !== 0) {
        this.log("Renaming conflicted file", path);
        await stat.rename(path, path + " (Conflicted copy)");
        return;
      }
      this.log("Deleting local folder", path);
      await stat.rmdir(path, true);
      return;
    }
    this.log("Downloading file", path);
    const data = await server.pull(entry.uid);
    if (!data) throw new Error("Failed to download file, no data.");
    let bytes = data;
    if (path === this.vault.configDir + "/core-plugins.json") {
      try {
        const patched = this.patchCorePluginsFile(bytes);
        if (patched !== bytes) {
          bytes = patched;
          this.log("Fixing core plugins list", path);
        }
      } catch (e) {
        this.log("File is corrupt, ignoring", path);
        return;
      }
    }
    const hash = await contentHash(bytes);
    await s04SettlePromise(adapter.promise);
    const current = await adapter.stat(path);
    if (current && (!stat || current.mtime !== stat.mtime || current.size !== stat.size)) {
      throw new Error("Download cancelled because file was changed locally. Will try again soon.");
    }
    let ctime;
    if (stat) {
      if (entry.ctime && (stat.ctime === 0 || entry.ctime < stat.ctime)) ctime = entry.ctime;
      const existing = this.vault.getAbstractFileByPath(path);
      if (existing instanceof host.TFile) {
        if (existing.saving) await s04SettlePromise(adapter.promise);
        await this.vault.modifyBinary(existing, bytes, { ctime, mtime: entry.mtime });
      } else {
        await adapter.writeBinary(path, bytes, { ctime, mtime: entry.mtime });
      }
    } else {
      const parent = parentPath(path);
      const needsParent = parent !== "/" && parent !== "" ? !(await adapter.exists(parent)) : false;
      if (needsParent) await adapter.mkdir(parent);
      await adapter.writeBinary(path, bytes, { ctime: entry.ctime, mtime: entry.mtime });
    }
    const record = this.localFiles[path];
    if (record) {
      record.hash = hash;
      record.synchash = hash;
    }
    this.log("Downloading complete", path);
  };

  proto.patchCorePluginsFile = function (data) {
    const parsed = JSON.parse(utf8String(data));
    let changed = false;
    if (Array.isArray(parsed)) {
      if (!parsed.contains("sync")) {
        parsed.push("sync");
        changed = true;
      }
    } else if (typeof parsed === "object" && parsed !== null && parsed.sync !== true) {
      parsed.sync = true;
      changed = true;
    }
    if (changed) data = utf8Bytes(JSON.stringify(parsed, null, 2));
    return data;
  };

  proto.updateHash = async function (record) {
    if (record.folder || record.hash) return null;
    const data = await this.vault.adapter.readBinary(record.path);
    record.hash = await contentHash(data);
    return data;
  };

  proto._updateStatusBar = function () {
    const status = this.getStatus();
    const icon = this.statusIconEl;
    if (!icon) return;
    host.setTooltip(this.plugin.statusBarEl, this.syncStatus, { placement: "top" });
    icon.removeClass("mod-success", "mod-working", "mod-error", "mod-spin");
    if (status === "uninitialized") {
      host.setIcon(icon, "sync-small");
      icon.addClass("mod-working");
    } else if (status === "disconnected") {
      host.setIcon(icon, "refresh-cw-off");
      icon.addClass("mod-error");
    } else if (status === "paused") {
      host.setIcon(icon, "paused");
      icon.addClass("mod-working");
    } else if (status === "syncing" || this.syncStatus === "Connecting to server") {
      host.setIcon(icon, "sync-small");
      icon.addClass("mod-working", "mod-spin");
    } else if (status === "synced") {
      host.setIcon(icon, "check-small");
      icon.addClass("mod-success");
    } else if (status === "error") {
      host.setIcon(icon, "sync-small");
      icon.addClass("mod-error");
    }
  };

  proto.showVersionHistory = function (path) {
    if (window.__vaultSyncHistory) {
      return window.__vaultSyncHistory(path);
    }
    new (VIEWS().history)(this.app, this, path).open();
  };

  proto.getHistory = async function (path, cursor) {
    const server = await this.getServer();
    return server.listHistory(path, cursor);
  };

  proto.getContentForVersion = async function (uid) {
    const server = await this.getServer();
    return server.pull(uid);
  };

  proto.restoreVersion = async function (uid, path) {
    const server = await this.getServer();
    if (!path) {
      await server.restore(uid);
      return;
    }
    const data = await server.pull(uid);
    const content = utf8String(data);
    return this.vault.adapter.write(path, content);
  };

  proto.showDeletedFiles = async function (useHistoryView) {
    const server = await this.getServer();
    const items = (await server.listDeleted()).reverse();
    if (useHistoryView) {
      new (VIEWS().deletedModal)(this.app, this, items).open();
    } else {
      new (VIEWS().historyModal)(this.app, this, syncT().labelDeletedFiles(), items).open();
    }
  };

  proto.showConfigFiles = async function () {
    const items = [];
    const serverFiles = this.serverFiles;
    const prefix = this.app.vault.configDir + "/";
    for (const path in serverFiles) {
      if (!serverFiles.hasOwnProperty(path)) continue;
      const record = serverFiles[path];
      if (record.folder || !record.path.startsWith(prefix)) continue;
      items.push({
        uid: record.uid,
        ts: record.mtime,
        folder: record.folder,
        path: record.path,
        relatedpath: "",
        size: record.size,
        deleted: record.deleted,
        device: record.device,
      });
    }
    items.sort((a, b) => b.ts - a.ts);
    new (VIEWS().historyModal)(this.app, this, syncT().labelSettingFiles(), items).open();
  };

  proto.getUsernames = async function () {
    const server = await this.getServer();
    return server.getUsernames();
  };

  proto.purge = async function () {
    const server = await this.getServer();
    await server.purge();
  };

  proto.size = async function () {
    const server = await this.getServer();
    if (!server) return { size: -1, limit: -1, vault_size: -1 };
    return server.size();
  };

  proto.openSettings = function () {
    const setting = this.app.setting;
    setting.open();
    if (setting.activeTab !== this.settingTab) setting.openTabById(this.id);
  };

  proto.showSyncLog = function () {
    if (this.vaultId) {
      new (VIEWS().log)(this.app, this).open();
    } else {
      this.openSettings();
    }
  };

  proto.trigger = function (type, ...args) {
    Base.prototype.trigger.apply(this, [type, ...args]);
  };

  proto.on = function (type, callback, ctx) {
    return Base.prototype.on.call(this, type, callback, ctx);
  };

  return SyncPlugin;
}
