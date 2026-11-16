// Differential check of two stylesheets in the real app.
//
//   powershell -File <main checkout>\tools\test-runtime.ps1 -Worktree <worktree> -Scratch <empty dir> -Port 9651 -Vault <vault>
//   node tools/css-compare.mjs --make-vault DIR                            (a throw-away vault: notes, a canvas, a .py file)
//   node tools/css-compare.mjs --port 9651 --old old.css --new src/app.css [--mobile] [--popout] [--only a,b] [--out DIR]
//
// For every scene the app is reloaded with each stylesheet in turn (the file src/app.css of the worktree is swapped; it is put back
// at the end). The run order is old, old again, new: the second old run measures what differs between two identical runs
// (animation frames, caret, timers), so a difference that old-vs-old also shows is reported as noise and not counted against the
// new sheet. Per scene it compares, for every element (and ::before/::after that have content), the computed value of the layout,
// colour, font, border, spacing, display, position, opacity and transform properties plus the box rectangle, then the custom
// properties found in the sheets on body/html, then a screenshot pixel by pixel. Exit status 1 when a real difference is left.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (args.includes("--make-vault")) {
  const dir = path.resolve(opt("--make-vault"));
  fs.mkdirSync(path.join(dir, "folder"), { recursive: true });
  const w = (f, t) => fs.writeFileSync(path.join(dir, f), t);
  w("Alpha.md", `---\ntitle: Alpha\ntags: [demo, css]\naliases: [A]\n---\n# Alpha note\n\nSome **bold**, *italic*, ~~strike~~, ==highlight== and \`inline code\` with a [[Beta]] link, an [external](https://example.com) link and #tag-one.\n\n> [!note] A callout\n> Body of the callout with a list:\n> - one\n> - two\n\n## Lists and tasks\n\n- [ ] open task\n- [x] done task\n1. first\n2. second\n   - nested\n\n## Table\n\n| Name | Value |\n|------|-------|\n| a | 1 |\n| b | 2 |\n\n## Code\n\n\`\`\`js\nfunction hi(x) { return x * 2; }\n\`\`\`\n\nMath: $E = mc^2$\n\nFootnote[^1].\n\n[^1]: The note.\n\n---\n\n![[Beta]]\n`);
  w("Beta.md", "# Beta\n\nBack to [[Alpha]]. Some text, #tag-two.\n\n- item\n");
  w("script.py", "def main():\n    print('hello')\n\nif __name__ == '__main__':\n    main()\n");
  w("folder/Gamma.md", "# Gamma\n");
  w("Board.canvas", JSON.stringify({
    nodes: [
      { id: "n1", type: "text", text: "# Hello\nText node", x: 0, y: 0, width: 260, height: 140 },
      { id: "n2", type: "file", file: "Alpha.md", x: 340, y: -40, width: 320, height: 240 },
      { id: "n3", type: "text", text: "Colored", x: 0, y: 260, width: 200, height: 80, color: "1" },
      { id: "g1", type: "group", label: "Group", x: -40, y: -60, width: 760, height: 460 },
    ],
    edges: [{ id: "e1", fromNode: "n1", fromSide: "right", toNode: "n2", toSide: "left", label: "link" }, { id: "e2", fromNode: "n1", fromSide: "bottom", toNode: "n3", toSide: "top" }],
  }));
  console.log("vault:", dir);
  process.exit(0);
}

const port = +opt("--port", 9651);
const oldCss = path.resolve(opt("--old", ""));
const newCss = path.resolve(opt("--new", path.join(repo, "src", "app.css")));
const target = path.resolve(opt("--target", path.join(repo, "src", "app.css")));
const outDir = path.resolve(opt("--out", path.join(repo, "tools", "css-compare-out")));
const mobile = args.includes("--mobile");
const only = opt("--only") ? opt("--only").split(",") : null;
if (!fs.existsSync(oldCss) || !fs.existsSync(newCss)) { console.error("need --old and --new stylesheets"); process.exit(2); }
const { PNG } = createRequire(path.join(here, "package.json"))("pngjs");
fs.mkdirSync(outDir, { recursive: true });

// -------------------------------------------------------------------------------------------------------------- CDP
let ws, nextId = 1;
const pending = new Map();
async function connect() {
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page" && t.url.includes("index.html")); } catch { /* not up yet */ }
    if (!page) await sleep(1000);
  }
  if (!page) { console.error("no app page on port", port); process.exit(2); }
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  // the app can exit mid-run; fail pending calls instead of hanging forever
  ws.onclose = () => { for (const res of pending.values()) res({ wsClosed: true }); pending.clear(); };
}
const send = (method, params) => new Promise((res) => { const id = nextId++; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
async function run(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 600));
  return r.result.result.value;
}
async function ready() {
  for (let i = 0; i < 120; i++) { if (await run("!!(window.app && app.workspace && app.workspace.layoutReady && !window.__stale)").catch(() => false)) return; await sleep(500); }
  throw new Error("app did not come up");
}
async function reload() {
  await run("window.__stale = true");
  await send("Page.reload", { ignoreCache: true });
  await sleep(1500);
  await ready();
  await sleep(2500);
}
const viewport = mobile ? { width: 375, height: 812 } : { width: 1280, height: 800 };
const setViewport = () => send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });

// -------------------------------------------------------------------------------------------------------------- in-page helpers
const HELPERS = String.raw`
window.__h = (() => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = () => { const t = document.activeElement || document.body; for (const k of ["keydown", "keyup"]) t.dispatchEvent(new KeyboardEvent(k, { key: "Escape", code: "Escape", keyCode: 27, bubbles: true })); };
  async function reset(theme) {
    esc(); esc(); await wait(150);
    try { app.setting.close(); } catch (e) {}
    document.querySelectorAll(".modal-container, .menu, .tooltip, .suggestion-container, .popover, .notice-container .notice").forEach((n) => n.remove());
    app.workspace.iterateRootLeaves((l) => l.detach());
    for (const t of ["file-explorer", "search", "backlink", "outline", "tag", "bookmarks", "graph", "localgraph"]) app.workspace.detachLeavesOfType(t);
    try { app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse(); } catch (e) {}
    document.body.classList.remove("theme-light", "theme-dark"); document.body.classList.add("theme-" + theme);
    try { app.workspace.trigger("css-change"); } catch (e) {}
    await wait(400);
  }
  async function open(path, state) {
    const f = app.vault.getAbstractFileByPath(path);
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(f, { state: state || {} });
    app.workspace.setActiveLeaf(leaf, { focus: true });
    return leaf;
  }
  async function sidebar(type, side) {
    const split = side === "right" ? app.workspace.rightSplit : app.workspace.leftSplit;
    split.expand();
    const leaf = side === "right" ? app.workspace.getRightLeaf(false) : app.workspace.getLeftLeaf(false);
    await leaf.setViewState({ type, active: true });
    app.workspace.revealLeaf(leaf);
    return leaf;
  }
  return { wait, reset, open, sidebar };
})();`;

const SCENES = [
  { name: "empty-tab", themes: ["dark", "light"], setup: `await __h.reset(T); const l = app.workspace.getLeaf("tab"); await l.setViewState({ type: "empty" });` },
  { name: "note-edit", themes: ["dark", "light"], setup: `await __h.reset(T); const l = await __h.open("Alpha.md", { mode: "source", source: false }); await __h.wait(700); try { l.view.editor.focus(); l.view.editor.setCursor({ line: 8, ch: 3 }); } catch (e) {}` },
  { name: "note-source", themes: ["dark"], setup: `await __h.reset(T); const l = await __h.open("Alpha.md", { mode: "source", source: true }); await __h.wait(700);` },
  { name: "preview", themes: ["dark", "light"], setup: `await __h.reset(T); await __h.open("Alpha.md", { mode: "preview" }); await __h.wait(1200);` },
  { name: "text-file", themes: ["dark"], setup: `await __h.reset(T); await __h.open("script.py"); await __h.wait(1200);` },
  { name: "canvas", themes: ["dark", "light"], setup: `await __h.reset(T); await __h.open("Board.canvas"); await __h.wait(2200);` },
  { name: "graph", themes: ["dark"], setup: `await __h.reset(T); app.commands.executeCommandById("graph:open"); await __h.wait(3000);` },
  { name: "settings", themes: ["dark", "light"], setup: `await __h.reset(T); app.setting.open(); await __h.wait(500); try { app.setting.openTabById("appearance"); } catch (e) {} await __h.wait(600);` },
  { name: "command-palette", themes: ["dark"], setup: `await __h.reset(T); await __h.open("Alpha.md", { mode: "preview" }); app.commands.executeCommandById("command-palette:open"); await __h.wait(700); const i = document.querySelector(".prompt-input"); if (i) { i.value = "open"; i.dispatchEvent(new Event("input", { bubbles: true })); } await __h.wait(500);` },
  { name: "quick-switcher", themes: ["dark"], setup: `await __h.reset(T); app.commands.executeCommandById("switcher:open"); await __h.wait(900);` },
  { name: "file-explorer", themes: ["dark", "light"], setup: `await __h.reset(T); await __h.open("Alpha.md", { mode: "preview" }); await __h.sidebar("file-explorer", "left"); await __h.sidebar("backlink", "right"); await __h.wait(1000);` },
  { name: "modal", themes: ["dark"], setup: `await __h.reset(T); const M = Object.getPrototypeOf(app.setting.constructor); const m = new M(app); m.titleEl.setText("A modal"); const c = m.contentEl; c.createEl("p", { text: "Body text of the modal." }); c.createEl("input", { type: "text", value: "text input" }); const s = c.createEl("select"); s.createEl("option", { text: "One" }); const row = c.createDiv("modal-button-container"); row.createEl("button", { text: "Cancel" }); row.createEl("button", { text: "Confirm", cls: "mod-cta" }); row.createEl("button", { text: "Delete", cls: "mod-warning" }); m.open(); await __h.wait(700);` },
  { name: "context-menu", themes: ["dark"], setup: `await __h.reset(T); await __h.sidebar("file-explorer", "left"); await __h.wait(2000); const t = document.querySelector(".nav-file-title"); const r = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + 8, button: 2 })); await __h.wait(700);` },
  { name: "tab-menu", themes: ["dark"], setup: `await __h.reset(T); await __h.open("Alpha.md", { mode: "preview" }); await __h.open("Beta.md", { mode: "source", source: false }); await __h.wait(600); const t = document.querySelector(".workspace-tab-header.is-active"); const r = t.getBoundingClientRect(); t.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + 8, button: 2 })); await __h.wait(600);` },
  { name: "search-pane", themes: ["dark"], setup: `await __h.reset(T); await __h.open("Alpha.md", { mode: "preview" }); const l = await __h.sidebar("search", "left"); await __h.wait(700); try { l.view.setQuery("note"); } catch (e) {} await __h.wait(1500);` },
];
const MOBILE_ONLY = new Set(["empty-tab", "note-edit", "preview", "canvas", "settings", "command-palette", "file-explorer", "modal", "context-menu"]);

const PROPS = [
  "display", "position", "top", "right", "bottom", "left", "z-index", "float", "visibility", "box-sizing", "overflow-x", "overflow-y",
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "flex-grow", "flex-shrink", "flex-basis", "flex-direction", "flex-wrap", "align-items", "align-self", "justify-content", "gap", "grid-template-columns", "grid-template-rows",
  "color", "background-color", "background-image", "background-size", "background-position-x", "background-position-y", "background-repeat", "box-shadow", "fill", "stroke", "caret-color", "accent-color", "text-decoration-color",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color", "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius",
  "outline-color", "outline-style", "outline-width", "outline-offset",
  "font-family", "font-size", "font-weight", "font-style", "font-variant-numeric", "line-height", "letter-spacing", "text-align", "text-transform", "text-indent", "white-space", "text-overflow", "text-decoration-line", "word-break", "overflow-wrap", "vertical-align", "list-style-type",
  "opacity", "transform", "filter", "backdrop-filter", "mix-blend-mode", "cursor", "pointer-events", "user-select",
];
const MOTION = ["transition-property", "transition-duration", "transition-timing-function", "transition-delay", "animation-name", "animation-duration", "animation-iteration-count", "animation-timing-function"];
const PSEUDO_PROPS = ["display", "position", "content", "color", "background-color", "background-image", "width", "height", "top", "left", "right", "bottom", "margin-left", "margin-right", "border-top-width", "font-size", "opacity", "transform"];

// Returns {els: {path: "v1\u0001v2..."}, vars: {...}}; run with transitions and animations switched off so frames do not matter.
const SNAP = (props, pseudoProps, withRect) => `(() => {
  const props = ${JSON.stringify(props)}, pprops = ${JSON.stringify(pseudoProps)};
  const out = {}, pathOf = new Map();
  const skip = new Set(["SCRIPT", "STYLE", "LINK", "META", "TITLE", "HEAD", "NOSCRIPT"]);
  for (const el of document.querySelectorAll("body, body *")) {
    if (skip.has(el.tagName) || el.id === "__cmp") continue;
    const parent = el.parentElement, pp = parent ? pathOf.get(parent) || "" : "";
    let idx = 1; for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === el.tagName) idx++;
    const cls = (typeof el.className === "string" ? el.className : el.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean).slice(0, 3).join(".");
    const p = pp + ">" + el.tagName.toLowerCase() + (cls ? "." + cls : "") + ":" + idx;
    pathOf.set(el, p);
    const cs = getComputedStyle(el);
    let v = props.map((k) => cs.getPropertyValue(k)).join("\\u0001");
    ${withRect ? `const r = el.getBoundingClientRect(); v += "\\u0001" + [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100).join(",");` : ""}
    out[p] = v;
    for (const pe of ["::before", "::after"]) {
      const ps = getComputedStyle(el, pe), c = ps.getPropertyValue("content");
      if (c && c !== "none" && c !== "normal") out[p + pe] = pprops.map((k) => ps.getPropertyValue(k)).join("\\u0001");
    }
  }
  const names = new Set();
  const scan = (rules) => { for (const r of rules) { if (r.style) for (const n of r.style) if (n.startsWith("--")) names.add(n); if (r.cssRules) scan(r.cssRules); } };
  for (const sh of document.styleSheets) { try { scan(sh.cssRules); } catch (e) {} }
  const vars = {};
  for (const [label, el] of [["html", document.documentElement], ["body", document.body], [".app-container", document.querySelector(".app-container")], [".workspace-leaf", document.querySelector(".workspace-leaf")], [".modal", document.querySelector(".modal")]]) {
    if (!el) continue;
    const cs = getComputedStyle(el);
    for (const n of names) vars[label + " " + n] = cs.getPropertyValue(n).trim();
  }
  return { els: out, vars };
})()`;

async function shot() {
  const r = await send("Page.captureScreenshot", { format: "png" });
  return Buffer.from(r.result.data, "base64");
}
const NO_ANIM = `(() => { let s = document.getElementById("__cmp"); if (!s) { s = document.createElement("style"); s.id = "__cmp"; s.textContent = "*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important;scroll-behavior:auto!important}"; document.head.appendChild(s); } })()`;

async function runScenes(label, scenes) {
  fs.copyFileSync(label.startsWith("new") ? newCss : oldCss, target);
  await reload();
  await setViewport();
  await run(HELPERS);
  const res = {};
  for (const sc of scenes) {
    for (const theme of sc.themes) {
      const key = `${sc.name}/${theme}`;
      console.log(`  ${label}: ${key}`);
      // mobile emulation makes the app quit after ~10 scene setups; reload per scene to isolate state
      if (mobile) { await reload(); await run(HELPERS); }
      try {
        await run(`(async () => { const T = ${JSON.stringify(theme)}; ${sc.setup} })()`);
        await sleep(500);
        const motion = await run(SNAP(MOTION, [], false));
        await run(NO_ANIM);
        await sleep(350);
        const snap = await run(SNAP(PROPS, PSEUDO_PROPS, true));
        const png = await shot();
        res[key] = { motion: motion.els, snap, png };
      } catch (e) { res[key] = { error: String(e.message || e) }; }
    }
  }
  return res;
}

const nv = (s) => (s || "").replace(/\s*,\s*/g, ",").replace(/\s+/g, " ").trim();
function pixelDiff(a, b) {
  const x = PNG.sync.read(a), y = PNG.sync.read(b);
  if (x.width !== y.width || x.height !== y.height) return -1;
  let n = 0;
  for (let i = 0; i < x.data.length; i += 4) if (x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] || x.data[i + 2] !== y.data[i + 2]) n++;
  return n;
}
function diffMaps(a, b, names) {
  // -> {missing, extra, cells:Map(path+"|"+prop -> [va, vb])}
  const cells = new Map();
  let missing = 0, extra = 0; const ml = [], el = [];
  for (const k of Object.keys(a)) {
    if (!(k in b)) { missing++; ml.push(k); continue; }
    if (a[k] === b[k]) continue;
    const x = a[k].split("\u0001"), y = b[k].split("\u0001");
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) cells.set(k + "|" + (names[i] || "rect"), [x[i], y[i]]);
  }
  for (const k of Object.keys(b)) if (!(k in a)) { extra++; el.push(k); }
  return { missing, extra, cells, ml, el };
}

// -------------------------------------------------------------------------------------------------------------- main
await connect();
await send("Page.enable");
const original = fs.readFileSync(target);
const scenes = SCENES.filter((s) => (!only || only.includes(s.name)) && (!mobile || MOBILE_ONLY.has(s.name)));
if (mobile) { await run("app.emulateMobile(true)").catch(() => {}); await sleep(3000); await ready(); }
let A = {}, B = {}, C = {};
try {
  console.log("pass 1/3: old stylesheet"); A = await runScenes("old", scenes);
  console.log("pass 2/3: old stylesheet again (noise floor)"); B = await runScenes("old2", scenes);
  console.log("pass 3/3: new stylesheet"); C = await runScenes("new", scenes);
} catch (e) {
  console.log("compare interrupted:", String(e && e.message || e).slice(0, 300));
} finally {
  try { fs.writeFileSync(target, original); } catch {}
  if (mobile) await run("app.emulateMobile(false)").catch(() => {});
}

let totalReal = 0, totalNoise = 0;
const report = [];
console.log("\nscene                       elems  missing/extra  real-diffs  (elements)  noise  pixels(new)  pixels(noise)  vars");
for (const key of Object.keys(A)) {
  const a = A[key], b = B[key], c = C[key];
  if (!a || !b || !c) { console.log(key.padEnd(27), "MISSING-PASS"); continue; }
  if (a.error || b.error || c.error) { console.log(key.padEnd(27), "ERROR", a.error || b.error || c.error); totalReal++; continue; }
  const names = [...PROPS, "rect"];
  const real = diffMaps(a.snap.els, c.snap.els, names);
  const noise = diffMaps(a.snap.els, b.snap.els, names);
  const motionReal = diffMaps(a.motion, c.motion, MOTION);
  const motionNoise = diffMaps(a.motion, b.motion, MOTION);
  const pseudoCells = new Map();
  let nReal = 0, nNoise = 0;
  const realKeys = [];
  for (const [k, v] of [...real.cells, ...motionReal.cells]) { if (noise.cells.has(k) || motionNoise.cells.has(k)) { nNoise++; continue; } nReal++; realKeys.push([k, v]); }
  // custom properties
  let varDiff = 0; const varList = [];
  for (const k of new Set([...Object.keys(a.snap.vars), ...Object.keys(c.snap.vars)])) if (nv(a.snap.vars[k]) !== nv(c.snap.vars[k]) && nv(a.snap.vars[k]) === nv(b.snap.vars[k])) { varDiff++; varList.push([k, a.snap.vars[k], c.snap.vars[k]]); }
  const px = pixelDiff(a.png, c.png), pxNoise = pixelDiff(a.png, b.png);
  fs.mkdirSync(path.join(outDir, "shots"), { recursive: true });
  const safe = key.replace("/", "-");
  fs.writeFileSync(path.join(outDir, "shots", safe + ".old.png"), a.png);
  fs.writeFileSync(path.join(outDir, "shots", safe + ".new.png"), c.png);
  const elems = Object.keys(a.snap.els).length;
  const badEls = new Set(realKeys.map(([k]) => k.split("|")[0])).size;
  console.log(key.padEnd(27), String(elems).padStart(5), `  ${real.missing}/${real.extra}`.padEnd(14), String(nReal).padStart(10), String(badEls).padStart(10), String(nNoise).padStart(6), String(px).padStart(11), String(pxNoise).padStart(13), String(varDiff).padStart(5));
  totalReal += nReal + real.missing + real.extra + varDiff; totalNoise += nNoise;
  report.push({ scene: key, elems, missing: real.missing, extra: real.extra, realDiffs: nReal, elementsWithDiffs: badEls, noise: nNoise, pixelsNew: px, pixelsNoise: pxNoise, varDiffs: varDiff, samples: realKeys.slice(0, 40), missingSamples: real.ml.slice(0, 6), extraSamples: real.el.slice(0, 6), noiseMissing: noise.missing, noiseExtra: noise.extra, varSamples: varList.slice(0, 10) });
}
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 1));
console.log(`\nreal differences: ${totalReal}, noise (also differs between two identical runs): ${totalNoise}; details in ${path.join(outDir, "report.json")}`);
for (const r of report.filter((r) => r.realDiffs || r.varDiffs)) {
  console.log(`-- ${r.scene}`);
  for (const k of r.missingSamples) console.log("    only-old", k.slice(-140));
  for (const k of r.extraSamples) console.log("    only-new", k.slice(-140));
  for (const [k, [x, y]] of r.samples.slice(0, 12)) console.log("   ", k.slice(-150), "\n       old:", String(x).slice(0, 80), " new:", String(y).slice(0, 80));
  for (const [k, x, y] of r.varSamples.slice(0, 5)) console.log("    var", k, "old:", String(x).slice(0, 60), " new:", String(y).slice(0, 60));
}
process.exit(totalReal ? 1 : 0);


