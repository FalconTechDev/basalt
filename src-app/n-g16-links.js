import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { ng16HasMetadataEditor, ng16ActivePropertiesEditor, ng16TagSuggestions, ng16PathSuggestion } from "./n-g16-shared.js";

export function ng16RenderLinkValue(value, el, ctx, hoverParent, host) {
  if (value == null) return false;
  const text = String(value); let href = null, title = text, internal = false, alias = "";
  const wiki = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(text);
  if (wiki) { href = wiki[1].trim(); title = wiki[2] || href; internal = true; }
  else { const md = /^\[([^\]]*)\]\((<[^>]+>|[^)]+)\)$/.exec(text); if (md) { href = md[2].replace(/^<|>$/g, ""); title = md[1] || href; internal = !/^[a-z][a-z0-9+.-]*:/i.test(href); } else if (env().Qc && env().Qc(text)) { href = text; title = text; internal = false; } else if (env().Zc && env().Zc(text)) { href = "mailto:" + text; title = text; internal = false; } }
  if (!href) return false;
  el.empty(); el.addClass(internal ? "internal-link" : "external-link"); el.dataset.href = href; el.setText(title); if (internal && ctx.app.metadataCache.getFirstLinkpathDest && !ctx.app.metadataCache.getFirstLinkpathDest(href, ctx.sourcePath)) el.addClass("is-unresolved");
  el.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); const ws = ctx.app.workspace; if (internal) ws.openLinkText(href, ctx.sourcePath, host.Keymap.isModEvent(e)); else window.open(href, "_blank"); });
  el.addEventListener("contextmenu", (e) => { e.preventDefault(); const m = new host.Menu(); m.addItem((i) => i.setTitle(internal ? "Open link" : "Open in browser").onClick(() => el.click())); m.showAtMouseEvent(e); });
  return true;
}
export function ng16DefineValueLinkSuggest(host) { return function (ctx, inputEl, onSelectLink) { const s = new host.AbstractInputSuggest(ctx.app, inputEl); s.suggestEl.addClass("mod-property-value"); s.suggestEl.dataset.propertyKey = (ctx.key || "").toLowerCase(); s.getSuggestions = (q) => { if (q.includes("[[")) return []; const vals = ctx.app.metadataCache.getFrontmatterPropertyValuesForKey ? ctx.app.metadataCache.getFrontmatterPropertyValuesForKey(ctx.key) : []; return vals.filter((v) => !q || String(v).toLowerCase().includes(q.toLowerCase())).map((v) => ({ value: v })); }; s.renderSuggestion = (v, el) => el.setText(v.value); s.selectSuggestion = (v) => { if (v && v.value != null) onSelectLink && onSelectLink(v.value); s.close(); }; return s; }; }
export function ng16DefineWikilinkSuggest(host) { return function (app) { const s = new host.EditorSuggest(app); s.onTrigger = () => null; s.getSuggestions = () => []; s.renderSuggestion = () => {}; s.selectSuggestion = () => {}; return s; }; }
export function ng16DefineTagTriggerSuggest(host) { return function (app) { const s = new host.EditorSuggest(app); s.onTrigger = () => null; s.getSuggestions = () => []; s.renderSuggestion = () => {}; s.selectSuggestion = () => {}; return s; }; }
export function ng16DefineValueBase(host) { return function () {}; }
export function ng16DefineTextValue(host) { return ng16DefineValueBase(host); }
export function ng16DefineDateBase(host) { return ng16DefineValueBase(host); }
export function ng16DefineDateValue(host) { return ng16DefineDateBase(host); }
export function ng16DefineDateTimeValue(host) { return ng16DefineDateBase(host); }
export function ng16DefineFileValue(host) { return ng16DefineValueBase(host); }
export function ng16DefineFolderValue(host) { return ng16DefineValueBase(host); }
export function ng16DefineCheckboxValue(host) { return ng16DefineValueBase(host); }
export function ng16DefineNumberValue(host) { return ng16DefineValueBase(host); }
export function ng16DefineUnknownValue(host) { return ng16DefineValueBase(host); }
export function ng16DefineMultitextValue(host) { return ng16DefineValueBase(host); }
export function ng16DefineTagsValue(host) { return ng16DefineValueBase(host); }
export function ng16DefineAliasesValue(host) { return ng16DefineValueBase(host); }
export function ng16DefinePropertyCombo(host) { return ng16DefineValueBase(host); }
export function ng16DefinePropertyValue(host) { return ng16DefineValueBase(host); }
export function ng16DefineTagValueSuggest(host) { return function (app, inputEl) { return new host.AbstractInputSuggest(app, inputEl); }; }
export function ng16DefineTypeChangeModal(host) { return function () {}; }
export function ng16DefineMultiSelect(host) { return function () {}; }
export const ng16TagTriggerRe = /(^|\s)#[^ -⁯⸀-⹿'!"#$%&()*+,.:;<=>?@^`{|}~\[\]\\s]*$/g;
export function ng16WidgetDesc(host, type, icon, nameKey) { return { name: () => host.t.properties.types[nameKey] || type, type, icon, validate: () => true, render: () => ({ focus() {}, setValue() {} }) }; }
export function ng16WidgetText(host) { return ng16WidgetDesc(host, "text", "lucide-text", "optionText"); }
export function ng16WidgetProperty(host) { return ng16WidgetDesc(host, "property", "lucide-info", "optionPropertyName"); }
export function ng16WidgetAliases(host) { return ng16WidgetDesc(host, "aliases", "lucide-forward", "optionAliases"); }
export function ng16WidgetTags(host) { return ng16WidgetDesc(host, "tags", "lucide-tags", "optionTags"); }
export function ng16WidgetFolder(host) { return ng16WidgetDesc(host, "folder", "lucide-folder", "optionFolder"); }
export function ng16WidgetFile(host) { return ng16WidgetDesc(host, "file", "lucide-file", "optionFile"); }
export function ng16WidgetDate(host) { return ng16WidgetDesc(host, "date", "lucide-calendar", "optionDate"); }
export function ng16WidgetDatetime(host) { return ng16WidgetDesc(host, "datetime", "lucide-clock", "optionDatetime"); }
export function ng16WidgetNumber(host) { return ng16WidgetDesc(host, "number", "lucide-binary", "optionNumber"); }
export function ng16WidgetCheckbox(host) { return ng16WidgetDesc(host, "checkbox", "lucide-check-square", "optionCheckbox"); }
export function ng16WidgetMultitext(host) { return ng16WidgetDesc(host, "multitext", "lucide-list", "optionMultitext"); }
export function ng16WidgetUnknown(host) { return ng16WidgetDesc(host, "unknown", "lucide-file-question", "optionUnknown"); }







