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
  const SERVICE_TEXT = /basalt (publish|sync)|obsidian (publish|sync)/i;

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
    .modal-close-button:empty { position: absolute; top: 12px; right: 12px; width: 32px; height: 32px; cursor: pointer; z-index: 3; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px); transition: background .12s, border-color .12s; }
    .modal-close-button:empty::before { content: ""; position: absolute; inset: 0; background: var(--text-muted); -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M11 11l10 10M21 11L11 21' stroke='black' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E") center / 100% no-repeat; transition: background .12s; }
    .modal-close-button:empty::after { content: none; }
    .modal-close-button:empty:hover { background: var(--interactive-accent); border-color: var(--interactive-accent); } .modal-close-button:empty:hover::before { background: var(--text-on-accent, #fff); }
    body.theme-light {
      --background-primary: #eee7db; --background-primary-alt: #e5ddcf; --background-secondary: #dcd2c3; --background-secondary-alt: #d1c6b5;
      --background-modifier-hover: rgba(107,68,41,.09); --background-modifier-border: #c3b4a0; --background-modifier-border-hover: #b3a18a; --background-modifier-active-hover: rgba(107,68,41,.16);
      --divider-color: #c3b4a0; --text-normal: #2a211a; --text-muted: #62564a; --text-faint: #7d6e5f;
      --titlebar-background: #dcd2c3; --titlebar-background-focused: #d1c6b5; --tab-container-background: #dcd2c3; --ribbon-background: #dcd2c3; --modal-background: #eee7db;
    }
    body.theme-dark {
      --background-primary: #17130f; --background-primary-alt: #1b1612; --background-secondary: #0f0c0a; --background-secondary-alt: #0c0a09;
      --background-modifier-hover: rgba(176,122,82,.12); --background-modifier-border: #3a2f26; --background-modifier-border-hover: #4a3c30; --background-modifier-active-hover: rgba(176,122,82,.22);
      --divider-color: #2f261f; --text-normal: #ece4db; --text-muted: #a79a8d; --text-faint: #7d7064;
      --titlebar-background: #0c0a09; --titlebar-background-focused: #14110f; --tab-container-background: #0c0a09; --ribbon-background: #0c0a09; --modal-background: #1b1612;
    }
    /* the shape language of Basalt, for every module: panels, cards and pop-ups are cut at two corners (--bs-clip), small controls and list rows have --bs-r */
    body { --bs-clip: polygon(var(--bs-c) 0, 100% 0, 100% calc(100% - var(--bs-c)), calc(100% - var(--bs-c)) 100%, 0 100%, 0 var(--bs-c)); --bs-r: 4px; --bs-gap: 8px; --bs-pad: 12px; --bs-ease: .12s; }
    body { --bs-c: 6px; --radius-s: 0px; --radius-m: 0px; --radius-l: 0px; --button-radius: 0px; --input-radius: 0px; --checkbox-radius: 2px; }
    .modal:not(.mod-settings), .prompt, .menu, .suggestion-container, .popover, .notice {
      clip-path: polygon(var(--bs-c) 0, 100% 0, 100% calc(100% - var(--bs-c)), calc(100% - var(--bs-c)) 100%, 0 100%, 0 var(--bs-c));
    }
    .modal:not(.mod-settings), .prompt, .menu, .suggestion-container, .popover, .notice { border-radius: 0; }
    .menu-item, .suggestion-item { border-radius: 0; }
    .status-bar { border-radius: 0; }
    .canvas-control-group, .canvas-card-menu, .canvas-menu-container .menu-container { border-radius: 0; box-shadow: none; clip-path: var(--bs-clip); }
    .canvas-control-group { background: var(--background-secondary); }
    .canvas-card-menu { --icon-size: 18px; --icon-stroke: 1.75px; }
    .canvas-card-menu .canvas-card-menu-button svg { width: 18px; height: 18px; }
    .notice { background: var(--background-secondary); color: var(--text-normal); }
    kbd, .setting-hotkey { font-family: var(--font-interface); }
    /* one look for the two search overlays (quick switcher, note search): size, place, backdrop, panel, input, rows */
    body .bpal-wrap, body .bss-wrap { padding-top: 12vh; background: rgba(0,0,0,.4); }
    body .bpal, body .bss { width: min(700px, 92vw); max-height: 70vh; background: var(--modal-background, var(--background-primary)); border: 1px solid var(--background-modifier-border); border-radius: 0; clip-path: var(--bs-clip); box-shadow: none; }
    body .bpal-in, body .bss-in { padding: 12px 16px; gap: 10px; }
    body .bpal-in input, body .bss-in input, body .bpal-in input:focus, body .bss-in input:focus { font-size: 16px; border: 0 !important; box-shadow: none !important; outline: none !important; border-radius: 0 !important; background: transparent !important; }
    body .bss-in svg { width: 16px; height: 16px; }
    body .bss-item { padding: 7px 16px; border-left-width: 0; border-radius: var(--bs-r); margin: 0 4px; }

    /* tabs: a flat strip, the open tab lifts to the page colour and carries an accent line on top */
    .workspace-tab-header { position: relative; transition: background .12s, color .12s; border-radius: 0; }
    .workspace-tab-header-inner-title { font-weight: 500; letter-spacing: .01em; }
    .workspace-tab-header:not(.is-active):hover { background: var(--background-modifier-hover); }
    .workspace-tab-header.is-active { background: var(--background-primary) linear-gradient(var(--interactive-accent), var(--interactive-accent)) top / 100% 2px no-repeat; box-shadow: none; }
    .workspace-tab-header.is-active::before, .workspace-tab-header.is-active::after { display: none; }
    .workspace-tab-header.is-active .workspace-tab-header-inner-title { color: var(--text-normal); }
    .workspace-tab-header:not(.is-active) .workspace-tab-header-inner-title { color: var(--text-muted); }
    .workspace-tab-header-inner-icon { color: var(--interactive-accent); opacity: .85; }
    .workspace-tab-header-inner-close-button { border-radius: 4px; opacity: 0; transition: opacity .12s; }
    .workspace-tab-header:hover .workspace-tab-header-inner-close-button, .workspace-tab-header.is-active .workspace-tab-header-inner-close-button { opacity: .7; }
    .workspace-tab-header-inner-close-button:hover { opacity: 1 !important; background: var(--background-modifier-hover); color: var(--text-normal); }
    .workspace-tab-header-new-tab .clickable-icon { border-radius: 4px; }
    /* file lists: calm rows, the open file marked with an accent bar and a tint */
    .tree-item-self, .nav-file-title, .nav-folder-title { border-radius: 4px; margin: 1px 4px; transition: background .1s; }
    .tree-item-self:hover, .nav-file-title:hover, .nav-folder-title:hover { background: var(--background-modifier-hover); }
    .nav-file-title.is-active, .nav-folder-title.is-active, .tree-item-self.is-active { background: color-mix(in srgb, var(--interactive-accent) 16%, transparent); color: var(--text-normal); box-shadow: inset 2px 0 0 var(--interactive-accent); }
    .nav-folder-title { font-weight: 600; color: var(--text-normal); }
    .nav-file-title-content, .tree-item-inner { letter-spacing: .005em; }
    .nav-file-tag { border-radius: 3px; font-size: 9px; letter-spacing: .06em; }
    .nav-folder-children { border-left: 1px solid var(--background-modifier-border); margin-left: 14px; }
    .nav-header .clickable-icon, .nav-buttons-container .clickable-icon { border-radius: 4px; }
    .nav-buttons-container { gap: 2px; padding: 6px 8px; }
    .workspace-tab-header-container { padding-top: 2px; }
    .workspace-leaf-content .view-header { border-bottom: 1px solid var(--background-modifier-border); }
    button:not(.clickable-icon):not(.modal-close-button):not(.mod-raised) { box-shadow: none; clip-path: polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px); }
    .checkbox-container { border-radius: 2px; }
    .checkbox-container::after { border-radius: 1px; }
  `;
  const appEl = document.createElement("style");
  appEl.id = "basalt-app-theme";
  appEl.textContent = APP_CSS;
  document.head.insertBefore(appEl, document.head.firstChild);

  // ---- Basalt look for the settings window (tokens scoped to .mod-settings, so the rest of the app is untouched)
  // default accent = copper; a colour the user picks in Appearance sets --accent-h/s/l on <body> and wins over these
  const THEME_CSS = `
    body.theme-light { --accent-h: 25; --accent-s: 44%; --accent-l: 29%; }
    body.theme-dark { --accent-h: 25; --accent-s: 37%; --accent-l: 50%; }
    .modal.mod-settings {
      --background-primary: #e6dfd6; --background-secondary: #ddd3c7; --background-modifier-hover: #ebe3d8; --background-modifier-border: #cdbfae;
      --divider-color: #cdbfae; --text-normal: #2a211a; --text-muted: #6e6154; --text-faint: #8a7b6c;
      --settings-background: #dcd2c3; --modal-sidebar-background: #d1c6b5; --setting-items-background: #eee7db; --setting-items-radius: 0; --setting-items-border-width: 0px;
      --radius-s: 0; --radius-m: 0; --radius-l: 0;
      --bs-cut: 12px;
    }
    .theme-dark .modal.mod-settings {
      --background-primary: #14110f; --background-secondary: #0c0a09; --background-modifier-hover: #2b231d; --background-modifier-border: #3a2f26;
      --divider-color: #2f261f; --text-normal: #ece4db; --text-muted: #a79a8d; --text-faint: #7d7064;
      --settings-background: #14110f; --modal-sidebar-background: #0c0a09; --setting-items-background: #221c18;
    }
    .modal.mod-settings { clip-path: polygon(var(--bs-cut) 0, 100% 0, 100% calc(100% - var(--bs-cut)), calc(100% - var(--bs-cut)) 100%, 0 100%, 0 var(--bs-cut)); border: 0; box-shadow: none; }
    .modal.mod-settings .setting-group .setting-items {
      border: 0; clip-path: polygon(var(--bs-cut) 0, 100% 0, 100% calc(100% - var(--bs-cut)), calc(100% - var(--bs-cut)) 100%, 0 100%, 0 var(--bs-cut));
    }
    .modal.mod-settings .setting-item { border-color: var(--divider-color); }
    .modal.mod-settings .vertical-tab-header { border-inline-end-color: var(--divider-color); }
    .modal.mod-settings .vertical-tab-header-group-title { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--text-faint); font-weight: 500; }
    .modal.mod-settings .vertical-tab-nav-item { border-radius: 0; position: relative; clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px); }
    .modal.mod-settings .vertical-tab-nav-item.is-active { background: var(--background-modifier-hover); color: var(--text-normal); box-shadow: inset 3px 0 0 var(--interactive-accent); }
    .modal.mod-settings .vertical-tab-nav-item.is-active .vertical-tab-nav-item-icon { color: var(--interactive-accent); }
    .modal.mod-settings .setting-item-heading .setting-item-name { font-weight: 600; letter-spacing: .01em; }
    .modal.mod-settings .setting-item-description { color: var(--text-muted); }
    .modal.mod-settings button:not(.clickable-icon):not(.modal-close-button) { border-radius: 0; box-shadow: none; clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px); }
    .modal.mod-settings button.mod-cta { background: var(--interactive-accent); color: var(--text-on-accent); }
    .modal.mod-settings .checkbox-container { border-radius: 2px; }
    .modal.mod-settings .checkbox-container::after { border-radius: 1px; }
    .modal.mod-settings input[type="text"], .modal.mod-settings input[type="number"], .modal.mod-settings input[type="search"], .modal.mod-settings select, .modal.mod-settings .dropdown { border-radius: 0; background: var(--background-primary); border-color: var(--background-modifier-border); box-shadow: none; }
    .modal.mod-settings input[type="range"]::-webkit-slider-thumb { border-radius: 0; background: var(--interactive-accent); }
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
    m.contentEl.createDiv({ cls: "bs-confirm-text", text });
    const bar = m.contentEl.createDiv("modal-button-container");
    const no = bar.createEl("button", { text: opts.cancel || "Отмена" }), yes = bar.createEl("button", { text: opts.ok || "OK", cls: opts.danger ? "mod-warning" : "mod-cta" });
    const done = (v) => { answer = v; m.close(); };
    yes.addEventListener("click", () => done(true)); no.addEventListener("click", () => done(false));
    m.scope.register([], "Enter", () => { done(true); return false; });
    m.onClose = () => resolve(answer);
    m.open(); setTimeout(() => yes.focus(), 30);
  });
})();

// If the interface language failed to load at start (some strings stay English), load the page once more
(() => {
  if (!/index\.html/.test(location.pathname)) return;
  setTimeout(() => {
    try {
      const want = (localStorage.getItem("language") || navigator.language || "").split("-")[0];
      if (!want || want === "en" || !window.i18next || !i18next.store) return;
      if (!i18next.store.data[want] && !sessionStorage.getItem("bs-lang-retry")) { sessionStorage.setItem("bs-lang-retry", "1"); location.reload(); }
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
