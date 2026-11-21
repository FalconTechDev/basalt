// g26 clean-room: ClipboardManager (spec g26 Part E). One instance per editor
// owner (`new host.ClipboardManager(owner)` in n-g09-editor-cm.js); owns paste
// conversion, OS file drops and the Mod-drop link mode. Conversion and drop
// helpers live in n-g26-clipboard-data.js.

import { ng26ConvertTransfer, ng26DropIntoEditor, ng26InsertFiles, ng26SaveAttachment } from "./n-g26-clipboard-data.js";

export function ng26DefineClipboardManager(host) {
  class ClipboardManager {
    constructor(info) {
      this.info = info;
      this.app = info.app;
    }

    getPath() {
      const file = this.info.file;
      return (file && file.path) || "";
    }

    handlePaste(event) {
      if (!event.defaultPrevented) {
        this.app.workspace.trigger("editor-paste", event, this.info.editor, this.info);
      }
      if (event.defaultPrevented) return true;
      const data = event.clipboardData;
      if (data && data.getData("basalt/properties") && this.info instanceof host.MarkdownView) {
        this.info.handlePaste(event);
      }
      return false;
    }

    handleDragOver(event) {
      const manager = this.app.dragManager;
      const draggable = manager && manager.draggable;
      if (draggable) {
        const modKey = host.Platform.isMacOS ? event.shiftKey : event.altKey;
        if (modKey) return;
        const dd = host.t.interface.dragAndDrop;
        const setLinkAction = (label) => {
          host.dragDropEffect(event, "link");
          manager.setAction(label);
        };
        if (draggable.type === "file" || draggable.type === "link" || draggable.type === "heading") {
          setLinkAction(dd.insertLinkHere());
        } else if (draggable.type === "files") {
          setLinkAction(dd.insertLinksHere());
        } else if (draggable.type === "bookmarks") {
          const items = draggable.items || [];
          let hasFile = false;
          for (const entry of items) {
            if (entry && entry.item && entry.item.type === "file") { hasFile = true; break; }
          }
          if (hasFile) setLinkAction(dd.insertLinkHere());
        }
        return;
      }
      host.dragDropEffect(event, event.ctrlKey ? "link" : "copy");
    }

    handleDrop(event) {
      const manager = this.app.dragManager;
      const draggable = manager && manager.draggable;
      let result = null;
      if (draggable) {
        const modKey = host.Platform.isMacOS ? event.shiftKey : event.altKey;
        if (this.info instanceof host.MarkdownView && modKey) {
          event.preventDefault();
          this.info.handleDrop(event, draggable, false);
          return true;
        }
        result = host.dragLinkText(this.app, draggable, this.getPath(), true).join("\n");
      } else {
        if (!event.defaultPrevented) {
          this.app.workspace.trigger("editor-drop", event, this.info.editor, this.info);
          if (event.defaultPrevented) return true;
        }
        if (!event.shiftKey) {
          result = this.handleDataTransfer(event.dataTransfer);
          if (!result) result = this.handleDropIntoEditor(event);
        }
      }
      const cm = this.info.editor && this.info.editor.activeCM;
      if (cm && cm.posAtCoords && cm.dispatch) {
        cm.dispatch({ selection: host.cmSelection.single(cm.posAtCoords({ x: event.clientX, y: event.clientY })) });
      }
      if (typeof result === "string") {
        if (cm && cm.state && cm.state.replaceSelection) {
          cm.dispatch(cm.state.replaceSelection(result));
          cm.focus();
        }
        event.preventDefault();
        return true;
      }
      return false;
    }

    handleDropIntoEditor(event) {
      return ng26DropIntoEditor(host, this, event);
    }

    handleDataTransfer(transfer) {
      return ng26ConvertTransfer(host, this, transfer);
    }

    insertFiles(files) {
      return ng26InsertFiles(host, this, files);
    }

    saveAttachment(name, extension, data, addNewline) {
      return ng26SaveAttachment(host, this, name, extension, data, addNewline);
    }

    insertAttachmentEmbed(file, addNewline) {
      let embed = "!" + this.app.fileManager.generateMarkdownLink(file, this.getPath());
      if (addNewline) embed += "\n\n";
      this.info.editor.replaceSelection(embed);
    }
  }

  for (const key of Object.getOwnPropertyNames(ClipboardManager.prototype)) {
    if (key === "constructor") continue;
    const desc = Object.getOwnPropertyDescriptor(ClipboardManager.prototype, key);
    Object.defineProperty(ClipboardManager.prototype, key, {
      value: desc.value,
      writable: false,
      enumerable: desc.enumerable,
      configurable: false,
    });
  }
  Object.freeze(ClipboardManager.prototype);

  return ClipboardManager;
}
