// g32 clean-room: slash-command core plugin shell.
import { env } from "./env.js";
import { ng32DefineSlashCommandSuggest } from "./n-g32-slash-suggest.js";

let ng32SlashPluginClass = null;

export function ng32DefineSlashCommandPlugin(host) {
  if (ng32SlashPluginClass) return ng32SlashPluginClass;

  function Ng32SlashCommandPlugin() {
    this.id = "slash-command";
    this.name = env().gm.plugins.slashCommand.name();
    this.description = env().gm.plugins.slashCommand.desc();
    this.defaultOn = false;
    this.app = null;
    this.suggest = null;
  }

  Ng32SlashCommandPlugin.prototype.init = function (app) {
    this.app = app;
    this.suggest = new (ng32DefineSlashCommandSuggest(host))(app);
  };

  Ng32SlashCommandPlugin.prototype.onEnable = function (app) {
    app.workspace.editorSuggest.addSuggest(this.suggest);
  };

  Ng32SlashCommandPlugin.prototype.onDisable = function (app) {
    app.workspace.editorSuggest.removeSuggest(this.suggest);
  };

  ng32SlashPluginClass = Ng32SlashCommandPlugin;
  return Ng32SlashCommandPlugin;
}
