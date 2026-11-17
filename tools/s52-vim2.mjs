const port = +process.argv[2] || 9420;
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1; const pending = new Map(); const problems = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") problems.push("EXC: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 250));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push("ERR: " + m.params.args.map(a=>a.value??a.description??"").join(" ").slice(0,200)); };
const send = (m, p) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  return r.result.result.value;
};
await send("Runtime.enable", {});
console.log(JSON.stringify(await run(`(() => {
  const leaves = app.workspace.getLeavesOfType("markdown");
  return leaves.map(l => {
    const ed = l.view && l.view.editor; const v = ed && ed.cm;
    return { file: l.view.file && l.view.file.path, cm: !!v, facade: !!(v && v.cm),
      vimCls: v ? v.dom.className.includes("cm-vimMode") : null,
      vimState: v ? !!(v.state.vim) : null };
  });
})()`)));
// force reopen to rebuild extensions
console.log("reopen:", JSON.stringify(await run(`(async () => {
  const f = app.vault.getMarkdownFiles().find(f=>f.path==="Note.md");
  const leaf = app.workspace.getLeaf("tab");
  await leaf.openFile(f);
  await new Promise(r=>setTimeout(r,1500));
  const ed = leaf.view.editor, v = ed.cm;
  return { facade: !!(v&&v.cm), vimCls: v.dom.className, hasVim: !!v.state.vim };
})()`)));
console.log("problems:", problems.length, problems.slice(0,5));
ws.close();
