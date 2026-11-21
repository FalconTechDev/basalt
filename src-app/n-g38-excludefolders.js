// g38 clean-room: "Excluded folders" folder-suggest dialog base (spec g38 Part 3).
// Used by the publish and sync plugins for their exclude-folder settings.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { normalizePath } from "./path.js";

export function ng38FolderSuggestBase(host) {
  function FolderSuggestBase(app, name, desc, labelI18nKey) {
    const self = host.DialogModal.call(this, app) || this;
    self.settingTab = null;
    self.labelI18nKey = labelI18nKey;
    const doc = self.contentEl.ownerDocument || document;
    self.displayEl = doc.createElement("p");
    self.contentEl.appendChild(self.displayEl);
    new host.Setting(self.contentEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        const inputEl = text.inputEl;
        self.inputEl = inputEl;
        const suggest = new (env().PI)(app, inputEl, (item) => {
          const paths = self.getPaths() || [];
          return paths.contains ? !paths.contains(item.path) : !paths.includes(item.path);
        }, true);
        suggest.onSelect(() => self.select());
        inputEl.addEventListener("keydown", (ev) => {
          if (ev.isComposing || ev.key !== "Enter") return;
          self.select();
        });
      });
    self.addButton("", host.i18n.dialogue.buttonDone(), () => self.close());
    return self;
  }
  inherit(FolderSuggestBase, host.DialogModal);

  FolderSuggestBase.prototype.select = async function () {
    const value = normalizePath(this.inputEl.value);
    if (!value) return;
    this.inputEl.value = "";
    const paths = this.getPaths();
    paths.push(value);
    await this.setPaths(paths);
    this.updateDisplay();
  };

  FolderSuggestBase.prototype.onOpen = function () {
    if (host.DialogModal.prototype.onOpen) host.DialogModal.prototype.onOpen.call(this);
    this.updateDisplay();
  };

  FolderSuggestBase.prototype.onClose = function () {
    if (this.settingTab) this.settingTab.display();
  };

  FolderSuggestBase.prototype.updateDisplay = function () {
    const i18n = host.i18n;
    const paths = this.getPaths() || [];
    const displayEl = this.displayEl;
    const doc = displayEl.ownerDocument || document;
    displayEl.textContent = "";
    displayEl.appendChild(doc.createTextNode(
      i18n(this.labelI18nKey, { folders: i18n.nouns.folderWithCount({ count: paths.length }) })
    ));
    for (const path of paths) {
      const row = doc.createElement("div");
      row.className = "sync-exclude-folder";
      const remove = doc.createElement("div");
      remove.className = "sync-exclude-folder-remove clickable-icon";
      host.setIcon(remove, "lucide-x");
      host.setTooltip(remove, i18n.plugins.sync.tooltipRemoveExcludedFolder());
      remove.addEventListener("click", async () => {
        const list = this.getPaths();
        const next = list.remove ? list.remove(path) : list.filter((p) => p !== path);
        await this.setPaths(next);
        this.updateDisplay();
      });
      row.appendChild(remove);
      const icon = doc.createElement("span");
      icon.className = "clickable-icon";
      host.setIcon(icon, "lucide-folder-open");
      row.appendChild(icon);
      const name = doc.createElement("div");
      name.className = "sync-exclude-folder-name";
      const label = doc.createElement("span");
      label.textContent = path;
      name.appendChild(label);
      row.appendChild(name);
      displayEl.appendChild(row);
    }
  };

  return FolderSuggestBase;
}

// Test-facing alias for the legacy module contract.
export { ng38FolderSuggestBase as s35FolderSuggestBase };
