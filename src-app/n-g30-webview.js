// g30 clean-room: web-viewer address bar, address suggestions and the
// find-in-page bar (spec g30 part H). Suggest/FindBar extend the shared
// env().SI / env().vj bases; the address bar reuses the suggest class built
// by s11WebviewSuggest (factories must run in that order).
import {env} from "./env.js";
import {inherit} from "./inherit.js";
import {ng30WebViewerStrings} from "./n-g30-i18n.js";

let ng30SuggestCls = null;
let ng30FindCls = null;

/** Address-bar suggestions: about:blank + history + bookmarks, fuzzy ranked. */
export function ng30WebviewSuggest(host) {
  function WebviewSuggest(webview, inputEl) {
    const self = env().SI.call(this, webview.app, inputEl) || this;
    self.webview = webview;
    self.inputEl = inputEl;
    self.scope.register([{ key: "Escape" }], () => self.close());
    return self;
  }
  inherit(WebviewSuggest, env().SI);
  const proto = WebviewSuggest.prototype;

  proto.selectSuggestion = function (s) {
    this.inputEl.blur();
    this.webview.navigate(s.url, true);
    this.close();
  };

  proto.getSuggestions = async function (input) {
    const lower = String(input).toLowerCase();
    const candidates = new Map();
    candidates.set("about:blank", { title: "Blank", url: "about:blank", type: "about" });
    const history = await this.webview.plugin.db.getHistoryItems();
    for (const item of history || []) {
      if (!candidates.has(item.url)) {
        candidates.set(item.url, { title: item.title, url: item.url, type: "history" });
      }
    }
    const bookmarks = this.webview.app.internalPlugins.getEnabledPluginById("bookmarks");
    if (bookmarks) {
      for (const bm of bookmarks.getBookmarks() || []) {
        if (bm.type === "url") {
          candidates.set(bm.url, { title: bm.title, url: bm.url, type: "bookmark" });
        }
      }
    }
    const out = [];
    let typed = false;
    for (const c of candidates.values()) {
      const s = { title: c.title, url: c.url, type: c.type, matches: null, score: 0 };
      if (!lower) {
        out.push(s);
        continue;
      }
      const hay = (c.title + " " + c.url).toLowerCase();
      const matches = env().Ly([lower], hay);
      if (!matches) continue;
      s.matches = matches;
      s.score = env().xy(matches, lower.length, hay.length, 0);
      if (c.url.toLowerCase() === lower) typed = true;
      out.push(s);
    }
    out.sort((a, b) => b.score - a.score);
    if (!lower || typed) return out;
    const seg = String(input).match(/([^\/?#]+)/);
    const first = seg ? seg[1] : "";
    const dot = first.indexOf(".");
    if (dot > 0 && dot < first.length - 1) {
      out.unshift({ title: "", url: "https://" + input, score: 100, type: "typed", matches: null });
    } else {
      const t = ng30WebViewerStrings() || {};
      out.unshift({
        title: t.actionSearchForQuery ? t.actionSearchForQuery({ query: input }) : "",
        url: this.webview.plugin.getSearchEngineUrl(input),
        score: 100, type: "search", matches: null,
      });
    }
    return out;
  };

  proto.renderSuggestion = function (s, el) {
    el.classList.add("mod-complex", "webviewer-addressbar-suggestion");
    const icon = createDiv("suggestion-icon");
    const flairLeft = createDiv("suggestion-flair-left");
    icon.appendChild(flairLeft);
    el.appendChild(icon);
    const content = createDiv("suggestion-content");
    el.appendChild(content);
    const titleEl = createDiv("suggestion-title");
    content.appendChild(titleEl);
    let urlEl = null;
    if (s.type !== "search") {
      urlEl = createDiv("suggestion-url");
      content.appendChild(urlEl);
    }
    const aux = createDiv("suggestion-aux");
    el.appendChild(aux);
    const flair = createDiv("suggestion-flair");
    aux.appendChild(flair);
    if (s.type === "search") {
      host.setIcon(flairLeft, "lucide-search");
    } else if (s.type === "history" || s.type === "bookmark") {
      this.webview.plugin.db.setIcon(flairLeft, s.url);
      if (s.type === "bookmark") host.setIcon(flair, "lucide-bookmark");
    }
    env().Ny(titleEl, s.title, s.matches);
    if (urlEl) env().Ny(urlEl, s.url, s.matches, -(String(s.title).length + 1));
  };

  proto.reposition = function (rect) {
    env().SI.prototype.reposition.call(this, rect);
    const px = (rect.right - rect.left) + "px";
    this.suggestEl.style.width = px;
    this.suggestEl.style.maxWidth = px;
  };
  ng30SuggestCls = WebviewSuggest;
  return WebviewSuggest;
}

/** Address bar: input + suggestion popup + focus/escape value restore. */
export function ng30WebviewAddressBar(host) {
  function WebviewAddressBar(webview, containerEl) {
    const self = this;
    containerEl.classList.add("webviewer-address-container");
    const wrap = createDiv("webviewer-address");
    containerEl.appendChild(wrap);
    const input = document.createElement("input");
    input.type = "text";
    input.setAttribute("spellcheck", "false");
    wrap.appendChild(input);
    self.addrInputEl = input;
    const SuggestCls = ng30SuggestCls || ng30WebviewSuggest(host);
    self.suggest = new SuggestCls(webview, input);
    let saved = "";
    input.addEventListener("focus", () => {
      containerEl.win.setTimeout(() => {
        input.select();
        saved = input.value;
        self.suggest.open();
      }, 100);
    });
    input.addEventListener("keydown", (evt) => {
      if (evt.key !== "Escape") return;
      evt.preventDefault();
      input.blur();
      input.value = saved;
    });
  }
  WebviewAddressBar.prototype.setValue = function (value) {
    this.addrInputEl.value = value || "";
  };
  WebviewAddressBar.prototype.focus = function () {
    this.addrInputEl.focus();
  };
  return WebviewAddressBar;
}

/** Find-in-page bar: query forwarding, result counting, show/hide scope. */
export function ng30WebviewFindBar(host) {
  function WebviewFindBar(webview, containerEl, applyScope) {
    const self = env().vj.call(this, containerEl) || this;
    self.webview = webview;
    self.applyScope = applyScope;
    self.foundInPageHandler = self._foundInPageHandler.bind(self);
    return self;
  }
  inherit(WebviewFindBar, env().vj);
  const proto = WebviewFindBar.prototype;

  proto._foundInPageHandler = function (evt) {
    if (evt.result.finalUpdate) {
      this.numResults = evt.result.matches;
      this.currentResult = evt.result.activeMatchOrdinal;
    }
  };

  proto.findPrevious = function () {
    const q = this.getQuery();
    if (q) this.webview.findInPage(q, { findNext: false, forward: false });
    else this.webview.stopFindInPage("clearSelection");
  };

  proto.findNext = function () {
    const q = this.getQuery();
    if (!q) {
      this.webview.stopFindInPage("clearSelection");
      return;
    }
    this.webview.findInPage(q, { findNext: this.currentResult === this.numResults });
  };

  proto.findNextOrReplace = function () {
    this.findNext();
  };

  proto.onSearchInput = function () {
    const q = this.getQuery();
    if (q) this.webview.findInPage(q, { findNext: true });
  };

  proto.show = function () {
    this.containerEl.prepend(this.searchContainerEl);
    env().Pv(this.searchInputEl);
    this.applyScope(this.scope);
    this.onSearchInput();
    this.webview.addEventListener("found-in-page", this.foundInPageHandler);
  };

  proto.hide = function () {
    this.webview.stopFindInPage("clearSelection");
    if (this.searchContainerEl.parentNode) this.searchContainerEl.remove();
    this.applyScope(null);
    this.webview.removeEventListener("found-in-page", this.foundInPageHandler);
  };
  ng30FindCls = WebviewFindBar;
  return WebviewFindBar;
}
