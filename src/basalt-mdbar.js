// Basalt: a status bar and a minimap for notes (markdown editor), like the ones of the text-file editor.
//   bottom: line ending, encoding, language, words, caret position;  right: a small overview of the whole note with the visible part marked.
(() => {
  "use strict";
  const css = document.createElement("style");
  css.textContent = `
    .bmd-has { position: relative; }
    .bmd-has > .markdown-source-view, .bmd-has > .markdown-reading-view { box-sizing: border-box; }
    .bmd-has.bmd-on > .markdown-source-view { padding-right: 92px; padding-bottom: 24px; }
    .bmd-mini { position: absolute; top: 0; right: 0; bottom: 24px; width: 92px; background: var(--background-primary); border-left: 1px solid var(--background-modifier-border); cursor: pointer; overflow: hidden; z-index: 3; }
    .bmd-mini canvas { display: block; width: 100%; height: 100%; }
    .bmd-slider { position: absolute; left: 0; right: 0; background: rgba(128,128,128,.22); pointer-events: none; }
    .bmd-mini:hover .bmd-slider { background: rgba(128,128,128,.34); }
    .bmd-status { position: absolute; left: 0; right: 0; bottom: 0; height: 24px; display: flex; align-items: center; gap: 4px; padding: 0 10px; font-size: 12px; color: var(--text-faint); background: var(--background-primary); border-top: 1px solid var(--background-modifier-border); z-index: 4; }
    .bmd-status > span { padding: 0 8px; }
    .bmd-status .sp { margin-left: auto; }
  `;
  document.head.appendChild(css);

  const states = new WeakMap();
  const cmOf = (leaf) => { try { return leaf.view.editor && leaf.view.editor.cm; } catch (e) { return null; } };

  function build(leaf) {
    const host = leaf.view.contentEl || leaf.view.containerEl.querySelector(".view-content");
    if (!host) return null;
    const mini = document.createElement("div"); mini.className = "bmd-mini";
    const cv = document.createElement("canvas"); const slider = document.createElement("div"); slider.className = "bmd-slider"; mini.append(cv, slider);
    const status = document.createElement("div"); status.className = "bmd-status";
    const mk = (t) => { const s = document.createElement("span"); s.textContent = t; status.appendChild(s); return s; };
    const eol = mk("LF"), enc = mk("UTF-8"), lang = mk("Markdown"), sp = document.createElement("span"); sp.className = "sp"; status.appendChild(sp);
    const words = mk(""), pos = mk("");
    host.classList.add("bmd-has"); host.append(mini, status);
    const st = { leaf, host, mini, status, cv, slider, eol, words, pos, raf: 0, last: "" };
    const scrollTo = (clientY) => {
      const cm = cmOf(leaf); if (!cm) return; const r = mini.getBoundingClientRect(), sd = cm.scrollDOM;
      const frac = Math.max(0, Math.min(1, (clientY - r.top) / Math.max(1, r.height)));
      sd.scrollTop = frac * sd.scrollHeight - sd.clientHeight / 2;
    };
    let drag = false;
    mini.addEventListener("pointerdown", (e) => { drag = true; mini.setPointerCapture(e.pointerId); scrollTo(e.clientY); });
    mini.addEventListener("pointermove", (e) => { if (drag) scrollTo(e.clientY); });
    mini.addEventListener("pointerup", () => { drag = false; });
    return st;
  }

  function sync(leaf) {
    const v = leaf.view;
    if (!v || v.getViewType() !== "markdown" || !v.file) return;
    let st = states.get(leaf);
    const sourceMode = v.getMode && v.getMode() === "source";
    if (!st) { st = build(leaf); if (!st) return; states.set(leaf, st); }
    st.host.classList.toggle("bmd-on", !!sourceMode);
    st.mini.style.display = sourceMode ? "" : "none";
    st.status.style.display = sourceMode ? "" : "none";
    if (sourceMode) schedule(st);
  }

  function schedule(st) {
    if (st.raf) return;
    st.raf = requestAnimationFrame(() => { st.raf = 0; draw(st); });
  }

  function draw(st) {
    const cm = cmOf(st.leaf); if (!cm || !st.host.isConnected) return;
    const doc = cm.state.doc, sd = cm.scrollDOM, text = doc.toString();
    const head = cm.state.selection.main.head, line = doc.lineAt(head);
    st.pos.textContent = "Стр. " + line.number + ", стлб. " + (head - line.from + 1);
    st.words.textContent = "Слов: " + (text.trim() ? text.trim().split(/\s+/).length : 0);
    st.eol.textContent = text.indexOf("\r\n") >= 0 ? "CRLF" : "LF";
    const W = 92, H = st.mini.clientHeight; if (H < 10) return;
    const d = window.devicePixelRatio || 1, cv = st.cv;
    if (cv.width !== W * d || cv.height !== H * d) { cv.width = W * d; cv.height = H * d; }
    const ctx = cv.getContext("2d"); ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, W, H);
    const n = doc.lines, rowH = Math.max(1, Math.min(2, H / Math.max(1, n))), muted = getComputedStyle(st.host).getPropertyValue("--text-faint").trim() || "#888", bright = getComputedStyle(st.host).getPropertyValue("--text-muted").trim() || "#bbb";
    const step = Math.max(1, Math.ceil(n * rowH / H));
    for (let i = 1; i <= n; i += step) {
      const l = doc.line(i), t = l.text; if (!t.trim()) continue;
      const y = (i - 1) * rowH * (H / Math.max(H, n * rowH)) ;
      ctx.fillStyle = /^#{1,6}\s/.test(t) ? bright : muted;
      ctx.globalAlpha = /^#{1,6}\s/.test(t) ? 0.95 : 0.55;
      ctx.fillRect(4, Math.min(H - 1, (i - 1) * Math.min(rowH, H / n)), Math.max(2, Math.min(W - 8, t.length * 0.7)), Math.max(1, rowH - 0.5));
    }
    ctx.globalAlpha = 1;
    const total = Math.max(sd.scrollHeight, 1);
    st.slider.style.top = (sd.scrollTop / total) * H + "px";
    st.slider.style.height = Math.max(8, (sd.clientHeight / total) * H) + "px";
    const hook = st.hooked; if (hook !== sd) { st.hooked = sd; sd.addEventListener("scroll", () => schedule(st), { passive: true }); }
  }

  function all() { app.workspace.getLeavesOfType("markdown").forEach(sync); }
  const t = setInterval(() => {
    if (!(window.app && app.workspace && app.workspace.layoutReady)) return;
    clearInterval(t);
    for (const ev of ["active-leaf-change", "layout-change", "file-open", "editor-change"]) app.workspace.on(ev, () => { setTimeout(all, 50); });
    setInterval(all, 1500);
    all();
  }, 400);
})();
