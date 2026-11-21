// g32 clean-room: implementation lives in n-g32-startup-*.js; this path is kept
// for tests/tools that import the historical module name.
import { ng32DefineStartupStat } from "./n-g32-startup-stat.js";
import { ng32DefineStartupTimeModal } from "./n-g32-startup-modal.js";
const defineStartupStat = ng32DefineStartupStat;
const defineStartupTimeModal = ng32DefineStartupTimeModal;
export { defineStartupStat, defineStartupTimeModal };
