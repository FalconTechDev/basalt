// Basalt CLI: the `basalt` command-line interface exposed to Electron via window.handleCli.
// Rewritten from observed behaviour: command registration, argument parsing (--flag=value,
// flag shorthand expansion, --copy), the help/completions/files meta commands, the desktop
// devtools/eval block and every vault/plugin/theme/snippet/task/property command.
import { env } from "./env.js";
import { stringCollator } from "./misc.js";
import { collectTags } from "./metadata-helpers.js";
import { utf8String } from "./vault-crypto.js";
import { fileClass } from "./vault.js";
import { normalizePath } from "./path.js";
import { describeCliOptions, escapeTablePipes } from "./text.js";
import { frontmatterAliases } from "./frontmatter.js";
import { prepareFuzzyFinder } from "./search-simple.js";
import { applyTemplateVars, frontmatterBounds } from "./notes-utils.js";

// fileClass() is resolved lazily: vault.js evaluates after this module in the shared scope.
const s05TFile = () => fileClass("TFile");
const s05TFolder = () => fileClass("TFolder");

/** yb(): memoize with separate success/error TTLs; concurrent calls share one promise,
 *  failures are not cached but a still-fresh stale value is returned inside the error window. */
function s05Memoized(fn, ttl, errTtl) {
  if (errTtl === undefined) errTtl = ttl;
  let result = null;
  let until = 0;
  let pending = null;
  return function call() {
    if (pending) return pending;
    if (result && until > Date.now()) return Promise.resolve(result);
    pending = (async () => {
      until = Date.now() + errTtl;
      try {
        result = await fn();
      } catch (e) {
        pending = null;
        return null;
      }
      until = Date.now() + ttl;
      pending = null;
      setTimeout(() => { if (until > Date.now()) result = null; }, ttl);
      return result;
    })();
    return pending;
  };
}

/** eA: community plugin list URL (obsidianmd/obsidian-releases, kept for wire compatibility). */
export const s05CommunityPluginsUrl = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugins.json";
/** nA: community plugin stats URL. */
export const s05CommunityPluginStatsUrl = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/HEAD/community-plugin-stats.json";

/** tA: cached community plugin list (5 min, 1 min error window). */
export const s05CommunityPlugins = s05Memoized(async () => {
  const list = await request(s05CommunityPluginsUrl).then((r) => r.json);
  if (!Array.isArray(list)) throw new Error("Failed to parse community plugins.");
  return list;
}, 3e5, 6e4);

/** iA: cached community plugin stats (5 min, 1 min error window). */
export const s05CommunityPluginStats = s05Memoized(async () => {
  return (await request(s05CommunityPluginStatsUrl)).json;
}, 3e5, 6e4);

/** wA: ranked command-name suggestions for "did you mean" hints (prefix/includes/levenshtein<=3). */
export function s05CommandScore(query, candidates, limit = 3) {
  const q = query.toLowerCase();
  const scored = candidates.map((cmd) => {
    const name = cmd.toLowerCase();
    if (name.startsWith(q)) return { cmd, score: 0 };
    if (name.includes(q)) return { cmd, score: 1 };
    const r = q.length;
    const o = name.length;
    const a = Array.from({ length: r + 1 }, (_, i) => i);
    for (let s = 1; s <= o; s++) {
      let prev = a[0]++;
      for (let c = 1; c <= r; c++) {
        const tmp = a[c];
        a[c] = Math.min(a[c] + 1, a[c - 1] + 1, prev + (q[c - 1] === name[s - 1] ? 0 : 1));
        prev = tmp;
      }
    }
    return { cmd, score: a[r] <= 3 ? 2 + a[r] : 999 };
  });
  return scored
    .filter((e) => e.score < 999)
    .sort((x, y) => x.score - y.score)
    .slice(0, limit)
    .map((e) => e.cmd);
}

/** S05Table: the CLI/markdown table formatter (TSV/CSV/markdown/obsidian clipboard JSON). */
export function defineTable() {
  return class S05Table {
    constructor(header, body) {
      this.header = header;
      this.body = body;
    }
    toCSV(includeHeader = true) { return this.toText(",", includeHeader); }
    toTSV(includeHeader = true) { return this.toText("\t", includeHeader); }
    toText(separator, includeHeader = true) {
      const header = this.header;
      const body = this.body;
      const needsQuotes = new RegExp('["\\n\\r' + separator + "]");
      const cell = (value) => needsQuotes.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
      const out = [];
      if (includeHeader) out.push(header.map(cell).join(separator));
      for (const row of body) out.push(row.map(cell).join(separator));
      return out.join("\n");
    }
    toMarkdown(includeHeader = true) {
      let header = this.header;
      const body = this.body;
      header = header.map(escapeTablePipes);
      const rows = body.map((row) => row.map(escapeTablePipes));
      const widths = header.map((h) => h.length);
      for (const row of rows) {
        for (let i = 0; i < row.length; i++) {
          if (row[i].length > widths[i]) widths[i] = row[i].length;
        }
      }
      for (let i = 0; i < widths.length; i++) widths[i] += 2;
      const lines = includeHeader ? [header] : [];
      lines.push(...rows);
      const out = [];
      for (const row of lines) {
        let line = "|";
        for (let i = 0; i < row.length; i++) {
          const cell = row[i];
          const pad = widths[i] - cell.length;
          const left = Math.floor(pad / 2);
          const right = pad - left;
          line += " ".repeat(left) + cell + " ".repeat(right) + "|";
        }
        out.push(line);
        if (row === header) {
          let rule = "|";
          for (let i = 0; i < row.length; i++) rule += " " + "-".repeat(widths[i] - 2) + " |";
          out.push(rule);
        }
      }
      return out.join("\n");
    }
    toObsidianTableClipboard() {
      const header = this.header;
      const body = this.body;
      return JSON.stringify({ header, rows: body, alignment: Array(header.length).fill(null) });
    }
  };
}

const s05TableClass = defineTable();

/** CA: the CLI controller (`app.cli`). */
export function defineCli(host) {
  const { formatHotkey } = host;
  const env_ = () => env();

  return class Cli {
    constructor(app) {
      this.app = app;
      this.handlers = new Map();
    }

    registerHandler(id, description, flags, handler) {
      const handlers = this.handlers;
      if (handlers.has(id)) throw new Error('Command "' + id + '" is already registered as a handler.');
      handlers.set(id, { handler, description, flags: flags || undefined });
    }

    unregisterHandler(id, handler) {
      const handlers = this.handlers;
      const entry = handlers.get(id);
      if (!handler || (entry && entry.handler === handler)) handlers.delete(id);
    }

    formatTable(headers, rows, format) {
      if (format === "json") {
        return JSON.stringify(rows.map((row) => {
          const obj = {};
          for (let i = 0; i < headers.length; i++) obj[headers[i]] = row[i] !== null && row[i] !== undefined ? row[i] : "";
          return obj;
        }), null, 2);
      }
      const padded = rows.map((row) => row.length < headers.length
        ? row.concat(Array(headers.length - row.length).fill(""))
        : row);
      const table = new s05TableClass(headers, padded);
      return format === "csv" ? table.toCSV(false) : table.toTSV(false);
    }

    tryResolveFile(args, useActive = true) {
      if (args.path) {
        const file = this.app.vault.getAbstractFileByPath(args.path);
        if (!file) throw 'File "' + args.path + '" not found.';
        if (!(file instanceof s05TFile())) throw '"' + args.path + '" is a folder, not a file.';
        return file;
      }
      if (args.file) {
        const file = this.app.metadataCache.getFirstLinkpathDest(args.file, "");
        if (!file) throw 'File "' + args.file + '" not found.';
        return file;
      }
      if (useActive) {
        const file = this.app.workspace.getActiveFile();
        if (!file) throw "No active file. Use file=<name> or path=<path> to specify a file.";
        return file;
      }
      throw "Missing required parameter: file or path";
    }

    formatDiff(oldText, newText, oldLabel, newLabel) {
      if (!oldText.endsWith("\n")) oldText += "\n";
      if (!newText.endsWith("\n")) newText += "\n";
      const differ = new (env_().dA)();
      const diffs = differ.diff_lineMode(oldText, newText);
      differ.diff_cleanupSemantic(diffs);
      const XD = env_().XD;
      const out = [];
      out.push("--- " + oldLabel);
      out.push("+++ " + newLabel);
      for (const [op, text] of diffs) {
        const lines = text.split("\n");
        if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
        for (const line of lines) {
          switch (op) {
            case XD.DIFF_INSERT: out.push("+ " + line); break;
            case XD.DIFF_DELETE: out.push("- " + line); break;
            case XD.DIFF_EQUAL: out.push("  " + line);
          }
        }
      }
      return out.join("\n");
    }

    formatAsciiTree(nodes, prefix = "") {
      const out = [];
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const last = i === nodes.length - 1;
        const head = prefix + (last ? "└── " : "├── ");
        const tail = prefix + (last ? "    " : "│   ");
        out.push(head + node.label);
        if (node.children && node.children.length > 0) out.push(this.formatAsciiTree(node.children, tail));
      }
      return out.join("\n");
    }

    formatAsciiTreeWithRoot(root, children) {
      const out = [root];
      if (children.length > 0) out.push(this.formatAsciiTree(children));
      return out.join("\n");
    }

    init() {
      const self = this;
      const app = this.app;
      const { Yl, If, Eu, ID, OD, jD, zD, WD, JT } = env_();
      const commands = app.commands;
      const workspace = app.workspace;
      const vault = app.vault;
      const metadataCache = app.metadataCache;
      const communityPlugins = app.plugins;
      const internalPlugins = app.internalPlugins;
      const customCss = app.customCss;

      window.handleCli = async function (argv) {
        console.log("Received CLI command", argv);
        let command = argv[0];
        if (!command || command === "--help") command = "help";
        const args = {};
        const rest = argv.slice(1);
        for (let i = 0; i < rest.length; i++) {
          const arg = rest[i];
          const eq = arg.indexOf("=");
          if (eq !== -1) args[arg.slice(0, eq)] = arg.slice(eq + 1);
          else args[arg] = "true";
        }
        const handlers = self.handlers;
        if (!handlers.has(command)) {
          const colon = command.lastIndexOf(":");
          if (colon !== -1) {
            const prefix = command.slice(0, colon);
            const suffix = command.slice(colon + 1);
            const entry = handlers.get(prefix);
            if (entry && entry.flags && suffix in entry.flags) {
              command = prefix;
              args[suffix] = "true";
            }
          }
        }
        if (!handlers.has(command)) {
          const suggestions = s05CommandScore(command, Array.from(handlers.keys()));
          let message = 'Command "' + command + '" not found.';
          if (suggestions.length) message += " Did you mean: " + suggestions.join(", ") + "?";
          else message += " It may require a plugin to be enabled.";
          throw message;
        }
        const entry = handlers.get(command);
        if (entry.flags && "format" in entry.flags) {
          const options = entry.flags.format.value && entry.flags.format.value.split("|");
          if (options && !args.format) {
            for (const opt of options) {
              if (args[opt] || args["--" + opt]) {
                args.format = opt;
                delete args[opt];
                delete args["--" + opt];
                break;
              }
            }
          }
        }
        if (entry.flags) {
          const missing = [];
          for (const [key, flag] of Object.entries(entry.flags)) {
            if (flag.required && !(key in args)) {
              missing.push(flag.value ? key + "=" + flag.value : key);
            }
          }
          if (missing.length > 0) {
            throw "Missing required parameter: " + missing.join(", ") + "\nUsage: " + command + " " + describeCliOptions(entry.flags);
          }
        }
        const copy = args["--copy"] === "true";
        delete args["--copy"];
        const result = await entry.handler(args);
        if (copy && result) await navigator.clipboard.writeText(result);
        return result;
      };

      workspace.onLayoutReady(() => {
        if (window.cliQueue) {
          for (const item of window.cliQueue) {
            const { argv, resolve, reject } = item;
            Promise.resolve(window.handleCli(argv)).then(resolve, reject);
          }
          window.cliQueue = null;
        }
      });

      const describeCommand = (id, entry) => {
        const lines = [];
        lines.push("  " + id.padEnd(22) + entry.description);
        if (entry.flags) {
          for (const [key, flag] of Object.entries(entry.flags)) {
            const label = flag.value ? key + "=" + flag.value : key;
            let description = flag.description;
            if (flag.required) description += " (required)";
            const padded = label.length >= 20 ? label + "  " : label.padEnd(20);
            lines.push("    " + padded + "- " + description);
          }
        }
        return lines.join("\n") + "\n";
      };

      this.registerHandler("help", "Show list of all available commands", {
        "<command>": { description: "Show help for a specific command" },
      }, (args) => {
        let filter = "";
        for (const key of Object.keys(args)) {
          if (args[key] === "true") { filter = key; break; }
        }
        const sorted = Array.from(self.handlers.entries()).sort((a, b) => stringCollator.compare(a[0], b[0]));
        if (filter) {
          const matches = sorted.filter(([id]) => id === filter || id.startsWith(filter + ":"));
          if (matches.length === 0) {
            const suggestions = s05CommandScore(filter, sorted.map(([id]) => id));
            let message = 'No commands matching "' + filter + '".';
            if (suggestions.length) message += " Did you mean: " + suggestions.join(", ") + "?";
            return message;
          }
          return matches.map(([id, entry]) => describeCommand(id, entry)).join("\n");
        }
        const normal = [];
        const dev = [];
        for (const [id, entry] of sorted) {
          if (id.startsWith("__")) continue;
          const text = describeCommand(id, entry);
          if (id.startsWith("dev:") || id === "devtools" || id === "eval") dev.push(text);
          else normal.push(text);
        }
        return "Basalt CLI\n\nUsage: basalt <command> [options]\n\nOptions:\n  vault=<name>          Target a specific vault by name\n\nNotes:\n  file resolves by name (like wikilinks), path is exact (folder/note.md)\n  Most commands default to the active file when file/path is omitted\n  Quote values with spaces: name=\"My Note\"\n  Use \\n for newline, \\t for tab in content values\n\nCommands:\n" + normal.join("\n") + "\n\nDeveloper:\n" + dev.join("\n");
      });

      this.registerHandler("__completions", "", null, () => {
        const out = {};
        for (const [id, entry] of Array.from(self.handlers.entries())) {
          if (id.startsWith("__")) continue;
          let flags = entry.flags;
          if (flags) {
            flags = Object.fromEntries(Object.entries(flags).map(([key, flag]) => [key, {
              ...flag,
              description: flag.required ? flag.description + " (required)" : flag.description,
            }]));
          }
          out[id] = { usage: describeCliOptions(entry.flags), description: entry.description, flags };
        }
        return JSON.stringify(out);
      });

      this.registerHandler("__commands", "", null, () => {
        return JSON.stringify(commands.listCommands().map((cmd) => ({ id: cmd.id, name: cmd.name })));
      });

      this.registerHandler("__files", "", null, (args) => {
        const query = args.query || "";
        const limit = args.limit ? parseInt(args.limit, 10) : 20;
        const recent = new Set(workspace.getLastOpenFiles());
        const all = vault.getFiles().map((f) => f.path);
        const first = all.filter((p) => recent.has(p));
        const rest = all.filter((p) => !recent.has(p));
        const ordered = first.concat(rest);
        if (!query) return JSON.stringify(ordered.slice(0, limit));
        const finder = prepareFuzzyFinder(query);
        const scored = [];
        for (const path of ordered) {
          const match = finder(path);
          if (match) scored.push({ path, score: match.score });
        }
        scored.sort((a, b) => b.score - a.score);
        return JSON.stringify(scored.slice(0, limit).map((x) => x.path));
      });

      // ---------------- desktop-only devtools / eval ----------------
      if (Yl.isDesktopApp && window.electron) {
        const electron = window.electron;
        const contents = electron.remote.getCurrentWebContents();
        const cdp = contents.debugger;
        let consoleCapture = false;
        let consoleListener = null;
        const consoleBuffer = [];
        const errorBuffer = [];

        window.addEventListener("error", (event) => {
          errorBuffer.push({
            time: Date.now(),
            message: event.message,
            stack: event.error && event.error.stack,
          });
          if (errorBuffer.length > 50) errorBuffer.shift();
        });
        window.addEventListener("unhandledrejection", (event) => {
          errorBuffer.push({
            time: Date.now(),
            message: String(event.reason),
            stack: event.reason && event.reason.stack,
          });
          if (errorBuffer.length > 50) errorBuffer.shift();
        });

        const attachDebugger = async () => {
          if (!cdp.isAttached()) cdp.attach("1.3");
          await cdp.sendCommand("Runtime.enable");
          await cdp.sendCommand("DOM.enable");
          await cdp.sendCommand("CSS.enable");
          if (!consoleCapture) {
            if (consoleListener) cdp.removeListener("message", consoleListener);
            consoleListener = (event, method, params) => {
              if (method === "Runtime.consoleAPICalled") {
                let level = params.type;
                if (level === "warning") level = "warn";
                const message = (params.args && params.args.map((arg) => {
                  if (arg.type === "string") return arg.value;
                  if (arg.type === "undefined") return "undefined";
                  if (arg.type === "object" && arg.preview) {
                    return JSON.stringify((arg.preview.properties && arg.preview.properties.reduce((acc, p) => {
                      acc[p.name] = p.value;
                      return acc;
                    }, {})) || arg.description);
                  }
                  return arg.description || arg.value || String(arg);
                }).join(" ")) || "";
                consoleBuffer.push({ time: Date.now(), level, message });
                if (consoleBuffer.length > 200) consoleBuffer.shift();
              }
            };
            cdp.on("message", consoleListener);
            consoleCapture = true;
          }
          return cdp;
        };

        this.registerHandler("devtools", "Toggle Electron dev tools", null, () => {
          contents.toggleDevTools();
          return "Toggled dev tools.";
        });

        this.registerHandler("dev:mobile", "Toggle mobile emulation", {
          on: { description: "Enable mobile emulation" },
          off: { description: "Disable mobile emulation" },
        }, (args) => {
          const enabled = !!localStorage.getItem("EmulateMobile");
          const next = !!args.on || (!args.off && !enabled);
          if (next === enabled) return "Mobile emulation is already " + (next ? "enabled" : "disabled") + ".";
          app.emulateMobile(next);
          return "Mobile emulation " + (next ? "enabled" : "disabled") + ". Reloading...";
        });

        this.registerHandler("dev:debug", "Attach/detach Chrome DevTools Protocol debugger", {
          on: { description: "Attach debugger" },
          off: { description: "Detach debugger" },
        }, async (args) => {
          const attached = contents.debugger.isAttached();
          if (args.off) {
            if (!attached) return "Debugger is not attached.";
            if (cdp.isAttached()) {
              if (consoleListener) { cdp.removeListener("message", consoleListener); consoleListener = null; }
              cdp.detach();
            }
            consoleCapture = false;
            consoleBuffer.length = 0;
            return "Debugger detached. Console capture stopped.";
          }
          if (args.on) {
            if (attached) return "Debugger is already attached.";
            await attachDebugger();
            return "Debugger attached. Console capture started.";
          }
          return "Debugger is " + (attached ? "attached" : "detached") + ".";
        });

        this.registerHandler("dev:errors", "Show captured errors", {
          clear: { description: "Clear the error buffer" },
        }, (args) => {
          if (args.clear) {
            const count = errorBuffer.length;
            errorBuffer.length = 0;
            return "Cleared " + count + " errors.";
          }
          if (errorBuffer.length === 0) return "No errors captured.";
          return errorBuffer.map((e) => {
            const time = new Date(e.time).toTimeString().slice(0, 8);
            return time + " " + e.message + (e.stack ? "\n" + e.stack : "");
          }).join("\n\n");
        });

        this.registerHandler("dev:screenshot", "Take a screenshot", {
          path: { value: "<filename>", description: "Output file path" },
        }, async (args) => {
          const adapter = vault.adapter;
          const image = await contents.capturePage();
          const png = image.toPNG();
          const fs = If("original-fs");
          const path = If("path");
          const target = args.path && adapter instanceof Eu
            ? (path.isAbsolute(args.path) ? args.path : path.join(adapter.getBasePath(), args.path))
            : path.join(If("os").tmpdir(), "basalt-screenshot-" + Date.now().toLocaleString("sv") + ".png");
          fs.writeFileSync(target, png);
          return target;
        });

        this.registerHandler("dev:cdp", "Run a Chrome DevTools Protocol command", {
          method: { value: "<CDP.method>", description: "CDP method to call", required: true },
          params: { value: "<json>", description: "Method parameters as JSON" },
        }, async (args) => {
          if (!args.method) throw "Missing required parameter: method\nUsage: dev:cdp method=<CDP.method> [params=<json>]";
          const debugger_ = await attachDebugger();
          const params = args.params ? JSON.parse(args.params) : undefined;
          const result = await debugger_.sendCommand(args.method, params);
          return JSON.stringify(result, null, 2);
        });

        this.registerHandler("dev:css", "Inspect CSS with source locations", {
          selector: { value: "<css>", description: "CSS selector", required: true },
          prop: { value: "<name>", description: "Filter by property name" },
        }, async (args) => {
          const selector = args.selector;
          if (!selector) throw "Missing required parameter: selector\nUsage: dev:css selector=<css> [prop=<name>]";
          const debugger_ = await attachDebugger();
          const doc = (await debugger_.sendCommand("DOM.getDocument")).root;
          const nodeId = (await debugger_.sendCommand("DOM.querySelector", { nodeId: doc.nodeId, selector })).nodeId;
          if (!nodeId) throw "No element found for selector: " + selector;
          const matched = await debugger_.sendCommand("CSS.getMatchedStylesForNode", { nodeId });
          const out = [];
          const inline = matched.inlineStyle && matched.inlineStyle.cssProperties;
          if (inline && inline.length) {
            const props = inline.filter((p) => p.text);
            if (props.length > 0) {
              out.push("Inline styles:");
              for (const p of props) {
                if (args.prop && p.name !== args.prop) continue;
                out.push("  " + p.name + ": " + p.value);
              }
              out.push("");
            }
          }
          if (matched.matchedCSSRules && matched.matchedCSSRules.length) {
            out.push("Matched rules:");
            for (const entry of matched.matchedCSSRules) {
              const rule = entry.rule;
              const sel = (rule.selectorList && rule.selectorList.selectors && rule.selectorList.selectors.map((s) => s.text).join(", ")) || "?";
              let props = (rule.style && rule.style.cssProperties) || [];
              const origin = rule.origin;
              if (!args.prop || (props = props.filter((p) => p.name === args.prop), props.length !== 0)) {
                const where = rule.style && rule.style.range ? " (line " + (rule.style.range.startLine + 1) + ")" : "";
                if (origin === "user-agent") out.push("  [browser default] " + sel);
                else out.push("  " + sel + where);
                for (const p of props) {
                  if (p.name) out.push("    " + p.name + ": " + p.value + (p.important ? " !important" : ""));
                }
              }
            }
          }
          if (matched.inherited && matched.inherited.length && !args.prop) {
            out.push("");
            out.push("Inherited:");
            for (const group of matched.inherited.slice(0, 3)) {
              if (!group.matchedCSSRules || !group.matchedCSSRules.length) continue;
              for (const entry of group.matchedCSSRules) {
                const rule = entry.rule;
                if (rule.origin === "user-agent") continue;
                const sel = (rule.selectorList && rule.selectorList.selectors && rule.selectorList.selectors.map((s) => s.text).join(", ")) || "?";
                const props = ((rule.style && rule.style.cssProperties) || []).filter((p) =>
                  p.name && ["color", "font-family", "font-size", "font-weight", "line-height", "text-align"].includes(p.name));
                if (props.length === 0) continue;
                out.push("  " + sel);
                for (const p of props) out.push("    " + p.name + ": " + p.value);
              }
            }
          }
          return out.join("\n") || "No styles found.";
        });

        this.registerHandler("dev:dom", "Query DOM elements", {
          selector: { value: "<css>", description: "CSS selector", required: true },
          total: { description: "Return element count" },
          text: { description: "Return text content" },
          inner: { description: "Return innerHTML instead of outerHTML" },
          all: { description: "Return all matches instead of first" },
          attr: { value: "<name>", description: "Get attribute value" },
          css: { value: "<prop>", description: "Get CSS property value" },
        }, (args) => {
          const selector = args.selector;
          if (!selector) throw "Missing required parameter: selector\nUsage: dev:dom selector=<css> [total] [text] [inner] [all] [attr=<name>] [css=<prop>]";
          let elements;
          try {
            elements = Array.from(document.querySelectorAll(selector));
          } catch (e) {
            throw "Invalid selector: " + e.message;
          }
          if (elements.length === 0) return "No elements found.";
          if (args.total) return String(elements.length);
          if (args.attr) {
            const values = elements.map((el) => el.getAttribute(args.attr) ?? "(null)");
            return args.all ? values.join("\n") : values[0];
          }
          if (args.css) {
            // observed behaviour: a truthy css flag always dumps the full property list
            const read = (el) => {
              const style = window.getComputedStyle(el);
              return ["display", "position", "width", "height", "margin", "padding", "color", "background-color", "font-family", "font-size", "font-weight", "border", "flex", "grid", "opacity", "visibility", "z-index"]
                .map((prop) => prop + ": " + style.getPropertyValue(prop)).join("\n");
            };
            return args.all ? elements.map((el) => read(el)).join("\n\n") : read(elements[0]);
          }
          if (args.text) {
            const values = elements.map((el) => el.textContent && el.textContent.trim() || "");
            return args.all ? values.join("\n") : values[0];
          }
          const inner = args.inner;
          return args.all
            ? elements.map((el) => inner ? el.innerHTML : el.outerHTML).join("\n\n")
            : inner ? elements[0].innerHTML : elements[0].outerHTML;
        });

        this.registerHandler("dev:console", "Show captured console messages", {
          clear: { description: "Clear the console buffer" },
          limit: { value: "<n>", description: "Max messages to show (default 50)" },
          level: { value: "log|warn|error|info|debug", description: "Filter by log level" },
        }, (args) => {
          if (args.clear) {
            const count = consoleBuffer.length;
            consoleBuffer.length = 0;
            return "Cleared " + count + " console messages.";
          }
          if (!contents.debugger.isAttached()) throw 'Debugger not attached. Use "dev:debug on" to start capturing console messages.';
          let limit = args.limit ? parseInt(args.limit, 10) : 50;
          if (isNaN(limit) || limit < 1) limit = 50;
          let entries = consoleBuffer;
          const level = args.level;
          if (level) entries = entries.filter((e) => e.level === level);
          if (entries.length === 0) return "No console messages captured.";
          return entries.slice(-limit).map((e) => {
            const time = new Date(e.time).toTimeString().slice(0, 8);
            const tag = e.level === "log" ? "" : "[" + e.level.toUpperCase() + "] ";
            return time + " " + tag + e.message;
          }).join("\n");
        });

        this.registerHandler("eval", "Execute JavaScript and return result", {
          code: { value: "<javascript>", description: "JavaScript code to execute", required: true },
        }, async (args) => {
          const code = args.code;
          if (!code) throw "Missing required parameter: code\nUsage: eval code=<javascript>";
          const logs = [];
          const origLog = console.log, origWarn = console.warn, origError = console.error;
          const formatArg = (value) => {
            if (value === undefined) return "undefined";
            if (value === null) return "null";
            if (typeof value === "object") {
              try { return JSON.stringify(value); } catch (e) { return String(value); }
            }
            return String(value);
          };
          const joinArgs = (...values) => values.map(formatArg).join(" ");
          console.log = (...values) => { logs.push(joinArgs(...values)); origLog.apply(console, values); };
          console.warn = (...values) => { logs.push("[warn] " + joinArgs(...values)); origWarn.apply(console, values); };
          console.error = (...values) => { logs.push("[error] " + joinArgs(...values)); origError.apply(console, values); };
          let result;
          try {
            result = await window.eval(code);
          } catch (e) {
            const out = [];
            if (logs.length > 0) out.push(...logs);
            out.push("Error: " + (e.message || e));
            return out.join("\n");
          } finally {
            console.log = origLog;
            console.warn = origWarn;
            console.error = origError;
          }
          const out = [];
          if (logs.length > 0) out.push(...logs);
          if (result !== undefined) {
            if (result === null) out.push("=> null");
            else if (typeof result === "object") out.push("=> " + JSON.stringify(result, null, 2));
            else out.push("=> " + String(result));
          }
          return out.length > 0 ? out.join("\n") : "(no output)";
        });
      }

      // ---------------- general commands ----------------
      this.registerHandler("commands", "List available commands", {
        filter: { value: "<prefix>", description: "Filter by ID prefix" },
      }, (args) => {
        let list = commands.listCommands();
        if (args.filter) list = list.filter((cmd) => cmd.id.startsWith(args.filter));
        list.sort((a, b) => stringCollator.compare(a.id, b.id));
        return list.map((cmd) => cmd.id).join("\n");
      });

      this.registerHandler("command", "Execute an Basalt command", {
        id: { value: "<command-id>", description: "Command ID to execute", required: true },
      }, (args) => {
        const id = args.id;
        if (!id) return "Missing required parameter: id\nUsage: command id=<command-id>";
        if (!commands.findCommand(id)) throw 'Command "' + id + '" not found. Use "commands" to list available command IDs.';
        if (commands.executeCommandById(id)) return "Executed: " + id;
        throw "Failed to execute: " + id;
      });

      const randomMarkdownFile = (folder) => {
        let files = vault.getMarkdownFiles();
        if (folder) {
          const prefix = folder.endsWith("/") ? folder : folder + "/";
          files = files.filter((f) => f.path.startsWith(prefix));
        }
        if (files.length === 0) return null;
        return files[Math.floor(Math.random() * files.length)];
      };

      this.registerHandler("random", "Open a random note", {
        folder: { value: "<path>", description: "Limit to folder" },
        newtab: { description: "Open in new tab" },
      }, async (args) => {
        const file = randomMarkdownFile(args.folder);
        if (!file) return "No markdown files found.";
        await (args.newtab ? workspace.getLeaf("tab") : workspace.getLeaf()).openFile(file, { active: true });
        return "Opened: " + file.path;
      });

      this.registerHandler("random:read", "Read a random note", {
        folder: { value: "<path>", description: "Limit to folder" },
      }, async (args) => {
        const file = randomMarkdownFile(args.folder);
        if (!file) return "No markdown files found.";
        const text = await vault.cachedRead(file);
        return file.path + "\n\n" + text;
      });

      this.registerHandler("reload", "Reload the vault", null, () => {
        setTimeout(() => window.location.reload(), 10);
        return "Reloading...";
      });

      this.registerHandler("restart", "Restart the app", null, () => {
        if (Yl.isDesktopApp && window.electron) {
          setTimeout(() => window.electron.ipcRenderer.sendSync("relaunch"), 100);
        } else {
          setTimeout(() => window.location.reload(), 10);
        }
        return "Restarting...";
      });

      this.registerHandler("plugin", "Get plugin info", {
        id: { value: "<plugin-id>", description: "Plugin ID", required: true },
      }, (args) => {
        if (!args.id) throw "Missing required parameter: id\nUsage: plugin id=<plugin-id>";
        const core = internalPlugins.plugins[args.id];
        if (core) {
          return ["type\tcore", "name\t" + (core.instance.name || args.id), "enabled\t" + core.enabled].join("\n");
        }
        const manifest = communityPlugins.manifests[args.id];
        if (manifest) {
          const enabled = communityPlugins.enabledPlugins.has(args.id);
          const lines = ["type\tcommunity", "name\t" + manifest.name, "version\t" + manifest.version, "author\t" + manifest.author, "enabled\t" + enabled];
          if (manifest.description) lines.push("description\t" + manifest.description);
          return lines.join("\n");
        }
        throw 'Plugin "' + args.id + '" not found.';
      });

      const pluginRows = (args, enabledOnly) => {
        const rows = [];
        if (!args.filter || args.filter === "core") {
          const list = enabledOnly ? internalPlugins.getEnabledPlugins() : Object.keys(internalPlugins.plugins);
          for (const entry of list) {
            rows.push({ id: enabledOnly ? entry.instance.id : entry });
          }
        }
        if (!args.filter || args.filter === "community") {
          const source = enabledOnly ? Array.from(communityPlugins.enabledPlugins) : Object.entries(communityPlugins.manifests);
          for (const item of source) {
            if (enabledOnly) {
              const manifest = communityPlugins.manifests[item];
              rows.push({ id: item, version: manifest && manifest.version });
            } else {
              const [id, manifest] = item;
              rows.push({ id, version: manifest.version });
            }
          }
        }
        rows.sort((a, b) => stringCollator.compare(a.id, b.id));
        const headers = args.versions ? ["id", "version"] : ["id"];
        const body = rows.map((row) => args.versions ? [row.id, row.version || ""] : [row.id]);
        return self.formatTable(headers, body, args.format);
      };

      const listFlags = {
        filter: { value: "core|community", description: "Filter by plugin type" },
        versions: { description: "Include version numbers" },
        format: { value: "json|tsv|csv", description: "Output format (default: tsv)" },
      };
      this.registerHandler("plugins", "List installed plugins", listFlags, (args) => pluginRows(args, false));
      this.registerHandler("plugins:enabled", "List enabled plugins", listFlags, (args) => pluginRows(args, true));

      this.registerHandler("plugins:restrict", "Toggle or check restricted mode", {
        on: { description: "Enable restricted mode" },
        off: { description: "Disable restricted mode" },
      }, async (args) => {
        const restricted = !communityPlugins.isEnabled();
        if (args.on) {
          if (restricted) return "Restricted mode is already enabled.";
          await communityPlugins.setEnable(false);
          setTimeout(() => window.location.reload(), 10);
          return "Restricted mode enabled. Reloading...";
        }
        if (args.off) {
          if (!restricted) return "Restricted mode is already disabled.";
          await communityPlugins.setEnable(true);
          setTimeout(() => window.location.reload(), 10);
          return "Restricted mode disabled. Reloading...";
        }
        return restricted ? "on" : "off";
      });

      this.registerHandler("themes", "List installed themes", {
        versions: { description: "Include version numbers" },
      }, (args) => {
        const themes = [];
        for (const [name, theme] of Object.entries(customCss.themes)) {
          themes.push({ name, version: theme.version });
        }
        for (const name of customCss.oldThemes) {
          themes.push({ name });
        }
        themes.sort((a, b) => stringCollator.compare(a.name, b.name));
        if (args.versions) {
          return themes.map((t) => t.version ? t.name + "\t" + t.version : t.name).join("\n");
        }
        return themes.map((t) => t.name).join("\n");
      });

      this.registerHandler("theme", "Show active theme or get info", {
        name: { value: "<name>", description: "Theme name for details" },
      }, (args) => {
        if (args.name) {
          const theme = customCss.themes[args.name];
          if (theme) {
            const active = customCss.theme === args.name;
            return ["name\t" + theme.name, "version\t" + (theme.version || "(unknown)"), "author\t" + theme.author, "active\t" + active].join("\n");
          }
          if (customCss.oldThemes.includes(args.name)) {
            const active = customCss.theme === args.name;
            return ["name\t" + args.name, "version\t(legacy theme)", "active\t" + active].join("\n");
          }
          throw 'Theme "' + args.name + '" not found.';
        }
        return customCss.theme || "(default)";
      });

      this.registerHandler("snippets", "List installed CSS snippets", null, () => {
        return customCss.snippets.join("\n");
      });

      this.registerHandler("snippets:enabled", "List enabled CSS snippets", null, () => {
        return Array.from(customCss.enabledSnippets).join("\n");
      });

      this.registerHandler("tags", "List tags in the vault", {
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
        total: { description: "Return tag count" },
        counts: { description: "Include tag counts" },
        sort: { value: "count", description: "Sort by count (default: name)" },
        format: { value: "json|tsv|csv", description: "Output format (default: tsv)" },
        active: { description: "Show tags for active file" },
      }, (args) => {
        let entries;
        if (args.active || args.file || args.path) {
          const file = self.tryResolveFile(args);
          const cache = metadataCache.getFileCache(file);
          const counts = {};
          const tags = cache ? collectTags(cache) : [];
          for (const tag of tags) counts[tag] = (counts[tag] || 0) + 1;
          entries = Object.entries(counts);
        } else {
          entries = Object.entries(metadataCache.getTags());
        }
        if (args.total) return String(entries.length);
        if (entries.length === 0) return "No tags found.";
        if (args.sort === "count") entries.sort((a, b) => b[1] - a[1]);
        else entries.sort((a, b) => stringCollator.compare(a[0], b[0]));
        const headers = args.counts ? ["tag", "count"] : ["tag"];
        const rows = entries.map(([tag, count]) => args.counts ? [tag, String(count)] : [tag]);
        return self.formatTable(headers, rows, args.format);
      });

      this.registerHandler("tasks", "List tasks in the vault", {
        file: { value: "<name>", description: "Filter by file name" },
        path: { value: "<path>", description: "Filter by file path" },
        total: { description: "Return task count" },
        done: { description: "Show completed tasks" },
        todo: { description: "Show incomplete tasks" },
        status: { value: '"<char>"', description: "Filter by status character" },
        verbose: { description: "Group by file with line numbers" },
        format: { value: "json|tsv|csv", description: "Output format (default: text)" },
        active: { description: "Show tasks for active file" },
        daily: { description: "Show tasks from daily note" },
      }, async (args) => {
        const tasks = [];
        let files;
        if (args.daily) {
          const daily = internalPlugins.getEnabledPluginById("daily-notes");
          if (!daily) throw "Daily notes plugin is not enabled.";
          const note = await daily.getDailyNote();
          if (!note) throw "Failed to get daily note.";
          files = [note];
        } else {
          files = args.active || args.file || args.path ? [self.tryResolveFile(args)] : vault.getMarkdownFiles();
        }
        for (const file of files) {
          const cache = metadataCache.getFileCache(file);
          if (cache && cache.listItems) {
            for (const item of cache.listItems) {
              if (item.task !== undefined) {
                tasks.push({ path: file.path, line: item.position.start.line + 1, task: item.task });
              }
            }
          }
        }
        if (args.status !== undefined) {
          const status = args.status;
          tasks = tasks.filter((t) => t.task === status);
        } else if (args.done) {
          tasks = tasks.filter((t) => t.task !== " ");
        } else if (args.todo) {
          tasks = tasks.filter((t) => t.task === " ");
        }
        if (args.total) return String(tasks.length);
        if (tasks.length === 0) return "No tasks found.";
        tasks.sort((a, b) => {
          const byPath = stringCollator.compare(a.path, b.path);
          return byPath !== 0 ? byPath : a.line - b.line;
        });
        const contents = new Map();
        for (const task of tasks) {
          if (!contents.has(task.path)) {
            const file = vault.getAbstractFileByPath(task.path);
            if (file instanceof s05TFile()) {
              const text = await vault.cachedRead(file);
              contents.set(task.path, text.split("\n"));
            }
          }
          const lines = contents.get(task.path);
          if (lines && lines[task.line - 1] !== undefined) task.text = lines[task.line - 1].trim();
        }
        if (args.format) {
          const headers = ["status", "text", "file", "line"];
          const rows = tasks.map((t) => [t.task, t.text || "", t.path, String(t.line)]);
          return self.formatTable(headers, rows, args.format);
        }
        if (args.verbose) {
          const byFile = new Map();
          for (const task of tasks) {
            const list = byFile.get(task.path) || [];
            list.push(task);
            byFile.set(task.path, list);
          }
          const out = [];
          for (const [path, list] of Array.from(byFile.entries())) {
            out.push(path);
            for (const task of list) out.push(task.line + "\t" + (task.text || ""));
            out.push("");
          }
          if (out.length > 0 && out[out.length - 1] === "") out.pop();
          return out.join("\n");
        }
        return tasks.map((t) => t.text || "").join("\n");
      });

      this.registerHandler("task", "Show or update a task", {
        ref: { value: "<path:line>", description: "Task reference (path:line)" },
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
        line: { value: "<n>", description: "Line number" },
        toggle: { description: "Toggle task status" },
        done: { description: "Mark as done" },
        todo: { description: "Mark as todo" },
        daily: { description: "Use daily note" },
        status: { value: '"<char>"', description: "Set status character" },
      }, async (args) => {
        let filePath;
        let line;
        if (args.ref) {
          const colon = args.ref.lastIndexOf(":");
          if (colon === -1) throw 'Invalid ref format. Expected path:line (e.g., "Note.md:5")';
          filePath = args.ref.slice(0, colon);
          line = parseInt(args.ref.slice(colon + 1), 10);
          if (isNaN(line) || line < 1) throw "Invalid line number in ref.";
        } else {
          if (!args.line) throw "Missing required parameter: line\nUsage: task ref=<path:line> or task daily line=<n> or task file=<name> line=<n>";
          line = parseInt(args.line, 10);
          if (isNaN(line) || line < 1) throw "Invalid line number.";
          if (args.daily) {
            const daily = internalPlugins.getEnabledPluginById("daily-notes");
            if (!daily) throw "Daily notes plugin is not enabled.";
            const note = await daily.getDailyNote();
            if (!note) throw "Failed to get daily note.";
            filePath = note.path;
          } else {
            filePath = self.tryResolveFile(args, false).path;
          }
        }
        let file = vault.getAbstractFileByPath(filePath);
        if (!file) file = metadataCache.getFirstLinkpathDest(filePath, "");
        if (!(file && file instanceof s05TFile())) throw 'File "' + filePath + '" not found.';
        const text = await vault.cachedRead(file);
        const lines = text.split("\n");
        if (line < 1 || line > lines.length) throw "Line " + line + " is out of range (file has " + lines.length + " lines).";
        const target = lines[line - 1];
        const match = target.match(/^(\s*(?:[-*]|\d+\.)\s*\[)(.)(\].*)$/);
        if (!match) throw "Line " + line + " is not a task.";
        const current = match[2];
        let next = null;
        if (args.status !== undefined) {
          next = args.status;
          if (next.length !== 1) throw "Status must be a single character.";
        } else if (args.done) {
          next = "x";
        } else if (args.todo) {
          next = " ";
        } else if (args.toggle) {
          next = current === " " ? "x" : " ";
        }
        if (next === null) {
          return ["file\t" + file.path, "line\t" + line, "status\t" + current, "text\t" + target.trim()].join("\n");
        }
        if (next === current) return "Task already has status [" + current + "].";
        const updated = match[1] + next + match[3];
        lines[line - 1] = updated;
        await vault.modify(file, lines.join("\n"));
        return "Updated: [" + current + "] → [" + next + "]\n" + updated.trim();
      });

      this.registerHandler("tag", "Get tag info", {
        name: { value: "<tag>", description: "Tag name", required: true },
        total: { description: "Return occurrence count" },
        verbose: { description: "Include file list and count" },
      }, (args) => {
        if (!args.name) throw "Missing required parameter: name\nUsage: tag name=<tag>";
        const tag = args.name.startsWith("#") ? args.name : "#" + args.name;
        const count = metadataCache.getTags()[tag];
        if (count === undefined) throw 'Tag "' + tag + '" not found.';
        if (args.total) return String(count);
        const files = [];
        for (const file of vault.getMarkdownFiles()) {
          const tags = collectTags(metadataCache.getFileCache(file));
          if (tags && tags.some((t) => t.toLowerCase() === tag.toLowerCase())) files.push(file.path);
        }
        files.sort(stringCollator.compare);
        return args.verbose ? tag + "\t" + count + "\n" + files.join("\n") : files.join("\n");
      });

      this.registerHandler("properties", "List properties in the vault", {
        file: { value: "<name>", description: "Show properties for file" },
        path: { value: "<path>", description: "Show properties for path" },
        name: { value: "<name>", description: "Get specific property count" },
        total: { description: "Return property count" },
        sort: { value: "count", description: "Sort by count (default: name)" },
        counts: { description: "Include occurrence counts" },
        format: { value: "yaml|json|tsv", description: "Output format (default: yaml)" },
        active: { description: "Show properties for active file" },
      }, (args) => {
        if (args.active || args.file || args.path) {
          const file = self.tryResolveFile(args);
          const cache = metadataCache.getFileCache(file);
          if (!(cache && cache.frontmatter)) return "No frontmatter found.";
          const frontmatter = cache.frontmatter;
          if (Object.keys(frontmatter).length === 0) return "No frontmatter found.";
          if (args.format === "json") return JSON.stringify(frontmatter, null, 2);
          if (args.format === "tsv") {
            const lines = [];
            for (const key in frontmatter) {
              const value = frontmatter[key];
              if (Array.isArray(value)) lines.push(key + "\t" + value.join(", "));
              else if (value !== null && value !== undefined) lines.push(key + "\t" + value);
            }
            return lines.join("\n");
          }
          return env_().vA(frontmatter).trim();
        }
        const all = app.metadataTypeManager.getAllProperties();
        if (args.name) {
          const prop = all[args.name.toLowerCase()];
          if (!prop) throw 'Property "' + args.name + '" not found.';
          return String(prop.occurrences);
        }
        const props = Object.values(all);
        if (args.total) return String(props.length);
        if (args.sort === "count") props.sort((a, b) => b.occurrences - a.occurrences);
        else props.sort((a, b) => stringCollator.compare(a.name, b.name));
        if (args.format === "json") {
          return JSON.stringify(props.map((p) => ({ name: p.name, type: p.widget, count: p.occurrences })), null, 2);
        }
        if (args.counts) return props.map((p) => p.name + "\t" + p.occurrences).join("\n");
        return props.map((p) => p.name).join("\n");
      });

      this.registerHandler("property:set", "Set a property on a file", {
        name: { value: "<name>", description: "Property name", required: true },
        value: { value: "<value>", description: "Property value", required: true },
        type: { value: "text|list|number|checkbox|date|datetime", description: "Property type" },
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
      }, async (args) => {
        if (!args.name) throw "Missing required parameter: name";
        const file = self.tryResolveFile(args, true);
        const key = args.name;
        let type = args.type;
        let value;
        if (args.value.startsWith("[") && args.value.endsWith("]")) {
          try {
            const parsed = JSON.parse(args.value);
            if (Array.isArray(parsed)) {
              value = parsed;
              if (!type) type = "list";
            } else {
              value = args.value;
            }
          } catch (e) {
            value = args.value;
          }
        } else if (type === "number") {
          value = Number(args.value);
          if (isNaN(value)) throw "Invalid number: " + args.value;
        } else if (type === "checkbox") {
          value = args.value === "true" || args.value === "1";
        } else if (type === "list") {
          value = args.value.split(",").map((s) => s.trim());
        } else if (type === "date" || type === "datetime") {
          if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(args.value)) throw "Invalid date format. Use YYYY-MM-DD";
          if (type === "datetime" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(args.value)) throw "Invalid datetime format. Use YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss";
          value = args.value;
        } else {
          value = args.value;
        }
        await app.fileManager.processFrontMatter(file, (fm) => { fm[key] = value; });
        if (type) {
          const widget = type === "list" ? "multitext" : type;
          await app.metadataTypeManager.setType(key, widget);
        }
        return "Set " + key + ": " + (args.value ?? "");
      });

      this.registerHandler("property:remove", "Remove a property from a file", {
        name: { value: "<name>", description: "Property name", required: true },
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
      }, async (args) => {
        if (!args.name) throw "Missing required parameter: name";
        const file = self.tryResolveFile(args, true);
        await app.fileManager.processFrontMatter(file, (fm) => { delete fm[args.name]; });
        return "Removed: " + args.name;
      });

      this.registerHandler("property:read", "Read a property value from a file", {
        name: { value: "<name>", description: "Property name", required: true },
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
      }, (args) => {
        if (!args.name) throw "Missing required parameter: name";
        const file = self.tryResolveFile(args, true);
        const cache = metadataCache.getFileCache(file);
        if (!(cache && cache.frontmatter)) throw 'Property "' + args.name + '" not found.';
        const value = cache.frontmatter[args.name];
        if (value === undefined) throw 'Property "' + args.name + '" not found.';
        if (Array.isArray(value)) return value.length > 0 ? value.join("\n") : "(empty)";
        if (value === "" || value === null) return "(empty)";
        return String(value);
      });

      this.registerHandler("tabs", "List open tabs", {
        ids: { description: "Include tab IDs" },
      }, (args) => {
        const withIds = args.ids;
        const out = [];
        workspace.iterateAllLeaves((leaf) => {
          const view = leaf.view;
          const line = "[" + view.getViewType() + "] " + leaf.getDisplayText();
          out.push(line + (withIds ? "\t" + leaf.id : ""));
        });
        return out.join("\n");
      });

      this.registerHandler("recents", "List recently opened files", {
        total: { description: "Return recent file count" },
      }, (args) => {
        const files = workspace.getLastOpenFiles();
        if (args.total) return String(files.length);
        if (files.length === 0) return "No recent files.";
        return files.join("\n");
      });

      this.registerHandler("tab:open", "Open a new tab", {
        group: { value: "<id>", description: "Tab group ID" },
        file: { value: "<path>", description: "File to open" },
        view: { value: "<type>", description: "View type to open" },
      }, async (args) => {
        let leaf;
        if (args.group) {
          let group = null;
          const find = (item) => {
            if ((item instanceof zD || item instanceof WD) && item.id === args.group) {
              group = item;
              return true;
            }
            if (item instanceof ID) {
              for (const child of item.children) {
                if (find(child)) return true;
              }
            }
            return false;
          };
          find(workspace.rootSplit);
          if (!group) find(workspace.leftSplit);
          if (!group) find(workspace.rightSplit);
          if (!group) find(workspace.floatingSplit);
          if (!group) throw 'Tab group "' + args.group + '" not found. Use "workspace ids=true" to list tab group IDs.';
          leaf = workspace.createLeafInTabGroup(group);
        } else {
          leaf = workspace.getLeaf("tab");
        }
        if (args.file) {
          const file = vault.getAbstractFileByPath(args.file);
          if (!file) throw 'File "' + args.file + '" not found.';
          if (!(file instanceof s05TFile())) throw '"' + args.file + '" is a folder, not a file.';
          await leaf.openFile(file, { active: true });
          return "Opened: " + args.file;
        }
        if (args.view) {
          await leaf.setViewState({ type: args.view });
          return "Opened view: " + args.view;
        }
        return "Opened new tab";
      });

      this.registerHandler("workspace", "Show workspace tree", {
        ids: { description: "Include workspace item IDs" },
      }, (args) => {
        const withIds = args.ids;
        const describe = (item) => {
          if (item instanceof jD) {
            const view = item.view;
            return { label: "[" + view.getViewType() + "] " + item.getDisplayText() + (withIds ? " (" + item.id + ")" : "") };
          }
          if (item instanceof ID) {
            let type = item.type;
            if (item instanceof OD) type += ":" + item.direction;
            return { label: type + (withIds ? " (" + item.id + ")" : ""), children: item.children.map(describe) };
          }
          return { label: "unknown" };
        };
        const out = [];
        out.push(self.formatAsciiTreeWithRoot("main" + (withIds ? " (" + workspace.rootSplit.id + ")" : ""), workspace.rootSplit.children.map(describe)));
        out.push(self.formatAsciiTreeWithRoot("left" + (withIds ? " (" + workspace.leftSplit.id + ")" : ""), workspace.leftSplit.children.map(describe)));
        out.push(self.formatAsciiTreeWithRoot("right" + (withIds ? " (" + workspace.rightSplit.id + ")" : ""), workspace.rightSplit.children.map(describe)));
        if (workspace.floatingSplit.children.length > 0) {
          out.push(self.formatAsciiTreeWithRoot("floating" + (withIds ? " (" + workspace.floatingSplit.id + ")" : ""), workspace.floatingSplit.children.map(describe)));
        }
        return out.join("\n");
      });

      this.registerHandler("hotkeys", "List hotkeys", {
        total: { description: "Return hotkey count" },
        verbose: { description: "Show if hotkey is custom" },
        format: { value: "json|tsv|csv", description: "Output format (default: tsv)" },
        all: { description: "Include commands without hotkeys" },
      }, (args) => {
        const manager = app.hotkeyManager;
        const headers = args.verbose ? ["id", "hotkey", "custom"] : ["id", "hotkey"];
        const rows = [];
        for (const id in commands.commands) {
          const custom = manager.getHotkeys(id);
          const fallback = manager.getDefaultHotkeys(id);
          const hotkeys = custom || fallback;
          const text = hotkeys && hotkeys.length ? hotkeys.map((h) => formatHotkey(h)).join(", ") : "";
          rows.push(args.verbose ? [id, text, custom ? "custom" : "default"] : [id, text]);
        }
        rows.sort((a, b) => stringCollator.compare(a[0], b[0]));
        if (args.total) return String(rows.length);
        return self.formatTable(headers, rows, args.format);
      });

      this.registerHandler("hotkey", "Get hotkey for a command", {
        id: { value: "<command-id>", description: "Command ID", required: true },
        verbose: { description: "Show if custom or default" },
      }, (args) => {
        if (!args.id) throw "Missing required parameter: id\nUsage: hotkey id=<command-id>";
        const manager = app.hotkeyManager;
        if (!commands.commands[args.id]) throw 'Command "' + args.id + '" not found.';
        const custom = manager.getHotkeys(args.id);
        const fallback = manager.getDefaultHotkeys(args.id);
        const hotkeys = custom || fallback;
        if (!hotkeys || hotkeys.length === 0) return "(none)";
        const text = hotkeys.map((h) => formatHotkey(h)).join(", ");
        if (args.verbose) return text + (custom ? " (custom)" : " (default)");
        return text;
      });

      this.registerHandler("vault", "Show vault info", {
        info: { value: "name|path|files|folders|size", description: "Return specific info only" },
      }, (args) => {
        const adapter = vault.adapter;
        if (args.info === "name") return vault.getName();
        if (args.info === "path") return adapter instanceof Eu ? adapter.getBasePath() : "(not available)";
        const root = vault.getRoot();
        const files = root.getFileCount();
        const folders = root.getFolderCount();
        if (args.info === "files") return String(files);
        if (args.info === "folders") return String(folders);
        if (args.info === "size") {
          let size = 0;
          for (const file of vault.getFiles()) size += file.stat.size;
          return String(size);
        }
        const out = [];
        out.push("name\t" + vault.getName());
        if (adapter instanceof Eu) out.push("path\t" + adapter.getBasePath());
        out.push("files\t" + files);
        out.push("folders\t" + folders);
        let size = 0;
        for (const file of vault.getFiles()) size += file.stat.size;
        out.push("size\t" + size);
        return out.join("\n");
      });

      this.registerHandler("files", "List files in the vault", {
        folder: { value: "<path>", description: "Filter by folder" },
        ext: { value: "<extension>", description: "Filter by extension" },
        total: { description: "Return file count" },
      }, (args) => {
        let files = vault.getFiles();
        if (args.folder) {
          const prefix = args.folder.endsWith("/") ? args.folder : args.folder + "/";
          files = files.filter((f) => f.path.startsWith(prefix));
        }
        if (args.ext) {
          const ext = args.ext.startsWith(".") ? args.ext.slice(1) : args.ext;
          files = files.filter((f) => f.extension === ext);
        }
        if (args.total) return String(files.length);
        return files.map((f) => f.path).sort(stringCollator.compare).join("\n");
      });

      this.registerHandler("folders", "List folders in the vault", {
        folder: { value: "<path>", description: "Filter by parent folder" },
        total: { description: "Return folder count" },
      }, (args) => {
        const folders = [];
        const root = args.folder ? vault.getFolderByPath(args.folder) : vault.getRoot();
        if (!root) throw 'Folder "' + args.folder + '" not found.';
        JT.recurseChildren(root, (child) => {
          if (child instanceof s05TFolder()) folders.push(child);
        });
        if (args.total) return String(folders.length);
        return folders.map((f) => f.path).sort(stringCollator.compare).join("\n");
      });

      this.registerHandler("vaults", "List known vaults", {
        total: { description: "Return vault count" },
        verbose: { description: "Include vault paths" },
      }, (args) => {
        if (Yl.isMobile) throw "This command is only available on desktop.";
        const path = If("path");
        const list = Object.values(window.electron.ipcRenderer.sendSync("vault-list"));
        if (args.total) return String(list.length);
        list.sort((a, b) => b.ts - a.ts);
        if (args.verbose) return list.map((v) => path.basename(v.path) + "\t" + v.path).join("\n");
        return list.map((v) => path.basename(v.path)).join("\n");
      });

      this.registerHandler("version", "Show Basalt version", null, () => {
        return Yl.version + " (installer " + Yl.build + ")";
      });

      this.registerHandler("backlinks", "List backlinks to a file", {
        file: { value: "<name>", description: "Target file name" },
        path: { value: "<path>", description: "Target file path" },
        counts: { description: "Include link counts" },
        total: { description: "Return backlink count" },
        format: { value: "json|tsv|csv", description: "Output format (default: tsv)" },
      }, (args) => {
        const target = self.tryResolveFile(args).path;
        const links = metadataCache.resolvedLinks;
        const rows = [];
        for (const source in links) {
          if (Object.hasOwn(links, source) && Object.hasOwn(links[source], target)) {
            rows.push({ path: source, count: links[source][target] });
          }
        }
        if (args.total) {
          return String(rows.reduce((sum, row) => sum + row.count, 0));
        }
        if (rows.length === 0) return "No backlinks found.";
        rows.sort((a, b) => stringCollator.compare(a.path, b.path));
        const headers = args.counts ? ["file", "count"] : ["file"];
        const body = rows.map((row) => args.counts ? [row.path, String(row.count)] : [row.path]);
        return self.formatTable(headers, body, args.format);
      });

      this.registerHandler("unresolved", "List unresolved links in vault", {
        total: { description: "Return unresolved link count" },
        counts: { description: "Include link counts" },
        verbose: { description: "Include source files" },
        format: { value: "json|tsv|csv", description: "Output format (default: tsv)" },
      }, (args) => {
        const unresolved = metadataCache.unresolvedLinks;
        const rows = [];
        const byLink = new Map();
        for (const source in unresolved) {
          if (!Object.hasOwn(unresolved, source)) continue;
          const links = unresolved[source];
          for (const link in links) {
            if (!Object.hasOwn(links, link)) continue;
            const count = links[link];
            const entry = byLink.get(link);
            if (entry) {
              entry.sources.push(source);
              entry.count += count;
            } else {
              byLink.set(link, { sources: [source], count });
            }
          }
        }
        for (const [link, entry] of Array.from(byLink.entries())) {
          rows.push({ link, sources: entry.sources, count: entry.count });
        }
        if (args.total) return String(rows.length);
        if (rows.length === 0) return "No unresolved links found.";
        rows.sort((a, b) => stringCollator.compare(a.link, b.link));
        const headers = args.verbose ? ["link", "count", "sources"] : args.counts ? ["link", "count"] : ["link"];
        const body = rows.map((row) => args.verbose
          ? [row.link, String(row.count), row.sources.join(", ")]
          : args.counts ? [row.link, String(row.count)] : [row.link]);
        return self.formatTable(headers, body, args.format);
      });

      this.registerHandler("orphans", "List files with no incoming links", {
        total: { description: "Return orphan count" },
        all: { description: "Include non-markdown files" },
      }, (args) => {
        const links = metadataCache.resolvedLinks;
        const targets = new Set();
        for (const source in links) {
          if (!Object.hasOwn(links, source)) continue;
          const dests = links[source];
          for (const dest in dests) {
            if (Object.hasOwn(dests, dest)) targets.add(dest);
          }
        }
        const orphans = [];
        for (const file of vault.getFiles()) {
          if (!targets.has(file.path)) orphans.push(file.path);
        }
        if (args.total) return String(orphans.length);
        if (orphans.length === 0) return "No orphan files found.";
        return orphans.sort(stringCollator.compare).join("\n");
      });

      this.registerHandler("deadends", "List files with no outgoing links", {
        total: { description: "Return dead-end count" },
        all: { description: "Include non-markdown files" },
      }, (args) => {
        const links = metadataCache.resolvedLinks;
        const deadends = [];
        for (const file of vault.getFiles()) {
          const outgoing = links[file.path];
          if (!outgoing || Object.keys(outgoing).length === 0) deadends.push(file.path);
        }
        if (args.total) return String(deadends.length);
        if (deadends.length === 0) return "No dead-end files found.";
        return deadends.sort(stringCollator.compare).join("\n");
      });

      this.registerHandler("aliases", "List aliases in the vault", {
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
        total: { description: "Return alias count" },
        verbose: { description: "Include file paths" },
        active: { description: "Show aliases for active file" },
      }, (args) => {
        if (args.active || args.file || args.path) {
          const file = self.tryResolveFile(args);
          const cache = metadataCache.getFileCache(file);
          const aliases = frontmatterAliases(cache && cache.frontmatter) || [];
          if (args.total) return String(aliases.length);
          if (aliases.length === 0) return "No aliases found.";
          return aliases.sort(stringCollator.compare).join("\n");
        }
        const byAlias = new Map();
        for (const file of vault.getMarkdownFiles()) {
          const cache = metadataCache.getFileCache(file);
          const aliases = frontmatterAliases(cache && cache.frontmatter);
          if (aliases) {
            for (const alias of aliases) {
              if (alias && typeof alias === "string") {
                const list = byAlias.get(alias) || [];
                list.push(file.path);
                byAlias.set(alias, list);
              }
            }
          }
        }
        if (args.total) return String(byAlias.size);
        if (byAlias.size === 0) return "No aliases found.";
        const sorted = Array.from(byAlias.entries()).sort((a, b) => stringCollator.compare(a[0], b[0]));
        if (args.verbose) {
          return sorted.map(([alias, paths]) => alias + "\t" + paths.join(", ")).join("\n");
        }
        return sorted.map(([alias]) => alias).join("\n");
      });

      this.registerHandler("folder", "Show folder info", {
        path: { value: "<path>", description: "Folder path", required: true },
        info: { value: "files|folders|size", description: "Return specific info only" },
      }, (args) => {
        if (!args.path) throw "Missing required parameter: path\nUsage: folder path=<folder-path> [info=files|folders|size]";
        const item = vault.getAbstractFileByPath(args.path);
        if (!item) throw 'Folder "' + args.path + '" not found.';
        if (!(item instanceof s05TFolder())) throw '"' + args.path + '" is a file, not a folder.';
        const folder = item;
        const files = folder.getFileCount();
        const folders = folder.getFolderCount();
        const sizeOf = (dir) => {
          let size = 0;
          for (const child of dir.children) {
            if (child instanceof s05TFolder()) size += sizeOf(child);
            else if (child instanceof s05TFile()) size += child.stat.size;
          }
          return size;
        };
        if (args.info === "files") return String(files);
        if (args.info === "folders") return String(folders);
        if (args.info === "size") return String(sizeOf(folder));
        return ["path\t" + folder.path, "files\t" + files, "folders\t" + folders, "size\t" + sizeOf(folder)].join("\n");
      });

      this.registerHandler("file", "Show file info", {
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
      }, (args) => {
        const file = self.tryResolveFile(args);
        return [
          "path\t" + file.path,
          "name\t" + file.basename,
          "extension\t" + file.extension,
          "size\t" + file.stat.size,
          "created\t" + file.stat.ctime,
          "modified\t" + file.stat.mtime,
        ].join("\n");
      });

      this.registerHandler("open", "Open a file", {
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
        newtab: { description: "Open in new tab" },
      }, async (args) => {
        const file = self.tryResolveFile(args, false);
        await workspace.getLeaf(args.newtab && "tab").openFile(file, { active: true });
        return "Opened: " + file.path;
      });

      this.registerHandler("create", "Create a new file", {
        name: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
        content: { value: "<text>", description: "Initial content" },
        template: { value: "<name>", description: "Template to use" },
        overwrite: { description: "Overwrite if file exists" },
        open: { description: "Open file after creating" },
        newtab: { description: "Open in new tab" },
      }, async (args) => {
        if (args.name && args.name.includes("/")) throw 'name cannot contain "/". Use path for a full file path.';
        let fullPath;
        if (args.path && args.name) {
          const dir = args.path.replace(/\/+$/, "");
          fullPath = dir + "/" + args.name;
        } else {
          fullPath = args.path || args.name || "Untitled";
        }
        let ext = "md";
        const dot = fullPath.lastIndexOf(".");
        if (dot > 0) {
          ext = fullPath.slice(dot + 1);
          fullPath = fullPath.slice(0, dot);
        }
        let content = "";
        if (args.template) {
          const templates = internalPlugins.getEnabledPluginById("templates");
          if (!templates) throw "Templates plugin is not enabled.";
          const templateFile = templates.resolveTemplateFile(args.template);
          if (typeof templateFile === "string") throw templateFile;
          content = await vault.cachedRead(templateFile);
          const title = fullPath.split("/").pop() ?? "";
          content = applyTemplateVars(content, { title }, {
            dateFormat: templates.options.dateFormat,
            timeFormat: templates.options.timeFormat,
          });
        } else if (args.content) {
          content = args.content.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
        }
        let file;
        let existed = false;
        if (args.overwrite) {
          const existing = vault.getAbstractFileByPath(normalizePath(fullPath + "." + ext));
          if (existing && existing instanceof s05TFile()) {
            await vault.modify(existing, content);
            file = existing;
            existed = true;
          } else {
            file = await app.fileManager.createNewFile(null, fullPath, ext, content);
          }
        } else {
          file = await app.fileManager.createNewFile(null, fullPath, ext, content);
        }
        if (args.open) {
          await workspace.getLeaf(args.newtab && "tab").openFile(file, { active: true });
        }
        return (existed ? "Overwrote" : "Created") + ": " + file.path;
      });

      this.registerHandler("append", "Append content to a file", {
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
        content: { value: "<text>", description: "Content to append", required: true },
        inline: { description: "Append without newline" },
      }, async (args) => {
        const file = self.tryResolveFile(args);
        if (!args.content) throw "Missing required parameter: content\nUsage: append [file=<name>] [path=<path>] content=<text> [inline]";
        const content = args.content.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
        const inline = args.inline;
        await vault.process(file, (data) => data + (inline ? "" : "\n") + content);
        return "Appended to: " + file.path;
      });

      this.registerHandler("prepend", "Prepend content to a file", {
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
        content: { value: "<text>", description: "Content to prepend", required: true },
        inline: { description: "Prepend without newline" },
      }, async (args) => {
        const file = self.tryResolveFile(args);
        if (!args.content) throw "Missing required parameter: content\nUsage: prepend [file=<name>] [path=<path>] content=<text> [inline]";
        const content = args.content.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
        const inline = args.inline;
        await vault.process(file, (data) => {
          const start = frontmatterBounds(data).contentStart;
          const head = data.substring(0, start);
          const tail = data.substring(start);
          return head + content + (inline ? "" : "\n") + tail;
        });
        return "Prepended to: " + file.path;
      });

      this.registerHandler("move", "Move or rename a file", {
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
        to: { value: "<path>", description: "Destination folder or path", required: true },
      }, async (args) => {
        if (!args.to) throw "Missing required parameter: to\nUsage: move to=<folder> or to=<path>";
        const file = self.tryResolveFile(args);
        const dest = args.to.replace(/^\/+|\/+$/g, "");
        const target = dest.includes(".") ? dest : dest ? dest + "/" + file.name : file.name;
        const oldPath = file.path;
        await app.fileManager.renameFile(file, target);
        return "Moved: " + oldPath + " -> " + target;
      });

      this.registerHandler("rename", "Rename a file", {
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
        name: { value: "<name>", description: "New file name", required: true },
      }, async (args) => {
        if (!args.name) throw "Missing required parameter: name\nUsage: rename name=<new name>";
        const file = self.tryResolveFile(args);
        let name = args.name;
        if (!name.includes(".") && file.extension) name += "." + file.extension;
        const parent = file.parent ? file.parent.path.replace(/^\/+|\/+$/g, "") : "";
        const target = parent ? parent + "/" + name : name;
        const oldPath = file.path;
        await app.fileManager.renameFile(file, target);
        return "Renamed: " + oldPath + " -> " + target;
      });

      this.registerHandler("delete", "Delete a file", {
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
        permanent: { description: "Skip trash, delete permanently" },
      }, async (args) => {
        const file = self.tryResolveFile(args);
        if (args.permanent) {
          await vault.delete(file);
          return "Deleted permanently: " + file.path;
        }
        await vault.trash(file, true);
        return "Moved to trash: " + file.path;
      });

      this.registerHandler("read", "Read file contents", {
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
      }, async (args) => {
        const file = self.tryResolveFile(args);
        return await vault.cachedRead(file);
      });

      this.registerHandler("diff", "List or diff local/sync versions", {
        file: { value: "<name>", description: "File name" },
        path: { value: "<path>", description: "File path" },
        from: { value: "<n>", description: "Version number to diff from" },
        to: { value: "<n>", description: "Version number to diff to" },
        filter: { value: "local|sync", description: "Filter by version source" },
      }, async (args) => {
        const file = self.tryResolveFile(args);
        const localBackups = async () => {
          const plugin = internalPlugins.getEnabledPluginById("file-recovery");
          if (!(plugin && plugin.db)) return [];
          const tx = plugin.db.transaction("backups", "readonly");
          const items = await tx.store.index("path").getAll(file.path);
          items.sort((a, b) => b.ts - a.ts);
          return items;
        };
        const syncVersions = async () => {
          const plugin = internalPlugins.getEnabledPluginById("sync");
          if (!plugin || !plugin.getRemoteVaultId()) return [];
          try {
            return (await plugin.getHistory(file.path, null)).items;
          } catch (e) {
            return [];
          }
        };
        const allVersions = async () => {
          const local = await localBackups();
          const sync = await syncVersions();
          const merged = [];
          for (const item of local) {
            merged.push({
              source: "Local",
              sourceIndex: local.indexOf(item),
              ts: item.ts,
              size: (item.data && item.data.length) || 0,
              data: item.data,
            });
          }
          for (const item of sync) {
            merged.push({
              source: "Sync",
              sourceIndex: sync.indexOf(item),
              ts: item.ts,
              size: item.size || 0,
              device: item.device,
              uid: item.uid,
            });
          }
          merged.sort((a, b) => b.ts - a.ts);
          return merged;
        };
        const hasFrom = args.from !== undefined;
        const hasTo = args.to !== undefined;
        const filter = args.filter && args.filter.toLowerCase();
        const applyFilter = (versions) => {
          if (filter === "local") return versions.filter((v) => v.source === "Local");
          if (filter === "sync") return versions.filter((v) => v.source === "Sync");
          return versions;
        };
        const getVersion = async (versions, index) => {
          if (index < 1 || index > versions.length) throw "Invalid version " + index + ". Available: 1-" + versions.length;
          const version = versions[index - 1];
          const stamp = window.moment(version.ts).format("YYYY-MM-DD HH:mm:ss");
          const label = file.path + " (" + version.source + " #" + index + ", " + stamp + ")";
          if (version.source === "Local") return { text: version.data || "", label };
          const sync = internalPlugins.getEnabledPluginById("sync");
          if (!sync) throw "Sync is not enabled.";
          try {
            return { text: utf8String(await sync.getContentForVersion(version.uid)), label };
          } catch (e) {
            throw "Failed to fetch sync version: " + (e.message || e);
          }
        };
        if (!hasFrom && !hasTo) {
          const versions = applyFilter(await allVersions());
          if (versions.length === 0) return "No version history found for " + file.path;
          const lines = [file.path];
          for (let i = 0; i < versions.length; i++) {
            const v = versions[i];
            const num = String(i + 1).padEnd(4);
            const src = v.source.padEnd(6);
            const stamp = window.moment(v.ts).format("YYYY-MM-DD HH:mm:ss");
            const size = (v.size || 0) + " B";
            const device = v.device ? "[" + v.device + "]" : "";
            lines.push(num + src + stamp + "  " + size.padStart(10) + "  " + device);
          }
          return lines.join("\n");
        }
        const versions = applyFilter(await allVersions());
        if (versions.length === 0) return "No version history found for " + file.path;
        let oldText, oldLabel, newText, newLabel;
        if (hasFrom) {
          const from = await getVersion(versions, parseInt(args.from));
          oldText = from.text;
          oldLabel = from.label;
        } else {
          const from = await getVersion(versions, 1);
          oldText = from.text;
          oldLabel = from.label;
        }
        if (hasTo) {
          const to = await getVersion(versions, parseInt(args.to));
          newText = to.text;
          newLabel = to.label;
        } else {
          newText = await vault.cachedRead(file);
          newLabel = file.path + " (current)";
        }
        return self.formatDiff(oldText, newText, oldLabel, newLabel);
      });

      this.registerHandler("plugin:enable", "Enable a plugin", {
        id: { value: "<id>", description: "Plugin ID", required: true },
        filter: { value: "core|community", description: "Plugin type" },
      }, async (args) => {
        const id = args.id;
        if (!id) throw "Missing required parameter: id\nUsage: plugin:enable id=<plugin-id> [filter=core|community]";
        let type = args.filter;
        const core = internalPlugins.getPluginById(id);
        const manifest = communityPlugins.manifests[id];
        if (!type) type = core ? "core" : manifest ? "community" : null;
        if (type === "core") {
          if (!core) throw 'Core plugin "' + id + '" not found. Use "plugins filter=core" to list available plugins.';
          if (core.enabled) throw 'Plugin "' + id + '" is already enabled.';
          await core.enable(true);
          return "Enabled: " + id;
        }
        if (type === "community") {
          if (!manifest) throw 'Community plugin "' + id + '" not found. Use "plugins filter=community" to list installed plugins.';
          if (communityPlugins.enabledPlugins.has(id)) throw 'Plugin "' + id + '" is already enabled.';
          if (await communityPlugins.enablePluginAndSave(id)) return "Enabled: " + id;
          throw "Failed to enable: " + id;
        }
        throw 'Plugin "' + id + '" not found. Use "plugins" to list available plugins.';
      });

      this.registerHandler("plugin:disable", "Disable a plugin", {
        id: { value: "<id>", description: "Plugin ID", required: true },
        filter: { value: "core|community", description: "Plugin type" },
      }, async (args) => {
        const id = args.id;
        if (!id) throw "Missing required parameter: id\nUsage: plugin:disable id=<plugin-id> [filter=core|community]";
        let type = args.filter;
        const core = internalPlugins.getPluginById(id);
        const manifest = communityPlugins.manifests[id];
        if (!type) type = core ? "core" : manifest ? "community" : null;
        if (type === "core") {
          if (!core) throw 'Core plugin "' + id + '" not found. Use "plugins filter=core" to list available plugins.';
          if (!core.enabled) throw 'Plugin "' + id + '" is already disabled.';
          core.disable(true);
          return "Disabled: " + id;
        }
        if (type === "community") {
          if (!manifest) throw 'Community plugin "' + id + '" not found. Use "plugins filter=community" to list installed plugins.';
          if (!communityPlugins.enabledPlugins.has(id)) throw 'Plugin "' + id + '" is already disabled.';
          await communityPlugins.disablePluginAndSave(id);
          return "Disabled: " + id;
        }
        throw 'Plugin "' + id + '" not found. Use "plugins" to list available plugins.';
      });

      this.registerHandler("plugin:reload", "Reload a plugin (for developers)", {
        id: { value: "<id>", description: "Plugin ID", required: true },
      }, async (args) => {
        const id = args.id;
        if (!id) throw "Missing required parameter: id\nUsage: plugin:reload id=<plugin-id>";
        const core = internalPlugins.getPluginById(id);
        const manifest = communityPlugins.manifests[id];
        if (core) {
          if (!core.enabled) throw 'Plugin "' + id + '" is not enabled.';
          core.disable(false);
          await core.enable(false);
          return "Reloaded: " + id;
        }
        if (manifest) {
          if (!communityPlugins.enabledPlugins.has(id)) throw 'Plugin "' + id + '" is not enabled.';
          await communityPlugins.disablePlugin(id);
          await communityPlugins.loadManifests();
          if (await communityPlugins.enablePlugin(id)) return "Reloaded: " + id;
          throw "Failed to reload: " + id;
        }
        throw 'Plugin "' + id + '" not found. Use "plugins" to list available plugins.';
      });

      this.registerHandler("plugin:install", "Install a community plugin", {
        id: { value: "<id>", description: "Plugin ID", required: true },
        enable: { description: "Enable after install" },
      }, async (args) => {
        const id = args.id;
        if (!id) throw "Missing required parameter: id\nUsage: plugin:install id=<plugin-id>";
        if (communityPlugins.manifests[id]) throw 'Plugin "' + id + '" is already installed.';
        const list = await s05CommunityPlugins();
        const entry = list.find((p) => p.id === id);
        if (!entry) throw 'Plugin "' + id + '" not found in community plugins.';
        let manifest;
        try {
          manifest = await request(rawFileUrl(entry.repo, "manifest.json")).json;
          if (!manifest.id || manifest.id !== id) throw "Plugin ID mismatch.";
        } catch (e) {
          throw "Failed to load plugin manifest.";
        }
        const version = await pickCompatibleVersion(entry.repo, manifest);
        if (!version) throw "No compatible version found for current Basalt version.";
        try {
          await communityPlugins.installPlugin(entry.repo, version, manifest);
          if (args.enable) {
            await communityPlugins.enablePluginAndSave(id);
            return "Installed and enabled: " + id + " v" + version;
          }
          return "Installed: " + id + " v" + version;
        } catch (e) {
          throw "Failed to install plugin: " + (e.message || e);
        }
      });

      this.registerHandler("plugin:uninstall", "Uninstall a community plugin", {
        id: { value: "<id>", description: "Plugin ID", required: true },
      }, async (args) => {
        const id = args.id;
        if (!id) throw "Missing required parameter: id\nUsage: plugin:uninstall id=<plugin-id>";
        if (!communityPlugins.manifests[id]) throw 'Plugin "' + id + '" is not installed.';
        try {
          await communityPlugins.uninstallPlugin(id);
          return "Uninstalled: " + id;
        } catch (e) {
          throw "Failed to uninstall plugin: " + (e.message || e);
        }
      });

      this.registerHandler("snippet:enable", "Enable a CSS snippet", {
        name: { value: "<name>", description: "Snippet name", required: true },
      }, (args) => {
        const name = args.name;
        if (!name) throw "Missing required parameter: name\nUsage: snippet:enable name=<snippet-name>";
        if (!customCss.snippets.includes(name)) throw 'Snippet "' + name + '" not found. Use "snippets" to list installed snippets.';
        if (customCss.enabledSnippets.has(name)) return 'Snippet "' + name + '" is already enabled.';
        customCss.setCssEnabledStatus(name, true);
        return "Enabled: " + name;
      });

      this.registerHandler("snippet:disable", "Disable a CSS snippet", {
        name: { value: "<name>", description: "Snippet name", required: true },
      }, (args) => {
        const name = args.name;
        if (!name) throw "Missing required parameter: name\nUsage: snippet:disable name=<snippet-name>";
        if (!customCss.snippets.includes(name)) throw 'Snippet "' + name + '" not found. Use "snippets" to list installed snippets.';
        if (customCss.enabledSnippets.has(name)) {
          customCss.setCssEnabledStatus(name, false);
          return "Disabled: " + name;
        }
        return 'Snippet "' + name + '" is already disabled.';
      });

      this.registerHandler("theme:set", "Set active theme", {
        name: { value: "<name>", description: "Theme name (empty for default)", required: true },
      }, (args) => {
        const name = args.name;
        if (name === undefined) throw "Missing required parameter: name\nUsage: theme:set name=<theme-name>\nUse empty string for default: theme:set name=";
        if (name !== "" && !customCss.themes[name] && !customCss.oldThemes.includes(name)) {
          throw 'Theme "' + name + '" not found. Use "themes" to list installed themes.';
        }
        customCss.setTheme(name);
        return name === "" ? "Switched to default theme" : "Switched to: " + name;
      });

      this.registerHandler("theme:install", "Install a community theme", {
        name: { value: "<name>", description: "Theme name", required: true },
        enable: { description: "Activate after install" },
      }, async (args) => {
        const name = args.name;
        if (!name) throw "Missing required parameter: name\nUsage: theme:install name=<theme-name>";
        if (customCss.themes[name] || customCss.oldThemes.includes(name)) throw 'Theme "' + name + '" is already installed.';
        const themes = await env_().Pb();
        const entry = themes.find((t) => t.name === name);
        if (!entry) throw 'Theme "' + name + '" not found in community themes.';
        const manifest = await customCss.getManifest(entry.repo);
        let minVersion = null;
        if (manifest) minVersion = await pickCompatibleVersion(entry.repo, manifest);
        try {
          await customCss.installTheme(entry, minVersion);
          if (args.enable) {
            customCss.setTheme(name);
            if (minVersion) return "Installed and activated: " + name + " v" + minVersion;
            return "Installed and activated: " + name;
          }
          if (minVersion) return "Installed: " + name + " v" + minVersion;
          return "Installed: " + name;
        } catch (e) {
          throw "Failed to install theme: " + (e.message || e);
        }
      });

      this.registerHandler("theme:uninstall", "Uninstall a theme", {
        name: { value: "<name>", description: "Theme name", required: true },
      }, async (args) => {
        const name = args.name;
        if (!name) throw "Missing required parameter: name\nUsage: theme:uninstall name=<theme-name>";
        if (!customCss.themes[name] && !customCss.oldThemes.includes(name)) throw 'Theme "' + name + '" is not installed.';
        await customCss.removeTheme(name);
        return "Uninstalled: " + name;
      });
    }
  };
}
