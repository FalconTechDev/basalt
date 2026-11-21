// Compatibility shim: implementation lives in n-g36-suggests.js and
// n-g36-movefolder.js; acceptance tests import this historical path directly.
import { ng36FootnoteSuggest, ng36EditorSuggestManager } from "./n-g36-suggests.js";
import { ng36MoveFolderModal } from "./n-g36-movefolder.js";
export const defineFootnoteSuggest = ng36FootnoteSuggest;
export const defineEditorSuggestManager = ng36EditorSuggestManager;
export const defineMoveFolderModal = ng36MoveFolderModal;
