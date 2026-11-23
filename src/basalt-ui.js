// Basalt: hides only the stock features that need the original vendor's online services (account, licences,
// Catalyst, update checks, Publish, the paid Sync). Everything that works offline (version, help, CLI, ...) stays.
// Also carries the settings-window look. Loaded by every window.
(() => {
  "use strict";

  const ROW_NAMES = new Set([
    "ваш аккаунт", "your account",
    "коммерческая лицензия", "commercial license",
    "лицензия catalyst", "catalyst license",
    "автоматические обновления", "automatic updates",
    "получать ранние сборки", "receive early access versions",
    "доступно обновление", "update available",
    "подключить к basalt sync", "connect to basalt sync",
    "аккаунт", "account",
  ]);
  const SERVICE_TEXT = /basalt (publish|sync)/i;

  const norm = (t) => (t || "").replace(/\s+/g, " ").trim().toLowerCase();
  const hide = (el) => { if (el && el.style.display !== "none") el.style.display = "none"; };

  function sweepSettings(root) {
    for (const item of root.querySelectorAll(".setting-item")) {
      const name = norm((item.querySelector(".setting-item-name") || {}).textContent);
      const desc = (item.querySelector(".setting-item-description") || {}).textContent || "";
      if (ROW_NAMES.has(name)) { hide(item); continue; }
      if (item.closest(".installed-plugins-container, .plugin-list, .vertical-tab-content") && SERVICE_TEXT.test(desc) && !item.closest(".vault-sync-settings")) hide(item);
    }
    for (const h of root.querySelectorAll(".setting-item-heading, .setting-group > .setting-item-heading, h2, h3")) {
      if (ROW_NAMES.has(norm(h.textContent)) && !h.closest(".vault-sync-settings")) hide(h.closest(".setting-group") || h);
    }
    for (const nav of root.querySelectorAll('.vertical-tab-nav-item[data-setting-id="publish"]')) hide(nav);
  }

  // the backlinks counter means something only for a note
  function sweepChrome(root) {
    try { const v = window.app && app.workspace && app.workspace.getActiveViewOfType && app.workspace.activeLeaf && app.workspace.activeLeaf.view; const md = !v || v.getViewType() === "markdown"; for (const el of root.querySelectorAll(".status-bar-item.plugin-backlink")) el.style.display = md ? "" : "none"; } catch (e) { /* not ready */ }
    for (const el of root.querySelectorAll(".status-bar-item.plugin-sync")) hide(el);
    for (const el of root.querySelectorAll(".side-dock-ribbon-action")) {
      if (/publish|публик/i.test(el.getAttribute("aria-label") || "")) hide(el);
    }
  }

  function sweep() {
    const root = document.body;
    if (!root) return;
    sweepSettings(root);
    sweepChrome(root);
  }

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; sweep(); });
  };
  const start = () => {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    sweep();
  };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);

  // commands that belong to the services above disappear from the palette and hotkeys
  let tries = 0;
  const t = setInterval(() => {
    tries += 1;
    const a = window.app;
    if (a && a.commands && a.commands.listCommands) {
      for (const c of a.commands.listCommands()) if (/^(publish|sync):/.test(c.id)) a.commands.removeCommand(c.id);
      if (tries > 20) clearInterval(t);
    }
    if (tries > 60) clearInterval(t);
  }, 1500);


  // ---- Basalt look for the whole app: warm basalt palette + cut corners (same language as the card shapes).
  // Everything is a variable override or a small shape rule; a user theme / CSS snippet still wins over it.
  const APP_CSS = `
    .modal-close-button:empty { position: absolute; top: var(--size-4-3); right: var(--size-4-3); width: var(--size-4-8); height: var(--size-4-8); cursor: var(--bs-cursor-hand, pointer); z-index: 3; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); clip-path: none; transition: background var(--bs-dur-fast) var(--bs-ease-standard), border-color var(--bs-dur-fast) var(--bs-ease-standard); }
    .modal-close-button:empty::before { content: ""; position: absolute; inset: 0; background: var(--text-muted); -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M11 11l10 10M21 11L11 21' stroke='black' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E") center / 100% no-repeat; transition: background var(--bs-dur-fast) var(--bs-ease-standard); }
    .modal-close-button:empty::after { content: none; }
    .modal-close-button:empty:hover { background: var(--interactive-accent); border-color: var(--interactive-accent); } .modal-close-button:empty:hover::before { background: var(--text-on-accent, #fff); }
    body.theme-light {
      --background-primary: #eee7db; --background-primary-alt: #e5ddcf; --background-secondary: #dcd2c3; --background-secondary-alt: #d1c6b5;
      --background-modifier-hover: rgba(107,68,41,.09); --background-modifier-border: #c3b4a0; --background-modifier-border-hover: #b3a18a; --background-modifier-active-hover: rgba(107,68,41,.16);
      --divider-color: #c3b4a0; --text-normal: #2a211a; --text-muted: #5c4f42; --text-faint: #655847;
      --titlebar-background: #dcd2c3; --titlebar-background-focused: #d1c6b5; --tab-container-background: #dcd2c3; --ribbon-background: #dcd2c3; --modal-background: #eee7db;
    }
    body.theme-dark {
      --background-primary: #17130f; --background-primary-alt: #1b1612; --background-secondary: #0f0c0a; --background-secondary-alt: #0c0a09;
      --background-modifier-hover: rgba(176,122,82,.12); --background-modifier-border: #3a2f26; --background-modifier-border-hover: #4a3c30; --background-modifier-active-hover: rgba(176,122,82,.22);
      --divider-color: #2f261f; --text-normal: #ece4db; --text-muted: #a79a8d; --text-faint: #8f8072;
      --titlebar-background: #0c0a09; --titlebar-background-focused: #14110f; --tab-container-background: #0c0a09; --ribbon-background: #0c0a09; --modal-background: #1b1612;
    }
    /* the shape language of Basalt, for every module: panels, cards and pop-ups are cut at two corners (--bs-clip), small controls and list rows have --bs-r */
    body { --bs-clip: none; --bs-r: var(--radius-m); --bs-gap: var(--size-4-2); --bs-pad: var(--size-4-3); --bs-ease: var(--bs-dur-fast); }
    body { --bs-c: var(--bs-cut-md); --radius-s: 4px; --radius-m: 5px; --radius-l: 6px; --radius-xl: 6px; --button-radius: 5px; --input-radius: 5px; --checkbox-radius: 3px; }
    .modal:not(.mod-settings), .prompt, .menu, .suggestion-container, .popover, .notice {
      clip-path: none;
    }
    .modal:not(.mod-settings), .prompt, .menu, .suggestion-container, .popover, .notice { border-radius: 6px; }
    .menu-item, .suggestion-item { border-radius: 5px; }
    .status-bar { border-radius: 0; }
    .canvas-control-group, .canvas-card-menu, .canvas-menu-container .menu-container { border-radius: 6px; box-shadow: none; clip-path: var(--bs-clip); }
    .canvas-control-group { background: var(--background-secondary); }
    .canvas-card-menu { --icon-size: 18px; --icon-stroke: 1.75px; }
    .canvas-card-menu .canvas-card-menu-button svg { width: 18px; height: 18px; }
    /* one search field everywhere: explorer filter, graph search, settings search, plugin catalog, the two search overlays */
    body .bsf-find input, body .bsg-search, body .bset-find input, body .bsc-add input { height: 30px; box-sizing: border-box; padding: 0 10px; font-size: 13px; border: 1px solid var(--background-modifier-border) !important; border-radius: 5px !important; background: var(--background-primary) !important; color: var(--text-normal); box-shadow: none !important; outline: none !important; }
    body .bsf-find input:focus, body .bsg-search:focus, body .bset-find input:focus, body .bsc-add input:focus { border-color: var(--interactive-accent) !important; box-shadow: none !important; }
    .notice { background: var(--background-secondary); color: var(--text-normal); }
    kbd, .setting-hotkey { font-family: var(--font-interface); }
    /* one look for the two search overlays (quick switcher, note search): size, place, backdrop, panel, input, rows */
    body .bpal-wrap, body .bss-wrap { padding-top: 12vh; background: rgba(0,0,0,.4); }
    body .bpal, body .bss { width: min(700px, 92vw); max-height: 70vh; background: var(--modal-background, var(--background-primary)); border: 1px solid var(--background-modifier-border); border-radius: 6px; clip-path: var(--bs-clip); box-shadow: none; }
    body .bpal-in, body .bss-in { padding: 12px 16px; gap: 10px; }
    body .bpal-in input, body .bss-in input, body .bpal-in input:focus, body .bss-in input:focus { font-size: 16px; border: 0 !important; box-shadow: none !important; outline: none !important; border-radius: 0 !important; background: transparent !important; }
    body .bss-in svg { width: 16px; height: 16px; }
    body .bss-item { padding: 7px 16px; border-left-width: 0; border-radius: var(--bs-r); margin: 0 4px; }

    /* tabs: a flat strip, the open tab lifts to the page colour and carries an accent line on top */
    .workspace-tab-header { position: relative; transition: background .12s, color .12s; border-radius: 5px 5px 0 0; }
    .workspace-tab-header-inner-title { font-weight: 500; letter-spacing: .01em; }
    .workspace-tab-header:not(.is-active):hover { background: var(--background-modifier-hover); }
    .workspace-tab-header.is-active { background: var(--background-primary) linear-gradient(var(--interactive-accent), var(--interactive-accent)) top / 100% 2px no-repeat; box-shadow: none; }
    .workspace-tab-header.is-active::before, .workspace-tab-header.is-active::after { display: none; }
    .workspace-tab-header.is-active .workspace-tab-header-inner-title { color: var(--text-normal); }
    .workspace-tab-header:not(.is-active) .workspace-tab-header-inner-title { color: var(--text-muted); }
    .workspace-tab-header-inner-icon { color: var(--interactive-accent); opacity: .85; }
    .workspace-tab-header-inner-close-button { border-radius: 0; opacity: 0; transition: opacity .12s; }
    .workspace-tab-header:hover .workspace-tab-header-inner-close-button, .workspace-tab-header.is-active .workspace-tab-header-inner-close-button { opacity: .7; }
    .workspace-tab-header-inner-close-button:hover { opacity: 1 !important; background: var(--background-modifier-hover); color: var(--text-normal); }
    .workspace-tab-header-new-tab .clickable-icon { border-radius: 0; }
    /* file lists: calm rows, the open file marked with an accent bar and a tint */
    .tree-item-self, .nav-file-title, .nav-folder-title { border-radius: var(--nav-item-radius); margin: var(--bs-hairline) var(--size-4-1); transition: background-color var(--bs-dur-fast) var(--bs-ease-standard), color var(--bs-dur-fast) var(--bs-ease-standard), box-shadow var(--bs-dur-fast) var(--bs-ease-standard); }
    .tree-item-self:hover, .nav-file-title:hover, .nav-folder-title:hover { background: var(--background-modifier-hover); }
    .nav-file-title.is-active, .nav-folder-title.is-active, .tree-item-self.is-active { background: var(--bs-accent-soft); color: var(--text-normal); box-shadow: inset var(--bs-focus-width) 0 0 var(--interactive-accent); }
    .nav-folder-title { font-weight: var(--nav-heading-weight); color: var(--nav-heading-color); }
    .nav-file-title-content, .tree-item-inner { letter-spacing: .005em; }
    .nav-file-tag { border-radius: var(--nav-tag-radius); font-size: var(--font-smallest); letter-spacing: .05em; }
    .nav-folder-children { border-left: var(--nav-indentation-guide-width) solid var(--nav-indentation-guide-color); margin-left: var(--nav-item-children-margin-start); }
    .nav-header .clickable-icon, .nav-buttons-container .clickable-icon { border-radius: var(--clickable-icon-radius); }
    .nav-buttons-container { gap: var(--size-2-1); padding: var(--size-2-3) var(--size-4-2); }
    .workspace-tab-header-container { padding-top: 2px; }
    .workspace-leaf-content .view-header { border-bottom: 1px solid var(--background-modifier-border); }
    .checkbox-container { border-radius: 11px; }
    .checkbox-container::after { border-radius: 50%; }
  `;
  const appEl = document.createElement("style");
  appEl.id = "basalt-app-theme";
  appEl.textContent = APP_CSS;
  document.head.insertBefore(appEl, document.head.firstChild);

  // ---- Basalt look for the settings window (tokens scoped to .mod-settings, so the rest of the app is untouched)
  // default accent = copper; a colour the user picks in Appearance sets --accent-h/s/l on <body> and wins over these
  const THEME_CSS = `
    body.theme-light { --accent-h: 27; --accent-s: 50%; --accent-l: 34%; }
    body.theme-dark { --accent-h: 27; --accent-s: 50%; --accent-l: 57%; }
    .modal.mod-settings {
      --background-primary: #e6dfd6; --background-secondary: #ddd3c7; --background-modifier-hover: #ebe3d8; --background-modifier-border: #cdbfae;
      --divider-color: #cdbfae; --text-normal: #2a211a; --text-muted: #5c4f42; --text-faint: #655847;
      --settings-background: #dcd2c3; --modal-sidebar-background: #d1c6b5; --setting-items-background: #eee7db; --setting-items-radius: 0; --setting-items-border-width: 0px;
      --radius-s: 4px; --radius-m: 5px; --radius-l: 6px;
      --bs-cut: var(--bs-cut-lg);
    }
    .theme-dark .modal.mod-settings {
      --background-primary: #14110f; --background-secondary: #0c0a09; --background-modifier-hover: #2b231d; --background-modifier-border: #3a2f26;
      --divider-color: #2f261f; --text-normal: #ece4db; --text-muted: #a79a8d; --text-faint: #8f8072;
      --settings-background: #14110f; --modal-sidebar-background: #0c0a09; --setting-items-background: #221c18;
    }
    .modal.mod-settings { clip-path: none; border: 0; box-shadow: none; }
    .modal.mod-settings .setting-group .setting-items {
      border: 0; clip-path: none;
    }
    .modal.mod-settings .setting-item { border-color: var(--divider-color); }
    .modal.mod-settings .vertical-tab-header { border-inline-end-color: var(--divider-color); }
    .modal.mod-settings .vertical-tab-header-group-title { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--text-muted); font-weight: 500; }
    .modal.mod-settings .vertical-tab-nav-item { border-radius: 5px; position: relative; clip-path: none; }
    .modal.mod-settings .vertical-tab-nav-item.is-active { background: var(--background-modifier-hover); color: var(--text-normal); box-shadow: inset 3px 0 0 var(--interactive-accent); }
    .modal.mod-settings .vertical-tab-nav-item.is-active .vertical-tab-nav-item-icon { color: var(--interactive-accent); }
    .modal.mod-settings .setting-item-heading .setting-item-name { font-weight: 600; letter-spacing: .01em; }
    .modal.mod-settings .setting-item-description { color: var(--text-muted); }
    .modal.mod-settings button.mod-cta { background: var(--interactive-accent); color: var(--text-on-accent); }
    .modal.mod-settings .checkbox-container { border-radius: 11px; }
    .modal.mod-settings .checkbox-container::after { border-radius: 50%; }
    .modal.mod-settings input[type="text"], .modal.mod-settings input[type="number"], .modal.mod-settings input[type="search"], .modal.mod-settings select, .modal.mod-settings .dropdown { border-radius: 5px; background: var(--background-primary); border-color: var(--background-modifier-border); box-shadow: none; }
    .modal.mod-settings input[type="range"]::-webkit-slider-thumb { border-radius: 50%; background: var(--interactive-accent); }
  `;
  const themeEl = document.createElement("style");
  themeEl.id = "basalt-settings-theme";
  themeEl.textContent = THEME_CSS;
  document.head.appendChild(themeEl);

  // the version this fork shows (the engine version underneath stays the real one so plugin compatibility checks keep working)
  const SHOWN = "0.1.0", REAL = "1.12.7";
  const fixVersion = () => {
    for (const el of document.querySelectorAll(".mod-settings .setting-item-name, .mod-settings .setting-item-description")) {
      for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.includes(REAL)) n.nodeValue = n.nodeValue.split(REAL).join(SHOWN);
    }
  };
  new MutationObserver(fixVersion).observe(document.documentElement, { childList: true, subtree: true });

  window.__basaltUi = { sweep, ROW_NAMES };
})();

// A short notice with one action button (Undo): window.__bsUndoNotice(text, onUndo, label)
(() => {
  window.__bsUndoNotice = (text, onUndo, label) => {
    const Notice = window.__bsApi && window.__bsApi.Notice; if (!Notice) return null;
    const f = document.createDocumentFragment(), sp = document.createElement("span"); sp.textContent = text + " "; f.append(sp);
    const b = document.createElement("button"); b.textContent = label || "Отменить"; b.className = "bs-notice-undo"; b.setAttribute("aria-label", (label || "Отменить") + ": " + text);
    const n = new Notice(f, 9000); let used = false;
    b.addEventListener("click", async (e) => { e.stopPropagation(); if (used) return; used = true; try { n.hide(); } catch (er) { /* gone */ } try { await onUndo(); } catch (er) { console.error("[undo]", er); new Notice("Не получилось отменить. Попробуйте вручную."); } });
    f.append(b); return n;
  };
  const st = document.createElement("style"); st.textContent = ".notice .bs-notice-undo { margin-left: 8px; padding: 2px 10px; height: auto; font-size: var(--font-ui-smaller); cursor: var(--bs-cursor-hand, pointer); }"; document.head.appendChild(st);
})();

// Our own confirmation dialog (the browser's native one is a grey system window): window.__bsConfirm(text, {ok, cancel, danger}) -> Promise<boolean>
(() => {
  const css = document.createElement("style");
  css.textContent = ".bs-confirm{width:min(460px,92vw)!important;max-width:none}.bs-confirm .bs-confirm-text{white-space:pre-wrap;margin:6px 0 18px;line-height:1.5;word-break:break-word}.bs-confirm .modal-button-container{display:flex;gap:8px;justify-content:flex-end}";
  document.head.appendChild(css);
  // the application's own Modal: a title, the close cross, the dim backdrop, Esc / Enter
  window.__bsConfirm = (text, opts = {}) => new Promise((resolve) => {
    const Modal = window.__bsApi && window.__bsApi.Modal; if (!Modal) { resolve(window.confirm(text)); return; }
    const m = new Modal(window.app); m.modalEl.addClass("bs-confirm"); m.setTitle(opts.title || (opts.danger ? "Подтвердите удаление" : "Подтверждение"));
    let answer = false;
    const head = m.contentEl.createDiv({ cls: "bs-confirm-head" }); const ic = head.createDiv({ cls: "bs-confirm-ic" + (opts.danger ? " is-danger" : "") }); try { window.__bsApi.setIcon(ic, opts.danger ? "lucide-trash-2" : "lucide-circle-help"); } catch (e) { /* no icon */ }
    const tx = head.createDiv({ cls: "bs-confirm-main" }); tx.createDiv({ cls: "bs-confirm-text", text: opts.items ? (opts.lead || text) : text });
    if (opts.items && opts.items.length) { tx.createDiv({ cls: "bs-confirm-sub", text: opts.items.length > 1 ? "Выбрано: " + opts.items.length : "Один объект" }); const list = m.contentEl.createDiv({ cls: "bs-confirm-list" }); for (const n of opts.items.slice(0, 6)) { const r = list.createDiv({ cls: "bs-confirm-row" }); const fi = r.createSpan({ cls: "bs-confirm-fi" }); const parts = String(n).split("/"), nm = parts.pop(), dir = parts.join("/"); try { window.__bsApi.setIcon(fi, /\.[A-Za-z0-9]{1,6}$/.test(nm) ? "lucide-file" : "lucide-folder"); } catch (e) { /* no icon */ } r.createSpan({ cls: "bs-confirm-nm", text: nm }); if (dir) r.createSpan({ cls: "bs-confirm-dir", text: dir }); } if (opts.items.length > 6) list.createDiv({ cls: "bs-confirm-more", text: "Ещё: " + (opts.items.length - 6) }); }
    if (opts.danger) m.contentEl.createDiv({ cls: "bs-confirm-note", text: "Удалённое попадёт в корзину, откуда его можно вернуть." });
    const bar = m.contentEl.createDiv("modal-button-container");
    const no = bar.createEl("button", { text: opts.cancel || "Отмена" }), yes = bar.createEl("button", { text: opts.ok || "OK", cls: opts.danger ? "mod-warning" : "mod-cta" });
    const done = (v) => { answer = v; m.close(); };
    yes.addEventListener("click", () => done(true)); no.addEventListener("click", () => done(false));
    m.scope.register([], "Enter", () => { const a = document.activeElement; done(a === no ? false : a === yes ? true : !opts.danger); return false; });
    m.onClose = () => resolve(answer);
    m.open(); setTimeout(() => (opts.danger ? no : yes).focus(), 30);
  });
})();

// If the interface language failed to load at start (some strings stay English), load the page once more
(() => {
  if (!/index\.html/.test(location.pathname)) return;
  setTimeout(() => {
    try {
      const want = (localStorage.getItem("language") || navigator.language || "").split("-")[0];
      if (!want || want === "en" || !window.i18next || !i18next.store) return;
      if (!i18next.store.data[want] && !sessionStorage.getItem("bs-lang-retry")) { sessionStorage.setItem("bs-lang-retry", "1"); window.onbeforeunload = null; location.reload(); }
    } catch (e) { /* no i18n here */ }
  }, 6000);
})();

// Interface scale: the whole window zoom (text, panels, canvas) - smaller by default, and a slider in Settings > Appearance
(() => {
  if (!/index\.html/.test(location.pathname)) return;
  const KEY = "basalt-ui-scale", DEF = 0.92;
  const get = () => { const v = parseFloat(localStorage.getItem(KEY)); return v >= 0.7 && v <= 1.5 ? v : DEF; };
  const apply = () => { try { window.require("electron").webFrame.setZoomFactor(get()); } catch (e) { /* no zoom here */ } };
  const set = (v) => { try { localStorage.setItem(KEY, String(v)); } catch (e) { /* full */ } apply(); };
  apply(); window.__bsUiScale = { get, set, DEF };
  const addRow = () => {
    const modal = document.querySelector(".modal.mod-settings"); if (!modal) return;
    const act = modal.querySelector(".vertical-tab-nav-item.is-active"), box = modal.querySelector(".vertical-tab-content");
    if (!act || !box || box.querySelector(".bs-scale")) return;
    if (!/^(Оформление|Внешний вид|Appearance)$/i.test(act.textContent.trim())) return;
    const row = document.createElement("div"); row.className = "setting-item bs-scale";
    row.innerHTML = '<div class="setting-item-info"><div class="setting-item-name">Масштаб интерфейса</div><div class="setting-item-description">Размер всего текста и элементов. Уменьшите, если всё кажется крупным, или увеличьте для лучшей читаемости.</div></div><div class="setting-item-control"><input type="range" min="70" max="150" step="5"><span class="bs-scale-val" style="min-width:44px;text-align:right"></span><button>Сбросить</button></div>';
    const r = row.querySelector("input"), val = row.querySelector(".bs-scale-val");
    r.value = Math.round(get() * 100); val.textContent = r.value + "%";
    r.addEventListener("input", () => { val.textContent = r.value + "%"; });
    r.addEventListener("change", () => set(+r.value / 100));
    row.querySelector("button").addEventListener("click", () => { r.value = Math.round(DEF * 100); val.textContent = r.value + "%"; set(DEF); });
    box.prepend(row);
  };
  new MutationObserver(addRow).observe(document.body, { childList: true, subtree: true });
})();

// Recently used colours, shared by every colour picker of the application (canvas card colour, drawing, graph groups)
(() => {
  const KEY = "bs-recent-colors", MAX = 7, HEX = /^#[0-9a-f]{6}$/i;
  const get = () => { try { return JSON.parse(localStorage.getItem(KEY) || "[]").filter((c) => HEX.test(c)); } catch (e) { return []; } };
  const add = (c) => { if (!HEX.test(c || "")) return; c = c.toLowerCase(); const l = [c, ...get().filter((x) => x !== c)].slice(0, MAX); try { localStorage.setItem(KEY, JSON.stringify(l)); } catch (e) { /* full */ } };
  window.__bsRecent = { get, add };
  // after the custom colour of the canvas colour menu: the recent ones, one click applies
  window.__bsRecentRow = (menu, apply) => {
    const l = get(); if (!l.length) return;
    const sep = document.createElement("div"); sep.style.cssText = "width:1px;background:var(--background-modifier-border);margin:0 6px;flex:none"; menu.appendChild(sep);
    for (const c of l) {
      const d = document.createElement("div"); d.className = "canvas-color-picker-item"; d.title = c;
      d.style.setProperty("--canvas-color", parseInt(c.slice(1, 3), 16) + "," + parseInt(c.slice(3, 5), 16) + "," + parseInt(c.slice(5, 7), 16));
      d.addEventListener("click", () => { add(c); apply(c); });
      menu.appendChild(d);
    }
  };
})();

// Closing: a screen over everything while the app saves, then the main process destroys the window (see src/main.js)
(() => {
  if (!/index\.html/.test(location.pathname)) return;
  window.__bsFlushAndClose = async () => {
    const ov = document.createElement("div"); ov.className = "bs-closing"; const box = document.createElement("div"); box.className = "bs-closing-box"; const sp = document.createElement("div"); sp.className = "bs-closing-spin"; const tt = document.createElement("div"); tt.className = "bs-closing-t"; tt.textContent = "Закрываем Basalt"; const st = document.createElement("div"); st.className = "bs-closing-s"; st.textContent = "Сохраняем изменения…"; box.append(sp, tt, st); ov.appendChild(box); document.body.appendChild(ov);
    await new Promise((r) => setTimeout(r, 40));
    const app = window.app, lim = (p, ms) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
    try { app.workspace.saveLayout && app.workspace.saveLayout(); } catch (e) { /* ignore */ }
    const leaves = []; try { app.workspace.iterateAllLeaves((l) => leaves.push(l)); } catch (e) { /* ignore */ }
    st.textContent = "Сохраняем открытые файлы…"; await lim(Promise.all(leaves.map((l) => (l.view && typeof l.view.save === "function" ? l.view.save() : null))), 1600);
    if (window.__bsShare && window.__bsShare.flush) { st.textContent = "Сохраняем совместную работу…"; await lim(window.__bsShare.flush(), 1600); }
    st.textContent = "Готово"; return true;
  };
})();

// Keyboard in dialogs and lists, one behaviour everywhere: Enter in a text field presses the dialog's main button, arrows walk settings navigation, Tab reaches every nav item
(() => {
  const NAV = ".vertical-tab-nav-item, .bset-n, .bsm-navit";
  const mark = () => document.querySelectorAll(NAV).forEach((n) => { if (!n.hasAttribute("tabindex")) { n.tabIndex = 0; n.setAttribute("role", "tab"); } });
  let timer = 0; const watch = () => new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(mark, 120); }).observe(document.body, { childList: true, subtree: true }); if (document.body) watch(); else document.addEventListener("DOMContentLoaded", watch);
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target; if (!t || !t.closest) return;
    if (e.key === "Enter") {
      const modal = t.closest(".modal"); if (!modal || t.tagName !== "INPUT" || /^(checkbox|radio|button|range|color|file)$/.test(t.type)) return;
      const go = modal.querySelector(".modal-button-container button.mod-cta:not(:disabled)"); if (go) { e.preventDefault(); go.click(); }
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const cur = t.closest(NAV); if (!cur) return;
    const all = [...cur.parentElement.querySelectorAll(NAV)].filter((x) => x.offsetParent); const i = all.indexOf(cur); if (i < 0) return;
    e.preventDefault(); const n = all[(i + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]; n.focus();
  });
  document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target && e.target.matches && e.target.matches(NAV) && !e.defaultPrevented) { e.preventDefault(); e.target.click(); } });
})();
