// UI consistency audit. Opens every screen of Basalt in a test window (CDP on PORT, default 9555), reads the computed styles of every element,
// and writes each deviation from docs/UI-STYLE.md to docs/UI-AUDIT.md (and the raw list to docs/ui-audit.json).
// Usage: start a test window on an isolated profile with --remote-debugging-port=9555, then:  node tools/ui-audit.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT || 9555;
const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = pages.find((p) => p.type === "page" && p.url.includes("index.html"));
if (!page) throw new Error("no Basalt window on port " + PORT);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const run = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? "EXC " + r.result.exceptionDetails.exception?.description : r.result?.result?.value; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shotDir = path.join(root, "docs", "ui-audit-shots"); fs.mkdirSync(shotDir, { recursive: true });
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(shotDir, name + ".png"), Buffer.from(r.result.data, "base64")); };

// ---- the rules (docs/UI-STYLE.md): what a Basalt element may look like
const INSPECT = `(() => {
  const NS = /^(bsg|bsd|bsv|bset|bsh|bpal|bss|bsc|bsf|bst|bt|fp|vs|bsx|bsi|bsp|bs)-/;
  const ours = (el) => [...el.classList].some((c) => NS.test(c));
  const out = [];
  const px = (v) => parseFloat(v) || 0;
  const body = getComputedStyle(document.body);
  const ui = body.getPropertyValue("--font-interface").trim();
  const sel = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\s+/).slice(0, 3).join(".") : "");
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none"; };
  for (const el of document.querySelectorAll("*")) {
    if (!ours(el) || !visible(el)) continue;
    const c = getComputedStyle(el), s = sel(el), add = (rule, detail) => out.push({ el: s, rule, detail });
    const radius = px(c.borderTopLeftRadius), clip = c.clipPath !== "none";
    const isPanel = (px(c.borderTopWidth) > 0 || c.boxShadow !== "none") && el.getBoundingClientRect().width > 120 && el.getBoundingClientRect().height > 60;
    if (radius > 4 && !el.classList.contains("checkbox-container") && !/50%|999/.test(c.borderTopLeftRadius) && radius < 40) add("radius", "border-radius " + c.borderTopLeftRadius + " (allowed: 0 for panels with the corner cut, 4px for small controls)");
    if (isPanel && !clip && radius === 0 && !el.closest(".modal,.menu,.popover")) add("panel-shape", "a bordered panel without the cut corners (clip-path: var(--bs-clip))");
    if (isPanel && clip && c.boxShadow !== "none") add("shadow", "box-shadow on a clipped panel (it is cut off anyway): " + c.boxShadow.slice(0, 40));
    if (c.fontFamily && ui && !c.fontFamily.includes(ui.split(",")[0].replace(/['"]/g, "").trim()) && !/mono|code|kbd/i.test(c.fontFamily) && el.textContent.trim().length) add("font", "font-family differs from the interface font: " + c.fontFamily.slice(0, 50));
    const fs = px(c.fontSize); if (el.children.length === 0 && el.textContent.trim() && ![10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 15, 16, 17, 18, 20, 22, 24].includes(fs) && fs > 0) add("font-size", "font-size " + fs + "px is outside the scale");
    if (el.tagName === "BUTTON" && el.children.length === 0 && /^[×✕−+◎✓•x]$/.test(el.textContent.trim())) add("text-icon", "a button drawn with the character " + JSON.stringify(el.textContent.trim()) + " instead of an icon of the application");
    if (el.tagName === "svg") { const w = px(c.width); if (w && ![14, 15, 16, 17, 18, 20, 22, 24].includes(Math.round(w))) add("icon-size", "icon " + Math.round(w) + "px"); }
  }
  // colours that are not from the theme
  const theme = new Set(); for (const n of ["--background-primary","--background-secondary","--background-modifier-border","--background-modifier-hover","--text-normal","--text-muted","--text-faint","--interactive-accent","--text-on-accent","--background-primary-alt"]) { const p = document.createElement("i"); p.style.color = "var(" + n + ")"; document.body.appendChild(p); theme.add(getComputedStyle(p).color); p.remove(); }
  for (const el of document.querySelectorAll("*")) {
    if (!ours(el) || !visible(el)) continue; const c = getComputedStyle(el);
    if (el.children.length === 0 && el.textContent.trim() && !theme.has(c.color) && !/rgba\\(.*,\\s*0\\)/.test(c.color) && !/svg/.test(el.tagName)) out.push({ el: sel(el), rule: "colour", detail: "text colour " + c.color + " is not a theme colour" });
  }
  return JSON.stringify(out);
})()`;

const SCREENS = [
  { name: "home", open: `(async()=>{await app.workspace.getLeaf("tab").openFile(app.vault.getFiles().find(f=>f.extension==="md"));return 1})()`, after: 600 },
  { name: "palette", open: `app.commands.executeCommandById("switcher:open")`, after: 700, close: `document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))` },
  { name: "settings", open: `app.commands.executeCommandById("app:open-settings")`, after: 900, close: `document.querySelector(".bset .modal-close-button, .bset-x")&&document.querySelector(".bset .modal-close-button, .bset-x").click()` },
  { name: "graph", open: `(async()=>{for(const l of app.workspace.getLeavesOfType("graph"))l.detach();app.commands.executeCommandById("graph:open");await new Promise(r=>setTimeout(r,5000));const v=app.workspace.getLeavesOfType("graph")[0].view;v.setSel(5,true);v.panel.classList.add("is-open");return 1})()`, after: 1500 },
  { name: "graph-menu", open: `(async()=>{const v=app.workspace.getLeavesOfType("graph")[0].view;const ex=v.ex;ex.ge_screen_of(7);const f=new Float32Array(ex.memory.buffer,ex.ge_input(2),2);const r=v.cv.getBoundingClientRect();v.cv.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true,clientX:r.left+f[0],clientY:r.top+f[1]}));return 1})()`, after: 600 },
  { name: "graph-help", open: `(()=>{document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));app.workspace.getLeavesOfType("graph")[0].view.openHelp();return 1})()`, after: 600 },
  { name: "canvas-draw", open: `(async()=>{const f=app.vault.getFiles().find(x=>x.extension==="canvas");const l=app.workspace.getLeaf("tab");await l.openFile(f);await new Promise(r=>setTimeout(r,3000));window.dispatchEvent(new KeyboardEvent("keydown",{key:"d",code:"KeyD",altKey:true,bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,500));const c=[...document.querySelectorAll(".bsd-tb button")].find(b=>/Цвет/.test(b.title));c&&c.click();return 1})()`, after: 800, close: `window.dispatchEvent(new KeyboardEvent("keydown",{key:"d",code:"KeyD",altKey:true,bubbles:true,cancelable:true}))` },
  { name: "viewer", open: `(async()=>{const f=app.vault.getFiles().find(x=>/png/.test(x.extension));window.__bsViewer.open(f);return 1})()`, after: 900, close: `document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))` },
];

const findings = [];
for (const sc of SCREENS) {
  const r = await run(sc.open); if (String(r).startsWith("EXC")) { findings.push({ screen: sc.name, el: "-", rule: "screen", detail: "could not open: " + r.slice(0, 160) }); continue; }
  await wait(sc.after || 600); await shot(sc.name);
  const j = await run(INSPECT);
  if (String(j).startsWith("EXC")) { findings.push({ screen: sc.name, el: "-", rule: "audit", detail: j.slice(0, 160) }); }
  else for (const f of JSON.parse(j)) findings.push({ screen: sc.name, ...f });
  if (sc.close) { await run(sc.close); await wait(300); }
}
ws.close();

// ---- the report: every deviation, however small, grouped by rule
const uniq = new Map(); for (const f of findings) { const k = [f.rule, f.el, f.detail].join("|"); if (!uniq.has(k)) uniq.set(k, { ...f, screens: new Set() }); uniq.get(k).screens.add(f.screen); }
const list = [...uniq.values()].map((f) => ({ ...f, screens: [...f.screens] }));
fs.writeFileSync(path.join(root, "docs", "ui-audit.json"), JSON.stringify(list, null, 1));
const byRule = {}; for (const f of list) (byRule[f.rule] = byRule[f.rule] || []).push(f);
let md = `# UI audit\n\nGenerated by tools/ui-audit.mjs on ${new Date().toISOString().slice(0, 16).replace("T", " ")}. Screens: ${SCREENS.map((s) => s.name).join(", ")}. Screenshots: docs/ui-audit-shots/.\nThe rules are in docs/UI-STYLE.md. Every line below is a deviation, however small.\n\nTotal: **${list.length}**\n`;
for (const [rule, items] of Object.entries(byRule)) { md += `\n## ${rule} (${items.length})\n\n`; for (const f of items) md += `- \`${f.el}\` on ${f.screens.join(", ")}: ${f.detail}\n`; }
fs.writeFileSync(path.join(root, "docs", "UI-AUDIT.md"), md);
console.log("findings:", list.length); for (const [rule, items] of Object.entries(byRule)) console.log(" ", rule, items.length);
