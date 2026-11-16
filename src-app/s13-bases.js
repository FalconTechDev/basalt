// Bases (database views) classes, ported slice by slice. Group headers, column sizers,
// table rows/cells and the list/cards renderers live here; the big views stay inherited.
import { env } from "./env.js";

/** Group header block of the cards view: a heading element refreshed from the view. */
export function defineS13CardsGroupHeader() {
  function CardsGroupHeader(view) {
    this.view = view;
    this.containerEl = env().createDiv("bases-cards-group");
    this.groupHeadingEl = env().createDiv("bases-group-heading");
  }

  CardsGroupHeader.prototype.render = function (group) {
    this.groupHeadingEl = this.view.createGroupHeadingEl(group);
  };

  return CardsGroupHeader;
}

/** Per-column width state of the table view: custom width wins, else content/header + 1 clamped. */
export function defineS13ColumnWidth() {
  function ColumnWidth() {
    this.headerWidth = 0;
    this.contentWidth = 0;
    this.customWidth = 0;
  }

  ColumnWidth.prototype.getWidth = function (min, max) {
    if (this.customWidth) return Math.max(min, this.customWidth);
    return Math.clamp(Math.max(this.contentWidth, this.headerWidth) + 1, min, max);
  };

  return ColumnWidth;
}
