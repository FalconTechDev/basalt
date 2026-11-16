// Display-mode embed views: the markdown file embed shown inside reading mode
// (`dq`) and the base section every CM6 embed child derives from (`NV`).
// Both stay plain constructor functions linked with `inherit` because inherited
// subclasses still call them through `Base.call(this, ...)`.

import { inherit, methods } from "./inherit.js";

export function defineMarkdownEmbedView(host) {
  /** Reading-mode embed of another markdown file (or a `file#subpath` slice of it). */
  function MarkdownEmbedView(info, file, subpath) {
    const self = host.Component.call(this) || this;
    self.hoverPopover = null;
    self.app = info.app;
    self.containerEl = info.containerEl;
    self.containerEl.addClass("markdown-embed");
    self.file = file;
    self.subpath = subpath;
    if (info.showInline) {
      self.containerEl.addClass("inline-embed");
      self.headerEl = self.containerEl.createDiv({ cls: "embed-title markdown-embed-title", prepend: true });
    }
    return self;
  }
  inherit(MarkdownEmbedView, host.Component);

  methods(MarkdownEmbedView, {
    loadFile() {
      const self = this;
      return (async () => {
        const app = self.app;
        const file = self.file;
        const subpath = self.subpath;
        const cache = app.metadataCache.getFileCache(file);
        const range = host.subpathToPos(cache, subpath);
        let text = await app.vault.cachedRead(file);
        if (range) text = host.subpathContent(text, cache, range).content;
        const tree = host.markdownTree(text);
        const frontmatter = host.treeFrontmatter(tree);
        const html = host.sanitizeHtml(host.treeToHtml(tree));
        if (!subpath) self.headerEl?.setText(file.basename);
        const content = self.containerEl.createDiv("markdown-embed-content");
        const view = content.createDiv("markdown-preview-view markdown-rendered");
        view.toggleClass("rtl", app.vault.getConfig("rightToLeft"));
        view.toggleClass("show-indentation-guide", app.vault.getConfig("showIndentGuide"));
        view.appendChild(html);
        const linkHandlers = new host.PreviewLinkHandlers(self);
        host.MarkdownPreviewRenderer.registerDomEvents(view, linkHandlers);
        const promises = [];
        host.MarkdownPreviewView.postProcess(app, {
          docId: host.randomHex(16),
          sourcePath: file.path,
          frontmatter,
          promises,
          addChild: (child) => self.addChild(child),
          getSectionInfo: () => null,
          replace: () => null,
          containerEl: view,
          el: view,
          displayMode: true,
        });
        if (promises.length > 0) await Promise.all(promises);
      })();
    },
  });

  Object.defineProperty(MarkdownEmbedView.prototype, "path", {
    get() { return this.file?.path || ""; },
    configurable: true,
  });

  return MarkdownEmbedView;
}

export function defineEmbedSectionBase(host) {
  /** Base of the editor embed sections: owns the child list and forwards add/remove to the editor. */
  function EmbedSectionBase(app, editor) {
    const self = host.EmbedCursorBase.call(this) || this;
    self.children = [];
    self.app = app;
    self.editor = editor;
    return self;
  }
  inherit(EmbedSectionBase, host.EmbedCursorBase);

  Object.defineProperty(EmbedSectionBase.prototype, "noReuse", {
    get() { return true; },
    configurable: true,
  });

  methods(EmbedSectionBase, {
    addChild(child) {
      this.editor.addChild(child);
      this.children.push(child);
    },
    removeChild(child) {
      this.editor.removeChild(child);
      this.children.remove(child);
    },
  });

  return EmbedSectionBase;
}
