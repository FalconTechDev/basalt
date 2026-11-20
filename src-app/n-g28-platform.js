// g28 platform capability object (spec g28 Part C).
// A flat record of flags; capability getters derive live from the flags.

export function definePlatform(host) {
  const platform = {
    isDesktop: false,
    isMobile: false,
    isDesktopApp: false,
    isMobileApp: false,
    isIosApp: false,
    isAndroidApp: false,
    isPhone: false,
    isTablet: false,
    isMacOS: !!host.isMacOS,
    isWin: !!host.isWindows,
    isLinux: !!host.isLinux,
    isSafari: !!host.isSafari,
    resourcePathPrefix: "file:///",
    supportsIndexedDb: typeof window !== "undefined" && !!window.indexedDB,
    mobileSoftKeyboardVisible: false,
    hasPhysicalKeyboard: false,
    version: "",
    build: "",
    manufacturer: "",
    model: "",
    osName: "",
    osVersion: "",
    deviceName: "",
  };
  Object.defineProperties(platform, {
    canExportPdf: { get() { return this.isDesktopApp; } },
    canPopoutWindow: { get() { return this.isDesktopApp && this.isDesktop; } },
    canStackTabs: { get() { return !this.isPhone; } },
    canSplit: { get() { return !this.isPhone; } },
    canDisplayRibbon: { get() { return !this.isPhone; } },
    canPinSidebar: { get() { return this.isMobile && !this.isPhone; } },
  });
  return platform;
}
