// Compatibility shim: the implementation lives in n-g35-publish.js. Tests and
// historical importers address this module by its original file name.
import { ng35PublishSite, ng35PublishSearch, ng35PublishApp } from "./n-g35-publish.js";

export const s24PublishSite = ng35PublishSite;
export const s24PublishSearch = ng35PublishSearch;
export const s24PublishApp = ng35PublishApp;
