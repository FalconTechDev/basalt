// Basalt: small comforts. Each one is tiny, independent and safe to fail on its own.
(() => {
  "use strict";
  const safe = (fn) => { try { fn(); } catch (e) { /* a comfort must never break the app */ } };
  const ready = (fn) => { const t = setInterval(() => { if (window.app && app.workspace && app.workspace.layoutReady) { clearInterval(t); safe(fn); } }, 400); };

  ready(() => {
    // 1. reading progress: a thin line at the top of the window follows the scroll of the open note
    const bar = document.createElement("div"); bar.className = "bp-progress"; document.body.appendChild(bar);
    // 2. "back to top" button for long notes
    const top = document.createElement("div"); top.className = "bp-top"; top.title = "Наверх";
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
        main.querySelectorAll(".bset-t b").forEach((b) => { const t = b.textContent, i = t.toLowerCase().indexOf(q); if (i >= 0) { b.textContent = ""; b.append(t.slice(0, i)); const m = document.createElement("mark"); m.textContent = t.slice(i, i + q.length); b.append(m, t.slice(i + q.length)); } });
      });
    };
    setInterval(watchSettings, 800);

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
})();
