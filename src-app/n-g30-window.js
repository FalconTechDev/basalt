// g30 clean-room: window bootstrap — focus styling, enhance.js injector and
// the Electron bridge for pop-out windows (spec g30 part I).
import {env} from "./env.js";

function ng30UpdateFocus(win) {
  const focused = env().Yl.isDesktopApp && win.electronWindow
    ? win.electronWindow.isFocused()
    : win.document.hasFocus();
  win.document.body.classList.toggle("is-focused", !!focused);
}

/** Tracks window focus into body.is-focused (electronWindow or DOM focus/blur). */
export function ng30TrackWindowFocus(win) {
  const update = () => ng30UpdateFocus(win);
  if (env().Yl.isDesktopApp && win.electronWindow) {
    win.addEventListener("focuschange", update);
  } else {
    win.addEventListener("focus", update);
    win.addEventListener("blur", update);
  }
  update();
}

/** Evaluates the main window's globalEnhance inside `win`. */
export function ng30InstallEnhance(win) {
  const src = window.globalEnhance.toString();
  win.eval.call(win, "(" + src + ")()\n//# sourceURL=enhance.js");
}

/** Frameless titlebar for the top-level window only. */
function ng30InstallTitlebar(win, electron) {
  const style = electron.ipcRenderer.sendSync("frame") || "hidden";
  win.titlebarStyle = style;
  if (style !== "native") win.frameDom = new (env().BD)(win.electronWindow, win);
  if (style === "hidden") win.document.body.classList.add("is-hidden-frameless");
}

/** Wires Electron (remote module, current window, file: interception, titlebar). */
export function ng30AttachElectron(win) {
  let top = win;
  while (top.parent && top.parent !== top) top = top.parent;
  const req = top.require;
  if (!req) return;
  const electron = req("electron");
  if (!electron) return;
  win.electron = electron;
  if (!electron.remote) {
    try {
      electron.remote = req("@electron/remote");
    } catch (e) {
      console.error(e);
    }
  }
  win.electronWindow = electron.remote.getCurrentWindow();
  const origOpen = win.open;
  win.open = function () {
    const url = arguments[0];
    if (typeof url === "string" && url.startsWith("file:")) {
      electron.ipcRenderer.send("open-url", url);
      return null;
    }
    return origOpen.apply(this, arguments);
  };
  if (win === top) ng30InstallTitlebar(win, electron);
}
