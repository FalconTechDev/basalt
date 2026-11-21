// Compatibility shim: the implementation lives in n-g34-rename.js and
// n-g34-rename-links.js.
import { ng34DefineFileRenameModal } from "./n-g34-rename.js";
import { ng34DefineRenameLinkModal, ng34DefineHeadingRenameModal, ng34DefineBlockIdRenameModal } from "./n-g34-rename-links.js";

export const defineS20FileRenameModal = ng34DefineFileRenameModal;
export const defineS20RenameLinkModal = ng34DefineRenameLinkModal;
export const defineS20HeadingRenameModal = ng34DefineHeadingRenameModal;
export const defineS20BlockIdRenameModal = ng34DefineBlockIdRenameModal;
