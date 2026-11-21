// g34 clean-room: wikilink pattern, deep setter, drag-link texts and
// link-text rewriting (spec g34 part C).
import { parseLinktext, linkPath, baseName, displayName, withoutMd, escapeLinkChars, plainSpaces } from "./path.js";
import { linkSafeHeading } from "./text.js";
import { fileClass } from "./vault.js";

// Whole-string wikilink: 1 = "[["/"![[", 2 = target, 3 = "|alias" part,
// 4 = alias text, 5 = "]]".
export const ng34WikiLinkPattern = /^(!?\[\[)(.*?)(\|(.*))?(\]\])$/;

const NG34_LINKS_OWN = Object.prototype.hasOwnProperty;

// Writes `value` at `keys` only when every level already exists.
export function ng34SetDeepValue(obj, keys, value) {
  let cur = obj;
  while (keys.length > 0) {
    const key = keys.shift();
    const last = keys.length === 0;
    if (cur === null || typeof cur !== "object") return;
    if (Array.isArray(cur)) {
      const index = parseInt(key, 10);
      if (Number.isNaN(index) || index < 0 || index >= cur.length) return;
      if (last) {
        cur[index] = value;
        return;
      }
      cur = cur[index];
    } else {
      if (!NG34_LINKS_OWN.call(cur, key)) return;
      if (last) {
        cur[key] = value;
        return;
      }
      cur = cur[key];
    }
  }
}

function ng34DragHandlers() {
  const tfile = () => fileClass("TFile");
  return {
    file(app, data, sourcePath, markdownLinks, host, out) {
      out.push(ng34DragLink(app, data.file, sourcePath, markdownLinks, host));
    },
    files(app, data, sourcePath, markdownLinks, host, out) {
      for (const file of data.files) {
        if (file instanceof tfile()) out.push(ng34DragLink(app, file, sourcePath, markdownLinks, host));
      }
    },
    link(app, data, sourcePath, markdownLinks, host, out) {
      if (data.file) out.push(ng34DragLink(app, data.file, sourcePath, markdownLinks, host, parseLinktext(data.linktext).subpath));
      else out.push(data.linktext);
    },
    heading(app, data, sourcePath, markdownLinks, host, out) {
      out.push(ng34DragLink(app, data.file, sourcePath, markdownLinks, host, "#" + linkSafeHeading(data.heading.heading)));
    },
    bookmarks(app, data, sourcePath, markdownLinks, host, out) {
      const tfileClass = tfile();
      for (const entry of data.items) {
        const item = entry.item;
        if (item.type !== "file") continue;
        const file = app.vault.getAbstractFileByPath(item.path);
        if (file instanceof tfileClass) out.push(ng34DragLink(app, file, sourcePath, markdownLinks, host, item.subpath, item.title));
      }
    },
  };
}

function ng34DragLink(app, file, sourcePath, markdownLinks, host, subpath, alias) {
  let link = app.fileManager.generateMarkdownLink(file, sourcePath, subpath, alias);
  if (markdownLinks && host.isImageExtension(file.extension)) link = "!" + link;
  return link;
}

// Markdown link texts produced when drag-dropping content onto the editor.
export function ng34DragLinkText(app, data, sourcePath, markdownLinks, host) {
  const out = [];
  const handler = ng34DragHandlers()[data.type];
  if (handler) handler(app, data, sourcePath, markdownLinks, host, out);
  return out;
}

function ng34RewriteWiki(ref, match, newPath) {
  const bang = match[1];
  const hadAlias = match[3] !== undefined;
  if (!hadAlias) return bang + newPath + "]]";
  let alias = match[4];
  const target = match[2];
  if (target.indexOf("/") >= 0 && alias.trim() === baseName(target)) {
    alias = baseName(linkPath(newPath));
  }
  const pipe = ref.original.indexOf("\\|") >= 0 ? "\\|" : "|";
  return bang + newPath + pipe + alias + "]]";
}

function ng34RewriteMarkdown(ref, match, newPath) {
  const destGroup = match[5] || "";
  let dest = escapeLinkChars(newPath);
  if (destGroup.charAt(0) === "<") dest = "<" + newPath + ">";
  let text = match[2];
  const oldPath = linkPath(ref.link);
  if (plainSpaces(text).trim() === displayName(oldPath)) {
    text = displayName(linkPath(newPath));
  } else if (plainSpaces(text).trim() === withoutMd(oldPath) && oldPath.indexOf("/") >= 0) {
    text = withoutMd(linkPath(newPath));
  }
  return match[1] + text + match[3] + dest + (match[6] || "") + match[8];
}

// Rewrites one link reference after its target moved; returns the new
// `original` text (or the old one when nothing applies).
export function ng34RewriteLinkText(ref, newPath, host) {
  const original = ref.original;
  const wiki = original.match(ng34WikiLinkPattern);
  if (wiki) return ng34RewriteWiki(ref, wiki, newPath);
  const md = original.match(host.s20MdLinkPattern);
  if (md) return ng34RewriteMarkdown(ref, md, newPath);
  const dest = escapeLinkChars(newPath);
  return (original.charAt(0) === "!" ? "!" : "") + "[](" + dest + ")";
}
