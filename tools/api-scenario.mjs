// Runtime differential scenario for the plugin-facing UI classes (Setting and its components, Notice, Modal, Menu, suggest modals ...).
// Drives a running test runtime through fixed operations on window.__bsApi (the exported API module) and prints a snapshot per step
// ({ steps, problems } like tools/ws-scenario.mjs; compare two runs with tools/ws-diff.mjs).
//   node tools/api-scenario.mjs --port 9655 > new.json
const args = process.argv.slice(2);
const port = +(args[args.indexOf("--port") + 1] || 9655);
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
for (let i = 0; i < 120; i++) { if (await run("!!(window.app && app.workspace && app.workspace.layoutReady && window.__bsApi)").catch(() => false)) break; await new Promise((r) => setTimeout(r, 1000)); }
await new Promise((r) => setTimeout(r, 3000));

const steps = [];
const settle = (ms = 800) => new Promise((r) => setTimeout(r, ms));
const op = async (name, code) => {
  try { steps.push({ step: name, result: await run(code) }); } catch (e) { steps.push({ step: name, error: String(e.message).slice(0, 300) }); }
  await settle();
};
// the DOM of a created element, with volatile bits (ids, positions, inline transforms, random ids) removed
await run(`window.__norm = (el) => el.outerHTML.replace(/ (id|for|aria-describedby|style)="[^"]*"/g, "").replace(/\\s+/g, " ");`);

await op("setting-rows", `(() => {
  const A = window.__bsApi, log = [], host = createDiv(); document.body.appendChild(host);
  const s1 = new A.Setting(host).setName("Name one").setDesc("Description").setClass("my-class").setTooltip("tip");
  s1.addButton((b) => b.setButtonText("Go").setCta().setTooltip("t").onClick(() => log.push("click")));
  s1.addToggle((t) => t.setValue(true).setTooltip("tg").onChange((v) => log.push("toggle " + v)));
  s1.addText((t) => t.setPlaceholder("ph").setValue("abc").onChange((v) => log.push("text " + v)));
  s1.addTextArea((t) => t.setValue("long").onChange((v) => log.push("area " + v)));
  s1.addDropdown((d) => d.addOption("a", "A").addOptions({ b: "B", c: "C" }).setValue("b").onChange((v) => log.push("dd " + v)));
  s1.addSlider((s) => s.setLimits(0, 10, 1).setValue(4).setInstant(true).onChange((v) => log.push("slider " + v)));
  s1.addColorPicker((c) => c.setValue("#336699").onChange((v) => log.push("color " + v)));
  s1.addProgressBar((p) => p.setValue(250));
  s1.addExtraButton((x) => x.setIcon("star").setTooltip("x").onClick(() => log.push("extra")));
  s1.addSearch((x) => x.setPlaceholder("find").setValue("q").onChange((v) => log.push("search " + v)));
  s1.addMomentFormat((m) => m.setDefaultFormat("YYYY").setValue("").onChange((v) => log.push("mf " + v)));
  s1.addComponent((el) => new (s1.components.find((c) => c.inputEl && c.inputEl.type === "text").constructor)(el).setValue("custom"));
  const TextC = s1.components.find((c) => c.inputEl && c.inputEl.type === "text").constructor; const s2 = new A.Setting(host).setName("Heading").setHeading().setNoInfo();
  const r = (sel) => host.querySelector(sel);
  r(".setting-item-control button").click();
  const tg = r(".checkbox-container"); tg.querySelector("input").dispatchEvent(new Event("change", { bubbles: true }));
  const txt = r("input[type=text]"); txt.value = "typed"; txt.dispatchEvent(new Event("input", { bubbles: true }));
  const sel = r("select.dropdown"); sel.value = "c"; sel.dispatchEvent(new Event("change", { bubbles: true }));
  const sl = r("input[type=range]"); sl.value = "7"; sl.dispatchEvent(new Event("input", { bubbles: true }));
  r(".extra-setting-button").click();
  const se = r("input[type=search]"); se.value = "zzz"; se.dispatchEvent(new Event("input", { bubbles: true }));
  r(".search-input-clear-button").click();
  s1.setDisabled(true);
  r(".setting-item-control button").click();
  const html1 = window.__norm(host);
  s1.setDisabled(false).setVisibility(false);
  const col = s1.components.find((c) => c.colorPickerEl);
  col.setValueRgb({ r: 1, g: 2, b: 3 }); col.setValueHsl({ h: 200, s: 50, l: 40 }); col.setValueInt(0xabcdef);
  const out = { log, html1, rgb: col.getValueRgb(), hsl: col.getValueHsl(), int: col.getValueInt(), val: col.getValue(), slider: s1.components.find((c) => c.sliderEl).getValuePretty(), n: s1.components.length, visible: s1.settingEl.style.display };
  s1.clear(); out.cleared = s1.components.length + ":" + s1.controlEl.children.length;
  const opts = {}; const tc = new (Object.getPrototypeOf(TextC))(createEl("input")); tc.registerOptionListener(opts, "k"); opts.k("set"); out.opt = opts.k();
  host.remove(); return out;
})()`);

await op("notice", `(async () => {
  const A = window.__bsApi, out = {};
  const n = new A.Notice("first", 0);
  const c = n.containerEl;
  out.cls = [c.className, n.noticeEl.className, c.parentElement.className];
  n.setMessage("second").addButton("OK", () => { out.clicked = true; });
  out.html = window.__norm(c);
  c.querySelector(".notice-cta").click();
  await new Promise((r) => setTimeout(r, 600));
  out.after = document.querySelectorAll(".notice").length;
  const n2 = new A.Notice("auto", 300);
  await new Promise((r) => setTimeout(r, 1200));
  out.auto = document.querySelectorAll(".notice").length;
  const n3 = new A.Notice(createFragment((f) => f.createEl("b", { text: "bold" })), 0);
  out.frag = n3.messageEl.innerHTML; n3.hide(); await new Promise((r) => setTimeout(r, 600));
  out.end = document.querySelectorAll(".notice").length + ":" + document.querySelectorAll(".notice-container").length;
  return out;
})()`);

await op("modal", `(async () => {
  const A = window.__bsApi, out = { log: [] };
  const m = new A.Modal(app);
  m.onOpen = function () { out.log.push("open"); };
  m.onClose = function () { out.log.push("close"); };
  m.setTitle("Title").setContent("Body text").setCloseCallback(() => out.log.push("cb")).setDimBackground(false);
  const before = app.keymap.scope;
  m.open();
  await new Promise((r) => setTimeout(r, 400));
  out.same = app.keymap.scope === m.scope;
  out.html = window.__norm(m.containerEl).replace(/opacity: [^;"]*;?/g, "");
  out.cls = m.containerEl.className;
  m.open();
  out.parent = m.containerEl.parentNode === document.body;
  // Escape closes
  const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  window.dispatchEvent(ev);
  await new Promise((r) => setTimeout(r, 400));
  out.afterEsc = [document.body.contains(m.containerEl), app.keymap.scope === before, out.log.join(",")];
  const m2 = new A.Modal(app); m2.setContent(createDiv({ text: "node" })); m2.open();
  m2.bgEl.click(); await new Promise((r) => setTimeout(r, 300));
  out.bgClick = document.body.contains(m2.containerEl);
  const m3 = new A.Modal(app); m3.open(); m3.modalEl.querySelector(".modal-close-button").click();
  out.xClick = document.body.contains(m3.containerEl);
  return out;
})()`);

await op("menu", `(async () => {
  const A = window.__bsApi, out = { log: [] };
  const menu = new A.Menu();
  menu.addSections(["one", "two", "", "three"]).setSectionSubmenu("two", { title: "Sub", icon: "star" });
  menu.addItem((i) => i.setTitle("A").setIcon("star").setSection("one").onClick(() => out.log.push("A")));
  menu.addItem((i) => i.setTitle("B").setChecked(true).setSection("one").setWarning(true));
  menu.addSeparator();
  menu.addItem((i) => i.setTitle("C").setSection("two").onClick(() => out.log.push("C")));
  menu.addItem((i) => i.setTitle("D").setSection("two.more").setDisabled(true));
  menu.addItem((i) => i.setTitle("E").setSection("three").setIsLabel(true));
  menu.addItem((i) => i.setTitle("F"));
  const sub = (() => { let s; menu.addItem((i) => { i.setTitle("G").setSection("three"); s = i.setSubmenu(); s.addItem((j) => j.setTitle("G1").onClick(() => out.log.push("G1"))); }); return s; })();
  menu.onHide(() => out.log.push("hidden"));
  menu.setParentElement(null);
  menu.setUseNativeMenu(false).showAtPosition({ x: 120, y: 90 });
  await new Promise((r) => setTimeout(r, 1500));
  out.html = window.__norm(menu.dom).replace(/opacity: [^;"]*;?/g, "");
  out.scopeOk = app.keymap.scope === menu.scope;
  const key = (k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  key("ArrowDown"); key("ArrowDown"); out.sel1 = menu.selected;
  key("ArrowUp"); out.sel2 = menu.selected;
  for (let i = 0; i < 12; i++) key("ArrowDown");
  out.sel3 = menu.selected;
  key("ArrowRight"); await new Promise((r) => setTimeout(r, 1500));
  out.sub = [!!menu.currentSubmenu, menu.currentSubmenu && menu.currentSubmenu.selected, document.querySelectorAll(".menu").length];
  key("ArrowLeft"); await new Promise((r) => setTimeout(r, 1500));
  out.sub2 = [!!menu.currentSubmenu, document.querySelectorAll(".menu").length];
  key("ArrowUp"); key("ArrowUp"); key("Enter");
  await new Promise((r) => setTimeout(r, 1500));
  out.after = [document.querySelectorAll(".menu").length, app.keymap.scope !== menu.scope, out.log.join(",")];
  // forEvent shares one menu per event, a click outside closes
  const ev = new MouseEvent("contextmenu", { clientX: 50, clientY: 60, bubbles: true, cancelable: true });
  const a = A.Menu.forEvent(ev), b = A.Menu.forEvent(ev);
  a.addItem((i) => i.setTitle("X").onClick(() => out.log.push("X")));
  out.shared = a === b; out.prevented = ev.defaultPrevented;
  await new Promise((r) => setTimeout(r, 1500));
  out.shown = document.querySelectorAll(".menu").length;
  document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 1500));
  out.closed = document.querySelectorAll(".menu").length;
  return out;
})()`);

console.log(JSON.stringify({ steps, problems }, null, 1));
process.exit(0);
