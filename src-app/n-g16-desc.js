// g16 clean-room: the twelve property-type widget descriptors. Together they form
// host.propertyTypeWidgets (eleven) plus host.unknownPropertyWidget (the fallback).
import { ng16PropT, ng16DateRe, ng16DateTimeRe } from "./n-g16-shared.js";
import { ng16DefineS06ValueItem, ng16DefineS06UnknownValue, ng16DefineS06CheckboxValue, ng16DefineS06NumberValue } from "./n-g16-widgets.js";
import { ng16DefineS06FileValue, ng16DefineS06FolderValue, ng16DefineS06DateValue, ng16DefineS06DateTimeValue } from "./n-g16-widgets2.js";
import { ng16DefineS06TextValue } from "./n-g16-text.js";
import { ng16DefineS06MultiSelect, ng16DefineS06TagsValue, ng16DefineS06AliasesValue, ng16DefineS06MultiTextValue } from "./n-g16-multi.js";
import { ng16DefineS06PropertyKeyValue, ng16DefineS06TypeCombobox } from "./n-g16-combo.js";

function ng16Desc(host, type, icon, nameKey, reserved, validate, widgetFn) {
  const types = () => (host.t.properties && host.t.properties.types) || {};
  const d = {
    name: () => { const f = types()[nameKey]; return f ? f() : type; },
    type, icon,
    validate: validate || (() => true),
    render: (el, v, ctx) => widgetFn(host)(ctx, el, v),
  };
  if (reserved) d.reservedKeys = reserved;
  return d;
}
const isStr = (v) => typeof v === "string";
const isStrOrArr = (v) => isStr(v) || (Array.isArray(v) && v.every((x) => typeof x === "string"));
const isNum = (v) => typeof v === "number";
const isBool = (v) => typeof v === "boolean";

export function ng16S06TextDesc(host) { return ng16Desc(host, "text", "lucide-text", "optionText", null, isStr, ng16DefineS06TextValue); }
export function ng16S06PropertyDesc(host) { return ng16Desc(host, "property", "lucide-info", "optionPropertyName", [], isStr, ng16DefineS06PropertyKeyValue); }
export function ng16S06AliasesDesc(host) { return ng16Desc(host, "aliases", "lucide-forward", "optionAliases", ["aliases"], isStrOrArr, ng16DefineS06AliasesValue); }
export function ng16S06TagsDesc(host) { return ng16Desc(host, "tags", "lucide-tags", "optionTags", ["tags"], isStrOrArr, ng16DefineS06TagsValue); }
export function ng16S06FolderDesc(host) { return ng16Desc(host, "folder", "lucide-folder", "optionFolder", [], isStr, ng16DefineS06FolderValue); }
export function ng16S06FileDesc(host) { return ng16Desc(host, "file", "lucide-file", "optionFile", [], isStr, ng16DefineS06FileValue); }
export function ng16S06DateDesc(host) { return ng16Desc(host, "date", "lucide-calendar", "optionDate", null, (v) => !v || ng16DateRe.test(v), ng16DefineS06DateValue); }
export function ng16S06DateTimeDesc(host) { return ng16Desc(host, "datetime", "lucide-clock", "optionDatetime", null, (v) => !v || ng16DateTimeRe.test(v), ng16DefineS06DateTimeValue); }
export function ng16S06NumberDesc(host) { return ng16Desc(host, "number", "lucide-binary", "optionNumber", null, isNum, ng16DefineS06NumberValue); }
export function ng16S06CheckboxDesc(host) { return ng16Desc(host, "checkbox", "lucide-check-square", "optionCheckbox", null, isBool, ng16DefineS06CheckboxValue); }
export function ng16S06MultitextDesc(host) { return ng16Desc(host, "multitext", "lucide-list", "optionMultitext", null, isStrOrArr, ng16DefineS06MultiTextValue); }
export function ng16S06UnknownDesc(host) { return ng16Desc(host, "unknown", "lucide-file-question", "optionUnknown", null, () => true, ng16DefineS06UnknownValue); }

// manifest export names -> descriptor factories
export { ng16S06TextDesc as s06PropertyOptionText, ng16S06PropertyDesc as s06PropertyOptionPropertyName, ng16S06AliasesDesc as s06PropertyOptionAliases, ng16S06TagsDesc as s06PropertyOptionTags, ng16S06FolderDesc as s06PropertyOptionFolder, ng16S06FileDesc as s06PropertyOptionFile, ng16S06DateDesc as s06PropertyOptionDate, ng16S06DateTimeDesc as s06PropertyOptionDatetime, ng16S06NumberDesc as s06PropertyOptionNumber, ng16S06CheckboxDesc as s06PropertyOptionCheckbox, ng16S06MultitextDesc as s06PropertyOptionMultitext, ng16S06UnknownDesc as s06PropertyOptionUnknownDescriptor };

// manifest class export aliases (the widget constructors live in the widget files)
export { ng16DefineS06ValueItem as s06PropClassValueItem };
