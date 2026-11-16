// Basalt Publish: the built-in publish core plugin and its modal section classes.
// Faithful port of the inherited publish UI: same DOM classes, i18n keys, section
// flow (manage sites -> site options/filters -> review changes -> upload progress)
// and the publish HTTP API surface. App-scope helpers arrive through env()/host.

import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { account, acctRequest, acctInvitePublishShare, acctRemovePublishShare } from "./account.js";
import { debounceCall } from "./timing.js";
import { lastSegment, parentPath, baseName, withoutExtension, extensionOf, withoutMd } from "./path.js";
import { formEncodePath } from "./text.js";
import { utf8String } from "./vault-crypto.js";
import { frontmatterEntry } from "./frontmatter.js";
import { contentHash } from "./metadata-helpers.js";
import { markItemCollapsed } from "./tree.js";
import { toggleElementVisibility } from "./search-view.js";
import { setElementTooltip } from "./tooltip.js";

const E = () => env();
const s15pub = () => E().gm.plugins.publish;

/** Lazy env accessor for declarator replacements that must evaluate in app scope. */
export const s15Env = env;

// ---------------------------------------------------------------- small pieces

/** Error type thrown by the publish API layer ("RequestError" with a string code). */
function PublishRequestError(code, message) {
  const self = Error.call(this, message) || this;
  self.name = "RequestError";
  self.code = code;
  Object.setPrototypeOf(self, PublishRequestError.prototype);
  return self;
}
inherit(PublishRequestError, Error);

/** Sort order for publish tree items: folders first, then by display name (replaces Q7). */
export function s15PublishItemSort(a, b) {
  const Folder = publishClasses(builtHost).$7;
  const aFolder = a instanceof Folder;
  const bFolder = b instanceof Folder;
  if (aFolder || bFolder) {
    if (aFolder && !bFolder) return -1;
    if (bFolder && !aFolder) return 1;
  }
  return E().ub(a.name, b.name);
}

/** Live-site base URL; the bundle rewrites it to a local server in dev builds (Hf flag). */
export const s15PublishUrl = "https://publish.basalt.md";

/** Static assets the publish site serves (kept in sync with the site build). */
export const s15PublishAssets = ["basalt.css", "publish.css", "favicon.ico", "publish.js"];

// mD: run `fn` while showing the shared loading overlay inside `el`.
function s15WithLoading(el, fn) { return E().mD(el, fn); }

// ---------------------------------------------------------------- the builder

let built = null;
let builtHost = null;

function buildPublishClasses(host) {
  // -- modal section base ----------------------------------------------------
  function PublishModalSection(parentModal) {
    this.title = null;
    this.el = null;
    this.parentModal = parentModal;
    this.el = parentModal.contentEl.createDiv();
    this.hide();
  }
  PublishModalSection.prototype.show = function () { this.el.show(); };
  PublishModalSection.prototype.hide = function () { this.el.hide(); };

  // -- offline / login sections ----------------------------------------------
  function PublishOfflineSection(parentModal) {
    const self = PublishModalSection.call(this, parentModal) || this;
    self.el.createEl("p", { text: s15pub().labelNoInternetAccess() });
    return self;
  }
  inherit(PublishOfflineSection, PublishModalSection);

  function PublishLoginSection(parentModal) {
    const self = PublishModalSection.call(this, parentModal) || this;
    self.el.createEl("p", { text: s15pub().labelPublishServiceDescription() });
    self.el.createEl("p", { text: s15pub().labelPleaseLogin() });
    self.el.createDiv("modal-button-container", (el) => {
      el.createEl("button", {
        cls: "mod-cta",
        text: E().gm.setting.account.linkSignUpNow(),
        onclick: () => window.open("https://github.com/FalconTechDev/basalt", "_blank"),
      });
      el.createEl("button", {
        text: E().gm.setting.account.buttonLogin(),
        onclick: () => {
          const app = self.parentModal.app;
          self.parentModal.close();
          new (E().R7)(app).setCloseCallback(() => self.parentModal.open()).open();
        },
      });
    });
    return self;
  }
  inherit(PublishLoginSection, PublishModalSection);

  // -- file tree --------------------------------------------------------------
  function PublishTreeItemBase(section) {
    const self = E().JL.call(this) || this;
    self.visible = true;
    self.children = null;
    self.section = section;
    self.innerEl.addClass("file-tree-item");
    return self;
  }
  PublishTreeItemBase.prototype.setChecked = function () {};
  PublishTreeItemBase.prototype.setVisible = function (visible) {
    this.visible = visible;
    this.el.toggle(visible);
  };
  PublishTreeItemBase.prototype.applyQuery = function () {};
  PublishTreeItemBase.prototype.updateCheckedRecursive = function () {
    for (let p = this.parent; p;) { p.updateChecked(); p = p.parent; }
    this.section.updateChecked();
  };
  inherit(PublishTreeItemBase, E().JL);

  function PublishFolderItem(section, path) {
    const self = PublishTreeItemBase.call(this, section) || this;
    self.children = [];
    self.path = path;
    self.name = lastSegment(path);
    self.setCollapsible(true);
    const inner = self.innerEl;
    self.selfEl.addClass("mod-folder");
    self.checkboxEl = inner.createEl("input", { cls: "file-tree-item-checkbox", type: "checkbox" });
    self.checkboxEl.addEventListener("change", self.updateChecked.bind(self));
    E().tv(inner.createDiv("file-tree-item-icon"), "lucide-folder-open");
    inner.createDiv({ cls: "file-tree-item-title", text: self.name });
    return self;
  }
  PublishFolderItem.prototype.getChecked = function () {
    let count = 0, checked = 0;
    for (const child of this.children) {
      if (child instanceof PublishFileItem) {
        count++;
        if (child.diff.checked) checked++;
      } else if (child instanceof PublishFolderItem) {
        const sub = child.getChecked();
        count += sub.count;
        checked += sub.checked;
      }
    }
    return { count, checked };
  };
  PublishFolderItem.prototype.onSelfClick = function () {
    const { count, checked } = this.getChecked();
    if (count === 0) return;
    const value = checked < count;
    for (const child of this.children) child.setChecked(value);
    this.updateChecked();
    this.updateCheckedRecursive();
  };
  PublishFolderItem.prototype.setChecked = function (value) {
    for (const child of this.children) child.setChecked(value);
    this.updateChecked();
  };
  PublishFolderItem.prototype.updateChecked = function () {
    const { count, checked } = this.getChecked();
    const all = count > 0 && checked === count;
    this.checkboxEl.checked = all;
    this.checkboxEl.indeterminate = !all && checked > 0;
    this.selfEl.toggleClass("is-selected", all);
  };
  PublishFolderItem.prototype.applyQuery = function (query) {
    let any = false;
    for (const child of this.children) {
      child.applyQuery(query);
      any = any || child.visible;
    }
    this.setVisible(any);
  };
  PublishFolderItem.prototype.render = function () {
    this.children.sort(s15PublishItemSort);
    PublishTreeItemBase.prototype.render.call(this);
    this.setClickable(true);
  };
  inherit(PublishFolderItem, PublishTreeItemBase);

  function PublishFileItem(section, diff) {
    const self = PublishTreeItemBase.call(this, section) || this;
    self.diff = diff;
    self.path = diff.path;
    let name = lastSegment(diff.path);
    const ext = extensionOf(name);
    if (ext === "md") name = baseName(name);
    self.name = name;
    const selfEl = self.selfEl;
    const innerEl = self.innerEl;
    selfEl.addClass("mod-file", "mod-" + diff.type);
    self.checkboxEl = innerEl.createEl("input", { cls: "file-tree-item-checkbox", type: "checkbox" });
    self.checkboxEl.addEventListener("change", self.updateChecked.bind(self));
    E().tv(innerEl.createDiv("file-tree-item-icon"), "lucide-file");
    innerEl.createDiv({ cls: "file-tree-item-title", text: name });
    self.updateChecked();
    innerEl.createDiv("tree-item-flair-outer").createSpan({
      cls: "tree-item-flair",
      text: diff.type === "to-delete" ? "To delete" : diff.type,
    });
    if (diff.type === "changed" && (ext === "md" || ext === "css" || ext === "js")) {
      innerEl.createDiv("clickable-icon", (el) => {
        E().tv(el, "lucide-columns");
        setElementTooltip(el, s15pub().labelCompareWithLive());
      }).addEventListener("click", (ev) => {
        ev.preventDefault();
        new PublishCompareModal(self.section.publish.app, self.section.publish, self.path).open();
      });
    }
    selfEl.addEventListener("contextmenu", self.onContextMenu.bind(self));
    return self;
  }
  PublishFileItem.prototype.onSelfClick = function () {
    this.setChecked(!this.diff.checked);
    this.updateCheckedRecursive();
  };
  PublishFileItem.prototype.setChecked = function (value) {
    if (this.diff.checked !== value) {
      this.diff.checked = value;
      this.updateChecked();
    }
  };
  PublishFileItem.prototype.updateChecked = function () {
    const checked = this.diff.checked;
    this.checkboxEl.checked = checked;
    this.selfEl.toggleClass("is-selected", checked);
  };
  PublishFileItem.prototype.applyQuery = function (query) {
    this.setVisible(this.diff.checked || this.path.toLowerCase().includes(query));
  };
  PublishFileItem.prototype.render = function () {
    PublishTreeItemBase.prototype.render.call(this);
    this.setCollapsible(false);
    this.setClickable(true);
  };
  PublishFileItem.prototype.onContextMenu = async function (event) {
    event.preventDefault();
    const menu = new E().Ug();
    const diff = this.diff;
    const type = diff.type;
    const path = diff.path;
    const app = this.section.publish.app;
    const slug = await this.section.publish.getCurrentSlug();
    if (type === "changed" || type === "deleted" || type === "to-delete") {
      menu.addItem((item) => item.setIcon("lucide-globe").setTitle(s15pub().labelOpenInLiveSite())
        .onClick(() => window.open(s15PublishUrl + "/" + slug + "/" + formEncodePath(withoutMd(path)))));
    }
    if (type === "changed" || type === "new" || type === "to-delete") {
      menu.addItem((item) => item.setIcon("lucide-folder-open").setTitle(s15pub().labelOpenFile())
        .onClick(() => {
          const leaf = app.workspace.getLeaf();
          const file = app.vault.getAbstractFileByPath(path);
          if (file && file instanceof E().$T) {
            leaf.openFile(file, { active: true });
            this.section.publish.modal.close();
          }
        }));
    }
    if (type === "changed") {
      menu.addItem((item) => item.setIcon("lucide-columns").setTitle(s15pub().labelCompareWithLive())
        .onClick(() => new PublishCompareModal(app, this.section.publish, path).open()));
    }
    if (type === "changed" || type === "deleted") {
      menu.addItem((item) => item.setIcon("lucide-pencil").setTitle(s15pub().buttonUseLiveVersion())
        .onClick(async () => {
          const data = await this.section.publish.apiDownloadFile(path);
          const file = app.vault.getAbstractFileByPath(path);
          if (file && file instanceof E().$T) {
            new PublishConfirmModal(app, file, this.section.publish.modal, data).open();
            return;
          }
          const dir = parentPath(path);
          const missing = dir ? !(await app.vault.exists(dir)) : false;
          if (missing) await app.vault.createFolder(dir);
          await app.vault.createBinary(path, data);
          new (E().fb)(s15pub().messageSuccessfullyUsedLiveVersion());
          await this.section.publish.modal.reviewChangesSection.show();
        }));
    }
    menu.showAtMouseEvent(event);
  };
  inherit(PublishFileItem, PublishTreeItemBase);

  // The base tree section (eI) supplies children/childrenEl/render/addRoot/clear.
  const TreeSectionBase = E().eI;
  function PublishTreeSection(publish, parentEl, title) {
    const self = TreeSectionBase.call(this, parentEl) || this;
    self.children = [];
    self.collapsed = false;
    self.folders = {};
    self.files = {};
    self.publish = publish;
    const sectionEl = parentEl.createDiv("file-tree publish-section");
    const headerEl = sectionEl.createDiv("publish-section-header");
    self.childrenEl = sectionEl.createDiv("publish-change-list");
    self.sectionEl = sectionEl;
    self.headerEl = headerEl;
    headerEl.createDiv("publish-section-header-toggle-collapsed-button collapse-icon", (el) => {
      E().tv(el, "right-triangle");
      el.addEventListener("click", () => self.toggleCollapsed(true));
    });
    headerEl.createDiv({ cls: "publish-section-header-text", text: title }, (el) => {
      el.addEventListener("click", () => self.toggleCollapsed(true));
    });
    self.selectedEl = headerEl.createDiv("publish-section-header-selected", (el) => {
      self.selectedCountEl = el.createSpan({ cls: "publish-section-header-selected-count", text: "0" });
      el.createSpan({ text: s15pub().labelFileSelected() });
    });
    headerEl.createDiv({ cls: "publish-section-header-action button", text: s15pub().buttonSelectAllFiles() })
      .addEventListener("click", self.checkAll.bind(self));
    headerEl.createDiv({ cls: "publish-section-header-action", text: s15pub().buttonDeselectAllFiles() })
      .addEventListener("click", self.uncheckAll.bind(self));
    return self;
  }
  PublishTreeSection.prototype.toggleCollapsed = async function (animate) {
    await this.setCollapsed(!this.collapsed, animate);
  };
  PublishTreeSection.prototype.setCollapsed = async function (collapsed, animate) {
    if (this.collapsed === collapsed) return;
    this.collapsed = collapsed;
    markItemCollapsed(this.sectionEl, collapsed);
    await toggleElementVisibility(this.childrenEl, collapsed, animate);
  };
  PublishTreeSection.prototype.collapseAll = function () {
    const stack = this.children.slice();
    while (stack.length > 0) {
      const item = stack.pop();
      if (item.children) {
        item.toggleCollapsed(false);
        stack.push(...item.children);
      }
    }
  };
  PublishTreeSection.prototype.checkAll = function () {
    for (const child of this.children) child.setChecked(true);
    this.updateChecked();
  };
  PublishTreeSection.prototype.uncheckAll = function () {
    for (const child of this.children) child.setChecked(false);
    this.updateChecked();
  };
  PublishTreeSection.prototype.updateChecked = function () {
    const files = this.files;
    const countEl = this.selectedCountEl;
    let selected = 0, total = 0;
    for (const path in files) {
      if (!files.hasOwnProperty(path)) continue;
      if (files[path].diff.checked) selected++;
      total++;
    }
    countEl.setText(selected + "/" + total);
    this.selectedEl.toggleClass("u-pop", selected > 0);
  };
  PublishTreeSection.prototype.addChild = function (item) {
    const folderPath = parentPath(item.path);
    if (folderPath) {
      let folder = this.folders[folderPath];
      if (!folder) {
        folder = this.folders[folderPath] = new PublishFolderItem(this, folderPath);
        this.addChild(folder);
      }
      folder.children.push(item);
      item.parent = folder;
    } else {
      this.addRoot(item);
    }
  };
  PublishTreeSection.prototype.createItem = function (diff) {
    const item = new PublishFileItem(this, diff);
    this.files[diff.path] = item;
    this.addChild(item);
  };
  PublishTreeSection.prototype.render = function () {
    this.children.sort(s15PublishItemSort);
    TreeSectionBase.prototype.render.call(this);
    this.updateChecked();
  };
  PublishTreeSection.prototype.applyQuery = function (query) {
    for (const child of this.children) child.applyQuery(query);
  };
  PublishTreeSection.prototype.clear = function () {
    TreeSectionBase.prototype.clear.call(this);
    this.folders = {};
    this.files = {};
    this.updateChecked();
  };
  inherit(PublishTreeSection, TreeSectionBase);

  // -- path suggest ------------------------------------------------------------
  function PublishPathSuggest(app, inputEl) {
    const self = host.FilePathSuggest.call(this, app, inputEl) || this;
    return self;
  }
  PublishPathSuggest.prototype.selectSuggestion = function (suggestion) {
    const input = this.textInputEl;
    this.setValue(suggestion.item.path);
    input.trigger("input");
    this.close();
  };
  PublishPathSuggest.prototype.filePredicate = function (file) {
    return E().Vy.contains(file.extension);
  };
  inherit(PublishPathSuggest, host.FilePathSuggest);

  // -- review changes ------------------------------------------------------------
  function PublishReviewSection(parentModal) {
    const self = PublishModalSection.call(this, parentModal) || this;
    self.title = s15pub().name();
    self.siteOptionsEl = null;
    self.siteFiltersEl = null;
    self.noChangesEl = null;
    self.pathToDiffMap = {};
    self.currentlyPublishedToSiteNameEl = null;
    self.filterComponent = null;
    self.app = parentModal.app;
    self.el.createDiv({ cls: "publish-changes-info" }, (info) => {
      info.createDiv({ cls: "publish-changes-info-publishing-to", text: s15pub().labelPublishingTo() });
      self.currentlyPublishedToSiteNameEl = info.createEl("a", "publish-changes-current-site-name");
      self.currentlyPublishedToSiteNameEl.setAttribute("target", "_blank");
      info.createDiv("publish-changes-switch-site", (row) => {
        row.createSpan("clickable-icon", (el) => {
          E().tv(el, "lucide-repeat");
          setElementTooltip(el, s15pub().tooltipSwitchSite());
          el.addEventListener("click", async () => {
            const modal = self.parentModal;
            await modal.openSection(modal.manageSitesSection);
          });
        });
        self.siteOptionsEl = row.createSpan("clickable-icon", (el) => {
          E().tv(el, "lucide-settings");
          setElementTooltip(el, s15pub().tooltipOpenSiteOptions());
          el.addEventListener("click", () => {
            const modal = self.parentModal;
            modal.openSection(modal.siteOptionsSection);
          });
        });
        self.siteFiltersEl = row.createSpan("clickable-icon", (el) => {
          E().tv(el, "lucide-filter");
          setElementTooltip(el, s15pub().tooltipManagePublishFilters());
          el.addEventListener("click", () => {
            const modal = self.parentModal;
            modal.openSection(modal.siteFiltersSection);
          });
        });
        row.createSpan("clickable-icon", (el) => {
          E().tv(el, "lucide-life-buoy");
          setElementTooltip(el, s15pub().tooltipContactSupport());
          el.addEventListener("click", () => window.open("https://github.com/FalconTechDev/basalt/issues"));
        });
      });
      self.filterComponent = new host.SearchComponent(info)
        .setPlaceholder(E().gm.setting.hotkeys.promptFilter());
      info.createEl("button", { cls: "publish-changes-add-linked-btn", text: s15pub().buttonAddLinked() }, (el) => {
        setElementTooltip(el, s15pub().tooltipAddLinked());
        el.addEventListener("click", async () => {
          const app = self.app;
          const cache = app.metadataCache;
          const map = self.pathToDiffMap;
          const paths = [];
          for (const path in map) {
            if (!map.hasOwnProperty(path)) continue;
            const diff = map[path];
            if (diff.checked && diff.type !== "deleted") paths.push(path);
          }
          const linked = new Set();
          const collect = (path) => {
            E().ST(cache.getCache(path), (link) => {
              const dest = cache.getFirstLinkpathDest(link.link, path);
              if (dest) linked.add(dest.path);
            });
          };
          for (const path of paths) collect(path);
          let added = 0;
          const sectionNew = self.sectionNew;
          for (const path in map) {
            if (!map.hasOwnProperty(path)) continue;
            if (!linked.has(path)) continue;
            const diff = map[path];
            if (diff.checked || diff.type !== "new") continue;
            const item = sectionNew.files[path];
            if (item) {
              item.setChecked(true);
              item.updateCheckedRecursive();
              added++;
            }
          }
          new (E().fb)(s15pub().msgAddedLinkedFiles({ count: added }));
        });
      });
    });
    self.noChangesEl = self.el.createEl("p", { text: s15pub().labelNoChangesDetected() });
    const container = self.el.createDiv("publish-sections-container");
    self.sectionChanged = new PublishTreeSection(parentModal.plugin, container, s15pub().labelChangedFilesToBePublished());
    self.sectionUnchanged = new PublishTreeSection(parentModal.plugin, container, s15pub().labelUnchangedFilesAlreadyPublished());
    self.sectionNew = new PublishTreeSection(parentModal.plugin, container, s15pub().labelNewFilesToBePublished());
    const buttons = self.el.createDiv("modal-button-container");
    buttons.createEl("button", { cls: "mod-cta", text: s15pub().buttonPublish() }, (el) => {
      el.addEventListener("click", self.uploadChanges.bind(self));
    });
    buttons.createEl("button", { text: E().gm.dialogue.buttonCancel() }, (el) => {
      el.addEventListener("click", self.parentModal.close.bind(self.parentModal));
    });
    return self;
  }
  PublishReviewSection.prototype.setCurrentSiteName = function (slug) {
    this.currentlyPublishedToSiteNameEl.setText(slug);
    this.currentlyPublishedToSiteNameEl.setAttribute("href", s15PublishUrl + "/" + slug);
  };
  PublishReviewSection.prototype.show = async function () {
    const modal = this.parentModal;
    this.pathToDiffMap = {};
    modal.plugin.getCurrentSlug().then((slug) => this.setCurrentSiteName(slug));
    let changes;
    try {
      changes = await modal.plugin.scanForChanges();
      this.noChangesEl.toggle(changes.length === 0);
    } catch (error) {
      modal.handleError(error);
      return;
    }
    const changed = this.sectionChanged;
    const unchanged = this.sectionUnchanged;
    const fresh = this.sectionNew;
    changed.clear();
    unchanged.clear();
    fresh.clear();
    for (const diff of changes) {
      this.pathToDiffMap[diff.path] = diff;
      if (diff.type === "changed" || diff.type === "deleted") changed.createItem(diff);
      else if (diff.type === "new") fresh.createItem(diff);
      else if (diff.type === "to-delete") unchanged.createItem(diff);
    }
    this.filterComponent.onChange((value) => {
      const query = value.trim().toLowerCase();
      changed.applyQuery(query);
      unchanged.applyQuery(query);
      fresh.applyQuery(query);
    });
    if (changed.children.length > 0) {
      unchanged.setCollapsed(true, false);
      fresh.setCollapsed(true, false);
      for (const path in changed.files) {
        if (!changed.files.hasOwnProperty(path)) continue;
        const item = changed.files[path];
        if (item.diff.type !== "deleted") item.setChecked(true);
      }
      for (const folderPath in changed.folders) {
        if (!changed.folders.hasOwnProperty(folderPath)) continue;
        changed.folders[folderPath].updateChecked();
      }
    } else {
      changed.setCollapsed(true, false);
      unchanged.setCollapsed(true, false);
    }
    changed.render();
    unchanged.collapseAll();
    unchanged.render();
    fresh.collapseAll();
    fresh.render();
    await PublishModalSection.prototype.show.call(this);
  };
  PublishReviewSection.prototype.uploadChanges = async function () {
    const map = this.pathToDiffMap;
    const changes = [];
    for (const path in map) {
      if (!map.hasOwnProperty(path)) continue;
      const diff = map[path];
      if (diff.checked) changes.push(diff);
    }
    if (changes.length === 0) {
      new (E().fb)(s15pub().msgSelectAtLeastOneFile());
      return;
    }
    await this.parentModal.uploadChanges(changes);
  };
  inherit(PublishReviewSection, PublishModalSection);

  // -- upload progress ------------------------------------------------------------
  function PublishUploadSection(parentModal) {
    const self = PublishModalSection.call(this, parentModal) || this;
    self.title = s15pub().labelUploadChanges();
    self.changesContainer = null;
    self.doneButton = null;
    self.successMessageEl = null;
    self.siteLinkEl = null;
    self.runnable = null;
    self.changes = [];
    self.pathToEl = {};
    self.changesContainer = self.el.createDiv("list-item-parent upload-progress-container");
    self.successMessageEl = self.el.createDiv({}, (el) => {
      el.createEl("p", { text: s15pub().labelClearCache() });
      el.createEl("p", { text: s15pub().labelVisitSite() }, (linkEl) => {
        self.siteLinkEl = linkEl.createEl("a");
        self.siteLinkEl.setAttribute("target", "_blank");
      });
    });
    self.successMessageEl.hide();
    self.el.createDiv("modal-button-container", (el) => {
      self.doneButton = el.createEl("button", { cls: "mod-cta", text: s15pub().buttonDone() }, (btn) => {
        btn.addEventListener("click", () => {
          if (self.runnable) {
            self.runnable.cancel();
            self.runnable = null;
          } else {
            self.parentModal.close();
          }
        });
      });
      el.createEl("button", { text: s15pub().buttonGoBack() }, (btn) => {
        btn.addEventListener("click", () => {
          if (self.runnable) self.runnable.cancel();
          self.parentModal.openReviewChanges();
        });
      });
    });
    return self;
  }
  PublishUploadSection.prototype.addChanges = function (changes) { this.changes = changes; };
  PublishUploadSection.prototype.show = async function () {
    if (this.runnable) this.runnable.cancel();
    await PublishModalSection.prototype.show.call(this);
    this.successMessageEl.hide();
    this.changesContainer.removeClass("is-finished");
    this.doneButton.addClass("mod-warning");
    this.doneButton.setText(s15pub().buttonStop());
    this.changesContainer.empty();
    this.pathToEl = {};
    for (const change of this.changes) {
      this.pathToEl[change.path] = this.changesContainer.createDiv("publish-upload-item list-item", (row) => {
        row.createDiv("list-item-part", (el) => E().tv(el, "lucide-file"));
        row.createDiv({ cls: "list-item-part mod-extended publish-upload-item-title", text: withoutExtension(change.path) });
        row.createDiv("list-item-part", (el) => {
          const flair = el.createSpan("flair");
          if (change.type === "new" || change.type === "changed") flair.setText(s15pub().labelStatusToPublish());
          else if (change.type === "deleted") flair.setText(s15pub().labelStatusToDelete());
        });
      });
    }
    this.startUpload();
  };
  PublishUploadSection.prototype.startUpload = async function () {
    const modal = this.parentModal;
    const app = modal.app;
    const plugin = modal.plugin;
    const runnable = this.runnable = new E().bb({
      onStop: async () => {
        this.doneButton.removeClass("mod-warning");
        this.doneButton.setText(s15pub().buttonDone());
        const slug = await plugin.getCurrentSlug();
        const url = s15PublishUrl + "/" + slug;
        this.siteLinkEl.setText(url);
        this.siteLinkEl.setAttribute("href", url);
        this.successMessageEl.show();
        this.changesContainer.addClass("is-finished");
        if (this.runnable === runnable) this.runnable = null;
      },
    });
    runnable.start();
    const changes = this.changes;
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      const row = this.pathToEl[change.path];
      const flair = row.find(".flair");
      if (runnable.isCancelled()) {
        flair.setText(s15pub().labelStatusCancelled());
        row.addClass("mod-failed", "mod-completed");
        continue;
      }
      try {
        flair.setText(s15pub().labelStatusUploading());
        if (change.type === "deleted" || change.type === "to-delete") {
          await plugin.apiRemoveFile(change.path);
          flair.setText(s15pub().labelStatusDeleted());
        } else {
          const file = app.vault.getAbstractFileByPath(change.path);
          if (file && file instanceof E().$T) {
            await plugin.apiUploadFile(file);
            flair.setText(s15pub().labelStatusPublished());
          }
        }
        row.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (error) {
        modal.handleError(error);
        flair.setText(s15pub().labelStatusFailed());
        row.addClass("mod-failed");
      }
      row.addClass("mod-completed");
    }
    runnable.stop();
  };
  inherit(PublishUploadSection, PublishModalSection);

  // -- edit site id -----------------------------------------------------------------
  function PublishEditSlugSection(parentModal) {
    const self = PublishModalSection.call(this, parentModal) || this;
    self.title = s15pub().tooltipEditSiteId();
    self.newSlug = null;
    self.site = null;
    self.slugInputEl = null;
    new host.Setting(self.el).setName(s15pub().optionSiteId()).setDesc(s15pub().optionSiteIdDescription())
      .addText((text) => {
        text.setPlaceholder(s15pub().optionSiteIdPlaceholder())
          .onChange((value) => { self.newSlug = value.toLowerCase(); });
        self.slugInputEl = text.inputEl;
      }).setClass("site-list-site-id-setting");
    self.el.createEl("p", "modal-button-container", (el) => {
      el.createEl("button", { cls: "mod-cta", text: s15pub().buttonChange() }, (btn) => {
        btn.addEventListener("click", async () => {
          const plugin = parentModal.plugin;
          try {
            await plugin.apiSetSlug(self.site.id, self.site.host, self.newSlug);
          } catch (error) {
            parentModal.handleError(error);
            return;
          }
          await parentModal.openSection(parentModal.siteOptionsSection);
        });
      });
      el.createEl("button", { text: E().gm.dialogue.buttonCancel() }, (btn) => {
        btn.addEventListener("click", async () => {
          await parentModal.openSection(parentModal.manageSitesSection);
        });
      });
    });
    return self;
  }
  PublishEditSlugSection.prototype.setSiteInfo = function (site) { this.site = site; };
  PublishEditSlugSection.prototype.setExistingSlug = function (slug) { this.slugInputEl.value = slug; };
  inherit(PublishEditSlugSection, PublishModalSection);

  // -- passwords ---------------------------------------------------------------------
  function PublishPasswordsSection(parentModal) {
    const self = PublishModalSection.call(this, parentModal) || this;
    self.title = s15pub().labelManagePasswords();
    self.passwords = null;
    self.updateDisplay();
    return self;
  }
  PublishPasswordsSection.prototype.setPasswords = function (passwords) { this.passwords = passwords; };
  PublishPasswordsSection.prototype.updateDisplay = function () {
    const self = this;
    const el = this.el;
    el.empty();
    if (this.passwords === null) {
      el.createEl("p", { cls: "u-muted", text: s15pub().labelNoPassword() });
    } else {
      let index = 0;
      el.createEl("p", { cls: "u-muted", text: s15pub().labelHavePassword() });
      el.createEl("hr");
      const list = el.createDiv("passwords-container");
      const render = (entry) => {
        list.createDiv("list-item password-item", (row) => {
          row.createDiv({ cls: "list-item-part", text: entry.name || s15pub().labelUntitledPassword() });
          row.createDiv({ cls: "u-muted u-small list-item-part mod-extended", text: s15pub().labelPasswordCreatedTime({ time: window.moment(entry.ts).fromNow() }) });
          row.createDiv("list-item-part clickable-icon", (icon) => {
            E().tv(icon, "lucide-x");
            setElementTooltip(icon, E().gm.dialogue.buttonDelete());
            const current = index;
            icon.addEventListener("click", async () => {
              await self.parentModal.plugin.apiDelPassword(current);
              await self.parentModal.showPasswords();
            });
            index += 1;
          });
        });
      };
      for (const entry of this.passwords) render(entry);
    }
    el.createDiv("modal-button-container", (buttons) => {
      buttons.createEl("button", { cls: "mod-cta", text: s15pub().actionNewPassword() }, (btn) => {
        btn.addEventListener("click", () => self.parentModal.openAddPassword());
      });
      buttons.createEl("button", { text: s15pub().buttonGoBack() }, (btn) => {
        btn.addEventListener("click", async () => {
          const modal = self.parentModal;
          modal.openSection(modal.siteOptionsSection);
        });
      });
    });
  };
  inherit(PublishPasswordsSection, PublishModalSection);

  function PublishAddPasswordSection(parentModal) {
    const self = PublishModalSection.call(this, parentModal) || this;
    self.title = s15pub().labelAddPassword();
    self.passwordFieldEl = null;
    self.nicknameFieldEl = null;
    new host.Setting(self.el).setName(s15pub().optionPasswordName()).setDesc(s15pub().optionPasswordDesc())
      .addText((text) => text.setPlaceholder(s15pub().optionPasswordPlaceholder()).then((t) => {
        t.inputEl.setAttribute("type", "password");
        self.passwordFieldEl = t.inputEl;
      }));
    new host.Setting(self.el).setName(s15pub().optionNicknameName()).setDesc(s15pub().optionNicknameDesc())
      .addText((text) => { self.nicknameFieldEl = text.inputEl; });
    self.el.createDiv("modal-button-container", (el) => {
      el.createEl("button", { text: s15pub().actionAddPassword(), cls: "mod-cta" }, (btn) => {
        btn.addEventListener("click", async () => {
          try {
            const password = self.passwordFieldEl.value;
            const nickname = self.nicknameFieldEl.value;
            await self.parentModal.plugin.apiAddPassword(nickname, password);
          } catch (error) {
            self.parentModal.handleError(error);
            return;
          }
          new (E().fb)(s15pub().msgAddedNewPassword());
          await self.parentModal.showPasswords();
        });
      });
      el.createEl("button", { text: s15pub().buttonGoBack() }, (btn) => {
        btn.addEventListener("click", async () => {
          await self.parentModal.showPasswords();
        });
      });
    });
    return self;
  }
  PublishAddPasswordSection.prototype.show = async function () {
    this.passwordFieldEl.value = "";
    this.nicknameFieldEl.value = "";
    await PublishModalSection.prototype.show.call(this);
  };
  inherit(PublishAddPasswordSection, PublishModalSection);

  // -- custom domain ------------------------------------------------------------------
  function PublishCustomDomainSection() {
    const self = PublishModalSection.apply(this, arguments) || this;
    self.title = s15pub().labelConfigureCustomDomain();
    return self;
  }
  PublishCustomDomainSection.prototype.show = async function () {
    const el = this.el;
    el.empty();
    await PublishModalSection.prototype.show.call(this);
    const current = await this.parentModal.plugin.apiCustomUrl();
    let urlInput, redirectToggle;
    new host.Setting(el).setName(s15pub().optionCustomUrlName()).setDesc(s15pub().optionCustomUrlDesc())
      .addText((text) => { urlInput = text.setPlaceholder("example.com").setValue(current.url || ""); });
    new host.Setting(el).setName(s15pub().optionCustomUrlRedirect()).setDesc(s15pub().optionCustomUrlRedirectDesc())
      .addToggle((toggle) => { redirectToggle = toggle.setValue(current.redirect); });
    const instructions = s15pub().labelCustomDomainInstructions({
      link: '<a href="https://github.com/FalconTechDev/basalt/wiki" target="_blank">' + s15pub().labelCustomDomainLinkName() + "</a>",
    });
    this.el.createEl("p", { cls: "u-muted" }, (p) => { p.innerHTML = instructions; });
    this.el.createDiv("modal-button-container", (buttons) => {
      buttons.createEl("button", { text: s15pub().buttonUpdateCustomDomain(), cls: "mod-cta" }, (btn) => {
        btn.addEventListener("click", async () => {
          try {
            await this.parentModal.plugin.apiCustomUrl(urlInput.getValue(), redirectToggle.getValue());
          } catch (error) {
            this.parentModal.handleError(error);
            return;
          }
          const modal = this.parentModal;
          modal.openSection(modal.siteOptionsSection);
        });
      });
      buttons.createEl("button", { text: s15pub().buttonGoBack() }, (btn) => {
        btn.addEventListener("click", async () => {
          const modal = this.parentModal;
          modal.openSection(modal.siteOptionsSection);
        });
      });
    });
  };
  inherit(PublishCustomDomainSection, PublishModalSection);

  // -- manage sites ---------------------------------------------------------------------
  function PublishManageSitesSection(parentModal) {
    const self = PublishModalSection.call(this, parentModal) || this;
    self.title = s15pub().labelManageSites();
    self.slugInputEl = null;
    return self;
  }
  PublishManageSitesSection.prototype.show = async function () {
    const modal = this.parentModal;
    const plugin = modal.plugin;
    const app = modal.app;
    const el = this.el;
    el.empty();
    let sitesData;
    try {
      sitesData = await acctRequest("/publish/list", { token: account.token });
    } catch (error) {
      modal.handleError(error);
      return;
    }
    const sites = sitesData.sites;
    const shared = sitesData.shared;
    const limit = sitesData.limit;
    new host.Setting(el).setName(s15pub().labelYourSites()).setHeading();
    const listEl = el.createDiv("site-list-container");
    const allIds = sites.map((s) => s.id).concat(shared.map((s) => s.id));
    let slugs = {};
    try {
      slugs = await plugin.apiGetSlugs(allIds);
    } catch (error) {
      console.error(error);
    }
    const renderSite = (site) => {
      listEl.createDiv("site-list-item list-item", (row) => {
        const slug = slugs[site.id] || site.id;
        row.createDiv({ cls: "list-item-part mod-extended", text: slug });
        row.createEl("button", { text: s15pub().buttonChoose() }, (btn) => {
          btn.addEventListener("click", async () => {
            await plugin.setup(site.id, site.host);
            await modal.openReviewChanges();
          });
        });
        row.createDiv("clickable-icon", (icon) => {
          E().tv(icon, "lucide-edit-3");
          setElementTooltip(icon, s15pub().tooltipEditSiteId());
          icon.addEventListener("click", () => modal.editSlug(site, slugs[site.id] || ""));
        });
        row.createDiv("clickable-icon", (icon) => {
          E().tv(icon, "lucide-x");
          setElementTooltip(icon, s15pub().tooltipDeleteSite());
          icon.addEventListener("click", () => {
            const frag = document.createDocumentFragment();
            frag.createEl("p", { text: s15pub().labelDeleteSiteConfirmation() });
            frag.createEl("p", { cls: "setting-message mod-warning", text: s15pub().labelDeleteSiteDetails() });
            new host.ButtonModal(app).setTitle(s15pub().labelConfirmDeleteSite({ site: slug }))
              .setContent(frag)
              .addButton("mod-warning", E().gm.dialogue.buttonDelete(), () => modal.deleteSite(site.id))
              .addCancelButton()
              .open();
          });
        });
      });
    };
    if (sites.length === 0 && limit !== 0) {
      listEl.createDiv("site-empty-state u-center-text", (el2) => {
        el2.createEl("p", { text: s15pub().labelNoSites() });
      });
    } else {
      for (const site of sites) renderSite(site);
    }
    if (sites.length < limit) {
      new host.Setting(el).setName(s15pub().optionSiteId()).setDesc(s15pub().optionSiteIdDescription())
        .addText((text) => {
          text.setPlaceholder(s15pub().optionSiteIdPlaceholder());
          text.inputEl.addEventListener("keydown", (ev) => {
            if (ev.isComposing || ev.key !== "Enter") return;
            this.createSite();
          });
          this.slugInputEl = text.inputEl;
        }).setClass("site-list-site-id-setting");
      el.createDiv("u-center-text", (wrap) => {
        wrap.createEl("button", { text: s15pub().buttonCreate(), cls: "mod-cta" }, (btn) => {
          btn.addEventListener("click", this.createSite.bind(this));
        });
      });
    } else if (limit === 0) {
      listEl.createDiv("list-item", (row) => {
        row.createDiv({ cls: "list-item-part mod-extended u-muted", text: s15pub().labelNoSitesBought() });
        row.createEl("button", { cls: "list-item-part mod-cta", text: s15pub().buttonGetSite() }, (btn) => {
          btn.addEventListener("click", () => window.open("https://github.com/FalconTechDev/basalt", "_blank"));
        });
      });
    } else {
      const siteWord = E().gm.nouns.siteWithCount({ count: limit });
      listEl.createDiv("list-item", (row) => {
        row.createDiv({ cls: "list-item-part mod-extended u-muted", text: s15pub().labelSiteUsage({ site: sites.length.toString(), limit: siteWord }) });
        row.createEl("button", { cls: "list-item-part mod-cta", text: s15pub().buttonAddMoreSites() }, (btn) => {
          btn.addEventListener("click", () => window.open("https://github.com/FalconTechDev/basalt", "_blank"));
        });
      });
    }
    if (shared.length > 0) {
      new host.Setting(el).setName(s15pub().labelSitesSharedWithYou()).setHeading();
      const shareList = el.createDiv("site-list-container");
      const renderShared = (share) => {
        shareList.createDiv("site-list-item list-item", (row) => {
          const slug = slugs[share.id] || share.id;
          row.createDiv({ cls: "list-item-part mod-extended", text: slug });
          row.createEl("button", { text: s15pub().buttonChoose() }, (btn) => {
            btn.addEventListener("click", async () => {
              await plugin.setup(share.id, share.host);
              await modal.openReviewChanges();
            });
          });
          row.createDiv("clickable-icon", (icon) => {
            E().tv(icon, "lucide-x");
            setElementTooltip(icon, s15pub().tooltipLeaveSiteSharing());
            icon.addEventListener("click", () => {
              const frag = document.createDocumentFragment();
              frag.createEl("p", { cls: "setting-message mod-warning", text: s15pub().labelLeaveSiteConfirmationDetails() });
              frag.createEl("p", { text: s15pub().labelLeaveSiteConfirmationDetails_2() });
              new host.ButtonModal(app).setTitle(s15pub().labelLeaveSiteConfirmation({ site: slug }))
                .setContent(frag)
                .addButton("mod-warning", s15pub().buttonLeave(), () => modal.deleteSiteShare(share.id, share.share_uid))
                .addCancelButton()
                .open();
            });
          });
        });
      };
      for (const share of shared) renderShared(share);
    }
    await PublishModalSection.prototype.show.call(this);
  };
  PublishManageSitesSection.prototype.createSite = async function () {
    const modal = this.parentModal;
    const plugin = modal.plugin;
    modal.hideError();
    const slug = this.slugInputEl.value.toLowerCase();
    if (!/^[a-z0-9\-]+$/.test(slug)) {
      modal.showError(s15pub().msgInvalidSiteId());
      return;
    }
    let checkError;
    try {
      await plugin.apiCheckSlug(slug);
      modal.showError(s15pub().msgSiteIdInUse());
      return;
    } catch (error) {
      checkError = error;
    }
    if (!(checkError instanceof PublishRequestError && checkError.code === "NOTFOUND")) {
      modal.handleError(checkError);
      return;
    }
    try {
      const created = await acctRequest("/publish/create", { token: account.token });
      await plugin.apiSetSlug(created.id, created.host, slug);
      await plugin.setup(created.id, created.host);
      await modal.openReviewChanges();
    } catch (error) {
      modal.handleError(error);
    }
  };
  inherit(PublishManageSitesSection, PublishModalSection);

  // -- site options -----------------------------------------------------------------------
  const OPTION_KEYS = ["$Y", "JY", "QY", "XY", "YY", "ZY", "aQ", "cQ", "dQ", "eQ", "hQ", "iQ", "lQ", "nQ", "oQ", "pQ", "rQ", "sQ", "tQ", "uQ"];
  function optionKey(name) { return E()[name]; }
  function optionDefault(name) { return E().dQ[name]; }

  function PublishSiteOptionsSection() {
    const self = PublishModalSection.apply(this, arguments) || this;
    self.title = s15pub().labelSiteOptions();
    return self;
  }
  PublishSiteOptionsSection.prototype.show = async function () {
    const el = this.el;
    const modal = this.parentModal;
    const plugin = modal.plugin;
    const app = modal.app;
    el.empty();
    let options;
    try {
      options = await plugin.apiOptions();
    } catch (error) {
      modal.handleError(error);
      el.createDiv("modal-button-container", (buttons) => {
        buttons.createEl("button", { text: s15pub().buttonGoBack() }, (btn) => {
          btn.addEventListener("click", async () => {
            await modal.openReviewChanges();
          });
        });
      });
      return;
    }
    const changed = {};
    const read = (key) => (options.hasOwnProperty(key) ? options[key] : optionDefault(key));
    const container = el.createDiv("publish-site-settings-container");
    const K = (n) => optionKey(n);
    new host.Setting(container).setName(s15pub().optionSiteGeneral()).setHeading();
    new host.Setting(container).setName(s15pub().optionSiteName()).setDesc(s15pub().optionSiteNameDescription())
      .addText((text) => text.setPlaceholder(s15pub().optionSiteNamePlaceholder()).setValue(read(K("QY"))).onChange((v) => { changed[K("QY")] = v; }));
    new host.Setting(container).setName(s15pub().optionHomePageFile()).setDesc(s15pub().optionHomePageFileDescription())
      .addText((text) => {
        text.setPlaceholder(s15pub().optionHomePageFilePlaceholder()).setValue(read(K("YY"))).onChange((v) => { changed[K("YY")] = v; });
        new E().TI(app, text.inputEl);
      });
    new host.Setting(container).setName(s15pub().optionLogo()).setDesc(s15pub().optionLogoDescription())
      .addText((text) => {
        text.setPlaceholder(s15pub().optionLogoPlaceholder()).setValue(read(K("XY"))).onChange((v) => { changed[K("XY")] = v; });
        new PublishPathSuggest(app, text.inputEl);
      });
    if (!plugin.isGuest) {
      new host.Setting(container).setName(s15pub().optionSiteCollaboration()).setDesc(s15pub().optionSiteCollaborationDesc())
        .addButton((btn) => btn.setButtonText(s15pub().buttonManageCollaborators()).onClick(async () => {
          const slug = await plugin.getCurrentSlug();
          new PublishShareModal(app, slug, plugin.siteId).open();
        }));
      new host.Setting(container).setName(s15pub().optionCustomDomain()).setDesc(s15pub().optionCustomDomainDesc())
        .addButton((btn) => btn.setButtonText(s15pub().buttonConfigure()).onClick(async () => {
          await modal.openSection(modal.configureCustomDomainSection);
        }));
      new host.Setting(container).setName(s15pub().optionNoindex()).setDesc(s15pub().optionNoindexDesc())
        .addToggle((toggle) => toggle.setValue(read(K("$Y"))).onChange((v) => { changed[K("$Y")] = v; }));
    }
    new host.Setting(container).setName(s15pub().optionSiteAppearance()).setHeading();
    new host.Setting(container).setName(s15pub().optionTheme()).setDesc(s15pub().optionThemeDescription())
      .addDropdown((dd) => dd.addOption("light", E().gm.setting.appearance.lightTheme())
        .addOption("dark", E().gm.setting.appearance.darkTheme())
        .addOption("system", s15pub().optionThemeSystem())
        .setValue(read(K("ZY"))).onChange((v) => { changed[K("ZY")] = v; }));
    new host.Setting(container).setName(s15pub().optionShowThemeToggle()).setDesc(s15pub().optionShowThemeToggleDescription())
      .addToggle((toggle) => toggle.setValue(read(K("JY"))).onChange((v) => { changed[K("JY")] = v; }));
    new host.Setting(container).setName(s15pub().optionSiteReadingExperience()).setHeading();
    new host.Setting(container).setName(s15pub().optionHoverPreviewFile()).setDesc(s15pub().optionHoverPreviewFileDescription())
      .addToggle((toggle) => toggle.setValue(read(K("lQ"))).onChange((v) => { changed[K("lQ")] = v; }));
    new host.Setting(container).setName(s15pub().optionHideTitle()).setDesc(s15pub().optionHideTitleDescription())
      .addToggle((toggle) => toggle.setValue(read(K("oQ"))).onChange((v) => { changed[K("oQ")] = v; }));
    new host.Setting(container).setName(s15pub().optionReadableLineLength()).setDesc(s15pub().optionReadableLineLengthDescription())
      .addToggle((toggle) => toggle.setValue(read(K("aQ"))).onChange((v) => { changed[K("aQ")] = v; }));
    new host.Setting(container).setName(E().gm.setting.editor.optionStrictLineBreak()).setDesc(E().gm.setting.editor.optionStrictLineBreakDescription())
      .addToggle((toggle) => toggle.setValue(read(K("sQ"))).onChange((v) => { changed[K("sQ")] = v; }));
    new host.Setting(container).setName(s15pub().optionSlidingWindowMode()).setDesc(s15pub().optionSlidingWindowModeDescription())
      .addToggle((toggle) => toggle.setValue(read(K("uQ"))).onChange((v) => { changed[K("uQ")] = v; }));
    new host.Setting(container).setName(s15pub().optionSiteComponents()).setHeading();
    new host.Setting(container).setName(s15pub().optionShowNavigation()).setDesc(s15pub().optionShowNavigationDescription())
      .addToggle((toggle) => toggle.setValue(read(K("eQ"))).onChange((v) => { changed[K("eQ")] = v; }));
    new host.Setting(container).setName(s15pub().optionCustomizeNavigation()).setDesc(s15pub().optionCustomizeNavigationDesc())
      .addButton((btn) => btn.setButtonText(s15pub().buttonCustomizeSidebar()).onClick(async () => {
        let paths = [];
        try {
          const list = await plugin.apiList();
          for (const file of list.files) paths.push(file.path);
        } catch (error) {
          modal.handleError(error);
        }
        const order = read(K("hQ"));
        const hidden = read(K("pQ"));
        new (E().x7)(app, plugin, paths, order, hidden)
          .onOrderChange((v) => { changed[K("hQ")] = v; })
          .onVisibilityChange((v) => { changed[K("pQ")] = v; })
          .open();
      }));
    new host.Setting(container).setName(s15pub().optionShowSearch()).setDesc(s15pub().optionShowSearchDescription())
      .addToggle((toggle) => toggle.setValue(read(K("iQ"))).onChange((v) => { changed[K("iQ")] = v; }));
    new host.Setting(container).setName(s15pub().optionShowGraph()).setDesc(s15pub().optionShowGraphDescription())
      .addToggle((toggle) => toggle.setValue(read(K("tQ"))).onChange((v) => { changed[K("tQ")] = v; }));
    new host.Setting(container).setName(s15pub().optionShowOutline()).setDesc(s15pub().optionShowOutlineDescription())
      .addToggle((toggle) => toggle.setValue(read(K("nQ"))).onChange((v) => { changed[K("nQ")] = v; }));
    new host.Setting(container).setName(s15pub().optionShowBacklinks()).setDesc(s15pub().optionShowBacklinksDescription())
      .addToggle((toggle) => toggle.setValue(read(K("cQ"))).onChange((v) => { changed[K("cQ")] = v; }));
    if (!plugin.isGuest) {
      new host.Setting(container).setName(s15pub().optionSiteMisc()).setHeading();
      new host.Setting(container).setName(s15pub().optionSitePassword()).setDesc(s15pub().optionSitePasswordDescription())
        .addButton((btn) => btn.setButtonText(s15pub().buttonManagePasswords()).onClick(async () => {
          await modal.showPasswords();
        }));
      new host.Setting(container).setName(s15pub().optionGoogleAnalytics()).setDesc(s15pub().optionGoogleAnalyticsDescription())
        .addText((text) => text.setPlaceholder("UA-XXXXX-Y or G-XXXXXXXX").setValue(read(K("rQ")))
          .onChange((v) => { changed[K("rQ")] = v; }).inputEl.style.width = "200px");
    }
    el.createDiv("modal-button-container", (buttons) => {
      buttons.createEl("button", { text: s15pub().buttonSaveSiteSettings(), cls: "mod-cta" }, (btn) => {
        btn.addEventListener("click", async () => {
          try {
            await plugin.apiOptions(changed);
          } catch (error) {
            modal.handleError(error);
            return;
          }
          new (E().fb)(s15pub().msgUpdatedOptions());
          await modal.openReviewChanges();
        });
      });
      buttons.createEl("button", { text: s15pub().buttonGoBack() }, (btn) => {
        btn.addEventListener("click", async () => {
          await modal.openReviewChanges();
        });
      });
    });
    await PublishModalSection.prototype.show.call(this);
  };
  inherit(PublishSiteOptionsSection, PublishModalSection);

  // -- site filters -------------------------------------------------------------------------
  function PublishSiteFiltersSection() {
    const self = PublishModalSection.apply(this, arguments) || this;
    self.title = s15pub().labelSiteOptions();
    return self;
  }
  PublishSiteFiltersSection.prototype.show = async function () {
    const el = this.el;
    const modal = this.parentModal;
    const plugin = modal.plugin;
    const app = modal.app;
    const section = this;
    el.empty();
    const container = el.createDiv("publish-site-settings-container");
    new host.Setting(container).setName(s15pub().optionIncludedFolders())
      .setDesc(createFragment((frag) => {
        frag.appendText(s15pub().optionIncludedFoldersDesc());
        if (plugin.includes.length > 0) {
          frag.appendText(s15pub().optionCurrentlyIncludedFolders());
          const list = frag.createEl("ul");
          for (const folder of plugin.includes) list.createEl("li", { text: folder });
        }
      }))
      .addButton((btn) => btn.setButtonText(E().gm.interface.buttonManage()).onClick(() => {
        new PublishIncludedFoldersModal(app, plugin, section).open();
      }));
    new host.Setting(container).setName(s15pub().optionExcludedFolders())
      .setDesc(createFragment((frag) => {
        frag.appendText(s15pub().optionExcludedFoldersDesc());
        if (plugin.excludes.length > 0) {
          frag.appendText(E().gm.plugins.sync.optionCurrentlyExcludedFolders());
          const list = frag.createEl("ul");
          for (const folder of plugin.excludes) list.createEl("li", { text: folder });
        }
      }))
      .addButton((btn) => btn.setButtonText(E().gm.interface.buttonManage()).onClick(() => {
        new PublishExcludedFoldersModal(app, plugin, section).open();
      }));
    el.createDiv("modal-button-container", (buttons) => {
      buttons.createEl("button", { cls: "mod-cta", text: E().gm.dialogue.buttonDone() }, (btn) => {
        btn.addEventListener("click", async () => {
          await modal.openReviewChanges();
        });
      });
    });
    await PublishModalSection.prototype.show.call(this);
  };
  inherit(PublishSiteFiltersSection, PublishModalSection);

  // -- sharing modal ------------------------------------------------------------------------------
  function PublishShareModal(app, siteName, siteId) {
    const self = host.ButtonModal.call(this, app) || this;
    self.shares = [];
    self.siteId = siteId;
    self.setTitle(s15pub().labelManageSharing({ name: siteName }));
    self.addButton("", E().gm.dialogue.buttonDone(), () => self.close());
    self.display();
    return self;
  }
  PublishShareModal.prototype.display = async function () {
    const self = this;
    this.contentEl.empty();
    try {
      const data = await s15WithLoading(this.contentEl, () => acctRequest("/publish/share/list", { token: account.token, site_uid: this.siteId }));
      this.shares = data.shares;
    } catch (error) {
      new (E().fb)(error.message);
      return;
    }
    if (this.shares.length > 0) {
      this.contentEl.createEl("p", { cls: "u-muted", text: s15pub().labelSharingWithUsers() });
      const list = this.contentEl.createDiv();
      const render = (share) => {
        list.createDiv("list-item", (row) => {
          if (share.name) {
            row.createDiv({ cls: "list-item-part", text: share.name });
            row.createDiv({ cls: "list-item-part mod-extended", text: "<" + share.email + ">" });
          } else {
            row.createDiv({ cls: "list-item-part mod-extended", text: share.email });
          }
          if (!share.accepted) {
            row.createDiv({ cls: "list-item-part" }, (el) => {
              el.createSpan({ cls: "u-muted", text: s15pub().labelInvitePending() });
            });
          }
          row.createDiv("list-item-part", (icon) => {
            E().tv(icon, "lucide-x");
            setElementTooltip(icon, s15pub().tooltipRemoveUser());
            icon.addEventListener("click", async () => {
              try {
                await s15WithLoading(self.contentEl, () => acctRemovePublishShare(account.token, self.siteId, share.uid));
              } catch (error) {
                new (E().fb)(error.message);
              }
              await self.display();
            });
          });
        });
      };
      for (const share of this.shares) render(share);
    } else {
      this.contentEl.createEl("p", { cls: "u-muted", text: s15pub().labelNotSharing() });
    }
    let input;
    new host.Setting(this.contentEl).setName(s15pub().optionInviteUser())
      .addText((text) => text.setPlaceholder(s15pub().placeholderInviteUser()).then((t) => {
        input = t;
        t.inputEl.addEventListener("keydown", (ev) => {
          if (ev.isComposing || ev.key !== "Enter") return;
          self.inviteToSite(t.getValue());
        });
      }))
      .addButton((btn) => btn.setButtonText(E().gm.interface.buttonAdd()).setCta().onClick(() => {
        self.inviteToSite(input.getValue());
      }));
  };
  PublishShareModal.prototype.inviteToSite = async function (email) {
    email = email.trim();
    if (email === "" || !email.includes("@")) {
      new (E().fb)(s15pub().errorEmailMustBeValid());
      return;
    }
    await acctInvitePublishShare(account.token, this.siteId, email);
    await this.display();
  };
  inherit(PublishShareModal, host.ButtonModal);

  // -- compare / confirm modals ---------------------------------------------------------------------
  function PublishCompareModal(app, publish, path) {
    const self = host.ButtonModal.call(this, app) || this;
    self.path = path;
    self.publish = publish;
    return self;
  }
  PublishCompareModal.prototype.onOpen = async function () {
    const app = this.app;
    const path = this.path;
    const publish = this.publish;
    const file = app.vault.getAbstractFileByPath(path);
    const data = await publish.apiDownloadFile(path);
    const ext = extensionOf(lastSegment(path));
    this.setTitle(s15pub().labelCompareWithLive());
    this.contentEl.style.overflow = "auto";
    if (ext === "md") {
      const text = utf8String(data);
      let local = "";
      if (file && file instanceof E().$T) local = await app.vault.cachedRead(file);
      this.contentEl.appendChild(E().RX(text, local));
    } else if (E().Vy.contains(ext)) {
      if (file && file instanceof E().$T) {
        await E().xc(this.contentEl, app.vault.getResourcePath(file));
      } else {
        const blob = new Blob([new Uint8Array(data)], { type: "image/" + ext });
        const url = URL.createObjectURL(blob);
        await E().xc(this.contentEl, url);
        URL.revokeObjectURL(url);
      }
    }
    if (file instanceof E().$T) {
      this.addButton("", s15pub().buttonUseLiveVersion(), () => {
        new PublishConfirmModal(app, file, publish.modal, data).open();
      });
    }
    const doneModal = new host.ButtonModal(app);
    this.addButton("mod-cta", s15pub().buttonDone(), () => doneModal.close());
  };
  inherit(PublishCompareModal, host.ButtonModal);

  function PublishConfirmModal(app, file, publishModal, data) {
    const self = host.ButtonModal.call(this, app) || this;
    self.setTitle(s15pub().labelConfirmOverride());
    self.contentEl.createEl("p", { text: s15pub().labelConfirmOverride_1() });
    self.contentEl.createEl("p", { text: s15pub().labelConfirmOverride_2() });
    self.addButton("mod-warning", s15pub().buttonProceed(), async () => {
      if (file && file instanceof E().$T) {
        await app.vault.modifyBinary(file, data);
        new (E().fb)(s15pub().messageSuccessfullyUsedLiveVersion());
        await publishModal.reviewChangesSection.show();
      }
      self.close();
    });
    self.addButton("", E().gm.dialogue.buttonCancel(), () => self.close());
    return self;
  }
  inherit(PublishConfirmModal, host.ButtonModal);

  // -- folder pickers (share the sync excluded-folder modal base V7) -------------------------------------
  const FolderPickerBase = E().V7;
  function PublishIncludedFoldersModal(app, publish, section) {
    const self = FolderPickerBase.call(this, app, s15pub().labelAddIncludedFolder(), s15pub().labelAddIncludedFolderDesc(), "plugins.publish.label-number-of-folders-included") || this;
    self.publish = publish;
    self.section = section;
    self.titleEl.setText(s15pub().labelManageIncludedFolders());
    return self;
  }
  PublishIncludedFoldersModal.prototype.onClose = function () { this.section.show(); };
  PublishIncludedFoldersModal.prototype.getPaths = function () { return this.publish.includes; };
  PublishIncludedFoldersModal.prototype.setPaths = async function (paths) {
    await this.publish.setIncludes(paths);
  };
  inherit(PublishIncludedFoldersModal, FolderPickerBase);

  function PublishExcludedFoldersModal(app, publish, section) {
    const self = FolderPickerBase.call(this, app, E().gm.plugins.sync.labelAddExcludedFolder(), E().gm.plugins.sync.labelAddExcludedFolderDesc(), "plugins.publish.label-number-of-folders-excluded") || this;
    self.publish = publish;
    self.section = section;
    self.titleEl.setText(E().gm.plugins.sync.labelManageExcludedFolders());
    return self;
  }
  PublishExcludedFoldersModal.prototype.onClose = function () { this.section.show(); };
  PublishExcludedFoldersModal.prototype.getPaths = function () { return this.publish.excludes; };
  PublishExcludedFoldersModal.prototype.setPaths = async function (paths) {
    await this.publish.setExcludes(paths);
  };
  inherit(PublishExcludedFoldersModal, FolderPickerBase);

  // -- the plugin -------------------------------------------------------------------------------------
  function PublishPlugin() {
    this.id = "publish";
    this.name = s15pub().name();
    this.description = s15pub().desc();
    this.app = null;
    this.vault = null;
    this.plugin = null;
    this.siteId = null;
    this.host = null;
    this.isGuest = null;
    this.includes = [];
    this.excludes = [];
    this.modal = null;
    this.requestSaveData = debounceCall(this.saveData.bind(this), 2000);
  }
  PublishPlugin.prototype.init = function (app, plugin) {
    this.app = app;
    this.vault = app.vault;
    this.plugin = plugin;
    plugin.registerRibbonItem(s15pub().actionPublishChanges(), "lucide-send", this.openPublishChanges.bind(this));
    plugin.registerGlobalCommand({ id: "publish:view-changes", name: s15pub().actionPublishChanges(), icon: "lucide-send", callback: this.openPublishChanges.bind(this) });
    plugin.registerGlobalCommand({
      id: "publish:publish-file",
      name: s15pub().actionPublishFile(),
      icon: "lucide-send",
      checkCallback: (checking) => {
        if (!this.siteId) return false;
        const file = app.workspace.getActiveFile();
        if (!file || !this.isFileSupported(file) || this.getPublishFlag(file) === false) return false;
        if (!checking) this.uploadFile(file);
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "publish:open-in-live-site",
      name: s15pub().labelOpenInLiveSite(),
      icon: "lucide-globe",
      checkCallback: (checking) => {
        if (!this.siteId) return false;
        const file = app.workspace.getActiveFile();
        if (!file || !this.isFileSupported(file) || this.getPublishFlag(file) === false) return false;
        if (!checking) {
          this.getCurrentSlug().then((slug) => {
            window.open(s15PublishUrl + "/" + slug + "/" + formEncodePath(withoutMd(file.path)));
          });
        }
        return true;
      },
    });
  };
  PublishPlugin.prototype.onEnable = async function (app, plugin) {
    await this.loadData();
    plugin.registerCliHandler("publish:open", "Open file on published site",
      { file: { value: "<name>", description: "File name" }, path: { value: "<path>", description: "File path" } },
      async (args) => {
        if (!this.siteId) throw new Error("No publish site configured.");
        let file;
        if (args.file || args.path) file = app.cli.tryResolveFile(args);
        else if (!(file = app.workspace.getActiveFile())) throw new Error("No active file.");
        const list = await this.apiList();
        if (!list.files.some((f) => f.path === file.path)) throw new Error("File is not published.");
        const slug = await this.getCurrentSlug();
        const url = s15PublishUrl + "/" + slug + "/" + formEncodePath(withoutMd(file.path));
        window.open(url);
        return url;
      });
    plugin.registerCliHandler("publish:status", "List publish changes",
      { total: { description: "Return change count" }, new: { description: "Show new files only" }, changed: { description: "Show changed files only" }, deleted: { description: "Show deleted files only" } },
      async (args) => {
        if (!this.siteId) throw new Error("No publish site configured.");
        let changes = await this.scanForChanges();
        changes = args.new ? changes.filter((c) => c.type === "new")
          : args.changed ? changes.filter((c) => c.type === "changed")
          : args.deleted ? changes.filter((c) => c.type === "deleted")
          : changes.filter((c) => c.type !== "to-delete");
        if (args.total) return String(changes.length);
        if (changes.length === 0) return "No changes.";
        return changes.map((c) => c.type + "\t" + c.path).join("\n");
      });
    plugin.registerCliHandler("publish:list", "List published files",
      { total: { description: "Return published file count" } },
      async (args) => {
        if (!this.siteId) throw new Error("No publish site configured.");
        const list = await this.apiList();
        if (args.total) return String(list.files.length);
        return list.files.map((f) => f.path).sort().join("\n");
      });
    plugin.registerCliHandler("publish:site", "Show publish site info", null,
      async () => {
        if (!this.siteId) throw new Error("No publish site configured.");
        const slug = await this.getCurrentSlug();
        const custom = await this.apiCustomUrl();
        const lines = [];
        lines.push("slug\t" + slug);
        lines.push("url\t" + s15PublishUrl + "/" + slug);
        if (custom.url) lines.push("custom\t" + custom.url);
        return lines.join("\n");
      });
    plugin.registerCliHandler("publish:add", "Publish a file or all changed files",
      { file: { value: "<name>", description: "File name" }, path: { value: "<path>", description: "File path" }, changed: { description: "Publish all changed files" } },
      async (args) => {
        if (!this.siteId) throw new Error("No publish site configured.");
        if (args.changed) {
          const changes = await this.scanForChanges();
          const uploadable = changes.filter((c) => c.type === "new" || c.type === "changed");
          if (uploadable.length === 0) return "No changes to publish.";
          const done = [], failed = [];
          for (const change of uploadable) {
            const file = this.vault.getFileByPath(change.path);
            if (!file) continue;
            try {
              await this.apiUploadFile(file);
              done.push(change.path);
            } catch (error) {
              failed.push(change.path);
            }
          }
          if (failed.length > 0) return "Published " + done.length + " files, " + failed.length + " failed:\n" + failed.join("\n");
          return "Published " + done.length + " files:\n" + done.join("\n");
        }
        let file;
        if (args.file || args.path) file = app.cli.tryResolveFile(args);
        else if (!(file = app.workspace.getActiveFile())) throw new Error("No active file.");
        if (!this.isFileSupported(file)) throw new Error("File type not supported for publishing.");
        if (this.getPublishFlag(file) === false) throw new Error("File is excluded from publishing (publish: false in frontmatter).");
        await this.apiUploadFile(file);
        return "Published: " + file.path;
      });
    plugin.registerCliHandler("publish:remove", "Unpublish a file",
      { file: { value: "<name>", description: "File name" }, path: { value: "<path>", description: "File path" } },
      async (args) => {
        if (!this.siteId) throw new Error("No publish site configured.");
        let file;
        if (args.file || args.path) file = app.cli.tryResolveFile(args);
        else if (!(file = app.workspace.getActiveFile())) throw new Error("No active file.");
        await this.apiRemoveFile(file.path);
        return "Unpublished: " + file.path;
      });
    plugin.registerEvent(app.workspace.on("file-menu", (menu, file, source) => {
      if (!(file instanceof E().$T)) return;
      if (source !== "tab-header" && source !== "more-options" && source !== "file-explorer-context-menu") return;
      if (!this.isFileSupported(file) || this.getPublishFlag(file) === false) return;
      menu.addItem((item) => item.setSection("action").setTitle(s15pub().actionPublishFile())
        .setIcon("lucide-send").onClick(() => this.uploadFile(file)));
    }), this);
  };
  PublishPlugin.prototype.onDisable = function () { this.modal = null; };
  PublishPlugin.prototype.loadData = async function () {
    const data = await this.plugin.loadData();
    if (!data) return;
    try {
      this.siteId = data.siteId;
      this.host = data.host;
      this.includes = data.included || [];
      this.excludes = data.excluded || [];
    } catch (error) {
      console.error(error);
    }
  };
  PublishPlugin.prototype.saveData = async function () {
    await this.plugin.saveData({
      siteId: this.siteId,
      host: this.host,
      included: this.includes,
      excluded: this.excludes,
    });
  };
  PublishPlugin.prototype.setup = async function (siteId, host) {
    this.siteId = siteId;
    this.host = host;
    await this.saveData();
  };
  PublishPlugin.prototype.setIncludes = async function (includes) {
    this.includes = includes;
    await this.saveData();
  };
  PublishPlugin.prototype.setExcludes = async function (excludes) {
    this.excludes = excludes;
    await this.saveData();
  };
  PublishPlugin.prototype.getHost = function () {
    const host = this.host || "127.0.0.1:3002";
    if (host.startsWith("127.0.0.1") || host.startsWith("localhost")) return "http://" + host;
    return "https://" + host;
  };
  PublishPlugin.prototype.isFileSupported = function (file) {
    return E().Ky.includes(file.extension) || s15PublishAssets.includes(file.name);
  };
  PublishPlugin.prototype.scanForChanges = async function () {
    const vault = this.vault;
    const changes = [];
    const remote = await this.apiList();
    this.isGuest = !remote.owner;
    const remoteByPath = {};
    const files = remote.files;
    for (const entry of files) {
      const path = entry.path;
      remoteByPath[path] = entry;
      const local = vault.getAbstractFileByPath(path);
      if (local && local instanceof E().$T) {
        const flag = this.getPublishFlag(local);
        if (flag === false) {
          changes.push({ path, ctime: entry.ctime, mtime: entry.mtime, size: entry.size, type: "deleted", checked: false });
        } else {
          const hash = await this.getHash(local);
          if (hash !== entry.hash) {
            changes.push({ path, ctime: entry.ctime, mtime: entry.mtime, size: entry.size, type: "changed", checked: flag === true });
          } else {
            changes.push({ path, ctime: entry.ctime, mtime: entry.mtime, size: entry.size, type: "to-delete", checked: false });
          }
        }
      } else {
        changes.push({ path, ctime: entry.ctime, mtime: entry.mtime, size: entry.size, type: "deleted", checked: false });
      }
    }
    const stack = [vault.getRoot()];
    while (stack.length) {
      const node = stack.pop();
      if (node instanceof E().ZT) {
        for (const child of node.children) stack.push(child);
      } else if (node instanceof E().$T && this.isFileSupported(node) && !remoteByPath.hasOwnProperty(node.path)) {
        const flag = this.getPublishFlag(node);
        if (flag === false) continue;
        changes.push({ path: node.path, ctime: 0, mtime: 0, size: 0, type: "new", checked: flag === true });
      }
    }
    return changes;
  };
  PublishPlugin.prototype.apiRequest = async function (request) {
    let text;
    try {
      text = await E().ajaxPromise(request);
    } catch (error) {
      if (error instanceof XMLHttpRequest) throw new PublishRequestError("NET", "Network unavailable.");
      if (error instanceof Error) throw new PublishRequestError("NET", error.message);
      throw new PublishRequestError("NET", "Unknown");
    }
    const data = JSON.parse(text);
    if (data.code && data.message) throw new PublishRequestError(data.code, data.message);
    return data;
  };
  PublishPlugin.prototype.apiPostFrontend = function (path, body) {
    body.token = account.token;
    return this.apiRequest({ method: "POST", url: s15PublishUrl + "/" + path, data: body });
  };
  PublishPlugin.prototype.apiPostBackend = function (path, body) {
    body.id = this.siteId;
    body.token = account.token;
    return this.apiRequest({ method: "POST", url: this.getHost() + "/" + path, data: body });
  };
  PublishPlugin.prototype.apiSetSlug = function (id, host, slug) {
    return this.apiPostFrontend("api/slug", { id, host, slug });
  };
  PublishPlugin.prototype.apiGetSlugs = function (ids) {
    return this.apiPostFrontend("api/slugs", { ids });
  };
  PublishPlugin.prototype.apiCheckSlug = function (slug) {
    return this.apiPostFrontend("api/site", { slug });
  };
  PublishPlugin.prototype.apiCustomUrl = function (url, redirect) {
    return this.apiPostFrontend("api/customurl", { id: this.siteId, host: this.host, url, redirect });
  };
  PublishPlugin.prototype.apiList = function () {
    return this.apiPostBackend("api/list", { version: 2 });
  };
  PublishPlugin.prototype.apiOptions = function (options) {
    return this.apiPostBackend("api/options", { options });
  };
  PublishPlugin.prototype.apiGetPassword = function () {
    return this.apiPostBackend("api/password", {});
  };
  PublishPlugin.prototype.apiAddPassword = function (name, pw) {
    return this.apiPostBackend("api/password", { name, pw });
  };
  PublishPlugin.prototype.apiDelPassword = function (del) {
    return this.apiPostBackend("api/password", { del });
  };
  PublishPlugin.prototype.apiRemoveFile = function (path) {
    return this.apiPostBackend("api/remove", { path });
  };
  PublishPlugin.prototype.apiUploadFile = async function (file) {
    if (file.stat.size > 52428800) throw new PublishRequestError("TOOLARGE", "Failed to upload file over limit of 50mb.");
    const hash = await this.getHash(file);
    const data = await this.vault.readBinary(file);
    const headers = { "obs-token": account.token, "obs-id": this.siteId, "obs-path": encodeURIComponent(file.path), "obs-hash": hash };
    return this.apiRequest({ method: "POST", url: this.getHost() + "/api/upload", headers, data });
  };
  PublishPlugin.prototype.apiDownloadFile = async function (path) {
    const body = { id: this.siteId, token: account.token, path };
    const response = await fetch(this.getHost() + "/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.arrayBuffer();
  };
  PublishPlugin.prototype.getCurrentSlug = async function () {
    const siteId = this.siteId;
    try {
      const slugs = await this.apiGetSlugs([siteId]);
      return slugs[siteId];
    } catch (error) {
      return siteId;
    }
  };
  PublishPlugin.prototype.getHash = function (file) {
    const cached = this.getHashFromMetadataCache(file);
    if (cached) return Promise.resolve(cached);
    return this.computeHash(file);
  };
  PublishPlugin.prototype.getPublishFlag = function (file) {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return null;
    let flag = frontmatterEntry(cache.frontmatter, "publish");
    if (flag != null) {
      if (typeof flag === "string") {
        flag = flag.toLowerCase();
        if (flag === "false" || flag === "no") return false;
        if (flag === "true" || flag === "yes") return true;
      }
      return !!flag;
    }
    for (const prefix of this.excludes) {
      if (file.path.startsWith(prefix + "/")) return false;
    }
    for (const prefix of this.includes) {
      if (file.path.startsWith(prefix + "/")) return true;
    }
    return null;
  };
  PublishPlugin.prototype.getHashFromMetadataCache = function (file) {
    const info = this.app.metadataCache.getFileInfo(file.path);
    if (info && info.mtime === file.stat.mtime && info.size === file.stat.size) return info.hash;
    return null;
  };
  PublishPlugin.prototype.computeHash = async function (file) {
    const data = await this.vault.readBinary(file);
    return contentHash(data);
  };
  PublishPlugin.prototype.openModal = function (autoLoad) {
    let modal = this.modal;
    if (!modal) {
      modal = this.modal = new (E().z7)(this.app, this);
    }
    if (autoLoad) modal.autoLoad(autoLoad(modal));
    modal.open();
  };
  PublishPlugin.prototype.openPublishChanges = function () { this.openModal(); };
  PublishPlugin.prototype.viewSites = function () {
    this.openModal((modal) => modal.manageSitesSection);
  };
  PublishPlugin.prototype.uploadFile = function (file) {
    this.openModal((modal) => {
      modal.uploadProgressSection.addChanges([{ path: file.path, ctime: 0, mtime: 0, size: 0, type: "new", checked: true }]);
      return modal.uploadProgressSection;
    });
  };

  return {
    j7: PublishModalSection,
    U7: PublishOfflineSection,
    W7: PublishLoginSection,
    _7: PublishManageSitesSection,
    G7: PublishSiteOptionsSection,
    K7: PublishSiteFiltersSection,
    Y7: PublishTreeItemBase,
    X7: PublishFileItem,
    $7: PublishFolderItem,
    Z7: PublishTreeSection,
    q7: PublishPathSuggest,
    J7: PublishReviewSection,
    e9: PublishUploadSection,
    t9: PublishEditSlugSection,
    n9: PublishPasswordsSection,
    i9: PublishAddPasswordSection,
    r9: PublishCustomDomainSection,
    o9: PublishShareModal,
    a9: PublishCompareModal,
    s9: PublishConfirmModal,
    l9: PublishIncludedFoldersModal,
    c9: PublishExcludedFoldersModal,
    p9: PublishRequestError,
    f9: PublishPlugin,
  };
}

function publishClasses(host) {
  if (host) builtHost = host;
  if (!built) built = buildPublishClasses(builtHost);
  return built;
}

// One exported factory per replaced declarator; all share the single builder so the
// classes can reference each other exactly like the original single-scope code did.
export function definePublishSection(host) { return publishClasses(host).j7; }
export function definePublishOfflineSection(host) { return publishClasses(host).U7; }
export function definePublishLoginSection(host) { return publishClasses(host).W7; }
export function definePublishManageSitesSection(host) { return publishClasses(host)._7; }
export function definePublishSiteOptionsSection(host) { return publishClasses(host).G7; }
export function definePublishSiteFiltersSection(host) { return publishClasses(host).K7; }
export function definePublishTreeItemBase(host) { return publishClasses(host).Y7; }
export function definePublishFileItem(host) { return publishClasses(host).X7; }
export function definePublishFolderItem(host) { return publishClasses(host).$7; }
export function definePublishTreeSection(host) { return publishClasses(host).Z7; }
export function definePublishPathSuggest(host) { return publishClasses(host).q7; }
export function definePublishReviewSection(host) { return publishClasses(host).J7; }
export function definePublishUploadSection(host) { return publishClasses(host).e9; }
export function definePublishEditSlugSection(host) { return publishClasses(host).t9; }
export function definePublishPasswordsSection(host) { return publishClasses(host).n9; }
export function definePublishAddPasswordSection(host) { return publishClasses(host).i9; }
export function definePublishCustomDomainSection(host) { return publishClasses(host).r9; }
export function definePublishShareModal(host) { return publishClasses(host).o9; }
export function definePublishCompareModal(host) { return publishClasses(host).a9; }
export function definePublishConfirmModal(host) { return publishClasses(host).s9; }
export function definePublishIncludedFoldersModal(host) { return publishClasses(host).l9; }
export function definePublishExcludedFoldersModal(host) { return publishClasses(host).c9; }
export function definePublishRequestErrorClass(host) { return publishClasses(host).p9; }
export function definePublishPlugin(host) { return publishClasses(host).f9; }
