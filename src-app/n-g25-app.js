// g25 clean-room s17-app-class: the App class factory — constructor wiring every app
// subsystem, debug/mobile-emulation localStorage switches, mobile tap highlight +
// touch long-press context menu, tablet/phone media classes, iOS callout disabling,
// service-worker neutering, startup progress flow. Spec: F:\orch\specs\g25.md Part H.
// Prototype methods are attached from n-g15-app.js helpers (`this` = app instance).

import { appNextFrame, appOnNextFrame, appNextFrameOnceCallback, appInitializeWithAdapter, appOnConfigChanged, appRegisterCommands, appDisableCssTransition, appEnableCssTransition, appGetAppTitle, appGetWebviewPartition, appFixFileLinks, appGetTheme, appIsDarkMode, appChangeTheme, appUpdateTheme, appUpdateMobileFrameTheme, appUpdateInlineTitleDisplay, appUpdateFloatingNavigationDisplay, appUpdateAutoFullScreenDisplay, appUpdateViewHeaderDisplay, appUpdateRibbonDisplay, appUpdateFontFamily, appUpdateFontSize, appUpdateUseNativeMenu, appUpdateTabSize, appShowReleaseNotes, appUpdateAccentColor, appGetAccentColor, appSetAccentColor, appGarbleText, appImportAttachments, appSaveAttachment, appOpenVaultChooser, appOpenHelp, appRunOpeningBehavior, appOpenWithDefaultApp, appShowInFolder, appGetVaultUrl, appCopyVaultUrl, appRegisterQuitHook, appLoadLocalStorage, appSaveLocalStorage, appOn, appSetTheme, appEmulateMobile, appDebugMode, appGetSpellcheckLanguages, appSetSpellcheckLanguages, appIsVimEnabled } from "./n-g15-app.js";

export const s17IframeAllowlist = {
  "encrypted-media": true, fullscreen: true, gamepad: true, hid: true,
  "idle-detection": true, "oversized-images": true, "picture-in-picture": true, "sync-xhr": true,
};
export const s17IframeSandbox = {
  "allow-forms": true, "allow-modals": true, "allow-popups": true,
  "allow-presentation": true, "allow-same-origin": true, "allow-scripts": true,
};
export const s17EmulateMobileKey = "EmulateMobile";
export const s17DebugModeKey = "DebugMode";

const NG25S17_TAP_SELECTOR = "a, button, .tappable, .is-clickable, .clickable-icon, .text-icon-button, .suggestion-item";
const NG25S17_TABLET_QUERY = "(min-width:600px) and (min-height:600px)";

const NG25S17_METHODS = {
  nextFrame: appNextFrame, onNextFrame: appOnNextFrame, nextFrameOnceCallback: appNextFrameOnceCallback,
  initializeWithAdapter: appInitializeWithAdapter, onConfigChanged: appOnConfigChanged,
  registerCommands: appRegisterCommands, disableCssTransition: appDisableCssTransition,
  enableCssTransition: appEnableCssTransition, getAppTitle: appGetAppTitle,
  getWebviewPartition: appGetWebviewPartition, fixFileLinks: appFixFileLinks,
  getTheme: appGetTheme, isDarkMode: appIsDarkMode, changeTheme: appChangeTheme,
  updateTheme: appUpdateTheme, updateMobileFrameTheme: appUpdateMobileFrameTheme,
  updateInlineTitleDisplay: appUpdateInlineTitleDisplay,
  updateFloatingNavigationDisplay: appUpdateFloatingNavigationDisplay,
  updateAutoFullScreenDisplay: appUpdateAutoFullScreenDisplay,
  updateViewHeaderDisplay: appUpdateViewHeaderDisplay, updateRibbonDisplay: appUpdateRibbonDisplay,
  updateFontFamily: appUpdateFontFamily, updateFontSize: appUpdateFontSize,
  updateUseNativeMenu: appUpdateUseNativeMenu, updateTabSize: appUpdateTabSize,
  showReleaseNotes: appShowReleaseNotes, updateAccentColor: appUpdateAccentColor,
  getAccentColor: appGetAccentColor, setAccentColor: appSetAccentColor, garbleText: appGarbleText,
  importAttachments: appImportAttachments, saveAttachment: appSaveAttachment,
  openVaultChooser: appOpenVaultChooser, openHelp: appOpenHelp,
  runOpeningBehavior: appRunOpeningBehavior, openWithDefaultApp: appOpenWithDefaultApp,
  showInFolder: appShowInFolder, getObsidianUrl: appGetVaultUrl,
  copyObsidianUrl: appCopyVaultUrl, registerQuitHook: appRegisterQuitHook,
  loadLocalStorage: appLoadLocalStorage, saveLocalStorage: appSaveLocalStorage,
  on: appOn, setTheme: appSetTheme, emulateMobile: appEmulateMobile, debugMode: appDebugMode,
  getSpellcheckLanguages: appGetSpellcheckLanguages,
  setSpellcheckLanguages: appSetSpellcheckLanguages, isVimEnabled: appIsVimEnabled,
};

export function s17CreateApp(host) {

  function s17StartupButtons(app, prominent) {
    const S = host.i18n.interface.startUp;
    const pluginsOn = !!(app.plugins && app.plugins.isEnabled && app.plugins.isEnabled());
    return (el) => {
      const add = (label, cta, hidden, action) => {
        const b = el.createEl("button", { text: label, cls: cta ? "mod-cta" : "" });
        if (hidden && b.hide) b.hide();
        b.addEventListener("click", action);
      };
      add(S.buttonReloadApp(), prominent, false, () => window.location.reload());
      add(S.buttonReloadAppInSafeMode(), true, !pluginsOn, async () => {
        if (app.plugins && app.plugins.setEnable) await app.plugins.setEnable(false);
        window.location.reload();
      });
      add(S.buttonOpenAnotherVault(), prominent, false, () => app.openVaultChooser());
    };
  }

  function s17PersistStorage() {
    try {
      const p = navigator.storage && navigator.storage.persist ? navigator.storage.persist() : null;
      if (p && p.catch) p.catch(() => console.error("Failed to persist local storages"));
      else if (p && p.then) p.then(undefined, () => console.error("Failed to persist local storages"));
    } catch (e) { console.error("Failed to persist local storages"); }
  }

  function s17Startup(app, adapter) {
    const overlay = host.progressOverlay;
    const watchdog = setTimeout(() => { try { overlay.show(); } catch (e) {} }, 20000);
    (async () => {
      try {
        overlay.setContext(s17StartupButtons(app, false)).show();
        overlay.setMessage(host.i18n.interface.startUp.loadingApp()).show();
        await app.initializeWithAdapter(adapter);
        overlay.hide();
      } catch (e) {
        console.error("Basalt startup failed:", e);
        try {
          overlay.setMessage(host.i18n.interface.startUp.appLoadError() + " " + (e && e.message || e));
          overlay.setContext(s17StartupButtons(app, true));
        } catch (e2) {}
      } finally {
        clearTimeout(watchdog);
        try {
          if (host.Platform.isMobileApp && host.s17SplashScreen) {
            await app.nextFrame();
            host.s17SplashScreen.hide({ fadeOutDuration: 0 });
          }
        } catch (e) {}
      }
    })();
  }

  function s17ApplyMobileChrome(platform, isMobile) {
    const body = document.body;
    if (isMobile) {
      body.classList.add("is-mobile");
      try { if (window.frameDom && window.frameDom.titleBarEl && window.frameDom.titleBarEl.hide) window.frameDom.titleBarEl.hide(); } catch (e) {}
      body.addEventListener("mouseover", (e) => {
        if (host.isTouchSyntheticMouse && host.isTouchSyntheticMouse(e)) return;
        const t = e.target && e.target.closest ? e.target.closest(NG25S17_TAP_SELECTOR) : null;
        if (t) t.classList.add("mobile-tap");
      });
      body.addEventListener("mouseout", (e) => {
        const t = e.target && e.target.closest ? e.target.closest(NG25S17_TAP_SELECTOR) : null;
        if (t) t.classList.remove("mobile-tap");
      });
      let tapTimer = null, tapEl = null, tapX = 0, tapY = 0, tapStart = 0, tapId = null;
      const finishTap = () => {
        if (!tapEl) return;
        const el = tapEl; tapEl = null;
        setTimeout(() => el.classList.remove("mobile-tap"), Math.max(10, 300 - (Date.now() - tapStart)));
      };
      body.addEventListener("touchstart", (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        const t = e.touches[0];
        tapId = t.identifier; tapX = t.clientX; tapY = t.clientY; tapStart = Date.now();
        tapEl = document.elementFromPoint(t.clientX, t.clientY);
        tapTimer = setTimeout(() => { if (tapEl) tapEl.classList.add("mobile-tap"); }, 10);
      }, { capture: true });
      body.addEventListener("touchmove", (e) => {
        for (const t of e.changedTouches || []) {
          if (t.identifier !== tapId) continue;
          const dx = t.clientX - tapX, dy = t.clientY - tapY;
          if (dx * dx + dy * dy > 25) { clearTimeout(tapTimer); tapTimer = null; finishTap(); }
        }
      }, { capture: true });
      const endTap = (e) => {
        for (const t of e.changedTouches || []) {
          if (t.identifier === tapId) { clearTimeout(tapTimer); tapTimer = null; finishTap(); tapId = null; }
        }
      };
      body.addEventListener("touchend", endTap, { capture: true });
      body.addEventListener("touchcancel", endTap, { capture: true });
    }
    if (!platform.isMacOS) body.classList.add("styled-scrollbars");
  }

  function s17ApplyTabletClasses(platform) {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(NG25S17_TABLET_QUERY);
    const apply = () => {
      if (platform.mobileSoftKeyboardVisible) return;
      const tablet = !!(mq && mq.matches);
      platform.isTablet = tablet;
      platform.isPhone = !tablet;
      document.body.classList.toggle("is-tablet", tablet);
      document.body.classList.toggle("is-phone", !tablet);
    };
    if (mq && mq.addEventListener) mq.addEventListener("change", host.debounce ? host.debounce(apply, 10) : apply);
    else if (mq && mq.addListener) mq.addListener(host.debounce ? host.debounce(apply, 10) : apply);
    apply();
  }

  function s17IosCalloutGuard(platform) {
    if (!platform.isIosApp) return;
    try { document.body.style.setProperty("-webkit-touch-callout", "none"); } catch (e) {}
    let cancelTouch = null;
    const onStart = (e) => {
      if (e.touches.length > 1 || e.defaultPrevented) return;
      const t = e.touches[0];
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const delay = el && el.closest && el.closest('[draggable="true"]') ? 1200 : 800;
      const timer = setTimeout(() => {
        const me = new MouseEvent("contextmenu", {
          bubbles: true, cancelable: true, clientX: t.clientX, clientY: t.clientY,
          button: 0, buttons: 0, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
        });
        (el || document.body).dispatchEvent(me);
        if (navigator.vibrate) navigator.vibrate(200);
      }, delay);
      const cancel = () => clearTimeout(timer);
      cancelTouch = cancel;
      if (host.s17SetTouchCancel) host.s17SetTouchCancel(cancel);
      const onMove = (ev) => {
        for (const c of ev.changedTouches || []) {
          if (c.identifier === t.identifier &&
              (c.clientX - t.clientX) ** 2 + (c.clientY - t.clientY) ** 2 > 25) cancel();
        }
      };
      const onEnd = (ev) => {
        for (const c of ev.changedTouches || []) {
          if (c.identifier === t.identifier) {
            cancel();
            window.removeEventListener("touchmove", onMove, true);
            window.removeEventListener("touchend", onEnd, true);
            window.removeEventListener("touchcancel", onEnd, true);
          }
        }
      };
      window.addEventListener("touchmove", onMove, true);
      window.addEventListener("touchend", onEnd, true);
      window.addEventListener("touchcancel", onEnd, true);
    };
    document.body.addEventListener("touchstart", onStart, { capture: true, passive: true });
    document.body.addEventListener("dragstart", () => { if (cancelTouch) { cancelTouch(); cancelTouch = null; } }, true);
  }

  function s17NeuterServiceWorker() {
    try {
      const SWC = typeof window !== "undefined" && window.ServiceWorkerContainer;
      if (SWC && SWC.prototype) SWC.prototype.register = () => new Promise(() => {});
    } catch (e) {}
  }

  class App {
    constructor(adapter, appId) {
      const platform = host.Platform;
      this.adapter = adapter;
      this.embedRegistry = new host.s17EmbedRegistry();
      this.viewRegistry = new host.s17ViewRegistry();
      this.nextFrameEvents = [];
      this.nextFrameTimer = null;
      this.isMobile = false;
      this.lastEvent = null;
      console.log("%cBasalt Developer Console", "font-weight:bold");
      this.title = document.title;
      this.appId = appId;
      this.keymap = host.Keymap.init();
      this.scope = this.keymap.getRootScope();
      this.commands = new host.s17Commands(this);
      this.hotkeyManager = new host.s17HotkeyManager(this);
      this.dragManager = new host.s17DragManager(this);
      this.dom = new host.s17AppDom(document.body);
      this.customCss = new host.s17CustomCss(this);
      this.shareReceiver = new host.s17ShareReceiver(this);
      this.renderContext = new host.s17RenderContext(this);
      this.secretStorage = new host.SecretStorage(this);
      this.cli = new host.s17Cli(this);
      window.__bsApi = {
        ItemView: host.ItemView, Modal: host.Modal, Notice: host.Notice,
        Menu: host.Menu, setIcon: host.setIcon, Setting: host.Setting, MarkdownRenderer: host.MarkdownRenderer,
      };
      document.body.classList.add("basalt-app");

      if (this.loadLocalStorage(s17DebugModeKey) === "1" || this.loadLocalStorage(s17DebugModeKey) === 1) {
        host.s17SetBasaltDebug(true);
        new host.Notice("Basalt debug mode enabled.");
        console.debug("Basalt debug mode enabled.");
      }

      if (!platform.isMobile && localStorage.getItem(s17EmulateMobileKey)) {
        platform.isMobile = true;
        platform.isDesktop = false;
        platform.hasPhysicalKeyboard = false;
        document.body.classList.add("emulate-mobile");
      }

      this.isMobile = !!platform.isMobile;
      s17ApplyMobileChrome(platform, this.isMobile);
      if (this.isMobile) s17ApplyTabletClasses(platform);
      s17IosCalloutGuard(platform);
      s17NeuterServiceWorker();
      if (host.keyboard && host.keyboard.hasPhysicalKeyboard) {
        Promise.resolve()
          .then(() => host.keyboard.hasPhysicalKeyboard())
          .then((v) => { platform.hasPhysicalKeyboard = !!v; })
          .catch(() => {});
      }

      s17PersistStorage();
      s17Startup(this, adapter);
    }

    static getOverrideConfigDir(appId) {
      const v = localStorage.getItem(appId + "-config");
      return typeof v === "string" ? v : null;
    }
  }

  for (const name of Object.keys(NG25S17_METHODS)) {
    App.prototype[name] = NG25S17_METHODS[name];
  }
  return App;
}
