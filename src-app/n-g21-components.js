// n-g21-components.js — settings-framework component kit (clean-room, spec g21 §2.2/§3.2).
// Every component owns one DOM element, setters return `this`, edits report through
// onChange/onClick callbacks and components can be disabled wholesale.
import { env } from "./env.js";
import { displayTooltip } from "./tooltip.js";
import { parseHexColor, rgbToHsl, hslToRgb, rgbToHex, rgbToInt } from "./misc.js";

const ng21C = {}; // ctor registry filled by the factories (same flat scope, lazy reads)

function ng21Base(self) {
  self.disabled = false;
  self.then = function (cb) { cb(this); return self; };
  return self;
}

function ng21Ctor(name) { return ng21C[name]; }

// =====================================================================================================================
// BaseComponent / ValueComponent
// =====================================================================================================================

export function ng21DefineBaseComponent(host) {
  function BaseComponent() { ng21Base(this); }
  ng21C.BaseComponent = BaseComponent;
  return BaseComponent;
}

export function ng21DefineValueComponent(host) {
  function ValueComponent() { ng21Base(this); }
  ng21Inherit(ValueComponent, ng21C.BaseComponent || host.BaseComponent);
  ValueComponent.prototype.registerOptionListener = function (target, key) {
    const self = this;
    target[key] = function (value) {
      if (value === undefined) return self.getValue();
      self.setValue(value);
      return self.getValue();
    };
    return this;
  };
  ng21C.ValueComponent = ValueComponent;
  return ValueComponent;
}

// =====================================================================================================================
// ButtonComponent / ExtraButtonComponent
// =====================================================================================================================

export function ng21DefineButtonComponent(host) {
  function ButtonComponent(containerEl) {
    ng21Base(this);
    this.buttonEl = containerEl.createEl("button");
    this.clickCallback = null;
    const self = this;
    this.buttonEl.addEventListener("click", (event) => {
      if (self.disabled || !self.clickCallback) return;
      self.buttonEl.addClass("mod-loading");
      Promise.resolve()
        .then(() => self.clickCallback(event))
        .finally(() => self.buttonEl.removeClass("mod-loading"));
    });
  }
  const p = ButtonComponent.prototype;
  p.setLoading = function (b) { this.buttonEl.toggleClass("mod-loading", !!b); return this; };
  p.setCta = function () { this.buttonEl.addClass("mod-cta"); return this; };
  p.removeCta = function () { this.buttonEl.removeClass("mod-cta"); return this; };
  p.setWarning = function (b) { this.buttonEl.toggleClass("mod-warning", b !== false); return this; };
  p.setTooltip = function (text) { host.setTooltip(this.buttonEl, text, { delay: host.TOOLTIP_DELAY }); return this; };
  p.setButtonText = function (text) {
    for (const node of Array.from(this.buttonEl.childNodes)) {
      if (node !== this.iconEl) node.remove();
    }
    this.buttonEl.appendChild(document.createTextNode(String(text)));
    return this;
  };
  p.setIcon = function (icon) {
    if (!this.iconEl) {
      this.iconEl = this.buttonEl.createSpan();
      this.buttonEl.prepend(this.iconEl);
    }
    host.setIcon(this.iconEl, icon);
    return this;
  };
  p.setClass = function (cls) { this.buttonEl.addClass(cls); return this; };
  p.onClick = function (cb) { this.clickCallback = cb; return this; };
  p.setDisabled = function (b) {
    this.disabled = !!b;
    this.buttonEl.disabled = !!b;
    return this;
  };
  ng21C.ButtonComponent = ButtonComponent;
  return ButtonComponent;
}

export function ng21DefineExtraButtonComponent(host) {
  function ExtraButtonComponent(containerEl) {
    ng21Base(this);
    this.extraSettingsEl = containerEl.createDiv("clickable-icon extra-setting-button");
    host.setIcon(this.extraSettingsEl, "lucide-settings");
    this.changeCallback = null;
    const self = this;
    this.extraSettingsEl.addEventListener("click", () => {
      if (self.disabled || !self.changeCallback) return;
      self.changeCallback();
    });
  }
  const p = ExtraButtonComponent.prototype;
  p.setTooltip = function (text) { host.setTooltip(this.extraSettingsEl, text, { delay: host.TOOLTIP_DELAY }); return this; };
  p.setIcon = function (icon) { host.setIcon(this.extraSettingsEl, icon); return this; };
  p.onClick = function (cb) { this.changeCallback = cb; return this; };
  p.setDisabled = function (b) {
    this.disabled = !!b;
    this.extraSettingsEl.toggleClass("is-disabled", !!b);
    return this;
  };
  ng21C.ExtraButtonComponent = ExtraButtonComponent;
  return ExtraButtonComponent;
}

// =====================================================================================================================
// ToggleComponent
// =====================================================================================================================

export function ng21DefineToggleComponent(host) {
  function ToggleComponent(containerEl) {
    ng21Base(this);
    this.on = false;
    this.changeCallback = null;
    this.clickCallback = null;
    this.toggleEl = containerEl.createEl("label", { cls: "checkbox-container" });
    this.toggleEl.tabIndex = 0;
    this.inputEl = this.toggleEl.createEl("input", { attr: { type: "checkbox" } });
    const self = this;
    this.toggleEl.addEventListener("change", () => {
      if (self.disabled) return;
      if (navigator.vibrate) navigator.vibrate(100);
      if (self.clickCallback) self.clickCallback();
      self.setValue(self.inputEl.checked);
    });
  }
  const p = ToggleComponent.prototype;
  p.getValue = function () { return this.on; };
  p.setValue = function (value) {
    value = !!value;
    if (value === this.on) return this;
    this.on = value;
    this.inputEl.checked = value;
    this.toggleEl.toggleClass("is-enabled", value);
    if (this.changeCallback) this.changeCallback(value);
    return this;
  };
  p.setSmall = function () { this.toggleEl.addClass("mod-small"); return this; };
  p.setTooltip = function (text) { host.setTooltip(this.toggleEl, text, { delay: host.TOOLTIP_DELAY }); return this; };
  p.onClick = function (cb) { this.clickCallback = cb; return this; };
  p.onChange = function (cb) { this.changeCallback = cb; return this; };
  p.setDisabled = function (b) {
    this.disabled = !!b;
    this.toggleEl.toggleClass("is-disabled", !!b);
    this.inputEl.disabled = !!b;
    return this;
  };
  ng21C.ToggleComponent = ToggleComponent;
  return ToggleComponent;
}

// =====================================================================================================================
// AbstractTextComponent / TextComponent / TextAreaComponent / MomentFormatComponent
// =====================================================================================================================

function ng21TextSetup(self, inputEl, host) {
  ng21Base(self);
  self.inputEl = inputEl;
  self.changeCallback = null;
  inputEl.setAttribute("spellcheck", "false");
  inputEl.addEventListener("input", () => self.onChanged());
  return self;
}

function ng21TextProto(host) {
  const p = {};
  p.getValue = function () { return this.inputEl.value; };
  p.setValue = function (value) {
    if (typeof value !== "string") return this;
    this.inputEl.value = value;
    return this;
  };
  p.setPlaceholder = function (placeholder) { this.inputEl.placeholder = placeholder; return this; };
  p.onChanged = function () {
    if (this.changeCallback) this.changeCallback(this.inputEl.value);
    return this;
  };
  p.onChange = function (cb) { this.changeCallback = cb; return this; };
  p.setDisabled = function (b) {
    this.disabled = !!b;
    this.inputEl.disabled = !!b;
    return this;
  };
  return p;
}

export function ng21DefineAbstractTextComponent(host) {
  function AbstractTextComponent(inputEl) { return ng21TextSetup(this, inputEl, host); }
  Object.assign(AbstractTextComponent.prototype, ng21TextProto(host));
  AbstractTextComponent.prototype.setDisabled = function (b) {
    this.disabled = !!b;
    this.inputEl.disabled = !!b;
    return this;
  };
  ng21C.AbstractTextComponent = AbstractTextComponent;
  return AbstractTextComponent;
}

export function ng21DefineTextComponent(host) {
  function TextComponent(containerEl) {
    const inputEl = containerEl.createEl("input", { attr: { type: "text" } });
    return ng21TextSetup(this, inputEl, host);
  }
  ng21Inherit(TextComponent, ng21C.AbstractTextComponent || host.AbstractTextComponent);
  Object.assign(TextComponent.prototype, ng21TextProto(host));
  TextComponent.prototype.autoSelect = function (selectAll) {
    host.selectOnFocus(this.inputEl, selectAll);
    return this;
  };
  TextComponent.prototype.setDisabled = function (b) {
    this.disabled = !!b;
    this.inputEl.disabled = !!b;
    return this;
  };
  ng21C.TextComponent = TextComponent;
  return TextComponent;
}

export function ng21DefineTextAreaComponent(host) {
  function TextAreaComponent(containerEl) {
    const inputEl = containerEl.createEl("textarea");
    return ng21TextSetup(this, inputEl, host);
  }
  ng21Inherit(TextAreaComponent, ng21C.AbstractTextComponent || host.AbstractTextComponent);
  Object.assign(TextAreaComponent.prototype, ng21TextProto(host));
  TextAreaComponent.prototype.setDisabled = function (b) {
    this.disabled = !!b;
    this.inputEl.disabled = !!b;
    return this;
  };
  ng21C.TextAreaComponent = TextAreaComponent;
  return TextAreaComponent;
}

export function ng21DefineMomentFormatComponent(host) {
  function MomentFormatComponent(containerEl) {
    const inputEl = containerEl.createEl("input", { attr: { type: "text" } });
    ng21TextSetup(this, inputEl, host);
    this.defaultFormat = null;
    this.sampleEl = null;
  }
  ng21Inherit(MomentFormatComponent, ng21C.TextComponent || host.TextComponent);
  Object.assign(MomentFormatComponent.prototype, ng21TextProto(host));
  const mp = MomentFormatComponent.prototype;
  mp.setDefaultFormat = function (format) {
    this.defaultFormat = format;
    this.inputEl.placeholder = format;
    this.updateSample();
    return this;
  };
  mp.setSampleEl = function (el) { this.sampleEl = el; this.updateSample(); return this; };
  mp.onChanged = function () {
    ng21TextProto(host).onChanged.call(this);
    this.updateSample();
    return this;
  };
  mp.setValue = function (value) {
    ng21TextProto(host).setValue.call(this, value);
    this.updateSample();
    return this;
  };
  mp.updateSample = function () {
    if (!this.sampleEl) return;
    const format = this.inputEl.value || this.defaultFormat;
    let text = "";
    if (format && typeof window.moment === "function") {
      try { text = window.moment().format(format); } catch (e) { text = ""; }
    }
    this.sampleEl.setText ? this.sampleEl.setText(text) : (this.sampleEl.textContent = text);
  };
  mp.setDisabled = function (b) {
    this.disabled = !!b;
    this.inputEl.disabled = !!b;
    return this;
  };
  ng21C.MomentFormatComponent = MomentFormatComponent;
  return MomentFormatComponent;
}

// =====================================================================================================================
// SearchComponent
// =====================================================================================================================

export function ng21DefineSearchComponent(host) {
  function SearchComponent(containerEl) {
    this.containerEl = containerEl.createDiv("search-input-container");
    this.inputEl = this.containerEl.createEl("input", { attr: { type: "search", enterkeyhint: "search" } });
    this.changeCallback = null;
    const self = this;
    this.inputEl.setAttribute("spellcheck", "false");
    this.inputEl.addEventListener("input", () => self.onChanged());
    this.clearButtonEl = this.containerEl.createDiv("search-input-clear-button", (el) => {
      el.addEventListener("mousedown", (e) => e.preventDefault());
      el.addEventListener("click", () => {
        if (self.disabled) return;
        self.inputEl.value = "";
        self.onChanged();
        self.inputEl.focus();
      });
    });
    ng21Base(this);
  }
  const p = SearchComponent.prototype;
  p.getValue = function () { return this.inputEl.value; };
  p.setValue = function (value) { if (typeof value === "string") this.inputEl.value = value; return this; };
  p.setPlaceholder = function (t) { this.inputEl.placeholder = t; return this; };
  p.onChanged = function () {
    if (this.changeCallback) this.changeCallback(this.inputEl.value);
    return this;
  };
  p.onChange = function (cb) { this.changeCallback = cb; return this; };
  p.setClass = function (cls) { this.containerEl.addClass(cls); return this; };
  p.autoSelect = function () { host.selectOnFocus(this.inputEl, true); return this; };
  p.addRightDecorator = function (cb) {
    const el = this.containerEl.createDiv("input-right-decorator");
    cb(el);
    return this;
  };
  p.setDisabled = function (b) {
    this.disabled = !!b;
    this.inputEl.disabled = !!b;
    this.clearButtonEl.toggleClass("is-disabled", !!b);
    return this;
  };
  ng21C.SearchComponent = SearchComponent;
  return SearchComponent;
}

// =====================================================================================================================
// DropdownComponent / ProgressBarComponent / SliderComponent / ColorComponent
// =====================================================================================================================

export function ng21DefineDropdownComponent(host) {
  function DropdownComponent(containerEl) {
    ng21Base(this);
    this.selectEl = containerEl.createEl("select", { cls: "dropdown" });
    this.changeCallback = null;
    const self = this;
    this.selectEl.addEventListener("change", () => {
      if (self.changeCallback) self.changeCallback(self.getValue());
    });
  }
  const p = DropdownComponent.prototype;
  p.addOption = function (value, label) {
    const option = this.selectEl.createEl("option", { attr: { value: String(value) } });
    option.setText(label === undefined ? String(value) : String(label));
    return this;
  };
  p.addOptions = function (options) {
    for (const key of Object.keys(options)) this.addOption(key, options[key]);
    return this;
  };
  p.getValue = function () { return this.selectEl.value; };
  p.setValue = function (value) { this.selectEl.value = value; return this; };
  p.onChange = function (cb) { this.changeCallback = cb; return this; };
  p.setDisabled = function (b) { this.disabled = !!b; this.selectEl.disabled = !!b; return this; };
  ng21C.DropdownComponent = DropdownComponent;
  return DropdownComponent;
}

export function ng21DefineProgressBarComponent(host) {
  function ProgressBarComponent(containerEl) {
    ng21Base(this);
    this.progressBar = containerEl.createDiv("setting-progress-bar");
    this.lineEl = this.progressBar.createDiv("setting-progress-bar-inner");
    this.value = 0;
  }
  const p = ProgressBarComponent.prototype;
  p.getValue = function () { return this.value; };
  p.setValue = function (percent) {
    percent = Math.max(0, Math.min(100, percent));
    this.value = percent;
    this.lineEl.style.width = percent + "%";
    return this;
  };
  p.setVisibility = function (visible) { this.progressBar.hidden = !visible; return this; };
  ng21C.ProgressBarComponent = ProgressBarComponent;
  return ProgressBarComponent;
}

export function ng21DefineSliderComponent(host) {
  function SliderComponent(containerEl) {
    ng21Base(this);
    this.sliderEl = containerEl.createEl("input", { attr: { type: "range" }, cls: "slider" });
    this.sliderEl.setAttribute("data-ignore-swipe", "true");
    this.instant = false;
    this.dynamicTooltip = false;
    this.changeCallback = null;
    const self = this;
    this.sliderEl.addEventListener("input", () => {
      if (navigator.vibrate) navigator.vibrate(100);
      if (self.dynamicTooltip) self.showTooltip();
      if (self.instant && self.changeCallback) self.changeCallback(self.getValue());
    });
    this.sliderEl.addEventListener("change", () => {
      if (!self.instant && self.changeCallback) self.changeCallback(self.getValue());
    });
    this.sliderEl.addEventListener("click", (e) => e.stopPropagation());
    this.sliderEl.addEventListener("touchend", () => host.hideTooltip());
  }
  const p = SliderComponent.prototype;
  p.setInstant = function (b) { this.instant = !!b; return this; };
  p.setLimits = function (min, max, step) {
    this.sliderEl.min = String(min);
    this.sliderEl.max = String(max);
    this.sliderEl.step = String(step);
    return this;
  };
  p.getValue = function () { return this.sliderEl.valueAsNumber; };
  p.setValue = function (value) {
    const min = parseFloat(this.sliderEl.min);
    const max = parseFloat(this.sliderEl.max);
    if (!Number.isNaN(min)) value = Math.max(min, value);
    if (!Number.isNaN(max)) value = Math.min(max, value);
    if (value === this.getValue()) return this;
    this.sliderEl.value = String(value);
    if (this.changeCallback) this.changeCallback(this.getValue());
    return this;
  };
  p.getValuePretty = function () {
    const step = this.sliderEl.step;
    const v = this.getValue();
    if (step === "any" || parseFloat(step) < 1) return v.toFixed(2);
    return v.toString();
  };
  p.setDynamicTooltip = function () {
    this.dynamicTooltip = true;
    this.sliderEl.addEventListener("mouseenter", () => this.showTooltip());
    this.sliderEl.addEventListener("mouseleave", () => host.hideTooltip());
    return this;
  };
  p.showTooltip = function () {
    displayTooltip(this.sliderEl, this.getValuePretty(), { placement: "top" });
    return this;
  };
  p.onChange = function (cb) { this.changeCallback = cb; return this; };
  p.setDisabled = function (b) { this.disabled = !!b; this.sliderEl.disabled = !!b; return this; };
  ng21C.SliderComponent = SliderComponent;
  return SliderComponent;
}

export function ng21DefineColorComponent(host) {
  function ColorComponent(containerEl) {
    ng21Base(this);
    this.colorPickerEl = containerEl.createEl("input", { attr: { type: "color" } });
    this.changeCallback = null;
    const self = this;
    this.colorPickerEl.addEventListener("change", () => {
      if (self.changeCallback) self.changeCallback(self.getValue());
    });
  }
  const p = ColorComponent.prototype;
  p.getValue = function () { return this.colorPickerEl.value; };
  p.getValueRgb = function () { return parseHexColor(this.getValue()) || { r: 0, g: 0, b: 0 }; };
  p.getValueHsl = function () { return rgbToHsl(this.getValueRgb()); };
  p.getValueInt = function () { return parseInt(this.getValue().slice(1), 16); };
  p.setValue = function (hex) {
    hex = String(hex).toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex)) return this;
    if (this.colorPickerEl.value === hex && this.getValue() === hex) return this;
    this.colorPickerEl.value = hex;
    if (this.changeCallback) this.changeCallback(this.getValue());
    return this;
  };
  p.setValueRgb = function (rgb) { return this.setValue(rgbToHex(rgb)); };
  p.setValueHsl = function (hsl) { return this.setValueRgb(hslToRgb(hsl)); };
  p.setValueInt = function (int) {
    return this.setValue("#" + (int >>> 0).toString(16).padStart(6, "0"));
  };
  p.onChange = function (cb) { this.changeCallback = cb; return this; };
  p.setDisabled = function (b) { this.disabled = !!b; this.colorPickerEl.disabled = !!b; return this; };
  ng21C.ColorComponent = ColorComponent;
  return ColorComponent;
}

// =====================================================================================================================
// Setting / SettingGroup
// =====================================================================================================================

function ng21AddComponent(host, setting, Ctor, configure, extraCls) {
  const comp = new Ctor(setting.controlEl);
  setting.components.push(comp);
  if (extraCls) setting.settingEl.addClass(extraCls);
  if (configure) configure(comp);
  return setting;
}

export function ng21DefineSetting(host) {
  function Setting(containerEl) {
    this.components = [];
    this.settingEl = containerEl.createDiv("setting-item");
    this.infoEl = this.settingEl.createDiv("setting-item-info");
    this.nameEl = this.infoEl.createDiv("setting-item-name");
    this.descEl = this.infoEl.createDiv("setting-item-description");
    this.controlEl = this.settingEl.createDiv("setting-item-control");
  }
  const p = Setting.prototype;
  p.setName = function (name) { this.nameEl.setText(name); return this; };
  p.setDesc = function (desc) { this.descEl.setText(desc); return this; };
  p.setClass = function (cls) { this.settingEl.addClass(cls); return this; };
  p.setTooltip = function (text, options) { host.setTooltip(this.nameEl, text, options); return this; };
  p.setHeading = function (on) { this.settingEl.toggleClass("setting-item-heading", on !== false); return this; };
  p.setDisabled = function (b) {
    this.settingEl.toggleClass("is-disabled", !!b);
    for (const comp of this.components) if (comp.setDisabled) comp.setDisabled(b);
    return this;
  };
  p.setNoInfo = function () { this.infoEl.style.display = "none"; return this; };
  p.setVisibility = function (v) { v ? this.settingEl.show() : this.settingEl.hide(); return this; };
  p.then = function (cb) { cb(this); return this; };
  p.clear = function () {
    this.controlEl.empty();
    this.components.length = 0;
    return this;
  };
  p.addButton = function (cb) { return ng21AddComponent(host, this, ng21C.ButtonComponent || host.ButtonComponent, cb); };
  p.addExtraButton = function (cb) { return ng21AddComponent(host, this, ng21C.ExtraButtonComponent || host.ExtraButtonComponent, cb); };
  p.addToggle = function (cb) { return ng21AddComponent(host, this, ng21C.ToggleComponent || host.ToggleComponent, cb, "mod-toggle"); };
  p.addText = function (cb) {
    return ng21AddComponent(host, this, ng21C.TextComponent || host.TextComponent, (c) => {
      if (!host.Platform.hasPhysicalKeyboard) {
        c.inputEl.addEventListener("keydown", (e) => {
          if (e.key === "Enter" && !e.isComposing && !e.defaultPrevented) c.inputEl.blur();
        });
      }
      if (cb) cb(c);
    });
  };
  p.addSearch = function (cb) { return ng21AddComponent(host, this, ng21C.SearchComponent || host.SearchComponent, cb); };
  p.addTextArea = function (cb) { return ng21AddComponent(host, this, ng21C.TextAreaComponent || host.TextAreaComponent, cb); };
  p.addMomentFormat = function (cb) { return ng21AddComponent(host, this, ng21C.MomentFormatComponent || host.MomentFormatComponent, cb); };
  p.addDropdown = function (cb) { return ng21AddComponent(host, this, ng21C.DropdownComponent || host.DropdownComponent, cb); };
  p.addColorPicker = function (cb) { return ng21AddComponent(host, this, ng21C.ColorComponent || host.ColorComponent, cb); };
  p.addProgressBar = function (cb) { return ng21AddComponent(host, this, ng21C.ProgressBarComponent || host.ProgressBarComponent, cb); };
  p.addSlider = function (cb) { return ng21AddComponent(host, this, ng21C.SliderComponent || host.SliderComponent, cb); };
  p.addComponent = function (factory) {
    const comp = factory(this.controlEl);
    if (comp != null) this.components.push(comp);
    return this;
  };
  ng21C.Setting = Setting;
  return Setting;
}

export function ng21DefineSettingGroup(host) {
  function SettingGroup(containerEl) {
    this.components = [];
    this.groupEl = containerEl.createDiv("setting-group");
    this.headerEl = host.createDiv("setting-item setting-item-heading");
    this.headerInnerEl = this.headerEl.createDiv("setting-item-info");
    this.headerNameEl = this.headerInnerEl.createDiv("setting-item-name");
    this.controlEl = this.headerEl.createDiv("setting-item-control");
    this.listEl = this.groupEl.createDiv("setting-items");
    this.searchEl = null;
  }
  const p = SettingGroup.prototype;
  p.setHeading = function (text) {
    if (text) {
      this.headerNameEl.setText(text);
      if (this.headerEl.parentNode !== this.groupEl) this.groupEl.insertBefore(this.headerEl, this.listEl);
    } else if (this.headerEl.parentNode) {
      this.headerEl.detach();
    }
    return this;
  };
  p.addClass = function (cls) { this.groupEl.addClass(cls); return this; };
  p.addSetting = function (cb) { cb(new (ng21C.Setting || host.Setting)(this.listEl)); return this; };
  p.addSearch = function (cb) {
    if (!this.searchEl) {
      this.searchEl = this.groupEl.createDiv("setting-group-search");
      this.groupEl.insertBefore(this.searchEl, this.listEl);
    }
    const comp = new (ng21C.SearchComponent || host.SearchComponent)(this.searchEl);
    this.components.push(comp);
    if (cb) cb(comp);
    return this;
  };
  p.addExtraButton = function (cb) {
    const comp = new (ng21C.ExtraButtonComponent || host.ExtraButtonComponent)(this.controlEl);
    this.components.push(comp);
    if (cb) cb(comp);
    return this;
  };
  ng21C.SettingGroup = SettingGroup;
  return SettingGroup;
}

// =====================================================================================================================
// SettingTab / PluginSettingTab / InstanceSettingTab (exposed as PluginInstanceSettingTab)
// =====================================================================================================================

export function ng21DefineSettingTab(host) {
  function SettingTab(app, setting) {
    this.app = app;
    this.setting = setting;
    this.containerEl = host.createDiv("vertical-tab-content");
    this.navEl = null;
  }
  SettingTab.prototype.hide = function () {};
  ng21C.SettingTab = SettingTab;
  return SettingTab;
}

export function ng21DefinePluginSettingTab(host) {
  function PluginSettingTab(app, plugin) {
    const self = host.SettingTab.call(this, app, plugin) || this;
    self.plugin = plugin;
    self.name = plugin.manifest.name;
    self.id = plugin.manifest.id;
    return self;
  }
  ng21Inherit(PluginSettingTab, host.SettingTab);
  ng21C.PluginSettingTab = PluginSettingTab;
  return PluginSettingTab;
}

export function ng21DefineInstanceSettingTab(host) {
  function PluginInstanceSettingTab(app, plugin) {
    const self = host.SettingTab.call(this, app, plugin) || this;
    self.plugin = plugin;
    self.name = plugin.instance.name;
    self.id = plugin.instance.id;
    return self;
  }
  ng21Inherit(PluginInstanceSettingTab, host.SettingTab);
  ng21C.PluginInstanceSettingTab = PluginInstanceSettingTab;
  return PluginInstanceSettingTab;
}

function ng21Inherit(child, parent) {
  if (typeof parent !== "function") return;
  child.prototype = Object.create(parent.prototype);
  child.prototype.constructor = child;
}
