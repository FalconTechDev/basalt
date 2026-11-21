// g31 clean-room: core-plugin constants, importer regexes, sort tables,
// file-explorer nav DOM templates (spec g31 part B).
import { env } from "./env.js";

export const ng31FileExplorerPluginId = "file-explorer";
export const ng31OutlinePluginId = "outline";
export const ng31OutgoingLinkPluginId = "outgoing-link";
export const ng31FootnotesPluginId = "footnotes";
export const ng31AllPropertiesViewType = "all-properties";
export const ng31FilePropertiesViewType = "file-properties";

export const ng31ReInlineField = /\^\^(\S(.*?\S)?)\^\^/g;
export const ng31ReInlineHighlight = /::(\S(.*?\S)?)::/g;
export const ng31ReBlockRef = /\[\[(\d+?)\]\]/g;
export const ng31ReHashtag = /(^|\s)\#([^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\s]+)/g;
export const ng31ReTagLink = /\B\#(\[\[[\w \t]*?\]\])/g;
export const ng31ReTodo = /\{\{\[\[(TODO|DONE)\]\]\}\}/g;

export const ng31FileRecoveryDefaults = Object.freeze({ intervalMinutes: 5, keepDays: 7 });

export const ng31PropertiesSortModes = Object.freeze([
  Object.freeze(["alphabetical", "alphabeticalReverse"]),
  Object.freeze(["frequency", "frequencyReverse"]),
]);

export function ng31PropertiesSortLabels() {
  const p = env().gm.plugins.properties;
  return {
    alphabetical: p.labelSortByNameAToZ(),
    alphabeticalReverse: p.labelSortByNameZToA(),
    frequency: p.labelSortByFrequencyHighToLow(),
    frequencyReverse: p.labelSortByFrequencyLowToHigh(),
  };
}

// File-explorer nav item templates, memoized through env().Sg so repeated
// calls yield independent elements built from one factory.
export function ng31NavFileTemplate() {
  return env().Sg(() => {
    const root = createDiv("tree-item nav-file");
    const self = createDiv("tree-item-self nav-file-title tappable is-clickable");
    const inner = createDiv("tree-item-inner nav-file-title-content");
    self.appendChild(inner);
    root.appendChild(self);
    return root;
  });
}

export function ng31NavFolderTemplate() {
  return env().Sg(() => {
    const root = createDiv("tree-item nav-folder");
    const self = createDiv("tree-item-self nav-folder-title is-clickable");
    const inner = createDiv("tree-item-inner nav-folder-title-content");
    const children = createDiv("tree-item-children nav-folder-children");
    self.appendChild(inner);
    root.appendChild(self);
    root.appendChild(children);
    return root;
  });
}


// Standard tree-item bookkeeping shared by the outgoing-link rows.
const NG31_ITEM_INFO = () => ({
  height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0,
  computed: false, queued: false, hidden: false, next: false,
});

// Group row of the outgoing-links pane: el/childrenEl are the passed element.
export function ng31OutgoingLinkGroup(el) {
  this.el = this.childrenEl = el;
  this.info = NG31_ITEM_INFO();
  this.vChildren = new (env().UH)(this);
  this.pusherEl = env().JH();
}

// One clickable row per outgoing link of a note.
export function ng31OutgoingLinkItem(parent, linktext, title, subref, sourcePath, targetFile) {
  const appRef = parent && parent.app ? parent.app : app;
  this.info = NG31_ITEM_INFO();
  this.invalidated = false;
  this.sourcePath = sourcePath;

  let icon;
  let main = title;
  let sub = "";
  let missing = false;
  if (targetFile && subref) {
    const pos = env().FT(appRef.metadataCache.getFileCache(targetFile), subref);
    if (pos && pos.type === "heading") {
      icon = "heading-glyph";
      main = (pos.current && pos.current.heading) || subref;
    } else if (pos && pos.type === "block") {
      icon = "lucide-layout-list";
      main = (pos.block && pos.block.id) || subref;
    } else {
      icon = "lucide-file-question";
      main = subref;
    }
    sub = title;
  } else if (targetFile) {
    icon = "lucide-link";
    const parentPath = env().iu(targetFile.path);
    if (parentPath && parentPath !== "/") sub = parentPath;
  } else {
    icon = "lucide-file-plus";
    missing = true;
  }

  this.el = createDiv("tree-item-self is-clickable outgoing-link-item");
  if (missing) env().Mv(this.el, env().gm.plugins.outgoingLinks.tooltipNotCreated());
  const iconEl = createSpan({ cls: "tree-item-icon" });
  const innerEl = createDiv("tree-item-inner");
  const textEl = createDiv("tree-item-inner-text");
  textEl.setText(main);
  innerEl.appendChild(textEl);
  if (sub) {
    const subEl = createDiv("tree-item-inner-subtext");
    subEl.setText(sub);
    innerEl.appendChild(subEl);
  }
  this.el.appendChild(iconEl);
  this.el.appendChild(innerEl);
  env().tv(iconEl, icon);

  this.el.addEventListener("click", (ev) => {
    if (ev.button === 0 || ev.button === 1) {
      appRef.workspace.openLinkText(linktext, sourcePath, env().Bg.isModEvent(ev));
    }
  });
  this.el.addEventListener("contextmenu", (ev) => {
    const menu = new (env().Ug)();
    if (menu.addSections) menu.addSections(["title", "open", "action", "view", "info", "", "danger"]);
    if (appRef.workspace.handleLinkContextMenu(menu, linktext, sourcePath)) {
      ev.preventDefault();
      menu.setParentElement(this.el);
      menu.showAtMouseEvent(ev);
    }
  });
  this.el.addEventListener("mouseover", (ev) => {
    if (ev.defaultPrevented || !env().Lc(ev, this.el)) return;
    ev.preventDefault();
    appRef.workspace.trigger("hover-link", {
      event: ev, source: "search", hoverParent: parent,
      targetEl: this.el, linktext, sourcePath,
    });
  });
  if (targetFile) {
    appRef.dragManager.handleDrag(this.el, (ev) => appRef.dragManager.dragFile(ev, targetFile));
  }
}

