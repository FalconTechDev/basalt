// g05 embed implementations ported off the retired s11-embed.js slice.
// The embed component base/preview/edit modes now come from the g18 clean-room
// modules (ng18EmbedComponent); the concrete embeds below keep their historic
// s11* names because the manifest-wired ng05* factories delegate to them.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { ng18EmbedComponent } from "./n-g18-embed.js";

// Filled by s11MarkdownEmbed(); the registry creator closes over it.
let ng05MarkdownEmbedCtor = null;

export function s11MarkdownEmbed(host) {
  const EmbedComponentBase = ng18EmbedComponent(host);
  function MarkdownEmbed(ctx, file, subpath) {
    const self = EmbedComponentBase.call(this, ctx.app, ctx.containerEl, file, ctx.state) || this;
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
      env().Ic(el);
      el.onClickEvent((evt) => {
        if (evt.button !== 0 && evt.button !== 1) return;
        evt.preventDefault();
        self.app.workspace.getLeaf(host.Keymap.isModEvent(evt)).openFile(file, { eState: { subpath } });
      });
    });
    const titleEl = (self.inlineTitleEl = createDiv("inline-title"));
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
  inherit(MarkdownEmbed, EmbedComponentBase);
  const proto = MarkdownEmbed.prototype;
  proto.showPreview = function (force) {
    EmbedComponentBase.prototype.showPreview.call(this, force);
    const renderer = this.previewMode.renderer;
    if (!renderer.header) renderer.addHeader();
    renderer.header.el.prepend(this.metadataEditor.containerEl);
    renderer.header.el.prepend(this.inlineTitleEl);
  };
  proto.showEditor = function () {
    EmbedComponentBase.prototype.showEditor.call(this);
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
    return !this.subpath &&
      ((this.getMode() !== "source" || !this.editMode.sourceMode) &&
        this.app.vault.getConfig("propertiesInDocument") === "visible");
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
    if (this.canShowProperties() && !this.metadataEditor.hasFocus()) this.metadataEditor.focus({ bottom: true });
    else if (this.inlineTitleEl.isShown()) host.focusAndSelectContents(this.inlineTitleEl);
  };
  proto.loadFrontmatter = function (text) {
    const frontmatter = host.extractFrontmatter(text).frontmatter;
    if (this.rawFrontmatter === frontmatter) return;
    this.rawFrontmatter = frontmatter;
    let props = {};
    try {
      props = host.parseYaml(frontmatter) ?? {};
      if (typeof props !== "object" || Array.isArray(props)) throw new Error("Frontmatter must be a valid object!");
    } catch (e) {
      props = null;
    }
    if (this.editMode) this.editMode.setCssClass(host.frontmatterClasses(props));
    this.metadataEditor.synchronize(props);
  };
  proto.saveFrontmatter = function (props) {
    this.save(host.spliceFrontmatter(this.text, props), true);
  };
  proto.applyIndent = function (text) {
    const indent = this.indent;
    const pattern = this.subpath === "footnote" ? /\n/g : /(^|\n)/g;
    return text.replace(pattern, "$&" + indent);
  };
  proto.save = async function (text, immediate = false) {
    EmbedComponentBase.prototype.save.call(this, text, immediate);
    if (this.subpathNotFound) return;
    let heading = this.heading;
    if (text && heading && !heading.endsWith("\n")) heading += "\n";
    const data = (this.data = this.before + heading + this.applyIndent(text) + this.after);
    this.app.workspace.onQuickPreview(this.file, data);
    if (!immediate) return;
    this.dirty = false;
    const file = this.file, vault = this.app.vault;
    if (!file || file.deleted) return;
    if (this.saving) { this.saveAgain = true; return; }
    if (this.lastSavedData === data || this.lastSavedData === null) return;
    const previous = this.lastSavedData;
    this.lastSavedData = data;
    this.saving = true;
    try {
      await host.awaitSettled(vault.adapter.promise);
      await vault.modify(file, data);
    } catch (e) {
      this.lastSavedData = previous;
      console.error(e);
      new host.Notice(host.t.interface.msgFailToSaveFile({ filepath: file.path, message: e.message }), 0);
      this.app.fileManager.storeTextFileBackup(file.path, data);
      throw e;
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
    const error = host.validateFileName(this.app, file, name, false);
    if (error) s11ShowInlineError(el, error, true);
    else if (host.UNSAFE_NAME_CHARS.test(name)) s11ShowInlineError(el, host.t.plugins.fileExplorer.msgUnsafeCharacters() + host.unsafeNameCharsList, true);
    else host.hideTooltip();
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
      if (this.editMode && host.Platform.hasPhysicalKeyboard) this.editMode.editor.focus();
    } else if (evt.key === "ArrowDown") {
      const target = evt.targetNode, selection = target.win.getSelection();
      if (selection && selection.rangeCount >= 1 && target.instanceOf(HTMLElement)) {
        const range = selection.getRangeAt(0);
        if (target === range.startContainer || target.contains(range.startContainer)) {
          const rect = range.getBoundingClientRect();
          if (rect.bottom + rect.height / 2 >= target.getBoundingClientRect().bottom) {
            evt.preventDefault();
            host.blurAndClearSelection();
            if (this.editMode) {
              this.editMode.editor.focus();
              this.editMode.editor.setSelection(env().iP(0, 0));
            }
          }
        }
      }
    }
  };
  proto.saveTitle = async function (el) {
    host.hideTooltip();
    const file = this.file, subpath = this.subpath, renamed = this.fileBeingRenamed;
    if (file !== renamed) return;
    const name = el.getText().trim();
    if (!subpath) {
      const error = host.validateFileName(this.app, file, name, true);
      if (error) {
        el.setText(file.basename);
        s11ShowInlineError(el, error, true);
        return;
      }
      const newPath = file.getNewPathAfterRename(name);
      if (file.path === newPath) return;
      try {
        await this.app.fileManager.renameFile(file, newPath);
      } catch (e) {
        s11ShowInlineError(el, e.message || e.code || e.toString(), true);
      }
    }
    el.setText(file.basename);
    this.fileBeingRenamed = null;
  };
  MarkdownEmbed.collapseProperties = true;
  proto.onload = function () {
    EmbedComponentBase.prototype.onload.call(this);
    this.registerEvent(this.app.metadataCache.on("changed", this.onFileChanged, this));
    this.registerEvent(this.app.vault.on("rename", this.onFileRename, this));
  };
  proto.onunload = function () {
    EmbedComponentBase.prototype.onunload.call(this);
    this.applyScope(null);
  };
  proto.onFileChanged = function (file, data, cache) {
    if (file === this.file && data !== this.data && !this.dirty) this.loadFileInternal(data, cache);
  };
  proto.onFileRename = function (file, oldPath) {
    if (file instanceof host.TFile && file === this.file && !this.subpath) this.inlineTitleEl.setText(file.basename);
  };
  proto.loadFile = async function () {
    const app = this.app, file = this.file, headerEl = this.headerEl;
    const previewMode = this.previewMode, subpath = this.subpath, state = this.state;
    if (!subpath) {
      headerEl?.setText(file.basename);
      this.inlineTitleEl.setText(file.basename);
      previewMode.registerEvent(app.workspace.on("quick-preview", (evtFile, text) => {
        if (evtFile === this.file && text !== this.data) this.loadContents(text);
      }));
    }
    const data = await app.vault.cachedRead(file);
    this.loadFileInternal(data);
    if (state && Number.isNumber(state.scroll)) this.previewMode.renderer.applyScrollDelayed(state.scroll, { highlight: true, center: true });
    const folds = this.getFoldInfo();
    this.localPropertiesFoldState = Boolean(folds?.folds.some((f) => f.from === 0));
    this.previewMode.renderer.applyFoldInfo(folds);
    const collapse = this.useLocalPropertiesFoldState ? this.localPropertiesFoldState : MarkdownEmbed.collapseProperties;
    this.metadataEditor.setCollapse(collapse, false);
  };
  proto.getFoldInfo = function () { return this.app.foldManager.load(this.file); };
  proto.loadFileInternal = function (data, cache) {
    const file = this.file, lastSaved = this.lastSavedData;
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
    const app = this.app, file = this.file, subpath = this.subpath;
    if (!cache) cache = app.metadataCache.getFileCache(file);
    if (subpath && !cache) this.subpathNotFound = false;
    if (subpath && cache) {
      const section = host.subpathToPos(cache, subpath);
      this.subpathNotFound = !section;
      let before = "", after = "", heading = "", indent = "";
      if (section) {
        const parts = env().NT(data, cache, section, this.editable);
        before = parts.before;
        after = parts.after;
        heading = parts.heading;
        indent = parts.indent;
        data = parts.content;
        this.containerEl.dataset.type = section.type;
        if (section.type === "heading") {
          const titleEl = this.inlineTitleEl;
          const node = host.sanitizeHtml(host.treeToHtml(host.markdownTree(heading))).firstChild;
          if (node && node.instanceOf(HTMLHeadingElement)) {
            titleEl.addClass("markdown-rendered");
            titleEl.replaceChildren(node);
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
              el: node,
              displayMode: false,
            });
          } else {
            titleEl.setText(section.current.heading);
            titleEl.setAttr("data-level", String(section.current.level));
          }
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
      const name = subpath.slice(1).replace(/(\[|\])/g, "\\$1");
      if (env().RT(subpath) === "footnote") {
        data = host.t.plugins.pagePreview.labelMissingFootnote({ id: name });
        this.containerEl.dataset.type = "footnote";
        this.containerEl.addClass("mod-empty");
        const self = this;
        const dismiss = () => {
          self.app.vault.process(file, (text) => {
            const trailing = text.match(/\n*$/)[0].length;
            return text + "\n".repeat(2 - Math.min(trailing, 2)) + subpath.slice(1) + ": \n";
          });
          self.containerEl.removeClass("mod-empty");
          self.containerEl.removeEventListener("click", dismiss);
        };
        this.containerEl.addEventListener("click", dismiss);
      } else {
        data = "##### " + host.t.interface.labelUnableToFindSection({ subpath: name, file: file.basename });
      }
    }
    this.set(data, true);
  };
  proto.set = function (text, scroll) {
    EmbedComponentBase.prototype.set.call(this, text, scroll);
    this.loadFrontmatter(text);
    if (scroll) {
      const propMode = this.app.vault.getConfig("propertiesInDocument");
      this.previewMode.renderer.previewEl.toggleClass("show-properties", propMode !== "hidden");
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
    const folds = this.getMode() === "preview" ? this.previewMode.renderer.getFoldInfo() : this.editMode.getFoldInfo();
    if (!this.useLocalPropertiesFoldState) {
      MarkdownEmbed.collapseProperties = this.metadataEditor.collapsed;
      if (this.localPropertiesFoldState) folds.folds.unshift({ from: 0, to: 0 });
    }
    this.app.foldManager.save(file, folds);
  };
  ng05MarkdownEmbedCtor = MarkdownEmbed;
  return MarkdownEmbed;
}


export function s11FileEmbed(host) {
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
    const containerEl = this.containerEl, ctx = this.ctx, app = this.app;
    containerEl.addEventListener("click", (evt) => {
      app.workspace.getLeaf(host.Keymap.isModEvent(evt)).openLinkText(ctx.linktext, ctx.sourcePath);
    });
  };
  return FileEmbed;
}

// ---- fallback embed (original: oJ) ----
export function s11FallbackEmbed(host) {
  function FallbackEmbed(ctx) {
    const self = host.Component.call(this) || this;
    self.file = null;
    self.onClick = (evt) => {
      const c = self.ctx, app = c.app;
      app.workspace.openLinkText(c.linktext, c.sourcePath, host.Keymap.isModEvent(evt));
    };
    self.ctx = ctx;
    self.containerEl = ctx.containerEl;
    return self;
  }
  inherit(FallbackEmbed, host.Component);
  const proto = FallbackEmbed.prototype;
  proto.loadFile = async function () {
    const containerEl = this.containerEl, ctx = this.ctx;
    const app = ctx.app, linktext = ctx.linktext;
    containerEl.addClass("file-embed");
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
    const retry = host.debounce(() => {
      if (!this._loaded || this._children.length > 0) return;
      const ctx = this.ctx, app2 = ctx.app, linktext = ctx.linktext, sourcePath = ctx.sourcePath;
      const path = host.parseLinkText(linktext).path;
      if (app2.metadataCache.getFirstLinkpathDest(path, sourcePath)) {
        this.containerEl.removeClass("file-embed", "mod-empty");
        this.containerEl.removeEventListener("click", this.onClick);
        this.containerEl.empty();
        const embed = host.EmbedLoader.load(ctx);
        if (embed) {
          this.addChild(embed);
          embed.loadFile();
        }
      }
    }, 500, true);
    this.registerEvent(app.vault.on("create", retry));
    this.registerEvent(app.vault.on("rename", retry));
  };
  return FallbackEmbed;
}

// ---- embed registry (original: aJ) ----
export function s11EmbedRegistry(host) {
  function EmbedRegistry() {
    const self = host.Events.call(this) || this;
    self.embedByExtension = {};
    self.registerExtensions(host.markdownExtensions, (ctx, file, subpath) =>
      ctx.displayMode ? new (env().dq)(ctx, file, subpath) : new (ng05MarkdownEmbedCtor || s11MarkdownEmbed(host))(ctx, file, subpath));
    self.registerExtensions(env().Vy, (ctx, file) => new (env().tJ)(ctx, file));
    self.registerExtensions(env().Hy, (ctx, file) => new (env().nJ)(ctx, file));
    self.registerExtensions(env().zy, (ctx, file) => new (env().iJ)(ctx, file));
    self.registerExtensions(env().qy, (ctx, file, subpath) => new (env().YZ)(ctx, file, subpath));
    return self;
  }
  inherit(EmbedRegistry, host.Events);
  const proto = EmbedRegistry.prototype;
  proto.unregisterExtensions = function (extensions) {
    for (const ext of extensions) this.unregisterExtension(ext);
  };
  proto.unregisterExtension = function (ext) { delete this.embedByExtension[ext]; };
  proto.registerExtension = function (ext, creator) {
    const map = this.embedByExtension;
    if (this.isExtensionRegistered(ext)) throw new Error(`Attempting to register an embed for an already registered extension "${ext}"`);
    map[ext] = creator;
  };
  proto.registerExtensions = function (extensions, creator) {
    for (const ext of extensions) this.registerExtension(ext, creator);
  };
  proto.isExtensionRegistered = function (ext) { return this.embedByExtension.hasOwnProperty(ext); };
  proto.getEmbedCreator = function (file) {
    return this.isExtensionRegistered(file.extension) ? this.embedByExtension[file.extension] : null;
  };
  return EmbedRegistry;
}


export function s11ShowInlineError(el, message, autoclose) {
  env().kv(el, message, { classes: ["mod-wide", "mod-error"] });
  if (autoclose) setTimeout(() => env().Cv(), 2000);
}


