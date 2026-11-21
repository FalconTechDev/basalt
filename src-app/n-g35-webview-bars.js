// g35 clean-room: web viewer chrome — the address bar and the find-in-page
// bar (spec g35, s28-webview).
import { env } from "./env.js";
import { ng35SharedSuggestClass } from "./n-g35-webview.js";

/** Address bar: text input + suggest popup with Escape-restore. */
export function ng35WebViewerAddressBar(host) {
  function AddressBar(webview, containerEl) {
    containerEl.addClass("webviewer-address-container");
    const row = containerEl.createDiv("webviewer-address");
    const input = row.createEl("input", { type: "text" });
    input.setAttribute("spellcheck", "false");
    this.addrInputEl = input;
    this.webview = webview;
    const Suggest = ng35SharedSuggestClass(host);
    this.suggest = new Suggest(webview, input);
    let previousValue = "";
    input.addEventListener("focus", () => {
      setTimeout(() => input.select(), 100);
      previousValue = input.value;
      this.suggest.open();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        input.blur();
        input.value = previousValue;
      }
    });
  }
  AddressBar.prototype.setValue = function (v) { this.addrInputEl.value = v || ""; };
  AddressBar.prototype.focus = function () { this.addrInputEl.focus(); };
  return AddressBar;
}

/** Find-in-page bar wrapping the webview's found-in-page events. */
export function ng35WebViewerFindBar(host) {
  const Base = env().vj;
  class Ng35FindBar extends Base {
    constructor(webview, containerEl, applyScope) {
      super(containerEl);
      this.webview = webview;
      this.applyScope = applyScope;
      this.numResults = 0;
      this.currentResult = 0;
      this._foundHandler = (e) => this._foundInPageHandler(e);
    }

    _query() { return this.getQuery(); }

    findPrevious() {
      const q = this._query();
      if (q) this.webview.findInPage(q, { findNext: false, forward: false });
      else this.webview.stopFindInPage("clearSelection");
    }

    findNext() {
      const q = this._query();
      if (!q) {
        this.webview.stopFindInPage("clearSelection");
        return;
      }
      const wrapped = this.currentResult === this.numResults;
      this.webview.findInPage(q, { findNext: wrapped });
    }

    findNextOrReplace() { this.findNext(); }

    onSearchInput() {
      const q = this._query();
      if (q) this.webview.findInPage(q, { findNext: true });
      else this.webview.stopFindInPage("clearSelection");
    }

    show() {
      this.containerEl.prepend(this.searchContainerEl);
      host.selectOnFocus(this.searchInputEl);
      this.applyScope(this.scope);
      this.onSearchInput();
      this.webview.addEventListener("found-in-page", this._foundHandler);
    }

    hide() {
      this.webview.stopFindInPage("clearSelection");
      this.searchContainerEl.remove();
      this.applyScope(null);
      this.webview.removeEventListener("found-in-page", this._foundHandler);
    }

    _foundInPageHandler(event) {
      if (!event.result.finalUpdate) return;
      this.numResults = event.result.matches;
      this.currentResult = event.result.activeMatchOrdinal;
    }
  }
  return Ng35FindBar;
}
