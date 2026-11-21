// Compatibility shim: the implementation lives in n-g35-bases-values.js and
// n-g35-bases-formula.js. Tests and historical importers address this module
// by its original file name.
import { ng35ValueRendererBase, ng35MetadataValueRenderer, ng35FileValueRenderer } from "./n-g35-bases-values.js";
import { ng35FormulaValueRenderer } from "./n-g35-bases-formula.js";

export const s26ValueRendererBase = ng35ValueRendererBase;
export const s26MetadataValueRenderer = ng35MetadataValueRenderer;
export const s26FileValueRenderer = ng35FileValueRenderer;
export const s26FormulaValueRenderer = ng35FormulaValueRenderer;
