// g23 clean-room: quick switcher internal plugin (palette.js replacement, switcher half).
// Suggestion pipeline: recents / files / aliases / unresolved links / bookmarks -> typed items.
import { inherit } from "./inherit.js";
import { env, hostEnv } from "./env.js";
import { fileClass } from "./n-g13-vault.js";
import { withoutMd, withoutExtension, targetText as ng23TargetText } from "./path.js";
import { frontmatterAliases } from "./frontmatter.js";
import { prepareFuzzyFinder, prepareSimpleFinder, renderMatches } from "./search-simple.js";
import { sortHitsByScore } from "./misc.js";
import { makeHotkey } from "./text.js";
import { ng23T, ng23Contains, ng23SplitPrefix, ng23FormatHotkey, ng23WalkBookmarks, ng23Collator } from "./n-g23-util.js";

const ng23SwHost = () => __basaltHost;
const ng23TFile = () => fileClass("TFile");
const ng23TFolder = () => fileClass("TFolder");
const QS_T = (host, key, fallback, arg) => ng23T(host, "plugins.quickSwitcher." + key, fallback, arg);

/** Default data.json options of the switcher plugin (manifest declarator v9). */
export const QUICK_SWITCHER_DEFAULTS = { showExistingOnly: false, showAttachments: true, showAllFileTypes: false };

// Shared slot so the modal base and the plugin see each other regardless of factory order.
export const ng23Sw = {};

/** Image extension check through the host list. */
function ng23IsImage(host, ext) {
  const list = host.imageExtensions;
  return !!list && (Array.isArray(list) ? list.includes(ext) : list.has(ext));
}

/** Whether a file extension may appear in the switcher under the current flags. */
export function ng23ShowsExtension(host, app, file, flags, context) {
  const ext = file.extension;
  if (ext === "md") return !!flags.shouldShowMarkdown;
  if (ext === "canvas" || ext === "base") return !!flags.shouldShowNonAttachments;
  if (ng23IsImage(host, ext)) return !!flags.shouldShowImages;
  if (flags.shouldShowAllTypes) return true;
  if (!flags.shouldShowNonImageAttachments) return false;
  const reg = context === "embed" ? app.embedRegistry : app.viewRegistry;
  try { return !!(reg && reg.isExtensionRegistered(ext)); } catch (err) { return false; }
}

/** Drag text for a suggestion (delegates to the shared path helper). */
export function ng23SwTargetText(suggestion) {
  return ng23TargetText(suggestion) || "";
}

// ===========================================================================
// QuickSwitcherModalBase (orig U2): SuggestModal subclass with behaviour flags.
// ===========================================================================

export function defineQuickSwitcherModalBase(host) {
  function QuickSwitcherModalBase(app) {
    const self = host.SuggestModal.call(this, app) || this;
    // behaviour flags (subclasses set these after construction; read lazily)
    self.shouldShowMarkdown = true;
    self.shouldShowNonAttachments = true;
    self.shouldShowImages = true;
    self.shouldShowNonImageAttachments = true;
    self.shouldShowAllTypes = false;
    self.shouldShowUnresolved = true;
    self.shouldShowAlias = true;
    self.shouldShowNonFileBookmarks = true;
    self.allowCreateNewFile = false;
    self.context = "view";
    self.limit = 20;
    // Enter variants: Shift/Cmd+Shift create, plain Enter picks (chooser handles plain)
    self.scope.register(["Shift"], "Enter", (event) => {
      if (event.isComposing) return undefined;
      self.selectSuggestion(null, event);
      return false;
    });
    self.scope.register(["Mod", "Shift"], "Enter", (event) => {
      if (event.isComposing) return undefined;
      self.selectSuggestion(null, event);
      return false;
    });
    return self;
  }
  inherit(QuickSwitcherModalBase, host.SuggestModal);
  const proto = QuickSwitcherModalBase.prototype;

  proto.showsExtension = function (file) {
    return ng23ShowsExtension(host, this.app, file, this, this.context);
  };

  /** Flags come from plugin options when the instance exposes them (set by QuickSwitcherModal). */
  proto._flags = function () {
    const f = this._flagSource || {};
    return {
      shouldShowMarkdown: f.showMarkdown !== false && this.shouldShowMarkdown !== false,
      shouldShowNonAttachments: this.shouldShowNonAttachments,
      shouldShowImages: this.shouldShowImages,
      shouldShowNonImageAttachments: this.shouldShowNonImageAttachments,
      shouldShowAllTypes: this.shouldShowAllTypes,
      shouldShowUnresolved: this.shouldShowUnresolved,
      shouldShowAlias: this.shouldShowAlias,
      shouldShowNonFileBookmarks: this.shouldShowNonFileBookmarks,
    };
  };

  // ---- suggestion sources -------------------------------------------------

  proto._fileSuggestions = function (query, prepared) {
    const app = this.app;
    const flags = this._flags();
    const showExistingOnly = !!(this._flagSource && this._flagSource.showExistingOnly);
    const files = app.vault.getAllLoadedFiles ? app.vault.getAllLoadedFiles() : app.vault.getFiles();
    const TFile = ng23TFile();
    const hits = [];
    const matcher = prepared || null;
    for (const file of files) {
      if (!(file instanceof TFile)) continue;
      if (!this.showsExtension(file)) continue;
      const linkPath = withoutMd(file.path);
      let match = null;
      if (matcher) {
        match = matcher(file.basename) || matcher(linkPath);
        if (match && match !== true) {
          // whole-path fallback scores slightly worse than a basename hit
          if (matcher(file.basename) !== match) match.score -= 5;
        }
      }
      if (query && !match) continue;
      if (showExistingOnly && !match) continue;
      const downranked = !!(app.metadataCache && app.metadataCache.isUserIgnored && app.metadataCache.isUserIgnored(file.path));
      hits.push({ type: "file", match: match || { score: 0, matches: [] }, file, downranked });
    }
    return hits;
  };

  proto._recentSuggestions = function () {
    const app = this.app;
    const flags = this._flags();
    const TFile = ng23TFile();
    const recents = (app.workspace.getRecentFiles && app.workspace.getRecentFiles()) || [];
    const out = [];
    for (const path of recents) {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) continue;
      if (app.metadataCache && app.metadataCache.isUserIgnored && app.metadataCache.isUserIgnored(file.path)) continue;
      if (!this.showsExtension(file)) continue;
      out.push({ type: "file", match: null, file });
    }
    return out;
  };

  proto._aliasSuggestions = function (query, matcher) {
    if (!this._flags().shouldShowAlias || !matcher) return [];
    const app = this.app;
    const TFile = ng23TFile();
    const out = [];
    const seen = new Set();
    for (const file of app.vault.getMarkdownFiles()) {
      const cache = app.metadataCache && app.metadataCache.getFileCache ? app.metadataCache.getFileCache(file) : null;
      if (!cache) continue;
      const aliases = frontmatterAliases(cache.frontmatter) || [];
      for (const alias of aliases) {
        const key = String(alias).toLowerCase();
        if (seen.has(key)) continue;
        const match = matcher(String(alias));
        if (!match) continue;
        seen.add(key);
        out.push({ type: "alias", match, file, alias: String(alias) });
      }
    }
    return out;
  };

  proto._unresolvedSuggestions = function (matcher) {
    if (!this._flags().shouldShowUnresolved || !matcher) return [];
    const app = this.app;
    const links = (app.metadataCache && app.metadataCache.unresolvedLinks) || {};
    const seen = new Set();
    const out = [];
    for (const sourcePath of Object.keys(links)) {
      const perFile = links[sourcePath] || {};
      for (const linktext of Object.keys(perFile)) {
        if (seen.has(linktext)) continue;
        const match = matcher(linktext);
        if (!match) continue;
        seen.add(linktext);
        out.push({ type: "unresolved", match, linktext });
      }
    }
    return out;
  };

  proto._bookmarkSuggestions = function (matcher) {
    const flags = this._flags();
    const app = this.app;
    const plugin = app.internalPlugins && app.internalPlugins.getEnabledPluginById
      ? app.internalPlugins.getEnabledPluginById("bookmarks") : null;
    const instance = plugin && plugin.instance;
    if (!instance || !Array.isArray(instance.items)) return [];
    const bookmarksEnabled = app.internalPlugins.getPluginById
      ? (() => { const w = app.internalPlugins.getPluginById("bookmarks"); return !!(w && w.enabled); })() : true;
    if (!bookmarksEnabled) return [];
    const TFile = ng23TFile();
    const webviewer = app.internalPlugins.getEnabledPluginById ? app.internalPlugins.getEnabledPluginById("webviewer") : null;
    const out = [];
    ng23WalkBookmarks(instance.items, (item) => {
      if (!item || item.type === "group") return;
      let path = "";
      if (item.type === "file") {
        const file = app.vault.getAbstractFileByPath(item.path);
        if (!(file instanceof TFile)) return;
        if (!this.showsExtension(file)) return;
        path = withoutMd(file.path) + (item.subpath || "");
      } else if (item.type === "folder") {
        if (!flags.shouldShowNonFileBookmarks) return;
        path = item.path;
      } else if (item.type === "search") {
        if (!flags.shouldShowNonFileBookmarks) return;
        path = item.query || "";
      } else if (item.type === "url") {
        if (!flags.shouldShowNonFileBookmarks) return;
        path = item.url || "";
      } else if (item.type === "graph") {
        if (!flags.shouldShowNonFileBookmarks) return;
        path = item.title || "";
      } else {
        return;
      }
      const match = matcher ? matcher(path) : null;
      if (matcher && !match) return;
      out.push({ type: "bookmark", match: match || { score: 0, matches: [] }, item, bookmarkPath: path });
    });
    void webviewer;
    return out;
  };

  // ---- query pipeline -----------------------------------------------------

  proto.getSuggestions = function (query) {
    query = String(query == null ? "" : query);
    const trimmed = query.trim();
    const app = this.app;
    if (!trimmed) return this._recentSuggestions();
    const files = app.vault.getAllLoadedFiles ? app.vault.getAllLoadedFiles() : app.vault.getFiles();
    const matcher = files.length < 10000 ? prepareFuzzyFinder(trimmed) : prepareSimpleFinder(trimmed);
    const hits = [];
    hits.push(...this._fileSuggestions(trimmed, matcher));
    hits.push(...this._aliasSuggestions(trimmed, matcher));
    hits.push(...this._unresolvedSuggestions(matcher));
    hits.push(...this._bookmarkSuggestions(matcher));
    for (const h of hits) if (h.match && h.match.score != null && h.downranked) h.match.score -= 30;
    hits.sort((a, b) => (b.match ? b.match.score : 0) - (a.match ? a.match.score : 0));
    return hits;
  };

  proto.onNoSuggestion = function () {
    const canCreate = this.allowCreateNewFile && this.shouldShowMarkdown !== false;
    if (this.inputEl.value.trim() && canCreate) {
      this.chooser.setSuggestions([null]);
      return;
    }
    this.chooser.setSuggestions(null);
    this.chooser.addMessage(this.emptyStateText || QS_T(host, "labelNoNoteCreateNew", "Zero matches"));
  };

  /** Render one suggestion row (value is our typed item or null). */
  proto.renderSuggestion = function (result, el) {
    el.addClass("mod-complex");
    const content = el.createDiv("suggestion-content");
    const aux = el.createDiv("suggestion-aux");
    const app = this.app;
    if (result === null || result === undefined) {
      content.setText(this.inputEl.value);
      aux.setText(QS_T(host, "labelEnterToCreate", "Hit Enter and it appears"));
      return;
    }
    const type = result.type;
    if (type === "file" || type === "alias") {
      const file = result.file;
      const title = type === "alias" ? result.alias : withoutMd(file.path);
      if (result.match && result.match.matches && result.match.matches.length) renderMatches(content.createSpan(), title, result.match.matches);
      else content.setText(title);
      if (type === "alias") {
        aux.setText(withoutMd(file.path));
        const flair = el.createDiv("suggestion-flair");
        host.setIcon(flair, "lucide-forward");
        try { host.setTooltip(flair, QS_T(host, "tooltipAlias", "Alias")); } catch (e) {}
      }
    } else if (type === "unresolved") {
      if (result.match && result.match.matches && result.match.matches.length) renderMatches(content.createSpan(), result.linktext, result.match.matches);
      else content.setText(result.linktext);
      const flair = el.createDiv("suggestion-flair");
      host.setIcon(flair, "lucide-file-plus");
      try { host.setTooltip(flair, QS_T(host, "tooltipNotCreatedYet", "Not created yet")); } catch (e) {}
    } else if (type === "bookmark") {
      const item = result.item || {};
      const path = result.bookmarkPath || "";
      if (result.match && result.match.matches && result.match.matches.length) renderMatches(content.createSpan(), path, result.match.matches);
      else content.setText(path);
      const flair = el.createDiv("suggestion-flair");
      let icon = "lucide-bookmark";
      if (item.type === "search") { icon = "lucide-search"; aux.setText(item.query || ""); }
      else if (item.type === "url") { icon = "lucide-globe-2"; aux.setText(item.url || ""); }
      else if (item.type === "graph") { icon = "lucide-git-fork"; }
      else if (item.type === "folder") { icon = "lucide-bookmark"; aux.setText(item.path || ""); }
      else if (item.type === "file") { icon = "lucide-bookmark"; aux.setText(withoutMd(item.path || "") + (item.subpath || "")); }
      host.setIcon(flair, icon);
      if (item.type === "url") {
        const wv = app.internalPlugins && app.internalPlugins.getEnabledPluginById ? app.internalPlugins.getEnabledPluginById("webviewer") : null;
        const db = wv && wv.instance && wv.instance.db;
        if (db && db.setIcon) { try { db.setIcon(flair, item.url); } catch (e) {} }
      }
    }
    if (result.downranked) el.addClass("mod-downranked");
    const text = ng23SwTargetText(result);
    if (text) {
      el.draggable = true;
      el.addEventListener("dragstart", (event) => {
        try {
          const drag = app.dragManager.dragLink(event, text, "", "");
          app.dragManager.onDragStart(event, drag);
          el.addClass("is-being-dragged");
        } catch (err) {}
      });
      el.addEventListener("dragend", () => el.removeClass("is-being-dragged"));
    }
  };

  proto.onChooseSuggestion = function (suggestion, event) {
    const app = this.app;
    if (suggestion === null || suggestion === undefined) {
      app.workspace.openLinkText(this.inputEl.value, this._sourcePath(), host.Keymap.isModEvent(event) ? "tab" : false, true);
      return;
    }
    const newLeaf = !!host.Keymap.isModEvent(event);
    if (suggestion.type === "file" || suggestion.type === "alias") {
      app.workspace.getLeaf(newLeaf ? "tab" : false).openFile(suggestion.file, { active: true });
    } else if (suggestion.type === "unresolved") {
      app.workspace.openLinkText(suggestion.linktext, this._sourcePath(), newLeaf ? "tab" : false, true);
    } else if (suggestion.type === "bookmark") {
      const plugin = app.internalPlugins.getEnabledPluginById("bookmarks");
      if (plugin && plugin.instance && plugin.instance.openBookmark) plugin.instance.openBookmark(suggestion.item, newLeaf);
    }
  };

  proto._sourcePath = function () {
    const app = this.app;
    try {
      const view = app.workspace.getActiveViewOfType && app.workspace.getActiveViewOfType(host.FileView);
      if (view && view.file) return view.file.path;
    } catch (err) {}
    const file = app.workspace.getActiveFile && app.workspace.getActiveFile();
    return file ? file.path : "";
  };
  inherit(QuickSwitcherModalBase, host.SuggestModal);
  ng23Sw.ModalBase = QuickSwitcherModalBase;
  return QuickSwitcherModalBase;
}

// ===========================================================================
// QuickSwitcherModal (orig y9): the concrete switcher dialog.
// ===========================================================================

export function defineQuickSwitcherModal(host) {
  function QuickSwitcherModal(app, plugin) {
    const Base = ng23Sw.ModalBase || host.s13QuickSwitcherModalBase;
    const self = Base.call(this, app) || this;
    self.plugin = plugin;
    self._flagSource = plugin ? plugin.options : {};
    self.limit = 20;
    const showExistingOnly = !!self._flagSource.showExistingOnly;
    self.shouldShowUnresolved = !showExistingOnly;
    self.allowCreateNewFile = true;
    self.emptyStateText = "";
    self.setPlaceholder(QS_T(host, "promptTypeFileName", "Search notes, or start a fresh one..."));
    const mac = host.isMacLike;
    self.setInstructions([
      { command: "↑↓", purpose: QS_T(host, "instructionNavigate", "for moving around") },
      { command: "↵", purpose: QS_T(host, "instructionOpen", "to open") },
      { command: mac ? "⌘ ⌥ ↵" : "ctrl alt ↵", purpose: QS_T(host, "instructionOpenToTheRight", "for opening on the right side") },
      { command: mac ? "⌘ ↵" : "ctrl ↵", purpose: QS_T(host, "instructionOpenInNewTab", "for opening in a fresh tab") },
      { command: "shift ↵", purpose: QS_T(host, "instructionCreate", "to create") },
      { command: "esc", purpose: QS_T(host, "instructionDismiss", "to close") },
    ]);
    return self;
  }
  inherit(QuickSwitcherModal, ng23Sw.ModalBase || host.SuggestModal);
  const proto = QuickSwitcherModal.prototype;

  proto.getSuggestions = function (query) {
    // flags refresh from live plugin options each query
    if (this.plugin) this._flagSource = this.plugin.options || {};
    const showExistingOnly = !!this._flagSource.showExistingOnly;
    this.shouldShowUnresolved = !showExistingOnly;
    return ng23Sw.ModalBase.prototype.getSuggestions.call(this, query);
  };

  proto.onOpen = function () {
    host.SuggestModal.prototype.onOpen.call(this);
    this._mountCreateButton();
  };

  /** Mobile floating create button on ctaEl while input is non-empty. */
  proto._mountCreateButton = function () {
    if (!host.Platform.isMobile || !this.allowCreateNewFile) return;
    const self = this;
    const btn = this.ctaEl.createDiv("clickable-icon mod-cta");
    btn.hide();
    host.setIcon(btn, "lucide-file-plus");
    btn.addEventListener("click", () => {
      if (btn.getAttribute("aria-disabled") === "true") return;
      self.selectSuggestion(null, self.app.lastEvent);
    });
    const sync = () => {
      const show = self.inputEl.value.trim().length > 0;
      btn.toggle(show);
      if (show) {
        const first = self.chooser && self.chooser.values && self.chooser.values[0];
        const firstText = first ? ng23SwTargetText(first) : "";
        const disabled = firstText !== "" && firstText === self.inputEl.value.trim();
        btn.setAttribute("aria-disabled", disabled ? "true" : "false");
        try { host.runTransition(btn, new host.Transition({ fn: "var(--anim-motion-swing)", duration: 120 }).addProp("transform", "scale(0.6)", "scale(1)", "")); } catch (e) {}
      }
    };
    this.inputEl.addEventListener("input", sync);
    sync();
    this._createButton = btn;
  };
  return QuickSwitcherModal;
}

// ===========================================================================
// QuickSwitcherSettingTab (orig b9): plugin settings for `switcher`.
// ===========================================================================

export function defineQuickSwitcherSettingTab(host) {
  function QuickSwitcherSettingTab(app, pluginInstance, wrapper) {
    const self = host.PluginInstanceSettingTab.call(this, app, wrapper) || this;
    self.icon = "file-search";
    self.pluginInstance = pluginInstance;
    return self;
  }
  inherit(QuickSwitcherSettingTab, host.PluginInstanceSettingTab);
  const proto = QuickSwitcherSettingTab.prototype;

  proto.display = function () {
    const self = this;
    const inst = this.pluginInstance;
    const plugin = inst && inst.plugin;
    const options = (inst && inst.options) || (plugin && plugin.options) || {};
    const save = () => { if (plugin && plugin.saveData) plugin.saveData(options); };
    this.containerEl.empty();
    const group = new host.SettingGroup(this.containerEl);

    const addToggle = (nameKey, nameFb, descKey, descFb, optKey) => {
      group.addSetting((setting) => {
        setting.setName(QS_T(host, nameKey, nameFb)).setDesc(QS_T(host, descKey, descFb));
        setting.addToggle((toggle) => {
          toggle.setValue(!!options[optKey]).onChange((value) => {
            options[optKey] = value;
            if (inst) inst.options = options;
            save();
          });
        });
      });
    };

    addToggle("optionShowExistingOnly", "Existing files only", "optionShowExistingOnlyDescription", "", "showExistingOnly");
    addToggle("optionShowAttachments", "Include attachments", "optionShowAttachmentsDesc", "", "showAttachments");
    const vault = this.app.vault;
    const showAll = vault && vault.getConfig && vault.getConfig("showUnsupportedFiles");
    if (showAll) {
      addToggle("optionShowAllFileTypes", "Include every file type", "optionShowAllFileTypesDesc", "", "showAllFileTypes");
    }
    void self;
  };
  return QuickSwitcherSettingTab;
}

// ===========================================================================
// QuickSwitcherPlugin (orig g9): internal plugin id `switcher`.
// ===========================================================================

export function defineQuickSwitcherPlugin(host) {
  function QuickSwitcherPlugin() {
    this.id = "switcher";
    this.name = QS_T(host, "name", "Quick switcher");
    this.description = QS_T(host, "desc", "Switch between files using the keyboard only.");
    this.defaultOn = true;
    this.options = Object.assign({}, QUICK_SWITCHER_DEFAULTS);
    this.app = null;
    this.plugin = null;
    this.activeModal = null;
  }
  const proto = QuickSwitcherPlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    const self = this;
    plugin.loadData().then((data) => {
      self.options = Object.assign({}, QUICK_SWITCHER_DEFAULTS, data && typeof data === "object" ? data : {});
    });
  };

  proto.onEnable = function (app, plugin) {
    const self = this;
    plugin.registerRibbonItem(QS_T(host, "actionOpen", "Quick switcher"), "lucide-file-search", () => self.onOpen());
    plugin.registerGlobalCommand({
      id: "switcher:open",
      name: QS_T(host, "actionOpen", "Quick switcher"),
      icon: "lucide-navigation",
      hotkeys: [makeHotkey(["Mod"], "O")],
      callback: () => self.onOpen(),
    });
    plugin.addSettingTab(new (defineQuickSwitcherSettingTab(host))(app, this, plugin));
  };

  proto.onExternalSettingsChange = function () {
    const self = this;
    this.plugin.loadData().then((data) => {
      self.options = Object.assign({}, QUICK_SWITCHER_DEFAULTS, data && typeof data === "object" ? data : {});
    });
  };

  proto.onOpen = function () {
    if (this.activeModal) { this.activeModal.open(); return; }
    const Modal = defineQuickSwitcherModal(host);
    const modal = new Modal(this.app, this);
    this.activeModal = modal;
    modal.setCloseCallback(() => { if (this.activeModal === modal) this.activeModal = null; });
    modal.open();
  };
  return QuickSwitcherPlugin;
}
