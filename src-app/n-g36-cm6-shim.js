// g36 clean-room: CodeMirror 6 compatibility shim (spec g36 Part D.3).
// Require maps for @codemirror/* and @lezer/* (current + deprecated names),
// the PluginField stub, the tree.iterate legacy-callback warning wrapper and
// the source-map helpers used when plugin snippets are written to disk.
//
// Every helper accepts the module objects as arguments (tests pass stubs) and
// falls back to the env()-bound require results when called bare by the bundle.

import { env } from "./env.js";

export const ng36CmIterateErrorText =
  "See the stack trace to find the faulty plugin and file an issue with the plugin author. \n" +
  "Details: https://discuss.codemirror.net/t/release-0-20-0/4302";

/** Stub assigned to PluginField.{define,decorations,atomicRanges,scrollMargins}. */
export const ng36CmPluginFieldStub = Object.freeze({ from: function () {} });

const NG36_REQ_KEYS = [
  "obsidian", "@codemirror/autocomplete", "@codemirror/collab", "@codemirror/commands",
  "@codemirror/language", "@codemirror/lint", "@codemirror/search", "@codemirror/state",
  "@codemirror/text", "@codemirror/view", "@lezer/common", "@lezer/lr", "@lezer/highlight",
];

const NG36_REQ_ENV = [
  "s12reqObsidian", "s12reqAutocomplete", "s12reqCollab", "s12reqCommands", "s12reqLanguage",
  "s12reqLint", "s12reqSearch", "s12reqState", "s12reqState", "s12reqView",
  "s12reqLezerCommon", "s12reqLezerLr", "s12reqLezerHighlight",
];

/** Maps the 13 plugin require() names to their module objects, in contract order. */
export function ng36CmRequireMap(obsidian, autocomplete, collab, commands, language, lint, search, state, text, view, common, lr, highlight) {
  const args = [obsidian, autocomplete, collab, commands, language, lint, search, state, text, view, common, lr, highlight];
  const e = env();
  const out = {};
  for (let i = 0; i < NG36_REQ_KEYS.length; i++) {
    out[NG36_REQ_KEYS[i]] = args[i] !== undefined ? args[i] : e[NG36_REQ_ENV[i]];
  }
  return out;
}

const NG36_DEP_KEYS = [
  "@codemirror/closebrackets", "@codemirror/comment", "@codemirror/fold", "@codemirror/gutter",
  "@codemirror/highlight", "@codemirror/history", "@codemirror/matchbrackets", "@codemirror/panel",
  "@codemirror/rangeset", "@codemirror/rectangular-selection", "@codemirror/stream-parser", "@codemirror/tooltip",
];

// Deprecated names alias the modern packages that absorbed them (env fallbacks
// mirror the require-map aliases: closebrackets->autocomplete, comment/history
// ->commands, fold/highlight/matchbrackets/stream-parser->language,
// gutter/panel/rectangular-selection/tooltip->view, rangeset->state).
const NG36_DEP_ENV = [
  "s12reqAutocomplete", "s12reqCommands", "s12reqLanguage", "s12reqView",
  "s12reqLanguage", "s12reqCommands", "s12reqLanguage", "s12reqView",
  "s12reqState", "s12reqView", "s12reqLanguage", "s12reqView",
];

export function ng36CmRequireMapDeprecated(closebrackets, comment, fold, gutter, highlight, history, matchbrackets, panel, rangeset, rectangularSelection, streamParser, tooltip) {
  const args = [closebrackets, comment, fold, gutter, highlight, history, matchbrackets, panel, rangeset, rectangularSelection, streamParser, tooltip];
  const e = env();
  const out = {};
  for (let i = 0; i < NG36_DEP_KEYS.length; i++) {
    out[NG36_DEP_KEYS[i]] = args[i] !== undefined ? args[i] : e[NG36_DEP_ENV[i]];
  }
  return out;
}

/** Matches a whole-line inline sourceMappingURL=data:...;base64 comment. */
export const ng36CmSourceMapPattern = /^\/\/[@#] sourceMappingURL=data:application\/json(?:;charset[:=][^;]+)?;base64,.*$/gm;

/** Marker appended to written snippets so they opt out of source maps. */
export const ng36CmNoSourceMap = "\n/* nosourcemap */";

/** Returns the current `proto.iterate` (captured before any compat patching). */
export function ng36CmTreeIterate(proto) {
  const p = proto || (env().s12lezerTree && env().s12lezerTree.prototype);
  return p && p.iterate;
}

/**
 * Wraps an enter/leave callback declared with the legacy (type,from,to)
 * signature: logs the changed-syntax error, then calls `fn` with the range
 * fields of the single argument it receives.
 */
export function ng36CmIterateWrapper(fn) {
  return function (spec) {
    console.error(new Error("[CM6] tree.iterate has changed syntax.\n" + ng36CmIterateErrorText));
    return fn.call(this, spec.type, spec.from, spec.to);
  };
}

/** StateEffect dropping cached syntax info (plugins dispatch it to refresh). */
export function ng36CmClearCacheEffect(StateEffect) {
  const SE = StateEffect || env().s12cmStateEffect;
  return SE.define();
}

/** ViewPlugin whose view object starts with `{mousedown:false}`. */
export function ng36CmMousePlugin(ViewPlugin) {
  const VP = ViewPlugin || env().s12cmViewPlugin;
  return VP.define(() => ({ mousedown: false }));
}

// ---------------------------------------------------------------------------
// Callout tables, inline mark names, fence pattern
// ---------------------------------------------------------------------------

const NG36_CALLOUT_KEYS = ["info", "important", "tip", "success", "question", "warning", "example", "quote"];

export function ng36CalloutTypeMap() {
  const t = env().gm.callout.type;
  const out = {};
  for (const key of NG36_CALLOUT_KEYS) out[key] = t[key];
  return out;
}

const NG36_CALLOUT_ALIASES = [
  "abstract", "summary", "tldr", "todo", "hint", "check", "done", "question", "faq", "help",
  "caution", "attention", "failure", "fail", "missing", "danger", "error", "bug", "example", "cite",
];

export function ng36CalloutTypeNames() {
  return Object.keys(ng36CalloutTypeMap()).concat(NG36_CALLOUT_ALIASES);
}

export const ng36CmInlineMarkNames = new Set([
  "em", "strong", "inline-code", "strikethrough", "highlight", "link", "image",
  "hmd-internal-link", "hmd-embed", "formatting-link", "footref",
]);

/** Fenced-code opener: fence chars in group 1, language in group 2. */
export const ng36CmFencePattern = /^\s*(~~~+|```+)[ \t]*([\w\/+#-]*)[^\n`]*$/;

// ---------------------------------------------------------------------------
// Decoration mark/replace factories (Decoration injected or env-bound)
// ---------------------------------------------------------------------------

function ng36Deco(D) { return D || env().s12cmDecoration; }

export function ng36CmUnderlineMark(D) {
  return ng36Deco(D).mark({ class: "cm-underline", attributes: { tabIndex: "-1", draggable: "true" } });
}
export function ng36CmTransparentMark(D) { return ng36Deco(D).mark({ class: "cm-transparent" }); }
export function ng36CmUnresolvedMark(D) { return ng36Deco(D).mark({ class: "is-unresolved" }); }
export function ng36CmListBulletMark(D) { return ng36Deco(D).mark({ class: "list-bullet" }); }
export function ng36CmListNumberMark(D) { return ng36Deco(D).mark({ class: "list-number" }); }

/** Fresh empty replace decoration on every call (identity must not be assumed). */
export function ng36CmEmptyReplace(D) { return ng36Deco(D).replace({}); }

/** Replace decoration wrapping a fresh widget instance. */
export function ng36CmBlockquoteReplace(D, Widget) {
  return ng36Deco(D).replace({ widget: new Widget() });
}
