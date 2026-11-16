// Runtime differential scenario for the settings area: opens the inherited ("stock") settings dialog and walks every
// built-in settings tab, snapshotting what each one draws. Compare two runs with tools/ws-diff.mjs.
//   node tools/settings-scenario.mjs --port 9681 > new.json
const args = process.argv.slice(2);
const port = +(args[args.indexOf("--port") + 1] || 9681);
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
for (let i = 0; i < 120; i++) { if (await run("!!(window.app && app.workspace && app.workspace.layoutReady && app.setting)").catch(() => false)) break; await new Promise((r) => setTimeout(r, 1000)); }
await new Promise((r) => setTimeout(r, 3000));

const steps = [];
const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const op = async (name, code) => {
  try { steps.push({ step: name, result: await run(code) }); } catch (e) { steps.push({ step: name, error: String(e.message).slice(0, 400) }); }
  await settle();
};

// a compact, deterministic fingerprint of a tab's DOM: text plus the multiset of class names per element depth
await run(`window.__snap = (el) => {
  const counts = {};
  const walk = (n, d) => {
    if (d > 14 || !n || n.nodeType !== 1) return;
    const cls = (n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className || "").toString().trim().split(/\\s+/).filter(Boolean).sort().join(".");
    if (cls) { const k = d + ":" + n.tagName.toLowerCase() + "." + cls; counts[k] = (counts[k] || 0) + 1; }
    for (const c of n.children) walk(c, d + 1);
  };
  walk(el, 0);
  const text = (el.innerText || "").replace(/\\s+/g, " ").trim();
  return { text: text.slice(0, 4000), dom: counts, html: el.innerHTML.length };
};`);

await op("open-stock-settings", `(async () => {
  window.__bsStock = true;
  app.setting.open();
  window.__bsStock = false;
  await new Promise((r) => setTimeout(r, 2500));
  const modal = document.querySelector(".modal-container");
  if (!modal) return { error: "no modal" };
  return {
    title: modal.querySelector(".modal-title")?.textContent,
    nav: [...modal.querySelectorAll(".vertical-tab-nav-item")].map((n) => ({ id: n.dataset.settingId, text: n.innerText.replace(/\\s+/g, " ").trim() })),
    groups: [...modal.querySelectorAll(".vertical-tab-header-group-title")].map((g) => g.textContent),
    sections: [...modal.querySelectorAll("[data-section]")].map((s) => s.dataset.section),
    tabIds: (app.setting.settingTabs || []).map((t) => t.id),
    pluginTabIds: (app.setting.pluginTabs || []).map((t) => t.id),
  };
})()`);

// walk every built-in tab
const tabIds = await run(`(app.setting.settingTabs || []).map((t) => t.id)`);
for (const tid of tabIds || []) {
  await op("tab-" + tid, `(async () => {
    const out = { opened: false };
    try {
      app.setting.openTabById(${JSON.stringify(tid)});
      await new Promise((r) => setTimeout(r, 1600));
      const tab = (app.setting.settingTabs || []).find((t) => t.id === ${JSON.stringify(tid)});
      const active = app.setting.activeTab;
      out.opened = !!(tab && tab.containerEl && tab.containerEl.isShown());
      out.active = active && active.id;
      out.snap = tab && tab.containerEl ? window.__snap(tab.containerEl) : null;
      out.navText = tab && tab.navEl ? tab.navEl.innerText.replace(/\\s+/g, " ").trim() : null;
    } catch (e) { out.error = String(e && e.stack || e).slice(0, 400); }
    return out;
  })()`);
}

// a few plugin tabs (core plugins with their own pages: sync, publish, daily notes ...)
const pluginIds = await run(`(app.setting.pluginTabs || []).map((t) => t.id)`);
for (const pid of (pluginIds || []).slice(0, 30)) {
  await op("ptab-" + pid, `(async () => {
    const out = {};
    try {
      app.setting.openTabById(${JSON.stringify(pid)});
      await new Promise((r) => setTimeout(r, 1800));
      const tab = (app.setting.pluginTabs || []).find((t) => t.id === ${JSON.stringify(pid)});
      out.name = tab && tab.name;
      out.snap = tab && tab.containerEl ? window.__snap(tab.containerEl) : null;
    } catch (e) { out.error = String(e && e.stack || e).slice(0, 400); }
    return out;
  })()`);
}

await op("close-settings", `(async () => {
  try { app.setting.close(); await new Promise((r) => setTimeout(r, 600)); return { closed: !document.querySelector(".modal-container.mod-settings") }; }
  catch (e) { return { error: String(e) }; }
})()`);

console.log(JSON.stringify({ steps, problems }, null, 1));
ws.close();
