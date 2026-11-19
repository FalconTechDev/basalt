import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { isStringArray, stringCollator } from "./misc.js";
import { tagValid } from "./metadata-helpers.js";
import { parseLinktext, linkPath, withoutMd, displayName, lastSegment } from "./path.js";

export const ng16Reserved = Object.freeze({ aliases: true, cssclasses: true, tags: true });
export const ng16DateRe = /^\d{4}-[01]\d-[0-3]\d$/;
export const ng16DateTimeRe = /^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d$/;
export const ng16TagRe = /^#[^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\s]+$/;
export const ng16PropT = (host) => host.t.properties;
export const ng16PluginT = (host) => host.t.plugins.properties;
export const ng16Has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
export const ng16Lower = (s) => String(s || "").toLowerCase();
export const ng16EmptyValue = (v) => v === "" || (Array.isArray(v) && v.length === 0) ? null : v;
export const ng16List = (v) => v == null ? [] : Array.isArray(v) ? v.filter((x) => typeof x === "string") : typeof v === "string" ? [v] : [];
export const ng16Strings = (v) => ng16List(v).map((x) => String(x));
export const ng16Unique = (a) => [...new Set(a)];
export const ng16WidgetMap = (host) => host.propertyTypeWidgets || {};
export const ng16Widget = (host, type) => (ng16WidgetMap(host)[type] || host.unknownPropertyWidget);
export const ng16TypeName = (host, w) => { const n = w && w.name ? w.name() : String(type || "unknown"); return n; };
export const ng16Compare = (a, b) => stringCollator.compare(a, b);
export function ng16Infer(value) {
  if (value == null) return "text";
  const t = typeof value;
  if (t === "string") return ng16DateTimeRe.test(value) ? "datetime" : ng16DateRe.test(value) ? "date" : "text";
  if (t === "number") return "number";
  if (t === "boolean") return "checkbox";
  return isStringArray(value, true) ? "multitext" : "unknown";
}
export function ng16TagOk(v) { return tagValid(v.startsWith("#") ? v : "#" + v); }
export function ng16TagText(v) { return v.startsWith("#") ? v.slice(1) : v; }
export function ng16TagSuggestions(cache, query, withHash = false) {
  const q = String(query || "").toLowerCase().replace(/^#/, "");
  const tags = Object.keys(cache.getTags ? cache.getTags() : {}).map((t) => withHash ? t : t.replace(/^#/, ""));
  tags.sort((a, b) => stringCollator.compare(a.toLowerCase(), b.toLowerCase()));
  const out = [];
  for (const tag of tags) {
    const low = tag.toLowerCase();
    if (!q || low.includes(q)) out.push({ tag, score: 0, matches: null });
  }
  return out;
}
export function ng16PathSuggestion(getter, text) {
  const last = lastSegment(text || "");
  const prefix = text && last !== text ? text.slice(0, text.length - last.length) : "";
  const items = getter(last || text) || [];
  return items.map((it) => ({ ...it, score: (it.score || 0) - (prefix ? 1 : 0) }));
}
export function ng16HasMetadataEditor(view) {
  return !!(view && typeof view === "object" && Object.prototype.hasOwnProperty.call(view, "metadataEditor") && view.metadataEditor instanceof ng16MetaCtor);
}
let ng16MetaCtor = null;
export function ng16SetMetadataCtor(c) { ng16MetaCtor = c; }
export function ng16ActivePropertiesEditor(workspace) {
  const view = workspace && workspace.activeEditor;
  if (ng16HasMetadataEditor(view) && view.canShowProperties && view.canShowProperties()) return view.metadataEditor;
  const leaf = workspace && workspace.activeLeaf;
  const v = leaf && leaf.view;
  return ng16HasMetadataEditor(v) && v.canShowProperties && v.canShowProperties() ? v.metadataEditor : null;
}





