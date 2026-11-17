// Clean-room query model (g07, part Q): constants, display conversion,
// summary evaluation, frontmatter extraction and widget defaults.
import { env } from "./env.js";

/** `rY` — unique sentinel for formula-evaluation loop detection. */
export const s09FormulaLoopSentinel = Symbol("ng07FormulaLoop");

/** `yY` — default sort order. */
export const s09DefaultSort = [{ property: "file.name", direction: "ASC" }];

/** `bY` — default column order. */
export const s09DefaultOrder = ["file.name"];

/** `wY` — built-in file property ids. */
export const s09FileProperties = [
  "file.file", "file.name", "file.basename", "file.fullname", "file.path",
  "file.folder", "file.ext", "file.ctime", "file.mtime", "file.size",
  "file.links", "file.backlinks", "file.embeds", "file.tags",
];

/** `vY` — display labels for file properties ({propertyId: labelFn}). */
export function s09FilePropLabels() {
  const e = env();
  const gm = e.gm || {};
  const nouns = gm.nouns || {};
  const label = (key) => () => (nouns[key] ? nouns[key]() : key);
  return {
    "file.name": label("fileName"), "file.path": label("filePath"),
    "file.folder": label("folder"), "file.size": label("fileSize"),
    "file.mtime": label("fileMtime"), "file.ctime": label("fileCtime"),
  };
}

const ng07QryClsQ = {};
function ng07QryOnceQ(key, build) { return (ng07QryClsQ[key] ??= build()); }

// ------------------------------------------------------- s09ValueToDisplay

/** `BY` — value -> JS display value for front-matter/cell serialization. */
export function s09ValueToDisplay(app, value, fileCtx) {
  const e = env();
  if (value === null || value === undefined || value instanceof e.bW) return null;
  if (value instanceof e.EW || value instanceof e.NW || value instanceof e.MW) return value.data;
  if (value instanceof e.LW || value instanceof e.IW) return value.printDate ? value.printDate() : String(value);
  if (value instanceof e.OW) return value.getMilliseconds ? value.getMilliseconds() : String(value);
  if (value instanceof e.FW) { // link
    const target = value.resolve ? value.resolve() : value.target || value.data;
    return value.display ? `[[${target}|${value.display}]]` : `[[${target}]]`;
  }
  if (value instanceof e.SW || (value && value.isList && value.isList())) {
    return (value.toArray ? value.toArray() : []).map((v) => s09ValueToDisplay(app, v, fileCtx));
  }
  if (value instanceof e.AW || (value && value.isObject && value.isObject())) {
    const out = {};
    for (const k of value.keys ? value.keys() : []) out[k] = s09ValueToDisplay(app, value.get ? value.get(k) : value.objectAccess(k), fileCtx);
    return out;
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object" && value.file) return `[[${value.file.path}]]`;
  if (typeof value.toString === "function") return value.toString();
  return String(value);
}

// --------------------------------------------------- s09EvalSummaryFormulas

/** `RY` — evaluate summary formulas for `file` in `ctx`; returns display values. */
export function s09EvalSummaryFormulas(app, ctx, formulas, file) {
  const e = env();
  const out = {};
  const fctx = file ? new (s09FileContext(ng07Host))(ctx, file) : ctx;
  const results = fctx && fctx.formulaResults ? fctx.formulaResults : null;
  for (const [name, text] of Object.entries(formulas || {})) {
    try {
      const v = s08FormulaValue(fctx || ctx, String(text));
      out[name] = s09ValueToDisplay(app, v instanceof e.yW ? null : v, fctx);
    } catch (err) { out[name] = null; }
  }
  return out;
}

// ---------------------------------------------- s09FiltersToFrontmatter (FY)

function ng07RuleParts(ruleText) {
  // crude parse: "<lhs> <op> <rhs>" or "fn(args)"
  const m = /^(.+?)\s*(==|!=|<=|>=|<|>|=|contains|startsWith|endsWith|isEmpty|hasTag|inFolder|hasProperty)\s*(.*)$/.exec(String(ruleText || "").trim());
  if (!m) return null;
  return { lhs: m[1].trim(), op: m[2], rhs: m[3].trim() };
}

/** `FY` — extract frontmatter defaults implied by global+view filters. */
export function s09FiltersToFrontmatter(app, query, view, fileCtx) {
  const out = { frontmatter: {}, folder: "" };
  const collect = (filter) => {
    if (!filter) return;
    const rules = filter.getFilterRulesWithNegation ? filter.getFilterRulesWithNegation(false) : [];
    for (const r of rules) {
      if (r.negated) continue;
      const text = r.rule && r.rule.serialize ? r.rule.serialize() : String(r.rule || "");
      const parts = ng07RuleParts(text);
      if (!parts) continue;
      const fmKey = parts.lhs.replace(/^note\./, "").replace(/^"|"$/g, "");
      const unquote = (s) => {
        const t = String(s || "").trim();
        if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
          try { return JSON.parse(t); } catch (e) { return t.slice(1, -1); }
        }
        return t;
      };
      if (parts.op === "isEmpty") { out.frontmatter[fmKey] = ""; continue; }
      if (parts.op === "==" || parts.op === "=") {
        if (parts.lhs === "file.folder") out.folder = unquote(parts.rhs);
        else out.frontmatter[fmKey] = unquote(parts.rhs);
      } else if (parts.op === "hasTag") {
        const tag = unquote(parts.rhs).replace(/^#/, "");
        const cur = out.frontmatter.tags;
        out.frontmatter.tags = Array.isArray(cur) ? [...cur, tag] : cur ? [cur, tag] : [tag];
      } else if (parts.op === "inFolder") {
        out.folder = unquote(parts.rhs);
      } else if (parts.op === "hasProperty") {
        out.frontmatter[fmKey] = null;
      } else if (["contains", "startsWith", "endsWith", "containsAny", "containsAll"].includes(parts.op)) {
        const val = unquote(parts.rhs);
        out.frontmatter[fmKey] = parts.op === "containsAll" || Array.isArray(val) ? val : [val];
      }
    }
  };
  collect(query && query.filters);
  if (view) collect(view.filters);
  // order note properties become null keys when absent
  if (view && Array.isArray(view.order || view.getOrder && view.getOrder())) {
    const order = view.order || view.getOrder();
    for (const pid of order) {
      if (String(pid).startsWith("note.")) {
        const key = String(pid).slice(5);
        if (!(key in out.frontmatter)) out.frontmatter[key] = null;
      }
    }
  }
  return out;
}

// ------------------------------------------------- s09DefaultValueForWidget

/** `AY` — empty value for a property widget type. */
export function s09DefaultValueForWidget(widget) {
  const e = env();
  switch (widget) {
    case "number": return new e.EW(0);
    case "text": case "multitext": case "url": return new e.jW("");
    case "checkbox": case "boolean": return new e.MW(false);
    case "date": case "datetime": return new e.LW(0);
    case "list": case "tags": return new e.PW([]);
    case "file": return new e.NW(null);
    case "link": return new e.BW(null, null, "");
    default: return e.bW.value;
  }
}

// ------------------------------------------------------- PropertySuggest

function ng07BuildPropSuggest() {
  function PropertySuggest(controller, inputEl) {
    this.controller = controller;
    this.inputEl = inputEl;
    this.app = controller && controller.app;
    this.items = [];
  }
  PropertySuggest.prototype.getSuggestions = function (query) {
    const q = String(query || "").toLowerCase();
    const props = (this.controller && this.controller.properties) || [];
    return props.filter((p) => !q || String(p).toLowerCase().includes(q));
  };
  PropertySuggest.prototype.show = function () {};
  return PropertySuggest;
}
export function s09PropertySuggest(host) { ng07H(host); return ng07QryOnceQ("PropertySuggest", ng07BuildPropSuggest); }
