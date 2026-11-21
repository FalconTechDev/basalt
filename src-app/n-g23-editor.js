// g23 clean-room: spellcheck dictionary modal + "Editor" settings tab (spec g23 §3.4).
import { inherit } from "./inherit.js";
import { env, hostEnv } from "./env.js";
import { ng23T, ng23Collator, ng23GetConfig, ng23SetConfig, ng23Moment } from "./n-g23-util.js";

const ED_T = (host, key, fb, arg) => ng23T(host, "setting.editor." + key, fb, arg);
const NG23ED_ABOUT_T = (host, key, fb, arg) => ng23T(host, "setting.about." + key, fb, arg);
const NG23ED_HK_T = (host, key, fb, arg) => ng23T(host, "setting.hotkeys." + key, fb, arg);
const NG23ED_DL_T = (host, key, fb, arg) => ng23T(host, "dialogue." + key, fb, arg);

// ===========================================================================
// SpellcheckDictionaryModal (orig ote).
// ===========================================================================

export function defineSpellcheckDictionaryModal(host) {
  function SpellcheckDictionaryModal(app) {
    const self = host.Modal.call(this, app) || this;
    self.setTitle(ED_T(host, "spellcheckDict", "Word list for spell checking"));
    return self;
  }
  inherit(SpellcheckDictionaryModal, host.Modal);
  const proto = SpellcheckDictionaryModal.prototype;

  proto._session = function () {
    try {
      const bridge = hostEnv().Of || env().Of;
      const electron = bridge && (bridge.remote ? bridge : bridge.electron);
      const remote = electron && electron.remote;
      const contents = remote && remote.getCurrentWebContents && remote.getCurrentWebContents();
      return contents && contents.session;
    } catch (err) { return null; }
  };

  proto._words = function () {
    const session = this._session();
    try {
      const words = session && session.listWordsInSpellCheckerDictionary ? session.listWordsInSpellCheckerDictionary() : [];
      return (words || []).slice().sort(ng23Collator.compare);
    } catch (err) { return []; }
  };

  proto.onOpen = function () {
    host.Modal.prototype.onOpen.call(this);
    const content = this.contentEl;
    content.empty();
    const words = this._words();
    if (!words.length) {
      content.createEl("p", { text: ED_T(host, "spellcheckDictEmpty", "No words have been added to the spell checker word list.") });
      return;
    }
    const container = content.createDiv("spellchecker-dictionary-container");
    const session = this._session();
    for (const word of words) {
      const item = container.createDiv("spellchecker-dictionary-item");
      item.createSpan({ cls: "spellchecker-dictionary-word", text: word });
      item.createDiv("spellchecker-dictionary-remove-button clickable-icon", (el) => {
        host.setIcon(el, "lucide-x");
        host.setTooltip(el, NG23ED_DL_T(host, "buttonDelete", "Delete"));
        el.addEventListener("click", () => {
          try { session && session.removeWordFromSpellCheckerDictionary && session.removeWordFromSpellCheckerDictionary(word); } catch (err) {}
          item.detach();
          if (!container.querySelector(".spellchecker-dictionary-item")) {
            content.empty();
            content.createEl("p", { text: ED_T(host, "spellcheckDictEmpty", "No words have been added.") });
          }
        });
      });
    }
  };

  proto.onClose = function () {
    this.contentEl.empty();
    host.Modal.prototype.onClose.call(this);
  };

  return SpellcheckDictionaryModal;
}

// ===========================================================================
// EditorTab (orig rte, id "editor").
// ===========================================================================

export function defineEditorTab(host) {
  function EditorTab(app, setting) {
    const self = host.SettingTab.call(this, app, setting) || this;
    self.name = ED_T(host, "name", "Editor");
    self.id = "editor";
    self.icon = "pen-line";
    self.passedVimTest = false;
    return self;
  }
  inherit(EditorTab, host.SettingTab);
  const proto = EditorTab.prototype;

  proto._cfg = function (key) { return ng23GetConfig(this.app, key); };
  proto._set = function (key, value) { ng23SetConfig(this.app, key, value); };

  proto._toggle = function (group, key, nameKey, descKey, nameFb, descFb) {
    const self = this;
    group.addSetting((setting) => {
      setting.setName(ED_T(host, nameKey, nameFb)).setDesc(ED_T(host, descKey, descFb));
      setting.addToggle((toggle) => {
        toggle.setValue(!!self._cfg(key));
        toggle.onChange((on) => {
          self._set(key, on);
          if (key === "vimMode") self._onVimToggle(on, toggle);
        });
      });
    });
  };

  proto._onVimToggle = function (on, toggle) {
    const app = this.app;
    if (!on) { this._set("vimMode", false); return; }
    if (!host.Platform.isDesktopApp) {
      // mobile: localStorage flag + workspace options refresh
      try { localStorage.setItem("vim", "true"); } catch (e) {}
      try { app.workspace && app.workspace.updateOptions && app.workspace.updateOptions(); } catch (e) {}
      return;
    }
    if (this.passedVimTest) {
      this._set("vimMode", true);
      return;
    }
    // first attempt: revert and run the confirmation test
    try { toggle.setValue(false); } catch (e) {}
    this._set("vimMode", false);
    this._startVimTest(toggle);
  };

  proto._startVimTest = function (toggle) {
    const self = this;
    const modal = new host.ButtonModal(this.app);
    modal.modalEl.addClass("mod-lg");
    modal.setTitle(ED_T(host, "labelConfirmEnableVim", "Confirm Vim mode"));
    const content = modal.contentEl;
    content.empty();
    content.createEl("p", { cls: "mod-warning", text: ED_T(host, "labelVimWarning", "Vim mode is unlike typical editors.") });
    content.createEl("p", { text: ED_T(host, "labelVimTest", "Vim check: type the command exiting without saving.") });
    const setting = new host.Setting(content);
    setting.setName(ED_T(host, "labelVimYourAnswer", "Your reply"));
    let input = null;
    setting.addText((text) => {
      input = text.inputEl;
      text.setPlaceholder(ED_T(host, "placeholderEnterCommand", "Type the command..."));
      input.addEventListener("keydown", (event) => {
        if (event.isComposing) return;
        if (event.key === "Enter") check();
      });
    });
    const check = () => {
      const answer = (input.value || "").trim();
      if (!answer) {
        try { new host.Notice(ED_T(host, "msgVimModePleaseEnterCommand", "Provide a command which activates Vim mode.")); } catch (e) {}
        return;
      }
      if (answer.toLowerCase().startsWith(":q")) {
        self.passedVimTest = true;
        self._set("vimMode", true);
        try { toggle.setValue(true); } catch (e) {}
        modal.close();
        try { new host.Notice(ED_T(host, "msgVimModeEnabled", "Vim mode activated.")); } catch (e) {}
      } else {
        try { new host.Notice(ED_T(host, "msgVimModeNotEnabled", "Vim mode stays off.")); } catch (e) {}
      }
    };
    modal.addButton("mod-cta", ED_T(host, "buttonConfirmEnableVim", "Enable Vim anyway"), () => { check(); return true; });
    modal.addCancelButton();
    modal.open();
  };

  proto.display = function () {
    const self = this;
    const app = this.app;
    this.containerEl.empty();

    // -- group 1: tab behaviour -------------------------------------------
    const g1 = new host.SettingGroup(this.containerEl);
    this._toggle(g1, "focusNewTab", "optionFocusNewTab", "optionFocusNewTabDescription", "Focus new tab", "Bring new tabs to front");
    g1.addSetting((setting) => {
      setting.setName(ED_T(host, "optionDefaultNewTabView", "Mode fresh tabs start in"))
        .setDesc(ED_T(host, "optionDefaultNewTabViewDescription", "How a new Markdown tab first appears."));
      setting.addDropdown((dropdown) => {
        dropdown.addOption("source", ED_T(host, "optionDefaultNewTabViewEditing", "Edit mode"));
        dropdown.addOption("preview", ED_T(host, "optionDefaultNewTabViewReading", "Read mode"));
        dropdown.setValue(self._cfg("defaultViewMode") === "preview" ? "preview" : "source");
        dropdown.onChange((value) => self._set("defaultViewMode", value));
      });
    });
    g1.addSetting((setting) => {
      setting.setName(ED_T(host, "optionDefaultEditingMode", "Starting edit mode"))
        .setDesc(ED_T(host, "optionDefaultEditingModeDescription", "Which editing mode fresh tabs use."));
      setting.addDropdown((dropdown) => {
        dropdown.addOption("live-preview", ED_T(host, "optionDefaultEditingModeLivePreview", "Live Preview"));
        dropdown.addOption("source", ED_T(host, "optionDefaultEditingModeSource", "Source mode"));
        dropdown.setValue(self._cfg("livePreview") === false ? "source" : "live-preview");
        dropdown.onChange((value) => {
          const live = value === "live-preview";
          self._set("livePreview", live);
          // propagate to every markdown leaf's view state
          try {
            app.workspace.iterateAllLeaves((leaf) => {
              try {
                const view = leaf.view;
                if (view && view.getViewType && view.getViewType() === "markdown") {
                  const state = view.getViewState ? view.getViewState() : null;
                  if (state && state.state) {
                    state.state.source = !live;
                    if (view.setViewState) view.setViewState(state);
                  }
                }
              } catch (err) {}
            });
          } catch (err) {}
        });
      });
    });
    // editor-status internal plugin toggle
    g1.addSetting((setting) => {
      const label = "Editor status";
      setting.setName(label).setDesc("");
      setting.addToggle((toggle) => {
        const enabled = !!(app.internalPlugins && app.internalPlugins.plugins && app.internalPlugins.plugins["editor-status"] && app.internalPlugins.plugins["editor-status"].enabled);
        toggle.setValue(enabled);
        toggle.onChange((on) => {
          try {
            const plugin = app.internalPlugins && app.internalPlugins.plugins && app.internalPlugins.plugins["editor-status"];
            if (plugin) {
              if (on) plugin.enable(true); else plugin.disable(true);
            }
          } catch (err) {}
        });
      });
    });

    // -- group 2: display ---------------------------------------------------
    const g2 = new host.SettingGroup(this.containerEl);
    g2.addHeading(() => ED_T(host, "sectionDisplay", "Appearance"));
    this._toggle(g2, "readableLineLength", "optionReadableLineLength", "optionReadableLineDescription", "Comfortable line width", "Cap the width of text lines.");
    this._toggle(g2, "strictLineBreaks", "optionStrictLineBreak", "optionStrictLineBreakDescription", "Strict newline handling", "Keep lone line breaks.");
    this._toggle(g2, "foldHeading", "optionFoldHeading", "optionFoldHeadingDescription", "Collapse headings", "Collapse everything beneath a heading.");
    this._toggle(g2, "foldIndent", "optionFoldIndent", "optionFoldIndentDescription", "Collapse indented blocks", "Collapse nested blocks.");
    this._toggle(g2, "showLineNumber", "optionShowLineNumber", "optionShowLineNumberDescription", "Line numbering", "Numbered lines in the margin.");
    this._toggle(g2, "showIndentGuide", "optionIndentationGuide", "optionIndentationGuideDescription", "Indent guides", "Vertical guide lines.");
    this._toggle(g2, "rightToLeft", "optionRtl", "optionRtlDescription", "RTL text direction", "Writing direction defaults to RTL.");
    g2.addSetting((setting) => {
      setting.setName(ED_T(host, "optionPropertiesInDocument", "Note properties"))
        .setDesc(ED_T(host, "optionPropertiesInDocumentDescription", "How the properties block appears."));
      setting.addDropdown((dropdown) => {
        dropdown.addOption("visible", ED_T(host, "optionPropertiesVisible", "Visible"));
        dropdown.addOption("hidden", ED_T(host, "optionPropertiesHidden", "Hidden"));
        dropdown.addOption("source", ED_T(host, "optionPropertiesSource", "Source"));
        dropdown.setValue(self._cfg("propertiesInDocument") || "visible");
        dropdown.onChange((value) => self._set("propertiesInDocument", value));
      });
    });

    // -- group 3: behaviour ---------------------------------------------------
    const g3 = new host.SettingGroup(this.containerEl);
    g3.addHeading(() => ED_T(host, "sectionBehavior", "Behavior"));
    this._toggle(g3, "spellcheck", "optionSpellcheck", "optionSpellcheckDescription", "Spell check", "Enable the built-in spell checker.");
    g3.addSetting((setting) => {
      setting.setName(ED_T(host, "spellcheckDict", "Word list for spell checking"));
      setting.addButton((button) => {
        button.setButtonText(NG23ED_DL_T(host, "buttonManage", "Manage"));
        button.onClick(() => new (defineSpellcheckDictionaryModal(host))(app).open());
      });
    });
    // spellcheck languages (desktop, non-Mac)
    if (host.Platform.isDesktopApp && !host.Platform.isMacOS) {
      g3.addSetting((setting) => {
        setting.setName(ED_T(host, "spellcheckLanguages", "Languages for the spell checker"))
          .setDesc(ED_T(host, "spellcheckLanguagesDescription", "Which languages the spell checker should check."));
        const box = setting.controlEl.createDiv("spellcheck-languages");
        const render = () => {
          box.empty();
          let langs = app.getSpellcheckLanguages ? app.getSpellcheckLanguages() : [];
          if (!langs.length) {
            try {
              const locale = hostEnv().Of && hostEnv().Of.remote && hostEnv().Of.remote.app ? hostEnv().Of.remote.app.getLocale() : "";
              if (locale) langs = [locale];
            } catch (e) {}
          }
          const available = self._availableSpellLanguages();
          for (const code of langs.slice().sort((a, b) => ng23Collator.compare(self._spellName(a), self._spellName(b)))) {
            const chip = box.createSpan("setting-hotkey", (el) => {
              let label = self._spellName(code);
              if (available.length && !available.includes(code)) label += " (Not available)";
              el.setText(label);
              el.createDiv("clickable-icon", (icon) => {
                host.setIcon(icon, "lucide-x");
                icon.addEventListener("click", () => {
                  const next = (app.getSpellcheckLanguages() || []).filter((l) => l !== code);
                  app.setSpellcheckLanguages(next.length ? next : null);
                  render();
                });
              });
            });
          }
          if (!langs.length) box.createSpan("setting-hotkey mod-empty", (el) => el.setText("—"));
          // reset + add dropdown
          box.createDiv("clickable-icon", (icon) => {
            host.setIcon(icon, "lucide-rotate-ccw");
            icon.addEventListener("click", () => { app.setSpellcheckLanguages(null); render(); });
          });
          const select = box.createEl("select", { cls: "dropdown" });
          select.style.width = "80px";
          select.createEl("option", { attr: { value: "" }, text: "+" });
          const names = available.slice().sort((a, b) => ng23Collator.compare(self._spellName(a), self._spellName(b)));
          for (const code of names) select.createEl("option", { attr: { value: code }, text: self._spellName(code) });
          select.addEventListener("change", () => {
            if (!select.value) return;
            const current = app.getSpellcheckLanguages ? app.getSpellcheckLanguages() : [];
            let next = current.slice();
            if (!next.length) {
              try {
                const locale = hostEnv().Of && hostEnv().Of.remote && hostEnv().Of.remote.app ? hostEnv().Of.remote.app.getLocale() : "";
                if (locale) next = [locale];
              } catch (e) {}
            }
            if (!next.includes(select.value)) next.push(select.value);
            app.setSpellcheckLanguages(next);
            render();
          });
        };
        render();
      });
    } else if (host.Platform.isMacOS) {
      g3.addSetting((setting) => {
        setting.setName(ED_T(host, "spellcheckLanguages", "Languages for the spell checker"))
          .setDesc(ED_T(host, "spellcheckLanguagesMacDescription", "On macOS the system spell checker detects the language on its own."));
      });
    }
    this._toggle(g3, "autoPairBrackets", "optionAutoPairBrackets", "optionAutoPairBracketsDescription", "Close brackets automatically", "Insert the closing bracket as soon as you type the opening one.");
    this._toggle(g3, "autoPairMarkdown", "optionAutoPairMarkdown", "optionAutoPairMarkdownDescription", "Close Markdown markers automatically", "Auto-close markup.");
    this._toggle(g3, "smartIndentList", "optionSmartIndentLists", "optionSmartIndentListsDescription", "Smart list indentation", "Indent list entries for you.");
    this._toggle(g3, "useTab", "optionUseTabs", "optionUseTabsDescription", "Indent with tabs", "Tab inserts a tab character.");
    g3.addSetting((setting) => {
      setting.setName(ED_T(host, "optionTabSize", "Tab display width"))
        .setDesc(ED_T(host, "optionTabSizeDescription", "Rendered width of a tab stop."));
      setting.addSlider((slider) => {
        slider.setLimits(2, 8, 1);
        slider.setDynamicTooltip();
        slider.setValue(self._cfg("tabSize") || 4);
        slider.onChange((value) => self._set("tabSize", value));
      });
      setting.addExtraButton((b) => {
        b.setIcon("lucide-rotate-ccw");
        b.onClick(() => {
          self._set("tabSize", 4);
          self.display();
        });
      });
    });

    // -- group 4: advanced -----------------------------------------------------
    const g4 = new host.SettingGroup(this.containerEl);
    g4.addHeading(() => NG23ED_ABOUT_T(host, "optionAdvanced", "Advanced"));
    this._toggle(g4, "autoConvertHtml", "optionAutoConvertHtml", "optionAutoConvertHtmlDescription", "Pasted web content turns into Markdown", "HTML copied off web pages turns into Markdown.");
    this._toggle(g4, "vimMode", "optionVimKeyBindings", "optionVimKeyBindingsDescription", "Vim keys", "Vim-style editing keys.");
  };

  proto._availableSpellLanguages = function () {
    try {
      const session = this._editorSession();
      return session && session.availableSpellCheckerLanguages ? session.availableSpellCheckerLanguages.slice() : [];
    } catch (e) { return []; }
  };
  proto._editorSession = function () {
    try {
      const bridge = hostEnv().Of || env().Of;
      const electron = bridge && (bridge.remote ? bridge : bridge.electron);
      const remote = electron && electron.remote;
      const contents = remote && remote.getCurrentWebContents && remote.getCurrentWebContents();
      return contents && contents.session;
    } catch (err) { return null; }
  };
  proto._spellName = function (code) {
    try {
      const bridge = hostEnv().Of || env().Of;
      if (bridge && bridge.ym) return bridge.ym(code);
      if (env && env().ym) return env().ym(code);
    } catch (e) {}
    return code;
  };

  return EditorTab;
}
