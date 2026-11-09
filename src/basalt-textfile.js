// Basalt text files: every text file (yaml, json, bat, source code, logs, no extension...) opens in a tab here, with syntax
// colours, instead of being handed to another application. Binary files and huge files still go to the system as before.
(() => {
  "use strict";
  const VIEW = "basalt-textfile";
  const MAX = 5 * 1024 * 1024;
  const css = document.createElement("style");
  css.textContent = `
    .bstf { position: absolute; inset: 0; display: flex; flex-direction: column; }
    .bstf .CodeMirror { flex: 1; min-height: 0; height: 100%; background: transparent; color: var(--text-normal); font-family: var(--font-monospace); font-size: var(--font-text-size, 14px); line-height: 1.55; }
    .bstf .CodeMirror-gutters { background: transparent; border-right: 1px solid var(--background-modifier-border); }
    .bstf .CodeMirror-linenumber { color: var(--text-faint); }
    .bstf .CodeMirror-cursor { border-left-color: var(--text-normal); }
    .bstf .CodeMirror-selected, .bstf .CodeMirror-focused .CodeMirror-selected { background: var(--text-selection, rgba(120,120,255,.3)); }
    .bstf .CodeMirror-activeline-background { background: var(--background-modifier-hover); }
    .bstf-bar { display: flex; align-items: center; gap: 10px; padding: 4px 12px; font-size: var(--font-ui-smaller); color: var(--text-faint); border-bottom: 1px solid var(--background-modifier-border); }
    .bstf-bar .bstf-state { margin-left: auto; }
    .bstf-msg { padding: 24px; color: var(--text-muted); }
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

  function makeView(api) {
    return class TextFileView extends api.ItemView {
      constructor(leaf) { super(leaf); this.path = ""; this.dirty = false; }
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
        const wrap = document.createElement("div"); wrap.className = "bstf"; root.appendChild(wrap);
        let text = "";
        try { text = await app.vault.adapter.read(this.path); } catch (e) { wrap.innerHTML = '<div class="bstf-msg"></div>'; wrap.firstChild.textContent = "Не удалось прочитать файл: " + e.message; return; }
        const bar = document.createElement("div"); bar.className = "bstf-bar"; bar.innerHTML = '<span></span><span class="bstf-state">Сохранено</span>';
        bar.firstChild.textContent = this.path; wrap.appendChild(bar); this.stateEl = bar.querySelector(".bstf-state");
        const CM = window.CodeMirror; const holder = document.createElement("div"); holder.style.cssText = "flex:1;min-height:0;display:flex;flex-direction:column"; wrap.appendChild(holder);
        if (!CM) { const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "flex:1;width:100%;background:transparent;color:inherit;border:0;font-family:var(--font-monospace)"; holder.appendChild(ta); this.getText = () => ta.value; ta.addEventListener("input", () => this.touch()); return; }
        let mode = "text/plain";
        try { const m = CM.findModeByFileName && CM.findModeByFileName(this.path.split("/").pop()); if (m) mode = m.mime || m.mode; } catch (e) { /* plain */ }
        this.cm = CM(holder, { value: text, mode, theme: "obsidian", lineNumbers: true, lineWrapping: false, indentUnit: 2, tabSize: 2, indentWithTabs: false, styleActiveLine: true,
          extraKeys: { "Ctrl-S": () => this.flush(), "Cmd-S": () => this.flush(), Tab: (cm) => { if (cm.somethingSelected()) cm.indentSelection("add"); else cm.replaceSelection("  ", "end"); } } });
        this.getText = () => this.cm.getValue();
        this.cm.on("change", () => this.touch());
        setTimeout(() => this.cm && this.cm.refresh(), 50);
      }
      touch() {
        this.dirty = true; if (this.stateEl) this.stateEl.textContent = "Не сохранено";
        clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 800);
      }
      async flush() {
        clearTimeout(this.timer);
        if (!this.dirty || !this.getText) return;
        this.dirty = false;
        try { await app.vault.adapter.write(this.path, this.getText()); if (this.stateEl) this.stateEl.textContent = "Сохранено"; }
        catch (e) { this.dirty = true; if (this.stateEl) this.stateEl.textContent = "Ошибка сохранения"; console.error("[basalt-textfile]", e); }
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
