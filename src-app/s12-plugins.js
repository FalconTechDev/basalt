// Compatibility shim: RecentFiles lives in n-g30-recent.js; the image context
// menu entry stays here so the live-preview import (and its spec-test stub
// transform) keeps working unchanged.
import { s12imageContextMenu } from "./n-g10-s12-livepreview.js";
import {ng30RecentFiles, ng30RegisterImageMenu, ng30ImageContextMenuEntry} from "./n-g30-recent.js";

ng30RegisterImageMenu(s12imageContextMenu);

export const defineS12RecentFiles = ng30RecentFiles;
export const s12ImageContextMenuEntry = ng30ImageContextMenuEntry;
