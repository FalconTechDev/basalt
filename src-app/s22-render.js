// Compatibility shim: the implementation lives in n-g34-render.js and
// n-g34-mermaid.js.
import { ng34MermaidTextMap, ng34MathTextMap, ng34CodeBlockText, ng34CodeLanguage, ng34FindCodeBlock, ng34FindMath, ng34SameAttributes, ng34FindInternalEmbed, ng34FindImage, ng34RenderCalloutIcon, ng34InternalLinkHref, ng34FirstHeading, ng34NestedListItems, ng34RangesEqual, ng34ParseMarkdownSections, ng34FindMermaid } from "./n-g34-render.js";
import { ng34FixMermaidLinks, ng34RenderMermaidDiagram, ng34RenderMermaidBlocks } from "./n-g34-mermaid.js";

export const s22MermaidTextMap = ng34MermaidTextMap;
export const s22MathTextMap = ng34MathTextMap;
export const s22CodeBlockText = ng34CodeBlockText;
export const s22CodeLanguage = ng34CodeLanguage;
export const s22FindCodeBlock = ng34FindCodeBlock;
export const s22FindMath = ng34FindMath;
export const s22SameAttributes = ng34SameAttributes;
export const s22FindInternalEmbed = ng34FindInternalEmbed;
export const s22FindImage = ng34FindImage;
export const s22RenderCalloutIcon = ng34RenderCalloutIcon;
export const s22InternalLinkHref = ng34InternalLinkHref;
export const s22FirstHeading = ng34FirstHeading;
export const s22NestedListItems = ng34NestedListItems;
export const s22RangesEqual = ng34RangesEqual;
export const s22ParseMarkdownSections = ng34ParseMarkdownSections;
export const s22FindMermaid = ng34FindMermaid;
export const s22FixMermaidLinks = ng34FixMermaidLinks;
export const s22RenderMermaidDiagram = ng34RenderMermaidDiagram;
export const s22RenderMermaidBlocks = ng34RenderMermaidBlocks;
