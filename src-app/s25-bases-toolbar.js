// Bases (database) toolbar pieces: the dropdown page base every toolbar menu page
// derives from, the filter/properties/results menus, the property picker and edit
// pages, the sort and group-by rows, the grouped/sorted/limited query result data
// and the small formula editor widget with its suggester.
//
// Everything here replaces inherited top-level classes of the bundle; the manifest
// (`classes` + `declarators` + `host`) wires the same minified names back. Cross-class
// references go through `host` (lazy app-scope bindings) or the own-module factories
// below, so evaluation order never matters.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { moveItem } from "./misc.js";
import { uniqueName, parsePropertyId, propertyId } from "./text.js";
import { prepareQuery, fuzzyMatchJs } from "./search.js";
import { debounceCall } from "./timing.js";
import { s09IsCustomProperty, s09PropertyToRef, s09FormulaEditorExtensions, s09PropertySuggest, s09ConjunctionFilter } from "./s09-query.js";
import { s09BasesDropdown } from "./s09-publish.js";
import { s09IsIdentifierName } from "./s09-formula.js";
import { s08FormulaValue, s08FormulaSuggester } from "./s08-values.js";
import { s04NumberComponent } from "./s04-modals.js";

export const s25Div = (...args) => env().createDiv(...args);
export const s25El = (...args) => env().createEl(...args);
export const s25Icon = (...args) => env().tv(...args);
const s25BasesStrings = () => env().gm.plugins.bases;

/** i18n strings of the file-explorer plugin section (was the `qX` alias). */
export function s25FileExplorerStrings() {
  return env().gm.plugins.fileExplorer;
}

/** Characters that may not appear in a view name (was the `o$` table). */
export const s25ViewNameChars = ["#", ":", "|", "^", "%%", "[[", "]]"].join(" ");

/** Pattern of the characters above; a view name must not contain them (was `PT`). */
export const s25ViewNamePattern = /([:#|^\\\r\n]|%%|\[\[|]])/g;

/** The view type id of database views (was `VX`). */
export const s25BasesViewType = "bases";

/** Fallback sort applied when a view has no explicit sort (was `yY`). */
export const s25DefaultSort = [{ property: "file.name", direction: "ASC" }];

/** Numeric compare helper used by the grouped-data sorter (was `pb`). */
function s25CompareNumbers(a, b) { return a - b; }

// ---------------------------------------------------------------- toolbar page base (`var WX`)

/**
 * Base class of the scrollable pages shown inside a bases toolbar dropdown: owns the
 * content element, the controller that opened it and a scope hanging off the
 * controller's scope.
 */
export function defineS25ToolbarPage(host) {
  const Component = env().jm;
  function ToolbarPage(controller) {
    const self = Component.call(this) || this;
    self.containerEl = s25Div("bases-toolbar-menu-container");
    self.controller = controller;
    self.scope = new (env().Ng)(self.controller.scope);
    return self;
  }
  inherit(ToolbarPage, Component);
  ToolbarPage.prototype.onShow = function () {};
  return ToolbarPage;
}

// ---------------------------------------------------------------- filter menu (`var AX`)

/**
 * The funnel toolbar button of a bases view: a dropdown with a collapsible "all
 * views" section (global filters) and a "current view" section (view filters), each
 * with its own filter builder and a badge counting active filters.
 */
export function defineS25FilterMenu(host) {
  const Dropdown = s09BasesDropdown();
  const Conjunction = s09ConjunctionFilter();
  const FilterBuilder = () => host.s25FilterBuilder;
  function FilterMenu(view, plugin) {
    const self = this;
    const app = view.app;
    this.toolbarItem = new Dropdown(app, plugin, s25BasesStrings().labelFilter(), "lucide-list-filter");
    this.toolbarItem.addClass("bases-toolbar-filter-menu");
    this.toolbarFiltersFlairEl = this.toolbarItem.button.buttonEl.createSpan({ cls: "flair toolbar-badge" });
    this.toolbarFiltersFlairEl.hide();
    const scrollEl = this.toolbarItem.scrollEl;
    scrollEl.createDiv("bases-toolbar-section", (section) => {
      let open = true;
      const header = section.createDiv("bases-toolbar-section-header", (h) => {
        h.createDiv({ cls: "tree-item-icon collapse-icon is-collapsed" }, (icon) => s25Icon(icon, "right-triangle"));
        h.createSpan({ text: s25BasesStrings().labelAllViews() });
        self.globalFiltersFlairEl = h.createSpan({ cls: "flair" });
      });
      const content = section.createDiv("bases-toolbar-section-content");
      content.hide();
      self.globalFilterBuilder = new (FilterBuilder())(app, content, view);
      header.addEventListener("click", (e) => {
        e.preventDefault();
        host.setCollapsed(header, (open = !open));
        host.collapseElement(content, open, true);
      });
      host.setCollapsed(header, open);
    });
    scrollEl.createDiv("bases-toolbar-section", (section) => {
      let open = false;
      const header = section.createDiv("bases-toolbar-section-header", (h) => {
        h.createDiv({ cls: "tree-item-icon collapse-icon" }, (icon) => s25Icon(icon, "right-triangle"));
        h.createSpan({ text: s25BasesStrings().labelCurrentView() });
        self.localFiltersFlairEl = h.createSpan({ cls: "flair" });
      });
      const content = section.createDiv("bases-toolbar-section-content");
      self.viewFilterBuilder = new (FilterBuilder())(app, content, view);
      header.addEventListener("click", (e) => {
        e.preventDefault();
        host.setCollapsed(header, (open = !open));
        host.collapseElement(content, open, true);
      });
    });
  }
  /**
   * `query` is the live query object; `viewConfig` the current view's config (may be
   * null for the global section). Pushes the current filters into both builders and
   * refreshes the badges and the error styling.
   */
  FilterMenu.prototype.updateQuery = function (query, viewConfig) {
    this.globalFilterBuilder.updateQuery((filters) => query.setGlobalFilters(filters), viewConfig, query.filters);
    this.viewFilterBuilder.updateQuery((filters) => query.setViewFilters(viewConfig.name, filters), viewConfig, viewConfig.filters);
    const count = (filters) => (filters ? (filters instanceof Conjunction ? filters.filters.length : 1) : 0);
    const paint = (el, n) => { el.setText(String(n)); el.toggle(n > 0); };
    const globalCount = count(query.filters);
    const localCount = count(viewConfig.filters);
    paint(this.globalFiltersFlairEl, globalCount);
    paint(this.localFiltersFlairEl, localCount);
    paint(this.toolbarFiltersFlairEl, localCount);
    const hasError = (query.filters && query.filters.hasError())
      || (viewConfig.filters && viewConfig.filters.hasError());
    this.toolbarItem.button.buttonEl.toggleClass("mod-error", hasError);
    this.toolbarItem.button.buttonEl.toggleClass("is-active", localCount > 0);
  };
  FilterMenu.prototype.setEnabled = function (enabled) { this.toolbarItem.setEnabled(enabled); };
  return FilterMenu;
}

// ---------------------------------------------------------------- properties menu (`var GX`)

/**
 * The "properties" eye toolbar button: a dropdown whose first page lists every
 * property with a visibility checkbox and whose second page edits one property's
 * display name, type and formula.
 */
export function defineS25PropertiesMenu(host) {
  const Component = env().jm;
  const InvalidNode = env().RK;
  function PropertiesMenu(controller, parentEl) {
    const self = Component.call(this) || this;
    self.pageStack = [];
    self.formulas = {};
    self.viewConfig = null;
    const app = controller.app;
    self.app = app;
    self.queryController = controller;
    self.query = controller.query;
    self.toolbarItem = new (s09BasesDropdown())(app, parentEl, s25BasesStrings().labelProperties(), "list")
      .onOpen(() => self.onOpen())
      .onClose(() => self.onClose());
    self.toolbarItem.addClass("bases-toolbar-properties-menu");
    return self;
  }
  inherit(PropertiesMenu, Component);
  Object.defineProperty(PropertiesMenu.prototype, "scope", {
    get() { return this.toolbarItem.scope; }, enumerable: false, configurable: true,
  });
  PropertiesMenu.prototype.onOpen = function () {
    const self = this;
    this.show(new (host.s25PropListPage)(this).onNext((propId) => self.show(new (host.s25PropEditPage)(self, propId))));
  };
  PropertiesMenu.prototype.onClose = function () {
    let page;
    while ((page = this.pageStack.pop())) this.app.keymap.popScope(page.scope);
    this.toolbarItem.scrollEl.empty();
  };
  PropertiesMenu.prototype.setEnabled = function (enabled) { this.toolbarItem.setEnabled(enabled); };
  /** Shows `page` as the current dropdown page and pushes it on the stack. */
  PropertiesMenu.prototype.show = function (page) {
    this.toolbarItem.scrollEl.setChildrenInPlace([page.containerEl]);
    page.onShow();
    this.pageStack.push(page);
    this.app.keymap.pushScope(page.scope);
  };
  PropertiesMenu.prototype.close = function () { this.toolbarItem.setOpen(false); };
  /** Pops the top page; the new top (if any) becomes visible again. */
  PropertiesMenu.prototype.back = function () {
    const popped = this.pageStack.pop();
    if (popped) this.app.keymap.popScope(popped.scope);
    const top = this.pageStack[this.pageStack.length - 1];
    if (top) {
      this.toolbarItem.scrollEl.setChildrenInPlace([top.containerEl]);
      top.onShow();
    }
  };
  /**
   * `query` is the live query; `viewConfig` the current view config (may be null).
   * Mirrors the query's formulas and flags the button when one fails to parse.
   */
  PropertiesMenu.prototype.updateQuery = function (query, viewConfig) {
    this.query = query;
    this.viewConfig = viewConfig;
    this.formulas = query.formulas ?? {};
    let hasError = false;
    for (const name in query.formulas) {
      if (query.formulas[name] instanceof InvalidNode) { hasError = true; break; }
    }
    this.toolbarItem.button.buttonEl.toggleClass("mod-error", hasError);
  };
  PropertiesMenu.prototype.setPropertyVisibility = function (propId, visible) {
    if (this.viewConfig.getOrder().contains(propId) !== visible) this.togglePropertyVisibility(propId);
  };
  PropertiesMenu.prototype.togglePropertyVisibility = function (propId) {
    const order = this.viewConfig.getOrder();
    if (order.contains(propId)) order.remove(propId); else order.push(propId);
    this.viewConfig.setOrder(order);
  };
  PropertiesMenu.prototype.updateFormula = function (name, formula) {
    this.formulas[name] = formula;
    this.query.setFormulas(this.formulas);
  };
  return PropertiesMenu;
}

// ---------------------------------------------------------------- property list page (`var KX`)

/**
 * First page of the properties menu: a search field over every known property plus
 * action rows (add property, add formula, hide all). Rows are a checkbox, the display
 * name, an error flair for broken formulas and a chevron that drills into the edit
 * page; Alt+ArrowUp/Down reorders the property in the view config.
 */
export function defineS25PropertyListPage(host) {
  const Page = host.s13BasesToolbarPage;
  function PropertyListPage(controller) {
    const self = Page.call(this, controller) || this;
    self.query = "";
    self.controller = controller;
    this.searchComponent = new (host.SearchComponent)(this.containerEl)
      .setClass("mod-raised")
      .setPlaceholder(s25BasesStrings().placeholderSearchProperty())
      .onChange((value) => { self.query = value; self.renderProperties(); });
    const inputEl = this.searchComponent.inputEl;
    inputEl.addEventListener("focus", () => this.containerEl.addClass("has-input-focus"));
    inputEl.addEventListener("blur", () => this.containerEl.removeClass("has-input-focus"));
    const listEl = this.containerEl.createDiv("bases-toolbar-items");
    this.chooser = new (host.GroupedSuggestionList)(this, listEl, this.scope);
    this.scope.register([], "ArrowRight", () => {
      const selected = this.chooser.getSelectedValue();
      if (selected && selected.type === "property") this.handleNext?.(selected.propId);
    });
    this.scope.register(["Alt"], "ArrowUp", () => self.moveSelected(-1));
    this.scope.register(["Alt"], "ArrowDown", () => self.moveSelected(1));
  }
  PropertyListPage.prototype.moveSelected = function (delta) {
    const selected = this.chooser.getSelectedValue();
    if (!selected || selected.type !== "property") return;
    const order = this.controller.viewConfig.getOrder();
    const index = order.indexOf(selected.propId);
    if (index === -1) return;
    moveItem(order, index, Math.clamp(index + delta, 0, order.length));
    this.controller.viewConfig.setOrder(order);
    this.renderProperties();
    this.chooser.setSelectedItem(this.chooser.values.findIndex(
      (v) => v.type === "property" && v.propId === selected.propId));
  };
  inherit(PropertyListPage, Page);
  PropertyListPage.prototype.onSelect = function (cb) { this.handleSelect = cb; return this; };
  PropertyListPage.prototype.onNext = function (cb) { this.handleNext = cb; return this; };
  PropertyListPage.prototype.onShow = function () {
    this.searchComponent.autoSelect();
    this.renderProperties();
  };
  PropertyListPage.prototype.selectSuggestion = function (item) {
    if (item.type === "action") item.callback();
    else if (item.type === "property") this.handleSelect?.(item.propId);
    const el = this.chooser.getSelectedElement();
    if (el) { el.empty(); this.renderSuggestion(item, el); }
  };
  /** Rebuilds the suggestion list from the view order plus every known property. */
  PropertyListPage.prototype.renderProperties = function () {
    const self = this;
    const query = prepareQuery(this.query);
    const suggestions = [];
    const viewConfig = this.controller.viewConfig;
    const order = viewConfig.getOrder();
    const all = this.controller.app.metadataTypeManager.getAllProperties();
    let props = this.controller.queryController.getProperties().filter((p) => p !== "file.file");
    if (this.query) {
      for (const name in all) {
        const id = propertyId("note", all[name].name);
        if (!props.contains(id)) props.push(id);
      }
    }
    for (const id of order) if (!props.contains(id)) props.push(id);
    props.sort((a, b) => env().ub(a, b));
    if (order) {
      const rank = new Map(order.map((id, i) => [id, i]));
      props.sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));
    }
    for (const id of props) {
      const name = parsePropertyId(id).name;
      const display = viewConfig.getDisplayName(id);
      const custom = display !== name;
      if (fuzzyMatchJs(query, display) || (custom && fuzzyMatchJs(query, name))) {
        suggestions.push({ type: "property", propId: id, group: "properties" });
      }
    }
    const trimmed = this.query.trim();
    if (trimmed && !Object.hasOwn(all, trimmed)) {
      suggestions.push({
        type: "action",
        name: s25BasesStrings().actionAddProperty({ name: trimmed }),
        icon: "lucide-plus",
        group: "actions",
        callback: () => {
          const id = propertyId("note", self.query.trim() || s25BasesStrings().labelUntitledProperty());
          self.controller.setPropertyVisibility(id, true);
          self.controller.show(new (host.s25PropEditPage)(self.controller, id, true));
        },
      });
    }
    suggestions.push({
      type: "action",
      name: s25BasesStrings().actionAddFormula(),
      icon: "lucide-square-function",
      group: "actions",
      callback: () => {
        const name = uniqueName(new Set(Object.keys(self.controller.formulas)),
          self.query.trim() || s25BasesStrings().labelUntitledProperty());
        const id = propertyId("formula", name);
        self.controller.updateFormula(name, new (env().DK)(""));
        self.controller.setPropertyVisibility(id, true);
        self.controller.show(new (host.s25PropEditPage)(self.controller, id, true));
      },
    });
    suggestions.push({
      type: "action",
      name: s25BasesStrings().actionHideAll(),
      icon: "lucide-eye-off",
      group: "actions",
      callback: () => {
        self.controller.viewConfig.setOrder([]);
        self.renderProperties();
      },
    });
    this.chooser.setSuggestions(suggestions);
  };
  PropertyListPage.prototype.renderSuggestion = function (item, el) {
    const self = this;
    const controller = this.controller;
    const app = controller.app;
    const viewConfig = controller.viewConfig;
    el.addClass("bases-toolbar-menu-item");
    el.addEventListener("mousedown", (e) => e.preventDefault());
    const info = el.createDiv("bases-toolbar-menu-item-info");
    const iconEl = info.createDiv("bases-toolbar-menu-item-info-icon");
    if (item.type === "action") {
      s25Icon(iconEl, item.icon);
      info.createDiv({ cls: "bases-toolbar-menu-item-name", text: item.name });
    } else if (item.type === "property") {
      const propId = item.propId;
      const parsed = parsePropertyId(propId);
      const type = parsed.type, name = parsed.name;
      const checkbox = s25El("input", { type: "checkbox", prepend: true });
      checkbox.addEventListener("touchstart", (e) => {
        e.preventDefault();
        const checked = !checkbox.checked;
        const onMove = (ev) => {
          ev.preventDefault();
          const touch = ev.touches[0];
          const target = document.elementFromPoint(touch.clientX, touch.clientY).closest("input[type=checkbox]");
          if (target && target.checked !== checked) {
            for (let i = 0; i < self.chooser.values.length; i++) {
              const value = self.chooser.values[i];
              if (self.chooser.suggestions[i].contains(target)) {
                self.chooser.selectedItem = i;
                self.selectSuggestion(value, null);
                break;
              }
            }
          }
        };
        const onEnd = () => {
          checkbox.removeEventListener("touchmove", onMove);
          checkbox.removeEventListener("touchend", onEnd);
          checkbox.removeEventListener("touchcancel", onEnd);
        };
        checkbox.addEventListener("touchmove", onMove);
        checkbox.addEventListener("touchend", onEnd);
        checkbox.addEventListener("touchcancel", onEnd);
      }, { passive: true });
      const order = viewConfig.getOrder();
      if (type === "note") s25Icon(iconEl, app.metadataTypeManager.getTypeInfo(name).expected.icon);
      else if (type === "formula") {
        s25Icon(iconEl, "lucide-square-function");
        const formula = this.controller.formulas[name];
        if (formula?.formula instanceof env().RK) {
          iconEl.addClass("mod-error");
          host.Mv(iconEl, formula.formula.getErrorMessage());
        } else iconEl.removeClass("mod-error");
      } else s25Icon(iconEl, "lucide-info");
      el.toggleClass("mod-implicit", type === "file");
      el.toggleClass("mod-formula", type === "formula");
      info.createDiv({ cls: "bases-toolbar-menu-item-name", text: viewConfig.getDisplayName(propId) });
      const visible = order.contains(propId);
      el.toggleClass("mod-hidden", !visible);
      checkbox.checked = visible;
      const chevron = el.createDiv("clickable-icon bases-toolbar-menu-item-icon");
      s25Icon(chevron, "lucide-chevron-right");
      chevron.addEventListener("click", (e) => {
        e.preventDefault();
        const index = self.chooser.selectedItem;
        if (self.chooser.values[index].type === "property") self.handleNext?.(propId);
      });
      if (visible) {
        host.makeDragReorderable(iconEl, el, el.parentElement, 10, () => {}, (to) => {
          const from = order.indexOf(propId);
          moveItem(order, from, to);
          viewConfig.setOrder(order);
        });
      }
    }
  };
  return PropertyListPage;
}

// ---------------------------------------------------------------- property edit page (`var YX`)

/**
 * Second page of the properties menu: header with back/close and a "more" menu for
 * the chosen property, body is the property form (`QX`).
 */
export function defineS25PropertyEditPage(host) {
  const Page = host.s13BasesToolbarPage;
  function PropertyEditPage(controller, propId, isNew) {
    isNew = isNew || false;
    const self = Page.call(this, controller) || this;
    const name = parsePropertyId(propId).name;
    const header = this.containerEl.createDiv("bases-toolbar-menu-container-header");
    const back = header.createDiv("back-button");
    s25Icon(back.createDiv("back-icon"), "lucide-chevron-left");
    back.createDiv({ text: isNew ? s25BasesStrings().labelEditProperty() : s25BasesStrings().titleEditProperty({ name }), cls: "back-label" });
    back.addEventListener("click", () => self.controller.back());
    const more = header.createDiv("clickable-icon");
    s25Icon(more, "lucide-more-vertical");
    const close = header.createDiv("close-icon clickable-icon");
    s25Icon(close, "lucide-x");
    close.addEventListener("click", () => self.controller.close());
    this.scope.register([], "Escape", () => self.controller.back());
    const form = new (host.s25PropForm)(controller.queryController, propId, isNew)
      .onDelete(() => self.controller.back());
    more.addEventListener("click", (e) => form.showActions(e, more));
    this.containerEl.append(form.containerEl);
  }
  inherit(PropertyEditPage, Page);
  return PropertyEditPage;
}

// ---------------------------------------------------------------- property form (`var QX`)

/**
 * The editable form of one property inside the properties menu: display-name input
 * (renames note properties through the file manager and formulas in the query), a
 * type dropdown for note properties and a formula editor for formula properties.
 */
export function defineS25PropertyForm(host) {
  const DropdownComponent = host.DropdownComponent;
  const TextComponent = host.TextComponent;
  const FormulaEditor = host.s13FormulaEditor;
  function PropertyForm(queryController, propId, isNewProperty) {
    const self = this;
    this.queryController = queryController;
    this.propId = propId;
    this.isNewProperty = isNewProperty;
    const app = queryController.app;
    const query = queryController.query;
    const viewConfig = queryController.getViewConfig();
    const parsed = parsePropertyId(propId);
    const type = parsed.type;
    let name = parsed.name;
    const containerEl = this.containerEl = s25Div("bases-toolbar-menu-form");
    containerEl.createDiv("input-row", (row) => {
      if (!isNewProperty) row.createDiv({ cls: "input-row-label", text: s25BasesStrings().labelDisplayName() });
      const input = new (TextComponent)(row.createDiv("input-row-content"))
        .setPlaceholder(name)
        .setValue(viewConfig.getDisplayName(propId))
        .autoSelect()
        .inputEl;
      input.addEventListener("blur", () => {
        const value = input.value.trim();
        if (value === viewConfig.getDisplayName(propId)) return;
        if (isNewProperty) {
          if (type === "formula") {
            const formulas = query.formulas ?? {};
            const existing = formulas[name];
            delete formulas[name];
            formulas[value] = existing;
            query.setFormulas(formulas);
          } else if (type === "note") app.fileManager.renameProperty(name, value);
          const newId = propertyId(type, value);
          viewConfig.setOrder(viewConfig.getOrder().map((id) => (id === propId ? newId : id)));
          self.propId = newId;
          name = value;
        } else viewConfig.getPropertyConfig(propId).setDisplayName(value);
      });
      input.addEventListener("keydown", (e) => {
        if (e.isComposing || e.defaultPrevented) return;
        if (e.key === "Escape") { e.preventDefault(); input.value = name; input.blur(); }
        else if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      });
    });
    if (type === "note") {
      const widgets = app.metadataTypeManager.registeredTypeWidgets;
      const inferred = app.metadataTypeManager.getTypeInfo(name).inferred;
      const options = Object.fromEntries(Object.entries(widgets)
        .filter(([, widget]) => !widget.reservedKeys || widget.reservedKeys?.contains(inferred.type))
        .map(([key, widget]) => [key, widget.name()]));
      const typeRow = containerEl.createDiv("input-row");
      typeRow.createDiv({ cls: "input-row-label", text: s25BasesStrings().labelPropertyType() });
      new (DropdownComponent)(typeRow.createDiv("input-row-content"))
        .addOptions(options)
        .setValue(inferred.type)
        .onChange((value) => app.metadataTypeManager.setType(name, value));
    } else if (type === "formula") {
      const formulas = query.formulas ?? {};
      const current = Object.hasOwn(formulas, name) ? formulas[name] : null;
      const formulaRow = containerEl.createDiv("input-row");
      FormulaEditor.appendHelpIcon(formulaRow.createDiv({ cls: "input-row-label", text: s25BasesStrings().labelFormula() }));
      const content = formulaRow.createDiv("input-row-content");
      new (FormulaEditor)(content, current, {
        updateFormula: (formula) => { formulas[name] = formula; query.setFormulas(formulas); },
        extensions: [queryController.getEditorLanguageSupport()],
      });
    }
  }
  /** Context menu of the row's "more" button: hide/show and (formulas) delete. */
  PropertyForm.prototype.showActions = function (evt, target) {
    const self = this;
    if (target && target.hasClass("has-active-menu")) return;
    const query = this.queryController.query;
    const propId = this.propId;
    const parsed = parsePropertyId(propId);
    const type = parsed.type, name = parsed.name;
    const viewConfig = this.queryController.getViewConfig();
    const ordered = viewConfig.getOrder().contains(propId);
    const menu = env().Ug.forEvent(evt);
    menu.addSections(["action", "", "danger"]);
    if (target) menu.setParentElement(target);
    menu.addItem((item) => item
      .setTitle(ordered ? s25BasesStrings().labelHideProperty() : s25BasesStrings().labelShowProperty())
      .setSection("action")
      .setIcon("lucide-eye-off")
      .onClick(() => {
        const order = viewConfig.getOrder();
        if (order.contains(propId)) order.remove(propId); else order.push(propId);
        viewConfig.setOrder(order);
      }));
    if (type === "formula") {
      menu.addItem((item) => item
        .setTitle(s25BasesStrings().actionDeleteFormula())
        .setSection("danger")
        .setIcon("lucide-trash-2")
        .setWarning(true)
        .onClick(() => {
          const order = viewConfig.getOrder();
          const index = order.indexOf(propId);
          if (index !== -1) { order.splice(index, 1); viewConfig.setOrder(order); }
          viewConfig.getPropertyConfig(propId).setDisplayName(null);
          delete query.formulas[name];
          query.setFormulas(query.formulas);
          self.handleDelete?.();
        }));
    }
    menu.showAtMouseEvent(evt);
  };
  PropertyForm.prototype.onDelete = function (cb) { this.handleDelete = cb; return this; };
  return PropertyForm;
}

// ---------------------------------------------------------------- results menu (`var $X`)

/**
 * The funnel-with-count toolbar button of a table/cards view: a limit input, a
 * "show all" reset row and the view's extra actions plus copy/export CSV.
 */
export function defineS25ResultsMenu(host) {
  const Dropdown = s09BasesDropdown();
  const NumberField = s04NumberComponent(host);
  function ResultsMenu(app, parentEl) {
    const self = this;
    this.resultCount = 0;
    this.app = app;
    this.toolbarItem = new Dropdown(app, parentEl, env().gm.nouns.resultWithCount({ count: 0 }), "lucide-list-filter")
      .onOpen(() => self.display());
    this.toolbarItem.addClass("bases-toolbar-results-menu");
    this.toolbarItem.button.addContainerClass("bases-toolbar-result-count");
  }
  ResultsMenu.prototype.display = function () {
    const self = this;
    const view = this.view;
    const viewConfig = this.viewConfig;
    const scrollEl = this.toolbarItem.scrollEl;
    scrollEl.empty();
    const form = scrollEl.createDiv("bases-toolbar-menu-form");
    const actions = scrollEl.createDiv("bases-toolbar-menu-actions");
    const limitRow = form.createDiv("input-row");
    limitRow.createDiv({ cls: "input-row-label", text: s25BasesStrings().labelLimit() });
    const limit = viewConfig.getLimit();
    const input = new (NumberField)(limitRow.createDiv("input-row-content"))
      .setValue(limit !== 0 ? String(limit) : "")
      .setPlaceholder(s25BasesStrings().placeholderLimit())
      .setLimits(1, null, 1)
      .onChange((value) => {
        input.inputEl.removeClass("mod-error");
        if (value === "") viewConfig.setLimit(0);
        else {
          const parsed = parseInt(value);
          if (!isNaN(parsed) && parsed >= 0) viewConfig.setLimit(parsed);
          else input.inputEl.addClass("mod-error");
        }
        refreshReset();
      });
    input.inputEl.addEventListener("keydown", (e) => {
      if (e.isComposing || e.key !== "Enter") return;
      e.preventDefault();
      self.toolbarItem.setOpen(false);
    });
    const resetRow = actions.createDiv("bases-toolbar-menu-item");
    resetRow.addEventListener("click", (e) => {
      e.preventDefault();
      viewConfig.setLimit(0);
      self.toolbarItem.setOpen(false);
    });
    const resetInfo = resetRow.createDiv("bases-toolbar-menu-item-info");
    s25Icon(resetInfo.createDiv("bases-toolbar-menu-item-info-icon"), "lucide-rotate-ccw");
    const resetLabel = resetInfo.createDiv({ cls: "bases-toolbar-menu-item-name", text: s25BasesStrings().buttonShowAll() });
    const refreshReset = () => {
      const current = viewConfig.getLimit();
      resetLabel.setText(current === 0
        ? s25BasesStrings().buttonShowAll()
        : s25BasesStrings().buttonShowAllCount({ count: self.resultCount }));
      resetRow.toggleClass("mod-hidden", current === 0);
    };
    refreshReset();
    const items = [
      { name: env().gm.interface.labelCopy(), icon: "lucide-copy", callback: () => view.copyToClipboard() },
      {
        name: s25BasesStrings().actionExportCSV(), icon: "lucide-file-down",
        callback: () => {
          const csv = view.exportTable().toCSV();
          const name = viewConfig.getViewName() + ".csv";
          const blob = new Blob([csv], { type: "text/plain" });
          const url = URL.createObjectURL(blob);
          const link = s25El("a", { attr: { href: url, download: name } });
          link.style.display = "none";
          link.click();
          link.detach();
          URL.revokeObjectURL(url);
        },
      },
    ];
    items.push(...view.getViewActions());
    for (const item of items) {
      const row = actions.createDiv("bases-toolbar-menu-item");
      row.addEventListener("click", (e) => {
        e.preventDefault();
        self.toolbarItem.setOpen(false);
        item.callback();
      });
      const info = row.createDiv("bases-toolbar-menu-item-info");
      if (item.icon) s25Icon(info.createDiv("bases-toolbar-menu-item-info-icon"), item.icon);
      const label = item.name;
      const text = item.getName ? item.getName() : label;
      info.createDiv({ cls: "bases-toolbar-menu-item-name", text });
      row.toggleClass("mod-destructive", item.destructive);
    }
  };
  /**
   * `query` result data: `view`/`viewConfig` the current view, `count` the number of
   * rows after limit. Updates the button label and the active styling.
   */
  ResultsMenu.prototype.updateQuery = function (view, viewConfig, count) {
    this.view = view;
    this.viewConfig = viewConfig;
    this.resultCount = count;
    const limit = viewConfig.getLimit();
    let shown = count;
    let limited = false;
    if (limit && shown > limit) { shown = limit; limited = true; }
    this.toolbarItem.button.setText(env().gm.nouns.resultWithCount({ count: shown }));
    this.toolbarItem.button.buttonEl.toggleClass("is-active", limited);
  };
  ResultsMenu.prototype.setEnabled = function (enabled) { this.toolbarItem.setEnabled(enabled); };
  return ResultsMenu;
}

// ---------------------------------------------------------------- sort menu (`var e$`)

/**
 * The sort toolbar button: a "group by" row on top and a list of sort rows below,
 * reconciled against the view config's sort each time the menu opens.
 */
export function defineS25SortMenu(host) {
  const Component = env().jm;
  function SortMenu(app, parentEl) {
    const self = Component.call(this) || this;
    self.app = app;
    this.queryController = null;
    this.query = null;
    this.viewConfig = null;
    this.currentSort = [];
    this.toolbarItem = new (s09BasesDropdown())(app, parentEl, s25BasesStrings().labelSort(), "lucide-arrow-up-down");
    this.toolbarItem.addClass("bases-toolbar-sort-menu");
    this.toolbarItem.onOpen(() => self.onOpen());
    this.flairEl = this.toolbarItem.button.buttonEl.createSpan({ cls: "flair toolbar-badge" });
    this.flairEl.hide();
    const scrollEl = this.toolbarItem.scrollEl;
    const groupSection = scrollEl.createDiv("bases-toolbar-section bases-groupby-container");
    groupSection.createDiv({ cls: "bases-toolbar-section-header", text: s25BasesStrings().labelGroupBy() });
    const groupContent = groupSection.createDiv("bases-toolbar-section-content");
    this.groupByRowContainerEl = groupContent.createDiv("bases-toolbar-items");
    this.groupByRow = new (host.s25GroupRow)(this, null, "ASC");
    const sortSection = scrollEl.createDiv("bases-toolbar-section bases-sort-container");
    sortSection.createDiv({ cls: "bases-toolbar-section-header", text: s25BasesStrings().labelSortBy() });
    const sortContent = sortSection.createDiv("bases-toolbar-section-content");
    this.sortRowsContainerEl = sortContent.createDiv("bases-toolbar-items");
    sortContent.createDiv({ cls: "text-icon-button" }, (el) => {
      el.createSpan("text-button-icon", (icon) => s25Icon(icon, "plus"));
      el.createSpan({ cls: "text-button-label", text: s25BasesStrings().labelAddSort() });
      el.addEventListener("click", () => self.addSortRow().focus());
      el.addEventListener("keydown", (e) => {
        if (e.isComposing || e.defaultPrevented || (e.key !== " " && e.key !== "Enter")) return;
        self.addSortRow().focus();
      });
    });
    return self;
  }
  inherit(SortMenu, Component);
  /** `viewConfig` may be null (global toolbar state); `query` the live query. */
  SortMenu.prototype.updateQuery = function (queryController, query, viewConfig) {
    this.queryController = queryController;
    this.query = query;
    this.viewConfig = viewConfig;
    this.display();
    const flair = this.flairEl;
    const count = viewConfig?.getSort()?.length ?? 0;
    flair.setText(String(count));
    flair.toggle(count > 0);
    this.toolbarItem.button.buttonEl.toggleClass("is-active", count > 0 || !!viewConfig?.groupBy);
  };
  SortMenu.prototype.onOpen = function () { this.display(); };
  /** Reconciles the row widgets with the view config's sort and group-by. */
  SortMenu.prototype.display = function () {
    const self = this;
    host.s13ReconcileCells(this.currentSort, this.loadSort(),
      (a, b) => a.property === b.property && a.direction === b.direction,
      (spec) => {
        const row = new (host.s25SortRow)(self, spec.property, spec.direction);
        row.render(self.sortRowsContainerEl);
        return row;
      });
    this.sortRowsContainerEl.setChildrenInPlace(this.currentSort.map((row) => row.rowEl));
    if (this.currentSort.length === 0) this.addSortRow();
    this.renderGroupBy(this.viewConfig.groupBy);
  };
  SortMenu.prototype.renderGroupBy = function (groupBy) {
    const row = this.groupByRow;
    if (groupBy && row.property === groupBy.property && row.direction === groupBy.direction) return;
    this.groupByRowContainerEl.empty();
    row.property = groupBy?.property;
    row.direction = groupBy?.direction ?? "ASC";
    row.render(this.groupByRowContainerEl);
  };
  SortMenu.prototype.setGroupBy = function (groupBy) {
    this.viewConfig.setGroupBy(groupBy);
    this.renderGroupBy(groupBy);
  };
  SortMenu.prototype.addSortRow = function () {
    const row = new (host.s25SortRow)(this, null, "ASC");
    this.currentSort.push(row);
    row.render(this.sortRowsContainerEl);
    return row;
  };
  SortMenu.prototype.removeSortRow = function (row) {
    this.currentSort.remove(row);
    this.saveSort();
  };
  SortMenu.prototype.moveSortRow = function (row, to) {
    const from = this.currentSort.indexOf(row);
    if (to !== -1 && to !== from) {
      moveItem(this.currentSort, from, to);
      this.saveSort();
    }
  };
  SortMenu.prototype.loadSort = function () {
    return this.viewConfig ? this.viewConfig.getSort() : [];
  };
  SortMenu.prototype.saveSort = function () {
    if (!this.viewConfig) return;
    const sort = this.currentSort
      .map((row) => ({ property: row.property, direction: row.direction }))
      .filter((spec) => !!spec.property);
    this.viewConfig.sort = sort;
    this.query.save();
  };
  return SortMenu;
}

// ---------------------------------------------------------------- sort row base (`var t$`)

/**
 * One editable sort row inside the sort menu: a property combobox plus a direction
 * dropdown whose labels adapt to the property type (name/date/number) and a delete
 * button. `parent` is the sort menu.
 */
export function defineS25SortRowBase(host) {
  const PropertySuggest = s09PropertySuggest();
  function SortRowBase(parent, property, direction) {
    this.property = null;
    this.direction = "ASC";
    this.parent = parent;
    this.property = property;
    this.direction = direction;
  }
  SortRowBase.prototype.render = function (containerEl) {
    const self = this;
    const property = this.property;
    const parent = this.parent;
    const app = parent.app ?? parent.queryController.app;
    const queryController = parent.queryController;
    this.rowEl = containerEl.createDiv("base-toolbar-sort-item");
    const wrapperEl = this.wrapperEl = this.rowEl.createDiv("metadata-property bases-sort-property-container");
    let focusDepth = 0;
    const onOpen = () => { if (focusDepth++ === 0) wrapperEl.addClass("has-focus"); };
    const onClose = () => { if ((focusDepth = Math.max(0, focusDepth - 1)) === 0) wrapperEl.removeClass("has-focus"); };
    this.propertyCombobox = new PropertySuggest(queryController, wrapperEl)
      .filterProperties(this.propertyFilter.bind(this))
      .setValueById(property)
      .setPlaceholder(s25BasesStrings().labelPropertyKey())
      .onOpen(onOpen)
      .onClose(onClose)
      .onSelect((item) => {
        if (self.property !== item.value) {
          self.property = item.value;
          self.configureSortRow();
          self.handleSave();
        }
        self.sortDirectionCombobox.focus();
      });
    this.propertyCombobox.buttonEl.addClass("bases-sort-property");
    const directionCombo = this.sortDirectionCombobox = new (env().MI)(app, wrapperEl)
      .onOpen(onOpen)
      .onClose(onClose)
      .onSelect((item) => {
        if (self.direction !== item.value) {
          self.direction = item.value;
          self.handleSave();
        }
      });
    directionCombo.buttonEl.addClass("bases-sort-direction");
    this.configureSortRow();
    const trash = this.rowEl.createDiv("clickable-icon");
    s25Icon(trash, "lucide-trash-2");
    trash.addEventListener("click", this.handleDelete.bind(this));
  };
  /** Rebuilds the direction options and the error flair for the current property. */
  SortRowBase.prototype.configureSortRow = function () {
    const self = this;
    const parent = this.parent;
    const combo = this.sortDirectionCombobox;
    const queryController = parent.queryController;
    let labels = { ASC: s25BasesStrings().labelSortAZ(), DESC: s25BasesStrings().labelSortZA() };
    if (this.property) {
      const widget = queryController.getWidgetForIdent(s09PropertyToRef(this.property));
      if (widget === "date" || widget === "datetime") {
        labels = { ASC: s25BasesStrings().labelSortOldNew(), DESC: s25BasesStrings().labelSortNewOld() };
      } else if (widget === "number") {
        labels = { ASC: s25BasesStrings().labelSort01(), DESC: s25BasesStrings().labelSort10() };
      }
    }
    const broken = !this.property ? false : (() => {
      const parsed = parsePropertyId(this.property);
      return parsed.type === "formula" && !Object.hasOwn(parent.query.formulas, parsed.name);
    })();
    const iconEl = this.propertyCombobox.iconEl;
    this.wrapperEl.toggleClass("mod-error", broken);
    host.Mv(iconEl, broken ? s25BasesStrings().msgErrorInvalidProperty() : "");
    if (broken) s25Icon(iconEl, "lucide-alert-triangle");
    combo.setItems([
      { value: "ASC", display: labels.ASC },
      { value: "DESC", display: labels.DESC },
    ]);
    combo.setValueById(this.direction);
  };
  SortRowBase.prototype.focus = function () { this.propertyCombobox.focus(); };
  return SortRowBase;
}

// ---------------------------------------------------------------- sort row (`var n$`)

/** Sort row of the sort menu: drag handle for reordering plus save/remove hooks. */
export function defineS25SortRow(host) {
  const Base = host.s25SortRowBase;
  function SortRow(parent, property, direction) {
    const self = Base.call(this, parent, property, direction) || this;
    return self;
  }
  inherit(SortRow, Base);
  SortRow.prototype.render = function (containerEl) {
    const self = this;
    Base.prototype.render.call(this, containerEl);
    const grip = s25Div("grip-handle");
    s25Icon(grip, "grip-vertical");
    host.makeDragReorderable(grip, this.rowEl, containerEl, 10, () => {}, (to) => self.parent.moveSortRow(self, to));
    this.rowEl.insertBefore(grip, this.rowEl.firstChild);
  };
  SortRow.prototype.propertyFilter = function (id) {
    return id !== "file.file" && id !== "file.backlinks";
  };
  SortRow.prototype.handleSave = function () { this.parent.saveSort(); };
  SortRow.prototype.handleDelete = function () { this.parent.removeSortRow(this); };
  return SortRow;
}

// ---------------------------------------------------------------- group-by row (`var i$`)

/** The single "group by" row of the sort menu. */
export function defineS25GroupRow(host) {
  const Base = host.s25SortRowBase;
  function GroupRow(parent, property, direction) {
    const self = Base.call(this, parent, property, direction) || this;
    return self;
  }
  inherit(GroupRow, Base);
  GroupRow.prototype.propertyFilter = function (id) {
    return s09IsCustomProperty(id, this.parent.queryController);
  };
  GroupRow.prototype.handleSave = function () {
    const property = this.property;
    const direction = this.direction;
    this.parent.setGroupBy(property ? { property, direction } : null);
  };
  GroupRow.prototype.handleDelete = function () { this.parent.setGroupBy(); };
  return GroupRow;
}

// ---------------------------------------------------------------- group entries (`var c$`)

/**
 * One group of the grouped query data: the entries plus the group key. `hasKey`
 * reports whether the key is a real value (not the null/empty sentinel).
 */
export function defineS25GroupEntries(host) {
  function GroupEntries(entries, key) {
    this.entries = entries;
    this.key = key;
  }
  GroupEntries.prototype.hasKey = function () {
    return !!this.key && !env().gW.equals(this.key, env().bW.value);
  };
  return GroupEntries;
}

// ---------------------------------------------------------------- query data (`var u$`)

/**
 * The processed result set behind a bases view: applies the view's sort (with the
 * file.name fallback), the row limit and computes groupedData on demand. Also turns
 * summary formulas into display values with a per-file cache.
 */
export function defineS25QueryData(host) {
  const GroupEntries = host.s25GroupSet;
  const NullValue = env().bW;
  const AnyValue = env().gW;
  const NumberValue = env().EW;
  const BooleanValue = env().MW;
  const DateValue = env().LW;
  const DurationValue = env().OW;
  const LinkValue = env().BW;
  const UrlValue = host.RW;
  const SummaryValues = host.s13SummaryValues;
  function QueryData(app, config, allProperties, data) {
    this.allProperties = [];
    this.highlights = [];
    this.summaryCache = new WeakMap();
    this.app = app;
    this.config = config;
    this.allProperties = allProperties;
    this.applySort(data);
    this.applyLimit(data);
    this.data = data;
  }
  /** Rows grouped by the view's group-by property; the empty group sorts last. */
  Object.defineProperty(QueryData.prototype, "groupedData", {
    get() {
      if (this.groupedDataCache) return this.groupedDataCache;
      const config = this.config;
      const data = this.data;
      const groupBy = config.groupBy;
      if (!groupBy) {
        this.groupedDataCache = [new GroupEntries(data)];
        return this.groupedDataCache;
      }
      const property = groupBy.property;
      const direction = groupBy.direction;
      const groups = [];
      const add = (entry) => {
        const value = entry.getValue(property) || NullValue.value;
        let group = groups.find((g) => AnyValue.looseEquals(g.key, value));
        if (!group) { group = new GroupEntries([entry], value); groups.push(group); }
        else group.entries.push(entry);
      };
      for (const entry of data) add(entry);
      const sign = direction === "ASC" ? 1 : -1;
      groups.sort((a, b) => {
        if (a.hasKey() && b.hasKey()) {
          if (AnyValue.equals(a.key, b.key)) return 0;
          if (a.key instanceof NumberValue && b.key instanceof NumberValue) {
            return s25CompareNumbers(a.key.data, b.key.data) * sign;
          }
          return env().ub(a.key.toString(), b.key.toString()) * sign;
        }
        return a.hasKey() ? 1 : b.hasKey() ? -1 : 0;
      });
      const emptyIndex = groups.findIndex((g) => AnyValue.equals(g.key, NullValue.value));
      if (emptyIndex >= 0 && emptyIndex < groups.length - 1) moveItem(groups, emptyIndex, groups.length - 1);
      this.groupedDataCache = groups;
      return this.groupedDataCache;
    },
    enumerable: false, configurable: true,
  });
  /** Visible properties: the configured order filtered to known ids, note-renamed. */
  Object.defineProperty(QueryData.prototype, "properties", {
    get() {
      const self = this;
      const app = self.app;
      const config = self.config;
      const all = self.allProperties;
      const cached = self.propertiesCache;
      if (config && all) {
        if (cached) return cached;
        const order = config.getOrder();
        const known = new Set(all);
        const result = [];
        for (const id of order) {
          if (known.has(id)) { result.push(id); continue; }
          const parsed = parsePropertyId(id);
          if (parsed.type === "note") {
            const info = app.metadataTypeManager.getPropertyInfo(parsed.name);
            result.push(propertyId("note", info.name));
          }
        }
        this.propertiesCache = result;
        return result;
      }
      return undefined;
    },
    enumerable: false, configurable: true,
  });
  /**
   * Stable multi-key sort of `data` following the view config's sort specs; falls
   * back to file.name when nothing is configured.
   */
  QueryData.prototype.applySort = function (data) {
    const config = this.config;
    const all = this.allProperties;
    if (!config || !all) return;
    const known = new Set(all);
    let specs = config.getSort().filter((spec) => known.has(spec.property));
    if (specs.length === 0) specs = s25DefaultSort;
    const compare = (index, a, b) => {
      if (index >= specs.length) return 0;
      const spec = specs[index];
      const property = spec.property;
      const direction = spec.direction;
      let va, vb;
      try { va = a.getValue(property); vb = b.getValue(property); } catch { return 0; }
      let result = 0;
      if (va instanceof NullValue && vb instanceof NullValue) result = 0;
      else if (va instanceof BooleanValue || vb instanceof BooleanValue) {
        result = (va.isTruthy() ? 1 : -1) - (vb.isTruthy() ? 1 : -1);
      } else {
        if (va instanceof NullValue) return 1;
        if (vb instanceof NullValue) return -1;
        if (va instanceof NumberValue && vb instanceof NumberValue) result = va.data - vb.data;
        else if (va instanceof DateValue && vb instanceof DateValue) result = va.date.getTime() - vb.date.getTime();
        else if (va instanceof DurationValue && vb instanceof DurationValue) result = va.getMilliseconds() - vb.getMilliseconds();
        else {
          let sa = va.toString();
          let sb = vb.toString();
          if ((va instanceof LinkValue || va instanceof UrlValue) && va.display) sa = va.display.toString();
          if ((vb instanceof LinkValue || vb instanceof UrlValue) && vb.display) sb = vb.display.toString();
          result = env().ub(sa, sb);
        }
      }
      return result === 0 ? compare(index + 1, a, b) : direction === "ASC" ? result : -result;
    };
    data.sort((a, b) => compare(0, a, b));
  };
  /** Truncates `data` to the configured limit. */
  QueryData.prototype.applyLimit = function (data) {
    const limit = this.config.getLimit();
    if (limit > 0 && data.length > limit) data.splice(limit, data.length - limit);
  };
  /**
   * Display value of summary `index` over `property` for the group `entries`.
   * `queryController` supplies the query that owns the summary formulas. Results are
   * memoised per file in `summaryCache`.
   */
  QueryData.prototype.getSummaryValue = function (queryController, entries, property, index) {
    const cache = this.summaryCache;
    if (!cache.has(entries)) cache.set(entries, {});
    const perFile = cache.get(entries);
    if (!Object.hasOwn(perFile, property)) perFile[property] = {};
    const perFormula = perFile[property];
    if (!Object.hasOwn(perFormula, index)) {
      let type = undefined;
      for (const entry of entries) {
        const value = entry.getValue(property);
        if (value !== NullValue.value) { type = value.constructor; break; }
      }
      const formula = queryController.query.getSummaryFormula(type, index);
      perFormula[index] = NullValue.value;
      if (formula) {
        const values = entries.map((entry) => entry.getValue(property));
        const ctx = new SummaryValues(this.app, values);
        perFormula[index] = formula.getValue(ctx);
      }
    }
    return perFormula[index] || NullValue.value;
  };
  return QueryData;
}

// ---------------------------------------------------------------- formula suggester (`var PX`)

/**
 * Autocomplete provider for the formula editor: the generic expression completions
 * plus one entry per formula name defined on the query, inserting `formula["name"]`
 * or `formula.name` depending on whether the name is a valid identifier.
 */
export function defineS25FormulaSuggester(host) {
  const Base = s08FormulaSuggester(host);
  function FormulaSuggester() {
    return Base.apply(this, arguments) || this;
  }
  inherit(FormulaSuggester, Base);
  FormulaSuggester.prototype.getEncodedIdentifier = function (name) {
    return "note[" + JSON.stringify(name) + "]";
  };
  FormulaSuggester.prototype.expressionCompletions = function () {
    const completions = Base.prototype.expressionCompletions.call(this);
    const formulas = s08FormulaValue(this.ctx, "formula");
    const add = (name) => {
      let icon = "lucide-file-question";
      try { icon = formulas.objectAccess(name).icon; } catch {}
      completions.push({
        label: name,
        type: icon,
        apply: (from, to, insert, cursor) => {
          if (s09IsIdentifierName(name)) {
            host.GG(from, to, insert, cursor, "formula[" + JSON.stringify(name) + "]");
          } else {
            host.GG(from, to, insert, cursor, "formula." + name);
          }
        },
      });
    };
    const keys = formulas.keys();
    for (let i = 0; i < keys.length; i++) add(keys[i]);
    return completions;
  };
  return FormulaSuggester;
}

// ---------------------------------------------------------------- formula editor (`var UX`)

/**
 * The small CodeMirror formula input used inside toolbar forms: validates on a
 * debounce, shows a status line (valid/invalid icon plus the parse error as a
 * tooltip) and commits the parsed `DK` formula text on blur.
 */
export function defineS25FormulaEditor(host) {
  const Compartment = host.cmCompartmentClass;
  const FacetOf = host.s25FacetOf;
  const PlaceholderExt = host.s25PlaceholderExtension;
  function FormulaEditor(containerEl, initial, options) {
    const self = this;
    const root = containerEl.createDiv("formula-editor-container");
    const editorEl = root.createDiv("formula-editor");
    const statusEl = root.createDiv("formula-editor-status");
    const iconEl = statusEl.createDiv("status-icon");
    const labelEl = statusEl.createSpan();
    const paint = (state) => {
      const invalid = state && state.formula instanceof env().RK;
      statusEl.toggleClass("mod-error", invalid);
      statusEl.toggleClass("mod-empty", state && state.toString() === "");
      s25Icon(iconEl, invalid ? "lucide-x-circle" : "lucide-circle-check");
      labelEl.setText(invalid ? "Invalid formula" : "Valid formula");
      let tooltip = "";
      if (state && state.formula instanceof env().RK) tooltip = state.formula.getErrorMessage();
      host.Mv(statusEl, tooltip);
    };
    paint(initial);
    const commit = () => {
      const state = new (env().DK)(view.state.doc.toString());
      options.updateFormula(state);
      paint(state);
    };
    const debounced = debounceCall(commit, 250);
    const compartment = new Compartment();
    const view = new (env()._o)({
      doc: initial?.toString() || "",
      parent: editorEl,
      extensions: env().k(env().k(env().k([], s09FormulaEditorExtensions(), true), [
        PlaceholderExt(options.placeholder ?? "x + y"),
        compartment.of(FacetOf({ parent: view.doc.body })),
        env()._o.domEventHandlers({ blur: () => { debounced.cancel(); commit(); } }),
        env()._o.updateListener.of((update) => { if (update.docChanged) debounced(); }),
      ], false), options.extensions, true),
    });
    editorEl.onNodeInserted(() => {
      view.setRoot(view.doc);
      view.dispatch({ effects: [compartment.reconfigure(FacetOf({ parent: view.doc.body }))] });
    });
    env().Rv(root, 200, () => view.destroy(), "existence");
  }
  /** Appends the "?" help icon that opens the bases documentation. */
  FormulaEditor.appendHelpIcon = function (el) {
    const icon = el.createDiv("clickable-icon help-icon");
    s25Icon(icon, "lucide-help-circle");
    icon.addEventListener("click", () => window.open("https://github.com/FalconTechDev/basalt/wiki", "_blank"));
  };
  return FormulaEditor;
}
