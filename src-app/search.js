// Compatibility shim: implementation lives in the n-g39-*.js modules.
import { ng39PrepareQuery, ng39MatchScore, ng39FuzzyMatchJs } from "./n-g39-search.js";
export const prepareQuery = ng39PrepareQuery;
export const matchScore = ng39MatchScore;
export const fuzzyMatchJs = ng39FuzzyMatchJs;
