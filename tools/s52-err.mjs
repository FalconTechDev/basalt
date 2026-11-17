const port = +process.argv[2] || 9420;
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1; const pending = new Map(); const errs = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errs.push(JSON.stringify(m.params.args.map(a=>({d:a.description,v:a.value}))).slice(0,2000));
  if (m.method === "Runtime.exceptionThrown") errs.push("EXC "+JSON.stringify(m.params.exceptionDetails).slice(0,2000)); };
const send = (m, p) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  return r.result.result.value;
};
await send("Runtime.enable", {});
// trigger a cursor activity: move selection programmatically
await run(`(() => { const v = app.workspace.getLeavesOfType("markdown")[0].view.editor.cm; v.dispatch({selection:{anchor: v.state.doc.length>10?v.state.doc.line(2).from:0}}); return 1; })()`);
await new Promise(r=>setTimeout(r,800));
console.log(errs.slice(-3).join("\n---\n") || "no errors");
ws.close();
