// g35 clean-room: per-window bootstrap — focus tracking, enhancement-script
// injection and the Electron/frameless-titlebar attach (spec g35, s26-window).
// Superseded in the bundle by the s11 slice; globals and IPC channels are
// contract.

/** Keeps the is-focused body class synced with window focus. */
export function ng35TrackWindowFocus(win, host) {
  const doc = win.document;
  const electronPath = host.Platform.isDesktopApp && win.electronWindow;
  const update = () => {
    const focused = electronPath ? win.electronWindow.isFocused() : doc.hasFocus();
    doc.body.toggleClass("is-focused", focused);
  };
  if (electronPath) {
    win.addEventListener("focuschange", update);
  } else {
    win.addEventListener("focus", update);
    win.addEventListener("blur", update);
  }
  update();
}

/** Evaluates this window's globalEnhance inside another window/iframe. */
export function ng35InstallEnhancements(win) {
  win.eval.call(win, "(" + window.globalEnhance + ")()\n//# sourceURL=enhance.js");
}

/** Attaches the Electron bridge, redirects file: opens and installs the
 * frameless titlebar on the top-level window. */
export function ng35AttachElectron(win, host) {
  let top = win;
  while (top.parent && top.parent !== top) top = top.parent;
  if (typeof top.require !== "function") return;
  const electron = top.require("electron");
  if (!electron) return;
  win.electron = electron;
  if (!electron.remote) {
    try {
      electron.remote = top.require("@electron/remote");
    } catch (e) {
      console.error(e);
    }
  }
  win.electronWindow = electron.remote.getCurrentWindow();
  const originalOpen = win.open;
  win.open = function (url) {
    if (typeof url === "string" && url.startsWith("file:")) {
      electron.ipcRenderer.send("open-url", url);
      return null;
    }
    return originalOpen.apply(this, arguments);
  };
  if (win !== top) return;
  const style = electron.ipcRenderer.sendSync("frame") || "hidden";
  win.titlebarStyle = style;
  if (style !== "native") win.frameDom = new host.Titlebar(win.electronWindow, win);
  if (style === "hidden") win.document.body.addClass("is-hidden-frameless");
}
