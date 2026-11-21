// g37 — file-explorer nav row prototypes (clean-room). Lazily built once, deep-cloned per call.

function ng37BuildFileRow() {
  const row = document.createElement("div");
  row.className = "tree-item nav-file";
  const self = document.createElement("div");
  self.className = "tree-item-self nav-file-title tappable is-clickable";
  const inner = document.createElement("div");
  inner.className = "tree-item-inner nav-file-title-content";
  self.appendChild(inner);
  row.appendChild(self);
  return row;
}

function ng37BuildFolderRow() {
  const row = document.createElement("div");
  row.className = "tree-item nav-folder";
  const self = document.createElement("div");
  self.className = "tree-item-self nav-folder-title is-clickable";
  const inner = document.createElement("div");
  inner.className = "tree-item-inner nav-folder-title-content";
  self.appendChild(inner);
  row.appendChild(self);
  const children = document.createElement("div");
  children.className = "tree-item-children nav-folder-children";
  row.appendChild(children);
  return row;
}

let ng37FileProto = null;
let ng37FolderProto = null;

/** Fresh `div.tree-item.nav-file` row element (title only, no children container). */
export function ng37NavFileEl() {
  if (!ng37FileProto) ng37FileProto = ng37BuildFileRow();
  return ng37FileProto.cloneNode(true);
}

/** Fresh `div.tree-item.nav-folder` row element (title + children container). */
export function ng37NavFolderEl() {
  if (!ng37FolderProto) ng37FolderProto = ng37BuildFolderRow();
  return ng37FolderProto.cloneNode(true);
}
