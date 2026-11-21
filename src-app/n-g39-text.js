// g39 clean-room: pure string/number helpers (spec g39 part A), file 1 of 3.
// No state, no I/O, no DOM; every export is a small pure function.

const NG39_BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function ng39FormatBytes(bytes) {
  if (!(bytes > 0)) return "0 B";
  let i = 0;
  while (i < NG39_BYTE_UNITS.length - 1 && bytes >= Math.pow(1024, i + 1)) i++;
  const scaled = bytes / Math.pow(1024, i);
  const decimals = i === 0 ? 0 : 2;
  const intPart = parseInt(scaled.toFixed(decimals), 10);
  const fracRaw = (Math.abs(scaled) - Math.floor(Math.abs(scaled))).toFixed(decimals);
  const frac = fracRaw.indexOf(".") >= 0 ? fracRaw.slice(fracRaw.indexOf(".") + 1) : "";
  const grouped = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return grouped + (frac ? "." + frac : "") + " " + NG39_BYTE_UNITS[i];
}

export function ng39ToKebab(name) {
  return String(name).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()).replace(/_(?=\d)/g, "-");
}

export function ng39Ellipsize(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trim() + "…";
}

export function ng39EndWithBlankLine(text) {
  if (!text.endsWith("\n")) return text + "\n\n";
  if (!text.endsWith("\n\n")) return text + "\n";
  return text;
}

export function ng39SqueezeNewlines(text) {
  if (!text) return "";
  return text.replace(/\n\s*/g, "\n");
}

export function ng39EscapeTablePipes(text) {
  return text.replace(/\|/g, "\\|");
}

export function ng39WithHash(tag) {
  return String(tag).charAt(0) === "#" ? tag : "#" + tag;
}

export function ng39IsShortLine(text) {
  if (!text.trim()) return false;
  if (text.indexOf("\n") >= 0) return false;
  if (text.length > 100 && text.indexOf(" ") >= 0) return false;
  return true;
}

export function ng39ToStringList(value) {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) {
    const out = [];
    for (const v of value) if (v !== null && v !== undefined) out.push(String(v));
    return out.length ? out : null;
  }
  if (typeof value === "string" || value instanceof String) return [value];
  return [String(value)];
}

export function ng39EmptyToNull(value) {
  if (value === "" || (Array.isArray(value) && value.length === 0)) return null;
  return value;
}

export function ng39ParseCommaList(text) {
  return String(text).replace(/"/g, "").split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

export function ng39FormatCommaList(items) {
  return items.map((s) => (s.indexOf(" ") >= 0 ? '"' + s + '"' : s)).join(", ");
}

export function ng39CountQuoteMarks(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charAt(i) === ">") n++;
  return n;
}
