// "Выполнение": run a program and watch, live, which file and which function is running now,
// on which line, with the whole call chain, plus call counts and time per function.
// Python: a sys.settrace wrapper (only frames from the project folder) that sends snapshots over a local socket.
(function () {
  const VIEW = "basalt-trace";
  const cp = window.require("child_process"), fs = window.require("fs"), os = window.require("os"), path = window.require("path"), net = window.require("net");
  const WIN = process.platform === "win32";

  const PYTRACE = String.raw`
import sys, os, json, socket, time, runpy, threading
port, root, delay = int(sys.argv[1]), os.path.normcase(os.path.abspath(sys.argv[2])), float(sys.argv[3]) / 1000.0
target = sys.argv[4]; sys.argv = sys.argv[4:]
sock = socket.create_connection(("127.0.0.1", port))
lock = threading.Lock(); counts = {}; stack = []; t0 = time.perf_counter(); last = [0.0]; nev = [0]
def mine(fn):
    fn = os.path.normcase(os.path.abspath(fn)) if fn and not fn.startswith("<") else ""
    return fn if fn.startswith(root) else None
def send(kind="snap", extra=None):
    msg = {"k": kind, "t": round((time.perf_counter() - t0) * 1000, 1), "stack": [[f, fn, ln] for (f, fn, ln, _s) in stack],
           "counts": counts, "ev": nev[0]}
    if extra: msg.update(extra)
    try: sock.sendall((json.dumps(msg) + "\n").encode("utf-8"))
    except Exception: pass
def maybe(force=False):
    now = time.perf_counter()
    if force or delay > 0 or now - last[0] > 0.04:
        last[0] = now; send()
        if delay > 0: time.sleep(delay)
def local(frame, event, arg):
    nev[0] += 1
    if event == "line":
        if stack: f, fn, _ln, s = stack[-1]; stack[-1] = (f, fn, frame.f_lineno, s)
        maybe()
    elif event == "return":
        if stack:
            f, fn, ln, s = stack.pop(); key = f + "|" + fn; c = counts.get(key)
            if c: c[1] = round(c[1] + (time.perf_counter() - s) * 1000, 3)
        maybe()
    return local
def glob(frame, event, arg):
    if event != "call": return None
    f = mine(frame.f_code.co_filename)
    if not f: return None
    fn = getattr(frame.f_code, "co_qualname", frame.f_code.co_name)
    stack.append((f, fn, frame.f_lineno, time.perf_counter()))
    key = f + "|" + fn; c = counts.get(key)
    if c: c[0] += 1
    else: counts[key] = [1, 0.0, frame.f_code.co_firstlineno]
    nev[0] += 1; maybe()
    return local
sys.path.insert(0, os.path.dirname(os.path.abspath(target)))
sys.settrace(glob); threading.settrace(glob)
err = None
try: runpy.run_path(target, run_name="__main__")
except SystemExit: pass
except BaseException as e:
    import traceback; err = "".join(traceback.format_exception(type(e), e, e.__traceback__)); sys.stderr.write(err)
finally:
    sys.settrace(None); stack.clear(); send("done", {"err": err})
    try: sock.close()
    except Exception: pass
`;

  const css = document.createElement("style");
  css.textContent = `
  .bst { position: absolute; inset: 0; display: grid; grid-template-rows: auto 1fr auto; font-size: var(--font-ui-small); color: var(--text-normal); background: var(--background-primary); }
  .bst-bar { display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--background-modifier-border); }
  .bst-bar input { flex: 1; min-width: 120px; font-family: var(--font-monospace); }
  .bst-bar button { display: inline-flex; align-items: center; gap: 6px; }
  .bst-bar .bst-run svg { width: 14px; height: 14px; }
  .bst-state { color: var(--text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .bst-main { display: grid; grid-template-columns: minmax(220px, 26%) 1fr minmax(240px, 28%); min-height: 0; }
  .bst-col { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--background-modifier-border); }
  .bst-col:last-child { border-right: 0; }
  .bst-h { padding: 8px 12px; font-size: var(--font-ui-smaller); color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; display: flex; justify-content: space-between; }
  .bst-scroll { overflow: auto; min-height: 0; flex: 1; }
  .bst-fr { margin: 0 8px 4px; padding: 6px 10px; border-radius: 6px; cursor: pointer; border: 1px solid transparent; }
  .bst-fr:hover { background: var(--background-modifier-hover); }
  .bst-fr .fn { font-family: var(--font-monospace); font-weight: 600; }
  .bst-fr .at { color: var(--text-faint); font-size: var(--font-ui-smaller); }
  .bst-fr.now { border-color: var(--interactive-accent); background: color-mix(in srgb, var(--interactive-accent) 14%, transparent); }
  .bst-fr.now .fn { color: var(--interactive-accent); }
  .bst-file { padding: 8px 14px; font-family: var(--font-monospace); color: var(--text-muted); border-bottom: 1px solid var(--background-modifier-border); display: flex; gap: 6px; align-items: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bst-file b { color: var(--text-normal); }
  .bst-code { font-family: var(--font-monospace); font-size: 12.5px; line-height: 1.55; padding: 6px 0; }
  .bst-ln { display: flex; white-space: pre; padding-right: 12px; }
  .bst-ln i { flex: none; width: 52px; padding-right: 12px; text-align: right; color: var(--text-faint); font-style: normal; user-select: none; }
  .bst-ln.fnr { background: color-mix(in srgb, var(--interactive-accent) 6%, transparent); }
  .bst-ln.cur { background: color-mix(in srgb, var(--interactive-accent) 30%, transparent); box-shadow: inset 3px 0 var(--interactive-accent); }
  .bst-ln.cur i { color: var(--interactive-accent); }
  .bst-tab { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .bst-tab td { padding: 4px 10px; border-bottom: 1px solid var(--background-modifier-border); white-space: nowrap; }
  .bst-tab td:first-child { font-family: var(--font-monospace); overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
  .bst-tab td.n { text-align: right; color: var(--text-muted); }
  .bst-tab tr { cursor: pointer; transition: background .4s; }
  .bst-tab tr.live { background: color-mix(in srgb, var(--interactive-accent) 22%, transparent); transition: none; }
  .bst-tab tr.on td:first-child { color: var(--interactive-accent); }
  .bst-tab .f { color: var(--text-faint); font-size: var(--font-ui-smaller); display: block; }
  .bst-out { max-height: 26%; min-height: 60px; overflow: auto; border-top: 1px solid var(--background-modifier-border); padding: 6px 12px; font-family: var(--font-monospace); font-size: 12px; white-space: pre-wrap; color: var(--text-muted); }
  .bst-out .e { color: var(--text-error); }
  .bst-empty { padding: 14px; color: var(--text-faint); }
  `;
  document.head.appendChild(css);

  function rootDir() { const W = window.__bsWorkspace; if (W && W.active && W.active() && W.root()) return W.root(); return app.vault.adapter.basePath; }
  function findPython() { return WIN ? "python" : "python3"; }

  function makeView(api) {
    return class TraceView extends api.ItemView {
      getViewType() { return VIEW; }
      getDisplayText() { return "Выполнение"; }
      getIcon() { return "lucide-activity"; }
      async onOpen() {
        const c = this.contentEl; c.textContent = ""; c.style.padding = "0"; c.style.position = "relative";
        const w = document.createElement("div"); w.className = "bst"; c.appendChild(w);
        const bar = document.createElement("div"); bar.className = "bst-bar"; w.appendChild(bar);
        this.cmdIn = document.createElement("input"); this.cmdIn.placeholder = "Файл .py и аргументы, например main.py --fast"; this.cmdIn.value = this.guess();
        this.cmdIn.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") this.start(); });
        this.speed = document.createElement("select"); this.speed.className = "dropdown";
        for (const [v, t] of [["0", "Полная скорость"], ["30", "30 мс на шаг"], ["150", "150 мс на шаг"], ["600", "0,6 с на шаг"]]) { const o = document.createElement("option"); o.value = v; o.textContent = t; this.speed.appendChild(o); }
        try { this.speed.value = localStorage.getItem("bst.speed") || "150"; } catch (e) { this.speed.value = "150"; }
        this.speed.addEventListener("change", () => { try { localStorage.setItem("bst.speed", this.speed.value); } catch (e) { /* ok */ } });
        this.btn = document.createElement("button"); this.btn.className = "mod-cta bst-run"; this.btn.addEventListener("click", () => (this.child ? this.stop() : this.start()));
        this.st = document.createElement("span"); this.st.className = "bst-state";
        bar.append(this.cmdIn, this.speed, this.btn, this.st); this.setBtn(false);
        const main = document.createElement("div"); main.className = "bst-main"; w.appendChild(main);
        const col = (title) => { const d = document.createElement("div"); d.className = "bst-col"; const h = document.createElement("div"); h.className = "bst-h"; h.textContent = title; const s = document.createElement("div"); s.className = "bst-scroll"; d.append(h, s); main.appendChild(d); return [s, h, d]; };
        [this.stackEl] = col("Сейчас выполняется");
        const [codeS, codeH, codeD] = col("Код"); this.codeS = codeS; codeH.remove(); this.fileEl = document.createElement("div"); this.fileEl.className = "bst-file"; codeD.insertBefore(this.fileEl, codeS); this.codeEl = document.createElement("div"); this.codeEl.className = "bst-code"; codeS.appendChild(this.codeEl);
        [this.tabEl, this.tabH] = col("Функции");
        this.out = document.createElement("div"); this.out.className = "bst-out"; w.appendChild(this.out);
        this.files = new Map(); this.prevCounts = {}; this.idle();
      }
      guess() { const f = app.workspace.getActiveFile && app.workspace.getActiveFile(); if (f && f.extension === "py") return f.path; try { return localStorage.getItem("bst.cmd") || ""; } catch (e) { return ""; } }
      setBtn(running) { const b = this.btn; b.textContent = ""; const i = document.createElement("span"); try { window.__bsApi.setIcon(i, running ? "lucide-square" : "lucide-play"); } catch (e) { /* ok */ } b.append(i, running ? "Стоп" : "Запустить"); }
      idle() { this.stackEl.innerHTML = '<div class="bst-empty">Запустите программу: здесь будет цепочка вызовов — файл › функция › строка — прямо во время работы.</div>'; this.tabEl.textContent = ""; this.codeEl.textContent = ""; this.fileEl.textContent = ""; }
      log(t, err) { const s = document.createElement("span"); if (err) s.className = "e"; s.textContent = t; this.out.appendChild(s); if (this.out.childNodes.length > 2000) this.out.firstChild.remove(); this.out.scrollTop = this.out.scrollHeight; }
      start() {
        if (this.child) return; const line = this.cmdIn.value.trim(); if (!line) { this.cmdIn.focus(); return; }
        try { localStorage.setItem("bst.cmd", line); } catch (e) { /* ok */ }
        const root = rootDir(), parts = line.match(/"[^"]*"|\S+/g).map((s) => s.replace(/^"|"$/g, "")), target = path.isAbsolute(parts[0]) ? parts[0] : path.join(root, parts[0]);
        if (!/\.py$/i.test(target)) { this.out.textContent = ""; this.log("Пока трассируется Python: укажите файл .py.\n", true); return; }
        const tracer = path.join(os.tmpdir(), "basalt-pytrace.py"); fs.writeFileSync(tracer, PYTRACE);
        this.out.textContent = ""; this.prevCounts = {}; this.files.clear(); this.last = null; this.shownFile = null; this.idle(); this.stackEl.textContent = "";
        const srv = net.createServer((sock) => { let buf = ""; sock.setEncoding("utf8"); sock.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { this.pending = JSON.parse(l); } catch (e) { /* partial */ } } this.kick(); }); sock.on("error", () => {}); });
        srv.listen(0, "127.0.0.1", () => {
          const port = srv.address().port, tRoot = fs.existsSync(path.join(root, parts[0])) || path.isAbsolute(parts[0]) ? root : path.dirname(target);
          let child; try { child = cp.spawn(findPython(), ["-u", tracer, String(port), tRoot, this.speed.value, target, ...parts.slice(1)], { cwd: path.dirname(target), windowsHide: true, env: Object.assign({}, process.env, { PYTHONIOENCODING: "utf-8" }) }); }
          catch (e) { this.log("Не удалось запустить Python: " + e.message + "\n", true); srv.close(); return; }
          this.child = child; this.srv = srv; this.root = tRoot; this.t0 = Date.now(); this.setBtn(true); this.st.textContent = "идёт…";
          child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
          child.stdout.on("data", (d) => this.log(d)); child.stderr.on("data", (d) => this.log(d, true));
          child.on("error", (e) => this.log("Python не найден: " + e.message + "\n", true));
          child.on("exit", (code) => { if (!this.child) return; this.child = null; this.setBtn(false); try { srv.close(); } catch (e) { /* ok */ } this.kick(); setTimeout(() => { this.st.textContent = "завершено, код " + code + " · " + ((Date.now() - this.t0) / 1000).toFixed(1) + " с"; }, 120); });
        });
      }
      stop() { const c = this.child; if (!c) return; try { if (WIN) cp.spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { windowsHide: true }); else c.kill("SIGKILL"); } catch (e) { /* gone */ } }
      kick() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.pending) { const m = this.pending; this.pending = null; this.render(m); } }); }
      rel(f) { const r = path.relative(this.root, f).split(path.sep).join("/"); return r.startsWith("..") ? f : r; }
      text(f) { let t = this.files.get(f); if (t === undefined) { try { t = fs.readFileSync(f, "utf8").split(/\r?\n/); } catch (e) { t = null; } this.files.set(f, t); } return t; }
      render(m) {
        const counts = m.counts || {}, stack = m.stack || []; if (m.k === "done" && this.child) { const ch = this.child; setTimeout(() => { if (this.child === ch) this.stop(); }, 1500); }
        if (this.child) this.st.textContent = (m.t / 1000).toFixed(1) + " с · " + Object.keys(counts).length + " функций";
        // stack: outermost first, the running frame last and lit
        this.stackEl.textContent = "";
        if (!stack.length) { const d = document.createElement("div"); d.className = "bst-empty"; d.textContent = m.k === "done" ? (m.err ? "Программа упала — см. вывод внизу." : "Программа завершилась.") : "…"; this.stackEl.appendChild(d); }
        stack.forEach(([f, fn, ln], i) => { const d = document.createElement("div"); d.className = "bst-fr" + (i === stack.length - 1 ? " now" : ""); d.style.marginLeft = 8 + Math.min(i, 12) * 10 + "px"; const a = document.createElement("div"); a.className = "fn"; a.textContent = fn + "()"; const b = document.createElement("div"); b.className = "at"; b.textContent = this.rel(f) + " : " + ln; d.append(a, b); d.addEventListener("click", () => this.openAt(f, ln)); this.stackEl.appendChild(d); });
        const now = this.stackEl.querySelector(".now"); if (now) now.scrollIntoView({ block: "nearest" });
        if (stack.length) { const [f, fn, ln] = stack[stack.length - 1]; const key = f + "|" + fn; this.showCode(f, fn, ln, counts[key] && counts[key][2]); }
        // functions table, hot ones flash
        const rows = Object.entries(counts).sort((a, b) => b[1][1] - a[1][1] || b[1][0] - a[1][0]).slice(0, 300), cur = stack.length ? stack[stack.length - 1][0] + "|" + stack[stack.length - 1][1] : "";
        const tb = document.createElement("table"); tb.className = "bst-tab";
        for (const [k, [n, ms, first]] of rows) { const [f, fn] = [k.slice(0, k.lastIndexOf("|")), k.slice(k.lastIndexOf("|") + 1)]; const tr = document.createElement("tr"); if ((this.prevCounts[k] || 0) !== n) tr.className = "live"; if (k === cur) tr.classList.add("on"); const td = (t, cl) => { const x = document.createElement("td"); if (cl) x.className = cl; x.textContent = t; tr.appendChild(x); return x; }; const a = td(fn + "()"); const s = document.createElement("span"); s.className = "f"; s.textContent = this.rel(f); a.appendChild(s); td("×" + n, "n"); td(ms < 1 ? ms.toFixed(2) + " мс" : ms < 1000 ? ms.toFixed(0) + " мс" : (ms / 1000).toFixed(2) + " с", "n"); tr.addEventListener("click", () => this.openAt(f, first)); tb.appendChild(tr); }
        this.tabEl.textContent = ""; this.tabEl.appendChild(tb); requestAnimationFrame(() => tb.querySelectorAll("tr.live").forEach((x) => x.classList.remove("live")));
        const pc = {}; for (const k in counts) pc[k] = counts[k][0]; this.prevCounts = pc;
      }
      showCode(f, fn, ln, first) {
        const t = this.text(f); if (!t) return;
        if (this.shownFile !== f) { this.shownFile = f; this.codeEl.textContent = ""; const frag = document.createDocumentFragment(); t.forEach((s, i) => { const d = document.createElement("div"); d.className = "bst-ln"; const n = document.createElement("i"); n.textContent = i + 1; d.append(n, s || " "); frag.appendChild(d); }); this.codeEl.appendChild(frag); this.lnEls = this.codeEl.children; this.curLn = null; this.fnLns = []; }
        this.fileEl.textContent = ""; const p = document.createElement("span"); p.textContent = this.rel(f) + "  ›  "; const b = document.createElement("b"); b.textContent = fn + "()"; const l = document.createElement("span"); l.textContent = "  строка " + ln; this.fileEl.append(p, b, l);
        for (const x of this.fnLns) x.classList.remove("fnr"); this.fnLns = [];
        if (first) { const ind = (s) => s.match(/^\s*/)[0].length, base = ind(t[first - 1] || ""); for (let i = first - 1; i < t.length; i++) { if (i > first - 1 && t[i].trim() && ind(t[i]) <= base && !/^\s*[)\]}#@]/.test(t[i])) break; const e = this.lnEls[i]; if (e) { e.classList.add("fnr"); this.fnLns.push(e); } } }
        if (this.curLn) this.curLn.classList.remove("cur"); const e = this.lnEls[ln - 1]; if (e) { e.classList.add("cur"); this.curLn = e; const r = e.offsetTop, h = this.codeS.clientHeight; if (r < this.codeS.scrollTop + 40 || r > this.codeS.scrollTop + h - 60) this.codeS.scrollTop = r - h / 3; }
      }
      openAt(f, ln) { const r = this.rel(f), af = app.vault.getAbstractFileByPath(r); const go = async () => { const leaf = app.workspace.getLeaf("tab"); if (af) await leaf.openFile(af); else if (window.__bsTextFile) await window.__bsTextFile.open(r); setTimeout(() => { const l = app.workspace.getLeavesOfType("basalt-textfile").find((x) => x.view && x.view.path === r); const cm = l && l.view.cm; if (cm && ln) { cm.setCursor({ line: ln - 1, ch: 0 }); cm.scrollIntoView({ line: ln - 1, ch: 0 }, 160); } }, 500); }; go(); }
      async onClose() { this.stop(); }
    };
  }

  async function openTrace() { const ws = app.workspace, ex = ws.getLeavesOfType(VIEW)[0]; if (ex) { ws.revealLeaf(ex); return ex.view; } const leaf = ws.getLeaf("tab"); await leaf.setViewState({ type: VIEW, active: true }); ws.setActiveLeaf(leaf, { focus: true }); return leaf.view; }
  const t = setInterval(() => {
    if (!window.app || !app.workspace || !app.viewRegistry || !app.commands || !window.__bsApi || !window.__bsApi.ItemView) return;
    clearInterval(t);
    const V = makeView(window.__bsApi), creator = (leaf) => new V(leaf);
    try { app.viewRegistry.registerView(VIEW, creator); } catch (e) { app.viewRegistry.viewByType[VIEW] = creator; }
    app.commands.addCommand({ id: "basalt:trace", name: "Выполнение: смотреть работу программы", icon: "lucide-activity", callback: openTrace });
    window.__bsTrace = { open: openTrace };
  }, 500);
})();
