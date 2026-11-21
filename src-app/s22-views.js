// Compatibility shim: the implementation lives in n-g35-views.js and
// n-g35-query-embed.js. Tests and historical importers address this module
// by its original file name.
import { ng35DefineViewContainer, ng35DefineMarkdownEmbed } from "./n-g35-views.js";
import { ng35DefineQueryResults } from "./n-g35-query-embed.js";

export const defineViewContainer = ng35DefineViewContainer;
export const defineMarkdownEmbed = ng35DefineMarkdownEmbed;
export const defineQueryResults = ng35DefineQueryResults;
