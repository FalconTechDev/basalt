// s04: own implementations of the Electron native-menu glue.
//
//  - s04MenuManager (was `Xg`): builds the application menu template, applies
//    hotkey accelerators, hides commands that are not registered, and pushes
//    menu-state updates to the main process over IPC.
//  - s04FormatMenuPlugin (was `Zg`): a CodeMirror view plugin that reports the
//    formatting state at the cursor so the Format menu checkboxes stay live.
//  - modifier tables (was `Fg`, `Qg`, `Og`).
//
// The Electron module is reached lazily through env().If (the require shim);
// everything else comes through the host table or the own flat scope.

import { env } from "./env.js";

// ---------------------------------------------------------------- modifier tables (was `Fg`, `Qg`, `Og`)

/** Modifier names in canonical order (was `Fg`). */
export const s04ModifierKeys = ["Mod", "Ctrl", "Meta", "Alt", "Shift"];

/** Names used inside Electron accelerators (was `Qg`). */
export const s04AcceleratorNames = { Mod: "CommandOrControl", Ctrl: "Ctrl", Meta: "Command", Alt: "Alt", Shift: "Shift" };

/** Display names/symbols for modifier keys, platform dependent (was `Og`). */
export function s04ModifierDisplayNames(isMac) {
  return isMac
    ? { Mod: "⌘", Ctrl: "⌃", Meta: "⌘", Alt: "⌥", Shift: "⇧" }
    : { Mod: "Ctrl", Ctrl: "Ctrl", Meta: "Win", Alt: "Alt", Shift: "Shift" };
}

// ---------------------------------------------------------------- IPC helpers

/** Runs `fn` with the Electron module when it is available (was `Of`). */
function s04WithElectron(fn) {
  const electron = env().If("electron");
  if (electron) fn(electron);
}

/** Sends a menu-state patch to the main process (was `Xg.updateMenuItems`). */
export function s04UpdateMenuItems(items, merge) {
  if (merge === undefined) merge = false;
  s04WithElectron((electron) => electron.ipcRenderer.send("update-menu-items", items, merge));
}

// ---------------------------------------------------------------- the menu manager (was `Xg`)

/** Own implementation of the native application menu manager. */
export function s04MenuManager(host) {
  class MenuManager {
    constructor(app) {
      this.requestRender = host.debounce(this.render.bind(this), 200);
      this.onFileOpen = host.debounce(this._onFileOpen.bind(this), 250);
      this.onWindowFrameChange = host.debounce(this.updateWorkspace.bind(this), 200);
      this.app = app;
      app.workspace.registerEditorExtension(s04FormatMenuPlugin(host));
      app.workspace.on("file-open", this.onFileOpen);
      app.workspace.on("active-leaf-change", this.onFileOpen);
      app.workspace.on("window-frame-change", this.onWindowFrameChange);
      app.workspace.onLayoutReady(() => this.render());
    }

    _onFileOpen() {
      this.updateViewState();
      this.updateWorkspace();
      if (host.Platform.isMacOS) this.updateShareMenuItem();
    }

    updateViewState() {
      const editor = this.app.workspace.activeEditor;
      let enabled = false;
      let preview = false;
      let source = false;
      if (editor) {
        enabled = true;
        preview = editor.getMode() === "preview";
        source = !preview && editor.editMode.sourceMode;
      }
      s04UpdateMenuItems([
        { itemId: "markdown:toggle-preview", eState: { checked: preview, enabled } },
        { itemId: "editor:toggle-source", eState: { checked: source, enabled: enabled && !preview } },
      ]);
    }

    updateWorkspace() {
      const workspace = this.app.workspace;
      const leaf = workspace.activeLeaf;
      const left = workspace.leftSplit;
      const right = workspace.rightSplit;
      const isActiveWindow = env().activeWindow === window;
      s04UpdateMenuItems([
        { itemId: "app:toggle-left-sidebar", eState: { checked: left && !(left && left.collapsed), enabled: isActiveWindow } },
        { itemId: "app:toggle-right-sidebar", eState: { checked: right && !right.collapsed, enabled: isActiveWindow } },
        { itemId: "app:toggle-ribbon", eState: { checked: document.body.hasClass("show-ribbon"), enabled: isActiveWindow } },
        { itemId: "workspace:move-to-new-window", eState: { enabled: leaf && leaf.view instanceof host.ItemView } },
      ]);
    }

    updateShareMenuItem() {
      const adapter = this.app.vault.adapter;
      if (!(adapter instanceof env().Eu)) return;
      const editor = this.app.workspace.activeEditor;
      const file = editor ? editor.file : undefined;
      s04UpdateMenuItems(
        [{ itemId: "share-menu", eState: { sharingItem: { filePaths: file ? [adapter.getFullPath(file.path)] : [] } } }],
        true
      );
    }

    buildMenu() {
      const items = host.t.menuItems;
      const mac = host.Platform.isMacOS;
      const template = host.combineExtensions(
        host.combineExtensions(
          [],
          mac
            ? [
                {
                  label: "Basalt",
                  submenu: [
                    { before: ["preferences-section"], appCommand: "app:open-settings", label: "Preferences..." },
                    { type: "separator" },
                  ],
                },
              ]
            : [],
          true
        ),
        [
          {
            label: "&File",
            submenu: host.combineExtensions(
              host.combineExtensions(
                [
                  { before: ["open-section"], appCommand: "file-explorer:new-file", label: items.newFile() },
                  { before: ["open-section"], appCommand: "file-explorer:new-file-in-new-pane", label: items.newFileToTheRight() },
                  { before: ["open-section"], appCommand: "workspace:new-tab", label: items.newTab() },
                  { before: ["open-section"], appCommand: "workspace:new-window", label: items.newWindow() },
                  { before: ["open-section"], type: "separator" },
                  { before: ["open-section"], appCommand: "switcher:open", label: items.openSwitcher() },
                  { before: ["quit"], type: "separator" },
                  { before: ["quit"], appCommand: "workspace:close", label: items.closeTab() },
                  { before: ["quit"], appCommand: "workspace:close-window", label: items.closeWindow() },
                ],
                mac
                  ? [
                      { before: ["quit"], type: "separator" },
                      { id: "share-menu", before: ["quit"], enabled: false, role: "shareMenu" },
                    ]
                  : [],
                true
              ),
              [{ before: ["quit"], appCommand: "workspace:export-pdf", label: items.exportPdf() }],
              false
            ),
          },
          {
            label: "&Edit",
            submenu: [
              { id: "find-section", before: ["speech-section"], type: "separator" },
              { before: ["speech-section"], appCommand: "editor:open-search", label: items.find() },
              { before: ["speech-section"], appCommand: "editor:open-search-replace", label: items.replace() },
              { type: "separator" },
            ],
          },
          {
            label: "&Insert",
            submenu: [
              { appCommand: "editor:insert-wikilink", label: items.insertWikilink() },
              { appCommand: "editor:insert-link", label: items.insertMarkdownLink() },
              { appCommand: "editor:insert-callout", label: items.insertCallout() },
              { appCommand: "editor:insert-blockquote", label: items.insertQuote() },
              { type: "separator" },
              { appCommand: "editor:insert-codeblock", label: items.insertCodeblock() },
              { appCommand: "editor:insert-mathblock", label: items.insertMathBlock() },
              { appCommand: "editor:insert-table", label: items.insertTable() },
              { appCommand: "editor:insert-footnote", label: items.insertFootnote() },
              { type: "separator" },
              { type: "separator" },
              { appCommand: "editor:toggle-bullet-list", label: items.toggleBulletList() },
              { appCommand: "editor:toggle-numbered-list", label: items.toggleNumberedList() },
              { appCommand: "editor:toggle-checklist-status", label: items.toggleChecklist() },
              { type: "separator" },
              { appCommand: "editor:attach-file", label: items.insertAttachment() },
              { type: "separator" },
              {
                label: items.foldingMenu(),
                submenu: [
                  { appCommand: "editor:fold-all", label: items.foldAll() },
                  { appCommand: "editor:unfold-all", label: items.unfoldAll() },
                  { type: "separator" },
                  { appCommand: "editor:fold-more", label: items("fold-more") },
                  { appCommand: "editor:fold-less", label: items("fold-less") },
                ],
              },
            ],
          },
          {
            label: "&Format",
            submenu: [
              { id: "heading-indeterminate", label: "Indeterminate heading level", type: "radio", visible: false },
              { appCommand: "editor:set-heading-1", label: items.setHeading({ level: 1 }), type: "radio" },
              { appCommand: "editor:set-heading-2", label: items.setHeading({ level: 2 }), type: "radio" },
              { appCommand: "editor:set-heading-3", label: items.setHeading({ level: 3 }), type: "radio" },
              { appCommand: "editor:set-heading-4", label: items.setHeading({ level: 4 }), type: "radio" },
              { appCommand: "editor:set-heading-5", label: items.setHeading({ level: 5 }), type: "radio" },
              { appCommand: "editor:set-heading-6", label: items.setHeading({ level: 6 }), type: "radio" },
              { appCommand: "editor:set-heading-0", label: items.noHeading(), type: "radio" },
              { type: "separator" },
              { appCommand: "editor:toggle-bold", label: items.toggleBold(), type: "checkbox" },
              { appCommand: "editor:toggle-italics", label: items.toggleItalics(), type: "checkbox" },
              { appCommand: "editor:toggle-code", label: items.toggleCode(), type: "checkbox" },
              { appCommand: "editor:toggle-highlight", label: items.toggleHighlight(), type: "checkbox" },
              { type: "separator" },
              { appCommand: "editor:toggle-strikethrough", label: items.toggleStrikethrough(), type: "checkbox" },
              { appCommand: "editor:toggle-inline-math", label: items.toggleInlineMath(), type: "checkbox" },
              { appCommand: "editor:toggle-comments", label: items.toggleComment(), type: "checkbox" },
              { type: "separator" },
            ],
          },
          {
            label: "&View",
            submenu: [
              { type: "checkbox", appCommand: "markdown:toggle-preview", label: items.readingView() },
              { type: "checkbox", appCommand: "editor:toggle-source", label: items.sourceMode() },
              { type: "separator" },
              { appCommand: "app:toggle-left-sidebar", label: items.toggleLeftSidebar(), type: "checkbox" },
              { appCommand: "app:toggle-right-sidebar", label: items.toggleRightSidebar(), type: "checkbox" },
              { type: "separator" },
              { appCommand: "app:toggle-ribbon", label: items.toggleRibbon(), type: "checkbox" },
              { type: "separator" },
              { appCommand: "workspace:split-vertical", label: items.splitRight() },
              { appCommand: "workspace:split-horizontal", label: items.splitDown() },
              { type: "separator" },
              { before: ["developer-section"], label: items.navigateBack(), appCommand: "app:go-back" },
              { before: ["developer-section"], label: items.navigateForward(), appCommand: "app:go-forward" },
              { before: ["developer-section"], type: "separator" },
            ],
          },
          { label: "&Window", role: "window", submenu: [{ before: ["tab-management"], label: items.moveToNewWindow(), appCommand: "workspace:move-to-new-window" }] },
          {
            label: "&Help",
            role: "help",
            submenu: [
              { label: items.releaseNotes(), appCommand: "app:show-release-notes", before: ["help-links"] },
              { appCommand: "app:show-debug-info", label: items.showDebugInfo() },
              { appCommand: "app:open-sandbox-vault", label: items.openSandbox() },
            ],
          },
        ],
        false
      );
      this.applyHotkeys(template);
      this.hideUnregisteredCommands(template);
      return template;
    }

    render() {
      const template = this.buildMenu();
      s04WithElectron((electron) => electron.ipcRenderer.send("set-menu", { template }));
    }

    getAcceleratorFromHotkey(hotkey) {
      if (!hotkey) return "";
      const parts = [];
      s04ModifierKeys.forEach((modifier) => {
        if (hotkey.modifiers && hotkey.modifiers.includes(modifier)) parts.push(s04AcceleratorNames[modifier]);
      });
      if (hotkey.key) parts.push(hotkey.key.replace("Arrow", ""));
      return parts.join("+");
    }

    applyHotkeys(items) {
      for (const item of items) {
        if ("appCommand" in item) {
          const hotkeys = this.app.hotkeyManager.getHotkeys(item.appCommand);
          const defaults = this.app.hotkeyManager.getDefaultHotkeys(item.appCommand);
          const hotkey = (hotkeys && hotkeys[0]) || (defaults && defaults[0]) || null;
          item.accelerator = this.getAcceleratorFromHotkey(hotkey);
          item.registerAccelerator = false;
        }
        if ("submenu" in item) this.applyHotkeys(item.submenu);
      }
    }

    hideUnregisteredCommands(items) {
      for (const item of items) {
        if ("appCommand" in item && !this.app.commands.findCommand(item.appCommand)) item.visible = false;
        if ("submenu" in item) this.hideUnregisteredCommands(item.submenu);
      }
    }

    static updateMenuItems(items, merge) {
      s04UpdateMenuItems(items, merge);
    }
  }

  return MenuManager;
}

// ---------------------------------------------------------------- format-state plugin (was `Zg`)

/**
 * CodeMirror extension reporting the inline formatting state at the primary
 * selection so the Format menu checkboxes reflect the cursor.
 */
export function s04FormatMenuPlugin(host) {
  return [
    host.cmViewPlugin.fromClass(
      class FormatMenuPlugin {
        constructor(view) {
          this.view = view;
          this.update = host.debounce(this.rawUpdate.bind(this), 500, true);
        }
        destroy() {
          this.update.cancel();
        }
        rawUpdate(update) {
          const state = update.view.state;
          const info = host.cmFormatQuery(state, state.selection.ranges[0]);
          s04UpdateMenuItems([
            info.uniformHeading
              ? { itemId: "editor:set-heading-" + info.headingLevel, eState: { checked: true } }
              : { itemId: "heading-indeterminate", eState: { checked: true } },
            { itemId: "editor:toggle-italics", eState: { checked: !!info.italic } },
            { itemId: "editor:toggle-bold", eState: { checked: !!info.bold } },
            { itemId: "editor:toggle-code", eState: { checked: !!info.code } },
            { itemId: "editor:toggle-highlight", eState: { checked: !!info.highlight } },
            { itemId: "editor:toggle-comments", eState: { checked: !!info.comment } },
            { itemId: "editor:toggle-strikethrough", eState: { checked: !!info.strikethrough } },
          ]);
        }
      }
    ),
  ];
}
