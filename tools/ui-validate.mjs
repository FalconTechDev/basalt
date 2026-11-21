// UI function validator: runs every command, ribbon button, view-header button and every item of the file / folder context menus
// of a running TEST runtime (tools/test-runtime.ps1) and lists each console error / uncaught exception it caused.
//   node tools/ui-validate.mjs --port 9991 [--only commands|ribbon|menus|views] [--verbose]
// Dangerous commands (delete, trash, quit, reload, vault switching ...) are skipped; use a throw-away vault.
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf("--" + n); return i < 0 ? d : args[i + 1]; };
const port = +arg("port", 9991), only = arg("only", ""), verbose = args.includes("--verbose");
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = list.find((x) => x.type === "page" && !x.url.startsWith("devtools"));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = {};
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (pend[d.id]) pend[d.id](d); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "eval failed"); return r.result.result.value; };

const prelude = `
(() => {
  if (window.__val) return;
  const V = window.__val = { errors: [], mark: () => V.errors.length };
  const push = (kind, msg) => V.errors.push({ kind, msg: String(msg).slice(0, 400), at: V.current || "" });
  window.addEventListener("error", (e) => push("error", (e.error && e.error.stack) || e.message));
  window.addEventListener("unhandledrejection", (e) => push("rejection", (e.reason && e.reason.stack) || e.reason));
  const ce = console.error; console.error = function (...a) { push("console.error", a.map((x) => (x && x.stack) || x).join(" ")); return ce.apply(this, a); };
  V.settle = async (ms = 120) => { await new Promise((r) => setTimeout(r, ms)); };
  V.cleanup = async () => {
    for (let i = 0; i < 2; i++) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      document.querySelectorAll(".modal-container .modal-close-button, .modal-close-button").forEach((b) => { try { b.click(); } catch (e) {} });
      document.querySelectorAll(".menu").forEach((m) => m.remove());
      await V.settle(30);
    }
    document.querySelectorAll(".modal-container, .suggestion-container, .notice, .tooltip").forEach((m) => { try { m.remove(); } catch (e) {} });
  };
  V.run = async (label, fn) => { V.current = label; try { await Promise.race([Promise.resolve(fn()), new Promise((r) => setTimeout(r, 1200))]); } catch (e) { push("threw", (e && e.stack) || e); } await V.settle(); await V.cleanup(); };
})();`;
await evaluate(prelude);
const DANGER = /export|print|pdf|show-in|reveal-in|default-app|open-with|delete|trash|remove|quit|exit|reload|restart|relaunch|close-window|close-all|vault|sync|update|uninstall|reset|clear|unlink|publish|import|open-folder|pick|logout|log-out|sign|account|move-file|rename|empty|shutdown|window:|popout|fullscreen|devtools|developer|toggle-zoom|zoom/i;

const report = { ran: 0, skipped: 0, problems: [] };
async function section(name, code) {
  if (only && only !== name) return;
  const r = await evaluate(code);
  report.ran += r.ran; report.skipped += r.skipped || 0; report.problems.push(...r.problems.map((p) => ({ section: name, ...p })));
  console.log(`${name}: ran ${r.ran}${r.skipped ? ", skipped " + r.skipped : ""}, problems ${r.problems.length}`);
}

// a note, a canvas and a text file to work on
await evaluate(`(async () => { const a = app; let f = a.vault.getFiles().find((x) => x.extension === "md"); if (!f) f = await a.vault.create("validate.md", "# t\\n[[x]] #tag"); const l = a.workspace.getLeaf("tab"); await l.openFile(f); await window.__val.settle(800); })()`);

if (!only || only === "commands") {
  const ids = await evaluate(`Object.keys(app.commands.commands)`);
  let ran = 0, skipped = 0;
  const skipList = (arg("skip", "") || "").split(",").filter(Boolean);
  for (const cid of ids) {
    if (DANGER.test(cid) || skipList.includes(cid)) { skipped++; continue; }
    const before = await evaluate(`window.__val.mark()`);
    const call = evaluate(`(async () => { await window.__val.run(${JSON.stringify("command " + cid)}, () => app.commands.executeCommandById(${JSON.stringify(cid)})); return window.__val.errors.slice(${before}); })()`);
    const res = await Promise.race([call, new Promise((r) => setTimeout(() => r("HANG"), 12000))]);
    ran++;
    if (verbose) console.log("  " + cid);
    if (res === "HANG") { console.log(`HANG on command ${cid} (the renderer stopped answering)`); report.problems.push({ section: "commands", what: "command " + cid, kind: "hang", msg: "renderer stopped answering" }); break; }
    for (const e of res) report.problems.push({ section: "commands", what: "command " + cid, kind: e.kind, msg: e.msg });
  }
  report.ran += ran; report.skipped += skipped;
  console.log(`commands: ran ${ran}, skipped ${skipped}`);
}

await section("ribbon", `(async () => {
  const V = window.__val, out = { ran: 0, problems: [] };
  for (const b of Array.from(document.querySelectorAll(".side-dock-ribbon-action"))) {
    const before = V.mark(), label = b.getAttribute("aria-label") || "ribbon";
    await V.run("ribbon " + label, () => b.click()); out.ran++;
    for (const e of V.errors.slice(before)) out.problems.push({ what: "ribbon " + label, kind: e.kind, msg: e.msg });
  }
  return out;
})()`);

await section("views", `(async () => {
  const V = window.__val, out = { ran: 0, problems: [] };
  for (const leaf of app.workspace.getLeavesOfType("markdown").concat(app.workspace.getLeavesOfType("canvas"), app.workspace.getLeavesOfType("basalt-textfile"))) {
    app.workspace.setActiveLeaf(leaf, { focus: true }); await V.settle(300);
    for (const a of Array.from(leaf.view.containerEl.querySelectorAll(".view-actions .clickable-icon, .view-header-nav-buttons .clickable-icon"))) {
      const before = V.mark(), label = leaf.view.getViewType() + ":" + (a.getAttribute("aria-label") || a.className);
      if (/delete|close/i.test(label)) continue;
      await V.run("view button " + label, () => a.click()); out.ran++;
      for (const e of V.errors.slice(before)) out.problems.push({ what: "view button " + label, kind: e.kind, msg: e.msg });
    }
  }
  return out;
})()`);

await section("menus", `(async () => {
  const V = window.__val, out = { ran: 0, skipped: 0, problems: [] };
  const files = app.vault.getFiles().slice(0, 4);
  const targets = files.concat([app.vault.getRoot()]);
  for (const t of targets) {
    const build = () => { const m = new window.__bsApi.Menu(); app.workspace.trigger("file-menu", m, t, "file-explorer"); return m; };
    const n = build().items.filter((i) => i.titleEl || i.dom).length;
    for (let k = 0; k < n; k++) {
      const m = build(), item = m.items.filter((i) => i.titleEl || i.dom)[k];
      const title = item && item.titleEl ? item.titleEl.textContent : "item " + k;
      if (/удал|delete|trash|remove|корзин|переимен|rename|new window|нов(ое|ом) окн|pop|файлов(ом|ый) менеджер|file manager|проводник|explorer|finder|default app|приложени(е|и) по умолчанию|открыть во внешн|launch via|external/i.test(title)) { out.skipped++; continue; }
      const before = V.mark();
      await V.run("menu " + t.path + " > " + title, () => item.handleEvent ? item.handleEvent(new MouseEvent("click")) : item.callback && item.callback());
      out.ran++;
      for (const e of V.errors.slice(before)) out.problems.push({ what: "menu " + t.path + " > " + title, kind: e.kind, msg: e.msg });
    }
  }
  return out;
})()`);

ws.close();
const seen = new Map();
for (const p of report.problems) { const key = p.msg.split("\n").slice(0, 3).join(" | "); if (!seen.has(key)) seen.set(key, { ...p, count: 0, whats: [] }); const s = seen.get(key); s.count++; if (s.whats.length < 4) s.whats.push(p.what); }
console.log(`\nran ${report.ran}, skipped ${report.skipped}, distinct problems ${seen.size}`);
for (const s of seen.values()) console.log(`\n[${s.section}] x${s.count} ${s.kind}\n  ${s.msg.slice(0, 300)}\n  from: ${s.whats.join("; ")}`);
process.exit(seen.size ? 1 : 0);
