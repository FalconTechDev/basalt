// g24 clean-room: "note-composer" plugin — merge/split/extract markdown files.
import { inherit } from "./inherit.js";
import { env } from "./env.js";
import { ng24StringCompare } from "./n-g24-themes.js";
import { applyTemplateVars } from "./n-g13-notes.js";
import { firstHeadingText } from "./path.js";
import { lineBounds } from "./text.js";
let Ng24cHostRef = null;

const NG24_PLUGIN_ID = "note-composer";
const NG24_OPTIONS = {
  askBeforeMerging: true,
  replacementText: "link",
  template: "",
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function ng24Confirm(app, message) {
  return new Promise((resolve) => {
    const modal = new Ng24cHostRef.Modal(app);
    modal.titleEl.setText("Confirm");
    modal.contentEl.createEl("p", { text: message });
    const buttons = modal.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => { modal.close(); resolve(false); });
    buttons.createEl("button", { cls: "mod-cta", text: "OK" }).addEventListener("click", () => { modal.close(); resolve(true); });
    modal.open();
  });
}

function ng24Options(plugin) {
  return Object.assign({}, NG24_OPTIONS, plugin && plugin.options ? plugin.options : {});
}

function ng24SetOptions(plugin, patch) {
  plugin.options = Object.assign({}, plugin.options, patch);
  plugin.saveOptions && plugin.saveOptions();
  return plugin.options;
}

/** Heading records for a markdown file (from metadata cache). */
function ng24Headings(app, file) {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache || !Array.isArray(cache.headings)) return [];
  return cache.headings
    .filter((h) => h && h.heading)
    .map((h) => ({
      level: h.level,
      title: h.heading,
      from: h.position.start.line,
      to: h.position.end.line,
    }));
}

/** Text of `file` between two line numbers (inclusive start, exclusive end). */
async function ng24Slice(app, file, fromLine, toLine) {
  const content = await app.vault.read(file);
  const lines = content.split("\n");
  return lines.slice(fromLine, toLine === undefined ? lines.length : toLine + 1).join("\n");
}

/** The sub-document under the heading at `heading` (until next same-or-higher heading). */
async function ng24SectionUnderHeading(app, file, heading) {
  const headings = ng24Headings(app, file);
  const idx = headings.indexOf(heading);
  const next = headings.slice(idx + 1).find((h) => h.level <= heading.level);
  return ng24Slice(app, file, heading.from, next ? next.from - 1 : undefined);
}

// ---------------------------------------------------------------------------
// MergeFileSuggest (J8) / ExtractFileSuggest (e7): file pickers.
// ---------------------------------------------------------------------------

function ng24DefineFileSuggest(host, pick) {
  Ng24cHostRef = host;
  function ComposerFileSuggest(app, el, onPick) {
    const self = host.AbstractInputSuggest.call(this, el) || this;
    self.app = app;
    self.onPick = onPick;
    self.files = app.vault.getMarkdownFiles();
    return self;
  }
  inherit(ComposerFileSuggest, host.AbstractInputSuggest);
  const proto = ComposerFileSuggest.prototype;

  proto.getSuggestions = function (query) {
    const q = (query || "").toLowerCase();
    return this.files
      .filter((f) => f.path.toLowerCase().includes(q))
      .slice(0, 50)
      .map((file) => ({ value: file.path, file }));
  };

  proto.renderSuggestion = function (item, el) {
    el.empty();
    host.createEl("div", { cls: "suggestion-title", text: item.value }, el);
  };

  proto.selectSuggestion = function (item) {
    this.onPick(item.file);
  };

  return ComposerFileSuggest;
}

export function ng24DefineMergeFileSuggest(host) {
  Ng24cHostRef = host;
  return ng24DefineFileSuggest(host, "merge");
}
export function ng24DefineExtractFileSuggest(host) {
  Ng24cHostRef = host;
  return ng24DefineFileSuggest(host, "extract");
}

// ---------------------------------------------------------------------------
// NoteComposerSettingTab (t7)
// ---------------------------------------------------------------------------

export function ng24DefineNoteComposerSettingTab(host) {
  Ng24cHostRef = host;
  function NoteComposerSettingTab(app, plugin) {
    const self = host.PluginSettingTab.call(this, app, plugin) || this;
    self.app = app;
    self.plugin = plugin;
    return self;
  }
  inherit(NoteComposerSettingTab, host.PluginSettingTab);
  const proto = NoteComposerSettingTab.prototype;

  proto.display = function () {
    const { containerEl } = this;
    containerEl.empty();
    const opts = ng24Options(this);
    new host.Setting(containerEl)
      .setName("Ask before merging")
      .setDesc("Show a confirmation dialog before merging notes.")
      .addToggle((t) => t.setValue(!!opts.askBeforeMerging).onChange((v) => ng24SetOptions(this.app, { askBeforeMerging: v })));
    new host.Setting(containerEl)
      .setName("Replacement text")
      .setDesc("What to leave behind when merging: link, embed, or none.")
      .addDropdown((d) => d
        .addOption("link", "Link")
        .addOption("embed", "Embed")
        .addOption("none", "Nothing")
        .setValue(opts.replacementText || "link")
        .onChange((v) => ng24SetOptions(this.app, { replacementText: v })));
    new host.Setting(containerEl)
      .setName("Template")
      .setDesc("Template applied to merged notes (supports {{title}}, {{date}}, etc.).")
      .addTextArea((t) => t
        .setValue(opts.template || "")
        .setPlaceholder("# {{title}}\n\nCreated {{date}}")
        .onChange((v) => ng24SetOptions(this.app, { template: v })));
  };

  return NoteComposerSettingTab;
}

// ---------------------------------------------------------------------------
// NoteComposerPlugin (Z8)
// ---------------------------------------------------------------------------

export function ng24DefineNoteComposerPlugin(host) {
  Ng24cHostRef = host;
  // Internal-plugin shell: constructed with no args by the startup loader;
  // init(app, plugin) receives the app and its PluginWrapper.
  function NoteComposerPlugin() {
    this.id = NG24_PLUGIN_ID;
    this.name = "Note Composer";
    this.description = "Merge, split and extract sections of markdown notes.";
    this.defaultOn = true;
    this.options = Object.assign({}, NG24_OPTIONS);
  }
  const proto = NoteComposerPlugin.prototype;

  proto.init = async function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    const saved = await plugin.loadData();
    if (saved && typeof saved === "object") this.options = Object.assign({}, NG24_OPTIONS, saved);
    this.saveOptions = () => plugin.saveData(this.options);
    plugin.registerEvent(app.workspace.on("file-menu", (menu, file, source, leaf) => {
      if (!file || file.extension !== "md") return;
      menu.addSeparator();
      menu.addItem((item) => item
        .setTitle("Merge note into another...")
        .setIcon("lucide-merge")
        .onClick(() => this.openMergeModal(file)));
      menu.addItem((item) => item
        .setTitle("Extract section into new note...")
        .setIcon("lucide-scissors")
        .onClick(() => this.openExtractModal(file)));
      menu.addItem((item) => item
        .setTitle("Split note at cursor...")
        .setIcon("lucide-split")
        .onClick(() => this.openSplitModal(file)));
    }));
    plugin.registerGlobalCommand({
      id: "note-composer:merge-file",
      name: "Merge note into another",
      checkCallback: (checking) => {
        const file = app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) this.openMergeModal(file);
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "note-composer:extract-heading",
      name: "Extract section into new note",
      checkCallback: (checking) => {
        const file = app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) this.openExtractModal(file);
        return true;
      },
    });
    plugin.registerGlobalCommand({
      id: "note-composer:split-file",
      name: "Split note at cursor",
      checkCallback: (checking) => {
        const file = app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) this.openSplitModal(file);
        return true;
      },
    });
    plugin.addSettingTab(new (ng24ComposerSettingTabClass || (ng24ComposerSettingTabClass = ng24DefineNoteComposerSettingTab(host)))(app, plugin, this));
  };

  proto.onloadSettings = function () {};

  // ------------------------------------------------------------------ merge

  proto.openMergeModal = function (file) {
    const app = this.app;
    const modal = new host.Modal(app);
    modal.titleEl.setText("Merge note");
    const { contentEl } = modal;
    contentEl.createEl("p", { text: `Merge "${file.basename}" into another note.` });
    let target = null;
    const suggest = new (ng24MergeSuggestClass || (ng24MergeSuggestClass = ng24DefineMergeFileSuggest(host)))(app, contentEl.createEl("input", { cls: "text-input" }), (f) => { target = f; });
    suggest.inputEl.placeholder = "Search for target note...";
    suggest.open();
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    const merge = buttons.createEl("button", { cls: "mod-cta", text: "Merge" });
    merge.addEventListener("click", async () => {
      if (!target) { new host.Notice("Select a target note first."); return; }
      const opts = ng24Options(this);
      if (opts.askBeforeMerging) {
        const ok = await ng24Confirm(this.app, `Merge "${file.basename}" into "${target.basename}"? This cannot be undone.`);
        if (!ok) return;
      }
      await this.doMerge(file, target, opts);
      modal.close();
    });
    cancel.addEventListener("click", () => modal.close());
    modal.open();
    return modal;
  };

  proto.doMerge = async function (source, target, opts) {
    const app = this.app;
    const sourceText = await app.vault.read(source);
    const targetText = await app.vault.read(target);
    const replacement = this.replacementFor(source, target, opts);
    const merged = targetText.trimEnd() + "\n\n" + sourceText.trim() + "\n";
    await app.vault.modify(target, merged);
    if (opts.replacementText !== "none") {
      await app.vault.modify(source, replacement);
    } else {
      await app.vault.delete(source);
    }
    new host.Notice(`Merged "${source.basename}" into "${target.basename}".`);
  };

  proto.replacementFor = function (source, target, opts) {
    const link = `[[${target.basename}]]`;
    switch (opts.replacementText) {
      case "embed": return `![[${target.basename}]]`;
      case "none": return "";
      default: return link;
    }
  };

  // --------------------------------------------------------------- extract

  proto.openExtractModal = function (file) {
    const app = this.app;
    const modal = new host.Modal(app);
    modal.titleEl.setText("Extract section");
    const headings = ng24Headings(app, file);
    const contentEl = modal.contentEl;
    contentEl.createEl("p", { text: `Extract a section of "${file.basename}" into a new note.` });
    const select = contentEl.createEl("select", { cls: "dropdown" });
    headings.forEach((h, i) => {
      const opt = select.createEl("option", { text: "#".repeat(Math.min(h.level, 6)) + " " + h.title, value: String(i) });
    });
    if (!headings.length) {
      contentEl.createEl("p", { text: "No headings found in this note." });
      return modal.open();
    }
    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    const go = buttons.createEl("button", { cls: "mod-cta", text: "Extract" });
    go.addEventListener("click", async () => {
      const heading = headings[parseInt(select.value, 10)];
      await this.doExtract(file, heading);
      modal.close();
    });
    cancel.addEventListener("click", () => modal.close());
    modal.open();
    return modal;
  };

  proto.doExtract = async function (file, heading) {
    const app = this.app;
    const section = await ng24SectionUnderHeading(app, file, heading);
    const title = heading.title || "Untitled";
    const newFile = await app.fileManager.createNewMarkdownFile(app.vault.getRoot(), title);
    const content = (ng24Options(this).template ? applyTemplateVars(ng24Options(this).template, { title: newFile.basename }) + "\n\n" : "") + section.trim() + "\n";
    await app.vault.modify(newFile, content);
    // replace the section in the source with an embed/link
    const sourceText = await app.vault.read(file);
    const lines = sourceText.split("\n");
    const headings = ng24Headings(app, file);
    const idx = headings.indexOf(heading);
    const next = headings.slice(idx + 1).find((h) => h.level <= heading.level);
    const from = heading.from;
    const to = next ? next.from - 1 : lines.length - 1;
    const replacement = `![[${newFile.basename}]]`;
    const out = lines.slice(0, from).concat([replacement], lines.slice(to + 1)).join("\n");
    await app.vault.modify(file, out);
    new host.Notice(`Extracted "${title}" into "${newFile.basename}".`);
  };

  // ------------------------------------------------------------------ split

  proto.openSplitModal = function (file) {
    const app = this.app;
    const view = app.workspace.getActiveViewOfType("markdown");
    if (!view || !view.editor) { new host.Notice("Open the note in the editor first."); return; }
    const cursor = view.editor.getCursor();
    const modal = new host.Modal(app);
    modal.titleEl.setText("Split note");
    modal.contentEl.createEl("p", { text: `Split "${file.basename}" at line ${cursor.line + 1} into a new note.` });
    const buttons = modal.contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = buttons.createEl("button", { text: "Cancel" });
    const go = buttons.createEl("button", { cls: "mod-cta", text: "Split" });
    go.addEventListener("click", async () => {
      await this.doSplit(file, cursor.line);
      modal.close();
    });
    cancel.addEventListener("click", () => modal.close());
    modal.open();
    return modal;
  };

  proto.doSplit = async function (file, atLine) {
    const app = this.app;
    const content = await app.vault.read(file);
    const lines = content.split("\n");
    const head = lines.slice(0, atLine).join("\n");
    const tail = lines.slice(atLine).join("\n");
    const newFile = await app.fileManager.createNewMarkdownFile(app.vault.getRoot(), file.basename + " (split)");
    await app.vault.modify(newFile, tail + "\n");
    await app.vault.modify(file, head + "\n" + `![[${newFile.basename}]]\n`);
    new host.Notice(`Split "${file.basename}" into "${newFile.basename}".`);
  };

  return NoteComposerPlugin;
}

let ng24ComposerSettingTabClass = null;
let ng24MergeSuggestClass = null;

export const defineNoteComposerPlugin = ng24DefineNoteComposerPlugin;
export const defineMergeFileSuggest = ng24DefineMergeFileSuggest;
export const defineExtractFileSuggest = ng24DefineExtractFileSuggest;
export const defineNoteComposerSettingTab = ng24DefineNoteComposerSettingTab;
