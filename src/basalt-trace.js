// "Выполнение": run a program and watch, live, which file and which function is running now,
// on which line, with the whole call chain, plus call counts and time per function.
// Python: a sys.settrace wrapper (only frames from the project folder) that sends snapshots over a local socket.
(function () {
  const VIEW = "basalt-trace";
  const cp = window.require("child_process"), fs = window.require("fs"), os = window.require("os"), path = window.require("path"), net = window.require("net");
  const WIN = process.platform === "win32";

  // ---------- DAP (Debug Adapter Protocol) client: one implementation for every language that has an adapter ----------
  class DAP {
    constructor(child) {
      this.child = child; this.seq = 0; this.pend = new Map(); this.ev = {}; this.buf = Buffer.alloc(0); this.dead = false;
      child.stdout.on("data", (d) => { this.buf = Buffer.concat([this.buf, d]); this.pump(); });
      child.on("exit", () => { this.dead = true; for (const [, p] of this.pend) p.rej(new Error("adapter exited")); this.pend.clear(); this.emit("exit", {}); });
    }
    pump() {
      for (;;) {
        const i = this.buf.indexOf("\r\n\r\n"); if (i < 0) return;
        const m = /Content-Length:\s*(\d+)/i.exec(this.buf.slice(0, i).toString()); if (!m) { this.buf = this.buf.slice(i + 4); continue; }
        const n = +m[1]; if (this.buf.length < i + 4 + n) return;
        const body = this.buf.slice(i + 4, i + 4 + n).toString("utf8"); this.buf = this.buf.slice(i + 4 + n);
        let j; try { j = JSON.parse(body); } catch (e) { continue; } this.onMsg(j);
      }
    }
    onMsg(j) {
      if (j.type === "response") { const p = this.pend.get(j.request_seq); if (p) { this.pend.delete(j.request_seq); j.success ? p.res(j.body || {}) : p.rej(new Error(j.message || "error")); } }
      else if (j.type === "event") this.emit(j.event, j.body || {});
      else if (j.type === "request") this.send({ type: "response", request_seq: j.seq, command: j.command, success: true, body: {} });
    }
    emit(n, b) { for (const f of (this.ev[n] || []).slice()) { try { f(b); } catch (e) { console.error("[dap]", e); } } }
    on(n, f) { (this.ev[n] || (this.ev[n] = [])).push(f); }
    off(n, f) { const a = this.ev[n]; if (a) { const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); } }
    send(o) { if (this.dead) return; o.seq = o.seq || ++this.seq; const t = JSON.stringify(o); try { this.child.stdin.write("Content-Length: " + Buffer.byteLength(t) + "\r\n\r\n" + t); } catch (e) { /* closed */ } }
    req(command, args) { return new Promise((res, rej) => { if (this.dead) return rej(new Error("adapter exited")); const seq = ++this.seq; this.pend.set(seq, { res, rej }); this.send({ seq, type: "request", command, arguments: args || {} }); }); }
  }

  // ---------- languages: how to start an adapter and launch the program ----------
  const sh = (cmd, args) => { try { const r = cp.spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 8000 }); return r.status === 0 ? (r.stdout || "").trim() : null; } catch (e) { return null; } };
  const which = (n) => { const r = sh(WIN ? "where" : "which", [n]); return r ? r.split(/\r?\n/)[0] : null; };
  function findDebugpy() {
    const py = which(WIN ? "python" : "python3"); if (!py) return { err: "Не найден Python в PATH." };
    const own = sh(py, ["-c", "import debugpy,os;print(os.path.dirname(os.path.dirname(debugpy.__file__)))"]); if (own) return { py, libs: own };
    try { const ext = path.join(os.homedir(), ".vscode", "extensions"); for (const d of fs.readdirSync(ext).filter((x) => x.startsWith("ms-python.debugpy")).sort().reverse()) { const l = path.join(ext, d, "bundled", "libs"); if (fs.existsSync(path.join(l, "debugpy"))) return { py, libs: l }; } } catch (e) { /* none */ }
    return { err: "Нужен debugpy: pip install debugpy" };
  }
  const LANGS = {
    py: { name: "Python", prep(o) { const d = findDebugpy(); if (d.err) throw new Error(d.err); return { cmd: d.py, args: ["-m", "debugpy.adapter"], env: { PYTHONPATH: d.libs + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : "") }, launch: { type: "python", program: o.target, args: o.args, cwd: o.cwd, python: d.py, justMyCode: true, console: "internalConsole" } }; } },
    dart: { name: "Dart", prep(o) { const d = which("dart"); if (!d) throw new Error("Не найден dart в PATH."); return { cmd: d, args: ["debug_adapter"], shell: WIN, launch: { program: o.target, args: o.args, cwd: o.cwd, debugSdkLibraries: false, debugExternalPackageLibraries: false } }; } },
    native: { name: "Rust / C / C++", prep(o) { let d = which("lldb-dap") || which("lldb-vscode"); if (!d) for (const c of ["C:\\Program Files\\LLVM\\bin\\lldb-dap.exe", "/usr/bin/lldb-dap", "/usr/local/bin/lldb-dap"]) if (fs.existsSync(c)) { d = c; break; } if (!d) throw new Error("Нужен lldb-dap (LLVM)."); return { cmd: d, args: [], launch: { program: o.target, args: o.args, cwd: o.cwd } }; } },
    go: { name: "Go", prep(o) { const d = which("dlv"); if (!d) throw new Error("Для Go нужен Delve: go install github.com/go-delve/delve/cmd/dlv@latest"); return { cmd: d, args: ["dap"], launch: { mode: "debug", program: o.target, args: o.args, cwd: o.cwd } }; } },
  };
  const langOf = (f) => { const e = path.extname(f).toLowerCase(); return e === ".py" ? "py" : e === ".dart" ? "dart" : e === ".go" ? "go" : e === ".exe" || e === "" || e === ".out" ? "native" : null; };

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
        this.cmdIn = document.createElement("input"); this.cmdIn.placeholder = "Файл (.py, .dart, .go, .exe) и аргументы"; this.cmdIn.value = this.guess();
        this.cmdIn.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") this.start(); });
        this.speed = document.createElement("select"); this.speed.className = "dropdown";
        for (const [v, t] of [["live", "Живой режим"], ["30", "Шаг 30 мс"], ["150", "Шаг 150 мс"], ["600", "Шаг 0,6 с"]]) { const o = document.createElement("option"); o.value = v; o.textContent = t; this.speed.appendChild(o); }
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
      async start() {
        if (this.child) return; const line = this.cmdIn.value.trim(); if (!line) { this.cmdIn.focus(); return; }
        try { localStorage.setItem("bst.cmd", line); } catch (e) { /* ok */ }
        const root = rootDir(), parts = line.match(/"[^"]*"|\S+/g).map((s) => s.replace(/^"|"$/g, "")), target = path.isAbsolute(parts[0]) ? parts[0] : path.join(root, parts[0]);
        this.out.textContent = ""; const lk = langOf(target);
        if (!lk) { this.log("Не знаю, как запускать этот файл. Поддерживаются: .py, .dart, .go и готовые программы (.exe), собранные с отладочной информацией.\n", true); return; }
        if (!fs.existsSync(target)) { this.log("Файл не найден: " + target + "\n", true); return; }
        let plan; try { plan = LANGS[lk].prep({ target, args: parts.slice(1), cwd: path.dirname(target) }); } catch (e) { this.log(e.message + "\n", true); return; }
        this.root = root; this.prevCounts = {}; this.files.clear(); this.shownFile = null; this.idle(); this.stackEl.textContent = ""; this.t0 = Date.now(); this.counts = {}; this.prevStack = []; this.setBtn(true); this.st.textContent = "запуск " + LANGS[lk].name + "…";
        let child; try { child = cp.spawn(plan.cmd, plan.args, { cwd: path.dirname(target), windowsHide: true, shell: !!plan.shell, env: Object.assign({}, process.env, plan.env || {}, { PYTHONIOENCODING: "utf-8" }) }); } catch (e) { this.log("Не удалось запустить адаптер: " + e.message + "\n", true); this.setBtn(false); return; }
        this.child = child; const dap = this.dap = new DAP(child); child.stderr.setEncoding("utf8"); child.stderr.on("data", (d) => { if (lk !== "native") this.log(d, true); }); child.on("error", (e) => { this.log("Адаптер не запустился: " + e.message + "\n", true); });
        let done = false; const finish = (why) => { if (done) return; done = true; this.child = null; this.setBtn(false); this.kick(); setTimeout(() => { this.st.textContent = (why || "завершено") + " · " + ((Date.now() - this.t0) / 1000).toFixed(1) + " с"; }, 100); try { child.kill(); } catch (e) { /* gone */ } };
        this.finish = finish;
        dap.on("output", (b) => { if (b.category === "telemetry") return; if (b.category === "console" && lk !== "native") return; this.log(b.output || "", b.category === "stderr"); });
        dap.on("terminated", () => { this.pending = { k: "done", t: Date.now() - this.t0, stack: [], counts: this.counts }; this.kick(); setTimeout(() => finish(), 300); });
        dap.on("exit", () => finish());
        try { await this.session(dap, plan, lk); } catch (e) { if (!done) { this.log("Ошибка отладчика: " + e.message + "\n", true); finish("ошибка"); } }
      }
      sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
      waitEvent(dap, name, ms) { return new Promise((res) => { let t; const end = (b) => { clearTimeout(t); dap.off(name, f); dap.off("terminated", g); res(b); }, f = (b) => end(b), g = () => end(null); dap.on(name, f); dap.on("terminated", g); t = setTimeout(() => end(null), ms); }); }
      async session(dap, plan, lk) {
        const step = this.speed.value !== "live", delay = +this.speed.value || 0;
        await dap.req("initialize", { clientID: "basalt", clientName: "Basalt", adapterID: lk, linesStartAt1: true, columnsStartAt1: true, pathFormat: "path" });
        const inited = this.waitEvent(dap, "initialized", 15000);
        const launchP = dap.req("launch", Object.assign({ stopOnEntry: step, noDebug: false }, plan.launch)); launchP.catch(() => {});
        await Promise.race([inited, launchP]);
        const stopP = step ? this.waitEvent(dap, "stopped", 20000) : null;
        try { await dap.req("setBreakpoints", { source: { path: plan.launch.program }, breakpoints: [] }); } catch (e) { /* ok */ }
        try { await dap.req("configurationDone", {}); } catch (e) { /* some adapters skip it */ }
        await launchP;
        if (step) await this.stepLoop(dap, stopP, delay); else await this.liveLoop(dap);
      }
      inRoot(f) { if (!f) return false; const a = path.resolve(f).toLowerCase(), r = path.resolve(this.root).toLowerCase(); return a.startsWith(r + path.sep) && !/[\\/](node_modules|\.dart_tool|site-packages|\.pub-cache|\.cargo|\.rustup)[\\/]/i.test(a); }
      async snapshot(dap, tid) {
        const r = await dap.req("stackTrace", { threadId: tid, levels: 40 }), fr = (r.stackFrames || []).filter((f) => f.source && this.inRoot(f.source.path));
        return fr.reverse().map((f) => [path.resolve(f.source.path), String(f.name).replace(/\s*\(.*$/, "").replace(/^.*::/, "").replace(/^.*\./, "") || String(f.name), f.line]);
      }
      account(stack, dtMs) {
        const c = this.counts, ps = this.prevStack, key = (f) => f[0] + "|" + f[1];
        for (let i = 0; i < stack.length; i++) { const k = key(stack[i]); if (!c[k]) c[k] = [0, 0, stack[i][2]]; c[k][2] = Math.min(c[k][2], stack[i][2]); if (!(ps[i] && key(ps[i]) === k)) c[k][0]++; }
        if (stack.length) c[key(stack[stack.length - 1])][1] += dtMs; this.prevStack = stack;
      }
      push(stack) { this.pending = { k: "snap", t: Date.now() - this.t0, stack, counts: this.counts }; this.kick(); }
      async stepLoop(dap, stopP, delay) {
        let ev = await stopP, last = Date.now(), n = 0;
        while (ev && this.child && n++ < 200000) {
          const tid = ev.threadId || 1; let stack; try { stack = await this.snapshot(dap, tid); } catch (e) { break; }
          if (!stack.length) { const w = this.waitEvent(dap, "stopped", 20000); try { await dap.req("stepOut", { threadId: tid }); } catch (e) { break; } ev = await w; continue; }
          const now = Date.now(); this.account(stack, now - last); last = now; this.push(stack);
          if (delay) await this.sleep(delay); else if (n % 20 === 0) await this.sleep(1);
          if (!this.child) break; const w = this.waitEvent(dap, "stopped", 20000); try { await dap.req("stepIn", { threadId: tid }); } catch (e) { break; } ev = await w;
        }
        if (this.child) { try { await dap.req("continue", { threadId: 1 }); } catch (e) { /* ended */ } }
      }
      async liveLoop(dap) {
        const iv = 60; let tid = 0;
        while (this.child) {
          await this.sleep(iv); if (!this.child) break;
          try {
            if (!tid) { const t = await dap.req("threads", {}); tid = t.threads && t.threads[0] ? t.threads[0].id : 1; }
            const w = this.waitEvent(dap, "stopped", 800); await dap.req("pause", { threadId: tid }); const ev = await w; if (!ev) continue;
            const stack = await this.snapshot(dap, ev.threadId || tid); this.account(stack, iv); if (stack.length) this.push(stack);
            await dap.req("continue", { threadId: ev.threadId || tid });
          } catch (e) { if (!this.child) break; }
        }
      }
      stop() { const c = this.child; if (!c) return; try { this.dap && this.dap.send({ type: "request", command: "disconnect", arguments: { terminateDebuggee: true } }); } catch (e) { /* ok */ } setTimeout(() => { try { if (this.finish) this.finish("остановлено"); if (WIN) cp.spawn("taskkill", ["/pid", String(c.pid), "/T", "/F"], { windowsHide: true }); else c.kill("SIGKILL"); } catch (e) { /* gone */ } }, 400); }
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
