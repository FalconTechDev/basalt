// g20 clean-room: canvas node classes — base node, content-mounting node, dummy
// node, editable node, text node and link (webpage) node.
//
// Replaces orig S5/x5/T5/A5/I5/F5 (canvas-node.js).
import { box, boxOfRect, randomHex, rgbTripleToHex, distance } from "./misc.js";
import { env } from "./env.js";
import { inherit } from "./inherit.js";
import { canvas, ng20Finite, ng20RoundOr } from "./n-g20-shared.js";
import { s13ApplyCanvasColor, s13AnchorRect } from "./s13-geom.js";

const NG20_COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\))$/i;
const NG20_PALETTE_MAX = 6;

function ng20NormalColor(color) {
  color = (color || "").trim();
  if (!color) return "";
  if (/^\d+$/.test(color)) {
    const n = +color;
    return n >= 1 && n <= NG20_PALETTE_MAX ? String(n) : "";
  }
  const hex = rgbTripleToHex(color);
  if (hex) return hex;
  if (NG20_COLOR_RE.test(color)) return color;
  return "";
}

function ng20Num(v, fallback) { return ng20Finite(v) ? v : fallback; }

// ---- base node (S5) ---------------------------------------------------------------------------

export function defineNg20CanvasNode(host) {
  class CanvasNode {
    constructor(canvas_, id) {
      this.canvas = canvas_;
      this.app = canvas_.app;
      this.id = id || randomHex(16);
      this.type = "";
      this.x = 0;
      this.y = 0;
      this.width = 100;
      this.height = 100;
      this.color = "";
      this.zIndex = canvas_.getZIndex();
      this.aspectRatio = null;
      this.isEditing = false;
      this.destroyed = false;
      this.initialized = false;
      this.unknownData = {};
      this.child = null;

      this.nodeEl = createDiv("canvas-node");
      this.nodeEl.setAttr("data-node-id", this.id);
      this.containerEl = this.nodeEl.createDiv("canvas-node-container");
      this.contentEl = this.containerEl.createDiv("canvas-node-content");
      this.contentBlockerEl = this.containerEl.createDiv("canvas-node-content-blocker");
      this.contentBlockerEl.hide();
      this.placeholderEl = this.containerEl.createDiv("canvas-node-placeholder");
      this.labelEl = this.nodeEl.createDiv(this.labelClass());
      this.labelEl.hide();
      this.labelEl.setAttribute("contenteditable", "false");
      this.labelEl.addEventListener("blur", () => this.commitLabel());
      this.labelEl.addEventListener("keydown", (evt) => {
        evt.stopPropagation();
        if (evt.key === "Enter") { evt.preventDefault(); this.labelEl.blur(); }
        else if (evt.key === "Escape") { this.labelEl.setText(this.labelText()); this.labelEl.blur(); }
      });
      this.labelEl.addEventListener("pointerdown", (evt) => evt.stopPropagation());

      this.nodeEl.addEventListener("pointerdown", (evt) => this.onPointerdown(evt));
      this.nodeEl.addEventListener("click", (evt) => this.onClick(evt));
      this.nodeEl.addEventListener("contextmenu", (evt) => this.onContextMenu(evt));
      this.nodeEl.addEventListener("dblclick", (evt) => this.onDoubleClick(evt));

      this.render();
    }

    get rect() { return { x: this.x, y: this.y, width: this.width, height: this.height }; }
    get isAttached() { return !!this.nodeEl.parentNode; }
    get isFocused() { return this.nodeEl.hasClass("is-focused"); }

    getBBox() { return box(this.x, this.y, this.x + this.width, this.y + this.height); }

    // ---------- geometry ----------

    moveTo(pos) {
      if (!pos) return;
      if (ng20Finite(pos.x)) this.x = Math.round(pos.x);
      if (ng20Finite(pos.y)) this.y = Math.round(pos.y);
      this.canvas.markMoved(this);
      this.render();
    }

    resize(size) {
      if (!size) return;
      if (ng20Finite(size.width)) this.width = Math.round(size.width);
      if (ng20Finite(size.height)) this.height = Math.round(size.height);
      this.canvas.markMoved(this);
      this.render();
    }

    moveAndResize(rect_) {
      if (!rect_) return;
      if (ng20Finite(rect_.x)) this.x = Math.round(rect_.x);
      if (ng20Finite(rect_.y)) this.y = Math.round(rect_.y);
      if (ng20Finite(rect_.width)) this.width = Math.round(rect_.width);
      if (ng20Finite(rect_.height)) this.height = Math.round(rect_.height);
      this.canvas.markMoved(this);
      this.render();
    }

    // ---------- colour ----------

    setColor(color, render = true) {
      this.color = ng20NormalColor(color);
      if (render) this.render();
      else this.canvas.markDirty(this);
    }

    // ---------- codec ----------

    getData() {
      const out = { id: this.id, x: this.x, y: this.y, width: this.width, height: this.height };
      if (this.type) out.type = this.type;
      if (this.color) out.color = this.color;
      return { ...this.unknownData, ...out };
    }

    setData(data) {
      if (!data || typeof data !== "object") return;
      const known = new Set(["id", "type", "x", "y", "width", "height", "color"]);
      const unknown = {};
      for (const key of Object.keys(data)) if (!known.has(key)) unknown[key] = data[key];
      this.unknownData = unknown;
      if (ng20Finite(data.x)) this.x = Math.round(data.x);
      if (ng20Finite(data.y)) this.y = Math.round(data.y);
      if (ng20Finite(data.width) && data.width > 0) this.width = Math.round(data.width);
      if (ng20Finite(data.height) && data.height > 0) this.height = Math.round(data.height);
      if (data.color !== undefined) this.setColor(data.color, false);
      this.initialized = true;
      this.canvas.markMoved(this);
      this.canvas.markDirty(this);
    }

    // ---------- lifecycle ----------

    attach() {
      if (this.isAttached) return;
      this.canvas.canvasEl.appendChild(this.nodeEl);
      this.renderZIndex();
      this.updateBreakpoint();
    }

    detach() {
      this.nodeEl.detach();
    }

    preDetach() {
      this.unloadChildSafe();
    }

    unloadChildSafe() {
      if (this.child && typeof this.child.unload === "function") this.child.unload();
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.detach();
      this.unloadChildSafe();
      this.nodeEl.remove();
    }

    render() {
      if (this.destroyed) return;
      const el = this.nodeEl;
      el.style.left = this.x + "px";
      el.style.top = this.y + "px";
      el.style.width = this.width + "px";
      el.style.height = this.height + "px";
      el.style.zIndex = String(this.zIndex);
      s13ApplyCanvasColor(this.containerEl, this.color, host);
      this.renderZIndex();
      this.renderLabel();
    }

    renderZIndex() {
      if (!this.nodeEl.parentNode) return;
      // keep DOM order consistent with zIndex so equal-z siblings paint in order
      const parent = this.nodeEl.parentNode;
      let ref = this.nodeEl.nextSibling;
      while (ref) {
        const zid = ref.__ng20z;
        if (zid !== undefined && zid < this.zIndex) break;
        ref = ref.nextSibling;
      }
      if (ref !== this.nodeEl.nextSibling) parent.insertBefore(this.nodeEl, ref);
    }

    updateZIndex() {
      this.zIndex = this.canvas.getZIndex();
      this.render();
      this.canvas.markMoved(this);
    }

    updateBreakpoint() {}

    labelClass() { return "canvas-node-label"; }

    // ---------- label ----------

    renderLabel() {
      const show = this.labelText && this.labelText() ? true : !!this.labelElText;
      void show;
    }

    labelText() { return ""; }

    updateNodeLabel(text) {
      this.labelElText = text || "";
      const labelEl = this.labelEl;
      const visibility = this.canvas.options && this.canvas.options.cardLabelVisibility;
      labelEl.toggleClass("mod-hover-label", visibility === "hover");
      if (labelEl.getAttribute("contenteditable") !== "true") labelEl.setText(this.labelElText);
      labelEl.toggle(this.labelElText.length > 0 || labelEl.getAttribute("contenteditable") === "true");
    }

    /** Focuses the node label for inline renaming (group nodes). */
    focusLabel() {
      if (!this.labelElText && this.labelText && !this.labelText()) return;
      this.labelEl.setAttribute("contenteditable", "true");
      this.labelEl.show();
      this.labelEl.focus();
      host.focusAndSelectContents(this.labelEl);
    }

    commitLabel() {
      this.labelEl.setAttribute("contenteditable", "false");
      const text = (this.labelEl.innerText || "").trim();
      if (typeof this.setLabel === "function") this.setLabel(text);
      else this.updateNodeLabel(this.labelText());
      this.canvas.requestSave();
    }

    // ---------- selection ----------

    focus() { this.nodeEl.addClass("is-focused"); }
    blur() { this.nodeEl.removeClass("is-focused"); }
    select() { this.nodeEl.addClass("is-selected"); }
    deselect() { this.nodeEl.removeClass("is-selected"); }

    // ---------- editing ----------

    isEditable() { return false; }
    startEditing() {}
    setIsEditing(editing) { this.isEditing = !!editing; }

    // ---------- pointer ----------

    onPointerdown(evt) {
      if (evt.button !== 0 || !evt.isPrimary) return;
      if (this.isEditing) return;
      const canvas_ = this.canvas;
      if (canvas_.readonly) return;
      canvas_.handleSelectionDrag(evt, this.nodeEl, this);
    }

    onClick(evt) {
      void evt;
      if (!this.canvas.readonly) this.canvas.selectOnly(this);
    }

    onContextMenu(evt) {
      if (evt.defaultPrevented) return;
      evt.preventDefault();
      this.showMenu(evt);
    }

    onDoubleClick(evt) {
      if (this.canvas.readonly || !this.isEditable()) return;
      if (evt.defaultPrevented) return;
      this.startEditing({ x: evt.clientX, y: evt.clientY });
    }

    showMenu(evt) {
      const canvas_ = this.canvas;
      const menu = new host.Menu();
      const ti = env().gm.plugins.canvas;
      const self = this;
      menu.addSections(["title", "action", "clipboard", "danger"]);
      menu.addItem((item) => item.setSection("action").setTitle(ti.actionBringToFront ? ti.actionBringToFront() : "Bring to front").setIcon("lucide-chevrons-up").onClick(() => self.updateZIndex()));
      if (!canvas_.readonly) {
        menu.addItem((item) => item.setSection("danger").setTitle(ti.actionRemove ? ti.actionRemove() : "Remove").setIcon("lucide-trash-2").setWarning(true).onClick(() => canvas_.removeNode(self)));
      }
      canvas_.app.workspace.trigger("canvas:node-menu", menu, this);
      if (window.__fpNodeMenu) window.__fpNodeMenu(menu, this);
      menu.showAtMouseEvent(evt);
    }

    onResizePointerdown(evt, side) {
      if (this.canvas.readonly) return;
      evt.preventDefault();
      evt.stopPropagation();
      const canvas_ = this.canvas;
      const start = canvas_.posFromEvt(evt);
      const origin = { x: this.x, y: this.y, width: this.width, height: this.height };
      const minDim = canvas_.config.minContainerDimension || 50;
      host.dragWithThreshold(evt, () => ({
        move: (moveEvt) => {
          const p = canvas_.posFromEvt(moveEvt);
          let dx = p.x - start.x;
          let dy = p.y - start.y;
          let { x, y, width, height } = origin;
          const left = side.includes("left");
          const right = side.includes("right");
          const top = side.includes("top");
          const bottom = side.includes("bottom");
          if (left) { x = origin.x + dx; width = origin.width - dx; }
          if (right) { width = origin.width + dx; }
          if (top) { y = origin.y + dy; height = origin.height - dy; }
          if (bottom) { height = origin.height + dy; }
          if (width < minDim) { if (left) x += width - minDim; width = minDim; }
          if (height < minDim) { if (top) y += height - minDim; height = minDim; }
          if (moveEvt.shiftKey && this.aspectRatio) {
            const ratio = width / Math.max(1, height);
            if (Math.abs(dx) > Math.abs(dy)) height = width / ratio; else width = height * ratio;
          }
          this.moveAndResize({ x, y, width, height });
        },
        end: () => canvas_.requestSave(),
      }), 0);
    }

    onResizeDblclick() {}

    /** Begins a connection drag from one of the four side midpoints. */
    onConnectionPointerdown(evt, side) {
      if (evt.button !== 0 || !evt.isPrimary || this.canvas.readonly) return;
      evt.preventDefault();
      evt.stopPropagation();
      const canvas_ = this.canvas;
      const self = this;
      if (host.Keymap.isModEvent(evt)) {
        // modifier-held connection drag -> create a link node instead
        new host.s32UrlModal(canvas_.app, "", (url) => {
          canvas_.createLinkNode({ pos: canvas_.posFromEvt(evt), url });
        }).open();
        return;
      }
      const dummy = new canvas_.DummyNode(canvas_);
      dummy.width = 0;
      dummy.height = 0;
      const edge = new canvas_.EdgeClass(canvas_, randomHex(16), { node: this, side, end: ng20EdgeEndNoneSafe() }, { node: dummy, side: oppositeSide(side), end: ng20EdgeEndArrowSafe() });
      canvas_.addEdge(edge);
      canvas_.wrapperEl.addClass("is-connecting");
      let overNode = null;
      let overSide = null;
      host.dragWithThreshold(evt, () => ({
        move: (moveEvt) => {
          const p = canvas_.posFromEvt(moveEvt);
          dummy.moveTo({ x: p.x, y: p.y });
          const node = canvas_.hitTestNode(p, canvas_.snapDistance);
          overNode = node && node !== self ? node : null;
          overSide = overNode ? ng20SideToward(overNode, p) : null;
          edge.to = overNode
            ? { node: overNode, side: overSide, end: ng20EdgeEndArrowSafe() }
            : { node: dummy, side: oppositeSide(side), end: ng20EdgeEndArrowSafe() };
          edge.update();
          canvas_.markMoved(edge);
        },
        end: () => {
          canvas_.wrapperEl.removeClass("is-connecting");
          if (overNode) {
            edge.to = { node: overNode, side: overSide, end: ng20EdgeEndArrowSafe() };
            canvas_.markMoved(edge);
            canvas_.requestSave();
          } else {
            canvas_.removeEdge(edge);
          }
        },
        cleanup: () => {
          canvas_.wrapperEl.removeClass("is-connecting");
          dummy.detach();
          dummy.destroy();
        },
      }), 0);
    }

    /** Files this node links to (path+subpath), for connected-files queries. */
    getConnectedFiles() { return new Set(); }
  }

  function ng20EdgeEndNoneSafe() { return "none"; }
  function ng20EdgeEndArrowSafe() { return "arrow"; }
  function oppositeSide(side) {
    return { top: "bottom", bottom: "top", left: "right", right: "left" }[side] || "left";
  }
  function ng20SideToward(node, p) {
    const b = node.getBBox();
    const cx = b.minX + (b.maxX - b.minX) / 2;
    const cy = b.minY + (b.maxY - b.minY) / 2;
    const dx = p.x - cx, dy = p.y - cy;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
    return dy >= 0 ? "bottom" : "top";
  }

  canvas.Node = CanvasNode;
  return CanvasNode;
}

// ---- content-mounting node (x5) ---------------------------------------------------------------

export function defineNg20ContentMountNode(host) {
  const Base = canvas.Node || defineNg20CanvasNode(host);
  class ContentMountNode extends Base {
    constructor(canvas_, id) {
      super(canvas_, id);
      this.isContentMounted = false;
      this.alwaysKeepLoaded = false;
      this._scroll = null;
    }

    updateBreakpoint() {
      const canvas_ = this.canvas;
      const bp = canvas_.zoomBreakpoint;
      const shouldMount = this.alwaysKeepLoaded || canvas_.zoom >= bp;
      if (shouldMount) this.mountContent();
      else this.unmountContent();
    }

    mountContent() {
      if (this.isContentMounted || this.destroyed) return;
      this.isContentMounted = true;
      this.renderContent();
      if (this._scroll) {
        host.restoreScrollPositions(this.contentEl, this._scroll);
        this._scroll = null;
      }
    }

    unmountContent() {
      if (!this.isContentMounted) return;
      this._scroll = host.saveScrollPositions(this.contentEl);
      this.isContentMounted = false;
      this.unloadChildSafe();
      this.child = null;
      this.contentEl.empty();
      this.placeholderEl.show();
    }

    /** Subclass hook: build the type-specific content inside contentEl. */
    renderContent() {
      this.placeholderEl.hide();
    }

    preDetach() {
      super.preDetach();
      if (this.isContentMounted) this.unmountContent();
    }
  }

  canvas.ContentMountNode = ContentMountNode;
  return ContentMountNode;
}

// ---- dummy node (T5) --------------------------------------------------------------------------

export function defineNg20DummyNode(host) {
  const Base = canvas.Node || defineNg20CanvasNode(host);
  class DummyNode extends Base {
    constructor(canvas_, id) {
      super(canvas_, id);
      this.type = "dummy";
      this.width = 0;
      this.height = 0;
      this.nodeEl.addClass("is-dummy");
      this.placeholderEl.hide();
      this.contentBlockerEl.hide();
      this.labelEl.hide();
    }

    getData() {
      return super.getData();
    }

    render() {
      super.render();
    }
  }
  canvas.DummyNode = DummyNode;
  return DummyNode;
}

// ---- editable node (A5) -----------------------------------------------------------------------

export function defineNg20EditableNode(host) {
  const Base = canvas.ContentMountNode || defineNg20ContentMountNode(host);
  class EditableNode extends Base {
    constructor(canvas_, id) {
      super(canvas_, id);
      this.alwaysKeepLoaded = true;
    }

    isEditable() { return this.child instanceof host.MarkdownEmbedBase; }

    setIsEditing(editing) {
      this.isEditing = !!editing;
      this.nodeEl.toggleClass("is-editing", this.isEditing);
      this.contentBlockerEl.toggle(!this.isEditing);
      if (!this.isEditing) this.canvas.markDirty(this);
    }

    blur() {
      super.blur();
      const child = this.child;
      if (child instanceof canvas.MarkdownEmbed || child instanceof host.StatefulEmbedBase) {
        child.showPreview(true);
        if (child.applyScope) child.applyScope(null);
      }
    }

    focus() {
      super.focus();
      const workspace = this.app.workspace;
      const editor = this.child instanceof host.MarkdownEmbedBase ? this.child : null;
      if (workspace) workspace.activeEditor = editor;
      let file = null;
      if (this instanceof canvas.FileNode) file = this.file;
      this.canvas.requestUpdateFileOpen(file);
    }

    startEditing(point_) {
      if (this.canvas.readonly) return;
      const child = this.child;
      if (child instanceof host.MarkdownEmbedBase) {
        child.showEditor(point_);
        this.setIsEditing(true);
      }
    }

    onDoubleClick(evt) {
      if (this.canvas.readonly || !this.isEditable()) return;
      if (evt.defaultPrevented) return;
      if (host.isEditableTarget(evt.targetNode)) return;
      this.startEditing({ x: evt.clientX, y: evt.clientY });
    }
  }
  canvas.EditableNode = EditableNode;
  return EditableNode;
}

// ---- text node (I5) ----------------------------------------------------------------------------

export function defineNg20TextNode(host) {
  const Base = canvas.EditableNode || defineNg20EditableNode(host);
  class TextNode extends Base {
    constructor(canvas_, id) {
      super(canvas_, id);
      this.type = "text";
      this.text = "";
    }

    getData() {
      const out = super.getData();
      if (this.text) out.text = this.text;
      return out;
    }

    setData(data) {
      super.setData(data);
      if (typeof data.text === "string") {
        this.text = data.text;
        if (this.child) this.child.set(this.text);
      }
    }

    setText(text) {
      if (this.text === text) return;
      this.text = text || "";
      if (this.child) this.child.set(this.text);
      this.canvas.markDirty(this);
      this.canvas.requestSave();
    }

    renderContent() {
      super.renderContent();
      if (!this.placeholderEl.firstChild) {
        host.setIcon(this.placeholderEl.createDiv("canvas-icon-placeholder"), "lucide-align-left");
      }
      if (!this.child) {
        this.child = new canvas.MarkdownEmbed(this);
        this.child.set(this.text);
        if (typeof this.child.load === "function") this.child.load();
      }
    }

    startEditing(point_) {
      super.startEditing(point_);
    }

    unmountContent() {
      this.child = null;
      super.unmountContent();
    }

    /** Converts the card's text into a new markdown file node. */
    async convertToFile() {
      const canvas_ = this.canvas;
      const app = this.app;
      const text = this.text || "";
      const base = (text.split("\n")[0] || "").trim().slice(0, 60) || "Untitled";
      const folder = canvas_.view && canvas_.view.file ? canvas_.view.file.parent : app.vault.getRoot();
      let path = base + ".md";
      let i = 1;
      while (app.vault.getAbstractFileByPath((folder && folder.path !== "/" ? folder.path + "/" : "") + path)) {
        path = base + " " + i++ + ".md";
      }
      const full = (folder && folder.path !== "/" ? folder.path + "/" : "") + path;
      try {
        const file = await app.vault.create(full, text);
        const node = canvas_.createFileNode({ pos: { x: this.x, y: this.y }, size: { width: this.width, height: this.height }, file, save: false, focus: false });
        canvas_.removeNode(this);
        canvas_.requestSave();
        return node;
      } catch (err) {
        console.error(err);
        return null;
      }
    }
  }
  canvas.TextNode = TextNode;
  return TextNode;
}

// ---- link node (F5) ----------------------------------------------------------------------------

export function defineNg20LinkNode(host) {
  const Base = canvas.ContentMountNode || defineNg20ContentMountNode(host);
  class LinkNode extends Base {
    constructor(canvas_, id) {
      super(canvas_, id);
      this.type = "link";
      this.url = "";
      this.frameEl = null;
      this.pageTitle = "";
    }

    getData() {
      const out = super.getData();
      if (this.url) out.url = this.url;
      return out;
    }

    setData(data) {
      super.setData(data);
      if (typeof data.url === "string") this.setUrl(data.url, false);
    }

    setUrl(url, render = true) {
      let u = String(url || "");
      if (window.__fpUrl) u = window.__fpUrl(u);
      this.url = u;
      this.recreateFrame();
      this.updateNodeLabel(this.pageTitle || this.urlHost());
      if (render) this.canvas.markDirty(this);
    }

    urlHost() {
      try { return new URL(this.url).host; } catch (e) { return this.url; }
    }

    recreateFrame() {
      if (this.frameEl) { this.frameEl.remove(); this.frameEl = null; }
      if (!this.url) return;
      const wrap = this.contentEl;
      if (env().Yl.isMobile) {
        const framed = host.normalizeEmbedUrl ? host.normalizeEmbedUrl(this.url) : null;
        const f = wrap.createEl("iframe", { cls: "canvas-node-frame" });
        f.setAttr("src", framed || this.url);
        f.setAttr("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
        this.frameEl = f;
      } else {
        const w = wrap.createEl("webview", { cls: "canvas-node-frame" });
        w.setAttr("src", this.url);
        w.setAttr("partition", "persist:canvas");
        w.addEventListener("page-title-updated", (evt) => {
          this.pageTitle = evt.title || "";
          this.updateNodeLabel(this.pageTitle || this.urlHost());
        });
        this.frameEl = w;
      }
    }

    setFrameUrl() {
      if (this.frameEl) this.frameEl.setAttr("src", this.url);
    }

    renderContent() {
      super.renderContent();
      this.recreateFrame();
      this.updateNodeLabel(this.pageTitle || this.urlHost());
    }

    unmountContent() {
      if (this.frameEl) { this.frameEl.remove(); this.frameEl = null; }
      super.unmountContent();
    }

    showMenu(evt) {
      const canvas_ = this.canvas;
      const menu = new host.Menu();
      const ti = env().gm.plugins.canvas;
      const self = this;
      menu.addSections(["title", "action", "danger"]);
      menu.addItem((item) => item.setSection("action").setTitle(ti.actionOpen ? ti.actionOpen() : "Open").setIcon("lucide-external-link").onClick(() => { window.open(self.url, "_blank"); }));
      menu.addItem((item) => item.setSection("action").setTitle(ti.actionCopyLink ? ti.actionCopyLink() : "Copy URL").setIcon("lucide-copy").onClick(() => copyText(self.url)));
      menu.addItem((item) => item.setSection("action").setTitle(ti.actionReload ? ti.actionReload() : "Reload").setIcon("lucide-rotate-cw").onClick(() => self.setFrameUrl()));
      if (!canvas_.readonly) {
        menu.addItem((item) => item.setSection("danger").setTitle(ti.actionRemove ? ti.actionRemove() : "Remove").setIcon("lucide-trash-2").setWarning(true).onClick(() => canvas_.removeNode(self)));
      }
      canvas_.app.workspace.trigger("canvas:node-menu", menu, this);
      if (window.__fpNodeMenu) window.__fpNodeMenu(menu, this);
      menu.showAtMouseEvent(evt);
    }
  }
  canvas.LinkNode = LinkNode;
  return LinkNode;
}
