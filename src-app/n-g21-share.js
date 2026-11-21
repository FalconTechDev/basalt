// n-g21-share.js — ShareIntent (t4): receives shared text/files from other apps,
// builds the insert-into-note menus and imports shared files into the vault.
// Clean-room, spec g21 §3.5.

import { ellipsize } from "./text.js";
import { lastSegment, extensionOf, withoutExtension } from "./path.js";
import { env } from "./env.js";

function ng21MobileT(host, key, params, fallback) {
  try {
    const table = env().gm && env().gm.interface && env().gm.interface.mobile;
    const value = table && table[key];
    if (typeof value === "function") return value(params);
    if (typeof value === "string") {
      return params && params.filename ? value.split("{{filename}}").join(params.filename) : value;
    }
  } catch (e) { /* fall through */ }
  return fallback;
}

function ng21DialogueT(host, key, fallback) {
  try {
    const table = env().gm && env().gm.dialogue;
    const value = table && table[key];
    if (typeof value === "function") return value();
    if (typeof value === "string") return value;
  } catch (e) { /* fall through */ }
  return fallback;
}

function ng21ConvertSrc(uri) {
  try {
    const core = env().s04CapacitorCore;
    if (core && core.Ii && core.Ii.convertFileSrc) return core.Ii.convertFileSrc(uri);
  } catch (e) { /* fall through */ }
  try {
    if (typeof window !== "undefined" && window.Capacitor && window.Capacitor.convertFileSrc) {
      return window.Capacitor.convertFileSrc(uri);
    }
  } catch (e) { /* fall through */ }
  return uri;
}

export function ng21DefineS13ShareIntent(host) {
  function ShareIntent(app) {
    this.app = app;
    return this;
  }
  const p = ShareIntent.prototype;

  p.setupNative = function () {
    try {
      const bridge = env().capacitor || (typeof window !== "undefined" && window.Capacitor && window.Capacitor.Plugins);
      const share = bridge && (bridge.ShareIntent || bridge.Share || bridge.share);
      if (!share || typeof share.addListener !== "function") return;
      share.addListener("appShareIntent", (intent) => {
        try { host.blurAndClearSelection && host.blurAndClearSelection(); } catch (e) {}
        if (!intent) return;
        if (intent.type === "text") this.handleShareText(intent.text);
        else if (intent.type === "files") this.handleShareFiles(intent.files);
      });
    } catch (e) { /* no share bridge */ }
  };

  p.setupWorkspace = function () {
    const app = this.app;
    app.workspace.on("receive-text-menu", (menu, text) => {
      const view = this._activeMarkdownView();
      if (!view || !view.file) return;
      const filename = view.file.basename;
      menu.addItem((item) => item
        .setTitle(ng21MobileT(host, "actionInsertTextIntoFile", { filename }, filename))
        .setIcon("lucide-file")
        .setSection("options")
        .onClick(async () => {
          const insert = "\n" + text + "\n";
          try {
            if (view.getMode && view.getMode() === "preview") {
              await app.fileManager.insertIntoFile(view.file, insert);
            } else if (view.editor) {
              view.editor.insertText(insert);
            }
          } catch (e) { console.error(e); }
        }));
      menu.addItem((item) => item
        .setTitle(ng21MobileT(host, "actionChooseFileToInsert", null, "Pick a file..."))
        .setIcon("lucide-navigation")
        .setSection("options")
        .onClick(() => {
          try { new host.s13FilePickerModal(app, text).open(); } catch (e) { console.error(e); }
        }));
    });
    app.workspace.on("receive-files-menu", (menu, files) => {
      const view = this._activeMarkdownView();
      if (!view || !view.file || !view.editor) return;
      const links = (files || []).map((f) => {
        const link = "[[" + f.path + "]]";
        const ext = extensionOf(f.path);
        return host.isAttachmentExtension && host.isAttachmentExtension(ext) ? "!" + link : link;
      });
      menu.addItem((item) => item
        .setTitle(ng21MobileT(host, "actionInsertLinkIntoFile", { filename: view.file.basename }, "Insert link"))
        .setIcon("lucide-file")
        .setSection("options")
        .onClick(() => {
          try { view.editor.replaceSelection("\n" + links.join("\n") + "\n"); } catch (e) { console.error(e); }
        }));
    });
  };

  p._activeMarkdownView = function () {
    try {
      return this.app.workspace.getActiveViewOfType(host.MarkdownView) || null;
    } catch (e) { return null; }
  };

  p.handleShareText = function (text) {
    const app = this.app;
    const menu = new host.Menu();
    menu.addSections(["title", "options", "danger"]);
    const shown = String(text == null ? "" : text);
    menu.addItem((item) => item
      .setTitle(ellipsize(shown, 300))
      .setIcon("lucide-list-end")
      .setIsLabel(true)
      .setSection("title"));
    menu.addItem((item) => item
      .setTitle(ng21MobileT(host, "actionInsertTextDesc", null, "Append text into the open file:"))
      .setIsLabel(true)
      .setSection("title"));
    try { app.workspace.trigger("receive-text-menu", menu, text); } catch (e) { console.error(e); }
    menu.addItem((item) => item
      .setTitle(ng21DialogueT(host, "buttonCancel", "Cancel"))
      .setIcon("lucide-x")
      .setSection("danger"));
    menu.showAtPosition({ x: 0, y: 0 });
  };

  p.handleShareFiles = function (files) {
    const app = this.app;
    const list = Array.isArray(files) ? files : [];
    const menu = new host.Menu();
    menu.addItem((item) => {
      item.setIsLabel(true);
      for (const f of list) {
        const row = item.titleEl.createDiv();
        row.setText(f && f.name ? String(f.name) : "");
      }
    });
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle(ng21MobileT(host, "actionImport", null, "Bring into vault"))
      .setIcon("lucide-files")
      .onClick(() => this.importFiles(list)));
    menu.addItem((item) => item
      .setTitle(ng21DialogueT(host, "buttonCancel", "Cancel"))
      .setIcon("lucide-x"));
    menu.showAtPosition({ x: 0, y: 0 });
  };

  p.importFiles = async function (files) {
    const app = this.app;
    const vault = app.vault;
    const list = Array.isArray(files) ? files : [];
    const importing = ng21MobileT(host, "msgImporting", null, "Bringing in...");
    const notice = new host.Notice(importing);
    const done = () => {
      try { notice && notice.hide && notice.hide(); } catch (e) {}
    };
    const created = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i] || {};
      if (list.length > 1 && notice.setMessage) notice.setMessage(importing + " (" + i + "/" + list.length + ")");
      try {
        const uri = f.uri || f.path || "";
        const res = await fetch(ng21ConvertSrc(uri));
        const buffer = await res.arrayBuffer();
        const rawName = f.name || lastSegment(uri) || ("file-" + i);
        const ext = extensionOf(rawName) || "bin";
        const base = withoutExtension(rawName);
        const activeFile = app.workspace.getActiveFile && app.workspace.getActiveFile();
        const path = ext === "md"
          ? await vault.getAvailablePath(base, ext)
          : await vault.getAvailablePathForAttachments(base, ext, activeFile);
        created.push(await vault.createBinary(path, buffer));
      } catch (e) {
        done();
        const name = f.name || f.uri || "";
        try {
          new host.Notice(ng21MobileT(host, "msgFailedToImportFile", { filename: name }, "The file \"" + name + "\" could not be imported"));
        } catch (e2) {}
        try { new host.Notice(ellipsize(String(e && e.message ? e.message : e), 100)); } catch (e2) {}
        return;
      }
    }
    done();
    const menu = new host.Menu();
    menu.addItem((item) => item
      .setTitle(ng21MobileT(host, "msgImportSuccess", null, "Imported"))
      .setIsLabel(true));
    menu.addSeparator();
    menu.addItem((item) => item
      .setTitle(ng21DialogueT(host, "done", "Done"))
      .setIcon("lucide-check"));
    try { app.workspace.trigger("receive-files-menu", menu, created); } catch (e) { console.error(e); }
    menu.showAtPosition({ x: 0, y: 0 });
  };

  return ShareIntent;
}
