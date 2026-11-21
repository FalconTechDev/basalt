// g39 clean-room: platform glue, file 2 (spec g39 part F) — context menu IPC
// and the startup flag/version init+snapshot pairs.
import { env } from "./env.js";
import { ng39Require } from "./n-g39-platform.js";

export function ng39ContextMenuInfo(evt) {
  if (!window.electron || !evt.isTrusted) return null;
  evt.stopPropagation();
  evt.stopImmediatePropagation();
  return new Promise((resolve) => {
    const e = ng39Require("electron");
    const ipc = e && e.ipcRenderer;
    const timer = evt.win.setTimeout(() => resolve(null), 1000);
    if (ipc) {
      ipc.once("context-menu", (ev2, result) => {
        evt.win.clearTimeout(timer);
        resolve(result);
      });
      ipc.send("context-menu");
    }
  });
}

export function ng39DevFlagInit() { return false; }
export function ng39ElectronVersionInit() { return "0.0.0"; }
export function ng39ElectronMajorInit() { return 0; }

export function ng39DevFlagSnapshot(value) { return value; }
export function ng39VersionSnapshot(value) { return value; }
export function ng39MajorSnapshot(value) { return value; }
