// Compatibility surface: the implementation lives in n-g40-timing.js (g40 clean-room).
import { ng40DebounceCall } from "./n-g40-timing.js";
export function debounceCall(fn, wait, resetTimer) { return ng40DebounceCall(fn, wait, resetTimer); }
