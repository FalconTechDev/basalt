// g35 clean-room: formula property renderer — value/error display and the
// formula editor menu (spec g35, s26-bases-values).
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { parsePropertyId } from "./text.js";
import { s09ValueTypeName } from "./n-g07-query-p.js";
import { ng35ValueRendererBase } from "./n-g35-bases-values.js";

function ng35FormulaBase() {
  function Base(view, prop, el) {
    ng35ValueRendererBase.call(this, view, prop, el);
  }
  return Base;
}

/** Formula result renderer: renders value.renderTo or an error box. */
export function ng35FormulaValueRenderer(host) {
  const Base = ng35FormulaBase();
  function FormulaValueRenderer(view, prop, el) {
    Base.call(this, view, prop, el);
    this.el.addClass("bases-rendered-value");
    this.value = null;
    this.error = null;
  }
  inherit(FormulaValueRenderer, Base);
  FormulaValueRenderer.prototype.render = async function (entry) {
    let value = null;
    let error = null;
    try {
      value = entry.getValue(this.prop);
    } catch (e) {
      error = e;
    }
    const sameError = (error && error.message) === (this.error && this.error.message);
    if (env().gW.equals(value, this.value) && sameError) return;
    this.value = value;
    this.error = error;
    this.el.empty();
    this.el.setAttribute("data-property-type", value ? s09ValueTypeName(value.type) : "");
    if (error) {
      this.renderError(error);
    } else if (value) {
      value.renderTo(this.el, this.view.app.renderContext);
    }
  };
  FormulaValueRenderer.prototype.renderError = function (error) {
    const box = this.el.createDiv("bases-formula-error");
    const icon = box.createDiv("warning-icon");
    host.setIcon(icon, "lucide-info");
    const msg = box.createDiv("bases-formula-error-message");
    msg.setText(error.message);
    const showTip = () => host.setTooltip && host.setTooltip(box, error.message, { delay: host.TOOLTIP_DELAY });
    if (host.setTooltip) showTip();
    box.addEventListener("click", showTip);
    box.addEventListener("dblclick", (e) => {
      e.preventDefault();
      this.showFormulaEditor();
    });
  };
  FormulaValueRenderer.prototype.showFormulaEditor = function () {
    const name = parsePropertyId(this.prop).name;
    const menu = new host.s13BasesMenu(this.view.app, this.el, name);
    const bar = menu.scrollEl.createDiv("bases-toolbar-menu-container");
    const header = bar.createDiv("bases-toolbar-menu-container-header");
    const title = header.createDiv("menu-title");
    title.createDiv("menu-title-inner").setText(env().gm.plugins.bases.titleEditProperty({ name }));
    const btn = header.createDiv("clickable-icon");
    host.setIcon(btn, "lucide-more-vertical");
    const actions = new host.s13PropActionsMenu(this.view.queryController, this.prop, false);
    bar.appendChild(actions.containerEl);
    btn.addEventListener("click", (e) => actions.showActions(e, btn));
    menu.setAutoDestroy(this.el);
    menu.onClose(() => this.view.focus());
    menu.setOpen(true);
  };
  return FormulaValueRenderer;
}
