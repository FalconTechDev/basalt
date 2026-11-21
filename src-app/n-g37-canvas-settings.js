// g37 — canvas plugin settings tab (clean-room). Factory: ng37CanvasSettingsTab(host).
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { s13KeyNames } from "./s13-geom.js";
import { ng20CanvasStrings } from "./n-g20-shared.js";

let ng37CanvasSettingsTabClass = null;

/** Settings tab for the canvas plugin: creation defaults + interaction behaviour. */
export function ng37CanvasSettingsTab(host) {
  if (ng37CanvasSettingsTabClass) return ng37CanvasSettingsTabClass;

  function Ng37CanvasSettingsTab(app, plugin, instance) {
    const self = host.PluginInstanceSettingTab.call(this, app, plugin) || this;
    self.icon = "layout-dashboard";
    self.instance = instance;
    return self;
  }
  inherit(Ng37CanvasSettingsTab, host.PluginInstanceSettingTab);

  Ng37CanvasSettingsTab.prototype.display = function () {
    const self = this;
    const containerEl = this.containerEl;
    containerEl.empty();
    const options = this.instance.options || (this.instance.options = {});
    const t = ng20CanvasStrings();
    const fileT = env().gm.setting.file;
    const persist = () => this.plugin.saveData(options);

    const group = new host.SettingGroup(containerEl);

    let folderPathSetting = null;
    group.addSetting((setting) => {
      setting.setName(t.optionNewCanvasLocation()).setDesc(t.optionNewCanvasLocationDescription())
        .addDropdown((dropdown) => {
          dropdown
            .addOption("root", fileT.optionChoiceVaultRoot())
            .addOption("current", fileT.optionChoiceCurrentFolder())
            .addOption("folder", fileT.optionChoiceSpecifiedFolder())
            .setValue(options.newFileLocation || "root")
            .onChange((value) => {
              options.newFileLocation = value;
              persist();
              if (folderPathSetting) folderPathSetting.setVisibility(value === "folder");
            });
        });
    });

    group.addSetting((setting) => {
      folderPathSetting = setting;
      setting.setName(t.optionNewCanvasFolderPath()).setDesc(t.optionNewCanvasFolderPathDescription())
        .addText((text) => {
          text.setPlaceholder(env().gm.setting.folderPathExamplePlaceholder())
            .setValue(options.newFileFolderPath === "/" ? "" : (options.newFileFolderPath || ""))
            .onChange((value) => {
              options.newFileFolderPath = value;
              persist();
            });
          new host.FolderPathSuggest(self.app, text.inputEl, false, true);
        });
    });
    if (folderPathSetting) folderPathSetting.setVisibility(options.newFileLocation === "folder");

    group.addSetting((setting) =>
      setting.setName(t.optionWheelBehavior()).addDropdown((dropdown) =>
        dropdown.addOption("pan", t.labelPan()).addOption("zoom", t.labelZoom())
          .setValue(options.defaultWheelBehavior || "pan")
          .onChange((value) => { options.defaultWheelBehavior = value; persist(); }),
      ),
    );

    group.addSetting((setting) =>
      setting.setName(t.optionModDragBehavior({ key: s13KeyNames(["Mod", "Drag"], host) })).addDropdown((dropdown) =>
        dropdown
          .addOption("menu", t.optionShowMenu())
          .addOption("card", t.actionAddCard())
          .addOption("note", t.actionAddNote())
          .addOption("media", t.actionAddMedia())
          .addOption("webpage", t.actionAddWebsite())
          .addOption("group", t.actionCreateGroup())
          .setValue(options.defaultModDragBehavior || "menu")
          .onChange((value) => { options.defaultModDragBehavior = value; persist(); }),
      ),
    );

    group.addSetting((setting) =>
      setting.setName(t.optionNodeLabel()).addDropdown((dropdown) =>
        dropdown
          .addOption("always", t.labelAlways())
          .addOption("hover", t.labelHover())
          .addOption("never", t.labelNever())
          .setValue(options.cardLabelVisibility || "always")
          .onChange((value) => {
            options.cardLabelVisibility = value;
            persist();
            if (typeof this.instance.rerenderCanvases === "function") this.instance.rerenderCanvases();
          }),
      ),
    );

    group.addSetting((setting) =>
      setting.setName(t.optionSnapToGrid()).setDesc(t.optionSnapToGridDesc()).addToggle((toggle) =>
        toggle.setValue(!!options.snapToGrid).onChange((value) => { options.snapToGrid = value; persist(); }),
      ),
    );

    group.addSetting((setting) =>
      setting.setName(t.optionSnapToObjects()).setDesc(t.optionSnapToObjectsDesc()).addToggle((toggle) =>
        toggle.setValue(!!options.snapToObjects).onChange((value) => { options.snapToObjects = value; persist(); }),
      ),
    );

    let resetBtn = null;
    let zoomSlider = null;
    group.addSetting((setting) => {
      setting.setName(t.optionZoomBreakpoint()).setDesc(t.optionZoomBreakpointDesc())
        .addSlider((slider) => {
          zoomSlider = slider;
          slider.setLimits(-0.7, 2.4, 0.01)
            .setValue(options.zoomBreakpoint || 0)
            .onChange((value) => {
              options.zoomBreakpoint = value;
              persist();
              if (resetBtn && resetBtn.extraSettingsEl) resetBtn.extraSettingsEl.toggle(value !== 0);
            });
        })
        .addExtraButton((btn) => {
          resetBtn = btn;
          btn.setIcon("lucide-rotate-ccw")
            .setTooltip(env().gm.setting.hotkeys.tooltipRestoreDefault())
            .onClick(() => {
              options.zoomBreakpoint = 0;
              persist();
              if (zoomSlider && typeof zoomSlider.setValue === "function") zoomSlider.setValue(0);
              if (resetBtn.extraSettingsEl) resetBtn.extraSettingsEl.toggle(false);
            });
        });
    });
    if (resetBtn && resetBtn.extraSettingsEl) {
      resetBtn.extraSettingsEl.toggle((options.zoomBreakpoint || 0) !== 0);
    }

    if (typeof window.__fpSettings === "function") {
      window.__fpSettings(containerEl, options, this.plugin, this.instance, host.Setting);
    }
  };

  ng37CanvasSettingsTabClass = Ng37CanvasSettingsTab;
  return ng37CanvasSettingsTabClass;
}
