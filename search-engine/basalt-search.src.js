// Basalt quick search: every note and canvas of the vault in a Rust/WASM index (BM25, prefix and typo tolerant).
// Command "Быстрый поиск" (Ctrl+Shift+O): type, arrows to choose, Enter to open, Ctrl+Enter for a new tab.
// Filters in the query: path:folder  file:name  tag:#tag  ext:canvas
(() => {
  "use strict";
  const WASM_B64 = "__WASM_B64__";
  const b64 = (s) => { const t = atob(s), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
  let se = null;
  const ready = WebAssembly.instantiate(b64(WASM_B64), {}).then((r) => { se = r.instance.exports; }).catch((e) => console.error("[bs-search] wasm failed", e));
  const enc = new TextEncoder();
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const docs = []; const idOf = new Map(); // id -> { path, title, text, file }
  const stat = { total: 0, done: 0, building: false };

  const css = document.createElement("style");
  css.textContent = `
    .bss-wrap { position: fixed; inset: 0; z-index: 1100; background: rgba(0,0,0,.45); display: flex; justify-content: center; align-items: flex-start; padding-top: 11vh; }
    .bss { width: min(760px, 94vw); max-height: 74vh; display: flex; flex-direction: column; background: var(--background-secondary); color: var(--text-normal);
      clip-path: polygon(16px 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%, 0 16px); }
    .bss-in { display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: 1px solid var(--background-modifier-border); }
    .bss-in svg { width: 18px; height: 18px; color: var(--text-muted); flex: none; }
    .bss-in input { flex: 1; border: 0; background: transparent; box-shadow: none; font-size: 17px; color: var(--text-normal); padding: 4px 0; height: auto; }
    .bss-hint { padding: 6px 18px; font-size: var(--font-ui-smaller); color: var(--text-faint); border-bottom: 1px solid var(--background-modifier-border); }
    .bss-list { overflow: auto; flex: 1; padding: 4px 0; min-height: 60px; }
    .bss-item { padding: 8px 18px; cursor: pointer; border-left: 3px solid transparent; }
    .bss-item.is-sel { background: var(--background-modifier-hover); border-left-color: var(--interactive-accent); }
    .bss-t { font-weight: 600; } .bss-t small { color: var(--text-faint); font-weight: 400; margin-left: 8px; }
    .bss-s { color: var(--text-muted); font-size: var(--font-ui-small); margin-top: 2px; line-height: 1.45; word-break: break-word; }
    .bss mark { background: color-mix(in srgb, var(--interactive-accent) 30%, transparent); color: inherit; padding: 0 1px; }
    .bss-foot { display: flex; justify-content: space-between; padding: 6px 18px; font-size: var(--font-ui-smaller); color: var(--text-faint); border-top: 1px solid var(--background-modifier-border); }
    .bss-empty { padding: 22px 18px; color: var(--text-muted); }
  `;
  document.head.appendChild(css);

  // ---------------------------------------------------------------- the index
  function put(id, d) {
    const bytes = enc.encode(d.title + "\u0001" + d.path + "\u0001" + d.text);
    const ptr = se.se_buf(bytes.length); // the call may grow the memory: take the buffer after it
    new Uint8Array(se.memory.buffer, ptr, bytes.length).set(bytes);
    se.se_add(id, bytes.length);
  }
  async function readText(f) {
    try {
      const raw = await app.vault.cachedRead(f);
      if (f.extension === "canvas") { const j = JSON.parse(raw); return (j.nodes || []).map((n) => (n.type === "text" ? n.text : n.type === "file" ? n.file : n.type === "link" ? n.url : n.label || "")).join("\n"); }
      return raw;
    } catch (e) { return ""; }
  }
  async function indexFile(f) {
    if (!se || !(f.extension === "md" || f.extension === "canvas")) return;
    let id = idOf.get(f.path);
    if (id === undefined) { id = docs.length; idOf.set(f.path, id); docs.push(null); }
    const text = await readText(f);
    docs[id] = { path: f.path, title: f.basename, text, file: f };
    put(id, docs[id]);
  }
  async function buildAll() {
    await ready; if (!se || stat.building) return;
    stat.building = true; se.se_clear(); docs.length = 0; idOf.clear();
    const files = app.vault.getFiles().filter((f) => f.extension === "md" || f.extension === "canvas");
    stat.total = files.length; stat.done = 0;
    for (let i = 0; i < files.length; i += 24) {
      await Promise.all(files.slice(i, i + 24).map(indexFile));
      stat.done = Math.min(files.length, i + 24);
      await new Promise((r) => setTimeout(r, 0)); // let the UI breathe
      if (window.__bssOnProgress) window.__bssOnProgress();
    }
    stat.building = false;
    if (window.__bssOnProgress) window.__bssOnProgress();
  }
  function watch() {
    const v = app.vault, again = new Map();
    const touch = (f) => { if (!f || !f.path) return; clearTimeout(again.get(f.path)); again.set(f.path, setTimeout(() => indexFile(f), 400)); };
    v.on("modify", touch); v.on("create", touch);
    v.on("delete", (f) => { const id = idOf.get(f.path); if (id !== undefined && se) { se.se_remove(id); docs[id] = null; idOf.delete(f.path); } });
    v.on("rename", (f, old) => { const id = idOf.get(old); if (id !== undefined && se) { se.se_remove(id); docs[id] = null; idOf.delete(old); } touch(f); });
  }

  // ---------------------------------------------------------------- querying
  function parse(q) {
    const f = { path: [], file: [], tag: [], ext: [] }, words = [];
    for (const tok of q.trim().split(/\s+/).filter(Boolean)) {
      const m = /^(path|file|tag|ext):(.*)$/i.exec(tok);
      if (m && m[2]) f[m[1].toLowerCase()].push(m[2].toLowerCase().replace(/^#/, "")); else words.push(tok);
    }
    return { text: words.join(" "), f };
  }
  function passes(d, f) {
    if (!d) return false;
    const p = d.path.toLowerCase(), n = d.title.toLowerCase();
    if (f.path.some((x) => !p.includes(x)) || f.file.some((x) => !n.includes(x))) return false;
    if (f.ext.some((x) => d.file.extension !== x)) return false;
    if (f.tag.length) { const c = app.metadataCache.getFileCache(d.file); const tags = ((c && c.tags) || []).map((t) => t.tag.toLowerCase().replace(/^#/, "")).concat([].concat((c && c.frontmatter && c.frontmatter.tags) || []).map((t) => String(t).toLowerCase())); if (f.tag.some((x) => !tags.some((t) => t.startsWith(x)))) return false; }
    return true;
  }
  function run(q, limit = 40) {
    const { text, f } = parse(q);
    const hasF = f.path.length || f.file.length || f.tag.length || f.ext.length;
    if (!text) {
      if (!hasF) return [];
      return docs.filter((d) => passes(d, f)).sort((a, b) => (b.file.stat ? b.file.stat.mtime : 0) - (a.file.stat ? a.file.stat.mtime : 0)).slice(0, limit).map((d) => ({ d, pos: -1, score: 0 }));
    }
    const bytes = enc.encode(text);
    const ptr = se.se_buf(bytes.length);
    new Uint8Array(se.memory.buffer, ptr, bytes.length).set(bytes);
    const n = se.se_search(bytes.length, hasF ? 400 : limit);
    const out = new Uint32Array(se.memory.buffer, se.se_out(), n * 3), res = [];
    for (let i = 0; i < n && res.length < limit; i++) { const d = docs[out[i * 3]]; if (d && passes(d, f)) res.push({ d, score: out[i * 3 + 1] / 1000, pos: out[i * 3 + 2] === 0xffffffff ? -1 : out[i * 3 + 2] }); }
    return res;
  }
  function snippet(d, pos, words) {
    const t = d.text; let a = 0, b = Math.min(t.length, 170);
    if (pos >= 0) { a = Math.max(0, pos - 60); b = Math.min(t.length, pos + 120); }
    let s = esc(t.slice(a, b).replace(/\s+/g, " "));
    for (const w of words) if (w.length > 1) s = s.replace(new RegExp("(" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig"), "<mark>$1</mark>");
    return (a > 0 ? "…" : "") + s + (b < t.length ? "…" : "");
  }
  const mark = (txt, words) => { let s = esc(txt); for (const w of words) if (w.length > 1) s = s.replace(new RegExp("(" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig"), "<mark>$1</mark>"); return s; };


  // ---------------------------------------------------------------- show the hit where it is: a canvas flies to the matching cards, a note scrolls to the match
  const pulseCss = document.createElement("style");
  pulseCss.textContent = "@keyframes bs-pulse{0%{box-shadow:0 0 0 0 var(--interactive-accent)}40%{box-shadow:0 0 0 14px color-mix(in srgb,var(--interactive-accent) 35%,transparent)}100%{box-shadow:0 0 0 0 transparent}}.canvas-node.bs-hit .canvas-node-container{animation:bs-pulse 1s ease-out 3;outline:2px solid var(--interactive-accent)}";
  document.head.appendChild(pulseCss);
  const cardText = (n) => { const d = n.getData ? n.getData() : n; return String(d.type === "text" ? d.text : d.type === "file" ? d.file : d.type === "link" ? d.url : d.label || "").toLowerCase(); };
  async function reveal(leaf, words) {
    if (!words || !words.length || !leaf) return;
    const view = leaf.view;
    for (let i = 0; i < 40 && !(view && (view.canvas || view.editor)); i++) await new Promise((r) => setTimeout(r, 75));
    const any = (t) => words.some((w) => t.includes(w));
    if (view.canvas) {
      const c = view.canvas;
      for (let i = 0; i < 40 && !c.nodes.size; i++) await new Promise((r) => setTimeout(r, 75));
      const hit = Array.from(c.nodes.values()).filter((n) => any(cardText(n)));
      if (!hit.length) return;
      c.updateSelection(() => { c.selection.clear(); hit.forEach((n) => c.selection.add(n)); });
      const bb = hit.reduce((b, n) => ({ minX: Math.min(b.minX, n.x), minY: Math.min(b.minY, n.y), maxX: Math.max(b.maxX, n.x + n.width), maxY: Math.max(b.maxY, n.y + n.height) }), { minX: 1e12, minY: 1e12, maxX: -1e12, maxY: -1e12 });
      const pad = 80; c.zoomToBbox({ minX: bb.minX - pad, minY: bb.minY - pad, maxX: bb.maxX + pad, maxY: bb.maxY + pad });
      setTimeout(() => { hit.forEach((n) => { n.nodeEl && n.nodeEl.classList.add("bs-hit"); }); setTimeout(() => hit.forEach((n) => n.nodeEl && n.nodeEl.classList.remove("bs-hit")), 3200); }, 350);
    } else if (view.editor) {
      const ed = view.editor, text = ed.getValue().toLowerCase();
      let at = -1, len = 0;
      for (const w of words) { const i = text.indexOf(w); if (i >= 0 && (at < 0 || i < at)) { at = i; len = w.length; } }
      if (at < 0) return;
      const from = ed.offsetToPos(at), to = ed.offsetToPos(at + len);
      ed.setSelection(from, to); ed.scrollIntoView({ from, to }, true);
    }
  }
  window.__bsReveal = reveal;
  // the stock search panel: remember its query when a result is clicked, and reveal once the file is open
  document.addEventListener("click", (e) => {
    const el = e.target && e.target.closest && e.target.closest(".search-result-file-match, .search-result-file-title");
    if (!el) return;
    const inp = document.querySelector(".search-input-container input"); const q = inp ? inp.value : "";
    const words = parse(q).text.toLowerCase().split(/\s+/).filter((x) => x.length > 1);
    if (words.length) setTimeout(() => reveal(app.workspace.activeLeaf || app.workspace.getMostRecentLeaf(), words), 250);
  }, true);

  // for the local API: the same index, plain results
  window.__bsSearchApi = (q, limit) => { const words = parse(q).text.toLowerCase().split(/\s+/).filter(Boolean); return run(q, limit || 20).map((r) => ({ path: r.d.path, title: r.d.title, score: r.score, snippet: snippet(r.d, r.pos, words).replace(/<[^>]+>/g, "") })); };

  // ---------------------------------------------------------------- the overlay
  let open = null;
  function show(initial) {
    if (open) { open.input.focus(); return; }
    const wrap = document.createElement("div"); wrap.className = "bss-wrap";
    wrap.innerHTML = '<div class="bss"><div class="bss-in"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input type="text" spellcheck="false" placeholder="Искать по заметкам и холстам…"></div><div class="bss-hint">path:папка · file:имя · tag:#метка · ext:canvas</div><div class="bss-list"></div><div class="bss-foot"><span class="bss-st"></span><span>↑↓ выбрать · Enter открыть · Ctrl+Enter в новой вкладке · Esc закрыть</span></div></div>';
    const input = wrap.querySelector("input"), list = wrap.querySelector(".bss-list"), st = wrap.querySelector(".bss-st");
    const prev = document.activeElement; let results = [], sel = 0;
    const close = () => { wrap.remove(); open = null; window.__bssOnProgress = null; try { prev && prev.focus && prev.focus(); } catch (e) { /* gone */ } };
    const openRes = (r, newTab) => { if (!r) return; const w = parse(input.value).text.toLowerCase().split(/\s+/).filter((x) => x.length > 1); close(); const leaf = app.workspace.getLeaf(newTab ? "tab" : false); leaf.openFile(r.d.file).then(() => reveal(leaf, w)); };
    const render = () => {
      const q = input.value, words = parse(q).text.toLowerCase().split(/\s+/).filter(Boolean);
      const t0 = performance.now();
      if (!q.trim()) {
        const recent = (app.workspace.getLastOpenFiles ? app.workspace.getLastOpenFiles() : []).map((p) => docs[idOf.get(p)]).filter(Boolean).slice(0, 12);
        results = recent.map((d) => ({ d, pos: -1, score: 0 })); st.textContent = recent.length ? "Недавние" : "";
      } else if (se) { results = run(q); st.textContent = `${results.length} за ${(performance.now() - t0).toFixed(1)} мс` + (stat.building ? ` · индексация ${stat.done}/${stat.total}` : ""); }
      sel = Math.min(sel, Math.max(0, results.length - 1));
      list.textContent = "";
      if (!results.length) { const e = document.createElement("div"); e.className = "bss-empty"; e.textContent = q.trim() ? (stat.building ? "Индекс ещё строится…" : "Ничего не найдено") : "Начните печатать. Находит с опечатками и по началу слова."; list.appendChild(e); return; }
      results.forEach((r, i) => {
        const el = document.createElement("div"); el.className = "bss-item" + (i === sel ? " is-sel" : "");
        el.innerHTML = `<div class="bss-t">${mark(r.d.title, words)}<small>${esc(r.d.path)}</small></div><div class="bss-s">${snippet(r.d, r.pos, words)}</div>`;
        el.addEventListener("click", (e) => openRes(r, e.ctrlKey || e.metaKey)); el.addEventListener("mousemove", () => { if (sel !== i) { sel = i; list.querySelectorAll(".bss-item").forEach((x, k) => x.classList.toggle("is-sel", k === i)); } });
        list.appendChild(el);
      });
    };
    input.addEventListener("input", () => { sel = 0; render(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); } else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); }
      else if (e.key === "Enter") { e.preventDefault(); openRes(results[sel], e.ctrlKey || e.metaKey); return; } else if (e.key === "Escape") { e.preventDefault(); close(); return; } else return;
      list.querySelectorAll(".bss-item").forEach((x, k) => { x.classList.toggle("is-sel", k === sel); if (k === sel) x.scrollIntoView({ block: "nearest" }); });
    });
    wrap.addEventListener("pointerdown", (e) => { if (e.target === wrap) close(); });
    window.__bssOnProgress = () => { if (open && input.value.trim()) render(); };
    document.body.appendChild(wrap); open = { input, close };
    input.value = initial || ""; input.focus(); render();
  }

  // ---------------------------------------------------------------- registration
  let done = false;
  const register = () => {
    if (done || !window.app || !app.commands || !app.vault || !app.workspace) return false;
    done = true;
    app.commands.addCommand({ id: "basalt:quick-search", name: "Быстрый поиск", hotkeys: [{ modifiers: ["Mod", "Shift"], key: "o" }], callback: () => show() });
    app.commands.addCommand({ id: "basalt:quick-search-rebuild", name: "Быстрый поиск: пересобрать индекс", callback: () => buildAll() });
    app.workspace.onLayoutReady(() => { buildAll().then(watch); });
    return true;
  };
  let tries = 0;
  const timer = setInterval(() => { try { if (register() || ++tries > 120) clearInterval(timer); } catch (e) { console.error("[bs-search]", e); if (++tries > 120) clearInterval(timer); } }, 1000);
  window.__bsSearch = { run, show, buildAll, stat, docs };
})();
