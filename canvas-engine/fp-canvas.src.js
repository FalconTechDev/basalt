// Hybrid canvas: the wasm engine (falconplot-based) paints grid, edges and far cards
// on a <canvas> under Basalt's DOM; cards wide enough on screen stay real DOM.
(() => {
  "use strict";
  const WASM_B64 = "__WASM_B64__";
  const SIDE = { top: 0, right: 1, bottom: 2, left: 3 };
  const STRIDE = 8;
  const DEFAULTS = {
    fpHybrid: true,
    fpDomMode: "auto",      // auto: the budget follows measured frame time; manual: the sliders rule
    fpDomBudget: 100,       // manual: cards that keep real DOM
    fpMinDomPx: 24,         // manual: narrowest card (px on screen) that gets DOM
    fpEdgeDomScale: 0.45,   // manual: DOM edges (selectable) from this scale up
    fpHideDomOnZoom: true,  // manual: hide DOM and let the engine paint while zooming
    fpSettleMs: 140,        // manual: wait this long after zooming before DOM comes back
    fpAutoTargetMs: 20,     // auto: frame time to hold while panning / zooming
    fpAutoMin: 20,          // auto: never fewer DOM cards than this
    fpAutoMax: 300,         // auto: never more than this
    fpFarText: true,        // real title + first line on cards the engine paints
    fpFarTextPx: 56,        // ...when they are at least this wide on screen
    fpLineStyle: "curve",   // default line of a link: curve | straight | elbow | round
    fpGridStep: 20,         // grid step (px at the base zoom); snapping uses the same
    fpSnapDist: 8,          // how close (screen px) a card must come to snap to another one
    fpMinimap: true,        // overview of the whole canvas in a corner
    fpMinimapSize: 220,     // its width, px
    fpShape: 1,             // card outline: 0 rounded, 1 Грань, 2 Базальт, 3 Скол, 4 Кристалл
  };
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  const opts = (canvas) => {
    const o = (canvas.view && canvas.view.plugin && canvas.view.plugin.options) || {};
    return {
      hybrid: canvas.__bsPreview ? false : o.fpHybrid !== false,
      auto: (o.fpDomMode || DEFAULTS.fpDomMode) === "auto",
      budget: num(o.fpDomBudget, DEFAULTS.fpDomBudget),
      minPx: canvas.__bsPreview ? 0 : num(o.fpMinDomPx, DEFAULTS.fpMinDomPx),
      edgeScale: num(o.fpEdgeDomScale, DEFAULTS.fpEdgeDomScale),
      hideOnZoom: o.fpHideDomOnZoom !== false,
      settleMs: num(o.fpSettleMs, DEFAULTS.fpSettleMs),
      targetMs: num(o.fpAutoTargetMs, DEFAULTS.fpAutoTargetMs),
      autoMin: num(o.fpAutoMin, DEFAULTS.fpAutoMin),
      autoMax: num(o.fpAutoMax, DEFAULTS.fpAutoMax),
      farText: o.fpFarText !== false,
      farTextPx: num(o.fpFarTextPx, DEFAULTS.fpFarTextPx),
      lineStyle: ["curve", "straight", "elbow", "round"].includes(o.fpLineStyle) ? o.fpLineStyle : DEFAULTS.fpLineStyle,
      gridStep: Math.min(80, Math.max(5, num(o.fpGridStep, DEFAULTS.fpGridStep))),
      snapDist: Math.min(30, Math.max(2, num(o.fpSnapDist, DEFAULTS.fpSnapDist))),
      minimap: o.fpMinimap !== false,
      minimapSize: Math.min(400, Math.max(140, num(o.fpMinimapSize, DEFAULTS.fpMinimapSize))),
      shape: Math.min(4, Math.max(0, num(o.fpShape, DEFAULTS.fpShape) | 0)),
    };
  };

  // Auto mode: hold the frame time near a target by moving the DOM budget. Frames are timed only
  // while the view is actually changing (pan / zoom), so an idle canvas never drags the number around.
  function autoTune(st, o, now) {
    if (st.autoBudget === undefined) st.autoBudget = Math.min(Math.max(100, o.autoMin), o.autoMax);
    const dt = st.lastFrameAt ? now - st.lastFrameAt : 0;
    st.lastFrameAt = now;
    if (dt <= 0 || dt > 120) { st.autoN = 0; st.autoSum = 0; return; } // a pause, not a frame
    st.autoSum += dt;
    st.autoN += 1;
    if (st.autoN < 24) return;
    const avg = st.autoSum / st.autoN;
    st.autoN = 0; st.autoSum = 0;
    st.autoAvg = avg;
    let b = st.autoBudget;
    if (avg > o.targetMs * 1.3) b = Math.floor(b * 0.75);
    else if (avg < o.targetMs * 0.9) b = Math.ceil(b * 1.12) + 4;
    b = Math.min(o.autoMax, Math.max(o.autoMin, b));
    if (b !== st.autoBudget) { st.autoBudget = b; st.needPick = true; }
  }

  let ex = null;
  const bytes = (b64) => {
    const s = atob(b64);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  };
  WebAssembly.instantiate(bytes(WASM_B64), {})
    .then((r) => { ex = r.instance.exports; })
    .catch((e) => console.error("[fp-canvas] wasm load failed", e));

  const css = document.createElement("style");
  css.textContent = `
    .canvas-wrapper.fp-on > .canvas-background { display: none; }
    /* coloured cards: a real tint and a full-strength border, so every colour reads against the dark theme */
    .canvas-wrapper .canvas-node.is-themed .canvas-node-container { background-color: color-mix(in srgb, rgb(var(--canvas-color)) 24%, var(--background-primary)); border-color: rgb(var(--canvas-color)); box-shadow: inset 0 0 0 1px rgba(var(--canvas-color), .9), var(--shadow-stationary); }
    .canvas-wrapper .canvas-node.is-themed .canvas-node-container .markdown-preview-view, .canvas-wrapper .canvas-node.is-themed .canvas-node-container .cm-editor { background: transparent; }
    .canvas-wrapper > canvas.fp-canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
    .canvas-wrapper.fp-on.fp-farlinks .canvas-edges .canvas-display-path, .canvas-wrapper.fp-on.fp-farlinks .canvas-edges .canvas-path-end { visibility: hidden; }
    .canvas-wrapper.fp-on .canvas-edges .is-focused .canvas-display-path,
    .canvas-wrapper.fp-on .canvas-edges .is-focused .canvas-path-end { visibility: visible; }
    .canvas-wrapper.fp-on .canvas.is-connecting .canvas-edges .canvas-display-path,
    .canvas-wrapper.fp-on .canvas.is-connecting .canvas-edges .canvas-path-end { visibility: visible; }
    .fp-handles .fp-h-pt { fill: var(--interactive-accent); stroke: var(--background-primary); stroke-width: 2px; vector-effect: non-scaling-stroke; pointer-events: all; cursor: grab; }
    .fp-handles .fp-h-pt:hover { fill: var(--text-on-accent); stroke: var(--interactive-accent); }
    .fp-handles .fp-h-mid { display: none; } .fp-handles .fp-h-mid.fp-h-main, .canvas-wrapper.fp-ctrl .fp-handles .fp-h-mid { display: block; }
    /* links: easier to hit, light up under the pointer */
    .canvas-wrapper.fp-on .canvas-edges .canvas-interaction-path { stroke-width: 22px !important; vector-effect: non-scaling-stroke; }
    .canvas-wrapper.fp-on .canvas-edges g:hover > .canvas-display-path, .canvas-wrapper.fp-on .canvas-edges g:hover > .canvas-path-end { visibility: visible; stroke: var(--interactive-accent); opacity: .95; }
    .canvas-wrapper.fp-on .canvas-edges g:hover > .canvas-display-path { stroke-width: 3px; }
    .fp-handles .fp-h-mid { fill: var(--background-primary); fill-opacity: .85; stroke: var(--interactive-accent); stroke-width: 1.5px; vector-effect: non-scaling-stroke; pointer-events: all; cursor: copy; }
    .fp-handles .fp-h-mid:hover { fill: var(--interactive-accent); }
    .fp-handles .fp-h-ghost { fill: var(--interactive-accent); fill-opacity: .45; pointer-events: none; }
    .fp-handles .fp-h-end { fill: var(--background-primary); stroke: var(--interactive-accent); stroke-width: 2px; vector-effect: non-scaling-stroke; pointer-events: all; cursor: crosshair; }
    .fp-handles .fp-h-end:hover { fill: var(--interactive-accent); }
    .fp-handles .fp-h-hit { fill: none; stroke: transparent; pointer-events: stroke; cursor: copy; }
    .fp-handles .fp-h-guide { stroke: var(--interactive-accent); stroke-width: 1px; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; opacity: .8; pointer-events: none; }
    .bs-live { position: absolute; inset: 0; overflow: hidden; z-index: 4; pointer-events: none; border-radius: inherit; background: var(--background-primary); }
    .bs-live .workspace-leaf-content, .bs-live .view-content { height: 100%; }
    .bs-live .view-header, .bs-live .canvas-controls, .bs-live .canvas-card-menu, .bs-live .canvas-minimap, .bs-live .fp-minimap, .bs-live .canvas-menu-container, .bs-live .canvas-selection { display: none !important; }
    .canvas-embed.bs-live-on > :not(.bs-live):not(.canvas-node-content-blocker) { display: none !important; }
    .canvas-embed.bs-has .canvas-minimap { display: none; } canvas.bs-nested { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
    @keyframes fp-open { from { opacity: 0; } to { opacity: 1; } }
    .canvas-wrapper.fp-opening { animation: fp-open .32s ease-out both; }
    /* a picture card always fills its card (stock only shrinks it, so a stretched card kept the image at its own size) */
    .canvas-wrapper .canvas-node-content.media-embed.image-embed { align-items: stretch; }
    .canvas-wrapper .canvas-node-content.media-embed.image-embed img { width: 100%; height: 100%; max-width: none; object-fit: contain; flex: 1 1 auto; }
    @keyframes fp-img-in { from { opacity: 0; transform: scale(.985); } to { opacity: 1; transform: none; } }
    .canvas-wrapper.fp-on .canvas-node-content img { animation: fp-img-in .35s ease-out both; }
    .canvas-wrapper.fp-export > canvas.fp-canvas { display: none; }
    .canvas-wrapper.fp-on.fp-export > .canvas-background { display: block; }
    .canvas-wrapper.fp-on.fp-export .canvas-edges .canvas-display-path,
    .canvas-wrapper.fp-on.fp-export .canvas-edges .canvas-path-end { visibility: visible; }
    .canvas-wrapper.fp-on .canvas-node.fp-far .canvas-node-container,
    .canvas-wrapper.fp-on .canvas-node.fp-far .canvas-group-label { opacity: 0; }

    /* Basalt card shapes: the outline is a clip-path plus an SVG stroke (a CSS border would be cut by the clip) */
    .canvas-wrapper.fp-shape { --fp-card: #f1eadf; --fp-edge: #b3a18a; --fp-ink: #29201a; --fp-page: #dcd2c3; }
    .theme-dark .canvas-wrapper.fp-shape { --fp-card: #221c18; --fp-edge: #5a4634; --fp-ink: #ece4db; --fp-page: #14110f; }
    .canvas-wrapper.fp-on.fp-shape { background-color: var(--fp-page); }
    .canvas-wrapper.fp-shape .canvas-node:not(.mod-group) .canvas-node-container { background: var(--fp-card); color: var(--fp-ink); border: 0; box-shadow: none; border-radius: 0; }
    .canvas-wrapper.fp-shape .canvas-node:not(.mod-group) > .fp-outline { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; z-index: 1; }
    .canvas-wrapper.fp-shape .fp-outline polygon { fill: none; stroke: var(--fp-edge); stroke-width: 1.5; stroke-linejoin: round; }
    .canvas-wrapper.fp-shape .canvas-node[style*="--canvas-color"] .fp-outline polygon { stroke: rgba(var(--canvas-color), 0.8); }
    .canvas-wrapper.fp-shape .canvas-node.is-focused .fp-outline polygon,
    .canvas-wrapper.fp-shape .canvas-node.is-selected .fp-outline polygon { stroke: var(--interactive-accent); stroke-width: 2; }
    .canvas-wrapper.fp-shape.fp-export .fp-outline { display: block; }
    .fp-shape-picker { display: flex; gap: 4px; padding: 6px; }
    .fp-shape-item { display: flex; flex-direction: column; gap: 2px; align-items: center; justify-content: center; padding: 4px 6px; border-radius: var(--radius-s); cursor: pointer; color: var(--text-muted); }
    .fp-shape-name { font-size: 10px; line-height: 1; white-space: nowrap; }
    .fp-shape-item:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
    .fp-end-picker { position: fixed; z-index: 1000; display: flex; gap: 6px; padding: 8px; background: var(--background-secondary); color: var(--text-normal);
      clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px); }
    .fp-end-col { display: flex; flex-direction: column; gap: 1px; min-width: 150px; }
    .fp-end-col + .fp-end-col { border-left: 1px solid var(--background-modifier-border); padding-left: 6px; }
    .fp-end-title { font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: var(--text-faint); padding: 2px 6px 4px; }
    .fp-end-item { display: flex; align-items: center; gap: 8px; padding: 4px 6px; cursor: pointer; color: var(--text-muted); font-size: var(--font-ui-small); }
    .fp-end-item:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
    .fp-end-item.is-active { color: var(--interactive-accent); background: var(--background-modifier-hover); }
    .fp-minimap { position: absolute; right: 14px; bottom: 14px; z-index: 5; padding: 0; background: var(--background-primary); border: 1px solid var(--background-modifier-border-hover); border-radius: 0; clip-path: var(--bs-clip);  overflow: hidden;
      cursor: crosshair;  }
    .fp-minimap canvas { display: block; }
    .fp-minimap:hover { border-color: var(--interactive-accent); }
    .fp-types { max-height: 80vh; overflow-y: auto; position: fixed; z-index: 1000; min-width: 240px; padding: 6px; background: var(--background-secondary); color: var(--text-normal);
      clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px); filter: none; }
    .fp-type-row { display: flex; align-items: center; gap: 12px; padding: 6px 10px; cursor: pointer; }
    .fp-type-row:hover { background: var(--background-modifier-hover); }
    .fp-type-ico { width: 40px; display: flex; justify-content: center; }
    .fp-type-ico i { display: block; border: 1.5px solid var(--interactive-accent); background: color-mix(in srgb, var(--interactive-accent) 18%, transparent);
      clip-path: polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px); }
    .fp-type-name { flex: 1; }
    .fp-type-row small { color: var(--text-faint); }
    .fp-preview { position: fixed; z-index: 1001; pointer-events: none; background: var(--background-secondary); color: var(--text-normal); padding: 6px; box-shadow: none;
      clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px); }
    .fp-nested { position: absolute; inset: 0; background: var(--background-primary); pointer-events: none; z-index: 2; display: flex; align-items: center; justify-content: center; }
    .fp-nested canvas { display: block; }
    .fp-preview-head { font-size: var(--font-ui-smaller); color: var(--text-muted); padding: 2px 6px 4px; }
    .fp-present { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 30; display: flex; gap: 10px; align-items: center; padding: 8px 14px; background: var(--background-secondary); color: var(--text-normal);
      clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px); }
    .fp-present button { padding: 4px 14px; } .fp-pv-n { min-width: 64px; text-align: center; font-variant-numeric: tabular-nums; }
    .fp-shape-item.is-active { color: var(--interactive-accent); background: var(--background-modifier-hover); }
  `;
  document.head.appendChild(css);

  // Outline from the engine itself, so the DOM card and the engine-painted card always match.
  function shapePts(shape, w, h) {
    if (!ex) return [[0, 0], [w, 0], [w, h], [0, h]];
    const ptr = ex.ce_shape(shape, w, h), n = ex.ce_shape_len();
    const f = new Float32Array(ex.memory.buffer, ptr, n), out = [];
    for (let i = 0; i < n; i += 2) out.push([f[i], f[i + 1]]);
    return out;
  }
  const SVGNS = "http://www.w3.org/2000/svg";
  // edge end markers: a stock end is "none" or "arrow"; these add more (stored in the canvas file as fromEnd / toEnd)
  const END_NAMES = ["none", "arrow", "open", "square", "diamond", "circle", "bar", "dot"];
  const END_LABELS = ["Без маркера", "Стрелка", "Открытая стрелка", "Квадрат", "Ромб", "Круг", "Черта", "Точка"];
  const endIdx = (t) => { const i = END_NAMES.indexOf(t); return i < 0 ? 0 : i; };
  function endPts(kind) {
    if (!ex) return null;
    const ptr = ex.ce_end_pts(kind), n = ex.ce_shape_len();
    const f = new Float32Array(ex.memory.buffer, ptr, n), out = [];
    for (let i = 0; i < n; i += 2) out.push([f[i], f[i + 1]]);
    return out;
  }
  // used by the patched createEdgeEnd: polygon points for a marker, or null for the stock handling
  window.__fpEndPoints = (type) => {
    const k = endIdx(type);
    if (k < 2) return null; // none / arrow stay stock
    const p = endPts(k);
    return p && p.length ? p.map((q) => q[0].toFixed(2) + "," + q[1].toFixed(2)).join(" ") : null;
  };
  function styleShape(n, shape) {
    const el = n.nodeEl;
    const key = shape + ":" + n.width + "x" + n.height;
    if (n.__fpShapeKey === key) return;
    n.__fpShapeKey = key;
    const box = el.querySelector(":scope > .canvas-node-container");
    if (!box) { n.__fpShapeKey = ""; return; }
    let svg = el.querySelector(":scope > .fp-outline");
    if (!shape || el.classList.contains("mod-group")) {
      box.style.clipPath = "";
      if (svg) svg.remove();
      return;
    }
    const pts = shapePts(shape, n.width, n.height).map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1));
    box.style.clipPath = "polygon(" + pts.map((q) => q.replace(",", "px ") + "px").join(",") + ")";
    if (!svg) { svg = document.createElementNS(SVGNS, "svg"); svg.setAttribute("class", "fp-outline"); svg.appendChild(document.createElementNS(SVGNS, "polygon")); el.appendChild(svg); }
    svg.setAttribute("viewBox", "0 0 " + n.width + " " + n.height);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.firstChild.setAttribute("points", pts.join(" "));
  }

  const states = new WeakMap();

  // the accent colour (Appearance settings) changes <body>'s style/class; repaint canvases at once so selection colours follow
  let accentVer = 0;
  const watchAccent = () => {
    if (!document.body) return;
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        accentVer++;
        try {
          for (const leaf of app.workspace.getLeavesOfType("canvas")) {
            const c = leaf.view && leaf.view.canvas;
            if (c) { c.viewportChanged = true; c.requestFrame && c.requestFrame(); }
          }
        } catch (e) { /* workspace not ready */ }
      });
    }).observe(document.body, { attributes: true, attributeFilter: ["style", "class"] });
  };
  if (document.body) watchAccent(); else document.addEventListener("DOMContentLoaded", watchAccent);

  const colorCode = (c) => {
    if (!c) return 0;
    if (/^[1-6]$/.test(c)) return +c;
    const m = /^#?([0-9a-f]{6})$/i.exec(c);
    return m ? 0x01000000 | parseInt(m[1], 16) : 0;
  };

  const accentOf = (el) => {
    const v = getComputedStyle(el).getPropertyValue("--interactive-accent").trim();
    const m = /^#?([0-9a-f]{6})$/i.exec(v);
    if (m) return parseInt(m[1], 16);
    const r = /(\d+)\D+(\d+)\D+(\d+)/.exec(v);
    return r ? (+r[1] << 16) | (+r[2] << 8) | +r[3] : 0x7852ee;
  };

  // a card's own shape (kept in the canvas file as an extra field) wins over the setting
  const SHAPE_NAMES = ["Обычная", "Грань", "Базальт", "Скол", "Кристалл"];
  const nodeShape = (n) => {
    const own = n.unknownData && n.unknownData.fpShape;
    if (Number.isInteger(own) && own >= 0 && own <= 4) return own;
    return opts(n.canvas).shape;
  };
  const sigOf = (n) => n.x + "," + n.y + "," + n.width + "," + n.height + "," + n.color + "," + nodeShape(n);

  function ensure(canvas) {
    let st = states.get(canvas);
    if (st) return st;
    const wrap = canvas.wrapperEl;
    const el = document.createElement("canvas");
    el.className = "fp-canvas";
    wrap.insertBefore(el, wrap.firstChild);
    wrap.classList.add("fp-on");
    bindFarInteraction(canvas);
    st = { el, ctx: el.getContext("2d"), on: true, domSet: new Set(), dirty: true, nodes: [], idx: new Map(), view: null, accent: 0x7852ee, sig: new Map() };
    states.set(canvas, st);
    liveCanvases.add(canvas);
    wrap.classList.add("fp-opening"); setTimeout(() => wrap.classList.remove("fp-opening"), 450);
    for (const m of ["markMoved", "addNode", "removeNode", "addEdge", "removeEdge", "updateSelection", "importData", "applyHistory"]) {
      const orig = canvas[m];
      if (typeof orig !== "function") continue;
      const reload = m === "importData" || m === "applyHistory";
      canvas[m] = function (...a) {
        st.dirty = true;
        // the edges are rebuilt: drop the handles of the old ones so no ghost line is left to hover
        if (reload) { const h = this.__fpHandles; if (h) { h.key = ""; h.svg.textContent = ""; h.gsvg.textContent = ""; } }
        const r = orig.apply(this, a);
        if (reload) for (const ms of [0, 120, 500]) setTimeout(() => { st.dirty = true; for (const e of this.edges.values()) this.markDirty && this.markDirty(e); this.viewportChanged = true; this.requestFrame && this.requestFrame(); }, ms);
        return r;
      };
    }
    if (typeof canvas.markDirty === "function") {
      const origMark = canvas.markDirty;
      // an edge changed (marker, side): the engine copy is stale
      canvas.markDirty = function (...a) { const x = a[0]; if (x && x.from && x.to && !x.nodeEl) st.dirty = true; return origMark.apply(this, a); };
    }
    // the stock grid spacing is 20 / 40 / 80 / 160 by zoom; scale it by the chosen step. Snapping reads the same getter.
    try {
      Object.defineProperty(canvas, "gridSpacing", { configurable: true, get() { const z = this.zoom; return (z < -3.3 ? 8 : z < -2.16 ? 4 : z < -0.91 ? 2 : 1) * opts(this).gridStep; } });
      Object.defineProperty(canvas, "snapDistance", { configurable: true, get() { return Math.ceil(opts(this).snapDist / this.scale); } });
    } catch (e) { /* stock getters stay */ }
    if (typeof canvas.requestSave === "function") {
      const origSave = canvas.requestSave;
      canvas.requestSave = function (...a) {
        const r = origSave.apply(this, a);
        try { const ae = document.activeElement; if (!ae || ae === document.body || (ae.closest && ae.closest(".fp-types, .fp-end-picker, .fp-minimap, .fp-present"))) canvas.wrapperEl.focus({ preventScroll: true }); } catch (e) { /* no focus to give */ }
        return r;
      };
    }
    // typing in a card must not fill the board's undo list with half-typed texts: one entry is made when editing ends
    if (typeof canvas.requestPushHistory === "function") {
      const origPush = canvas.requestPushHistory;
      const editing = () => { for (const n of canvas.nodes.values()) if (n.isEditing) return true; return false; };
      let wait = 0;
      const wrapped = function (...a) {
        if (!editing()) return origPush.apply(this, a);
        st.histPending = true;
        if (!wait) wait = setInterval(() => { if (editing()) return; clearInterval(wait); wait = 0; if (st.histPending) { st.histPending = false; origPush.call(canvas, canvas.getData()); } }, 250);
      };
      // the stock one is a debounced function with .cancel() / .run(): keep every property, the canvas calls them
      for (const key of Object.getOwnPropertyNames(origPush)) { if (!(key in wrapped) || key === "cancel" || key === "run" || key === "flush") { try { wrapped[key] = typeof origPush[key] === "function" ? origPush[key].bind(origPush) : origPush[key]; } catch (e) { /* read-only */ } } }
      if (typeof origPush.cancel === "function") wrapped.cancel = function () { if (wait) { clearInterval(wait); wait = 0; } st.histPending = false; return origPush.cancel.apply(origPush, arguments); };
      canvas.requestPushHistory = wrapped;
      // the stock undo does not look at a change that is still waiting in the 250 ms debounce (a stroke or a move made a moment ago), so Ctrl+Z
      // right after it undid the step before it. Whatever is pending is committed first.
      const flush = () => {
        try {
          if (editing()) return;
          if (st.histPending) { st.histPending = false; if (wait) { clearInterval(wait); wait = 0; } origPush.cancel && origPush.cancel(); origPush.call(canvas, canvas.getData()); }
          else if (typeof origPush.run === "function") origPush.run();
        } catch (e) { /* nothing pending */ }
      };
      for (const m of ["undo", "redo"]) { const orig = canvas[m]; if (typeof orig === "function") canvas[m] = function (...a) { flush(); this.__inHistory = true; let res; try { res = orig.apply(this, a); } finally { this.__inHistory = false; } try { const v = this.view; if (v.requestSave && typeof v.requestSave.run === "function") v.requestSave.run(); else if (typeof v.save === "function") { const pr = v.save(); if (pr && pr.catch) pr.catch(() => {}); } } catch (e) { /* saved with the usual delay */ } return res; }; }
    }
    const origEdges = canvas.getIntersectingEdges;
    if (typeof origEdges === "function") {
      canvas.getIntersectingEdges = function (...a) {
        return (st.zooming || (st.on && this.scale < opts(this).edgeScale)) && !this.screenshotting ? [] : origEdges.apply(this, a);
      };
    }
    // DOM only for cards near enough to read; the engine paints and hit-tests the rest
    const origNodes = canvas.getIntersectingNodes;
    const origVirt = canvas.virtualize;
    if (typeof origNodes === "function" && typeof origVirt === "function") {
      canvas.virtualize = function (...a) {
        st.inVirt = true;
        try { return origVirt.apply(this, a); } finally { st.inVirt = false; }
      };
      canvas.getIntersectingNodes = function (...a) {
        const all = origNodes.apply(this, a);
        if (!st.inVirt || this.screenshotting) return all;
        if (st.zooming) return all.filter((n) => n.isAttached);
        if (!st.on) return all;
        return all.filter((n) => st.domSet.has(n) || n.isEditing);
      };
    }
    // PNG export renders the whole canvas as DOM: switch the engine layer off while it runs
    let shooting = !!canvas.screenshotting;
    Object.defineProperty(canvas, "screenshotting", {
      configurable: true,
      get: () => shooting,
      set: (v) => {
        shooting = !!v;
        wrap.classList.toggle("fp-export", shooting);
        if (!shooting) st.dirty = true;
      },
    });
    const origDirty = canvas.markDirty;
    if (typeof origDirty === "function") {
      canvas.markDirty = function (n, ...a) {
        if (!n || !n.nodeEl || st.sig.get(n) !== sigOf(n)) st.dirty = true;
        return origDirty.call(this, n, ...a);
      };
    }
    return st;
  }

  function farHit(canvas, pos, st) {
    const sc = canvas.scale;
    let card = null, group = null;
    for (const n of canvas.nodes.values()) {
      if (st.domSet.has(n)) continue;
      if (pos.x < n.x || pos.x > n.x + n.width || pos.y < n.y || pos.y > n.y + n.height) continue;
      if (n.nodeEl.classList.contains("canvas-node-group")) {
        if (!group || n.zIndex > group.zIndex) group = n;
      } else if (!card || n.zIndex > card.zIndex) card = n;
    }
    return card || group;
  }

  function bindFarInteraction(canvas) {
    const wrap = canvas.wrapperEl;
    wrap.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.pointerType === "touch" || e.target !== wrap) return;
      const st = states.get(canvas);
      if (!st || !st.on) return;
      const hit = farHit(canvas, canvas.posFromEvt(e), st);
      if (!hit) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (e.shiftKey) canvas.toggleSelect(hit);
      else if (!canvas.selection.has(hit)) canvas.selectOnly(hit);
      if (canvas.readonly) return;
      const origin = [...canvas.selection].filter((n) => typeof n.moveTo === "function").map((n) => ({ n, x: n.x, y: n.y }));
      const sx = e.clientX, sy = e.clientY;
      let moved = false;
      const mv = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
        moved = true;
        canvas.isDragging = true;
        const dx = (ev.clientX - sx) / canvas.scale, dy = (ev.clientY - sy) / canvas.scale;
        for (const o of origin) o.n.moveTo({ x: o.x + dx, y: o.y + dy });
      };
      const up = () => {
        window.removeEventListener("pointermove", mv);
        canvas.isDragging = false;
        if (moved) canvas.requestSave();
      };
      window.addEventListener("pointermove", mv);
      window.addEventListener("pointerup", up, { once: true });
    }, true);

    wrap.addEventListener("dblclick", (e) => {
      const st = states.get(canvas);
      if (!st || !st.on || e.target !== wrap) return;
      const hit = farHit(canvas, canvas.posFromEvt(e), st);
      if (!hit) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      canvas.selectOnly(hit);
      canvas.zoomToBbox(hit.getBBox());
    }, true);
  }

  // Which cards get real DOM this frame: everything big enough while the count fits the budget,
  // otherwise the biggest / most central ones. The engine paints the rest.
  function needsPick(st) {
    const a = st.pickedAt, v = st.view;
    if (st.needPick || !a) return true;
    if (Math.abs(v.scale / a.scale - 1) > 0.02 || v.vw !== a.vw) return true;
    return Math.hypot(v.cx - a.cx, v.cy - a.cy) * v.scale > v.vw * 0.08;
  }

  function pickDom(canvas, st) {
    const v = st.view;
    if (!v) return;
    const o = opts(canvas);
    const sc = v.scale, hw = v.vw / 2 / sc, hh = v.vh / 2 / sc;
    const mx = Math.max(60, hw * 0.1), my = Math.max(60, hh * 0.1);
    const cand = [];
    const nodes = st.nodes;
    // below Basalt's own zoom breakpoint it unmounts card content (placeholders), so DOM has nothing to show
    const contentZoom = canvas.zoom > canvas.zoomBreakpoint;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const w = n.width * sc;
      if ((!contentZoom || w < o.minPx) && !(n.file && n.file.extension === "canvas" && w >= 60)) continue; /* a card with a canvas in it keeps its live view at any zoom */
      if (n.x + n.width < v.cx - hw - mx || n.x > v.cx + hw + mx || n.y + n.height < v.cy - hh - my || n.y > v.cy + hh + my) continue;
      const dx = n.x + n.width / 2 - v.cx, dy = n.y + n.height / 2 - v.cy;
      cand.push([i, w, dx * dx + dy * dy]);
    }
    let pick = cand;
    const budget = o.auto ? (st.autoBudget === undefined ? Math.min(Math.max(100, o.autoMin), o.autoMax) : st.autoBudget) : o.budget;
    st.effBudget = budget;
    if (cand.length > budget) {
      cand.sort((a, b) => b[1] - a[1] || a[2] - b[2]);
      pick = cand.slice(0, Math.max(0, budget));
    }
    // a selected card is always real DOM: its resize handles and menu live there, whatever the zoom
    for (const sn of canvas.selection) { const i = st.idx.get(sn); if (i !== undefined && !pick.some((p) => p[0] === i)) pick.push([i, sn.width * sc, 0]); }
    st.domSet = new Set(pick.map(([i]) => nodes[i]));
    st.domPick = pick.map(([i]) => i);
    st.pickVersion = (st.pickVersion || 0) + 1;
    st.readyKey = null;
    pushDomFlags(st);
  }

  // A card is only skipped by the engine once its DOM is attached and has rendered content,
  // otherwise it would flash empty while Basalt is still rendering it.
  const readyNodes = new WeakSet();
  const isReady = (n) => {
    if (!n.isAttached || !n.nodeEl.isConnected) { readyNodes.delete(n); return false; }
    if (readyNodes.has(n)) return true;
    const el = n.nodeEl;
    const ok = el.textContent.trim().length > 0 || !!el.querySelector("img,svg,canvas,iframe,video,audio");
    if (ok) readyNodes.add(n);
    return ok;
  };

  function pushDomFlags(st) {
    const idx = [];
    for (const i of st.domPick) if (isReady(st.nodes[i])) idx.push(i);
    const key = st.pickVersion + ":" + idx.length;
    if (key === st.readyKey) return false;
    st.readyKey = key;
    const p = ex.ce_input(Math.max(idx.length, 1));
    const u = new Uint32Array(ex.memory.buffer, p, Math.max(idx.length, 1));
    idx.forEach((i, k) => { u[k] = i; });
    ex.ce_set_dom(idx.length);
    st.unready = st.domPick.length - idx.length;
    return true;
  }

  function setEnabled(canvas, st, on) {
    if (st.on === on) return;
    st.on = on;
    const wrap = canvas.wrapperEl;
    wrap.classList.toggle("fp-on", on);
    st.el.style.display = on ? "" : "none";
    if (!on) {
      wrap.querySelectorAll(".fp-far").forEach((e) => e.classList.remove("fp-far"));
      canvas.canvasEl.style.visibility = "";
    }
    canvas.viewportChanged = true;
    canvas.requestFrame();
  }

  function sync(canvas, st) {
    st.sigVer = (st.sigVer || 0) + 1;
    const hid = hiddenOf(canvas);
    const nodes = Array.from(canvas.nodes.values()).filter((n) => !hid.has(n.id)).sort((a, b) => a.zIndex - b.zIndex);
    const idx = new Map();
    nodes.forEach((n, i) => idx.set(n, i));
    const sel = canvas.selection;

    const nw = Math.max(nodes.length * STRIDE, 1);
    let p = ex.ce_input(nw);
    let f = new Float32Array(ex.memory.buffer, p, nw);
    let u = new Uint32Array(ex.memory.buffer, p, nw);
    st.sig.clear();
    nodes.forEach((n, i) => {
      st.sig.set(n, sigOf(n));
      const o = i * STRIDE;
      f[o] = n.x; f[o + 1] = n.y; f[o + 2] = n.width; f[o + 3] = n.height;
      u[o + 4] = colorCode(n.color);
      u[o + 5] = n.nodeEl.classList.contains("canvas-node-group") ? 3 : 0;
      u[o + 6] = sel.has(n) ? 1 : 0;
      u[o + 7] = u[o + 5] === 3 ? 0 : nodeShape(n);
    });
    ex.ce_set_nodes(nodes.length * STRIDE);

    const edges = Array.from(canvas.edges.values()).filter((e) => idx.has(e.from.node) && idx.has(e.to.node));
    const ew = Math.max(edges.length * STRIDE, 1);
    p = ex.ce_input(ew);
    u = new Uint32Array(ex.memory.buffer, p, ew);
    edges.forEach((e, i) => {
      const o = i * STRIDE;
      u[o] = idx.get(e.from.node);
      u[o + 1] = idx.get(e.to.node);
      u[o + 2] = SIDE[e.from.side] ?? 4;
      u[o + 3] = SIDE[e.to.side] ?? 4;
      u[o + 4] = colorCode(e.color);
      u[o + 5] = endIdx(e.from.end); u[o + 6] = endIdx(e.to.end); u[o + 7] = lineIdx(e) | (canvas.selection.has(e) ? 256 : 0);
    });
    ex.ce_set_edges(edges.length * STRIDE);
    pushPolys(edges);

    ex.ce_set_dark(document.body.classList.contains("theme-dark") ? 1 : 0);
    st.needPick = true;
    st.accent = accentOf(canvas.wrapperEl);
    st.nodes = nodes;
    st.idx = idx;
  }

  let gridCache = null;
  const rgba = (b, i) => `rgba(${b[i] | 0},${b[i + 1] | 0},${b[i + 2] | 0},${b[i + 3]})`;

  function replay(ctx, b, dpr, vw, vh) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    let i = 0;
    for (;;) {
      const op = b[i++];
      if (op === 0) break;
      if (op === 1) {
        ctx.fillStyle = rgba(b, i); i += 4;
        const ns = b[i++];
        ctx.beginPath();
        for (let s = 0; s < ns; s++) {
          const n = b[i++];
          if (n === 4 && b[i + 1] === b[i + 3] && b[i + 2] === b[i + 4] && b[i] === b[i + 6]) {
            ctx.rect(b[i], b[i + 1], b[i + 2] - b[i], b[i + 5] - b[i + 1]);
            i += 8;
            continue;
          }
          ctx.moveTo(b[i], b[i + 1]); i += 2;
          for (let k = 1; k < n; k++, i += 2) ctx.lineTo(b[i], b[i + 1]);
        }
        ctx.fill("nonzero");
      } else if (op === 2) {
        ctx.strokeStyle = rgba(b, i); i += 4;
        ctx.lineWidth = b[i++];
        ctx.lineJoin = "round"; ctx.lineCap = "round";
        const lines = b[i++];
        ctx.beginPath();
        for (let l = 0; l < lines; l++) {
          const n = b[i++];
          ctx.moveTo(b[i], b[i + 1]); i += 2;
          for (let k = 1; k < n; k++, i += 2) ctx.lineTo(b[i], b[i + 1]);
        }
        ctx.stroke();
      } else if (op === 3) {
        ctx.fillStyle = rgba(b, i); i += 4;
        const r = b[i++], n = b[i++];
        ctx.beginPath();
        if (r < 1.6) {
          const d = r * 2;
          for (let k = 0; k < n; k++, i += 2) ctx.rect(b[i] - r, b[i + 1] - r, d, d);
        } else {
          for (let k = 0; k < n; k++, i += 2) { ctx.moveTo(b[i] + r, b[i + 1]); ctx.arc(b[i], b[i + 1], r, 0, 6.283185307); }
        }
        ctx.fill();
      } else if (op === 6) {
        const r = b[i + 4], step = b[i + 5], ox = b[i + 6], oy = b[i + 7];
        const color = rgba(b, i); i += 8;
        const T = 32, k = step / T;
        const key = color + "|" + (r / k).toFixed(3);
        if (!gridCache || gridCache.key !== key) {
          const tile = document.createElement("canvas");
          tile.width = tile.height = T;
          const t = tile.getContext("2d");
          t.fillStyle = color;
          t.beginPath(); t.arc(T / 2, T / 2, r / k, 0, 6.283185307); t.fill();
          gridCache = { key, pat: ctx.createPattern(tile, "repeat") };
        }
        gridCache.pat.setTransform(new DOMMatrix([k, 0, 0, k, ox - (T / 2) * k, oy - (T / 2) * k]));
        ctx.fillStyle = gridCache.pat;
        ctx.fillRect(0, 0, vw, vh);
      } else if (op === 4) {
        ctx.save(); ctx.beginPath();
        ctx.rect(b[i], b[i + 1], b[i + 2] - b[i], b[i + 3] - b[i + 1]); i += 4;
        ctx.clip();
      } else if (op === 5) {
        ctx.restore();
      } else break;
    }
  }

  // ---- a canvas inside a canvas: drawn whole (cards with their text, groups, links), not as the stock outline
  const nestedCache = new Map();
  function wrapLines(ctx, text, maxW, maxLines) {
    const out = [];
    for (const para of String(text).split("\n")) {
      let line = "";
      for (const w of para.split(/\s+/)) { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; if (out.length >= maxLines) return out; }
      out.push(line); if (out.length >= maxLines) return out;
    }
    return out;
  }
  // a card's text laid out like the real card: headings, lists, quotes, code, bold stripped of its marks; wrapped to the width
  function layoutMd(ctx, text, maxW, fs, font, maxH) {
    const out = []; let y = 0, inCode = false;
    for (let raw of String(text).split("\n")) {
      if (/^```/.test(raw)) { inCode = !inCode; continue; }
      let size = fs, weight = 400, indent = 0, mute = false, prefix = "";
      let m;
      if (!inCode) {
        if ((m = /^(#{1,6})\s+(.*)$/.exec(raw))) { size = fs * [1.7, 1.45, 1.25, 1.12, 1.05, 1][m[1].length - 1]; weight = 700; raw = m[2]; }
        else if ((m = /^(\s*)([-*+]|\d+[.)])\s+(?:\[( |x|X)\]\s+)?(.*)$/.exec(raw))) { indent = Math.min(3, Math.floor(m[1].length / 2)) * fs * 1.2 + fs * 1.1; prefix = m[3] ? (m[3] === " " ? "☐ " : "☑ ") : (/\d/.test(m[2]) ? m[2] + " " : "• "); raw = m[4]; }
        else if ((m = /^>\s?(.*)$/.exec(raw))) { mute = true; indent = fs * 0.8; raw = m[1]; }
      }
      const clean = inCode ? raw : raw.replace(/!\[\[([^\]|]*)(?:\|[^\]]*)?\]\]/g, "▣ $1").replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/(\*\*|__|~~|==|`)/g, "").replace(/(^|\s)[*_]([^*_]+)[*_]/g, "$1$2");
      if (!clean.trim()) { y += fs * 0.55; if (y > maxH) break; continue; }
      ctx.font = `${weight} ${size}px ${inCode ? "ui-monospace, monospace" : font}`;
      const lines = []; let line = "";
      for (const w of clean.split(/\s+/)) { const t = line ? line + " " + w : w; if (ctx.measureText((lines.length ? "" : prefix) + t).width > maxW - indent && line) { lines.push(line); line = w; } else line = t; }
      lines.push(line);
      for (let i = 0; i < lines.length; i++) { if (y + size * 1.3 > maxH) return out; out.push({ t: (i === 0 ? prefix : "") + lines[i], x: indent, y, size, weight, mute, mono: inCode }); y += size * 1.3; }
      y += size * 0.25;
    }
    return out;
  }
  async function renderNested(f, tier) {
    let d; try { d = JSON.parse(await app.vault.cachedRead(f)); } catch (e) { return null; }
    const nodes = (d.nodes || []).filter((n) => n && typeof n.x === "number"), edges = d.edges || [];
    // the drawing of the board (fpInk) is part of what the preview shows
    const ink = Array.isArray(d.fpInk) && window.__bsInk ? d.fpInk : [];
    if (!nodes.length && !ink.length) return null;
    let x0 = 1e12, y0 = 1e12, x1 = -1e12, y1 = -1e12;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.width); y1 = Math.max(y1, n.y + n.height); }
    for (const sk of ink) { const b = window.__bsInk.box(sk); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
    const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0), pad = Math.max(bw, bh) * 0.02;
    const k = Math.min(tier / (bw + pad * 2), tier / (bh + pad * 2));
    const W = Math.ceil((bw + pad * 2) * k), H = Math.ceil((bh + pad * 2) * k);
    const cv = new OffscreenCanvas(W, H), ctx = cv.getContext("2d");
    const X = (x) => (x - x0 + pad) * k, Y = (y) => (y - y0 + pad) * k, dark = document.body.classList.contains("theme-dark");
    const rgb = (c) => rgbOfColor(c);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const fs = Math.max(7, 15 * k), font = getComputedStyle(document.body).getPropertyValue("--font-interface").trim() || "system-ui, sans-serif";
    // groups
    for (const n of nodes) {
      if (n.type !== "group") continue;
      const c = rgb(n.color);
      ctx.strokeStyle = c ? `rgba(${c},.8)` : (dark ? "rgba(200,180,160,.5)" : "rgba(60,40,20,.5)"); ctx.fillStyle = c ? `rgba(${c},.10)` : "rgba(127,127,127,.06)"; ctx.lineWidth = Math.max(1.5, 2 * k);
      ctx.fillRect(X(n.x), Y(n.y), n.width * k, n.height * k); ctx.strokeRect(X(n.x), Y(n.y), n.width * k, n.height * k);
      if (n.label) { ctx.fillStyle = dark ? "#e8dccf" : "#2a211a"; ctx.font = `600 ${fs * 1.1}px ${font}`; ctx.textBaseline = "top"; ctx.fillText(n.label, X(n.x) + 6 * k, Y(n.y) + 4 * k, n.width * k - 12 * k); }
    }
    // links
    const anchor = (n, side) => (side === "top" ? [n.x + n.width / 2, n.y] : side === "bottom" ? [n.x + n.width / 2, n.y + n.height] : side === "left" ? [n.x, n.y + n.height / 2] : [n.x + n.width, n.y + n.height / 2]);
    ctx.lineWidth = Math.max(1.2, 2.2 * k); ctx.lineCap = "round";
    for (const e of edges) {
      const a = byId.get(e.fromNode), b = byId.get(e.toNode); if (!a || !b) continue;
      const p = anchor(a, e.fromSide || "right"), q = anchor(b, e.toSide || "left"), c = rgb(e.color);
      ctx.strokeStyle = c ? `rgba(${c},.9)` : (dark ? "rgba(225,205,185,.7)" : "rgba(60,40,20,.7)");
      const dx = Math.max(40, Math.abs(q[0] - p[0]) / 2), dy = Math.max(40, Math.abs(q[1] - p[1]) / 2);
      const o = { right: [dx, 0], left: [-dx, 0], top: [0, -dy], bottom: [0, dy] }, s1 = o[e.fromSide || "right"], s2 = o[e.toSide || "left"];
      ctx.beginPath(); ctx.moveTo(X(p[0]), Y(p[1])); ctx.bezierCurveTo(X(p[0] + s1[0]), Y(p[1] + s1[1]), X(q[0] + s2[0]), Y(q[1] + s2[1]), X(q[0]), Y(q[1])); ctx.stroke();
      // arrow heads: the end of a link points by default, the start only when asked
      const head = (tx, ty, fx, fy) => { const ang = Math.atan2(ty - fy, tx - fx), hl = Math.max(8, 14 * k); ctx.beginPath(); ctx.moveTo(X(tx), Y(ty)); ctx.lineTo(X(tx) - hl * Math.cos(ang - 0.45), Y(ty) - hl * Math.sin(ang - 0.45)); ctx.lineTo(X(tx) - hl * Math.cos(ang + 0.45), Y(ty) - hl * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); };
      if (e.toEnd !== "none") head(q[0], q[1], q[0] + s2[0], q[1] + s2[1]);
      if (e.fromEnd === "arrow") head(p[0], p[1], p[0] + s1[0], p[1] + s1[1]);
      if (e.label) {
        const mx = X((p[0] + q[0]) / 2), my = Y((p[1] + q[1]) / 2); ctx.font = `500 ${fs}px ${font}`; const w = ctx.measureText(e.label).width + 8;
        ctx.fillStyle = dark ? "rgba(24,18,14,.9)" : "rgba(250,247,242,.92)"; ctx.fillRect(mx - w / 2, my - fs * 0.8, w, fs * 1.6);
        ctx.fillStyle = dark ? "#e8dccf" : "#2a211a"; ctx.textBaseline = "middle"; ctx.textAlign = "center"; ctx.fillText(e.label, mx, my, w); ctx.textAlign = "start";
      }
    }
    // the notes shown in file cards: their text, read once
    const noteText = new Map();
    await Promise.all(nodes.filter((n) => n.type === "file" && /\.md$/i.test(n.file || "")).slice(0, 80).map(async (n) => { const nf = app.vault.getAbstractFileByPath(n.file); if (nf && nf.extension === "md") { try { noteText.set(n.id, (await app.vault.cachedRead(nf)).replace(/^---\n[\s\S]*?\n---\n?/, "")); } catch (e) { /* skipped */ } } }));
    // cards (pictures first, loaded in small copies)
    const pics = new Map();
    await Promise.all(nodes.filter((n) => n.type === "file" && IMG_EXT.test((n.file || "").split(".").pop())).slice(0, 40).map(async (n) => {
      const pf = app.vault.getAbstractFileByPath(n.file); if (!pf) return;
      try { pics.set(n.id, await createImageBitmap(await (await fetch(app.vault.getResourcePath(pf))).blob(), { resizeWidth: Math.min(1024, Math.max(128, Math.ceil(n.width * k))) })); } catch (e) { /* skipped */ }
    }));
    for (const n of nodes) {
      if (n.type === "group") continue;
      const nx = X(n.x), ny = Y(n.y), nw = n.width * k, nh = n.height * k, c = rgb(n.color), im = pics.get(n.id);
      if (im) { const ir = im.width / im.height, cr = nw / nh; let dw = nw, dh = nh; if (ir > cr) dh = nw / ir; else dw = nh * ir; ctx.drawImage(im, nx + (nw - dw) / 2, ny + (nh - dh) / 2, dw, dh); continue; }
      // the card as on the board: its colour, the title of a note, and the text laid out as it is written
      const rad = Math.max(2, 6 * k);
      ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(nx, ny, nw, nh, rad); else ctx.rect(nx, ny, nw, nh);
      ctx.fillStyle = c ? `rgba(${c},.22)` : (dark ? "rgba(36,29,24,.98)" : "rgba(250,246,240,.98)"); ctx.fill();
      ctx.strokeStyle = c ? `rgba(${c},.95)` : (dark ? "rgba(120,96,76,.9)" : "rgba(150,120,90,.9)"); ctx.lineWidth = Math.max(1, 1.6 * k); ctx.stroke();
      const body = n.type === "text" ? n.text : n.type === "file" ? (noteText.get(n.id) || "") : n.type === "link" ? n.url : "";
      const title = n.type === "file" ? (n.file || "").replace(/^.*\//, "").replace(/\.(md|canvas)$/i, "") : "";
      if (!body && !title) continue;
      ctx.save(); ctx.beginPath(); ctx.rect(nx + 1, ny + 1, nw - 2, nh - 2); ctx.clip();
      const pad2 = 14 * k, fs2 = Math.max(6, 16 * k), ink2 = dark ? "#e8dccf" : "#2a211a", mute2 = dark ? "rgba(232,220,207,.62)" : "rgba(42,33,26,.62)";
      let ty = ny + pad2;
      if (title) { ctx.font = `700 ${fs2 * 1.35}px ${font}`; ctx.fillStyle = ink2; ctx.textBaseline = "top"; ctx.fillText(title, nx + pad2, ty, nw - pad2 * 2); ty += fs2 * 1.35 * 1.5; }
      const lay = layoutMd(ctx, body, nw - pad2 * 2, fs2, font, ny + nh - pad2 - ty);
      ctx.textBaseline = "top";
      for (const l of lay) { ctx.font = `${l.weight} ${l.size}px ${l.mono ? "ui-monospace, monospace" : font}`; ctx.fillStyle = l.mute ? mute2 : ink2; ctx.fillText(l.t, nx + pad2 + l.x, ty + l.y, nw - pad2 * 2 - l.x); }
      ctx.restore();
    }
    if (ink.length) { ctx.save(); ctx.setTransform(k, 0, 0, k, (pad - x0) * k, (pad - y0) * k); for (const sk of ink) { try { window.__bsInk.paint(ctx, sk); } catch (e) { /* a broken stroke is skipped */ } } ctx.restore(); }
    return { bmp: cv.transferToImageBitmap(), ratio: W / H };
  }
  // sharp for the size it has on screen: 512 .. 4096 px on the long side, re-drawn bigger when the card grows
  window.__fpRenderNested = renderNested;
  function nestedOf(f, screenPx) {
    const need = (screenPx || 600) * (window.devicePixelRatio || 1), tier = need > 2048 ? 4096 : need > 1024 ? 2048 : need > 512 ? 1024 : 512;
    let c = nestedCache.get(f.path); const mt = f.stat && f.stat.mtime;
    if (c && (c.pending || (c.mtime === mt && (c.tier || 0) >= tier))) return c.bmp ? c : null;
    if (!c) { c = { bmp: null, mtime: mt, pending: false, tier: 0 }; nestedCache.set(f.path, c); }
    c.pending = true;
    renderNested(f, tier).then((r) => { const old = c.bmp; c.bmp = r && r.bmp; c.ratio = r && r.ratio; c.mtime = mt; c.tier = tier; c.ver = (c.ver || 0) + 1; if (!old) c.t0 = performance.now(); try { old && old.close(); } catch (e) { /* ok */ } }).catch(() => {}).finally(() => { c.pending = false; for (const cv of liveCanvases) { const st = states.get(cv); if (st) { st.dirty = true; cv.requestFrame && cv.requestFrame(); } } });
    return c.bmp ? c : null;
  }
  // in DOM mode the picture replaces the stock outline inside the card
  // A card that holds another canvas shows that canvas LIVE: a real read-only canvas view lives inside the card, so what is in it looks exactly
  // like on its own board (text, notes, pictures, links, colours, the drawing). Nested inside nested, or past a handful of them, falls back to the picture.
  const lives = new Set();
  const MAX_LIVE = 6;
  // The application's own canvas view as a picture (graph card, version history): a leaf that belongs to no tab, read-only, optionally showing the given JSON text instead of the file's own
  async function mountPreview(file, host, json) {
    const ref = app.workspace.getMostRecentLeaf() || app.workspace.activeLeaf; const Leaf = ref.constructor;
    const leaf = new Leaf(app); leaf.__bsLive = true; const P = { leaf, box: null, ro: null, dead: false };
    P.destroy = () => { P.dead = true; try { P.ro && P.ro.disconnect(); } catch (e) { /* gone */ } try { leaf.detach(); } catch (e) { /* not attached */ } try { leaf.view && leaf.view.onunload && leaf.view.onunload(); } catch (e) { /* gone */ } try { P.box && P.box.remove(); } catch (e) { /* gone */ } };
    try {
      await leaf.openFile(file, { active: false });
      const v = leaf.view, c2 = v && v.canvas; if (P.dead || !c2 || !host.isConnected) { P.destroy(); return null; }
      c2.__bsLiveDepth = 1; c2.__bsPreview = true;
      // nothing a preview does may reach the file
      const none = () => {}; try { v.requestSave = none; v.save = async () => {}; c2.requestSave = none; } catch (e) { /* ok */ }
      try { c2.setReadonly && c2.setReadonly(true); } catch (e) { /* ok */ }
      if (json != null) { try { v.setViewData(json, true); } catch (e) { console.error("[fp] preview data", e); } try { v.requestSave = none; c2.requestSave = none; } catch (e) { /* ok */ } }
      P.box = document.createElement("div"); P.box.className = "bs-live bs-preview"; host.appendChild(P.box); P.box.appendChild(v.containerEl);
      const fit = () => { try { if (c2.wrapperEl && c2.wrapperEl.clientWidth > 4) c2.zoomToFit && c2.zoomToFit(); } catch (e) { /* ok */ } };
      P.ro = new ResizeObserver(() => { clearTimeout(P.t); P.t = setTimeout(fit, 120); }); P.ro.observe(P.box);
      setTimeout(fit, 150); setTimeout(fit, 700);
      return P;
    } catch (e) { console.error("[fp] preview", e); P.destroy(); return null; }
  }
  window.__fpMountPreview = mountPreview;

  function destroyLive(n) {
    const L = n.__bsLive; if (!L) return; n.__bsLive = null; lives.delete(L);
    try { L.ro && L.ro.disconnect(); clearInterval(L.sigT); } catch (e) { /* gone */ }
    try { L.leaf.detach(); } catch (e) { /* not attached */ }
    try { L.leaf.view && L.leaf.view.onunload && L.leaf.view.onunload(); } catch (e) { /* gone */ }
    try { L.box.remove(); } catch (e) { /* gone */ }
    try { L.host.classList.remove("bs-live-on"); } catch (e) { /* gone */ }
  }
  // a closed board takes its cards out of the page: the views that lived in them are released a moment later
  setInterval(() => { for (const L of Array.from(lives)) if (!L.host.isConnected || !L.n.nodeEl || !L.n.nodeEl.isConnected) destroyLive(L.n); }, 3000);
  async function mountLive(canvas, n, host) {
    const L = { leaf: null, box: null, host, ro: null, dead: false, n }; n.__bsLive = L; lives.add(L);
    try {
      const ref = app.workspace.getMostRecentLeaf() || app.workspace.activeLeaf; const Leaf = ref.constructor; // a leaf that belongs to no tab: it only holds the view
      L.leaf = new Leaf(app); L.leaf.__bsLive = true;
      // a leaf that only holds a card's picture must never become the active one (keys, "open file", undo would land in it)
      if (!app.workspace.__bsLiveGuard) { app.workspace.__bsLiveGuard = true; const sal = app.workspace.setActiveLeaf; app.workspace.setActiveLeaf = function (leaf, ...rest) { if (leaf && leaf.__bsLive) return; return sal.call(this, leaf, ...rest); }; }
      await L.leaf.openFile(n.file, { active: false });
      if (n.__bsLive !== L || !n.nodeEl || !n.nodeEl.isConnected) { destroyLive(n); return; }
      const v = L.leaf.view, c2 = v && v.canvas; if (!c2) { destroyLive(n); return; }
      c2.__bsLiveDepth = (canvas.__bsLiveDepth || 0) + 1;
      L.box = document.createElement("div"); L.box.className = "bs-live"; host.appendChild(L.box); L.box.appendChild(v.containerEl);
      host.classList.add("bs-live-on");
      try { c2.setReadonly && c2.setReadonly(true); } catch (e) { /* ok */ }
      // the view shows the cards AND the drawing of the board (the drawing may reach past the cards)
      const fit = () => {
        try {
          if (!c2.wrapperEl || c2.wrapperEl.clientWidth <= 4) return;
          let x0 = 1e12, y0 = 1e12, x1 = -1e12, y1 = -1e12;
          for (const nn of c2.nodes.values()) { x0 = Math.min(x0, nn.x); y0 = Math.min(y0, nn.y); x1 = Math.max(x1, nn.x + nn.width); y1 = Math.max(y1, nn.y + nn.height); }
          const inkS = window.__bsInk && window.__bsInk.state(c2);
          if (inkS) for (const sk of inkS.strokes) { const b = window.__bsInk.box(sk); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
          if (x0 > x1) { c2.zoomToFit && c2.zoomToFit(); return; }
          const pd = Math.max(20, Math.max(x1 - x0, y1 - y0) * 0.03);
          c2.zoomToBbox({ minX: x0 - pd, minY: y0 - pd, maxX: x1 + pd, maxY: y1 + pd });
        } catch (e) { /* ok */ }
      };
      // refit when the contents change (a card added, a stroke drawn in that board)
      let lastSig = "";
      L.sigT = setInterval(() => { const inkS = window.__bsInk && window.__bsInk.state(c2); const sg = c2.nodes.size + ":" + (inkS ? inkS.strokes.length + ":" + inkS.ver : "0"); if (sg !== lastSig) { lastSig = sg; fit(); } }, 800);
      L.ro = new ResizeObserver(() => { clearTimeout(L.fitT); L.fitT = setTimeout(fit, 120); }); L.ro.observe(L.box);
      setTimeout(fit, 250); setTimeout(fit, 900);
      L.view = v; L.fit = fit;
    } catch (e) { console.error("[fp] live canvas", e); destroyLive(n); n.__bsLiveFailed = true; }
  }
  function liveNested(canvas, st) {
    for (const L of Array.from(lives)) { /* cards that went away */ }
    for (const n of st.domSet) {
      if (!n.file || n.file.extension !== "canvas" || !n.nodeEl) continue;
      const host = n.nodeEl.querySelector(".canvas-node-content.canvas-embed"); if (!host) continue;
      if (n.__bsLive) continue;
      if (n.__bsLiveFailed || (canvas.__bsLiveDepth || 0) >= 1 || lives.size >= MAX_LIVE) continue;
      if (canvas.view && canvas.view.file && canvas.view.file.path === n.file.path) continue;
      if (n.width * st.view.scale < 60) continue;
      mountLive(canvas, n, host);
    }
    // a live view is dropped once its card is gone or no longer on the page
    for (const nn of canvas.nodes.values()) if (nn.__bsLive && (!nn.nodeEl || !nn.nodeEl.isConnected || !canvas.nodes.has(nn.id))) destroyLive(nn);
  }
  function nestedDom(canvas, st) {
    liveNested(canvas, st);
    for (const n of st.domSet) {
      if (!n.file || n.file.extension !== "canvas" || !n.nodeEl) continue;
      if (n.__bsLive) continue;
      const host = n.nodeEl.querySelector(".canvas-node-content.canvas-embed"); if (!host) continue;
      const c = nestedOf(n.file, n.width * st.view.scale); if (!c || !c.bmp) continue;
      let el = host.querySelector("canvas.bs-nested");
      if (!el) { el = document.createElement("canvas"); el.className = "bs-nested"; host.appendChild(el); host.classList.add("bs-has"); }
      if (el.__ver !== c.ver) { el.width = c.bmp.width; el.height = c.bmp.height; el.getContext("2d").drawImage(c.bmp, 0, 0); el.__ver = c.ver; }
    }
  }

  // ---- images on cards the engine paints: while a picture card has no real DOM (zoomed out) its thumbnail is drawn here,
  // fading in once it has loaded. Thumbnails are small bitmaps (max 1024 px wide), a few at a time, the oldest are dropped.
  const IMG_EXT = /^(png|jpe?g|gif|webp|bmp|avif|svg)$/i, thumbs = new Map();
  let thumbLoading = 0;
  const rank = (w) => (w === 0 ? 1e9 : w);
  // the picture of a card: sharp enough for the size it has on screen (512 .. 4096 px wide), or the file as it is when the card is
  // marked "always full resolution"; a better copy replaces the old one when the card gets bigger
  function thumbOf(n, screenW) {
    const f = n.file; if (!f || !IMG_EXT.test(f.extension || "")) return null;
    const need = screenW * (window.devicePixelRatio || 1), full = !!(n.unknownData && n.unknownData.fpFull);
    const tier = full ? 0 : need > 2048 ? 4096 : need > 1024 ? 2048 : need > 512 ? 1024 : 512;
    let t = thumbs.get(f.path);
    if (t) { thumbs.delete(f.path); thumbs.set(f.path, t); }
    if (t && (t.loading || rank(t.tier) >= rank(tier)) && !(t.mtime !== undefined && f.stat && t.mtime !== f.stat.mtime)) return t.bmp ? t : null;
    if (thumbLoading >= 2) return t && t.bmp ? t : null;
    if (!t) { t = { bmp: null, t0: 0, tier: -1, failed: false, mtime: f.stat && f.stat.mtime }; thumbs.set(f.path, t); }
    t.loading = true; thumbLoading++;
    fetch(app.vault.getResourcePath(f)).then((r) => r.blob()).then((b) => (tier ? createImageBitmap(b, { resizeWidth: tier, resizeQuality: "high" }).catch(() => createImageBitmap(b)) : createImageBitmap(b)))
      .then((bmp) => { const old = t.bmp; t.bmp = bmp; t.tier = tier; t.mtime = f.stat && f.stat.mtime; if (!old) t.t0 = performance.now(); try { old && old.close(); } catch (e) { /* ok */ } }).catch(() => { t.failed = true; })
      .finally(() => { t.loading = false; thumbLoading--; for (const c of liveCanvases) { const st = states.get(c); if (st) { st.dirty = true; c.requestFrame && c.requestFrame(); } } });
    while (thumbs.size > 30) { const k = thumbs.keys().next().value, old = thumbs.get(k); try { old.bmp && old.bmp.close(); } catch (e) { /* ok */ } thumbs.delete(k); }
    return t.bmp ? t : null;
  }
  const liveCanvases = new Set();
  function drawFarImages(canvas, st) {
    const v = st.view; if (!v) return;
    const sc = v.scale, ctx = st.ctx; let animating = false;
    for (const n of st.nodes) {
      if (!n.file || (!st.zooming && st.domSet.has(n) && isReady(n))) continue;
      const w = n.width * sc, h = n.height * sc;
      if (w < 14) continue;
      const x = (n.x - v.cx) * sc + v.vw / 2, y = (n.y - v.cy) * sc + v.vh / 2;
      if (x + w < 0 || y + h < 0 || x > v.vw || y > v.vh) continue;
      const t = n.file.extension === "canvas" ? nestedOf(n.file, w) : thumbOf(n, w); if (!t || !t.bmp) continue;
      const a = Math.min(1, (performance.now() - t.t0) / 380), e = 1 - Math.pow(1 - a, 3);
      if (a < 1) animating = true;
      const ir = t.bmp.width / t.bmp.height, cr = w / h; let dw = w, dh = h;
      if (ir > cr) dh = w / ir; else dw = h * ir;
      ctx.save(); ctx.globalAlpha = e; ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.drawImage(t.bmp, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); ctx.restore();
    }
    if (animating) canvas.requestFrame && canvas.requestFrame();
  }

  // ---- real text on cards the engine paints (title + first line), cheap: one fillText per line, capped per frame
  const FAR_TEXT_MAX = 200;
  const clean = (t) => t.replace(/^\s*(#{1,6}\s+|[-*+]\s+|>\s*|\d+\.\s+)/, "").replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").replace(/[*_`~]/g, "").trim();
  function textOf(n) {
    const src = typeof n.text === "string" ? n.text : n.file ? (n.file.basename || n.file.name || "") : typeof n.url === "string" ? n.url : "";
    if (n.__fpSrc === src) return n.__fpTxt;
    const lines = src.startsWith("```basalt-draw") ? [] : src.split("\n").map(clean).filter(Boolean);
    n.__fpSrc = src;
    n.__fpTxt = { a: lines[0] || "", b: lines[1] || "" };
    return n.__fpTxt;
  }
  function drawFarText(canvas, st, o) {
    const v = st.view;
    if (!o.farText || !v) return;
    const sc = v.scale, ctx = st.ctx;
    const dark = document.body.classList.contains("theme-dark");
    const font = getComputedStyle(document.body).getPropertyValue("--font-interface").trim() || "system-ui, sans-serif";
    const fs = Math.max(5.5, Math.min(14 * sc, 11));
    ctx.textBaseline = "alphabetic";
    let drawn = 0;
    for (const n of st.nodes) {
      if (drawn >= FAR_TEXT_MAX) break;
      const w = n.width * sc;
      if (w < o.farTextPx || (!st.zooming && st.domSet.has(n)) || n.nodeEl.classList.contains("canvas-node-group")) continue;
      const x = (n.x - v.cx) * sc + v.vw / 2, y = (n.y - v.cy) * sc + v.vh / 2, h = n.height * sc;
      if (x + w < 0 || y + h < 0 || x > v.vw || y > v.vh) continue;
      const t = textOf(n);
      if (!t.a) continue;
      const pad = Math.max(3, w * 0.07), room = w - pad * 2;
      ctx.fillStyle = dark ? "rgba(225,225,225,0.92)" : "rgba(30,30,30,0.9)";
      ctx.font = `600 ${fs}px ${font}`;
      ctx.fillText(t.a, x + pad, y + pad + fs, room);
      if (t.b && h > pad * 2 + fs * 3) {
        ctx.fillStyle = dark ? "rgba(200,200,200,0.7)" : "rgba(60,60,60,0.7)";
        ctx.font = `${fs * 0.88}px ${font}`;
        ctx.fillText(t.b, x + pad, y + pad + fs * 2.2, room);
      }
      drawn++;
    }
  }

  // ---- link labels while the links are painted by the engine (zoomed out): a small pill with the text at the middle of the line
  function drawFarEdgeLabels(canvas, st, o) {
    const v = st.view; if (!v || !(st.zooming || v.scale < o.edgeScale)) return;
    const ctx = st.ctx, sc = v.scale, dark = document.body.classList.contains("theme-dark");
    const font = getComputedStyle(document.body).getPropertyValue("--font-interface").trim() || "system-ui, sans-serif", fs = Math.max(7, Math.min(13 * sc, 12));
    ctx.font = `500 ${fs}px ${font}`; ctx.textBaseline = "middle"; ctx.textAlign = "center";
    let n = 0;
    for (const e of canvas.edges.values()) {
      if (!e.label || n >= 200) continue;
      const pe = e.path && e.path.display; if (!pe) continue;
      const d = pe.getAttribute("d") || ""; if (!d) continue;
      if (e.__fpMidD !== d) { try { const len = pe.getTotalLength(), p = pe.getPointAtLength(len / 2); e.__fpMid = [p.x, p.y]; e.__fpMidD = d; } catch (err) { continue; } }
      const x = (e.__fpMid[0] - v.cx) * sc + v.vw / 2, y = (e.__fpMid[1] - v.cy) * sc + v.vh / 2;
      if (x < -60 || y < -20 || x > v.vw + 60 || y > v.vh + 20) continue;
      const w = Math.min(ctx.measureText(e.label).width + 8, 220);
      ctx.fillStyle = dark ? "rgba(24,18,14,.88)" : "rgba(250,247,242,.9)"; ctx.fillRect(x - w / 2, y - fs * 0.8, w, fs * 1.6);
      ctx.fillStyle = dark ? "rgba(236,228,219,.95)" : "rgba(42,33,26,.95)"; ctx.fillText(e.label, x, y, 212); n++;
    }
    ctx.textAlign = "start";
  }

  // ---- minimap: every card as a small block, the visible part as a frame; click or drag to move the view
  const PRESET_RGB = ["126,126,126", "251,70,76", "233,151,63", "224,222,113", "68,207,110", "83,223,221", "168,130,255"];
  const rgbOfColor = (c) => {
    if (!c) return null;
    if (/^[1-6]$/.test(c)) return PRESET_RGB[+c];
    const m = /^#?([0-9a-f]{6})$/i.exec(c);
    return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)].join(",") : null;
  };
  function ensureMinimap(canvas, st) {
    if (st.mini) return st.mini;
    const box = document.createElement("div");
    box.className = "fp-minimap";
    const cv = document.createElement("canvas");
    box.appendChild(cv);
    canvas.wrapperEl.appendChild(box);
    const m = { box, cv, ctx: cv.getContext("2d"), key: "", map: null };
    for (const ev of ["mousedown", "pointerdown", "wheel", "dblclick", "click", "contextmenu"]) box.addEventListener(ev, (e) => e.stopPropagation());
    const go = (e) => {
      if (!m.map) return;
      const r = cv.getBoundingClientRect();
      const x = (e.clientX - r.left - m.map.ox) / m.map.k + m.map.x0, y = (e.clientY - r.top - m.map.oy) / m.map.k + m.map.y0;
      canvas.panTo ? canvas.panTo(x, y) : 0;
    };
    box.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      box.setPointerCapture(e.pointerId); go(e);
      const move = (ev) => go(ev), up = () => { box.removeEventListener("pointermove", move); box.removeEventListener("pointerup", up); };
      box.addEventListener("pointermove", move); box.addEventListener("pointerup", up);
    });
    st.mini = m;
    return m;
  }
  function updateMinimap(canvas, st, o) {
    const m = st.mini;
    if (!o.minimap || canvas.screenshotting) { if (m) m.box.style.display = "none"; return; }
    const v = st.view, nodes = st.nodes;
    const inkS = window.__bsInk && window.__bsInk.state(canvas), ink = inkS ? inkS.strokes : [];
    if (!v || (!nodes.length && !ink.length)) { if (m) m.box.style.display = "none"; return; }
    const mm = ensureMinimap(canvas, st);
    mm.box.style.display = "";
    const key = [nodes.length, st.sigVer || 0, Math.round(v.cx), Math.round(v.cy), v.scale.toFixed(4), v.vw, v.vh, o.minimapSize, canvas.selection.size, document.body.className, accentVer, canvas.edges.size, ink.length, inkS ? inkS.ver : 0].join("|");
    if (key === mm.key) return;
    mm.key = key;
    const W = o.minimapSize, H = Math.round(W * 0.68), dpr = window.devicePixelRatio || 1;
    if (mm.cv.width !== W * dpr) { mm.cv.width = W * dpr; mm.cv.height = H * dpr; mm.cv.style.width = W + "px"; mm.cv.style.height = H + "px"; }
    const ctx = mm.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.width); y1 = Math.max(y1, n.y + n.height); }
    for (const sk of ink) { const b = window.__bsInk.box(sk); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
    const vx0 = v.cx - v.vw / 2 / v.scale, vy0 = v.cy - v.vh / 2 / v.scale, vx1 = v.cx + v.vw / 2 / v.scale, vy1 = v.cy + v.vh / 2 / v.scale;
    x0 = Math.min(x0, vx0); y0 = Math.min(y0, vy0); x1 = Math.max(x1, vx1); y1 = Math.max(y1, vy1);
    const pad = 8, k = Math.min((W - pad * 2) / Math.max(1, x1 - x0), (H - pad * 2) / Math.max(1, y1 - y0));
    const ox = (W - (x1 - x0) * k) / 2, oy = (H - (y1 - y0) * k) / 2;
    mm.map = { x0, y0, k, ox, oy };
    const X = (x) => (x - x0) * k + ox, Y = (y) => (y - y0) * k + oy;
    const cs = getComputedStyle(canvas.wrapperEl);
    const dark = document.body.classList.contains("theme-dark");
    const accent = cs.getPropertyValue("--interactive-accent").trim() || "#b07a52";
    // links: always visible, with their labels when there is room
    if (canvas.edges.size <= 4000) {
      ctx.strokeStyle = dark ? "rgba(225,205,185,.62)" : "rgba(60,40,20,.6)"; ctx.lineWidth = 1.1; ctx.beginPath();
      for (const e of canvas.edges.values()) {
        const a = e.from && e.from.node, b = e.to && e.to.node;
        if (!a || !b) continue;
        ctx.moveTo(X(a.x + a.width / 2), Y(a.y + a.height / 2)); ctx.lineTo(X(b.x + b.width / 2), Y(b.y + b.height / 2));
      }
      ctx.stroke();
    }
    // cards
    for (const n of nodes) {
      const isGroup = n.nodeEl && n.nodeEl.classList.contains("canvas-node-group");
      const c = rgbOfColor(n.color);
      const w = Math.max(3, n.width * k), h = Math.max(3, n.height * k);
      if (isGroup) { ctx.strokeStyle = c ? `rgba(${c},.7)` : (dark ? "rgba(200,180,160,.4)" : "rgba(60,40,20,.4)"); ctx.lineWidth = 1; ctx.strokeRect(X(n.x) + .5, Y(n.y) + .5, w, h); continue; }
      ctx.fillStyle = c ? `rgba(${c},.95)` : (dark ? "rgba(196,150,108,.92)" : "rgba(107,68,41,.88)");
      ctx.fillRect(X(n.x), Y(n.y), w, h);
      ctx.strokeStyle = dark ? "rgba(20,14,10,.9)" : "rgba(255,250,240,.9)"; ctx.lineWidth = 0.8; ctx.strokeRect(X(n.x) + .4, Y(n.y) + .4, w - .8, h - .8);
      if (w > 34 && h > 12) { const t = textOf(n); if (t && t.a) { ctx.fillStyle = dark ? "rgba(20,14,10,.95)" : "rgba(255,250,240,.95)"; ctx.font = "600 7px system-ui, sans-serif"; ctx.textBaseline = "top"; ctx.fillText(t.a, X(n.x) + 2, Y(n.y) + 2, w - 4); } }
      if (canvas.selection.has(n)) { ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.strokeRect(X(n.x) - .5, Y(n.y) - .5, w + 1, h + 1); }
    }
    // what you see now
    // the drawing on top of the cards, as on the board (lines at least one pixel wide)
    if (ink.length) { ctx.save(); ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (ox - x0 * k), dpr * (oy - y0 * k)); for (const sk of ink) { try { window.__bsInk.paintMin(ctx, sk, 1.2 / k); } catch (e) { /* skipped */ } } ctx.restore(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    ctx.fillStyle = dark ? "rgba(236,228,219,.10)" : "rgba(42,33,26,.10)";
    ctx.fillRect(X(vx0), Y(vy0), (vx1 - vx0) * k, (vy1 - vy0) * k);
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
    ctx.strokeRect(X(vx0), Y(vy0), (vx1 - vx0) * k, (vy1 - vy0) * k);
  }

  function draw(canvas, st) {
    const v = st.view;
    if (!ex || !v) return;
    if (st.accentVer !== accentVer) { st.accent = accentOf(canvas.wrapperEl); st.accentVer = accentVer; }
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(v.vw * dpr)), h = Math.max(1, Math.round(v.vh * dpr));
    if (st.el.width !== w || st.el.height !== h) { st.el.width = w; st.el.height = h; }
    const t0 = performance.now();
    if (!st.zooming && needsPick(st)) {
      pickDom(canvas, st);
      st.needPick = false;
      st.pickedAt = { cx: v.cx, cy: v.cy, scale: v.scale, vw: v.vw };
    }
    ex.ce_set_text_px(opts(canvas).farText ? opts(canvas).farTextPx : 0);
    ex.ce_set_shape(opts(canvas).shape);
    ex.ce_set_grid(opts(canvas).gridStep);
    // zoomed in: the original links (arrow heads) in the DOM; zoomed out: the engine draws them (visible and cheap, the DOM paths would lag)
    const farLinks = !(canvas.zoom > canvas.zoomBreakpoint);
    if (canvas.wrapperEl.classList.contains("fp-farlinks") !== farLinks) canvas.wrapperEl.classList.toggle("fp-farlinks", farLinks);
    ex.ce_set_edges_on(farLinks && !canvas.canvasEl.classList.contains("is-connecting") ? 1 : 0);
    updateHandles(canvas);
    const ptr = ex.ce_render(v.cx, v.cy, v.scale, v.vw, v.vh, st.accent, st.zooming ? 1 : 0);
    const buf = new Float32Array(ex.memory.buffer, ptr, ex.ce_out_len());
    const t1 = performance.now();
    replay(st.ctx, buf, dpr, v.vw, v.vh);
    const t2 = performance.now();
    const oo = opts(canvas);
    ex.ce_set_text_px(oo.farText ? oo.farTextPx : 0);
    drawFarImages(canvas, st);
    nestedDom(canvas, st);
    drawFarText(canvas, st, oo);
    drawFarEdgeLabels(canvas, st, oo);
    const t3 = performance.now();
    updateMinimap(canvas, st, oo);
    window.__fpStats = { buildMs: t1 - t0, replayMs: t2 - t1, textMs: t3 - t2, floats: buf.length };

  }

  // far = too small on screen to be real DOM; derived from scale and width only, so it can never go stale
  function applyFar(canvas, st) {
    canvas.wrapperEl.classList.toggle("fp-shape", opts(canvas).shape > 0 || [...canvas.nodes.values()].some((n) => nodeShape(n) > 0));
    for (const n of canvas.lastNodesInViewport) {
      if (!n.isAttached) continue;
      const hideIt = hiddenOf(canvas).has(n.id); if (n.__fpHid !== hideIt) { n.__fpHid = hideIt; n.nodeEl.style.display = hideIt ? "none" : ""; }
      styleShape(n, nodeShape(n));
      if (n.file && n.file.extension === "canvas") mountNested(n);
      const far = !canvas.screenshotting && !st.domSet.has(n);
      if (n.nodeEl.classList.contains("fp-far") !== far) n.nodeEl.classList.toggle("fp-far", far);
    }
  }

  function endZoom(canvas, st) {
    st.zooming = false;
    canvas.canvasEl.style.visibility = "";
    canvas.viewportChanged = true;
    canvas.requestFrame();
  }

  // context-menu entry for a card (called from the patched node showMenu)
  window.__fpNodeMenu = (menu, node) => {
    const canvas = node.canvas;
    // a note or a canvas on this canvas: find it in the vault graph
    if (node.file && /^(md|canvas)$/.test(node.file.extension || "") && window.__bsGraph && window.__bsGraph.reveal) {
      menu.addItem((i) => i.setSection("canvas").setTitle("Показать в графе").setIcon("lucide-git-fork").onClick(() => window.__bsGraph.reveal(node.file.path)));
    }
    if (node.file && IMG_EXT.test(node.file.extension || "")) {
      menu.addItem((i) => i.setSection("canvas").setTitle("Просмотр…").setIcon("lucide-zoom-in").onClick(() => window.__bsViewer && window.__bsViewer.open(node.file)));
      if (canvas && !canvas.readonly && node.unknownData) {
        const full = !!node.unknownData.fpFull;
        menu.addItem((i) => i.setSection("canvas").setTitle("Всегда в максимальном разрешении").setIcon("lucide-maximize").setChecked(full).onClick(() => {
          if (full) delete node.unknownData.fpFull; else node.unknownData.fpFull = true;
          const st = states.get(canvas); if (st) { st.dirty = true; st.needPick = true; }
          canvas.requestSave && canvas.requestSave(); canvas.viewportChanged = true; canvas.requestFrame && canvas.requestFrame();
        }));
      }
    }
    if (canvas && !canvas.readonly && node.nodeEl.classList.contains("canvas-node-group") && node.unknownData) {
      menu.addItem((i) => i.setSection("canvas").setTitle(node.unknownData.fpCollapsed ? "Развернуть группу" : "Свернуть группу").setIcon(node.unknownData.fpCollapsed ? "lucide-chevrons-down" : "lucide-chevrons-up").onClick(() => toggleGroup(canvas, node)));
      return;
    }
    if (!canvas || canvas.readonly || node.nodeEl.classList.contains("canvas-node-group")) return;
    const targets = () => (canvas.selection.has(node) ? Array.from(canvas.selection) : [node]).filter((x) => x.unknownData && x.nodeEl && !x.nodeEl.classList.contains("canvas-node-group"));
    const set = (v) => {
      for (const x of targets()) {
        if (v === null) delete x.unknownData.fpShape; else x.unknownData.fpShape = v;
        x.__fpShapeKey = "";
        canvas.markDirty ? canvas.markDirty(x) : 0;
      }
      const st = states.get(canvas);
      if (st) { st.dirty = true; st.needPick = true; }
      canvas.requestSave && canvas.requestSave();
      canvas.viewportChanged = true;
      canvas.requestFrame && canvas.requestFrame();
    };
    menu.addItem((item) => {
      item.setSection("canvas").setTitle("Форма карточки").setIcon("lucide-hexagon");
      const sub = item.setSubmenu();
      const cur = Number.isInteger(node.unknownData.fpShape) ? node.unknownData.fpShape : null;
      sub.addItem((i) => i.setTitle("Как в настройках").setChecked(cur === null).onClick(() => set(null)));
      SHAPE_NAMES.forEach((name, k) => sub.addItem((i) => i.setTitle(name).setChecked(cur === k).onClick(() => set(k))));
    });
  };

  // shape picker on the card toolbar (shown for a selected card, so a new card gets it right away)
  // line style of a link: its own (kept in the canvas file as fpLine) or the default from the settings
  // links are drawn and handled by the original canvas code (curve, arrow heads, re-attaching the ends); the hand-shaped path editor is switched off
  const STOCK_LINKS = true;
  const LINE_NAMES = ["curve", "straight", "elbow", "round"];
  const LINE_LABELS = ["Кривая", "Прямая", "Ломаная", "Скруглённая ломаная"];
  const lineIdx = (edge) => {
    const own = LINE_NAMES.indexOf(edge.unknownData && edge.unknownData.fpLine);
    return own >= 0 ? own : LINE_NAMES.indexOf(opts(edge.canvas).lineStyle);
  };
  // the stock edge computes its SVG path with j5(); for the other styles the path is swapped in here (hit area, selection and export follow)
  window.__fpBezierFix = (edge, u, s, c, sideA, sideB) => {
    if (STOCK_LINKS) return;
    if (hasPts(edge)) {
      const a = [s, ...edge.unknownData.fpPts.map((q) => ({ x: q[0], y: q[1] })), c];
      if (edge.unknownData.fpSmooth) {
        const segs = smoothSegs(a);
        u.path = "M" + a[0].x + "," + a[0].y + segs.map(([, c1, c2, p1]) => ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p1.x},${p1.y}`).join("");
      } else u.path = "M" + a[0].x + "," + a[0].y + a.slice(1).map((q) => ` L${q.x},${q.y}`).join("");
      const mid = a[Math.floor(a.length / 2)], prev = a[Math.floor((a.length - 1) / 2)];
      u.cp1 = { x: (prev.x + mid.x) / 2, y: (prev.y + mid.y) / 2 }; u.cp2 = u.cp1;
      return;
    }
    const k = lineIdx(edge);
    if (!k || !ex) return;
    const A = edge.from.node, B = edge.to.node;
    const ptr = ex.ce_route(k, s.x, s.y, SIDE[sideA] ?? 1, c.x, c.y, SIDE[sideB] ?? 3, A.x, A.y, A.x + A.width, A.y + A.height, B.x, B.y, B.x + B.width, B.y + B.height), n = ex.ce_shape_len();
    const f = new Float32Array(ex.memory.buffer, ptr, n), pts = [];
    for (let i = 0; i < n; i += 2) pts.push([f[i], f[i + 1]]);
    if (pts.length < 2) return;
    u.path = "M" + pts[0][0] + "," + pts[0][1] + pts.slice(1).map((q) => " L" + q[0] + "," + q[1]).join("");
    // label anchor: control points at a third and two thirds of the way along the route
    let total = 0; const seg = [];
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); total += d; }
    const at = (want) => { let acc = 0; for (let i = 0; i < seg.length; i++) { if (acc + seg[i] >= want || i === seg.length - 1) { const t = seg[i] ? Math.min(1, (want - acc) / seg[i]) : 0; return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t }; } acc += seg[i]; } return { x: s.x, y: s.y }; };
    u.cp1 = at(total / 3); u.cp2 = at((total * 2) / 3);
  };
  const setLine = (canvas, edges, name) => {
    for (const e of edges) { if (name) e.unknownData.fpLine = name; else delete e.unknownData.fpLine; canvas.markDirty && canvas.markDirty(e); }
    const st = states.get(canvas);
    if (st) st.dirty = true;
    canvas.requestSave && canvas.requestSave();
    canvas.viewportChanged = true;
    canvas.requestFrame && canvas.requestFrame();
  };
  const lineThumb = (k) => {
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 44 24"); svg.setAttribute("width", "44"); svg.setAttribute("height", "24");
    const path = document.createElementNS(SVGNS, "path");
    path.setAttribute("d", ["M3 20 C22 20 22 4 41 4", "M3 20 L41 4", "M3 20 H22 V4 H41", "M3 20 H17 Q22 20 22 15 V9 Q22 4 27 4 H41"][k]);
    for (const [a, b] of [["fill", "none"], ["stroke", "currentColor"], ["stroke-width", 2], ["stroke-linejoin", "round"]]) path.setAttribute(a, b);
    svg.appendChild(path);
    return svg;
  };
  // ---- hand-shaped links: waypoints in the edge's own data (fpPts), straight or smoothed (fpSmooth)
  const sidePointOf = (node, side) => (side === "top" ? { x: node.x + node.width / 2, y: node.y } : side === "bottom" ? { x: node.x + node.width / 2, y: node.y + node.height } : side === "left" ? { x: node.x, y: node.y + node.height / 2 } : { x: node.x + node.width, y: node.y + node.height / 2 });
  const hasPts = (e) => !!(e.unknownData && Array.isArray(e.unknownData.fpPts) && e.unknownData.fpPts.length);
  // Catmull-Rom through the points as cubic segments: [[p0, c1, c2, p1], ...]
  function smoothSegs(pts) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      out.push([p1, { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }, { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }, p2]);
    }
    return out;
  }
  const edgeAnchors = (edge) => [sidePointOf(edge.from.node, edge.from.side), ...edge.unknownData.fpPts.map((q) => ({ x: q[0], y: q[1] })), sidePointOf(edge.to.node, edge.to.side)];
  function pushPolys(edges) {
    const list = [];
    edges.forEach((e, i) => {
      if (!hasPts(e)) return;
      const a = edgeAnchors(e);
      let poly = a;
      if (e.unknownData.fpSmooth) {
        poly = [a[0]];
        for (const [p0, c1, c2, p1] of smoothSegs(a)) for (let k = 1; k <= 10; k++) { const t = k / 10, u = 1 - t; poly.push({ x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x, y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y }); }
      }
      list.push([i, poly]);
    });
    const words = 1 + list.reduce((t, [, p]) => t + 2 + p.length * 2, 0);
    const ptr = ex.ce_input(words), f = new Float32Array(ex.memory.buffer, ptr, words);
    let k = 0; f[k++] = list.length;
    for (const [i, p] of list) { f[k++] = i; f[k++] = p.length; for (const q of p) { f[k++] = q.x; f[k++] = q.y; } }
    ex.ce_set_polys(words);
  }

  // ---- editing the path of the selected link
  //  - a dot ON the line, in the middle of every piece: drag it to pull out a new point (it starts exactly where the dot was)
  //  - press anywhere on the line itself and drag: a point is created under the cursor and follows it
  //  - the points snap to the grid and to the edges / centres of cards and other points; Shift keeps a straight run, Ctrl turns snapping off
  //  - double click or right click a point to remove it
  const lerpP = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const cubicP = (p0, c1, c2, p1, t) => { const u = 1 - t; return { x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x, y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y }; };
  // the pieces of the path as it is drawn now: straight pieces, or cubic pieces (smoothed through points, or the stock curve)
  function edgeSegments(edge) {
    const anchors = edgeAnchors({ from: edge.from, to: edge.to, unknownData: { fpPts: hasPts(edge) ? edge.unknownData.fpPts : [] } });
    if (hasPts(edge)) {
      if (edge.unknownData.fpSmooth) return smoothSegs(anchors).map(([p0, c1, c2, p1]) => ({ kind: "cubic", p0, c1, c2, p1 }));
      return anchors.slice(1).map((q, i) => ({ kind: "line", p0: anchors[i], p1: q }));
    }
    const bz = edge.bezier;
    if (bz && bz.cp1 && bz.cp2) return [{ kind: "cubic", p0: bz.from, c1: bz.cp1, c2: bz.cp2, p1: bz.to }];
    return [{ kind: "line", p0: anchors[0], p1: anchors[anchors.length - 1] }];
  }
  const segPoint = (s, t) => (s.kind === "line" ? lerpP(s.p0, s.p1, t) : cubicP(s.p0, s.c1, s.c2, s.p1, t));
  // the point of the path closest to `w`: { seg, t, p }
  function nearestOnPath(segs, w) {
    let best = null;
    segs.forEach((s, si) => { for (let k = 0; k <= 28; k++) { const t = k / 28, p = segPoint(s, t), d = (p.x - w.x) ** 2 + (p.y - w.y) ** 2; if (!best || d < best.d) best = { seg: si, t, p, d }; } });
    return best;
  }
  // a dragged point is pulled to the grid and to other things; returns the position and the guide lines to show
  function snapPoint(canvas, edge, idx, w, ev, anchors) {
    let x = w.x, y = w.y; const guides = [];
    if (ev.ctrlKey || ev.metaKey) return { x: Math.round(x), y: Math.round(y), guides };
    const prev = anchors[idx]; // the anchor before the point (anchors[0] is the start of the link)
    if (ev.shiftKey && prev) {
      const dx = Math.abs(x - prev.x), dy = Math.abs(y - prev.y);
      if (dx > dy * 2) y = prev.y; else if (dy > dx * 2) x = prev.x; else { const d = (dx + dy) / 2; x = prev.x + Math.sign(x - prev.x || 1) * d; y = prev.y + Math.sign(y - prev.y || 1) * d; }
    }
    const opt = canvas.options || {}, thr = canvas.snapDistance || 8;
    let sx = null, sy = null;
    if (!ev.shiftKey && opt.snapToObjects !== false) {
      const tx = [], ty = [];
      for (const n of canvas.nodes.values()) { if (!n.nodeEl || n.nodeEl.classList.contains("canvas-node-group")) continue; tx.push(n.x, n.x + n.width / 2, n.x + n.width); ty.push(n.y, n.y + n.height / 2, n.y + n.height); }
      anchors.forEach((q, i) => { if (i !== idx + 1) { tx.push(q.x); ty.push(q.y); } });
      for (const t of tx) if (Math.abs(t - x) <= thr && (sx === null || Math.abs(t - x) < Math.abs(sx - x))) sx = t;
      for (const t of ty) if (Math.abs(t - y) <= thr && (sy === null || Math.abs(t - y) < Math.abs(sy - y))) sy = t;
      if (sx !== null) { x = sx; guides.push({ v: true, at: sx }); }
      if (sy !== null) { y = sy; guides.push({ v: false, at: sy }); }
    }
    if (opt.snapToGrid && !ev.shiftKey) { const g = canvas.gridSpacing || 20; if (sx === null) x = Math.round(x / g) * g; if (sy === null) y = Math.round(y / g) * g; }
    return { x: Math.round(x), y: Math.round(y), guides };
  }

  function handleSvg(canvas) {
    let h = canvas.__fpHandles;
    if (!h) {
      const mkSvg = (z) => { const svg = document.createElementNS(SVGNS, "svg"); svg.style.cssText = "position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:" + z; canvas.canvasEl.appendChild(svg); return svg; };
      const svg = mkSvg(60); svg.setAttribute("class", "fp-handles");
      const gsvg = mkSvg(59); gsvg.setAttribute("class", "fp-handles");
      h = canvas.__fpHandles = { svg, gsvg, key: "" };
    }
    return h;
  }
  const commitEdge = (canvas, edge) => { canvas.markDirty && canvas.markDirty(edge); const st = states.get(canvas); if (st) st.dirty = true; canvas.requestFrame && canvas.requestFrame(); };
  const anchorsOf = (edge) => edgeAnchors({ from: edge.from, to: edge.to, unknownData: { fpPts: hasPts(edge) ? edge.unknownData.fpPts : [] } });
  function finishEdit(canvas) { canvas.requestSave && canvas.requestSave(); const h = canvas.__fpHandles; if (h) h.key = ""; updateHandles(canvas); }
  function insertPoint(canvas, edge, si, p) {
    const u = edge.unknownData;
    if (!hasPts(edge)) u.fpSmooth = true; // the first point keeps a curve a curve
    const arr = hasPts(edge) ? u.fpPts.slice() : [];
    arr.splice(si, 0, [Math.round(p.x), Math.round(p.y)]);
    u.fpPts = arr;
    commitEdge(canvas, edge);
  }
  // move point idx with the pointer; `grab` is the offset between the cursor and the point where you pressed
  function dragPoint(canvas, edge, idx, grab, first) {
    const h = handleSvg(canvas), guideEls = [];
    const clearGuides = () => { while (guideEls.length) guideEls.pop().remove(); };
    const put = (e, sn) => { const arr = e.unknownData.fpPts.slice(); arr[idx] = [sn.x, sn.y]; e.unknownData.fpPts = arr; };
    const move = (ev) => {
      const w = canvas.posFromEvt(ev), want = { x: w.x - (grab ? grab.x : 0), y: w.y - (grab ? grab.y : 0) };
      const sn = snapPoint(canvas, edge, idx, want, ev, anchorsOf(edge));
      put(edge, sn);
      const bid = edge.unknownData.fpBundle;
      if (bid) for (const o of canvas.edges.values()) if (o !== edge && o.unknownData && o.unknownData.fpBundle === bid && Array.isArray(o.unknownData.fpPts)) { put(o, sn); canvas.markDirty && canvas.markDirty(o); }
      clearGuides();
      for (const g of sn.guides) { const l = document.createElementNS(SVGNS, "line"), big = 20000; if (g.v) { l.setAttribute("x1", g.at); l.setAttribute("x2", g.at); l.setAttribute("y1", sn.y - big); l.setAttribute("y2", sn.y + big); } else { l.setAttribute("y1", g.at); l.setAttribute("y2", g.at); l.setAttribute("x1", sn.x - big); l.setAttribute("x2", sn.x + big); } l.setAttribute("class", "fp-h-guide"); h.gsvg.appendChild(l); guideEls.push(l); }
      commitEdge(canvas, edge);
    };
    const up = () => { window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", up, true); clearGuides(); finishEdit(canvas); };
    window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", up, true);
    if (first) move(first);
  }
  // Pressing on ANY link, selected or not, and dragging takes the point of the line under the cursor (not an end).
  // A plain click is left to the stock handler (it selects the link). The ends are re-attached with their own handles.
  window.__fpEdgeGrab = (edge, e) => {
    if (STOCK_LINKS) return false;
    const canvas = edge.canvas;
    if (window.__fpStockOnce) { window.__fpStockOnce = false; return false; }
    if (!canvas || canvas.readonly || e.pointerType === "touch" || e.button !== 0 || !e.isPrimary || !states.get(canvas) || !opts(canvas).hybrid) return false;
    e.preventDefault();
    // a plain press selects the link at once and dragging takes the nearest point it already has; the stock handler would
    // start re-attaching an end and switch every link to its other drawing, which made all of them jump. Ctrl + drag adds a point.
    if (!(e.ctrlKey || e.metaKey)) {
      if (e.shiftKey) { canvas.updateSelection(() => { if (canvas.selection.has(edge)) canvas.selection.delete(edge); else canvas.selection.add(edge); }); return true; }
      if (!(canvas.selection.size === 1 && canvas.selection.has(edge))) canvas.selectOnly(edge);
    }
    lineDrag(canvas, edge, e);
    return true;
  };
  // press on a link and drag: Ctrl adds a point under the cursor, otherwise the existing point nearest to it follows the pointer
  function lineDrag(canvas, edge, e) {
    const add = e.ctrlKey || e.metaKey;
    const first = !hasPts(edge); // a link without points gets its first one from a plain drag; more points need Ctrl
    const w0 = canvas.posFromEvt(e), sx = e.clientX, sy = e.clientY;
    const stop = () => { window.removeEventListener("pointermove", move, true); window.removeEventListener("pointerup", stop, true); window.removeEventListener("pointercancel", stop, true); };
    const move = (ev) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      stop();
      if (!(canvas.selection.size === 1 && canvas.selection.has(edge))) canvas.selectOnly(edge);
      // pressed close to an existing point (within ~14 screen px): that point follows; anywhere else on the line: a new point is pulled out of it
      let near = -1;
      if (!add && hasPts(edge)) { let bd = 14 / Math.max(0.05, canvas.scale || 1); edge.unknownData.fpPts.forEach((q, i) => { const d = Math.hypot(q[0] - w0.x, q[1] - w0.y); if (d < bd) { bd = d; near = i; } }); }
      if (near < 0) {
        const np = nearestOnPath(edgeSegments(edge), w0);
        insertPoint(canvas, edge, np.seg, np.p);
        dragPoint(canvas, edge, np.seg, { x: w0.x - np.p.x, y: w0.y - np.p.y }, ev);
      } else {
        const q = edge.unknownData.fpPts[near];
        dragPoint(canvas, edge, near, { x: w0.x - q[0], y: w0.y - q[1] }, ev);
      }
    };
    window.addEventListener("pointermove", move, true); window.addEventListener("pointerup", stop, true); window.addEventListener("pointercancel", stop, true);
  }

  // The DOM keeps a group per link it draws. After an undo / import an old group can stay behind (still "focused", so it is drawn
  // as a selected link and answers the pointer): drop every group no live link owns, and the focus of links that are not selected.
  function sweepEdgeDom(canvas) {
    const box = canvas.canvasEl && canvas.canvasEl.querySelector(".canvas-edges");
    if (!box) return;
    const live = new Set();
    for (const e of canvas.edges.values()) { if (e.lineGroupEl) live.add(e.lineGroupEl); if (e.lineEndGroupEl) live.add(e.lineEndGroupEl); }
    for (const ch of Array.from(box.children)) {
      if (!live.has(ch) && ch.tagName === "g") ch.remove();
    }
    for (const e of canvas.edges.values()) {
      if (canvas.selection.has(e)) continue;
      if (e.lineGroupEl && e.lineGroupEl.classList.contains("is-focused")) e.lineGroupEl.classList.remove("is-focused");
      if (e.lineEndGroupEl && e.lineEndGroupEl.classList.contains("is-focused")) e.lineEndGroupEl.classList.remove("is-focused");
    }
  }
  function updateHandles(canvas) {
    if (STOCK_LINKS) { const hh = canvas.__fpHandles; if (hh) { hh.svg.style.display = "none"; hh.svg.textContent = ""; } return; }
    sweepEdgeDom(canvas);
    let h = canvas.__fpHandles;
    const sel = Array.from(canvas.selection);
    // after an undo the selection can still hold an edge object that importData replaced: its handles would be a ghost
    const alive = sel.length === 1 && isEdge(sel[0]) && canvas.edges && canvas.edges.get(sel[0].id) === sel[0];
    const edge = alive && !canvas.readonly ? sel[0] : null;
    if (!edge) { if (h) { h.svg.style.display = "none"; h.svg.textContent = ""; h.gsvg.textContent = ""; h.key = ""; } return; }
    h = handleSvg(canvas);
    h.svg.style.display = "";
    const segs = edgeSegments(edge), pts = hasPts(edge) ? edge.unknownData.fpPts : [];
    const dAttr = edge.path && edge.path.display ? edge.path.display.getAttribute("d") || "" : "";
    const r = 7 / Math.max(0.05, canvas.scale || 1);
    const key = [edge.id, JSON.stringify(pts), edge.unknownData.fpSmooth ? 1 : 0, r.toFixed(2), dAttr.length, edge.from.node.x, edge.from.node.y, edge.to.node.x, edge.to.node.y, edge.from.side, edge.to.side].join("|");
    if (key === h.key) return;
    h.key = key;
    h.svg.textContent = "";
    const commit = () => commitEdge(canvas, edge);
    const drag = (idx, grab) => dragPoint(canvas, edge, idx, grab);
    const insertAt = (si, p) => insertPoint(canvas, edge, si, p);
    const finish = () => finishEdit(canvas);
    const mk = (tag, attrs, cls) => { const el = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); el.setAttribute("class", cls); h.svg.appendChild(el); return el; };
    // 1. a wide invisible copy of the line to grab
    // (the ends of the line are left to the stock handling, which re-attaches a link when you drag its end)
    const trimmedD = (() => { const poly = []; segs.forEach((s) => { for (let k = 0; k <= 28; k++) poly.push(segPoint(s, k / 28)); }); const cum = [0]; for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y)); const total = cum[cum.length - 1], cut = Math.min(16 / Math.max(0.05, canvas.scale || 1) * 1.6, total * 0.12); const keep = poly.filter((_, i) => cum[i] >= cut && cum[i] <= total - cut); return keep.length > 1 ? "M" + keep.map((q) => q.x.toFixed(1) + "," + q.y.toFixed(1)).join(" L") : ""; })();
    const hit = mk("path", { d: trimmedD, "stroke-width": r * 2.6 }, "fp-h-hit");
    hit.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return; e.stopPropagation(); e.preventDefault();
      lineDrag(canvas, edge, e);
    });
    hit.addEventListener("click", (e) => e.stopPropagation());
    hit.addEventListener("dblclick", (e) => { e.stopPropagation(); e.preventDefault(); try { edge.editLabel(); } catch (err) { /* stock label editor unavailable */ } });
    // a ghost dot shows which point of the line you would take
    const ghost = mk("circle", { cx: -99999, cy: -99999, r: r * 0.9 }, "fp-h-ghost");
    hit.addEventListener("pointermove", (e) => { const np = nearestOnPath(segs, canvas.posFromEvt(e)); ghost.setAttribute("cx", np.p.x); ghost.setAttribute("cy", np.p.y); });
    hit.addEventListener("pointerleave", () => { ghost.setAttribute("cx", -99999); });
    // the two ends: take these to re-attach the link to another card
    for (const [q, which] of [[segs[0].p0, 0], [segs[segs.length - 1].p1, 1]]) {
      const end = mk("rect", { x: q.x - r, y: q.y - r, width: r * 2, height: r * 2 }, "fp-h-end");
      end.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; e.stopPropagation(); window.__fpStockOnce = true; try { edge.onConnectionPointerdown(e); } catch (err) { /* stock handler unavailable */ } window.__fpStockOnce = false; });
      end.addEventListener("click", (e) => e.stopPropagation());
    }
    // 2. the points
    pts.forEach((q, i) => {
      const c = mk("circle", { cx: q[0], cy: q[1], r }, "fp-h-pt");
      c.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); const w = canvas.posFromEvt(e); drag(i, { x: w.x - q[0], y: w.y - q[1] }); });
      c.addEventListener("click", (e) => e.stopPropagation());
      const remove = () => { const arr = edge.unknownData.fpPts.slice(); arr.splice(i, 1); if (arr.length) edge.unknownData.fpPts = arr; else { delete edge.unknownData.fpPts; delete edge.unknownData.fpSmooth; } commit(); finish(); };
      c.addEventListener("dblclick", (e) => { e.stopPropagation(); remove(); });
      c.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); remove(); });
    });
    // 3. the dot in the middle of each piece, on the line itself
    let longest = 0, ll = -1; segs.forEach((s, si) => { const l = Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y); if (l > ll) { ll = l; longest = si; } });
    segs.forEach((s, si) => {
      const m = segPoint(s, 0.5);
      const c = mk("circle", { cx: m.x, cy: m.y, r: r * (si === longest ? 1 : 0.78) }, "fp-h-mid" + (si === longest ? " fp-h-main" : ""));
      c.addEventListener("pointerdown", (e) => { if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); const w = canvas.posFromEvt(e); insertAt(si, m); drag(si, { x: w.x - m.x, y: w.y - m.y }); });
      c.addEventListener("click", (e) => e.stopPropagation());
    });
  }
  window.__fpUpdateHandles = (c) => updateHandles(c);
  const editPath = (canvas, edges, what) => {
    for (const e of edges) {
      const u = e.unknownData;
      if (what === "reset") { delete u.fpPts; delete u.fpSmooth; delete u.fpLine; delete u.fpBundle; }
      else if (what === "straight") { delete u.fpPts; delete u.fpSmooth; delete u.fpBundle; u.fpLine = "straight"; }
      else if (what === "unbundle") { delete u.fpBundle; }
      else if (what === "smooth") { u.fpSmooth = !u.fpSmooth; if (!hasPts(e)) { const a = sidePointOf(e.from.node, e.from.side), b = sidePointOf(e.to.node, e.to.side); u.fpPts = [[Math.round(a.x + (b.x - a.x) / 3), Math.round(a.y + (b.y - a.y) / 3)], [Math.round(a.x + ((b.x - a.x) * 2) / 3), Math.round(a.y + ((b.y - a.y) * 2) / 3)]]; } }
      else if (what === "add") {
        const segs = edgeSegments(e); let bi = 0, bl = -1;
        segs.forEach((s, i) => { const l = Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y); if (l > bl) { bl = l; bi = i; } });
        const m = segPoint(segs[bi], 0.5);
        if (!hasPts(e)) { u.fpPts = []; u.fpSmooth = true; }
        const arr = u.fpPts.slice(); arr.splice(bi, 0, [Math.round(m.x), Math.round(m.y)]); u.fpPts = arr;
      }
      canvas.markDirty && canvas.markDirty(e);
    }
    if (what === "bundle" && edges.length >= 2) {
      // every selected link passes through one shared point: the middle of their middles
      let sx = 0, sy = 0; const mids = edges.map((e) => { const sg = edgeSegments(e); return segPoint(sg[Math.floor(sg.length / 2)], sg.length % 2 ? 0.5 : 0); });
      mids.forEach((m) => { sx += m.x; sy += m.y; });
      const P = [Math.round(sx / mids.length), Math.round(sy / mids.length)], id = "b" + Math.random().toString(36).slice(2, 8);
      for (const e of edges) { const u = e.unknownData; delete u.fpLine; u.fpPts = [P.slice()]; u.fpSmooth = true; u.fpBundle = id; canvas.markDirty && canvas.markDirty(e); }
    }
    const st = states.get(canvas); if (st) st.dirty = true;
    if (canvas.__fpHandles) canvas.__fpHandles.key = "";
    canvas.requestSave && canvas.requestSave(); canvas.viewportChanged = true; canvas.requestFrame && canvas.requestFrame();
  };
  // ---- collapsible groups: a collapsed group keeps its children's ids (fpCollapsed) and they are hidden everywhere
  const hiddenOf = (canvas) => {
    const hid = new Set();
    for (const n of canvas.nodes.values()) { const c = n.unknownData && n.unknownData.fpCollapsed; if (c && Array.isArray(c.ids)) for (const id of c.ids) hid.add(id); }
    return hid;
  };
  function toggleGroup(canvas, g) {
    const u = g.unknownData;
    if (u.fpCollapsed) {
      const h = u.fpCollapsed.h; delete u.fpCollapsed;
      g.resize({ width: g.width, height: h });
    } else {
      const kids = Array.from(canvas.nodes.values()).filter((n) => n !== g && n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height);
      u.fpCollapsed = { h: g.height, ids: kids.map((k) => k.id) };
      g.resize({ width: g.width, height: 56 });
    }
    const st = states.get(canvas); if (st) st.dirty = true;
    canvas.requestSave && canvas.requestSave(); canvas.viewportChanged = true; canvas.requestFrame && canvas.requestFrame();
  }

  // ---- presentation: fly from card to card with the arrow keys
  function presentOrder(canvas) {
    const cards = Array.from(canvas.nodes.values()).filter((n) => n.nodeEl && !n.nodeEl.classList.contains("canvas-node-group"));
    if (!cards.length) return [];
    const sel = Array.from(canvas.selection).filter((n) => n.nodeEl && !n.nodeEl.classList.contains("canvas-node-group"));
    const pool = sel.length >= 2 ? sel : cards, set = new Set(pool);
    const byPos = (a, b) => a.y - b.y || a.x - b.x;
    const out = [], seen = new Set();
    const outgoing = new Map(); for (const e of canvas.edges.values()) { const a = e.from.node, b = e.to.node; if (set.has(a) && set.has(b)) { if (!outgoing.has(a)) outgoing.set(a, []); outgoing.get(a).push(b); } }
    const hasIn = new Set(); for (const l of outgoing.values()) for (const b of l) hasIn.add(b);
    const walk = (n) => { if (seen.has(n)) return; seen.add(n); out.push(n); for (const m of (outgoing.get(n) || []).slice().sort(byPos)) walk(m); };
    for (const n of pool.filter((x) => !hasIn.has(x)).sort(byPos)) walk(n);
    for (const n of pool.slice().sort(byPos)) walk(n);
    return out;
  }
  function startPresentation(canvas) {
    const seq = presentOrder(canvas);
    if (!seq.length) return typeof Notice === "function" && new Notice("На холсте нет карточек для показа");
    let i = 0;
    const bar = document.createElement("div"); bar.className = "fp-present";
    bar.innerHTML = '<button class="fp-pv-prev">‹</button><span class="fp-pv-n"></span><button class="fp-pv-next">›</button><button class="fp-pv-end">Выход</button>';
    canvas.wrapperEl.appendChild(bar);
    const show = () => { const n = seq[i]; bar.querySelector(".fp-pv-n").textContent = (i + 1) + " / " + seq.length; try { canvas.selectOnly(n); canvas.zoomToBbox(n.getBBox()); } catch (e) { /* node gone */ } };
    const go = (d) => { i = Math.max(0, Math.min(seq.length - 1, i + d)); show(); };
    const end = () => { document.removeEventListener("keydown", key, true); bar.remove(); try { canvas.deselectAll(); } catch (e) { /* ok */ } };
    const key = (e) => { if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); e.stopPropagation(); go(1); } else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); e.stopPropagation(); go(-1); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); end(); } };
    document.addEventListener("keydown", key, true);
    bar.querySelector(".fp-pv-prev").addEventListener("click", () => go(-1)); bar.querySelector(".fp-pv-next").addEventListener("click", () => go(1)); bar.querySelector(".fp-pv-end").addEventListener("click", end);
    show();
  }
  window.__fpPresent = (c) => startPresentation(c);
  const isEdge = (x) => x && x.from && x.to && !x.nodeEl;
  const setEnds = (canvas, edges, from, to) => {
    for (const e of edges) { if (from != null) e.from.end = from; if (to != null) e.to.end = to; canvas.markDirty && canvas.markDirty(e); }
    const st = states.get(canvas);
    if (st) st.dirty = true;
    canvas.requestSave && canvas.requestSave();
    canvas.viewportChanged = true;
    canvas.requestFrame && canvas.requestFrame();
  };
  const endThumb = (kind) => {
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "-2 -2 44 16"); svg.setAttribute("width", "44"); svg.setAttribute("height", "16");
    const line = document.createElementNS(SVGNS, "line");
    for (const [k, v] of [["x1", 0], ["y1", 6], ["x2", 28], ["y2", 6], ["stroke", "currentColor"], ["stroke-width", 1.6]]) line.setAttribute(k, v);
    svg.appendChild(line);
    const p = kind ? endPts(kind) : null;
    if (p && p.length) {
      const g = document.createElementNS(SVGNS, "polygon");
      // marker pointing right at x = 28, scaled down: local (x,y) -> (28 - y*0.75, 6 + x*0.75)
      g.setAttribute("points", p.map((q) => (28 - q[1] * 0.75 + 5).toFixed(1) + "," + (6 + q[0] * 0.75).toFixed(1)).join(" "));
      g.setAttribute("fill", "currentColor");
      svg.appendChild(g);
    }
    return svg;
  };
  function edgePicker(menuEl, edges, canvas) {
    const btn = menuEl.createEl("button", "clickable-icon");
    btn.setAttribute("aria-label", "Начало, конец и линия связи");
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h14"/><path d="M17 6l4 6-4 6z" fill="currentColor"/></svg>';
    let pop = null;
    const close = () => { if (pop) { pop.remove(); pop = null; } btn.removeClass("is-active"); };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (pop) return close();
      btn.addClass("is-active");
      pop = document.createElement("div");
      pop.className = "fp-end-picker";
      const col = (title, items, isCur, onPick) => {
        const c = document.createElement("div"); c.className = "fp-end-col";
        const t = document.createElement("div"); t.className = "fp-end-title"; t.textContent = title; c.appendChild(t);
        items.forEach(([thumb, label], k) => {
          const it = document.createElement("div"); it.className = "fp-end-item" + (isCur(k) ? " is-active" : "");
          it.appendChild(thumb); const l = document.createElement("span"); l.textContent = label; it.appendChild(l);
          it.addEventListener("click", () => { onPick(k); close(); });
          c.appendChild(it);
        });
        pop.appendChild(c);
      };
      const same = (side) => (edges.every((x) => x[side].end === edges[0][side].end) ? edges[0][side].end : null);
      const ends = () => END_NAMES.map((n, k) => [endThumb(k), END_LABELS[k]]);
      col("Начало", ends(), (k) => same("from") === END_NAMES[k], (k) => setEnds(canvas, edges, END_NAMES[k], null));
      col("Конец", ends(), (k) => same("to") === END_NAMES[k], (k) => setEnds(canvas, edges, null, END_NAMES[k]));
      const pathThumb = (d) => { const svg = document.createElementNS(SVGNS, "svg"); svg.setAttribute("viewBox", "0 0 44 24"); svg.setAttribute("width", "44"); svg.setAttribute("height", "24"); const p = document.createElementNS(SVGNS, "path"); p.setAttribute("d", d); for (const [k, v] of [["fill", "none"], ["stroke", "currentColor"], ["stroke-width", 2], ["stroke-linejoin", "round"], ["stroke-linecap", "round"]]) p.setAttribute(k, v); svg.appendChild(p); return svg; };
      const smoothNow = edges.every((x) => x.unknownData.fpSmooth);
      col("Путь", [
        [pathThumb("M3 20 L16 6 L28 18 L41 4"), "Добавить точку"],
        [pathThumb(smoothNow ? "M3 20 L16 6 L28 18 L41 4" : "M3 20 C10 4 20 4 26 14 S36 22 41 4"), smoothNow ? "Ломаная" : "Сгладить"],
        [pathThumb("M3 20 L41 4"), "Прямая линия"],
        ...(edges.length > 1 ? [[pathThumb("M3 6 L22 14 L41 6 M3 20 L22 14 L41 20"), "В пучок (общая точка)"], [pathThumb("M3 6 L41 6 M3 20 L41 20"), "Разъединить пучок"]] : []),
        [pathThumb("M3 20 C14 4 28 4 41 20"), "Сбросить путь"],
      ], () => false, (k) => editPath(canvas, edges, (edges.length > 1 ? ["add", "smooth", "straight", "bundle", "unbundle", "reset"] : ["add", "smooth", "straight", "reset"])[k]));
      document.body.appendChild(pop);
      const r = btn.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left + r.width / 2 - pop.offsetWidth / 2)) + "px";
      pop.style.top = Math.max(8, r.top - pop.offsetHeight - 10) + "px";
      const away = (ev) => { if (!pop || pop.contains(ev.target) || btn.contains(ev.target)) return; close(); document.removeEventListener("pointerdown", away, true); };
      document.addEventListener("pointerdown", away, true);
    });
  }

  window.__fpToolbar = (menuEl, sel, canvas) => {
    if (canvas.readonly || !sel.length) return;
    if (sel.every(isEdge)) { edgePicker(menuEl, sel, canvas); return; }
    if (sel.some((n) => isEdge(n) || !n.unknownData || !n.nodeEl || n.nodeEl.classList.contains("canvas-node-group"))) return;
    const btn = menuEl.createEl("button", "clickable-icon");
    btn.setAttribute("aria-label", "Форма карточки");
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h10l4 5-1 9-5 4H9l-5-4-1-9z"/></svg>';
    let pop = null;
    btn.addEventListener("click", () => {
      if (pop) { pop.remove(); pop = null; btn.removeClass("is-active"); return; }
      btn.addClass("is-active");
      pop = menuEl.createDiv("canvas-submenu fp-shape-picker");
      const cur = sel.every((n) => n.unknownData.fpShape === sel[0].unknownData.fpShape) ? sel[0].unknownData.fpShape : undefined;
      const choose = (v) => {
        for (const n of sel) { if (v === null) delete n.unknownData.fpShape; else n.unknownData.fpShape = v; n.__fpShapeKey = ""; }
        const st = states.get(canvas);
        if (st) { st.dirty = true; st.needPick = true; }
        canvas.requestSave && canvas.requestSave();
        canvas.viewportChanged = true;
        canvas.requestFrame && canvas.requestFrame();
        pop.remove(); pop = null; btn.removeClass("is-active");
      };
      [[null, "Как в настройках"], ...SHAPE_NAMES.map((nm, k) => [k, nm])].forEach(([v, nm]) => {
        const it = pop.createDiv("fp-shape-item" + ((v === null ? cur === undefined : cur === v) ? " is-active" : ""));
        it.setAttribute("aria-label", nm);
        const svg = document.createElementNS(SVGNS, "svg");
        svg.setAttribute("viewBox", "0 0 52 38"); svg.setAttribute("width", "52"); svg.setAttribute("height", "38");
        const k = v === null ? 1 : v;
        const poly = document.createElementNS(SVGNS, k === 0 ? "rect" : "polygon");
        if (k === 0) { for (const [n, x] of [["x", 2], ["y", 2], ["width", 48], ["height", 34], ["rx", 5]]) poly.setAttribute(n, x); }
        else poly.setAttribute("points", shapePts(k, 100, 72).map((q) => (q[0] * 0.5 + 1).toFixed(1) + "," + (q[1] * 0.5 + 1).toFixed(1)).join(" "));
        poly.setAttribute("fill", v === null ? "none" : "currentColor"); poly.setAttribute("fill-opacity", "0.25"); poly.setAttribute("stroke", "currentColor"); poly.setAttribute("stroke-width", "1.5"); poly.setAttribute("stroke-linejoin", "round");
        if (v === null) poly.setAttribute("stroke-dasharray", "3 2");
        svg.appendChild(poly); it.appendChild(svg);
        it.createDiv({ cls: "fp-shape-name", text: v === null ? "Как в настр." : nm });
        it.addEventListener("click", () => choose(v));
      });
    });
  };

  window.__fpEdgeMenu = (menu, edge) => {
    if (STOCK_LINKS) return;
    const canvas = edge.canvas;
    if (!canvas || canvas.readonly) return;
    menu.addItem((i) => i.setSection("canvas").setTitle("Добавить точку на путь").setIcon("lucide-plus").onClick(() => editPath(canvas, [edge], "add")));
    menu.addItem((i) => i.setSection("canvas").setTitle(edge.unknownData.fpSmooth ? "Путь: ломаная" : "Путь: сгладить").setIcon("lucide-spline").onClick(() => editPath(canvas, [edge], "smooth")));
    menu.addItem((i) => i.setSection("canvas").setTitle("Прямая линия").setIcon("lucide-minus").onClick(() => editPath(canvas, [edge], "straight")));
    if (hasPts(edge) || edge.unknownData.fpLine) menu.addItem((i) => i.setSection("canvas").setTitle("Сбросить путь").setIcon("lucide-rotate-ccw").onClick(() => editPath(canvas, [edge], "reset")));
    for (const [side, title] of [["from", "Маркер начала"], ["to", "Маркер конца"]]) {
      menu.addItem((item) => {
        item.setSection("canvas").setTitle(title).setIcon("lucide-arrow-right");
        const sub = item.setSubmenu();
        END_NAMES.forEach((name, k) => sub.addItem((i) => i.setTitle(END_LABELS[k]).setChecked(edge[side].end === name).onClick(() => setEnds(canvas, [edge], side === "from" ? name : null, side === "to" ? name : null))));
      });
    }
  };

  // ---- card types (from the Basalt card design): a preset size + starting content, one click on the card menu
  const CARD_TYPES = [
    { id: "note", name: "Заметка", w: 400, h: 440, kind: "text", text: "## Заголовок заметки\n\nЗдесь пишется текст заметки.\n\n#идея #проект" },
    { id: "md", name: "Markdown", w: 400, h: 420, kind: "text", text: "## План релиза\n\nКороткий список задач на **v0.4** и ссылка на [[Canvas]].\n\n- [x] Canvas\n- [ ] Плагины\n- [ ] Синхронизация\n\n`basalt sync --open`\n\n> Заметки принадлежат тебе." },
    { id: "image", name: "Картинка", w: 400, h: 300, kind: "file", images: true },
    { id: "mini", name: "Мини-заметка", w: 280, h: 140, kind: "text", text: "Короткая мысль." },
    { id: "link", name: "Ссылка", w: 400, h: 190, kind: "link" },
    { id: "file", name: "Файл", w: 340, h: 110, kind: "file" },
    { id: "canvas", name: "Вложенный холст", w: 360, h: 240, kind: "file", ext: "canvas" },
    { id: "code", name: "Код (запуск)", w: 460, h: 300, kind: "text", text: "```js\nconsole.log(\"Привет, Basalt!\");\n```" },
    { id: "terminal", name: "Терминал", w: 560, h: 320, kind: "text", text: "```basalt-terminal\n```" },
  ];
  // ---- auto layout: grid / tree / force-directed over the selected cards (or all of them), animated
  const GAP = 48;
  function layoutTargets(canvas) {
    const sel = Array.from(canvas.selection).filter((n) => n.nodeEl && n.moveTo);
    const all = Array.from(canvas.nodes.values()).filter((n) => !n.nodeEl.classList.contains("canvas-node-group"));
    return (sel.length >= 2 ? sel : all).filter((n) => !n.nodeEl.classList.contains("canvas-node-group"));
  }
  function bboxOf(nodes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.width); y1 = Math.max(y1, n.y + n.height); }
    return { x0, y0, x1, y1 };
  }
  function layoutGrid(nodes) {
    const sorted = nodes.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const cw = Math.max(...nodes.map((n) => n.width)) + GAP, ch = Math.max(...nodes.map((n) => n.height)) + GAP;
    const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length * (ch / cw))));
    const out = new Map(); const b = bboxOf(nodes);
    sorted.forEach((n, i) => out.set(n, { x: b.x0 + (i % cols) * cw, y: b.y0 + Math.floor(i / cols) * ch }));
    return out;
  }
  function layoutTree(canvas, nodes, horizontal) {
    const set = new Set(nodes), kids = new Map(nodes.map((n) => [n, []])), hasParent = new Set();
    for (const e of canvas.edges.values()) {
      const a = e.from.node, c = e.to.node;
      if (set.has(a) && set.has(c) && a !== c && !hasParent.has(c)) { kids.get(a).push(c); hasParent.add(c); }
    }
    const roots = nodes.filter((n) => !hasParent.has(n)).sort((a, b) => a.y - b.y || a.x - b.x);
    // a cycle with no root: start from its top-left card
    const seen = new Set(); const out = new Map(); const b = bboxOf(nodes);
    const along = (n) => (horizontal ? n.width : n.height), across = (n) => (horizontal ? n.height : n.width);
    const span = new Map();
    const measure = (n, stack = new Set()) => {
      if (span.has(n)) return span.get(n);
      stack.add(n);
      const ks = kids.get(n).filter((k) => !stack.has(k));
      kids.set(n, ks);
      const s = Math.max(across(n), ks.length ? ks.reduce((t, k) => t + measure(k, stack), 0) + GAP * (ks.length - 1) : 0);
      stack.delete(n); span.set(n, s); return s;
    };
    const depthMax = new Map();
    const levelOf = new Map();
    const walk = (n, d) => { levelOf.set(n, d); depthMax.set(d, Math.max(depthMax.get(d) || 0, along(n))); for (const k of kids.get(n)) walk(k, d + 1); };
    let cursor = 0;
    const toPlace = roots.length ? roots : [nodes.slice().sort((a, c) => a.y - c.y || a.x - c.x)[0]];
    const place = (n, start) => {
      seen.add(n);
      const s = measure(n);
      const lv = levelOf.get(n);
      let offset = 0; for (let d = 0; d < lv; d++) offset += (depthMax.get(d) || 0) + GAP * 2;
      const pos = start + (s - across(n)) / 2;
      out.set(n, horizontal ? { x: b.x0 + offset, y: b.y0 + pos } : { x: b.x0 + pos, y: b.y0 + offset });
      let c = start + (s - (kids.get(n).reduce((t, k) => t + span.get(k), 0) + GAP * Math.max(0, kids.get(n).length - 1))) / 2;
      for (const k of kids.get(n)) { place(k, c); c += span.get(k) + GAP; }
    };
    for (const r of toPlace) { measure(r); walk(r, 0); }
    for (const r of toPlace) { place(r, cursor); cursor += span.get(r) + GAP * 2; }
    // anything still unplaced (a cycle that the first root did not reach) goes in a row below
    let rest = nodes.filter((n) => !out.has(n)), x = b.x0;
    for (const n of rest) { out.set(n, { x, y: b.y0 + cursor }); x += n.width + GAP; }
    return out;
  }
  function layoutForce(canvas, nodes) {
    const idx = new Map(nodes.map((n, i) => [n, i]));
    const P = nodes.map((n) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2, w: n.width + GAP, h: n.height + GAP, vx: 0, vy: 0 }));
    const links = [];
    for (const e of canvas.edges.values()) { const a = idx.get(e.from.node), c = idx.get(e.to.node); if (a != null && c != null && a !== c) links.push([a, c]); }
    const b = bboxOf(nodes), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    // spread coincident cards a little so they can push apart
    P.forEach((p, i) => { p.x += (i % 7) * 0.5; p.y += (i % 5) * 0.5; });
    const n = P.length, ideal = 380, iters = n > 400 ? 120 : 300;
    for (let it = 0; it < iters; it++) {
      const cool = 1 - it / iters;
      for (const p of P) { p.vx = 0; p.vy = 0; }
      for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) {
        const a = P[i], c = P[k]; let dx = c.x - a.x, dy = c.y - a.y;
        const d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
        const f = (ideal * ideal * 0.9) / d2;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx -= fx; a.vy -= fy; c.vx += fx; c.vy += fy;
      }
      for (const [i, k] of links) {
        const a = P[i], c = P[k]; const dx = c.x - a.x, dy = c.y - a.y, d = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const f = (d - ideal) * 0.06;
        a.vx += (dx / d) * f; a.vy += (dy / d) * f; c.vx -= (dx / d) * f; c.vy -= (dy / d) * f;
      }
      const step = 60 * cool + 4;
      for (const p of P) { p.vx -= (p.x - cx) * 0.004; p.vy -= (p.y - cy) * 0.004; const m = Math.hypot(p.vx, p.vy) || 1; const s = Math.min(m, step) / m; p.x += p.vx * s; p.y += p.vy * s; }
    }
    // hard separation: no two cards overlap
    for (let pass = 0; pass < 80; pass++) {
      let moved = false;
      for (let i = 0; i < n; i++) for (let k = i + 1; k < n; k++) {
        const a = P[i], c = P[k]; const dx = c.x - a.x, dy = c.y - a.y;
        const ox = (a.w + c.w) / 2 - Math.abs(dx), oy = (a.h + c.h) / 2 - Math.abs(dy);
        if (ox > 0 && oy > 0) {
          moved = true;
          if (ox < oy) { const s = (dx >= 0 ? 1 : -1) * ox / 2; a.x -= s; c.x += s; } else { const s = (dy >= 0 ? 1 : -1) * oy / 2; a.y -= s; c.y += s; }
        }
      }
      if (!moved) break;
    }
    // keep the whole thing where it was
    const mx = P.reduce((t, p) => t + p.x, 0) / n, my = P.reduce((t, p) => t + p.y, 0) / n;
    const out = new Map(); nodes.forEach((nd, i) => out.set(nd, { x: P[i].x - mx + cx - nd.width / 2, y: P[i].y - my + cy - nd.height / 2 }));
    return out;
  }
  function animateTo(canvas, targets) {
    const from = new Map(); for (const n of targets.keys()) from.set(n, { x: n.x, y: n.y });
    const t0 = performance.now(), D = 380;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / D), k = ease(t);
      for (const [n, to] of targets) { const f = from.get(n); n.moveTo({ x: Math.round(f.x + (to.x - f.x) * k), y: Math.round(f.y + (to.y - f.y) * k) }); }
      if (t < 1) requestAnimationFrame(frame); else { canvas.requestSave && canvas.requestSave(); }
    };
    requestAnimationFrame(frame);
  }
  // wrap every connected group of cards in a group frame
  function groupClusters(canvas) {
    const nodes = layoutTargets(canvas), set = new Set(nodes), parent = new Map(nodes.map((n) => [n, n]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (const e of canvas.edges.values()) { const a = e.from.node, b = e.to.node; if (set.has(a) && set.has(b)) parent.set(find(a), find(b)); }
    const comps = new Map();
    for (const n of nodes) { const r = find(n); (comps.get(r) || comps.set(r, []).get(r)).push(n); }
    let made = 0;
    for (const list of comps.values()) {
      if (list.length < 2) continue;
      const b = bboxOf(list), pad = 40;
      canvas.createGroupNode({ pos: { x: b.x0 - pad, y: b.y0 - pad - 20 }, size: { width: b.x1 - b.x0 + pad * 2, height: b.y1 - b.y0 + pad * 2 + 20 }, label: "Группа " + (++made), save: false, focus: false });
    }
    canvas.requestSave && canvas.requestSave();
    if (!made && typeof Notice === "function") new Notice("Нет связанных карточек, которые можно объединить");
  }
  // ---- alignment tools for the selected cards
  function selectedCards(canvas) { return Array.from(canvas.selection).filter((n) => n.nodeEl && n.moveTo); }
  function alignCards(canvas, how) {
    const nodes = selectedCards(canvas);
    if (nodes.length < 2) return typeof Notice === "function" && new Notice("Выделите хотя бы две карточки");
    const b = bboxOf(nodes), out = new Map(), step = opts(canvas).gridStep * 1;
    if (how === "left") nodes.forEach((n) => out.set(n, { x: b.x0, y: n.y }));
    else if (how === "right") nodes.forEach((n) => out.set(n, { x: b.x1 - n.width, y: n.y }));
    else if (how === "top") nodes.forEach((n) => out.set(n, { x: n.x, y: b.y0 }));
    else if (how === "bottom") nodes.forEach((n) => out.set(n, { x: n.x, y: b.y1 - n.height }));
    else if (how === "center") nodes.forEach((n) => out.set(n, { x: Math.round((b.x0 + b.x1) / 2 - n.width / 2), y: n.y }));
    else if (how === "middle") nodes.forEach((n) => out.set(n, { x: n.x, y: Math.round((b.y0 + b.y1) / 2 - n.height / 2) }));
    else if (how === "dist-h" || how === "dist-v") {
      const h = how === "dist-h", sorted = nodes.slice().sort((a, c) => (h ? a.x - c.x : a.y - c.y));
      const total = sorted.reduce((t, n) => t + (h ? n.width : n.height), 0), gap = ((h ? b.x1 - b.x0 : b.y1 - b.y0) - total) / (sorted.length - 1);
      let at = h ? b.x0 : b.y0;
      for (const n of sorted) { out.set(n, h ? { x: Math.round(at), y: n.y } : { x: n.x, y: Math.round(at) }); at += (h ? n.width : n.height) + gap; }
    } else if (how === "row" || how === "column") {
      const h = how === "row", sorted = nodes.slice().sort((a, c) => (h ? a.x - c.x : a.y - c.y));
      let at = h ? b.x0 : b.y0;
      for (const n of sorted) { out.set(n, h ? { x: at, y: b.y0 } : { x: b.x0, y: at }); at += (h ? n.width : n.height) + GAP; }
    } else if (how === "grid-snap") nodes.forEach((n) => out.set(n, { x: Math.round(n.x / step) * step, y: Math.round(n.y / step) * step }));
    else if (how === "same-w" || how === "same-h" || how === "same-size") {
      const ref = nodes.find((n) => canvas.selection.has(n)) || nodes[0];
      const w = Math.max(...nodes.map((n) => n.width)), h = Math.max(...nodes.map((n) => n.height));
      for (const n of nodes) n.resize({ width: how === "same-h" ? n.width : w, height: how === "same-w" ? n.height : h });
      void ref; canvas.requestSave && canvas.requestSave(); return;
    }
    animateTo(canvas, out);
  }
  const ALIGNS = [
    ["left", "Выровнять по левому краю"], ["center", "Выровнять по центру (вертикальная ось)"], ["right", "Выровнять по правому краю"],
    ["top", "Выровнять по верхнему краю"], ["middle", "Выровнять по центру (горизонтальная ось)"], ["bottom", "Выровнять по нижнему краю"],
    ["dist-h", "Равные промежутки по горизонтали"], ["dist-v", "Равные промежутки по вертикали"],
    ["row", "Собрать в ряд"], ["column", "Собрать в колонку"],
    ["same-w", "Одинаковая ширина"], ["same-h", "Одинаковая высота"], ["same-size", "Одинаковый размер"], ["grid-snap", "Привязать к сетке"],
  ];
  window.__fpAlign = (c, how) => alignCards(c, how);
  const LAYOUTS = [
    { id: "grid", name: "Сетка", run: (c, n) => layoutGrid(n) },
    { id: "tree-h", name: "Дерево слева направо", run: (c, n) => layoutTree(c, n, true) },
    { id: "tree-v", name: "Дерево сверху вниз", run: (c, n) => layoutTree(c, n, false) },
    { id: "force", name: "Силовая раскладка", run: (c, n) => layoutForce(c, n) },
    { id: "group", name: "Сгруппировать связные части", run: (c, n) => { groupClusters(c); return new Map(); } },
  ];
  function runLayout(canvas, layout) {
    const nodes = layoutTargets(canvas);
    if (nodes.length < 2) return typeof Notice === "function" && new Notice("Нужно хотя бы две карточки");
    try { animateTo(canvas, layout.run(canvas, nodes)); } catch (e) { console.error("[fp-canvas] layout failed", e); typeof Notice === "function" && new Notice("Раскладка не удалась: " + e.message); }
  }
  window.__fpRunLayout = (canvas, id) => { const l = LAYOUTS.find((x) => x.id === id); if (l) runLayout(canvas, l); };

  // ---- nested canvases: hovering a card that points at another canvas shows that canvas as a small picture
  let hoverTimer = 0, hoverEl = null;
  const hideCanvasPreview = () => { clearTimeout(hoverTimer); hoverTimer = 0; if (hoverEl) { hoverEl.remove(); hoverEl = null; } };
  async function showCanvasPreview(file, anchor) {
    let data; try { data = JSON.parse(await app.vault.cachedRead(file)); } catch (e) { return; }
    const nodes = data.nodes || [], edges = data.edges || [];
    if (!nodes.length) return;
    hideCanvasPreview();
    const W = 360, H = 250, dpr = window.devicePixelRatio || 1;
    const box = document.createElement("div"); box.className = "fp-preview";
    const head = document.createElement("div"); head.className = "fp-preview-head"; head.textContent = file.basename + " · " + nodes.length + " карт.";
    const cv = document.createElement("canvas"); cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
    box.append(head, cv); document.body.appendChild(box); hoverEl = box;
    const r = anchor.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(window.innerWidth - W - 24, r.left + r.width / 2 - W / 2)) + "px";
    const below = r.bottom + 8 + H + 40 < window.innerHeight;
    box.style.top = (below ? r.bottom + 8 : Math.max(8, r.top - H - 48)) + "px";
    paintCanvasPreview(cv, W, H, nodes, edges);
  }
  // draws a canvas file (parsed JSON) as a small picture into a <canvas> element of W x H css pixels
  function paintCanvasPreview(cv, W, H, nodes, edges) {
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + "px"; cv.style.height = H + "px";
    const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.width); y1 = Math.max(y1, n.y + n.height); }
    const pad = 12, k = Math.min((W - pad * 2) / (x1 - x0 || 1), (H - pad * 2) / (y1 - y0 || 1));
    const ox = (W - (x1 - x0) * k) / 2 - x0 * k, oy = (H - (y1 - y0) * k) / 2 - y0 * k;
    const dark = document.body.classList.contains("theme-dark"), byId = new Map(nodes.map((n) => [n.id, n]));
    ctx.strokeStyle = dark ? "rgba(200,180,160,.4)" : "rgba(60,40,20,.4)"; ctx.lineWidth = 1; ctx.beginPath();
    for (const e of edges) { const a = byId.get(e.fromNode), b = byId.get(e.toNode); if (a && b) { ctx.moveTo((a.x + a.width / 2) * k + ox, (a.y + a.height / 2) * k + oy); ctx.lineTo((b.x + b.width / 2) * k + ox, (b.y + b.height / 2) * k + oy); } }
    ctx.stroke();
    for (const n of nodes) {
      const c = rgbOfColor(n.color), x = n.x * k + ox, y = n.y * k + oy, w = n.width * k, h = n.height * k;
      if (n.type === "group") { ctx.strokeStyle = c ? `rgba(${c},.7)` : "rgba(160,140,120,.5)"; ctx.strokeRect(x, y, w, h); continue; }
      ctx.fillStyle = dark ? "#2a221c" : "#f1eadf"; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = c ? `rgba(${c},.9)` : (dark ? "#5a4634" : "#b9a994"); ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
      if (w > 34 && h > 16) {
        const label = (n.type === "text" ? n.text : n.type === "file" ? n.file : n.url || "") || "";
        const first = String(label).split("\n").find((l) => l.trim()) || "";
        ctx.fillStyle = dark ? "rgba(236,228,219,.85)" : "rgba(42,33,26,.85)"; ctx.font = `${Math.max(6, Math.min(12, h * 0.22))}px sans-serif`; ctx.textBaseline = "top";
        ctx.save(); ctx.beginPath(); ctx.rect(x + 2, y + 2, w - 4, h - 4); ctx.clip(); ctx.fillText(first.replace(/^#+\s*/, "").slice(0, 60), x + 4, y + 4); ctx.restore();
      }
    }
  }

  // a card that points at another canvas shows that canvas right inside the card (and opens it on double click)
  async function mountNested(n) {
    // the old small preview is gone: nestedDom() draws the whole canvas inside the card
    const stale = n.nodeEl && n.nodeEl.querySelector(":scope > .canvas-node-container > .fp-nested"); if (stale) stale.remove();
    return;
    const box = n.nodeEl.querySelector(":scope > .canvas-node-container");
    if (!box) return;
    let ov = box.querySelector(":scope > .fp-nested");
    const key = n.width + "x" + n.height + ":" + (n.file && n.file.stat ? n.file.stat.mtime : 0);
    if (ov && ov.dataset.key === key) return;
    let data; try { data = JSON.parse(await app.vault.cachedRead(n.file)); } catch (e) { return; }
    const nodes = data.nodes || [];
    if (!ov) { ov = document.createElement("div"); ov.className = "fp-nested"; ov.appendChild(document.createElement("canvas")); box.appendChild(ov); }
    ov.dataset.key = key;
    if (!nodes.length) { ov.firstChild.style.display = "none"; return; }
    ov.firstChild.style.display = "";
    paintCanvasPreview(ov.firstChild, Math.max(40, n.width - 2), Math.max(30, n.height - 2), nodes, data.edges || []);
  }

  const watchNestedCanvas = () => {
    if (!document.body) return;
    document.body.addEventListener("mouseover", (e) => {
      const el = e.target.closest && e.target.closest(".canvas-node");
      if (!el || el === hoverEl) return;
      let file = null;
      try { for (const leaf of app.workspace.getLeavesOfType("canvas")) { const c = leaf.view && leaf.view.canvas; if (!c) continue; for (const n of c.nodes.values()) if (n.nodeEl === el) { file = n.file; break; } if (file) break; } } catch (err) { return; }
      if (!file || file.extension !== "canvas") return;
      clearTimeout(hoverTimer);
      // the hover preview is gone: a canvas card shows the whole canvas itself
      el.addEventListener("mouseleave", hideCanvasPreview, { once: true });
    });
    document.body.addEventListener("wheel", hideCanvasPreview, true);
    document.body.addEventListener("pointerdown", hideCanvasPreview, true);
  };
  if (document.body) watchNestedCanvas(); else document.addEventListener("DOMContentLoaded", watchNestedCanvas);

  // links typed without a scheme get https://
  window.__fpUrl = (u) => { if (typeof u !== "string") return u; const t = u.trim(); if (!t) return u; if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t; if (t.startsWith("//")) return "https:" + t; return "https://" + t; };
  const modalShell = (title) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-container mod-dim";
    wrap.innerHTML = '<div class="modal-bg"></div><div class="modal"><div class="modal-close-button"></div><div class="modal-title"></div><div class="modal-content"></div></div>';
    wrap.querySelector(".modal-title").textContent = title;
    const prev = document.activeElement;
    const close = () => { wrap.remove(); try { prev && prev.focus && prev.focus(); } catch (e) { /* gone */ } };
    wrap.querySelector(".modal-close-button").addEventListener("click", close);
    wrap.querySelector(".modal-bg").addEventListener("click", close);
    wrap.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    document.body.appendChild(wrap);
    return { wrap, body: wrap.querySelector(".modal-content"), close };
  };
  function pickVaultFile(images, cb, ext) {
    const { body, close } = modalShell(ext ? "Выберите холст" : images ? "Выберите картинку" : "Выберите файл");
    const input = document.createElement("input");
    input.type = "text"; input.placeholder = "Начните печатать имя…"; input.style.width = "100%";
    const list = document.createElement("div");
    list.style.cssText = "max-height:340px;overflow:auto;margin-top:8px";
    body.append(input, list);
    const all = app.vault.getFiles().filter((f) => (ext ? f.extension === ext : !images || /^(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.extension)));
    const show = () => {
      const q = input.value.trim().toLowerCase();
      list.textContent = "";
      all.filter((f) => !q || f.path.toLowerCase().includes(q)).slice(0, 80).forEach((f) => {
        const row = document.createElement("div");
        row.className = "suggestion-item"; row.textContent = f.path; row.style.cursor = "pointer"; row.style.padding = "4px 8px";
        row.addEventListener("click", () => { close(); cb(f); });
        list.appendChild(row);
      });
      if (!list.firstChild) list.textContent = "Ничего не найдено";
    };
    input.addEventListener("input", show); show(); input.focus();
  }
  function askUrl(cb) {
    const { body, close } = modalShell("Адрес ссылки");
    const input = document.createElement("input");
    input.type = "text"; input.placeholder = "https://…"; input.style.width = "100%";
    const ok = document.createElement("button"); ok.className = "mod-cta"; ok.textContent = "Добавить"; ok.style.marginTop = "10px";
    const go = () => { const v = input.value.trim(); if (v) { close(); cb(/^[a-z]+:\/\//i.test(v) ? v : "https://" + v); } };
    ok.addEventListener("click", go); input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    body.append(input, ok); input.focus();
  }
  function addCardOfType(canvas, type, at) {
    const size = { width: type.w, height: type.h }, pos = at || (canvas.posCenter ? canvas.posCenter() : { x: 0, y: 0 });
    canvas.deselectAll && canvas.deselectAll();
    if (type.kind === "text") canvas.createTextNode({ pos, size, position: "center", text: type.text });
    else if (type.kind === "link") askUrl((url) => canvas.createLinkNode({ pos, size, position: "center", url }));
    else pickVaultFile(!!type.images, (file) => canvas.createFileNode({ pos, size, position: "center", file }), type.ext);
  }
  // the right-click / drag-to-create menu of an empty spot: the same card types, placed where you clicked
  window.__fpCreationMenu = (menu, canvas, pos) => {
    if (canvas.readonly) return;
    menu.addItem((item) => {
      item.setSection("create").setTitle("Добавить по типу карточки").setIcon("lucide-layout-template");
      const sub = item.setSubmenu();
      for (const t of CARD_TYPES) sub.addItem((i) => i.setTitle(t.name + "  ·  " + t.w + "×" + t.h).onClick(() => addCardOfType(canvas, t, pos)));
    });
  };
  const activeCanvas = () => { const v = app.workspace.activeLeaf && app.workspace.activeLeaf.view; return v && v.getViewType && v.getViewType() === "canvas" ? v.canvas : null; };
  let typeCmds = false;
  window.__fpCardMenu = (menu, canvas) => {
    if (!typeCmds && window.app && app.commands) {
      typeCmds = true;
      app.commands.addCommand({ id: "basalt:present", name: "Холст: презентация по карточкам", checkCallback: (c) => { const cv = activeCanvas(); if (!cv) return false; if (!c) startPresentation(cv); return true; } });
      for (const [id, name] of ALIGNS) app.commands.addCommand({ id: "basalt:align-" + id, name: "Холст: " + name.charAt(0).toLowerCase() + name.slice(1), checkCallback: (c) => { const cv = activeCanvas(); if (!cv || cv.readonly) return false; if (!c) alignCards(cv, id); return true; } });
      for (const l of LAYOUTS) app.commands.addCommand({ id: "basalt:layout-" + l.id, name: "Холст: раскладка — " + l.name, checkCallback: (c) => { const cv = activeCanvas(); if (!cv || cv.readonly) return false; if (!c) runLayout(cv, l); return true; } });
      for (const t of CARD_TYPES) app.commands.addCommand({ id: "basalt:card-" + t.id, name: "Холст: добавить карточку «" + t.name + "»", checkCallback: (c) => { const cv = activeCanvas(); if (!cv || cv.readonly) return false; if (!c) addCardOfType(cv, t); return true; } });
    }
    if (canvas.readonly || menu.querySelector(".fp-types-btn")) return;
    if (!menu.querySelector(".fp-layout-btn")) {
      const lb = menu.createDiv({ cls: "canvas-card-menu-button fp-layout-btn" });
      lb.setAttribute("aria-label", "Авто-раскладка (выбранные карточки или все)");
      lb.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 17.5h7M17.5 14v7"/></svg>';
      let lp = null;
      const closeLp = () => { if (lp) { lp.remove(); lp = null; } };
      lb.addEventListener("click", (e) => {
        e.stopPropagation();
        if (lp) return closeLp();
        lp = document.createElement("div"); lp.className = "fp-types";
        const head = (t) => { const h = document.createElement("div"); h.className = "fp-end-title"; h.textContent = t; h.style.padding = "6px 10px 2px"; lp.appendChild(h); };
        head("Раскладка");
        for (const l of LAYOUTS) { const row = document.createElement("div"); row.className = "fp-type-row"; row.innerHTML = '<span class="fp-type-name"></span>'; row.firstChild.textContent = l.name; row.addEventListener("click", () => { closeLp(); runLayout(canvas, l); }); lp.appendChild(row); }
        head("Показ");
        { const row = document.createElement("div"); row.className = "fp-type-row"; row.innerHTML = '<span class="fp-type-name">Презентация по карточкам</span>'; row.addEventListener("click", () => { closeLp(); startPresentation(canvas); }); lp.appendChild(row); }
        head("Выравнивание выделенных");
        for (const [id, name] of ALIGNS) { const row = document.createElement("div"); row.className = "fp-type-row"; row.innerHTML = '<span class="fp-type-name"></span>'; row.firstChild.textContent = name; row.addEventListener("click", () => { closeLp(); alignCards(canvas, id); }); lp.appendChild(row); }
        document.body.appendChild(lp);
        const r = lb.getBoundingClientRect();
        lp.style.left = Math.max(8, Math.min(window.innerWidth - lp.offsetWidth - 8, r.left + r.width / 2 - lp.offsetWidth / 2)) + "px";
        lp.style.top = Math.max(8, r.top - lp.offsetHeight - 10) + "px";
        const away = (ev) => { if (!lp || lp.contains(ev.target) || lb.contains(ev.target)) return; closeLp(); document.removeEventListener("pointerdown", away, true); };
        document.addEventListener("pointerdown", away, true);
      });
    }
    const btn = menu.createDiv({ cls: "canvas-card-menu-button fp-types-btn" });
    btn.setAttribute("aria-label", "Типы карточек");
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h10l4 5-1 9-5 4H9l-5-4-1-9z"/><path d="M12 8v8M8 12h8"/></svg>';
    let pop = null;
    const closePop = () => { if (pop) { pop.remove(); pop = null; } };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (pop) return closePop();
      pop = document.createElement("div");
      pop.className = "fp-types";
      CARD_TYPES.forEach((t) => {
        const row = document.createElement("div");
        row.className = "fp-type-row";
        const ratio = t.w / t.h, w = ratio >= 1 ? 34 : 34 * ratio, h = ratio >= 1 ? 34 / ratio : 34;
        row.innerHTML = `<span class="fp-type-ico"><i style="width:${w.toFixed(0)}px;height:${h.toFixed(0)}px"></i></span><span class="fp-type-name"></span><small>${t.w}×${t.h}</small>`;
        row.querySelector(".fp-type-name").textContent = t.name;
        row.addEventListener("click", () => { closePop(); addCardOfType(canvas, t); });
        pop.appendChild(row);
      });
      document.body.appendChild(pop);
      const r = btn.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left + r.width / 2 - pop.offsetWidth / 2)) + "px";
      pop.style.top = Math.max(8, r.top - pop.offsetHeight - 10) + "px";
      const away = (ev) => { if (!pop || pop.contains(ev.target) || btn.contains(ev.target)) return; closePop(); document.removeEventListener("pointerdown", away, true); };
      document.addEventListener("pointerdown", away, true);
    });
  };

  window.__fpEditPath = (c, edges, what) => editPath(c, edges, what);
  // holding Ctrl shows the dots that add a point
  const ctrlClass = (on) => document.querySelectorAll(".canvas-wrapper").forEach((w) => w.classList.toggle("fp-ctrl", on));
  window.addEventListener("keydown", (e) => { if (e.key === "Control" || e.key === "Meta") ctrlClass(true); }, true);
  window.addEventListener("keyup", (e) => { if (e.key === "Control" || e.key === "Meta") ctrlClass(false); }, true);
  window.addEventListener("blur", () => ctrlClass(false));
  // Typing inside a card that is not a note editor (the terminal, inputs, our own cards): the canvas hotkeys (arrows move
  // the selected card, Delete removes it...) must not see the keys. An empty scope on top of the key map hides them.
  {
    let muted = null;
    const release = () => { if (muted) { try { app.keymap.popScope(muted); } catch (e) { /* gone */ } muted = null; } };
    document.addEventListener("focusin", (e) => {
      const t = e.target;
      const typing = t && t.closest && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && t.closest(".canvas-node") && !t.closest(".cm-editor");
      if (typing) { if (!muted && window.app && app.keymap && app.scope) { muted = new app.scope.constructor(); app.keymap.pushScope(muted); } }
      else release();
    }, true);
    // a card removed while it had the focus sends no focusout: any click outside a card gives the keys back
    document.addEventListener("pointerdown", (e) => { if (muted && !(e.target.closest && e.target.closest(".canvas-node"))) release(); }, true);
    document.addEventListener("focusout", () => setTimeout(() => { const t = document.activeElement; if (!t || !t.closest || !t.closest(".canvas-node")) release(); }, 0), true);
  }
  // Text typed into a card has its own history (the editor's): while a card is being edited Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z act on the text only,
  // never on the board. Once editing ends the board's own undo goes on from where it was.
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = (e.code || "").toLowerCase(), undo = k === "keyz" && !e.shiftKey, redo = k === "keyy" || (k === "keyz" && e.shiftKey);
    if (!undo && !redo) return;
    const cv = activeCanvas(); if (!cv) return;
    const n = Array.from(cv.nodes.values()).find((x) => x.isEditing && x.child);
    if (!n) return;
    const ed = n.child.editor || (n.child.editMode && n.child.editMode.editor); if (!ed) return;
    e.preventDefault(); e.stopImmediatePropagation();
    try { undo ? ed.undo() : ed.redo(); } catch (err) { /* editor gone */ }
  }, true);
  // safety net: if the canvas did not handle Ctrl+Z / Ctrl+Y itself (focus on a toolbar, a closed menu...), do it here
  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = (e.code || "").toLowerCase();
    if (k !== "keyz" && k !== "keyy") return;
    const ae = document.activeElement;
    if (ae && (ae.isContentEditable || /^(input|textarea|select)$/i.test(ae.tagName))) return;
    const cv = activeCanvas(); if (!cv || cv.readonly) return;
    e.preventDefault();
    if (k === "keyy" || e.shiftKey) cv.redo(); else cv.undo();
  });

  window.__fpState = (canvas) => states.get(canvas);

  // Called from the canvas plugin's settings tab (patched into app.js).
  window.__fpSettings = (containerEl, options, plugin, instance, Setting) => {
    const apply = () => {
      plugin.saveData(options);
      document.querySelectorAll(".canvas-wrapper").forEach(() => {});
      if (instance && instance.rerenderCanvases) instance.rerenderCanvases();
      for (const leaf of app.workspace.getLeavesOfType("canvas")) {
        const c = leaf.view && leaf.view.canvas;
        const st = c && states.get(c);
        if (st) { st.needPick = true; st.dirty = true; for (const e of c.edges.values()) c.markDirty && c.markDirty(e); c.viewportChanged = true; c.requestFrame(); }
      }
    };
    const get = (k) => (Number.isFinite(options[k]) ? options[k] : DEFAULTS[k]);
    const live = [];
    const head = (t, d) => { const h = containerEl.createEl("h3", { text: t }); if (d) containerEl.createEl("p", { cls: "setting-item-description", text: d }); return h; };
    const manualOnly = (s) => { live.push(s.settingEl); return s; };
    const autoOnly = (s) => { live.push(s.settingEl); s.settingEl.dataset.fpAuto = "1"; return s; };
    const refresh = () => {
      const auto = (options.fpDomMode || DEFAULTS.fpDomMode) === "auto";
      for (const el of live) {
        const isAuto = el.dataset.fpAuto === "1";
        el.style.display = isAuto === auto ? "" : "none";
      }
    };
    const slider = (s, k, lo, hi, step) => s.addSlider((x) => x.setLimits(lo, hi, step).setDynamicTooltip().setValue(get(k)).onChange((v) => { options[k] = v; apply(); }));

    head("Гибридный рендер (falconplot)");
    new Setting(containerEl)
      .setName("Включить движок falconplot")
      .setDesc("Сетку, связи и далёкие карточки рисует WASM-движок. Если выключить, холст работает как обычный.")
      .addToggle((t) => t.setValue(options.fpHybrid !== false).onChange((v) => { options.fpHybrid = v; apply(); }));

    head("Прорисовка содержимого карточек (DOM)", "Настоящее содержимое (текст, встраивания) тяжёлое: его получают только карточки в пределах бюджета. Остальные рисует движок.");
    new Setting(containerEl)
      .setName("Режим")
      .setDesc("Авто: бюджет сам подстраивается под скорость кадров. Вручную: все значения задаёте вы.")
      .addDropdown((d) => d.addOption("auto", "Авто").addOption("manual", "Вручную").setValue(options.fpDomMode || DEFAULTS.fpDomMode).onChange((v) => { options.fpDomMode = v; refresh(); apply(); }));

    const status = new Setting(containerEl).setName("Сейчас").setDesc("Откройте холст, чтобы увидеть.");
    autoOnly(status);
    const tick = () => {
      if (!containerEl.isConnected) return;
      const c = (app.workspace.getLeavesOfType("canvas").map((l) => l.view && l.view.canvas).find(Boolean));
      const st = c && states.get(c);
      if (st) status.setDesc(`Карточек с содержимым: ${st.domSet.size} из бюджета ${Math.round(st.effBudget || 0)}. Кадр при движении: ${st.autoAvg ? st.autoAvg.toFixed(1) + " мс" : "ещё не измерялся"}.`);
      setTimeout(tick, 700);
    };
    tick();
    slider(autoOnly(new Setting(containerEl).setName("Целевое время кадра, мс").setDesc("Движок держит кадр около этого значения. 16 — плавно (60 к/с), 33 — допустимо (30 к/с). Меньше — меньше карточек с содержимым.")), "fpAutoTargetMs", 12, 50, 1);
    slider(autoOnly(new Setting(containerEl).setName("Минимум карточек с содержимым").setDesc("Ниже этого авто-режим бюджет не опустит.")), "fpAutoMin", 5, 100, 5);
    slider(autoOnly(new Setting(containerEl).setName("Максимум карточек с содержимым").setDesc("Выше этого авто-режим бюджет не поднимет.")), "fpAutoMax", 50, 600, 10);

    slider(manualOnly(new Setting(containerEl).setName("Карточек с содержимым").setDesc("Если карточек на экране меньше, содержимое видно у всех. Остальные рисует движок.")), "fpDomBudget", 10, 600, 10);
    slider(manualOnly(new Setting(containerEl).setName("Минимальная ширина карточки, px").setDesc("Карточки уже этого размера на экране содержимого не получают. Ниже порога масштаба Basalt («Масштаб, при котором скрывается содержимое») оно не показывается вообще.")), "fpMinDomPx", 10, 200, 5);
    slider(manualOnly(new Setting(containerEl).setName("Масштаб, с которого связи настоящие (DOM)").setDesc("Выше этого масштаба связи можно выделять мышью; ниже их рисует движок и они не выбираются, зато работает быстрее.")), "fpEdgeDomScale", 0.05, 1, 0.01);
    manualOnly(new Setting(containerEl).setName("Прятать DOM при изменении масштаба").setDesc("На время зума всё рисует движок, содержимое возвращается после остановки. Выключите, чтобы карточки не мигали, но зум станет тяжелее.")
      .addToggle((t) => t.setValue(options.fpHideDomOnZoom !== false).onChange((v) => { options.fpHideDomOnZoom = v; apply(); })));
    slider(manualOnly(new Setting(containerEl).setName("Пауза после зума, мс").setDesc("Через сколько после остановки зума содержимое возвращается.")), "fpSettleMs", 0, 600, 10);
    slider(new Setting(containerEl).setName("Шаг сетки, px").setDesc("Расстояние между точками сетки при обычном масштабе. По ней же работает «Привязка к сетке» на панели справа."), "fpGridStep", 5, 80, 5);
    slider(new Setting(containerEl).setName("Расстояние привязки к карточкам, px").setDesc("Как близко (на экране) карточка должна подойти к другой, чтобы «примагнититься» краем или центром. Включается кнопкой «Привязка к объектам» справа."), "fpSnapDist", 2, 30, 1);
    new Setting(containerEl)
      .setName("Мини-карта")
      .setDesc("Обзор всего холста в углу: карточки блоками, видимая область рамкой. Клик или перетаскивание по ней двигает вид.")
      .addToggle((t) => t.setValue(options.fpMinimap !== false).onChange((v) => { options.fpMinimap = v; apply(); }));
    slider(new Setting(containerEl).setName("Размер мини-карты, px").setDesc("Ширина."), "fpMinimapSize", 140, 400, 10);
    new Setting(containerEl)
      .setName("Форма новых карточек")
      .setDesc("Контур карточек из дизайна Basalt: срезанные грани, как у базальтовых колонн. Меняет и цвета карточек на тёплую палитру.")
      .addDropdown((d) => d.addOption("0", "Обычная (скруглённая)").addOption("1", "Грань").addOption("2", "Базальт").addOption("3", "Скол").addOption("4", "Кристалл").setValue(String(Number.isFinite(options.fpShape) ? options.fpShape : DEFAULTS.fpShape)).onChange((v) => { options.fpShape = +v; apply(); }));
    new Setting(containerEl)
      .setName("Настоящий текст на далёких карточках")
      .setDesc("Карточки, которые рисует движок, показывают заголовок и первую строку вместо серых полосок. Стоит ~1–2 мс на кадр и не больше 200 карточек за раз.")
      .addToggle((t) => t.setValue(options.fpFarText !== false).onChange((v) => { options.fpFarText = v; apply(); }));
    slider(manualOnly(new Setting(containerEl).setName("Минимальная ширина для текста, px").setDesc("Уже этого размера на экране остаются полоски: текст всё равно не прочитать.")), "fpFarTextPx", 30, 200, 2);
    refresh();
  };

  window.__fpView = (canvas, cx, cy, scale, vw, vh) => {
    if (!ex) return;
    const st = ensure(canvas);
    setEnabled(canvas, st, opts(canvas).hybrid);
    if (!st.on) return;
    st.view = { cx, cy, scale, vw, vh };
    if (canvas.screenshotting) return;
    const o = opts(canvas);
    if (o.auto) autoTune(st, o, performance.now());
    if (o.hideOnZoom && st.lastScale !== undefined && Math.abs(scale - st.lastScale) > 1e-9) {
      if (!st.zooming) {
        st.zooming = true;
        canvas.canvasEl.style.visibility = "hidden";
      }
      clearTimeout(st.zoomTimer);
      st.zoomTimer = setTimeout(() => endZoom(canvas, st), o.auto ? DEFAULTS.fpSettleMs : o.settleMs);
    }
    st.lastScale = scale;
    if (st.dirty) { sync(canvas, st); st.dirty = false; }
    draw(canvas, st);
  };

  window.__fpFrame = (canvas, changed) => {
    if (!ex) return;
    const st = ensure(canvas);
    if (window.__bsInkFrame) { try { const r = canvas.canvasRect; window.__bsInkFrame(canvas, st.view || { cx: canvas.x, cy: canvas.y, scale: canvas.scale, vw: r.width, vh: r.height }); } catch (e) { /* no ink */ } }
    setEnabled(canvas, st, opts(canvas).hybrid);
    if (!st.on || canvas.screenshotting) return;
    if (!st.view) {
      const r = canvas.canvasRect;
      st.view = { cx: canvas.x, cy: canvas.y, scale: canvas.scale, vw: r.width, vh: r.height };
    }
    if (st.dirty || changed) {
      sync(canvas, st); st.dirty = false;
      draw(canvas, st);
    }
    if (!st.zooming) {
      applyFar(canvas, st);
      if (st.domPick && pushDomFlags(st)) draw(canvas, st);
      if (st.unready > 0 && !st.pollTimer) {
        st.pollTimer = setTimeout(() => { st.pollTimer = 0; canvas.requestFrame(); }, 90);
      }
    }
  };
})();
