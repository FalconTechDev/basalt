// g27 edit-mode-base: EditModeBase (orig aZ) — base of the source edit modes.
// Owns the scrollDOM rearrangement (.cm-sizer > .cm-contentContainer >
// gutters + content), the fractional-line scroll protocol, the in-editor
// search bar scope bridging, mode keymaps and the dynamic extension set.
import { inherit, methods } from "./n-g27-inherit.js";

export function defineEditModeBase(host) {

  function EditModeBase(app, contentEl, owner) {
    const self = host.CodeMirrorEditor.call(this, app, contentEl, owner) || this;
    self.isScrolling = false;
    self.cssClasses = [];
    const cm = self.cm;
    const scrollDOM = cm.scrollDOM;
    const contentDOM = cm.contentDOM;
    contentDOM.detach();
    const sizerEl = self.sizerEl = scrollDOM.createDiv("cm-sizer");
    const containerEl = sizerEl.createDiv("cm-contentContainer");
    const gutters = scrollDOM.querySelector(".cm-gutters");
    if (gutters) containerEl.appendChild(gutters);
    containerEl.appendChild(contentDOM);
    scrollDOM.addEventListener("scroll", () => self.onScroll());
    self.scope = null;
    self.search = new host.EditorSearchBar(self.editor, self.editorEl, (scope) => {
      if (self.scope) app.keymap.popScope(self.scope);
      self.scope = scope || null;
      if (self.scope) app.keymap.pushScope(self.scope);
    });
    self.editorEl.addEventListener("click", (event) => self.onViewClick(event));
    return self;
  }
  inherit(EditModeBase, host.CodeMirrorEditor);

  methods(EditModeBase, {

    onScroll() {
      this.editorSuggest.reposition();
      if (this.isScrolling) {
        this.isScrolling = false;
        return;
      }
      this.handleScroll();
    },

    handleScroll() {
      this.owner.syncScroll();
    },

    show() {
      this.editorEl.show();
    },

    hide() {
      this.editorEl.hide();
      this.editorSuggest.close();
      this.search.hide();
    },

    focus() {
      const info = this.editor.getScrollInfo();
      this.editor.focus();
      this.editor.scrollTo(info.left, info.top);
      if (host.Platform.isMobileApp && host.keyboard) host.keyboard.show();
    },

    // ------------------------------------------- fractional-line scroll math

    getScroll() {
      const cm = this.cm;
      const doc = cm.state.doc;
      const contentTop = cm.contentDOM.offsetTop;
      const scrollTop = cm.scrollDOM.scrollTop;
      const block = cm.lineBlockAtHeight(Math.max(scrollTop - contentTop, 0));
      const start1 = doc.lineAt(block.from).number;
      const end1 = doc.lineAt(Math.max(block.from, block.to - 1)).number;
      const startLine = start1 - 1;
      const lineSpan = Math.max(1, end1 - start1 + 1);
      let offset = scrollTop - block.top;
      let height = block.height;
      if (startLine === 0) height += contentTop;
      else offset -= contentTop;
      return startLine + (lineSpan * Math.max(offset, 0)) / Math.max(1, height);
    },

    applyScroll(scroll) {
      if (typeof scroll !== "number" || isNaN(scroll)) return;
      const cm = this.cm;
      const doc = cm.state.doc;
      const clamped = scroll < 0 ? 0 : scroll >= doc.lines ? doc.lines - 0.99 : scroll;
      const line = Math.floor(clamped);
      const fraction = clamped - line;
      const docLine = doc.line(line + 1);
      const computeTop = () => {
        const block = cm.lineBlockAt(docLine.from);
        const start1 = doc.lineAt(block.from).number;
        const end1 = doc.lineAt(Math.max(block.from, block.to - 1)).number;
        const lineSpan = Math.max(1, end1 - start1 + 1);
        const inner = (line + 1) - start1;
        const contentTop = cm.contentDOM.offsetTop;
        let top = block.top;
        let height = block.height;
        if (start1 === 1) height += contentTop;
        else top += contentTop;
        return top + ((inner + fraction) * height) / lineSpan;
      };
      const inView = (cm.visibleRanges || []).some(
        (range) => docLine.from >= range.from && docLine.from <= range.to
      );
      this.isScrolling = true;
      if (inView) {
        cm.scrollDOM.scrollTop = computeTop();
        return;
      }
      cm.dispatch({
        effects: [host.CMEditorView.scrollIntoView(docLine.from, { y: "nearest" })],
      });
      cm.requestMeasure({
        read: () => null,
        write: () => {
          const top = computeTop();
          cm.requestMeasure({
            read: () => top,
            write: (value) => { cm.scrollDOM.scrollTop = value; },
          });
        },
      });
    },
  });

  methods(EditModeBase, {

    showSearch(reveal) {
      if (reveal === undefined) reveal = false;
      this.destroyTableCell();
      this.search.show(reveal);
    },

    // -------------------------------------------------------- extensions

    buildLocalExtensions() {
      const extensions = host.CodeMirrorEditor.prototype.buildLocalExtensions.call(this);
      const self = this;
      extensions.push(host.hypermdMode);
      extensions.push(host.cmLiveDecorations);
      extensions.push(host.cmView.scrollHandler.of((update, range) => {
        const cell = self.tableCell;
        return !!(
          cell &&
          cell.containerEl.isShown() &&
          cell.table &&
          cell.table.containsRange(range.anchor, range.head)
        );
      }));
      extensions.push(host.cmKeymapFacet.of([
        {
          key: "Enter",
          preventDefault: true,
          run() {
            if (!self.app.vault.getConfig("smartIndentList")) return false;
            const state = self.cm.state;
            const pos = state.selection.main.from;
            if (host.isSmartIndentTarget(state, state.doc.lineAt(pos))) {
              self.editor.newlineAndIndentOnly();
            } else {
              self.editor.newlineAndIndentContinueMarkdownList();
            }
            return true;
          },
          shift() {
            if (!self.app.vault.getConfig("smartIndentList")) return false;
            self.editor.newlineAndIndentOnly();
            return true;
          },
        },
        {
          key: "Tab",
          run() {
            self.editor.indentList();
            return true;
          },
          shift() {
            self.editor.unindentList();
            return true;
          },
        },
      ]));
      return extensions;
    },

    getDynamicExtensions() {
      const extensions = host.CodeMirrorEditor.prototype.getDynamicExtensions.call(this);
      const vault = this.app.vault;
      const editorEl = this.editorEl;
      if (vault.getConfig("showLineNumber")) {
        extensions.push(host.cmLineNumbersFixed({ fixed: false }));
        extensions.push(host.cmLineNumbersCompute);
        extensions.push(host.cmLineNumbersField());
      }
      if (vault.getConfig("smartIndentList")) extensions.push(host.cmTableCellFilter(this));
      if (vault.getConfig("showIndentGuide")) extensions.push(host.cmIndentGuides);
      const foldHeading = vault.getConfig("foldHeading");
      const foldIndent = vault.getConfig("foldIndent");
      const folding = foldHeading || foldIndent;
      editorEl.toggleClass("is-folding", folding);
      if (folding) {
        extensions.push(host.cmFoldGutter());
        extensions.push(host.cmFoldDecorations);
        if (foldHeading) extensions.push(host.cmFoldHeading);
        if (foldIndent) extensions.push(host.cmFoldIndent);
        extensions.push(host.cmFoldFrontmatter);
      }
      if (vault.getConfig("autoPairBrackets") || vault.getConfig("autoPairMarkdown")) {
        extensions.push([host.cmAutoPair]);
      }
      editorEl.toggleClass("show-properties", vault.getConfig("propertiesInDocument") === "visible");
      return extensions;
    },

    setCssClass(classes) {
      const editorEl = this.editorEl;
      editorEl.removeClasses(this.cssClasses);
      let rest = [];
      if (classes && classes.length) {
        rest = classes.filter((cls) => !editorEl.hasClass(cls));
        if (rest.length) editorEl.addClasses(rest);
      }
      this.cssClasses = rest;
    },

    onCssChange() {
      this.cm.dispatch({ effects: [host.cmClearCacheEffect.of()] });
      this.editor.refresh();
    },

    onViewClick(event) {
      if (event.defaultPrevented) return;
      this.editorSuggest.close();
      setTimeout(() => this.editor.removeHighlights(), 0);
    },

    onUpdate(update, isUserEvent) {
      host.CodeMirrorEditor.prototype.onUpdate.call(this, update, isUserEvent);
      const workspace = this.app.workspace;
      if (update.docChanged) workspace.trigger("editor-change", this.editor, this.owner);
      if (update.selectionSet || isUserEvent || update.focusChanged) {
        workspace.trigger("editor-selection-change", this.editor, this.owner);
      }
    },

    onConfigChanged(configKey) {
      host.CodeMirrorEditor.prototype.onConfigChanged.call(this, configKey);
      if (
        configKey === "showLineNumber" || configKey === "showIndentGuide" ||
        configKey === "foldHeading" || configKey === "foldIndent" ||
        configKey === "propertiesInDocument"
      ) {
        this.updateOptions();
      }
    },
  });

  return EditModeBase;
}