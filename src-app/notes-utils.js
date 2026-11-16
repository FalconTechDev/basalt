// Small core plugins: templates (insert a note with {{variables}}), daily notes, random note and the
// word/character counter in the status bar.
//
// TemplatesPlugin (wee) lists the ".md" files of a configured folder, substitutes {{title}} and
// {{date}}/{{time}} placeholders (applyTemplateVars) and can split off leading frontmatter into the
// metadata editor. Its picker is TemplateSuggestModal (kee, a FuzzySuggestModal) and its settings live
// in TemplatesSettingTab (Cee).
//
// DailyNotesPlugin (v8) resolves the note for a moment-format date (default "YYYY-MM-DD") inside a
// configurable folder, creates it from an optional template, jumps to the previous/next existing daily
// note and wires the "daily" protocol handler plus the daily:* CLI commands. DailyNotesSettingTab (y8)
// edits format/folder/template.
//
// RandomNotePlugin (w9) opens a random markdown file. WordCountPlugin (Pee) counts words in a Web
// Worker (the same regex the stock worker used) and shows words/characters in the status bar and the
// mobile file info.
//
// Shared helpers ported alongside: the frontmatter bounds scanner (frontmatterBounds), the
// template-content splitter (splitTemplateContent) and the pane-type argument check (paneTypeArg).

import { inherit } from "./inherit.js";
import { debounceCall } from "./timing.js";
import { normalizePath, withoutExtension, lastSegment } from "./path.js";
import { fileClass } from "./vault.js";

const MarkdownFile = () => fileClass("TFile");
const MarkdownFolder = () => fileClass("TFolder");

// Registry populated by the factories below; sibling factories reach each other's classes through it.
export const notes = {
  templates: {},
  dailyNotes: {},
  randomNote: {},
  wordCount: {},
};

const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
const DEFAULT_TIME_FORMAT = "HH:mm";
const DAILY_NOTE_FORMATS = [DEFAULT_DATE_FORMAT, "YYYY.MM.DD", "YYYY/MM/DD", "YYYY/MM/YYYY-MM-DD"];

// Case-insensitive, numeric-aware name comparison (same collator the rest of the app sorts with).
const notesCollator = new Intl.Collator(undefined, { usage: "sort", sensitivity: "base", numeric: true }).compare;

// host is provided per factory; notesHost is bound by the first factory that runs (all share the same host).
let notesHost = null;
function bindNotesHost(host) {
  notesHost = host;
  return host;
}

const templatesT = () => notesHost.t.plugins.templates;
const dailyT = () => notesHost.t.plugins.dailyNotes;
const randomT = () => notesHost.t.plugins.randomNote;
const wordCountT = () => notesHost.t.plugins.wordCount;

// =====================================================================================================================
// Template helpers
// =====================================================================================================================

/**
 * Replaces {{key}} placeholders with the given values and {{date}}/{{time}} (optionally
 * {{date:format}}/{{time:format}}) with the current moment. `options` may carry dateFormat/timeFormat.
 */
export function applyTemplateVars(text, values, options) {
  for (const key of Object.keys(values)) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
    const re = new RegExp("{{" + key + "}}", "gi");
    text = text.replace(re, values[key]);
  }
  let moment = null;
  return text.replace(/{{(date|time)(?::(.*?))?}}/gi, (match, kind, format) => {
    if (!moment) moment = window.moment();
    if (format) return moment.format(format);
    return kind.toLowerCase() === "date"
      ? moment.format((options && options.dateFormat) || DEFAULT_DATE_FORMAT)
      : moment.format((options && options.timeFormat) || DEFAULT_TIME_FORMAT);
  });
}

const FRONTMATTER_START = /^---(\r?\n)/g;
const FRONTMATTER_END = /---(\r?\n|$)/g;

/** Locates a leading "---" frontmatter block; returns its bounds or exists:false. */
export function frontmatterBounds(text) {
  FRONTMATTER_START.lastIndex = 0;
  if (!FRONTMATTER_START.exec(text)) return { exists: false, contentStart: 0, from: 0, to: 0, frontmatter: "" };
  const from = FRONTMATTER_START.lastIndex;
  FRONTMATTER_END.lastIndex = from;
  let end = FRONTMATTER_END.exec(text);
  while (end && text.charAt(end.index - 1) !== "\n") end = FRONTMATTER_END.exec(text);
  if (!end) return { exists: false, contentStart: 0, from: 0, to: 0, frontmatter: "" };
  const to = end.index;
  const contentStart = FRONTMATTER_END.lastIndex;
  return { exists: true, frontmatter: text.slice(from, to), from, to, contentStart };
}

/** Splits a note into body + parsed frontmatter object (for insertTemplate's metadataEditor path). */
export function splitTemplateContent(text) {
  const bounds = frontmatterBounds(text);
  const content = text.slice(bounds.contentStart);
  const frontmatter = bounds.frontmatter ? notesHost.parseYaml(bounds.frontmatter) : undefined;
  return { content, frontmatter };
}

/** getLeaf() argument check: returns the pane type when it is a usable one, else false. */
export function paneTypeArg(value) {
  return (typeof value === "boolean" || value === "tab" || value === "window" || value === "split") ? value : false;
}

// =====================================================================================================================
// Templates
// =====================================================================================================================

export function defineTemplatesPlugin(host) {
  bindNotesHost(host);

  function TemplatesPlugin() {
    this.id = "templates";
    this.name = templatesT().name();
    this.description = templatesT().desc();
    this.defaultOn = true;
    this.app = null;
    this.plugin = null;
    this.options = {};
    this.templateFiles = [];
  }
  const proto = TemplatesPlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerRibbonItem(templatesT().actionInsert(), "lucide-files", this.onInsertTemplate.bind(this));
    plugin.registerGlobalCommand({ id: "insert-template", name: templatesT().actionInsert(), icon: "lucide-copy", callback: this.onInsertTemplate.bind(this) });
    plugin.registerGlobalCommand({ id: "insert-current-date", name: templatesT().actionInsertCurrentDate(), icon: "lucide-calendar-days", editorCallback: this.insertCurrentDate.bind(this) });
    plugin.registerGlobalCommand({ id: "insert-current-time", name: templatesT().actionInsertCurrentTime(), icon: "lucide-clock", editorCallback: this.insertCurrentTime.bind(this) });
  };

  proto.onEnable = async function (app, plugin) {
    this.options = (await plugin.loadData()) || {};
    plugin.addSettingTab(new notes.templates.SettingTab(app, plugin, this));

    plugin.registerCliHandler("templates", "List templates", { total: { description: "Return template count" } }, async (args) => {
      const folderOption = this.options.folder;
      if (!folderOption || typeof folderOption !== "string") throw "No template folder configured.";
      const folderPath = normalizePath(folderOption);
      const folder = app.vault.getFolderByPath(folderPath);
      if (!folder) throw 'Template folder "' + folderOption + '" not found.';
      const names = [];
      host.VaultClass.recurseChildren(folder, (item) => {
        if (item instanceof MarkdownFile() && item.extension === "md") names.push(item.path.slice(folderPath.length + 1, -3));
      });
      if (args.total) return String(names.length);
      if (names.length === 0) return "No templates found.";
      names.sort(notesCollator);
      return names.join("\n");
    });

    plugin.registerCliHandler("template:read", "Read template content", {
      name: { value: "<template>", description: "Template name", required: true },
      resolve: { description: "Resolve template variables" },
      title: { value: "<title>", description: "Title for variable resolution" },
    }, async (args) => {
      const file = this.resolveTemplateFile(args.name);
      if (typeof file === "string") throw file;
      let content = await app.vault.cachedRead(file);
      if (args.resolve) {
        content = applyTemplateVars(content, { title: args.title != null ? args.title : "" }, {
          dateFormat: this.options.dateFormat,
          timeFormat: this.options.timeFormat,
        });
      }
      return content;
    });

    plugin.registerCliHandler("template:insert", "Insert template into active file", {
      name: { value: "<template>", description: "Template name", required: true },
    }, async (args) => {
      const file = this.resolveTemplateFile(args.name);
      if (typeof file === "string") throw file;
      const editor = app.workspace.activeEditor;
      if (!editor || !editor.editor) throw "No active editor. Open a file first.";
      await this.insertTemplate(file);
      return "Inserted template: " + file.basename;
    });
  };

  proto.onExternalSettingsChange = async function () {
    this.options = (await this.plugin.loadData()) || {};
  };

  /** Returns the TFile, or an error string when the name/folder cannot be resolved. */
  proto.resolveTemplateFile = function (name) {
    if (!name) return "Missing required parameter: name\nUsage: name=<template>";
    const folderOption = this.options.folder;
    if (!folderOption || typeof folderOption !== "string") return "No template folder configured.";
    const folderPath = normalizePath(folderOption);
    const folder = this.app.vault.getFolderByPath(folderPath);
    if (!folder) return 'Template folder "' + folderOption + '" not found.';
    let path = folderPath + "/" + name;
    if (!path.endsWith(".md")) path += ".md";
    const direct = this.app.vault.getFileByPath(path);
    if (direct) return direct;
    const candidates = [];
    host.VaultClass.recurseChildren(folder, (item) => {
      if (item instanceof MarkdownFile() && item.extension === "md") candidates.push(item);
    });
    const wanted = name.toLowerCase();
    const found = candidates.find((item) => item.path.slice(folderPath.length + 1, -3).toLowerCase() === wanted);
    return found || 'Template "' + name + '" not found.';
  };

  proto.insertTemplate = async function (file) {
    const app = this.app;
    const workspace = app.workspace;
    const vault = app.vault;
    const view = workspace.activeEditor;
    if (!view) return;
    const editor = view.editor;
    const sourceFile = view.file;
    let content = await vault.cachedRead(file);
    content = applyTemplateVars(content, { title: sourceFile ? sourceFile.basename : "" }, {
      dateFormat: this.options.dateFormat,
      timeFormat: this.options.timeFormat,
    });
    const cursor = editor.getCursor("from");
    if (cursor.line === 0 && cursor.ch === 0) {
      editor.replaceSelection(content);
      return;
    }
    let body;
    let frontmatter;
    try {
      const split = splitTemplateContent(content);
      body = split.content;
      frontmatter = split.frontmatter;
    } catch (e) {
      new host.Notice(templatesT().msgFailInvalidTemplateProperties());
      return;
    }
    editor.replaceSelection(body);
    if (frontmatter && host.hasMetadataEditor(view)) {
      view.metadataEditor.insertProperties(frontmatter);
    }
  };

  proto.onInsertTemplate = function () {
    const app = this.app;
    const options = this.options;
    const folderOption = options.folder;
    if (!folderOption || typeof folderOption !== "string") {
      new host.Notice(templatesT().msgNoFolderSet());
      return;
    }
    const folderPath = normalizePath(folderOption);
    const folder = app.vault.getFolderByPath(folderPath);
    if (!folder) {
      new host.Notice(templatesT().msgFailFolderNotFound({ folderOption }));
      return;
    }
    if (folder.isRoot()) {
      new host.Notice(templatesT().msgFailInvalidFolder());
      return;
    }
    this.templateFiles = [];
    host.VaultClass.recurseChildren(folder, (item) => {
      if (item instanceof MarkdownFile() && item.extension === "md") this.templateFiles.push(item);
    });
    this.templateFiles.sort((a, b) => notesCollator(a.path, b.path));
    new notes.templates.SuggestModal(app, this, folderPath).open();
  };

  proto.insertCurrentDate = function (editor) {
    const format = this.options.dateFormat || DEFAULT_DATE_FORMAT;
    this.insertText(editor, window.moment().format(format));
  };

  proto.insertCurrentTime = function (editor) {
    const format = this.options.timeFormat || DEFAULT_TIME_FORMAT;
    this.insertText(editor, window.moment().format(format));
  };

  proto.insertText = function (editor, text) {
    const pos = editor.getCursor("head");
    editor.transaction({
      changes: [{ text, from: pos }],
      selection: { from: { line: pos.line, ch: pos.ch + text.length } },
    });
  };

  notes.templates.Plugin = TemplatesPlugin;
  return TemplatesPlugin;
}

export function defineTemplateSuggestModal(host) {
  bindNotesHost(host);

  function TemplateSuggestModal(app, templatePlugin, sourcePath) {
    const self = host.FuzzySuggestModal.call(this, app) || this;
    self.emptyStateText = templatesT().msgNoTemplatesFound();
    self.templatePlugin = null;
    self.sourcePath = "";
    self.templatePlugin = templatePlugin;
    self.sourcePath = sourcePath;
    self.setInstructions([
      { command: "↑↓", purpose: templatesT().instructionNavigate() },
      { command: "↵", purpose: templatesT().instructionInsert() },
      { command: "esc", purpose: templatesT().instructionDismiss() },
    ]);
    self.setPlaceholder(templatesT().promptTypeTemplate());
    self.scope.register(null, "Tab", () => false);
    return self;
  }
  inherit(TemplateSuggestModal, host.FuzzySuggestModal);
  const proto = TemplateSuggestModal.prototype;

  proto.getItems = function () {
    return this.templatePlugin.templateFiles;
  };

  proto.onChooseItem = function (item) {
    this.templatePlugin.insertTemplate(item);
  };

  proto.getItemText = function (item) {
    return withoutExtension(item.path).slice(this.sourcePath.length + 1);
  };

  notes.templates.SuggestModal = TemplateSuggestModal;
  return TemplateSuggestModal;
}

export function defineTemplatesSettingTab(host) {
  bindNotesHost(host);

  function TemplatesSettingTab(app, plugin, instance) {
    const self = host.PluginInstanceSettingTab.call(this, app, plugin) || this;
    self.icon = "files";
    self.instance = instance;
    return self;
  }
  inherit(TemplatesSettingTab, host.PluginInstanceSettingTab);
  const proto = TemplatesSettingTab.prototype;

  proto.display = function () {
    const self = this;
    const containerEl = this.containerEl;
    containerEl.empty();
    const options = this.instance.options;

    // The format descriptions embed literal {{...}} examples; the i18n layer needs the same
    // interpolation override the stock settings page passed.
    const i18nOptions = { interpolation: { prefix: "{{{{", suffix: "}}}}" } };
    const dateDesc = createFragment((frag) => {
      frag.appendText(templatesT().optionTemplateDateFormatDescription(i18nOptions));
      frag.createEl("br");
      frag.appendText(templatesT().optionTemplateDateFormatDescription2(i18nOptions));
      frag.createEl("br");
      frag.appendText(dailyT().labelReferToSyntax());
      frag.createEl("a", { text: dailyT().labelSyntaxLink(), attr: { href: "https://momentjs.com/docs/#/displaying/format/", target: "_blank" } });
      frag.createEl("br");
      frag.appendText(dailyT().labelSyntaxLivePreview());
      frag.createEl("b", "u-pop");
    });
    const timeDesc = createFragment((frag) => {
      frag.appendText(templatesT().optionTemplateTimeFormatDescription(i18nOptions));
      frag.createEl("br");
      frag.appendText(templatesT().optionTemplateTimeFormatDescription2(i18nOptions));
      frag.createEl("br");
      frag.appendText(dailyT().labelReferToSyntax());
      frag.createEl("a", { text: dailyT().labelSyntaxLink(), attr: { href: "https://momentjs.com/docs/#/displaying/format/", target: "_blank" } });
      frag.createEl("br");
      frag.appendText(dailyT().labelSyntaxLivePreview());
      frag.createEl("b", "u-pop");
    });
    // The sample elements live inside the fragments; grab them for the moment-format pickers.
    const dateSample = dateDesc.querySelector("b.u-pop");
    const timeSample = timeDesc.querySelector("b.u-pop");

    const group = new host.SettingGroup(containerEl)
      .addSetting((setting) => setting
        .setName(templatesT().optionTemplateFolderLocation())
        .setDesc(templatesT().optionTemplateFolderLocationDescription())
        .addText((text) => {
          text.setPlaceholder(host.t.setting.folderPathExamplePlaceholder())
            .setValue(options.folder)
            .onChange((value) => {
              options.folder = value.trim();
              self.plugin.saveData(options);
            });
          new host.FolderPathSuggest(self.app, text.inputEl, (folder) => folder.path !== "/");
        }))
      .addSetting((setting) => setting
        .setName(templatesT().optionTemplateDateFormat())
        .setDesc(dateDesc)
        .addMomentFormat((component) => component
          .setSampleEl(dateSample)
          .setDefaultFormat(DEFAULT_DATE_FORMAT)
          .setValue(options.dateFormat)
          .onChange((value) => {
            options.dateFormat = value.trim();
            self.plugin.saveData(options);
          })))
      .addSetting((setting) => setting
        .setName(templatesT().optionTemplateTimeFormat())
        .setDesc(timeDesc)
        .addMomentFormat((component) => component
          .setSampleEl(timeSample)
          .setDefaultFormat(DEFAULT_TIME_FORMAT)
          .setValue(options.timeFormat)
          .onChange((value) => {
            options.timeFormat = value.trim();
            self.plugin.saveData(options);
          })));
  };

  notes.templates.SettingTab = TemplatesSettingTab;
  return TemplatesSettingTab;
}

// =====================================================================================================================
// Daily notes
// =====================================================================================================================

/** Path of `file` relative to `folder`'s prefix, or null when the file is not below it. */
function dailyNoteRelativePath(folder, file) {
  const prefix = folder.getParentPrefix();
  return file.path.startsWith(prefix) ? file.path.slice(prefix.length) : null;
}

/** Validates a custom daily-note date format; returns an error message, or "" when valid. */
export function validateDailyFormat(format) {
  if (!format) return "";
  const sample = window.moment().format(format);
  if (format.startsWith("/")) return dailyT().msgInvalidDateFormat();
  if (notesHost.forbiddenNameChars.test(lastSegment(sample))) {
    return notesHost.t.plugins.fileExplorer.msgInvalidCharacters() + notesHost.forbiddenNameCharsList;
  }
  return window.moment(sample, format, true).isValid() ? "" : dailyT().msgInvalidDateFormat();
}

export function defineDailyNotesPlugin(host) {
  bindNotesHost(host);

  function DailyNotesPlugin() {
    this.id = "daily-notes";
    this.name = dailyT().name();
    this.description = dailyT().desc();
    this.defaultOn = true;
    this.app = null;
    this.plugin = null;
    this.options = {};
  }
  const proto = DailyNotesPlugin.prototype;

  proto.init = function (app, plugin) {
    const self = this;
    this.app = app;
    this.plugin = plugin;
    plugin.registerRibbonItem(dailyT().actionOpen(), "lucide-calendar", this.onOpenDailyNote.bind(this));
    plugin.registerGlobalCommand({ id: "daily-notes", name: dailyT().actionOpen(), icon: "lucide-calendar-days", callback: this.onOpenDailyNote.bind(this) });
    plugin.registerGlobalCommand({
      id: "daily-notes:goto-prev",
      name: dailyT().actionOpenPrevious(),
      icon: "lucide-calendar-minus",
      checkCallback: (checking) => {
        const timestamp = self.getCurrentFileDateTimestamp();
        if (!timestamp) return false;
        if (!checking) self.gotoPreviousExisting(timestamp);
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "daily-notes:goto-next",
      name: dailyT().actionOpenNext(),
      icon: "lucide-calendar-plus",
      checkCallback: (checking) => {
        const timestamp = self.getCurrentFileDateTimestamp();
        if (!timestamp) return false;
        if (!checking) self.gotoNextExisting(timestamp);
        return true;
      },
    });
  };

  proto.onEnable = async function (app, plugin) {
    const self = this;
    this.options = (await plugin.loadData()) || {};
    plugin.addSettingTab(new notes.dailyNotes.SettingTab(app, plugin, this));

    plugin.registerEvent(this.app.workspace.on("receive-text-menu", (menu, arg) => {
      menu.addItem((item) => item
        .setSection("options")
        .setTitle(dailyT().actionInsertText())
        .setIcon("lucide-calendar-check")
        .onClick(async () => {
          const file = await self.getDailyNote();
          await self.app.fileManager.insertIntoFile(file, arg);
          await self.app.workspace.getLeaf().openFile(file, { active: true, state: { mode: "source" } });
        }));
    }));

    plugin.registerEvent(this.app.workspace.on("receive-files-menu", (menu, files) => {
      menu.addItem((item) => item
        .setTitle(dailyT().actionInsertLink())
        .setIcon("lucide-calendar-check")
        .onClick(async () => {
          const file = await self.getDailyNote();
          const links = files.map((f) => {
            const link = self.app.fileManager.generateMarkdownLink(f, file.path);
            return host.isAttachmentExtension(f.extension) ? "!" + link : link;
          });
          await self.app.fileManager.insertIntoFile(file, links.join("\n"));
          await self.app.workspace.getLeaf().openFile(file, { active: true, state: { mode: "source" } });
        }));
    }));

    const protocolHandler = async (params) => {
      const file = await self.getDailyNote();
      let content = params.content;
      if (params.clipboard) content = await navigator.clipboard.readText();
      if (content) await app.fileManager.insertIntoFile(file, content, params.prepend ? "prepend" : "append");
      if (!params.silent) {
        await app.workspace.getLeaf(paneTypeArg(params.paneType)).openFile(file, { active: true, state: { mode: "source" } });
      }
      app.workspace.handleXCallback(params, file);
    };
    this.app.workspace.registerObsidianProtocolHandler("daily", protocolHandler);
    plugin.register(() => this.app.workspace.unregisterObsidianProtocolHandler("daily", protocolHandler));

    const quickActions = this.app.mobileQuickActions;
    if (quickActions) {
      quickActions.registerQuickAction("daily", {
        title: dailyT().shortName(),
        iconName: "calendar",
        callback: this.onOpenDailyNote.bind(this),
      });
      plugin.register(() => quickActions.unregisterQuickAction("daily"));
    }

    plugin.registerCliHandler("daily", "Open daily note", {
      paneType: { value: "tab|split|window", description: "Pane type to open in" },
    }, async (args) => {
      const file = await self.getDailyNote();
      if (!file) throw "Failed to open daily note.";
      await app.workspace.getLeaf(paneTypeArg(args.paneType)).openFile(file, { active: true });
      return "Opened: " + file.path;
    });

    plugin.registerCliHandler("daily:path", "Get daily note path", null, () => {
      const format = self.getFormat();
      let name;
      try {
        name = window.moment().format(format).trim();
      } catch (e) {
        throw "Failed to format daily note date.";
      }
      let parent;
      const folderOption = self.options.folder;
      if (folderOption && typeof folderOption === "string") {
        const folder = app.vault.getFolderByPath(normalizePath(folderOption));
        if (!folder) throw 'Folder "' + folderOption + '" not found.';
        parent = folder;
      } else {
        parent = app.fileManager.getNewFileParent("");
      }
      return parent.getParentPrefix() + name + ".md";
    });

    plugin.registerCliHandler("daily:read", "Read daily note contents", null, async () => {
      const file = await self.getDailyNote();
      if (!file) throw "Failed to open daily note.";
      return await app.vault.cachedRead(file);
    });

    const appendOrPrepend = (mode) => async (args) => {
      if (!args.content) throw "Missing required parameter: content\nUsage: daily:" + mode + " content=<text>";
      const file = await self.getDailyNote();
      if (!file) throw "Failed to open daily note.";
      const content = args.content.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
      const inline = args.inline;
      await app.vault.process(file, (text) => {
        if (mode === "prepend") {
          const start = frontmatterBounds(text).contentStart;
          const head = text.substring(0, start);
          const rest = text.substring(start);
          return head + content + (inline ? "" : "\n") + rest;
        }
        return text + (inline ? "" : "\n") + content;
      });
      if (args.open) {
        await app.workspace.getLeaf(paneTypeArg(args.paneType)).openFile(file, { active: true });
      }
      return "Added to: " + file.path;
    };

    const appendFlags = {
      content: { value: "<text>", description: "Content to append", required: true },
      inline: { description: "Append without newline" },
      open: { description: "Open file after adding" },
      paneType: { value: "tab|split|window", description: "Pane type to open in" },
    };
    const prependFlags = {
      content: { value: "<text>", description: "Content to prepend", required: true },
      inline: { description: "Prepend without newline" },
      open: { description: "Open file after adding" },
      paneType: { value: "tab|split|window", description: "Pane type to open in" },
    };
    plugin.registerCliHandler("daily:append", "Append content to daily note", appendFlags, appendOrPrepend("append"));
    plugin.registerCliHandler("daily:prepend", "Prepend content to daily note", prependFlags, appendOrPrepend("prepend"));

    if (this.options.autorun) {
      if (app.vault.getConfig("openBehavior") === "") app.vault.setConfig("openBehavior", "daily");
      delete this.options.autorun;
      this.plugin.saveData(this.options);
    }
  };

  proto.onExternalSettingsChange = async function () {
    this.options = (await this.plugin.loadData()) || {};
  };

  /** Daily-note path before the vault is loaded (used during startup); "" on failure. */
  proto.getDailyNotePathBeforeAppLoads = async function (date) {
    const app = this.app;
    const options = this.options;
    if (date == null) date = window.moment();
    const format = this.getFormat();
    let name;
    try {
      name = date.format(format);
    } catch (e) {
      new host.Notice(dailyT().msgFailFormat({ format }));
      console.error(e);
      return "";
    }
    if (name) name = name.trim();
    let folderPath = "";
    const folderOption = options.folder;
    if (folderOption && typeof folderOption === "string") {
      const clean = normalizePath(folderOption);
      if (await app.vault.adapter.exists(clean)) {
        folderPath = clean;
      } else {
        new host.Notice(dailyT().msgFailFolder({ folderOption }));
        return "";
      }
    } else if (app.vault.getConfig("newFileLocation") === "folder") {
      const configured = normalizePath(app.vault.getConfig("newFileFolderPath"));
      if (await app.vault.adapter.exists(configured)) folderPath = configured;
    }
    return normalizePath(folderPath + "/" + name + ".md");
  };

  /** Daily-note contents before the vault is loaded; "" when there is no template. */
  proto.getDailyNoteTemplateBeforeAppLoads = async function (title) {
    const app = this.app;
    const options = this.options;
    let templatePath = options.template;
    if (!templatePath.endsWith(".md")) templatePath += ".md";
    const exists = templatePath ? await app.vault.adapter.exists(templatePath) : false;
    if (!exists) return "";
    const raw = await app.vault.adapter.read(templatePath);
    return applyTemplateVars(raw, { title }, {});
  };

  /** The daily note for `date` (default: now), created from the template when missing. */
  proto.getDailyNote = async function (date) {
    const app = this.app;
    const options = this.options;
    if (date == null) date = window.moment();
    const format = this.getFormat();
    let name;
    try {
      name = date.format(format);
    } catch (e) {
      new host.Notice(dailyT().msgFailFormat({ format }));
      console.error(e);
      return;
    }
    if (name) name = name.trim();
    let folder;
    const folderOption = options.folder;
    if (folderOption && typeof folderOption === "string") {
      const folderPath = normalizePath(folderOption);
      const found = app.vault.getAbstractFileByPath(folderPath);
      if (!(found instanceof MarkdownFolder())) {
        new host.Notice(dailyT().msgFailFolder({ folderOption }));
        return;
      }
      folder = found;
    } else {
      folder = app.fileManager.getNewFileParent("");
    }
    const path = folder.getParentPrefix() + name + ".md";
    const existing = app.vault.getAbstractFileByPathInsensitive(path);
    if (existing && !(existing instanceof MarkdownFile())) return;
    if (existing) return existing;
    let file;
    try {
      const templateOption = options.template;
      if (templateOption) {
        const template = app.metadataCache.getFirstLinkpathDest(templateOption, "");
        if (!template) {
          new host.Notice(dailyT().msgFailTemplateFile({ template: templateOption }));
          return;
        }
        const raw = await app.vault.cachedRead(template);
        const content = applyTemplateVars(raw, { title: name }, {});
        file = await app.fileManager.createNewMarkdownFile(folder, name, content);
      } else {
        file = await app.fileManager.createNewMarkdownFile(folder, name);
      }
    } catch (e) {
      new host.Notice(e.toString());
      return;
    }
    return file;
  };

  proto.onOpenDailyNote = async function (event) {
    const file = await this.getDailyNote();
    if (file) {
      await this.app.workspace.getLeaf(host.Keymap.isModEvent(event || this.app.lastEvent)).openFile(file, { state: { mode: "source" } });
    }
  };

  proto.gotoPreviousExisting = async function (timestamp) {
    let best = Number.NEGATIVE_INFINITY;
    let target = null;
    this.iterateDailyNotes((file, ts) => {
      if (ts < timestamp && ts > best) {
        target = file;
        best = ts;
      }
    });
    if (!target) {
      new host.Notice(dailyT().msgNoPrevious());
      return;
    }
    await this.app.workspace.getLeaf().openFile(target, { active: true });
  };

  proto.gotoNextExisting = async function (timestamp) {
    let best = Number.POSITIVE_INFINITY;
    let target = null;
    this.iterateDailyNotes((file, ts) => {
      if (ts > timestamp && ts < best) {
        target = file;
        best = ts;
      }
    });
    if (!target) {
      new host.Notice(dailyT().msgNoNext());
      return;
    }
    await this.app.workspace.getLeaf().openFile(target, { active: true });
  };

  proto.iterateDailyNotes = function (visit) {
    const format = this.getFormat();
    const folder = this.getFolder();
    if (!folder) {
      new host.Notice(dailyT().msgMissingFolder());
      return;
    }
    host.VaultClass.recurseChildren(folder, (item) => {
      if (item instanceof MarkdownFile()) {
        const rel = dailyNoteRelativePath(folder, item);
        if (rel) {
          const parsed = window.moment(withoutExtension(rel), format, true);
          if (parsed.isValid()) visit(item, parsed.valueOf());
        }
      }
    });
  };

  proto.getCurrentFileDateTimestamp = function () {
    const app = this.app;
    const folder = this.getFolder();
    if (!folder) return null;
    const file = app.workspace.getActiveFile();
    if (file && file.extension === "md") {
      const rel = dailyNoteRelativePath(folder, file);
      if (!rel) return null;
      const parsed = window.moment(withoutExtension(rel), this.getFormat(), true);
      if (parsed.isValid()) return parsed.valueOf();
    }
    return null;
  };

  proto.getFolder = function () {
    const vault = this.app.vault;
    const folderOption = this.options.folder;
    if (folderOption) {
      return vault.getFolderByPath(normalizePath(folderOption)) || null;
    }
    return vault.getRoot();
  };

  proto.getFormat = function () {
    const format = this.options.format;
    return format && typeof format === "string" ? format : DEFAULT_DATE_FORMAT;
  };

  notes.dailyNotes.Plugin = DailyNotesPlugin;
  return DailyNotesPlugin;
}

export function defineDailyNotesSettingTab(host) {
  bindNotesHost(host);

  function DailyNotesSettingTab(app, plugin, instance) {
    const self = host.PluginInstanceSettingTab.call(this, app, plugin) || this;
    self.icon = "calendar";
    self.instance = instance;
    return self;
  }
  inherit(DailyNotesSettingTab, host.PluginInstanceSettingTab);
  const proto = DailyNotesSettingTab.prototype;

  proto.display = function () {
    const self = this;
    const containerEl = this.containerEl;
    containerEl.empty();
    const options = this.instance.options;
    const now = window.moment();
    const presets = DAILY_NOTE_FORMATS;
    const current = options.format || DEFAULT_DATE_FORMAT;
    const isCustom = !presets.includes(current);

    let customSetting = null;
    let sampleEl = null;

    const group = new host.SettingGroup(containerEl)
      .addSetting((setting) => setting
        .setName(dailyT().optionDateFormat())
        .setDesc(dailyT().optionDateFormatDesc())
        .addDropdown((dropdown) => {
          for (const format of presets) dropdown.addOption(format, now.format(format));
          dropdown.addOption("custom", dailyT().optionCustom())
            .setValue(isCustom ? "custom" : current)
            .onChange((value) => {
              if (value === "custom") {
                customSetting.settingEl.show();
              } else {
                customSetting.settingEl.hide();
                options.format = value;
                self.plugin.saveData(options);
              }
            });
        }));

    const custom = group.addSetting((setting) => {
      customSetting = setting
        .setName(dailyT().optionCustomDateFormat())
        .setDesc(createFragment((frag) => {
          frag.appendText(dailyT().labelReferToSyntax());
          frag.createEl("a", { text: dailyT().labelSyntaxLink(), attr: { href: "https://momentjs.com/docs/#/displaying/format/", target: "_blank", rel: "noopener" } });
          frag.createEl("br");
          frag.appendText(dailyT().labelSyntaxLivePreview());
          sampleEl = frag.createEl("b", "u-pop");
        }))
        .addMomentFormat((component) => component
          .setSampleEl(sampleEl)
          .setDefaultFormat(DEFAULT_DATE_FORMAT)
          .setValue(current)
          .onChange((value) => {
            const error = validateDailyFormat(value);
            if (error) {
              host.displayTooltip(component.inputEl, error, { classes: ["mod-error"] });
            } else {
              host.hideTooltip();
              options.format = value.trim();
              self.plugin.saveData(options);
            }
          })
          .then((component) => {
            const error = validateDailyFormat(current);
            if (error) host.displayTooltip(component.inputEl, error, { classes: ["mod-error"] });
          }));
      return customSetting;
    });
    customSetting.settingEl.toggle(isCustom);

    group.addSetting((setting) => setting
      .setName(dailyT().optionNewFileLocation())
      .setDesc(dailyT().optionNewFileLocationDescription())
      .addText((text) => {
        text.setPlaceholder(host.t.setting.folderPathExamplePlaceholder())
          .setValue(options.folder)
          .onChange((value) => {
            options.folder = value.trim();
            self.plugin.saveData(options);
          });
        new host.FolderSuggest(self.app, text.inputEl, false, true);
      }));

    group.addSetting((setting) => setting
      .setName(dailyT().optionTemplate())
      .setDesc(dailyT().optionTemplateDescription())
      .addText((text) => {
        text.setPlaceholder(host.t.setting.filePathExamplePlaceholder())
          .setValue(options.template)
          .onChange((value) => {
            options.template = value.trim();
            self.plugin.saveData(options);
          });
        new host.MarkdownFileSuggest(self.app, text.inputEl);
      }));
  };

  notes.dailyNotes.SettingTab = DailyNotesSettingTab;
  return DailyNotesSettingTab;
}

// =====================================================================================================================
// Random note
// =====================================================================================================================

export function defineRandomNotePlugin(host) {
  bindNotesHost(host);

  function RandomNotePlugin() {
    this.id = "random-note";
    this.name = randomT().name();
    this.description = randomT().desc();
    this.app = null;
    this.pluginInstance = null;
  }
  const proto = RandomNotePlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.pluginInstance = plugin;
    plugin.registerRibbonItem(randomT().actionOpen(), "dice", this.onRandomNote.bind(this));
    plugin.registerGlobalCommand({ id: "random-note", name: randomT().actionOpen(), icon: "dice-glyph", callback: this.onRandomNote.bind(this) });
  };

  proto.onRandomNote = async function (event) {
    const files = this.app.vault.getMarkdownFiles();
    const file = files[Math.floor(Math.random() * files.length)];
    await this.app.workspace.getLeaf(host.Keymap.isModEvent(event != null ? event : this.app.lastEvent)).openFile(file);
  };

  notes.randomNote.Plugin = RandomNotePlugin;
  return RandomNotePlugin;
}

// =====================================================================================================================
// Word count
// =====================================================================================================================

// The worker source is built lazily so the unicode character classes come from the host bundle.
export function wordCountWorkerSource(host) {
  const letter = host.unicodeLetterSource.source;
  const word = host.unicodeWordSource.source;
  return "\nlet pattern = /(?:[0-9]+(?:(?:,|\\.)[0-9]+)*|[\\-'’\"" + letter + "஀-௿가-힣ꥠ-ꥼힰ-ퟆ])+|[" + word + "]/g;\n" +
    "function countWords(str) {\n\tpattern.lastIndex = 0;\n\tlet m = str.match(pattern);\n\treturn m ? m.length : 0;\n}\n\n" +
    "self.onmessage = function (e) {\n\ttry {\n\t\tself.postMessage(countWords(e.data));\n\t} catch (e) {\n\t\tconsole.error('WordCount', e);\n\t}\n};\n";
}

export function wordCountPattern(host) {
  const letter = host.unicodeLetterSource.source;
  const word = host.unicodeWordSource.source;
  return new RegExp("(?:[0-9]+(?:(?:,|\\.)[0-9]+)*|[\\-''" + letter + "஀-௿가-힣ꥠ-ꥼힰ-ퟆ])+|[" + word + "]", "g");
}

/** Text without its leading frontmatter block (unchanged when there is none). */
export function stripFrontmatter(text) {
  const bounds = frontmatterBounds(text);
  return bounds.exists ? text.slice(bounds.contentStart) : text;
}

export function defineWordCountPlugin(host) {
  bindNotesHost(host);

  function WordCountPlugin() {
    this.id = "word-count";
    this.name = wordCountT().name();
    this.description = wordCountT().desc();
    this.defaultOn = true;
    this.worker = null;
    this.wordEl = null;
    this.charEl = null;
    this.mobileInfoEl = null;
    this.wordCount = 0;
    this.charCount = 0;
    this.requestWordCount = debounceCall(this.countWords, 200);
  }
  const proto = WordCountPlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerStatusBarItem();
    plugin.registerMobileFileInfo(this.updateMobileFileInfo.bind(this));
  };

  proto.onEnable = async function (app, plugin) {
    const self = this;
    plugin.registerEvent(app.workspace.on("file-open", this.onFileOpen, this));
    plugin.registerEvent(app.workspace.on("quick-preview", this.onQuickPreview, this));
    plugin.registerEvent(app.workspace.on("editor-selection-change", this.onSelection, this));

    const source = wordCountWorkerSource(host);
    this.worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
    this.worker.onmessage = this.onMessage.bind(this);

    const bar = plugin.statusBarEl;
    if (bar) {
      bar.empty();
      this.wordEl = bar.createSpan({ cls: "status-bar-item-segment", text: "" });
      this.charEl = bar.createSpan({ cls: "status-bar-item-segment", text: "" });
      bar.hide();
    }

    plugin.registerCliHandler("wordcount", "Count words and characters", {
      file: { value: "<name>", description: "File name" },
      path: { value: "<path>", description: "File path" },
      words: { description: "Return word count only" },
      characters: { description: "Return character count only" },
    }, async (args) => {
      const file = app.cli.tryResolveFile(args);
      if (file.extension !== "md") throw "Word count is only available for markdown files.";
      const raw = await app.vault.cachedRead(file);
      const text = stripFrontmatter(raw);
      const pattern = wordCountPattern(host);
      pattern.lastIndex = 0;
      const matches = text.match(pattern);
      const words = matches ? matches.length : 0;
      const characters = text.length;
      if (args.words && !args.characters) return String(words);
      if (args.characters && !args.words) return String(characters);
      return "words: " + words + "\ncharacters: " + characters;
    });
  };

  proto.onDisable = function () {
    this.worker.terminate();
    this.worker = null;
    this.wordEl = null;
    this.charEl = null;
  };

  proto.onFileOpen = async function () {
    let text = "";
    let show = false;
    const view = this.app.workspace.getActiveFileView();
    if (view && view.file && (view.file.extension === "md" || (view instanceof host.PlaintextView && view.isPlaintext))) {
      const isMarkdown = view.file.extension === "md";
      const raw = await this.app.vault.cachedRead(view.file);
      text = isMarkdown ? stripFrontmatter(raw) : raw;
      show = true;
    }
    this.plugin.statusBarEl.toggle(show);
    this.updateCount(text);
  };

  proto.onSelection = function (editor, view) {
    const selection = view.editor.getSelection();
    if (selection) {
      this.updateCount(selection);
    } else {
      this.onFileOpen();
    }
  };

  proto.onQuickPreview = function (file, text) {
    if (this.app.workspace.getActiveFile() === file) {
      this.updateCount(stripFrontmatter(text));
    }
  };

  proto.countWords = function (text) {
    if (text) {
      this.worker.postMessage(text);
    } else {
      this.wordCount = 0;
      this.updateMobileFileInfo();
      this.updateDisplay();
    }
  };

  proto.onMessage = function (event) {
    this.wordCount = event.data;
    this.updateMobileFileInfo();
    this.updateDisplay();
  };

  proto.updateCount = function (text) {
    this.charCount = text.length;
    this.requestWordCount(text);
  };

  proto.updateMobileFileInfo = function (el) {
    if (el) {
      this.mobileInfoEl = el;
    } else {
      el = this.mobileInfoEl;
    }
    if (el) {
      const words = host.t.nouns.wordWithCount({ count: this.wordCount });
      const characters = host.t.nouns.characterWithCount({ count: this.charCount });
      el.setText(words + ", " + characters);
    }
  };

  proto.updateDisplay = function () {
    const charEl = this.charEl;
    const wordEl = this.wordEl;
    if (charEl) charEl.setText(host.t.nouns.characterWithCount({ count: this.charCount }));
    if (wordEl) wordEl.setText(host.t.nouns.wordWithCount({ count: this.wordCount }));
  };

  notes.wordCount.Plugin = WordCountPlugin;
  return WordCountPlugin;
}
