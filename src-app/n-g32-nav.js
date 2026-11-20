// g32 clean-room: sync-sidebar tree items (base, folder, "+N more", file row).
import { inherit } from "./inherit.js";
import { baseName, extensionOf } from "./path.js";

let ng32NavBaseClass = null;

export function ng32DefineNavItemBase(host) {
  if (ng32NavBaseClass) return ng32NavBaseClass;
  function Ng32NavItemBase() {
    const self = host.TreeItem.call(this) || this;
    self.info = { height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0, computed: false, queued: false, hidden: false, next: false };
    delete self.coverEl;
    return self;
  }
  inherit(Ng32NavItemBase, host.TreeItem);
  ng32NavBaseClass = Ng32NavItemBase;
  return Ng32NavItemBase;
}

export function ng32DefineNavFolder(host) {
  const Base = host.s16TreeCollapsible(ng32DefineNavItemBase(host));
  function Ng32NavFolder(tree, id, title) {
    const self = Base.call(this, tree, id, title) || this;
    self.vChildren = new host.TreeChildren(self);
    self.pusherEl = host.s16TreePusher();
    self.tree = tree;
    self.id = id;
    self.setClickable(true);
    self.setCollapsible(true);
    self.el.addClass("nav-folder");
    self.selfEl.addClass("nav-folder-title");
    self.innerEl.addClass("nav-folder-title-content");
    self.childrenEl.addClass("nav-folder-children");
    self.innerEl.setText(title);
    self.flairEl = self.selfEl.createDiv("tree-item-flair-outer").createSpan("tree-item-flair");
    self.collapseEl.empty();
    return self;
  }
  inherit(Ng32NavFolder, Base);
  const proto = Ng32NavFolder.prototype;

  proto.clear = function () { this.vChildren.clear(); this.setFlair(0); };
  proto.addChild = function (child) { this.vChildren.addChild(child); };
  proto.onSelfClick = function () { this.toggleCollapsed(true); };
  proto.setFlair = function (count) { this.flairEl.setText(host.i18n.nouns.count({ count })); };
  proto.setCollapsed = function (collapsed, scroll) {
    return (async () => {
      await Base.prototype.setCollapsed.call(this, collapsed, scroll);
      this.tree.infinityScroll.invalidate(this);
      this.tree.requestSaveFolds();
    })();
  };
  return Ng32NavFolder;
}

export function ng32DefineNavMoreButton(host) {
  const Base = ng32DefineNavItemBase(host);
  function Ng32NavMoreButton(parent, count) {
    const self = Base.call(this, parent, count) || this;
    self.parent = parent;
    self.count = count;
    self.setClickable(false);
    self.el.addClass("nav-file");
    self.selfEl.addClass("more-button");
    self.innerEl.addClass("nav-file-title-content");
    self.innerEl.setText(host.i18n.plugins.sync.labelMore({ count }));
    return self;
  }
  inherit(Ng32NavMoreButton, Base);
  return Ng32NavMoreButton;
}

export function ng32DefineSyncNavFile(host) {
  const Base = ng32DefineNavItemBase(host);
  function Ng32SyncNavFile(view, sFile) {
    const self = Base.call(this, view, sFile) || this;
    self.view = view;
    self.sFile = sFile;
    self.setClickable(true);
    self.el.addClass("nav-file");
    self.selfEl.addClass("nav-file-title");
    self.innerEl.addClass("nav-file-title-content");
    const ext = extensionOf(sFile.path);
    if (!host.markdownExtensions.contains(ext)) self.selfEl.createDiv({ cls: "nav-file-tag", text: ext });
    self.innerEl.setText(baseName(sFile.path));
    self.selfEl.setAttr("data-path", sFile.path);
    self.selfEl.addEventListener("mouseover", (event) => self.onFileMouseover(event));
    self.selfEl.addEventListener("mouseout", (event) => self.onFileMouseout(event));
    self.selfEl.addEventListener("contextmenu", (event) => self.openFileContextMenu(event));
    return self;
  }
  inherit(Ng32SyncNavFile, Base);
  const proto = Ng32SyncNavFile.prototype;

  proto.onSelfClick = function (event) {
    this.view.app.workspace.openLinkText(this.sFile.path, "", host.Keymap.isModEvent(event));
  };

  proto.openFileContextMenu = function (event) {
    event.preventDefault();
    const dest = this.view.app.metadataCache.getFirstLinkpathDest(this.sFile.path, "");
    if (!dest) return;
    const menu = new host.Menu().addSections(["title", "open", "action", "view", "info", "", "danger"]);
    menu.addItem((item) => item
      .setSection("view")
      .setTitle(host.i18n.plugins.sync.menuOptViewVersionHistory())
      .setIcon("lucide-history")
      .onClick(() => this.view.sync.showVersionHistory(this.sFile.path)));
    this.view.app.workspace.trigger("file-menu", menu, dest, "sync-sidebar");
    menu.showAtMouseEvent(event);
  };

  proto.onFileMouseover = function (event) {
    if (!host.pointerEntered(event, this.selfEl) || host.isTouchSyntheticMouse(event)) return;
    let text = window.moment(this.sFile.mtime).format("llll");
    if (this.sFile.user && Object.prototype.hasOwnProperty.call(this.view.userMap, this.sFile.user)) text += "\n" + this.view.userMap[this.sFile.user];
    host.displayTooltip(this.selfEl, text, {
      placement: this.view.getSideTooltipPlacement(),
      gap: 24,
      horizontalParent: this.view.containerEl,
      delay: host.s16NavTooltipDelay,
    });
  };

  proto.onFileMouseout = function (event) {
    if (host.pointerEntered(event, this.selfEl)) host.hideTooltip();
  };

  return Ng32SyncNavFile;
}
