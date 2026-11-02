// Basalt graph, on falconplot's own engine (graph-engine/src/lib.rs -> WASM): the force layout (Barnes-Hut), picking, camera and the
// 2D / 3D drawing run in Rust; this file only feeds it the vault, forwards the pointer and replays the returned draw commands on a canvas.
// Replaces the stock "graph" and "localgraph" views. Needs window.__bsApi.ItemView (exported by the app patch).
(() => {
  "use strict";
  const mainLeaf = (newTab) => { const ws = app.workspace; let l = newTab ? null : ws.getMostRecentLeaf(ws.rootSplit); if (!l || l.getRoot() !== ws.rootSplit) l = ws.getLeaf("tab"); return l; }; /* a file opens in the main area, never in a side panel that happens to be focused */

  const KEY = "basalt-graph-engine-v1";
  const CFG0 = { view: "2d", orphans: true, unresolved: false, canvases: true, images: true, thumbImg: true, thumbCanvas: true, labelMode: "auto", labels: true, nodeScale: 1, edgeAlpha: 0.5, repulsion: 900, linkDistance: 34, linkStrength: 0.7, localDepth: 2, maxNodes: 4000 };
  const load = () => { try { return Object.assign({}, CFG0, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { return Object.assign({}, CFG0); } };
  const save = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* private mode */ } };

  // ---------------------------------------------------------------- groups and hidden notes (kept in the vault's config folder)
  const STORE = { groups: [], assign: {}, solo: [], depth: 1, max: 150, focusKeys: [], fdepth: 1, loaded: false };
  const VIEWS = new Set(); // every open graph view of the vault
  const HIDDEN_ID = "hidden"; // the built-in group "Скрытые": what you hide goes there, its eye is off
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
    const files = app.vault.getFiles().filter((f) => (f.extension === "md" || (c.canvases && f.extension === "canvas") || (c.images && IMGX.test(f.extension) && linkedTo.has(f.path))));
    const resolved = app.metadataCache.resolvedLinks || {}, unres = app.metadataCache.unresolvedLinks || {};
    const idx = new Map(), nodes = [];
    const add = (key, name, extra) => { if (idx.has(key)) return idx.get(key); const i = nodes.length; idx.set(key, i); nodes.push(Object.assign({ key, name, file: null, unresolved: false, folder: "" }, extra)); return i; };
    for (const f of files) add(f.path, f.basename, { kind: f.extension === "canvas" ? "canvas" : f.extension === "md" ? "note" : "img", file: f, folder: f.parent && f.parent.path !== "/" ? f.parent.path.split("/")[0] : "" });
    const have = new Set(files.map((f) => f.path)), seen = new Set(), edges = [];
    const link = (a, b) => { if (a === b) return; const k = a < b ? a * 1048576 + b : b * 1048576 + a; if (seen.has(k)) return; seen.add(k); edges.push([a, b]); };
    for (const [src, dests] of Object.entries(resolved)) if (have.has(src)) for (const dest of Object.keys(dests)) if (have.has(dest)) link(idx.get(src), idx.get(dest));
    if (c.unresolved) for (const [src, dests] of Object.entries(unres)) if (have.has(src)) for (const name of Object.keys(dests)) link(idx.get(src), add("?" + name, name, { unresolved: true }));
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
    .bsg-top { position: absolute; left: 14px; right: 14px; top: 12px; display: flex; gap: 8px; align-items: center; pointer-events: none; }
    .bsg-top > * { pointer-events: auto; }
    .bsg-top .sp { flex: 1; pointer-events: none; }
    .bsg-seg { display: flex; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip);  overflow: hidden; }
    .bsg-seg button, .bsg-btn { background: transparent; box-shadow: none; clip-path: none; border: 0; border-radius: var(--bs-r); color: var(--text-muted); padding: 0 12px; height: 30px; font-size: 12px; cursor: pointer; }
    .bsg-btn { background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 8px; width: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
    .bsg-seg button.is-on { background: var(--interactive-accent); color: var(--text-on-accent); }
    .bsg-seg button:not(.is-on):hover, .bsg-btn:hover { color: var(--text-normal); }
    .bsg-search { width: 260px; height: 30px; border-radius: 0; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); padding: 0 10px; font-size: 12.5px; }
    .bsg-panel { position: absolute; right: 14px; top: 52px; width: 380px; padding: 12px 14px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip);   display: none; font-size: 12.5px; }
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
    .bsg-panel { max-height: calc(100% - 70px); overflow-y: auto; }
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
    .bsg-empty { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; color: var(--text-faint); pointer-events: none; }`;
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
      root.innerHTML = '<div class="bsg"><canvas></canvas><div class="bsg-top"></div><div class="bsg-panel"></div><div class="bsg-card"></div><div class="bsg-status"></div><div class="bsg-empty">В графе пока нет заметок</div></div>';
      this.root = root.querySelector(".bsg"); this.cv = this.root.querySelector("canvas"); this.ctx = this.cv.getContext("2d");
      this.top = this.root.querySelector(".bsg-top"); this.panel = this.root.querySelector(".bsg-panel"); this.status = this.root.querySelector(".bsg-status"); this.card = this.root.querySelector(".bsg-card"); this.helpEl = { classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} } }; this.empty = this.root.querySelector(".bsg-empty");
      this.ex = instance();
      this.buildTop(); this.buildPanel(); this.bind();
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
      row("Приблизить / отдалить", [["Scroll"]]);
      row("Сдвинуть граф", [["Drag"], ["Shift", "Drag"]]);
      row("Переместить узел (2D)", [["Drag"]]);
      row("Выделить, подсветить связанные", [["Click"]]);
      row("Открыть заметку", [["Double Click"]]);
      row("Вписать граф в окно", [["Double Click"], ["0"]]);
      row("Пометить несколько узлов", [["Shift", "Click"]]);
      row("Меню: группа, скрыть, открыть", [["Right Click"]]);
      row("Скрыть выделенное", [["Delete"], ["Backspace"]]);
      row("Найти заметку", [["Ctrl", "F"], ["/"]]);
      row("Следующий найденный", [["Enter"], ["Shift", "Enter"]]);
      row("Снять выделение, закрыть окно", [["Esc"]]);
      row("Отменить", [["Ctrl", "Z"]]);
      row("Применить", [["Ctrl", "Y"], ["Ctrl", "Shift", "Z"]]);
      m.open();
    }
    buildTop() {
      const t = this.top; t.textContent = "";
      const seg = document.createElement("div"); seg.className = "bsg-seg";
      this.segBtns = {}; for (const [k, label] of [["2d", "2D"], ["3d", "3D"]]) { const b = document.createElement("button"); b.textContent = label; b.title = k === "2d" ? "Плоский граф" : "Объёмный граф"; b.addEventListener("click", () => this.setMode(k)); seg.appendChild(b); this.segBtns[k] = b; }
      t.appendChild(seg);
      // search: type to find, Enter / Shift+Enter to go through the matches, Esc to clear
      const box = document.createElement("div"); box.className = "bsg-sbox";
      const search = document.createElement("input"); search.type = "text"; search.className = "bsg-search"; search.placeholder = "Найти заметку…"; this.searchEl = search;
      const count = document.createElement("span"); count.className = "bsg-count"; this.countEl = count;
      const find = () => {
        this.fadeNow(); const q = search.value.trim().toLowerCase();
        this.match = q ? this.g.nodes.map((x, i) => (x.name.toLowerCase().includes(q) ? i : -1)).filter((i) => i >= 0) : null; this.matchAt = 0;
        count.textContent = q ? (this.match.length ? "1 из " + this.match.length : "ничего") : "";
        if (this.match && this.match.length) this.setSel(this.match[0], true); else if (!q) this.setSel(-1); this.dirty = true;
      };
      search.addEventListener("input", find);
      search.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && this.match && this.match.length) { e.preventDefault(); this.matchAt = (this.matchAt + (e.shiftKey ? this.match.length - 1 : 1)) % this.match.length; this.setSel(this.match[this.matchAt], true); count.textContent = (this.matchAt + 1) + " из " + this.match.length; }
        else if (e.key === "Escape") { search.value = ""; find(); search.blur(); }
      });
      box.append(search, count); t.appendChild(box);
      const sp = document.createElement("div"); sp.className = "sp"; t.appendChild(sp);
      const mk = (icon, title, fn) => { const b = document.createElement("button"); b.className = "bsg-btn"; b.title = title; if (api2().setIcon) api2().setIcon(b, icon); b.addEventListener("click", fn); t.appendChild(b); return b; };
      mk("lucide-locate-fixed", "Вписать весь граф в окно (двойной клик по пустому месту)", () => this.fitView());
      mk("lucide-circle-help", "Справка", () => { this.panel.classList.remove("is-open"); this.openHelp(); });
      mk("lucide-settings", "Настройки графа", () => { this.panel.classList.toggle("is-open"); this.helpEl.classList.remove("is-open"); });
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
      heading("Что показывать", "lucide-eye");
      pair("Холсты", "lucide-layout-dashboard", "Файлы .canvas: в графе / значком", () => c.canvases, (v) => { c.canvases = v; this.rebuild(); }, () => c.thumbCanvas, (v) => { c.thumbCanvas = v; this.dirty = true; });
      pair("Картинки", "lucide-image", "Картинки со ссылками: в графе / значком", () => c.images, (v) => { c.images = v; this.rebuild(); }, () => c.thumbImg, (v) => { c.thumbImg = v; this.dirty = true; });
      toggle("Заметки без связей", "lucide-circle-dashed", "Одиночные заметки, которые ни с чем не связаны", () => c.orphans, (v) => { c.orphans = v; this.rebuild(); });
      toggle("Ссылки на несозданные", "lucide-file-question", "Ссылка есть, а файла ещё нет", () => c.unresolved, (v) => { c.unresolved = v; this.rebuild(); });
      if (type === "localgraph") slider("Глубина", "lucide-layers", "Сколько шагов от открытой заметки", "localDepth", 1, 6, 1, () => this.rebuild());
      heading("Вид", "lucide-palette");
      lead(new S(p).setName("Подписи").setDesc("Авто: у главных узлов"), "lucide-type").addDropdown((d) => d.addOptions({ auto: "Авто", all: "Все", none: "Нет" }).setValue(c.labelMode).onChange((v) => { c.labelMode = v; save(c); this.style(); }));
      slider("Размер узлов", "lucide-circle-dot", "", "nodeScale", 0.5, 2.5, 0.1, () => this.style());
      slider("Яркость связей", "lucide-sun", "", "edgeAlpha", 0.1, 1, 0.05, () => this.style());
      heading("Раскладка", "lucide-network");
      slider("Длина связей", "lucide-ruler", "", "linkDistance", 10, 120, 2, () => this.forces());
      slider("Притяжение", "lucide-magnet", "Насколько связанные узлы тянутся друг к другу", "linkStrength", 0.1, 1.5, 0.05, () => this.forces());
      new S(p)
        .addButton((b) => b.setIcon("lucide-rotate-ccw").setTooltip("Сбросить длину и притяжение").onClick(() => { c.linkDistance = CFG0.linkDistance; c.linkStrength = CFG0.linkStrength; save(c); this.forces(); this.buildPanel(); }))
        .addButton((b) => b.setIcon("lucide-shuffle").setTooltip("Пересчитать: раскидать узлы заново").onClick(() => { this.ex.ge_reheat(1); this.running = true; }));
      this.panelFocus(p, heading);
      this.panelGroups(p, heading);
    }
    // the focus (a picture built around some nodes) is a part of the settings
    panelFocus(p, heading) {
      if (!STORE.focusKeys.length) return;
      heading("Фокус", "lucide-focus");
      const nm = STORE.focusKeys.length === 1 ? STORE.focusKeys[0].split("/").pop().replace(/[.]md$/, "") : STORE.focusKeys.length + " узлов";
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
      this.nodesTotal = n; this.style(); this.forces();
      const grow = false; /* the growing intro is off: the graph opens already laid out */ /* the first picture is watched growing: a tight knot that the forces push out, links stretching as it goes */
      this.introDone = true;
      ex.ge_set_intro(grow ? 0 : -1, grow ? 0.5 : 1); ex.ge_lock_bounds(grow ? 1 : 0); ex.ge_set_max_step(grow ? 5 : 0); this.grow = grow ? performance.now() : 0; this.growLabels = grow;
      if (!grow && this.keyIndex) { const pk = ex.ge_keep(n || 1), ku = new Uint32Array(ex.memory.buffer, pk, n || 1); g.nodes.forEach((x, k) => { ku[k] = this.keyIndex.has(x.key) ? this.keyIndex.get(x.key) : 0xffffffff; }); } /* the layout keeps its places: a change moves only what changed */
      const prevSel = this.sel >= 0 && this.oldNodes ? this.oldNodes[this.sel] : null;
      // the finished positions are computed out of sight; the eye only sees them move there (the first picture spreads from the centre, outwards)
      const mode = this.regroup ? 3 : (this.tweenedOnce ? 2 : 1); this.tweenedOnce = true; this.regroup = false;
      ex.ge_set_tween(mode, mode === 1 ? 3200 : mode === 3 ? 1300 : 800);
      ex.ge_set_graph(words, bytes.length);
      if (mode === 1) { this.cv.style.transition = "none"; this.cv.style.opacity = "0"; requestAnimationFrame(() => requestAnimationFrame(() => { this.cv.style.transition = "opacity 1.1s ease"; this.cv.style.opacity = "1"; })); }
      this.keyIndex = new Map(g.nodes.map((x, k) => [x.key, k])); this.oldNodes = g.nodes.map((x) => x.key);
      this.hover = -1; this.hlTo = undefined; { const k = prevSel && this.keyIndex.has(prevSel) ? this.keyIndex.get(prevSel) : -1; this.sel = k; ex.ge_select(k, 1); this.cardFor(k); }
      this.tweening = n > 0; this.running = false; this.lastT = performance.now(); this.growLabels = n > 0; this.style(); ex.ge_freeze_bounds(1); this.frozen = true; this.dirty = true; this.empty.style.display = n ? "none" : "flex";
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
        if (d.node >= 0) this.ex.ge_unpin(d.node);
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
      cv.addEventListener("pointerdown", () => { this.closeMenu(); this.root.focus({ preventScroll: true }); }, true);
      this.root.addEventListener("keydown", (e) => {
        const tag = (e.target && e.target.tagName) || ""; if (/INPUT|TEXTAREA/.test(tag)) return;
        if (e.key === "Escape") { if (this.menuEl) this.closeMenu(); else if (this.panel.classList.contains("is-open") || this.helpEl.classList.contains("is-open")) { this.panel.classList.remove("is-open"); this.helpEl.classList.remove("is-open"); } else { this.multi = new Set(); this.setSel(-1); } e.preventDefault(); }
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
      const hk = Math.min(1, (now - this.hlT0) / 200), blend = !this.anim && hk < 1 && this.hlFrom !== this.hlTo;
      this.hlK = blend ? ease(hk) : 1;
      if (blend) { this.dirty = true; this.paintBlend(ex, w, h, dpr, target, ease(hk)); this.halos(ex); this.drawGroups(ex); this.drawThumbs(ex); this.status.innerHTML = this.statusHtml(); return; }
      ex.ge_select(target, 1);
      const layered = !!(this.anim || this.fade);
      if (layered) this.dirty = true;
      const ptr = ex.ge_render(w, h, this.hover >= 0 ? this.hover : this.sel), len = ex.ge_out_len();
      const main = this.ctx;
      if (layered) { if (!this.buf || this.buf.width !== this.cv.width || this.buf.height !== this.cv.height) { this.buf = document.createElement("canvas"); this.buf.width = this.cv.width; this.buf.height = this.cv.height; } this.ctx = this.buf.getContext("2d"); }
      this.paint(new Float32Array(ex.memory.buffer, ptr, len), w, h, dpr);
      this.halos(ex); this.drawGroups(ex); this.drawThumbs(ex);
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
      const load = n.kind === "canvas" ? Promise.resolve(window.__fpRenderNested ? window.__fpRenderNested(f, 256) : null).then((r) => (r && r.bmp ? createImageBitmap(r.bmp) : null)) /* our own copy: the canvas module may close its bitmaps */
        : fetch(this.app.vault.getResourcePath(f)).then((r) => r.blob()).then((b) => createImageBitmap(b, { resizeWidth: 160, resizeQuality: "medium" }));
      load.then((b) => { if (b) { t.bmp = b; this.dirty = true; } }).catch(() => {});
      return null;
    }
    drawThumbs(ex) {
      // Basalt's shape: the top-left and bottom-right corners are cut
      const cut = (c, x, y, w, h, k) => { c.beginPath(); c.moveTo(x + k, y); c.lineTo(x + w, y); c.lineTo(x + w, y + h - k); c.lineTo(x + w - k, y + h); c.lineTo(x, y + h); c.lineTo(x, y + k); c.closePath(); };
      if (!this.g.nodes.some((x) => x.kind !== "note") || (!this.c.thumbImg && !this.c.thumbCanvas)) { this.thumbRects = []; return; }
      const c = this.ctx, target = this.hlTo === undefined ? -1 : this.hlTo, nbs = target >= 0 ? this.adjOf(target) : null;
      const sc = this.c.nodeScale, acc = this.accentCss || "#c98d5b";
      let drawn = 0; this.thumbRects = [];
      for (let i = 0; i < this.g.nodes.length && drawn < 260; i++) {
        const n = this.g.nodes[i]; if (n.kind === "note" || !n.file) continue;
        if (n.kind === "img" ? !this.c.thumbImg : !this.c.thumbCanvas) continue; /* switched off: the plain ball of the engine shows */
        if (!ex.ge_screen_of(i)) continue; const f = new Float32Array(ex.memory.buffer, ex.ge_input(2), 2), x = f[0], y = f[1];
        if (x < -40 || y < -40 || x > this.W + 40 || y > this.H + 40) continue;
        const t = this.thumb(n); drawn++; { const hw = n.kind === "img" ? 22 * sc : 34 * sc * 0.9, hh2 = n.kind === "img" ? 22 * sc : 17 * sc; this.thumbRects.push([i, x - hw, y - hh2, x + hw, y + hh2]); }
        const hot = i === target;
        c.save(); c.globalAlpha = this.alphaOf(i); try {
        if (n.kind === "img") {
          const r = 22 * sc, q = 6; c.beginPath(); cut(c, x - r, y - r, r * 2, r * 2, Math.min(8, r * 0.4)); c.save(); c.clip();
          if (t) { const s2 = (r * 2) / Math.min(t.bmp.width, t.bmp.height); c.drawImage(t.bmp, x - (t.bmp.width * s2) / 2, y - (t.bmp.height * s2) / 2, t.bmp.width * s2, t.bmp.height * s2); } else { c.fillStyle = "rgba(128,128,128,.4)"; c.fill(); }
          c.restore(); c.lineWidth = hot ? 2.5 : 1.5; c.strokeStyle = hot ? acc : "rgba(255,255,255,.35)"; c.beginPath(); cut(c, x - r, y - r, r * 2, r * 2, Math.min(8, r * 0.4)); c.stroke();
        } else {
          const ratio = t ? t.bmp.width / t.bmp.height : 1.4, hh = 34 * sc, ww = hh * Math.min(2, Math.max(0.7, ratio)), r = 5;
          c.beginPath(); cut(c, x - ww / 2, y - hh / 2, ww, hh, Math.min(8, hh * 0.28)); c.fillStyle = "rgba(20,20,24,.85)"; c.fill(); c.save(); c.clip();
          if (t) c.drawImage(t.bmp, x - ww / 2 + 1, y - hh / 2 + 1, ww - 2, hh - 2); c.restore();
          c.lineWidth = hot ? 2.5 : 1.5; c.strokeStyle = acc; c.beginPath(); cut(c, x - ww / 2, y - hh / 2, ww, hh, Math.min(8, hh * 0.28)); c.stroke();
        }
        } catch (err) { /* a detached bitmap: forget it, it is loaded again */ if (this.thumbs) this.thumbs.delete(n.key); this.dirty = true; }
        c.restore();
      }
    }
    pickAt(x, y, w, h) { for (const [i, x0, y0, x1, y1] of this.thumbRects || []) if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return i; return this.ex.ge_pick(x, y, w, h); }
    // how bright a node drawn over the engine's picture is: the same fade as the engine's own highlight (between the old and the new state)
    alphaOf(i) {
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
      const f = n.file; if (!f) return;
      const box = document.createElement("div"); box.className = "pv"; let src = null;
      const IM = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;
      if (n.kind === "img") src = this.app.vault.getResourcePath(f);
      else if (n.kind === "note") { const cache = this.app.metadataCache.getFileCache(f), em = ((cache && cache.embeds) || []).find((e) => IM.test(e.link)); const t = em && this.app.metadataCache.getFirstLinkpathDest(em.link.split("#")[0], f.path); if (t) src = this.app.vault.getResourcePath(t); }
      if (src) { const im = document.createElement("img"); im.src = src; box.appendChild(im); el.appendChild(box); }
      else if (n.kind === "canvas" && window.__fpRenderNested) { const cv = document.createElement("canvas"); box.appendChild(cv); el.appendChild(box); Promise.resolve(window.__fpRenderNested(f, 512)).then((r) => { if (!r || !r.bmp) { box.remove(); return; } const W = 560, H = 300; cv.width = W; cv.height = H; const g = cv.getContext("2d"), k = Math.min(W / r.bmp.width, H / r.bmp.height); g.drawImage(r.bmp, (W - r.bmp.width * k) / 2, (H - r.bmp.height * k) / 2, r.bmp.width * k, r.bmp.height * k); }).catch(() => box.remove()); }
    }
    // groups you make yourself and the notes you hid: both live in the panel and in the right-click menu
    panelGroups(p, heading) {
      const S = api2().Setting; heading("Группы", "lucide-folder-tree");
      const counts = {}; for (const k of Object.values(STORE.assign)) counts[k] = (counts[k] || 0) + 1;
      const apply = () => { this.regroup = true; this.sig = null; this.rebuild(); this.buildPanel(); };
      if (!STORE.groups.length) new S(p).setDesc("Групп нет. Правая кнопка по узлу, «Группа», или кнопка ниже.");
      for (const g of STORE.groups) {
        const st = new S(p).setName(g.name).setDesc((counts[g.id] || 0) + " узлов");
        st.settingEl.toggleClass("bsg-off", !!g.hidden); st.settingEl.toggleClass("bsg-solo", STORE.solo.includes(g.id));
        if (!g.system) st.addColorPicker((cp) => cp.setValue(g.color).onChange((v) => { g.color = v; saveStore(); this.dirty = true; }));
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
        new S(p).setName("Уровней от группы").setDesc("Что вокруг выбранных групп").addSlider((sl) => sl.setLimits(0, 5, 1).setValue(STORE.depth).setDynamicTooltip().onChange((v) => { STORE.depth = v; clearTimeout(this.focT); this.focT = setTimeout(() => { saveStore(); this.regroup = true; this.sig = null; this.rebuild(); }, 250); }));
        new S(p).setName("Узлов не больше").addSlider((sl) => sl.setLimits(10, 500, 10).setValue(STORE.max).setDynamicTooltip().onChange((v) => { STORE.max = v; clearTimeout(this.focT); this.focT = setTimeout(() => { saveStore(); this.regroup = true; this.sig = null; this.rebuild(); }, 250); }));
        new S(p).addButton((b) => b.setButtonText("Показать весь граф").onClick(() => this.clearFocus()));
      }
      new S(p).addButton((b) => b.setButtonText("Новая группа").onClick(() => { this.newGroup("", Array.from(this.multi || []).map((i) => this.g.nodes[i] && this.g.nodes[i].key).filter(Boolean)); }));
    }
    newGroup(name, keys) {
      const g = { id: "g" + Date.now().toString(36), name: name || "Группа " + (STORE.groups.length + 1), color: GROUP_COLORS[STORE.groups.length % GROUP_COLORS.length] };
      STORE.groups.push(g); for (const k of keys) STORE.assign[k] = g.id; saveStore(); this.buildPanel(); this.dirty = true; return g;
    }
    groupOf(n) { const id = STORE.assign[n.key]; return id ? STORE.groups.find((g) => g.id === id) : null; }
    // which nodes a command applies to: the ones marked with Shift, if the node under the pointer is one of them
    targets(hit) { if (hit >= 0 && this.multi && this.multi.size > 1 && this.multi.has(hit)) return Array.from(this.multi); return hit >= 0 ? [hit] : []; }
    hideNodes(idx) { const g = hiddenGroup(); g.hidden = true; for (const i of idx) { const n = this.g.nodes[i]; if (n) STORE.assign[n.key] = g.id; } this.multi = new Set(); this.sel = -1; saveStore(); this.sig = null; this.rebuild(); this.buildPanel(); }
    // the picture built around some nodes (not a group): they are shown with what is around them; a bar at the top says so and ends it
    focusOn(idx) { STORE.focusKeys = idx.map((i) => this.g.nodes[i] && this.g.nodes[i].key).filter(Boolean); STORE.fdepth = 1; saveStore(); this.afterState(); this.panel.classList.add("is-open"); this.helpEl.classList.remove("is-open"); }
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
        if (!many && nodes[0].file) { add(m, "Открыть", "lucide-file-text", () => this.openNote(hit, false)); add(m, "Открыть в новой вкладке", "lucide-file-plus", () => this.openNote(hit, true)); m.addSeparator(); }
        m.addItem((it) => {
          it.setTitle("Группа").setIcon("lucide-folder-tree"); const sub = it.setSubmenu();
          for (const g of STORE.groups) { if (g.system) continue; sub.addItem((x) => x.setTitle(g.name).setIcon("lucide-circle").setChecked(nodes.every((n) => STORE.assign[n.key] === g.id)).onClick(() => { for (const n of nodes) STORE.assign[n.key] = g.id; saveStore(); this.buildPanel(); this.dirty = true; })); }
          if (STORE.groups.some((g) => !g.system)) sub.addSeparator();
          sub.addItem((x) => x.setTitle("Новая группа…").setIcon("lucide-plus").onClick(() => this.newGroup("", nodes.map((n) => n.key))));
          if (nodes.some((n) => STORE.assign[n.key])) sub.addItem((x) => x.setTitle("Убрать из группы").setIcon("lucide-minus").onClick(() => { for (const n of nodes) delete STORE.assign[n.key]; saveStore(); this.buildPanel(); this.dirty = true; }));
        });
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
      mk("t", n.name); mk("m", (n.kind === "img" ? "картинка · " : n.kind === "canvas" ? "холст · " : "") + (n.folder || "корень") + " · связей: " + nb.length);
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
    paint(d, w, h, dpr) {
      const c = this.ctx; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
      const col = (i) => "rgba(" + d[i] + "," + d[i + 1] + "," + d[i + 2] + "," + d[i + 3] + ")";
      let i = 0, clips = 0;
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
          c.textAlign = ha === 1 ? "center" : ha === 2 ? "right" : "left"; c.textBaseline = va === 1 ? "middle" : va === 2 ? "bottom" : "top"; c.lineWidth = 3; c.strokeStyle = this.bgCss; c.globalAlpha = this.labelA === undefined ? 1 : this.labelA; c.strokeText(s, x, y); c.fillText(s, x, y); c.globalAlpha = 1; }
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
