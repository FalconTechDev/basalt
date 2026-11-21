// g35 clean-room: search helpers — capability probe, editor formatting submenu
// and the matched-range span renderer wrapper (spec g35, s22-search).
import { env } from "./env.js";

/** True when the view exposes a callable showSearch. */
export function ng35HasSearch(view) {
  return typeof view.showSearch === "function";
}

// Declarative table for the formatting submenu: order, section suffix, i18n key,
// icon, checked-state key and click target are all contract.
const NG35_FORMAT_ITEMS = [
  ["basic", "toggleBold", "lucide-bold", "bold", (ed) => ed.toggleMarkdownFormatting("bold")],
  ["basic", "toggleItalics", "lucide-italic", "italic", (ed) => ed.toggleMarkdownFormatting("italic")],
  ["basic", "toggleStrikethrough", "lucide-strikethrough", "strikethrough", (ed) => ed.toggleMarkdownFormatting("strikethrough")],
  ["basic", "toggleHighlight", "lucide-highlighter", "highlight", (ed) => ed.toggleMarkdownFormatting("highlight")],
  ["advanced", "toggleCode", "lucide-code-2", "code", (ed) => ed.toggleMarkdownFormatting("code")],
  ["advanced", "toggleMath", "lucide-sigma", "math", (ed) => ed.toggleMarkdownFormatting("math")],
  ["advanced", "toggleComments", "lucide-percent", "comment", (ed) => ed.toggleComment()],
  ["danger", "clear", "lucide-eraser", null, (ed) => ed.clearMarkdownFormatting()],
];

/** Adds the formatting submenu to an editor context menu / format pill. */
export function ng35FormattingMenu(menu, editor, state, section) {
  const gm = env().gm.interface.formatting;
  menu.setShowMacWritingTools(true);
  menu.addSections([section + ".basic", section + ".advanced", section + ".danger"]);
  return menu.addItem((item) => {
    item
      .setSection(section)
      .setTitle(gm.labelFormatting())
      .setIcon("lucide-paintbrush")
      .setSubmenu();
    for (const [sub, titleKey, icon, checkedKey, action] of NG35_FORMAT_ITEMS) {
      item.addItem((subItem) => {
        subItem
          .setSection(section + "." + sub)
          .setTitle(gm[titleKey]())
          .setIcon(icon)
          .onClick(() => action(editor));
        if (checkedKey !== null) subItem.setChecked(!!state[checkedKey]);
      });
    }
    return item;
  });
}

/** Renders text[from..to) into el with match ranges wrapped in highlight spans. */
export function ng35RenderMatchSpans(el, text, matches, from, to) {
  renderMatchRanges(el, text, from, to, matches);
}
