// g16 clean-room: the shared chip-list (multi-select) widget used by the tags,
// aliases and multitext property types, plus the tag-value suggest.
import { env } from "./env.js";
import { ng16MkWidget } from "./n-g16-widgets.js";
import { ng16List, ng16Strs, ng16EmptyValue, ng16TagOk, ng16TagText, ng16TagSuggestions, ng16Unique, ng16PropT } from "./n-g16-shared.js";

/**
 * ng16MultiSelect(host, opts)(ctx, el, value) -> widget.
 * opts: { normalize(v), display(v), allow(v, values), invalid(v), preventDup(v, values), setupInputEl(input, values) }
 */
export function ng16MultiSelect(host, opts = {}) {
  return function (ctx, el, value) {
    const w = ng16MkWidget(ctx, el, value);
    let values = ng16Strs(value);
    const box = el.createDiv("multi-select-container");
    const norm = (v) => (opts.normalize ? opts.normalize(v) : String(v));
    const emit = () => ctx.onChange(values.length ? values.slice() : null);
    const dup = (v) => opts.preventDup ? opts.preventDup(v, values) : values.indexOf(v) >= 0;
    const flashDup = (pill) => { pill.addClass("multi-select-duplicate"); setTimeout(() => pill.removeClass("multi-select-duplicate"), 2000); };
    const render = () => {
      box.empty();
      for (const v of values) {
        const p = box.createDiv("multi-select-pill");
        const c = p.createSpan({ cls: "multi-select-pill-content" });
        if (opts.renderPill) opts.renderPill(c, v, ctx);
        else c.setText(opts.display ? opts.display(v) : v);
        if (opts.invalid && opts.invalid(v)) { p.addClass("is-invalid"); try { host.setTooltip(p, ng16PropT(host).msgInvalidTag()); } catch (e) {} }
        const x = p.createDiv("multi-select-pill-remove-button");
        host.setIcon(x, "lucide-x");
        x.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); values = values.filter((y) => y !== v); emit(); render(); });
      }
      const input = box.createDiv({ cls: "multi-select-input", attr: { contenteditable: "true", tabindex: 0 } });
      input.addEventListener("keydown", (e) => {
        if (e.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          const t = input.textContent.trim();
          if (t) addText(t);
        } else if (e.key === "Escape") { input.setText(""); ctx.blur && ctx.blur(); }
        else if (e.key === "Backspace" && !input.textContent) {
          const pills = box.querySelectorAll(".multi-select-pill");
          const last = pills[pills.length - 1];
          if (last) { values.pop(); emit(); render(); }
        }
      });
      input.addEventListener("blur", () => { const t = input.textContent.trim(); if (t) addText(t); });
      box.addEventListener("click", (e) => { if (e.target === box) input.focus(); });
      if (opts.setupInputEl) try { opts.setupInputEl(input, values, render); } catch (err) {}
      w.input = input;
    };
    function addText(t) {
      if (opts.allow && !opts.allow(t, values)) return;
      const v = norm(t);
      if (dup(v)) { const pill = box.querySelector(".multi-select-pill"); if (pill) flashDup(pill); return; }
      values.push(v); emit(); render();
    }
    render();
    w.setValue = (v) => { values = ng16Strs(v); render(); };
    return w;
  };
}

export function ng16DefineS06MultiSelect(host) { return ng16MultiSelect(host); }

export function ng16DefineS06TagsValue(host) {
  return ng16MultiSelect(host, {
    normalize: (v) => ng16TagText(v),
    display: (v) => "#" + ng16TagText(v),
    allow: (v) => { const t = ng16TagText(v); return !!t && ng16TagOk(t); },
    invalid: (v) => !ng16TagOk(v),
    preventDup: (v, vals) => vals.some((x) => ng16TagText(x) === ng16TagText(v)),
  });
}

export function ng16DefineS06AliasesValue(host) {
  return ng16MultiSelect(host, {
    normalize: (v) => String(v).trim(),
    allow: (v) => !!String(v).trim(),
    invalid: (v) => !String(v).trim(),
  });
}

export function ng16DefineS06MultiTextValue(host) {
  return ng16MultiSelect(host, { allow: (v) => !!String(v) });
}

export function ng16DefineS06TagValueSuggest(host) {
  return function (app, inputEl) {
    const s = new host.AbstractInputSuggest(app, inputEl);
    try { s.suggestEl.addClass("mod-property-value"); } catch (e) {}
    s.getSuggestions = (q) => {
      const vals = ng16Strs(s._values || []);
      return ng16TagSuggestions(app.metadataCache, q, q.startsWith("#"), host)
        .filter((x) => !vals.some((v) => ng16TagText(v) === ng16TagText(x.tag)))
        .map((x) => ({ tag: x.tag, score: x.score, matches: x.matches }));
    };
    s.renderSuggestion = (v, el) => { try { host.renderResults(el, v.tag, v.matches); } catch (e) { el.setText(v.tag); } };
    s.selectSuggestion = (v, e) => {
      if (!v) return;
      s.close();
      const cur = s.getValue ? s.getValue() : "";
      const withHash = cur.startsWith("#");
      s.setValue(withHash ? "#" + ng16TagText(v.tag) : ng16TagText(v.tag));
      if (e && e.key !== "Tab") inputEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    };
    return s;
  };
}
