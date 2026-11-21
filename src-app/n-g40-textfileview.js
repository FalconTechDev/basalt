// g40 clean-room: file-backed text views.
// EditableFileView — title field doubles as inline rename with live validation.
// TextFileView — data/lastSavedData buffer, 2 s autosave, close-save, disk-merge.
import { inherit } from "./inherit.js";
import { ng40DebounceCall } from "./n-g40-timing.js";
import { runTransition } from "./animation.js";

export function ng40DefineEditableFileView(host) {
  function EditableFileView() {
    const self = host.FileView.apply(this, arguments) || this;
    self.fileBeingRenamed = null;
    return self;
  }
  inherit(EditableFileView, host.FileView);
  const proto = EditableFileView.prototype;

  proto.setEphemeralState = function (eState) {
    host.FileView.prototype.setEphemeralState.call(this, eState);
    const rename = eState && eState.rename;
    if (!rename) return;
    let collapseToStart;
    if (rename === "start") collapseToStart = true;
    else if (rename === "end") collapseToStart = false;
    if (this.titleEl.isShown()) {
      if (host.Platform.isMobileApp) this.titleEl.contentEditable = "true";
      host.focusAndSelectContents(this.titleEl, collapseToStart);
    } else {
      this.app.fileManager.promptForFileRename(this.file);
    }
  };

  proto.onOpen = async function () {
    if (host.FileView.prototype.onOpen) await host.FileView.prototype.onOpen.call(this);
    const title = this.titleEl;
    title.tabIndex = -1;
    if (host.Platform.isMobileApp) title.addEventListener("touchstart", () => { title.contentEditable = "true"; });
    else title.contentEditable = "true";
    title.addEventListener("focus", this.onTitleFocus.bind(this));
    title.addEventListener("blur", this.onTitleBlur.bind(this));
    title.addEventListener("input", () => this.onTitleChange(title));
    title.addEventListener("paste", (event) => this.onTitlePaste(title, event));
    title.addEventListener("keydown", this.onTitleKeydown.bind(this));
  };

  proto.onTitleFocus = function () {
    this.fileBeingRenamed = this.file;
    this.titleEl.spellcheck = this.app.vault.getConfig("spellcheck");
    const parentEl = this.titleParentEl;
    runTransition(
      parentEl,
      new host.Transition({ duration: 150 }).addProp("opacity", "1", "0", "0").addProp("width", parentEl.clientWidth + "px", "0", ""),
      () => parentEl.detach(),
    );
  };

  proto.onTitleBlur = async function () {
    const title = this.titleEl;
    const doc = title.doc || document;
    const selection = doc.getSelection && doc.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      if (title === container || title.contains(container)) selection.removeRange(range);
    }
    const saved = await this.saveTitle(title);
    if (!saved) title.setText(this.file.basename);
    host.hideTooltip();
    this.fileBeingRenamed = null;
    this.titleEl.spellcheck = false;
    if (host.Platform.isMobileApp) title.contentEditable = "false";
    this.titleContainerEl.prepend(this.titleParentEl);
    runTransition(
      this.titleParentEl,
      new host.Transition({ duration: 150 }).addProp("opacity", "0", "1", "").addProp("width", "0", this.titleParentEl.clientWidth + "px", ""),
    );
    this.titleEl.scrollTo({ left: 0 });
  };

  proto.onTitlePaste = function (el, event) { host.pastePlainText(el, event); };

  proto.onTitleChange = function (el) {
    const file = this.file;
    host.normalizeEditable(el);
    const name = el.getText().trim();
    const problem = host.validateFileName(this.app, file, name, false);
    if (problem) host.showErrorTooltip(el, problem);
    else if (host.UNSAFE_NAME_CHARS.test(name)) host.showErrorTooltip(el, host.t.plugins.fileExplorer.msgUnsafeCharacters() + host.UNSAFE_NAME_LIST);
    else host.hideTooltip();
  };

  proto.onTitleKeydown = function (event) {
    if (event.isComposing) return;
    const target = event.targetNode || event.target;
    const leaveField = () => {
      if (target && target.blur) target.blur();
      this.setEphemeralState({ focus: true, focusOnMobile: target !== this.titleEl });
    };
    if (event.key === "Escape") {
      event.preventDefault();
      this.fileBeingRenamed = null;
      if (target && target.setText) target.setText(this.file.basename);
      leaveField();
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      (async () => {
        if (await this.saveTitle(target)) leaveField();
      })();
    } else if (event.key === "ArrowDown" && target && target.win && target.instanceOf && target.instanceOf(HTMLElement)) {
      const selection = target.win.getSelection();
      if (selection && selection.rangeCount >= 1) {
        const range = selection.getRangeAt(0);
        if (target === range.startContainer || target.contains(range.startContainer)) {
          const caret = range.getBoundingClientRect();
          if (caret.bottom + caret.height / 2 >= target.getBoundingClientRect().bottom) {
            event.preventDefault();
            target.blur();
            target.win.getSelection().empty();
            this.setEphemeralState({ focus: true, focusMetadata: !event.altKey });
          }
        }
      }
    }
  };

  proto.saveTitle = async function (el) {
    const file = this.file;
    if (file !== this.fileBeingRenamed || file.deleted) return true;
    const name = el.getText().trim();
    const problem = host.validateFileName(this.app, file, name, true);
    if (problem) {
      host.showErrorTooltip(el, problem);
      return false;
    }
    const newPath = file.getNewPathAfterRename(name);
    if (file.path === newPath) return true;
    try {
      await this.app.fileManager.renameFile(file, newPath);
    } catch (err) {
      if (err) {
        console.error(err);
        host.showErrorTooltip(el, err.message || err.code || err.toString());
      }
      return false;
    }
    return true;
  };

  proto.onPaneMenu = function (menu, source) {
    host.FileView.prototype.onPaneMenu.call(this, menu, source);
    const file = this.file;
    if (!file) return;
    menu.addItem((item) => item
      .setSection("action")
      .setTitle(host.t.plugins.fileExplorer.menuOptRename())
      .setIcon("lucide-edit-3")
      .onClick(() => this.app.fileManager.promptForFileRename(file)));
    menu.addItem((item) => item
      .setSection("danger")
      .setTitle(host.t.interface.menu.deleteFile())
      .setIcon("lucide-trash-2")
      .setWarning(true)
      .onClick(() => this.app.fileManager.promptForDeletion(file)));
    this.app.workspace.trigger("file-menu", menu, file, source, this.leaf);
  };

  return EditableFileView;
}

export function ng40DefineTextFileView(host) {
  function TextFileView(leaf) {
    const self = host.EditableFileView.call(this, leaf) || this;
    self.lastSavedData = null;
    self.saving = false;
    self.saveAgain = false;
    self.isPlaintext = true;
    self.data = null;
    self.dirty = false;
    const saveSoon = ng40DebounceCall(self.save.bind(self), 2000);
    self.requestSave = function () {
      self.dirty = true;
      saveSoon();
    };
    return self;
  }
  inherit(TextFileView, host.EditableFileView);
  const proto = TextFileView.prototype;

  proto.onload = function () {
    host.EditableFileView.prototype.onload.call(this);
    const ref = this.app.vault.on("modify", this.onModify, this);
    if (this.registerEvent) this.registerEvent(ref);
  };

  proto.onUnloadFile = async function () { await this.save(true); };
  proto.onLoadFile = async function (file) { await this.loadFileInternal(file, true); };

  proto.saveImmediately = function () {
    if (this.dirty) return this.save(false);
    return undefined;
  };

  proto.save = async function (closing) {
    this.dirty = false;
    const file = this.file;
    const vault = this.app.vault;
    if (!file || file.deleted) return;
    if (this.saving) {
      if (!closing) this.saveAgain = true;
      return;
    }
    this.saveAgain = false;
    const text = this.getViewData();
    if (this.lastSavedData === text || this.lastSavedData === null) return;
    const previous = this.lastSavedData;
    if (closing) {
      this.data = null;
      this.lastSavedData = null;
      this.clear();
    } else {
      this.data = text;
      this.lastSavedData = text;
    }
    this.saving = true;
    try {
      await host.awaitSettled(vault.adapter.promise);
      await vault.modify(file, text);
    } catch (err) {
      this.lastSavedData = previous;
      console.error(err);
      new host.Notice(host.t.interface.msgFailToSaveFile({ filepath: file.path, message: err.message }), 0);
      this.app.fileManager.storeTextFileBackup(file.path, text);
      throw err;
    } finally {
      this.saving = false;
      if (this.saveAgain && !closing) this.save();
    }
  };

  proto.onModify = function (file) {
    if (this.saving || file.deleted) return;
    if (file === this.file) this.loadFileInternal(file, false);
  };

  proto.loadFileInternal = async function (file, initial) {
    let text = file.saving ? await this.app.vault.cachedRead(file) : await this.app.vault.read(file);
    const before = this.lastSavedData;
    this.lastSavedData = text;
    if (!initial && before) {
      if (before === text) return;
      if (this.dirty) {
        const mine = this.getViewData();
        if (mine === text) return;
        if (mine !== before && this.isPlaintext) {
          text = host.mergeText(before, mine, text);
          new host.Notice(host.t.interface.msgFileChanged({ file: file.path }));
        }
      }
    }
    this.setData(text, initial);
  };

  proto.setData = function (text, clear) {
    if (this.data !== text || clear) {
      this.data = text;
      this.setViewData(text, clear);
    }
  };

  return TextFileView;
}
