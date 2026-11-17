const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = await (await fetch("http://127.0.0.1:9300/json")).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1;
const pending = new Map();
const probs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === "Runtime.exceptionThrown") probs.push(m.params.exceptionDetails.text);
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") probs.push(m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
};
const send = (me, pa) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: me, params: pa })); });
const run = async (ex) => {
  const r = await send("Runtime.evaluate", { expression: ex, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result.result.value;
};
const out = await run(`(async () => {
  const leaf = app.workspace.activeLeaf;
  const cm = leaf.view.editor.cm;
  const end = cm.state.doc.length;
  cm.dispatch({ changes: { from: end, insert: "\\n\\n- parent\\n    - child one\\n    - child two\\n        - grandchild\\n> quote line\\n    > nested quote\\n" } });
  const pos = cm.state.doc.toString().lastIndexOf("- parent");
  cm.dispatch({ selection: { anchor: pos + 3 } });
  await new Promise((r) => setTimeout(r, 600));
  const root = leaf.view.containerEl;
  const marks = [...root.querySelectorAll(".cm-indent")].map((e) => e.className);
  return {
    indent: root.querySelectorAll(".cm-indent").length,
    active: root.querySelectorAll(".cm-indent.cm-active-indent").length,
    spacing: root.querySelectorAll(".cm-indent-spacing").length,
    sample: marks.slice(0, 10),
  };
})()`);
console.log(JSON.stringify(out));
console.log("problems:", probs.length ? probs : "none");
ws.close();
process.exit(probs.length ? 1 : 0);
