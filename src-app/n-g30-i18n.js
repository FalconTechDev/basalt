// g30 clean-room: lazy i18n string-table accessors (spec g30 part D).
// env().gm is read on EVERY call — the i18n tree is not ready at module eval
// and may be (re)initialised later, so nothing is cached.
import {env} from "./env.js";

/** Walks `path` segments under env().gm; undefined segments propagate. */
export function ng30I18nTable(path) {
  let node = env().gm;
  for (const key of path) {
    if (node == null) return node;
    node = node[key];
  }
  return node;
}

export function ng30PdfStrings() { return ng30I18nTable(["pdf"]); }
export function ng30SearchStrings() { return ng30I18nTable(["plugins", "search"]); }
export function ng30GraphStrings() { return ng30I18nTable(["plugins", "graphView"]); }
export function ng30BookmarkStrings() { return ng30I18nTable(["plugins", "bookmarks"]); }
export function ng30WebViewerStrings() { return ng30I18nTable(["plugins", "webViewer"]); }
