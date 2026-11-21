// g37 — editor-status internal plugin (clean-room). Factory: defineS33EditorStatusPlugin(host).
import { env } from "./env.js";
import { ng20EditorStatusStrings } from "./n-g20-shared.js";

const STATUS_DEFS = [
  ["read", "lucide-book-open", (t) => t.read()],
  ["source", "lucide-code-2", (t) => t.editSource()],
  ["live-preview", "lucide-edit-3", (t) => t.editLivePreview()],
];

export function ng37EditorStatusPlugin(host) {
  return class Ng37EditorStatusPlugin {
    constructor() {
      const t = ng20EditorStatusStrings();
      this.id = "editor-status";
      this.name = t.name();
      this.description = t.desc();
      this.defaultOn = true;
      this.hiddenFromList = true;
    }

    init(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      plugin.registerStatusBarItem();
    }

    getActiveView() {
      const view = this.app.workspace.getActiveFileView();
      const MD = env().W6;
      return view && MD && view instanceof MD ? view : null;
    }

    getStatus() {
      const view = this.getActiveView();
      if (!view) return "";
      if (view.getMode && view.getMode() === "preview") return "read";
      if (!view.editMode) return "source";
      return view.editMode.sourceMode ? "source" : "live-preview";
    }

    async setStatus(mode) {
      const view = this.getActiveView();
      if (!view || !view.leaf || typeof view.leaf.setViewState !== "function") return;
      let state;
      if (mode === "read") state = { mode: "preview" };
      else if (mode === "source") state = { mode: "source", source: true };
      else if (mode === "live-preview") state = { mode: "source", source: false };
      else return;
      await view.leaf.setViewState({ type: env().U6, state });
    }

    updateStatus() {
      const bar = this.plugin && this.plugin.statusBarEl;
      if (!bar) return;
      bar.empty();
      bar.show();
      const icon = bar.createSpan("status-bar-item-icon");
      const status = this.getStatus();
      if (!status) {
        bar.hide();
        return;
      }
      const t = ng20EditorStatusStrings();
      const def = STATUS_DEFS.find((d) => d[0] === status);
      if (!def) { bar.hide(); return; }
      host.setIcon(icon, def[1]);
      host.setTooltip(bar, def[2](t), { placement: "top" });
    }

    onClick(evt) {
      const view = this.getActiveView();
      if (!view) return;
      const t = ng20EditorStatusStrings();
      const status = this.getStatus();
      const menu = new host.Menu();
      const modes = view.editMode ? STATUS_DEFS : STATUS_DEFS.slice(0, 2);
      for (const [mode, icon, label] of modes) {
        menu.addItem((item) => item
          .setTitle(label(t))
          .setIcon(icon)
          .setChecked(mode === status)
          .onClick(() => { this.setStatus(mode); }));
      }
      menu.showAtMouseEvent(evt);
    }

    onEnable(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      plugin.registerEvent(app.workspace.on("layout-change", () => this.updateStatus()));
      plugin.registerEvent(app.workspace.on("active-leaf-change", () => this.updateStatus()));
      const bar = plugin.statusBarEl;
      if (bar) {
        bar.addClass("mod-clickable");
        const handler = (evt) => this.onClick(evt);
        bar.addEventListener("click", handler);
        bar.addEventListener("contextmenu", handler);
        plugin.register(() => {
          bar.removeEventListener("click", handler);
          bar.removeEventListener("contextmenu", handler);
        });
      }
      this.updateStatus();
    }
  };
}
