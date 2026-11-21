// g20 clean-room: undo stack, spatial index family, per-file canvas view-data
// cache (localStorage) and the node interaction layer (resize handles / dots).
//
// Replaces orig l5/Y3/m5/v5/g5/n8/M5 (canvas-utils.js).
import { env } from "./env.js";
import { box, boxOfRect } from "./misc.js";
import { canvas } from "./n-g20-shared.js";

// ---- undo stack (l5) --------------------------------------------------------------------------

export function defineNg20UndoStack() {
  class UndoStack {
    constructor(max = 100) {
      this.data = [];
      this.current = -1;
      this.max = max;
    }

    get length() { return this.data.length; }

    canUndo() { return this.current > 0; }
    canRedo() { return this.current < this.data.length - 1; }

    /** Appends a state, dropping the redo tail first; bounds the stack to max-1 entries. */
    push(state) {
      this.data = this.data.slice(0, this.current + 1);
      this.data.push(state);
      this.current = this.data.length - 1;
      if (this.data.length >= this.max) {
        this.data.shift();
        this.current--;
      }
    }

    /** Overwrites the entry under the pointer, or appends when the stack is empty. */
    replace(state) {
      if (this.data.length === 0) {
        this.data.push(state);
        this.current = 0;
        return;
      }
      this.data[this.current] = state;
    }

    undo() {
      if (!this.canUndo()) return null;
      this.current--;
      return this.data[this.current];
    }

    redo() {
      if (!this.canRedo()) return null;
      this.current++;
      return this.data[this.current];
    }

    clear() {
      this.data = [];
      this.current = -1;
    }
  }
  canvas.UndoStack = UndoStack;
  return UndoStack;
}

// ---- spatial index family ----------------------------------------------------------------------
// One generic 2D index parameterised by how an item's bbox is obtained and how ties order.

function ng20ItemBBox(item, accessor) {
  if (accessor === "bbox") return item.bbox;
  if (accessor === "getBBox") return item.getBBox();
  return item.bbox !== undefined ? item.bbox : item.getBBox();
}

function ng20Intersects(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

class Ng20SpatialIndex {
  constructor(opts = {}) {
    this.accessor = opts.accessor || "getBBox";
    this.order = opts.order || null; // optional comparator for search results
    this.items = [];
  }

  toBBox(item) { return ng20ItemBBox(item, this.accessor); }

  all() { return this.items.slice(); }

  insert(item) {
    if (this.items.includes(item)) return;
    this.items.push(item);
  }

  remove(item, equals) {
    const eq = equals || ((a, b) => a === b);
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (eq(this.items[i], item)) this.items.splice(i, 1);
    }
  }

  clear() { this.items = []; }

  load(items) {
    this.items = [];
    for (const item of items || []) this.insert(item);
  }

  search(bbox) {
    const out = [];
    for (const item of this.items) {
      const b = this.toBBox(item);
      if (b && ng20Intersects(b, bbox)) out.push(item);
    }
    if (this.order) out.sort(this.order);
    return out;
  }

  collides(bbox) {
    for (const item of this.items) {
      const b = this.toBBox(item);
      if (b && ng20Intersects(b, bbox)) return true;
    }
    return false;
  }

  toJSON() { return this.items.map((i) => this.toBBox(i)); }
  fromJSON(data) {
    this.items = [];
    for (const b of data || []) this.items.push({ bbox: b, getBBox() { return this.bbox; } });
  }
}

/** Uniform-grid flavour kept for API parity: same contract, insertion-order ties. */
export function defineNg20SpatialIndex() {
  class SpatialIndex extends Ng20SpatialIndex {
    constructor() { super({ accessor: "getBBox" }); }
  }
  canvas.SpatialIndex = SpatialIndex;
  return SpatialIndex;
}

/** Caches `item.bbox` on insert; `update(item)` refreshes a moved item. */
export function defineNg20BboxCachedIndex() {
  class BboxIndex extends Ng20SpatialIndex {
    constructor() { super({ accessor: "bbox" }); }
    insert(item) {
      item.bbox = item.getBBox();
      super.insert(item);
    }
    update(item) {
      this.remove(item);
      this.insert(item);
    }
    remove(item, equals) {
      const eq = equals || ((a, b) => a === b);
      for (let i = this.items.length - 1; i >= 0; i--) {
        if (eq(this.items[i], item)) {
          this.items[i].bbox = undefined;
          this.items.splice(i, 1);
        }
      }
    }
  }
  canvas.BboxIndex = BboxIndex;
  return BboxIndex;
}

/** Orders items by (x, y): degenerate-box queries return hits sorted y-then-x. */
export function defineNg20PointIndex() {
  class PointIndex extends Ng20SpatialIndex {
    constructor() {
      super({
        accessor: "bbox",
        order: (a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x),
      });
    }
    insert(item) {
      item.bbox = box(item.x, item.y, item.x, item.y);
      super.insert(item);
    }
    search(bbox) {
      const out = super.search(bbox);
      out.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
      return out;
    }
  }
  canvas.PointIndex = PointIndex;
  return PointIndex;
}

/** Orders by getBBox() min corner — the default node/edge index. */
export function defineNg20BBoxItemIndex() {
  class BBoxItemIndex extends Ng20SpatialIndex {
    constructor() { super({ accessor: "getBBox" }); }
  }
  canvas.BBoxItemIndex = BBoxItemIndex;
  return BBoxItemIndex;
}

// ---- canvas view-local data cache (n8) ---------------------------------------------------------
// Stores at most view-local flags (today: {readonly:true}) under "<appId>-canvas-<path>".

export function defineNg20CanvasDataCache(host) {
  class CanvasDataCache {
    constructor(app) {
      this.app = app;
    }

    keyFor(path) { return this.app.appId + "-canvas-" + path; }

    load(file) {
      if (!file) return null;
      let raw = null;
      try { raw = window.localStorage.getItem(this.keyFor(file.path)); } catch (e) { return null; }
      if (raw == null) return null;
      try {
        const data = JSON.parse(raw);
        return data && typeof data === "object" ? data : null;
      } catch (err) {
        return null;
      }
    }

    save(file, data) {
      if (!file) return;
      const key = this.keyFor(file.path);
      try {
        if (data == null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(data));
      } catch (e) { /* storage full/blocked -> ignore */ }
    }

    remove(path) {
      try { window.localStorage.removeItem(this.keyFor(path)); } catch (e) { /* ignore */ }
    }

    handleRename(oldPath, newFile) {
      let raw = null;
      try { raw = window.localStorage.getItem(this.keyFor(oldPath)); } catch (e) { return; }
      if (raw != null) {
        try {
          window.localStorage.setItem(this.keyFor(newFile.path), raw);
          window.localStorage.removeItem(this.keyFor(oldPath));
        } catch (e) { /* ignore */ }
      }
    }

    handleDelete(file) {
      if (file) this.remove(file.path);
    }
  }
  canvas.DataCache = CanvasDataCache;
  return CanvasDataCache;
}

// ---- node interaction layer (M5) ---------------------------------------------------------------
// Overlay over the hovered node: four side connection dots + resize handles.

export function defineNg20InteractionLayer(host) {
  class NodeInteractionLayer {
    constructor(canvas_) {
      this.canvas = canvas_;
      this.target = null;
      const layer = (this.interactionEl = createDiv("canvas-node-interaction-layer"));
      layer.hide();

      const sides = ["top", "right", "bottom", "left"];
      for (const side of sides) {
        const handle = createDiv({ cls: "canvas-node-resizer", attr: { "data-resize": side } });
        handle.addEventListener("pointerdown", (evt) => {
          const target = this.target;
          if (evt.targetNode === handle && evt.pointerType === "mouse" && target) {
            target.onResizePointerdown(evt, side);
          }
        });
        handle.addEventListener("click", (evt) => {
          const target = this.target;
          if (target) target.onClick(evt);
        });
        if (side !== "bottom" && side !== "right") {
          handle.addEventListener("dblclick", (evt) => {
            const target = this.target;
            if (target) target.onResizeDblclick(evt, side);
          });
        }
        handle.createDiv({ cls: "canvas-node-connection-point", attr: { "data-side": side } })
          .addEventListener("pointerdown", (evt) => {
            const target = this.target;
            if (target) target.onConnectionPointerdown(evt, side);
          });
        layer.appendChild(handle);
      }

      const corners = ["topright", "bottomright", "bottomleft", "topleft"];
      for (const corner of corners) {
        const handle = createDiv({ cls: "canvas-node-resizer", attr: { "data-resize": corner } });
        handle.addEventListener("pointerdown", (evt) => {
          const target = this.target;
          if (target) target.onResizePointerdown(evt, corner);
        });
        handle.addEventListener("click", (evt) => {
          const target = this.target;
          if (target) target.onClick(evt);
        });
        layer.appendChild(handle);
      }
      canvas_.canvasEl.appendChild(layer);
    }

    setTarget(node) {
      if (this.target !== node) {
        this.target = node;
        this.render();
      }
    }

    render() {
      const canvas_ = this.canvas;
      const target = this.target;
      const layer = this.interactionEl;
      if (!target || target.destroyed || canvas_.readonly) {
        if (layer.parentNode) layer.detach();
        return;
      }
      if (!layer.parentNode) canvas_.canvasEl.appendChild(layer);
      layer.show();
      layer.setCssStyles({
        transform: "translate(" + target.x + "px, " + target.y + "px)",
        width: target.width + "px",
        height: target.height + "px",
        zIndex: String(canvas_.zIndexCounter + 1),
      });
    }
  }
  canvas.InteractionLayer = NodeInteractionLayer;
  return NodeInteractionLayer;
}
