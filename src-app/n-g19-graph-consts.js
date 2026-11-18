// g19 clean-room: graph view constants, i18n string accessors and shared
// defaults used by the engine, sections, views and plugin.
import { sliderCurveInverse } from "./misc.js";
import { env } from "./env.js";

export const ng19SearchViewType = "search";
export const ng19GraphViewType = "graph";
export const ng19LocalGraphViewType = "localgraph";
export const ng19BookmarkParentSymbol = Symbol("parent");

/** i18n table for the graph view: `host.t.plugins.graphView`. */
export function ng19GraphStrings(host) {
  return host.t.plugins.graphView;
}

/** i18n table for the bookmarks plugin: `host.t.plugins.bookmarks`. */
export function ng19BookmarkStrings(host) {
  return host.t.plugins.bookmarks;
}

export const ng19GraphDisplayDefaults = {
  showArrow: false,
  textFadeMultiplier: 0,
  nodeSizeMultiplier: 1,
  lineSizeMultiplier: 1,
};

export const ng19GraphForceDefaults = {
  centerStrength: sliderCurveInverse(0.1, 0.01),
  repelStrength: 10,
  linkStrength: sliderCurveInverse(1, 0.01),
  linkDistance: 250,
};

/** Read one graph-view i18n entry; entries are i18next functions. */
function ng19Table(plugin) {
  const host = typeof __basaltHost !== "undefined" ? __basaltHost : null;
  const viaHost = host && host.t && host.t.plugins && host.t.plugins[plugin];
  if (viaHost) return viaHost;
  const gm = env().gm;
  return gm && gm.plugins ? gm.plugins[plugin] : null;
}

/** Read one graph-view i18n entry; entries are i18next functions. */
export function ng19GT(key, ...args) {
  const v = ng19Table("graphView") && ng19Table("graphView")[key];
  if (typeof v === "function") return v(...args);
  return typeof v === "string" ? v : key;
}

/** Read one bookmarks i18n entry. */
export function ng19BT(key, ...args) {
  const table = ng19Table("bookmarks");
  const v = table && table[key];
  if (typeof v === "function") return v(...args);
  return typeof v === "string" ? v : key;
}

/** Read an arbitrary i18n entry from a plugin table, e.g. ng19TT("search","tooltipClearSearch"). */
export function ng19TT(plugin, key, ...args) {
  const table = ng19Table(plugin);
  const v = table && table[key];
  if (typeof v === "function") return v(...args);
  return typeof v === "string" ? v : key;
}

/** Shared registry the section/engine/view/plugin factories publish classes into. */
export const ng19Graph = {};
