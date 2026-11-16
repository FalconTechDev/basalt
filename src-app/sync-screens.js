// Sync onboarding screens (the mobile-onboarding wizard behind "Basalt Sync" setup).
// Faithful port of the inherited screen stack: same DOM classes, i18n keys, navigation
// rules and account/vault API calls. API helpers live in account.js / vault-crypto.js;
// platform bits (Android filesystem picker, Capacitor App plugin) arrive via hostEnv.

import { hostEnv } from "./env.js";
import { inherit } from "./inherit.js";
import { account, AccountError, acctCreateVault, acctForgetPassword, acctListVaults, acctResendConfirmation, acctSignIn, acctSignOut, acctSignup, acctSignupMobileSync, acctVaultRegions } from "./account.js";
import { deriveVaultKeyhash, randomSaltHex, renderFormattedDescription, SYNCABLE_FEATURE_TYPES, MEDIA_FEATURE_TYPES } from "./vault-crypto.js";
import { withButtonLoading } from "./community.js";
import { formatBytes } from "./text.js";

const senv = () => hostEnv();
const S = {};

// i18n shortcuts: `iC` = gm.interface.startScreen.mobile; `gm` = the whole string table.
const i18n = () => senv().gm.interface.startScreen.mobile;
const syncI18n = () => senv().gm.plugins.sync;
const acctI18n = () => senv().gm.setting.account;

function onboardingLogo(size) {
  const img = document.createElement("img");
  img.src = "basalt-logo.png";
  img.setAttribute("width", String(size));
  img.setAttribute("height", String(size));
  img.addClass("logo");
  return img;
}

function storagePermsGranted() { return !!senv().kD; }

// ---------------------------------------------------------------- base pieces

export function defineSyncScreenBase(host) {
  function SyncScreenBase() {
    const self = this;
    self.requiresAuth = false;
    self.title = "";
    const contentEl = self.contentEl = createDiv("mobile-onboarding-screen");
    self.titleEl = contentEl.createEl("h1", { text: self.getTitle() });
    self.formEl = contentEl.createEl("form", { attr: { id: "form" } });
    self.footerEl = contentEl.createEl("footer", "", (el) => {
      el.createDiv({ cls: "mod-version", text: senv().gte });
    });
    self.formEl.addEventListener("submit", (e) => {
      e.preventDefault();
      const cta = self.contentEl.find("button.mod-cta");
      if (cta) cta.click();
    });
  }
  SyncScreenBase.prototype.onClose = function () {};
  return (S.Base = SyncScreenBase);
}

export function defineSyncField(host) {
  function SyncField(containerEl) {
    this.helpEl = null;
    this.containerEl = containerEl.createEl("p", "form-field");
    this.labelEl = this.containerEl.createEl("label");
  }
  const proto = SyncField.prototype;
  proto.setName = function (name) { this.labelEl.setText(name); return this; };
  proto.setHelp = function (help) {
    if (this.helpEl) this.helpEl.setText(help);
    else this.helpEl = this.containerEl.createDiv({ cls: "form-field-help", text: help });
    return this;
  };
  proto.addText = function (fn) { fn(new host.TextComponent(this.containerEl)); return this; };
  proto.addDropdown = function (fn) { fn(new host.DropdownComponent(this.containerEl)); return this; };
  proto.addToggle = function (fn) { fn(new host.ToggleComponent(this.containerEl)); return this; };
  proto.addButton = function (fn) { fn(new host.ButtonComponent(this.containerEl)); return this; };
  return (S.Field = SyncField);
}

export function defineSyncRadioGroup(host) {
  function SyncRadioGroup(containerEl) {
    this.options = {};
    this.containerEl = containerEl.createDiv("mobile-onboarding-radio-group");
  }
  const proto = SyncRadioGroup.prototype;
  proto.addOption = function (value, fill) {
    const self = this;
    const option = new S.RadioOption(self.containerEl);
    fill(option.contentEl);
    self.options[value] = option;
    option.containerEl.addEventListener("click", (e) => {
      e.preventDefault();
      self.setValue(value);
    });
    return this;
  };
  proto.onChange = function (cb) { this.onChangeCb = cb; return this; };
  proto.getValue = function () { return this.value; };
  proto.setValue = function (value) {
    const prev = this.options[this.value];
    if (prev) prev.setSelected(false);
    const next = this.options[value];
    if (next) next.setSelected(true);
    this.value = value;
    if (this.onChangeCb) this.onChangeCb(value);
    return this;
  };
  return (S.RadioGroup = SyncRadioGroup);
}

export function defineSyncRadioOption(host) {
  function SyncRadioOption(containerEl) {
    const el = this.containerEl = containerEl.createDiv({ cls: "mobile-onboarding-radio-option", attr: { tabIndex: 0 } });
    el.createDiv({ cls: "mobile-onboarding-radio-button" });
    this.contentEl = el.createDiv({ cls: "mobile-onboarding-radio-content" });
  }
  SyncRadioOption.prototype.setSelected = function (selected) {
    this.containerEl.toggleClass("is-selected", selected);
  };
  return (S.RadioOption = SyncRadioOption);
}

// `e.call(this)` equivalent: run the base constructor, then fix the prototype chain.
function baseInit(self, Base) { return Base.call(self) || self; }

// ---------------------------------------------------------------- screens

export function defineSyncStartScreen(host) {
  function StartScreen() {
    const self = baseInit(this, S.Base);
    self.contentEl.prepend(onboardingLogo(64));
    renderFormattedDescription(self.formEl, i18n().labelStartScreenDesc());
    self.contentEl.createDiv("button-container", (el) => {
      new host.ButtonComponent(el).setCta().setButtonText(i18n().optionCreate())
        .onClick(() => self.controller.goTo(new S.IntroScreen()));
      new host.ButtonComponent(el).setButtonText(i18n().optionUseExisting())
        .onClick(() => self.controller.goTo(new S.ConnectMethodScreen()));
    });
    self.footerEl.createDiv({ prepend: true }, (el) => {
      const lang = senv().sm();
      el.createDiv("language-dropdown", (dd) => {
        host.setIcon(dd.createDiv("language-dropdown-icon"), "globe-2");
        const dropdown = new host.DropdownComponent(dd);
        for (const code of senv().Jf) dropdown.addOption(code, senv().Zf[code]);
        dropdown.setValue(lang);
        dropdown.onChange((v) => { senv().lm(v); window.location.reload(); });
      });
    });
    return self;
  }
  inherit(StartScreen, S.Base);
  StartScreen.prototype.getTitle = function () { return i18n().labelStartScreen(); };
  return (S.StartScreen = StartScreen);
}

export function defineSyncIntroScreen(host) {
  function IntroScreen() {
    const self = baseInit(this, S.Base);
    self.contentEl.prepend(onboardingLogo(64));
    renderFormattedDescription(self.formEl, i18n().labelSyncIntroDesc());
    self.contentEl.createDiv("button-container", (el) => {
      new host.ButtonComponent(el).setCta().setButtonText(i18n().optionSkip())
        .onClick(() => self.controller.goTo(new S.CreateVaultScreen("none")));
      new host.ButtonComponent(el).setButtonText(i18n().optionSetupSync())
        .onClick(() => self.controller.goTo(new S.SyncMethodScreen()));
    });
    return self;
  }
  inherit(IntroScreen, S.Base);
  IntroScreen.prototype.getTitle = function () { return i18n().labelSyncIntro(); };
  return (S.IntroScreen = IntroScreen);
}

export function defineCreateVaultScreen(host) {
  function CreateVaultScreen(mode, existing) {
    const self = baseInit(this, S.Base);
    let name = existing ? existing.name : "";
    const nameField = new S.Field(self.formEl).setName(i18n().labelVaultName());
    new host.TextComponent(nameField.containerEl)
      .setPlaceholder(i18n().placeholderVaultName()).setValue(name)
      .onChange((v) => { name = v; });
    let location = "external";
    if (senv().Sm) {
      const locField = new S.Field(self.formEl).setName(i18n().labelVaultLocation());
      new S.RadioGroup(locField.containerEl)
        .addOption("external", (el) => {
          el.createDiv({ cls: "mobile-onboarding-radio-option-title", text: i18n().labelDeviceStorage() }, (t) => {
            t.createSpan({ cls: "flair", text: i18n().labelRecommended() });
          });
          el.createEl("ul", { cls: "mobile-onboarding-radio-option-desc" }, (ul) => {
            ul.createEl("li", { text: i18n().labelDeviceStorageDesc() });
            if (!storagePermsGranted()) ul.createEl("li", { text: i18n().labelRequiresAdditionalPermissions() });
          });
        })
        .addOption("app", (el) => {
          el.createDiv({ cls: "mobile-onboarding-radio-option-title", text: i18n().labelAppStorage() });
          el.createEl("ul", { cls: "mobile-onboarding-radio-option-desc" }, (ul) => {
            ul.createEl("li", { text: i18n().labelAppStorageDesc1() });
            ul.createEl("li", { text: i18n().labelAppStorageDesc2() });
          });
        })
        .setValue(location).onChange((v) => { location = v; });
    }
    self.contentEl.createDiv("button-container", (el) => {
      new host.ButtonComponent(el).setCta().setButtonText(i18n().optionCreate())
        .onClick(async () => {
          if (name.trim() === "") { new host.Notice(i18n().msgNameRequired()); return; }
          let path = "";
          if (senv().Sm && location !== "app") {
            try {
              if (!storagePermsGranted()) {
                await new Promise((resolve) => self.controller.goTo(new S.StoragePermissionScreen(resolve)));
              }
              if (!storagePermsGranted()) return;
              const picked = await senv().Dm.choose();
              if (!picked || !picked.path) return;
              if (await self.controller.isDirectory(picked.path)) path = picked.path;
              else { new host.Notice(i18n().msgInvalidVault()); return; }
            } catch (err) {
              if (!(err && err.message && err.message.contains("canceled"))) new host.Notice(String(err));
              return;
            }
          }
          if (mode === "basalt-sync") {
            if (existing) self.controller.goTo(new S.SyncSettingsScreen(name, path, existing));
            else self.controller.goTo(new S.SyncSetupScreen(name, path));
          } else {
            self.controller.createVault(name, path, mode === "icloud");
          }
        });
    });
    return self;
  }
  inherit(CreateVaultScreen, S.Base);
  CreateVaultScreen.prototype.getTitle = function () { return i18n().labelVaultCreate(); };
  return (S.CreateVaultScreen = CreateVaultScreen);
}

export function defineSyncSetupScreen(host) {
  function SyncSetupScreen(name, path) {
    const self = baseInit(this, S.Base);
    self.requiresAuth = true;
    renderFormattedDescription(self.formEl, i18n().labelSyncSetupDesc());
    const nameField = new S.Field(self.formEl).setName(i18n().labelVaultName());
    nameField.addText((el) => {
      el.setPlaceholder(i18n().placeholderVaultName()).setValue(name).onChange((v) => { name = v; });
    });
    let region = "";
    let dropdown = null;
    const regionField = new S.Field(self.formEl).setName(i18n().labelRegionSelection());
    regionField.addDropdown((el) => {
      dropdown = el;
      el.addOption("", i18n().optRegionSelectionAutomatic()).setValue("").onChange((v) => { region = v; });
    });
    regionField.setHelp(i18n().labelRegionSelectionHelp());
    self.contentEl.createDiv("button-container", (el) => {
      new host.ButtonComponent(el).setCta().setButtonText(senv().gm.dialogue.buttonContinue())
        .onClick(() => {
          if (name !== "") self.controller.goTo(new S.EncryptionScreen(name, path, region));
          else new host.Notice(syncI18n().msgVaultNameCannotBeEmpty());
        });
    });
    self.populateRegions(dropdown);
    return self;
  }
  inherit(SyncSetupScreen, S.Base);
  SyncSetupScreen.prototype.getTitle = function () { return i18n().labelSyncSetup(); };
  SyncSetupScreen.prototype.populateRegions = async function (dropdown) {
    try {
      const regions = await acctVaultRegions(account.token);
      for (const r of regions) dropdown.addOption(r.value, r.name);
    } catch (err) { /* regions are optional */ }
  };
  return (S.SyncSetupScreen = SyncSetupScreen);
}

export function defineEncryptionScreen(host) {
  function EncryptionScreen(name, path, region) {
    const self = baseInit(this, S.Base);
    const form = self.formEl;
    let custom = true;
    let password = "";
    let keyField = null;
    new S.RadioGroup(form)
      .addOption("custom", (el) => {
        el.createDiv({ cls: "mobile-onboarding-radio-option-title", text: i18n().optionEncryptionCustom() }, (t) => {
          t.createSpan({ cls: "flair", text: i18n().labelRecommended() });
        });
        el.createEl("ul", { cls: "mobile-onboarding-radio-option-desc", text: i18n().optionEncryptionCustomDesc() });
      })
      .addOption("managed", (el) => {
        el.createDiv({ cls: "mobile-onboarding-radio-option-title", text: i18n().optionEncryptionManaged() });
        el.createEl("ul", { cls: "mobile-onboarding-radio-option-desc", text: i18n().optionEncryptionManagedDesc() });
      })
      .setValue("custom")
      .onChange((v) => {
        custom = v === "custom";
        keyField.containerEl.toggle(custom);
      });
    keyField = new S.Field(form).setName(i18n().labelEncryptionKey());
    keyField.addText((el) => {
      el.setValue(password).onChange((v) => { password = v; })
        .then((input) => { input.inputEl.type = "password"; input.inputEl.autocomplete = "new-password"; });
    }).setHelp(i18n().labelEncryptionKeyHelp());
    self.contentEl.createDiv("button-container", (el) => {
      new host.ButtonComponent(el).setCta().setButtonText(i18n().buttonCreate())
        .onClick(async (e) => {
          if (custom && password === "") { new host.Notice(syncI18n().msgPleaseEnterPassword()); return; }
          if (name === "") { new host.Notice(syncI18n().msgVaultNameCannotBeEmpty()); return; }
          let keyhash = null, salt = null;
          try {
            if (custom) {
              salt = randomSaltHex();
              keyhash = await deriveVaultKeyhash(password, salt, 3);
            }
            const vault = await acctCreateVault(account.token, name, keyhash, salt, region, 3);
            if (custom) vault.password = password;
            self.controller.goTo(new S.SyncSettingsScreen(name, path, vault));
          } catch (err) {
            new host.Notice(err && err.message ? err.message : String(err));
          }
        });
    });
    return self;
  }
  inherit(EncryptionScreen, S.Base);
  EncryptionScreen.prototype.getTitle = function () { return i18n().labelRemoteVaultCreate(); };
  EncryptionScreen.prototype.populateRegions = async function (dropdown) {
    try {
      const regions = await acctVaultRegions(account.token);
      for (const r of regions) dropdown.addOption(r.value, r.name);
    } catch (err) { /* regions are optional */ }
  };
  return (S.EncryptionScreen = EncryptionScreen);
}

export function defineSyncSettingsScreen(host) {
  function SyncSettingsScreen(name, path, vault) {
    const self = baseInit(this, S.Base);
    self.requiresAuth = true;
    renderFormattedDescription(self.formEl, i18n().labelSyncSettingsDesc());
    const settingRows = [
      [syncI18n().optionSyncApp(), "app"], [syncI18n().optionSyncAppearance(), "appearance"],
      [syncI18n().optionSyncAppearanceData(), "appearance-data"], [syncI18n().optionSyncHotkey(), "hotkey"],
      [syncI18n().optionSyncCorePlugin(), "core-plugin"], [syncI18n().optionSyncCorePluginData(), "core-plugin-data"],
      [syncI18n().optionSyncCommunityPlugin(), "community-plugin"], [syncI18n().optionSyncCommunityPluginData(), "community-plugin-data"],
    ];
    const row = (table, label, synced) => {
      table.createDiv("feature-row", (r) => {
        r.createDiv("feature-cell", (c) => c.setText(label));
        const value = r.createDiv("feature-cell mod-value");
        if (synced) {
          value.addClass("is-enabled");
          value.createSpan({ text: i18n().labelSynced() });
          host.setIcon(value.createSpan(), "lucide-check");
        } else value.setText(i18n().labelNotSynced());
      });
    };
    self.contentEl.createDiv("mobile-onboarding-feature-table", (table) => {
      for (const [label, type] of settingRows) row(table, label, SYNCABLE_FEATURE_TYPES.includes(type));
    });
    const mediaRows = [
      [syncI18n().optionSyncImage(), "image"], [syncI18n().optionSyncAudio(), "audio"],
      [syncI18n().optionSyncVideo(), "video"], [syncI18n().optionSyncPdf(), "pdf"],
      [syncI18n().optionSyncUnsupported(), "unsupported"],
    ];
    self.formEl.createDiv("mobile-onboarding-feature-table", (table) => {
      table.createDiv("feature-row", (r) => {
        r.createDiv({ cls: "feature-cell", text: syncI18n().optionExcludedFolders() });
        r.createDiv({ cls: "feature-cell mod-value", text: i18n().labelNone() });
      });
      for (const [label, type] of mediaRows) row(table, label, MEDIA_FEATURE_TYPES.includes(type));
    });
    self.contentEl.createDiv("button-container", (el) => {
      new host.ButtonComponent(el).setCta().setButtonText(i18n().buttonStart())
        .onClick(() => self.controller.createVault(name, path, false, vault));
    });
    return self;
  }
  inherit(SyncSettingsScreen, S.Base);
  SyncSettingsScreen.prototype.getTitle = function () { return i18n().labelSyncSettings(); };
  return (S.SyncSettingsScreen = SyncSettingsScreen);
}

export function defineAuthChoiceScreen(host) {
  function AuthChoiceScreen() {
    const self = baseInit(this, S.Base);
    self.contentEl.createDiv("button-container", (el) => {
      new host.ButtonComponent(el).setCta().setButtonText(i18n().optionSignUp())
        .onClick(() => self.controller.goTo(new S.EmailEntryScreen()));
      new host.ButtonComponent(el).setButtonText(i18n().optionSignIn())
        .onClick(() => self.controller.goTo(new S.SignInScreen()));
    });
    return self;
  }
  inherit(AuthChoiceScreen, S.Base);
  AuthChoiceScreen.prototype.getTitle = function () { return i18n().labelSignInOrSignUp(); };
  return (S.AuthChoiceScreen = AuthChoiceScreen);
}

export function defineRemoteVaultOptionsScreen(host) {
  function RemoteVaultOptionsScreen(vaults) {
    const self = baseInit(this, S.Base);
    self.requiresAuth = true;
    renderFormattedDescription(self.formEl, i18n().labelRemoteVaultOptionsDesc());
    self.contentEl.createDiv("button-container", (el) => {
      new host.ButtonComponent(el).setCta().setButtonText(i18n().optionRemoteCreate())
        .onClick(() => self.controller.goTo(new S.CreateVaultScreen("basalt-sync")));
      new host.ButtonComponent(el).setButtonText(i18n().optionRemoteChoose())
        .onClick(() => self.controller.goTo(new S.VaultListScreen(vaults)));
    });
    self.footerEl.createDiv("button-container", (el) => {
      const logout = new host.ButtonComponent(el).setButtonText(i18n().buttonLogout())
        .onClick(async () => {
          try { await acctSignOut(account); self.controller.backToLogin(); }
          catch (err) { /* ignore */ }
        });
    });
    return self;
  }
  inherit(RemoteVaultOptionsScreen, S.Base);
  RemoteVaultOptionsScreen.prototype.getTitle = function () { return i18n().labelRemoteVaultOptions(); };
  return (S.RemoteVaultOptionsScreen = RemoteVaultOptionsScreen);
}

export function defineVaultListScreen(host) {
  function VaultListScreen(vaultsRes) {
    const self = baseInit(this, S.Base);
    self.requiresAuth = true;
    renderFormattedDescription(self.formEl, i18n().labelRemoteVaultSelectionDesc({ email: account.email }));
    const form = self.formEl;
    const addRow = (parent, vault, arr, i) => {
      parent.createDiv("list-item mod-selectable tappable", (el) => {
        el.createDiv("list-item-part mod-extended", (main) => {
          main.createDiv({ cls: "list-item-title", text: vault.name });
          main.createDiv("list-item-desc", (desc) => {
            if (vault.hasOwnProperty("region") && vault.region !== "") desc.createDiv({ cls: "list-item-part", text: vault.region });
            desc.createDiv({ cls: "list-item-part", text: formatBytes(vault.size) });
            desc.createDiv({ cls: "list-item-part mod-extended", text: syncI18n().labelVaultCreatedTime({ time: window.moment(vault.created).fromNow() }) });
          });
        });
        el.addEventListener("click", () => self.controller.goTo(new S.CreateVaultScreen("basalt-sync", vault)));
      });
      if (i < arr.length - 1) parent.createDiv("list-item-separator");
    };
    form.createDiv("list-container has-row-lines", (list) => {
      vaultsRes.vaults.forEach((v, i) => addRow(list, v, vaultsRes.vaults, i));
    });
    if (vaultsRes.shared.length > 0) {
      form.createDiv({ cls: "list-heading", text: syncI18n().labelVaultsSharedWithYou() });
      form.createDiv("list-container has-row-lines", (list) => {
        vaultsRes.shared.forEach((v, i) => addRow(list, v, vaultsRes.shared, i));
      });
    }
    new host.ButtonComponent(self.footerEl).setButtonText(i18n().optionRemoteCreate())
      .onClick(() => self.controller.goTo(new S.CreateVaultScreen("basalt-sync")));
    return self;
  }
  inherit(VaultListScreen, S.Base);
  VaultListScreen.prototype.getTitle = function () { return i18n().labelRemoteVaultSelection(); };
  return (S.VaultListScreen = VaultListScreen);
}

export function defineSignInScreen(host) {
  function SignInScreen(email) {
    if (email === undefined) email = "";
    const self = baseInit(this, S.Base);
    const form = self.formEl;
    let password = "", mfa = "";
    const emailField = new S.Field(form).setName(acctI18n().labelEmail());
    emailField.addText((el) => {
      el.setValue(email).setPlaceholder(acctI18n().placeholderEmail())
        .onChange((v) => { email = v; })
        .then((input) => { input.inputEl.type = "email"; });
    });
    const passField = new S.Field(form).setName(senv().gm.interface.startScreen.optionUserPassword());
    let passComp = null;
    passField.addText((el) => {
      passComp = el;
      el.onChange((v) => { password = v; })
        .then((input) => { input.inputEl.type = "password"; });
    });
    const mfaField = new S.Field(form).setName(acctI18n().labelMfaCode());
    let mfaComp = null;
    mfaField.addText((el) => {
      mfaComp = el;
      el.onChange((v) => { mfa = v; })
        .then((input) => {
          input.inputEl.inputMode = "numeric";
          input.inputEl.pattern = "[0-9]*";
          input.inputEl.setAttribute("maxlength", "6");
          input.inputEl.setAttr("autocomplete", "one-time-code");
        });
    });
    mfaField.containerEl.hide();
    const buttons = self.contentEl.createDiv("button-container");
    new host.ButtonComponent(buttons).setCta().setButtonText(i18n().optionSignIn())
      .onClick(async (e) => {
        if (e) e.preventDefault();
        if (email === "") return self.controller.showError(acctI18n().messageEmptyEmail());
        if (email.indexOf("@") === -1) return self.controller.showError(acctI18n().messageInvalidEmail());
        if (password === "") return self.controller.showError(acctI18n().messageEmptyPassword());
        if (mfa !== "" && !/^\d{6}$/.test(mfa)) return self.controller.showError(acctI18n().mfaWrongFormat());
        try {
          const res = await acctSignIn(account, email, password, mfa);
          const vaults = await acctListVaults(res.token);
          if (vaults.limit === 0) {
            await acctSignupMobileSync(account.token);
            self.controller.goTo(new S.EmailVerificationScreen(email));
          } else if (vaults.vaults.length > 0 || vaults.shared.length > 0) {
            self.controller.goTo(new S.RemoteVaultOptionsScreen(vaults));
          } else {
            self.controller.goTo(new S.CreateVaultScreen("basalt-sync"));
          }
          if (mfaComp) mfaComp.setValue("");
          if (passComp) passComp.setValue("");
        } catch (err) {
          if (err instanceof AccountError) {
            const msg = err.error;
            if (msg.includes("2FA code is incorrect")) self.controller.showError(acctI18n().mfaVerificationFailed());
            else if (msg.includes("2FA code")) {
              emailField.containerEl.hide();
              passField.containerEl.hide();
              mfaField.containerEl.show();
            } else self.controller.showError(msg);
          } else self.controller.showError(acctI18n().messageLoginFailed());
        }
      });
    new host.ButtonComponent(self.footerEl).setButtonText(i18n().buttonForgotPassword())
      .onClick(() => self.controller.goTo(new S.ForgotPasswordScreen(email)));
    return self;
  }
  inherit(SignInScreen, S.Base);
  SignInScreen.prototype.getTitle = function () { return i18n().labelSignIn(); };
  return (S.SignInScreen = SignInScreen);
}

export function defineForgotPasswordScreen(host) {
  function ForgotPasswordScreen(email) {
    if (email === undefined) email = "";
    const self = baseInit(this, S.Base);
    const field = new S.Field(self.formEl).setName(acctI18n().labelEmail());
    field.addText((el) => {
      el.setValue(email).setPlaceholder(acctI18n().placeholderEmail())
        .onChange((v) => { email = v; })
        .then((input) => { input.inputEl.type = "email"; });
    });
    const buttons = self.contentEl.createDiv("button-container");
    new host.ButtonComponent(buttons).setCta().setButtonText(i18n().buttonResetPassword())
      .onClick(async (e) => {
        if (e) e.preventDefault();
        if (email === "") return self.controller.showError(acctI18n().messageEmptyEmail());
        if (email.indexOf("@") === -1) return self.controller.showError(acctI18n().messageInvalidEmail());
        try {
          await acctForgetPassword(email);
          new host.Notice(i18n().msgPasswordReset({ email }));
          self.controller.backToLogin();
        } catch (err) {
          if (err instanceof AccountError) self.controller.showError(err.error);
          else self.controller.showError(acctI18n().messageLoginFailed());
        }
      });
    return self;
  }
  inherit(ForgotPasswordScreen, S.Base);
  ForgotPasswordScreen.prototype.getTitle = function () { return i18n().labelForgotPassword(); };
  return (S.ForgotPasswordScreen = ForgotPasswordScreen);
}

export function defineSyncMethodScreen(host) {
  function SyncMethodScreen() {
    const self = baseInit(this, S.Base);
    self.requiresAuth = false;
    const labels = {
      "basalt-sync": i18n().optUseObsidianSync(),
      icloud: i18n().optUseIcloud(),
      other: i18n().optUseOther(),
    };
    renderFormattedDescription(self.formEl, i18n().labelSyncMethodSelectionDesc());
    const radio = new S.RadioGroup(self.contentEl)
      .addOption("basalt-sync", (el) => {
        el.createDiv({ cls: "mobile-onboarding-radio-option-title", text: "Basalt Sync" }, (t) => {
          t.createSpan({ cls: "flair", text: i18n().labelRecommended() });
        });
        el.createEl("ul", { cls: "mobile-onboarding-radio-option-desc" }, (ul) => {
          ul.createEl("li", { text: i18n().labelSyncPro1() });
          ul.createEl("li", { text: i18n().labelSyncPro2() });
          ul.createEl("li", { text: i18n().labelSyncPro3() });
        });
      })
      .setValue("basalt-sync");
    if (host.Platform.isIosApp) {
      radio.addOption("icloud", (el) => {
        el.createDiv({ cls: "mobile-onboarding-radio-option-title", text: "iCloud" });
        el.createEl("ul", { cls: "mobile-onboarding-radio-option-desc" }, (ul) => {
          ul.createEl("li", { text: i18n().labelIcloudCon1() });
          ul.createEl("li", { text: i18n().labelIcloudCon2() });
        });
      });
    } else {
      radio.addOption("other", (el) => {
        el.createDiv({ cls: "mobile-onboarding-radio-option-title", text: i18n().labelOtherSync() });
        el.createEl("ul", { cls: "mobile-onboarding-radio-option-desc" }, (ul) => {
          ul.createEl("li", { text: i18n().labelThirdPartyDesc1() });
          ul.createEl("li", { text: i18n().labelThirdPartyDesc2() });
        });
      });
    }
    const buttons = self.contentEl.createDiv("button-container");
    let button = null;
    radio.onChange((v) => button && button.setButtonText(labels[v]));
    button = new host.ButtonComponent(buttons).setCta().setButtonText(labels["basalt-sync"])
      .onClick(async () => {
        const choice = radio.getValue();
        if (choice === "basalt-sync") {
          if (account.token) {
            let vaults;
            try {
              vaults = await withButtonLoading(button.buttonEl, () => acctListVaults(account.token));
            } catch (err) {
              new host.Notice(syncI18n().msgErrorFailedToFetch());
              return;
            }
            if (vaults.limit !== 0) {
              if (vaults.vaults.length > 0 || vaults.shared.length > 0) self.controller.goTo(new S.RemoteVaultOptionsScreen(vaults));
              else self.controller.goTo(new S.CreateVaultScreen("basalt-sync"));
            } else {
              await acctSignupMobileSync(account.token);
              self.controller.goTo(new S.EmailVerificationScreen(account.email));
            }
          } else {
            self.controller.goTo(new S.AuthChoiceScreen());
          }
        } else if (choice === "icloud") {
          self.controller.goTo(new S.CreateVaultScreen("icloud"));
        } else {
          self.controller.goTo(new S.OtherSyncScreen());
        }
      });
    if (host.Platform.isIosApp) {
      new host.ButtonComponent(buttons).setButtonText(i18n().optLearnOtherSync())
        .onClick(() => self.controller.goTo(new S.OtherSyncScreen()));
      new host.ButtonComponent(buttons).setButtonText(i18n().optionSkipShort())
        .onClick(() => self.controller.goTo(new S.CreateVaultScreen("none")));
    }
    return self;
  }
  inherit(SyncMethodScreen, S.Base);
  SyncMethodScreen.prototype.getTitle = function () { return i18n().labelSyncMethodSelection(); };
  return (S.SyncMethodScreen = SyncMethodScreen);
}

export function defineConnectMethodScreen(host) {
  function ConnectMethodScreen() {
    const self = baseInit(this, S.Base);
    const labels = {
      local: i18n().optionConnectLocalFolder(),
      "basalt-sync": i18n().optionConnectSync(),
      icloud: i18n().optionConnectIcloud(),
      other: i18n().optionConnectOther(),
    };
    const radio = new S.RadioGroup(self.formEl);
    radio.addOption("basalt-sync", (el) => {
      el.createDiv({ cls: "mobile-onboarding-radio-option-title", text: "Basalt Sync" });
    });
    if (senv().Sm) {
      radio.addOption("local", (el) => {
        el.createDiv({ cls: "mobile-onboarding-radio-option-title", text: i18n().labelLocalFolder() });
      });
    }
    radio.addOption("icloud", (el) => {
      el.createDiv({ cls: "mobile-onboarding-radio-option-title", text: "iCloud" });
    }).addOption("other", (el) => {
      el.createDiv({ cls: "mobile-onboarding-radio-option-title", text: i18n().labelOther() });
    }).setValue("basalt-sync");
    const buttons = self.contentEl.createDiv("button-container");
    const button = new host.ButtonComponent(buttons).setCta().setButtonText(labels["basalt-sync"]);
    radio.onChange((v) => button.setButtonText(labels[v]));
    button.onClick(async () => {
      const choice = radio.getValue();
      if (choice === "local") {
        try {
          if (!storagePermsGranted()) {
            await new Promise((resolve) => self.controller.goTo(new S.StoragePermissionScreen(resolve)));
          }
          if (!storagePermsGranted()) return;
          const picked = await senv().Dm.choose();
          if (!picked || !picked.path) return;
          if (picked.isRoot) { new host.Notice("Please choose a different folder than the root folder of your device."); return; }
          if (await self.controller.isDirectory(picked.path)) self.controller.openVault(picked.path, true);
          else new host.Notice("Failed to load external vault.");
        } catch (err) { /* cancelled */ }
      } else if (choice === "basalt-sync") {
        if (account.token) {
          const vaults = await withButtonLoading(button.buttonEl, () => acctListVaults(account.token));
          if (vaults.vaults.length > 0 || vaults.shared.length > 0) self.controller.goTo(new S.RemoteVaultOptionsScreen(vaults));
          else self.controller.goTo(new S.CreateVaultScreen("basalt-sync"));
        } else {
          self.controller.goTo(new S.SignInScreen());
        }
      } else if (choice === "icloud") {
        self.controller.goTo(host.Platform.isIosApp ? new S.ICloudMissingScreen() : new S.ICloudUnsupportedScreen());
      } else {
        self.controller.goTo(new S.OtherSyncScreen());
      }
    });
    return self;
  }
  inherit(ConnectMethodScreen, S.Base);
  ConnectMethodScreen.prototype.getTitle = function () { return i18n().labelSyncRestore(); };
  return (S.ConnectMethodScreen = ConnectMethodScreen);
}

export function defineOtherSyncScreen(host) {
  function OtherSyncScreen() {
    const self = baseInit(this, S.Base);
    renderFormattedDescription(self.formEl, i18n().labelSyncOtherDesc());
    self.contentEl.createDiv("button-container", (el) => {
      new host.ButtonComponent(el).setCta().setButtonText(i18n().buttonCreate())
        .onClick((e) => { if (e) e.preventDefault(); self.controller.goTo(new S.CreateVaultScreen("none")); });
      new host.ButtonComponent(el).setButtonText(senv().gm.interface.buttonLearnMore())
        .onClick(() => window.open("https://github.com/FalconTechDev/basalt/wiki", "_blank"));
    });
    return self;
  }
  inherit(OtherSyncScreen, S.Base);
  OtherSyncScreen.prototype.getTitle = function () { return i18n().labelSyncOther(); };
  return (S.OtherSyncScreen = OtherSyncScreen);
}

export function defineEmailEntryScreen(host) {
  function EmailEntryScreen() {
    const self = baseInit(this, S.Base);
    self.notice = null;
    renderFormattedDescription(self.formEl, i18n().labelEmailEntryDesc());
    let email = "";
    const field = new S.Field(self.formEl).setName(acctI18n().labelEmail());
    field.addText((el) => {
      el.setValue(email).setPlaceholder(acctI18n().placeholderEmail())
        .onChange((v) => { email = v; })
        .then((input) => { input.inputEl.type = "email"; });
    });
    self.contentEl.createDiv("button-container", (el) => {
      new host.ButtonComponent(el).setCta().setButtonText(acctI18n().labelSignUp())
        .onClick(() => {
          if (email !== "") self.controller.goTo(new S.SignupScreen(email));
          else self.controller.showError(acctI18n().messageEmptyEmail());
        });
    });
    return self;
  }
  inherit(EmailEntryScreen, S.Base);
  EmailEntryScreen.prototype.getTitle = function () { return i18n().labelEmailEntry(); };
  return (S.EmailEntryScreen = EmailEntryScreen);
}

export function defineSignupScreen(host) {
  function SignupScreen(email) {
    if (email === undefined) email = "";
    const self = baseInit(this, S.Base);
    const form = self.formEl;
    let name = "", password = "";
    const emailField = new S.Field(form).setName(acctI18n().labelEmail());
    emailField.addText((el) => {
      el.setValue(email).setPlaceholder(acctI18n().placeholderEmail())
        .onChange((v) => { email = v; })
        .then((input) => { input.inputEl.type = "email"; });
    });
    const nameField = new S.Field(form).setName(acctI18n().labelName());
    nameField.addText((el) => { el.setValue(name).onChange((v) => { name = v; }); });
    const passField = new S.Field(form).setName(senv().gm.interface.startScreen.optionUserPassword());
    passField.addText((el) => {
      el.setValue(password).onChange((v) => { password = v; })
        .then((input) => { input.inputEl.type = "password"; });
    });
    self.contentEl.createDiv("button-container", (el) => {
      new host.ButtonComponent(el).setCta().setButtonText(acctI18n().labelSignUp())
        .onClick(async () => {
          if (email === "") return self.controller.showError(acctI18n().messageEmptyEmail());
          try {
            await acctSignup(email, password, name, "buy_sync");
            self.controller.goTo(new S.EmailVerificationScreen(email));
          } catch (err) {
            console.error(err);
            if (err instanceof AccountError) self.controller.showError(err.error);
            else self.controller.showError(acctI18n().messageSignupFailed());
          }
        });
    });
    return self;
  }
  inherit(SignupScreen, S.Base);
  SignupScreen.prototype.getTitle = function () { return i18n().labelSignup(); };
  return (S.SignupScreen = SignupScreen);
}

export function defineEmailVerificationScreen(host) {
  function EmailVerificationScreen(email) {
    const self = baseInit(this, S.Base);
    renderFormattedDescription(self.formEl, i18n().emailVerificationDesc({ email }));
    self.footerEl.createDiv("button-container", (el) => {
      const resend = new host.ButtonComponent(el).setButtonText(i18n().buttonResendEmail())
        .onClick(async () => {
          resend.setLoading(true);
          try {
            await acctResendConfirmation(email, "buy_sync");
            new host.Notice(i18n().msgNewEmailSuccess());
          } catch (err) {
            console.error(err);
            new host.Notice(i18n().msgNewEmailFailure());
          } finally {
            resend.setLoading(false);
          }
        });
      new host.ButtonComponent(el).setButtonText(i18n().buttonLogout())
        .onClick(async () => {
          try { await acctSignOut(account); self.controller.backToLogin(); }
          catch (err) { /* ignore */ }
        });
    });
    return self;
  }
  inherit(EmailVerificationScreen, S.Base);
  EmailVerificationScreen.prototype.getTitle = function () { return i18n().emailVerification(); };
  return (S.EmailVerificationScreen = EmailVerificationScreen);
}

export function defineICloudMissingScreen(host) {
  function ICloudMissingScreen() {
    const self = baseInit(this, S.Base);
    self.formEl.createEl("p", { text: i18n().icloudMissingDesc() });
    self.formEl.createEl("ol", {}, (list) => {
      list.createEl("li", { text: i18n().icloudMissingReason1() });
      list.createEl("li", { text: i18n().icloudMissingReason2() });
    });
    return self;
  }
  inherit(ICloudMissingScreen, S.Base);
  ICloudMissingScreen.prototype.getTitle = function () { return "iCloud"; };
  return (S.ICloudMissingScreen = ICloudMissingScreen);
}

export function defineStoragePermissionScreen(host) {
  function StoragePermissionScreen(callback) {
    const self = baseInit(this, S.Base);
    self.callback = callback;
    const form = self.formEl;
    form.createEl("p", { text: "Basalt needs permission to access your device storage." });
    form.createEl("p", { text: "This allows your Basalt data to be used with other apps and third-party tools." });
    form.createEl("p", { text: "All your data remains private and stored locally. No one can access your data, not even us." });
    self.footerEl.createDiv("button-container", (el) => {
      new host.ButtonComponent(el).setButtonText(i18n().allowFileAccess()).setCta()
        .onClick(async () => {
          try {
            await senv().Dm.requestPerms();
            await senv().CD();
            self.controller.back();
          } catch (err) { /* ignore */ }
        });
      new host.ButtonComponent(el).setButtonText(senv().gm.dialogue.buttonCancel())
        .onClick(() => self.controller.back());
    });
    return self;
  }
  inherit(StoragePermissionScreen, S.Base);
  StoragePermissionScreen.prototype.getTitle = function () { return i18n().allowFileAccess(); };
  StoragePermissionScreen.prototype.onClose = function () { this.callback(); };
  return (S.StoragePermissionScreen = StoragePermissionScreen);
}

export function defineICloudUnsupportedScreen(host) {
  function ICloudUnsupportedScreen() {
    const self = baseInit(this, S.Base);
    self.formEl.createEl("p", { text: i18n().iCloudUnsupportedDesc() });
    new host.ButtonComponent(self.footerEl).setButtonText(senv().gm.interface.buttonLearnMore())
      .onClick(() => window.open("https://github.com/FalconTechDev/basalt/wiki", "_blank"));
    return self;
  }
  inherit(ICloudUnsupportedScreen, S.Base);
  ICloudUnsupportedScreen.prototype.getTitle = function () { return i18n().iCloudUnsupported(); };
  return (S.ICloudUnsupportedScreen = ICloudUnsupportedScreen);
}
