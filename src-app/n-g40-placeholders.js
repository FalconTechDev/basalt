// g40 clean-room: stand-in views (spec g40 Part D).
// DeferredView remembers a not-yet-built view; EmptyView is the new-tab page;
// UnknownView preserves panes whose type no plugin registered.
import { inherit } from "./inherit.js";

export function ng40DefineDeferredView(host) {
  function DeferredView(leaf, viewType, icon, title) {
    const self = host.View.call(this, leaf) || this;
    self.viewType = viewType;
    self.icon = icon;
    self.title = title || "";
    self.navigation = false;
    self.state = undefined;
    self.estate = undefined;
    const rerender = () => { self.rerender(); };
    if (typeof self.containerEl.onNodeInserted === "function") self.containerEl.onNodeInserted(rerender);
    self.containerEl.addEventListener("click", rerender);
    return self;
  }
  inherit(DeferredView, host.View);
  const proto = DeferredView.prototype;

  proto.getDisplayText = function () { return this.title; };
  proto.getViewType = function () { return this.viewType; };
  proto.getState = function () { return this.state; };
  proto.setState = async function (state) { this.state = state; };
  proto.setEphemeralState = function (e) { this.estate = e; };

  proto.rerender = async function () {
    const leaf = this.leaf;
    if (leaf.view !== this || leaf.working) return;
    await leaf.setViewState({ type: this.viewType, state: this.state }, this.estate);
    if (leaf.view !== this) this.app.workspace.requestLayoutChangeEvents();
  };

  return DeferredView;
}

function ng40EmptyStateSkeleton(self) {
  const empty = (self.emptyStateEl = self.contentEl.createDiv("empty-state"));
  const area = (self.clickableAreaEl = empty.createDiv("empty-state-container"));
  self.emptyTitleEl = area.createDiv("empty-state-title");
  self.actionListEl = area.createDiv("empty-state-action-list");
  self.app.dragManager.handleDrop(empty, (event, data, isPreview) => {
    const hint = self.leaf.handleDrop(event, data, isPreview);
    if (hint) {
      hint.hoverEl = self.emptyStateEl;
      hint.hoverClass = "is-highlighted";
    }
    return hint;
  });
}

function ng40HotkeySuffix(host, app, commandId, always) {
  if (!always && !host.Platform.hasPhysicalKeyboard) return "";
  const key = app.hotkeyManager.printHotkeyForCommand(commandId);
  return key ? " (" + key + ")" : "";
}

function ng40ActionRow(self, cls, text, onClick) {
  const row = self.actionListEl.createDiv("empty-state-action tappable" + (cls ? " " + cls : ""));
  row.setText(text);
  row.addEventListener("click", onClick);
  return row;
}

export function ng40DefineEmptyView(host) {
  function EmptyView(leaf) {
    const self = host.ItemView.call(this, leaf) || this;
    self.viewType = "empty";
    self.canDropAnywhere = true;
    self.navigation = true;
    ng40EmptyStateSkeleton(self);
    return self;
  }
  inherit(EmptyView, host.ItemView);
  const proto = EmptyView.prototype;

  proto.getDisplayText = function () { return host.t.interface.labelNewTab(); };
  proto.getViewType = function () { return "empty"; };

  proto.onOpen = function () {
    const self = this;
    const app = this.app;
    const list = this.actionListEl;
    list.empty();
    ng40ActionRow(self, "", host.t.interface.emptyState.createNewFile() + ng40HotkeySuffix(host, app, "file-explorer:new-file", false),
      (event) => app.commands.executeCommandById("file-explorer:new-file", event));
    if (!app.vault.isEmpty()) {
      ng40ActionRow(self, "", host.t.interface.emptyState.goToFile() + ng40HotkeySuffix(host, app, "switcher:open", false),
        (event) => app.commands.executeCommandById("switcher:open", event));
    }
    if (app.internalPlugins.getEnabledPluginById("webviewer")) {
      ng40ActionRow(self, "", host.t.plugins.webViewer.actionOpen() + ng40HotkeySuffix(host, app, "webviewer:open", true),
        (event) => app.commands.executeCommandById("webviewer:open", event));
    }
    ng40ActionRow(self, "mod-close", host.t.interface.emptyState.close(), () => self.leaf.detach());
  };

  return EmptyView;
}

export function ng40DefineUnknownView(host) {
  function UnknownView(leaf, viewType) {
    const self = host.EmptyView.call(this, leaf) || this;
    self.viewType = viewType;
    self.canDropAnywhere = true;
    self.state = undefined;
    self.emptyTitleEl.setText(host.t.interface.emptyState.unknownPaneTitle());
    const desc = self.clickableAreaEl.createDiv();
    desc.setText(host.t.interface.emptyState.unknownPaneDesc({ type: viewType }));
    self.clickableAreaEl.insertBefore(desc, self.actionListEl);
    host.setTooltip(desc, "This pane doesn't look like anything to me.");
    self.onLayoutChange = self.onLayoutChange.bind(self);
    return self;
  }
  inherit(UnknownView, host.EmptyView);
  const proto = UnknownView.prototype;

  proto.getDisplayText = function () { return this.viewType; };
  proto.getViewType = function () { return this.viewType; };
  proto.getIcon = function () { return "lucide-ghost"; };
  proto.getState = function () { return this.state; };
  proto.setState = async function (state) { this.state = state; };

  proto.onload = function () {
    const base = host.EmptyView.prototype.onload;
    if (base) base.call(this);
    this.registerEvent(this.app.workspace.on("layout-change", this.onLayoutChange));
  };

  proto.onOpen = function () {
    const self = this;
    const app = this.app;
    const list = this.actionListEl;
    list.empty();
    ng40ActionRow(self, "mod-close", host.t.interface.emptyState.close(), () => self.leaf.detach());
    self.closeAllButtonEl = ng40ActionRow(self, "mod-close",
      host.t.interface.emptyState.closeAll({ id: self.viewType, count: app.workspace.getLeavesOfType(self.viewType).length }),
      () => {
        for (const leaf of app.workspace.getLeavesOfType(self.viewType)) leaf.detach();
      });
    self.closeAllButtonEl.style.display = "none";
    self.onLayoutChange();
  };

  proto.onLayoutChange = function () {
    const count = this.app.workspace.getLeavesOfType(this.viewType).length;
    this.closeAllButtonEl.setText(host.t.interface.emptyState.closeAll({ id: this.viewType, count }));
    this.closeAllButtonEl.style.display = count > 1 ? "" : "none";
  };

  return UnknownView;
}
