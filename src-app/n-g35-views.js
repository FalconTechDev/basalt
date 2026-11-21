// g35 clean-room: embed views rendered inside markdown — the view container
// base, the ![[note]] markdown embed and the ```query results embed
// (spec g35, s22-views). Superseded in the bundle by the s07 slice; behaviour
// is kept for the export contract.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

/** ES5-style container base: tracks child widgets and forwards to the editor. */
export function ng35DefineViewContainer(host) {
  const Base = typeof env().FV === "function" ? env().FV : function () {};
  function ViewContainer(app, editor) {
    Base.call(this);
    this.children = [];
    this.app = app;
    this.editor = editor;
  }
  inherit(ViewContainer, Base);
  Object.defineProperty(ViewContainer.prototype, "noReuse", { get: function () { return true; } });
  ViewContainer.prototype.addChild = function (child) {
    this.editor.addChild(child);
    this.children.push(child);
  };
  ViewContainer.prototype.removeChild = function (child) {
    this.editor.removeChild(child);
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
  };
  return ViewContainer;
}

/** ![[note]] / ![[note#section]] embed rendered as a mini preview. */
export function ng35DefineMarkdownEmbed(host) {
  function MarkdownEmbed(context, file, subpath) {
    host.Component.call(this);
    this.hoverPopover = null;
    this.app = context.app;
    this.containerEl = context.containerEl;
    this.containerEl.addClass("markdown-embed");
    this.file = file;
    this.subpath = subpath;
    if (context.showInline) {
      this.containerEl.addClass("inline-embed");
      this.headerEl = this.containerEl.createDiv({ cls: "embed-title markdown-embed-title", prepend: true });
    }
  }
  inherit(MarkdownEmbed, host.Component);
  Object.defineProperty(MarkdownEmbed.prototype, "path", { get: function () { return (this.file && this.file.path) || ""; } });
  MarkdownEmbed.prototype.loadFile = async function () {
    const cache = this.app.metadataCache.getFileCache(this.file);
    const pos = env().FT(cache, this.subpath);
    let content = await this.app.vault.cachedRead(this.file);
    if (pos) content = env().NT(content, cache, pos).content;
    const tree = env().Kx(content);
    const frontmatter = env().$x(tree);
    const fragment = env().xL(env().Zx(tree));
    if (!this.subpath && this.headerEl) this.headerEl.setText(this.file.basename);
    const contentEl = this.containerEl.createDiv("markdown-embed-content");
    const preview = contentEl.createDiv("markdown-preview-view markdown-rendered");
    preview.toggleClass("rtl", !!this.app.vault.getConfig("rightToLeft"));
    preview.toggleClass("show-indentation-guide", !!this.app.vault.getConfig("showIndentGuide"));
    preview.appendChild(fragment);
    env().Gz.registerDomEvents(preview, new host.PreviewLinkHandlers(this));
    const promises = [];
    env().fq.postProcess(this.app, {
      docId: env().cc(16),
      sourcePath: this.file.path,
      frontmatter,
      promises,
      addChild: (c) => this.addChild(c),
      getSectionInfo: () => null,
      replace: () => null,
      containerEl: preview,
      el: preview,
      displayMode: true,
    });
    await Promise.all(promises);
  };
  return MarkdownEmbed;
}
