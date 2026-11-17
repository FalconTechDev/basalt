// Targeted check for the s40 fold/indent decorations in a running test runtime.
//   node tools/s40-verify.mjs --port 9300
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = +opt("--port", 9300);
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
};
const send = (method, params) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result.result.value;
};
await send("Runtime.enable", {});
for (let i = 0; i < 60; i++) { if (await run("!!(window.app && app.workspace && app.workspace.layoutReady)").catch(() => false)) break; await sleep(1000); }
await sleep(1000);

// open the note in a fresh leaf, source mode if needed
const info = await run(`(async () => {
  const f = app.vault.getAbstractFileByPath("Note.md");
  const leaf = app.workspace.getLeaf("tab");
  await leaf.openFile(f);
  const view = leaf.view;
  // ensure we are in an editable markdown view
  if (view.getMode && view.getMode() !== "source") { try { await view.setState({ mode: "source" }, { history: false }); } catch (e) {} }
  await new Promise(r => setTimeout(r, 800));
  const root = leaf.view.containerEl;
  const q = (s) => root.querySelectorAll(s).length;
  return {
    mode: view.getMode ? view.getMode() : "?",
    cmEditors: root.querySelectorAll(".cm-editor").length,
    indentMarks: q(".cm-indent"),
    indentActive: q(".cm-indent.cm-active-indent"),
    indentSpacing: q(".cm-indent-spacing"),
    foldIndicators: q(".cm-fold-indicator"),
    collapseIcons: q(".collapse-indicator.collapse-icon"),
    selectionLayer: q(".cm-selectionLayer"),
    cursorLayer: q(".cm-cursorLayer"),
  };
})()`);
console.log(JSON.stringify(info));
console.log("problems:", problems.length ? problems : "none");
ws.close();
process.exit(problems.length ? 1 : 0);
