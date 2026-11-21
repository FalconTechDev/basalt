// g20 clean-room: selection overlay + floating canvas menu.
//
// The controller keeps `selection` as a plain Set; the menu object (U3) owns the
// .canvas-selection overlay (8 [data-resize] handles) and the .canvas-menu-container
// popup, and exposes `selection.bbox` for viewport math. z3 is the standalone
// selection-state helper kept for API parity.
//
// Replaces orig z3 (canvas-selection) and U3 (canvas-menu).
import { env } from "./env.js";
import { canvas, ng20CanvasStrings } from "./n-g20-shared.js";
import { box, boxUnion } from "./misc.js";

const NG20_HANDLES = ["top", "topright", "right", "bottomright", "bottom", "bottomleft", "left", "topleft"];
const NG20_GROUP_BACKGROUNDS = ["", "solid", "translucent", "pattern"];

function ng20SelectionBBox(items) {
  const boxes = [];
  for (const item of items || []) {
    if (item && typeof item.getBBox === "function") {
      try { boxes.push(item.getBBox()); } catch (e) { /* detached */ }
    }
  }
  return boxes.length ? boxUnion(boxes) : null;
}

// ---- standalone selection helper (z3) ------------------------------------------------------------

export function defineNg20CanvasSelection(host) {
  class CanvasSelection {
    constructor(canvas_) {
      this.canvas = canvas_;
      this.items = new Set();
    }

    get size() { return this.items.size; }
    has(item) { return this.items.has(item); }
    add(item) { this.items.add(item); }
    delete(item) { this.items.delete(item); }
    clear() { this.items.clear(); }
    values() { return this.items.values(); }
    [Symbol.iterator]() { return this.items[Symbol.iterator](); }

    get bbox() { return ng20SelectionBBox(this.items); }
  }
  canvas.CanvasSelection = CanvasSelection;
  return CanvasSelection;
}

// ---- floating menu + selection overlay (U3) -------------------------------------------------------

export function defineNg20CanvasMenu(host) {
  class CanvasMenu {
    constructor(canvas_) {
      this.canvas = canvas_;
      this.selection = {
        get items() { return canvas_.selection; },
        get bbox() { return ng20SelectionBBox(canvas_.selection); },
        get size() { return canvas_.selection.size; },
      };
      this.selectionEl = null;
      this.handleEls = {};
      this.menuEl = null;
      this.submenuEl = null;
      this.renderedFor = null;
    }

    /** Frame-loop hook: rebuild overlay + popup when the selection changed. */
    render(force) {
      const canvas_ = this.canvas;
      const sel = canvas_.selection;
      const key = sel.size + ":" + [...sel].map((i) => i.id).join(",");
      if (!force && this.renderedFor === key) return;
      this.renderedFor = key;
      this.renderSelectionOverlay(sel);
      this.renderMenuPopup(sel);
    }

    // ---------- selection overlay ----------

    renderSelectionOverlay(sel) {
      const canvas_ = this.canvas;
      const b = ng20SelectionBBox(sel);
      const show = !!b && sel.size > 0 && !canvas_.readonly;
      if (!this.selectionEl) {
        this.selectionEl = createDiv("canvas-selection");
        this.selectionEl.hide();
        canvas_.canvasEl.appendChild(this.selectionEl);
        const handles = this.selectionEl.createDiv("canvas-selection-handles");
        for (const side of NG20_HANDLES) {
          const h = handles.createDiv(`canvas-selection-handle mod-${side}`);
          h.setAttr("data-resize", side);
          h.addEventListener("pointerdown", (evt) => this.onHandlePointerdown(evt, side));
          this.handleEls[side] = h;
        }
      }
      this.selectionEl.toggle(show);
      if (!show) return;
      this.selectionEl.style.left = b.minX + "px";
      this.selectionEl.style.top = b.minY + "px";
      this.selectionEl.style.width = (b.maxX - b.minX) + "px";
      this.selectionEl.style.height = (b.maxY - b.minY) + "px";
    }

    onHandlePointerdown(evt, side) {
      if (evt.button !== 0 || !evt.isPrimary || this.canvas.readonly) return;
      evt.preventDefault();
      evt.stopPropagation();
      const canvas_ = this.canvas;
      const start = canvas_.posFromEvt(evt);
      const origin = new Map();
      for (const item of canvas_.selection) {
        if (item && item.rect) origin.set(item, { x: item.x, y: item.y, width: item.width, height: item.height });
      }
      const minDim = (canvas_.config && canvas_.config.minContainerDimension) || 50;
      host.dragWithThreshold(evt, () => ({
        move: (moveEvt) => {
          const p = canvas_.posFromEvt(moveEvt);
          const dx = p.x - start.x;
          const dy = p.y - start.y;
          const horiz = side.includes("left") || side.includes("right");
          const vert = side.startsWith("top") || side.startsWith("bottom");
          for (const [item, o] of origin) {
            if (!item.moveAndResize) continue;
            let { x, y, width, height } = o;
            if (horiz && side.includes("left")) { x = o.x + dx; width = o.width - dx; }
            else if (horiz) { width = o.width + dx; }
            if (vert && side.startsWith("top")) { y = o.y + dy; height = o.height - dy; }
            else if (vert) { height = o.height + dy; }
            if (width < minDim) width = minDim;
            if (height < minDim) height = minDim;
            item.moveAndResize({ x, y, width, height });
          }
        },
        end: () => canvas_.requestSave(),
      }), 0);
    }

    // ---------- floating menu ----------

    renderMenuPopup(sel) {
      const canvas_ = this.canvas;
      const show = sel.size > 0;
      if (!this.menuEl) {
        this.menuEl = createDiv("canvas-menu-container");
        this.menuEl.hide();
        canvas_.canvasEl.appendChild(this.menuEl);
      }
      this.menuEl.toggle(show);
      if (!show) { this.menuEl.empty(); return; }
      // rebuild only when the selection signature changed (renderedFor already gates)
      this.menuEl.empty();
      const ti = ng20CanvasStrings();
      const nodes = [...sel].filter((i) => i && i.moveAndResize);
      const groups = nodes.filter((n) => n.type === "group");
      const btn = (cls, icon, title, fn) => {
        const b = this.menuEl.createDiv(`canvas-menu-button ${cls}`);
        b.setAttr("aria-label", title);
        b.setAttr("title", title);
        if (icon) { const ic = b.createDiv("canvas-menu-icon"); try { window.__bsApi.setIcon(ic, "lucide-" + icon); } catch (e) { ic.setText(icon); } }
        b.addEventListener("click", (evt) => { evt.stopPropagation(); fn(); });
        return b;
      };
      btn("canvas-menu-color", "palette", ti.menuColor ? ti.menuColor() : "Color", () => this.openSubmenu("color"));
      btn("canvas-menu-align", "align-left", ti.menuAlign ? ti.menuAlign() : "Align", () => this.openSubmenu("align"));
      btn("canvas-menu-arrange", "layout-grid", ti.menuArrange ? ti.menuArrange() : "Arrange", () => this.openSubmenu("arrange"));
      btn("canvas-menu-distribute", "distribute-horizontal", ti.menuDistribute ? ti.menuDistribute() : "Distribute", () => this.openSubmenu("distribute"));
      btn("canvas-menu-justify", "align-horizontal-distribute-center", ti.menuJustify ? ti.menuJustify() : "Justify", () => this.openSubmenu("justify"));
      btn("canvas-menu-direction", "arrow-right", ti.menuEdgeDirection ? ti.menuEdgeDirection() : "Edge direction", () => this.openSubmenu("direction"));
      btn("canvas-menu-background", "image", ti.menuBackground ? ti.menuBackground() : "Background", () => this.openSubmenu("background"));
      // position near the selection box, inside canvas coordinates
      const b = this.selection.bbox;
      if (b) {
        this.menuEl.style.left = ((b.minX + b.maxX) / 2) + "px";
        this.menuEl.style.top = (b.maxY + 8) + "px";
        this.menuEl.style.transform = "translateX(-50%)";
      }
    }

    openSubmenu(kind) {
      this.closeSubmenu();
      const sub = createDiv("canvas-menu-submenu");
      const canvas_ = this.canvas;
      const ti = ng20CanvasStrings();
      const add = (label, fn) => {
        const row = sub.createDiv("canvas-menu-submenu-item");
        row.setText(label);
        row.addEventListener("click", (evt) => { evt.stopPropagation(); this.closeSubmenu(); fn(); });
      };
      if (kind === "color") {
        for (const c of ["", "1", "2", "3", "4", "5", "6", "#e03131", "#2f9e44", "#1971c2", "#f08c00", "#ae3ec9"]) {
          add(c === "" ? (ti.colorNone || "None") : c, () => {
            for (const item of canvas_.selection) if (item && item.setColor) item.setColor(c);
            canvas_.requestSave();
          });
        }
      } else if (kind === "align") {
        const ops = [
          ["left", ti.alignLeft], ["center-h", ti.alignCenter], ["right", ti.alignRight],
          ["top", ti.alignTop], ["center-v", ti.alignMiddle], ["bottom", ti.alignBottom],
        ];
        for (const [k, labelFn] of ops) add(labelFn ? labelFn() : k, () => this.align(k));
      } else if (kind === "arrange") {
        const ops = [["grid", ti.arrangeGrid], ["row", ti.arrangeRow], ["column", ti.arrangeColumn]];
        for (const [k, labelFn] of ops) add(labelFn ? labelFn() : k, () => this.distribute(k));
      } else if (kind === "distribute") {
        const ops = [["row", ti.distributeRow || "Row"], ["column", ti.distributeColumn || "Column"]];
        for (const [k, labelFn] of ops) add(labelFn, () => this.distribute(k));
      } else if (kind === "justify") {
        const ops = [["left", ti.justifyLeft], ["center", ti.justifyCenter], ["right", ti.justifyRight], ["space-between", ti.justifySpace]];
        for (const [k, labelFn] of ops) add(labelFn ? labelFn() : k, () => this.justify(k));
      } else if (kind === "direction") {
        const ops = [["right", ti.directionRight], ["left", ti.directionLeft], ["down", ti.directionDown], ["up", ti.directionUp]];
        for (const [k, labelFn] of ops) add(labelFn ? labelFn() : k, () => this.setEdgeDirection(k));
      } else if (kind === "background") {
        for (const bg of NG20_GROUP_BACKGROUNDS) {
          add(bg === "" ? (ti.bgNone || "None") : bg, () => this.setGroupBackground(bg));
        }
      }
      this.menuEl.appendChild(sub);
      this.submenuEl = sub;
    }

    closeSubmenu() {
      if (this.submenuEl) { this.submenuEl.remove(); this.submenuEl = null; }
    }

    selectedNodes() {
      return [...this.canvas.selection].filter((i) => i && i.rect);
    }

    align(mode) {
      const nodes = this.selectedNodes();
      if (nodes.length < 2) return;
      const boxes = nodes.map((n) => n.getBBox());
      const all = boxes.reduce((a, b) => ({
        minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
        maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
      }));
      const cCX = (all.minX + all.maxX) / 2, cCY = (all.minY + all.maxY) / 2;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i], b = boxes[i];
        const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
        let dx = 0, dy = 0;
        if (mode === "left") dx = all.minX - b.minX;
        else if (mode === "right") dx = all.maxX - b.maxX;
        else if (mode === "center-h") dx = cCX - cx;
        else if (mode === "top") dy = all.minY - b.minY;
        else if (mode === "bottom") dy = all.maxY - b.maxY;
        else if (mode === "center-v") dy = cCY - cy;
        if (dx || dy) n.moveTo({ x: n.x + dx, y: n.y + dy });
      }
      this.canvas.requestSave();
    }

    distribute(kind) {
      const nodes = this.selectedNodes();
      if (nodes.length < 2) return;
      const boxes = nodes.map((n) => n.getBBox());
      if (kind === "grid") {
        const cols = Math.ceil(Math.sqrt(nodes.length));
        const minX = Math.min(...boxes.map((b) => b.minX));
        const minY = Math.min(...boxes.map((b) => b.minY));
        const maxX = Math.max(...boxes.map((b) => b.maxX));
        const maxY = Math.max(...boxes.map((b) => b.maxY));
        const rows = Math.ceil(nodes.length / cols);
        nodes.forEach((n, i) => {
          const col = i % cols, row = Math.floor(i / cols);
          n.moveTo({ x: minX + col * ((maxX - minX) / cols), y: minY + row * ((maxY - minY) / Math.max(1, rows)) });
        });
      } else {
        const horizontal = kind !== "column";
        const items = nodes.map((n, i) => ({ n, b: boxes[i] })).sort((a, b2) => horizontal ? a.b.minX - b2.b.minX : a.b.minY - b2.b.minY);
        const min = horizontal ? Math.min(...boxes.map((b) => b.minX)) : Math.min(...boxes.map((b) => b.minY));
        const max = horizontal ? Math.max(...boxes.map((b) => b.maxX)) : Math.max(...boxes.map((b) => b.maxY));
        const total = items.reduce((s, it) => s + (horizontal ? it.b.maxX - it.b.minX : it.b.maxY - it.b.minY), 0);
        const gap = items.length > 1 ? (max - min - total) / (items.length - 1) : 0;
        let cursor = min;
        for (const it of items) {
          if (horizontal) it.n.moveTo({ x: cursor, y: it.n.y });
          else it.n.moveTo({ x: it.n.x, y: cursor });
          cursor += (horizontal ? it.b.maxX - it.b.minX : it.b.maxY - it.b.minY) + gap;
        }
      }
      this.canvas.requestSave();
    }

    justify(mode) {
      const nodes = this.selectedNodes().sort((a, b) => a.x - b.x);
      if (nodes.length < 2) return;
      const boxes = nodes.map((n) => n.getBBox());
      const minX = Math.min(...boxes.map((b) => b.minX));
      const maxX = Math.max(...boxes.map((b) => b.maxX));
      const totalW = boxes.reduce((s, b) => s + (b.maxX - b.minX), 0);
      if (mode === "space-between" && nodes.length > 2) {
        const gap = (maxX - minX - totalW) / (nodes.length - 1);
        let cx = minX;
        nodes.forEach((n, i) => {
          n.moveTo({ x: cx, y: n.y });
          cx += (boxes[i].maxX - boxes[i].minX) + gap;
        });
      } else if (mode === "center") {
        const mid = (minX + maxX) / 2;
        for (let i = 0; i < nodes.length; i++) {
          const cx = (boxes[i].minX + boxes[i].maxX) / 2;
          nodes[i].moveTo({ x: nodes[i].x + (mid - cx), y: nodes[i].y });
        }
      } else if (mode === "left") {
        for (let i = 0; i < nodes.length; i++) nodes[i].moveTo({ x: nodes[i].x + (minX - boxes[i].minX), y: nodes[i].y });
      } else if (mode === "right") {
        for (let i = 0; i < nodes.length; i++) nodes[i].moveTo({ x: nodes[i].x + (maxX - boxes[i].maxX), y: nodes[i].y });
      }
      this.canvas.requestSave();
    }

    setEdgeDirection(dir) {
      const nodes = this.selectedNodes();
      if (nodes.length < 2) return;
      const nodeSet = new Set(nodes);
      const map = { right: ["left", "right"], left: ["right", "left"], down: ["top", "bottom"], up: ["bottom", "top"] };
      const [fromSide, toSide] = map[dir];
      let changed = false;
      for (const e of this.canvas.edges.values()) {
        if (!e || !e.from || !e.to) continue;
        const fa = nodeSet.has(e.from.node), ta = nodeSet.has(e.to.node);
        if (fa === ta) continue; // both-in or both-out: leave internal/untouched edges alone
        if (fa) { e.from.side = fromSide; changed = true; }
        if (ta) { e.to.side = toSide; changed = true; }
        if (fa || ta) { e.update && e.update(); this.canvas.markMoved(e); }
      }
      if (changed) this.canvas.requestSave();
    }

    setGroupBackground(bg) {
      const canvas_ = this.canvas;
      let touched = false;
      for (const item of canvas_.selection) {
        if (item && item.type === "group") {
          item.background = bg;
          item.render && item.render();
          touched = true;
        }
      }
      if (!touched) {
        const nodes = this.selectedNodes();
        if (nodes.length === 0 || !canvas_.createGroupNode) return;
        const b = ng20SelectionBBox(nodes);
        if (!b) return;
        const g = canvas_.createGroupNode({
          pos: { x: b.minX - 20, y: b.minY - 20 },
          size: { width: b.maxX - b.minX + 40, height: b.maxY - b.minY + 60 },
          save: false, focus: false,
        });
        g.background = bg;
        g.render();
      }
      canvas_.requestSave();
    }
  }
  canvas.CanvasMenu = CanvasMenu;
  return CanvasMenu;
}
