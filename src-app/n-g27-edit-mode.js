// g27 edit-mode: MarkdownEditMode (orig j6) — the "source" edit mode of a
// MarkdownView. Extends EditModeBase; reparents title/properties/backlinks into
// the editor sizer, keeps ephemeral cursor/scroll/highlight state, computes
// fold info including the properties block, adds the live-preview properties
// extension, sizes bottom padding and debounces save/fold/internal changes.
import { inherit, methods } from "./n-g27-inherit.js";

export function defineMarkdownEditMode(host) {

  // char offset inside a text block -> {line (0-based), ch}
  function ng27TextPos(content, offset) {
    offset = Math.max(0, Math.min(offset, content.length));
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < offset; i++) {
      if (content.charCodeAt(i) === 10) {
        line++;
        lineStart = i + 1;
      }
    }
    return { line, ch: offset - lineStart };
  }

  function ng27CssPx(el, name, doc) {
    const view = doc || (el && el.ownerDocument) || document;
    const raw = view.defaultView.getComputedStyle(view.documentElement).getPropertyValue(name);
    const value = parseFloat(raw);
    return isNaN(value) ? 0 : value;
  }

  function MarkdownEditMode(view) {
    const self = host.EditModeBase.call(this, view.app, view.contentEl, view) || this;
    self.type = "source";
    self.view = view;
    self.app = view.app;
    self.requestOnInternalDataChange = host.debounce(() => view.onInternalDataChange(), 10);
    self.requestSaveFolds = host.debounce(() => view.onMarkdownFold(), 500);
    self.propertiesExtension = null;
    self.search.applyScope = (scope) => { view.scope = scope; };
    view.addChild(self);
    self.updateReadableLineLength();
    self.updateOptions();
    self.cm.scrollDOM.addEventListener("contextmenu", (event) => self.onViewportMenu(event));
    return self;
  }
  inherit(MarkdownEditMode, host.EditModeBase);

  methods(MarkdownEditMode, {

    show() {
      host.EditModeBase.prototype.show.call(this);
      const sizer = this.sizerEl;
      sizer.prepend(this.view.metadataEditor.containerEl);
      sizer.prepend(this.view.inlineTitleEl);
      sizer.appendChild(this.view.backlinksEl);
    },

    set() {
      return host.EditModeBase.prototype.set.apply(this, arguments);
    },

    clear() {
      host.EditModeBase.prototype.clear.call(this);
      this.propertiesExtension = null;
    },

    destroy() {
      host.EditModeBase.prototype.destroy.call(this);
      this.propertiesExtension = null;
    },

    getSelection() {
      return this.editor.getSelection();
    },

    beforeUnload() {
      this.requestOnInternalDataChange.cancel();
      this.requestSaveFolds.run();
      this.saveHistory();
    },

    // ------------------------------------------------ ephemeral state

    getEphemeralState(state) {
      const sel = this.cm.state.selection.main;
      state.cursor = {
        from: this.editor.offsetToPos(sel.anchor),
        to: this.editor.offsetToPos(sel.head),
      };
      return state;
    },

    setEphemeralState(state) {
      this.setState(state);
      this.setHighlight(state);
    },

    setState(state) {
      state = state || {};
      let focus = false;
      const cursor = state.cursor;
      if (cursor && cursor.from) {
        const info = this.editor.getScrollInfo();
        this.editor.setSelection(cursor.from, cursor.to);
        this.editor.scrollTo(info.left, info.top);
        if (host.Platform.isDesktop) focus = true;
      } else {
        focus = !!state.focus && (!host.Platform.isMobile || !!state.focusOnMobile);
      }
      if (state.focusMetadata) {
        const metadata = this.view.metadataEditor;
        if (this.view.canShowProperties() && metadata && metadata.properties && metadata.properties.length > 0) {
          metadata.focus();
          focus = false;
        } else {
          focus = true;
        }
      }
      if (Object.prototype.hasOwnProperty.call(state, "scroll")) this.applyScroll(state.scroll);
      if (focus) this.focus();
    },

    // ------------------------------------------------------- highlights

    setHighlight(state) {
      if (!state) return;
      const doc = this.cm.state.doc;
      if (state.startLoc != null && state.endLoc !== undefined) {
        const start = { line: state.startLoc.line, ch: state.startLoc.col };
        const end = state.endLoc
          ? { line: state.endLoc.line, ch: state.endLoc.col }
          : { line: doc.lines - 1, ch: doc.line(doc.lines).length };
        this.editor.addHighlights([{ from: start, to: end }], "is-flashing", true, true);
        this.isScrolling = true;
        this.onScroll();
        return;
      }
      if (state.line !== undefined && state.line >= 0) {
        const line = doc.line(Math.min(state.line + 1, doc.lines));
        const from = { line: state.line, ch: 0 };
        const to = { line: state.line, ch: line.text.length };
        this.editor.setSelection(to);
        this.editor.addHighlights([{ from, to }], "is-flashing", true, true);
        this.isScrolling = true;
        this.onScroll();
        return;
      }
      const propertyMatches = state.propertyMatches;
      if (propertyMatches !== undefined) {
        if (!propertyMatches || propertyMatches.length === 0) return;
        if (this.app.vault.getConfig("propertiesInDocument") === "hidden" || this.view.canShowProperties()) {
          host.propertiesPlugin(this.app).then((plugin) => {
            host.focusWhenShown(plugin.containerEl, () => plugin.focusProperty(propertyMatches[0].key));
          });
        } else {
          this.editor.setSelection({ line: 0, ch: 0 });
          this.isScrolling = true;
          this.onScroll();
        }
        return;
      }
      const match = state.match;
      if (match && match.content && match.matches) {
        const ranges = [];
        for (const pair of match.matches) {
          ranges.push({ from: ng27TextPos(match.content, pair[0]), to: ng27TextPos(match.content, pair[1]) });
        }
        if (ranges.length) {
          this.editor.addHighlights(ranges, "is-flashing", true, true);
          this.isScrolling = true;
          this.onScroll();
        }
      }
    },

    highlightSearchMatches(ranges, scroll, moveCursor, flash) {
      if (scroll === undefined) scroll = true;
      if (moveCursor === undefined) moveCursor = true;
      if (flash === undefined) flash = true;
      if (!ranges || ranges.length === 0) {
        this.editor.removeHighlights("is-flashing");
        return;
      }
      this.editor.addHighlights(ranges, "is-flashing", flash, true);
      const first = ranges[0];
      if (moveCursor) this.editor.setSelection(first.from);
      if (scroll) this.editor.scrollIntoView({ from: first.to, to: first.from }, true);
    },
  });

  methods(MarkdownEditMode, {

    // ------------------------------------------------------------- folds

    getFoldInfo() {
      const info = host.EditModeBase.prototype.getFoldInfo.call(this);
      const view = this.view;
      const metadata = view.metadataEditor;
      if (view.canShowProperties() && metadata && metadata.properties && metadata.properties.length > 0) {
        info.folds = (info.folds || []).filter((fold) => fold.from !== 0);
        if (metadata.collapsed) info.folds.unshift({ from: 0, to: 0 });
      }
      return info;
    },

    getDynamicExtensions() {
      const extensions = host.EditModeBase.prototype.getDynamicExtensions.call(this);
      if (!this.sourceMode) {
        if (!this.propertiesExtension) {
          this.propertiesExtension = host.propertiesExtensionFactory(this, this.view);
        }
        extensions.push(this.propertiesExtension);
      }
      return extensions;
    },

    onUpdate(update, isUserEvent) {
      host.EditModeBase.prototype.onUpdate.call(this, update, isUserEvent);
      if (isUserEvent) {
        this.view.requestSave();
        this.requestSaveFolds();
        this.requestOnInternalDataChange();
      }
      const transactions = update.transactions || [];
      let foldChanged = false;
      for (const tr of transactions) {
        if (tr.effects && tr.effects.some((e) => e.is(host.cmFoldEffect) || e.is(host.cmUnfoldEffect))) {
          foldChanged = true;
          break;
        }
      }
      if (foldChanged) this.requestSaveFolds();
    },

    onResize() {
      host.EditModeBase.prototype.onResize.call(this);
      if (this.containerEl.offsetParent) this.updateBottomPadding(this.containerEl.clientHeight);
    },

    updateBottomPadding(height) {
      const view = this.view;
      const contentDOM = this.cm.contentDOM;
      const doc = contentDOM.ownerDocument;
      let padding;
      if (host.Platform.isMobile) {
        let extra = ng27CssPx(doc.documentElement, "--keyboard-height", doc);
        if (this.app.mobileToolbar && this.app.mobileToolbar.isVisible) {
          extra += ng27CssPx(doc.body, "--mobile-toolbar-height", doc);
        }
        padding = Math.round((height + extra) / 2) + "px";
      } else {
        padding = Math.round(height / 2) + "px";
      }
      if (view.backlinksEl && view.backlinksEl.isShown()) {
        padding = "100px";
        view.backlinksEl.style.minHeight = Math.max(0, height / 2 - 100) + "px";
      }
      contentDOM.style.paddingBottom = padding;
    },

    updateReadableLineLength() {
      this.editorEl.toggleClass("is-readable-line-width", !!this.app.vault.getConfig("readableLineLength"));
    },

    onConfigChanged(configKey) {
      host.EditModeBase.prototype.onConfigChanged.call(this, configKey);
      if (configKey === "readableLineLength") this.updateReadableLineLength();
    },

    // ------------------------------------------------------- viewport menu

    onViewportMenu(event) {
      if (event.defaultPrevented || !event.isTrusted) return;
      if (typeof PointerEvent !== "undefined" && event instanceof PointerEvent && event.pointerType === "touch") return;
      const target = event.targetNode || event.target;
      if (!this.sizerEl.contains(target)) return;
      const parent = target.parentElement;
      if (parent && parent.classList && parent.classList.contains("cm-gutters")) return;
      const menu = host.Menu.forEvent(event).addSections(["view", ""]);
      this.app.workspace.trigger("markdown-viewport-menu", menu, this.view, "source", "gutter");
    },
  });

  return MarkdownEditMode;
}
