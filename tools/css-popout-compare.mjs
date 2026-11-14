// Differential check of two stylesheets inside a POPOUT window.
// The pop-out leaf lives in its own BrowserWindow/page target, so this tool
// snapshots that target's DOM + screenshot per stylesheet, old/old/new.
//   node tools/css-popout-compare.mjs --port 9715 --old old.css --new new.css [--out DIR]
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { PNG } = createRequire(path.join(here, "package.json"))("pngjs");

const port = +opt("--port", 9651);
const oldCss = path.resolve(opt("--old", ""));
const newCss = path.resolve(opt("--new", path.join(repo, "src", "app.css")));
const target = path.resolve(opt("--target", path.join(repo, "src", "app.css")));
const outDir = path.resolve(opt("--out", path.join(repo, "tools", "css-compare-out", "popout")));
const themes = (opt("--themes", "dark,light")).split(",");
if (!fs.existsSync(oldCss) || !fs.existsSync(newCss)) { console.error("need --old and --new"); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });

// ---- CDD plumbing (same shape as css-compare.mjs) ----
async function pageTargets() {
  return (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === "page");
}
class Conn {
  constructor() { this.id = 0; this.pending = new Map(); }
  async open(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { this.ws.onopen = r; this.ws.onerror = j; });
    this.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); } };
    this.ws.onclose = () => { for (const res of this.pending.values()) res({ wsClosed: true }); this.pending.clear(); };
  }
  send(method, params) { return new Promise((res) => { const id = ++this.id; this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async run(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.wsClosed) throw new Error("websocket closed");
    if (r.result?.exceptionDetails) throw new Error(String(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 400));
    return r.result.result.value;
  }
  async shot() { const r = await this.send("Page.captureScreenshot", { format: "png" }); return Buffer.from(r.result.data, "base64"); }
  close() { try { this.ws.close(); } catch {} }
}

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
const PSEUDO_PROPS = ["display", "position", "content", "color", "background-color", "background-image", "width", "height", "top", "left", "right", "bottom", "margin-left", "margin-right", "border-top-width", "font-size", "opacity", "transform"];
const SNAP = `(() => {
  const props = ${JSON.stringify(PROPS)}, pprops = ${JSON.stringify(PSEUDO_PROPS)};
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
    const r = el.getBoundingClientRect(); v += "\\u0001" + [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100).join(",");
    out[p] = v;
    for (const pe of ["::before", "::after"]) {
      const ps = getComputedStyle(el, pe), c = ps.getPropertyValue("content");
      if (c && c !== "none" && c !== "normal") out[p + pe] = pprops.map((k) => ps.getPropertyValue(k)).join("\\u0001");
    }
  }
  return { els: out, vars: {} };
})()`;
const NO_ANIM = `(() => { let s = document.getElementById("__cmp"); if (!s) { s = document.createElement("style"); s.id = "__cmp"; s.textContent = "*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important;scroll-behavior:auto!important}"; document.head.appendChild(s); } })()`;

const nv = (s) => (s || "").replace(/\s*,\s*/g, ",").replace(/\s+/g, " ").trim();
function pixelDiff(a, b) {
  const x = PNG.sync.read(a), y = PNG.sync.read(b);
  if (x.width !== y.width || x.height !== y.height) return -1;
  let n = 0;
  for (let i = 0; i < x.data.length; i += 4) if (x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] || x.data[i + 2] !== y.data[i + 2]) n++;
  return n;
}
function diffMaps(a, b, names) {
  const cells = new Map(); let missing = 0, extra = 0; const ml = [], el = [];
  for (const k of Object.keys(a)) {
    if (!(k in b)) { missing++; ml.push(k); continue; }
    if (a[k] === b[k]) continue;
    const x = a[k].split(""), y = b[k].split("");
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) cells.set(k + "|" + (names[i] || "rect"), [x[i], y[i]]);
  }
  for (const k of Object.keys(b)) if (!(k in a)) { extra++; el.push(k); }
  return { missing, extra, cells, ml, el };
}

// ---- main ----
let mainPage;
for (let i = 0; i < 60 && !mainPage; i++) {
  try { mainPage = (await pageTargets()).find((t) => t.url.includes("index.html")); } catch {}
  if (!mainPage) await sleep(1000);
}
if (!mainPage) { console.error("no app page on port", port); process.exit(2); }
const main = new Conn(); await main.open(mainPage.webSocketDebuggerUrl);
await main.send("Page.enable");
const ready = async () => { for (let i = 0; i < 120; i++) { if (await main.run("!!(window.app && app.workspace && app.workspace.layoutReady && !window.__stale)").catch(() => false)) return; await sleep(500); } throw new Error("app did not come up"); };
const reload = async () => { await main.run("window.__stale = true").catch(() => {}); await main.send("Page.reload", { ignoreCache: true }); await sleep(1500); await ready(); await sleep(2000); };

const original = fs.readFileSync(target);
const results = {};
async function popoutShot(theme) {
  const before = new Set((await pageTargets()).map((t) => t.id));
  // run on the MAIN window: reset theme, open popout leaf with preview
  await main.run(`(async () => {
    document.body.classList.remove("theme-light","theme-dark"); document.body.classList.add("theme-${theme}");
    try { app.workspace.iterateAllLeaves((l) => { const c = l.getContainer(); if (c && c.type === "window") c.close(); }); } catch (e) {}
    await new Promise((r) => setTimeout(r, 400));
    const leaf = app.workspace.openPopoutLeaf();
    const f = app.vault.getAbstractFileByPath("Alpha.md");
    await leaf.openFile(f, { state: { mode: "preview" } });
    await new Promise((r) => setTimeout(r, 2500));
    return leaf.getContainer().type;
  })()`);
  // find the popout page target (the one that is not the main page)
  let po;
  for (let i = 0; i < 40 && !po; i++) {
    const ts = await pageTargets();
    po = ts.find((t) => !before.has(t.id));
    if (!po) await sleep(500);
  }
  if (!po) throw new Error("popout page target not found");
  const c = new Conn(); await c.open(po.webSocketDebuggerUrl);
  try {
    await c.send("Page.enable");
    // wait until the popout document actually has the app UI
    for (let i = 0; i < 60; i++) {
      const ok = await c.run("!!document.querySelector('.workspace-leaf, .app-container, .view-content')").catch(() => false);
      if (ok) break;
      await sleep(500);
    }
    // theme class lives on each window's own body; set it directly so app
    // theme-propagation timing cannot skew the comparison
    await c.run(`document.body.classList.remove("theme-light","theme-dark"); document.body.classList.add("theme-${theme}")`);
    // wait for the markdown preview to finish rendering
    for (let i = 0; i < 60; i++) {
      const ok = await c.run("!!document.querySelector('.markdown-preview-pusher, .markdown-preview-section .el-p, .markdown-rendered')").catch(() => false);
      if (ok) break;
      await sleep(500);
    }
    await sleep(1500);
    await c.run(NO_ANIM);
    await sleep(300);
    const snap = await c.run(SNAP);
    const png = await c.shot();
    return { snap, png };
  } finally {
    c.close();
    // close the popout from the main window side
    await main.run(`(() => { try { app.workspace.iterateAllLeaves((l) => { const c = l.getContainer(); if (c && c.type === "window") c.close(); }); } catch (e) {} })()`).catch(() => {});
    await sleep(600);
  }
}

for (const [label, css] of [["old", oldCss], ["old2", oldCss], ["new", newCss]]) {
  fs.copyFileSync(css, target);
  await reload();
  results[label] = {};
  for (const theme of themes) {
    const key = `popout-preview/${theme}`;
    try { results[label][key] = await popoutShot(theme); }
    catch (e) { results[label][key] = { error: String(e.message || e).slice(0, 300) }; }
  }
}
try { fs.writeFileSync(target, original); } catch {}
main.close();

const names = [...PROPS, "rect"];
console.log("\nscene                    elems  missing/extra  real-diffs  noise  pixels(new)  pixels(noise)");
let totalReal = 0;
const report = [];
for (const key of Object.keys(results.old || {})) {
  const a = results.old[key], b = results.old2?.[key], c = results.new?.[key];
  if (!a || !b || !c || a.error || b.error || c.error) { console.log(key.padEnd(24), "ERROR", (a && a.error) || (b && b.error) || (c && c.error) || "missing pass"); totalReal++; continue; }
  const real = diffMaps(a.snap.els, c.snap.els, names);
  const noise = diffMaps(a.snap.els, b.snap.els, names);
  const nReal = real.cells.size + real.missing + real.extra;
  const px = pixelDiff(a.png, c.png), pxn = pixelDiff(a.png, b.png);
  console.log(key.padEnd(24), String(Object.keys(a.snap.els).length).padStart(5), `  ${real.missing}/${real.extra}`.padEnd(14), String(nReal).padStart(10), String(noise.cells.size).padStart(6), String(px).padStart(11), String(pxn).padStart(13));
  totalReal += nReal;
  report.push({ scene: key, elems: Object.keys(a.snap.els).length, missing: real.missing, extra: real.extra, realDiffs: nReal, pixelsNew: px, pixelsNoise: pxn, samples: [...real.cells].slice(0, 30), missingSamples: real.ml.slice(0, 6), extraSamples: real.el.slice(0, 6) });
}
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 1));
console.log(`\nreal differences: ${totalReal}; report: ${path.join(outDir, "report.json")}`);
for (const r of report.filter((x) => x.realDiffs)) {
  console.log(`-- ${r.scene}`);
  for (const k of r.missingSamples) console.log("    only-old", k.slice(-140));
  for (const k of r.extraSamples) console.log("    only-new", k.slice(-140));
  for (const [k, [x, y]] of r.samples.slice(0, 15)) console.log("   ", k.slice(-140), "\n       old:", String(x).slice(0, 70), " new:", String(y).slice(0, 70));
}
process.exit(totalReal ? 1 : 0);
