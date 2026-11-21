// g23 clean-room: "About" settings tab (spec g23 §2.8/§3.8, orig N7).
import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { ng23T, ng23Moment, ng23Later } from "./n-g23-util.js";
import { account, acctUserInfo, acctSignOut, acctValidateBusinessKey } from "./n-g23-account.js";
import { NG23_WIKI_URL, NG23_REPO_URL } from "./n-g23-account-modals.js";

const T = (host, path, fb, arg) => ng23T(host, path, fb, arg);
const NG23ABOUT_T = (host, key, fb, arg) => T(host, "setting.about." + key, fb, arg);
const NG23ACCT_T = (host, key, fb, arg) => T(host, "setting.account." + key, fb, arg);
const NG23DL_T = (host, key, fb) => T(host, "dialogue." + key, fb);
const NG23ABOUT_IF_T = (host, key, fb) => T(host, "interface." + key, fb);

function ng23Ipc() {
  const e = env();
  const cand = [e.Of && (e.Of.ipcRenderer || e.Of), typeof window !== "undefined" && window.electron && window.electron.ipcRenderer];
  for (const c of cand) if (c && typeof c.sendSync === "function") return c;
  return null;
}

function ng23Sync(ipc, channel, arg) {
  if (!ipc) return undefined;
  try { return arg === undefined ? ipc.sendSync(channel) : ipc.sendSync(channel, arg); } catch (err) { return undefined; }
}

export function defineAboutTab(host) {
  function AboutTab(app, setting) {
    const self = host.SettingTab.call(this, app, setting) || this;
    self.name = NG23ABOUT_T(host, "name", "About");
    self.id = "about";
    self.icon = "circle-user";
    self._accountRowsEl = null;
    self._langButton = null;
    self._langValue = null;
    self._accountLoaded = false;
    return self;
  }
  inherit(AboutTab, host.SettingTab);
  const proto = AboutTab.prototype;

  proto.display = function () {
    this.containerEl.empty();
    this._langButton = null;
    this._accountRowsEl = null;
    const platform = env().Yl || host.Platform;
    if (platform && platform.isDesktopApp) this._renderDesktopVersion();
    else if (env().Em) this._renderMobileVersion();
    this._renderLanguage();
    this._renderHelp();
    this._renderAccount();
    this._renderAdvanced();
    this._refreshAccountAsync();
  };
  // ------------------------------------------------------------ version ----

  proto._renderDesktopVersion = function () {
    const self = this;
    const platform = env().Yl || host.Platform;
    const ipc = ng23Ipc();
    const update = ng23Sync(ipc, "update");
    const updateChecking = !!ng23Sync(ipc, "check-update");
    const updateDisabled = !!ng23Sync(ipc, "disable-update");

    // poll while a check is in flight; re-display once it clears
    if (updateChecking) {
      const poll = () => {
        if (!self.containerEl.isConnected) return;
        if (!ng23Sync(ng23Ipc(), "check-update")) { self.display(); return; }
        ng23Later(poll, 1000);
      };
      ng23Later(poll, 300);
    }

    const group = new host.SettingGroup(this.containerEl);
    group.addSetting((setting) => {
      const version = platform.version || "";
      setting.setName(NG23ABOUT_T(host, "labelVersion", "Version {version}", { version }));
      setting.setDesc(NG23ABOUT_T(host, "labelInstallVersion", "Installed build {version}", { version: platform.build || "" }));
      const desc = setting.descEl;
      const downloaded = update === "update-downloaded" || (update && update.status === "update-downloaded");
      const manual = update === "update-manual-required" || (update && update.status === "update-manual-required");
      let manualNeeded = manual;
      if (!manualNeeded) {
        try {
          const cmp = env().gy && env().zf !== undefined && env().yte !== undefined ? env().gy(env().zf, env().yte) : false;
          manualNeeded = !!cmp;
        } catch (err) { manualNeeded = false; }
      }
      const changelog = () => {
        const a = desc.createEl("a", {
          cls: "clickable-icon",
          text: NG23ABOUT_T(host, "labelReadChangelog", "Read the changelog"),
          attr: { href: NG23_REPO_URL + "/releases", target: "_blank", rel: "noopener" },
        });
        return a;
      };
      if (downloaded) {
        desc.appendText(NG23ABOUT_T(host, "labelNewVersionReady", "A new version is ready to install."));
        desc.createEl("br");
        changelog();
      } else if (manualNeeded) {
        const b = desc.createEl("strong");
        b.setText(NG23ABOUT_T(host, "labelManualUpdateRequired", "Manual update required"));
        desc.appendText(" ");
        let url = NG23_REPO_URL + "/releases";
        try { if (typeof env().fy === "function") url = env().fy() || url; } catch (err) {}
        desc.createEl("a", {
          text: NG23DL_T(host, "buttonDownload", "Download"),
          attr: { href: url, target: "_blank", rel: "noopener" },
        });
      } else {
        changelog();
      }

      if (downloaded) {
        setting.addButton((button) => {
          button.setButtonText(NG23DL_T(host, "buttonRelaunch", "Relaunch")).setCta().onClick(() => {
            ng23Sync(ng23Ipc(), "relaunch");
          });
        });
      } else {
        setting.addButton((button) => {
          button.setButtonText(NG23DL_T(host, "buttonCheckForUpdates", "Check for updates"));
          if (updateChecking) button.setDisabled(true);
          button.onClick(() => {
            const ipc2 = ng23Ipc();
            if (ipc2 && typeof ipc2.send === "function") { try { ipc2.send("check-update", true); } catch (err) {} }
            self.display();
          });
        });
      }
    });

    // auto-update toggle
    group.addSetting((setting) => {
      setting
        .setName(NG23ABOUT_T(host, "optionAutoUpdate", "Automatic updates"))
        .setDesc(NG23ABOUT_T(host, "optionAutoUpdateDescription", "Download and install updates automatically."))
        .addToggle((toggle) => {
          toggle.setValue(!updateDisabled).onChange((value) => {
            ng23Sync(ng23Ipc(), "disable-update", !value);
            ng23Later(() => self.display(), 500);
          });
        });
    });

    // insider build (licensed accounts only)
    if (account.license) {
      group.addSetting((setting) => {
        const insider = !!ng23Sync(ng23Ipc(), "insider-build", null);
        setting
          .setName(NG23ABOUT_T(host, "optionInsiderBuild", "Insider build"))
          .setDesc(NG23ABOUT_T(host, "optionInsiderBuildDescription", "Join the insider testing programme."))
          .addToggle((toggle) => {
            toggle.setValue(insider).onChange((value) => {
              ng23Sync(ng23Ipc(), "insider-build", value);
            });
          });
      });
    } else {
      try {
        const ipc = ng23Ipc();
        if (ipc && typeof ipc.send === "function") ipc.send("insider-build", false);
      } catch (err) {}
    }
  };

  proto._renderMobileVersion = function () {
    const platform = env().Yl || host.Platform;
    const group = new host.SettingGroup(this.containerEl);
    group.addSetting((setting) => {
      let label = env().gte || "";
      try { if (typeof env().gte === "function") label = env().gte(); } catch (err) {}
      setting.setName(NG23ABOUT_T(host, "labelVersion", "Version {version}", { version: label + " (" + (platform.build || "") + ")" }));
    });
  };
  // -------------------------------------------------------------- language --

  proto._renderLanguage = function () {
    const self = this;
    const group = new host.SettingGroup(this.containerEl);
    group.addSetting((setting) => {
      setting
        .setName(NG23ABOUT_T(host, "optionLanguage", "Language"))
        .setDesc(NG23ABOUT_T(host, "optionLanguageDescription", "Choose the interface language."));
      const descEl = setting.descEl;
      descEl.createEl("br");
      descEl.createEl("a", {
        text: NG23ABOUT_T(host, "labelAddOwnLanguage", "Add your own language"),
        attr: { href: NG23_WIKI_URL, target: "_blank", rel: "noopener" },
      });
      const codes = Array.isArray(env().Jf) ? env().Jf : [];
      const names = env().Zf || {};
      let current = "";
      try { current = typeof env().sm === "function" ? env().sm() : env().sm; } catch (err) {}
      setting.addDropdown((dropdown) => {
        for (const code of codes) dropdown.addOption(code, names[code] || code);
        dropdown.setValue(current || (codes[0] || ""));
        dropdown.onChange((value) => {
          self._langValue = value;
          if (self._langButton) self._langButton.toggle(value !== current);
        });
      });
      setting.addButton((button) => {
        self._langButton = button.buttonEl || button;
        const wrap = self._langButton;
        wrap.hide();
        button.setButtonText(NG23DL_T(host, "buttonRelaunch", "Relaunch")).onClick(() => {
          const sel = self._langValue;
          try { if (sel && typeof env().lm === "function") env().lm(sel); } catch (err) {}
          try { window.location.reload(); } catch (err) {}
        });
      });
    });
  };

  // ----------------------------------------------------------------- help ---

  proto._renderHelp = function () {
    const self = this;
    const group = new host.SettingGroup(this.containerEl);
    group.addSetting((setting) => {
      setting
        .setName(NG23ABOUT_T(host, "optionGetHelp", "Help"))
        .setDesc(NG23ABOUT_T(host, "optionGetHelpDescription", "Find answers and report problems."))
        .addButton((button) => {
          button.setButtonText(NG23ABOUT_T(host, "buttonOpen", "Open")).onClick(() => {
            try { self.setting && self.setting.close && self.setting.close(); } catch (err) {}
            try { this.app.openHelp && this.app.openHelp(); } catch (err) {}
          });
        });
    });
  };
  // --------------------------------------------------------------- account --

  proto._renderAccount = function () {
    const group = new host.SettingGroup(this.containerEl)
      .addHeading(() => NG23ACCT_T(host, "name", "Account"));
    this._accountRowsEl = group.listEl;
    this._renderAccountRows();
  };

  proto._accountItem = function (name, descNodes, buttons) {
    const item = this._accountRowsEl.createDiv("setting-item");
    const info = item.createDiv("setting-item-info");
    info.createDiv("setting-item-name").setText(name);
    const desc = info.createDiv("setting-item-description");
    for (const node of descNodes) {
      if (typeof node === "string") desc.appendText(node); else desc.appendChild(node);
    }
    const control = item.createDiv("setting-item-control");
    for (const btn of buttons) control.appendChild(btn);
    return item;
  };

  proto._accountButton = function (cls, text, onClick) {
    const btn = createEl("button", { cls: "clickable-icon " + cls });
    btn.setText(text);
    btn.addEventListener("click", onClick);
    return btn;
  };

  proto._renderAccountRows = function () {
    const self = this;
    const box = this._accountRowsEl;
    if (!box) return;
    box.empty();
    const platform = env().Yl || host.Platform;
    const isAndroid = !!(platform && platform.isAndroidApp);

    // -- account row ------------------------------------------------------
    if (account.email) {
      const btns = [];
      if (!isAndroid) {
        btns.push(this._accountButton("", NG23ABOUT_IF_T(host, "buttonManage", "Manage"), () => {
          try { window.open(NG23_REPO_URL, "_blank", "noopener"); } catch (err) {}
        }));
      }
      const outBtn = this._accountButton("mod-destructive", NG23ACCT_T(host, "buttonLogOut", "Log out"), async (event) => {
        const btn = event.currentTarget;
        btn.addClass("mod-loading");
        try {
          await acctSignOut(account);
          self.display();
        } catch (err) {
          try { new host.Notice(String(err && err.message || err)); } catch (e) {}
        } finally {
          btn.removeClass("mod-loading");
        }
      });
      btns.push(outBtn);
      this._accountItem(
        NG23ACCT_T(host, "optionYourAccount", "Your account"),
        [NG23ACCT_T(host, "optionYourAccountDesc", "Signed in as {name} ({email})", { name: account.name || "", email: account.email })],
        btns
      );
    } else {
      const btns = [
        this._accountButton("", NG23ACCT_T(host, "labelLogIn", "Log in"), () => {
          new host.LoginModal(this.app).setCloseCallback(() => self.display()).open();
        }),
      ];
      btns.push(this._accountButton("", NG23ACCT_T(host, "labelSignUp", "Sign up"), () => {
        if (platform && platform.isIosApp && env().Em && env().Tm && typeof env().Tm.open === "function") {
          try { env().Tm.open({ url: NG23_REPO_URL }); return; } catch (err) {}
        }
        try { window.open(NG23_REPO_URL, "_blank", "noopener"); } catch (err) {}
      }));
      this._accountItem(NG23ACCT_T(host, "optionYourAccount", "Your account"), [NG23ACCT_T(host, "optionYourAccountDescNoLogin", "Log in or sign up for an account.")], btns);
    }

    // -- catalyst row (signed-in only) -------------------------------------
    if (account.email) {
      const btns = [];
      if (account.license) {
        const tier = account.license;
        if (!(tier === "vip" || isAndroid)) {
          btns.push(this._accountButton("", NG23ACCT_T(host, "buttonUpgradeCatalyst", "Upgrade"), () => {
            try { window.open(NG23_REPO_URL, "_blank", "noopener"); } catch (err) {}
          }));
        }
        this._accountItem(NG23ACCT_T(host, "optionCatalyst", "Catalyst"), [NG23ACCT_T(host, "optionCatalystDesc", "Licence tier: {tier}", { tier })], btns);
      } else {
        const desc = [NG23ACCT_T(host, "optionCatalystDescNoLicense", "Get a licence for extra features.")];
        if (!isAndroid) {
          btns.push(this._accountButton("", NG23ABOUT_IF_T(host, "buttonLearnMore", "Learn more"), () => {
            try { window.open(NG23_WIKI_URL, "_blank", "noopener"); } catch (err) {}
          }));
          btns.push(this._accountButton("", NG23ACCT_T(host, "buttonPurchase", "Purchase"), () => {
            try { window.open(NG23_REPO_URL, "_blank", "noopener"); } catch (err) {}
          }));
        }
        this._accountItem(NG23ACCT_T(host, "optionCatalyst", "Catalyst"), desc, btns);
      }
    }

    // -- commercial licence row --------------------------------------------
    const licBtns = [];
    const openLicense = () => { new host.LicenseModal(this.app).open(); };
    let licName = NG23ACCT_T(host, "optionCommercialLicense", "Commercial licence");
    let licDesc = [];
    if (account.key) {
      licName = NG23ABOUT_T(host, "labelCommercialLicense", "Commercial licence");
      licDesc = [NG23ABOUT_T(host, "labelYourCommercialLicenseKey", "Key: {key}", { key: account.key })];
      if (account.keyValidation === "valid") {
        const moment = ng23Moment();
        let expiry = "";
        try { expiry = moment && account.expiry ? moment(account.expiry).format("MMMM D, YYYY") : ""; } catch (err) {}
        licDesc.push(" " + NG23ABOUT_T(host, "labelCommercialLicenseInfo", "{company} · {seats} seats · expires {expiry}", { company: account.company || "", seats: account.seats || "", expiry }));
        licBtns.push(this._accountButton("", NG23ABOUT_T(host, "buttonRemoveCommercialLicense", "Remove"), () => {
          account.setKey(null);
          self.display();
        }));
      } else if (typeof account.keyValidation === "string" && account.keyValidation) {
        licDesc.push(NG23ABOUT_T(host, "labelInvalidCommercialLicense", "Invalid licence key") + " " + account.keyValidation);
        licBtns.push(this._accountButton("", NG23ABOUT_T(host, "buttonActivate", "Activate"), openLicense));
      } else {
        licDesc = [NG23ABOUT_T(host, "labelValidatingCommercialLicense", "Validating licence key…")];
      }
    } else {
      licDesc = [NG23ABOUT_T(host, "optionCommercialLicenseDesc", "Activate a commercial licence key.")];
      if (!isAndroid) {
        licBtns.push(this._accountButton("", NG23ABOUT_IF_T(host, "buttonLearnMore", "Learn more"), () => {
          try { window.open(NG23_WIKI_URL, "_blank", "noopener"); } catch (err) {}
        }));
        licBtns.push(this._accountButton("", NG23ABOUT_T(host, "buttonPurchase", "Purchase"), () => {
          try { window.open(NG23_REPO_URL, "_blank", "noopener"); } catch (err) {}
        }));
      }
      licBtns.push(this._accountButton("", NG23ABOUT_T(host, "buttonActivate", "Activate"), openLicense));
    }
    this._accountItem(licName, licDesc, licBtns);
  };

  proto.updateAccountSettings = function () {
    this._renderAccountRows();
  };

  proto._refreshAccountAsync = function () {
    if (this._accountLoaded) return;
    this._accountLoaded = true;
    const self = this;
    (async () => {
      try { await acctUserInfo(account); } catch (err) {}
      try { await acctValidateBusinessKey(account); } catch (err) {}
      self.updateAccountSettings();
    })();
  };
  // -------------------------------------------------------------- advanced --

  proto._renderAdvanced = function () {
    const self = this;
    const platform = env().Yl || host.Platform;
    const group = new host.SettingGroup(this.containerEl)
      .addHeading(() => NG23ABOUT_T(host, "optionAdvanced", "Advanced"));

    // slow startup check
    group.addSetting((setting) => {
      let on = false;
      try { on = !!this.app.loadLocalStorage("slow-startup-check"); } catch (err) {}
      setting
        .setName(NG23ABOUT_T(host, "optionCheckSlowStartup", "Check for slow startup"))
        .setDesc(NG23ABOUT_T(host, "optionCheckSlowStartupDescription", "Measure startup time on launch."))
        .addToggle((toggle) => {
          toggle.setValue(on).onChange((value) => {
            try { this.app.saveLocalStorage("slow-startup-check", value ? "1" : null); } catch (err) {}
          });
        })
        .addExtraButton((button) => {
          button.setIcon("lucide-timer").setTooltip(NG23DL_T(host, "buttonCheckStartup", "Check startup")).onClick(() => {
            new host.SlowStartupCheck(this.app).open();
          });
        });
    });

    // CLI registration (desktop + electron only)
    const ipc = ng23Ipc();
    if (platform && platform.isDesktopApp && ipc && typeof window !== "undefined" && window.electron) {
      group.addSetting((setting) => {
        const cliOn = !!ng23Sync(ipc, "cli", null);
        setting
          .setName(NG23ABOUT_T(host, "optionCli", "Command line interface"))
          .setDesc(NG23ABOUT_T(host, "optionCliDescription", "Register the basalt CLI."))
          .addToggle((toggle) => {
            toggle.setValue(cliOn).onChange((value) => {
              ng23Sync(ng23Ipc(), "cli", value);
              if (value) self._openCliRegister();
            });
          });
      });
    }
  };

  proto._openCliRegister = function () {
    const self = this;
    const ipc = ng23Ipc();
    if (!ipc) return;
    const modal = new host.ButtonModal(this.app);
    modal.modalEl.addClass("mod-lg");
    modal.setTitle(NG23ABOUT_T(host, "optionRegisterPath", "Register CLI"));
    const content = modal.contentEl;
    content.empty();
    content.createEl("p", { text: NG23ABOUT_T(host, "optionRegisterPathDescription", "Allow the basalt command in your terminal.") });
    const errWrap = content.createDiv("message-container");
    const errEl = errWrap.createDiv("message mod-error");
    errEl.hide();
    modal.buttonContainerEl.createEl("a", {
      cls: "mod-secondary",
      text: NG23ABOUT_IF_T(host, "buttonLearnMore", "Learn more"),
      attr: { href: NG23_WIKI_URL, target: "_blank", rel: "noopener" },
    });
    modal.addButton("mod-cancel", NG23DL_T(host, "buttonSkip", "Skip"), () => {});
    modal.addButton("mod-cta", NG23ABOUT_T(host, "buttonRegister", "Register"), async () => {
      let result = null;
      try { result = await ipc.invoke("register-cli"); } catch (err) { result = { success: false, message: String(err && err.message || err) }; }
      if (result && result.success) {
        try { new host.Notice(result.message || "OK"); } catch (err) {}
        return false;
      }
      errEl.setText((result && result.message) || "Failed");
      errEl.show();
      return true;
    });
    modal.open();
  };

  return AboutTab;
}

