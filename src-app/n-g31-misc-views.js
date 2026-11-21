// g31 clean-room: note-composer settings tab + outline heading tree item
// (spec g31 part E).
import { env } from "./env.js";

const NG31_OUTLINE_ITEM_INFO = () => ({
  height: 0, width: 0, childLeft: 0, childLeftPadding: 0, childTop: 0,
  computed: false, queued: false, hidden: false, next: false,
});

export function ng31NoteComposerSettingsTab() {
  const Base = env().Y0;
  return class Ng31NoteComposerSettingsTab extends Base {
    constructor(app, plugin, instance) {
      super(app, plugin);
      this.icon = "merge";
      this.instance = instance;
    }

    display() {
      const i18n = env().gm.plugins.noteComposer;
      const options = this.instance.options;
      const save = () => this.plugin.saveData(options);
      this.containerEl.empty();
      const group = new (env().qk)(this.containerEl);

      group.addSetting((s) => s
        .setName(i18n.optionSplitReplacementText())
        .setDesc(i18n.optionSplitReplacementTextDescription())
        .addDropdown((d) => {
          const choices = [
            ["link", i18n.optionChoiceSplitReplacementTextLink()],
            ["embed", i18n.optionChoiceSplitReplacementTextEmbed()],
            ["none", i18n.optionChoiceSplitReplacementTextNone()],
          ];
          for (const [value, label] of choices) d.addOption(value, label);
          d.setValue(options.replacementText || "link");
          d.onChange((value) => {
            options.replacementText = value;
            save();
          });
        }));

      group.addSetting((s) => s
        .setName(i18n.optionTemplateFile())
        .setDesc(i18n.optionTemplateFileDescription(env().nm))
        .addText((t) => {
          t.setPlaceholder(env().gm.setting.filePathExamplePlaceholder());
          t.setValue(options.template);
          t.onChange((value) => {
            options.template = value.trim();
            save();
          });
          new (env().TI)(this.app, t.inputEl);
        }));

      group.addSetting((s) => s
        .setName(i18n.optionConfirmFileMerge())
        .setDesc(i18n.optionConfirmFileMergeDescription())
        .addToggle((t) => {
          t.setValue(options.askBeforeMerging);
          t.onChange((value) => {
            options.askBeforeMerging = value;
            save();
          });
        }));
    }
  };
}


// Collapsible heading row of the outline pane; click jumps to the heading in
// the corresponding leaf (or opens the file in a fresh leaf).
export function ng31OutlineHeadingItem() {
  const Base = env().XL;
  return class Ng31OutlineHeadingItem extends Base {
    constructor(view, tree, heading) {
      super();
      this.view = view;
      this.tree = tree;
      this.heading = heading;
      this.pusherEl = env().JH();
      this.info = NG31_OUTLINE_ITEM_INFO();
      this.vChildren = new (env().UH)(this);
      this.setClickable(true);
      this.setCollapsible(false);
      this.headingText = env().OT(heading);
      this.innerEl.setText(this.headingText);
    }

    onSelfClick() {
      const leaf = this.view.findCorrespondingLeaf();
      const state = { line: this.heading.position.start.line };
      let target;
      if (leaf) {
        this.view.leaf.workspace.setActiveLeaf(leaf, { focus: true });
        leaf.view.setEphemeralState(state);
        target = leaf;
      } else {
        target = this.view.app.workspace.getLeaf();
        target.openFile(this.view.file, { eState: state });
      }
      return target;
    }

    async updateCollapsed(collapsed) {
      if (!this.collapsed) this.tree.handleCollapseAll?.(false);
      await super.updateCollapsed(collapsed);
      this.tree.infinityScroll.invalidate(this);
    }
  };
}

