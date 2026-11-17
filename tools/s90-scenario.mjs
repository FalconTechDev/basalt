// s90 scenario: exercise the own markdown-formatting helpers (df/uf/hf/pf) through the
// real toggle commands. Run against a headless test runtime:
//   node tools/test-runtime.ps1 ... -Port 9400 -Vault <vault>   (then)
//   node tools/s90-scenario.mjs --port 9400
const args = process.argv.slice(2);
const port = +(args[args.indexOf("--port") + 1] || 9400);
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page" && t.url.includes("index.html")) || list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1;
const pending = new Map();
const problems = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") problems.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push("console.error: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
};
const send = (method, params) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result.result.value;
};
await send("Runtime.enable", {});
for (let i = 0; i < 120; i++) { if (await run("!!(window.app && app.workspace && app.workspace.layoutReady)").catch(() => false)) break; await new Promise((r) => setTimeout(r, 1000)); }
await new Promise((r) => setTimeout(r, 2000));

const out = await run(`(async () => {
  const app = window.app;
  const content = "# T\\n\\n**bold** and *it* \`code\` tail\\n";
  const old = app.vault.getAbstractFileByPath("Fmt-s90.md");
  if (old) await app.vault.delete(old);
  await app.vault.create("Fmt-s90.md", content);
  await app.workspace.getLeaf().openFile(app.vault.getAbstractFileByPath("Fmt-s90.md"));
  await new Promise(r => setTimeout(r, 800));
  const view = app.workspace.getActiveViewOfType ? null : null;
  const leaf = app.workspace.getMostRecentLeaf();
  const v = leaf.view;
  const cm = v.cm || (v.editor && v.editor.cm) || v.editor;
  if (!cm || !cm.state) return { error: "no cm", keys: Object.keys(v) };
  const doc = () => cm.state.doc.toString();
  const sel = (a, b) => cm.dispatch({ selection: { anchor: a, to: b } });
  const cmd = (id) => app.commands.executeCommandById(id);
  const res = {};
  const idx = (s, sub) => content.indexOf(sub);
  // 1) cursor inside **bold** -> toggle-bold should unwrap
  sel(idx(content, "bold"), idx(content, "bold") + 4);
  await cmd("editor:toggle-bold");
  res.afterUnwrap = doc();
  // 2) select plain "and " -> toggle-bold should wrap
  sel(idx(content, "and"), idx(content, "and") + 3);
  await cmd("editor:toggle-bold");
  res.afterWrap = doc();
  // 3) multi-format state: select inside *it* -> toggle-italics unwraps
  const d2 = doc();
  const i2 = d2.indexOf("it");
  sel(i2, i2 + 2);
  await cmd("editor:toggle-italics");
  res.afterItalic = doc();
  // 4) code span
  const d3 = doc();
  const i3 = d3.indexOf("code");
  sel(i3, i3 + 4);
  await cmd("editor:toggle-code");
  res.afterCode = doc();
  // 5) selection.format state via heading: select whole doc -> detect heading level
  sel(0, doc().length);
  try { await cmd("editor:toggle-highlight"); } catch (e) { res.highlightErr = String(e); }
  res.finalDoc = doc();
  await app.vault.delete(app.vault.getAbstractFileByPath("Fmt-s90.md"));
  return res;
})()`);
console.log(JSON.stringify(out, null, 1));
console.log("problems:", JSON.stringify(problems));
ws.close();
process.exit(0);
