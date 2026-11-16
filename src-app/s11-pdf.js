// PDF support: the pdf.js viewer chrome (toolbar, find bar, outline, password
// prompt), the lazy-loading viewer component and the file view / embed wrappers.
// pdf.js itself is the vendored library in src/lib; everything here is app glue.
//
// The chrome classes are kept in module-level slots: every class-iife declarator
// runs before any PDF is opened, so by the time the viewer component's load()
// executes all of them are assigned.
import { env } from "./env.js";
import { s11Inherit } from "./s11-media.js";
import { s11PdfStrings, s11SearchStrings } from "./s11-i18n.js";
import { s11TextLayerOffset, s11TextLayerNode } from "./s11-pdf-text.js";

const pdfjs = () => globalThis.pdfjsViewer;
const pdfjsLib = () => globalThis.pdfjsLib;

// ---- viewer configuration (original: TZ declarator) ----
export const s11PdfViewerConfig = {
  enableScripting: false,
  externalLinkTarget: 2,
  imageResourcesPath: "/lib/pdfjs/images/",
  maxCanvasPixels: 16747216,
  pdfBugEnabled: false,
  sidebarViewOnLoad: 0,
  viewerCssTheme: 0,
  disablePreferences: false,
  disableHistory: true,
  verbosity: 0,
  defaultZoomValue: "page-width",
  cMapPacked: true,
  cMapUrl: "/lib/pdfjs/cmaps/",
  standardFontDataUrl: "/lib/pdfjs/standard_fonts/",
  wasmUrl: "/lib/pdfjs/wasm/",
  iccUrl: "/lib/pdfjs/iccs/",
  workerSrc: "/lib/pdfjs/pdf.worker.min.js",
  defaultUrl: "",
  disableTelemetry: true,
  isEvalSupported: false,
};

// ---- local-storage keys (original: PZ / qZ declarators) ----
export const s11PdfSearchSettingsKey = "pdfjs-search-settings";
export const s11PdfIsThemedKey = "pdfjs-is-themed";

// Module slots filled by the factories below.
let S11Localization = null, S11FindBar = null, S11Toolbar = null, S11PasswordPrompt = null,
    S11OutlineItem = null, S11OutlineTree = null, S11ViewerComponent = null, S11LazyViewer = null;

function s11ParseInt(text) {
  if (!text) return null;
  const value = parseInt(text);
  return Number.isNaN(value) ? null : value;
}

// ---- password prompt (original: BZ) ----
export function s11PdfPasswordPrompt() {
  function PdfPasswordPrompt(containerEl, eventBus) {
    this.updateCallback = null;
    this.reason = null;
    this.containerEl = containerEl;
    this.eventBus = eventBus;
  }
  const proto = PdfPasswordPrompt.prototype;
  proto.buildUI = function () {
    const self = this;
    const wrong = this.reason === pdfjsLib().PasswordResponses.INCORRECT_PASSWORD;
    this.dialogEl = this.containerEl.createDiv("pdf-password-dialog", (el) => {
      env().tv(el.createDiv("pdf-lock-icon"), "lucide-lock");
      el.createDiv({ text: s11PdfStrings().msgPasswordProtected() });
      el.createDiv({
        text: wrong ? s11PdfStrings().msgInvalidPassword() : s11PdfStrings().msgEnterPassword(),
        cls: wrong ? "mod-warning mod-small" : "mod-small",
      });
      el.createEl("input", { type: "password", placeholder: env().gm.setting.account.labelPassword() }, (input) => {
        input.addEventListener("keydown", (evt) => {
          if (evt.code === "Enter") self.verify(input.value);
        });
        setTimeout(() => input.focus());
      });
    });
  };
  proto.open = async function () {
    this.buildUI();
    this.eventBus.dispatch("passwordpromptopen", { source: this });
  };
  proto.close = async function () {
    this.dialogEl?.detach();
    this.dialogEl = null;
  };
  proto.verify = function (password) {
    if (password?.length > 0) this.invokeCallback(password);
  };
  proto.invokeCallback = function (password) {
    if (this.updateCallback) {
      this.close();
      this.updateCallback(password);
      this.updateCallback = null;
    }
  };
  proto.setUpdateCallback = async function (callback, reason) {
    this.updateCallback = callback;
    this.reason = reason;
  };
  proto.reset = function () {
    this.close();
    this.updateCallback = null;
    this.reason = null;
  };
  S11PasswordPrompt = PdfPasswordPrompt;
  return PdfPasswordPrompt;
}

// ---- find bar (original: LZ) ----
export function s11PdfFindBar(host) {
  function PdfFindBar(app, containerEl, eventBus, scope) {
    const self = this;
    this.opened = false;
    this.searchSettings = { highlightAll: false, caseSensitive: false, matchDiacritics: false, entireWord: false };
    this.clickOutsideHandler = function (evt) {
      const toggle = self.settingsToggleEl, panel = self.settingsEl;
      if (evt.target === panel || evt.target === toggle || panel.contains(evt.target)) return;
      self.toggleSettings(false);
      panel.win.removeEventListener("click", self.clickOutsideHandler);
    };
    this.keyHandlers = null;
    this.app = app;
    this.containerEl = containerEl;
    this.eventBus = eventBus;
    this.scope = scope;
    const stored = app.loadLocalStorage(s11PdfSearchSettingsKey);
    if (stored) {
      try { this.searchSettings = JSON.parse(stored); } catch (e) { /* keep defaults */ }
    }
    const settings = this.searchSettings;
    const barEl = (this.barEl = containerEl.createDiv("pdf-findbar pdf-toolbar mod-hidden"));
    barEl.createDiv("pdf-search-wrapper", (wrap) => {
      wrap.createDiv({ cls: "pdf-findbar-message", attr: { "aria-live": "polite" } }, (msg) => {
        self.findResultsCountEl = msg.createSpan("pdf-toolbar-label pdf-find-results-count");
      });
      new host.SearchComponent(wrap)
        .setPlaceholder(s11SearchStrings().promptStartSearch())
        .setClass("global-search-input-container")
        .addRightDecorator((dec) => {
          host.setTooltip(dec, s11SearchStrings().labelMatchCase());
          env().tv(dec, "uppercase-lowercase-a");
          dec.addClass("clickable-icon");
          dec.addEventListener("click", () => {
            settings.caseSensitive = !settings.caseSensitive;
            self.saveSettings();
            self.dispatchEvent("casesensitivitychange");
            dec.toggleClass("is-active", settings.caseSensitive);
          });
          dec.toggleClass("is-active", settings.caseSensitive);
        })
        .onChange(host.debounce(() => self.dispatchEvent(""), 250, true))
        .then((component) => {
          host.setTooltip(component.clearButtonEl, s11SearchStrings().tooltipClearSearch());
          self.searchComponent = component;
          component.inputEl.addEventListener("keypress", (evt) => {
            if (evt.isComposing || evt.key !== "Enter") return;
            if (env().Yl.isMobile) env().Lv();
            self.dispatchEvent("again", evt.shiftKey);
          });
        });
      self.findPreviousButtonEl = wrap.createEl("button", { cls: "pdf-toolbar-button clickable-icon" }, (btn) => {
        env().tv(btn, "lucide-arrow-up");
        host.setTooltip(btn, host.formatHotkey(env().Yl.isMacOS ? env().Fb(["Mod", "Shift"], "G") : env().Fb(["Shift"], "F3")), { placement: "top" });
        btn.addEventListener("click", () => self.dispatchEvent("again", true));
      });
      self.findNextButtonEl = wrap.createEl("button", { cls: "pdf-toolbar-button clickable-icon" }, (btn) => {
        env().tv(btn, "lucide-arrow-down");
        host.setTooltip(btn, host.formatHotkey(env().Yl.isMacOS ? env().Fb(["Mod"], "G") : env().Fb([], "F3")), { placement: "top" });
        btn.addEventListener("click", () => self.dispatchEvent("again", false));
      });
      wrap.createDiv("clickable-icon pdf-findbar-settings-btn", (btn) => {
        host.setTooltip(btn, s11SearchStrings().labelToggleSearchSettings());
        env().tv(btn, "lucide-sliders-horizontal");
        self.settingsToggleEl = btn;
        btn.addEventListener("click", () => self.toggleSettings());
      });
      wrap.createDiv("pdf-toolbar-divider");
      wrap.createDiv("clickable-icon", (btn) => {
        host.setTooltip(btn, env().gm.interface.emptyState.close());
        env().tv(btn, "lucide-x");
        btn.addEventListener("click", () => self.close());
      });
    });
    this.settingsEl = createDiv("pdf-findbar-settings", (panel) => {
      new host.Setting(panel).setName(s11PdfStrings().actionHighlightAll()).setClass("mod-toggle")
        .addToggle((t) => t.setSmall().setValue(settings.highlightAll)
          .onChange((v) => { settings.highlightAll = v; self.saveSettings(); self.dispatchEvent("highlightallchange"); }));
      new host.Setting(panel).setName(s11PdfStrings().actionMatchDiacritics()).setClass("mod-toggle")
        .addToggle((t) => t.setSmall().setValue(settings.matchDiacritics)
          .onChange((v) => { settings.matchDiacritics = v; self.saveSettings(); self.dispatchEvent("diacriticmatchingchange"); }));
      new host.Setting(panel).setName(s11PdfStrings().actionWholeWords()).setClass("mod-toggle")
        .addToggle((t) => t.setSmall().setValue(settings.entireWord)
          .onChange((v) => { settings.entireWord = v; self.saveSettings(); self.dispatchEvent("entirewordchange"); }));
    });
  }
  const proto = PdfFindBar.prototype;
  proto.toggleSettings = function (force) {
    const toggle = this.settingsToggleEl, panel = this.settingsEl;
    if (force === false || panel.isShown()) {
      toggle.removeClass("is-active");
      panel.win.removeEventListener("click", this.clickOutsideHandler);
      panel.detach();
      return;
    }
    const left = toggle.offsetLeft, top = toggle.offsetTop;
    toggle.addClass("is-active");
    panel.setCssProps({ top: `${top + toggle.clientHeight + 6}px`, left: `${left + toggle.clientWidth}px` });
    this.containerEl.append(panel);
    setTimeout(() => panel.win.addEventListener("click", this.clickOutsideHandler));
  };
  proto.saveSettings = function () {
    try {
      this.app.saveLocalStorage(s11PdfSearchSettingsKey, JSON.stringify(this.searchSettings));
    } catch (e) {
      console.error("Error saving PDF search settings", e);
    }
  };
  proto.reset = function () { this.updateUIState(); };
  proto.dispatchEvent = function (type, findPrevious = false) {
    const component = this.searchComponent;
    this.eventBus.dispatch("find", Object.assign(
      { source: this, type, query: component.inputEl.value, findPrevious },
      this.searchSettings
    ));
  };
  proto.updateUIState = function (state, previous, matches) {
    const component = this.searchComponent;
    const input = component.inputEl, container = component.containerEl;
    container.removeClasses(["mod-pending", "mod-not-found"]);
    let cls = "";
    if (state === pdfjs().FindState.PENDING) cls = "mod-pending";
    else if (state === pdfjs().FindState.NOT_FOUND) cls = "mod-not-found";
    if (cls) container.addClass(cls);
    input.setAttribute("aria-invalid", String(state === pdfjs().FindState.NOT_FOUND));
    this.updateResultsCount(matches);
  };
  proto.updateResultsCount = function (matches) {
    const m = matches || { current: 0, total: 0 };
    let text = "";
    if (m.total > 0) {
      text = m.total > 1000
        ? s11PdfStrings().msgMaxSearchResults({ current: m.current, limit: 1000 })
        : m.total > 1
          ? s11PdfStrings().msgSearchCount_plural({ current: m.current, total: m.total })
          : s11PdfStrings().msgSearchCount({ current: m.current, total: m.total });
    }
    this.findResultsCountEl.textContent = text;
  };
  proto.showSearch = function () {
    const input = this.searchComponent.inputEl;
    if (this.opened && input.doc.activeElement !== input) this.searchComponent.autoSelect();
    else this.toggle();
  };
  proto.open = function () {
    const bar = this.barEl, component = this.searchComponent, bus = this.eventBus, scope = this.scope;
    if (!this.opened) {
      this.opened = true;
      bar.removeClass("mod-hidden");
      bar.parentElement.addClass("findbarOpen");
      bar.parentElement.setCssProps({ "--findbar-height": `${bar.clientHeight}px` });
    }
    component.autoSelect();
    bus.dispatch("findbaropen", { source: this });
    const self = this;
    this.keyHandlers = [
      scope.register([], "F3", () => self.dispatchEvent("again", false)),
      scope.register(["Mod"], "G", () => self.dispatchEvent("again", false)),
      scope.register(["Shift"], "F3", () => self.dispatchEvent("again", true)),
      scope.register(["Mod", "Shift"], "G", () => self.dispatchEvent("again", true)),
    ];
  };
  proto.close = function () {
    const bar = this.barEl, bus = this.eventBus, scope = this.scope, handlers = this.keyHandlers;
    if (!this.opened) return;
    this.opened = false;
    bar.addClass("mod-hidden");
    bar.parentElement.removeClass("findbarOpen");
    bar.parentElement.setCssProps({ "--findbar-height": "" });
    bus.dispatch("findbarclose", { source: this });
    for (const handler of handlers) scope.unregister(handler);
    this.keyHandlers = null;
    this.toggleSettings(false);
  };
  proto.toggle = function () {
    if (this.opened) { this.close(); return false; }
    this.open();
    return true;
  };
  S11FindBar = PdfFindBar;
  return PdfFindBar;
}

// ---- pdf.js l10n adapter (original: OZ) ----
export function s11PdfLocalization() {
  function PdfLocalization() {}
  const proto = PdfLocalization.prototype;
  proto.getLanguage = function () { return env().sm(); };
  proto.getDirection = function () { return "ltr"; };
  proto.get = async function (id, args = null, fallback = null) {
    const table = s11PdfStrings();
    const entry = table[id];
    const value = typeof entry === "function" ? entry(args) : entry;
    return value || fallback;
  };
  proto.translate = async function (root) {
    const nodes = root ? Array.from(root.querySelectorAll("*[data-l10n-id]")) : [];
    const table = s11PdfStrings();
    for (const node of nodes) {
      const { l10nId, l10nArgs } = node.dataset;
      const args = l10nArgs ? JSON.parse(l10nArgs) : null;
      if (!l10nId || !args) continue;
      const text = table[l10nId](args);
      if (args.attr) node.setAttr(args.attr, text); else node.setText(text);
    }
  };
  proto.pause = function () {};
  proto.resume = function () {};
  S11Localization = PdfLocalization;
  return PdfLocalization;
}

// ---- toolbar (original: HZ) ----
export function s11PdfToolbar(host) {
  function PdfToolbar(app, containerEl, viewer) {
    const self = this;
    const pdfViewer = viewer.pdfViewer;
    const bus = pdfViewer.eventBus;
    this.pdfViewer = pdfViewer;
    this.eventBus = bus;
    this.toolbarEl = containerEl.createDiv({ cls: "pdf-toolbar", prepend: true }, (bar) => {
      bar.createDiv("pdf-toolbar-left", (left) => {
        self.toolbarLeftEl = left;
        self.sidebarToggleEl = left.createDiv("clickable-icon", (el) => {
          host.setTooltip(el, s11PdfStrings().actionToggleSidebar());
          env().tv(el, "lucide-layout-list");
          el.addEventListener("click", () => bus.dispatch("togglesidebar", { source: self }));
        });
        self.sidebarOptionsEl = left.createDiv("clickable-icon", (el) => {
          env().tv(el, "lucide-chevron-down");
          host.setTooltip(el, s11PdfStrings().tooltipSidebarOptions());
          let open = false;
          el.addEventListener("click", () => {
            if (open) return;
            const sidebar = pdfViewer.pdfSidebar;
            const outline = pdfViewer.pdfOutlineViewer.outline;
            const thumbs = sidebar.isOpen && sidebar.active === 1;
            const outlineActive = sidebar.isOpen && sidebar.active === 2;
            const menu = new host.Menu()
              .addSections(["view", "action"])
              .addItem((item) => item.setSection("view").setIcon("lucide-layout-grid")
                .setTitle(s11PdfStrings().actionShowThumbnails()).setChecked(thumbs)
                .onClick(() => sidebar.switchView(thumbs ? 0 : 1, true)))
              .addItem((item) => item.setSection("view").setIcon("lucide-list")
                .setTitle(s11PdfStrings().actionShowOutline()).setChecked(outlineActive)
                .setDisabled(!outline)
                .onClick(() => sidebar.switchView(outlineActive ? 0 : 2, true)))
              .addItem((item) => item.setSection("action").setIcon("lucide-list-start")
                .setTitle(s11PdfStrings().actionRevealInOutline()).setDisabled(!outline)
                .onClick(() => {
                  if (!outlineActive) sidebar.switchView(2, true);
                  bus.dispatch("currentoutlineitem", { source: self });
                }));
            menu.onHide(() => { open = false; });
            const rect = el.getBoundingClientRect();
            menu.setParentElement(el).showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true, left: false });
            open = true;
          });
        });
      });
      bar.createDiv("pdf-toolbar-spacer");
      self.zoomOutEl = bar.createDiv("clickable-icon", (el) => {
        host.setTooltip(el, env().gm.commands.zoomOut());
        env().tv(el, "lucide-zoom-out");
        el.addEventListener("click", () => bus.dispatch("zoomout", { source: self }));
      });
      bar.createDiv("pdf-toolbar-divider");
      self.zoomInEl = bar.createDiv("clickable-icon", (el) => {
        host.setTooltip(el, env().gm.commands.zoomIn());
        env().tv(el, "lucide-zoom-in");
        el.addEventListener("click", () => bus.dispatch("zoomin", { source: self }));
      });
      bar.createDiv("clickable-icon", (el) => {
        env().tv(el, "lucide-chevron-down");
        host.setTooltip(el, s11PdfStrings().tooltipDisplayOptions());
        let open = false;
        el.addEventListener("click", () => {
          if (open) return;
          const scale = pdfViewer.pdfViewer.currentScaleValue;
          const fitWidth = scale === "page-width", fitHeight = scale === "page-height";
          const spread = pdfViewer.pdfViewer.spreadMode;
          const single = spread === 0, odd = spread === 1, even = spread === 2;
          const themed = !!app.loadLocalStorage(s11PdfIsThemedKey);
          const menu = new host.Menu()
            .addSections(["zoom", "spread", "appearance"])
            .addItem((item) => item.setSection("zoom").setIcon("lucide-move-horizontal")
              .setTitle(s11PdfStrings().actionFitWidth()).setChecked(fitWidth)
              .onClick(() => bus.dispatch("scalechanged", { source: self, value: "page-width" })))
            .addItem((item) => item.setSection("zoom").setIcon("lucide-move-vertical")
              .setTitle(s11PdfStrings().actionFitHeight()).setChecked(fitHeight)
              .onClick(() => bus.dispatch("scalechanged", { source: self, value: "page-height" })))
            .addItem((item) => item.setSection("spread").setIcon("lucide-rectangle-vertical")
              .setTitle(s11PdfStrings().labelSpreadSingle()).setChecked(single)
              .onClick(() => bus.dispatch("switchspreadmode", { source: self, mode: 0 })))
            .addItem((item) => item.setSection("spread").setIcon("rectangle-vertical-double")
              .setTitle(s11PdfStrings().labelSpreadOdd()).setChecked(odd)
              .onClick(() => bus.dispatch("switchspreadmode", { source: self, mode: 1 })))
            .addItem((item) => item.setSection("spread").setIcon("rectangle-vertical-double")
              .setTitle(s11PdfStrings().labelSpreadEven()).setChecked(even)
              .onClick(() => bus.dispatch("switchspreadmode", { source: self, mode: 2 })))
            .addItem((item) => item.setSection("appearance").setIcon("lucide-palette")
              .setTitle(s11PdfStrings().labelAdaptToTheme()).setChecked(themed)
              .onClick(() => {
                app.saveLocalStorage(s11PdfIsThemedKey, themed ? null : "true");
                pdfViewer.onCSSChange();
              }));
          menu.onHide(() => { open = false; });
          const rect = el.getBoundingClientRect();
          menu.setParentElement(el).showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true, left: false });
          open = true;
        });
      });
      bar.createDiv("pdf-toolbar-spacer");
      self.pageInputEl = bar.createEl("input", { cls: "pdf-page-input" }, (input) => {
        input.addEventListener("click", () => input.select());
        input.addEventListener("change", () => bus.dispatch("pagenumberchanged", { source: self, value: input.value }));
      });
      self.pageNumberEl = bar.createSpan("pdf-page-numbers");
    });
    bar.createDiv("pdf-toolbar-right", (right) => { self.toolbarRightEl = right; });
    bus._on("sidebarviewchanged", (evt) => {
      self.sidebarToggleEl.toggleClass("is-active", evt.view > 0);
    });
    this.reset();
  }
  const proto = PdfToolbar.prototype;
  proto.setPageNumber = function (pageNumber, pageLabel) {
    this.pageNumber = pageNumber;
    this.pageLabel = pageLabel;
    this.updateUIState(false);
  };
  proto.setPagesCount = function (pagesCount, hasPageLabels) {
    this.pagesCount = pagesCount;
    this.hasPageLabels = hasPageLabels;
    this.updateUIState(true);
  };
  proto.setPageScale = function (pageScaleValue, pageScale) {
    this.pageScaleValue = (pageScaleValue || pageScale).toString();
    this.pageScale = pageScale;
    this.updateUIState(false);
  };
  proto.reset = function () {
    this.pageNumber = 0;
    this.pageLabel = null;
    this.hasPageLabels = false;
    this.pagesCount = 0;
    this.pageScaleValue = pdfjs().DEFAULT_SCALE_VALUE;
    this.pageScale = pdfjs().DEFAULT_SCALE;
    this.updateUIState(true);
    this.updateLoadingIndicatorState();
    this.eventBus.dispatch("toolbarreset", { source: this });
  };
  proto.updateUIState = function (force = false) {
    const input = this.pageInputEl, label = this.pageNumberEl;
    if (force) {
      if (this.hasPageLabels) input.type = "text";
      else { input.type = "number"; label.textContent = s11PdfStrings().labelOfPages({ count: this.pagesCount }); }
      input.max = this.pagesCount.toString();
    }
    if (this.hasPageLabels) {
      input.value = this.pageLabel;
      label.textContent = s11PdfStrings().labelPageOfPages({ current: this.pageNumber, count: this.pagesCount });
    } else {
      input.value = this.pageNumber.toString();
    }
    this.prevPageEl?.toggleClass("mod-disabled", this.pageNumber <= 1);
    this.nextPageEl?.toggleClass("mod-disabled", this.pageNumber >= this.pagesCount);
    this.zoomOutEl.toggleClass("mod-disabled", this.pageScale <= pdfjs().MIN_SCALE);
    this.zoomInEl.toggleClass("mod-disabled", this.pageScale >= pdfjs().MAX_SCALE);
  };
  proto.updateLoadingIndicatorState = function (loading = false) {
    this.pageInputEl.toggleClass("mod-page-loading", loading);
  };
  S11Toolbar = PdfToolbar;
  return PdfToolbar;
}

// ---- outline item (original: FZ) ----
export function s11PdfOutlineItem() {
  function PdfOutlineItem(owner, item, parent) {
    const self = env().JL.call(this) || this;
    self.owner = owner;
    self.item = item;
    self.parent = parent;
    self.explicitDest = undefined;
    self.pageNumber = undefined;
    self.innerEl.setText(item.title);
    self.renderLabels();
    self.selfEl.addEventListener("contextmenu", (evt) => {
      if (!evt.defaultPrevented) owner.onItemContextMenu(self, evt);
    });
    return self;
  }
  s11Inherit(PdfOutlineItem, env().JL);
  const proto = PdfOutlineItem.prototype;
  proto.getExplicitDestination = async function () {
    if (this.explicitDest !== undefined) return this.explicitDest;
    return (this.explicitDest = await this.fetchExplicitDestination(this.owner.pdfDocument));
  };
  proto.getPageNumber = async function () {
    if (this.pageNumber !== undefined) return this.pageNumber;
    return (this.pageNumber = await this.fetchPageNumber(this.owner.pdfDocument));
  };
  proto.fetchExplicitDestination = async function (pdfDocument) {
    const owner = this.owner, dest = this.item.dest;
    if (typeof dest === "string") {
      try {
        const resolved = await owner.pdfDocument.getDestination(dest);
        if (pdfDocument !== owner.pdfDocument) return null;
        return resolved && Array.isArray(resolved) && typeof resolved[0]?.num === "number" ? resolved : null;
      } catch (e) {
        console.error(e);
        return null;
      }
    }
    if (Array.isArray(dest)) return dest;
    return null;
  };
  proto.fetchPageNumber = async function (pdfDocument) {
    const owner = this.owner;
    const dest = await this.getExplicitDestination();
    if (!dest) return null;
    const ref = dest[0];
    let pageNumber = null;
    if (typeof ref === "object" && ref !== null) {
      const cached = pdfDocument.cachedPageNumber(ref);
      if (cached !== null) pageNumber = cached;
      else {
        try {
          pageNumber = await owner.pdfDocument.getPageIndex(ref) + 1;
          if (pdfDocument !== owner.pdfDocument) return null;
        } catch (e) { /* leave null */ }
      }
    } else if (Number.isInteger(ref)) {
      pageNumber = ref + 1;
    }
    return pageNumber;
  };
  proto.getMarkdownLink = async function () {
    const dest = await this.getExplicitDestination();
    const pageNumber = await this.getPageNumber();
    if (!dest || pageNumber === null) return null;
    let params = `page=${pageNumber}`;
    if (dest[1] && dest[1].name === "XYZ" && dest.length === 5 && dest[2] !== null) {
      const offset = [dest[2]];
      if (dest[3] !== null) { offset.push(dest[3]); if (dest[4] !== null) offset.push(dest[4]); }
      params += `&offset=${offset.join(",")}`;
    }
    const title = this.item.title?.replace(/[\s\n\r]+/g, " ");
    return this.owner.viewer.getMarkdownLink(`#${params}`, `${this.owner.viewer.file.basename}, ${title}`);
  };
  proto.renderLabels = async function () {
    const owner = this.owner;
    const pageNumber = await this.getPageNumber();
    if (!owner.outline || pageNumber === null) return;
    const labels = owner.pageLabels ?? [];
    const label = String(labels[pageNumber - 1] ?? pageNumber);
    this.selfEl.createDiv("tree-item-flair-outer").createSpan({ cls: "tree-item-flair", text: label });
  };
  proto.onSelfClick = function (evt) {
    if (!evt.defaultPrevented) this.owner.onItemClick(this);
  };
  proto.render = function () {
    env().JL.prototype.render.call(this);
    const children = this.children;
    this.setCollapsible(children && children.length > 0);
    this.setClickable(true);
    const item = this.item;
    if (item.bold) this.innerEl.style.fontWeight = "bold";
    if (item.italic) this.innerEl.style.fontStyle = "italic";
  };
  proto.setActive = function (active) { this.selfEl.toggleClass("mod-active", active); };
  proto.reveal = function () {
    for (let p = this.parent; p !== null;) { p.setCollapsed(false, false); p = p.parent; }
    this.selfEl.scrollIntoView({ block: "start" });
  };
  S11OutlineItem = PdfOutlineItem;
  return PdfOutlineItem;
}

// ---- outline tree (original: NZ) ----
export function s11PdfOutlineTree() {
  function PdfOutlineTree(viewer, containerEl, eventBus, linkService) {
    const self = env().eI.call(this, containerEl) || this;
    self.allItems = [];
    self.highlighted = null;
    self.pageLabels = null;
    self.viewer = viewer;
    self.eventBus = eventBus;
    self.linkService = linkService;
    eventBus._on("toggleoutlinetree", self.toggleAllTreeItems.bind(self));
    eventBus._on("currentoutlineitem", self.findCurrentOutlineItem.bind(self));
    eventBus._on("pagechanging", (evt) => { self.currentPageNumber = evt.pageNumber; });
    eventBus._on("pagesloaded", (evt) => {
      self.isPagesLoaded = !!evt.pagesCount;
      self.currentOutlineItemCapability?.resolve(self.isPagesLoaded);
    });
    eventBus._on("sidebarviewchanged", (evt) => { self.sidebarView = evt.view; });
    self.reset();
    return self;
  }
  s11Inherit(PdfOutlineTree, env().eI);
  const proto = PdfOutlineTree.prototype;
  proto.reset = function () {
    this.outline = null;
    this.pageNumberToDestHashCapability = null;
    this.currentPageNumber = 1;
    this.isPagesLoaded = null;
    this.highlighted = null;
    this.allItems = [];
    this.currentOutlineItemCapability?.resolve(false);
    this.currentOutlineItemCapability = null;
    this.clear();
  };
  proto.recurseTree = function (items, allItems, parent = null) {
    if (!items.length) return [];
    const result = [];
    for (const raw of items) {
      const item = new S11OutlineItem(this, raw, parent);
      if (raw.items.length) item.setCollapsed(true, false);
      item.children = this.recurseTree(raw.items, allItems, item);
      result.push(item);
      allItems.push(item);
    }
    return result;
  };
  proto.setPageNumber = function (pageNumber) { this.currentPageNumber = pageNumber; };
  proto.renderTree = function ({ outline, pdfDocument }) {
    if (this.outline && this.outline !== outline) this.reset();
    else this.clear();
    this.outline = outline || null;
    this.pdfDocument = pdfDocument || null;
    if (outline) {
      const allItems = (this.allItems = []);
      const roots = this.recurseTree(outline, allItems);
      for (const root of roots) this.addRoot(root);
      this.highlighted = null;
      this.render();
      this.dispatchEvent(allItems.length);
    } else {
      this.dispatchEvent(0);
    }
  };
  proto.dispatchEvent = function (outlineCount) {
    const capability = (this.currentOutlineItemCapability = pdfjs().createPromiseWithResolvers());
    const doc = this.pdfDocument, loaded = this.isPagesLoaded, bus = this.eventBus;
    if (outlineCount === 0 || doc?.loadingParams.disableAutoFetch) capability.resolve(false);
    else if (loaded !== null) capability.resolve(loaded);
    bus.dispatch("outlineloaded", { source: this, outlineCount, currentOutlineItemPromise: capability.promise });
  };
  proto.onItemClick = function (item) {
    const highlighted = this.highlighted;
    const linkService = this.linkService;
    const data = item.item;
    const { url, action, dest, setOCGState } = data;
    if (!dest) {
      if (item.children.length) item.toggleCollapsed(true);
      return;
    }
    if (highlighted !== item) {
      highlighted?.setActive(false);
      item.setActive(true);
      this.highlighted = item;
    }
    if (url) activeWindow.open(pdfjs().removeNullCharacters(url), "_blank");
    else if (action) linkService.executeNamedAction(action);
    else if (setOCGState) linkService.executeSetOCGState(setOCGState);
    else linkService.goToDestination(dest);
  };
  proto.onItemContextMenu = async function (item, evt) {
    if (this.viewer.opts?.isEmbed) evt.preventDefault();
    const link = await item.getMarkdownLink();
    if (!link) return;
    let title = item.item.title;
    if (title) title = title.replace(/[\s\n\r]+/g, " ");
    const label = title
      ? env().gm.pdf.actionCopySectionLinkTitle({ title: env().gc(title, 40) })
      : env().gm.pdf.actionCopySectionLink();
    new env().Ug().addItem((menuItem) => menuItem.setTitle(label).setIcon("lucide-copy")
      .onClick(() => evt.view.navigator.clipboard.writeText(link))).showAtMouseEvent(evt);
  };
  proto.toggleAllTreeItems = function () {
    const items = this.allItems;
    if (!items?.length) return;
    const collapsed = items[0].collapsed;
    for (const item of items) item.setCollapsed(!collapsed, false);
  };
  proto.findCurrentOutlineItem = async function () {
    if (!this.isPagesLoaded) throw new Error("findCurrentOutlineItem: All pages have not been loaded.");
    if (!this.outline || !this.pdfDocument) return;
    const destHash = await this.getPageNumberToDestHash(this.pdfDocument);
    if (!destHash) return;
    this.highlighted?.setActive(false);
    this.highlighted = null;
    if (this.sidebarView !== 2) return;
    for (let page = this.currentPageNumber; page > 0; page--) {
      const dest = destHash.get(page);
      if (!dest) continue;
      for (const item of this.allItems) {
        if (item.item.dest === dest) {
          item.setActive(true);
          item.reveal();
          this.highlighted = item;
          return;
        }
      }
    }
  };
  proto.getPageNumberToDestHash = async function (pdfDocument) {
    if (this.pageNumberToDestHashCapability) return this.pageNumberToDestHashCapability.promise;
    const capability = (this.pageNumberToDestHashCapability = pdfjs().createPromiseWithResolvers());
    const map = new Map();
    const items = this.allItems;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const pageNumber = await item.getPageNumber();
      if (pdfDocument !== this.pdfDocument) return null;
      map.set(pageNumber, item.item.dest);
    }
    capability.resolve(map.size > 0 ? map : null);
    return capability.promise;
  };
  proto.setPageLabels = function (pageLabels) {
    this.pageLabels = pageLabels || null;
    if (this.pdfDocument) this.renderTree({ outline: this.outline, pdfDocument: this.pdfDocument });
  };
  S11OutlineTree = PdfOutlineTree;
  return PdfOutlineTree;
}

// ---- the pdf.js viewer component (original: _Z) ----
export function s11PdfViewerComponent(host) {
  function PdfViewerComponent(app, scope, containerEl, opts) {
    const self = this;
    this.subpathHighlight = null;
    this.unloaded = false;
    this.annotationHighlight = null;
    this.highlightedText = [];
    this.app = app;
    this.scope = scope;
    this.containerEl = containerEl;
    this.opts = opts;
    this.resizeObserver = new ResizeObserver(host.debounce(() => self.onResize(), 200, true));
  }
  const proto = PdfViewerComponent.prototype;
  proto.load = async function () {
    const self = this;
    if (this.opts?.initDelay) {
      await env().sleep(this.opts.initDelay);
      if (this.unloaded) return;
    }
    await env().dz();
    if (env().Yl.isMobile) s11PdfViewerConfig.maxCanvasPixels = 5242880;
    if (this.unloaded) return;
    const app = this.app, opts = this.opts;
    const eventBus = new pdfjs().EventBus();
    const loadingEl = (this.loadingEl = this.containerEl.doc.body.createDiv());
    loadingEl.setCssStyles({ position: "fixed", opacity: "0", zIndex: "-9999" });
    const pdfContainerEl = loadingEl.createDiv("pdf-container");
    const themed = app.loadLocalStorage(s11PdfIsThemedKey);
    let pageBackground = null, pageInvert = false;
    if (themed) {
      pdfContainerEl.addClass("mod-themed");
      pageBackground = pdfContainerEl.getCssPropertyValue("--pdf-page-background");
      pageInvert = document.body.hasClass("theme-dark");
    }
    const contentEl = loadingEl.createDiv("pdf-content-container");
    const viewerContainerEl = contentEl.createDiv("pdf-viewer-container", (el) => {
      el.style.position = "absolute";
      el.addEventListener("transitionend", (evt) => {
        if (evt.target === el) eventBus.dispatch("resize", { source: el });
      }, true);
      el.addEventListener("contextmenu", self.onContextMenu.bind(self));
      el.addEventListener("pointerdown", self.onAnnotationPointerDown.bind(self));
    });
    const viewerEl = viewerContainerEl.createDiv("pdfViewer");
    const sidebarContainerEl = contentEl.createDiv("pdf-sidebar-container", (el) => {
      el.addEventListener("contextmenu", self.onThumbnailContextMenu.bind(self));
    });
    const sidebarContent = sidebarContainerEl.createDiv("pdf-sidebar-content-wrapper").createDiv("pdf-sidebar-content");
    const thumbnailViewEl = sidebarContent.createDiv("pdf-thumbnail-view");
    const outlineViewEl = sidebarContent.createDiv("pdf-outline-view hidden");
    const dom = { containerEl: loadingEl, contentEl, outlineViewEl, pdfContainerEl, sidebarContainerEl, thumbnailViewEl, viewerContainerEl, viewerEl };
    const viewer = (this.pdfViewer = pdfjs().createObsidianPDFViewer({
      baseConfig: s11PdfViewerConfig,
      dom,
      eventBus,
      height: opts?.height,
      isEmbed: opts?.isEmbed,
      l10n: new S11Localization(),
      removePageBorders: opts?.removePageBorders,
      pageBackground,
      pageInvert,
    }));
    viewer.toolbar = this.toolbar = new S11Toolbar(app, loadingEl, this);
    viewer.findBar = this.findBar = new S11FindBar(app, contentEl, eventBus, this.scope);
    viewer.passwordPrompt = new S11PasswordPrompt(viewerContainerEl, eventBus);
    viewer.pdfOutlineViewer = new S11OutlineTree(this, outlineViewEl, eventBus);
    contentEl.onWindowMigrated(async () => {
      if (!this.file) return;
      const subpath = viewer.subpath;
      await viewer.close();
      await this.loadFile(this.file);
      if (subpath) await viewer.pdfLoadingTask?.promise;
      viewer.applySubpath(subpath);
    });
    eventBus._on("sidebarviewchanged", (evt) => sidebarContainerEl.setAttr("data-view", evt.view));
    this.scope.register([], "Escape", () => {
      this.clearEphemeralUI();
      this.findBar.close();
    });
    eventBus._on("find", () => this.clearEphemeralUI());
    this.resizeObserver.observe(pdfContainerEl);
    await viewer.initialize();
    if (this.unloaded) { this.unload(); return; }
    this.loadingEl?.detach();
    this.loadingEl = null;
    dom.containerEl = this.containerEl;
    this.containerEl.appendChild(this.toolbar.toolbarEl);
    this.containerEl.appendChild(pdfContainerEl);
    if (opts?.isEmbed && opts?.height) viewer.setHeight(opts.height);
    eventBus._on("textlayerrendered", (evt) => {
      const source = evt.source;
      if (!source) return;
      const textLayer = source.textLayer, pageId = source.id;
      if (env().Yl.isMobile) {
        textLayer.div?.addEventListener("copy", (copyEvt) => this.onMobileCopy(copyEvt, source));
      }
      if (this.subpathHighlight && this.subpathHighlight.type === "text" && pageId === this.subpathHighlight.page) {
        this.highlightText(this.subpathHighlight.page, this.subpathHighlight.range);
      }
    });
    if (opts?.isEmbed) {
      eventBus.on("pagerendered", () => {
        const hidden = pdfContainerEl.querySelector(".hiddenCopyElement");
        hidden?.detach();
      }, { once: true });
    }
    eventBus._on("annotationlayerrendered", (evt) => {
      const source = evt.source;
      if (this.subpathHighlight && this.subpathHighlight.type === "annotation" &&
          source?.id === this.subpathHighlight.page) {
        this.highlightAnnotation(this.subpathHighlight.page, this.subpathHighlight.id);
      }
    });
  };
  proto.unload = function () {
    this.unloaded = true;
    this.resizeObserver.disconnect();
    this.pdfViewer?.unbindWindowEvents();
    this.pdfViewer?.close();
    this.pdfViewer = null;
    this.toolbar = null;
    this.findBar?.close();
    this.findBar = null;
    this.loadingEl?.detach();
    this.loadingEl = null;
    this.containerEl.empty();
    this.destroyAnnotationPopup();
  };
  proto.getPage = function (pageNumber) {
    return this.pdfViewer.pdfViewer.getPageView(pageNumber - 1);
  };
  proto.renderAnnotationPopup = function ({ layer, data, parent }) {
    const page = parent.page, pageNumber = page.pageNumber, view = page.view;
    const pageView = this.getPage(pageNumber);
    const annotationId = data.id, rect = data.rect, contentsObj = data.contentsObj;
    const dir = contentsObj.dir, str = contentsObj.str;
    const popup = createDiv("popup");
    popup.createDiv({ cls: "popupContent", attr: { dir } }, (content) => {
      const lines = str.split(/(?:\r\n?|\n)/);
      for (let i = 0; i < lines.length; i++) {
        content.appendText(lines[i]);
        if (i < lines.length - 1) content.createEl("br");
      }
    });
    popup.createDiv("popupMeta", (meta) => {
      if (data.titleObj) meta.createDiv({ cls: "popupTitle", text: data.titleObj.str, attr: { dir: data.titleObj.dir } });
      const date = pdfjsLib().PDFDateString.toDateObject(data.modificationDate);
      if (date) meta.createSpan({ cls: "popupDate", text: `${date.toLocaleDateString()}, ${date.toLocaleTimeString()}` });
      if (pageView) {
        meta.createDiv("clickable-icon", (icon) => {
          env().tv(icon, "lucide-copy");
          host.setTooltip(icon, env().gm.interface.menu.copy());
          icon.addEventListener("click", async () => {
            const lines = [];
            const annotated = await this.getAnnotatedText(pageView, annotationId);
            if (annotated) lines.push(`> ${annotated}`);
            lines.push(this.getMarkdownLink(`#page=${pageNumber}&annotation=${annotationId}`));
            if (data.contentsObj?.str) lines.push(data.contentsObj.str);
            await navigator.clipboard.writeText(lines.join("\n\n"));
            env().tv(icon, "lucide-check");
          });
        });
      }
    });
    if (env().Yl.isPhone) {
      const modal = new host.Modal(this.app).setBackgroundOpacity("0.4");
      modal.containerEl.addClass("pdf-annotation-modal");
      modal.contentEl.append(popup);
      activeWindow.setTimeout(() => modal.open(), 20);
      return;
    }
    const rawDims = view.viewport.rawDims;
    const pageWidth = rawDims.pageWidth, pageHeight = rawDims.pageHeight, pageX = rawDims.pageX, pageY = rawDims.pageY;
    const bounds = pdfjsLib().Util.normalizeRect([rect[0], view[3] - rect[1] + view[1], rect[2], view[3] - rect[3] + view[1]]);
    const wrapper = createDiv({ cls: "popupWrapper", attr: { "data-annotation-id": data.id } });
    wrapper.append(popup);
    wrapper.setCssStyles({
      left: `${100 * ((bounds[0] + bounds[2]) / 2 - pageX) / pageWidth}%`,
      top: `${100 * (bounds[3] - pageY) / pageHeight}%`,
    });
    if (data.color) {
      const [r, g, b] = data.color;
      wrapper.style.setProperty("--annotation-color", `${r}, ${g}, ${b}`);
    }
    layer.append(wrapper);
    env().yl(wrapper, new env().dl({ duration: 200, fn: "cubic-bezier(0.34, 1.56, 0.64, 1)" })
      .addProp("transform", "translate(-50%, -1px) scale(0.97)", "translate(-50%, 0) scale(1)", ""));
    const viewerRect = this.pdfViewer.dom.viewerContainerEl.getBoundingClientRect();
    const popupRect = wrapper.getBoundingClientRect();
    if (!(popupRect.top > viewerRect.top && popupRect.bottom < viewerRect.bottom)) {
      wrapper.scrollIntoView({ behavior: "smooth", block: "end" });
    }
    this.activeAnnotationPopupEl = wrapper;
  };
  proto.destroyAnnotationPopup = function () {
    if (!this.activeAnnotationPopupEl) return;
    const el = this.activeAnnotationPopupEl;
    this.activeAnnotationPopupEl = null;
    env().yl(el, new env().dl({ duration: 200, fn: "cubic-bezier(0.34, 1.56, 0.64, 1)" })
      .addProp("transform", "translate(-50%, 0) scale(1)", "translate(-50%, -1px) scale(0.9)")
      .addProp("opacity", "1", "0"), () => el.detach());
  };
  proto.clearEphemeralUI = function () {
    this.destroyAnnotationPopup();
    this.clearAnnotationHighlight();
    this.clearTextHighlight();
    this.subpathHighlight = null;
  };
  proto.getAnnotationFromEvt = function (pageView, evt) {
    const point = pageView.getPagePointFromEvent(evt);
    return pageView.annotationLayer.getAnnotationAtPoint(point[0], point[1]);
  };
  proto.onAnnotationPointerDown = function (evt) {
    const self = this;
    if (evt.button !== 0 || env().Kl(evt) || this.activeAnnotationPopupEl?.contains(evt.targetNode)) return;
    const pageEl = evt.target.closest(".page");
    if (!pageEl || !pageEl.dataset.pageNumber) { this.clearEphemeralUI(); return; }
    const pageNumber = parseInt(pageEl.dataset.pageNumber);
    const pageView = this.getPage(pageNumber);
    const view = evt.view, clientX = evt.clientX, clientY = evt.clientY, pointerId = evt.pointerId;
    let dragged = false;
    const onMove = (moveEvt) => {
      if (moveEvt.pointerId === pointerId && Math.hypot(clientX - moveEvt.clientX, clientY - moveEvt.clientY) > 5) dragged = true;
    };
    const onUp = (upEvt) => {
      const popupId = self.activeAnnotationPopupEl?.dataset.annotationId;
      cleanup();
      self.clearEphemeralUI();
      if (dragged) return;
      const annotation = self.getAnnotationFromEvt(pageView, evt);
      if (annotation && annotation.data.subtype !== "Widget" && annotation.data.subtype !== "Link" && annotation.data.id !== popupId) {
        self.renderAnnotationPopup(annotation);
      }
    };
    const cleanup = () => {
      view.removeEventListener("pointermove", onMove);
      view.removeEventListener("pointerup", onUp);
      view.removeEventListener("pointercancel", onUp);
    };
    view.addEventListener("pointermove", onMove);
    view.addEventListener("pointerup", onUp);
    view.addEventListener("pointercancel", onUp);
  };
  proto.getPageLinkAlias = function (pageNumber) {
    return `${this.file.basename}, ${s11PdfStrings().labelPage({ page: pageNumber })}`;
  };
  proto.getTextSelectionRangeStr = function (win) {
    const selection = win.getSelection();
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!range || range.collapsed) return null;
    const start = s11TextLayerNode(win.document, range.startContainer);
    const end = s11TextLayerNode(win.document, range.endContainer);
    if (!start || !end) return null;
    const startOffset = s11TextLayerOffset(start, range.startContainer, range.startOffset);
    const endOffset = s11TextLayerOffset(end, range.endContainer, range.endOffset);
    if (startOffset === null || endOffset === null) return null;
    return `${start.dataset.idx},${startOffset},${end.dataset.idx},${endOffset}`;
  };
  proto.onContextMenu = async function (evt) {
    if (!env().Yl.isDesktopApp) return;
    const target = evt.target;
    const pageEl = target.closest(".page");
    if (!(pageEl instanceof HTMLElement)) return;
    const pageNumber = parseInt(pageEl.dataset.pageNumber);
    if (Number.isNaN(pageNumber)) return;
    let canCopy = true, noWebContents = false, electronWindow = null, webContents = null;
    const electron = env().Yl.isDesktopApp && evt.win.electron && evt.isTrusted ? evt.win.electron : null;
    if (electron) {
      const info = await host.electronMenuInfo(evt);
      if (!info || evt.defaultPrevented) return;
      webContents = electron.remote.webContents.fromId(info.webContentsId);
      canCopy = (info.editFlags || {}).canCopy;
    } else {
      noWebContents = true;
    }
    const pageView = this.getPage(pageNumber);
    const selection = evt.view.getSelection();
    let selectedText = selection.toString();
    if (selectedText) {
      selectedText = pdfjs().removeNullCharacters(pdfjsLib().normalizeUnicode(selectedText.replace(/[\n\r]+/g, " ")));
    }
    const menu = new host.Menu().addSections(["action", "selection", "annotation"]);
    if (env().Yl.isMacOS && electron && selectedText) {
      menu.addItem((item) => item.setSection("action").setTitle(env().gm.interface.menu.lookupSelection({ selection: env().gc(selectedText, 25) }))
        .setIcon("lucide-library")
        .onClick(() => electron.remote.getCurrentWebContents().showDefinitionForSelection()));
    }
    const annotation = this.getAnnotationFromEvt(pageView, evt);
    let annotationId = null, annotatedText = null;
    if (annotation && annotation.data.subtype !== "Widget") {
      annotationId = annotation.data.id;
      annotatedText = await this.getAnnotatedText(pageView, annotationId);
    }
    if (selectedText) {
      menu.addItem((item) => item.setSection("selection").setTitle(env().gm.interface.menu.copy()).setIcon("lucide-copy")
        .setDisabled(!canCopy)
        .onClick(() => {
          if (electron && webContents) webContents.copy();
          else navigator.clipboard.writeText(selectedText);
        }));
    }
    const rangeStr = this.getTextSelectionRangeStr(pageEl);
    let selectionLink = null;
    if (rangeStr) {
      selectionLink = this.getMarkdownLink(`#page=${pageNumber}&selection=${rangeStr}`, this.getPageLinkAlias(pageNumber));
      menu.addItem((item) => item.setSection("selection").setTitle(s11PdfStrings().actionCopyQuote()).setIcon("lucide-copy")
        .onClick(() => navigator.clipboard.writeText(`> ${selectedText.replace(/[\r\n]+/g, " ")}\n\n${selectionLink}`)));
      menu.addItem((item) => item.setSection("selection").setTitle(s11PdfStrings().actionCopySelectionLink()).setIcon("lucide-copy")
        .onClick(() => navigator.clipboard.writeText(selectionLink)));
    }
    if (annotationId) {
      const link = this.getMarkdownLink(`#page=${pageNumber}&annotation=${annotationId}`, this.getPageLinkAlias(pageNumber));
      if (annotatedText) {
        menu.addItem((item) => item.setSection("annotation").setTitle(s11PdfStrings().actionCopyAnnotation()).setIcon("lucide-copy")
          .onClick(() => navigator.clipboard.writeText(`> ${annotatedText}\n\n${link}`)));
      }
      menu.addItem((item) => item.setSection("annotation").setTitle(s11PdfStrings().actionCopyAnnotLink()).setIcon("lucide-copy")
        .onClick(() => navigator.clipboard.writeText(link)));
    }
    this.clearEphemeralUI();
    menu.showAtMouseEvent(evt);
    if (this.opts?.isEmbed || noWebContents) evt.preventDefault();
  };
  proto.onMobileCopy = function (evt, source) {
    const div = source.div, pageId = source.id;
    const text = evt.clipboardData.getData("text/plain");
    if (!text) return;
    const rangeStr = this.getTextSelectionRangeStr(div);
    if (rangeStr) {
      const link = this.getMarkdownLink(`#page=${pageId}&selection=${rangeStr}`, this.getPageLinkAlias(pageId));
      evt.clipboardData.setData("text/plain", `> ${text}\n\n${link}`);
    }
  };
  proto.onThumbnailContextMenu = function (evt) {
    const target = evt.targetNode;
    if (!(target instanceof HTMLElement) || !target.hasClass("thumbnail")) return;
    const pageNumber = parseInt(target.dataset.pageNumber);
    if (Number.isNaN(pageNumber)) return;
    const link = this.getMarkdownLink(`#page=${pageNumber}`, this.getPageLinkAlias(pageNumber));
    new host.Menu().addItem((item) => item.setTitle(s11PdfStrings().actionCopyPageLink({ page: pageNumber })).setIcon("lucide-copy")
      .onClick(() => evt.view.navigator.clipboard.writeText(link))).showAtMouseEvent(evt);
  };
  proto.getAnnotatedText = async function (pageView, annotationId) {
    const annotation = pageView.annotationLayer.annotationLayer.getAnnotation(annotationId);
    const quadPoints = annotation.data?.quadPoints;
    if (!quadPoints?.length) return null;
    const textLayer = pageView.textLayer;
    if (!textLayer.renderingDone) await textLayer.textLayer.renderingTask.promise;
    let text = "";
    for (let i = 0; i < quadPoints.length; i += 8) {
      const q = quadPoints.slice(i, i + 8);
      const xs = [q[0], q[2], q[4], q[6]], ys = [q[1], q[3], q[5], q[7]];
      const left = Math.min(...xs), right = Math.max(...xs);
      const top = Math.min(...ys), bottom = Math.max(...ys);
      const chunk = this.getTextByRect(pageView, [left, top, right, bottom]);
      if (chunk && text !== "") text += " ";
      text += chunk;
    }
    return text.trim() || null;
  };
  proto.getTextByRect = function (pageView, [left, top, right, bottom]) {
    let text = "";
    const items = pageView.textLayer.textLayer.textContentItems;
    for (const item of items) {
      if (!item.chars?.length) continue;
      for (const char of item.chars) {
        const x = (char.r[0] + char.r[2]) / 2, y = (char.r[1] + char.r[3]) / 2;
        if (x >= left && x <= right && y >= top && y <= bottom) text += char.u;
      }
    }
    return text;
  };
  proto.clearAnnotationHighlight = function () {
    if (this.annotationHighlight) {
      this.annotationHighlight.detach();
      this.annotationHighlight = null;
    }
  };
  proto.highlightAnnotation = function (pageNumber, annotationId) {
    this.clearAnnotationHighlight();
    if (pageNumber < 1 || pageNumber > this.pdfViewer.pagesCount) return;
    const pageView = this.getPage(pageNumber);
    if (!pageView?.div.dataset.loaded) return;
    const annotation = pageView.annotationLayer.annotationLayer.getAnnotation(annotationId);
    if (!annotation) return;
    const rect = annotation.data.rect, parent = annotation.parent;
    const view = parent.page.view, rawDims = parent.viewport.rawDims;
    const pageWidth = rawDims.pageWidth, pageHeight = rawDims.pageHeight, pageX = rawDims.pageX, pageY = rawDims.pageY;
    const bounds = pdfjsLib().Util.normalizeRect([rect[0], view[3] - rect[1] + view[1], rect[2], view[3] - rect[3] + view[1]]);
    pageView.annotationLayer.div.createDiv("boundingRect mod-focused", (el) => {
      el.setCssStyles({
        left: `${100 * (bounds[0] - pageX) / pageWidth}%`,
        top: `${100 * (bounds[1] - pageY) / pageHeight}%`,
        width: `${100 * (bounds[2] - bounds[0]) / pageWidth}%`,
        height: `${100 * (bounds[3] - bounds[1]) / pageHeight}%`,
      });
      this.annotationHighlight = el;
      activeWindow.setTimeout(() => pdfjs().scrollIntoView(el, { top: -50 }));
    });
  };
  proto.clearTextHighlight = function () {
    if (!this.highlightedText.length) return;
    for (const [pageNumber, divIndex] of this.highlightedText) {
      const textLayer = this.getPage(pageNumber).textLayer.textLayer;
      const divs = textLayer.textDivs, items = textLayer.textContentItems;
      const div = divs[divIndex];
      div.textContent = items[divIndex].str;
      div.className = div.hasClass("textLayerNode") ? "textLayerNode" : "";
    }
    this.highlightedText = [];
  };
  proto.highlightText = function (pageNumber, range) {
    this.clearTextHighlight();
    if (pageNumber < 1 || pageNumber > this.pdfViewer.pagesCount) return;
    const pageView = this.getPage(pageNumber);
    if (!pageView?.div.dataset.loaded) return;
    const textLayer = pageView.textLayer.textLayer;
    const divs = textLayer.textDivs, items = textLayer.textContentItems;
    const highlighted = [];
    const mark = "selected";
    const write = (divIndex, from, to, cls) => {
      highlighted.push([pageNumber, divIndex]);
      let div = divs[divIndex];
      if (div.nodeType === Node.TEXT_NODE) {
        const span = createSpan();
        div.before(span);
        span.append(div);
        divs[divIndex] = span;
        div = span;
      }
      const text = items[divIndex].str.substring(from, to);
      const node = document.createTextNode(text);
      if (cls) {
        const span = div.createSpan(`${cls} appended`);
        span.append(node);
      } else {
        div.append(node);
      }
    };
    const startAt = (divIndex, charStart, cls) => {
      highlighted.push([pageNumber, divIndex]);
      if (highlighted.length === 1) pdfjs().scrollIntoView(divs[divIndex], { top: -50 }, true);
      divs[divIndex].textContent = "";
      write(divIndex, 0, charStart, cls);
    };
    const start = range[0], end = range[1];
    const startDiv = start[0], startChar = start[1], endDiv = end[0], endChar = end[1];
    startAt(startDiv, startChar);
    if (startDiv === endDiv) {
      write(startDiv, startChar, endChar, `mod-focused ${mark}`);
    } else {
      write(startDiv, startChar, undefined, `mod-focused begin ${mark}`);
      for (let i = startDiv + 1; i < endDiv; i++) {
        highlighted.push([pageNumber, i]);
        divs[i].classList.add("mod-focused", "middle", mark);
      }
      startAt(endDiv, endChar, `mod-focused end ${mark}`);
      write(endDiv, endChar, undefined);
    }
    this.highlightedText = highlighted;
  };
  proto.loadFile = async function (file, subpath) {
    const viewer = this.pdfViewer;
    if (this.unloaded || !viewer) return;
    viewer.subpath = null;
    this.file = null;
    const open = async () => {
      try {
        if (this.opts?.displayMode) {
          viewer.pdfViewer._scrollMode = 3;
          viewer.pdfViewer._spreadMode = 0;
        }
        if (subpath) this.applySubpath(subpath);
        await viewer.open({ url: this.app.vault.getResourcePath(file), ownerDocument: this.containerEl.doc });
        if (this.opts?.displayMode) {
          const pdfViewer = viewer.pdfViewer;
          await pdfViewer._pagesCapability.promise;
          const pageView = pdfViewer.getPageView(pdfViewer._currentPageNumber - 1);
          if (!pageView.canvas) return;
          pageView.canvas.setCssStyles({ maxWidth: `${pageView.width}px`, zoom: "" });
          this.containerEl.createDiv("canvasWrapper").append(pageView.canvas);
          if (viewer.height === "auto" || viewer.height === "page") this.containerEl.setCssStyles({ height: "auto" });
        }
      } catch (e) {
        console.error(e);
      }
    };
    if (this.containerEl.offsetParent) {
      await new Promise((resolve) => {
        viewer.eventBus.on("passwordpromptopen", resolve, { once: true });
        open().finally(resolve);
      });
    } else {
      this.containerEl.onNodeInserted(open, true);
    }
  };
  proto.applySubpath = function (subpath) {
    if (!subpath) return;
    const viewer = this.pdfViewer;
    const loadingTask = viewer.pdfLoadingTask;
    const parse = (raw) => {
      if (raw[0] === "#") raw = raw.substring(1);
      const params = new URLSearchParams(raw);
      if (!params.has("page")) return { dest: raw, highlight: null };
      const page = s11ParseInt(params.get("page")) ?? 1;
      const offset = params.has("offset") ? params.get("offset").split(",") : [];
      const x = s11ParseInt(offset[0]), y = s11ParseInt(offset[1]), zoom = s11ParseInt(offset[2]);
      const dest = zoom === null ? [page - 1, { name: "FitBH" }, y] : [page - 1, { name: "XYZ" }, x, y, zoom];
      let highlight = null;
      if (params.has("annotation")) {
        highlight = { type: "annotation", page, id: params.get("annotation") };
      } else if (params.has("selection")) {
        const sel = params.get("selection").split(",");
        const a = s11ParseInt(sel[0]), b = s11ParseInt(sel[1]), c = s11ParseInt(sel[2]), d = s11ParseInt(sel[3]);
        if (a !== null && b !== null && c !== null && d !== null) highlight = { type: "text", page, range: [[a, b], [c, d]] };
      }
      const height = params.has("height") ? s11ParseInt(params.get("height")) : null;
      return { dest: JSON.stringify(dest), highlight, height };
    };
    const parsed = parse(subpath);
    if (loadingTask) {
      loadingTask.promise.then(() => viewer.applySubpath(parsed.dest));
    } else {
      viewer.subpath = parsed.dest;
    }
    this.subpathHighlight = parsed.highlight || null;
  };
  proto.onResize = function () {
    if (this.containerEl.isShown() && this.pdfViewer) {
      this.pdfViewer.eventBus.dispatch("resize", { source: this });
    }
  };
  proto.on = function (name, callback) { this.pdfViewer.eventBus._on(name, callback); };
  proto.off = function (name, callback) { this.pdfViewer.eventBus._off(name, callback); };
  proto.onCSSChange = function () {
    const viewer = this.pdfViewer;
    const container = viewer.dom.pdfContainerEl;
    const themed = !!this.app.loadLocalStorage(s11PdfIsThemedKey);
    const background = themed ? container.getCssPropertyValue("--pdf-page-background") : null;
    const invert = themed && document.body.hasClass("theme-dark");
    if (background !== viewer.pageBackground) {
      container.toggleClass("mod-themed", !!background);
      viewer.setBackground(background, invert);
    }
  };
  proto.getMarkdownLink = function (linktext, sourcePath, embed) {
    const link = this.app.fileManager.generateMarkdownLink(this.file, "", linktext, sourcePath);
    return embed ? "!" + link : link;
  };
  S11ViewerComponent = PdfViewerComponent;
  return PdfViewerComponent;
}

// ---- lazy viewer wrapper (original: GZ) ----
export function s11PdfLazyViewer(host) {
  function PdfLazyViewer(app, containerEl, opts) {
    const self = host.Component.call(this) || this;
    self.child = null;
    self.next = [];
    self.app = app;
    self.containerEl = containerEl;
    self.opts = opts;
    self.scope = new host.Scope(app.scope);
    return self;
  }
  s11Inherit(PdfLazyViewer, host.Component);
  const proto = PdfLazyViewer.prototype;
  proto.onload = async function () {
    this.registerEvent(this.app.workspace.on("css-change", () => {
      this.then((viewer) => viewer.onCSSChange());
    }));
    if (this.child) return;
    const child = (this.child = new S11ViewerComponent(this.app, this.scope, this.containerEl, this.opts));
    await child.load();
    if (this.child === child) {
      const callbacks = this.next;
      this.next = null;
      for (const cb of callbacks) cb(child);
    }
  };
  proto.onunload = function () {
    if (this.child) {
      this.child.unload();
      this.child = null;
      this.next = [];
    }
  };
  proto.then = function (callback) {
    if (this.next) this.next.push(callback);
    else if (this.child) callback(this.child);
  };
  proto.loadFile = async function (file, subpath) {
    if (this._loaded) return;
    return new Promise((resolve) => {
      this.then((viewer) => viewer.loadFile(file, subpath).then(resolve));
    });
  };
  S11LazyViewer = PdfLazyViewer;
  return PdfLazyViewer;
}

// ---- pdf file view (original: KZ) ----
export function s11PdfView(host) {
  function PdfView(leaf) {
    const self = host.EditableFileView.call(this, leaf) || this;
    self.icon = "lucide-file-text";
    const viewer = (self.viewer = self.addChild(new S11LazyViewer(self.app, self.contentEl, { removePageBorders: env().Yl.isMobile })));
    const scope = (self.scope = viewer.scope);
    const pageKey = (fn) => (evt) => {
      if (env().yg(evt.targetNode)) return;
      const pdfViewer = viewer.child?.pdfViewer?.pdfViewer;
      if (!pdfViewer) return;
      const scale = pdfViewer.currentScaleValue;
      if (["page-width", "page-height"].includes(scale)) {
        evt.preventDefault();
        fn(pdfViewer);
      }
    };
    scope.register([], "ArrowLeft", pageKey((v) => v.previousPage()));
    scope.register([], "ArrowRight", pageKey((v) => v.nextPage()));
    return self;
  }
  s11Inherit(PdfView, host.EditableFileView);
  const proto = PdfView.prototype;
  proto.onload = function () {
    host.EditableFileView.prototype.onload.call(this);
    const vault = this.app.vault;
    this.registerEvent(vault.on("modify", this.onModify, this));
  };
  proto.getViewType = function () { return "pdf"; };
  proto.onModify = function (file) { if (file === this.file) this.onLoadFile(file); };
  proto.onLoadFile = function (file) { return this.viewer.loadFile(file); };
  proto.setEphemeralState = function (state) {
    host.EditableFileView.prototype.setEphemeralState.call(this, state);
    this.viewer.then((viewer) => {
      viewer.applySubpath(state.subpath);
      if (state.focus) {
        const pdfViewer = viewer.pdfViewer.pdfViewer;
        pdfViewer.firstPagePromise?.then(() => pdfViewer.focus());
      }
    });
  };
  proto.onUnloadFile = async function () {
    await this.viewer.then((viewer) => viewer.pdfViewer.close());
  };
  proto.showSearch = function () {
    this.viewer.then((viewer) => viewer.findBar.showSearch());
  };
  PdfView.VIEW_TYPE = "pdf";
  return PdfView;
}

// ---- pdf embed (original: YZ) ----
export function s11PdfEmbedView(host) {
  function PdfEmbedView(ctx, file, subpath) {
    const self = host.Component.call(this) || this;
    self.app = ctx.app;
    self.containerEl = ctx.containerEl;
    self.file = file;
    self.subpath = subpath;
    let height = "page";
    if (subpath) {
      const params = new URLSearchParams(subpath.substring(1));
      if (params.has("height")) {
        const parsed = env().WZ(params.get("height"));
        if (parsed && parsed > 0) height = parsed;
      }
    }
    self.containerEl.addClass("pdf-embed");
    self.viewer = self.addChild(new S11LazyViewer(self.app, self.containerEl, {
      removePageBorders: true,
      isEmbed: true,
      height,
      initDelay: 300,
      displayMode: ctx.displayMode,
    }));
    self.viewer.then((viewer) => {
      const right = viewer.toolbar.toolbarRightEl;
      right.createDiv("pdf-toolbar-spacer");
      right.createDiv("clickable-icon", (el) => {
        env().tv(el, "lucide-more-vertical");
        host.setTooltip(el, env().gm.setting.about.buttonOpen());
        el.addEventListener("click", () => {
          const menu = new host.Menu().setParentElement(el);
          if (ctx.app.workspace.handleLinkContextMenu(menu, ctx.linktext, ctx.sourcePath)) {
            const rect = el.getBoundingClientRect();
            menu.showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true, left: true });
          }
        });
      });
      env().cg(viewer.pdfViewer.dom.viewerContainerEl);
    });
    return self;
  }
  s11Inherit(PdfEmbedView, host.Component);
  const proto = PdfEmbedView.prototype;
  proto.onload = function () {
    host.Component.prototype.onload.call(this);
    const vault = this.app.vault;
    this.registerEvent(vault.on("modify", (file) => {
      if (file === this.file) this.loadFile();
    }));
  };
  proto.loadFile = function () { return this.viewer.loadFile(this.file, this.subpath); };
  return PdfEmbedView;
}
