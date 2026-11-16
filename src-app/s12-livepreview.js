// s12 live preview: CodeMirror widget types, view plugins and extension factories that render
// markdown inline (callouts, math, images, embeds, tasks, code blocks) without leaving edit mode.
//
// Own modules never name minified identifiers: CM primitives come from env() (envBind s12cm*/s12req*),
// app classes come from the __basaltHost object handed to each class factory, and shared s12 singletons
// (decoration instances, plugin classes) live at module level in this file / s12-consts.js.

import { env } from "./env.js";
import { s12CalloutTypeLabels, s12CalloutTypeNames, s12cmMousePluginInstance, s12cmPostprocessFxRef, s12cmRefreshDispatch, s12appendImageSizeText, s12CmTransparentMark, s12CmUnderlineMark, s12CmListBulletMark, s12CmListNumberMark } from "./s12-consts.js";

const LPENV = () => env();
const deco = () => LPENV().s12cmDecoration;
const viewPlugin = () => LPENV().s12cmViewPlugin;

// Module-level slots filled by the class factories below (each factory runs at the original
// declaration position, so parents always exist before children).
let S12BlockquoteBorderWidget = null;
let S12HrWidget = null;
let S12TaskCheckboxWidget = null;
let S12StyleSpanWidget = null;
let S12CodeFlairWidget = null;
let S12EmptyWidgetType = null;
let S12MathWidget = null;
let S12HtmlWidget = null;
let S12ImageWidget = null;
let S12InternalEmbedWidget = null;
let S12CodeblockWidget = null;
let S12CalloutBaseWidget = null;
let S12CalloutWidget = null;
let S12CalloutOtherSuggest = null;
let S12NoteComposerSuggest = null;
let S12BaseDecoPlugin = null;
let S12SearchDecoPlugin = null;
let S12TaskLineDecoPlugin = null;

// Shared decoration singletons (the originals are single instances; identity matters because the
// search plugin compares decoration objects with ===).
let s12edgeHide = null, s12edgeShow = null, s12edgeAlt = null, s12quoteDeco = null, s12hrInstance = null, s12emptyDeco = null;
let s12syntaxTags = null;

function s12tags() {
  if (!s12syntaxTags) {
    s12syntaxTags = new Set(["em", "strong", "inline-code", "strikethrough", "highlight", "link", "image",
      "hmd-internal-link", "hmd-embed", "formatting-link", "footref"]);
  }
  return s12syntaxTags;
}

// The three "codeblock edge" replace decorations bound by the X2/Z2/$2 declarators. They are reached
// through the host object inside class factories (host.livePreviewCodeblockHide/Show/s12cmEdgeMarkAlt).

// =====================================================================================================================
// Simple CodeMirror widget types (extend the widget base = Rn)
// =====================================================================================================================

export function defineS12BlockquoteBorderWidget(host) {
  const Base = LPENV().s12cmWidgetType;
  S12BlockquoteBorderWidget = class extends Base {
    toDOM() {
      return createSpan({ cls: "cm-blockquote-border cm-transparent", text: ">" });
    }
  };
  return S12BlockquoteBorderWidget;
}

export function defineS12HrWidget(host) {
  const Base = LPENV().s12cmWidgetType;
  S12HrWidget = class extends Base {
    eq() { return true; }
    toDOM(view) {
      const el = s12CreateDiv("hr cm-line");
      el.createEl("br");
      el.addEventListener("click", () => {
        const pos = view.posAtDOM(el);
        const line = view.state.doc.lineAt(pos);
        view.dispatch({ selection: { head: line.from, anchor: line.to } });
      });
      el.createEl("hr");
      return el;
    }
    destroy(el) { el.detach(); }
    get estimatedHeight() { return 20; }
  };
  return S12HrWidget;
}

export function defineS12TaskCheckboxWidget(host) {
  const Base = LPENV().s12cmWidgetType;
  const isAndroid = LPENV().Yl.isAndroidApp;
  S12TaskCheckboxWidget = class extends Base {
    constructor(content) { super(); this.content = content; }
    eq(other) { return other.content === this.content; }
    updateDOM(el) {
      if (el.instanceOf(HTMLLabelElement) && el.firstChild && el.firstChild.instanceOf(HTMLInputElement)) {
        const input = el.firstChild;
        input.setAttribute("data-task", this.content);
        input.checked = " " !== this.content;
        return true;
      }
      return false;
    }
    toDOM(view) {
      const label = createEl("label", "task-list-label");
      const input = label.createEl("input", { cls: "task-list-item-checkbox", type: "checkbox" });
      input.setAttribute("data-task", this.content);
      input.checked = " " !== this.content;
      label.addEventListener("mousedown", (e) => e.preventDefault());
      input.addEventListener("input", () => {
        const pos = view.posAtDOM(input);
        const line = view.state.doc.lineAt(pos);
        const idx = line.text.search(/\[.]/);
        if (-1 === idx) return;
        const cur = line.text.charAt(idx + 1);
        const at = line.from + idx + 1;
        navigator.vibrate(100);
        view.dispatch({ changes: [{ from: at, to: at + 1, insert: " " === cur ? "x" : " " }] });
        if (isAndroid) {
          const top = view.scrollDOM.scrollTop;
          const cleanup = () => view.scrollDOM.removeEventListener("scroll", end, { capture: true });
          const end = (e2) => {
            cleanup();
            e2.preventDefault();
            view.scrollDOM.scrollTop = top;
          };
          view.scrollDOM.addEventListener("scroll", end, { capture: true, passive: false });
          input.win.setTimeout(cleanup, 200);
        }
      });
      return label;
    }
  };
  return S12TaskCheckboxWidget;
}

export function defineS12StyleSpanWidget(host) {
  const Base = LPENV().s12cmWidgetType;
  S12StyleSpanWidget = class extends Base {
    constructor(styles) { super(); this.styles = styles; }
    eq(other) { return this.styles === other.styles; }
    toDOM() { return createSpan(this.styles); }
    ignoreEvent() { return false; }
  };
  return S12StyleSpanWidget;
}

export function defineS12CodeFlairWidget(host) {
  const Base = LPENV().s12cmWidgetType;
  const gm = LPENV().gm, fb = LPENV().fb;
  const applyIcon = LPENV().s12applyIcon, ariaTip = LPENV().s12ariaTooltip;
  S12CodeFlairWidget = class extends Base {
    constructor(lang, code) { super(); this.lang = lang; this.code = code; }
    eq(other) { return other.lang === this.lang && other.code === this.code; }
    toDOM() {
      const el = createSpan({ cls: "code-block-flair", text: this.lang });
      if (!this.lang) applyIcon(el, "lucide-copy");
      ariaTip(el, gm.interface.menu.copy());
      el.addEventListener("click", async () => {
        let code = this.code;
        if (code.endsWith("\n")) code = code.substr(0, code.length - 1);
        await navigator.clipboard.writeText(code);
        new fb(gm.interface.copied({ context: "generic" }));
      });
      return el;
    }
  };
  return S12CodeFlairWidget;
}

export function defineS12EmptyWidgetType(host) {
  const Base = LPENV().s12cmWidgetType;
  S12EmptyWidgetType = class extends Base {
    toDOM() { return createSpan(); }
    ignoreEvent() { return true; }
    eq() { return true; }
  };
  return S12EmptyWidgetType;
}

// =====================================================================================================================
// Live-preview block widgets (extend the embeddable widget base = FV / NV)
// =====================================================================================================================

export function defineS12MathWidget(host) {
  const Base = LPENV().s12widgetBase;
  const ready = LPENV().s12mathReady, render = LPENV().s12renderMath, recalc = LPENV().s12recalcMath;
  S12MathWidget = class extends Base {
    constructor(math, block) { super(); this.math = math; this.block = block; }
    get noReuse() { return true; }
    initDOM(view) {
      const el = createEl(this.block ? "div" : "span", "math");
      if (this.block) { el.createEl("br"); el.createEl("br"); this.addEditButton(view, el); }
      this.hookClickHandler(view, el);
      this.resizeWidget(view, el);
      this.render(el);
      return el;
    }
    render(el) {
      const self = this;
      ready.then(() => {
        el.toggleClass("math-block", self.block);
        el.toggleClass("cm-embed-block", self.block);
        const editBtn = el.find(".edit-block-button");
        el.empty();
        try {
          el.appendChild(render(self.math, self.block));
        } catch (err) {
          el.appendText(self.math);
        }
        if (editBtn) el.appendChild(editBtn);
        recalc();
      });
    }
    get estimatedHeight() { return 50; }
  };
  return S12MathWidget;
}

export function defineS12HtmlWidget(host) {
  const Base = LPENV().s12widgetBase;
  const sanitize = host.sanitizeHtml;
  S12HtmlWidget = class extends Base {
    constructor(app, editor, html, block) {
      super();
      this.app = app; this.editor = editor; this.html = html; this.block = block;
    }
    get noReuse() { return true; }
    initDOM(view) {
      const el = createEl(this.block ? "div" : "span", "cm-html-embed" + (this.block ? " cm-embed-block" : ""));
      el.tabIndex = -1;
      el.appendChild(sanitize(this.html));
      if (this.block) this.addEditButton(view, el);
      this.app.fixFileLinks(el, this.editor.path);
      this.hookClickHandler(view, el);
      this.resizeWidget(view, el);
      return el;
    }
    get estimatedHeight() { return 40; }
  };
  return S12HtmlWidget;
}

/** Shared "copy image / swap file / reset size / delete / resize" behaviour for image embeds. */
export function s12imageContextMenu(widget, view, containerEl, imgEl, wrapperEl) {
  const e = LPENV();
  const { Ug, gm, Yl, electron, fb, MT } = e;
  wrapperEl.addEventListener("contextmenu", (ev) => {
    const menu = Ug.forEvent(ev);
    menu.setParentElement(containerEl);
    menu.addSections(["image"]);
    menu.addItem((item) => item.setSection("image").setTitle(gm.interface.menu.copyImage()).setIcon("lucide-copy")
      .onClick(async () => {
        try {
          let buf, mime = "image/png";
          if (widget instanceof S12InternalEmbedWidget && widget.child instanceof e.s12imageFileEmbed && widget.child.file) {
            const file = widget.child.file;
            buf = await widget.app.vault.readBinary(file);
            mime = Object.keys(e.s12mimeMap).find((k) => e.s12mimeMap[k] === file.extension) || "image/png";
          } else if (widget instanceof S12ImageWidget) {
            const res = await e.s12fetchBuffer(widget.url);
            buf = res.arrayBuffer;
            const ct = e.s12headerLookup(res.headers, "content-type");
            if (ct && ct.startsWith("image/")) mime = ct;
          }
          if (buf) {
            if (!Yl.isDesktopApp || ("image/png" !== mime && "image/jpeg" !== mime)) {
              mime = "image/png";
              await navigator.clipboard.write([new ClipboardItem({ [mime]: new Blob([buf], { type: mime }) })]);
            } else {
              const img = electron.nativeImage.createFromBuffer(e.s12toBuffer(buf));
              e.s12nativeClipboard().writeImage(img);
              return;
            }
          } else {
            throw new Error("no image data");
          }
        } catch (err) {
          new fb(gm.interface.copy_failed());
        }
      }));
    if (widget instanceof S12InternalEmbedWidget) {
      const app = widget.app, href = widget.href, sourcePath = widget.sourcePath;
      app.workspace.handleLinkContextMenu(menu, href, sourcePath);
      menu.addItem((item) => item.setSection("image").setTitle(gm.plugins.canvas.actionSwapFile())
        .setIcon("lucide-arrow-left-right").onClick(() => {
          const napp = widget.app, npath = widget.sourcePath, ntitle = widget.title;
          new S12NoteComposerSuggest(napp, (file) => {
            const start = widget.start, end = widget.end;
            const link = napp.fileManager.generateMarkdownLink(file, npath, void 0, ntitle);
            view.dispatch({ changes: [{ from: start, to: end, insert: "!" + link }], scrollIntoView: false });
          }).open();
        }));
    }
    if (null !== imgEl.getAttribute("width")) {
      menu.addItem((item) => item.setSection("image").setTitle(gm.editor.menu.resetSize()).setIcon("lucide-rotate-ccw")
        .onClick(() => {
          const start = widget.start, end = widget.end;
          const text = view.state.doc.sliceString(start, end);
          const sized = s12appendImageSizeText(text);
          view.dispatch({ changes: [{ from: start, to: end, insert: sized }] });
          imgEl.removeAttribute("width");
        }));
    }
    if (widget instanceof S12InternalEmbedWidget) {
      const app = widget.app;
      const linkPath = MT(widget.href).path;
      const dest = app.metadataCache.getFirstLinkpathDest(linkPath, widget.sourcePath);
      menu.addItem((item) => item.setSection("danger").setTitle(gm.editor.menu.deleteImage()).setWarning(true)
        .setIcon("lucide-trash-2").onClick(async () => {
          const start = widget.start, end = widget.end;
          if (await app.fileManager.promptForDeletion(dest)) {
            view.dispatch({ userEvent: "select.pointer", selection: LPENV().pe.cursor(start),
              changes: [{ from: start, to: end, insert: "" }] });
          }
        }));
    }
  });
  if (!Yl.isMobile) {
    wrapperEl.createDiv("image-resize-corner", (corner) => {
      corner.addEventListener("dblclick", (ev) => {
        if (ev.defaultPrevented) return;
        const start = widget.start, end = widget.end;
        const text = view.state.doc.sliceString(start, end);
        const sized = s12appendImageSizeText(text);
        if (text !== sized) view.dispatch({ changes: [{ from: start, to: end, insert: sized }] });
      });
      corner.addEventListener("pointerdown", (ev) => {
        if (!ev.isPrimary || 0 !== ev.button) return;
        ev.preventDefault();
        containerEl.focus();
        let pos = e.s12pointerPos(ev);
        const w = imgEl.offsetWidth, h = imgEl.offsetHeight;
        const rtl = "rtl" === getComputedStyle(containerEl).direction;
        const rect = imgEl.getBoundingClientRect();
        const originX = rtl ? rect.right : rect.left, originY = rect.top;
        const maxW = view.contentDOM.offsetWidth, ratio = w / h;
        let raf = null;
        e.s12dragPointer(ev, () => ({
          move(ev2) {
            pos = e.s12pointerPos(ev2);
            if (!raf) {
              raf = requestAnimationFrame(() => {
                const dx = Math.abs(pos.x - originX), dy = Math.abs(pos.y - originY);
                const size = Math.max(dx, dy * ratio);
                imgEl.width = Math.round(Math.clamp(size, 20, maxW));
                raf = null;
              });
            }
          },
          end() {
            const start = widget.start, end = widget.end;
            const text = view.state.doc.sliceString(start, end);
            const sized = s12appendImageSizeText(text, Math.round(imgEl.clientWidth));
            if (text !== sized) view.dispatch({ changes: [{ from: start, to: end, insert: sized }] });
          },
          cleanup() { if (raf) { cancelAnimationFrame(raf); raf = null; } },
        }), 0);
      });
    });
  }
}

export function defineS12ImageWidget(host) {
  const Base = LPENV().s12widgetBase;
  const normalize = host.normalizeEmbedUrl;
  const iframe = LPENV().s12iframeEmbed;
  const isDim = host.isImageDimension;
  const lastSegment = LPENV().nu;
  S12ImageWidget = class extends Base {
    constructor(url, title) { super(); this.url = url; this.title = title; }
    get noReuse() { return true; }
    initDOM(view) {
      const framed = normalize(this.url);
      let el;
      if (framed) {
        el = iframe(framed);
      } else {
        el = s12CreateDiv("image-embed");
        el.tabIndex = -1;
        const wrapper = el.createDiv("image-wrapper");
        const img = wrapper.createEl("img");
        img.src = this.url;
        this.imageEl = img;
        this.applyTitle(this.title);
        s12imageContextMenu(this, view, el, img, wrapper);
      }
      this.addEditButton(view, el);
      this.resizeWidget(view, el);
      return el;
    }
    applyTitle(title) {
      this.title = title;
      const img = this.imageEl;
      if (!img) return;
      let w = 0, h = 0;
      if (title) {
        const take = (t) => {
          const d = isDim(t);
          if (!d) return false;
          w = d.x; h = d.y; return true;
        };
        const bar = title.lastIndexOf("|");
        if (bar !== -1) { if (take(title.substr(bar + 1))) title = title.substr(0, bar); }
        else if (take(title)) title = "";
      }
      if (!title) title = lastSegment(this.url);
      img.setAttr("width", 0 === w ? null : String(w));
      img.setAttr("height", 0 === h ? null : String(h));
      img.setAttr("alt", title);
    }
    get estimatedHeight() { return 30; }
  };
  return S12ImageWidget;
}

export function defineS12InternalEmbedWidget(host) {
  const Base = LPENV().s12embedChildBase;
  const EmbedLoader = host.EmbedLoader;
  const isDim = host.isImageDimension;
  const pdfEmbed = LPENV().s12pdfEmbed, basesEmbed = LPENV().s12basesEmbed, imageFileEmbed = LPENV().s12imageFileEmbed;
  S12InternalEmbedWidget = class extends Base {
    constructor(app, editor, sourcePath, href, title, depth) {
      super(app, editor);
      this.sourcePath = sourcePath; this.href = href; this.title = title; this.depth = depth;
    }
    initDOM(view) {
      const app = this.app, sourcePath = this.sourcePath, href = this.href, title = this.title, depth = this.depth;
      const el = this.containerEl = s12CreateDiv("internal-embed");
      el.tabIndex = -1;
      el.setAttr("src", href);
      const child = this.child = EmbedLoader.load({ app, linktext: href, sourcePath, containerEl: el, displayMode: false, showInline: true, depth });
      if (child) { this.addChild(child); child.loadFile(); }
      this.applyTitle(el, title);
      if (child instanceof pdfEmbed || child instanceof basesEmbed) {
        this.addEditButton(view, el);
      } else if (child instanceof imageFileEmbed) {
        this.addEditButton(view, el);
        const img = child.containerEl.find("img");
        if (img) {
          const wrapper = child.containerEl.createDiv("image-wrapper");
          wrapper.append(img);
          s12imageContextMenu(this, view, el, img, wrapper, host);
        }
      } else {
        this.hookClickHandler(view, el);
      }
      this.resizeWidget(view, el);
      return el;
    }
    applyTitle(el, title) {
      this.title = title;
      let w = 0, h = 0;
      if (title) {
        const take = (t) => {
          const d = isDim(t);
          if (!d) return false;
          w = d.x; h = d.y; return true;
        };
        const bar = title.lastIndexOf("|");
        if (bar !== -1) { if (take(title.substr(bar + 1))) title = title.substr(0, bar); }
        else if (take(title)) title = "";
      }
      el.setAttr("alt", title || null);
      el.setAttr("width", 0 === w ? null : String(w));
      el.setAttr("height", 0 === h ? null : String(h));
      const child = this.child;
      if (child instanceof imageFileEmbed) {
        const img = child.containerEl.find("img");
        if (img) {
          img.setAttr("alt", title || null);
          img.setAttr("width", 0 === w ? null : String(w));
          img.setAttr("height", 0 === h ? null : String(h));
        }
      }
    }
    get estimatedHeight() { return 100; }
  };
  return S12InternalEmbedWidget;
}

export function defineS12CodeblockWidget(host) {
  const Base = LPENV().s12embedChildBase;
  const codeTexts = host.codeTexts;
  const queryEmbed = host.queryEmbed;
  const renderer = host.MarkdownPreviewRenderer;
  const hex = host.randomHex;
  S12CodeblockWidget = class extends Base {
    constructor(app, editor, code, lang) {
      super(app, editor);
      this.installed = false; this.rendered = false;
      this.lang = lang; this.code = code;
    }
    initDOM(view) {
      const app = this.app, editor = this.editor, lang = this.lang;
      const el = this.containerEl = s12CreateDiv("cm-preview-code-block cm-embed-block cm-lang-" + lang);
      el.tabIndex = -1;
      const pre = el.createEl("pre");
      const codeEl = pre.createEl("code", "language-" + lang);
      codeTexts.set(codeEl, this.code);
      if ("mermaid" === lang) {
        LPENV().s12syntaxHighlight(el.contentDOM, [codeEl]);
      } else if ("query" === lang) {
        this.addChild(queryEmbed(app, this.code, pre, editor.path));
      } else if (renderer.codeBlockPostProcessors.hasOwnProperty(lang)) {
        el.empty();
        const blockEl = el.createDiv("block-language-" + lang);
        const proc = renderer.codeBlockPostProcessors[lang];
        const self = this;
        try {
          proc(this.code, blockEl, {
            docId: hex(16),
            sourcePath: editor.path,
            frontmatter: {},
            promises: [],
            addChild: (c) => self.addChild(c),
            getSectionInfo: (node) => el.contains(node) ? { lineStart: self.lineStart, lineEnd: self.lineEnd, text: view.state.doc.toString() } : null,
            replace: (text) => {
              view.dispatch({ changes: { from: view.state.doc.line(self.lineStart + 1).from, to: view.state.doc.line(self.lineEnd + 1).to, insert: text } });
            },
            replaceCode: (text) => {
              self.code = text;
              codeTexts.set(codeEl, self.code);
              const start = self.start;
              const end = self.end;
              self.end = start + text.length;
              view.dispatch({ changes: { from: start, to: end, insert: text } });
            },
            containerEl: view.scrollDOM,
            el: blockEl,
          });
        } catch (err) {
          console.error(err);
          new LPENV().fb(LPENV().gm.interface.copy_failed());
        }
      }
      return el;
    }
    get estimatedHeight() { return 50; }
  };
  return S12CodeblockWidget;
}

// =====================================================================================================================
// Callout widgets
// =====================================================================================================================

export function defineS12CalloutBaseWidget(host) {
  const Base = LPENV().s12embedChildBase;
  const parseTree = host.markdownTree;
  const frontmatter = host.treeFrontmatter;
  const checklist = LPENV().jC;
  const sanitize = host.sanitizeHtml;
  const toHtml = host.treeToHtml;
  const preview = host.MarkdownPreviewView;
  const hex = host.randomHex;
  const resolveLinks = host.refreshLinkStates;
  S12CalloutBaseWidget = class extends Base {
    constructor(app, editor, text, clazz) {
      super(app, editor);
      this.text = text; this.clazz = clazz;
    }
    initDOM(view) {
      const app = this.app, editor = this.editor, text = this.text, clazz = this.clazz;
      const el = this.containerEl = s12CreateDiv("cm-embed-block " + clazz);
      el.tabIndex = -1;
      const rendered = el.createDiv("markdown-rendered");
      const tree = parseTree(text);
      const fm = frontmatter(tree);
      checklist(tree, "checklist", (node) => {
        const line = node.position.start.line - 1;
        node.data.hProperties["data-line"] = String(line);
      });
      const html = sanitize(toHtml(tree));
      rendered.toggleClass("rtl", app.vault.getConfig("rightToLeft"));
      rendered.toggleClass("show-indentation-guide", app.vault.getConfig("showIndentGuide"));
      rendered.appendChild(html);
      preview.postProcess(app, {
        docId: hex(16), sourcePath: editor.path, frontmatter: fm, promises: [],
        addChild: (c) => this.addChild(c),
        getSectionInfo: () => null,
        replace: () => null,
        containerEl: el, el: rendered, displayMode: false,
      });
      this.resolveLinks();
      this.hookClickHandler(view, el);
      this.addEditButton(view, el);
      this.resizeWidget(view, el);
      return el;
    }
    resolveLinks() { resolveLinks(this.app, this.containerEl, this.editor.path); }
    get estimatedHeight() {
      let lines = 1;
      for (let i = 0; -1 !== (i = this.text.indexOf("\n", i));) { lines++; i++; }
      return lines * this.editor.cm.defaultLineHeight;
    }
  };
  return S12CalloutBaseWidget;
}

export function defineS12CalloutWidget(host) {
  const measure = LPENV().s12measureIndent;
  const gm = LPENV().gm, Menu = LPENV().Ug, widgetBase = LPENV().s12widgetBase;
  const toggleBox = host.MarkdownRenderer;
  const labels = s12CalloutTypeLabels;
  S12CalloutWidget = class extends S12CalloutBaseWidget {
    constructor(app, editor, unused, text) { super(app, editor, text, "cm-callout"); }
    getTypePos() {
      const start = this.start;
      const line = this.editor.cm.state.doc.lineAt(start);
      const open = line.text.indexOf("[!") + 2;
      return [open, line.text.indexOf("]", open)];
    }
    getType() {
      const start = this.start;
      const line = this.editor.cm.state.doc.lineAt(start);
      const [a, b] = this.getTypePos();
      return line.text.slice(a, b);
    }
    updateType(type) {
      const start = this.start;
      const cm = this.editor.cm;
      const [a, b] = this.getTypePos();
      cm.dispatch({ changes: [{ from: start + a, to: start + b, insert: type }] });
    }
    remove() {
      const start = this.start, end = this.end, cm = this.editor.cm;
      const first = cm.state.doc.lineAt(start), last = cm.state.doc.lineAt(end);
      const changes = [{ from: first.from, to: first.to + 1, insert: "" }];
      for (let n = first.number + 1; n <= last.number; n++) {
        const line = cm.state.doc.line(n);
        const indent = measure(line.text);
        changes.push({ from: line.from, to: line.from + indent, insert: "" });
      }
      cm.dispatch({ changes });
    }
    initDOM(view) {
      const self = this;
      const el = super.initDOM(view);
      el.on("click", ".task-list-item-checkbox", (ev, node) => {
        let cur = node;
        let inside = false;
        for (; cur; cur = cur.parentElement) {
          if (cur === el) { inside = true; break; }
          if (cur.classList.contains("markdown-preview-view")) break;
        }
        if (!inside) return;
        const lineNo = parseInt(node.getAttribute("data-line"));
        if (!(lineNo < 0 || isNaN(lineNo)) && node.instanceOf(HTMLInputElement)) {
          ev.preventDefault();
          navigator.vibrate(100);
          const toggled = toggleBox.toggleCheckbox(self.text, lineNo);
          if (toggled !== null) {
            self.text = toggled.text;
            view.dom.win.setTimeout(() => {
              const checked = " " !== toggled.char;
              node.checked = checked;
              const li = node.parentNode;
              if (li && li.instanceOf(HTMLLIElement)) {
                li.setAttr("data-task", toggled.char);
                li.toggleClass("is-checked", checked);
              }
            }, 0);
            view.dispatch({ changes: [{ from: self.start, to: self.end, insert: toggled.text }] });
          }
        }
      });
      el.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        const type = self.getType();
        const menu = Menu.forEvent(ev).setNoIcon().addSections(["edit", "clipboard", "type", "", "danger"]);
        menu.addItem((item) => item.setTitle(gm.interface.menu.edit()).setSection("edit")
          .onClick(() => widgetBase.selectElement(self, self.containerEl)));
        menu.setSectionSubmenu("type", { title: gm.callout.optionType() });
        for (const key of Object.keys(labels())) {
          const label = labels()[key];
          menu.addItem((item) => item.setTitle(label()).setSection("type").setChecked(key === type)
            .onClick(() => self.updateType(key)));
        }
        menu.addItem((item) => item.setTitle(gm.callout.optionOther()).setSection("type")
          .onClick(() => new S12CalloutOtherSuggest(self.app, (t) => self.updateType(t)).open()))
          .addItem((item) => item.setTitle(gm.callout.type.none()).setSection("type")
            .onClick(() => self.remove()));
      });
      return el;
    }
  };
  return S12CalloutWidget;
}

/** The "other callout type" fuzzy suggest used by the callout context menu. */
export function defineS12CalloutOtherSuggest(host) {
  const Base = host.FuzzySuggestModal;
  const gm = LPENV().gm;
  S12CalloutOtherSuggest = class extends Base {
    constructor(app, onSubmit) {
      super(app);
      this.onSubmit = onSubmit;
      this.setPlaceholder(gm.callout.optionOtherPlaceholder());
      this.setInstructions([
        { command: "↑↓", purpose: gm.plugins.commandPalette.instructionNavigate() },
        { command: "↵", purpose: gm.plugins.commandPalette.instructionUse() },
        { command: "esc", purpose: gm.plugins.commandPalette.instructionDismiss() },
      ]);
      this.scope.register(null, "Tab", () => false);
      this.scope.register(null, "Enter", (ev) => {
        if (ev.isComposing) return;
        this.selectActiveSuggestion(ev);
        return false;
      });
    }
    getItemText(item) { return item; }
    getItems() { return s12CalloutTypeNames(); }
    getSuggestions(query) {
      const items = super.getSuggestions(query);
      return 0 === items.length ? [{ item: query, match: { score: 0, matches: [] } }] : items;
    }
    onChooseItem(item) { this.onSubmit(item); }
  };
  return S12CalloutOtherSuggest;
}

/** File-embed suggest used by the image context menu "swap file" action. */
export function defineS12NoteComposerSuggest(host) {
  const Base = LPENV().s12fileSuggestBase;
  const gm = LPENV().gm;
  S12NoteComposerSuggest = class extends Base {
    constructor(app, onChoose) {
      super(app);
      this.emptyStateText = gm.plugins.noteComposer.labelNoFiles();
      this.context = "embed";
      this.shouldShowImages = true;
      this.allowCreateNewFile = false;
      this.shouldShowUnresolved = false;
      this.shouldShowMarkdown = false;
      this.shouldShowNonImageAttachments = false;
      this.shouldShowNonAttachments = false;
      this.shouldShowAllTypes = false;
      this.handleChoose = onChoose;
      this.setPlaceholder(gm.interface.mobile.actionChooseFileToInsert());
      this.setInstructions([
        { command: "↑↓", purpose: gm.plugins.quickSwitcher.instructionNavigate() },
        { command: "↵", purpose: gm.plugins.quickSwitcher.instructionSelect() },
        { command: "esc", purpose: gm.plugins.quickSwitcher.instructionDismiss() },
      ]);
    }
    onChooseSuggestion(s) {
      if ("file" !== s.type && "alias" !== s.type) return;
      this.handleChoose(s.file);
      this.app.workspace.addRecentFile(s.file);
    }
  };
  return S12NoteComposerSuggest;
}

// =====================================================================================================================
// Decoration view plugins (the search/highlight plugin extends the base = M6)
// =====================================================================================================================

export function defineS12BaseDecoPlugin(host) {
  const txHas = LPENV().s12txHasEffect;
  const syntaxTree = host.cmSyntaxTree;
  S12BaseDecoPlugin = class {
    constructor(view) {
      this.tree = syntaxTree(view.state);
      this.decorations = this.buildDeco(view);
    }
    update(update) {
      const tree = syntaxTree(update.state);
      const mouse = update.view.plugin(s12cmMousePluginInstance());
      if (tree.length < update.view.viewport.to || update.view.composing || (mouse && mouse.mousedown)) {
        this.decorations = this.decorations.map(update.changes);
      } else if (tree !== this.tree || update.viewportChanged || update.selectionSet
        || txHas(update.transactions, s12cmPostprocessFxRef())
        || txHas(update.transactions, host.cmHighlightField)
        || txHas(update.transactions, host.cmFilterEffect)) {
        this.tree = tree;
        this.decorations = this.buildDeco(update.view);
      }
    }
    buildDeco() { return deco().none; }
  };
  return S12BaseDecoPlugin;
}

export function defineS12SearchDecoPlugin(host) {
  const sel = host.cmSelection;
  const syntaxTree = host.cmSyntaxTree;
  const prop = LPENV().s12syntaxClassProp;
  const listPattern = host.listLinePattern;
  const builder = LPENV().s12rangeSetBuilder;
  const hlField = LPENV().s12cmHighlightDecoField;
  const rangeHas = LPENV().s12rangeHasMatch, rangeHasMark = LPENV().s12rangeContainsMark;
  const cache = host.highlightCache;
  const isUrlLike = LPENV().s12isUrlLike;
  const mousePlugin = () => s12cmMousePluginInstance();
  S12SearchDecoPlugin = class extends S12BaseDecoPlugin {
    update(update) {
      const state = update.state, view = update.view;
      if (!update.docChanged && update.selectionSet) {
        const plugin = view.plugin(mousePlugin());
        if (!(plugin && plugin.mousedown)) {
          const selection = state.selection;
          const decos = this.decorations;
          let changed = false;
          const clampEdge = (pos, from, to, d, multiline, isAnchor) => {
            if (from <= pos && pos <= to) {
              if (d === host.livePreviewCodeblockHide) pos = Math.min(from, pos);
              else if (d === host.livePreviewCodeblockShow) pos = Math.max(to, pos);
              else if (d === host.s12cmEdgeMarkAlt && isAnchor) pos = Math.min(from, pos);
            }
            return pos;
          };
          const ranges = selection.ranges.map((range) => {
            const anchor0 = range.anchor, head0 = range.head;
            let r = anchor0, h = head0;
            const multiline = state.doc.lineAt(r).number !== state.doc.lineAt(h).number;
            let moved = false;
            const visit = (from, to, d) => {
              const nr = clampEdge(r, from, to, d, multiline, true);
              const nh = clampEdge(h, from, to, d, multiline, false);
              if (nr !== r || nh !== h) { r = nr; h = nh; moved = true; }
            };
            for (let i = 0; i < 10; i++) {
              moved = false;
              decos.between(r, r, visit);
              if (r !== h) decos.between(h, h, visit);
              if (!moved) break;
            }
            return (r !== anchor0 || h !== head0) ? (changed = true, sel.range(r, h)) : range;
          });
          if (changed) {
            view.dom.win.setTimeout(() => {
              if (selection === state.selection) view.dispatch({ selection: sel.create(ranges, selection.mainIndex) });
            });
          }
        }
      }
      super.update(update);
    }
    buildDeco(view) {
      if (!this.tree.length) return deco().none;
      const state = view.state;
      const selRanges = state.hasFocus ? state.selection.ranges : [];
      const field = state.field(hlField);
      const hlKey = cache.get("basalt-search-match-highlight");
      const inHighlight = (from, to) => rangeHas(selRanges, from, to) || rangeHasMark(field, hlKey, from, to);
      const lineInHighlight = (pos) => {
        const line = state.doc.lineAt(pos);
        return inHighlight(line.from, line.to);
      };
      const set = new builder();
      let lastEnd = 0;
      const self = this;
      const edgeHide = host.livePreviewCodeblockHide, edgeShow = host.livePreviewCodeblockShow, edgeAlt = host.s12cmEdgeMarkAlt;
      const walk = (from, to) => {
        let segStart = from, segEnd = from, pending = null;
        const push = (d) => { if (!pending) pending = []; pending.push(d); };
        const flush = (pos) => {
          if (pending) {
            if (inHighlight(segStart, segEnd)) {
              for (const d of pending) { if (d.always) set.add(d.from, d.to, d.deco); }
            } else {
              if (pending.length > 1) {
                const last = pending[pending.length - 1];
                if (last.deco === edgeHide) last.deco = edgeShow;
              }
              for (const d of pending) set.add(d.from, d.to, d.deco);
            }
            pending = null;
          }
          segStart = pos; segEnd = pos;
        };
        let urlText = "", hasUrl = false;
        self.tree.iterate({
          from, to,
          enter(node) {
            const type = node.type, i = node.from, s = node.to;
            const cls = type.prop(prop);
            const nodeText = () => state.doc.sliceString(i, s);
            if (!(i === segEnd && cls)) flush(i);
            if (!pending) return;
            if (i < lastEnd) return;
            lastEnd = s;
            const classes = cls.split(" ");
            const set2 = new Set(classes);
            if (set2.has("hmd-codeblock")) return;
            if (set2.has("formatting-header")) {
              const line = state.doc.lineAt(i);
              if (!(inHighlight(line.from, line.to) || line.text.trim() === nodeText().trim())) {
                push({ from: i, to: s, deco: edgeAlt });
              }
              return;
            }
            if (set2.has("formatting-quote")) {
              if (!lineInHighlight(i)) {
                push(set2.has("quote-1")
                  ? { from: i, to: i + 1, deco: s12CmTransparentMark() }
                  : { from: i, to: i + 1, deco: s12quoteDecoRef() });
              }
              return;
            }
            if (set2.has("hmd-escape-backslash")) {
              if (!lineInHighlight(i)) push({ from: i, to: s, deco: edgeHide });
            }
            const inline = classes.some((c) => s12tags().has(c));
            let formatting = set2.has("formatting");
            const isUrlStr = set2.has("string") && set2.has("url");
            const isLink = set2.has("link") && !set2.has("url") && !formatting;
            const isWiki = set2.has("hmd-internal-link") && !set2.has("link-has-alias") && !set2.has("link-alias-pipe") && !set2.has("hmd-embed");
            const isEmbedLink = isLink || isWiki;
            const isImage = set2.has("image");
            const isLinkFmt = set2.has("formatting-link") || set2.has("link-has-alias") || set2.has("link-alias-pipe");
            const isTask = set2.has("formatting-task");
            let isLinkEnd = set2.has("formatting-link-end") || isUrlStr;
            const isList = set2.has("formatting-list-ul");
            const isUrlNode = set2.has("url") && !set2.has("string");
            if (isImage) hasUrl = true;
            else if (!set2.has("url")) hasUrl = false;
            if (set2.has("formatting-link-start") && state.doc.length >= s + 2 && "]]" === state.doc.sliceString(s, s + 2)) return;
            if (set2.has("formatting-link-end") && i >= 2 && "[[" === state.doc.sliceString(i - 2, i)) return;
            const interesting = isLinkFmt || isUrlStr || isEmbedLink || isTask || isList || isUrlNode;
            if (set2.has("hmd-barelink") && !set2.has("hmd-footnote")) { formatting = interesting = false; }
            if (isLinkFmt && set2.has("link") && set2.has("url")) {
              if (!inHighlight(i, s)) push({ from: i, to: s, deco: s12CmUnderlineMark() });
              if (s + 1 < state.doc.length && ">" === state.doc.sliceString(s, s + 1)) {
                push({ from: s, to: s + 1, deco: edgeShow });
              }
              segEnd = s + 1;
              return;
            }
            if ((isLinkFmt && set2.has("link") && "]" === nodeText()) || (formatting && isUrlStr && "(" === nodeText())) isLinkEnd = true;
            if ((inline || interesting) && (segEnd = s, !formatting || interesting)) {
              const d = { from: i, to: s, deco: isLinkEnd ? edgeShow : edgeHide };
              if (isTask) {
                const mark = state.doc.sliceString(i + 1, i + 2);
                d.deco = deco().widget({ widget: new S12TaskCheckboxWidget(mark) });
              } else if (isList) {
                const line = state.doc.lineAt(i);
                const m = line.text.match(listPattern);
                if (!(m && m[6])) { d.deco = s12CmListBulletMark(); d.to = segEnd = i + 1; }
              } else if (isEmbedLink) {
                const next = nodeText();
                if (isWiki && next.length > 1 && next.startsWith("#")) {
                  push({ from: i, to: i + 1, deco: edgeHide });
                  d.from++;
                }
                d.deco = s12CmUnderlineMark();
              } else if (isUrlNode) {
                d.deco = s12CmUnderlineMark();
              }
              push(d);
            }
            if (set2.has("formatting-list-ol")) {
              segEnd = s;
              push({ from: i, to: s, deco: s12CmListNumberMark() });
            }
            if (set2.has("url") && !formatting) {
              urlText = nodeText();
            } else if (set2.has("url") && formatting && urlText && ")" === nodeText() && !hasUrl) {
              if (!isUrlLike(urlText)) {
                const cls = Array.from(set2).map((c) => "cm-" + c).join(" ") + " external-link";
                push({ from: s, to: s, always: true, deco: deco().widget({ widget: new S12StyleSpanWidget(cls) }) });
              }
              urlText = "";
            } else {
              urlText = "";
            }
          },
        });
        flush(0);
      };
      let i = 0;
      const ranges = view.visibleRanges;
      for (; i < ranges.length; i++) {
        const r = ranges[i];
        walk(r.from, r.to);
      }
      return set.finish();
    }
  };
  return S12SearchDecoPlugin;
}

function s12quoteDecoRef() {
  if (!s12quoteDeco) s12quoteDeco = deco().replace({ widget: new S12BlockquoteBorderWidget() });
  return s12quoteDeco;
}

export function defineS12TaskLineDecoPlugin(host) {
  const syntaxClasses = host.livePreviewSyntaxClasses;
  const listPattern = host.listLinePattern;
  const builder = LPENV().s12rangeSetBuilder;
  S12TaskLineDecoPlugin = class extends S12BaseDecoPlugin {
    buildDeco(view) {
      if (!this.tree.length) return deco().none;
      const state = view.state;
      const set = new builder();
      for (const range of view.visibleRanges) {
        this.tree.iterate({
          from: range.from, to: range.to,
          enter(node) {
            const cls = node.type.prop(syntaxClasses);
            if (cls && cls.contains("HyperMD-task-line")) {
              const m = state.doc.lineAt(node.from).text.match(listPattern);
              if (m && m[6]) set.add(node.from, node.from, deco().line({ attributes: { "data-task": m[6] } }));
            }
          },
        });
      }
      return set.finish();
    }
  };
  return S12TaskLineDecoPlugin;
}

// =====================================================================================================================
// Extension factories + decoration declarator values
// =====================================================================================================================

export function s12SearchHighlightPlugin() {
  return viewPlugin().define((view) => new S12SearchDecoPlugin(view), { decorations: (p) => p.decorations });
}

export function s12TaskLinePlugin() {
  return viewPlugin().define((view) => new S12TaskLineDecoPlugin(view), { decorations: (p) => p.decorations });
}

/** The mobile drag extension pair (mouse tracking + draggable-widget mousedown handling). */
export function s12MobileDragExtensions(host) {
  const e = LPENV();
  const mousePlugin = () => s12cmMousePluginInstance();
  const annotation = host.mobileCursorAnnotation;
  const refresh = s12cmRefreshDispatch;
  return [
    viewPlugin().define((view) => {
      const opts = { capture: true };
      const onDown = (ev) => {
        if (0 !== ev.button) return;
        if (view.scrollDOM.scrollHeight > view.scrollDOM.clientHeight) {
          if (ev.clientX > view.scrollDOM.getBoundingClientRect().x + view.scrollDOM.clientWidth) return;
        }
        const selection = view.state.selection, doc = view.state.doc, top = view.scrollDOM.scrollTop;
        const plugin = view.plugin(mousePlugin());
        if (!plugin) return;
        plugin.mousedown = true;
        const dom = view.scrollDOM.doc;
        const end = () => {
          dom.removeEventListener("mouseup", onUp, opts);
          dom.removeEventListener("drag", onDrag, opts);
          plugin.mousedown = false;
          if (!view.state.selection.eq(selection) || !view.state.doc.eq(doc) || view.scrollDOM.scrollTop !== top) {
            view.dom.win.setTimeout(() => view.dispatch({ annotations: [annotation.of(true)], selection: view.state.selection }), 50);
          }
        };
        const onUp = (ev2) => { if (0 === ev2.button) end(); };
        const onDrag = () => end();
        dom.addEventListener("mouseup", onUp, opts);
        dom.addEventListener("drag", onDrag, opts);
      };
      view.scrollDOM.addEventListener("mousedown", onDown, opts);
      return { destroy() { view.scrollDOM.removeEventListener("mousedown", onDown, opts); } };
    }),
    e.s12cmEditorViewStatics.domEventHandlers({
      focus: (event, view) => refresh(view),
      blur: (event, view) => refresh(view),
      mousedown(event, view) {
        if (0 === event.button && (e.Bg.isModifier(event, "Mod") || (!event.shiftKey && !event.altKey))) {
          const target = event.targetNode;
          if (target.instanceOf(Element)) {
            const draggable = target.matchParent('[draggable="true"]');
            if (draggable) {
              draggable.setAttr("contenteditable", "false");
              const orig = event.preventDefault;
              event.preventDefault = function () { event.preventDefault = orig; };
              return true;
            }
          }
        }
      },
    }),
  ];
}

/** The blockquote-border decoration used for quote lines in live preview (i6). */
export function s12cmBlockquoteBorderDeco() {
  if (!s12quoteDeco) s12quoteDeco = deco().replace({ widget: new S12BlockquoteBorderWidget() });
  return s12quoteDeco;
}

/** The shared horizontal-rule widget instance (o6). */
export function s12cmHrWidgetInstance() {
  if (!s12hrInstance) s12hrInstance = new S12HrWidget();
  return s12hrInstance;
}

/** The empty side:-1 widget decoration used for the Android live-preview fix (E6). */
export function s12cmEmptyWidgetDeco() {
  if (!s12emptyDeco) s12emptyDeco = deco().widget({ widget: new S12EmptyWidgetType(), side: -1 });
  return s12emptyDeco;
}
