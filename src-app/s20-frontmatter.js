// Compatibility shim: the implementation lives in n-g34-frontmatter.js.
import { ng34MergeFrontmatter, ng34LinkUpdateForRename, ng34DeepMerge, ng34SplitFrontmatter, ng34FrontmatterText, ng34SetFrontmatter } from "./n-g34-frontmatter.js";

export const s20MergeFrontmatter = ng34MergeFrontmatter;
export const s20LinkUpdateForRename = ng34LinkUpdateForRename;
export const s20DeepMerge = ng34DeepMerge;
export const s20SplitFrontmatter = ng34SplitFrontmatter;
export const s20FrontmatterText = ng34FrontmatterText;
export const s20SetFrontmatter = ng34SetFrontmatter;
