// g20 clean-room: canvas edge (connection) class, its geometry helpers and the
// offscreen SVG minimap renderer used by .canvas embeds.
//
// Replaces orig G5 (edge class), o8 (preview), b5/V5/z5 (helpers) and declarators
// U5/W5/_5 ($5/Z5 live in n-g20-shared.js).
import { box, boxCenter, boxGrow, sideMidpoint, bezierEdge, boxOfPoints, boxUnion, distance, point, pointOfEvent, pushOut, rgbTripleToHex, randomHex } from "./misc.js";
import { env } from "./env.js";
import { s13ApplyCanvasColor, s13NearestSide } from "./s13-geom.js";
import { ng08SuppressNextEvent } from "./n-g08-drag.js";
import { canvas, ng20EdgeEndRotation, ng20EdgeEndNone, ng20EdgeEndArrow, ng20CanvasViewType, ng20CanvasExtension, ng20FileExplorerViewType, ng20DefaultDateFormat, ng20RecoveryDefaults, ng20InterfaceStrings, ng20CanvasStrings, ng20DailyNotesStrings, ng20FileExplorerStrings, ng20FileRecoveryStrings, ng20EditorStatusStrings, ng20SyncStrings, ng20Finite } from "./n-g20-shared.js";


/** zIndex-ascending comparator used when ordering canvas items for serialisation. */
export function ng20ZIndexCompare(a, b) { return a.zIndex - b.zIndex; }

/**
 * Cardinal side of node `a` that faces node `b`: compares the centre delta on the
 * dominant axis; exact ties resolve to the horizontal axis, then to positive direction.
 */
export function ng20EdgeDirection(a, b) {
  const ca = boxCenter(a.getBBox());
  const cb = boxCenter(b.getBBox());
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

/** Pushes a side-midpoint 7 px outward, where the edge curve visually starts/ends. */
export function ng20EdgeOutset(p, side) {
  switch (side) {
    case "top": return point(p.x, p.y - 7);
    case "bottom": return point(p.x, p.y + 7);
    case "left": return point(p.x - 7, p.y);
    case "right": return point(p.x + 7, p.y);
    default: return point(p.x, p.y);
  }
}

// ---- bezier sampling ------------------------------------------------------------------------

function ng20Cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return point(a * p0.x + b * p1.x + c * p2.x + d * p3.x, a * p0.y + b * p1.y + c * p2.y + d * p3.y);
}

function ng20CubicTangent(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const dx = 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x);
  const dy = 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y);
  return Math.atan2(dy, dx) * 180 / Math.PI;
}

const NG20_PALETTE = ["", "#e03131", "#2f9e44", "#1971c2", "#f08c00", "#ae3ec9", "#0c8599"];

function ng20MinimapColor(color) {
  color = (color || "").trim();
  if (!color) return "var(--background-modifier-border, #888)";
  if (/^\d+$/.test(color)) return NG20_PALETTE[Math.min(6, Math.max(1, +color))] || color;
  const hex = rgbTripleToHex(color);
  return hex || color;
}

/**
 * Draws a static, non-interactive `<svg class="canvas-minimap">` into `containerEl` from raw
 * .canvas JSON text: nodes as rounded rects (palette colour applied, label text when it fits),
 * edges as straight lines between node centres. Invalid or empty JSON draws nothing; the
 * viewBox is fitted to the content bounds with padding.
 */
export function ng20CanvasPreview(containerEl, text, host) {
  void host;
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return;
  }
  if (!data || typeof data !== "object") return;
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const edges = Array.isArray(data.edges) ? data.edges : [];
  if (nodes.length === 0 && edges.length === 0) return;

  const byId = new Map();
  const boxes = [];
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    const x = ng20Finite(n.x) ? n.x : 0;
    const y = ng20Finite(n.y) ? n.y : 0;
    const w = ng20Finite(n.width) && n.width > 0 ? n.width : 100;
    const h = ng20Finite(n.height) && n.height > 0 ? n.height : 100;
    byId.set(n.id, { x, y, w, h, color: n.color, label: n.label || n.text || n.file || "" });
    boxes.push(box(x, y, x + w, y + h));
  }
  // edges contribute their endpoints' boxes only (already covered); keep viewBox on nodes.
  if (boxes.length === 0) {
    for (const e of edges) {
      const a = e && byId.get(e.fromNode);
      const b = e && byId.get(e.toNode);
      if (a && b) boxes.push(box(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x + a.w, b.x + b.w), Math.max(a.y + a.h, b.y + b.h)));
    }
  }
  if (boxes.length === 0) return;
  const bounds = boxUnion(boxes);
  const pad = 20;
  const vb = `0 0 ${bounds.maxX - bounds.minX + pad * 2} ${bounds.maxY - bounds.minY + pad * 2}`;
  const sx = (bounds.maxX - bounds.minX + pad * 2) / Math.max(1, bounds.maxX - bounds.minX);
  void sx;

  const svg = createSvg("svg", "canvas-minimap");
  svg.setAttr("viewBox", `${bounds.minX - pad} ${bounds.minY - pad} ${bounds.maxX - bounds.minX + pad * 2} ${bounds.maxY - bounds.minY + pad * 2}`);
  svg.setAttr("preserveAspectRatio", "xMidYMid meet");
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.display = "block";
  svg.style.pointerEvents = "none";

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  for (const e of edges) {
    const a = e && byId.get(e.fromNode);
    const b = e && byId.get(e.toNode);
    if (!a || !b) continue;
    const x1 = a.x + a.w / 2, y1 = a.y + a.h / 2;
    const x2 = b.x + b.w / 2, y2 = b.y + b.h / 2;
    svg.createSvg("line", {
      attr: {
        x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2),
        stroke: "var(--text-muted, #999)", "stroke-width": "2",
      },
    });
  }
  for (const n of byId.values()) {
    const g = svg.createSvg("g", {});
    const rect = g.createSvg("rect", {
      attr: {
        x: String(n.x + 2), y: String(n.y + 2),
        width: String(Math.max(4, n.w - 4)), height: String(Math.max(4, n.h - 4)),
        rx: "6", fill: ng20MinimapColor(n.color),
        stroke: "var(--background-modifier-border, #666)", "stroke-width": "1",
      },
    });
    void rect;
    const label = String(n.label || "").trim();
    const fs = Math.min(14, Math.max(8, n.w / 12));
    if (label && n.w > fs * label.length * 0.6 && n.h > fs * 2) {
      const text = g.createSvg("text", {
        attr: {
          x: String(n.x + n.w / 2), y: String(n.y + n.h / 2 + fs / 3),
          "text-anchor": "middle", "font-size": String(fs),
          fill: "var(--text-on-accent, #fff)",
        },
      });
      text.textContent = esc(label.length > 24 ? label.slice(0, 23) + "…" : label);
    }
  }
  containerEl.empty();
  containerEl.appendChild(svg);
}

// ---- the edge class --------------------------------------------------------------------------

const NG20_EDGE_KNOWN = new Set(["id", "fromNode", "fromSide", "toNode", "toSide", "fromEnd", "toEnd", "color", "label"]);
const NG20_EDGE_SIDES = new Set(["top", "right", "bottom", "left"]);

export function defineNg20CanvasEdge(host) {
  class CanvasEdge {
    constructor(canvas_, id, from, to) {
      this.canvas = canvas_;
      this.app = canvas_.app;
      this.id = id || randomHex(16);
      this.from = from || { node: null, side: "right", end: ng20EdgeEndNone };
      this.to = to || { node: null, side: "left", end: ng20EdgeEndArrow };
      this.color = "";
      this.label = "";
      this.unknownData = {};
      this.initialized = false;
      this.bezier = null;
      this.path = null;
      this.destroyed = false;
      this.zIndex = canvas_.getZIndex();

      this.lineGroupEl = createSvg("g");
      this.interactionPathEl = this.lineGroupEl.createSvg("path", { cls: "canvas-interaction-path" });
      this.pathEl = this.lineGroupEl.createSvg("path", { cls: "canvas-display-path" });
      this.lineEndGroupEl = createSvg("g");
      this.fromLineEnd = null;
      this.toLineEnd = null;
      this.labelElement = null;

      this.lineGroupEl.addEventListener("click", (evt) => this.onClick(evt));
      this.lineGroupEl.addEventListener("contextmenu", (evt) => this.onContextMenu(evt));
      this.lineGroupEl.addEventListener("pointerdown", (evt) => this.onConnectionPointerdown(evt));

      canvas_.markDirty(this);
    }

    get isAttached() { return !!this.lineGroupEl.parentNode; }

    // ---------- codec ----------

    getData() {
      const out = {
        id: this.id,
        fromNode: this.from.node ? this.from.node.id : "",
        fromSide: this.from.side,
        toNode: this.to.node ? this.to.node.id : "",
        toSide: this.to.side,
      };
      if (this.from.end !== ng20EdgeEndNone) out.fromEnd = this.from.end;
      if (this.to.end !== ng20EdgeEndArrow) out.toEnd = this.to.end;
      if (this.color) out.color = this.color;
      if (this.label) out.label = this.label;
      return { ...this.unknownData, ...out };
    }

    setData(data) {
      if (!data || typeof data !== "object") return;
      const unknown = {};
      for (const key of Object.keys(data)) {
        if (!NG20_EDGE_KNOWN.has(key)) unknown[key] = data[key];
      }
      this.unknownData = unknown;
      if (data.color !== undefined) this.setColor(data.color, false);
      if (data.label !== undefined) this.setLabel(data.label);
      if (typeof data.fromNode === "string") {
        const node = this.canvas.nodes.get(data.fromNode);
        if (node) this.from.node = node;
      }
      if (typeof data.toNode === "string") {
        const node = this.canvas.nodes.get(data.toNode);
        if (node) this.to.node = node;
      }
      if (NG20_EDGE_SIDES.has(data.fromSide)) this.from.side = data.fromSide;
      if (NG20_EDGE_SIDES.has(data.toSide)) this.to.side = data.toSide;
      if (data.fromEnd === ng20EdgeEndNone || data.fromEnd === ng20EdgeEndArrow) this.from.end = data.fromEnd;
      if (data.toEnd === ng20EdgeEndNone || data.toEnd === ng20EdgeEndArrow) this.to.end = data.toEnd;
      this.initialized = true;
      this.canvas.markMoved(this);
      this.canvas.markDirty(this);
    }

    // ---------- colour / label ----------

    setColor(color, render = true) {
      this.color = color || "";
      if (render) this.render();
      else this.canvas.markDirty(this);
    }

    setLabel(label) {
      this.label = label || "";
      if (this.labelElement) this.labelElement.setText(this.label);
      this.canvas.markDirty(this);
    }

    // ---------- geometry ----------

    anchorFor(endpoint) {
      const node = endpoint.node;
      if (!node || typeof node.getBBox !== "function") return null;
      return sideMidpoint(node.getBBox(), endpoint.side);
    }

    updatePath() {
      const from = this.from;
      const to = this.to;
      const anchorFrom = this.anchorFor(from);
      const anchorTo = this.anchorFor(to);
      if (!anchorFrom || !anchorTo) {
        this.bezier = null;
        this.path = null;
        this.pathEl.setAttr("d", "");
        this.interactionPathEl.setAttr("d", "");
        return;
      }
      const start = ng20EdgeOutset(anchorFrom, from.side);
      const end = ng20EdgeOutset(anchorTo, to.side);
      const curve = (this.bezier = bezierEdge(start, from.side, end, to.side));
      this.path = curve.path;

      let fromEnd = this.fromLineEnd;
      if (from.end !== (fromEnd && fromEnd.type)) {
        if (fromEnd) fromEnd.el.remove();
        fromEnd = this.fromLineEnd = this.createEdgeEnd(from.end);
      }
      let toEnd = this.toLineEnd;
      if (to.end !== (toEnd && toEnd.type)) {
        if (toEnd) toEnd.el.remove();
        toEnd = this.toLineEnd = this.createEdgeEnd(to.end);
      }

      let d = curve.path;
      if (fromEnd) {
        fromEnd.el.style.transform = `translate(${anchorFrom.x}px, ${anchorFrom.y}px) rotate(${ng20EdgeEndRotation[from.side] || "0"}deg)`;
      } else {
        d = `M${anchorFrom.x} ${anchorFrom.y} L${start.x} ${start.y} ${d}`;
      }
      if (toEnd) {
        toEnd.el.style.transform = `translate(${anchorTo.x}px, ${anchorTo.y}px) rotate(${ng20EdgeEndRotation[to.side] || "0"}deg)`;
      } else {
        d = `${d} M${end.x} ${end.y} L${anchorTo.x} ${anchorTo.y}`;
      }
      this.pathEl.setAttr("d", d);
      this.interactionPathEl.setAttr("d", d);
      this.positionLabel(curve);
    }

    /** Arrow/marker element for an edge end (`g > polygon.canvas-path-end`), or null for "none". */
    createEdgeEnd(end) {
      if (end === ng20EdgeEndNone) return null;
      const custom = window.__fpEndPoints && window.__fpEndPoints(end);
      const points = custom || "0,0 6.5,10.4 -6.5,10.4";
      const g = this.lineEndGroupEl.createSvg("g");
      g.createSvg("polygon", { cls: "canvas-path-end", attr: { points } });
      return { el: g, type: end };
    }

    positionLabel(bez) {
      const el = this.labelElement;
      if (el) el.render();
      void bez;
    }

    update(from, to) {
      if (from) this.from = from;
      if (to) this.to = to;
      this.updatePath();
    }

    /** Bounding box of the sampled curve (feeds the edge spatial index). */
    getBBox() {
      if (!this.bezier) this.updatePath();
      const bez = this.bezier;
      if (!bez) return box(0, 0, 0, 0);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i <= 24; i++) {
        const p = ng20Cubic(bez.from, bez.cp1, bez.cp2, bez.to, i / 24);
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      if (!isFinite(minX)) return box(0, 0, 0, 0);
      return box(minX, minY, maxX, maxY);
    }

    getCenter() {
      const b = this.getBBox();
      return point((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
    }

    render() {
      this.updatePath();
      if (this.labelElement && !this.label) this.labelElement.destroy(true);
      if (this.label) {
        if (!this.labelElement && canvas.EdgeLabel) this.labelElement = new canvas.EdgeLabel(this);
        if (this.labelElement) this.labelElement.setText(this.label);
      }
      if (this.labelElement) this.labelElement.render();
      s13ApplyCanvasColor(this.lineGroupEl, this.color, host);
      s13ApplyCanvasColor(this.lineEndGroupEl, this.color, host);
      this.lineGroupEl.toggleClass("is-themed", !!this.color);
      this.lineEndGroupEl.toggleClass("is-themed", !!this.color);
    }

    // ---------- lifecycle ----------

    attach() {
      if (this.isAttached) return;
      this.canvas.edgeContainerEl.appendChild(this.lineGroupEl);
      this.canvas.edgeEndContainerEl.appendChild(this.lineEndGroupEl);
      if (this.labelElement) this.canvas.canvasEl.appendChild(this.labelElement.wrapperEl);
      this.render();
    }

    detach() {
      this.lineGroupEl.detach();
      this.lineEndGroupEl.detach();
      if (this.labelElement) this.labelElement.wrapperEl.detach();
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.detach();
      if (this.labelElement) this.labelElement.destroy();
    }

    // ---------- selection ----------

    focus() { this.lineGroupEl.addClass("is-focused"); this.lineEndGroupEl.addClass("is-focused"); }
    blur() { this.lineGroupEl.removeClass("is-focused"); this.lineEndGroupEl.removeClass("is-focused"); }
    select() { this.lineGroupEl.addClass("is-selected"); this.lineEndGroupEl.addClass("is-selected"); }
    deselect() { this.lineGroupEl.removeClass("is-selected"); this.lineEndGroupEl.removeClass("is-selected"); }

    // ---------- pointer / menus ----------

    onClick(evt) {
      const canvas_ = this.canvas;
      if (evt.button !== 0 || canvas_.readonly) return;
      if (evt.shiftKey) { canvas_.toggleSelect(this); return; }
      if (canvas_.selection.size === 1 && canvas_.selection.has(this) && this.labelElement && !this.labelElement.isEditing) {
        this.labelElement.focus(pointOfEvent(evt));
      } else {
        canvas_.selectOnly(this);
      }
    }

    onContextMenu(evt) {
      if (evt.defaultPrevented) return;
      const canvas_ = this.canvas;
      if (canvas_.selection.has(this) && canvas_.selection.size > 1) {
        canvas_.onSelectionContextMenu(evt);
        return;
      }
      if (!canvas_.readonly) canvas_.selectOnly(this);
      evt.preventDefault();
      this.showMenu(evt);
    }

    showMenu(evt) {
      const canvas_ = this.canvas;
      const menu = new host.Menu();
      const ti = ng20CanvasStrings();
      const self = this;
      menu.addSections(["title", "action", "danger"]);
      menu.addItem((item) => item.setSection("action").setTitle(ti.actionEditLabel ? ti.actionEditLabel() : "Edit label").setIcon("lucide-edit").onClick(() => {
        if (!self.labelElement && canvas.EdgeLabel) self.labelElement = new canvas.EdgeLabel(self);
        if (self.labelElement) self.labelElement.focus();
      }));
      menu.addItem((item) => item.setSection("action").setTitle(ti.actionZoomToFit ? ti.actionZoomToFit() : "Zoom to fit").setIcon("lucide-maximize").onClick(() => canvas_.zoomToBbox(self.getBBox())));
      if (window.__fpEdgeMenu) window.__fpEdgeMenu(menu, this);
      canvas_.app.workspace.trigger("canvas:edge-menu", menu, this);
      if (!canvas_.readonly) {
        menu.addItem((item) => item.setSection("danger").setTitle(ti.actionRemove ? ti.actionRemove() : "Remove").setIcon("lucide-trash-2").setWarning(true).onClick(() => canvas_.removeEdge(self)));
      }
      menu.showAtMouseEvent(evt);
    }

    /**
     * Dragging an edge re-targets its nearest end; dropping on empty canvas removes
     * the edge. Live preview follows the pointer through a zero-size dummy node.
     */
    onConnectionPointerdown(evt) {
      if (window.__fpEdgeGrab && window.__fpEdgeGrab(this, evt)) return;
      const canvas_ = this.canvas;
      if (!evt.isPrimary || evt.button !== 0 || canvas_.readonly) return;
      if (evt.pointerType === "touch" && !canvas_.selection.has(this)) return;
      evt.preventDefault();
      host.dragWithThreshold(evt, () => {
        const from = this.from;
        const to = this.to;
        const pos = canvas_.posFromEvt(evt);
        const fromAnchor = this.anchorFor(from);
        const toAnchor = this.anchorFor(to);
        if (!fromAnchor || !toAnchor) return;
        const dragged = distance(pos, fromAnchor) > distance(pos, toAnchor) ? "to" : "from";
        const fixed = dragged === "from" ? to : from;
        const dummy = new canvas_.DummyNode(canvas_);
        let snapped = null;
        canvas_.canvasEl.addClass("is-connecting");
        canvas_.deselectAll();
        canvas_.handleDragWithPan(evt, {
          move: (moveEvt) => {
            const p = canvas_.posFromEvt(moveEvt);
            dummy.x = p.x;
            dummy.y = p.y;
            dummy.width = 0;
            dummy.height = 0;
            const candidates = canvas_.getIntersectingNodes(boxGrow(dummy.getBBox(), canvas_.config.objectSnapDistance));
            const at = candidates.indexOf(fixed.node);
            if (at >= 0) candidates.splice(at, 1);
            snapped = s13NearestSide(p, candidates, canvas_.config.objectSnapDistance);
            if (dragged === "from") {
              if (snapped) this.update({ side: snapped.side, node: snapped.node, end: from.end }, to);
              else this.update({ side: from.side, node: dummy, end: from.end }, to);
            } else {
              if (snapped) this.update(from, { side: snapped.side, node: snapped.node, end: to.end });
              else this.update(from, { side: to.side, node: dummy, end: to.end });
            }
          },
          end: () => {
            if (!snapped) canvas_.removeEdge(this);
            canvas_.requestSave();
          },
          cancel: () => this.update(from, to),
          cleanup: () => {
            canvas_.canvasEl.removeClass("is-connecting");
            ng08SuppressNextEvent(this.lineGroupEl, "click");
          },
        });
      });
    }
  }

  canvas.EdgeClass = CanvasEdge;
  canvas.Edge = CanvasEdge;
  canvas.EdgeLabel = null; // filled by the modals module (same registry object)
  return CanvasEdge;
}

/** Picks the side of `node` closest to point `p` (used while reconnecting an edge end). */
function ng20EdgeSideOf(node, other, p) {
  const b = node.getBBox();
  const c = boxCenter(b);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "right" : "left";
  return dy > 0 ? "bottom" : "top";
}
