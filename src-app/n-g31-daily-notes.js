// g31 clean-room: daily-notes default format, folder-relative path helper and
// the moment-format validator (spec g31 part C).
import { env } from "./env.js";
import { lastSegment } from "./path.js";

export const ng31DefaultDateFormat = "YYYY-MM-DD";

// Path of `file` relative to `folder`'s parent prefix, or null when the file
// is outside it. Pure string prefix check, no normalization.
export function ng31DailyNoteRelPath(folder, file) {
  const prefix = folder.getParentPrefix();
  return file.path.startsWith(prefix) ? file.path.slice(prefix.length) : null;
}

// "" when valid, else a localized error. Rejection order is contractual:
// leading slash first, then forbidden characters in the formatted sample,
// then strict moment re-parse.
export function ng31ValidateDateFormat(format) {
  if (!format) return "";
  const invalidFormat = () => env().gm.plugins.dailyNotes.msgInvalidDateFormat();
  if (format.startsWith("/")) return invalidFormat();
  const sample = window.moment().format(format);
  if (env().UT.test(lastSegment(sample))) {
    return env().gm.plugins.fileExplorer.msgInvalidCharacters() + env().qT;
  }
  return window.moment(sample, format, true).isValid() ? "" : invalidFormat();
}

