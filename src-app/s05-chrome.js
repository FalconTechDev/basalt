// s05 slice: desktop chrome and mobile drawer pieces.
// - BD: frameless-window titlebar (minimize/maximize/close, zoom factor, macOS
//   traffic-light positioning, fullscreen/maximized body classes)
// - DD: vault profile switcher in the left drawer (FunctionExpression -> factory)
// - _D: mobile left drawer header with vault picker + file/folder counts
// - GD: mobile right drawer header with file name + info renderers
import { env } from "./env.js";
import { s05TitlebarDoubleClick, s05MobileVaultList } from "./s05-utils.js";
import { floatOr } from "./text.js";

const MAXIMIZE_SVG = '<svg aria-hidden="false" width="12" height="12" viewBox="0 0 12 12"><rect width="9" height="9" x="1.5" y="1.5" fill="none" stroke="currentColor"></rect></svg>';
const RESTORE_SVG = '<svg aria-hidden="false" width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 3.5H8.5V10.5H1.5V3.5Z" stroke="currentColor"/> <path d="M4 2H10V8H9V9H11V1H3V3H4V2Z" fill="currentColor"/></svg>';
const MINIMIZE_SVG = '<svg aria-hidden="false" width="12" height="12" viewBox="0 0 12 12"><rect fill="currentColor" width="10" height="1" x="1" y="6"></rect></svg>';
const CLOSE_SVG = '<svg aria-hidden="false" width="12" height="12" viewBox="0 0 12 12"> <path fill="currentColor" fill-rule="evenodd" d="M10.052 10.968 1.03 1.93l.849-.848 9.023 9.037-.849.848Z"/><path fill="currentColor" fill-rule="evenodd" d="M1.023 10.112 10.06 1.09l.848.85-9.037 9.023-.848-.85Z"/></svg>';

// Frameless titlebar injected at the top of the window document.
export function defineTitlebar(host) {
  return class Titlebar {
    constructor(eWin, win) {
      this.requestUpdateStatus = env().debounce(this.updateStatus.bind(this), 50, true);
      this.eWin = eWin;
      this.win = win;
      this.isMac = window.process.platform === "darwin";
      const doc = win.document;
      const body = doc.body;
      body.addClass("is-frameless");
      const bar = this.titleBarEl = doc.createElement("div");
      bar.className = "titlebar";
      body.insertBefore(bar, body.firstChild);
      const inner = this.titleBarInnerEl = bar.createDiv("titlebar-inner");
      this.titleBarTextEl = inner.createDiv({ cls: "titlebar-text", text: "Basalt" });
      win.addEventListener("resize", this.requestUpdateStatus.bind(this));
      let titleEl = doc.head.find("title");
      if (!titleEl) titleEl = doc.head.createEl("title");
      new MutationObserver(this.updateTitle.bind(this)).observe(titleEl, { subtree: true, characterData: true, childList: true });
      this.leftButtonContainerEl = inner.createDiv("titlebar-button-container mod-left");
      const right = inner.createDiv("titlebar-button-container mod-right");
      this.updateStatus();
      this.updateTitle();
      if (!this.isMac) {
        if (eWin.minimizable) {
          const btn = right.createDiv({ cls: "titlebar-button mod-minimize", onclick: () => eWin.minimize() });
          btn.innerHTML = MINIMIZE_SVG;
          Promise.resolve().then(() => host.setTooltip(btn, env().gm.interface.window.minimize()));
        }
        if (eWin.maximizable) {
          const btn = right.createDiv({ cls: "titlebar-button mod-maximize", onclick: () => { eWin.isMaximized() ? eWin.unmaximize() : eWin.maximize(); swapIcon(); } });
          const swapIcon = () => {
            if (win.closed) return;
            if (eWin.isMaximized()) {
              btn.innerHTML = RESTORE_SVG;
              host.setTooltip(btn, env().gm.interface.window.restoreDown());
            } else {
              btn.innerHTML = MAXIMIZE_SVG;
              host.setTooltip(btn, env().gm.interface.window.maximize());
            }
          };
          btn.innerHTML = MAXIMIZE_SVG;
          Promise.resolve().then(() => swapIcon());
          win.addEventListener("resize", swapIcon);
        }
        if (eWin.closable) {
          const btn = right.createDiv({ cls: "titlebar-button mod-close", onclick: () => eWin.close() });
          btn.innerHTML = CLOSE_SVG;
          Promise.resolve().then(() => host.setTooltip(btn, env().gm.interface.window.closeWindow()));
        }
      }
      s05TitlebarDoubleClick(inner);
    }

    updateTitle() {
      this.titleBarTextEl.setText(this.win.document.title);
    }

    updateStatus() {
      const win = this.win;
      const eWin = this.eWin;
      if (win.closed) return;
      const zoom = eWin.webContents.getZoomFactor();
      const body = win.document.body;
      body.toggleClass("is-fullscreen", eWin.isFullScreen());
      body.toggleClass("is-maximized", eWin.isMaximized());
      body.style.setProperty("--zoom-factor", String(zoom));
      if (this.isMac && win.titlebarStyle === "hidden") {
        const offsetX = floatOr(getComputedStyle(body).getPropertyValue("--traffic-lights-offset-x"), 40);
        let offsetY = floatOr(getComputedStyle(body).getPropertyValue("--traffic-lights-offset-y"), 40);
        if (offsetY === 0) offsetY = 40;
        const place = (value) => {
          const pos = Math.floor(value * zoom / 2 - 8);
          return pos < -5 ? 0 : pos;
        };
        const x = place(offsetX) + 2;
        const y = place(offsetY);
        const setPos = eWin.setWindowButtonPosition || eWin.setTrafficLightPosition;
        setPos({ x, y });
      }
    }
  };
}

// Vault profile row at the top of the left drawer: shows the vault name,
// a hover tooltip with file/folder counts and a right-click/left-click menu
// for switching vaults.
export function s05VaultProfile(host) {
  return function VaultProfile(app, containerEl) {
    this.app = app;
    if (!env().Yl.isDesktopApp) return;
    const vaultName = app.vault.getName();
    let basePath = "";
    if (app.vault.adapter instanceof env().Eu) {
      basePath = app.vault.adapter.getBasePath();
    }
    const path = window.require("path");
    containerEl.createDiv("workspace-sidedock-vault-profile", (profile) => {
      profile.createDiv("workspace-drawer-vault-switcher", (row) => {
        row.createDiv("workspace-drawer-vault-switcher-icon", (icon) => env().tv(icon, "lucide-chevrons-up-down"));
        const nameEl = row.createDiv({ cls: "workspace-drawer-vault-name", text: vaultName });
        row.addEventListener("mouseover", () => {
          const vault = app.vault;
          const files = env().gm.nouns.fileWithCount({ count: vault.getRoot().getFileCount() });
          const folders = env().gm.nouns.folderWithCount({ count: vault.getRoot().getFolderCount() });
          const tip = basePath + "\n\n" + files + ", " + folders;
          host.displayTooltip(nameEl, tip, { placement: "top", gap: 24, horizontalParent: row, delay: env().lv });
        });
        row.addEventListener("mouseleave", () => host.hideTooltip());
        row.addEventListener("click", (event) => {
          if (row.hasClass("has-active-menu")) return;
          const current = env().electron.ipcRenderer.sendSync("vault").path;
          const registry = env().electron.ipcRenderer.sendSync("vault-list");
          const menu = env().Ug.forEvent(event);
          const addVault = (key) => {
            if (!Object.hasOwn(registry, key)) return;
            const entry = registry[key];
            const name = path.basename(entry.path);
            const isCurrent = current === entry.path;
            menu.addItem((item) => item.setTitle(name).setChecked(isCurrent).onClick(() => {
              if (isCurrent) return;
              if (window.electron.ipcRenderer.sendSync("vault-open", entry.path, false) !== true) {
                new (env().fb)(env().gm.interface.startScreen.msgErrorFailedToOpenVault());
              }
            }));
          };
          for (const key in registry) addVault(key);
          menu.addSeparator().addItem((item) => item.setTitle(env().gm.interface.manageVaults()).setIcon("open-vault").onClick(() => app.openVaultChooser()))
            .setParentElement(row);
        });
        row.addEventListener("contextmenu", (event) => {
          const menu = env().Ug.forEvent(event);
          menu.addSections(["title", "open", "action", "", "danger"]);
          menu.setParentElement(row)
            .addItem((item) => item.setTitle(env().Yl.isMacOS ? env().gm.plugins.openWithDefaultApp.actionShowInFolderMac() : env().gm.plugins.openWithDefaultApp.actionShowInFolder()).setIcon("lucide-arrow-up-right").onClick(() => app.showInFolder("")))
            .addItem((item) => item.setTitle(env().gm.interface.menu.copyPath()).setIcon("lucide-clipboard").onClick(() => {
              env().Ec(basePath);
              new (env().fb)(env().gm.interface.copied({ context: "generic" }));
            }));
        });
      });
      profile.createDiv({ cls: "workspace-drawer-vault-actions" }, (actions) => {
        actions.createSpan("clickable-icon", (icon) => {
          env().tv(icon, "help");
          icon.addEventListener("click", () => app.openHelp());
        });
        actions.createSpan("clickable-icon", (icon) => {
          env().tv(icon, "lucide-settings");
          icon.addEventListener("click", () => app.setting.open());
        });
      });
    });
  };
}

// Mobile left drawer: vault name + switcher, file/folder counts, settings and
// pin header buttons. Extends the shared mobile drawer base (WD).
export function defineFilesDrawer(host) {
  const Base = env().WD;
  return class FilesDrawer extends Base {
    constructor(app, ...rest) {
      super(app, "left", ...rest);
      this.fileCountEl = null;
      this.requestUpdateInfo = env().debounce(() => this.updateInfo(), 100);
      const vault = this.app.vault;
      this.headerEl.createDiv("workspace-drawer-header-left", (left) => {
        left.createDiv({ cls: "workspace-drawer-header-name" }, (nameBox) => {
          nameBox.createEl("label", "workspace-drawer-header-switcher", (label) => {
            label.createSpan({ cls: "workspace-drawer-header-name-text", text: vault.getName() });
            label.createSpan("workspace-drawer-header-name-chevron", (chevron) => env().tv(chevron, "lucide-chevron-down"));
            const select = label.createEl("select", "", (selectEl) => (async () => {
              const manage = selectEl.createEl("option", { text: env().gm.interface.manageVaults(), value: "manage-vaults" });
              const selected = localStorage.getItem("mobile-selected-vault");
              const vaults = await s05MobileVaultList();
              for (const vaultInfo of vaults) {
                let name = vaultInfo.name;
                if (vaultInfo.storageType === "iCloud") name += " (iCloud)";
                const option = selectEl.createEl("option", { text: name, value: vaultInfo.location });
                if (selected === vaultInfo.location) option.selected = true;
              }
              selectEl.appendChild(manage);
            })());
            select.addEventListener("change", () => {
              const value = select.value;
              if (value === "manage-vaults") {
                this.app.openVaultChooser();
              } else {
                window.localStorage.setItem("mobile-selected-vault", value);
                location.reload();
              }
            });
          });
        });
        left.createDiv("workspace-drawer-header-info", (info) => {
          this.fileCountEl = info.createDiv();
          this.updateInfo();
        });
      });
      this.addHeaderButton("lucide-settings", () => this.app.setting.open()).addClass("mod-settings");
      this.pinIconEl = this.addHeaderButton("pin", () => this.togglePinned());
      this.pinIconEl.addClass("mod-pin");
      this.containerEl.addClass("mod-left");
      this.component.registerEvent(vault.on("create", this.requestUpdateInfo));
      this.component.registerEvent(vault.on("delete", this.requestUpdateInfo));
    }

    updateInfo() {
      const vault = this.app.vault;
      const files = env().gm.nouns.fileWithCount({ count: vault.getRoot().getFileCount() });
      const folders = env().gm.nouns.folderWithCount({ count: vault.getRoot().getFolderCount() });
      this.fileCountEl.setText(files + ", " + folders);
    }
  };
}

// Mobile right drawer: current file name plus plugin-supplied info renderers.
export function defineInfoDrawer(host) {
  const Base = env().WD;
  return class InfoDrawer extends Base {
    constructor(app, third) {
      super(app, "right", third);
      this.fileNameEl = null;
      this.fileInfoElToRenderer = [];
      const header = this.headerEl;
      const infos = app.mobileFileInfos;
      header.createDiv("workspace-drawer-header-left", (left) => {
        left.createDiv({ cls: "workspace-drawer-header-name" }, (nameBox) => {
          this.fileNameEl = nameBox.createDiv({ cls: "workspace-drawer-header-name-text", text: env().gm.interface.noFile() });
        });
        left.createDiv("workspace-drawer-header-info", (info) => {
          for (const renderer of infos) {
            const el = info.createDiv("workspace-drawer-header-info-item");
            this.fileInfoElToRenderer.push({ el, renderer: renderer.renderCallback });
          }
        });
      });
      this.containerEl.addClass("mod-right");
      this.component.registerEvent(this.app.vault.on("rename", (file) => {
        if (file instanceof env().$T) {
          const active = this.app.workspace.getActiveFile();
          if (file === active) this.updateName(active);
        }
      }));
      this.component.registerEvent(app.on("quick-preview", this.onQuickPreview, this));
      this.component.registerEvent(app.on("file-open", this.onFileOpen, this));
      this.pinIconEl = this.addHeaderButton("pin", () => this.togglePinned());
      this.pinIconEl.addClass("mod-pin");
    }

    onFileOpen(file) {
      this.updateName(file);
      this.updateInfo();
    }

    onQuickPreview(file) {
      if (this.app.workspace.getActiveFile() === file) this.updateInfo();
    }

    updateName(file) {
      const name = file ? file.getShortName() : env().gm.interface.noFile();
      this.fileNameEl.setText(name);
    }

    updateInfo() {
      for (const entry of this.fileInfoElToRenderer) {
        entry.renderer(entry.el);
      }
    }
  };
}
