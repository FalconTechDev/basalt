// g29 clean-room: promise-based prompt modal (spec Part F). Function-style
// base call + inherit(), matching how the bundle's DialogModal/TextComponent
// are shaped; prototype methods stay subclass-safe.
import { inherit } from "./inherit.js";

export function s04PromptModal(host) {
  function PromptModal(app) {
    const self = host.DialogModal.call(this, app) || this;
    self.ctaCls = "mod-cta";
    self.ctaText = "";
    self.resolve = null;
    self.promise = null;
    self.scope.register([], "Enter", () => self.accept());
    return self;
  }
  inherit(PromptModal, host.DialogModal);
  const proto = PromptModal.prototype;

  proto.setCta = function (cls, text) {
    this.ctaCls = cls;
    this.ctaText = text;
    return this;
  };

  proto.onOpen = function () {
    const base = host.DialogModal.prototype.onOpen;
    if (base) base.call(this);
    this.promise = new Promise((resolve) => { this.resolve = resolve; });
  };

  proto.settle = function (value) {
    const resolve = this.resolve;
    if (!resolve) return;
    this.resolve = null;
    resolve(value);
    this.close();
  };

  proto.accept = function () { this.settle(true); };
  proto.cancel = function () { this.settle(false); };

  proto.prompt = function () {
    this.addButton(this.ctaCls, this.ctaText, () => this.accept());
    this.addCancelButton(() => this.cancel());
    this.open();
    return this.promise;
  };

  proto.onClose = function () {
    const base = host.DialogModal.prototype.onClose;
    if (base) base.call(this);
    this.cancel();
  };

  return PromptModal;
}

export function s04NumberComponent(host) {
  function NumberComponent() {
    const self = host.TextComponent.apply(this, arguments) || this;
    self.inputEl.setAttribute("type", "number");
    return self;
  }
  inherit(NumberComponent, host.TextComponent);
  const proto = NumberComponent.prototype;

  proto.getValueAsNumber = function () { return this.inputEl.valueAsNumber; };

  proto.setValueAsNumber = function (value) {
    this.inputEl.valueAsNumber = value;
    return this;
  };

  proto.setLimits = function (min, max, step) {
    this.inputEl.setAttrs({ min, max, step });
    return this;
  };

  return NumberComponent;
}
