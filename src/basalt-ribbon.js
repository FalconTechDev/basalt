// Basalt: a Graph button in the left ribbon (the strip of icons at the window edge).
(() => {
  "use strict";
  const t = setInterval(() => {
    if (!(window.app && app.workspace && app.workspace.layoutReady && app.workspace.leftRibbon && app.commands)) return;
    clearInterval(t);
    try { app.workspace.leftRibbon.addRibbonItemButton("basalt:graph", "lucide-git-fork", "Граф", () => app.commands.executeCommandById("graph:open")); } catch (e) { /* no ribbon */ }
  }, 300);
})();
