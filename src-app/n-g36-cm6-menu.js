// g36 clean-room: image-embed context menu + embed-link size rewriting
// (spec g36 Part D.3). Handles both external image widgets (url) and internal
// embed widgets (env().s30m6 instances with an image child).

import { env } from "./env.js";
import { ng36FileModalClass } from "./n-g36-cm6-widgets.js";

const NG36_SIZE_RE = /^(\d+)x(\d+)$/i;

/**
 * Rewrites an embed link's size suffix. `![[target|alias|WxH]]` and
 * `![alt|WxH](url)` forms are supported; a size-shaped last segment is always
 * replaced (or removed when `size` is falsy). Non-embed text is returned
 * unchanged.
 */
export function ng36EmbedLinkText(text, size) {
  const src = String(text == null ? "" : text);
  const wiki = /^!\[\[([^\]|]+)((?:\|[^\]|]*)*)\]\]/.exec(src);
  if (wiki) {
    const parts = wiki[2] ? wiki[2].split("|").filter((p) => p !== "") : [];
    if (parts.length && NG36_SIZE_RE.test(parts[parts.length - 1])) parts.pop();
    if (size) parts.push(size);
    return "![[" + wiki[1] + (parts.length ? "|" + parts.join("|") : "") + "]]";
  }
  const md = /^!\[([^\]]*)\]\(([^)]*)\)/.exec(src);
  if (md) {
    const parts = md[1].split("|");
    if (parts.length > 1 && NG36_SIZE_RE.test(parts[parts.length - 1])) parts.pop();
    if (size) parts.push(size);
    return "![" + parts.join("|") + "](" + md[2] + ")";
  }
  return src;
}

function ng36MimeForExtension(ext) {
  const map = env().s30du || {};
  for (const mime of Object.keys(map)) if (map[mime] === ext) return mime;
  return "image/png";
}

function ng36ContentTypeMime(res) {
  const e = env();
  if (!res || !res.headers || typeof e.s30qV !== "function") return "image/png";
  const key = e.s30qV(res.headers, "content-type");
  const ct = res.headers[key];
  if (typeof ct !== "string") return "image/png";
  const mime = ct.split(";")[0].trim().toLowerCase();
  return mime.indexOf("image/") === 0 ? mime : "image/png";
}

async function ng36WriteImageToClipboard(data, mime) {
  const e = env();
  const native = e.Yl.isDesktopApp && (mime === "image/png" || mime === "image/jpeg");
  if (native) {
    const img = e.electron.nativeImage.createFromBuffer(e.s30vu(data));
    const clip = e.qf < 40 ? e.electron.clipboard : e.electron.remote.clipboard;
    clip.writeImage(img);
    return;
  }
  const blob = new Blob([data], { type: "image/png" });
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

async function ng36CopyImage(widget) {
  const e = env();
  try {
    let data, mime;
    const Internal = e.s30m6, ImageChild = e.s30tJ;
    if (Internal && widget instanceof Internal && ImageChild && widget.child instanceof ImageChild && widget.child.file) {
      data = await widget.app.vault.readBinary(widget.child.file);
      mime = ng36MimeForExtension(widget.child.file.extension);
    } else if (typeof widget.url === "string") {
      const res = await e.s30hy(widget.url);
      data = await res.arrayBuffer;
      mime = ng36ContentTypeMime(res);
    } else {
      return;
    }
    await ng36WriteImageToClipboard(data, mime);
  } catch (err) {
    new e.fb(e.gm.interface.copy_failed());
  }
}

function ng36IsInternalImage(widget) {
  const e = env();
  return !!(e.s30m6 && widget instanceof e.s30m6 && e.s30tJ && widget.child instanceof e.s30tJ && widget.child.file);
}

/** Attaches the contextmenu handler + resize corner to an image embed. */
export function ng36ImageContextMenu(widget, editor, containerEl, imgEl, wrapperEl) {
  const e = env();
  wrapperEl.addEventListener("contextmenu", (event) => {
    const menu = e.Ug.forEvent(event);
    menu.setParentElement(containerEl);
    menu.addSections(["image"]);
    const internal = ng36IsInternalImage(widget);
    menu.addItem((item) => item
      .setSection("image")
      .setTitle(e.gm.interface.menu.copyImage())
      .setIcon("lucide-copy")
      .onClick(() => ng36CopyImage(widget)));
    if (internal) {
      menu.addItem((item) => item
        .setSection("image")
        .setTitle(e.gm.plugins.canvas.actionSwapFile())
        .setIcon("lucide-arrow-left-right")
        .onClick(() => {
          const FM = ng36FileModalClass();
          const modal = new FM(widget.app, (file) => {
            const link = widget.app.fileManager.generateMarkdownLink(file);
            editor.dispatch({ changes: [{ from: widget.start, to: widget.end, insert: "!" + link }], scrollIntoView: false });
          });
          modal.open();
        }));
    }
    if (imgEl && imgEl.hasAttribute && imgEl.hasAttribute("width")) {
      menu.addItem((item) => item
        .setSection("image")
        .setTitle(e.gm.editor.menu.resetSize())
        .setIcon("lucide-rotate-ccw")
        .onClick(() => {
          const text = editor.state.doc.sliceString(widget.start, widget.end);
          editor.dispatch({ changes: [{ from: widget.start, to: widget.end, insert: ng36EmbedLinkText(text) }] });
          imgEl.removeAttribute("width");
        }));
    }
    if (internal) {
      menu.addItem((item) => item
        .setSection("danger")
        .setTitle(e.gm.editor.menu.deleteImage())
        .setIcon("lucide-trash-2")
        .setWarning(true)
        .onClick(async () => {
          const info = e.MT(widget.href);
          const target = widget.app.metadataCache.getFirstLinkpathDest(info.path, widget.sourcePath);
          if (await widget.app.fileManager.promptForDeletion(target)) {
            editor.dispatch({
              changes: [{ from: widget.start, to: widget.end, insert: "" }],
              userEvent: "select.pointer",
              selection: e.pe.cursor(widget.start),
            });
          }
        }));
    }
  });

  if (!e.Yl.isMobile) {
    const corner = document.createElement("div");
    corner.className = "image-resize-corner";
    wrapperEl.appendChild(corner);
    ng36WireResizeCorner(corner, widget, editor, imgEl, wrapperEl);
  }
}

function ng36WireResizeCorner(corner, widget, editor, imgEl, wrapperEl) {
  const e = env();
  corner.addEventListener("dblclick", (ev) => {
    if (ev.defaultPrevented) return;
    const text = editor.state.doc.sliceString(widget.start, widget.end);
    editor.dispatch({ changes: [{ from: widget.start, to: widget.end, insert: ng36EmbedLinkText(text) }] });
    if (imgEl) imgEl.removeAttribute("width");
  });
  corner.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 || !imgEl) return;
    ev.preventDefault();
    const start = e.s30Fl(ev);
    const rect = imgEl.getBoundingClientRect ? imgEl.getBoundingClientRect() : { left: 0, right: 0, width: 0 };
    const rtl = typeof getComputedStyle === "function" && getComputedStyle(imgEl).direction === "rtl";
    const originX = rtl ? rect.right : rect.left;
    const startW = imgEl.clientWidth || rect.width || 0;
    const ratio = imgEl.clientHeight && imgEl.clientWidth ? imgEl.clientHeight / imgEl.clientWidth : 0;
    const maxW = editor.contentDOM && editor.contentDOM.offsetWidth ? editor.contentDOM.offsetWidth : 800;
    let frame = 0, lastW = startW;
    const apply = () => {
      frame = 0;
      imgEl.style.width = Math.round(lastW) + "px";
      if (ratio) imgEl.style.height = Math.round(lastW * ratio) + "px";
    };
    const handlers = e.s30Cg(ev, () => ({
      move(moveEv) {
        const p = e.s30Fl(moveEv);
        const dx = rtl ? originX - p.x : p.x - originX;
        lastW = Math.max(20, Math.min(startW + dx, maxW));
        if (!frame) frame = requestAnimationFrame(apply);
      },
      up() {
        if (frame) { cancelAnimationFrame(frame); frame = 0; }
        apply();
        const text = editor.state.doc.sliceString(widget.start, widget.end);
        const size = Math.round(imgEl.clientWidth || lastW);
        editor.dispatch({ changes: [{ from: widget.start, to: widget.end, insert: ng36EmbedLinkText(text, size + "x" + Math.round((imgEl.clientHeight || lastW * (ratio || 1)))) }] });
      },
    }));
    if (handlers && typeof handlers.up === "function") {
      const origUp = handlers.up;
      handlers.up = function (upEv) { return origUp.call(this, upEv); };
    }
  });
}
