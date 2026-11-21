// g40 clean-room: workspace layout tree, part 5 — WorkspaceWindow (pop-out window).
// Opens a real OS window, mirrors app chrome into it, hosts its own layout tree.
import { inherit } from "./inherit.js";
import { ng40DebounceCall } from "./n-g40-timing.js";

const ng40GeomKeys = ["x", "y", "width", "height"];

function ng40WindowFeatures(options, host) {
  const features = ["popup"];
  const size = {};
  for (const key of ng40GeomKeys) {
    if (options[key] != null) {
      features.push(key + "=" + options[key]);
      size[key] = options[key];
    }
  }
  if (options.size) {
    const w = Math.max(600, options.size.width || 0);
    const h = Math.max(600, options.size.height || 0);
    if (size.width == null) { features.push("width=" + w); size.width = w; }
    if (size.height == null) { features.push("height=" + h); size.height = h; }
  }
  try {
    const bg = getComputedStyle(document.body).backgroundColor;
    const color = host.parseColor(bg);
    if (color) features.push("background=" + host.colorToHex(color));
  } catch (e) {}
  return { features: features.join(","), size };
}

export function ng40DefineWorkspaceWindow(host) {
  function WorkspaceWindow(workspace, id, options) {
    options = options || {};
    const geom = ng40WindowFeatures(options, host);
    const self = host.WorkspaceContainer.call(this, workspace, "vertical", id) || this;
    self.type = "window";
    self.size = geom.size;
    self.win = null;
    self.doc = null;
    self.rootEl = null;
    self.cleanup = null;

    const win = (self.win = window.open("about:blank", "_blank", geom.features));
    if (!win) return self;
    const doc = (self.doc = win.document);

    // scaffold: body > .app-container > .horizontal-main-container > .workspace > containerEl
    const baseEl = doc.createElement("base");
    baseEl.href = location.href;
    doc.head.appendChild(baseEl);
    const appEl = doc.createElement("div");
    appEl.className = "app-container";
    const hmc = doc.createElement("div");
    hmc.className = "horizontal-main-container";
    const wsEl = doc.createElement("div");
    wsEl.className = "workspace";
    hmc.appendChild(wsEl);
    appEl.appendChild(hmc);
    doc.body.appendChild(appEl);
    self.rootEl = wsEl;

    // move the node element into the pop-out document
    self.containerEl.remove();
    const ce = (self.containerEl = doc.createElement("div"));
    ce.className = "workspace-split mod-vertical mod-root workspace-window";
    wsEl.appendChild(ce);

    doc.title = "Basalt";
    win.app = self.app;
    host.installEnhancements(win);
    host.attachElectron(win);
    host.installTooltipHandlers(doc);
    host.installTitlebar(win);
    host.trackWindowFocus(win);
    host.applyLanguage(doc);
    host.forwardInputEvents(win);

    // history + focus + unload plumbing
    const mainWin = window;
    win.history.forward = () => mainWin.history.forward();
    win.history.back = () => mainWin.history.back();
    win.history.go = (n) => mainWin.history.go(n);
    win.addEventListener("focus", () => {
      activeWindow = win;
      activeDocument = doc;
      self.onFocus();
    });
    win.addEventListener("beforeunload", (event) => {
      const quitting = win.electron && win.electron.ipcRenderer && win.electron.ipcRenderer.sendSync("is-quitting");
      if (quitting) event.preventDefault();
      else self.close();
    });
    win.addEventListener("resize", ng40DebounceCall(() => {
      self.workspace.iterateLeaves(self, (leaf) => { if (leaf.onResize) leaf.onResize(); });
      self.workspace.requestSaveLayout();
      self.updateSize();
    }, 50));

    self.cleanup = host.mirrorStyles(win, [baseEl]);
    self.component.registerEvent(self.workspace.on("quit", () => win.close()));
    self.component.registerEvent(self.workspace.on("layout-change", () => self.updateTitle()));

    if (win.electronWindow && win.electronWindow.show) win.electronWindow.show();
    if (options.maximize && win.electronWindow && win.electronWindow.maximize) win.electronWindow.maximize();
    if (win.electron && win.electron.webFrame) {
      if (options.zoom != null) win.electron.webFrame.setZoomLevel(options.zoom);
      else if (window.electron && window.electron.webFrame) win.electron.webFrame.setZoomLevel(window.electron.webFrame.getZoomLevel());
    }
    self.workspace.trigger("window-open", self, win);
    self.updateSize();
    return self;
  }
  inherit(WorkspaceWindow, host.WorkspaceContainer);
  const proto = WorkspaceWindow.prototype;

  proto.updateSize = function () {
    const eWin = this.win && this.win.electronWindow;
    if (!eWin || !eWin.getBounds) return;
    if (eWin.isMaximized && eWin.isMaximized()) return;
    if (eWin.isMinimized && eWin.isMinimized()) return;
    if (eWin.isFullScreen && eWin.isFullScreen()) return;
    this.size = Object.assign({}, eWin.getBounds());
  };

  proto.updateTitle = function () {
    const win = this.win;
    if (!win) return;
    const leaf = this.workspace.getMostRecentLeaf(this);
    win.document.title = this.app.getAppTitle(leaf ? leaf.getDisplayText().trim() : "");
  };

  proto.serialize = function () {
    const data = host.WorkspaceParent.prototype.serialize.call(this);
    const win = this.win;
    if (win && !win.closed) {
      const eWin = win.electronWindow;
      if (eWin && eWin.getBounds) {
        const b = eWin.getBounds();
        data.x = b.x; data.y = b.y; data.width = b.width; data.height = b.height;
        if (eWin.isMaximized) data.maximize = !!eWin.isMaximized();
        if (eWin.webContents && typeof eWin.webContents.zoomLevel === "number") data.zoom = eWin.webContents.zoomLevel;
      } else {
        data.x = win.screenX; data.y = win.screenY;
        data.width = win.outerWidth; data.height = win.outerHeight;
      }
      for (const key of ng40GeomKeys) {
        if (data[key] == null && this.size[key] != null) data[key] = this.size[key];
      }
    }
    return data;
  };

  proto.removeChild = function (node) {
    host.WorkspaceContainer.prototype.removeChild.call(this, node);
    if (this.children.length === 0) this.close();
  };

  proto.detach = function () { this.close(); };

  proto.close = function () {
    const win = this.win;
    if (!win) return;
    this.win = null;
    const workspace = this.workspace;
    const leaves = [];
    workspace.iterateLeaves(this, (leaf) => { leaves.push(leaf); });
    const active = workspace.activeLeaf;
    const wasActive = active && leaves.indexOf(active) !== -1;
    for (const leaf of leaves) leaf.detach();
    if (this.parent) this.parent.removeChild(this);
    this.containerEl.remove();
    if (activeWindow === win) {
      activeWindow = window;
      activeDocument = document;
    }
    if (wasActive) {
      const leaf = workspace.getMostRecentLeaf(workspace.rootSplit);
      if (leaf) workspace.setActiveLeaf(leaf, { focus: true });
    }
    if (this.cleanup) { this.cleanup(); this.cleanup = null; }
    this.component.unload();
    try { win.close(); } catch (e) {}
    workspace.trigger("window-close", this);
  };

  return WorkspaceWindow;
}
