// Embeds: the media-embed base and the image/audio/video/file/fallback embed classes, the
// extension->creator registry, the video file view and the markdown note embed (the class that
// powers "![[note]]" with its inline title, properties editor and subpath support).
//
// Inherited neighbours are reached through `host` (__basaltHost) and `env()`; the pdf embed
// creator stays in s27-pdf.js and is reached through the host binding for the YZ var.

import { inherit } from "./inherit.js";
import { hostEnv } from "./env.js";
import { subpathKind } from "./path.js";
import { s05ExtractSubpath } from "./s05-markdown.js";

/** View type / extension literal shared by the video view and its declarator replacement (was `QZ`). */
export const s27VideoViewType = "video";

/** localStorage-free embed depth tracker shared with the inherited embed loader (was `ZZ`). */
export const s27EmbedDepths = new WeakMap();

/** Error tooltip used by the embed title editor (was `$Z`). */
export function s27ShowEmbedError(el, text, autoHide) {
  hostEnv().kv(el, text, { classes: ["mod-wide", "mod-error"] });
  if (autoHide) setTimeout(() => hostEnv().Cv(), 2000);
}

// The classes reference each other (media base -> concrete embeds -> registry -> markdown/pdf
// embeds); they are built lazily so each factory can run at its original bundle position.
const s27EmbedKit = {};
function s27EmbedClass(host, key, make) {
  return s27EmbedKit[key] || (s27EmbedKit[key] = make(host));
}

export function s27MediaEmbedClass(host) { return s27EmbedClass(host, "media", () => buildS27MediaEmbed(host)); }
export function s27ImageEmbedClass(host) { return s27EmbedClass(host, "image", () => buildS27ImageEmbed(host)); }
export function s27AudioEmbedClass(host) { return s27EmbedClass(host, "audio", () => buildS27AudioEmbed(host)); }
export function s27VideoEmbedClass(host) { return s27EmbedClass(host, "videoEmbed", () => buildS27VideoEmbed(host)); }
export function s27FileEmbedClass(host) { return s27EmbedClass(host, "file", () => buildS27FileEmbed(host)); }
export function s27FallbackEmbedClass(host) { return s27EmbedClass(host, "fallback", () => buildS27FallbackEmbed(host)); }
export function s27VideoViewClass(host) { return s27EmbedClass(host, "videoView", () => buildS27VideoView(host)); }
export function s27EmbedRegistryClass(host) { return s27EmbedClass(host, "registry", () => buildS27EmbedRegistry(host)); }
export function s27MarkdownEmbedClass(host) { return s27EmbedClass(host, "markdown", () => buildS27MarkdownEmbed(host)); }

function buildS27MediaEmbed(host) {
  /** Base for media embeds: tracks app/container/file and clears media elements on unload. */
  function MediaEmbed(ctx, file) {
    const self = host.Component.call(this) || this;
    self.app = ctx.app;
    self.containerEl = ctx.containerEl;
    self.file = file;
    self.containerEl.addClass("media-embed");
    return self;
  }
  inherit(MediaEmbed, host.Component);
  const proto = MediaEmbed.prototype;

  proto.onload = function () { host.Component.prototype.onload.call(this); };

  proto.onunload = function () {
    host.s27StopMedia(this.containerEl);
    host.Component.prototype.onunload.call(this);
  };

  return MediaEmbed;
}

function buildS27ImageEmbed(host) {
  /** Image embed: delegates rendering to the image file view's displayInEl. */
  function ImageEmbed(ctx, file) {
    const self = s27EmbedClass(host, "media", () => buildS27MediaEmbed(host)).call(this, ctx, file) || this;
    self.containerEl.addClass("image-embed");
    return self;
  }
  inherit(ImageEmbed, s27EmbedClass(host, "media", () => buildS27MediaEmbed(host)));
  const proto = ImageEmbed.prototype;

  proto.loadFile = function () {
    return host.ImageView.displayInEl(this.file, this.app, this.containerEl);
  };

  return ImageEmbed;
}

function buildS27AudioEmbed(host) {
  /** Audio embed: delegates rendering to the audio file view's displayInEl. */
  function AudioEmbed(ctx, file) {
    const self = s27EmbedClass(host, "media", () => buildS27MediaEmbed(host)).call(this, ctx, file) || this;
    self.containerEl.addClass("audio-embed");
    return self;
  }
  inherit(AudioEmbed, s27EmbedClass(host, "media", () => buildS27MediaEmbed(host)));
  const proto = AudioEmbed.prototype;

  proto.loadFile = function () {
    return host.AudioView.displayInEl(this.file, this.app, this.containerEl);
  };

  return AudioEmbed;
}

function buildS27VideoEmbed(host) {
  /** Video embed: delegates rendering to the video file view's displayInEl. */
  function VideoEmbed(ctx, file) {
    const self = s27EmbedClass(host, "media", () => buildS27MediaEmbed(host)).call(this, ctx, file) || this;
    self.containerEl.addClass("video-embed");
    return self;
  }
  inherit(VideoEmbed, s27EmbedClass(host, "media", () => buildS27MediaEmbed(host)));
  const proto = VideoEmbed.prototype;

  proto.loadFile = function () {
    return host.VideoView.displayInEl(this.file, this.app, this.containerEl);
  };

  return VideoEmbed;
}

function buildS27FileEmbed(host) {
  /** Generic file embed: shows the file icon/name header and opens the link on click. */
  function FileEmbed(ctx, file, subpath) {
    const self = host.Component.call(this) || this;
    self.app = ctx.app;
    self.ctx = ctx;
    self.containerEl = ctx.containerEl;
    self.containerEl.addClass("file-embed", "mod-generic");
    self.file = file;
    self.subpath = subpath;
    self.headerEl = self.containerEl.createDiv({ cls: "file-embed-title" }, (el) => {
      el.createSpan({ cls: "file-embed-icon" }, (icon) => host.setIcon(icon, "lucide-file"));
      el.appendText(" " + self.file.name);
    });
    return self;
  }
  inherit(FileEmbed, host.Component);
  const proto = FileEmbed.prototype;

  proto.loadFile = async function () {
    const containerEl = this.containerEl;
    const ctx = this.ctx;
    const app = this.app;
    containerEl.addEventListener("click", (evt) => {
      app.workspace.getLeaf(host.Keymap.isModEvent(evt)).openLinkText(ctx.linktext, ctx.sourcePath);
    });
  };

  return FileEmbed;
}

function buildS27FallbackEmbed(host) {
  /** Fallback embed for links that do not resolve to an embedable file: shows an empty-state
   *  label, and upgrades itself to the real embed once the target appears in the vault. */
  function FallbackEmbed(ctx) {
    const self = host.Component.call(this) || this;
    self.file = null;
    self.onClick = (evt) => {
      const c = self.ctx;
      c.app.workspace.openLinkText(c.linktext, c.sourcePath, host.Keymap.isModEvent(evt));
    };
    self.ctx = ctx;
    self.containerEl = ctx.containerEl;
    return self;
  }
  inherit(FallbackEmbed, host.Component);
  const proto = FallbackEmbed.prototype;

  proto.loadFile = async function () {
    const containerEl = this.containerEl;
    const ctx = this.ctx;
    const app = ctx.app;
    const linktext = ctx.linktext;
    if (app.workspace.initialized) {
      if (app.fileManager.canCreateFileWithExt(host.getExtension(linktext))) {
        containerEl.addClass("mod-empty");
        containerEl.appendText(host.t.plugins.pagePreview.labelEmptyNote({ linktext }));
        containerEl.addEventListener("click", this.onClick);
      } else {
        containerEl.addClass("mod-empty-attachment");
        containerEl.appendText(host.t.plugins.pagePreview.labelEmptyAttachment({ linktext }));
      }
    } else {
      containerEl.addClass("mod-empty-attachment");
      containerEl.appendText(host.t.dialogue.msgLoading());
    }
  };

  proto.onload = function () {
    host.Component.prototype.onload.call(this);
    const app = this.ctx.app;
    if (!app.workspace.initialized) return;
    const check = host.debounce(() => {
      if (!(this._loaded && this._children.length === 0)) return;
      const ctx = this.ctx;
      const app = ctx.app;
      const linktext = ctx.linktext;
      const sourcePath = ctx.sourcePath;
      const path = host.parseLinkText(linktext).path;
      if (app.metadataCache.getFirstLinkpathDest(path, sourcePath)) {
        this.containerEl.removeClass("file-embed", "mod-empty");
        this.containerEl.removeEventListener("click", this.onClick);
        this.containerEl.empty();
        const embed = host.EmbedLoader.load(this.ctx);
        if (embed) {
          this.addChild(embed);
          embed.loadFile();
        }
      }
    }, 500, true);
    this.registerEvent(app.vault.on("create", check));
    this.registerEvent(app.vault.on("rename", check));
  };

  return FallbackEmbed;
}

function buildS27VideoView(host) {
  /** File view for video files: plays the resource inside a .video-container. */
  function VideoView() {
    return host.EditableFileView.apply(this, arguments) || this;
  }
  inherit(VideoView, host.EditableFileView);
  const proto = VideoView.prototype;

  proto.getViewType = function () { return s27VideoViewType; };

  proto.canAcceptExtension = function (extension) { return host.videoExtensions.contains(extension); };

  proto.onLoadFile = async function (file) {
    host.s27StopMedia(this.contentEl);
    this.contentEl.empty();
    const containerEl = this.contentEl.createDiv("video-container");
    await VideoView.displayInEl(file, this.app, containerEl);
  };

  VideoView.displayInEl = async function (file, app, containerEl) {
    const src = app.vault.getResourcePath(file);
    return hostEnv().Ac(containerEl, src);
  };

  VideoView.VIEW_TYPE = s27VideoViewType;
  return VideoView;
}

function buildS27EmbedRegistry(host) {
  /** Maps file extensions to embed creators; instantiated once and shared by the embed loader. */
  function EmbedRegistry() {
    const self = host.Events.call(this) || this;
    self.embedByExtension = {};
    self.registerExtensions(host.markdownExtensions, (ctx, file, subpath) => {
      return ctx.displayMode
        ? new (host.s27DisplayModeEmbed)(ctx, file, subpath)
        : new (s27EmbedClass(host, "markdown", () => buildS27MarkdownEmbed(host)))(ctx, file, subpath);
    });
    self.registerExtensions(host.imageExtensions, (ctx, file) => new (s27EmbedClass(host, "image", () => buildS27ImageEmbed(host)))(ctx, file));
    self.registerExtensions(host.audioExtensions, (ctx, file) => new (s27EmbedClass(host, "audio", () => buildS27AudioEmbed(host)))(ctx, file));
    self.registerExtensions(host.videoExtensions, (ctx, file) => new (s27EmbedClass(host, "videoEmbed", () => buildS27VideoEmbed(host)))(ctx, file));
    self.registerExtensions(host.pdfExtensions, (ctx, file, subpath) => new (host.s27PdfEmbed)(ctx, file, subpath));
    return self;
  }
  inherit(EmbedRegistry, host.Events);
  const proto = EmbedRegistry.prototype;

  proto.unregisterExtensions = function (extensions) {
    for (const ext of extensions) this.unregisterExtension(ext);
  };

  proto.unregisterExtension = function (extension) {
    delete this.embedByExtension[extension];
  };

  proto.registerExtension = function (extension, creator) {
    const map = this.embedByExtension;
    if (this.isExtensionRegistered(extension)) {
      throw new Error(`Attempting to register an embed for an already registered extension "${extension}"`);
    }
    map[extension] = creator;
  };

  proto.registerExtensions = function (extensions, creator) {
    for (const ext of extensions) this.registerExtension(ext, creator);
  };

  proto.isExtensionRegistered = function (extension) {
    return this.embedByExtension.hasOwnProperty(extension);
  };

  proto.getEmbedCreator = function (file) {
    return this.isExtensionRegistered(file.extension) ? this.embedByExtension[file.extension] : null;
  };

  return EmbedRegistry;
}

function buildS27MarkdownEmbed(host) {
  /** The markdown note embed ("![[note]]"): editable inline title, properties editor,
   *  subpath (heading/block/footnote) extraction and fold state, on top of MarkdownEmbedBase. */
  function MarkdownEmbed(ctx, file, subpath) {
    const self = host.MarkdownEmbedBase.call(this, ctx.app, ctx.containerEl, file, ctx.state) || this;
    self.subpath = "";
    self.useLocalPropertiesFoldState = false;
    self.localPropertiesFoldState = false;
    self.data = "";
    self.subpathNotFound = false;
    self.before = "";
    self.after = "";
    self.heading = "";
    self.indent = "";
    self.lastSavedData = null;
    self.saving = false;
    self.saveAgain = false;
    self.fileBeingRenamed = null;
    self.rawFrontmatter = null;
    self.subpath = subpath;
    self.containerEl.addClass("markdown-embed");
    if (ctx.showInline) {
      self.containerEl.addClass("inline-embed");
      self.headerEl = self.containerEl.createDiv({ cls: "embed-title markdown-embed-title", prepend: true });
    }
    self.containerEl.createDiv("markdown-embed-link", (el) => {
      host.setIcon(el, "lucide-maximize-2");
      host.setTooltip(el, host.t.editor.linkPopover.tooltipOpenLink());
      host.Ic(el);
      el.onClickEvent((evt) => {
        if (evt.button !== 0 && evt.button !== 1) return;
        evt.preventDefault();
        self.app.workspace.getLeaf(host.Keymap.isModEvent(evt)).openFile(file, { eState: { subpath } });
      });
    });
    const titleEl = self.inlineTitleEl = createDiv("inline-title");
    titleEl.contentEditable = subpath ? "false" : "true";
    titleEl.spellcheck = self.app.vault.getConfig("spellcheck");
    titleEl.autocapitalize = "on";
    titleEl.tabIndex = -1;
    titleEl.enterKeyHint = host.Platform.isAndroidApp ? "enter" : "done";
    titleEl.addEventListeners({
      focus: () => { self.fileBeingRenamed = self.file; },
      blur: () => self.saveTitle(titleEl),
      input: () => self.onTitleChange(titleEl),
      paste: (evt) => self.onTitlePaste(titleEl, evt),
      keydown: (evt) => self.onTitleKeydown(evt),
    });
    self.metadataEditor = new host.MetadataEditor(self.app, self);
    self.addChild(self.metadataEditor);
    return self;
  }
  inherit(MarkdownEmbed, host.MarkdownEmbedBase);
  const proto = MarkdownEmbed.prototype;
  const Base = host.MarkdownEmbedBase.prototype;

  proto.showPreview = function (mode) {
    Base.showPreview.call(this, mode);
    const renderer = this.previewMode.renderer;
    if (!renderer.header) renderer.addHeader();
    renderer.header.el.prepend(this.metadataEditor.containerEl);
    renderer.header.el.prepend(this.inlineTitleEl);
  };

  proto.showEditor = function (mode) {
    Base.showEditor.call(this, mode);
    this.editMode.sizerEl.insertAfter(this.metadataEditor.containerEl, this.inlineTitleEl);
  };

  proto.getFile = function () { return this.file; };

  proto.getHoverSource = function () { return this.editMode ? "editor" : "preview"; };

  proto.focusTitle = function () {
    const el = this.inlineTitleEl;
    if (!el.isShown()) return;
    if (this.getMode() === "preview") this.previewMode.renderer.onRendered(() => host.focusAndSelectContents(el));
    else host.focusAndSelectContents(el);
  };

  proto.canShowProperties = function () {
    return !this.subpath
      && ((this.getMode() !== "source" || !this.editMode.sourceMode)
        && this.app.vault.getConfig("propertiesInDocument") === "visible");
  };

  proto.shiftFocusAfter = function () {
    if (this.editMode) {
      this.editMode.cm.dispatch({ selection: host.cmSelection.single(0) });
      this.editMode.focus();
    } else {
      this.previewMode.renderer.previewEl.focus();
    }
  };

  proto.shiftFocusBefore = function () {
    if (this.canShowProperties() && !this.metadataEditor.hasFocus()) {
      this.metadataEditor.focus({ bottom: true });
    } else if (this.inlineTitleEl.isShown()) {
      host.focusAndSelectContents(this.inlineTitleEl);
    }
  };

  proto.loadFrontmatter = function (text) {
    const raw = host.extractFrontmatter(text).frontmatter;
    if (this.rawFrontmatter === raw) return;
    this.rawFrontmatter = raw;
    let parsed = {};
    try {
      const value = host.parseYaml(raw) ?? {};
      if (typeof value !== "object" || Array.isArray(value)) throw new Error("Frontmatter must be a valid object!");
      parsed = value;
    } catch (err) {
      parsed = null;
    }
    if (this.editMode) this.editMode.setCssClass(host.frontmatterClasses(parsed));
    this.metadataEditor.synchronize(parsed);
  };

  proto.saveFrontmatter = function (frontmatter) {
    this.save(host.spliceFrontmatter(this.text, frontmatter), true);
  };

  proto.applyIndent = function (text) {
    const indent = this.indent;
    const pattern = subpathKind(this.subpath) === "footnote" ? /\n/g : /(^|\n)/g;
    return text.replace(pattern, "$&" + indent);
  };

  proto.save = async function (text, writeFile = false) {
    Base.save.call(this, text, writeFile);
    if (this.subpathNotFound) return;
    const content = text;
    const before = this.before;
    const after = this.after;
    let heading = this.heading;
    if (content && heading && !heading.endsWith("\n")) heading += "\n";
    this.data = before + heading + this.applyIndent(content) + after;
    this.app.workspace.onQuickPreview(this.file, this.data);
    if (!writeFile) return;
    this.dirty = false;
    const file = this.file;
    const vault = this.app.vault;
    if (!file || file.deleted) return;
    if (this.saving) {
      this.saveAgain = true;
      return;
    }
    if (this.lastSavedData === this.data || this.lastSavedData === null) return;
    const previous = this.lastSavedData;
    this.lastSavedData = this.data;
    this.saving = true;
    try {
      await host.awaitSettled(vault.adapter.promise);
      await vault.modify(file, this.data);
    } catch (err) {
      this.lastSavedData = previous;
      console.error(err);
      new host.Notice(host.t.interface.msgFailToSaveFile({ filepath: file.path, message: err.message }), 0);
      this.app.fileManager.storeTextFileBackup(file.path, this.data);
      throw err;
    } finally {
      this.saving = false;
      if (this.saveAgain) this.save(this.text);
    }
  };

  proto.onTitlePaste = function (el, evt) { host.pastePlainText(el, evt); };

  proto.onTitleChange = function (el) {
    const file = this.file;
    host.normalizeEditable(el);
    const name = el.getText().trim();
    const invalid = host.validateFileName(this.app, file, name, false);
    if (invalid) {
      s27ShowEmbedError(el, invalid, true);
    } else if (host.unsafeCharsPattern.test(name)) {
      s27ShowEmbedError(el, host.t.plugins.fileExplorer.msgUnsafeCharacters() + host.unsafeCharsList, true);
    } else {
      host.hideTooltip();
    }
  };

  proto.onTitleKeydown = function (evt) {
    if (evt.isComposing) return;
    if (evt.key === "Escape") {
      evt.preventDefault();
      this.inlineTitleEl.setText(this.file.basename);
      this.inlineTitleEl.blur();
    } else if (evt.key === "Enter" || evt.key === "Tab") {
      evt.preventDefault();
      host.blurAndClearSelection();
      if (this.editMode && host.Platform.hasPhysicalKeyboard) {
        this.editMode.editor.focus();
      }
    } else if (evt.key === "ArrowDown") {
      const target = evt.targetNode;
      const selection = target.win.getSelection();
      if (selection && selection.rangeCount >= 1 && target.instanceOf(HTMLElement)) {
        const range = selection.getRangeAt(0);
        if (target === range.startContainer || target.contains(range.startContainer)) {
          const rect = range.getBoundingClientRect();
          if (rect.bottom + rect.height / 2 >= target.getBoundingClientRect().bottom) {
            evt.preventDefault();
            host.blurAndClearSelection();
            if (this.editMode) {
              this.editMode.editor.focus();
              this.editMode.editor.setSelection({ line: 0, ch: 0 });
            }
          }
        }
      }
    }
  };

  proto.saveTitle = async function (el) {
    host.hideTooltip();
    const file = this.file;
    const subpath = this.subpath;
    const renaming = this.fileBeingRenamed;
    if (file !== renaming) return;
    const name = el.getText().trim();
    if (subpath) return;
    const invalid = host.validateFileName(this.app, file, name, true);
    if (invalid) {
      el.setText(file.basename);
      s27ShowEmbedError(el, invalid, true);
      return;
    }
    const newPath = file.getNewPathAfterRename(name);
    if (file.path === newPath) return;
    try {
      await this.app.fileManager.renameFile(file, newPath);
    } catch (err) {
      const message = err.message || err.code || err.toString();
      s27ShowEmbedError(el, message, true);
    }
    el.setText(file.basename);
    this.fileBeingRenamed = null;
  };

  proto.onload = function () {
    Base.onload.call(this);
    this.registerEvent(this.app.metadataCache.on("changed", this.onFileChanged, this));
    this.registerEvent(this.app.vault.on("rename", this.onFileRename, this));
  };

  proto.onunload = function () {
    Base.onunload.call(this);
    this.applyScope(null);
  };

  proto.onFileChanged = function (file, data, cache) {
    if (file !== this.file || data === this.data || this.dirty) return;
    this.loadFileInternal(data, cache);
  };

  proto.onFileRename = function (file, oldPath) {
    if (file instanceof host.TFile && file === this.file && !this.subpath) {
      this.inlineTitleEl.setText(file.basename);
    }
  };

  proto.loadFile = async function () {
    const app = this.app;
    const file = this.file;
    const headerEl = this.headerEl;
    const previewMode = this.previewMode;
    const subpath = this.subpath;
    const state = this.state;
    if (!subpath) {
      headerEl?.setText(file.basename);
      this.inlineTitleEl.setText(file.basename);
      previewMode.registerEvent(app.workspace.on("quick-preview", (evt, data) => {
        if (evt === this.file && data !== this.data) this.loadContents(data);
      }));
    }
    const data = await app.vault.cachedRead(file);
    this.loadFileInternal(data);
    if (state && Number.isNumber(state.scroll)) {
      previewMode.renderer.applyScrollDelayed(state.scroll, { highlight: true, center: true });
    }
    const folds = this.getFoldInfo();
    this.localPropertiesFoldState = Boolean(folds && folds.folds?.some((fold) => fold.from === 0));
    previewMode.renderer.applyFoldInfo(folds);
    this.metadataEditor.setCollapse(
      this.useLocalPropertiesFoldState ? this.localPropertiesFoldState : MarkdownEmbed.collapseProperties,
      false,
    );
  };

  proto.getFoldInfo = function () {
    return this.app.foldManager.load(this.file);
  };

  proto.loadFileInternal = function (data, cache) {
    const file = this.file;
    const lastSaved = this.lastSavedData;
    this.lastSavedData = data;
    if (lastSaved) {
      if (lastSaved === data) return;
      if (this.dirty) {
        const current = this.data;
        if (current === data) return;
        if (current !== lastSaved) {
          data = host.mergeText(lastSaved, current, data);
          new host.Notice(host.t.interface.msgFileChanged({ file: file.path }));
        }
      }
    }
    this.loadContents(data, cache);
  };

  proto.loadContents = function (data, cache) {
    const app = this.app;
    const file = this.file;
    const subpath = this.subpath;
    if (!cache) cache = app.metadataCache.getFileCache(file);
    if (subpath && !cache) this.subpathNotFound = false;
    if (subpath && cache) {
      const section = host.subpathToPos(cache, subpath);
      this.subpathNotFound = !section;
      let before = "";
      let after = "";
      let heading = "";
      let indent = "";
      if (section) {
        const extracted = s05ExtractSubpath(data, cache, section, this.editable);
        before = extracted.before;
        after = extracted.after;
        heading = extracted.heading;
        indent = extracted.indent;
        data = extracted.content;
        this.containerEl.dataset.type = section.type;
        if (section.type === "heading") {
          const titleEl = this.inlineTitleEl;
          const frag = host.sanitizeHtml(host.treeToHtml(host.markdownTree(heading))).firstChild;
          if (frag && frag.instanceOf(HTMLHeadingElement)) {
            titleEl.addClass("markdown-rendered");
            titleEl.replaceChildren(frag);
            host.refreshLinkStates(app, titleEl, file.path);
            host.MarkdownPreviewView.postProcess(app, {
              docId: host.randomHex(16),
              sourcePath: this.path,
              frontmatter: cache.frontmatter,
              promises: [],
              addChild: (child) => this.addChild(child),
              getSectionInfo: () => null,
              replace: () => null,
              containerEl: titleEl,
              el: frag,
              displayMode: false,
            });
          } else {
            titleEl.setText(section.current.heading);
          }
          titleEl.setAttr("data-level", String(section.current.level));
        } else if (section.type === "footnote") {
          indent = app.vault.getConfig("useTab") ? "\t" : "    ";
        }
        this.heading = heading;
        this.before = before;
        this.after = after;
        this.indent = indent;
      }
    }
    if (this.subpathNotFound) {
      const escaped = subpath.slice(1).replace(/(\[|\])/g, "\\$1");
      if (subpathKind(subpath) === "footnote") {
        data = host.t.plugins.pagePreview.labelMissingFootote({ id: escaped });
        this.containerEl.dataset.type = "footnote";
        this.containerEl.addClass("mod-empty");
        const onClick = () => {
          app.vault.process(file, (text) => {
            const trailing = text.match(/\n*$/)[0].length;
            return text + "\n".repeat(2 - Math.min(trailing, 2)) + subpath.slice(1) + ": \n";
          });
          this.containerEl.removeClass("mod-empty");
          this.containerEl.removeEventListener("click", onClick);
        };
        this.containerEl.addEventListener("click", onClick);
      } else {
        data = "##### " + host.t.interface.labelUnableToFindSection({ subpath: escaped, file: file.basename });
      }
    }
    this.set(data, true);
  };

  proto.set = function (text, preview) {
    Base.set.call(this, text, preview);
    this.loadFrontmatter(text);
    if (preview) {
      const config = this.app.vault.getConfig("propertiesInDocument");
      this.previewMode.renderer.previewEl.toggleClass("show-properties", config !== "hidden");
    }
  };

  proto.applyScope = function (scope) {
    if (scope === this.scope) return;
    if (this.scope) this.app.keymap.popScope(this.scope);
    if (scope) this.app.keymap.pushScope(scope);
    this.scope = scope;
  };

  proto.onMarkdownFold = function () {
    const file = this.file;
    const folds = this.getMode() === "preview"
      ? this.previewMode.renderer.getFoldInfo()
      : this.editMode.getFoldInfo();
    if (!this.useLocalPropertiesFoldState) {
      MarkdownEmbed.collapseProperties = this.metadataEditor.collapsed;
      if (this.localPropertiesFoldState) folds.folds.unshift({ from: 0, to: 0 });
    }
    this.app.foldManager.save(file, folds);
  };

  MarkdownEmbed.collapseProperties = true;
  return MarkdownEmbed;
}
