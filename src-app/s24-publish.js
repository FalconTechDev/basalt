// Slice s24 — published-site runtime: the site info object (bX), the search
// view (lX) and the Publish app class itself (yX, exposed to plugins as
// `Publish`). s09 already owns the site cache, nav/outline/graph views, the
// page renderer and the password modal; this file wires them together and adds
// the remaining pieces. App internals come through env() / __basaltHost; the
// crypto-js helpers (WY/GY) and the CodeMirror tooltip/placeholder extensions
// (Ja/Ua) are bound lazily through envBind.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { defineFileQueue } from "./n-g11-view.js";
import { defineSuggestionList } from "./suggest.js";
import { sortHitsByScore, shiftRanges } from "./misc.js";
import { mergeSpans, containsAllWords, simpleMatch, renderMatches, renderResults } from "./search-simple.js";
import { contextLineBounds } from "./n-g11-view.js";
import { s04CreateDeferred } from "./s04-themes.js";
import { s05InlineText } from "./s05-utils.js";
import { frontmatterBounds } from "./notes-utils.js";
import { frontmatterAliases } from "./frontmatter.js";
import { lastSegment, extensionOf, displayName, withoutExtension, parseLinktext, formDecode, formEncode } from "./path.js";
import { linkSafeHeading } from "./text.js";
import { s09PublishSiteCache, s09PublishNavView, s09PublishPageView, s09PublishGraphView, s09PublishOutlineView, s09PublishPasswordModal, s09PublishDefaults, s09PubOptIndexFile, s09PubOptSiteName, s09PubOptLogo, s09PubOptNoindex, s09PubOptDefaultTheme, s09PubOptShowThemeToggle, s09PubOptShowNavigation, s09PubOptShowGraph, s09PubOptShowOutline, s09PubOptShowSearch, s09PubOptGoogleAnalytics, s09PubOptReadableLineLength, s09PubOptStrictLineBreaks, s09PubOptSlidingWindowMode } from "./s09-publish.js";
import { s10PublishPaneMinWidth, s10PublishPaneOffset, s10BasaltCssName, s10PublishCssName, s10PublishJsName, s10FaviconPattern } from "./s10-consts.js";
import { s10ResponseHasObsStatus, s10XhrHasObsStatus, s10PromotePreloadStyles } from "./s10-app.js";

const s24PCache = {};
function s24POnce(key, build) { return s24PCache[key] ??= build(); }


// ---------------------------------------------------------------- `var bX` — published site descriptor

function s24buildPublishSite() {
  const SiteCache = s09PublishSiteCache();
  const defaults = s09PublishDefaults();
  function PublishSite(publish, siteInfo) {
    this.pwts = 0;
    this.pwsig = "";
    this.options = {};
    this.publish = publish;
    this.id = siteInfo.uid;
    const hostName = siteInfo.host;
    this.host = hostName.startsWith("127.0.0.1") || hostName.startsWith("localhost")
      ? "http://" + hostName : "https://" + hostName;
    this.status = siteInfo.status;
    this.slug = siteInfo.slug;
    this.customurl = siteInfo.customurl;
    this.hpw = localStorage[siteInfo.uid];
    this.cache = new SiteCache();
    this.customurl
      ? this.pathprefix = "https://" + this.customurl + "/"
      : this.pathprefix = this.publish.origin + "/" + encodeURIComponent(this.slug) + "/";
  }
  PublishSite.prototype.loadCache = async function () {
    const preload = window.preloadCache;
    if (preload) {
      try {
        delete window.preloadCache;
        const res = await preload;
        if (res.ok && s10ResponseHasObsStatus(res)) {
          const data = await res.json();
          await this.cache.load(data);
          return;
        }
      } catch (e) { /* fall through to the network fetch */ }
    }
    const req = { withCredentials: true, url: this.host + "/cache/" + encodeURIComponent(this.id) + this.getPathSuffix() };
    const text = await ajaxPromise(req);
    if (s10XhrHasObsStatus(req.req)) await this.cache.load(JSON.parse(text));
  };
  PublishSite.prototype.loadOptions = async function () {
    const preload = window.preloadOptions;
    if (preload) {
      try {
        delete window.preloadOptions;
        const res = await preload;
        if (res.ok && s10ResponseHasObsStatus(res)) {
          this.options = await res.json();
          return;
        }
      } catch (e) { /* fall through to the network fetch */ }
    }
    try {
      const req = { withCredentials: true, url: this.host + "/options/" + encodeURIComponent(this.id) };
      const text = await ajaxPromise(req);
      if (s10XhrHasObsStatus(req.req)) this.options = JSON.parse(text);
    } catch (e) {
      console.error("Failed to load options", e);
    }
  };
  PublishSite.prototype.getPathSuffix = function () {
    const pw = this.hpw;
    if (!pw) return "";
    let ts = this.pwts, sig = this.pwsig;
    const now = Date.now(), windowMs = 36e5;
    if (ts + windowMs < now) {
      ts = this.pwts = Math.floor(now / windowMs + 6) * windowMs;
      sig = this.pwsig = env().WY().stringify(env().GY()(String(ts), pw));
    }
    return "?ts=" + String(ts) + "&sig=" + sig;
  };
  PublishSite.prototype.isCustomDomain = function () { return !!this.customurl; };
  PublishSite.prototype.getConfig = function (key) {
    const value = this.options[key];
    return value === undefined ? defaults[key] : value;
  };
  PublishSite.prototype.getSiteName = function () { return this.getConfig(s09PubOptSiteName) || this.slug || ""; };
  PublishSite.prototype.getSiteLogoUrl = function () { return this.getConfig(s09PubOptLogo) || ""; };
  PublishSite.prototype.encodeFilepath = function (path, encode) {
    return path.split("/").map(encode ? formEncode : encodeURIComponent).join("/");
  };
  PublishSite.prototype.getInternalUrl = function (path) {
    return this.host + "/access/" + encodeURIComponent(this.id) + "/"
      + this.encodeFilepath(path, false) + this.getPathSuffix();
  };
  PublishSite.prototype.getPublicHref = function (path) {
    const entry = this.cache.getCache(path);
    if (extensionOf(lastSegment(path)) === "md") path = path.substr(0, path.length - 3);
    let href = this.encodeFilepath(path, true);
    const permalink = entry === null || entry === undefined ? undefined : entry.frontmatter?.permalink;
    if (permalink && typeof permalink === "string") {
      if (permalink.startsWith("/")) href = permalink.substring(1);
      else href = permalink;
    }
    return this.pathprefix + href;
  };
  PublishSite.prototype.loadMarkdownFile = async function (path) {
    const url = this.getInternalUrl(path);
    const preload = window.preloadPage;
    if (preload) {
      try {
        delete window.preloadPage;
        const res = await preload;
        if (res.ok && res.url === url) return await res.text();
      } catch (e) { /* fall through */ }
    }
    return await ajaxPromise({ withCredentials: true, url });
  };
  return PublishSite;
}

// ---------------------------------------------------------------- `var lX` — publish search view

function s24buildPublishSearch(host) {
  const Scope = env().Ng;
  const SuggestionList = defineSuggestionList(host);
  const FileQueue = defineFileQueue();

  function PublishSearch(publish) {
    const self = this;
    this.renderQueue = new FileQueue();
    this.requestUpdateSearch = debounceCall(this.updateSearch.bind(this), 200, true);
    this.query = "";
    this.queryWords = [];
    this.runFullSearch = debounceCall(async (queryText, words, deferred) => {
      const input = this.inputEl;
      const req = {
        url: this.publish.site.host + "/search",
        method: "POST",
        withCredentials: true,
        data: { id: this.publish.site.id, query: words },
      };
      let result;
      for (let attempt = 1; attempt <= 3; attempt++) {
        if (input.value !== queryText) return;
        try {
          result = await ajaxPromise(req);
          break;
        } catch (err) {
          console.error(err);
          await env().sleep(5000 * attempt);
        }
      }
      if (input.value === queryText) deferred.resolve(result ? JSON.parse(result).results : null);
    }, 500);
    this.publish = publish;

    const outer = this.outerContainerEl = createDiv("search-view-outer");
    const container = this.containerEl = outer.createDiv("search-view-container");
    container.createSpan("published-search-icon", (el) => env().tv(el, "lucide-search"));
    const input = this.inputEl = container.createEl("input", { cls: "search-bar", type: "text", attr: { tabIndex: 0 } });
    input.setAttribute("placeholder", "Search page or heading...");
    this.resultEl = createDiv("search-results");
    const scope = this.scope = new Scope();
    this.chooser = new SuggestionList(this, this.resultEl, scope);
    publish.on("options-updated", this.updateOptions.bind(this));
    input.addEventListener("input", () => {
      self.renderQueue.clear();
      self.runFullSearch.cancel();
      self.requestUpdateSearch();
    });
    input.addEventListener("keydown", this.onKeydown.bind(this));
    document.addEventListener("click", this.onDocumentClick.bind(this));

    // background queue: render file snippets one at a time without blocking input
    (async () => {
      for await (const item of this.renderQueue.generator()) {
        try { await item(); } catch (err) { console.error(err); }
      }
    })();
  }

  PublishSearch.prototype.onDocumentClick = function (e) {
    if (e.defaultPrevented) return;
    this.resultEl.remove();
    this.renderQueue.clear();
    this.runFullSearch.cancel();
  };

  PublishSearch.prototype.updateOptions = function () {
    let show = this.publish.site.getConfig(s09PubOptShowSearch);
    if (env().Fc) show = false;
    this.outerContainerEl.toggle(show);
  };

  PublishSearch.prototype.updateSearch = async function () {
    const resultEl = this.resultEl, input = this.inputEl, chooser = this.chooser;
    const query = input.value;
    resultEl.empty();
    this.renderQueue.clear();
    this.query = query;
    const words = [];
    const parts = query.toLowerCase().split('"');
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) words.push(...parts[i].split(" "));
      else words.push(parts[i]);
    }
    const trimmed = words.map((w) => w.trim()).filter((w) => !!w);
    this.queryWords = trimmed;
    if (!query) {
      input.removeClass("has-no-results");
      resultEl.detach();
      return;
    }
    const hits = this.getCachedResults();
    sortHitsByScore(hits);
    const top = hits.slice(0, 30);
    chooser.setSuggestions(top.slice());
    document.body.appendChild(resultEl);
    const isRtl = getComputedStyle(input).direction === "rtl";
    const position = () => {
      env().Nv(input.getBoundingClientRect(), resultEl, {
        gap: 5, horizontalAlignment: isRtl ? "right" : "left", preventOverlap: true,
      });
    };
    position();
    const full = s04CreateDeferred();
    const message = chooser.addMessage("Searching...");
    this.runFullSearch(query, trimmed, full);
    const remote = await full.promise;
    if (remote) {
      const known = new Set(top.filter((h) => h.type === "file").map((h) => h.path));
      for (const raw of remote) {
        if (top.length >= 30) break;
        const path = withoutExtension(raw);
        if (known.has(path)) continue;
        const hit = { type: "file", path, match: { score: 0, matches: [] } };
        top.push(hit);
        chooser.addSuggestion(hit);
      }
    }
    const none = top.length === 0;
    input.toggleClass("has-no-results", none);
    if (none) message.setText("No results found.");
    else message.detach();
    position();
  };

  PublishSearch.prototype.getCachedResults = function () {
    const query = this.query, words = this.queryWords, cache = this.publish.site.cache;
    const hits = [];
    for (const path in cache.cache) {
      if (!cache.cache.hasOwnProperty(path) || extensionOf(path) !== "md") continue;
      const noExt = withoutExtension(path);
      const base = lastSegment(noExt);
      const fileMatch = simpleMatch(words, query, base);
      const pathMatch = simpleMatch(words, query, noExt);
      if (fileMatch) {
        fileMatch.score += 0.8;
        shiftRanges(fileMatch.matches, noExt.length - base.length);
        hits.push({ type: "file", path: noExt, match: fileMatch });
      } else if (pathMatch) {
        pathMatch.score += 0.5;
        hits.push({ type: "file", path: noExt, match: pathMatch });
      }
      const entry = cache.getCache(path);
      if (entry) {
        const aliases = frontmatterAliases(entry.frontmatter);
        if (aliases) {
          for (const alias of aliases) {
            const m = simpleMatch(words, query, alias);
            if (m) hits.push({ type: "alias", alias, path: noExt, match: m });
          }
        }
        if (entry.headings) {
          for (const heading of entry.headings) {
            const m = simpleMatch(words, query, heading.heading);
            if (m) hits.push({ type: "heading", path: noExt, heading, match: m });
          }
        }
      }
    }
    return hits;
  };

  PublishSearch.prototype.onKeydown = function (e) {
    if (this.inputEl !== document.activeElement) return;
    const info = { modifiers: env().Bg.getModifiers(e), key: host.eventKey(e), vkey: host.eventVirtualKey(e) };
    this.scope.handleKey(e, info);
  };

  PublishSearch.prototype.renderSuggestion = function (item, el) {
    el.addClass("mod-complex");
    const content = el.createDiv("suggestion-content");
    const aux = el.createDiv("suggestion-aux");
    const title = content.createDiv("suggestion-title");
    const note = content.createDiv("suggestion-note");
    if (item.type === "file") {
      const path = item.path;
      const base = lastSegment(path);
      const folder = path.substr(0, path.length - base.length - 1);
      renderResults(note, folder, item.match);
      renderResults(title, base, item.match, base.length - path.length);
      if (this.inputEl.value.length <= 2) return;
      this.renderQueue.add(async () => {
        const markdown = await this.publish.site.loadMarkdownFile(path + ".md");
        const body = markdown.substring(frontmatterBounds(markdown).contentStart);
        const text = s05InlineText(env().Kx(body));
        const span = containsAllWords(this.queryWords, text);
        if (span) {
          const regions = span.map((r) => contextLineBounds(text, r, 50)).map((r) => [r[0], r[1]]);
          const merged = mergeSpans(regions);
          let shown = 0;
          for (const [from, to] of merged) {
            let start = from, end = to;
            for (let i = 0; i < 30 && start <= end
              && !(text.charAt(start - 1) === "\n" || env().Cy.test(text.charAt(start - 1))
                || env().ky.test(text.charAt(start - 1)) || env().Ey.test(text.charAt(start - 1))); i++) start++;
            if (end < text.length - 1) {
              for (let i = 0; i < 30 && start <= end
                && !(text.charAt(end) === "\n" || env().Cy.test(text.charAt(end))
                  || env().ky.test(text.charAt(end)) || env().Ey.test(text.charAt(end))); i++) end++;
            }
            const detail = createDiv("suggestion-detail");
            if (start > 0 && text.charAt(start - 1) !== "\n") detail.appendText("...");
            renderMatches(detail, text.substring(start, end), span, -start);
            if (end < text.length - 1 && text.charAt(end) !== "\n") detail.appendText("...");
            content.insertBefore(detail, note);
            if (++shown >= 3) break;
          }
        }
        await env().sleep(100);
      });
    } else if (item.type === "alias") {
      renderResults(title, item.alias, item.match);
      note.setText(item.path);
      aux.createSpan({ cls: "suggestion-flair", prepend: true }, (flair) => {
        env().tv(flair, "lucide-forward");
        env().Mv(flair, "Alias");
      });
    } else if (item.type === "heading") {
      renderResults(title, item.heading.heading, item.match);
      note.setText(item.path);
      aux.createSpan({ cls: "suggestion-flair", text: "H", prepend: true });
    }
  };

  PublishSearch.prototype.selectSuggestion = function (item, evt) {
    if (item.type === "file" || item.type === "alias") {
      this.publish.navigate(item.path, "", evt instanceof MouseEvent ? evt : null);
    } else if (item.type === "heading") {
      this.publish.navigate(item.path + "#" + linkSafeHeading(item.heading.heading), "",
        evt instanceof MouseEvent ? evt : null);
    }
    this.inputEl.value = "";
    this.updateSearch();
    this.publish.containerEl.removeClass("is-left-column-open");
  };

  return PublishSearch;
}

// ---------------------------------------------------------------- `var yX` — the Publish app

function s24buildPublishApp(host) {
  const Base = env().VT;
  const Keymap = env().Bg;
  const PageView = s09PublishPageView();
  const GraphView = s09PublishGraphView();
  const OutlineView = s09PublishOutlineView();
  const NavView = s09PublishNavView();
  const PasswordModal = s09PublishPasswordModal();
  const PublishSite = s24POnce("s24PublishSite", s24buildPublishSite);
  const SearchView = s24POnce("s24PublishSearch", () => s24buildPublishSearch(host));
  const renderFlags = host.renderFlags;
  const markdownOptions = host.markdownOptions;

  function PublishApp() {
    const self = Base.call(this) || this;
    self.stack = [];
    self.origin = location.origin;
    self.slidingWindowMode = false;
    self.keymap = new Keymap();
    self.scope = self.keymap.getRootScope();

    const sandboxTokens = {
      "allow-downloads": true, "allow-forms": true, "allow-modals": true,
      "allow-orientation-lock": true, "allow-pointer-lock": true, "allow-popups": true,
      "allow-popups-to-escape-sandbox": true, "allow-presentation": true,
      "allow-same-origin": true, "allow-scripts": true,
    };
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.instanceOf(HTMLIFrameElement)) {
        if (node.hasAttribute("sandbox")) env().ML(node, "sandbox", " ", sandboxTokens);
        else node.setAttribute("sandbox", "allow-forms allow-modals allow-presentation allow-popups allow-same-origin allow-scripts");
      }
      if (node.instanceOf(HTMLAnchorElement)) {
        let rel = node.getAttribute("rel") || "";
        if (!rel.split(" ").contains("nofollow")) rel += " nofollow";
        if (node.hasClass("internal-link") && node.hasAttribute("data-href")
          && node.href.startsWith(self.site.pathprefix)) {
          rel = rel.replace("nofollow", "").trim();
        }
        node.setAttribute("rel", rel);
      }
    });

    // localStorage may be unavailable (e.g. blocked site data): fall back to an in-memory shim
    try {
      window.localStorage.setItem("basalt", "basalt");
      window.localStorage.removeItem("basalt");
    } catch (e) {
      const store = Object.defineProperties({}, {
        length: { get: function () { return Object.keys(this).length; } },
        clear: { value: function () { for (const k in this) if (Object.prototype.hasOwnProperty.call(this, k)) delete this[k]; } },
        getItem: { value: function (k) { return Object.prototype.hasOwnProperty.call(this, k) ? null : this[k]; } },
        key: {
          value: function (i) {
            const keys = Object.keys(this);
            return i < 0 || i >= keys.length ? null : keys[i];
          },
        },
        removeItem: { value: function (k) { if (!Object.prototype.hasOwnProperty.call(this, k)) delete this[k]; } },
        setItem: { value: function (k, v) { this[k] = v; } },
      });
      Object.defineProperty(window, "localStorage", { value: store });
    }

    renderFlags.progressiveRender = false;
    renderFlags.listBullet = false;
    if ("isBot" in window) renderFlags.asyncParse = false;
    if (!env().jl) document.body.addClass("styled-scrollbars");

    const noindex = self.noindexEl = createEl("meta");
    noindex.name = "robots";
    noindex.content = "noindex";

    const container = self.containerEl = document.body.createDiv("published-container print");
    container.hide();
    const body = container.createDiv("site-body");
    const leftColumn = body.createDiv("site-body-left-column");
    const leftInner = self.leftColumnInnerEl = leftColumn.createDiv("site-body-left-column-inner");
    const leftLogoLink = self.leftSiteHeaderLogoLinkEl = leftInner.createEl("a", "site-body-left-column-site-logo");
    const leftLogo = self.leftSiteHeaderLogoEl = leftLogoLink.createEl("img");
    leftLogo.setAttr("aria-hidden", true);
    leftLogo.hide();
    self.leftSiteHeaderEl = leftInner.createEl("a", "site-body-left-column-site-name");
    self.leftSiteThemeToggleEl = leftInner.createDiv("site-body-left-column-site-theme-toggle");
    self.leftSiteThemeToggleEl.hide();

    const centerColumn = body.createDiv("site-body-center-column");
    const header = self.siteHeaderEl = centerColumn.createDiv("site-header");
    header.createDiv("clickable-icon", (icon) => {
      env().tv(icon, "lucide-menu");
      icon.addEventListener("click", () => {
        container.classList.toggle("is-left-column-open");
        if (self.site.getConfig(s09PubOptShowNavigation)) self.nav.init(true);
      });
    });
    container.createDiv("nav-backdrop", (backdrop) => {
      backdrop.addEventListener("click", () => container.removeClass("is-left-column-open"));
    });
    const logoLink = self.siteLogoLinkEl = header.createEl("a", "site-header-logo");
    logoLink.setAttr("aria-hidden", true);
    logoLink.hide();
    self.siteLogoEl = logoLink.createEl("img");
    self.siteHeaderTextEl = header.createEl("a", "site-header-text");
    self.search = new SearchView(self);
    self.nav = new NavView(self, leftInner);

    const renderWrap = self.renderContainerEl = centerColumn.createDiv("render-container");
    self.renderContainerInnerEl = renderWrap.createDiv("render-container-inner");
    self.render = new PageView(self);
    const footer = self.footerEl = centerColumn.createDiv("site-footer");
    self.notFoundEl = renderWrap.createDiv("not-found-container", (nf) => {
      nf.createDiv("not-found-image");
      nf.createDiv({ cls: "not-found-title", text: "Not found" });
      nf.createDiv({ cls: "not-found-description", text: "This page does not exist" });
    });

    const rightColumn = renderWrap.createDiv("site-body-right-column");
    const rightInner = self.rightColumnInnerEl = rightColumn.createDiv("site-body-right-column-inner");
    self.graph = new GraphView(self, rightInner);
    self.outline = new OutlineView(self, rightInner);
    footer.createEl("a", {
      attr: { href: "https://github.com/FalconTechDev/basalt", target: "_blank" },
      text: "Powered by Basalt Publish",
    });

    window.addEventListener("popstate", () => self.loadFromUrl());
    window.addEventListener("resize", debounceCall(() => self.onResize(), 50, true));
    self.on("navigated", self.onNavigated.bind(self));
    self.stack.push(self.render);
    self.toggleNotFound(false);
    container.removeClass("has-not-found");

    if (window.siteInfo) self.site = new PublishSite(self, window.siteInfo);
    window.applyCss = (css) => self.applyCss(css);
    window.applyCssByLink = async (href) => {
      try {
        const css = await ajaxPromise({ url: href });
        self.applyCss(css);
      } catch (e) { console.error(e); }
    };
    window.require = () => env().u;
    window.publish = self;
    self.load();
    return self;
  }
  inherit(PublishApp, Base);

  // ---- loading ------------------------------------------------------------

  PublishApp.prototype.load = async function () {
    const containerEl = this.containerEl, site = this.site, render = this.render;
    if (!site) {
      // no site descriptor: the starter page still shows the "site not found" note
      s10PromotePreloadStyles();
      containerEl.show();
      render.renderContent("### Site not found.");
      return;
    }
    if (site.status === "degraded") {
      const notice = document.body.createDiv("top-notice");
      notice.setText("This site is no longer active. If you are the owner of the site, please update your subscription ");
      notice.createEl("a", {
        attr: { href: "https://github.com/FalconTechDev/basalt", target: "_blank" },
        text: "here",
      });
      notice.appendText(".");
    }
    // options and cache fetches run in parallel; options gate the first paint
    const optionsPromise = site.loadOptions();
    const cachePromise = site.loadCache();
    await optionsPromise;
    s10PromotePreloadStyles();
    containerEl.show();

    const leftInner = this.leftColumnInnerEl, rightInner = this.rightColumnInnerEl;
    const siteHeader = this.siteHeaderEl, headerText = this.siteHeaderTextEl;
    const logo = this.siteLogoEl, logoLink = this.siteLogoLinkEl;
    const leftHeader = this.leftSiteHeaderEl, leftLogo = this.leftSiteHeaderLogoEl;
    const leftLogoLink = this.leftSiteHeaderLogoLinkEl;
    const renderContainer = this.renderContainerEl;

    const showNav = site.getConfig(s09PubOptShowNavigation);
    const showGraph = site.getConfig(s09PubOptShowGraph);
    const showOutline = site.getConfig(s09PubOptShowOutline);
    if (showNav) leftInner.insertBefore(this.search.outerContainerEl, this.leftSiteThemeToggleEl.nextSibling);
    else if (showGraph || showOutline) rightInner.prepend(this.search.outerContainerEl);
    else siteHeader.prepend(this.search.outerContainerEl);

    const siteName = site.getSiteName();
    headerText.setText(siteName);
    leftHeader.setText(siteName);
    leftHeader.setAttr("aria-label", siteName);
    leftLogoLink.setAttr("aria-label", siteName + " logo");

    if (!document.head.find('meta[property="og:site_name"]')) {
      const desc = document.head.find('meta[name="description"]');
      if (desc) desc.parentNode.insertBefore(
        createEl("meta", { attr: { property: "og:site_name", content: siteName } }), desc);
    }

    const theme = site.getConfig(s09PubOptDefaultTheme);
    if (theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const apply = () => { mq.matches ? this.setTheme("dark") : this.setTheme("light"); };
      mq.addEventListener("change", apply);
      apply();
    } else {
      this.setTheme(theme);
    }

    if (site.getConfig(s09PubOptShowThemeToggle)) {
      const toggle = (iconEl) => {
        const isDark = this.themeInEffect === "dark";
        const next = isDark ? "light" : "dark";
        this.setTheme(next);
        this.leftSiteThemeToggleEl.toggleClass("is-dark", !isDark);
        iconEl.toggleClass("is-enabled", !isDark);
        localStorage.setItem("site-theme", next);
        if (this.graph.renderer) this.graph.renderer.testCSS();
      };
      const saved = localStorage.getItem("site-theme");
      if (saved) this.setTheme(saved);
      this.leftSiteThemeToggleEl.createSpan({ cls: "option mod-dark" }, (el) => env().tv(el, "lucide-moon"));
      this.leftSiteThemeToggleEl.createDiv("checkbox-container", (el) => {
        this.leftSiteThemeToggleEl.toggleClass("is-dark", this.themeInEffect === "dark");
        el.toggleClass("is-enabled", this.themeInEffect === "dark");
        el.addEventListener("click", () => toggle(el));
      });
      this.leftSiteThemeToggleEl.createSpan({ cls: "option mod-light" }, (el) => env().tv(el, "lucide-sun"));
      this.leftSiteThemeToggleEl.show();
    }

    const sliding = site.getConfig(s09PubOptSlidingWindowMode);
    if (sliding) {
      renderContainer.on("click", ".publish-renderer", this.onPublishRendererClick.bind(this));
      renderContainer.addEventListener("scroll", this.onSlidingWindowScroll.bind(this));
    }
    const readable = !sliding && !!site.getConfig(s09PubOptReadableLineLength);
    this.containerEl.toggleClass("is-readable-line-width", readable);
    markdownOptions.globalOptions.breaks = !site.getConfig(s09PubOptStrictLineBreaks);

    render.renderContent("### Loading site...");

    try {
      await cachePromise;
    } catch (err) {
      if (err instanceof XMLHttpRequest && err.status === 401) {
        this.setNoIndex(true);
        await new Promise((resolve) => { new PasswordModal(this, resolve).open(); });
        await site.loadCache();
      } else {
        console.error(err);
        new host.Notice("Oh no! Seems like something went wrong!");
        return;
      }
    }

    const head = document.head;
    const logoUrl = site.getSiteLogoUrl();
    if (logoUrl && site.cache.has(logoUrl)) {
      const internal = site.getInternalUrl(logoUrl);
      logoLink.show();
      logo.setAttribute("src", internal);
      leftLogoLink.show();
      leftLogo.setAttribute("src", internal);
    }
    this.addLinkToSiteRoot(headerText);
    this.addLinkToSiteRoot(leftHeader);
    this.addLinkToSiteRoot(leftLogoLink);
    this.addLinkToSiteRoot(logoLink);

    const gaId = site.getConfig(s09PubOptGoogleAnalytics);
    if (site.isCustomDomain() && gaId) {
      try {
        if (gaId.startsWith("G-")) {
          window.dataLayer = window.dataLayer || [];
          window.gtag = function () { window.dataLayer.push(arguments); };
          window.gtag("js", new Date);
          window.gtag("config", gaId);
          const script = head.createEl("script");
          script.async = true;
          script.src = "https://www.googletagmanager.com/gtag/js?id=" + gaId;
        } else {
          window.GoogleAnalyticsObject = "ga";
          const ga = window.ga = function () { (ga.q = ga.q || []).push(arguments); };
          ga.l = Date.now();
          const script = head.createEl("script");
          script.async = true;
          script.src = "https://www.google-analytics.com/analytics.js";
          ga("create", gaId, "auto");
          ga("send", "pageview");
        }
      } catch (e) { /* analytics must never break the site */ }
    }

    let hasBasaltCss = false, hasPublishCss = false;
    const links = Array.from(head.childNodes);
    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      if (link instanceof HTMLLinkElement && link.rel === "stylesheet") {
        if (link.href.contains(s10BasaltCssName)) hasBasaltCss = true;
        if (link.href.contains(s10PublishCssName)) hasPublishCss = true;
      }
    }
    if (!hasBasaltCss && site.cache.has(s10BasaltCssName)) {
      head.createEl("link", { href: site.getInternalUrl(s10BasaltCssName), attr: { rel: "stylesheet" } });
    }
    if (!hasPublishCss && site.cache.has(s10PublishCssName)) {
      head.createEl("link", { href: site.getInternalUrl(s10PublishCssName), attr: { rel: "stylesheet" } });
    }

    // favicons: a plain favicon.ico becomes the default icon, sized ones get `sizes`
    const cache = site.cache.cache;
    const defaultIcon = head.find('link[rel="icon"]:not([sizes])');
    for (const path in cache) {
      if (!cache.hasOwnProperty(path)) continue;
      const name = lastSegment(path);
      if (name === "favicon.ico") {
        head.createEl("link", { href: site.getInternalUrl(path), attr: { rel: "icon" } });
        if (defaultIcon) defaultIcon.detach();
        continue;
      }
      const m = name.match(s10FaviconPattern);
      if (m) {
        const size = m[1] + (m[2] || "x" + m[1]);
        head.createEl("link", { href: site.getInternalUrl(path), attr: { rel: "icon", sizes: size } });
        if (defaultIcon) defaultIcon.detach();
      }
    }

    this.trigger("options-updated");
    this.updateSlidingWindow();

    if (site.cache.has(s10PublishJsName)) {
      const script = createEl("script");
      script.async = true;
      script.src = site.getInternalUrl(s10PublishJsName);
      await new Promise((resolve) => {
        script.addEventListener("load", resolve);
        script.addEventListener("error", resolve);
        head.appendChild(script);
      });
    }

    await this.loadFromUrl();
    try {
      const preview = render.renderer.previewEl;
      preview.style.outline = "none";
      preview.tabIndex = -1;
      preview.focus();
    } catch (e) { console.error(e); }
  };

  PublishApp.prototype.loadFromUrl = async function () {
    const site = this.site, render = this.render;
    const parsed = this.parseUrl();
    const rawPath = parsed.path;
    let path = rawPath, subpath = parsed.subpath;
    if (path === "") {
      path = site.getConfig(s09PubOptIndexFile);
      subpath = "";
    }
    this.toggleNotFound(false);
    const dest = site.cache.getLinktextDest(path, "");
    if (dest) {
      await render.loadFile(dest, subpath);
    } else {
      render.currentFilepath = "";
      if (rawPath === "") {
        render.renderContent("### Welcome to " + site.getSiteName());
        this.setNoIndex(false);
        return;
      }
      this.setNoIndex(true);
      history.replaceState(null, null, site.pathprefix + "404");
      render.renderContent("");
      this.toggleNotFound(true);
    }
  };

  PublishApp.prototype.toggleNotFound = function (show) {
    this.containerEl.toggleClass("has-not-found", show);
    this.notFoundEl.toggle(show);
  };

  PublishApp.prototype.setTheme = function (theme) {
    if (["light", "dark"].includes(theme)) {
      document.body.removeClasses(["theme-light", "theme-dark"]);
      document.body.addClass("theme-" + theme);
      this.themeInEffect = theme;
    } else {
      console.error("Not a valid theme: ", theme);
    }
  };

  PublishApp.prototype.addLinkToSiteRoot = function (el) {
    const site = this.site;
    const index = site.getConfig(s09PubOptIndexFile);
    el.setAttr("href", site.getPublicHref(index));
    el.addEventListener("click", (e) => {
      e.preventDefault();
      if (this.slidingWindowMode) this.stack = [];
      this.navigate(index, "", e);
    });
  };

  PublishApp.prototype.onResize = function () {
    this.render.onResize();
    this.graph.onResize();
    this.updateSlidingWindow();
  };

  PublishApp.prototype.parseUrl = function () {
    let path = location.pathname;
    const custom = this.site.customurl;
    let isCustom = false;
    if (custom) {
      const full = location.host + path;
      if (full.startsWith(custom)) {
        path = full.substring(custom.length);
        isCustom = true;
      }
    }
    if (path.startsWith("/")) path = path.substring(1);
    if (!isCustom) {
      const slash = path.indexOf("/");
      path = slash >= 0 ? path.substring(slash + 1) : "";
    }
    const permalinks = this.site.cache.permalinks;
    const resolved = permalinks.hasOwnProperty(path) && path ? permalinks[path] : path.split("/").filter(Boolean).map(formDecode).join("/");
    let subpath = location.hash || "";
    subpath = subpath.split("#").map(formDecode).join("#");
    return { path: resolved, subpath };
  };

  PublishApp.prototype.navigate = function (linktext, subpath, evt) {
    const site = this.site;
    if (!site) return;
    this.toggleNotFound(false);
    const parsed = parseLinktext(linktext);
    const path = parsed.path, anchor = parsed.subpath;
    const dest = site.cache.getLinkpathDest(path, subpath);
    if (!dest) {
      new host.Notice('The link destination "' + linktext + '" does not exist.');
      return;
    }
    if (evt && Keymap.isModEvent(evt)) {
      window.open(site.getPublicHref(dest));
    } else if (this.slidingWindowMode) {
      const stack = this.stack;
      for (const view of stack) {
        if (view.currentFilepath === dest) {
          view.loadFile(dest, anchor);
          this.scrollToWindow(view);
          return;
        }
      }
      if (evt) {
        let node = evt.currentTarget, container = null;
        while (node && node !== this.renderContainerInnerEl) { container = node; node = node.parentElement; }
        for (let i = 0; i < stack.length - 1; i++) {
          if (stack[i].renderContainerEl === container) {
            stack.splice(i + 1, stack.length - i - 1);
            break;
          }
        }
      }
      const view = new PageView(this);
      stack.push(view);
      view.loadFile(dest, anchor);
      this.render = view;
      this.updateSlidingWindow();
      this.scrollToWindow(view);
    } else {
      this.render.loadFile(dest, anchor);
    }
    if (site.isCustomDomain()) {
      try {
        if (window.ga) window.ga("send", "pageview");
        if (window.gtag) window.gtag("event", "page_view");
      } catch (e) { /* ignore */ }
    }
  };

  PublishApp.prototype.closeRenderer = function (view) {
    if (!this.slidingWindowMode) return;
    const stack = this.stack;
    const idx = stack.indexOf(view);
    if (idx === -1) return;
    stack.remove(view);
    if (view === this.render) {
      const next = Math.min(idx, stack.length - 1);
      this.scrollToWindow(stack[next]);
    }
    this.updateSlidingWindow();
  };

  PublishApp.prototype.updateSlidingWindow = function () {
    const site = this.site, inner = this.renderContainerInnerEl;
    if (!site) return;
    const avail = document.body.clientWidth - this.leftColumnEl.clientWidth - this.rightColumnEl.clientWidth;
    const enabled = site.getConfig(s09PubOptSlidingWindowMode) && avail >= s10PublishPaneMinWidth;
    const changed = this.slidingWindowMode !== enabled;
    if (changed) {
      this.slidingWindowMode = enabled;
      this.stack = [this.render];
      document.body.toggleClass("sliding-windows", enabled);
    }
    if (!enabled && !changed) return;
    const stack = this.stack;
    for (let i = 0; i < stack.length; i++) {
      const style = stack[i].renderContainerEl.style;
      if (enabled) {
        style.minWidth = s10PublishPaneMinWidth + "px";
        style.left = i * s10PublishPaneOffset + "px";
        style.right = (stack.length - i) * s10PublishPaneOffset - s10PublishPaneMinWidth + "px";
      } else {
        style.minWidth = "";
        style.left = "";
        style.right = "";
      }
    }
    inner.setChildrenInPlace(stack.map((v) => v.renderContainerEl));
  };

  PublishApp.prototype.scrollToWindow = function (view) {
    const stack = this.stack;
    const idx = stack.indexOf(view);
    if (idx === -1) return;
    this.render = view;
    this.trigger("navigated");
    const target = idx * s10PublishPaneMinWidth;
    const el = this.renderContainerEl;
    if (el.scrollLeft < target || el.scrollLeft + el.clientWidth > target + s10PublishPaneMinWidth) {
      el.scrollTo({ left: target - idx * s10PublishPaneOffset, top: 0, behavior: "smooth" });
    }
  };

  PublishApp.prototype.onPublishRendererClick = function (e, container) {
    if (e.defaultPrevented) return;
    for (const view of this.stack) {
      if (view.renderContainerEl === container) {
        this.scrollToWindow(view);
        break;
      }
    }
  };

  PublishApp.prototype.onSlidingWindowScroll = function () {
    const stack = this.stack, el = this.renderContainerEl;
    const left = el.scrollLeft, right = left + el.clientWidth;
    for (let i = 0; i < stack.length; i++) {
      const pane = stack[i].renderContainerEl;
      pane.toggleClass("mod-overlay",
        (i > 0 && left > 664 * (i - 1)) || (i * s10PublishPaneMinWidth + (stack.length - i - 1) * s10PublishPaneOffset > right));
      pane.toggleClass("mod-squished",
        left >= 664 * (i + 1) || (i * s10PublishPaneMinWidth + (stack.length - i) * s10PublishPaneOffset >= right));
    }
  };

  PublishApp.prototype.onNavigated = function () {
    const site = this.site;
    const path = this.render.currentFilepath;
    const suffix = site.isCustomDomain() ? "" : " - Basalt Publish";
    if (path) {
      this.setNoIndex(false);
      const title = displayName(path);
      document.title = title + " - " + site.getSiteName() + suffix;
      const href = site.getPublicHref(path);
      if (location.href !== href) history.pushState(null, null, href);
    } else {
      this.setNoIndex(true);
      document.title = site.getSiteName() + suffix;
    }
  };

  PublishApp.prototype.setNoIndex = function (noindex) {
    if (this.site.getConfig(s09PubOptNoindex)) noindex = true;
    const meta = this.noindexEl;
    if (noindex && !meta.parentNode) document.head.appendChild(meta);
    else if (!noindex && meta.parentNode) meta.detach();
  };

  PublishApp.prototype.applyCss = function (css) {
    if (!this.styleEl) {
      this.styleEl = createEl("style", { type: "text/css" });
      document.head.appendChild(this.styleEl);
    }
    this.styleEl.setText(css);
  };

  Object.defineProperty(PublishApp.prototype, "currentFilepath", {
    get() { return this.render.currentFilepath; },
    enumerable: false, configurable: true,
  });

  PublishApp.prototype.registerMarkdownPostProcessor = function (fn, sortOrder) {
    env().Gz.registerPostProcessor(fn, sortOrder);
    return fn;
  };
  PublishApp.prototype.registerMarkdownCodeBlockProcessor = function (lang, fn, sortOrder) {
    const processor = env().Gz.createCodeBlockPostProcessor(lang, fn);
    env().Gz.registerPostProcessor(processor, sortOrder);
    env().Gz.registerCodeBlockPostProcessor(lang, fn);
    return processor;
  };
  PublishApp.prototype.trigger = function (name, ...args) {
    Base.prototype.trigger.apply(this, [name, ...args]);
  };
  PublishApp.prototype.on = function (name, fn, ctx) {
    return Base.prototype.on.call(this, name, fn, ctx);
  };

  return PublishApp;
}

// ---------------------------------------------------------------- factories (called with __basaltHost)

export function s24PublishSite(host) { return s24POnce("s24PublishSite", s24buildPublishSite); }
export function s24PublishSearch(host) { return s24POnce("s24PublishSearch", () => s24buildPublishSearch(host)); }
export function s24PublishApp(host) { return s24POnce("s24PublishApp", () => s24buildPublishApp(host)); }
