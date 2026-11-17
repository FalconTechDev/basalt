// CDP probe for the s52 CM5 facade (temporary verification script)
const port = +process.argv[2] || 9420;
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  return r.result.result.value;
};
await send("Runtime.enable", {});
for (let i = 0; i < 60; i++) { if (await run("!!(window.app && app.vault && app.workspace && app.workspace.layoutReady)").catch(() => false)) break; await new Promise(r=>setTimeout(r,500)); }

console.log("adapter:", JSON.stringify(await run(`(() => {
  const A = window.CodeMirrorAdapter;
  if (!A) return null;
  return { isMac: A.isMac, hasPos: !!A.Pos, hasSS: !!A.StringStream, cmds: Object.keys(A.commands||{}),
    nKeys: A.keys ? Object.keys(A.keys).length : -1, hasVim: !!A.Vim, keyName: A.keyName,
    statics: ["on","off","signal","lookupKey","e_stop","isWordChar","findMatchingTag","findEnclosingTag","addClass","rmClass"].map(k=>k+":"+typeof A[k]) };
})()`)));

// open a markdown note and grab its CM6 view through the editor component
console.log("open:", JSON.stringify(await run(`(async () => {
  const f = app.vault.getMarkdownFiles()[0];
  const leaf = app.workspace.getLeaf("tab");
  await leaf.openFile(f);
  await new Promise(r=>setTimeout(r,800));
  const view = leaf.view;
  const ed = view.editor;
  return { file: f.path, hasEditor: !!ed, cm6: !!(ed && ed.cm), facade: !!(ed && ed.cm && ed.cm.cm), type: view.getViewType() };
})()`)));

console.log("facade probe:", JSON.stringify(await run(`(() => {
  const leaf = app.workspace.getLeaf("tab");
  const ed = leaf.view && leaf.view.editor;
  const cm6 = ed && ed.cm;
  if (!cm6) return "no cm6";
  const A = window.CodeMirrorAdapter;
  const facade = cm6.cm || new A(cm6);
  const out = {};
  out.isFacade = facade instanceof A;
  out.value = facade.getValue().slice(0, 60);
  out.lines = facade.lineCount();
  out.cursor = facade.getCursor();
  out.line0 = facade.getLine(0).slice(0, 40);
  out.idx = facade.indexFromPos({line:0,ch:0});
  out.posBack = facade.posFromIndex(out.idx);
  out.sel = facade.listSelections();
  out.mainSel = facade.getMainSelection();
  out.optTab = facade.getOption("tabSize");
  out.optKeyMap = facade.getOption("keyMap");
  out.mode = facade.getMode();
  out.selected = facade.somethingSelected();
  out.input = !!facade.getInputField();
  out.wrapper = !!facade.getWrapperElement();
  out.scroll = facade.getScrollInfo();
  out.clip = facade.clipPos({line:-5,ch:-3});
  out.lastLine = facade.lastLine();
  out.defHeight = facade.defaultTextHeight();
  // event roundtrip
  let got = null; facade.on("probe-x", (a,b)=>{got=[a,b]}); facade.signal("probe-x",1,2); facade.off("probe-x");
  out.signalArgs = got;
  return out;
})()`)));
ws.close();
