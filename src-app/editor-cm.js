// The CodeMirror-backed editor component: owns the EditorView, builds the extension set (local once,
// dynamic per config/live-preview state), keeps undo history per file, restores it on set(), and routes
// pointer/keyboard interaction (clickable tokens, link hover popover, context menu, drag/drop, paste).
//
// Vendor CodeMirror 6 stays inherited; everything here is application glue written from observed behaviour.
import { inherit, methods } from "./inherit.js";

export function defineCodeMirrorEditor(host) {
  const {
    Component, CMEditorView, CMEditorComponent, ClipboardManager, PreviewLinkHandlers,
    MarkdownPreviewRenderer, Platform, iosTap, iosEditorExtensions,
    cmCompartment, cmBaseExtension, cmHistoryStore, cmHistoryField, cmState,
    cmPosToOffset, cmOffsetToPos, cmRefreshEffect, cmIndentUnit, cmEditorField, cmOwnerField,
    livePreviewField, fieldSetEffect, notSetUserEvent, inputEditUserEvent,
    cmFoldedRanges, cmFoldableRange, cmFoldCheck, cmFoldEffect, cmUnfoldEffect,
    cmKeymapFacet, cmFormatQuery, Menu, Notice, Keymap, MarkdownView, TableCellEditor,
    electronMenuInfo, formattingMenu, pointerEntered, treeToHtml, markdownTree,
    shiftPos, truncateText, isUrl, isPlainUrl, setUriList, clipboardFiles, htmlCommentPrefix,
    bracketOpenInput, bracketField, bracketKeys, closeBracketInput,
    vimTheme, vimPrecedence, vimKeymapClass, vimThemeAlt, vimStatusField,
    livePreviewPluginFactory, cmdUnfoldAll,
    debounce, t,
  } = host;

  function CodeMirrorEditor(app, containerEl, owner) {
    const self = Component.call(this) || this;
    self.cleanupLivePreview = null;
    self.sourceMode = true;
    self.cmInit = false;
    self.cursorPopupEl = null;
    self.tableCell = null;
    self.app = app;
    self.owner = owner;
    self.containerEl = containerEl;
    self.editorSuggest = app.workspace.editorSuggest;
    self.sourceMode = !app.vault.getConfig("livePreview");
    const editorEl = self.editorEl = containerEl.createDiv("markdown-source-view cm-s-basalt mod-cm6");
    const cm = self.cm = new CMEditorView({ parent: editorEl });
    self.editor = new CMEditorComponent(self);
    self.clipboardManager = new ClipboardManager(owner);
    MarkdownPreviewRenderer.registerDomEvents(cm.contentDOM, new PreviewLinkHandlers(owner));
    editorEl.addEventListener("click", self.onEditorClick.bind(self));
    editorEl.addEventListener("mousedown", self.onEditorClick.bind(self), { capture: true });
    if (Platform.isIosApp) iosTap(editorEl, self.onEditorClick.bind(self));
    editorEl.addEventListener("contextmenu", self.onContextMenu.bind(self));
    editorEl.on("mouseover", ".cm-link, .cm-hmd-internal-link, .cm-footref", self.onEditorLinkMouseover.bind(self));
    editorEl.addEventListener("dragstart", self.onEditorDragStart.bind(self));
    editorEl.onNodeInserted(() => self.reinit());
    setTimeout(() => self.onResize(), 0);
    return self;
  }
  inherit(CodeMirrorEditor, Component);

  Object.defineProperty(CodeMirrorEditor.prototype, "file", {
    get() { return this.owner.file; },
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(CodeMirrorEditor.prototype, "path", {
    get() { return this.file?.path || ""; },
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(CodeMirrorEditor.prototype, "activeCM", {
    get() { return this.tableCell ? this.tableCell.cm : this.cm; },
    enumerable: false,
    configurable: true,
  });

  methods(CodeMirrorEditor, {
    onload() {
      this.registerEvent(this.app.vault.on("config-changed", this.onConfigChanged, this));
    },

    get() {
      return this.cm.state.doc.toString();
    },

    set(text, force) {
      const cm = this.cm;
      if (force || !this.cmInit) {
        if (this.cleanupLivePreview) {
          this.cleanupLivePreview();
          this.cleanupLivePreview = null;
        }
        this.livePreviewPlugin = null;
        this.editorSuggest.close();
        const extensions = [
          this.getLocalExtensions(),
          cmCompartment.of(this.getDynamicExtensions()),
          cmBaseExtension,
        ];
        try {
          const path = this.path;
          if (path) {
            const entry = cmHistoryStore.find((item) => item.file === path);
            if (entry && entry.length === text.length) {
              const history = cmHistoryField.spec.fromJSON(entry.data);
              extensions.push(cmHistoryField.init(() => history));
            }
          }
        } catch (error) {
          console.error(error);
        }
        const state = cmState.create({ doc: text, extensions });
        cm.setState(state);
        cm.dispatch({ effects: [CMEditorView.scrollIntoView(0), cmRefreshEffect.of()] });
        cm.scrollDOM.scrollTop = 0;
        cm.dispatch({ effects: [cmRefreshEffect.of()] });
        this.cmInit = true;
        return;
      }
      // Minimal update: keep the unchanged head/tail, replace only the differing middle.
      const doc = cm.state.doc;
      const lines = text.split(/\r?\n/g);
      const oldLines = doc.lines;
      let head = 0;
      while (head < lines.length && head < oldLines && lines[head] === doc.line(head + 1).text) head++;
      if (head === lines.length && head === oldLines) return;
      let tailOld = oldLines - 1;
      let tailNew = lines.length - 1;
      while (tailOld > head && tailNew > head && doc.line(tailOld + 1).text === lines[tailNew]) {
        tailOld--;
        tailNew--;
      }
      let from = { line: head, ch: 0 };
      let to = { line: tailOld, ch: doc.line(tailOld + 1).length };
      let insert = lines.slice(head, tailNew + 1).join("\n");
      if (head === tailOld && head === tailNew && head < oldLines && head < lines.length) {
        const oldLine = doc.line(head + 1).text;
        const newLine = lines[head];
        let prefix = 0;
        while (prefix < oldLine.length && prefix < newLine.length && oldLine.charAt(prefix) === newLine.charAt(prefix)) prefix++;
        let suffix = 0;
        while (
          suffix < oldLine.length - prefix &&
          suffix < newLine.length - prefix &&
          oldLine.charAt(oldLine.length - 1 - suffix) === newLine.charAt(newLine.length - 1 - suffix)
        ) suffix++;
        if (prefix > 0 || suffix > 0) {
          from.ch = prefix;
          to.ch -= suffix;
          insert = insert.slice(prefix, insert.length - suffix);
        }
      }
      if (head === Math.min(oldLines, lines.length)) {
        from = { line: head - 1, ch: doc.line(head).length };
        if (lines.length > oldLines) insert = "\n" + insert;
      }
      cm.dispatch({
        changes: { from: cmPosToOffset(doc, from), to: cmPosToOffset(doc, to), insert },
        userEvent: "set",
      });
    },

    saveHistory() {
      const path = this.path;
      if (!path) return;
      try {
        const state = this.cm.state;
        const history = state.field(cmHistoryField);
        if (!history) return;
        const data = cmHistoryField.spec.toJSON(history, state);
        const hasChanges = (stack) => {
          if (stack && Array.isArray(stack)) {
            for (const item of stack) {
              if (item.changes && item.changes.length) return true;
            }
          }
          return false;
        };
        if (!hasChanges(data.done) && !hasChanges(data.undone)) return;
        const store = cmHistoryStore;
        for (let i = store.length - 1; i >= 0; i--) {
          if (store[i].file === path) store.splice(i, 1);
        }
        store.push({ ts: Date.now(), file: path, data, length: state.doc.length });
        if (store.length > 20) store.shift();
      } catch (error) {
        console.error(error);
      }
    },

    reinit() {
      this.cm.setRoot(this.editorEl.doc);
      this.onResize();
    },

    reparent(containerEl) {
      this.containerEl = containerEl;
      containerEl.appendChild(this.editorEl);
      this.reinit();
    },

    clear() {
      if (this.cleanupLivePreview) {
        this.cleanupLivePreview();
        this.cleanupLivePreview = null;
      }
      this.livePreviewPlugin = null;
      const livePreview = !this.sourceMode;
      const state = cmState.create({
        extensions: [
          this.getLocalExtensions(),
          cmCompartment.of(this.getDynamicExtensions()),
          cmBaseExtension,
          livePreviewField.init(() => livePreview),
        ],
      });
      this.cm.setState(state);
      this.cmInit = true;
    },

    destroy() {
      this.localExtensions = null;
      if (this.cleanupLivePreview) {
        this.cleanupLivePreview();
        this.cleanupLivePreview = null;
      }
      this.livePreviewPlugin = null;
      this.cm.setState(cmState.create({}));
      this.cm.destroy();
      this.editorSuggest.close();
      if (this.scope) this.app.keymap.popScope(this.scope);
      if (Platform.isMobile) this.app.mobileToolbar.update();
      this.destroyTableCell();
    },

    /** Builds the transaction listener returned to the view; `docChanged` style updates go to onUpdate. */
    updateEvent() {
      let triggerSuggest = false;
      const suggest = debounce(() => {
        this.editorSuggest.trigger(this.editor, this.file, triggerSuggest);
        triggerSuggest = false;
      }, 50);
      const expand = debounce(() => this.editor.expandText(), 10);
      const linkPopup = debounce(this.updateLinkPopup.bind(this), 300);
      return (update) => {
        const transactions = update.transactions;
        const docChanged = update.docChanged && transactions.some(notSetUserEvent);
        if (docChanged) {
          expand();
          if (transactions.some(inputEditUserEvent)) triggerSuggest = true;
        }
        if (update.focusChanged || update.docChanged || update.selectionSet) {
          suggest();
          linkPopup();
        }
        this.onUpdate(update, docChanged);
      };
    },

    buildLocalExtensions() {
      const self = this;
      const extensions = [];
      extensions.push(cmEditorField.init(() => self.cm));
      extensions.push(cmOwnerField.init(() => self.owner));
      extensions.push(CMEditorView.updateListener.of(this.updateEvent()));
      const suggestShowing = () => self.editorSuggest.isShowingSuggestion();
      extensions.push(cmKeymapFacet.of([
        { key: "ArrowUp", run: suggestShowing, preventDefault: true },
        { key: "ArrowDown", run: suggestShowing, preventDefault: true },
        { key: "Enter", run: suggestShowing, preventDefault: true },
        { key: "Tab", run: suggestShowing, preventDefault: true },
        { key: "Escape", run: () => (self.editor.removeHighlights(), false), preventDefault: true },
      ]));
      if (Platform.isMobileApp && Platform.isIosApp) extensions.push(...iosEditorExtensions);
      extensions.push(
        CMEditorView.clipboardCopyHook.of((view, event, slice) => {
          const text = slice.text;
          event.setData("text/markdown", text);
          if (text.length <= 1e6) event.setData("text/html", htmlCommentPrefix + treeToHtml(markdownTree(text)));
        }),
        CMEditorView.clipboardPasteHook.of((view, event, defaultInsert) => {
          const handled = self.clipboardManager.handleDataTransfer(event);
          const insert = handled || defaultInsert;
          if (insert && self.tryPasteUrl(view, insert)) return true;
          if (handled) {
            self.editor.replaceSelection(handled, "input.paste");
            return true;
          }
          const files = clipboardFiles(event, "clipboard", true);
          if (files.length > 0) {
            self.clipboardManager.insertFiles(files);
            return true;
          }
          return false;
        }),
      );
      extensions.push(CMEditorView.domEventHandlers({
        dragstart: (event) => event.dataTransfer.clearData("text/html"),
        dragover: (event) => self.clipboardManager.handleDragOver(event),
        drop: (event) => self.clipboardManager.handleDrop(event),
        paste: (event) => self.clipboardManager.handlePaste(event),
        focus: () => {
          self.app.workspace.activeEditor = self.owner;
          if (Platform.isMobile) self.app.mobileToolbar.update();
          self.destroyTableCell();
        },
        blur: () => {
          if (Platform.isMobile) self.app.mobileToolbar.update();
          if (self.owner instanceof MarkdownView) self.owner.saveImmediately();
          self.editorSuggest.close();
        },
      }));
      return extensions;
    },

    /** When every selection range is replaced by a plain URL on one line, paste the URL itself instead of markdown. */
    tryPasteUrl(view, text) {
      const state = view.state;
      const doc = state.doc;
      const selection = state.selection;
      if (!selection.ranges.some((range) => !range.empty)) return false;
      if (!selection.ranges.every((range) => range.empty || doc.lineAt(range.from).number === doc.lineAt(range.to).number)) return false;
      let inserts;
      if (!text.includes("\n") && isPlainUrl(text)) {
        inserts = selection.ranges.map(() => text);
      } else {
        const lines = text.split("\n");
        if (lines.length !== selection.ranges.length || !lines.every((line) => isPlainUrl(line))) return false;
        inserts = lines;
      }
      const changes = selection.ranges.map((range, index) => ({
        from: range.from,
        to: range.to,
        insert: range.empty ? inserts[index] : `[${doc.sliceString(range.from, range.to)}](${inserts[index]})`,
      }));
      view.dispatch({ changes, userEvent: "input.paste" });
      return true;
    },

    getLocalExtensions() {
      let extensions = this.localExtensions;
      if (!extensions) extensions = this.localExtensions = this.buildLocalExtensions();
      return extensions;
    },

    getDynamicExtensions() {
      const extensions = [];
      const vault = this.app.vault;
      extensions.push(cmState.tabSize.of(vault.getConfig("tabSize")));
      extensions.push(cmIndentUnit.of(vault.getConfig("useTab") ? "\t" : "    "));
      const rtl = vault.getConfig("rightToLeft") || this.editorEl.doc.body.hasClass("mod-rtl");
      this.editorEl.toggleClass("is-rtl", rtl);
      this.editorEl.setAttr("dir", rtl ? "rtl" : null);
      if (rtl) extensions.push(CMEditorView.theme({ "&": { direction: "rtl" } }));
      const spellcheck = vault.getConfig("spellcheck");
      extensions.push(CMEditorView.contentAttributes.of({
        spellcheck: String(spellcheck),
        autocorrect: "on",
        autocapitalize: "on",
        contenteditable: "true",
      }));
      const livePreview = !this.sourceMode;
      this.editorEl.toggleClass("is-live-preview", livePreview);
      extensions.push(livePreviewField.init(() => livePreview));
      if (livePreview) {
        let plugin = this.livePreviewPlugin;
        if (!plugin) plugin = this.livePreviewPlugin = livePreviewPluginFactory(this, this.cm);
        extensions.push(plugin);
      }
      const autoPairBrackets = vault.getConfig("autoPairBrackets");
      const autoPairMarkdown = vault.getConfig("autoPairMarkdown");
      if (autoPairBrackets || autoPairMarkdown) {
        const brackets = [];
        if (autoPairBrackets) brackets.push("(", "[", "{", "'", '"');
        if (autoPairMarkdown) brackets.push("*", "_", "`", "```");
        const closeBrackets = { brackets };
        extensions.push(bracketOpenInput, bracketField);
        extensions.push(cmKeymapFacet.of(bracketKeys));
        extensions.push(cmState.languageData.of(() => [{ closeBrackets }]));
        extensions.push(closeBracketInput);
      }
      if (this.app.isVimEnabled()) {
        extensions.push(vimTheme, vimPrecedence.highest(vimKeymapClass), vimThemeAlt, vimStatusField);
      }
      extensions.push(...this.app.workspace.editorExtensions);
      return extensions;
    },

    onConfigChanged(configKey) {
      if (
        configKey === "useTab" || configKey === "tabSize" || configKey === "rightToLeft" ||
        configKey === "spellcheck" || configKey === "autoPairBrackets" || configKey === "autoPairMarkdown" ||
        configKey === "smartIndentList" || configKey === "vimMode"
      ) {
        this.updateOptions();
      }
    },

    updateOptions() {
      if (!this.cmInit) return;
      this.cm.dispatch({
        effects: [
          cmCompartment.reconfigure(this.getDynamicExtensions()),
          fieldSetEffect.of({ field: livePreviewField, value: !this.sourceMode }),
        ],
      });
    },

    resetSyntaxHighlighting() {
      const cm = this.cm;
      if (cm.state.doc.length > 0) {
        cm.dispatch({
          changes: [{ from: 0, to: 1, insert: cm.state.doc.sliceString(0, 1) }],
          userEvent: "set",
        });
      }
    },

    getFoldInfo() {
      const cm = this.cm;
      const doc = cm.state.doc;
      const folds = [];
      for (let iter = cmFoldedRanges(cm.state).iter(); iter.value;) {
        const from = cmOffsetToPos(doc, iter.from);
        const to = cmOffsetToPos(doc, iter.to);
        folds.push({ from: from.line, to: to.line });
        iter.next();
      }
      return { folds, lines: doc.lines };
    },

    applyFoldInfo(info) {
      const cm = this.cm;
      if (!info || cm.state.doc.lines === info.lines) {
        cmdUnfoldAll(cm);
        const effects = [];
        if (info) {
          const doc = cm.state.doc;
          for (const fold of info.folds) {
            const start = doc.line(fold.from + 1);
            const end = doc.line(Math.min(fold.to + 1, doc.lines));
            const range = cmFoldableRange(cm.state, start.from, start.to);
            if (range) effects.push(cmFoldEffect.of({ from: range.from, to: Math.max(range.to, end.to) }));
          }
        }
        if (effects.length !== 0) cm.dispatch({ effects });
      }
    },

    toggleFoldFrontmatter() {
      if (this.cm.state.doc.lineAt(0).text !== "---") return;
      const range = cmFoldableRange(this.cm.state, 0, 0);
      if (range) {
        const folded = cmFoldCheck(cmFoldedRanges(this.cm.state), 0, 0) ? cmUnfoldEffect : cmFoldEffect;
        this.cm.dispatch({ effects: folded.of(range) });
      }
    },

    getClickableTokenHref(token) {
      if (token.type === "external-link") return token.text;
      if (token.type === "external-ref-link") {
        if (!this.file) return null;
        const cache = this.app.metadataCache.getFileCache(this.file);
        const ref = cache?.referenceLinks?.find((item) => item.id === token.text);
        return ref && isUrl(ref.link) ? ref.link : null;
      }
      return null;
    },

    triggerClickableToken(token, newTab) {
      if (token.type === "internal-link") {
        setTimeout(() => this.app.workspace.openLinkText(token.text, this.path, newTab), 100);
      } else if (token.type === "external-link" || token.type === "external-ref-link") {
        const href = this.getClickableTokenHref(token);
        if (!href) return;
        if (isUrl(href)) {
          if (newTab === true) window.open(href, "tab");
          else if (newTab === false) window.open(href);
          else window.open(href, newTab);
        } else {
          new Notice(t.interface.msgFailedToOpenHref({ href }));
        }
      } else if (token.type === "tag") {
        let tag = token.text;
        if (!tag.startsWith("#")) tag = "#" + tag;
        const search = this.app.internalPlugins.getEnabledPluginById("global-search");
        if (search) search.openGlobalSearch("tag:" + tag);
      }
    },

    /** Mobile-only "tap link" bubble above the cursor when it sits on a clickable token. */
    updateLinkPopup() {
      if (!Platform.isMobile || !this.sourceMode) return;
      const cm = this.cm;
      const editor = this.editor;
      let popup = this.cursorPopupEl;
      if (popup) {
        popup.detach();
        this.cursorPopupEl = null;
      }
      if (!cm.hasFocus) return;
      const pos = editor.getCursor("from");
      const token = editor.getClickableTokenAt(pos);
      if (!token || token.type === "footref") return;
      const scrollDOM = cm.scrollDOM;
      popup = this.cursorPopupEl = scrollDOM.createDiv();
      const bubble = popup.createDiv("follow-link-popover tappable");
      if (token.type === "internal-link") bubble.setText(t.editor.linkPopover.tooltipFollowLink());
      else if (token.type === "external-link" || token.type === "external-ref-link") bubble.setText(t.editor.linkPopover.tooltipOpenLink());
      else if (token.type === "tag") bubble.setText(t.editor.linkPopover.tooltipSearchTag());
      bubble.createDiv("popover-arrow");
      bubble.style.position = "absolute";
      bubble.style.cursor = "pointer";
      bubble.style.zIndex = "var(--layer-popover)";
      bubble.style.top = "0";
      bubble.style.left = "0";
      const start = editor.coordsAtPos(token.start, true);
      const end = editor.coordsAtPos(token.end, true);
      if (!start || !end) {
        bubble.detach();
        return;
      }
      const width = bubble.offsetWidth;
      const parentWidth = bubble.offsetParent ? bubble.offsetParent.clientWidth : scrollDOM.clientWidth;
      const top = start.top - bubble.offsetHeight - 8;
      let left = (start.left + end.left) / 2 - width / 2;
      if (end.top >= start.bottom) left = start.left - width / 2;
      bubble.style.top = top + "px";
      bubble.style.left = Math.clamp(left, 0, parentWidth - width) + "px";
      bubble.addEventListener("mousedown", (event) => event.preventDefault());
      bubble.onClickEvent((event) => {
        bubble.detach();
        this.triggerClickableToken(token, event.shiftKey || event.button === 1);
        event.preventDefault();
      });
      if (token.type === "internal-link") {
        bubble.addEventListener("mouseover", (event) => {
          if (pointerEntered(event, bubble)) {
            this.app.workspace.trigger("hover-link", {
              event,
              source: "editor",
              hoverParent: this.owner,
              targetEl: bubble,
              linktext: token.text,
              sourcePath: this.path,
            });
          }
        });
      }
    },

    toggleSource() {
      this.sourceMode = !this.sourceMode;
      this.updateOptions();
      this.cm.dispatch({ effects: [cmRefreshEffect.of()] });
    },

    /** Hook for subclasses (live preview, source mode) to react to transactions. */
    onUpdate(update, docChanged) {},

    onEditorClick(event, forwarded) {
      const isMobile = Platform.isMobileApp;
      const handled = isMobile
        ? (Platform.isAndroidApp && event.type === "mousedown") ||
          (event.type === "click" && !event.isTrusted && !!forwarded) ||
          (Platform.isIosApp && event.type === "click" && event.isTrusted)
        : (event.type === "click" && event.button === 0) || (event.type === "mousedown" && event.button === 1);
      if (!handled) return;
      const mod = Keymap.isModifier(event, "Mod") || event.button === 1;
      if ((!this.sourceMode || mod) && (this.sourceMode || event.button !== 0 || mod || (!event.altKey && !event.shiftKey))) {
        const target = forwarded || event.target;
        const contentDOM = this.cm.contentDOM;
        if (!contentDOM.contains(target)) return;
        if (!this.sourceMode && event.type === "click") {
          const selection = event.win.getSelection();
          if (selection && !selection.isCollapsed && (target.contains(selection.anchorNode) || target.contains(selection.focusNode))) return;
        }
        if (target === contentDOM || target.parentNode === contentDOM) return;
        for (let node = target; node && node !== contentDOM; node = node.parentNode) {
          if (node.instanceOf(HTMLElement) && node.contentEditable === "false" && !node.hasClass("external-link") && !node.draggable) return;
        }
        const token = this.editor.getClickableTokenAt(this.editor.posAtMouse(event));
        if (token) {
          let openInNewTab = Keymap.isModEvent(event);
          const allow = (() => {
            if (this.sourceMode) return true;
            if (openInNewTab) return true;
            if (!(target instanceof HTMLElement)) return false;
            if (token.type === "tag") return true;
            if (token.type === "internal-link") {
              if (!target.matchParent(".cm-underline")) return false;
              if (target.matchParent(".cm-hmd-internal-link")) return true;
              if (target.matchParent(".cm-link")) return true;
            }
            if (token.type === "external-link" || token.type === "external-ref-link") {
              if (target.matchParent(".external-link")) return true;
              if (!target.matchParent(".cm-underline")) return false;
              if (target.matchParent(".cm-url")) return true;
              if (target.matchParent(".cm-link")) return true;
            }
            return false;
          })();
          if (allow) {
            if (this.sourceMode && openInNewTab === "tab" && event.button !== 1 && !Keymap.isModifier(event, "Shift")) openInNewTab = false;
            this.triggerClickableToken(token, openInNewTab);
            event.preventDefault();
          }
        }
      }
    },

    onEditorLinkMouseover(event, target) {
      if (!pointerEntered(event, target)) return;
      const token = this.editor.getClickableTokenAt(this.editor.posAtMouse(event));
      const isFootnote = token?.type === "footref";
      if (token?.type === "internal-link" || isFootnote) {
        this.app.workspace.trigger("hover-link", {
          event,
          source: "editor",
          hoverParent: this.owner,
          targetEl: target,
          linktext: isFootnote ? "#[^" + token.text + "]" : token.text,
          sourcePath: this.path,
        });
      }
    },

    onEditorDragStart(event) {
      const target = event.targetNode;
      if (!(target instanceof HTMLElement) || !target.draggable) return;
      const contentDOM = this.cm.contentDOM;
      if (!contentDOM.contains(target)) return;
      if (target === contentDOM || target.parentNode === contentDOM) return;
      const token = this.editor.getClickableTokenAt(this.editor.posAtMouse(event));
      if (!token) return;
      if (token.type === "internal-link") {
        this.app.dragManager.onDragStart(event, this.app.dragManager.dragLink(event, token.text, this.path, token.displayText));
      } else if (token.type === "external-link" || token.type === "external-ref-link") {
        const href = this.getClickableTokenHref(token);
        if (href) setUriList(event.dataTransfer, href);
      }
    },

    async onContextMenu(event, isTouchMenu = false) {
      if (event.defaultPrevented) return;
      if (Platform.isMobile) {
        if (event instanceof PointerEvent && event.pointerType === "mouse" && event.button === -1) return;
        if (!isTouchMenu && Platform.mobileSoftKeyboardVisible && (!event.isTrusted || event instanceof TouchEvent)) return;
      }
      const app = this.app;
      const editor = this.editor;
      const pos = editor.posAtMouse(event);
      if (!pos || (event.target && !editor.cm.contentDOM.contains(event.target))) return;
      const menu = new Menu();
      menu.addSections([
        "title", "correction", "spellcheck", "open", "selection-link", "selection",
        "selection.format", "selection.paragraph", "selection.paragraph.list",
        "selection.paragraph.heading", "selection.paragraph.block",
        "selection.insert.basic", "selection.insert.advanced", "insert",
        "clipboard", "info", "info.copy", "action", "view", "", "danger",
      ]);
      let canCut = true;
      let canCopy = true;
      let canPaste = true;
      const isDesktop = Platform.isDesktopApp && event.win.electron;
      let hasCustomSpellcheck = false;
      if (isDesktop && event.isTrusted) {
        const info = await electronMenuInfo(event);
        if (!info || event.defaultPrevented) return;
        const contents = isDesktop.remote.webContents.fromId(info.webContentsId);
        const flags = info.editFlags || {};
        canCut = flags.canCut;
        canCopy = flags.canCopy;
        canPaste = flags.canPaste;
        if (contents && info.misspelledWord) {
          const suggestions = info.dictionarySuggestions || [];
          if (suggestions.length === 0) {
            menu.addItem((item) => item.setSection("correction").setDisabled(true).setTitle(t.editor.spellcheck.noSuggestion()));
          } else {
            const shown = suggestions.length > 6 ? suggestions.slice(0, 6) : suggestions;
            for (const suggestion of shown) {
              menu.addItem((item) => item
                .setSection("correction")
                .setTitle(suggestion)
                .setIcon("lucide-repeat")
                .onClick(() => {
                  menu.hide();
                  contents.replaceMisspelling(suggestion);
                }));
            }
            menu.addItem((item) => item
              .setSection("spellcheck")
              .setTitle(t.editor.spellcheck.addToDictionary())
              .setIcon("lucide-folder-tree")
              .onClick(() => {
                contents.session.addWordToSpellCheckerDictionary(info.misspelledWord);
                contents.replaceMisspelling(info.misspelledWord);
              }));
          }
        }
      } else {
        hasCustomSpellcheck = true;
      }
      let token = editor.getClickableTokenAt(pos);
      const onLine = (evt) => {
        const target = evt.targetNode;
        return !!target && target instanceof Element && target.hasClass("cm-line");
      };
      if (!isTouchMenu && onLine(event)) {
        hasCustomSpellcheck = true;
        token = null;
      }
      if (token) {
        if (token.type === "internal-link" || token.type === "external-link") {
          menu.addItem((item) => item
            .setSection("selection")
            .setTitle(t.editor.menu.editLink())
            .setIcon("lucide-text-cursor-input")
            .onClick(() => {
              editor.focus();
              editor.setSelection(token.start, token.end);
            }));
        }
        if (token.type === "internal-link") {
          app.workspace.handleLinkContextMenu(menu, token.text, this.path);
        } else if (token.type === "external-link" || token.type === "external-ref-link") {
          const href = this.getClickableTokenHref(token);
          if (href) app.workspace.handleExternalLinkContextMenu(menu, href);
        } else if (token.type === "tag") {
          menu.addItem((item) => item
            .setSection("selection")
            .setTitle(t.editor.menu.editTag())
            .setIcon("lucide-text-cursor-input")
            .onClick(() => {
              editor.focus();
              editor.setSelection(shiftPos(token.start, 1), token.end);
            }));
        } else if (token.type === "footref" && this.file) {
          const cache = app.metadataCache.getFileCache(this.file);
          const note = cache?.footnotes?.find((item) => item.id === token.text);
          if (note) {
            menu.addItem((item) => item
              .setSection("action")
              .setTitle(t.editor.menu.labelDeleteFootrefAndNote())
              .setIcon("lucide-file-signature")
              .onClick(() => {
                this.cm.dispatch({
                  changes: [
                    { from: editor.posToOffset(token.start), to: editor.posToOffset(token.end), insert: "" },
                    { from: note.position.start.offset - 1, to: note.position.end.offset, insert: "" },
                  ],
                });
              }));
          }
        }
      } else if (Platform.isMobile && !isTouchMenu) {
        return;
      }
      const selection = editor.getSelection().trim();
      if (Platform.isDesktopApp && Platform.isMacOS && selection.length > 0) {
        menu.addItem((item) => item
          .setSection("title")
          .setTitle(t.interface.menu.lookupSelection({ selection: truncateText(selection, 25) }))
          .setIcon("lucide-library")
          .onClick(() => {
            isDesktop.remote.getCurrentWebContents().showDefinitionForSelection();
          }));
      }
      if (!Platform.isMobile) {
        menu.addItem((item) => item
          .setSection("clipboard")
          .setTitle(t.interface.menu.cut())
          .setIcon("lucide-scissors")
          .setDisabled(!canCut)
          .onClick(async () => {
            if (isDesktop && contents) {
              contents.cut();
              return;
            }
            const text = editor.getSelection();
            editor.replaceSelection("");
            await navigator.clipboard.writeText(text);
          }));
        menu.addItem((item) => item
          .setSection("clipboard")
          .setTitle(t.interface.menu.copy())
          .setIcon("lucide-copy")
          .setDisabled(!canCopy)
          .onClick(async () => {
            if (isDesktop && contents) {
              contents.copy();
              return;
            }
            const text = editor.getSelection();
            await navigator.clipboard.writeText(text);
          }));
        menu.addItem((item) => item
          .setSection("clipboard")
          .setTitle(t.interface.menu.paste())
          .setIcon("lucide-clipboard-check")
          .setDisabled(!canPaste)
          .onClick(async () => {
            if (isDesktop && contents) {
              contents.paste();
              return;
            }
            const text = await navigator.clipboard.readText();
            editor.replaceSelection(text);
          }));
        menu.addItem((item) => item
          .setSection("clipboard")
          .setTitle(t.interface.menu.pasteAsPlainText())
          .setIcon("lucide-clipboard-type")
          .setDisabled(!canPaste)
          .onClick(async () => {
            if (isDesktop && contents) {
              contents.pasteAndMatchStyle();
              return;
            }
            const text = await navigator.clipboard.readText();
            editor.replaceSelection(text);
          }));
        menu.addItem((item) => item
          .setSection("clipboard")
          .setTitle(t.interface.menu.selectAll())
          .setIcon("lucide-box-select")
          .onClick(() => {
            const last = editor.lineCount() - 1;
            editor.setSelection({ line: 0, ch: 0 }, { line: last, ch: editor.getLine(last).length });
          }));
      }
      menu.addItem((item) => item
        .setSection("selection-link")
        .setTitle(t.interface.formatting.insertLink())
        .setIcon("lucide-link")
        .setDisabled(/\n/.test(selection))
        .onClick(() => this.editor.triggerWikilink(false)));
      menu.addItem((item) => item
        .setSection("selection-link")
        .setTitle(t.interface.formatting.insertExternalLink())
        .setIcon("lucide-external-link")
        .setDisabled(/\n/.test(selection))
        .onClick(() => this.editor.insertMarkdownLink()));
      const formatInfo = cmFormatQuery(editor.cm.state, editor.cm.state.selection.main);
      if (!token) {
        formattingMenu(menu, editor, formatInfo, "selection.format");
        menu.setSectionSubmenu("selection.paragraph", {
          title: t.interface.formatting.labelParagraph(),
          disabled: editor.inTableCell,
          icon: "lucide-pilcrow",
        });
        menu.setSectionSubmenu("info.copy", { title: t.interface.menu.copyPath(), icon: "lucide-clipboard" });
        menu.addItem((item) => item
          .setSection("selection.paragraph.list")
          .setTitle(t.interface.formatting.toggleBulletList())
          .setIcon("lucide-list")
          .onClick(() => this.editor.toggleBulletList()));
        menu.addItem((item) => item
          .setSection("selection.paragraph.list")
          .setTitle(t.interface.formatting.toggleNumberedList())
          .setIcon("lucide-list-ordered")
          .onClick(() => this.editor.toggleNumberList()));
        menu.addItem((item) => item
          .setSection("selection.paragraph.list")
          .setTitle(t.interface.formatting.toggleChecklist())
          .setIcon("lucide-check-square")
          .onClick(() => this.editor.toggleCheckList()));
        const addHeading = (level) => menu.addItem((item) => item
          .setSection("selection.paragraph.heading")
          .setTitle(t.interface.formatting.setHeading({ level }))
          .setIcon("lucide-heading-" + level)
          .setChecked(formatInfo.uniformHeading && formatInfo.headingLevel === level)
          .onClick(() => this.editor.setHeading(level)));
        for (const level of [1, 2, 3, 4, 5, 6]) addHeading(level);
        menu.addItem((item) => item
          .setSection("selection.paragraph.heading")
          .setTitle(t.interface.formatting.noHeading())
          .setIcon("lucide-text")
          .setChecked(formatInfo.uniformHeading && formatInfo.headingLevel === 0)
          .onClick(() => this.editor.setHeading(0)));
        menu.addItem((item) => item
          .setSection("selection.paragraph.block")
          .setTitle(t.interface.formatting.toggleQuote())
          .setIcon("lucide-quote")
          .onClick(() => this.editor.toggleBlockquote()));
        menu.setSectionSubmenu("selection.insert", {
          title: t.interface.formatting.labelInsert(),
          disabled: editor.inTableCell,
          icon: "lucide-list-plus",
        });
        menu.addItem((item) => item
          .setSection("selection.insert.basic")
          .setTitle(t.interface.formatting.insertFootnote())
          .setIcon("lucide-file-signature")
          .onClick(() => this.editor.insertFootnote()));
        menu.addItem((item) => item
          .setSection("selection.insert.basic")
          .setTitle(t.interface.formatting.insertTable())
          .setIcon("lucide-table")
          .onClick(() => this.editor.insertTable()));
        menu.addItem((item) => item
          .setSection("selection.insert.basic")
          .setTitle(t.interface.formatting.insertCallout())
          .setIcon("lucide-quote")
          .onClick(() => this.editor.insertCallout()));
        menu.addItem((item) => item
          .setSection("selection.insert.basic")
          .setTitle(t.interface.formatting.insertHorizontalRule())
          .setIcon("lucide-minus")
          .onClick(() => this.editor.insertHorizontalRule()));
        menu.addItem((item) => item
          .setSection("selection.insert.advanced")
          .setTitle(t.interface.formatting.insertCodeBlock())
          .setIcon("lucide-code")
          .onClick(() => this.editor.insertCodeblock()));
        menu.addItem((item) => item
          .setSection("selection.insert.advanced")
          .setTitle(t.interface.formatting.insertMathBlock())
          .setIcon("lucide-sigma-square")
          .onClick(() => this.editor.insertMathBlock()));
      }
      if (!isTouchMenu && (Platform.isMobile && token)) return;
      app.workspace.trigger("editor-menu", menu, editor, this.owner);
      this.onMenu(menu);
      menu.showAtMouseEvent(event);
      if (hasCustomSpellcheck) event.preventDefault();
    },

    onMenu(menu) {},

    onResize() {
      const editor = this.editor;
      if (!this.containerEl.offsetParent) return;
      this.editorSuggest.reposition();
      if (Platform.isMobile && editor.hasFocus()) {
        editor.scrollIntoView({ from: editor.getCursor("anchor"), to: editor.getCursor("head") });
      }
      editor.refresh();
    },

    editTableCell(table, cell) {
      const current = this.tableCell;
      const cm = this.cm;
      if (table === current?.table && cell === current?.cell) return current;
      const wrapper = createDiv("table-cell-wrapper");
      const component = this.tableCell = this.addChild(new TableCellEditor(this, wrapper, table, cell));
      cm.observer.ignore(() => {
        cell.lockDimensions();
        cell.contentEl?.hide();
        cell.el.append(wrapper);
      });
      component.cm.focus();
      if (current) this.destroyTableCell(current);
      table.setActiveDragHandles(cell);
      table.containerEl.addClass("has-focus");
      return component;
    },

    destroyTableCell(component) {
      if (!component) {
        if (!this.tableCell) return;
        component = this.tableCell;
        this.tableCell = null;
      }
      const cm = this.cm;
      const cell = component.cell;
      const table = component.table;
      const wrapper = component.containerEl;
      table.unsetActiveDragHandles(cell);
      table.containerEl.removeClass("has-focus");
      cm.observer.ignore(() => {
        cell.lockDimensions();
        wrapper.detach();
        cell.contentEl.show();
      });
      table.rerenderCell(cell);
      this.removeChild(component);
    },
  });

  return CodeMirrorEditor;
}
