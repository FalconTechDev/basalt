// Slice s48 — the Workspace controller (bundle class `H0`, a function-style class
// produced by a class-IIFE). This factory replaces the whole
// `var H0 = function (e) { ... }(VT)` initializer; the 81 prototype methods it used
// to carry inline are already own code in workspace.js (manifest "methods" entries)
// and are attached to the prototype below. App-scope names arrive lazily through
// env(); own-module helpers through host.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { wsActiveLeafEvents, wsAddMobileFileInfo, wsAddRecentFile, wsChangeLayout, wsClearLayout, wsCreateLeafBySplit, wsCreateLeafInParent, wsCreateLeafInTabGroup, wsDeserializeLayout, wsDetachLeavesOfType, wsDuplicateLeaf, wsEnsureSideLeaf, wsFocusLeaf, wsGetActiveFile, wsGetActiveFileView, wsGetActiveLeafOfViewType, wsGetActiveViewOfType, wsGetAdjacentLeafInDirection, wsGetDropDirection, wsGetDropLocation, wsGetFocusedContainer, wsGetGroupLeaves, wsGetLastOpenFiles, wsGetLayout, wsGetLeaf, wsGetLeafById, wsGetLeavesOfType, wsGetLeftLeaf, wsGetMostRecentLeaf, wsGetRecentFiles, wsGetRightLeaf, wsGetSideLeaf, wsGetUnpinnedLeaf, wsHandleExternalLinkContextMenu, wsHandleLinkContextMenu, wsHasUndoHistory, wsIsAttached, wsIsInSidebar, wsIterateAllLeaves, wsIterateCodeMirrors, wsIterateLeaves, wsIterateRootLeaves, wsIterateTabs, wsLoadLayout, wsMoveLeafToPopout, wsOn, wsOnDragLeaf, wsOnLayoutChange, wsOnLayoutReady, wsOnQuickPreview, wsOnResize, wsOnStartLink, wsOpenLinkText, wsOpenPopout, wsOpenPopoutLeaf, wsPushUndoHistory, wsReadWorkspaceFile, wsRecursiveGetTarget, wsRegisterEditorExtension, wsRegisterHoverLinkSource, wsRegisterObsidianProtocolHandler, wsRegisterOperatorFuncConfigs, wsRegisterUriHook, wsRevealLeaf, wsSaveLayout, wsSetActiveLeaf, wsSetLayout, wsSplitActiveLeaf, wsSplitLeaf, wsSplitLeafOrActive, wsTrigger, wsUnregisterEditorExtension, wsUnregisterHoverLinkSource, wsUnregisterObsidianProtocolHandler, wsUnregisterOperatorFuncConfigs, wsUnsetActiveEditor, wsUpdateFrameless, wsUpdateLayout, wsUpdateMobileVisibleTabGroup, wsUpdateOptions, wsUpdateTitle } from "./workspace.js";

const S48_METHODS = {
  on: wsOn, trigger: wsTrigger, isAttached: wsIsAttached,
  getLeftLeaf: wsGetLeftLeaf, getRightLeaf: wsGetRightLeaf, getLeaf: wsGetLeaf,
  getGroupLeaves: wsGetGroupLeaves, iterateLeaves: wsIterateLeaves,
  iterateTabs: wsIterateTabs, iterateAllLeaves: wsIterateAllLeaves,
  iterateRootLeaves: wsIterateRootLeaves, iterateCodeMirrors: wsIterateCodeMirrors,
  hasUndoHistory: wsHasUndoHistory, isInSidebar: wsIsInSidebar,
  onLayoutChange: wsOnLayoutChange, onLayoutReady: wsOnLayoutReady,
  onQuickPreview: wsOnQuickPreview, addMobileFileInfo: wsAddMobileFileInfo,
  getRecentFiles: wsGetRecentFiles, getLastOpenFiles: wsGetLastOpenFiles,
  addRecentFile: wsAddRecentFile, onResize: wsOnResize, updateTitle: wsUpdateTitle,
  getActiveFile: wsGetActiveFile, getFocusedContainer: wsGetFocusedContainer,
  getMostRecentLeaf: wsGetMostRecentLeaf, getActiveViewOfType: wsGetActiveViewOfType,
  getActiveLeafOfViewType: wsGetActiveLeafOfViewType, getSideLeaf: wsGetSideLeaf,
  getActiveFileView: wsGetActiveFileView, activeLeafEvents: wsActiveLeafEvents,
  pushUndoHistory: wsPushUndoHistory, changeLayout: wsChangeLayout,
  updateOptions: wsUpdateOptions,
  registerObsidianProtocolHandler: wsRegisterObsidianProtocolHandler,
  unregisterObsidianProtocolHandler: wsUnregisterObsidianProtocolHandler,
  registerUriHook: wsRegisterUriHook, getUnpinnedLeaf: wsGetUnpinnedLeaf,
  ensureSideLeaf: wsEnsureSideLeaf, revealLeaf: wsRevealLeaf, splitLeaf: wsSplitLeaf,
  getDropDirection: wsGetDropDirection, getDropLocation: wsGetDropLocation,
  duplicateLeaf: wsDuplicateLeaf, createLeafInTabGroup: wsCreateLeafInTabGroup,
  updateMobileVisibleTabGroup: wsUpdateMobileVisibleTabGroup,
  readWorkspaceFile: wsReadWorkspaceFile, moveLeafToPopout: wsMoveLeafToPopout,
  splitActiveLeaf: wsSplitActiveLeaf, openLinkText: wsOpenLinkText,
  recursiveGetTarget: wsRecursiveGetTarget, createLeafInParent: wsCreateLeafInParent,
  getLeafById: wsGetLeafById, detachLeavesOfType: wsDetachLeavesOfType,
  registerEditorExtension: wsRegisterEditorExtension,
  unregisterEditorExtension: wsUnregisterEditorExtension,
  registerHoverLinkSource: wsRegisterHoverLinkSource,
  unregisterHoverLinkSource: wsUnregisterHoverLinkSource,
  registerOperatorFuncConfigs: wsRegisterOperatorFuncConfigs,
  unregisterOperatorFuncConfigs: wsUnregisterOperatorFuncConfigs,
  clearLayout: wsClearLayout, createLeafBySplit: wsCreateLeafBySplit,
  deserializeLayout: wsDeserializeLayout, focusLeaf: wsFocusLeaf,
  getAdjacentLeafInDirection: wsGetAdjacentLeafInDirection, getLayout: wsGetLayout,
  getLeavesOfType: wsGetLeavesOfType,
  handleExternalLinkContextMenu: wsHandleExternalLinkContextMenu,
  handleLinkContextMenu: wsHandleLinkContextMenu, loadLayout: wsLoadLayout,
  onDragLeaf: wsOnDragLeaf, onStartLink: wsOnStartLink, openPopout: wsOpenPopout,
  openPopoutLeaf: wsOpenPopoutLeaf, saveLayout: wsSaveLayout,
  setActiveLeaf: wsSetActiveLeaf, setLayout: wsSetLayout,
  splitLeafOrActive: wsSplitLeafOrActive, unsetActiveEditor: wsUnsetActiveEditor,
  updateFrameless: wsUpdateFrameless, updateLayout: wsUpdateLayout,
};

/** `var H0` — the Workspace controller: field setup, global listeners, command and
 * protocol-handler registration, swipe handling and the CodeMirror mode patch. */
export function s48Workspace(host) {
  const V = () => env();

  function Workspace(app, containerEl) {
    const self = V().VT.call(this) || this;
    self.leftSplit = null;
    self.rightSplit = null;
    self.leftRibbon = null;
    self.rightRibbon = null;
    self.rootSplit = null;
    self.floatingSplit = null;
    self.activeLeaf = null;
    self.activeTabGroup = null;
    self.containerEl = null;
    self.layoutReady = false;
    self.requestSaveLayout = V().debounce(self.saveLayout.bind(self), 1e3);
    self.requestResize = V().debounce(self.onResize.bind(self), 0);
    self.requestActiveLeafEvents = V().debounce(self.activeLeafEvents.bind(self), 0);
    self.requestUpdateLayout = V().Cc(self.updateLayout);
    self.requestLayoutChangeEvents = V().debounce(function () {
      return self.layoutReady && self.trigger("layout-change");
    }, 10);
    self.mobileFileInfos = [];
    self.backlinkInDocument = false;
    self.lastTabGroupStacked = false;
    self.protocolHandlers = new Map();
    self.onLayoutReadyCallbacks = [];
    self.undoHistory = [];
    self.lastActiveFile = null;
    self._activeEditor = null;
    self.layoutItemQueue = [];
    self.handleXCallback = function (e, t) {
      if (!self.app.vault.getConfig("uriCallbacks")) return false;
      if (e.hasOwnProperty("x-success")) {
        let n = e["x-success"];
        const r = { name: t.basename, url: self.app.getObsidianUrl(t) };
        if (V().Yl.isDesktopApp && self.app.vault.adapter instanceof V().Eu)
          r.file = self.app.vault.adapter.getFilePath(t.path);
        try {
          n = V().ry.addQuery(n, r);
          if ("file:" === new URL(n).protocol.toLowerCase()) return true;
          window.open(n);
        } catch (err) {
          console.error(err);
        }
        return true;
      }
      return false;
    };
    self.hoverLinkSources = {};
    self.operatorFuncConfigs = {};
    self.editorExtensions = [];
    self.app = app;
    self.containerEl = containerEl;
    self.scope = new (V().Rg)(app.scope, function () {
      const e = self.activeLeaf;
      return e && e.view && e.view.scope ? e.view.scope : null;
    });
    self.recentFileTracker = new (V().B0)(self, app.vault);
    app.scope.register([], "Escape", function () {
      let e = null;
      const t = V().activeDocument.activeElement;
      if (
        self.activeLeaf &&
        self.activeLeaf.view instanceof host.MarkdownView &&
        "source" === self.activeLeaf.view.currentMode.type &&
        self.activeLeaf.view.titleEl !== t &&
        self.activeLeaf.view.inlineTitleEl !== t &&
        !V().yg(t) &&
        !self.activeLeaf.view.editor.hasFocus()
      )
        self.activeLeaf.view.editor.focus();
      if (!(self.activeLeaf && self.activeLeaf.view.navigation)) {
        if (self.activeLeaf)
          self.iterateLeaves(self.activeLeaf.getContainer(), function (t) {
            if (t.view.navigation && (!e || e.activeTime < t.activeTime)) e = t;
          });
        if (!e)
          self.iterateAllLeaves(function (t) {
            if (t.view.navigation && (!e || e.activeTime < t.activeTime)) e = t;
          });
        self.setActiveLeaf(e);
      }
    });
    app.keymap.pushScope(self.scope);
    self.leftRibbon = new (V().P0)(self, "left");
    self.rightRibbon = new (V().P0)(self, "right");
    self.leftSidebarToggleButtonEl = V().createDiv(
      "sidebar-toggle-button mod-left",
      function (e) {
        V().Sv(
          e,
          function () {
            return self.leftSplit.collapsed
              ? V().gm.interface.sidebarExpand()
              : V().gm.interface.sidebarCollapse();
          },
          { placement: "right" },
        );
        e.createDiv("clickable-icon", function (e) {
          return V().tv(e, "sidebar-toggle-button-icon");
        });
        e.addEventListener("click", function () {
          return self.leftSplit.toggle();
        });
        e.addEventListener("contextmenu", function (e) {
          V().Ug.forEvent(e)
            .addItem(function (e) {
              return e
                .setTitle(V().gm.interface.menu.leftSidebar())
                .setIcon("sidebar-left")
                .setChecked(!self.leftSplit.collapsed)
                .onClick(function () {
                  self.leftSplit.toggle();
                });
            })
            .addItem(function (e) {
              return e
                .setTitle(V().gm.interface.menu.ribbon())
                .setIcon("lucide-panel-left-close")
                .setChecked(self.app.vault.getConfig("showRibbon"))
                .onClick(function () {
                  const e = self.app.vault.getConfig("showRibbon");
                  self.app.vault.setConfig("showRibbon", !e);
                });
            });
        });
      },
    );
    self.rightSidebarToggleButtonEl = V().createDiv(
      "sidebar-toggle-button mod-right",
      function (e) {
        V().Sv(
          e,
          function () {
            return self.rightSplit.collapsed
              ? V().gm.interface.sidebarExpand()
              : V().gm.interface.sidebarCollapse();
          },
          { placement: "left" },
        );
        e.createDiv("clickable-icon", function (e) {
          return V().tv(e, "sidebar-toggle-button-icon");
        });
        e.addEventListener("click", function () {
          return self.rightSplit.toggle();
        });
        e.addEventListener("contextmenu", function (e) {
          V().Ug.forEvent(e).addItem(function (e) {
            return e
              .setTitle(V().gm.interface.menu.rightSidebar())
              .setIcon("sidebar-right")
              .setChecked(!self.rightSplit.collapsed)
              .onClick(function () {
                self.rightSplit.toggle();
              });
          });
        });
      },
    );
    self.editorSuggest = new (V().f0)(app);
    window.addEventListener("resize", self.requestResize.bind(self));
    window.addEventListener("popstate", function (e) {
      V().jg();
      e.preventDefault();
    });
    window.history.forward = function () {
      const e = self.activeLeaf;
      return e == null ? void 0 : e.history.forward();
    };
    window.history.back = function () {
      const e = self.activeLeaf;
      return e == null ? void 0 : e.history.back();
    };
    window.history.go = function (e) {
      const t = self.activeLeaf;
      return t == null ? void 0 : t.history.go(e);
    };
    if (!V().Yl.isLinux)
      window.addEventListener(
        "mousedown",
        function (e) {
          if (e.button === 3 || e.button === 4) {
            e.preventDefault();
            e.stopPropagation();
            if (e.button === 3) window.history.back();
            else window.history.forward();
          }
        },
        { capture: true },
      );
    if (V().Yl.isDesktopApp) {
      window.addEventListener("focus", function () {
        V().activeWindow = window;
        V().activeDocument = document;
        if (self.rootSplit) self.rootSplit.onFocus();
      });
      window.addEventListener("fullscreenchange", function () {
        return self.updateFrameless();
      });
    }
    window.addEventListener("copy", function (e) {
      if (!e.defaultPrevented && e.isTrusted) {
        const t = V().activeDocument.activeElement;
        if (
          self.activeLeaf &&
          !V().yg(t) &&
          (self.activeLeaf.view.handleCopy(e), e.defaultPrevented)
        )
          return;
        if (t !== V().activeDocument.body)
          t.dispatchEvent(
            new ClipboardEvent("copy", { bubbles: true, cancelable: true }),
          );
      }
    });
    window.addEventListener("paste", function (e) {
      if (e.defaultPrevented) return;
      if (!self.activeLeaf) return;
      if (V().yg(V().activeDocument.activeElement)) return;
      self.activeLeaf.view.handlePaste(e);
    });
    window.addEventListener("cut", function (e) {
      if (e.defaultPrevented) return;
      if (!self.activeLeaf) return;
      if (V().yg(V().activeDocument.activeElement)) return;
      self.activeLeaf.view.handleCut(e);
    });
    if (V().Yl.isIosApp) {
      const r = function (e) {
        if (e.scrollTop !== 0) {
          e.scroll({ top: 0, left: 0, behavior: "smooth" });
          return true;
        }
        return undefined;
      };
      window.addEventListener("statusTap", function () {
        const els = document.querySelectorAll(".modal-container");
        if (els.length) {
          V().rg(els[els.length - 1], r);
        } else {
          const t = self;
          const n = t.activeLeaf;
          const o = t.leftSplit;
          const a = t.rightSplit;
          if (o instanceof V().WD && !o.collapsed && !o.isPinned) {
            V().rg(o.containerEl, r);
          } else if (a instanceof V().WD && !a.collapsed && !a.isPinned) {
            V().rg(a.containerEl, r);
          } else if (n) {
            if (n.view instanceof host.MarkdownView)
              return void n.view.setEphemeralState({ scroll: 0 });
            V().rg(n.containerEl, r);
          }
        }
      });
    }
    app.vault.on("rename", function (e, t) {
      let n;
      if (e instanceof V().$T) {
        const fixState = function (n) {
          const i = n.state.state;
          if (i != null && i.file === t) {
            n.title = e.basename;
            n.state.state.file = e.path;
          }
        };
        const fixHistory = function (e) {
          for (let t = 0; t < e.backHistory.length; t++) fixState(e.backHistory[t]);
          for (let o = 0; o < e.forwardHistory.length; o++) fixState(e.forwardHistory[o]);
        };
        self.iterateAllLeaves(function (e) {
          fixHistory(e.history);
        });
        for (let a = 0; a < self.undoHistory.length; a++) {
          const l = self.undoHistory[a];
          const st = l.state.state;
          if (st != null && st.file === t) l.state.state.file = e.path;
          fixHistory(l.leafHistory);
        }
      }
    });
    const reopenDeferred = function (e) {
      for (const leaf of self.getLeavesOfType(e)) {
        if (leaf.view instanceof V().eD) continue;
        const state = leaf.getViewState();
        (async () => {
          await leaf.open(new (V().tD)(leaf));
          await leaf.setViewState(state);
        })();
      }
    };
    app.viewRegistry.on("view-registered", reopenDeferred);
    app.viewRegistry.on("view-unregistered", reopenDeferred);
    self.on("file-menu", function (e, n, r, o) {
      e.setSectionSubmenu("info.copy", {
        title: V().gm.interface.menu.copyPath(),
        icon: "lucide-clipboard",
      });
      if (n instanceof V().$T) {
        e.addItem(function (e) {
          return e
            .setSection("info.copy")
            .setTitle(V().gm.interface.menu.copyObsidianUrl())
            .setIcon("lucide-link")
            .onClick(function () {
              return self.app.copyObsidianUrl(n);
            });
        });
        e.addItem(function (e) {
          return e
            .setSection("system")
            .setTitle(
              V().Yl.isMobileApp
                ? V().gm.plugins.openWithDefaultApp.actionOpenFileMobile()
                : V().gm.plugins.openWithDefaultApp.actionOpenFile(),
            )
            .setIcon("lucide-arrow-up-right")
            .onClick(function () {
              return self.app.openWithDefaultApp(n.path);
            });
        });
      }
      if (!(n instanceof V().ZT && n.isRoot())) {
        e.addItem(function (e) {
          return e
            .setSection("action")
            .setTitle(
              n instanceof V().$T
                ? V().gm.plugins.fileExplorer.actionMoveFile()
                : V().gm.plugins.fileExplorer.actionMoveFolder(),
            )
            .setIcon("lucide-folder-tree")
            .onClick(function () {
              new (V().g0)(self.app, [n]).open();
            });
        }).addItem(function (e) {
          return e
            .setSection("info.copy")
            .setTitle(V().gm.interface.menu.copyVaultPath())
            .setIcon("vault")
            .onClick(function () {
              V().Ec(V().pu(n.path));
              new (V().fb)(V().gm.interface.copied({ context: "generic" }));
            });
        });
        if (V().Yl.isDesktopApp && app.vault.adapter instanceof V().Eu) {
          const a = app.vault.adapter.getFullPath(n.path);
          e.addItem(function (e) {
            return e
              .setSection("info.copy")
              .setTitle(V().gm.interface.menu.copyFullPath())
              .setIcon("lucide-hard-drive")
              .onClick(function () {
                V().Ec(a);
                new (V().fb)(V().gm.interface.copied({ context: "generic" }));
              });
          }).addItem(function (e) {
            return e
              .setSection("system")
              .setTitle(
                V().Yl.isMacOS
                  ? V().gm.plugins.openWithDefaultApp.actionShowInFolderMac()
                  : V().gm.plugins.openWithDefaultApp.actionShowInFolder(),
              )
              .setIcon("lucide-arrow-up-right")
              .onClick(function () {
                return self.app.showInFolder(n.path);
              });
          });
        }
      }
      if (V().Yl.canPopoutWindow && n instanceof V().$T)
        e.addItem(function (e) {
          return e
            .setSection("open")
            .setTitle(V().gm.interface.menu.openInNewWindow())
            .setIcon("lucide-picture-in-picture-2")
            .onClick(async function () {
              await self.app.workspace.openPopoutLeaf().openFile(n);
            });
        });
    });
    self.on("files-menu", function (e, t) {
      return e.addItem(function (e) {
        return e
          .setSection("action")
          .setTitle(
            V().gm.plugins.fileExplorer.actionMoveItems({ count: t.length }),
          )
          .setIcon("lucide-folder-tree")
          .onClick(function () {
            new (V().g0)(self.app, t).open();
          });
      });
    });
    self.on("markdown-viewport-menu", function (e, n, i, r) {
      const o = app.vault;
      const a = o.getConfig("readableLineLength");
      const s = o.getConfig("showLineNumber");
      const l = o.getConfig("showInlineTitle");
      e.addItem(function (e) {
        return e
          .setSection("view")
          .setTitle(V().gm.setting.editor.optionReadableLineLength())
          .setIcon("lucide-ruler")
          .setChecked(a)
          .onClick(function () {
            return o.setConfig("readableLineLength", !a);
          });
      });
      if (i === "source")
        e.addItem(function (e) {
          return e
            .setSection("view")
            .setTitle(V().gm.menuItems.lineNumbers())
            .setIcon("lucide-list-ordered")
            .setChecked(s)
            .onClick(function () {
              return o.setConfig("showLineNumber", !s);
            });
        });
      e.addItem(function (e) {
        return e
          .setSection("view")
          .setTitle(V().gm.menuItems.inlineTitle())
          .setIcon("lucide-text-initial")
          .setChecked(l)
          .onClick(function () {
            return o.setConfig("showInlineTitle", !l);
          });
      });
    });
    const collectPendingSaves = function () {
      const e = [];
      let t = false;
      self.iterateAllLeaves(function (n) {
        const i = n.view;
        if (i instanceof V().BX) {
          if (i.saving) t = true;
          if (i.data !== i.lastSavedData) e.push(i.save());
        }
      });
      if (t) e.push(self.app.vault.adapter.promise);
      return e;
    };
    self.on("quit", function (e) {
      self.requestSaveLayout.cancel();
      self.app.vault.requestSaveConfig.run();
      for (const r of collectPendingSaves()) e.addPromise(r);
    });
    if (V().Yl.isMobileApp && V().xm)
      V().xm.addListener("appStateChange", function (e) {
        if (self.layoutReady && !e.isActive) collectPendingSaves();
      });
    self.on("editor-menu", function (e, t, n) {
      const r = n.file;
      if (r) {
        const o = t.getCursor();
        const a = V().tE(t.getLine(o.line));
        if (a !== null)
          e.addItem(function (e) {
            return e
              .setTitle(V().gm.interface.menu.renameHeading())
              .setIcon("lucide-edit-3")
              .setSection("action")
              .onClick(function () {
                const e = n.file;
                if (r === e || V().oP(o, t.getCursor())) {
                  const s = n instanceof V().lJ ? n.before.length : 0;
                  const l = t.cm.state;
                  const c = l.doc;
                  const u = l.selection;
                  const h = c.lineAt(u.main.from);
                  const p = { start: h.from + s, end: h.to + s };
                  new (V().pI)(self.app, t, r, p, a).open();
                }
              });
          });
      }
    });
    self.on("editor-menu", function (e, t, n) {
      const r = n.file;
      if (r) {
        const o = t.getCursor();
        const a = t.getClickableTokenAt(o);
        if (a && a.type === "blockid")
          e.addItem(function (e) {
            return e
              .setTitle(V().gm.interface.menu.renameBlockid())
              .setSection("selection")
              .setIcon("lucide-edit-3")
              .onClick(function () {
                if (r === n.file || V().oP(o, t.getCursor())) {
                  const e = n instanceof V().lJ ? n.before.length : 0;
                  const s = {
                    start: t.posToOffset(a.start) + e,
                    end: t.posToOffset(a.end) + e,
                  };
                  new (V().dI)(self.app, t, r, s, a).open();
                }
              });
          });
      }
    });
    const s = self.app.commands;
    s.addCommand({
      id: "editor:save-file",
      name: V().gm.commands.saveFile(),
      checkCallback: function (e) {
        const t = self.app.workspace.getActiveViewOfType(V().BX);
        if (t) {
          if (!e) t.save();
          return true;
        }
        return undefined;
      },
      hotkeys: [V().Fb(["Mod"], "S")],
    });
    s.addCommand({
      id: "editor:download-attachments",
      name: V().gm.commands.downloadAttachments(),
      checkCallback: function (e) {
        const t = self.app.workspace.getActiveFile();
        if (t && t.extension === "md") {
          if (!e) self.app.fileManager.downloadAttachmentsForNote(t);
          return true;
        }
        return undefined;
      },
    });
    s.addCommand({
      id: "editor:follow-link",
      name: V().gm.commands.followCursorLink(),
      icon: "lucide-link",
      checkCallback: function (e) {
        const t = self.activeEditor;
        if (t && t.editor) {
          const n = t.editor;
          const r = t.editMode;
          const o = n.getClickableTokenAt(n.getCursor());
          if (o) {
            if (!e) r.triggerClickableToken(o, false);
            return true;
          }
        }
        if (!e) {
          const a = V().activeDocument.activeElement;
          if (a !== V().activeDocument.body)
            a.dispatchEvent(
              new CustomEvent("open-link", {
                bubbles: true,
                cancelable: true,
                detail: { paneType: false },
              }),
            );
        }
        return undefined;
      },
      hotkeys: [V().Fb(["Alt"], "Enter")],
    });
    s.addCommand({
      id: "editor:open-link-in-new-leaf",
      name: V().gm.commands.openCursorLinkInNewTab(),
      icon: "lucide-link",
      checkCallback: function (e) {
        if (self.activeEditor) {
          const t = self.activeEditor;
          const n = t.editor;
          const r = t.editMode;
          if (n) {
            const o = n.getClickableTokenAt(n.getCursor());
            if (o) {
              if (!e) r.triggerClickableToken(o, "tab");
              return true;
            }
          }
        }
        if (!e) {
          const a = V().activeDocument.activeElement;
          if (a !== V().activeDocument.body)
            a.dispatchEvent(
              new CustomEvent("open-link", {
                bubbles: true,
                cancelable: true,
                detail: { paneType: "tab" },
              }),
            );
        }
        return undefined;
      },
      hotkeys: [V().Fb(["Mod"], "Enter")],
    });
    if (V().Yl.canPopoutWindow)
      s.addCommand({
        id: "editor:open-link-in-new-window",
        name: V().gm.commands.openCursorLinkInNewWindow(),
        icon: "lucide-link",
        checkCallback: function (e) {
          if (self.activeEditor) {
            const t = self.activeEditor;
            const n = t.editor;
            const r = t.editMode;
            if (n) {
              const o = n.getClickableTokenAt(n.getCursor());
              if (o) {
                if (!e) r.triggerClickableToken(o, "window");
                return true;
              }
            }
          }
          if (!e) {
            const a = V().activeDocument.activeElement;
            if (a !== V().activeDocument.body)
              a.dispatchEvent(
                new CustomEvent("open-link", {
                  bubbles: true,
                  cancelable: true,
                  detail: { paneType: "window" },
                }),
              );
          }
          return undefined;
        },
        hotkeys: [V().Fb(["Mod", "Alt", "Shift"], "Enter")],
      });
    s.addCommand({
      id: "workspace:toggle-pin",
      name: V().gm.commands.togglePin(),
      icon: "lucide-pin",
      checkCallback: function (e) {
        const t = self.activeLeaf;
        if (!(t && t.view instanceof host.ItemView && !(t.view instanceof V().tD))) {
          return undefined;
        }
        if (!e) t.togglePinned();
        return true;
      },
    });
    if (V().Yl.canSplit) {
      s.addCommand({
        id: "editor:open-link-in-new-split",
        name: V().gm.commands.openCursorLinkToTheRight(),
        icon: "lucide-link",
        checkCallback: function (e) {
          if (self.activeEditor) {
            const t = self.activeEditor;
            const n = t.editor;
            const r = t.editMode;
            if (n) {
              const o = n.getClickableTokenAt(n.getCursor());
              if (o) {
                if (!e) r.triggerClickableToken(o, "split");
                return true;
              }
            }
          }
          if (!e)
            V().activeDocument.activeElement.dispatchEvent(
              new CustomEvent("open-link", {
                bubbles: true,
                cancelable: true,
                detail: { paneType: "split" },
              }),
            );
          return undefined;
        },
        hotkeys: [V().Fb(["Mod", "Alt"], "Enter")],
      });
      const focusDir = function (e, t) {
        s.addCommand({
          id: "editor:focus-" + e,
          name: t,
          checkCallback: function (t) {
            const n = self.getAdjacentLeafInDirection(self.activeLeaf, e);
            if (n) {
              if (!t) {
                V().Lv();
                self.setActiveLeaf(n, { focus: true });
              }
              return true;
            }
            return undefined;
          },
        });
      };
      focusDir("top", V().gm.commands.navigateTabAbove());
      focusDir("bottom", V().gm.commands.navigateTabBelow());
      focusDir("left", V().gm.commands.navigateTabLeft());
      focusDir("right", V().gm.commands.navigateTabRight());
      s.addCommand({
        id: "workspace:split-vertical",
        name: V().gm.commands.splitRight(),
        icon: "lucide-separator-vertical",
        checkCallback: function (e) {
          const t = self.activeLeaf;
          if (!(t && t.view instanceof host.ItemView && !self.isInSidebar(t))) {
            return undefined;
          }
          if (!e) self.duplicateLeaf(self.activeLeaf, "vertical");
          return true;
        },
      });
      s.addCommand({
        id: "workspace:split-horizontal",
        name: V().gm.commands.splitDown(),
        icon: "lucide-separator-horizontal",
        checkCallback: function (e) {
          const t = self.activeLeaf;
          if (!(t && t.view instanceof host.ItemView)) return undefined;
          if (!e) self.duplicateLeaf(self.activeLeaf, "horizontal");
          return true;
        },
      });
    }
    if (V().Yl.canStackTabs)
      s.addCommand({
        id: "workspace:toggle-stacked-tabs",
        name: V().gm.commands.toggleStackedTabs(),
        icon: "lucide-layers",
        checkCallback: function (e) {
          const t = self.activeLeaf.parent;
          if (t instanceof V().zD) {
            const n = t.getRoot();
            if (n === self.leftSplit || n === self.rightSplit) return undefined;
            if (!e) t.setStacked(!t.isStacked);
            return true;
          }
          return undefined;
        },
      });
    s.addCommand({
      id: "workspace:edit-file-title",
      name: V().gm.commands.editFileTitle(),
      icon: "lucide-edit-3",
      checkCallback: function (e) {
        const t = self.getActiveFileView();
        if (t && t instanceof V().OX) {
          if (!e) t.leaf.setEphemeralState({ rename: "all" });
          return true;
        }
        return undefined;
      },
      hotkeys: [V().Fb([], "F2")],
    });
    s.addCommand({
      id: "workspace:copy-path",
      name: V().gm.commands.copyPath(),
      icon: "lucide-copy",
      checkCallback: function (e) {
        const t = self.getActiveFile();
        if (t) {
          if (!e) {
            V().Ec(t.path);
            new (V().fb)(V().gm.interface.copied({ context: "generic" }));
          }
          return true;
        }
        return undefined;
      },
    });
    if (V().Yl.isDesktopApp)
      s.addCommand({
        id: "workspace:copy-full-path",
        name: V().gm.commands.copyFullPath(),
        icon: "lucide-hard-drive",
        checkCallback: function (e) {
          if (app.vault.adapter instanceof V().Eu) {
            const n = self.getActiveFile();
            if (n) {
              const r = app.vault.adapter.getFullPath(n.path);
              if (!e) {
                V().Ec(r);
                new (V().fb)(V().gm.interface.copied({ context: "generic" }));
              }
              return true;
            }
          }
          return undefined;
        },
      });
    s.addCommand({
      id: "workspace:copy-url",
      name: V().gm.commands.copyUrl(),
      icon: "lucide-vault",
      checkCallback: function (e) {
        const t = self.getActiveFile();
        if (t) {
          if (!e) self.app.copyObsidianUrl(t);
          return true;
        }
        return undefined;
      },
    });
    s.addCommand({
      id: "workspace:undo-close-pane",
      name: V().gm.commands.undoCloseTab(),
      icon: "lucide-undo-2",
      checkCallback: function (e) {
        const t = self.undoHistory;
        if (t.length > 0) {
          if (!e) {
            const n = t.shift();
            let r = self.activeLeaf;
            let o = self.rootSplit;
            if (n.rootId)
              o = [
                self.rootSplit,
                self.floatingSplit,
                self.leftSplit,
                self.rightSplit,
              ].find(function (e) {
                return e.id === n.rootId;
              });
            if (n.parentId) {
              let a = null;
              self.iterateTabs([o], function (e) {
                if (e.id === n.parentId) a = e;
              });
              if (a) r = self.createLeafInTabGroup(a);
            }
            if (!(r && r.view.getViewType() === "empty")) {
              r =
                o === self.floatingSplit
                  ? self.openPopoutLeaf()
                  : V().Yl.isMobile
                    ? self.createLeafInTabGroup()
                    : self.splitActiveLeaf();
              if (n.parentId) r.parent.id = n.parentId;
            }
            if (n.leafId) r.id = n.leafId;
            n.state.active = true;
            if (n.leafHistory) r.history.deserialize(n.leafHistory);
            r.setViewState(n.state, n.eState);
          }
          return true;
        }
        return undefined;
      },
      hotkeys: [V().Fb(["Mod", "Shift"], "T")],
    });
    if (V().Yl.canExportPdf)
      s.addCommand({
        id: "workspace:export-pdf",
        name: V().gm.commands.exportPdf(),
        checkCallback: function (e) {
          const t = self.getActiveViewOfType(host.MarkdownView);
          if (t) {
            if (!e) t.printToPdf();
            return true;
          }
          return undefined;
        },
      });
    s.addCommand({
      id: "editor:rename-heading",
      name: V().gm.interface.menu.renameHeading(),
      icon: "lucide-edit-3",
      editorCheckCallback: function (e, t, n) {
        const r = n.file;
        if (r) {
          const o = t.getCursor();
          const a = V().tE(t.getLine(o.line));
          if (a) {
            if (!e) {
              const s = n instanceof V().lJ ? n.before.length : 0;
              const l = t.cm.state;
              const c = l.doc;
              const u = l.selection;
              const h = c.lineAt(u.main.from);
              const p = { start: h.from + s, end: h.to + s };
              new (V().pI)(self.app, t, r, p, a).open();
            }
            return true;
          }
        }
        return undefined;
      },
    });
    if (V().Yl.canPopoutWindow) {
      s.addCommand({
        id: "workspace:open-in-new-window",
        name: V().gm.commands.openInNewWindow(),
        icon: "lucide-maximize",
        checkCallback: function (e) {
          const t = self.activeLeaf;
          if (t && t.view instanceof host.ItemView) {
            if (!e)
              self
                .openPopoutLeaf()
                .setViewState(t.getViewState(), { focus: true });
            return true;
          }
          return undefined;
        },
      });
      s.addCommand({
        id: "workspace:move-to-new-window",
        name: V().gm.commands.moveToNewWindow(),
        icon: "lucide-maximize",
        checkCallback: function (e) {
          const t = self.activeLeaf;
          if (t && t.view instanceof host.ItemView) {
            if (!e) self.moveLeafToPopout(t);
            return true;
          }
          return undefined;
        },
      });
    }
    s.addCommand({
      id: "workspace:next-tab",
      name: V().gm.commands.goToNextTab(),
      icon: "lucide-arrow-right",
      checkCallback: function (e) {
        const t = self.activeLeaf;
        if (t && t.parent instanceof V().zD) {
          if (!e) {
            const n = t.parent;
            let r = n.currentTab + 1;
            if (r >= n.children.length) r = 0;
            n.selectTabIndex(r);
            const o = n.children[r];
            if (o instanceof V().jD) self.setActiveLeaf(o, { focus: true });
          }
          return true;
        }
        return undefined;
      },
      hotkeys: [
        V().Fb(["Ctrl"], "Tab"),
        V().Yl.isMacOS ? V().Fb(["Meta", "Shift"], "]") : V().Fb(["Ctrl"], "PageDown"),
      ],
    });
    const gotoTab = function (e) {
      s.addCommand({
        id: "workspace:goto-tab-".concat(e),
        name: V().gm.commands.goToNthTab({ n: e }),
        checkCallback: function (t) {
          if (V().Yl.isPhone) return false;
          const n = self.activeLeaf;
          if (n && n.parent instanceof V().zD) {
            const r = n.parent.children[e - 1];
            if (r) {
              if (!t) self.setActiveLeaf(r, { focus: true });
              return true;
            }
          }
          return false;
        },
        hotkeys: [V().Fb(["Mod"], String(e))],
      });
    };
    for (const e of [1, 2, 3, 4, 5, 6, 7, 8]) gotoTab(e);
    s.addCommand({
      id: "workspace:goto-last-tab",
      name: V().gm.commands.goToLastTab(),
      checkCallback: function (e) {
        const t = self.activeLeaf;
        if (t && t.parent instanceof V().zD) {
          const n = t.parent;
          const r = n.children.length - 1;
          const o = n.children[r];
          if (o) {
            if (!e) self.setActiveLeaf(o, { focus: true });
            return true;
          }
        }
        return false;
      },
      hotkeys: [V().Fb(["Mod"], "9")],
    });
    s.addCommand({
      id: "workspace:previous-tab",
      name: V().gm.commands.goToPrevTab(),
      icon: "lucide-arrow-left",
      checkCallback: function (e) {
        const t = self.activeLeaf;
        if (t && t.parent instanceof V().zD) {
          if (!e) {
            const n = t.parent;
            let r = n.currentTab - 1;
            if (r < 0) r = n.children.length - 1;
            n.selectTabIndex(r);
            const o = n.children[r];
            if (o instanceof V().jD) self.setActiveLeaf(o, { focus: true });
          }
          return true;
        }
        return undefined;
      },
      hotkeys: [
        V().Fb(["Ctrl", "Shift"], "Tab"),
        V().Yl.isMacOS ? V().Fb(["Meta", "Shift"], "[") : V().Fb(["Ctrl"], "PageUp"),
      ],
    });
    s.addCommand({
      id: "workspace:new-tab",
      name: V().gm.commands.newTab(),
      checkCallback: function (e) {
        const t = self.getMostRecentLeaf();
        if (t && t.parent instanceof V().zD) {
          if (!e) {
            const n = t.parent;
            const r = new (V().jD)(self.app);
            const o = n.children.length;
            n.insertChild(o, r);
            n.selectTabIndex(o);
            self.setActiveLeaf(r, { focus: true });
          }
          return true;
        }
        return undefined;
      },
      hotkeys: [V().Fb(["Mod"], "T")],
    });
    if (V().Yl.canPopoutWindow)
      s.addCommand({
        id: "workspace:new-window",
        name: V().gm.commands.newWindow(),
        callback: function () {
          const e = self.openPopoutLeaf();
          self.setActiveLeaf(e, { focus: true });
        },
      });
    s.addCommand({
      id: "workspace:close",
      name: V().gm.commands.closeActiveTab(),
      icon: "lucide-x",
      checkCallback: function (e) {
        let t = self.activeLeaf;
        if (t && self.isInSidebar(t) && !(t.view instanceof host.ItemView))
          t = self.getMostRecentLeaf(self.rootSplit);
        if (t) {
          if (!e) {
            if (!V().Yl.isPhone && t.pinned) t.setPinned(false);
            else t.detach();
          }
          return true;
        }
        return undefined;
      },
      hotkeys: [V().Fb(["Mod"], "W")],
    });
    if (V().Yl.canPopoutWindow)
      s.addCommand({
        id: "workspace:close-window",
        name: V().gm.interface.window.closeWindow(),
        icon: "lucide-x",
        callback: function () {
          V().activeWindow.close();
        },
        hotkeys: [V().Fb(["Mod", "Shift"], "W")],
      });
    s.addCommand({
      id: "workspace:close-others",
      name: V().gm.commands.closeOtherTabs(),
      icon: "lucide-x",
      checkCallback: function (e) {
        const t = self.activeLeaf;
        const n = [];
        self.iterateLeaves(t.getContainer(), function (e) {
          if (e === t || e.pinned) return;
          n.push(e);
        });
        if (!e) for (const r of n) r.detach();
        return n.length > 0;
      },
    });
    s.addCommand({
      id: "workspace:close-tab-group",
      name: V().gm.commands.closeTabGroup(),
      icon: "lucide-x",
      checkCallback: function (e) {
        if (V().Yl.canSplit) {
          const t = self.activeLeaf;
          if (t && !self.isInSidebar(t)) {
            if (!e)
              for (const o of t.parent.children.slice()) {
                if (!o.pinned) o.detach();
              }
            return true;
          }
        }
        return undefined;
      },
    });
    s.addCommand({
      id: "workspace:close-others-tab-group",
      name: V().gm.commands.closeOthersInTabGroup(),
      icon: "lucide-x",
      checkCallback: function (e) {
        if (V().Yl.canSplit) {
          const t = self.activeLeaf;
          if (t && !self.isInSidebar(t) && t.parent.children.length > 1) {
            if (!e)
              for (const o of t.parent.children.slice()) {
                if (o !== t && !o.pinned) o.detach();
              }
            return true;
          }
        }
        return undefined;
      },
    });
    if (V().Yl.isDesktopApp)
      s.addCommand({
        id: "workspace:show-trash",
        name: V().gm.commands.showTrash(),
        checkCallback: function (e) {
          if (app.vault.getConfig("trashOption") === "local") {
            if (!e) app.showInFolder(".trash");
            return true;
          }
          return undefined;
        },
      });
    self.registerObsidianProtocolHandler("open", function (e) {
      if (e.file) {
        const t = V().MT(e.file);
        let n = t.path;
        const r = t.subpath;
        n = V().cu(n);
        const o = self.app.metadataCache.getFirstLinkpathDest(n, "");
        if (o) {
          const a = self.getLeaf(V().R0(e.paneType));
          const s = {};
          if (r) s.subpath = r;
          a.openFile(o, { active: true, eState: s });
          new (V().fb)(V().gm.interface.msgOpenFileThroughUri({ path: o.path }));
        } else {
          new (V().fb)(V().gm.interface.msgFileNotFoundThroughUri({ name: e.file }));
        }
      }
    });
    self.registerObsidianProtocolHandler("search", function (e) {
      const t = self.app.internalPlugins.getEnabledPluginById("global-search");
      if (t) t.openGlobalSearch(e.query);
    });
    self.registerObsidianProtocolHandler("new", async (e) => {
      const n = self.app;
      const i = n.vault;
      const r = n.fileManager;
      const o = n.metadataCache;
      const a = e.overwrite;
      const s = e.append || e.prepend || a;
      let t = null;
      let m;
      if (e.file) {
        const l = e.file;
        if (/\.\.[\/\\]/.test(l)) return;
        if (s) {
          t = o.getFirstLinkpathDest(l, "");
          if (!t) {
            const c = i.getAbstractFileByPathInsensitive(l);
            if (c instanceof V().$T) t = c;
          }
        }
        if (!t) {
          const u = V().iu(l);
          if (u === "") {
            m = i.getRoot();
          } else {
            m = i.getAbstractFileByPathInsensitive(u);
            if (!m) {
              await i.createFolder(u);
              m = i.getAbstractFileByPathInsensitive(u);
            }
          }
          if (!(m instanceof V().ZT)) return;
          try {
            t = await r.createNewFile(m, V().nu(l));
          } catch (h) {
            new (V().fb)(h.toString());
            return;
          }
        }
      } else {
        const p = (e.name || "").replace(/[\/\\]/, "");
        if (s) t = o.getFirstLinkpathDest(p, "");
        if (!t) {
          let d = "";
          const f = self.getActiveFile();
          if (f) d = f.path;
          m = r.getNewFileParent(d, p);
          try {
            t = await r.createNewFile(m, p);
          } catch (v) {
            new (V().fb)(v.toString());
            return;
          }
        }
      }
      if (!t) return;
      let g = e.content;
      if (e.clipboard) g = await navigator.clipboard.readText();
      if (g) {
        if (e.append || e.prepend)
          await r.insertIntoFile(t, g, e.prepend ? "prepend" : "append");
        else await i.modify(t, g);
      }
      if (!e.silent)
        await self
          .getLeaf(V().R0(e.paneType))
          .openFile(t, {
            active: true,
            state: { mode: "source" },
            eState: { rename: "all" },
          });
      self.handleXCallback(e, t);
    });
    self.registerObsidianProtocolHandler("show-plugin", function (e) {
      const t = self.app;
      if (!t.plugins.isEnabled()) {
        const n = t.setting;
        n.open();
        n.openTabById("community-plugins");
        return;
      }
      if (e.id)
        new (V().M0)(t).setAutoOpen(e.id).setDimBackground(true).open();
    });
    self.registerObsidianProtocolHandler("show-theme", function (e) {
      if (e.name)
        new (V().A0)(self.app, false)
          .setAutoOpen(e.name)
          .setDimBackground(true)
          .open();
    });
    self.registerObsidianProtocolHandler("show-release-notes", function (e) {
      if (e.version) self.app.showReleaseNotes(e.version);
    });
    self.registerObsidianProtocolHandler("debug-info", function (e) {
      new (V().m0)(self.app).open();
    });
    self.registerObsidianProtocolHandler("publish-sites", async () => {
      const e = self.app.internalPlugins.getPluginById("publish");
      if (!e.enabled) e.enable(false);
      await e.instance.viewSites();
    });
    self.registerObsidianProtocolHandler("sync-setup", function (e) {
      self.onLayoutReady(function () {
        if (e.vault) {
          const t = self.app.internalPlugins.getPluginById("sync");
          if (!t.enabled) t.enable(false);
          t.instance.connectToVault(JSON.parse(e.vault));
        } else {
          self.app.openVaultChooser();
        }
      });
    });
    self.registerObsidianProtocolHandler("vault-setup", async () => {
      const e = await self.app.vault.create(
        V().gm.interface.starterContent.welcomeFilename() + ".md",
        V().gm.interface.starterContent.welcomeFileContent(),
      );
      const t = self.getLeaf();
      const n = self.getLeaf("split");
      await n.setViewState({ type: V().wJ });
      if (n.view instanceof V().kJ) n.view.dataEngine.setOptions({ close: true });
      t.openFile(e, { active: true });
    });
    self.registerObsidianProtocolHandler("hook-get-address", function (e) {
      if (self.app.vault.getConfig("uriCallbacks")) {
        const t = self.getActiveFile();
        if (t) {
          if (!self.handleXCallback(e, t)) {
            const n = self.app.getObsidianUrl(t);
            V().Ec("[".concat(t.basename, "](").concat(n, ")"));
          }
        } else if (e.hasOwnProperty("x-error")) {
          window.open(
            V().ry.addQuery(e["x-error"], {
              errorCode: "NotFound",
              errorMessage: "No file is open at the moment",
            }),
          );
        }
      }
    });
    if (V().Em) {
      let p = 0;
      let d = null;
      V().xm.addListener("backButton", function () {
        let e;
        if (V().Hm.length > 0) {
          V().Hm.last().close();
        } else {
          const t = self.leftSplit;
          const n = self.rightSplit;
          if (t.collapsed || (t instanceof V().WD && t.isPinned)) {
            if (n.collapsed || (n instanceof V().WD && n.isPinned)) {
              const r =
                (e = self.activeLeaf) == null ? void 0 : e.history;
              if (r && r.backHistory.length > 0) {
                r.back();
              } else {
                const o = Date.now();
                if (o - p < 5e3) {
                  if (d) {
                    d.containerEl.detach();
                    d.hide();
                  }
                  V().xm.minimizeApp();
                } else {
                  p = o;
                  d = new (V().fb)(V().gm.interface.mobile.msgBackAgainToExit(), 0);
                  window.setTimeout(function () {
                    if (d) d.hide();
                    d = null;
                  }, 5e3);
                }
              }
            } else {
              n.collapse();
            }
          } else {
            t.collapse();
          }
        }
      });
    }
    host.onSwipe(self.containerEl, function (e) {
      self.trigger("swipe", e);
    });
    self.on("swipe", function (e) {
      if (
        self.layoutReady &&
        !(e.points > 1) &&
        e.direction === "y" &&
        e.y >= e.startY &&
        self.rootSplit.containerEl.contains(e.targetEl)
      ) {
        const n = self.app.vault.getConfig("mobilePullAction");
        if (n) {
          const r = self.app.commands.findCommand(n);
          const o = r ? r.name : "Configure pull action";
          const a = document.body.createDiv({
            cls: "pull-action pull-down-action",
            text: o,
          });
          a.onClickEvent(function () {
            a.detach();
          });
          const s = a.offsetHeight;
          let l = false;
          e.registerCallback({
            move: function (t, n) {
              let i = (n - e.startY) / s;
              i = Math.clamp(i, 0, 1);
              a.toggleClass("mod-activated", i === 1);
              a.style.transform = "translateY(".concat((i - 1) * s, "px)");
              if (i === 1 && !l) navigator.vibrate(100);
              l = i === 1;
            },
            cancel: function () {
              a.detach();
            },
            finish: function (e, n, i) {
              a.detach();
              if (!l) return;
              if (r) {
                V().K6(r);
              } else {
                new (V().fb)(
                  V().gm.setting.mobileToolbar.msgMissingQuickAction(),
                ).addButton(
                  V().gm.setting.mobileToolbar.buttonConfigure(),
                  function () {
                    app.commands.executeCommandById("mobile:quick-action");
                  },
                );
              }
            },
          });
        }
      }
    });
    self.on("swipe", function (e) {
      if (
        self.layoutReady &&
        e.points === 2 &&
        e.direction === "x" &&
        self.rootSplit.containerEl.contains(e.targetEl) &&
        (!V().Yl.isIosApp || !V().Yl.mobileSoftKeyboardVisible)
      ) {
        const t = e.x > e.startX;
        const n = t
          ? self.app.commands.findCommand("app:go-back")
          : self.app.commands.findCommand("app:go-forward");
        if (n) {
          const r = document.body.createDiv({
            cls: "pull-action pull-out-action",
            text: n.name,
          });
          r.onClickEvent(function () {
            r.detach();
          });
          if (t) r.style.left = "0";
          else r.style.right = "0";
          const o = t ? 1 : -1;
          const a = r.offsetWidth;
          const s = a / 90;
          let l = false;
          e.registerCallback({
            move: function (t) {
              const n = Math.clamp(((t - e.startX) * o) / 90, 0, 1);
              r.toggleClass("mod-activated", n === 1);
              r.style.transform = "translateX(".concat(
                90 * -(1 - n) * o * s,
                "px)",
              );
              if (n === 1 && !l) {
                navigator.vibrate(100);
                l = true;
              }
            },
            cancel: function () {
              r.detach();
            },
            finish: function (n, c, u) {
              const h = Math.clamp(((n - e.startX) * o) / 90, 0, 1);
              V().yl(
                r,
                new (V().dl)({ duration: 100 * h }).addProp(
                  "transform",
                  "translateX(".concat(90 * -(1 - h) * o * s, "px)"),
                  "translateX(".concat(a * s * -o, "px)"),
                  null,
                ),
                function () {
                  r.detach();
                },
              );
              if (l) {
                if (t) self.app.commands.executeCommandById("app:go-back");
                else self.app.commands.executeCommandById("app:go-forward");
              }
            },
          });
        }
      }
    });
    if (V().Yl.isIosApp)
      self.on("css-change", async () => {
        let e = V().Bk("--background-primary");
        if (!e || e.a === 0)
          e = V().Ak(getComputedStyle(document.body).backgroundColor);
        if (e)
          await V().xm.setBackgroundColor({
            r: e.r / 255,
            g: e.g / 255,
            b: e.b / 255,
          });
      });
    if (V().Yl.isMacOS)
      self.on("css-change", function () {
        const e = window.frameDom;
        if (e != null) e.requestUpdateStatus();
        if (self.floatingSplit) {
          for (const o of self.floatingSplit.children) {
            if (o instanceof V().O0) {
              const t = o.win.frameDom;
              if (t != null) t.requestUpdateStatus();
            }
          }
        }
      });
    self.registerHoverLinkSource("search", {
      display: V().gm.plugins.pagePreview.labelSourceSearch(),
      defaultMod: true,
    });
    self.registerHoverLinkSource("preview", {
      display: V().gm.plugins.pagePreview.labelSourcePreview(),
      defaultMod: false,
    });
    self.registerHoverLinkSource("editor", {
      display: V().gm.plugins.pagePreview.labelSourceEditor(),
      defaultMod: true,
    });
    self.registerHoverLinkSource("tab-header", {
      display: V().gm.plugins.pagePreview.labelSourceTabHeader(),
      defaultMod: true,
    });
    const f = host.codeMirrorCompat.getMode;
    const CodeMirror = host.codeMirrorCompat;
    CodeMirror.getMode = function (e, t) {
      const n = f.call(CodeMirror, e, t);
      if (!t || (n && n.name !== "null")) return n;
      CodeMirror.getMode = f;
      V().fz.then(function () {
        const leaves = self.getLeavesOfType(host.MarkdownView.VIEW_TYPE);
        for (let e = 0; e < leaves.length; e++) {
          const n = leaves[e];
          if (n.view instanceof host.MarkdownView)
            n.view.editMode.resetSyntaxHighlighting();
        }
      });
      return n;
    };
    return self;
  }

  inherit(Workspace, env().VT);
  for (const name of Object.keys(S48_METHODS))
    Workspace.prototype[name] = S48_METHODS[name];
  Object.defineProperty(Workspace.prototype, "initialized", {
    get: function () {
      return !!this.rootSplit;
    },
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(Workspace.prototype, "activeEditor", {
    get: function () {
      const e = this._activeEditor;
      return e != null ? e : this.getActiveViewOfType(host.MarkdownView);
    },
    set: function (e) {
      if (!(e instanceof host.MarkdownView)) this._activeEditor = e;
    },
    enumerable: false,
    configurable: true,
  });
  return Workspace;
}
