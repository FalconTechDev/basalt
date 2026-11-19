// g20 clean-room: canvas modals and suggestion popups — URL editor, section
// suggester, edge-label editor, jump-to-group, view-type picker, markdown-embed
// settings sync, empty-embed retry, rename/new-file prompts, and the file/media/
// image suggestion lists.
//
// Replaces orig w5/E5/K5/Q5/L5/O5/N5/lI/cI/x3/T3/D3 (canvas-nodes.js).
import { env } from "./env.js";
import { canvas, ng20CanvasStrings } from "./n-g20-shared.js";
import { normalizePath } from "./path.js";

const NG20_NAME_RE = /[\\/:*?"<>|#^[\]]/;

function ng20ValidFilename(name) {
  name = (name || "").trim();
  if (!name) return false;
  if (NG20_NAME_RE.test(name)) return false;
  if (name === "." || name === "..") return false;
  return true;
}

function ng20OwnerApp(owner) { return owner && owner.app ? owner.app : owner; }

// ---- URL edit modal (w5) ------------------------------------------------------------------------

export function defineNg20UrlModal(host) {
  class UrlEditModal extends host.Modal {
    constructor(app, url, onSubmit) {
      super(ng20OwnerApp(app));
      if (typeof url === "function") { onSubmit = url; url = ""; }
      this.url = url || "";
      this.onSubmit = onSubmit;
      this.inputEl = null;
    }

    onOpen() {
      const { contentEl } = this;
      contentEl.addClass("canvas-url-modal");
      this.inputEl = contentEl.createEl("input", { type: "text", cls: "canvas-url-input" });
      this.inputEl.value = this.url;
      this.inputEl.placeholder = "https://…";
      this.errorEl = contentEl.createDiv("canvas-url-error");
      this.errorEl.hide();
      const ok = contentEl.createEl("button", { cls: "mod-cta", text: "OK" });
      ok.addEventListener("click", () => this.submit());
      this.inputEl.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter") this.submit();
        else if (evt.key === "Escape") this.close();
      });
      setTimeout(() => { this.inputEl.focus(); this.inputEl.select(); }, 0);
    }

    submit() {
      const value = (this.inputEl.value || "").trim();
      try {
        new URL(value);
      } catch (err) {
        this.errorEl.setText("Enter a valid URL");
        this.errorEl.show();
        return;
      }
      this.close();
      if (this.onSubmit) this.onSubmit(value);
    }

    onClose() {
      this.contentEl.empty();
    }
  }
  canvas.UrlModal = UrlEditModal;
  canvas.UrlEditModal = UrlEditModal;
  return UrlEditModal;
}

// ---- section suggester (E5) ---------------------------------------------------------------------

export function defineNg20SectionSuggest(host) {
  class SectionSuggest {
    constructor(app, file, onPick) {
      this.app = ng20OwnerApp(app);
      this.file = file;
      this.onPick = onPick;
      this.containerEl = createDiv("suggestion-container canvas-section-suggestions");
      this.containerEl.hide();
    }

    /** Headings and block ids of the file -> [{path, subpath}] entries. */
    items() {
      const out = [];
      if (!this.file) return out;
      const path = this.file.path;
      const cache = this.app.metadataCache.getFileCache(this.file) || {};
      for (const h of cache.headings || []) {
        const sub = h.heading ? "#" + h.heading : "";
        if (sub) out.push({ path, subpath: sub });
      }
      for (const id of Object.keys(cache.blocks || {})) {
        out.push({ path, subpath: "#^" + id });
      }
      return out;
    }

    show(anchorEl) {
      const items = this.items();
      this.containerEl.empty();
      if (items.length === 0) { this.hide(); return; }
      for (const it of items) {
        const row = this.containerEl.createDiv("suggestion-item");
        row.createDiv("suggestion-content").createDiv("suggestion-title").setText(it.subpath);
        row.addEventListener("pointerdown", (evt) => {
          evt.preventDefault(); evt.stopPropagation();
          this.hide();
          if (this.onPick) this.onPick(it);
        });
      }
      document.body.appendChild(this.containerEl);
      const r = anchorEl.getBoundingClientRect();
      this.containerEl.style.left = r.left + "px";
      this.containerEl.style.top = (r.bottom + 4) + "px";
      this.containerEl.show();
    }

    hide() { this.containerEl.detach(); }
  }
  canvas.SectionSuggest = SectionSuggest;
  return SectionSuggest;
}

// ---- edge label editor (K5) ----------------------------------------------------------------------

export function defineNg20EdgeLabel(host) {
  class EdgeLabel extends host.Modal {
    constructor(app, edge, onSubmit) {
      super(ng20OwnerApp(app));
      this.edge = edge;
      this.onSubmit = onSubmit;
    }

    onOpen() {
      const { contentEl } = this;
      contentEl.addClass("canvas-edge-label-modal");
      const input = contentEl.createEl("input", { type: "text", cls: "canvas-edge-label-input" });
      input.value = this.edge ? this.edge.label || "" : "";
      input.placeholder = "Label";
      const ok = contentEl.createEl("button", { cls: "mod-cta", text: "OK" });
      const commit = () => {
        const v = (input.value || "").trim();
        if (this.edge) this.edge.setLabel(v);
        if (this.onSubmit) this.onSubmit(v);
        this.close();
      };
      ok.addEventListener("click", commit);
      input.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter") commit();
        else if (evt.key === "Escape") this.close();
      });
      setTimeout(() => { input.focus(); input.select(); }, 0);
    }

    onClose() { this.contentEl.empty(); }
  }
  canvas.EdgeLabel = EdgeLabel;
  return EdgeLabel;
}

// ---- jump-to-group modal (Q5) --------------------------------------------------------------------

export function defineNg20JumpModal(host) {
  class JumpToGroupModal extends host.Modal {
    constructor(owner, canvas_, onPick) {
      // forms: (view, onPick) | (app, canvas, onPick) | (canvas, onPick)
      if (typeof canvas_ === "function") { onPick = canvas_; canvas_ = null; }
      const isView = owner && owner.canvas && owner.app;
      const app = isView ? owner.app : ng20OwnerApp(owner);
      super(app);
      this.canvas = canvas_ || (isView ? owner.canvas : (owner && owner.nodes ? owner : null));
      this.onPick = onPick;
    }

    groups() {
      return [...(this.canvas ? this.canvas.nodes.values() : [])].filter((n) => n && n.type === "group");
    }

    onOpen() {
      const { contentEl } = this;
      contentEl.addClass("canvas-jump-modal");
      const groups = this.groups();
      if (groups.length === 0) {
        contentEl.createDiv("canvas-jump-empty").setText("No groups on this canvas");
        return;
      }
      for (const g of groups) {
        const row = contentEl.createDiv("canvas-jump-item");
        row.setText(g.label || g.id);
        row.addEventListener("click", () => {
          this.close();
          if (this.canvas && this.canvas.zoomToBbox) this.canvas.zoomToBbox(g.getBBox());
          if (this.onPick) this.onPick(g);
        });
      }
    }

    onClose() { this.contentEl.empty(); }
  }
  canvas.JumpModal = JumpToGroupModal;
  canvas.JumpToGroupModal = JumpToGroupModal;
  return JumpToGroupModal;
}

// ---- view-type suggester (L5) --------------------------------------------------------------------

export function defineNg20ViewTypeSuggest(host) {
  class ViewTypeSuggest extends host.FuzzySuggestModal {
    constructor(owner, leaves, onPick) {
      super(ng20OwnerApp(owner));
      this.leaves = leaves || [];
      this.onPick = onPick;
      this.setPlaceholder("Open canvas in…");
      if (this.inputEl) this.inputEl.addClass("canvas-viewtype-input");
    }

    getItems() {
      return this.leaves.map((leaf, i) => ({
        value: "leaf-" + i,
        display: this.leafName(leaf),
        leaf,
      }));
    }

    getItemText(item) { return item ? item.display : ""; }

    leafName(leaf) {
      try {
        const view = leaf.view;
        return (view && view.getDisplayText && view.getDisplayText()) || "Leaf";
      } catch (e) { return "Leaf"; }
    }

    onChooseItem(item) {
      this.close();
      if (this.onPick && item) this.onPick(item.leaf);
    }
  }
  canvas.ViewTypeSuggest = ViewTypeSuggest;
  return ViewTypeSuggest;
}

// ---- markdown embed settings sync (O5) ------------------------------------------------------------

export function defineNg20MarkdownEmbed(host) {
  class MarkdownEmbed {
    constructor(app, file, containerEl) {
      this.app = ng20OwnerApp(app);
      this.file = file;
      this.containerEl = containerEl;
      this.scope = "";
      this.folded = false;
      this.saveMode = false;
    }

    loadSettings() {
      const key = this.app.appId + "-canvas-embed-" + (this.file ? this.file.path : "");
      const raw = this.app.loadLocalStorage(key);
      if (!raw) return;
      try {
        const d = JSON.parse(raw);
        if (d) { this.scope = d.scope || ""; this.folded = !!d.folded; this.saveMode = !!d.saveMode; }
      } catch (e) { /* corrupt -> defaults */ }
    }

    saveSettings() {
      const key = this.app.appId + "-canvas-embed-" + (this.file ? this.file.path : "");
      this.app.saveLocalStorage(key, JSON.stringify({ scope: this.scope, folded: this.folded, saveMode: this.saveMode }));
    }

    setScope(scope) { this.scope = scope || ""; this.saveSettings(); }
    setFolded(f) { this.folded = !!f; this.containerEl && this.containerEl.toggleClass("is-folded", this.folded); this.saveSettings(); }
    setSaveMode(m) { this.saveMode = !!m; this.saveSettings(); }
  }
  canvas.MarkdownEmbed = MarkdownEmbed;
  return MarkdownEmbed;
}

// ---- empty embed retry (N5) ------------------------------------------------------------------------

export function defineNg20EmptyEmbed(host) {
  class EmptyEmbed {
    constructor(app, file) {
      this.app = ng20OwnerApp(app);
      this.file = file;
      this.containerEl = createDiv("canvas-embed-empty");
      this.retries = 0;
    }

    load() {
      this.render();
      this.scheduleRetry();
    }

    render() {
      this.containerEl.empty();
      this.containerEl.createDiv("canvas-embed-empty-text").setText("Canvas file missing — retrying…");
      const retry = this.containerEl.createDiv("canvas-embed-empty-retry");
      retry.setText("Retry");
      retry.addEventListener("click", () => this.retry());
    }

    scheduleRetry() {
      if (this.retries >= 5) return;
      this.retries++;
      setTimeout(() => this.retry(), 1000 * this.retries);
    }

    retry() {
      const path = this.file && this.file.path ? this.file.path : this.file;
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file) {
        this.containerEl.empty();
        const embed = new canvas.CanvasEmbed({ app: this.app, containerEl: this.containerEl }, file, "");
        embed.load();
        return;
      }
      if (this.app.metadataCache && typeof this.app.metadataCache.trigger === "function") {
        this.app.metadataCache.trigger("changed");
      }
      if (this.retries < 5) this.scheduleRetry();
    }
  }
  canvas.EmptyEmbed = EmptyEmbed;
  return EmptyEmbed;
}

// ---- rename prompt (lI) ---------------------------------------------------------------------------

export function defineNg20RenamePrompt(host) {
  class RenamePrompt extends host.Modal {
    constructor(app, file, onSubmit) {
      super(ng20OwnerApp(app));
      this.file = file;
      this.onSubmit = onSubmit;
    }

    onOpen() {
      const { contentEl } = this;
      contentEl.addClass("canvas-rename-modal");
      const input = contentEl.createEl("input", { type: "text", cls: "canvas-rename-input" });
      input.value = this.file ? this.file.basename : "";
      const err = contentEl.createDiv("canvas-rename-error");
      err.hide();
      const submit = () => {
        const name = (input.value || "").trim();
        if (!ng20ValidFilename(name)) {
          err.setText("Invalid file name");
          err.show();
          return;
        }
        this.close();
        if (this.onSubmit) this.onSubmit(name);
      };
      contentEl.createEl("button", { cls: "mod-cta", text: "Rename" }).addEventListener("click", submit);
      input.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter") submit();
        else if (evt.key === "Escape") this.close();
      });
      setTimeout(() => { input.focus(); input.select(); }, 0);
    }

    onClose() { this.contentEl.empty(); }
  }
  canvas.RenamePrompt = RenamePrompt;
  return RenamePrompt;
}

// ---- new file modal (cI) ---------------------------------------------------------------------------

export function defineNg20NewFileModal(host) {
  class NewFileModal extends host.Modal {
    constructor(app, folder, onSubmit) {
      super(ng20OwnerApp(app));
      this.folder = folder;
      this.onSubmit = onSubmit;
    }

    onOpen() {
      const { contentEl } = this;
      contentEl.addClass("canvas-newfile-modal");
      const input = contentEl.createEl("input", { type: "text", cls: "canvas-newfile-input" });
      input.placeholder = "Untitled";
      const err = contentEl.createDiv("canvas-newfile-error");
      err.hide();
      const submit = () => {
        const name = (input.value || "").trim();
        if (!ng20ValidFilename(name)) {
          err.setText("Invalid file name");
          err.show();
          return;
        }
        const folderPath = this.folder && this.folder.path !== "/" ? this.folder.path : "";
        const path = normalizePath((folderPath ? folderPath + "/" : "") + name + ".md");
        this.close();
        if (this.onSubmit) this.onSubmit(path);
      };
      contentEl.createEl("button", { cls: "mod-cta", text: "Create" }).addEventListener("click", submit);
      input.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter") submit();
        else if (evt.key === "Escape") this.close();
      });
      setTimeout(() => input.focus(), 0);
    }

    onClose() { this.contentEl.empty(); }
  }
  canvas.NewFileModal = NewFileModal;
  return NewFileModal;
}

// ---- suggestion base helpers ------------------------------------------------------------------------

function ng20SuggestItems(owner, exts, display) {
  const app = ng20OwnerApp(owner);
  const files = app.vault.getFiles ? app.vault.getFiles() : [];
  return files
    .filter((f) => exts.includes(f.extension))
    .map((f) => ({ value: f.path, display: display ? display(f) : f.path, file: f }));
}

function ng20MakeSuggest(host, cls, clsName, placeholder) {
  class Suggest extends host.FuzzySuggestModal {
    constructor(owner, onPick, opts = {}) {
      super(ng20OwnerApp(owner));
      this.app = ng20OwnerApp(owner);
      this.onPick = onPick;
      this.setPlaceholder((opts && opts.placeholder) || placeholder);
      if (this.inputEl) this.inputEl.addClass(clsName);
    }
    getItemText(item) { return item ? item.display : ""; }
    onChooseItem(item) {
      this.close();
      if (item && this.onPick) this.onPick(item.value, item.file);
    }
  }
  return Suggest;
}

// ---- file suggestion (x3) -------------------------------------------------------------------------

export function defineNg20FileSuggest(host) {
  class FileSuggest extends ng20MakeSuggest(host, null, "canvas-file-suggest-input", "Search files…") {
    constructor(owner, onPick, opts = {}) {
      super(owner, onPick, opts);
      this.attachments = opts.attachments;
    }
    getItems() {
      const app = this.app;
      const files = this.attachments === "all" && app.vault.getFiles
        ? app.vault.getFiles()
        : app.vault.getMarkdownFiles();
      return files.map((f) => ({ value: f.path, display: f.path.replace(/\.md$/i, ""), file: f }));
    }
  }
  canvas.FileSuggest = FileSuggest;
  return FileSuggest;
}

// ---- media suggestion (T3) --------------------------------------------------------------------------

export function defineNg20MediaSuggest(host) {
  class MediaSuggest extends ng20MakeSuggest(host, null, "canvas-media-suggest-input", "Search media…") {
    getItems() {
      return ng20SuggestItems(this.app, ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "mp4", "webm", "mov", "mp3", "wav", "pdf"]);
    }
  }
  canvas.MediaSuggest = MediaSuggest;
  return MediaSuggest;
}

// ---- image suggestion (D3) ------------------------------------------------------------------------------

export function defineNg20ImageSuggest(host) {
  class ImageSuggest extends ng20MakeSuggest(host, null, "canvas-image-suggest-input", "Search images…") {
    getItems() {
      return ng20SuggestItems(this.app, ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
    }
  }
  canvas.ImageSuggest = ImageSuggest;
  return ImageSuggest;
}

// ---- empty-state helper shared by suggestion popups -------------------------------------------------

export function ng20SuggestEmptyState(suggestEl, text) {
  const empty = suggestEl.createDiv("suggestion-empty");
  empty.setText(text || "No results");
  return empty;
}
