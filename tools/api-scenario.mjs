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
await op("suggest-modal", `(async () => {
  const out = { log: [] };
  const QS = app.internalPlugins.plugins.switcher.instance.QuickSwitcherModal;
  let SM = QS; while (SM && !Object.prototype.hasOwnProperty.call(SM.prototype, "selectActiveSuggestion")) SM = Object.getPrototypeOf(SM);
  const words = ["alpha", "beta", "gamma", "alphabet", "delta"];
  class S extends SM {
    getSuggestions(q) { return q ? words.filter((w) => w.includes(q)).map((w) => ({ w, group: w[0] })) : words.map((w) => ({ w })); }
    renderSuggestion(v, el) { el.setText(v.w); }
    onChooseSuggestion(v, ev) { out.log.push("chose " + v.w); }
    onSelectedChange() {}
  }
  const m = new S(app);
  m.setPlaceholder("type"); m.setInstructions([{ command: "Enter", purpose: "go" }]);
  m.open();
  await new Promise((r) => setTimeout(r, 1500));
  const rows = () => [...m.resultContainerEl.querySelectorAll(".suggestion-item")].map((x) => x.textContent + (x.classList.contains("is-selected") ? "*" : ""));
  out.start = rows();
  const key = (k, mods) => window.dispatchEvent(new KeyboardEvent("keydown", Object.assign({ key: k, bubbles: true, cancelable: true }, mods || {})));
  key("ArrowDown"); key("ArrowDown"); out.down = rows();
  key("ArrowUp"); key("ArrowUp"); key("ArrowUp"); out.wrap = rows();
  key("End"); out.end = rows(); key("Home"); out.home = rows();
  m.inputEl.value = "al"; m.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 800));
  out.filtered = rows();
  m.inputEl.value = "zzz"; m.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 800));
  out.empty = m.resultContainerEl.textContent;
  m.inputEl.value = "a"; m.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 800));
  out.grouped = m.resultContainerEl.querySelectorAll(".suggestion-group").length;
  m.resultContainerEl.querySelectorAll(".suggestion-item")[1].dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  out.hover = rows();
  key("Enter");
  await new Promise((r) => setTimeout(r, 800));
  out.after = [out.log.join(","), document.body.contains(m.containerEl), m.isOpen];
  out.html = window.__norm(m.modalEl).replace(/opacity: [^;"]*;?/g, "").slice(0, 700);
  out.chain = (() => { let n = 0, c = Object.getPrototypeOf(S); while (c && c !== Function.prototype) { n++; c = Object.getPrototypeOf(c); } return n; })();
  return out;
})()`);
await op("editor-suggest", `(async () => {
  const out = {};
  const leaf = app.workspace.getLeaf("tab");
  await leaf.openFile(app.vault.getAbstractFileByPath("Note.md"));
  await new Promise((r) => setTimeout(r, 2500));
  const ed = leaf.view.editor;
  ed.focus();
  ed.setCursor({ line: ed.lastLine(), ch: ed.getLine(ed.lastLine()).length });
  ed.replaceSelection("\\n[[Oth");
  await new Promise((r) => setTimeout(r, 2500));
  const items = () => [...document.querySelectorAll(".suggestion-container .suggestion-item")].map((x) => x.textContent.replace(/\\s+/g, " ").trim() + (x.classList.contains("is-selected") ? "*" : ""));
  out.res = (app.workspace.editorSuggest.suggests || []).map((s) => { let r; try { r = s.trigger(ed, leaf.view.file, true); } catch (e) { r = "ERR " + e.message; } return [r, s.isOpen]; });
  await new Promise((r) => setTimeout(r, 2000));
  out.shown = items();
  const cur = app.workspace.editorSuggest.suggests.find((s) => s.isOpen);
  if (cur) { out.ctx = cur.context && [cur.context.query, cur.context.start.ch, cur.context.end.ch]; out.sel = cur.suggestions.selectedItem; cur.suggestions.setSelectedItem(0, null); }
  out.container = document.querySelectorAll(".suggestion-container").length;
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 800));
  out.afterEsc = document.querySelectorAll(".suggestion-container").length;
  out.text = ed.getValue().slice(-20);
  leaf.detach();
  return out;
})()`);
await op("commands-hotkeys", `(async () => {
  const out = { log: [] };
  const C = app.commands, H = app.hotkeyManager;
  C.addCommand({ id: "t:plain", name: "plain", hotkeys: [{ modifiers: ["Mod", "Shift"], key: "F9" }], callback: () => out.log.push("plain") });
  C.addCommand({ id: "t:check", name: "check", checkCallback: (checking) => { if (!checking) out.log.push("check"); return true; } });
  C.addCommand({ id: "t:fail", name: "fail", callback: () => { throw new Error("x"); } });
  const key = (k, o) => { const e = new KeyboardEvent("keydown", Object.assign({ key: k, code: k, bubbles: true, cancelable: true }, o)); window.dispatchEvent(e); return e.defaultPrevented; };
  out.f9 = key("F9", { ctrlKey: true, shiftKey: true });
  out.f9plain = key("F9", {});
  H.setHotkeys("t:plain", [{ modifiers: ["Alt"], key: "F8" }]);
  out.moved = [key("F9", { ctrlKey: true, shiftKey: true }), key("F8", { altKey: true })];
  H.removeHotkeys("t:plain");
  out.back = key("F9", { ctrlKey: true, shiftKey: true });
  out.ex = [C.executeCommandById("t:check"), C.executeCommandById("t:fail"), C.executeCommandById("nope")];
  out.list = C.listCommands().map((c) => c.id).filter((i) => i.startsWith("t:"));
  out.print = [H.printHotkeyForCommand("t:plain"), H.printHotkeyForCommand("t:check"), H.printHotkeyForCommand("app:open-settings")];
  out.custom = Object.keys(H.customKeys);
  ["t:plain", "t:check", "t:fail"].forEach((id) => C.removeCommand(id));
  out.log2 = out.log.join(",");
  out.cleaned = [!!C.findCommand("t:plain"), H.getDefaultHotkeys("t:plain")];
  return out;
})()`);
await op("fileview", `(async () => {
  const out = {};
  const v = app.vault, w = app.workspace;
  await v.createFolder("tmp/inner").catch(() => {});
  const f = await v.create("tmp/inner/Temp note.md", "hello");
  const g = await v.create("tmp/Other temp.md", "x");
  const leaf = w.getLeaf("tab");
  await leaf.openFile(f);
  await new Promise((r) => setTimeout(r, 1500));
  const view = leaf.view;
  const snap = () => ({ crumbs: [...view.titleParentEl.querySelectorAll(".view-header-breadcrumb")].map((x) => x.textContent), title: view.titleEl.textContent, type: leaf.view.getViewType(), state: JSON.stringify(view.getState()), tab: leaf.tabHeaderInnerTitleEl.textContent });
  out.opened = snap();
  out.display = view.getDisplayText(); out.accept = view.canAcceptExtension("md");
  await app.fileManager.renameFile(f, "tmp/Moved.md");
  await new Promise((r) => setTimeout(r, 1200));
  out.renamed = snap();
  await leaf.openFile(g); await new Promise((r) => setTimeout(r, 1000));
  out.second = snap();
  const reg = app.viewRegistry;
  out.reg = [reg.getTypeByExtension("md"), reg.getTypeByExtension("png"), reg.getTypeByExtension("pdf"), reg.getTypeByExtension("canvas"), typeof reg.getViewCreatorByType("markdown"), reg.isExtensionRegistered("md"), reg.isExtensionRegistered("zzz")];
  const log = [];
  reg.on("extensions-updated", () => log.push("ext")); reg.on("view-registered", (t) => log.push("reg " + t)); reg.on("view-unregistered", (t) => log.push("unreg " + t));
  reg.registerExtensions(["zzz1", "zzz2"], "markdown"); try { reg.registerExtensions(["zzz3", "md"], "x"); } catch (e) { log.push("threw " + e.message); }
  out.partial = [reg.isExtensionRegistered("zzz3"), reg.isExtensionRegistered("zzz1")];
  reg.unregisterExtensions(["zzz1", "zzz2"]); reg.registerView("probe", () => 1); try { reg.registerView("probe", () => 2); } catch (e) { log.push("threw " + e.message); } reg.unregisterView("probe"); reg.unregisterView("probe");
  out.log = log;
  await v.trash(g, true); await new Promise((r) => setTimeout(r, 1500));
  out.afterDelete = { type: leaf.view.getViewType(), hist: leaf.history.backHistory.length, exists: w.getLeavesOfType("markdown").includes(leaf) };
  const h = await v.create("tmp/Third.md", "z"); await leaf.openFile(h); await new Promise((r) => setTimeout(r, 1000));
  await v.trash(h, true); await new Promise((r) => setTimeout(r, 1500));
  out.afterDelete2 = { type: leaf.view.getViewType(), attached: !!leaf.parent };
  try { await v.trash(v.getAbstractFileByPath("tmp"), true); } catch (e) {}
  leaf.detach();
  return out;
})()`);
await op("textfileview", `(async () => {
  const out = {};
  const v = app.vault, w = app.workspace;
  const f = await v.create("tfv.canvas", '{"nodes":[],"edges":[]}');
  const leaf = w.getLeaf("tab");
  await leaf.openFile(f);
  await new Promise((r) => setTimeout(r, 2000));
  const view = leaf.view;
  out.type = view.getViewType();
  out.proto = ["requestSave", "saveImmediately", "setData", "loadFileInternal", "onModify", "saveTitle", "onTitleChange", "renderBreadcrumbs"].map((n) => typeof view[n]);
  out.initial = [view.data, view.lastSavedData, view.dirty, view.isPlaintext, view.saving];
  await v.modify(f, '{"nodes":[{"id":"a","type":"text","text":"x","x":0,"y":0,"width":100,"height":50}],"edges":[]}');
  await new Promise((r) => setTimeout(r, 2000));
  out.afterExternal = [view.data, view.lastSavedData, typeof view.getViewData === "function" ? String(view.getViewData()).slice(0, 20) : null];
  view.requestSave(); out.dirty = view.dirty;
  out.immediate = typeof view.saveImmediately();
  // rename through the title field
  const title = view.titleEl;
  title.focus(); title.dispatchEvent(new Event("focus"));
  title.setText("renamed"); title.dispatchEvent(new Event("input", { bubbles: true }));
  out.renaming = view.fileBeingRenamed === f;
  title.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await new Promise((r) => setTimeout(r, 2000));
  out.renamed = [f.path, view.getDisplayText()];
  title.setText("bad/name"); title.dispatchEvent(new Event("focus")); title.dispatchEvent(new Event("input", { bubbles: true }));
  out.badTip = document.querySelectorAll(".tooltip").length;
  title.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  out.afterEsc = title.textContent;
  await v.trash(f, true);
  await new Promise((r) => setTimeout(r, 1500));
  leaf.detach();
  return out;
})()`);

await op("hover-popover", `(async () => {
  const out = {};
  const w = app.workspace;
  const leaf = w.getLeaf("tab");
  await leaf.openFile(app.vault.getAbstractFileByPath("Note.md"));
  await new Promise((r) => setTimeout(r, 2000));
  const target = createDiv({ text: "target" }); target.style.cssText = "position:fixed;left:200px;top:200px;width:80px;height:20px"; document.body.appendChild(target);
  const ev = new MouseEvent("mouseover", { bubbles: true, ctrlKey: true, clientX: 210, clientY: 210 });
  w.trigger("hover-link", { event: ev, source: "preview", hoverParent: leaf.view, targetEl: target, linktext: "Other note", sourcePath: "Note.md" });
  await new Promise((r) => setTimeout(r, 2500));
  out.shown = document.querySelectorAll(".hover-popover").length;
  out.parent = !!leaf.view.hoverPopover; out.state = leaf.view.hoverPopover && leaf.view.hoverPopover.state;
  if (leaf.view.hoverPopover) {
    const p = leaf.view.hoverPopover;
    out.api = ["onTarget", "onHover", "isFocused", "waitTime"].map((k) => p[k]);
    p.setIsFocused(true); out.should = p.shouldShow();
    p.setIsFocused(false); p.onTarget = false; p.transition(); out.afterTransition = p.state;
    await new Promise((r) => setTimeout(r, 1500));
    out.afterWait = [p.state, document.querySelectorAll(".hover-popover").length];
    p.hide();
  }
  out.hidden = [document.querySelectorAll(".hover-popover").length, leaf.view.hoverPopover];
  target.remove(); leaf.detach();
  return out;
})()`);
await op("tooltip", `(async () => {
  const A = window.__bsApi, out = {};
  const host = createDiv(); host.style.cssText = "position:fixed;left:100px;top:100px;width:400px"; document.body.appendChild(host);
  const place = (el, css) => { el.style.cssText += css; };
  const mkSetting = (name, opts, css) => { const s = new A.Setting(host).setName(name).setTooltip("tip " + name, opts); place(s.nameEl, css || ""); return s.nameEl; };
  const bottom = mkSetting("bottom", { delay: 0 });
  const right = mkSetting("right", { placement: "right", delay: 0 });
  const left = mkSetting("left", { placement: "left", delay: 0, classes: ["mod-wide"] });
  const top = mkSetting("top", { placement: "top", delay: 0 });
  const edge = mkSetting("edge", { delay: 0 }, "position:fixed;left:0px;top:0px");
  const info = () => { const t = document.querySelector(".tooltip"); return t ? { text: t.textContent, cls: t.className, top: Math.round(parseFloat(t.style.top)), left: Math.round(parseFloat(t.style.left)), arrow: t.querySelector(".tooltip-arrow") ? [t.querySelector(".tooltip-arrow").style.left, t.querySelector(".tooltip-arrow").style.right] : null } : null; };
  const over = (el, related) => el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", relatedTarget: related || null }));
  const outOf = (el, related) => el.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: related || null }));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  out.attrs = [bottom, right, left, top].map((e) => [e.getAttribute("aria-label"), e.getAttribute("data-tooltip-position"), e.getAttribute("data-tooltip-classes"), e.getAttribute("data-tooltip-delay")]);
  out.shown = [];
  for (const el of [bottom, right, left, top, edge]) { over(el); await wait(1400); out.shown.push(info()); outOf(el); out.shown.push(!!document.querySelector(".tooltip")); }
  // moving between two labelled elements: the second tooltip shows at once
  over(bottom); await wait(1400); outOf(bottom, right); over(right); await wait(400); out.chain = info();
  outOf(right); 
  // update text while showing, dynamic text, opt-out
  over(bottom); await wait(1400);
  new A.Setting(host); // no-op
  const s = new A.Setting(host).setName("dyn"); s.setTooltip("first", { delay: 0 });
  out.updated = info();
  const dyn = s.nameEl; let n = 0; place(dyn, ""); 
  out.manual = (() => { const el = createDiv({ text: "m" }); el.style.cssText = "position:fixed;left:300px;top:300px;width:30px;height:20px"; document.body.appendChild(el); window.__bsApi.setIcon(el, "star"); return typeof el.getAttribute("aria-label"); })();
  outOf(bottom); await wait(200);
  const none = mkSetting("none", { delay: 0 }); none.style.setProperty("--no-tooltip", "true"); over(none); await wait(500); out.optOut = !!document.querySelector(".tooltip");
  outOf(none);
  const hold = mkSetting("hold", { delay: 400 }); over(hold); await wait(150); out.early = !!document.querySelector(".tooltip"); await wait(900); out.late = !!document.querySelector(".tooltip"); 
  hold.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); out.afterUp = !!document.querySelector(".tooltip");
  host.remove(); document.querySelectorAll(".tooltip").forEach((x) => x.remove());
  return out;
})()`);

console.log(JSON.stringify({ steps, problems }, null, 1));
process.exit(0);
