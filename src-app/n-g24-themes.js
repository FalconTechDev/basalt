// g24 clean-room: small async/string helpers plus the `app.customCss` manager.
// Replaces s04-themes.js. All names ng24-prefixed; host access is lazy.
import { env, hostEnv } from "./env.js";
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { s04Request, s04RawFileUrl, s04ReleaseUrl, s04ThemeVersion } from "./s04-http.js";
import { isOlderVersion } from "./text.js";
import { lastSegment, normalizePath, extensionOf, baseName } from "./path.js";
import { randomHex } from "./misc.js";

// ---------------------------------------------------------------- helpers

export function ng24CreateDeferred() {
  const d = { promise: null, resolve: null, reject: null };
  d.promise = new Promise((resolve, reject) => { d.resolve = resolve; d.reject = reject; });
  return d;
}

/** TTL + in-flight dedupe cache; fetcher errors resolve to null, never reject. */
export function ng24CachedCall(fetcher, cacheMs, dedupeMs) {
  if (dedupeMs === undefined) dedupeMs = cacheMs;
  let cached = null, cachedAt = 0, inflight = null, failAt = 0;
  return function () {
    const now = Date.now();
    if (cached !== null && now - cachedAt < cacheMs) return Promise.resolve(cached);
    if (inflight) return inflight;
    if (cached !== null && now - failAt < dedupeMs) return Promise.resolve(cached);
    inflight = (async () => {
      try {
        const value = await fetcher();
        cached = value; cachedAt = Date.now(); failAt = 0;
        return value;
      } catch (e) {
        failAt = Date.now();
        return null;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };
}

export function ng24SettlePromise(promise) {
  return Promise.resolve(promise).then((v) => v, () => undefined);
}

export function ng24PromiseSetClass() {
  class PromiseSet {
    constructor() { this.tasks = []; }
    add(task) { this.tasks.push(Promise.resolve().then(() => task())); }
    addPromise(p) { this.tasks.push(p); }
    isEmpty() { return this.tasks.length === 0; }
    promise() { return Promise.all(this.tasks.slice()); }
  }
  return PromiseSet;
}

const NG24_STRING_COLLATOR = new Intl.Collator(undefined, { usage: "sort", sensitivity: "base", numeric: true });
export const ng24StringCompare = (a, b) => NG24_STRING_COLLATOR.compare(String(a), String(b));
export const ng24StringCompareDesc = (a, b) => NG24_STRING_COLLATOR.compare(String(b), String(a));
export const ng24NumberCompare = (a, b) => a - b;

export const ng24CommunityThemesUrl = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-css-themes.json";

async function ng24FetchCommunityThemes() {
  const res = await s04Request(ng24CommunityThemesUrl);
  const data = await res.json;
  if (!Array.isArray(data)) throw new Error("Failed to parse community themes.");
  return data;
}

const ng24CommunityThemesCached = ng24CachedCall(ng24FetchCommunityThemes, 300000, 60000);
export function ng24CommunityThemes() { return ng24CommunityThemesCached(); }
export const ng24CommunityThemesEmpty = ng24CachedCall(async () => ({}), 300000, 60000);

// ---------------------------------------------------------------- CssManager

/** Factory for the `CssManager` class (manifest class entry `Ib`). */
export function ng24CssManager(host) {
  function CssManager(app) {
    const self = host.Component.call(this) || this;
    self.app = app;
    self.styleEl = null;
    self.extraStyleEls = [];
    self.oldThemes = [];
    self.themes = {};
    self.updates = [];
    self.snippets = [];
    self.enabledSnippets = new Set();
    self.csscache = new Map();
    self.theme = "";
    self._queue = Promise.resolve();
    self._themeReload = debounceCall(() => self.reloadThemeNow(), 100);
    self._themeScan = debounceCall(() => self.scanThemes(), 2000);
    self._snippetScan = debounceCall(() => self.loadSnippets(), 100);
    return self;
  }
  inherit(CssManager, host.Component);
  const proto = CssManager.prototype;

  // -- serial queue ------------------------------------------------------
  proto._enqueue = function (fn) {
    const run = this._queue.then(fn, fn);
    this._queue = run.then(() => undefined, () => undefined);
    return run;
  };

  // -- lifecycle ----------------------------------------------------------
  proto.onload = function () {
    const app = this.app;
    const config = app.vault.getConfig("enabledCssSnippets");
    if (Array.isArray(config)) this.enabledSnippets = new Set(config);
    this.theme = app.vault.getConfig("cssTheme") || "";
    if (app.vault.getConfig("translucency")) this.enableTranslucency();
    this.styleEl = createEl("style", { type: "text/css" });
    document.head.appendChild(this.styleEl);
    this.registerEvent(app.vault.adapter.on("raw", this.onRawBound || (this.onRawBound = this.onRaw.bind(this))));
    this._enqueue(async () => {
      await this.readThemes(true);
      await this.readSnippets(true);
      await this.loadTheme();
      await this.loadSnippets();
    });
  };

  proto.onRaw = function (path) {
    path = normalizePath(path);
    this.csscache.delete(path);
    const themeCss = this.getThemePath(this.theme);
    if (this.theme && path === themeCss) { this._themeReload(); return; }
    const themesDir = this.getThemeFolder() + "/";
    if (path.startsWith(themesDir) && /(^|\/)(manifest\.json|theme\.css|[^/]+\.css)$/.test(path.slice(themesDir.length))) {
      this._themeScan();
      return;
    }
    const snippetsDir = this.getSnippetsFolder() + "/";
    if (path.startsWith(snippetsDir) && extensionOf(path) === "css") {
      this._enqueue(async () => { await this.readSnippets(true); await this.loadSnippets(); });
    }
  };

  // -- folders / paths ----------------------------------------------------
  proto.getThemeFolder = function () { return this.app.vault.configDir + "/themes"; };
  proto.getSnippetsFolder = function () { return this.app.vault.configDir + "/snippets"; };
  proto.getSnippetPath = function (name) { return this.getSnippetsFolder() + "/" + name + ".css"; };
  proto.getThemePath = function (name) {
    if (this.themes[name]) return this.getThemeFolder() + "/" + name + "/theme.css";
    return this.getThemeFolder() + "/" + name + ".css";
  };

  // -- discovery ----------------------------------------------------------
  proto.readThemes = function (reload) {
    return this._enqueue(() => this._readThemes());
  };
  proto._readThemes = async function () {
    const adapter = this.app.vault.adapter;
    const dir = this.getThemeFolder();
    this.themes = {};
    this.oldThemes = [];
    let entries = [];
    try { entries = await adapter.list(dir); } catch (e) { entries = []; }
    for (const entry of entries.files || []) {
      const name = entry;
      if (name.startsWith(".") || extensionOf(name) !== "css") continue;
      const base = baseName(name);
      if (!this.oldThemes.includes(base)) this.oldThemes.push(base);
    }
    for (const folder of entries.folders || []) {
      if (folder.startsWith(".")) continue;
      const themeCss = dir + "/" + folder + "/theme.css";
      const manifestPath = dir + "/" + folder + "/manifest.json";
      try {
        if (!(await adapter.exists(themeCss))) continue;
        const raw = await adapter.read(manifestPath);
        const manifest = JSON.parse(raw);
        if (manifest && manifest.name === folder) {
          this.themes[folder] = { name: folder, version: manifest.version, minAppVersion: manifest.minAppVersion, author: manifest.author, dir: manifest.dir };
        }
      } catch (e) {
        console.error(e);
      }
    }
    this.oldThemes.sort(ng24StringCompare);
  };

  proto.readSnippets = function (reload) {
    return this._enqueue(() => this._readSnippets());
  };
  proto._readSnippets = async function () {
    const adapter = this.app.vault.adapter;
    const dir = this.getSnippetsFolder();
    let entries = [];
    try { entries = await adapter.list(dir); } catch (e) { entries = []; }
    this.snippets = (entries.files || [])
      .filter((f) => !f.startsWith(".") && extensionOf(f) === "css")
      .map((f) => baseName(f))
      .sort(ng24StringCompare);
  };

  // -- css loading ---------------------------------------------------------
  proto.loadCss = function (path) {
    const cache = this.csscache;
    if (cache.has(path)) return Promise.resolve(cache.get(path));
    const p = (async () => {
      try {
        return await this.app.vault.adapter.read(path);
      } catch (e) {
        return "";
      }
    })();
    cache.set(path, p);
    return p;
  };

  proto.loadTheme = function (css) {
    return this._enqueue(async () => {
      let text;
      if (css !== undefined) text = css;
      else if (!this.theme) text = "";
      else text = await this.loadCss(this.getThemePath(this.theme));
      if (this.styleEl.textContent !== text) {
        this.styleEl.textContent = text;
        this.app.workspace.trigger("css-change");
        this.app.workspace.trigger("resize");
      }
    });
  };
  proto.reloadThemeNow = function () { return this.loadTheme(); };

  proto.loadSnippets = function () {
    return this._enqueue(async () => {
      const enabled = Array.from(this.enabledSnippets).sort(ng24StringCompare);
      const want = enabled.length;
      // ensure one style element per enabled snippet, in order after styleEl
      while (this.extraStyleEls.length < want) {
        const el = createEl("style", { type: "text/css" });
        const prev = this.extraStyleEls.length ? this.extraStyleEls[this.extraStyleEls.length - 1] : this.styleEl;
        prev.after(el);
        this.extraStyleEls.push(el);
      }
      while (this.extraStyleEls.length > want) this.extraStyleEls.pop().detach();
      let changed = false;
      for (let i = 0; i < want; i++) {
        const name = enabled[i];
        const text = await this.loadCss(this.getSnippetPath(name));
        const el = this.extraStyleEls[i];
        if (el.textContent !== text) { el.textContent = text; changed = true; }
      }
      if (changed) {
        this.app.workspace.trigger("css-change");
        this.app.workspace.trigger("resize");
      }
    });
  };

  // -- config writes --------------------------------------------------------
  proto.setTheme = function (name) {
    this.theme = name || "";
    this.app.vault.setConfig("cssTheme", this.theme);
    this.loadTheme();
  };
  proto.reloadTheme = function () {
    this.theme = this.app.vault.getConfig("cssTheme") || "";
    this.loadTheme();
  };
  proto.setCssEnabledStatus = function (name, enabled) {
    if (enabled) this.enabledSnippets.add(name);
    else this.enabledSnippets.delete(name);
    this.app.vault.setConfig("enabledCssSnippets", Array.from(this.enabledSnippets));
    this.loadSnippets();
  };

  // -- translucency ---------------------------------------------------------
  proto.isDarkMode = function () {
    return document.body.classList.contains("theme-dark");
  };
  proto.setTranslucency = function (enabled) {
    this.app.vault.setConfig("translucency", !!enabled);
    if (enabled) this.enableTranslucency();
    else this.disableTranslucency();
  };
  proto.enableTranslucency = function () {
    const { Yl, Uf, Wf, electronWindow } = env();
    if (!Yl.isDesktopApp || !Uf()) return;
    document.body.classList.add("is-translucent");
    try {
      Wf(true);
    } catch (e) {
      new host.Notice(host.t.interface.msgUpgradeInstaller());
    }
  };
  proto.disableTranslucency = function () {
    const { Yl, Uf, Wf } = env();
    if (!Yl.isDesktopApp || !Uf()) return;
    document.body.classList.remove("is-translucent");
    try { Wf(false); } catch (e) {}
  };

  // -- removal ---------------------------------------------------------------
  proto.removeTheme = function (name) {
    return this._enqueue(async () => {
      const adapter = this.app.vault.adapter;
      const dir = this.getThemeFolder();
      try {
        if (this.themes[name]) await adapter.rmdir(dir + "/" + name, true);
        else await adapter.remove(dir + "/" + name + ".css");
      } catch (e) { console.error(e); }
      await this._readThemes();
      if (this.theme === name) this.setTheme("");
      this.loadTheme();
    });
  };

  // -- community updates ------------------------------------------------------
  proto.isThemeInstalled = function (name) {
    return !!this.themes[name] || this.oldThemes.includes(name);
  };

  proto.getManifest = async function (repo) {
    try {
      const res = await s04Request(s04RawFileUrl(repo, "manifest.json"));
      return await res.json;
    } catch (e) {
      return null;
    }
  };

  proto.checkForUpdate = async function (info) {
    if (!this.isThemeInstalled(info.name)) return null;
    const repo = info.repo || info.cssRepo || info.repoName;
    if (!repo) return null;
    const manifest = await this.getManifest(repo);
    if (manifest) {
      const version = await s04ThemeVersion(repo, manifest);
      const installed = this.themes[info.name];
      const installedVersion = installed && installed.version;
      if (!installedVersion || isOlderVersion(installedVersion, version)) {
        return { themeInfo: info, version };
      }
      return null;
    }
    // legacy fallback: compare obsidian.css with the installed file
    try {
      const remote = await s04Request(s04RawFileUrl(repo, "obsidian.css")).text;
      const localPath = this.themes[info.name]
        ? this.getThemeFolder() + "/" + info.name + "/theme.css"
        : this.getThemeFolder() + "/" + info.name + ".css";
      const local = await this.app.vault.adapter.read(localPath);
      if (remote !== local) return { themeInfo: info };
    } catch (e) {}
    return null;
  };

  proto.hasUpdates = function () {
    return this.updates.length > 0;
  };

  proto.checkForUpdates = async function () {
    this.updates = [];
    let themes;
    try {
      themes = await ng24CommunityThemes();
      if (!Array.isArray(themes)) themes = await ng24CommunityThemesEmpty();
    } catch (e) {
      new host.Notice(host.t.plugins.customCss.msgFailedToInstallTheme());
      themes = await ng24CommunityThemesEmpty();
    }
    for (const info of themes || []) {
      const update = await this.checkForUpdate(info);
      if (update) this.updates.push(update);
    }
    if (this.updates.length) {
      new host.Notice(host.t.plugins.customCss.msgUpdatesFound({ count: this.updates.length }));
    } else {
      new host.Notice(host.t.plugins.customCss.msgNoUpdatesFound());
    }
  };

  // -- install ----------------------------------------------------------------
  proto.downloadLegacyTheme = async function (info) {
    const repo = info.repo || info.cssRepo || info.repoName;
    const css = await s04Request(s04RawFileUrl(repo, "obsidian.css")).text;
    const dir = this.getThemeFolder() + "/" + info.name;
    await this.app.vault.adapter.mkdir(dir).catch(() => {});
    await this.app.vault.adapter.write(dir + "/theme.css", css);
    const manifest = { name: info.name, version: "0.0.0", minAppVersion: "0.16.0", author: info.author };
    await this.app.vault.adapter.write(dir + "/manifest.json", JSON.stringify(manifest, null, 2));
    try { await this.app.vault.adapter.remove(this.getThemeFolder() + "/" + info.name + ".css"); } catch (e) {}
    await this._readThemes();
    this.loadTheme();
  };

  proto.installLegacyTheme = function (info) {
    return this.downloadLegacyTheme(info);
  };

  proto.installTheme = async function (info, version) {
    const t = host.t.plugins.customCss;
    // remember in localStorage["local-themes"]
    try {
      let local = JSON.parse(localStorage.getItem("local-themes") || "[]");
      if (!Array.isArray(local)) local = [];
      if (!local.includes(info.name)) {
        local.push(info.name);
        localStorage.setItem("local-themes", JSON.stringify(local));
      }
    } catch (e) {}
    const installing = new host.Notice(t.msgInstallingTheme({ name: info.name }), 0);
    installing.containerEl.addClass("is-loading");
    try {
      if (!version) {
        await this.downloadLegacyTheme(info);
      } else {
        const repo = info.repo || info.cssRepo || info.repoName;
        let manifest, css;
        try {
          const res = await s04Request(s04ReleaseUrl(repo, version, "manifest.json"));
          manifest = await res.json;
          css = await s04Request(s04ReleaseUrl(repo, version, "theme.css")).text;
        } catch (e) {
          if (!(e && e.status === 404)) throw e;
          manifest = await s04Request(s04RawFileUrl(repo, "manifest.json")).json;
          css = await s04Request(s04RawFileUrl(repo, "theme.css")).text;
        }
        if (!manifest || manifest.name !== info.name) {
          throw new Error("Theme name mismatch.");
        }
        const dir = this.getThemeFolder() + "/" + info.name;
        await this.app.vault.adapter.mkdir(dir).catch(() => {});
        await this.app.vault.adapter.write(dir + "/theme.css", css);
        await this.app.vault.adapter.write(dir + "/manifest.json", JSON.stringify(manifest, null, 2));
        try { await this.app.vault.adapter.remove(this.getThemeFolder() + "/" + info.name + ".css"); } catch (e) {}
        await this._readThemes();
        this.loadTheme();
      }
      this.updates = this.updates.filter((u) => (u.themeInfo || u).name !== info.name);
      const ok = new host.Notice(t.msgSuccessfullyInstalledTheme({ name: info.name }), 3000);
      ok.containerEl.addClass("mod-success");
      return true;
    } catch (e) {
      const msg = e && e.message === "Theme name mismatch."
        ? t.msgFailedToInstallTheme({ name: info.name }) + " Theme name mismatch."
        : t.msgFailedToInstallTheme({ name: info.name });
      new host.Notice(msg, 3000);
      return false;
    } finally {
      installing.hide();
    }
  };

  return CssManager;
}

// Contract aliases (manifest `use` names).
export const s04CreateDeferred = ng24CreateDeferred;
export const s04SettlePromise = ng24SettlePromise;
export const s04CachedCall = ng24CachedCall;
export const s04PromiseSetClass = ng24PromiseSetClass;
export const s04CssManager = ng24CssManager;
export const s04StringCompare = ng24StringCompare;
export const s04StringCompareDesc = ng24StringCompareDesc;
export const s04NumberCompare = ng24NumberCompare;
export const s04CommunityThemes = ng24CommunityThemes;
