// Compatibility shim: implementation lives in n-g39-formatting*.js (clean-room g39).
import { ng39FormatSkips } from "./n-g39-formatting.js";
import { ng39FormatLineRange, ng39FormatRemoveMarks, ng39FormatInnerMark } from "./n-g39-formatting2.js";
import { ng39FormatNodeRange } from "./n-g39-formatting3.js";
export const s91FormatSkips = ng39FormatSkips;
export const s91FormatLineRange = ng39FormatLineRange;
export const s91FormatRemoveMarks = ng39FormatRemoveMarks;
export const s91FormatInnerMark = ng39FormatInnerMark;
export const s91FormatNodeRange = ng39FormatNodeRange;
