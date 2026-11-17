// Clean-room query model (g07, part L): DeserializeView and the View class.
import { env } from "./env.js";
import { inherit } from "./inherit.js";

const ng07QryClsL = {};
function ng07QryOnceL(key, build) { return (ng07QryClsL[key] ??= build()); }

function ng07QErrL(key) { const b = env().gm && env().gm.plugins && env().gm.plugins.bases; return b && b[key] ? b[key]() : key; }

// ---------------------------------------------------------- DeserializeView

/** `Cy` — YAML view object -> View (validates type/name; throws localized). */
export function s09DeserializeView(query, data, index) {
  const raw = data && typeof data === "object" ? data : {};
  const type = typeof raw.type === "string" ? raw.type : "";
  if (!["table", "cards", "list"].includes(type)) {
    throw new Error(ng07QErrL("unknownViewType"));
  }
  const name = typeof raw.name === "string" && raw.name ? raw.name : ng07QErrL("unnamedView");
  const view = new (s09View(ng07Host))(query, type, name);
  if (raw.filters !== undefined) view.filters = s09DeserializeFilter(raw.filters) || view.filters;
  if (raw.groupBy !== undefined) view.groupBy = s09DeserializeFilter(raw.groupBy);
  if (raw.order) view.setOrder(raw.order);
  if (raw.sort) view.setSortProperty(raw.sort);
  if (raw.limit !== undefined) view.setLimit(raw.limit);
  if (raw.summaries && typeof raw.summaries === "object") {
    for (const [k, v] of Object.entries(raw.summaries)) {
      if (v === "Average" || v === "Min" || v === "Max" || v === "Sum" || v === "Count") {
        view.setSummaryKey(k, v);
      }
    }
  }
  if (raw.data && typeof raw.data === "object") view.data = raw.data;
  return view;
}

// --------------------------------------------------------------- View

function ng07BuildView() {
  function View(query, type, name) {
    this.query = query;
    this.type = type;
    this.name = name;
    this.filters = null;
    this.order = null;
    this.sort = null;
    this.limit = 0;
    this.summaries = new Map();
    this.groupBy = null;
    this.data = {};
  }
  View.prototype.getViewName = function () { return this.name; };
  View.prototype.setViewName = function (name) { this.name = name; if (this.query) this.query.save(); };
  View.prototype.getAll = function () { return this.query ? this.query.getAll() : []; };
  View.prototype.get = function () { return this.query ? this.query.getView(this) : this.getAll(); };
  View.prototype.getAsPropertyId = function () { return "file.name"; };
  View.prototype.getEvaluatedFormula = function () { return null; };

  View.prototype.getOrder = function () {
    if (this.order && this.order.length) return this.order.slice();
    return ["file.name"];
  };
  View.prototype.setOrder = function (order) { this.order = order ? order.slice() : null; if (this.query) this.query.save(); };
  View.prototype.getSort = function () {
    if (this.sort && this.sort.length) return this.sort.map((s) => ({ property: s.property, direction: s.direction }));
    return [{ property: "file.name", direction: "ASC" }];
  };
  View.prototype.setSortProperty = function (sort) {
    this.sort = Array.isArray(sort) ? sort.map((s) => ({ property: s.property, direction: s.direction || "ASC" })) : null;
    if (this.query) this.query.save();
  };
  View.prototype.getLimit = function () { return this.limit || 0; };
  View.prototype.setLimit = function (limit) { this.limit = Math.max(0, limit | 0); if (this.query) this.query.save(); };
  View.prototype.getGroupBy = function () { return this.groupBy; };
  View.prototype.setGroupBy = function (groupBy) { this.groupBy = groupBy || null; if (this.query) this.query.save(); };
  View.prototype.getDisplayName = function () { return this.name; };
  View.prototype.getPropertyConfig = function (id) { return this.query ? this.query.getPropertyConfig(id) : null; };
  View.prototype.getSummaryKey = function (propId) { return this.summaries.get(propId) || null; };
  View.prototype.setSummaryKey = function (propId, key) {
    if (!key) this.summaries.delete(propId); else this.summaries.set(propId, key);
    if (this.query) this.query.save();
  };
  View.prototype.clone = function () {
    const v = new View(this.query, this.type, this.name);
    v.filters = this.filters; v.order = this.order && this.order.slice();
    v.sort = this.sort && this.sort.map((s) => ({ ...s }));
    v.limit = this.limit; v.groupBy = this.groupBy;
    v.summaries = new Map(this.summaries); v.data = { ...this.data };
    return v;
  };
  View.prototype.serialize = function () {
    const out = { type: this.type, name: this.name };
    const f = s09SerializeFilter(this.filters);
    if (f !== undefined) out.filters = f;
    if (this.groupBy) { const g = s09SerializeFilter(this.groupBy); if (g !== undefined) out.groupBy = g; }
    out.order = this.getOrder();
    if (this.summaries.size) {
      out.summaries = {};
      for (const [k, v] of this.summaries) out.summaries[k] = v;
    }
    out.sort = this.getSort();
    out.limit = this.getLimit();
    if (this.data && Object.keys(this.data).length) out.data = this.data;
    return out;
  };
  return View;
}
export function s09View(host) { ng07H(host); return ng07QryOnceL("View", ng07BuildView); }
