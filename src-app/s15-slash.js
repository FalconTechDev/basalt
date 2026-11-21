// g32 clean-room: implementation lives in n-g32-slash-*.js; this path is kept
// for tests/tools that import the historical module name.
import { ng32DefineSlashCommandPlugin } from "./n-g32-slash-plugin.js";
import { ng32DefineSlashCommandSuggest, ng32SlashCommandPattern } from "./n-g32-slash-suggest.js";
const defineSlashCommandPlugin = ng32DefineSlashCommandPlugin;
const defineSlashCommandSuggest = ng32DefineSlashCommandSuggest;
const s15SlashCommandPattern = ng32SlashCommandPattern;
export { defineSlashCommandPlugin, defineSlashCommandSuggest, s15SlashCommandPattern };
