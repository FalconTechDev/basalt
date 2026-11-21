// g22 clean-room: selectable file tree for the orphan-attachment picker.
// Own architecture: plain item objects with DOM rows; folders aggregate the
// checked state of their descendants. DOM classes follow the spec contract.

import { env } from "./env.js";
import { parentPath, lastSegment } from "./path.js";
import { fileClass } from "./n-g13-vault.js";

const ng22Div = () => env().createDiv;
const ng22TFolder = () => fileClass("TFolder");

function ng22IsFolderItem(item) {
  return !!(item && (item.isFolder || (item.file && item.file.children)));
}

/** Folder rows sort before file rows; inside a group, by display name. */
export function s20TreeItemCompare(a, b) {
  const af = ng22IsFolderItem(a) ? 0 : 1;
  const bf = ng22IsFolderItem(b) ? 0 : 1;
  if (af !== bf) return af - bf;
  return String(a.name || "").localeCompare(String(b.name || ""));
}

function ng22Checkbox(el, checked) {
  const cb = el.createEl("input", { cls: "file-tree-item-checkbox", attr: { type: "checkbox" } });
  cb.checked = checked !== false;
  return cb;
}

function ng22Row(file, icon) {
  const selfEl = ng22Div()("file-tree-item");
  selfEl.style.display = "flex";
  selfEl.style.alignItems = "center";
  const checkboxEl = ng22Checkbox(selfEl, true);
  const iconEl = selfEl.createSpan({ cls: "file-tree-item-icon" });
  return { selfEl, checkboxEl, iconEl };
}

// ---------------------------------------------------------------- FileTreeItem ----

/** One selectable file row: `.file-tree-item` > checkbox + icon + title. */
export function defineS20FileTreeItem(host) {
  function FileTreeItem(file) {
    this.file = file;
    this.path = file.path;
    this.name = file.name;
    this.checked = true;
    this.parent = null;
    this.children = null;
    this.isFolder = false;
    const row = ng22Row(file);
    this.selfEl = row.selfEl;
    this.checkboxEl = row.checkboxEl;
    this.innerEl = row.selfEl;
    host.setIcon(row.iconEl, file.icon || "lucide-file");
    row.selfEl.createSpan({ cls: "file-tree-item-title", text: file.name });
    const self = this;
    row.selfEl.addEventListener("click", (ev) => {
      if (ev.target === row.checkboxEl) return;
      self.onSelfClick(ev);
    });
    row.checkboxEl.addEventListener("click", (ev) => ev.stopPropagation());
    row.checkboxEl.addEventListener("change", () => self.setChecked(row.checkboxEl.checked));
    return this;
  }
  const P = FileTreeItem.prototype;

  P.setChecked = function (value) {
    this.checked = value !== false;
    if (this.checkboxEl) this.checkboxEl.checked = this.checked;
    this.updateCheckedRecursive();
  };

  P.updateChecked = function () {
    if (this.checkboxEl) this.checkboxEl.checked = this.checked !== false;
  };

  P.updateCheckedRecursive = function () {
    let item = this.parent;
    while (item) { item.updateChecked(); item = item.parent; }
  };

  P.onSelfClick = function () {
    this.setChecked(!this.checked);
  };

  return FileTreeItem;
}

// ------------------------------------------------------------- FolderTreeItem ----

/** Collapsible folder row aggregating the checked state of descendant files. */
export function defineS20FolderTreeItem(host) {
  function FolderTreeItem(path) {
    this.path = path;
    this.name = lastSegment(path) || path;
    this.file = null;
    this.isFolder = true;
    this.checked = true;
    this.parent = null;
    this.children = [];
    this.collapsed = true;
    // nodeEl wraps the row and its children so the row's own text stays clean;
    // children render as siblings of the row, not descendants of it.
    this.nodeEl = ng22Div()("file-tree-folder");
    const selfEl = ng22Div()("file-tree-item");
    selfEl.style.display = "flex";
    selfEl.style.alignItems = "center";
    this.selfEl = selfEl;
    this.nodeEl.appendChild(selfEl);
    this.innerEl = selfEl;
    const collapse = selfEl.createSpan({ cls: "clickable-icon collapse-icon" });
    host.setIcon(collapse, "lucide-chevron-right");
    collapse.addClass("is-collapsed");
    this.collapseEl = collapse;
    this.checkboxEl = ng22Checkbox(selfEl, true);
    const iconEl = selfEl.createSpan({ cls: "file-tree-item-icon" });
    host.setIcon(iconEl, "lucide-folder");
    selfEl.createSpan({ cls: "file-tree-item-title", text: this.name });
    this.childrenEl = this.nodeEl.createDiv("file-tree-item-children");
    this.childrenEl.addClass("is-hidden");
    const self = this;
    collapse.addEventListener("click", (ev) => {
      ev.stopPropagation();
      self.collapsed = !self.collapsed;
      collapse.toggleClass("is-collapsed", self.collapsed);
      self.childrenEl.toggleClass("is-hidden", self.collapsed);
      host.setIcon(collapse, self.collapsed ? "lucide-chevron-right" : "lucide-chevron-down");
    });
    selfEl.addEventListener("click", (ev) => {
      if (ev.target === self.checkboxEl || ev.target === collapse || collapse.contains(ev.target)) return;
      self.onSelfClick(ev);
    });
    this.checkboxEl.addEventListener("click", (ev) => ev.stopPropagation());
    this.checkboxEl.addEventListener("change", () => {
      const all = self.getChecked();
      self.setChecked(!(all.checked && all.count > 0));
    });
    return this;
  }
  const P = FolderTreeItem.prototype;

  /** {count, checked}: descendant file tally; checked only when every file is checked. */
  P.getChecked = function () {
    let count = 0, checked = 0;
    const walk = (item) => {
      if (!item.isFolder) {
        count++;
        if (item.checked) checked++;
        return;
      }
      for (const c of item.children || []) walk(c);
    };
    for (const c of this.children || []) walk(c);
    return { count, checked };
  };

  P.updateChecked = function () {
    if (!this.checkboxEl) return;
    const { count, checked } = this.getChecked();
    this.checkboxEl.checked = count > 0 && checked === count;
    this.checkboxEl.indeterminate = checked > 0 && checked < count;
    this.checked = this.checkboxEl.checked;
  };

  P.updateCheckedRecursive = function () {
    this.updateChecked();
    let item = this.parent;
    while (item) { item.updateChecked(); item = item.parent; }
  };

  P.setChecked = function (value) {
    const target = value !== false;
    const apply = (item) => {
      if (item.isFolder) { for (const c of item.children || []) apply(c); return; }
      item.checked = target;
      if (item.checkboxEl) item.checkboxEl.checked = target;
    };
    apply(this);
    this.updateCheckedRecursive();
  };

  P.onSelfClick = function () {
    const all = this.getChecked();
    this.setChecked(!(all.checked && all.count > 0));
  };

  P.render = function () {
    const kids = (this.children || []).slice().sort(s20TreeItemCompare);
    this.childrenEl.setChildrenInPlace(kids.map((c) => c.nodeEl || c.selfEl));
    for (const c of kids) if (c.render) c.render();
  };

  return FolderTreeItem;
}

// ------------------------------------------------------------------- FileTree ----

/** Owns the folder/file item maps and renders the root level sorted. */
export function defineS20FileTree(host) {
  function FileTree(parentEl) {
    this._host = host;
    this.containerEl = ng22Div()("file-tree");
    if (parentEl) parentEl.appendChild(this.containerEl);
    this.folders = {};
    this.files = {};
    this._root = { children: [] };
  }
  const P = FileTree.prototype;

  P._klass = function (which, host) {
    if (which === "file") {
      if (!this._fileKlass) this._fileKlass = defineS20FileTreeItem(host);
      return this._fileKlass;
    }
    if (!this._folderKlass) this._folderKlass = defineS20FolderTreeItem(host);
    return this._folderKlass;
  };

  P._ensureFolder = function (path, host) {
    host = host || this._host;
    if (!path) return null;
    let folder = this.folders[path];
    if (folder) return folder;
    folder = new (this._klass("folder", host))(path);
    folder.parent = this._ensureFolder(parentPath(path), host);
    if (folder.parent) folder.parent.children.push(folder);
    else this._root.children.push(folder);
    this.folders[path] = folder;
    return folder;
  };

  P.addFile = function (file, host) {
    host = host || this._host;
    if (!file || !file.path || this.files[file.path]) return this.files[file.path] || null;
    const item = new (this._klass("file", host))(file);
    item.parent = this._ensureFolder(parentPath(file.path), host);
    if (item.parent) item.parent.children.push(item);
    else this._root.children.push(item);
    this.files[file.path] = item;
    return item;
  };

  P.addChild = function (item, host) {
    host = host || this._host;
    const path = item && item.path;
    if (!path) return item;
    if (item.isFolder) {
      if (!this.folders[path]) {
        item.parent = this._ensureFolder(parentPath(path), host);
        if (item.parent) item.parent.children.push(item);
        else this._root.children.push(item);
        this.folders[path] = item;
      }
      return item;
    }
    return this.addFile(item.file || item, host);
  };

  P.render = function () {
    const kids = this._root.children.slice().sort(s20TreeItemCompare);
    this.containerEl.setChildrenInPlace(kids.map((c) => c.nodeEl || c.selfEl));
    for (const c of kids) if (c.render) c.render();
    // re-render nested folders so newly added children appear
    for (const path of Object.keys(this.folders)) this.folders[path].render();
  };

  P.getCheckedFiles = function () {
    const out = [];
    for (const path of Object.keys(this.files)) {
      const item = this.files[path];
      if (item && item.checked && item.file) out.push(item.file);
    }
    return out;
  };

  return FileTree;
}
// __MORE__
