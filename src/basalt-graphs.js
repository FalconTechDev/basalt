// Basalt code graphs: "Граф файлов" (directories, files, imports between files) and "Граф кода" (functions / classes and the calls between
// them) for the open folder (or the vault). Plain-text parsing per language, force layout on a 2D canvas, pan / zoom / drag / pin, search,
// click opens the file. Positions are remembered in <root>/.basalt/graph-layout.json.
(() => {
  "use strict";
  const VIEW = "basalt-codegraph";
  const fs = window.require("fs"), path = window.require("path");
  const SKIP = new Set(["node_modules", "target", "dist", "build", "out", "__pycache__", "venv", ".venv", "vendor", "coverage", "bin", "obj", "Pods", "site-packages", "third_party"]);
  const LIMIT_FILES = 4000, MAX_BYTES = 400 * 1024, MAX_SYMS = 12000;
  const LANG = {
    js: ["JavaScript", "#f1e05a"], jsx: ["JavaScript", "#f1e05a"], mjs: ["JavaScript", "#f1e05a"], cjs: ["JavaScript", "#f1e05a"], ts: ["TypeScript", "#3178c6"], tsx: ["TypeScript", "#3178c6"],
    py: ["Python", "#3572A5"], rs: ["Rust", "#dea584"], go: ["Go", "#00ADD8"], java: ["Java", "#b07219"], kt: ["Kotlin", "#A97BFF"], cs: ["C#", "#178600"],
    c: ["C", "#aaaaaa"], h: ["C", "#aaaaaa"], cpp: ["C++", "#f34b7d"], hpp: ["C++", "#f34b7d"], cc: ["C++", "#f34b7d"], swift: ["Swift", "#F05138"], rb: ["Ruby", "#cc342d"],
    php: ["PHP", "#8892bf"], dart: ["Dart", "#00B4AB"], lua: ["Lua", "#5a5aff"], sh: ["Shell", "#89e051"], css: ["CSS", "#7a5cc7"], html: ["HTML", "#e34c26"],
  };
  const JSLIKE = new Set(["js", "jsx", "mjs", "cjs", "ts", "tsx"]), CLIKE = new Set(["c", "h", "cpp", "hpp", "cc"]), JVM = new Set(["java", "kt", "cs"]);
  const KW = new Set(["if", "for", "while", "switch", "catch", "function", "return", "else", "do", "try", "new", "typeof", "sizeof", "super", "this", "await", "async", "def", "fn", "func", "class", "match", "with", "and", "or", "not", "in", "is", "elif", "print", "len", "range", "str", "int", "map", "get", "set", "log", "push", "pop", "join", "then", "constructor", "require", "import", "assert", "println", "format", "Some", "Ok", "Err", "Vec", "String", "Box", "Arc"]);
  const css = document.createElement("style");
  css.textContent = `
    .bsg { position: absolute; inset: 0; display: flex; flex-direction: column; background: var(--background-primary); }
    .bsg-bar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--background-modifier-border); flex-wrap: wrap; }
    .bsg-seg { display: inline-flex; border: 1px solid var(--background-modifier-border); border-radius: 6px; overflow: hidden; }
    .bsg-seg button { border: 0; border-radius: 0; background: transparent; padding: 3px 12px; height: 26px; color: var(--text-muted); cursor: pointer; box-shadow: none; font-size: var(--font-ui-small); }
    .bsg-seg button.on { background: var(--interactive-accent); color: var(--text-on-accent); }
    .bsg-btn { border: 1px solid var(--background-modifier-border); border-radius: 6px; background: transparent; height: 26px; padding: 0 10px; color: var(--text-muted); cursor: pointer; box-shadow: none; font-size: var(--font-ui-small); }
    .bsg-btn:hover { color: var(--text-normal); background: var(--background-modifier-hover); } .bsg-btn.on { color: var(--text-normal); background: var(--background-modifier-hover); }
    .bsg-search { height: 26px; width: 150px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); font-size: var(--font-ui-small); }
    .bsg-info { margin-left: auto; color: var(--text-faint); font-size: var(--font-ui-smaller); white-space: nowrap; }
    .bsg-body { position: relative; flex: 1; min-height: 0; }
    .bsg canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; }
    .bsg-tip { position: absolute; z-index: 5; pointer-events: none; display: none; max-width: 360px; padding: 6px 10px; border-radius: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); box-shadow: 0 4px 16px rgba(0,0,0,.3); font-size: var(--font-ui-smaller); color: var(--text-normal); }
    .bsg-tip b { display: block; margin-bottom: 2px; } .bsg-tip span { color: var(--text-muted); display: block; }
    .bsg-legend { position: absolute; left: 10px; bottom: 10px; display: flex; flex-wrap: wrap; gap: 4px 12px; max-width: 60%; padding: 6px 10px; border-radius: 8px; background: var(--background-primary); border: 1px solid var(--background-modifier-border); font-size: var(--font-ui-smaller); color: var(--text-muted); }
    .bsg-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; }
    .bsg-msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--text-muted); pointer-events: none; text-align: center; padding: 24px; }
  `;
  document.head.appendChild(css);

  // ---------- scanning ----------
  async function scan(root, prog) {
    const files = [];
    async function walk(dir, rel) {
      let ents; try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        if (e.isDirectory()) { if (e.name[0] === "." || SKIP.has(e.name)) continue; await walk(path.join(dir, e.name), rel ? rel + "/" + e.name : e.name); }
        else if (files.length < LIMIT_FILES) { const ext = e.name.split(".").pop().toLowerCase(); if (e.name.includes(".") && LANG[ext]) files.push({ rel: (rel ? rel + "/" : "") + e.name, abs: path.join(dir, e.name), ext, name: e.name }); }
      }
      if (prog) prog(files.length);
    }
    await walk(root, "");
    return files;
  }

  // ---------- parsing ----------
  const re = (r) => new RegExp(r.source, r.flags);
  function parse(f, text) {
    const imps = [], syms = [], lines = text.split("\n"), ext = f.ext;
    const add = (name, kind, line) => { if (name && !KW.has(name)) syms.push({ name, kind, line }); };
    const all = (rx, fn) => { const r = re(rx); let m; while ((m = r.exec(text))) fn(m); };
    if (JSLIKE.has(ext)) {
      all(/(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]/g, (m) => imps.push(m[1])); all(/import\s*['"]([^'"]+)['"]/g, (m) => imps.push(m[1]));
      all(/require\(\s*['"]([^'"]+)['"]\s*\)/g, (m) => imps.push(m[1])); all(/import\(\s*['"]([^'"]+)['"]\s*\)/g, (m) => imps.push(m[1]));
      lines.forEach((l, i) => { let m;
        if ((m = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(l))) add(m[1], "fn", i);
        else if ((m = /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(l))) add(m[1], "class", i);
        else if ((m = /^\s*(?:export\s+)?(?:declare\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/.exec(l))) add(m[1], "type", i);
        else if ((m = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/.exec(l))) add(m[1], "fn", i);
        else if ((m = /^\s{2,}(?:(?:static|async|public|private|protected|get|set|override)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{=]+)?\{\s*$/.exec(l))) add(m[1], "method", i); });
    } else if (ext === "py") {
      all(/^\s*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/gm, (m) => m[1].split(",").forEach((x) => imps.push(x.trim().split(/\s+/)[0])));
      all(/^\s*from\s+(\.*[\w.]*)\s+import/gm, (m) => imps.push(m[1]));
      lines.forEach((l, i) => { let m; if ((m = /^\s*(?:async\s+)?def\s+(\w+)/.exec(l))) add(m[1], /^\s/.test(l) ? "method" : "fn", i); else if ((m = /^\s*class\s+(\w+)/.exec(l))) add(m[1], "class", i); });
    } else if (ext === "rs") {
      all(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm, (m) => imps.push("mod:" + m[1])); all(/^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([\w:]+)/gm, (m) => imps.push("use:" + m[1]));
      lines.forEach((l, i) => { let m; if ((m = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:const\s+)?fn\s+(\w+)/.exec(l))) add(m[1], /^\s{2,}/.test(l) ? "method" : "fn", i); else if ((m = /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type)\s+(\w+)/.exec(l))) add(m[1], "class", i); });
    } else if (ext === "go") {
      all(/^\s*import\s+(?:\w+\s+)?"([^"]+)"/gm, (m) => imps.push(m[1])); all(/import\s*\(([\s\S]*?)\)/g, (m) => { const r = /"([^"]+)"/g; let x; while ((x = r.exec(m[1]))) imps.push(x[1]); });
      lines.forEach((l, i) => { let m; if ((m = /^func\s+(?:\([^)]*\)\s*)?(\w+)/.exec(l))) add(m[1], /^func\s+\(/.test(l) ? "method" : "fn", i); else if ((m = /^type\s+(\w+)\s+(?:struct|interface)/.exec(l))) add(m[1], "class", i); });
    } else if (JVM.has(ext)) {
      all(/^\s*(?:import|using)\s+(?:static\s+)?([\w.]+)/gm, (m) => imps.push(m[1]));
      lines.forEach((l, i) => { let m; if ((m = /^\s*(?:(?:public|private|protected|internal|abstract|final|static|data|sealed|open|partial)\s+)*(?:class|interface|enum|object|record|struct)\s+(\w+)/.exec(l))) add(m[1], "class", i);
        else if ((m = /^\s*(?:(?:public|private|protected|internal|static|final|abstract|synchronized|override|suspend|async)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(\w+)\s*\(/.exec(l))) add(m[1], "method", i);
        else if ((m = /^\s+(?:(?:public|private|protected|internal|static|final|abstract|synchronized|override|async)\s+)+(?:[\w<>\[\],.?]+\s+)?(\w+)\s*\(/.exec(l))) add(m[1], "method", i); });
    } else if (CLIKE.has(ext)) {
      all(/^\s*#\s*include\s*"([^"]+)"/gm, (m) => imps.push(m[1]));
      lines.forEach((l, i) => { let m; if ((m = /^(?:class|struct)\s+(\w+)/.exec(l))) add(m[1], "class", i);
        else if (/^[A-Za-z_]/.test(l) && !/^(?:if|for|while|switch|return|else|typedef|using|namespace|#)/.test(l) && (m = /^[\w\s\*&:<>,~]*?\b(\w+)\s*\([^;{]*\)?\s*(?:const\s*)?\{?\s*$/.exec(l)) && /[)\{]\s*$/.test(l)) add(m[1], "fn", i); });
    } else {
      all(/^\s*(?:require_relative|require|include|include_once|require_once|source)\s*\(?\s*['"]([^'"]+)['"]/gm, (m) => imps.push(m[1])); all(/@import\s+(?:url\()?['"]([^'"]+)['"]/g, (m) => imps.push(m[1])); all(/<(?:script[^>]+src|link[^>]+href)=["']([^"']+)["']/g, (m) => imps.push(m[1]));
      lines.forEach((l, i) => { let m; if ((m = /^\s*(?:def|function|fn|func|fun|sub|local\s+function)\s+(\w+)/.exec(l))) add(m[1], "fn", i); else if ((m = /^\s*class\s+(\w+)/.exec(l))) add(m[1], "class", i); });
    }
    return { imps, syms, lines };
  }

  // ---------- import resolution ----------
  function makeResolver(files) {
    const byRel = new Map(files.map((f) => [f.rel, f])), byBase = new Map(), byDir = new Map();
    for (const f of files) { (byBase.get(f.name) || byBase.set(f.name, []).get(f.name)).push(f); const d = path.posix.dirname(f.rel); (byDir.get(d) || byDir.set(d, []).get(d)).push(f); }
    const pick = (cands) => { for (const c of cands) { const f = byRel.get(c); if (f) return f; } return null; };
    const exts = Object.keys(LANG);
    const tryJs = (base) => pick([base, ...exts.map((e) => base + "." + e), ...exts.map((e) => base + "/index." + e)]);
    return (f, spec) => {
      const dir = path.posix.dirname(f.rel), norm = (p) => path.posix.normalize(p).replace(/^\.\//, "");
      if (JSLIKE.has(f.ext) || ["css", "html", "rb", "php", "sh", "lua", "dart"].includes(f.ext)) {
        if (spec[0] === ".") { const b = norm(dir + "/" + spec); return tryJs(b) || (f.ext === "rb" || f.ext === "php" ? pick([b + ".rb", b + ".php"]) : null); }
        if (/^[@~]\//.test(spec)) { const s = spec.slice(2); return tryJs("src/" + s) || tryJs(s); }
        return f.ext === "rb" || f.ext === "php" ? tryJs(norm(dir + "/" + spec)) : null;
      }
      if (f.ext === "py") {
        let dots = 0; while (spec[dots] === ".") dots++; const rest = spec.slice(dots).replace(/\./g, "/");
        const bases = dots ? [path.posix.join(dir, ...Array(Math.max(0, dots - 1)).fill(".."), rest)] : [rest, norm(dir + "/" + rest), "src/" + rest];
        for (const b of bases) { const r = pick([b + ".py", b + "/__init__.py"]); if (r) return r; } return null;
      }
      if (f.ext === "rs") {
        if (spec.startsWith("mod:")) { const n = spec.slice(4), stem = f.name.replace(/\.rs$/, ""); const base = ["mod", "lib", "main"].includes(stem) ? dir : dir + "/" + stem; return pick([base + "/" + n + ".rs", base + "/" + n + "/mod.rs", dir + "/" + n + ".rs", dir + "/" + n + "/mod.rs"]); }
        const parts = spec.slice(4).split("::"); if (parts[0] === "crate") { const si = f.rel.lastIndexOf("src/"); const src = si >= 0 ? f.rel.slice(0, si + 3) : "src"; for (let n = parts.length; n >= 2; n--) { const r = pick([src + "/" + parts.slice(1, n).join("/") + ".rs", src + "/" + parts.slice(1, n).join("/") + "/mod.rs"]); if (r && r !== f) return r; } }
        else if (parts[0] === "super") { const r = pick([path.posix.dirname(dir) + "/" + (parts[1] || "") + ".rs", path.posix.dirname(dir) + "/" + (parts[1] || "") + "/mod.rs"]); if (r && r !== f) return r; }
        return null;
      }
      if (f.ext === "go") { const segs = spec.split("/"); for (const [d, list] of byDir) { if (d === "." ) continue; if (d.endsWith(segs.slice(-2).join("/")) || (segs.length === 1 && path.posix.basename(d) === segs[0])) return list.find((x) => x.name === path.posix.basename(d) + ".go") || list.find((x) => !x.name.endsWith("_test.go")) || list[0]; } return null; }
      if (JVM.has(f.ext)) { const segs = spec.split("."); const last = segs.pop(); const cands = []; for (const e of ["java", "kt", "cs"]) (byBase.get(last + "." + e) || []).forEach((x) => cands.push(x)); const want = segs.join("/"); return cands.find((x) => x.rel.includes(want)) || cands[0] || null; }
      if (CLIKE.has(f.ext)) { const b = norm(dir + "/" + spec); const r = byRel.get(b) || byRel.get(spec); if (r) return r; const list = byBase.get(path.posix.basename(spec)); return list ? list[0] : null; }
      return null;
    };
  }

  // ---------- graph ----------
  const hue = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) % 360; };
  async function buildGraph(root, mode, prog) {
    const files = await scan(root, prog);
    const resolve = makeResolver(files), parsed = new Map();
    let n = 0;
    for (const f of files) {
      try { const st = await fs.promises.stat(f.abs); if (st.size > MAX_BYTES) { f.loc = Math.round(st.size / 40); parsed.set(f, { imps: [], syms: [], lines: [] }); continue; }
        const text = await fs.promises.readFile(f.abs, "utf8"); const p = parse(f, text); f.loc = p.lines.length; parsed.set(f, p); } catch (e) { f.loc = 0; parsed.set(f, { imps: [], syms: [], lines: [] }); }
      if (++n % 40 === 0) { if (prog) prog(files.length, n); await new Promise((r) => setTimeout(r, 0)); }
    }
    const nodes = [], links = [], idx = new Map(), seen = new Set();
    const addNode = (o) => { o.deg = 0; idx.set(o.id, o); nodes.push(o); return o; };
    const addLink = (a, b, kind) => { const k = a.id + ">" + b.id + kind; if (seen.has(k) || a === b) return; seen.add(k); links.push({ a, b, kind }); a.deg++; b.deg++; };
    // directories + files
    const dirNode = (d) => { if (idx.has("d:" + d)) return idx.get("d:" + d); const node = addNode({ id: "d:" + d, kind: "dir", label: d === "" ? path.basename(root) : path.posix.basename(d), path: d, dir: d, loc: 0 }); if (d !== "") addLink(dirNode(path.posix.dirname(d) === "." ? "" : path.posix.dirname(d)), node, "contains"); return node; };
    dirNode("");
    for (const f of files) { const d = path.posix.dirname(f.rel) === "." ? "" : path.posix.dirname(f.rel); const node = addNode({ id: "f:" + f.rel, kind: "file", label: f.name, path: f.rel, abs: f.abs, dir: d, loc: f.loc || 1, lang: LANG[f.ext][0], color: LANG[f.ext][1] }); f.node = node; addLink(dirNode(d), node, "contains"); }
    for (const f of files) for (const spec of parsed.get(f).imps) { const t = resolve(f, spec); if (t && t.node) addLink(f.node, t.node, "import"); }
    let symCount = 0; const defs = new Map();
    if (mode === "code") {
      for (const f of files) { const p = parsed.get(f); f.symNodes = []; for (const s of p.syms) { if (symCount >= MAX_SYMS) break; symCount++; const node = addNode({ id: "s:" + f.rel + ":" + s.line + ":" + s.name, kind: "sym", sym: s.kind, label: s.name, path: f.rel, abs: f.abs, line: s.line + 1, dir: f.node.dir, loc: 0, lang: LANG[f.ext][0], color: f.node.color }); f.symNodes.push(node); addLink(f.node, node, "contains"); (defs.get(s.name) || defs.set(s.name, []).get(s.name)).push(node); } }
      for (const f of files) {
        const p = parsed.get(f), sn = f.symNodes; if (!sn.length && !p.lines.length) continue; let cur = -1; const rx = /\b([A-Za-z_$][\w$]*)\s*\(/g;
        for (let i = 0; i < p.lines.length; i++) {
          while (cur + 1 < sn.length && sn[cur + 1].line - 1 <= i) cur++;
          const src = cur >= 0 ? sn[cur] : f.node; if (cur >= 0 && sn[cur].line - 1 === i) { /* declaration line: skip own name */ }
          rx.lastIndex = 0; let m; const line = p.lines[i]; if (line.length > 400) continue;
          while ((m = rx.exec(line))) { const t = defs.get(m[1]); if (!t || t.length > 2 || KW.has(m[1])) continue; for (const tn of t) if (tn !== src && !(cur >= 0 && sn[cur].line - 1 === i && tn === sn[cur])) addLink(src, tn, "call"); }
        }
      }
      // import edges between files stay (fainter); symbols without any call/contain beyond the file are fine
    }
    // dir sizes
    for (const nd of nodes) if (nd.kind === "file") { let d = idx.get("d:" + nd.dir); while (d) { d.loc += nd.loc; const up = d.path === "" ? null : (path.posix.dirname(d.path) === "." ? "" : path.posix.dirname(d.path)); d = up === null ? null : idx.get("d:" + up); } }
    return { nodes, links, idx, files: files.length, syms: symCount };
  }

  // ---------- view ----------
  function makeView(api) {
    return class CodeGraphView extends api.ItemView {
      constructor(leaf) { super(leaf); this.mode = "files"; this.g = null; this.scale = 1; this.ox = 0; this.oy = 0; this.alpha = 1; this.hover = null; this.match = null; this.showDirs = true; this.showImports = true; }
      getViewType() { return VIEW; }
      getDisplayText() { return this.mode === "code" ? "Граф кода" : "Граф файлов"; }
      getIcon() { return "lucide-git-fork"; }
      getState() { return { mode: this.mode }; }
      async setState(state, result) { if (state && state.mode && state.mode !== this.mode && this.built) { this.mode = state.mode; this.syncSeg(); await this.load(); } else if (state && state.mode) this.mode = state.mode; try { this.leaf.updateHeader && this.leaf.updateHeader(); } catch (e) { /* ok */ } return super.setState ? super.setState(state, result) : undefined; }
      root() { const W = window.__bsWorkspace; if (W && W.active && W.active() && W.root()) return W.root(); return app.vault.adapter.basePath; }
      async onOpen() {
        const c = this.contentEl; c.textContent = ""; c.style.padding = "0"; c.style.position = "relative"; c.style.overflow = "hidden";
        const wrap = document.createElement("div"); wrap.className = "bsg"; c.appendChild(wrap);
        const bar = document.createElement("div"); bar.className = "bsg-bar"; wrap.appendChild(bar);
        const seg = document.createElement("div"); seg.className = "bsg-seg"; bar.appendChild(seg); this.segBtns = {};
        for (const [k, t] of [["files", "Файлы"], ["code", "Код"]]) { const b = document.createElement("button"); b.textContent = t; b.addEventListener("click", () => { if (this.mode !== k) { this.mode = k; this.syncSeg(); this.load(); try { this.leaf.updateHeader(); } catch (e) { /* ok */ } } }); seg.appendChild(b); this.segBtns[k] = b; }
        const q = document.createElement("input"); q.className = "bsg-search"; q.placeholder = "Найти узел…"; bar.appendChild(q); this.qIn = q;
        q.addEventListener("input", () => this.runSearch()); q.addEventListener("keydown", (e) => { if (e.key === "Enter") this.focusMatch(); });
        const btn = (t, title, fn, on) => { const b = document.createElement("button"); b.className = "bsg-btn" + (on ? " on" : ""); b.textContent = t; b.title = title; b.addEventListener("click", () => fn(b)); bar.appendChild(b); return b; };
        btn("Каталоги", "Показывать связи «каталог → файл»", (b) => { this.showDirs = !this.showDirs; b.classList.toggle("on", this.showDirs); this.draw(); }, true);
        btn("Импорты", "Показывать импорты между файлами", (b) => { this.showImports = !this.showImports; b.classList.toggle("on", this.showImports); this.draw(); }, true);
        btn("По центру", "Вписать граф в окно", () => this.fit());
        btn("Заново", "Сбросить закреплённые позиции и пересчитать", () => this.relayout());
        btn("↻", "Пересканировать папку", () => this.load());
        this.info = document.createElement("span"); this.info.className = "bsg-info"; bar.appendChild(this.info);
        const body = document.createElement("div"); body.className = "bsg-body"; wrap.appendChild(body); this.body = body;
        const cv = document.createElement("canvas"); body.appendChild(cv); this.cv = cv; this.ctx = cv.getContext("2d");
        this.tip = document.createElement("div"); this.tip.className = "bsg-tip"; body.appendChild(this.tip);
        this.legend = document.createElement("div"); this.legend.className = "bsg-legend"; body.appendChild(this.legend);
        this.msg = document.createElement("div"); this.msg.className = "bsg-msg"; body.appendChild(this.msg);
        this.bind(); this.syncSeg();
        this.ro = new ResizeObserver(() => { this.resize(); this.draw(); }); this.ro.observe(body);
        this.built = true; await this.load();
      }
      syncSeg() { for (const k in this.segBtns) this.segBtns[k].classList.toggle("on", k === this.mode); }
      resize() { const r = this.body.getBoundingClientRect(), d = window.devicePixelRatio || 1; this.w = r.width; this.h = r.height; this.cv.width = Math.max(1, Math.round(r.width * d)); this.cv.height = Math.max(1, Math.round(r.height * d)); this.dpr = d; }
      async load() {
        const myRun = this.run = (this.run || 0) + 1; this.resize(); this.g = null; this.msg.textContent = "Читаю файлы…"; this.draw();
        const root = this.root();
        if (!root) { this.msg.textContent = "Откройте папку или хранилище"; return; }
        let g; try { g = await buildGraph(root, this.mode, (n, k) => { if (myRun === this.run) this.msg.textContent = "Читаю файлы… " + (k || n) + (k ? " / " + n : ""); }); } catch (e) { console.error("[basalt-graphs]", e); this.msg.textContent = "Ошибка: " + e.message; return; }
        if (myRun !== this.run) return;
        this.g = g; this.rootPath = root;
        if (!g.nodes.length) { this.msg.textContent = "В этой папке нет файлов с кодом"; return; }
        this.msg.textContent = "";
        const saved = await this.loadLayout(); let placed = 0;
        const cx = 0, cy = 0, dirs = [...new Set(g.nodes.map((n) => n.dir))]; const ang = new Map(dirs.map((d, i) => [d, (i / dirs.length) * Math.PI * 2]));
        g.nodes.forEach((n, i) => { const s = saved && saved[n.id]; if (s) { n.x = s[0]; n.y = s[1]; n.pinned = !!s[2]; placed++; } else { const a = ang.get(n.dir) + (Math.random() - .5) * .6, r = 60 + Math.sqrt(g.nodes.length) * 14 * (.4 + Math.random() * .6); n.x = cx + Math.cos(a) * r; n.y = cy + Math.sin(a) * r; n.pinned = false; } n.vx = n.vy = 0; n.r = n.kind === "dir" ? 6 : n.kind === "file" ? Math.min(15, 3 + Math.sqrt(n.loc) / 4) : Math.min(9, 2.5 + n.deg * .35); });
        this.alpha = placed > g.nodes.length * .8 ? .05 : 1; this.fitted = false;
        this.fillLegend(); this.updateInfo(); this.runSearch(true); this.loop();
      }
      fillLegend() { const m = new Map(); for (const n of this.g.nodes) if (n.lang) m.set(n.lang, n.color); this.legend.textContent = ""; for (const [l, c] of m) { const s = document.createElement("span"); const i = document.createElement("i"); i.style.background = c; s.append(i, l); this.legend.appendChild(s); } }
      updateInfo() { const g = this.g; this.info.textContent = g.files + " файлов · " + g.links.filter((l) => l.kind === "import").length + " импортов" + (this.mode === "code" ? " · " + g.syms + " символов · " + g.links.filter((l) => l.kind === "call").length + " вызовов" : ""); }
      // -- physics --
      loop() { if (this.raf) return; const step = () => { this.raf = 0; if (!this.g) return; if (this.alpha > .012 || this.dragging) { this.tick(); this.draw(); this.raf = requestAnimationFrame(step); } else { this.draw(); this.saveLayout(); } if (!this.fitted && this.alpha < .5 && this.w) { this.fitted = true; this.fit(); } }; this.raf = requestAnimationFrame(step); }
      tick() {
        const g = this.g, nodes = g.nodes, a = this.alpha, cell = 70, grid = new Map(), key = (x, y) => x * 73856093 ^ y * 19349663;
        for (const n of nodes) { const k = key(Math.floor(n.x / cell), Math.floor(n.y / cell)); let arr = grid.get(k); if (!arr) grid.set(k, arr = []); arr.push(n); n.fx = 0; n.fy = 0; }
        for (const n of nodes) { const cx = Math.floor(n.x / cell), cy = Math.floor(n.y / cell);
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const arr = grid.get(key(cx + dx, cy + dy)); if (!arr) continue; for (const m of arr) { if (m === n) continue; let ex = n.x - m.x, ey = n.y - m.y, d2 = ex * ex + ey * ey; if (d2 > cell * cell * 2.2) continue; if (d2 < .01) { ex = Math.random() - .5; ey = Math.random() - .5; d2 = .25; } const f = (260 + (n.r + m.r) * 12) / d2; n.fx += ex * f; n.fy += ey * f; } } }
        for (const l of g.links) { const A = l.a, B = l.b; let ex = B.x - A.x, ey = B.y - A.y; const d = Math.sqrt(ex * ex + ey * ey) || 1; const len = l.kind === "contains" ? (A.kind === "dir" ? 55 : 28) : l.kind === "import" ? 120 : 70, k = l.kind === "contains" ? .06 : .02; const f = (d - len) * k; ex /= d; ey /= d; A.fx += ex * f; A.fy += ey * f; B.fx -= ex * f; B.fy -= ey * f; }
        for (const n of nodes) { n.fx -= n.x * .004; n.fy -= n.y * .004; if (n.pinned || n === this.dragNode) { n.vx = n.vy = 0; continue; } n.vx = (n.vx + n.fx * a) * .8; n.vy = (n.vy + n.fy * a) * .8; const sp = Math.hypot(n.vx, n.vy); if (sp > 30) { n.vx *= 30 / sp; n.vy *= 30 / sp; } n.x += n.vx; n.y += n.vy; }
        this.alpha *= .987;
      }
      relayout() { if (!this.g) return; for (const n of this.g.nodes) { n.pinned = false; n.x += (Math.random() - .5) * 40; n.y += (Math.random() - .5) * 40; } this.alpha = 1; this.fitted = false; this.loop(); }
      fit() { const ns = this.g && this.g.nodes; if (!ns || !ns.length || !this.w) return; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const n of ns) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); } const pw = Math.max(1, x1 - x0), ph = Math.max(1, y1 - y0); this.scale = Math.min(4, Math.max(.03, Math.min((this.w - 80) / pw, (this.h - 80) / ph))); this.ox = this.w / 2 - ((x0 + x1) / 2) * this.scale; this.oy = this.h / 2 - ((y0 + y1) / 2) * this.scale; this.draw(); }
      // -- search --
      runSearch(quiet) { const s = this.qIn.value.trim().toLowerCase(); this.match = null; if (s && this.g) { this.match = new Set(); for (const n of this.g.nodes) if (n.label.toLowerCase().includes(s) || (n.kind !== "sym" && n.path.toLowerCase().includes(s))) this.match.add(n); } if (!quiet) this.draw(); }
      focusMatch() { if (!this.match || !this.match.size) return; const n = [...this.match][0]; this.scale = Math.max(this.scale, 1.4); this.ox = this.w / 2 - n.x * this.scale; this.oy = this.h / 2 - n.y * this.scale; this.draw(); }
      // -- layout storage --
      layoutFile() { return path.join(this.rootPath, ".basalt", "graph-layout.json"); }
      async loadLayout() { try { const j = JSON.parse(await fs.promises.readFile(this.layoutFile(), "utf8")); return j[this.mode] || null; } catch (e) { return null; } }
      saveLayout() { clearTimeout(this.st); this.st = setTimeout(async () => { if (!this.g || !this.rootPath) return; try { let all = {}; try { all = JSON.parse(await fs.promises.readFile(this.layoutFile(), "utf8")); } catch (e) { /* new */ } const m = {}; for (const n of this.g.nodes) m[n.id] = [Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10, n.pinned ? 1 : 0]; all[this.mode] = m; await fs.promises.mkdir(path.dirname(this.layoutFile()), { recursive: true }); await fs.promises.writeFile(this.layoutFile(), JSON.stringify(all)); } catch (e) { /* read-only folder */ } }, 400); }
      // -- drawing --
      cssv(n) { return getComputedStyle(document.body).getPropertyValue(n).trim(); }
      draw() {
        const ctx = this.ctx; if (!ctx || !this.w) return; const d = this.dpr || 1, g = this.g;
        ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, this.w, this.h); if (!g) return;
        const bg = this.cssv("--background-primary") || "#1e1e1e", txt = this.cssv("--text-normal") || "#ddd", mut = this.cssv("--text-muted") || "#999", acc = this.cssv("--interactive-accent") || "#7a6cf0";
        ctx.translate(this.ox, this.oy); ctx.scale(this.scale, this.scale);
        const hov = this.hover, nb = new Set(); if (hov) { nb.add(hov); for (const l of g.links) { if (l.a === hov) nb.add(l.b); else if (l.b === hov) nb.add(l.a); } }
        const dim = (n) => (hov && !nb.has(n)) || (this.match && !this.match.has(n));
        const vx0 = -this.ox / this.scale, vy0 = -this.oy / this.scale, vx1 = vx0 + this.w / this.scale, vy1 = vy0 + this.h / this.scale;
        const lw = 1 / this.scale;
        for (const l of g.links) {
          if (l.kind === "contains" && !this.showDirs && l.a.kind === "dir") continue; if (l.kind === "import" && !this.showImports && this.mode === "code") continue;
          const A = l.a, B = l.b; if ((A.x < vx0 && B.x < vx0) || (A.x > vx1 && B.x > vx1) || (A.y < vy0 && B.y < vy0) || (A.y > vy1 && B.y > vy1)) continue;
          const hl = hov && (A === hov || B === hov), faded = (hov && !hl) || (this.match && !(this.match.has(A) || this.match.has(B)));
          ctx.globalAlpha = faded ? .04 : hl ? .95 : l.kind === "contains" ? .16 : l.kind === "call" ? .2 : .5; ctx.lineWidth = (hl ? 1.6 : l.kind === "contains" ? .8 : 1) * lw;
          ctx.strokeStyle = l.kind === "call" ? "#e0a030" : l.kind === "import" ? acc : mut; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
          if (l.kind !== "contains" && this.scale > .5 && !faded) { const dx = B.x - A.x, dy = B.y - A.y, dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl, px = B.x - ux * (B.r + 2), py = B.y - uy * (B.r + 2), s = 5 * lw * 1.4; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - ux * s - uy * s * .5, py - uy * s + ux * s * .5); ctx.lineTo(px - ux * s + uy * s * .5, py - uy * s - ux * s * .5); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); }
        }
        for (const n of g.nodes) {
          if (n.x < vx0 - 20 || n.x > vx1 + 20 || n.y < vy0 - 20 || n.y > vy1 + 20) continue;
          ctx.globalAlpha = dim(n) ? .12 : 1; ctx.beginPath();
          if (n.kind === "dir") { ctx.arc(n.x, n.y, n.r, 0, 7); ctx.fillStyle = bg; ctx.fill(); ctx.lineWidth = 1.6 * lw; ctx.strokeStyle = mut; ctx.stroke(); }
          else if (n.kind === "sym") { const c = n.sym === "class" || n.sym === "type" ? "#c586c0" : n.sym === "method" ? "#4ec9b0" : n.color; if (n.sym === "class" || n.sym === "type") { ctx.rect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2); } else ctx.arc(n.x, n.y, n.r, 0, 7); ctx.fillStyle = c; ctx.fill(); }
          else { ctx.arc(n.x, n.y, n.r, 0, 7); ctx.fillStyle = n.color; ctx.fill(); if (n === hov || (this.match && this.match.has(n))) { ctx.lineWidth = 2 * lw; ctx.strokeStyle = txt; ctx.stroke(); } }
          if (n.pinned) { ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 2.5 * lw, 0, 7); ctx.lineWidth = lw; ctx.strokeStyle = txt; ctx.stroke(); }
        }
        // labels without overlap
        ctx.globalAlpha = 1; const fs = 11 / this.scale; ctx.font = fs + "px sans-serif"; ctx.textBaseline = "middle"; const placed = [];
        const order = g.nodes.filter((n) => n.x > vx0 && n.x < vx1 && n.y > vy0 && n.y < vy1).sort((a, b) => ((b === hov) - (a === hov)) || ((this.match && this.match.has(b)) - (this.match && this.match.has(a))) || (b.deg - a.deg));
        for (const n of order) {
          const strong = n === hov || nb.has(n) && hov || (this.match && this.match.has(n)); const show = strong || (n.kind === "dir" ? this.scale > .25 : n.kind === "file" ? (this.scale > .9 || n.deg >= 8) : this.scale > 1.5);
          if (!show || (dim(n) && !strong)) continue; const w = ctx.measureText(n.label).width, x = n.x + n.r + 3 / this.scale, y = n.y, box = [x, y - fs / 2, x + w, y + fs / 2];
          if (!strong && placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue; placed.push(box);
          ctx.lineWidth = 3 / this.scale; ctx.strokeStyle = bg; ctx.strokeText(n.label, x, y); ctx.fillStyle = n.kind === "dir" ? mut : txt; ctx.fillText(n.label, x, y);
        }
        ctx.globalAlpha = 1;
      }
      // -- interaction --
      toWorld(e) { const r = this.cv.getBoundingClientRect(); return [(e.clientX - r.left - this.ox) / this.scale, (e.clientY - r.top - this.oy) / this.scale]; }
      hit(wx, wy) { const g = this.g; if (!g) return null; let best = null, bd = 1e9; for (const n of g.nodes) { const d = Math.hypot(n.x - wx, n.y - wy); if (d < n.r + 4 / this.scale && d < bd) { best = n; bd = d; } } return best; }
      bind() {
        const cv = this.cv; let pan = null, down = null;
        cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); const [wx, wy] = this.toWorld(e), n = this.hit(wx, wy); down = { x: e.clientX, y: e.clientY, moved: false, n }; if (n) { this.dragNode = n; this.dragging = true; this.alpha = Math.max(this.alpha, .3); this.loop(); } else pan = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy }; cv.style.cursor = "grabbing"; });
        cv.addEventListener("pointermove", (e) => {
          if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true;
          if (this.dragNode && down && down.moved) { const [wx, wy] = this.toWorld(e); this.dragNode.x = wx; this.dragNode.y = wy; this.dragNode.pinned = true; this.alpha = Math.max(this.alpha, .25); this.tip.style.display = "none"; return; }
          if (pan) { this.ox = pan.ox + e.clientX - pan.x; this.oy = pan.oy + e.clientY - pan.y; this.draw(); return; }
          const [wx, wy] = this.toWorld(e), n = this.hit(wx, wy); if (n !== this.hover) { this.hover = n; this.draw(); this.showTip(n, e); } else if (n) this.moveTip(e);
          cv.style.cursor = n ? "pointer" : "grab";
        });
        cv.addEventListener("pointerup", () => { if (down && !down.moved && down.n) { if (this.dragNode) { this.dragNode = null; } this.openNode(down.n); } if (this.dragNode) { this.dragNode = null; this.saveLayout(); } this.dragging = false; pan = null; down = null; cv.style.cursor = "grab"; if (this.g) this.saveLayout(); });
        cv.addEventListener("pointerleave", () => { if (!down) { this.hover = null; this.tip.style.display = "none"; this.draw(); } });
        cv.addEventListener("dblclick", (e) => { const [wx, wy] = this.toWorld(e), n = this.hit(wx, wy); if (n) { n.pinned = false; this.alpha = Math.max(this.alpha, .3); this.loop(); this.saveLayout(); } });
        cv.addEventListener("wheel", (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, k = Math.exp(-e.deltaY * .0015), ns = Math.max(.03, Math.min(10, this.scale * k)); this.ox = mx - (mx - this.ox) * (ns / this.scale); this.oy = my - (my - this.oy) * (ns / this.scale); this.scale = ns; this.draw(); }, { passive: false });
      }
      showTip(n, e) { if (!n) { this.tip.style.display = "none"; return; } const t = this.tip; t.textContent = ""; const b = document.createElement("b"); b.textContent = n.label; t.appendChild(b); const add = (s) => { const x = document.createElement("span"); x.textContent = s; t.appendChild(x); };
        if (n.kind === "dir") add("Каталог · " + n.deg + " связей"); else if (n.kind === "file") { add(n.path); add(n.lang + " · " + n.loc + " строк · связей: " + n.deg); } else { add(n.path + ":" + n.line); add((n.sym === "class" ? "Класс/тип" : n.sym === "method" ? "Метод" : "Функция") + " · связей: " + n.deg); }
        t.style.display = "block"; this.moveTip(e); }
      moveTip(e) { const r = this.body.getBoundingClientRect(); this.tip.style.left = Math.min(r.width - 200, e.clientX - r.left + 14) + "px"; this.tip.style.top = Math.min(r.height - 60, e.clientY - r.top + 14) + "px"; }
      openNode(n) {
        if (n.kind === "dir") return; const W = window.__bsWorkspace;
        if (W && W.active && W.active() && W.root() === this.rootPath) { W.openFile({ path: n.path, abs: n.abs, name: path.basename(n.path), isDir: false }, true); return; }
        const f = app.vault.getAbstractFileByPath(n.path); const go = async () => { const leaf = app.workspace.getLeaf("tab"); if (f) await leaf.openFile(f); else if (window.__bsTextFile) await window.__bsTextFile.open(n.path);
          if (n.line) setTimeout(() => { const l = app.workspace.getLeavesOfType("basalt-textfile").find((x) => x.view && x.view.path === n.path); const cm = l && l.view.cm; if (cm) { cm.setCursor({ line: n.line - 1, ch: 0 }); cm.scrollIntoView({ line: n.line - 1, ch: 0 }, 160); cm.focus(); } }, 500); }; go();
      }
      async onClose() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; if (this.ro) this.ro.disconnect(); this.g = null; }
    };
  }

  async function openGraph(mode) {
    const ws = app.workspace; const same = ws.getLeavesOfType(VIEW).find((l) => l.view && l.view.mode === mode);
    if (same) { ws.revealLeaf(same); ws.setActiveLeaf(same, { focus: true }); return; }
    const leaf = ws.getLeaf("tab"); await leaf.setViewState({ type: VIEW, active: true, state: { mode } }); ws.setActiveLeaf(leaf, { focus: true });
  }

  const t = setInterval(() => {
    if (!window.app || !app.workspace || !app.viewRegistry || !app.commands || !window.__bsApi || !window.__bsApi.ItemView) return;
    clearInterval(t);
    const V = makeView(window.__bsApi), creator = (leaf) => new V(leaf);
    try { app.viewRegistry.registerView(VIEW, creator); } catch (e) { app.viewRegistry.viewByType[VIEW] = creator; }
    app.commands.addCommand({ id: "basalt:graph-files", name: "Граф файлов", icon: "lucide-git-fork", callback: () => openGraph("files") });
    app.commands.addCommand({ id: "basalt:graph-code", name: "Граф кода", icon: "lucide-network", callback: () => openGraph("code") });
    window.__bsGraphs = { open: openGraph, build: buildGraph, parse };
  }, 500);
})();
