// g38 clean-room: "Startup time" diagnostic modal + StartupStat rows (spec g38 Part 6).
// Timings come from the shared animation-name tree env().lD; locale via env().sm().
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { chromeVersion } from "./text.js";
import { s16ApiVersion } from "./s16-constants.js";

let ng38StatClass = null;
function ng38Stat() {
  if (!ng38StatClass) ng38StatClass = ng38StartupStat();
  return ng38StatClass;
}

function ng38AnimNode(path) {
  let node = env().lD;
  if (path) {
    for (const seg of path.split(".")) {
      if (!node || !node.children || !Object.prototype.hasOwnProperty.call(node.children, seg)) return null;
      node = node.children[seg];
    }
  }
  return node || null;
}

function ng38AnimDuration(path) {
  const node = ng38AnimNode(path);
  return node && node.duration != null ? node.duration : 0;
}

function ng38Fmt() {
  return new Intl.NumberFormat(env().sm(), { maximumFractionDigits: 0 });
}

function ng38Ms(ms) {
  return ng38Fmt().format(ms) + "ms";
}

function ng38HideEl(el) {
  if (el && typeof el.hide === "function") el.hide();
  else if (el) el.style.display = "none";
}

export function ng38StartupStat() {
  function StartupStat(containerEl) {
    const doc = containerEl.ownerDocument || document;
    this.containerEl = doc.createElement("div");
    this.containerEl.className = "startup-stat";
    containerEl.appendChild(this.containerEl);
    this.infoEl = doc.createElement("div");
    this.infoEl.className = "startup-info";
    this.containerEl.appendChild(this.infoEl);
  }
  StartupStat.prototype.setHeading = function (heading) {
    this.containerEl.classList.toggle("mod-heading", !!heading);
    return this;
  };
  StartupStat.prototype.addLabel = function (text) {
    const el = document.createElement("span");
    el.className = "startup-label";
    el.textContent = text;
    this.infoEl.appendChild(el);
    return this;
  };
  StartupStat.prototype.addDesc = function (text) {
    const el = document.createElement("span");
    el.className = "startup-desc";
    el.textContent = text == null ? "" : text;
    this.infoEl.appendChild(el);
    return this;
  };
  StartupStat.prototype.addValue = function (text) {
    const el = document.createElement("div");
    el.className = "startup-value";
    el.textContent = text;
    this.containerEl.appendChild(el);
    return this;
  };
  return StartupStat;
}

function ng38CommunityRows(app) {
  const node = ng38AnimNode("communityPlugins");
  if (!node) return null;
  const children = Object.values(node.children || {})
    .slice()
    .sort((a, b) => (b.duration || 0) - (a.duration || 0));
  return children.map((child) => {
    const manifest = app.plugins.manifests[child.key];
    return {
      id: child.key,
      label: manifest ? manifest.name : child.key,
      desc: manifest ? manifest.version || "" : "",
      time: child.duration || 0,
    };
  });
}

// Exact clipboard summary.
export function ng38StartupSummary(app, host) {
  const platform = host.Platform;
  const fmt = ng38Fmt();
  const lines = ["Basalt start-up time breakdown", ""];
  if (platform.isDesktopApp) {
    lines.push(`Basalt version: ${platform.version}`);
    lines.push(`Installer version: ${platform.build}`);
    lines.push(`Operating system: ${platform.osName} ${platform.osVersion}`);
  } else if (platform.isMobileApp) {
    lines.push(`Basalt version: ${platform.version} (${platform.build})`);
    lines.push(`API version: ${s16ApiVersion}`);
    lines.push(`Operating system: ${platform.osName} ${platform.osVersion} (${platform.manufacturer} ${platform.model})`);
    if (platform.isAndroidApp) lines.push(`Webview version: ${chromeVersion(navigator.userAgent)}`);
  }
  lines.push("");
  lines.push(`- Total startup time: ${ng38Ms(ng38AnimDuration(""))}`);
  lines.push(`- Initialization: ${ng38Ms(ng38AnimDuration("initialization"))}`);
  const icloud = ng38AnimDuration("icloud");
  if (icloud) lines.push(`- iCloud: ${ng38Ms(icloud)}`);
  const fileCount = app.vault.getRoot().getFileCount();
  lines.push(`- Vault (${fmt.format(fileCount)} files): ${ng38Ms(ng38AnimDuration("vault"))}`);
  const stats = env().sD || { views: 0, deferredViews: 0 };
  lines.push(`- Workspace (${stats.views} tabs, ${stats.deferredViews} deferred): ${ng38Ms(ng38AnimDuration("workspace"))}`);
  lines.push(`- Core plugins: ${ng38Ms(ng38AnimDuration("corePlugins"))}`);
  const rows = ng38CommunityRows(app);
  if (rows) {
    lines.push(`- Community plugins (${fmt.format(Object.keys(app.plugins.plugins).length)} active): ${ng38Ms(ng38AnimDuration("communityPlugins"))}`);
    for (const row of rows) lines.push(`  - ${row.label} (${row.desc}): ${ng38Ms(row.time)}`);
  }
  return lines.join("\n");
}

export function ng38StartupModal(host) {
  function StartupModal(app) {
    const self = host.DialogModal.call(this, app) || this;
    self.app = app;
    self.modalEl.classList.add("mod-lg", "mod-scrollable-content", "mod-plugin-debug");
    if (typeof self.setTitle === "function") self.setTitle("Startup time");
    const doc = self.contentEl.ownerDocument || document;
    const platform = host.Platform;
    const i18n = host.i18n;
    const Stat = ng38Stat();

    const mkList = (cls) => {
      const list = doc.createElement("div");
      list.className = cls;
      self.contentEl.appendChild(list);
      return list;
    };
    const mkRow = (parent, label) => new Stat(parent).addLabel(label);

    const info = mkList("startup-stat-list");
    const device = mkRow(info, "Device");
    const os = mkRow(info, "Operating system");
    const basalt = mkRow(info, "Basalt");
    const osValue = `${platform.osName} ${platform.osVersion}`;
    if (platform.isMobileApp) {
      device.addValue(`${platform.manufacturer} ${platform.model}`);
      os.addValue(osValue);
      basalt.addDesc(platform.version);
      basalt.addLabel("Build").addDesc(platform.build);
    } else if (platform.isDesktopApp) {
      ng38HideEl(device.containerEl);
      os.addValue(osValue);
      basalt.addDesc(platform.version);
      basalt.addLabel("Installer").addDesc(platform.build);
    }

    const timed = mkList("startup-timing-list");
    new Stat(timed).setHeading(true).addLabel("Total app startup").addValue(ng38Ms(ng38AnimDuration("")));
    mkRow(timed, "Initialization").addValue(ng38Ms(ng38AnimDuration("initialization")));
    mkRow(timed, "Vault")
      .addDesc(i18n.nouns.fileWithCount({ count: app.vault.getRoot().getFileCount() }))
      .addValue(ng38Ms(ng38AnimDuration("vault")));
    const wsStats = env().sD || { views: 0, deferredViews: 0 };
    mkRow(timed, "Workspace")
      .addDesc(`${wsStats.views} tabs (${wsStats.deferredViews} deferred)`)
      .addValue(ng38Ms(ng38AnimDuration("workspace")));
    mkRow(timed, "Core plugins")
      .addDesc(i18n.nouns.pluginActiveWithCount({ count: app.internalPlugins.getEnabledPlugins().length }))
      .addValue(ng38Ms(ng38AnimDuration("corePlugins")));

    const commRows = ng38CommunityRows(app);
    if (commRows) {
      const commList = mkList("startup-timing-list");
      new Stat(commList)
        .setHeading(true)
        .addLabel("Community plugins")
        .addDesc(i18n.nouns.pluginActiveWithCount({ count: Object.keys(app.plugins.plugins).length }))
        .addValue(ng38Ms(ng38AnimDuration("communityPlugins")));
      for (const row of commRows) {
        mkRow(commList, row.label).addDesc(row.desc).addValue(ng38Ms(row.time));
      }
    }

    self.addButton("mod-secondary", i18n.interface.labelCopy(), async () => {
      await navigator.clipboard.writeText(ng38StartupSummary(app, host));
      new host.Notice(i18n.interface.copied({ context: "generic" }));
      return true;
    });
    self.addButton("mod-cancel", i18n.dialogue.buttonDone(), () => {});
    return self;
  }
  inherit(StartupModal, host.DialogModal);
  return StartupModal;
}

// Test-facing aliases for the legacy module contract.
export { ng38StartupStat as s35StartupStat, ng38StartupModal as s35StartupModal };
