// Compatibility surface: implementations live in n-g40-workspace-*.js.
import { ng40DefineWorkspaceItem } from "./n-g40-workspace-item.js";
import { ng40DefineWorkspaceParent } from "./n-g40-workspace-parent.js";
import { ng40DefineWorkspaceSplit, ng40DefineWorkspaceContainer, ng40DefineWorkspaceRoot } from "./n-g40-workspace-split.js";
import { ng40DefineWorkspaceFloating } from "./n-g40-workspace-floating.js";
import { ng40DefineWorkspaceWindow } from "./n-g40-workspace-window.js";
export function defineWorkspaceItem(host) { return ng40DefineWorkspaceItem(host); }
export function defineWorkspaceParent(host) { return ng40DefineWorkspaceParent(host); }
export function defineWorkspaceSplit(host) { return ng40DefineWorkspaceSplit(host); }
export function defineWorkspaceContainer(host) { return ng40DefineWorkspaceContainer(host); }
export function defineWorkspaceRoot(host) { return ng40DefineWorkspaceRoot(host); }
export function defineWorkspaceFloating(host) { return ng40DefineWorkspaceFloating(host); }
export function defineWorkspaceWindow(host) { return ng40DefineWorkspaceWindow(host); }
