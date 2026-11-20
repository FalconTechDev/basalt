// g20 clean-room: canvas edge (connection) class, its geometry helpers and the
// offscreen SVG minimap renderer used by .canvas embeds.
//
// Replaces orig G5 (edge class), o8 (preview), b5/V5/z5 (helpers) and declarators
// U5/W5/_5 ($5/Z5 live in n-g20-shared.js).
import { box, boxCenter, sideMidpoint, bezierEdge, boxOfPoints, boxUnion, distance, point, pushOut, rgbTripleToHex, randomHex } from "./misc.js";
import { env } from "./env.js";
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

      this.lineGroupEl = createSvg("g", "canvas-edge");
      this.interactionPathEl = this.lineGroupEl.createSvg("path", { cls: "canvas-interaction-path" });
      this.pathEl = this.lineGroupEl.createSvg("path", { cls: "canvas-display-path" });
      this.lineEndGroupEl = createSvg("g", "canvas-edge-ends");
      this.fromEndEl = this.lineEndGroupEl.createSvg("path", { cls: "canvas-edge-end canvas-path-end" });
      this.toEndEl = this.lineEndGroupEl.createSvg("path", { cls: "canvas-edge-end canvas-path-end" });

      this.labelElement = createDiv("canvas-path-label-wrapper");
      this.labelElement.style.pointerEvents = "none";
      this.labelTextEl = this.labelElement.createDiv("canvas-path-label");
      this.labelInputEl = this.labelElement.createEl("textarea", { cls: "canvas-path-label-input" });
      this.labelInputEl.setAttribute("rows", "1"); this.labelInputEl.setAttribute("placeholder", "");
      this.isEditingLabel = false;
      this.labelInputEl.hide();

      this.lineGroupEl.addEventListener("pointerdown", (evt) => this.onPointerdown(evt));
      this.lineGroupEl.addEventListener("click", (evt) => this.onClick(evt));
      this.lineGroupEl.addEventListener("contextmenu", (evt) => this.onContextMenu(evt));
      this.interactionPathEl.addEventListener("pointerdown", (evt) => this.onConnectionPointerdown(evt));

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
      this.labelTextEl.setText(this.label);
      this.canvas.markDirty(this);
    }

    // ---------- geometry ----------

    anchorFor(endpoint) {
      const node = endpoint.node;
      if (!node || typeof node.getBBox !== "function") return null;
      const b = node.getBBox();
      const mid = sideMidpoint(b, endpoint.side);
      return ng20EdgeOutset(mid, endpoint.side);
    }

    updatePath() {
      const a = this.anchorFor(this.from);
      const b = this.anchorFor(this.to);
      if (!a || !b) {
        this.bezier = null;
        this.path = null;
        this.pathEl.setAttr("d", "");
        this.interactionPathEl.setAttr("d", "");
        return;
      }
      const bez = bezierEdge(a, this.from.side, b, this.to.side);
      this.bezier = bez;
      this.path = bez.path;
      this.pathEl.setAttr("d", bez.path);
      this.interactionPathEl.setAttr("d", bez.path);
      const stroke = this.color || "var(--canvas-edge, var(--text-muted))";
      this.pathEl.setAttr("stroke", stroke);
      this.interactionPathEl.setAttr("stroke", "transparent");
      this.interactionPathEl.setAttr("stroke-width", "20");
      this.interactionPathEl.setAttr("pointer-events", "stroke");
      this.lineGroupEl.toggleClass("is-themed", !!this.color);
      this.positionLabel(bez);
      this.positionEnds(a, b);
    }

    positionLabel(bez) {
      const mid = ng20Cubic(bez.from, bez.cp1, bez.cp2, bez.to, 0.5);
      const angle = ng20CubicTangent(bez.from, bez.cp1, bez.cp2, bez.to, 0.5);
      const el = this.labelElement;
      el.style.left = mid.x + "px";
      el.style.top = mid.y + "px";
      el.style.transform = `translate(-50%,-50%) rotate(${angle}deg)`;
      const show = !!this.label || this.isEditingLabel;
      el.style.display = show ? "" : "none";
      if (!this.isEditingLabel) this.labelInputEl.hide(), this.labelTextEl.show();
    }

    positionEnds(a, b) {
      const draw = (endpoint, anchor, pathEl) => {
        const isArrow = endpoint.end === ng20EdgeEndArrow;
        pathEl.style.display = isArrow ? "" : "none";
        if (!isArrow) return;
        const rot = ng20EdgeEndRotation[endpoint.side] || "0";
        const size = 10;
        // small filled arrow head pointing along the side normal, rotated per side
        pathEl.setAttr("d", `M0,0 L${-size},${-size * 0.6} L${-size},${size * 0.6} Z`);
        pathEl.setAttr("transform", `translate(${anchor.x},${anchor.y}) rotate(${rot})`);
        pathEl.setAttr("fill", this.color || "var(--canvas-edge, var(--text-muted))");
      };
      draw(this.from, a, this.fromEndEl);
      draw(this.to, b, this.toEndEl);
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
    }

    // ---------- lifecycle ----------

    attach() {
      if (this.isAttached) return;
      this.canvas.edgeContainerEl.appendChild(this.lineGroupEl);
      this.canvas.edgeEndContainerEl.appendChild(this.lineEndGroupEl);
      this.canvas.canvasEl.appendChild(this.labelElement);
      this.render();
    }

    detach() {
      this.lineGroupEl.detach();
      this.lineEndGroupEl.detach();
      this.labelElement.detach();
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.detach();
      this.labelElement.remove();
    }

    // ---------- selection ----------

    focus() { this.lineGroupEl.addClass("is-focused"); }
    blur() { this.lineGroupEl.removeClass("is-focused"); }
    select() { this.lineGroupEl.addClass("is-selected"); }
    deselect() { this.lineGroupEl.removeClass("is-selected"); }

    // ---------- label editing ----------

    editLabel() {
      this.isEditingLabel = true;
      this.labelElement.style.pointerEvents = "auto";
      this.labelTextEl.hide();
      this.labelInputEl.show();
      this.labelInputEl.value = this.label || "";
      this.labelInputEl.focus();
      host.focusAndSelectContents(this.labelInputEl);
      const commit = () => {
        this.labelInputEl.removeEventListener("blur", commit);
        this.labelInputEl.removeEventListener("keydown", onKey);
        this.isEditingLabel = false;
        this.labelElement.style.pointerEvents = "none";
        this.setLabel(this.labelInputEl.value.trim());
        this.render();
      };
      const onKey = (evt) => {
        if (evt.key === "Enter" && !evt.shiftKey) { evt.preventDefault(); commit(); }
        else if (evt.key === "Escape") { this.labelInputEl.value = this.label || ""; commit(); }
      };
      this.labelInputEl.addEventListener("blur", commit);
      this.labelInputEl.addEventListener("keydown", onKey);
      this.render();
    }

    // ---------- pointer / menus ----------

    onPointerdown(evt) {
      if (evt.button !== 0 || !evt.isPrimary) return;
      const canvas_ = this.canvas;
      if (canvas_.selection.has(this)) return;
      canvas_.selectOnly(this);
      evt.stopPropagation();
    }

    onClick(evt) {
      void evt;
      this.canvas.selectOnly(this);
    }

    onContextMenu(evt) {
      if (evt.defaultPrevented) return;
      evt.preventDefault();
      this.showMenu(evt);
    }

    showMenu(evt) {
      const canvas_ = this.canvas;
      const menu = new host.Menu();
      const ti = ng20CanvasStrings();
      const self = this;
      menu.addSections(["title", "action", "danger"]);
      menu.addItem((item) => item.setSection("action").setTitle(ti.actionEditLabel ? ti.actionEditLabel() : "Edit label").setIcon("lucide-edit").onClick(() => self.editLabel()));
      menu.addItem((item) => item.setSection("action").setTitle(ti.actionZoomToFit ? ti.actionZoomToFit() : "Zoom to fit").setIcon("lucide-maximize").onClick(() => canvas_.zoomToBbox(self.getBBox())));
      if (window.__fpEdgeMenu) window.__fpEdgeMenu(menu, this);
      canvas_.app.workspace.trigger("canvas:edge-menu", menu, this);
      if (!canvas_.readonly) {
        menu.addItem((item) => item.setSection("danger").setTitle(ti.actionRemove ? ti.actionRemove() : "Remove").setIcon("lucide-trash-2").setWarning(true).onClick(() => canvas_.removeEdge(self)));
      }
      menu.showAtMouseEvent(evt);
    }

    /** Drag an edge end dot to re-anchor it to the nearest node side. */
    onConnectionPointerdown(evt) {
      if (evt.button !== 0 || !evt.isPrimary || this.canvas.readonly) return;
      evt.preventDefault();
      evt.stopPropagation();
      const canvas_ = this.canvas;
      canvas_.wrapperEl.addClass("is-connecting");
      const endpoint = evt.target && evt.target.dataset && evt.target.dataset.end === "from" ? "from" : "to";
      const other = endpoint === "from" ? this.to : this.from;
      const start = canvas_.posFromEvt(evt);
      let target = null;
      let side = null;
      host.dragWithThreshold(evt, () => ({
        move: (moveEvt) => {
          const p = canvas_.posFromEvt(moveEvt);
          const node = canvas_.hitTestNode(p, canvas_.snapDistance);
          if (node && node !== other.node) {
            target = node;
            side = ng20EdgeDirection(node, other.node) === undefined ? "right" : ng20EdgeSideOf(node, other.node, p);
          } else {
            target = null;
            side = null;
          }
        },
        end: () => {
          canvas_.wrapperEl.removeClass("is-connecting");
          if (target) {
            this[endpoint] = { node: target, side: side || ng20EdgeDirection(target, other.node), end: this[endpoint].end };
            canvas_.markMoved(this);
            canvas_.requestSave();
          } else {
            canvas_.removeEdge(this);
            canvas_.requestSave();
          }
        },
        cleanup: () => canvas_.wrapperEl.removeClass("is-connecting"),
      }), 0);
      void start;
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
