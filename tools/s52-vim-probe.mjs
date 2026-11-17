const port = +process.argv[2] || 9420;
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1; const pending = new Map(); const problems = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") problems.push("EXC: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push("ERR: " + m.params.args.map(a=>a.value??a.description??"").join(" ").slice(0,200));
};
const send = (m, p) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  return r.result.result.value;
};
await send("Runtime.enable", {});
for (let i = 0; i < 60; i++) { if (await run("!!(window.app && app.vault && app.workspace && app.workspace.layoutReady)").catch(() => false)) break; await new Promise(r=>setTimeout(r,500)); }
await new Promise(r=>setTimeout(r,1500));

// open the note
console.log("open:", JSON.stringify(await run(`(async () => {
  const f = app.vault.getMarkdownFiles().find(f=>f.path==="Note.md") || app.vault.getMarkdownFiles()[0];
  const leaf = app.workspace.getLeaf("tab");
  await leaf.openFile(f);
  await new Promise(r=>setTimeout(r,1200));
  const ed = leaf.view && leaf.view.editor;
  const cm6 = ed && ed.cm;
  return { file: f.path, cm6: !!cm6, facade: !!(cm6 && cm6.cm), vim: !!(cm6 && cm6.cm && cm6.cm.state && cm6.cm.state.vim) };
})()`)));

// focus the editor contentDOM and send vim keystrokes
await run(`(() => { const ed = [...app.workspace.getLeavesOfType("markdown")].map(l=>l.view&&l.view.editor).find(e=>e&&e.cm); ed.cm.contentDOM.focus(); ed.cm.contentDOM.dispatchEvent(new MouseEvent("mousedown",{bubbles:true})); return !!ed; })()`);
await new Promise(r=>setTimeout(r,300));

const key = async (k, code, keyCode, text) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  if (text) await send("Input.dispatchKeyEvent", { type: "char", key: k, code: code, text: text, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  await new Promise(r=>setTimeout(r,120));
};

// vim normal-mode motions: h j k l w b 0 $ G gg x dd yy p i a o
for (const [k,c,kc,t] of [["h","KeyH",72],["j","KeyJ",74],["k","KeyK",75],["l","KeyL",76],["w","KeyW",87],["b","KeyB",66],["0","Digit0",48],["$","Digit2",50,true?null:null],["G","KeyG",71],["x","KeyX",88],["dd","KeyD",68],["p","KeyP",80],["i","KeyI",73],["a","KeyA",65],["o","KeyO",79],["Esc","Escape",27]]) {
  if (k === "dd") { await key("d","KeyD",68); await key("d","KeyD",68); continue; }
  await key(k,c,kc);
}
await new Promise(r=>setTimeout(r,800));

console.log("state:", JSON.stringify(await run(`(() => {
  const ed = [...app.workspace.getLeavesOfType("markdown")].map(l=>l.view&&l.view.editor).find(e=>e&&e.cm);
  const cm6 = ed.cm; const f = cm6.cm;
  return { facade: !!f, value: cm6.state.doc.toString().slice(0,120), cursor: f?f.getCursor():null,
    vimMode: f&&f.state.vim?f.state.vim.mode:null, status: f&&f.state.vim?f.state.vim.status:null };
})()`)));
console.log("problems:", JSON.stringify(problems.slice(0,10)), "count", problems.length);
ws.close();
