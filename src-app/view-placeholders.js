// Compatibility surface: implementation lives in n-g40-placeholders.js.
import { ng40DefineDeferredView, ng40DefineEmptyView, ng40DefineUnknownView } from "./n-g40-placeholders.js";
export function defineDeferredView(host) { return ng40DefineDeferredView(host); }
export function defineEmptyView(host) { return ng40DefineEmptyView(host); }
export function defineUnknownView(host) { return ng40DefineUnknownView(host); }
