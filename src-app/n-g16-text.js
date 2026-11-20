// g16 clean-room: the long-text property widget. Renders link chips through
// ng16RenderLinkValue (env().oO) when the whole value is a link, else a
// contenteditable input with paste-normalisation and a ValueLinkSuggest.
import { env } from "./env.js";
import { ng16MkWidget } from "./n-g16-widgets.js";
import { ng16EmptyValue } from "./n-g16-shared.js";

export function ng16DefineS06TextValue(host) {
  return function (ctx, el, value) {
    const w = ng16MkWidget(ctx, el, value);
    w.value = value == null ? "" : String(value);
    const d = el.createDiv({ cls: "metadata-input-longtext", attr: { contenteditable: "true", tabindex: 0 } });
    d.setText(w.value);
    try { d.spellcheck = !!(ctx.app.vault.getConfig && ctx.app.vault.getConfig("spellcheck")); } catch (e) { /* config optional */ }
    const render = () => {
      el.empty();
      const wrap = el.createDiv({ cls: "metadata-link" });
      const inner = wrap.createDiv({ cls: "metadata-link-inner" });
      let ok = false;
      try { ok = !!(env().oO && env().oO(w.value, inner, ctx, w)); } catch (e) { ok = false; }
      if (ok) {
        const flair = wrap.createDiv({ cls: "metadata-link-flair clickable-icon" });
        host.setIcon(flair, "lucide-pencil");
        flair.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); el.empty(); el.appendChild(d); d.focus(); });
      } else {
        wrap.remove();
        el.appendChild(d);
      }
    };
    render();
    const commit = () => ctx.onChange(ng16EmptyValue(d.textContent.trimEnd()));
    d.addEventListener("input", () => { w.value = d.textContent; if (env().mg) try { env().mg(d); } catch (e) {} });
    d.addEventListener("blur", commit);
    d.addEventListener("paste", (e) => { if (env().vg) try { env().vg(e); } catch (err) {} });
    d.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); ctx.blur && ctx.blur(); }
      if (e.key === "Escape") { d.setText(w.value); ctx.blur && ctx.blur(); }
    });
    try {
      const S = env().DO;
      if (S) new S(ctx, d, (v) => ctx.onChange(ng16EmptyValue(v)));
    } catch (e) { /* link suggest optional */ }
    w.input = d;
    w.setValue = (v) => { w.value = v == null ? "" : String(v); d.setText(w.value); render(); };
    return w;
  };
}
