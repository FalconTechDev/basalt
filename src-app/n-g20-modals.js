// g20 clean-room: canvas modals and suggestion popups — URL editor, section
// suggester, edge-label editor, jump-to-group, view-type picker, markdown-embed
// settings sync, empty-embed retry, rename/new-file prompts, and the file/media/
// image suggestion lists.
//
// Replaces orig w5/E5/K5/Q5/L5/O5/N5/lI/cI/x3/T3/D3 (canvas-nodes.js).
import { env } from "./env.js";
import { canvas, ng20CanvasStrings } from "./n-g20-shared.js";
import { normalizePath } from "./path.js";
import { pointOfEvent } from "./misc.js";

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

// ---- edge label (K5) -----------------------------------------------------------------------------
// Inline contenteditable label pinned to the edge midpoint (orig K5).

export function defineNg20EdgeLabel(host) {
  class EdgeLabel {
    constructor(edge) {
      this.isEditing = false;
      this.initialTextState = "";
      this.edge = edge;
      const canvas_ = edge.canvas;
      this.wrapperEl = canvas_.canvasEl.createDiv("canvas-path-label-wrapper");
      this.wrapperEl.addEventListener("click", (evt) => {
        if (canvas_.readonly) return;
        if (evt.shiftKey) {
          this.blur();
          canvas_.toggleSelect(edge);
          return;
        }
        const selection = canvas_.selection;
        if (selection.size === 1 && selection.has(edge)) {
          if (!this.isEditing) this.focus(pointOfEvent(evt));
        } else {
          canvas_.selectOnly(edge);
        }
      });
      this.textareaEl = this.wrapperEl.createDiv(
        { cls: "canvas-path-label", text: edge.label || "", attr: { contenteditable: "false", "data-placeholder": ng20CanvasStrings().promptAddText ? ng20CanvasStrings().promptAddText() : "Add text" } },
        (el) => {
          el.addEventListener("input", () => {
            this.edge.label = el.innerText;
            this.edge.canvas.requestSave(false);
          });
          if (!edge.label) setTimeout(() => this.focus());
        },
      );
      this.render();
    }

    setText(text) {
      this.textareaEl.setText(text || "");
    }

    focus(point) {
      const el = this.textareaEl;
      this.isEditing = true;
      el.setAttr("contenteditable", "true");
      el.addClass("is-editing");
      let range;
      if (point) {
        range = el.doc.caretRangeFromPoint(point.x, point.y);
      } else {
        range = el.doc.createRange();
        range.selectNodeContents(el);
      }
      const selection = el.win.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      el.focus();
      this.initialTextState = this.edge.label || "";
    }

    blur() {
      const el = this.textareaEl;
      this.isEditing = false;
      el.blur();
      el.setAttr("contenteditable", "false");
      el.removeClass("is-editing");
      if (this.edge.label) {
        if (this.initialTextState !== this.edge.label) this.edge.canvas.requestSave();
      } else {
        this.destroy();
      }
      this.initialTextState = "";
    }

    render() {
      const el = this.wrapperEl;
      const center = this.edge.getCenter();
      el.style.transform = `translate(${center.x}px, ${center.y}px)`;
      if (host.applyCanvasColor) host.applyCanvasColor(el, this.edge.color);
      el.toggleClass("is-themed", !!this.edge.color);
    }

    destroy(keepLabel) {
      const edge = this.edge;
      if (edge.label && !keepLabel) delete edge.label;
      if (this.initialTextState && !keepLabel) edge.canvas.requestSave();
      this.wrapperEl.remove();
      edge.labelElement = null;
    }
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
  /** Markdown preview/editor mounted inside a canvas text node (orig O5). */
  class CanvasMarkdownEmbed extends host.MarkdownEmbedBase {
    constructor(node) {
      super(node.app, node.contentEl, null);
      this.editable = true;
      this.useIframe = true;
      this.scope = null;
      this.node = node;
      this.containerEl.addClass("markdown-embed");
    }

    save(content, force) {
      super.save(content, force);
      if (force && this.node.text !== content) {
        this.node.text = content;
        this.node.canvas.requestSave();
      }
    }

    applyScope(scope) {
      if (scope === this.scope) return;
      if (this.scope) this.app.keymap.popScope(this.scope);
      if (scope) this.app.keymap.pushScope(scope);
      this.scope = scope;
    }

    onunload() {
      super.onunload();
      this.applyScope(null);
    }

    get linktext() {
      const node = this.node;
      const file = node.canvas.view && node.canvas.view.file;
      return (file ? file.path : "") + "#^" + node.id;
    }

    getFoldInfo() {
      return this.app.foldManager.loadPath(this.linktext);
    }

    onMarkdownFold() {
      const info = this.getMode() === "preview"
        ? this.previewMode.renderer.getFoldInfo()
        : this.editMode.getFoldInfo();
      this.app.foldManager.savePath(this.linktext, info);
    }
  }
  canvas.MarkdownEmbed = CanvasMarkdownEmbed;
  return CanvasMarkdownEmbed;
}

// ---- empty embed retry (N5) ------------------------------------------------------------------------

export function defineNg20EmptyEmbed(host) {
  /** Shown inside a file node when its target file does not exist yet (orig N5). */
  class EmptyEmbed extends host.Component {
    constructor(ctx, node, reload) {
      super();
      this.app = ctx.app;
      this.file = null;
      this.ctx = ctx;
      this.node = node;
      this.reload = reload;
      this.containerEl = ctx.containerEl;
    }

    async loadFile() {
      const containerEl = this.containerEl;
      const ctx = this.ctx;
      const app = ctx.app;
      const linktext = ctx.linktext;
      const sourcePath = ctx.sourcePath;
      const node = this.node;
      const canvas_ = node.canvas;
      if (node.contentBlockerEl) node.contentBlockerEl.detach();
      const path = (linktext || "").split("#")[0].split("|")[0];
      const ext = path.includes(".") ? path.split(".").pop().toLowerCase() : "";
      containerEl.createDiv("canvas-empty-embed-container", (el) => {
        el.createDiv({ cls: "canvas-empty-embed-label", text: ng20CanvasStrings().labelEmptyEmbed ? ng20CanvasStrings().labelEmptyEmbed({ linktext }) : "Empty embed" });
        el.createDiv("canvas-empty-embed-action-list", (list) => {
          if (ext === "md" || ext === "") {
            list.createEl("button", { cls: "empty-state-action", text: ng20InterfaceStrings().emptyState.createNewFile() }, (btn) => {
              btn.addEventListener("click", () => {
                app.fileManager.createNewMarkdownFileFromLinktext(linktext, sourcePath);
              });
            });
          }
          list.createEl("button", { cls: "empty-state-action", text: ng20CanvasStrings().actionSwapFile ? ng20CanvasStrings().actionSwapFile() : "Swap file" }, (btn) => {
            btn.addEventListener("click", () => {
              new canvas.FileSuggest(canvas_, (file) => {
                node.setFile(file, "", canvas_.requestSave());
              }).open();
            });
          });
          list.createEl("button", { cls: "empty-state-action mod-warning", text: ng20CanvasStrings().actionRemove ? ng20CanvasStrings().actionRemove() : "Remove" }, (btn) => {
            btn.addEventListener("click", () => {
              canvas_.removeNode(node);
              canvas_.requestSave();
            });
          });
        });
      });
      containerEl.addClass("mod-canvas-empty");
    }

    onload() {
      const ctx = this.ctx;
      const app = ctx.app;
      const linktext = ctx.linktext;
      const onFileEvent = () => {
        const parsedPath = (linktext || "").split("#")[0].split("|")[0];
        const file = app.vault.getAbstractFileByPath(parsedPath);
        if (file && file.path === parsedPath) {
          this.node.setFile(file, "", true);
        }
      };
      if (app.vault && app.vault.on) {
        this.registerEvent(app.vault.on("create", onFileEvent));
        this.registerEvent(app.vault.on("rename", onFileEvent));
      }
    }

    onClick(evt) {
      const ctx = this.ctx;
      ctx.app.workspace.openLinkText(ctx.linktext, ctx.sourcePath, host.Keymap.isModEvent(evt));
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
