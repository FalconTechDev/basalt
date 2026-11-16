// Bases (database views) classes, ported slice by slice: the table rows/cells, the
// group containers, the cards and list item renderers, the list view itself and the
// clipboard paste-data reader. The big views (table/cards shells, the plugin
// registration) stay inherited; own code reaches them through __basaltHost, which every
// factory captures for its methods.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { parsePropertyId } from "./text.js";
import { propertyTypeDefaults } from "./metadata-types.js";
import { idleOrTimeout } from "./metadata-helpers.js";
import { preventMiddleClick } from "./search-view.js";
import { s13ScrollWatch, s13VisibleRect } from "./s13-geom.js";
import { s13ViewList, s13PropBullet, s13PropMarkers, s13PropIndentProperties, s13PropSeparator, s13RowHeightDefault, s13BasesTableI18n, s13BasesListI18n } from "./s13-consts.js";

// Classes produced by the define* factories below; referenced across factories, always
// through method bodies that run long after every factory has executed.
let S13TableRow = null;
let S13HeaderRow = null;
let S13EntryRow = null;
let S13HeaderCell = null;
let S13BodyCell = null;
let S13SummaryCell = null;
let S13SummaryRow = null;
let S13CardsProperty = null;
let S13ListProperty = null;
let S13ListItem = null;
let S13ListGroup = null;
let S13ListView = null;

const createDiv = (...args) => env().createDiv(...args);

/** Group header block of the cards view: a heading element refreshed from the view. */
export function defineS13CardsGroupHeader() {
  function CardsGroupHeader(view) {
    this.view = view;
    this.containerEl = createDiv("bases-cards-group");
    this.groupHeadingEl = createDiv("bases-group-heading");
  }

  CardsGroupHeader.prototype.render = function (group) {
    this.groupHeadingEl = this.view.createGroupHeadingEl(group);
  };

  return CardsGroupHeader;
}

/** Per-column width state of the table view: custom width wins, else content/header + 1 clamped. */
export function defineS13ColumnWidth() {
  function ColumnWidth() {
    this.headerWidth = 0;
    this.contentWidth = 0;
    this.customWidth = 0;
  }

  ColumnWidth.prototype.getWidth = function (min, max) {
    if (this.customWidth) return Math.max(min, this.customWidth);
    return Math.clamp(Math.max(this.contentWidth, this.headerWidth) + 1, min, max);
  };

  return ColumnWidth;
}

/**
 * Base cell of the bases table (the `bases-td` element plus the view's cell lookup).
 * Used directly as a constructor and as the base of the header/body/summary cells.
 */
export function s13BasesCellBase(view, prop) {
  this.view = view;
  this.prop = prop;
  this.el = createDiv("bases-td");
  view.cellLookup.set(this.el, this);
}

/** One `bases-tr` row: keeps its cells and shows only the slice inside the viewport. */
export function defineS13TableRow() {
  function TableRow(view) {
    this.cells = [];
    this.view = view;
    this.el = createDiv("bases-tr");
  }

  /**
   * `widths` are the pixel width of each column, `from`/`to` the visible horizontal
   * range. Cells fully outside are dropped from the DOM; visible ones are pinned with
   * absolute offsets.
   */
  TableRow.prototype.virtualize = function (widths, from, to) {
    const cells = this.cells;
    const el = this.el;
    const keep = [];
    let x = 0;
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const w = widths[i];
      const right = x + w;
      if (right >= from && x <= to) {
        keep.push(cell.el);
        cell.el.setCssStyles({ insetInlineStart: x + "px", width: w + "px" });
      }
      x = right;
    }
    el.setChildrenInPlace(keep);
  };

  S13TableRow = TableRow;
  return TableRow;
}

/** A table group: optional heading, optional summary row, then the entry rows. */
export function defineS13TableGroup() {
  function TableGroup(view) {
    this.view = view;
    const tableEl = this.tableEl = createDiv("bases-table");
    this.summaryRow = new S13SummaryRow(view, "group");
    tableEl.appendChild(this.summaryRow.el);
    this.summaryRow.el.addClass("bases-table-group-summary-row");
    this.tbodyEl = tableEl.createDiv("bases-tbody");
  }

  TableGroup.prototype.render = function (columns, group) {
    const summaryRow = this.summaryRow;
    const tableEl = this.tableEl;
    const children = [this.tbodyEl];
    const heading = this.view.createGroupHeadingEl(group);
    if (heading) children.splice(0, 0, heading);
    if (summaryRow.shouldDisplay()) {
      children.splice(1, 0, summaryRow.el);
      summaryRow.render(columns, group.entries);
    }
    tableEl.setChildrenInPlace(children);
  };

  TableGroup.prototype.virtualize = function (width, widths, from, to) {
    if (this.summaryRow.shouldDisplay()) {
      this.summaryRow.el.setCssStyles({ width: width + "px" });
      this.summaryRow.virtualize(widths, from, to);
    }
  };

  return TableGroup;
}

/** The header row of the table: one header cell per property. */
export function defineS13HeaderRow(host) {
  function HeaderRow(view) {
    const self = S13TableRow.call(this, view) || this;
    self.cells = [];
    self.el.dataset.ignoreSwipe = "true";
    return self;
  }
  inherit(HeaderRow, S13TableRow);

  HeaderRow.prototype.render = function (props) {
    const self = this;
    host.s13ReconcileCells(self.cells, props,
      (a, b) => a.prop === b,
      (prop) => new S13HeaderCell(self.view, prop),
      (cell, prop) => cell.render(prop));
  };

  S13HeaderRow = HeaderRow;
  return HeaderRow;
}

/** A body row: one editable cell per property for a single entry. */
export function defineS13EntryRow(host) {
  function EntryRow(view) {
    const self = S13TableRow.call(this, view) || this;
    return self;
  }
  inherit(EntryRow, S13TableRow);

  EntryRow.prototype.render = function (entry, props) {
    const self = this;
    this.entry = entry;
    host.s13ReconcileCells(self.cells, props,
      (a, b) => a.prop === b,
      (prop) => new S13BodyCell(self.view, prop),
      (cell, prop) => cell.render(entry));
  };

  S13EntryRow = EntryRow;
  return EntryRow;
}

/** The summary row (group or footer): aggregate cells computed over the group's entries. */
export function defineS13SummaryRow(host) {
  function SummaryRow(view, location) {
    const self = S13TableRow.call(this, view) || this;
    self.cells = [];
    self.location = location;
    return self;
  }
  inherit(SummaryRow, S13TableRow);

  SummaryRow.prototype.shouldDisplay = function () {
    const summaries = this.view.config.summaries;
    if (!summaries || Object.keys(summaries).length === 0) return false;
    const order = new Set(this.view.config.getOrder());
    let hasVisible = false;
    for (const prop in summaries) {
      if (order.has(prop)) { hasVisible = true; break; }
    }
    return !!hasVisible && (this.view.data.groupedData.length > 1 || this.location === "footer");
  };

  SummaryRow.prototype.render = function (columns, entries) {
    const self = this;
    host.s13ReconcileCells(self.cells, columns,
      (a, b) => a.prop === b,
      (prop) => new S13SummaryCell(self.view, prop),
      (cell, prop) => cell.render(prop, entries));
  };

  S13SummaryRow = SummaryRow;
  return SummaryRow;
}

/** Header cell: label, sort state, drag handle, and the column context menu. */
export function defineS13HeaderCell(host) {
  function HeaderCell(view, propertyId) {
    const self = s13BasesCellBase.call(this, view, propertyId) || this;
    const el = self.el;
    const parsed = parsePropertyId(propertyId);
    const type = parsed.type;
    const name = parsed.name;
    el.draggable = true;
    const labelEl = el.createDiv("bases-table-header");
    const innerEl = labelEl.createDiv("bases-table-header-label");
    self.innerEl = innerEl;
    self.sortEl = labelEl.createDiv({ cls: "bases-table-header-sort" });
    el.createDiv("bases-table-header-resizer").draggable = true;
    el.toggleClass("mod-formula", type === "formula");
    el.toggleClass("mod-implicit", type === "file");
    self.iconEl = innerEl.createDiv({ cls: "bases-table-header-icon" });
    self.nameEl = innerEl.createDiv({ cls: "bases-table-header-name" });
    el.addEventListener(host.Platform.isMobile ? "click" : "contextmenu", function (event) {
      const i18n = s13BasesTableI18n();
      const menu = host.Menu.forEvent(event).setParentElement(el).addSections(["action", "sort", "", "danger"]);
      menu.addItem((item) => item.setTitle(i18n.actionHideColumn()).setSection("action").setIcon("lucide-eye-off").onClick(() => {
        const order = view.config.getOrder();
        order.remove(self.prop);
        view.config.setOrder(order);
      }));
      menu.addItem((item) => item.setTitle(type === "formula" ? i18n.actionEditFormula() : i18n.actionEditProperty()).setSection("danger").setIcon("lucide-edit-3").onClick(() => {
        const sub = new host.s13BasesMenu(view.app, innerEl, name);
        sub.scrollEl.createDiv("bases-toolbar-menu-container", (container) => {
          const header = container.createDiv("bases-toolbar-menu-container-header");
          header.createDiv("menu-title").createDiv({ cls: "menu-title-inner", text: env().gm.plugins.bases.titleEditProperty({ name }) });
          const more = header.createDiv("clickable-icon");
          const actions = new host.s13PropActionsMenu(view.queryController, self.prop, false);
          more.addEventListener("click", (e) => actions.showActions(e, more));
          host.setIcon(more, "lucide-more-vertical");
          container.appendChild(actions.containerEl);
        });
        sub.setAutoDestroy(el);
        sub.setOpen(true);
      }));
      menu.addItem((item) => item.setTitle(i18n.actionSelectSummary()).setSection("action").setIcon("lucide-calculator").onClick(() => {
        const values = view.data.data.map((entry) => entry.getValue(propertyId)) || [];
        const summaryValues = new host.s13SummaryValues(view.app, values);
        new host.s13SummaryMenuController(view.queryController, view.config, propertyId, summaryValues, el);
      }));
      if (host.s13IsGroupable(propertyId, view.queryController)) {
        menu.addItem((item) => item.setTitle(i18n.actionGroupBy()).setSection("action").setIcon("lucide-group").onClick(() => {
          self.view.config.setGroupBy({ property: propertyId, direction: "ASC" });
        }));
      }
      const sort = self.view.config.getSort().find((entry) => entry.property === propertyId);
      menu.addItem((item) => item.setTitle(i18n.actionSortAZ()).setSection("sort").setChecked(sort?.direction === "ASC").setIcon("lucide-arrow-down-wide-narrow").onClick(() => {
        self.view.config.setSortProperty(propertyId, "ASC");
      }));
      menu.addItem((item) => item.setTitle(i18n.actionSortZA()).setSection("sort").setChecked(sort?.direction === "DESC").setIcon("lucide-arrow-up-narrow-wide").onClick(() => {
        self.view.config.setSortProperty(propertyId, "DESC");
      }));
      if (sort) {
        menu.addItem((item) => item.setTitle(i18n.actionSortDefault()).setSection("sort").setIcon("lucide-eraser").setWarning(true).onClick(() => {
          self.view.config.setSortProperty(propertyId, "NONE");
        }));
      }
      if (type === "note") {
        menu.setSectionSubmenu("action.changeType", { title: env().gm.properties.optionPropertyType(), icon: "lucide-info" });
        const manager = self.view.app.metadataTypeManager;
        const widgets = manager.registeredTypeWidgets;
        const info = manager.getTypeInfo(name).inferred;
        const addWidget = (widget) => {
          if (widget.reservedKeys && !widget.reservedKeys.includes(name)) return;
          const canSet = !propertyTypeDefaults.hasOwnProperty(name);
          menu.addItem((item) => item.setTitle(widget.name()).setIcon(widget.icon).setSection("action.changeType").setDisabled(!canSet).setChecked(widget.type === info.type).onClick(() => {
            manager.setType(name, widget.type);
          }));
        };
        for (const widget of Object.values(widgets)) addWidget(widget);
      }
    });
    return self;
  }
  inherit(HeaderCell, s13BasesCellBase);

  HeaderCell.prototype.render = function (propertyId) {
    this.prop = propertyId;
    const el = this.el;
    const iconEl = this.iconEl;
    const nameEl = this.nameEl;
    const sortEl = this.sortEl;
    const parsed = parsePropertyId(propertyId);
    const type = parsed.type;
    const name = parsed.name;
    el.toggleClass("mod-formula", type === "formula");
    el.toggleClass("mod-implicit", type === "file");
    nameEl.setText(this.view.config.getDisplayName(propertyId));
    if (type === "note") {
      const manager = this.view.app.metadataTypeManager;
      const widget = manager.getPropertyInfo(name).widget;
      host.setIcon(iconEl, manager.getWidget(widget).icon);
    } else if (type === "formula") {
      host.setIcon(iconEl, "lucide-square-function");
    } else if (type === "file") {
      host.setIcon(iconEl, "lucide-info");
    }
    const sort = this.view.config.getSort().find((entry) => entry.property === propertyId);
    if (sort) {
      el.setAttr("data-sort", sort.direction);
      host.setIcon(sortEl, sort.direction === "ASC" ? "lucide-chevron-up" : "lucide-chevron-down");
    } else {
      el.setAttr("data-sort", null);
      sortEl.empty();
    }
  };

  S13HeaderCell = HeaderCell;
  return HeaderCell;
}

/** Body cell: wraps the generic property renderer for one entry. */
export function defineS13BodyCell(host) {
  function BodyCell(view, propertyId) {
    const self = s13BasesCellBase.call(this, view, propertyId) || this;
    self.el.dataset.property = propertyId;
    const inner = self.el.createDiv("bases-table-cell");
    self.renderer = view.createRenderer(propertyId, inner);
    inner.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.targetNode !== inner) return;
      if (self.renderer instanceof host.s13PropEditorRenderer) {
        const editor = self.renderer.propertyEditor;
        if (editor) {
          if (editor.type === "checkbox") return;
          editor.focus("end");
        }
      }
    });
    return self;
  }
  inherit(BodyCell, s13BasesCellBase);

  BodyCell.prototype.render = function (entry) {
    this.renderer.render(entry);
  };

  S13BodyCell = BodyCell;
  return BodyCell;
}

/** Summary cell: shows the aggregate for one property plus the formula picker menu. */
export function defineS13SummaryCell(host) {
  function SummaryCell(view, propertyId) {
    const self = s13BasesCellBase.call(this, view, propertyId) || this;
    const inner = self.el.createDiv("bases-table-summary-cell");
    host.setIcon(inner.createDiv("summary-expand-button"), "lucide-chevrons-up-down");
    self.innerEl = inner.createDiv("summary-content");
    inner.addEventListener("click", () => {
      if (self.menu && self.menu.isOpen()) {
        self.menu.close();
        self.menu = null;
        return;
      }
      const entries = self.entries?.map((entry) => entry.getValue(propertyId)) || [];
      const summaryValues = new host.s13SummaryValues(view.app, entries);
      self.menu = new host.s13SummaryMenuController(view.queryController, view.config, propertyId, summaryValues, inner);
    });
    return self;
  }
  inherit(SummaryCell, s13BasesCellBase);

  SummaryCell.prototype.render = function (propertyId, entries) {
    this.prop = propertyId;
    this.entries = entries;
    const inner = this.innerEl;
    const renderedKey = this.renderedKey;
    const renderedPlaceholder = this.renderedPlaceholder;
    const renderedValue = this.renderedValue;
    const view = this.view;
    const summaryKey = view.config.getSummaryKey(propertyId);
    if (summaryKey) {
      const value = view.data.getSummaryValue(view.queryController, entries, propertyId, summaryKey);
      if (renderedKey === summaryKey && host.s13BasesValueClass.equals(renderedValue, value)) return;
      inner.empty();
      inner.createDiv({ cls: "summary-function-name", text: summaryKey });
      inner.createDiv({ cls: "summary-function-value", text: value === host.s13BasesValueEmpty.value ? env().gm.properties.labelNoValue() : value.toString() });
      this.renderedValue = value;
    } else {
      if (renderedPlaceholder) return;
      inner.empty();
      inner.createSpan({ cls: "placeholder", text: s13BasesTableI18n().labelSummary() });
      this.renderedValue = null;
    }
    this.renderedKey = summaryKey;
    this.renderedPlaceholder = !summaryKey;
  };

  S13SummaryCell = SummaryCell;
  return SummaryCell;
}

/** One property line of a cards item: label plus the value renderer. */
export function defineS13CardsProperty(host) {
  function CardsProperty(view, prop) {
    this.view = view;
    this.prop = prop;
    const el = this.el = createDiv("bases-cards-property");
    this.labelEl = el.createDiv("bases-cards-label");
    this.lineEl = el.createDiv("bases-cards-line");
    el.dataset.property = prop;
    this.renderer = new host.s13PropValueRenderer(view, prop, this.lineEl);
  }

  CardsProperty.prototype.render = function (entry) {
    const label = this.view.config.getDisplayName(this.prop);
    if (this.labelEl.getText() !== label) this.labelEl.setText(label);
    this.renderer.render(entry);
  };

  S13CardsProperty = CardsProperty;
  return CardsProperty;
}

/** One cards-view item: cover image (when an image property is configured) plus property lines. */
export function defineS13CardsItem(host) {
  function CardsItem(view) {
    this.imageValue = null;
    this.props = [];
    this.view = view;
    const el = this.el = createDiv("bases-cards-item");
    const app = view.app;
    preventMiddleClick(el);
    el.onClickEvent((event) => {
      if ((event.button === 0 || event.button === 1) && !event.defaultPrevented && this.entry) {
        const win = el.win;
        const selection = win.getSelection();
        if (selection && selection.rangeCount > 0) {
          for (let i = 0; i < selection.rangeCount; i++) {
            const range = selection.getRangeAt(i);
            if (!range.collapsed && (el.contains(range.startContainer) || el.contains(range.endContainer))) return;
          }
        }
        const active = win.document.activeElement;
        if (el === active || !el.contains(active)) {
          const target = event.targetNode;
          if (!(target.closest && target.closest("a"))) {
            event.preventDefault();
            app.workspace.openLinkText(this.entry.file.path, "", host.Keymap.isModEvent(event));
          }
        }
      }
    });
    el.addEventListener("contextmenu", (event) => {
      if (!this.entry) return;
      const file = this.entry.file;
      const menu = host.Menu.forEvent(event).addSections(["title", "open", "action-primary", "action", "info", "view", "system", "", "danger"]);
      app.workspace.handleLinkContextMenu(menu, file.path, "");
      menu.addItem((item) => item.setSection("danger").setTitle(env().gm.interface.menu.deleteFile()).setIcon("lucide-trash-2").setWarning(true).onClick(() => app.fileManager.promptForDeletion(file)));
    });
    app.dragManager.handleDrag(el, (event) => (this.entry ? app.dragManager.dragLink(event, this.entry.file.path, "") : null));
    el.addEventListener("mouseover", (event) => {
      if (host.pointerEntered(event, el) && this.entry) {
        app.workspace.trigger("hover-link", { event, source: "bases", hoverParent: app.renderContext, targetEl: el, linktext: this.entry.file.path });
      }
    });
  }

  CardsItem.prototype.render = function (entry, props) {
    const self = this;
    this.entry = entry;
    const cells = this.props;
    const el = this.el;
    let coverEl = this.coverEl;
    host.s13ReconcileCells(cells, props,
      (a, b) => a.prop === b,
      (prop) => new S13CardsProperty(self.view, prop),
      (cell) => cell.render(entry));
    const measurements = this.view.measurements;
    const children = [];
    let top = 0;
    const imageProp = this.view.imageProp;
    const imageFitContain = this.view.imageFitContain;
    if (imageProp) {
      if (!coverEl) {
        this.coverEl = coverEl = createDiv("bases-cards-cover");
      }
      let image = null;
      try {
        image = entry.getValue(imageProp);
        while (image && image instanceof host.s13BasesValueList) image = image.get(0);
      } catch (e) { /* keep null */ }
      if (!host.s13BasesValueClass.equals(image, this.imageValue)) {
        this.imageValue = image;
        let color = "";
        let url = "";
        let file = null;
        if (image instanceof host.s13BasesFileValue) file = image.file;
        else if (image instanceof host.s13BasesLinkValue) file = image.resolve();
        else if (image instanceof host.s13BasesValueText) {
          const data = image.data;
          if (data.match(/^https?:\/\//)) url = data;
          else if (host.Platform.isDesktopApp && data.startsWith("file:///")) url = host.Platform.resourcePathPrefix + data.substring(8);
          else if (/^#[a-f\d]{6}$/i.test(data)) color = data;
          else file = entry.app.metadataCache.getFirstLinkpathDest(data, entry.file.path);
        }
        if (file && host.imageExtensions.contains(file.extension)) url = this.view.app.vault.getResourcePath(file);
        coverEl.setCssStyles({ backgroundColor: color, backgroundImage: url ? `url("${url}")` : "" });
        if (url) this.view.thumbnailer.thumbnailBg(coverEl, url);
      }
      children.push(coverEl);
      coverEl.setCssStyles({ top: top + "px", insetInline: "0", height: measurements.coverHeight + "px", backgroundSize: imageFitContain ? "contain" : "cover" });
      top += measurements.coverHeight;
    } else if (coverEl) {
      coverEl.detach();
      this.coverEl = null;
      this.imageValue = null;
    }
    top += measurements.cardPad.top;
    for (let i = 0; i < cells.length; i++) {
      const prop = cells[i];
      const isTitle = i === 0;
      children.push(prop.el);
      prop.el.toggleClass("mod-title", isTitle);
      const height = isTitle ? measurements.titleHeight : measurements.propHeight;
      prop.el.setCssStyles({ top: top + "px", insetInlineStart: measurements.cardPad.start + "px", insetInlineEnd: measurements.cardPad.end + "px", height: height + "px" });
      top += height + measurements.propGap;
    }
    el.setChildrenInPlace(children);
  };

  S13CardsItem = CardsItem;
  return CardsItem;
}

/** One property of a list item: decides emptiness and renders through the value renderer. */
export function defineS13ListProperty(host) {
  function ListProperty(view, propertyId) {
    this.view = view;
    this.propertyId = propertyId;
    const el = this.el = host.createEl("span");
    this.renderer = propertyId === "file.name" ? view.createRenderer(propertyId, el) : new host.s13PropValueRenderer(view, propertyId, el);
  }

  ListProperty.prototype.render = function (entry) {
    this.entry = entry;
    try {
      const value = entry.getValue(this.propertyId);
      if (value == null
        || value instanceof host.s13BasesValueEmpty
        || (value instanceof host.s13BasesValueList && value.length() === 0)
        || (value instanceof host.s13BasesValueText && value.data === "")
        || (value instanceof host.s13BasesValueBlank && value.isEmpty())) return null;
    } catch (e) { /* fall through to render */ }
    this.renderer.render(entry);
    return this.el;
  };

  S13ListProperty = ListProperty;
  return ListProperty;
}

/** A group of the list view: heading plus lazily measured, viewport-culled rows. */
export function defineS13ListGroup() {
  function ListGroup(view, group) {
    this.headerHeight = null;
    this.group = group;
    this.view = view;
    this.rows = [];
    this.measured = false;
    const containerEl = this.containerEl = createDiv("bases-list-group");
    this.groupHeadingEl = view.createGroupHeadingEl(group);
    if (this.groupHeadingEl) containerEl.appendChild(this.groupHeadingEl);
    else this.headerHeight = 0;
    this.listEl = containerEl.createDiv("bases-list-group-list");
  }

  /**
   * Renders rows until `budget` rows produced content; unmeasured rows are measured in a
   * second pass. Returns the number of rows that produced visible content.
   */
  ListGroup.prototype.render = function (viewport, budget) {
    const entries = this.group.entries;
    const rows = this.rows;
    const view = this.view;
    const listEl = this.listEl;
    const containerEl = this.containerEl;
    let index = 0;
    let rendered = 0;
    let used = 0;
    for (let i = 0; i < entries.length && !(rendered > budget); i++) {
      const entry = entries[i];
      const row = view.getRowForEntry(entry);
      rows[i] = row;
      if (!row.measured || row.isInViewport(viewport, used)) {
        if (row.measured) used += row.height;
        index++;
        if (row.render(index)) rendered++;
        if (row.isEmpty()) {
          index--;
          row.measured = true;
          row.height = 0;
        } else if (!listEl.contains(row.el)) {
          listEl.appendChild(row.el);
        }
      } else {
        used += row.height;
        if (row.height > 0) index++;
      }
    }
    const positioned = new Map();
    if (this.headerHeight === null) this.headerHeight = this.groupHeadingEl.getBoundingClientRect().height;
    let top = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row.measured) {
        row.height = row.el.getBoundingClientRect().height;
        view.addMeasuredRow(row.height);
        row.measured = true;
      }
      if (row.isInViewport(viewport, top)) positioned.set(row.el, top + "px");
      else row.el.detach();
      top += row.height;
    }
    positioned.forEach((topCss, el) => el.setCssStyles({ top: topCss }));
    const contentHeight = this.rows.reduce((sum, row) => (row.measured ? sum + row.height : sum), 0);
    const unmeasured = entries.length - this.rows.length;
    const listHeight = contentHeight + unmeasured * view.getAverageRowHeight();
    this.height = listHeight + this.headerHeight;
    listEl.setCssStyles({ height: listHeight + "px" });
    containerEl.setCssStyles({ height: this.height + "px" });
    if (unmeasured === 0) this.measured = true;
    return rendered;
  };

  S13ListGroup = ListGroup;
  return ListGroup;
}

/** One list-view row: renders its properties with optional indentation/bullets. */
export function defineS13ListItem(host) {
  function ListItem(view, entry) {
    this.cells = [];
    this.measured = false;
    this.view = view;
    this.entry = entry;
    this.el = createDiv("bases-list-item");
    this.propertiesEl = this.el.createDiv("bases-list-item-properties");
    this.additionalPropertiesEl = this.el.createDiv("bases-list-item-properties nested");
  }

  ListItem.prototype.render = function (index) {
    const self = this;
    if (this.index === index) return false;
    this.index = index;
    const entry = this.entry;
    host.s13ReconcileCells(this.cells, this.view.order,
      (a, b) => a.propertyId === b,
      (propertyId) => new S13ListProperty(self.view, propertyId),
      null);
    const properties = [];
    const markers = () => S13ListView.getMarkers(this.view.config);
    const bullet = () => host.s13CreateSpan({ cls: "list-bullet", text: "-" });
    const number = () => host.s13CreateSpan({ cls: "list-number", text: index.toString() + "." });
    if (this.view.config.get(s13PropIndentProperties)) {
      const rows = [];
      for (let i = 0; i < this.cells.length; i++) {
        const rendered = this.cells[i].render(entry);
        if (rendered) {
          const wrap = host.createEl("span", "bases-list-property");
          if (rows.length > 0) {
            wrap.createSpan({ cls: "list-bullet", text: "-" });
            wrap.appendChild(rendered);
            rows.push(wrap);
          } else {
            const kind = markers();
            if (kind === s13PropBullet) wrap.appendChild(bullet());
            else if (kind === "number") wrap.appendChild(number());
            wrap.appendChild(rendered);
            properties.push(wrap);
          }
        } else if (i === 0) {
          return;
        }
      }
      this.el.appendChild(this.additionalPropertiesEl);
      this.additionalPropertiesEl.setChildrenInPlace(rows);
    } else {
      this.additionalPropertiesEl.detach();
      for (let i = 0; i < this.cells.length; i++) {
        const rendered = this.cells[i].render(entry);
        if (rendered) {
          const wrap = host.createEl("span", "bases-list-property");
          if (properties.length === 0) {
            const kind = markers();
            if (kind === s13PropBullet) wrap.appendChild(bullet());
            else if (kind === "number") wrap.appendChild(number());
          } else {
            properties.push(host.createEl("span", "bases-list-separator", (el) => el.setText(this.view.propertySeparator)));
          }
          wrap.appendChild(rendered);
          properties.push(wrap);
        }
      }
    }
    this.propertiesEl.setChildrenInPlace(properties);
    return true;
  };

  ListItem.prototype.isEmpty = function () {
    return !this.propertiesEl.hasChildNodes();
  };

  ListItem.prototype.isInViewport = function (viewport, top) {
    const bottom = top + this.height;
    return top <= viewport.bottom && bottom >= viewport.top;
  };

  S13ListItem = ListItem;
  return ListItem;
}

/** The list view: groups entries, virtualizes rows against the scroll viewport. */
export function defineS13ListView(host) {
  function ListView(app, containerEl) {
    const self = host.s13BasesViewBase.call(this, app) || this;
    self.type = s13ViewList;
    self.hoverPopover = null;
    self.groups = [];
    self.rowsMap = new WeakMap();
    self.lastContainerElWidth = 0;
    self.precalcQueued = null;
    self.renderQueued = null;
    self.measurements = { rowCount: 0, rowHeight: 0 };
    self.containerEl = containerEl.createDiv({ cls: "bases-list-container is-loading", attr: { tabIndex: 0 } });
    return self;
  }
  inherit(ListView, host.s13BasesViewBase);

  ListView.prototype.onload = function () {
    const self = this;
    this.scrollWatcher = s13ScrollWatch(this.containerEl, () => self.updateVirtualDisplay());
    this.registerEvent(this.app.workspace.on("css-change", this.updateVirtualDisplay, this));
  };

  ListView.prototype.onunload = function () {
    this.scrollWatcher?.call(this);
    this.scrollWatcher = null;
    this.precalcQueued?.cancel();
    this.renderQueued?.cancel();
  };

  ListView.prototype.focus = function () {
    this.containerEl.focus({ preventScroll: true });
  };

  ListView.prototype.onResize = function () {
    const el = this.containerEl;
    const prev = this.lastContainerElWidth;
    if (el.clientWidth !== prev) this.invalidateCache();
    this.updateVirtualDisplay();
  };

  ListView.prototype.queueRender = function () {
    const self = this;
    if (!this.renderQueued) {
      this.renderQueued = idleOrTimeout(() => self.updateVirtualDisplay(true), 10);
    }
  };

  ListView.getMarkers = function (config) {
    const value = config.get(s13PropMarkers);
    return value === "bullet" || value === "number" || value === "none" ? value : s13PropBullet;
  };

  ListView.getViewOptions = function (config) {
    const i18n = s13BasesListI18n();
    return [
      { displayName: i18n.labelMarkers(), key: s13PropMarkers, type: "dropdown", options: { bullet: i18n.optionBullet(), number: i18n.optionNumber(), none: i18n.optionNone() }, default: s13PropBullet },
      { displayName: i18n.labelIndentProperties(), key: s13PropIndentProperties, type: "toggle", default: false },
      { displayName: i18n.labelPropertySeparator(), key: s13PropSeparator, type: "text", default: ", ", shouldHide: (c) => !!c.get(s13PropIndentProperties) },
    ];
  };

  ListView.prototype.onDataUpdated = function () {
    const app = this.app;
    const data = this.data;
    const config = this.config;
    const containerEl = this.containerEl;
    containerEl.removeClass("is-loading");
    if (!data || data.data.length === 0) {
      containerEl.empty();
      return;
    }
    this.propertySeparator = String(config.get(s13PropSeparator) || ", ");
    this.order = config.getOrder();
    this.invalidateCache();
    containerEl.setChildrenInPlace(this.groups.map((group) => group.containerEl));
    containerEl.toggleClass("show-indentation-guide", app.vault.getConfig("showIndentGuide"));
    this.updateVirtualDisplay();
  };

  ListView.prototype.invalidateCache = function () {
    const self = this;
    this.lastRenderedViewport = null;
    const grouped = this.data?.groupedData;
    this.groups = grouped ? grouped.map((group) => new S13ListGroup(self, group)) : [];
    this.rowsMap = new WeakMap();
    this.measurements = { rowCount: 0, rowHeight: 0 };
    this.queueRender();
  };

  ListView.prototype.getRowForEntry = function (entry) {
    let row = this.rowsMap.get(entry);
    if (!row) {
      row = new S13ListItem(this, entry);
      this.rowsMap.set(entry, row);
    }
    return row;
  };

  ListView.prototype.addMeasuredRow = function (height) {
    const m = this.measurements;
    m.rowHeight += height;
    m.rowCount++;
  };

  ListView.prototype.getAverageRowHeight = function () {
    const m = this.measurements;
    return m.rowCount === 0 ? 60 : m.rowHeight / m.rowCount;
  };

  /** Lays out groups inside the visible vertical range, measuring rows lazily. */
  ListView.prototype.updateVirtualDisplay = function (force) {
    if (force === undefined) force = false;
    const containerEl = this.containerEl;
    const data = this.data;
    const groups = this.groups;
    const lastViewport = this.lastRenderedViewport;
    let precalc = this.precalcQueued;
    let queued = this.renderQueued;
    if (queued) {
      queued.cancel();
      this.renderQueued = null;
    }
    if (precalc) {
      precalc.cancel();
      this.precalcQueued = null;
    }
    if (!data) return;
    this.lastContainerElWidth = containerEl.clientWidth;
    const viewport = s13VisibleRect(containerEl);
    const allMeasured = groups.every((group) => group.measured);
    const below = !lastViewport || lastViewport.bottom - viewport.bottom > 200;
    const above = !lastViewport || viewport.top - lastViewport.top > 200;
    if (!(force || !allMeasured || below || above)) return;
    const padded = Object.assign({}, viewport);
    if (lastViewport) {
      const margin = Math.min(padded.bottom - padded.top, window.innerHeight / 2, 800);
      if (padded.top < lastViewport.top) padded.top -= Math.min(lastViewport.top - padded.top, margin);
      if (padded.bottom > lastViewport.bottom) padded.bottom += Math.min(padded.bottom - lastViewport.bottom, margin);
    }
    this.lastRenderedViewport = viewport;
    let top = 0;
    let needsRender = false;
    let budget = 10;
    let cursor = containerEl.firstChild;
    for (let i = 0; i < data.groupedData.length; i++) {
      const group = groups[i];
      if (group.measured && (top > padded.bottom + s13RowHeightDefault || top + group.height < padded.top - s13RowHeightDefault)) {
        if (cursor === group.containerEl) cursor = cursor.nextSibling;
        group.containerEl.detach();
        top += group.height;
        continue;
      }
      const groupViewport = { top: padded.top - s13RowHeightDefault - top, bottom: padded.bottom + s13RowHeightDefault - top, left: padded.left, right: padded.right };
      if (cursor !== group.containerEl) containerEl.insertBefore(group.containerEl, cursor);
      else cursor = cursor.nextSibling;
      group.containerEl.setCssStyles({ top: top + "px" });
      const rendered = group.render(groupViewport, budget);
      const bottom = top + group.height;
      if (top > padded.bottom + s13RowHeightDefault || bottom < padded.top - s13RowHeightDefault) group.containerEl.detach();
      budget -= rendered;
      top = bottom;
      needsRender = needsRender || !group.measured;
    }
    while (cursor) {
      const next = cursor.nextSibling;
      containerEl.removeChild(cursor);
      cursor = next;
    }
    containerEl.setCssStyles({ height: top + "px" });
    if (needsRender) this.queueRender();
  };

  S13ListView = ListView;
  return ListView;
}

/** Clipboard payload reader for pasted bases cells (plain text, TSV or JSON). */
export function defineS13PasteData() {
  function PasteData(event, cell) {
    this.plainValue = null;
    this.rawValues = null;
    this.tableValues = null;
    this.plainValue = event.getData("text/plain");
    const cellsJson = event.getData("basalt/bases-cells");
    if (cellsJson) {
      try { this.rawValues = JSON.parse(cellsJson); } catch (e) { /* keep null */ }
    }
    const tableJson = event.getData("basalt/table");
    if (tableJson) {
      try { this.tableValues = JSON.parse(tableJson).rows; } catch (e) { /* keep null */ }
    }
    if (!this.tableValues && this.plainValue.includes("\t")) {
      this.tableValues = [];
      const lines = this.plainValue.split("\n");
      for (let i = 0; i < lines.length; i++) this.tableValues.push(lines[i].split("\t"));
    }
    if (cell && cell.top < cell.bottom && !this.tableValues && this.plainValue.includes("\n")) {
      this.tableValues = [];
      const lines = this.plainValue.split("\n");
      for (let i = 0; i < lines.length; i++) this.tableValues.push([lines[i]]);
    }
  }

  PasteData.prototype.isEmpty = function () {
    return !this.rawValues && (!this.tableValues && !this.plainValue);
  };

  PasteData.prototype.isPlainValue = function () {
    return !this.rawValues && !this.tableValues;
  };

  /** The cell range a paste of this shape would cover, anchored at `cell`. */
  PasteData.prototype.getBounds = function (cell, range) {
    const rows = this.tableValues;
    const rowCount = rows?.length ?? 0;
    const colCount = rowCount && rows[0]?.length ? rows[0].length : 0;
    if (range) {
      return {
        groupIdx: cell.groupIdx,
        top: range.top,
        start: range.start,
        bottom: Math.max(range.bottom, cell.row + rowCount - 1),
        end: Math.max(range.end, cell.column + colCount - 1),
      };
    }
    return {
      groupIdx: cell.groupIdx,
      top: cell.row,
      bottom: cell.row + Math.max(rowCount, 1) - 1,
      start: cell.column,
      end: cell.column + Math.max(colCount, 1) - 1,
    };
  };

  /** Reads the pasted value for offset (rowOffset, colOffset) inside the payload. */
  PasteData.prototype.read = function (rowOffset, colOffset) {
    if (this.rawValues) {
      const rowIndex = this.rawValues.length > 1 ? rowOffset : 0;
      const row = this.rawValues[rowIndex];
      if (!row) return;
      const cell = row[row.length > 1 ? colOffset : 0];
      return cell && cell.type === "note" ? cell.data : undefined;
    }
    if (this.tableValues) {
      const rowIndex = this.tableValues.length > 1 ? rowOffset : 0;
      const row = this.tableValues[rowIndex];
      if (!row) return;
      return row[row.length > 1 ? colOffset : 0];
    }
    return this.plainValue;
  };

  return PasteData;
}
