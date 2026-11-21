// Compatibility shim: the implementation lives in n-g30-webview.js.
import {ng30WebviewAddressBar, ng30WebviewSuggest, ng30WebviewFindBar,} from "./n-g30-webview.js";

export const s11WebviewAddressBar = ng30WebviewAddressBar;
export const s11WebviewSuggest = ng30WebviewSuggest;
export const s11WebviewFindBar = ng30WebviewFindBar;
