// Canvas interaction pieces: the selection bounding box with its resize handles.
import { env } from "./env.js";
import { box, boxGrow, rectOfBox, boxOfRect, sortedBoxPoints } from "./misc.js";
import { s13ResizeOrigin, s13MatchSpans } from "./s13-geom.js";

const s13CDiv = (...args) => env().createDiv(...args);

/**
 * The dashed selection rectangle drawn around the current canvas selection, with eight
 * resize handles. Dragging a handle resizes every selected node proportionally, honouring
 * snap-to-grid/object, aspect ratio (Shift inverts it) and the minimum size.
 */
export function defineS13CanvasSelection(host) {
  function CanvasSelection(canvas, className) {
    const self = this;
    this.bbox = box(0, 0, 0, 0);
    this.resizerEls = [];
    this.canvas = canvas;
    this.selectionEl = s13CDiv("canvas-selection" + (className ? " " + className : ""));
    const addSide = (name) => {
      const el = s13CDiv({ cls: "canvas-node-resizer", attr: { "data-resize": name } });
      el.addEventListener("pointerdown", (event) => {
        if (event.targetNode === el && event.pointerType === "mouse") self.onResizePointerdown(event, name);
      });
      if (name !== "bottom" && name !== "right") {
        el.addEventListener("dblclick", (event) => {
          for (const node of Array.from(self.canvas.selection)) {
            if (node instanceof host.s13CanvasNode) node.onResizeDblclick(event, name);
          }
        });
      }
      self.resizerEls.push(el);
    };
    for (const side of ["top", "right", "bottom", "left"]) addSide(side);
    const addCorner = (name) => {
      const el = s13CDiv({ cls: "canvas-node-resizer", attr: { "data-resize": name } });
      el.addEventListener("pointerdown", (event) => self.onResizePointerdown(event, name));
      self.resizerEls.push(el);
    };
    for (const corner of ["topright", "bottomright", "bottomleft", "topleft"]) addCorner(corner);
  }

  CanvasSelection.prototype.update = function (bbox) {
    this.bbox = bbox;
    const el = this.selectionEl;
    const resizers = this.resizerEls;
    if (!el.parentNode) this.canvas.canvasEl.appendChild(el);
    for (const resizer of resizers) el.appendChild(resizer);
    const rect = rectOfBox(boxGrow(bbox, 10));
    el.setCssStyles({
      transform: "translate(" + rect.x + "px, " + rect.y + "px)",
      width: rect.width + "px",
      height: rect.height + "px",
    });
  };

  CanvasSelection.prototype.onResizePointerdown = function (event, handle) {
    const self = this;
    if (!event.isPrimary || event.button !== 0 || event.pointerType !== "mouse") return;
    event.preventDefault();
    host.dragWithThreshold(event, () => {
      const bbox = self.bbox;
      const canvas = self.canvas;
      const rect = rectOfBox(bbox);
      const startX = rect.x;
      const startY = rect.y;
      const startW = rect.width;
      const startH = rect.height;
      const options = canvas.options;
      const snapToGrid = options.snapToGrid;
      const snapToObjects = options.snapToObjects;
      const minDim = canvas.config.minContainerDimension;
      const nodes = Array.from(canvas.selection);
      const nodeRects = [];
      const sizeRatios = [];
      const relBoxes = [];
      for (const node of nodes) {
        node.nodeEl.addClass("is-dragging");
        nodeRects.push(node.rect);
        const b = node.getBBox();
        sizeRatios.push({ width: (b.maxX - b.minX) / startW, height: (b.maxY - b.minY) / startH });
        relBoxes.push({
          minX: (b.minX - bbox.minX) / startW,
          minY: (b.minY - bbox.minY) / startH,
          maxX: (b.maxX - bbox.maxX) / startW,
          maxY: (b.maxY - bbox.maxY) / startH,
        });
      }
      const minW = minDim / Math.min(...sizeRatios.map((r) => r.width));
      const minH = minDim / Math.min(...sizeRatios.map((r) => r.height));
      return {
        move: (moveEvent) => {
          const pos = canvas.posFromEvt(moveEvent);
          canvas.clearSnapPoints();
          const { source, resizeX, resizeY } = s13ResizeOrigin(handle, pos, { x: startX, y: startY, width: startW, height: startH });
          let snapX = null;
          let snapY = null;
          let dx = 0;
          let dy = 0;
          if (canvas.canSnap(moveEvent)) {
            if (snapToObjects) {
              const srcPoints = sortedBoxPoints([boxOfRect(source)]);
              const nodePoints = sortedBoxPoints(canvas.getViewportNodes(true).map(boxOfRect));
              const dist = canvas.snapDistance;
              if (resizeX) {
                const match = s13MatchSpans(srcPoints, nodePoints, dist, "x");
                if (match) {
                  snapX = match;
                  dx = match.delta;
                }
              }
              if (resizeY) {
                const match = s13MatchSpans(srcPoints, nodePoints, dist, "y");
                if (match) {
                  snapY = match;
                  dy = match.delta;
                }
              }
            }
            if (snapToGrid) {
              const spacing = canvas.gridSpacing;
              if (resizeX && !snapX) dx = Math.round(pos.x / spacing) * spacing - pos.x;
              if (resizeY && !snapY) dy = Math.round(pos.y / spacing) * spacing - pos.y;
            }
          }
          const rawX = pos.x + dx;
          const rawY = pos.y + dy;
          if (handle.includes("top")) {
            bbox.minY = Math.min(bbox.maxY - minH, rawY);
            if (bbox.minY !== rawY) {
              snapY = null;
              dy = bbox.minY - pos.y;
            }
          }
          if (handle.includes("left")) {
            bbox.minX = Math.min(bbox.maxX - minW, rawX);
            if (bbox.minX !== rawX) {
              snapX = null;
              dx = bbox.minX - pos.x;
            }
          }
          if (handle.includes("bottom")) {
            bbox.maxY = Math.max(bbox.minY + minH, rawY);
            if (bbox.maxY !== rawY) {
              snapY = null;
              dy = bbox.maxY - pos.y;
            }
          }
          if (handle.includes("right")) {
            bbox.maxX = Math.max(bbox.minX + minW, rawX);
            if (bbox.maxX !== rawX) {
              snapX = null;
              dx = bbox.maxX - pos.x;
            }
          }
          const next = {
            x: bbox.minX,
            y: bbox.minY,
            width: bbox.maxX - bbox.minX,
            height: bbox.maxY - bbox.minY,
          };
          let lockAspect = nodes.some((node) => node.aspectRatio);
          if (moveEvent.shiftKey) lockAspect = !lockAspect;
          let aspect = 0;
          if (lockAspect && startH !== 0) aspect = startW / startH;
          if (aspect !== 0) {
            let w = next.width;
            let h = next.height;
            if (resizeX && resizeY) {
              const big = Math.max(w, h * aspect);
              h = Math.max(h, w / aspect);
              w = big;
              if (w !== next.width) snapX = null;
              else if (h !== next.height) snapY = null;
            } else if (resizeX) {
              h = w / aspect;
            } else if (resizeY) {
              w = h * aspect;
            }
            if (handle.includes("left")) {
              const newX = startX + startW - w;
              dx += newX - next.x;
              next.x = newX;
            }
            if (handle.includes("top")) {
              const newY = startY + startH - h;
              dy += newY - next.y;
              next.y = newY;
            }
            if (handle.includes("right")) dx += w - next.width;
            if (handle.includes("bottom")) dy += h - next.height;
            next.width = w;
            next.height = h;
          }
          if (snapX || snapY) canvas.renderSnapPoints(snapX, snapY, dx, dy);
          const bounds = boxOfRect(next);
          for (let i = 0; i < nodes.length; i++) {
            const rel = relBoxes[i];
            const target = {
              minX: bounds.minX + rel.minX * next.width,
              minY: bounds.minY + rel.minY * next.height,
              maxX: bounds.maxX + rel.maxX * next.width,
              maxY: bounds.maxY + rel.maxY * next.height,
            };
            nodes[i].moveAndResize(rectOfBox(target));
          }
        },
        end: () => canvas.requestSave(),
        cancel: () => {
          for (let i = 0; i < nodes.length; i++) nodes[i].moveAndResize(nodeRects[i]);
          canvas.requestSave();
        },
        cleanup: () => {
          for (const node of nodes) node.nodeEl.removeClass("is-dragging");
        },
      };
    });
  };

  CanvasSelection.prototype.hide = function () {
    this.selectionEl.remove();
  };

  return CanvasSelection;
}
