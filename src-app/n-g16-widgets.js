// g16 clean-room s06 value widgets: the simple per-type editors rendered inside a
// property row. Each factory returns (ctx, containerEl, value) -> widget
// {focus(pos), setValue(v)}; ctx = {app, key, onChange, sourcePath, blur, hoverSource}.
import { env } from "./env.js";
import { ng16EmptyValue, ng16PropT, ng16DateRe, ng16DateTimeRe, ng16Lower } from "./n-g16-shared.js";

export function ng16MkWidget(ctx, el, value) {
  return {
    ctx, el, value,
    focus(pos = "both") {
      const t = this.input || this.el.querySelector("input,[contenteditable]");
      if (t && t.focus) { t.focus(); if (pos !== "start" && t.select) t.select(); }
    },
    setValue(v) { this.value = v; if (this.render) this.render(v); else if (this.input) this.input.value = v == null ? "" : String(v); },
  };
}

export function ng16DefineS06ValueItem(host) { return function (ctx, el, value) { return ng16MkWidget(ctx, el, value); }; }

export function ng16DefineS06UnknownValue(host) {
  return function (ctx, el, value) {
    const w = ng16MkWidget(ctx, el, value);
    el.createSpan({ cls: "metadata-property-value-item mod-unknown", text: JSON.stringify(value), attr: { tabindex: 0 } });
    return w;
  };
}

export function ng16DefineS06CheckboxValue(host) {
  return function (ctx, el, value) {
    const w = ng16MkWidget(ctx, el, value);
    const i = el.createEl("input", { cls: "metadata-input-checkbox", type: "checkbox", attr: { tabindex: 0 } });
    w.input = i;
    i.checked = !!value;
    if (value == null) i.dataset.indeterminate = "true";
    i.addEventListener("change", () => { delete i.dataset.indeterminate; ctx.onChange(i.checked); });
    i.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); ctx.blur && ctx.blur(); } });
    w.setValue = (v) => { w.value = v; i.checked = !!v; if (v == null) i.dataset.indeterminate = "true"; else delete i.dataset.indeterminate; };
    return w;
  };
}

export function ng16DefineS06NumberValue(host) {
  return function (ctx, el, value) {
    const w = ng16MkWidget(ctx, el, value);
    const i = el.createEl("input", { cls: "metadata-input-number", type: "number", attr: { inputmode: "decimal", step: "any", placeholder: ng16PropT(host).labelNoValue() } });
    w.input = i;
    let committed = value;
    const show = (v) => { i.value = (v == null || Number.isNaN(v)) ? "" : String(v); i.classList.toggle("is-empty", !i.value); };
    show(value);
    const commit = () => {
      if (i.validity && i.validity.valid) {
        const v = i.value === "" ? null : +i.value;
        committed = v; ctx.onChange(v);
      } else { show(committed); }
    };
    const fail = () => host.displayTooltip(i, ng16PropT(host).msgInvalidNumber(), { classes: ["mod-error"] });
    i.addEventListener("input", () => i.classList.toggle("is-empty", !i.value));
    i.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); if (i.validity.valid) commit(); else fail(); ctx.blur && ctx.blur(); }
      if (e.key === "Escape") { show(committed); ctx.blur && ctx.blur(); }
    });
    i.addEventListener("blur", commit);
    w.setValue = (v) => { committed = v; show(v); };
    return w;
  };
}
