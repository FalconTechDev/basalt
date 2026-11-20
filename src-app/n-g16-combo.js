// g16 clean-room: property-name combobox, the generic Combobox popover, the
// file/folder/markdown path suggests and the change-type confirmation modal.
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { ng16MkWidget } from "./n-g16-widgets.js";
import { ng16EmptyValue, ng16PropT, ng16PluginT, ng16Compare, ng16Widget } from "./n-g16-shared.js";

// ---- path suggests (popup class mod-property-value) ---------------------------------

export function ng16DefineS06FilteredFileSuggest(host) {
  function S(app, inputEl, predicate) {
    const self = host.FilePathSuggest.call(this, app, inputEl) || this;
    self.predicate = predicate || null;
    return self;
  }
  inherit(S, host.FilePathSuggest);
  S.prototype.filePredicate = function (file) { return !this.predicate || this.predicate(file); };
  return S;
}

export function ng16DefineS06MarkdownFileSuggest(host) {
  function S(app, inputEl) { return ng16DefineS06FilteredFileSuggest(host).call(this, app, inputEl, (f) => f.extension === "md"); }
  inherit(S, host.FilePathSuggest);
  S.prototype.filePredicate = function (file) { return file.extension === "md"; };
  return S;
}

export function ng16DefineS06FolderSuggest(host) {
  function S(app, inputEl, folderPredicate, allowNull) {
    const Base = env().AI || host.FilePathSuggest;
    const self = Base.call(this, app, inputEl, allowNull) || this;
    self.folderPredicate = folderPredicate || null;
    return self;
  }
  inherit(S, env().AI || host.FilePathSuggest);
  S.prototype.filePredicate = function (folder) { return !this.folderPredicate || this.folderPredicate(folder); };
  return S;
}

// ---- property-name value + type combobox --------------------------------------------

export function ng16DefineS06TypeCombobox(host) {
  return function (ctx, el, value) {
    const w = ng16MkWidget(ctx, el, value);
    const box = el.createDiv("combobox-container");
    const bases = host.t.plugins && host.t.plugins.bases;
    const input = box.createEl("input", { cls: "metadata-input-text", type: "text", attr: { placeholder: bases && bases.labelPropertyKey ? bases.labelPropertyKey() : "" } });
    w.input = input;
    input.value = value == null ? "" : String(value);
    input.addEventListener("change", () => ctx.onChange(ng16EmptyValue(input.value)));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); ctx.blur && ctx.blur(); } });
    w.setValue = (v) => { w.value = v; input.value = v == null ? "" : String(v); };
    return w;
  };
}

export function ng16DefineS06PropertyKeyValue(host) { return ng16DefineS06TypeCombobox(host); }

export function ng16DefineS06Combobox(host) {
  return function (ctx, el, value, items) {
    const w = ng16MkWidget(ctx, el, value);
    const input = el.createEl("input", { cls: "metadata-input-text", type: "text" });
    w.input = input;
    const list = items || [];
    input.value = value == null ? "" : String(value);
    const match = (q) => list.filter((it) => String(it.value).toLowerCase().includes(String(q).toLowerCase())).slice(0, 8);
    let pop = null;
    const close = () => { if (pop) { pop.remove(); pop = null; } };
    const open = () => {
      close();
      const hits = match(input.value);
      if (!hits.length) return;
      pop = el.createDiv("menu");
      for (const it of hits) {
        const row = pop.createDiv("menu-item");
        row.createSpan({ cls: "menu-item-title", text: it.display || it.value });
        row.addEventListener("mousedown", (e) => { e.preventDefault(); input.value = it.value; ctx.onChange(it.value); close(); ctx.blur && ctx.blur(); });
      }
    };
    input.addEventListener("input", open);
    input.addEventListener("focus", open);
    input.addEventListener("blur", () => setTimeout(close, 150));
    input.addEventListener("change", () => ctx.onChange(ng16EmptyValue(input.value)));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); close(); ctx.blur && ctx.blur(); } });
    w.setValue = (v) => { w.value = v; input.value = v == null ? "" : String(v); };
    return w;
  };
}

// ---- change-type confirmation modal (host.TypeInfoModal = FO) -------------------------

export function ng16DefineS06ChangeTypeModal(host) {
  function TypeInfoModal(app, line, widget) {
    const Base = host.DialogModal || host.ButtonModal;
    const self = Base.call(this, app) || this;
    const t = ng16PropT(host);
    const info = line && line.typeInfo;
    const inferred = info && info.inferred;
    const name = (w) => { try { return w && w.name ? w.name() : String(w && w.type || ""); } catch (e) { return String(w && w.type || ""); } };
    self.setTitle(t.labelChangePropertyType({ type: name(widget) }));
    self.contentEl.setText(t.labelChangePropertyTypeDesc({ oldType: name(inferred) }));
    self.addButton("mod-cta", host.t.dialogue.buttonUpdate(), () => {
      self.shouldRestoreSelection = false;
      if (line && line.renderProperty) line.renderProperty(line.entry, true, true);
      if (line && line.focusValue) line.focusValue();
    });
    self.addCancelButton();
    return self;
  }
  const Base = host.DialogModal || host.ButtonModal;
  if (Base) inherit(TypeInfoModal, Base);
  return TypeInfoModal;
}
