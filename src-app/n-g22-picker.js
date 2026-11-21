// g22 clean-room: attachment picker widgets — selectable tree rows mirrored
// by a gallery of embed previews, plus URL rows, inside the orphan modal.

import { inherit } from "./inherit.js";
import { defineS20FileTree } from "./n-g22-filetree.js";

// ---------------------------------------------------------------- GalleryItem ----

/** One gallery cell: checkbox + EmbedLoader preview; toggling mirrors `fileItem`. */
export function defineS20GalleryItem(host) {
  function GalleryItem(app, fileItem, component) {
    this.app = app;
    this.fileItem = fileItem;
    this.component = component || null;
    this.el = ng22Div()("download-attachment-item");
    const self = this;
    const cb = this.el.createEl("input", { cls: "file-tree-item-checkbox", attr: { type: "checkbox" } });
    this.checkboxEl = cb;
    cb.checked = fileItem ? fileItem.checked !== false : true;
    const embedWrap = this.el.createDiv("download-attachment-embed");
    this.embedWrap = embedWrap;
    if (fileItem && fileItem.file) {
      try {
        const file = fileItem.file;
        const embed = host.EmbedLoader.load({
          app, linktext: file.path, sourcePath: file.path, containerEl: embedWrap, depth: 0,
        });
        if (embed) {
          this.embed = embed;
          if (component && typeof component.addChild === "function") component.addChild(embed);
          Promise.resolve(embed.loadFile && embed.loadFile()).catch(() => {});
        }
      } catch (e) { /* preview is best-effort */ }
    }
    this.el.addEventListener("click", (ev) => {
      if (ev.target === cb) return;
      self.setChecked(!self.checked);
    });
    cb.addEventListener("click", (ev) => ev.stopPropagation());
    cb.addEventListener("change", () => self.setChecked(cb.checked));
    this.setChecked(cb.checked);
    return this;
  }
  const P = GalleryItem.prototype;

  Object.defineProperty(P, "checked", {
    get() { return this.fileItem ? this.fileItem.checked !== false : this._checked !== false; },
    set(v) { this._checked = v !== false; },
  });

  P.setChecked = function (value) {
    const target = value !== false;
    if (this.fileItem) this.fileItem.setChecked(target);
    else this._checked = target;
    if (this.checkboxEl) this.checkboxEl.checked = target;
    this.el.toggleClass("is-selected", target);
  };

  return GalleryItem;
}

// --------------------------------------------------------- AttachmentsGallery ----

/** `.attachments-gallery` with one GalleryItem per checked-capable file in the tree. */
export function defineS20AttachmentsGallery(host) {
  function AttachmentsGallery(app, containerEl, fileTree, component) {
    this.app = app;
    this.fileTree = fileTree;
    this.component = component || null;
    this.el = ng22Div()("attachments-gallery");
    if (containerEl) containerEl.appendChild(this.el);
    this.items = [];
    const GalleryItemKlass = defineS20GalleryItem(host);
    const files = fileTree && fileTree.files ? Object.keys(fileTree.files) : [];
    for (const path of files) {
      const fileItem = fileTree.files[path];
      this.items.push(new GalleryItemKlass(app, fileItem, component));
      this.el.appendChild(this.items[this.items.length - 1].el);
    }
    return this;
  }
  const P = AttachmentsGallery.prototype;

  P.refresh = function () {
    for (const item of this.items) {
      if (item.fileItem) {
        item.setChecked(item.fileItem.checked !== false);
      }
    }
  };

  return AttachmentsGallery;
}
// ------------------------------------------------------------ UrlAttachmentItem ----

/** External-URL row for the download-attachments gallery: checkbox + label. */
export function defineS20UrlAttachmentItem(host) {
  function UrlAttachmentItem(url) {
    this.url = url;
    this.checked = true;
    this.el = ng22Div()("download-attachment-item");
    const self = this;
    const cb = this.el.createEl("input", { cls: "file-tree-item-checkbox", attr: { type: "checkbox" } });
    this.checkboxEl = cb;
    cb.checked = true;
    this.el.toggleClass("is-selected", true);
    const label = this.el.createSpan({ cls: "file-tree-item-title" });
    label.setText(String(url));
    try { host.setTooltip(label, String(url)); } catch (e) {}
    this.el.addEventListener("click", (ev) => {
      if (ev.target === cb) return;
      self.setChecked(!self.checked);
    });
    cb.addEventListener("click", (ev) => ev.stopPropagation());
    cb.addEventListener("change", () => self.setChecked(cb.checked));
    return this;
  }
  const P = UrlAttachmentItem.prototype;
  P.setChecked = function (value) {
    this.checked = value !== false;
    if (this.checkboxEl) this.checkboxEl.checked = this.checked;
    this.el.toggleClass("is-selected", this.checked);
  };
  return UrlAttachmentItem;
}

// ------------------------------------------------------ OrphanAttachmentsModal ----

/** Picker dialog: toolbar switches between the file tree and the gallery. */
export function defineS20OrphanAttachmentsModal(host) {
  const PromptModal = host.s20PromptModal;
  function OrphanAttachmentsModal(app, files) {
    const self = PromptModal.call(this, app) || this;
    self.app = app;
    self.files = Array.isArray(files) ? files.slice() : [];
    self.viewMode = "tree";
    self.fileTree = null;
    self.gallery = null;
    self.treeWrap = null;
    self.galleryWrap = null;
    self._viewButtons = [];
    self.setCta("mod-warning", ng22Dialogue(host).buttonDelete
      ? ng22Dialogue(host).buttonDelete() : ng22Dialogue(host).buttonConfirm());
    self.modalEl.addClass("mod-scrollable-content", "mod-file-browser");
    return self;
  }
  inherit(OrphanAttachmentsModal, PromptModal);
  const P = OrphanAttachmentsModal.prototype;

  function ng22Dialogue(h) { return h.t.dialogue; }

  P.onOpen = function () {
    PromptModal.prototype.onOpen.call(this);
    const t = host.t.dialogue;
    this.setTitle(t.orphanAttachmentsTitle ? t.orphanAttachmentsTitle() : "Attachments");
    const content = this.contentEl;
    content.empty();
    const desc = content.createDiv("file-browser-description");
    desc.setText(t.orphanAttachmentsDesc({ count: this.files.length }));
    const toolbar = content.createDiv("modal-view-options-toolbar");
    const mkBtn = (icon, tip, mode) => {
      const btn = toolbar.createDiv("clickable-icon modal-view-option");
      host.setIcon(btn, icon);
      try { host.setTooltip(btn, tip); } catch (e) {}
      btn.addEventListener("click", () => this.setViewMode(mode));
      this._viewButtons.push({ mode, el: btn });
      return btn;
    };
    mkBtn("lucide-list", t.tooltipFileTree ? t.tooltipFileTree() : "Tree", "tree");
    mkBtn("lucide-image", t.tooltipGallery ? t.tooltipGallery() : "Gallery", "gallery");
    const views = content.createDiv("file-browser-views");
    this.treeWrap = views.createDiv();
    this.galleryWrap = views.createDiv();
    const FileTreeKlass = defineS20FileTree(host);
    this.fileTree = new FileTreeKlass(this.treeWrap);
    for (const file of this.files) this.fileTree.addFile(file, host);
    this.fileTree.render();
    this.gallery = new (defineS20AttachmentsGallery(host))(this.app, this.galleryWrap, this.fileTree, this.component);
    this.setViewMode(this.viewMode);
  };

  P.setViewMode = function (mode) {
    this.viewMode = mode === "gallery" ? "gallery" : "tree";
    for (const b of this._viewButtons) b.el.toggleClass("is-active", b.mode === this.viewMode);
    const tree = this.fileTree && this.fileTree.containerEl;
    if (tree) tree.style.display = this.viewMode === "tree" ? "" : "none";
    if (this.gallery && this.gallery.el) this.gallery.el.style.display = this.viewMode === "gallery" ? "" : "none";
    if (this.treeWrap) this.treeWrap.toggle(this.viewMode === "tree");
    if (this.galleryWrap) this.galleryWrap.toggle(this.viewMode === "gallery");
    if (this.gallery && this.gallery.refresh) this.gallery.refresh();
  };

  P.getCheckedFiles = function () {
    return this.fileTree ? this.fileTree.getCheckedFiles() : [];
  };

  P.onClickOutside = function () {};

  P.onClose = function () {
    PromptModal.prototype.onClose.call(this);
    if (this.component && typeof this.component.unload === "function") {
      try { this.component.unload(); } catch (e) {}
    }
  };

  return OrphanAttachmentsModal;
}
// __END__
