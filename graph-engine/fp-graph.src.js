// Basalt graph, on falconplot's own engine (graph-engine/src/lib.rs -> WASM): the force layout (Barnes-Hut), picking, camera and the
// 2D / 3D drawing run in Rust; this file only feeds it the vault, forwards the pointer and replays the returned draw commands on a canvas.
// Replaces the stock "graph" and "localgraph" views. Needs window.__bsApi.ItemView (exported by the app patch).
(() => {
  "use strict";
  const mainLeaf = (newTab) => { const ws = app.workspace; let l = newTab ? null : ws.getMostRecentLeaf(ws.rootSplit); if (!l || l.getRoot() !== ws.rootSplit) l = ws.getLeaf("tab"); return l; }; /* a file opens in the main area, never in a side panel that happens to be focused */

  const KEY = "basalt-graph-engine-v1";
  const CFG0 = { view: "2d", orphans: true, unresolved: false, canvases: true, images: true, thumbImg: true, thumbCanvas: true, labelMode: "auto", labels: true, nodeScale: 1, edgeAlpha: 0.5, repulsion: 900, linkDistance: 34, linkStrength: 0.7, localDepth: 2, maxNodes: 4000, colorBy: "kind", edgeStyle: "curve", arrows: false, boards: true, tagNodes: false, legend: true, folderOnly: "", tagOnly: "", recent: 0 };
  const load = () => { try { return Object.assign({}, CFG0, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { return Object.assign({}, CFG0); } };
  const save = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* private mode */ } };

  // ---------------------------------------------------------------- groups and hidden notes (kept in the vault's config folder)
  const STORE = { groups: [], assign: {}, solo: [], depth: 1, max: 150, focusKeys: [], fdepth: 1, loaded: false };
  const VIEWS = new Set(); // every open graph view of the vault
  const HIDDEN_ID = "hidden"; // the built-in group "Скрытые": what you hide goes there, its eye is off
  const plural = (n) => { const a = n % 100, b = n % 10; return n + (a > 10 && a < 15 ? " узлов" : b === 1 ? " узел" : b > 1 && b < 5 ? " узла" : " узлов"); };
  const NODE_COLORS = [["Медный", "#c98d5b"], ["Песочный", "#d8c8a8"], ["Стальной", "#7c9cc0"], ["Мшистый", "#86b08a"], ["Аметистовый", "#a692c4"], ["Розовый", "#c88080"], ["Охристый", "#c8aa64"], ["Бирюзовый", "#64aaaa"]];
  const GROUP_COLORS = ["#c98d5b", "#6e96be", "#7fbe8b", "#af8ceb", "#e17878", "#e6be5a", "#5abebe", "#dccdb9"];
  const storeFile = () => app.vault.configDir + "/graph-groups.json";
  async function loadStore() {
    try {
      const a = app.vault.adapter;
      if (await a.exists(storeFile())) {
        const j = JSON.parse(await a.read(storeFile()));
        STORE.groups = Array.isArray(j.groups) ? j.groups : []; STORE.assign = j.assign && typeof j.assign === "object" ? j.assign : {};
        STORE.solo = Array.isArray(j.solo) ? j.solo : []; STORE.depth = Number.isFinite(j.depth) ? j.depth : 1; STORE.max = Number.isFinite(j.max) ? j.max : 150;
        // the old separate list of hidden notes becomes the group "Скрытые"
        if (Array.isArray(j.hidden) && j.hidden.length) { const g = hiddenGroup(); for (const k of j.hidden) STORE.assign[k] = g.id; }
      }
    } catch (e) { /* a fresh vault */ }
    STORE.loaded = true; HIST.st = []; HIST.i = -1; pushHist();
  }
  function hiddenGroup() {
    let g = STORE.groups.find((x) => x.id === HIDDEN_ID);
    if (!g) { g = { id: HIDDEN_ID, name: "Скрытые", color: "#8a8a8a", hidden: true, system: true }; STORE.groups.push(g); }
    return g;
  }
  // ---- undo / redo of everything done with groups, hiding and focus
  const HIST = { st: [], i: -1, lock: false };
  const snapState = () => JSON.stringify({ groups: STORE.groups, assign: STORE.assign, solo: STORE.solo, depth: STORE.depth, max: STORE.max, focusKeys: STORE.focusKeys, fdepth: STORE.fdepth });
  function pushHist() {
    if (HIST.lock) return; const sn = snapState(); if (HIST.st[HIST.i] === sn) return;
    HIST.st.length = HIST.i + 1; HIST.st.push(sn); HIST.i++; if (HIST.st.length > 100) { HIST.st.shift(); HIST.i--; }
    for (const v of VIEWS) v.updHist && v.updHist();
  }
  function goHist(d) {
    clearTimeout(storeT); pushHist(); // a change made a moment ago is already in the list
    const to = HIST.i + d; if (to < 0 || to >= HIST.st.length) return false;
    HIST.i = to; const j = JSON.parse(HIST.st[to]);
    STORE.groups = j.groups; STORE.assign = j.assign; STORE.solo = j.solo; STORE.depth = j.depth; STORE.max = j.max; STORE.focusKeys = j.focusKeys || []; STORE.fdepth = j.fdepth || 1;
    HIST.lock = true; writeStore(); HIST.lock = false;
    for (const v of VIEWS) v.afterState();
    return true;
  }
  let storeT = 0;
  const writeStore = () => { try { app.vault.adapter.write(storeFile(), JSON.stringify({ groups: STORE.groups, assign: STORE.assign, solo: STORE.solo, depth: STORE.depth, max: STORE.max }, null, 1)).catch(() => {}); } catch (e) { /* not writable */ } };
  const saveStore = () => { clearTimeout(storeT); storeT = setTimeout(() => { pushHist(); try { app.vault.adapter.write(storeFile(), JSON.stringify({ groups: STORE.groups, assign: STORE.assign, solo: STORE.solo, depth: STORE.depth, max: STORE.max }, null, 1)).catch(() => {}); } catch (e) { /* not writable */ } }, 400); };

  // ---------------------------------------------------------------- the engine
  const B64 = "__WASM_B64__";
  let module = null;
  const instance = () => {
    if (!module) module = new WebAssembly.Module(Uint8Array.from(atob(B64), (ch) => ch.charCodeAt(0)));
    return new WebAssembly.Instance(module, {}).exports; // one instance per view: the engine keeps its graph in a global
  };

  // ---------------------------------------------------------------- the vault as a graph
  function vaultGraph(app, c, anchor, local) {
    const IMGX = /^(png|jpe?g|gif|webp|bmp|avif|svg)$/i;
    const linkedTo = new Set(); if (c.images) for (const dests of Object.values(app.metadataCache.resolvedLinks || {})) for (const d of Object.keys(dests)) linkedTo.add(d);
    const files = app.vault.getFiles().filter((f) => (f.extension === "md" || (c.boards !== false && f.extension === "board") || (c.canvases && f.extension === "canvas") || (c.images && IMGX.test(f.extension) && linkedTo.has(f.path))));
    const resolved = app.metadataCache.resolvedLinks || {}, unres = app.metadataCache.unresolvedLinks || {};
    const tagsOf = (f) => { if (f.extension !== "md") return []; try { const ch = app.metadataCache.getFileCache(f) || {}, out = new Set(); for (const t of ch.tags || []) out.add(String(t.tag).replace(/^#/, "")); const fm = ch.frontmatter && ch.frontmatter.tags; for (const t of Array.isArray(fm) ? fm : typeof fm === "string" ? fm.split(/[,\s]+/) : []) if (t) out.add(String(t).replace(/^#/, "")); return Array.from(out); } catch (e) { return []; } };
    const idx = new Map(), nodes = [];
    const add = (key, name, extra) => { if (idx.has(key)) return idx.get(key); const i = nodes.length; idx.set(key, i); nodes.push(Object.assign({ key, name, file: null, unresolved: false, folder: "" }, extra)); return i; };
    for (const f of files) add(f.path, f.basename, { kind: f.extension === "canvas" ? "canvas" : f.extension === "board" ? "board" : f.extension === "md" ? "note" : "img", file: f, mtime: f.stat.mtime, ctime: f.stat.ctime, tags: tagsOf(f), dir: f.parent && f.parent.path !== "/" ? f.parent.path : "", folder: f.parent && f.parent.path !== "/" ? f.parent.path.split("/")[0] : "" });
    const have = new Set(files.map((f) => f.path)), seen = new Set(), edges = [];
    const link = (a, b) => { if (a === b) return; const k = a < b ? a * 1048576 + b : b * 1048576 + a; if (seen.has(k)) return; seen.add(k); edges.push([a, b]); };
    for (const [src, dests] of Object.entries(resolved)) if (have.has(src)) for (const dest of Object.keys(dests)) if (have.has(dest)) link(idx.get(src), idx.get(dest));
    if (c.unresolved) for (const [src, dests] of Object.entries(unres)) if (have.has(src)) for (const name of Object.keys(dests)) link(idx.get(src), add("?" + name, name, { unresolved: true }));
    if (c.tagNodes) for (const nd of nodes.slice()) if (nd.tags && nd.tags.length) for (const t of nd.tags) { const ti = add("tag:" + t, "#" + t, { kind: "tag" }); have.add("tag:" + t); link(idx.get(nd.key), ti); }
    const deg = new Array(nodes.length).fill(0); edges.forEach(([a, b]) => { deg[a]++; deg[b]++; });
    let keep = nodes.map((_, i) => c.orphans || local || deg[i] > 0);
    if (local) {
      const root = anchor ? idx.get(anchor.path) : undefined;
      if (root === undefined) return { nodes: [], edges: [] };
      const nb = nodes.map(() => []); edges.forEach(([a, b]) => { nb[a].push(b); nb[b].push(a); });
      const dist = new Array(nodes.length).fill(-1); dist[root] = 0; const q = [root];
      for (let h = 0; h < q.length; h++) { const u = q[h]; if (dist[u] >= c.localDepth) continue; for (const v of nb[u]) if (dist[v] < 0) { dist[v] = dist[u] + 1; q.push(v); } }
      keep = dist.map((d) => d >= 0);
    }
    if (c.folderOnly) keep = keep.map((k, i) => k && (nodes[i].kind === "tag" || nodes[i].unresolved || nodes[i].dir === c.folderOnly || String(nodes[i].dir || "").startsWith(c.folderOnly + "/")));
    if (c.tagOnly) keep = keep.map((k, i) => k && (nodes[i].kind === "tag" ? nodes[i].name === "#" + c.tagOnly : (nodes[i].tags || []).includes(c.tagOnly)));
    // groups decide what is shown: a group with its eye off is gone; with "only this" on, the picture is built around those groups
    {
      const grp = (nd) => { const id = STORE.assign[nd.key]; return id ? STORE.groups.find((g) => g.id === id) : null; };
      const gone = nodes.map((nd) => { const g = grp(nd); return !!(g && g.hidden); });
      const solo = new Set(STORE.solo.filter((id) => STORE.groups.some((g) => g.id === id))), fk = new Set(STORE.focusKeys);
      if (solo.size || fk.size) {
        const nbr = nodes.map(() => []); edges.forEach(([a, b]) => { nbr[a].push(b); nbr[b].push(a); });
        const dist = new Array(nodes.length).fill(-1), q = [];
        const reach = fk.size ? STORE.fdepth : STORE.depth;
        nodes.forEach((nd, i) => { if (fk.size ? fk.has(nd.key) : solo.has(STORE.assign[nd.key])) { dist[i] = 0; q.push(i); } });
        for (let h = 0; h < q.length; h++) { const u = q[h]; if (dist[u] >= reach) continue; for (const v of nbr[u]) if (dist[v] < 0 && !gone[v]) { dist[v] = dist[u] + 1; q.push(v); } }
        let cand = q.slice();
        if (cand.length > STORE.max) cand = cand.sort((a, b) => dist[a] - dist[b] || deg[b] - deg[a]).slice(0, STORE.max);
        const ok = new Set(cand); keep = keep.map((k, i) => ok.has(i));
      } else keep = keep.map((k, i) => k && !gone[i]);
    }
    let list = nodes.map((_, i) => i).filter((i) => keep[i]);
    if (list.length > c.maxNodes) list = list.sort((a, b) => deg[b] - deg[a]).slice(0, c.maxNodes);
    const remap = new Map(list.map((old, i) => [old, i]));
    return { nodes: list.map((i) => nodes[i]), edges: edges.filter(([a, b]) => remap.has(a) && remap.has(b)).map(([a, b]) => [remap.get(a), remap.get(b)]) };
  }

  // ---------------------------------------------------------------- the view
  const CSS = `
    .bsg { position: absolute; inset: 0; overflow: hidden; background: radial-gradient(ellipse at 50% 42%, color-mix(in srgb, var(--interactive-accent) 9%, var(--background-primary)), var(--background-primary) 72%); user-select: none; }
    .bsg canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
    .bsg-top { position: absolute; left: 14px; right: 60px; top: 12px; display: flex; gap: 8px; align-items: center; pointer-events: none; }
    .bsg-top > * { pointer-events: auto; }
    .bsg-top .sp { flex: 1; pointer-events: none; }
    .bsg-seg { display: flex; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip);  overflow: hidden; }
    .bsg-seg button, .bsg-btn { background: transparent; box-shadow: none; clip-path: none; border: 0; border-radius: var(--bs-r); color: var(--text-muted); padding: 0 12px; height: 30px; font-size: 12px; cursor: pointer; }
    .bsg-btn { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: var(--bs-r); width: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
    .bsg-seg button.is-on { background: var(--interactive-accent); color: var(--text-on-accent); }
    .bsg-seg button:not(.is-on):hover, .bsg-btn:hover { color: var(--text-normal); }
    .bsg-search { width: 260px; height: 30px; border-radius: 0 !important; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); padding: 0 10px; font-size: 12.5px; }
    .bsg-panel .setting-item-info { flex: 1 1 auto; min-width: 0; } .bsg-panel .setting-item-control { flex: 0 0 auto; } .bsg-panel .setting-item-control input[type=range] { width: 140px; }
    .bsg-panel .setting-item-heading { background: none; border: 0; border-top: 1px solid var(--background-modifier-border); border-radius: 0; margin-top: 12px; padding: 14px 4px 6px; } .bsg-panel .setting-item-heading:first-child { border-top: 0; margin-top: 0; }
    .bsg-controls { position: absolute; right: 12px; top: 12px; z-index: 6; }
    .bsg-controls .canvas-control-group { background: var(--background-secondary); border-radius: 0; box-shadow: none; clip-path: var(--bs-clip); }
    .bsg-controls .canvas-control-item { background: transparent; }
    .bsg-controls .canvas-control-item:hover { background: var(--background-modifier-hover); }
    .bsg-panel { overflow-x: hidden; box-sizing: border-box; position: absolute; right: 60px; top: 12px; width: 380px; padding: 12px 14px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip);   display: none; font-size: 12.5px; }
    .bsg-panel.is-open { display: block; }
    .bsg-panel .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 8px 0; color: var(--text-muted); }
    .bsg-panel input[type=range] { width: 120px; }
    .bsg-card { overflow-x: hidden; position: absolute; left: 14px; bottom: 40px; width: 250px; max-height: 50%; overflow: auto; padding: 12px 14px; background: color-mix(in srgb, var(--background-secondary) 92%, transparent); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip);   display: none; }
    .bsg-card.is-on { display: block; animation: bsg-in .2s ease-out; }
    @keyframes bsg-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .bsg-card .pv { margin: -4px -6px 10px; border-radius: 0; overflow: hidden; background: var(--background-primary); }
    .bsg-card .pv { height: 150px; position: relative; }
    .bsg-card .pv img, .bsg-card .pv canvas { display: block; position: absolute; inset: 0; width: 100%; height: 100%; max-width: 100%; object-fit: cover; }
    .bsg-card .pv canvas { object-fit: contain; }
    .bsg-card .t { font-weight: 600; font-size: 14px; color: var(--text-normal); }
    .bsg-card .m { font-size: 11.5px; color: var(--text-faint); margin: 3px 0 8px; }
    .bsg-card .nb { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 10px; }
    .bsg-card .nb button { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; height: 22px; padding: 0 8px; font-size: 11.5px; border-radius: var(--bs-r); background: var(--background-modifier-hover); color: var(--text-muted); box-shadow: none; clip-path: none; border: 0; cursor: pointer; }
    .bsg-card .nb button:hover { color: var(--text-normal); background: color-mix(in srgb, var(--interactive-accent) 25%, transparent); }
    .bsg-card .open.alt { margin-top: 6px; background: var(--background-modifier-hover); color: var(--text-normal); }
    .bsg-card .open { width: 100%; height: 28px; border-radius: var(--bs-r); background: var(--interactive-accent); color: var(--text-on-accent); box-shadow: none; clip-path: none; border: 0; cursor: pointer; font-size: 12px; }
    .bsg-panel .hd { margin: 14px 0 6px; padding-top: 10px; border-top: 1px solid var(--background-modifier-border); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-faint); }
    .bsg-panel .grp { gap: 6px; } .bsg-panel .grp input[type=color] { width: 22px; height: 22px; padding: 0; border: 0; background: none; flex: none; }
    .bsg-panel .grp .nm { flex: 1; min-width: 0; height: 24px; padding: 0 6px; font-size: 12px; } .bsg-panel .grp .n { color: var(--text-faint); font-size: 11px; min-width: 16px; text-align: right; }
    .bsg-panel .grp.is-off .nm, .bsg-panel .grp.is-off .n { opacity: .45; } .bsg-panel .grp.is-solo { background: color-mix(in srgb, var(--interactive-accent) 14%, transparent); }
    .bsg-panel .grp .ic { width: 24px; height: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center; background: transparent; box-shadow: none; clip-path: none; border: 0; color: var(--text-faint); cursor: pointer; border-radius: var(--bs-r); flex: none; }
    .bsg-panel .grp .ic svg { width: 15px; height: 15px; } .bsg-panel .grp .ic:hover { color: var(--text-normal); background: var(--background-modifier-hover); } .bsg-panel .grp .ic.on { color: var(--interactive-accent); }
    .bsg-panel .focusbox { margin: 8px 0; padding: 8px 10px; border: 1px solid var(--background-modifier-border); } .bsg-panel .focusbox .row b { min-width: 28px; text-align: right; color: var(--text-muted); font-weight: 500; }
    .bsg-panel .grp .x, .bsg-panel .wide { background: transparent; box-shadow: none; clip-path: none; border: 1px solid var(--background-modifier-border); color: var(--text-muted); cursor: pointer; border-radius: var(--bs-r); }
    .bsg-panel .grp .x { width: 22px; height: 22px; padding: 0; } .bsg-panel .wide { width: 100%; height: 28px; margin: 4px 0; font-size: 12px; } .bsg-panel .wide:hover, .bsg-panel .grp .x:hover { color: var(--text-normal); border-color: var(--interactive-accent); }
    .bsg-panel .mute { font-size: 11.5px; color: var(--text-faint); }
    .bsg-panel { max-height: calc(100% - 66px); overflow-y: auto; }
    .bsg-menu { position: absolute; z-index: 60; min-width: 220px; max-width: 280px; padding: 6px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip); font-size: 12.5px; }
    .bsg-menu .ti { padding: 6px 10px 4px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bsg-menu .sp { height: 1px; margin: 5px 4px; background: var(--background-modifier-border); }
    .bsg-menu .it { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: var(--bs-r); color: var(--text-normal); cursor: pointer; }
    .bsg-menu .it:hover { background: var(--background-modifier-hover); } .bsg-menu .it.off { color: var(--text-faint); cursor: default; } .bsg-menu .it.off:hover { background: none; }
    .bsg-menu .it.sub { padding-left: 16px; } .bsg-menu .it i { width: 10px; height: 10px; border-radius: 50%; flex: none; } .bsg-menu .it span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .bsg-menu .it b { color: var(--interactive-accent); }
    .bsg-sbox { position: relative; display: flex; align-items: center; }
    .bsg-sbox .bsg-search { width: 260px; padding-right: 64px; }
    .bsg-count { position: absolute; right: 10px; font-size: 11px; color: var(--text-faint); pointer-events: none; }
    .bsg-seg.mini { height: 24px; } .bsg-seg.mini button { height: 24px; padding: 0 9px; font-size: 11.5px; }
    .bsg-panel .hd.first { margin-top: 2px; padding-top: 0; border-top: 0; }
    .bsg-panel .btns { display: flex; gap: 6px; margin: 6px 0 2px; } .bsg-panel .btns button { flex: 1; height: 26px; font-size: 12px; background: transparent; box-shadow: none; clip-path: none; border: 1px solid var(--background-modifier-border); color: var(--text-muted); border-radius: var(--bs-r); cursor: pointer; } .bsg-panel .btns button:hover { color: var(--text-normal); border-color: var(--interactive-accent); }
    .bsg-help { position: absolute; left: 50%; top: 60px; transform: translateX(-50%); width: min(640px, calc(100% - 40px)); max-height: calc(100% - 90px); overflow-y: auto; padding: 14px 18px 10px; z-index: 40; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip); display: none; font-size: 12.5px; }
    .bsg-help.is-open { display: block; } .bsg-help .ht { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 20px; font-weight: 600; color: var(--text-normal); }
    .bsg-help .hx { width: 30px; height: 30px; padding: 0; background: transparent; box-shadow: none; clip-path: none; border: 0; color: var(--text-muted); cursor: pointer; border-radius: var(--bs-r); } .bsg-help .hx:hover { color: var(--text-normal); background: var(--background-modifier-hover); }
    .bsg-help .hr { display: flex; gap: 16px; align-items: center; justify-content: space-between; padding: 7px 0; color: var(--text-normal); font-size: 14px; }
    .bsg-help .ks { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
    .bsg-help kbd { font-family: var(--font-monospace); font-size: 12.5px; padding: 3px 8px; background: var(--background-modifier-hover); color: var(--text-normal); border: 0; border-radius: var(--bs-r); box-shadow: none; white-space: nowrap; }
    .bsg-panel .li { display: inline-flex; width: 15px; height: 15px; margin-right: 7px; color: var(--text-faint); vertical-align: -3px; flex: none; } .bsg-panel .li svg { width: 15px; height: 15px; }
    .bsg-panel .hd { display: flex; align-items: center; } .bsg-panel .hd .li { color: var(--interactive-accent); }
    .bsg-panel .row .lb { display: flex; align-items: center; flex: 1; min-width: 0; }
    .bsg-panel .cbs { display: flex; gap: 10px; } .bsg-panel .cb2:checked { background-color: #6e96be !important; border-color: #6e96be !important; --interactive-accent: #6e96be; }
    .bsg-panel .cap { display: flex; justify-content: flex-end; gap: 4px; margin: -2px 0 2px; font-size: 10.5px; color: var(--text-faint); } .bsg-panel .cap span { width: 40px; text-align: center; }
    .bsg-panel .row.focus .nm { color: var(--text-normal); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .bsg-panel .row.focus .n { color: var(--text-muted); min-width: 36px; text-align: center; font-size: 12px; }
    .bsg-panel .row.focus .ic { width: 24px; height: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center; background: transparent; box-shadow: none; clip-path: none; border: 0; color: var(--text-muted); cursor: pointer; border-radius: var(--bs-r); flex: none; } .bsg-panel .row.focus .ic:hover { color: var(--text-normal); background: var(--background-modifier-hover); } .bsg-panel .row.focus .ic svg { width: 15px; height: 15px; }
    .bsg-panel .wide .li, .bsg-panel .btns button .li { margin-right: 6px; } .bsg-panel .wide, .bsg-panel .btns button { display: inline-flex; align-items: center; justify-content: center; }
    .bsg-focus { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); display: none; align-items: center; gap: 6px; padding: 4px 6px 4px 12px; background: var(--background-secondary); border: 1px solid var(--interactive-accent); border-radius: 0; clip-path: var(--bs-clip); font-size: 12.5px; z-index: 6; }
    .bsg-focus.is-on { display: flex; } .bsg-focus .t { color: var(--text-normal); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 4px; } .bsg-focus .n { min-width: 34px; text-align: center; color: var(--text-muted); }
    .bsg-focus button { width: 24px; height: 24px; padding: 0; background: transparent; box-shadow: none; clip-path: none; border: 0; color: var(--text-muted); cursor: pointer; border-radius: var(--bs-r); } .bsg-focus button:hover { color: var(--text-normal); background: var(--background-modifier-hover); }
    .bsg-panel .setting-item { padding: 8px 0; } .bsg-panel .setting-item-heading { padding-top: 14px; } .bsg-panel .setting-item-name { display: flex; align-items: center; }
    .bsg-panel .bsg-si { display: inline-flex; width: 16px; height: 16px; margin-right: 8px; color: var(--interactive-accent); flex: none; } .bsg-panel .bsg-si svg { width: 16px; height: 16px; }
    .bsg-panel .bsg-t2.is-enabled { background-color: #6e96be; }
    .bsg-panel .bsg-off .setting-item-name, .bsg-panel .bsg-off .setting-item-description { opacity: .45; } .bsg-panel .bsg-solo { background: color-mix(in srgb, var(--interactive-accent) 12%, transparent); }
    .bsg-status { position: absolute; left: 14px; bottom: 10px; font-size: 11.5px; color: var(--text-faint); pointer-events: none; display: flex; gap: 14px; }
    .bsg-status b { color: var(--text-muted); font-weight: 600; }
    .bsg-empty { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; color: var(--text-faint); pointer-events: none; }
    /* ---- one look: 6px shapes, calm accents, nearly opaque floating pieces */
    .bsg { --bs-r: 6px; --bs-clip: none; }
    .bsg-seg, .bsg-panel, .bsg-focus, .bsg-card, .bsg-help, .bsg-menu { border-radius: 6px !important; clip-path: none !important; }
    .bsg-seg { padding: 2px; gap: 2px; height: 34px; align-items: center; background: color-mix(in srgb, var(--background-secondary) 94%, transparent); }
    .bsg-seg button { height: 28px; border-radius: 4px !important; display: inline-flex; align-items: center; gap: 6px; }
    .bsg-seg button.is-on { background: color-mix(in srgb, var(--interactive-accent) 22%, transparent); color: var(--text-normal); }
    .bsg-seg button .bsg-sic { display: inline-flex; width: 15px; height: 15px; } .bsg-seg button .bsg-sic svg { width: 15px; height: 15px; }
    .bsg-search { height: 34px; border-radius: 6px !important; background: color-mix(in srgb, var(--background-secondary) 94%, transparent); }
    .bsg-panel { background: color-mix(in srgb, var(--background-secondary) 97%, transparent); box-shadow: 0 8px 28px rgba(0, 0, 0, .35); top: 54px; max-height: calc(100% - 66px); }
    .bsg-card { background: color-mix(in srgb, var(--background-secondary) 96%, transparent); }
    .bsg-controls .canvas-control-item.is-on { background: color-mix(in srgb, var(--interactive-accent) 24%, transparent) !important; color: var(--text-normal) !important; }
    .bsg-depth { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 12px; background: color-mix(in srgb, var(--background-secondary) 94%, transparent); border: 1px solid var(--background-modifier-border); border-radius: 6px; font-size: 12px; color: var(--text-muted); white-space: nowrap; }
    .bsg-depth input[type=range] { width: 90px; } .bsg-depth b { min-width: 12px; color: var(--text-normal); font-weight: 600; }
    .bsg-legend { position: absolute; right: 60px; bottom: 38px; width: max-content; display: none; flex-wrap: wrap; justify-content: flex-end; gap: 4px 14px; max-width: min(560px, 55%); padding: 7px 12px; background: color-mix(in srgb, var(--background-secondary) 94%, transparent); border: 1px solid var(--background-modifier-border); border-radius: 6px; font-size: 11.5px; color: var(--text-muted); pointer-events: none; }
    .bsg-legend .lg { display: inline-flex; align-items: center; gap: 6px; } .bsg-legend svg { width: 12px; height: 12px; flex: none; } .bsg-legend b { font-weight: 500; color: var(--text-faint); }
    .bsg-pathbar { position: absolute; left: 50%; bottom: 52px; transform: translateX(-50%); display: none; align-items: center; gap: 10px; max-width: min(720px, calc(100% - 140px)); padding: 6px 6px 6px 14px; background: color-mix(in srgb, var(--background-secondary) 97%, transparent); border: 1px solid color-mix(in srgb, var(--interactive-accent) 55%, var(--background-modifier-border)); border-radius: 6px; font-size: 12.5px; z-index: 6; box-shadow: 0 6px 22px rgba(0, 0, 0, .3); }
    .bsg-pathbar.is-on { display: flex; } .bsg-pathbar .t { color: var(--text-normal); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .bsg-pathbar .n { color: var(--text-faint); white-space: nowrap; }
    .bsg-pathbar button, .bsg-time button { width: 26px; height: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center; background: transparent; box-shadow: none; clip-path: none; border: 0; border-radius: 4px; color: var(--text-muted); cursor: pointer; flex: none; } .bsg-pathbar button:hover, .bsg-time button:hover { color: var(--text-normal); background: var(--background-modifier-hover); } .bsg-pathbar svg, .bsg-time svg { width: 16px; height: 16px; }
    .bsg-time { position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%); display: none; align-items: center; gap: 10px; width: min(520px, calc(100% - 340px)); padding: 5px 6px 5px 8px; background: color-mix(in srgb, var(--background-secondary) 97%, transparent); border: 1px solid var(--background-modifier-border); border-radius: 6px; z-index: 6; box-shadow: 0 6px 22px rgba(0, 0, 0, .3); }
    .bsg-time.is-on { display: flex; } .bsg-time input[type=range] { flex: 1; min-width: 80px; } .bsg-time .dt { min-width: 92px; text-align: right; font-size: 12px; color: var(--text-muted); }
    .bsg-empty { flex-direction: column; gap: 8px; text-align: center; padding: 0 40px; } .bsg-empty .et { font-size: 15px; color: var(--text-muted); } .bsg-empty .ed { font-size: 12.5px; color: var(--text-faint); max-width: 380px; line-height: 1.5; }
    .bsg-empty button { pointer-events: auto; margin-top: 6px; height: 30px; padding: 0 14px; border-radius: 6px; background: var(--background-modifier-hover); color: var(--text-normal); border: 1px solid var(--background-modifier-border); box-shadow: none; clip-path: none; cursor: pointer; font-size: 12.5px; } .bsg-empty button:hover { border-color: var(--interactive-accent); }
    .bsg-empty .spin { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--background-modifier-border); border-top-color: var(--interactive-accent); animation: bsg-spin .9s linear infinite; } @keyframes bsg-spin { to { transform: rotate(360deg); } }
`;
  const injectCss = () => { if (document.getElementById("bsg-css")) return; const s = document.createElement("style"); s.id = "bsg-css"; s.textContent = CSS; document.head.appendChild(s); };
  const cssColor = (name, fb) => { const p = document.createElement("div"); p.style.cssText = "display:none;color:var(" + name + "," + fb + ")"; document.body.appendChild(p); const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(getComputedStyle(p).color); p.remove(); return m ? (+m[1] << 16) | (+m[2] << 8) | +m[3] : parseInt(fb.slice(1), 16); };

  const makeView = (api, type) => class BasaltGraphView extends api.ItemView {
    constructor(leaf) { super(leaf); this.c = load(); this.type = type; this.anchor = null; this.ex = null; this.hover = -1; this.sel = -1; this.dirty = true; this.running = true; this.W = 0; this.H = 0; this.g = { nodes: [], edges: [] }; }
    getViewType() { return type; }
    getDisplayText() { return type === "localgraph" ? "Локальный граф" : "Граф"; }
    getIcon() { return "lucide-git-fork"; }
    getState() { return { view: this.c.view }; }
    async setState(s) { if (s && s.file && this.app.vault.getAbstractFileByPath) { const f = this.app.vault.getAbstractFileByPath(s.file); if (f) { this.anchor = f; if (this.ready) this.rebuild(); } } if (s && s.view) { this.c.view = s.view; this.ready && this.setMode(s.view); } }

    async onOpen() {
      try { this.open2(); } catch (e) { console.error("[bs-graph] open failed", e); this.contentEl.textContent = "Граф не открылся: " + (e && e.message ? e.message : e); this.contentEl.style.padding = "20px"; }
    }
    open2() {
      injectCss();
      const root = this.contentEl; root.empty && root.empty(); root.style.padding = "0"; root.style.overflow = "hidden"; root.style.position = "relative";
      root.innerHTML = '<div class="bsg"><canvas></canvas><div class="bsg-top"></div><div class="bsg-panel"></div><div class="bsg-card"></div><div class="bsg-status"></div><div class="bsg-legend"></div><div class="bsg-pathbar"></div><div class="bsg-time"></div><div class="bsg-empty"></div></div>';
      this.root = root.querySelector(".bsg"); this.cv = this.root.querySelector("canvas"); this.ctx = this.cv.getContext("2d");
      this.top = this.root.querySelector(".bsg-top"); this.panel = this.root.querySelector(".bsg-panel"); this.status = this.root.querySelector(".bsg-status"); this.card = this.root.querySelector(".bsg-card"); this.helpEl = { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } }; this.empty = this.root.querySelector(".bsg-empty"); this.legend = this.root.querySelector(".bsg-legend"); this.pathbar = this.root.querySelector(".bsg-pathbar"); this.timebar = this.root.querySelector(".bsg-time");
      this.ex = instance();
      this.buildTop(); this.buildPanel(); this.bind(); this.updateEmpty(0, true);
      this.alive = true; this.ready = true; VIEWS.add(this);
      this.keyUndo = (e) => {
        if (!this.alive || !(e.ctrlKey || e.metaKey)) return;
        const act = this.app.workspace.activeLeaf; if (!act || act.view !== this) return;
        if (/INPUT|TEXTAREA/.test((e.target && e.target.tagName) || "")) return;
        if (e.code === "KeyZ" || e.code === "KeyY") { e.preventDefault(); e.stopPropagation(); goHist(e.code === "KeyY" || e.shiftKey ? 1 : -1); }
      };
      window.addEventListener("keydown", this.keyUndo, true);
      if (!this.anchor) this.anchor = this.app.workspace.getActiveFile();
      this.style(); this.setMode(this.c.view);
      (STORE.loaded ? Promise.resolve() : loadStore()).then(() => { if (this.alive) { this.buildPanel(); this.rebuild(); } });
      const again = () => { clearTimeout(this.rt); this.rt = setTimeout(() => this.rebuild(), 900); };
      this.registerEvent(this.app.metadataCache.on("resolved", again));
      for (const ev of ["create", "delete", "rename"]) this.registerEvent(this.app.vault.on(ev, again));
      if (type === "localgraph") this.registerEvent(this.app.workspace.on("file-open", (f) => { if (f && f !== this.anchor) { this.anchor = f; this.rebuild(); } }));
      this.themeObs = new MutationObserver(() => { this.style(); }); this.themeObs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
      const loop = () => { if (!this.alive) return; this.raf = requestAnimationFrame(loop); try { this.frame(); } catch (e) { if (!this.logged) { console.error("[bs-graph]", e); this.logged = true; } this.recover(e); } };
      this.raf = requestAnimationFrame(loop);
    }
    async onClose() { this.alive = false; VIEWS.delete(this); window.removeEventListener("keydown", this.keyUndo, true); cancelAnimationFrame(this.raf); clearTimeout(this.rt); this.themeObs && this.themeObs.disconnect(); this.ex = null; }

    // a trap inside the engine would leave the graph dead: start a fresh engine and load the vault into it again
    recover(e) {
      if (!(e instanceof WebAssembly.RuntimeError) || this.recovering) { this.dirty = true; return; }
      this.recovering = true;
      try { this.ex = instance(); this.sig = null; this.keyIndex = null; this.hlTo = undefined; this.introDone = true; this.rebuild(); this.setMode(this.c.view); this.logged = false; } catch (err) { console.error("[bs-graph] recover", err); }
      setTimeout(() => { this.recovering = false; }, 1500);
    }
    // ---- chrome
    // the help is the application's own window (the same classes as the canvas help: mod-canvas-help, canvas-instruction, setting-hotkey)
    openHelp() {
      const m = new (api2().Modal)(this.app); m.modalEl.addClass("mod-canvas-help"); m.setTitle("Справка");
      const box = m.contentEl.createDiv("canvas-help");
      const row = (label, combos) => box.createDiv({ cls: "canvas-instruction" }, (rw) => { rw.createDiv({ cls: "canvas-instruction-label", text: label }); rw.createDiv({ cls: "canvas-instruction-desc" }, (d) => { for (const k of combos) d.createSpan({ cls: "setting-hotkey", text: k.join(" + ") }); }); });
      row("Приблизить / отдалить", [["Колесо"]]);
      row("Сдвинуть граф", [["Перетащить"], ["Shift", "Перетащить"]]);
      row("Переместить узел (2D)", [["Перетащить"]]);
      row("Выделить, подсветить связанные", [["Клик"]]);
      row("Открыть заметку", [["Двойной клик"]]);
      row("Вписать граф в окно", [["Двойной клик"], ["0"]]);
      row("Пометить несколько узлов", [["Shift", "Клик"]]);
      row("Меню: группа, скрыть, открыть", [["Правый клик"]]);
      row("Скрыть выделенное", [["Delete"], ["Backspace"]]);
      row("Найти заметку", [["Ctrl", "F"], ["/"]]);
      row("Следующий найденный", [["Enter"], ["Shift", "Enter"]]);
      row("Снять выделение, закрыть окно", [["Esc"]]);
      row("Отменить", [["Ctrl", "Z"]]);
      row("Повторить", [["Ctrl", "Y"], ["Ctrl", "Shift", "Z"]]);
      m.open();
    }
    updHist() { if (this.undoB) { this.undoB.toggleClass("is-disabled", HIST.i <= 0); this.redoB.toggleClass("is-disabled", HIST.i >= HIST.st.length - 1); } }
    buildTop() {
      const SEGI = { "2d": ["lucide-square", "2D"], "3d": ["lucide-box", "3D"], files: ["lucide-folder-tree", "Файлы"] }; const segFill = (b, k) => { b.textContent = ""; const i = document.createElement("span"); i.className = "bsg-sic"; try { window.__bsApi.setIcon(i, SEGI[k][0]); } catch (e) { /* ok */ } const t = document.createElement("span"); t.textContent = SEGI[k][1]; b.append(i, t); };
      const t = this.top; t.textContent = "";
      const seg = document.createElement("div"); seg.className = "bsg-seg";
      this.segBtns = {}; for (const [k, label] of [["2d", "2D"], ["3d", "3D"]]) { const b = document.createElement("button"); b.className = "bsg-si"; segFill(b, k); b.title = k === "2d" ? "Плоский граф" : "Объёмный граф"; b.addEventListener("click", () => this.setMode(k)); seg.appendChild(b); this.segBtns[k] = b; }
      { const b = document.createElement("button"); b.className = "bsg-si"; segFill(b, "files"); b.title = "Граф файлов и папок"; b.addEventListener("click", () => this.leaf.setViewState({ type: "basalt-codegraph", state: { mode: "files" }, active: true })); seg.appendChild(b); }
      t.appendChild(seg);
      // search: type to find, Enter / Shift+Enter to go through the matches, Esc to clear
      const box = document.createElement("div"); box.className = "bsg-sbox";
      const search = document.createElement("input"); search.type = "text"; search.className = "bsg-search"; search.placeholder = "Найти по имени и тексту…"; this.searchEl = search;
      const count = document.createElement("span"); count.className = "bsg-count"; this.countEl = count;
      const find = () => {
        this.fadeNow(); const q = search.value.trim().toLowerCase();
        this.match = q ? this.g.nodes.map((x, i) => (x.name.toLowerCase().includes(q) ? i : -1)).filter((i) => i >= 0) : null; this.matchAt = 0;
        count.textContent = q ? (this.match.length ? "1 из " + this.match.length : "ничего") : "";
        if (this.match && this.match.length) this.setSel(this.match[0], true); else if (!q) this.setSel(-1); this.dirty = true;
        // then the text of the notes: read once, kept lower-cased, matches added after the name hits
        if (!q) return; const tok = this.findTok = (this.findTok || 0) + 1, TX = window.__bsgText || (window.__bsgText = new Map()), nodes = this.g.nodes;
        clearTimeout(this.findT); this.findT = setTimeout(async () => {
          const extra = [], have = new Set(this.match || []);
          for (let i = 0; i < nodes.length; i++) { const f = nodes[i].file; if (!f || have.has(i) || !/^(md|canvas|txt)$/.test(f.extension)) continue;
            let s = TX.get(f.path); if (!s || s.m !== f.stat.mtime) { try { s = { t: (await this.app.vault.cachedRead(f)).toLowerCase(), m: f.stat.mtime }; TX.set(f.path, s); } catch (e) { continue; } }
            if (tok !== this.findTok) return; if (s.t.includes(q)) extra.push(i); }
          if (tok !== this.findTok || !extra.length) { if (!(this.match && this.match.length)) count.textContent = "ничего"; return; }
          const first = !(this.match && this.match.length); this.match = (this.match || []).concat(extra); count.textContent = (this.matchAt + 1) + " из " + this.match.length; if (first) this.setSel(this.match[0], true); this.dirty = true;
        }, 200);
      };
      search.addEventListener("input", find);
      search.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && this.match && this.match.length) { e.preventDefault(); this.matchAt = (this.matchAt + (e.shiftKey ? this.match.length - 1 : 1)) % this.match.length; this.setSel(this.match[this.matchAt], true); count.textContent = (this.matchAt + 1) + " из " + this.match.length; }
        else if (e.key === "Escape") { search.value = ""; find(); search.blur(); }
      });
      box.append(search, count); t.appendChild(box);
      if (type === "localgraph") { const dp = document.createElement("div"); dp.className = "bsg-depth"; const lb = document.createElement("span"); lb.textContent = "Глубина"; const rg = document.createElement("input"); rg.type = "range"; rg.min = 1; rg.max = 6; rg.step = 1; rg.value = this.c.localDepth; const vl = document.createElement("b"); vl.textContent = this.c.localDepth; rg.addEventListener("input", () => { this.c.localDepth = +rg.value; vl.textContent = rg.value; save(this.c); clearTimeout(this.dpT); this.dpT = setTimeout(() => this.rebuild(), 120); }); dp.append(lb, rg, vl); t.appendChild(dp); }
      const sp = document.createElement("div"); sp.className = "sp"; t.appendChild(sp);
      // the controls column of the canvas, built from the same stock classes: settings | zoom | history | help
      const gl = this.root; const old = gl.querySelector(".canvas-controls"); if (old) old.remove();
      const col = gl.createDiv({ cls: "canvas-controls bsg-controls" });
      const grp = () => col.createDiv("canvas-control-group");
      const mk = (g, icon, title, fn) => { const b = g.createDiv({ cls: "canvas-control-item", attr: { "aria-label": title } }); if (api2().setIcon) api2().setIcon(b, icon); b.addEventListener("click", fn); return b; };
      const zoom = (k) => { const cv = this.cv; this.zoomAt = [cv.clientWidth / 2, cv.clientHeight / 2]; this.zoomAcc = (this.zoomAcc || 0) + k; this.dirty = true; };
      mk(grp(), "lucide-settings", "Настройки графа", () => { this.panel.classList.toggle("is-open"); this.helpEl && this.helpEl.classList.remove("is-open"); });
      const z = grp();
      mk(z, "lucide-plus", "Приблизить", () => zoom(-1.5));
      mk(z, "lucide-maximize", "Вписать весь граф в окно", () => this.fitView());
      mk(z, "lucide-minus", "Отдалить", () => zoom(1.5));
      const h = grp();
      this.undoB = mk(h, "lucide-undo-2", "Отменить (Ctrl+Z)", () => { goHist(-1); this.updHist(); });
      this.redoB = mk(h, "lucide-redo-2", "Повторить (Ctrl+Y)", () => { goHist(1); this.updHist(); });
      const xg = grp();
      this.recentB = mk(xg, "lucide-clock", "Подсветить недавно изменённые заметки", (e) => this.recentMenu(e)); this.recentB.classList.toggle("is-on", (this.c.recent || 0) > 0);
      this.timeB = mk(xg, "lucide-history", "Хронология: как рос граф", () => this.toggleTime());
      mk(xg, "lucide-download", "Сохранить картинку или данные графа", (e) => this.exportMenu(e));
      mk(grp(), "lucide-circle-help", "Справка", () => { this.panel.classList.remove("is-open"); this.openHelp(); });
      this.updHist();
    }
    fitView() { this.ex.ge_freeze_bounds(0); this.ex.ge_fit(); this.dirty = true; this.frozen = false; setTimeout(() => { if (this.ex && !this.running) { this.ex.ge_freeze_bounds(1); this.frozen = true; } }, 1800); }
    buildPanel() {
      const p = this.panel; p.textContent = ""; const c = this.c; const S = api2().Setting, ico = api2().setIcon;
      const lead = (st, name) => { if (ico && name) { const i = document.createElement("span"); i.className = "bsg-si"; ico(i, name); st.nameEl.prepend(i); } return st; };
      const heading = (t, name) => lead(new S(p).setName(t).setHeading(), name);
      const toggle = (name, ic, desc, get, set) => lead(new S(p).setName(name).setDesc(desc || ""), ic).addToggle((t) => t.setValue(!!get()).onChange((v) => { set(v); save(c); }));
      // two toggles in a row: the first puts the nodes in the graph, the second (other colour) draws them as pictures; off they are plain balls
      const pair = (name, ic, desc, g1, s1, g2, s2) => lead(new S(p).setName(name).setDesc(desc), ic)
        .addToggle((t) => { t.setTooltip("Показывать в графе"); t.setValue(!!g1()).onChange((v) => { s1(v); save(c); }); })
        .addToggle((t) => { t.setTooltip("Рисовать значком (выключено: простой шарик)"); t.toggleEl.addClass("bsg-t2"); t.setValue(!!g2()).onChange((v) => { s2(v); save(c); }); });
      const slider = (name, ic, desc, key, min, max, step, apply) => lead(new S(p).setName(name).setDesc(desc || ""), ic).addSlider((sl) => sl.setLimits(min, max, step).setValue(c[key]).setDynamicTooltip().onChange((v) => { c[key] = v; save(c); apply(); }));
      heading("Фильтры", "lucide-filter");
      pair("Холсты", "lucide-layout-dashboard", "в графе · значком", () => c.canvases, (v) => { c.canvases = v; this.rebuild(); }, () => c.thumbCanvas, (v) => { c.thumbCanvas = v; this.dirty = true; });
      pair("Картинки", "lucide-image", "в графе · значком", () => c.images, (v) => { c.images = v; this.rebuild(); }, () => c.thumbImg, (v) => { c.thumbImg = v; this.dirty = true; });
      toggle("Заметки без связей", "lucide-circle-dashed", "", () => c.orphans, (v) => { c.orphans = v; this.rebuild(); });
      toggle("Доски", "lucide-square-kanban", "", () => c.boards !== false, (v) => { c.boards = v; this.rebuild(); });
      toggle("Теги как узлы", "lucide-tag", "Каждый тег становится узлом, заметки тянутся к нему", () => c.tagNodes, (v) => { c.tagNodes = v; this.rebuild(); });
      toggle("Ссылки на несозданные", "lucide-file-question", "Выключено: только существующие файлы", () => c.unresolved, (v) => { c.unresolved = v; this.rebuild(); });
      { const fo = { "": "Все папки" }; for (const f of this.app.vault.getAllLoadedFiles().filter((x) => x.children && x.path !== "/").map((x) => x.path).sort().slice(0, 400)) fo[f] = f; if (c.folderOnly && !fo[c.folderOnly]) fo[c.folderOnly] = c.folderOnly;
        lead(new S(p).setName("Папка"), "lucide-folder").addDropdown((d) => d.addOptions(fo).setValue(c.folderOnly || "").onChange((v) => { c.folderOnly = v; save(c); this.rebuild(); }));
        const tc = this.app.metadataCache.getTags ? this.app.metadataCache.getTags() : {}, to = { "": "Все теги" }; for (const t of Object.keys(tc).sort().slice(0, 400)) to[t.replace(/^#/, "")] = t + " (" + tc[t] + ")"; if (c.tagOnly && !to[c.tagOnly]) to[c.tagOnly] = "#" + c.tagOnly;
        lead(new S(p).setName("Тег"), "lucide-hash").addDropdown((d) => d.addOptions(to).setValue(c.tagOnly || "").onChange((v) => { c.tagOnly = v; save(c); this.rebuild(); })); }
      if (type === "localgraph") slider("Глубина", "lucide-layers", "Сколько шагов от открытой заметки", "localDepth", 1, 6, 1, () => this.rebuild());
      heading("Вид", "lucide-palette");
      lead(new S(p).setName("Цвет узлов"), "lucide-palette").addDropdown((d) => d.addOptions({ kind: "По виду", folder: "По папке", tag: "По тегу" }).setValue(c.colorBy || "kind").onChange((v) => { c.colorBy = v; save(c); this.fIdx = new Map(); this.updateLegend(); this.dirty = true; }));
      lead(new S(p).setName("Подписи"), "lucide-type").addDropdown((d) => d.addOptions({ auto: "Авто", all: "Все", none: "Нет" }).setValue(c.labelMode).onChange((v) => { c.labelMode = v; save(c); this.style(); }));
      slider("Плотность подписей", "lucide-text-cursor", "", "labelDensity", 0.4, 2.5, 0.1, () => { this.dirty = true; });
      lead(new S(p).setName("Форма связей"), "lucide-spline").addDropdown((d) => d.addOptions({ curve: "Изогнутые", straight: "Прямые" }).setValue(c.edgeStyle || "curve").onChange((v) => { c.edgeStyle = v; save(c); this.dirty = true; }));
      toggle("Стрелки на связях", "lucide-move-right", "Направление ссылки: от заметки к той, на которую она ссылается", () => c.arrows, (v) => { c.arrows = v; this.dirty = true; });
      toggle("Легенда", "lucide-list", "", () => c.legend !== false, (v) => { c.legend = v; this.updateLegend(); });
      slider("Размер узлов", "lucide-circle-dot", "", "nodeScale", 0.5, 2.5, 0.1, () => this.style());
      slider("Яркость связей", "lucide-sun", "", "edgeAlpha", 0.1, 1, 0.05, () => this.style());
      heading("Время", "lucide-clock");
      lead(new S(p).setName("Недавние изменения"), "lucide-clock").addDropdown((d) => d.addOptions({ 0: "Не подсвечивать", 1: "За сутки", 7: "За неделю", 30: "За месяц", 90: "За три месяца" }).setValue(String(c.recent || 0)).onChange((v) => this.setRecent(+v)));
      lead(new S(p).setName("Хронология"), "lucide-history").addButton((b) => b.setIcon("lucide-play").setTooltip("Показать, как рос граф").onClick(() => this.toggleTime()));
      heading("Раскладка", "lucide-network");
      slider("Длина связей", "lucide-ruler", "", "linkDistance", 10, 120, 2, () => this.forces());
      slider("Притяжение", "lucide-magnet", "", "linkStrength", 0.1, 1.5, 0.05, () => this.forces());
      lead(new S(p).setName("Пересчитать раскладку"), "lucide-shuffle").addButton((b) => b.setIcon("lucide-shuffle").setTooltip("Пересчитать").onClick(() => { this.ex.ge_reheat(1); this.running = true; }));
      lead(new S(p).setName("Сбросить силы"), "lucide-rotate-ccw").addButton((b) => b.setIcon("lucide-rotate-ccw").setTooltip("Сбросить").onClick(() => { c.linkDistance = CFG0.linkDistance; c.linkStrength = CFG0.linkStrength; save(c); this.forces(); this.buildPanel(); }));
      lead(new S(p).setName("Открепить все узлы"), "lucide-pin-off").addButton((b) => b.setIcon("lucide-pin-off").setTooltip("Отпустить узлы, которые вы перетащили").onClick(() => this.unpinAll()));
      this.panelFocus(p, heading);
      this.panelGroups(p, heading); this.updateLegend();
    }
    // the focus (a picture built around some nodes) is a part of the settings
    panelFocus(p, heading) {
      if (!STORE.focusKeys.length) return;
      heading("Фокус", "lucide-focus");
      const nm = STORE.focusKeys.length === 1 ? STORE.focusKeys[0].split("/").pop().replace(/[.]md$/, "") : plural(STORE.focusKeys.length);
      new (api2().Setting)(p).setName(nm).setDesc(STORE.fdepth + " ур. окружения")
        .addExtraButton((b) => b.setIcon("lucide-minus").setTooltip("Меньше окружения").onClick(() => { STORE.fdepth = Math.max(0, STORE.fdepth - 1); saveStore(); this.afterState(); }))
        .addExtraButton((b) => b.setIcon("lucide-plus").setTooltip("Больше окружения").onClick(() => { STORE.fdepth = Math.min(6, STORE.fdepth + 1); saveStore(); this.afterState(); }))
        .addExtraButton((b) => b.setIcon("lucide-x").setTooltip("Показать весь граф").onClick(() => this.clearFocus()));
    }
    setMode(m) { const was = this.c.view; this.c.view = m === "3d" ? "3d" : "2d"; save(this.c); if (this.ready && this.W && was !== this.c.view) { this.fade = null; this.anim = { t0: performance.now(), dur: 750, img: this.snap("A") }; } this.ex && this.ex.ge_set_mode(this.c.view === "3d" ? 3 : 2); for (const k in this.segBtns) this.segBtns[k].classList.toggle("is-on", k === this.c.view); this.running = true; this.dirty = true; }
    style() {
      if (!this.ex) return; const c = this.c;
      this.ex.ge_set_style(cssColor("--background-primary", "#14161a"), cssColor("--text-faint", "#4a5260"), cssColor("--text-muted", "#c8ced8"), cssColor("--interactive-accent", "#c98d5b"), cssColor("--text-faint", "#5a606c"), 0, c.labelMode !== "none" && !this.growLabels ? 1 : 0, c.labelMode === "all" ? 0 : (this.nodesTotal > 400 ? 6 : this.nodesTotal > 150 ? 4 : this.nodesTotal > 60 ? 3 : 0), c.nodeScale, c.edgeAlpha);
      this.bgCss = "rgba(" + [(cssColor("--background-primary", "#14161a") >> 16) & 255, (cssColor("--background-primary", "#14161a") >> 8) & 255, cssColor("--background-primary", "#14161a") & 255] + ",.85)";
      { const n2 = (v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255]; this.bgRgb = n2(cssColor("--background-primary", "#14161a")); this.accRgb = n2(cssColor("--interactive-accent", "#c98d5b")); this.accentCss = "rgb(" + this.accRgb + ")"; this.isDark = document.body.classList.contains("theme-dark"); }
      this.dirty = true;
    }
    // the engine colours groups with its own colours; here they become Basalt's: copper, sand, steel, moss, amethyst, rose
    tone(key) {
      const m = this.tones || (this.tones = new Map());
      let t = m.get(key); if (t) return t;
      const P = [[201, 141, 91], [220, 205, 185], [110, 150, 190], [127, 190, 139], [175, 140, 235], [225, 120, 120], [230, 190, 90], [90, 190, 190]];
      const rgb = P[m.size % P.length], mix = (a, k) => a.map((v) => Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)));
      t = { hi: "rgb(" + mix(rgb, 0.45) + ")", lo: "rgb(" + mix(rgb, -0.12) + ")", rim: "rgba(" + mix(rgb, -0.55) + ",.9)" };
      m.set(key, t); return t;
    }
    forces() { this.ex.ge_set_params(this.c.repulsion, this.c.linkDistance, this.c.linkStrength, 1); this.running = true; }

    // ---- data
    rebuild() {
      if (!this.ready || !this.ex) return;
      const g = this.g = vaultGraph(this.app, this.c, this.anchor, type === "localgraph");
      const sig = g.nodes.map((x) => x.key).join("|") + "#" + g.edges.map((e) => e[0] + "-" + e[1]).join(",");
      if (sig === this.sig) return; /* nothing changed: do not restart the layout */
      this.sig = sig;
      const ex = this.ex, n = g.nodes.length, m = g.edges.length, words = 2 + n * 3 + m * 2;
      const folders = new Map(); g.nodes.forEach((x) => { if (!folders.has(x.folder)) folders.set(x.folder, folders.size); });
      const bytes = new TextEncoder().encode(g.nodes.map((x) => x.name.replace(/\n/g, " ")).join("\n"));
      const pw = ex.ge_input(words), pb = ex.ge_bytes(bytes.length || 1);
      const u = new Uint32Array(ex.memory.buffer, pw, words), f = new Float32Array(ex.memory.buffer, pw, words);
      u[0] = n; u[1] = m;
      g.nodes.forEach((x, i) => { u[2 + i * 3] = folders.get(x.folder); f[3 + i * 3] = 1; u[4 + i * 3] = x.unresolved ? 1 : 0; });
      g.edges.forEach(([a, b], k) => { u[2 + n * 3 + k * 2] = a; u[3 + n * 3 + k * 2] = b; });
      new Uint8Array(ex.memory.buffer, pb, bytes.length).set(bytes);
      this.nodesTotal = n; this.order = g.nodes.map((_, i) => i).sort((a, b) => { const da = this.adjOf(a).size, db = this.adjOf(b).size; return db - da; }); this.path = null; this.pathPick = -1; this.style(); this.forces();
      const grow = false; /* the growing intro is off: the graph opens already laid out */ /* the first picture is watched growing: a tight knot that the forces push out, links stretching as it goes */
      this.introDone = true;
      ex.ge_set_intro(grow ? 0 : -1, grow ? 0.5 : 1); ex.ge_lock_bounds(grow ? 1 : 0); ex.ge_set_max_step(grow ? 5 : 0); this.grow = grow ? performance.now() : 0; this.growLabels = grow;
      if (!grow && this.keyIndex) { const pk = ex.ge_keep(n || 1), ku = new Uint32Array(ex.memory.buffer, pk, n || 1); g.nodes.forEach((x, k) => { ku[k] = this.keyIndex.has(x.key) ? this.keyIndex.get(x.key) : 0xffffffff; }); } /* the layout keeps its places: a change moves only what changed */
      const prevSel = this.sel >= 0 && this.oldNodes ? this.oldNodes[this.sel] : null;
      // the finished positions are computed out of sight; the eye only sees them move there (the first picture spreads from the centre, outwards)
      const mode = this.regroup ? 3 : (this.tweenedOnce ? 2 : 1); this.tweenedOnce = true; this.regroup = false;
      ex.ge_set_tween(mode, mode === 1 ? 3200 : mode === 3 ? 1300 : 800);
      ex.ge_set_graph(words, bytes.length);
      if (mode === 1) { this.cv.style.transition = "none"; this.cv.style.opacity = "0"; requestAnimationFrame(() => requestAnimationFrame(() => { this.cv.style.transition = "opacity .3s ease"; this.cv.style.opacity = "1"; })); }
      this.keyIndex = new Map(g.nodes.map((x, k) => [x.key, k])); this.oldNodes = g.nodes.map((x) => x.key);
      this.hover = -1; this.hlTo = undefined; { const k = prevSel && this.keyIndex.has(prevSel) ? this.keyIndex.get(prevSel) : -1; this.sel = k; ex.ge_select(k, 1); this.cardFor(k); }
      this.tweening = n > 0; this.running = false; this.lastT = performance.now(); this.growLabels = n > 0; this.style(); ex.ge_freeze_bounds(1); this.frozen = true; this.dirty = true; this.updateEmpty(n); this.calcRecent(); this.tlRefresh(); this.updateLegend(); this.pinned = new Set();
    }

    // ---- pointer
    bind() {
      const cv = this.cv, at = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      let drag = null;
      cv.addEventListener("pointerdown", (e) => {
        if (e.button > 2) return; e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (err) { /* a pointer that is already gone */ }
        const [x, y] = at(e), hit = this.pickAt(x, y, this.W, this.H);
        drag = { x, y, lx: x, ly: y, node: e.button === 0 && this.c.view === "2d" && !e.shiftKey ? hit : -1, hit, moved: false, button: e.button };
      });
      cv.addEventListener("pointermove", (e) => {
        const [x, y] = at(e);
        if (!drag) { this.pointer = [x, y]; this.pickPending = true; return; }
        if (Math.hypot(x - drag.x, y - drag.y) > 3) drag.moved = true;
        if (!drag.moved) return;
        if (drag.node >= 0) this.ex.ge_pin(drag.node, x, y); else this.ex.ge_drag(x - drag.lx, y - drag.ly);
        drag.lx = x; drag.ly = y; this.running = this.running || drag.node >= 0; this.dirty = true;
      });
      const end = (e) => {
        if (!drag) return; const d = drag; drag = null;
        if (d.node >= 0 && d.moved) (this.pinned || (this.pinned = new Set())).add(d.node); /* a dragged node stays where it is put (a pin mark; the menu lets it go) */
        if (!d.moved && d.button === 0 && this.pathPick >= 0 && d.hit >= 0 && d.hit !== this.pathPick) { this.pathFind(this.pathPick, d.hit); this.lastDrag = { moved: false, t: performance.now() }; return; }
        if (!d.moved && d.button === 0) {
          if (e && e.shiftKey && d.hit >= 0) { this.multi = this.multi || new Set(); this.multi.has(d.hit) ? this.multi.delete(d.hit) : this.multi.add(d.hit); this.dirty = true; }
          else { if (this.multi && this.multi.size) { this.multi = new Set(); this.dirty = true; } this.setSel(d.hit, d.hit >= 0); }
        }
        this.lastDrag = { moved: d.moved, t: performance.now() };
      };
      cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
      cv.addEventListener("contextmenu", (e) => { e.preventDefault(); if (this.lastDrag && this.lastDrag.moved && performance.now() - this.lastDrag.t < 400) return; const [x, y] = at(e); this.showMenu(e.clientX, e.clientY, this.pickAt(x, y, this.W, this.H)); });
      cv.addEventListener("dblclick", (e) => { const [x, y] = at(e), hit = this.pickAt(x, y, this.W, this.H); if (hit >= 0) this.openNote(hit, e.ctrlKey || e.metaKey); else this.fitView(); });
      // the wheel adds to a pending zoom that is played out over a few frames: smooth instead of stepping
      cv.addEventListener("wheel", (e) => { e.preventDefault(); const [x, y] = at(e); this.zoomAt = [x, y]; this.zoomAcc = (this.zoomAcc || 0) + Math.max(-3, Math.min(3, e.deltaY / 100)); this.dirty = true; }, { passive: false });
      this.root.tabIndex = 0; this.root.style.outline = "none";
      cv.addEventListener("pointerdown", () => { this.closeMenu(); this.panel.classList.remove("is-open"); this.root.focus({ preventScroll: true }); }, true);
      this.root.addEventListener("keydown", (e) => {
        const tag = (e.target && e.target.tagName) || ""; if (/INPUT|TEXTAREA/.test(tag)) return;
        if (e.key === "Escape") { if (this.path || this.pathPick >= 0 || this.pathMsg) { this.clearPath(); e.preventDefault(); return; } if (this.menuEl) this.closeMenu(); else if (this.panel.classList.contains("is-open") || this.helpEl.classList.contains("is-open")) { this.panel.classList.remove("is-open"); this.helpEl.classList.remove("is-open"); } else { this.multi = new Set(); this.setSel(-1); } e.preventDefault(); }
        else if ((e.key === "f" || e.key === "F" || e.code === "KeyF" || e.key === "/") && (e.ctrlKey || e.metaKey || e.key === "/")) { e.preventDefault(); this.searchEl.focus(); this.searchEl.select(); }
        else if (e.code === "Digit0" || e.key === "Home") { this.fitView(); e.preventDefault(); }
        else if ((e.key === "Delete" || e.key === "Backspace") && (this.sel >= 0 || (this.multi && this.multi.size))) { this.hideNodes(this.multi && this.multi.size ? Array.from(this.multi) : [this.sel]); e.preventDefault(); }
      });
    }
    openNote(i, newTab) { const n = this.g.nodes[i]; if (!n) return; if (n.file) mainLeaf(newTab).openFile(n.file); else if (n.unresolved) this.app.workspace.openLinkText(n.name, "", true); }

    // ---- frame
    frame() {
      const ex = this.ex; if (!ex) return;
      const r = this.cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      if (w !== this.W || h !== this.H || dpr !== this.dpr) { this.W = w; this.H = h; this.dpr = dpr; this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr); this.dirty = true; }
      const now = performance.now(), ease = (t) => 1 - Math.pow(1 - Math.min(1, t), 3);
      const hoverTo = (hit) => { this.fadeNow(); this.hover = hit; this.cv.style.cursor = hit >= 0 ? "pointer" : ""; this.dirty = true; };
      if (this.pickPending && this.pointer) { this.pickPending = false; const hit = this.pickAt(this.pointer[0], this.pointer[1], w, h); if (hit !== this.hover) { if (hit < 0) this.leaveAt = this.leaveAt || now + 90; else { this.leaveAt = 0; if (hit !== this.wantHover) { this.wantHover = hit; this.wantAt = now + 35; } } } else { this.leaveAt = 0; this.wantHover = -2; } }
      if (this.wantHover >= 0 && now >= this.wantAt) { const hh = this.wantHover; this.wantHover = -2; if (hh !== this.hover) hoverTo(hh); }
      if (this.leaveAt && now >= this.leaveAt) { this.leaveAt = 0; hoverTo(-1); } /* a pointer that slips off a node for a moment does not make the whole graph flash */
      if (this.zoomAcc && Math.abs(this.zoomAcc) > 0.004) { const step = this.zoomAcc * 0.3; this.zoomAcc -= step; ex.ge_zoom(this.zoomAt[0], this.zoomAt[1], this.c.view === "3d" ? -step : step); this.dirty = true; } else if (this.zoomAcc) this.zoomAcc = 0;
      if (this.tweening) { const dt = Math.min(50, now - (this.lastT || now)); const more = ex.ge_tween_step(dt); this.dirty = true; if (!more) { this.tweening = false; this.growLabels = false; this.labelA = 0; this.labelT0 = now; this.style(); } }
      if (this.labelT0) { const kk = Math.min(1, (now - this.labelT0) / 500); this.labelA = kk; this.dirty = true; if (kk >= 1) this.labelT0 = 0; }
      this.lastT = now;
      if (this.running) { if (this.frozen !== false) { this.frozen = false; ex.ge_freeze_bounds(0); } const settled = ex.ge_step(this.grow ? 2 : this.g.nodes.length > 2500 ? 1 : 2); this.dirty = true; if (this.grow && (settled || now - this.grow > 4500)) { this.grow = 0; ex.ge_lock_bounds(0); ex.ge_set_max_step(0); this.growLabels = false; this.style(); } if (settled) { this.running = false; setTimeout(() => { if (this.ex && !this.running) { this.ex.ge_freeze_bounds(1); this.frozen = true; } }, 900); } }
      if (!this.dirty) return;
      this.dirty = false;
      if (this.anim && now - this.anim.t0 >= this.anim.dur) this.anim = null;
      if (this.fade && now - this.fade.t0 >= this.fade.dur) this.fade = null;
      // the highlight eases in and out: both states are drawn live (same positions, no stale picture) and blended
      const target = this.hover >= 0 ? this.hover : this.sel;
      if (this.hlTo === undefined) this.hlTo = this.hlFrom = target;
      if (target !== this.hlTo) { this.hlFrom = this.hlTo; this.hlTo = target; this.hlT0 = now; }
      const hk = Math.min(1, (now - this.hlT0) / 200), fading = !this.anim && hk < 1 && this.hlFrom !== this.hlTo, blend = fading && this.c.view !== "2d";
      this.hlK = fading ? ease(hk) : 1; if (fading) this.dirty = true;
      if (blend) { this.dirty = true; this.paintBlend(ex, w, h, dpr, target, ease(hk)); this.halos(ex); this.drawGroups(ex); this.drawThumbs(ex); this.status.innerHTML = this.statusHtml(); return; }
      ex.ge_select(target, 1);
      const layered = !!(this.anim || this.fade);
      if (layered) this.dirty = true;
      const ptr = ex.ge_render(w, h, this.hover >= 0 ? this.hover : this.sel), len = ex.ge_out_len();
      const main = this.ctx;
      if (layered) { if (!this.buf || this.buf.width !== this.cv.width || this.buf.height !== this.cv.height) { this.buf = document.createElement("canvas"); this.buf.width = this.cv.width; this.buf.height = this.cv.height; } this.ctx = this.buf.getContext("2d"); }
      if (this.c.view === "2d") this.paint2d(ex, w, h, dpr); else { this.P2 = null; this.paint(new Float32Array(ex.memory.buffer, ptr, len), w, h, dpr); this.halos(ex); this.drawGroups(ex); this.drawThumbs(ex); }
      this.ctx = main;
      if (layered) this.compose(now, ease);
      const st = (this.running ? "считается" : "готов");
      this.status.innerHTML = this.statusHtml();
    }
    statusHtml() { return `<span>Узлов <b>${this.g.nodes.length}</b></span><span>Связей <b>${this.g.edges.length}</b></span><span>${this.c.view.toUpperCase()}</span><span>${this.running ? "считается" : "готов"}</span>`; }
    paintBlend(ex, w, h, dpr, target, k) {
      const main = this.ctx, W = this.cv.width, H = this.cv.height;
      const lay = (name) => { let b = this[name]; if (!b || b.width !== W || b.height !== H) { b = this[name] = document.createElement("canvas"); b.width = W; b.height = H; } return b; };
      const draw = (canvas, id) => { ex.ge_select(id, 1); const ptr = ex.ge_render(w, h, id), len = ex.ge_out_len(); this.ctx = canvas.getContext("2d"); this.paint(new Float32Array(ex.memory.buffer, ptr, len), w, h, dpr); };
      const A = lay("blA"), B = lay("blB");
      draw(A, this.hlFrom); draw(B, this.hlTo);
      this.ctx = main; main.setTransform(1, 0, 0, 1, 0, 0); main.clearRect(0, 0, W, H);
      main.globalAlpha = 1 - k; main.drawImage(A, 0, 0); main.globalAlpha = k; main.drawImage(B, 0, 0); main.globalAlpha = 1;
      main.setTransform(dpr, 0, 0, dpr, 0, 0); /* the rings and thumbnails that follow are drawn in CSS pixels */
      ex.ge_select(target, 1);
    }
    // pictures and canvases are drawn as what they are: a round picture, a small preview of the canvas
    thumb(n) {
      const m = this.thumbs || (this.thumbs = new Map()); let t = m.get(n.key); const f = n.file; if (!f) return null;
      if (t) return t.bmp ? t : null;
      t = { bmp: null }; m.set(n.key, t);
      const load = n.kind === "board" ? Promise.resolve(window.__bsBoardThumb ? window.__bsBoardThumb(f, 256) : null).then((r) => (r && r.bmp ? createImageBitmap(r.bmp) : null)) : n.kind === "canvas" ? Promise.resolve(window.__fpRenderNested ? window.__fpRenderNested(f, 256) : null).then((r) => (r && r.bmp ? createImageBitmap(r.bmp) : null)) /* our own copy: the canvas module may close its bitmaps */
        : fetch(this.app.vault.getResourcePath(f)).then((r) => r.blob()).then((b) => createImageBitmap(b, { resizeWidth: 160, resizeQuality: "medium" }));
      load.then((b) => { if (b) { t.bmp = b; this.dirty = true; } }).catch(() => {});
      return null;
    }
    drawThumbs(ex, pal) {
      // Basalt's shape: the top-left and bottom-right corners are cut
      const cut = (c, x, y, w, h, k) => { c.roundRect(x, y, w, h, 5); };
      if (!this.g.nodes.some((x) => x.kind !== "note") || (!this.c.thumbImg && !this.c.thumbCanvas)) { this.thumbRects = []; return; }
      const c = this.ctx, target = this.hlTo === undefined ? -1 : this.hlTo, nbs = target >= 0 ? this.adjOf(target) : null;
      const sc = this.c.nodeScale, acc = this.accentCss || "#c98d5b";
      let drawn = 0; this.thumbRects = [];
      for (let i = 0; i < this.g.nodes.length && drawn < 260; i++) {
        const n = this.g.nodes[i]; if (n.kind === "note" || !n.file) continue;
        if (n.kind === "img" ? !this.c.thumbImg : !this.c.thumbCanvas) continue; /* switched off: the plain shape shows */
        let x, y; if (this.P2) { x = this.P2[2 * i]; y = this.P2[2 * i + 1]; } else { if (!ex.ge_screen_of(i)) continue; const f = new Float32Array(ex.memory.buffer, ex.ge_input(2), 2); x = f[0]; y = f[1]; }
        if (this.P2 && this.al[i] <= 0.01) continue;
        if (x < -40 || y < -40 || x > this.W + 40 || y > this.H + 40) continue;
        const t = this.thumb(n); drawn++; { const hw = n.kind === "img" ? 18 * sc : 28 * sc * 0.9, hh2 = n.kind === "img" ? 18 * sc : 14 * sc; this.thumbRects.push([i, x - hw, y - hh2, x + hw, y + hh2]); }
        const hot = i === target;
        c.save(); c.globalAlpha = this.alphaOf(i); try {
        if (n.kind === "img") {
          const r = 18 * sc, q = 6; c.beginPath(); cut(c, x - r, y - r, r * 2, r * 2, Math.min(8, r * 0.4)); c.save(); c.clip();
          if (t) { const s2 = (r * 2) / Math.min(t.bmp.width, t.bmp.height); c.drawImage(t.bmp, x - (t.bmp.width * s2) / 2, y - (t.bmp.height * s2) / 2, t.bmp.width * s2, t.bmp.height * s2); } else { c.fillStyle = "rgba(128,128,128,.4)"; c.fill(); }
          c.restore(); c.lineWidth = hot ? 2.5 : 1.5; c.strokeStyle = hot ? acc : "rgba(255,255,255,.35)"; c.beginPath(); cut(c, x - r, y - r, r * 2, r * 2, Math.min(8, r * 0.4)); c.stroke();
        } else {
          const ratio = t ? t.bmp.width / t.bmp.height : 1.4, hh = 28 * sc, ww = hh * Math.min(2, Math.max(0.7, ratio)), r = 5;
          c.beginPath(); cut(c, x - ww / 2, y - hh / 2, ww, hh, Math.min(8, hh * 0.28)); c.fillStyle = "rgba(20,20,24,.85)"; c.fill(); c.save(); c.clip();
          if (t) c.drawImage(t.bmp, x - ww / 2 + 1, y - hh / 2 + 1, ww - 2, hh - 2); c.restore();
          c.lineWidth = hot ? 2.5 : 1.5; c.strokeStyle = acc; c.beginPath(); cut(c, x - ww / 2, y - hh / 2, ww, hh, Math.min(8, hh * 0.28)); c.stroke();
        }
        } catch (err) { /* a detached bitmap: forget it, it is loaded again */ if (this.thumbs) this.thumbs.delete(n.key); this.dirty = true; }
        c.restore();
      }
    }
    pickAt(x, y, w, h) { for (const [i, x0, y0, x1, y1] of this.thumbRects || []) if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return i; if (this.c.view === "2d" && this.P2) return this.pick2d(x, y); return this.ex.ge_pick(x, y, w, h); }
    // how bright a node drawn over the engine's picture is: the same fade as the engine's own highlight (between the old and the new state)
    alphaOf(i) {
      if (this.P2 && this.al) return this.al[i];
      const lit = (id) => (id === undefined || id < 0 || i === id || this.adjOf(id).has(i) ? 1 : 0);
      const a = lit(this.hlFrom), b = lit(this.hlTo), k = this.hlK === undefined ? 1 : this.hlK;
      return 0.17 + 0.83 * (a + (b - a) * k);
    }
    adjOf(i) { if (!this.adj || this.adjFor !== this.g) { this.adjFor = this.g; this.adj = this.g.nodes.map(() => new Set()); this.g.edges.forEach(([a, b]) => { this.adj[a].add(b); this.adj[b].add(a); }); } return this.adj[i]; }
    // select a node: highlight its neighbourhood, show its card and bring it to the middle of the window (2D)
    setSel(i, center) {
      this.sel = i; this.dirty = true; this.cardFor(i);
      if (center && i >= 0 && this.c.view === "2d") this.glide(i);
    }
    glide(i) {
      const ex = this.ex, t0 = performance.now(), dur = 420; let done = 0; const g = ++this.glideId || (this.glideId = 1);
      const step = () => {
        if (!this.alive || this.glideId !== g) return;
        if (!ex.ge_screen_of(i)) return; const f = new Float32Array(ex.memory.buffer, ex.ge_input(2), 2);
        const k = Math.min(1, (performance.now() - t0) / dur), e = 1 - Math.pow(1 - k, 3), want = e - done;
        ex.ge_drag((this.W / 2 - f[0]) * (want / Math.max(0.0001, 1 - done)), (this.H / 2 - f[1]) * (want / Math.max(0.0001, 1 - done)));
        done = e; this.dirty = true; if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
    // a picture (or the first picture of a note, or the canvas drawn small) at the top of the card
    cardPreview(n, el) {
      this.pvToken = (this.pvToken || 0) + 1; if (this.pvLive) { this.pvLive.destroy(); this.pvLive = null; }
      const f = n.file; if (!f) return;
      const box = document.createElement("div"); box.className = "pv"; let src = null;
      const IM = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;
      if (n.kind === "img") src = this.app.vault.getResourcePath(f);
      else if (n.kind === "note") { const cache = this.app.metadataCache.getFileCache(f), em = ((cache && cache.embeds) || []).find((e) => IM.test(e.link)); const t = em && this.app.metadataCache.getFirstLinkpathDest(em.link.split("#")[0], f.path); if (t) src = this.app.vault.getResourcePath(t); }
      if (src) { const im = document.createElement("img"); im.src = src; box.appendChild(im); el.appendChild(box); }
      else if (n.kind === "board" && window.__bsBoardThumb) { el.appendChild(box); window.__bsBoardThumb(f, 520).then((r) => { if (r && r.bmp && box.isConnected) { r.bmp.style.cssText = "width:100%;height:auto;display:block"; box.appendChild(r.bmp); } }); }
      else if (n.kind === "canvas" && window.__fpMountPreview) { el.appendChild(box); const my = this.pvToken = (this.pvToken || 0) + 1; window.__fpMountPreview(f, box).then((P) => { if (!P) return; if (my !== this.pvToken || !box.isConnected) { P.destroy(); return; } this.pvLive = P; }); }
    }
    // groups you make yourself and the notes you hid: both live in the panel and in the right-click menu
    panelGroups(p, heading) {
      const S = api2().Setting; heading("Группы", "lucide-folder-tree");
      const counts = {}; for (const k of Object.values(STORE.assign)) counts[k] = (counts[k] || 0) + 1;
      const apply = () => { this.regroup = true; this.sig = null; this.rebuild(); this.buildPanel(); };
      if (!STORE.groups.length) new S(p).setDesc("Групп нет");
      for (const g of STORE.groups) {
        const st = new S(p).setName(g.name).setDesc(plural(counts[g.id] || 0));
        st.settingEl.toggleClass("bsg-off", !!g.hidden); st.settingEl.toggleClass("bsg-solo", STORE.solo.includes(g.id));
        if (!g.system) {
          let recT = 0;
          st.addColorPicker((cp) => cp.setValue(g.color).onChange((v) => { g.color = v; saveStore(); this.dirty = true; clearTimeout(recT); recT = setTimeout(() => window.__bsRecent && window.__bsRecent.add(v), 700); }));
          if (window.__bsRecent && window.__bsRecent.get().length) st.addExtraButton((b) => b.setIcon("lucide-history").setTooltip("Недавние цвета").onClick(() => {
            const m = new (api2().Menu)();
            for (const c of window.__bsRecent.get()) m.addItem((i) => { i.setTitle(c); try { const sw = document.createElement("span"); sw.style.cssText = "display:inline-block;width:12px;height:12px;margin-right:8px;background:" + c; (i.dom || i.titleEl).querySelector(".menu-item-title").prepend(sw); } catch (e) { /* no swatch */ } i.onClick(() => { g.color = c; saveStore(); this.dirty = true; window.__bsRecent.add(c); this.buildPanel(); }); });
            const r = b.extraSettingsEl.getBoundingClientRect(); m.showAtPosition({ x: r.left, y: r.bottom });
          }));
        }
        st.addExtraButton((b) => b.setIcon(g.hidden ? "lucide-eye-off" : "lucide-eye").setTooltip(g.hidden ? "Показать группу" : "Скрыть группу").onClick(() => { g.hidden = !g.hidden; if (g.hidden) STORE.solo = STORE.solo.filter((x) => x !== g.id); saveStore(); apply(); }));
        st.addExtraButton((b) => b.setIcon("lucide-focus").setTooltip("Показать только эту группу (Shift: добавить ещё)").onClick(() => {
          const on = STORE.solo.includes(g.id), sh = window.event && window.event.shiftKey;
          if (sh) STORE.solo = on ? STORE.solo.filter((x) => x !== g.id) : [...STORE.solo, g.id]; else STORE.solo = on && STORE.solo.length === 1 ? [] : [g.id];
          if (STORE.solo.length) g.hidden = false; saveStore(); apply();
        }));
        if (!g.system) st.addExtraButton((b) => b.setIcon("lucide-trash-2").setTooltip("Удалить группу").onClick(() => { STORE.groups = STORE.groups.filter((x) => x !== g); STORE.solo = STORE.solo.filter((x) => x !== g.id); for (const k of Object.keys(STORE.assign)) if (STORE.assign[k] === g.id) delete STORE.assign[k]; saveStore(); apply(); }));
        if (!g.system) { const nameInput = st.nameEl; nameInput.setAttribute("contenteditable", "true"); nameInput.addEventListener("blur", () => { const t = nameInput.textContent.trim(); if (t && t !== g.name) { g.name = t; saveStore(); } }); nameInput.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); nameInput.blur(); } }); }
      }
      if (STORE.solo.length) {
        // only the chosen groups are shown, plus what is around them: how far, and how many at most
        new S(p).setName("Уровней от группы").addSlider((sl) => sl.setLimits(0, 5, 1).setValue(STORE.depth).setDynamicTooltip().onChange((v) => { STORE.depth = v; clearTimeout(this.focT); this.focT = setTimeout(() => { saveStore(); this.regroup = true; this.sig = null; this.rebuild(); }, 250); }));
        new S(p).setName("Узлов не больше").addSlider((sl) => sl.setLimits(10, 500, 10).setValue(STORE.max).setDynamicTooltip().onChange((v) => { STORE.max = v; clearTimeout(this.focT); this.focT = setTimeout(() => { saveStore(); this.regroup = true; this.sig = null; this.rebuild(); }, 250); }));
        new S(p).addButton((b) => b.setButtonText("Показать весь граф").onClick(() => this.clearFocus()));
      }
      new S(p).setName("Новая группа").addButton((b) => b.setIcon("lucide-plus").setTooltip("Создать группу").onClick(() => { this.newGroup("", Array.from(this.multi || []).map((i) => this.g.nodes[i] && this.g.nodes[i].key).filter(Boolean)); }));
    }
    newGroup(name, keys) {
      const uniqueName = () => { let i = STORE.groups.length + 1; while (STORE.groups.some((x) => x.name === "Группа " + i)) i++; return "Группа " + i; };
      const g = { id: "g" + Date.now().toString(36), name: name || uniqueName(), color: GROUP_COLORS[STORE.groups.length % GROUP_COLORS.length] };
      STORE.groups.push(g); for (const k of keys) STORE.assign[k] = g.id; saveStore(); this.buildPanel(); this.dirty = true; return g;
    }
    groupOf(n) { const id = STORE.assign[n.key]; return id ? STORE.groups.find((g) => g.id === id) : null; }
    // which nodes a command applies to: the ones marked with Shift, if the node under the pointer is one of them
    targets(hit) { if (hit >= 0 && this.multi && this.multi.size > 1 && this.multi.has(hit)) return Array.from(this.multi); return hit >= 0 ? [hit] : []; }
    hideNodes(idx) { const g = hiddenGroup(); g.hidden = true; for (const i of idx) { const n = this.g.nodes[i]; if (n) STORE.assign[n.key] = g.id; } this.multi = new Set(); this.sel = -1; saveStore(); this.sig = null; this.rebuild(); this.buildPanel(); }
    // the picture built around some nodes (not a group): they are shown with what is around them; a bar at the top says so and ends it
    focusOn(idx) { STORE.focusKeys = idx.map((i) => this.g.nodes[i] && this.g.nodes[i].key).filter(Boolean); STORE.fdepth = 1; saveStore(); this.afterState(); this.helpEl.classList.remove("is-open"); }
    clearFocus() { STORE.focusKeys = []; STORE.solo = []; saveStore(); this.afterState(); }
    afterState() { this.regroup = true; this.sig = null; this.rebuild(); this.buildPanel(); this.updateFocusBar(); }
    updateFocusBar() { /* the focus lives in the settings now */ }
    closeMenu() { if (this.menu) { try { this.menu.hide(); } catch (e) { /* closed */ } this.menu = null; } }
    showMenu(cx, cy, hit) {
      this.closeMenu();
      const Menu = api2().Menu, m = this.menu = new Menu();
      const tg = this.targets(hit), many = tg.length > 1, nodes = tg.map((i) => this.g.nodes[i]).filter(Boolean);
      const add = (menu, title, icon, fn, o = {}) => menu.addItem((it) => { it.setTitle(title).setIcon(icon).onClick(fn); if (o.checked) it.setChecked(true); if (o.disabled) it.setDisabled(true); if (o.section) it.setSection(o.section); });
      if (nodes.length) {
        if (!many && nodes[0].file) { add(m, "Открыть", "lucide-file-text", () => this.openNote(hit, false)); add(m, "Открыть в новой вкладке", "lucide-file-plus", () => this.openNote(hit, true)); add(m, "Показать в папке", "lucide-folder-open", () => this.revealNode(hit)); add(m, "Копировать ссылку", "lucide-link", () => this.copyLink(hit)); m.addSeparator(); }
        if (!many && nodes[0].kind === "tag") { add(m, "Показать только этот тег", "lucide-tag", () => { this.c.tagOnly = nodes[0].name.slice(1); save(this.c); this.rebuild(); this.buildPanel(); }); m.addSeparator(); }
        if (!many) { add(m, "Как связаны с…", "lucide-route", () => this.startPath(hit)); add(m, "Выбрать соседей", "lucide-network", () => { this.multi = new Set([hit, ...this.adjOf(hit)]); this.dirty = true; }); if (this.pinned && this.pinned.has(hit)) add(m, "Открепить узел", "lucide-pin-off", () => this.unpin(hit)); m.addSeparator(); }
        if (tg.length === 2) { add(m, "Как связаны эти два узла", "lucide-route", () => this.pathFind(tg[0], tg[1])); m.addSeparator(); }
        m.addItem((it) => {
          it.setTitle("Группа").setIcon("lucide-folder-tree"); const sub = it.setSubmenu();
          for (const g of STORE.groups) { if (g.system) continue; sub.addItem((x) => x.setTitle(g.name).setIcon("lucide-circle").setChecked(nodes.every((n) => STORE.assign[n.key] === g.id)).onClick(() => { for (const n of nodes) STORE.assign[n.key] = g.id; saveStore(); this.buildPanel(); this.dirty = true; })); }
          if (STORE.groups.some((g) => !g.system)) sub.addSeparator();
          sub.addItem((x) => x.setTitle("Новая группа…").setIcon("lucide-plus").onClick(() => this.newGroup("", nodes.map((n) => n.key))));
          if (nodes.some((n) => STORE.assign[n.key])) sub.addItem((x) => x.setTitle("Убрать из группы").setIcon("lucide-minus").onClick(() => { for (const n of nodes) delete STORE.assign[n.key]; saveStore(); this.buildPanel(); this.dirty = true; }));
        });
        m.addItem((it) => { it.setTitle("Цвет").setIcon("lucide-palette"); const sub = it.setSubmenu(); for (const [nm, hex] of NODE_COLORS) sub.addItem((x) => { x.setTitle(nm).setIcon("lucide-circle").onClick(() => this.setNodeColor(nodes, hex, nm)); try { const ic = x.dom.querySelector(".menu-item-icon"); ic.style.color = hex; ic.style.fill = hex; } catch (e) { /* plain icon */ } }); sub.addSeparator(); sub.addItem((x) => x.setTitle("Без цвета").setIcon("lucide-circle-off").onClick(() => this.setNodeColor(nodes, "", ""))); });
        m.addSeparator();
        add(m, many ? "Скрыть выбранные" : "Скрыть", "lucide-eye-off", () => this.hideNodes(tg));
        add(m, many ? "Показать только их и окружение" : "Показать только его и окружение", "lucide-focus", () => this.focusOn(tg));
        if (this.multi && this.multi.size) { m.addSeparator(); add(m, "Снять выбор", "lucide-x", () => { this.multi = new Set(); this.dirty = true; }); }
      } else {
        add(m, "Вписать в окно", "lucide-locate-fixed", () => this.fitView());
        if (STORE.solo.length || STORE.focusKeys.length) add(m, "Показать весь граф", "lucide-eye", () => this.clearFocus());
        add(m, "Новая группа…", "lucide-plus", () => this.newGroup("", Array.from(this.multi || []).map((i) => this.g.nodes[i] && this.g.nodes[i].key).filter(Boolean)));
        add(m, "Настройки графа", "lucide-settings", () => this.panel.classList.add("is-open"));
        if (this.multi && this.multi.size) { m.addSeparator(); add(m, "Снять выбор", "lucide-x", () => { this.multi = new Set(); this.dirty = true; }); }
      }
      m.showAtPosition({ x: cx, y: cy });
    }
    // nodes of your own groups are drawn over the engine's balls in the colour of the group; marked nodes get a ring
    drawGroups(ex) {
      const hasG = STORE.groups.length && this.g.nodes.some((n) => STORE.assign[n.key]), hasM = this.multi && this.multi.size;
      if (!hasG && !hasM) return;
      const c = this.ctx, target = this.hlTo === undefined ? -1 : this.hlTo, nbs = target >= 0 ? this.adjOf(target) : null, sc = this.c.nodeScale;
      const mix = (hex, k) => { const v = [1, 3, 5].map((o) => parseInt(hex.slice(o, o + 2), 16)); return "rgb(" + v.map((x) => Math.round(k > 0 ? x + (255 - x) * k : x * (1 + k))) + ")"; };
      for (let i = 0; i < this.g.nodes.length; i++) {
        const n = this.g.nodes[i], g = this.groupOf(n), marked = hasM && this.multi.has(i);
        if (!g && !marked) continue;
        if (!ex.ge_screen_of(i)) continue; const f = new Float32Array(ex.memory.buffer, ex.ge_input(2), 2), x = f[0], y = f[1];
        if (x < -30 || y < -30 || x > this.W + 30 || y > this.H + 30) continue;
        const deg = this.adjOf(i).size, r = Math.min((3.2 + 2.6 * Math.sqrt(deg)) * sc, 16 * Math.max(sc, 0.6));
        c.save(); c.globalAlpha = this.alphaOf(i);
        if (g && n.kind === "note" && this.c.view === "2d") { const gr = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r); gr.addColorStop(0, mix(g.color, 0.45)); gr.addColorStop(1, mix(g.color, -0.12)); c.fillStyle = gr; c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill(); c.lineWidth = 1; c.strokeStyle = mix(g.color, -0.55); c.stroke(); }
        else if (g) { c.lineWidth = 2; c.strokeStyle = g.color; c.beginPath(); c.arc(x, y, this.c.view === "3d" ? 9 : r + 5, 0, 6.2832); c.stroke(); }
        if (marked) { c.lineWidth = 1.5; c.strokeStyle = "#ffffff"; c.setLineDash([3, 3]); c.beginPath(); c.arc(x, y, r + 7, 0, 6.2832); c.stroke(); }
        c.restore();
      }
    }
    cardFor(i) {
      const el = this.card, n = i >= 0 ? this.g.nodes[i] : null;
      if (!n) { el.classList.remove("is-on"); return; }
      const nb = []; this.g.edges.forEach(([a, b]) => { if (a === i) nb.push(b); else if (b === i) nb.push(a); });
      el.textContent = "";
      const mk = (cls, text) => { const d = document.createElement("div"); d.className = cls; d.textContent = text; el.appendChild(d); return d; };
      this.cardPreview(n, el);
      mk("t", n.name); mk("m", (n.unresolved ? "не создана · " : n.kind === "tag" ? "тег · " : n.kind === "img" ? "картинка · " : n.kind === "canvas" ? "холст · " : n.file && n.file.extension === "board" ? "доска · " : "") + (n.folder || "корень") + " · связей: " + nb.length + (n.mtime ? " · изменено " + new Date(n.mtime).toLocaleDateString(window.__bsLang === "ru" ? "ru-RU" : undefined) : ""));
      const list = document.createElement("div"); list.className = "nb"; el.appendChild(list);
      for (const j of nb.slice(0, 14)) { const b = document.createElement("button"); b.textContent = this.g.nodes[j].name; b.addEventListener("click", () => this.setSel(j, true)); list.appendChild(b); }
      if (nb.length > 14) mk("m", "и ещё " + (nb.length - 14));
      const open = document.createElement("button"); open.className = "open"; open.textContent = "Открыть"; open.addEventListener("click", () => this.openNote(i, false)); el.appendChild(open);
      el.classList.add("is-on");
    }
    snap(slot) {
      const k = "snap" + slot; let b = this[k];
      if (!b || b.width !== this.cv.width || b.height !== this.cv.height) { b = this[k] = document.createElement("canvas"); b.width = this.cv.width; b.height = this.cv.height; }
      const g = b.getContext("2d"); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, b.width, b.height); g.drawImage(this.cv, 0, 0); return b;
    }
    fadeNow() { /* no cross-fade of the previous picture: on a fast pointer or wheel it left a ghost; the switch is instant and the hover timings below keep it from flashing */ }
    // intro and 2D <-> 3D: layers (the picture before, the picture now) are blended and scaled around the centre
    compose(now, ease) {
      const c = this.ctx, W = this.cv.width, H = this.cv.height;
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, W, H);
      const put = (img, alpha, scale) => { c.save(); c.globalAlpha = Math.max(0, Math.min(1, alpha)); c.translate(W / 2, H / 2); c.scale(scale, scale); c.translate(-W / 2, -H / 2); c.drawImage(img, 0, 0); c.restore(); };
      if (this.anim) {
        const k = ease((now - this.anim.t0) / this.anim.dur);
        if (this.anim.img) { put(this.anim.img, 1 - k * 1.2, 1 + 0.14 * k); put(this.buf, k, 0.86 + 0.14 * k); }
        else put(this.buf, k * 1.3, 0.35 + 0.65 * k);
      } else if (this.fade) {
        const k = ease((now - this.fade.t0) / this.fade.dur);
        put(this.fade.img, 1, 1); put(this.buf, k, 1);
      }
    }
    // a soft ring round the node under the pointer, the selected one and the search matches
    halos(ex) {
      const c = this.ctx, acc = this.accentCss || (this.accentCss = "rgb(" + [(cssColor("--interactive-accent", "#c98d5b") >> 16) & 255, (cssColor("--interactive-accent", "#c98d5b") >> 8) & 255, cssColor("--interactive-accent", "#c98d5b") & 255] + ")");
      const at = (i) => { if (!ex.ge_screen_of(i)) return null; const f = new Float32Array(ex.memory.buffer, ex.ge_input(2), 2); return [f[0], f[1]]; };
      const ring = (i, a) => { const p = at(i); if (!p) return; c.save(); c.globalAlpha = a; c.strokeStyle = acc; c.shadowColor = acc; c.shadowBlur = 18; c.lineWidth = 2; c.beginPath(); c.arc(p[0], p[1], 13 + (i === this.sel ? 2.5 * Math.sin(performance.now() / 380) : 0), 0, 6.2832); c.stroke(); c.restore(); };
      if (this.match) for (const i of this.match.slice(0, 40)) ring(i, 0.8);
      if (this.sel >= 0) { ring(this.sel, 0.9); if (this.nodesTotal < 1500) this.dirty = true; }
      if (this.hover >= 0 && this.hover !== this.sel) ring(this.hover, 0.6);
    }
    // ================================================================ the 2D picture, drawn here from the positions the engine keeps
    // (the engine still runs the layout, the camera and the 3D picture; in 2D every node, link and label is drawn below so each kind has its own look)
    palette(dark) {
      const acc = this.accRgb || [201, 141, 91], mixc = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k)), bg = this.bgRgb || (dark ? [23, 19, 15] : [250, 247, 242]);
      return dark
        ? { dark, note: [208, 190, 164], board: acc, canvas: [126, 158, 192], img: [134, 176, 138], tag: [166, 146, 196], unres: [138, 126, 114], edge: [178, 158, 136], label: [200, 190, 176], labelHi: [244, 236, 224], bg, acc, dim: 0.13 }
        : { dark, note: [124, 102, 76], board: mixc(acc, [0, 0, 0], 0.2), canvas: [72, 108, 150], img: [78, 130, 88], tag: [120, 98, 164], unres: [166, 154, 142], edge: [112, 94, 74], label: [88, 76, 64], labelHi: [30, 24, 18], bg, acc: mixc(acc, [0, 0, 0], 0.2), dim: 0.13 };
    }
    folderRgb(folder, pal) {
      const FP = [[201, 141, 91], [196, 180, 150], [116, 148, 184], [128, 170, 132], [160, 140, 190], [200, 128, 128], [200, 170, 100], [100, 170, 170]], m = this.fIdx || (this.fIdx = new Map());
      if (!m.has(folder)) m.set(folder, m.size); const c = FP[m.get(folder) % FP.length];
      return pal.dark ? c : c.map((v) => Math.round(v * 0.72));
    }
    nodeRgb(n, pal, gcol) {
      if (n.unresolved) return pal.unres; if (n.kind === "tag") return pal.tag;
      const gid = STORE.assign[n.key]; if (gid && gcol[gid]) return gcol[gid];
      if (n.kind === "board") return pal.board; if (n.kind === "canvas") return pal.canvas; if (n.kind === "img") return pal.img;
      if (this.c.colorBy === "folder") return n.folder ? this.folderRgb(n.folder, pal) : pal.note;
      if (this.c.colorBy === "tag") { const t = n.tags && n.tags[0]; if (t) return this.folderRgb("#" + t, pal); }
      return pal.note;
    }
    baseLit() {
      if (this.path) return this.path.set;
      if (this.match && this.match.length && this.searchEl && this.searchEl.value.trim()) { if (this._msFor !== this.match || this._msN !== this.match.length) { this._msFor = this.match; this._msN = this.match.length; this._ms = new Set(this.match); } return this._ms; }
      return this.recentSet || null;
    }
    timeHid() { return this.tl && this.tl.on ? this.tl.hid : null; }
    pick2d(x, y) {
      const P = this.P, R = this.rad, N = this.g ? this.g.nodes.length : 0; if (!P || !R || P.length < N * 2) return -1;
      const hid = this.timeHid(); let best = -1, bd = 1e12;
      for (let i = N - 1; i >= 0; i--) { if (hid && hid[i]) continue; const dx = P[2 * i] - x, dy = P[2 * i + 1] - y, rr = R[i] + 3, d = dx * dx + dy * dy; if (d <= rr * rr && d < bd) { bd = d; best = i; } }
      return best;
    }
    paint2d(ex, w, h, dpr, o) {
      o = o || {};
      const c = this.ctx, g = this.g, N = g.nodes.length, pal = o.pal || this.palette(this.isDark), sc = this.c.nodeScale, cfg = this.c;
      c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
      if (o.bg) { c.fillStyle = "rgb(" + o.bg + ")"; c.fillRect(0, 0, w, h); }
      if (!N) { this.P2 = null; return; }
      const grow = (name, T, len) => { let a = this[name]; if (!a || a.length < len) a = this[name] = new T(len); return a; };
      const P = grow("P", Float32Array, N * 2), R = grow("rad", Float32Array, N), AL = grow("al", Float32Array, N);
      const f = new Float32Array(ex.memory.buffer, ex.ge_input(2), 2);
      for (let i = 0; i < N; i++) { if (ex.ge_screen_of(i)) { P[2 * i] = f[0]; P[2 * i + 1] = f[1]; } else P[2 * i] = P[2 * i + 1] = -1e5; }
      this.P2 = P;
      const hid = this.timeHid(), dim = pal.dim, rgbS = (a) => "rgb(" + a[0] + "," + a[1] + "," + a[2] + ")", rgbA = (a, al) => "rgba(" + a[0] + "," + a[1] + "," + a[2] + "," + al + ")";
      // what is lit: the neighbourhood of the node under the pointer (or the selected one), else the path / search hits / recent changes
      let tTo = this.hlTo === undefined ? -1 : this.hlTo, tFrom = this.hlFrom === undefined ? -1 : this.hlFrom, kk = this.hlK === undefined ? 1 : this.hlK;
      if (o.exp) { tTo = tFrom = this.sel; kk = 1; }
      if (this.path) { tTo = tFrom = -1; }
      const base = this.baseLit(), aTo = tTo >= 0 ? this.adjOf(tTo) : null, aFrom = tFrom >= 0 ? this.adjOf(tFrom) : null;
      const lit = (id, adj, i) => (id < 0 ? (base ? (base.has(i) ? 1 : 0) : 1) : i === id || adj.has(i) ? 1 : 0);
      const gcol = {}; for (const gr of STORE.groups) { const m = /^#([0-9a-f]{6})$/i.exec(gr.color || ""); if (m) { const v = parseInt(m[1], 16), q = [(v >> 16) & 255, (v >> 8) & 255, v & 255]; gcol[gr.id] = pal.dark ? q : q.map((z) => Math.round(z * 0.78)); } }
      for (let i = 0; i < N; i++) {
        const n = g.nodes[i], deg = this.adjOf(i).size; let r = Math.min(15 * Math.max(sc, 0.7), (2.7 + 1.65 * Math.sqrt(deg)) * sc);
        if (n.kind === "board" || n.kind === "canvas") r *= 1.15; else if (n.unresolved) r *= 0.8; else if (n.kind === "tag") r = Math.max(r, 4 * sc);
        R[i] = r; const a = lit(tFrom, aFrom, i), b = lit(tTo, aTo, i); AL[i] = hid && hid[i] ? 0 : dim + (1 - dim) * (a + (b - a) * kk);
      }
      // ---- links
      const edges = g.edges, curved = cfg.edgeStyle !== "straight" && edges.length < 3500, arrows = !!cfg.arrows && edges.length < 8000;
      const ea = 0.1 + 0.42 * cfg.edgeAlpha, pathE = this.path ? this.path.edges : null;
      const lines = [new Path2D(), new Path2D(), new Path2D()], heads = [new Path2D(), new Path2D(), new Path2D()];
      for (let k = 0; k < edges.length; k++) {
        const a = edges[k][0], b = edges[k][1]; if (AL[a] <= 0 || AL[b] <= 0) continue;
        const ax = P[2 * a], ay = P[2 * a + 1], bx = P[2 * b], by = P[2 * b + 1];
        if ((ax < -20 && bx < -20) || (ax > w + 20 && bx > w + 20) || (ay < -20 && by < -20) || (ay > h + 20 && by > h + 20)) continue;
        let cls = Math.min(AL[a], AL[b]) < 0.5 ? 0 : 1;
        if (pathE ? pathE.has(a < b ? a + "-" + b : b + "-" + a) : tTo >= 0 && (a === tTo || b === tTo) && AL[a] > 0.5 && AL[b] > 0.5) cls = 2;
        const L = lines[cls], dx = bx - ax, dy = by - ay; let cx = (ax + bx) / 2, cy = (ay + by) / 2;
        L.moveTo(ax, ay);
        if (curved) { cx -= dy * 0.12; cy += dx * 0.12; L.quadraticCurveTo(cx, cy, bx, by); } else L.lineTo(bx, by);
        if (arrows && cls) { const ux0 = bx - cx, uy0 = by - cy, ul = Math.hypot(ux0, uy0) || 1, ux = ux0 / ul, uy = uy0 / ul, s = cls === 2 ? 6.5 : 5, tx = bx - ux * (R[b] + 1.5), ty = by - uy * (R[b] + 1.5), H = heads[cls]; H.moveTo(tx, ty); H.lineTo(tx - ux * s - uy * s * 0.5, ty - uy * s + ux * s * 0.5); H.lineTo(tx - ux * s + uy * s * 0.5, ty - uy * s - ux * s * 0.5); H.closePath(); }
      }
      c.lineCap = "round"; c.lineJoin = "round";
      c.strokeStyle = rgbA(pal.edge, dim * 0.35); c.lineWidth = 0.8; c.stroke(lines[0]);
      c.strokeStyle = rgbA(pal.edge, ea); c.lineWidth = 0.9; c.stroke(lines[1]); if (arrows) { c.fillStyle = rgbA(pal.edge, Math.min(1, ea * 1.6)); c.fill(heads[1]); }
      c.strokeStyle = rgbA(pal.acc, 0.85); c.lineWidth = 1.6; c.stroke(lines[2]); if (arrows) { c.fillStyle = rgbA(pal.acc, 0.95); c.fill(heads[2]); }
      // ---- nodes: the round ones of one colour and brightness go in one path
      const bgS = rgbS(pal.bg), batches = new Map(), odd = []; let cull = 0;
      for (let i = 0; i < N; i++) {
        if (AL[i] <= 0.01) continue; const x = P[2 * i], y = P[2 * i + 1]; if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue; cull++;
        const n = g.nodes[i]; if (n.unresolved || n.kind !== "note") { odd.push(i); continue; }
        const rgb = this.nodeRgb(n, pal, gcol), key = Math.round(AL[i] * 8) + "|" + rgb[0] + "," + rgb[1] + "," + rgb[2]; let bt = batches.get(key); if (!bt) { bt = { al: Math.round(AL[i] * 8) / 8, rgb, ids: [] }; batches.set(key, bt); } bt.ids.push(i);
      }
      for (const bt of Array.from(batches.values()).sort((p, q) => p.al - q.al)) {
        c.globalAlpha = Math.max(0.1, bt.al); c.beginPath(); for (const i of bt.ids) { c.moveTo(P[2 * i] + R[i], P[2 * i + 1]); c.arc(P[2 * i], P[2 * i + 1], R[i], 0, 6.2832); }
        c.fillStyle = rgbS(bt.rgb); c.fill(); if (cull < 6000) { c.lineWidth = 1.2; c.strokeStyle = bgS; c.stroke(); }
      }
      for (const i of odd) {
        const n = g.nodes[i], x = P[2 * i], y = P[2 * i + 1], r = R[i], rgb = this.nodeRgb(n, pal, gcol); c.globalAlpha = AL[i]; c.beginPath();
        if (n.unresolved) { c.arc(x, y, r, 0, 6.2832); c.fillStyle = bgS; c.fill(); c.setLineDash([2.2, 2]); c.lineWidth = 1.3; c.strokeStyle = rgbS(rgb); c.stroke(); c.setLineDash([]); continue; }
        if (n.kind === "board" || n.kind === "img") c.roundRect(x - r, y - r, r * 2, r * 2, Math.min(3, r * 0.4));
        else if (n.kind === "canvas") { c.moveTo(x, y - r * 1.25); c.lineTo(x + r * 1.25, y); c.lineTo(x, y + r * 1.25); c.lineTo(x - r * 1.25, y); c.closePath(); }
        else { for (let q = 0; q < 6; q++) { const an = q * 1.0472 + 0.5236; q ? c.lineTo(x + Math.cos(an) * r * 1.1, y + Math.sin(an) * r * 1.1) : c.moveTo(x + Math.cos(an) * r * 1.1, y + Math.sin(an) * r * 1.1); } c.closePath(); }
        c.fillStyle = rgbS(rgb); c.fill(); c.lineWidth = 1.2; c.strokeStyle = bgS; c.stroke();
      }
      c.globalAlpha = 1;
      this.drawThumbs(ex, pal);
      // ---- soft glow and rings: only for the hovered / selected node, search hits, marked nodes, recent changes
      const accS = rgbS(pal.acc), at = (i) => (i >= 0 && i < N && P[2 * i] > -1e4 ? [P[2 * i], P[2 * i + 1], R[i]] : null);
      const ring = (i, pad, al, glow, wd) => { const p = at(i); if (!p) return; c.save(); c.globalAlpha = al; c.strokeStyle = accS; c.lineWidth = wd || 1.6; if (glow) { c.shadowColor = accS; c.shadowBlur = glow; } c.beginPath(); c.arc(p[0], p[1], p[2] + pad, 0, 6.2832); c.stroke(); c.restore(); };
      if (this.recentSet && !o.exp) { let q = 0; for (const i of this.recentSet) { if (q++ > 400) break; ring(i, 2.5, 0.55 * AL[i], 0, 1.2); } }
      if (this.match && this.match.length && this.searchEl && this.searchEl.value.trim()) for (const i of this.match.slice(0, 300)) ring(i, 3, 0.85, 0, 1.4);
      if (this.path) for (const i of this.path.nodes) ring(i, 3.5, 0.95, 8, 1.8);
      if (this.pathPick >= 0) ring(this.pathPick, 5, 0.95, 10, 2);
      if (this.sel >= 0) ring(this.sel, 4.5, 0.95, 14, 1.8);
      if (this.hover >= 0 && this.hover !== this.sel && !o.exp) ring(this.hover, 4, 0.8, 16, 1.6);
      if (this.multi && this.multi.size) for (const i of this.multi) { const p = at(i); if (!p) continue; c.save(); c.strokeStyle = rgbS(pal.labelHi); c.lineWidth = 1.2; c.setLineDash([3, 3]); c.beginPath(); c.arc(p[0], p[1], p[2] + 6, 0, 6.2832); c.stroke(); c.restore(); }
      if (this.pinned && this.pinned.size && !o.exp) for (const i of this.pinned) { const p = at(i); if (!p) continue; c.beginPath(); c.arc(p[0] + p[2] * 0.75, p[1] - p[2] * 0.75, 2.4, 0, 6.2832); c.fillStyle = accS; c.fill(); c.lineWidth = 1; c.strokeStyle = bgS; c.stroke(); }
      this.drawLabels(w, h, pal, AL, tTo, aTo, o);
    }
    // labels: the highlighted neighbourhood first, then by number of links; a label that would lie over another one is left out
    drawLabels(w, h, pal, AL, tTo, aTo, o) {
      const c = this.ctx, g = this.g, N = g.nodes.length, P = this.P, R = this.rad, mode = this.c.labelMode, ff = this.font || (this.font = (getComputedStyle(document.body).getPropertyValue("--font-interface") || "").trim() || "system-ui, sans-serif");
      const placed = [], bgA = "rgba(" + pal.bg[0] + "," + pal.bg[1] + "," + pal.bg[2] + ",.88)", col = "rgb(" + pal.label + ")", colHi = "rgb(" + pal.labelHi + ")", fade = o.exp ? 1 : this.labelA === undefined ? 1 : this.labelA;
      c.textAlign = "center"; c.textBaseline = "top"; c.lineJoin = "round";
      const short = (s) => (s.length > 30 ? s.slice(0, 29) + "…" : s);
      const put = (i, strong) => {
        const x = P[2 * i], y = P[2 * i + 1]; if (x < 4 || y < 4 || x > w - 4 || y > h - 4) return false;
        const size = strong ? 12.5 : 11.5, t = short(g.nodes[i].name.replace(/\n/g, " ")); c.font = (strong ? "600 " : "500 ") + size + "px " + ff;
        const tw = c.measureText(t).width, ty = y + R[i] + 3.5, bx = x - tw / 2; for (const r of placed) if (bx < r[2] + 3 && bx + tw + 3 > r[0] && ty < r[3] + 1 && ty + size + 2 > r[1]) return false;
        placed.push([bx, ty, bx + tw, ty + size + 2]); c.globalAlpha = Math.min(1, (strong ? 1 : 0.5 + AL[i] * 0.5)) * fade; c.lineWidth = 3.6; c.strokeStyle = bgA; c.strokeText(t, x, ty); c.fillStyle = strong ? colHi : col; c.fillText(t, x, ty); return true;
      };
      const done = new Set(), strongList = [];
      if (tTo >= 0) { strongList.push(tTo); for (const j of aTo) strongList.push(j); }
      if (this.sel >= 0 && this.sel !== tTo) strongList.push(this.sel);
      if (this.path) for (const i of this.path.nodes) strongList.push(i);
      if (this.pathPick >= 0) strongList.push(this.pathPick);
      if (this.match && this.searchEl && this.searchEl.value.trim()) for (const i of this.match.slice(0, 40)) strongList.push(i);
      for (const i of strongList) { if (done.has(i) || AL[i] <= 0.01) continue; done.add(i); put(i, i === tTo || i === this.sel); }
      if (mode !== "none" && !this.growLabels) {
        const ord = this.order || [], P2 = this.P; let vis = 0; for (let i = 0; i < N; i++) { const x = P2[2 * i], y = P2[2 * i + 1]; if (x > 0 && y > 0 && x < w && y < h) vis++; } const dens = this.c.labelDensity || 1, cap = mode === "all" ? 700 : vis <= 40 ? 60 : Math.max(10, Math.floor(dens * 900 / Math.sqrt(vis))); let shown = 0, tried = 0;
        for (const i of ord) { if (shown >= cap || tried > cap * 5) break; if (done.has(i) || AL[i] < 0.5) continue; const x = P[2 * i], y = P[2 * i + 1]; if (x < 4 || y < 4 || x > w - 4 || y > h - 4) continue; tried++; if (put(i, false)) shown++; }
      }
      c.globalAlpha = 1;
    }
    // ================================================================ path between two nodes, pins, colour, reveal, copy link
    startPath(i) { this.pathPick = i; this.path = null; this.pathMsg = ""; this.updatePathBar(); this.dirty = true; }
    pathFind(a, b) {
      this.pathPick = -1; const n = this.g.nodes.length, prev = new Int32Array(n).fill(-2); prev[a] = -1; const q = [a];
      for (let h = 0; h < q.length && prev[b] === -2; h++) { const u = q[h]; for (const v of this.adjOf(u)) if (prev[v] === -2) { prev[v] = u; q.push(v); } }
      if (prev[b] === -2) { this.path = null; this.pathMsg = "Пути нет: «" + this.g.nodes[a].name + "» и «" + this.g.nodes[b].name + "» не связаны"; this.pathNone = true; this.updatePathBar(); this.dirty = true; return; }
      const nodes = []; for (let v = b; v >= 0; v = prev[v]) nodes.push(v); nodes.reverse();
      const edges = new Set(); for (let k = 1; k < nodes.length; k++) { const x = nodes[k - 1], y = nodes[k]; edges.add(x < y ? x + "-" + y : y + "-" + x); }
      this.path = { from: a, to: b, nodes, set: new Set(nodes), edges }; this.pathNone = false; this.pathMsg = ""; this.sel = -1; this.cardFor(-1); this.updatePathBar(); this.dirty = true;
    }
    clearPath() { this.path = null; this.pathPick = -1; this.pathMsg = ""; this.pathNone = false; this.updatePathBar(); this.dirty = true; }
    updatePathBar() {
      const el = this.pathbar; if (!el) return; el.textContent = "";
      const span = (t, cls) => { const s = document.createElement("span"); s.className = cls || "t"; s.textContent = t; el.appendChild(s); return s; };
      if (this.pathPick >= 0) span("Как связаны: «" + this.g.nodes[this.pathPick].name + "». Выберите второй узел");
      else if (this.path) { const nm = this.path.nodes.map((i) => this.g.nodes[i].name), steps = this.path.nodes.length - 1; span("Как связаны: " + (nm.length > 5 ? nm.slice(0, 2).join(" → ") + " → … → " + nm.slice(-2).join(" → ") : nm.join(" → "))); span(steps + " " + (steps === 1 ? "шаг" : steps < 5 ? "шага" : "шагов"), "n"); }
      else if (this.pathMsg) span(this.pathMsg);
      else { el.classList.remove("is-on"); return; }
      const x = document.createElement("button"); x.title = "Закрыть"; try { api2().setIcon(x, "lucide-x"); } catch (e) { /* no icon */ } x.addEventListener("click", () => this.clearPath()); el.appendChild(x); el.classList.add("is-on");
    }
    unpin(i) { if (this.pinned) this.pinned.delete(i); this.ex.ge_unpin(i); this.running = true; this.dirty = true; }
    unpinAll() { if (this.pinned) for (const i of this.pinned) this.ex.ge_unpin(i); this.pinned = new Set(); this.running = true; this.dirty = true; }
    revealNode(i) { const n = this.g.nodes[i]; if (!n || !n.file) return; try { if (this.app.showInFolder) this.app.showInFolder(n.file.path); else new (api2().Notice)(n.file.path); } catch (e) { new (api2().Notice)(n.file.path); } }
    copyLink(i) {
      const n = this.g.nodes[i]; if (!n || !n.file) return;
      let t = "[[" + n.file.basename + "]]"; try { t = this.app.fileManager.generateMarkdownLink(n.file, ""); } catch (e) { /* plain wikilink */ }
      try { navigator.clipboard.writeText(t); new (api2().Notice)("Ссылка скопирована: " + t); } catch (e) { new (api2().Notice)(t); }
    }
    setNodeColor(nodes, hex, name) {
      let g = STORE.groups.find((x) => x.id === "col-" + hex.slice(1));
      if (!hex) { for (const n of nodes) delete STORE.assign[n.key]; saveStore(); this.buildPanel(); this.dirty = true; return; }
      if (!g) { g = { id: "col-" + hex.slice(1), name: "Цвет: " + name.toLowerCase(), color: hex }; STORE.groups.push(g); }
      for (const n of nodes) STORE.assign[n.key] = g.id; saveStore(); this.buildPanel(); this.dirty = true;
    }
    // ================================================================ recent changes, time-lapse
    setRecent(days) { this.c.recent = days; save(this.c); this.calcRecent(); this.dirty = true; if (this.recentB) this.recentB.classList.toggle("is-on", days > 0); }
    calcRecent() {
      const d = this.c.recent; if (!d || !this.g) { this.recentSet = null; return; }
      const lim = Date.now() - d * 86400000, s = new Set(); this.g.nodes.forEach((n, i) => { if (n.mtime && n.mtime >= lim) s.add(i); }); this.recentSet = s.size ? s : null; if (!s.size) new (api2().Notice)("За этот период ничего не менялось");
    }
    recentMenu(e) {
      const m = new (api2().Menu)(); const cur = this.c.recent || 0;
      for (const [d, t] of [[0, "Не подсвечивать"], [1, "Изменённые за сутки"], [7, "Изменённые за неделю"], [30, "Изменённые за месяц"], [90, "Изменённые за три месяца"]]) m.addItem((it) => it.setTitle(t).setChecked(cur === d).onClick(() => this.setRecent(d)));
      m.showAtMouseEvent(e);
    }
    toggleTime() { if (this.tl && this.tl.on) this.closeTime(); else this.openTime(); }
    closeTime() { if (this.tl) { this.tl.on = false; this.tl.playing = false; } this.timebar.classList.remove("is-on"); if (this.timeB) this.timeB.classList.remove("is-on"); this.dirty = true; }
    tlRefresh() { if (this.tl && this.tl.on) { this.tl.hid = new Uint8Array(this.g.nodes.length); this.tlApply(); } }
    tlApply() {
      const tl = this.tl; if (!tl) return; this.g.nodes.forEach((n, i) => { tl.hid[i] = n.ctime && n.ctime > tl.t ? 1 : 0; });
      if (this.tlLabel) this.tlLabel.textContent = new Date(tl.t).toLocaleDateString(window.__bsLang === "ru" ? "ru-RU" : undefined, { day: "numeric", month: "short", year: "numeric" });
      if (this.tlRange) this.tlRange.value = String(Math.round(((tl.t - tl.lo) / Math.max(1, tl.hi - tl.lo)) * 1000));
      this.dirty = true;
    }
    openTime() {
      let lo = Infinity, hi = 0; for (const n of this.g.nodes) if (n.ctime) { lo = Math.min(lo, n.ctime); hi = Math.max(hi, n.ctime); }
      if (!hi) return; if (hi - lo < 86400000) lo = hi - 86400000;
      const tl = this.tl = { on: true, lo, hi, t: hi, playing: false, hid: new Uint8Array(this.g.nodes.length) };
      const el = this.timebar; el.textContent = "";
      const play = document.createElement("button"); play.className = "pl"; const setIc = () => { play.textContent = ""; try { api2().setIcon(play, tl.playing ? "lucide-pause" : "lucide-play"); } catch (e) { /* no icon */ } play.title = tl.playing ? "Пауза" : "Показать, как рос граф"; };
      const range = document.createElement("input"); range.type = "range"; range.min = "0"; range.max = "1000"; range.value = "1000"; this.tlRange = range;
      const lab = document.createElement("span"); lab.className = "dt"; this.tlLabel = lab;
      const cl = document.createElement("button"); cl.title = "Закрыть хронологию"; try { api2().setIcon(cl, "lucide-x"); } catch (e) { /* no icon */ } cl.addEventListener("click", () => this.closeTime());
      const step = (t0, from) => { if (!tl.playing || !this.alive) return; const k = Math.min(1, (performance.now() - t0) / 9000); tl.t = from + (tl.hi - from) * k; this.tlApply(); if (k >= 1) { tl.playing = false; setIc(); } else requestAnimationFrame(() => step(t0, from)); };
      play.addEventListener("click", () => { if (tl.playing) { tl.playing = false; setIc(); return; } tl.playing = true; setIc(); const from = tl.t >= tl.hi - 1 ? tl.lo : tl.t; step(performance.now(), from); });
      range.addEventListener("input", () => { tl.playing = false; setIc(); tl.t = tl.lo + (tl.hi - tl.lo) * (+range.value / 1000); this.tlApply(); });
      setIc(); el.append(play, range, lab, cl); el.classList.add("is-on"); if (this.timeB) this.timeB.classList.add("is-on"); this.tlApply();
    }
    // ================================================================ export
    exportMenu(e) {
      const m = new (api2().Menu)(), it = (t, ic, fn) => m.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn));
      it("Копировать картинку, белый фон", "lucide-clipboard-copy", () => this.exportPng("white", "clip"));
      it("Сохранить PNG, белый фон", "lucide-image-down", () => this.exportPng("white", "file"));
      it("Сохранить PNG, прозрачный фон", "lucide-image", () => this.exportPng("none", "file"));
      it("Сохранить PNG, тёмный фон", "lucide-moon", () => this.exportPng("dark", "file"));
      it("Сохранить PNG, как на экране", "lucide-monitor", () => this.exportPng("orig", "file"));
      m.addSeparator(); it("Сохранить данные графа (JSON)", "lucide-file-json", () => this.exportJson());
      m.showAtMouseEvent(e);
    }
    async saveFile(blob, name, ext, label) {
      const Notice = api2().Notice;
      try {
        const remote = window.electron && window.electron.remote;
        if (remote && remote.dialog) {
          const picked = await remote.dialog.showSaveDialog({ defaultPath: name + "." + ext, filters: [{ name: label, extensions: [ext] }, { name: "Все файлы", extensions: ["*"] }] }), fp = picked && (picked.filePath || (picked[1] && picked[1]));
          if (!picked || picked.canceled || !fp) return false;
          await window.require("fs").promises.writeFile(fp, window.require("buffer").Buffer.from(await blob.arrayBuffer())); new Notice(fp, 10000); return true;
        }
      } catch (e) { new Notice("Не удалось сохранить файл"); return false; }
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name + "." + ext; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); return true;
    }
    async exportPng(mode, dest) {
      if (!this.g || !this.g.nodes.length || !this.W) return;
      const W = this.W, H = this.H, k = 2, cv = document.createElement("canvas"); cv.width = W * k; cv.height = H * k; const main = this.ctx; this.ctx = cv.getContext("2d");
      try {
        const dark = mode === "dark" || (mode !== "white" && this.isDark), pal = this.palette(dark);
        if (mode === "white") pal.bg = [255, 255, 255]; else if (mode === "dark") pal.bg = this.isDark ? this.bgRgb : [23, 19, 15];
        const bg = mode === "none" ? null : pal.bg;
        if (this.c.view === "2d") this.paint2d(this.ex, W, H, k, { pal, bg, exp: true });
        else { if (bg) { this.ctx.fillStyle = "rgb(" + bg + ")"; this.ctx.fillRect(0, 0, cv.width, cv.height); } this.ctx.drawImage(this.cv, 0, 0, cv.width, cv.height); }
      } finally { this.ctx = main; this.dirty = true; }
      const blob = await new Promise((r) => cv.toBlob(r, "image/png")); if (!blob) { new (api2().Notice)("Не удалось собрать картинку"); return; }
      if (dest === "clip") { try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); new (api2().Notice)("Картинка графа скопирована"); } catch (e) { new (api2().Notice)("Не удалось скопировать картинку"); } return; }
      await this.saveFile(blob, "Граф", "png", "PNG"); return blob;
    }
    async exportJson() {
      const g = this.g, P = this.P2 ? this.P : null;
      const out = { app: "Basalt", kind: "graph", created: new Date().toISOString(), nodes: g.nodes.map((n, i) => ({ id: n.key, name: n.name, kind: n.unresolved ? "unresolved" : n.kind, folder: n.dir || "", tags: n.tags || [], links: this.adjOf(i).size, modified: n.mtime || undefined, x: P ? Math.round(P[2 * i]) : undefined, y: P ? Math.round(P[2 * i + 1]) : undefined })), edges: g.edges.map(([a, b]) => ({ source: g.nodes[a].key, target: g.nodes[b].key })) };
      await this.saveFile(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }), "Граф", "json", "JSON");
    }
    // ================================================================ legend, empty and loading states
    updateLegend() {
      const el = this.legend; if (!el) return; el.textContent = ""; if (!this.c.legend || !this.g || !this.g.nodes.length) { el.style.display = "none"; return; }
      const pal = this.palette(this.isDark), rgb = (a) => "rgb(" + a + ")", cnt = {}; for (const n of this.g.nodes) { const k = n.unresolved ? "unres" : n.kind; cnt[k] = (cnt[k] || 0) + 1; }
      const SH = { note: (c) => '<circle cx="6" cy="6" r="4.2" fill="' + c + '"/>', board: (c) => '<rect x="2" y="2" width="8" height="8" rx="2" fill="' + c + '"/>', canvas: (c) => '<path d="M6 .8 11.2 6 6 11.2.8 6z" fill="' + c + '"/>', img: (c) => '<rect x="2.4" y="2.4" width="7.2" height="7.2" rx="1.6" fill="none" stroke="' + c + '" stroke-width="1.6"/>', tag: (c) => '<path d="M6 .9 10.4 3.4v5.2L6 11.1 1.6 8.6V3.4z" fill="' + c + '"/>', unres: (c) => '<circle cx="6" cy="6" r="4" fill="none" stroke="' + c + '" stroke-width="1.3" stroke-dasharray="2 1.6"/>' };
      const LB = { note: "заметки", board: "доски", canvas: "холсты", img: "картинки", tag: "теги", unres: "несозданные" };
      const row = (svg, label, n) => { const d = document.createElement("span"); d.className = "lg"; d.innerHTML = '<svg viewBox="0 0 12 12">' + svg + "</svg>"; const t = document.createElement("span"); t.textContent = label; d.appendChild(t); if (n !== undefined) { const b = document.createElement("b"); b.textContent = n; d.appendChild(b); } el.appendChild(d); };
      for (const k of ["note", "board", "canvas", "img", "tag", "unres"]) if (cnt[k]) row(SH[k](rgb(pal[k])), LB[k], cnt[k]);
      const gc = {}; for (const n of this.g.nodes) { const gid = STORE.assign[n.key]; if (gid) gc[gid] = (gc[gid] || 0) + 1; }
      for (const gr of STORE.groups.filter((x) => gc[x.id] && !x.hidden).slice(0, 6)) row('<circle cx="6" cy="6" r="4.6" fill="' + gr.color + '"/>', gr.name, gc[gr.id]);
      if (this.c.colorBy === "folder") { const fc = {}; for (const n of this.g.nodes) if (n.folder && n.kind === "note") fc[n.folder] = (fc[n.folder] || 0) + 1; for (const f of Object.keys(fc).sort((a, b) => fc[b] - fc[a]).slice(0, 6)) row('<circle cx="6" cy="6" r="4.6" fill="' + rgb(this.folderRgb(f, pal)) + '"/>', f, fc[f]); }
      el.style.display = el.childNodes.length ? "flex" : "none";
    }
    updateEmpty(n, loading) {
      const el = this.empty; if (!el) return; if (n > 0) { el.style.display = "none"; return; }
      el.textContent = ""; const mk = (cls, t) => { const d = document.createElement("div"); d.className = cls; d.textContent = t; el.appendChild(d); return d; };
      if (loading) { mk("spin", ""); mk("et", "Строю граф…"); mk("ed", "Читаю заметки, доски и холсты хранилища"); el.style.display = "flex"; return; }
      const c = this.c, filt = c.folderOnly || c.tagOnly || STORE.solo.length || STORE.focusKeys.length, btn = (t, fn) => { const b = document.createElement("button"); b.textContent = t; b.addEventListener("click", fn); el.appendChild(b); };
      if (!this.app.vault.getFiles().length) { mk("et", "Здесь пока пусто"); mk("ed", "Создайте заметку и свяжите её с другой через [[двойные скобки]]: связанные заметки соединятся линиями"); btn("Создать заметку", () => { try { this.app.commands.executeCommandById("file-explorer:new-file"); } catch (e) { /* no explorer */ } }); }
      else if (type === "localgraph" && !this.anchor) { mk("et", "Откройте заметку или доску"); mk("ed", "Локальный граф показывает связи открытого файла и всё, что с ним соединено."); btn("Открыть общий граф", () => { try { this.app.commands.executeCommandById("graph:open"); } catch (e) { /* no command */ } }); }
      else if (filt) { mk("et", "Ничего не подошло под фильтры"); mk("ed", "Уберите фильтр по папке, тегу или группе, чтобы увидеть весь граф"); btn("Сбросить фильтры", () => { c.folderOnly = ""; c.tagOnly = ""; save(c); STORE.solo = []; STORE.focusKeys = []; saveStore(); this.afterState(); }); }
      else { mk("et", "В графе пока ничего нет"); mk("ed", "Заметки без связей скрыты: покажите их или свяжите заметки между собой через [[ссылки]]"); btn("Показать заметки без связей", () => { c.orphans = true; save(c); this.rebuild(); this.buildPanel(); }); }
      el.style.display = "flex";
    }
    paint(d, w, h, dpr) {
      const c = this.ctx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
      const col = (i) => "rgba(" + d[i] + "," + d[i + 1] + "," + d[i + 2] + "," + d[i + 3] + ")";
      let i = 0, clips = 0; const placed = []; /* label boxes already drawn in this frame: a label that would lie over one of them is left out */
      c.lineJoin = "round"; c.lineCap = "round"; if (!this.bgCss) this.style();
      while (i < d.length) {
        const op = d[i++];
        if (op === 0) break;
        if (op === 1) { c.fillStyle = col(i); i += 4; const subs = d[i++]; const first = i; c.beginPath(); for (let s = 0; s < subs; s++) { const n = d[i++]; for (let k = 0; k < n; k++) { const x = d[i++], y = d[i++]; k ? c.lineTo(x, y) : c.moveTo(x, y); } c.closePath(); } if (!(subs === 1 && d[first] === 4 && d[first + 1] <= 0 && d[first + 2] <= 0 && d[first + 5] >= w - 1)) c.fill(); /* the full-window background rectangle is left to the CSS gradient */ }
        else if (op === 2) { c.strokeStyle = col(i); i += 4; c.lineWidth = d[i++]; i++; const n = d[i++]; c.beginPath();
          if (n === 2 && this.nodesTotal < 1500) { const x0 = d[i], y0 = d[i + 1], x1 = d[i + 2], y1 = d[i + 3], dx = x1 - x0, dy = y1 - y0, sgn = 1; i += 4; c.moveTo(x0, y0); c.quadraticCurveTo((x0 + x1) / 2 - dy * 0.1 * sgn, (y0 + y1) / 2 + dx * 0.1 * sgn, x1, y1); }
          else for (let k = 0; k < n; k++) { const x = d[i++], y = d[i++]; k ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
        else if (op === 8) { const key = d[i] + "," + d[i + 1] + "," + d[i + 2], alpha = d[i + 3]; i += 4; i += 4; const ow = d[i++], rad = d[i++], n = d[i++]; const base = this.tone(key), pts = i; i += n * 2;
          const fancy = n * 1 < 1500 && this.nodesTotal < 1500;
          if (fancy) { for (let k = 0; k < n; k++) { const x = d[pts + k * 2], y = d[pts + k * 2 + 1];
              c.globalAlpha = alpha; const gr = c.createRadialGradient(x - rad * 0.35, y - rad * 0.4, rad * 0.1, x, y, rad); gr.addColorStop(0, base.hi); gr.addColorStop(1, base.lo);
              c.fillStyle = gr; c.beginPath(); c.arc(x, y, rad, 0, 6.2832); c.fill(); c.lineWidth = 1; c.strokeStyle = base.rim; c.stroke(); } c.globalAlpha = 1; }
          else { c.fillStyle = base.lo; c.beginPath(); for (let k = 0; k < n; k++) { const x = d[pts + k * 2], y = d[pts + k * 2 + 1]; c.moveTo(x + rad, y); c.arc(x, y, rad, 0, 6.2832); } c.fill(); } }
        else if (op === 7) { const x = d[i++], y = d[i++], size = d[i++]; c.fillStyle = col(i); i += 4; const ha = d[i++], va = d[i++], n = d[i++]; let s = ""; for (let k = 0; k < n; k++) s += String.fromCharCode(d[i++]); c.font = size + "px " + (this.font || (this.font = (getComputedStyle(document.body).getPropertyValue("--font-interface") || "").trim() || "system-ui, sans-serif"));
          c.textAlign = ha === 1 ? "center" : ha === 2 ? "right" : "left"; c.textBaseline = va === 1 ? "middle" : va === 2 ? "bottom" : "top"; const tw = c.measureText(s).width, bx = ha === 1 ? x - tw / 2 : ha === 2 ? x - tw : x, by = va === 1 ? y - size / 2 : va === 2 ? y - size : y; let hit = false; if (placed.length < 400) for (const r of placed) { if (bx < r[2] + 2 && bx + tw + 2 > r[0] && by < r[3] + 1 && by + size + 1 > r[1]) { hit = true; break; } } if (!hit) { placed.push([bx, by, bx + tw, by + size]); c.lineWidth = 3; c.strokeStyle = this.bgCss; c.globalAlpha = this.labelA === undefined ? 1 : this.labelA; c.strokeText(s, x, y); c.fillText(s, x, y); c.globalAlpha = 1; } }
        else if (op === 4) { c.save(); clips++; c.beginPath(); c.rect(d[i], d[i + 1], d[i + 2] - d[i], d[i + 3] - d[i + 1]); c.clip(); i += 4; }
        else if (op === 5) { if (clips) { c.restore(); clips--; } }
        else break;
      }
      while (clips--) c.restore();
    }
  };
  const api2 = () => window.__bsApi || {};

  // ---------------------------------------------------------------- take over the stock views
  let done = 0;
  const install = () => {
    const api = window.__bsApi;
    if (!api || !window.app || !app.viewRegistry || !app.viewRegistry.viewByType) return false;
    for (const type of ["graph", "localgraph"]) {
      const reg = app.viewRegistry.viewByType;
      if (!reg[type] || reg[type].__bs) { if (reg[type]) done++; continue; }
      const Cls = makeView(api, type), creator = (leaf) => new Cls(leaf); creator.__bs = true;
      reg[type] = creator;
      Cls.__bsCls = true;
      done++;
    }
    return done >= 2;
  };
  // commands that open the views straight in 3D
  let cmds = false;
  const addCommands = () => {
    if (cmds || !window.app || !app.commands || !app.commands.addCommand) return;
    cmds = true;
    const openAs = (type, view) => {
      try { const c = load(); c.view = view; save(c); } catch (e) { /* defaults */ }
      app.workspace.getLeaf("tab").setViewState({ type, active: true });
    };
    app.commands.addCommand({ id: "basalt:graph-3d", name: "Граф: открыть 3D-граф", callback: () => openAs("graph", "3d") });
    app.commands.addCommand({ id: "basalt:graph-2d", name: "Граф: открыть 2D-граф", callback: () => openAs("graph", "2d") });
    app.commands.addCommand({ id: "basalt:graph-local-3d", name: "Граф: открыть локальный 3D-граф", callback: () => openAs("localgraph", "3d") });
    app.commands.addCommand({ id: "basalt:graph-reset-camera", name: "Граф: сбросить камеру", checkCallback: (chk) => { const v = app.workspace.activeLeaf && app.workspace.activeLeaf.view; if (!v || !v.resetCamera) return false; if (!chk) v.resetCamera(); return true; } });
  };
  // a tab restored from the last session may still hold the stock view: swap it for ours
  const fixLeaves = async () => {
    if (!window.app || !app.workspace) return;
    for (const type of ["graph", "localgraph"]) {
      for (const leaf of app.workspace.getLeavesOfType(type)) {
        if (leaf.view && leaf.view.constructor && leaf.view.constructor.__bsCls) continue;
        if (leaf.__bsFixing) continue; leaf.__bsFixing = true;
        try { const st = leaf.getViewState(); await leaf.setViewState({ type: "empty" }); await leaf.setViewState(st); } catch (e) { console.error("[bs-graph] leaf swap failed", e); }
        leaf.__bsFixing = false;
      }
    }
  };
  let tries = 0, hooked = false;
  const timer = setInterval(() => { try { addCommands(); const ok = install(); fixLeaves(); if (ok && !hooked) { hooked = true; try { app.workspace.on("layout-change", fixLeaves); app.workspace.onLayoutReady(fixLeaves); } catch (e) { /* older api */ } } if (ok || ++tries > 120) clearInterval(timer); } catch (e) { if (++tries > 120) clearInterval(timer); console.error("[bs-graph]", e); } }, 1000);
  // show a note in the graph: opens (or reuses) the graph, selects the note and brings it to the middle
  const reveal = async (path) => {
    let leaf = app.workspace.getLeavesOfType("graph")[0];
    if (!leaf) { leaf = app.workspace.getLeaf("tab"); await leaf.setViewState({ type: "graph", active: true }); }
    app.workspace.revealLeaf(leaf);
    for (let t = 0; t < 40; t++) {
      const v = leaf.view; if (v && v.ready && v.g && v.g.nodes.length) { const i = v.g.nodes.findIndex((x) => x.file && x.file.path === path); if (i >= 0) { setTimeout(() => v.setSel(i, true), v.grow ? 1500 : 150); } return; }
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  window.__bsGraph = { install, makeView, vaultGraph, CFG0, reveal };
})();
