// Canvas view controller (the `canvas` object a canvas file view owns): viewport pan/zoom with
// easing, node/edge bookkeeping through the spatial indexes, selection and drag interactions
// (mouse, touch pinch, drag-to-select, alt-drag clone), undo history wiring, snapping guides,
// clipboard copy/paste, and the PNG export paths (screenshot + tiled HD export).
//
// Everything the controller needs from the rest of the bundle arrives either as an import from a
// sibling own module (geometry, i18n tables, debounce) or through `host`/`env` bindings for names
// that still live in the application scope.
import { point, rect, distance, pointOfEvent, box, boxOfPoints, boxUnion, boxCenter, boxGrow, boxContains, centeredOrigin, boxOfRect, rectOfBox, randomHex, ownBuffer, sortedBoxPoints } from "./misc.js";
import { s13DomRect, s13AnchorRect, s13MatchSpans } from "./s13-geom.js";
import { debounceCall } from "./timing.js";
import { s13CanvasI18n, s13InterfaceI18n, s13ZoomDefault, s13ZoomStep, s13ZoomOffset, s13ZoomPanOffset } from "./s13-consts.js";
import { env } from "./env.js";

export function s32CanvasView(host) {
  const E = env();
  const c5 = s13CanvasI18n();
  const u5 = s13InterfaceI18n();
  // app-scope classes/values still owned elsewhere; resolved lazily through the host getters
  const UndoStack = host.s32UndoStack;
  const PointIndex = host.s32PointIndex;
  const BBoxItemIndex = host.s32BBoxItemIndex;
  const Multimap = host.s32Multimap;
  const TextNode = host.s32TextNode;
  const LinkNode = host.s32LinkNode;
  const BaseNode = host.s13CanvasNode;
  const FileNode = host.s13CanvasFileNode;
  const GroupNode = host.s13CanvasGroupNode;
  const Edge = host.s13CanvasEdge;
  const DummyNode = host.s32DummyNode;
  const InteractionLayer = host.s32InteractionLayer;
  const SelectionBox = host.s32CanvasSelection;
  const CanvasMenu = host.s32CanvasMenu;
  const MediaSuggest = host.s32MediaSuggest;
  const FileSuggest = host.CanvasFileSuggest;
  const UrlModal = host.s32UrlModal;
  const HelpModal = host.s32CanvasHelp;
  const edgeSideFor = host.s32EdgeSide;
  const youtubeRe = host.s32YouTubeRe;
  const edgeEndNone = host.s32EdgeEndNone;
  const edgeEndArrow = host.s32EdgeEndArrow;
  const isHttpUrl = host.s32IsHttpUrl;
  const bufferFrom = host.s32BufferFrom;
  const showInFolder = host.s32ShowInFolder;
  const isScrollable = host.s32Scrollable;
  const longPressFx = host.s32LongPressFx;
  const swallowNext = host.s32SwallowEvent;
  const byZIndex = (a, b) => a.zIndex - b.zIndex;

  class CanvasController {
    constructor(view) {
      const self = this;
      this.config = {
        zoomMultiplier: 0.5,
        objectSnapDistance: 15,
        minContainerDimension: 50,
        defaultTextNodeDimensions: { width: 250, height: 60 },
        defaultFileNodeDimensions: { width: 400, height: 400 },
      };
      this.requestUpdateFileOpen = debounceCall(this.updateFileOpen.bind(this), 200);
      this.zIndexCounter = 1;
      this.isHoldingSpace = false;
      this.readonly = false;
      this.history = new UndoStack(100);
      this.data = {};
      this.requestPushHistory = debounceCall(this.pushHistory.bind(this), 250, true);
      this.x = 0;
      this.y = 0;
      this.zoom = 0;
      this.scale = 1;
      this.tx = 0;
      this.ty = 0;
      this.tZoom = 0;
      this.finishViewportAnimation = false;
      this.zoomToFitQueued = false;
      this.screenshotting = false;
      this.nodes = new Map();
      this.nodeIndex = new PointIndex();
      this.edges = new Map();
      this.edgeIndex = new BBoxItemIndex();
      this.edgeFrom = new Multimap();
      this.edgeTo = new Multimap();
      this.staleSelection = null;
      this.selection = new Set();
      this.selectionChanged = false;
      this.keys = {};
      this.isDragging = false;
      this.viewportChanged = true;
      this.moved = new Set();
      this.dirty = new Set();
      this.frame = 0;
      this.wasAnimating = false;
      this.pauseAnimation = 0;
      this.lastNodesInViewport = new Set();
      this.lastEdgesInViewport = new Set();
      this.onGlobalKeydown = function (e) {
        if (e.key === " " && !self.isHoldingSpace) {
          if (self.selection.size === 1) {
            const node = Array.from(self.selection)[0];
            if (node instanceof BaseNode && node.isEditing) return;
          }
          self.wrapperEl.appendChild(self.moverEl);
          self.moverEl.style.zIndex = String(self.zIndexCounter + 4);
          self.isHoldingSpace = true;
        }
      };
      this.onGlobalKeyup = function (e) {
        if (e.key === " ") {
          self.moverEl.detach();
          self.isHoldingSpace = false;
        }
      };
      this.pointer = { x: 0, y: 0 };
      this.pointerFrame = 0;
      this.app = view.app;
      this.view = view;
      this.menu = new CanvasMenu(this);

      const wrapperEl = (this.wrapperEl = view.contentEl.createDiv({
        cls: "canvas-wrapper",
        attr: { tabIndex: -1, "data-ignore-swipe": "true" },
      }));
      wrapperEl.onNodeInserted(function () {
        return self.onResize();
      });
      wrapperEl.addEventListener("keydown", this.onKeydown.bind(this));
      wrapperEl.addEventListener("pointerdown", this.onPriorityPointerdown.bind(this), { capture: true });
      wrapperEl.addEventListener("pointerdown", this.onPointerdown.bind(this));
      wrapperEl.addEventListener("dblclick", this.onDoubleClick.bind(this));
      wrapperEl.addEventListener("contextmenu", this.onContextMenu.bind(this));
      wrapperEl.addEventListener("wheel", this.onWheel.bind(this));
      if (!E.Yl.isMobile) wrapperEl.addEventListener("pointermove", this.onPointermove.bind(this));

      const svg = wrapperEl.createSvg("svg", "canvas-background");
      const patternId = randomHex(16);
      this.backgroundPatternEl = svg.createSvg(
        "pattern",
        { attr: { id: patternId, patternUnits: "userSpaceOnUse" } },
        function (pattern) {
          pattern.createSvg("circle", { attr: { cx: s13ZoomDefault, cy: s13ZoomDefault, r: s13ZoomDefault } });
        },
      );
      svg.createSvg("rect", {
        attr: { x: "0", y: "0", width: "100%", height: "100%", fill: `url(#${patternId})` },
      });
      this.moverEl = E.createDiv("canvas-mover");
      this.moverEl.addEventListener("pointerdown", this.handleMoverPointerdown.bind(this));
      this.cardMenuEl = wrapperEl.createDiv("canvas-card-menu", function (menuEl) {
        setTimeout(function () {
          if (window.__fpCardMenu) window.__fpCardMenu(menuEl, self);
        }, 0);
        menuEl.createDiv({ cls: "canvas-card-menu-button mod-draggable" }, function (button) {
          E.Mv(button, c5.actionDragToAddCard(), { placement: "top" });
          E.tv(button, "lucide-sticky-note");
          button.addEventListener("click", function () {
            self.createTextNode({ pos: self.posCenter(), position: "center" });
          });
          button.addEventListener("pointerdown", function (e) {
            const size = self.config.defaultTextNodeDimensions;
            self.dragTempNode(e, size, function (pos) {
              self.deselectAll();
              self.createTextNode({ pos, size });
            });
          });
        });
        menuEl.createDiv({ cls: "canvas-card-menu-button mod-draggable" }, function (button) {
          E.Mv(button, c5.actionDragToAddNote(), { placement: "top" });
          E.tv(button, "lucide-file-text");
          button.addEventListener("click", function () {
            new FileSuggest(self, function (file) {
              self.createFileNode({ pos: self.posCenter(), file });
            })
              .showAttachments(false)
              .open();
          });
          button.addEventListener("pointerdown", function (e) {
            const size = self.config.defaultFileNodeDimensions;
            self.dragTempNode(e, size, function (pos) {
              new FileSuggest(self, function (file) {
                self.createFileNode({ pos, size, file });
              })
                .showAttachments(false)
                .open();
            });
          });
        });
        menuEl.createDiv({ cls: "canvas-card-menu-button mod-draggable" }, function (button) {
          E.Mv(button, c5.actionDragToAddMedia(), { placement: "top" });
          E.tv(button, "lucide-file-image");
          button.addEventListener("click", function () {
            new MediaSuggest(self, function (file) {
              self.createFileNode({ pos: self.posCenter(), position: "center", file });
            }).open();
          });
          button.addEventListener("pointerdown", function (e) {
            const size = self.config.defaultFileNodeDimensions;
            self.dragTempNode(e, size, function (pos) {
              new FileSuggest(self, function (file) {
                self.createFileNode({ pos, size, file });
              })
                .showMarkdownAndCanvas(false)
                .open();
            });
          });
        });
      });
      this.canvasControlsEl = wrapperEl.createDiv("canvas-controls", function (controls) {
        controls.createDiv("canvas-control-group mod-raised", function (group) {
          group.createDiv("canvas-control-item", function (item) {
            self.quickSettingsButton = item;
            self.setReadonly(self.readonly);
            item.addEventListener("click", function (e) {
              if (self.readonly) {
                self.setReadonly(!self.readonly);
                self.view.saveLocalData();
              } else {
                if (item.hasClass("has-active-menu")) return;
                const menu = new E.Ug();
                self.showQuickSettingsMenu(menu);
                menu.setParentElement(item).showAtMouseEvent(e);
              }
            });
          });
        });
        controls.createDiv("canvas-control-group mod-raised", function (group) {
          group.createDiv("canvas-control-item", function (item) {
            E.tv(item, "lucide-plus");
            E.Mv(item, E.gm.commands.zoomIn(), { placement: "left" });
            item.addEventListener("click", function () {
              self.zoomBy(self.config.zoomMultiplier);
            });
          });
          group.createDiv("canvas-control-item", function (item) {
            E.tv(item, "lucide-rotate-cw");
            E.Mv(item, E.gm.commands.resetZoom(), { placement: "left" });
            item.addEventListener("click", function () {
              self.zoomBy(-self.zoom);
            });
          });
          group.createDiv("canvas-control-item", function (item) {
            E.tv(item, "lucide-maximize");
            const hotkey = E.Rb(E.Fb(["Shift"], "1"));
            E.Mv(item, `${c5.actionZoomToFit()}\n(${hotkey})`, { placement: "left" });
            item.addEventListener("click", function () {
              self.zoomToFit();
            });
          });
          group.createDiv("canvas-control-item", function (item) {
            E.tv(item, "lucide-minus");
            E.Mv(item, E.gm.commands.zoomOut(), { placement: "left" });
            item.addEventListener("click", function () {
              self.zoomBy(-self.config.zoomMultiplier);
            });
          });
        });
        controls.createDiv("canvas-control-group mod-raised", function (group) {
          group.createDiv("canvas-control-item", function (item) {
            self.undoBtnEl = item;
            E.tv(item, "lucide-undo-2");
            E.Mv(item, E.gm.setting.mobileToolbar.optionUndo(), { placement: "left" });
            item.addEventListener("click", function () {
              self.undo();
            });
          });
          group.createDiv("canvas-control-item", function (item) {
            self.redoBtnEl = item;
            E.tv(item, "lucide-redo-2");
            E.Mv(item, E.gm.setting.mobileToolbar.optionRedo(), { placement: "left" });
            item.addEventListener("click", function () {
              self.redo();
            });
          });
        });
        if (E.Yl.isDesktop) {
          controls.createDiv("canvas-control-group mod-raised", function (group) {
            group.createDiv("canvas-control-item", function (item) {
              E.tv(item, "lucide-help-circle");
              E.Mv(item, c5.labelCanvasHelp(), { placement: "left" });
              item.addEventListener("click", function () {
                new HelpModal(self).open();
              });
            });
          });
        }
      });

      const canvasEl = (this.canvasEl = wrapperEl.createDiv("canvas"));
      this.edgeContainerEl = canvasEl.createSvg("svg", "canvas-edges");
      this.edgeEndContainerEl = canvasEl.createSvg("svg", "canvas-edges");
      this.app.dragManager.handleDrop(
        wrapperEl,
        function (evt, data, isHandled) {
          if (evt.defaultPrevented) return;
          if (data) {
            if (!isHandled) {
              switch (data.type) {
                case "file":
                case "link": {
                  const file = data.file;
                  if (file instanceof E.$T) self.createFileNode({ pos: self.posFromEvt(evt), file });
                  self.wrapperEl.focus();
                  break;
                }
                case "files": {
                  const files = data.files;
                  if (files.length) {
                    const found = new Set();
                    for (const file of files) {
                      if (file instanceof E.ZT) {
                        E.JT.recurseChildren(file, function (child) {
                          if (child instanceof E.$T) found.add(child);
                        });
                      } else if (file instanceof E.$T) {
                        found.add(file);
                      }
                    }
                    const list = Array.from(found);
                    list.sort(function (a, b) {
                      return a.basename.localeCompare(b.basename);
                    });
                    const nodes = self.createFileNodes(list, self.posFromEvt(evt));
                    self.deselectAll();
                    nodes.forEach(function (node) {
                      self.select(node);
                    });
                    self.requestSave();
                  }
                  self.wrapperEl.focus();
                  break;
                }
                case "folder": {
                  const file = data.file;
                  if (file instanceof E.ZT) {
                    const found = [];
                    E.JT.recurseChildren(file, function (child) {
                      if (child instanceof E.$T) found.push(child);
                    });
                    found.sort(function (a, b) {
                      return a.basename.localeCompare(b.basename);
                    });
                    self.createFileNodes(found, self.posFromEvt(evt));
                    self.requestSave();
                    self.wrapperEl.focus();
                    break;
                  }
                }
              }
              return { dropEffect: "copy" };
            }
          }
          evt.preventDefault();
          const dt = evt.dataTransfer;
          if (E.kP(evt.dataTransfer)) {
            if (!isHandled) {
              self.app.importAttachments(E.CP(dt, "drop", true), null).then(function (attachments) {
                self.createFileNodes(attachments, self.posFromEvt(evt));
                self.requestSave();
              });
            }
            return { dropEffect: "copy" };
          }
          const text = evt.dataTransfer.getData("text/plain");
          if (isHttpUrl(text)) {
            if (!isHandled) self.createLinkNode({ pos: self.posFromEvt(evt), position: "center", url: text });
            return { dropEffect: "link" };
          }
          if (text) {
            if (!isHandled) {
              const pos = self.posFromEvt(evt);
              self.createTextNode({ pos, position: "center", text });
            }
            return { dropEffect: "copy" };
          }
        },
        true,
      );
      this.canvasRect = s13DomRect(this.wrapperEl);
      this.nodeInteractionLayer = new InteractionLayer(this);
    }

    get options() {
      return this.view.plugin.options;
    }

    createPlaceholder() {
      let content;
      if (E.Yl.isMobile) {
        content = E.createFragment(function (frag) {
          frag.appendText(c5.labelDragPan());
          frag.createEl("br");
          frag.appendText(c5.labelPinchZoom());
          frag.createEl("br");
          frag.appendText(c5.labelLongpress());
        });
      } else {
        content = E.createFragment(function (frag) {
          frag.appendText(c5.labelDragFromBelow());
          frag.createEl("br");
          frag.appendText(c5.labelSpaceDragPan());
          frag.createEl("br");
          frag.appendText(`${host.keyNames.Mod} + ${c5.labelScrollToZoom()}`);
        });
      }
      if (!this.canvasPlaceholderEl) {
        this.canvasPlaceholderEl = this.canvasEl.createDiv({ cls: "canvas-placeholder-message", text: content });
      }
    }

    getData() {
      const nodes = [];
      const edges = [];
      const sorted = Array.from(this.nodes.values());
      sorted.sort(byZIndex);
      for (const node of sorted) nodes.push(node.getData());
      for (const edge of Array.from(this.edges.values())) edges.push(edge.getData());
      return { ...this.data, nodes, edges };
    }

    getSelectionData(selection = this.selection) {
      const nodes = [];
      const edges = [];
      const items = Array.from(selection);
      items.sort(byZIndex);
      const edgeSet = new Set();
      for (const item of items) {
        if (item instanceof BaseNode) {
          nodes.push(item.getData());
          for (const edge of this.getEdgesForNode(item)) edgeSet.add(edge);
        }
      }
      for (const edge of Array.from(edgeSet)) {
        if (selection.has(edge.from.node) && selection.has(edge.to.node)) edges.push(edge.getData());
      }
      return {
        nodes,
        edges,
        center: boxCenter(boxUnion(items.map((item) => item.getBBox()))),
      };
    }

    updateFileOpen(file) {
      const app = this.app;
      const view = this.view;
      const leaf = view.leaf;
      if (leaf === app.workspace.activeLeaf && leaf.view === view) {
        if (file === null) file = view.file;
        app.workspace.trigger("file-open", file);
      }
    }

    setData(data) {
      if (!data) return;
      if (Object.keys(data).length !== 0) {
        this.importData(data, true);
        this.data = data;
        this.pushHistory(data);
      } else {
        this.createPlaceholder();
      }
    }

    importData(data, replace) {
      const nodesData = data.nodes;
      const edgesData = data.edges;
      if (nodesData && Array.isArray(nodesData)) {
        const nodes = this.nodes;
        const kept = new Set();
        let lastZ = 0;
        for (const nodeData of nodesData) {
          const id = nodeData.id;
          let node;
          if (nodes.has(id)) {
            node = nodes.get(id);
          } else {
            if (nodeData.type === "file") node = new FileNode(this, id);
            else if (nodeData.type === "text") node = new TextNode(this, id);
            else if (nodeData.type === "link") node = new LinkNode(this, id);
            else {
              if (nodeData.type !== "group") continue;
              node = new GroupNode(this, id);
            }
            this.addNode(node);
            this.markMoved(node);
          }
          node.setData(nodeData);
          kept.add(node);
          if (node.zIndex < lastZ) node.updateZIndex();
          lastZ = node.zIndex;
        }
        if (replace) {
          nodes.forEach((node) => {
            if (!kept.has(node)) this.removeNode(node);
          });
        }
        if (edgesData && Array.isArray(edgesData)) {
          const edges = this.edges;
          const keptEdges = new Set();
          for (const edgeData of edgesData) {
            const id = edgeData.id;
            const fromId = edgeData.fromNode;
            let fromSide = edgeData.fromSide;
            const fromEnd = edgeData.fromEnd;
            const toId = edgeData.toNode;
            let toSide = edgeData.toSide;
            const toEnd = edgeData.toEnd;
            if (nodes.has(fromId) && nodes.has(toId)) {
              let edge;
              if (edges.has(id)) {
                edge = edges.get(id);
              } else {
                const from = nodes.get(fromId);
                const to = nodes.get(toId);
                if (!fromSide) edgeData.fromSide = fromSide = edgeSideFor(from, to);
                if (!toSide) edgeData.toSide = toSide = edgeSideFor(to, from);
                edge = new Edge(this, id, { node: from, side: fromSide, end: fromEnd || edgeEndNone }, { node: to, side: toSide, end: toEnd || edgeEndArrow });
                this.addEdge(edge);
                this.markMoved(edge);
              }
              keptEdges.add(edge);
              edge.setData(edgeData);
            } else if (edges.has(id)) {
              this.removeEdge(edges.get(id));
            }
          }
          if (replace) {
            edges.forEach((edge) => {
              if (!keptEdges.has(edge)) this.removeEdge(edge);
            });
          }
          return kept;
        }
      }
    }

    load() {
      window.addEventListener("keydown", this.onGlobalKeydown);
      window.addEventListener("keyup", this.onGlobalKeyup);
    }

    unload() {
      window.removeEventListener("keydown", this.onGlobalKeydown);
      window.removeEventListener("keyup", this.onGlobalKeyup);
      this.clear();
      this.cancelFrame();
    }

    clear() {
      this.staleSelection = [];
      this.selection.clear();
      this.nodes.forEach((node) => this.removeNode(node));
      this.edges.forEach((edge) => this.removeEdge(edge));
      this.nodeIndex.clear();
      this.history.clear();
      this.data = {};
      this.requestPushHistory.cancel();
      this.requestUpdateFileOpen.cancel();
      this.setViewport(0, 0, 0);
      this.setReadonly(false);
    }

    requestSave(save = true) {
      this.data = this.getData();
      if (save) this.requestPushHistory(this.data);
      this.view.requestSave();
    }

    overrideHistory() {
      this.requestPushHistory.run();
      this.data = this.getData();
      this.history.replace(this.data);
      this.updateHistoryUI();
      this.view.requestSave();
    }

    undo() {
      const history = this.history;
      if (history.canUndo()) this.applyHistory(history.undo());
    }

    redo() {
      const history = this.history;
      if (history.canRedo()) this.applyHistory(history.redo());
    }

    applyHistory(data) {
      this.importData(data, true);
      this.data = data;
      this.view.requestSave();
      this.updateHistoryUI();
    }

    pushHistory(data) {
      this.history.push(data);
      this.updateHistoryUI();
    }

    updateHistoryUI() {
      const history = this.history;
      this.undoBtnEl.toggleClass("is-disabled", !history.canUndo());
      this.redoBtnEl.toggleClass("is-disabled", !history.canRedo());
    }

    get zoomBreakpoint() {
      return s13ZoomPanOffset - (this.options.zoomBreakpoint || 0);
    }

    setViewport(x, y, zoom) {
      if (x === this.x && y === this.y && zoom === this.zoom) return;
      this.x = this.tx = x;
      this.y = this.ty = y;
      this.zoom = this.tZoom = zoom;
      this.markViewportChanged();
    }

    zoomBy(delta, center) {
      let tZoom = this.tZoom;
      tZoom += delta;
      this.tZoom = tZoom;
      if (!center) center = point(0, 0);
      this.zoomCenter = center;
      this.markViewportChanged();
    }

    panTo(x, y) {
      this.x = x;
      this.y = y;
      this.tx = x;
      this.ty = y;
      this.markViewportChanged();
    }

    panBy(dx, dy) {
      this.x += dx;
      this.y += dy;
      this.tx = this.x;
      this.ty = this.y;
      this.markViewportChanged();
    }

    zoomToSelection() {
      const selection = this.selection;
      if (selection.size === 0) return;
      const bounds = boxUnion(
        Array.from(selection.values()).map((item) => item.getBBox()),
      );
      this.zoomToBbox(bounds);
    }

    nudgeSelection(key, direction) {
      const nodes = Array.from(this.selection).filter((item) => item instanceof BaseNode);
      if (nodes.length === 0) return;
      const step = key.shiftKey ? 5 * this.gridSpacing : this.gridSpacing;
      const delta = { x: 0, y: 0 };
      switch (direction) {
        case "down": delta.y = step; break;
        case "up": delta.y = -step; break;
        case "left": delta.x = -step; break;
        case "right": delta.x = step; break;
      }
      if (this.options.snapToGrid) {
        const spacing = this.gridSpacing;
        const bounds = boxUnion(
          Array.from(this.selection).map((item) => item.getBBox()),
        );
        const remainder = { x: Math.round(bounds.minX % spacing), y: Math.round(bounds.minY % spacing) };
        if (direction === "left" || direction === "right") {
          if (remainder.x > 0) {
            delta.x = -remainder.x;
            if (direction === "right") delta.x += spacing;
          }
        } else if (direction === "up" || direction === "down") {
          if (remainder.y > 0) {
            delta.y = -remainder.y;
            if (direction === "down") delta.x += spacing;
          }
        }
      }
      for (const node of nodes) {
        node.moveTo({ x: node.x + delta.x, y: node.y + delta.y });
      }
      this.requestSave();
    }

    zoomToFit() {
      const nodes = this.nodes;
      if (nodes.size === 0) return;
      const bounds = boxUnion(
        Array.from(nodes.values()).map((node) => node.getBBox()),
      );
      this.zoomToBbox(bounds);
    }

    zoomToBbox(bounds) {
      const rect = this.canvasRect;
      const width = rect.width;
      const height = rect.height;
      if (width === 0 || height === 0) return;
      const fitX = width / (1.1 * (bounds.maxX - bounds.minX));
      const fitY = height / (1.1 * (bounds.maxY - bounds.minY));
      const zoom = Math.clamp(Math.min(fitX, fitY), -4, 1);
      const center = boxCenter(bounds);
      this.tx = center.x;
      this.ty = center.y;
      this.zoomCenter = null;
      this.tZoom = Math.log2(zoom);
      this.markViewportChanged();
    }

    panIntoView(bounds, growBy = this.gridSpacing) {
      bounds = boxGrow(bounds, growBy);
      const viewport = this.getViewportBBox();
      if (bounds.maxX - bounds.minX > viewport.maxX - viewport.minX || bounds.maxY - bounds.minY > viewport.maxY - viewport.minY) {
        this.zoomToBbox(bounds);
      } else {
        if (bounds.minX < viewport.minX) this.tx = this.x + bounds.minX - viewport.minX;
        if (bounds.minY < viewport.minY) this.ty = this.y + bounds.minY - viewport.minY;
        if (bounds.maxX > viewport.maxX) this.tx = this.x + bounds.maxX - viewport.maxX;
        if (bounds.maxY > viewport.maxY) this.ty = this.y + bounds.maxY - viewport.maxY;
        this.markViewportChanged();
      }
    }

    get gridSpacing() {
      const zoom = this.zoom;
      return zoom < -3.3 ? 160 : zoom < -2.16 ? 80 : zoom < -0.91 ? 40 : 20;
    }

    get snapDistance() {
      return Math.ceil(this.config.objectSnapDistance / this.scale);
    }

    posFromEvt(e) {
      return this.posFromDom(this.domPosFromEvt(e));
    }

    domPosFromEvt(e) {
      const rect = this.canvasRect;
      return point(e.clientX - rect.cx, e.clientY - rect.cy);
    }

    domPosFromClient(p) {
      const rect = this.canvasRect;
      return point(p.x - rect.cx, p.y - rect.cy);
    }

    posFromClient(p) {
      return this.posFromDom(this.domPosFromClient(p));
    }

    posFromDom(p) {
      const { x, y, scale } = this;
      return point(x + p.x / scale, y + p.y / scale);
    }

    domFromPos(p) {
      const { x, y, scale } = this;
      return point((p.x - x) * scale, (p.y - y) * scale);
    }

    posCenter() {
      return this.posFromDom(point(0, 0));
    }

    posInViewport(p) {
      const rect = this.canvasRect;
      return p.x >= rect.minX || p.x <= rect.maxX || p.y >= rect.minY || p.y <= rect.maxY;
    }

    getViewportNodes(excludeSelection) {
      let nodes = this.getIntersectingNodes(this.getViewportBBox());
      if (excludeSelection) {
        const selection = this.selection;
        nodes = nodes.filter((node) => !selection.has(node));
      }
      return nodes;
    }

    hitTestNode(p, padding = 0) {
      const hits = this.nodeIndex.search(boxGrow(box(p.x, p.y, p.x, p.y), padding));
      if (hits.length === 0) return null;
      hits.sort((a, b) => b.zIndex - a.zIndex);
      return hits[0];
    }

    addNode(node) {
      this.nodes.set(node.id, node);
      this.requestFrame();
      if (this.canvasPlaceholderEl) {
        this.canvasPlaceholderEl.detach();
        this.canvasPlaceholderEl = null;
      }
    }

    removeNode(node) {
      for (const edge of this.getEdgesForNode(node)) this.removeEdge(edge);
      this.deselect(node);
      this.nodes.delete(node.id);
      this.nodeIndex.remove(node);
      this.moved.delete(node);
      this.dirty.delete(node);
      this.lastNodesInViewport.delete(node);
      node.destroy();
      this.requestFrame();
    }

    getIntersectingNodes(bounds) {
      return this.nodeIndex.search(bounds);
    }

    getContainingNodes(bounds) {
      return this.nodeIndex.search(bounds).filter((node) => boxContains(bounds, node.getBBox()));
    }

    addEdge(edge) {
      this.edges.set(edge.id, edge);
      this.edgeFrom.add(edge.from.node, edge);
      this.edgeTo.add(edge.to.node, edge);
      this.requestFrame();
    }

    removeEdge(edge) {
      if (!this.edges.has(edge.id)) return;
      this.deselect(edge);
      this.edges.delete(edge.id);
      this.edgeFrom.delete(edge.from.node, edge);
      this.edgeTo.delete(edge.to.node, edge);
      this.edgeIndex.remove(edge);
      this.moved.delete(edge);
      this.dirty.delete(edge);
      this.lastEdgesInViewport.delete(edge);
      edge.destroy();
      this.requestFrame();
    }

    getEdgesForNode(node) {
      return this.edgeFrom.getArray(node).concat(this.edgeTo.getArray(node));
    }

    getIntersectingEdges(bounds) {
      return this.edgeIndex.search(bounds);
    }

    updateSelection(mutate) {
      if (!this.staleSelection) this.staleSelection = Array.from(this.selection);
      mutate();
      this.requestFrame();
    }

    select(item) {
      const selection = this.selection;
      if (selection.has(item)) return;
      this.updateSelection(function () {
        selection.add(item);
      });
    }

    deselect(item) {
      const selection = this.selection;
      if (!selection.has(item)) return;
      this.updateSelection(function () {
        selection.delete(item);
      });
    }

    toggleSelect(item) {
      const selection = this.selection;
      this.updateSelection(function () {
        if (selection.has(item)) selection.delete(item);
        else selection.add(item);
      });
    }

    selectOnly(item) {
      const selection = this.selection;
      if (selection.size === 1 && Array.from(selection)[0] === item) return;
      this.updateSelection(function () {
        selection.clear();
        selection.add(item);
      });
    }

    selectAll(items) {
      const selection = this.selection;
      this.updateSelection(function () {
        if (items) {
          selection.clear();
          items.forEach((item) => selection.add(item));
        } else {
          this.nodes.forEach((node) => selection.add(node));
        }
      });
    }

    deselectAll() {
      const selection = this.selection;
      if (selection.size === 0) return;
      this.updateSelection(function () {
        selection.clear();
      });
    }

    deleteSelection() {
      if (this.readonly) return;
      const selection = this.selection;
      for (const item of Array.from(selection)) {
        if (item instanceof BaseNode) this.removeNode(item);
        if (item instanceof Edge) this.removeEdge(item);
      }
      this.deselectAll();
      this.requestSave();
    }

    setDragging(dragging) {
      if (this.isDragging === dragging) return;
      this.isDragging = dragging;
      this.wrapperEl.toggleClass("is-dragging", dragging);
      this.selectionChanged = true;
      this.requestFrame();
    }

    onResize() {
      const oldRect = this.canvasRect;
      this.canvasRect = s13DomRect(this.wrapperEl);
      const rect = this.canvasRect;
      if (E.Yl.isMobile && oldRect.height > 0 && rect.height > 0 && oldRect.height !== rect.height) {
        this.y = this.ty += (rect.height - oldRect.height) / 2 / this.scale;
      }
      if (E.Yl.isMobile && this.selection.size === 1) {
        const item = Array.from(this.selection)[0];
        if (item instanceof BaseNode && item.isEditing) this.panIntoView(item.getBBox());
      }
      this.viewportChanged = true;
      this.requestFrame();
      if (rect.width > 0 && this.zoomToFitQueued) {
        this.zoomToFitQueued = false;
        this.finishViewportAnimation = true;
        this.zoomToFit();
      }
    }

    getZIndex() {
      const menu = this.menu;
      const cardMenuEl = this.cardMenuEl;
      const controlsEl = this.canvasControlsEl;
      const zIndex = (this.zIndexCounter += 1);
      const controlsZ = (zIndex + 1).toString();
      cardMenuEl.style.zIndex = controlsZ;
      controlsEl.style.zIndex = controlsZ;
      menu.updateZIndex(zIndex + 3);
      return zIndex;
    }

    createTextNode(options) {
      const pos = options.pos;
      let size = options.size;
      const position = options.position;
      const text = options.text;
      const save = options.save;
      const focus = options.focus;
      const node = new TextNode(this);
      if (!size) size = this.config.defaultTextNodeDimensions;
      node.moveAndResize(s13AnchorRect(pos, size, position));
      if (text) node.setText(text);
      this.addNode(node);
      if (save !== false) this.requestSave();
      if (focus !== false) {
        node.attach();
        node.render();
        this.selectOnly(node);
        node.startEditing();
      }
      return node;
    }

    createFileNode(options) {
      const pos = options.pos;
      let size = options.size;
      const position = options.position;
      const file = options.file;
      const subpath = options.subpath;
      const save = options.save;
      const focus = options.focus;
      const node = new FileNode(this);
      if (!size) size = this.config.defaultFileNodeDimensions;
      node.moveAndResize(s13AnchorRect(pos, size, position));
      node.setFile(file, subpath);
      this.addNode(node);
      if (save !== false) this.requestSave();
      if (focus !== false) this.selectOnly(node);
      return node;
    }

    createFileNodes(files, pos) {
      const x = pos.x;
      const y = pos.y;
      const size = this.config.defaultFileNodeDimensions;
      const width = size.width;
      const height = size.height;
      const created = [];
      for (let i = 0; i < files.length; i++) {
        created.push(
          this.createFileNode({
            pos: { x: x + (width + 45) * (i % 10), y: y + (height + 45) * Math.trunc(i / 10) },
            size,
            file: files[i],
            save: false,
            focus: false,
          }),
        );
      }
      return created;
    }

    createLinkNode(options) {
      const pos = options.pos;
      let size = options.size;
      const position = options.position;
      let url = window.__fpUrl ? window.__fpUrl(options.url) : options.url;
      const save = options.save;
      const focus = options.focus;
      const node = new LinkNode(this);
      if (!size) size = this.config.defaultFileNodeDimensions;
      if (youtubeRe.test(url)) size = { width: 640, height: 360 };
      node.moveAndResize(s13AnchorRect(pos, size, position));
      node.setUrl(url);
      this.addNode(node);
      if (save !== false) this.requestSave();
      if (focus !== false) this.selectOnly(node);
      return node;
    }

    createGroupNode(options) {
      const pos = options.pos;
      let size = options.size;
      const position = options.position;
      let label = options.label;
      const save = options.save;
      const focus = options.focus;
      const node = new GroupNode(this);
      if (!size) size = this.config.defaultFileNodeDimensions;
      node.moveAndResize(s13AnchorRect(pos, size, position));
      if (!label) label = c5.labelUntitledGroup();
      node.setLabel(label);
      this.addNode(node);
      if (save !== false) this.requestSave();
      if (focus !== false) {
        this.selectOnly(node);
        node.attach();
        node.render();
        node.focusLabel();
      }
      return node;
    }

    markViewportChanged() {
      this.viewportChanged = true;
      this.requestFrame();
    }

    markMoved(item) {
      this.moved.add(item);
      this.requestFrame();
    }

    markDirty(item) {
      this.dirty.add(item);
      if (this.selection.has(item)) this.selectionChanged = true;
      this.requestFrame();
    }

    requestFrame(startTime) {
      const self = this;
      if (this.frame) return;
      if (!startTime) startTime = performance.now();
      this.frameWin = this.canvasEl.win;
      this.frame = this.frameWin.requestAnimationFrame(function () {
        self.frame = 0;
        self.frameWin = null;
        const now = performance.now();
        const elapsed = now - startTime;
        const viewportChanged = self.viewportChanged;
        if (viewportChanged) {
          let ease = Math.pow(0.984, elapsed);
          if (self.finishViewportAnimation) {
            ease = 0;
            self.finishViewportAnimation = false;
          }
          let amount = 1 - ease;
          const x = self.x;
          const y = self.y;
          const zoom = self.zoom;
          const tx = self.tx;
          const ty = self.ty;
          let tZoom = self.tZoom;
          const zoomCenter = self.zoomCenter;
          let scale = self.scale;
          if (!self.screenshotting) tZoom = self.tZoom = Math.clamp(tZoom, -4, 1);
          const zoomDelta = tZoom - zoom;
          if (Math.abs(zoomDelta) < s13ZoomStep) amount = 1;
          let newZoom;
          let newX = x;
          let newY = y;
          let newScale = scale;
          if (Math.abs(zoomDelta) === Infinity) {
            newZoom = tZoom = 0;
            newScale = Math.pow(2, newZoom);
          } else if (zoomDelta === 0) {
            newZoom = tZoom;
            newScale = Math.pow(2, newZoom);
          } else if (zoomCenter) {
            const cx = zoomCenter.x;
            const cy = zoomCenter.y;
            const oldScale = scale;
            newZoom = zoom + zoomDelta * amount;
            newScale = Math.pow(2, newZoom);
            newX = x - cx / newScale + cx / oldScale;
            newY = y - cy / newScale + cy / oldScale;
            self.tx = newX;
            self.ty = newY;
          } else {
            newZoom = zoom + zoomDelta * amount;
            newScale = Math.pow(2, newZoom);
          }
          const panX = tx - newX;
          newX += panX * amount;
          if (panX !== 0 && Math.abs(panX) < s13ZoomStep) newX = tx;
          const panY = ty - newY;
          newY += panY * amount;
          if (panY !== 0 && Math.abs(panY) < s13ZoomStep) newY = ty;
          self.x = newX;
          self.y = newY;
          self.zoom = newZoom;
          self.scale = newScale;
          const canvasEl = self.canvasEl;
          const wrapperEl = self.wrapperEl;
          const rect = self.canvasRect;
          const width = rect.width;
          const height = rect.height;
          wrapperEl.toggleClass("mod-zoomed-out", newZoom <= s13ZoomPanOffset);
          canvasEl.style.transform = `translate(${width / 2}px, ${height / 2}px) scale(${newScale}) translate(${-newX}px, ${-newY}px)`;
          if (window.__fpView) window.__fpView(self, newX, newY, newScale, width, height);
          const spacing = self.gridSpacing;
          self.backgroundPatternEl.setAttrs({
            x: String(width / 2 - (newX % spacing) * newScale),
            y: String(height / 2 - (newY % spacing) * newScale),
            width: String(spacing * newScale),
            height: String(spacing * newScale),
          });
          if (self.x !== tx || self.y !== ty || self.zoom !== tZoom || Date.now() < self.pauseAnimation) {
            self.requestFrame(now);
            self.wasAnimating = true;
          } else {
            if (self.screenshotting) newScale = Math.min(1, newScale);
            wrapperEl.setCssProps({ "--zoom-multiplier": String(Math.sqrt(1 / newScale)) });
            wrapperEl.toggleClass("mod-animating", !E.Yl.isIosApp && self.wasAnimating);
            self.wasAnimating = false;
            self.viewportChanged = false;
            self.app.workspace.requestSaveLayout();
          }
        }
        const moved = self.moved;
        const dirty = self.dirty;
        const nodes = self.nodes;
        const edges = self.edges;
        const edgeIndex = self.edgeIndex;
        const nodeIndex = self.nodeIndex;
        if (moved.size > 0) {
          for (const item of Array.from(moved)) {
            if (item instanceof BaseNode) {
              for (const edge of self.getEdgesForNode(item)) moved.add(edge);
            }
          }
          const reinsertNodes = [];
          const reinsertEdges = [];
          for (const item of Array.from(moved)) {
            if (item instanceof BaseNode) {
              nodeIndex.remove(item);
              if (nodes.has(item.id)) reinsertNodes.push(item);
            } else if (item instanceof Edge) {
              edgeIndex.remove(item);
              if (edges.has(item.id)) reinsertEdges.push(item);
            }
            dirty.add(item);
          }
          for (const node of reinsertNodes) nodeIndex.insert(node);
          for (const edge of reinsertEdges) edgeIndex.insert(edge);
        }
        self.virtualize();
        for (const item of Array.from(dirty)) {
          if (item.isAttached) {
            item.render();
            dirty.delete(item);
          }
        }
        const staleSelection = self.staleSelection;
        const selection = self.selection;
        let selectionChanged = self.selectionChanged;
        if (staleSelection) {
          for (const item of staleSelection) {
            if (!selection.has(item)) {
              if (staleSelection.length === 1) item.blur();
              else item.deselect();
              selectionChanged = true;
            }
          }
          const staleSet = new Set(staleSelection);
          for (const item of Array.from(selection)) {
            if (staleSet.has(item)) {
              if (staleSelection.length === 1 && selection.size > 1) {
                item.blur();
                item.select();
                selectionChanged = true;
              } else if (staleSelection.length > 1 && selection.size === 1) {
                item.deselect();
                item.focus();
                selectionChanged = true;
              }
            } else {
              if (selection.size === 1) item.focus();
              else item.select();
              selectionChanged = true;
            }
          }
          if (E.Yl.isMobile) {
            let target = null;
            const items = Array.from(selection);
            if (items.length === 1 && items[0] instanceof BaseNode) target = items[0];
            self.nodeInteractionLayer.setTarget(target);
          }
        }
        self.staleSelection = null;
        self.selectionChanged = false;
        if (selectionChanged || viewportChanged || Array.from(self.selection).some((item) => moved.has(item))) {
          self.menu.render(selectionChanged);
        }
        if (window.__fpFrame) window.__fpFrame(self, selectionChanged);
        moved.clear();
        self.nodeInteractionLayer.render();
      });
    }

    cancelFrame() {
      const frameWin = this.frameWin;
      const frame = this.frame;
      const pointerFrameWin = this.pointerFrameWin;
      const pointerFrame = this.pointerFrame;
      if (frame && frameWin) {
        frameWin.cancelAnimationFrame(frame);
        this.frame = 0;
        this.frameWin = null;
      }
      if (pointerFrame && pointerFrameWin) {
        pointerFrameWin.cancelAnimationFrame(pointerFrame);
        this.pointerFrame = 0;
        this.pointerFrameWin = null;
      }
    }

    getViewportBBox() {
      const rect = this.canvasRect;
      const min = this.posFromDom(point(rect.minX, rect.minY));
      const max = this.posFromDom(point(rect.maxX, rect.maxY));
      return { minX: min.x, minY: min.y, maxX: max.x, maxY: max.y };
    }

    virtualize() {
      const screenshotting = this.screenshotting;
      const lastNodes = this.lastNodesInViewport;
      const lastEdges = this.lastEdgesInViewport;
      const bounds = this.getViewportBBox();
      const intersectingNodes = this.getIntersectingNodes(bounds);
      const intersectingEdges = this.getIntersectingEdges(bounds);
      const nodes = screenshotting ? Array.from(this.nodes.values()) : intersectingNodes;
      const edges = screenshotting ? Array.from(this.edges.values()) : intersectingEdges;
      const keepNodes = new Set(nodes);
      const keepEdges = new Set(edges);
      const selection = this.selection;
      if (selection.size === 1) {
        selection.forEach((item) => {
          if (item instanceof BaseNode) keepNodes.add(item);
        });
      }
      let attached = 0;
      for (const node of nodes) {
        if (lastNodes.has(node)) node.attach();
        else if (attached < 10 || screenshotting) {
          node.attach();
          attached++;
        } else {
          keepNodes.delete(node);
        }
      }
      for (const edge of edges) edge.attach();
      const detach = [];
      lastNodes.forEach((node) => {
        if (!keepNodes.has(node)) detach.push(node);
      });
      for (const node of detach) node.preDetach();
      for (const node of detach) node.detach();
      lastEdges.forEach((edge) => {
        if (!keepEdges.has(edge)) edge.detach();
      });
      this.lastNodesInViewport = keepNodes;
      this.lastEdgesInViewport = keepEdges;
      if (attached > 0) this.requestFrame();
    }

    rerenderViewport() {
      this.lastNodesInViewport.forEach((node) => this.markDirty(node));
    }

    setState(state) {
      const { x, y, zoom } = state;
      if (Number.isNumber(x) && Number.isNumber(y) && Number.isNumber(zoom)) {
        this.setViewport(x, y, zoom);
        this.zoomToFitQueued = false;
      }
    }

    getState() {
      return { x: this.tx, y: this.ty, zoom: this.tZoom };
    }

    handleCut(e) {
      if (this.readonly) return;
      if (this.canvasEl.doc.activeElement !== this.wrapperEl) return;
      this.handleCopy(e);
      const selection = this.selection;
      for (const item of Array.from(selection)) {
        if (item instanceof BaseNode) this.removeNode(item);
        if (item instanceof Edge) this.removeEdge(item);
      }
      this.requestSave();
    }

    cloneData(data, offset) {
      const nodes = data.nodes;
      const edges = data.edges;
      const idMap = {};
      for (const node of nodes) {
        const oldId = node.id;
        const newId = randomHex(16);
        node.id = newId;
        idMap[oldId] = newId;
        if (offset) {
          node.x += offset.x;
          node.y += offset.y;
        }
      }
      for (const edge of edges) {
        edge.fromNode = idMap[edge.fromNode] || "";
        edge.toNode = idMap[edge.toNode] || "";
        edge.id = randomHex(16);
      }
      return data;
    }

    handleCopy(e) {
      if (this.canvasEl.doc.activeElement !== this.wrapperEl) return;
      e.preventDefault();
      if (this.selection.size === 0) return;
      const data = this.getSelectionData();
      e.clipboardData.setData("basalt/canvas", JSON.stringify(data));
    }

    handlePaste(e) {
      if (e.defaultPrevented || this.readonly) return;
      if (this.canvasEl.doc.activeElement !== this.wrapperEl) return;
      e.preventDefault();
      const center = this.posCenter();
      const files = E.CP(e.clipboardData, "clipboard", true);
      if (files.length > 0) {
        this.app.importAttachments(files, null).then((attachments) => {
          this.createFileNodes(attachments, center);
          this.requestSave();
        });
        return;
      }
      const raw = e.clipboardData.getData("basalt/canvas");
      if (raw) {
        let data;
        try {
          data = JSON.parse(raw);
        } catch (err) {
          console.error(err);
          return;
        }
        const nodes = data.nodes;
        const edges = data.edges;
        const centerData = data.center;
        if (!nodes || !Array.isArray(nodes)) return;
        if (!edges || !Array.isArray(edges)) return;
        let offset = null;
        if (centerData) offset = { x: center.x - centerData.x, y: center.y - centerData.y };
        const cloned = this.cloneData(data, offset);
        const imported = this.importData(cloned, false);
        this.deselectAll();
        this.requestSave();
        imported.forEach((node) => this.select(node));
        return;
      }
      const text = e.clipboardData.getData("text/plain");
      if (isHttpUrl(text)) {
        this.createLinkNode({ pos: center, position: "center", url: text });
        this.requestSave();
        return;
      }
      if (text) this.createTextNode({ pos: center, position: "center", text });
    }

    toggleGridSnapping(enabled) {
      this.options.snapToGrid = enabled;
      this.view.plugin.saveOptions();
    }

    toggleObjectSnapping(enabled) {
      this.options.snapToObjects = enabled;
      this.view.plugin.saveOptions();
    }

    getSnapping(sourceBoxes, targetBoxes, snapX, snapY) {
      const options = this.options;
      const snapToGrid = options.snapToGrid;
      const snapToObjects = options.snapToObjects;
      let deltaX = 0;
      let deltaY = 0;
      if (sourceBoxes.length === 0) return { x: 0, y: 0 };
      let xMatch = null;
      let yMatch = null;
      if (snapToObjects) {
        const sourcePoints = sortedBoxPoints(sourceBoxes);
        const targetPoints = sortedBoxPoints(targetBoxes);
        const snapDist = this.snapDistance;
        xMatch = s13MatchSpans(sourcePoints, targetPoints, snapX ? snapDist : 0, "x");
        if (xMatch) deltaX += xMatch.delta;
        yMatch = s13MatchSpans(sourcePoints, targetPoints, snapY ? snapDist : 0, "y");
        if (yMatch) deltaY += yMatch.delta;
      }
      if (snapToGrid && (!xMatch || !yMatch)) {
        const bounds = boxUnion(sourceBoxes);
        const spacing = this.gridSpacing;
        if (!xMatch && snapX) deltaX += Math.round(bounds.minX / spacing) * spacing - bounds.minX;
        if (!yMatch && snapY) deltaY += Math.round(bounds.minY / spacing) * spacing - bounds.minY;
      }
      if (xMatch || yMatch) this.renderSnapPoints(xMatch, yMatch, deltaX, deltaY);
      return point(deltaX, deltaY);
    }

    endSnapPointRendering() {
      if (this.snapContainerEl) {
        this.snapContainerEl.detach();
        this.snapContainerEl = null;
      }
    }

    clearSnapPoints() {
      if (this.snapContainerEl) this.snapContainerEl.empty();
    }

    renderSnapPoints(xMatch, yMatch, deltaX, deltaY) {
      let svg = this.snapContainerEl;
      if (!svg) {
        svg = this.snapContainerEl = this.canvasEl.createSvg("svg", "canvas-snaps");
        svg.style.zIndex = String(this.zIndexCounter + 2);
      }
      const offset = (p) => point(p.x + deltaX, p.y + deltaY);
      const runs = [];
      if (xMatch) runs.push(...xMatch.matches);
      if (yMatch) runs.push(...yMatch.matches);
      for (const run of runs) {
        const src = run.src;
        const dest = run.dest;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        const points = src.map(offset).concat(dest);
        for (const p of points) {
          svg.createSvg("circle", { attr: { cx: p.x, cy: p.y, r: 4 } });
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        svg.createSvg("line", { attr: { x1: minX, y1: minY, x2: maxX, y2: maxY } });
      }
    }

    onKeydown(e) {
      if (e.repeat || e.defaultPrevented) return;
      if (host.isEditableTarget(e.targetNode)) return;
      switch (e.key) {
        case "Escape":
          this.deselectAll();
          break;
        case "Backspace":
        case "Delete": {
          const wrapperEl = this.wrapperEl;
          if (this.isDragging || wrapperEl.doc.activeElement !== wrapperEl) break;
          this.deleteSelection();
        }
      }
    }

    onPriorityPointerdown(e) {
      const self = this;
      if (e.pointerType !== "mouse") return;
      if (e.button === 1) {
        e.preventDefault();
        const start = this.posFromEvt(e);
        this.setDragging(true);
        host.dragWithThreshold(
          e,
          function () {
            return {
              move: function (evt) {
                const pos = self.posFromEvt(evt);
                self.panBy(start.x - pos.x, start.y - pos.y);
              },
              end: function (evt) {
                evt.preventDefault();
              },
              cleanup: function () {
                self.setDragging(false);
              },
            };
          },
          0,
        );
      }
      if (e.button === 2 || (E.Yl.isMacOS && e.button === 1 && e.ctrlKey)) {
        e.preventDefault();
        const start = this.posFromEvt(e);
        host.dragWithThreshold(e, function () {
          self.setDragging(true);
          return {
            move: function (evt) {
              const pos = self.posFromEvt(evt);
              self.panBy(start.x - pos.x, start.y - pos.y);
            },
            cleanup: function () {
              swallowNext(self.wrapperEl, "contextmenu");
              self.setDragging(false);
            },
          };
        });
      }
    }

    onPointerdown(e) {
      const self = this;
      if (e.pointerType === "touch") {
        this.onTouchdown(e);
        return;
      }
      if (e.targetNode === this.wrapperEl && e.pointerType === "mouse" && e.button === 0) {
        const additive = e.shiftKey;
        const previous = new Set(this.selection);
        if (!additive) this.deselectAll();
        host.dragWithThreshold(e, function () {
          return self.handleDragToSelect(e, additive, previous);
        });
      }
    }

    interactionHitTest(e) {
      this.pointer = this.posFromEvt(e);
      if (this.pointerFrame) return;
      const win = (this.pointerFrameWin = this.canvasEl.win);
      this.pointerFrame = win.requestAnimationFrame(() => {
        this.pointerFrame = 0;
        this.pointerFrameWin = null;
        if (this.isDragging) return;
        const pointer = this.pointer;
        const layer = this.nodeInteractionLayer;
        const hit = this.hitTestNode(pointer, 8 / this.scale);
        if (this.selection.size > 1 && this.selection.has(hit)) layer.setTarget(null);
        else if (layer.target !== hit) layer.setTarget(hit);
      });
    }

    onPointermove(e) {
      if (e.pointerType !== "touch") this.interactionHitTest(e);
    }

    onTouchdown(e) {
      const self = this;
      if (!e.isPrimary || e.defaultPrevented) return;
      if (isScrollable(e, this.wrapperEl, true)) return;
      e.preventDefault();
      const target = e.targetNode;
      const onWrapper = target === this.wrapperEl;
      const onMenuSelection = target === this.menu.selection.selectionEl;
      const win = e.win;
      const primary = e;
      const trackTouch = (evt) => ({
        id: evt.pointerId,
        x: evt.clientX,
        y: evt.clientY,
        pos: self.posFromEvt(evt),
      });
      const touches = [trackTouch(e)];
      let dragging = false;
      let handlers = {};
      let contextMenuEvent = null;
      let touchedNode = null;
      if (!onWrapper && !onMenuSelection) {
        for (const node of Array.from(this.nodes.values())) {
          if (node.nodeEl.contains(target)) touchedNode = node;
        }
      }
      let longPressFired = false;
      let longPressTimer = win.setTimeout(function () {
        longPressTimer = 0;
        longPressFired = true;
        navigator.vibrate(100);
        longPressFx(win, e.clientX, e.clientY);
      }, 600);
      const onPointerDown = (evt) => {
        if (evt.pointerType === "touch" && !evt.isPrimary) touches.push(trackTouch(evt));
      };
      const onPointerMove = (evt) => {
        if (evt.pointerType !== "touch") return;
        const touch = touches.find((t) => t.id === evt.pointerId);
        if (!touch) return;
        touch.x = evt.clientX;
        touch.y = evt.clientY;
        if (!dragging && evt.pointerId === primary.pointerId && distance(pointOfEvent(primary), pointOfEvent(evt)) > 5) {
          if (longPressTimer) win.clearTimeout(longPressTimer);
          if (longPressFired) {
            if (onWrapper) {
              const additive = evt.shiftKey;
              const previous = new Set(self.selection);
              if (!additive) self.deselectAll();
              handlers = self.handleDragToSelect(evt, additive, previous);
            } else if (onMenuSelection) {
              handlers = self.handleSelectionDrag(evt, target);
            } else if (touchedNode) {
              handlers = self.handleSelectionDrag(evt, target, touchedNode);
            }
            if (!handlers) {
              handlers = {};
              cleanup();
              return;
            }
          } else {
            self.setDragging(true);
          }
          dragging = true;
        }
        if (evt.pointerId === primary.pointerId && handlers.move) handlers.move(evt);
        if (longPressFired) return;
        if (touches.length === 1) {
          const only = touches[0];
          const pos = self.posFromClient(only);
          self.panBy(only.pos.x - pos.x, only.pos.y - pos.y);
        } else {
          const first = touches[0];
          const second = touches[1];
          let midCanvas = self.posFromClient(first);
          let midCanvas2 = self.posFromClient(second);
          const midStart = point((first.pos.x + second.pos.x) / 2, (first.pos.y + second.pos.y) / 2);
          const startDist = distance(first.pos, second.pos);
          const curDist = distance(midCanvas, midCanvas2);
          if (startDist > 0 && curDist > 0) {
            const zoomFactor = (self.scale * curDist) / startDist;
            let zoom = Math.log2(zoomFactor);
            zoom = Math.clamp(zoom, -4, 1);
            self.zoom = self.tZoom = zoom;
            self.scale = Math.pow(2, zoom);
            self.markViewportChanged();
            self.pauseAnimation = Date.now() + 200;
          }
          midCanvas = self.posFromClient(first);
          midCanvas2 = self.posFromClient(second);
          const midNow = point((midCanvas.x + midCanvas2.x) / 2, (midCanvas.y + midCanvas2.y) / 2);
          self.panBy(midStart.x - midNow.x, midStart.y - midNow.y);
          first.pos = self.posFromClient(first);
          second.pos = self.posFromClient(second);
        }
      };
      const onPointerUp = (evt) => {
        if (evt.pointerType !== "touch") return;
        if (evt.pointerId === primary.pointerId && !dragging) {
          if (onWrapper) self.deselectAll();
          cleanup();
          return;
        }
        const touch = touches.find((t) => t.id === evt.pointerId);
        if (!touch) return;
        touch.x = evt.clientX;
        touch.y = evt.clientY;
        if (evt.pointerId === primary.pointerId && handlers.end) handlers.end(evt);
        touches.splice(touches.indexOf(touch), 1);
        if (touches.length === 0) cleanup();
      };
      const onContextMenu = (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        evt.stopImmediatePropagation();
        contextMenuEvent = evt;
      };
      const cleanup = () => {
        win.removeEventListener("pointerdown", onPointerDown);
        win.removeEventListener("pointermove", onPointerMove);
        win.removeEventListener("pointerup", onPointerUp);
        win.removeEventListener("pointercancel", onPointerUp);
        win.removeEventListener("contextmenu", onContextMenu, { capture: true });
        if (longPressTimer) win.clearTimeout(longPressTimer);
        if (handlers.cleanup) handlers.cleanup();
        self.setDragging(false);
        if (!dragging) {
          if (!longPressFired && onMenuSelection) self.deselectAll();
          if (longPressFired) {
            const evt = contextMenuEvent || primary;
            evt.targetNode.dispatchEvent(new MouseEvent("contextmenu", evt));
          }
        }
      };
      win.addEventListener("pointerdown", onPointerDown);
      win.addEventListener("pointermove", onPointerMove);
      win.addEventListener("pointerup", onPointerUp);
      win.addEventListener("pointercancel", onPointerUp);
      win.addEventListener("contextmenu", onContextMenu, { capture: true });
    }

    handleDragToSelect(e, additive, previousSelection) {
      const self = this;
      const start = this.posFromEvt(e);
      const selectionBox = new SelectionBox(this);
      return this.handleDragWithPan(e, {
        move: function (evt) {
          const pos = self.posFromEvt(evt);
          selectionBox.update(boxOfPoints(start, pos));
          const bounds = {
            minX: Math.min(start.x, pos.x),
            minY: Math.min(start.y, pos.y),
            maxX: Math.max(start.x, pos.x),
            maxY: Math.max(start.y, pos.y),
          };
          let hits = self.getIntersectingNodes(bounds);
          hits = hits.filter((node) => !(node instanceof GroupNode) || boxContains(bounds, node.getBBox()));
          let selected = new Set(hits);
          if (additive) {
            const toggled = new Set(previousSelection);
            selected.forEach((node) => {
              if (toggled.has(node)) toggled.delete(node);
              else toggled.add(node);
            });
            selected = toggled;
          }
          self.selectAll(selected);
        },
        end: function (evt) {
          if (host.keyModifiers.isModifier(evt, "Mod")) {
            const behavior = self.view.plugin.options.defaultModDragBehavior;
            const rect = rectOfBox(selectionBox.bbox);
            switch (behavior) {
              case "card":
                self.createTextNode({ pos: rect, size: rect });
                selectionBox.hide();
                break;
              case "note":
                new FileSuggest(self, function (file) {
                  self.createFileNode({ pos: rect, size: rect, file });
                  selectionBox.hide();
                })
                  .showAttachments(false)
                  .open();
                break;
              case "media":
                new FileSuggest(self, function (file) {
                  self.createFileNode({ pos: rect, size: rect, file });
                  selectionBox.hide();
                })
                  .showMarkdownAndCanvas(false)
                  .open();
                break;
              case "webpage":
                new UrlModal(self.app, "", function (url) {
                  self.createLinkNode({ pos: rect, size: rect, url });
                  selectionBox.hide();
                }).open();
                break;
              case "group":
                self.createGroupNode({ pos: rect, size: rect });
                selectionBox.hide();
                break;
              default: {
                const menu = new E.Ug();
                self.showCreationMenu(menu, rect, rect);
                menu.onHide(function () {
                  selectionBox.hide();
                });
                menu.showAtMouseEvent(evt);
              }
            }
          } else {
            selectionBox.hide();
          }
          swallowNext(self.wrapperEl, "click");
        },
        cancel: function () {
          self.selectAll(previousSelection);
          selectionBox.hide();
        },
      });
    }

    onDoubleClick(e) {
      if (e.defaultPrevented || e.targetNode !== this.wrapperEl || this.isDragging || this.readonly) return;
      const pos = this.posFromEvt(e);
      this.createTextNode({ pos, position: "center" });
    }

    onContextMenu(e) {
      const self = this;
      if (e.defaultPrevented || e.targetNode !== this.wrapperEl || this.readonly) return;
      e.preventDefault();
      this.deselectAll();
      const pos = this.posFromEvt(e);
      const menu = new E.Ug();
      this.showCreationMenu(menu, pos);
      menu.addSeparator();
      if (this.history.canUndo()) {
        menu.addItem(function (item) {
          item.setTitle(E.gm.setting.mobileToolbar.optionUndo())
            .setSection("history")
            .setIcon("lucide-undo-2")
            .onClick(function () {
              self.undo();
            });
        });
      }
      if (this.history.canRedo()) {
        menu.addItem(function (item) {
          item.setTitle(E.gm.setting.mobileToolbar.optionRedo())
            .setSection("history")
            .setIcon("lucide-redo-2")
            .onClick(function () {
              self.redo();
            });
        });
      }
      if (E.Yl.isDesktopApp) {
        menu.addSeparator().addItem(function (item) {
          item.setTitle(E.gm.interface.menu.paste())
            .setSection("clipboard")
            .setIcon("lucide-clipboard-check")
            .onClick(function () {
              e.win.electron.remote.getCurrentWebContents().paste();
            });
        });
      }
      this.showQuickSettingsMenu(menu);
      menu.showAtMouseEvent(e);
    }

    setReadonly(readonly) {
      const button = this.quickSettingsButton;
      this.readonly = readonly;
      if (!button) return;
      const icon = readonly ? "lucide-lock" : "lucide-settings";
      const label = readonly ? c5.labelDisableReadonly() : c5.labelCanvasSettings();
      E.tv(button, icon);
      E.Mv(button, label, { placement: "left" });
      this.wrapperEl.toggleClass("mod-readonly", readonly);
      this.menu.render(true);
    }

    showQuickSettingsMenu(menu) {
      const self = this;
      const plugin = this.view.plugin;
      const options = plugin.options;
      menu
        .addItem(function (item) {
          return item
            .setSection("canvas")
            .setTitle(c5.optionSnapToGrid())
            .setIcon("lucide-grid")
            .setChecked(!!options.snapToGrid)
            .onClick(function () {
              options.snapToGrid = !options.snapToGrid;
              plugin.saveOptions();
            });
        })
        .addItem(function (item) {
          return item
            .setSection("canvas")
            .setTitle(c5.optionSnapToObjects())
            .setIcon("snap-to-object")
            .setChecked(!!options.snapToObjects)
            .onClick(function () {
              options.snapToObjects = !options.snapToObjects;
              plugin.saveOptions();
            });
        })
        .addItem(function (item) {
          return item
            .setSection("canvas")
            .setTitle(c5.labelReadonly())
            .setIcon("lucide-lock")
            .setChecked(self.readonly)
            .onClick(function () {
              self.setReadonly(!self.readonly);
              self.view.saveLocalData();
            });
        });
    }

    showCreationMenu(menu, pos, size) {
      const self = this;
      menu.addItem(function (item) {
        item.setTitle(c5.actionAddCard())
          .setSection("create")
          .setIcon("lucide-sticky-note")
          .onClick(function () {
            self.createTextNode({ pos, size });
          });
      });
      if (window.__fpCreationMenu) window.__fpCreationMenu(menu, this, pos, size);
      menu
        .addItem(function (item) {
          item.setTitle(c5.actionAddNote())
            .setSection("create")
            .setIcon("lucide-file-text")
            .onClick(function () {
              new FileSuggest(self, function (file) {
                self.createFileNode({ pos, size, file });
              })
                .showAttachments(false)
                .open();
            });
        })
        .addItem(function (item) {
          item.setTitle(c5.actionAddMedia())
            .setSection("create")
            .setIcon("lucide-file-image")
            .onClick(function () {
              new MediaSuggest(self, function (file) {
                self.createFileNode({ pos, size, file });
              }).open();
            });
        })
        .addItem(function (item) {
          item.setTitle(c5.actionAddWebsite())
            .setSection("create")
            .setIcon("lucide-external-link")
            .onClick(function () {
              new UrlModal(self.app, "", function (url) {
                self.createLinkNode({ pos, size, url });
              }).open();
            });
        })
        .addItem(function (item) {
          item.setTitle(c5.actionCreateGroup())
            .setSection("create")
            .setIcon("create-group")
            .onClick(function () {
              self.createGroupNode({ pos, size });
            });
        });
    }

    smartZoom(e) {
      const pos = this.posFromEvt(e);
      const pointBox = box(pos.x, pos.y, pos.x, pos.y);
      if (this.selection.size > 0 && boxContains(this.menu.selection.bbox, pointBox)) {
        this.zoomToSelection();
        return;
      }
      const hits = this.getIntersectingNodes(pointBox);
      if (hits.length > 0) {
        hits.sort((a, b) => a.width * a.height - b.width * b.height);
        const bounds = hits[0].bbox;
        this.zoomToBbox(bounds);
      } else {
        this.zoomToFit();
      }
    }

    onWheel(e) {
      if (this.isDragging || e.defaultPrevented) return;
      const wrapperEl = this.wrapperEl;
      const behavior = this.options.defaultWheelBehavior;
      const zoomKey = e.ctrlKey || e.metaKey;
      let pan = zoomKey || this.isHoldingSpace;
      const lineZoom = Math.abs(e.wheelDeltaY) === 240 && e.wheelDeltaX === 0;
      if (behavior !== "zoom" || lineZoom || (pan = !pan), E.Yl.isMacOS && e.ctrlKey && e.deltaX === 0 && e.deltaY === 0) {
        this.smartZoom(e);
      } else if (zoomKey || !isScrollable(e, wrapperEl)) {
        e.preventDefault();
        let deltaX = e.deltaX;
        let deltaY = e.deltaY;
        const deltaMode = e.deltaMode;
        if (deltaMode) {
          if (deltaMode === e.DOM_DELTA_LINE) {
            deltaX *= 40;
            deltaY *= 40;
          } else if (deltaMode === e.DOM_DELTA_PAGE) {
            deltaX *= 800;
            deltaY *= 800;
          }
        }
        if (pan) {
          let zoomDelta = -deltaY / 300;
          if (E.Yl.isMacOS && !Number.isInteger(deltaY)) zoomDelta *= 2;
          this.zoomBy(zoomDelta, deltaY < 0 ? this.domPosFromEvt(e) : undefined);
          this.pauseAnimation = Date.now() + 200;
        } else if (e.shiftKey && deltaX === 0) {
          this.tx += (deltaY / this.scale) * s13ZoomOffset;
          this.markViewportChanged();
        } else {
          this.tx += (deltaX / this.scale) * s13ZoomOffset;
          this.ty += (deltaY / this.scale) * s13ZoomOffset;
          this.markViewportChanged();
        }
        const wheelX = e.wheelDeltaX;
        const wheelY = e.wheelDeltaY;
        if (
          (deltaX === 0 && Number.isInteger(wheelY) && Math.abs(wheelY) === 120 && wheelY !== -3 * e.deltaY) ||
          (deltaY === 0 && Number.isInteger(wheelX) && Math.abs(wheelX) === 120 && wheelX !== -3 * e.deltaX)
        ) {
          // synthetic wheel events from some platforms: keep animating
        } else {
          this.finishViewportAnimation = true;
        }
      }
    }

    handleMoverPointerdown(e) {
      const self = this;
      if (!e.isPrimary || e.button !== 0) return;
      const start = this.posFromEvt(e);
      host.dragWithThreshold(e, function () {
        return {
          move: function (evt) {
            const pos = self.posFromEvt(evt);
            self.panBy(start.x - pos.x, start.y - pos.y);
          },
        };
      });
    }

    onSelectionContextMenu(e) {
      const self = this;
      if (e.defaultPrevented) return;
      const menu = E.Ug.forEvent(e);
      menu.addSections(["title", "open", "selection", "clipboard", "action", "view", "info", "", "danger"]);
      if (!this.readonly) {
        menu.addItem(function (item) {
          item.setTitle(u5.deleteActionShortName())
            .setSection("danger")
            .setIcon("lucide-trash-2")
            .onClick(function () {
              self.deleteSelection();
            });
        });
      }
      menu.addItem(function (item) {
        item.setTitle(c5.actionZoomToSelection())
          .setSection("selection")
          .setIcon("zoom-to-selection")
          .onClick(function () {
            self.zoomToSelection();
          });
      });
      if (!this.readonly) {
        menu.addItem(function (item) {
          item.setTitle(c5.actionCreateGroup())
            .setSection("selection")
            .setIcon("create-group")
            .onClick(function () {
              const bounds = boxGrow(
                boxUnion(
                  Array.from(self.selection.values()).map((node) => node.getBBox()),
                ),
                20,
              );
              const rect = rectOfBox(bounds);
              self.createGroupNode({ pos: rect, size: rect });
            });
        });
      }
      if (!this.readonly && E.Yl.isDesktopApp) {
        menu
          .addItem(function (item) {
            item.setTitle(E.gm.interface.menu.cut())
              .setIcon("lucide-scissors")
              .setSection("clipboard")
              .onClick(function () {
                e.win.electron.remote.getCurrentWebContents().cut();
              });
          })
          .addItem(function (item) {
            item.setTitle(E.gm.interface.menu.copy())
              .setIcon("lucide-copy")
              .setSection("clipboard")
              .onClick(function () {
                e.win.electron.remote.getCurrentWebContents().copy();
              });
          })
          .addItem(function (item) {
            item.setTitle(E.gm.interface.menu.paste())
              .setIcon("lucide-clipboard-check")
              .setSection("clipboard")
              .onClick(function () {
                e.win.electron.remote.getCurrentWebContents().paste();
              });
          });
      }
      this.app.workspace.trigger("canvas:selection-menu", menu, this);
      const files = Array.from(this.selection)
        .filter((item) => item instanceof FileNode)
        .map((item) => item.file);
      if (files.length > 1) {
        this.app.workspace.trigger("files-menu", menu, files, "canvas:selection-menu", null);
      }
    }

    canSnap(e) {
      return E.Yl.isMacOS ? !e.ctrlKey : !e.altKey;
    }

    dragTempNode(e, size, onDrop) {
      const self = this;
      if (!e.isPrimary || e.button !== 0) return;
      e.preventDefault();
      host.dragWithThreshold(e, function () {
        const ghost = new DummyNode(self);
        ghost.resize(size);
        ghost.attach();
        ghost.nodeEl.addClass("is-dragging");
        return self.handleDragWithPan(e, {
          move: function (evt) {
            self.clearSnapPoints();
            const pos = self.posFromEvt(evt);
            const rect = { ...centeredOrigin(pos, size), ...size };
            if (self.canSnap(evt)) {
              const source = [rect].map(boxOfRect);
              const targets = self
                .getViewportNodes()
                .filter((node) => !(node instanceof GroupNode))
                .map(boxOfRect);
              const snap = self.getSnapping(source, targets, true, true);
              rect.x += snap.x;
              rect.y += snap.y;
            }
            ghost.moveTo(rect);
            ghost.render();
          },
          end: function (evt) {
            if (self.posInViewport(self.domPosFromEvt(evt))) onDrop(point(ghost.x, ghost.y));
          },
          cleanup: function () {
            ghost.detach();
          },
        });
      });
    }

    handleDragWithPan(e, handlers) {
      const self = this;
      const rect = this.wrapperEl.getBoundingClientRect();
      this.setDragging(true);
      const win = e.win;
      let panX = 0;
      let panY = 0;
      let panTimer = 0;
      return {
        ...handlers,
        move: function (evt) {
          const clientX = evt.clientX;
          const clientY = evt.clientY;
          const bounds = boxGrow(boxOfRect(rect), -30);
          panX = 0;
          panY = 0;
          if (clientX < bounds.minX) panX = clientX - bounds.minX;
          if (clientX > bounds.maxX) panX = clientX - bounds.maxX;
          if (clientY < bounds.minY) panY = clientY - bounds.minY;
          if (clientY > bounds.maxY) panY = clientY - bounds.maxY;
          if (panX !== 0 || panY !== 0) {
            panX = Math.clamp(panX, -40, 40);
            panY = Math.clamp(panY, -40, 40);
            if (!panTimer) {
              panTimer = win.setInterval(function () {
                const step = 0.5 / Math.sqrt(self.scale);
                self.panBy(panX * step, panY * step);
              }, 1000 / 60);
            }
          } else if (panTimer) {
            win.clearInterval(panTimer);
            panTimer = 0;
          }
          if (handlers.move) handlers.move(evt);
        },
        cleanup: function () {
          if (panTimer) {
            win.clearInterval(panTimer);
            panTimer = 0;
          }
          self.endSnapPointRendering();
          self.setDragging(false);
          if (handlers.cleanup) handlers.cleanup();
        },
      };
    }

    handleSelectionDrag(e, targetNode, draggedNode) {
      const self = this;
      if (this.readonly) return;
      const start = this.posFromEvt(e);
      if (draggedNode && !this.selection.has(draggedNode)) this.selectOnly(draggedNode);
      const dragSet = new Set();
      this.selection.forEach((item) => {
        if (item instanceof BaseNode) {
          dragSet.add(item);
          if (item instanceof GroupNode) {
            for (const node of this.getContainingNodes(item.getBBox())) dragSet.add(node);
          }
        }
      });
      const originals = Array.from(dragSet);
      const origins = new WeakMap();
      for (const node of originals) {
        origins.set(node, point(node.x, node.y));
        node.nodeEl.addClass("is-dragging");
        node.updateZIndex();
      }
      let active = originals;
      let clones = null;
      const updateModifier = (evt) => {
        const cloneMode = E.Yl.isMacOS ? evt.altKey : evt.ctrlKey;
        if (cloneMode && !clones) {
          clones = active = [];
          for (const node of originals) {
            const origin = origins.get(node);
            const clone = new DummyNode(self);
            clones.push(clone);
            origins.set(clone, origin);
            clone.x = node.x;
            clone.y = node.y;
            clone.width = node.width;
            clone.height = node.height;
            clone.attach();
            clone.render();
            clone.nodeEl.addClass("is-dragging");
            node.moveTo(origin);
          }
        } else if (!cloneMode && clones) {
          for (let i = 0; i < originals.length; i++) {
            const clone = clones[i];
            originals[i].moveTo(clone);
            clone.detach();
          }
          clones = null;
          active = originals;
        }
      };
      const offsetRect = (node, delta) => {
        const origin = origins.get(node);
        return { x: origin.x + delta.x, y: origin.y + delta.y, width: node.width, height: node.height };
      };
      const computeDelta = (evt) => {
        const pos = self.posFromEvt(evt);
        const delta = { x: pos.x - start.x, y: pos.y - start.y };
        if (evt.shiftKey) {
          if (Math.abs(delta.x) > Math.abs(delta.y)) delta.y = 0;
          else delta.x = 0;
        }
        if (!self.canSnap(evt)) return delta;
        const groups = active.filter((node) => node instanceof GroupNode);
        let snapSet;
        if (groups.length === 0) snapSet = active;
        else if (groups.length === 1) snapSet = groups;
        else if (groups.length > 1) {
          snapSet = groups.slice();
          for (const group of groups.slice()) {
            const bounds = group.getBBox();
            const contained = groups.some((other) => {
              if (other === group) return false;
              if (!boxContains(other.getBBox(), bounds)) return false;
              const outer = other.getBBox();
              const inner = bounds;
              return !(outer.maxX === inner.maxX && outer.maxY === inner.maxY && outer.minX === inner.minX && outer.minY === inner.minY);
            });
            if (contained) snapSet.splice(snapSet.indexOf(group), 1);
          }
        }
        const dragBoxes = new Set(active);
        const source = snapSet.map((node) => offsetRect(node, delta)).map(boxOfRect);
        const targets = self
          .getViewportNodes()
          .filter((node) => !dragBoxes.has(node) && groups.length > 0 === node instanceof GroupNode)
          .map(boxOfRect);
        const snap = self.getSnapping(source, targets, delta.x !== 0, delta.y !== 0);
        return { x: delta.x + snap.x, y: delta.y + snap.y };
      };
      return this.handleDragWithPan(e, {
        move: function (evt) {
          self.clearSnapPoints();
          updateModifier(evt);
          const delta = computeDelta(evt);
          for (const node of active) {
            node.moveTo(offsetRect(node, delta));
          }
        },
        end: function (evt) {
          for (const node of originals) node.nodeEl.removeClass("is-dragging");
          if (clones) {
            const delta = computeDelta(evt);
            const data = self.getSelectionData(new Set(originals));
            const cloned = self.cloneData(data, delta);
            const imported = self.importData(cloned, false);
            self.clearSnapPoints();
            self.selectAll(imported);
          }
          self.setDragging(false);
          self.requestSave();
        },
        cancel: function () {
          for (const node of originals) {
            node.moveTo(origins.get(node));
            node.nodeEl.removeClass("is-dragging");
          }
        },
        cleanup: function () {
          if (clones) {
            for (const clone of clones) clone.detach();
          }
          if (targetNode) swallowNext(targetNode, "click");
        },
        keydown: function (evt) {
          updateModifier(evt);
        },
        keyup: function (evt) {
          updateModifier(evt);
        },
      });
    }

    async takeScreenshot(filePath, garbleText) {
      const wrapperEl = this.wrapperEl;
      try {
        wrapperEl.addClass("is-screenshotting");
        if (garbleText) wrapperEl.addClass("is-text-garbled");
        this.deselectAll();
        this.app.statusBar.containerEl.hide();
        await env().sleep(10);
        await nextFrame();
        const bounds = boxUnion(Array.from(this.nodes.values()).map(boxOfRect));
        const topLeft = this.domFromPos(point(bounds.minX, bounds.minY));
        let x1 = topLeft.x;
        let y1 = topLeft.y;
        const bottomRight = this.domFromPos(point(bounds.maxX, bounds.maxY));
        let x2 = bottomRight.x;
        let y2 = bottomRight.y;
        const viewRect = this.canvasRect;
        x1 += viewRect.cx;
        y1 += viewRect.cy;
        x2 += viewRect.cx;
        y2 += viewRect.cy;
        x1 -= 10;
        y1 -= 10;
        x2 += 10;
        y2 += 10;
        const wrapperRect = wrapperEl.getBoundingClientRect();
        if (x1 < wrapperRect.x) x1 = wrapperRect.x;
        if (y1 < wrapperRect.y) y1 = wrapperRect.y;
        if (x2 > wrapperRect.right) x2 = wrapperRect.right;
        if (y2 > wrapperRect.bottom) y2 = wrapperRect.bottom;
        const captureRect = rect(Math.round(x1), Math.round(y1), Math.round(x2 - x1), Math.round(y2 - y1));
        const remote = wrapperEl.win.electron.remote;
        const image = await remote.getCurrentWebContents().capturePage(captureRect);
        const png = bufferFrom(image.toPNG());
        await window.require("original-fs").promises.writeFile(filePath, png);
        new E.fb(filePath, 10000).addButton(
          E.Yl.isMacOS ? E.gm.plugins.openWithDefaultApp.actionShowInFolderMac() : E.gm.plugins.openWithDefaultApp.actionShowInFolder(),
          function () {
            return showInFolder(filePath);
          },
        );
      } finally {
        this.app.statusBar.containerEl.show();
        wrapperEl.removeClass("is-screenshotting");
        wrapperEl.removeClass("is-text-garbled");
      }
    }

    async generateHDImage() {
      const self = this;
      const wrapperEl = this.wrapperEl;
      if (this.nodes.size === 0) {
        new E.fb(c5.msgExportFailedEmptyCanvas());
        return;
      }
      const win = wrapperEl.win;
      const doc = wrapperEl.doc;
      const remote = win.electron.remote;
      const contents = remote.getCurrentWebContents();
      const appZoom = Math.pow(1.2, contents.getZoomLevel());
      const pixelRatio = win.devicePixelRatio;
      const scale = Math.round((pixelRatio / appZoom) * 1e5) / 1e5;
      const inkBoxes = window.__fpInkBoxes ? window.__fpInkBoxes(this) : [];
      const bounds = boxGrow(
        boxUnion(Array.from(this.nodes.values()).map(boxOfRect).concat(inkBoxes)),
        100 + 160 / Math.max(0.15, this.scale),
      );
      const contentWidth = bounds.maxX - bounds.minX;
      let contentHeight = bounds.maxY - bounds.minY;
      const maxZoom = Math.min(4, 16284 / scale / contentWidth, 16284 / scale / contentHeight);
      let filePath = "";
      let zoomFactor = Math.min(2, maxZoom);
      let sliderZoom = Math.log2(zoomFactor);
      const sliderMax = Math.log2(maxZoom);
      let showLogo = true;
      let privacyMode = false;
      let frameMode = "full";
      // export options dialog
      await new Promise((resolve) => {
        const modal = new E.tb(this.app);
        modal.setTitle(c5.actionExportPng());
        modal.modalEl.addClass("mod-narrow");
        const contentEl = modal.contentEl;
        contentEl.createEl("p", { cls: "u-muted", text: c5.labelExportPngDesc({ title: this.view.file.basename }) });
        new E.zk(contentEl)
          .setName(c5.optionExportPngFrame())
          .setDesc(c5.optionExportPngFrameDesc())
          .addDropdown(function (dropdown) {
            return dropdown
              .addOption("full", c5.optionExportPngFrameFull())
              .addOption("viewport", c5.optionExportPngFrameViewport())
              .setValue(frameMode)
              .onChange(function (value) {
                frameMode = value;
                const isFull = frameMode === "full";
                zoomSetting.setVisibility(isFull);
                logoSetting.setVisibility(isFull);
              });
          });
        const updateZoomDesc = function () {
          return zoomSetting.setDesc(
            c5.labelExportPngDimensions({
              dimensions: `${Math.ceil(contentWidth * zoomFactor * scale).toLocaleString()}px x ${Math.ceil(contentHeight * zoomFactor * scale).toLocaleString()}px`,
            }),
          );
        };
        const zoomSetting = new E.zk(contentEl)
          .setName(c5.optionExportPngZoom())
          .setDesc(c5.optionExportPngZoomDesc())
          .addSlider(function (slider) {
            slider
              .setLimits(Math.min(-1, sliderMax), sliderMax, "any")
              .setValue(sliderZoom)
              .setDynamicTooltip()
              .onChange(function (value) {
                sliderZoom = value;
                zoomFactor = Math.pow(2, value);
                updateZoomDesc();
              });
            slider.getValuePretty = function () {
              return Math.pow(2, slider.getValue()).toFixed(2);
            };
            return slider;
          });
        updateZoomDesc();
        const logoSetting = new E.zk(contentEl)
          .setName(c5.optionExportPngShowLogo())
          .setDesc(c5.optionExportPngShowLogoDesc())
          .addToggle(function (toggle) {
            return toggle.setValue(showLogo).onChange(function (value) {
              showLogo = value;
            });
          });
        new E.zk(contentEl)
          .setName(c5.optionExportPngPrivacyMode())
          .setDesc(c5.optionExportPngPrivacyModeDesc())
          .addToggle(function (toggle) {
            return toggle.setValue(privacyMode).onChange(function (value) {
              privacyMode = value;
            });
          });
        contentEl.createDiv("modal-button-container", function (buttons) {
          buttons.createEl("button", { cls: "mod-cta", text: E.gm.dialogue.buttonSave() }).addEventListener("click", function () {
            modal.close();
            resolve();
          });
        });
        modal.open();
      });
      const chosen = await remote.dialog.showSaveDialog({
        defaultPath: this.view.file.basename + ".png",
        filters: [
          { name: "PNG Files", extensions: ["png"] },
          { name: "All Files", extensions: ["*"] },
        ],
        properties: ["showOverwriteConfirmation"],
      });
      if (chosen.canceled || !chosen.filePath) return;
      filePath = chosen.filePath;
      if (!filePath) return;
      if (frameMode === "viewport") {
        await this.takeScreenshot(filePath, privacyMode);
        return;
      }
      let popupWindow = null;
      let objectUrl = "";
      let watermarkEl = null;
      try {
        this.deselectAll();
        const body = doc.body;
        wrapperEl.addClass("is-screenshotting");
        if (privacyMode) wrapperEl.addClass("is-text-garbled");
        this.screenshotting = true;
        body.appendChild(wrapperEl);
        const edge = 5 / appZoom;
        wrapperEl.setCssStyles({ top: `${edge}px`, left: `${edge}px`, bottom: `${edge}px`, right: `${edge}px`, width: "auto", height: "auto" });
        if (showLogo) {
          bounds.maxY += 80;
          contentHeight += 80;
          watermarkEl = this.canvasEl.createDiv("canvas-watermark");
          watermarkEl.setCssStyles({
            position: "absolute",
            left: `${bounds.minX + 80}px`,
            top: `${bounds.maxY - 80}px`,
            transform: `translate(0, -100%) scale(${4 / zoomFactor})`,
            transformOrigin: "bottom left",
            display: "flex",
            whiteSpace: "pre",
            alignItems: "center",
            gap: "3px",
            zIndex: "9999999",
          });
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttrs({ viewBox: "0 0 143 25", width: "100", fill: "currentColor" });
          svg.innerHTML = '<image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEEAAABgCAYAAABCBx/WAAAaQklEQVR4nO1cCZBlVXn+zzn33rf0NjPssgUlic5kIDqOIqAPRHRYRFl6ggISEEdCRSUYy2BC3jRlDDuirKNSapRQ0zrKThSc6VGQskIlLkyVJRU0zkIzTU8vb7v3niX1n+Uu771uemZ62oWcqTfv9V3P/5////7v/8+5F+D3oCkA8rvuw/+332WrVqsUv9dXB3vtpleXRWysVj38/sY/fvCf7r7y3E1Zpbwq2sZqRSvgezd95KwHP3eJ/NJV56mb15x+IW5bPzjIFro/ZKFvuH79IFu9elg8efNHjy2Xg5EXtr7ct2uqAVzIUUro8rH9v7sLjxsaArlQfaKwgE1VqxQV8Ngtaw4plrzvMI8OTNVDjA6qXAwOaYbRDSj8si2DCzo4dKFupJSxul9UB4OSx+4vFwtHje2qCyElpZSyZhSLwPcuvfGy0965enhYLKRb0AW6D9m0tsrI0JB8ef/9v9xfLr6j3gz5ZK3FOBcgpQKigDBKASj7/G0fW1UYtuf90ShhY7XKTh4a4hu/cMU1A72li2qtkAupvKnplpZToZlQSoUUoq8ULBex/8lhYw0L0j+6EKEQFfD9Wz56QU/Rv7bWCDmjhIWxhGYYAyXoKgqklBD4Ho1iLj1KP3PTmjNfv3p4WC5E2KT7OhKgAh67Yc3bigH7SiuKZcQFI5SSeihASQlAUosnlBAESUZJj5TqJoSSZVu2kD9YJSgbCb7/+TVH9JS89QCkEHGBo06kojA5Wc/Kj8AJUihgjLJ6KxKlgnfGjR854/yFAElvX1xUm/DatWrjATt7lVAbAt87rNYMBSGEEVDQigXU6k0gxOABKgAbFxI8jwIBQoRUymPs+ls/8b7Hn1u0dAqTLPScPxRLIGuXbSGEEBW1oq+WC96K6UaLEwCGAlPKYKrWgjCKrRLwFFSEAiGlDgeezygXUvYU/SNUSw4NDQ3J4X0IknS+L7ixWmFk9bB45LpLb+ktFc+dqLU4yiXR3KUE6nkwXWuBksYCspaATSoFhUAbKK2HkWCUXnHjmtPfim4xuI/cgs53TnDy0Ah/8PpLL+8pFf5uqtHioMBDHqDDIAoJFGq1Jvq+VYD5oDXgfs4lFHwGlBAihEQb8aQkd1RtvrEvuAOdrwtVrQIeue7Dp5Z9//ZWhAattAvg6KJAzPMgkgxarTDFA3u+sk6PLoGkyfcZCKlYGHNRLvgrSlt7rthX3IHOx0UQvYeGRviGay96A6Hkfi4kjQXCABBUAAoohAAWFGBisg5SikT47LBag4Aw5toljGIIDWMuKSVD11226rDBfcAd6N5eADuEpGZ99cNLKGPfZoQsCSMuQRGKbuA+Wjrqw/jLu4AiPbZAoPcgNjglEALNVgzFgu+AkyC9LPjeIiXIjWQfcAe6NydjB5ct20LQRCmJ7i/63hvqrYgrAOZwAOXSJs48iAXA9HQNKbLhBVY35mLpzwgPtACJYIqhtRXFolDwz7/uktNOm2/uQPfm5LVrK7o2AMtKt/eWi6dON0OuFAKZTCxAY4KQ4BdLMD5RA84xWCBbSJuxAguQ9htdoq8cGEVZheN1Bajbbrzw1J7nli7VdgO/SyVsrFY8xIF//+cLPtVb8i+fdpFAh0IDhvqjFSGh1NsP4+OTiPo5YaX7nVEIukGjGUNvuQCUmuOlUrQVc1EM/D9tUHo1cof5Akm6N5Hgq58+/2yP0htqjVAgkmsQdKNvrQGjguf7wIp9MD05BZQxGxLTlg2VOpQS0MmVH/jQWwo0k7SgSZthLBmjV1UvWbUU3WI+QJLuaST42qfPf2PBZ18XXMqYS6JzAmcB9ltIBXEcQf/i/WCq1oQobGlQdBaQCN52D7QEVGKzxaG/rwxcmGiCwUIqpQKPlZhQX8Bj5wMk6R5EAnHf1ecf5Hn0W5SSXpsU6UjghErdAMmPgPLAEtixbYdB+y7XVW0fPB+VNTFV1y6R5xREV6FKRf+Uz37otA/NB0jS3Z0levS2jxUiBRt8j722GXIBBGin8KlL+H4AwALYOToKvu8nrpAVumvHKIHpOloO0eESrco1rEKFsVCKquv/5ZJVByBIVqt7jm90jseRtdUKQzD67a+3f6XosePrjYhj6u9CncEDC4rOCuIY+hcvhunpOjTrdSDU4EFOcIOLuY87P+YC6s0I+nuKOsJkTqEx59Jj7OBaKD6H/dqb4iydy0GIwogDX/rkuWv7yoULdChETp90GAW3ikj8HesDHJYc9BoYfXGn7XwqfiI05POHxFLQJQiByakGLOorGTu0ysb7KkVoM4qEz+iHr/7Auyp7k2DRueLAnVeec1HB96sNDOBIhnTHZQ7kssCIBMkPClDs7YfRHdu0K2QZZBoN0nslzNH+RlyYboQQ+EwTJ3SJDJgSVAajhHiU3HrPmhW+vQyZVyVUq1WKpnbr5Wf9OVGwLoy4EkKiC+hIoLLRQFqFOFOOY+hbtBhqtQZMT0wB6RIac8LbTxYoMFTGsYBWGENvqaDDbXqI1hiLOBelYvDG39aXXLmnCRadffcmvZ8LcarvsWLEkQ6YUJgFwiw5MqOkdFToHeiHbb/531TS9lwh3Zzuy/0z4zpZa0FfTwGEtRxDttxZhLbCWBJCrvmHD57y2j0pztLZdi7bcqC+lZRqZcyF7lVeAVlMyLsDY0y7wI7tO3QK7XAiRw0dJU5E7iRRiAvOJRhF/pAeaZVIIiEUpaQviiVyB7VlN7kDnWUfMYys4imAt4QRR0Kkw6Fjhgk1dkBoFYAmXCyVIAwjnTBRhlljRrjO8U710hYpsIUR10lVuRhorMlGEXtv1gxjUfC9M6489+TVw7sJknSmHdVqVWuz/Nvi6wDgtdgJoRTJ3lxaYHRUGb+xYe0Amd7YzjHtx+2Cz4oHXRrua2Co7C1YvtDmfiZMo5uiRdzw6cF3DSxdulSXI/ZKCbDJ4EEkyJt9jwVcSiG41Bd1ITHhBUnoMpaADK+3twde2rlLl9E6zTw/0t0Fz+cStWZkym7oEpnaZOYaNBZClgLvyFjytQjoq+cIkvSVDlAAb9ffUqlYJzL5ZCfpsCNIQkKh4APnsc4XTK7wyoK7dNopM9lmcwl0CVRwqYChUnacg42ArkIJ5rG//eTqU1bO1S3oTDuGRkaEjVIrOfohAJbBk4yuXRnONNH8+8oFGBvbpSNEWlZvEzqHJ53pdBZr3PFRzA0uCEeYMiBp9YDnEEK8OOa3VisVb+nwsNojJVQND1fVi848nBB4fYzVMgCcENFK0OQtGxHakqeecgDjkw2N7I4ntiuto6jiZqHa9uMvPdKEQL0ZQ8EzA5t1BxeWbcRirTBWipATRgfU8iGAVwyZtNtGx8N9j68IfK8ssW6sZ88VoEKc+aWdSa0g8HSVWMd24kLaDElTp5vMjh2tiAOWJ3GWSrPHhHKnCtQfUCLwmPIZPT6Lb7ulhOdeeskAoCRv1ZUgjUWWCQqjBDTz9g5rV+gpwHQ91KabTZ2N+WZzBktw7WXMSM6OHcYdFRQ1hTZumbhhzioNnWaUaDzbcqDhO7ulhLWbNB6AUOIEC4aJNJoH8FxG5/J8/d1TLsCuqab+u92v03Oy6Xb3Y5xi81GCaAqNSnAKw29UgFYC/m2gVKMxofCWj61aVUCAnC2noB03NmCsqoOnHyykOsYUTQh1QIRNV9QzvXYYgawOXWDS1gFSN0hN1wmcHe0sJrTPSmWVTaxL+IwCI0RbgwvRKdCiFQDFChQAHElKjWPw/MFZwiVt3+BiKw/iYwLP68dFRQqUxgNnwmgd2SIHNuwAVoFwziAM0RU6fb5jsBOS1J0tdRApPUNlwrFvcQFH3uBAqkRKtAiigOBByYn4x1Lr4nNSwlJ7MKXqOJwOM2WCPBLjzdFC0GTclXE7ugICYjvGJUZjhUkjRCp4N8rcXnZz18FiC1qdqVS7hCplox7T/dKwxYhRwmy4QDu2nDSiHV5JcqJASmipctbc8M643Cbrx75nEpzJaesK2bkEhwEZ2qzmTJk7yRkOQKAndB0wZmoQhIDHKGrARji6snrmmeXZcIG2/U1wHWH1glX9SsFynCFGjDDkJT+NHgkBSKJMZVhBuRRAKxJ2HVKKB3mB5iB0hht0q0Tj3+iOeF9DofOpqcYLSnAtFCZ7ymfssHCguSybD82qhEGLB5ESyyklB8dC4HVoWgZLy1vI2sJY2IVXAD2lQBdGzbxjp9CdEaKzwpxMxGQA030ndcxMTaHg0TbOAhBoGDAKQuws+h6hir5tNr5Au+GB4OIEs35A1zFycwlZf0akxs4h/uDxEzmC9Aq5QdZNMvQ3AboON3DM0xyncxSfueTCFBYI0UpAIbQitBXrMuApuhMnndR1qTDN/ZUe9HYjtLRT6/mwZgQkOlSiNaArYKcarViPQDfBu1LlDNPrVnPMHpcQKbsdwRmBO53MAfAZKoFpnWjQJoQiuZIKVn7qrOP7MLPsll7TzG+CB605c0VZARyLQumFpjm0ToXRq06UglorhnLR19UfXTvI0Nd8DtDdBWYqquTYY04rdr2DXfmCGODcAxXgaTfQmIADQpSSyvfYIaRUWI6nd0uvqfvhQGOgd/FSxuihHJ1eAXWj6QK1C4uOB6BL4B/jU03jCu1COWHbRjvNDjtHOqs4c0x74pWSMBx914roHtoCzOSN/SfKgQ8F3z9+Jr5Ak18JaMg3Bx5Dhqipc9LbrPB6DYGE3pIPb/iT/XU5bboR2ajQyQDbBjKvjBxTyI52PixmFet+OJfAjmFYLAUswQP9T7uFMX9i6yLdcMFzPxyZEAKOlwxNDa/Q6UB6rSFjcMRB/TDQW4StY9MwUA60haD/IUhm6XJaTG1bmpP5lcrZPW52wwm33YRDgwXIVXRly0qNEIkYwM3yoDdXByu9Q0NDNcf02y2BIJmoDi4NlFLH6cIJKA1xruMuFO3XX4JD9uuB8VoLfrxlG2z59RiMTTXhgEVlmGpGmsiko90pVqd7dBd6tmwS2ipK1LqCR2kKitZqER6wEOAz+hpZLC7vlkfQLB7U4OCjKSVH2UWVep8Dr56iD/sNlKAecvjpC2Pw/PYJHR2w3DW6q6HDFWZ3GC3wY9hbMtY5E59ptGcSOkugEtDNhEvjCl6igIQnGBTDfmAlGu2iKy7QLB54DN5UDnxPgdJ44DLDnoKv2SAK/uvRKU2U8KKu1VsRTDUiWNJXTEIeTlijezgpcoDXZRI2J3Bb6c1NtiQ9z5yjp/s8Cj1FL5mn0MrAnckPwxcoISdlU4OcEpa55EKRdxjKTbF0rS+Owm8dr8O28boeYReHXRUYj/cog9FddegrBQkwgaW3aU1yFubYVqd0h7RjSDtXwGMRGMs4dY+Lw+3ou7N1lDB8QS8MBVArrr/0rD77fBXJKWH18LDWDJdyBU6yItbgIuzRySa8NNXUEx/6BrZmiGbuAEmbo0dgVy3UQveUzBoEY4YmWvDMSraOWmOGLbZrJyd42wFoAeiKBwyU9DXG6y2YbuF6afv0gPNnIyq1C8YPacTRsbghO2dJXVH1isHK0UKq5eO1UI1NtwgKheaMwhpmht9GsGxpLQFOqTRALuopWLM0O12HErDMVaNmdo+sz2dzCxOehQbiIw8e0KEZU2vsFxK3XfXIRA17YwOQ+lvjAiPq7dkSolbC2iETvQSw5kQj3tmIBJqORLBxo5+6Vvcgpm/KCOycbOowpStMmrs7cLIKyZQVswTpFd3DskO8ZhRFcNShi+Go1yyBraNT2kVdWR/vhtFpF9Y4UTF2JPALxdCpAKgT2/kCxUHC6HDP8A+2SSHOZhR2FbBUa4o1HTwhvww3BTDcjjdu6Gl0M2doBsMp0pzpZNYds6jfDROyunHX4WEIK4/5Mzj6qEPhZ7/aAQ1bwcoWudAikERNNCK9P72PnqHCkvybsFSQzSMo/ocbcKbm69975idcijOFVE0cSIUA0T7qTnh7Zx2ObCEDU9uXp1pQLng5lE4+1p2cn7hkKwFC6z7uENdwwknEEbznPe+Aw448HDY/85wOz6aOmTKf9hBcD2OYbsY20SR2eTA72AvgmGweQd0JSJYqlYr31Ud//HSzFX1AKIgtECZxzqXQuB3NH9NngxkWfbCy1EBTxLBlFmXkBLMr2bPuhQQHk54UN+x0v1Wy+S1g1TvfCoVCAR59bCMorUBTS+iWrLlr433QXRAnNNOlVCCXIQpOyJUSIdNGRkY4Tl3d9+RPHpCSnx94FJ/U00pGf0OAZMQWLSwra096sO2qGWtwqb7D0cQysn/bZAezwWxFChWNYQ33n7TyaJiYmIAHH3oCKENS1DnJ60JzLku1gRAViWw25FxXydz8qsMFAl0aKmJoZISvOePEvwkK3p0RPrtgeYhLqZOTbdrqEhbNFCmBIw/og8l6mHMj6Bgt7HQqjHneQUEscKWLCbcnHnsEbHtpGn76qx1QsjzEheDkoagc2bLZbka6ZLCUUmgJHoMx0iKvHxr+3jgaJ+2mBFQAusa6R350V6MVfRwf45Ug9Vod7Q7W9J07aD93AIUleS6hGXFNo5Mk1IUqZ0GJ4CbjszrS18L0GBXwtr84DH6zYwJ+9vyLUCoGZmGIrVolayazHMSKn1bAU3ZpcUbGQpJGKPpCXyzCY9ZWq92VkHWNex99+ovNiH/WZ55HiBIotAufHYmMZWiIF9N2PUFS+24T3AGnjQ8Zs0Y3UHDo/n2w9aUpeO6Fnbp+2Z5zJOCZXD9NyPORxvwTQuLzVEyBehmAvPe6+578H7cwjc6kBGsRGiy/9vjT18RC3NpbKnoYqdJCi4sOusSdxGvc1oyENm2cA3Bg6nAk64TGrDPjlwHS0fG6pu6GerfNQmeIVTqr5UJtRlEGaIXnMSalHG1yseqm9U8+4RSgZYDZmxoZGdELHe595Kmrooj/W7lQ8AgA14JbAbJ1B2MNZnxrLbSG1CVwaw4cs4hkrQibnjcAs9LdzWm6TNLZzUyRwV0rsQoAXgx8JqR6vh6GlTu+PfKfGvOsAuaiBGxq2C6Lu+vBzReHER8uBr4nlcRFnclFTLKSIj+KUW9x3R87D5BQ7iSEWSVmz8NuY0KkS3eaDULXlmOf5rSEhbo6pJSKlwLf40I8G4atyt0PPv1LHFDEvOy1KMytKQDDr3cG4cWNMH4CFUGp4k6ADmZJiE6oTOaZ3qYdIDPq0GQKgzECaivmdgVr90mbNKdIXSL7AIlUivuMea0o3hiq6LQ7Hnx6OyrAzkR1KHTOrQpAceXHhace0zPQswgVcVwrwkor9TKwlygFO4UC7ddb0BiRTtJ2ZiBuCyL+gYt7YKIWws7JhqkmZzrqfs9QcHKWwwu+5zXD+NEXd4TnDT/zTHMmBWCjc1cB2oJZ+vKN7/+sHjfVOVEsfu572umFI1COq+uL44KrWOi4r6NJAlhpPpGj1RZT8FjEE62UHMrnFdatKYUK8L0w4t940TvwLFQA9nkmBej+wB40p9XLVlUOK5XhaY+yw2PO9QPhuYtrtgbQXw40g9QZ30ydtytVUAH9PQVdwUri+9w6ry+ByV/Ixa1f3LDpKjykWjXzq7PJQ2EPmlsa9+XHR7bGYXS6lHK7jyVoZcpyaQ5v8gqcm3A1hlyC1B4q7WRKvRVrwqWpSAYH2oJJ6kI2eASBhytbP4sKwDqJmuNbeuieKCGriLsf+fEvYqHOAIBp3/cYYlRSdLF5AVaWkqwvI0Q2j3ANWWgz5NlFWPqTID+2TIlNKiWRnjBKaRjGf3/HA5uv0RFgCCF2Vs/ZeyVg02X6SsW784GR/44Ff79Uqs7wnQEA0uUTLtVFGu2sI1tfwJZmmsYaMDS6NDlHkNyUffqqAdQLln5oS/C/vv2BzTdjfzCkvwJ05BqFvWwYc/HGt3/nhz8IQ/Eh7Dymxyl/MWxRL/ER+IBXeq5RREqpEUh1pVpP+Xd/aCytPSqJM2VMr/TnZ9/93R9+zSV+u6MAbBTmoTlF3PXQ5g0K1EVIlRkjeplLktHZypMp2aXnphbg8ANL9enyYUc3k2wRbVwq4TMP1028rECcse7hH303o4DdbhTmqTlFfP5bm77Jpfp44CE+EARKnXbiyJpVb1nh85iASkArwJatC+Sq0jYP4FKOhqE4HS1wbxSAjcI8NqeIW4Z/cEc9jD4TeAwTLpGtFWiAbENDU1gxAjf1I1a2ZQo2NlPkGAKllM+3mnHlnkd++JO9VQA2CvPcMPPEhzW/uGHkX1tRfFshwFkJgs9Ra2GRDmMjbf9MgdTQbGzJ6jZbuhJSahIUc/lfTckr9/5H9zxgTxqF+W9Kv08BFfGdkSvjmN/TU8KpPdCdxfivF4m3hUa9nD826yNzrx4yLIgHmgbzzYJEq+6dJQ/Yk0ZgHzUceFfNPRzG7vc9dl4r0u8N8HDytLfg5xZdIR6M10KYaISZgou+Ei8GgdeK+GPbtzfOe/jZZxvzqYB9qgRsjvVWKhX2l/vB46VicEoYcY6PMvaX/IQLYMPfL040NLt0Ez5OATEX3xwLDrpY85Iq0Pl+VyOFfdjMxA4QLMw0mX9uHIunSgWsRSgeZR77RYHRRRA0LYlCIOAFHy0gvu2uBzZfqGsamMXug5dVUtjHTS8OrVbJuuEnJiOIzo64+CVGDXxMxx2jp9csVujyPgEVeL7XCOPr1z30oyvdw+CYxe6LPhJYoOb8+IpzTj6yQNWTjLHXlXwqCj6WZYmePxybbqnAoyrw8G188dXrHn7qOnvebtHg39s3cw7bhOvODRt/E8XybKXUTnwXArFznmEs9CSwxxht8fgyVMCe5AG/9+9oHbYvfLjjgc0/B6VOi7ickKDXFOEqAOpREnPOL/jyQ099pbKHecCeNAoL3PRTt5WKd/PwxmfDOPwrKRU+MYZv5JmQHM5Z9/BT9+F+nPeAP/ZWrZh3qV178bvff82F737h8veecBz+vWZF8gqAV0er2kf1PvG+yqJX3Ru8s80tlNibd6L8UTS1gKG6W/s/B21XA7JZRm0AAAAASUVORK5CYII=" x="0" y="0" width="17" height="25"/><text x="25" y="19.5" font-size="21" font-weight="700" font-family="Inter, Segoe UI, system-ui, sans-serif" fill="currentColor">Basalt</text>';
          watermarkEl.appendChild(svg);
        }
        popupWindow = window.open(
          "about:blank",
          "_blank",
          `popup,x=${win.screenX + 5},y=${win.screenY + 5},width=${win.outerWidth - 10},height=${win.outerHeight - 10}`,
        );
        if (!popupWindow) throw new Error("popup blocked");
        const baseEl = host.createEl("base", { href: location.href });
        popupWindow.document.head.appendChild(baseEl);
        popupWindow.document.title = "Basalt";
        host.applyEnhancements(popupWindow);
        host.mirrorStyles(popupWindow, [baseEl])();
        const progress = new E.pD(popupWindow.document);
        progress.show();
        progress.setMessage("Съёмка холста…");
        if (window.__fpExportOpen) window.__fpExportOpen();
        let stopExport = false;
        progress.el.createEl("button", { cls: "mod-cta", text: E.gm.dialogue.buttonStop() }, function (button) {
          button.style.marginTop = "20px";
          button.onClickEvent(function () {
            stopExport = true;
          });
        });
        this.onResize();
        const popupRect = wrapperEl.getBoundingClientRect();
        const left = Math.ceil(popupRect.x * appZoom + 1);
        const top = Math.ceil(popupRect.y * appZoom + 1);
        const shotWidth = Math.floor(popupRect.width * appZoom) - 2;
        const shotHeight = Math.floor(popupRect.height * appZoom) - 2;
        this.zoom = this.tZoom = Math.log2(zoomFactor / appZoom);
        const captureRect = rect(left, top, shotWidth, shotHeight);
        const tileWidth = shotWidth / zoomFactor;
        const tileHeight = shotHeight / zoomFactor;
        const tilesX = Math.ceil((bounds.maxX - bounds.minX) / tileWidth);
        const tilesY = Math.ceil((bounds.maxY - bounds.minY) / tileHeight);
        const centerX = bounds.minX + tileWidth / 2;
        const centerY = bounds.minY + tileHeight / 2;
        const outCanvas = doc.createElement("canvas");
        outCanvas.width = Math.ceil(contentWidth * zoomFactor * scale);
        outCanvas.height = Math.ceil(contentHeight * zoomFactor * scale);
        const ctx = outCanvas.getContext("2d");
        this.viewportChanged = true;
        this.requestFrame();
        await env().sleep(500);
        const total = tilesX * tilesY;
        let done = 0;
        for (let row = 0; row < tilesY; row++) {
          for (let col = 0; col < tilesX; col++) {
            if (stopExport) return;
            if (window.__fpExportTile) window.__fpExportTile(progress, tilesX, tilesY, col, row, done, total, 0);
            this.x = this.tx = centerX + col * tileWidth;
            this.y = this.ty = centerY + row * tileHeight;
            this.viewportChanged = true;
            this.requestFrame();
            await env().sleep(100);
            await win.nextFrame();
            if (win.requestIdleCallback) await new Promise((resolve) => win.requestIdleCallback(resolve));
            const shot = await contents.capturePage(captureRect);
            const png = ownBuffer(shot.toPNG());
            const url = URL.createObjectURL(new Blob([png], { type: "image/png" }));
            objectUrl = url;
            const img = doc.createElement("img");
            img.src = url;
            await new Promise((resolve, reject) => {
              img.onload = resolve;
              img.onerror = reject;
            });
            ctx.drawImage(img, col * shotWidth * scale, row * shotHeight * scale);
            URL.revokeObjectURL(url);
            objectUrl = "";
            done++;
            progress.setProgress(done, total);
            progress.setMessage(`Съёмка секторов (${done}/${total})`);
            if (window.__fpExportTile) window.__fpExportTile(progress, tilesX, tilesY, col, row, done, total, 1);
          }
        }
        progress.setMessage("Generating final image");
        const blob = await E.Jc(outCanvas, "image/png");
        const data = bufferFrom(await blob.arrayBuffer());
        await window.require("original-fs").promises.writeFile(filePath, data);
        new E.fb(filePath, 10000).addButton(
          E.Yl.isMacOS ? E.gm.plugins.openWithDefaultApp.actionShowInFolderMac() : E.gm.plugins.openWithDefaultApp.actionShowInFolder(),
          function () {
            return showInFolder(filePath);
          },
        );
      } finally {
        this.view.contentEl.appendChild(wrapperEl);
        if (watermarkEl) watermarkEl.detach();
        wrapperEl.removeClass("is-screenshotting");
        wrapperEl.removeClass("is-text-garbled");
        wrapperEl.setCssStyles({ top: "", left: "", bottom: "", right: "", width: "", height: "" });
        this.screenshotting = false;
        if (popupWindow) popupWindow.close();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        await win.nextFrame();
        this.zoomToFitQueued = true;
        this.onResize();
      }
    }
  }

  return CanvasController;
}
