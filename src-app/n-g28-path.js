// g28 path helpers: pure string functions for vault paths and link texts.
// Clean-room implementation of spec g28 Part A. No state, no DOM, no host.

function ng28LastSlash(s) { return s.lastIndexOf("/"); }

/** Index of the extension dot in the WHOLE string (last dot, not first/last char), or -1. */
function ng28ExtDot(s) {
  const i = s.lastIndexOf(".");
  return i > 0 && i < s.length - 1 ? i : -1;
}

export function lastSegment(path) {
  const i = ng28LastSlash(path);
  return i < 0 ? path : path.slice(i + 1);
}

export function parentPath(path) {
  const i = ng28LastSlash(path);
  return i < 0 ? "" : path.slice(0, i);
}

export function isHiddenPath(path) {
  const parts = path.split("/");
  for (const p of parts) if (p.startsWith(".")) return true;
  return false;
}

export function baseName(path) {
  const seg = lastSegment(path);
  const i = ng28ExtDot(seg);
  return i < 0 ? seg : seg.slice(0, i);
}

export function withoutExtension(path) {
  const i = ng28ExtDot(path);
  return i < 0 ? path : path.slice(0, i);
}

export function extensionOf(path) {
  const i = ng28ExtDot(path);
  return i < 0 ? "" : path.slice(i + 1).toLowerCase();
}

export function joinNameExt(name, ext) {
  return ext ? name + "." + ext : name;
}

export function collapseSlashes(path) {
  const collapsed = path.replace(/[\\/]+/g, "/").replace(/^\/+|\/+$/g, "");
  return collapsed || "/";
}

export function plainSpaces(text) {
  return text.replace(/[\u00A0\u202F]/g, " ");
}

export function normalizePath(path) {
  return plainSpaces(collapseSlashes(path)).normalize("NFC");
}

function ng28IsNotePath(path) {
  return extensionOf(lastSegment(path)) === "md";
}

export function displayName(path) {
  const seg = lastSegment(path);
  return ng28IsNotePath(path) ? seg.slice(0, seg.length - 3) : seg;
}

export function withoutMd(path) {
  return ng28IsNotePath(path) ? path.slice(0, path.length - 3) : path;
}

export function dropMdSuffix(path) {
  return withoutMd(path);
}

export function fileLinkPath(file) {
  return file.extension === "md" ? withoutExtension(file.path) : file.path;
}

export function targetText(item) {
  if (item.type === "file" || item.type === "alias") return withoutMd(item.file.path);
  if (item.type === "unresolved") return item.linktext;
  if (item.type === "bookmark") return item.bookmarkPath;
  return "";
}

const NG28_PLUGIN_FILES = new Set(["manifest.json", "main.js", "styles.css", "data.json"]);

export function isPluginFileName(name) {
  return NG28_PLUGIN_FILES.has(name);
}

export function pathWith(file, suffix) {
  return file.path + suffix;
}

export function linkPath(link) {
  const i = link.indexOf("#");
  return i < 0 ? link : link.slice(0, i);
}

export function parseLinktext(link) {
  const i = link.indexOf("#");
  return i < 0 ? { path: link, subpath: "" } : { path: link.slice(0, i), subpath: link.slice(i) };
}

export function subpathKind(subpath) {
  if (!subpath) return null;
  if (subpath.startsWith("#[^")) return "footnote";
  if (subpath.startsWith("#^")) return "block";
  return "heading";
}

export function isLocalLink(href) {
  if (href.startsWith("./") || href.startsWith("../")) return true;
  return href.indexOf(":") < 0;
}

export function linkDestination(body) {
  const text = body.trim();
  if (text.startsWith("<")) {
    const close = text.indexOf(">", 1);
    if (close >= 0) return text.slice(1, close);
  }
  const ws = text.search(/\s/);
  return ws < 0 ? text : text.slice(0, ws);
}

export function safeDecodeUri(text) {
  try {
    return decodeURI(text);
  } catch (e) {
    return text;
  }
}

const NG28_LINK_CHAR = /[\\ \u0000\u0008\u000B\u000C\u000E-\u001F]/g;

export function escapeLinkChars(text) {
  return text.replace(NG28_LINK_CHAR, (ch) => encodeURIComponent(ch));
}

export function firstHeadingText(text) {
  const m = /^#{1,6} (.*)$/m.exec(text);
  return m ? m[1] : null;
}

export function headingTrail(subpath) {
  return subpath.split("#").filter((p) => p).join(" > ").trim();
}

export function tidyLinkTarget(text) {
  return text.replace(/\u00A0/g, " ").trim().normalize("NFC");
}
