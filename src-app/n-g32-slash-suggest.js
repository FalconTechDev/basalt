// g32 clean-room: "/" editor suggest over command-palette commands.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { prepareFuzzyFinder, renderResults } from "./search-simple.js";
import { sortHitsByScore } from "./misc.js";

export const ng32SlashCommandPattern = /(^|\s)\/([^\s\/]*)$/;

let ng32SlashSuggestClass = null;

export function ng32DefineSlashCommandSuggest() {
  if (ng32SlashSuggestClass) return ng32SlashSuggestClass;
  const Base = env().NI;

  function Ng32SlashCommandSuggest(app) {
    const self = Base.call(this, app) || this;
    self.app = app;
    return self;
  }
  inherit(Ng32SlashCommandSuggest, Base);
  const proto = Ng32SlashCommandSuggest.prototype;

  proto.onTrigger = function (cursor, editor, file) {
    if (!file) return null;
    const line = (editor.getLine(cursor.line) || "").slice(0, cursor.ch);
    const match = ng32SlashCommandPattern.exec(line);
    if (!match) return null;
    return {
      start: { line: cursor.line, ch: match.index + match[1].length },
      end: { line: cursor.line, ch: cursor.ch },
      query: match[2],
    };
  };

  proto.getSuggestions = function (context) {
    const palette = this.app.internalPlugins.getPluginById("command-palette").instance;
    const finder = prepareFuzzyFinder(context.query || "");
    const hits = [];
    for (const command of palette.getCommands()) {
      const match = finder(command.name);
      if (match) hits.push({ match, item: command });
    }
    sortHitsByScore(hits);
    return hits;
  };

  proto.renderSuggestion = function (suggestion, el) {
    const command = suggestion.item;
    const match = suggestion.match;
    el.addClass("mod-complex");
    const content = el.createSpan({ cls: "suggestion-content" });
    const title = content.createSpan({ cls: "suggestion-title" });
    const name = command.name || "";
    const sep = name.indexOf(": ");
    if (sep >= 0) {
      renderResults(title.createSpan({ cls: "suggestion-prefix" }), name.slice(0, sep), match, 0);
      renderResults(title.createSpan(), name.slice(sep + 2), match, -(sep + 2));
    } else {
      renderResults(title, name, match, 0);
    }
    const aux = el.createSpan({ cls: "suggestion-aux" });
    const manager = this.app.hotkeyManager;
    const hotkeys = manager.getHotkeys(command.id) || manager.getDefaultHotkeys(command.id) || [];
    for (const hotkey of hotkeys) aux.createEl("kbd", { cls: "suggestion-hotkey", text: env().Rb(hotkey) });
    const palette = this.app.internalPlugins.getPluginById("command-palette").instance;
    const pinned = palette.options && palette.options.pinned;
    if (pinned && pinned.contains(command.id)) {
      env().tv(aux.createSpan({ cls: "suggestion-flair" }), "lucide-pin");
    }
  };

  proto.selectSuggestion = function (suggestion) {
    this.close();
    if (this.context) this.context.editor.replaceRange("", this.context.start, this.context.end);
    env().K6(suggestion.item);
  };

  ng32SlashSuggestClass = Ng32SlashCommandSuggest;
  return ng32SlashSuggestClass;
}
