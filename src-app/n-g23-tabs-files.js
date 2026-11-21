// g23 clean-room: "Files and links" settings tab + path suggests + ignore-filters dialog.
import { inherit } from "./inherit.js";
import { env, hostEnv } from "./env.js";
import { fileClass } from "./n-g13-vault.js";
import { withoutExtension, withoutMd, normalizePath, parentPath } from "./path.js";
import { prepareQuery, fuzzyMatchJs } from "./search.js";
import { renderMatches } from "./search-simple.js";
import { ng23T, ng23GetConfig, ng23SetConfig, ng23Contains, ng23Collator } from "./n-g23-util.js";

const FILE_T = (host, key, fb, arg) => ng23T(host, "setting.file." + key, fb, arg);
const DL_T = (host, key, fb) => ng23T(host, "dialogue." + key, fb);
const IF_T = (host, key, fb) => ng23T(host, "interface." + key, fb);
const OPT_T = (host, key, fb) => ng23T(host, "setting.options." + key, fb);
const SUGGEST_LIMIT = 100;

// ===========================================================================
// FilePathSuggest (orig xI): fuzzy suggest over vault files for a text input.
// ===========================================================================

export function defineFilePathSuggest(host) {
  function FilePathSuggest(app, textInputEl) {
    const self = host.AbstractInputSuggest.call(this, app, textInputEl) || this;
    self.filePredicate = () => true;
    return self;
  }
  inherit(FilePathSuggest, host.AbstractInputSuggest);
  const proto = FilePathSuggest.prototype;

  proto.filePredicate = function () { return true; };

  proto.getSuggestions = function (query) {
    const app = this.app;
    const TFile = fileClass("TFile");
    const prepared = prepareQuery(String(query || ""));
    const out = [];
    for (const file of app.vault.getAllLoadedFiles()) {
      if (!(file instanceof TFile)) continue;
      if (!this.filePredicate(file)) continue;
      const match = fuzzyMatchJs(prepared, file.path);
      if (match) out.push({ match, item: file });
      if (out.length >= SUGGEST_LIMIT) break;
    }
    out.sort((a, b) => b.match.score - a.match.score);
    return out.slice(0, SUGGEST_LIMIT);
  };

  proto.renderSuggestion = function (value, el) {
    el.addClass("mod-nowrap");
    const file = value.item;
    const shown = file.extension === "md" ? withoutExtension(file.path) : file.path;
    renderMatches(el, shown, value.match.matches);
  };

  proto.selectSuggestion = function (value, event) {
    if (!value) return;
    const file = value.item;
    const text = file.extension === "md" ? withoutExtension(file.path) : file.path;
    this.setValue(text);
    this.textInputEl.trigger && this.textInputEl.trigger("input");
    this.textInputEl.trigger && this.textInputEl.trigger("change");
    this.close();
  };
  return FilePathSuggest;
}

// ===========================================================================
// FolderPathSuggest (orig AI): fuzzy suggest over folders; optional "+ current" row.
// ===========================================================================

export function defineFolderPathSuggest(host) {
  function FolderPathSuggest(app, textInputEl, allowNullSelection, includeRoot) {
    const self = host.AbstractInputSuggest.call(this, app, textInputEl) || this;
    self.allowNullSelection = !!allowNullSelection;
    self.includeRoot = includeRoot !== false;
    self.filePredicate = () => true;
    return self;
  }
  inherit(FolderPathSuggest, host.AbstractInputSuggest);
  const proto = FolderPathSuggest.prototype;

  proto.getSuggestions = function (query) {
    const app = this.app;
    const prepared = prepareQuery(String(query || ""));
    const out = [];
    for (const folder of app.vault.getAllFolders(this.includeRoot)) {
      if (!this.filePredicate(folder)) continue;
      const match = fuzzyMatchJs(prepared, folder.path);
      if (match) out.push({ match, item: folder });
    }
    out.sort((a, b) => b.match.score - a.match.score);
    const sliced = out.slice(0, SUGGEST_LIMIT);
    const q = String(query || "").trim();
    if (this.allowNullSelection && q) sliced.push({ match: null, item: null });
    return sliced;
  };

  proto.renderSuggestion = function (value, el) {
    el.addClass("mod-nowrap");
    if (value.item === null) {
      el.setText("+ " + this.getValue());
      return;
    }
    renderMatches(el, value.item.path, value.match && value.match.matches);
  };

  proto.selectSuggestion = function (value, event) {
    if (value && value.item) {
      this.setValue(value.item.path);
      this.textInputEl.trigger && this.textInputEl.trigger("input");
    }
    host.AbstractInputSuggest.prototype.selectSuggestion.call(this, value, event);
    this.close();
  };
  return FolderPathSuggest;
}
// ===========================================================================
// IgnoreFiltersModal (orig hte): edit the userIgnoreFilters list.
// ===========================================================================

export function defineIgnoreFiltersModal(host) {
  function IgnoreFiltersModal(app, values, onSave) {
    const self = host.ButtonModal.call(this, app) || this;
    self.values = Array.isArray(values) ? values.slice() : [];
    self.onSave = onSave;
    self.setTitle(FILE_T(host, "optionExcludedFiles", "Ignored files"));
    self.modalEl.addClass("mod-lg");
    return self;
  }
  inherit(IgnoreFiltersModal, host.ButtonModal);
  const proto = IgnoreFiltersModal.prototype;

  proto.onOpen = function () {
    const self = this;
    const content = this.contentEl;
    content.empty();
    this.descEl = content.createEl("p");
    this.listEl = content.createDiv();
    this.display();

    let textCmp = null;
    const add = () => {
      const value = textCmp ? textCmp.getValue() : "";
      if (!value || !value.trim()) {
        try { host.showErrorTooltip(textCmp.inputEl, FILE_T(host, "messageEmptyFilter", "Filters cannot be left blank")); } catch (e) {}
        return;
      }
      self.values.push(value);
      self.display();
      textCmp.setValue("");
    };

    new host.Setting(content)
      .setName(FILE_T(host, "labelExcludedFilter", "Excluded filter"))
      .addText((text) => {
        textCmp = text;
        text.setPlaceholder(FILE_T(host, "placeholderExcludedFilter", "Location, e.g. /regex/…"));
        const inputEl = text.inputEl;
        inputEl.addEventListener("keydown", (event) => {
          if (event.isComposing || event.key !== "Enter") return;
          add();
        });
        new (defineFolderPathSuggest(host))(this.app, inputEl, true, false)
          .onSelect((value) => {
            if (value && value.item) text.setValue(value.item.path + "/");
            add();
          });
      })
      .addButton((button) => button.setButtonText(DL_T(host, "buttonAdd", "Add")).onClick(add));

    // footer
    this.addButton(["mod-cta"], DL_T(host, "buttonSave", "Save"), () => {
      if (self.onSave) self.onSave(self.values);
    });
    this.addCancelButton();
  };

  proto.display = function () {
    const values = this.values;
    if (values.length === 0) {
      this.descEl.setText(FILE_T(host, "labelNoExcludedFiltersApplied", "No exclusion filters are active. Add one below."));
    } else {
      this.descEl.setText(FILE_T(host, "labelExcludedFiltersApplied", "Files caught by these filters are hidden:"));
    }
    this.listEl.empty();
    for (const value of values) {
      const row = this.listEl.createDiv("mobile-option-setting-item");
      row.createSpan({ cls: "mobile-option-setting-item-name", text: value }, (nameEl) => {
        if (value.length > 2 && value.startsWith("/") && value.endsWith("/")) {
          nameEl.createSpan({ cls: "flair mod-flat", text: "Regex" });
        }
      });
      const del = row.createDiv("clickable-icon mobile-option-setting-item-option-icon");
      host.setIcon(del, "lucide-x");
      try { host.setTooltip(del, IF_T(host, "deleteActionShortName", "Delete")); } catch (e) {}
      del.addEventListener("click", () => {
        const idx = this.values.indexOf(value);
        if (idx >= 0) this.values.splice(idx, 1);
        this.display();
      });
    }
  };
  return IgnoreFiltersModal;
}

// ===========================================================================
// saveConfigDirPreference (orig Bm): mobile config-dir preference.
// ===========================================================================

export function saveConfigDirPreference(app, dir) {
  const prefs = env().Fm;
  if (!prefs) return Promise.resolve();
  try {
    if (dir) return prefs.set({ key: app.appId + "-config", value: dir });
    return prefs.remove({ key: app.appId + "-config" });
  } catch (err) {
    return Promise.resolve();
  }
}

// ===========================================================================
// FilesLinksTab (orig ute): the "Files and links" settings tab (id `file`).
// ===========================================================================

// FilesLinksTab (orig ute): the "Files and links" settings tab (id `file`).
// ===========================================================================

export function defineFilesLinksTab(host) {
  function FilesLinksTab(app, setting) {
    const self = host.SettingTab.call(this, app, setting) || this;
    self.name = FILE_T(host, "name", "Files and links");
    self.id = "file";
    self.icon = "folder-cog";
    return self;
  }
  inherit(FilesLinksTab, host.SettingTab);
  const proto = FilesLinksTab.prototype;

  proto._cfg = function (key) { return ng23GetConfig(this.app, key); };
  proto._set = function (key, value) { ng23SetConfig(this.app, key, value); };

  proto.display = function () {
    const self = this;
    const app = this.app;
    this.containerEl.empty();

    // -- 1. default open action -------------------------------------------
    const openGroup = new host.SettingGroup(this.containerEl);
    let openPathInput = null;
    openGroup.addSetting((setting) => {
      setting.setName(FILE_T(host, "optionDefaultOpenAction", "File opened at launch"))
        .setDesc(FILE_T(host, "optionDefaultOpenActionDescription", "Pick which file opens on launch."));
      setting.addDropdown((dropdown) => {
        const stored = self._cfg("openBehavior") || "";
        const isFile = stored.startsWith("file:");
        dropdown.addOption("", FILE_T(host, "optionChoiceLastOpened", "Most recent file"));
        dropdown.addOption("new", FILE_T(host, "optionChoiceNewNote", "Fresh note"));
        dropdown.addOption("file", FILE_T(host, "optionChoiceSpecificFile", "Chosen file"));
        const dn = app.internalPlugins && app.internalPlugins.getEnabledPluginById ? app.internalPlugins.getEnabledPluginById("daily-notes") : null;
        if (dn) dropdown.addOption("daily", FILE_T(host, "optionChoiceDailyNote", "Daily note"));
        dropdown.setValue(isFile ? "file" : stored);
        dropdown.onChange((value) => {
          if (value === "file") {
            self._set("openBehavior", "file:" + (openPathInput ? openPathInput.getValue() : ""));
          } else {
            self._set("openBehavior", value);
          }
          self.display();
        });
      });
      const stored = self._cfg("openBehavior") || "";
      if (stored.startsWith("file:")) {
        setting.addText((text) => {
          openPathInput = text;
          text.setPlaceholder(FILE_T(host, "filePathExamplePlaceholder", "e.g. folder/file"))
            .setValue(stored.slice(5))
            .onChange((value) => {
              self._set("openBehavior", "file:" + value);
            });
          new (host.FilePathSuggest || defineFilePathSuggest(host))(app, text.inputEl);
        });
      }
    });

    // -- 2. new note location ----------------------------------------------
    const noteGroup = new host.SettingGroup(this.containerEl);
    noteGroup.addSetting((setting) => {
      setting.setName(FILE_T(host, "optionNewNoteLocation", "Folder for freshly created notes"))
        .setDesc(FILE_T(host, "optionNewNoteLocationDescription", "Folder where new notes get saved."));
      const loc = self._cfg("newFileLocation") || "root";
      const isFolder = loc === "folder";
      setting.addDropdown((dropdown) => {
        dropdown.addOption("root", FILE_T(host, "optionChoiceVaultRoot", "Vault root"));
        dropdown.addOption("current", FILE_T(host, "optionChoiceCurrentFolder", "In the same folder"));
        dropdown.addOption("folder", FILE_T(host, "optionChoiceSpecifiedFolder", "Folder chosen further down"));
        dropdown.setValue(isFolder ? "folder" : loc);
        dropdown.onChange((value) => { self._set("newFileLocation", value); self.display(); });
      });
      if (isFolder) {
        setting.addText((text) => {
          text.setPlaceholder(OPT_T(host, "folderPathExamplePlaceholder", "e.g. docs/notes"))
            .setValue(self._cfg("newFileFolderPath") || "")
            .onChange((value) => self._set("newFileFolderPath", value));
          new (host.FolderPathSuggestTab || defineFolderPathSuggest(host))(app, text.inputEl, false, true);
        });
      }
    });

    // -- 3. attachment location --------------------------------------------
    const attGroup = new host.SettingGroup(this.containerEl);
    const attDefault = FILE_T(host, "optionNewAttachmentLocationDefault", "Attachments");
    const deriveAtt = (mode, folder, sub) => {
      if (mode === "root") return "/";
      if (mode === "current") return "./";
      if (mode === "subfolder") return "./" + (sub || attDefault);
      return folder || attDefault;
    };
    const parseAtt = (path) => {
      if (path === "/") return { mode: "root", folder: "", sub: "" };
      if (path === "." || path === "./") return { mode: "current", folder: "", sub: "" };
      if (typeof path === "string" && path.startsWith("./")) {
        const rest = path.slice(2);
        if (rest === attDefault) return { mode: "subfolder", folder: "", sub: "" };
        return { mode: "subfolder", folder: "", sub: rest };
      }
      if (!path || path === attDefault) return { mode: "folder", folder: "", sub: "" };
      return { mode: "folder", folder: path, sub: "" };
    };
    attGroup.addSetting((setting) => {
      setting.setName(FILE_T(host, "optionNewAttachmentLocation", "Spot for newly added attachments"))
        .setDesc(FILE_T(host, "optionNewAttachmentLocationDescription", "Attachments you add are stored here."));
      const parsed = parseAtt(self._cfg("attachmentFolderPath"));
      let folderInput = null;
      let subInput = null;
      setting.addDropdown((dropdown) => {
        dropdown.addOption("root", FILE_T(host, "optionChoiceVaultRoot", "Vault root"));
        dropdown.addOption("current", FILE_T(host, "optionChoiceCurrentFolder", "In the same folder"));
        dropdown.addOption("subfolder", FILE_T(host, "optionChoiceSubdirectory", "Child folder of the current one"));
        dropdown.addOption("folder", FILE_T(host, "optionChoiceSpecifiedFolder", "Folder chosen further down"));
        dropdown.setValue(parsed.mode);
        dropdown.onChange((mode) => {
          const folder = folderInput ? folderInput.getValue() : parsed.folder;
          const sub = subInput ? subInput.getValue() : parsed.sub;
          self._set("attachmentFolderPath", deriveAtt(mode, folder, sub));
          self.display();
        });
      });
      if (parsed.mode === "folder" || parsed.mode === "subfolder") {
        const which = parsed.mode;
        setting.addText((text) => {
          if (which === "folder") {
            folderInput = text;
            text.setPlaceholder(FILE_T(host, "optionAttachmentFolderPath", "Attachment folder"))
              .setValue(parsed.folder)
              .onChange((value) => self._set("attachmentFolderPath", deriveAtt("folder", value, parsed.sub)));
          } else {
            subInput = text;
            text.setPlaceholder(FILE_T(host, "optionAttachmentSubfolderPath", "Subfolder name"))
              .setValue(parsed.sub)
              .onChange((value) => self._set("attachmentFolderPath", deriveAtt("subfolder", parsed.folder, value)));
          }
          new (host.FolderPathSuggestTab || defineFolderPathSuggest(host))(app, text.inputEl, false, true);
        });
      }
    });

    // -- 4. links -----------------------------------------------------------
    const linkGroup = new host.SettingGroup(this.containerEl).addHeading(() => FILE_T(host, "optionLinks", "Links"));
    linkGroup.addSetting((setting) => {
      setting.setName(FILE_T(host, "optionLinkAutocompletedFormat", "Format of inserted links"))
        .setDesc(FILE_T(host, "optionLinkAutocompletedFormatDescription", ""));
      setting.addDropdown((dropdown) => {
        dropdown.addOption("shortest", FILE_T(host, "optionChoiceShortestLinktext", "Briefest unique path"));
        dropdown.addOption("relative", FILE_T(host, "optionChoiceRelativePath", "Path shown relative to this note"));
        dropdown.addOption("absolute", FILE_T(host, "optionChoiceAbsolutePath", "Complete path starting at vault root"));
        dropdown.setValue(self._cfg("newLinkFormat") || "shortest").onChange((v) => self._set("newLinkFormat", v));
      });
    });
    const addBool = (group, key, labelKey, labelFb, descKey, descFb, invert) => {
      group.addSetting((setting) => {
        setting.setName(FILE_T(host, labelKey, labelFb)).setDesc(FILE_T(host, descKey, descFb));
        setting.addToggle((toggle) => {
          const cur = self._cfg(key);
          toggle.setValue(invert ? !cur : !!cur).onChange((v) => self._set(key, invert ? !v : v));
        });
      });
    };
    addBool(linkGroup, "alwaysUpdateLinks", "optionAlwaysUpdateLinks", "Sync internal links on rename", "optionAlwaysUpdateLinksDescription", "", false);
    addBool(linkGroup, "useMarkdownLinks", "optionUseWikiLinks", "Use [[Wikilinks]]", "optionUseWikiLinksDescription", "", true);
    addBool(linkGroup, "showUnsupportedFiles", "optionShowUnsupportedFiles", "Display every file type", "optionShowUnsupportedFilesDescription", "", false);

    // -- 5. trash -----------------------------------------------------------
    const trashGroup = new host.SettingGroup(this.containerEl).addHeading(() => FILE_T(host, "optionTrash", "Trash"));
    addBool(trashGroup, "promptDelete", "optionConfirmFileDeletion", "Prompt before file deletion", "optionConfirmFileDeletionDescription", "", false);
    trashGroup.addSetting((setting) => {
      setting.setName(FILE_T(host, "optionDeleteUnlinkedAttachments", "Also remove attachments of deleted files"))
        .setDesc(FILE_T(host, "optionDeleteUnlinkedAttachmentsDescription", ""));
      setting.addDropdown((dropdown) => {
        dropdown.addOption("ask", FILE_T(host, "optionChoiceAskEveryTime", "Ask every time"));
        dropdown.addOption("always", FILE_T(host, "optionChoiceAlways", "Always"));
        dropdown.addOption("never", FILE_T(host, "optionChoiceNever", "Never"));
        dropdown.setValue(self._cfg("deleteUnlinkedAttachments") || "ask").onChange((v) => self._set("deleteUnlinkedAttachments", v));
      });
    });
    trashGroup.addSetting((setting) => {
      setting.setName(FILE_T(host, "optionDeleteDestination", "Deleted file destination"))
        .setDesc(FILE_T(host, "optionDeleteDestinationDescription", ""));
      setting.addDropdown((dropdown) => {
        dropdown.addOption("system", FILE_T(host, "optionChoiceSystemTrash", "System trash"));
        dropdown.addOption("local", FILE_T(host, "optionChoiceVaultTrash", "File lands in Basalt's .trash"));
        dropdown.addOption("none", FILE_T(host, "optionChoicePermanentDelete", "Delete for good"));
        dropdown.setValue(self._cfg("trashOption") || "system").onChange((v) => self._set("trashOption", v));
      });
    });

    // -- 6. advanced --------------------------------------------------------
    const advGroup = new host.SettingGroup(this.containerEl).addHeading(() => ng23T(host, "setting.about.optionAdvanced", "Advanced"));
    // excluded files
    advGroup.addSetting((setting) => {
      const filters = self._cfg("userIgnoreFilters") || [];
      const desc = filters.length
        ? FILE_T(host, "labelExcludedFiltersApplied", "") + " " + filters.map((f) => (f.length > 2 && f.startsWith("/") && f.endsWith("/") ? "Regex " + f : f)).join(", ")
        : FILE_T(host, "labelNoExcludedFiltersApplied", "");
      setting.setName(FILE_T(host, "optionExcludedFiles", "Ignored files")).setDesc(desc);
      setting.addButton((button) => {
        button.setButtonText(OPT_T(host, "buttonManage", "Manage")).onClick(() => {
          const current = self._cfg("userIgnoreFilters");
          new (defineIgnoreFiltersModal(host))(app, Array.isArray(current) ? current : [], (values) => {
            self._set("userIgnoreFilters", values && values.length ? values : null);
            self.display();
          }).open();
        });
      });
    });
    // config location
    advGroup.addSetting((setting) => {
      setting.setName(ng23T(host, "setting.about.optionConfigLocation", "Custom config folder"))
        .setDesc(ng23T(host, "setting.about.optionConfigLocationDescription", ""));
      let relaunchBtn = null;
      setting.addText((text) => {
        const stored = (() => { try { return localStorage.getItem(app.appId + "-config"); } catch (e) { return null; } })();
        text.setPlaceholder(".obsidian").setValue(stored || "");
        text.onChange((value) => {
          const valid = env().JT && env().JT.validateConfigDir ? env().JT.validateConfigDir(value) : true;
          if (!valid) {
            text.inputEl.addClass("mod-error");
            try { host.showErrorTooltip(text.inputEl, FILE_T(host, "optionConfigLocationWarning", "Invalid folder name")); } catch (e) {}
            if (relaunchBtn) relaunchBtn.hide();
            return;
          }
          text.inputEl.removeClass("mod-error");
          const differs = value !== (stored || "");
          if (relaunchBtn) relaunchBtn.toggle(differs);
        });
      });
      setting.addButton((button) => {
        relaunchBtn = button;
        button.setButtonText(DL_T(host, "buttonRelaunch", "Restart")).setCta().onClick(() => {
          const value = textValue(setting);
          try { localStorage.setItem(app.appId + "-config", value); } catch (e) {}
          saveConfigDirPreference(app, value);
          window.location.reload();
        });
      });
      function textValue(setting) {
        const input = setting.controlEl && setting.controlEl.querySelector("input");
        return input ? input.value : "";
      }
    });
    addBool(advGroup, "uriCallbacks", "optionUriCallbacks", "Permit URI callbacks", "optionUriCallbacksDesc", "", false);
    advGroup.addSetting((setting) => {
      setting.setName(FILE_T(host, "optionReindexVault", "Refresh the vault index"))
        .setDesc(FILE_T(host, "optionReindexVaultDescription", ""));
      setting.addButton((button) => {
        button.setButtonText(FILE_T(host, "labelReindex", "Rebuild")).setWarning().onClick(() => {
          if (app.metadataCache && app.metadataCache.clear) app.metadataCache.clear();
          window.location.reload();
        });
      });
    });
    void parentPath; void normalizePath; void ng23Contains; void ng23Collator; void withoutMd;
  };
  return FilesLinksTab;
}