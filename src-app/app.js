// App (Tte) controller methods, ported incrementally via the manifest "methods" mechanism.
// `this` is the app instance; bundle-scope names arrive through env().
import { env } from "./env.js";


export function appNextFrame(callback) {
  if (!this.nextFrameTimer) {
    this.nextFrameTimer = window.requestAnimationFrame(this.onNextFrame.bind(this));
  }
  this.nextFrameEvents.push(callback);
}

export function appOnNextFrame(timestamp) {
  this.nextFrameTimer = null;
  const events = this.nextFrameEvents;
  this.nextFrameEvents = [];
  for (let i = 0; i < events.length; i++) events[i](timestamp);
}

export function appNextFrameOnceCallback(callback) {
  const self = this;
  let done = false;
  return function () {
    if (done) return;
    done = true;
    self.nextFrame((timestamp) => {
      done = false;
      callback(timestamp);
    });
  };
}

export function appDisableCssTransition() {
  this.dom.appContainerEl.addClass("no-transition");
}

export function appEnableCssTransition() {
  this.dom.appContainerEl.removeClass("no-transition");
}

export function appGetAppTitle(suffix) {
  return suffix ? suffix + " - " + this.title : this.title;
}

export function appGetWebviewPartition() {
  return "persist:vault-" + this.appId;
}

export function appFixFileLinks(element, sourcePath) {
  const { Yl, YC, JC, ZC } = env();
  const nodes = element.findAll("img, audio, video, source, iframe");
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    let src = node.getAttr("src");
    if (!src) continue;
    if (Yl.isDesktopApp && src.startsWith("file:///")) {
      node.src = Yl.resourcePathPrefix + src.substring(8);
    }
    if (YC(src) && (node.tagName === "IMG" || node.tagName === "AUDIO" || node.tagName === "VIDEO" || node.tagName === "SOURCE")) {
      src = JC(ZC(src));
      const file = this.metadataCache.getFirstLinkpathDest(src, sourcePath);
      if (file) node.src = this.vault.getResourcePath(file);
    }
  }
}

export function appGetTheme() {
  return this.customCss.isDarkMode() ? "basalt" : "moonstone";
}

export function appIsDarkMode() {
  return this.customCss.isDarkMode();
}

export function appChangeTheme(theme) {
  if (!theme) return;
  const self = this;
  this.disableCssTransition();
  this.vault.setConfig("theme", theme);
  setTimeout(() => self.enableCssTransition(), 200);
}

export function appUpdateTheme() {
  const { Yl } = env();
  const config = this.vault.getConfig("theme");
  let dark = config === "basalt";
  if (config === "system") {
    dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (Yl.isDesktopApp && !Yl.isMacOS && !Yl.isWin) {
      dark = window.electron.remote.nativeTheme.shouldUseDarkColors;
    }
  }
  const body = document.body;
  let changed = false;
  if (body.hasClass("theme-light") !== !dark) {
    body.toggleClass("theme-light", !dark);
    changed = true;
  }
  if (body.hasClass("theme-dark") !== dark) {
    body.toggleClass("theme-dark", dark);
    changed = true;
  }
  if (changed) this.workspace.trigger("css-change");
  this.updateMobileFrameTheme(dark);
}

export function appUpdateMobileFrameTheme(dark) {
  const { Yl, Pm, T, Bk, Ak, Fk, Im, S, Lv } = env();
  const isSystem = this.vault.getConfig("theme") === "system";
  if (Yl.isMobileApp) {
    Pm.setStyle({ style: dark ? T.Dark : T.Light });
    if (Yl.isAndroidApp) {
      let color = Bk("--system-status-background");
      if (!color || color.a === 0) color = Ak(getComputedStyle(document.body).backgroundColor);
      const value = color ? Fk(color) : dark ? "#161616" : "#f2f3f5";
      Pm.setBackgroundColor({ color: value });
    } else if (Yl.isIosApp) {
      Im.setStyle({ style: isSystem ? S.Default : dark ? S.Dark : S.Light });
      if (!isSystem) Lv();
    }
  }
}

export function appUpdateInlineTitleDisplay() {
  document.body.toggleClass("show-inline-title", this.vault.getConfig("showInlineTitle"));
}

export function appUpdateFloatingNavigationDisplay() {
  const enabled = this.vault.getConfig("floatingNavigation");
  document.body.toggleClass("is-floating-nav", enabled);
}

export function appUpdateAutoFullScreenDisplay() {
  document.body.toggleClass("auto-full-screen", this.vault.getConfig("autoFullScreen"));
}

export function appUpdateViewHeaderDisplay() {
  document.body.toggleClass("show-view-header", this.vault.getConfig("showViewHeader"));
}

export function appUpdateRibbonDisplay() {
  document.body.toggleClass("show-ribbon", this.vault.getConfig("showRibbon"));
}

export function appUpdateFontFamily() {
  const { Ree, Bee } = env();
  const interfaceFont = Ree(this.vault.getConfig("interfaceFontFamily"));
  document.body.style.setProperty("--font-interface-override", Bee(interfaceFont));
  const textFont = Ree(this.vault.getConfig("textFontFamily"));
  document.body.style.setProperty("--font-text-override", Bee(textFont));
  if (textFont) {
    document.body.style.setProperty("--font-print-override", Bee(textFont));
  } else {
    document.body.style.removeProperty("--font-print-override");
  }
  const monoFont = Ree(this.vault.getConfig("monospaceFontFamily"));
  document.body.style.setProperty("--font-monospace-override", Bee(monoFont));
  this.workspace.trigger("css-change");
}

export function appUpdateFontSize() {
  let size = this.vault.getConfig("baseFontSize");
  size = Math.clamp(size, 10, 30);
  document.body.style.setProperty("--font-text-size", size + "px");
  document.documentElement.style.setProperty("font-size", size + "px");
  this.workspace.trigger("css-change");
}

export function appUpdateUseNativeMenu() {
  const { Yl, Ug } = env();
  let enabled = this.vault.getConfig("nativeMenus");
  if (Yl.isMacOS && enabled === null) enabled = true;
  Ug.useNativeMenu = enabled;
}

export function appUpdateTabSize() {
  const size = this.vault.getConfig("tabSize");
  document.body.style.setProperty("--indent-size", String(size));
}

export function appShowReleaseNotes(version) {
  this.workspace.getLeaf(true).setViewState({ type: env().s0, active: true, state: { currentVersion: version } });
}

export function appUpdateAccentColor() {
  const color = this.vault.getConfig("accentColor");
  this.setAccentColor(color);
}

export function appGetAccentColor() {
  const { Fk, Lk } = env();
  const configured = this.vault.getConfig("accentColor");
  const body = document.body;
  if (!configured) {
    const style = getComputedStyle(body);
    const h = style.getPropertyValue("--accent-h");
    const s = style.getPropertyValue("--accent-s");
    const l = style.getPropertyValue("--accent-l");
    return Fk(Lk({
      h: parseInt(h.endsWith("%") ? h.slice(0, -1) : h),
      s: parseInt(s.endsWith("%") ? s.slice(0, -1) : s),
      l: parseInt(l.endsWith("%") ? l.slice(0, -1) : l),
    }));
  }
  return configured;
}

export function appSetAccentColor(color) {
  const { Nk, Ik, Hk } = env();
  const body = document.body;
  if (!color) {
    body.style.removeProperty("--text-on-accent");
    body.style.removeProperty("--accent-h");
    body.style.removeProperty("--accent-s");
    body.style.removeProperty("--accent-l");
    return;
  }
  const parsed = Nk(color);
  if (!parsed) {
    body.style.removeProperty("--text-on-accent");
    body.style.removeProperty("--accent-h");
    body.style.removeProperty("--accent-s");
    body.style.removeProperty("--accent-l");
    return;
  }
  const { h, s, l } = Ik(parsed);
  body.style.setProperty("--accent-h", String(h));
  body.style.setProperty("--accent-s", s + "%");
  body.style.setProperty("--accent-l", l + "%");
  if (Hk(parsed)) {
    body.style.setProperty("--text-on-accent", "var(--text-on-accent-inverted)");
  } else {
    body.style.removeProperty("--text-on-accent");
  }
}

export function appGarbleText() {
  this.dom.appContainerEl.addClass("is-text-garbled");
}

export async function appSaveAttachment(name, extension, data) {
  const activeFile = this.workspace.getActiveFile();
  const path = await this.vault.getAvailablePathForAttachments(name, extension, activeFile);
  return await this.vault.createBinary(path, data);
}

export function appOpenVaultChooser(closeAfter) {
  const { Yl, Of } = env();
  if (Yl.isDesktopApp) {
    Of((electron) => electron.ipcRenderer.sendSync("starter"));
    if (closeAfter) window.close();
  } else if (Yl.isMobileApp) {
    localStorage.removeItem("mobile-selected-vault");
    setTimeout(() => location.reload(), 500);
  }
}

export function appOpenHelp() {
  const { Yl, Of } = env();
  if (Yl.isDesktopApp) {
    Of((electron) => electron.ipcRenderer.sendSync("help"));
  } else {
    window.open("https://github.com/FalconTechDev/basalt/wiki", "_blank");
  }
}

export async function appRunOpeningBehavior(behavior) {
  const { W6, $T } = env();
  const workspace = this.workspace;
  const fileManager = this.fileManager;
  const vault = this.vault;
  if (behavior === "new") {
    const view = workspace.getActiveViewOfType(W6);
    if (view && env().bI(view.getViewData()).content.trim() === "") {
      // already on an empty editor
    } else {
      await fileManager.createAndOpenMarkdownFile("");
    }
    return;
  }
  if (behavior === "daily") {
    const plugin = this.internalPlugins.getEnabledPluginById("daily-notes");
    if (plugin) {
      const note = await plugin.getDailyNote();
      if (note instanceof $T) await workspace.getLeaf().openFile(note);
    }
    return;
  }
  if (behavior.startsWith("file:")) {
    let path = env().cu(behavior.substring(5));
    if (env().su(path) === "") path += ".md";
    const file = vault.getAbstractFileByPathInsensitive(path);
    if (file instanceof $T) await workspace.getLeaf().openFile(file);
  }
}

export async function appOpenWithDefaultApp(file) {
  const { Yl, Eu, vk, Em, fb, gm } = env();
  const adapter = this.vault.adapter;
  if (Yl.isDesktopApp && adapter instanceof Eu) {
    const fullPath = adapter.getFilePath(file);
    window.open(fullPath, "_external");
  }
  if (Yl.isMobileApp && Em && adapter instanceof vk) {
    try {
      await adapter.open(file);
    } catch (error) {
      new fb(error.message || gm.interface.msgFailedToLoadFile({ filepath: file }));
    }
  }
}

export async function appShowInFolder(file) {
  const { Yl, Eu, Yf, fb, gm } = env();
  if (!Yl.isDesktopApp) return;
  const adapter = this.vault.adapter;
  if (!(adapter instanceof Eu)) return;
  const fullPath = adapter.getFullPath(file);
  if (await adapter.exists(file)) {
    Yf(fullPath);
  } else {
    new fb(gm.dialogue.msgFileOrFolderNotFound({ path: fullPath }));
  }
}

export function appGetObsidianUrl(file) {
  const { pu } = env();
  const vaultName = this.vault.getName();
  const path = pu(file.path);
  return "obsidian://open?vault=" + encodeURIComponent(vaultName) + "&file=" + encodeURIComponent(path);
}

export function appCopyObsidianUrl(file) {
  const { Ec, fb, gm } = env();
  Ec(this.getObsidianUrl(file));
  new fb(gm.interface.copied({ item: "URL" }));
}

export function appRegisterQuitHook() {
  const self = this;
  window.onbeforeunload = function (event) {
    window.onbeforeunload = null;
    const workspace = self.workspace;
    if (!workspace) return;
    workspace.requestSaveLayout.run();
    const blocker = new (env().Eb)();
    self.workspace.trigger("quit", blocker);
    if (blocker.isEmpty()) return;
    event.preventDefault();
    event.returnValue = "Saving...";
    env().pD.instance.show().setMessage("Saving...");
    (async () => {
      await blocker.promise();
      window.close();
    })();
  };
}

export function appLoadLocalStorage(key) {
  try {
    const value = localStorage.getItem(this.appId + "-" + key);
    if (value) return JSON.parse(value);
  } catch (error) {}
  return null;
}

export function appSaveLocalStorage(key, value) {
  try {
    if (value) localStorage.setItem(this.appId + "-" + key, JSON.stringify(value));
    else localStorage.removeItem(this.appId + "-" + key);
  } catch (error) {}
}

export function appOn() {}

export function appSetTheme() {
  const self = this;
  setTimeout(() => self.updateTheme());
}

export function appEmulateMobile(enabled) {
  if (enabled) localStorage["EmulateMobile"] = 1;
  else delete localStorage["EmulateMobile"];
  window.location.reload();
}

export function appDebugMode(enabled) {
  if (enabled) this.saveLocalStorage("DebugMode", "1");
  else {
    this.saveLocalStorage("DebugMode", null);
    localStorage.removeItem("DebugMode");
  }
  window.location.reload();
}

export function appGetSpellcheckLanguages() {
  let languages = this.vault.getConfig("spellcheckLanguages");
  const stored = localStorage.getItem("spellcheck-languages");
  if (stored && languages) this.vault.setConfig("spellcheckLanguages", null);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) languages = parsed;
    } catch (error) {}
  } else {
    localStorage.setItem("spellcheck-languages", JSON.stringify(languages));
  }
  return languages;
}

export function appSetSpellcheckLanguages(languages) {
  const { Kf, Yl } = env();
  if (this.vault.getConfig("spellcheckLanguages")) this.vault.setConfig("spellcheckLanguages", null);
  if (languages && languages.length > 0) {
    localStorage.setItem("spellcheck-languages", JSON.stringify(languages));
  } else {
    localStorage.removeItem("spellcheck-languages");
  }
  if (Yl.isDesktopApp) Kf(languages);
}

export function appIsVimEnabled() {
  const { Yl } = env();
  if (Yl.isMobile) return !!localStorage.getItem("vim");
  return this.vault.getConfig("vimMode");
}

export function appOnConfigChanged(key) {
  switch (key) {
    case "accentColor":
      this.updateAccentColor();
      break;
    case "theme":
      this.updateTheme();
      break;
    case "cssTheme":
      this.customCss.reloadTheme();
      break;
    case "interfaceFontFamily":
    case "textFontFamily":
    case "monospaceFontFamily":
      this.updateFontFamily();
      break;
    case "baseFontSize":
      this.updateFontSize();
      break;
    case "showInlineTitle":
      this.updateInlineTitleDisplay();
      break;
    case "floatingNavigation":
      this.updateFloatingNavigationDisplay();
      break;
    case "autoFullScreen":
      this.updateAutoFullScreenDisplay();
      break;
    case "showViewHeader":
      this.updateViewHeaderDisplay();
      break;
    case "showRibbon":
      this.updateRibbonDisplay();
      this.workspace.updateFrameless();
      break;
    case "nativeMenus":
      this.updateUseNativeMenu();
      break;
    case "mobileQuickRibbonItem":
      this.mobileNavbar.updateRibbonMenuItem();
      break;
    case "tabSize":
      this.updateTabSize();
  }
}

export async function appImportAttachments(files, parent) {
  if (files.length === 0) return [];
  const vault = this.vault;
  const imported = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    let name = file.name;
    const extension = file.extension;
    const filepath = file.filepath;
    const data = file.data;
    let target;
    if (filepath && (target = vault.resolveFilePath(filepath))) {
      imported.push(target);
      continue;
    }
    const content = await data;
    if (!content) continue;
    if (name === "Pasted image") name += " " + window.moment().format("YYYYMMDDHHmmss");
    if (parent) {
      const path = vault.getAvailablePath(parent.getParentPrefix() + name, extension);
      target = await vault.createBinary(path, content);
    } else {
      target = await this.saveAttachment(name, extension, content);
    }
    imported.push(target);
  }
  return imported;
}

export async function appInitializeWithAdapter(adapter) {
  const E = env();
  const {
    Yl, JT, H0, mI, Nee, _L, RL, vte, Q6, o2, $0, $g, J6, X6, Z6, e4,
    jD, W6, $T, tv, Am, pD, cD, Bm, su, cu, bI, ou, yte, zf, gy, fy, nb,
    I7, kP, CP, Xw, lD, sD, aD, hD, xm, gm, fb, Of, electron, createDiv,
    createFragment, P8, dJ, g9, bJ, V6, i8, r7, dee, q8, k7, f7, v8, wee,
    Z8, u8, k9, b8, l3, U8, See, w9, p7, Pee, S9, a4, Iee, O8, f9, uee,
    Z4, M2, eD, nD, tD,
  } = E;
  const self = this;
  const vault = (this.vault = new JT(adapter));
  if (Yl.isDesktopApp) {
    try {
      await vault.readRaw("");
    } catch (error) {
      if (error.code === "ENOENT") {
        this.vault = null;
        this.openVaultChooser(true);
        return;
      }
    }
  }
  vault.on("closed", () => self.openVaultChooser(true));
  vault.on("config-changed", this.onConfigChanged.bind(this));
  const overrideDir = E.Tte.getOverrideConfigDir(this.appId);
  if (overrideDir) vault.setConfigDir(overrideDir);
  Bm(this, overrideDir);
  await vault.setupConfig();
  cD("vault.setup");
  this.disableCssTransition();
  const workspace = (this.workspace = new H0(this, this.dom.workspaceEl));
  this.fileManager = new mI(this);
  this.statusBar = new Nee(this, this.dom.statusBarEl);
  this.metadataCache = new _L(this, vault);
  this.metadataTypeManager = new RL(this);
  this.setting = new vte(this);
  this.foldManager = new Q6(this);
  const internalPlugins = (this.internalPlugins = new o2(this));
  const communityPlugins = (this.plugins = new $0(this));
  cD("workspace.components");
  const onSchemeChange = () => {
    if (vault.getConfig("theme") === "system") self.updateTheme();
  };
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onSchemeChange);
  if (Yl.isDesktopApp) {
    window.electron.remote.nativeTheme.removeAllListeners("updated").on("updated", onSchemeChange);
  }
  this.updateAccentColor();
  this.updateTheme();
  this.updateFontFamily();
  this.updateFontSize();
  this.updateTabSize();
  const cssPromise = this.customCss.load();
  this.updateInlineTitleDisplay();
  this.updateFloatingNavigationDisplay();
  this.updateAutoFullScreenDisplay();
  this.updateRibbonDisplay();
  this.updateViewHeaderDisplay();
  this.updateUseNativeMenu();
  cD("workspace.appearance");
  if (Yl.isDesktopApp) this.appMenuBarManager = new $g(this);
  if (Yl.isMobile) {
    this.mobileToolbar = new J6(this);
    this.mobileNavbar = new X6(this);
    this.mobileTabSwitcher = new Z6(this);
    this.mobileQuickActions = new e4();
    this.mobileQuickActions.registerQuickAction("close-vault", {
      iconName: "arrow.up.arrow.down",
      title: gm.interface.manageVaults(),
      callback: () => self.openVaultChooser(),
    });
  }
  this.shareReceiver.setupWorkspace();
  await this.metadataTypeManager.load();
  await this.secretStorage.load();
  await this.hotkeyManager.load();
  this.registerCommands();
  cD("workspace.components");
  pD.instance.setMessage(gm.interface.startUp.loadingPlugins());
  internalPlugins.loadPlugin(new P8());
  internalPlugins.loadPlugin(new dJ());
  internalPlugins.loadPlugin(new g9());
  internalPlugins.loadPlugin(new bJ());
  internalPlugins.loadPlugin(new V6());
  internalPlugins.loadPlugin(new i8());
  internalPlugins.loadPlugin(new r7());
  internalPlugins.loadPlugin(new dee());
  internalPlugins.loadPlugin(new q8());
  internalPlugins.loadPlugin(new k7());
  internalPlugins.loadPlugin(new f7());
  internalPlugins.loadPlugin(new v8());
  internalPlugins.loadPlugin(new wee());
  internalPlugins.loadPlugin(new Z8());
  internalPlugins.loadPlugin(new u8());
  internalPlugins.loadPlugin(new k9());
  internalPlugins.loadPlugin(new b8());
  internalPlugins.loadPlugin(new l3());
  internalPlugins.loadPlugin(new U8());
  internalPlugins.loadPlugin(new See());
  internalPlugins.loadPlugin(new w9());
  internalPlugins.loadPlugin(new p7());
  internalPlugins.loadPlugin(new Pee());
  internalPlugins.loadPlugin(new S9());
  internalPlugins.loadPlugin(new a4());
  internalPlugins.loadPlugin(new Iee());
  internalPlugins.loadPlugin(new O8());
  internalPlugins.loadPlugin(new f9());
  internalPlugins.loadPlugin(new uee());
  internalPlugins.loadPlugin(new Z4());
  if (Yl.isDesktopApp) internalPlugins.loadPlugin(new M2());
  await internalPlugins.enable();
  cD("corePlugins");
  let openBehavior = vault.getConfig("openBehavior");
  if (window.OBS_ACT) openBehavior = "";
  let earlyEditor = null;
  let fakeWorkspaceEl = null;
  if (Yl.isMobileApp && Yl.isPhone) {
    const data = await workspace.readWorkspaceFile();
    let leafCount = 0;
    let activeFile = "";
    const scan = (node) => {
      if (!node) return;
      if (node.type === "leaf") {
        leafCount++;
        if (node.id === data.active) {
          activeFile = node.state?.state?.file;
        }
        return;
      }
      if (node.children && node.children.length > 0) {
        for (let i = 0; i < node.children.length; i++) scan(node.children[i]);
      }
    };
    try {
      scan(data.main);
    } catch (error) {
      console.error(error);
    }
    try {
      let targetPath = "";
      let templateLoader;
      if (openBehavior === "new") {
        const isEmptyActive = activeFile && String.isString(activeFile) && su(activeFile) === "md"
          ? await (async () => {
              if (!(await adapter.exists(activeFile))) return false;
              return bI(await adapter.read(activeFile)).content.trim() === "";
            })()
          : false;
        if (isEmptyActive) {
          openBehavior = "";
        } else {
          let untitled = "";
          let folder = "";
          if (vault.getConfig("newFileLocation") === "folder") {
            folder = vault.getConfig("newFileFolderPath");
          }
          untitled = gm.plugins.fileExplorer.labelUntitledFile();
          if (await adapter.exists(cu(folder + "/" + untitled + ".md"))) {
            const existing = await adapter.list(folder);
            const names = new Set(existing.files.map((f) => f.toLowerCase()).filter((f) => f.startsWith(untitled.toLowerCase())));
            for (let i = 1; i < 500; i++) {
              const candidate = untitled + " " + i;
              if (!names.has(candidate.toLowerCase() + ".md")) {
                untitled = candidate;
                break;
              }
            }
          }
          targetPath = cu(folder + "/" + untitled + ".md");
        }
      } else if (openBehavior === "daily") {
        const plugin = this.internalPlugins.getEnabledPluginById("daily-notes");
        if (plugin) {
          targetPath = await plugin.getDailyNotePathBeforeAppLoads();
          templateLoader = () => plugin.getDailyNoteTemplateBeforeAppLoads(ou(targetPath));
        }
      } else if (openBehavior.startsWith("file:")) {
        targetPath = cu(openBehavior.substring(5));
        if (su(targetPath) === "") targetPath += ".md";
      }
      if (targetPath) {
        if (!(await adapter.exists(targetPath))) {
          const write = adapter.write;
          const content = templateLoader ? await templateLoader() : "";
          await write.call(adapter, targetPath, content);
        }
        activeFile = targetPath;
        openBehavior = "file:" + targetPath;
      }
      const isMarkdown = activeFile && String.isString(activeFile) && su(activeFile) === "md" && await adapter.exists(activeFile);
      if (isMarkdown) {
        try {
          const width = workspace.containerEl.offsetWidth;
          const height = workspace.containerEl.offsetHeight;
          const top = workspace.containerEl.offsetTop;
          if (leafCount < 1) leafCount = 1;
          this.mobileNavbar.tabButtonEl.setText(String(leafCount));
          const leaf = new jD(this);
          earlyEditor = new W6(leaf);
          await leaf.open(earlyEditor);
          await earlyEditor.loadFile(new $T(vault, activeFile));
          const spinner = tv(createDiv("loader-spinner view-action clickable-icon mod-raised"), "loader-2");
          earlyEditor.leftSidebarToggleEl.replaceWith(spinner);
          fakeWorkspaceEl = this.dom.horizontalMainContainerEl.createDiv("workspace");
          fakeWorkspaceEl.setCssStyles({
            position: "absolute",
            width: width + "px",
            height: height + "px",
            top: top + "px",
          });
          fakeWorkspaceEl
            .createDiv("workspace-split mod-vertical mod-root mod-visible")
            .createDiv("workspace-tabs mod-active mod-visible mod-top")
            .createDiv("workspace-tab-container")
            .createDiv("workspace-leaf mod-active")
            .appendChild(earlyEditor.containerEl);
          this.dom.appContainerEl.addClass("mod-loading");
          await cssPromise;
          pD.instance.hide();
          window.nextFrame().then(() => Am?.hide({ fadeOutDuration: 0 }));
        } catch (error) {
          console.error(error);
        }
      }
    } catch (error) {
      console.error(error);
    }
  }
  await communityPlugins.initialize();
  pD.instance.setMessage(gm.interface.startUp.loadingVault());
  try {
    this.metadataCache.preload();
    await this.vault.load();
  } catch (error) {
    new fb(gm.interface.startUp.msgFailedToLoadVault() + (error.message ? error.message : ""));
    console.error(error);
    throw error;
  }
  this.hotkeyManager.registerListeners();
  this.metadataTypeManager.registerListeners();
  pD.instance.setMessage(gm.interface.startUp.loadingCache());
  await this.metadataCache.initialize();
  cD("vault");
  pD.instance.setMessage(gm.interface.startUp.loadingWorkspace());
  await workspace.loadLayout();
  await this.runOpeningBehavior(openBehavior);
  this.mobileQuickActions?.load();
  if (earlyEditor) {
    try {
      await earlyEditor.save();
      const activeView = workspace.getActiveViewOfType(W6);
      if (activeView?.file?.path === earlyEditor.file?.path) {
        if (Yl.mobileSoftKeyboardVisible) {
          const cursor = earlyEditor.editor.getCursor();
          activeView.editor.setCursor(cursor);
          activeView.editor.focus();
        }
        const scroll = earlyEditor.currentMode.getScroll();
        if (scroll) activeView.currentMode.applyScroll(scroll);
      }
      earlyEditor.close();
    } catch (error) {
      console.error(error);
    }
  }
  if (fakeWorkspaceEl) fakeWorkspaceEl.detach();
  this.dom.appContainerEl.removeClass("mod-loading");
  cD("workspace.layout");
  setTimeout(() => self.enableCssTransition(), 500);
  workspace.registerUriHook();
  this.cli.init();
  this.registerQuitHook();
  this.metadataCache.showIndexingNotice();
  this.shareReceiver.setupNative();
  if (Yl.isMobileApp && xm) {
    let pausedAt = 0;
    xm.addListener("pause", () => {
      pausedAt = Date.now();
    });
    xm.addListener("resume", () => {
      if (pausedAt && Date.now() - pausedAt > 900000) {
        self.runOpeningBehavior(self.vault.getConfig("openBehavior"));
      }
      pausedAt = 0;
    });
  }
  if (Yl.isDesktopApp && electron) {
    let updateShown = false;
    const showUpdateNotice = () => {
      if (updateShown) return;
      updateShown = true;
      new fb(
        createFragment((el) => {
          el.createEl("b", { text: gm.interface.labelUpdateAvailable() });
          el.createEl("p", { text: gm.setting.about.labelManualUpdateRequired() });
        }),
        0
      ).addButton(gm.dialogue.buttonDownload(), () => window.open(fy()));
    };
    if (gy(zf, yte) && !electron.ipcRenderer.sendSync("disable-update")) {
      showUpdateNotice();
    } else {
      const check = () => {
        Of((e) => {
          if (e.ipcRenderer.sendSync("update") === "update-manual-required") {
            clearInterval(interval);
            showUpdateNotice();
          }
        });
      };
      const interval = setInterval(check, 3600000);
      check();
    }
  }
  const installed = localStorage.getItem("most-recently-installed-version") ?? Yl.version;
  if (gy(installed, gte)) {
    this.showReleaseNotes();
    localStorage.setItem("most-recently-installed-version", gte);
  }
  if (Yl.isDesktopApp && electron) {
    window.addEventListener(
      "drop",
      (event) => {
        const dataTransfer = event.dataTransfer;
        if (kP(dataTransfer)) {
          const items = CP(dataTransfer, "drop", false);
          if (items.length !== 1) return false;
          const item = items[0];
          if (item.extension === "asar" && item.name.match(/^basalt-\d+\.\d+\.\d+/)) {
            event.preventDefault();
            const version = /^(basalt-(\d+\.\d+\.\d+))/.exec(item.name)[1];
            if (gte === version || gy(gte, version)) {
              new nb(this)
                .setTitle("Install Basalt " + version + "?")
                .setContent("This build is potentially experimental. Ensure your vault data is backed up.")
                .addButton("mod-cta", "Install", () => {
                  if (electron.ipcRenderer.sendSync("copy-asar", item.filepath)) {
                    electron.ipcRenderer.sendSync("relaunch");
                  }
                })
                .addCancelButton()
                .open();
            } else {
              new nb(this)
                .setTitle("Unable to install Basalt " + version)
                .setContent("The build is older than the currently installed version of Basalt (" + gte + ").")
                .addButton("mod-cancel", "Okay", () => {})
                .open();
            }
          }
        }
      },
      { capture: true }
    );
  }
  cD("workspace.extra");
  window.setTimeout(() => {
    try {
      const sync = self.internalPlugins.getPluginById("sync");
      if (sync && !sync.enabled) {
        const request = indexedDB.deleteDatabase(self.appId + "-sync");
        Xw(request).then(() => {});
      }
    } catch (error) {
      console.error("Failed to clean-up Sync DB", error);
    }
  }, 30000);
  // startup performance instrumentation
  lD.duration = performance.now();
  let totalViews = 0;
  let deferredViews = 0;
  workspace.iterateAllLeaves((leaf) => {
    totalViews++;
    if (leaf.view instanceof eD || leaf.view instanceof tD || leaf.view instanceof nD) deferredViews++;
  });
  sD.views = totalViews;
  sD.deferredViews = deferredViews;
  aD.sort((a, b) => a.ts - b.ts);
  let lastTs = 0;
  for (let i = 0; i < aD.length; i++) {
    const entry = aD[i];
    const delta = entry.ts - lastTs;
    lastTs = entry.ts;
    let node = lD;
    const parts = entry.key.split(".");
    for (let j = 0; j < parts.length; j++) {
      const part = parts[j];
      if (!node.children[part]) node.children[part] = { key: part, children: {}, duration: 0 };
      node = node.children[part];
      node.duration += delta;
    }
  }
  aD.length = 0;
  if (this.loadLocalStorage("slow-startup-check") && hD() > 8000) {
    new fb(gm.interface.msgSlowBoot()).addButton(gm.dialogue.buttonView(), () => {
      const modal = new I7(this);
      modal.shouldAnimate = false;
      modal.open();
    });
  }
}

export function appRegisterCommands() {
  const E = env();
  const {
    Yl, gm, Fb, activeWindow, electron, xD, TD, Ob, m0, g0, au, JI, jy, kI,
    eO, W6, U6, jl, RV, iZ, CZ, $I, rP, OA, IA, pe, nu, Gz, Ug, WD,
  } = E;
  const app = this;
  const commands = this.commands;
  commands.addCommand({
    id: "app:go-back",
    name: gm.commands.navigateBack(),
    icon: "lucide-arrow-left",
    checkCallback: function (checking) {
      const leaf = app.workspace.activeLeaf;
      if (leaf && leaf.view.navigation) {
        if (!checking) leaf.history.back();
        return true;
      }
      return false;
    },
    hotkeys: [Fb(["Mod", "Alt"], "ArrowLeft")],
  });
  commands.addCommand({
    id: "app:go-forward",
    name: gm.commands.navigateForward(),
    icon: "lucide-arrow-right",
    checkCallback: function (checking) {
      const leaf = app.workspace.activeLeaf;
      if (leaf && leaf.view.navigation) {
        if (!checking) leaf.history.forward();
        return true;
      }
      return false;
    },
    hotkeys: [Fb(["Mod", "Alt"], "ArrowRight")],
  });
  commands.addCommand({
    id: "app:open-vault",
    name: gm.commands.manageVaults(),
    icon: "vault",
    callback: this.openVaultChooser.bind(this),
  });
  commands.addCommand({
    id: "app:switch-vault",
    name: gm.commands.changeVault(),
    icon: "vault",
    callback: function () {
      if (Yl.isDesktopApp) new xD(app).open();
      else if (Yl.isMobileApp) new TD(app).open();
    },
  });
  if (Yl.isDesktopApp) {
    commands.addCommand({
      id: "app:open-another-vault",
      name: gm.commands.openVault(),
      icon: "vault",
      callback: function () {
        new xD(app, false).open();
      },
    });
  }
  if (Yl.isMobile) {
    commands.addCommand({
      id: "app:show-tab-switcher",
      name: gm.interface.mobile.actionShowSwitcher(),
      icon: "lucide-square",
      checkCallback: function (checking) {
        if (Yl.isPhone) {
          if (!checking) app.mobileTabSwitcher.show();
          return true;
        }
        return false;
      },
    });
  }
  commands.addCommand({
    id: "theme:toggle-light-dark",
    name: gm.commands.toggleLightDarkMode(),
    callback: function () {
      if (app.vault.getConfig("theme") === "system") {
        const body = document.body;
        const dark = app.customCss.isDarkMode();
        app.disableCssTransition();
        setTimeout(() => app.enableCssTransition(), 200);
        body.toggleClass("theme-dark", !dark);
        body.toggleClass("theme-light", dark);
        app.workspace.trigger("css-change");
        app.updateMobileFrameTheme(dark);
      } else {
        const dark = app.customCss.isDarkMode();
        app.changeTheme(dark ? "moonstone" : "basalt");
      }
    },
  });
  commands.addCommand({
    id: "theme:switch",
    name: gm.commands.changeTheme(),
    callback: function () {
      return new Ob(app).open();
    },
  });
  commands.addCommand({
    id: "app:open-settings",
    name: gm.commands.openSettings(),
    icon: "lucide-settings",
    callback: function () {
      return app.setting.open();
    },
    hotkeys: [Fb(["Mod"], ",")],
  });
  commands.addCommand({
    id: "app:show-release-notes",
    name: gm.commands.showReleaseNotes(),
    callback: function () {
      return app.showReleaseNotes();
    },
  });
  commands.addCommand({
    id: "markdown:toggle-preview",
    name: gm.commands.togglePreview(),
    icon: "lucide-book-open",
    checkCallback: function (checking) {
      const editor = app.workspace.activeEditor;
      if (editor) {
        if (!checking) editor.toggleMode();
        return true;
      }
      return false;
    },
    hotkeys: [Fb(["Mod"], "E")],
  });
  const canEditMetadata = function () {
    if (JI(app.workspace)) return true;
    if (app.internalPlugins.getEnabledPluginById("properties")) {
      const file = app.workspace.getActiveFile();
      return file?.extension === "md";
    }
    return false;
  };
  commands.addCommand({
    id: "markdown:add-metadata-property",
    name: gm.commands.addProperty(),
    icon: "lucide-plus-circle",
    checkCallback: function (checking) {
      if (canEditMetadata()) {
        if (!checking) {
          (async () => {
            const view = await eO(app);
            view?.addProperty();
          })();
        }
        return true;
      }
      return false;
    },
    hotkeys: [Fb(["Mod"], ";")],
  });
  commands.addCommand({
    id: "markdown:add-alias",
    name: gm.commands.addAlias(),
    icon: "lucide-forward",
    checkCallback: function (checking) {
      if (canEditMetadata()) {
        if (!checking) {
          (async () => {
            const view = await eO(app);
            view?.addProperty("aliases");
          })();
        }
        return true;
      }
      return false;
    },
  });
  commands.addCommand({
    id: "markdown:clear-metadata-properties",
    name: gm.commands.clearProperties(),
    icon: "lucide-package-x",
    checkCallback: function (checking) {
      const file = app.workspace.getActiveFile();
      if (file && jy.contains(file.extension)) {
        if (!checking) app.vault.process(file, (content) => kI(content, {}));
        return true;
      }
      return false;
    },
  });
  commands.addCommand({
    id: "app:delete-file",
    name: gm.commands.deleteCurrentFile(),
    icon: "lucide-trash-2",
    checkCallback: function (checking) {
      const file = app.workspace.getActiveFile();
      if (file) {
        if (!checking) app.fileManager.promptForDeletion(file);
        return true;
      }
      return false;
    },
  });
  commands.addCommand({
    id: "app:toggle-ribbon",
    name: gm.commands.toggleRibbon(),
    checkCallback: function (checking) {
      if (Yl.isDesktop && activeWindow === window) {
        if (!checking) {
          const shown = app.vault.getConfig("showRibbon");
          app.vault.setConfig("showRibbon", !shown);
        }
        return true;
      }
      return false;
    },
  });
  commands.addCommand({
    id: "editor:toggle-readable-line-length",
    name: gm.commands.toggleReadableLineLength(),
    icon: "lucide-ruler",
    callback: function () {
      return app.vault.setConfig("readableLineLength", !app.vault.getConfig("readableLineLength"));
    },
  });
  commands.addCommand({
    id: "editor:toggle-line-numbers",
    name: gm.commands.toggleLineNumbers(),
    icon: "lucide-list-ordered",
    callback: function () {
      return app.vault.setConfig("showLineNumber", !app.vault.getConfig("showLineNumber"));
    },
  });
  commands.addCommand({
    id: "app:toggle-left-sidebar",
    name: gm.commands.toggleLeftSidebar(),
    checkCallback: function (checking) {
      if (activeWindow === window) {
        if (!checking) {
          const split = app.workspace.leftSplit;
          if (Yl.canPinSidebar && split instanceof WD) split.togglePinned();
          else split.toggle();
        }
        return true;
      }
      return false;
    },
  });
  commands.addCommand({
    id: "app:toggle-right-sidebar",
    name: gm.commands.toggleRightSidebar(),
    checkCallback: function (checking) {
      if (activeWindow === window) {
        if (!checking) {
          const split = app.workspace.rightSplit;
          if (Yl.canPinSidebar && split instanceof WD) split.togglePinned();
          else split.toggle();
        }
        return true;
      }
      return false;
    },
  });
  commands.addCommand({
    id: "app:toggle-default-new-pane-mode",
    name: gm.commands.toggleDefaultNewTabMode(),
    callback: function () {
      const mode = app.vault.getConfig("defaultViewMode");
      if (mode === "source") {
        app.vault.setConfig("defaultViewMode", "preview");
        new E.fb(gm.interface.msgSwitchedToRead());
      } else if (mode === "preview") {
        app.vault.setConfig("defaultViewMode", "source");
        new E.fb(gm.interface.msgSwitchedToEdit());
      }
    },
  });
  commands.addCommand({
    id: "app:open-help",
    name: gm.commands.openHelp(),
    icon: "question-mark-glyph",
    callback: this.openHelp.bind(this),
    hotkeys: [Fb([], "F1")],
  });
  commands.addCommand({
    id: "app:reload",
    name: gm.commands.reload(),
    icon: "lucide-rotate-ccw",
    callback: function () {
      return window.location.reload();
    },
  });
  commands.addCommand({
    id: "app:show-debug-info",
    name: gm.commands.showDebugInfo(),
    callback: function () {
      return new m0(app).open();
    },
  });
  if (Yl.isDesktopApp) {
    commands.addCommand({
      id: "app:open-sandbox-vault",
      name: gm.commands.openSandboxVault(),
      callback: function () {
        electron.ipcRenderer.sendSync("sandbox");
      },
    });
    commands.addCommand({
      id: "window:toggle-always-on-top",
      name: gm.commands.alwaysOnTop(),
      checkCallback: function (checking) {
        if (activeWindow !== window) {
          const win = activeWindow.electronWindow;
          if (!win.isMaximized()) {
            if (!checking) win.setAlwaysOnTop(!win.isAlwaysOnTop());
            return true;
          }
        }
        return false;
      },
    });
    commands.addCommand({
      id: "window:zoom-in",
      name: gm.commands.zoomIn(),
      callback: function () {
        const level = electron.webFrame.getZoomLevel();
        if (level < 3) electron.webFrame.setZoomLevel(level + 0.5);
      },
    });
    commands.addCommand({
      id: "window:zoom-out",
      name: gm.commands.zoomOut(),
      callback: function () {
        const level = electron.webFrame.getZoomLevel();
        if (level > -2.5) electron.webFrame.setZoomLevel(level - 0.5);
      },
    });
    commands.addCommand({
      id: "window:reset-zoom",
      name: gm.commands.resetZoom(),
      callback: function () {
        electron.webFrame.setZoomLevel(0);
      },
    });
  }
  commands.addCommand({
    id: "file-explorer:new-file",
    name: gm.plugins.fileExplorer.actionCreateNote(),
    icon: "lucide-file-plus",
    callback: function () {
      return app.fileManager.createAndOpenMarkdownFile("", "tab");
    },
    hotkeys: [Fb(["Mod"], "N")],
  });
  commands.addCommand({
    id: "file-explorer:new-file-in-current-tab",
    name: gm.plugins.fileExplorer.actionCreateNoteInCurrentTab(),
    icon: "lucide-file-plus",
    callback: function () {
      return app.fileManager.createAndOpenMarkdownFile("", false);
    },
  });
  commands.addCommand({
    id: "file-explorer:new-file-in-new-pane",
    name: gm.plugins.fileExplorer.actionCreateNoteToTheRight(),
    icon: "lucide-file-plus",
    callback: function () {
      return app.fileManager.createAndOpenMarkdownFile("", "split");
    },
    hotkeys: [Fb(["Mod", "Shift"], "N")],
  });
  commands.addCommand({
    id: "open-with-default-app:open",
    name: Yl.isMobileApp ? gm.plugins.openWithDefaultApp.actionOpenFileMobile() : gm.plugins.openWithDefaultApp.actionOpenFile(),
    icon: "lucide-arrow-up-right",
    checkCallback: function (checking) {
      const file = app.workspace.getActiveFile();
      if (file) {
        if (!checking) app.openWithDefaultApp(file.path);
        return true;
      }
      return false;
    },
  });
  commands.addCommand({
    id: "file-explorer:move-file",
    name: gm.plugins.fileExplorer.commandMoveFile(),
    icon: "lucide-folder-tree",
    checkCallback: function (checking) {
      const file = app.workspace.getActiveFile();
      if (file) {
        if (!checking) new g0(app, [file]).open();
        return true;
      }
      return false;
    },
  });
  commands.addCommand({
    id: "file-explorer:duplicate-file",
    name: Yl.isMacOS ? gm.plugins.fileExplorer.commandMakeACopyMac() : gm.plugins.fileExplorer.commandMakeACopy(),
    icon: "lucide-files",
    checkCallback: function (checking) {
      const file = app.workspace.getActiveFile();
      if (file) {
        if (!checking) {
          (async () => {
            const vault = app.vault;
            const target = vault.getAvailablePath(au(file.path), file.extension);
            const copy = await vault.copy(file, target);
            app.workspace.getLeaf("tab").openFile(copy, { active: true, eState: { rename: "all" } });
          })();
        }
        return true;
      }
      return false;
    },
  });
  const quickActions = this.mobileQuickActions;
  if (quickActions) {
    quickActions.registerQuickAction("new", {
      title: gm.plugins.fileExplorer.actionNewNote(),
      iconName: "plus",
      callback: () =>
        (async () => {
          const parent = app.fileManager.getNewFileParent("");
          const file = await app.fileManager.createNewMarkdownFile(parent);
          app.workspace.getLeaf(false).openFile(file, { active: true, state: { mode: "source" }, eState: { rename: "all" } });
        })(),
    });
  }
  if (Yl.isDesktopApp) {
    commands.addCommand({
      id: "open-with-default-app:show",
      name: Yl.isMacOS ? gm.plugins.openWithDefaultApp.actionShowInFolderMac() : gm.plugins.openWithDefaultApp.actionShowInFolder(),
      icon: "lucide-files",
      checkCallback: function (checking) {
        const file = app.workspace.getActiveFile();
        if (file) {
          if (!checking) app.showInFolder(file.path);
          return true;
        }
        return false;
      },
    });
  }
  // editor commands
  const registerEditorCommands = function (scope) {
    const app = this;
    const commands = scope.commands;
    const foldingEnabled = function () {
      const heading = app.vault.getConfig("foldHeading");
      const indent = app.vault.getConfig("foldIndent");
      return heading || indent;
    };
    commands.addCommand({
      id: "editor:toggle-source",
      name: gm.commands.toggleSourceMode(),
      icon: "lucide-code-2",
      checkCallback: function (checking) {
        const editor = app.workspace.activeEditor;
        if (editor instanceof W6 && editor.currentMode === editor.editMode) {
          if (!checking) {
            const leaf = editor.leaf;
            const state = editor.getState();
            state.source = !state.source;
            leaf.setViewState({ type: U6, state: state, active: true });
            app.workspace.requestSaveLayout();
          }
          return true;
        }
        return false;
      },
    });
    commands.addCommand({
      id: "editor:open-search",
      name: gm.commands.searchCurrentFile(),
      icon: "lucide-search",
      checkCallback: function (checking) {
        const editor = app.workspace.activeEditor;
        if (editor && RV(editor)) {
          if (!checking) editor.showSearch(false);
          return true;
        }
        const view = app.workspace.activeLeaf?.view;
        if (view && RV(view)) {
          if (!checking) view.showSearch(false);
          return true;
        }
        return undefined;
      },
      hotkeys: [Fb(["Mod"], "F")],
    });
    commands.addCommand({
      id: "editor:open-search-replace",
      name: gm.commands.searchReplaceCurrentFile(),
      icon: "lucide-search",
      checkCallback: function (checking) {
        const editor = app.workspace.activeEditor;
        if (editor && editor.getMode() === "source") {
          if (!checking) editor.showSearch(true);
          return true;
        }
        return false;
      },
      hotkeys: [jl ? Fb(["Mod", "Alt"], "F") : Fb(["Mod"], "H")],
    });
    commands.addCommand({
      id: "editor:focus",
      name: gm.commands.focusEditor(),
      checkCallback: function (checking) {
        let view = app.workspace.getActiveViewOfType(W6);
        if (!view) {
          let best = null;
          app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof W6 && (!best || best.activeTime < leaf.activeTime)) best = leaf;
          });
          if (best) view = best.view;
        }
        if (view) {
          if (!checking) view.editor.focus();
          return true;
        }
        return false;
      },
    });
    commands.addCommand({
      id: "editor:toggle-fold-properties",
      name: gm.commands.toggleFoldProperties(),
      icon: "lucide-diff",
      checkCallback: function (checking) {
        const metadata = JI(app.workspace);
        if (metadata) {
          if (!checking) metadata.toggleCollapse();
          return true;
        }
        const editor = app.workspace.activeEditor;
        if (editor?.getMode() === "source") {
          if (!checking) editor.editMode.toggleFoldFrontmatter();
          return true;
        }
        return false;
      },
    });
    commands.addCommand({
      id: "editor:toggle-fold",
      name: gm.commands.toggleFold(),
      icon: "lucide-diff",
      allowProperties: true,
      editorCheckCallback: function (checking, editor, view) {
        if (!editor.hasFocus()) {
          if ($I(view)) {
            if (!checking) view.metadataEditor.toggleCollapse();
            return true;
          }
          return false;
        }
        if (!foldingEnabled()) return false;
        if (!checking) editor.exec("toggleFold");
        return true;
      },
    });
    commands.addCommand({
      id: "editor:fold-all",
      name: gm.commands.foldAll(),
      icon: "lucide-minimize-2",
      allowPreview: true,
      allowProperties: true,
      editorCheckCallback: function (checking, editor, view) {
        if ($I(view) && !checking) view.metadataEditor.setCollapse(true, false);
        if (!foldingEnabled()) return false;
        if (view.getMode() === "preview") {
          if (!checking && (view instanceof W6 || view instanceof CZ)) view.previewMode.foldAll();
          return true;
        }
        if (!checking) editor.editMode.editor.exec("foldAll");
        return true;
      },
    });
    commands.addCommand({
      id: "editor:unfold-all",
      name: gm.commands.unfoldAll(),
      icon: "lucide-maximize-2",
      allowPreview: true,
      allowProperties: true,
      editorCheckCallback: function (checking, editor, view) {
        if ($I(view) && !checking) view.metadataEditor.setCollapse(true, false);
        if (!foldingEnabled()) return false;
        if (view.getMode() === "preview") {
          if (!checking && (view instanceof W6 || view instanceof CZ)) view.previewMode.unfoldAll();
          return true;
        }
        if (!checking) editor.editMode.editor.exec("unfoldAll");
        return true;
      },
    });
    commands.addCommand({
      id: "editor:fold-less",
      name: gm("commands.fold-less"),
      icon: "lucide-unfold-vertical",
      editorCallback: function (editor) {
        return editor.foldLess();
      },
    });
    commands.addCommand({
      id: "editor:fold-more",
      name: gm.commands.foldMore(),
      icon: "lucide-fold-vertical",
      editorCallback: function (editor) {
        return editor.foldMore();
      },
    });
    commands.addCommand({
      id: "editor:insert-wikilink",
      name: gm.setting.mobileToolbar.optionInternalLink(),
      icon: "bracket-glyph",
      editorCallback: function (editor) {
        if (editor instanceof iZ) editor.triggerWikilink(false);
      },
    });
    commands.addCommand({
      id: "editor:insert-embed",
      name: gm.setting.mobileToolbar.optionInternalEmbed(),
      icon: "lucide-sticky-note",
      editorCallback: function (editor) {
        if (editor instanceof iZ) editor.triggerWikilink(true);
      },
    });
    commands.addCommand({
      id: "editor:insert-link",
      name: gm.commands.insertLink(),
      icon: "lucide-link",
      editorCallback: function (editor) {
        if (editor instanceof iZ) editor.insertMarkdownLink();
      },
      hotkeys: [Fb(["Mod"], "K")],
    });
    commands.addCommand({
      id: "editor:insert-tag",
      name: gm.setting.mobileToolbar.optionTag(),
      icon: "lucide-tag",
      editorCallback: function (editor) {
        const pos = editor.getCursor("from");
        editor.replaceRange("#", pos, pos, "input.autocomplete");
        editor.setSelection(rP(pos, 1));
      },
    });
    let headingMenuOpen = false;
    commands.addCommand({
      id: "editor:set-heading",
      name: gm.setting.mobileToolbar.optionHeading(),
      icon: "heading-glyph",
      editorCallback: function (editor) {
        if (headingMenuOpen) return;
        headingMenuOpen = true;
        if (Yl.isPhone) editor.blur();
        const menu = new Ug();
        const addItem = function (level) {
          const icon = level === 0 ? "lucide-type" : "lucide-heading-" + level;
          const title = level === 0 ? gm.editor.headingSuggestion.labelNoHeading() : gm.editor.headingSuggestion.labelHeadingLevel({ level: level });
          menu.addItem((item) => item.setIcon(icon).setTitle(title).onClick(() => editor.setHeading(level)));
        };
        for (const level of [0, 1, 2, 3, 4, 5, 6]) addItem(level);
        menu.onHide(() => {
          headingMenuOpen = false;
          if (Yl.isPhone) editor.focus();
        });
        const coords = editor.coordsAtPos(editor.getCursor());
        menu.showAtPosition({ x: coords.left, y: coords.top });
      },
    });
    commands.addCommand({
      id: "editor:set-heading-0",
      name: gm.commands.removeHeading(),
      icon: "heading-glyph",
      editorCallback: function (editor) {
        return editor.setHeading(0);
      },
    });
    const addHeading = function (level) {
      commands.addCommand({
        id: "editor:set-heading-" + level,
        name: gm.commands.toggleHeading({ level: level }),
        icon: "heading-glyph",
        editorCallback: function (editor) {
          return editor.setHeading(level);
        },
      });
    };
    for (const level of [1, 2, 3, 4, 5, 6]) addHeading(level);
    commands.addCommand({
      id: "editor:toggle-bold",
      name: gm.commands.toggleBold(),
      icon: "lucide-bold",
      editorCallback: function (editor) {
        return editor.toggleMarkdownFormatting("bold");
      },
      hotkeys: [Fb(["Mod"], "B")],
    });
    commands.addCommand({
      id: "editor:toggle-italics",
      name: gm.commands.toggleItalics(),
      icon: "lucide-italic",
      editorCallback: function (editor) {
        return editor.toggleMarkdownFormatting("italic");
      },
      hotkeys: [Fb(["Mod"], "I")],
    });
    commands.addCommand({
      id: "editor:toggle-strikethrough",
      name: gm.setting.mobileToolbar.optionStrikethrough(),
      icon: "lucide-strikethrough",
      editorCallback: function (editor) {
        return editor.toggleMarkdownFormatting("strikethrough");
      },
    });
    commands.addCommand({
      id: "editor:toggle-highlight",
      name: gm.commands.toggleHighlight(),
      icon: "lucide-highlighter",
      editorCallback: function (editor) {
        return editor.toggleMarkdownFormatting("highlight");
      },
    });
    commands.addCommand({
      id: "editor:toggle-code",
      name: gm.setting.mobileToolbar.optionCode(),
      icon: "lucide-code-2",
      editorCallback: function (editor) {
        return editor.toggleMarkdownFormatting("code");
      },
    });
    commands.addCommand({
      id: "editor:toggle-inline-math",
      name: gm.setting.mobileToolbar.optionInlineMath(),
      icon: "lucide-sigma",
      editorCallback: function (editor) {
        return editor.toggleMarkdownFormatting("math");
      },
    });
    commands.addCommand({
      id: "editor:toggle-blockquote",
      name: gm.setting.mobileToolbar.optionBlockquote(),
      icon: "lucide-quote",
      editorCheckCallback: function (checking, editor) {
        if (editor.inTableCell) return false;
        if (!checking) editor.toggleBlockquote();
        return true;
      },
    });
    commands.addCommand({
      id: "editor:toggle-comments",
      name: gm.commands.toggleComments(),
      icon: "lucide-percent",
      editorCallback: function (editor) {
        return editor.toggleComment();
      },
      hotkeys: [Fb(["Mod"], "/")],
    });
    commands.addCommand({
      id: "editor:clear-formatting",
      name: gm.commands.clearFormatting(),
      icon: "lucide-eraser",
      editorCheckCallback: function (checking, editor) {
        if (editor instanceof iZ && editor.somethingSelected()) {
          if (!checking) editor.clearMarkdownFormatting();
          return true;
        }
        return false;
      },
    });
    commands.addCommand({
      id: "editor:toggle-bullet-list",
      name: gm.setting.mobileToolbar.optionBulletList(),
      icon: "lucide-list",
      editorCheckCallback: function (checking, editor) {
        if (editor.inTableCell) return false;
        if (!checking) editor.toggleBulletList();
        return true;
      },
    });
    commands.addCommand({
      id: "editor:toggle-numbered-list",
      name: gm.setting.mobileToolbar.optionNumberedList(),
      icon: "lucide-list-ordered",
      editorCheckCallback: function (checking, editor) {
        if (editor.inTableCell) return false;
        if (!checking) editor.toggleNumberList();
        return true;
      },
    });
    commands.addCommand({
      id: "editor:toggle-checklist-status",
      name: gm.commands.toggleChecklist(),
      icon: "lucide-check-square",
      editorCheckCallback: function (checking, editor) {
        if (editor.inTableCell) return false;
        if (!checking) editor.toggleCheckList();
        return true;
      },
      hotkeys: [Fb(["Mod"], "l")],
    });
    commands.addCommand({
      id: "editor:cycle-list-checklist",
      name: gm.commands.cycleListChecklist(),
      icon: "lucide-check-square",
      editorCheckCallback: function (checking, editor) {
        if (editor.inTableCell) return false;
        if (!checking) editor.toggleCheckList(true);
        return true;
      },
    });
    commands.addCommand({
      id: "editor:insert-callout",
      name: gm.commands.insertCallout(),
      icon: "lucide-quote",
      editorCheckCallback: function (checking, editor) {
        if (editor.inTableCell) return false;
        if (!checking) editor.insertCallout();
        return true;
      },
    });
    commands.addCommand({
      id: "editor:insert-codeblock",
      name: gm.commands.insertCodeBlock(),
      icon: "lucide-code",
      editorCheckCallback: function (checking, editor) {
        if (editor.inTableCell) return false;
        if (!checking) editor.insertCodeblock();
        return true;
      },
    });
    commands.addCommand({
      id: "editor:insert-horizontal-rule",
      name: gm.commands.insertHorizontalRule(),
      icon: "lucide-minus",
      editorCallback: function (editor) {
        return editor.insertHorizontalRule();
      },
    });
    commands.addCommand({
      id: "editor:insert-mathblock",
      name: gm.commands.insertMathBlock(),
      icon: "lucide-sigma-square",
      editorCallback: function (editor) {
        return editor.insertMathBlock();
      },
    });
    commands.addCommand({
      id: "editor:insert-table",
      name: gm.commands.insertTable(),
      icon: "lucide-table",
      editorCallback: function (editor) {
        return editor.insertTable();
      },
    });
    commands.addCommand({
      id: "editor:insert-footnote",
      name: gm.commands.insertFootnote(),
      icon: "lucide-file-signature",
      editorCallback: function (editor) {
        return editor.insertFootnote();
      },
    });
    commands.addCommand({
      id: "editor:indent-list",
      name: gm.setting.mobileToolbar.optionIndentList(),
      icon: "lucide-indent",
      editorCallback: function (editor) {
        return editor.indentList();
      },
    });
    commands.addCommand({
      id: "editor:unindent-list",
      name: gm.setting.mobileToolbar.optionUnindentList(),
      icon: "lucide-outdent",
      editorCallback: function (editor) {
        return editor.unindentList();
      },
    });
    commands.addCommand({
      id: "editor:swap-line-up",
      name: gm.commands.swapLineUp(),
      icon: "lucide-corner-right-up",
      repeatable: true,
      editorCallback: function (editor) {
        return editor.exec("swapLineUp");
      },
    });
    commands.addCommand({
      id: "editor:swap-line-down",
      name: gm.commands.swapLineDown(),
      icon: "lucide-corner-right-down",
      repeatable: true,
      editorCallback: function (editor) {
        return editor.exec("swapLineDown");
      },
    });
    commands.addCommand({
      id: "editor:undo",
      name: gm.setting.mobileToolbar.optionUndo(),
      icon: "lucide-undo-2",
      mobileOnly: true,
      editorCallback: function (editor) {
        return editor.undo();
      },
    });
    commands.addCommand({
      id: "editor:redo",
      name: gm.setting.mobileToolbar.optionRedo(),
      icon: "lucide-redo-2",
      mobileOnly: true,
      editorCallback: function (editor) {
        return editor.redo();
      },
    });
    commands.addCommand({
      id: "editor:move-caret-up",
      name: gm.setting.mobileToolbar.optionMoveCaretUp(),
      icon: "lucide-chevron-up",
      mobileOnly: true,
      editorCallback: function (editor) {
        return editor.exec("goUp");
      },
    });
    commands.addCommand({
      id: "editor:move-caret-down",
      name: gm.setting.mobileToolbar.optionMoveCaretDown(),
      icon: "lucide-chevron-down",
      mobileOnly: true,
      editorCallback: function (editor) {
        return editor.exec("goDown");
      },
    });
    commands.addCommand({
      id: "editor:move-caret-left",
      name: gm.setting.mobileToolbar.optionMoveCaretLeft(),
      icon: "lucide-chevron-left",
      mobileOnly: true,
      editorCallback: function (editor) {
        return editor.exec("goLeft");
      },
    });
    commands.addCommand({
      id: "editor:move-caret-right",
      name: gm.setting.mobileToolbar.optionMoveCaretRight(),
      icon: "lucide-chevron-right",
      mobileOnly: true,
      editorCallback: function (editor) {
        return editor.exec("goRight");
      },
    });
    commands.addCommand({
      id: "editor:go-start",
      name: gm.setting.mobileToolbar.optionFirstLine(),
      icon: "lucide-chevrons-up",
      mobileOnly: true,
      editorCallback: function (editor) {
        return editor.exec("goStart");
      },
    });
    commands.addCommand({
      id: "editor:go-end",
      name: gm.setting.mobileToolbar.optionLastLine(),
      icon: "lucide-chevrons-down",
      mobileOnly: true,
      editorCallback: function (editor) {
        return editor.exec("goEnd");
      },
    });
    commands.addCommand({
      id: "editor:toggle-keyboard",
      name: gm.setting.mobileToolbar.optionToggleKeyboard(),
      icon: "keyboard-toggle",
      mobileOnly: true,
      editorCallback: function (editor) {
        if (editor.hasFocus()) editor.blur();
        else editor.focus();
      },
    });
    commands.addCommand({
      id: "editor:configure-toolbar",
      name: gm.setting.mobileToolbar.optionConfigureToolbar(),
      icon: "lucide-wrench",
      mobileOnly: true,
      editorCallback: function () {
        const setting = app.setting;
        setting.openTabById("mobile");
        setting.open();
      },
    });
    commands.addCommand({
      id: "editor:attach-file",
      name: gm.setting.mobileToolbar.optionAttach(),
      icon: "lucide-paperclip",
      editorCallback: function (editor) {
        const doc = activeDocument;
        const body = doc.body;
        const input = body.createEl("input", { type: "file" });
        input.style.position = "fixed";
        input.style.opacity = "0";
        input.style.zIndex = "-9999";
        let timeout;
        const cleanup = function () {
          doc.removeEventListener("focus", onFocus);
          doc.removeEventListener("click", onFocus);
          clearTimeout(timeout);
        };
        const detach = function () {
          input.detach();
        };
        const onFocus = function () {
          cleanup();
          timeout = window.setTimeout(detach, 5000);
        };
        input.addEventListener("change", () => {
          (async () => {
            cleanup();
            const files = input.files;
            if (!files) {
              detach();
              return;
            }
            const file = app.workspace.getActiveFile();
            if (!file) {
              detach();
              return;
            }
            try {
              for (let i = 0; i < files.length; i++) {
                const f = files[i];
                const name = nu(f.name);
                const buffer = await f.arrayBuffer();
                const saved = await app.saveAttachment(ou(name), su(name), buffer);
                if (saved) {
                  const link = app.fileManager.generateMarkdownLink(saved, file.path);
                  editor.replaceSelection("!" + link);
                }
              }
            } finally {
              detach();
            }
          })();
        });
        input.focus();
        input.click();
        setTimeout(() => {
          doc.addEventListener("focus", onFocus);
          doc.addEventListener("click", onFocus);
        }, 0);
      },
    });
    commands.addCommand({
      id: "editor:delete-paragraph",
      name: gm.commands.deleteParagraph(),
      icon: "lucide-scissors",
      repeatable: true,
      editorCallback: function (editor) {
        return editor.exec("deleteLine");
      },
      hotkeys: [Fb(["Mod"], "D")],
    });
    commands.addCommand({
      id: "editor:add-cursor-below",
      name: gm.commands.addCursorBelow(),
      icon: "lucide-mouse-pointer-click",
      repeatable: true,
      editorCheckCallback: function (checking, editor) {
        if (!(editor instanceof iZ)) return false;
        if (!checking) {
          const cm = editor.cm;
          const selection = cm.state.selection;
          let range = selection.ranges[0];
          for (let i = 1; i < selection.ranges.length; i++) {
            const other = selection.ranges[i];
            if (other.to > range.to) range = other;
          }
          const pos = OA(cm.state.doc, range.from);
          const target = IA(cm.state.doc, { line: pos.line + 1, ch: pos.ch });
          cm.dispatch({ selection: selection.addRange(pe.cursor(target)), userEvent: "select" });
        }
        return true;
      },
    });
    commands.addCommand({
      id: "editor:add-cursor-above",
      name: gm.commands.addCursorAbove(),
      icon: "lucide-mouse-pointer-click",
      repeatable: true,
      editorCheckCallback: function (checking, editor) {
        if (!(editor instanceof iZ)) return false;
        if (!checking) {
          const cm = editor.cm;
          const selection = cm.state.selection;
          let range = selection.ranges[0];
          for (let i = 1; i < selection.ranges.length; i++) {
            const other = selection.ranges[i];
            if (other.from < range.from) range = other;
          }
          const pos = OA(cm.state.doc, range.from);
          const target = IA(cm.state.doc, { line: pos.line - 1, ch: pos.ch });
          cm.dispatch({ selection: selection.addRange(pe.cursor(target)), userEvent: "select" });
        }
        return true;
      },
    });
    commands.addCommand({
      id: "editor:toggle-spellcheck",
      name: gm.commands.toggleSpellcheck(),
      callback: function () {
        app.vault.setConfig("spellcheck", !app.vault.getConfig("spellcheck"));
      },
    });
    const addTableCommand = function (suffix, name, icon, action, visible) {
      commands.addCommand({
        id: "editor:table-" + suffix,
        name: gm.table.labelCommand({ command: name }),
        icon: icon,
        editorCheckCallback: function (checking, editor) {
          if (!(editor instanceof iZ && editor.editorComponent.tableCell)) return false;
          const cell = editor.editorComponent.tableCell;
          if (checking) return !visible || visible(cell);
          action(cell);
          return true;
        },
      });
    };
    addTableCommand("row-before", gm.table.actionRowBefore(), "lucide-panel-top-close", function (c) {
      const table = c.table;
      const cell = c.cell;
      table.insertRow(cell.row, cell.col);
    });
    addTableCommand("row-after", gm.table.actionRowAfter(), "lucide-panel-bottom-close", function (c) {
      const table = c.table;
      const cell = c.cell;
      table.insertRow(cell.row + 1, cell.col);
    });
    addTableCommand("row-up", gm.table.actionRowUp(), "lucide-arrow-up", function (c) {
      const table = c.table;
      const cell = c.cell;
      table.moveRow(cell.row, cell.row - 1, cell.col);
    }, function (c) {
      return c.cell.row > 0;
    });
    addTableCommand("row-down", gm.table.actionRowDown(), "lucide-arrow-down", function (c) {
      const table = c.table;
      const cell = c.cell;
      table.moveRow(cell.row, cell.row + 1, cell.col);
    }, function (c) {
      const table = c.table;
      return c.cell.row < table.rows.length - 1;
    });
    addTableCommand("row-copy", gm.table.actionDuplicateRow(), "lucide-copy", function (c) {
      const table = c.table;
      const cell = c.cell;
      table.insertRow(cell.row, cell.col, true);
    });
    addTableCommand("row-delete", gm.table.actionDeleteRow(), "lucide-trash-2", function (c) {
      const table = c.table;
      const cell = c.cell;
      table.removeRow(cell.row, cell.col);
    });
    addTableCommand("col-before", gm.table.actionColumnBefore(), "lucide-panel-left-close", function (c) {
      const table = c.table;
      const cell = c.cell;
      const align = table.alignments[cell.col];
      table.insertColumn(cell.row, cell.col, align);
    });
    addTableCommand("col-after", gm.table.actionColumnAfter(), "lucide-panel-right-close", function (c) {
      const table = c.table;
      const cell = c.cell;
      const align = table.alignments[cell.col];
      table.insertColumn(cell.row, cell.col + 1, align);
    });
    addTableCommand("col-left", gm.table.actionColumnLeft(), "lucide-arrow-left", function (c) {
      const table = c.table;
      const cell = c.cell;
      table.moveColumn(cell.col, cell.col - 1, cell.row);
    }, function (c) {
      return c.cell.col > 0;
    });
    addTableCommand("col-right", gm.table.actionColumnRight(), "lucide-arrow-right", function (c) {
      const table = c.table;
      const cell = c.cell;
      table.moveColumn(cell.col, cell.col + 1, cell.row);
    }, function (c) {
      const table = c.table;
      return c.cell.col < table.alignments.length - 1;
    });
    addTableCommand("col-copy", gm.table.actionDuplicateColumn(), "lucide-copy", function (c) {
      const table = c.table;
      const cell = c.cell;
      const align = table.alignments[cell.col];
      table.insertColumn(cell.row, cell.col, align, true);
    });
    addTableCommand("col-delete", gm.table.actionDeleteColumn(), "lucide-trash-2", function (c) {
      const table = c.table;
      const cell = c.cell;
      table.removeColumn(cell.row, cell.col);
    });
    addTableCommand("col-align-left", gm.table.actionAlignLeft(), "lucide-align-left", function (c) {
      const table = c.table;
      const cell = c.cell;
      table.setAlignment([cell.col], "start");
    });
    addTableCommand("col-align-center", gm.table.actionAlignCenter(), "lucide-align-center", function (c) {
      const table = c.table;
      const cell = c.cell;
      table.setAlignment([cell.col], "center");
    });
    addTableCommand("col-align-right", gm.table.actionAlignRight(), "lucide-align-right", function (c) {
      const table = c.table;
      const cell = c.cell;
      table.setAlignment([cell.col], "end");
    });
    if (Yl.isMobileApp) {
      commands.addCommand({
        id: "editor:cut",
        name: gm.interface.menu.cut(),
        icon: "lucide-scissors",
        editorCallback: function (editor) {
          return (async () => {
            await window.navigator.clipboard.writeText(editor.getSelection());
            editor.replaceSelection("");
          })();
        },
      });
      commands.addCommand({
        id: "editor:copy",
        name: gm.interface.menu.copy(),
        icon: "lucide-copy",
        editorCallback: function (editor) {
          return (async () => {
            return await window.navigator.clipboard.writeText(editor.getSelection());
          })();
        },
      });
      commands.addCommand({
        id: "editor:paste",
        name: gm.interface.menu.paste(),
        icon: "lucide-clipboard-type",
        editorCallback: function (editor) {
          return (async () => {
            const text = await window.navigator.clipboard.readText();
            return editor.replaceSelection(text);
          })();
        },
      });
    }
    commands.addCommand({
      id: "editor:context-menu",
      name: gm.commands.contextMenu(),
      icon: "lucide-menu",
      editorCallback: function (editor, eventTarget) {
        if (editor.editorComponent.tableCell) {
          const cell = editor.editorComponent.tableCell;
          eventTarget = cell.owner;
          editor = cell.editor;
        }
        const pos = editor.getCursor("head");
        const coords = editor.coordsAtPos(pos);
        if (!coords) return;
        if (Yl.isDesktopApp) {
          const contents = editor.containerEl.win.electron.remote.getCurrentWebContents();
          const zoom = Math.pow(1.2, contents.getZoomLevel());
          const x = coords.left * zoom;
          const y = (coords.top + coords.bottom) / 2 * zoom;
          contents.sendInputEvent({ type: "mouseDown", x: x, y: y, button: "right" });
          contents.sendInputEvent({ type: "mouseUp", x: x, y: y, button: "right" });
          return;
        }
        eventTarget.editMode.onContextMenu(
          new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: false,
            view: window,
            button: 0,
            buttons: 0,
            clientX: coords.left,
            clientY: coords.top,
          }),
          true
        );
      },
    });
  };
  registerEditorCommands.call(this, this);
  if (Yl.isDesktopApp) {
    Gz.registerPostProcessor((element, ctx) => app.fixFileLinks(element, ctx.sourcePath));
  }
}
