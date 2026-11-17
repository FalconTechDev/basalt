// Open Test.base in the test runtime and report what the table view rendered.
//   node tools/s50-base-check.mjs --port 9400
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const port = +opt("--port", 9400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 1;
const pending = new Map();
const problems = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") problems.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") problems.push("console.error: " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400));
};
const send = (method, params) => new Promise((res) => { const i = id++; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text };
  return r.result.result.value;
};
await send("Runtime.enable", {});
for (let i = 0; i < 60; i++) { if (await run("!!(window.app && app.vault && app.workspace && app.workspace.layoutReady)").catch(() => false)) break; await sleep(1000); }
await sleep(1500);

const out = await run(`(async () => {
  const f = app.vault.getAbstractFileByPath("Test.base");
  if (!f) return { error: "Test.base not found" };
  const leaf = app.workspace.getLeaf("tab");
  await leaf.openFile(f);
  await new Promise((r) => setTimeout(r, 4000));
  const v = leaf.view;
  const el = v && v.containerEl;
  const q = (s) => el ? el.querySelectorAll(s).length : -1;
  const texts = [];
  if (el) for (const n of el.querySelectorAll(".bases-table .table-view-row, [class*=row]")) { const t = (n.innerText || "").slice(0, 60); if (t) texts.push(t); if (texts.length >= 8) break; }
  return {
    viewType: v && v.getViewType ? v.getViewType() : null,
    file: v && v.file && v.file.path,
    tableEls: q(".bases-table, .table-view, [class*=table]"),
    rows: q("[class*=row]"),
    cells: q("[class*=cell]"),
    headers: q("[class*=header]"),
    groups: q("[class*=group]"),
    viewName: v && v.viewName,
    sample: texts,
    bodySnippet: el ? (el.innerText || "").slice(0, 300) : null,
  };
})()`);
console.log(JSON.stringify(out, null, 2));
console.log("problems:", JSON.stringify(problems, null, 2));
ws.close();
process.exit(problems.length ? 1 : 0);
