// Compatibility shim: the implementation lives in n-g35-unicode.js. Tests and
// historical importers address this module by its original file name.
import { ng35UnicodeLetterSource, ng35UnicodeWordSource, ng35WordCharSource, ng35WordCharRegex } from "./n-g35-unicode.js";

export const s22UnicodeLetterSource = ng35UnicodeLetterSource;
export const s22UnicodeWordSource = ng35UnicodeWordSource;
export const s22WordCharSource = ng35WordCharSource;
export const s22WordCharRegex = ng35WordCharRegex;
