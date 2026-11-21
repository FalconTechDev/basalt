// g22 clean-room: app.fileManager — creation/rename/delete/link-update ops.
// Own architecture: the 13 hot methods are delegated to the g13 vault helpers
// (fm*); the rest are implemented here on top of vault/metadataCache contracts.

import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { parentPath, baseName, extensionOf, escapeLinkChars, normalizePath, lastSegment } from "./path.js";
import { frontmatterBounds } from "./notes-utils.js";
import { s20MergeFrontmatter, s20DeepMerge, s20FrontmatterText, s20LinkUpdateForRename } from "./s20-frontmatter.js";
import { applyLinkUpdates, SerialTaskQueue } from "./n-g22-helpers.js";
import { fileClass } from "./n-g13-vault.js";

const ng22FMFile = () => fileClass("TFile");

export function defineS20FileManager(host) {
  function FileManager(app) {
    const self = this;
    self.app = app;
    self.vault = app.vault;
    self.fileParentCreatorByType = {
      md: function (sourcePath) { return fmMarkdownNewFileParent.call(self, sourcePath); },
    };
    self.updateQueue = new SerialTaskQueue();
    self.inProgressUpdates = null;
    return self;
  }
  const P = FileManager.prototype;

  // ---- delegated creation/rename/trash helpers (implemented in n-g13-vault.js) ----
  P.getMarkdownNewFileParent = function () { return fmMarkdownNewFileParent.apply(this, arguments); };
  P.getNewFileParent = function () { return fmNewFileParent.apply(this, arguments); };
  P.registerFileParentCreator = function () { return fmRegisterFileParentCreator.apply(this, arguments); };
  P.unregisterFileCreator = function () { return fmUnregisterFileCreator.apply(this, arguments); };
  P.canCreateFileWithExt = function () { return fmCanCreateFileWithExt.apply(this, arguments); };
  P.createNewMarkdownFileFromLinktext = function () { return fmCreateNewMarkdownFileFromLinktext.apply(this, arguments); };
  P.createNewMarkdownFile = function () { return fmCreateNewMarkdownFile.apply(this, arguments); };
  P.createNewFile = function () { return fmCreateNewFile.apply(this, arguments); };
  P.createNewFolder = function () { return fmCreateNewFolder.apply(this, arguments); };
  P.renameFile = function () { return fmRenameFile.apply(this, arguments); };
  P.runAsyncLinkUpdate = function () { return fmRunAsyncLinkUpdate.apply(this, arguments); };
  P.trashFile = function () { return fmTrashFile.apply(this, arguments); };
  P.getAvailablePathForAttachment = function () { return fmGetAvailablePathForAttachment.apply(this, arguments); };

  // ------------------------------------------------------------- link text ----

  P.generateMarkdownLink = function (file, sourcePath, subpath, alias) {
    const vault = this.vault;
    const mc = this.app.metadataCache;
    subpath = subpath || "";
    const src = typeof sourcePath === "string" ? sourcePath : sourcePath && sourcePath.path;
    const isSelf = !!(src && file && file.path === src);
    if (vault.getConfig("useMarkdownLinks")) {
      const dest = isSelf && subpath ? subpath : escapeLinkChars(mc.fileToLinktext(file, src, false));
      let text = alias;
      if (text == null || text === "") {
        text = file.extension === "md" ? baseName(file.path) : "";
      }
      return "[" + text + "](" + dest + ")";
    }
    let target;
    if (isSelf) target = subpath;
    else target = mc.fileToLinktext(file, src, true) + subpath;
    let out = "[[" + target;
    if (alias && String(alias).toLowerCase() !== target.toLowerCase()) out += "|" + alias;
    return out + "]]";
  };

  P.getAllLinkResolutions = function () {
    return this.app.metadataCache.resolvedLinks || {};
  };
  // --------------------------------------------------------- link updates ----

  /** Applies the collected rename edits; prompts unless alwaysUpdateLinks. */
  P.updateAllLinks = async function (updates) {
    const app = this.app;
    const mc = app.metadataCache;
    const bySource = new Map();
    let linkCount = 0;
    for (const change of updates || []) {
      const edit = s20LinkUpdateForRename(change, mc, host);
      if (!edit) continue;
      let list = bySource.get(edit.sourcePath);
      if (!list) bySource.set(edit.sourcePath, (list = []));
      list.push({ change: edit.change, reference: edit.reference });
      linkCount++;
    }
    if (!bySource.size) return;
    const t = host.t.dialogue;
    let apply = !!this.vault.getConfig("alwaysUpdateLinks");
    if (!apply) {
      apply = await new Promise((resolve) => {
        const modal = new host.ButtonModal(app)
          .setTitle(t.labelUpdateLinks())
          .setContent(t.labelConfirmUpdateLinkToFile());
        modal.addButton("mod-cta", t.buttonAlwaysUpdate(), () => { this.vault.setConfig("alwaysUpdateLinks", true); resolve(true); modal.close(); });
        modal.addButton("", t.buttonJustOnce(), () => { resolve(true); modal.close(); });
        modal.addButton("", t.buttonDoNotUpdate(), () => { resolve(false); modal.close(); });
        modal.open();
      });
    }
    if (!apply) return;
    let files = 0;
    for (const [sourcePath, edits] of bySource) {
      const file = this.vault.getAbstractFileByPath(sourcePath);
      if (!(file instanceof ng22FMFile())) continue;
      await this.vault.process(file, (data) => applyLinkUpdates(data, edits));
      files++;
    }
    if (files > 0) new host.Notice(t.msgUpdatedLinks({ links: linkCount, files }));
  };

  // --------------------------------------------------------- frontmatter ----

  P.deleteProperty = async function (key) {
    const files = this.vault.getMarkdownFiles ? this.vault.getMarkdownFiles() : this.vault.getFiles().filter((f) => f.extension === "md");
    for (const file of files) {
      await this.processFrontMatter(file, (fm) => { delete fm[key]; });
    }
  };

  P.renameProperty = async function (from, to) {
    if (from === to) return;
    const files = this.vault.getMarkdownFiles ? this.vault.getMarkdownFiles() : this.vault.getFiles().filter((f) => f.extension === "md");
    for (const file of files) {
      await this.processFrontMatter(file, (fm) => {
        if (Object.prototype.hasOwnProperty.call(fm, from)) {
          fm[to] = fm[from];
          delete fm[from];
        }
      });
    }
  };

  P.processFrontMatter = async function (file, mutate, options) {
    if (!file || file.extension !== "md") return;
    const vault = this.vault;
    await vault.process(file, async (data) => {
      const bounds = frontmatterBounds(data);
      let fm = bounds.exists ? host.parseYaml(bounds.frontmatter) : {};
      if (!fm || typeof fm !== "object") fm = {};
      await mutate(fm);
      if (Object.keys(fm).length === 0) return bounds.exists ? data.slice(bounds.contentStart) : data;
      const yaml = host.yamlStringify(fm);
      return bounds.exists ? data.slice(0, bounds.from) + yaml + data.slice(bounds.to) : "---\n" + yaml + "---\n" + data;
    });
  };

  /** Merges a text snippet into a note: frontmatter deep-merged, bodies joined. */
  P.insertIntoFile = async function (file, text, position) {
    if (!file) return;
    const pos = typeof position === "string" ? position : position && position.position;
    const prepend = pos === "prepend" || pos === "start";
    const t = host.t.properties || {};
    const invalid = () => new host.Notice(t.msgInvalidProperties ? t.msgInvalidProperties() : "Invalid properties");
    const merged = await this.vault.process(file, (data) => {
      const a = ng22SplitFm(data, host, invalid);
      const b = ng22SplitFm(text, host, invalid);
      const fm = {};
      s20DeepMerge(fm, b.frontmatter);
      s20DeepMerge(fm, a.frontmatter);
      const bodyA = a.content.replace(/\s+$/, "");
      const bodyB = b.content.replace(/^\s+|\s+$/g, "");
      const body = prepend
        ? (bodyB ? bodyB + (bodyA ? "\n\n" + bodyA : "") : bodyA)
        : (bodyA ? bodyA + (bodyB ? "\n\n" + bodyB : "") : bodyB);
      return s20FrontmatterText(fm, host) + body + (body ? "\n" : "");
    });
    return merged;
  };
  // ------------------------------------------------------------ deletion ----

  /** Non-md files whose only inbound resolved link comes from `file`. */
  P._orphanedAttachments = function (file) {
    const mc = this.app.metadataCache;
    const resolved = mc.resolvedLinks || {};
    const targets = resolved[file.path] || {};
    const out = [];
    for (const targetPath of Object.keys(targets)) {
      const target = this.vault.getAbstractFileByPath(targetPath);
      if (!target || target === file || target.children) continue;
      if (target.extension === "md") continue;
      let shared = false;
      for (const src of Object.keys(resolved)) {
        if (src === file.path) continue;
        if (resolved[src] && resolved[src][targetPath]) { shared = true; break; }
      }
      if (!shared) out.push(target);
    }
    return out;
  };

  P.promptForFolderDeletion = async function (file) {
    const t = host.t.dialogue;
    const hasKids = !!(file && file.children && file.children.length);
    const ok = await new Promise((resolve) => {
      const modal = new host.ButtonModal(this.app)
        .setTitle(t.labelDeleteFolder ? t.labelDeleteFolder() : "Delete folder")
        .setContent(hasKids && t.labelFolderDeleteWarning ? t.labelFolderDeleteWarning() : (file ? file.path : ""));
      modal.addButton("mod-warning", t.buttonDelete(), () => { resolve(true); modal.close(); });
      modal.addCancelButton(() => resolve(false));
      modal.open();
    });
    if (!ok) return false;
    await this.trashFile(file);
    return true;
  };

  P.promptForFileDeletion = async function (file) {
    if (!file) return false;
    const vault = this.vault;
    const t = host.t.dialogue;
    const mode = vault.getConfig("deleteUnlinkedAttachments") || "never";
    const orphans = mode === "never" ? [] : this._orphanedAttachments(file);
    let chosen = [];
    if (orphans.length && mode === "ask") {
      const OrphanModal = ng22OrphanModal(host);
      const modal = new OrphanModal(this.app, orphans);
      const ok = await modal.prompt();
      if (!ok) return false;
      chosen = modal.getCheckedFiles();
    } else if (mode === "always") {
      chosen = orphans;
    }
    if (vault.getConfig("promptDelete")) {
      const ok = await new Promise((resolve) => {
        const modal = new host.ButtonModal(this.app)
          .setTitle(t.labelDeleteFile())
          .setContent(t.labelConfirmDeletion({ filename: file.name }));
        modal.addButton("mod-warning", t.buttonDelete(), () => { resolve(true); modal.close(); });
        modal.addCancelButton(() => resolve(false));
        modal.open();
      });
      if (!ok) return false;
    }
    await this.trashFile(file);
    for (const f of chosen) { try { await this.trashFile(f); } catch (e) {} }
    return true;
  };

  P.promptForDeletion = function (file) {
    if (!file) return Promise.resolve(false);
    if (file.children) return this.promptForFolderDeletion(file);
    return this.promptForFileDeletion(file);
  };

  P.promptForFileRename = function (file) {
    const Modal = ng22FileRenameModal(host);
    const modal = new Modal(this.app, file);
    modal.open();
    return modal;
  };
  // -------------------------------------------------------- attachments ----

  /** Downloads every remote image referenced by `file` into the vault. */
  P.downloadAttachmentsForNote = async function (file) {
    const app = this.app;
    const t = host.t.dialogue;
    if (!file || file.extension !== "md") return;
    const text = await this.vault.read(file);
    const urls = new Set();
    const fm = ng22SplitFm(text, host, () => {}).frontmatter;
    for (const key of Object.keys(fm || {})) {
      const v = fm[key];
      const vals = Array.isArray(v) ? v : [v];
      for (const item of vals) {
        const s = String(item == null ? "" : item).trim();
        if (/^https?:\/\//i.test(s) && /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?|#|$)/i.test(s)) urls.add(s);
      }
    }
    const mdImg = /!?\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
    let m;
    while ((m = mdImg.exec(text))) urls.add(m[1]);
    const wikiImg = /!?\[\[([^\]|]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif))(?:\|[^\]]*)?\]\]/gi;
    while ((m = wikiImg.exec(text))) {
      const target = m[1];
      if (/^https?:\/\//i.test(target)) urls.add(target);
    }
    if (!urls.size) {
      new host.Notice(t.labelNoAttachments());
      return;
    }
    const items = await this.promptForImageDownload(Array.from(urls));
    if (!items || !items.length) return;
    const saved = [];
    for (const item of items) {
      if (!item.checked) continue;
      try {
        const dest = await app.saveAttachment(item.data, item.name);
        if (dest) saved.push({ url: item.url, link: "[[" + dest.path + "]]", name: dest.path });
      } catch (e) {}
    }
    if (!saved.length) return;
    await this.vault.process(file, (data) => {
      let out = data;
      for (const s of saved) out = out.split(s.url).join(s.link);
      return out;
    });
    new host.Notice(t.labelDownloadedAttachments({ count: saved.length }));
  };

  /** Fetches remote images and shows the checkbox picker; resolves chosen items. */
  P.promptForImageDownload = async function (urls) {
    const app = this.app;
    const items = [];
    for (const url of urls || []) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const ct = res.headers.get("content-type") || "";
        if (!/^image\//i.test(ct)) continue;
        const buf = await res.arrayBuffer();
        if (!buf || !buf.byteLength) continue;
        let name = "";
        const cd = res.headers.get("content-disposition") || "";
        const fn = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i);
        if (fn) name = decodeURIComponent(fn[1].trim());
        if (!name) {
          const ext = ng22MimeExt(ct) || ng22UrlExt(url) || "jpg";
          name = "Image." + ext;
        }
        name = ng22SafeName(name);
        if (!name) continue;
        items.push({ url, name, data: buf, checked: true });
      } catch (e) {}
    }
    if (!items.length) { new host.Notice(host.t.dialogue.labelNoAttachments()); return []; }
    const UrlItem = ng22UrlItem(host);
    const chosen = await new Promise((resolve) => {
      const modal = new host.ButtonModal(app).setTitle(host.t.dialogue.labelDownloadAttachments()).setContent("");
      const wrap = modal.contentEl.createDiv();
      const rows = items.map((it, i) => {
        const row = new UrlItem(it.url);
        row._item = it;
        wrap.appendChild(row.el);
        return row;
      });
      modal.addButton("mod-cta", host.t.dialogue.buttonDownload(), () => {
        resolve(rows.filter((r) => r.checked).map((r) => ({ url: r._item.url, name: r._item.name, data: r._item.data, checked: true })));
        modal.close();
      });
      modal.addCancelButton(() => { resolve([]); modal.close(); });
      modal.open();
    });
    return chosen;
  };
  // ------------------------------------------------------------- misc ----

  P.createAndOpenMarkdownFile = async function (name, leafParam) {
    const parent = this.getMarkdownNewFileParent("");
    const file = await this.createNewMarkdownFile(parent, name || null);
    if (file && this.app.workspace) {
      const leaf = leafParam === "split" ? this.app.workspace.getLeaf("split") : this.app.workspace.getLeaf(leafParam || "tab");
      if (leaf) await leaf.openFile(file);
    }
    return file;
  };

  /** Best-effort snapshot into the file-recovery plugin (absent -> silent no-op). */
  P.storeTextFileBackup = function (file, content) {
    try {
      const plugins = this.app.internalPlugins;
      const wrapper = plugins && plugins.getPluginById ? plugins.getPluginById("file-recovery") : null;
      const inst = wrapper && (wrapper.instance || wrapper);
      if (inst && typeof inst.forceAdd === "function") inst.forceAdd(file, content);
    } catch (e) {}
  };

  /** Notice with an undo button; clicking rewrites contents through the queue. */
  P.notifyForBulkUndo = function (updates, timeout) {
    const t = host.t.dialogue;
    const list = Array.isArray(updates) ? updates.filter((u) => u && u.file) : [];
    if (!list.length) return;
    const notice = new host.Notice(t.msgFilesUpdated({ count: list.length }), timeout == null ? 30000 : timeout);
    const btn = notice.containerEl.createEl("button", { cls: "notice-cta", text: t.buttonUndo ? t.buttonUndo() : "Undo" });
    btn.addEventListener("click", async () => {
      await this.runAsyncLinkUpdate(async () => {
        for (const u of list) {
          const file = u.file;
          const path = file && file.path ? file.path : file;
          const target = this.vault.getAbstractFileByPath(path);
          if (!target) continue;
          await this.vault.process(target, () => u.content);
          if (u.mtime != null && target.stat) target.stat.mtime = u.mtime;
        }
      });
      new host.Notice(t.msgFilesReverted({ count: list.length }));
    });
    return notice;
  };

  return FileManager;
}

// ------------------------------------------------------------ helpers ----

let ng22OrphanModalC = null;
let ng22FileRenameModalC = null;
let ng22UrlItemC = null;
function ng22OrphanModal(host) {
  if (!ng22OrphanModalC) ng22OrphanModalC = defineS20OrphanAttachmentsModal(host);
  return ng22OrphanModalC;
}
function ng22FileRenameModal(host) {
  if (!ng22FileRenameModalC) ng22FileRenameModalC = defineS20FileRenameModal(host);
  return ng22FileRenameModalC;
}
function ng22UrlItem(host) {
  if (!ng22UrlItemC) ng22UrlItemC = defineS20UrlAttachmentItem(host);
  return ng22UrlItemC;
}

function ng22SplitFm(text, host, onInvalid) {
  const bounds = frontmatterBounds(text);
  const content = text.slice(bounds.contentStart);
  let frontmatter = {};
  if (bounds.frontmatter) {
    try {
      const parsed = host.parseYaml(bounds.frontmatter);
      frontmatter = parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      if (onInvalid) onInvalid();
      frontmatter = {};
    }
  }
  return { content, frontmatter };
}

const NG22_MIME_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp", "image/avif": "avif" };
function ng22MimeExt(ct) { return NG22_MIME_EXT[String(ct).split(";")[0].trim().toLowerCase()] || ""; }
function ng22UrlExt(url) {
  const m = String(url).split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : "";
}
function ng22SafeName(name) {
  let out = String(name || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  out = out.replace(/^\.+/, "").slice(0, 200);
  return out;
}
