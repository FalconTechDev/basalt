// g23 clean-room: keychain secrets — storage backends, service, tab, dialogs (spec g23 §3.6).
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { prepareQuery, fuzzyMatchJs } from "./search.js";
import { ng23T, ng23Moment, ng23Collator, ng23Contains } from "./n-g23-util.js";

const NG23SEC_T = (host, key, fb, arg) => ng23T(host, "setting.keychain." + key, fb, arg);
const NG23SEC_DL_T = (host, key, fb, arg) => ng23T(host, "dialogue." + key, fb, arg);
const NG23SEC_OPT_T = (host, key, fb, arg) => ng23T(host, "setting.options." + key, fb, arg);

const KEY_SECRETS = "secrets";
const KEY_ENCRYPTED = "secrets-encrypted";
const KEY_META = "secrets-meta";
const KEY_WARNED = "secrets-encryption-warning-dismissed";

function ng23Electron() {
  try { return (typeof window !== "undefined" && window.electron) || globalThis.electron || null; } catch (e) { return null; }
}
function ng23B64Encode(str) {
  try { return btoa(unescape(encodeURIComponent(str))); } catch (e) { return btoa(str); }
}
function ng23B64Decode(str) {
  try { return decodeURIComponent(escape(atob(str))); } catch (e) { return atob(str); }
}

// ===========================================================================
// Callout (orig W1): inline notice box.
// ===========================================================================

export function defineCallout(host) {
  function Callout(containerEl) {
    this.type = "";
    this.el = containerEl.createDiv("callout");
    const title = this.el.createDiv("callout-title");
    this.iconEl = title.createDiv("callout-icon");
    this.iconEl.hide();
    this.titleInnerEl = title.createDiv("callout-title-inner");
    this.contentEl = this.el.createDiv("callout-content");
  }
  const proto = Callout.prototype;
  proto.setType = function (type) { this.type = type || ""; this.el.setAttr("data-callout", this.type); return this; };
  proto.setTitle = function (title) { this.titleInnerEl.setText(title); return this; };
  proto.setContent = function (content) {
    this.contentEl.empty();
    if (typeof content === "string") this.contentEl.setText(content);
    else if (content) this.contentEl.appendChild(content);
    return this;
  };
  proto.setIcon = function (icon) {
    if (icon) { host.setIcon(this.iconEl, icon); this.iconEl.show(); }
    else this.iconEl.hide();
    return this;
  };
  proto.onClick = function () {};
  return Callout;
}

// ===========================================================================
// Storage backends (orig i0/r0/o0).
// ===========================================================================

export function defineSecretStorageBase() {
  function SecretStorageBase(app) { this.app = app; }
  const proto = SecretStorageBase.prototype;
  /** Returns the legacy plaintext map and clears the legacy key, or null. */
  proto.migrate = function () {
    const raw = this.app.loadLocalStorage(KEY_SECRETS);
    if (raw && typeof raw === "object") {
      this.app.saveLocalStorage(KEY_SECRETS, null);
      return raw;
    }
    return null;
  };
  proto.isEncryptionAvailable = function () { return true; };
  proto.getSelectedStorageBackend = function () { return "unknown"; };
  proto.encrypt = function (value) { return value; };
  proto.decrypt = function (value) { return value; };
  proto.load = function () { return {}; };
  proto.save = function () {};
  return SecretStorageBase;
}

export function defineDesktopSecretStore(host) {
  function DesktopSecretStore(app) {
    const self = host.SecretStorageBase.call(this, app) || this;
    try { self.safeStorage = ng23Electron() && ng23Electron().remote && ng23Electron().remote.safeStorage; } catch (e) { self.safeStorage = null; }
    return self;
  }
  inherit(DesktopSecretStore, host.SecretStorageBase);
  const proto = DesktopSecretStore.prototype;

  proto.isEncryptionAvailable = function () {
    try { return !!(this.safeStorage && this.safeStorage.isEncryptionAvailable()); } catch (e) { return false; }
  };
  proto.getSelectedStorageBackend = function () {
    try { return this.safeStorage ? this.safeStorage.getSelectedStorageBackend() : "unknown"; } catch (e) { return "unknown"; }
  };
  proto.encrypt = function (value) {
    if (!this.isEncryptionAvailable()) return value;
    try { return ng23B64Encode(this.safeStorage.encryptString(value)); } catch (e) { return value; }
  };
  proto.decrypt = function (value) {
    if (!this.isEncryptionAvailable()) return value;
    try { return this.safeStorage.decryptString(ng23B64Decode(value)); } catch (e) { return value; }
  };
  proto.load = function () {
    const migrated = this.migrate() || {};
    let merged = Object.assign({}, migrated);
    const raw = this.app.loadLocalStorage(KEY_ENCRYPTED);
    if (raw) {
      try {
        const text = typeof raw === "string" ? this.decrypt(raw) : this.decrypt(String(raw));
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") merged = Object.assign(merged, parsed);
      } catch (error) {
        console.error("Failed to decrypt secrets:", error);
      }
    }
    if (Object.keys(migrated).length || (raw && Object.keys(merged).length === 0)) this.save(merged);
    return merged;
  };
  proto.save = function (secrets) {
    if (!secrets || Object.keys(secrets).length === 0) {
      this.app.saveLocalStorage(KEY_ENCRYPTED, null);
      return;
    }
    this.app.saveLocalStorage(KEY_ENCRYPTED, this.encrypt(JSON.stringify(secrets)));
  };
  return DesktopSecretStore;
}

export function defineMobileSecretStore(host) {
  function MobileSecretStore(app) {
    const self = host.SecretStorageBase.call(this, app) || this;
    try { self.store = (typeof secureStoreNative !== "undefined" && secureStoreNative) || null; } catch (e) { self.store = null; }
    return self;
  }
  inherit(MobileSecretStore, host.SecretStorageBase);
  const proto = MobileSecretStore.prototype;

  proto.isEncryptionAvailable = function () { return true; };
  proto.load = function () {
    const migrated = this.migrate() || {};
    let merged = Object.assign({}, migrated);
    try {
      if (this.store) {
        const raw = this.store.get(KEY_ENCRYPTED);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") merged = Object.assign(merged, parsed);
        }
      }
    } catch (error) {
      console.error("Failed to decrypt secrets:", error);
    }
    if (Object.keys(migrated).length) this.save(merged);
    return merged;
  };
  proto.save = function (secrets) {
    if (!this.store) return;
    if (!secrets || Object.keys(secrets).length === 0) { try { this.store.remove(KEY_ENCRYPTED); } catch (e) {} return; }
    try { this.store.set(KEY_ENCRYPTED, JSON.stringify(secrets)); } catch (e) {}
  };
  return MobileSecretStore;
}

// ===========================================================================
// SecretStorage service (orig a0 -> app.secretStorage).
// ===========================================================================

export function defineSecretStorage(host) {
  function SecretStorage(app) {
    this.app = app;
    this.secrets = {};
    this.secretsMeta = {};
    this.adapter = null;
    this._saveMetaSoon = debounceCall(() => this._saveMetaNow(), 5000);
  }
  const proto = SecretStorage.prototype;

  proto.init = function () {
    this.setupStorage();
    this.load();
  };

  proto.setupStorage = function () {
    if (host.Platform.isDesktopApp) this.adapter = new host.DesktopSecretStore(this.app);
    else if (host.Platform.isMobileApp) this.adapter = new host.MobileSecretStore(this.app);
    else this.adapter = null;
  };

  proto.load = function () {
    this.secretsMeta = this.app.loadLocalStorage(KEY_META) || {};
    try {
      this.secrets = this.adapter ? (this.adapter.load() || {}) : {};
    } catch (error) {
      console.error("Failed to load secrets:", error);
      this.secrets = {};
    }
    if (!this.app.loadLocalStorage(KEY_WARNED) && Object.keys(this.secrets).length && !this.isEncryptionAvailable()) {
      try {
        const notice = new host.Notice(NG23SEC_T(host, "msgSecretsNotEncrypted", "This machine lacks a secret store, so secrets stay unencrypted."), 0);
        if (notice && notice.noticeEl) {
          const learn = notice.noticeEl.createEl("a", {
            cls: "notice-learn-more",
            text: ng23T(host, "interface.buttonLearnMore", "Learn more"),
          });
          learn.addEventListener("click", (event) => {
            event.preventDefault();
            new (defineEncryptionInfoModal(host))(this.app).open();
          });
          const dismiss = notice.noticeEl.createEl("button", {
            cls: "mod-cta",
            text: NG23SEC_T(host, "buttonDismissWarning", "Do not warn me again"),
          });
          dismiss.addEventListener("click", () => {
            this.app.saveLocalStorage(KEY_WARNED, "1");
            notice.hide();
          });
        }
      } catch (e) {}
    }
  };

  proto.isEncryptionAvailable = function () {
    if (!this.adapter) return true;
    if (this.adapter instanceof host.DesktopSecretStore) return this.adapter.isEncryptionAvailable();
    return true;
  };

  proto._saveMetaNow = function () {
    this.app.saveLocalStorage(KEY_META, this.secretsMeta);
  };

  proto.saveMeta = function () { this._saveMetaSoon(); };

  proto.recordAccess = function (id) {
    const now = Date.now();
    const meta = this.secretsMeta[id] || (this.secretsMeta[id] = {});
    const last = meta.lastAccess || 0;
    if (now - last > 300000) {
      meta.lastAccess = now;
      this.saveMeta();
    }
  };

  proto.getLastAccess = function (id) {
    const meta = this.secretsMeta[id];
    return meta && meta.lastAccess ? meta.lastAccess : null;
  };

  proto.validateId = function (id) {
    return typeof id === "string" && /^[a-z0-9-]+$/.test(id) && id.length <= 64;
  };

  proto.setSecret = function (id, value) {
    if (!this.adapter) throw new Error("Secure storage is not available.");
    if (!this.validateId(id)) throw new Error(NG23SEC_T(host, "msgErrorSecretIdInvalid", "Invalid secret ID — allowed: a-z, 0-9, dashes, up to 64 chars."));
    this.secrets[id] = value;
    this.adapter.save(this.secrets);
  };

  proto.peekSecret = function (id) {
    return Object.prototype.hasOwnProperty.call(this.secrets, id) ? this.secrets[id] : null;
  };

  proto.getSecret = function (id) {
    this.recordAccess(id);
    return this.peekSecret(id);
  };

  proto.listSecrets = function () { return Object.keys(this.secrets); };

  proto.deleteSecret = function (id) {
    if (!Object.prototype.hasOwnProperty.call(this.secrets, id)) return false;
    delete this.secrets[id];
    delete this.secretsMeta[id];
    this.adapter && this.adapter.save(this.secrets);
    this.saveMeta();
    return true;
  };

  return SecretStorage;
}

// ===========================================================================
// KeychainTab (orig K1, id "keychain").
// ===========================================================================

export function defineKeychainTab(host) {
  function KeychainTab(app, setting) {
    const self = host.SettingTab.call(this, app, setting) || this;
    self.name = NG23SEC_T(host, "name", "Keychain");
    self.id = "keychain";
    self.icon = "key-round";
    self.query = "";
    self._searchInput = null;
    self._group = null;
    return self;
  }
  inherit(KeychainTab, host.SettingTab);
  const proto = KeychainTab.prototype;

  proto._filtered = function () {
    const q = this.query.trim().toLowerCase();
    const ids = this.app.secretStorage.listSecrets().sort(ng23Collator.compare);
    if (!q) return ids;
    return ids.filter((id) => ng23Contains(id, q));
  };

  proto._renderRows = function () {
    const group = this._group;
    if (!group || !group.listEl) return;
    const storage = this.app.secretStorage;
    const ids = this._filtered();
    group.listEl.empty();
    if (ids.length === 0) {
      if (this.query.trim()) {
        group.addSetting((s) => s.setName(ng23T(host, "setting.thirdPartyPlugin.labelNoResultsFound", "Nothing found")).setClass("keychain-empty"));
      } else {
        group.addSetting((s) => {
          s.setName("").setDesc(NG23SEC_T(host, "keychainEmptyState", "Nothing stored here yet."));
          s.setClass("keychain-empty");
        });
      }
      return;
    }
    for (const id of ids) {
      group.addSetting((setting) => {
        setting.setName(id);
        const last = storage.getLastAccess(id);
        const moment = ng23Moment();
        const desc = last && moment ? moment(last).fromNow(false) : NG23SEC_T(host, "msgNeverAccessed", "Never used");
        setting.setDesc(desc);
        setting.addExtraButton((b) => {
          b.setIcon("lucide-pen-line");
          b.setTooltip(NG23SEC_T(host, "actionEditSecret", "Change secret"));
          b.onClick(() => {
            new (defineSecretEditModal(host))(this.app, id, (newId) => {
              if (newId !== id) this.display();
            }).open();
          });
        });
        setting.addExtraButton((b) => {
          b.setIcon("lucide-trash-2");
          b.setTooltip(NG23SEC_DL_T(host, "buttonDelete", "Delete"));
          b.onClick(() => {
            if (storage.deleteSecret(id)) this.display();
          });
        });
      });
    }
  };

  proto.display = function () {
    const self = this;
    const app = this.app;
    this.containerEl.empty();
    this.query = "";
    const storage = app.secretStorage;

    if (storage && !storage.isEncryptionAvailable()) {
      const callout = new host.Callout(this.containerEl);
      callout.setType("warning");
      callout.setIcon("lucide-alert-triangle");
      callout.setTitle(NG23SEC_T(host, "labelEncryptionNotAvailable", "No encryption"));
      const content = callout.contentEl.createDiv();
      content.setText(NG23SEC_T(host, "msgEncryptionProvidedByOS", "Encryption comes from your OS secret store."));
      content.createEl("a", {
        cls: "mod-secondary",
        text: ng23T(host, "interface.buttonLearnMore", "Learn more"),
        attr: { href: "#" },
      }).addEventListener("click", (event) => {
        event.preventDefault();
        new (defineEncryptionInfoModal(host))(app).open();
      });
    }

    const group = new host.SettingGroup(this.containerEl);
    this._group = group;
    group.addClass("keychain-group");
    group.addHeading(() => NG23SEC_T(host, "secrets", "Secrets"));
    group.addExtraButton((b) => {
      b.setIcon("lucide-plus");
      b.setTooltip(NG23SEC_T(host, "actionAddSecret", "New secret"));
      b.onClick(() => {
        new (defineSecretEditModal(host))(app, null, () => self.display()).open();
      });
    });
    group.listEl.addClass("secrets-list");

    const ids = storage ? storage.listSecrets() : [];
    if (ids.length) {
      group.addSearch((search) => {
        self._searchInput = search;
        search.setPlaceholder(NG23SEC_T(host, "placeholderSearchSecret", "Look up a secret..."));
        search.onChange((value) => {
          self.query = value;
          self._renderRows();
        });
      });
    }
    this._renderRows();
  };

  return KeychainTab;
}

// ===========================================================================
// EncryptionInfoModal (orig X1).
// ===========================================================================

export function defineEncryptionInfoModal(host) {
  function EncryptionInfoModal(app) {
    const self = host.ButtonModal.call(this, app) || this;
    self.modalEl.addClass("mod-lg", "mod-scrollable-content", "mod-plugin-debug");
    self.setTitle(NG23SEC_T(host, "labelEncryptionNotAvailable", "No encryption"));
    const content = self.contentEl;
    content.empty();
    content.createEl("p", { text: NG23SEC_T(host, "msgEncryptionProvidedByOS", "Encryption comes from your OS secret store.") });
    if (host.Platform.isLinux) {
      content.createEl("p", { text: NG23SEC_T(host, "msgLinuxSecretStores", "Linux users can pick from these secret stores:") });
      const ul = content.createEl("ul");
      for (const name of ["gnome-keyring", "kwallet", "kwallet5", "kwallet6"]) ul.createEl("li", { text: name });
    }
    self.addButton("mod-cancel", NG23SEC_DL_T(host, "buttonDone", "Done"), () => {});
    return self;
  }
  inherit(EncryptionInfoModal, host.ButtonModal);
  return EncryptionInfoModal;
}

// ===========================================================================
// SecretChooser (orig Q1): suggestion list of secrets with reveal/delete.
// ===========================================================================

export function defineSecretChooser(host) {
  /** SuggestionList acting as its own chooser: rows are secret ids. */
  function SecretChooser(app, containerEl, scope) {
    const self = host.SuggestionList.call(this, this, containerEl, scope) || this;
    self.app = app;
    self.value = "";
    self.suggestions = [];
    self.onChangeCallback = null;
    self.shouldSelectOnHover(false);
    return self;
  }
  inherit(SecretChooser, host.SuggestionList);
  const proto = SecretChooser.prototype;

  proto.setValue = function (value, suggestions) {
    this.value = value || "";
    this.suggestions = suggestions || [];
    this.setSuggestions(this.suggestions.slice());
  };

  proto.renderSuggestion = function (id, el) {
    el.addClass("mod-complex", "suggestion-secret-key");
    const storage = this.app.secretStorage;
    const row = el.createDiv("suggestion-content");
    const radio = row.createEl("input", { attr: { type: "radio" } });
    radio.checked = id === this.value;
    radio.disabled = true;
    radio.addEventListener("click", (event) => event.stopPropagation());
    row.createSpan({ cls: "suggestion-title", text: id });
    const aux = el.createDiv("suggestion-aux");
    const secretText = aux.createSpan("suggestion-secret-text");
    secretText.setText("•••••••");
    let revealed = false;
    const eye = aux.createDiv("clickable-icon", (icon) => {
      host.setIcon(icon, "lucide-eye");
      icon.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        revealed = !revealed;
        host.setIcon(icon, revealed ? "lucide-eye-off" : "lucide-eye");
        secretText.setText(revealed ? String(storage.peekSecret(id) || "") : "•••••••");
      });
    });
    aux.createDiv("clickable-icon", (icon) => {
      host.setIcon(icon, "lucide-trash-2");
      icon.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (storage.deleteSecret(id)) {
          this.suggestions = this.suggestions.filter((s) => s !== id);
          if (this.value === id) { this.value = ""; if (this.onChangeCallback) this.onChangeCallback(""); }
          this.setValue(this.value, this.suggestions);
        }
      });
    });
    if (id === this.value) el.createDiv("flair", (f) => f.setText(NG23SEC_DL_T(host, "labelSelected", "Selected")));
  };

  proto.selectSuggestion = function (value) {
    this.value = value;
    this.setValue(value, this.suggestions);
    if (this.onChangeCallback) this.onChangeCallback(value);
  };

  proto.onChange = function (cb) { this.onChangeCallback = cb; };

  return SecretChooser;
}

// ===========================================================================
// SecretEditModal (orig Y1).
// ===========================================================================

export function defineSecretEditModal(host) {
  function SecretEditModal(app, existingId, onSuccess) {
    const self = host.ButtonModal.call(this, app) || this;
    self.modalEl.addClass("mod-lg");
    self.existingId = existingId || null;
    self.onSuccessCallback = onSuccess || null;
    self.setTitle(existingId ? NG23SEC_T(host, "actionEditSecret", "Change secret") : NG23SEC_T(host, "actionAddSecret", "New secret"));

    const content = self.contentEl;
    content.empty();
    const form = content.createEl("form", { attr: { id: "secret-form" } });
    form.addEventListener("submit", (event) => { event.preventDefault(); self.saveSecret(); });

    const mkField = (label, desc, opts) => {
      const setting = new host.Setting(form);
      setting.setName(label).setDesc(desc);
      let input = null;
      setting.addText((text) => {
        input = text.inputEl;
        if (opts.placeholder) text.setPlaceholder(opts.placeholder);
        if (opts.type) input.setAttribute("type", opts.type);
        if (opts.autocomplete !== undefined) input.setAttribute("autocomplete", opts.autocomplete);
        if (opts.autocapitalize !== undefined) input.setAttribute("autocapitalize", opts.autocapitalize);
      });
      if (opts.extraButton) {
        setting.addExtraButton((b) => {
          b.setIcon(opts.extraButton.icon);
          b.setTooltip(opts.extraButton.tooltip);
          b.onClick(opts.extraButton.onClick);
        });
      }
      return { setting, get input() { return input; } };
    };

    const idField = mkField(
      NG23SEC_T(host, "labelSecretId", "ID"),
      NG23SEC_T(host, "optionSecretIdDescription", "Stick to lowercase a-z, digits, and dashes."),
      { placeholder: NG23SEC_T(host, "placeholderSecretId", "secret-name"), autocapitalize: "off" }
    );
    if (existingId) idField.input.value = existingId;

    let revealed = false;
    const valueField = mkField(
      NG23SEC_T(host, "labelSecretValue", "Secret"),
      NG23SEC_T(host, "optionSecretValueDescription", "Supply the secret value here."),
      {
        type: "password",
        autocomplete: "off",
        placeholder: "sk-...",
        extraButton: {
          icon: "lucide-eye",
          get tooltip() { return revealed ? NG23SEC_T(host, "actionHideSecretValue", "Conceal secret") : NG23SEC_T(host, "actionShowSecretValue", "Reveal secret"); },
          onClick: () => {
            revealed = !revealed;
            valueField.input.setAttribute("type", revealed ? "text" : "password");
          },
        },
      }
    );
    self._idField = idField;
    self._valueField = valueField;

    const footer = self.buttonContainerEl;
    footer.createEl("button", {
      cls: "mod-cta",
      text: NG23SEC_DL_T(host, "buttonSave", "Save"),
      attr: { type: "submit", form: "secret-form" },
    }).addEventListener("click", (event) => { event.preventDefault(); self.saveSecret(); });
    self.addCancelButton();
    return self;
  }
  inherit(SecretEditModal, host.ButtonModal);
  const proto = SecretEditModal.prototype;

  proto.saveSecret = function () {
    const storage = this.app.secretStorage;
    const newId = this._idField.input.value.trim();
    const value = this._valueField.input.value;
    const oldId = this.existingId;
    const fail = (message) => {
      try { host.setTooltip(this._idField.setting.nameEl, message); } catch (e) {}
      try { host.displayTooltip(this._idField.setting.nameEl, message); } catch (e) {}
    };
    if (oldId && newId !== oldId && storage.peekSecret(newId) !== null) return fail(NG23SEC_T(host, "msgErrorSecretIdExists", "That ID is taken by another secret."));
    if (!storage.validateId(newId)) return fail(NG23SEC_T(host, "msgErrorSecretIdInvalid", "Invalid secret ID."));
    if (!value) return fail(NG23SEC_T(host, "msgErrorSecretValueEmpty", "The secret value field is required."));
    try {
      if (oldId && newId !== oldId) storage.deleteSecret(oldId);
      storage.setSecret(newId, value);
    } catch (error) {
      return fail(String(error && error.message || error));
    }
    if (this.onSuccessCallback) this.onSuccessCallback(newId);
    this.close();
  };

  return SecretEditModal;
}

// ===========================================================================
// SecretPickerModal (orig $1).
// ===========================================================================

export function defineSecretPickerModal(host) {
  function SecretPickerModal(app, onSave) {
    const self = host.ButtonModal.call(this, app) || this;
    self.modalEl.addClass("mod-secret", "mod-scrollable-content", "mod-lg");
    self.onSaveCallback = onSave || null;
    self.value = "";
    self.setTitle(NG23SEC_T(host, "labelSelectSecret", "Choose a secret"));

    const content = self.contentEl;
    content.empty();
    const header = content.createDiv("modal-header-search");
    const search = new host.SearchComponent(header);
    search.setPlaceholder(NG23SEC_T(host, "placeholderSearchSecret", "Look up a secret..."));
    const listBox = content.createDiv("keychain-list-results");
    self._chooser = new (defineSecretChooser(host))(app, listBox, self.scope);
    self._search = search;
    self._listBox = listBox;

    self._refresh = function () {
      const q = (search.getValue() || "").trim();
      let ids = app.secretStorage.listSecrets();
      if (q) {
        const prepared = prepareQuery(q);
        ids = ids.filter((id) => {
          const m = fuzzyMatchJs(prepared, id);
          return !!m;
        });
      }
      ids.sort(ng23Collator.compare);
      self._chooser.setValue(self.value, ids);
    };
    search.onChange(() => self._refresh());
    self._chooser.onChange((v) => { self.value = v; });
    self._refresh();

    self.addButton("mod-secondary", NG23SEC_T(host, "buttonAddSecret", "New secret..."), () => {
      self.close();
      new (defineSecretEditModal(host))(app, null, (newId) => {
        self.value = newId;
        self.open();
        self._refresh();
      }).open();
    });
    self.addButton("mod-cta", NG23SEC_DL_T(host, "buttonSave", "Save"), () => {
      if (self.onSaveCallback) self.onSaveCallback(self.value);
      return false;
    });
    self.addCancelButton();
    return self;
  }
  inherit(SecretPickerModal, host.ButtonModal);
  return SecretPickerModal;
}

// ===========================================================================
// SecretComponent (orig Z1): setting control that links a secret id.
// ===========================================================================

export function defineSecretComponent(host) {
  function SecretComponent(containerEl) {
    const self = host.BaseComponent.call(this) || this;
    self.containerEl = containerEl.createDiv("setting-secret-component");
    self.disabled = false;
    self.settingKey = null;
    self.changeCallback = null;
    self.revealed = false;

    const warn = self.containerEl.createDiv("clickable-icon mod-warning");
    host.setIcon(warn, "lucide-alert-triangle");
    host.setTooltip(warn, NG23SEC_T(host, "msgSecretsNotEncryptedShort", "Secrets stored unencrypted"));
    warn.addEventListener("click", () => new (defineEncryptionInfoModal(host))(self._app || null).open());
    self._warnEl = warn;
    self._refreshWarning = function () {
      const app = self._app;
      const unavailable = app && app.secretStorage && !app.secretStorage.isEncryptionAvailable();
      warn.toggle(unavailable !== false ? !!unavailable : false);
    };

    self.valueEl = self.containerEl.createDiv("setting-secret-value");
    self.linkBtn = self.containerEl.createDiv("clickable-icon setting-secret-link");
    host.setIcon(self.linkBtn, "lucide-key-round");
    self.linkBtn.addEventListener("click", () => {
      if (self.disabled || !self._app) return;
      const storage = self._app.secretStorage;
      const done = (key) => { self.setValue(key); if (self.changeCallback) self.changeCallback(key); };
      if (storage && storage.listSecrets().length) {
        new (defineSecretPickerModal(host))(self._app, done).open();
      } else {
        new (defineSecretEditModal(host))(self._app, null, done).open();
      }
    });
    self._render();
    return self;
  }
  inherit(SecretComponent, host.BaseComponent);
  const proto = SecretComponent.prototype;

  proto.setApp = function (app) { this._app = app; if (this._refreshWarning) this._refreshWarning(); };

  proto.setValue = function (key) {
    this.settingKey = key || null;
    this._render();
    return this;
  };

  proto._render = function () {
    const storage = this._app && this._app.secretStorage;
    const exists = !!(this.settingKey && storage && storage.peekSecret(this.settingKey) !== null);
    this.valueEl.empty();
    if (exists) {
      const row = this.valueEl.createDiv("setting-hotkey");
      const text = row.createSpan("setting-password");
      text.setText(this.revealed ? String(storage.peekSecret(this.settingKey)) : "•••••••");
      text.addEventListener("click", () => {
        this.revealed = !this.revealed;
        text.setText(this.revealed ? String(storage.peekSecret(this.settingKey)) : "•••••••");
      });
      const clear = this.valueEl.createDiv("clickable-icon", (icon) => {
        host.setIcon(icon, "lucide-x");
        icon.addEventListener("click", () => {
          this.setValue(null);
          if (this.changeCallback) this.changeCallback(null);
        });
      });
    }
    this.linkBtn.setText(exists ? NG23SEC_DL_T(host, "buttonChange", "Change") : NG23SEC_T(host, "buttonLink", "Link..."));
    this.linkBtn.empty();
    host.setIcon(this.linkBtn, exists ? "lucide-key-round" : "lucide-key-round");
    this.linkBtn.setText(exists ? NG23SEC_DL_T(host, "buttonChange", "Change") : NG23SEC_T(host, "buttonLink", "Link..."));
  };

  proto.onChange = function (cb) { this.changeCallback = cb; };
  proto.setDisabled = function (disabled) { this.disabled = disabled; return this; };

  return SecretComponent;
}
