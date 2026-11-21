// g40 clean-room: workspace layout tree, part 4 — WorkspaceFloating (holder of
// pop-out windows; renders nothing itself).
import { inherit } from "./inherit.js";

export function ng40DefineWorkspaceFloating(host) {
  function WorkspaceFloating(workspace, id) {
    const self = host.WorkspaceParent.call(this, workspace, id) || this;
    self.type = "floating";
    self.allowSingleChild = true;
    self.autoManageDOM = false;
    self.children = [];
    self.parent = null;
    return self;
  }
  inherit(WorkspaceFloating, host.WorkspaceParent);
  return WorkspaceFloating;
}
