// Checks the Markdown worker inside the real app, through the test runtime (see tools/test-runtime.ps1) and the Chrome DevTools protocol.
//
//   node tools/worker-app-check.mjs --make-vault DIR                 builds a throw-away vault: sandbox notes, the hand-written corpus, one big note
//   node tools/worker-app-check.mjs --port 9611 --out new.json       reads what the app made of the vault with the worker that is in src/
//   node tools/worker-app-check.mjs --port 9611 --out old.json       (run again with the old worker in src/, then compare)
//   node tools/worker-app-check.mjs --compare old.json new.json      lists every difference
//
// It reports: the metadata cache of every note (links, embeds, tags, headings, sections, list items, blocks, front matter), the
// resolved/unresolved link graph, tags, backlinks, and, for the big note (above 10 KB the reading view asks the worker for its
// sections), the messages the worker answered and what the reading view rendered.
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

if (args.includes("--make-vault")) {
  const dir = path.resolve(opt("--make-vault"));
  fs.mkdirSync(dir, { recursive: true });
  const copy = (from, to) => {
    for (const d of fs.readdirSync(from, { withFileTypes: true })) {
      const a = path.join(from, d.name), b = path.join(to, d.name);
      if (d.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copy(a, b); } else fs.copyFileSync(a, b);
    }
  };
  copy(path.join(repo, "src", "sandbox"), dir);
  const corpus = path.join(here, "worker-corpus");
  const texts = [];
  for (const f of fs.readdirSync(corpus)) {
    if (!f.endsWith(".md")) continue;
    fs.copyFileSync(path.join(corpus, f), path.join(dir, f));
    texts.push(fs.readFileSync(path.join(corpus, f), "utf8").replace(/^---[\s\S]*?\n---\n/, ""));
  }
  // a note of about 60 KB: more than the 10 KB above which the reading view hands the text to the worker
  let big = "---\ntitle: Big note\ntags: [big, worker]\n---\n# Big note\n\n";
  for (let i = 0; big.length < 60000; i++) big += `## Part ${i}\n\n` + texts[i % texts.length] + "\n\n";
  fs.writeFileSync(path.join(dir, "Big note.md"), big);
  fs.writeFileSync(path.join(dir, "Small note.md"), "# Small\n\nSee [[Big note]] and [[Start here]] #small-tag\n\n- [ ] task\n");
  console.log("vault:", dir);
  process.exit(0);
}

if (args.includes("--compare")) {
  const i = args.indexOf("--compare");
  const a = JSON.parse(fs.readFileSync(args[i + 1], "utf8")), b = JSON.parse(fs.readFileSync(args[i + 2], "utf8"));
  let bad = 0;
  const diff = (x, y, p) => {
    if (isDeepStrictEqual(x, y)) return;
    if (x && y && typeof x === "object" && typeof y === "object" && Array.isArray(x) === Array.isArray(y)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) diff(x[k], y[k], `${p}.${k}`);
      return;
    }
    if (bad++ < 30) console.log(`DIFF ${p}\n  a: ${JSON.stringify(x)?.slice(0, 200)}\n  b: ${JSON.stringify(y)?.slice(0, 200)}`);
  };
  diff(a.vault, b.vault, "vault");
  diff(a.reading, b.reading, "reading");
  console.log(bad ? `${bad} difference(s)` : "identical: metadata of every note, link graph, tags, backlinks and the reading view");
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------------------- DevTools
const port = +opt("--port", 9611);
const out = opt("--out");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === "page");
let page;
for (let i = 0; i < 60 && !page; i++) {
  try { page = (await targets()).find((t) => t.url.includes("index.html")); } catch { /* not up yet */ }
  if (!page) await sleep(1000);
}
if (!page) { console.error("no app page on port", port); process.exit(2); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise((res) => { const id = nextId++; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
  return r.result.result.value;
};

console.log("waiting for the app ...");
for (let i = 0; i < 120; i++) {
  if (await run("!!(window.app && app.vault && app.metadataCache && app.workspace && app.workspace.layoutReady)").catch(() => false)) break;
  await sleep(1000);
}
console.log("waiting for the index ...");
let n = 0;
for (let i = 0; i < 120; i++) {
  n = await run("app.vault.getMarkdownFiles().filter((f) => !app.metadataCache.getFileCache(f)).length").catch(() => -1);
  if (n === 0) break;
  await sleep(1000);
}
if (n !== 0) { console.error("index not finished, notes without cache:", n); process.exit(3); }
await sleep(1500);

const vault = await run(`(() => {
  const mc = app.metadataCache, files = app.vault.getMarkdownFiles().sort((a, b) => (a.path < b.path ? -1 : 1)), res = {};
  for (const f of files) res[f.path] = { cache: JSON.parse(JSON.stringify(mc.getFileCache(f) || null)), backlinks: [...(mc.getBacklinksForFile(f).data || new Map()).keys()].sort() };
  const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, typeof o[k] === "object" ? sortKeys(o[k]) : o[k]]));
  return { notes: res, resolved: sortKeys(mc.resolvedLinks), unresolved: sortKeys(mc.unresolvedLinks), tags: sortKeys(mc.getTags()) };
})()`);
const noteCount = Object.keys(vault.notes).length;
const tagCount = Object.keys(vault.tags).length;
const withLinks = Object.values(vault.notes).filter((x) => x.cache?.links?.length).length;
console.log(`notes ${noteCount}, with links ${withLinks}, tags ${tagCount}, notes with backlinks ${Object.values(vault.notes).filter((x) => x.backlinks.length).length}`);

// reading view of the big note: log what the worker is asked and what it answers.
// (At this commit a note cannot be opened in a hidden test window unless onNodeInserted listeners run later than the call:
// enhance.js fires them at once for an element that is already connected and the editor then reads a view it does not have yet.
// The test page defers them the way a MutationObserver would; that is not part of the worker.)
await run(`(() => {
  const H = HTMLElement.prototype, orig = H.onNodeInserted;
  if (orig && !orig.__deferred) { H.onNodeInserted = function (l, o) { return orig.call(this, () => setTimeout(l, 0), o); }; H.onNodeInserted.__deferred = true; }
  window.__wlog = [];
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(u, o) {
      super(u, o);
      const pm = this.postMessage.bind(this);
      this.postMessage = (m, t) => { if (m && m.parseSections !== undefined) window.__wlog.push("ask parseSections " + String(m.parseSections).length); return pm(m, t); };
      this.addEventListener("message", (e) => { if (e.data && e.data.sections) window.__wlog.push("answer sections " + e.data.sections.length); });
    }
  };
})()`);
const reading = {};
for (const [label, p] of [["big", "Big note.md"], ["small", "Small note.md"], ["start", "Start here.md"]]) {
  const info = await run(`(async () => {
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(p)});
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(f, { state: { mode: "preview" } });
    await new Promise((r) => setTimeout(r, 400));
    const view = leaf.view, el = view.previewMode ? view.previewMode.containerEl : view.containerEl;
    for (let i = 0; i < 80; i++) { if (el.querySelectorAll(".markdown-preview-section > *").length) break; await new Promise((r) => setTimeout(r, 250)); }
    await new Promise((r) => setTimeout(r, 1500));
    const q = (s) => el.querySelectorAll(s).length;
    const sizer = el.querySelector(".markdown-preview-sizer");
    return {
      mode: view.getMode && view.getMode(),
      sections: q(".markdown-preview-section"), blocks: q(".markdown-preview-section > *"), headings: q("h1,h2,h3,h4,h5,h6"),
      internalLinks: q("a.internal-link"), tags: q("a.tag"), callouts: q(".callout"), embeds: q(".internal-embed"), footnoteRefs: q("sup.footnote-ref"),
      tasks: q(".task-list-item"), tables: q("table"), code: q("pre > code"), math: q(".math"), marks: q("mark"), frontmatter: q(".frontmatter, .metadata-container"),
      textLength: (sizer ? sizer.innerText : el.innerText).length, firstText: (sizer ? sizer.innerText : el.innerText).slice(0, 160),
    };
  })()`);
  reading[label] = info;
  console.log(label, JSON.stringify(info));
}
reading.workerLog = await run("window.__wlog");
console.log("worker log:", JSON.stringify(reading.workerLog));

// the outline of the big note
reading.outline = await run(`(async () => {
  try {
    const f = app.vault.getAbstractFileByPath("Big note.md");
    const leaf = app.workspace.getLeaf("tab");
    await leaf.openFile(f);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    const types = Object.keys(app.viewRegistry.viewByType || {});
    if (!types.includes("outline")) return { available: false, types: types.length };
    app.workspace.rightSplit.expand();
    const rl = app.workspace.getRightLeaf(false);
    await rl.setViewState({ type: "outline", active: true });
    app.workspace.revealLeaf(rl);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await new Promise((r) => setTimeout(r, 3000));
    const el = rl.view.containerEl, items = el.querySelectorAll(".tree-item");
    return { available: true, items: items.length, text: el.innerText };
  } catch (e) { return { error: String(e) }; }
})()`);
console.log("outline:", JSON.stringify(reading.outline));

if (out) fs.writeFileSync(out, JSON.stringify({ vault, reading }, null, 1));
ws.close();
process.exit(0);
