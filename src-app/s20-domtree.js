// Compatibility shim: the implementation lives in n-g34-domtree.js. Tests and
// historical importers address this module by its original file name.
import { ng34ChildrenMixin, ng34DefineCollapsibleItem, ng34DefineRenderItem, ng34DefineChildrenItem, ng34DefineTreeContainer } from "./n-g34-domtree.js";

export const s20ChildrenMixin = ng34ChildrenMixin;
export const defineS20CollapsibleItem = ng34DefineCollapsibleItem;
export const defineS20RenderItem = ng34DefineRenderItem;
export const defineS20ChildrenItem = ng34DefineChildrenItem;
export const defineS20TreeContainer = ng34DefineTreeContainer;
