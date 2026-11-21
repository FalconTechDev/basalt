// g35 clean-room: web viewer chrome — page-title to file-name helper and the
// address-bar URL suggest (spec g35, s28-webview).
import { env } from "./env.js";
import { normalizePath } from "./path.js";
import { s05AssertValidFileName } from "./s05-utils.js";
import { containsAllWords, renderMatches } from "./search-simple.js";
import { matchScore } from "./search.js";

/** Page title -> safe vault file name; illegal results become "Untitled". */
export function ng35TitleToFileName(title) {
  const cleaned = normalizePath(String(title).replace(/[?*]/g, "").replace(/[\\/:]/g, " - "));
  if (!cleaned || cleaned === "/") return "Untitled";
  try {
    s05AssertValidFileName(cleaned);
  } catch (e) {
    return "Untitled";
  }
  return cleaned;
}

// The suggest class is built once per host so the address bar can reuse it.
let ng35SuggestSlot = null;

/** Address-bar suggest: history + bookmarks + typed/search completions. */
export function ng35WebViewerAddressSuggest(host) {
  if (ng35SuggestSlot && ng35SuggestSlot.host === host) return ng35SuggestSlot.cls;
  const Base = env().SI;
  class Ng35AddressSuggest extends Base {
    constructor(webview, inputEl) {
      super(webview.app, inputEl);
      this.webview = webview;
      this.inputEl = inputEl;
      this.scope.register([], "Escape", () => this.close());
    }

    selectSuggestion(suggestion) {
      this.inputEl.blur();
      this.webview.navigate(suggestion.url, true);
      this.close();
    }

    async getSuggestions(query) {
      const rawQuery = query;
      const q = query.toLowerCase();
      const items = new Map();
      items.set("about:blank", { title: "Blank", url: "about:blank", type: "about" });
      const history = await this.webview.plugin.db.getHistoryItems();
      for (const item of history) {
        if (!items.has(item.url)) items.set(item.url, { title: item.title, url: item.url, type: "history" });
      }
      const bookmarks = this.app.internalPlugins.getEnabledPluginById("bookmarks");
      if (bookmarks) {
        for (const b of bookmarks.getBookmarks()) {
          if (b.type === "url") items.set(b.url, { title: b.title, url: b.url, type: "bookmark" });
        }
      }
      const list = [];
      let exactUrl = false;
      for (const item of items.values()) {
        const s = { title: item.title, url: item.url, type: item.type, score: 0, matches: null };
        if (q !== "") {
          if (item.url.toLowerCase() === q) exactUrl = true;
          const haystack = (item.title + " " + item.url).toLowerCase();
          const ranges = containsAllWords([q], haystack);
          if (!ranges) continue;
          s.matches = ranges;
          s.score = matchScore(ranges, rawQuery.length, haystack.length, 0);
        }
        list.push(s);
      }
      if (q === "" || exactUrl) return list;
      const firstSegment = rawQuery.split("/")[0];
      let synthetic;
      if (q.startsWith("http://") || q.startsWith("https://")) {
        synthetic = { title: "", url: rawQuery, score: 100, matches: null, type: "typed" };
      } else if (firstSegment.includes(".") && !firstSegment.endsWith(".")) {
        synthetic = { title: "", url: "https://" + rawQuery, score: 100, matches: null, type: "typed" };
      } else {
        synthetic = {
          title: host.t.plugins.webViewer.actionSearchForQuery({ query: rawQuery }),
          url: this.webview.plugin.getSearchEngineUrl(rawQuery),
          score: 100,
          matches: null,
          type: "search",
        };
      }
      list.unshift(synthetic);
      return list;
    }

    renderSuggestion(s, el) {
      el.addClass("mod-complex", "webviewer-addressbar-suggestion");
      const icon = el.createDiv("suggestion-icon");
      const flairLeft = icon.createDiv("suggestion-flair suggestion-flair-left");
      const content = el.createDiv("suggestion-content");
      const aux = el.createDiv("suggestion-aux");
      if (s.type === "search") {
        host.setIcon(flairLeft, "lucide-search");
      } else if (s.type === "history" || s.type === "bookmark") {
        this.webview.plugin.db.setIcon(flairLeft, s.url);
      }
      if (s.type === "bookmark") {
        host.setIcon(aux.createDiv("suggestion-flair"), "lucide-bookmark");
      }
      const titleEl = content.createDiv("suggestion-title");
      renderMatches(titleEl, s.title, s.matches, 0);
      if (s.type !== "search") {
        const urlEl = content.createDiv("suggestion-url");
        renderMatches(urlEl, s.url, s.matches, -(s.title.length + 1));
      }
    }

    reposition(targetRect) {
      super.reposition(targetRect);
      const width = targetRect.right - targetRect.left + "px";
      this.suggestEl.style.width = width;
      this.suggestEl.style.maxWidth = width;
    }
  }
  ng35SuggestSlot = { host, cls: Ng35AddressSuggest };
  return Ng35AddressSuggest;
}

/** The suggest class for a host, building it on first use. */
export function ng35SharedSuggestClass(host) {
  if (ng35SuggestSlot && ng35SuggestSlot.host === host) return ng35SuggestSlot.cls;
  return ng35WebViewerAddressSuggest(host);
}

