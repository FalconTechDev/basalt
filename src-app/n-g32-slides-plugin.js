// g32 clean-room: slides core plugin shell.
import { env } from "./env.js";
import { ng32DefineSlidesView } from "./n-g32-slides-view.js";

let ng32SlidesPluginClass = null;

export function ng32DefineSlidesPlugin(host) {
  if (ng32SlidesPluginClass) return ng32SlidesPluginClass;

  function Ng32SlidesPlugin() {
    this.id = "slides";
    this.name = env().gm.plugins.slides.name();
    this.description = env().gm.plugins.slides.desc();
    this.app = null;
  }

  Ng32SlidesPlugin.prototype.init = function (app, manifest) {
    this.app = app;
    const View = ng32DefineSlidesView(host);
    manifest.registerGlobalCommand({
      id: "slides:start",
      name: env().gm.plugins.slides.actionStart(),
      icon: "lucide-monitor",
      checkCallback: (checking) => {
        const file = app.workspace.getActiveFile();
        if (file && file.extension === "md") {
          if (!checking) new View(app).openFile(file);
          return true;
        }
        return false;
      },
    });
  };

  Ng32SlidesPlugin.prototype.onEnable = function (app, manifest) {
    manifest.registerEvent(app.workspace.on("file-menu", this.onFileMenu, this));
  };

  Ng32SlidesPlugin.prototype.onFileMenu = function (menu, file) {
    if (!(file instanceof env().$T) || file.extension !== "md") return;
    const View = ng32DefineSlidesView(host);
    menu.addItem((item) => item
      .setSection("view")
      .setTitle(env().gm.plugins.slides.actionStart())
      .setIcon("lucide-monitor")
      .onClick(() => new View(this.app).openFile(file)));
  };

  ng32SlidesPluginClass = Ng32SlidesPlugin;
  return Ng32SlidesPlugin;
}
