// Slice s09 — Bases query model: views, filters, property configs, the query (de)serialiser and the
// evaluation contexts formulas run against. Formula AST nodes and the lezer parser live in s09-formula.js;
// formula *values* and property types stay inherited and are reached through env().
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { parsePropertyId, propertyId, shortPropertyId, longPropertyId, keyIgnoringCase } from "./text.js";
import { s09FormulaNode, s09FormulaText, s09InvalidNode, s09IsIdentifierName, s09SummaryFormulasFor, s09BasesStrings, s09PrimitiveNode, s09IdentNode, s09ObjectAccessNode, s09ArrayAccessNode, s09CallNode, s09NotNode, s09CompareNode } from "./s09-formula.js";

// Every class factory is memoised: the manifest wraps each `var X=...()` declarator once, but the classes
// reference each other through these factories and `instanceof` must keep seeing a single object per name.
const s09QCache = {};
function s09Once(key, build) { return s09QCache[key] ??= build(); }

// ---------------------------------------------------------------- small data tables

/** `var vY = {...}` — display labels for the built-in `file.*` properties. */
export function s09FilePropLabels() {
  const c = s09BasesStrings();
  return {
    "file.file": c.labelFilePropFile,
    "file.name": c.labelFilePropName,
    "file.basename": c.labelFilePropBaseName,
    "file.fullname": c.labelFilePropFullName,
    "file.path": c.labelFilePropPath,
    "file.folder": c.labelFilePropFolder,
    "file.ext": c.labelFilePropExt,
    "file.ctime": c.labelFilePropCtime,
    "file.mtime": c.labelFilePropMtime,
    "file.size": c.labelFilePropSize,
    "file.links": c.labelFilePropLinks,
    "file.backlinks": c.labelFilePropBacklinks,
    "file.embeds": c.labelFilePropEmbeds,
    "file.tags": c.labelFilePropTags,
  };
}

/** `var yY` — default sort for a fresh view. */
export const s09DefaultSort = [{ property: "file.name", direction: "ASC" }];
/** `var bY` — properties used when a view has no explicit order. */
export const s09DefaultOrder = ["file.name"];
/** `var wY` — the built-in file properties (never user properties). */
export const s09FileProperties = ["file.file", "file.path", "file.ctime", "file.mtime", "file.name", "file.fullname", "file.basename"];

/** `var rY = Symbol()` — sentinel marking a formula currently being evaluated (cycle guard). */
export const s09FormulaLoopSentinel = Symbol();

// ---------------------------------------------------------------- filter AST

/** Base of every filter node: rule flattening with negation, optimisation and the and/or/not builders. */
function s09buildFilterBase() {
  function FilterBase() {}
  FilterBase.prototype.getFilterRules = function () { return this.getFilterRulesWithNegation(false); };
  FilterBase.prototype.getFilterRulesWithNegation = function (negated) {
    if (this instanceof s09RuleFilter()) return [{ rule: this, negated }];
    if (this instanceof s09ConjunctionFilter()) {
      const inverted = this instanceof s09NotFilter();
      const out = [];
      for (const f of this.filters) out.push(...f.getFilterRulesWithNegation(negated !== inverted));
      return out;
    }
    return [];
  };
  FilterBase.prototype.optimize = function () { return this; };
  FilterBase.and = function () {
    const filters = [...arguments].filter(Boolean);
    return filters.length === 1 ? filters[0] : new (s09AndFilter())(filters).optimize();
  };
  FilterBase.or = function () {
    const filters = [...arguments].filter(Boolean);
    return filters.length === 1 ? filters[0] : new (s09OrFilter())(filters).optimize();
  };
  FilterBase.not = function () {
    const filters = [...arguments].filter(Boolean);
    return new (s09NotFilter())(filters).optimize();
  };
  return FilterBase;

}
export function s09FilterBase() { return s09Once("s09FilterBase", s09buildFilterBase); }

/** A single rule: a formula text tested against the context. */
function s09buildRuleFilter() {
  const Base = s09FilterBase();
  function RuleFilter(rule) {
    const self = Base.call(this) || this;
    self.rule = rule;
    return self;
  }
  inherit(RuleFilter, Base);
  RuleFilter.prototype.hasError = function () { return this.rule.formula instanceof s09InvalidNode(); };
  RuleFilter.prototype.serialize = function () { return this.rule.toString(); };
  RuleFilter.prototype.test = function (ctx) { return this.rule.test(ctx); };
  return RuleFilter;

}
export function s09RuleFilter() { return s09Once("s09RuleFilter", s09buildRuleFilter); }

/** A conjunction/disjunction/negation of filters. */
function s09buildConjunctionFilter() {
  const Base = s09FilterBase();
  function ConjunctionFilter(conjunction, filters) {
    const self = Base.call(this) || this;
    self.conjunction = conjunction;
    self.filters = filters;
    return self;
  }
  inherit(ConjunctionFilter, Base);
  ConjunctionFilter.prototype.hasError = function () { return this.filters.some((f) => f.hasError()); };
  ConjunctionFilter.prototype.serialize = function () {
    const list = this.filters.map((f) => f.serialize());
    switch (this.conjunction) {
      case "and": return { and: list };
      case "or": return { or: list };
      case "not": return { not: list };
    }
  };
  return ConjunctionFilter;

}
export function s09ConjunctionFilter() { return s09Once("s09ConjunctionFilter", s09buildConjunctionFilter); }

function s09buildAndFilter() {
  const Base = s09ConjunctionFilter();
  function AndFilter(filters) { return Base.call(this, "and", filters) || this; }
  inherit(AndFilter, Base);
  AndFilter.prototype.optimize = function () {
    const flat = [];
    for (const f of this.filters) {
      const opt = f.optimize();
      if (opt) (opt instanceof AndFilter ? flat.push(...opt.filters) : flat.push(opt));
    }
    return flat.length === 0 ? null : flat.length === 1 ? flat[0] : new AndFilter(flat);
  };
  AndFilter.prototype.test = function (ctx) {
    for (const f of this.filters) if (!f.test(ctx)) return false;
    return true;
  };
  return AndFilter;

}
export function s09AndFilter() { return s09Once("s09AndFilter", s09buildAndFilter); }

function s09buildOrFilter() {
  const Base = s09ConjunctionFilter();
  function OrFilter(filters) { return Base.call(this, "or", filters) || this; }
  inherit(OrFilter, Base);
  OrFilter.prototype.optimize = function () {
    const flat = [];
    for (const f of this.filters) {
      const opt = f.optimize();
      if (opt) (opt instanceof OrFilter ? flat.push(...opt.filters) : flat.push(opt));
    }
    return flat.length === 0 ? null : flat.length === 1 ? flat[0] : new OrFilter(flat);
  };
  OrFilter.prototype.test = function (ctx) {
    for (const f of this.filters) if (f.test(ctx)) return true;
    return false;
  };
  return OrFilter;

}
export function s09OrFilter() { return s09Once("s09OrFilter", s09buildOrFilter); }

function s09buildNotFilter() {
  const Base = s09ConjunctionFilter();
  function NotFilter(filters) { return Base.call(this, "not", filters) || this; }
  inherit(NotFilter, Base);
  NotFilter.prototype.optimize = function () {
    const kept = [];
    for (const f of this.filters) {
      const opt = f.optimize();
      if (opt) kept.push(opt);
    }
    if (kept.length === 0) return null;
    if (kept.length === 1) {
      const only = kept[0];
      if (only instanceof NotFilter) return new (s09AndFilter())(only.filters).optimize();
    }
    return new NotFilter(kept);
  };
  NotFilter.prototype.test = function (ctx) {
    for (const f of this.filters) if (f.test(ctx)) return false;
    return true;
  };
  return NotFilter;

}
export function s09NotFilter() { return s09Once("s09NotFilter", s09buildNotFilter); }

// ---------------------------------------------------------------- deserialisers

/** `var MY` — filter from string (formula) or `{and|or|not: [...]}` object. */
export function s09DeserializeFilter(input) {
  if (typeof input === "string") return new (s09RuleFilter())(new s09FormulaText(input));
  if (typeof input !== "object") throw new Error(s09BasesStrings().msgErrorFilterType());
  const keys = Object.keys(input);
  if (keys.length !== 1) throw new Error(s09BasesStrings().msgErrorFilterAllowedKeys());
  switch (keys[0]) {
    case "and": {
      const list = input.and;
      if (!Array.isArray(list)) throw new Error(s09BasesStrings().msgErrorFilterMustBeArray({ conjunction: "and" }));
      return new (s09AndFilter())(list.map(s09DeserializeFilter));
    }
    case "or": {
      const list = input.or;
      if (!Array.isArray(list)) throw new Error(s09BasesStrings().msgErrorFilterMustBeArray({ conjunction: "or" }));
      return new (s09OrFilter())(list.map(s09DeserializeFilter));
    }
    case "not": {
      const list = input.not;
      if (!Array.isArray(list)) throw new Error(s09BasesStrings().msgErrorFilterMustBeArray({ conjunction: "not" }));
      return new (s09NotFilter())(list.map(s09DeserializeFilter));
    }
    default: throw new Error(s09BasesStrings().msgErrorFilterAllowedKeys());
  }
}

/** `var TY` — one view entry of the `views:` list into a View instance. */
export function s09DeserializeView(query, data, index) {
  const c = s09BasesStrings();
  if (typeof data !== "object") throw new Error(c.msgErrorViewInvalidFormat({ index }));
  const name = data.name;
  if (!name || typeof name !== "string") throw new Error(c.msgErrorViewNameInvalid({ index }));
  const type = data.type;
  if (!type) throw new Error(c.msgErrorViewMissingRequiredKey({ key: "type", viewName: name }));
  if (typeof type !== "string") throw new Error(c.msgErrorViewIncorrectType({ key: "type", type: "string", viewName: name }));
  const view = new (s09View())(query, type, name);
  for (const key of Object.keys(data)) {
    switch (key) {
      case "type":
      case "name":
        break;
      case "filters":
        try { view.filters = s09DeserializeFilter(data.filters); }
        catch (e) { throw new Error(c.msgErrorViewParsingFilters({ message: e.message, viewName: name })); }
        break;
      case "groupBy": {
        const g = data.groupBy;
        if (typeof g !== "object" || !Object.hasOwn(g, "property") || !Object.hasOwn(g, "direction")) {
          throw new Error(c.msgErrorViewIncorrectType({ key: "groupBy", type: "object", viewName: name }));
        }
        const property = g.property, direction = g.direction;
        if (property && typeof property === "string" && (direction === "ASC" || direction === "DESC")) {
          view.groupBy = { property: longPropertyId(property), direction };
        }
        break;
      }
      case "summaries":
        if (typeof data.summaries !== "object") throw new Error(c.msgErrorViewIncorrectType({ key: "summaries", type: "object", viewName: name }));
        view.summaries = {};
        for (const sumKey of Object.keys(data.summaries)) {
          const formula = data.summaries[sumKey];
          if (typeof formula !== "string") throw new Error(c.msgErrorViewIncorrectValueType({ key: "summaries", type: "string", viewName: name }));
          view.summaries[longPropertyId(sumKey)] = formula;
        }
        break;
      case "order":
        if (!Array.isArray(data.order)) throw new Error(c.msgErrorViewIncorrectType({ key: "order", type: "array", viewName: name }));
        view.order = data.order.map(longPropertyId);
        break;
      case "sort":
        if (Array.isArray(data.sort)) {
          view.sort = [];
          for (const entry of data.sort) {
            if (entry.column) entry.property = entry.column;
            const property = entry.property, direction = entry.direction;
            if (property && typeof property === "string" && (direction === "ASC" || direction === "DESC")) {
              view.sort.push({ property: longPropertyId(property), direction });
            }
          }
        }
        break;
      case "limit":
        if (Number.isNumber(data.limit) && data.limit > 0) view.limit = data.limit;
        break;
      default:
        view.data || (view.data = {});
        view.data[key] = data[key];
    }
  }
  return view;
}

// ---------------------------------------------------------------- views & query

/** One configured view (table, cards, ...): filters, grouping, ordering and view-specific data. */
function s09buildView() {
  function View(query, type, name) {
    this.query = query;
    this.type = type;
    this.name = name;
  }
  View.prototype.clone = function (newName) {
    const data = this.serialize();
    data.name = newName;
    return s09DeserializeView(this.query, data, this.query.views.length);
  };
  View.prototype.serialize = function () {
    const out = { type: this.type, name: this.name };
    if (this.filters) out.filters = this.filters.serialize();
    if (this.groupBy) out.groupBy = { property: shortPropertyId(this.groupBy.property), direction: this.groupBy.direction };
    if (this.order) out.order = this.order.map(shortPropertyId);
    if (this.sort) out.sort = this.sort.map((s) => ({ property: shortPropertyId(s.property), direction: s.direction }));
    if (this.limit) out.limit = this.limit;
    if (this.summaries) {
      const sums = {};
      for (const key of Object.keys(this.summaries)) sums[shortPropertyId(key)] = this.summaries[key];
      out.summaries = sums;
    }
    if (this.data) {
      for (const key of Object.keys(this.data)) {
        if (!Object.prototype.hasOwnProperty.call(this, key)) out[key] = this.data[key];
      }
    }
    return out;
  };
  View.prototype.getViewName = function () { return this.name; };
  View.prototype.getAll = function () { return this.data || {}; };
  View.prototype.get = function (key) { return this.data == null ? undefined : this.data[key]; };
  View.prototype.getAsPropertyId = function (key) {
    const value = this.data == null ? undefined : this.data[key];
    return value && typeof value === "string" ? longPropertyId(value) : null;
  };
  View.prototype.getEvaluatedFormula = function (owner, formulaText) {
    const raw = this.data == null ? undefined : this.data[formulaText];
    if (!raw || typeof raw !== "string") return env().bW.value;
    const formula = new s09FormulaText(raw);
    if (formula.formula instanceof s09InvalidNode()) return env().bW.value;
    const file = owner.queryController.getCurrentFile();
    const ctx = new (s09FileContext())(owner.queryController.ctx, file);
    try { return formula.formula.getValue(ctx); } catch (e) { return env().bW.value; }
  };
  View.prototype.set = function (key, value) {
    this.data || (this.data = {});
    if (value === null) delete this.data[key]; else this.data[key] = value;
    this.query.save();
  };
  View.prototype.getOrder = function () { return this.order || s09DefaultOrder.slice(); };
  View.prototype.setOrder = function (order) { this.order = order; this.query.save(); };
  View.prototype.getSummaryKey = function (property) {
    return this.summaries && Object.hasOwn(this.summaries, property) ? this.summaries[property] : null;
  };
  View.prototype.setSummaryKey = function (property, formula) {
    if (formula === null) {
      if (!this.summaries || !Object.hasOwn(this.summaries, property)) return;
      delete this.summaries[property];
    } else {
      this.summaries || (this.summaries = {});
      this.summaries[property] = formula;
    }
    this.query.save();
  };
  View.prototype.getSort = function () { return this.sort || []; };
  View.prototype.setSortProperty = function (property, mode) {
    const sort = this.getSort();
    const idx = sort.findIndex((s) => s.property === property);
    if (idx >= 0) {
      if (mode === "TOGGLE") mode = sort[idx].direction === "ASC" ? "DESC" : "NONE";
      sort.splice(idx, 1);
    }
    if (mode === "TOGGLE") mode = "ASC";
    if (mode === "ASC" || mode === "DESC") sort.unshift({ property, direction: mode });
    this.sort = sort;
    this.query.save();
  };
  View.prototype.setLimit = function (limit) { this.limit = limit; this.query.save(); };
  View.prototype.getLimit = function () { return this.limit || 0; };
  View.prototype.setGroupBy = function (groupBy) {
    const current = this.groupBy;
    if (!groupBy && current) {
      this.groupBy = null;
      this.query.save();
      return;
    }
    if (!groupBy || !current) {
      if (groupBy) { this.groupBy = groupBy; this.query.save(); }
      return;
    }
    if (current.property === groupBy.property && current.direction === groupBy.direction) return;
    this.groupBy = groupBy;
    this.query.save();
  };
  View.prototype.getDisplayName = function (property) { return this.getPropertyConfig(property).getDisplayName(); };
  View.prototype.getPropertyConfig = function (property) { return this.query.getPropertyConfig(property); };
  return View;

}
export function s09View() { return s09Once("s09View", s09buildView); }

/** The persisted query: views, global filters, formulas, summaries and per-property configs. */
function s09buildQuery() {
  function Query() {
    this.views = [];
    this.unrecognizedData = {};
    this.properties = {};
  }
  const c = () => s09BasesStrings();
  Query.fromString = function (text) {
    if (text.trim() === "") {
      const q = new Query();
      q.views.push(new (s09View())(q, "table", c().labelViewTypeTable()));
      return q;
    }
    return Query.parse(env().mA(text));
  };
  Query.parse = function (data) {
    if (typeof data !== "object") throw new Error(c().msgErrorInvalidQueryFormat());
    const views = data.views, filters = data.filters, display = data.display,
      properties = data.properties, formulas = data.formulas, summaries = data.summaries,
      newItemFolder = data.newItemFolder, newItemTemplate = data.newItemTemplate;
    let viewList = views;
    if (viewList === undefined) viewList = [];
    else if (!Array.isArray(viewList)) throw new Error(c().msgErrorViewType());
    const query = new Query();
    query.views = [];
    for (let i = 0; i < viewList.length; i++) query.views.push(s09DeserializeView(query, viewList[i], i + 1));
    if (query.views.length === 0) query.views.push(new (s09View())(query, "table", c().labelViewTypeTable()));
    if (filters) query.filters = s09DeserializeFilter(filters);
    if (properties) {
      if (typeof properties !== "object") throw new Error(c().msgErrorInvalidPropertiesSection());
      for (const key of Object.keys(properties)) {
        const prop = properties[key];
        if (prop != null) {
          if (typeof prop !== "object") throw new Error(c().msgErrorInvalidPropertiesSection());
          query.properties[key] = s09PropertyConfig().deserialize(query, longPropertyId(key), prop);
        }
      }
    }
    if (display) {
      if (typeof display !== "object") throw new Error(c().msgErrorMustBeAType({ key: "display", type: "object" }));
      for (const key of Object.keys(display)) {
        const value = display[key];
        if (typeof value !== "string") throw new Error(c().msgErrorDisplayValues({ key }));
        query.getPropertyConfig(longPropertyId(key)).migrateDisplayName(value);
      }
    }
    query.formulas = {};
    if (formulas) {
      if (typeof formulas !== "object") throw new Error(c().msgErrorMustBeAType({ key: "formulas", type: "object" }));
      for (const key of Object.keys(formulas)) {
        const formula = formulas[key];
        if (typeof formula !== "string") throw new Error(c().msgErrorFormulaValues({ key }));
        query.formulas[key] = new s09FormulaText(formula);
      }
    }
    if (summaries) {
      if (typeof summaries !== "object") throw new Error(c().msgErrorMustBeAType({ key: "summaries", type: "object" }));
      query.summaryFormulas = {};
      for (const key of Object.keys(summaries)) {
        const formula = summaries[key];
        if (typeof formula !== "string") throw new Error(c().msgErrorFormulaValues({ key }));
        query.summaryFormulas[key] = new s09FormulaText(formula);
      }
    }
    if (newItemFolder) {
      if (typeof newItemFolder !== "string") throw new Error(c().msgErrorMustBeAType({ key: "newItemFolder", type: "string" }));
      query.newItemFolder = newItemFolder;
    }
    if (newItemTemplate) {
      if (typeof newItemTemplate !== "string") throw new Error(c().msgErrorMustBeAType({ key: "newItemTemplate", type: "string" }));
      query.newItemTemplate = newItemTemplate;
    }
    for (const key of Object.keys(data)) {
      switch (key) {
        case "views": case "filters": case "display": case "properties":
        case "formulas": case "newItemFolder": case "newItemTemplate":
          continue;
        default:
          query.unrecognizedData[key] = data[key];
      }
    }
    return query;
  };
  Query.prototype.getSerializable = function () {
    const out = Object.assign({}, this.unrecognizedData);
    if (this.filters) out.filters = this.filters.serialize();
    if (this.formulas) {
      const keys = Object.keys(this.formulas);
      if (keys.length > 0) {
        out.formulas = {};
        for (const key of keys) out.formulas[key] = this.formulas[key].toString();
      }
    }
    if (this.summaryFormulas) {
      out.summaries = {};
      for (const key of Object.keys(this.summaryFormulas)) out.summaries[key] = this.summaryFormulas[key].toString();
    }
    const props = {};
    let anyProps = false;
    for (const key of Object.keys(this.properties)) {
      const serialized = this.properties[key].serialize();
      if (serialized !== null) { anyProps = true; props[key] = serialized; }
    }
    if (anyProps) out.properties = props;
    if (this.views) out.views = this.views.map((v) => v.serialize());
    if (this.newItemFolder) out.newItemFolder = this.newItemFolder;
    if (this.newItemTemplate) out.newItemTemplate = this.newItemTemplate;
    return out;
  };
  Query.prototype.toString = function () {
    const data = this.getSerializable();
    return Object.keys(data).length > 0 ? env().vA(data) : "";
  };
  Query.prototype.clone = function () { return Query.parse(this.getSerializable()); };
  Query.prototype.save = function () { if (this.saveFn) this.saveFn(this); };
  Query.prototype.setGlobalFilters = function (filters) {
    if (filters) this.filters = s09DeserializeFilter(filters); else delete this.filters;
    this.save();
  };
  Query.prototype.setViewFilters = function (viewName, filters) {
    const view = this.getViewConfig(viewName);
    if (!view) throw new Error("Invalid view specified");
    if (filters) view.filters = s09DeserializeFilter(filters); else delete view.filters;
    this.save();
  };
  Query.prototype.setFormulas = function (formulas) { this.formulas = formulas; this.save(); };
  Query.prototype.setSummaryFormula = function (name, formula) {
    if (!this.summaryFormulas && formula) this.summaryFormulas = {};
    if (formula) this.summaryFormulas[name] = formula; else delete this.summaryFormulas[name];
    this.save();
  };
  Query.prototype.deleteSummaryFormula = function (name) {
    if (this.summaryFormulas) delete this.summaryFormulas[name];
    for (const view of this.views) {
      if (view.summaries) {
        for (const key of Object.keys(view.summaries)) {
          if (view.summaries[key] === name) delete view.summaries[key];
        }
      }
    }
    this.save();
  };
  Query.prototype.renameSummaryFormula = function (from, to) {
    if (this.summaryFormulas && Object.hasOwn(this.summaryFormulas, from)) {
      this.summaryFormulas[to] = this.summaryFormulas[from];
      delete this.summaryFormulas[from];
    }
    for (const view of this.views) {
      if (view.summaries) {
        for (const key of Object.keys(view.summaries)) {
          if (view.summaries[key] === from) view.summaries[key] = to;
        }
      }
    }
    this.save();
  };
  Query.prototype.getSummaryFormula = function (type, name) {
    if (this.summaryFormulas && Object.hasOwn(this.summaryFormulas, name)) return this.summaryFormulas[name];
    const found = s09SummaryFormulasFor(type)[name] || null;
    return found ? new s09FormulaText(found) : null;
  };
  Query.prototype.getPropertyConfig = function (property) {
    const props = this.properties;
    return Object.hasOwn(props, property) ? props[property] : (props[property] = new (s09PropertyConfig())(this, property));
  };
  Query.prototype.removeFormula = function (name) {
    let view;
    if (this.formulas && this.formulas.hasOwnProperty(name)) {
      const id = propertyId("formula", name);
      delete this.formulas[name];
      delete this.properties[id];
      for (const v of this.views) {
        v.order == null ? undefined : v.order.remove(id);
        if (v.sort) v.sort = v.sort.filter((s) => s.property !== id);
        if (v.summaries) delete v.summaries[id];
        if (v.groupBy != null && v.groupBy.property === id) delete v.groupBy;
      }
      this.save();
    }
  };
  Query.prototype.getViewConfig = function (name) {
    if (!name) return this.views[0];
    for (const view of this.views) if (view.name === name) return view;
    return null;
  };
  return Query;

}
export function s09Query() { return s09Once("s09Query", s09buildQuery); }

/** Per-property presentation config stored under `properties:` in the query file. */
function s09buildPropertyConfig() {
  function PropertyConfig(query, propertyIdValue) {
    this.unrecognizedData = {};
    this.query = query;
    this.propertyId = propertyIdValue;
  }
  PropertyConfig.deserialize = function (query, propId, data) {
    const config = new PropertyConfig(query, propId);
    for (const key of Object.keys(data)) {
      const value = data[key];
      if (key === "displayName") {
        if (typeof value === "string") config.displayName = value;
      } else {
        config.unrecognizedData[key] = value;
      }
    }
    return config;
  };
  PropertyConfig.prototype.serialize = function () {
    const out = Object.assign({}, this.unrecognizedData);
    if (this.displayName) out.displayName = this.displayName;
    return Object.keys(out).length > 0 ? out : null;
  };
  PropertyConfig.prototype.getDisplayName = function () {
    if (this.displayName) return this.displayName;
    const labels = s09FilePropLabels();
    return Object.hasOwn(labels, this.propertyId) ? labels[this.propertyId]() : parsePropertyId(this.propertyId).name;
  };
  PropertyConfig.prototype.setDisplayName = function (name) { this.displayName = name; this.query.save(); };
  PropertyConfig.prototype.migrateDisplayName = function (name) { if (!this.displayName) this.displayName = name; };
  return PropertyConfig;

}
export function s09PropertyConfig() { return s09Once("s09PropertyConfig", s09buildPropertyConfig); }

// ---------------------------------------------------------------- contexts

/** `var iY` — wraps another context and lazily captures the "local" (this-file) view of a row. */
function s09buildFilterContext() {
  function FilterContext(app, filter, formulas, file) {
    this._local = null;
    this.app = app;
    this.filter = filter;
    this.formulas = formulas;
    if (file) this._local = new (s09FileContext())(this, file);
  }
  Object.defineProperty(FilterContext.prototype, "local", {
    get() { this.localUsed = true; return this._local; },
    enumerable: false,
    configurable: true,
  });
  FilterContext.prototype.regenerateLocal = function () {
    const file = this._local == null ? undefined : this._local.file;
    return new FilterContext(this.app, this.filter, this.formulas, file);
  };
  return FilterContext;

}
export function s09FilterContext() { return s09Once("s09FilterContext", s09buildFilterContext); }

/** `var oY` — context for one file: frontmatter, `note`, `file`, `formula` and `this`. */
function s09buildFileContext() {
  function FileContext(ctx, file) {
    const app = ctx.app;
    this.ctx = ctx;
    this.file = file;
    this.app = app;
    const cache = app.metadataCache.getFileCache(file);
    this.frontmatter = (cache == null ? undefined : cache.frontmatter) != null ? cache.frontmatter : {};
    this.note = env().AW.fromFrontMatter(app, file, this.frontmatter);
    this.implicit = new (env().NW)(app, file);
    this.formulaResults = new (s09FormulaResults())(this, ctx.formulas);
    this.formula = new (s09FormulasValue())(this.formulaResults);
  }
  FileContext.prototype.getValue = function (name) {
    const parsed = parsePropertyId(name);
    switch (parsed.type) {
      case "note": return this.note.objectAccess(parsed.name);
      case "file": return this.implicit.objectAccess(parsed.name);
      case "formula": return this.formulaResults.getFormulaValue(parsed.name);
    }
    return null;
  };
  FileContext.prototype.keys = function () {
    const keys = new Set(Object.keys(this.frontmatter));
    keys.add("this"); keys.add("note"); keys.add("file"); keys.add("formula");
    return Array.from(keys);
  };
  FileContext.prototype.getByIdentifier = function (id) {
    switch (id.toLowerCase()) {
      case "this": {
        const local = this.ctx.local;
        return local ? new (s09ThisFileValue())(this.app, local.file, this) : env().bW.value;
      }
      case "note": return this.note;
      case "file": return this.implicit;
      case "formula": return this.formula;
    }
    return this.note.getInsensitive(id);
  };
  FileContext.prototype.getPropertyKeys = function () { return Object.keys(this.frontmatter); };
  FileContext.prototype.getRawProperty = function (name) {
    const key = keyIgnoringCase(this.frontmatter, name);
    return Object.hasOwn(this.frontmatter, key) ? this.frontmatter[key] : null;
  };
  FileContext.FILE_PROPERTIES = ["file.file", "file.name", "file.basename", "file.fullname", "file.path", "file.folder", "file.ext", "file.ctime", "file.mtime", "file.size", "file.links", "file.backlinks", "file.embeds", "file.tags"];
  return FileContext;

}
export function s09FileContext() { return s09Once("s09FileContext", s09buildFileContext); }

/** `var aY` — lazily evaluated, cycle-guarded formula results of one file context. */
function s09buildFormulaResults() {
  function FormulaResults(ctx, formulas) {
    this.ctx = ctx;
    this.formulas = formulas;
    this.cachedFormulaOutputs = {};
  }
  FormulaResults.prototype.getFormulaValue = function (name) {
    const key = keyIgnoringCase(this.formulas, name);
    const cache = this.cachedFormulaOutputs;
    if (Object.hasOwn(cache, key)) {
      const hit = cache[key];
      if (hit === s09FormulaLoopSentinel) throw new Error(s09BasesStrings().msgErrorInfiniteLoop());
      return hit;
    }
    if (Object.hasOwn(this.formulas, key)) {
      cache[key] = s09FormulaLoopSentinel;
      const value = this.formulas[key].getValue(this.ctx);
      cache[key] = value;
      return value;
    }
    return null;
  };
  return FormulaResults;

}
export function s09FormulaResults() { return s09Once("s09FormulaResults", s09buildFormulaResults); }

/** `var sY` — the `this` value: the current file seen through the enclosing entry. */
function s09buildThisFileValue() {
  const Base = env().NW;
  function ThisFileValue(app, file, entry) {
    const self = Base.call(this, app, file) || this;
    self.entry = entry;
    return self;
  }
  inherit(ThisFileValue, Base);
  ThisFileValue.prototype.keys = function () { return this.entry.keys(); };
  ThisFileValue.prototype.objectAccess = function (name) { return this.entry.getByIdentifier(name); };
  ThisFileValue.type = "ThisFile";
  return ThisFileValue;

}
export function s09ThisFileValue() { return s09Once("s09ThisFileValue", s09buildThisFileValue); }

/** `var lY` — the `formula` value: an object holding all formula results of a context. */
function s09buildFormulasValue() {
  const Base = env().wW;
  function FormulasValue(results) {
    const self = Base.call(this) || this;
    self.icon = "lucide-square-function";
    self.formulaResults = results;
    return self;
  }
  inherit(FormulasValue, Base);
  FormulasValue.prototype.toString = function () {
    return "Formulas" + JSON.stringify(Object.keys(this.formulaResults.formulas));
  };
  FormulasValue.prototype.isTruthy = function () { return true; };
  FormulasValue.prototype.keys = function () { return Object.keys(this.formulaResults.formulas); };
  FormulasValue.prototype.objectAccess = function (name) {
    const value = this.formulaResults.getFormulaValue(name);
    if (value instanceof env().yW) throw value;
    return value;
  };
  FormulasValue.type = "Formulas";
  return FormulasValue;

}
export function s09FormulasValue() { return s09Once("s09FormulasValue", s09buildFormulasValue); }

/** `var DY` — top-level evaluation context (no specific file): all note properties + this/note/file/formula. */
function s09buildEvalContext() {
  function EvalContext(app, formulas) {
    this.cachedProps = null;
    this.app = app;
    this.formulaResults = new (s09FormulaResults())(this, formulas);
  }
  EvalContext.prototype.cacheProps = function () {
    if (this.cachedProps) return this.cachedProps;
    const manager = this.app.metadataTypeManager;
    const props = {};
    this.cachedProps = props;
    for (const name of Object.keys(manager.getAllProperties())) {
      const info = manager.getPropertyInfo(name);
      props[info.name] = s09DefaultValueForWidget(info.widget);
    }
    return this.cachedProps;
  };
  EvalContext.prototype.keys = function () {
    const keys = new Set(Object.keys(this.cacheProps()));
    keys.add("this"); keys.add("note"); keys.add("file"); keys.add("formula");
    return Array.from(keys);
  };
  EvalContext.prototype.getByIdentifier = function (id) {
    switch (id.toLowerCase()) {
      case "this": return new (s09ThisFileValue())(this.app, this.app.workspace.getActiveFile(), this);
      case "note": return new (env().AW)(this.cacheProps());
      case "file": return new (env().NW)(this.app, this.app.workspace.getActiveFile());
      case "formula": return new (s09FormulasValue())(this.formulaResults);
    }
    const props = this.cacheProps();
    const key = keyIgnoringCase(props, id);
    return Object.hasOwn(props, key) ? props[key] : env().bW.value;
  };
  EvalContext.prototype.evaluateFormula = function (formula) {
    if (!(formula instanceof s09InvalidNode())) {
      try { return formula.getValue(this); } catch (e) {}
    }
    return env().bW.value;
  };
  EvalContext.prototype.evaluateIdent = function (text) { return this.evaluateFormula(s09FormulaNode().parse(text)); };
  return EvalContext;

}
export function s09EvalContext() { return s09Once("s09EvalContext", s09buildEvalContext); }

// ---------------------------------------------------------------- helpers

/** `var AY` — the empty value a property widget starts with. */
export function s09DefaultValueForWidget(widget) {
  switch (widget) {
    case "file": case "folder": case "text": return new (env().CW)("");
    case "number": return new (env().EW)(0);
    case "checkbox": return new (env().MW)(true);
    case "date": return new (env().LW)(new Date(), false);
    case "datetime": return new (env().LW)(new Date(), true);
    case "tags": return new (env().DW)([""]);
    case "aliases": case "multitext": return new (env().SW)([""]);
  }
  return env().bW.value;
}

/** `var OY` — coarse type name of a value for display. */
export function s09ValueTypeName(value) {
  const { CW, EW, SW, MW, LW, bW } = env();
  const is = (cls) => value === cls || cls.isPrototypeOf(value);
  return is(CW) || is(bW) ? "text" : is(EW) ? "number" : is(SW) ? "multitext" : is(MW) ? "checkbox" : is(LW) ? "date" : "unknown";
}

/** `var LY` — property id -> the identifier/formula reference used to reach it. */
export function s09PropertyToRef(id) {
  if (id === "") return "";
  const parsed = parsePropertyId(id);
  const name = parsed.name, type = parsed.type;
  if (type === "file" && name === "file") return "file";
  if (s09IsIdentifierName(name)) return type + "[" + JSON.stringify(name) + "]";
  return type === "note" ? name : type + "." + name;
}

/** `var kY` — whether a property may be used in a query (excludes file.* builtins and aliases). */
export function s09IsCustomProperty(property, query) {
  if (s09FileProperties.includes(property)) return false;
  const parsed = parsePropertyId(property);
  if (parsed.type === "note" && "aliases" === query.app.metadataTypeManager.getTypeInfo(parsed.name).expected.type) return false;
  return true;
}

// ---------------------------------------------------------------- formula -> frontmatter

/** `var NY` — which note/file/formula property a formula node reads (for filter->frontmatter mapping). */
export function s09FormulaPropertyRef(node) {
  const { GK, QK, WK, UK, jK } = s09NodesRef();
  if (node instanceof WK) {
    if (node.object instanceof QK) {
      const id = node.object.id;
      if (id === "note" || id === "file" || id === "formula") {
        return { type: id, name: node.index, isThis: false };
      }
      return { type: "note", name: id + "." + node.index, isThis: false };
    }
  } else if (node instanceof UK) {
    if (node.array instanceof QK) {
      const id = node.array.id, index = node.index;
      if ((id === "note" || id === "file" || id === "formula") && index instanceof GK) {
        return { type: id, name: index.value.toString(), isThis: false };
      }
    }
  } else {
    if (node instanceof QK) {
      if (["true", "false", "null"].includes(node.id)) throw new Error("Unsupported left-hand side of formula");
      if (node.id === "file") return { type: "file", name: "file", isThis: false };
      return { type: "note", name: node.id, isThis: false };
    }
    if (node instanceof jK && node.name === "list" && node.args.length === 1) return s09FormulaPropertyRef(node.args[0]);
  }
  throw new Error("Formula cannot be deserialized");
}

function s09NodesRef() {
  return {
    GK: s09PrimitiveNode(), QK: s09IdentNode(), WK: s09ObjectAccessNode(),
    UK: s09ArrayAccessNode(), jK: s09CallNode(),
  };
}

/** `var RY` — evaluates summary formulas of a view against a row context into display values. */
export function s09EvalSummaryFormulas(app, ctx, formulas, file) {
  if (formulas.length === 0) throw new Error("Formula cannot be deserialized");
  const out = [];
  for (const formula of formulas) {
    let value;
    if (file) { try { value = formula.getValue(file); } catch (e) {} }
    if (!value) value = ctx.evaluateFormula(formula);
    out.push(s09ValueToDisplay(app, value, file));
  }
  return out.length > 1 ? out : out[0];
}

/** `var BY` — a formula value -> the text written into frontmatter / shown in cells. */
export function s09ValueToDisplay(app, value, fileCtx) {
  const { NW, BW, kW, bW, SW, AW } = env();
  if (value instanceof NW) {
    const from = fileCtx ? fileCtx.file.path : "";
    const link = app.metadataCache.fileToLinktext(value.file, from);
    return "[[" + link + "]]";
  }
  if (value instanceof BW) {
    const from = fileCtx ? fileCtx.file.path : "";
    const dest = app.metadataCache.getFirstLinkpathDest(value.data, from);
    const link = app.metadataCache.fileToLinktext(dest, from);
    const display = value.display ? "|" + value.display : "";
    return "[[" + link + "]]" + display;
  }
  if (value instanceof kW) return value.data;
  if (value instanceof bW) return null;
  if (value instanceof SW) {
    const out = [];
    for (let i = 0; i < value.length(); i++) out.push(s09ValueToDisplay(app, value.get(i), fileCtx));
    return out;
  }
  if (value instanceof AW) {
    const out = {};
    for (const key of value.keys()) out[key] = s09ValueToDisplay(app, value.get(key), fileCtx);
    return out;
  }
  return value.toString();
}

/** `var FY` — extracts the frontmatter/folder implied by a view's filters (used when creating files). */
export function s09FiltersToFrontmatter(app, query, view, fileCtx) {
  const ctx = new (s09EvalContext())(app, query.formulas);
  let folder = "";
  const frontmatter = {};
  let filters = query.filters;
  if (view && view.filters) filters = new (s09AndFilter())([filters, view.filters].filter(Boolean)).optimize();
  const rules = (filters == null ? undefined : filters.getFilterRules()) || [];
  for (const { rule, negated } of rules) {
    if (negated) continue;
    const formula = rule.rule.formula;
    if (formula instanceof s09NotNode()) {
      const inner = formula.expr;
      if (inner instanceof s09CallNode() && inner.name === "isEmpty") {
        const ref = s09FormulaPropertyRef(inner.subject);
        const name = ref.name;
        if (ref.type === "note" && !Object.hasOwn(frontmatter, name)) frontmatter[name] = "";
      }
    } else if (formula instanceof s09CompareNode()) {
      try {
        if (![">=", "<=", "=="].includes(formula.operator)) continue;
        const ref = s09FormulaPropertyRef(formula.left);
        const name = ref.name, type = ref.type;
        const value = s09EvalSummaryFormulas(app, ctx, [formula.right], fileCtx);
        if (type === "note") frontmatter[name] = value;
        else if (type === "file" && name === "folder" && formula.operator === "==" && typeof value === "string") folder = value;
      } catch (e) {}
    } else if (formula instanceof s09CallNode()) {
      try {
        const ref = s09FormulaPropertyRef(formula.subject);
        const name = ref.name, type = ref.type;
        const value = s09EvalSummaryFormulas(app, ctx, formula.args, fileCtx);
        if (type === "note") {
          if (["startsWith", "endsWith", "contains", "containsAny", "containsAll"].includes(formula.name)) {
            if (app.metadataTypeManager.getTypeInfo(name).inferred.type === "multitext" && !Array.isArray(value)) value = [value];
            frontmatter[name] = value;
          }
        } else if (type === "file") {
          if (formula.name === "hasTag" && typeof value === "string") {
            const tags = Object.hasOwn(frontmatter, "tags") ? frontmatter.tags : [];
            if (Array.isArray(tags)) { tags.push(value); frontmatter.tags = tags; }
          } else if (formula.name === "inFolder" && typeof value === "string") {
            folder = value;
          } else if (formula.name === "hasProperty" && typeof value === "string") {
            frontmatter[value] = null;
          }
        }
      } catch (e) {}
    }
  }
  const order = (view == null ? undefined : view.getOrder()) || [];
  for (const entry of order) {
    const parsed = parsePropertyId(entry);
    const name = parsed.name;
    if (parsed.type === "note" && !Object.hasOwn(frontmatter, name)) frontmatter[name] = null;
  }
  return { frontmatter, folder };
}

/** `var IY` — CodeMirror extensions for the formula input (wrapping, lint, autocompletion, highlight). */
export function s09FormulaEditorExtensions() {
  const { _o, JO, RU, wG, Jo, k, TG, wF, BG } = env();
  return [_o.lineWrapping, JO(), RU(), wG(), Jo.of(k(k(k([], TG, true), wF, true), BG, true))];
}

/** `var HY` — property-name suggester used by the filter/formula inputs. */
function s09buildPropertySuggest() {
  const Base = env().MI;
  function PropertySuggest(controller, input) {
    const self = Base.call(this, controller.app, input) || this;
    self.queryController = controller;
    return self;
  }
  inherit(PropertySuggest, Base);
  PropertySuggest.prototype.renderSuggestion = function (item, el) {
    el.addClasses(["mod-complex", "mod-toggle"]);
    if (this.value && this.value.value === item.value) env().tv(el.createDiv("suggestion-icon mod-checked"), "lucide-check");
    el.createDiv("suggestion-icon").createSpan("suggestion-flair", (iconEl) => env().tv(iconEl, item.icon));
    const parsed = parsePropertyId(item.value);
    const type = parsed.type, name = parsed.name;
    const content = el.createDiv("suggestion-content");
    const aux = el.createDiv("suggestion-aux");
    content.createDiv({ cls: "suggestion-title", text: item.display });
    if ((type === "file" && name !== "file") || name !== item.display) {
      env().Fy(aux.createSpan("suggestion-flair u-small"), item.value, this);
    }
  };
  PropertySuggest.prototype.filterProperties = function (expr) { this.filterExpr = expr; return this; };
  PropertySuggest.prototype.setValueById = function (id) {
    const found = this.getItems().find((item) => item.value === id);
    if (found) this.setValue(found);
    else if (id) {
      const display = this.queryController.getViewConfig().getDisplayName(id);
      this.setValue({ value: id, icon: "lucide-file-question", display });
    } else this.setValue(null);
    return this;
  };
  PropertySuggest.prototype.getItems = function () {
    const self = this;
    const controller = this.queryController;
    const view = controller.getViewConfig();
    const all = Object.values(this.app.metadataTypeManager.getAllProperties());
    let props = controller.getProperties()
      .filter((p) => parsePropertyId(p).type !== "note")
      .concat(all.map((p) => "note." + p.name));
    if (this.filterExpr) props = props.filter(this.filterExpr);
    return props.map((id) => {
      const parsed = parsePropertyId(id);
      const type = parsed.type, name = parsed.name;
      let icon;
      if (type === "note") icon = this.app.metadataTypeManager.getTypeInfo(name).expected.icon;
      else if (type === "formula") icon = "lucide-square-function";
      else icon = controller.mockContext.evaluateIdent(s09PropertyToRef(id)).icon;
      return { value: id, display: view.getDisplayName(id), icon };
    });
  };
  return PropertySuggest;

}
export function s09PropertySuggest() { return s09Once("s09PropertySuggest", s09buildPropertySuggest); }
