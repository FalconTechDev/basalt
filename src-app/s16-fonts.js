// g32 clean-room: implementation lives in n-g32-font-*.js; this path is kept
// for tests/tools that import the historical module name.
import { ng32DefineFontSuggest } from "./n-g32-font-suggest.js";
import { ng32DefineFontListModal } from "./n-g32-font-modal.js";
const defineFontSuggest = ng32DefineFontSuggest;
const defineFontListModal = ng32DefineFontListModal;
export { defineFontSuggest, defineFontListModal };
