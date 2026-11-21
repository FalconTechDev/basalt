// g30 clean-room: bases/canvas/mobile constants + lazy i18n accessors
// (spec g30 part K). Accessors resolve env().gm at call time.
import {ng30I18nTable} from "./n-g30-i18n.js";

export const ng30ViewCards = "cards";
export const ng30ViewList = "list";
export const ng30ViewTable = "table";
export const ng30ViewBase = "base";

export const ng30PropBullet = "bullet";
export const ng30PropSeparator = "separator";
export const ng30PropIndentProperties = "indentProperties";
export const ng30PropMarkers = "markers";

export const ng30AudioMime = "audio/mp4";
export const ng30BookmarksId = "bookmarks";

export const ng30RowHeightDefault = 400;
export const ng30ZoomDefault = 0.7;
export const ng30ZoomStep = 0.01;
export const ng30ZoomOffset = 0.93;
export const ng30ZoomPanOffset = -1.7;

const NG30_I18N_PATHS = {
  ng30BasesI18n: ["plugins", "bases"],
  ng30BasesCardsI18n: ["plugins", "bases", "cards"],
  ng30BasesListI18n: ["plugins", "bases", "list"],
  ng30BasesTableI18n: ["plugins", "bases", "table"],
  ng30BookmarksI18n: ["plugins", "bookmarks"],
  ng30CanvasI18n: ["plugins", "canvas"],
  ng30FileExplorerI18n: ["plugins", "fileExplorer"],
  ng30QuickSwitcherI18n: ["plugins", "quickSwitcher"],
  ng30InterfaceI18n: ["interface"],
};

export function ng30BasesI18n() { return ng30I18nTable(NG30_I18N_PATHS.ng30BasesI18n); }
export function ng30BasesCardsI18n() { return ng30I18nTable(NG30_I18N_PATHS.ng30BasesCardsI18n); }
export function ng30BasesListI18n() { return ng30I18nTable(NG30_I18N_PATHS.ng30BasesListI18n); }
export function ng30BasesTableI18n() { return ng30I18nTable(NG30_I18N_PATHS.ng30BasesTableI18n); }
export function ng30BookmarksI18n() { return ng30I18nTable(NG30_I18N_PATHS.ng30BookmarksI18n); }
export function ng30CanvasI18n() { return ng30I18nTable(NG30_I18N_PATHS.ng30CanvasI18n); }
export function ng30FileExplorerI18n() { return ng30I18nTable(NG30_I18N_PATHS.ng30FileExplorerI18n); }
export function ng30QuickSwitcherI18n() { return ng30I18nTable(NG30_I18N_PATHS.ng30QuickSwitcherI18n); }
export function ng30InterfaceI18n() { return ng30I18nTable(NG30_I18N_PATHS.ng30InterfaceI18n); }
