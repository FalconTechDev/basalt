// g32 clean-room constants: literal tables, platform captures and tiny host-bound helpers.
import { isOlderVersion } from "./text.js";
import { ng32SystemFontListData } from "./n-g32-font-data.js";

export const ng32SyncWorkerName = "sync";
export const ng32WebSocket = window.WebSocket;
export const ng32UrlClass = window.URL;
export const ng32UrlHostnameGetter = Object.getOwnPropertyDescriptor(window.URL.prototype, "hostname").get;
export const ng32EndsWith = String.prototype.endsWith;

export const ng32CloseCodes = {
  1000: "Disconnected", 1001: "Going Away", 1002: "Protocol Error", 1003: "Unsupported Data",
  1004: "(For future)", 1005: "No Status Received", 1006: "Disconnected",
  1007: "Invalid frame payload data", 1008: "Policy Violation", 1009: "Message too big",
  1010: "Missing Extension", 1011: "Internal Error", 1012: "Service Restart",
  1013: "Try Again Later", 1014: "Bad Gateway", 1015: "TLS Handshake",
};

export const ng32PlatformTag = window.process && window.process.platform;
export const ng32TagViewType = "tag";
export const ng32TagSortModes = [["alphabetical", "alphabeticalReverse"], ["frequency", "frequencyReverse"]];
export const ng32MobileFeedbackFlag = "didProvideMobileFeedback";
export const ng32ApiVersion = "1.12.7";
export const ng32InstallerMinVersion = "28.2.3";
export const ng32UniqueNoteFormat = "YYYYMMDDHHmm";
export const ng32ThemeList = [
  { id: "basalt", nameI18n: "dark-theme" },
  { id: "moonstone", nameI18n: "light-theme" },
  { id: "system", nameI18n: "system-theme" },
];
export const ng32PngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
export const ng32PngIHDR = [73, 72, 68, 82];
export const ng32PngChunkIds = ["ic07", "ic13", "ic08", "ic14", "ic09", "ic10"];
export const ng32SystemFontList = ng32SystemFontListData;
export const ng32FontProbeSeen = new Set();
export const ng32SettledPromise = Promise.resolve();

export function ng32CheckApiVersion(version, host) {
  return !isOlderVersion(host.s16ApiVersion, version);
}

export async function ng32FontAvailable(name) {
  if (name === "") return true;
  const fonts = document.fonts;
  if (!fonts) return false;
  await fonts.ready;
  return fonts.check(`12px "${name}"`);
}

export function ng32AppContainer(hostEl) {
  this.appContainerEl = hostEl.createDiv("app-container");
  this.horizontalMainContainerEl = this.appContainerEl.createDiv("horizontal-main-container");
  this.workspaceEl = this.horizontalMainContainerEl.createDiv("workspace");
  this.statusBarEl = this.appContainerEl.createDiv("status-bar");
}
