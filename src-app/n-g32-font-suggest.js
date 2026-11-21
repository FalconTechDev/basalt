// g32 clean-room: font-family input suggest backed by the probe cache.
import { inherit } from "./inherit.js";
import { ng32FontNames } from "./n-g32-font-probe.js";

export function ng32DefineFontSuggest(host) {
  function Ng32FontSuggest(app, textInputEl) {
    const self = host.AbstractInputSuggest.call(this, app, textInputEl) || this;
    self.app = app;
    self.textInputEl = textInputEl;
    self.fonts = () => ng32FontNames(host);
    return self;
  }
  inherit(Ng32FontSuggest, host.AbstractInputSuggest);
  const proto = Ng32FontSuggest.prototype;

  proto.renderSuggestion = function (text, el) {
    el.setText(text);
    el.style.fontFamily = text;
  };

  proto.getSuggestions = function (query) {
    const needle = (query || "").toLowerCase();
    const out = [];
    if (!needle) out.push("Inter");
    for (const name of this.fonts()) {
      if (name.toLowerCase().includes(needle)) out.push(name);
    }
    return out;
  };

  proto.selectSuggestion = function (text, event) {
    this.setValue(text);
    if (this.textInputEl.trigger) this.textInputEl.trigger("input");
    else this.textInputEl.dispatchEvent(new Event("input"));
    this.close();
    return host.AbstractInputSuggest.prototype.selectSuggestion.call(this, text, event);
  };

  return Ng32FontSuggest;
}
