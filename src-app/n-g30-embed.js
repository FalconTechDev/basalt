// g30 clean-room: reading-mode markdown embed view, editor embed section base,
// CM6 embed widget base and the ```query embed view (spec g30 part A).
import {env} from "./env.js";
import {inherit} from "./inherit.js";
import {searchViewClasses, runSearchOverFiles} from "./n-g11-view.js";
import {searchClasses} from "./n-g11-query.js";
import {ng30SearchStrings} from "./n-g30-i18n.js";

/** Blank out every ```query fenced block (chars -> spaces, newlines kept). */
function ng30BlankQueryBlocks(content) {
  return String(content).replace(/```query[^\n]*\n[\s\S]*?```/g, (block) =>
    block.replace(/[^\n]/g, " "));
}

/** `dq` — a markdown file (or #subpath) rendered inside reading-mode markdown. */
export function ng30MarkdownEmbedView(host) {
  function MarkdownEmbedView(info, file, subpath) {
    const self = host.Component.call(this) || this;
    self.app = info.app;
    self.containerEl = info.containerEl;
    self.file = file;
    self.subpath = subpath;
    self.hoverPopover = null;
    self.containerEl.classList.add("markdown-embed");
    if (info.showInline) {
      self.containerEl.classList.add("inline-embed");
      self.headerEl = createDiv("embed-title markdown-embed-title");
      self.containerEl.prepend(self.headerEl);
    }
    return self;
  }
  inherit(MarkdownEmbedView, host.Component);
  Object.defineProperty(MarkdownEmbedView.prototype, "path", {
    get: function () { return (this.file && this.file.path) || ""; },
  });

  MarkdownEmbedView.prototype.loadFile = async function () {
    const app = this.app, file = this.file;
    const cache = app.metadataCache.getFileCache(file);
    const range = host.subpathToPos(cache, this.subpath);
    let text = await app.vault.cachedRead(file);
    if (range) text = host.subpathContent(text, cache, range).content;
    const tree = host.markdownTree(text);
    const frontmatter = host.treeFrontmatter(tree);
    const html = host.sanitizeHtml(host.treeToHtml(tree));
    if (!this.subpath && this.headerEl) this.headerEl.textContent = file.basename;
    const content = createDiv("markdown-embed-content");
    this.containerEl.appendChild(content);
    const view = createDiv("markdown-preview-view markdown-rendered");
    content.appendChild(view);
    view.appendChild(html);
    view.classList.toggle("rtl", !!app.vault.getConfig("rightToLeft"));
    view.classList.toggle("show-indentation-guide", !!app.vault.getConfig("showIndentGuide"));
    const linkHandlers = new host.PreviewLinkHandlers(this);
    host.MarkdownPreviewRenderer.registerDomEvents(view, linkHandlers);
    const promises = [];
    const ctx = {
      docId: host.randomHex(16),
      sourcePath: file.path,
      frontmatter,
      promises,
      addChild: (child) => this.addChild(child),
      getSectionInfo: () => null,
      replace: () => null,
      containerEl: view,
      el: view,
      displayMode: true,
    };
    host.MarkdownPreviewView.postProcess(app, ctx);
    if (promises.length) await Promise.all(promises);
  };
  return MarkdownEmbedView;
}

/** `NV` — base of editor-side embed sections; never recycled by the editor. */
export function ng30EmbedSectionBase(host) {
  function EmbedSectionBase(app, editor) {
    const self = host.Component.call(this) || this;
    self.children = [];
    self.app = app;
    self.editor = editor;
    return self;
  }
  inherit(EmbedSectionBase, host.Component);
  Object.defineProperty(EmbedSectionBase.prototype, "noReuse", { get: () => true });
  EmbedSectionBase.prototype.addChild = function (child) {
    this.editor.addChild(child);
    this.children.push(child);
  };
  EmbedSectionBase.prototype.removeChild = function (child) {
    this.editor.removeChild(child);
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
  };
  return EmbedSectionBase;
}

const ng30EmbedOwners = new WeakMap();

/** `FV` — base of block widgets embedded in the CM6 editor. */
export function ng30EmbedWidget(host) {
  function EmbedWidget() {
    const self = host.EmbedWidgetBase.apply(this, arguments) || this;
    self.start = -1;
    self.end = -1;
    return self;
  }
  inherit(EmbedWidget, host.EmbedWidgetBase);
  const proto = EmbedWidget.prototype;

  proto.setPos = function (start, end) {
    this.start = start;
    this.end = end;
  };

  proto.toDOM = function (view) {
    if (!this.containerEl) this.containerEl = this.initDOM(view);
    return this.containerEl;
  };

  proto.setOwner = function (el) {
    ng30EmbedOwners.set(el, this);
  };

  proto.hookClickHandler = function (view, owner) {
    this.setOwner(owner);
    host.nativeDblClick(owner, (evt) => {
      let n = evt.targetNode;
      while (n && n !== view.contentDOM) {
        if (n.classList && (n.classList.contains("cm-editor") || n.classList.contains("interactive-child"))) return;
        n = n.parentNode;
      }
      EmbedWidget.selectElement(view, owner);
    });
  };

  proto.addEditButton = function (view, owner) {
    this.setOwner(owner);
    const btn = createDiv("edit-block-button");
    owner.appendChild(btn);
    env().tv(btn, "lucide-code-2");
    host.Mv(btn, env().gm.editor.menu.labelEditBlock());
    btn.addEventListener("click", () => EmbedWidget.selectElement(view, owner));
  };

  proto.resizeWidget = function (view, el) {
    if (!this.resizeObserver) {
      this.resizeObserver = new ResizeObserver(() => view.requestMeasure());
    }
    this.resizeObserver.observe(el, { box: "border-box" });
  };

  proto.destroy = function () {
    if (this.resizeObserver) this.resizeObserver.disconnect();
  };

  EmbedWidget.getOwner = function (el) {
    return ng30EmbedOwners.get(el);
  };

  EmbedWidget.selectElement = function (view, owner) {
    const w = ng30EmbedOwners.get(owner);
    if (!w) return;
    try {
      let start = w.start, end = w.end;
      if (start < 0 || end < 0) {
        const pos = view.posAtDOM(owner);
        view.dispatch({ selection: { head: pos, anchor: pos } });
        view.focus();
        return;
      }
      if (env().Yl.isMobile) end = start;
      view.dispatch({ selection: { head: start, anchor: end }, scrollIntoView: true });
      view.focus();
    } catch (e) { /* selection failures are swallowed */ }
  };
  return EmbedWidget;
}

/** `mq` — view for fenced ```query blocks: live search results in markdown. */
export function ng30QueryEmbedView(host) {
  function QueryEmbedView(app, containerEl, query, sourcePath) {
    const self = host.MarkdownRenderChild.call(this, containerEl) || this;
    self.app = app;
    self.query = query;
    self.sourcePath = sourcePath;
    self.searchQuery = null;
    const strings = ng30SearchStrings();
    const emptyText = strings && strings.labelNoMatches ? strings.labelNoMatches() : "";
    self.dom = new searchViewClasses.SearchResults(app, containerEl, emptyText);
    self.queue = new searchViewClasses.SearchQueueComponent(app, self.dom);
    self.addChild(self.queue);
    return self;
  }
  inherit(QueryEmbedView, host.MarkdownRenderChild);
  const proto = QueryEmbedView.prototype;

  proto.onload = function () {
    const self = this;
    try {
      self.dom.emptyResults();
      const text = String(self.query || "").replace(/[\r\n]+/g, " ");
      const sq = new searchClasses.SearchQuery(self.app, text, false);
      if (!sq.matcher) return;
      self.searchQuery = sq;
      const queue = self.queue.start();
      runSearchOverFiles(self.app, sq.requiredInputs, queue, async (file, content) => {
        if (file.path === self.sourcePath) content = ng30BlankQueryBlocks(content);
        const result = sq.match(file, content);
        if (result) self.dom.addResult(file, result, content);
        else self.dom.removeResult(file);
      }).catch((e) => console.log(e));
    } catch (e) {
      console.log(e);
    }
  };

  proto.onResize = function () {
    this.dom.onResize();
  };
  return QueryEmbedView;
}
