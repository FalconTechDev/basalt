// Basalt: Graph and Sync buttons in the left ribbon (the strip of icons at the window edge).
(() => {
  "use strict";
  const t = setInterval(() => {
    if (!(window.app && app.workspace && app.workspace.layoutReady && app.workspace.leftRibbon && app.commands)) return;
    clearInterval(t);
    try { app.workspace.leftRibbon.addRibbonItemButton("basalt:graph", "lucide-git-fork", "Граф связей между заметками", () => app.commands.executeCommandById("graph:open")); } catch (e) { /* no ribbon */ }
    try { app.workspace.leftRibbon.addRibbonItemButton("basalt:sync", "lucide-refresh-cw", "Синхронизировать хранилище с другими устройствами", () => { if (!app.commands.executeCommandById("vault-sync:sync")) app.commands.executeCommandById("vault-sync:status"); }); } catch (e) { /* no ribbon */ }
  }, 300);
})();
