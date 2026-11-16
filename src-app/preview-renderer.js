// MarkdownPreviewRenderer (Gz): turns parsed markdown sections into a virtualised, foldable,
// searchable DOM inside the reading view. Owns the render queue (idle-callback scheduled), the
// section recycling, heading/list folds, scroll position mapping and the search-highlight overlays.
// The markdown parse itself (worker or sync) and the post-processing stay in the inherited pipeline.
import { lineBounds } from "./text.js";

/** Deferred promise (the app's `gb`). */
function deferredRender() {
  const d = { promise: null, resolve: null, reject: null };
  d.promise = new Promise((resolve, reject) => { d.resolve = resolve; d.reject = reject; });
  return d;
}

/** Schedules `fn` on an idle callback when possible, else on the next animation frame.
 *  Returns { high, cancel } — `high` tells the caller it may continue synchronously. */
function scheduleIdleRender(fn, timeout) {
  const win = hostActiveWindow();
  if (timeout > 0 && win.requestIdleCallback) {
    let done = false;
    const idleId = win.requestIdleCallback(() => { done = true; win.clearTimeout(timer); fn(); }, { timeout });
    const timer = win.setTimeout(() => { done = true; win.cancelIdleCallback(idleId); fn(); }, timeout);
    return { high: false, cancel: () => { if (!done) { done = true; win.cancelIdleCallback(idleId); win.clearTimeout(timer); } } };
  }
  const frame = win.requestAnimationFrame(fn);
  return { high: true, cancel: () => win.cancelAnimationFrame(frame) };
}

// host.activeWindow is read lazily through the getter below (set by defineMarkdownPreviewRenderer).
let hostRef = null;
function hostActiveWindow() { return hostRef.activeWindow; }

/** queueMicrotask with a setTimeout fallback — same binding the app uses. */
const nextTick = window.queueMicrotask || window.setTimeout;

/** Offset of `el` relative to `container`, discounting scroll of intermediate ancestors.
 *  Returns { top, left, right } where right is the visible width remaining at that offset. */
function offsetWithin(el, container) {
  const width = el.offsetWidth;
  let span = width;
  let top = 0, left = 0;
  const boundary = container ? container.offsetParent : null;
  for (; el && el !== container && el !== boundary;) {
    top += el.offsetTop;
    left += el.offsetLeft;
    const parent = el.offsetParent;
    let p = el.parentElement;
    while (p && p !== parent) { top -= p.scrollTop; left -= p.scrollLeft; p = p.parentElement; }
    if (parent && parent !== boundary) {
      span = parent.offsetWidth;
      if (parent !== container) { top -= parent.scrollTop; left -= parent.scrollLeft; }
    }
    el = parent;
  }
  return { top, left, right: span - left - width };
}

/** DOM Range covering text offsets [start,end) inside `el`'s text nodes. */
function rangeForOffsets(textNodes, texts, start, end) {
  let at = 0, startNode = null, startOffset = -1, endNode = null, endOffset = -1;
  for (let i = 0; i < texts.length; i++) {
    const len = at + texts[i].length;
    if (at <= start && start <= len) { startNode = textNodes[i]; startOffset = start - at; }
    if (at <= end && end <= len) { endNode = textNodes[i]; endOffset = end - at; break; }
    at = len;
  }
  if (startNode && endNode) {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  }
  return null;
}

/** Range covering text offsets [start,end) inside `el`. */
function textRange(el, start, end, host) {
  const nodes = [];
  host.textNodes(el, nodes);
  const texts = nodes.map((n) => n.textContent || "");
  return rangeForOffsets(nodes, texts, start, end);
}

/** Calls `fn` on the first child when it is a heading (each preview section holds one). */
function eachHeading(el, fn) {
  const first = el.firstChild;
  if (first && first.instanceOf(HTMLHeadingElement)) fn(first);
}

/** Calls `fn` on every <li> that contains a nested list. */
function eachCollapsibleItem(el, fn) {
  const items = el.findAll("li");
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const nested = item.findAll("ul, ol");
    if (nested && nested.length > 0) fn(item);
  }
}

/** Toggles the collapsed state of a list item and its collapse icon. */
function setListCollapsed(el, collapsed) {
  el.toggleClass("is-collapsed", collapsed);
  const icon = el.find(".collapse-icon");
  if (icon) icon.toggleClass("is-collapsed", collapsed);
}

/** Loads a worker script, falling back to a blob URL when the worker origin differs or construction fails. */
function loadWorkerScript(url, options) {
  return (async () => {
    try {
      if (new URL(url, document.baseURI).origin !== location.origin) return await workerFromUrl(url, options);
    } catch (e) {}
    try {
      return new Worker(url, options);
    } catch (e) {
      return await workerFromUrl(url, options);
    }
  })();
}
function workerFromUrl(url, options) {
  return hostRef.ajaxPromise({ url }).then((text) =>
    new Worker(window.URL.createObjectURL(new Blob([text])), options));
}

/** One shared markdown worker; messages are serialised through `submit`. */
let markdownWorker = null;
function MarkdownWorkerChannel(worker) {
  this.promise = null;
  this.worker = worker;
  this.worker.onmessage = this.onMessage.bind(this);
}
MarkdownWorkerChannel.prototype.onMessage = function (event) {
  if (this.promise) {
    const pending = this.promise;
    this.promise = null;
    pending.resolve(event.data);
  }
};
MarkdownWorkerChannel.prototype.submit = function (message, transfer) {
  if (this.promise) return null;
  this.promise = deferredRender();
  this.worker.postMessage(message, transfer);
  return this.promise.promise;
};

export function defineMarkdownPreviewRenderer(host) {
  hostRef = host;

  /** The sectioned, virtualised preview renderer. `owner` is the MarkdownRenderer (or preview view):
   *  it receives onScroll/onFoldChange/onRenderComplete/onCheckboxClick and lends postProcess. */
  function MarkdownPreviewRenderer(owner, linkHandlers, containerEl, workerPath, registerEvents) {
    if (registerEvents === undefined) registerEvents = true;
    const self = this;
    this.previewEl = null;
    this.sizerEl = null;
    this.pusherEl = null;
    this.header = null;
    this.footer = null;
    this.cssClasses = null;
    this.sections = [];
    this.asyncSections = [];
    this.recycledSections = [];
    this.lastText = null;
    this.text = "";
    this.frontmatter = null;
    this.queued = null;
    this.rendered = null;
    this.lastRender = 0;
    this.lastScroll = 0;
    this.viewportHeight = 0;
    this.renderedWidth = 0;
    this.renderExtra = 1;
    this.renderExtraMinPx = 500;
    this.addBottomPadding = false;
    this.topSpace = 0;
    this.parsing = false;
    this.scrolling = false;
    this.owner = owner;
    this.workerPath = workerPath;

    const previewEl = (this.previewEl = containerEl.createDiv("markdown-preview-view markdown-rendered"));
    const sizerEl = (this.sizerEl = previewEl.createDiv("markdown-preview-sizer markdown-preview-section"));
    const pusherEl = (this.pusherEl = createDiv("markdown-preview-pusher"));
    pusherEl.style.width = "1px";
    pusherEl.style.height = "0.1px";
    MarkdownPreviewRenderer.registerDomEvents(sizerEl, linkHandlers, this.handleDetached.bind(this));
    sizerEl.on("click", "a.footnote-link", this.onFootnoteLinkClick.bind(this));
    sizerEl.on("click", ".task-list-item-checkbox", this.onCheckboxClick.bind(this));
    sizerEl.on("click", ".heading-collapse-indicator", this.onHeadingCollapseClick.bind(this));
    sizerEl.on("click", "li > .list-collapse-indicator", this.onListCollapseClick.bind(this));
    previewEl.addEventListener("scroll", this.onScroll.bind(this), { passive: true });
    if (registerEvents) {
      previewEl.onNodeInserted(() => self.queueRender());
      nextTick(() => self.onResize());
    }
  }

  const proto = MarkdownPreviewRenderer.prototype;

  proto.set = function (text) {
    this.text = text;
    this.queueRender();
  };

  proto.rerender = function (full) {
    this.lastText = null;
    if (full) {
      const header = this.header, footer = this.footer, sections = this.sections;
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (section !== header && section !== footer) {
          section.rendered = false;
          section.el.empty();
        }
      }
    }
    this.queueRender();
  };

  proto.clear = function () {
    this.sections = [];
    this.asyncSections = [];
    this.recycledSections = [];
    this.rendered = [];
    this.sizerEl.empty();
    this.text = "";
    this.lastText = null;
    this.lastScroll = 0;
    this.previewEl.scrollTop = 0;
    this.renderedWidth = 0;
    this.owner.onRenderComplete();
    this.cleanupParentComponents();
    this.queueRender();
  };

  proto.belongsToMe = function (el) {
    return MarkdownPreviewRenderer.belongsToMe(el, this.previewEl, this.handleDetached.bind(this));
  };

  proto.handleDetached = function (el) {
    return this.sections.some((section) => section.el === el);
  };

  proto.getSectionForElement = function (el) {
    const sections = this.sections;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (section.el.contains(el)) return section;
    }
    return null;
  };

  proto.getSectionInfo = function (el) {
    if (!this.belongsToMe(el)) return null;
    const section = this.getSectionForElement(el);
    return section ? { text: this.lastText || "", lineStart: section.start.line, lineEnd: section.end.line } : null;
  };

  proto.getInternalLinkHref = function (el) {
    const href = el.getAttr("data-href") || el.getAttr("href");
    return href && this.belongsToMe(el) ? href : null;
  };

  proto.onFootnoteLinkClick = function (event, el) {
    if (event.button !== 0 || !this.belongsToMe(el)) return;
    event.preventDefault();
    let href = el.getAttr("href");
    if (!href || !href.startsWith("#")) return;
    href = href.substr(1);
    const selector = "[data-footnote-id=" + href + "]";
    let section = null, target = null;
    const sections = this.sections;
    for (let i = 0; i < sections.length; i++) {
      const candidate = sections[i];
      const found = candidate.el.find(selector);
      if (found) { target = found; section = candidate; break; }
    }
    if (!target || !section) return;
    this.showSection(section);
    this.applyScrollSection(section);
    this.highlightEl(target);
    this.updateVirtualDisplay();
    target.scrollIntoView({ block: "center" });
    this.owner.onScroll();
  };

  proto.onCheckboxClick = function (event, el) {
    if (!this.belongsToMe(el)) return;
    const line = parseInt(el.getAttribute("data-line"));
    if (line < 0 || isNaN(line)) return;
    const section = this.getSectionContainer(el);
    if (section) this.owner.onCheckboxClick(event, el, section.start.line + line);
  };

  proto.onHeadingCollapseClick = function (event, el) {
    if (event.button !== 0 || event.defaultPrevented) return;
    const heading = el.parentNode;
    if (!(heading && heading.instanceOf(HTMLHeadingElement) && this.belongsToMe(heading))) return;
    const section = this.getSectionContainer(heading);
    if (section) {
      event.preventDefault();
      section.setCollapsed(!section.headingCollapsed);
      this.previewEl.win.getSelection().removeAllRanges();
      this.queueRender();
      this.owner.onFoldChange();
    }
  };

  proto.setListCollapse = function (el, collapsed) {
    if (el.findAll("ul, ol")) {
      setListCollapsed(el, collapsed);
      const section = this.getSectionContainer(el);
      if (section) section.resetCompute();
    }
  };

  proto.onListCollapseClick = function (event, el) {
    if (event.button !== 0 || event.defaultPrevented) return;
    const item = el.parentNode;
    if (!(item && item.instanceOf(HTMLLIElement) && this.belongsToMe(item))) return;
    event.preventDefault();
    this.setListCollapse(item, !item.hasClass("is-collapsed"));
    this.queueRender();
    this.owner.onFoldChange();
  };

  /** Schedules a render pass; a pending non-high priority task is cancelled and replaced. */
  proto.queueRender = function () {
    if (!this.rendered) this.rendered = [];
    const queued = this.queued;
    const parsing = !this.parsing;
    if (queued) {
      if (parsing && !queued.high) {
        queued.cancel();
        this.queued = scheduleIdleRender(this.onRender.bind(this), 0);
      }
    } else {
      const timeout = parsing ? 0 : 200;
      this.queued = scheduleIdleRender(this.onRender.bind(this), timeout);
    }
  };

  /** Parses the current text in the markdown worker; falls back to sync parsing on error. */
  proto.parseAsync = async function () {
    if (this.parsing) return;
    this.parsing = true;
    try {
      if (!markdownWorker) {
        const worker = await loadWorkerScript(this.workerPath);
        markdownWorker = new MarkdownWorkerChannel(worker);
      }
      while (markdownWorker.promise) await markdownWorker.promise.promise;
      const text = this.text;
      const result = await markdownWorker.submit({
        parseSections: text,
        options: host.markdownOptions.globalOptions,
      });
      const previewEl = this.previewEl;
      const scrollTop = previewEl.scrollTop;
      this.parseFinish(text, result);
      previewEl.scrollTop = scrollTop;
      this.onRender();
      this.parsing = false;
    } catch (error) {
      this.parsing = false;
      console.error(error);
      this.parseSync();
      this.queueRender();
    }
  };

  proto.parseSync = function () {
    const text = this.text;
    const parsed = host.parseMarkdownSections(text);
    this.parseFinish(text, parsed);
  };

  /** Rebuilds the section list from parse output, recycling unchanged sections by html. */
  proto.parseFinish = function (text, parsed) {
    const parsedSections = parsed.sections;
    const frontmatter = parsed.frontmatter;
    const self = this;
    const recycled = this.recycledSections;
    const header = this.header;
    const footer = this.footer;
    const oldSections = this.sections;
    const byHtml = new Map();
    for (let i = 0; i < oldSections.length; i++) {
      const section = oldSections[i];
      if (section !== header && section !== footer) {
        section.used = false;
        const list = byHtml.get(section.html);
        if (list) list.push(section); else byHtml.set(section.html, [section]);
      }
    }
    const sections = [];
    for (let i = 0; i < parsedSections.length; i++) {
      const parsedSection = parsedSections[i];
      const html = parsedSection.html;
      const level = parsedSection.level;
      const pos = parsedSection.pos;
      const start = pos.start, end = pos.end;
      let section = null;
      const candidates = byHtml.get(html);
      if (candidates && candidates.length > 0) {
        for (let j = 0; j < candidates.length; j++) {
          const candidate = candidates[j];
          if (!candidate.used) { candidate.used = true; section = candidate; break; }
        }
      }
      if (!section) section = new host.MarkdownPreviewSection(html);
      const firstLine = i === 0 ? 0 : start.line;
      const lastLine = i === parsedSections.length - 1 ? end.line + 1 : parsedSections[i + 1].pos.start.line;
      section.lines = lastLine - firstLine;
      section.start = start;
      section.end = end;
      section.level = level;
      sections.push(section);
    }
    const frontmatterSame = JSON.stringify(this.frontmatter) === JSON.stringify(frontmatter);
    this.frontmatter = frontmatter;
    if (frontmatterSame) {
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (section.usesFrontMatter) { section.rendered = false; section.el.empty(); }
      }
    }
    const cssClasses = this.cssClasses;
    const previewEl = this.previewEl;
    if (cssClasses) { previewEl.removeClasses(cssClasses); this.cssClasses = null; }
    const classes = host.frontmatterClasses(frontmatter);
    if (classes && classes.length > 0) {
      this.cssClasses = classes;
      previewEl.addClasses(classes);
    }
    if (header) sections.unshift(header);
    if (footer) sections.push(footer);
    this.sections = sections;
    const previousAsync = this.asyncSections;
    this.asyncSections = [];
    for (let i = 0; i < previousAsync.length; i++) {
      const section = previousAsync[i];
      if (sections.indexOf(section) !== -1) this.asyncSections.push(section);
    }
    for (let i = 0; i < oldSections.length; i++) {
      const section = oldSections[i];
      if (section.rendered && !section.used) recycled.push(section);
    }
    this.lastText = text;
    this.lastRender = Date.now();
  };

  /** One render pass: parse if stale, render pending sections (time-sliced), then virtualise. */
  proto.onRender = function () {
    this.queued = null;
    const previewEl = this.previewEl;
    if (!(previewEl && previewEl.offsetParent && previewEl.offsetWidth > 0)) return;
    const scrollTop = previewEl.scrollTop;
    if (this.lastText !== this.text) {
      if (!host.renderFlags.asyncParse || this.text.length < 10240) this.parseSync();
      else this.parseAsync();
    }
    const self = this;
    const sections = this.sections;
    const sizerEl = this.sizerEl;
    const pusherEl = this.pusherEl;
    let renderedCount = 0;
    const started = performance.now();
    let stop = false;
    const renderOne = function (section) {
      if (section.rendered) return "continue";
      renderedCount++;
      const el = section.el;
      section.render();
      const recyclers = MarkdownPreviewRenderer.recyclers;
      for (let i = 0; i < recyclers.length; i++) recyclers[i](el, self.recycledSections);
      eachHeading(el, (heading) => {
        host.setIcon(heading.createSpan({ cls: "heading-collapse-indicator collapse-indicator collapse-icon", prepend: true }), "right-triangle");
      });
      eachCollapsibleItem(el, (item) => {
        host.setIcon(item.createSpan({ cls: "list-collapse-indicator collapse-indicator collapse-icon", prepend: true }), "right-triangle");
      });
      if (host.renderFlags.listBullet) {
        const items = el.findAll("ul > li");
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          item.parentElement.addClass("has-list-bullet");
          item.createSpan({ cls: "list-bullet", prepend: true });
        }
      }
      const promises = [];
      self.owner.postProcess(section, promises, self.frontmatter);
      if (promises.length > 0) {
        self.asyncSections.push(section);
        Promise.all(promises).then(() => {
          self.asyncSections.remove(section);
          section.resetCompute();
          self.queueRender();
        });
      }
      if (renderedCount % 10 === 0 && performance.now() - started > 5) return "break";
      return undefined;
    };
    for (let i = 0; i < sections.length; i++) {
      if (renderOne(sections[i]) === "break") { stop = true; break; }
    }
    // collect the window of sections that need measuring: every unrendered-measure section plus
    // the run of already-mounted sections around them (one trailing computed section included)
    const measured = [];
    let collecting = false;
    const children = [pusherEl];
    let pending = 0;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const el = section.el;
      let inSizer = el.parentElement === sizerEl;
      if (!section.computed && section.rendered) {
        inSizer = true;
        measured.push(section);
        collecting = true;
        pending++;
      } else if (collecting) {
        inSizer = true;
        collecting = false;
      }
      if (inSizer) children.push(el);
      if (pending > 100) { stop = true; break; }
    }
    sizerEl.setChildrenInPlace(children);
    for (let i = 0; i < measured.length; i++) this.measureSection(measured[i]);
    this.topSpace = pusherEl.offsetTop;
    this.updateShownSections();
    this.updateVirtualDisplay(scrollTop);
    if (stop) {
      this.queueRender();
    } else if (this.lastText === this.text) {
      this.recycledSections = [];
      if (this.asyncSections.length > 0) return;
      if (this.rendered) {
        for (let i = 0; i < this.rendered.length; i++) this.rendered[i]();
      }
      this.rendered = null;
      this.owner.onRenderComplete();
      this.cleanupParentComponents();
    }
  };

  /** Hides sections under a collapsed heading (level tracking). */
  proto.updateShownSections = function () {
    let level = 7;
    const sections = this.sections;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (section.level > level) section.shown = false;
      else {
        section.shown = true;
        level = 7;
        if (section.headingCollapsed) level = section.level;
      }
    }
  };

  /** Keeps only the sections near the viewport mounted; everything else is detached. */
  proto.updateVirtualDisplay = function (scroll) {
    const self = this;
    const previewEl = this.previewEl;
    const sizerEl = this.sizerEl;
    const pusherEl = this.pusherEl;
    const sections = this.sections;
    let scrollTop = previewEl.scrollTop;
    if (typeof scroll === "number") scrollTop = scroll;
    if (!host.renderFlags.progressiveRender) {
      const children = [pusherEl];
      for (let i = 0; i < sections.length; i++) children.push(sections[i].el);
      sizerEl.setChildrenInPlace(children);
      sizerEl.style.minHeight = "";
      pusherEl.style.marginBottom = "0";
      previewEl.scrollTop = scrollTop;
      return;
    }
    this.lastScroll = scrollTop;
    const viewportHeight = previewEl.clientHeight;
    const bottom = scrollTop + viewportHeight;
    const maxScroll = Math.min(scrollTop, previewEl.scrollHeight - viewportHeight);
    const margin = Math.max(viewportHeight * this.renderExtra, this.renderExtraMinPx);
    const windowTop = maxScroll - margin;
    const windowBottom = bottom + margin;
    let totalHeight = 0, measuredCount = 0;
    for (let i = 0; i < sections.length; i++) {
      const height = sections[i].height;
      if (height > 0) { totalHeight += height; measuredCount++; }
    }
    let average = 0;
    if (measuredCount > 0) average = totalHeight / measuredCount;
    let offset = 0;
    let topSpace = this.topSpace;
    const children = [pusherEl];
    let first = -1, last = -1, selStart = -1, selEnd = -1;
    let selStartNode = null, selEndNode = null;
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (!range.collapsed && previewEl.contains(range.startContainer) && previewEl.contains(range.endContainer)) {
        selStartNode = range.startContainer;
        selEndNode = range.endContainer;
        if (selStartNode === pusherEl || (selStartNode === sizerEl && range.startOffset <= 1)) selStart = 0;
        if (selEndNode === sizerEl && range.endOffset > 1) selEnd = sections.length - 1;
      }
    }
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const el = section.el;
      if (selStartNode && (el === selStartNode || el.contains(selStartNode))) selStart = i;
      if (selEndNode && (el === selEndNode || el.contains(selEndNode))) selEnd = i;
      if (section.shown) {
        const height = section.height;
        if (section.computed) {
          const end = offset + height;
          if (end >= windowTop && offset <= windowBottom) {
            if (first === -1) first = i;
            last = i;
          }
          offset = end;
        } else {
          offset += height;
          if (height === 0) offset += average;
        }
      }
    }
    const viewportFrom = first, viewportTo = last;
    let from = first, to = last;
    if (selStart !== -1 && selEnd !== -1) {
      from = Math.min(from, selStart);
      to = Math.max(to, selEnd);
    }
    if (from < 0) from = 0;
    if (++to > sections.length - 1) to = sections.length - 1;
    offset = this.topSpace;
    let paddingTop = 0;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const el = section.el;
      if (section.shown && from <= i && i <= to) children.push(el);
      else if (el.parentNode === sizerEl) el.detach();
      let height = section.height;
      if (!section.computed && height === 0) height = average;
      if (!section.shown) height = 0;
      if (i === from) paddingTop = offset;
      offset += height;
    }
    if ((paddingTop -= this.topSpace) < 0) paddingTop = 0;
    offset -= this.topSpace;
    offset = Math.max(0, offset);
    pusherEl.style.marginBottom = paddingTop + "px";
    sizerEl.style.minHeight = offset - 1 + "px";
    sizerEl.setChildrenInPlace(children);
    if (to !== sections.length - 1) to--;
    for (let i = from; i <= to; i++) {
      const section = sections[i];
      if (section.shown) this.measureSection(section);
    }
    if (previewEl.scrollTop !== scrollTop) previewEl.scrollTop = scrollTop;
    this.renderHighlights(viewportFrom, viewportTo);
  };

  /** Draws the search-match highlight overlays for the visible range. */
  proto.renderHighlights = function (from, to) {
    const sections = this.sections;
    const sizerEl = this.sizerEl;
    const offsetParent = sizerEl.offsetParent;
    if (!offsetParent) return;
    const bounds = offsetParent.getBoundingClientRect();
    let scale = 1;
    if (offsetParent.instanceOf(HTMLElement)) scale = offsetParent.offsetWidth / Math.round(bounds.width);
    const overlays = [];
    for (let i = from; i <= to; i++) {
      if (i < 0 || i >= sections.length) continue;
      const section = sections[i];
      if (!section.shown) continue;
      const ranges = section.highlightRanges;
      if (!ranges || ranges.length === 0) continue;
      const nodes = [];
      host.textNodes(section.el, nodes);
      const texts = nodes.map((node) => node.textContent);
      for (let j = 0; j < ranges.length; j++) {
        const range = ranges[j];
        let rects = range.rects;
        if (!rects) {
          rects = range.rects = [];
          const domRange = rangeForOffsets(nodes, texts, range.start, range.end);
          if (!domRange) continue;
          const clientRects = domRange.getClientRects();
          for (let k = 0; k < clientRects.length; k++) {
            const rect = clientRects[k];
            rects.push({
              x: (rect.x - bounds.x + offsetParent.scrollLeft) * scale,
              y: (rect.y - bounds.y + offsetParent.scrollTop) * scale,
              width: rect.width * scale,
              height: rect.height * scale,
            });
          }
        }
        for (let k = 0; k < rects.length; k++) {
          const rect = rects[k];
          const overlay = createDiv();
          if (range.active) overlay.addClass("is-active");
          overlay.style.left = rect.x + "px";
          overlay.style.top = rect.y + "px";
          overlay.style.width = rect.width + "px";
          overlay.style.height = rect.height + "px";
          overlays.push(overlay);
        }
      }
    }
    if (overlays.length > 0) {
      const container = createDiv("search-highlight");
      container.setChildrenInPlace(overlays);
      sizerEl.appendChild(container);
    }
  };

  /** Caches the rendered height of a section from its DOM position. */
  proto.measureSection = function (section) {
    if (!section.rendered) return;
    const el = section.el;
    const next = el.nextSibling;
    const top = el.offsetTop;
    const bottom = next ? next.offsetTop : el.offsetTop + el.offsetHeight;
    section.height = bottom - top;
    section.computed = true;
  };

  /** Runs `fn` after the current render pass completes (or queues it onto the pending list). */
  proto.onRendered = function (fn) {
    if (this.rendered) this.rendered.push(fn);
    else fn();
  };

  proto.onResize = function () {
    const sections = this.sections;
    const previewEl = this.previewEl;
    const sizerEl = this.sizerEl;
    const viewportHeight = (this.viewportHeight = previewEl.clientHeight);
    const width = previewEl.offsetWidth;
    sizerEl.style.paddingBottom = this.addBottomPadding ? Math.round(viewportHeight / 2) + "px" : "0";
    if (width !== this.renderedWidth) {
      this.renderedWidth = width;
      for (let i = 0; i < sections.length; i++) sections[i].resetCompute();
      this.queueRender();
    } else {
      this.updateVirtualDisplay();
    }
  };

  proto.foldAllHeadings = function () {
    const fold = function (section) {
      eachHeading(section.el, () => section.setCollapsed(true));
    };
    const sections = this.sections;
    for (let i = 0; i < sections.length; i++) fold(sections[i]);
    this.updateShownSections();
    this.updateVirtualDisplay();
    this.owner.onFoldChange();
  };

  proto.unfoldAllHeadings = function () {
    const sections = this.sections;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      section.setCollapsed(false);
      section.shown = true;
    }
    this.updateVirtualDisplay();
    this.owner.onFoldChange();
  };

  proto.foldAllLists = function () {
    const self = this;
    const sections = this.sections;
    for (let i = 0; i < sections.length; i++) {
      eachCollapsibleItem(sections[i].el, (item) => self.setListCollapse(item, true));
    }
    this.queueRender();
    this.owner.onFoldChange();
  };

  proto.unfoldAllLists = function () {
    const self = this;
    const sections = this.sections;
    for (let i = 0; i < sections.length; i++) {
      eachCollapsibleItem(sections[i].el, (item) => self.setListCollapse(item, false));
    }
    this.queueRender();
    this.owner.onFoldChange();
  };

  /** Serialises the current folds: heading folds plus collapsed list ranges and the metadata fold. */
  proto.getFoldInfo = function () {
    const self = this;
    const folds = [];
    if (this.frontmatter) {
      const sections = this.sections;
      for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        const container = section.el.find(".metadata-container");
        if (container) {
          if (container.hasClass("is-collapsed")) {
            folds.push({ from: section.start.line, to: section.start.line + section.lines });
          }
          break;
        }
      }
    }
    for (let i = 0; i < this.sections.length; i++) {
      const section = this.sections[i];
      eachHeading(section.el, () => {
        if (section.headingCollapsed) {
          let to = section.start.line + section.lines;
          if (i < self.sections.length - 1) to = self.sections[i + 1].start.line - 1;
          folds.push({ from: section.start.line, to });
        }
      });
    }
    const collectListFolds = function (section) {
      eachCollapsibleItem(section.el, (item) => {
        if (item.hasClass("is-collapsed")) {
          const line = parseInt(item.getAttribute("data-line"));
          if (line < 0 || isNaN(line)) return;
          const next = item.nextElementSibling;
          if (!next) {
            const to = section.start.line + section.lines - 1;
            folds.push({ from: section.start.line + line, to });
            return;
          }
          const nextLine = parseInt(next.getAttribute("data-line"));
          if (nextLine < line || isNaN(nextLine)) return;
          folds.push({ from: section.start.line + line, to: nextLine - 1 });
        }
      });
    };
    const sections = this.sections;
    for (let i = 0; i < sections.length; i++) collectListFolds(sections[i]);
    return { folds, lines: this.text.match(/^/gm).length };
  };

  /** Reapplies a saved fold state once the document has the same line count. */
  proto.applyFoldInfo = function (info) {
    const self = this;
    if (!info || info.lines === this.text.match(/^/gm).length) {
      this.onRendered(() => {
        const folded = new Set();
        if (info) {
          for (let i = 0; i < info.folds.length; i++) folded.add(info.folds[i].from);
        }
        const foldHeadings = function (section) {
          eachHeading(section.el, () => section.setCollapsed(folded.has(section.start.line)));
        };
        const sections = self.sections;
        for (let i = 0; i < sections.length; i++) foldHeadings(sections[i]);
        const foldLists = function (section) {
          eachCollapsibleItem(section.el, (item) => {
            const line = parseInt(item.getAttribute("data-line"));
            if (line < 0 || isNaN(line)) return;
            const sourceLine = section.start.line + line;
            const collapsed = folded.has(sourceLine);
            if (item.hasClass("is-collapsed") !== collapsed) {
              setListCollapsed(item, collapsed);
              section.resetCompute();
            }
          });
        };
        for (let i = 0; i < sections.length; i++) foldLists(sections[i]);
        self.queueRender();
      });
    }
  };

  proto.onScroll = function () {
    const previewEl = this.previewEl;
    const lastScroll = this.lastScroll;
    const viewportHeight = this.viewportHeight;
    const scrollTop = previewEl.scrollTop;
    if (Math.abs(lastScroll - scrollTop) > Math.max(viewportHeight * this.renderExtra, this.renderExtraMinPx) / 2) {
      this.updateVirtualDisplay(scrollTop);
    }
    if (this.scrolling) this.scrolling = false;
    else this.owner.onScroll();
  };

  /** Maps a scroll offset back to a source line (fractional, for sync between modes). */
  proto.getScroll = function () {
    const previewEl = this.previewEl;
    const sections = this.sections;
    if (sections.length === 0) return null;
    const scrollTop = previewEl.scrollTop;
    let line = 0;
    let topSpace = this.topSpace;
    const topOf = (el) => offsetWithin(el, previewEl).top;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (!section.computed) return null;
      if (!(scrollTop > topSpace + section.height || (line === 0 && section.lines === 0))) {
        let height = section.height;
        if (line === 0) { height += topSpace; topSpace = 0; }
        let resultLine = line;
        let fraction = 0;
        const scrollInSection = scrollTop - topSpace;
        if (section.lines > 0) {
          const pxPerLine = height / section.lines;
          const lineIndex = Math.floor(scrollInSection / pxPerLine);
          resultLine += lineIndex;
          fraction = scrollInSection / pxPerLine - lineIndex;
        }
        const sectionTop = topOf(section.el);
        let firstItem = null, firstItemLine = 0, pxPerLine = height / section.lines;
        const items = section.el.findAll("li");
        for (let j = 0; j < items.length; j++) {
          const item = items[j];
          if (!this.belongsToMe(item)) continue;
          const itemLine = parseInt(item.getAttribute("data-line"));
          if (itemLine < 0 || isNaN(itemLine) || !item.isShown()) continue;
          if (!(topOf(item) - sectionTop < scrollInSection)) {
            const span = itemLine - firstItemLine;
            if (span > 0) {
              const firstTop = firstItem ? topOf(firstItem) : sectionTop;
              pxPerLine = (topOf(item) - firstTop) / span;
            }
            break;
          }
          firstItemLine = itemLine;
          firstItem = item;
          pxPerLine = 0;
        }
        if (firstItem) {
          if (pxPerLine === 0) {
            pxPerLine = (section.el.offsetTop + section.height - topOf(firstItem)) / (section.lines - firstItemLine);
          }
          resultLine = line + firstItemLine;
          fraction = (scrollInSection - (topOf(firstItem) - sectionTop)) / pxPerLine;
        }
        return resultLine + fraction;
      }
      line += section.lines;
      if (section.shown) topSpace += section.height;
    }
    return line;
  };

  /** Scrolls to a source line; returns false when the document is not rendered yet. */
  proto.applyScroll = function (line, options) {
    if (!Number.isNumber(line) || isNaN(line)) return false;
    if (this.text !== this.lastText) return false;
    const target = Math.floor(line);
    const fraction = line - target;
    this.scrolling = true;
    const sections = this.sections;
    const opts = options || {};
    const highlight = opts.highlight;
    const center = opts.center;
    let lineCount = 0;
    let topSpace = this.topSpace;
    const topOf = (el) => offsetWithin(el, this.previewEl).top;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (!section.computed) return false;
      if (!(lineCount + section.lines <= target)) {
        if (!section.shown && highlight) {
          this.showSection(section);
          if (section.shown) return this.applyScroll(line, options);
        }
        let height = section.height;
        if (lineCount === 0) { height += topSpace; topSpace = 0; }
        let pxPerLine = height / section.lines;
        const lineIndex = target - lineCount;
        let viewOffset = 0;
        if (center) viewOffset -= (this.previewEl.clientHeight - pxPerLine) / 2;
        let scrollTop = Math.max(0, topSpace + pxPerLine * (lineIndex + fraction) + viewOffset);
        this.updateVirtualDisplay(scrollTop);
        let firstItem = null, firstItemLine = 0;
        const items = section.el.findAll("li");
        for (let j = 0; j < items.length; j++) {
          const item = items[j];
          if (!this.belongsToMe(item)) continue;
          const itemLine = parseInt(item.getAttribute("data-line"));
          if (itemLine < 0 || isNaN(itemLine) || !item.isShown()) continue;
          if (!(itemLine <= lineIndex)) {
            const span = itemLine - firstItemLine;
            if (span > 0) {
              const firstTop = firstItem ? topOf(firstItem) : section.el.offsetTop;
              pxPerLine = (topOf(item) - firstTop) / span;
            }
            break;
          }
          firstItemLine = itemLine;
          firstItem = item;
          pxPerLine = 0;
        }
        if (firstItem) {
          if (pxPerLine === 0) {
            pxPerLine = (section.el.offsetTop + section.height - topOf(firstItem)) / (section.lines - firstItemLine);
          }
          const itemTop = topOf(firstItem) - section.el.offsetTop;
          scrollTop = Math.max(0, topSpace + itemTop + pxPerLine * (lineIndex - firstItemLine + fraction) + viewOffset);
          this.previewEl.scrollTop = scrollTop;
        }
        if (highlight) this.highlightEl(firstItem || section.el);
        return true;
      }
      lineCount += section.lines;
      if (section.shown) topSpace += section.height;
    }
    return true;
  };

  /** Pixel offset of a section's top inside the sizer (average-height estimate for unmeasured). */
  proto.getSectionTop = function (section) {
    const sections = this.sections;
    let top = 0;
    for (let i = 0; i < sections.length; i++) {
      const candidate = sections[i];
      if (candidate === section) return top;
      let height = candidate.height;
      if (!candidate.computed && height === 0 && i > 0) height = top / i;
      if (!candidate.shown) height = 0;
      top += height;
    }
    return -1;
  };

  /** Un-collapses ancestor headings so `section` becomes visible. */
  proto.showSection = function (section) {
    if (section.shown) return;
    const sections = this.sections;
    const index = sections.indexOf(section);
    if (index === -1) return;
    let level = section.level;
    for (let i = index; i >= 0;) {
      const candidate = sections[i];
      if (candidate.headingCollapsed && candidate.level < level) {
        candidate.setCollapsed(false);
        level = candidate.level;
      }
      i--;
    }
    this.updateShownSections();
    this.updateVirtualDisplay();
  };

  /** Scrolls so `section`'s top hits the viewport top; false when unknown. */
  proto.applyScrollSection = function (section) {
    const previewEl = this.previewEl;
    const top = this.getSectionTop(section);
    if (top === -1) return false;
    this.scrolling = true;
    previewEl.scrollTop = top;
    return true;
  };

  /** applyScroll now, or once the next render pass finishes. */
  proto.applyScrollDelayed = function (line, options, callback) {
    const self = this;
    if (this.applyScroll(line, options)) {
      if (callback) callback();
    } else {
      this.onRendered(() => {
        self.applyScroll(line, options);
        if (callback) callback();
      });
    }
  };

  /** Briefly flashes an element (footnote targets, scroll highlights). */
  proto.highlightEl = function (el) {
    const sections = this.sections;
    for (let i = 0; i < sections.length; i++) {
      const flashing = sections[i].el.findAllSelf(".is-flashing");
      for (let j = 0; j < flashing.length; j++) flashing[j].removeClass("is-flashing");
    }
    el.addClass("is-flashing");
    setTimeout(() => el.removeClass("is-flashing"), 3000);
  };

  proto.getSectionContainer = function (el) {
    let found = null;
    const sections = this.sections;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (section.el.contains(el)) { found = section; break; }
    }
    return found;
  };

  /** Selects a match range inside a section, scrolling it into view when needed. */
  proto.selectRange = function (range) {
    const sizerEl = this.sizerEl;
    const previewEl = this.previewEl;
    const section = range.section;
    const start = range.start;
    const end = range.end;
    this.showSection(section);
    const top = this.getSectionTop(section);
    if (!sizerEl.contains(section.el)) {
      previewEl.scrollTop = top;
      this.updateVirtualDisplay();
    }
    const domRange = textRange(section.el, start, end, host);
    if (domRange) {
      let element = domRange.startContainer;
      while (element && !(element.instanceOf(HTMLElement))) element = element.parentNode;
      if (element) {
        const topEdge = previewEl.scrollTop + 40;
        const bottomEdge = topEdge + previewEl.clientHeight - 40;
        if (element.offsetTop < topEdge || element.offsetTop + element.offsetHeight > bottomEdge) {
          element.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
        }
      }
      this.updateVirtualDisplay();
    }
  };

  proto.addHeader = function () {
    if (this.header) return;
    this.header = new host.MarkdownPreviewSection(null);
    this.header.el.addClass("mod-header", "mod-ui");
    this.sections.unshift(this.header);
    this.queueRender();
  };
  proto.removeHeader = function () {
    if (!this.header) return;
    removeItem(this.sections, this.header);
    this.header = null;
    this.queueRender();
  };
  proto.addFooter = function () {
    if (this.footer) return;
    this.footer = new host.MarkdownPreviewSection(null);
    this.footer.el.addClass("mod-footer", "mod-ui");
    this.sections.push(this.footer);
    this.queueRender();
  };
  proto.removeFooter = function () {
    if (!this.footer) return;
    removeItem(this.sections, this.footer);
    this.footer = null;
    this.queueRender();
  };
  proto.updateHeader = function () {
    const header = this.header;
    if (header) { header.resetCompute(); this.queueRender(); }
  };
  proto.updateFooter = function () {
    const footer = this.footer;
    if (footer) { footer.resetCompute(); this.queueRender(); }
  };

  /** Drops render-child components whose container is no longer part of this preview. */
  proto.cleanupParentComponents = function () {
    const stale = [];
    const children = this.owner._children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child instanceof host.MarkdownRenderChild && !this.belongsToMe(child.containerEl)) stale.push(child);
    }
    for (let i = 0; i < stale.length; i++) this.owner.removeChild(stale[i]);
  };

  // ---- statics ----

  MarkdownPreviewRenderer.postProcessors = [];
  MarkdownPreviewRenderer.codeBlockPostProcessors = {};
  MarkdownPreviewRenderer.recyclers = [];

  MarkdownPreviewRenderer.registerPostProcessor = function (processor, sortOrder) {
    processor.sortOrder = sortOrder;
    const list = this.postProcessors;
    list.push(processor);
    list.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  };
  MarkdownPreviewRenderer.unregisterPostProcessor = function (processor) {
    removeItem(this.postProcessors, processor);
  };
  MarkdownPreviewRenderer.registerRecycler = function (recycler) {
    this.recyclers.push(recycler);
  };
  MarkdownPreviewRenderer.unregisterRecycler = function (recycler) {
    removeItem(this.recyclers, recycler);
  };
  MarkdownPreviewRenderer.registerCodeBlockPostProcessor = function (language, processor) {
    const registry = this.codeBlockPostProcessors;
    if (registry.hasOwnProperty(language)) {
      throw new Error("Code block postprocessor for language " + language + " is already registered");
    }
    registry[language] = processor;
  };
  MarkdownPreviewRenderer.unregisterCodeBlockPostProcessor = function (language) {
    delete this.codeBlockPostProcessors[language];
  };

  /** Builds a post-processor that runs `factory(codeText, blockEl, sectionApi)` on every
   *  `code.language-<language>` block; `replaceCode` rewrites the source through the section API. */
  MarkdownPreviewRenderer.createCodeBlockPostProcessor = function (language, factory) {
    return function (el, ctx) {
      const blocks = el.findAll("code.language-" + language);
      if (blocks.length === 0) return;
      const process = function (code) {
        let text = host.codeText(code);
        const parent = code.parentElement;
        const blockEl = createDiv("block-language-" + language);
        parent.replaceWith(blockEl);
        const api = ctx;
        api.replaceCode = function (newText) {
          const info = ctx.getSectionInfo(blockEl);
          if (info) {
            const sectionText = info.text;
            const from = lineBounds(sectionText, info.lineStart).start;
            const to = lineBounds(sectionText, info.lineEnd).end;
            const blockText = sectionText.substring(from, to);
            let line = parseInt(code.dataset.line, 10);
            if (isNaN(line)) line = 0;
            const codeStart = lineBounds(blockText, line + 1).start;
            const codeEnd = codeStart + text.length;
            if (blockText.substring(codeStart, codeEnd) === text) {
              ctx.replace(blockText.substring(0, codeStart) + newText + blockText.substring(codeEnd), true);
              host.codeTexts.set(code, newText);
              text = newText;
            }
          }
        };
        const result = factory(text, blockEl, api);
        if (result) ctx.promises.push(result);
      };
      for (let i = 0; i < blocks.length; i++) process(blocks[i]);
    };
  };

  /** Wires delegated click/drag/contextmenu/hover handlers for links, footnotes, media and tags.
   *  `el` is the sizer, `handlers` the link-handler object, `detachedCheck` reports owned detachment. */
  MarkdownPreviewRenderer.registerDomEvents = function (el, handlers, detachedCheck) {
    function linkInfo(linkEl) {
      const href = linkEl.getAttr("data-href") || linkEl.getAttr("href");
      return href && MarkdownPreviewRenderer.belongsToMe(linkEl, el, detachedCheck)
        ? { href, displayText: linkEl.getText().trim() }
        : null;
    }
    function onLinkClick(event, linkEl) {
      if (event.button === 0 || event.button === 1) {
        const info = linkInfo(linkEl);
        if (info) handlers.onInternalLinkClick(event, linkEl, info.href, info.displayText);
      }
    }
    function onMedia(event, mediaEl) {
      if (event.defaultPrevented) return;
      if (!MarkdownPreviewRenderer.belongsToMe(mediaEl, el, detachedCheck) || !host.Platform.isMobile) return;
      event.preventDefault();
      if (mediaEl.instanceOf(HTMLImageElement)) {
        showMobileImageViewer(mediaEl);
      }
    }
    el.on("click", "a.internal-link", onLinkClick);
    el.on("auxclick", "a.internal-link", onLinkClick);
    el.on("dragstart", "a.internal-link", (event, linkEl) => {
      const info = linkInfo(linkEl);
      if (info) handlers.onInternalLinkDrag(event, linkEl, info.href, info.displayText);
    });
    el.on("contextmenu", "a.internal-link", (event, linkEl) => {
      const info = linkInfo(linkEl);
      if (info) handlers.onInternalLinkRightClick(event, linkEl, info.href, info.displayText);
    });
    el.on("mouseover", "a.internal-link", (event, linkEl) => {
      const info = linkInfo(linkEl);
      if (info) handlers.onInternalLinkMouseover(event, linkEl, info.href, info.displayText);
    });
    el.on("mouseover", "a.footnote-link", (event, linkEl) => {
      const ref = linkEl.dataset.footref;
      if (ref && MarkdownPreviewRenderer.belongsToMe(linkEl, el, detachedCheck)) {
        handlers.onInternalLinkMouseover(event, linkEl, "#[^" + ref + "]");
      }
    });
    el.on("click", "a.external-link", (event, linkEl) => {
      if (event.button === 0 || event.button === 1) {
        const href = linkEl.getAttr("href");
        if (href && MarkdownPreviewRenderer.belongsToMe(linkEl, el, detachedCheck)) {
          handlers.onExternalLinkClick(event, linkEl, href);
        }
      }
    });
    el.on("contextmenu", "a.external-link", (event, linkEl) => {
      const href = linkEl.getAttr("href");
      if (href && MarkdownPreviewRenderer.belongsToMe(linkEl, el, detachedCheck)) {
        handlers.onExternalLinkRightClick(event, linkEl, href);
      }
    });
    el.on("click", "a.tag", (event, linkEl) => {
      if (event.button === 0 && MarkdownPreviewRenderer.belongsToMe(linkEl, el, detachedCheck)) {
        event.preventDefault();
        const tag = linkEl.getText();
        handlers.onTagClick(event, linkEl, tag);
      }
    });
    el.on("click", "img,video", onMedia);
    el.on("contextmenu", "img,video", onMedia);
  };

  /** True when `el` belongs to the preview rooted at `container`: walks ancestors and rejects
   *  elements inside another preview/bases view or detached subtrees (via `detachedCheck`). */
  MarkdownPreviewRenderer.belongsToMe = function (el, container, detachedCheck) {
    for (; el;) {
      if (el === container) return true;
      if (el.classList.contains("markdown-preview-view") || el.classList.contains("bases-view")) return false;
      const parent = el.parentElement;
      if (!parent) return !!detachedCheck && detachedCheck(el);
      el = parent;
    }
    return false;
  };

  return MarkdownPreviewRenderer;
}

function removeItem(list, item) {
  const index = list.indexOf(item);
  if (index !== -1) list.splice(index, 1);
}

/** Full-screen mobile image viewer: pinch zoom around the pinch midpoint, drag pan with inertia. */
function showMobileImageViewer(image) {
  const clone = image.cloneNode();
  const viewer = document.body.createDiv("mobile-image-viewer");
  viewer.appendChild(clone);
  let width = clone.width, height = clone.height;
  const naturalWidth = clone.naturalWidth, naturalHeight = clone.naturalHeight;
  let maxZoom = 5, panX = 0, panY = 0, scale = 1;
  const apply = function () {
    const margin = (scale - 1) / scale / 2;
    const limitX = Math.max(0, width * margin);
    const limitY = Math.max(0, height * margin);
    panX = Math.clamp(panX, -limitX, limitX);
    panY = Math.clamp(panY, -limitY, limitY);
    scale = Math.clamp(scale, 1, maxZoom);
    clone.style.transform = "scale(" + scale + ") translate(" + panX + "px, " + panY + "px)";
  };
  let velocity = 0, angle = 0, lastFrame = 0, frame = 0;
  const animate = function () {
    cancelAnimationFrame(frame);
    const now = Date.now();
    const dt = now - lastFrame;
    panX += Math.cos(angle) * velocity * dt;
    panY += Math.sin(angle) * velocity * dt;
    apply();
    velocity -= Math.min(0.003 * dt, velocity);
    if (velocity > 0.01) {
      lastFrame = now;
      frame = requestAnimationFrame(animate);
    }
  };
  clone.addEventListener("load", () => {
    width = clone.width;
    height = clone.height;
    maxZoom = 2 * Math.max(naturalWidth / width, naturalHeight / height);
    if (maxZoom < 1) maxZoom = 1;
    apply();
  });
  let touchA = null, touchB = null;
  const onTouch = function (event) {
    cancelAnimationFrame(frame);
    const now = Date.now();
    const dt = now - lastFrame;
    const touches = Array.prototype.slice.call(event.touches);
    let currentA = null, currentB = null;
    for (let i = 0; i < touches.length; i++) {
      const touch = touches[i];
      if (touchA && touch.identifier === touchA.identifier) currentA = touch;
      if (touchB && touch.identifier === touchB.identifier) currentB = touch;
    }
    if (currentB && !currentA) { touchA = touchB; currentA = touchB; touchB = null; currentB = null; }
    if (currentA) touches.remove(currentA);
    else if (touches.length > 0) { currentA = touches[0]; touches.splice(0, 1); }
    if (currentB) touches.remove(currentB);
    else if (touches.length > 0) { currentB = touches[0]; touches.splice(0, 1); }
    if (touchA && currentA && touchA.identifier === currentA.identifier) {
      const centerX = window.innerWidth / 2, centerY = window.innerHeight / 2;
      if (touchB && currentB && touchB.identifier === currentB.identifier) {
        const prevMidX = (touchA.clientX + touchB.clientX) / 2, prevMidY = (touchA.clientY + touchB.clientY) / 2;
        const midX = (currentA.clientX + currentB.clientX) / 2, midY = (currentA.clientY + currentB.clientY) / 2;
        const prevDx = touchA.clientX - touchB.clientX, prevDy = touchA.clientY - touchB.clientY;
        const dx = currentA.clientX - currentB.clientX, dy = currentA.clientY - currentB.clientY;
        const prevLenSq = prevDx * prevDx + prevDy * prevDy;
        const lenSq = dx * dx + dy * dy;
        if (prevLenSq !== 0 && lenSq !== 0) {
          const ratio = Math.sqrt(lenSq / prevLenSq);
          const newScale = scale * ratio;
          const prevPanX = -panX + (prevMidX - centerX) / scale;
          const prevPanY = -panY + (prevMidY - centerY) / scale;
          panX = (midX - centerX) / newScale - prevPanX;
          panY = (midY - centerY) / newScale - prevPanY;
          scale = newScale;
          apply();
        }
      } else {
        const moveX = (currentA.clientX - touchA.clientX) / scale;
        const moveY = (currentA.clientY - touchA.clientY) / scale;
        panX += moveX;
        panY += moveY;
        velocity = Math.sqrt(moveX * moveX + moveY * moveY) / dt;
        angle = Math.atan2(moveY, moveX);
        apply();
      }
    }
    touchB = currentB;
    touchA = currentA || touchB;
    if (!touchA && !touchB) frame = requestAnimationFrame(animate);
    lastFrame = now;
  };
  viewer.addEventListener("touchstart", onTouch);
  viewer.addEventListener("touchend", onTouch);
  viewer.addEventListener("touchmove", onTouch);
  viewer.addEventListener("touchcancel", onTouch);
  viewer.addEventListener("click", (event) => {
    viewer.remove();
    event.preventDefault();
    cancelAnimationFrame(frame);
  });
}
