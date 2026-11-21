// Compatibility shim: the implementation lives in n-g35-chrome.js. Tests and
// historical importers address this module by its original file name.
import { ng35DefineHotkeyFilterChip, ng35HotkeyFilterTitles } from "./n-g35-chrome.js";

export const defineHotkeyFilterChip = ng35DefineHotkeyFilterChip;
export const s29HotkeyFilterTitles = ng35HotkeyFilterTitles;
