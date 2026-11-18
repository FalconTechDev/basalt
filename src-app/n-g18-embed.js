import { inherit } from "./inherit.js";
import { env } from "./env.js";

// g18 / s11-embed.js — embed component base (host.MarkdownEmbedBase), the
// preview mode wrapping the markdown renderer and the iframe-capable edit mode.
// All host/env lookups stay lazy inside the factories.

const ng18EmbedKit = {};
function ng18EmbedClass(host, key, make) {
  return ng18EmbedKit[key] || (ng18EmbedKit[key] = make(host));
}

export function ng18EmbedComponent(host) {
  return ng18EmbedClass(host, "component", () => buildNg18EmbedComponent(host));
}

function buildNg18EmbedComponent(host) {
  /** Base of every "![[...]]" embed: owns the preview/source mode split, the
   *  two content containers, scroll/fold sync and the debounced save pipeline. */
  function EmbedComponent(app, containerEl, file, state) {
    const self = host.Component.call(this) || this;
    self.app = app;
    self.containerEl = containerEl;
    self.file = file;
    self.state = state;
    self.hoverPopover = null;
    self.editable = false;
    self.text = "";
    self.dirty = false;
    self.useIframe = false;
    self.editMode = null;
    self.scope = null;
    self.requestSaveFolds = host.debounce(() => self.onMarkdownFold(), 500);
    self.requestSave = host.debounce(() => self.save(self.text, true), 2000);
    self.previewEl = containerEl.createDiv("markdown-embed-content");
    self.editorEl = containerEl.createDiv("markdown-embed-content");
    env().cg(self.previewEl);
    env().cg(self.editorEl);
    self.editorEl.hide();
    self.previewMode = self.addChild(new (ng18EmbedPreviewMode(host))(self));
    return self;
  }
  inherit(EmbedComponent, host.Component);
  const proto = EmbedComponent.prototype;

  Object.defineProperty(proto, "path", {
    get() { return (this.file && this.file.path) || ""; },
    enumerable: false,
    configurable: true,
  });

  Object.defineProperty(proto, "editor", {
    get() { return this.editMode ? this.editMode.editor : null; },
    enumerable: false,
    configurable: true,
  });

  Object.defineProperty(proto, "scroll", {
    get() {
      return this.editMode
        ? this.editMode.getScroll()
        : this.previewMode.renderer.getScroll();
    },
    enumerable: false,
    configurable: true,
  });

  proto.getMode = function () {
    return this.editMode ? "source" : "preview";
  };

  proto.toggleMode = function () {
    if (this.editMode) this.showPreview();
    else this.showEditor();
  };

  proto.syncScroll = function () {
    this.app.workspace.trigger("markdown-scroll", this);
  };

  proto.showSearch = function (query) {
    if (this.editMode) this.editMode.showSearch(query);
    else this.previewMode.showSearch();
  };

  proto.save = function (text, immediate) {
    if (immediate === undefined) immediate = false;
    this.text = text;
    this.dirty = !immediate;
    if (!immediate) this.requestSave();
    this.set(text);
  };

  proto.set = function (text, scroll) {
    this.text = text;
    this.previewMode.set(text);
    if (this.editMode) this.editMode.set(text, scroll);
  };

  proto.loadFile = function () {
    this.set(this.text);
  };

  proto.showPreview = function (force) {
    const editMode = this.editMode;
    const scroll = editMode ? editMode.getScroll() : null;
    this.editorEl.hide();
    this.previewEl.show();
    this.destroyEditor(!!force);
    if (scroll !== null) {
      this.previewMode.renderer.applyScrollDelayed(scroll);
      this.previewMode.renderer.applyFoldInfo(this.getFoldInfo());
    }
  };

  proto.showEditor = function (point) {
    if (!this.editable) return;
    const scroll = this.previewMode.renderer.getScroll();
    this.previewEl.hide();
    this.editorEl.show();
    if (!this.editMode) this.editMode = this.addChild(new (ng18IframeEditMode(host))(this));
    const editMode = this.editMode;
    editMode.set(this.text, true);
    host.focusWhenShown(editMode.editorEl, () => {
      editMode.applyFoldInfo(this.getFoldInfo());
      editMode.applyScroll(scroll);
      editMode.focus();
      if (point) {
        const frame = host.frameOffset(editMode.editorEl.win);
        let x = point.x;
        let y = point.y;
        if (frame) {
          x = (x - frame.x) / frame.scale;
          y = (y - frame.y) / frame.scale;
        }
        const pos = editMode.cm.posAtCoords({ x, y });
        if (pos !== null && pos !== undefined) {
          editMode.cm.dispatch({ selection: host.cmSelection.cursor(pos) });
        }
      }
    });
  };

  proto.destroyEditor = function (save) {
    const editMode = this.editMode;
    if (!editMode) return;
    if (save) {
      this.requestSave.cancel();
      this.save(editMode.cm.state.doc.toString(), true);
    }
    this.removeChild(editMode);
    this.editMode = null;
    this.editorEl.empty();
    this.applyScope(null);
    this.app.workspace.unsetActiveEditor(this);
  };

  proto.getFoldInfo = function () {
    return this.previewMode.renderer.getFoldInfo();
  };

  proto.onMarkdownFold = function () {
    const file = this.file;
    if (!file) return;
    const info = this.getMode() === "preview"
      ? this.previewMode.renderer.getFoldInfo()
      : this.editMode.getFoldInfo();
    this.app.foldManager.save(file, info);
  };

  proto.applyScope = function (scope) {
    if (scope === this.scope) return;
    if (this.scope) this.app.keymap.popScope(this.scope);
    if (scope) this.app.keymap.pushScope(scope);
    this.scope = scope;
  };

  proto.onload = function () {
    host.Component.prototype.onload.call(this);
    if (this.state && this.state.mode === "source") this.showEditor();
    else this.showPreview();
  };

  proto.onunload = function () {
    this.destroyEditor();
    this.containerEl.empty();
    this.app.workspace.unsetActiveEditor(this);
    host.Component.prototype.onunload.call(this);
  };

  return EmbedComponent;
}

export function ng18EmbedPreviewMode(host) {
  return ng18EmbedClass(host, "preview", () => buildNg18EmbedPreviewMode(host));
}

function buildNg18EmbedPreviewMode(host) {
  /** Preview half of an embed: a MarkdownRenderer pinned inside the embed's
   *  preview container, with the find bar and fold/config syncing. */
  function EmbedPreviewMode(owner, useEmbedHeader) {
    const self = host.MarkdownRenderer.call(this, owner.app, owner.previewEl, owner.path) || this;
    self.owner = owner;
    self.useEmbedHeader = useEmbedHeader === undefined ? true : useEmbedHeader;
    self.search = null;
    self.onFoldChange = host.debounce(() => self.owner.onMarkdownFold(), 500);
    return self;
  }
  inherit(EmbedPreviewMode, host.MarkdownRenderer);
  const proto = EmbedPreviewMode.prototype;

  Object.defineProperty(proto, "file", {
    get() { return this.owner.file; },
    enumerable: false,
    configurable: true,
  });

  proto.set = function (text) {
    this.renderer.set(text);
    const vault = this.app.vault;
    const previewEl = this.renderer.previewEl;
    previewEl.toggleClass("rtl", vault.getConfig("rightToLeft"));
    previewEl.toggleClass("show-indentation-guide", vault.getConfig("showIndentGuide"));
    this.renderer.applyFoldInfo(this.owner.getFoldInfo());
    const foldHeading = vault.getConfig("foldHeading");
    const foldIndent = vault.getConfig("foldIndent");
    previewEl.toggleClass("allow-fold-headings", foldHeading);
    previewEl.toggleClass("allow-fold-lists", foldIndent);
    if (!foldHeading) this.renderer.unfoldAllHeadings();
    if (!foldIndent) this.renderer.unfoldAllLists();
  };

  proto.foldAll = function () {
    const config = this.app.vault;
    if (config.getConfig("foldHeading")) this.renderer.foldAllHeadings();
    if (config.getConfig("foldIndent")) this.renderer.foldAllLists();
  };

  proto.unfoldAll = function () {
    const config = this.app.vault;
    if (config.getConfig("foldHeading")) this.renderer.unfoldAllHeadings();
    if (config.getConfig("foldIndent")) this.renderer.unfoldAllLists();
  };

  proto.edit = function (text) {
    this.renderer.set(text);
    this.owner.save(text, true);
  };

  proto.onScroll = function () {
    this.owner.syncScroll();
  };

  proto.showSearch = function () {
    if (!this.search) {
      const self = this;
      this.search = new host.DocumentSearch(this.app.scope, this.renderer, this.containerEl, () => {
        self.search = null;
        if (self.owner.applyScope) self.owner.applyScope(null);
      });
    }
    if (this.owner.applyScope) this.owner.applyScope(this.search.scope);
  };

  proto.onunload = function () {
    host.MarkdownRenderer.prototype.onunload.call(this);
    if (this.search && this.owner.applyScope) this.owner.applyScope(null);
  };

  return EmbedPreviewMode;
}

export function ng18IframeEditMode(host) {
  return ng18EmbedClass(host, "edit", () => buildNg18IframeEditMode(host));
}

function buildNg18IframeEditMode(host) {
  /** Source-editing half of an embed: an EditModeBase that can live inside a
   *  sandboxed iframe, with fold persistence and an Escape-to-preview keymap. */
  function IframeEditMode(owner) {
    const self = host.EditModeBase.call(this, owner.app, owner.editorEl, owner) || this;
    self.owner = owner;
    self.iframeEl = null;
    self.cleanup = null;
    self.propertiesExtension = null;
    self.requestSaveFolds = host.debounce(() => owner.onMarkdownFold(), 500);
    if (owner.useIframe) {
      owner.editorEl.detach();
      owner.editorEl.addClass("mod-inside-iframe");
      const iframe = owner.containerEl.createEl("iframe", { cls: "embed-iframe is-controlled" });
      iframe.setAttr("sandbox", "allow-forms allow-presentation allow-same-origin allow-scripts allow-modals");
      self.iframeEl = iframe;
      if (iframe.contentDocument) self.onIframeLoad();
      else iframe.addEventListener("load", () => self.onIframeLoad());
    }
    if (owner.inlineTitleEl) self.sizerEl.prepend(owner.inlineTitleEl);
    return self;
  }
  inherit(IframeEditMode, host.EditModeBase);
  const proto = IframeEditMode.prototype;

  proto.cleanupIframe = function () {
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = null;
    }
  };

  proto.onIframeLoad = function () {
    this.cleanupIframe();
    const iframe = this.iframeEl;
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument;
    if (!win || !doc) return;
    const base = doc.createElement("base");
    base.href = location.href;
    doc.head.appendChild(base);
    host.forwardInputEvents(win);
    const iframeEl = iframe;
    win.addEventListener("focus", (event) => {
      const forwarded = env().fZ(event);
      if (forwarded) iframeEl.dispatchEvent(forwarded);
      iframeEl.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    }, true);
    win.addEventListener("blur", (event) => {
      const forwarded = env().fZ(event);
      if (forwarded) iframeEl.dispatchEvent(forwarded);
    }, true);
    this.cleanup = host.mirrorStyles(win, [base]);
    win.app = this.app;
    host.installEnhancements(win);
    if (host.Platform.isDesktopApp) host.attachElectron(win);
    host.installTooltipHandlers(doc);
    doc.body.style.setProperty("--safe-area-inset-top", "0px");
    doc.body.style.setProperty("--safe-area-inset-right", "0px");
    doc.body.style.setProperty("--safe-area-inset-bottom", "0px");
    doc.body.style.setProperty("--safe-area-inset-left", "0px");
    host.activeWindow.setTimeout(() => this.reparent(doc.body));
  };

  proto.onunload = function () {
    host.EditModeBase.prototype.onunload.call(this);
    this.cleanupIframe();
  };

  proto.onUpdate = function (update, transactions) {
    host.EditModeBase.prototype.onUpdate.call(this, update, transactions);
    if (!transactions) return;
    this.owner.save(update.state.doc.toString());
    this.requestSaveFolds();
    const hasFold = transactions.some((tr) =>
      tr.effects.some((effect) => effect.is(host.cmFoldEffect) || effect.is(host.cmUnfoldEffect)));
    if (hasFold) this.requestSaveFolds();
  };

  proto.getDynamicExtensions = function () {
    const extensions = host.EditModeBase.prototype.getDynamicExtensions.call(this);
    if (!this.sourceMode) {
      if (!this.propertiesExtension) {
        this.propertiesExtension = host.propertiesExtensionFactory(this);
      }
      extensions.push(this.propertiesExtension);
    }
    const self = this;
    extensions.push(host.cmKeymapFacet.of([{
      key: "Escape",
      run() {
        const vim = self.cm.state && self.cm.state.vim;
        if (vim && String(vim.mode).includes("insert")) return false;
        self.owner.showPreview(true);
        return true;
      },
    }]));
    return extensions;
  };

  return IframeEditMode;
}
