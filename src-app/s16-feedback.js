// g32 clean-room: implementation lives in n-g32-feedback*.js; this path is kept
// for tests/tools that import the historical module name.
import { ng32DefineFeedbackBanner } from "./n-g32-feedback.js";
const defineFeedbackBanner = ng32DefineFeedbackBanner;
export { defineFeedbackBanner };
