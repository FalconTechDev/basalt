// g16 clean-room s06 value widgets, part 2: file/folder path inputs with
// autocomplete, date/datetime-local pickers and the link-aware long-text widget.
import { env } from "./env.js";
import { ng16MkWidget } from "./n-g16-widgets.js";
import { ng16EmptyValue, ng16PropT, ng16PluginT, ng16DateRe, ng16DateTimeRe } from "./n-g16-shared.js";

function ng16PathInput(host, ctx, el, value, suggestCtor) {
  const w = ng16MkWidget(ctx, el, value);
  const i = el.createEl("input", { cls: "metadata-input-text", type: "text", attr: { placeholder: ng16PropT(host).labelNoValue() } });
  w.input = i;
  i.value = value == null ? "" : String(value);
  i.addEventListener("change", () => ctx.onChange(ng16EmptyValue(i.value)));
  i.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); ctx.blur && ctx.blur(); } });
  try {
    if (suggestCtor) {
      const s = new suggestCtor(ctx.app, i);
      if (s && s.suggestEl) s.suggestEl.addClass("mod-property-value");
    }
  } catch (e) { /* suggestions are best-effort */ }
  w.setValue = (v) => { w.value = v; i.value = v == null ? "" : String(v); };
  return w;
}

export function ng16DefineS06FileValue(host) {
  return function (ctx, el, value) { return ng16PathInput(host, ctx, el, value, env().s25FilePathSuggest); };
}

export function ng16DefineS06FolderValue(host) {
  return function (ctx, el, value) { return ng16PathInput(host, ctx, el, value, env().PI); };
}

function ng16DateInput(host, ctx, el, value, cls, re, max, commitFmt) {
  const w = ng16MkWidget(ctx, el, value);
  const i = el.createEl("input", { cls: "metadata-input-text " + cls, type: cls === "mod-date" ? "date" : "datetime-local", attr: { max } });
  w.input = i;
  const s = typeof value === "string" ? value : "";
  i.value = re.test(s) ? (cls === "mod-date" ? s.slice(0, 10) : s.slice(0, 16)) : "";
  let committed = i.value;
  i.addEventListener("input", () => i.classList.toggle("is-empty", !i.value));
  i.addEventListener("blur", () => {
    const probe = i.value.length === 16 && cls !== "mod-date" ? i.value + ":00" : i.value;
    if (!i.value || re.test(probe)) {
      committed = i.value;
      ctx.onChange(ng16EmptyValue(i.value ? commitFmt(i.value) : null));
    } else i.value = committed;
  });
  i.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { i.value = committed; ctx.blur && ctx.blur(); }
    if (e.key === "Enter") { e.preventDefault(); ctx.blur && ctx.blur(); }
  });
  w.setValue = (v) => { const t = typeof v === "string" ? v : ""; i.value = re.test(t) ? (cls === "mod-date" ? t.slice(0, 10) : t.slice(0, 16)) : ""; committed = i.value; };
  return w;
}

export function ng16DefineS06DateValue(host) {
  return function (ctx, el, value) {
    const w = ng16DateInput(host, ctx, el, value, "mod-date", ng16DateRe, "9999-12-31", (v) => v.slice(0, 10));
    try {
      const plugin = ctx.app.internalPlugins && ctx.app.internalPlugins.getPluginById("daily-notes");
      if (plugin && plugin.instance && plugin.instance.enabled !== false) {
        const btn = w.el.createDiv("clickable-icon");
        host.setIcon(btn, "lucide-link");
        host.setTooltip(btn, ng16PluginT(host).actionOpenDailyNote ? ng16PluginT(host).actionOpenDailyNote() : "Open daily note");
        btn.addEventListener("click", () => {
          const moment = window.moment;
          if (!moment) return;
          const file = plugin.instance.getDailyNote(moment(w.input.value));
          if (file) ctx.app.workspace.getLeaf().openFile(file);
        });
      }
    } catch (e) { /* daily-notes integration is optional */ }
    return w;
  };
}

export function ng16DefineS06DailyNoteDateValue(host) { return ng16DefineS06DateValue(host); }

export function ng16DefineS06DateTimeValue(host) {
  return function (ctx, el, value) {
    return ng16DateInput(host, ctx, el, value, "mod-datetime", ng16DateTimeRe, "9999-12-31T23:59",
      (v) => (v.length === 16 ? v + ":00" : v));
  };
}
