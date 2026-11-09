// Basalt code graphs: "Граф файлов" (directories, files, imports between files) and "Граф кода" (functions / classes and the calls between
// them) for the open folder (or the vault). Plain-text parsing per language, force layout on a 2D canvas, pan / zoom / drag / pin, search,
// click opens the file. Positions are remembered in <root>/.basalt/graph-layout.json.
(() => {
  "use strict";
  const VIEW = "basalt-codegraph";
  const fs = window.require("fs"), path = window.require("path");
  const SKIP = new Set(["node_modules", "target", "dist", "build", "out", "__pycache__", "venv", ".venv", "vendor", "coverage", "bin", "obj", "Pods", "site-packages", "third_party"]);
  const LIMIT_FILES = 6000, MAX_BYTES = 400 * 1024, MAX_SYMS = 12000;
  const LANG = {
    js: ["JavaScript", "#f1e05a"], jsx: ["JavaScript", "#f1e05a"], mjs: ["JavaScript", "#f1e05a"], cjs: ["JavaScript", "#f1e05a"], ts: ["TypeScript", "#3178c6"], tsx: ["TypeScript", "#3178c6"],
    py: ["Python", "#3572A5"], rs: ["Rust", "#dea584"], go: ["Go", "#00ADD8"], java: ["Java", "#b07219"], kt: ["Kotlin", "#A97BFF"], cs: ["C#", "#178600"],
    c: ["C", "#aaaaaa"], h: ["C", "#aaaaaa"], cpp: ["C++", "#f34b7d"], hpp: ["C++", "#f34b7d"], cc: ["C++", "#f34b7d"], swift: ["Swift", "#F05138"], rb: ["Ruby", "#cc342d"],
    php: ["PHP", "#8892bf"], dart: ["Dart", "#00B4AB"], lua: ["Lua", "#5a5aff"], sh: ["Shell", "#89e051"], css: ["CSS", "#7a5cc7"], html: ["HTML", "#e34c26"],
  };
  const FILECOL = { txt: "#9aa0a6", md: "#519aba", mdx: "#519aba", json: "#cbcb41", yaml: "#e06c75", yml: "#e06c75", toml: "#c9733a", lock: "#7a7a7a", png: "#a074c4", jpg: "#a074c4", jpeg: "#a074c4", gif: "#a074c4", webp: "#a074c4", ico: "#a074c4", svg: "#ffb13b", pdf: "#e44d4d", zip: "#b58900", gz: "#b58900", tar: "#b58900", exe: "#6d8086", dll: "#6d8086", so: "#6d8086", bat: "#89e051", cmd: "#89e051", ps1: "#4d8fd1", log: "#8a8a8a", csv: "#4caf50", xml: "#e37933", ini: "#8a8a8a", env: "#ecd53f", gradle: "#5aa9a9", properties: "#8a8a8a", sql: "#e38c00", ipynb: "#f37626", dockerfile: "#2496ed", mjs: "#f1e05a" };
  const langOf = (ext) => LANG[ext] || [ext ? ext.toUpperCase() : "Файл", FILECOL[ext] || "#8a8a8a"];
  const P_FOLDER = new Path2D("M0 3 Q0 1.5 1.5 1.5 H6 L8 3.5 H16.5 Q18 3.5 18 5 V14 Q18 15.5 16.5 15.5 H1.5 Q0 15.5 0 14 Z");
  const P_FILE = new Path2D("M2.5 0 H11 L16 5 V16 Q16 17.5 14.5 17.5 H2.5 Q1 17.5 1 16 V1.5 Q1 0 2.5 0 Z");
  const P_FOLD = new Path2D("M11 0 V5 H16");
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
  async function scan(root, prog, all) {
    const files = [];
    async function walk(dir, rel) {
      let ents; try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        if (e.isDirectory()) { if (e.name[0] === "." || SKIP.has(e.name)) continue; await walk(path.join(dir, e.name), rel ? rel + "/" + e.name : e.name); }
        else if (files.length < LIMIT_FILES) { const ext = e.name.includes(".") ? e.name.split(".").pop().toLowerCase() : ""; if (all || (ext && LANG[ext])) files.push({ rel: (rel ? rel + "/" : "") + e.name, abs: path.join(dir, e.name), ext, name: e.name }); }
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
    } else if (ext === "dart") {
      all(/^\s*(?:import|export|part)\s+['"]([^'"]+)['"]/gm, (m) => imps.push(m[1]));
      lines.forEach((l, i) => { let m; if ((m = /^\s*(?:abstract\s+|base\s+|final\s+|sealed\s+|mixin\s+)*(?:class|mixin|enum|extension)\s+(\w+)/.exec(l))) add(m[1], "class", i); else if ((m = /^(?:[\w<>?,\s]+?\s)?(\w+)\s*\([^;]*\)\s*(?:async\*?\s*)?(?:\{|=>)/.exec(l)) && !/^\s/.test(l) && !/^(?:if|for|while|switch|return|else)\b/.test(l)) add(m[1], "fn", i); else if ((m = /^ {2}(?:static\s+|Future<[^>]*>\s+|[\w<>?]+\s+)(\w+)\s*\([^;]*\)\s*(?:async\*?\s*)?(?:\{|=>)/.exec(l))) add(m[1], "method", i); });
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
        if (spec[0] === ".") { const b = norm(dir + "/" + spec); return (f.ext === "dart" ? byRel.get(b) : null) || tryJs(b) || (f.ext === "rb" || f.ext === "php" ? pick([b + ".rb", b + ".php"]) : null); }
        if (f.ext === "dart" && spec.startsWith("package:")) { const rest = spec.slice(8), slash = rest.indexOf("/"), pkg = rest.slice(0, slash), tail = "/lib/" + rest.slice(slash + 1); const list = byBase.get(path.posix.basename(rest)) || []; const hit = list.find((x) => x.rel.endsWith(tail) && x.rel.includes("/" + pkg + "/") ) || list.find((x) => x.rel.endsWith(tail)); return hit || null; }
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
    const files = await scan(root, prog, mode === "files");
    const resolve = makeResolver(files), parsed = new Map();
    let n = 0;
    for (const f of files) {
      try { const st = await fs.promises.stat(f.abs); if (mode === "files") { f.loc = Math.max(1, Math.round(st.size / 40)); f.size = st.size; parsed.set(f, { imps: [], syms: [], lines: [] }); continue; } if (st.size > MAX_BYTES) { f.loc = Math.round(st.size / 40); parsed.set(f, { imps: [], syms: [], lines: [] }); continue; }
        const text = await fs.promises.readFile(f.abs, "utf8"); const p = parse(f, text); f.loc = p.lines.length; parsed.set(f, p); } catch (e) { f.loc = 0; parsed.set(f, { imps: [], syms: [], lines: [] }); }
      if (++n % 40 === 0) { if (prog) prog(files.length, n); await new Promise((r) => setTimeout(r, 0)); }
    }
    const nodes = [], links = [], idx = new Map(), seen = new Set();
    const addNode = (o) => { o.deg = 0; idx.set(o.id, o); nodes.push(o); return o; };
    const addLink = (a, b, kind) => { const k = a.id + ">" + b.id + kind; if (seen.has(k) || a === b) return; seen.add(k); links.push({ a, b, kind }); a.deg++; b.deg++; if (kind === "contains") b.up = a; };
    // directories + files
    const dirNode = (d) => { if (idx.has("d:" + d)) return idx.get("d:" + d); const node = addNode({ id: "d:" + d, kind: "dir", label: d === "" ? path.basename(root) : path.posix.basename(d), path: d, dir: d, loc: 0 }); if (d !== "") addLink(dirNode(path.posix.dirname(d) === "." ? "" : path.posix.dirname(d)), node, "contains"); return node; };
    dirNode("");
    for (const f of files) { const d = path.posix.dirname(f.rel) === "." ? "" : path.posix.dirname(f.rel); const node = addNode({ id: "f:" + f.rel, kind: "file", label: f.name, path: f.rel, abs: f.abs, dir: d, loc: f.loc || 1, ext: f.ext, size: f.size, lang: langOf(f.ext)[0], color: langOf(f.ext)[1], extColor: langOf(f.ext)[1] }); f.node = node; addLink(dirNode(d), node, "contains"); }
    for (const f of files) for (const spec of parsed.get(f).imps) { const t = resolve(f, spec); if (t && t.node) addLink(f.node, t.node, "import"); }
    let symCount = 0; const defs = new Map();
    if (mode === "code") {
      for (const f of files) { const p = parsed.get(f); f.symNodes = []; for (const s of p.syms) { if (symCount >= MAX_SYMS) break; symCount++; const node = addNode({ id: "s:" + f.rel + ":" + s.line + ":" + s.name, kind: "sym", sym: s.kind, label: s.name, path: f.rel, abs: f.abs, line: s.line + 1, dir: f.node.dir, parent: f.node, loc: 0, lang: langOf(f.ext)[0], color: f.node.color }); f.symNodes.push(node); addLink(f.node, node, "contains"); (defs.get(s.name) || defs.set(s.name, []).get(s.name)).push(node); } }
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
    // colour groups: the first two path segments, the biggest groups get distinct hues
    const gc = new Map(); for (const f of files) { const k = f.rel.split("/").slice(0, 2).join("/"); f.group = k.includes("/") ? k : "(корень)"; gc.set(f.group, (gc.get(f.group) || 0) + 1); }
    const ranked = [...gc.entries()].sort((a, b) => b[1] - a[1]), gcol = new Map(); ranked.forEach(([k], i) => gcol.set(k, i < 14 ? "hsl(" + Math.round((i * 137.5) % 360) + ",62%,60%)" : "#8a8a8a"));
    const groups = ranked.slice(0, 14).map(([k, c]) => ({ name: k, n: c, color: gcol.get(k) }));
    for (const f of files) { f.node.color = gcol.get(f.group); f.node.group = f.group; if (f.symNodes) for (const sy of f.symNodes) { sy.color = f.node.color; sy.group = f.group; } }
    // dir sizes
    for (const nd of nodes) if (nd.kind === "file") { let d = idx.get("d:" + nd.dir); while (d) { d.loc += nd.loc; d.nfiles = (d.nfiles || 0) + 1; const up = d.path === "" ? null : (path.posix.dirname(d.path) === "." ? "" : path.posix.dirname(d.path)); d = up === null ? null : idx.get("d:" + up); } }
    for (const l of links) if (l.kind !== "contains") for (const x of [l.a, l.b]) (x.kind === "sym" ? x.parent : x).hasLinks = true;
    return { nodes, links, idx, files: files.length, syms: symCount, groups };
  }

  // ---------- view ----------
  function makeView(api) {
    return class CodeGraphView extends api.ItemView {
      constructor(leaf) { super(leaf); this.mode = "files"; this.g = null; this.scale = 1; this.ox = 0; this.oy = 0; this.alpha = 1; this.hover = null; this.match = null; this.showDirs = true; this.showImports = true; this.expanded = new Set(); this.collapsed = new Set(); this.vnodes = []; this.vlinks = []; this.static = false; try { this.layout = localStorage.getItem("bsg.layout") || "ladder"; } catch (e) { this.layout = "ladder"; } }
      getViewType() { return VIEW; }
      getDisplayText() { return this.mode === "code" ? "Граф кода" : "Граф файлов"; }
      getIcon() { return "lucide-git-fork"; }
      getState() { return { mode: this.mode }; }
      async setState(state, result) { this.mode = "files"; try { this.leaf.updateHeader && this.leaf.updateHeader(); } catch (e) { /* ok */ } return super.setState ? super.setState(state, result) : undefined; }
      root() { const W = window.__bsWorkspace; if (W && W.active && W.active() && W.root()) return W.root(); return app.vault.adapter.basePath; }
      async onOpen() {
        const c = this.contentEl; c.textContent = ""; c.style.padding = "0"; c.style.position = "relative"; c.style.overflow = "hidden";
        const wrap = document.createElement("div"); wrap.className = "bsg"; c.appendChild(wrap);
        const bar = document.createElement("div"); bar.className = "bsg-bar"; wrap.appendChild(bar);
        const seg = document.createElement("div"); seg.className = "bsg-seg"; seg.style.display = "none"; bar.appendChild(seg); this.segBtns = {};
        for (const [k, t] of [["files", "Файлы"], ["code", "Код"]]) { const b = document.createElement("button"); b.textContent = t; b.addEventListener("click", () => { if (this.mode !== k) { this.mode = k; this.syncSeg(); this.load(); try { this.leaf.updateHeader(); } catch (e) { /* ok */ } } }); seg.appendChild(b); this.segBtns[k] = b; }
        const q = document.createElement("input"); q.className = "bsg-search"; q.placeholder = "Найти узел…"; bar.appendChild(q); this.qIn = q;
        q.addEventListener("input", () => this.runSearch()); q.addEventListener("keydown", (e) => { if (e.key === "Enter") this.focusMatch(); });
        const ls = document.createElement("select"); ls.className = "bsg-search"; ls.style.width = "auto"; ls.title = "Вид графа файлов";
        for (const [k, t] of [["tree", "Дерево"], ["ladder", "Лесенка"], ["radial", "Радиальный"], ["force", "Свободный"]]) { const o = document.createElement("option"); o.value = k; o.textContent = t; ls.appendChild(o); }
        ls.value = this.layout; ls.addEventListener("change", () => { this.layout = ls.value; try { localStorage.setItem("bsg.layout", this.layout); } catch (e) { /* ok */ } this.userView = false; this.refit = false; this.applyLayout(false); });
        bar.appendChild(ls); this.layoutSel = ls;
        const btn = (t, title, fn, on) => { const b = document.createElement("button"); b.className = "bsg-btn" + (on ? " on" : ""); b.textContent = t; b.title = title; b.addEventListener("click", () => fn(b)); bar.appendChild(b); return b; };
        this.btnImps = btn("Импорты", "Показывать импорты между файлами", (b) => { this.showImports = !this.showImports; b.classList.toggle("on", this.showImports); this.draw(); }, true);
        this.btnCol = btn("Развернуть всё", "Свернуть / развернуть все папки", () => this.toggleAllDirs());
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
      syncSeg() { for (const k in this.segBtns) this.segBtns[k].classList.toggle("on", k === this.mode); if (this.layoutSel) this.layoutSel.style.display = this.mode === "files" ? "" : "none"; if (this.btnImps) this.btnImps.style.display = this.mode === "code" ? "" : "none"; if (this.btnCol) this.btnCol.style.display = this.mode === "files" ? "" : "none"; if (this.legend) this.legend.style.display = this.mode === "code" ? "" : "none"; }
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
        this.syncSeg();
        const saved = (this.mode === "code" || this.layout === "force") ? await this.loadLayout() : null; let placed = 0;
        const cx = 0, cy = 0, dirs = [...new Set(g.nodes.map((n) => n.dir))]; const ang = new Map(dirs.map((d, i) => [d, (i / dirs.length) * Math.PI * 2]));
        g.nodes.forEach((n, i) => { const s = saved && saved[n.id]; if (s) { n.x = s[0]; n.y = s[1]; n.pinned = !!s[2]; placed++; } else { const a = ang.get(n.dir) + (Math.random() - .5) * .6, r = 60 + Math.sqrt(g.nodes.length) * 14 * (.4 + Math.random() * .6); n.x = cx + Math.cos(a) * r; n.y = cy + Math.sin(a) * r; n.pinned = false; } if (n.kind === "sym" && !(saved && saved[n.id])) { n.x = n.parent.x + (Math.random() - .5) * 30; n.y = n.parent.y + (Math.random() - .5) * 30; } n.vx = n.vy = 0; n.r = n.kind === "dir" ? 6 : n.kind === "file" ? Math.min(15, 3 + Math.sqrt(n.loc) / 4) : Math.min(9, 2.5 + n.deg * .35); });
        this.expanded = new Set(); this.collapsed = new Set(); this.defaultCollapse(); this.rebuildView(); this.alpha = placed > g.nodes.length * .8 ? .05 : 1; this.applyLayout(true); this.fitted = false; this.refit = false; this.userView = false;
        this.fillLegend(); this.updateInfo(); this.runSearch(true); this.loop();
      }
      fillLegend() { this.legend.textContent = ""; for (const gr of this.g.groups) { const sp = document.createElement("span"); const ic = document.createElement("i"); ic.style.background = gr.color; sp.append(ic, gr.name); this.legend.appendChild(sp); } }
      updateInfo() { const g = this.g; this.info.textContent = this.mode === "files" ? g.files + " файлов · " + g.nodes.filter((n) => n.kind === "dir").length + " каталогов" : g.files + " файлов · " + g.links.filter((l) => l.kind === "import").length + " импортов" + (this.mode === "code" ? " · " + g.syms + " символов · " + g.links.filter((l) => l.kind === "call").length + " вызовов · двойной клик по файлу раскрывает символы" : ""); }
      // -- visible graph: in "Код" mode symbols are hidden inside their file until it is expanded (double click); calls are summed per file pair --
      rebuildView() {
        const g = this.g, exp = this.expanded, files = this.mode === "files", col = this.collapsed, hid = (n) => { for (let u = n.up; u; u = u.up) if (col.has(u.id)) return true; return false; },
          vis = (n) => (n.kind === "dir" ? files && !hid(n) : n.kind === "sym" ? exp.has(n.parent.id) : files ? !hid(n) : !!n.hasLinks || exp.has(n.id)), rep = (n) => (vis(n) ? n : n.parent), map = new Map(), links = [];
        this.vnodes = g.nodes.filter(vis);
        for (const l of g.links) {
          if (l.kind === "contains") { if (vis(l.a) && vis(l.b)) links.push(l); continue; }
          const a = rep(l.a), b = rep(l.b); if (a === b) continue; const k = a.id + ">" + b.id + l.kind; let e = map.get(k);
          if (!e) { e = { a, b, kind: l.kind, w: 0 }; map.set(k, e); links.push(e); } e.w++;
        }
        this.vlinks = links; this.byDeg = null; for (const n of this.vnodes) n.vd = 0; for (const l of links) { const w = l.kind === "call" ? Math.min(l.w, 6) : 1; l.a.vd += w; l.b.vd += w; }
        for (const n of this.vnodes) n.r = this.mode === "files" ? 15 : n.kind === "dir" ? 5 : n.kind === "file" ? Math.min(14, 2.5 + Math.sqrt(n.loc) / 5 + Math.sqrt(n.vd) * .5) : Math.min(8, 2.2 + Math.sqrt(n.vd));
        this.byDeg = this.vnodes.slice().sort((a, b) => b.vd * (b.kind === "dir" ? 1.5 : 1) - a.vd * (a.kind === "dir" ? 1.5 : 1));
      }
      defaultCollapse() { this.collapsed.clear(); if (this.mode === "files" && this.g.files > 300) for (const n of this.g.nodes) if (n.kind === "dir" && n.path && n.path.split("/").length >= 2 && n.nfiles) this.collapsed.add(n.id); if (this.btnCol) this.btnCol.textContent = "Развернуть всё"; }
      toggleDir(n) {
        if (this.mode !== "files" || n.kind !== "dir" || !n.nfiles) return;
        if (this.collapsed.has(n.id)) { this.collapsed.delete(n.id); for (const m of this.g.nodes) for (let u = m.up; u; u = u.up) if (u === n) { m.x = n.x; m.y = n.y; break; } } else this.collapsed.add(n.id);
        this.rebuildView(); this.userView = true; this.applyLayout(false); if (this.btnCol) this.btnCol.textContent = this.collapsed.size ? "Развернуть всё" : "Свернуть";
      }
      toggleAllDirs() { if (this.collapsed.size) { this.collapsed.clear(); } else this.defaultCollapse(); for (const m of this.g.nodes) if (m.up && !m.pinned) { m.x = m.up.x; m.y = m.up.y; } this.rebuildView(); this.userView = false; this.refit = false; this.applyLayout(false); if (this.btnCol) this.btnCol.textContent = this.collapsed.size ? "Развернуть всё" : "Свернуть"; }
      labelOf(n) { return n.kind === "dir" && this.collapsed.has(n.id) && n.nfiles ? n.label + " (" + n.nfiles + ")" : n.label; }
      drawIcon(ctx, n, S, lw, hov, bg, txt) {
        const size = 26, px = size * S;
        if (px < 5) { ctx.fillStyle = n.kind === "dir" ? "#dcb67a" : n.extColor; ctx.fillRect(n.x - 3 * lw, n.y - 3 * lw, 6 * lw, 6 * lw); return; }
        const k = size / 18, col = n.kind === "dir" && this.collapsed.has(n.id);
        ctx.save(); ctx.translate(n.x - 9 * k, n.y - 9 * k); ctx.scale(k, k);
        if (n.kind === "dir") { ctx.fillStyle = col ? "#dcb67a" : "#b8965b"; ctx.fill(P_FOLDER); if (px > 14 && col && n.nfiles) { ctx.fillStyle = "#2b2b2b"; ctx.font = "bold 6px sans-serif"; ctx.textAlign = "center"; ctx.fillText(String(n.nfiles > 999 ? "999+" : n.nfiles), 9, 12.8); } }
        else { ctx.globalAlpha *= .94; ctx.fillStyle = n.extColor; ctx.fill(P_FILE); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,.35)"; ctx.stroke(P_FOLD); if (px > 24) { ctx.fillStyle = "#fff"; ctx.font = "bold 5.2px sans-serif"; ctx.textAlign = "center"; ctx.fillText((n.ext || "·").slice(0, 4), 8.5, 13.5); } }
        ctx.restore();
        if (n === hov) { ctx.beginPath(); ctx.arc(n.x, n.y, 17, 0, 7); ctx.lineWidth = 1.6 * lw; ctx.strokeStyle = txt; ctx.stroke(); }
      }
      toggleExpand(n) {
        if (this.mode !== "code" || n.kind !== "file") return; const id = n.id;
        if (this.expanded.has(id)) this.expanded.delete(id); else { this.expanded.add(id); for (const s of this.g.nodes) if (s.parent === n) { s.x = n.x + (Math.random() - .5) * 40; s.y = n.y + (Math.random() - .5) * 40; s.vx = s.vy = 0; } }
        this.rebuildView(); this.alpha = Math.max(this.alpha, .5); this.loop();
      }
      applyLayout(initial) {
        if (this.mode !== "files" || this.layout === "force") { this.static = false; if (!initial) { this.alpha = 1; this.fitted = false; this.loop(); } return; }
        this.static = true; this.computeTree(); this.loop();
      }
      computeTree() {
        const nodes = this.vnodes, kids = new Map(), root = nodes.find((n) => n.id === "d:"); if (!root) return;
        for (const n of nodes) n.tx = undefined;
        for (const l of this.vlinks) if (l.kind === "contains") { let a = kids.get(l.a); if (!a) kids.set(l.a, a = []); a.push(l.b); }
        const cmp = (a, b) => (a.kind === "dir" ? 0 : 1) - (b.kind === "dir" ? 0 : 1) || a.label.localeCompare(b.label);
        for (const arr of kids.values()) arr.sort(cmp);
        const L = this.layout;
        if (L === "ladder") { let row = 0; const walk = (n, d) => { n.tx = d * 36; n.ty = row++ * 34; for (const c of kids.get(n) || []) walk(c, d + 1); }; walk(root, 0); }
        else {
          const leaves = new Map(); let maxD = 1; const cnt = (n, d) => { maxD = Math.max(maxD, d); const k = kids.get(n); if (!k || !k.length) { leaves.set(n, 1); return 1; } let t = 0; for (const c of k) t += cnt(c, d + 1); leaves.set(n, t); return t; }; const total = cnt(root, 0);
          if (L === "tree") { let leaf = 0; const place = (n, d) => { const k = kids.get(n); n.ty = d * 170; if (!k || !k.length) { n.tx = leaf++ * 38; return; } k.forEach((c) => place(c, d + 1)); n.tx = (k[0].tx + k[k.length - 1].tx) / 2; }; place(root, 0); }
          else { const step = Math.max(150, total * 34 / (2 * Math.PI) / maxD); const place = (n, d, a0, a1) => { const am = (a0 + a1) / 2, r = d * step; n.tx = Math.cos(am) * r; n.ty = Math.sin(am) * r; const k = kids.get(n); if (!k) return; let a = a0; for (const c of k) { const span = (a1 - a0) * leaves.get(c) / leaves.get(n); place(c, d + 1, a, a + span); a += span; } }; place(root, 0, 0, Math.PI * 2); }
        }
        for (const n of nodes) if (n.tx === undefined) { n.tx = n.x; n.ty = n.y; }
      }
      tween() { let mv = false; for (const n of this.vnodes) { if (n.tx === undefined) continue; const dx = n.tx - n.x, dy = n.ty - n.y; if (Math.abs(dx) + Math.abs(dy) > 1.5) { n.x += dx * .3; n.y += dy * .3; mv = true; } else { n.x = n.tx; n.y = n.ty; } } return mv; }
      // -- physics --
      loop() { if (this.raf) return; const step = () => { this.raf = 0; if (!this.g) return; if (this.static) { const mv = this.tween(); this.draw(); if (mv || this.dragging) this.raf = requestAnimationFrame(step); else if (!this.userView) this.fit(); return; } if (this.alpha > .012 || this.dragging) { this.tick(); this.draw(); this.raf = requestAnimationFrame(step); } else { this.draw(); this.saveLayout(); } if (!this.fitted && this.alpha < .5 && this.w) { this.fitted = true; this.fit(); } if (!this.userView && this.alpha < .03 && !this.refit) { this.refit = true; this.fit(); } }; this.raf = requestAnimationFrame(step); }
      tick() {
        const nodes = this.vnodes, a = this.alpha, cell = 64, grid = new Map(), key = (x, y) => x * 73856093 ^ y * 19349663;
        for (const n of nodes) { const k = key(Math.floor(n.x / cell), Math.floor(n.y / cell)); let arr = grid.get(k); if (!arr) grid.set(k, arr = []); arr.push(n); n.fx = 0; n.fy = 0; }
        for (const n of nodes) { const cx = Math.floor(n.x / cell), cy = Math.floor(n.y / cell);
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const arr = grid.get(key(cx + dx, cy + dy)); if (!arr) continue; for (let q = 0, qn = Math.min(arr.length, 28); q < qn; q++) { const m = arr[q]; if (m === n) continue; let ex = n.x - m.x, ey = n.y - m.y, d2 = ex * ex + ey * ey; if (d2 > cell * cell * 2.4) continue; if (d2 < .01) { ex = Math.random() - .5; ey = Math.random() - .5; d2 = .25; } const f = (240 + (n.r + m.r) * 14) / d2; n.fx += ex * f; n.fy += ey * f; } } }
        const BIG = 320, cg = new Map(), ck = (x, y) => x * 83492791 ^ y * 28411;
        for (const n of nodes) { const k = ck(Math.floor(n.x / BIG), Math.floor(n.y / BIG)); let c = cg.get(k); if (!c) cg.set(k, c = { x: 0, y: 0, n: 0, cx: Math.floor(n.x / BIG), cy: Math.floor(n.y / BIG) }); c.x += n.x; c.y += n.y; c.n++; }
        for (const c of cg.values()) { c.x /= c.n; c.y /= c.n; }
        if (cg.size > 1) for (const n of nodes) { const bx = Math.floor(n.x / BIG), by = Math.floor(n.y / BIG); for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) { if (!dx && !dy) continue; const c = cg.get(ck(bx + dx, by + dy)); if (!c) continue; const ex = n.x - c.x, ey = n.y - c.y, d2 = ex * ex + ey * ey + 400, inv = 140 * c.n / (d2 * Math.sqrt(d2)); n.fx += ex * inv; n.fy += ey * inv; } }
        for (const l of this.vlinks) { const A = l.a, B = l.b; let ex = B.x - A.x, ey = B.y - A.y; const d = Math.sqrt(ex * ex + ey * ey) || 1; const len = l.kind === "contains" ? (A.kind === "dir" ? 50 : 26) : l.kind === "import" ? 110 : 80 / (1 + Math.log2(l.w || 1) * .3), k = l.kind === "contains" ? .07 : .018; const f = (d - len) * k; ex /= d; ey /= d; A.fx += ex * f; A.fy += ey * f; B.fx -= ex * f; B.fy -= ey * f; }
        for (const n of nodes) { n.fx -= n.x * .0035; n.fy -= n.y * .0035; if (n.pinned || n === this.dragNode) { n.vx = n.vy = 0; continue; } n.vx = (n.vx + n.fx * a) * .8; n.vy = (n.vy + n.fy * a) * .8; const sp = Math.hypot(n.vx, n.vy); if (sp > 30) { n.vx *= 30 / sp; n.vy *= 30 / sp; } n.x += n.vx; n.y += n.vy; }
        this.alpha *= .985;
      }
      relayout() { if (!this.g) return; for (const n of this.g.nodes) { n.pinned = false; n.x += (Math.random() - .5) * 40; n.y += (Math.random() - .5) * 40; } this.alpha = 1; this.fitted = false; this.refit = false; this.userView = false; this.loop(); }
      fit() { const ns = this.vnodes; if (!ns || !ns.length || !this.w) return; const xs = ns.map((n) => n.x).sort((a, b) => a - b), ys = ns.map((n) => n.y).sort((a, b) => a - b), q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * p)))]; const lo = this.static ? 0 : .01, hi = this.static ? .9999 : .99; const x0 = q(xs, lo), x1 = q(xs, hi), y0 = q(ys, lo), y1 = q(ys, hi); const pw = Math.max(1, x1 - x0), ph = Math.max(1, y1 - y0); this.scale = Math.min(4, Math.max(.03, Math.min((this.w - 80) / pw, (this.h - 80) / ph))); this.ox = this.w / 2 - ((x0 + x1) / 2) * this.scale; this.oy = this.h / 2 - ((y0 + y1) / 2) * this.scale; this.draw(); }
      // -- search --
      runSearch(quiet) { const s = this.qIn.value.trim().toLowerCase(); this.match = null; if (s && this.g) { this.match = new Set(); for (const n of this.g.nodes) if (n.label.toLowerCase().includes(s) || (n.kind !== "sym" && n.path.toLowerCase().includes(s))) this.match.add(n); } if (this.mode === "files" && this.match && this.match.size && this.match.size <= 250) { let ch = false; for (const n of this.match) for (let u = n.up; u; u = u.up) if (this.collapsed.delete(u.id)) ch = true; if (ch) { this.rebuildView(); this.userView = true; this.applyLayout(false); return; } } if (!quiet) this.draw(); }
      focusMatch() { if (!this.match || !this.match.size) return; let n = [...this.match].find((m) => this.vnodes.includes(m)) || [...this.match][0]; if (n.kind === "sym" && !this.expanded.has(n.parent.id)) { this.toggleExpand(n.parent); } this.scale = Math.max(this.scale, 1.1); this.userView = true; this.ox = this.w / 2 - n.x * this.scale; this.oy = this.h / 2 - n.y * this.scale; this.draw(); }
      // -- layout storage --
      layoutFile() { return path.join(this.rootPath, ".basalt", "graph-layout.json"); }
      async loadLayout() { try { const j = JSON.parse(await fs.promises.readFile(this.layoutFile(), "utf8")); return j[this.mode] || null; } catch (e) { return null; } }
      saveLayout() { clearTimeout(this.st); this.st = setTimeout(async () => { if (!this.g || !this.rootPath) return; try { let all = {}; try { all = JSON.parse(await fs.promises.readFile(this.layoutFile(), "utf8")); } catch (e) { /* new */ } const m = {}; for (const n of this.g.nodes) m[n.id] = [Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10, n.pinned ? 1 : 0]; all[this.mode] = m; await fs.promises.mkdir(path.dirname(this.layoutFile()), { recursive: true }); await fs.promises.writeFile(this.layoutFile(), JSON.stringify(all)); } catch (e) { /* read-only folder */ } }, 400); }
      // -- drawing --
      cssv(n) { return getComputedStyle(document.body).getPropertyValue(n).trim(); }
      draw() {
        const ctx = this.ctx; if (!ctx || !this.w) return; const d = this.dpr || 1, g = this.g;
        ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, this.w, this.h); if (!g || !this.vnodes) return;
        const bg = this.cssv("--background-primary") || "#1e1e1e", txt = this.cssv("--text-normal") || "#ddd", mut = this.cssv("--text-muted") || "#999", acc = this.cssv("--interactive-accent") || "#7a6cf0";
        ctx.translate(this.ox, this.oy); ctx.scale(this.scale, this.scale);
        const hov = this.hover, S = this.scale, lw = 1 / S, nb = new Set(); if (hov) { nb.add(hov); for (const l of this.vlinks) { if (l.a === hov) nb.add(l.b); else if (l.b === hov) nb.add(l.a); } }
        const focus = hov ? nb : this.match, dim = (n) => focus && !focus.has(n) && !(hov && n === hov);
        const vx0 = -this.ox / S - 30, vy0 = -this.oy / S - 30, vx1 = vx0 + this.w / S + 60, vy1 = vy0 + this.h / S + 60;
        const seen = (l) => { const A = l.a, B = l.b; return !((A.x < vx0 && B.x < vx0) || (A.x > vx1 && B.x > vx1) || (A.y < vy0 && B.y < vy0) || (A.y > vy1 && B.y > vy1)); };
        const curve = (l) => { const A = l.a, B = l.b; if (l.kind === "contains" && this.static && this.layout === "ladder") { ctx.moveTo(A.x, A.y); ctx.lineTo(A.x, B.y); ctx.lineTo(B.x, B.y); return; } if (l.kind === "contains") { ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); return; } const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, dx = B.x - A.x, dy = B.y - A.y; ctx.moveTo(A.x, A.y); ctx.quadraticCurveTo(mx - dy * .12, my + dx * .12, B.x, B.y); };
        const showC = (l) => l.kind !== "contains" || this.showDirs || l.a.kind !== "dir", showI = (l) => l.kind !== "import" || this.showImports || this.mode !== "code";
        const f = focus ? .22 : 1, B = [[], [], [], [], []];
        for (const l of this.vlinks) { if (!seen(l)) continue; if (l.kind === "contains") { if (showC(l)) B[0].push(l); } else if (l.kind === "import") { if (showI(l)) B[1].push(l); } else B[l.w < 3 ? 2 : l.w < 10 ? 3 : 4].push(l); }
        const sty = [[mut, .16 * f, .8], [acc, .4 * f, 1], ["#e0a030", .2 * f, .8], ["#e0a030", .38 * f, 1.3], ["#f0b040", .6 * f, 2]];
        B.forEach((arr, k) => { if (!arr.length) return; ctx.beginPath(); for (const l of arr) curve(l); ctx.globalAlpha = sty[k][1]; ctx.strokeStyle = sty[k][0]; ctx.lineWidth = sty[k][2] * lw; ctx.stroke(); });
        if (focus) { const hl = (l) => (hov ? (l.a === hov || l.b === hov) : (this.match.has(l.a) || this.match.has(l.b))) && showC(l) && showI(l); for (const l of this.vlinks) { if (!hl(l) || !seen(l)) continue; ctx.beginPath(); curve(l); ctx.globalAlpha = .9; ctx.lineWidth = (l.kind === "call" ? 1.2 + Math.min(2, Math.log2(l.w || 1) * .5) : 1.4) * lw; ctx.strokeStyle = l.kind === "call" ? "#f0b040" : l.kind === "import" ? acc : mut; ctx.stroke(); } }
        for (const n of this.vnodes) {
          if (n.x < vx0 || n.x > vx1 || n.y < vy0 || n.y > vy1) continue;
          ctx.globalAlpha = dim(n) ? .12 : 1; ctx.beginPath();
          if (this.mode === "files") { this.drawIcon(ctx, n, S, lw, hov, bg, txt); }
          else if (n.kind === "dir") { ctx.arc(n.x, n.y, n.r, 0, 7); ctx.fillStyle = bg; ctx.fill(); ctx.lineWidth = 1.4 * lw; ctx.strokeStyle = mut; ctx.stroke(); }
          else if (n.kind === "sym") { const sq = n.sym === "class" || n.sym === "type"; if (sq) ctx.rect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2); else ctx.arc(n.x, n.y, n.r, 0, 7); ctx.fillStyle = n.color; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = bg; ctx.stroke(); }
          else { ctx.arc(n.x, n.y, n.r, 0, 7); ctx.fillStyle = n.color; ctx.fill(); if (n.r * S > 3) { ctx.lineWidth = 1.2 * lw; ctx.strokeStyle = bg; ctx.stroke(); } if (n === hov || (this.match && this.match.has(n))) { ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 2 * lw, 0, 7); ctx.lineWidth = 2 * lw; ctx.strokeStyle = txt; ctx.stroke(); } if (this.expanded.has(n.id)) { ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 3 * lw, 0, 7); ctx.setLineDash([3 * lw, 3 * lw]); ctx.lineWidth = lw; ctx.strokeStyle = n.color; ctx.stroke(); ctx.setLineDash([]); } }
          if (n.pinned) { ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 2.5 * lw, 0, 7); ctx.lineWidth = lw; ctx.strokeStyle = txt; ctx.stroke(); }
        }
        // labels: biggest first, none over an already placed one; few at a distance, more when zoomed in
        ctx.globalAlpha = 1; const fs = (this.mode === "files" ? 14 : 11) / S; ctx.font = fs + "px sans-serif"; ctx.textBaseline = "middle"; const placed = [], budget = this.mode === "files" ? 700 : Math.round(14 + S * S * 120);
        const inView = (n) => n.x > vx0 && n.x < vx1 && n.y > vy0 && n.y < vy1;
        const strongSet = (hov || this.match) ? this.vnodes.filter((n) => inView(n) && (n === hov || (hov && nb.has(n)) || (this.match && this.match.has(n)))) : [];
        const order = strongSet.concat(this.byDeg || []);
        let shown = 0, scanned = 0;
        for (const n of order) {
          if (!inView(n)) continue; if (++scanned > 4000 && shown >= budget) break;
          const strong = n === hov || (hov && nb.has(n)) || (this.match && this.match.has(n)); if (!strong && (shown >= budget || dim(n) || (n.kind === "sym" && S < 1.3))) { if (shown >= budget) break; continue; }
          const lab = this.labelOf(n), w = ctx.measureText(lab).width, x = n.x + n.r + 3 / S, y = n.y, box = [x, y - fs / 2, x + w, y + fs / 2];
          if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue; placed.push(box); shown++;
          ctx.lineWidth = 3 / S; ctx.strokeStyle = bg; ctx.strokeText(lab, x, y); ctx.fillStyle = n.kind === "dir" ? mut : txt; ctx.fillText(lab, x, y);
        }
        ctx.globalAlpha = 1;
      }
      // -- interaction --
      toWorld(e) { const r = this.cv.getBoundingClientRect(); return [(e.clientX - r.left - this.ox) / this.scale, (e.clientY - r.top - this.oy) / this.scale]; }
      hit(wx, wy) { const g = this.g; if (!g) return null; let best = null, bd = 1e9; for (const n of this.vnodes) { const d = Math.hypot(n.x - wx, n.y - wy); if (d < n.r + 4 / this.scale && d < bd) { best = n; bd = d; } } return best; }
      bind() {
        const cv = this.cv; let pan = null, down = null;
        cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); const [wx, wy] = this.toWorld(e), n = this.hit(wx, wy); down = { x: e.clientX, y: e.clientY, moved: false, n }; if (n) { this.dragNode = n; this.dragging = true; this.alpha = Math.max(this.alpha, .3); this.loop(); } else pan = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy }; cv.style.cursor = "grabbing"; });
        cv.addEventListener("pointermove", (e) => {
          if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true;
          if (this.dragNode && down && down.moved) { const [wx, wy] = this.toWorld(e); this.dragNode.x = wx; this.dragNode.y = wy; this.dragNode.pinned = true; this.alpha = Math.max(this.alpha, .25); this.tip.style.display = "none"; return; }
          if (pan) { this.userView = true; this.ox = pan.ox + e.clientX - pan.x; this.oy = pan.oy + e.clientY - pan.y; this.draw(); return; }
          const [wx, wy] = this.toWorld(e), n = this.hit(wx, wy); if (n !== this.hover) { this.hover = n; this.draw(); this.showTip(n, e); } else if (n) this.moveTip(e);
          cv.style.cursor = n ? "pointer" : "grab";
        });
        cv.addEventListener("pointerup", () => { if (down && !down.moved && down.n) { if (this.dragNode) { this.dragNode = null; } this.openNode(down.n); } if (this.dragNode) { this.dragNode = null; this.saveLayout(); } this.dragging = false; pan = null; down = null; cv.style.cursor = "grab"; if (this.g) this.saveLayout(); });
        cv.addEventListener("pointerleave", () => { if (!down) { this.hover = null; this.tip.style.display = "none"; this.draw(); } });
        cv.addEventListener("contextmenu", (e) => { e.preventDefault(); const [wx, wy] = this.toWorld(e), n = this.hit(wx, wy); if (!n) return; const M = window.__bsApi && window.__bsApi.Menu; if (!M) return; const m = new M(); const item = (t, ic, fn) => m.addItem((i) => i.setTitle(t).setIcon(ic).onClick(fn));
          if (n.kind === "file") item("Открыть", "lucide-file", () => this.openNode(n)); else if (n.nfiles) item(this.collapsed.has(n.id) ? "Развернуть папку" : "Свернуть папку", "lucide-folder-tree", () => this.toggleDir(n));
          item("Показать в проводнике", "lucide-folder-open", () => { try { window.__bsReveal(n.kind === "dir" ? path.join(this.rootPath, n.path) : n.abs); } catch (er) { /* none */ } });
          item("Копировать путь", "lucide-copy", () => { navigator.clipboard.writeText(n.kind === "dir" ? path.join(this.rootPath, n.path) : n.abs).catch(() => {}); });
          m.showAtMouseEvent(e); });
        cv.addEventListener("dblclick", (e) => { const [wx, wy] = this.toWorld(e), n = this.hit(wx, wy); if (n && this.mode === "code" && n.kind === "file") { this.toggleExpand(n); return; } if (n) { n.pinned = false; this.alpha = Math.max(this.alpha, .3); this.loop(); this.saveLayout(); } });
        cv.addEventListener("wheel", (e) => { e.preventDefault(); this.userView = true; const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, k = Math.exp(-e.deltaY * .0015), ns = Math.max(.03, Math.min(10, this.scale * k)); this.ox = mx - (mx - this.ox) * (ns / this.scale); this.oy = my - (my - this.oy) * (ns / this.scale); this.scale = ns; this.draw(); }, { passive: false });
      }
      showTip(n, e) { if (!n) { this.tip.style.display = "none"; return; } const t = this.tip; t.textContent = ""; const b = document.createElement("b"); b.textContent = n.label; t.appendChild(b); const add = (s) => { const x = document.createElement("span"); x.textContent = s; t.appendChild(x); };
        if (n.kind === "dir") add("Папка · файлов: " + (n.nfiles || 0) + (n.nfiles ? " · клик — " + (this.collapsed.has(n.id) ? "развернуть" : "свернуть") : "")); else if (n.kind === "file") { add(n.path); add(n.lang + (n.size != null ? " · " + (n.size < 1024 ? n.size + " Б" : n.size < 1048576 ? (n.size / 1024).toFixed(1) + " КБ" : (n.size / 1048576).toFixed(1) + " МБ") : " · " + n.loc + " строк")); } else { add(n.path + ":" + n.line); add((n.sym === "class" ? "Класс/тип" : n.sym === "method" ? "Метод" : "Функция") + " · связей: " + n.deg); }
        t.style.display = "block"; this.moveTip(e); }
      moveTip(e) { const r = this.body.getBoundingClientRect(); this.tip.style.left = Math.min(r.width - 200, e.clientX - r.left + 14) + "px"; this.tip.style.top = Math.min(r.height - 60, e.clientY - r.top + 14) + "px"; }
      openNode(n) {
        if (n.kind === "dir") { this.toggleDir(n); return; } const W = window.__bsWorkspace;
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
        window.__bsGraphs = { open: openGraph, build: buildGraph, parse };
  }, 500);
})();
