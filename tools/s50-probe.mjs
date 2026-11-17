const port = +(process.argv[2] || 9400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1; const pend = new Map(); const pauses = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Debugger.paused") pauses.push(m.params.callFrames.slice(0, 12).map((f) => `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.location.lineNumber}`).join(" <- "));
};
const send = (me, pa) => new Promise((res) => { const i = id++; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: me, params: pa })); });
const run = async (ex) => { const r = await send("Runtime.evaluate", { expression: ex, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? JSON.stringify(r.result?.exceptionDetails ?? r.result); };
await send("Runtime.enable", {});
await send("Debugger.enable", {});
console.log(await run(`(()=>{const leaf=app.workspace.getLeaf(false);return {type:leaf&&leaf.view&&leaf.view.getViewType&&leaf.view.getViewType(), active:app.workspace.getActiveFile()&&app.workspace.getActiveFile().path}})()`));
// sample the stack a few times
for (let k = 0; k < 6; k++) { pauses.length = 0; await send("Debugger.pause", {}); await sleep(600); if (pauses[0]) console.log("STACK:", pauses[0]); else console.log("(idle)"); }
process.exit(0);
