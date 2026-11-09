// Basalt text files: every text file (yaml, json, bat, source code, logs, no extension...) opens in a tab here, with syntax
// colours, search/replace, folding, bracket matching, comment toggling and a status bar, instead of being handed to another
// application. Binary files and huge files still go to the system as before.
(() => {
  "use strict";
  const VIEW = "basalt-textfile";
  const MAX = 5 * 1024 * 1024;
  const store = {
    get(k, d) { try { const v = localStorage.getItem("bstf." + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("bstf." + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const css = document.createElement("style");
  css.textContent = `
    .bstf { position: absolute; inset: 0; display: flex; flex-direction: column; }
    .bstf .CodeMirror { flex: 1; min-height: 0; height: 100%; background: transparent; color: var(--text-normal); font-family: var(--font-monospace); font-size: var(--bstf-size, 14px); line-height: 1.55; }
    .bstf .CodeMirror-gutters { background: transparent; border-right: 1px solid var(--background-modifier-border); }
    .bstf .CodeMirror-linenumber { color: var(--text-faint); }
    .bstf .CodeMirror-cursor { border-left-color: var(--text-normal); }
    .bstf .CodeMirror-selected, .bstf .CodeMirror-focused .CodeMirror-selected { background: var(--text-selection, rgba(120,120,255,.3)); }
    .bstf .CodeMirror-activeline-background { background: var(--background-modifier-hover); }
    .bstf .CodeMirror-activeline .CodeMirror-linenumber { color: var(--text-normal); }
    .bstf-bar { display: flex; align-items: center; gap: 8px; padding: 4px 12px; font-size: var(--font-ui-smaller); color: var(--text-faint); border-bottom: 1px solid var(--background-modifier-border); }
    .bstf-bar .bstf-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bstf-bar .bstf-state { margin-left: auto; white-space: nowrap; }
    .bstf-btn { display: inline-flex; align-items: center; justify-content: center; min-width: 24px; height: 22px; padding: 0 6px; border-radius: 5px; color: var(--text-muted); cursor: pointer; border: 1px solid transparent; background: transparent; font: inherit; font-size: var(--font-ui-smaller); }
    .bstf-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
    .bstf-btn.on { background: var(--background-modifier-hover); border-color: var(--background-modifier-border); color: var(--text-normal); }
    .bstf-find { display: none; flex-direction: column; gap: 4px; padding: 6px 12px; border-bottom: 1px solid var(--background-modifier-border); background: var(--background-secondary); }
    .bstf-find.open { display: flex; }
    .bstf-row { display: flex; align-items: center; gap: 6px; }
    .bstf-row.rep { display: none; }
    .bstf-find.replace .bstf-row.rep { display: flex; }
    .bstf-in { flex: 1; min-width: 80px; max-width: 360px; height: 24px; padding: 0 8px; border-radius: 5px; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); font: inherit; font-size: var(--font-ui-small); }
    .bstf-in.bad { border-color: var(--text-error); }
    .bstf-count { min-width: 64px; color: var(--text-faint); font-size: var(--font-ui-smaller); text-align: center; white-space: nowrap; }
    .bstf-status { display: flex; align-items: center; gap: 14px; padding: 2px 12px; font-size: var(--font-ui-smaller); color: var(--text-faint); border-top: 1px solid var(--background-modifier-border); user-select: none; }
    .bstf-status .sp { margin-left: auto; }
    .bstf-status span[data-act] { cursor: pointer; } .bstf-status span[data-act]:hover { color: var(--text-normal); }
    .bstf-msg { padding: 24px; color: var(--text-muted); }
    .bstf-match { background: rgba(255,200,0,.28); border-radius: 2px; }
    .bstf-cur { background: rgba(255,150,0,.55); border-radius: 2px; outline: 1px solid rgba(255,150,0,.9); }
    .bstf .CodeMirror-matchingbracket { color: var(--text-normal) !important; background: rgba(120,200,255,.28); border-radius: 2px; }
    .bstf .CodeMirror-nonmatchingbracket { color: var(--text-error) !important; }
    .bstf .CodeMirror-foldgutter { width: 14px; } .bstf .CodeMirror-foldgutter-open, .bstf .CodeMirror-foldgutter-folded { cursor: pointer; color: var(--text-faint); text-align: center; }
    .bstf .CodeMirror-foldgutter-open:after { content: "\\25BE"; } .bstf .CodeMirror-foldgutter-folded:after { content: "\\25B8"; color: var(--text-accent); }
    .bstf .CodeMirror-foldgutter-open { opacity: 0; transition: opacity .12s; } .bstf .CodeMirror-gutters:hover .CodeMirror-foldgutter-open { opacity: 1; }
    .bstf .CodeMirror-foldmarker { color: var(--text-accent); background: var(--background-modifier-hover); border-radius: 3px; padding: 0 4px; cursor: pointer; font-family: inherit; text-shadow: none; }
    .bstf .CodeMirror { position: relative; overflow: hidden; direction: ltr; }
    .bstf .CodeMirror-scroll { overflow: scroll !important; margin-bottom: -50px; margin-right: -50px; padding-bottom: 50px; height: 100%; outline: none; position: relative; }
    .bstf .CodeMirror-sizer { position: relative; border-right: 50px solid transparent; }
    .bstf .CodeMirror-vscrollbar, .bstf .CodeMirror-hscrollbar, .bstf .CodeMirror-scrollbar-filler, .bstf .CodeMirror-gutter-filler { position: absolute; z-index: 6; display: none; outline: none; }
    .bstf .CodeMirror-vscrollbar { right: 0; top: 0; overflow-x: hidden; overflow-y: scroll; }
    .bstf .CodeMirror-hscrollbar { bottom: 0; left: 0; overflow-y: hidden; overflow-x: scroll; }
    .bstf .CodeMirror-scrollbar-filler { right: 0; bottom: 0; } .bstf .CodeMirror-gutter-filler { left: 0; bottom: 0; }
    .bstf .CodeMirror-gutters { position: absolute; left: 0; top: 0; min-height: 100%; z-index: 3; }
    .bstf .CodeMirror-gutter { white-space: normal; height: 100%; display: inline-block; vertical-align: top; margin-bottom: -50px; }
    .bstf .CodeMirror-gutter-wrapper { position: absolute; z-index: 4; background: none !important; border: none !important; }
    .bstf .CodeMirror-gutter-background { position: absolute; top: 0; bottom: 0; z-index: 4; }
    .bstf .CodeMirror-gutter-elt { position: absolute; cursor: default; z-index: 4; }
    .bstf .CodeMirror-lines { cursor: text; min-height: 1px; padding: 4px 0; }
    .bstf .CodeMirror pre.CodeMirror-line, .bstf .CodeMirror pre.CodeMirror-line-like { border-radius: 0; border-width: 0; background: transparent; font-family: inherit; font-size: inherit; margin: 0; white-space: pre; word-wrap: normal; line-height: inherit; color: inherit; z-index: 2; position: relative; overflow: visible; padding: 0 6px; }
    .bstf .CodeMirror-wrap pre.CodeMirror-line, .bstf .CodeMirror-wrap pre.CodeMirror-line-like { word-wrap: break-word; white-space: pre-wrap; word-break: normal; }
    .bstf .CodeMirror-code { outline: none; }
    .bstf .CodeMirror-measure { position: absolute; width: 100%; height: 0; overflow: hidden; visibility: hidden; }
    .bstf .CodeMirror-cursor { position: absolute; pointer-events: none; border-left: 1px solid; width: 0; }
    .bstf .CodeMirror-cursors { visibility: hidden; position: relative; z-index: 3; } .bstf .CodeMirror-focused .CodeMirror-cursors { visibility: visible; }
    .bstf .CodeMirror-selected { background: var(--text-selection, rgba(120,120,255,.3)); }
    .bstf .CodeMirror-linebackground { position: absolute; left: 0; right: 0; top: 0; bottom: 0; z-index: 0; }
    .bstf .CodeMirror-linenumber { padding: 0 8px 0 10px; min-width: 20px; text-align: right; white-space: nowrap; }
    .bstf .cm-keyword, .bstf .cm-atom, .bstf .cm-builtin { color: var(--code-keyword, #c678dd); }
    .bstf .cm-number, .bstf .cm-def, .bstf .cm-variable-2, .bstf .cm-variable-3 { color: var(--code-value, #d19a66); }
    .bstf .cm-string, .bstf .cm-string-2, .bstf .cm-meta { color: var(--code-string, #98c379); }
    .bstf .cm-comment { color: var(--code-comment, #7f848e); font-style: italic; }
    .bstf .cm-property, .bstf .cm-attribute, .bstf .cm-qualifier { color: var(--code-property, #61afef); }
    .bstf .cm-tag, .bstf .cm-header { color: var(--code-tag, #e06c75); }
    .bstf .cm-operator, .bstf .cm-bracket { color: var(--code-operator, #56b6c2); }
    .bstf .cm-link { color: var(--text-accent); text-decoration: underline; } .bstf .cm-error { color: var(--text-error); }
  `;
  document.head.appendChild(css);

  const isBinary = (buf) => { const a = new Uint8Array(buf, 0, Math.min(buf.byteLength, 8000)); for (let i = 0; i < a.length; i++) if (a[i] === 0) return true; return false; };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const LINE_COMMENT = { python: "#", shell: "#", yaml: "#", ruby: "#", perl: "#", powershell: "#", toml: "#", properties: "#", dockerfile: "#", r: "#", cmake: "#", nginx: "#", sql: "--", lua: "--", haskell: "--", clike: "//", javascript: "//", go: "//", rust: "//", swift: "//", dart: "//", php: "//", sass: "//", stylus: "//", verilog: "//", d: "//", julia: "#", coffeescript: "#", elixir: "#", erlang: "%", lisp: ";", clojure: ";", scheme: ";", vb: "'", mathematica: "(*", ini: ";" };

  // the full set of CodeMirror language modes (js, ts, python, rust, css, html, sql...) is a separate 560 KB file; load it on first use
  let modesP = null;
  const ensureModes = () => modesP || (modesP = new Promise((res) => {
    if (window.CodeMirror && window.CodeMirror.modes && window.CodeMirror.modes.javascript) return res();
    const sc = document.createElement("script"); sc.src = "lib/codemirror/modes.min.js"; sc.onload = () => res(); sc.onerror = () => res(); document.head.appendChild(sc);
  }));

  function makeView(api) {
    return class TextFileView extends api.ItemView {
      constructor(leaf) { super(leaf); this.path = ""; this.dirty = false; this.marks = []; this.matches = []; }
      getViewType() { return VIEW; }
      getDisplayText() { return this.path ? this.path.split("/").pop() : "Файл"; }
      getIcon() { return "lucide-file-code"; }
      getState() { return { file: this.path }; }
      async setState(state, result) {
        if (state && state.file && state.file !== this.path) { await this.flush(); this.path = state.file; await this.load(); }
        try { this.leaf.updateHeader && this.leaf.updateHeader(); } catch (e) { /* header */ }
        return super.setState ? super.setState(state, result) : undefined;
      }
      async onOpen() { this.contentEl.empty && this.contentEl.empty(); this.contentEl.style.padding = "0"; this.contentEl.style.position = "relative"; this.contentEl.style.overflow = "hidden"; }

      async load() {
        const root = this.contentEl; root.textContent = "";
        const wrap = el("div", "bstf"); root.appendChild(wrap); this.wrap = wrap;
        let text = "";
        try { text = await app.vault.adapter.read(this.path); } catch (e) { wrap.appendChild(el("div", "bstf-msg", "Не удалось прочитать файл: " + e.message)); return; }
        this.eol = /\r\n/.test(text) ? "\r\n" : "\n";
        this.lastText = text;

        const bar = el("div", "bstf-bar"); bar.appendChild(el("span", "bstf-path", this.path));
        this.stateEl = el("span", "bstf-state", "Сохранено"); bar.appendChild(this.stateEl);
        const mkBtn = (label, title, fn) => { const b = el("button", "bstf-btn", label); b.title = title; b.addEventListener("click", fn); return b; };
        this.btnFind = mkBtn("Найти", "Найти (Ctrl+F)", () => this.openFind(false));
        this.btnWrap = mkBtn("Перенос", "Переносить длинные строки (Alt+Z)", () => this.setWrap(!this.cm.getOption("lineWrapping")));
        bar.appendChild(this.btnFind); bar.appendChild(this.btnWrap);
        wrap.appendChild(bar);

        const find = this.buildFind(); wrap.appendChild(find);
        const holder = el("div"); holder.style.cssText = "flex:1;min-height:0;display:flex;flex-direction:column;position:relative"; wrap.appendChild(holder);
        const status = el("div", "bstf-status"); this.status = status; wrap.appendChild(status);
        wrap.style.setProperty("--bstf-size", store.get("size", 14) + "px");

        await ensureModes();
        const CM = window.CodeMirror;
        if (!CM) { const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "flex:1;width:100%;background:transparent;color:inherit;border:0;font-family:var(--font-monospace)"; holder.appendChild(ta); this.getText = () => ta.value; ta.addEventListener("input", () => this.touch()); return; }
        let mode = "text/plain", langName = "Текст";
        try { const m = CM.findModeByFileName && CM.findModeByFileName(this.path.split("/").pop()); if (m) { mode = m.mime || m.mode; langName = m.name; } } catch (e) { /* plain */ }
        this.lang = langName;
        const tabs = (text.match(/^\t/gm) || []).length, spaces = (text.match(/^ {2,}/gm) || []).length;
        const useTabs = tabs > spaces;
        const two = (text.match(/^ {2}\S/gm) || []).length, four = (text.match(/^ {4}\S/gm) || []).length;
        const unit = useTabs ? 4 : (four > two * 1.5 ? 4 : 2);
        this.indentLabel = useTabs ? "Табуляция" : "Пробелы: " + unit;
        const self = this;
        const dupLine = (cm) => { const c = cm.getCursor(); if (cm.somethingSelected()) { const s = cm.getSelection(); cm.replaceSelection(s + s, "around"); } else { const l = cm.getLine(c.line); cm.replaceRange(l + "\n", { line: c.line, ch: 0 }); cm.setCursor({ line: c.line + 1, ch: c.ch }); } };
        const delLine = (cm) => { const a = cm.getCursor("from"), b = cm.getCursor("to"); const end = b.line + 1 < cm.lineCount() ? { line: b.line + 1, ch: 0 } : { line: b.line, ch: cm.getLine(b.line).length }; const start = b.line + 1 < cm.lineCount() ? { line: a.line, ch: 0 } : (a.line > 0 ? { line: a.line - 1, ch: cm.getLine(a.line - 1).length } : { line: 0, ch: 0 }); cm.replaceRange("", start, end); };
        const moveLine = (cm, dir) => { const a = cm.getCursor("from"), b = cm.getCursor("to"); const last = b.ch === 0 && b.line > a.line ? b.line - 1 : b.line; if (dir < 0 && a.line === 0) return; if (dir > 0 && last >= cm.lineCount() - 1) return;
          cm.operation(() => { const block = []; for (let i = a.line; i <= last; i++) block.push(cm.getLine(i)); const sa = cm.getCursor("anchor"), sh = cm.getCursor("head");
            if (dir < 0) { const prev = cm.getLine(a.line - 1); cm.replaceRange(block.join("\n") + "\n" + prev, { line: a.line - 1, ch: 0 }, { line: last, ch: cm.getLine(last).length }); }
            else { const next = cm.getLine(last + 1); cm.replaceRange(next + "\n" + block.join("\n"), { line: a.line, ch: 0 }, { line: last + 1, ch: cm.getLine(last + 1).length }); }
            cm.setSelection({ line: sa.line + dir, ch: sa.ch }, { line: sh.line + dir, ch: sh.ch }); }); };
        const toggleComment = (cm) => {
          const a = cm.getCursor("from"), b = cm.getCursor("to"); const last = b.ch === 0 && b.line > a.line ? b.line - 1 : b.line;
          const m = cm.getModeAt(a); let lc = m.lineComment || LINE_COMMENT[m.name] || LINE_COMMENT[cm.getMode().name]; let bs = m.blockCommentStart, be = m.blockCommentEnd;
          if (!lc && !bs) { if (/\.(bat|cmd)$/i.test(self.path)) lc = "REM"; else return; }
          cm.operation(() => {
            const lines = []; for (let i = a.line; i <= last; i++) lines.push(cm.getLine(i));
            const real = lines.filter((l) => l.trim()); if (!real.length) return;
            const tok = lc || bs; const commented = real.every((l) => l.trim().startsWith(tok));
            const minInd = Math.min(...real.map((l) => l.match(/^\s*/)[0].length));
            lines.forEach((l, i) => { if (!l.trim()) return; const ln = a.line + i; const ind = l.match(/^\s*/)[0].length;
              if (commented) { const rest = l.slice(ind); let r = rest.slice(tok.length); if (r.startsWith(" ")) r = r.slice(1); if (!lc && be && r.trimEnd().endsWith(be)) r = r.trimEnd().slice(0, -be.length).trimEnd(); cm.replaceRange(l.slice(0, ind) + r, { line: ln, ch: 0 }, { line: ln, ch: l.length }); }
              else { const nl = l.slice(0, minInd) + tok + " " + l.slice(minInd) + (!lc && be ? " " + be : ""); cm.replaceRange(nl, { line: ln, ch: 0 }, { line: ln, ch: l.length }); } });
          });
        };
        const zoom = (d) => { const s = d === 0 ? 14 : Math.max(9, Math.min(32, store.get("size", 14) + d)); store.set("size", s); wrap.style.setProperty("--bstf-size", s + "px"); this.cm.refresh(); };
        const goLine = (cm) => { const v = prompt("Перейти к строке (1–" + cm.lineCount() + "):", String(cm.getCursor().line + 1)); const n = parseInt(v, 10); if (n >= 1) { cm.setCursor({ line: Math.min(n, cm.lineCount()) - 1, ch: 0 }); cm.scrollIntoView(null, 120); } };
        this.cm = CM(holder, {
          value: text, mode, theme: "obsidian", lineNumbers: true, lineWrapping: store.get("wrap", false), indentUnit: unit, tabSize: unit, indentWithTabs: useTabs,
          styleActiveLine: true, matchBrackets: true, autoCloseBrackets: true, scrollPastEnd: true, smartIndent: true, electricChars: true,
          lineSeparator: this.eol === "\r\n" ? "\r\n" : null, foldGutter: true, gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
          foldOptions: { rangeFinder: CM.fold && CM.fold.auto ? CM.fold.auto : undefined },
          extraKeys: {
            "Ctrl-S": () => this.flush(), "Cmd-S": () => this.flush(),
            "Ctrl-F": () => this.openFind(false), "Cmd-F": () => this.openFind(false), "Ctrl-H": () => this.openFind(true),
            "F3": () => this.step(1), "Shift-F3": () => this.step(-1), "Ctrl-G": goLine,
            "Ctrl-/": toggleComment, "Cmd-/": toggleComment, "Ctrl-D": dupLine, "Shift-Ctrl-K": delLine,
            "Alt-Up": (cm) => moveLine(cm, -1), "Alt-Down": (cm) => moveLine(cm, 1), "Alt-Z": () => this.setWrap(!this.cm.getOption("lineWrapping")),
            "Ctrl-]": (cm) => cm.indentSelection("add"), "Ctrl-[": (cm) => cm.indentSelection("subtract"),
            "Ctrl-=": () => zoom(1), "Ctrl-Minus": () => zoom(-1), "Ctrl-0": () => zoom(0),
            "Ctrl-Alt-[": (cm) => cm.foldCode(cm.getCursor()), "Shift-Ctrl-[": (cm) => cm.foldCode(cm.getCursor()), "Shift-Ctrl-]": (cm) => cm.foldCode(cm.getCursor(), null, "unfold"),
            Tab: (cm) => { if (cm.somethingSelected()) cm.indentSelection("add"); else if (useTabs) cm.replaceSelection("\t", "end"); else cm.replaceSelection(" ".repeat(unit - (cm.getCursor().ch % unit)), "end"); },
            "Shift-Tab": (cm) => cm.indentSelection("subtract"),
          },
        });
        this.getText = () => this.cm.getValue();
        this.cm.on("change", () => { this.touch(); this.scheduleMarks(); });
        this.cm.on("cursorActivity", () => this.updateStatus());
        this.cm.getWrapperElement().addEventListener("wheel", (e) => { if (e.ctrlKey) { e.preventDefault(); zoom(e.deltaY < 0 ? 1 : -1); } }, { passive: false });
        this.btnWrap.classList.toggle("on", !!this.cm.getOption("lineWrapping"));
        this.buildStatus();
        this.updateStatus();
        this.registerEvent(app.vault.on("modify", (f) => this.external(f)));
        setTimeout(() => this.cm && this.cm.refresh(), 50);
      }

      buildStatus() {
        const s = this.status; s.textContent = "";
        this.stPos = el("span"); this.stSel = el("span");
        const sp = el("span", "sp"); const mk = (t) => el("span", null, t);
        s.append(this.stPos, this.stSel, sp, mk(this.indentLabel), mk(this.eol === "\r\n" ? "CRLF" : "LF"), mk("UTF-8"), mk(this.lang));
        const lines = el("span"); this.stLines = lines; s.insertBefore(lines, sp);
        const goto = this.stPos; goto.dataset.act = "goto"; goto.title = "Перейти к строке (Ctrl+G)"; goto.addEventListener("click", () => this.cm.execCommand ? this.cm.options.extraKeys["Ctrl-G"](this.cm) : 0);
      }
      updateStatus() {
        if (!this.cm || !this.stPos) return;
        const c = this.cm.getCursor();
        this.stPos.textContent = "Строка " + (c.line + 1) + ", столбец " + (c.ch + 1);
        const sel = this.cm.getSelection(); this.stSel.textContent = sel ? "Выделено: " + sel.length : "";
        this.stLines.textContent = this.cm.lineCount() + " стр.";
      }
      setWrap(on) { store.set("wrap", on); this.cm.setOption("lineWrapping", on); this.btnWrap.classList.toggle("on", on); this.cm.refresh(); }

      // ---- find / replace ----
      buildFind() {
        const box = el("div", "bstf-find"); this.findBox = box;
        const r1 = el("div", "bstf-row"), r2 = el("div", "bstf-row rep");
        const q = el("input", "bstf-in"); q.placeholder = "Найти"; const rp = el("input", "bstf-in"); rp.placeholder = "Заменить на";
        this.qIn = q; this.rIn = rp; this.optCase = false; this.optRe = false; this.optWord = false;
        const btn = (label, title, fn, cls) => { const b = el("button", "bstf-btn" + (cls ? " " + cls : ""), label); b.title = title; b.addEventListener("click", fn); return b; };
        const tog = (label, title, key) => { const b = btn(label, title, () => { this[key] = !this[key]; b.classList.toggle("on", this[key]); this.refreshMatches(true); }); return b; };
        this.count = el("span", "bstf-count");
        r1.append(q, tog("Аа", "Учитывать регистр", "optCase"), tog(".*", "Регулярное выражение", "optRe"), tog("«слово»", "Слово целиком", "optWord"), btn("↑", "Предыдущее (Shift+F3)", () => this.step(-1)), btn("↓", "Следующее (F3 / Enter)", () => this.step(1)), this.count,
          btn("Заменить…", "Показать замену (Ctrl+H)", () => { box.classList.toggle("replace"); if (box.classList.contains("replace")) rp.focus(); }), btn("✕", "Закрыть (Esc)", () => this.closeFind()));
        r2.append(rp, btn("Заменить", "Заменить текущее", () => this.replaceOne()), btn("Заменить все", "Заменить все совпадения", () => this.replaceAll()));
        box.append(r1, r2);
        q.addEventListener("input", () => this.refreshMatches(true));
        q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); this.step(e.shiftKey ? -1 : 1); } else if (e.key === "Escape") { e.preventDefault(); this.closeFind(); } });
        rp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); this.replaceOne(); } else if (e.key === "Escape") { e.preventDefault(); this.closeFind(); } });
        return box;
      }
      openFind(replace) {
        this.findBox.classList.add("open"); this.btnFind.classList.add("on");
        if (replace) this.findBox.classList.add("replace");
        const sel = this.cm.getSelection(); if (sel && !sel.includes("\n")) this.qIn.value = sel;
        this.qIn.focus(); this.qIn.select(); this.refreshMatches(false);
        this.cm.refresh();
      }
      closeFind() { this.findBox.classList.remove("open"); this.btnFind.classList.remove("on"); this.clearMarks(); this.cm.focus(); this.cm.refresh(); }
      clearMarks() { this.marks.forEach((m) => m.clear()); this.marks = []; if (this.curMark) { this.curMark.clear(); this.curMark = null; } }
      query() {
        const s = this.qIn.value; if (!s) return null;
        let src = this.optRe ? s : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (this.optWord) src = "\\b(?:" + src + ")\\b";
        try { const re = new RegExp(src, this.optCase ? "" : "i"); this.qIn.classList.remove("bad"); return re; } catch (e) { this.qIn.classList.add("bad"); return null; }
      }
      scheduleMarks() { if (!this.findBox || !this.findBox.classList.contains("open")) return; clearTimeout(this.mt); this.mt = setTimeout(() => this.refreshMatches(false), 200); }
      refreshMatches(jump) {
        this.clearMarks(); this.matches = []; const re = this.query();
        if (!re) { this.count.textContent = this.qIn.value ? "—" : ""; return; }
        const cm = this.cm, cur = cm.getSearchCursor(re, { line: 0, ch: 0 });
        cm.operation(() => { let n = 0; while (cur.findNext() && n < 5000) { n++; const f = cur.from(), t = cur.to(); if (f.line === t.line && f.ch === t.ch) { if (t.ch >= cm.getLine(t.line).length && t.line >= cm.lastLine()) break; continue; } this.matches.push({ from: f, to: t }); this.marks.push(cm.markText(f, t, { className: "bstf-match" })); } });
        if (jump) this.step(0); else this.showCount();
      }
      showCount() {
        const n = this.matches.length; if (!this.qIn.value) { this.count.textContent = ""; return; }
        if (!n) { this.count.textContent = "Нет совпадений"; return; }
        const c = this.cm.getCursor("from"); let idx = this.matches.findIndex((m) => m.from.line === c.line && m.from.ch === c.ch);
        this.count.textContent = (idx >= 0 ? idx + 1 : "?") + " из " + n + (n >= 5000 ? "+" : "");
      }
      step(dir) {
        if (!this.matches.length) { if (this.findBox.classList.contains("open")) this.showCount(); else this.openFind(false); return; }
        const cm = this.cm, from = cm.getCursor("from"), to = cm.getCursor("to"); let idx;
        const cmp = (a, b) => a.line - b.line || a.ch - b.ch;
        if (dir > 0) idx = this.matches.findIndex((m) => cmp(m.from, to) >= 0 && !(cmp(m.from, from) === 0 && cmp(m.to, to) === 0 && cm.somethingSelected()) ? true : (cmp(m.from, to) > 0));
        else if (dir < 0) { idx = -1; for (let i = this.matches.length - 1; i >= 0; i--) if (cmp(this.matches[i].from, from) < 0) { idx = i; break; } if (idx < 0) idx = this.matches.length - 1; }
        else idx = Math.max(0, this.matches.findIndex((m) => cmp(m.from, from) >= 0));
        if (idx < 0) idx = 0;
        const m = this.matches[idx]; cm.setSelection(m.from, m.to); cm.scrollIntoView({ from: m.from, to: m.to }, 80);
        if (this.curMark) this.curMark.clear(); this.curMark = cm.markText(m.from, m.to, { className: "bstf-cur" });
        this.count.textContent = (idx + 1) + " из " + this.matches.length + (this.matches.length >= 5000 ? "+" : "");
      }
      expand(re, text, rep) { if (!this.optRe) return rep; try { return text.replace(new RegExp(re.source, re.flags.replace("g", "")), rep); } catch (e) { return rep; } }
      replaceOne() {
        const re = this.query(); if (!re) return; const cm = this.cm, rep = this.rIn.value;
        const f = cm.getCursor("from"), t = cm.getCursor("to"); const hit = this.matches.find((m) => m.from.line === f.line && m.from.ch === f.ch && m.to.line === t.line && m.to.ch === t.ch);
        if (hit) { const old = cm.getRange(f, t); cm.replaceRange(this.expand(re, old, rep), f, t); this.refreshMatches(false); this.step(1); }
        else this.step(1);
      }
      replaceAll() {
        const re = this.query(); if (!re || !this.matches.length) return; const rep = this.rIn.value, cm = this.cm, list = this.matches.slice(), n = list.length;
        cm.operation(() => { for (let i = list.length - 1; i >= 0; i--) { const m = list[i]; cm.replaceRange(this.expand(re, cm.getRange(m.from, m.to), rep), m.from, m.to); } });
        this.refreshMatches(false); this.count.textContent = "Заменено: " + n;
      }

      // ---- saving ----
      touch() {
        this.dirty = true; if (this.stateEl) this.stateEl.textContent = "Не сохранено";
        clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 800);
      }
      async flush() {
        clearTimeout(this.timer);
        if (!this.dirty || !this.getText) return;
        this.dirty = false;
        const text = this.getText();
        try { this.lastText = text; await app.vault.adapter.write(this.path, text); if (this.stateEl) this.stateEl.textContent = "Сохранено"; }
        catch (e) { this.dirty = true; if (this.stateEl) this.stateEl.textContent = "Ошибка сохранения"; console.error("[basalt-textfile]", e); }
      }
      async external(f) {
        if (!f || f.path !== this.path || this.dirty || !this.cm) return;
        try {
          const text = await app.vault.adapter.read(this.path);
          if (text === this.lastText || this.dirty) return;
          this.lastText = text; const cur = this.cm.getCursor(), sc = this.cm.getScrollInfo();
          this.cm.setValue(text); this.dirty = false; if (this.stateEl) this.stateEl.textContent = "Сохранено";
          this.cm.setCursor(cur); this.cm.scrollTo(sc.left, sc.top);
        } catch (e) { /* file gone */ }
      }
      onResize() { try { this.cm && this.cm.refresh(); } catch (e) { /* hidden */ } }
      async onClose() { await this.flush(); }
    };
  }

  async function open(path) {
    const ws = app.workspace;
    const same = ws.getLeavesOfType(VIEW).find((l) => l.view && l.view.path === path);
    if (same) { ws.revealLeaf(same); ws.setActiveLeaf(same, { focus: true }); return true; }
    const leaf = ws.getLeaf("tab");
    await leaf.setViewState({ type: VIEW, active: true, state: { file: path } });
    ws.setActiveLeaf(leaf, { focus: true });
    return true;
  }

  const t = setInterval(() => {
    if (!window.app || !app.workspace || !app.viewRegistry || !app.vault || !app.vault.adapter || !window.__bsApi || !window.__bsApi.ItemView || typeof app.openWithDefaultApp !== "function") return;
    clearInterval(t);
    const V = makeView(window.__bsApi), creator = (leaf) => new V(leaf);
    try { app.viewRegistry.registerView(VIEW, creator); } catch (e) { app.viewRegistry.viewByType[VIEW] = creator; }
    const orig = app.openWithDefaultApp.bind(app);
    app.openWithDefaultApp = async function (path) {
      try {
        const a = app.vault.adapter, st = await a.stat(path);
        if (st && st.type === "file" && st.size <= MAX) {
          const buf = await a.readBinary(path);
          if (!isBinary(buf)) return await open(path);
        }
      } catch (e) { console.error("[basalt-textfile]", e); }
      return orig(path);
    };
    window.__bsTextFile = { open };
  }, 500);
})();
