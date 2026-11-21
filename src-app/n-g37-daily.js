// g37 — daily notes helpers (clean-room). s33DailyNoteSuffix / s33ValidateDateFormat.
import { env } from "./env.js";
import { ng20DailyNotesStrings, ng20FileExplorerStrings } from "./n-g20-shared.js";

/** Path of `file` relative to the daily-notes folder `folder`; null when outside. */
export function ng37DailyNoteSuffix(folder, file) {
  const prefix = folder.getParentPrefix();
  return file.path.startsWith(prefix) ? file.path.slice(prefix.length) : null;
}

/** "" when the moment format is usable for a file name, otherwise the i18n error message. */
export function ng37ValidateDateFormat(format, host) {
  if (!format) return "";
  const h = host || {};
  const pattern = h.invalidCharsPattern instanceof RegExp ? h.invalidCharsPattern : env().UT;
  const list = h.invalidCharsList !== undefined ? h.invalidCharsList : env().qT;
  try {
    if (format.startsWith("/")) return ng20DailyNotesStrings().msgInvalidDateFormat();
    const sample = window.moment().format(format);
    const last = sample.split("/").pop();
    if (pattern instanceof RegExp && pattern.test(last)) {
      return ng20FileExplorerStrings().msgInvalidCharacters() + (list || "");
    }
    if (!window.moment(sample, format, true).isValid()) return ng20DailyNotesStrings().msgInvalidDateFormat();
    return "";
  } catch (err) {
    return ng20DailyNotesStrings().msgInvalidDateFormat();
  }
}
