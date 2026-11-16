// The "Bases" core plugin: commands, ribbon item, code-block embed post-processor,
// view registrations and the CLI handlers for querying/creating base files.
import { env } from "./env.js";
import { s13BasesI18n, s13ViewBase, s13ViewTable, s13ViewCards, s13ViewList } from "./s13-consts.js";

const s13ViewTypeBases = "bases";
const s13BaseExtension = s13ViewBase;

export function defineS13BasesPlugin(host) {
  const ti = () => s13BasesI18n();

  class BasesPlugin {
    constructor() {
      this.id = "bases";
      this.name = ti().name();
      this.description = ti().desc();
      this.defaultOn = true;
      this.registrations = {};
    }

    init(app, plugin) {
      const self = this;
      this.app = app;
      plugin.registerGlobalCommand({
        id: "bases:new-file",
        name: ti().commandCreateNew(),
        icon: "lucide-layout-list",
        callback: this.createAndOpenBase.bind(this),
      });
      plugin.registerGlobalCommand({
        id: "bases:insert",
        name: ti().commandInsertNew(),
        icon: "lucide-layout-list",
        editorCheckCallback: (checking, editor) => {
          if (editor instanceof env().iZ && !editor.inTableCell) {
            if (!checking) self.createAndEmbedBase(editor);
            return true;
          }
          return false;
        },
      });
      plugin.registerGlobalCommand({
        id: "bases:copy-table",
        name: ti().commandCopyTable(),
        icon: "lucide-copy",
        checkCallback: (checking) => {
          const view = app.workspace.getActiveViewOfType(host.s13BaseFileView);
          if (view) {
            const basesView = view.controller.getActiveBasesViewOfType(host.s13BasesTableView);
            if (basesView) {
              if (!checking) basesView.copyToClipboard();
              return true;
            }
          }
          return false;
        },
      });
      plugin.registerGlobalCommand({
        id: "bases:change-view",
        name: ti().commandChangeView(),
        icon: "lucide-shapes",
        checkCallback: (checking) => {
          const view = app.workspace.getActiveViewOfType(host.s13BaseFileView);
          if (view) {
            const names = view.controller.getQueryViewNames();
            if (names.length > 1) {
              if (!checking) new host.s13ViewSwitcher(app, view.controller, names).open();
              return true;
            }
          }
          return false;
        },
      });
      plugin.registerGlobalCommand({
        id: "bases:add-view",
        name: ti().commandAddView(),
        icon: "lucide-shapes",
        checkCallback: (checking) => {
          const view = app.workspace.getActiveViewOfType(host.s13BaseFileView);
          if (view) {
            if (!checking) view.controller.promptForAddView();
            return true;
          }
          return false;
        },
      });
      plugin.registerGlobalCommand({
        id: "bases:add-item",
        name: ti().commandAddItem(),
        icon: "lucide-shapes",
        checkCallback: (checking) => {
          const view = app.workspace.getActiveViewOfType(host.s13BaseFileView);
          if (view) {
            if (!checking) view.controller.newItemMenu.open();
            return true;
          }
          return false;
        },
      });
      plugin.registerRibbonItem(ti().commandCreateNew(), "lucide-layout-list", this.createAndOpenBase.bind(this));
      const processor = (content, el, ctx) => {
        const text = content.replace(/^(\t+)/gm, (match, tabs) => "    ".repeat(tabs.length));
        const file = app.vault.getFileByPath(ctx.sourcePath);
        const embed = new host.s13BasesEmbed(app, plugin, el, file);
        el.addClass("bases-embed", "interactive-child");
        const preview = new host.s13MarkdownEmbed(el);
        ctx.addChild(preview);
        preview.addChild(embed);
        const query = host.s13BaseFileModel.fromString(text);
        const save = env().debounce((q) => ctx.replaceCode(q.toString()), 100);
        query.saveFn = () => {
          embed.setQuery(query);
          save(query);
        };
        embed.setQuery(query);
      };
      const registered = env().Gz.createCodeBlockPostProcessor(s13BaseExtension, processor);
      env().Gz.registerPostProcessor(registered);
      env().Gz.registerCodeBlockPostProcessor(s13BaseExtension, processor);
      app.workspace.trigger("post-processor-change");
      plugin.register(() => {
        env().Gz.unregisterCodeBlockPostProcessor(s13BaseExtension);
        env().Gz.unregisterPostProcessor(registered);
        app.workspace.trigger("post-processor-change");
        self.registrations = {};
      });
    }

    async createAndEmbedBase(editor) {
      const fileManager = this.app.fileManager;
      const path = editor.editorComponent.file?.path ?? "";
      const parent = fileManager.getNewFileParent(path);
      const file = await fileManager.createNewFile(parent, undefined, s13BaseExtension);
      const state = editor.cm.state;
      editor.cm.dispatch(state.changeByRange((range) => {
        const pos = env().OA(state.doc, range.from);
        const insert = "![[" + file.path + "]]";
        const text = pos.ch > 0 ? "\n" + insert + "\n" : insert + "\n";
        return { range: env().pe.cursor(range.from + text.length), changes: [{ from: range.from, to: range.to, insert: text }] };
      }));
    }

    onEnable(app, plugin) {
      const self = this;
      host.codeMirrorCompat.modes.base = host.codeMirrorCompat.modes.yaml;
      plugin.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
      app.embedRegistry.registerExtension(s13BaseExtension, (contentEl, sourcePath, anchor) => {
        const fileName = anchor?.startsWith("#") ? anchor.substring(1) : "";
        return new host.s13BasesEmbedView(app, plugin, contentEl, sourcePath, fileName);
      });
      app.fileManager.registerFileParentCreator(s13BaseExtension, () =>
        app.fileManager.getNewFileParent("path", s13BaseExtension));
      plugin.register(() => app.embedRegistry.unregisterExtension(s13BaseExtension));
      app.workspace.registerHoverLinkSource("bases", { display: this.name, defaultMod: true });
      plugin.registerEvent(app.workspace.on("editor-menu", this.onEditorMenu, this));
      app.workspace.registerOperatorFuncConfigs("bases", [
        { funcName: "hasProperty", display: "has property", inverseDisplay: "does not have property" },
        { funcName: "isEmpty", display: "is empty", inverseDisplay: "is not empty" },
        { funcName: "startsWith", display: "starts with", inverseDisplay: "does not start with" },
        { funcName: "endsWith", display: "ends with", inverseDisplay: "does not end with" },
        { funcName: "contains", display: "contains", inverseDisplay: "does not contain" },
        { funcName: "containsAny", display: "contains any of", inverseDisplay: "does not contain any of" },
        { funcName: "containsAll", display: "contains all of", inverseDisplay: "does not contain all of" },
        { funcName: "matches", display: "matches", inverseDisplay: "does not match" },
        { funcName: "hasLink", display: "links to", inverseDisplay: "does not link to" },
        { funcName: "inFolder", display: "in folder", inverseDisplay: "is not in folder" },
        { funcName: "hasTag", display: "has tag", inverseDisplay: "does not have tag" },
      ]);
      app.viewRegistry.registerViewWithExtensions([s13BaseExtension], s13ViewTypeBases, (leaf) => new host.s13BaseFileView(leaf, self));
      plugin.register(() => {
        app.viewRegistry.unregisterExtensions([s13BaseExtension]);
        app.viewRegistry.unregisterView(s13ViewTypeBases);
      });
      this.registerView(s13ViewTable, {
        name: ti().table.name(),
        icon: "lucide-table",
        factory: (leaf, pluginArg) => new host.s13BasesTableView(leaf, pluginArg),
        options: host.s13BasesTableView.getViewOptions,
      });
      this.registerView(s13ViewCards, {
        name: ti().cards.name(),
        icon: "lucide-layout-grid",
        factory: (leaf, pluginArg) => new host.s13CardsView(leaf, pluginArg),
        options: host.s13CardsView.getViewOptions,
      });
      this.registerView(s13ViewList, {
        name: ti().list.name(),
        icon: "lucide-list",
        factory: (leaf, pluginArg) => new host.s13ListView(leaf, pluginArg),
        options: host.s13ListView.getViewOptions,
      });
      plugin.registerCliHandler("base:query", "Query a base and return results",
        {
          file: { value: "<name>", description: "Base file name" },
          path: { value: "<path>", description: "Base file path" },
          view: { value: "<name>", description: "View name to query" },
          format: { value: "json|csv|tsv|md|paths", description: "Output format (default: json)" },
        },
        async (args) => {
          const app = this.app;
          let file = null;
          let viewName = "";
          if (args.path) {
            file = app.vault.getFileByPath(args.path);
            if (!file) throw "Base file not found: " + args.path;
          } else if (args.file) {
            file = app.metadataCache.getFirstLinkpathDest(args.file, "");
            if (!file) throw "Base file not found: " + args.file;
          } else {
            file = app.workspace.getActiveFile();
            if (!file) throw "No active file. Use file=<name> or path=<path> to specify a base file.";
            viewName = app.workspace.getActiveViewOfType(host.s13BaseFileView)?.controller?.viewName ?? "";
          }
          if (file.extension !== s13BaseExtension) throw "Not a base file: " + file.path;
          const content = await app.vault.cachedRead(file);
          const model = host.s13BaseFileModel.fromString(content);
          if (model instanceof Error) throw "Failed to parse base file: " + model.message;
          const viewKey = args.view || viewName || "";
          const viewConfig = model.getViewConfig(viewKey);
          if (!viewConfig) {
            const names = model.views?.map((v) => v.name) || [];
            if (names.length > 0) throw "View not found: " + viewKey + "\nAvailable views: " + names.join(", ");
            return "No views defined in base file";
          }
          const filter = host.s13FilterOps.and(model.filters, viewConfig.filters);
          const ctx = new host.s13QuerySession(app, filter, model.formulas, null);
          const items = [];
          for (const candidate of app.vault.getMarkdownFiles()) {
            if (app.metadataCache.isUserIgnored(candidate.path)) continue;
            try {
              const item = new host.s13QueryItem(ctx, candidate);
              if (!ctx.filter || ctx.filter.test(item)) items.push(item);
            } catch (e) { /* skip unreadable files */ }
          }
          items.sort((a, b) => host.s13ComparePaths(a.file.path, b.file.path));
          const order = viewConfig.getOrder();
          const table = new host.s13QueryTable(app, viewConfig, order, items);
          const headers = order.map((key) => viewConfig.getDisplayName(key));
          const rows = table.data.map((item) => order.map((key) => {
            try {
              const value = item.getValue(key);
              return value == null || value === host.s13ValueNone.value ? "" : value.toString();
            } catch (e) { return ""; }
          }));
          const grid = new host.s13TableExport(headers, rows);
          const format = args.format || "json";
          if (format === "paths") return table.data.map((item) => item.file.path).join("\n");
          if (format === "csv") return grid.toCSV();
          if (format === "tsv") return grid.toTSV();
          if (format === "md") return grid.toMarkdown();
          const out = table.data.map((item, i) => {
            const row = { path: item.file.path };
            for (let j = 0; j < order.length; j++) row[headers[j]] = rows[i][j] || null;
            return row;
          });
          return JSON.stringify(out, null, 2);
        });
      plugin.registerCliHandler("bases", "List all base files in vault", null, async () => {
        const files = this.app.vault.getFiles().filter((file) => file.extension === s13BaseExtension);
        if (files.length === 0) return "No base files found in vault";
        return files.map((file) => file.path).sort().join("\n");
      });
      plugin.registerCliHandler("base:views", "List views in the current base file", null, async () => {
        const app = this.app;
        const file = app.workspace.getActiveFile();
        if (!file) throw "No active file.";
        if (file.extension !== s13BaseExtension) throw "Active file is not a base file: " + file.path;
        const content = await app.vault.cachedRead(file);
        const model = host.s13BaseFileModel.fromString(content);
        if (model instanceof Error) throw "Failed to parse base file: " + model.message;
        const views = model.views || [];
        if (views.length === 0) return "No views defined.";
        return views.map((view) => view.name + "\t" + view.type).join("\n");
      });
      plugin.registerCliHandler("base:create", "Create a new item in a base",
        {
          file: { value: "<name>", description: "Base file name" },
          path: { value: "<path>", description: "Base file path" },
          view: { value: "<name>", description: "View name" },
          name: { value: "<name>", description: "New file name" },
          content: { value: "<text>", description: "Initial content" },
          open: { description: "Open file after creating" },
          newtab: { description: "Open in new tab" },
        },
        async (args) => {
          const app = this.app;
          let model = null;
          let file = null;
          let viewName = args.view || "";
          if (args.path) {
            file = app.vault.getFileByPath(args.path);
            if (!file) throw "Base file not found: " + args.path;
          } else if (args.file) {
            file = app.metadataCache.getFirstLinkpathDest(args.file, "");
            if (!file) throw "Base file not found: " + args.file;
          }
          let view = null;
          if (file) {
            if (file.extension !== s13BaseExtension) throw "Not a base file: " + file.path;
            const content = await app.vault.cachedRead(file);
            model = host.s13BaseFileModel.fromString(content);
            if (model instanceof Error) throw "Failed to parse base file: " + model.message;
            viewName = viewName || model.views?.[0]?.name || "";
          } else {
            const active = app.workspace.getActiveViewOfType(host.s13BaseFileView);
            if (!active?.controller) throw "No active base view. Use file=<name> or path=<path> to specify a base.";
            view = active.controller;
            model = view.query;
            file = active.file;
            viewName = viewName || view.viewName;
          }
          if (!model) throw "No query loaded.";
          const viewConfig = model.getViewConfig(viewName);
          const ctx = host.s13NewItemContext(app, model, viewConfig);
          let folder = model.newItemFolder || ctx.folder;
          const frontmatter = ctx.frontmatter;
          if (folder === "" && file) folder = app.fileManager.getNewFileParent(file.path).path;
          if (folder && !folder.endsWith("/")) folder += "/";
          const name = args.name || "Untitled";
          const target = folder + name;
          const available = app.vault.getAvailablePath(env().cu(target), "md");
          let content = "";
          if (args.content) content = args.content.replace(/\n/g, "\n").replace(/\t/g, "\t");
          const created = await app.vault.create(available, content);
          if (Object.keys(frontmatter).length > 0) {
            await app.fileManager.processFrontMatter(created, (fm) => {
              for (const key in frontmatter) fm[key] = frontmatter[key];
            });
          }
          if (args.open) {
            await app.workspace.getLeaf(!!args.newtab && "tab").openFile(created, { active: true });
          }
          return "Created: " + created.path;
        });
    }

    onFileMenu(menu, file, source, evt) {
      const self = this;
      if (source === "file-explorer-context-menu" && file instanceof host.s13FolderClass) {
        menu.addItem((item) => item
          .setSection("action-primary")
          .setIcon("lucide-layout-list")
          .setTitle(ti().actionNewBase())
          .onClick(async (clickEvt) => {
            const created = await self.createNewBasesFile(file);
            await self.app.workspace.getLeaf(host.Keymap.isModEvent(clickEvt)).openFile(created, { eState: { rename: "all" } });
          }));
      }
    }

    onEditorMenu(menu, editor) {
      const self = this;
      if (editor instanceof env().iZ) {
        menu.addItem((item) => item
          .setSection("selection.insert.advanced")
          .setTitle(ti().actionNewBase())
          .setIcon("lucide-layout-list")
          .onClick(() => self.createAndEmbedBase(editor)));
      }
    }

    async createAndOpenBase(evt) {
      const app = this.app;
      const path = app.workspace.getActiveFile()?.path ?? "";
      const parent = app.fileManager.getNewFileParent(path);
      const file = await this.createNewBasesFile(parent);
      await app.workspace.getLeaf(host.Keymap.isModEvent(evt ?? app.lastEvent)).openFile(file, { eState: { rename: "all" } });
    }

    createNewBasesFile(parent, name, content) {
      return this.app.fileManager.createNewFile(parent, name, s13BaseExtension, content);
    }

    registerView(viewId, registration) {
      if (Object.hasOwn(this.registrations, viewId)) {
        new env().fb(ti().msgErrorRegisterView({ viewId }));
        return;
      }
      this.registrations[viewId] = registration;
    }

    deregisterView(viewId) {
      delete this.registrations[viewId];
    }

    getRegistration(viewId) {
      return Object.hasOwn(this.registrations, viewId) ? this.registrations[viewId] : null;
    }

    getRegistrations() {
      return this.registrations;
    }

    getViewFactory(viewId) {
      return Object.hasOwn(this.registrations, viewId) ? this.registrations[viewId].factory : null;
    }
  }

  return BasesPlugin;
}
