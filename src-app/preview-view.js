// MarkdownPreviewView: the reading-mode half of a markdown leaf. It owns the "markdown-reading-view"
// element, the sectioned renderer settings (folds, readable width, RTL, properties-in-document,
// strict line breaks), the find bar and the ephemeral scroll/selection state.
import { inherit } from "./inherit.js";
import { newlinesBefore } from "./text.js";
import { copyText, distance, pointOfEvent } from "./misc.js";

export function defineMarkdownPreviewView(host) {
  /** `view` is the owning MarkdownView: it lends app, file, scope, inlineTitleEl, metadataEditor, backlinksEl. */
  function MarkdownPreviewView(view) {
    const el = view.contentEl.createDiv("markdown-reading-view");
    el.style.width = "100%";
    el.style.height = "100%";
    const self = host.MarkdownRenderer.call(this, view.app, el) || this;
    self.search = null;
    self.type = "preview";
    self.view = view;
    const renderer = self.renderer;
    renderer.addBottomPadding = true;
    self.updateReadableLineLength();
    self.updateFoldHeading();
    self.updateFoldIndent();
    self.updateIndentGuide();
    self.updateRTL();
    self.updatePropertiesInDocument();
    self.updateStrictLineBreaks();
    self.updateOptions();
    self.onResize();
    self.onFoldChange = host.debounce(() => self.view.onMarkdownFold(), 500);
    renderer.addHeader();
    renderer.addFooter();

    el.addEventListener("keydown", (event) => {
      if (!event.defaultPrevented && !event.isComposing && event.targetNode === renderer.previewEl && host.Keymap.isModifier(event, "Mod")) {
        if (event.key === "a") {
          event.preventDefault();
          new host.Notice(host.t.interface.menu.msgMarkdownCopyInstructions({ key: host.keyNames.Mod }));
          return false;
        }
        if (event.key === "c") {
          const selection = event.win.getSelection();
          if (!(selection && selection.toString())) {
            event.preventDefault();
            copyText(self.get());
            new host.Notice(host.t.interface.copied({ context: "generic" })).containerEl.addClass("mod-success");
            return false;
          }
        }
      }
    });

    el.addEventListener("contextmenu", (event) => {
      if (event.defaultPrevented || !event.isTrusted || (event.instanceOf(PointerEvent) && event.pointerType === "touch")) return;
      if (host.Platform.isMobile && window.getSelection() && !window.getSelection().isCollapsed) return;
      if (renderer.sizerEl.contains(event.targetNode)) return;
      self.app.workspace.trigger("markdown-viewport-menu", host.Menu.forEvent(event).addSections(["view", ""]), view, "preview", "gutter");
    });

    // touch: a double-tap on the reading view toggles back to the editor
    tapToToggle(el, () => self.view.toggleMode());
    return self;
  }
  inherit(MarkdownPreviewView, host.MarkdownRenderer);
  const proto = MarkdownPreviewView.prototype;

  /** Double-tap (within 300 ms, 30 px) on touch toggles the view mode; a selection or a defaultPrevented event cancels it. */
  function tapToToggle(el, toggle) {
    const windowMs = 300;
    const slopPx = 30;
    let lastTap = 0;
    el.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.pointerType !== "touch") return;
      let moved = false;
      let distanceSum = 0;
      let from = pointOfEvent(event);
      host.trackPointer(event, () => ({
        move: (e) => {
          const to = pointOfEvent(e);
          distanceSum += distance(from, to);
          from = to;
          if (distanceSum >= slopPx) moved = true;
        },
        end: (e) => {
          if (e.defaultPrevented || moved) { lastTap = 0; return; }
          const now = Date.now();
          if (lastTap === 0 || now - lastTap >= windowMs) {
            lastTap = now;
          } else {
            const selection = e.win.getSelection();
            if (!selection || selection.isCollapsed) toggle(e, pointOfEvent(e));
          }
        },
      }), 0);
    });
    el.addEventListener("click", (event) => {
      window.setTimeout(() => { if (event.defaultPrevented) lastTap = 0; }, 10);
    });
  }

  proto.onload = function () {
    const self = this;
    this.registerEvent(this.app.workspace.on("post-processor-change", () => self.rerender(true)));
    this.registerEvent(this.app.vault.on("config-changed", this.onConfigChanged, this));
  };

  Object.defineProperty(proto, "file", {
    get: function () { return this.view.file; },
    enumerable: false,
    configurable: true,
  });

  proto.show = function () {
    const renderer = this.renderer;
    renderer.header.el.appendChild(this.view.inlineTitleEl);
    renderer.header.el.appendChild(this.view.metadataEditor.containerEl);
    renderer.footer.el.appendChild(this.view.backlinksEl);
    this.containerEl.show();
    if (this.search) this.view.replaceScope(this.search.scope);
  };

  proto.hide = function () {
    this.containerEl.hide();
    if (this.search) this.view.replaceScope(null);
  };

  proto.get = function () { return this.renderer.text; };
  proto.set = function (data, clear) { if (clear) this.clear(); this.renderer.set(data); };
  proto.clear = function () { this.renderer.clear(); };
  proto.beforeUnload = function () {};
  proto.rerender = function (full) { this.renderer.rerender(full); };
  proto.getEphemeralState = function (state) {};

  proto.setEphemeralState = function (state) {
    if (state.focusMetadata) {
      this.view.metadataEditor.focusPropertyAtIndex(0);
    } else if (state.focus) {
      const previewEl = this.renderer.previewEl;
      previewEl.tabIndex = -1;
      previewEl.focus({ preventScroll: true });
    }
    if (state.hasOwnProperty("scroll")) this.renderer.applyScrollDelayed(state.scroll);
    const syncScroll = () => this.view.syncScroll();
    if (state.line !== undefined && state.line >= 0) {
      this.renderer.applyScrollDelayed(state.line, { highlight: true }, syncScroll);
    }
    if (state.propertyMatches !== undefined) {
      const matches = state.propertyMatches;
      if (matches.length > 0 && this.view.canShowProperties()) {
        const self = this;
        host.propertiesPlugin(this.app).then((properties) => {
          if (properties) host.focusWhenShown(properties.containerEl, () => properties.focusProperty(matches[0].key));
        });
      }
    } else if (state.match !== undefined) {
      const { content, matches } = state.match;
      if (matches.length > 0) {
        const line = newlinesBefore(content, matches[0][0]);
        this.renderer.applyScrollDelayed(line, { center: true, highlight: true }, syncScroll);
      }
    }
  };

  proto.getScroll = function () { return this.renderer.getScroll(); };
  proto.applyScroll = function (scroll) { this.renderer.applyScroll(scroll); };
  proto.getFoldInfo = function () { return this.renderer.getFoldInfo(); };
  proto.applyFoldInfo = function (info) { this.renderer.applyFoldInfo(info); };

  proto.onResize = function () {
    this.renderer.onResize();
    if (this.view.scroll !== null) this.renderer.applyScrollDelayed(this.view.scroll);
  };

  proto.showSearch = function () {
    const self = this;
    if (!this.search) {
      const search = (this.search = new host.DocumentSearch(this.view.scope, this.renderer, this.containerEl, () => {
        self.search = null;
        self.view.replaceScope(null);
      }));
      this.view.replaceScope(search.scope);
    }
    this.search.searchInputEl.focus();
    this.search.searchInputEl.select();
  };

  proto.updateReadableLineLength = function () {
    const enabled = this.app.vault.getConfig("readableLineLength");
    this.renderer.previewEl.toggleClass("is-readable-line-width", enabled);
  };
  proto.updateFoldHeading = function () {
    const enabled = this.app.vault.getConfig("foldHeading");
    this.renderer.previewEl.toggleClass("allow-fold-headings", enabled);
    if (!enabled) this.renderer.unfoldAllHeadings();
  };
  proto.updateFoldIndent = function () {
    const enabled = this.app.vault.getConfig("foldIndent");
    this.renderer.previewEl.toggleClass("allow-fold-lists", enabled);
    if (!enabled) this.renderer.unfoldAllLists();
  };
  proto.updateIndentGuide = function () {
    const enabled = this.app.vault.getConfig("showIndentGuide");
    this.renderer.previewEl.toggleClass("show-indentation-guide", enabled);
  };
  proto.updateRTL = function () {
    this.renderer.previewEl.toggleClass("rtl", this.app.vault.getConfig("rightToLeft"));
  };
  proto.updatePropertiesInDocument = function () {
    this.renderer.previewEl.toggleClass("show-properties", this.app.vault.getConfig("propertiesInDocument") !== "hidden");
  };
  proto.updateStrictLineBreaks = function () {
    host.markdownOptions.globalOptions.breaks = !this.app.vault.getConfig("strictLineBreaks");
    this.rerender();
  };
  proto.onConfigChanged = function (key) {
    switch (key) {
      case "readableLineLength": this.updateReadableLineLength(); break;
      case "foldHeading": this.updateFoldHeading(); break;
      case "foldIndent": this.updateFoldIndent(); break;
      case "showIndentGuide": this.updateIndentGuide(); break;
      case "rightToLeft": this.updateRTL(); break;
      case "propertiesInDocument": this.updatePropertiesInDocument(); break;
      case "strictLineBreaks": this.updateStrictLineBreaks(); break;
    }
  };
  proto.updateOptions = function () {};

  proto.edit = function (text) {
    this.renderer.set(text);
    this.view.onInternalDataChange();
    this.view.save();
  };

  proto.onScroll = function () {
    if (Date.now() - this.renderer.lastRender >= 100) {
      this.view.syncScroll();
      const navbar = this.app.mobileNavbar;
      if (navbar) navbar.onScroll(this.containerEl, this.getScroll());
    }
  };

  proto.onRenderComplete = function () {
    host.MarkdownRenderer.prototype.onRenderComplete.call(this);
    if (this.search && this.search.highlightRanges === null) this.search.updateQuery();
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
  proto.getSelection = function () { return window.getSelection().toString(); };

  return MarkdownPreviewView;
}
