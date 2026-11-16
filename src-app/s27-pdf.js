// PDF viewing: the password dialog, the toolbar, the viewer controller that drives the bundled
// pdf.js viewer, the lazy loading component, the file view and the markdown embed. The pdf.js
// library itself stays bundled; this is the application glue around it.
//
// Everything the inherited code reached through bundle scope comes in through `host`
// (__basaltHost): the pdf.js namespaces, the viewer config, the l10n/find-bar/outline helpers
// that neighbouring slices still own, and the small DOM helpers.

import { inherit } from "./inherit.js";
import { hostEnv } from "./env.js";
import { debounceCall } from "./timing.js";
import { runTransition } from "./animation.js";
import { ellipsize, intOrNull } from "./text.js";
import { isEditableNode } from "./tree.js";

/** i18n table the inherited neighbours (ym, xK) still read through the RZ/VZ/zZ aliases. */
export function s27PdfI18n() { return hostEnv().gm.pdf; }

/** localStorage key remembering whether the pdf pages adapt to the theme. */
export const s27PdfStorageKey = "pdfjs-is-themed";

/** Character offset of `node` inside the text layer `root`, or null when `node` is outside it. */
export function s27TextOffsetAt(root, node, offset) {
  if (!root.contains(node)) return null;
  let pos = offset;
  const walker = root.doc.createNodeIterator(root, NodeFilter.SHOW_TEXT);
  let cur;
  while ((cur = walker.nextNode()) && node !== cur) pos += cur.textContent.length;
  return pos;
}

/** The `.textLayerNode` element containing `node` inside `root`, or null. */
export function s27TextLayerNodeAt(root, node) {
  if (!root.contains(node)) return null;
  if (node.instanceOf(HTMLElement) && node.hasClass("textLayerNode")) return node;
  let cur = node;
  while ((cur = cur.parentNode)) {
    if (cur === root) return null;
    if (cur.instanceOf(HTMLElement) && cur.hasClass("textLayerNode")) return cur;
  }
  return null;
}

// The six classes below reference each other; they are built lazily through this cache so a
// factory can run at its original bundle position before every superclass exists.
const s27PdfKit = {};
function s27PdfClass(host, key, make) {
  return s27PdfKit[key] || (s27PdfKit[key] = make(host));
}

export function s27PdfPasswordDialogClass(host) { return s27PdfClass(host, "password", () => buildS27PasswordDialog(host)); }
export function s27PdfToolbarClass(host) { return s27PdfClass(host, "toolbar", () => buildS27PdfToolbar(host)); }
export function s27PdfViewerClass(host) { return s27PdfClass(host, "viewer", () => buildS27PdfViewer(host)); }
export function s27PdfComponentClass(host) { return s27PdfClass(host, "component", () => buildS27PdfComponent(host)); }
export function s27PdfViewClass(host) { return s27PdfClass(host, "view", () => buildS27PdfView(host)); }
export function s27PdfEmbedClass(host) { return s27PdfClass(host, "embed", () => buildS27PdfEmbed(host)); }

function buildS27PasswordDialog(host) {
  /** Password prompt shown by the pdf.js event bus when a document needs one. */
  function PdfPasswordDialog(containerEl, eventBus) {
    this.updateCallback = null;
    this.reason = null;
    this.containerEl = containerEl;
    this.eventBus = eventBus;
  }
  const proto = PdfPasswordDialog.prototype;

  proto.buildUI = function () {
    const self = this;
    const pdf = host.t.pdf;
    const wrong = this.reason === host.s27PdfLib.PasswordResponses.INCORRECT_PASSWORD;
    this.dialogEl = this.containerEl.createDiv("pdf-password-dialog", (el) => {
      host.setIcon(el.createDiv("pdf-lock-icon"), "lucide-lock");
      el.createDiv({ text: pdf.msgPasswordProtected() });
      el.createDiv({ text: wrong ? pdf.msgInvalidPassword() : pdf.msgEnterPassword(), cls: wrong ? "mod-warning mod-small" : "mod-small" });
      el.createEl("input", { type: "password", placeholder: host.t.setting.account.labelPassword() }, (input) => {
        input.addEventListener("keydown", (evt) => { if (evt.code === "Enter") self.verify(input.value); });
        setTimeout(() => input.focus());
      });
    });
  };

  proto.open = async function () {
    this.buildUI();
    this.eventBus.dispatch("passwordpromptopen", { source: this });
  };

  proto.close = function () {
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

  return PdfPasswordDialog;
}

function buildS27PdfToolbar(host) {
  /** Icon toolbar above the pdf pages: sidebar toggle, zoom, display options and the page input. */
  function PdfToolbar(app, containerEl, viewer) {
    const self = this;
    const pdfViewer = viewer.pdfViewer;
    const eventBus = pdfViewer.eventBus;
    this.pdfViewer = pdfViewer;
    this.eventBus = eventBus;
    this.toolbarEl = containerEl.createDiv({ cls: "pdf-toolbar", prepend: true }, (bar) => {
      bar.createDiv("pdf-toolbar-left", (left) => {
        self.toolbarLeftEl = left;
        self.sidebarToggleEl = left.createDiv("clickable-icon", (el) => {
          host.setTooltip(el, host.t.pdf.actionToggleSidebar());
          host.setIcon(el, "lucide-layout-list");
          el.addEventListener("click", () => eventBus.dispatch("togglesidebar", { source: self }));
        });
        self.sidebarOptionsEl = left.createDiv("clickable-icon", (el) => {
          host.setIcon(el, "lucide-chevron-down");
          host.setTooltip(el, host.t.pdf.tooltipSidebarOptions());
          let open = false;
          el.addEventListener("click", () => {
            if (open) return;
            const sidebar = pdfViewer.pdfSidebar;
            const hasOutline = pdfViewer.pdfOutlineViewer.outline;
            const thumbs = sidebar.isOpen && sidebar.active === 1;
            const outline = sidebar.isOpen && sidebar.active === 2;
            const menu = new host.Menu().addSections(["view", "action"])
              .addItem((item) => item.setSection("view").setIcon("lucide-layout-grid").setTitle(host.t.pdf.actionShowThumbnails()).setChecked(thumbs).onClick(() => sidebar.switchView(thumbs ? 0 : 1, true)))
              .addItem((item) => item.setSection("view").setIcon("lucide-list").setTitle(host.t.pdf.actionShowOutline()).setChecked(outline).setDisabled(!hasOutline).onClick(() => sidebar.switchView(outline ? 0 : 2, true)))
              .addItem((item) => item.setSection("action").setIcon("lucide-list-start").setTitle(host.t.pdf.actionRevealInOutline()).setDisabled(!hasOutline).onClick(() => {
                if (!outline) sidebar.switchView(2, true);
                eventBus.dispatch("currentoutlineitem", { source: self });
              }));
            menu.onHide(() => { open = false; });
            const rect = el.getBoundingClientRect();
            menu.setParentElement(el).showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true, left: false });
            open = true;
          });
        });
        left.createDiv("pdf-toolbar-spacer");
        self.zoomOutEl = left.createDiv("clickable-icon", (el) => {
          host.setTooltip(el, host.t.commands.zoomOut());
          host.setIcon(el, "lucide-zoom-out");
          el.addEventListener("click", () => eventBus.dispatch("zoomout", { source: self }));
        });
        left.createDiv("pdf-toolbar-divider");
        self.zoomInEl = left.createDiv("clickable-icon", (el) => {
          host.setTooltip(el, host.t.commands.zoomIn());
          host.setIcon(el, "lucide-zoom-in");
          el.addEventListener("click", () => eventBus.dispatch("zoomin", { source: self }));
        });
        left.createDiv("clickable-icon", (el) => {
          host.setIcon(el, "lucide-chevron-down");
          host.setTooltip(el, host.t.pdf.tooltipDisplayOptions());
          let open = false;
          el.addEventListener("click", () => {
            if (open) return;
            const inner = pdfViewer.pdfViewer;
            const scale = inner.currentScaleValue;
            const fitWidth = scale === "page-width";
            const fitHeight = scale === "page-height";
            const spread = inner.spreadMode;
            const single = spread === 0;
            const odd = spread === 1;
            const even = spread === 2;
            const themed = app.loadLocalStorage(s27PdfStorageKey);
            const menu = new host.Menu().addSections(["zoom", "spread", "appearance"])
              .addItem((item) => item.setSection("zoom").setIcon("lucide-move-horizontal").setTitle(host.t.pdf.actionFitWidth()).setChecked(fitWidth).onClick(() => eventBus.dispatch("scalechanged", { source: self, value: "page-width" })))
              .addItem((item) => item.setSection("zoom").setIcon("lucide-move-vertical").setTitle(host.t.pdf.actionFitHeight()).setChecked(fitHeight).onClick(() => eventBus.dispatch("scalechanged", { source: self, value: "page-height" })))
              .addItem((item) => item.setSection("spread").setIcon("lucide-rectangle-vertical").setTitle(host.t.pdf.labelSpreadSingle()).setChecked(single).onClick(() => eventBus.dispatch("switchspreadmode", { source: self, mode: 0 })))
              .addItem((item) => item.setSection("spread").setIcon("rectangle-vertical-double").setTitle(host.t.pdf.labelSpreadOdd()).setChecked(odd).onClick(() => eventBus.dispatch("switchspreadmode", { source: self, mode: 1 })))
              .addItem((item) => item.setSection("spread").setIcon("rectangle-vertical-double").setTitle(host.t.pdf.labelSpreadEven()).setChecked(even).onClick(() => eventBus.dispatch("switchspreadmode", { source: self, mode: 2 })))
              .addItem((item) => item.setSection("appearance").setIcon("lucide-palette").setTitle(host.t.pdf.labelAdaptToTheme()).setChecked(!!themed).onClick(() => {
                app.saveLocalStorage(s27PdfStorageKey, themed ? null : "true");
                viewer.onCSSChange();
              }));
            menu.onHide(() => { open = false; });
            const rect = el.getBoundingClientRect();
            menu.setParentElement(el).showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true, left: false });
            open = true;
          });
        });
        left.createDiv("pdf-toolbar-spacer");
        self.pageInputEl = left.createEl("input", { cls: "pdf-page-input" }, (input) => {
          input.addEventListener("click", () => input.select());
          input.addEventListener("change", () => eventBus.dispatch("pagenumberchanged", { source: self, value: input.value }));
        });
        self.pageNumberEl = left.createSpan("pdf-page-numbers");
      });
      bar.createDiv("pdf-toolbar-right", (right) => { self.toolbarRightEl = right; });
    });
    eventBus._on("sidebarviewchanged", (evt) => {
      self.sidebarToggleEl.toggleClass("is-active", evt.view > 0);
    });
    this.eventBus = eventBus;
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
    this.pageScaleValue = host.s27PdfViewerNs.DEFAULT_SCALE_VALUE;
    this.pageScale = host.s27PdfViewerNs.DEFAULT_SCALE;
    this.updateUIState(true);
    this.updateLoadingIndicatorState();
    this.eventBus.dispatch("toolbarreset", { source: this });
  };

  proto.updateUIState = function (reset = false) {
    const pagesCount = this.pagesCount;
    const pageNumber = this.pageNumber;
    const pageScale = this.pageScale;
    const pageInputEl = this.pageInputEl;
    const pageNumberEl = this.pageNumberEl;
    if (reset) {
      if (this.hasPageLabels) pageInputEl.type = "text";
      else {
        pageInputEl.type = "number";
        pageNumberEl.textContent = host.t.pdf.labelOfPages({ count: pagesCount });
      }
      pageInputEl.max = pagesCount.toString();
    }
    if (this.hasPageLabels) {
      pageInputEl.value = this.pageLabel;
      pageNumberEl.textContent = host.t.pdf.labelPageOfPages({ current: pageNumber, count: pagesCount });
    } else {
      pageInputEl.value = pageNumber.toString();
    }
    this.prevPageEl?.toggleClass("mod-disabled", pageNumber <= 1);
    this.nextPageEl?.toggleClass("mod-disabled", pageNumber >= pagesCount);
    this.zoomOutEl.toggleClass("mod-disabled", pageScale <= host.s27PdfViewerNs.MIN_SCALE);
    this.zoomInEl.toggleClass("mod-disabled", pageScale >= host.s27PdfViewerNs.MAX_SCALE);
  };

  proto.updateLoadingIndicatorState = function (loading = false) {
    this.pageInputEl.toggleClass("mod-page-loading", loading);
  };

  return PdfToolbar;
}

function buildS27PdfViewer(host) {
  const lib = () => host.s27PdfLib;
  const viewerNs = () => host.s27PdfViewerNs;
  const i18n = () => host.t.pdf;

  /** Controller around one pdf.js viewer instance: DOM scaffold, subpath highlighting,
   *  annotation popups, selection/context-menu actions and file (re)loading. */
  function PdfViewerController(app, scope, containerEl, opts) {
    this.subpathHighlight = null;
    this.unloaded = false;
    this.annotationHighlight = null;
    this.highlightedText = [];
    this.app = app;
    this.scope = scope;
    this.containerEl = containerEl;
    this.opts = opts;
    this.resizeObserver = new ResizeObserver(debounceCall(() => this.onResize(), 200, true));
  }
  const proto = PdfViewerController.prototype;

  proto.load = async function () {
    if (this.opts?.initDelay) {
      await host.sleep(this.opts.initDelay);
      if (this.unloaded) return;
    }
    await host.s27LoadPdfViewer();
    if (host.Platform.isMobile) host.s27PdfConfig.maxCanvasPixels = 5242880;
    if (this.unloaded) return;

    const app = this.app;
    const opts = this.opts;
    const eventBus = new viewerNs().EventBus();
    const loadingEl = this.loadingEl = this.containerEl.doc.body.createDiv();
    loadingEl.setCssStyles({ position: "fixed", opacity: "0", zIndex: "-9999" });
    const pdfContainerEl = loadingEl.createDiv("pdf-container");
    const storage = app.loadLocalStorage(s27PdfStorageKey);
    let pageBackground = null;
    let pageInvert = false;
    if (storage) {
      pdfContainerEl.addClass("mod-themed");
      pageBackground = pdfContainerEl.getCssPropertyValue("--pdf-page-background");
      pageInvert = document.body.hasClass("theme-dark");
    }
    const contentEl = loadingEl.createDiv("pdf-content-container");
    const viewerContainerEl = contentEl.createDiv("pdf-viewer-container", (el) => {
      el.style.position = "absolute";
      el.addEventListener("transitionend", (evt) => { if (evt.target === el) eventBus.dispatch("resize", { source: el }); }, true);
      el.addEventListener("contextmenu", this.onContextMenu.bind(this));
      el.addEventListener("pointerdown", this.onAnnotationPointerDown.bind(this));
    });
    const viewerEl = viewerContainerEl.createDiv("pdfViewer");
    const sidebarContainerEl = contentEl.createDiv("pdf-sidebar-container", (el) => {
      el.addEventListener("contextmenu", this.onThumbnailContextMenu.bind(this));
    });
    const sidebarContentEl = sidebarContainerEl.createDiv("pdf-sidebar-content-wrapper").createDiv("pdf-sidebar-content");
    const thumbnailViewEl = sidebarContentEl.createDiv("pdf-thumbnail-view");
    const outlineViewEl = sidebarContentEl.createDiv("pdf-outline-view hidden");
    const dom = {
      containerEl: loadingEl,
      contentEl,
      outlineViewEl,
      pdfContainerEl,
      sidebarContainerEl,
      thumbnailViewEl,
      viewerContainerEl,
      viewerEl,
    };
    const pdfViewer = this.pdfViewer = viewerNs().createObsidianPDFViewer({
      baseConfig: host.s27PdfConfig,
      dom,
      eventBus,
      height: opts?.height,
      isEmbed: opts?.isEmbed,
      l10n: new host.s27PdfL10n(),
      removePageBorders: opts?.removePageBorders,
      pageBackground,
      pageInvert,
    });
    pdfViewer.toolbar = this.toolbar = new (s27PdfClass(host, "toolbar", () => buildS27PdfToolbar(host)))(app, loadingEl, this);
    pdfViewer.findBar = this.findBar = new host.s27PdfFindBar(app, contentEl, eventBus, this.scope);
    pdfViewer.passwordPrompt = new (s27PdfClass(host, "password", () => buildS27PasswordDialog(host)))(viewerContainerEl, eventBus);
    pdfViewer.pdfOutlineViewer = new host.s27PdfOutline(this, outlineViewEl, eventBus);

    contentEl.onWindowMigrated(async () => {
      if (!this.file) return;
      const subpath = pdfViewer.subpath;
      await pdfViewer.close();
      await this.loadFile(this.file);
      if (subpath) {
        await pdfViewer.pdfLoadingTask?.promise;
        pdfViewer.applySubpath(subpath);
      }
    });

    eventBus._on("sidebarviewchanged", (evt) => { sidebarContainerEl.setAttr("data-view", evt.view); });
    this.scope.register([], "Escape", () => { this.clearEphemeralUI(); this.findBar.close(); });
    eventBus._on("find", () => this.clearEphemeralUI());
    this.resizeObserver.observe(pdfContainerEl);
    await pdfViewer.initialize();
    if (this.unloaded) {
      this.unload();
      return;
    }
    this.loadingEl?.detach();
    this.loadingEl = null;
    dom.containerEl = this.containerEl;
    this.containerEl.appendChild(this.toolbar.toolbarEl);
    this.containerEl.appendChild(pdfContainerEl);
    if (opts?.isEmbed && opts?.height) pdfViewer.setHeight(opts.height);

    eventBus._on("textlayerrendered", (evt) => {
      const source = evt.source;
      if (!source) return;
      const textLayer = source.textLayer;
      const id = source.id;
      if (host.Platform.isMobile) textLayer.div?.addEventListener("copy", (copyEvt) => this.onMobileCopy(copyEvt, source));
      if (this.subpathHighlight && this.subpathHighlight.type === "text") {
        const { page, range } = this.subpathHighlight;
        if (id === page) this.highlightText(page, range);
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
      if (this.subpathHighlight && this.subpathHighlight.type === "annotation") {
        const { page, id } = this.subpathHighlight;
        if (source?.id === page) this.highlightAnnotation(page, id);
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

  proto.getPage = function (pageNumber) { return this.pdfViewer.pdfViewer.getPageView(pageNumber - 1); };

  proto.renderAnnotationPopup = function ({ layer, data, parent }) {
    const pageView = parent.page;
    const pageNumber = pageView.pageNumber;
    const view = pageView.view;
    const page = this.getPage(pageNumber);
    const annotationId = data.id;
    const rect = data.rect;
    const contentsObj = data.contentsObj;
    const popup = createDiv("popup");
    popup.createDiv({ cls: "popupContent", attr: { dir: contentsObj.dir } }, (content) => {
      const lines = contentsObj.str.split(/(?:\r\n?|\n)/);
      for (let i = 0; i < lines.length; i++) {
        content.appendText(lines[i]);
        if (i < lines.length - 1) content.createEl("br");
      }
    });
    popup.createDiv("popupMeta", (meta) => {
      if (data.titleObj) meta.createDiv({ cls: "popupTitle", text: data.titleObj.str, attr: { dir: data.titleObj.dir } });
      const date = lib().PDFDateString.toDateObject(data.modificationDate);
      if (date) meta.createSpan({ cls: "popupDate", text: `${date.toLocaleDateString()}, ${date.toLocaleTimeString()}` });
      if (page) {
        meta.createDiv("clickable-icon", (icon) => {
          host.setIcon(icon, "lucide-copy");
          host.setTooltip(icon, host.t.interface.menu.copy());
          icon.addEventListener("click", async () => {
            const lines = [];
            const annotated = await this.getAnnotatedText(page, annotationId);
            if (annotated) lines.push(`> ${annotated}`);
            lines.push(this.getMarkdownLink(`#page=${pageNumber}&annotation=${annotationId}`));
            if (data.contentsObj?.str) lines.push(`${data.contentsObj.str}`);
            await navigator.clipboard.writeText(lines.join("\n\n"));
            host.setIcon(icon, "lucide-check");
          });
        });
      }
    });
    if (host.Platform.isPhone) {
      const modal = new host.Modal(this.app).setBackgroundOpacity("0.4");
      modal.containerEl.addClass("pdf-annotation-modal");
      modal.contentEl.append(popup);
      host.activeWindow.setTimeout(() => modal.open(), 20);
      return;
    }
    const rawDims = parent.viewport.rawDims;
    const pageWidth = rawDims.pageWidth;
    const pageHeight = rawDims.pageHeight;
    const pageX = rawDims.pageX;
    const pageY = rawDims.pageY;
    const normalized = lib().Util.normalizeRect([rect[0], view[3] - rect[1] + view[1], rect[2], view[3] - rect[3] + view[1]]);
    const wrapper = createDiv({ cls: "popupWrapper", attr: { "data-annotation-id": data.id } });
    wrapper.append(popup);
    wrapper.setCssStyles({
      left: `${(100 * ((normalized[0] + normalized[2]) / 2 - pageX)) / pageWidth}%`,
      top: `${(100 * (normalized[3] - pageY)) / pageHeight}%`,
    });
    if (data.color) {
      const [r, g, b] = data.color;
      wrapper.style.setProperty("--annotation-color", `${r}, ${g}, ${b}`);
    }
    layer.append(wrapper);
    runTransition(wrapper, new host.Transition({ duration: 200, fn: "cubic-bezier(0.34, 1.56, 0.64, 1)" }).addProp("transform", "translate(-50%, -1px) scale(0.97)", "translate(-50%, 0) scale(1)", ""));
    const viewerRect = this.pdfViewer.dom.viewerContainerEl.getBoundingClientRect();
    const popupRect = wrapper.getBoundingClientRect();
    if (!(popupRect.top > viewerRect.top && popupRect.bottom < viewerRect.bottom)) wrapper.scrollIntoView({ behavior: "smooth", block: "end" });
    this.activeAnnotationPopupEl = wrapper;
  };

  proto.destroyAnnotationPopup = function () {
    if (!this.activeAnnotationPopupEl) return;
    const el = this.activeAnnotationPopupEl;
    this.activeAnnotationPopupEl = null;
    runTransition(el, new host.Transition({ duration: 200, fn: "cubic-bezier(0.34, 1.56, 0.64, 1)" })
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
    if (evt.button !== 0 || hostEnv().Kl(evt) || this.activeAnnotationPopupEl?.contains(evt.targetNode)) return;
    const pageEl = evt.target.closest(".page");
    if (!pageEl || !pageEl.dataset.pageNumber) {
      this.clearEphemeralUI();
      return;
    }
    const pageView = this.getPage(parseInt(pageEl.dataset.pageNumber));
    const view = evt.view;
    const startX = evt.clientX;
    const startY = evt.clientY;
    const pointerId = evt.pointerId;
    let dragged = false;
    const onMove = (moveEvt) => {
      if (moveEvt.pointerId === pointerId && Math.hypot(startX - moveEvt.clientX, startY - moveEvt.clientY) > 5) dragged = true;
    };
    const onUp = (upEvt) => {
      if (upEvt.pointerId !== pointerId) return;
      cleanup();
      const openId = this.activeAnnotationPopupEl?.dataset.annotationId;
      this.clearEphemeralUI();
      if (dragged) return;
      const annotation = this.getAnnotationFromEvt(pageView, evt);
      if (annotation && annotation.data.subtype !== "Widget" && annotation.data.subtype !== "Link" && annotation.data.id !== openId) {
        this.renderAnnotationPopup(annotation);
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
    return `${this.file.basename}, ${i18n().labelPage({ page: pageNumber })}`;
  };

  proto.getTextSelectionRangeStr = function (root) {
    const selection = root.win.getSelection();
    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    if (!range || range.collapsed) return null;
    const startNode = s27TextLayerNodeAt(root, range.startContainer);
    const endNode = s27TextLayerNodeAt(root, range.endContainer);
    if (!startNode || !endNode) return null;
    const startOffset = s27TextOffsetAt(startNode, range.startContainer, range.startOffset);
    const endOffset = s27TextOffsetAt(endNode, range.endContainer, range.endOffset);
    if (startOffset === null || endOffset === null) return null;
    return `${startNode.dataset.idx},${startOffset},${endNode.dataset.idx},${endOffset}`;
  };

  proto.onContextMenu = async function (evt) {
    if (!host.Platform.isDesktopApp) return;
    const target = evt.target;
    const pageEl = target?.closest?.(".page");
    if (!(pageEl && pageEl.instanceOf(HTMLElement))) return;
    const pageNumber = parseInt(pageEl.dataset.pageNumber);
    if (Number.isNaN(pageNumber)) return;
    let preventDefault = false;
    const electronModule = evt.win.electron || null;
    let webContents = null;
    let canCopy = true;
    if (electronModule && evt.isTrusted) {
      const contents = await host.electronMenuInfo(evt);
      if (!contents || evt.defaultPrevented) return;
      webContents = electronModule.remote.webContents.fromId(contents.webContentsId);
      canCopy = (contents.editFlags || {}).canCopy;
    } else {
      preventDefault = true;
    }
    const pageView = this.getPage(pageNumber);
    let selected = evt.view.getSelection().toString();
    if (selected) {
      const cleaned = viewerNs().removeNullCharacters(lib().normalizeUnicode(selected.replace(/[\n\r]+/g, " ")));
      selected = ellipsize(cleaned, 25);
    }
    const menu = new host.Menu().addSections(["action", "selection", "annotation"]);
    if (host.Platform.isMacOS && electronModule && selected) {
      menu.addItem((item) => item.setSection("action").setTitle(host.t.interface.menu.lookupSelection({ selection: selected })).setIcon("lucide-library").onClick(() => {
        electronModule.remote.getCurrentWebContents().showDefinitionForSelection();
      }));
    }
    const annotation = this.getAnnotationFromEvt(pageView, evt);
    let annotationId = null;
    let annotationText = null;
    if (annotation && annotation.data.subtype !== "Widget") {
      annotationId = annotation.data.id;
      annotationText = await this.getAnnotatedText(pageView, annotationId);
    }
    if (selected) {
      menu.addItem((item) => item.setSection("selection").setTitle(host.t.interface.menu.copy()).setIcon("lucide-copy").setDisabled(!canCopy).onClick(() => {
        if (webContents) webContents.copy();
        else navigator.clipboard.writeText(selected);
      }));
    }
    const selectionRange = this.getTextSelectionRangeStr(pageEl);
    let selectionLink = null;
    if (selectionRange) {
      selectionLink = this.getMarkdownLink(`#page=${pageNumber}&selection=${selectionRange}`, this.getPageLinkAlias(pageNumber));
      menu.addItem((item) => item.setSection("selection").setTitle(i18n().actionCopyQuote()).setIcon("lucide-copy").onClick(() => {
        navigator.clipboard.writeText(`> ${selected.replace(/[\r\n]+/g, " ")}\n\n${selectionLink}`);
      }));
      menu.addItem((item) => item.setSection("selection").setTitle(i18n().actionCopySelectionLink()).setIcon("lucide-copy").onClick(() => {
        navigator.clipboard.writeText(selectionLink);
      }));
    }
    if (annotationId) {
      const annotationLink = this.getMarkdownLink(`#page=${pageNumber}&annotation=${annotationId}`, this.getPageLinkAlias(pageNumber));
      if (annotationText) {
        menu.addItem((item) => item.setSection("annotation").setTitle(i18n().actionCopyAnnotation()).setIcon("lucide-copy").onClick(() => {
          navigator.clipboard.writeText(`> ${annotationText}\n\n${annotationLink}`);
        }));
      }
      menu.addItem((item) => item.setSection("annotation").setTitle(i18n().actionCopyAnnotLink()).setIcon("lucide-copy").onClick(() => {
        navigator.clipboard.writeText(annotationLink);
      }));
    }
    this.clearEphemeralUI();
    menu.showAtMouseEvent(evt);
    if (this.opts?.isEmbed || preventDefault) evt.preventDefault();
  };

  proto.onMobileCopy = function (evt, source) {
    const text = evt.clipboardData.getData("text/plain");
    if (!text) return;
    const range = this.getTextSelectionRangeStr(source.div);
    if (range) {
      const link = this.getMarkdownLink(`#page=${source.id}&selection=${range}`, this.getPageLinkAlias(source.id));
      evt.clipboardData.setData("text/plain", `> ${text}\n\n${link}`);
    }
  };

  proto.onThumbnailContextMenu = function (evt) {
    const target = evt.targetNode;
    if (!(target.instanceOf(HTMLElement) && target.hasClass("thumbnail"))) return;
    const pageNumber = parseInt(target.dataset.pageNumber);
    if (Number.isNaN(pageNumber)) return;
    const link = this.getMarkdownLink(`#page=${pageNumber}`, this.getPageLinkAlias(pageNumber));
    new host.Menu().addItem((item) => item.setTitle(i18n().actionCopyPageLink({ page: pageNumber })).setIcon("lucide-copy").onClick(() => {
      evt.view.navigator.clipboard.writeText(link);
    })).showAtMouseEvent(evt);
  };

  proto.getAnnotatedText = async function (pageView, annotationId) {
    const annotation = pageView.annotationLayer.annotationLayer.getAnnotation(annotationId);
    const quadPoints = annotation.data?.quadPoints;
    if (!quadPoints?.length) return null;
    const textLayer = pageView.textLayer;
    if (!textLayer.renderingDone) await textLayer.renderingTask.promise;
    let text = "";
    for (let i = 0; i < quadPoints.length; i += 8) {
      const q = quadPoints.slice(i, i + 8);
      const x1 = q[0], y1 = q[1], x2 = q[2], y2 = q[3], x3 = q[4], y3 = q[5], x4 = q[6], y4 = q[7];
      const left = Math.min(x1, x2, x3, x4);
      const right = Math.max(x1, x2, x3, x4);
      const top = Math.min(y1, y2, y3, y4);
      const bottom = Math.max(y1, y2, y3, y4);
      const found = this.getTextByRect(pageView, [left, top, right, bottom]);
      if (found && text !== "") text += " ";
      text += found;
    }
    return text.trim() || null;
  };

  proto.getTextByRect = function (pageView, rect) {
    const [left, top, right, bottom] = rect;
    let text = "";
    const items = pageView.textLayer.textLayer.textContentItems;
    for (const item of items) {
      if (!item.chars?.length) continue;
      for (const ch of item.chars) {
        const cx = (ch.r[0] + ch.r[2]) / 2;
        const cy = (ch.r[1] + ch.r[3]) / 2;
        if (cx >= left && cx <= right && cy >= top && cy <= bottom) text += ch.u;
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
    const page = this.getPage(pageNumber);
    if (!page?.div.dataset.loaded) return;
    const annotation = page.annotationLayer.annotationLayer.getAnnotation(annotationId);
    if (!annotation) return;
    const rect = annotation.data.rect;
    const view = annotation.parent.page.view;
    const rawDims = annotation.parent.viewport.rawDims;
    const pageWidth = rawDims.pageWidth;
    const pageHeight = rawDims.pageHeight;
    const pageX = rawDims.pageX;
    const pageY = rawDims.pageY;
    const normalized = lib().Util.normalizeRect([rect[0], view[3] - rect[1] + view[1], rect[2], view[3] - rect[3] + view[1]]);
    page.annotationLayer.div.createDiv("boundingRect mod-focused", (el) => {
      el.setCssStyles({
        left: `${(100 * (normalized[0] - pageX)) / pageWidth}%`,
        top: `${(100 * (normalized[1] - pageY)) / pageHeight}%`,
        width: `${(100 * (normalized[2] - normalized[0])) / pageWidth}%`,
        height: `${(100 * (normalized[3] - normalized[1])) / pageHeight}%`,
      });
      this.annotationHighlight = el;
      host.activeWindow.setTimeout(() => viewerNs().scrollIntoView(el, { top: -50 }));
    });
  };

  proto.clearTextHighlight = function () {
    if (!this.highlightedText.length) return;
    for (const [pageNumber, divIdx] of this.highlightedText) {
      const layer = this.getPage(pageNumber).textLayer.textLayer;
      const textDivs = layer.textDivs;
      const textContentItems = layer.textContentItems;
      const div = textDivs[divIdx];
      div.textContent = textContentItems[divIdx].str;
      div.className = div.hasClass("textLayerNode") ? "textLayerNode" : "";
    }
    this.highlightedText = [];
  };

  proto.highlightText = function (pageNumber, range) {
    this.clearTextHighlight();
    if (pageNumber < 1 || pageNumber > this.pdfViewer.pagesCount) return;
    const page = this.getPage(pageNumber);
    if (!page?.div.dataset.loaded) return;
    const layer = page.textLayer.textLayer;
    const textDivs = layer.textDivs;
    const textContentItems = layer.textContentItems;
    const marked = [];
    const renderSlice = (divIdx, from, to, cls) => {
      marked.push([pageNumber, divIdx]);
      let div = textDivs[divIdx];
      if (div.nodeType === Node.TEXT_NODE) {
        const wrapper = createSpan();
        div.before(wrapper);
        wrapper.append(div);
        textDivs[divIdx] = wrapper;
        div = wrapper;
      }
      const str = textContentItems[divIdx].str.substring(from, to);
      const textNode = document.createTextNode(str);
      if (cls) div.createSpan(`${cls} appended`).append(textNode);
      else div.append(textNode);
    };
    const renderBefore = (divIdx, offset, cls) => {
      marked.push([pageNumber, divIdx]);
      if (marked.length === 1) viewerNs().scrollIntoView(textDivs[divIdx], { top: -50 }, true);
      textDivs[divIdx].textContent = "";
      renderSlice(divIdx, 0, offset, cls);
    };
    const start = range[0];
    const startDiv = start[0];
    const startOffset = start[1];
    const end = range[1];
    const endDiv = end[0];
    const endOffset = end[1];
    const mark = "selected";
    renderBefore(startDiv, startOffset);
    if (startDiv === endDiv) {
      renderSlice(startDiv, startOffset, endOffset, `mod-focused ${mark}`);
    } else {
      renderSlice(startDiv, startOffset, undefined, `mod-focused begin ${mark}`);
      for (let i = startDiv + 1; i < endDiv; i++) {
        marked.push([pageNumber, i]);
        textDivs[i].classList.add("mod-focused", "middle", mark);
      }
      renderBefore(endDiv, endOffset, `mod-focused end${mark}`);
    }
    renderSlice(endDiv, endOffset, undefined);
    this.highlightedText = marked;
  };

  proto.loadFile = async function (file, subpath) {
    const pdfViewer = this.pdfViewer;
    if (this.unloaded || !pdfViewer) return;
    pdfViewer.subpath = null;
    this.file = null;
    const open = async () => {
      const displayMode = this.opts?.displayMode;
      if (displayMode) {
        pdfViewer.pdfViewer._scrollMode = 3;
        pdfViewer.pdfViewer._spreadMode = 0;
      }
      try {
        if (subpath) this.applySubpath(subpath);
        await pdfViewer.open({ url: this.app.vault.getResourcePath(file), ownerDocument: this.containerEl.doc });
        if (displayMode) {
          await pdfViewer.pdfViewer._pagesCapability.promise;
          const pageView = pdfViewer.pdfViewer.getPageView(pdfViewer.pdfViewer._currentPageNumber - 1);
          if (!pageView.canvas) return;
          pageView.canvas.setCssStyles({ maxWidth: `${pageView.width}px`, zoom: "" });
          this.containerEl.createDiv("canvasWrapper").append(pageView.canvas);
          if (pdfViewer.height === "auto" || pdfViewer.height === "page") this.containerEl.setCssStyles({ height: "auto" });
        }
      } catch (err) {
        console.error(err);
      }
    };
    if (this.containerEl.offsetParent) {
      await new Promise((resolve) => {
        pdfViewer.eventBus.on("passwordpromptopen", resolve, { once: true });
        open().finally(resolve);
      });
    } else {
      this.containerEl.onNodeInserted(open, true);
    }
  };

  proto.applySubpath = function (subpath) {
    if (!subpath) return;
    const pdfViewer = this.pdfViewer;
    const loadingTask = pdfViewer.pdfLoadingTask;
    const parsed = parseS27PdfSubpath(subpath);
    const dest = parsed.dest;
    const highlight = parsed.highlight;
    if (loadingTask) {
      loadingTask.promise.then(() => pdfViewer.applySubpath(dest));
    } else {
      pdfViewer.subpath = dest;
    }
    this.subpathHighlight = highlight || null;
  };

  proto.onResize = function () {
    if (this.containerEl.isShown() && this.pdfViewer) this.pdfViewer.eventBus.dispatch("resize", { source: this });
  };

  proto.on = function (name, callback) { this.pdfViewer.eventBus._on(name, callback); };
  proto.off = function (name, callback) { this.pdfViewer.eventBus._off(name, callback); };

  proto.onCSSChange = function () {
    const pdfViewer = this.pdfViewer;
    const pdfContainerEl = pdfViewer.dom.pdfContainerEl;
    const themed = this.app.loadLocalStorage(s27PdfStorageKey);
    const background = themed ? pdfContainerEl.getCssPropertyValue("--pdf-page-background") : null;
    const invert = !!themed && document.body.hasClass("theme-dark");
    if (background !== pdfViewer.pageBackground) {
      pdfContainerEl.toggleClass("mod-themed", !!background);
      pdfViewer.setBackground(background, invert);
    }
  };

  proto.getMarkdownLink = function (subpath, alias, embed) {
    const link = this.app.fileManager.generateMarkdownLink(this.file, "", subpath, alias);
    return embed ? `!${link}` : link;
  };

  return PdfViewerController;
}

/** "#page=3&annotation=x&selection=..&height=..&offset=.." -> { dest, highlight, height }. */
function parseS27PdfSubpath(subpath) {
  let dest = subpath;
  if (dest[0] === "#") dest = dest.substring(1);
  const params = new URLSearchParams(dest);
  if (!params.has("page")) return { dest, highlight: null };
  const page = intOrNull(params.get("page")) ?? 1;
  const offsetParts = params.has("offset") ? params.get("offset").split(",") : [];
  const offsetX = intOrNull(offsetParts[0]);
  const offsetY = intOrNull(offsetParts[1]);
  const offsetZoom = intOrNull(offsetParts[2]);
  const destArray = offsetZoom === null
    ? [page - 1, { name: "FitBH" }, offsetY]
    : [page - 1, { name: "XYZ" }, offsetX, offsetY, offsetZoom];
  let highlight = null;
  if (params.has("annotation")) {
    highlight = { type: "annotation", page, id: params.get("annotation") };
  } else if (params.has("selection")) {
    const sel = params.get("selection").split(",");
    const a = intOrNull(sel[0]);
    const b = intOrNull(sel[1]);
    const c = intOrNull(sel[2]);
    const d = intOrNull(sel[3]);
    if (a !== null && b !== null && c !== null && d !== null) highlight = { type: "text", page, range: [[a, b], [c, d]] };
  }
  const height = params.has("height") ? intOrNull(params.get("height")) : null;
  return { dest: JSON.stringify(destArray), highlight, height };
}

function buildS27PdfComponent(host) {
  /** Lazily builds the PdfViewerController on first load and queues `then` callbacks until then. */
  function PdfComponent(app, containerEl, opts) {
    const self = host.Component.call(this) || this;
    self.child = null;
    self.next = [];
    self.app = app;
    self.containerEl = containerEl;
    self.opts = opts;
    self.scope = new host.Scope(app.scope);
    return self;
  }
  inherit(PdfComponent, host.Component);
  const proto = PdfComponent.prototype;

  proto.onload = async function () {
    this.registerEvent(this.app.workspace.on("css-change", () => {
      this.then((child) => child.onCSSChange());
    }));
    if (this.child) return;
    const child = this.child = new (s27PdfClass(host, "viewer", () => buildS27PdfViewer(host)))(this.app, this.scope, this.containerEl, this.opts);
    await child.load();
    if (this.child !== child) return;
    const queued = this.next;
    this.next = null;
    for (const cb of queued) cb(child);
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

  proto.loadFile = function (file, subpath) {
    return new Promise((resolve) => {
      if (!this._loaded) resolve();
      this.then((child) => { child.loadFile(file, subpath).then(resolve); });
    });
  };

  return PdfComponent;
}

function buildS27PdfView(host) {
  /** File view for .pdf files: wraps PdfComponent, forwards vault modify events and search. */
  function PdfView(app) {
    const self = host.EditableFileView.call(this, app) || this;
    self.icon = "lucide-file-text";
    const viewer = self.viewer = self.addChild(new (s27PdfClass(host, "component", () => buildS27PdfComponent(host)))(self.app, self.contentEl, { removePageBorders: host.Platform.isMobile }));
    const scope = self.scope = viewer.scope;
    const guard = (fn) => (evt) => {
      if (isEditableNode(evt.targetNode)) return;
      const pdfViewer = viewer.child?.pdfViewer?.pdfViewer;
      if (pdfViewer) {
        const scale = pdfViewer.currentScaleValue;
        if (["page-width", "page-height"].includes(scale)) {
          evt.preventDefault();
          fn(pdfViewer);
        }
      }
    };
    scope.register([], "ArrowLeft", guard((pdfViewer) => pdfViewer.previousPage()));
    scope.register([], "ArrowRight", guard((pdfViewer) => pdfViewer.nextPage()));
    return self;
  }
  inherit(PdfView, host.EditableFileView);
  const proto = PdfView.prototype;

  proto.onload = function () {
    host.EditableFileView.prototype.onload.call(this);
    const vault = this.app.vault;
    this.registerEvent(vault.on("modify", this.onModify, this));
  };

  proto.getViewType = function () { return "pdf"; };

  proto.onModify = function (file) {
    if (file === this.file) this.onLoadFile(file);
  };

  proto.onLoadFile = function (file) { return this.viewer.loadFile(file); };

  proto.setEphemeralState = function (eState) {
    host.EditableFileView.prototype.setEphemeralState.call(this, eState);
    this.viewer.then((child) => {
      child.applySubpath(eState.subpath);
      if (eState.focus) {
        const pdfViewer = child.pdfViewer.pdfViewer;
        pdfViewer.firstPagePromise?.then(() => pdfViewer.focus());
      }
    });
  };

  proto.onUnloadFile = async function () {
    this.viewer.then((child) => child.pdfViewer.close());
  };

  proto.showSearch = function () {
    this.viewer.then((child) => child.findBar.showSearch());
  };

  PdfView.VIEW_TYPE = "pdf";
  return PdfView;
}

function buildS27PdfEmbed(host) {
  /** Markdown embed of a pdf: PdfComponent inside the embed container plus an "open" menu button. */
  function PdfEmbed(ctx, file, subpath) {
    const self = host.Component.call(this) || this;
    self.app = ctx.app;
    self.containerEl = ctx.containerEl;
    self.file = file;
    self.subpath = subpath;
    let height = "page";
    if (subpath) {
      const params = new URLSearchParams(subpath.substring(1));
      if (params.has("height")) {
        const parsed = intOrNull(params.get("height"));
        if (parsed && parsed > 0) height = parsed;
      }
    }
    self.containerEl.addClass("pdf-embed");
    const viewer = self.viewer = self.addChild(new (s27PdfClass(host, "component", () => buildS27PdfComponent(host)))(self.app, self.containerEl, {
      removePageBorders: true,
      isEmbed: true,
      height,
      initDelay: 300,
      displayMode: ctx.displayMode,
    }));
    viewer.then((child) => {
      const rightEl = child.toolbar.toolbarRightEl;
      rightEl.createDiv("pdf-toolbar-spacer");
      rightEl.createDiv("clickable-icon", (el) => {
        host.setIcon(el, "lucide-more-vertical");
        host.setTooltip(el, host.t.setting.about.buttonOpen());
        el.addEventListener("click", () => {
          const menu = new host.Menu().setParentElement(el);
          if (ctx.app.workspace.handleLinkContextMenu(menu, ctx.linktext, ctx.sourcePath)) {
            const rect = el.getBoundingClientRect();
            menu.showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true, left: true });
          }
        });
      });
      host.s27PreserveScroll(child.pdfViewer.dom.viewerContainerEl);
    });
    return self;
  }
  inherit(PdfEmbed, host.Component);
  const proto = PdfEmbed.prototype;

  proto.onload = function () {
    host.Component.prototype.onload.call(this);
    const vault = this.app.vault;
    this.registerEvent(vault.on("modify", (file) => {
      if (file === this.file) this.loadFile();
    }));
  };

  proto.loadFile = function () { return this.viewer.loadFile(this.file, this.subpath); };

  return PdfEmbed;
}
