// Compatibility shim: the implementation lives in n-g35-search.js. Tests and
// historical importers address this module by its original file name.
import { ng35HasSearch, ng35FormattingMenu, ng35RenderMatchSpans } from "./n-g35-search.js";

export const s22HasSearch = ng35HasSearch;
export const s22FormattingMenu = ng35FormattingMenu;
export const s22RenderMatchSpans = ng35RenderMatchSpans;
