// Compatibility entry for tests/tools that import the unique-note module path.
// g33: implementation lives in n-g33-uniquenote.js + n-g33-uniquenote-tab.js.
import { defineUniqueNotePlugin } from "./n-g33-uniquenote.js";
import { defineUniqueNoteSettingsTab } from "./n-g33-uniquenote-tab.js";
export { defineUniqueNotePlugin, defineUniqueNoteSettingsTab };
