// g33 clean-room: settings tab of the "zk-prefixer" unique-note plugin.
// Folder, template file and moment-format options persisted on the plugin
// instance's options object. Replaces orig xee (class).
import { inherit } from "./inherit.js";
import { s16UniqueNoteFormat } from "./s16-constants.js";

export function defineUniqueNoteSettingsTab(host) {
  function UniqueNoteSettingsTab(app, plugin, instance) {
    const self = host.PluginInstanceSettingTab.call(this, app, plugin, instance) || this;
    self.app = app;
    self.plugin = plugin;
    self.instance = instance;
    self.icon = "sheets-in-box";
    return self;
  }
  inherit(UniqueNoteSettingsTab, host.PluginInstanceSettingTab);

  UniqueNoteSettingsTab.prototype.display = function () {
    const t = host.i18n.plugins.uniqueNoteCreator;
    const daily = host.i18n.plugins.dailyNotes;
    const options = (this.instance && this.instance.options) || {};
    const plugin = this.plugin;
    const app = this.app;
    const save = () => plugin.saveData(options);

    this.containerEl.empty();

    const intro = document.createDocumentFragment();
    intro.appendChild(document.createTextNode(daily.labelReferToSyntax()));
    const link = document.createElement("a");
    link.textContent = daily.labelSyntaxLink();
    link.setAttribute("href", "https://momentjs.com/docs/#/displaying/format/");
    link.setAttribute("target", "_blank");
    intro.appendChild(link);
    intro.appendChild(document.createElement("br"));
    intro.appendChild(document.createTextNode(daily.labelSyntaxLivePreview()));
    const sample = document.createElement("b");
    sample.className = "u-pop";
    intro.appendChild(sample);

    const group = new host.SettingGroup(this.containerEl);
    group.addSetting((s) => {
      s.setName(t.optionNewFileLocation()).setDesc(t.optionNewFileLocationDescription());
      s.addText((input) => {
        input
          .setPlaceholder(host.i18n.setting.folderPathExamplePlaceholder())
          .setValue(options.folder)
          .onChange((v) => {
            options.folder = v.trim();
            save();
          });
        new host.FolderSuggest(app, input.inputEl, false, true);
      });
    });
    group.addSetting((s) => {
      s.setName(t.optionTemplateFile()).setDesc(t.optionTemplateFileDescription());
      s.addText((input) => {
        input
          .setPlaceholder(t.optionTemplateFilePlaceholder())
          .setValue(options.template)
          .onChange((v) => {
            options.template = v.trim();
            save();
          });
        new host.FilePathSuggest(app, input.inputEl);
      });
    });
    group.addSetting((s) => {
      s.setName(t.optionIdFormat()).setDesc(intro);
      s.addMomentFormat((m) => {
        m.setSampleEl(sample)
          .setDefaultFormat(s16UniqueNoteFormat)
          .setValue(options.format)
          .onChange((v) => {
            options.format = v.trim();
            save();
          });
      });
    });
  };

  return UniqueNoteSettingsTab;
}
