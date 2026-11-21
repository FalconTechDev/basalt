// g32 clean-room: "Startup time" dialog and its stat rows.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { ng32DefineStartupStat } from "./n-g32-startup-stat.js";
import { ng32StartupReport } from "./n-g32-startup-report.js";

export function ng32DefineStartupTimeModal(host) {
  const Stat = ng32DefineStartupStat(host);
  const ms = (value) => `${new host.s13NumberFormat({ maximumFractionDigits: 0 }).format(value)}ms`;
  const count = (value) => new host.s13NumberFormat({ maximumFractionDigits: 0 }).format(value);

  function ng32StartupPluginRows(app) {
    const node = env().uD("communityPlugins");
    if (!node) return null;
    const rows = Object.values(node.children || {}).map((child) => ({ id: child.key, time: child.duration }));
    rows.sort((a, b) => b.time - a.time);
    return rows;
  }

  function Ng32StartupTimeModal(app) {
    const self = Reflect.construct(host.DialogModal, [app], Ng32StartupTimeModal);
    self.app = app;
    self.setTitle("Startup time");
    self.modalEl.addClass("mod-lg", "mod-scrollable-content", "mod-plugin-debug");
    const platform = host.Platform;

    const info = self.contentEl.createDiv("startup-stat-list");
    const device = new Stat(info).addLabel("Device");
    const os = new Stat(info).addLabel("Operating system");
    const basalt = new Stat(info).addLabel("Basalt");
    if (platform.isMobileApp) {
      device.addValue(`${platform.manufacturer} ${platform.model}`);
      os.addValue(`${platform.osName} ${platform.osVersion}`);
      basalt.addDesc(platform.version).addLabel("Build").addDesc(platform.build);
    } else if (platform.isDesktopApp) {
      device.rowEl.hide();
      os.addValue(`${platform.osName} ${platform.osVersion}`);
      basalt.addDesc(platform.version).addLabel("Installer").addDesc(platform.build);
    }

    const timing = self.contentEl.createDiv("startup-timing-list");
    new Stat(timing).setHeading(true).addLabel("Total app startup").addValue(ms(env().hD()));
    new Stat(timing).addLabel("Initialization").addValue(ms(env().hD("initialization")));
    new Stat(timing).addLabel("Vault")
      .addDesc(env().gm.nouns.fileWithCount({ count: app.vault.getRoot().getFileCount() }))
      .addValue(ms(env().hD("vault")));
    new Stat(timing).addLabel("Workspace")
      .addDesc(`${env().sD.views} tabs (${env().sD.deferredViews} deferred)`)
      .addValue(ms(env().hD("workspace")));
    new Stat(timing).addLabel("Core plugins")
      .addDesc(env().gm.nouns.pluginActiveWithCount({ count: app.internalPlugins.getEnabledPlugins().length }))
      .addValue(ms(env().hD("corePlugins")));

    const rows = ng32StartupPluginRows(app);
    if (rows) {
      const list = self.contentEl.createDiv("startup-timing-list");
      new Stat(list).setHeading(true).addLabel("Community plugins")
        .addDesc(env().gm.nouns.pluginActiveWithCount({ count: Object.keys(app.plugins.plugins).length }))
        .addValue(ms(env().hD("communityPlugins")));
      for (const row of rows) {
        const manifest = app.plugins.manifests[row.id];
        new Stat(list).addLabel(manifest ? manifest.name : row.id)
          .addDesc(manifest ? manifest.version : "").addValue(ms(row.time));
      }
    }

    self.addButton("mod-secondary", env().gm.interface.labelCopy(), async () => {
      await navigator.clipboard.writeText(ng32StartupReport(app, host));
      new (env().fb)(env().gm.interface.copied({ context: "generic" }));
      return true;
    }).addButton("mod-cancel", env().gm.dialogue.buttonDone(), () => {});
    return self;
  }
  inherit(Ng32StartupTimeModal, host.DialogModal);
  return Ng32StartupTimeModal;
}
