// Slice s30 — the built-in Web Viewer core plugin and its views.
//
// Faithful port of the inherited webviewer feature: the plugin class with its
// commands and options, the IndexedDB-backed history/icon store, the webview
// ItemView (address bar, reader mode, context menus, find-in-page, zoom), the
// history side view, the settings tab and the two modals (search-the-web and
// clear-data). DOM classes, i18n keys, view types and command ids are unchanged.
// App-scope values arrive through env() (envBind aliases) or host (manifest host).

import { inherit } from "./inherit.js";
import { env } from "./env.js";

const s30We = () => env();

// ---------------------------------------------------------------- constants

export const s30WebviewerViewType = "webviewer";
export const s30WebviewerHistoryViewType = "webviewer-history";
export const s30DefaultSearchEngine = "duckduckgo";
export const s30WebviewerBlankUrl = "data:text/plain,";

/** Search engine table used by the settings dropdown and URL builder (C2). */
export const s30SearchEngines = {
  duckduckgo: { display: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  brave: { display: "Brave", url: "https://search.brave.com/search?q=%s" },
  bing: { display: "Bing", url: "https://www.bing.com/search?q=%s" },
  google: { display: "Google", url: "https://www.google.com/search?q=%s" },
  custom: { display: "custom" },
};

/** Default plugin options; loadData() merges stored values into this object (E2). */
export const s30WebviewerDefaultOptions = { openExternalURLs: true, enableAdblocking: true };

const s30WvI18n = () => s30We().gm.plugins.webViewer;

// ---------------------------------------------------------------- classes

let s30Wv = null;
let s30WvHost = null;

function s30WebviewerClasses(host) {
  if (host) s30WvHost = host;
  if (s30Wv) return s30Wv;
  const H = s30WvHost || {};

  // -- history / icon store -------------------------------------------------

  function WebviewerDb(app) {
    this.db = null;
    this.app = app;
  }

  WebviewerDb.prototype.connect = async function () {
    this.db = await H.openMetadataDb(this.app.appId + "-webview", 1, {
      upgrade: function (db) {
        if (!db.objectStoreNames.contains("icons")) db.createObjectStore("icons");
        if (!db.objectStoreNames.contains("history")) db.createObjectStore("history", { keyPath: "id", autoIncrement: true });
      },
    });
  };

  WebviewerDb.prototype.getHistoryItems = async function () {
    if (!this.db) return [];
    return (await this.db.getAll("history")).reverse();
  };

  WebviewerDb.prototype.addHistoryItem = async function (url, title) {
    if (!this.db) return;
    const tx = this.db.transaction("history", "readonly");
    const cursor = await tx.objectStore("history").openCursor(null, "prev");
    if (cursor && cursor.value.url === url) {
      tx.commit();
      return;
    }
    tx.commit();
    const rec = { title: title || "", url: url, accessTs: Date.now() };
    const id = await this.db.put("history", rec);
    rec.id = id;
    const keys = await this.db.getAllKeys("history");
    if (keys.length > 1e3) {
      const s = keys.length - 1e3;
      const oldest = keys[s - 1];
      this.db.delete("history", IDBKeyRange.upperBound(oldest));
    }
    this.app.workspace.trigger("webviewer:update-history");
  };

  WebviewerDb.prototype.removeHistoryItem = async function (item) {
    await this.db.delete("history", item.id);
    this.app.workspace.trigger("webviewer:update-history");
  };

  WebviewerDb.prototype.clearHistoryItems = async function () {
    await this.db.delete("history", IDBKeyRange.lowerBound(0, true));
    this.app.workspace.trigger("webviewer:update-history");
  };

  WebviewerDb.prototype.setIcon = async function (el, url) {
    const host = (function (u) {
      const m = u.toLowerCase().match(/^https?:\/\/([^\/?#]+)/);
      return m ? m[1] : undefined;
    })(url);
    if (host) {
      const icon = await this.loadIcon(host, url);
      if (icon) {
        el.createEl("img").src = icon;
        return;
      }
    }
    H.setIcon(el, "globe-2");
  };

  WebviewerDb.prototype.loadIcon = async function (host, url) {
    if (!this.db) return null;
    const rec = await this.db.get("icons", host);
    return rec ? rec == null ? void 0 : rec.base64 : this.storeIcon(host, url);
  };

  WebviewerDb.prototype.storeIcon = async function (host, url) {
    if (!url) return null;
    try {
      const res = await s30We().s30hy(url);
      const ct = res.headers["content-type"];
      const bytes = Array.from(new Uint8Array(res.arrayBuffer));
      const b64 = btoa(String.fromCharCode.apply(null, bytes));
      const data = "data:".concat(ct, ";base64,", b64);
      this.db.put("icons", { source: url, base64: data }, host);
      return data;
    } catch (e) {
      return null;
    }
  };

  // -- history list item ------------------------------------------------------

  function WebviewerHistoryItem(app, plugin, item) {
    const self = H.TreeItem.call(this) || this;
    self.vChildren = new H.TreeChildren(self);
    self.pusherEl = H.s16TreePusher();
    self.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
    self.app = app;
    self.plugin = plugin;
    self.item = item;
    const iconEl = self.selfEl.createDiv({ cls: "tree-item-icon", prepend: true });
    plugin.db.setIcon(iconEl, item.url);
    self.titleEl = self.innerEl.createDiv("tree-item-inner-text webviewer-history-view-item");
    self.titleEl.setText(item.title || item.url);
    self.selfEl.addEventListener("contextmenu", self.onContextMenu.bind(self));
    self.setClickable(true);
    return self;
  }
  inherit(WebviewerHistoryItem, H.TreeItem);
  WebviewerHistoryItem.prototype.onSelfClick = function (e) {
    this.app.workspace.getLeaf(H.Keymap.isModEvent(e)).setViewState({ type: s30WebviewerViewType, state: { url: this.item.url, title: this.item.title, navigate: true } });
  };
  WebviewerHistoryItem.prototype.onContextMenu = function (e) {
    const self = this;
    if (e.defaultPrevented) return;
    const menu = new H.Menu().addSections(["action", "danger"]);
    menu.addItem(function (item) {
      return item.setTitle(s30WvI18n().actionCopyURL()).setIcon("lucide-copy").setSection("action").onClick(function () {
        navigator.clipboard.writeText(self.item.url);
      });
    });
    menu.addItem(function (item) {
      return item.setTitle(s30WvI18n().actionRemoveFromHistory()).setIcon("lucide-trash-2").setSection("danger").setWarning(true).onClick(function () {
        self.plugin.db.removeHistoryItem(self.item);
      });
    });
    menu.showAtMouseEvent(e);
  };

  // -- history side view ------------------------------------------------------

  function WebviewerHistoryView(leaf, plugin) {
    const self = H.ItemView.call(this, leaf) || this;
    self.icon = "lucide-clock";
    self.itemDoms = new Map();
    self.requestUpdate = H.debounce(self.update.bind(self), 100);
    self.plugin = plugin;
    self.scope = new H.Scope(self.app.scope);
    self.tree = new H.Tree(self, { app: self.app, containerEl: self.contentEl, id: s30WebviewerHistoryViewType, scope: self.scope });
    return self;
  }
  inherit(WebviewerHistoryView, H.ItemView);
  WebviewerHistoryView.prototype.onload = function () {
    this.registerEvent(this.app.workspace.on("webviewer:update-history", this.requestUpdate, this));
  };
  WebviewerHistoryView.prototype.getViewType = function () { return s30WebviewerHistoryViewType; };
  WebviewerHistoryView.prototype.getDisplayText = function () { return s30WvI18n().historyName(); };
  WebviewerHistoryView.prototype.onPaneMenu = function (menu, leaf) {
    H.ItemView.prototype.onPaneMenu.call(this, menu, leaf);
    const self = this;
    menu.addItem(function (item) {
      return item.setSection("action").setTitle(s30WvI18n().actionClearHistory()).setIcon("lucide-eraser").onClick(function () {
        self.plugin.db.clearHistoryItems();
      });
    });
  };
  WebviewerHistoryView.prototype.onOpen = async function () {
    await this.update();
  };
  WebviewerHistoryView.prototype.onResize = function () {
    this.tree.infinityScroll.onResize();
  };
  WebviewerHistoryView.prototype.update = async function () {
    const items = await this.plugin.db.getHistoryItems();
    const doms = [];
    const next = new Map();
    for (const item of items) {
      let dom = this.itemDoms.get(item.id);
      if (!dom) dom = new WebviewerHistoryItem(this.app, this.plugin, item);
      doms.push(dom);
      next.set(item.id, dom);
    }
    this.itemDoms = next;
    this.tree.root.vChildren.setChildren(doms);
    this.tree.infinityScroll.queueCompute();
  };

  // -- webviewer ItemView ------------------------------------------------------

  function WebviewerView(leaf, plugin) {
    const self = H.ItemView.call(this, leaf) || this;
    self.navigation = true;
    self.hasConfiguredWebContents = false;
    self.webviewMounted = false;
    self.loadFirstPage = null;
    self.webviewFirstLoadFinished = false;
    self.requestCommitPageLoad = H.debounce(self.commitPageLoad.bind(self));
    self.plugin = plugin;
    self.mode = "blank";
    return self;
  }
  inherit(WebviewerView, H.ItemView);
  WebviewerView.prototype.getViewType = function () { return s30WebviewerViewType; };
  WebviewerView.prototype.getDisplayText = function () { return this.title || s30WvI18n().labelNewWebViewer(); };
  WebviewerView.prototype.getState = function () {
    return Object.assign({}, H.ItemView.prototype.getState.call(this), { url: this.url, title: this.title, mode: this.mode });
  };
  WebviewerView.prototype.getIcon = function () { return "globe-2"; };
  WebviewerView.prototype.setState = async function (state, result) {
    await H.ItemView.prototype.setState.call(this, state, result);
    if (state.url && this.url !== state.url) {
      if (state.title) this.title = state.title;
      const navigate = state.navigate || false;
      this.navigate(state.url, navigate);
    }
  };
  WebviewerView.prototype.onPaneMenu = function (menu, leaf) {
    const self = this;
    H.ItemView.prototype.onPaneMenu.call(this, menu, leaf);
    menu.addItem(function (item) {
      return item.setTitle(s30WvI18n().actionSaveToVault()).setIcon("lucide-file-down").onClick(function () {
        return (async function () {
          const file = await self.saveAsMarkdown();
          if (file) self.app.workspace.getLeaf("tab").openFile(file);
        })();
      });
    });
    menu.addItem(function (item) {
      return item.setSection("action").setTitle(s30We().gm.interface.menu.find()).setIcon("lucide-file-search").onClick(self.showSearch.bind(self));
    });
    menu.addItem(function (item) {
      return item.setSection("action").setTitle(s30WvI18n().actionOpenDefaultBrowser()).setIcon("lucide-globe-2").onClick(function () {
        window.open(self.url, "_external");
      });
    });
    const zoom = this.webview.getZoomFactor();
    menu.addItem(function (item) {
      return item.setTitle(s30We().gm.commands.zoomIn()).setIcon("zoom-in").setSection("zoom").setDisabled(zoom >= 3).onClick(self.zoomIn.bind(self));
    });
    menu.addItem(function (item) {
      return item.setTitle(s30We().gm.commands.resetZoom()).setIcon("rotate-cw").setSection("zoom").setDisabled(1 === zoom).onClick(self.zoomReset.bind(self));
    });
    menu.addItem(function (item) {
      return item.setTitle(s30We().gm.commands.zoomOut()).setIcon("zoom-out").setSection("zoom").setDisabled(zoom <= 0.5).onClick(self.zoomOut.bind(self));
    });
  };
  WebviewerView.prototype.onOpen = function () {
    this.headerEl.addClass("view-header-always-show");
    const reloadWrap = createDiv("view-header-reload-button");
    this.reloadButtonEl = reloadWrap.createEl("button", "clickable-icon");
    H.setIcon(this.reloadButtonEl, "rotate-cw");
    this.headerEl.insertBefore(reloadWrap, this.titleContainerEl);
    this.titleEl.detach();
    this.addressBar = new (s30We().s30HJ)(this, this.titleContainerEl);
    this.contentEl.addClass("webviewer-content");
    this.searchContainerEl = this.contentEl.createDiv("search-in-page");
    this.readerView = this.contentEl.createDiv("reader-mode-content");
    this.readerView.hide();
    this.readerView.addEventListener("contextmenu", this.onReaderModeContextMenu.bind(this));
    this.instantiateWebView();
    this.errorView = this.contentEl.createDiv("error-notice", function (el) {
      el.createEl("h1", { text: s30WvI18n().labelFailToLoad() });
      el.createEl("p", { text: s30WvI18n().labelFailToLoadDesc() });
      el.hide();
    });
    this.readerModeToggleBtn = this.addAction("glasses", "Reader view", this.toggleReaderMode.bind(this));
  };
  WebviewerView.prototype.toggleReaderMode = function () {
    if ("reader" === this.mode) this.displayWebView();
    else this.displayReaderView();
  };
  WebviewerView.prototype.zoomIn = function () {
    const z = this.webview.getZoomFactor();
    if (z < 3) this.webview.setZoomFactor(z + 0.1);
  };
  WebviewerView.prototype.zoomOut = function () {
    const z = this.webview.getZoomFactor();
    if (z > 0.5) this.webview.setZoomFactor(z - 0.1);
  };
  WebviewerView.prototype.zoomReset = function () {
    this.webview.setZoomFactor(1);
  };
  WebviewerView.prototype.reportPageLoad = function (url, title, navigate) {
    if (!url) return;
    this.requestCommitPageLoad.cancel();
    if (this.inProgressPageLoad && this.inProgressPageLoad.hasOwnProperty("navigate")) navigate = this.inProgressPageLoad.navigate;
    this.showLoadingIndicator(true);
    this.inProgressPageLoad = { url: url, title: title, navigate: navigate };
  };
  WebviewerView.prototype.showLoadingIndicator = function (show) {
    if (this.contentEl.hasClass("is-loading") === show) return;
    const icon = show ? "x" : "rotate-cw";
    H.setIcon(this.reloadButtonEl, icon);
    this.contentEl.toggleClass("is-loading", show);
  };
  WebviewerView.prototype.commitPageLoad = async function () {
    if (!this.inProgressPageLoad) return;
    const load = this.inProgressPageLoad;
    const url = load.url, title = load.title, navigate = load.navigate;
    this.inProgressPageLoad = null;
    if (url === s30WebviewerBlankUrl) return;
    if (navigate && this.webviewFirstLoadFinished) {
      this.pushViewStackHistory(url);
    } else if (!this.webviewFirstLoadFinished) {
      this.webviewFirstLoadFinished = true;
    }
    this.url = url;
    this.addressBar.setValue(url);
    if (title) {
      this.title = title;
    } else {
      await this.storeCurrentPageTitle();
    }
    if (this.title !== s30WebviewerBlankUrl) {
      this.leaf.tabHeaderInnerTitleEl.setText(this.title);
      this.plugin.db.addHistoryItem(this.url, this.title);
    }
    const bookmarks = this.app.internalPlugins.getEnabledPluginById("bookmarks");
    if (bookmarks) bookmarks.updateTabHeaders();
    if (!this.hasConfiguredWebContents) {
      this.hasConfiguredWebContents = true;
      this.configureWebContents();
    }
    if ("reader" === this.mode) {
      this.displayReaderView();
    } else {
      this.webview.executeJavaScript("document.querySelectorAll('[target=\"_blank\"]').forEach(el => { el.removeAttribute('target') })");
    }
    this.app.workspace.requestSaveLayout();
  };
  WebviewerView.prototype.instantiateWebView = function () {
    const self = this;
    const doc = this.contentEl.doc;
    if (this.webview) this.webview.detach();
    this.hasConfiguredWebContents = false;
    this.webviewMounted = false;
    this.webviewFirstLoadFinished = false;
    const webview = this.webview = doc.createElement("webview");
    webview.style.backgroundColor = "white";
    webview.allowpopups = true;
    webview.partition = this.app.getWebviewPartition();
    webview.setAttribute("src", this.url || s30WebviewerBlankUrl);
    this.reloadButtonEl.addEventListener("click", function () {
      if (webview.isLoading()) {
        webview.stop();
        self.showLoadingIndicator(false);
      } else {
        webview.reload();
      }
    });
    webview.addEventListener("did-start-navigation", function (e) {
      if (e.isMainFrame) self.reportPageLoad(e.url, void 0, true);
    });
    webview.addEventListener("did-redirect-navigation", async function (e) {
      if (e.isMainFrame) self.reportPageLoad(e.url, void 0, false);
    });
    webview.addEventListener("dom-ready", function () {
      self.webviewMounted = true;
      if (self.loadFirstPage) {
        const first = self.loadFirstPage;
        self.loadFirstPage = null;
        first();
      }
      self.requestCommitPageLoad();
    });
    webview.addEventListener("did-stop-loading", function () {
      self.showLoadingIndicator(false);
    });
    webview.addEventListener("did-finish-load", async function () {
      self.showLoadingIndicator(false);
    });
    webview.addEventListener("did-fail-load", function (e) {
      if (-3 !== e.errorCode && e.isMainFrame) {
        self.showLoadingIndicator(false);
        self.displayErrorView();
        self.requestCommitPageLoad();
      }
    });
    webview.addEventListener("did-navigate-in-page", async function () {
      self.requestCommitPageLoad();
    });
    webview.addEventListener("page-favicon-updated", function (e) {
      const icon = self.selectFavicon(e.favicons);
      self.setFavicon(icon);
    });
    webview.addEventListener("page-title-updated", function (e) {
      self.leaf.tabHeaderInnerTitleEl.setText(e.title);
      self.title = e.title;
    });
    webview.addEventListener("context-menu", this.displayContextMenu.bind(this));
    webview.addEventListener("destroyed", function () {
      if (doc !== self.contentEl.doc) {
        webview.detach();
        self.instantiateWebView();
      }
    });
    if (doc.contains(this.contentEl)) {
      this.contentEl.appendChild(this.webview);
    } else {
      this.contentEl.onNodeInserted(function () {
        if (self.contentEl.doc === doc) self.contentEl.appendChild(self.webview);
        else self.instantiateWebView();
      }, true);
    }
  };
  WebviewerView.prototype.storeCurrentPageTitle = async function () {
    this.title = this.webview.getTitle();
  };
  WebviewerView.prototype.displayErrorView = function () {
    this.hideAll();
    this.mode = "error";
    this.errorView.show();
  };
  WebviewerView.prototype.displayWebView = function () {
    this.hideAll();
    this.mode = "webview";
    this.webview.show();
    this.renderer = null;
    this.app.workspace.requestSaveLayout();
  };
  WebviewerView.prototype.configureWebContents = function () {
    const self = this;
    const contents = s30We().electron.remote.webContents.fromId(this.webview.getWebContentsId());
    contents.noContextMenu = true;
    contents.on("before-input-event", function (event, input) {
      if ("keyDown" === input.type && !contents.isDestroyed()) {
        const handled = self.app.keymap.onKeyEvent(new KeyboardEvent("keydown", {
          code: input.code, key: input.key, shiftKey: input.shift, altKey: input.alt,
          ctrlKey: input.control, metaKey: input.meta, repeat: input.isAutoRepeat,
        }));
        contents.setIgnoreMenuShortcuts(!!handled);
      }
    });
    contents.on("input-event", function (event, input) {
      if ("mouseDown" === input.type) self.app.workspace.setActiveLeaf(self.leaf);
    });
  };
  WebviewerView.prototype.getReaderModeContent = async function () {
    const res = await fetch("/lib/readability.js");
    if (!res.ok) { new H.Notice(s30WvI18n().msgErrorExtractingContent()); return; }
    const src = await res.text();
    await this.webview.executeJavaScript(src);
    const expr = "new Readability(document.cloneNode(true)).parse()";
    let article;
    try {
      article = await this.webview.executeJavaScript(expr);
    } catch (e) {
      new H.Notice(s30WvI18n().msgErrorFindingContent());
      return;
    }
    if (!article || !article.content || "string" != typeof article.content) {
      new H.Notice(s30WvI18n().msgErrorFindingContent());
      return;
    }
    let title = article.title || article.siteName || "Untitled";
    if ("string" != typeof title) {
      console.error("Unexpected value when extracting site title");
      new H.Notice(s30WvI18n().msgErrorFindingContent());
      return;
    }
    title = s30We().s30VJ(title);
    const md = H.htmlToMarkdown(H.sanitizeHtml(article.content));
    return { md: md, title: title };
  };
  WebviewerView.prototype.displayReaderView = async function () {
    const content = await this.getReaderModeContent();
    if (!content) return;
    const lineWidth = this.app.vault.getConfig("readableLineLength");
    this.readerView.toggleClass("is-readable-line-width", lineWidth);
    if (!this.renderer) {
      this.readerView.empty();
      this.renderer = new H.MarkdownPreviewRenderer(this, this, this.readerView, "worker.js", false);
    }
    this.renderer.clear();
    this.renderer.set(content.md);
    this.hideAll();
    this.readerModeToggleBtn.addClass("mod-webviewer");
    this.readerView.show();
    this.mode = "reader";
    this.app.workspace.requestSaveLayout();
  };
  WebviewerView.prototype.displayBlank = function () {
    const self = this;
    this.hideAll();
    this.mode = "blank";
    this.titleContainerEl.win.setTimeout(function () { self.addressBar.focus(); }, 100);
    this.app.workspace.requestSaveLayout();
  };
  WebviewerView.prototype.hideAll = function () {
    this.readerModeToggleBtn.removeClass("mod-webviewer");
    this.closeSearch();
    this.webview.hide();
    this.errorView.hide();
    this.readerView.hide();
  };
  WebviewerView.prototype.saveAsMarkdown = async function () {
    const content = await this.getReaderModeContent();
    if (!content) return;
    let dir = this.plugin.options.markdownPath || "";
    if (dir) dir += "/";
    const path = this.app.vault.getAvailablePath(dir + content.title, "md");
    return this.app.vault.create(path, content.md);
  };
  WebviewerView.prototype.navigate = function (url, navigate) {
    const self = this;
    if (!url) return;
    if (this.webviewMounted) {
      if (url !== s30WebviewerBlankUrl) this.addressBar.setValue(url);
      if ("about:blank" === url) {
        this.url = "about:blank";
        this.displayBlank();
        return;
      }
      this.reportPageLoad(url, void 0, navigate);
      this.webview.stop();
      this.webview.loadURL(url).then(function () {
        if ("webview" !== self.mode && "reader" !== self.mode) self.displayWebView();
      }).catch(function () {});
    } else {
      this.loadFirstPage = function () { self.navigate(url, navigate); };
    }
  };
  WebviewerView.prototype.pushViewStackHistory = function (title) {
    const prevUrl = this.url;
    const prevTitle = this.title;
    const last = this.leaf.history.backHistory.last();
    const prevState = last == null ? void 0 : last.state.state;
    if (this.url === title || (prevState && prevState.url === prevUrl)) return;
    this.leaf.recordHistory({
      title: prevTitle, icon: "globe-2",
      state: { state: { url: prevUrl }, type: "webviewer" }, eState: null,
    });
  };
  WebviewerView.prototype.selectFavicon = function (favicons) {
    if (0 === favicons.length) return;
    if (1 === favicons.length) return favicons[0];
    let best = favicons[0], bestSize = 0;
    const re = /(\d+)x\d+/;
    for (const icon of favicons) {
      const m = icon.match(re);
      if (m) {
        const size = Number.parseInt(m[1]);
        if (32 === size) return icon;
        if (size > bestSize) { bestSize = size; best = icon; }
      }
    }
    return best;
  };
  WebviewerView.prototype.setFavicon = async function (url) {
    if (url && this.faviconUrl === url) return;
    this.faviconUrl = url;
    if (!this.faviconImgEl) this.faviconImgEl = createDiv("webviewer-favicon-container");
    const pageUrl = this.webview.src;
    if (!pageUrl) return;
    await this.plugin.db.setIcon(this.faviconImgEl, pageUrl, url);
    this.leaf.tabHeaderInnerIconEl.empty();
    this.leaf.tabHeaderInnerIconEl.appendChild(this.faviconImgEl);
  };
  WebviewerView.prototype.contextMenuItemsForLink = function (url, linkText) {
    const self = this;
    const open = function (where) {
      self.app.workspace.getLeaf(where).setViewState({ type: s30WebviewerViewType, active: true, state: { url: url } });
    };
    const items = [
      { label: s30WvI18n().actionOpenLink(), click: function () { open(); } },
      { label: s30WvI18n().actionOpenLinkNewTab(), click: function () { open("tab"); } },
      { label: s30WvI18n().actionOpenLinkNewSplit(), click: function () { open("split"); } },
      { label: s30WvI18n().actionOpenLinkNewWindow(), click: function () { open("window"); } },
      { label: s30WvI18n().actionOpenLinkDefaultBrowser(), click: function () { window.open(url, "_external"); } },
      { type: "separator" },
      { label: s30WvI18n().actionCopyLinkAddress(), click: function () { navigator.clipboard.writeText(url); } },
    ];
    const bookmarks = this.app.internalPlugins.getEnabledPluginById("bookmarks");
    if (bookmarks) {
      items.push({
        label: s30WvI18n().actionBookmarkLink(),
        click: function () {
          const item = s30We().s30R2(url);
          new (s30We().s30RJ)(bookmarks, item, false).open();
        },
      });
    }
    return items;
  };
  WebviewerView.prototype.contextMenuItemsForSelection = function (text, isEditable) {
    const self = this;
    const items = [
      {
        label: s30WvI18n().actionSearchForQuery({ query: s30We().gc(text, 15) }),
        click: function () {
          const q = encodeURIComponent(text);
          const url = self.plugin.getSearchEngineUrl(q);
          self.app.workspace.getLeaf("tab").setViewState({ type: s30WebviewerViewType, active: true, state: { url: url } });
        },
      },
      {
        label: s30WvI18n().actionExtractSelection(),
        click: function () {
          return (async function () {
            const title = s30We().s30VJ(self.title);
            const path = self.app.vault.getAvailablePath(title, "md");
            await self.app.vault.create(path, text);
            self.app.workspace.openLinkText(path, "", true);
          })();
        },
      },
      { type: "separator" },
      { label: s30WvI18n().actionCopySelection(), accelerator: "CmdOrCtrl+C", role: "copy" },
    ];
    if (isEditable) {
      items.push(
        { label: s30WvI18n().actionCut(), accelerator: "CmdOrCtrl+X", role: "cut" },
        { label: s30WvI18n().actionPaste(), accelerator: "CmdOrCtrl+V", role: "paste" },
        { label: s30WvI18n().actionDelete(), accelerator: "Delete", role: "delete" },
        { label: s30WvI18n().actionSelectAll(), accelerator: "CmdOrCtrl+A", role: "selectAll" }
      );
    }
    return items;
  };
  WebviewerView.prototype.contextMenuItemsForImg = function (src) {
    const self = this;
    return [{
      label: s30WvI18n().actionSaveImage(),
      click: function () {
        return (async function () {
          const res = await s30We().s30hy(src);
          const name = s30We().s30VJ(decodeURIComponent(s30We().ou(src)));
          const ext = s30We().s30fu(res.headers["content-type"]) || s30We().su(src);
          const path = await self.app.vault.getAvailablePathForAttachments(name, ext, null);
          self.app.vault.createBinary(path, res.arrayBuffer);
          new H.Notice('Stored as "'.concat(path, '"'));
        })();
      },
    }, {
      label: s30We().gm.interface.menu.copyImage(),
      click: function () {
        return (async function () {
          const res = await s30We().s30hy(src);
          const data = res.arrayBuffer;
          const buf = s30We().s30vu(data);
          const img = s30We().electron.nativeImage.createFromBuffer(buf);
          s30We().s30Qf().writeImage(img);
        })();
      },
    }, {
      label: s30WvI18n().actionCopyImageLink(),
      click: function () { s30We().s30Qf().writeText(src); },
    }];
  };
  WebviewerView.prototype.displayContextMenu = function (e) {
    const self = this;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const params = e.params;
    const items = [];
    if (params.linkURL) items.push.apply(items, this.contextMenuItemsForLink(params.linkURL, params.linkText));
    if (params.selectionText) {
      if (items.length > 0) items.push({ type: "separator" });
      items.push.apply(items, this.contextMenuItemsForSelection(params.selectionText, params.isEditable));
    } else if (params.isEditable) {
      if (items.length > 0) items.push({ type: "separator" });
      items.push({ label: s30WvI18n().actionPaste(), role: "paste" }, { label: s30WvI18n().actionSelectAll(), role: "selectAll" });
    }
    if ("image" === params.mediaType && params.srcURL) {
      if (items.length > 0) items.push({ type: "separator" });
      items.push.apply(items, this.contextMenuItemsForImg(params.srcURL));
    }
    if (!params.selectionText && "none" === params.mediaType && !params.linkURL) {
      if (items.length > 0) items.push({ type: "separator" });
      items.push(
        { label: s30WvI18n().actionBackward(), enabled: this.leaf.history.backHistory.length > 0, click: function () { self.leaf.history.back(); } },
        { label: s30WvI18n().actionForward(), enabled: this.leaf.history.forwardHistory.length > 0, click: function () { self.leaf.history.forward(); } },
        { label: s30WvI18n().actionReload(), click: function () { self.webview.reload(); } }
      );
      const bookmarks = this.app.internalPlugins.getEnabledPluginById("bookmarks");
      if (bookmarks) {
        items.push({
          label: s30WvI18n().actionBookmarkPage(),
          click: function () {
            const item = s30We().s30R2(self.url, self.title);
            new (s30We().s30RJ)(bookmarks, item, false).open();
          },
        });
      }
      items.push(
        { label: s30WvI18n().actionOpenDefaultBrowser(), click: function () { window.open(self.url, "_external"); } },
        { label: s30WvI18n().actionSelectAll(), accelerator: "CmdOrCtrl+A", role: "selectAll" }
      );
    }
    const menu = s30We().electron.remote.Menu.buildFromTemplate(items);
    const win = this.webview.win.electronWindow;
    menu.popup({ window: win });
  };
  WebviewerView.prototype.showSearch = function () {
    const self = this;
    if ("reader" === this.mode) {
      if (!this.searchReader) {
        this.searchReader = new H.DocumentSearch(this.scope, this.renderer, this.searchContainerEl, function () {
          self.replaceScope(null);
          self.searchReader = null;
        });
      }
      H.selectOnFocus(this.searchReader.searchInputEl);
      this.replaceScope(this.searchReader.scope);
    } else if ("webview" === this.mode) {
      if (!this.searchWebView) {
        this.searchWebView = new (s30We().s30qJ)(this.webview, this.searchContainerEl, function (scope) {
          return self.replaceScope(scope);
        });
      }
      this.searchWebView.show();
    }
  };
  WebviewerView.prototype.replaceScope = function (scope) {
    this.scope = scope || null;
  };
  WebviewerView.prototype.closeSearch = function () {
    if (this.searchReader) {
      this.searchReader.close();
      this.searchReader = null;
    }
    if (this.searchWebView) this.searchWebView.hide();
  };
  WebviewerView.prototype.onExternalLinkClick = function (e, sourcePath, href) {
    e.preventDefault();
    e.stopPropagation();
    this.navigate(href, true);
  };
  WebviewerView.prototype.onReaderModeContextMenu = function (e) {
    const self = this;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const items = [];
    const node = e.targetNode;
    if (node.instanceOf(HTMLElement)) {
      switch (node.nodeName) {
        case "A": {
          const href = node.getAttr("href");
          const text = node.innerText;
          items.push.apply(items, this.contextMenuItemsForLink(href, text));
          break;
        }
        case "IMG": {
          const src = node.getAttr("src");
          items.push.apply(items, this.contextMenuItemsForImg(src));
          break;
        }
      }
    }
    const selection = node.win.getSelection() == null ? void 0 : node.win.getSelection().toString();
    if (selection) {
      if (items.length > 0) items.push({ type: "separator" });
      items.push.apply(items, this.contextMenuItemsForSelection(selection));
    }
    if (0 === items.length) {
      const bookmarks = this.app.internalPlugins.getEnabledPluginById("bookmarks");
      if (bookmarks) {
        items.push({
          label: s30WvI18n().actionBookmarkPage(),
          click: function () {
            const item = s30We().s30R2(self.url, self.title);
            new (s30We().s30RJ)(bookmarks, item, false).open();
          },
        });
      }
      items.push(
        { label: s30WvI18n().actionOpenDefaultBrowser(), click: function () { window.open(self.url, "_external"); } },
        {
          label: s30WvI18n().actionSelectAll(), accelerator: "CmdOrCtrl+A",
          click: function () {
            const win = self.renderer.previewEl.win;
            const sel = win.getSelection();
            const range = win.document.createRange();
            range.selectNodeContents(self.renderer.previewEl);
            sel.removeAllRanges();
            sel.addRange(range);
          },
        }
      );
    }
    const menu = s30We().electron.remote.Menu.buildFromTemplate(items);
    const win = node.win.electronWindow;
    menu.popup({ window: win });
  };
  WebviewerView.prototype.onCheckboxClick = function () {};
  WebviewerView.prototype.onFoldChange = function () {};
  WebviewerView.prototype.onScroll = function () {};
  WebviewerView.prototype.postProcess = function () {};
  WebviewerView.prototype.onRenderComplete = function () {};
  WebviewerView.prototype.onInternalLinkClick = function () {};
  WebviewerView.prototype.onInternalLinkRightClick = function () {};
  WebviewerView.prototype.onInternalLinkDrag = function () {};
  WebviewerView.prototype.onInternalLinkMouseover = function () {};
  WebviewerView.prototype.onTagClick = function () {};
  WebviewerView.prototype.onExternalLinkRightClick = function () {};

  // -- settings tab ------------------------------------------------------------

  function WebviewerSettingTab(containerEl, plugin, instance) {
    const self = H.PluginInstanceSettingTab.call(this, containerEl, plugin) || this;
    self.icon = "globe-2";
    self.instance = instance;
    return self;
  }
  inherit(WebviewerSettingTab, H.PluginInstanceSettingTab);
  WebviewerSettingTab.prototype.display = function () {
    const self = this;
    const options = this.instance.options;
    this.containerEl.empty();
    let customSearch;
    const isCustom = "custom" === options.searchEngine;
    const adblockLists = s30We().electron.ipcRenderer.sendSync("adblock-lists");
    const adblockFreq = s30We().electron.ipcRenderer.sendSync("adblock-frequency");
    new H.SettingGroup(this.containerEl)
      .addSetting(function (s) {
        return s.setName(s30WvI18n().optionOpenExternalLinks()).setDesc(s30WvI18n().optionOpenExternalLinksDesc()).addToggle(function (t) {
          t.setValue(options.openExternalURLs).onChange(function (v) {
            options.openExternalURLs = v;
            self.plugin.saveData(options);
          });
        });
      })
      .addSetting(function (s) {
        return s.setName(s30WvI18n().optionHomepage()).setDesc(s30WvI18n().optionHomepageDesc()).addText(function (t) {
          t.setValue(options.homepage).onChange(function (v) {
            options.homepage = v;
            self.plugin.saveData(options);
          });
        });
      })
      .addSetting(function (s) {
        return s.setName(s30WvI18n().optionSavedMarkdown()).setDesc(s30WvI18n().optionSavedMarkdownDesc()).addText(function (t) {
          t.setPlaceholder(s30We().gm.setting.folderPathExamplePlaceholder()).setValue(options.markdownPath).onChange(function (v) {
            options.markdownPath = v.trim();
            self.plugin.saveData(options);
          });
        }, new H.FolderPathSuggestTab(self.app, t.inputEl));
      })
      .addSetting(function (group) {
        return group.setName(s30WvI18n().optionSearchEngine()).setDesc(s30WvI18n().optionSearchEngineDesc()).addDropdown(function (dd) {
          for (const entry of Object.entries(s30SearchEngines)) {
            const id = entry[0], engine = entry[1];
            const label = "custom" === engine.display ? s30WvI18n().optionSearchEngineCustomDropDown() : engine.display;
            dd.addOption(id, label);
          }
          dd.setValue(options.searchEngine || s30DefaultSearchEngine).onChange(function (v) {
            if ("custom" === v && !options.customSearchEngine) options.customSearchEngine = s30SearchEngines[s30DefaultSearchEngine].url;
            customSearch.setVisibility("custom" === v);
            options.searchEngine = v;
            self.plugin.saveData(options);
          });
        });
      })
      .addSetting(function (s) {
        customSearch = s;
        return s.setName(s30WvI18n().optionSearchEngineCustom()).setDesc(s30WvI18n().optionSearchEngineDesc()).setVisibility(isCustom).addText(function (t) {
          t.setValue(options.customSearchEngine || s30SearchEngines[s30DefaultSearchEngine].url).setPlaceholder(s30SearchEngines[s30DefaultSearchEngine].url);
          t.inputEl.addEventListener("blur", function () {
            const v = t.getValue();
            if (!v.includes("%s")) {
              H.displayTooltip(t.inputEl, 'Search engine URL must contain "%s"', { placement: "bottom", classes: ["mod-error"] });
              window.setTimeout(H.hideTooltip, 2000);
              t.setValue(options.customSearchEngine);
              return;
            }
            options.customSearchEngine = v;
            self.plugin.saveData(options);
          });
        });
      })
      .addSetting(function (s) {
        return s.setName(s30WvI18n().optionEnableAdblock()).setDesc(s30WvI18n().optionEnableAdblockDesc()).addToggle(function (t) {
          t.setValue(options.enableAdblocking).onChange(function (v) {
            options.enableAdblocking = v;
            self.plugin.saveData(options);
            self.instance.updateSession();
          });
        });
      })
      .addSetting(function (s) {
        return s.setName(s30WvI18n().optionAdblockLists()).setDisabled(options.enableAdblocking).setDesc(s30WvI18n().optionAdblockListsDesc()).addTextArea(function (t) {
          t.setValue(adblockLists.join("\n"));
          t.inputEl.addEventListener("blur", function () {
            const lines = t.inputEl.value.split("\n");
            s30We().electron.ipcRenderer.sendSync("adblock-lists", lines);
          });
          t.inputEl.addClass("webviewer-adblock-lists");
        });
      })
      .addSetting(function (s) {
        return s.setName(s30WvI18n().optionAdblockFrequency()).setDesc(s30WvI18n().optionAdblockFrequencyDesc()).addSlider(function (t) {
          t.setLimits(0, 24, 1).setValue(adblockFreq).setDynamicTooltip().onChange(function (v) {
            s30We().electron.ipcRenderer.sendSync("adblock-frequency", v);
          });
        });
      })
      .addSetting(function (s) {
        return s.setName(s30WvI18n().labelWebViewerData()).addButton(function (b) {
          b.setButtonText(s30WvI18n().labelClearData()).onClick(function () {
            new ClearDataModal(self.app, self.instance).open();
          });
        });
      });
  };

  // -- clear-data modal ---------------------------------------------------------

  function ClearDataModal(app, webviewer) {
    const self = H.DialogModal.call(this, app) || this;
    self.clearCookies = true;
    self.clearCache = true;
    self.clearHistory = true;
    self.clearAll = false;
    self.webviewer = webviewer;
    self.setTitle(s30WvI18n().titleClearDataModal());
    const content = self.contentEl;
    let cookiesToggle = null;
    const cookiesSetting = new H.Setting(content)
      .setName(s30WvI18n().actionClearDataCookies()).setDesc(s30WvI18n().actionClearDataCookiesDesc())
      .addToggle(function (t) {
        cookiesToggle = t;
        t.setValue(self.clearCookies).onChange(function (v) { self.clearCookies = v; });
      });
    let cacheToggle = null;
    const cacheSetting = new H.Setting(content)
      .setName(s30WvI18n().actionClearDataCache())
      .addToggle(function (t) {
        cacheToggle = t;
        t.setValue(self.clearCache).onChange(function (v) { self.clearCache = v; });
      });
    let historyToggle = null;
    const historySetting = new H.Setting(content)
      .setName(s30WvI18n().actionClearDataHistory())
      .addToggle(function (t) {
        historyToggle = t;
        t.setValue(self.clearHistory).onChange(function (v) { self.clearAll = v; });
      });
    new H.Setting(content)
      .setName(s30WvI18n().actionClearDataAll()).setDesc(s30WvI18n().actionClearDataAllDesc())
      .addToggle(function (t) {
        t.setValue(self.clearAll).onChange(function (v) {
          self.clearAll = v;
          cookiesSetting.setDisabled(v);
          cacheSetting.setDisabled(v);
          historySetting.setDisabled(v);
          if (v) {
            cookiesToggle.setValue(true);
            cacheToggle.setValue(true);
            historyToggle.setValue(true);
          }
        });
      });
    self.addButton("mod-warning", s30WvI18n().actionClearData(), self.performClearData.bind(self));
    self.addCancelButton();
    return self;
  }
  inherit(ClearDataModal, H.DialogModal);
  ClearDataModal.prototype.performClearData = async function () {
    const storages = [];
    if (this.clearAll) {
      storages.push("cookies", "filesystem", "indexdb", "localstorage", "shadercache", "websql", "serviceworkers", "cachestorage");
    } else {
      if (this.clearCookies) storages.push("cookies");
      if (this.clearCache) storages.push("cachestorage");
    }
    if (storages.length > 0) {
      const session = s30We().electron.remote.session.fromPartition(this.app.getWebviewPartition());
      await session.clearStorageData({ storages: storages });
      if (this.clearAll) await session.clearData();
    }
    if (this.clearHistory) await this.webviewer.db.clearHistoryItems();
    this.close();
  };

  // -- search-the-web modal ------------------------------------------------------

  function WebviewerSearchModal(app, webviewer) {
    const self = H.Modal.call(this, app) || this;
    self.inputEl = null;
    self.webviewer = webviewer;
    const modalEl = self.modalEl;
    modalEl.removeClass("modal");
    modalEl.addClass("prompt");
    modalEl.empty();
    modalEl.createDiv("prompt-input-container", function (el) {
      self.inputEl = el.createEl("input", { cls: "prompt-input", type: "text", placeholder: s30WvI18n().labelSearchTheWeb() });
    });
    self.inputEl.addEventListener("keydown", function (e) {
      if ("Enter" === e.key) {
        const url = self.webviewer.getSearchEngineUrl(self.inputEl.value);
        self.app.workspace.getLeaf("tab").setViewState({ type: s30WebviewerViewType, active: true, state: { url: url, navigate: true } });
        self.close();
      }
    });
    return self;
  }
  inherit(WebviewerSearchModal, H.Modal);

  // -- the plugin ------------------------------------------------------------------

  function WebviewerPlugin() {
    this.id = "webviewer";
    this.name = s30WvI18n().name();
    this.description = s30WvI18n().desc();
    this.defaultOn = false;
  }

  WebviewerPlugin.prototype.init = function (app, plugin) {
    const self = this;
    this.app = app;
    this.plugin = plugin;
    this.db = new WebviewerDb(app);
    plugin.registerGlobalCommand({
      id: "webviewer:open", name: s30WvI18n().actionOpen(),
      callback: function () {
        self.app.workspace.getLeaf(true).setViewState({ type: s30WebviewerViewType, active: true, state: { url: self.options.homepage || "about:blank" } });
      },
    });
    plugin.registerGlobalCommand({
      id: "webviewer:open-history", name: s30WvI18n().actionShowHistory(), icon: "lucide-clock",
      callback: function () { self.app.workspace.ensureSideLeaf(s30WebviewerHistoryViewType, "left", { active: true }); },
    });
    plugin.registerGlobalCommand({
      id: "webviewer:toggle-reader-mode", name: s30WvI18n().actionToggleReaderMode(), icon: "glasses",
      checkCallback: function (e) {
        const view = self.app.workspace.getActiveViewOfType(WebviewerView);
        if (!view) return false;
        if (!e) view.toggleReaderMode();
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "webviewer:focus-address-bar", name: s30WvI18n().actionFocusAddressBar(), icon: "text-cursor-input",
      checkCallback: function (e) {
        const view = self.app.workspace.getActiveViewOfType(WebviewerView);
        if (!view) return false;
        if (!e) view.addressBar.focus();
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "webviewer:zoom-in", name: s30We().gm.commands.zoomIn(), icon: "zoom-in",
      checkCallback: function (e) {
        const view = self.app.workspace.getActiveViewOfType(WebviewerView);
        if (!view) return false;
        if (!e) view.zoomIn();
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "webviewer:zoom-reset", name: s30We().gm.commands.resetZoom(), icon: "rotate-cw",
      checkCallback: function (e) {
        const view = self.app.workspace.getActiveViewOfType(WebviewerView);
        if (!view) return false;
        if (!e) view.zoomReset();
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "webviewer:zoom-out", name: s30We().gm.commands.zoomOut(), icon: "zoom-in",
      checkCallback: function (e) {
        const view = self.app.workspace.getActiveViewOfType(WebviewerView);
        if (!view) return false;
        if (!e) view.zoomOut();
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "webviewer:search", name: s30WvI18n().actionSearchTheWeb(), icon: "search",
      callback: function () { new WebviewerSearchModal(self.app, self).open(); },
    });
    plugin.registerGlobalCommand({
      id: "webviewer:save-to-vault", name: s30WvI18n().actionSaveToVault(), icon: "lucide-file-down",
      checkCallback: function (e) {
        const view = self.app.workspace.getActiveViewOfType(WebviewerView);
        if (!view) return false;
        if (!e) {
          view.saveAsMarkdown().then(function (file) {
            if (file) self.app.workspace.getLeaf("tab").openFile(file);
          });
        }
        return true;
      },
    });
    plugin.registerViewType(s30WebviewerViewType, function (leaf) { return new WebviewerView(leaf, self); });
    plugin.registerViewType(s30WebviewerHistoryViewType, function (leaf) { return new WebviewerHistoryView(leaf, self); });
  };

  WebviewerPlugin.prototype.onEnable = async function (app, plugin) {
    const self = this;
    plugin.registerEvent(this.app.workspace.on("url-menu", this.onUrlMenu, this));
    const onOpenUrl = this.handleOpenUrl.bind(this);
    window.addEventListener("open-url", onOpenUrl);
    plugin.register(function () { window.removeEventListener("open-url", onOpenUrl); });
    this.options = Object.assign(s30WebviewerDefaultOptions, await plugin.loadData());
    plugin.addSettingTab(new WebviewerSettingTab(this.app, plugin, this));
    this.updateSession();
    this.db.connect();
    plugin.registerCliHandler("web", "Open URL in web viewer", {
      url: { value: "<url>", description: "URL to open", required: true },
      newtab: { description: "Open in new tab" },
    }, function (args) {
      if (!args.url) throw "Missing required parameter: url\nUsage: web url=<url>";
      let url = args.url;
      if (!url.includes("://")) url = "https://" + url;
      self.openUrl(url, !!args.newtab);
      return "Opened: ".concat(url);
    });
  };

  WebviewerPlugin.prototype.saveOptions = async function () {
    await this.plugin.saveData(this.options);
  };
  WebviewerPlugin.prototype.onUrlMenu = function (menu, url) {
    const self = this;
    menu.addItem(function (item) {
      return item.setTitle(s30We().gm.plugins.webViewer.actionOpenLinkWebViewer()).setIcon("lucide-globe-2").setSection("open").onClick(function (e) {
        self.openUrl(url, H.Keymap.isModEvent(e));
      });
    });
  };
  WebviewerPlugin.prototype.getSearchEngineUrl = function (query) {
    let url;
    if ("custom" === this.options.searchEngine) {
      url = this.options.customSearchEngine;
    } else {
      const engine = s30SearchEngines[this.options.searchEngine];
      url = engine == null ? void 0 : engine.url;
    }
    if (!url) url = s30SearchEngines[s30DefaultSearchEngine].url;
    return url.replace("%s", encodeURIComponent(query));
  };
  WebviewerPlugin.prototype.updateSession = function () {
    s30We().electron.ipcRenderer.send("create-browser-session", this.app.getWebviewPartition(), this.options.enableAdblocking);
  };
  WebviewerPlugin.prototype.handleOpenUrl = function (e) {
    if (this.options.openExternalURLs) {
      const detail = e.detail;
      const url = detail.url, leaf = detail.leaf, active = detail.active;
      let where = null !== s30We().activeDocument.querySelector(".modal-container") ? "window" : leaf;
      e.preventDefault();
      this.openUrl(url, where, active);
    }
  };
  WebviewerPlugin.prototype.openUrl = function (url, where, active) {
    if (void 0 === active) active = true;
    const leaf = this.app.workspace.getLeaf(where);
    if (leaf == null) return;
    leaf.setViewState({ type: s30WebviewerViewType, active: active, state: { url: url, title: url, navigate: true } });
  };

  s30Wv = {
    a2: WebviewerDb,
    v2: WebviewerHistoryView,
    g2: WebviewerHistoryItem,
    M2: WebviewerPlugin,
    S2: WebviewerSettingTab,
    x2: ClearDataModal,
    T2: WebviewerSearchModal,
    P2: WebviewerView,
  };
  return s30Wv;
}

export function defineWebviewerDb(host) { return s30WebviewerClasses(host).a2; }
export function defineWebviewerHistoryView(host) { return s30WebviewerClasses(host).v2; }
export function defineWebviewerHistoryItem(host) { return s30WebviewerClasses(host).g2; }
export function defineWebviewerPlugin(host) { return s30WebviewerClasses(host).M2; }
export function defineWebviewerSettingTab(host) { return s30WebviewerClasses(host).S2; }
export function defineWebviewerClearDataModal(host) { return s30WebviewerClasses(host).x2; }
export function defineWebviewerSearchModal(host) { return s30WebviewerClasses(host).T2; }
export function defineWebviewerView(host) { return s30WebviewerClasses(host).P2; }
