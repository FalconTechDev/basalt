// g33 clean-room: "zk-prefixer" core plugin — unique-note creator.
// Timestamp-prefixed note names, optional template fill, ribbon item, two
// global commands, a "unique" CLI command, a "unique:" protocol handler and a
// mobile quick action. Replaces orig See (class).
import { normalizePath } from "./path.js";
import { applyTemplateVars, paneTypeArg } from "./notes-utils.js";
import { s16UniqueNoteFormat } from "./s16-constants.js";

const NG33U_UNITS = ["m", "h", "d", "w", "M", "y"];

function ng33uMoment() {
  const m = (typeof window !== "undefined" && window.moment) || globalThis.moment;
  return typeof m === "function" ? m() : m;
}

export function defineUniqueNotePlugin(host) {
  const T = () => host.i18n.plugins.uniqueNoteCreator;

  function UniqueNotePlugin() {
    this.id = "zk-prefixer";
    this.name = T().name();
    this.description = T().desc();
    this.app = null;
    this.plugin = null;
    this.options = {};
  }

  UniqueNotePlugin.prototype.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    const self = this;
    plugin.registerRibbonItem(T().actionCreateNote(), "sheets-in-box", (evt) => self.onCreateNote(evt));
    plugin.registerGlobalCommand({
      id: "zk-prefixer",
      name: T().actionCreateNote(),
      icon: "box-glyph",
      callback: () => self.onCreateNote(),
    });
    plugin.registerGlobalCommand({
      id: "insert-unique-link",
      name: T().actionAddLink(),
      icon: "lucide-link",
      editorCallback: (editor) => self.addUniqueLink(editor),
    });
  };

  UniqueNotePlugin.prototype.getFormat = function () {
    const f = this.options && this.options.format;
    return typeof f === "string" && f ? f : s16UniqueNoteFormat;
  };

  /** Smallest free timestamp for the configured format; null when even years collide. */
  UniqueNotePlugin.prototype.getUniquePath = function (name = "") {
    const files = this.app.vault.getAllLoadedFiles();
    const format = this.getFormat();
    const now = ng33uMoment();
    const result = now.format(format) + (name ? " " + name : "");
    const taken = (cand) => files.some((f) => f instanceof host.TFile && typeof f.name === "string" && f.name.startsWith(cand));
    if (!taken(result)) return result;
    let unit = null;
    for (const u of NG33U_UNITS) {
      if (now.clone().add(1, u).format(format) !== result) {
        unit = u;
        break;
      }
    }
    if (!unit) {
      new host.Notice(T().msgFailedToGenerate({ format }));
      return null;
    }
    const cursor = now.clone();
    let next;
    do {
      next = cursor.add(1, unit).format(format);
    } while (taken(next));
    return next;
  };

  UniqueNotePlugin.prototype.onCreateNote = async function (event) {
    const noteName = this.getUniquePath();
    if (!noteName) return;
    const leaf = this.app.workspace.getLeaf(host.Keymap.isModEvent(event || this.app.lastEvent));
    const folder = this.options && this.options.folder;
    let parent;
    if (typeof folder === "string" && folder) {
      parent = this.app.vault.getFolderByPath(normalizePath(folder));
      if (!parent) {
        new host.Notice(T().msgFolderNotFound({ folderOption: folder }));
        return;
      }
    } else {
      parent = this.app.fileManager.getNewFileParent("", noteName);
    }
    try {
      const template = this.options && this.options.template;
      let file;
      if (typeof template === "string" && template) {
        const dest = this.app.metadataCache.getFirstLinkpathDest(template, "");
        if (!dest) {
          new host.Notice(T().msgTemplateFileNotFound({ template }));
          return;
        }
        const raw = await this.app.vault.cachedRead(dest);
        const content = applyTemplateVars(raw, { title: noteName }, {});
        file = await this.app.fileManager.createNewMarkdownFile(parent, noteName, content);
      } else {
        file = await this.app.fileManager.createNewMarkdownFile(parent, noteName);
      }
      await leaf.openFile(file, { active: true, state: { mode: "source" }, eState: { rename: "end" } });
      return file;
    } catch (e) {
      new host.Notice(String(e));
    }
  };

  /** Editor command: wrap every selection in a [[unique-name]] link. */
  UniqueNotePlugin.prototype.addUniqueLink = function (editor) {
    const state = editor.cm.state;
    const spec = state.changeByRange((range) => {
      const selected = state.sliceDoc(range.from, range.to);
      const noteName = this.getUniquePath(selected);
      if (noteName == null) return { range };
      const innerFrom = range.from + 2;
      const innerTo = innerFrom + noteName.length;
      return {
        changes: { from: range.from, to: range.to, insert: "[[" + noteName + "]]" },
        range: range.empty
          ? host.cmCursorRange(range, innerTo, innerTo)
          : host.cmCursorRange(range, innerFrom, innerTo),
      };
    });
    if (spec) {
      spec.userEvent = "input.autocomplete";
      editor.cm.dispatch(spec);
    }
  };

  UniqueNotePlugin.prototype.onEnable = async function (app, plugin) {
    this.options = (await plugin.loadData()) || {};
    plugin.addSettingTab(new host.s16UniqueNoteSettingsTab(app, plugin, this));
    const self = this;

    plugin.registerCliHandler("unique", "Create unique note", {
      name: { value: "<text>", description: "Note name" },
      content: { value: "<text>", description: "Initial content" },
      paneType: { value: "tab|split|window", description: "Pane type to open in" },
      open: { description: "Open file after creating" },
    }, async (args) => {
      const noteName = self.getUniquePath(args && args.name);
      if (!noteName) throw new Error("Failed to generate unique filename.");
      const folder = self.options && self.options.folder;
      let parent;
      if (typeof folder === "string" && folder) {
        parent = app.vault.getFolderByPath(normalizePath(folder));
        if (!parent) throw new Error(`Folder "${folder}" not found.`);
      } else {
        parent = app.fileManager.getNewFileParent("", noteName);
      }
      let content = args && args.content;
      if (content) content = String(content).replace(/\\n/g, "\n").replace(/\\t/g, "\t");
      if (!content && self.options && self.options.template) {
        const template = self.options.template;
        const dest = app.metadataCache.getFirstLinkpathDest(template, "");
        if (!dest) throw new Error(`Template file "${template}" not found.`);
        const raw = await app.vault.cachedRead(dest);
        content = applyTemplateVars(raw, { title: noteName }, {});
      }
      const file = await app.fileManager.createNewMarkdownFile(parent, noteName, content);
      if (args && args.open) {
        await app.workspace.getLeaf(paneTypeArg(args.paneType)).openFile(file, { active: true });
      }
      return file.path;
    });

    const protocolHandler = async (args) => {
      const file = await self.onCreateNote();
      if (!file) return;
      let content = args && args.content;
      if (args && args.clipboard && navigator.clipboard) {
        try {
          content = await navigator.clipboard.readText();
        } catch (e) {}
      }
      if (content) await app.fileManager.insertIntoFile(file, content, "append");
      if (!(args && args.silent)) {
        await app.workspace.getLeaf(paneTypeArg(args && args.paneType)).openFile(file, { active: true, state: { mode: "source" } });
      }
      app.workspace.handleXCallback(args, file);
    };
    app.workspace.registerObsidianProtocolHandler("unique", protocolHandler);
    plugin.register(() => app.workspace.unregisterObsidianProtocolHandler("unique", protocolHandler));

    if (app.mobileQuickActions) {
      app.mobileQuickActions.registerQuickAction("unique", {
        title: T().labelQuickAction(),
        iconName: "tray.full",
        callback: () => self.onCreateNote(),
      });
      plugin.register(() => app.mobileQuickActions.unregisterQuickAction("unique"));
    }
  };

  UniqueNotePlugin.prototype.onExternalSettingsChange = async function () {
    this.options = (await this.plugin.loadData()) || {};
  };

  return UniqueNotePlugin;
}
