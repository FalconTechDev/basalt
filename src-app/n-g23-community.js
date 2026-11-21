// g23 clean-room: "Community plugins" settings tab (spec g23 §3.5).
import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { ng23T, ng23Contains, ng23Collator } from "./n-g23-util.js";

const NG23ED_TP_T = (host, key, fb, arg) => ng23T(host, "setting.thirdPartyPlugin." + key, fb, arg);
const NG23ED_OPT_T = (host, key, fb, arg) => ng23T(host, "setting.options." + key, fb, arg);
const NG23WIKI = "https://github.com/FalconTechDev/basalt/wiki";

export function defineCommunityPluginsTab(host) {
  function CommunityPluginsTab(app, setting) {
    const self = host.SettingTab.call(this, app, setting) || this;
    self.name = NG23ED_TP_T(host, "name", "Community plugins");
    self.id = "community-plugins";
    self.icon = "puzzle";
    self.query = "";
    return self;
  }
  inherit(CommunityPluginsTab, host.SettingTab);
  const proto = CommunityPluginsTab.prototype;

  proto.display = function () { this.render(true); };

  // ---- restricted mode (plugins disabled) ---------------------------------

  proto._renderRestricted = function () {
    const app = this.app;
    this.containerEl.empty();

    const group = new host.SettingGroup(this.containerEl);
    group.addClass("community-plugins-disclaimer");

    group.addSetting((s) => s.setName(NG23ED_TP_T(host, "labelExitRestrictedMode", "Leave Restricted Mode"))
      .setDesc(NG23ED_TP_T(host, "labelExitRestrictedModeDescription_1", "Community plugins act like other software you add.")));
    const p2 = this.containerEl.createEl("p", { text: NG23ED_TP_T(host, "labelExitRestrictedModeDescription_2", "Keeping plugins safe matters here:") });
    void p2;

    const iconRow = (icon, nameKey, nameFb, descKey, descFb) => {
      group.addSetting((s) => {
        const iconBox = s.settingEl.createDiv("setting-icon");
        host.setIcon(iconBox, icon);
        s.setName(NG23ED_TP_T(host, nameKey, nameFb)).setDesc(NG23ED_TP_T(host, descKey, descFb));
      });
    };
    iconRow("lucide-inspect", "labelCodeReview", "First code review", "labelCodeReviewDesc", "Our team vets each plugin once before it appears in the catalog.");
    iconRow("lucide-github", "labelOpenSource", "Open source", "labelOpenSourceDesc", "Most plugins post their code publicly on GitHub.");
    iconRow("lucide-users", "labelPeerAudit", "Review by peers", "labelPeerAuditDesc", "A large community of developers watches over one another's work.");
    iconRow("lucide-bug", "labelReportMechanism", "Reporting", "labelReportMechanismDesc", "Faulty plugins are investigated and removed when users report them.");

    this.containerEl.createEl("p", { text: NG23ED_TP_T(host, "labelExitRestrictedModeDescription_3", "Even so, a community plugin can occasionally misbehave.") });
    this.containerEl.createEl("p", { text: NG23ED_TP_T(host, "labelExitRestrictedModeDisableConfirmation", "Restricted Mode off and community plugins on — proceed?") });

    const btnWrap = this.containerEl.createDiv("community-modal-button-container");
    btnWrap.createEl("button", {
      cls: "mod-cta",
      text: NG23ED_TP_T(host, "buttonTurnOnCommunityPlugins", "Permit community plugins to load"),
    }).addEventListener("click", async (event) => {
      const btn = event.currentTarget;
      btn.addClass("mod-loading");
      try { await app.plugins.setEnable(true); } catch (e) {}
      btn.removeClass("mod-loading");
      this.render(true);
    });

    this.containerEl.createEl("a", {
      cls: "mod-secondary",
      text: NG23ED_TP_T(host, "labelLearnMore", "More on keeping plugins safe"),
      attr: { href: NG23WIKI, target: "_blank", rel: "noopener" },
    });
  };

  // ---- enabled branch --------------------------------------------------------

  proto.render = function (focusSearch) {
    const app = this.app;
    if (!app.plugins || !app.plugins.isEnabled()) { this._renderRestricted(); return; }
    this.containerEl.empty();
    this.query = "";

    // turn-off row (uses restricted-mode labels while enabled)
    const g0 = new host.SettingGroup(this.containerEl);
    g0.addSetting((s) => {
      s.setName(NG23ED_TP_T(host, "optionRestrictedMode", "Restricted mode"))
        .setDesc(NG23ED_TP_T(host, "optionRestrictedModeDescription", "Restricted mode is off right now."));
      s.addButton((b) => {
        b.setButtonText(NG23ED_TP_T(host, "buttonTurnOn", "Enable then reload"));
        b.onClick(async () => {
          try { await app.plugins.setEnable(false); } catch (e) {}
          try { window.location.reload(); } catch (e) {}
        });
      });
    });

    const manifests = app.plugins.manifests || {};
    const updates = app.plugins.updates || {};
    const ids = Object.keys(manifests).sort((a, b) => ng23Collator.compare((manifests[a].name || a), (manifests[b].name || b)));

    // browse row
    g0.addSetting((s) => {
      s.setName(NG23ED_TP_T(host, "optionBrowseCommunityPlugins", "Community plugins"))
        .setDesc(NG23ED_TP_T(host, "optionBrowseCommunityPluginsDescription", "Discover, then install plugins from the community."));
      s.addButton((b) => {
        b.setButtonText(NG23ED_TP_T(host, "buttonBrowse", "Browse"));
        b.onClick(() => {
          try {
            const Browser = env().M0;
            const modal = new Browser(app);
            modal.open();
            if (modal.setCloseCallback) modal.setCloseCallback(() => this.render(false));
          } catch (e) {}
        });
      });
    });

    // installed-count row with update/check actions
    g0.addSetting((s) => {
      const updateCount = Object.keys(updates).length;
      let desc = NG23ED_TP_T(host, "labelCurrentlyInstalled", "{{count}} plugins installed", { count: ids.length });
      if (updateCount) desc += " " + NG23ED_TP_T(host, "msgUpdatesFound", "{{count}} updates found", { count: updateCount });
      s.setDesc(desc);
      const hasUpdates = updateCount > 0;
      s.addButton((b) => {
        b.setButtonText(hasUpdates ? NG23ED_TP_T(host, "buttonUpdateAllPlugins", "Update all") : NG23ED_TP_T(host, "buttonCheckForUpdates", "Check for updates"));
        b.onClick(async () => {
          s.settingEl.addClass("is-loading");
          try {
            if (hasUpdates) {
              for (const id of Object.keys(updates)) {
                const u = updates[id];
                const m = manifests[id];
                if (m) await app.plugins.installPlugin(m.repo || (m.author && m.author + "/" + id) || id, u.version, m);
              }
            } else if (ids.length) {
              await app.plugins.checkForUpdates(false);
            }
          } catch (e) {}
          s.settingEl.removeClass("is-loading");
          this.render(false);
        });
      });
    });

    // automatic update check toggle
    g0.addSetting((s) => {
      s.setName(NG23ED_TP_T(host, "optionAutomaticUpdateCheck", "Periodic plugin update checks"))
        .setDesc(NG23ED_TP_T(host, "optionAutomaticUpdateCheckDesc", "Now and then, plugin updates get checked."));
      s.addToggle((t) => {
        t.setValue(!!app.plugins.autoCheckForUpdates);
        t.onChange((on) => { try { app.plugins.setAutomaticUpdateCheck(on); } catch (e) {} });
      });
    });

    // installed plugins group
    const group = new host.SettingGroup(this.containerEl);
    group.addClass("installed-plugins-container");
    group.addHeading(() => NG23ED_TP_T(host, "labelInstalledPlugins", "Installed plugins"));
    group.addExtraButton((b) => {
      b.setIcon("lucide-refresh-cw");
      b.setTooltip(NG23ED_TP_T(host, "buttonReloadPlugins", "Reload plugins"));
      b.onClick(async () => {
        try { await app.plugins.loadManifests(); } catch (e) {}
        try { new host.Notice(NG23ED_TP_T(host, "msgReloadedThirdPartyPlugins", "Plugins reloaded.")); } catch (e) {}
        this.render(false);
      });
    });
    if (host.Platform.isDesktopApp) {
      group.addExtraButton((b) => {
        b.setIcon("lucide-folder-open");
        b.setTooltip(NG23ED_TP_T(host, "buttonOpenPluginsFolder", "Open plugins folder"));
        b.onClick(async () => {
          try {
            const folder = app.plugins.getPluginFolder();
            if (folder) await app.openWithDefaultApp(folder.path || folder);
          } catch (e) {}
        });
      });
    }

    // search field
    if (ids.length) {
      group.addSearch((search) => {
        search.setPlaceholder(NG23ED_TP_T(host, "placeholderSearchInstalledPlugin", "Find installed plugins..."));
        if (focusSearch && host.Platform.hasPhysicalKeyboard) { try { search.inputEl.focus(); } catch (e) {} }
        search.onChange((value) => { this.query = value; this._renderPluginRows(group); });
      });
    }
    this._pluginGroup = group;
    this._renderPluginRows(group);
  };

  proto._renderPluginRows = function (group) {
    const app = this.app;
    const manifests = app.plugins.manifests || {};
    const pluginsEnabled = app.plugins.plugins || {};
    const updates = app.plugins.updates || {};
    const q = this.query.trim().toLowerCase();
    const words = q ? q.split(/\s+/).filter(Boolean) : [];
    const listEl = group.listEl;
    listEl.empty();

    const ids = Object.keys(manifests).sort((a, b) => ng23Collator.compare(manifests[a].name || a, manifests[b].name || b));
    for (const id of ids) {
      const manifest = manifests[id];
      if (words.length) {
        const hay = ((manifest.name || "") + " " + (manifest.author || "") + " " + (manifest.description || "")).toLowerCase();
        if (!words.every((w) => hay.includes(w))) continue;
      }
      const setting = new host.Setting(listEl);
      setting.setName(manifest.name || id);
      let desc = "";
      if (manifest.version) desc += NG23ED_TP_T(host, "labelVersion", "Version: {{version}}", { version: manifest.version });
      if (manifest.author) desc += (desc ? "\n" : "") + NG23ED_TP_T(host, "labelByAuthor", "Made by ") + manifest.author;
      if (manifest.description) desc += (desc ? "\n" : "") + manifest.description;
      setting.setDesc(desc);
      // enable toggle
      const plugin = pluginsEnabled[id];
      const toggleOn = !!(plugin && plugin.enabled !== false);
      setting.addToggle((t) => {
        t.setValue(toggleOn);
        t.onChange(async (on) => {
          try {
            if (on) {
              const result = await app.plugins.enablePluginAndSave(id);
              if (!result) t.setValue(false);
            } else {
              await app.plugins.disablePluginAndSave(id);
            }
          } catch (e) {}
          this._updateExtraButtons(setting);
          setTimeout(() => this._updateExtraButtons(setting), 100);
        });
      });
      // action buttons
      if (updates[id]) {
        setting.addButton((b) => {
          b.setButtonText(NG23ED_TP_T(host, "buttonUpdate", "Update"));
          b.setCta();
          b.setTooltip(NG23ED_TP_T(host, "msgUpdatePlugin", "Update to {{version}}", { version: updates[id].version || "" }));
          b.onClick(async () => {
            setting.settingEl.addClass("is-loading");
            try { await app.plugins.installPlugin(manifest.repo || (manifest.author + "/" + id), updates[id].version, manifest); } catch (e) {}
            setting.settingEl.removeClass("is-loading");
            this.render(false);
          });
        });
      }
      const hasTab = app.setting && app.setting.pluginTabs && app.setting.pluginTabs.some((tab) => tab.id === id);
      if (hasTab) {
        setting.addExtraButton((b) => {
          b.setIcon("lucide-settings");
          b.setTooltip(NG23ED_OPT_T(host, "name", "Settings", "Options"));
          b.onClick(() => { try { app.setting.openTabById(id); } catch (e) {} });
        });
      }
      const ownsCommands = Object.keys(app.commands ? app.commands.commands : {}).some((cid) => cid.startsWith(id + ":"));
      if (ownsCommands) {
        setting.addExtraButton((b) => {
          b.setIcon("lucide-plus-circle");
          b.setTooltip(NG23ED_TP_T(host, "name", "Community plugins", "Hotkeys"));
          b.onClick(() => {
            try {
              const tab = app.setting.openTabById("hotkeys");
              if (tab && tab.setQuery) tab.setQuery(id);
            } catch (e) {}
          });
        });
      }
      if (manifest.fundingUrl) {
        setting.addExtraButton((b) => {
          b.setIcon("lucide-heart");
          b.setTooltip(NG23ED_TP_T(host, "labelDonateModalTitle", "Donate to {{name}}", { name: manifest.name || id }));
          b.onClick(() => {
            try {
              const Donate = env().S0;
              const modal = new Donate(app, manifest.fundingUrl);
              modal.open();
            } catch (e) {}
          });
        });
      }
      setting.addExtraButton((b) => {
        b.setIcon("lucide-trash-2");
        b.setTooltip(NG23ED_TP_T(host, "labelUninstall", "Uninstall"));
        b.onClick(() => {
          const modal = new host.ButtonModal(app);
          modal.modalEl.addClass("mod-lg");
          modal.setTitle(NG23ED_TP_T(host, "labelUninstallPlugin", "Uninstall {{name}}", { name: manifest.name || id }));
          modal.contentEl.createEl("p", { text: NG23ED_TP_T(host, "labelUninstallPluginConfirmation", "This removes the plugin from your vault.") });
          modal.addButton("mod-warning", NG23ED_TP_T(host, "labelUninstall", "Uninstall"), async () => {
            try { await app.plugins.uninstallPlugin(id); } catch (e) {}
            this.render(false);
            return false;
          });
          modal.addCancelButton();
          modal.open();
        });
      });
      // click row info -> browser modal focused on this plugin
      try {
        setting.infoEl.addEventListener("click", () => {
          try {
            const Browser = env().M0;
            const modal = new Browser(app);
            if (modal.setAutoOpen) modal.setAutoOpen(id);
            modal.open();
          } catch (e) {}
        });
      } catch (e) {}
    }

    // manifestless loaded plugins: always-on toggle rows
    for (const id of Object.keys(app.plugins.plugins || {})) {
      if (manifests[id]) continue;
      const plugin = app.plugins.plugins[id];
      const setting = new host.Setting(listEl);
      setting.setName((plugin.manifest && plugin.manifest.name) || id);
      setting.addToggle((t) => {
        t.setValue(true);
        t.onChange(async (on) => {
          if (!on) { try { await app.plugins.disablePluginAndSave(id); } catch (e) {} this.render(false); }
          else t.setValue(true);
        });
      });
    }

    if (!ids.length && !Object.keys(app.plugins.plugins || {}).length) {
      listEl.createDiv("setting-item", (el) => {
        el.createDiv("setting-item-info").createDiv("setting-item-name", (n) => n.setText(NG23ED_TP_T(host, "labelNoResultsFound", "Nothing found.")));
      });
    }
  };

  proto._updateExtraButtons = function () {};

  return CommunityPluginsTab;
}
