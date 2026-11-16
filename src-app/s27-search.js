// The "global search" core plugin: registers the search:open command (Mod+Shift+F), the
// search side-leaf view type, editor/file context-menu entries, and the vault-wide CLI search
// handlers. The search view and query parser themselves live in search-view.js/search-query.js.
//
// pJ/cJ were `gm.plugins.search` aliases and uJ the operator-suggestion table; they are replaced
// by the lazy accessors below so the i18n table is only read at their original bundle position.

import { hostEnv } from "./env.js";

/** i18n table for the search plugin strings (was `pJ`/`cJ`). */
export function s27SearchI18n() { return hostEnv().gm.plugins.search; }

/** Operator suggestions shown by the search suggest popup (was `uJ`). */
export function s27SearchOperatorSuggestions() {
  const i18n = hostEnv().gm.plugins.search;
  return [
    { type: "operator", name: "path:", token: "path:", infoTextI18n: i18n.labelPathOptionDescription },
    { type: "operator", name: "file:", token: "file:", infoTextI18n: i18n.labelFileNameOptionDescription },
    { type: "operator", name: "tag:", token: "tag:", infoTextI18n: i18n.labelTagOptionDescription },
    { type: "operator", name: "line:", token: "line:()", infoTextI18n: i18n.labelLineOptionDescription },
    { type: "operator", name: "section:", token: "section:()", infoTextI18n: i18n.labelSectionOptionDescription },
    { type: "operator", name: "[property]", token: "[]", infoTextI18n: i18n.labelPropertyOptionDescription },
  ];
}

export function defineS27GlobalSearchPlugin(host) {
  const i18n = () => host.t.plugins.search;

  /** Core plugin id "global-search": wires the command, view type, menus and CLI handlers. */
  function GlobalSearchPlugin() {
    this.id = "global-search";
    this.name = i18n().name();
    this.description = i18n().desc();
    this.defaultOn = true;
    this.app = null;
    this.plugin = null;
    this.options = {};
  }
  const proto = GlobalSearchPlugin.prototype;

  proto.init = function (app, plugin) {
    const self = this;
    this.app = app;
    this.plugin = plugin;
    plugin.registerGlobalCommand({
      id: "global-search:open",
      name: i18n().actionOpenSearch(),
      icon: "lucide-search",
      callback: () => {
        let query = window.getSelection().toString();
        const view = app.workspace.getActiveViewOfType(host.MarkdownView);
        if (view) {
          const selected = view.getSelection();
          if (selected) query = selected;
        }
        if (query) {
          if (query.contains(" ")) {
            query = `"${query.replace(/\\/, "\\\\").replace(/"/, '\\"')}"`;
          }
        } else {
          query = null;
        }
        self.openGlobalSearch(query);
      },
      hotkeys: [host.Fb(["Mod", "Shift"], "F")],
    });
    plugin.registerViewType(host.s27SearchViewType, (leaf) => new (host.s27SearchView)(leaf));
  };

  proto.onEnable = async function (app, plugin) {
    const self = this;
    plugin.registerEvent(app.workspace.on("layout-ready", this.initLeaf, this));
    plugin.registerEvent(app.workspace.on("editor-menu", this.onEditorMenu, this));
    plugin.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
    this.options = (await plugin.loadData()) || {};

    const searchFiles = async (query, folder, caseSensitive = false) => {
      const parsed = new (hostEnv().BH)(app, query, caseSensitive);
      if (!parsed.matcher) throw "Invalid search query.";
      let files = app.vault.getMarkdownFiles();
      if (folder) {
        const prefix = folder.endsWith("/") ? folder : folder + "/";
        files = files.filter((file) => file.path.startsWith(prefix));
      }
      const results = [];
      for (const file of files) {
        if (app.metadataCache.isUserIgnored(file.path)) continue;
        const content = await app.vault.cachedRead(file);
        const match = parsed.match(file, content);
        if (match) {
          const matches = [];
          if (match.content) {
            const lines = content.split("\n");
            for (const [pos] of match.content) {
              const line = content.slice(0, pos).split("\n").length;
              const text = lines[line - 1] || "";
              matches.push({ line, text: text.trim() });
            }
          }
          results.push({ file: file.path, matches });
        }
      }
      return results;
    };

    plugin.registerCliHandler("search", "Search vault for text", {
      query: { value: "<text>", description: "Search query", required: true },
      path: { value: "<folder>", description: "Limit to folder" },
      limit: { value: "<n>", description: "Max files" },
      total: { description: "Return match count" },
      case: { description: "Case sensitive" },
      format: { value: "text|json", description: "Output format (default: text)" },
    }, async (args) => {
      if (!args.query) throw "Missing required parameter: query";
      const results = await searchFiles(args.query, args.path, !!args.case);
      const limit = args.limit ? parseInt(args.limit, 10) : 0;
      if (args.total) {
        return args.format === "json" ? JSON.stringify({ total: results.length }) : String(results.length);
      }
      if (results.length === 0) return "No matches found.";
      let files = results.map((result) => result.file);
      if (limit > 0) files = files.slice(0, limit);
      return args.format === "json" ? JSON.stringify(files) : files.join("\n");
    });

    plugin.registerCliHandler("search:context", "Search with matching line context", {
      query: { value: "<text>", description: "Search query", required: true },
      path: { value: "<folder>", description: "Limit to folder" },
      limit: { value: "<n>", description: "Max files" },
      case: { description: "Case sensitive" },
      format: { value: "text|json", description: "Output format (default: text)" },
    }, async (args) => {
      if (!args.query) throw "Missing required parameter: query";
      let results = await searchFiles(args.query, args.path, !!args.case);
      const limit = args.limit ? parseInt(args.limit, 10) : 0;
      if (results.length === 0) return "No matches found.";
      if (limit > 0) results = results.slice(0, limit);
      if (args.format === "json") return JSON.stringify(results);
      const lines = [];
      for (const result of results) {
        if (result.matches.length === 0) {
          lines.push(result.file);
        } else {
          for (const match of result.matches) {
            lines.push(`${result.file}:${match.line}: ${match.text}`);
          }
        }
      }
      return lines.join("\n");
    });

    plugin.registerCliHandler("search:open", "Open search view", {
      query: { value: "<text>", description: "Initial search query" },
    }, (args) => {
      self.openGlobalSearch(args.query || "");
      return args.query ? `Opened search: ${args.query}` : "Opened search";
    });
  };

  proto.onExternalSettingsChange = async function () {
    this.options = (await this.plugin.loadData()) || {};
  };

  proto.onUserEnable = function () {
    this.initLeaf();
  };

  proto.initLeaf = function () {
    this.app.workspace.ensureSideLeaf(host.s27SearchViewType, "left", { reveal: false });
  };

  proto.onFileMenu = function (menu, file, source) {
    const self = this;
    if (source !== "file-explorer-context-menu" || !(file instanceof host.TFolder)) return;
    if (file.isRoot()) return;
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(i18n().menuOptSearchInFolder())
      .setIcon("lucide-folder-search")
      .onClick(() => {
        self.openGlobalSearch(`path:"${file.path}/" `);
      }));
  };

  proto.onEditorMenu = function (menu, view) {
    const self = this;
    let query = view.getSelection();
    if (!query.trim()) return;
    menu.addItem((item) => item
      .setTitle(i18n().menuOptSearchFor({ keyword: host.truncateText(query, 25) }))
      .setIcon("lucide-search")
      .setSection("selection")
      .onClick(() => {
        if (query.contains(" ")) {
          query = `"${query.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
        }
        self.openGlobalSearch(query);
      }));
  };

  proto.openGlobalSearch = function (query) {
    this.app.workspace.ensureSideLeaf(host.s27SearchViewType, "left", {
      active: true,
      reveal: true,
      state: { query },
    });
  };

  proto.getGlobalSearchQuery = function () {
    const leaves = this.app.workspace.getLeavesOfType(host.s27SearchViewType);
    if (leaves.length === 0) return "";
    const state = leaves[0].getViewState();
    return String.isString(state?.query) ? state.query : "";
  };

  return GlobalSearchPlugin;
}
