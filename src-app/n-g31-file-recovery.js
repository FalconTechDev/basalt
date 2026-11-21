// g31 clean-room: file-recovery settings tab + footnote list item
// (spec g31 part D).
import { env } from "./env.js";

export function ng31FileRecoverySettingsTab() {
  const Base = env().Y0;
  return class Ng31FileRecoverySettingsTab extends Base {
    constructor(app, plugin, instance) {
      super(app, plugin);
      this.icon = "history";
      this.instance = instance;
    }

    display() {
      const i18n = env().gm.plugins.fileRecovery;
      const options = this.instance.options;
      this.containerEl.empty();
      const group = new (env().qk)(this.containerEl);

      if (!env().Yl.supportsIndexedDb) {
        group.addSetting((s) => s
          .setName(env().gm.interface.msgIndexedDbNotSupported())
          .setDesc(env().gm.interface.msgIndexedDbIOS()));
        return;
      }

      const numericField = (name, desc, get, set, min) => (s) => s
        .setName(name)
        .setDesc(desc)
        .addText((t) => t
          .setValue(String(get()))
          .onChange((value) => {
            const n = parseFloat(value);
            if (!isNaN(n) && n >= min) {
              set(n);
              this.plugin.saveData(options);
            }
          }));

      group.addSetting(numericField(
        i18n.optionInterval(), i18n.optionIntervalDescription(),
        () => options.intervalMinutes, (n) => { options.intervalMinutes = n; }, 0));
      group.addSetting(numericField(
        i18n.optionKeep(), i18n.optionKeepDescription(),
        () => options.keepDays, (n) => { options.keepDays = n; }, 1));

      group.addSetting((s) => s
        .setName(i18n.optionOpenHistory())
        .setDesc(i18n.optionOpenHistoryDescription())
        .addButton((b) => b
          .setButtonText(i18n.buttonViewHistory())
          .setCta()
          .onClick(() => this.instance.openModal())));

      group.addSetting((s) => s
        .setName(i18n.optionClear())
        .setDesc(i18n.optionClearDescription())
        .addButton((b) => b
          .setButtonText(i18n.buttonClearHistory())
          .setWarning()
          .onClick(() => {
            const content = createDiv();
            content.appendChild(createEl("p", {
              cls: "mod-warning",
              text: i18n.labelClearWarning(),
            }));
            const modal = new (env().nb)(this.app);
            modal.setTitle(i18n.optionClear());
            modal.setContent(content);
            modal.addButton("mod-warning", i18n.buttonClearHistory(), () => {
              this.instance.clearData();
              new (env().fb)(i18n.msgClearComplete());
            });
            modal.addCancelButton();
            modal.open();
          })));
    }
  };
}


// One row per footnote reference with an embedded editable link.
export function ng31FootnoteListItem() {
  const Base = env().jm;
  return class Ng31FootnoteListItem extends Base {
    constructor(app, file, footnoteId, index, positions = []) {
      super();
      this.app = app;
      this.file = file;
      this.footnoteId = footnoteId;
      this.index = index;
      this.footRefPositions = positions;
      this.embed = null;

      this.containerEl = createDiv("footnote-list-item");
      const row = createDiv("footnote");
      this.idEl = createDiv("footnote-id");
      this.contentEl = createDiv("footnote-content");
      row.appendChild(this.idEl);
      row.appendChild(this.contentEl);
      this.containerEl.appendChild(row);
      this.updateBadge(index, positions);
    }

    updateBadge(index, positions) {
      this.idEl.toggleClass("mod-no-occurrences", positions.length === 0);
      const text = String(index + 1);
      if (this.idEl.textContent !== text) this.idEl.setText(text);
    }

    onload() { this.renderEmbed(); }

    onunload() {
      if (this.containerEl.detach) this.containerEl.detach();
      else this.containerEl.remove();
    }

    async renderEmbed() {
      const holder = createDiv();
      this.contentEl.appendChild(holder);
      const linktext = "#[^" + this.footnoteId + "]";
      this.embed = this.addChild(new (env().lJ)({
        app: this.app,
        linktext,
        sourcePath: this.file.path,
        containerEl: holder,
        depth: 0,
      }, this.file, linktext));
      this.embed.editable = true;
      await this.embed.loadFile();

      this.containerEl.addEventListener("click", (ev) => {
        if (this.embed.editorEl.isShown()) return;
        this.containerEl.classList.add("is-editing");
        this.embed.showEditor(env().Fl(ev));
        this.embed.editMode.register(() => {
          this.containerEl.classList.remove("is-editing");
        });
        this.embed.editMode.registerDomEvent(this.containerEl.win, "click", (domEv) => {
          const target = domEv.targetNode || domEv.target;
          if (target && !this.containerEl.contains(target)) {
            this.containerEl.classList.remove("is-editing");
            this.embed.showPreview();
          }
        });
      });
    }

    update(index, positions = []) {
      this.index = index;
      this.footRefPositions = positions;
      this.updateBadge(index, positions);
    }

    onResize() {
      this.embed?.previewMode?.renderer?.onResize?.();
    }
  };
}

