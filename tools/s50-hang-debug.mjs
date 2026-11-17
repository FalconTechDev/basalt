// Opens Test.base, then pauses the (possibly looping) renderer and prints the stack.
const port = +(process.argv[2] || 9400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1; const pend = new Map(); let paused = null;
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Debugger.paused") paused = m.params.callFrames.slice(0, 20).map((f) => `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.location.lineNumber}`);
};
const send = (me, pa) => new Promise((res) => { const i = id++; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: me, params: pa })); });
const run = async (ex) => { const r = await send("Runtime.evaluate", { expression: ex, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? JSON.stringify(r.result?.exceptionDetails ?? r.result); };
await send("Runtime.enable", {});
await send("Debugger.enable", {});
for (let i = 0; i < 90; i++) { if (await run("!!(window.app && app.vault && app.workspace && app.workspace.layoutReady)").catch(() => false)) break; await sleep(1000); }
console.log("ready");
// fire the open without awaiting (it may never resolve)
send("Runtime.evaluate", { expression: `(async()=>{const f=app.vault.getAbstractFileByPath("Test.base");const leaf=app.workspace.getLeaf("tab");await leaf.openFile(f);return "opened"})()`, awaitPromise: true }).then((r) => console.log("open result:", JSON.stringify(r.result?.result ?? r.result?.exceptionDetails)));
await sleep(5000);
for (let k = 0; k < 10 && !paused; k++) { await send("Debugger.pause", {}); await sleep(700); }
if (paused) console.log(paused.join("\n"));
else console.log("no pause captured");
process.exit(0);
