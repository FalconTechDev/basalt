// Drag and drop: the manager that turns drags into ghost elements, tracks the hovered drop target and
// routes the drop to the handlers that views registered. Also the small dataTransfer helpers that the
// rest of the app uses to write drag payloads (files, folders, links, plain text).

/** Maps DataTransfer.effectAllowed to the drop effects the source allows; "none" allows everything. */
export const dragEffectMap = {
  none: [],
  copy: ["copy"],
  copyLink: ["copy", "link"],
  copyMove: ["copy", "move"],
  link: ["link"],
  linkMove: ["link", "move"],
  move: ["move"],
  all: ["copy", "link", "move"],
  uninitialized: [],
};

/** The 1x1 transparent gif used as the drag image; the inherited declarator assigns its src. */
export const dragPixel = new Image();

/** Writes `uri` as both text/plain and text/uri-list so drops inside and outside the app both work. */
export function setDragUriData(dataTransfer, uri) {
  dataTransfer.setData("text/plain", uri);
  dataTransfer.setData("text/uri-list", uri);
}

/** Writes `text` as text/plain only. */
export function setDragPlainData(dataTransfer, text) {
  dataTransfer.setData("text/plain", text);
}

/** True when `effect` is one the drag source's effectAllowed permits; "none" as target always passes. */
function dropEffectAllowed(evt, effect) {
  if (effect === "none") return true;
  const allowed = dragEffectMap[evt.dataTransfer.effectAllowed];
  return !!allowed && allowed.includes(effect);
}

/** Sets dataTransfer.dropEffect to `effect` when the source allows it. */
export function applyDropEffect(evt, effect) {
  if (effect && dropEffectAllowed(evt, effect)) evt.dataTransfer.dropEffect = effect;
}

/**
 * Swallows the next `type` event on `el`: a capture listener that prevents, stops and
 * stop-immediate-propagations it, removed on the next task. Used to eat the contextmenu or
 * click that a touch sequence would otherwise produce after a drag.
 */
export function suppressNextEvent(el, type) {
  const win = el.win;
  const swallow = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };
  const timer = win.setTimeout(() => {
    el.removeEventListener(type, swallow, { capture: true });
    win.clearTimeout(timer);
  }, 0);
  el.addEventListener(type, swallow, { capture: true });
}

/** Gives the drag a tiny transparent drag image so the ghost element is the only thing following the pointer. */
export function setDragImage(evt) {
  evt.doc.body.append(dragPixel);
  evt.dataTransfer.setDragImage(dragPixel, 0, 0);
  setTimeout(() => dragPixel.detach(), 0);
}

export function defineDragManager(host) {
  /**
   * App-wide drag and drop coordinator. Views call handleDrag/handleDrop on their elements and
   * dragFile/dragFolder/dragFiles/dragLink to start drags; everything else is driven by the window
   * listeners installed in the constructor.
   */
  function DragManager(app) {
    this.app = app;
    this.ghostEl = null;
    this.actionEl = null;
    this.draggable = null;
    this.sourceEls = null;
    this.sourceClass = "";
    this.hoverEl = null;
    this.hoverClass = "";
    this.overlayEl = createDiv("workspace-drop-overlay");
    this.shouldHideOverlay = false;
    this.isDragOverHandled = false;
    this.dragStart = null;
    this.onTouchEnd = (e) => {
      if (e.touches.length === 0) this.onDragEnd();
    };
    window.addEventListener("dragstart", this.onDragStartGlobal.bind(this));
    window.addEventListener("dragover", this.onDragOverFirst.bind(this), { capture: true });
    window.addEventListener("dragover", this.onDragOver.bind(this));
    window.addEventListener("dragleave", this.onDragLeave.bind(this));
    const end = (e) => {
      if (e.view === window) this.onDragEnd();
      else setTimeout(() => this.onDragEnd());
    };
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
  }

  /** A dragleave with zeroed coordinates and no related target means the pointer left the window. */
  DragManager.prototype.onDragLeave = function (evt) {
    if (evt.clientX === 0 && evt.clientY === 0 && evt.screenX === 0 && evt.screenY === 0 && evt.relatedTarget === null) {
      if (this.ghostEl) this.ghostEl.detach();
      this.updateHover(null, "");
    }
  };

  /** Drags that did not go through handleDrag: hiding a tooltip, iOS haptics, and image drags out of the vault. */
  DragManager.prototype.onDragStartGlobal = function (evt) {
    host.hideTooltip();
    if (host.Platform.isIosApp) {
      host.cancelTouchDrag();
      navigator.vibrate(200);
    }
    if (this.draggable) return;
    const selection = window.getSelection();
    if (selection.rangeCount > 0 && !selection.getRangeAt(0).collapsed) return;
    const target = evt.target;
    if (target.nodeName === "IMG") {
      const file = this.app.vault.resolveFileUrl(target.src);
      if (file) this.onDragStart(evt, this.dragFile(evt, file));
    }
  };

  /** Runs first (capture) on every dragover: resets the per-event state and schedules hiding the overlay. */
  DragManager.prototype.onDragOverFirst = function () {
    this.isDragOverHandled = false;
    queueMicrotask(() => {
      if (!this.isDragOverHandled) {
        this.setAction(null);
        this.updateHover(null, "");
      }
    });
    this.shouldHideOverlay = true;
    setTimeout(() => {
      if (this.shouldHideOverlay) this.hideOverlay();
    });
  };

  /** Moves the ghost element with the pointer (centred above the finger on touch) and flags real movement. */
  DragManager.prototype.onDragOver = function (evt) {
    this.isDragOverHandled = true;
    if (host.Platform.isMobile) {
      evt.preventDefault();
      if (evt.dataTransfer.dropEffect === "none") evt.dataTransfer.dropEffect = "move";
    }
    let x = evt.clientX;
    let y = evt.clientY;
    if (x !== 0 || y !== 0) {
      const ghost = this.ghostEl;
      const start = this.dragStart;
      if (ghost) {
        if (host.Platform.isMobile) {
          x -= ghost.offsetWidth / 2;
          y -= ghost.offsetHeight + 20;
        } else {
          x += 5;
          y += 5;
        }
        ghost.style.left = x + "px";
        ghost.style.top = y + "px";
        const doc = evt.doc;
        if (ghost.parentNode !== doc.body) doc.body.appendChild(ghost);
        ghost.show();
      }
      if (start && !start.moved && (Math.abs(start.evt.clientX - evt.clientX) > 5 || Math.abs(start.evt.clientY - evt.clientY) > 5)) {
        start.moved = true;
      }
    }
  };

  /** Tears the drag down; a tap that never moved is replayed as a contextmenu (long-press on touch). */
  DragManager.prototype.onDragEnd = function () {
    const ghost = this.ghostEl;
    const start = this.dragStart;
    if (ghost) {
      ghost.detach();
      this.ghostEl = null;
    }
    this.dragStart = null;
    this.draggable = null;
    this.updateSource(null, "");
    this.updateHover(null, "");
    document.body.removeClass("is-grabbing");
    window.removeEventListener("touchend", this.onTouchEnd);
    this.removeOverlay();
    if (start && !start.moved) {
      const evt = start.evt;
      const replayed = evt.target.dispatchEvent(
        new MouseEvent("contextmenu", {
          button: 0,
          buttons: 0,
          ctrlKey: evt.ctrlKey,
          altKey: evt.altKey,
          metaKey: evt.metaKey,
          shiftKey: evt.shiftKey,
          screenX: evt.screenX,
          screenY: evt.screenY,
          bubbles: true,
          cancelable: true,
          clientX: evt.clientX,
          clientY: evt.clientY,
        })
      );
      if (!replayed) navigator.vibrate(200);
    }
  };

  /** Builds the ghost element for `info` ({source, type, icon, title, ...}) and arms the drag. */
  DragManager.prototype.onDragStart = function (evt, info) {
    const dataTransfer = evt.dataTransfer;
    this.draggable = info;
    if (host.Platform.isMobile) {
      this.dragStart = { evt, moved: false };
      window.addEventListener("touchend", this.onTouchEnd);
      suppressNextEvent(evt.targetNode, "contextmenu");
    }
    document.body.addClass("is-grabbing");
    dataTransfer.effectAllowed = "all";
    const oldGhost = this.ghostEl;
    if (oldGhost) {
      oldGhost.detach();
      this.ghostEl = null;
    }
    if (info) {
      const ghost = (this.ghostEl = evt.doc.body.createDiv("drag-ghost"));
      const self = ghost.createDiv("drag-ghost-self");
      if (info.icon) host.setIcon(self, info.icon);
      if (info.title) self.createSpan({ text: info.title });
      this.actionEl = ghost.createDiv("drag-ghost-action");
    }
    setDragImage(evt);
    // Some platforms hand back an empty string item for every string type; only write a fallback
    // text/plain when nothing real was put on the transfer.
    let empty = true;
    if (dataTransfer.items.length > 0) {
      for (const item of Array.from(dataTransfer.items)) {
        if (item.kind !== "string" || dataTransfer.getData(item.type) !== "") {
          empty = false;
          break;
        }
      }
    }
    if (empty) dataTransfer.setData("text/plain", (info && info.title) || "-");
  };

  /** Makes `el` start a drag described by `describe(evt)`; the drag only starts when it returns info. */
  DragManager.prototype.handleDrag = function (el, describe) {
    const self = this;
    el.draggable = true;
    el.addEventListener("dragstart", (evt) => {
      const info = describe(evt);
      if (info) self.onDragStart(evt, info);
    });
  };

  /** Drag payload for a single file: its obsidian:// URI as text. */
  DragManager.prototype.dragFile = function (evt, file, source) {
    setDragUriData(evt.dataTransfer, this.app.getObsidianUrl(file));
    return { source, type: "file", icon: "lucide-file", title: file.getShortName(), file };
  };

  /** Drag payload for a folder: its name as plain text. */
  DragManager.prototype.dragFolder = function (evt, folder, source) {
    setDragPlainData(evt.dataTransfer, folder.name);
    return { source, type: "folder", icon: "lucide-folder-open", title: folder.name, file: folder };
  };

  /** Drag payload for several files/folders: newline-separated obsidian:// URIs of the files plus a summary title. */
  DragManager.prototype.dragFiles = function (evt, files, source) {
    if (files.length === 0) return null;
    let fileCount = 0;
    let folderCount = 0;
    const uris = [];
    for (const file of files) {
      if (file instanceof host.TFile) {
        fileCount++;
        uris.push(this.app.getObsidianUrl(file));
      } else if (file instanceof host.TFolder) {
        folderCount++;
      }
    }
    let title;
    if (folderCount > 0 && fileCount > 0) title = fileCount + " files and " + folderCount + " folders";
    else if (folderCount > 0) title = folderCount + " folders";
    else if (fileCount > 0) title = fileCount + " files";
    setDragUriData(evt.dataTransfer, uris.join("\n"));
    return { source, type: "files", icon: "lucide-files", title, files };
  };

  /**
   * Drag payload for a wikilink/markdown link. Resolves the target for the URI; `title` overrides
   * the displayed text, `source` marks where the drag came from.
   */
  DragManager.prototype.dragLink = function (evt, linktext, sourcePath, title, source) {
    const dest = this.app.metadataCache.getFirstLinkpathDest(host.linkPath(linktext), sourcePath);
    let uri = linktext;
    let label = linktext;
    if (dest) {
      uri = this.app.getObsidianUrl(dest);
      label = dest.getShortName();
    }
    setDragUriData(evt.dataTransfer, uri);
    return { source, type: "link", icon: "lucide-link", title: title || label, linktext, sourcePath, file: dest };
  };

  /**
   * Wires dragover/dragenter/drop on `el`. While `always` is false the handlers only run when a drag
   * is in progress (`this.draggable`); `handle(evt, draggable, isOver)` returns the reaction
   * ({action, dropEffect, hoverEl, hoverClass}) or null.
   */
  DragManager.prototype.handleDrop = function (el, handle, always) {
    const self = this;
    const onDrag = (evt) => {
      if ((always || self.draggable) && !evt.defaultPrevented) {
        const result = handle(evt, self.draggable, true);
        if (result) {
          evt.preventDefault();
          const { action, dropEffect, hoverEl, hoverClass } = result;
          if (action) self.setAction(action);
          if (dropEffect) evt.dataTransfer.dropEffect = dropEffect;
          if (hoverEl && hoverClass) self.updateHover(hoverEl, hoverClass);
        }
      }
    };
    el.addEventListener("dragover", onDrag);
    el.addEventListener("dragenter", onDrag);
    el.addEventListener("drop", (evt) => {
      if ((always || self.draggable) && !evt.defaultPrevented) {
        if (handle(evt, self.draggable, false)) evt.preventDefault();
      }
    });
  };

  /** Shows or hides the "drop here" action label inside the ghost element. */
  DragManager.prototype.setAction = function (action) {
    const el = this.actionEl;
    if (!el) return;
    if (action) {
      el.setText(action);
      el.show();
    } else {
      el.hide();
    }
  };

  /** Marks the elements the drag came from (adds `className`, removing it from the previous set). */
  DragManager.prototype.updateSource = function (els, className) {
    if (this.sourceEls) {
      for (const el of this.sourceEls) el.removeClass(this.sourceClass);
    }
    this.sourceEls = els;
    this.sourceClass = className;
    if (els) {
      for (const el of els) el.addClass(className);
    }
  };

  /** Highlights the current drop target (adds `className`, removing it from the previous target). */
  DragManager.prototype.updateHover = function (el, className) {
    if (el !== this.hoverEl) {
      if (this.hoverEl) this.hoverEl.removeClass(this.hoverClass);
      this.hoverEl = el;
      this.hoverClass = className;
      if (el) el.addClass(className);
    }
  };

  /** Positions the full-window drop overlay over `doc` at `rect` ({x, y, width, height}). */
  DragManager.prototype.showOverlay = function (doc, rect) {
    const el = this.overlayEl;
    if (el.parentNode !== doc.body) doc.body.appendChild(el);
    el.show();
    el.style.transform = "translate(" + rect.x + "px, " + rect.y + "px)";
    el.style.width = rect.width + "px";
    el.style.height = rect.height + "px";
    this.shouldHideOverlay = false;
  };

  DragManager.prototype.hideOverlay = function () {
    this.overlayEl.hide();
  };

  DragManager.prototype.removeOverlay = function () {
    this.overlayEl.detach();
  };

  return DragManager;
}
