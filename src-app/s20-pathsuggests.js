// Compatibility shim: the implementation lives in n-g34-pathsuggests.js.
import { ng34DefineMarkdownFileSuggest, ng34DefinePredicatedFileSuggest, ng34DefinePredicatedFolderSuggest } from "./n-g34-pathsuggests.js";

export const defineS20MarkdownFileSuggest = ng34DefineMarkdownFileSuggest;
export const defineS20PredicatedFileSuggest = ng34DefinePredicatedFileSuggest;
export const defineS20PredicatedFolderSuggest = ng34DefinePredicatedFolderSuggest;
