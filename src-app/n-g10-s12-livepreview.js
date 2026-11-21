// ng10 — clean-room adapters for the s12-livepreview manifest surface.
//
// The widget classes, decoration plugins and extension factories themselves are
// implemented by the clean-room s30/g17 own modules; this file only
// exposes them under the manifest `use` names and provides the shared
// decoration singletons (identity matters: the deco plugins compare them).
// Class vars are not env-bound, so each factory stashes the class it returns.

import { env } from "./env.js";
import { defineCmBlockquoteWidget, defineCmHrWidget, defineCmTaskWidget, defineCmStyleWidget, defineCmCodeFlairWidget, defineCmImageEmbedWidget, defineCmFileSuggestModal, s30ImageContextMenu } from "./s30-cm6.js";
import { ng17EmbedBlockWidget, ng17InternalEmbedWidget, ng17CodeBlockWidget, ng17MathWidget, ng17HtmlEmbedWidget, ng17EmptyWidget, ng17CalloutWidget, ng17CalloutTypeSuggest, ng17FoldDecorations, ng17SelectionDecorations, ng17TaskDecorations, ng17SelectionField, ng17TaskField, ng17EditorExtensions } from "./n-g17-widgets.js";

// ---- simple CM widget types (parent: the inherited widget-type base) ------
let ng10ClsQuote = null, ng10ClsHr = null, ng10ClsEmpty = null;
export function defineS12BlockquoteBorderWidget(host) { return (ng10ClsQuote = defineCmBlockquoteWidget(host)); }
export function defineS12HrWidget(host) { return (ng10ClsHr = defineCmHrWidget(host)); }
export function defineS12TaskCheckboxWidget(host) { return defineCmTaskWidget(host); }
export function defineS12StyleSpanWidget(host) { return defineCmStyleWidget(host); }
export function defineS12CodeFlairWidget(host) { return defineCmCodeFlairWidget(host); }
export function defineS12EmptyWidgetType(host) { return (ng10ClsEmpty = ng17EmptyWidget(host)); }

// ---- embeddable block widgets ----------------------------------------------
export function defineS12MathWidget(host) { return ng17MathWidget(host); }
export function defineS12HtmlWidget(host) { return ng17HtmlEmbedWidget(host); }
export function defineS12ImageWidget(host) { return defineCmImageEmbedWidget(host); }
export function defineS12InternalEmbedWidget(host) { return ng17InternalEmbedWidget(host); }
export function defineS12CodeblockWidget(host) { return ng17CodeBlockWidget(host); }
export function defineS12CalloutBaseWidget(host) { return ng17EmbedBlockWidget(host); }
export function defineS12CalloutWidget(host) { return ng17CalloutWidget(host); }
export function defineS12CalloutOtherSuggest(host) { return ng17CalloutTypeSuggest(host); }
export function defineS12NoteComposerSuggest(host) { return defineCmFileSuggestModal(host); }

// ---- decoration view plugins ----------------------------------------------
export function defineS12BaseDecoPlugin(host) { return ng17FoldDecorations(host); }
export function defineS12SearchDecoPlugin(host) { return ng17SelectionDecorations(host); }
export function defineS12TaskLineDecoPlugin(host) { return ng17TaskDecorations(host); }

// ---- shared decoration singletons (created once; identity is observable) ---

let ng10QuoteDeco = null;
let ng10HrInstance = null;
let ng10EmptyDeco = null;

/** i6: Decoration.replace wrapping one shared blockquote-border widget. */
export function s12cmBlockquoteBorderDeco() {
  if (!ng10QuoteDeco) {
    ng10QuoteDeco = env().s12cmDecoration.replace({ widget: new ng10ClsQuote() });
  }
  return ng10QuoteDeco;
}

/** o6: one shared hr widget instance. */
export function s12cmHrWidgetInstance() {
  if (!ng10HrInstance) ng10HrInstance = new ng10ClsHr();
  return ng10HrInstance;
}

/** E6: Decoration.widget of the shared empty widget on side -1. */
export function s12cmEmptyWidgetDeco() {
  if (!ng10EmptyDeco) {
    ng10EmptyDeco = env().s12cmDecoration.widget({ widget: new ng10ClsEmpty(), side: -1 });
  }
  return ng10EmptyDeco;
}

/** L6: the search/selection highlight view-plugin extension. */
export function s12SearchHighlightPlugin() { return ng17SelectionField(); }

/** I6: the task-line data-task decoration extension. */
export function s12TaskLinePlugin() { return ng17TaskField(); }

/** A6: mobile drag-selection guard extensions (view plugin + dom handlers). */
export function s12MobileDragExtensions(host) { return ng17EditorExtensions(); }

/** d6 support: shared image context menu + resize corner (used by s12-plugins). */
export function s12imageContextMenu(widget, view, containerEl, imgEl, wrapperEl) {
  s30ImageContextMenu(widget, view, containerEl, imgEl, wrapperEl);
}
