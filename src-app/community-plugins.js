// CommunityPlugins (app.plugins): the third-party plugin manager. Loads manifests from
// <configDir>/plugins, enables/disables plugins from community-plugins.json, installs from
// GitHub release assets, and periodically checks the deprecation list and for updates.
import { debounceCall } from "./timing.js";
import { parentPath, lastSegment } from "./path.js";

const PLUGIN_MANIFEST_FILE = "manifest.json";
const MAIN_FILE = "main.js";
const STYLES_FILE = "styles.css";
const UPDATE_CHECK_INTERVAL = 432e5; // deprecation re-check, 12 h
const AUTO_UPDATE_INTERVAL = 2592e5; // minimum age before an automatic update check, 3 days

// Strips an inline `//# sourceMappingURL=data:...` block from a downloaded plugin file.
const SOURCEMAP_RE = /^\/\/[@#] sourceMappingURL=data:application\/json(?:;charset[:=][^;]+)?;base64,.*$/gm;
const SOURCEMAP_MARKER = "\n/* nosourcemap */";

const GITHUB_RELEASES = "https://github.com/";
const RAW_GITHUB = "https://raw.githubusercontent.com/";
const DEPRECATION_URL = rawUrl("obsidianmd/obsidian-releases", "community-plugin-deprecation.json");
const CM6_DEPRECATION_NOTE =
  "See the stack trace to find the faulty plugin and file an issue with the plugin author. \n" +
  "Details: https://discuss.codemirror.net/t/release-0-20-0/4302";

// host is bound by defineCommunityPlugins before any method runs.
let host;

/** raw.githubusercontent.com URL for a repo path at a ref (default HEAD). */
function rawUrl(repo, path, ref) {
  return RAW_GITHUB + repo + "/" + (ref || "HEAD") + "/" + path;
}

/** github.com release-asset URL. */
function releaseUrl(repo, tag, file) {
  return GITHUB_RELEASES + repo + "/releases/download/" + tag + "/" + file;
}

// window.require is installed by the Electron preload before the bundle runs; captured once,
// matching the inherited shim.
const nodeRequireImpl = window.require;
function nodeRequire(id) {
  return nodeRequireImpl && nodeRequireImpl(id);
}

// The require() shim handed to plugin code: known CodeMirror packages resolve to the bundled
// copies, deprecated ones warn, Node builtins only exist outside mobile emulation.
function pluginRequire(pluginId, emulateMobile) {
  return function (id) {
    if (host.cmDeprecatedMap.hasOwnProperty(id)) {
      console.error(new Error("[CM6][" + pluginId + '] Using a deprecated package: "' + id + '".\n' + CM6_DEPRECATION_NOTE));
      return host.cmDeprecatedMap[id];
    }
    if (host.cmRequireMap.hasOwnProperty(id)) return host.cmRequireMap[id];
    if (emulateMobile) {
      new host.Notice(pluginId + ' attempted to load NodeJS package: "' + id + '"');
      console.error(new Error("[" + pluginId + '] Attempting to load NodeJS package: "' + id + '"'));
      return null;
    }
    return nodeRequire(id);
  };
}

/** id -> [versions]; refreshed by checkForDeprecations, consulted by isDeprecated. */
let deprecatedPluginVersions = {};

/**
 * Picks the newest plugin release compatible with this app version. The plugin's own manifest
 * version is used when it imposes no minimum app version; otherwise versions.json (version ->
 * minimum app version) is scanned and the last compatible entry wins.
 */
async function latestCompatibleVersion(repo, manifest) {
  let latest = manifest.version || null;
  const minAppVersion = manifest.minAppVersion;
  const appVersion = host.appVersion;
  if (!appVersion || !minAppVersion || !host.semverCompare(appVersion, minAppVersion)) return latest;
  try {
    latest = null;
    const versions = await host.request(rawUrl(repo, "versions.json")).json;
    if (versions) {
      for (const version in versions) {
        if (versions.hasOwnProperty(version) && !host.semverCompare(appVersion, versions[version])) latest = version;
      }
      return latest;
    }
  } catch {
    // network or parse failure: report no usable version
  }
  return null;
}

export function defineCommunityPlugins(host_) {
  host = host_;

  function CommunityPlugins(app) {
    this.manifests = {};
    this.plugins = {};
    this.enabledPlugins = new Set();
    this.updates = {};
    this.requestSaveConfig = debounceCall(this.saveConfig, 1000);
    this.autoCheckForUpdates = false;
    this.lastUpdateCheck = 0;
    this.app = app;
    this.app.vault.on("raw", this.onRaw.bind(this));
    const stored = this.app.loadLocalStorage("plugin-automatically-check-for-updates");
    this.autoCheckForUpdates = stored !== undefined && stored !== null ? stored : false;
  }

  CommunityPlugins.prototype.setAutomaticUpdateCheck = function (on) {
    this.autoCheckForUpdates = on;
    this.app.saveLocalStorage("plugin-automatically-check-for-updates", on);
  };

  /** Reloads a plugin's data.json when it changes on disk while the plugin is enabled. */
  CommunityPlugins.prototype.onRaw = function (path) {
    if (!path.startsWith(this.app.vault.configDir)) return;
    const pluginId = lastSegment(parentPath(path));
    if (this.enabledPlugins.has(pluginId) && path === this.getPluginFolder() + "/" + pluginId + "/data.json") {
      const plugin = this.plugins[pluginId];
      if (plugin) plugin.onConfigFileChange();
    }
  };

  /** Scans <configDir>/plugins/*\/manifest.json into this.manifests. */
  CommunityPlugins.prototype.loadManifests = async function () {
    const adapter = this.app.vault.adapter;
    const manifests = (this.manifests = {});
    const folder = this.getPluginFolder();
    if (!(await adapter.exists(folder))) return;
    const listed = await adapter.list(folder);
    for (const dir of listed.folders) {
      try {
        const manifestPath = dir + "/" + PLUGIN_MANIFEST_FILE;
        if (!(await adapter.exists(manifestPath))) continue;
        const manifest = JSON.parse(await adapter.read(manifestPath));
        if (!manifest.id) continue;
        manifest.dir = dir;
        if (!manifest.author || manifest.author.toLowerCase() === "basalt") manifest.author = "";
        manifests[manifest.id] = manifest;
      } catch (error) {
        console.error(error);
      }
    }
  };

  /** Loads a single plugin directory's manifest into this.manifests (used after install). */
  CommunityPlugins.prototype.loadManifest = async function (dir) {
    const adapter = this.app.vault.adapter;
    try {
      const manifestPath = dir + "/" + PLUGIN_MANIFEST_FILE;
      if (!(await adapter.exists(manifestPath))) return;
      const manifest = JSON.parse(await adapter.read(manifestPath));
      if (!manifest.id) return;
      manifest.dir = dir;
      if (!manifest.author || manifest.author.toLowerCase() === "basalt") manifest.author = "";
      this.manifests[manifest.id] = manifest;
    } catch (error) {
      console.error(error);
    }
  };

  /**
   * Reads, evaluates and instantiates a plugin's main.js. Returns the loaded Plugin instance, an
   * already-loaded instance, or null when community plugins are disabled / the plugin is missing.
   */
  CommunityPlugins.prototype.loadPlugin = async function (id, onUserEnable = false) {
    if (!this.isEnabled()) return null;
    const existing = this.plugins[id];
    if (existing) return existing;
    const manifest = this.manifests[id];
    if (!manifest) return null;
    let code = await this.app.vault.adapter.read(manifest.dir + "/" + MAIN_FILE);
    if (!host.basaltDebug) code = code.endsWith(SOURCEMAP_MARKER) ? code : code.replace(SOURCEMAP_RE, "");
    const requireShim = pluginRequire(id, document.body.hasClass("emulate-mobile"));
    const moduleShim = { exports: {} };
    const exportsShim = moduleShim.exports;
    const pluginFn = window.eval(
      "(function anonymous(require,module,exports){" + code + "\n})\n//# sourceURL=plugin:" + encodeURIComponent(id) + "\n"
    );
    pluginFn(requireShim, moduleShim, exportsShim);
    const exported = moduleShim.exports || exportsShim;
    const PluginClass = exported.default || moduleShim.exports;
    if (!PluginClass) throw new Error("Failed to load plugin " + id + ". No exports detected.");
    const instance = new PluginClass(this.app, manifest);
    if (!(instance instanceof host.Plugin)) throw new Error("Failed to load plugin " + id);
    this.plugins[id] = instance;
    await instance.load();
    await instance.loadCSS();
    if (onUserEnable) instance.onUserEnable();
    return instance;
  };

  CommunityPlugins.prototype.unloadPlugin = async function (id, userDisabled = false) {
    const plugin = this.plugins[id];
    if (!plugin) return;
    plugin._userDisabled = userDisabled;
    plugin.unload();
    delete this.plugins[id];
  };

  /**
   * Restores the enabled set, loads manifests, enables every enabled plugin (with a 3 s "plugin
   * hang" watchdog), then arms the automatic update checks and the deprecation poller.
   */
  CommunityPlugins.prototype.initialize = async function () {
    const app = this.app;
    let enabled = await app.vault.readConfigJson("community-plugins");
    if (!enabled || !Array.isArray(enabled)) enabled = [];
    this.enabledPlugins = new Set(enabled);
    await this.loadManifests();
    const manifests = this.manifests;
    if (Object.keys(manifests).length === 0) return;
    if (!this.isEnabled()) {
      if (localStorage.getItem("enable-plugin-" + app.appId) === null) new host.TrustAuthorModal(app).open();
      return;
    }
    host.trackUsage("communityPlugins");
    const manager = this;
    const enableOne = async (id) => {
      if (!manifests.hasOwnProperty(id)) return;
      const watchdog = window.setTimeout(() => {
        host.progressOverlay.setContext((el) => {
          el.createDiv({ text: host.i18n.interface.startUp.msgPluginHang({ plugin: id }) });
          el.createDiv("progress-bar-context-button", (row) => {
            row.createEl("button", { text: host.i18n.setting.thirdPartyPlugin.buttonDisable() }, (button) => {
              button.onClickEvent(async () => {
                manager.enabledPlugins.delete(id);
                await manager.saveConfig();
                window.location.reload();
              });
            });
          });
        });
      }, 3000);
      await manager.enablePlugin(id);
      host.progressOverlay.clearContext();
      window.clearTimeout(watchdog);
    };
    for (const id of enabled) await enableOne(id);
    this.requestSaveConfig();
    const storedCheck = app.loadLocalStorage("last-plugin-update-check");
    this.lastUpdateCheck = storedCheck !== undefined && storedCheck !== null ? storedCheck : Date.now();
    if (host.Platform.isDesktopApp) {
      window.addEventListener("focus", () => {
        if (host.activeWindow === window && manager.autoCheckForUpdates && Date.now() > manager.lastUpdateCheck + AUTO_UPDATE_INTERVAL) {
          manager.checkForUpdates(true);
        }
      });
    }
    if (host.Platform.isMobileApp) {
      host.capacitorApp.addListener("resume", () => {
        if (manager.autoCheckForUpdates && manager.isEnabled() && Date.now() > manager.lastUpdateCheck + AUTO_UPDATE_INTERVAL) {
          manager.checkForUpdates(true);
        }
      });
    }
    this.checkForDeprecations();
    setInterval(() => this.checkForDeprecations(), UPDATE_CHECK_INTERVAL);
  };

  CommunityPlugins.prototype.getPluginFolder = function () {
    return this.app.vault.configDir + "/plugins";
  };

  /** Loads a community plugin and reports success; shows a Notice on the hard-blocked versions. */
  CommunityPlugins.prototype.enablePlugin = async function (id, onUserEnable = false) {
    const manifest = this.manifests[id];
    if (!manifest) return false;
    if (
      this.isDeprecated(manifest) ||
      (manifest.id === "cmdr" && host.semverCompare(manifest.version, "0.5.4")) ||
      (manifest.id === "obsidian-image-toolkit" && host.semverCompare(manifest.version, "1.4.3"))
    ) {
      new host.Notice(
        "Unable to load plugin " + manifest.name + " v" + manifest.version +
        ". This version has been reported to cause issues. Please check for a newer version of the plugin."
      );
      return false;
    }
    if (manifest.id === "better-pdf-plugin" && manifest.version === "1.4.0") {
      new host.Notice("Better PDF Plugin is no longer functional. We recommend uninstalling it.", 6000);
      return false;
    }
    if (!host.Platform.isDesktopApp && manifest.isDesktopOnly) return false;
    try {
      this.loadingPluginId = id;
      await this.loadPlugin(id, onUserEnable);
      this.loadingPluginId = null;
    } catch (error) {
      this.loadingPluginId = null;
      new host.Notice(host.i18n.interface.msgFailedToLoadPlugin({ plugin: id }));
      console.error("Plugin failure: " + id, error);
      return false;
    } finally {
      host.trackUsage("communityPlugins." + id);
    }
    return true;
  };

  CommunityPlugins.prototype.disablePlugin = async function (id, userDisabled = false) {
    try {
      await this.unloadPlugin(id, userDisabled);
    } catch (error) {
      new host.Notice(host.i18n.setting.thirdPartyPlugin.msgFailedToDisablePlugin({ id }));
      console.error("Plugin failure: " + id, error);
    }
  };

  CommunityPlugins.prototype.enablePluginAndSave = async function (id) {
    if (!(await this.enablePlugin(id, true))) return false;
    this.enabledPlugins.add(id);
    this.requestSaveConfig();
    return true;
  };

  CommunityPlugins.prototype.disablePluginAndSave = async function (id) {
    this.enabledPlugins.delete(id);
    this.requestSaveConfig();
    await this.disablePlugin(id, true);
  };

  CommunityPlugins.prototype.uninstallPlugin = async function (id) {
    await this.disablePluginAndSave(id);
    const manifest = this.manifests[id];
    const dir = manifest && manifest.dir;
    if (!dir || !(await this.app.vault.exists(dir))) return;
    try {
      await this.app.vault.adapter.rmdir(dir, true);
      delete this.manifests[id];
      delete this.updates[id];
    } catch (error) {
      new host.Notice(host.i18n.setting.thirdPartyPlugin.msgFailedToUninstallPlugin({ id }));
      console.error("Plugin failure: " + id, error);
    }
  };

  CommunityPlugins.prototype.getPlugin = function (id) {
    return this.plugins.hasOwnProperty(id) ? this.plugins[id] : null;
  };

  CommunityPlugins.prototype.saveConfig = async function () {
    await this.app.vault.writeConfigJson("community-plugins", Array.from(this.enabledPlugins));
  };

  /** Community plugins are opt-in per install via localStorage, not per vault. */
  CommunityPlugins.prototype.isEnabled = function () {
    return localStorage.getItem("enable-plugin-" + this.app.appId) === "true";
  };

  /** Global on/off switch for all community plugins. */
  CommunityPlugins.prototype.setEnable = async function (on) {
    localStorage.setItem("enable-plugin-" + this.app.appId, on ? "true" : "false");
    if (!on) {
      const loaded = Object.keys(this.plugins);
      for (let i = 0; i < loaded.length; i++) await this.disablePlugin(loaded[i]);
      return;
    }
    const enabled = Array.from(this.enabledPlugins);
    for (let i = 0; i < enabled.length; i++) await this.enablePlugin(enabled[i]);
  };

  /** Disables every loaded plugin whose installed version is on the deprecation list. */
  CommunityPlugins.prototype.checkForDeprecations = async function () {
    if (Object.keys(this.plugins).length === 0) return;
    try {
      deprecatedPluginVersions = await host.request(DEPRECATION_URL).json;
    } catch {
      // keep the previous list when the fetch fails
    }
    const ids = [];
    for (const id in this.plugins) ids.push(id);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (!this.plugins.hasOwnProperty(id)) continue;
      const manifest = this.manifests[id] || this.plugins[id].manifest;
      if (this.isDeprecated(manifest)) {
        await this.disablePluginAndSave(id);
        new host.Notice(
          "The plugin " + manifest.name + " v" + manifest.version +
          " has been disabled. This version has been reported to cause issues. Please check for a newer version of the plugin.",
          0
        );
      }
    }
  };

  CommunityPlugins.prototype.isDeprecated = function (manifest) {
    if (!manifest) return false;
    if (!deprecatedPluginVersions.hasOwnProperty(manifest.id)) return false;
    return deprecatedPluginVersions[manifest.id].includes(manifest.version);
  };

  /** Downloads a plugin release into <configDir>/plugins and enables it. */
  CommunityPlugins.prototype.installPlugin = async function (repo, tag, info) {
    const id = info.id;
    const name = info.name;
    const notice = new host.Notice(host.pluginStrings.msgInstallingPlugin({ name }), 0);
    notice.containerEl.addClass("is-loading");
    let manifestText = null;
    try {
      manifestText = await host.request(releaseUrl(repo, tag, PLUGIN_MANIFEST_FILE)).text;
      const remote = JSON.parse(manifestText);
      if (!(remote.id && remote.id === id)) {
        notice.containerEl.removeClass("is-loading");
        notice.setMessage("Plugin ID mismatch.");
        setTimeout(() => notice.hide(), 3000);
        return;
      }
    } catch (error) {
      console.error(error);
      notice.containerEl.removeClass("is-loading");
      notice.setMessage(host.pluginStrings.msgFailedToInstallPlugin({ name }));
      setTimeout(() => notice.hide(), 3000);
      return;
    }
    const vault = this.app.vault;
    const folder = this.getPluginFolder();
    if (!(await vault.exists(folder))) await vault.createFolder(folder);
    const dir = folder + "/" + id;
    if (!(await vault.exists(dir))) await vault.createFolder(dir);
    const adapter = vault.adapter;
    await adapter.write(dir + "/" + PLUGIN_MANIFEST_FILE, manifestText);
    try {
      const mainText = await host.request(releaseUrl(repo, tag, MAIN_FILE)).text;
      await adapter.write(dir + "/" + MAIN_FILE, mainText.replace(SOURCEMAP_RE, "") + SOURCEMAP_MARKER);
    } catch {
      console.log(name + ": " + MAIN_FILE + " not found");
    }
    try {
      const stylesText = await host.request(releaseUrl(repo, tag, STYLES_FILE)).text;
      await adapter.write(dir + "/" + STYLES_FILE, stylesText);
    } catch {
      console.log(name + ": " + STYLES_FILE + " not found");
    }
    delete this.updates[id];
    notice.containerEl.removeClass("is-loading");
    notice.containerEl.addClass("mod-success");
    notice.setMessage(host.pluginStrings.msgSuccessfullyInstalledPlugin({ name }));
    setTimeout(() => notice.hide(), 3000);
    await this.loadManifest(dir);
    if (this.plugins.hasOwnProperty(id)) {
      await this.disablePlugin(id);
      await this.enablePlugin(id, true);
    }
  };

  /** Compares installed manifests against the community plugin list for newer releases. */
  CommunityPlugins.prototype.checkForUpdates = async function (announce = false) {
    if (!navigator.onLine) {
      if (!announce) new host.Notice(host.i18n.dialogue.msgOffline());
      return;
    }
    this.lastUpdateCheck = Date.now();
    this.app.saveLocalStorage("last-plugin-update-check", this.lastUpdateCheck);
    this.updates = {};
    const updates = this.updates;
    const notice = new host.Notice(host.pluginStrings.msgCheckingForUpdates(), 0);
    let list;
    try {
      list = await host.communityPluginList();
    } catch (error) {
      console.error(error);
      notice.setMessage(host.pluginStrings.msgFailedLoadPlugins()).setAutoHide(4000);
      return;
    }
    for (let i = 0; i < list.length; i++) {
      const entry = list[i];
      const id = entry.id;
      if (!this.manifests.hasOwnProperty(id)) continue;
      const manifest = this.manifests[id];
      const current = manifest.version;
      if (!current) continue;
      try {
        const remote = await host.request(rawUrl(entry.repo, PLUGIN_MANIFEST_FILE)).json;
        if (!(remote && remote.id && remote.id === id)) continue;
        const latest = await latestCompatibleVersion(entry.repo, remote);
        if (latest && host.semverCompare(current, latest)) {
          updates[id] = { repo: entry.repo, version: latest, manifest: remote };
        }
      } catch {
        // skip plugins whose remote manifest cannot be fetched
      }
    }
    const count = Object.keys(updates).length;
    if (count === 0) {
      notice.setMessage(host.pluginStrings.msgNoUpdatesFound()).setAutoHide(4000);
    } else {
      notice.setMessage(host.pluginStrings.msgUpdatesFound({ count })).setAutoHide(4000);
      if (announce) {
        notice.addButton(host.i18n.dialogue.buttonView(), () => {
          this.app.setting.open();
          this.app.setting.openTabById("community-plugins");
        });
      }
    }
  };

  return CommunityPlugins;
}
