// Compatibility shim: implementation lives in the n-g39-*.js modules.
import { ng39MergeSpans, ng39ContainsAllWords, ng39SimpleMatch, ng39PrepareFuzzyFinder, ng39PrepareSimpleFinder } from "./n-g39-search-simple.js";
import { ng39RenderMatches, ng39RenderResults, ng39ResolveSubpath } from "./n-g39-search-view.js";
export const mergeSpans = ng39MergeSpans;
export const containsAllWords = ng39ContainsAllWords;
export const simpleMatch = ng39SimpleMatch;
export const prepareFuzzyFinder = ng39PrepareFuzzyFinder;
export const prepareSimpleFinder = ng39PrepareSimpleFinder;
export const renderMatches = ng39RenderMatches;
export const renderResults = ng39RenderResults;
export const resolveSubpath = ng39ResolveSubpath;
