// Compatibility entry for tests/tools that import the workspaces module path.
// g33: implementation lives in n-g33-workspaces.js + n-g33-workspace-modals.js.
import { defineWorkspacesPlugin } from "./n-g33-workspaces.js";
import { defineManageWorkspacesModal, defineWorkspaceSuggestModal } from "./n-g33-workspace-modals.js";
export { defineWorkspacesPlugin, defineManageWorkspacesModal, defineWorkspaceSuggestModal };
