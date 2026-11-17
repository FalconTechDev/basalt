// Open Test.base, let it run, then Debugger.pause to catch the hang stack.
//   node tools/s50-catch-hang.mjs --port 9401
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const port = +opt("--port", 9401);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1;
const pend = new Map();
const pauses = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === "Debugger.paused") {
    pauses.push(m.params.callFrames.slice(0, 18).map((f) => `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.location.lineNumber}`).join(" <- "));
    // resume so the loop keeps going and we can sample again
    send("Debugger.resume", {});
  }
};
const send = (me, pa) => new Promise((res) => { const i = id++; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: me, params: pa })); });
const run = async (ex, awaitP = false) => {
  const r = await send("Runtime.evaluate", { expression: ex, awaitPromise: awaitP, returnByValue: true });
  return r.result?.result?.value ?? JSON.stringify(r.result?.exceptionDetails ?? r.result);
};
await send("Runtime.enable", {});
await send("Debugger.enable", {});
for (let i = 0; i < 60; i++) { if (await run("!!(window.app && app.vault && app.workspace && app.workspace.layoutReady)").catch(() => false)) break; await sleep(1000); }
console.log("layout ready");
// fire the open; do not await the promise
send("Runtime.evaluate", { expression: `(async()=>{const f=app.vault.getAbstractFileByPath("Test.base");const leaf=app.workspace.getLeaf("tab");try{await leaf.openFile(f);return "opened"}catch(err){return "err:"+err}})()`, awaitPromise: true });
await sleep(6000);
for (let k = 0; k < 8; k++) {
  pauses.length = 0;
  await send("Debugger.pause", {});
  await sleep(900);
  if (pauses[0]) console.log(`STACK${k}:`, pauses[0]);
  else console.log(`STACK${k}: (idle)`);
}
process.exit(0);
