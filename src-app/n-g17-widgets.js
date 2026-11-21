// g17 clean-room CodeMirror widget layer.
//
// Replaces the derived s31 widget/field collection with an independent
// implementation: embed block widgets (markdown-rendered child content),
// internal-embed widgets (![[file]]), code-block / math / raw-html widgets,
// callout widgets with type picker and checkbox toggling, the empty widget
// type, the fold/selection/task decoration state classes and the always-on
// editor extensions (mouse-drag guard, post-processor refresh).
//
// Host values are read lazily through env() / the factory `host` argument;
// no minified identifiers are named here.

import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { s12CalloutTypeLabels, s12CalloutTypeNames, s12cmRefreshDispatch } from "./s12-consts.js";

const ng17E = () => env();

// ---------------------------------------------------------------------------
// shared scaffolding
// ---------------------------------------------------------------------------

function ng17CursorBase(host) { return ng17E().s12widgetBase; }
function ng17PlainBase() { return ng17E().s12cmWidgetType; }
function ng17ChildBase() { return ng17E().s12embedChildBase; }

/** DOM shell shared by the embed-style widgets: container + rendered child. */
function ng17EmbedShell(self, editor, clazz, classes) {
  const el = createDiv(classes + " " + clazz);
  el.tabIndex = -1;
  const rendered = createDiv("markdown-rendered");
  el.appendChild(rendered);
  self.containerEl = el;
  self.renderedEl = rendered;
  ng17WidgetHooks(self, editor || self.editor, el);
  return el;
}

/** Editor hooks every cursor/embed widget exposes (edit button, resize, click). */
function ng17WidgetHooks(self, editor, el) {
  if (!editor) return;
  if (typeof self.addEditButton === "function") { try { self.addEditButton(editor, el); } catch (e) { /* noop */ } }
  if (typeof self.resizeWidget === "function") { try { self.resizeWidget(editor, el); } catch (e) { /* noop */ } }
  if (typeof self.hookClickHandler === "function") { try { self.hookClickHandler(editor, el); } catch (e) { /* noop */ } }
}

function ng17LinesOf(text) { return String(text == null ? "" : text).split("\n").length; }

function ng17DefaultLineHeight(self, editor) {
  const cm = (self && self.editor && self.editor.cm) || (editor && editor.cm) || (editor && editor.state ? editor : null);
  return (cm && cm.defaultLineHeight) || 20;
}

// ---- EmbedBlockWidget -------------------------------------------------------

let ng17EmbedBlockClass = null;
export function ng17EmbedBlockWidget(host) {
  if (ng17EmbedBlockClass) return ng17EmbedBlockClass;
  const Base = ng17CursorBase(host);

  function EmbedBlockWidget(app, editor, text, clazz) {
    const self = Base.call(this) || this;
    self.app = app;
    self.editor = editor;
    self.text = text;
    self.clazz = clazz || "";
    return self;
  }
  inherit(EmbedBlockWidget, Base);

  EmbedBlockWidget.prototype.initDOM = function (editor) {
    const self = this;
    const el = ng17EmbedShell(self, editor || self.editor, self.clazz, "cm-embed-block markdown-rendered");
    const rendered = self.renderedEl;
    const app = self.app;
    try {
      const ast = ng17E().Kx(self.text);
      let html = "";
      try { html = ng17E().Zx(ast); } catch (e) { html = ""; }
      const frag = ng17E().xL(html);
      if (frag) {
        if (frag.nodeType === 11) { while (frag.firstChild) rendered.appendChild(frag.firstChild); }
        else rendered.appendChild(frag);
      }
      if (app && app.fixFileLinks) { try { app.fixFileLinks(rendered, self.editor && self.editor.path); } catch (e) { /* noop */ } }
      const postChildren = [];
      self._postChildren = postChildren;
      const ctx = {
        docId: ng17E().cc ? ng17E().cc(16) : "",
        sourcePath: (self.editor && self.editor.path) || "",
        frontmatter: null,
        promises: [],
        addChild(child) { postChildren.push(child); return child; },
        getSectionInfo() { return null; },
        replace() { return null; },
        containerEl: el,
        el: rendered,
        displayMode: false,
      };
      ng17E().fq.postProcess(app, ctx);
    } catch (e) {
      try { rendered.setText(self.text); } catch (e2) { /* noop */ }
    }
    const vault = app && app.vault;
    rendered.toggleClass("is-rtl", !!(vault && vault.getConfig && vault.getConfig("rightToLeft")));
    rendered.toggleClass("show-indentation-guide", !!(vault && vault.getConfig && vault.getConfig("showIndentGuide")));
    return el;
  };

  EmbedBlockWidget.prototype.toDOM = function (view) { return this.initDOM(view); };
  Object.defineProperty(EmbedBlockWidget.prototype, "estimatedHeight", {
    get() { return ng17LinesOf(this.text) * ng17DefaultLineHeight(this, this.editor); },
    enumerable: false, configurable: true,
  });

  ng17EmbedBlockClass = EmbedBlockWidget;
  return ng17EmbedBlockClass;
}

// ---- InternalEmbedWidget ----------------------------------------------------

let ng17InternalEmbedClass = null;
export function ng17InternalEmbedWidget(host) {
  if (ng17InternalEmbedClass) return ng17InternalEmbedClass;
  const Base = ng17ChildBase();

  function InternalEmbedWidget(app, editor, sourcePath, href, title, depth) {
    const self = Base.call(this, app, editor) || this;
    self.app = app;
    self.editor = editor;
    self.sourcePath = sourcePath;
    self.href = href;
    self.title = title;
    self.depth = depth || 0;
    self.child = null;
    return self;
  }
  inherit(InternalEmbedWidget, Base);

  InternalEmbedWidget.prototype.initDOM = function (editor) {
    const self = this;
    const el = createDiv("internal-embed");
    el.tabIndex = -1;
    el.setAttr("src", self.href);
    self.containerEl = el;
    self.applyTitle(el, self.title);
    let child = null;
    try {
      child = self.child = ng17E().sJ.load({
        app: self.app,
        linktext: self.href,
        sourcePath: self.sourcePath,
        containerEl: el,
        displayMode: false,
        showInline: true,
        depth: self.depth,
      });
      if (child && child.loadFile) {
        const p = child.loadFile();
        if (p && typeof p.then === "function") {
          p.then(() => { try { el.classList.add("is-loaded"); } catch (e) { /* noop */ } }, () => { /* noop */ });
        }
      }
    } catch (e) { child = null; }
    if (child && typeof self.addChild === "function") { try { self.addChild(child); } catch (e) { /* noop */ } }
    if (!el.classList.contains("is-loaded")) {
      const markLoaded = () => { try { if (!el.classList.contains("is-loaded")) el.classList.add("is-loaded"); } catch (e) { /* noop */ } };
      const win = (editor && editor.win) || window;
      win.setTimeout(markLoaded, 400);
    }
    ng17WidgetHooks(self, editor || self.editor, el);
    return el;
  };

  InternalEmbedWidget.prototype.toDOM = function (view) {
    if (this.containerEl && this.containerEl.parentElement !== undefined && this._domBuilt) return this.containerEl;
    this._domBuilt = true;
    return this.initDOM(view);
  };

  InternalEmbedWidget.prototype.applyTitle = function (el, title) {
    this.title = title;
    if (!el) return;
    let w = 0, h = 0, alt = title || "";
    if (title) {
      const at = title.lastIndexOf("|");
      const tail = at >= 0 ? title.slice(at + 1) : title;
      const dim = ng17E().zx(tail);
      if (dim) {
        w = dim.x; h = dim.y;
        alt = at >= 0 ? title.slice(0, at) : "";
      }
    }
    el.setAttr("width", w ? String(w) : null);
    el.setAttr("height", h ? String(h) : null);
    el.setAttr("alt", alt || null);
    const img = el.querySelector && el.querySelector("img");
    if (img) {
      img.setAttr("width", w ? String(w) : null);
      img.setAttr("height", h ? String(h) : null);
      img.setAttr("alt", alt || null);
    }
  };

  Object.defineProperty(InternalEmbedWidget.prototype, "estimatedHeight", { get: function () { return 100; }, enumerable: false, configurable: true });

  ng17InternalEmbedClass = InternalEmbedWidget;
  return ng17InternalEmbedClass;
}

// ---- CodeBlockWidget --------------------------------------------------------

let ng17CodeBlockClass = null;
export function ng17CodeBlockWidget(host) {
  if (ng17CodeBlockClass) return ng17CodeBlockClass;
  const Base = ng17CursorBase(host);

  function CodeBlockWidget(app, editor, lang, code) {
    const self = Base.call(this) || this;
    self.app = app;
    self.editor = editor;
    self.lang = lang || "";
    self.code = code || "";
    self.lineStart = 0;
    self.lineEnd = 0;
    return self;
  }
  inherit(CodeBlockWidget, Base);

  CodeBlockWidget.canRenderLang = function (lang) {
    if (!lang) return false;
    if (lang === "mermaid" || lang === "query") return true;
    try {
      const rr = ng17E().Gz;
      const pp = rr && (rr.codeBlockPostProcessors || (rr.prototype && rr.prototype.codeBlockPostProcessors));
      return !!(pp && pp[lang]);
    } catch (e) { return false; }
  };

  CodeBlockWidget.prototype.initDOM = function (editor) {
    const self = this;
    const el = createDiv("cm-preview-code-block cm-embed-block markdown-rendered cm-lang-" + self.lang);
    el.tabIndex = -1;
    const pre = el.createEl("pre");
    const codeEl = pre.createEl("code", "language-" + self.lang);
    self.containerEl = el;
    self.codeEl = codeEl;
    codeEl.setText(self.code);
    try { ng17E().Yz(el, self.lang); } catch (e) { /* plain code fallback */ }
    if (self.lang === "query") {
      try {
        const q = ng17E().pq(self.app, self.code, pre, self.editor && self.editor.path);
        if (q && typeof self.addChild === "function") self.addChild(q);
      } catch (e) { /* noop */ }
    }
    ng17WidgetHooks(self, editor || self.editor, el);
    return el;
  };
  CodeBlockWidget.prototype.toDOM = function (view) { return this.initDOM(view); };
  Object.defineProperty(CodeBlockWidget.prototype, "estimatedHeight", { get: function () { return 50; }, enumerable: false, configurable: true });

  ng17CodeBlockClass = CodeBlockWidget;
  return ng17CodeBlockClass;
}

// ---- MathWidget -------------------------------------------------------------

let ng17MathClass = null;
export function ng17MathWidget(host) {
  if (ng17MathClass) return ng17MathClass;
  const Base = ng17CursorBase(host);

  function MathWidget(math, block) {
    const self = Base.call(this) || this;
    self.math = math;
    self.block = !!block;
    
    return self;
  }
  inherit(MathWidget, Base);
  Object.defineProperty(MathWidget.prototype, "noReuse", { get: function () { return true; }, enumerable: false, configurable: true });

  MathWidget.prototype.initDOM = function (editor) {
    const self = this;
    const el = self.block
      ? createDiv("math math-block cm-embed-block")
      : createSpan("math");
    el.tabIndex = -1;
    self.containerEl = el;
    if (self.block) { el.appendChild(createEl("br")); el.appendChild(createEl("br")); }
    self.render(self.math);
    ng17WidgetHooks(self, editor, el);
    return el;
  };
  MathWidget.prototype.toDOM = function (view) { return this.initDOM(view); };

  MathWidget.prototype.render = function (math) {
    const self = this;
    const el = self.containerEl;
    const done = () => { try { if (ng17E().xz) ng17E().xz(); } catch (e) { /* noop */ } };
    const ready = ng17E().bz;
    const readyP = ready && typeof ready.then === "function" ? ready
      : Promise.resolve().then(() => (typeof ready === "function" ? ready() : ready));
    readyP.then(() => {
      let out = null;
      try { out = ng17E().kz(math, self.block); } catch (e) { out = null; }
      return Promise.resolve(out);
    }).then((html) => {
      if (!el) return;
      el.empty();
      if (html != null && html !== "") {
        try {
          const frag = ng17E().xL(String(html));
          if (frag) {
            if (frag.nodeType === 11) { while (frag.firstChild) el.appendChild(frag.firstChild); }
            else el.appendChild(frag);
          }
        } catch (e) { el.setText(math); }
      } else {
        el.setText(math);
      }
      if (self.block) { el.appendChild(createEl("br")); el.appendChild(createEl("br")); }
      done();
    }).catch(() => {
      if (el) { el.empty(); el.setText(math); }
      done();
    });
  };

  Object.defineProperty(MathWidget.prototype, "estimatedHeight", { get: function () { return 50; }, enumerable: false, configurable: true });

  ng17MathClass = MathWidget;
  return ng17MathClass;
}

// ---- HtmlEmbedWidget --------------------------------------------------------

let ng17HtmlClass = null;
export function ng17HtmlEmbedWidget(host) {
  if (ng17HtmlClass) return ng17HtmlClass;
  const Base = ng17CursorBase(host);

  function HtmlEmbedWidget(app, editor, html, block) {
    const self = Base.call(this) || this;
    self.app = app;
    self.editor = editor;
    self.html = html;
    self.block = !!block;
    return self;
  }
  inherit(HtmlEmbedWidget, Base);
  Object.defineProperty(HtmlEmbedWidget.prototype, "noReuse", { get: function () { return true; }, enumerable: false, configurable: true });

  HtmlEmbedWidget.prototype.initDOM = function (editor) {
    const self = this;
    const el = self.block ? createDiv("cm-html-embed cm-embed-block") : createSpan("cm-html-embed");
    el.tabIndex = -1;
    self.containerEl = el;
    try {
      const frag = ng17E().xL(self.html);
      if (frag) {
        if (frag.nodeType === 11) { while (frag.firstChild) el.appendChild(frag.firstChild); }
        else el.appendChild(frag);
      }
    } catch (e) { /* keep empty embed on sanitize failure */ }
    try { if (self.app && self.app.fixFileLinks) self.app.fixFileLinks(el, self.editor && self.editor.path); } catch (e) { /* noop */ }
    if (self.block) ng17WidgetHooks(self, editor || self.editor, el);
    return el;
  };
  HtmlEmbedWidget.prototype.toDOM = function (view) { return this.initDOM(view); };
  Object.defineProperty(HtmlEmbedWidget.prototype, "estimatedHeight", { get: function () { return 40; }, enumerable: false, configurable: true });

  ng17HtmlClass = HtmlEmbedWidget;
  return ng17HtmlClass;
}

// ---- EmptyWidget ------------------------------------------------------------

let ng17EmptyClass = null;
export function ng17EmptyWidget(host) {
  if (ng17EmptyClass) return ng17EmptyClass;
  const Base = ng17PlainBase();
  function EmptyWidget() {
    const self = Base.call(this) || this;
    return self;
  }
  inherit(EmptyWidget, Base);
  EmptyWidget.prototype.toDOM = function () { return createSpan(); };
  EmptyWidget.prototype.ignoreEvent = function () { return true; };
  EmptyWidget.prototype.eq = function () { return true; };
  ng17EmptyClass = EmptyWidget;
  return ng17EmptyClass;
}

// ---- CalloutTypeSuggest -----------------------------------------------------

let ng17CalloutSuggestClass = null;
export function ng17CalloutTypeSuggest(host) {
  if (ng17CalloutSuggestClass) return ng17CalloutSuggestClass;
  const Base = ng17E().lb;
  const types = () => s12CalloutTypeNames();

  function CalloutTypeSuggest(app, onSubmit) {
    const self = Base.call(this, app) || this;
    self.onSubmit = onSubmit;
    self.setPlaceholder(ng17E().gm.callout.optionOtherPlaceholder());
    const instr = ng17E().gm.plugins && ng17E().gm.plugins.commandPalette;
    if (instr) {
      self.setInstructions([
        { command: "↑↓", purpose: instr.instructionNavigate && instr.instructionNavigate() },
        { command: "↵", purpose: instr.instructionUse && instr.instructionUse() },
        { command: "esc", purpose: instr.instructionDismiss && instr.instructionDismiss() },
      ]);
    }
    return self;
  }
  inherit(CalloutTypeSuggest, Base);

  CalloutTypeSuggest.prototype.getSuggestions = function (query) {
    query = String(query || "").toLowerCase();
    const out = [];
    for (const t of types()) {
      if (!query || t.toLowerCase().indexOf(query) >= 0) out.push({ item: t });
    }
    if (!out.length && query) out.push({ item: query });
    return out;
  };
  CalloutTypeSuggest.prototype.renderSuggestion = function (container, suggestion) {
    container.createDiv({ cls: "suggestion-content", text: suggestion.item });
  };
  CalloutTypeSuggest.prototype.onChooseSuggestion = function (suggestion) {
    if (this.onSubmit) this.onSubmit(suggestion.item);
  };

  ng17CalloutSuggestClass = CalloutTypeSuggest;
  return ng17CalloutSuggestClass;
}

// ---- CalloutWidget ----------------------------------------------------------

let ng17CalloutClass = null;
export function ng17CalloutWidget(host) {
  if (ng17CalloutClass) return ng17CalloutClass;
  const EmbedBase = ng17EmbedBlockWidget(host);

  function CalloutWidget(app, editor, unknown, text) {
    const self = EmbedBase.call(this, app, editor, text, "cm-callout") || this;
    self.unknown = unknown;
    return self;
  }
  inherit(CalloutWidget, EmbedBase);

  CalloutWidget.prototype.getTypePos = function () {
    const text = this.text || "";
    const lineEnd = text.indexOf("\n");
    const first = lineEnd < 0 ? text : text.slice(0, lineEnd);
    const open = first.indexOf("[!");
    if (open < 0) return null;
    const close = first.indexOf("]", open + 2);
    if (close < 0) return null;
    return [open + 2, close];
  };
  CalloutWidget.prototype.getType = function () {
    const pos = this.getTypePos();
    return pos ? (this.text || "").slice(pos[0], pos[1]) : "";
  };
  CalloutWidget.prototype.updateType = function (type) {
    const pos = this.getTypePos();
    if (!pos || !this.editor || !this.editor.cm) return;
    const from = this.start + pos[0], to = this.start + pos[1];
    this.editor.cm.dispatch({ changes: [{ from, to, insert: type }], scrollIntoView: false });
  };
  CalloutWidget.prototype.remove = function () {
    const text = this.text || "";
    const lines = text.split("\n");
    if (!lines.length) return;
    // first line is removed entirely; following quote lines lose their marker
    const markerW = (line) => {
      const m = line.match(/^\s{0,3}>\s?/);
      return m ? m[0].length : 0;
    };
    const rest = lines.slice(1).map((l) => l.slice(markerW(l))).join("\n");
    const firstLen = lines[0].length;
    const removeTo = this.start + firstLen + (lines.length > 1 ? 1 : 0);
    const insert = rest ? rest + "\n" : "";
    if (this.editor && this.editor.cm) {
      this.editor.cm.dispatch({ changes: [{ from: this.start, to: removeTo, insert }], scrollIntoView: false });
    }
  };

  CalloutWidget.prototype.initDOM = function (editor) {
    const self = this;
    const el = EmbedBase.prototype.initDOM.call(self, editor || self.editor);
    const rendered = self.renderedEl;

    // checkbox toggling inside the rendered callout
    el.addEventListener("click", (event) => {
      const box = event.target && event.target.closest ? event.target.closest(".task-list-item-checkbox") : null;
      if (!box) return;
      event.preventDefault();
      event.stopPropagation();
      const li = box.closest("li");
      const text = self.text || "";
      const lines = text.split("\n");
      // locate the li's source line via its data-line attribute when present
      let lineIdx = li && li.getAttribute ? parseInt(li.getAttribute("data-line") || "-1", 10) : -1;
      if (lineIdx < 0 || lineIdx >= lines.length) {
        // fall back: find the first task line in the widget text
        lineIdx = lines.findIndex((l) => /\[[ xX\/-]\]/.test(l));
      }
      if (lineIdx < 0) return;
      const line = lines[lineIdx];
      const m = line.match(/(\[[ xX\/-]\])/);
      if (!m) return;
      const cur = m[1].slice(1, -1);
      const next = cur === " " ? "x" : " ";
      const at = line.indexOf(m[1]);
      const lineStart = lines.slice(0, lineIdx).join("\n").length + (lineIdx ? 1 : 0);
      const docFrom = self.start + lineStart + at + 1;
      const cm = self.editor && self.editor.cm;
      if (!cm) return;
      cm.dispatch({
        changes: [{ from: docFrom, to: docFrom + 1, insert: next }],
        scrollIntoView: false,
      });
      if (li) {
        li.setAttribute("data-task", next);
        li.classList.toggle("is-checked", next !== " ");
        if (box) box.checked = next !== " ";
      }
      try { if (ng17E().Yl.isMobile) navigator.vibrate(100); } catch (e) { /* noop */ }
    });

    // context menu: edit / clipboard / type / danger
    el.addEventListener("contextmenu", (event) => {
      if (event.defaultPrevented) return;
      const menu = ng17E().Ug.forEvent(event);
      menu.addSections(["edit", "clipboard", "type", "", "danger"]);
      const gm = ng17E().gm;
      menu.addItem((item) => item.setSection("edit").setTitle(gm.editor.menu && gm.editor.menu.edit ? gm.editor.menu.edit() : "Edit")
        .setIcon("lucide-pencil").onClick(() => {
          const cm = self.editor && self.editor.cm;
          if (cm) cm.dispatch({ selection: ng17E().pe.range(self.start, self.end) });
        }));
      const types = s12CalloutTypeNames();
      const labels = s12CalloutTypeLabels();
      const current = self.getType();
      for (const t of types) {
        const label = labels[t] ? labels[t]() : t;
        menu.addItem((item) => item.setSection("type").setTitle(label)
          .setChecked(t === current).onClick(() => self.updateType(t)));
      }
      menu.addItem((item) => item.setSection("type").setTitle(gm.callout.optionOther ? gm.callout.optionOther() : "Other…")
        .onClick(() => {
          const Suggest = ng17CalloutTypeSuggest(host);
          new Suggest(self.app, (v) => self.updateType(v)).open();
        }));
      menu.addItem((item) => item.setSection("type").setTitle(gm.callout.type && gm.callout.type.none ? gm.callout.type.none() : "None")
        .onClick(() => self.remove()));
      if (menu.showAtMouseEvent) menu.showAtMouseEvent(event);
    });

    return el;
  };

  ng17CalloutClass = CalloutWidget;
  return ng17CalloutClass;
}

// ---- decoration state classes ----------------------------------------------

function ng17NodeClasses(node, prop) {
  const raw = node && node.type ? node.type.prop(prop) : "";
  return new Set(String(raw == null ? "" : raw).split(" "));
}

function ng17ViewportRange(view) {
  try {
    const rect = view.scrollDOM.getBoundingClientRect();
    const a = view.coordsAtPos ? null : null;
    void a; void rect;
  } catch (e) { /* noop */ }
  return { from: 0, to: view.state.doc.length };
}

/** Base fold/decoration state: holds tree + decorations, maps or rebuilds. */
function ng17FoldState(host) {
  const Base = function FoldDecorations(view) {
    this.view = view;
    this.tree = null;
    this.decorations = ng17E().s12cmDecoration.none;
    return this;
  };
  Base.prototype.rebuildOnSelection = false;
  Base.prototype.update = function (update) {
    const view = this.view;
    const tree = ng17E().tp ? ng17E().tp(view.state) : (host.cmSyntaxTree ? host.cmSyntaxTree(view.state) : null);
    const hasFx = update.transactions.some((t) => t.effects.length > 0);
    const needRebuild = !this.tree || this.tree !== tree || update.docChanged || hasFx ||
      (this.rebuildOnSelection && update.selectionSet);
    if (needRebuild) {
      this.tree = tree;
      this.decorations = this.buildDeco ? this.buildDeco(view) : ng17E().s12cmDecoration.none;
    } else if (update.docChanged) {
      this.decorations = this.decorations.map(update.changes);
    }
    return this.decorations;
  };
  Base.prototype.buildDeco = function () { return ng17E().s12cmDecoration.none; };
  return Base;
}

let ng17FoldClass = null;
export function ng17FoldDecorations(host) {
  if (ng17FoldClass) return ng17FoldClass;
  ng17FoldClass = ng17FoldState(host);
  return ng17FoldClass;
}

let ng17SelectionClass = null;
export function ng17SelectionDecorations(host) {
  if (ng17SelectionClass) return ng17SelectionClass;
  const Base = ng17FoldDecorations(host);
  function SelectionDecorations(view) {
    const self = Base.call(this, view) || this;
    return self;
  }
  inherit(SelectionDecorations, Base);
  SelectionDecorations.prototype.rebuildOnSelection = true;
  // The selection-highlight pass intentionally stays light: formatting marks
  // are owned by the syntax-highlight layer; this field exists so plugins can
  // subscribe to selection-driven decoration rebuilds.
  SelectionDecorations.prototype.buildDeco = function () { return ng17E().s12cmDecoration.none; };
  ng17SelectionClass = SelectionDecorations;
  return ng17SelectionClass;
}

let ng17TaskClass = null;
export function ng17TaskDecorations(host) {
  if (ng17TaskClass) return ng17TaskClass;
  const Base = ng17FoldDecorations(host);
  const TASK_RE = /^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[([^\]]?)\]/;

  function TaskDecorations(view) {
    const self = Base.call(this, view) || this;
    return self;
  }
  inherit(TaskDecorations, Base);

  TaskDecorations.prototype.buildDeco = function (view) {
    const decos = [];
    const D = ng17E().s12cmDecoration;
    const state = view.state;
    const tree = ng17E().tp ? ng17E().tp(state) : (host.cmSyntaxTree ? host.cmSyntaxTree(state) : null);
    if (!tree) return D.none;
    const vp = ng17ViewportRange(view);
    try {
      tree.iterate({
        from: vp.from,
        to: vp.to,
        enter(node) {
          const classes = ng17NodeClasses(node, host.livePreviewSyntaxClasses);
          if (!classes.has("HyperMD-task-line")) return;
          const line = state.doc.lineAt(node.from);
          const m = TASK_RE.exec(line.text);
          if (!m) return;
          const ch = m[1] || " ";
          decos.push(D.line({ attributes: { "data-task": ch } }).range(line.from));
        },
      });
    } catch (e) { /* partial tree: keep what we have */ }
    return D.set(decos, true);
  };

  ng17TaskClass = TaskDecorations;
  return ng17TaskClass;
}

// ---- html blocklist / small consts ------------------------------------------

export const ng17HtmlTagBlocklist = ["script", "style", "link", "meta", "object", "embed", "webview"];

export function ng17PrintModalCommand() {
  const v = ng17E().gm && ng17E().gm.editor && ng17E().gm.editor.printModal;
  return typeof v === "function" ? v() : v;
}

export function ng17EmptyWidgetSide() {
  const Empty = ng17EmptyWidget(null);
  return ng17E().s12cmDecoration.widget({ widget: new Empty(), side: -1 });
}

// ---- post-processor refresh --------------------------------------------------

export function ng17PostProcessRefresh(view) {
  s12cmRefreshDispatch(view);
}

let ng17PostProcessorClass = null;
export function ng17PostProcessorPlugin(owner) {
  if (ng17PostProcessorClass) return ng17PostProcessorClass;
  const VP = ng17E().s12cmViewPlugin;
  ng17PostProcessorClass = VP.define((view) => {
    const registration = owner.app.workspace.on("post-processor-change", () => ng17PostProcessRefresh(view));
    return {
      destroy() { try { registration.e.offref(registration); } catch (e) { /* noop */ } },
    };
  });
  return ng17PostProcessorClass;
}

// ---- selection / task fields -------------------------------------------------

let ng17SelectionFieldValue = null;
export function ng17SelectionField() {
  if (ng17SelectionFieldValue) return ng17SelectionFieldValue;
  const Cls = ng17SelectionDecorations(null);
  const VP = ng17E().s12cmViewPlugin;
  ng17SelectionFieldValue = VP.fromClass(Cls, { decorations: (p) => p.decorations });
  return ng17SelectionFieldValue;
}

let ng17TaskFieldValue = null;
export function ng17TaskField() {
  if (ng17TaskFieldValue) return ng17TaskFieldValue;
  const Cls = ng17TaskDecorations(null);
  const VP = ng17E().s12cmViewPlugin;
  ng17TaskFieldValue = VP.fromClass(Cls, { decorations: (p) => p.decorations });
  return ng17TaskFieldValue;
}

// ---- always-on editor extensions ---------------------------------------------

export function ng17EditorExtensions() {
  const E = ng17E();
  const VP = E.s12cmViewPlugin;
  const EV = E.s12cmEditorViewStatics;

  // (a) mouse-drag selection guard
  const dragGuard = VP.define((view) => {
    const plugin = { mousedown: false };
    const doc = view.dom.ownerDocument;
    const onUp = () => {
      plugin.mousedown = false;
      doc.removeEventListener("mouseup", onUp, true);
      doc.removeEventListener("drag", onUp, true);
    };
    view.dom.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      plugin.mousedown = true;
      doc.addEventListener("mouseup", onUp, true);
      doc.addEventListener("drag", onUp, true);
    });
    return plugin;
  });

  // (b) dom event handlers: focus/blur refresh + draggable guard.
  // CM6 calls handlers as (view, event); accept either order defensively.
  const pick = (a, b) => (a && a.state ? [a, b] : [b, a]);
  const handlers = EV.domEventHandlers({
    focus(a, b) { const [view] = pick(a, b); if (view) ng17PostProcessRefresh(view); },
    blur(a, b) { const [view] = pick(a, b); if (view) ng17PostProcessRefresh(view); },
    mousedown(a, b) {
      const [view, event] = a && a.state ? [a, b] : [b, a];
      if (!event || event.button !== 0) return;
      const t = event.target;
      const drag = t && t.closest ? t.closest("[draggable=\"true\"]") : null;
      if (drag) {
        drag.setAttribute("contenteditable", "false");
        event.preventDefault = function () { /* neutralised once */ };
      }
      void view;
    },
  });

  return [dragGuard, handlers];
}
