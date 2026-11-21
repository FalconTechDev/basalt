// g35 clean-room: Bases property value renderers — shared ctor base, the
// metadata-property widget, the file-link renderer and the formula renderer
// (spec g35, s26-bases-values).
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { emptyToNull, parsePropertyId } from "./text.js";
import { s09ValueTypeName } from "./n-g07-query-p.js";

/** Plain constructor base invoked via .call(this, view, prop, el). */
export function ng35ValueRendererBase(view, prop, el) {
  this.view = view;
  this.prop = prop;
  this.el = el;
}

function ng35RendererBase(host) {
  function Base(view, prop, el) {
    ng35ValueRendererBase.call(this, view, prop, el);
  }
  return Base;
}

/** Metadata-property widget: re-renders only when type or raw value changes. */
export function ng35MetadataValueRenderer(host) {
  const Base = ng35RendererBase(host);
  function MetadataValueRenderer(view, prop, el) {
    Base.call(this, view, prop, el);
    this.el.addClass("bases-rendered-value", "metadata-property-value");
    this.propertyEditor = null;
    this.inferredType = null;
  }
  inherit(MetadataValueRenderer, Base);
  MetadataValueRenderer.prototype.render = async function (entry) {
    const name = parsePropertyId(this.prop).name;
    const raw = entry.getRawProperty(name);
    const rawJson = JSON.stringify(raw);
    if (entry.file.extension !== "md") {
      this.propertyEditor = null;
      this.el.empty();
      this.el.setAttribute("disabled", "");
      return;
    }
    this.el.removeAttribute("disabled");
    const inferred = this.view.app.metadataTypeManager.getTypeInfo(name, raw).inferred;
    if (this.propertyEditor && this.inferredType === inferred && this.val === rawJson) return;
    this.el.empty();
    this.inferredType = inferred;
    this.val = rawJson;
    this.entry = entry;
    this.el.setAttribute("data-property-type", inferred.type);
    this.propertyEditor = inferred.render(this.el, raw, {
      app: this.view.app,
      key: name,
      hoverSource: "bases",
      sourcePath: entry.file.path,
      blur: () => {
        host.blurAndClearSelection();
        this.el.scrollLeft = 0;
        this.view.focus();
      },
      onChange: (value) => {
        const next = emptyToNull(value);
        const nextJson = JSON.stringify(next);
        if (nextJson === this.val) return;
        this.val = nextJson;
        this.view.updateProperty(entry.file, name, next);
      },
    });
  };
  return MetadataValueRenderer;
}

/** file.* renderer: the standard file-link chip, cached per file+path. */
export function ng35FileValueRenderer(host) {
  const Base = ng35RendererBase(host);
  function FileValueRenderer(view, prop, el) {
    Base.call(this, view, prop, el);
    this.el.addClass("bases-rendered-value");
  }
  inherit(FileValueRenderer, Base);
  FileValueRenderer.prototype.render = async function (entry) {
    if (this.file === entry.file && this.filepath === entry.file.path) return;
    this.el.empty();
    this.entry = entry;
    this.file = entry.file;
    this.filepath = entry.file.path;
    this.view.app.renderContext.renderFileLink(entry.file, null, this.el);
  };
  return FileValueRenderer;
}
