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
console.log(JSON.stringify(await run(`(() => {
  const out = { vimEnabled: app.isVimEnabled() };
  const leaf = app.workspace.getLeavesOfType("markdown")[0];
  const ed = leaf.view.editor;
  out.sourceMode = ed.sourceMode;
  out.cmInit = ed.cmInit;
  // inspect the view's plugin list indirectly: check state fields for vim
  const v = ed.cm;
  out.vimInState = v ? !!v.state.vim : null;
  // try the vim status field presence via DOM
  out.domCls = v.dom.className;
  out.hasVimKeymap = !!document.querySelector(".cm-vimMode, .cm-fat-cursor");
  return out;
})()`)));
ws.close();
