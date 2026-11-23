// Basalt start screen: replaces the stock "empty tab" (three text links) with a home page:
// search, quick actions, recent files and the vault at a glance.
(() => {
  "use strict";
  const mainLeaf = (newTab) => { const ws = app.workspace; let l = newTab ? null : ws.getMostRecentLeaf(ws.rootSplit); if (!l || l.getRoot() !== ws.rootSplit) l = ws.getLeaf("tab"); return l; }; /* a file opens in the main area, never in a side panel that happens to be focused */

  const css = document.createElement("style");
  css.textContent = `
    .empty-state { position: relative; display: block !important; } .empty-state .empty-state-container { display: none; }
    .bsh { position: absolute; inset: 0; overflow: auto; display: flex; justify-content: center; padding: 7vh 28px 40px; box-sizing: border-box; }
    .bsh-in { width: min(720px, 100%); display: flex; flex-direction: column; gap: 26px; }
    .bsh-brand { display: flex; align-items: center; gap: 16px; }
    .bsh-brand img { height: 52px; width: auto; flex: none; }
    .bsh-brand h1 { margin: 0; font-size: 28px; font-weight: 700; letter-spacing: .02em; line-height: 1.1; }
    .bsh-brand p { margin: 4px 0 0; color: var(--text-faint); font-size: 12.5px; }
    .bsh-search { display: flex; align-items: center; gap: 12px; height: 44px; padding: 0 14px; cursor: var(--bs-cursor-text, text); color: var(--text-faint); background: transparent; border: 1px solid var(--background-modifier-border); border-radius: 5px; transition: border-color .12s ease, background-color .12s ease; }
    .bsh-search:hover { border-color: var(--background-modifier-border-hover); background: var(--background-modifier-hover); }
    .bsh-search svg { width: 16px; height: 16px; flex: none; } .bsh-search span { flex: 1; font-size: 14px; }
    .bsh kbd { font-family: var(--font-monospace); font-size: 11px; padding: 1px 6px; border-radius: 3px; background: transparent; border: 1px solid var(--background-modifier-border); color: var(--text-faint); }
    .bsh-tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .bsh-tile { display: flex; align-items: center; gap: 10px; height: 48px; padding: 0 14px; cursor: var(--bs-cursor-hand, pointer); color: var(--text-normal); background: transparent; border: 1px solid var(--background-modifier-border); border-radius: 5px; transition: border-color .12s ease, background-color .12s ease; }
    .bsh-tile:hover { background: var(--background-modifier-hover); border-color: var(--background-modifier-border-hover); }
    .bsh-tile > div { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; } .bsh-tile b { font-weight: 500; font-size: 13.5px; white-space: nowrap; }
    .bsh-tile .bsh-ti { display: grid; place-items: center; width: 20px; height: 20px; flex: none; color: var(--text-muted); background: none; transition: color .12s ease; } .bsh-tile .bsh-ti svg { width: 18px; height: 18px; padding: 0; background: none; color: inherit; }
    .bsh-tile:hover .bsh-ti { color: var(--interactive-accent); }
    .bsh-keys { display: flex; gap: 3px; margin-left: auto; }
    .bsh h3 { margin: 0 0 6px; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--text-faint); font-weight: 600; border: 0; padding: 0; }
    .bsh-recent { display: flex; flex-direction: column; }
    .bsh-rec { display: flex; align-items: center; gap: 12px; height: 44px; padding: 0 10px; border-radius: 4px; cursor: var(--bs-cursor-hand, pointer); border: 0; }
    .bsh-rec:hover { background: var(--background-modifier-hover); }
    .bsh-rec svg { width: 16px; height: 16px; color: var(--text-faint); flex: none; }
    .bsh-rec > div { flex: 1; min-width: 0; } .bsh-rec b { display: block; font-weight: 500; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bsh-rec small { display: block; color: var(--text-faint); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .bsh-rec time { color: var(--text-faint); font-size: 12px; flex: none; }
    .bsh-start { border: 1px solid var(--background-modifier-border); border-radius: 5px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; } .bsh-start p { margin: 0; color: var(--text-muted); font-size: 13px; line-height: 1.5; } .bsh-start button { align-self: flex-start; }
    .bsh-tile:focus-visible, .bsh-rec:focus-visible, .bsh-search:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 1px; }
    .bsh-foot { display: flex; gap: 18px; color: var(--text-faint); font-size: 12px; padding-top: 4px; }
    .bsh-tile:hover, .bsh-search:hover { transform: none !important; box-shadow: none !important; }
    @media (max-width: 640px) { .bsh-tiles { grid-template-columns: repeat(2, 1fr); } }
  `;
  document.head.appendChild(css);

  const ICON = {
    search: '<path d="M9 4H13L16 7V11L13 14H9L6 11V7Z M15 15L20 20"/>',
    note: '<path d="M5 3H15L19 7V21H5Z M15 3V7H19 M9 13H15 M9 17H13"/>',
    canvas: '<path d="M3 4H11V10H3Z M14 14H21V20H14Z M11 7H17V14"/>',
    term: '<path d="M3 4H21V20H3Z M7 9L11 12L7 15 M13 15H17"/>',
    graph: '<path d="M5 3H9V7H5Z M15 3H19V7H15Z M10 17H14V21H10Z M7 7V11H17V7 M12 11V17"/>',
    file: '<path d="M5 3H15L19 7V21H5Z M15 3V7H19"/>',
    plug: '<path d="M9 2V8 M15 2V8 M6 8H18V12L14 16H10L6 12Z M12 16V22"/>',
    gear: '<path d="M9 3H15L21 9V15L15 21H9L3 15V9Z M9 9H15V15H9Z"/>',
    history: '<path d="M9 3H15L21 9V15L15 21H9L3 15V9Z M12 7V12L15 15"/>',
  };
  const svg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" stroke-linejoin="miter">${ICON[k]}</svg>`;
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const ago = (ms) => { const s = (Date.now() - ms) / 1000; if (s < 90) return "только что"; if (s < 3600) return Math.round(s / 60) + " мин"; if (s < 86400) return Math.round(s / 3600) + " ч"; if (s < 86400 * 30) return Math.round(s / 86400) + " дн"; return new Date(ms).toLocaleDateString(); };
  const cmd = (id) => { try { app.commands.executeCommandById(id); } catch (e) { /* missing */ } };

  function build(state) {
    const host = state.querySelector(".empty-state-container");
    if (!host || state.querySelector(".bsh")) return;
    // only in the editor area: an empty leftover in a side panel gets nothing
    if (state.closest(".mod-left-split, .mod-right-split")) return;
    const leafEl = state.closest(".workspace-leaf-content");
    const leaf = (() => { let f = null; app.workspace.iterateAllLeaves((l) => { if (l.view && l.view.containerEl && leafEl && l.view.containerEl === leafEl) f = l; }); return f; })();
    const files = app.vault.getFiles(), notes = files.filter((f) => f.extension === "md"), canv = files.filter((f) => f.extension === "canvas");
    const recent = (app.workspace.getLastOpenFiles ? app.workspace.getLastOpenFiles() : []).map((p) => app.vault.getAbstractFileByPath(p)).filter((f) => f && f.extension).slice(0, 6);
    const links = Object.values(app.metadataCache.resolvedLinks || {}).reduce((n, o) => n + Object.keys(o).length, 0);
    const el = document.createElement("div"); el.className = "bsh";
    el.innerHTML = `<div class="bsh-in">
      <div class="bsh-brand"><img src="basalt-logo.png" alt=""><div><h1>Basalt</h1><p></p></div></div>
      <div class="bsh-search">${svg("search")}<span>Искать по заметкам и доскам…</span><kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>O</kbd></div>
      <div class="bsh-start"></div>
      <div class="bsh-tiles"></div>
      <div class="bsh-cols"><div><h3>Недавние</h3><div class="bsh-recent"></div></div></div><div class="bsh-foot"></div></div>`;
    el.querySelector("p").textContent = app.vault.getName();
    { const s = el.querySelector(".bsh-search"); s.tabIndex = 0; s.setAttribute("role", "button"); s.title = "Найти заметку или доску по названию и тексту"; s.addEventListener("click", () => cmd("basalt:quick-search")); s.addEventListener("keydown", (e) => { if (e.key === "Enter") cmd("basalt:quick-search"); }); }
    { const st = el.querySelector(".bsh-start"); if (!notes.length && !files.some((f) => f.extension === "board" || f.extension === "canvas")) { st.innerHTML = "<h3>С чего начать</h3><p>Здесь пока пусто. Создайте первую заметку, потом связывайте заметки ссылками: напишите [[название другой заметки]]. Искать можно по Ctrl+Shift+O, а любую команду найти по Ctrl+P.</p>"; const b = document.createElement("button"); b.className = "mod-cta"; b.textContent = "Создать первую заметку"; b.addEventListener("click", () => cmd("file-explorer:new-file")); st.appendChild(b); } else st.remove(); }
    const tiles = [
      ["folder", "Открыть папку", "", () => window.__bsWorkspace ? window.__bsWorkspace.pick() : cmd("basalt:open-folder")],
      ["note", "Новая заметка", "|Ctrl+N", () => cmd("file-explorer:new-file")],
      ["canvas", "Новая доска", "", () => (window.__bsBoard && window.__bsBoard.create ? window.__bsBoard.create() : cmd("canvas:new-file"))],
      ["graph", "Граф", "", () => cmd("graph:open")],
      ["share", "Совместная работа", "", () => { if (window.__bsShare) window.__bsShare.dialog("/"); }],
      ["gear", "Настройки", "", () => cmd("app:open-settings")],
    ];
    const TIPS = { folder: "Открыть любую папку с файлами как проект, не создавая хранилище", note: "Создать пустую заметку", canvas: "Создать доску с карточками и связями", graph: "Показать связи между заметками", share: "Пригласить людей в проект или подключиться по коду", gear: "Тема, редактор, горячие клавиши и другое" };
    const tl = el.querySelector(".bsh-tiles");
    const LI = { folder: "folder-open", note: "file-text", canvas: "layout-dashboard", term: "terminal", graph: "git-fork", share: "users", file: "file-search", history: "history", plug: "plug", gear: "settings" };
    for (const [ic, t, sub, fn] of tiles) { const [desc, keys] = sub.split("|"); const d = document.createElement("div"); d.className = "bsh-tile"; d.innerHTML = `<span class="bsh-ti"></span><div><b>${esc(t)}</b>${desc ? `<br><small>${esc(desc)}</small>` : ""}${keys ? `<span class="bsh-keys">${keys.split("+").map((k) => `<kbd>${esc(k)}</kbd>`).join("")}</span>` : ""}</div>`; try { window.__bsApi.setIcon(d.firstChild, "lucide-" + LI[ic]); } catch (e) { d.firstChild.innerHTML = svg(ic); } d.tabIndex = 0; d.setAttribute("role", "button"); d.title = TIPS[ic] || ""; d.addEventListener("click", fn); d.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } }); tl.appendChild(d); }
    const rl = el.querySelector(".bsh-recent");
    if (!recent.length) rl.innerHTML = '<div class="bsh-rec" style="cursor: var(--bs-cursor-arrow, default)"><div><small>Пока ничего не открывали. Откройте файл слева или создайте заметку.</small></div></div>';
    for (const f of recent) {
      const d = document.createElement("div"); d.className = "bsh-rec";
      d.innerHTML = `${svg(f.extension === "canvas" || f.extension === "board" ? "canvas" : "note")}<div><b>${esc(f.basename || f.name)}</b><small>${esc(f.parent && f.parent.path && f.parent.path !== "/" ? f.parent.path : "корень")}</small></div><time>${f.stat ? ago(f.stat.mtime) : ""}</time>`;
      d.tabIndex = 0; d.setAttribute("role", "button"); d.title = "Открыть " + (f.path || f.name); d.addEventListener("click", () => { (leaf || mainLeaf(false)).openFile(f); }); d.addEventListener("keydown", (e) => { if (e.key === "Enter") (leaf || mainLeaf(false)).openFile(f); });
      rl.appendChild(d);
    }
    { const ft = el.querySelector(".bsh-foot"), boards = files.filter((f) => f.extension === "board").length; for (const t of [notes.length + " заметок", boards + " досок", links + " связей"]) ft.createSpan({ text: t }); }
    state.appendChild(el);
  }

  const scan = () => {
    document.querySelectorAll('.workspace-leaf-content[data-type="empty"] .view-header-title').forEach((t) => { if (t.textContent === "New tab" && window.__bsLang === "ru") t.textContent = "Новая вкладка"; }); if (!window.app || !app.workspace || !app.vault) return; document.querySelectorAll(".empty-state").forEach((s) => { try { build(s); } catch (e) { console.error("[basalt-home]", e); } }); };
  new MutationObserver(() => scan()).observe(document.body, { childList: true, subtree: true });
  setTimeout(scan, 1500);
  // the app opens on the start tab
  const t = setInterval(() => {
    if (!window.app || !app.workspace || !app.workspace.layoutReady) return;
    clearInterval(t);
    try {
      let has = null; app.workspace.iterateAllLeaves((l) => { if (!has && l.view && l.view.getViewType && l.view.getViewType() === "empty") has = l; });
      const leaf = has || app.workspace.getLeaf("tab");
      if (!has) leaf.setViewState({ type: "empty" });
      app.workspace.setActiveLeaf(leaf, { focus: false });
    } catch (e) { console.error("[basalt-home]", e); }
  }, 400);
})();
