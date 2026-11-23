// Basalt: small comforts. Each one is tiny, independent and safe to fail on its own.
(() => {
  "use strict";
  const safe = (fn) => { try { fn(); } catch (e) { /* a comfort must never break the app */ } };
  const ready = (fn) => { const t = setInterval(() => { if (window.app && app.workspace && app.workspace.layoutReady) { clearInterval(t); safe(fn); } }, 400); };

  ready(() => {
    // 1. reading progress: a thin line at the top of the window follows the scroll of the open note
    const bar = document.createElement("div"); bar.className = "bp-progress"; document.body.appendChild(bar);
    // 2. "back to top" button for long notes
    const top = document.createElement("div"); top.className = "bp-top"; top.title = "Наверх страницы";
    try { window.__bsApi.setIcon(top, "lucide-arrow-up"); } catch (e) { top.textContent = "↑"; }
    document.body.appendChild(top);
    let scroller = null;
    const scrollerOf = () => {
      const leaf = app.workspace.activeLeaf; if (!leaf || !leaf.view || leaf.view.getViewType() !== "markdown") return null;
      const el = leaf.view.containerEl; return el.querySelector(".cm-scroller") && el.querySelector(".markdown-source-view") && !el.querySelector(".markdown-source-view").classList.contains("is-hidden") ? (el.querySelector(".markdown-source-view .cm-scroller") || null) : el.querySelector(".markdown-preview-view");
    };
    const update = () => {
      const s = scroller; if (!s || !s.isConnected) { bar.style.width = "0"; top.classList.remove("is-on"); return; }
      const max = s.scrollHeight - s.clientHeight;
      bar.style.width = max > 0 ? Math.min(100, (s.scrollTop / max) * 100) + "%" : "0";
      top.classList.toggle("is-on", s.scrollTop > 600);
    };
    document.addEventListener("scroll", (e) => { if (e.target === scroller) update(); }, true);
    const refresh = () => { scroller = scrollerOf(); update(); };
    app.workspace.on("active-leaf-change", () => setTimeout(refresh, 80));
    app.workspace.on("layout-change", () => setTimeout(refresh, 80));
    setInterval(refresh, 1500);
    top.addEventListener("click", () => { if (scroller) scroller.scrollTo({ top: 0, behavior: "smooth" }); });

    // 3. double click on the empty part of the tab strip opens a new tab
    document.addEventListener("dblclick", (e) => {
      const strip = e.target.closest && e.target.closest(".workspace-tab-header-container-inner, .workspace-tab-header-spacer");
      if (!strip || e.target.closest(".workspace-tab-header")) return;
      app.commands.executeCommandById("workspace:new-tab");
    });

    // 4. a tab shows its full path when you hover it
    const hint = () => {
      for (const leaf of app.workspace.getLeavesOfType("markdown").concat(app.workspace.getLeavesOfType("canvas"), app.workspace.getLeavesOfType("basalt-textfile"))) {
        const f = leaf.view && leaf.view.file; if (f && leaf.tabHeaderEl && leaf.tabHeaderEl.title !== f.path) leaf.tabHeaderEl.title = f.path;
      }
    };
    app.workspace.on("layout-change", hint); app.workspace.on("file-open", hint); setInterval(hint, 3000);

    // 5. the window title carries the note and the vault
    const title = () => { const f = app.workspace.getActiveFile(); document.title = (f ? f.basename + " — " : "") + app.vault.getName() + " — Basalt"; };
    app.workspace.on("file-open", title); app.workspace.on("active-leaf-change", title); title();

    // 6. a quiet clock in the status bar
    if (app.statusBar && app.statusBar.registerStatusBarItem) {
      const clock = app.statusBar.registerStatusBarItem(); clock.classList.add("bp-clock");
      const tick = () => { const d = new Date(); clock.textContent = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); clock.title = d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); };
      tick(); setInterval(tick, 20000);
    }

    // 7. notices go away on click
    document.addEventListener("click", (e) => { const n = e.target.closest && e.target.closest(".notice"); if (n) n.remove(); }, true);

    // 8. the start page greets by the time of day
    const greet = () => {
      const h = document.querySelector(".bsh-hero, .bsh-title, .bsh"); if (!h || document.querySelector(".bsh-greeting")) return;
      const host = document.querySelector(".bsh-search"); if (!host) return;
      const hr = new Date().getHours(), w = hr < 5 ? "Доброй ночи" : hr < 12 ? "Доброе утро" : hr < 18 ? "Добрый день" : "Добрый вечер";
      const g = document.createElement("div"); g.className = "bsh-greeting"; g.textContent = w + ". " + new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
      host.parentElement.insertBefore(g, host);
    };
    setInterval(greet, 1200);

    // 9. the file list filter gets a clear (x) button
    const clearBtn = () => {
      const box = document.querySelector(".bsf-find"); if (!box) return; const inp = box.querySelector("input"); if (!inp) return;
      let x = box.querySelector(".bp-clear"); if (!x) { x = document.createElement("div"); x.className = "bp-clear"; x.textContent = "×"; x.title = "Очистить"; x.addEventListener("click", () => { inp.value = ""; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.focus(); }); box.appendChild(x); inp.addEventListener("input", () => x.classList.toggle("is-on", !!inp.value)); }
      x.classList.toggle("is-on", !!inp.value);
    };
    setInterval(clearBtn, 1500);

    // 10. settings: the last section is remembered, arrows walk the list, "/" jumps to the search, matches are highlighted
    const watchSettings = () => {
      const nav = document.querySelector(".bset-nav"); if (!nav || nav.__bp) return; nav.__bp = true;
      const items = () => Array.from(nav.querySelectorAll("button.bset-n"));
      nav.addEventListener("click", (e) => { const b = e.target.closest("button.bset-n"); if (b) { try { localStorage.setItem("bp-settings-last", b.textContent.trim()); } catch (er) { /* private */ } } });
      const last = (() => { try { return localStorage.getItem("bp-settings-last"); } catch (e) { return null; } })();
      if (last) { const b = items().find((x) => x.textContent.trim() === last && !x.classList.contains("is-on")); if (b) b.click(); }
      document.addEventListener("keydown", function keys(e) {
        if (!document.body.contains(nav)) { document.removeEventListener("keydown", keys, true); return; }
        const inInput = /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || "");
        if (e.key === "/" && !inInput) { e.preventDefault(); const s = nav.querySelector("input"); if (s) s.focus(); return; }
        if ((e.key === "ArrowDown" || e.key === "ArrowUp") && (e.target.closest && e.target.closest(".bset-nav")) && !inInput) {
          e.preventDefault(); const list = items(), i = list.findIndex((x) => x.classList.contains("is-on")), n = list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]; if (n) { n.click(); n.focus(); }
        }
      }, true);
      const inp = nav.querySelector("input");
      if (inp) inp.addEventListener("input", () => {
        const q = inp.value.trim().toLowerCase(), main = document.querySelector(".bset-main"); if (!main) return;
        main.querySelectorAll("mark").forEach((m) => { m.replaceWith(document.createTextNode(m.textContent)); });
        main.normalize();
        if (!q) return;
        main.querySelectorAll(".bset-t b, .bset-t small").forEach((b) => { const t = b.textContent, i = t.toLowerCase().indexOf(q); if (i >= 0) { b.textContent = ""; b.append(t.slice(0, i)); const m = document.createElement("mark"); m.textContent = t.slice(i, i + q.length); b.append(m, t.slice(i + q.length)); } });
      });
    };
    setInterval(watchSettings, 800);

    // 14. icons play a small move of their own when a button is pressed or switched on (pencil wiggles, gear turns, bin shakes ...)
    const ICON_MOVES = [
      [/pencil|pen|edit|brush|highlighter|signature/, "wiggle"],
      [/settings|sliders|cog|wrench/, "spin-half"],
      [/refresh|rotate-cw|rotate-ccw|loader|sync|repeat/, "spin"],
      [/trash|eraser|delete/, "shake"],
      [/plus|^x$|circle-x|close|circle-plus|square-plus/, "turn"],
      [/search|scan|zoom|focus|magnif/, "wobble"],
      [/undo|arrow-left|chevron-left|corner-up-left|back/, "nudge-l"],
      [/redo|arrow-right|chevron-right|corner-up-right|forward/, "nudge-r"],
      [/eye/, "blink"],
      [/folder|file|image|download|upload|archive|inbox/, "hop"],
      [/languages|translate|arrow-left-right|arrow-up-down|flip|repeat-2/, "flip"],
      [/lock|key|shield|magnet|pin/, "tilt"],
      [/git|network|share|workflow|waypoints|link/, "swing"],
    ];
    const playIcon = (btn) => {
      const svg = btn.querySelector && btn.querySelector("svg"); if (!svg || svg.__bsAnimating) return;
      const cls = Array.from(svg.classList).find((c) => c.startsWith("lucide-")) || ""; const name = cls.replace("lucide-", "");
      let move = "pop"; for (const [rx, m] of ICON_MOVES) if (rx.test(name)) { move = m; break; }
      svg.__bsAnimating = true; svg.classList.add("bs-ic-" + move);
      const done = () => { svg.classList.remove("bs-ic-" + move); svg.__bsAnimating = false; svg.removeEventListener("animationend", done); };
      svg.addEventListener("animationend", done); setTimeout(done, 900);
    };
    const BTN = "button, .clickable-icon, .canvas-control-item, .side-dock-ribbon-action, .view-action, .canvas-card-menu-button, .nav-action-button, .bsd-tb button";
    document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest(BTN); if (b) playIcon(b); }, true);
    new MutationObserver((list) => {
      for (const m of list) {
        const t = m.target; if (!t.matches || !t.matches(BTN)) continue;
        const was = m.oldValue || "", now = t.className || "";
        for (const tok of ["is-active", "mod-active", "is-on", "on", "is-checked", "is-enabled"]) { if (typeof now === "string" && now.split(/\s+/).includes(tok) && !was.split(/\s+/).includes(tok)) { playIcon(t); break; } }
      }
    }).observe(document.body, { attributes: true, attributeFilter: ["class"], attributeOldValue: true, subtree: true });

    // 11. the mouse wheel over the tab strip scrolls the tabs sideways
    document.addEventListener("wheel", (e) => {
      const strip = e.target.closest && e.target.closest(".workspace-tab-header-container-inner"); if (!strip || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (strip.scrollWidth > strip.clientWidth) { strip.scrollLeft += e.deltaY; e.preventDefault(); }
    }, { passive: false, capture: true });

    // 12. names in the file list show their full path on hover
    setInterval(() => { document.querySelectorAll(".bsf-tree [data-path] .bsf-n").forEach((n) => { const r = n.closest("[data-path]"); if (r && !n.title) n.title = r.getAttribute("data-path"); }); }, 2000);

    // 13. Escape in the file filter clears it and hands the focus back to the list
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !(e.target && e.target.closest && e.target.closest(".bsf-find"))) return;
      const inp = e.target; if (inp.value) { inp.value = ""; inp.dispatchEvent(new Event("input", { bubbles: true })); } const tree = document.querySelector(".bsf-tree"); if (tree) tree.focus();
    }, true);
  });

  // Names for icon-only buttons: whatever has no text gets an accessible name (and a tooltip when it has none at all), so no button is a mystery
  const ICON_LABELS = [
    [/eye-off|hide/, "Скрыть"], [/eye/, "Показать"], [/^x$|circle-x|close/, "Закрыть"], [/plus|circle-plus|square-plus/, "Добавить"], [/trash|delete/, "Удалить"],
    [/pencil|edit|pen$/, "Изменить"], [/copy|clipboard/, "Копировать"], [/search|magnif/, "Найти"], [/settings|cog|sliders/, "Настройки"], [/refresh|rotate|sync/, "Обновить"],
    [/chevron-down|chevrons-up-down/, "Развернуть"], [/chevron-up|chevrons-down-up/, "Свернуть"], [/chevron-left|arrow-left/, "Назад"], [/chevron-right|arrow-right/, "Вперёд"],
    [/arrow-up/, "Вверх"], [/arrow-down/, "Вниз"], [/ellipsis|more-/, "Ещё действия"], [/check/, "Готово"], [/download/, "Скачать"], [/upload/, "Загрузить"],
    [/folder-open/, "Открыть папку"], [/play/, "Запустить"], [/square$|stop/, "Остановить"], [/pin/, "Закрепить"], [/help|info/, "Подсказка"], [/undo/, "Отменить действие"],
    [/redo/, "Повторить действие"], [/zoom-in/, "Приблизить"], [/zoom-out/, "Отдалить"], [/maximize|expand/, "На весь экран"], [/minus/, "Убрать"], [/link/, "Ссылка"],
  ];
  const EN = { "Скрыть": "Hide", "Показать": "Show", "Закрыть": "Close", "Добавить": "Add", "Удалить": "Delete", "Изменить": "Edit", "Копировать": "Copy", "Найти": "Find", "Настройки": "Settings", "Обновить": "Refresh", "Развернуть": "Expand", "Свернуть": "Collapse", "Назад": "Back", "Вперёд": "Forward", "Вверх": "Up", "Вниз": "Down", "Ещё действия": "More actions", "Готово": "Done", "Скачать": "Download", "Загрузить": "Upload", "Открыть папку": "Open folder", "Запустить": "Run", "Остановить": "Stop", "Закрепить": "Pin", "Подсказка": "Help", "Отменить действие": "Undo", "Повторить действие": "Redo", "Приблизить": "Zoom in", "Отдалить": "Zoom out", "На весь экран": "Full screen", "Убрать": "Remove", "Ссылка": "Link", "Закрыть окно": "Close the window", "Закрыть окно (Esc)": "Close the window (Esc)" };
  const L = (ru) => (window.__bsLang === "ru" || !EN[ru] ? ru : EN[ru]);
  const SELECTOR = "button, [role=button], .clickable-icon, .view-action, .side-dock-ribbon-action";
  const nameIcons = () => {
    for (const el of document.querySelectorAll(SELECTOR)) {
      if (el.__bsNamed || (el.textContent || "").trim()) continue;
      const svg = el.querySelector("svg"); if (!svg) continue;
      const have = el.getAttribute("aria-label"), tip = el.getAttribute("title") || el.getAttribute("data-tooltip");
      if (have) { el.__bsNamed = 1; continue; }
      if (tip) { el.setAttribute("aria-label", tip); el.__bsNamed = 1; continue; }
      const cls = Array.from(svg.classList).find((c) => c.startsWith("lucide-")) || "", name = cls.replace("lucide-", ""); if (!name) continue;
      const hit = ICON_LABELS.find(([rx]) => rx.test(name)); if (!hit) continue;
      el.setAttribute("aria-label", L(hit[1])); el.setAttribute("title", L(hit[1])); el.__bsNamed = 1;
    }
    for (const el of document.querySelectorAll(".modal-close-button:not([aria-label])")) { el.setAttribute("aria-label", L("Закрыть окно")); el.setAttribute("title", L("Закрыть окно (Esc)")); }
  };
  // notices: the same text is shown once, and no more than three are on screen
  const calmNotices = () => {
    const box = document.querySelector(".notice-container"); if (!box) return;
    const list = Array.from(box.querySelectorAll(".notice")), seen = new Map();
    for (const n of list) { const k = (n.textContent || "").trim(); if (seen.has(k)) seen.get(k).remove(); seen.set(k, n); }
    const left = Array.from(box.querySelectorAll(".notice")); for (let i = 0; i < left.length - 3; i++) left[i].remove();
  };
  const startCalm = () => {
    let t1 = 0, t2 = 0;
    new MutationObserver((muts) => {
      clearTimeout(t1); t1 = setTimeout(() => safe(nameIcons), 500);
      if (muts.some((m) => Array.from(m.addedNodes).some((n) => n.nodeType === 1 && (n.matches(".notice") || n.querySelector(".notice"))))) { clearTimeout(t2); t2 = setTimeout(() => safe(calmNotices), 30); }
    }).observe(document.body, { childList: true, subtree: true });
    safe(nameIcons);
  };
  if (document.body) startCalm(); else document.addEventListener("DOMContentLoaded", startCalm);
})();
