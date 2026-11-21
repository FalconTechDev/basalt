// g26 clean-room: the command registry behind app.commands (spec g26 Part B.1-B.3).
// Commands are plain records in two tables (all / editor); editor commands get a
// synthesised availability check so they only fire with a suitable editor.

import { keyLabel } from "./text.js";

function ng26ActiveEditorView(app) {
  const active = app.workspace && app.workspace.activeEditor;
  return active || null;
}

function ng26EditorMode(view) {
  if (!view) return null;
  if (typeof view.getMode === "function") return view.getMode();
  return view.mode || null;
}

/** checkCallback wrapper enforcing the editor preconditions of an editor command. */
function ng26EditorCheck(command, app, markdownView) {
  return function (checking, editor, view) {
    const active = ng26ActiveEditorView(app);
    if (!active) return null;
    if (ng26EditorMode(active) === "preview" && !command.allowPreview) return undefined;
    if (markdownView && active instanceof markdownView) {
      const ae = activeDocument.activeElement;
      if (ae) {
        const title = active.inlineTitleEl || active.titleEl;
        if (title && (ae === title || title.contains(ae))) return undefined;
        if (!command.allowProperties && ae.closest && ae.closest(".metadata-container")) return undefined;
      }
    }
    if (command.editorCheckCallback) return command.editorCheckCallback(checking, editor, view);
    if (command.editorCallback) {
      if (checking) return undefined;
      command.editorCallback(editor, view);
      return true;
    }
    return undefined;
  };
}

export function ng26DefineCommands(host) {
  function Commands(app) {
    this.app = app;
    this.commands = {};
    this.editorCommands = {};
  }
  const proto = Commands.prototype;

  proto.addCommand = function (command) {
    if (command.mobileOnly && !host.Platform.isMobile) return;
    const isEditor = !!(command.editorCallback || command.editorCheckCallback);
    if (isEditor || command.showOnMobileToolbar) this.editorCommands[command.id] = command;
    if (isEditor) {
      command.checkCallback = ng26EditorCheck(command, this.app, host.MarkdownView);
    }
    this.commands[command.id] = command;
    if (command.hotkeys) this.app.hotkeyManager.addDefaultHotkeys(command.id, command.hotkeys);
  };

  proto.removeCommand = function (id) {
    const had = this.commands.hasOwnProperty(id);
    delete this.commands[id];
    delete this.editorCommands[id];
    if (had) this.app.hotkeyManager.removeDefaultHotkeys(id);
  };

  proto.findCommand = function (id) { return this.commands[id]; };

  proto.listCommands = function () {
    const out = [];
    for (const id of Object.keys(this.commands)) {
      const command = this.commands[id];
      if (!command.checkCallback) { out.push(command); continue; }
      try {
        if (command.checkCallback(true)) out.push(command);
      } catch (err) {
        console.log("Command failed to execute: ", id);
        console.error(err);
      }
    }
    return out;
  };

  proto.executeCommand = function (command, event) {
    this.app.lastEvent = event || null;
    try {
      host.runCommandCallback(command);
      return true;
    } catch (err) {
      console.log("Command failed to execute: ", command.id);
      console.error(err);
      return false;
    }
  };

  proto.executeCommandById = function (id, event) {
    const command = this.findCommand(id);
    return command ? this.executeCommand(command, event) : false;
  };

  return Commands;
}
