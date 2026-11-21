// g36 clean-room: live-preview CodeMirror widgets (spec g36 Part D.3).
// Blockquote border, horizontal rule, task checkbox, style span, code flair,
// image embed and the file-picker modal. Classes are ES5-style + inherit()
// because the CM bases (env().s30Rn / env().s30FV) are bundle ES5 classes.
// Class factories cache their product so decoration/menu code can reach them.

import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { ng36ImageContextMenu } from "./n-g36-cm6-menu.js";

function ng36WidgetBase() { return env().s30Rn || function () {}; }
function ng36EmbedBase() { return env().s30FV || function () {}; }

// ---------------------------------------------------------------------------
// Blockquote border widget: a ">" gutter marker.
// ---------------------------------------------------------------------------

let ng36ClsBlockquote = null;
export function ng36CmBlockquoteWidget(host) {
  if (ng36ClsBlockquote) return ng36ClsBlockquote;
  function BlockquoteBorderWidget() { ng36WidgetBase().call(this); }
  inherit(BlockquoteBorderWidget, ng36WidgetBase());
  BlockquoteBorderWidget.prototype.toDOM = function () {
    const el = document.createElement("span");
    el.className = "cm-blockquote-border cm-transparent";
    el.textContent = ">";
    return el;
  };
  return (ng36ClsBlockquote = BlockquoteBorderWidget);
}

// ---------------------------------------------------------------------------
// Horizontal rule widget: click anywhere selects the whole doc line.
// ---------------------------------------------------------------------------

let ng36ClsHr = null;
export function ng36CmHrWidget(host) {
  if (ng36ClsHr) return ng36ClsHr;
  function HrWidget() { ng36WidgetBase().call(this); }
  inherit(HrWidget, ng36WidgetBase());
  Object.defineProperty(HrWidget.prototype, "estimatedHeight", { get: function () { return 20; }, enumerable: false, configurable: true });
  HrWidget.prototype.eq = function () { return true; };
  HrWidget.prototype.toDOM = function (view) {
    const el = createDiv("hr cm-line");
    el.appendChild(document.createElement("br"));
    el.appendChild(document.createElement("hr"));
    const onClick = () => {
      const pos = view.posAtDOM(el);
      const line = view.state.doc.lineAt(pos);
      view.dispatch({ selection: { head: line.from, anchor: line.to } });
    };
    el.addEventListener("click", onClick);
    el.__ng36Click = onClick;
    return el;
  };
  HrWidget.prototype.destroy = function (dom) {
    if (dom && dom.__ng36Click) dom.removeEventListener("click", dom.__ng36Click);
  };
  return (ng36ClsHr = HrWidget);
}

let ng36HrInstance = null;
/** One shared hr widget instance reused for every rule. */
export function ng36CmHrWidgetInstance() {
  if (!ng36HrInstance) ng36HrInstance = new (ng36CmHrWidget({}))();
  return ng36HrInstance;
}

/** i6: Decoration.replace wrapping one shared blockquote-border widget. */
let ng36QuoteDeco = null;
export function ng36CmBlockquoteBorderDeco() {
  if (!ng36QuoteDeco) {
    ng36QuoteDeco = env().s12cmDecoration.replace({ widget: new (ng36CmBlockquoteWidget({}))() });
  }
  return ng36QuoteDeco;
}

// ---------------------------------------------------------------------------
// Task checkbox widget
// ---------------------------------------------------------------------------

let ng36ClsTask = null;
export function ng36CmTaskWidget(host) {
  if (ng36ClsTask) return ng36ClsTask;
  function TaskWidget(content) {
    ng36WidgetBase().call(this);
    this.content = content;
  }
  inherit(TaskWidget, ng36WidgetBase());
  TaskWidget.prototype.eq = function (other) { return other instanceof TaskWidget && other.content === this.content; };
  TaskWidget.prototype.toDOM = function (view) {
    const self = this;
    self.view = view;
    const label = document.createElement("label");
    label.className = "task-list-label";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "task-list-item-checkbox";
    input.setAttribute("data-task", this.content);
    input.checked = this.content !== " ";
    label.appendChild(input);
    label.addEventListener("mousedown", (e) => e.preventDefault());
    input.addEventListener("change", () => ng36TaskToggle(self, view, input));
    input.addEventListener("input", () => ng36TaskToggle(self, view, input));
    return label;
  };
  TaskWidget.prototype.updateDOM = function (el) {
    const label = el && el.classList && el.classList.contains("task-list-label") ? el : null;
    const input = label && label.querySelector("input.task-list-item-checkbox");
    if (!input) return false;
    input.setAttribute("data-task", this.content);
    input.checked = this.content !== " ";
    return true;
  };
  return (ng36ClsTask = TaskWidget);
}

function ng36TaskToggle(self, view, input) {
  const doc = view && view.state && view.state.doc;
  if (!doc) return;
  const pos = view.posAtDOM(input);
  const line = doc.lineAt(pos);
  const m = /\[.\]/.exec(line.text);
  if (!m) return;
  const at = line.from + m.index + 1;
  const ch = line.text[m.index + 1];
  const next = ch === " " ? "x" : " ";
  view.dispatch({ changes: [{ from: at, to: at + 1, insert: next, text: next }] });
  try { navigator.vibrate && navigator.vibrate(100); } catch (e) { /* noop */ }
  if (env().Yl.isAndroidApp && view.scrollDOM) {
    const top = view.scrollDOM.scrollTop;
    const stop = () => { view.scrollDOM.scrollTop = top; };
    view.scrollDOM.addEventListener("scroll", stop);
    setTimeout(() => view.scrollDOM.removeEventListener("scroll", stop), 200);
  }
}

// ---------------------------------------------------------------------------
// Style span widget: a bare <span> carrying the live-preview style classes.
// ---------------------------------------------------------------------------

let ng36ClsStyle = null;
export function ng36CmStyleWidget(host) {
  if (ng36ClsStyle) return ng36ClsStyle;
  function StyleWidget(styles) {
    ng36WidgetBase().call(this);
    this.styles = styles;
  }
  inherit(StyleWidget, ng36WidgetBase());
  StyleWidget.prototype.toDOM = function () {
    const el = document.createElement("span");
    el.className = this.styles;
    return el;
  };
  StyleWidget.prototype.eq = function (other) { return other instanceof StyleWidget && other.styles === this.styles; };
  StyleWidget.prototype.ignoreEvent = function () { return false; };
  return (ng36ClsStyle = StyleWidget);
}

// ---------------------------------------------------------------------------
// Code flair widget: language label + copy button for empty-lang blocks.
// ---------------------------------------------------------------------------

let ng36ClsFlair = null;
export function ng36CmCodeFlairWidget(host) {
  if (ng36ClsFlair) return ng36ClsFlair;
  function CodeFlairWidget(lang, code) {
    ng36WidgetBase().call(this);
    this.lang = lang;
    this.code = code;
  }
  inherit(CodeFlairWidget, ng36WidgetBase());
  CodeFlairWidget.prototype.eq = function (other) {
    return other instanceof CodeFlairWidget && other.lang === this.lang && other.code === this.code;
  };
  CodeFlairWidget.prototype.toDOM = function () {
    const self = this;
    const el = document.createElement("span");
    el.className = "code-block-flair";
    el.textContent = this.lang;
    if (!this.lang) {
      env().tv(el, "lucide-copy");
      env().Mv(el, env().gm.interface.menu.copy());
    }
    el.addEventListener("click", () => {
      const text = String(self.code == null ? "" : self.code).replace(/\n$/, "");
      navigator.clipboard.writeText(text).then(() => {
        new env().fb(env().gm.interface.copied({ context: "generic" }));
      }).catch(() => {});
    });
    return el;
  };
  return (ng36ClsFlair = CodeFlairWidget);
}

// ---------------------------------------------------------------------------
// Image embed widget: external (url+title) image embeds with edit/resize
// buttons, delegated-embed passthrough and the shared context menu.
// ---------------------------------------------------------------------------

let ng36ClsImage = null;
export function ng36CmImageEmbedWidget(host) {
  if (ng36ClsImage) return ng36ClsImage;
  function ImageEmbedWidget(url, title) {
    ng36EmbedBase().call(this);
    this.url = url;
    this.title = title;
  }
  inherit(ImageEmbedWidget, ng36EmbedBase());
  Object.defineProperty(ImageEmbedWidget.prototype, "noReuse", { get: function () { return true; }, enumerable: false, configurable: true });
  Object.defineProperty(ImageEmbedWidget.prototype, "estimatedHeight", { get: function () { return 30; }, enumerable: false, configurable: true });

  ImageEmbedWidget.prototype.applyTitle = function (title) {
    const img = this.imageEl;
    if (!img) return;
    const t = String(title == null ? "" : title);
    const parts = t.split("|");
    let dims = null;
    if (parts.length > 1 && typeof env().s30Zx === "function") {
      const d = env().s30Zx(parts[parts.length - 1]);
      if (d) { dims = d; parts.pop(); }
    }
    const alt = parts.join("|").trim();
    img.setAttribute("alt", alt || env().nu(this.url));
    const w = dims ? dims.x : 0, h = dims ? dims.y : 0;
    if (w > 0) img.setAttribute("width", String(w)); else img.removeAttribute("width");
    if (h > 0) img.setAttribute("height", String(h)); else img.removeAttribute("height");
  };

  ImageEmbedWidget.prototype.initDOM = function (view) {
    const self = this;
    const e = env();
    const delegated = typeof e.s30Az === "function" ? e.s30Az(this.url) : null;
    if (delegated) {
      const el = e.s30Pz(delegated);
      if (typeof self.addEditButton === "function") self.addEditButton(view);
      if (typeof self.resizeWidget === "function") self.resizeWidget(view);
      return el;
    }
    const wrapperEl = document.createElement("div");
    wrapperEl.className = "image-embed";
    wrapperEl.tabIndex = -1;
    const inner = document.createElement("div");
    inner.className = "image-wrapper";
    const imgEl = document.createElement("img");
    imgEl.setAttribute("src", this.url);
    inner.appendChild(imgEl);
    wrapperEl.appendChild(inner);
    this.imageEl = imgEl;
    this.applyTitle(this.title);
    ng36ImageContextMenu(self, view, wrapperEl, imgEl, wrapperEl);
    if (typeof self.addEditButton === "function") self.addEditButton(view);
    if (typeof self.resizeWidget === "function") self.resizeWidget(view);
    return wrapperEl;
  };
  ImageEmbedWidget.prototype.toDOM = function (view) { return this.initDOM(view); };
  ImageEmbedWidget.prototype.eq = function (other) {
    return other instanceof ImageEmbedWidget && other.url === this.url && other.title === this.title;
  };
  return (ng36ClsImage = ImageEmbedWidget);
}

// ---------------------------------------------------------------------------
// File-suggest modal used by the image context menu "swap file" action.
// ---------------------------------------------------------------------------

let ng36ClsFileSuggest = null;
export function ng36CmFileSuggestModal(host) {
  if (ng36ClsFileSuggest) return ng36ClsFileSuggest;
  const Base = (host && host.s13QuickSwitcherModalBase) || env().s12fileSuggestBase;
  function FileSuggestModal(app, onChoose) {
    const self = Base.call(this, app) || this;
    const e = env();
    self.handleChoose = onChoose;
    self.context = "embed";
    self.shouldShowImages = true;
    self.allowCreateNewFile = false;
    self.shouldShowUnresolved = false;
    self.shouldShowMarkdown = false;
    self.shouldShowNonImageAttachments = false;
    self.shouldShowNonAttachments = false;
    self.shouldShowAllTypes = false;
    self.emptyStateText = e.gm.plugins.noteComposer.labelNoFiles();
    self.setPlaceholder(e.gm.interface.mobile.actionChooseFileToInsert());
    self.setInstructions([
      { command: "↑↓", purpose: e.gm.plugins.quickSwitcher.instructionNavigate() },
      { command: "↵", purpose: e.gm.plugins.quickSwitcher.instructionSelect() },
      { command: "esc", purpose: e.gm.plugins.quickSwitcher.instructionDismiss() },
    ]);
    return self;
  }
  inherit(FileSuggestModal, Base);
  FileSuggestModal.prototype.onChooseSuggestion = function (item) {
    if (item && (item.type === "file" || item.type === "alias") && item.file) {
      if (this.handleChoose) this.handleChoose(item.file);
      if (this.app && this.app.workspace && this.app.workspace.addRecentFile) this.app.workspace.addRecentFile(item.file);
    }
  };
  return (ng36ClsFileSuggest = FileSuggestModal);
}

/** Lazily builds (once) the file modal class bound to the env quick-switcher base. */
export function ng36FileModalClass() {
  if (!ng36ClsFileSuggest) ng36ClsFileSuggest = ng36CmFileSuggestModal({ s13QuickSwitcherModalBase: env().s12fileSuggestBase });
  return ng36ClsFileSuggest;
}
