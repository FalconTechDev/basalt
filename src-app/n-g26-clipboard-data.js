// g26 clean-room: clipboard payload conversion + OS file drops
// (spec g26 Part E.3/E.4). Priority pipeline: markdown > html > uri-list;
// html goes through sanitizeHtml + htmlToMarkdown (the media-element scan of
// the original iterated an already-emptied fragment — dead code, omitted).

function ng26ExtOf(host, path) {
  return host.getExtension ? String(host.getExtension(path) || "").toLowerCase() : "";
}

function ng26ListHas(list, value) {
  if (!list) return false;
  if (typeof list.includes === "function") return list.includes(value);
  for (let i = 0; i < list.length; i++) if (list[i] === value) return true;
  return false;
}

function ng26Decode(uri) {
  try { return decodeURIComponent(uri); } catch (e) { return uri; }
}

/** text/html -> markdown, or null when conversion must not happen. */
function ng26HtmlToMarkdown(host, mgr, transfer, html) {
  if (!mgr.app.vault.getConfig("autoConvertHtml")) return null;
  const frag = host.sanitizeHtml(html);
  const container = createEl("div");
  if (frag && frag.nodeType) container.appendChild(frag);
  else container.innerHTML = String(frag == null ? "" : frag);
  const files = transfer.files;
  if (files && files.length > 0 && /^<img [^>]+>$/.test(container.innerHTML.trim())) return null;
  return host.htmlToMarkdown(container.innerHTML.trim());
}

/** text/uri-list -> markdown link/name, or null. */
function ng26UriListToMarkdown(host, mgr, transfer) {
  const uri = (transfer.getData("text/uri-list") || "").trim();
  if (!uri) return null;
  const text = (transfer.getData("text/plain") || "").trim();
  if (!text) {
    const files = host.clipboardFiles(transfer, "drop", false) || [];
    if (files.length === 1) {
      const entry = files[0] || {};
      const ext = ng26ExtOf(host, entry.name || entry.filepath || "");
      if (ext === "webloc" || ext === "url") return entry.name;
    }
    return uri;
  }
  const same = uri.toLowerCase() === text.toLowerCase()
    || ng26Decode(uri).toLowerCase() === text.toLowerCase();
  if (same) return null;
  const ext = ng26ExtOf(host, uri);
  return (ng26ListHas(host.mediaExtensions, ext) ? "!" : "") + "[" + text + "](" + uri + ")";
}

/** First-hit-wins conversion of a clipboard payload to markdown (or null). */
export function ng26ConvertTransfer(host, mgr, transfer) {
  const html = transfer.getData("text/html") || "";
  const plain = transfer.getData("text/plain") || "";
  if (html.indexOf(host.htmlCommentPrefix) !== -1 && plain) return null;
  const markdown = transfer.getData("text/markdown");
  if (markdown) return markdown;
  if (html) {
    const out = ng26HtmlToMarkdown(host, mgr, transfer, html);
    if (out !== null) return out;
  }
  if ((transfer.getData("text/uri-list") || "").trim()) {
    return ng26UriListToMarkdown(host, mgr, transfer);
  }
  return null;
}

/** One `[label](href)` for a Mod-drop file entry (no copying). */
function ng26LinkForPath(host, mgr, filepath) {
  const app = mgr.app;
  const resolved = app.vault.resolveFilePath(filepath);
  if (resolved) {
    let link = app.fileManager.generateMarkdownLink(resolved, mgr.getPath());
    if (host.isImageExtension(resolved.extension || ng26ExtOf(host, filepath))) link = "!" + link;
    return link;
  }
  const base = host.pathBaseName(filepath);
  const ext = ng26ExtOf(host, base);
  const label = ext === "md" ? host.stripExtBase(base) : base;
  const escaped = host.escapePathChars(host.pathNormalize ? host.pathNormalize(filepath) : filepath);
  const href = escaped.charAt(0) === "/" ? "file://" + escaped : "file:///" + escaped;
  return (ng26ListHas(host.mediaExtensions, ext) ? "!" : "") + "[" + label + "](" + href + ")";
}

/** Mod-drop: newline-joined link list; normal: async file insertion. */
export function ng26DropIntoEditor(host, mgr, event) {
  const modKey = host.Platform.isMacOS ? event.altKey : event.ctrlKey;
  if (modKey) {
    const files = host.clipboardFiles(event.dataTransfer, "drop", false) || [];
    const links = [];
    for (const entry of files) {
      if (entry && entry.filepath) links.push(ng26LinkForPath(host, mgr, entry.filepath));
    }
    return links.length ? links.join("\n") : null;
  }
  const all = host.clipboardFiles(event.dataTransfer, "drop", true) || [];
  if (all.length) {
    event.preventDefault();
    mgr.insertFiles(all);
  }
  return null;
}

/** Sequential embed insertion for dropped OS files. */
export async function ng26InsertFiles(host, mgr, files) {
  for (let i = 0; i < files.length; i++) {
    const entry = files[i] || {};
    const addNewline = i < files.length - 1;
    if (entry.filepath) {
      const resolved = mgr.app.vault.resolveFilePath(entry.filepath);
      if (resolved) {
        mgr.insertAttachmentEmbed(resolved, addNewline);
        continue;
      }
    }
    const data = await entry.data;
    if (data) await ng26SaveAttachment(host, mgr, entry.name, entry.extension, data, addNewline);
  }
}

export async function ng26SaveAttachment(host, mgr, name, extension, data, addNewline) {
  if (name === "Pasted image") name += " " + window.moment().format("YYYYMMDDHHmmss");
  const file = await mgr.app.saveAttachment(name, extension, data);
  if (file) mgr.insertAttachmentEmbed(file, addNewline);
}
