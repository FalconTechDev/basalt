// g26 clean-room: DocumentSearch — the find bar of preview surfaces
// (spec g26 Part F). DOM structure, scope keys and the highlight-range scan
// are contractual; internals are an independent table/closure design.

import { makeHotkey } from "./text.js";
import { debounceCall } from "./timing.js";

export function ng26DefineDocumentSearch(host) {
  const t = () => host.t.editor.search;

  class DocumentSearch {
    constructor(parentScope, renderer, containerEl, onClose) {
      this.renderer = renderer;
      this.onCloseCallback = onClose;
      this.scope = new host.Scope(parentScope);
      this.highlightRanges = null;
      this.lastQuery = null;
      this.lastText = null;
      this.selectedRange = -1;

      this.searchContainerEl = containerEl.createDiv({ cls: "document-search-container", prepend: true });
      const bar = this.searchContainerEl.createDiv("document-search");
      const inputWrap = bar.createDiv("search-input-container document-search-input");
      this.searchInputEl = inputWrap.createEl("input", { attr: { type: "text" } });
      this.searchInputEl.placeholder = t().placeholderFind();
      this.countEl = inputWrap.createDiv("document-search-count");

      const buttons = bar.createDiv("document-search-buttons");
      this.prevButtonEl = buttons.createEl("button", { cls: "clickable-icon document-search-button" });
      host.setIcon(this.prevButtonEl, "lucide-arrow-up");
      this.nextButtonEl = buttons.createEl("button", { cls: "clickable-icon document-search-button" });
      host.setIcon(this.nextButtonEl, "lucide-arrow-down");
      this.closeButtonEl = bar.createDiv("clickable-icon document-search-close-button");
      host.setIcon(this.closeButtonEl, "lucide-x");
      this.closeButtonEl.addEventListener("mousedown", (event) => event.preventDefault());

      host.setTooltip(this.prevButtonEl, t().labelPrevious() + "\n" + host.formatHotkey(makeHotkey(["Shift"], "F3")), { placement: "top" });
      host.setTooltip(this.nextButtonEl, t().labelNext() + "\n" + host.formatHotkey(makeHotkey([], "F3")), { placement: "top" });
      host.setTooltip(this.closeButtonEl, t().labelExitSearch());

      for (const btn of [this.prevButtonEl, this.nextButtonEl]) {
        btn.addEventListener("mousedown", (event) => event.preventDefault());
      }
      this.prevButtonEl.addEventListener("click", (event) => {
        event.preventDefault();
        this.findPrevious();
      });
      this.nextButtonEl.addEventListener("click", (event) => {
        event.preventDefault();
        this.findNext();
      });
      this.closeButtonEl.addEventListener("click", (event) => {
        event.preventDefault();
        this.close();
      });

      this.onSearchInputDebounced = debounceCall(() => this.onSearchInput(), 150, true);
      this.searchInputEl.addEventListener("input", () => this.onSearchInputDebounced());
      this.searchInputEl.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        if (!host.Platform.hasPhysicalKeyboard && event.key === "Enter") {
          event.preventDefault();
          host.blurAndClearSelection();
        }
      });

      const keys = [
        [[], "F3", () => this.findNext()],
        [["Mod"], "G", () => this.findNext()],
        [["Shift"], "F3", () => this.findPrevious()],
        [["Mod", "Shift"], "G", () => this.findPrevious()],
        [[], "Enter", (event) => this.onEnter(event)],
        [["Shift"], "Enter", (event) => this.onShiftEnter(event)],
        [[], "Escape", () => this.close()],
      ];
      for (const [mods, key, fn] of keys) this.scope.register(mods, key, fn);

      const selection = activeWindow.getSelection();
      const seed = selection ? selection.toString() : "";
      if (seed) this.searchInputEl.value = seed;
      this.updateQuery();
      this.updateCount();
    }

    getQuery() {
      return this.searchInputEl.value;
    }

    updateQuery() {
      const query = this.getQuery().toLowerCase();
      const renderer = this.renderer;
      const effective = query ? renderer.lastText : null;
      if (effective === this.lastText && query === this.lastQuery) return;
      if (query !== this.lastQuery) this.selectedRange = -1;
      this.lastText = effective;
      this.lastQuery = query;
      this.searchInputEl.removeClass("mod-no-match");
      for (const section of renderer.sections) section.highlightRanges = null;
      renderer.queueRender();
      if (!query) {
        this.highlightRanges = null;
        return;
      }
      const all = [];
      for (const section of renderer.sections) {
        const nodes = [];
        host.textNodes(section.el, nodes);
        let haystack = "";
        for (const node of nodes) haystack += node.textContent;
        haystack = haystack.toLowerCase();
        const list = [];
        let at = 0;
        let hit;
        while ((hit = haystack.indexOf(query, at)) !== -1) {
          const range = { section, start: hit, end: hit + query.length, active: false };
          list.push(range);
          all.push(range);
          at = hit + query.length;
        }
        if (list.length) section.highlightRanges = list;
      }
      this.highlightRanges = all;
      if (!all.length) this.searchInputEl.addClass("mod-no-match");
    }

    updateCount() {
      const query = this.getQuery();
      this.countEl.toggle(!!query);
      if (!query) return;
      const ranges = this.highlightRanges || [];
      this.countEl.setText((this.selectedRange + 1) + " / " + ranges.length);
    }

    onSearchInput() {
      this.updateQuery();
      this.selectRange(0);
      this.updateCount();
    }

    findNext() {
      this.selectRange(this.selectedRange + 1);
      this.updateCount();
    }

    findPrevious() {
      this.selectRange(this.selectedRange - 1);
      this.updateCount();
    }

    selectRange(index) {
      const ranges = this.highlightRanges;
      if (!ranges || !ranges.length) return;
      let i = index;
      if (i > ranges.length - 1) i = 0;
      if (i < 0) i = ranges.length - 1;
      const prev = this.selectedRange >= 0 ? ranges[this.selectedRange] : null;
      if (prev) prev.active = false;
      this.selectedRange = i;
      const current = ranges[i];
      current.active = true;
      this.renderer.selectRange(current);
    }

    onEnter(event) {
      if (event.isComposing) return;
      if (this.searchInputEl.isActiveElement && this.searchInputEl.isActiveElement()) this.findNext();
    }

    onShiftEnter(event) {
      if (event.isComposing) return;
      if (this.searchInputEl.isActiveElement && this.searchInputEl.isActiveElement()) this.findPrevious();
    }

    close() {
      this.searchContainerEl.detach();
      this.searchInputEl.value = "";
      this.searchInputEl.removeClass("mod-no-match");
      this.updateQuery();
      this.onCloseCallback();
    }
  }

  return DocumentSearch;
}
