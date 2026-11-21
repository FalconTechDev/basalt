// g32 clean-room: implementation lives in n-g32-backoff.js; this path is kept
// for tests/tools that import the historical module name.
import { ng32DefineBackoff } from "./n-g32-backoff.js";
const defineBackoff = ng32DefineBackoff;
export { defineBackoff };
