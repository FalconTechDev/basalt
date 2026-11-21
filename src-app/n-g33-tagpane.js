// g33 clean-room: "tag-pane" core plugin shell. Registers the global
// "tag-pane:open" command and the "tag" view type; the view class itself is
// provided by the host (s16TagPaneView). Replaces orig dee.
import { s16TagViewType } from "./s16-constants.js";

export function defineTagPanePlugin(host) {
  function TagPanePlugin() {
    this.id = "tag-pane";
    this.name = host.i18n.plugins.tagPane.name();
    this.description = host.i18n.plugins.tagPane.desc();
    this.defaultOn = true;
    this.app = null;
    this.plugin = null;
  }

  TagPanePlugin.prototype.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    const self = this;
    plugin.registerGlobalCommand({
      id: "tag-pane:open",
      name: host.i18n.plugins.tagPane.actionShow(),
      icon: "lucide-tag",
      callback: () => self.app.workspace.ensureSideLeaf(s16TagViewType, "right", { active: true }),
    });
    plugin.registerViewType(s16TagViewType, (leaf) => new host.s16TagPaneView(leaf));
  };

  TagPanePlugin.prototype.onEnable = function (app, plugin) {
    const self = this;
    plugin.registerEvent(app.workspace.on("layout-ready", () => self.initLeaf(), this));
  };

  TagPanePlugin.prototype.onUserEnable = function () {
    this.initLeaf();
  };

  TagPanePlugin.prototype.initLeaf = function () {
    const side = host.Platform.isMobile ? "left" : "right";
    this.app.workspace.ensureSideLeaf(s16TagViewType, side, { reveal: false });
  };

  return TagPanePlugin;
}
