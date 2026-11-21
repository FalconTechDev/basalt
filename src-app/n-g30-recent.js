// g30 clean-room: recent-files tracker + shared image context-menu hook
// (spec g30 part J).
import {env} from "./env.js";

const NG30_QUOTAS = { md: 25, canvas: 10, image: 10, other: 10 };

function ng30KindOf(path) {
  const ext = env().su(path);
  if (env().s12extMarkdown.contains(ext)) return "md";
  if (env().s12extCanvas.contains(ext)) return "canvas";
  if (env().s12extImage.contains(ext)) return "image";
  return "other";
}

function ng30RecentFilesClass() {
  /** Powers "Open recent" suggestions and the workspace layout's recent list. */
  function RecentFiles(workspace, vault) {
    this.workspace = workspace;
    this.vault = vault;
    this.lastOpenFiles = [];
    vault.on("create", this.addRecentFile, this);
    vault.on("rename", this.onRename, this);
  }
  const proto = RecentFiles.prototype;

  proto.load = function (files) {
    this.lastOpenFiles = files || [];
  };

  proto.serialize = function () {
    return this.lastOpenFiles;
  };

  /** Prepends `file.path`, dedupes, then enforces per-kind quotas on the tail. */
  proto.collect = function (file) {
    const path = file.path;
    if (this.lastOpenFiles[0] === path) return;
    const rest = this.lastOpenFiles.filter((p) => p !== path);
    const left = { md: NG30_QUOTAS.md, canvas: NG30_QUOTAS.canvas, image: NG30_QUOTAS.image, other: NG30_QUOTAS.other };
    const kept = [];
    for (const p of rest) {
      const kind = ng30KindOf(p);
      if (left[kind] > 0) {
        left[kind]--;
        kept.push(p);
      }
    }
    this.lastOpenFiles = [path, ...kept];
  };

  proto.onFileOpen = function (leaf, file) {
    if (!this.workspace.layoutReady || !file) return;
    this.collect(file);
    this.workspace.requestSaveLayout();
  };

  proto.addRecentFile = function (file) {
    this.onFileOpen(null, file);
  };

  proto.onRename = function (file, oldPath) {
    if (!this.workspace.layoutReady) return;
    this.lastOpenFiles = this.lastOpenFiles.map((p) => (p === oldPath ? file.path : p));
    this.workspace.requestSaveLayout();
  };

  proto.getLastOpenFiles = function () {
    return this.getRecentFiles({
      showMarkdown: true, showNonAttachments: true,
      showNonImageAttachments: true, showImages: true,
    });
  };

  proto.getRecentFiles = function (options) {
    const o = Object.assign({
      showMarkdown: true, showNonAttachments: true,
      showNonImageAttachments: false, showImages: false, maxCount: 10,
    }, options);
    const out = [];
    for (const path of this.lastOpenFiles) {
      const ext = env().su(path);
      let keep;
      if (ext === "md") keep = o.showMarkdown;
      else if (ext === "canvas" || ext === "base") keep = o.showNonAttachments;
      else if (env().s12extImage.contains(ext)) keep = o.showImages;
      else keep = o.showNonImageAttachments;
      if (keep) out.push(path);
      if (out.length >= o.maxCount) break;
    }
    return out;
  };

  return RecentFiles;
}

let ng30RecentCls = null;

/** `B0` — memoised RecentFiles constructor factory. */
export function ng30RecentFiles(host) {
  if (!ng30RecentCls) ng30RecentCls = ng30RecentFilesClass();
  return ng30RecentCls;
}

// The image context-menu entry delegates to n-g10-s12-livepreview.js, which is
// too heavy for the spec-test module loader — s12-plugins.js registers the real
// implementation here at module eval.
let ng30ImageMenuFn = null;
export function ng30RegisterImageMenu(fn) { ng30ImageMenuFn = fn; }

export function ng30ImageContextMenuEntry(widget, view, containerEl, imgEl, wrapperEl) {
  return ng30ImageMenuFn(widget, view, containerEl, imgEl, wrapperEl);
}
