// g36 clean-room: RecentFileTracker — the "open files" list persisted inside
// workspace layouts (spec g36 Part C). Quotas are per kind so images cannot
// starve notes; serialize() yields a plain JSON array, most-recent first.

import { env } from "./env.js";

const NG36_QUOTAS = Object.freeze({ md: 25, canvas: 10, image: 10, other: 10 });

const NG36_RECENT_DEFAULTS = Object.freeze({
  showMarkdown: true,
  showNonAttachments: true,
  showNonImageAttachments: false,
  showImages: false,
  maxCount: 10,
});

function ng36Ext(path) {
  return env().su(path);
}

function ng36KindOf(ext) {
  const e = env();
  if (e.jy.includes(ext)) return "md";
  if (e.Uy.includes(ext)) return "canvas";
  if (e.Vy.includes(ext)) return "image";
  return "other";
}

/** True when `path` passes the getRecentFiles visibility flags. */
function ng36Visible(path, opts) {
  const ext = ng36Ext(path);
  if (ext === "md") return opts.showMarkdown;
  if (ext === "canvas" || ext === "base") return opts.showNonAttachments;
  if (env().Vy.includes(ext)) return opts.showImages;
  return opts.showNonImageAttachments;
}

export function ng36RecentFileTracker(host) {
  return class RecentFileTracker {
    constructor(workspace, vault) {
      this.workspace = workspace;
      this.vault = vault;
      this.lastOpenFiles = [];
      vault.on("create", this.addRecentFile, this);
      vault.on("rename", this.onRename, this);
    }

    load(files) { this.lastOpenFiles = files; }
    serialize() { return this.lastOpenFiles; }

    /** Moves `file.path` to the head, replaying the old list under per-kind quotas. */
    collect(file) {
      if (!file || this.lastOpenFiles[0] === file.path) return;
      const left = { md: NG36_QUOTAS.md, canvas: NG36_QUOTAS.canvas, image: NG36_QUOTAS.image, other: NG36_QUOTAS.other };
      const next = [file.path];
      for (const path of this.lastOpenFiles) {
        if (path === file.path) continue;
        const kind = ng36KindOf(ng36Ext(path));
        if (left[kind] <= 0) continue;
        left[kind] -= 1;
        next.push(path);
      }
      this.lastOpenFiles = next;
    }

    onFileOpen(currentFile, previousFile) {
      if (this.workspace.layoutReady && previousFile) {
        this.collect(previousFile);
        this.workspace.requestSaveLayout();
      }
    }

    addRecentFile(file) {
      if (this.workspace.layoutReady) {
        this.collect(file);
        this.workspace.requestSaveLayout();
      }
    }

    onRename(file, oldPath) {
      if (!this.workspace.layoutReady) return;
      this.lastOpenFiles = this.lastOpenFiles.map((p) => (p === oldPath ? file.path : p));
      this.workspace.requestSaveLayout();
    }

    getRecentFiles(options) {
      const opts = Object.assign({}, NG36_RECENT_DEFAULTS, options);
      const out = [];
      for (const path of this.lastOpenFiles) {
        if (ng36Visible(path, opts)) out.push(path);
        if (out.length >= opts.maxCount) break;
      }
      return out;
    }

    getLastOpenFiles() {
      return this.getRecentFiles({
        showMarkdown: true, showNonAttachments: true,
        showNonImageAttachments: true, showImages: true,
      });
    }
  };
}
