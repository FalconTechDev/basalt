// Slice s26 — `var C$` QueryController: drives a Bases embed/view — owns the
// toolbar menus, runs the query over the vault through the search queue,
// applies the search filter, builds evaluation contexts and swaps view types.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { propertyId, keyIgnoringCase } from "./text.js";
import { emptyToNull } from "./misc.js";
import { debounceCall } from "./timing.js";
import { prepareQuery } from "./search.js";
import { s04StringCompare } from "./s04-themes.js";
import { batchedAsync } from "./metadata-helpers.js";
import { s09BasesStrings } from "./s09-formula.js";
import { s09ValueTypeName } from "./s09-query.js";
import { s10FolderContains } from "./s10-app.js";
import { s10MoveFilesAndUpdateLinks } from "./s10-app.js";

const s26BasesStrings = s09BasesStrings;

/** `var k$` — tiny Events subclass used by the controller: re-broadcasts `trigger`
 *  with the event name prepended to the argument list. */
export function s26BasesEvents(host) {
  const Base = host.Events;
  function BasesEvents() {
    const self = Base.apply(this, arguments) || this;
    return self;
  }
  inherit(BasesEvents, Base);
  BasesEvents.prototype.trigger = function (name, ...args) {
    Base.prototype.trigger.call(this, name, ...args);
  };
  BasesEvents.prototype.on = function (name, callback, ctx) {
    return Base.prototype.on.call(this, name, callback, ctx);
  };
  return BasesEvents;
}

/** `var C$` — the Bases query controller (public API `QueryController`). */
export function s26BasesController(host) {
  const Base = host.Component;
  function QueryController(app, plugin, containerEl, currentFile = null) {
    const self = Base.call(this) || this;
    self.currentFile = null;
    self.query = null;
    self.results = new Map();
    self.errors = new Set();
    self.searchQuery = null;
    self.ctx = null;
    self.viewEstates = {};
    self.error = null;
    self.events = new (env().k$)();
    self.requestNotifyView = debounceCall(self.notifyView.bind(self), 50);
    self.relevantProperties = new Set();
    self.queryState = "";
    self.app = app;
    self.plugin = plugin;
    self.currentFile = currentFile;

    const header = (self.viewHeaderEl = containerEl.createDiv({ cls: "bases-header" })).createDiv({ cls: "bases-toolbar" });
    self.viewMenu = self.addChild(new (env().s$)(app, self, header));
    self.resultsMenu = new (env().$X)(app, header);
    self.sortMenu = new (env().e$)(app, header);
    self.filterMenu = new (env().AX)(self, header);
    self.propertyMenu = self.addChild(new (env().GX)(self, header));
    const searchRow = containerEl.createDiv("bases-search-row");
    self.searchMenu = self.addChild(new (env().ZX)(app, self, header, searchRow));
    self.newItemMenu = self.addChild(new (env().jX)(app, header.createDiv("bases-toolbar-item bases-toolbar-new-item-menu")));
    self.errorEl = containerEl.createDiv("bases-error");
    self.viewContainerEl = containerEl.createDiv("bases-view");
    self.viewContainerEl.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "PageUp" && host.Keymap.isModifier(e, "Mod") && e.shiftKey) {
        e.preventDefault();
        const names = self.getQueryViewNames();
        const idx = names.indexOf(self.viewName);
        const prev = names[(idx + names.length - 1) % names.length];
        self.selectView(prev);
        self.view.focus();
      } else if (e.key === "PageDown" && host.Keymap.isModifier(e, "Mod") && e.shiftKey) {
        e.preventDefault();
        const names = self.getQueryViewNames();
        const idx = names.indexOf(self.viewName);
        const next = names[(idx + 1) % names.length];
        self.selectView(next);
        self.view.focus();
      }
    });

    // Applies frontmatter+folder defaults to files dropped onto the view.
    const applyDefaults = async (files) => {
      const perFile = async (file) => {
        const itemCtx = new (host.s13QueryItem)(self.ctx, file);
        const fm = host.s13NewItemContext(app, self.query, self.getViewConfig(), itemCtx);
        const frontmatter = fm.frontmatter, folder = fm.folder;
        await app.fileManager.processFrontMatter(file, (data) => {
          for (const key of Object.keys(frontmatter)) {
            if (data[key] === undefined) data[key] = frontmatter[key];
          }
          return data;
        });
        if (folder) {
          const target = app.vault.getFolderByPath(folder);
          if (target && s10FolderContains(app, file, target, host)) await s10MoveFilesAndUpdateLinks(app, [file], target, host);
        }
      };
      for (const file of files) await perFile(file);
    };

    app.dragManager.handleDrop(self.viewContainerEl, (event, data, isHandled) => {
      if (data) {
        const files = [];
        if (data.type === "file" || data.type === "link") files.push(data.file);
        else if (data.type === "files") {
          for (const f of data.files) if (f instanceof host.TFile) files.push(f);
        } else if (data.type === "bookmarks") {
          for (const item of data.items) {
            if (item.item.type === "file") {
              const f = app.vault.getFileByPath(item.item.path);
              if (f) files.push(f);
            }
          }
        }
        if (files.length !== 0) {
          if (!isHandled) applyDefaults(files);
          return { hoverClass: "is-being-dragged-over", hoverEl: self.viewContainerEl, dropEffect: "copy" };
        }
      } else if (env().kP(event.dataTransfer)) {
        if (!isHandled) {
          const folderPath = host.s13FilterOps.fromQuery(self.query, self.getViewConfig()).folder;
          const folder = folderPath ? app.vault.getFolderByPath(folderPath) : null;
          (async () => {
            const imported = await app.importAttachments(host.clipboardFiles(event.dataTransfer, "drop", true), folder);
            applyDefaults(imported);
          })();
        }
        return { dropEffect: "copy", hoverEl: self.viewContainerEl, hoverClass: "is-being-dragged-over" };
      }
      return undefined;
    }, true);

    self.mockContext = new (env().DY)(app, {});
    self.queue = new (env().aq)(app, self);
    self.addChild(self.queue);
    new ResizeObserver(() => self.onResize()).observe(self.viewContainerEl);
    return self;
  }
  inherit(QueryController, Base);

  QueryController.prototype.onload = function () {
    this.registerEvent(this.app.metadataTypeManager.on("changed", this.requestNotifyView.bind(this)));
    this.registerEvent(this.app.vault.on("config-changed", this.onConfigChanged, this));
  };

  QueryController.prototype.onConfigChanged = function (key) {
    if (key === "userIgnoreFilters") { this.queryState = ""; this.update(); }
  };

  QueryController.prototype.setEphemeralState = function (state) {
    if (state && Object.hasOwn(state, "views")) {
      const views = this.viewEstates = state.views;
      if (Object.hasOwn(views, this.viewName)) this.view.setEphemeralState(views[this.viewName]);
    }
  };

  QueryController.prototype.getEphemeralState = function () {
    const views = this.viewEstates;
    views[this.viewName] = this.view?.getEphemeralState();
    return { views };
  };

  QueryController.prototype.onResize = function () { this.view?.onResize(); };

  QueryController.prototype.promptForAddView = function () { this.viewMenu.promptForAddView(); };

  QueryController.prototype.selectView = function (name) {
    if (this.viewName === name) return;
    const estates = this.viewEstates;
    if (this.view) estates[this.viewName] = this.view.getEphemeralState();
    this.viewName = name;
    if (this.error === "view") this.clearError();
    this.update();
    if (this.view && Object.hasOwn(estates, this.viewName)) this.view.setEphemeralState(estates[this.viewName]);
    this.events.trigger("view-changed");
  };

  QueryController.prototype.setQuery = function (query) {
    this.clearError();
    if (query instanceof Error) { this.displayError("query", query); return; }
    if (!this.query || query.toString() !== this.query.toString()) this.query = query;
    this.update();
  };

  QueryController.prototype.setQueryAndView = function (query, viewName) {
    const prev = this.viewName;
    this.viewName = viewName;
    this.setQuery(query);
    if (prev !== viewName) this.events.trigger("view-changed");
  };

  QueryController.prototype.getActiveBasesViewOfType = function (type) {
    return this.view instanceof type ? this.view : null;
  };

  QueryController.prototype.getQueryViewNames = function () {
    return this.query?.views?.map((v) => v.name) || [];
  };

  QueryController.prototype.getCurrentFile = function () { return this.currentFile; };

  QueryController.prototype.getViewConfig = function () { return this.query.getViewConfig(this.viewName); };

  QueryController.prototype.getSearchQuery = function () { return this.searchQuery || null; };

  QueryController.prototype.updateSearchQuery = function (query) {
    if (this.searchQuery === query) return;
    this.searchQuery = query || null;
    if (this.query) this.requestNotifyView();
  };

  QueryController.prototype.updateCurrentFile = function (file) {
    if (file === this.currentFile) return;
    this.currentFile = file;
    if (!this.query) return;
    const config = this.getViewConfig();
    const ctx = this.ctx = this.buildBasesContext(config?.filters);
    this.runQuery(ctx);
  };

  QueryController.prototype.update = function () {
    const query = this.query, viewName = this.viewName;
    if (!query) return;
    const config = query.getViewConfig(viewName);
    if (!config) {
      this.viewMenu.updateQuery(query, null);
      this.displayError("view", new Error(s26BasesStrings().msgErrorViewNotFound({ view: viewName })));
      this.viewMenu.setView(viewName, "lucide-file-question");
      this.queryState = "";
      this.events.trigger("view-changed");
      return;
    }
    if (!viewName) {
      this.viewName = config.name;
      this.events.trigger("view-changed");
    }
    const registration = this.plugin.getRegistration(config.type);
    this.viewMenu.setView(config.name, registration?.icon || "lucide-file-question");
    if (config.type !== this.view?.type) {
      if (this.view) { this.removeChild(this.view); this.view = null; this.viewContainerEl.empty(); }
      const factory = this.plugin.getViewFactory(config.type);
      if (!factory) {
        this.viewMenu.updateQuery(query, config);
        this.displayError("view", new Error(s26BasesStrings().msgErrorUnknownViewType({ viewtype: config.type })));
        return;
      }
      this.view = factory(this, this.viewContainerEl);
      this.addChild(this.view);
      this.events.trigger("view-changed");
    }
    if (this.view) this.view.config = config;
    this.viewContainerEl.dataset.viewType = this.view?.type || "";
    this.viewContainerEl.dataset.viewName = this.viewName || "";
    this.viewContainerEl.toggleClass("is-grouped", !!config.groupBy);
    const formulas = query.formulas;
    const formulaText = {};
    if (formulas) for (const key in formulas) if (Object.hasOwn(formulas, key)) formulaText[key] = formulas[key].toString();
    const ctx = this.ctx = this.buildBasesContext(config?.filters);
    const stateKey = JSON.stringify({ filter: ctx.filter, formulas: formulaText });
    if (stateKey !== this.queryState) { this.queryState = stateKey; this.runQuery(ctx); }
    else this.requestNotifyView();
  };

  QueryController.prototype.buildBasesContext = function (extraFilters) {
    const app = this.app, query = this.query;
    const filters = host.s13FilterOps.and(query.filters, extraFilters);
    return new (host.s13QuerySession)(app, filters, query.formulas, this.currentFile);
  };

  QueryController.prototype.clear = function () {
    this.query = null;
    this.queryState = null;
    this.viewName = "";
    this.queue.stop();
    if (this.view) { this.removeChild(this.view); this.view = null; this.viewContainerEl.empty(); }
    this.events.trigger("view-changed");
  };

  QueryController.prototype.displayError = function (kind, error) {
    this.error = kind;
    this.viewContainerEl.hide();
    this.viewHeaderEl.toggle(kind !== "query");
    this.filterMenu.setEnabled(false);
    this.propertyMenu.setEnabled(false);
    const el = this.errorEl;
    el.empty();
    if (kind === "query") el.createEl("p", { text: s26BasesStrings().msgErrorUnableToParse() });
    el.createEl("p", { text: error.message });
    el.show();
  };

  QueryController.prototype.clearError = function () {
    this.error = null;
    this.viewContainerEl.show();
    this.viewHeaderEl.show();
    this.errorEl.empty();
    this.errorEl.hide();
    this.filterMenu.setEnabled(true);
    this.propertyMenu.setEnabled(true);
  };

  QueryController.prototype.notifyView = function () {
    const app = this.app, query = this.query, view = this.view;
    if (!query || this.initialScan) return;
    const failed = Array.from(this.errors);
    this.errors.clear();
    for (const message of failed) new host.Notice(message);
    const config = query.getViewConfig(this.viewName);
    this.viewMenu.updateQuery(query, config);
    if (!config) return;
    const results = Array.from(this.results.values());
    const filtered = this.applySearchQuery(results, config.getOrder());
    filtered.sort((a, b) => s04StringCompare(a.file.path, b.file.path));
    this.evaluateRelevantProperties(filtered);
    const properties = this.getProperties();
    if (view) {
      view.allProperties = properties;
      view.data = new (host.s13QueryTable)(app, config, properties, filtered);
      view.onDataUpdated();
    }
    this.mockContext = new (env().DY)(app, this.ctx?.formulas ?? {});
    this.filterMenu.updateQuery(query, config);
    this.propertyMenu.updateQuery(query, config);
    this.newItemMenu.updateQuery(this, query, config, this.results);
    this.sortMenu.updateQuery(this, query, config);
    this.resultsMenu.updateQuery(view, config, this.results.size);
    this.searchMenu.updateCount(filtered);
  };

  QueryController.prototype.evaluateRelevantProperties = function (results) {
    const relevant = this.relevantProperties = new Set();
    for (const result of results) {
      for (const key of result.getPropertyKeys()) relevant.add(key.toLowerCase());
    }
  };

  QueryController.prototype.getProperties = function () {
    const typeManager = this.app.metadataTypeManager;
    const properties = [];
    properties.push(...host.s13QueryItem.FILE_PROPERTIES);
    for (const key of Array.from(this.relevantProperties)) {
      properties.push(propertyId("note", typeManager.getPropertyInfo(key).name));
    }
    for (const key of Object.keys(this.query.formulas || {})) properties.push(propertyId("formula", key));
    return properties;
  };

  QueryController.prototype.runQuery = function (ctx) {
    const self = this, container = this.viewContainerEl;
    this.queue.stop();
    this.errors.clear();
    const runnable = this.queue.start();
    const stream = batchedAsync(runnable.generator(), { batchSize: 10, duration: 50, maxDelay: 16 });
    this.initialScan = true;
    (async () => {
      let progressed = true, done = false, failure = null;
      try {
        for await (const file of stream) {
          progressed = true;
          if (runnable.runnable.isCancelled()) return;
          if (!container.isShown()) await new Promise((resolve) => container.onNodeInserted(resolve, true));
          if (ctx.local && ctx.local.file === file) {
            if (done) {
              if (ctx.localUsed) { this.runQuery(ctx.regenerateLocal()); return; }
            } else {
              done = true;
            }
          }
          this.removeResult(file);
          if (this.app.metadataCache.isUserIgnored(file.path)) continue;
          try {
            const item = new (host.s13QueryItem)(ctx, file);
            if (!ctx.filter || ctx.filter.test(item)) this.addResult(file, item);
          } catch (e) {
            this.errors.add(s26BasesStrings().msgErrorFilterFailedToEvaluate({ message: e.message }));
          }
        }
      } catch (e) { failure = e; }
      finally {
        if (failure) throw failure;
      }
    })();
  };

  QueryController.prototype.startLoader = function () {};
  QueryController.prototype.stopLoader = function () { this.initialScan = false; this.requestNotifyView(); };

  QueryController.prototype.addResult = function (file, item) { this.results.set(file, item); };
  QueryController.prototype.removeResult = function (file) {
    if (this.results.has(file)) { this.results.delete(file); this.requestNotifyView(); }
  };

  // Maps a formula/property identifier to the settings-widget kind it should use.
  QueryController.prototype.getWidgetForIdent = function (ident) {
    switch (ident) {
      case "file.file":
      case "file.path": return "file";
      case "file.tags": return "tags";
      case "file.ctime":
      case "file.mtime": return "date";
      case "file.folder": return "folder";
      default: {
        const value = this.mockContext.evaluateIdent(ident);
        if (value instanceof host.LW) return value.time ? "datetime" : "date";
        return s09ValueTypeName(value.type);
      }
    }
  };

  QueryController.prototype.getEditorLanguageSupport = function () {
    return new (host.s13FormulaEditorExtensions)(this.mockContext);
  };

  // Keeps only results whose searchable text contains every query token.
  QueryController.prototype.applySearchQuery = function (results, order) {
    const query = this.searchQuery;
    if (!query?.trim()) return results;
    const tokens = prepareQuery(query).tokens;
    if (tokens.length === 0) return results;
    return results.filter((result) => {
      const remaining = tokens.slice();
      for (const prop of order) {
        try {
          const value = result.getValue(prop);
          if (!value || value === env().bW.value) continue;
          let text = value.toString().toLowerCase();
          for (let i = remaining.length - 1; i >= 0; i--) {
            if (text.includes(remaining[i])) remaining.splice(i, 1);
          }
          if (remaining.length === 0) return true;
        } catch (e) { /* unreadable property: skip */ }
      }
      return false;
    });
  };

  return QueryController;
}
