const port = +process.argv[2] || 9420;
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1; const pending = new Map(); const problems = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") problems.push("EXC: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push("ERR: " + m.params.args.map(a=>a.value??a.description??"").join(" ").slice(0,250)); };
const send = (m, p) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  return r.result.result.value;
};
await send("Runtime.enable", {});
await run(`(() => { const ed=[...app.workspace.getLeavesOfType("markdown")].map(l=>l.view&&l.view.editor).find(e=>e&&e.cm&&e.cm.cm); ed.cm.contentDOM.focus(); return !!ed; })()`);
await new Promise(r=>setTimeout(r,300));
const key = async (k, code, kc, text) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc });
  if (text) await send("Input.dispatchKeyEvent", { type: "char", key: k, code, text, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc });
  await new Promise(r=>setTimeout(r,100));
};
const type = async (s) => { for (const ch of s) await key(ch, "Key"+ch.toUpperCase(), ch.toUpperCase().charCodeAt(0), ch); };
// ensure normal mode: Esc a few times
for (let i=0;i<3;i++) await key("Escape","Escape",27);
// go to top, insert text
await key("g","KeyG",71); await key("g","KeyG",71);
await key("i","KeyI",73);
await type("ZZZINSERTED");
await key("Escape","Escape",27);
await new Promise(r=>setTimeout(r,400));
console.log("after insert:", JSON.stringify(await run(`(() => { const v=[...app.workspace.getLeavesOfType("markdown")].map(l=>l.view&&l.view.editor).find(e=>e&&e.cm&&e.cm.cm).cm; return {head: v.state.doc.toString().slice(0,60), hasInsert: v.state.doc.toString().includes("ZZZINSERTED")}; })()`)));
// undo via vim u
await key("u","KeyU",85);
await new Promise(r=>setTimeout(r,400));
console.log("after undo:", JSON.stringify(await run(`(() => { const v=[...app.workspace.getLeavesOfType("markdown")].map(l=>l.view&&l.view.editor).find(e=>e&&e.cm&&e.cm.cm).cm; return {hasInsert: v.state.doc.toString().includes("ZZZINSERTED")}; })()`)));
// search for Heading with /
await key("/","Slash",191);
await type("Heading");
await key("Enter","Enter",13);
await new Promise(r=>setTimeout(r,500));
console.log("after search:", JSON.stringify(await run(`(() => { const ed=[...app.workspace.getLeavesOfType("markdown")].map(l=>l.view&&l.view.editor).find(e=>e&&e.cm&&e.cm.cm); const f=ed.cm.cm; return {cursor: f.getCursor(), overlay: !!ed.cm.cm6Query, vimStatus: f.state.vim?f.state.vim.status:null}; })()`)));
// n for next match
await key("n","KeyN",78);
await new Promise(r=>setTimeout(r,300));
console.log("problems:", problems.length, problems.slice(0,8));
ws.close();
