// Compatibility shim: the implementation lives in n-g30-embed.js.
import {ng30MarkdownEmbedView, ng30EmbedSectionBase, ng30EmbedWidget, ng30QueryEmbedView,} from "./n-g30-embed.js";

export const defineMarkdownEmbedView = ng30MarkdownEmbedView;
export const defineEmbedSectionBase = ng30EmbedSectionBase;
export const defineEmbedWidget = ng30EmbedWidget;
export const defineQueryEmbedView = ng30QueryEmbedView;
