// Runtime differential scenario for the workspace layer. Drives a running test runtime (tools/test-runtime.ps1) through a fixed
// sequence of workspace operations and prints a normalised snapshot after every step (layout JSON with ids replaced by
// their order of appearance, plus the class skeleton of the workspace DOM). Run it against the ORIGINAL build and the NEW one and
// diff the two outputs:
//   node tools/ws-scenario.mjs --port 9655 > new.json     (and the same on a runtime that runs the base revision)
import fs from "node:fs";

const args = process.argv.slice(2);
const port = +(args[args.indexOf("--port") + 1] || 9655);
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page" && t.url.includes("index.html")) || list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1;
const pending = new Map();
const problems = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") problems.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push("console.error: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
};
const send = (method, params) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result.result.value;
};
await send("Runtime.enable", {});
for (let i = 0; i < 120; i++) { if (await run("!!(window.app && app.workspace && app.workspace.layoutReady)").catch(() => false)) break; await new Promise((r) => setTimeout(r, 1000)); }
await new Promise((r) => setTimeout(r, 3000));

// helpers installed in the page
await run(`window.__snap = function () {
  const ids = new Map();
  const norm = (o) => {
    if (Array.isArray(o)) return o.map(norm);
    if (o && typeof o === "object") { const r = {}; for (const k of Object.keys(o)) { if ((k === "id" || k === "active") && typeof o[k] === "string") { if (!ids.has(o[k])) ids.set(o[k], "n" + ids.size); r[k] = ids.get(o[k]); } else if (["x","y","width","height","zoom","maximize"].includes(k) && o.type === "window") r[k] = "-"; else if (k === "dimension" && typeof o[k] === "number") r[k] = Math.round(o[k] * 100) / 100; else r[k] = norm(o[k]); } return r; }
    return o;
  };
  const skel = (el, d) => { if (d > 7 || !el || !el.children) return ""; const c = [...el.children].filter((x) => !/^(workspace-leaf-resize-handle)$/.test(x.className)).map((x) => skel(x, d + 1)).filter(Boolean); const cls = (typeof el.className === "string" ? el.className : "").split(/\\s+/).filter((x) => /^(workspace|mod-|is-|view-|sidebar|side-dock|titlebar)/.test(x) && !/is-focused|is-active|mod-active|is-hidden|is-translucent|is-popout|is-grabbing/.test(x)).sort().join(".") ; return cls ? "(" + cls + (c.length ? " " + c.join(" ") : "") + ")" : c.join(" "); };
  const w = app.workspace;
  return JSON.stringify({ layout: norm(w.getLayout()), dom: skel(w.containerEl, 0), activeType: w.activeLeaf && w.activeLeaf.view.getViewType(), leaves: (function(){ const n=[]; w.iterateAllLeaves((l)=>n.push(l.view.getViewType()+":"+(l.view.file?l.view.file.path:"")+":"+(l.getContainer()===w.rootSplit?"root":l.getContainer().type))); return n; })(), menu: window.__menuItems, hl: window.__hl && JSON.stringify(window.__hl.history.serialize()).replace(/"eState":{[^}]*}/g,"").slice(0,900), hlType: window.__hl && window.__hl.view.getViewType(), hist: (function(){ const h=[]; w.iterateAllLeaves((l)=>h.push(l.history.backHistory.length+"/"+l.history.forwardHistory.length+(l.group?"g":"")+(l.pinned?"p":""))); return h; })(), left: w.leftSplit.collapsed, right: w.rightSplit.collapsed });
}`);
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const steps = [];
const snap = async (name) => { await settle(1200); const s = JSON.parse(await run("__snap()")); steps.push({ step: name, ...s }); };
const op = async (name, code) => { try { await run(code); } catch (e) { steps.push({ step: name, error: String(e.message).slice(0, 200) }); return; } await snap(name); };

await snap("initial");
await op("open-note", `(async()=>{ const l = app.workspace.getLeaf("tab"); await l.openFile(app.vault.getAbstractFileByPath("Note.md")); })()`);
await op("open-other-tab", `(async()=>{ const l = app.workspace.getLeaf("tab"); await l.openFile(app.vault.getAbstractFileByPath("Other note.md")); })()`);
await op("split-vertical", `(async()=>{ const l = app.workspace.getLeaf("split", "vertical"); await l.openFile(app.vault.getAbstractFileByPath("Board.canvas")); })()`);
await op("split-horizontal", `(async()=>{ const l = app.workspace.getLeaf("split", "horizontal"); await l.openFile(app.vault.getAbstractFileByPath("script.py")); })()`);
await op("select-first-tab", `(()=>{ const g = app.workspace.rootSplit.children[0]; let t = g; while (t && t.type !== "tabs") t = t.children[0]; t.selectTabIndex(0); })()`);
await op("stack-tabs", `(()=>{ const g = app.workspace.getLeavesOfType("markdown")[0].parent; g.setStacked(true); })()`);
await op("unstack-tabs", `(()=>{ const g = app.workspace.getLeavesOfType("markdown")[0].parent; g.setStacked(false); })()`);
await op("drop-file-end", `(async()=>{ const g = app.workspace.getLeavesOfType("markdown")[0].parent; const hc = g.tabHeaderContainerEl; const r = g.children[0].tabHeaderEl.getBoundingClientRect(); const dm = app.dragManager; dm.draggable = { type: 'file', file: app.vault.getAbstractFileByPath('script.py'), source: 'x', icon: '', title: '' }; const mk = (t) => new DragEvent(t, { bubbles: true, cancelable: true, clientX: r.x + r.width * 0.9, clientY: r.y + 5, dataTransfer: new DataTransfer() }); hc.dispatchEvent(mk("dragover")); hc.dispatchEvent(mk("drop")); dm.draggable = null; await new Promise((r) => setTimeout(r, 1500)); })()`);
await op("drop-link-middle", `(async()=>{ const g = app.workspace.getLeavesOfType("markdown")[0].parent; const hc = g.tabHeaderContainerEl; const r = g.children[0].tabHeaderEl.getBoundingClientRect(); const dm = app.dragManager; dm.draggable = { type: 'link', linktext: 'Folder/Deep note', sourcePath: '', source: 'x', icon: '', title: '' }; const mk = (t) => new DragEvent(t, { bubbles: true, cancelable: true, clientX: r.x + r.width * 0.5, clientY: r.y + 5, dataTransfer: new DataTransfer() }); hc.dispatchEvent(mk("dragover")); hc.dispatchEvent(mk("drop")); dm.draggable = null; await new Promise((r) => setTimeout(r, 1500)); })()`);
await op("drop-files", `(async()=>{ const g = app.workspace.getLeavesOfType("markdown")[0].parent; const hc = g.tabHeaderContainerEl; const r = g.children[0].tabHeaderEl.getBoundingClientRect(); const dm = app.dragManager; dm.draggable = { type: 'files', files: [app.vault.getAbstractFileByPath('Board.canvas'), app.vault.getAbstractFileByPath('Other note.md')], source: 'x', icon: '', title: '' }; const mk = (t) => new DragEvent(t, { bubbles: true, cancelable: true, clientX: r.x + r.width * 0.1, clientY: r.y + 5, dataTransfer: new DataTransfer() }); hc.dispatchEvent(mk("dragover")); hc.dispatchEvent(mk("drop")); dm.draggable = null; await new Promise((r) => setTimeout(r, 1500)); })()`);
await op("history-nav", `(async()=>{ const l = app.workspace.getLeaf("tab"); const v = (p) => app.vault.getAbstractFileByPath(p); await l.openFile(v("Note.md")); await l.openFile(v("Other note.md")); await l.openFile(v("folder/Deep note.md")); await l.history.back(); await l.history.back(); await l.history.forward(); await l.history.go(-5); await l.history.go(5); window.__hl = l; })()`);
await op("open-link-text", `(async()=>{ const l = app.workspace.getLeaf("tab"); await l.openLinkText("Other note#Other", "Note.md"); await l.openLinkText("Brand new note", "Note.md"); })()`);
await op("group-leaves", `(()=>{ const a = app.workspace.getLeaf("tab"), b = app.workspace.getLeaf("tab"); a.setGroupMember(b); b.setPinned(true); window.__ga = a; })()`);
await op("ungroup-unpin", `(()=>{ window.__ga.setGroup(null); app.workspace.iterateAllLeaves((l) => { if (l.pinned) l.setPinned(false); }); })()`);
await op("rebuild-view", `(async()=>{ await window.__hl.rebuildView(); await window.__hl.setViewState({ type: "empty", state: {} }); await window.__hl.setViewState({ type: "unknown-type-xyz", state: {} }); })()`);
await op("tab-menu", `(()=>{ const l = window.__hl; const r = l.tabHeaderEl.getBoundingClientRect(); l.tabHeaderEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.x + 5, clientY: r.y + 5 })); const items = [...document.querySelectorAll(".menu .menu-item-title")].map((x) => x.textContent); document.querySelectorAll(".menu").forEach((m) => m.remove()); window.__menuItems = items; })()`);
await op("set-dimensions", `(()=>{ const r = app.workspace.rootSplit; r.children.forEach((c, i) => c.setDimension(30 + i * 20)); r.recomputeChildrenDimensions(); })()`);
await op("pin-leaf", `(()=>{ app.workspace.getLeavesOfType("markdown")[0].setPinned(true); })()`);
await op("collapse-left", `app.workspace.leftSplit.collapse()`);
await op("expand-left", `app.workspace.leftSplit.expand()`);
await op("collapse-right", `app.workspace.rightSplit.collapse()`);
await op("detach-canvas", `(()=>{ app.workspace.getLeavesOfType("canvas").forEach((l) => l.detach()); })()`);
await op("move-leaf", `(()=>{ const ls = app.workspace.getLeavesOfType("markdown"); const target = app.workspace.getLeavesOfType("basalt-textfile")[0]; if (ls[1] && target) { ls[1].detach(); } })()`);
await op("open-in-sidebar", `(async()=>{ const l = app.workspace.getRightLeaf(false); await l.setViewState({ type: "backlink", active: true }); })()`);
await op("ribbon-add", `(()=>{ const r = app.workspace.leftRibbon; r.addRibbonItemButton("t-one", "star", "One", () => {}); r.addRibbonItemButton("t-two", "lucide-plus", "Two", () => {}); r.addRibbonItemButton("t-one", "star", "One again", () => {}); })()`);
await op("ribbon-hide-item", `(()=>{ const r = app.workspace.leftRibbon; r.items.find((i) => i.id === "t-two").hidden = true; r.onChange(true); const s = r.serialize(); r.load(Object.assign({}, s, { hiddenItems: Object.fromEntries(Object.entries(s.hiddenItems).reverse()) })); r.removeRibbonAction("t-two"); })()`);
await op("ribbon", `(()=>{ app.workspace.leftRibbon.hide(); })()`);
await op("ribbon-show", `(()=>{ app.workspace.leftRibbon.show(); })()`);
await op("layout-roundtrip", `(async()=>{ const lay = app.workspace.getLayout(); await app.workspace.changeLayout(lay); })()`);
await op("popout-open", `(async()=>{ const l = app.workspace.openPopoutLeaf(); await l.openFile(app.vault.getAbstractFileByPath("Note.md")); })()`);
await op("popout-close", `(()=>{ app.workspace.floatingSplit.children.slice().forEach((w) => w.close()); })()`);
await op("detach-all-root", `(()=>{ app.workspace.iterateRootLeaves((l) => l.detach()); })()`);

console.log(JSON.stringify({ steps, problems }, null, 1));
process.exit(0);
