const port = +process.argv[2] || 9420;
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (m, p) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  return r.result.result.value;
};
await send("Runtime.enable", {});
console.log(JSON.stringify(await run(`(() => ({
  vimCfg: app.vault.getConfig("vimMode"),
  appJson: app.vault.getConfig(),
  plugins: app.plugins && app.plugins.enabledPlugins ? [...app.plugins.enabledPlugins] : null,
  coreVim: (()=>{try{return app.internalPlugins&&app.internalPlugins.getPluginById?app.internalPlugins.getPluginById("vim"):null}catch(e){return "e:"+e.message}})(),
}))()`)));
ws.close();
