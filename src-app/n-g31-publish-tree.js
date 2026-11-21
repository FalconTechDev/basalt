// g31 clean-room: publish-dialog navigation preview tree + modals
// (spec g31 part G). Item/tree classes resolve their bases through env()
// lazily, mirroring the bundle-registered class names.
import { env } from "./env.js";

const ng31PubI18n = (path) => env().gm.plugins[path];

// Custom navigation entry with a hide-in-navigation context menu.
export function ng31PublishNavItem() {
  const Base = env().JL;
  return class Ng31PublishNavItem extends Base {
    constructor(tree, path) {
      super();
      this.name = env().nu(path);
      this.path = path;
      this.hidden = false;
      this.tree = tree;
      this.el.addClass("mod-custom-nav");
      this.selfEl.addEventListener("contextmenu", (ev) => this.onContextMenu(ev));
    }

    onContextMenu(ev) {
      const menu = new (env().Ug)();
      menu.addItem((item) => item
        .setTitle(ng31PubI18n("publish").optionHideInNavigation())
        .setChecked(this.hidden)
        .onClick(() => {
          this.hidden = !this.hidden;
          const list = this.tree.hiddenItems;
          if (this.hidden) list.push(this.path);
          else {
            const i = list.indexOf(this.path);
            if (i >= 0) list.splice(i, 1);
          }
          this.tree.visibilityChangeCb?.(list);
          this.render();
        }));
      menu.showAtMouseEvent(ev);
    }

    render() {
      this.el.toggleClass("hidden", this.hidden);
      if (this.hidden && !this.tree.showHidden) {
        this.el.hide();
        return;
      }
      this.el.show();
      super.render();
      const refEl = (this.parent && this.parent.childrenEl) || this.tree.childrenEl;
      env().Gc(this.selfEl, this.el, refEl, 10, () => {}, (index) => {
        const siblings = (this.parent && this.parent.children) || this.tree.children;
        const i = siblings.indexOf(this);
        if (i >= 0) siblings.splice(i, 1);
        siblings.splice(index, 0, this);
        this.tree.rebuildNavOrder();
      });
    }
  };
}


export function ng31PublishFolderItem() {
  const Base = env().T7;
  return class Ng31PublishFolderItem extends Base {
    constructor(tree, path) {
      super(tree, path);
      this.type = "folder";
      this.children = [];
      this.selfEl.addClass("mod-folder");
      this.setCollapsible(true);
      this.setClickable(true);
      this.setCollapsed(true, false);
      const title = createDiv("file-tree-item-title");
      title.setText(this.name);
      this.innerEl.appendChild(title);
    }

    onSelfClick() {
      this.toggleCollapsed(true);
    }
  };
}


export function ng31PublishFileItem() {
  const Base = env().T7;
  return class Ng31PublishFileItem extends Base {
    constructor(tree, file) {
      super(tree, file);
      this.type = "file";
      const title = createDiv("tree-item-title");
      title.setText(this.name);
      this.innerEl.appendChild(title);
    }

    render() {
      super.render();
      this.setCollapsible(false);
      this.setClickable(true);
    }
  };
}


// Navigation preview tree: indexes folders/files, owns nav ordering and the
// hidden-items filter. Item classes come from env() (bundle registrations).
export function ng31PublishNavTree() {
  const Base = env().eI;
  return class Ng31PublishNavTree extends Base {
    constructor(publish, containerEl, navOrder, hiddenItems) {
      super(containerEl);
      this.publish = publish;
      this.navOrder = navOrder || [];
      this.hiddenItems = hiddenItems || [];
      this.showHidden = false;
      this.folders = {};
      this.files = {};
      this.orderChangeCb = null;
      this.visibilityChangeCb = null;

      const wrap = createDiv("tree-list-container");
      const header = createDiv("tree-list-header");
      const title = createDiv("tree-list-title");
      title.setText(ng31PubI18n("publish").labelNavigationPreview());
      const label = createDiv("tree-list-action mod-checkbox");
      const input = createEl("input", { attr: { type: "checkbox", tabindex: "-1" } });
      input.addEventListener("click", () => this.setShowHidden(!this.showHidden));
      label.appendChild(input);
      label.append(ng31PubI18n("publish").optionShowHiddenItems());
      header.appendChild(title);
      header.appendChild(label);
      this.childrenEl = createDiv("tree-list");
      wrap.appendChild(header);
      wrap.appendChild(this.childrenEl);
      containerEl.appendChild(wrap);
    }

    setShowHidden(show) {
      this.showHidden = show;
      this.render();
    }

    addChild(item) {
      const parentPath = env().iu(item.path);
      if (parentPath) {
        let folder = this.folders[parentPath];
        if (!folder) {
          folder = new (env().A7)(this, parentPath);
          this.folders[parentPath] = folder;
          this.addChild(folder);
        }
        folder.children.push(item);
        item.parent = folder;
      } else {
        this.addRoot(item);
      }
    }

    createItem(file) {
      const item = new (env().D7)(this, file);
      this.files[file] = item;
      this.addChild(item);
      return item;
    }

    // Emits paths only for levels whose alphabetical order changed; already
    // sorted levels keep their manual order (empty result = default order).
    rebuildNavOrder() {
      const order = [];
      const walk = (items) => {
        const sorted = items.slice();
        env().BQ(sorted, {}, false);
        let changed = false;
        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i] !== items[i]) { changed = true; break; }
        }
        if (changed) for (const it of sorted) order.push(it.path);
        for (const it of items) {
          if (it instanceof env().A7) walk(it.children);
        }
      };
      walk(this.children);
      this.navOrder = order;
      this.orderChangeCb?.(order);
      return order;
    }

    render() {
      const positions = {};
      for (let i = 0; i < this.navOrder.length; i++) positions[this.navOrder[i]] = i;
      env().BQ(this.children, positions);
      const hidden = new Set(this.hiddenItems);
      const mark = (items) => {
        for (const it of items) {
          it.hidden = hidden.has(it.path);
          if (it instanceof env().A7) mark(it.children);
        }
      };
      mark(this.children);
      super.render();
    }
  };
}


// Modal hosting the navigation preview tree with order/visibility resets.
export function ng31PublishNavModal() {
  const Base = env().tb;
  return class Ng31PublishNavModal extends Base {
    constructor(app, plugin, files, navOrder, hiddenItems) {
      super(app);
      this.modalEl.addClass("mod-scrollable-content");
      this.setTitle(ng31PubI18n("publish").labelNavigationModalTitle());

      const resetButton = (onClick) => (b) => b
        .setIcon("lucide-rotate-ccw")
        .setTooltip(env().gm.setting.hotkeys.tooltipRestoreDefault())
        .onClick(onClick);

      new (env().zk)(this.contentEl)
        .setName(ng31PubI18n("publish").optionNavigationOrder())
        .setDesc(ng31PubI18n("publish").labelNavigationModalDesc())
        .addExtraButton(resetButton(() => {
          this.tree.navOrder = [];
          this.tree.orderChangeCb?.([]);
          this.tree.render();
        }));

      this.tree = new (env().P7)(plugin, this.contentEl, navOrder, hiddenItems);
      for (const file of files) this.tree.createItem(file);
      this.tree.render();

      new (env().zk)(this.contentEl)
        .setName(ng31PubI18n("publish").optionHideItemsInNavigation())
        .setDesc(ng31PubI18n("publish").optionHideItemsInNavigationDesc())
        .addExtraButton(resetButton(() => {
          this.tree.hiddenItems = [];
          this.tree.visibilityChangeCb?.([]);
          this.tree.render();
        }));

      const bar = createDiv("modal-button-container");
      const done = createEl("button", { text: env().gm.dialogue.buttonDone() });
      done.addEventListener("click", () => this.close());
      bar.appendChild(done);
      this.modalEl.appendChild(bar);
    }

    onOrderChange(cb) {
      this.tree.orderChangeCb = cb;
      return this;
    }

    onVisibilityChange(cb) {
      this.tree.visibilityChangeCb = cb;
      return this;
    }
  };
}


// Base "exclude folders" picker modal; subclasses implement getPaths/setPaths.
export function ng31ExcludeFoldersModal() {
  const Base = env().nb;
  return class Ng31ExcludeFoldersModal extends Base {
    constructor(app, name, desc, labelI18nKey) {
      super(app);
      this.settingTab = null;
      this.labelI18nKey = labelI18nKey;
      this.displayEl = createEl("p");
      this.contentEl.appendChild(this.displayEl);

      new (env().zk)(this.contentEl)
        .setName(name)
        .setDesc(desc)
        .addText((s) => {
          const input = s.inputEl;
          const submit = () => this.submitFolder(input);
          new (env().PI)(app, input, (folder) =>
            !(this.getPaths() || []).includes(folder.path), true).onSelect(submit);
          input.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" && !ev.isComposing) submit();
          });
        });

      this.addButton("", env().gm.dialogue.buttonDone(), () => this.close());
    }

    async submitFolder(input) {
      const path = env().cu(input.value);
      if (!path) return;
      input.value = "";
      const paths = this.getPaths();
      paths.push(path);
      await this.setPaths(paths);
      this.updateDisplay();
    }

    onOpen() {
      super.onOpen();
      this.updateDisplay();
    }

    onClose() {
      super.onClose();
      this.settingTab.display();
    }

    async updateDisplay() {
      const paths = this.getPaths() || [];
      this.displayEl.textContent = "";
      const summary = env().gm(this.labelI18nKey, {
        folders: env().gm.nouns.folderWithCount({ count: paths.length }),
      });
      this.displayEl.append(summary);
      for (const path of paths) {
        const row = createDiv("sync-exclude-folder");
        const remove = createDiv("sync-exclude-folder-remove clickable-icon");
        env().tv(remove, "lucide-x");
        env().Mv(remove, env().gm.plugins.sync.tooltipRemoveExcludedFolder());
        remove.addEventListener("click", async () => {
          const list = this.getPaths();
          const i = list.indexOf(path);
          if (i >= 0) list.splice(i, 1);
          await this.setPaths(list);
          this.updateDisplay();
        });
        const folderIcon = createEl("span", { cls: "clickable-icon" });
        env().tv(folderIcon, "lucide-folder-open");
        const nameEl = createDiv("sync-exclude-folder-name");
        nameEl.appendChild(createEl("span", { text: path }));
        row.appendChild(remove);
        row.appendChild(folderIcon);
        row.appendChild(nameEl);
        this.displayEl.appendChild(row);
      }
    }
  };
}

