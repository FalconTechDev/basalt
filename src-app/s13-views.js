// Bases view implementations beyond the leaf renderers: the cards view virtualizes
// card items against the scroll viewport with lazy measurement, like the list view.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { floatOr, longPropertyId } from "./text.js";
import { offsetBox } from "./tree.js";
import { s13ScrollWatch, s13VisibleRect, s13PaddingBox } from "./s13-geom.js";
import { s13ViewCards, s13BasesI18n, s13BasesCardsI18n } from "./s13-consts.js";

const s13VDiv = (...args) => env().createDiv(...args);
const assign = Object.assign;

/** The cards view: groups entries into card grids, rendering only the visible range. */
export function defineS13CardsView(host) {
  function CardsView(app, scrollEl) {
    const self = host.s13BasesViewBase.call(this, app, scrollEl) || this;
    self.type = s13ViewCards;
    self.groups = [];
    self.items = [];
    self.unusedItems = [];
    self.lastViewport = null;
    self.lastScroll = { top: 0 };
    self.pendingScroll = null;
    self.thumbnailer = new host.s13Thumbnailer();
    self.testers = null;
    self.measurements = {
      pad: { top: 0, bottom: 0, start: 0, end: 0 },
      groupGap: 0,
      groupHeadingHeight: 0,
      groupPad: { top: 0, bottom: 0, start: 0, end: 0 },
      cardGap: 0,
      cardPad: { top: 0, bottom: 0, start: 0, end: 0 },
      propGap: 0,
      cardsPerRow: 1,
      cardWidth: 200,
      cardHeight: 200,
      coverHeight: 100,
      titleHeight: 24,
      propHeight: 24,
    };
    self.imageProp = null;
    self.imageFitContain = false;
    self.imageAspectRatio = 1;
    self.scrollEl = scrollEl;
    self.containerEl = scrollEl.createDiv({ cls: "bases-cards-container is-loading", attr: { tabIndex: 0 } });
    return self;
  }
  inherit(CardsView, host.s13BasesViewBase);

  CardsView.prototype.onload = function () {
    const self = this;
    this.scrollWatcher = s13ScrollWatch(this.containerEl, () => self.updateVirtualDisplay());
    this.registerEvent(this.app.workspace.on("css-change", this.updateVirtualDisplay, this));
  };

  CardsView.prototype.onunload = function () {
    this.scrollWatcher?.call(this);
    this.scrollWatcher = null;
  };

  CardsView.prototype.onResize = function () {
    this.updateVirtualDisplay();
  };

  CardsView.prototype.focus = function () {
    this.containerEl.focus({ preventScroll: true });
  };

  CardsView.prototype.onDataUpdated = function () {
    this.containerEl.removeClass("is-loading");
    this.display();
  };

  CardsView.prototype.display = function () {
    const data = this.data;
    if (data && data.data.length !== 0) {
      const self = this;
      host.s13ReconcileCells(this.groups, data.groupedData,
        () => true,
        () => new host.s13CardsGroupHeader(self),
        (group, entry) => group.render(entry));
      this.updateVirtualDisplay();
    } else {
      this.containerEl.empty();
    }
  };

  CardsView.prototype.updateVirtualDisplay = function () {
    const self = this;
    const data = this.data;
    const config = this.config;
    const containerEl = this.containerEl;
    if (!(data && config && containerEl.isShown())) return;
    const groups = this.groups;
    const items = this.items;
    const unusedItems = this.unusedItems;
    const m = this.measurements;
    let testers = this.testers;
    const lastViewport = this.lastViewport;
    const properties = data.properties;
    if (groups.length === 0) {
      containerEl.empty();
      return;
    }
    if (!testers) {
      testers = this.testers = {
        group: s13VDiv("bases-cards-group"),
        groupHeading: s13VDiv("bases-group-heading"),
        card: s13VDiv("bases-cards-item"),
        cover: s13VDiv("bases-cards-cover"),
        title: s13VDiv("bases-cards-property mod-title"),
        prop: s13VDiv("bases-cards-property"),
      };
      testers.groupHeading.setText("Fj");
      testers.group.appendChild(testers.card);
      testers.card.appendChild(testers.cover);
      testers.card.appendChild(testers.title);
      testers.title.createDiv({ cls: "bases-cards-label", text: "Fj" });
      testers.title.createDiv({ cls: "bases-cards-line", text: "Fj" });
      testers.card.appendChild(testers.prop);
      testers.prop.createDiv({ cls: "bases-cards-label", text: "Fj" });
      testers.prop.createDiv({ cls: "bases-cards-line", text: "Fj" });
      testers.groupHeading.setCssStyles({ opacity: "0", pointerEvents: "none", zIndex: "-1" });
      testers.group.setCssStyles({ opacity: "0", pointerEvents: "none", zIndex: "-1", width: m.cardWidth + "px", height: "100px" });
      testers.card.setCssStyles({ width: "100%", height: "100%" });
    }
    if (!testers.group.parentNode) containerEl.prepend(testers.group);
    if (!testers.groupHeading.parentNode) containerEl.prepend(testers.groupHeading);
    const imageSetting = config.get("image");
    this.imageProp = imageSetting && String.isString(imageSetting) ? longPropertyId(imageSetting) : null;
    this.imageFitContain = config.get("imageFit") === "contain";
    const aspectSetting = config.get("imageAspectRatio");
    this.imageAspectRatio = aspectSetting && Number.isNumber(aspectSetting) && aspectSetting > 0 ? aspectSetting : 1;
    let cardSize = 200;
    const sizeSetting = config.get("cardSize");
    if (sizeSetting && Number.isNumber(sizeSetting) && sizeSetting > 0) cardSize = sizeSetting;
    const scale = floatOr(containerEl.getCssPropertyValue("--bases-cards-scale"), 1);
    if (scale > 0) cardSize *= scale;
    const containerStyle = getComputedStyle(containerEl);
    m.pad = s13PaddingBox(containerStyle);
    m.groupGap = floatOr(containerStyle.gap, 0);
    const groupStyle = getComputedStyle(groups[0].containerEl);
    m.groupPad = s13PaddingBox(groupStyle);
    m.cardGap = floatOr(groupStyle.gap, 0);
    m.groupHeadingHeight = testers.groupHeading.offsetHeight;
    const cardStyle = getComputedStyle(testers.card);
    m.cardPad = s13PaddingBox(cardStyle);
    m.propGap = floatOr(cardStyle.gap, 0);
    m.titleHeight = testers.title.offsetHeight;
    m.propHeight = testers.prop.offsetHeight;
    m.coverHeight = testers.cover.offsetHeight;
    const contentWidth = containerEl.clientWidth - m.pad.start - m.groupPad.start - m.groupPad.end - m.pad.end;
    m.cardsPerRow = Math.max(1, Math.floor(contentWidth / cardSize));
    m.cardWidth = (contentWidth - m.cardGap * (m.cardsPerRow - 1)) / m.cardsPerRow;
    m.cardHeight = 0;
    if (this.imageProp) {
      m.coverHeight = m.cardWidth * this.imageAspectRatio;
      m.cardHeight += m.coverHeight;
    }
    if (properties.length > 0) m.cardHeight += m.cardPad.top + m.cardPad.bottom + m.titleHeight;
    if (properties.length > 1) m.cardHeight += (m.propHeight + m.propGap) * (properties.length - 1);
    let viewport = s13VisibleRect(containerEl);
    this.lastViewport = assign({}, viewport);
    if (lastViewport) {
      const margin = Math.min(viewport.bottom - viewport.top, window.innerHeight / 2, 2 * m.cardHeight);
      if (viewport.top < lastViewport.top) viewport.top -= Math.min(lastViewport.top - viewport.top, margin);
      if (viewport.bottom > lastViewport.bottom) viewport.bottom += Math.min(viewport.bottom - lastViewport.bottom, margin);
    }
    const activeEl = containerEl.doc.activeElement;
    if (containerEl.contains(activeEl) && containerEl !== activeEl) {
      const box = offsetBox(activeEl, containerEl);
      if (box.top < viewport.top) viewport.top = box.top;
      const bottom = box.top + activeEl.offsetHeight;
      if (bottom > viewport.bottom) viewport.bottom = bottom;
    }
    const children = [testers.groupHeading, testers.group];
    const visibleItems = [];
    let top = m.pad.top;
    for (let i = 0; i < data.groupedData.length; i++) {
      const group = groups[i];
      const entry = data.groupedData[i];
      const entries = entry.entries;
      const groupTop = top;
      const rows = Math.ceil(entries.length / m.cardsPerRow);
      const groupBody = rows === 0 ? 0 : rows * m.cardHeight + (rows - 1) * m.cardGap;
      const hasHeading = !!entry.key;
      if (hasHeading) {
        group.groupHeadingEl.setCssStyles({ top: groupTop + "px" });
        top += m.groupHeadingHeight;
      }
      group.containerEl.setCssStyles({
        top: top + "px",
        insetInlineStart: m.pad.start + "px",
        insetInlineEnd: m.pad.end + "px",
        height: m.groupPad.top + groupBody + m.groupPad.bottom + "px",
      });
      const bodyTop = top + m.groupPad.top;
      const bodyBottom = bodyTop + groupBody;
      if (bodyTop <= viewport.bottom && bodyBottom >= viewport.top) {
        const firstRow = Math.floor(Math.max(viewport.top - bodyTop, 0) / (m.cardHeight + m.cardGap));
        const lastRow = rows - Math.floor(Math.max(bodyBottom - viewport.bottom, 0) / (m.cardHeight + m.cardGap));
        const rowItems = [];
        for (let row = firstRow; row < lastRow; row++) {
          for (let col = 0; col < m.cardsPerRow; col++) {
            const index = row * m.cardsPerRow + col;
            if (index >= entries.length) break;
            const entryItem = entries[index];
            let item = items.findIndex((candidate) => candidate.entry.file === entryItem.file);
            let card;
            if (item !== -1) {
              card = items[item];
              items.splice(item, 1);
            } else if (unusedItems.length > 0) {
              card = unusedItems.pop();
            } else {
              card = new host.s13CardsItem(this);
            }
            visibleItems.push(card);
            card.render(entryItem, properties);
            card.el.setCssStyles({
              top: m.groupPad.top + row * (m.cardHeight + m.cardGap) + "px",
              insetInlineStart: m.groupPad.start + col * (m.cardWidth + m.cardGap) + "px",
              width: m.cardWidth + "px",
              height: m.cardHeight + "px",
            });
            rowItems.push(card.el);
          }
        }
        group.containerEl.setChildrenInPlace(rowItems);
      }
      if (hasHeading) children.push(group.groupHeadingEl);
      children.push(group.containerEl);
      top = bodyBottom + m.groupPad.bottom + m.groupGap;
    }
    containerEl.setChildrenInPlace(children);
    for (const item of items) item.el.detach();
    this.items = visibleItems;
    this.unusedItems = unusedItems = items.concat(unusedItems);
    const maxUnused = Math.max(10, 2 * m.cardsPerRow);
    if (unusedItems.length > maxUnused) unusedItems.length = maxUnused;
    if (!containerEl.style.height) {
      queueMicrotask(() => self.updateVirtualDisplay());
    }
    containerEl.setCssStyles({ height: Math.max(0, top - m.groupGap + m.pad.bottom) + "px" });
    const scrollEl = this.scrollEl;
    if (this.pendingScroll) {
      scrollEl.scrollTop = top * this.pendingScroll.top;
      this.lastScroll = this.pendingScroll;
      this.pendingScroll = null;
    } else {
      this.lastScroll = { top: scrollEl.scrollTop / top };
    }
  };

  CardsView.prototype.setEphemeralState = function (state) {
    const scroll = state.scroll;
    if (scroll && typeof scroll === "object") this.pendingScroll = scroll;
  };

  CardsView.prototype.getEphemeralState = function () {
    const state = {};
    state.scroll = this.lastScroll;
    return state;
  };

  CardsView.getViewOptions = function () {
    const cardsI18n = s13BasesCardsI18n();
    return [
      { displayName: cardsI18n.labelCardSize(), type: "slider", key: "cardSize", min: 50, max: 800, step: 10, default: 200 },
      { displayName: cardsI18n.labelImageProperty(), type: "property", key: "image", filter: (id) => id === "file.file" || !id.startsWith("file."), placeholder: s13BasesI18n().labelPropertyKey() },
      { displayName: cardsI18n.labelImageFit(), type: "dropdown", key: "imageFit", options: { "": cardsI18n.optionImageFitCover(), contain: cardsI18n.optionImageFitContain() } },
      { displayName: cardsI18n.labelImageAspectRatio(), type: "slider", key: "imageAspectRatio", min: 0.25, max: 2.5, step: 0.05, default: 1 },
    ];
  };

  return CardsView;
}
