// g36 clean-room: MoveFolderModal — the fuzzy destination picker behind the
// file-explorer "move items" action (spec g36 Part B.3).

import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { s10FolderContains, s10MovableFiles, s10MoveFilesAndUpdateLinks } from "./n-g07-app-d.js";

/** Drops entries covered by a TFolder earlier in the list (ng08 semantics). */
function ng36FlattenUniqueFiles(files, TFolder) {
  const out = [];
  for (const file of files || []) {
    let covered = false;
    for (const other of files || []) {
      if (other !== file && other instanceof TFolder && file.path && typeof other.path === "string" && file.path.startsWith(other.path)) {
        covered = true;
        break;
      }
    }
    if (!covered) out.push(file);
  }
  return out;
}

/** Path up to and including the "/" after the last fuzzy match end. */
function ng36FolderPrefix(path, matches) {
  if (!matches || !matches.length) return path;
  const lastEnd = matches[matches.length - 1][1];
  const slash = path.indexOf("/", lastEnd);
  return slash >= 0 ? path.slice(0, slash + 1) : path;
}

export function ng36MoveFolderModal(host) {
  function MoveFolderModal(app, files) {
    const self = host.FuzzySuggestModal.call(this, app) || this;
    const fe = host.i18n.plugins.fileExplorer;
    self.files = files || [];
    self.limit = 20;
    self.emptyStateText = fe.labelNoFolders();
    self.emptyMatch = Object.freeze({ match: { score: 0, matches: [] }, item: null });
    self.setInstructions([
      { command: "↑↓", purpose: fe.instructionNavigate() },
      { command: "↵", purpose: fe.instructionMove() },
      { command: "shift ↵", purpose: fe.instructionCreate() },
      { command: "esc", purpose: fe.instructionDismiss() },
    ]);
    self.setPlaceholder(fe.promptTypeFolder());
    self.scope.register([], "Tab", (event) => {
      if (event && event.isComposing) return false;
      const chooser = self.chooser;
      const values = chooser && chooser.values;
      const sel = chooser ? chooser.selectedItem : 0;
      const value = values && values[sel];
      if (value && value.item) {
        const itemPath = value.item.path || "";
        let text = ng36FolderPrefix(itemPath, value.match && value.match.matches);
        if (text === "/") return false;
        if (text === self.inputEl.value) text += "/";
        self.inputEl.value = text;
        if (typeof self.inputEl.trigger === "function") self.inputEl.trigger("input");
        else self.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return false;
    });
    self.scope.register(["Shift"], "Enter", (event) => {
      self.selectSuggestion(self.emptyMatch, event);
      return false;
    });
    return self;
  }
  inherit(MoveFolderModal, host.FuzzySuggestModal);
  const proto = MoveFolderModal.prototype;

  proto.getItems = function () {
    const flat = ng36FlattenUniqueFiles(this.files, host.TFolder);
    const moved = flat.filter((f) => f instanceof host.TFolder);
    let candidates = this.app.vault.getAllFolders(true) || [];
    if (moved.length) {
      candidates = candidates.filter((c) => !moved.some((m) => m === c || s10FolderContains(m, c)));
    }
    return candidates;
  };

  proto.getItemText = function (folder) {
    return folder && folder.path ? folder.path : "/";
  };

  proto.onNoSuggestion = function () {
    this.chooser.setSuggestions([this.emptyMatch]);
    this.chooser.addMessage(this.emptyStateText);
  };

  proto.renderSuggestion = function (suggestion, el) {
    if (suggestion && suggestion.item != null) {
      const base = host.FuzzySuggestModal.prototype;
      if (base && typeof base.renderSuggestion === "function") {
        return base.renderSuggestion.call(this, suggestion, el);
      }
      return;
    }
    el.classList.add("mod-complex");
    const content = document.createElement("div");
    content.className = "suggestion-content";
    const title = document.createElement("div");
    title.className = "suggestion-title";
    title.textContent = this.inputEl.value;
    content.appendChild(title);
    const aux = document.createElement("div");
    aux.className = "suggestion-aux";
    const hotkey = document.createElement("span");
    hotkey.className = "suggestion-hotkey";
    hotkey.textContent = host.i18n.interface.labelEnterToCreate();
    aux.appendChild(hotkey);
    el.appendChild(content);
    el.appendChild(aux);
  };

  proto.onChooseItem = async function (folder) {
    const files = this.files;
    if (!files || files.length === 0) return;
    let target = folder;
    if (!target) {
      const value = (this.inputEl.value || "").trim();
      if (!value) return;
      await this.app.vault.createFolder(value);
      const wanted = value.toLowerCase();
      const all = this.app.vault.getAllFolders(true) || [];
      target = all.find((f) => typeof f.path === "string" && f.path.toLowerCase() === wanted)
        || all.find((f) => typeof f.path === "string" && f.path.toLowerCase() === "/" + wanted);
      if (!(target instanceof host.TFolder)) return;
    }
    const movable = s10MovableFiles(ng36FlattenUniqueFiles(files, host.TFolder), target);
    if (!movable.length) return;
    await s10MoveFilesAndUpdateLinks(this.app, movable, target);
  };

  return MoveFolderModal;
}
