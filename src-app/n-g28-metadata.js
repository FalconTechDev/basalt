// g28 metadata-types (spec g28 Part G): types.json widget assignments merged
// with built-in defaults, plus the property-widget inference helpers.
import { debounceCall } from "./timing.js";
import { isStringArray } from "./misc.js";
import { inherit } from "./inherit.js";

/** Built-in widget assignments; they always win over types.json entries. */
export const propertyTypeDefaults = Object.freeze({
  aliases: Object.freeze({ name: "aliases", widget: "aliases" }),
  cssclasses: Object.freeze({ name: "cssclasses", widget: "multitext" }),
  tags: Object.freeze({ name: "tags", widget: "tags" }),
});

const NG28_DATE_RE = /^\d{4}-[01]\d-[0-3]\d$/;
const NG28_DATETIME_RE = /^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d$/;

/** Guesses the widget for a property value ("text" default, "unknown" fallback). */
export function inferPropertyWidget(value) {
  if (value == null) return "text";
  if (typeof value === "string") {
    if (NG28_DATETIME_RE.test(value)) return "datetime";
    if (NG28_DATE_RE.test(value)) return "date";
    return "text";
  }
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "checkbox";
  if (Array.isArray(value) && isStringArray(value, true)) return "multitext";
  return "unknown";
}

function ng28Lower(name) {
  return String(name == null ? "" : name).toLowerCase();
}

/** Manifest entry RL -> MetadataTypeManager (app.metadataTypeManager). */
export function defineMetadataTypeManager(host) {
  function MetadataTypeManager(app) {
    host.Events.call(this);
    this.assignedWidgets = {};
    this.lastSave = 0;
    this.properties = {};
    this._loaded = false;
    this.app = app;
    this.registeredTypeWidgets = host.propertyTypeWidgets;
    this.onConfigFileChange = debounceCall(() => this.onTypesFileChanged(), 50);
  }
  inherit(MetadataTypeManager, host.Events);

  MetadataTypeManager.prototype.load = async function () {
    await this.loadData();
    this._loaded = true;
  };

  MetadataTypeManager.prototype.registerListeners = function () {
    this.app.vault.on("raw", (path) => this.onRaw(path));
    this.app.metadataCache.on("finished", () => this.updatePropertyInfoCache());
    this.on("changed", () => this.updatePropertyInfoCache());
  };

  MetadataTypeManager.prototype.onRaw = function (path) {
    if (path === this.app.vault.configDir + "/types.json") this.onConfigFileChange();
  };

  /** Reloads types.json when its mtime moved past lastSave; always records mtime. */
  MetadataTypeManager.prototype.onTypesFileChanged = async function () {
    try {
      const stat = await this.app.vault.adapter.stat(this.app.vault.getConfigFile("types"));
      const mtime = stat ? stat.mtime : 0;
      if (this.lastSave < mtime) await this.loadData();
      this.lastSave = mtime;
    } catch (e) { /* file gone or unreadable: keep lastSave */ }
  };

  MetadataTypeManager.prototype.updatePropertyInfoCache = function () {
    this.properties = this.app.metadataCache.getAllPropertyInfos();
  };

  MetadataTypeManager.prototype.getAllProperties = function () {
    return this.properties;
  };

  MetadataTypeManager.prototype.getAssignedWidget = function (name) {
    const entry = this.assignedWidgets[ng28Lower(name)];
    return entry ? entry.widget : null;
  };

  MetadataTypeManager.prototype.getWidget = function (name) {
    return this.registeredTypeWidgets[ng28Lower(name)] || host.unknownPropertyWidget;
  };

  MetadataTypeManager.prototype.getPropertyInfo = function (name) {
    return this.properties[ng28Lower(name)] || this.properties[name]
      || { name, widget: "text", occurrences: 0 };
  };

  /** types.json: { "types": { "Original Name": "widget", ... } }; first
   * lowercased key wins, then built-in defaults overwrite their keys. */
  MetadataTypeManager.prototype.loadData = async function () {
    const data = await this.app.vault.readConfigJson("types");
    const prev = this.assignedWidgets;
    const next = {};
    const types = data && typeof data === "object" ? data.types : null;
    if (types && typeof types === "object") {
      for (const origName of Object.keys(types)) {
        const key = ng28Lower(origName);
        if (!(key in next)) next[key] = { name: origName, widget: types[origName] };
      }
    }
    for (const key of Object.keys(propertyTypeDefaults)) {
      const d = propertyTypeDefaults[key];
      next[key] = { name: d.name, widget: d.widget };
    }
    const changed = [];
    if (this._loaded) {
      for (const key of Object.keys(next)) {
        const before = prev[key];
        if (!before || before.widget !== next[key].widget) changed.push(key);
      }
    }
    this.assignedWidgets = next;
    for (const key of changed) this.trigger("changed", key);
  };

  MetadataTypeManager.prototype.save = async function () {
    const types = {};
    for (const key of Object.keys(this.assignedWidgets)) {
      const entry = this.assignedWidgets[key];
      types[entry.name] = entry.widget;
    }
    const mtime = Date.now();
    this.lastSave = mtime;
    await this.app.vault.writeConfigJson("types", { types }, { mtime });
  };

  MetadataTypeManager.prototype.setType = async function (name, widget) {
    const key = ng28Lower(name);
    const prev = this.assignedWidgets[key];
    this.assignedWidgets[key] = prev ? { name: prev.name, widget } : { name, widget };
    await this.save();
    this.trigger("changed", key);
  };

  MetadataTypeManager.prototype.unsetType = async function (name) {
    const key = ng28Lower(name);
    delete this.assignedWidgets[key];
    await this.save();
    this.trigger("changed", key);
  };

  /** Which widget should edit this property (see spec G.3 precedence). */
  MetadataTypeManager.prototype.getTypeInfo = function (name, value) {
    const assigned = this.assignedWidgets[ng28Lower(name)];
    const assignedWidget = assigned ? this.getWidget(assigned.widget) : null;
    const assignedValid = assignedWidget
      && (value == null || (typeof assignedWidget.validate === "function" ? assignedWidget.validate(value) : true));
    if (assignedValid) return { expected: assignedWidget, inferred: assignedWidget };
    if (value == null) {
      const infoWidget = this.getWidget(this.getPropertyInfo(name).widget);
      if (infoWidget !== host.unknownPropertyWidget) {
        return { expected: assignedWidget || infoWidget, inferred: infoWidget };
      }
    }
    const inferred = this.getWidget(inferPropertyWidget(value));
    return { expected: assignedWidget || inferred, inferred };
  };

  return MetadataTypeManager;
}
