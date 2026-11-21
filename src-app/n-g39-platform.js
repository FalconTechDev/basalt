// g39 clean-room: Electron/node platform glue (spec g39 part F).
// Lazy require shim, IPC helpers, PDF, vibrancy, flags, startup snapshots.
import { env } from "./env.js";
import { randomHex } from "./misc.js";

export function ng39CryptoSubtle() {
  return window.crypto.subtle;
}

export function ng39WindowRequire() {
  return window.require;
}

export function ng39Require(name) {
  const req = env().s91require;
  if (!req) return undefined;
  return req(name);
}

export function ng39WithElectron(cb) {
  const e = ng39Require("electron");
  if (e) cb(e);
}

export async function ng39ReadFileIfExists(file) {
  const fs = ng39Require("fs");
  if (fs && fs.existsSync(file)) return fs.promises.readFile(file);
  return null;
}

export function ng39FetchUrl(url) {
  return new Promise((resolve, reject) => {
    const e = ng39Require("electron");
    if (!e || !e.ipcRenderer) { reject(new Error("Not electron")); return; }
    const channel = randomHex(16);
    e.ipcRenderer.once(channel, (ev, message) => {
      if (message && message.body) resolve(message);
      else reject(message && message.error);
    });
    e.ipcRenderer.send("request-url", channel, url);
  });
}

export function ng39PrintToPdf(electron, options) {
  return new Promise((resolve) => {
    electron.ipcRenderer.once("print-to-pdf", (ev, result) => resolve(result));
    electron.ipcRenderer.send("print-to-pdf", options);
  });
}

export function ng39IsMacOS() {
  return typeof process !== "undefined" && process.platform === "darwin";
}

export function ng39SetVibrancy(win, sidebar) {
  if (!ng39IsMacOS()) return;
  win.setBackgroundColor("#00000000");
  win.setVibrancy(sidebar ? "sidebar" : null);
}

export function ng39IsWebviewElement(el) {
  return !!el && el.constructor && el.constructor.name === "WebViewElement";
}
