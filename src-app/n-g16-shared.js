// g16 clean-room shared helpers: i18n shortcuts, value normalisation, tag/path
// suggestion helpers and the dormant-editor lookups. Every top-level name is ng16-*.
import { stringCollator } from "./misc.js";
import { tagValid } from "./metadata-helpers.js";
import { inferPropertyWidget } from "./metadata-types.js";
import { lastSegment } from "./path.js";
import { s06TagSuggestions } from "./s06-util.js";
import { env } from "./env.js";

export const ng16Reserved = Object.freeze({ aliases: true, cssclasses: true, tags: true });
export const ng16DateRe = /^\d{4}-[01]\d-[0-3]\d$/;
export const ng16DateTimeRe = /^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d(:[0-5]\d)?$/;
export const ng16TagTriggerRe = /(^|\s)#[^ -⁯⸀-⹿'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\\s]*$/g;

export const ng16PropT = (host) => host.t.properties;
export const ng16PluginT = (host) => host.t.plugins.properties;
export const ng16Has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);
export const ng16Lower = (s) => String(s == null ? "" : s).toLowerCase();
export const ng16EmptyValue = (v) => v === "" || (Array.isArray(v) && v.length === 0) ? null : v;
export const ng16List = (v) => v == null ? [] : Array.isArray(v) ? v.filter((x) => typeof x === "string") : typeof v === "string" ? [v] : [];
export const ng16Strs = (v) => ng16List(v).map((x) => String(x));
export const ng16Unique = (a) => [...new Set(a)];
export const ng16Compare = (a, b) => stringCollator.compare(String(a), String(b));
export const ng16Infer = inferPropertyWidget;

/** Shallow/deep-ish equality used to decide whether a row must re-render. */
export function ng16SameValue(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => ng16SameValue(x, b[i]));
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => ng16SameValue(a[k], b[k]));
  }
  return false;
}

/** The registered widget descriptor for `type`, falling back to the unknown one. */
export function ng16Widget(host, type) {
  const map = host.propertyTypeWidgets || {};
  return (type && map[type]) || host.unknownPropertyWidget;
}

export function ng16TagOk(v) { return tagValid(String(v).startsWith("#") ? v : "#" + v); }
export function ng16TagText(v) { const s = String(v); return s.startsWith("#") ? s.slice(1) : s; }

/** Vault tag suggestions for the chips widget: delegates to the shared helper. */
export function ng16TagSuggestions(cache, query, withHash, host) {
  return s06TagSuggestions(cache, query, withHash === undefined ? false : withHash, host);
}

/** File/folder path completion: tries the last path segment first, then the whole text. */
export function ng16PathSuggestion(getter, text) {
  const t = String(text || "");
  const last = lastSegment(t);
  const prefix = last !== t ? t.slice(0, t.length - last.length) : "";
  let items = [];
  try { items = getter(last || t) || []; } catch (e) { items = []; }
  const mapped = items.map((it) => ({ ...it, score: (it.score || 0) - (prefix ? 1 : 0) }));
  if (mapped.length || !prefix) return mapped;
  try { items = getter(t) || []; } catch (e) { items = []; }
  return items.map((it) => ({ ...it, score: (it.score || 0) - 1 }));
}

export function ng16HasMetadataEditor(view) {
  const ctor = env().tO;
  return !!(view && typeof view === "object" && view.metadataEditor && ctor && view.metadataEditor instanceof ctor);
}

export function ng16ActivePropertiesEditor(workspace) {
  const view = workspace && workspace.activeEditor;
  if (ng16HasMetadataEditor(view) && view.canShowProperties && view.canShowProperties()) return view.metadataEditor;
  const leaf = workspace && workspace.activeLeaf;
  const v = leaf && leaf.view;
  return ng16HasMetadataEditor(v) && v.canShowProperties && v.canShowProperties() ? v.metadataEditor : null;
}
