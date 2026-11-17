// Own Basalt implementation of the Sync core plugin's settings tab and dialogs.
//
// Covers the sync settings view (remote vault connection, device name, conflict
// handling, selective sync, vault config sync, support info), the remote vault
// list/create/migrate/share/connect/password flows, the deleted-files restore
// dialog, file history modal, sync log viewer, largest-files report and the
// excluded-folders folder suggester. Public names, DOM classes, i18n keys and
// event names match the observed behaviour of the original bundle.
//
// Inherited pieces still reached through the environment: Modal/DialogModal
// bases, Setting/SettingGroup/Button/Toggle components, the file-history tree
// item classes, platform flags and the account/vault API helpers that already
// have own equivalents are imported directly instead.

import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { account } from "./account.js";
import { acctListVaults } from "./account.js";
import { acctMigrateVault } from "./account.js";
import { acctVaultRegions } from "./account.js";
import { acctRenameVault } from "./account.js";
import { acctRemoveVaultShare } from "./account.js";
import { acctCreateVault } from "./account.js";
import { acctListSubscriptions } from "./account.js";
import { acctRequest } from "./account.js";
import { acctUserInfo } from "./account.js";
import { acctInviteVaultShare } from "./account.js";
import { acctListVaultShares } from "./account.js";
import { randomSaltHex } from "./vault-crypto.js";
import { deriveVaultKeyhash } from "./vault-crypto.js";
import { MEDIA_FEATURE_TYPES } from "./vault-crypto.js";
import { SYNCABLE_FEATURE_TYPES } from "./vault-crypto.js";
import { utf8String } from "./vault-crypto.js";
import { withButtonLoading } from "./community.js";
import { debounceCall } from "./timing.js";
import { lastSegment } from "./path.js";
import { parentPath } from "./path.js";
import { baseName } from "./path.js";
import { withoutExtension } from "./path.js";
import { withoutMd } from "./path.js";
import { extensionOf } from "./path.js";
import { formatBytes } from "./text.js";
import { copyTextToClipboard } from "./n-g11-view.js";
import { setElementTooltip } from "./tooltip.js";
import { toggleElementVisibility } from "./n-g11-view.js";
import { prepareFuzzyFinder } from "./search-simple.js";
import { renderMatches } from "./search-simple.js";
import { sortHitsByScore } from "./misc.js";

const SE = () => env();
const syncT = () => SE().gm.plugins.sync;
const pubT = () => SE().gm.plugins.publish;

/** Scroll listener that calls back when the element is scrolled near the bottom (replaces O9). */
export function s15ScrollLoadMore(el, cb) {
  el.addEventListener(
    "scroll",
    () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - el.clientHeight / 2) cb();
    },
    { passive: true },
  );
}

/** Avatar colour classes cycled by hash for sync history entries (replaces L9). */
export const s15AvatarColorClasses = [
  "mod-avatar-color-1",
  "mod-avatar-color-2",
  "mod-avatar-color-3",
  "mod-avatar-color-4",
  "mod-avatar-color-5",
  "mod-avatar-color-6",
  "mod-avatar-color-7",
  "mod-avatar-color-8",
];

/** One hour in milliseconds; groups history entries created within the same hour (replaces A9). */
export const s15SyncHourMs = 36e5;

let syncBuilt = null;

function buildSyncClasses() {
  const Modal = SE().tb;
  const DialogModal = SE().nb;
  const ItemView = SE().Yg;
  const ViewHeader = SE().R6;
  const Tree = SE().l2;
  const Scope = SE().Ng;
  const Setting = SE().zk;
  const SettingGroup = SE().qk;
  const ButtonComponent = SE().Wk;
  const ToggleComponent = SE().Gk;
  const FuzzyMatcher = SE().BH;
  const FolderSuggestBase = SE().V7;
  const SettingsViewBase = SE().Y0;
  const FileViewBase = SE().$9 && null; // placeholder, $9 is a tree item not a base
  void FileViewBase;

  // -- P9: sync settings tab -----------------------------------------------
  function SyncSettingsView(app, container, sync) {
    const self = SettingsViewBase.call(this, app, container) || this;
    self.vaults = [];
    self.icon = "refresh-cw";
    self.sync = sync;
    return self;
  }
  inherit(SyncSettingsView, SettingsViewBase);

  SyncSettingsView.prototype.display = async function () {
    const self = this;
    const app = this.app;
    const sync = this.sync;
    const containerEl = this.containerEl;
    containerEl.empty();
    if (!SE().Yl.supportsIndexedDb) {
      new SettingGroup(containerEl).addSetting((setting) =>
        setting
          .setName(SE().gm.interface.msgIndexedDbNotSupported())
          .setDesc(SE().gm.interface.msgIndexedDbIOS()),
      );
      return;
    }
    if (!sync.initialized) {
      this.displayInitializing();
      return;
    }
    const remoteVaultId = sync.getRemoteVaultId();
    const remoteVaultName = sync.getRemoteVaultName();
    if (!account.token) {
      this.displayRequireLogin();
      return;
    }

    // Third-party / iCloud Drive warnings based on the vault adapter location.
    let warningService = "";
    const adapter = app.vault.adapter;
    if (adapter instanceof SE().Eu) {
      const base = adapter.getBasePath().toLowerCase();
      if (base.contains("dropbox")) warningService = "Dropbox";
      else if (base.contains("com~apple~clouddocs") || base.contains("icloud~")) warningService = "iCloud";
      else if (base.contains("onedrive")) warningService = "OneDrive";
    } else if (adapter instanceof SE().vk && adapter.fs.dir === "ICLOUD") {
      warningService = "iCloud";
    }
    if (warningService) {
      new SettingGroup(containerEl).addSetting((setting) =>
        setting
          .setName(syncT().labelThirdPartySyncWarning())
          .setDesc(
            createFragment((frag) => {
              frag.createSpan({ cls: "mod-warning", text: syncT().labelThirdPartySyncWarningDesc({ service: warningService }) });
              frag.createEl("br");
              frag.createEl("a", {
                href: "https://github.com/FalconTechDev/basalt/wiki",
                text: SE().gm.interface.buttonLearnMore(),
                attr: { target: "_blank" },
              });
            }),
          ),
      );
    } else if (SE().Yl.isMacOS && adapter instanceof SE().Eu) {
      const base = adapter.getBasePath().toLowerCase();
      const docsDir = window.electron.ipcRenderer.sendSync("documents-dir");
      const desktopDir = window.electron.ipcRenderer.sendSync("desktop-dir");
      if (base.startsWith(docsDir.toLowerCase()) || base.startsWith(desktopDir.toLowerCase())) {
        new SettingGroup(containerEl).addSetting((setting) =>
          setting.setDesc(
            createFragment((frag) => {
              frag.createSpan({ text: syncT().labelIcloudDriveWarning() });
              frag.createEl("br");
              frag.createEl("a", {
                href: "https://github.com/FalconTechDev/basalt/wiki",
                text: SE().gm.interface.buttonLearnMore(),
                attr: { target: "_blank" },
              });
            }),
          ),
        );
      }
    }

    if (!remoteVaultId && !account.token) {
      const loader = SE().fD(containerEl);
      try {
        await acctUserInfo(account);
        this.display();
      } catch (err) {
        loader.hide();
        if (err.message === "Not logged in") {
          this.displayRequireLogin();
        } else {
          containerEl
            .createEl("p", { text: SE().gm.plugins.publish.msgNetworkError() })
            .createDiv("modal-button-container", (div) => {
              div.createEl("button", { cls: "mod-cta", text: syncT().buttonRetry() }, (btn) => {
                btn.addEventListener("click", () => self.display());
              });
            });
        }
      }
      return;
    }

    let remoteSetting;
    const firstGroup = new SettingGroup(containerEl);
    firstGroup.addSetting((setting) => {
      remoteSetting = setting;
      return setting.setName(syncT().optionRemoteVault());
    });
    if (remoteVaultName) {
      remoteSetting.setDesc(syncT().optionRemoteVaultDescConnected({ name: remoteVaultName }));
      remoteSetting.addButton((btn) =>
        btn
          .setButtonText(syncT().buttonDisconnectFromRemoteVault())
          .setClass("mod-destructive")
          .onClick(async () => {
            await sync.unsetup();
            await this.display();
          }),
      );
    } else {
      remoteSetting.setDesc(syncT().optionRemoteVaultDescNotConnected());
    }
    remoteSetting.addButton((btn) =>
      btn
        .setButtonText(syncT()(remoteVaultId ? "button-manage-remote-vault" : "button-choose-remote-vault"))
        .onClick(() => sync.openChooseRemoteVaultModal()),
    );

    if (remoteVaultId) {
      if (sync.getPause()) {
        firstGroup.addSetting((setting) =>
          setting
            .setName(syncT().optionSyncStatus())
            .setDesc(syncT().optionSyncStatusDescPaused())
            .addButton((btn) =>
              btn
                .setButtonText(syncT().buttonResume())
                .setCta()
                .onClick(() => {
                  sync.setPause(false);
                  sync.requestSync();
                  this.display();
                }),
            ),
        );
      } else {
        firstGroup.addSetting((setting) =>
          setting
            .setName(syncT().optionSyncStatus())
            .setDesc(syncT().optionSyncStatusDescRunning())
            .addButton((btn) =>
              btn
                .setButtonText(syncT().buttonPause())
                .onClick(() => {
                  sync.setPause(true);
                  this.display();
                }),
            ),
        );
      }
      if (sync.encryptionVersion !== -1 && sync.encryptionVersion < 3) {
        firstGroup.addSetting((setting) =>
          setting
            .setName(syncT().labelUpgradeVaultEncryption())
            .setDesc(syncT().labelUpgradeVaultEncryptionDesc())
            .addButton((btn) =>
              btn
                .setButtonText(syncT().labelUpgradeVault())
                .onClick(() => {
                  new UpgradeEncryptionModal(this.app, sync).open();
                }),
            ),
        );
      }
      firstGroup.addSetting((setting) =>
        setting
          .setName(syncT().optionDeviceName())
          .setDesc(syncT().optionDeviceNameDesc())
          .addText((text) =>
            text
              .setPlaceholder(sync.getDefaultDeviceName())
              .setValue(sync.deviceName)
              .onChange((value) => {
                sync.deviceName = value;
                sync.forceSaveData();
              }),
          ),
      );
      firstGroup.addSetting((setting) =>
        setting
          .setName(syncT().labelResolveConflicts())
          .setDesc(syncT().labelResolveConflictsDesc())
          .addDropdown((dropdown) =>
            dropdown
              .addOption("merge", syncT().optionAutomaticMerge())
              .addOption("conflict", syncT().optionConflictFile())
              .setValue(sync.conflictAction)
              .onChange((value) => {
                if (value === sync.conflictAction || (value !== "merge" && value !== "conflict")) return;
                sync.conflictAction = value;
                sync.forceSaveData();
              }),
          ),
      );
      firstGroup.addSetting((setting) =>
        setting
          .setName(syncT().optionViewDeletedFiles())
          .setDesc(syncT().optionViewDeletedFilesDesc())
          .addButton((btn) =>
            btn
              .setButtonText(syncT().buttonView())
              .onClick(() => sync.showDeletedFiles()),
          )
          .addButton((btn) =>
            btn
              .setButtonText(syncT().buttonBulkRestore())
              .onClick(() => sync.showDeletedFiles(true)),
          ),
      );
      firstGroup.addSetting((setting) =>
        setting
          .setName(syncT().optionSyncLog())
          .setDesc(syncT().optionSyncLogDesc())
          .addButton((btn) =>
            btn
              .setButtonText(syncT().buttonView())
              .onClick(() => sync.showSyncLog()),
          ),
      );

      let sizeSetting;
      let overSizeSetting;
      let progressBar;
      const refreshSize = async () => {
        const info = await sync.size();
        const total = info.size;
        const overLimit = total > info.limit;
        const almostOver = total > 0.95 * info.limit;
        const sizeText = total < 0 ? "Unknown" : formatBytes(total);
        const limitText = info.limit < 0 ? "Unknown" : formatBytes(info.limit);
        const desc =
          limitText === "Unknown" && sizeText === "Unknown"
            ? syncT().optionVaultSizeUnknown()
            : syncT().optionVaultSizeDesc({ size: sizeText, limit: limitText });
        if (almostOver && !overLimit) overSizeSetting.setName(syncT().optionAlmostOverSize());
        overSizeSetting.setDesc(desc);
        sizeSetting.setDesc(desc);
        overSizeSetting.setVisibility(almostOver);
        sizeSetting.setVisibility(!almostOver);
        if (!almostOver) {
          const pct = Math.max(1, (total / info.limit) * 100);
          progressBar.setValue(pct);
        }
      };
      firstGroup.addSetting((setting) => {
        sizeSetting = setting;
        return setting
          .setName(syncT().optionVaultSize())
          .setDesc(syncT().optionVaultSizeLoading())
          .addProgressBar((bar) => {
            progressBar = bar;
          });
      });
      firstGroup.addSetting((setting) => {
        overSizeSetting = setting;
        return setting
          .setName(syncT().optionOverSize())
          .setDesc(syncT().optionVaultSizeLoading())
          .addButton((btn) =>
            btn
              .setButtonText(syncT().buttonUpgradeStorage())
              .onClick(() => window.open("https://github.com/FalconTechDev/basalt")),
          )
          .addButton((btn) =>
            btn
              .setButtonText(syncT().msgLargestFiles())
              .onClick(() => {
                new LargestFilesModal(this.app, sync).open();
              }),
          )
          .addButton((btn) =>
            btn
              .setWarning()
              .setButtonText(syncT().buttonPurgeRemote())
              .setTooltip(syncT().tooltipPurgeRemote())
              .onClick(async () => {
                await sync.purge();
                new (SE().fb)(syncT().msgPurgeComplete());
                await refreshSize();
              }),
          );
      });
      overSizeSetting.settingEl.hide();
      refreshSize();

      if (SE().Yl.isMobileApp) {
        firstGroup.addSetting((setting) =>
          setting
            .setName(syncT().optionPreventSleep())
            .setDesc(syncT().optionPreventSleepDesc())
            .addToggle((toggle) =>
              toggle
                .setValue(sync.preventSleep)
                .onChange((value) => {
                  sync.preventSleep = value;
                  sync.forceSaveData();
                }),
            ),
        );
      }
      firstGroup.addSetting((setting) =>
        setting
          .setName(syncT().optionContactSupport())
          .setDesc(syncT().optionContactSupportDesc())
          .addButton((btn) =>
            btn
              .setButtonText(syncT().buttonCopyDebug())
              .onClick(async () => {
                const info = await this.gatherSyncSystemInfo();
                await navigator.clipboard.writeText(info);
                new (SE().fb)(SE().gm.interface.copied_generic());
              }),
          )
          .addButton((btn) =>
            btn
              .setButtonText(syncT().buttonEmailSupport())
              .onClick(async () => {
                const info = await this.gatherSyncSystemInfo();
                const encoded = encodeURIComponent(info);
                window.open("https://github.com/FalconTechDev/basalt/issues");
              }),
          ),
      );

      const selectiveGroup = new SettingGroup(containerEl).setHeading(syncT().optionSelectiveSync());
      selectiveGroup.addSetting((setting) =>
        setting
          .setName(syncT().optionExcludedFolders())
          .setDesc(
            createFragment((frag) => {
              frag.appendText(syncT().optionExcludedFolderDesc());
              const ignored = sync.ignoreFolders;
              if (ignored.length > 0) {
                frag.appendText(syncT().optionCurrentlyExcludedFolders());
                const list = frag.createEl("ul");
                for (const folder of ignored) list.createEl("li", { text: folder });
              }
            }),
          )
          .addButton((btn) =>
            btn
              .setButtonText(syncT().buttonManageExcludedFolders())
              .onClick(() => this.manageExclusions()),
          ),
      );

      const addTypeSetting = (key, options) => {
        let extraButton = null;
        selectiveGroup.addSetting((setting) =>
          setting
            .setName(SE().gm(`plugins.sync.option-sync-${key}`))
            .setDesc(SE().gm(`plugins.sync.option-sync-${key}-desc`, options))
            .addExtraButton((btn) =>
              btn
                .setIcon("lucide-alert-circle")
                .setTooltip(syncT().tooltipUpdateSettingOnAllDevices())
                .then((comp) => {
                  extraButton = comp;
                  comp.extraSettingsEl.hide();
                }),
            )
            .addToggle((toggle) =>
              toggle
                .setValue(sync.allowTypes.has(key))
                .onChange((value) => {
                  sync.setSyncType(key, value);
                  extraButton.extraSettingsEl.show();
                }),
            ),
        );
      };
      addTypeSetting("image", { extensions: SE().Vy.join(", ") });
      addTypeSetting("audio", { extensions: SE().Hy.join(", ") });
      addTypeSetting("video", { extensions: SE().zy.join(", ") });
      addTypeSetting("pdf");
      addTypeSetting("unsupported");

      const configGroup = new SettingGroup(containerEl).setHeading(syncT().optionVaultConfigSync());
      configGroup.addSetting((setting) =>
        setting
          .setName(syncT().optionViewConfigFiles())
          .setDesc(syncT().optionViewConfigFilesDesc())
          .addButton((btn) =>
            btn
              .setButtonText(syncT().buttonView())
              .onClick(() => sync.showConfigFiles()),
          ),
      );
      const addSpecialSetting = (key) => {
        let extraButton = null;
        configGroup.addSetting((setting) =>
          setting
            .setName(SE().gm(`plugins.sync.option-sync-${key}`))
            .setDesc(SE().gm(`plugins.sync.option-sync-${key}-desc`))
            .addExtraButton((btn) =>
              btn
                .setIcon("lucide-alert-circle")
                .setTooltip(syncT().tooltipUpdateSettingOnAllDevices())
                .then((comp) => {
                  extraButton = comp;
                  comp.extraSettingsEl.hide();
                }),
            )
            .addToggle((toggle) =>
              toggle
                .setValue(sync.allowSpecialFiles.has(key))
                .onChange((value) => {
                  sync.setAllowSpecialFile(key, value);
                  extraButton.extraSettingsEl.show();
                }),
            ),
        );
      };
      for (const key of ["app", "appearance", "appearance-data", "hotkey", "core-plugin", "core-plugin-data", "community-plugin", "community-plugin-data"]) {
        addSpecialSetting(key);
      }
    }
  };

  SyncSettingsView.prototype.manageExclusions = function () {
    new ExcludedFoldersSuggest(this.app, this.sync, this).open();
  };

  SyncSettingsView.prototype.displayInitializing = function () {
    const containerEl = this.containerEl;
    containerEl.createEl("p", { text: syncT().labelSyncLoading() });
    containerEl.createDiv("modal-button-container", (div) => {
      div.createEl("button", { text: "Refresh" }, (btn) => {
        btn.addEventListener("click", () => this.display());
      });
    });
  };

  SyncSettingsView.prototype.displayRequireLogin = function () {
    const containerEl = this.containerEl;
    containerEl.createEl("p", { text: syncT().labelSyncIntroduction() });
    containerEl.createEl("p", { text: syncT().labelAccountRequired() });
    containerEl.createDiv("modal-button-container", (div) => {
      div.createEl("button", { cls: "mod-cta", text: syncT().buttonSignUp() }, (btn) => {
        btn.addEventListener("click", () => {
          if (SE().Yl.isIosApp && SE().Tm) SE().Tm.open({ url: "https://github.com/FalconTechDev/basalt" });
          else window.open("https://github.com/FalconTechDev/basalt");
        });
      });
      div.createEl("button", { text: syncT().buttonLogIn() }, (btn) => {
        btn.addEventListener("click", () => {
          new (SE().R7)(this.app).setCloseCallback(() => this.display()).open();
        });
      });
    });
  };

  SyncSettingsView.prototype.gatherSyncSystemInfo = async function () {
    const app = this.app;
    const sync = this.sync;
    let info = await SE().oD();
    const adapter = app.vault.adapter;
    let vaultPath = "";
    if (adapter instanceof SE().Eu) vaultPath = adapter.getBasePath();
    else if (adapter instanceof SE().vk && adapter.fs.dir === "ICLOUD") vaultPath = "iCloud";
    const lines = [
      "SYNC INFO:",
      `\tVault ID: ${sync.getRemoteVaultId()}`,
      `\tHost server: ${sync.getHost()}`,
      `\tDevice name: ${sync.deviceName}`,
      `\tEncryption version: ${sync.encryptionVersion}`,
      `\tAllowed file types: ${Array.from(sync.allowTypes).join(", ")}`,
      `\tAllowed special types: ${Array.from(sync.allowSpecialFiles).join(", ")}`,
      `\tIgnored directories:${sync.ignoreFolders.map((f) => `\n\t\t- ${f}`).join("")}`,
    ];
    if (vaultPath !== "") lines.push(`\tVault path: ${vaultPath}`);
    if (SE().Yl.isMobile) lines.push(`\tPrevent sleep: ${sync.preventSleep}`);
    if (app.plugins.isEnabled()) {
      const manifests = app.plugins.manifests;
      const plugins = app.plugins.plugins;
      lines.push(`\tPlugins: (${Object.keys(plugins).length} enabled/${Object.keys(manifests).length} installed)`);
      let i = 1;
      for (const id in plugins) {
        if (!plugins.hasOwnProperty(id)) continue;
        lines.push(`\t\t${i}: ${plugins[id].manifest.name} v${plugins[id].manifest.version}`);
        i++;
      }
    }
    lines.push("\tSync logs:");
    lines.push(
      ...sync.syncLog
        .slice(-20)
        .map((entry) => `\t\t${entry.ts} ${entry.error ? "Error" : "Info "} ${entry.info}${entry.file ? " - " + entry.file : ""}`),
    );
    info += lines.join("\n");
    return info;
  };

  // -- P9 helpers used by the settings tab ----------------------------------

  // -- F9: file history list -----------------------------------------------
  function FileHistoryModal(app, plugin, title, history) {
    const self = Modal.call(this, app) || this;
    self.plugin = null;
    self.history = [];
    self.offset = 0;
    self.plugin = plugin;
    self.history = history.filter((entry) => !entry.folder);
    self.setTitle(title);
    self.modalEl.addClass("mod-lg");
    const contentEl = self.contentEl;
    const header = contentEl.createDiv({ cls: "sync-modal-header" });
    header.createEl("p", { cls: "u-faded-text", text: SE().gm.nouns.fileWithCount({ count: self.history.length }) });
    header.createEl("p", { text: syncT().labelClickToSeeHistory() });
    self.historyListEl = contentEl.createDiv("sync-file-tree-container");
    s15ScrollLoadMore(self.historyListEl, () => self.loadMore());
    return self;
  }
  inherit(FileHistoryModal, Modal);
  FileHistoryModal.prototype.onOpen = function () {
    this.loadMore();
  };
  FileHistoryModal.prototype.loadMore = function () {
    const history = this.history;
    if (this.offset >= history.length) return;
    const end = Math.min(this.offset + 30, history.length);
    const self = this;
    for (; this.offset < end; ) {
      const entry = history[this.offset];
      this.offset++;
      const item = this.historyListEl.createDiv("list-item mod-selectable tappable");
      item.createDiv("list-item-part mod-extended", (div) => {
        div.createDiv({ text: withoutMd(entry.path) });
        let when = window.moment(entry.ts).fromNow();
        if (entry.device) when = `[${entry.device}] ` + when;
        div.createDiv({ cls: "u-muted u-small list-item-part", text: when });
      });
      item.addEventListener("click", () => self.plugin.showVersionHistory(entry.path));
    }
  };

  // -- N9: deleted files restore ---------------------------------------------
  function DeletedFilesModal(app, plugin, history) {
    const self = DialogModal.call(this, app) || this;
    self.plugin = null;
    self.history = [];
    self.lastSelectedItem = 0;
    self.offset = 0;
    self.checkboxes = [];
    self.modalEl.addClass("mod-lg");
    self.plugin = plugin;
    self.history = history.filter((entry) => !entry.folder);
    self.setTitle(syncT().labelDeletedFiles());
    self.modalEl.addClass("mod-scrollable-content");
    self.contentEl
      .createDiv({ cls: "sync-modal-header" })
      .createEl("p", { cls: "u-faded-text", text: SE().gm.nouns.fileWithCount({ count: self.history.length }) });
    self.historyListEl = self.contentEl.createDiv("sync-file-tree-container");
    s15ScrollLoadMore(self.historyListEl, () => self.loadMore());
    self.restoreButtonEl = self.buttonContainerEl.createEl("button", {
      cls: "mod-cta",
      text: syncT().buttonRestoreFiles({ count: 0 }),
    });
    self.restoreButtonEl.ariaDisabled = String(true);
    self.restoreButtonEl.addEventListener("click", async () => {
      const selected = this.checkboxes
        .filter((box) => box.checkboxEl.checked)
        .map((box) => box.historyItem);
      const progress = new (SE().fb)(syncT().msgRestoring() + ` (0/${selected.length})`, 0);
      let succeeded = 0;
      let done = 0;
      for (const item of selected) {
        try {
          const versions = await this.plugin.getHistory(item.path, null);
          const items = versions.items;
          for (const version of items) {
            if (version.deleted) continue;
            await this.plugin.restoreVersion(version.uid);
            succeeded++;
            break;
          }
        } catch (err) {
          console.error(err);
        }
        done++;
        progress.setMessage(syncT().msgRestoring() + ` (${done}/${selected.length})`);
      }
      setTimeout(() => progress.hide(), 4000);
      new (SE().fb)(syncT().msgRestoringComplete({ succeeded, failed: selected.length - succeeded }));
    });
    this.addCancelButton();
    return self;
  }
  inherit(DeletedFilesModal, DialogModal);
  DeletedFilesModal.prototype.onOpen = function () {
    this.loadMore();
  };
  DeletedFilesModal.prototype.loadMore = function () {
    const history = this.history;
    if (this.offset >= history.length) return;
    const end = Math.min(this.offset + 30, history.length);
    const self = this;
    for (; this.offset < end; ) {
      const entry = history[this.offset];
      this.offset++;
      const item = this.historyListEl.createDiv("list-item mod-selectable tappable");
      const checkbox = item.createEl("input", { type: "checkbox" });
      const box = { checkboxEl: checkbox, historyItem: entry };
      this.checkboxes.push(box);
      item.createDiv({ cls: "list-item-part mod-extended" }, (div) => {
        div.createDiv({ text: withoutMd(entry.path) });
        let when = window.moment(entry.ts).fromNow();
        if (entry.device) when = `[${entry.device}] ` + when;
        div.createDiv({ cls: "u-muted u-small list-item-part", text: when });
      });
      item.addEventListener("click", (event) => {
        const index = self.checkboxes.indexOf(box);
        const checked = event.target === checkbox ? checkbox.checked : !checkbox.checked;
        if (event.shiftKey) {
          const from = Math.min(self.lastSelectedItem, index);
          const to = Math.max(self.lastSelectedItem, index);
          for (let i = from; i <= to; i++) self.checkboxes[i].checkboxEl.checked = checked;
        }
        self.lastSelectedItem = index;
        if (event.target !== checkbox) checkbox.checked = checked;
        setTimeout(() => {
          const count = self.checkboxes.filter((b) => b.checkboxEl.checked).length;
          self.restoreButtonEl.setText(syncT().buttonRestoreFiles({ count }));
          self.restoreButtonEl.ariaDisabled = String(count === 0);
        }, 5);
      });
    }
  };

  // -- R9: upgrade encryption confirmation ------------------------------------
  function UpgradeEncryptionModal(app, plugin) {
    const self = DialogModal.call(this, app) || this;
    self.plugin = plugin;
    self.setTitle(syncT().labelUpgradeVaultEncryption());
    const contentEl = self.contentEl;
    contentEl.createEl("p", { text: syncT().msgMigratePreConfirmationPart1() });
    contentEl.createEl("p", { text: syncT().msgMigratePreConfirmationPart2() });
    contentEl.createEl("p", { text: syncT().msgMigratePreConfirmationPart3() });
    self.buttonContainerEl.createEl("a", {
      cls: "mod-secondary",
      text: SE().gm.interface.buttonLearnMore(),
      attr: { href: "https://github.com/FalconTechDev/basalt/wiki", target: "_blank", rel: "noopener" },
    });
    self.addButton("mod-cta", SE().gm.dialogue.buttonContinue(), () => {
      new MigrateVaultModal(self.app, self.plugin).open();
    });
    self.addCancelButton();
    return self;
  }
  inherit(UpgradeEncryptionModal, DialogModal);

  // -- B9: migrate vault to new host/region/encryption -------------------------
  function MigrateVaultModal(app, plugin) {
    const self = DialogModal.call(this, app) || this;
    self.plugin = null;
    self.settingTab = null;
    self.region = "";
    self.useOwnPassword = true;
    self.password = "";
    self.plugin = plugin;
    self.modalEl.addClass("mod-lg");
    self.settingTab = plugin.settingTab;
    self.setTitle(syncT().labelRemoteVaultConfiguration());
    self.loaderEl = SE().fD(self.contentEl);
    self.loaderEl.hide();
    self.migrateVaultEl = self.contentEl.createDiv();
    self.migrateVaultEl.createDiv("message-container", (div) => {
      self.errorEl = div.createDiv("message mod-error");
      self.errorEl.hide();
    });
    self.confirmationEl = self.contentEl.createDiv();
    return self;
  }
  inherit(MigrateVaultModal, DialogModal);

  MigrateVaultModal.prototype.onOpen = async function () {
    this.startLoading();
    const migrateEl = this.migrateVaultEl;
    let canMigrate = true;
    const vaults = await acctListVaults(account.token);
    for (const vault of vaults.vaults) {
      if (vault.id === this.plugin.getRemoteVaultId()) {
        canMigrate = false;
        this.useOwnPassword = !vault.password;
      }
    }
    if (!canMigrate) {
      migrateEl.createEl("p", { text: "This is a shared vault and may only be migrated by the owner." });
      this.stopLoading();
      return;
    }
    this.addButton("mod-cta", SE().gm.dialogue.buttonContinue(), this.showConfirmationModal.bind(this));
    this.addCancelButton();
    const sizeInfo = await this.plugin.size();
    if (sizeInfo && sizeInfo.vault_size) this.vaultSize = sizeInfo.vault_size;
    const host = this.plugin.getHost().replace(/^wss?:\/\//, "");
    const regions = await acctVaultRegions(account.token, host);
    let regionDropdown = null;
    new Setting(migrateEl)
      .setName(syncT().optionVaultRegion())
      .setDesc(syncT().optionVaultRegionDesc())
      .addDropdown((dropdown) => {
        regionDropdown = dropdown;
        dropdown.addOption("", syncT().optVaultRegionAutomatic());
        regions.forEach((region) => dropdown.addOption(region.value, region.name));
        dropdown.setValue("existing").onChange((value) => {
          this.region = value;
        });
      });
    let passwordSetting = null;
    new Setting(migrateEl)
      .setName(syncT().optionEncryption())
      .setDesc(
        createFragment((frag) => {
          frag.createDiv({ text: syncT().optionEncryptionDesc() });
          frag.createDiv({ cls: "mod-warning", text: syncT().optionEncryptionWarning() });
        }),
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ "end-to-end": syncT().optionEncryptionEndToEnd(), standard: syncT().optionEncryptionStandard() })
          .setValue(this.useOwnPassword ? "end-to-end" : "standard")
          .onChange((value) => {
            const own = value === "end-to-end";
            passwordSetting.settingEl.toggle(own);
            this.useOwnPassword = own;
          }),
      );
    passwordSetting = new Setting(migrateEl)
      .setName(syncT().optionEncryptionPassword())
      .setDesc(
        createFragment((frag) => {
          frag.createDiv({ text: syncT().optionEncryptionPasswordDesc() });
          frag.createDiv({ cls: "mod-warning", text: syncT().optionEncryptionPasswordDescWarning() });
          frag.createDiv({ text: syncT().optionEncryptionPasswordDesc_2() });
        }),
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder(syncT().optionEncryptionPasswordPlaceholder())
          .onChange((value) => (this.password = value));
      });
    passwordSetting.settingEl.toggle(this.useOwnPassword);
    this.stopLoading();
  };

  MigrateVaultModal.prototype.showConfirmationModal = function () {
    const useOwn = this.useOwnPassword;
    const password = this.password;
    const errorEl = this.errorEl;
    const confirmationEl = this.confirmationEl;
    errorEl.hide();
    let error = "";
    if (useOwn === true && password === "") error = syncT().msgPleaseEnterPassword();
    if (error) {
      errorEl.setText(error);
      errorEl.show();
      return true;
    }
    this.setTitle(syncT().labelConfirmMigrate());
    this.migrateVaultEl.hide();
    confirmationEl.empty();
    confirmationEl.createEl("p", { text: syncT().msgMigrateConfirmation() });
    confirmationEl.createEl("p", { text: syncT().msgProceedPrompt() });
    this.buttonContainerEl.empty();
    this.addButton("mod-cta", syncT().buttonMigrate(), this.onBeginMigration.bind(this));
    this.addCancelButton();
    confirmationEl.show();
    return true;
  };

  MigrateVaultModal.prototype.onBeginMigration = async function () {
    this.startLoading();
    const region = this.region;
    const useOwn = this.useOwnPassword;
    let password = this.password;
    const errorEl = this.errorEl;
    let keyhash = null;
    let salt = null;
    try {
      if (useOwn) {
        salt = randomSaltHex();
        keyhash = await deriveVaultKeyhash(password, salt, 3);
      }
      const vaultId = this.plugin.getRemoteVaultId();
      const result = await acctMigrateVault(account.token, vaultId, keyhash, salt, region, 3);
      const id = result.id;
      const name = result.name;
      const host = result.host;
      const encVersion = result.encryption_version;
      if (!useOwn) {
        password = result.password;
        salt = result.salt;
      }
      const deviceName = this.plugin.deviceName;
      const allowTypes = this.plugin.allowTypes;
      const allowSpecial = this.plugin.allowSpecialFiles;
      const ignoreFolders = this.plugin.ignoreFolders;
      await this.plugin.unsetup();
      await this.plugin.setup(id, name, password, salt, host, encVersion);
      this.plugin.setPause(true);
      MEDIA_FEATURE_TYPES.forEach((type) => this.plugin.allowTypes.delete(type));
      SYNCABLE_FEATURE_TYPES.forEach((type) => this.plugin.allowSpecialFiles.delete(type));
      this.plugin.deviceName = deviceName;
      allowTypes.forEach((type) => this.plugin.allowTypes.add(type));
      allowSpecial.forEach((type) => this.plugin.allowSpecialFiles.add(type));
      this.plugin.ignoreFolders = ignoreFolders;
      this.plugin.forceSaveData();
      const sub = this.plugin.on("status-change", () => {
        if (this.plugin.getStatus() === "synced") {
          this.plugin.offref(sub);
          new (SE().fb)(syncT().msgVaultMigrationCompleted());
        }
      });
      this.plugin.setPause(false);
      this.close();
      new (SE().fb)(syncT().msgVaultMigrationStarted());
    } catch (err) {
      errorEl.setText(err.message);
      errorEl.show();
      this.setTitle(syncT().labelMigrateRemoteVault());
      this.buttonContainerEl.empty();
      this.addButton("mod-cta", SE().gm.dialogue.buttonContinue(), this.showConfirmationModal.bind(this));
      this.addCancelButton();
      return true;
    } finally {
      this.stopLoading();
    }
    return true;
  };

  MigrateVaultModal.prototype.startLoading = function () {
    this.migrateVaultEl.hide();
    this.confirmationEl.hide();
    this.loaderEl.show();
  };
  MigrateVaultModal.prototype.stopLoading = function () {
    this.migrateVaultEl.show();
    this.loaderEl.hide();
  };
  MigrateVaultModal.prototype.onClose = function () {
    DialogModal.prototype.onClose.call(this);
    this.settingTab.display();
  };

  // -- V9: create remote vault -------------------------------------------------
  function CreateVaultModal(app, plugin) {
    const self = DialogModal.call(this, app) || this;
    self.plugin = null;
    self.vaultName = "";
    self.region = "";
    self.useOwnPassword = true;
    self.key = "";
    self.createVaultEl = null;
    self.errorEl = null;
    self.plugin = plugin;
    self.modalEl.addClass("mod-lg");
    self.setTitle(syncT().labelCreateRemoteVault());
    self.contentEl.createDiv("message-container", (div) => {
      self.errorEl = div.createDiv("message mod-error");
      self.errorEl.hide();
    });
    self.contentEl.createEl("p", { text: syncT().labelRemoteVaultExplanation() });
    new Setting(self.contentEl)
      .setName(syncT().optionVaultName())
      .setDesc(syncT().optionVaultNameDesc())
      .addText((text) =>
        text
          .setPlaceholder(syncT().optionVaultNamePlaceholder())
          .onChange((value) => (self.vaultName = value)),
      );
    new Setting(self.contentEl)
      .setName(syncT().optionVaultRegion())
      .setDesc(syncT().optionVaultRegionDesc())
      .addDropdown((dropdown) => {
        self.regionSettingDropdown = dropdown;
        dropdown.addOption("", "Automatic").setValue("").onChange((value) => {
          self.region = value;
        });
      });
    let passwordSetting = null;
    new Setting(self.contentEl)
      .setName(syncT().optionEncryption())
      .setDesc(
        createFragment((frag) => {
          frag.createDiv({ text: syncT().optionEncryptionDesc() });
          frag.createDiv({ cls: "mod-warning", text: syncT().optionEncryptionWarning() });
        }),
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ "end-to-end": syncT().optionEncryptionEndToEnd(), standard: syncT().optionEncryptionStandard() })
          .setValue("end-to-end")
          .onChange((value) => {
            const own = value === "end-to-end";
            passwordSetting.settingEl.toggle(own);
            self.useOwnPassword = own;
          }),
      );
    passwordSetting = new Setting(self.contentEl)
      .setName(syncT().optionEncryptionPassword())
      .setDesc(
        createFragment((frag) => {
          frag.createDiv({ text: syncT().optionEncryptionPasswordDesc() });
          frag.createDiv({ cls: "mod-warning", text: syncT().optionEncryptionPasswordDescWarning() });
          frag.createDiv({ text: syncT().optionEncryptionPasswordDesc_2() });
        }),
      )
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder(syncT().optionEncryptionPasswordPlaceholder())
          .onChange((value) => (self.key = value));
      });
    self.ctaButtonEl = self.buttonContainerEl.createEl("button", {
      cls: "mod-cta",
      text: SE().gm.interface.startScreen.buttonCreateVault(),
    });
    self.ctaButtonEl.addEventListener("click", self.onCreateVault.bind(self));
    self.addCancelButton();
    return self;
  }
  inherit(CreateVaultModal, DialogModal);

  CreateVaultModal.prototype.onCreateVault = async function () {
    const vaultName = this.vaultName;
    const region = this.region;
    const useOwn = this.useOwnPassword;
    const key = this.key;
    const errorEl = this.errorEl;
    errorEl.hide();
    let error = "";
    if (useOwn === true && key === "") error = syncT().msgPleaseEnterPassword();
    if (vaultName === "") error = syncT().msgVaultNameCannotBeEmpty();
    if (error) {
      errorEl.setText(error);
      errorEl.show();
      return true;
    }
    this.ctaButtonEl.addClass("mod-loading");
    let keyhash = null;
    let salt = null;
    try {
      if (useOwn) {
        salt = randomSaltHex();
        keyhash = await deriveVaultKeyhash(key, salt, 3);
      }
      try {
        await acctCreateVault(account.token, vaultName, keyhash, salt, region, 3);
      } catch (err) {
        errorEl.setText(err.message);
        errorEl.show();
        return true;
      }
    } finally {
      this.ctaButtonEl.removeClass("mod-loading");
    }
    this.close();
    new (SE().fb)(syncT().msgSuccessfullyCreatedVault({ name: vaultName }));
    this.plugin.openChooseRemoteVaultModal();
    return true;
  };

  CreateVaultModal.prototype.onOpen = async function () {
    this.vaultName = "";
    this.region = "";
    this.useOwnPassword = true;
    this.key = "";
    const regions = await acctVaultRegions(account.token);
    regions.forEach((region) => this.regionSettingDropdown.addOption(region.value, region.name));
  };

  // -- U9: connect to remote vault ---------------------------------------------
  function ConnectVaultModal(app, plugin) {
    const self = DialogModal.call(this, app) || this;
    self.sync = plugin;
    self.settingTab = plugin.settingTab;
    self.modalEl.addClass("mod-lg");
    self.msgContainerEl = createDiv("message-container");
    self.errorEl = self.msgContainerEl.createDiv("message mod-error");
    self.setTitle(syncT().labelConnectingToVault());
    self.loaderEl = SE().fD(self.contentEl);
    return self;
  }
  inherit(ConnectVaultModal, DialogModal);

  ConnectVaultModal.prototype.showError = function (message) {
    if (message) {
      this.contentEl.prepend(this.msgContainerEl);
      this.errorEl.setText(message);
    } else {
      this.msgContainerEl.detach();
    }
  };

  ConnectVaultModal.prototype.showLoading = function () {
    this.contentEl.empty();
    this.buttonContainerEl.empty();
    this.setTitle(syncT().labelConnectingToVault());
    this.contentEl.appendChild(this.loaderEl);
  };

  ConnectVaultModal.prototype.showSetupRetry = function (retry) {
    this.contentEl.empty();
    this.buttonContainerEl.empty();
    this.setTitle(syncT().labelConnectionFailed());
    this.contentEl.createEl("p", { text: syncT().labelConnectionFailedDesc() });
    this.addButton("mod-cta", syncT().buttonRetry(), retry);
    this.addCancelButton();
  };

  ConnectVaultModal.prototype.connect = function (vault, onConnected) {
    const self = this;
    const attempt = async () => {
      let unlocked = false;
      if (vault.password) {
        try {
          await SE().kk(vault.id, vault.password, vault.salt, vault.host, vault.encryption_version);
          unlocked = true;
        } catch (err) {
          // wrong password -> prompt below
        }
      }
      if (!unlocked) {
        await this.showPasswordPrompt(vault);
        this.showLoading();
      }
      try {
        await this.sync.setup(vault.id, vault.name, vault.password, vault.salt, vault.host, vault.encryption_version);
        this.sync.setPause(true);
        if (onConnected) onConnected();
        this.showConfiguration(vault.name);
      } catch (err) {
        this.showSetupRetry(attempt);
      }
      return true;
    };
    if (this.app.vault.getFiles().length > 0) {
      this.showConfirmVault(vault.name, attempt);
      return this;
    }
    attempt();
    return this;
  };

  ConnectVaultModal.prototype.showPasswordPrompt = function (vault) {
    const self = this;
    this.contentEl.empty();
    this.buttonContainerEl.empty();
    this.setTitle(syncT().labelUnlockEncryptedVault());
    this.contentEl.createEl("p", { text: syncT().labelEncryptionPasswordExplanation({ name: vault.name }) });
    let password = "";
    new Setting(this.contentEl)
      .setName(syncT().optionEncryptionPassword())
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder(syncT().optionEncryptionPasswordPlaceholder())
          .onChange((value) => {
            password = value;
            self.showError("");
          });
      });
    const deferred = SE().gb();
    const unlockButton = this.buttonContainerEl.createEl("button", {
      cls: "mod-cta",
      text: syncT().buttonUnlockVault(),
    });
    unlockButton.addEventListener("click", async () => {
      try {
        await withButtonLoading(unlockButton, () => SE().kk(vault.id, password, vault.salt, vault.host, vault.encryption_version));
        vault.password = password;
        deferred.resolve();
      } catch (err) {
        console.error(err);
        if (err instanceof XMLHttpRequest) this.showError(pubT().msgNetworkError());
        else this.showError(err.message);
      }
    });
    this.addCancelButton(() => deferred.reject());
    return deferred.promise;
  };

  ConnectVaultModal.prototype.showConfiguration = function (vaultName) {
    this.setTitle(syncT().labelSetupConnection());
    this.contentEl.empty();
    const state = this.contentEl.createDiv("modal-confirmation-state");
    SE().tv(state.createDiv("modal-status-icon mod-success"), "circle-check");
    state.createEl("p", { text: syncT().labelNowConnectedToVault({ name: vaultName }) });
    this.buttonContainerEl.empty();
    this.addButton("", syncT().labelManageExcludedFolders(), () => {
      this.settingTab.manageExclusions();
      return true;
    });
    this.addButton("mod-cta", syncT().buttonStartSyncing(), () => {
      this.sync.setPause(false);
      this.settingTab.display();
    });
  };

  ConnectVaultModal.prototype.showConfirmVault = function (vaultName, proceed) {
    this.setTitle(syncT().labelConfirmMergeVault());
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: syncT().msgVaultHasNotes() });
    this.contentEl.createEl("p", { text: syncT().msgVaultMergeWarning({ name: vaultName }) });
    this.buttonContainerEl.empty();
    this.addButton("mod-cta", SE().gm.dialogue.buttonContinue(), proceed);
    this.addCancelButton();
  };

  // -- _9: manage vault sharing -------------------------------------------------
  function ManageSharingModal(app, vaultName, vaultId) {
    const self = DialogModal.call(this, app) || this;
    self.shares = [];
    self.shareItemEls = {};
    self.vaultId = vaultId;
    const contentEl = self.contentEl;
    contentEl.addClass("sync-vault-share-container");
    self.setTitle(pubT().labelManageSharing({ name: vaultName }));
    contentEl.createEl("p", { cls: "u-muted", text: syncT().labelSharingWithUsers() });
    self.sharesContainerEl = contentEl.createDiv({ cls: "sync-vault-shares-list-item-container" });
    let emailComponent = null;
    let addButtonComponent = null;
    new Setting(contentEl)
      .setName(pubT().optionInviteUser())
      .addText((text) =>
        text
          .setPlaceholder(pubT().placeholderInviteUser())
          .then((comp) => {
            self.emailTextComponent = emailComponent = comp;
            comp.inputEl.addEventListener("keydown", (event) => {
              if (event.isComposing || event.key !== "Enter") return;
              self.inviteToVault(comp.getValue());
            });
          }),
      )
      .addButton((btn) => {
        self.addButtonComponent = addButtonComponent = btn;
        return btn
          .setButtonText(SE().gm.interface.buttonAdd())
          .setCta()
          .onClick(() => self.inviteToVault(emailComponent.getValue()));
      });
    self.addButton("", SE().gm.dialogue.buttonDone(), () => self.close());
    self.loadShareItems();
    return self;
  }
  inherit(ManageSharingModal, DialogModal);

  ManageSharingModal.prototype.loadShareItems = async function () {
    const contentEl = this.contentEl;
    const listEl = this.sharesContainerEl;
    try {
      const result = await SE().mD(this.contentEl, () => acctListVaultShares(account.token, this.vaultId));
      this.shares = result.shares;
    } catch (err) {
      contentEl.empty();
      contentEl.createEl("p", { cls: "mod-warning", text: err.message });
      return;
    }
    if (this.shares.length > 0) {
      const items = {};
      const self = this;
      for (const share of this.shares) {
        let el = this.shareItemEls[share.uid];
        if (el == null) {
          el = listEl.createDiv("list-item", (div) => {
            if (share.name) {
              div.createDiv({ cls: "list-item-part", text: share.name });
              div.createDiv({ cls: "list-item-part mod-extended", text: `<${share.email}>` });
            } else {
              div.createDiv({ cls: "list-item-part mod-extended", text: share.email });
            }
            if (!share.accepted) {
              div.createDiv({ cls: "list-item-part" }, (part) => {
                part.createSpan({ cls: "u-muted", text: pubT().labelInvitePending() });
              });
            }
            div.createDiv("list-item-part clickable-icon", (icon) => {
              SE().tv(icon, "lucide-x");
              setElementTooltip(icon, pubT().tooltipRemoveUser());
              icon.addEventListener("click", async () => {
                listEl.hide();
                try {
                  await SE().Uv(this.contentEl, () => acctRemoveVaultShare(account.token, self.vaultId, share.uid));
                } catch (err) {
                  new (SE().fb)(err.message);
                }
                await self.loadShareItems();
              });
            });
          });
        }
        items[share.uid] = el;
      }
      listEl.setChildrenInPlace(Object.values(items));
      this.shareItemEls = items;
    } else {
      this.sharesContainerEl.setChildrenInPlace([createEl("p", { cls: "u-muted", text: syncT().labelNotSharing() })]);
    }
    const emailInput = this.emailTextComponent.inputEl;
    this.addButtonComponent.buttonEl.ariaDisabled = undefined;
    emailInput.ariaDisabled = undefined;
    emailInput.value = "";
    emailInput.focus();
  };

  ManageSharingModal.prototype.inviteToVault = async function (email) {
    email = email.trim();
    if (email === "" || !email.includes("@")) {
      new (SE().fb)(pubT().errorEmailMustBeValid());
      return;
    }
    const emailInput = this.emailTextComponent.inputEl;
    const addButton = this.addButtonComponent.buttonEl;
    emailInput.ariaDisabled = String(true);
    addButton.ariaDisabled = String(true);
    try {
      await SE().Uv(this.contentEl, () =>
        acctInviteVaultShare(account.token, this.vaultId, email),
      );
    } catch (err) {
      new (SE().fb)(err.message);
      return;
    } finally {
      emailInput.ariaDisabled = undefined;
      addButton.ariaDisabled = undefined;
    }
    await this.loadShareItems();
  };

  // -- z9: sync log viewer --------------------------------------------------------
  function SyncLogModal(app, plugin) {
    const self = Modal.call(this, app) || this;
    self.plugin = null;
    self.syncLog = [];
    self.syncLogContainerEl = null;
    self.filterEventType = "all";
    self.searchQuery = null;
    self.plugin = plugin;
    self.updateSyncLog = self.updateSyncLog.bind(self);
    const contentEl = self.contentEl;
    self.modalEl.addClass("mod-sync-log", "mod-lg");
    self.setTitle(syncT().labelSyncLog());
    new Setting(contentEl)
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            all: syncT().optionEventTypeAll(),
            errors: syncT().optionEventTypeErrors(),
            skipped: syncT().optionEventTypeSkipped(),
            merge: syncT().optionEventTypeMergeConflicts(),
          })
          .onChange((value) => {
            self.filterEventType = value;
            self.updateSyncLog();
          }),
      )
      .addSearch((search) =>
        search
          .setPlaceholder(SE().gm.interface.promptFilter())
          .onChange((value) => {
            const matcher = new FuzzyMatcher(self.app, value, false);
            self.searchQuery = matcher.matcher ? matcher : null;
            self.updateSyncLog();
          }),
      );
    self.syncLogContainerEl = contentEl.createDiv("sync-log-container");
    contentEl.createDiv("modal-button-container", (div) => {
      div.createEl("button", { text: syncT().buttonCopySyncLog(), cls: "mod-cta" }).addEventListener(
        "click",
        self.onCopyResults.bind(self),
      );
      div.createEl("button", { text: SE().gm.dialogue.buttonDone() }).addEventListener("click", () => self.close());
    });
    return self;
  }
  inherit(SyncLogModal, Modal);

  SyncLogModal.prototype.onOpen = function () {
    Modal.prototype.onOpen.call(this);
    this.updateSyncLog();
    this.plugin.on("new-log", this.updateSyncLog);
  };
  SyncLogModal.prototype.onClose = function () {
    this.plugin.off("new-log", this.updateSyncLog);
    Modal.prototype.onClose.call(this);
  };
  SyncLogModal.prototype.updateSyncLog = function () {
    const container = this.syncLogContainerEl;
    const log = (this.syncLog = this.plugin.syncLog);
    for (const entry of log) {
      if (!entry.el) {
        const timestamp = window.moment(entry.ts).format("YYYY-MM-DD HH:mm");
        const text = (entry.textContent = `${timestamp} - ${entry.info} ${entry.file ?? ""}`);
        entry.el = createDiv({ cls: "list-item", text });
        if (entry.error) entry.el.addClass("mod-error");
      }
    }
    const items = [];
    for (const entry of log) {
      if (this.filterEventType === "errors" && !entry.error) continue;
      if (this.filterEventType === "merge" && entry.type !== "merge") continue;
      if (this.filterEventType === "skipped" && entry.type !== "skip") continue;
      const text = entry.textContent ?? "";
      if (this.searchQuery) {
        const match = this.searchQuery.matchContent(text);
        if (!match) continue;
        entry.el.empty();
        renderMatches(entry.el, text, match.content);
      } else {
        entry.el.setText(text);
      }
      items.push(entry.el);
    }
    container.setChildrenInPlace(items);
    container.scrollTop = container.scrollHeight;
  };
  SyncLogModal.prototype.onCopyResults = function () {
    let text = "";
    for (const entry of this.syncLog) {
      text += `${window.moment(entry.ts).format("YYYY-MM-DD HH:mm")}`;
      text += ` - ${entry.info}`;
      if (entry.file) text += ` ${entry.file}`;
      text += "\n";
    }
    copyTextToClipboard(text);
    new (SE().fb)(syncT().msgSuccessfullyCopiedSyncLog());
  };

  // -- H9: remote vault list -------------------------------------------------------
  function RemoteVaultsModal(app, plugin) {
    const self = Modal.call(this, app) || this;
    self.plugin = null;
    self.errorEl = null;
    self.vaultsEl = null;
    self.loaderEl = null;
    self.plugin = plugin;
    self.setTitle(syncT().labelRemoteVaults());
    self.modalEl.addClass("mod-lg");
    self.errorEl = self.contentEl.createDiv("error-container");
    self.errorEl.hide();
    self.loaderEl = SE().fD(self.contentEl);
    self.loaderEl.hide();
    self.vaultsEl = self.contentEl.createDiv();
    return self;
  }
  inherit(RemoteVaultsModal, Modal);

  RemoteVaultsModal.prototype.loadRemoteVaults = async function () {
    const errorEl = this.errorEl;
    const vaultsEl = this.vaultsEl;
    const currentId = this.plugin.getRemoteVaultId();
    try {
      const result = await acctListVaults(account.token);
      if ("error" in result) throw new Error("Failed to fetch remote vaults!");
      var data = result;
    } catch (err) {
      this.stopLoading();
      errorEl.empty();
      errorEl.createDiv({ cls: "error-text", text: syncT().msgErrorFailedToFetch() });
      const retry = errorEl.createEl("button", { text: syncT().buttonRetry() });
      retry.addEventListener("click", () => {
        withButtonLoading(retry, () => this.loadRemoteVaults());
      });
      errorEl.show();
      return;
    }
    const limit = data.limit;
    const vaults = data.vaults;
    const shared = data.shared;
    errorEl.hide();
    vaultsEl.empty();
    if (limit === 0) {
      vaultsEl.createDiv("vault-empty-state", (div) => {
        div.createEl("p", { text: syncT().labelNoSubscription() });
        div.createEl("p", {}, (p) => {
          p.createSpan({ text: syncT().labelPleaseVisit() + " " });
          p.createEl("a", {
            cls: "mod-cta",
            text: "github.com/FalconTechDev/basalt",
            href: "https://github.com/FalconTechDev/basalt",
            attr: { target: "_blank" },
          });
          p.createSpan({ text: "." });
        });
      });
    } else if (vaults.length === 0) {
      vaultsEl.createDiv("vault-empty-state", (div) => {
        div.createEl("p", { text: syncT().labelNotRemoteVaults() });
      });
    } else {
      const list = vaultsEl.createDiv("list-container vault-list");
      const self = this;
      const renderVault = (vault) => {
        list.createDiv("list-item vault-list-item", (item) => {
          const connected = currentId === vault.id;
          if (connected && vault.name !== self.plugin.getRemoteVaultName()) self.plugin.setVaultName(vault.name);
          item.createDiv("list-item-part mod-extended", (ext) => {
            ext.createDiv("vault-list-item-title", (title) => {
              title.toggleClass("is-connected", connected);
              title.createDiv("vault-list-item-icon list-item-part", (icon) => {
                SE().tv(icon, connected ? "open-vault" : "vault");
              });
              title.createSpan({ text: vault.name });
            });
            ext.createDiv("list-item-desc vault-list-item-desc", (desc) => {
              if (vault.hasOwnProperty("region") && vault.region !== "") desc.createDiv({ cls: "list-item-part", text: vault.region });
              desc.createDiv({ cls: "list-item-part", text: formatBytes(vault.size) });
              desc.createDiv({
                cls: "list-item-part mod-extended",
                text: syncT().labelVaultCreatedTime({ time: window.moment(vault.created).fromNow() }),
              });
            });
          });
          item.createDiv("list-item-actions", (actions) => {
            if (!connected) {
              actions.createDiv("list-item-part clickable-icon", (icon) => {
                SE().tv(icon, "lucide-trash-2");
                setElementTooltip(icon, syncT().tooltipDeleteRemoteVault());
                icon.addEventListener("click", () => {
                  const frag = createFragment();
                  frag.createEl("p", { text: syncT().labelConfirmDeleteRemoteVaultQuestion({ name: vault.name }) });
                  frag.createEl("p", { text: syncT().labelConfirmDeleteRemoteVaultResult() });
                  frag.createEl("p", { cls: "mod-warning", text: syncT().labelConfirmDeleteRemoteVaultWarning() });
                  const confirm = new DialogModal(self.app);
                  confirm
                    .setTitle(syncT().labelConfirmDeleteRemoteVault())
                    .setContent(frag)
                    .addButton("mod-warning", "Delete", async () => {
                      this.startLoading();
                      confirm.close();
                      try {
                        await acctRequest("/vault/delete", { token: account.token, vault_uid: vault.id });
                        new (SE().fb)(syncT().msgRemoteVaultDeleted({ name: vault.name }));
                        this.open();
                      } catch (err) {
                        new (SE().fb)(err.message);
                      } finally {
                        this.onOpen();
                      }
                    })
                    .addCancelButton()
                    .open();
                });
              });
            }
            actions.createDiv("list-item-part clickable-icon", (icon) => {
              SE().tv(icon, "lucide-edit-3");
              setElementTooltip(icon, syncT().tooltipRenameRemoteVault());
              const doRename = async (newName) => {
                if (newName === "" || newName === vault.name) return;
                this.startLoading();
                try {
                  await acctRenameVault(account.token, vault.id, newName);
                } catch (err) {
                  new (SE().fb)(err.message);
                  return;
                } finally {
                  this.stopLoading();
                }
                if (connected) await this.plugin.setRemoteVaultName(newName);
                this.onOpen();
              };
              icon.addEventListener("click", () => {
                new RenameVaultModal(self.app, vault.name, doRename).open();
              });
            });
            actions.createDiv("list-item-part clickable-icon", (icon) => {
              SE().tv(icon, "lucide-users");
              setElementTooltip(icon, syncT().tooltipManageSharing({ name: vault.name }));
              icon.addEventListener("click", () => {
                new ManageSharingModal(self.app, vault.name, vault.id).open();
              });
            });
            if (!connected && !currentId) {
              item.createEl("button", { cls: "list-item-part vault-list-item-button", text: syncT().buttonConnectToRemoteVault() }, (btn) => {
                btn.addEventListener("click", async () => {
                  const result = await withButtonLoading(btn, () => acctListSubscriptions(account.token));
                  if ("error" in result) return;
                  if (result.sync) {
                    new ConnectVaultModal(this.app, this.plugin).connect(vault, () => this.close()).open();
                  } else {
                    this.errorEl.setText(syncT().labelRequireSubscriptionToConnect());
                    this.errorEl.show();
                  }
                });
              });
            }
          });
        });
      };
      for (const vault of vaults) renderVault(vault);
      if (vaults.length < limit) {
        vaultsEl.createDiv("modal-button-container", (div) => {
          div.createEl("button", { cls: "mod-cta js-create-vault", text: syncT().buttonCreateNewRemoteVault() }, (btn) => {
            btn.addEventListener("click", () => {
              this.close();
              new CreateVaultModal(this.app, this.plugin).open();
            });
          });
        });
      } else if (limit > 0) {
        vaultsEl.createEl("p", { cls: "u-small u-muted", text: syncT().msgRemoteVaultLimitHit() });
      }
      if (shared.length > 0) {
        new Setting(vaultsEl).setName(syncT().labelVaultsSharedWithYou()).setHeading();
        const sharedList = vaultsEl.createDiv("list-container vault-list");
        const renderShared = (vault) => {
          sharedList.createDiv("list-item vault-list-item", (item) => {
            const connected = currentId === vault.id;
            if (connected && vault.name !== self.plugin.getRemoteVaultName()) self.plugin.setVaultName(vault.name);
            item.createDiv("list-item-part mod-extended", (ext) => {
              ext.createDiv("vault-list-item-title", (title) => {
                title.toggleClass("is-connected", connected);
                title.createDiv("vault-list-item-icon list-item-part", (icon) => {
                  SE().tv(icon, connected ? "open-vault" : "vault");
                });
                title.createSpan({ text: vault.name });
              });
              ext.createDiv("list-item-desc vault-list-item-desc", (desc) => {
                if (vault.hasOwnProperty("region") && vault.region !== "") desc.createDiv({ cls: "list-item-part", text: vault.region });
                desc.createDiv({ cls: "list-item-part", text: formatBytes(vault.size) });
                desc.createDiv({
                  cls: "list-item-part mod-extended",
                  text: syncT().labelVaultCreatedTime({ time: window.moment(vault.created).fromNow() }),
                });
              });
            });
            item.createDiv("list-item-actions", (actions) => {
              if (connected) {
                actions.createEl("button", { cls: "list-item-part vault-list-item-button", text: syncT().buttonDisconnectFromRemoteVault() }).addEventListener(
                  "click",
                  async () => {
                    this.startLoading();
                    await this.plugin.unsetup();
                    this.open();
                  },
                );
              } else if (!currentId) {
                actions.createEl("button", { cls: "list-item-part vault-list-item-button", text: syncT().buttonConnectToRemoteVault() }, (btn) => {
                  btn.addEventListener("click", async () => {
                    const result = await withButtonLoading(btn, () => acctListSubscriptions(account.token));
                    if ("error" in result) return;
                    if (result.sync) {
                      new ConnectVaultModal(this.app, this.plugin).connect(vault, () => this.close()).open();
                    } else {
                      this.errorEl.setText(syncT().labelRequireSubscriptionToConnect());
                      this.errorEl.show();
                    }
                  });
                });
              }
              actions.createDiv("clickable-icon", (icon) => {
                SE().tv(icon, "lucide-x");
                setElementTooltip(icon, syncT().tooltipLeaveVaultSharing());
                icon.addEventListener("click", () => {
                  const frag = createFragment();
                  frag.createEl("p", { cls: "setting-message mod-warning", text: syncT().labelLeaveVaultConfirmationDetails() });
                  frag.createEl("p", { text: syncT().labelLeaveVaultConfirmationDetails() });
                  new DialogModal(self.app)
                    .setTitle(syncT().labelLeaveVaultConfirmation({ vault: vault.name }))
                    .setContent(frag)
                    .addButton("mod-warning", syncT().buttonLeave(), () => {
                      self.deleteVaultShare(vault.id, vault.share_uid);
                    })
                    .addCancelButton()
                    .open();
                });
              });
            });
          });
        };
        for (const vault of shared) renderShared(vault);
      }
      this.stopLoading();
    }
  };

  RemoteVaultsModal.prototype.onOpen = function () {
    this.startLoading();
    this.loadRemoteVaults();
  };
  RemoteVaultsModal.prototype.onClose = function () {
    Modal.prototype.onClose.call(this);
    this.plugin.settingTab.display();
  };
  RemoteVaultsModal.prototype.startLoading = function () {
    this.vaultsEl.hide();
    this.loaderEl.show();
  };
  RemoteVaultsModal.prototype.stopLoading = function () {
    this.vaultsEl.show();
    this.loaderEl.hide();
  };
  RemoteVaultsModal.prototype.deleteVaultShare = async function (vaultId, shareUid) {
    try {
      await SE().mD(this.contentEl, () => acctRemoveVaultShare(account.token, vaultId, shareUid));
    } catch (err) {
      new (SE().fb)(err.message);
      return;
    }
    if (this.plugin.getRemoteVaultId() === vaultId) {
      await this.plugin.unsetup();
    }
  };

  // -- W9: rename remote vault -----------------------------------------------------
  function RenameVaultModal(app, vaultName, onSubmit) {
    const self = DialogModal.call(this, app) || this;
    self.cb = onSubmit;
    self.setTitle(syncT().labelRenameRemoteVault({ name: vaultName }));
    self.addButton("mod-cta", SE().gm.dialogue.buttonSave(), self.submit.bind(self));
    self.addCancelButton();
    const contentEl = self.contentEl;
    contentEl.empty();
    new Setting(contentEl)
      .setName(syncT().optionVaultName())
      .setDesc(syncT().labelRenameRemoteVaultDesc())
      .addText((text) => {
        self.textEl = text;
        text.setPlaceholder(vaultName);
      });
    return self;
  }
  inherit(RenameVaultModal, DialogModal);
  RenameVaultModal.prototype.submit = function () {
    this.cb(this.textEl.getValue());
  };

  // -- I9: file version history ------------------------------------------------------
  function FileHistoryView(app, plugin, filepath) {
    const self = Modal.call(this, app) || this;
    self.plugin = null;
    self.items = [];
    self.filepath = null;
    self.listContainerEl = null;
    self.listEl = null;
    self.contentContainerEl = null;
    self.contentDiffEl = null;
    self.activeItemParentEl = null;
    self.activeItemEl = null;
    self.loadMoreButtonEl = null;
    self.activeItem = null;
    self.cache = {};
    self.plugin = plugin;
    self.filepath = filepath;
    self.setTitle(filepath);
    self.modalEl.addClass("mod-sync-history", "mod-sidebar-layout");
    const contentEl = self.contentEl;
    const backButtonEl = (self.backButtonEl = self.titleEl.createDiv(
      "clickable-icon modal-setting-back-button mod-raised",
      (div) => {
        SE().tv(div, "lucide-arrow-left");
        div.addEventListener("click", () => {
          SE().Dl(self.contentEl, self.listContainerEl, "left");
          backButtonEl.hide();
        });
      },
    ));
    backButtonEl.hide();
    const listContainerEl = (self.listContainerEl = contentEl.createDiv("sync-history-list-container"));
    self.listEl = listContainerEl.createDiv("modal-sidebar sync-history-list");
    self.loadMoreButtonEl = createEl("button", { cls: "sync-history-button", text: syncT().labelLoadMore() }, (btn) => {
      btn.addEventListener("click", self.fetchMore.bind(self));
    });
    const contentContainerEl = (self.contentContainerEl = contentEl.createDiv("sync-history-content-container"));
    if (SE().Yl.isPhone) contentContainerEl.detach();
    const contentTextEl = self.contentTextEl = contentContainerEl.createDiv("sync-history-content");
    self.contentTitlebarEl = contentTextEl.createDiv("modal-setting-titlebar", (bar) => {
      bar.createDiv({
        cls: "modal-setting-title",
        text: extensionOf(self.filepath) === "md" ? baseName(self.filepath) : self.filepath,
      });
      bar.createDiv("modal-setting-titlebar-actions", (actions) => {
        actions.createSpan({ text: syncT().labelShowDiff(), cls: "modal-setting-titlebar-toggle" }, (span) => {
          self.diffToggle = new ToggleComponent(span).setSmall().setValue(!!localStorage.getItem("history-show-diff"));
        });
        self.contentCopyButton = new ButtonComponent(actions).setButtonText(SE().gm.interface.labelCopyShort());
        self.restoreVersionButton = new ButtonComponent(actions)
          .setButtonText(syncT().labelRestoreThisVersion())
          .onClick(async () => {
            if (this.activeItem === this.items[0][0]) {
              new (SE().fb)(syncT().msgAlreadyLatestVersion());
              return;
            }
            const related = this.filepath !== this.activeItem.path ? this.filepath : "";
            await this.plugin.restoreVersion(this.activeItem.uid, related);
            new (SE().fb)(syncT().msgRestoredVersion({ time: window.moment(this.activeItem.ts).fromNow() }));
            this.close();
          });
      });
    });
    self.contentPreviewEl = contentTextEl.createDiv("sync-history-preview");
    self.contentDiffEl = contentTextEl.createDiv("sync-history-diff");
    return self;
  }
  inherit(FileHistoryView, Modal);

  FileHistoryView.prototype.onOpen = function () {
    this.fetchMore();
    if (SE().jy.includes(extensionOf(this.filepath))) {
      const recovery = this.app.internalPlugins.getEnabledPluginById("file-recovery");
      if (recovery) {
        this.listEl.createEl("button", {
          prepend: true,
          cls: "sync-history-button",
          text: SE().gm.plugins.fileRecovery.actionOpen(),
          onclick: () => recovery.openModal(this.filepath),
        });
      }
    }
  };

  FileHistoryView.prototype.openHistory = async function (item, prevGroupFirst) {
    const contentContainerEl = this.contentContainerEl;
    const diffToggle = this.diffToggle;
    const previewEl = this.contentPreviewEl;
    const diffEl = this.contentDiffEl;
    const copyButton = this.contentCopyButton;
    const titlebarEl = this.contentTitlebarEl;
    const restoreButton = this.restoreVersionButton;
    previewEl.removeClass("markdown-rendered");
    previewEl.empty();
    diffEl.empty();
    titlebarEl.hide();
    diffToggle.setDisabled(true);
    copyButton.buttonEl.setAttr("disabled", true);
    restoreButton.buttonEl.hide();
    if (SE().Yl.isPhone) {
      SE().Dl(this.contentEl, this.contentContainerEl, "right");
      this.backButtonEl.show();
    }
    if (item.relatedpath) {
      const fromName = lastSegment(item.relatedpath);
      const toName = lastSegment(item.path);
      const fromDir = parentPath(item.relatedpath);
      const toDir = parentPath(item.path);
      if (fromName === toName) {
        previewEl.createDiv({ cls: "sync-history-desc", text: syncT().labelFileMovedFromTo({ from: fromDir || "/", to: toDir || "/" }) });
      } else if (fromDir === toDir) {
        previewEl.createDiv({ cls: "sync-history-desc", text: syncT().labelFileRenamedFromTo({ from: fromName, to: toName }) });
      } else {
        previewEl.createDiv({ cls: "sync-history-desc", text: syncT().labelFileRenamedFromTo({ from: item.relatedpath, to: item.path }) });
      }
      previewEl.show();
      return;
    }
    if (item.deleted) {
      previewEl.createDiv({ cls: "sync-history-desc", text: syncT().labelFileDeleted() });
      previewEl.show();
      return;
    }
    restoreButton.buttonEl.show();
    titlebarEl.show();
    await SE().Uv(contentContainerEl, async () => {
      const ext = extensionOf(lastSegment(this.filepath));
      const isText = SE().jy.includes(ext) || SE()._y.includes(ext) || SE().Wy.includes(ext);
      let content;
      let decode;
      if (isText) {
        decode = utf8String;
        content = decode(await this.getContentForVersion(item.uid));
        previewEl.addClass("markdown-rendered");
        diffToggle.setDisabled(false);
        copyButton.buttonEl.removeAttribute("disabled");
        copyButton.onClick(() => {
          copyTextToClipboard(content);
          new (SE().fb)(SE().gm.interface.copied({ context: "generic" }));
        });
      } else {
        if (SE().Vy.includes(ext)) {
          const data = await this.getContentForVersion(item.uid);
          const url = URL.createObjectURL(new Blob([data], { type: "image/" + ext }));
          SE().xc(previewEl, url).then(() => URL.revokeObjectURL(url));
          previewEl.show();
          diffEl.hide();
          return;
        }
        if (SE().Uy.includes(ext)) {
          decode = utf8String;
          const data = decode(await this.getContentForVersion(item.uid));
          SE().o8(previewEl, data);
          previewEl.show();
          diffEl.hide();
          return;
        }
        previewEl.createDiv(syncT().labelPreviewUnsupportedFileType({ type: ext }));
        previewEl.show();
        diffEl.hide();
        return;
      }
      let diffBase = content;
      let diffDone = false;
      let rendered = false;
      const renderContent = async () => {
        const showDiff = diffToggle.getValue();
        if (showDiff) localStorage.setItem("history-show-diff", "true");
        else localStorage.removeItem("history-show-diff");
        previewEl.toggle(!showDiff);
        diffEl.toggle(showDiff);
        if (!showDiff || diffDone) return;
        diffDone = true;
        let base;
        if (prevGroupFirst) base = decode(await this.getContentForVersion(prevGroupFirst.uid));
        else base = content;
        diffBase = base;
        diffEl.empty();
        diffEl.appendChild(SE().RX(base, content));
      };
      diffToggle.onChange(renderContent);
      await renderContent();
      if (!rendered) {
        rendered = true;
        if (SE().jy.includes(ext)) {
          const html = SE().xL(SE().Zx(SE().Kx(content)));
          previewEl.appendChild(html);
        } else {
          previewEl.createEl("pre").setText(content);
        }
      }
      previewEl.show();
      diffEl.hide();
    });
  };

  FileHistoryView.prototype.getContentForVersion = async function (uid) {
    const cache = this.cache;
    if (!cache.hasOwnProperty(uid)) {
      cache[uid] = await this.plugin.getContentForVersion(uid);
    }
    return cache[uid];
  };

  FileHistoryView.prototype.setActiveHistoryItem = function (itemEl, item, parentEl) {
    if (this.activeItemEl) this.activeItemEl.removeClass("is-active");
    if (this.activeItemParentEl) this.activeItemParentEl.removeClass("is-active");
    this.activeItemEl = itemEl;
    itemEl.addClass("is-active");
    this.activeItem = item;
    if (parentEl) {
      this.activeItemParentEl = parentEl;
      parentEl.addClass("is-active");
    }
  };

  FileHistoryView.prototype.createHistoryItemAvatar = function (containerEl, item) {
    let isCurrentUser = false;
    let name = item.username || item.email;
    if (!name) {
      isCurrentUser = true;
      name = account.name;
    }
    const initials = name
      .split(" ")
      .map((part) => part.charAt(0))
      .slice(0, 2)
      .join("");
    let colorClass = "";
    if (isCurrentUser) colorClass = "mod-avatar-current-user";
    else {
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i);
      colorClass = s15AvatarColorClasses[hash % s15AvatarColorClasses.length];
    }
    const avatar = containerEl.createDiv({ cls: "sync-history-list-item-avatar " + colorClass, text: initials });
    setElementTooltip(
      avatar,
      (() => {
        let text = "";
        const entry = item;
        if (entry.username) text = entry.email ? `${entry.username} (${entry.email})` : entry.username;
        else if (entry.email) text = entry.email;
        if (text.length > 0) text += "\n";
        if (entry.device) text += entry.device;
        if (entry.relatedpath || entry.deleted || entry.size === 0) return text;
        return text + ", " + formatBytes(entry.size);
      })(),
      { placement: "bottom", gap: 16, delay: 1000 },
    );
  };

  FileHistoryView.prototype.fetchMore = async function () {
    const items = this.items;
    const listEl = this.listEl;
    const loadMoreButton = this.loadMoreButtonEl;
    let before = null;
    let path = this.filepath;
    const isFirst = items.length === 0;
    if (items.length > 0) {
      const last = items.last().last();
      before = last.uid;
      path = last.relatedpath || last.path;
    }
    loadMoreButton.detach();
    let result;
    try {
      result = await this.plugin.getHistory(path, before);
    } catch (err) {
      new (SE().fb)(syncT().labelUnableToRetrieve());
      this.listEl.append(loadMoreButton);
      return;
    }
    let entries = result.items;
    const relatedIndex = entries.findIndex((entry) => entry.relatedpath && !entry.deleted);
    if (relatedIndex !== -1) {
      if (relatedIndex < entries.length - 1) entries = entries.slice(0, relatedIndex + 1);
      result.more = true;
    }
    const groups = (() => {
      const groups = [];
      let current = [];
      for (const entry of entries) {
        if ((!entry.deleted || !entry.relatedpath) && !entry.folder) {
          if (current.length !== 0) {
            const first = current.first();
            if (entry.deleted || entry.relatedpath || !window.moment(first.ts).isSame(entry.ts, "day")) {
              groups.push(current);
              current = [entry];
            } else if (first.device === entry.device && first.username === entry.username && first.ts - entry.ts < s15SyncHourMs) {
              current.push(entry);
            } else {
              groups.push(current);
              current = [entry];
            }
          } else {
            current.push(entry);
          }
        }
      }
      if (current.length > 0) groups.push(current);
      return groups;
    })();
    const self = this;
    const renderGroup = (group) => {
      const first = group[0];
      const groupIndex = items.push(group) - 1;
      const row = listEl.createDiv("sync-history-list-item");
      if (!(first.username || first.email)) row.addClass("mod-current-user");
      const header = row.createDiv("sync-history-list-item-header");
      const when = first.ts + 864e5 < Date.now() ? window.moment(first.ts).format("llll") : window.moment(first.ts).fromNow();
      self.createHistoryItemAvatar(header, first);
      const details = header.createDiv({ cls: "sync-history-list-item-details", text: when });
      const flairOuter = header.createDiv("tree-item-flair-outer");
      const subtitle = details.createDiv("u-small u-muted");
      if (first.relatedpath) {
        const fromName = lastSegment(first.relatedpath);
        const toName = lastSegment(first.path);
        const fromDir = parentPath(first.relatedpath);
        const toDir = parentPath(first.path);
        if (fromName === toName) subtitle.setText(syncT().labelFileMovedFrom({ from: fromDir || "/" }));
        else if (fromDir === toDir) subtitle.setText(syncT().labelFileRenamedFrom({ from: fromName }));
        else subtitle.setText(syncT().labelFileRenamedFrom({ from: first.relatedpath }));
      } else if (first.deleted) {
        if (first.username || first.email) subtitle.setText(syncT().labelFileDeleted());
        else subtitle.setText(syncT().labelFileDeletedVia({ device: first.device }));
      } else if (first.size === 0) {
        subtitle.setText(syncT().labelEmptyFile());
      } else {
        const revisions = syncT().labelRevision({ count: group.length });
        const via = first.username || first.email ? "" : " " + syncT().labelViaDevice({ device: first.device });
        subtitle.setText(revisions + via);
      }
      const versions = row.createDiv("version-group-container");
      versions.hide();
      versions.createSpan("connecting-line");
      for (let i = 0; i < group.length; i++) {
        const version = group[i];
        const versionEl = versions.createDiv({ cls: "version-group-item", text: window.moment(version.ts).format("LT") });
        versionEl.addEventListener("click", async () => {
          let nextFirst = null;
          if (i === group.length - 1) {
            nextFirst = groupIndex !== items.length - 1 ? items[groupIndex + 1].first() : null;
          } else {
            nextFirst = group[i + 1];
          }
          await self.openHistory(version, nextFirst);
          self.activeItem = version;
          if (!SE().Yl.isMobile) self.setActiveHistoryItem(versionEl, version, header);
        });
      }
      const flair = flairOuter.createSpan({ cls: "is-collapsed tree-item-flair" });
      if (!SE().Yl.isMobile) flair.addClass("collapse-icon");
      const toggle = () => {
        const expanded = !flair.hasClass("is-collapsed");
        flair.toggleClass("is-collapsed", expanded);
        toggleElementVisibility(versions, expanded, true);
      };
      SE().tv(flair, SE().Yl.isMobile ? "chevrons-up-down" : "right-triangle");
      flair.addEventListener("click", (event) => {
        event.stopPropagation();
        toggle();
      });
      header.addEventListener("click", async (event) => {
        if (flair.contains(event.targetNode)) return;
        if (self.activeItem === first) {
          toggle();
          return;
        }
        const idx = items.indexOf(group);
        const nextFirst = idx !== -1 && idx !== items.length - 1 ? items[idx + 1].first() : null;
        await self.openHistory(first, nextFirst);
        if (!SE().Yl.isMobile) self.setActiveHistoryItem(header, first);
        self.activeItem = first;
      });
      if (!isFirst || self.activeItemEl || SE().Yl.isMobile) return;
      self.setActiveHistoryItem(header, first);
    };
    for (const group of groups) renderGroup(group);
    if (isFirst && groups.length === 0) {
      listEl.createDiv({ cls: "list-item mod-empty", text: syncT().labelNoHistory() });
    } else if (!isFirst || groups.length > 0) {
      // fallthrough to open first group
    }
    if (isFirst) {
      if (groups.length === 0) {
        // already rendered empty state above
      } else if (!SE().Yl.isMobile) {
        const second = groups.length > 1 ? groups[1][0] : null;
        await self.openHistory(groups[0][0], second);
      }
    }
    if (result.more) this.listEl.append(loadMoreButton);
  };

  // -- q9: excluded folders suggester -------------------------------------------------
  function ExcludedFoldersSuggest(app, sync, settingTab) {
    const self =
      FolderSuggestBase.call(
        this,
        app,
        syncT().labelAddExcludedFolder(),
        syncT().labelAddExcludedFolderDesc(),
        "plugins.sync.label-number-of-folders-excluded",
      ) || this;
    self.sync = null;
    self.settingTab = null;
    self.sync = sync;
    self.settingTab = settingTab;
    self.modalEl.addClass("mod-lg");
    self.setTitle(syncT().labelManageExcludedFolders());
    return self;
  }
  inherit(ExcludedFoldersSuggest, FolderSuggestBase);
  ExcludedFoldersSuggest.prototype.onClose = function () {
    this.settingTab.display();
  };
  ExcludedFoldersSuggest.prototype.getPaths = function () {
    return this.sync.ignoreFolders;
  };
  ExcludedFoldersSuggest.prototype.setPaths = async function (paths) {
    await this.sync.setIgnoreFolders(paths);
  };

  // -- j9: largest files -----------------------------------------------------------------
  function LargestFilesModal(app, sync) {
    const self = Modal.call(this, app) || this;
    self.sync = sync;
    self.modalEl.addClass("mod-lg");
    self.titleEl.setText(syncT().msgLargestFiles());
    self.contentEl.createDiv({ text: syncT().msgLargestFilesDesc() });
    return self;
  }
  inherit(LargestFilesModal, Modal);
  LargestFilesModal.prototype.onOpen = async function () {
    const files = this.sync.serverFiles;
    const list = [];
    for (const path in files) {
      if (!files.hasOwnProperty(path)) continue;
      const file = files[path];
      if (file.size > 0) list.push(file);
    }
    list.sort((a, b) => b.size - a.size);
    const top = list.slice(0, 20);
    const container = this.contentEl;
    for (const file of top) {
      container.createDiv({ cls: "u-small u-muted", text: `${file.path} (${formatBytes(file.size)})` });
    }
  };

  // -- K9: sync changes view ---------------------------------------------------------------
  function SyncChangesView(app, sync) {
    const self = ItemView.call(this, app) || this;
    self.hideMyChanges = false;
    self.activeDom = null;
    self.userMapLoaded = false;
    self.userMap = {};
    self.fileItems = {};
    self.sync = sync;
    self.files = SE().Rz();
    const contentEl = self.contentEl;
    const containerEl = self.containerEl;
    self.uninitializedEl = contentEl.createDiv({ cls: "pane-empty sync-uninitialized", text: syncT().labelSyncDisconnected() });
    self.uninitializedEl.hide();
    const header = (self.headerDom = new ViewHeader(self.app, containerEl));
    const usersButton = header.addNavButton("users", syncT().buttonHideMyChanges(), () => {
      self.hideMyChanges = !self.hideMyChanges;
      usersButton.toggleClass("is-active", self.hideMyChanges);
      self.updateRecentChanges();
    });
    self.loadingEl = containerEl.createDiv({ prepend: true, cls: "is-loading" });
    const changesContainer = self.contentEl.createDiv("recent-changes-container");
    header.navHeaderEl.hide();
    changesContainer.hide();
    self.scope = new Scope(app.scope);
    self.tree = new Tree(self, {
      app: self.app,
      containerEl: changesContainer,
      id: "sync",
      scope: self.scope,
      getNodeId: (node) => (node instanceof SE().$9 ? node.id : ""),
    });
    const groups = (self.groups = {
      today: new (SE().Q9)(self.tree, "today", syncT().labelToday()),
      yesterday: new (SE().Q9)(self.tree, "yesterday", syncT().labelYesterday()),
      week: new (SE().Q9)(self.tree, "week", syncT().labelThisWeek()),
      older: new (SE().Q9)(self.tree, "older", syncT().labelOlder()),
    });
    self.tree.root.vChildren.setChildren([groups.today, groups.yesterday, groups.week, groups.older]);
    groups.older.setCollapsed(true, false);
    self.tree.loadFolds();
    return self;
  }
  inherit(SyncChangesView, ItemView);

  SyncChangesView.prototype.onload = function () {
    this.registerEvent(this.app.vault.on("delete", this.onDelete, this));
    this.registerEvent(this.app.vault.on("rename", this.onRename, this));
    this.registerEvent(this.app.workspace.on("file-open", this.onFileOpen, this));
    const debounced = debounceCall(this.updateRecentChanges.bind(this), 1000);
    this.registerEvent(this.sync.on("status-change", debounced));
    const interval = window.setInterval(this.handleRefreshInterval.bind(this), 3e5);
    this.registerInterval(interval);
  };

  SyncChangesView.prototype.handleRefreshInterval = async function () {
    if (window.moment().isSame(this.previousRefreshDate, "day")) return;
    await this.updateRecentChanges();
  };

  SyncChangesView.prototype.getViewType = function () {
    return "sync";
  };
  SyncChangesView.prototype.getDisplayText = function () {
    return syncT().labelSyncChanges();
  };
  SyncChangesView.prototype.getIcon = function () {
    return "refresh-ccw";
  };
  SyncChangesView.prototype.onResize = function () {
    this.tree.infinityScroll.onResize();
  };
  SyncChangesView.prototype.onDelete = function (file) {
    this.removeFile(file.path);
  };
  SyncChangesView.prototype.onRename = function (file, oldPath) {
    this.removeFile(oldPath);
  };
  SyncChangesView.prototype.onFileOpen = function (leaf) {
    if (!leaf) return;
    if (!this.fileItems.hasOwnProperty(leaf.path)) return;
    const item = this.fileItems[leaf.path];
    if (item === this.activeDom) return;
    if (item !== this.tree.focusedItem) this.tree.clearSelectedDoms();
    this.activeDom?.selfEl.removeClass("is-active");
    item?.selfEl.addClass("is-active");
    this.activeDom = item;
  };
  SyncChangesView.prototype.removeFile = function (path) {
    if (!this.fileItems.hasOwnProperty(path)) return;
    const item = this.fileItems[path];
    this.files.delete(item.el);
    delete this.fileItems[path];
    if (this.activeDom === item) this.activeDom = null;
    this.tree.selectedDoms.delete(item);
    if (this.tree.focusedItem === item) this.tree.setFocusedItem(null);
  };
  SyncChangesView.prototype.updateRecentChanges = async function () {
    if (this.sync.dataLoaded) await this.loadUsernameMap();
    const multipleUsers = Object.keys(this.userMap).length > 1;
    this.headerDom.navHeaderEl.toggle(multipleUsers);
    if (!multipleUsers) this.hideMyChanges = false;
    this.loadingEl.hide();
    const status = this.sync.getStatus();
    const connected = status !== "uninitialized" && status !== "disconnected";
    this.tree.containerEl.toggle(connected);
    this.uninitializedEl.toggle(!connected);
    const recent = this.getRecentSyncFiles();
    const groups = this.groups;
    groups.today.clear();
    for (const file of recent.today) this.addItemToGroup(file, groups.today);
    groups.today.setFlair(recent.today.length);
    groups.yesterday.clear();
    for (const file of recent.yesterday) this.addItemToGroup(file, groups.yesterday);
    groups.yesterday.setFlair(recent.yesterday.length);
    groups.week.clear();
    for (const file of recent.week) this.addItemToGroup(file, groups.week);
    groups.week.setFlair(recent.week.length);
    groups.older.clear();
    for (let i = 0; i < recent.older.length; i++) {
      const file = recent.older[i];
      if (i < 100) this.addItemToGroup(file, groups.older);
      else this.removeFile(file.path);
    }
    if (recent.older.length > 100) {
      const hidden = recent.older.length - 100;
      const more = new (SE().X9)(this, groups.older, hidden);
      groups.older.addChild(more);
    }
    groups.older.setFlair(recent.older.length);
    if (!this.activeDom) {
      const active = this.app.workspace.getActiveFile();
      if (active) this.onFileOpen(active);
    }
    this.tree.infinityScroll.queueCompute();
    this.previousRefreshDate = window.moment();
  };
  SyncChangesView.prototype.addItemToGroup = function (file, group) {
    let item = this.fileItems[file.path];
    if (!item) {
      item = this.fileItems[file.path] = new (SE().$9)(this, file);
    } else {
      item.sFile = file;
    }
    this.files.set(item.el, file);
    group.addChild(item);
  };
  SyncChangesView.prototype.getRecentSyncFiles = function () {
    const sync = this.sync;
    const hideMine = this.hideMyChanges;
    const buckets = { today: [], yesterday: [], week: [], older: [] };
    const dayMs = 864e5;
    const todayStart = window.moment().startOf("day").valueOf();
    const yesterdayEnd = todayStart - dayMs;
    const weekStart = todayStart - 6 * dayMs;
    for (const file of Object.values(sync.serverFiles)) {
      if (file.folder || file.deleted) continue;
      if (file.path.startsWith(".basalt")) continue;
      if (hideMine && (!file.user || file.user === sync.userId)) continue;
      if (file.mtime > todayStart) buckets.today.push(file);
      else if (file.mtime > yesterdayEnd) buckets.yesterday.push(file);
      else if (file.mtime > weekStart) buckets.week.push(file);
      else buckets.older.push(file);
    }
    const byMtime = (a, b) => b.mtime - a.mtime;
    buckets.today.sort(byMtime);
    buckets.yesterday.sort(byMtime);
    buckets.week.sort(byMtime);
    buckets.older.sort(byMtime);
    return buckets;
  };
  SyncChangesView.prototype.loadUsernameMap = async function () {
    if (this.userMapLoaded) return;
    const status = this.sync.getStatus();
    if (status !== "synced" && status !== "syncing") return;
    this.userMap = await this.sync.getUsernames();
    this.userMapLoaded = true;
  };

  return {
    P9: SyncSettingsView,
    I9: FileHistoryView,
    F9: FileHistoryModal,
    N9: DeletedFilesModal,
    R9: UpgradeEncryptionModal,
    B9: MigrateVaultModal,
    V9: CreateVaultModal,
    H9: RemoteVaultsModal,
    z9: SyncLogModal,
    q9: ExcludedFoldersSuggest,
    j9: LargestFilesModal,
    U9: ConnectVaultModal,
    W9: RenameVaultModal,
    _9: ManageSharingModal,
    K9: SyncChangesView,
  };
}

let syncBuiltHost = null;
function syncClasses() {
  if (!syncBuilt) syncBuilt = buildSyncClasses();
  return syncBuilt;
}

export function defineSyncSettingsView(host) {
  syncBuiltHost = host;
  return syncClasses().P9;
}
export function defineSyncFileHistoryView(host) {
  syncBuiltHost = host;
  return syncClasses().I9;
}
export function defineSyncFileHistoryModal(host) {
  syncBuiltHost = host;
  return syncClasses().F9;
}
export function defineSyncDeletedFilesModal(host) {
  syncBuiltHost = host;
  return syncClasses().N9;
}
export function defineSyncUpgradeEncryptionModal(host) {
  syncBuiltHost = host;
  return syncClasses().R9;
}
export function defineSyncMigrateVaultModal(host) {
  syncBuiltHost = host;
  return syncClasses().B9;
}
export function defineSyncCreateVaultModal(host) {
  syncBuiltHost = host;
  return syncClasses().V9;
}
export function defineSyncRemoteVaultsModal(host) {
  syncBuiltHost = host;
  return syncClasses().H9;
}
export function defineSyncLogModal(host) {
  syncBuiltHost = host;
  return syncClasses().z9;
}
export function defineSyncExcludedFoldersSuggest(host) {
  syncBuiltHost = host;
  return syncClasses().q9;
}
export function defineSyncLargestFilesModal(host) {
  syncBuiltHost = host;
  return syncClasses().j9;
}
export function defineSyncConnectVaultModal(host) {
  syncBuiltHost = host;
  return syncClasses().U9;
}
export function defineSyncRenameVaultModal(host) {
  syncBuiltHost = host;
  return syncClasses().W9;
}
export function defineSyncManageSharingModal(host) {
  syncBuiltHost = host;
  return syncClasses()._9;
}
export function defineSyncChangesView(host) {
  syncBuiltHost = host;
  return syncClasses().K9;
}
