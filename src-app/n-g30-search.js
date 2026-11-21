// g30 clean-room: global-search plugin class, operator metadata and the
// untitled-name sanitizer (spec g30 part G).
import {env} from "./env.js";
import {ng30SearchStrings} from "./n-g30-i18n.js";

export const ng30SearchViewType = "search";

const NG30_OPERATORS = [
  { name: "path:", token: "path:", i18n: "labelPathOptionDescription" },
  { name: "file:", token: "file:", i18n: "labelFileNameOptionDescription" },
  { name: "tag:", token: "tag:", i18n: "labelTagOptionDescription" },
  { name: "line:", token: "line:()", i18n: "labelLineOptionDescription" },
  { name: "section:", token: "section:()", i18n: "labelSectionOptionDescription" },
  { name: "[property]", token: "[]", i18n: "labelPropertyOptionDescription" },
];

/** Operator descriptors for the search suggestion UI; i18n resolved at call time. */
export function ng30SearchOperators() {
  const t = ng30SearchStrings() || {};
  return NG30_OPERATORS.map((op) => ({
    type: "operator",
    name: op.name,
    token: op.token,
    infoTextI18n: t[op.i18n],
  }));
}

/** Sanitises a display name into a valid file name, "Untitled" on failure. */
export function ng30UntitledName(name) {
  let n = String(name).replace(/[?*]/g, "").replace(/[\\/:]/g, " - ");
  n = env().cu(n);
  try {
    env().KT(n);
    return n;
  } catch (e) {
    return "Untitled";
  }
}

/** Multi-word selections are wrapped in quotes; first \ and first " escaped. */
function ng30QuoteQuery(sel) {
  if (!/\s/.test(sel)) return sel;
  return '"' + sel.replace(/\\/, "\\\\").replace(/"/, '\\"') + '"';
}

/** Vault scan shared by the CLI handlers; returns [{file,matches:[{line,text}]}]. */
async function ng30SearchFiles(app, query, folder, caseSensitive) {
  const q = new (env().BH)(app, query, caseSensitive);
  if (!q.matcher) throw "Invalid search query.";
  const prefix = folder ? (folder.endsWith("/") ? folder : folder + "/") : null;
  const out = [];
  for (const file of app.vault.getMarkdownFiles()) {
    if (prefix && !file.path.startsWith(prefix)) continue;
    if (app.metadataCache.isUserIgnored(file.path)) continue;
    const content = await app.vault.cachedRead(file);
    const match = q.match(file, content);
    if (!match) continue;
    const matches = [];
    for (const range of (match.content || [])) {
      const [start] = range;
      const before = content.slice(0, start);
      const line = before.split("\n").length;
      const lines = content.split("\n");
      matches.push({ line, text: (lines[line - 1] || "").trim() });
    }
    out.push({ file: file.path, matches });
  }
  return out;
}

function ng30SearchPluginClass() {
  function SearchPlugin() {
    const t = ng30SearchStrings() || {};
    this.id = "global-search";
    this.name = t.name ? t.name() : "";
    this.description = t.desc ? t.desc() : "";
    this.defaultOn = true;
    this.app = null;
    this.plugin = null;
    this.options = {};
  }
  const proto = SearchPlugin.prototype;

  proto.init = function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    const t = ng30SearchStrings() || {};
    plugin.registerGlobalCommand({
      id: "global-search:open",
      name: t.actionOpenSearch ? t.actionOpenSearch() : "",
      icon: "lucide-search",
      hotkeys: [env().Fb(["Mod", "Shift"], "F")],
      callback: () => {
        let sel = "";
        try { sel = env().activeWindow.getSelection().toString(); } catch (e) {}
        const view = app.workspace.getActiveViewOfType(env().W6);
        if (view && typeof view.getSelection === "function") {
          const vs = view.getSelection();
          if (vs) sel = vs;
        }
        this.openGlobalSearch(sel ? ng30QuoteQuery(sel) : null);
      },
    });
    plugin.registerViewType(ng30SearchViewType, (leaf) => new (env().mJ)(leaf));
  };

  proto.onEnable = async function (app, plugin) {
    this.app = app;
    this.plugin = plugin;
    plugin.registerEvent(app.workspace.on("layout-ready", () => this.initLeaf()));
    plugin.registerEvent(app.workspace.on("editor-menu", (menu, view) => this.onEditorMenu(menu, view)));
    plugin.registerEvent(app.workspace.on("file-menu", (menu, file, source) => this.onFileMenu(menu, file, source)));
    this.options = (await plugin.loadData()) || {};
    const t = ng30SearchStrings() || {};
    const params = [
      { name: "query", description: "Search query", required: true },
      { name: "path", description: "Folder" },
      { name: "limit", description: "Max results" },
      { name: "total", description: "Count only", flag: true },
      { name: "case", description: "Case sensitive", flag: true },
      { name: "format", description: "text|json", default: "text" },
    ];
    plugin.registerCliHandler("search", t.cliSearch || "Search vault for text", params, (args) => this.cliSearch(args));
    plugin.registerCliHandler("search:context", t.cliSearchContext || "Search with matching line context", params, (args) => this.cliSearchContext(args));
    plugin.registerCliHandler("search:open", t.cliSearchOpen || "Open search view", [{ name: "query", description: "Initial query" }], (args) => {
      const q = (args && args.query) || "";
      this.openGlobalSearch(q);
      return q ? "Opened search: " + q : "Opened search";
    });
  };

  proto.cliSearch = async function (args = {}) {
    if (!args.query) throw "Missing required parameter: query";
    const results = await ng30SearchFiles(this.app, args.query, args.path, !!args.case);
    if (args.total) return args.format === "json" ? JSON.stringify({ total: results.length }) : String(results.length);
    if (!results.length) return "No matches found.";
    const limit = parseInt(args.limit);
    const sliced = limit > 0 ? results.slice(0, limit) : results;
    if (args.format === "json") return JSON.stringify(sliced.map((r) => r.file));
    return sliced.map((r) => r.file).join("\n");
  };

  proto.cliSearchContext = async function (args = {}) {
    if (!args.query) throw "Missing required parameter: query";
    const results = await ng30SearchFiles(this.app, args.query, args.path, !!args.case);
    if (!results.length) return "No matches found.";
    const limit = parseInt(args.limit);
    const sliced = limit > 0 ? results.slice(0, limit) : results;
    if (args.format === "json") return JSON.stringify(sliced);
    const lines = [];
    for (const r of sliced) {
      if (!r.matches.length) {
        lines.push(r.file);
        continue;
      }
      for (const m of r.matches) lines.push(r.file + ":" + m.line + ": " + m.text);
    }
    return lines.join("\n");
  };

  proto.onFileMenu = function (menu, file, source) {
    if (source !== "file-explorer-context-menu") return;
    if (!(file instanceof env().ZT) || file.isRoot()) return;
    const t = ng30SearchStrings() || {};
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(t.menuOptSearchInFolder ? t.menuOptSearchInFolder() : "")
      .setIcon("lucide-folder-search")
      .onClick(() => this.openGlobalSearch('path:"' + file.path + '/" ')));
  };

  proto.onEditorMenu = function (menu, view) {
    const sel = view.getSelection();
    if (!sel || !sel.trim()) return;
    const t = ng30SearchStrings() || {};
    menu.addItem((item) => item
      .setSection("selection")
      .setTitle(t.menuOptSearchFor ? t.menuOptSearchFor({ keyword: env().gc(sel, 25) }) : "")
      .setIcon("lucide-search")
      .onClick(() => this.openGlobalSearch(ng30QuoteQuery(sel))));
  };

  proto.openGlobalSearch = function (query) {
    this.app.workspace.ensureSideLeaf(ng30SearchViewType, "left", {
      active: true, reveal: true, state: { query },
    });
  };

  proto.getGlobalSearchQuery = function () {
    const leaves = this.app.workspace.getLeavesOfType(ng30SearchViewType);
    if (!leaves.length) return "";
    const state = leaves[0].getViewState();
    const q = state && state.state && state.state.query;
    return typeof q === "string" ? q : "";
  };

  proto.initLeaf = function () {
    this.app.workspace.ensureSideLeaf(ng30SearchViewType, "left", { reveal: false });
  };

  proto.onUserEnable = function () {
    this.initLeaf();
  };

  proto.onExternalSettingsChange = async function () {
    this.options = (await this.plugin.loadData()) || {};
  };

  return SearchPlugin;
}

let ng30SearchPluginCls = null;

/** Plugin class factory (memoised). */
export function ng30SearchPlugin() {
  if (!ng30SearchPluginCls) ng30SearchPluginCls = ng30SearchPluginClass();
  return ng30SearchPluginCls;
}
