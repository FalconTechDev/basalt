// Compatibility entry for tests/tools that import the bidi module path.
// g33: implementation lives in n-g33-bidi.js (clean-room rewrite).
import { s20TextDirection, s20BidiMarks, s20BidiDecorations, defineS20BidiPlugin } from "./n-g33-bidi.js";
export { s20TextDirection, s20BidiMarks, s20BidiDecorations, defineS20BidiPlugin };
