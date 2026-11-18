// g24 clean-room: reading-mode render foundation.
// MarkdownRenderChild / MarkdownPreviewSection / PreviewLinkHandlers / MarkdownRenderer.
import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { debounceCall } from "./timing.js";
import { randomHex, isUrl, copyText } from "./misc.js";
import { lineBounds } from "./text.js";

// ---------------------------------------------------------------------------
// MarkdownRenderChild (zz): Component owning a render container element.
// ---------------------------------------------------------------------------

export function ng24DefineMarkdownRenderChild(host) {
  function MarkdownRenderChild(containerEl) {
    const self = host.Component.call(this) || this;
    self.containerEl = containerEl;
    return self;
  }
  inherit(MarkdownRenderChild, host.Component);
  return MarkdownRenderChild;
}

// ---------------------------------------------------------------------------
// MarkdownPreviewSection (qz): one measured slice of a preview.
// ---------------------------------------------------------------------------

export function ng24DefineMarkdownPreviewSection(host) {
  function MarkdownPreviewSection(html) {
    this.rendered = false;
    this.height = 0;
    this.computed = false;
    this.lines = 0;
    this.used = true;
    this.highlightRanges = null;
    this.level = 0;
    this.headingCollapsed = false;
    this.shown = true;
    this.usesFrontMatter = false;
    this.html = html || "";
    this.el = createDiv();
    this.start = { line: 0, col: 0, offset: 0 };
    this.end = { line: 0, col: 0, offset: 0 };
    // `null` html marks the pre-render "empty slot" sentinel
    if (html === null) { this.rendered = true; this.html = ""; }
  }
  const proto = MarkdownPreviewSection.prototype;

  proto.render = function () {
    if (this.rendered) return;
    const fragment = host.sanitizeHtml(this.html);
    this.el.appendChild(fragment);
    const first = this.el.firstElementChild;
    if (first) this.el.addClass("el-" + first.tagName.toLowerCase());
    this.rendered = true;
    this.computed = false;
  };

  proto.resetCompute = function () {
    this.computed = false;
    if (this.highlightRanges) {
      for (const r of this.highlightRanges) r.rects = null;
    }
  };

  proto.setCollapsed = function (collapsed) {
    this.headingCollapsed = collapsed;
    host.setCollapsed(this.el, collapsed);
  };

  return MarkdownPreviewSection;
}

// ---------------------------------------------------------------------------
// PreviewLinkHandlers (lq): click/drag/hover/right-click for links & tags.
// ---------------------------------------------------------------------------

export function ng24DefinePreviewLinkHandlers(host) {
  function PreviewLinkHandlers(info) {
    this.info = info;
  }
  const proto = PreviewLinkHandlers.prototype;

  proto.onInternalLinkDrag = function (event, targetEl, linktext, sourcePath) {
    const app = this.info.app;
    app.dragManager.onDragStart(event, app.dragManager.dragLink(event, linktext, this.info.path, sourcePath));
  };

  proto.onInternalLinkClick = function (event, targetEl, linktext) {
    event.preventDefault();
    this.info.app.workspace.openLinkText(linktext, this.info.path, host.Keymap.isModEvent(event));
  };

  proto.onInternalLinkRightClick = function (event, targetEl, linktext) {
    const app = this.info.app;
    const menu = host.Menu.forEvent(event);
    menu.setParentElement(targetEl.parentElement);
    menu.addSections(["title", "open", "action", "clipboard", "view", "info", "", "danger"]);
    menu.addItem((item) => item
      .setSection("clipboard")
      .setTitle(host.t.interface.menu.copyLinkText ? host.t.interface.menu.copyLinkText() : "Copy link text")
      .setIcon("lucide-copy")
      .onClick(() => copyText(targetEl.textContent)));
    app.workspace.handleLinkContextMenu(menu, linktext, this.info.path);
  };

  proto.onExternalLinkClick = function (event, targetEl, href) {
    event.preventDefault();
    if (!isUrl(href)) {
      new host.Notice(host.t.interface.msgFailedToOpenHref({ href }));
      return;
    }
    const mod = host.Keymap.isModEvent(event);
    window.open(href, mod ? host.keyNames.Mod : "");
  };

  proto.onExternalLinkRightClick = function (event, targetEl, href) {
    const app = this.info.app;
    const menu = host.Menu.forEvent(event);
    menu.setParentElement(targetEl.parentElement);
    menu.addSections(["title", "open", "selection", "clipboard", "info", "action", "view", "", "danger"]);
    menu.addItem((item) => item
      .setSection("clipboard")
      .setTitle(host.t.interface.menu.copyLinkText ? host.t.interface.menu.copyLinkText() : "Copy link text")
      .setIcon("lucide-copy")
      .onClick(() => copyText(targetEl.textContent)));
    app.workspace.handleExternalLinkContextMenu(menu, href);
  };

  proto.onInternalLinkMouseover = function (event, targetEl, linktext) {
    this.info.app.workspace.trigger("hover-link", {
      event, source: "preview", hoverParent: this.info, targetEl, linktext, sourcePath: this.info.path,
    });
  };

  proto.onTagClick = function (event, targetEl, tag) {
    const plugin = this.info.app.internalPlugins.getEnabledPluginById("global-search");
    if (plugin) plugin.openGlobalSearch("tag:" + tag);
  };

  return PreviewLinkHandlers;
}

// ---------------------------------------------------------------------------
// MarkdownRenderer (hq): the object plugins call to render markdown into DOM.
// ---------------------------------------------------------------------------

const ng24WarnedPlugins = new Set();

export function ng24DefineMarkdownRenderer(host) {
  function MarkdownRenderer(app, containerEl, sourcePath, registerEvents = true) {
    const self = host.MarkdownRenderChild.call(this, containerEl) || this;
    self.docId = randomHex(16);
    self.hoverPopover = null;
    self.requestUpdateLinks = debounceCall(() => self.resolveLinks(), 500);
    self.app = app;
    const info = { app, path: sourcePath || "" };
    self.linkHandlers = new host.PreviewLinkHandlers(info);
    self.renderer = new host.MarkdownPreviewRenderer(self, self.linkHandlers, containerEl, "worker.js", registerEvents);
    return self;
  }
  inherit(MarkdownRenderer, host.MarkdownRenderChild);
  const proto = MarkdownRenderer.prototype;

  Object.defineProperty(proto, "path", {
    get() { return (this.file && this.file.path) || ""; },
    enumerable: false,
    configurable: true,
  });

  proto.onload = function () {
    const app = this.app;
    this.registerEvent(app.vault.on("modify", this.onFileChangeBound || (this.onFileChangeBound = this.onFileChange.bind(this))));
    this.registerEvent(app.vault.on("delete", this.onFileChangeBound));
    this.registerEvent(app.metadataCache.on("changed", this.onFileChangeBound));
  };

  proto.onFileChange = function () {
    this.requestUpdateLinks();
  };

  /** Re-resolves "is-unresolved" on every rendered section's links. */
  proto.resolveLinks = function (el) {
    const app = this.app;
    const sections = el ? [this.renderer.getSectionContainer ? this.renderer.getSectionContainer(el) : null] : this.renderer.sections;
    for (const section of sections) {
      if (!section || !section.el) continue;
      const links = section.el.findAll("a.internal-link");
      for (const link of links) {
        const href = link.getAttr("data-href") || link.getAttr("href");
        if (href) link.toggleClass("is-unresolved", app.metadataCache.isUnresolved(href.split("#")[0].split("|")[0], this.path));
      }
    }
  };

  proto.onCheckboxClick = function (event, checkboxEl, line) {
    event.preventDefault();
    navigator.vibrate && navigator.vibrate(100);
    const toggled = host.MarkdownRenderer.toggleCheckbox(this.renderer.text, line);
    if (!toggled) return;
    // patch the owning section's stored html so re-renders keep the state
    const section = this.renderer.getSectionContainer(checkboxEl);
    if (section && section.html) {
      const rel = line - section.start.line;
      const re = new RegExp(
        '(<li class="task-list-item[^"]*" data-task="." data-line="' + rel + '">[\\s\\S]*?<input[^>]*class="task-list-item-checkbox"[^>]*>)',
      );
      section.html = section.html.replace(re, (m) =>
        m.replace('class="task-list-item-checkbox"', 'class="task-list-item-checkbox" checked')
         .replace(/data-task="[^"]*"/, 'data-task="' + (toggled.char === "x" ? "x" : " ") + '"'));
      section.rendered = false;
      section.el.empty();
      this.renderer.queueRender();
    }
    // flip the live DOM node
    checkboxEl.checked = toggled.char === "x";
    checkboxEl.setAttr("data-task", toggled.char);
    const li = checkboxEl.closest("li");
    if (li) li.toggleClass("is-checked", toggled.char === "x");
    this.edit(toggled.text);
  };

  proto.postProcess = function (section, promises, frontmatter) {
    const ctx = host.MarkdownPreviewView.postProcess(this.app, {
      docId: this.docId,
      sourcePath: this.path,
      frontmatter,
      promises,
      addChild: (child) => this.addChild(child),
      getSectionInfo: (el) => this.renderer.getSectionInfo(el),
      replace: (html, rerender) => {
        const text = this.renderer.text;
        const next = text.slice(0, section.start.offset) + html + text.slice(section.end.offset);
        if (rerender) {
          const parsed = host.renderSectionHtml(next.slice(section.start.offset, section.start.offset + html.length));
          // adopt the single resulting section html when available
        }
        this.edit(next);
      },
      containerEl: this.renderer.sizerEl,
      el: section.el,
    });
    section.usesFrontMatter = !!ctx.usesFrontMatter;
    this.resolveLinks(section.el);
    return ctx;
  };

  proto.onScroll = function () {};
  proto.onFoldChange = function () {};
  proto.onRenderComplete = function () {};

  /** Writes `text` back as the view's source (edit-mode path). */
  proto.edit = function (text) {
    if (this.view && this.view.onInternalDataChange) {
      this.renderer.set(text);
      this.view.onInternalDataChange();
      this.view.save && this.view.save();
    }
  };

  // ------------------------------------------------------------- statics

  /** Flips the first "[ ]"/"[x]" marker on `line` of `text`. */
  MarkdownRenderer.toggleCheckbox = function (text, line) {
    const { start, end } = lineBounds(text, line);
    const lineText = text.slice(start, end);
    const m = /\[([ xX])\]/.exec(lineText);
    if (!m) return null;
    const char = m[1] === " " ? "x" : " ";
    const next = lineText.slice(0, m.index) + "[" + char + "]" + lineText.slice(m.index + m[0].length);
    return { text: text.slice(0, start) + next + text.slice(end), char };
  };

  /** Instance-less post-processing shared by render() and instances. */
  MarkdownRenderer.postProcess = function (app, ctx) {
    const el = ctx.el || ctx.containerEl;
    // query blocks -> query embeds
    const blocks = el.findAll("code.language-query");
    for (const block of blocks) {
      const query = host.queryBlockText(block.textContent || "");
      if (query) {
        const embed = host.queryEmbed(app, query, block.parentElement || block, ctx.sourcePath);
        if (ctx.addChild) ctx.addChild(embed);
      }
    }
    // registered post-processors
    const processors = host.MarkdownPreviewRenderer.postProcessors || [];
    for (const processor of processors) {
      try {
        const out = processor(el, ctx);
        if (out && typeof out.then === "function") ctx.promises.push(out);
      } catch (e) { console.error(e); }
    }
    const depth = host.embedDepth(ctx.containerEl);
    const embeds = el.findAll(".internal-embed:not(.is-loaded)");
    for (const embed of embeds) {
      const src = embed.getAttr("src") || embed.getAttr("data-src") || "";
      const child = host.EmbedLoader.load({
        app,
        linktext: src,
        sourcePath: ctx.sourcePath,
        containerEl: embed,
        displayMode: ctx.displayMode,
        showInline: true,
        depth,
      });
      if (ctx.addChild) ctx.addChild(child);
      if (child && child.loadFile) ctx.promises.push(Promise.resolve(child.loadFile()));
    }
    return ctx;
  };

  MarkdownRenderer.renderMarkdown = function (markdown, el, sourcePath, component) {
    return MarkdownRenderer.render(null, markdown, el, sourcePath, component);
  };

  MarkdownRenderer.render = function (app, markdown, el, sourcePath, component) {
    if (!(component instanceof host.Component)) {
      // warn once per plugin id (parsed from the stack's plugin:<id> frame)
      try {
        const stack = new Error().stack || "";
        const m = /plugin:([\w-]+)/.exec(stack);
        if (m && !ng24WarnedPlugins.has(m[1])) {
          ng24WarnedPlugins.add(m[1]);
          console.error("MarkdownRenderer.render/renderMarkdown requires the calling plugin's Component to avoid leaked global handlers.");
        }
      } catch (e) {}
    }
    const tree = host.markdownTree(markdown);
    const frontmatter = host.treeFrontmatter(tree);
    const html = host.sanitizeHtml(host.treeToHtml(tree));
    el.appendChild(html);
    const promises = [];
    const ctx = {
      docId: randomHex(16),
      sourcePath: sourcePath || "",
      frontmatter,
      promises,
      addChild: component instanceof host.Component ? (child) => component.addChild(child) : () => {},
      getSectionInfo: () => null,
      replace: () => null,
      containerEl: el,
      el,
      displayMode: true,
    };
    MarkdownRenderer.postProcess(app || { internalPlugins: { getEnabledPluginById: () => null }, metadataCache: { getFirstLinkpathDest: () => null }, embedRegistry: { getEmbedCreator: () => null }, vault: { getAbstractFileByPath: () => null }, dragManager: {}, workspace: {} }, ctx);
    return promises.length ? Promise.all(promises) : Promise.resolve();
  };

  return MarkdownRenderer;
}

export const defineMarkdownRenderChild = ng24DefineMarkdownRenderChild;
export const defineMarkdownPreviewSection = ng24DefineMarkdownPreviewSection;
export const definePreviewLinkHandlers = ng24DefinePreviewLinkHandlers;
export const defineMarkdownRenderer = ng24DefineMarkdownRenderer;
