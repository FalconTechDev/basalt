// Bases (database) view shell and its toolbar companions that live in the view
// file rather than the toolbar menus: the FileView subclass itself, the "+" new-item
// button with its hover popover, the per-view search bar, the view switcher menu,
// the view chooser page and the view configuration page (name, layout and per-layout
// options). The grouped/sorted data and the toolbar widgets are in
// s25-bases-toolbar.js.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { isStringArray } from "./misc.js";
import { baseName, normalizePath } from "./path.js";
import { parseLinktext, plainHeading, linkSafeHeading, uniqueName } from "./text.js";
import { prepareQuery, fuzzyMatchJs } from "./search.js";
import { debounceCall } from "./timing.js";
import { s09FiltersToFrontmatter, s09Query, s09View, s09FileContext } from "./s09-query.js";
import { s09BasesToolbarButton, s09BasesDropdown } from "./s09-publish.js";
import { s25ViewNameChars, s25ViewNamePattern, s25BasesViewType, s25Div, s25Icon } from "./s25-bases-toolbar.js";

const s25Strings = () => env().gm.plugins.bases;

// ---------------------------------------------------------------- bases view (`var HX`)

/**
 * The `bases` FileView: hosts the query controller (`C$`, the embed) which owns the
 * toolbar and the active view, persists the query text as the view data and tracks
 * the current file for sidebar vs main-area behaviour.
 */
export function defineS25BasesView(host) {
  const PlaintextView = host.PlaintextView;
  const FileView = env().MD;
  const TFile = env().$T;
  const Query = s09Query();
  const ViewType = s25BasesViewType;
  function BasesView(leaf, plugin) {
    const self = PlaintextView.call(this, leaf) || this;
    self.navigation = true;
    self.isPlaintext = false;
    self.lastData = "";
    self.plugin = plugin;
    const inSidebar = self.app.workspace.isInSidebar(self.leaf);
    const currentFile = inSidebar ? self.app.workspace.getActiveFile() : null;
    self.controller = new (host.s13BasesEmbed)(self.app, self.plugin, self.contentEl, currentFile);
    self.controller.events.on("view-changed", self.onViewChanged, self);
    self.addChild(self.controller);
    return self;
  }
  inherit(BasesView, PlaintextView);
  BasesView.prototype.showSearch = function () { this.controller.searchMenu.open(); };
  BasesView.prototype.load = function () {
    PlaintextView.prototype.load.call(this);
    this.registerEvent(this.app.workspace.on("file-open", this.updateCurrentFile, this));
    this.registerEvent(this.app.workspace.on("layout-change", this.onLayoutChange, this));
  };
  BasesView.prototype.onLayoutChange = function () {
    this.navigation = !this.app.workspace.isInSidebar(this.leaf);
  };
  BasesView.prototype.getViewType = function () { return ViewType; };
  BasesView.prototype.getIcon = function () {
    const type = this.controller.view?.type;
    if (type) {
      const registration = this.plugin.getRegistration(type);
      if (registration && registration.icon) return registration.icon;
    }
    return "lucide-layout-list";
  };
  BasesView.prototype.canAcceptExtension = function (extension) { return extension === "base"; };
  BasesView.prototype.updateCurrentFile = function (file) {
    if (this.app.workspace.isInSidebar(this.leaf) && this.leaf.app.workspace.activeLeaf === this.leaf) return;
    if (this.leaf.group || this.leaf.pinned) return;
    if (file && file instanceof TFile) this.controller.updateCurrentFile(file);
    else this.controller.updateCurrentFile(null);
  };
  BasesView.prototype.receiveSyncState = function (state) { this.controller.updateCurrentFile(state.file); };
  BasesView.prototype.onGroupChange = function () {
    PlaintextView.prototype.onGroupChange.call(this);
    if (this.leaf.group) {
      const leaves = this.leaf.workspace.getGroupLeaves(this.leaf.group);
      for (const leaf of leaves) {
        if (leaf !== this.leaf && leaf.view instanceof FileView) {
          this.controller.updateCurrentFile(leaf.view.file);
          break;
        }
      }
    } else {
      const file = this.leaf.workspace.getActiveFile();
      this.controller.updateCurrentFile(file);
    }
  };
  BasesView.prototype.getViewData = function () {
    const query = this.query;
    return query ? query.toString() : this.lastData;
  };
  BasesView.prototype.setViewData = function (data, clear) {
    this.lastData = data;
    let query;
    try {
      query = Query.fromString(data);
      query.file = this.file;
      query.saveFn = (q) => this.saveQuery(q);
      this.query = query;
    } catch (error) {
      query = error;
      this.query = null;
    }
    if (clear) this.controller.clear();
    this.controller.setQuery(query);
    this.leaf.updateHeader();
  };
  BasesView.prototype.getState = function () {
    const state = PlaintextView.prototype.getState.call(this);
    state.viewName = this.controller.viewName;
    return state;
  };
  BasesView.prototype.setState = async function (state, result) {
    const viewName = state.viewName;
    await PlaintextView.prototype.setState.call(this, state, result);
    if (viewName) {
      this.controller.selectView(viewName);
      this.leaf.updateHeader();
    }
  };
  BasesView.prototype.setEphemeralState = function (state) {
    PlaintextView.prototype.setEphemeralState.call(this, state);
    if (state.focus) this.controller.view?.focus();
    if (Object.hasOwn(state, "subpath") && state.subpath.startsWith("#")) {
      this.controller.selectView(state.subpath.substring(1));
    }
    this.controller.setEphemeralState(state);
  };
  BasesView.prototype.getEphemeralState = function () {
    const state = PlaintextView.prototype.getEphemeralState.call(this);
    return Object.assign(state, this.controller.getEphemeralState());
  };
  BasesView.prototype.saveQuery = function (query) {
    this.requestSave();
    this.lastData = query.toString();
    this.query = query;
    this.controller.setQuery(query);
  };
  BasesView.prototype.clear = function () { this.controller.clear(); };
  BasesView.prototype.onViewChanged = function () {
    this.app.workspace.requestSaveLayout();
    this.leaf.updateHeader();
  };
  return BasesView;
}

// ---------------------------------------------------------------- new-item button (`var jX`)

/**
 * The "+" button in the bases toolbar: creates a new markdown file from the view's
 * new-item template/folder (frontmatter filled from the query's filters), then opens
 * a hover popover with the file preview — or renames inline on phones.
 */
export function defineS25NewItemButton(host) {
  const Component = env().jm;
  const ViewClass = host.s13BaseFileView;
  const EmbedBase = host.StatefulEmbedBase;
  const HoverPopover = host.HoverPopover;
  const FileContext = s09FileContext();
  function NewItemButton(app, containerEl) {
    const self = Component.call(this) || this;
    self.errorEl = s25Div({ cls: "tooltip bases-filter-query-message", text: s25Strings().msgNewItemFiltered() });
    this.newlyCreatedFile = null;
    this.hoverPopover = null;
    this.app = app;
    this.containerEl = containerEl;
    this.buttonEl = containerEl.createDiv({ cls: "text-icon-button", attr: { tabIndex: 0 } }, (el) => {
      el.createSpan("text-button-icon", (icon) => s25Icon(icon, "plus"));
      el.createSpan({ cls: "text-button-label", text: s25Strings().labelNewItem() });
      el.addEventListener("click", (e) => self.toggle(e));
      el.addEventListener("keydown", (e) => {
        if (e.isComposing || e.defaultPrevented || (e.key !== " " && e.key !== "Enter")) return;
        self.open();
      });
    });
    this.registerDomEvent(containerEl.win, "click", (e) => {
      if (this.popover && !e.defaultPrevented
        && !this.popover.hoverEl.contains(e.targetNode)) this.close();
    });
    return self;
  }
  inherit(NewItemButton, Component);
  NewItemButton.prototype.toggle = function (evt) {
    evt.preventDefault();
    if (this.popover) this.close(); else this.open();
  };
  NewItemButton.prototype.close = function () {
    if (this.popover) { this.popover.hide(); this.popover = null; }
    this.newlyCreatedFile = null;
  };
  /**
   * `name` is the file base name (without extension); `beforeCreate` may adjust the
   * new file's frontmatter before it is written.
   */
  NewItemButton.prototype.open = async function (name, beforeCreate) {
    const app = this.app;
    const containerEl = this.containerEl;
    const query = this.query;
    const viewConfig = this.viewConfig;
    if (!query || !viewConfig) { this.close(); return; }
    const frontmatter = {};
    let fillFromFilters = false;
    const template = query.newItemTemplate;
    let folder = query.newItemFolder || "";
    if (template) {
      const templateFile = app.vault.getFileByPath(template);
      if (templateFile) {
        if (folder === "") folder = templateFile.parent?.path || "";
        Object.assign(frontmatter, app.metadataCache.getFileCache(templateFile).frontmatter || {});
        fillFromFilters = true;
      }
    }
    if (folder === "") folder = s09FiltersToFrontmatter(app, query, viewConfig).folder;
    if (folder === "") {
      const activePath = this.queryController.getCurrentFile()?.path
        ?? app.workspace.getActiveViewOfType(ViewClass)?.file.path;
      folder = app.fileManager.getNewFileParent(activePath || "").path;
    }
    if (folder && !folder.endsWith("/")) folder += "/";
    const untitled = env().gm.plugins.fileExplorer.labelUntitledFile();
    const filePath = app.vault.getAvailablePath(normalizePath(folder + baseName(name || untitled)), "md");
    const file = await app.vault.create(filePath, "");
    let data = frontmatter;
    if (!fillFromFilters) {
      const fileCtx = new FileContext(this.queryController.ctx, file);
      data = s09FiltersToFrontmatter(app, query, viewConfig, fileCtx).frontmatter;
    }
    await app.fileManager.processFrontMatter(file, (fm) => {
      for (const key in data) fm[key] = data[key];
      beforeCreate?.(fm);
    });
    if (env().Yl.isPhone) {
      app.workspace.getLeaf("tab").openFile(file, { active: true, eState: { rename: "all" } });
      return;
    }
    this.newlyCreatedFile = file;
    this.buttonEl.addClass("has-active-menu");
    const self = this;
    this.popover = await HoverPopover.create({
      app,
      hoverParent: this,
      targetEl: containerEl,
      linktext: file.path,
      sourcePath: file.path,
      state: { mode: "source" },
      waitTime: 0,
    });
    this.addChild(this.popover);
    this.popover.setIsFocused(true);
    this.popover.hoverEl.addClass("bases-new-item-popover");
    this.popover.register(() => {
      self.errorEl?.detach();
      self.buttonEl.removeClass("has-active-menu");
    });
    if (this.popover.embed instanceof EmbedBase) this.popover.embed.focusTitle();
  };
  /**
   * Called with the current query state; shows the "filtered out" tooltip next to
   * the button when the newly created file no longer matches the query.
   */
  NewItemButton.prototype.updateQuery = function (queryController, query, viewConfig, results) {
    this.queryController = queryController;
    this.query = query;
    this.viewConfig = viewConfig;
    if (this.newlyCreatedFile && this.popover) {
      if (results.has(this.newlyCreatedFile)) this.errorEl.detach();
      else if (!this.errorEl.isShown()) {
        const hoverEl = this.popover.hoverEl;
        const rect = hoverEl.getBoundingClientRect();
        hoverEl.doc.body.append(this.errorEl);
        env().Nv(rect, this.errorEl, { horizontalAlignment: "center", gap: 10 });
      }
    }
  };
  return NewItemButton;
}

// ---------------------------------------------------------------- search menu (`var ZX`)

/**
 * The magnifier toolbar button of a bases view: toggles a search bar that filters
 * the rendered rows through the query controller, with a result count.
 */
export function defineS25SearchMenu(host) {
  const Component = env().jm;
  const Scope = env().Ng;
  const ToolbarButton = s09BasesToolbarButton();
  const SearchComponent = host.SearchComponent;
  function SearchMenu(app, queryController, buttonParent, searchBarEl) {
    const self = Component.call(this) || this;
    self._isOpen = false;
    self.update = debounceCall((value) => {
      self.countEl.toggle(!!value);
      self.queryController.updateSearchQuery(value);
    }, 0);
    self.app = app;
    self.queryController = queryController;
    self.searchBarEl = searchBarEl;
    searchBarEl.hide();
    self.scope = new Scope(app.scope);
    self.scope.register([], "Escape", () => self.close());
    self.button = new ToolbarButton(buttonParent, env().gm.plugins.bases.labelSearch(), "lucide-search", () => self.toggle());
    self.button.containerEl.addClass("bases-toolbar-search");
    const search = new (SearchComponent)(searchBarEl)
      .setClass("document-search-input")
      .setPlaceholder(env().gm.editor.search.placeholderFind())
      .onChange((value) => self.update(value));
    self.inputEl = search.inputEl;
    self.countEl = search.containerEl.createDiv("document-search-count");
    self.countEl.hide();
    return self;
  }
  inherit(SearchMenu, Component);
  SearchMenu.prototype.onunload = function () { this.close(); };
  SearchMenu.prototype.open = function () {
    this.inputEl.value = this.queryController.getSearchQuery() || "";
    if (!this._isOpen) {
      this._isOpen = true;
      this.button.buttonEl.addClass("is-active");
      this.searchBarEl.show();
      this.app.keymap.pushScope(this.scope);
    }
    this.inputEl.focus({ preventScroll: true });
    this.inputEl.select();
  };
  SearchMenu.prototype.close = function () {
    if (!this._isOpen) return;
    this._isOpen = false;
    this.button.buttonEl.removeClass("is-active");
    this.searchBarEl.hide();
    this.app.keymap.popScope(this.scope);
    this.queryController.updateSearchQuery();
  };
  SearchMenu.prototype.toggle = function () { if (this._isOpen) this.close(); else this.open(); };
  SearchMenu.prototype.updateCount = function (results) {
    this.countEl.setText(env().gm.plugins.bases.labelSearchResults({ count: results.length }));
  };
  return SearchMenu;
}

// ---------------------------------------------------------------- view chooser (`var a$`)

/**
 * First page of the views menu: a search field listing the query's saved views plus
 * an "add view" action row. ArrowRight or the chevron drills into the view config
 * page; rows can be drag-reordered.
 */
export function defineS25ViewChooser(host) {
  const Page = host.s13BasesToolbarPage;
  const SearchComponent = host.SearchComponent;
  const GroupedList = host.GroupedSuggestionList;
  const ViewClass = s09View();
  const moveItem = (list, from, to) => {
    const item = list[from];
    list.splice(from, 1);
    list.splice(to, 0, item);
    return list;
  };
  function ViewChooser(controller) {
    const self = Page.call(this, controller) || this;
    self.controller = controller;
    this.searchComponent = new (SearchComponent)(this.containerEl)
      .setClass("mod-raised")
      .setPlaceholder(env().gm.plugins.search.promptStartSearch())
      .onChange(() => self.renderViews());
    const listEl = this.containerEl.createDiv("bases-toolbar-items");
    this.chooser = new (GroupedList)(this, listEl, this.scope);
    this.scope.register([], "ArrowRight", () => {
      const index = this.chooser.selectedItem;
      const item = this.chooser.values[index];
      if (item) this.handleNext?.(item.config);
    });
  }
  inherit(ViewChooser, Page);
  ViewChooser.prototype.onSelect = function (cb) { this.handleSelect = cb; return this; };
  ViewChooser.prototype.onNext = function (cb) { this.handleNext = cb; return this; };
  ViewChooser.prototype.onShow = function () {
    this.searchComponent.autoSelect();
    this.renderViews();
  };
  ViewChooser.prototype.selectSuggestion = function (item) {
    const config = item.config;
    if (config) this.handleSelect?.(config);
    else this.addView();
  };
  /** Fuzzy-filters the saved views by name and appends the add-view action. */
  ViewChooser.prototype.renderViews = function () {
    const prepared = prepareQuery(this.searchComponent.inputEl.value);
    const suggestions = [];
    for (let i = 0; i < this.controller.query.views.length; i++) {
      const view = this.controller.query.views[i];
      if (fuzzyMatchJs(prepared, view.name)) suggestions.push({ config: view, group: "views" });
    }
    suggestions.push({ config: null, group: "actions" });
    this.chooser.setSuggestions(suggestions);
  };
  ViewChooser.prototype.renderSuggestion = function (item, el) {
    const self = this;
    const config = item.config;
    el.addClass("bases-toolbar-menu-item");
    const info = el.createDiv("bases-toolbar-menu-item-info");
    const iconEl = info.createDiv("bases-toolbar-menu-item-info-icon");
    if (config === null) {
      s25Icon(iconEl, "plus");
      info.createDiv({ cls: "bases-toolbar-menu-item-name", text: env().gm.plugins.bases.buttonAddView() });
    } else {
      const registration = this.controller.queryController.plugin.getRegistration(config.type);
      s25Icon(iconEl, (registration && registration.icon) || "lucide-table");
      info.createDiv({ cls: "bases-toolbar-menu-item-name", text: config.name });
      el.toggleClass("mod-active", this.controller.queryController.viewName === config.name);
      const chevron = el.createDiv("clickable-icon bases-toolbar-menu-item-icon");
      s25Icon(chevron, "lucide-chevron-right");
      chevron.addEventListener("click", (e) => {
        e.preventDefault();
        if (self.chooser.getSelectedValue()) self.handleNext?.(config);
      });
      host.makeDragReorderable(iconEl, el, el.parentElement, 10, () => {}, (to) => {
        const query = self.controller.query;
        const from = query.views.indexOf(config);
        moveItem(query.views, from, to);
        query.save();
      });
    }
  };
  /** Creates a view named after the search text (or "View N") and opens its config. */
  ViewChooser.prototype.addView = function () {
    const query = this.controller.query;
    const taken = this.searchComponent.inputEl.value.trim() || env().gm.plugins.bases.labelDefaultView();
    const name = uniqueName(new Set(query.views.map((v) => v.name)), taken);
    const view = new ViewClass(query, "table", name);
    this.controller.show(new (host.s25ViewConfigPage)(this.controller, view, true));
  };
  return ViewChooser;
}

// ---------------------------------------------------------------- views menu (`var s$`)

/**
 * The view-type toolbar button (icon + name of the current view): dropdown with the
 * chooser page on top and the config page drilled in via chevron or right-click.
 */
export function defineS25ViewsMenu(host) {
  const Component = env().jm;
  const Dropdown = s09BasesDropdown();
  function ViewsMenu(app, queryController, parentEl) {
    const self = Component.call(this) || this;
    self.query = null;
    self.pageStack = [];
    self.app = app;
    self.queryController = queryController;
    const item = this.toolbarItem = new (Dropdown)(app, parentEl, s25Strings().labelViews(), "lucide-table")
      .onOpen(() => self.onOpen())
      .onClose(() => self.onClose());
    item.addClass("bases-toolbar-views-menu");
    item.button.buttonEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const config = queryController.getViewConfig();
      if (config) {
        item.setOpen(true);
        self.show(new (host.s25ViewConfigPage)(self, config, false));
      }
    });
    s25Icon(item.button.buttonEl.createSpan({ cls: "text-button-icon mod-aux" }), "lucide-chevrons-up-down");
    return self;
  }
  inherit(ViewsMenu, Component);
  Object.defineProperty(ViewsMenu.prototype, "scope", {
    get() { return this.toolbarItem.scope; }, enumerable: false, configurable: true,
  });
  ViewsMenu.prototype.onOpen = function () {
    const self = this;
    this.show(new (host.s25ViewChooser)(this)
      .onSelect((config) => { self.queryController.selectView(config.name); self.toolbarItem.setOpen(false); })
      .onNext((config) => self.show(new (host.s25ViewConfigPage)(self, config, false))));
  };
  ViewsMenu.prototype.onClose = function () {
    let page;
    while ((page = this.pageStack.pop())) this.app.keymap.popScope(page.scope);
    this.toolbarItem.scrollEl.empty();
  };
  /** Shows `page` inside the dropdown and pushes its scope. */
  ViewsMenu.prototype.show = function (page) {
    this.toolbarItem.scrollEl.setChildrenInPlace([page.containerEl]);
    page.onShow();
    this.pageStack.push(page);
    this.app.keymap.pushScope(page.scope);
  };
  /** Updates the button label/icon to the current view's name and type icon. */
  ViewsMenu.prototype.setView = function (name, icon) {
    this.toolbarItem.button.setText(name);
    this.toolbarItem.button.setIcon(icon);
  };
  /** Re-opens the menu on the chooser page (used after adding a view). */
  ViewsMenu.prototype.promptForAddView = function () {
    this.toolbarItem.setOpen(true);
    let page = this.pageStack[this.pageStack.length - 1];
    while (page && !(page instanceof host.s25ViewChooser)) { this.back(); page = this.pageStack[this.pageStack.length - 1]; }
    if (page instanceof host.s25ViewChooser) page.addView();
  };
  ViewsMenu.prototype.close = function () { this.toolbarItem.setOpen(false); };
  ViewsMenu.prototype.back = function () {
    const popped = this.pageStack.pop();
    if (popped) this.app.keymap.popScope(popped.scope);
    const top = this.pageStack[this.pageStack.length - 1];
    if (top) {
      this.toolbarItem.scrollEl.setChildrenInPlace([top.containerEl]);
      top.onShow();
    }
  };
  ViewsMenu.prototype.updateQuery = function (query) { this.query = query; };
  return ViewsMenu;
}

// ---------------------------------------------------------------- view config page (`var l$`)

/**
 * The view configuration page inside the views menu: name input (with duplicate /
 * invalid-name validation and link rewriting on rename), a layout dropdown fed by
 * the registered view types and the layout's own option rows (dropdown, multitext,
 * slider, text, toggle, property, file, folder, formula and grouped sections).
 */
export function defineS25ViewConfigPage(host) {
  const Page = host.s13BasesToolbarPage;
  const TextComponent = host.TextComponent;
  const DropdownComponent = host.DropdownComponent;
  const FormulaEditor = host.s13FormulaEditor;
  const FormulaSuggest = host.s13FormulaEditorExtensions;
  const SummaryValuesEditor = host.s13SummaryValuesEditor;
  const PropertySuggest = s09PropertySuggest();
  const Menu = env().Ug;
  const RefMultimap = env().sc;
  const Notice = env().fb;
  const toggleVisibility = host.collapseElement;
  const isEditable = host.s10IsEditable;
  function ViewConfigPage(controller, view, isNew) {
    const self = Page.call(this, controller) || this;
    this.configControls = new Map();
    this.view = view;
    const header = this.containerEl.createDiv("bases-toolbar-menu-container-header");
    const back = header.createDiv("back-button");
    s25Icon(back.createDiv("back-icon"), "lucide-chevron-left");
    back.createDiv({ text: env().gm.plugins.bases.labelConfigureView(), cls: "back-label" });
    back.addEventListener("click", () => self.controller.back());
    const more = header.createDiv("clickable-icon");
    s25Icon(more, "lucide-more-vertical");
    more.addEventListener("click", (e) => self.showActions(e, more));
    const close = header.createDiv("close-icon clickable-icon");
    s25Icon(close, "lucide-x");
    close.addEventListener("click", () => self.controller.close());
    this.scope.register([], "Escape", (e) => {
      if (e.defaultPrevented || isEditable(this.containerEl.doc.activeElement)) return;
      self.controller.back();
    });
    this.formEl = this.containerEl.createDiv("bases-toolbar-menu-form view-config-menu");
    this.display(view, isNew);
  }
  inherit(ViewConfigPage, Page);
  /** Rebuilds the whole form for `view`; `isNew` marks a just-created view. */
  ViewConfigPage.prototype.display = function (view, isNew = false) {
    const self = this;
    const controls = this.configControls;
    const controller = this.controller;
    const app = controller.app;
    const query = controller.query;
    const queryController = controller.queryController;
    const formEl = this.formEl;
    controls.clear();
    const name = view.name;
    let pendingName = "";
    formEl.empty();
    const nameRow = formEl.createDiv("input-row");
    const nameInput = new (TextComponent)(nameRow.createDiv("input-row-content"))
      .setPlaceholder(env().gm.plugins.bases.labelViewName())
      .setValue(view.name)
      .onChange((value) => {
        name = value.trim();
        pendingName = validateName();
        if (pendingName) host.kv(nameInput.inputEl, pendingName, { classes: ["mod-error"] });
        else host.hideTooltip();
      })
      .autoSelect(true);
    const inputEl = nameInput.inputEl;
    const validateName = () => {
      if (name.trim() === "") return env().gm.plugins.bases.msgEmptyViewName();
      if (s25ViewNamePattern.test(name)) return env().gm.plugins.bases.msgInvalidViewName() + " " + s25ViewNameChars;
      for (const other of query.views) {
        if (other.name === name) return env().gm.plugins.bases.msgDuplicateViewName();
      }
      return "";
    };
    inputEl.addEventListener("keydown", (e) => {
      if (e.isComposing || e.defaultPrevented) return;
      if (e.key === "Escape") { e.preventDefault(); inputEl.value = name = view.name; inputEl.blur(); }
      else if (e.key === "Enter") { e.preventDefault(); if (!pendingName) inputEl.blur(); }
    });
    inputEl.addEventListener("blur", () => {
      if ((!isNew || view.name !== name) && !pendingName) {
        const oldName = view.name;
        view.name = name;
        if (isNew) { query.views.push(view); isNew = false; }
        queryController.selectView(name);
        query.save();
        if (!isNew && query.file) {
          void rewriteLinks(oldName, name);
        }
      }
    });
    const rewriteLinks = async (oldName, newName) => {
      const cache = controller.app.metadataCache;
      const changed = new RefMultimap();
      const oldHeading = plainHeading(oldName).toLowerCase();
      const newSubpath = linkSafeHeading(newName);
      cache.iterateAllRefs((sourcePath, ref) => {
        const parsed = parseLinktext(ref.link);
        const path = parsed.path;
        const subpath = parsed.subpath;
        if (subpath && plainHeading(subpath.substring(1)).toLowerCase() === oldHeading
          && cache.getFirstLinkpathDest(path, sourcePath) === query.file) {
          changed.add(sourcePath, { sourcePath, reference: ref, change: env().WL(ref, path + "#" + newSubpath) });
        }
      });
      const files = changed.data.size;
      const links = changed.count();
      if (links > 0) {
        await cache.updateInternalLinks(changed);
        const linkText = env().gm.nouns.linkWithCount({ count: links });
        const fileText = env().gm.nouns.fileWithCount({ count: files });
        new Notice(env().gm.dialogue.msgUpdatedLinks({ links: linkText, files: fileText }));
      }
    };
    const layoutItems = [];
    const basesPlugin = app.internalPlugins.getEnabledPluginById("bases");
    if (basesPlugin) {
      const registrations = basesPlugin.getRegistrations();
      for (const key of Object.keys(registrations)) {
        const registration = registrations[key];
        layoutItems.push({ value: key, display: registration.name, icon: registration.icon });
      }
    }
    const layoutRow = formEl.createDiv("input-row");
    layoutRow.createDiv({ cls: "input-row-label", text: env().gm.plugins.bases.labelViewLayout() });
    new (DropdownComponent)(app, layoutRow.createDiv("input-row-content"))
      .setItems(layoutItems)
      .setValueById(view.type)
      .onSelect((item) => { view.type = item.value; self.display(view); query.save(); });
    const registration = queryController.plugin.getRegistration(view.type);
    if (registration?.options) {
      const renderOption = (container, option) => {
        if (option.type === "group") {
          const open = container.createDiv("input-group-container");
          if (container.hasChildNodes()) open.createDiv("input-group-divider");
          const header = open.createDiv("input-group").createDiv("input-group-header");
          const arrow = header.createDiv({ cls: "collapse-icon is-collapsed" });
          s25Icon(arrow, "right-triangle");
          header.createDiv({ cls: "input-group-header-text", text: option.displayName });
          const content = open.createDiv("input-group-content");
          content.hide();
          let expanded = true;
          for (const child of option.items) renderOption(content, child);
          header.addEventListener("click", (e) => {
            e.preventDefault();
            expanded = !expanded;
            arrow.toggleClass("is-collapsed", expanded);
            toggleVisibility(content, expanded, true);
          });
          controls.set(option, open);
          return;
        }
        let row, labelEl, contentEl;
        const current = view.get(option.key) ?? option.default;
        row = container.createDiv("input-row");
        labelEl = row.createDiv({ cls: "input-row-label", text: option.displayName });
        contentEl = row.createDiv("input-row-content");
        controls.set(option, row);
        const commit = () => self.updateHiddenOptions(view);
        if (option.type === "dropdown") {
          new (DropdownComponent)(contentEl).addOptions(option.options)
            .setValue(String.isString(current) ? current : "")
            .onChange((value) => { view.set(option.key, value === "" ? null : value); commit(); });
        } else if (option.type === "multitext") {
          new (host.s25MultiTextComponent)(contentEl)
            .allowCreatingOptions((value) => value.trim())
            .setValues(isStringArray(current, false) ? current : [])
            .onChange((values) => { view.set(option.key, values); commit(); });
        } else if (option.type === "slider") {
          new (host.SliderComponent)(contentEl)
            .setLimits(option.min, option.max, option.step)
            .setDynamicTooltip()
            .setInstant(option.instant ?? true)
            .setValue(Number.isNumber(current) ? current : null)
            .onChange((value) => { view.set(option.key, value); commit(); });
        } else if (option.type === "text") {
          new (TextComponent)(contentEl)
            .setPlaceholder(option.placeholder)
            .setValue(String.isString(current) ? current : "")
            .onChange((value) => { view.set(option.key, value); commit(); });
        } else if (option.type === "toggle") {
          new (env().Gk)(contentEl)
            .setValue(typeof current === "boolean" && current)
            .onChange((value) => { view.set(option.key, value); commit(); });
        } else if (option.type === "property") {
          new PropertySuggest(queryController, contentEl)
            .setPlaceholder(option.placeholder)
            .filterProperties(option.filter)
            .setClearable(true)
            .setValueById(String.isString(current) ? current : "")
            .onSelect((item) => { view.set(option.key, item?.value); commit(); });
        } else if (option.type === "file") {
          const input = new (TextComponent)(contentEl)
            .setPlaceholder(option.placeholder || "")
            .setValue(String.isString(current) ? current : "")
            .onChange((value) => { view.set(option.key, value); commit(); });
          new (host.s25FilePathSuggest)(app, input.inputEl, option.filter);
        } else if (option.type === "folder") {
          const input = new (TextComponent)(contentEl)
            .setPlaceholder(option.placeholder || "")
            .setValue(String.isString(current) ? current : "")
            .onChange((value) => { view.set(option.key, value); commit(); });
          new (host.FolderPathSuggest)(app, input.inputEl, option.filter, true);
        } else if (option.type === "formula") {
          const formula = new (env().DK)(String.isString(current) ? current : "");
          new FormulaEditor(contentEl, formula, {
            updateFormula: (f) => view.set(option.key, f.toString()),
            extensions: [new (host.s25FormulaSuggester)(new SummaryValuesEditor(controller.app))],
            placeholder: option.placeholder,
          });
          FormulaEditor.appendHelpIcon(labelEl);
        }
      };
      const options = registration.options(view);
      for (const option of options) renderOption(this.formEl, option);
    }
    this.updateHiddenOptions(view);
  };
  /** Shows/hides option rows whose `shouldHide` predicate matches the view. */
  ViewConfigPage.prototype.updateHiddenOptions = function (view) {
    this.configControls.forEach((row, option) => {
      const hidden = option.shouldHide?.(view);
      row.toggle(!hidden);
      if (option.type === "group" && !hidden) {
        const anyVisible = option.items.some((item) => !item.shouldHide?.(view));
        row.toggle(!!anyVisible);
      }
    });
  };
  /** Context menu of the config page: set-default / duplicate / delete view. */
  ViewConfigPage.prototype.showActions = function (evt, target) {
    const self = this;
    if (target && target.hasClass("has-active-menu")) return;
    const view = this.view;
    const controller = this.controller;
    const query = controller.query;
    const queryController = controller.queryController;
    const menu = Menu.forEvent(evt);
    menu.addSections(["action", "", "danger"]);
    if (target) menu.setParentElement(target);
    menu.addItem((item) => item
      .setTitle(env().gm.plugins.bases.actionSetDefaultView())
      .setIcon("lucide-layers-2")
      .setSection("action")
      .setChecked(query.views.indexOf(view) === 0)
      .onClick(() => {
        const index = query.views.indexOf(view);
        moveItemLocal(query.views, index, 0);
        query.save();
      }));
    menu.addItem((item) => item
      .setTitle(env().gm.plugins.bases.actionDuplicateView())
      .setIcon("lucide-files")
      .setSection("action")
      .onClick(() => {
        controller.back();
        const name = uniqueName(new Set(query.views.map((v) => v.name)), view.name);
        const copy = view.clone(name);
        controller.show(new (ViewConfigPage)(controller, copy, true));
        query.save();
      }));
    menu.addItem((item) => item
      .setTitle(env().gm.plugins.bases.actionDeleteView())
      .setIcon("lucide-trash-2")
      .setSection("danger")
      .setWarning(true)
      .onClick(() => {
        const index = query.views.indexOf(view);
        query.views.remove(view);
        const next = query.views[Math.clamp(index - 1, 0, query.views.length)];
        queryController.selectView(next.name);
        self.controller.back();
        query.save();
      }));
    menu.showAtMouseEvent(evt);
  };
  return ViewConfigPage;
}

function moveItemLocal(list, from, to) {
  const item = list[from];
  list.splice(from, 1);
  list.splice(to, 0, item);
  return list;
}
