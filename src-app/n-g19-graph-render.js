// g19 clean-room: PIXI graph renderer — node/link/power-tag scene objects and
// the Renderer facade (worker protocol, pan/zoom, frame loop, screenshots).
import { env } from "./env.js";
import { withoutExtension, lastSegment } from "./path.js";
import {
  ng19Damp, ng19LerpColor, ng19BoxesDisjoint, ng19BoxAround, ng19ResetCanvasStyle,
  ng19GraphColorClasses, ng19GraphNodeBaseSize, ng19GraphLinkAlpha,
  ng19GraphNodeData, ng19GraphNodeDataFrom,
  ng19WorkerUrl, ng19WorkerName, ng19PowerTagText,
} from "./n-g19-graph-util.js";

const ng19PIXI = () => (typeof PIXI !== "undefined" ? PIXI : null);
const ng19Clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const ng19FontStack = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "Inter", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Microsoft YaHei Light", sans-serif';

/** Display name shown under a node: last path segment without extension. */
function ng19NodeLabel(id) {
  const seg = lastSegment(String(id));
  return withoutExtension(seg.charAt(0) === "#" ? seg.slice(1) : seg);
}

/** Node pixel size in world units: mult * clamp(3*sqrt(weight+1), 8, 30). */
function ng19NodeSize(weight, mult) {
  return (mult || 1) * ng19Clamp(3 * Math.sqrt((weight || 0) + 1), 8, 30);
}

// ---------------------------------------------------------------------------
// node scene object
// ---------------------------------------------------------------------------

let ng19NodeCls = null;

/** Manifest factory: memoized graph-node class. */
export function ng19GraphNode() {
  if (ng19NodeCls) return ng19NodeCls;
  ng19NodeCls = class Ng19GraphNode {
    constructor() {
      this.x = null; this.y = null; this.fx = null; this.fy = null;
      this.forward = {}; this.reverse = {};
      this.weight = 0; this.color = undefined;
      this.rendered = false; this.fadeAlpha = 0;
      this.moveText = 0; this.fontDirty = true;
      this.renderer = null;
      this.graphics = null; this.text = null; this.touch = null;
      this._size = 0;
    }
    getSize() { return this._size || ng19NodeSize(this.weight, this.renderer && this.renderer.fNodeSizeMult); }
    getRelated() { return Object.keys(this.forward).length + Object.keys(this.reverse).length; }
    getDisplayText() { return ng19NodeLabel(this.id); }

    /** Lazily build the PIXI display objects (circle + label). */
    initGraphics(renderer) {
      const P = ng19PIXI();
      if (!P || this.rendered) return;
      this.renderer = renderer;
      const g = new P.Graphics();
      g.circle(0, 0, ng19GraphNodeBaseSize).fill({ color: 0xffffff });
      g.pivot.set(ng19GraphNodeBaseSize, ng19GraphNodeBaseSize);
      g.eventMode = "static";
      g.cursor = "pointer";
      g.zIndex = 1;
      this.graphics = g;
      this._wirePointer(g);
      if (env().Yl && env().Yl.isMobile) {
        const t = new P.Graphics();
        t.circle(0, 0, ng19GraphNodeBaseSize * 3).fill({ color: 0xffffff, alpha: 0.001 });
        t.pivot.set(ng19GraphNodeBaseSize * 3, ng19GraphNodeBaseSize * 3);
        t.eventMode = "none";
        this.touch = t;
        renderer.hanger.addChild(t);
      }
      const txt = new P.Text({
        text: "",
        style: {
          fontFamily: ng19FontStack,
          fontSize: 14,
          fill: 0xffffff,
          wordWrap: true,
          wordWrapWidth: 300,
          align: "center",
          resolution: 2,
        },
      });
      txt.eventMode = "none";
      txt.anchor.set(0.5, 0);
      txt.zIndex = 2;
      this.text = txt;
      renderer.hanger.addChild(g);
      renderer.hanger.addChild(txt);
      this.rendered = true;
    }

    _wirePointer(g) {
      const r = this.renderer;
      g.on("pointerdown", (evt) => { if (r && r._nodeDragStart) r._nodeDragStart(evt, this); });
      g.on("pointerover", (evt) => { if (r && r._nodeHoverIn) r._nodeHoverIn(evt, this); });
      g.on("pointerout", (evt) => { if (r && r._nodeHoverOut) r._nodeHoverOut(evt, this); });
      g.on("click", (evt) => { if (r && r._nodeActivate) r._nodeActivate(evt, this, false); });
      g.on("rightclick", (evt) => { if (r && r._nodeActivate) r._nodeActivate(evt, this, true); });
    }

    /** Per-frame visual update; `r` is the renderer. */
    render(r) {
      if (!this.rendered || this.x == null || this.y == null) return;
      const g = this.graphics;
      const hl = r.getHighlightNode();
      const isHl = hl === this;
      const neighbour = !!(hl && hl !== this && (hl.forward[this.id] || hl.reverse[this.id]));
      const targetAlpha = isHl || neighbour ? 1 : ng19GraphLinkAlpha;
      this.fadeAlpha = ng19Damp(this.fadeAlpha, targetAlpha, 0.9);

      this._size = ng19NodeSize(this.weight, r.fNodeSizeMult);
      const nodeScale = r.nodeScale;
      const scale = (this._size / ng19GraphNodeBaseSize) * nodeScale;
      const sx = (this.x - r.camX) * r.scale + r.width / 2 + r.panX;
      const sy = (this.y - r.camY) * r.scale + r.height / 2 + r.panY;
      g.position.set(sx, sy);
      g.scale.set(scale);
      g.alpha = this.fadeAlpha;
      if (this.touch) {
        this.touch.position.set(sx, sy);
        this.touch.scale.set(scale);
      }

      // label
      const txt = this.text;
      if (txt) {
        if (this.fontDirty) {
          this.fontDirty = false;
          txt.text = this.getDisplayText();
        }
        const lift = isHl ? 15 : 0;
        this.moveText = ng19Damp(this.moveText, lift, 0.9);
        txt.position.set(sx, sy - this._size * nodeScale * 0.5 - 4 - this.moveText * nodeScale);
        txt.scale.set(r.scale < 1 ? 1 / r.scale : 1, 1);
        txt.alpha = r.textAlpha * this.fadeAlpha;
        txt.style.fill = ng19NodeTextColor(this, r);
        const fs = 14 + this._size / 4;
        if (txt.style.fontSize !== fs) { txt.style.fontSize = fs; txt.updateText(); }
        txt.visible = txt.alpha > 0.001 &&
          sx > -300 && sx < r.width + 300 && sy > -200 && sy < r.height + 200;
      }

      // body fill + optional highlight ring, redrawn when the bucket changes
      const fill = ng19NodeFill(this, r, isHl);
      const ring = r.colors.circle;
      const lw = Math.max(1, 1 / r.scale / nodeScale);
      const key = (fill ? fill.rgb + ":" + Math.round(fill.a * 20) : "-") + (isHl ? ":hl" : "");
      if (g._fillKey !== key) {
        g._fillKey = key;
        g.clear();
        if (fill) g.circle(0, 0, ng19GraphNodeBaseSize).fill({ color: fill.rgb, alpha: fill.a });
        if (isHl) {
          g.circle(0, 0, ng19GraphNodeBaseSize).stroke({ color: ring ? ring.rgb : 0xffffff, width: lw, alpha: ring ? ring.a : 1 });
        }
      } else if (isHl && g._ringScale !== lw) {
        g._ringScale = lw;
      }
      if (isHl) g._ringScale = lw;
    }
  };
  return ng19NodeCls;
}

/** Fill colour for a node: highlight > focused > own colour > type colours > fill. */
function ng19NodeFill(node, r, isHl) {
  const c = r.colors;
  const alpha = node.fadeAlpha;
  if (isHl && c.fillHighlight) return { rgb: c.fillHighlight.rgb, a: c.fillHighlight.a * alpha };
  if (node.type === "focused" && c.fillFocused && c.fillFocused.a > 0) return { rgb: c.fillFocused.rgb, a: c.fillFocused.a * alpha };
  if (node.color !== undefined && node.color !== null) {
    const a = c.fill ? c.fill.a : 1;
    return { rgb: node.color, a: a * alpha };
  }
  const key = { tag: "fillTag", unresolved: "unresolved", attachment: "fillAttachment" }[node.type];
  const col = (key && c[key === "unresolved" ? "fillUnresolved" : key]) || c.fill;
  if (col) return { rgb: col.rgb, a: col.a * alpha };
  return { rgb: 0xffffff, a: alpha };
}

function ng19NodeTextColor(node, r) {
  const c = r.colors.text;
  return c ? c.rgb : 0xffffff;
}

// ---------------------------------------------------------------------------
// link scene object
// ---------------------------------------------------------------------------

let ng19LinkCls = null;

/** Manifest factory: memoized graph-link class. */
export function ng19GraphLink() {
  if (ng19LinkCls) return ng19LinkCls;
  ng19LinkCls = class Ng19GraphLink {
    constructor(fromId, toId) {
      this.fromId = fromId;
      this.toId = toId;
      this.source = null;
      this.target = null;
      this.rendered = false;
      this.alpha = 0;
      this.line = null;
      this.arrow = null;
      this.renderer = null;
      this._key = "";
    }
    initGraphics(renderer) {
      const P = ng19PIXI();
      if (!P || this.rendered) return;
      if (!this.source || !this.target || !this.source.rendered || !this.target.rendered) return;
      if (this.source.x == null || this.target.x == null) return;
      this.renderer = renderer;
      const line = new P.Sprite(P.Texture.WHITE);
      line.anchor.set(0, 0.5);
      line.tint = 0xffffff;
      line.eventMode = "none";
      const arrow = new P.Graphics();
      arrow.eventMode = "none";
      arrow.zIndex = 1;
      renderer.hanger.addChild(line);
      renderer.hanger.addChild(arrow);
      this.line = line;
      this.arrow = arrow;
      this.rendered = true;
    }

    render(r) {
      if (!this.rendered) return;
      const a = this.source, b = this.target;
      if (a.x == null || b.x == null) { this.line.visible = false; this.arrow.visible = false; return; }
      const hl = r.getHighlightNode();
      const touched = !!(hl && (hl === a || hl === b || hl.forward[this.fromId] || hl.forward[this.toId] || hl.reverse[this.fromId] || hl.reverse[this.toId]));
      const target = touched ? 1 : ng19GraphLinkAlpha;
      this.alpha = ng19Damp(this.alpha, target, 0.9);

      const sc = r.scale, ns = r.nodeScale;
      const sSize = a.getSize() * ns, tSize = b.getSize() * ns;
      const x1 = (a.x - r.camX) * sc + r.width / 2 + r.panX;
      const y1 = (a.y - r.camY) * sc + r.height / 2 + r.panY;
      const x2 = (b.x - r.camX) * sc + r.width / 2 + r.panX;
      const y2 = (b.y - r.camY) * sc + r.height / 2 + r.panY;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / len, uy = dy / len;
      // clip between node edges
      const px = x1 + ux * sSize * 0.5, py = y1 + uy * sSize * 0.5;
      const ex = x2 - ux * tSize * 0.5, ey = y2 - uy * tSize * 0.5;
      const elen = Math.max(0, Math.sqrt((ex - px) * (ex - px) + (ey - py) * (ey - py)));
      const inView = this.alpha > 0.001 &&
        Math.max(px, ex) > -50 && Math.min(px, ex) < r.width + 50 &&
        Math.max(py, ey) > -50 && Math.min(py, ey) < r.height + 50;
      this.line.visible = inView;
      this.arrow.visible = false;
      if (!inView) return;
      const thick = Math.max(1, r.fLineSizeMult) / Math.max(sc, 0.05);
      const key = `${px},${py},${ex},${ey},${Math.round(thick * 4)},${this.alpha > 0.5 ? 1 : 0},${touched ? 1 : 0}`;
      if (this.line.texture) {
        this.line.position.set(px, py);
        this.line.rotation = Math.atan2(ey - py, ex - px);
        this.line.width = elen;
        this.line.height = thick;
        this.line.alpha = this.alpha;
        const col = touched && r.colors.lineHighlight ? r.colors.lineHighlight : r.colors.line;
        this.line.tint = col ? col.rgb : 0xffffff;
      }
      // arrowhead
      if (r.fShowArrow && this.alpha > 0.001) {
        const arrAlpha = this.alpha * ng19Clamp(2 * (sc - 0.3), 0, 1);
        if (arrAlpha > 0.001) {
          const s = Math.sqrt(r.fLineSizeMult) / sc;
          const ax = ex - ux * 4 * s, ay = ey - uy * 4 * s;
          const pxn = -uy, pyn = ux;
          const w = 6 * s, h = 10 * s;
          const col = touched && r.colors.arrowHighlight ? r.colors.arrowHighlight : (r.colors.arrow || r.colors.line);
          this.arrow.clear();
          this.arrow.poly([ax + ux * h, ay + uy * h, ax - ux * h * 0.4 + pxn * w, ay - uy * h * 0.4 + pyn * w, ax - pxn * w * 0.2, ay - pyn * w * 0.2, ax - ux * h * 0.4 - pxn * w, ay - uy * h * 0.4 - pyn * w])
            .fill({ color: col ? col.rgb : 0xffffff, alpha: arrAlpha * (col ? col.a : 1) });
          this.arrow.visible = true;
        }
      }
      void key;
    }
  };
  return ng19LinkCls;
}

// ---------------------------------------------------------------------------
// power tag
// ---------------------------------------------------------------------------

let ng19TagCls = null;

/** Manifest factory: memoized power-tag class. */
export function ng19GraphPowerTag() {
  if (ng19TagCls) return ng19TagCls;
  ng19TagCls = class Ng19GraphPowerTag {
    constructor() {
      this.text = null;
      this.renderer = null;
    }
    init(renderer) {
      const P = ng19PIXI();
      if (!P || this.text) return;
      this.renderer = renderer;
      const t = new P.Text({
        text: ng19PowerTagText,
        style: { fontFamily: ng19FontStack, fontSize: 12, fill: 0xffffff },
      });
      t.eventMode = "none";
      t.anchor.set(1, 1);
      renderer.px.stage.addChild(t);
      this.text = t;
    }
    render() {
      const r = this.renderer;
      if (!this.text || !r) return;
      const col = r.colors.text;
      this.text.alpha = col ? col.a : 0.5;
      this.text.position.set(r.width, r.height);
      this.text.visible = !r.hidePowerTag;
    }
  };
  return ng19TagCls;
}

// ---------------------------------------------------------------------------
// colour probing
// ---------------------------------------------------------------------------

/** Probe the stylesheet for every `.graph-view <suffix>` colour class. */
function ng19ProbeColors(containerEl) {
  const out = {};
  const host = typeof document !== "undefined" ? document : null;
  if (!host) return out;
  const probe = host.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  for (const key in ng19GraphColorClasses) {
    const cls = ng19GraphColorClasses[key];
    probe.className = "graph-view " + cls;
    if (!probe.isConnected) (containerEl || host.body).appendChild(probe);
    const cs = host.defaultView.getComputedStyle(probe);
    const parsed = env().Ak ? env().Ak(cs.color) : null;
    const opacity = parseFloat(cs.opacity);
    const a = isNaN(opacity) ? 1 : opacity;
    if (parsed && typeof parsed.r === "number") {
      out[key] = { a: (parsed.a !== undefined ? parsed.a : 1) * a, rgb: (parsed.r << 16) | (parsed.g << 8) | parsed.b };
    } else {
      out[key] = { a, rgb: 8947848 };
    }
  }
  probe.remove();
  return out;
}

// ---------------------------------------------------------------------------
// renderer
// ---------------------------------------------------------------------------

let ng19RendererCls = null;

/** Manifest factory: memoized graph renderer class. */
export function ng19GraphRenderer() {
  if (ng19RendererCls) return ng19RendererCls;
  const NodeCls = ng19GraphNode();
  const LinkCls = ng19GraphLink();
  const TagCls = ng19GraphPowerTag();

  ng19RendererCls = class Ng19GraphRenderer {
    constructor(containerEl, iframeMode, hidePowerTag, worker) {
      this.containerEl = containerEl;
      this.hidePowerTag = !!hidePowerTag;
      this.nodes = [];
      this.links = [];
      this.nodeLookup = {};
      this.scale = 1;
      this.targetScale = 1;
      this.panX = 0; this.panY = 0;
      this.panvX = 0; this.panvY = 0;
      this.camX = 0; this.camY = 0;
      this.keyboardActions = {};
      this.highlightNode = null;
      this.dragNode = null;
      this.workerResults = null;
      this.width = 0; this.height = 0;
      this.dpr = 1;
      this.viewport = { left: 0, right: 0, top: 0, bottom: 0 };
      this.zoomCenterX = 0; this.zoomCenterY = 0;
      this.fNodeSizeMult = 1; this.fLineSizeMult = 1;
      this.fTextShowMult = 0; this.fShowArrow = false;
      this.textAlpha = 1; this.nodeScale = 1;
      this.colors = {};
      this.onNodeClick = null; this.onNodeRightClick = null;
      this.onNodeHover = null; this.onNodeUnhover = null;
      this.idleFrames = 0;
      this._workerVersion = 0;
      this._lastWorkerVersion = -1;
      this._destroyed = false;
      this._raf = null;
      this._retryTimer = null;
      this.hanger = null;
      this.powerTag = null;
      this.px = null;
      this.worker = null;
      this.interactiveEl = null;
      this.iframeEl = null;
      this.win = null;
      this._listeners = [];
      this._touches = new Map();
      this._pinch = null;
      this._dragging = null;

      this._buildDom(!!iframeMode, worker);
      this.testCSS();
      this.onResize();
    }

    // ------------------------------------------------------------ DOM / init

    _buildDom(iframeMode, worker) {
      const el = this.containerEl;
      el.style.padding = "0";
      el.style.overflow = "hidden";
      el.style.position = "relative";
      this.worker = worker || new Worker(ng19WorkerUrl, { name: ng19WorkerName });
      this.worker.onmessage = (evt) => this._onWorkerMessage(evt);

      if (iframeMode) {
        const frame = el.createEl("iframe");
        frame.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;";
        this.iframeEl = frame;
        this.interactiveEl = frame;
        this._listen(frame, "load", () => this._initIframeGraphics());
        this._listen(frame, "unload", () => this._teardownGraphics());
      } else {
        const canvas = el.createEl("canvas");
        canvas.className = "graph-canvas";
        canvas.style.cssText = "position:absolute;left:0;top:0;";
        this.interactiveEl = canvas;
        this._retryTimer = setTimeout(() => this._initGraphics(window, canvas), 50);
      }
      this._bindInput();
    }

    _listen(target, type, fn, opt) {
      target.addEventListener(type, fn, opt);
      this._listeners.push([target, type, fn, opt]);
    }

    _initIframeGraphics() {
      const frame = this.iframeEl;
      if (!frame || !frame.contentDocument) return;
      const doc = frame.contentDocument;
      doc.body.style.margin = "0";
      doc.body.style.padding = "0";
      doc.body.style.width = "100%";
      doc.body.style.height = "100%";
      doc.body.style.overflow = "hidden";
      doc.body.innerHTML = "<canvas></canvas>";
      const canvas = doc.querySelector("canvas");
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      this._initGraphics(frame.contentWindow, canvas);
    }

    _initGraphics(win, canvas) {
      const P = ng19PIXI();
      if (this._destroyed || !P) {
        if (!this._destroyed) this._retryTimer = setTimeout(() => this._initGraphics(win, canvas), 300);
        return;
      }
      try {
        this.win = win || window;
        this.dpr = this.win.devicePixelRatio || 1;
        const prevGL = typeof window !== "undefined" ? window.WebGL2RenderingContext : undefined;
        if (this.iframeEl && this.iframeEl.contentWindow) {
          window.WebGL2RenderingContext = this.iframeEl.contentWindow.WebGL2RenderingContext;
        }
        let app;
        try {
          app = new P.Application({
            view: canvas,
            antialias: true,
            backgroundAlpha: 0,
            autoStart: false,
            resolution: this.dpr,
            autoDensity: true,
          });
        } finally {
          if (prevGL !== undefined) window.WebGL2RenderingContext = prevGL;
        }
        this.px = app;
        if (!app.renderer && typeof app.init === "function") {
          // pixi v7 may finish init asynchronously; poll briefly
          const boot = () => {
            if (this._destroyed) return;
            if (app.renderer || app.stage) this._finishGraphics(app, win);
            else setTimeout(boot, 30);
          };
          boot();
          return;
        }
        this._finishGraphics(app, win);
      } catch (e) {
        if (!this._destroyed && !this._retryTimer) {
          this._retryTimer = setTimeout(() => this._initGraphics(win, canvas), 300);
        }
      }
    }

    _finishGraphics(app, win) {
      if (this._destroyed || this.hanger) return;
      this.win = win || this.win || window;
      const P = ng19PIXI();
      this.hanger = new P.Container();
      this.hanger.sortableChildren = true;
      app.stage.addChild(this.hanger);
      if (app.renderer && app.renderer.events && this.interactiveEl) {
        try { app.renderer.events.rootBoundary = this.interactiveEl; } catch (e) { /* optional */ }
      }
      this.powerTag = new TagCls();
      this.powerTag.init(this);
      this.onResize();
      this._schedule();
    }

    _teardownGraphics() {
      if (this.hanger) {
        try { this.hanger.destroy({ children: true }); } catch (e) { /* noop */ }
        this.hanger = null;
      }
      this.powerTag = null;
      this.px = null;
    }

    _schedule() {
      if (this._destroyed || this._raf || !this.win) return;
      const tick = () => {
        this._raf = null;
        if (this._destroyed) return;
        this._frame();
        if (!this._destroyed && this.px) this._raf = this.win.requestAnimationFrame(tick);
      };
      this._raf = this.win.requestAnimationFrame(tick);
    }

    // ------------------------------------------------------------ input

    _bindInput() {
      const el = this.interactiveEl;
      if (!el) return;
      el.addEventListener("mousedown", (e) => e.preventDefault());
      this._listen(el, "wheel", (e) => this._onWheel(e), { passive: false });
      this._listen(el, "mousemove", (e) => this._onMouseMove(e), { passive: true });
      this._listen(el, "mouseout", (e) => this._onMouseOut(e));
      this._listen(el, "mousedown", (e) => this._onPointerDown(e));
      this._listen(el, "mousemove", (e) => this._onPointerMove(e));
      this._listen(el, "mouseup", (e) => this._onPointerUp(e));
      this._listen(el, "touchstart", (e) => this._onTouchStart(e), { passive: false });
      this._listen(el, "touchmove", (e) => this._onTouchMove(e), { passive: false });
      this._listen(el, "touchend", (e) => this._onTouchEnd(e));
      this._listen(el, "touchcancel", (e) => this._onTouchEnd(e));
    }

    _onWheel(e) {
      e.preventDefault();
      const rect = this.interactiveEl.getBoundingClientRect ? this.interactiveEl.getBoundingClientRect() : { left: 0, top: 0 };
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      const delta = e.deltaY;
      const factor = delta < 0 ? 1.03 : 1 / 1.03;
      this.zoomTo(this.targetScale * factor, { x: cx, y: cy });
    }

    _onMouseMove(e) {
      if (this._dragging === "pan" || this._pinch) return;
      // hover leave handled per-node via PIXI events
    }

    _onMouseOut(e) {
      if (e.relatedTarget && this.containerEl.contains(e.relatedTarget)) return;
      this._clearHighlight();
    }

    _onPointerDown(e) {
      if (e.button !== 0 && e.pointerType !== "touch") return;
      this._dragging = "maybe";
      this._dragStart = { x: e.clientX, y: e.clientY, panX: this.panX, panY: this.panY };
      if (typeof document !== "undefined" && document.body) document.body.classList.add("is-grabbing");
    }

    _onPointerMove(e) {
      const rect = this.interactiveEl.getBoundingClientRect ? this.interactiveEl.getBoundingClientRect() : { left: 0, top: 0 };
      this._mouseX = e.clientX - rect.left;
      this._mouseY = e.clientY - rect.top;
      if (this._dragging !== "pan" && this._dragging !== "maybe") return;
      const dx = e.clientX - this._dragStart.x, dy = e.clientY - this._dragStart.y;
      if (this._dragging === "maybe" && Math.abs(dx) + Math.abs(dy) > 3) this._dragging = "pan";
      if (this._dragging === "pan") {
        this.panX = this._dragStart.panX + dx;
        this.panY = this._dragStart.panY + dy;
        this.panvX = dx; this.panvY = dy;
      }
    }

    _onPointerUp(e) {
      if (this._dragging === "pan") {
        // keep inertia velocity
      } else if (this._dragging === "maybe" && this.dragNode) {
        this._endNodeDrag();
      }
      this._dragging = null;
      if (typeof document !== "undefined" && document.body) document.body.classList.remove("is-grabbing");
    }

    _touchPos(t) {
      const rect = this.interactiveEl.getBoundingClientRect ? this.interactiveEl.getBoundingClientRect() : { left: 0, top: 0 };
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }

    _onTouchStart(e) {
      const touches = e.touches;
      if (touches.length === 1) {
        const p = this._touchPos(touches[0]);
        this._touches.set(touches[0].identifier, p);
        this._dragStart = { x: p.x, y: p.y, panX: this.panX, panY: this.panY };
        this._dragging = "maybe";
      } else if (touches.length === 2) {
        this._dragging = null;
        this._endNodeDrag();
        const a = this._touchPos(touches[0]), b = this._touchPos(touches[1]);
        this._pinch = {
          dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          scale: this.targetScale,
          mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          panX: this.panX, panY: this.panY,
          startA: a, startB: b,
        };
      }
    }

    _onTouchMove(e) {
      e.preventDefault();
      const touches = e.touches;
      if (this._pinch && touches.length === 2) {
        const a = this._touchPos(touches[0]), b = this._touchPos(touches[1]);
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.targetScale = ng19Clamp(this._pinch.scale * (dist / this._pinch.dist), 1 / 128, 8);
        this.scale = this.targetScale;
        this.panX = this._pinch.panX + (mid.x - this._pinch.mid.x);
        this.panY = this._pinch.panY + (mid.y - this._pinch.mid.y);
        this.panvX = 0; this.panvY = 0;
        return;
      }
      if (touches.length === 1 && this._dragging) {
        const p = this._touchPos(touches[0]);
        const dx = p.x - this._dragStart.x, dy = p.y - this._dragStart.y;
        if (this._dragging === "maybe" && Math.abs(dx) + Math.abs(dy) > 3) this._dragging = "pan";
        if (this._dragging === "pan") {
          this.panX = this._dragStart.panX + dx;
          this.panY = this._dragStart.panY + dy;
          // upstream quirk: only the horizontal delta feeds inertia
          this.panvX = dx;
          this.panvY = 0;
        }
      }
    }

    _onTouchEnd(e) {
      if (e.touches.length < 2) this._pinch = null;
      if (e.touches.length === 0) {
        this._dragging = null;
        this._touches.clear();
        if (typeof document !== "undefined" && document.body) document.body.classList.remove("is-grabbing");
      }
    }

    // ------------------------------------------------------------ node events

    _nodeDragStart(evt, node) {
      this.dragNode = node;
      node.fx = node.x; node.fy = node.y;
      this.postToWorker({ alpha: 0.3, alphaTarget: 0.3, run: true, forceNode: { id: node.id, x: node.x, y: node.y } });
      const win = this.win || window;
      const move = (ev) => {
        const rect = this.interactiveEl.getBoundingClientRect ? this.interactiveEl.getBoundingClientRect() : { left: 0, top: 0 };
        const wx = (ev.clientX - rect.left - this.width / 2 - this.panX) / this.scale + this.camX;
        const wy = (ev.clientY - rect.top - this.height / 2 - this.panY) / this.scale + this.camY;
        node.x = wx; node.y = wy; node.fx = wx; node.fy = wy;
        this.postToWorker({ alpha: 0.3, alphaTarget: 0.3, run: true, forceNode: { id: node.id, x: wx, y: wy } });
      };
      const up = () => {
        win.removeEventListener("mousemove", move);
        win.removeEventListener("mouseup", up);
        this._endNodeDrag();
      };
      win.addEventListener("mousemove", move);
      win.addEventListener("mouseup", up);
    }

    _endNodeDrag() {
      const node = this.dragNode;
      this.dragNode = null;
      if (node) {
        node.fx = null; node.fy = null;
        this.postToWorker({ alphaTarget: 0, forceNode: { id: node.id, x: null, y: null } });
      }
    }

    _nodeHoverIn(evt, node) {
      const native = evt && evt.nativeEvent;
      const isTouch = native && native.pointerType === "touch";
      if (isTouch) return;
      this.highlightNode = node;
      if (this.onNodeHover) this.onNodeHover(native || evt, node.id, node.type);
    }

    _nodeHoverOut(evt, node) {
      if (this.highlightNode === node) {
        this.highlightNode = null;
        if (this.onNodeUnhover) this.onNodeUnhover();
      }
    }

    _clearHighlight() {
      if (this.highlightNode || this.dragNode) {
        this.highlightNode = null;
        if (this.onNodeUnhover) this.onNodeUnhover();
      }
    }

    _nodeActivate(evt, node, isRight) {
      const native = evt && (evt.nativeEvent || evt);
      const button = native && typeof native.button === "number" ? native.button : 0;
      const modified = !!(native && (native.metaKey || native.ctrlKey));
      if (isRight || button === 2 || modified) {
        if (this.onNodeRightClick) this.onNodeRightClick(native, node.id, node.type);
      } else if (this.onNodeClick) {
        this.onNodeClick(native, node.id, node.type);
      }
    }

    getHighlightNode() { return this.dragNode || this.highlightNode; }

    // ------------------------------------------------------------ worker

    postToWorker(msg) {
      if (!this.worker) return;
      try { this.worker.postMessage(msg); } catch (e) { /* noop */ }
    }

    _onWorkerMessage(evt) {
      const data = evt && evt.data;
      if (!data || data.ignore) return;
      this.workerResults = data;
      this.idleFrames = 0;
    }

    _consumeWorkerResults() {
      const res = this.workerResults;
      this.workerResults = null;
      if (!res || !res.id || !res.buffer) return;
      const buf = res.buffer;
      if (!(buf instanceof ArrayBuffer) && !(buf instanceof Float32Array)) return;
      const f = buf instanceof Float32Array ? buf : new Float32Array(buf);
      const byteLen = buf instanceof Float32Array ? buf.byteLength : buf.byteLength;
      let version = null;
      if (byteLen >= 4) {
        const u = new Uint32Array(buf instanceof Float32Array ? buf.buffer : buf);
        version = u[u.length - 1];
      }
      if (version !== null && version !== undefined) {
        if (version < this._lastWorkerVersion) return; // stale
        this._lastWorkerVersion = version;
      }
      const ids = res.id;
      for (let i = 0; i < ids.length; i++) {
        const node = this.nodeLookup[ids[i]];
        if (!node) continue;
        const x = f[i * 2], y = f[i * 2 + 1];
        if (typeof x === "number" && isFinite(x) && typeof y === "number" && isFinite(y)) {
          node.x = x; node.y = y;
        }
      }
    }

    // ------------------------------------------------------------ data

    setData(data) {
      const nodes = (data && data.nodes) || {};
      const weights = data && data.weights;
      const NodeCls = ng19GraphNode();
      let changed = false;

      for (let i = this.nodes.length - 1; i >= 0; i--) {
        const n = this.nodes[i];
        if (!Object.hasOwn(nodes, n.id)) {
          this._removeNode(n);
          changed = true;
        }
      }
      for (const id in nodes) {
        if (!Object.hasOwn(nodes, id)) continue;
        const rec = nodes[id] || {};
        let n = this.nodeLookup[id];
        if (!n) {
          n = new NodeCls();
          n.id = id;
          n.type = rec.type || "";
          if (rec.color !== undefined) n.color = rec.color;
          this._seedPosition(n);
          this.nodes.push(n);
          this.nodeLookup[id] = n;
          changed = true;
        } else {
          if (n.type !== (rec.type || "")) { n.type = rec.type || ""; changed = true; }
          if (n.color !== rec.color) { n.color = rec.color; changed = true; }
        }
        // adjacency
        n.forward = {};
        const links = rec.links || {};
        for (const t in links) if (Object.hasOwn(links, t)) n.forward[t] = true;
      }
      // reverse maps + weights
      for (const n of this.nodes) {
        n.reverse = {};
        n.weight = weights ? (weights[n.id] !== undefined ? weights[n.id] : 0)
          : Object.keys(n.forward).length;
      }
      for (const n of this.nodes) {
        for (const t in n.forward) {
          const tn = this.nodeLookup[t];
          if (tn) tn.reverse[n.id] = true;
        }
      }
      // rebuild link records
      const LinkCls = ng19GraphLink();
      this.links = [];
      for (const n of this.nodes) {
        for (const t in n.forward) {
          const tn = this.nodeLookup[t];
          if (!tn) continue;
          const l = new LinkCls(n.id, t);
          l.source = n; l.target = tn;
          this.links.push(l);
        }
      }
      if (changed) this._postGraphState();
      this.idleFrames = 0;
    }

    _removeNode(n) {
      const i = this.nodes.indexOf(n);
      if (i >= 0) this.nodes.splice(i, 1);
      delete this.nodeLookup[n.id];
      if (n.graphics) { try { n.graphics.destroy(); } catch (e) {} }
      if (n.text) { try { n.text.destroy(); } catch (e) {} }
      if (n.touch) { try { n.touch.destroy(); } catch (e) {} }
      for (let j = this.links.length - 1; j >= 0; j--) {
        const l = this.links[j];
        if (l.fromId === n.id || l.toId === n.id) {
          if (l.line) { try { l.line.destroy(); } catch (e) {} }
          if (l.arrow) { try { l.arrow.destroy(); } catch (e) {} }
          this.links.splice(j, 1);
        }
      }
      if (this.highlightNode === n) this.highlightNode = null;
      if (this.dragNode === n) this.dragNode = null;
    }

    _seedPosition(n) {
      // centroid of already-placed neighbours + jitter, else a ring outside the crowd
      let sx = 0, sy = 0, cnt = 0, maxR = 0;
      for (const o of this.nodes) {
        if (o.x == null) continue;
        const d = Math.sqrt(o.x * o.x + o.y * o.y);
        if (d > maxR) maxR = d;
        if (o.forward[n.id] || o.reverse[n.id]) { sx += o.x; sy += o.y; cnt++; }
      }
      if (cnt > 0) {
        n.x = sx / cnt + (Math.random() - 0.5) * 40;
        n.y = sy / cnt + (Math.random() - 0.5) * 40;
        return;
      }
      const area = 60 * (this.nodes.length + 1) * 60;
      const radius = Math.sqrt(area / Math.PI + maxR * maxR) - maxR;
      const ang = Math.random() * Math.PI * 2;
      n.x = Math.cos(ang) * radius;
      n.y = Math.sin(ang) * radius;
    }

    _postGraphState() {
      const nodes = {};
      const links = [];
      for (const n of this.nodes) nodes[n.id] = [n.x == null ? 0 : n.x, n.y == null ? 0 : n.y];
      const seen = new Set();
      for (const n of this.nodes) {
        for (const t in n.forward) {
          const key = n.id + ">" + t;
          if (!seen.has(key)) { seen.add(key); links.push([n.id, t]); }
        }
      }
      this._workerVersion++;
      this.postToWorker({ nodes, links, alpha: 0.3, run: true });
    }

    // ------------------------------------------------------------ options

    setRenderOptions(options) {
      if (!options || typeof options !== "object") return;
      if (typeof options.nodeSizeMultiplier === "number") this.fNodeSizeMult = options.nodeSizeMultiplier;
      if (typeof options.lineSizeMultiplier === "number") this.fLineSizeMult = options.lineSizeMultiplier;
      if (typeof options.textFadeMultiplier === "number") this.fTextShowMult = options.textFadeMultiplier;
      if (typeof options.showArrow === "boolean") this.fShowArrow = options.showArrow;
      this.idleFrames = 0;
    }

    setForces(forces) {
      if (!forces || typeof forces !== "object") return;
      this.postToWorker({ forces, alpha: 0.3, run: true });
    }

    // ------------------------------------------------------------ colour

    testCSS() {
      this.colors = ng19ProbeColors(this.containerEl);
      for (const n of this.nodes) n.fontDirty = true;
      this.idleFrames = 0;
    }

    // ------------------------------------------------------------ view ops

    resetPan() {
      this.panX = 0; this.panY = 0; this.panvX = 0; this.panvY = 0;
      this.camX = 0; this.camY = 0;
    }

    zoomTo(scale, center) {
      const s = ng19Clamp(scale, 1 / 128, 8);
      this.targetScale = s;
      if (center) {
        // keep the world point under `center` (css px in the element) fixed
        const cx = center.x !== undefined ? center.x : this.width / 2;
        const cy = center.y !== undefined ? center.y : this.height / 2;
        const wx = (cx - this.width / 2 - this.panX) / this.scale + this.camX;
        const wy = (cy - this.height / 2 - this.panY) / this.scale + this.camY;
        this.zoomCenterX = wx; this.zoomCenterY = wy;
      } else {
        this.zoomCenterX = this.camX; this.zoomCenterY = this.camY;
      }
    }

    onResize() {
      const rect = this.containerEl.getBoundingClientRect ? this.containerEl.getBoundingClientRect() : null;
      this.width = rect ? rect.width : (this.containerEl.clientWidth || 0);
      this.height = rect ? rect.height : (this.containerEl.clientHeight || 0);
      this.dpr = (this.win && this.win.devicePixelRatio) || (typeof window !== "undefined" ? window.devicePixelRatio : 1) || 1;
      if (this.px && this.px.renderer) {
        try { this.px.renderer.resize(this.width, this.height); } catch (e) { /* noop */ }
      }
      if (this.interactiveEl && this.interactiveEl.style) {
        this.interactiveEl.style.width = this.width + "px";
        this.interactiveEl.style.height = this.height + "px";
      }
      this.idleFrames = 0;
    }

    // ------------------------------------------------------------ frame

    _frame() {
      if (!this.px || this._destroyed) return;
      this._consumeWorkerResults();

      // pan inertia + keyboard pan/zoom
      const k = this.keyboardActions;
      const boost = !!k.boost;
      const panStep = 8 * (boost ? 3 : 1);
      if (k.up) this.panvY += panStep;
      if (k.down) this.panvY -= panStep;
      if (k.left) this.panvX += panStep;
      if (k.right) this.panvX -= panStep;
      if (k.zoomin) this.zoomTo(this.targetScale * (boost ? 1.10 : 1.03));
      if (k.zoomout) this.zoomTo(this.targetScale / (boost ? 1.10 : 1.03));
      const dt = 1000 / 60;
      this.panX += this.panvX * dt * 0.06;
      this.panY += this.panvY * dt * 0.06;
      this.panvX *= 0.9; this.panvY *= 0.9;

      // ease scale toward target around zoom centre
      if (Math.abs(this.targetScale / this.scale - 1) >= 0.01) {
        const ns = ng19Damp(this.scale, this.targetScale, 0.85);
        const zcx = this.zoomCenterX, zcy = this.zoomCenterY;
        const wx = (this.width / 2 + this.panX - zcx * 0) ; // keep simple: adjust cam
        void wx;
        this.scale = ns;
        // recenter camera on the zoom point
        this.camX = zcx; this.camY = zcy;
      } else {
        this.scale = this.targetScale;
      }
      this.nodeScale = Math.sqrt(1 / this.scale);
      this.textAlpha = ng19Clamp(Math.log2(this.scale) + 1 - this.fTextShowMult, 0, 1);

      // viewport box (world coords, generous margin)
      const hw = this.width / 2 / this.scale, hh = this.height / 2 / this.scale;
      this.viewport = {
        left: this.camX - hw - 300, right: this.camX + hw + 300,
        top: this.camY - hh - 200, bottom: this.camY + hh + 200,
      };

      // init graphics for up to 50 unrendered nodes nearest the view centre
      const pending = this.nodes.filter((n) => !n.rendered).sort((a, b) => {
        const da = a.x == null ? 1e18 : (a.x - this.camX) * (a.x - this.camX) + (a.y - this.camY) * (a.y - this.camY);
        const db = b.x == null ? 1e18 : (b.x - this.camX) * (b.x - this.camX) + (b.y - this.camY) * (b.y - this.camY);
        return da - db;
      });
      for (let i = 0; i < Math.min(50, pending.length); i++) pending[i].initGraphics(this);
      for (const l of this.links) if (!l.rendered) l.initGraphics(this);

      for (const n of this.nodes) n.render(this);
      for (const l of this.links) l.render(this);
      if (this.powerTag) this.powerTag.render();
      if (this.hanger && this.hanger.sortChildren) this.hanger.sortChildren();

      try {
        if (typeof this.px.render === "function") this.px.render();
        else if (this.px.renderer) this.px.renderer.render(this.px.stage);
      } catch (e) { /* noop */ }

      // hover-leave: clear highlight when pointer is outside the node radius
      const hl = this.highlightNode;
      if (hl && hl.rendered && hl.x != null) {
        const sx = (hl.x - this.camX) * this.scale + this.width / 2 + this.panX;
        const sy = (hl.y - this.camY) * this.scale + this.height / 2 + this.panY;
        const rad = hl.getSize() * this.nodeScale + 2;
        const mx = this._mouseX, my = this._mouseY;
        if (mx != null && (mx - sx) * (mx - sx) + (my - sy) * (my - sy) > rad * rad) {
          this._clearHighlight();
        }
      }
      this.idleFrames++;
    }

    // ------------------------------------------------------------ shots

    getTransparentScreenshot() {
      try { if (this.px && typeof this.px.render === "function") this.px.render(); } catch (e) {}
      return this.px && (this.px.canvas || this.px.view);
    }

    getBackgroundScreenshot() {
      const src = this.getTransparentScreenshot();
      if (!src) return null;
      const doc = (this.win && this.win.document) || document;
      const c = doc.createElement("canvas");
      c.width = src.width || this.width;
      c.height = src.height || this.height;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(src, 0, 0);
      return c;
    }

    copyToClipboard(canvas, type) {
      const mime = type || "image/png";
      return new Promise((resolve, reject) => {
        try {
          canvas.toBlob(async (blob) => {
            try {
              if (navigator.clipboard && window.ClipboardItem) {
                await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
                resolve();
              } else if (navigator.clipboard) {
                reject(new Error("clipboard image write unsupported"));
              } else {
                reject(new Error("no clipboard"));
              }
            } catch (e) { reject(e); }
          }, mime);
        } catch (e) { reject(e); }
      });
    }

    destroy() {
      this._destroyed = true;
      if (this._raf && this.win) { try { this.win.cancelAnimationFrame(this._raf); } catch (e) {} }
      this._raf = null;
      if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
      for (const [t, type, fn, opt] of this._listeners) {
        try { t.removeEventListener(type, fn, opt); } catch (e) {}
      }
      this._listeners = [];
      if (this.worker) { try { this.worker.terminate(); } catch (e) {} this.worker = null; }
      if (this.px) {
        try { if (typeof this.px.destroy === "function") this.px.destroy(true, { children: true }); } catch (e) {}
        this.px = null;
      }
      for (const n of this.nodes) {
        if (n.graphics) { try { n.graphics.destroy(); } catch (e) {} }
        if (n.text) { try { n.text.destroy(); } catch (e) {} }
        if (n.touch) { try { n.touch.destroy(); } catch (e) {} }
      }
      this.nodes = []; this.links = []; this.nodeLookup = {};
      if (typeof document !== "undefined" && document.body) document.body.classList.remove("is-grabbing");
    }
  };
  return ng19RendererCls;
}
