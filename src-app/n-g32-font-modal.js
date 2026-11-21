// g32 clean-room: ordered custom interface-font list editor.
import { inherit } from "./inherit.js";
import { ng32FontAvailable } from "./n-g32-constants.js";
import { ng32FontProbeDone } from "./n-g32-font-probe.js";

function ng32RemoveFont(list, name) {
  if (typeof list.remove === "function") list.remove(name);
  else {
    const at = list.indexOf(name);
    if (at >= 0) list.splice(at, 1);
  }
}

export function ng32DefineFontListModal(host) {
  const Base = host.ButtonModal;
  const fontT = () => host.i18n.setting.appearance;

  function Ng32FontListModal(app, title, values, callback) {
    const self = Base.call(this, app) || this;
    self.setTitle(title);
    self.app = app;
    self.values = values;
    self.callback = callback;
    self.descEl = self.contentEl.createDiv();
    self.fontListEl = self.contentEl.createDiv("setting-font-list");
    self.textInputEl = null;
    self.fontWarningEl = null;
    self.fontSuggest = null;

    new host.Setting(self.contentEl)
      .setName(fontT().labelFontName())
      .addExtraButton((button) => button
        .setIcon("lucide-alert-circle")
        .setTooltip(fontT().msgFontNotFound())
        .then((component) => {
          self.fontWarningEl = component.extraSettingsEl;
          component.extraSettingsEl.addClass("mod-warning");
          component.extraSettingsEl.hide();
        }))
      .addText((text) => {
        self.textInputEl = text.inputEl;
        text.setPlaceholder(fontT().optionFontPlaceholder());
        text.onChange(async (value) => {
          const available = await ng32FontAvailable(value);
          if (self.fontWarningEl) self.fontWarningEl.toggle(!available);
        });
        self.textInputEl.addEventListener("focus", () => {
          self.modalEl.style.transition = "unset";
          host.nextFrame(() => { self.modalEl.style.transition = ""; });
          if (!self.fontSuggest) {
            self.fontSuggest = new host.s16FontSuggest(app, self.textInputEl);
            self.fontSuggest.onSelect((value, event) => {
              self.addCurrent();
              if (event instanceof MouseEvent) self.textInputEl.blur();
            });
            ng32FontProbeDone.then(() => self.fontSuggest.onInputChange());
          }
        });
        self.textInputEl.addEventListener("keydown", (event) => {
          if (!event.isComposing && event.key === "Enter") self.addCurrent();
        });
      })
      .addButton((button) => button
        .setButtonText(host.i18n.interface.buttonAdd())
        .onClick(() => self.addCurrent()));

    self.addButton("mod-cta", host.i18n.dialogue.buttonSave(), () => {
      self.close();
      callback(self.values);
    });
    self.addCancelButton();
    return self;
  }
  inherit(Ng32FontListModal, Base);
  const proto = Ng32FontListModal.prototype;

  proto.onOpen = function () { this.display(); };

  proto.addCurrent = function () {
    const value = this.textInputEl ? this.textInputEl.value : "";
    if (value && !(typeof this.values.contains === "function" ? this.values.contains(value) : this.values.includes(value))) {
      this.values.push(value);
      this.display();
    }
    if (this.textInputEl) this.textInputEl.value = "";
    if (this.fontWarningEl) this.fontWarningEl.hide();
  };

  proto.display = function () {
    const self = this;
    const values = this.values;
    this.descEl.setText(values.length === 0 ? fontT().labelNoCustomFontSet() : fontT().labelFontApplied());
    this.fontListEl.empty();
    const render = (name) => {
      this.fontListEl.createDiv("mobile-option-setting-item", (row) => {
        row.createSpan({ cls: "mobile-option-setting-item-name", text: name }).style.fontFamily = name;
        const badge = row.createSpan("mobile-option-setting-item-option-icon");
        ng32FontAvailable(name).then((available) => {
          if (available) {
            badge.addClass("mod-success");
            host.setIcon(badge, "lucide-check-circle-2");
            host.setTooltip(badge, fontT().msgFontFound());
          } else {
            badge.addClass("mod-warning");
            host.setIcon(badge, "lucide-alert-circle");
            host.setTooltip(badge, fontT().msgFontNotFound());
          }
        });
        row.createDiv("clickable-icon mobile-option-setting-item-option-icon", (remove) => {
          host.setIcon(remove, "lucide-x");
          host.setTooltip(remove, host.i18n.interface.deleteActionShortName());
          remove.addEventListener("click", () => {
            ng32RemoveFont(values, name);
            self.display();
          });
        });
        row.createDiv("clickable-icon mobile-option-setting-item-option-icon mobile-option-setting-drag-icon", (handle) => {
          host.setIcon(handle, "lucide-menu");
          host.setTooltip(handle, host.i18n.interface.dragToRearrange());
          host.makeDragReorderable(row, row, self.fontListEl, 5, () => null, (to) => {
            ng32RemoveFont(values, name);
            values.splice(to, 0, name);
            self.display();
          });
        });
      });
    };
    for (const name of values) render(name);
  };

  return Ng32FontListModal;
}
