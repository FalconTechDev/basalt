// g35 clean-room: debug-info modal — collects versions, theme/snippet/plugin
// state and upgrade recommendations into a read-only text area (spec g35,
// s29-debug-info). The report text format is contract.
import { env } from "./env.js";
import { s05SystemInfo } from "./s05-utils.js";
import { s04ProjectUrl } from "./s04-http.js";
import { isOlderVersion } from "./text.js";

const NG35_REC_INSTALLER = "\tUpdate installer: installer version too low, please download from ";
const NG35_REC_INSTALLER_TAIL = " and reinstall.\n";
const NG35_REC_THEME = "\tCustom theme and snippets: for cosmetic issues, please first try updating your theme and disabling your snippets. If still not fixed, please try to make the issue happen in the Sandbox Vault or disable community theme and snippets.\n";
const NG35_REC_PLUGINS = "\tCommunity plugins: for bugs, please first try updating all your plugins to latest. If still not fixed, please try to make the issue happen in the Sandbox Vault or disable community plugins.\n";

function ng35SnippetCount(customCss) {
  const snippets = customCss.snippets || [];
  const enabled = customCss.enabledSnippets;
  if (!enabled) return 0;
  const has = typeof enabled.has === "function" ? (s) => enabled.has(s) : (s) => enabled.includes(s);
  return snippets.filter(has).length;
}

/** Debug info modal. ctor (app); extends host.ButtonModal. */
export function ng35DefineDebugInfoModal(host) {
  class Ng35DebugInfoModal extends host.ButtonModal {
    constructor(app) {
      super(app);
      this.modalEl.addClass("mod-lg");
      this.titleEl.setText(host.i18n.interface.labelDebugInfo());
      this.infoTextEl = this.contentEl.createEl("textarea", { cls: "debug-textarea" });
      this.infoTextEl.setAttribute("spellcheck", "false");
      this.infoTextEl.disabled = true;
      this.infoTextEl.value = "Loading...";
      const i18n = host.i18n.interface;
      this.addButton("mod-secondary", i18n.labelCopy(), () => {
        env().Ec(this.infoTextEl.value);
        new (env().fb)(i18n.copied({ item: i18n.labelDebugInfo() }));
      });
      if (env().Yl.isDesktop && env().Yl.isDesktopApp) {
        this.addButton("", i18n.helpScreen.labelSandboxVault(), () => {
          env().Of((e) => e.ipcRenderer.sendSync("sandbox"));
        });
      }
      this.addButton("mod-cancel", host.i18n.dialogue.buttonDone(), () => {});
      this.setInfoText();
    }

    async setInfoText() {
      const app = this.app;
      let text = await s05SystemInfo();
      text += "\tLive preview: " + (app.vault.getConfig("livePreview") ? "on" : "off") + "\n";
      if (env().activeDocument.body.classList.contains("emulate-mobile")) {
        text += "\tEmulate mobile: on\n";
      }
      const theme = app.vault.getConfig("theme");
      text += "\tBase theme: " + (theme === "system" ? "adapt to system" : theme === "basalt" ? "dark" : "light") + "\n";
      const customCss = app.customCss || {};
      const themeName = customCss.theme || "none";
      const themeInfo = customCss.themes && customCss.themes[themeName];
      text += "\tCommunity theme: " + themeName + (themeInfo && themeInfo.version ? " " + themeInfo.version : "") + "\n";
      const snippetCount = ng35SnippetCount(customCss);
      text += "\tSnippets enabled: " + snippetCount + "\n";
      const pluginsOn = app.plugins.isEnabled();
      text += "\tRestricted mode: " + (pluginsOn ? "off" : "on") + "\n";
      let pluginCount = 0;
      if (pluginsOn) {
        const manifests = app.plugins.manifests || {};
        const instances = app.plugins.plugins || {};
        text += "\tPlugins installed: " + Object.keys(manifests).length + "\n";
        const ids = Object.keys(instances);
        text += "\tPlugins enabled: " + ids.length + "\n";
        ids.forEach((id, i) => {
          const m = instances[id].manifest || {};
          text += "\t\t" + (i + 1) + ": " + (m.name || id) + " v" + (m.version || "") + "\n";
        });
        pluginCount = ids.length;
      }
      const recs = [];
      if (env().Yl.isDesktopApp && isOlderVersion(env().zf, env().yte)) {
        recs.push(NG35_REC_INSTALLER + s04ProjectUrl() + NG35_REC_INSTALLER_TAIL);
      }
      if (themeName !== "none" || snippetCount > 0) recs.push(NG35_REC_THEME);
      if (pluginsOn && pluginCount > 0) recs.push(NG35_REC_PLUGINS);
      text += "\nRECOMMENDATIONS:\n";
      text += recs.length ? recs.join("") : "\tnone\n";
      this.infoTextEl.value = text;
    }
  }
  return Ng35DebugInfoModal;
}
