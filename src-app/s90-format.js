// Compatibility shim: implementation lives in n-g39-format.js (clean-room g39).
import { ng39S90FormatSpecs, ng39TrimWhitespace, ng39CursorToContentSide, ng39DetectFormatting } from "./n-g39-format.js";
export const s90FormatSpecs = ng39S90FormatSpecs;
export const s90TrimWhitespace = ng39TrimWhitespace;
export const s90CursorToContentSide = ng39CursorToContentSide;
export const s90DetectFormatting = ng39DetectFormatting;
