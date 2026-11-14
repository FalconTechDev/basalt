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
    const blocker = new env().Eb();
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
