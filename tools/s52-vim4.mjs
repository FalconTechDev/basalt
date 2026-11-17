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
console.log("updateOptions:", JSON.stringify(await run(`(() => {
  try { app.workspace.updateOptions(); } catch(e){ return "e:"+e.message; }
  return "ok";
})()`)));
await new Promise(r=>setTimeout(r,1200));
console.log(JSON.stringify(await run(`(() => {
  const leaf = app.workspace.getLeavesOfType("markdown")[0];
  const ed = leaf.view.editor, v = ed.cm;
  return { facade: !!(v&&v.cm), hasVim: !!v.state.vim, cls: v.dom.className };
})()`)));
// check the dynamic extension compartment contents via facet? try keymap facet
console.log("keys:", JSON.stringify(await run(`(() => {
  const v = app.workspace.getLeavesOfType("markdown")[0].view.editor.cm;
  try {
    // count keymaps bound
    const km = v.state.facet ? null : null;
    return { facets: Object.keys(v.state).slice(0,5) };
  } catch(e){ return "e:"+e.message; }
})()`)));
console.log("problems:", problems.slice(0,6));
ws.close();
