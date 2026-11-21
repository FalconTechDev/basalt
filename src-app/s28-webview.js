// Compatibility shim: the implementation lives in n-g35-webview.js and
// n-g35-webview-bars.js. Tests and historical importers address this module
// by its original file name.
import { ng35TitleToFileName, ng35WebViewerAddressSuggest } from "./n-g35-webview.js";
import { ng35WebViewerAddressBar, ng35WebViewerFindBar } from "./n-g35-webview-bars.js";

export const s28TitleToFileName = ng35TitleToFileName;
export const s28WebViewerAddressSuggest = ng35WebViewerAddressSuggest;
export const s28WebViewerAddressBar = ng35WebViewerAddressBar;
export const s28WebViewerFindBar = ng35WebViewerFindBar;
