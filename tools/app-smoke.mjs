// Smoke test of a running test runtime (tools/test-runtime.ps1 -Port N): opens a note, a canvas and a text file, then checks the
// file explorer, search and graph view, and reports every console error / uncaught exception seen on the way.
//   node tools/app-smoke.mjs --make-vault DIR          writes the throw-away vault (a .md, a .canvas, a .py, a few more notes)
//   node tools/app-smoke.mjs --port 9642               runs the checks (exit code 1 when anything failed)
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (args.includes("--make-vault")) {
  const dir = path.resolve(opt("--make-vault"));
  fs.mkdirSync(path.join(dir, "folder"), { recursive: true });
  fs.writeFileSync(path.join(dir, "Note.md"), "---\ntags: [demo]\naliases: [Sample]\n---\n# Heading\n\nSee [[Other note]] and [[folder/Deep note#Part]] #inline-tag\n\n- [ ] task\n");
  fs.writeFileSync(path.join(dir, "Other note.md"), "# Other\n\nBack to [[Note]]. Fuzzy target: quick brown fox.\n");
  fs.writeFileSync(path.join(dir, "folder", "Deep note.md"), "# Deep\n\n## Part\n\ntext with [[Note|alias]]\n");
  fs.writeFileSync(path.join(dir, "Board.canvas"), JSON.stringify({ nodes: [{ id: "a", type: "text", text: "hello", x: 0, y: 0, width: 200, height: 80 }, { id: "b", type: "file", file: "Other note.md", x: 300, y: 0, width: 200, height: 120 }], edges: [{ id: "e", fromNode: "a", toNode: "b" }] }));
  fs.writeFileSync(path.join(dir, "script.py"), "def main():\n    print('hi')\n");
  console.log("vault:", dir);
  process.exit(0);
}

const port = +opt("--port", 9642);
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page");
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
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") problems.push("log: " + m.params.entry.text.slice(0, 200) + " " + (m.params.entry.url || ""));
};
const send = (method, params) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result.result.value;
};
await send("Runtime.enable", {});
await send("Log.enable", {});

for (let i = 0; i < 120; i++) { if (await run("!!(window.app && app.vault && app.metadataCache && app.workspace && app.workspace.layoutReady)").catch(() => false)) break; await sleep(1000); }
for (let i = 0; i < 60; i++) { const n = await run("app.vault.getMarkdownFiles().filter((f) => !app.metadataCache.getFileCache(f)).length").catch(() => -1); if (n === 0) break; await sleep(1000); }
await sleep(1500);
// the same shim as worker-app-check: in a hidden window onNodeInserted listeners must run after the call returns
await run(`(() => { const H = HTMLElement.prototype, o = H.onNodeInserted; if (o && !o.__d) { H.onNodeInserted = function (l, x) { return o.call(this, () => setTimeout(l, 0), x); }; H.onNodeInserted.__d = true; } })()`);

const results = [];
const check = (name, ok, info) => { results.push({ name, ok: !!ok, info }); console.log(`${ok ? "ok  " : "FAIL"} ${name}${info ? "  " + JSON.stringify(info) : ""}`); };

const open = (p) => run(`(async () => {
  const f = app.vault.getAbstractFileByPath(${JSON.stringify(p)});
  const leaf = app.workspace.getLeaf("tab");
  await leaf.openFile(f);
  await new Promise((r) => setTimeout(r, 2500));
  // the off-screen test window throttles timers: give a canvas up to 30 s to put its nodes into the DOM
  for (let i = 0; i < 30 && leaf.view.getViewType() === "canvas" && !leaf.view.containerEl.querySelector(".canvas-node"); i++) await new Promise((r) => setTimeout(r, 1000));
  const v = leaf.view;
  return { type: v.getViewType(), text: (v.containerEl.innerText || "").slice(0, 120), canvasNodes: v.containerEl.querySelectorAll(".canvas-node").length, cm: v.containerEl.querySelectorAll(".cm-editor, .cm-content").length, file: v.file && v.file.path };
})()`);

const md = await open("Note.md");
check("note opens in the markdown view", md.type === "markdown" && /Heading/.test(md.text), md);
const cv = await open("Board.canvas");
check("canvas opens", cv.type === "canvas" && cv.canvasNodes >= 1, cv);
const py = await open("script.py");
check("text file opens", /def main/.test(py.text), py);

const ex = await run(`(async () => {
  let leaf = app.workspace.getLeavesOfType("basalt-files")[0];
  if (!leaf) { leaf = app.workspace.getLeftLeaf(false); await leaf.setViewState({ type: "basalt-files", active: true }); }
  await new Promise((r) => setTimeout(r, 2500));
  return leaf.view.containerEl.innerText.split(String.fromCharCode(10)).filter(Boolean);
})()`);
check("file explorer lists the vault", ["Note.md", "Other note.md", "Board.canvas", "script.py", "folder"].every((n) => ex.some((x) => x.includes(n))), ex);

const gr = await run(`(async () => {
  const leaf = app.workspace.getLeaf("tab");
  await leaf.setViewState({ type: "graph" });
  await new Promise((r) => setTimeout(r, 3500));
  const el = leaf.view.containerEl;
  return { type: leaf.view.getViewType(), canvases: el.querySelectorAll("canvas").length, nodes: leaf.view.renderer ? 1 : 0 };
})()`);
check("graph view renders", gr.type === "graph" && gr.canvases >= 1, gr);

const se = await run(`(async () => {
  try {
    app.commands.executeCommandById("global-search:open");
    await new Promise((r) => setTimeout(r, 1500));
    const leaf = app.workspace.getLeavesOfType("search")[0];
    if (!leaf) return { error: "no search leaf" };
    const v = leaf.view;
    if (v.setQuery) v.setQuery("fox");
    await new Promise((r) => setTimeout(r, 3000));
    const hits = v.containerEl.querySelectorAll(".search-result-file-match, .search-result-file-title").length;
    return { hits, text: v.containerEl.innerText.slice(0, 200) };
  } catch (e) { return { error: String(e) }; }
})()`);
check("search finds a phrase", se.hits >= 1 && /Other/.test(se.text), se);

// settings dialog: opens with a tab list and a page, closes again
const st = await run(`(async () => {
  try {
    // Basalt replaces the settings window with its own; the inherited one (Modal + Setting classes) is still reachable like this
    window.__bsStock = true;
    app.setting.open();
    window.__bsStock = false;
    await new Promise((r) => setTimeout(r, 2500));
    const tabs = document.querySelectorAll(".modal-container .vertical-tab-nav-item").length;
    const rows = document.querySelectorAll(".modal-container .setting-item").length;
    app.setting.close();
    await new Promise((r) => setTimeout(r, 800));
    return { tabs, rows, closed: !document.querySelector(".modal-container") };
  } catch (e) { return { error: String(e) }; }
})()`);
check("inherited settings dialog opens and closes", st.tabs >= 3 && st.rows >= 1 && st.closed, st);

// command palette (a suggest modal): opens, filters, closes with Escape
const cp = await run(`(async () => {
  try {
    app.commands.executeCommandById("command-palette:open");
    await new Promise((r) => setTimeout(r, 1500));
    const open = !!document.querySelector(".bpal-wrap");
    const input = document.querySelector(".bpal-in input");
    if (input) { input.value = "search"; input.dispatchEvent(new Event("input", { bubbles: true })); }
    await new Promise((r) => setTimeout(r, 1200));
    const items = document.querySelectorAll(".bpal-list > *").length;
    if (input) input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 800));
    return { open, items, closed: !document.querySelector(".bpal-wrap") };
  } catch (e) { return { error: String(e) }; }
})()`);
check("command palette opens, filters, closes", cp.open && cp.items >= 1 && cp.closed, cp);

// tab splits, tab group menu data and a pop-out window
const sp = await run(`(async () => {
  try {
    const ws = app.workspace;
    const before = ws.rootSplit.children.length;
    const a = ws.getLeaf("split", "vertical");
    await a.openFile(app.vault.getAbstractFileByPath("Other note.md"));
    const b = ws.getLeaf("split", "horizontal");
    await b.openFile(app.vault.getAbstractFileByPath("Note.md"));
    await new Promise((r) => setTimeout(r, 1500));
    const splits = ws.rootSplit.containerEl.querySelectorAll(".workspace-split").length + ws.rootSplit.containerEl.querySelectorAll(".workspace-tabs").length;
    const layout = JSON.stringify(ws.getLayout().main);
    a.detach(); b.detach();
    await new Promise((r) => setTimeout(r, 800));
    return { before, after: ws.rootSplit.children.length, splits, layoutOk: /"direction":"horizontal"/.test(layout) };
  } catch (e) { return { error: String(e) }; }
})()`);
check("vertical / horizontal split and close", sp.after === sp.before && sp.splits >= 3 && sp.layoutOk, sp);

const po = await run(`(async () => {
  try {
    const ws = app.workspace;
    const leaf = ws.openPopoutLeaf();
    await leaf.openFile(app.vault.getAbstractFileByPath("Note.md"));
    await new Promise((r) => setTimeout(r, 2000));
    const win = leaf.getContainer();
    const info = { type: win.type, hasWin: !!(win.win && win.win !== window), bodyHasWorkspace: !!win.doc.querySelector(".workspace-leaf"), titlebar: !!win.doc.querySelector(".titlebar, .app-container") };
    win.close();
    await new Promise((r) => setTimeout(r, 800));
    info.closed = ws.floatingSplit.children.length === 0;
    return info;
  } catch (e) { return { error: String(e) }; }
})()`);
check("pop-out window opens and closes", po.type === "window" && po.hasWin && po.bodyHasWorkspace && po.closed, po);

// the custom title bar buttons are built with createDiv({ onclick }) (src/enhance.js)
const tb = await run(`(() => {
  const btns = [...document.querySelectorAll(".titlebar-button-container .titlebar-button, .titlebar-button")];
  const probe = createDiv({ cls: "probe", onclick: () => { window.__probeClicked = true; } });
  probe.click();
  return { buttons: btns.length, onclickWorks: window.__probeClicked === true };
})()`);
check("title bar buttons exist, createDiv({ onclick }) works", tb.buttons >= 1 && tb.onclickWorks, tb);

check("no console errors or exceptions", problems.length === 0, problems.slice(0, 8));
ws.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
