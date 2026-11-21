// g32 clean-room: collects the startup report data and clipboard text.
import { env } from "./env.js";

function ng32StartupFormatter(host) {
  const fmt = new host.s13NumberFormat({ maximumFractionDigits: 0 });
  return (value) => `${fmt.format(value)}ms`;
}

function ng32StartupPluginRows(app) {
  const node = env().uD("communityPlugins");
  if (!node) return null;
  const rows = Object.values(node.children || {}).map((child) => ({ id: child.key, time: child.duration }));
  rows.sort((a, b) => b.time - a.time);
  return rows;
}

export function ng32StartupReport(app, host) {
  const platform = host.Platform;
  const ms = ng32StartupFormatter(host);
  const countFmt = new host.s13NumberFormat({ maximumFractionDigits: 0 });
  const fileCount = app.vault.getRoot().getFileCount();
  const views = env().sD;
  const pluginCount = Object.keys(app.plugins.plugins).length;
  const rows = ng32StartupPluginRows(app);
  const lines = ["Basalt start-up time breakdown", ""];

  if (platform.isDesktopApp) {
    lines.push(`Basalt version: ${platform.version}`);
    lines.push(`Installer version: ${platform.build}`);
    lines.push(`Operating system: ${platform.osName} ${platform.osVersion}`);
  }
  if (platform.isMobileApp) {
    lines.push(`Basalt version: ${platform.version} (${platform.build})`);
    lines.push(`API version: ${env().gte}`);
    lines.push(`Operating system: ${platform.osName} ${platform.osVersion} (${platform.manufacturer} ${platform.model})`);
    if (platform.isAndroidApp) lines.push(`Webview version: ${env().rD(navigator.userAgent)}`);
  }

  lines.push("");
  lines.push(`- Total startup time: ${ms(env().hD())}`);
  lines.push(`- Initialization: ${ms(env().hD("initialization"))}`);
  if (env().hD("icloud")) lines.push(`- iCloud: ${ms(env().hD("icloud"))}`);
  lines.push(`- Vault (${countFmt.format(fileCount)} files): ${ms(env().hD("vault"))}`);
  lines.push(`- Workspace (${views.views} tabs, ${views.deferredViews} deferred): ${ms(env().hD("workspace"))}`);
  lines.push(`- Core plugins: ${ms(env().hD("corePlugins"))}`);
  if (rows) {
    lines.push(`- Community plugins (${countFmt.format(pluginCount)} active): ${ms(env().hD("communityPlugins"))}`);
    for (const row of rows) {
      const manifest = app.plugins.manifests[row.id];
      lines.push(`  - ${manifest ? manifest.name : row.id} (${manifest ? manifest.version : ""}): ${ms(row.time)}`);
    }
  }
  return lines.join("\n");
}
